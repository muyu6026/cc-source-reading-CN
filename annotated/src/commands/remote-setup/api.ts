import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { logForDebugging } from '../../utils/debug.js'
import { getOAuthHeaders, prepareApiRequest } from '../../utils/teleport/api.js'
import { fetchEnvironments } from '../../utils/teleport/environments.js'

// BYOC beta 的接口开关：用日期戳标记的实验特性，随请求头下发
const CCR_BYOC_BETA_HEADER = 'ccr-byoc-2025-07-29'

/**
 * Wraps a raw GitHub token so that its string representation is redacted.
 * `String(token)`, template literals, `JSON.stringify(token)`, and any
 * attached error messages will show `[REDACTED:gh-token]` instead of the
 * token value. Call `.reveal()` only at the single point where the raw
 * value is placed into an HTTP body.
 */
// 把原始令牌包一层：任何把它转成字符串的地方都只显示脱敏占位，只在放进请求体那一点才 reveal
export class RedactedGithubToken {
  readonly #value: string
  constructor(raw: string) {
    this.#value = raw
  }
// reveal 是唯一释放明文的地方：只在构造请求体时调用一次
  reveal(): string {
    return this.#value
  }
  toString(): string {
    return '[REDACTED:gh-token]'
  }
  toJSON(): string {
    return '[REDACTED:gh-token]'
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED:gh-token]'
  }
}

// 导入成功的返回值：只暴露 GitHub 用户名
export type ImportTokenResult = {
  github_username: string
}

// 导入错误的四种情况：未登录、令牌无效、服务端（带状态码）、网络
export type ImportTokenError =
  | { kind: 'not_signed_in' }
  | { kind: 'invalid_token' }
  | { kind: 'server'; status: number }
  | { kind: 'network' }

/**
 * POSTs a GitHub token to the CCR backend, which validates it against
 * GitHub's /user endpoint and stores it Fernet-encrypted in sync_user_tokens.
 * The stored token satisfies the same read paths as an OAuth token, so
 * clone/push in claude.ai/code works immediately after this succeeds.
 */
// 导入令牌：POST 给 CCR 后端校验并 Fernet 加密存储，之后克隆推送即可用
export async function importGithubToken(
  token: RedactedGithubToken,
): Promise<
  | { ok: true; result: ImportTokenResult }
  | { ok: false; error: ImportTokenError }
> {
// 先取访问令牌与组织 UUID：失败即视为未登录
  let accessToken: string, orgUUID: string
  try {
    ;({ accessToken, orgUUID } = await prepareApiRequest())
  } catch {
    return { ok: false, error: { kind: 'not_signed_in' } }
  }

  const url = `${getOauthConfig().BASE_API_URL}/v1/code/github/import-token`
  const headers = {
    ...getOAuthHeaders(accessToken),
    'anthropic-beta': CCR_BYOC_BETA_HEADER,
    'x-organization-uuid': orgUUID,
  }

// 发请求并按状态码翻译：200 成功、400 令牌无效、401 未登录、其余服务端错
  try {
    const response = await axios.post<ImportTokenResult>(
      url,
      { token: token.reveal() },
      { headers, timeout: 15000, validateStatus: () => true },
    )
    if (response.status === 200) {
      return { ok: true, result: response.data }
    }
    if (response.status === 400) {
      return { ok: false, error: { kind: 'invalid_token' } }
    }
    if (response.status === 401) {
      return { ok: false, error: { kind: 'not_signed_in' } }
    }
    logForDebugging(`import-token returned ${response.status}`, {
      level: 'error',
    })
    return { ok: false, error: { kind: 'server', status: response.status } }
// 网络错误单独处理：绝不把含明文的请求体写进日志，错误码足够定位
  } catch (err) {
    if (axios.isAxiosError(err)) {
      // err.config.data would contain the POST body with the raw token.
      // Do not include it in any log. The error code alone is enough.
      logForDebugging(`import-token network error: ${err.code ?? 'unknown'}`, {
        level: 'error',
      })
    }
    return { ok: false, error: { kind: 'network' } }
  }
}

// 先查是否已有环境：避免重复创建，失败也不阻断
async function hasExistingEnvironment(): Promise<boolean> {
  try {
    const envs = await fetchEnvironments()
    return envs.length > 0
  } catch {
    return false
  }
}

/**
 * Best-effort default environment creation. Mirrors the web onboarding's
 * DEFAULT_CLOUD_ENVIRONMENT_REQUEST so a first-time user lands on the
 * composer instead of env-setup. Checks for existing environments first
 * so re-running /web-setup doesn't pile up duplicates. Failures are
 * non-fatal — the token import already succeeded, and the web state
 * machine falls back to env-setup on next load.
 */
// 建默认环境：尽力而为，复用网页端同样的请求结构，失败非致命
export async function createDefaultEnvironment(): Promise<boolean> {
  let accessToken: string, orgUUID: string
  try {
    ;({ accessToken, orgUUID } = await prepareApiRequest())
  } catch {
    return false
  }

// 已有环境就直接成功，否则才发创建请求
  if (await hasExistingEnvironment()) {
    return true
  }

  // The /private/organizations/{org}/ path rejects CLI OAuth tokens (wrong
  // auth dep). The public path uses build_flexible_auth — same path
  // fetchEnvironments() uses. Org is passed via x-organization-uuid header.
// 用公开路径而非组织私有路径：CLI 的 OAuth 令牌在私有路径会被拒
  const url = `${getOauthConfig().BASE_API_URL}/v1/environment_providers/cloud/create`
  const headers = {
    ...getOAuthHeaders(accessToken),
    'x-organization-uuid': orgUUID,
  }

  try {
// 创建请求体：名称 Default、anthropic_cloud 类型，并预置 python 与 node 两种语言
    const response = await axios.post(
      url,
      {
        name: 'Default',
        kind: 'anthropic_cloud',
        description: 'Default - trusted network access',
        config: {
          environment_type: 'anthropic',
          cwd: '/home/user',
          init_script: null,
          environment: {},
          languages: [
            { name: 'python', version: '3.11' },
            { name: 'node', version: '20' },
          ],
          network_config: {
            allowed_hosts: [],
            allow_default_hosts: true,
          },
        },
      },
      { headers, timeout: 15000, validateStatus: () => true },
    )
    return response.status >= 200 && response.status < 300
  } catch {
    return false
  }
}

/** Returns true when the user has valid Claude OAuth credentials. */
// isSignedIn：能取到访问令牌即视为已登录，失败返回假
export async function isSignedIn(): Promise<boolean> {
  try {
    await prepareApiRequest()
    return true
  } catch {
    return false
  }
}

// getCodeWebUrl：拼出网页端的 code 入口地址，供打开浏览器用
export function getCodeWebUrl(): string {
  return `${getOauthConfig().CLAUDE_AI_ORIGIN}/code`
}
