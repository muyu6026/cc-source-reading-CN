import {
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  auth as sdkAuth,
  refreshAuthorization as sdkRefreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  InvalidGrantError,
  OAuthError,
  ServerError,
  TemporarilyUnavailableError,
  TooManyRequestsError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import {
  type AuthorizationServerMetadata,
  type OAuthClientInformation,
  type OAuthClientInformationFull,
  type OAuthClientMetadata,
  OAuthErrorResponseSchema,
  OAuthMetadataSchema,
  type OAuthTokens,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { parse } from 'url'
import xss from 'xss'
import { MCP_CLIENT_METADATA_URL } from '../../constants/oauth.js'
import { openBrowser } from '../../utils/browser.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import * as lockfile from '../../utils/lockfile.js'
import { logMCPDebug } from '../../utils/log.js'
import { getPlatform } from '../../utils/platform.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'
import { clearKeychainCache } from '../../utils/secureStorage/macOsKeychainHelpers.js'
import type { SecureStorageData } from '../../utils/secureStorage/types.js'
import { sleep } from '../../utils/sleep.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { logEvent } from '../analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/metadata.js'
import { buildRedirectUri, findAvailablePort } from './oauthPort.js'
import type { McpHTTPServerConfig, McpSSEServerConfig } from './types.js'
import { getLoggingSafeMcpBaseUrl } from './utils.js'
import { performCrossAppAccess, XaaTokenExchangeError } from './xaa.js'
import {
  acquireIdpIdToken,
  clearIdpIdToken,
  discoverOidc,
  getCachedIdpIdToken,
  getIdpClientSecret,
  getXaaIdpSettings,
  isXaaEnabled,
} from './xaaIdpLogin.js'

// 【auth.ts 为什么有 2465 行 —— 读这个文件前先建立的心智模型】
//
//   它实现的不是「OAuth 2.0」，是「OAuth 2.0 在几十个真实服务器上的样子」。
//
//   规范只描述合规的实现。而现实里：
//     · Slack 用 HTTP 200 返回错误体（120 行那段注释）
//     · 有些服务器不实现 RFC 9728，元数据挂在老路径上（240 行）
//     · 有些服务器的吊销端点不认 RFC 7009 的公共客户端写法（370 行）
//     · 有些服务器刷不出更高 scope，但 SDK 会一直去刷（1344 行）
//
//   每一段「奇怪的代码」背后都有一个具体的不合规实现。
//   所以读这个文件的正确姿势不是「顺着规范读」，
//   而是**每看到一处补丁就问：他在补谁的不合规**。
//
// ── 文件的分层 ──
//
//   ① 1-310     工具层：脱敏、错误体归一、带超时的 fetch、元数据发现
//   ② 313-634   凭据寻址与吊销：getServerKey / revokeServerTokens
//   ③ 636-1342  两条认证流程：XAA（企业 SSO）与标准 consent（浏览器同意）
//   ④ 1344-2360 ClaudeAuthProvider：喂给 MCP SDK 的九方法适配器
//   ⑤ 2362-2465 客户端密钥的读写与 scope 提取
//
//   第 ④ 段是核心：SDK 只认这套接口，所有策略都在回调里。
/**
 * Timeout for individual OAuth requests (metadata discovery, token refresh, etc.)
 */
const AUTH_REQUEST_TIMEOUT_MS = 30000

// 【遥测枚举：值一旦发出去就再也不能改名】
//
//   这两个类型（71 行、84 行）不是给自己用的，是给 BigQuery 用的。
//   注释里那句 "Keep stable (do not rename; add new ones)" 是硬约束：
//   看板上的历史数据按这些字符串分组，改名等于把过去的数据全部丢进「其他」。
//
//   所以它们的演化方式是**只增不改**。
//   这也是为什么取值定得这么粗（六个原因覆盖所有情况）：
//   粒度越细，将来想合并就越难；粗一点反而耐用。
//
//   【可以学的做法】埋点枚举当成**外部 API** 对待，加 deprecate 注释而不是直接改。
//   代价是枚举会越来越长 —— 这是可接受的。
/**
 * Failure reasons for the `tengu_mcp_oauth_refresh_failure` event. Values
 * are emitted to analytics — keep them stable (do not rename; add new ones).
 */
type MCPRefreshFailureReason =
  | 'metadata_discovery_failed'
  | 'no_client_info'
  | 'no_tokens_returned'
  | 'invalid_grant'
  | 'transient_retries_exhausted'
  | 'request_failed'

/**
 * Failure reasons for the `tengu_mcp_oauth_flow_error` event. Values are
 * emitted to analytics for attribution in BigQuery. Keep stable (do not
 * rename; add new ones).
 */
type MCPOAuthFlowErrorReason =
  | 'cancelled'
  | 'timeout'
  | 'provider_denied'
  | 'state_mismatch'
  | 'port_unavailable'
  | 'sdk_auth_failed'
  | 'token_exchange_failed'
  | 'unknown'

const MAX_LOCK_RETRIES = 5

// 【这五个参数为什么算敏感】
//
//   state           CSRF 令牌。泄漏 = 攻击者能伪造回调
//   nonce           OIDC 防重放。泄漏 = 能重放 id_token
//   code_verifier   PKCE 的「证明」。泄漏 = 截获 code 就能换 token
//   code_challenge  verifier 的哈希。单独泄漏危害小，但配合别的就危险
//   code            授权码本身。泄漏 = 直接换 token
//
//   注意这里**没有** access_token / refresh_token ——
//   因为它们在 header 或 body 里，不在 URL query 里；
//   而这个函数只处理 URL。
//
//   【判断「什么算敏感」的方法】问：拿到这个值，攻击者能完成哪一步？
//   能完成任意一步的都算。
/**
 * OAuth query parameters that should be redacted from logs.
 * These contain sensitive values that could enable CSRF or session fixation attacks.
 */
const SENSITIVE_OAUTH_PARAMS = [
  'state',
  'nonce',
  'code_challenge',
  'code_verifier',
  'code',
]

/**
 * Redacts sensitive OAuth query parameters from a URL for safe logging.
 * Prevents exposure of state, nonce, code_challenge, code_verifier, and authorization codes.
 */
// 【只在日志里脱敏，不改真实 URL】
//
//   这个函数被调用在 `logMCPDebug` 的参数位置，从不用于实际请求。
//   所以它必须**返回一个可读的完整 URL**（保留 host/path/其余参数），
//   只把五个值换成占位符 —— 否则排障时看不出是哪个端点出错。
//
//   ── catch 分支的处理很关键 ──
//
//   `new URL()` 抛异常时原样返回。这看起来像「脱敏失败就放弃」，
//   但更好的做法是返回一个不含 query 的截断串。
//   现状的风险：畸形 URL 里的敏感参数会原样进日志。
//   实践中畸形到解析不了、又恰好带着 code 的 URL 极少，所以没改。
//
//   【这类「出错路径上的安全降级」是最容易漏的审计点。】
function redactSensitiveUrlParams(url: string): string {
  try {
    const parsedUrl = new URL(url)
    for (const param of SENSITIVE_OAUTH_PARAMS) {
      if (parsedUrl.searchParams.has(param)) {
        parsedUrl.searchParams.set(param, '[REDACTED]')
      }
    }
    return parsedUrl.toString()
  } catch {
    // Return as-is if not a valid URL
    return url
  }
}

// 【normalizeOAuthErrorBody 存在的原因：一个真实的 Slack 兼容 bug】
//
//   规范的 OAuth 服务器：出错 → HTTP 4xx + {"error":"invalid_grant"}
//   Slack：出错 → HTTP **200** + {"error":"invalid_refresh_token"}
//
//   而 SDK 的 executeTokenRequest 只在 `!response.ok` 时才去解析错误体。
//   2xx 的响应它直接丢给 OAuthTokensSchema.parse() → ZodError。
//   ZodError 在那条链路上会被归成不透明的 request_failed。
//
//   后果不是「报错不好看」，而是**该清 token 的时候不清**：
//
//     invalid_grant  → 走 invalidateCredentials('tokens') → 提示重新登录（自愈）
//     request_failed → 重试三次 → 放弃 → 但坏 token 还留在 keychain 里
//
//   用户看到的现象是「这个 MCP 服务器一直连不上，怎么点重试都没用」。
//
// ── 补丁手法值得学：不改 SDK，只改它的输入 ──
//
//   把「200 + error 体」重写成「400 + 同样的 error 体」，
//   SDK 的既有错误映射就自动生效了。
//   这比 fork SDK 或者在调用处 try/catch 猜错误类型都便宜。
//
//   代价：这是一个**响应体嗅探**，会读掉 response body。
//   所以必须 `new Response(text, response)` 重建 ——
//   直接 return 原对象的话 body 已经被消费，下游读不到。
/**
 * Some OAuth servers (notably Slack) return HTTP 200 for all responses,
 * signaling errors via the JSON body instead. The SDK's executeTokenRequest
 * only calls parseErrorResponse when !response.ok, so a 200 with
 * {"error":"invalid_grant"} gets fed to OAuthTokensSchema.parse() and
 * surfaces as a ZodError — which the refresh retry/invalidation logic
 * treats as opaque request_failed instead of invalid_grant.
 *
 * This wrapper peeks at 2xx POST response bodies and rewrites ones that
 * match OAuthErrorResponseSchema (but not OAuthTokensSchema) to a 400
 * Response, so the SDK's normal error-class mapping applies. The same
 * fetchFn is also used for DCR POSTs, but DCR success responses have no
 * {error: string} field so they don't match the rewrite condition.
 *
 * Slack uses non-standard error codes (invalid_refresh_token observed live
 * at oauth.v2.user.access; expired_refresh_token/token_expired per Slack's
 * token rotation docs) where RFC 6749 specifies invalid_grant. We normalize
 * those so OAUTH_ERRORS['invalid_grant'] → InvalidGrantError matches and
 * token invalidation fires correctly.
 */
const NONSTANDARD_INVALID_GRANT_ALIASES = new Set([
  'invalid_refresh_token',
  'expired_refresh_token',
  'token_expired',
])

/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins --
 * Response has been stable in Node since 18; the rule flags it as
 * experimental-until-21 which is incorrect. Pattern matches existing
 * createAuthFetch suppressions in this file. */
export async function normalizeOAuthErrorBody(
  response: Response,
): Promise<Response> {
  if (!response.ok) {
    return response
  }
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = jsonParse(text)
  } catch {
    return new Response(text, response)
  }
// 【判定顺序不能反：先认「成功」再认「错误」】
//
//   为什么 OAuthTokensSchema 必须在 OAuthErrorResponseSchema 之前？
//
//   如果反过来，一个**正常的 token 响应**只要恰好有个 error 字段
//   （有些服务器会带 error: null 或者额外的诊断字段），
//   就会被误判成错误响应、改写成 400，然后正常的登录直接失败。
//
//   而先判成功：正常 token 响应一定匹配 Tokens 形状，提前放行。
//   顺序上「先排除正常情况」永远比「先匹配异常特征」安全。
//
//   【通用规则】做异常检测时，先写「什么情况下一定正常」的快速通道。
  if (OAuthTokensSchema.safeParse(parsed).success) {
    return new Response(text, response)
  }
  const result = OAuthErrorResponseSchema.safeParse(parsed)
  if (!result.success) {
    return new Response(text, response)
  }
// 【三个别名归一成 invalid_grant —— 这是自愈的唯一入口】
//
//   Slack 用的是非标准码：
//     invalid_refresh_token    实测于 oauth.v2.user.access
//     expired_refresh_token    刷新令牌轮换文档
//     token_expired            同上
//
//   这三个语义上都是「refresh token 不能用了」，但字符串不同。
//   不归一的话，它们会一路走到 request_failed，
//   而 request_failed 的处理是「重试 3 次然后放弃」——
//   一个本来只需重新登录就能解决的问题，变成了永久性故障。
//
//   归一之后统一是 invalid_grant，命中 `_doRefresh` 里那条分支：
//   先查别的进程有没有刷好 → 没有就清 token → 回到 needs-auth → 用户重新授权。
//
//   【所以「错误码归一」不是代码整洁问题，是功能可用性问题。】
  const normalized = NONSTANDARD_INVALID_GRANT_ALIASES.has(result.data.error)
    ? {
        error: 'invalid_grant',
        error_description:
          result.data.error_description ??
          `Server returned non-standard error code: ${result.data.error}`,
      }
    : result.data
  return new Response(jsonStringify(normalized), {
    status: 400,
    statusText: 'Bad Request',
    headers: response.headers,
  })
}
/* eslint-enable eslint-plugin-n/no-unsupported-features/node-builtins */

/**
 * Creates a fetch function with a fresh 30-second timeout for each OAuth request.
 * Used by ClaudeAuthProvider for metadata discovery and token refresh.
 * Prevents stale timeout signals from affecting auth operations.
 */
// 【createAuthFetch：每次调用都造一个新 fetch，而不是复用一个】
//
//   为什么不能复用？因为 timeout signal 是一次性的：
//   `AbortSignal.timeout()` 到点就 abort，那个 signal 永久处于 aborted。
//   复用一个带旧 signal 的 fetch，第二次请求会**立刻**被 abort。
//
//   所以这里的「工厂函数」不是风格选择，是正确性要求。
//   注释里 "Prevents stale timeout signals" 说的就是这个。
//
//   【模式名】stale signal 问题在 Node 里很常见，
//   凡是把 AbortSignal 存进对象/闭包长期持有的地方都要警惕。
function createAuthFetch(): FetchLike {
  return async (url: string | URL, init?: RequestInit) => {
    const timeoutSignal = AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS)
    const isPost = init?.method?.toUpperCase() === 'POST'

// 【早退路径故意不做 cleanup】
//
//   `!init.signal` 时直接 fetch 后返回，没有 listener 可摘 ——
//   因为 timeout signal 是本地新建的，没有外部对象持有它。
//
//   对比下面那条路径：一旦把外部 signal 的 listener 挂到本地 controller 上，
//   就**必须**在成功和失败两个出口都摘掉（230 行、233 行）。
//   漏一个就是 listener 泄漏 —— 长跑的 CLI 会慢慢积累。
//
//   【写合并 signal 的检查表】挂 listener 的地方，数一下有几个出口
//   （resolve / reject / 早退 / 超时），每个出口都要有 cleanup。
    // No existing signal - just use timeout
    if (!init?.signal) {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const response = await fetch(url, { ...init, signal: timeoutSignal })
      return isPost ? normalizeOAuthErrorBody(response) : response
    }

    // Combine signals: abort when either fires
// 【手写 signal 合并，而不是 AbortSignal.any()】
//
//   `AbortSignal.any([a, b])` 是 Node 20+ 才有的。
//   这个文件要兼容更老的运行时，所以手写：
//   controller + 两个 listener + 手动 cleanup。
//
//   顺带处理了一个边界：如果外部 signal **在挂 listener 之前**就已经 abort 了，
//   addEventListener 不会补发事件（AbortSignal 不重放历史），
//   所以 223 行单独检查 `init.signal.aborted` 手动补一刀。
//
//   【这是所有「事件 + 可能已发生」场景的通病】：
//   订阅之前先查一次当前状态，否则会永久错过。
    const controller = new AbortController()
    const abort = () => controller.abort()

    init.signal.addEventListener('abort', abort)
    timeoutSignal.addEventListener('abort', abort)

    // Cleanup to prevent event listener leaks after fetch completes
    const cleanup = () => {
      init.signal?.removeEventListener('abort', abort)
      timeoutSignal.removeEventListener('abort', abort)
    }

    if (init.signal.aborted) {
      controller.abort()
    }

    try {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const response = await fetch(url, { ...init, signal: controller.signal })
      cleanup()
      return isPost ? normalizeOAuthErrorBody(response) : response
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

// 【元数据发现的三条路径，按可靠性从高到低】
//
//   ① 用户在 .mcp.json 里直接给了 authServerMetadataUrl
//      → 一次 GET，最可靠。但这是用户可控输入。
//
//   ② RFC 9728：先探 MCP 服务器上的 /.well-known/oauth-protected-resource，
//      读出 authorization_servers[0]，再对那个 URL 做 RFC 8414。
//      这是 MCP 规范推荐路径（资源服务器和授权服务器可以是不同 host）。
//
//   ③ 直接对 MCP 服务器 URL 做 RFC 8414（**带 path**）。
//      这是给老服务器的兼容路径：它们把元数据挂在
//      /.well-known/oauth-authorization-server/{path} 上，不实现 RFC 9728。
//
//   ── ③ 为什么要自己写，不能用 SDK 的 fallback ──
//
//   因为 SDK 自带的 fallback 会**把 path 剥掉**。
//   对于 URL 是 https://host/api/mcp 的服务器，SDK 会去探
//   https://host/.well-known/...，而它实际挂在 https://host/.well-known/.../api/mcp。
//   所以这里保留了 path-aware 的探法（注释里 "preserves the pre-existing
//   path-aware probe for backward compatibility"）。
//
//   【这条注释的价值】它记录了一个「我们为什么不用上游现成实现」的决定。
//   没有这段注释，下一个人会觉得这是重复造轮子然后删掉。
/**
 * Fetches authorization server metadata, using a configured metadata URL if available,
 * otherwise performing RFC 9728 → RFC 8414 discovery via the SDK.
 *
 * Discovery order when no configured URL:
 * 1. RFC 9728: probe /.well-known/oauth-protected-resource on the MCP server,
 *    read authorization_servers[0], then RFC 8414 against that URL.
 * 2. Fallback: RFC 8414 directly against the MCP server URL (path-aware). Covers
 *    legacy servers that co-host auth metadata at /.well-known/oauth-authorization-server/{path}
 *    without implementing RFC 9728. The SDK's own fallback strips the path, so this
 *    preserves the pre-existing path-aware probe for backward compatibility.
 *
 * Note: configuredMetadataUrl is user-controlled via .mcp.json. Project-scoped MCP
 * servers require user approval before connecting (same trust level as the MCP server
 * URL itself). The HTTPS requirement here is defense-in-depth beyond schema validation
 * — RFC 8414 mandates OAuth metadata retrieval over TLS.
 */
async function fetchAuthServerMetadata(
  serverName: string,
  serverUrl: string,
  configuredMetadataUrl: string | undefined,
  fetchFn?: FetchLike,
  resourceMetadataUrl?: URL,
): Promise<Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>> {
// 【用户可控的 URL，必须强制 https】
//
//   authServerMetadataUrl 来自 .mcp.json，也就是项目里可以提交的文件。
//   如果不强制 https，恶意的 .mcp.json 可以把元数据指向 http://attacker/
//   或者在本地网络里的一个地址 —— 元数据里包含 token_endpoint，
//   于是授权码会被 POST 到攻击者的服务器。
//
//   注释里说得很准确：schema 校验管不了这件事（URL 格式合法就行），
//   所以这里是**纵深防御**，不是重复校验。
//
//   RFC 8414 本身也要求元数据必须通过 TLS 获取，所以这不额外限制什么合法用法。
//
//   【安全校验的位置】越靠近「使用点」越可靠 ——
//   放在 schema 里会被绕过（同一个 schema 复用于别处），放在这里不会。
  if (configuredMetadataUrl) {
    if (!configuredMetadataUrl.startsWith('https://')) {
      throw new Error(
        `authServerMetadataUrl must use https:// (got: ${configuredMetadataUrl})`,
      )
    }
    const authFetch = fetchFn ?? createAuthFetch()
    const response = await authFetch(configuredMetadataUrl, {
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      return OAuthMetadataSchema.parse(await response.json())
    }
    throw new Error(
      `HTTP ${response.status} fetching configured auth server metadata from ${configuredMetadataUrl}`,
    )
  }

  try {
    const { authorizationServerMetadata } = await discoverOAuthServerInfo(
      serverUrl,
      {
        ...(fetchFn && { fetchFn }),
        ...(resourceMetadataUrl && { resourceMetadataUrl }),
      },
    )
    if (authorizationServerMetadata) {
      return authorizationServerMetadata
    }
  } catch (err) {
    // Any error from the RFC 9728 → RFC 8414 chain (5xx from the root or
    // resolved-AS probe, schema parse failure, network error) — fall through
    // to the legacy path-aware retry.
    logMCPDebug(
      serverName,
      `RFC 9728 discovery failed, falling back: ${errorMessage(err)}`,
    )
  }

// 【root URL 不做 fallback：因为 SDK 已经探过同样的端点了】
//
//   第 ③ 条路径（path-aware RFC 8414）存在的意义是「SDK 剥了 path」。
//   如果 URL 本身就没有 path（pathname === '/'），
//   那 SDK 剥不剥都一样，再探一次是纯粹的重复请求。
//
//   所以这里 return undefined 表示「没有更多信息了」，不是「失败」。
//   调用方拿到 undefined 会走「服务器不支持 OAuth」的分支。
//
//   【这类「为了兼容旧实现而加的补丁，要精确限定它生效的范围」】
//   否则每多一个老服务器，就多一次无谓的网络请求。
  // Fallback only when the URL has a path component; for root URLs the SDK's
  // own fallback already probed the same endpoints.
  const url = new URL(serverUrl)
  if (url.pathname === '/') {
    return undefined
  }
  return discoverAuthorizationServerMetadata(url, {
    ...(fetchFn && { fetchFn }),
  })
}

export class AuthenticationCancelledError extends Error {
  constructor() {
    super('Authentication was cancelled')
    this.name = 'AuthenticationCancelledError'
  }
}

// 【getServerKey：凭据的寻址方式，决定了整个凭据库的安全性】
//
//   为什么不直接用服务器名做 key？
//
//   因为名字是用户起的，会重复、会复用。考虑这个序列：
//
//     ① 用户配了 server "foo" 指向 https://a.com，登录，token 存在 "foo"
//     ② 用户把 "foo" 改成指向 https://b.com（不同服务器！）
//     ③ 如果不带 hash，a.com 的 token 会被发给 b.com
//
//   这就是**凭据跨服务器泄漏**。加了配置 hash，
//   改了 url 或 headers 就等于换了一个 key，旧 token 自然不被复用。
//
//   ── 为什么 headers 也算进 hash ──
//
//   因为 headers 常带 Authorization（第三方 API key）。
//   改了 header 就是改了「我是谁」，凭据必须失效。
//
//   注意 `headers || {}`：undefined 和 {} 必须哈希成同一个值，
//   否则「显式写空对象」和「不写」会得到两个 key，导致登录态莫名丢失。
/**
 * Generates a unique key for server credentials based on both name and config hash
 * This prevents credentials from being reused across different servers
 * with the same name or different configurations
 */
export function getServerKey(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): string {
  const configJson = jsonStringify({
    type: serverConfig.type,
    url: serverConfig.url,
    headers: serverConfig.headers || {},
  })

// 【截 16 位十六进制 = 64 bit，这是刻意的取舍】
//
//   完整 sha256 是 64 字符。keychain 的条目名有长度限制，
//   而 key 还要拼进文件名（refresh 锁，见 2096 行）。
//
//   64 bit 够不够？生日碰撞需要约 2^32 个不同配置才可能撞。
//   一个用户的 MCP 服务器数量级是 10，所以实际碰撞概率可忽略。
//
//   【截断哈希的判断标准】算一下「输入域有多大」而不是「输出有多少位」：
//   这里输入域是「用户配过的服务器配置」，上限几百，64 bit 绰绰有余。
//   如果 key 来自不可信的大空间输入（比如任意 URL），就不能这么截。
  const hash = createHash('sha256')
    .update(configJson)
    .digest('hex')
    .substring(0, 16)

  return `${serverName}|${hash}`
}

// 【三态区分：这个函数是整个认证流程的「状态机判定器」】
//
//   一个 MCP 服务器在凭据层面只有三种状态：
//
//   ① 从没探过      → 没有 entry          → 值得连一次（可能根本不需要认证）
//   ② 探过但没有 token → entry 存在、token 空 → 必然 401，直接判定 needs-auth
//   ③ 有 token      → 正常连
//
//   这个函数判的是 ②。跳过连接的理由是**省一次注定失败的往返**：
//   401 会让 transport 报错、UI 闪一下「连接失败」、然后才提示认证。
//   直接判定 needs-auth 体验好得多。
//
//   【这是「用持久化状态避免一次网络往返」的典型用法】——
//   代价是状态可能过期（服务器那边改配置了），
//   但 401 之后还能兜回来，所以是安全的优化。
/**
 * True when we have probed this server before (OAuth discovery state is
 * stored) but hold no credentials to try. A connection attempt in this
 * state is guaranteed to 401 — the only way out is the user running
 * /mcp to authenticate.
 */
export function hasMcpDiscoveryButNoToken(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): boolean {
// 【XAA 是这个判定的例外：没有 token 也可能连得上】
//
//   XAA 服务器有一个特殊能力：缓存的 id_token 可以静默换出 access_token
//   （见 1554 行那段注释）。
//
//   所以「entry 存在但没有 access/refresh token」对 XAA 来说
//   不等于「必然 401」—— 它可能在第 4 步静默换出 token 然后正常连上。
//
//   如果这里不跳过 XAA，会有一个很隐蔽的 bug：
//   用户执行 invalidateCredentials('tokens') 清掉 token 之后，
//   自动认证分支就永远走不到了（因为连接在更早的地方被拒绝）。
//
//   【通用教训】优化用的「快速判定」必须把所有例外都列进来。
//   每加一个新机制（这里是 XAA），都要回头检查所有快速路径。
  // XAA servers can silently re-auth via cached id_token even without an
  // access/refresh token — tokens() fires the xaaRefresh path. Skipping the
  // connection here would make that auto-auth branch unreachable after
  // invalidateCredentials('tokens') clears the stored tokens.
  if (isXaaEnabled() && serverConfig.oauth?.xaa) {
    return false
  }
  const serverKey = getServerKey(serverName, serverConfig)
  const entry = getSecureStorage().read()?.mcpOAuth?.[serverKey]
  return entry !== undefined && !entry.accessToken && !entry.refreshToken
}

// 【revokeToken：吊销为什么要比获取更谨慎】
//
//   获取 token 失败 → 用户重试一下就行。
//   吊销失败 → 服务器上留着一个**仍然有效**的 refresh token。
//   如果用户的机器被拷贝、或者凭据被导出，那个 token 还能继续用。
//
//   所以这里的策略是「尽力而为但不静默」：
//   所有失败都 logMCPDebug，但都不抛 —— 因为本地清除才是用户真正要的结果。
//
//   ── RFC 7009 的一个细节 ──
//
//   公共客户端（Claude Code 就是，没有 client_secret）应该把 client_id
//   放在**请求体**里，而不是 Authorization 头。
//
//   为什么？Authorization: Bearer 的语义是「我是资源所有者」，
//   而客户端认证是「我是这个应用」。混用会让服务器分不清。
//
//   但规范没说清吊销怎么做，所以有些服务器只认 Bearer —— 那是 434 行的回退。
/**
 * Revokes a single token on the OAuth server.
 *
 * Per RFC 7009, public clients (like Claude Code) should authenticate by including
 * client_id in the request body, NOT via an Authorization header. The Bearer token
 * in an Authorization header is meant for resource owner authentication, not client
 * authentication.
 *
 * However, the MCP spec doesn't explicitly define token revocation behavior, so some
 * servers may not be RFC 7009 compliant. As defensive programming, we:
 * 1. First try the RFC 7009 compliant approach (client_id in body, no Authorization header)
 * 2. If we get a 401, retry with Bearer auth as a fallback for non-compliant servers
 *
 * This fallback should rarely be needed - most servers either accept the compliant
 * approach or ignore unexpected headers.
 */
async function revokeToken({
  serverName,
  endpoint,
  token,
  tokenTypeHint,
  clientId,
  clientSecret,
  accessToken,
  authMethod = 'client_secret_basic',
}: {
  serverName: string
  endpoint: string
  token: string
  tokenTypeHint: 'access_token' | 'refresh_token'
  clientId?: string
  clientSecret?: string
  accessToken?: string
  authMethod?: 'client_secret_basic' | 'client_secret_post'
}): Promise<void> {
  const params = new URLSearchParams()
  params.set('token', token)
  params.set('token_type_hint', tokenTypeHint)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

// 【三种客户端认证方式的优先级，以及一个必须遵守的互斥规则】
//
//   有 secret 且服务器要 client_secret_post → 放 body
//   有 secret 且默认                          → Basic 头（base64(id:secret)）
//   只有 client_id                            → 放 body
//   什么也没有                                  → 只能裸发，并记一条 debug 日志
//
//   ── Basic 头里的 encodeURIComponent 不能省 ──
//
//   RFC 6749 §2.3.1 要求在 base64 之前对 id 和 secret 做 URL 编码。
//   如果 secret 里带冒号（很多生成器会带），不编码就会把
//   `id:sec:ret` 解成 id=id、secret=sec —— 认证失败且极难排查。
//
//   【这类「一行不起眼的编码」是 OAuth 实现里最常见的兼容性 bug 来源。】
  // RFC 7009 §2.1 requires client auth per RFC 6749 §2.3. XAA always uses a
  // confidential client at the AS — strict ASes (Okta/Stytch) reject public-
  // client revocation of confidential-client tokens.
  if (clientId && clientSecret) {
    if (authMethod === 'client_secret_post') {
      params.set('client_id', clientId)
      params.set('client_secret', clientSecret)
    } else {
      const basic = Buffer.from(
        `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
      ).toString('base64')
      headers.Authorization = `Basic ${basic}`
    }
  } else if (clientId) {
    params.set('client_id', clientId)
  } else {
    logMCPDebug(
      serverName,
      `No client_id available for ${tokenTypeHint} revocation - server may reject`,
    )
  }

  try {
    await axios.post(endpoint, params, { headers })
    logMCPDebug(serverName, `Successfully revoked ${tokenTypeHint}`)
  } catch (error: unknown) {
// 【401 回退：不仅要换认证方式，还要**先删掉** body 里的凭据】
//
//   这段是全文件最容易写错的地方。看 446-447 行：
//
//     params.delete('client_id')
//     params.delete('client_secret')
//
//   为什么非删不可？RFC 6749 §2.3.1 明确禁止一次请求用超过一种认证方法。
//   如果保留 body 里的 client_id 又加上 Bearer 头，
//   严格的服务器会直接 400；宽松的服务器行为不确定（可能用错身份）。
//
//   【写回退逻辑的通用检查表】
//     ① 换掉新机制需要的部分
//     ② **清掉旧机制留下的部分**（这一条最容易忘）
//     ③ 只在确实需要时回退（这里是 401 + 有 accessToken 两个条件）
//
//   注意条件里的 `&& accessToken`：没有 access token 就没法用 Bearer 回退，
//   这时候应该把原始错误抛出去，而不是发一个注定失败的请求。
    // Fallback for non-RFC-7009-compliant servers that require Bearer auth
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      accessToken
    ) {
      logMCPDebug(
        serverName,
        `Got 401, retrying ${tokenTypeHint} revocation with Bearer auth`,
      )
      // RFC 6749 §2.3.1: must not send more than one auth method. The retry
      // switches to Bearer — clear any client creds from the body.
      params.delete('client_id')
      params.delete('client_secret')
      await axios.post(endpoint, params, {
        headers: { ...headers, Authorization: `Bearer ${accessToken}` },
      })
      logMCPDebug(
        serverName,
        `Successfully revoked ${tokenTypeHint} with Bearer auth`,
      )
    } else {
      throw error
    }
  }
}

// 【吊销顺序：先 refresh 再 access，解释在注释里但值得展开】
//
//   refresh token 是长寿命的那个。留着它，攻击者能持续换出新的 access token。
//   access token 是短寿命的（通常 1 小时），过期自己就废了。
//
//   所以先断「根」，再断「枝」。
//
//   注释还提到一个实践事实：很多服务器在你吊销 refresh token 时
//   会**隐式**把关联的 access token 一起作废。
//   所以第二步经常是空转 —— 但仍然要做，因为不是所有服务器都这样。
//
//   【顺序类逻辑的判断方法】问「如果中间失败了，剩下的东西危害有多大」。
//   先做危害大的那个，失败时的暴露面最小。
/**
 * Revokes tokens on the OAuth server if a revocation endpoint is available.
 * Per RFC 7009, we revoke the refresh token first (the long-lived credential),
 * then the access token. Revoking the refresh token prevents generation of new
 * access tokens and many servers implicitly invalidate associated access tokens.
 */
export async function revokeServerTokens(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  { preserveStepUpState = false }: { preserveStepUpState?: boolean } = {},
): Promise<void> {
  const storage = getSecureStorage()
  const existingData = storage.read()
  if (!existingData?.mcpOAuth) return

  const serverKey = getServerKey(serverName, serverConfig)
  const tokenData = existingData.mcpOAuth[serverKey]

// 【三层嵌套 try，每一层都在防不同的失败】
//
//   外层（481）：元数据发现失败 → 记日志，继续往下（本地照样清）
//   中层（499）：服务器不支持吊销 → 记日志，继续往下
//   内层（525/547）：单个 token 吊销失败 → 记日志，**继续吊销另一个**
//
//   内层那个「继续」很重要：如果 refresh 吊销失败就直接 return，
//   access token 也不会被吊销 —— 白白放过一个能清掉的东西。
//
//   【best-effort 序列的正确写法】
//     每个步骤独立 try，失败只记录不中断，
//     最后统一做那个「无论如何都要做」的动作（这里是 576 行清本地）。
//
//   错误的写法是把整个序列包在一个 try 里 ——
//   第一步失败，后面全跳过。
  // Attempt server-side revocation if there are tokens to revoke (best-effort)
  if (tokenData?.accessToken || tokenData?.refreshToken) {
    try {
      // For XAA (and any PRM-discovered auth), the AS is at a different host
      // than the MCP URL — use the persisted discoveryState if we have it.
      const asUrl =
        tokenData.discoveryState?.authorizationServerUrl ?? serverConfig.url
      const metadata = await fetchAuthServerMetadata(
        serverName,
        asUrl,
        serverConfig.oauth?.authServerMetadataUrl,
      )

      if (!metadata) {
        logMCPDebug(serverName, 'No OAuth metadata found')
      } else {
        const revocationEndpoint =
          'revocation_endpoint' in metadata
            ? metadata.revocation_endpoint
            : null
        if (!revocationEndpoint) {
          logMCPDebug(serverName, 'Server does not support token revocation')
        } else {
          const revocationEndpointStr = String(revocationEndpoint)
          // RFC 7009 defines revocation_endpoint_auth_methods_supported
          // separately from the token endpoint's list; prefer it if present.
          const authMethods =
            ('revocation_endpoint_auth_methods_supported' in metadata
              ? metadata.revocation_endpoint_auth_methods_supported
              : undefined) ??
            ('token_endpoint_auth_methods_supported' in metadata
              ? metadata.token_endpoint_auth_methods_supported
              : undefined)
          const authMethod: 'client_secret_basic' | 'client_secret_post' =
            authMethods &&
            !authMethods.includes('client_secret_basic') &&
            authMethods.includes('client_secret_post')
              ? 'client_secret_post'
              : 'client_secret_basic'
          logMCPDebug(
            serverName,
            `Revoking tokens via ${revocationEndpointStr} (${authMethod})`,
          )

// 【先吊销 refresh，且用独立 try —— 见上方 479 行的说明】
//
//   一个细节：两次吊销都传了 `accessToken`（533 行、555 行），
//   这是给 revokeToken 的 401 回退用的（434 行）。
//   即使正在吊销的是 refresh token，回退时也要用 access token 去做 Bearer 认证 ——
//   因为此刻 refresh token 已经不可信了，不能拿它当认证凭据。
//
//   【凭据的「用途」和「身份」要分开看】：
//   被吊销的对象 ≠ 用来认证自己的凭据。
          // Revoke refresh token first (more important - prevents future access token generation)
          if (tokenData.refreshToken) {
            try {
              await revokeToken({
                serverName,
                endpoint: revocationEndpointStr,
                token: tokenData.refreshToken,
                tokenTypeHint: 'refresh_token',
                clientId: tokenData.clientId,
                clientSecret: tokenData.clientSecret,
                accessToken: tokenData.accessToken,
                authMethod,
              })
            } catch (error: unknown) {
              // Log but continue
              logMCPDebug(
                serverName,
                `Failed to revoke refresh token: ${errorMessage(error)}`,
              )
            }
          }

          // Then revoke access token (may already be invalidated by refresh token revocation)
          if (tokenData.accessToken) {
            try {
              await revokeToken({
                serverName,
                endpoint: revocationEndpointStr,
                token: tokenData.accessToken,
                tokenTypeHint: 'access_token',
                clientId: tokenData.clientId,
                clientSecret: tokenData.clientSecret,
                accessToken: tokenData.accessToken,
                authMethod,
              })
            } catch (error: unknown) {
              logMCPDebug(
                serverName,
                `Failed to revoke access token: ${errorMessage(error)}`,
              )
            }
          }
        }
      }
    } catch (error: unknown) {
      // Log error but don't throw - revocation is best-effort
      logMCPDebug(serverName, `Failed to revoke tokens: ${errorMessage(error)}`)
    }
  } else {
    logMCPDebug(serverName, 'No tokens to revoke')
  }

// 【无论服务器端结果如何，本地一律清掉】
//
//   这是这个函数真正的契约。上面那一大段网络操作全是「尽力」，
//   这一行才是「保证」。
//
//   为什么本地清除必须无条件做？
//   因为用户的意图是「我要取消这个服务器的授权」。
//   如果因为服务器不可达就保留本地 token，用户会看到
//   「点了清除，但还显示已连接」—— 那是个更糟的状态。
//
//   ── 顺序上有个容易写反的地方 ──
//
//   本地清除会删掉整个 entry，包括 discoveryState 和 stepUpScope。
//   而 581 行之后的条件分支需要这两个值。
//   所以必须先读（477 行 tokenData）、再清（576）、再按需写回（615）。
//
//   【这是「读-删-按需写回」模式】：删除是主体行为，
//   保留是例外行为，所以例外部分要靠前面缓存的副本重建。
  // Always clear local tokens, regardless of server-side revocation result.
  clearServerTokensFromLocalStorage(serverName, serverConfig)

// 【两种吊销语义：Clear Auth 与 Re-authenticate】
//
//   preserveStepUpState = false（默认，"Clear Auth"）
//     → 全清。连 discoveryState 一起没。下次认证要从零做 RFC 9728 发现。
//
//   preserveStepUpState = true（重新认证场景）
//     → 保留 stepUpScope 和 discoveryState，下次认证不用再探一遍服务器。
//
//   ── 为什么保留时要把 discoveryState 拆开重写 ──
//
//   看 604-609 行：只保留 authorizationServerUrl 和 resourceMetadataUrl，
//   把 resourceMetadata / authorizationServerMetadata 两个大块**丢掉**。
//
//   原因在 2007 行有完整解释：macOS keychain 写入走 `security -i`，
//   stdin 有 4096 字节行限制，完整元数据会让它溢出并损坏凭据库（#30337）。
//
//   所以这里是「顺手做一次历史数据清理」：
//   老版本存进去的膨胀 blob，在下次重新认证时被缩回两个 URL。
//
//   【迁移策略】不要写一次性迁移脚本，而是在**每次写这个条目的地方**
//   都写成新形状。用户下次走到这条路径就自愈了。
  // When re-authenticating, preserve step-up auth state (scope + discovery)
  // so the next performMCPOAuthFlow can use cached scope instead of
  // re-probing. For "Clear Auth" (default), wipe everything.
  if (
    preserveStepUpState &&
    tokenData &&
    (tokenData.stepUpScope || tokenData.discoveryState)
  ) {
    const freshData = storage.read() || {}
    const updatedData: SecureStorageData = {
      ...freshData,
      mcpOAuth: {
        ...freshData.mcpOAuth,
        [serverKey]: {
          ...freshData.mcpOAuth?.[serverKey],
          serverName,
          serverUrl: serverConfig.url,
          accessToken: freshData.mcpOAuth?.[serverKey]?.accessToken ?? '',
          expiresAt: freshData.mcpOAuth?.[serverKey]?.expiresAt ?? 0,
          ...(tokenData.stepUpScope
            ? { stepUpScope: tokenData.stepUpScope }
            : {}),
          ...(tokenData.discoveryState
            ? {
                // Strip legacy bulky metadata fields here too so users with
                // existing overflowed blobs recover on next re-auth (#30337).
                discoveryState: {
                  authorizationServerUrl:
                    tokenData.discoveryState.authorizationServerUrl,
                  resourceMetadataUrl:
                    tokenData.discoveryState.resourceMetadataUrl,
                },
              }
            : {}),
        },
      },
    }
    storage.update(updatedData)
    logMCPDebug(serverName, 'Preserved step-up auth state across revocation')
  }
}

export function clearServerTokensFromLocalStorage(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): void {
  const storage = getSecureStorage()
  const existingData = storage.read()
  if (!existingData?.mcpOAuth) return

  const serverKey = getServerKey(serverName, serverConfig)
  if (existingData.mcpOAuth[serverKey]) {
    delete existingData.mcpOAuth[serverKey]
    storage.update(existingData)
    logMCPDebug(serverName, 'Cleared stored tokens')
  }
}

// 【这两个字段都是从 401 响应头里「捡」来的】
//
//   理想情况下，一次 OAuth 流程用配置里的 scope 就够了。
//   但 MCP 有个「step-up」（渐进提权）场景：
//
//     用基础 scope 连上了 → 调用某个工具 → 服务器返回 403 +
//     WWW-Authenticate: Bearer scope="files:write", error="insufficient_scope"
//
//   这时正确的行为是「再走一次授权，但这次带上更大的 scope」，
//   而不是「用 refresh token 刷一下」—— 后者被 RFC 6749 §6 明文禁止。
//
//   这两个参数就是那次 403 里带回来的信息，缓存起来给下一轮用。
//
//   注意命名：WWWAuthenticate 拼写跟 HTTP 头一致（没有连字符），
//   这样 grep 头名和 grep 类型名能对上。
type WWWAuthenticateParams = {
  scope?: string
  resourceMetadataUrl?: URL
}

type XaaFailureStage =
  | 'idp_login'
  | 'discovery'
  | 'token_exchange'
  | 'jwt_bearer'

// 【XAA = Cross-App Access，企业 SSO 场景的一条捷径】
//
//   标准 consent 流程的问题：**每个 MCP 服务器都要弹一次浏览器**。
//   一家公司接 8 个内部 MCP 服务，员工要登录 8 次。
//
//   XAA 把「人」和「应用」解耦：
//
//     ① 用户在企业 IdP（Okta / Azure AD）登录**一次**
//        → 拿到 id_token，按 issuer 缓存在 keychain
//     ② 对每个 MCP 服务器，用 id_token 走 RFC 8693（token exchange）
//        换出该服务器所属 AS 的 access_token
//     ③ token 存进和普通 OAuth **同一个** keychain 槽位
//
//   第 ③ 步是关键设计：下游代码（client.ts 的 transport 组装）
//   完全不需要知道这个 token 是 XAA 换来的还是浏览器点出来的。
//
//   ── "No silent fallback" 这条约束 ──
//
//   如果 oauth.xaa 设了但 XAA 不可用，**不能**悄悄退回 consent 流程。
//   两个理由（注释里只写了第一个，第二个在 864 行展开）：
//     · 用户显式要求了 XAA，静默降级是意外行为
//     · 两种流程的信任前提不同（consent 走的是服务器自己的授权页，
//       XAA 走的是企业 IdP 的策略）—— 降级相当于绕过了企业策略
/**
 * XAA (Cross-App Access) auth.
 *
 * One IdP browser login is reused across all XAA-configured MCP servers:
 * 1. Acquire an id_token from the IdP (cached in keychain by issuer; if
 *    missing/expired, runs a standard OIDC authorization_code+PKCE flow
 *    — this is the one browser pop)
 * 2. Run the RFC 8693 + RFC 7523 exchange (no browser)
 * 3. Save tokens to the same keychain slot as normal OAuth
 *
 * IdP connection details come from settings.xaaIdp (configured once via
 * `claude mcp xaa setup`). Per-server config is just `oauth.xaa: true`
 * plus the AS clientId/clientSecret.
 *
 * No silent fallback: if `oauth.xaa` is set, XAA is the only path.
 * All errors are actionable — they tell the user what to run.
 */
async function performMCPXaaAuth(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  onAuthorizationUrl: (url: string) => void,
  abortSignal?: AbortSignal,
  skipBrowserOpen?: boolean,
): Promise<void> {
  if (!serverConfig.oauth?.xaa) {
    throw new Error('XAA: oauth.xaa must be set') // guarded by caller
  }

// 【配置的两级：IdP 是用户级，AS 是服务器级】
//
//   IdP 连接信息（issuer / clientId / clientSecret / 回调端口）
//   来自 settings.xaaIdp —— 全局一份，一次 `claude mcp xaa setup` 配好。
//
//   AS 的 clientId / clientSecret 是每个 MCP 服务器各自的
//   （在 .mcp.json 的 oauth 字段里）。
//
//   为什么这么分？因为这是两个不同的信任域：
//     IdP 认的是「这家公司的人」
//     AS  认的是「这个应用能访问哪些资源」
//
//   所以两边的密钥存在不同的 keychain 槽位（见 715 行），
//   泄露一个不会连带泄露另一个。
  // IdP config comes from user-level settings, not per-server.
  const idp = getXaaIdpSettings()
  if (!idp) {
    throw new Error(
      "XAA: no IdP connection configured. Run 'claude mcp xaa setup --issuer <url> --client-id <id> --client-secret' to configure.",
    )
  }

  const clientId = serverConfig.oauth?.clientId
  if (!clientId) {
    throw new Error(
      `XAA: server '${serverName}' needs an AS client_id. Re-add with --client-id.`,
    )
  }

// 【clientSecret 存在另一个 map 里，不在 token entry 里】
//
//   `getMcpClientConfig` 读的是 `mcpOAuthClientConfig`，
//   而 token 存在 `mcpOAuth`。两个独立的顶层 key（见 2399 行）。
//
//   为什么分开？因为 token 会被反复清：
//     · invalidateCredentials('tokens')  刷失败时清
//     · revokeServerTokens               用户点清除时清
//   clientSecret 是**长期配置**，不该跟着 token 一起掉。
//
//   混在一起写的后果：一次刷新失败把 client secret 也删了，
//   用户重登时得重新输入密钥 —— 而他根本没做错什么。
//
//   【存储设计原则】按「生命周期」分组，而不是按「属于哪个实体」分组。
  const clientConfig = getMcpClientConfig(serverName, serverConfig)
  const clientSecret = clientConfig?.clientSecret
  if (!clientSecret) {
// 【诊断信息只在错误路径上算 —— 这是性能敏感的写法】
//
//   `getServerKey` 要序列化配置 + 算 sha256；
//   `Object.entries(serverConfig.headers)` 要遍历。
//   在成功路径上做这些是纯浪费 —— XAA 认证每次连接都会走一遍。
//
//   ── 这段诊断具体在查什么 bug ──
//
//   日志会打印 `wanted=<算出来的 key>` 和 `have=[keychain 里已有的 key]`。
//   两者不一致就说明「写的时候用的配置」和「读的时候用的配置」不同 ——
//   最常见的原因是用户改了 url 或 headers 里的一个字符。
//
//   没有这行日志，症状是「密钥明明存在，但一直说找不到」，
//   排查起来要手工复算哈希。
//
//   ── headers 里的 authorization 要打码 ──
//
//   699-703 行把 Authorization 头换成 [REDACTED]。
//   注意是大小写不敏感的比较（`k.toLowerCase()`）——
//   HTTP 头名大小写不敏感，用 === 会比漏。
    // Diagnostic context for serverKey mismatch debugging. Only computed
    // on the error path so there's no perf cost on success.
    const wantedKey = getServerKey(serverName, serverConfig)
    const haveKeys = Object.keys(
      getSecureStorage().read()?.mcpOAuthClientConfig ?? {},
    )
    const headersForLogging = Object.fromEntries(
      Object.entries(serverConfig.headers ?? {}).map(([k, v]) =>
        k.toLowerCase() === 'authorization' ? [k, '[REDACTED]'] : [k, v],
      ),
    )
    logMCPDebug(
      serverName,
      `XAA: secret lookup miss. wanted=${wantedKey} have=[${haveKeys.join(', ')}] configHeaders=${jsonStringify(headersForLogging)}`,
    )
    throw new Error(
      `XAA: AS client secret not found for '${serverName}'. Re-add with --client-secret.`,
    )
  }

  logMCPDebug(serverName, 'XAA: starting cross-app access flow')

// 【IdP 密钥和 AS 密钥分槽存放：不同的信任域】
//
//   同一台机器上，如果 IdP 密钥和 AS 密钥存在一起，
//   一次凭据库泄漏就同时丢掉「企业身份」和「应用身份」。
//   分开存，攻击者至少要多拿一份。
//
//   `idpClientSecret` 可以是 undefined —— 注释说 "Optional: if absent, PKCE-only"。
//   也就是说 IdP 支持公共客户端注册时不需要密钥，只靠 PKCE 就够。
//
//   【这不是「可选的优化」，是部署灵活性】：
//   有些企业 IdP 不允许创建 confidential client（拿不到 secret），
//   硬要求 secret 就等于不支持那些 IdP。
  // IdP client secret lives in a separate keychain slot (keyed by IdP issuer),
  // NOT the AS secret — different trust domain. Optional: if absent, PKCE-only.
  const idpClientSecret = getIdpClientSecret(idp.issuer)

// 【先偷看一眼缓存，只为了遥测准确】
//
//   722 行这个 `getCachedIdpIdToken(...) !== undefined` 纯粹是为了
//   在下面 logEvent 时能报出 `idTokenCacheHit: true/false`。
//
//   为什么不能等函数返回后再判断？因为 `acquireIdpIdToken` 会**写缓存**。
//   调用完之后再查，永远是 true —— 指标就废了。
//
//   【埋点的一个常见陷阱】读「事后状态」来推断「事前状态」。
//   必须在动作发生**之前**采样。
//
//   这也解释了为什么这行代码看起来多余：它的唯一作用就是采样时机。
  // Acquire id_token (cached or via one OIDC browser pop at the IdP).
  // Peek the cache first so we can report idTokenCacheHit in analytics before
  // acquireIdpIdToken potentially writes a fresh one.
  const idTokenCacheHit = getCachedIdpIdToken(idp.issuer) !== undefined

// 【用一个游标变量做失败归因，边走边标】
//
//   `failureStage` 初始 'idp_login'，每进入一个阶段就改写它。
//   catch 里直接读，不需要再判断「错误是在哪一步抛的」。
//
//   为什么不用嵌套 try 或者错误类型来区分？
//   因为下面调用的三个函数抛的是**同一种** Error（普通 Error 或
//   XaaTokenExchangeError），没有可供 switch 的类型信息。
//
//   游标写法的前提：阶段是**线性推进**的，不会回退。
//   这个流程正好满足（login → discovery → exchange）。
//
//   【如果阶段是分支/循环的，游标就不够用了，得用显式的 phase 枚举 + 状态机。】
  let failureStage: XaaFailureStage = 'idp_login'
  try {
    let idToken
    try {
      idToken = await acquireIdpIdToken({
        idpIssuer: idp.issuer,
        idpClientId: idp.clientId,
        idpClientSecret,
        callbackPort: idp.callbackPort,
        onAuthorizationUrl,
        skipBrowserOpen,
        abortSignal,
      })
    } catch (e) {
      if (abortSignal?.aborted) throw new AuthenticationCancelledError()
      throw e
    }

// 【为什么要单独做一次 OIDC 发现】
//
//   XAA 的第二步是 RFC 8693 token exchange：拿 IdP 的 id_token
//   去换 AS 的 access_token。这个交换发生在 **IdP 的 token 端点**上，
//   而那个 URL 只有 IdP 的 OIDC 元数据里才有。
//
//   注意 `performCrossAppAccess` 内部还会做一次 AS 侧发现（PRM + AS metadata），
//   所以这个流程里其实有**两次**发现，打的是两个不同的服务器。
//   790 行那段注释就是在区分这两次发现失败该归到哪个 stage。
    // Discover the IdP's token endpoint for the RFC 8693 exchange.
    failureStage = 'discovery'
    const oidc = await discoverOidc(idp.issuer)

    // Run the exchange. performCrossAppAccess throws XaaTokenExchangeError
    // for the IdP leg and "jwt-bearer grant failed" for the AS leg.
    failureStage = 'token_exchange'
    let tokens
    try {
      tokens = await performCrossAppAccess(
        serverConfig.url,
        {
          clientId,
          clientSecret,
          idpClientId: idp.clientId,
          idpClientSecret,
          idpIdToken: idToken,
          idpTokenEndpoint: oidc.token_endpoint,
        },
        serverName,
        abortSignal,
      )
    } catch (e) {
      if (abortSignal?.aborted) throw new AuthenticationCancelledError()
// 【错误归因：结构化优先，字符串匹配兜底】
//
//   理想做法：每种失败有自己的错误类型，catch 里 instanceof 分派。
//   现实：`performCrossAppAccess` 内部会抛三类东西
//     · XaaTokenExchangeError（IdP 腿，带 shouldClearIdToken）
//     · 普通 Error，message 里带 "jwt-bearer grant failed"（AS 腿）
//     · discovery 阶段的 Error，message 是各种前缀
//
//   所以这里的策略是分层的：
//     ① 有结构化信息的（XaaTokenExchangeError）→ 用字段判断
//     ② 没有的 → 用 message 前缀匹配，尽量猜准 stage
//
//   ── shouldClearIdToken 为什么用 OAuth 语义而不是字符串 ──
//
//   767-770 行说得很清楚：4xx / 响应体不合法 → 清 id_token（它是坏的）；
//   5xx → 保留（IdP 挂了，不是 token 的问题）。
//   如果这里用 "invalid" 之类的字符串匹配，5xx 的报错文案一变就会误清，
//   用户下次得重新走一遍浏览器登录。
//
//   【「清缓存」这个动作的门槛要高】宁可让用户多点一次重试，
//   也不要在服务器故障时把本地还算好的凭据毁掉。
      const msg = errorMessage(e)
      // If the IdP says the id_token is bad, drop it from the cache so the
      // next attempt does a fresh IdP login. XaaTokenExchangeError carries
      // shouldClearIdToken so we key off OAuth semantics (4xx / invalid body
      // → clear; 5xx IdP outage → preserve) rather than substring matching.
      if (e instanceof XaaTokenExchangeError) {
        if (e.shouldClearIdToken) {
          clearIdpIdToken(idp.issuer)
          logMCPDebug(
            serverName,
            'XAA: cleared cached id_token after token-exchange failure',
          )
        }
      } else if (
        msg.includes('PRM discovery failed') ||
        msg.includes('AS metadata discovery failed') ||
        msg.includes('no authorization server supports jwt-bearer')
      ) {
        // performCrossAppAccess runs PRM + AS discovery before the actual
        // exchange — don't attribute their failures to 'token_exchange'.
        failureStage = 'discovery'
      } else if (msg.includes('jwt-bearer')) {
        failureStage = 'jwt_bearer'
      }
      throw e
    }

// 【为什么不复用 provider.saveTokens，而是手写一遍 storage 写入】
//
//   理由是成本：为了写四个字段，要 new 一个 ClaudeAuthProvider
//   （它需要 redirectUri、回调函数等一堆构造参数）。
//   而这里已经在 XAA 流程里，根本不需要 provider 的其它能力。
//
//   ── 但手写带来了一个隐性的重复 ──
//
//   这段写入和 saveTokens（1704 行）、xaaRefresh 里的写入（1813 行）
//   是**三份几乎一样的逻辑**，都往 mcpOAuth[serverKey] 写同一组字段。
//
//   风险：加字段时容易只改一处。事实上 1804-1808 行那段注释
//   就在解释「为什么 xaaRefresh 不能走 saveTokens」——
//   因为 saveTokens 只 spread 已有数据，不会补 clientId。
//
//   【三份重复实现是技术债。抽成一个 `writeTokenEntry(serverKey, patch)`
//     会让这三处都变短，但那是重构，改动面大，注释先记录现状。】
    // Save tokens via the same storage path as normal OAuth. We write directly
    // (instead of ClaudeAuthProvider.saveTokens) to avoid instantiating the
    // whole provider just to write the same keys.
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(serverName, serverConfig)
    const prev = existingData.mcpOAuth?.[serverKey]
    storage.update({
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...prev,
          serverName,
          serverUrl: serverConfig.url,
          accessToken: tokens.access_token,
// 【refresh_token 用 `?? prev?.refreshToken` 而不是直接赋值】
//
//   因为 AS 可能不给 refresh token。
//   在 jwt-bearer 授权模式（RFC 7523）里，refresh token 是可选的 ——
//   设计上就是「每次都能用 id_token 重新换一个」，不需要长期凭据。
//
//   如果这里直接写 `refreshToken: tokens.refresh_token`，
//   那些本来有 refresh token 的服务器，在一次「AS 没返回」的响应之后
//   token 就丢了 —— 下次不会再尝试普通刷新路径，
//   而是每次都走 4 个请求的 XAA 链。功能没坏，但慢了三倍。
//
//   【合并策略】局部更新时，undefined 应该被理解为「这次没有」，
//   而不是「改成没有」。只有显式的 null 才表示清除。
          // AS may omit refresh_token on jwt-bearer — preserve any existing one
          refreshToken: tokens.refresh_token ?? prev?.refreshToken,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          scope: tokens.scope,
          clientId,
          clientSecret,
          // Persist the AS URL so _doRefresh and revokeServerTokens can locate
          // the token/revocation endpoints when MCP URL ≠ AS URL (the common
          // XAA topology).
          discoveryState: {
            authorizationServerUrl: tokens.authorizationServerUrl,
          },
        },
      },
    })

    logMCPDebug(serverName, 'XAA: tokens saved')
// 【成功埋点放在 try 里，失败埋点放在 catch 里 —— 但都只在最外层】
//
//   注意这个函数的埋点结构和 performMCPOAuthFlow 不同：
//   它在**内层**上报 success，在**外层** catch 上报 failure。
//
//   为什么内层 catch（737、764）不上报？
//   因为那些 catch 只是做「转换」（abort → AuthenticationCancelledError，
//   或者修正 failureStage），错误还会继续往外抛，
//   最外层会统一上报一次。如果每层都报，一个失败会被计数三次。
    logEvent('tengu_mcp_oauth_flow_success', {
      authMethod:
        'xaa' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      idTokenCacheHit,
    })
  } catch (e) {
    // User-initiated cancel (Esc during IdP browser pop) isn't a failure.
    if (e instanceof AuthenticationCancelledError) {
      throw e
    }
    logEvent('tengu_mcp_oauth_flow_failure', {
      authMethod:
        'xaa' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      xaaFailureStage:
        failureStage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      idTokenCacheHit,
    })
    throw e
  }
}

// 【performMCPOAuthFlow：所有认证路径的唯一入口】
//
//   调用它的地方（client.ts + UI 层）不需要知道 XAA 的存在 ——
//   判断在函数内部第一屏就做完了（871 行）。
//
//   签名里的五个参数值得逐个看：
//
//     serverName / serverConfig   要认证谁
//     onAuthorizationUrl          「拿到授权 URL 了」——给 UI 展示、给用户复制
//     abortSignal                 用户按 Esc 取消
//     options.skipBrowserOpen     环境里不能开浏览器（SSH、容器）
//     options.onWaitingForCallback 环境里 localhost 不可达（远程开发），
//                                 需要用户手工粘贴回调 URL
//
//   后两个参数合起来说明一件事：**这个函数必须能在没有浏览器、
//   没有可达 localhost 的环境里工作**。这不是边缘场景，
//   是 CLI 工具的常见部署形态。
export async function performMCPOAuthFlow(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  onAuthorizationUrl: (url: string) => void,
  abortSignal?: AbortSignal,
  options?: {
    skipBrowserOpen?: boolean
    onWaitingForCallback?: (submit: (callbackUrl: string) => void) => void
  },
): Promise<void> {
// 【XAA 分支：三条必须硬失败的理由】
//
//   ① 用户显式要求（.mcp.json 里写了 oauth.xaa）
//      → 静默降级成 consent 是意外行为
//
//   ② 信任前提不同
//      → consent 流程信任「这个 MCP 服务器自己的授权页」，
//        XAA 信任「企业的 IdP 策略」。降级等于绕过企业策略
//
//   ③ 排查成本
//      → 如果静默降级，用户看到的是「能连上」，
//        但他以为自己在用 SSO，实际用的是个人授权。这种偏差很难发现
//
//   所以 872 行那个 if 抛的是**指路式错误**：
//   告诉用户设哪个环境变量，或者改哪个配置字段。
//
//   【错误文案的标准】用户读完应该知道下一步做什么。
//   "XAA not available" 是坏文案，
//   "set CLAUDE_CODE_ENABLE_XAA=1, or remove 'oauth.xaa' from server 'foo'" 是好文案。
  // XAA (SEP-990): if configured, bypass the per-server consent dance.
  // If the IdP id_token isn't cached, this pops the browser once at the IdP
  // (shared across all XAA servers for that issuer). Subsequent servers hit
  // the cache and are silent. Tokens land in the same keychain slot, so the
  // rest of CC's transport wiring (ClaudeAuthProvider.tokens() in client.ts)
  // works unchanged.
  //
  // No silent fallback: if `oauth.xaa` is set, XAA is the only path. We
  // never fall through to the consent flow — that would be surprising (the
  // user explicitly asked for XAA) and security-relevant (consent flow may
  // have a different trust/scope posture than the org's IdP policy).
  //
  // Servers with `oauth.xaa` but CLAUDE_CODE_ENABLE_XAA unset hard-fail with
  // actionable copy rather than silently degrade to consent.
  if (serverConfig.oauth?.xaa) {
    if (!isXaaEnabled()) {
      throw new Error(
        `XAA is not enabled (set CLAUDE_CODE_ENABLE_XAA=1). Remove 'oauth.xaa' from server '${serverName}' to use the standard consent flow.`,
      )
    }
    logEvent('tengu_mcp_oauth_flow_start', {
      isOAuthFlow: true,
      authMethod:
        'xaa' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transportType:
        serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(getLoggingSafeMcpBaseUrl(serverConfig)
        ? {
            mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
              serverConfig,
            ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    })
    // performMCPXaaAuth logs its own success/failure events (with
    // idTokenCacheHit + xaaFailureStage).
    await performMCPXaaAuth(
      serverName,
      serverConfig,
      onAuthorizationUrl,
      abortSignal,
      options?.skipBrowserOpen,
    )
    return
  }

// 【先读缓存，再清库 —— 顺序写反就白干】
//
//   916 行的 clearServerTokensFromLocalStorage 会删掉整个 entry，
//   包括 discoveryState（含 resourceMetadataUrl）和 stepUpScope。
//
//   而这两个值正是接下来要用（922、933 行）的。
//   所以必须先读到局部变量里（908-911），再删。
//
//   ── 为什么要清库 —— 这一行看着很粗暴 ──
//
//   注释说 "to ensure fresh client registration"。
//   场景：服务器的 AS 换了实现（或者用户换了部署），
//   旧的 client_id 在服务器上已经不存在了。
//   如果不清，SDK 会一直用旧 client_id 去请求，得到 invalid_client，
//   然后…… 依赖 1305 行那个自愈分支才清。
//
//   主动清掉重做 DCR（动态客户端注册）更省事：
//   反正只需要一次 POST，而得一个干净的 client_id 更重要。
//
//   【代价】每次重新认证都会重新注册一个客户端。
//   对服务器来说这是垃圾数据累积，所以这个策略只用在「用户主动重新认证」路径上。
  // Check for cached step-up scope and resource metadata URL before clearing
  // tokens. The transport-attached auth provider persists scope when it receives
  // a step-up 401, so we can use it here instead of making an extra probe request.
  const storage = getSecureStorage()
  const serverKey = getServerKey(serverName, serverConfig)
  const cachedEntry = storage.read()?.mcpOAuth?.[serverKey]
  const cachedStepUpScope = cachedEntry?.stepUpScope
  const cachedResourceMetadataUrl =
    cachedEntry?.discoveryState?.resourceMetadataUrl

  // Clear any existing stored credentials to ensure fresh client registration.
  // Note: this deletes the entire entry (including discoveryState/stepUpScope),
  // but we already read the cached values above.
  clearServerTokensFromLocalStorage(serverName, serverConfig)

  // Use cached step-up scope and resource metadata URL if available.
  // The transport-attached auth provider caches these when it receives a
  // step-up 401, so we don't need to probe the server again.
  let resourceMetadataUrl: URL | undefined
  if (cachedResourceMetadataUrl) {
    try {
      resourceMetadataUrl = new URL(cachedResourceMetadataUrl)
    } catch {
      logMCPDebug(
        serverName,
        `Invalid cached resourceMetadataUrl: ${cachedResourceMetadataUrl}`,
      )
    }
  }
  const wwwAuthParams: WWWAuthenticateParams = {
    scope: cachedStepUpScope,
    resourceMetadataUrl,
  }

  const flowAttemptId = randomUUID()

  logEvent('tengu_mcp_oauth_flow_start', {
    flowAttemptId:
      flowAttemptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    isOAuthFlow: true,
    transportType:
      serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(getLoggingSafeMcpBaseUrl(serverConfig)
      ? {
          mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
            serverConfig,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
  })

  // Track whether we reached the token-exchange phase so the catch block can
  // attribute the failure reason correctly.
  let authorizationCodeObtained = false

  try {
    // Use configured callback port for pre-configured OAuth, otherwise find an available port
    const configuredCallbackPort = serverConfig.oauth?.callbackPort
    const port = configuredCallbackPort ?? (await findAvailablePort())
    const redirectUri = buildRedirectUri(port)
    logMCPDebug(
      serverName,
      `Using redirect port: ${port}${configuredCallbackPort ? ' (from config)' : ''}`,
    )

    const provider = new ClaudeAuthProvider(
      serverName,
      serverConfig,
      redirectUri,
      true,
      onAuthorizationUrl,
      options?.skipBrowserOpen,
    )

    // Fetch and store OAuth metadata for scope information
    try {
      const metadata = await fetchAuthServerMetadata(
        serverName,
        serverConfig.url,
        serverConfig.oauth?.authServerMetadataUrl,
        undefined,
        wwwAuthParams.resourceMetadataUrl,
      )
      if (metadata) {
        // Store metadata in provider for scope information
        provider.setMetadata(metadata)
        logMCPDebug(
          serverName,
          `Fetched OAuth metadata with scope: ${getScopeFromMetadata(metadata) || 'NONE'}`,
        )
      }
    } catch (error) {
      logMCPDebug(
        serverName,
        `Failed to fetch OAuth metadata: ${errorMessage(error)}`,
      )
    }

    // Get the OAuth state from the provider for validation
    const oauthState = await provider.state()

// 【为什么 cleanup 要持有三个外部引用】
//
//   这个 Promise 有**五个**独立的结束途径：
//     ① 回调服务器收到 code
//     ② 回调服务器收到 error
//     ③ 用户手工粘贴了 URL
//     ④ abortSignal 触发（按 Esc）
//     ⑤ 5 分钟超时
//     ⑥ 端口监听失败（EADDRINUSE）
//
//   每一条都要做同一套清理：关服务器、清定时器、摘 abort listener。
//   所以把资源引用提到闭包外层（1005-1007），让 cleanup 能都碰到。
//
//   【如果把这些引用留在各自的闭包里，五条路径就得写五份清理逻辑，
//     必然漏。提成外层变量 + 一个 cleanup 是唯一可靠的做法。】
    // Store the server, timeout, and abort listener references for cleanup
    let server: Server | null = null
    let timeoutId: NodeJS.Timeout | null = null
    let abortHandler: (() => void) | null = null

// 【removeAllListeners 之后必须补一个空 error handler】
//
//   1012-1013 行这两句是全文件最不显眼、却最容易踩的 Node 坑：
//
//     server.removeAllListeners()
//     server.on('error', () => {})   // 故意吞掉
//
//   为什么？因为 `close()` 是异步的。在 close 完成之前，
//   服务器对象上任何迟到的 error 事件（连接被对端重置、
//   EMFILE 之类）会变成 **uncaught exception**，直接杀掉进程。
//
//   而 removeAllListeners 正好把 1153 行那个 error handler 也摘掉了 ——
//   于是本来被妥善处理的错误，变成了进程崩溃。
//
//   【Node 服务端收尾的标准套件】
//     ① removeAllListeners()
//     ② 补一个吞异常的 error handler
//     ③ close()
//   少第 ② 步，偶发崩溃，且崩溃栈指向莫名其妙的地方。
    const cleanup = () => {
      if (server) {
        server.removeAllListeners()
        // Defensive: removeAllListeners() strips the error handler, so swallow any late error during close
        server.on('error', () => {})
        server.close()
        server = null
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener('abort', abortHandler)
        abortHandler = null
      }
      logMCPDebug(serverName, `MCP OAuth server cleaned up`)
    }

    // Setup a server to receive the callback
// 【resolveOnce / rejectOnce 的幂等性：这个 Promise 有六个出口】
//
//   原生 Promise 的 resolve/reject 第二次调用是静默无效的。
//   听起来无害，但在这里会掩盖 bug：
//
//     超时先触发 → reject(Timeout)
//     两秒后回调到达 → resolve(code)  ← 静默无效，但代码以为成功了
//
//   于是流程继续往下走（1216 行之后），用一个「其实已经超时」的结果
//   去换 token，用户看到的是一个莫名其妙的错误。
//
//   加了 `resolved` 标志位后，第二个出口直接 return，
//   行为变得确定：**先到的那个赢，后面的全部无视**。
//
//   【凡是「多个异步源竞争同一个 Promise」的地方，都需要这个守卫。】
    const authorizationCode = await new Promise<string>((resolve, reject) => {
      let resolved = false
      const resolveOnce = (code: string) => {
        if (resolved) return
        resolved = true
        resolve(code)
      }
      const rejectOnce = (error: Error) => {
        if (resolved) return
        resolved = true
        reject(error)
      }

// 【abort 走同一条幂等出口，还要处理「已经 abort 了」的情况】
//
//   1047-1050 行：
//     if (abortSignal.aborted) { abortHandler(); return }
//
//   为什么需要这个检查？因为 `addEventListener('abort', ...)`
//   **不会**为已经发生的 abort 补发事件（AbortSignal 不重放历史）。
//
//   场景：用户在上一个界面按了 Esc，signal 已经 aborted，
//   然后 UI 又发起了一次认证（带着同一个 signal）。
//   不检查的话会一直等到 5 分钟超时。
//
//   【记住这个模式】订阅之前先查当前状态 —— 所有「事件 + 可能已发生」
//   的场景都适用（另一个例子是 223 行的 signal 合并）。
      if (abortSignal) {
        abortHandler = () => {
          cleanup()
          rejectOnce(new AuthenticationCancelledError())
        }
        if (abortSignal.aborted) {
          abortHandler()
          return
        }
        abortSignal.addEventListener('abort', abortHandler)
      }

// 【手工粘贴回调 URL：为远程开发环境准备的第三条路】
//
//   标准流程假设：浏览器和 CLI 在同一台机器上，
//   127.0.0.1:PORT 两边都能访问。
//
//   远程开发（SSH 到服务器、VS Code Remote、Codespaces、容器）打破了假设：
//   浏览器在本地，回调打到本地 127.0.0.1 上，服务器上的监听器收不到。
//
//   所以这里允许 UI 把 URL 念给用户，用户手工粘回来。
//   1093 行的空 catch 是刻意的：粘贴错了不报错，
//   让用户可以重试（报错会关闭整个表单）。
//
//   ── 注意这里同样校验 state ──
//
//   手工输入路径是**用户可控输入**，比网络回调更容易被社工。
//   1079 行的 state 比对不能省。
//
//   【判断「哪条输入路径更危险」的方法】哪条路上有「人」参与，
//   哪条路就要做更严格的校验 —— 人会复制粘贴钓鱼链接。
      // Allow manual callback URL paste for remote/browser-based environments
      // where localhost is not reachable from the user's browser.
      if (options?.onWaitingForCallback) {
        options.onWaitingForCallback((callbackUrl: string) => {
          try {
            const parsed = new URL(callbackUrl)
            const code = parsed.searchParams.get('code')
            const state = parsed.searchParams.get('state')
            const error = parsed.searchParams.get('error')

            if (error) {
              const errorDescription =
                parsed.searchParams.get('error_description') || ''
              cleanup()
              rejectOnce(
                new Error(`OAuth error: ${error} - ${errorDescription}`),
              )
              return
            }

            if (!code) {
              // Not a valid callback URL, ignore so the user can try again
              return
            }

            if (state !== oauthState) {
              cleanup()
              rejectOnce(
                new Error('OAuth state mismatch - possible CSRF attack'),
              )
              return
            }

            logMCPDebug(
              serverName,
              `Received auth code via manual callback URL`,
            )
            cleanup()
            resolveOnce(code)
          } catch {
            // Invalid URL, ignore so the user can try again
          }
        })
      }

// 【回调服务器的三个响应分支，注意它们都用 HTTP 200】
//
//   1111 行（state 不匹配）用 400，1121 和 1143 用 200。
//
//   为什么错误也用 200？因为**这个页面是给人看的，不是给程序看的**。
//   HTTP 状态码影响的是程序行为，而浏览器展示的是 body。
//   用 400 的唯一效果是某些浏览器把它渲染成错误页，
//   把我们精心写的中文提示盖掉。
//
//   反过来说，1111 那个 400 也有道理：state 不匹配意味着
//   **这个请求可能不是我们期待的**，用 4xx 让日志和代理层能识别出来。
//
//   【这是一个可以争论的选择】两种做法都能自洽，
//   关键是同一个文件里要一致。这里就有点不一致（1111 用 400，1121 用 200）。
      server = createServer((req, res) => {
        const parsedUrl = parse(req.url || '', true)

        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.query.code as string
          const state = parsedUrl.query.state as string
          const error = parsedUrl.query.error
          const errorDescription = parsedUrl.query.error_description as string
          const errorUri = parsedUrl.query.error_uri as string

// 【state 校验 = CSRF 防护，不能省】
//
//   攻击模型：攻击者自己发起一次授权，拿到回调 URL
//   （?code=attacker_code&state=xxx），然后诱导受害者点开它。
//   如果服务器不校验 state，受害者的 CLI 就会完成授权 ——
//   **但授权的是攻击者的账号**。之后受害者往里写的所有数据
//   都进了攻击者的账户，而受害者看到的是「连上了」。
//
//   state 是本进程随机生成的（1476 行，32 字节 base64url）。
//   攻击者猜不出来，所以伪造的回调会被 1110 行拦下。
//
//   ── 一个细节：`!error && state !== oauthState` ──
//
//   有 error 时**不校验** state，先处理错误。
//   因为错误分支不涉及「用 code 换 token」，没有 CSRF 风险。
//   如果反过来先校验，某些服务器在错误回调里不带 state，
//   就会变成「报 state 不匹配」，把真正的错误信息盖掉。
          // Validate OAuth state to prevent CSRF attacks
          if (!error && state !== oauthState) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(
              `<h1>Authentication Error</h1><p>Invalid state parameter. Please try again.</p><p>You can close this window.</p>`,
            )
            cleanup()
            rejectOnce(new Error('OAuth state mismatch - possible CSRF attack'))
            return
          }

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
// 【XSS：回调用浏览器打开，所以错误文本是攻击面】
//
//   攻击者可以构造：
//     http://127.0.0.1:PORT/callback?error=<script>...</script>&state=正确值
//
//   受害者点开 → 我们的服务器把 error 原样插进 HTML → 在浏览器里执行。
//
//   1123-1126 行用 `xss()` 库清洗。**注意 error_description 也要清洗** ——
//   它同样是 URL 参数，同样可控。只清洗一个是最常见的漏法。
//
//   ── 严格说这里风险有限 ──
//
//   页面跑在 127.0.0.1 上，CSP 也宽，攻击者能做的有限。
//   但「有限」不等于「可以不清洗」：
//   这类漏洞的利用门槛低，而修复成本只有一次函数调用。
//
//   【原则】凡是「不可信输入 → 拼进 HTML」的地方，无条件转义。
//   不要先论证「这个场景危害不大」再决定 —— 论证成本比转义高。
            // Sanitize error messages to prevent XSS
            const sanitizedError = xss(String(error))
            const sanitizedErrorDescription = errorDescription
              ? xss(String(errorDescription))
              : ''
            res.end(
              `<h1>Authentication Error</h1><p>${sanitizedError}: ${sanitizedErrorDescription}</p><p>You can close this window.</p>`,
            )
            cleanup()
            let errorMessage = `OAuth error: ${error}`
            if (errorDescription) {
              errorMessage += ` - ${errorDescription}`
            }
            if (errorUri) {
              errorMessage += ` (See: ${errorUri})`
            }
            rejectOnce(new Error(errorMessage))
            return
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              `<h1>Authentication Successful</h1><p>You can close this window. Return to Claude Code.</p>`,
            )
            cleanup()
            resolveOnce(code)
          }
        }
      })

// 【EADDRINUSE 不只是报错，要给出可执行的下一步】
//
//   1155-1164 行：端口被占时，根据平台拼一条具体的排查命令
//     Windows:  netstat -ano | findstr :PORT
//     Unix:     lsof -ti:PORT -sTCP:LISTEN
//
//   为什么值得为这个错误单独写代码？
//   因为「端口被占」在自选端口模式下概率不低（findAvailablePort
//   拿到端口到真正 listen 之间有个竞态窗口），
//   而原始错误 "listen EADDRINUSE: address already in use :::34921"
//   对普通用户没有任何可操作性。
//
//   ── 配置固定端口时概率更高 ──
//
//   有些 OAuth 服务器要求把回调 URL 预先注册（redirect_uri 白名单），
//   这时端口不能随机，必须用 serverConfig.oauth.callbackPort（960 行）。
//   同一台机器上开两个 CC 实例就必然冲突。
//
//   【好的错误信息 = 现象 + 原因 + 一条可复制的命令】
      server.on('error', (err: NodeJS.ErrnoException) => {
        cleanup()
        if (err.code === 'EADDRINUSE') {
          const findCmd =
            getPlatform() === 'windows'
              ? `netstat -ano | findstr :${port}`
              : `lsof -ti:${port} -sTCP:LISTEN`
          rejectOnce(
            new Error(
              `OAuth callback port ${port} is already in use — another process may be holding it. ` +
                `Run \`${findCmd}\` to find it.`,
            ),
          )
        } else {
          rejectOnce(new Error(`OAuth callback server failed: ${err.message}`))
        }
      })

      server.listen(port, '127.0.0.1', async () => {
        try {
          logMCPDebug(serverName, `Starting SDK auth`)
          logMCPDebug(serverName, `Server URL: ${serverConfig.url}`)

          // First call to start the auth flow - should redirect
          // Pass the scope and resource_metadata from WWW-Authenticate header if available
          const result = await sdkAuth(provider, {
            serverUrl: serverConfig.url,
            scope: wwwAuthParams.scope,
            resourceMetadataUrl: wwwAuthParams.resourceMetadataUrl,
          })
          logMCPDebug(serverName, `Initial auth result: ${result}`)

          if (result !== 'REDIRECT') {
            logMCPDebug(
              serverName,
              `Unexpected auth result, expected REDIRECT: ${result}`,
            )
          }
        } catch (error) {
          logMCPDebug(serverName, `SDK auth error: ${error}`)
          cleanup()
          rejectOnce(new Error(`SDK auth failed: ${errorMessage(error)}`))
        }
      })

// 【unref()：不让回调服务器把进程钉住】
//
//   Node 的事件循环里，一个 listening server 和一个 pending timer
//   都算「有活儿要干」，进程不会退出。
//
//   正常路径下这不是问题：认证完成 → cleanup → 都关掉了。
//   但有个场景会漏：**UI 组件卸载但没有 abort**。
//   比如父组件拦截了 Esc 键自己处理，signal 从来没被 abort。
//
//   这时按「钉住」的行为：进程还活着，占着端口，等 5 分钟。
//   用户看到的是「按了 Esc 但程序不退」。
//
//   加了 unref 之后：没有任何别的活儿时进程直接退出，端口立即释放。
//   注释说得很直白 —— 宁可让进程退出，也不要挂着占端口。
//
//   【判断要不要 unref】问：这个资源「没人管」的时候，
//   是应该继续活着，还是应该随进程一起死？
//   后台任务（日志 flush）要继续；前台辅助资源（回调服务器）应该死。
      // Don't let the callback server or timeout pin the event loop — if the UI
      // component unmounts without aborting (e.g. parent intercepts Esc), we'd
      // rather let the process exit than stay alive for 5 minutes holding the
      // port. The abortSignal is the intended lifecycle management.
      server.unref()

// 【两个超时，差两个数量级，别搞混】
//
//     AUTH_REQUEST_TIMEOUT_MS = 30 秒   （65 行）
//       单个 OAuth HTTP 请求的上限：发现、刷新、换 token。
//
//     5 * 60 * 1000 = 5 分钟            （这里）
//       等**人**在浏览器里点「同意」的上限。
//
//   人的操作时间是秒级到分钟级，网络请求是毫秒级到秒级。
//   把这两个混成一个常量，要么把人的耐心限制在 30 秒（不可用），
//   要么让网络失败要等 5 分钟才报错（不可排查）。
//
//   ── setTimeout 的第三、四个参数 ──
//
//   1205-1211 行把 cleanup 和 rejectOnce 作为参数传进去，
//   而不是直接在闭包里引用。
//   效果一样，但这样写说明了「这两个是这个定时器唯一需要的东西」——
//   读代码时不用往回翻找闭包捕获了哪些变量。
//
//   1213 行的 unref 同理：宁可漏掉这次超时，也不让进程赖着不走。
      timeoutId = setTimeout(
        (cleanup, rejectOnce) => {
          cleanup()
          rejectOnce(new Error('Authentication timeout'))
        },
        5 * 60 * 1000, // 5 minutes
        cleanup,
        rejectOnce,
      )
      timeoutId.unref()
    })

// 【一个布尔量，把 try 块切成两段 —— 归因的关键】
//
//   这个赋值的位置非常精确：在「拿到授权码」之后、
//   「用授权码换 token」之前。
//
//   于是 catch 里只要看它，就知道失败发生在哪一半：
//
//     authorizationCodeObtained === true
//       → 失败一定在 token 交换（换 token 被拒、网络错误）
//       → reason = 'token_exchange_failed'
//
//     false
//       → 失败在更早：端口、回调服务器、用户拒绝、超时
//       → 再按 message 细分（1274 行那串 if）
//
//   为什么不在 catch 里靠 message 猜？因为 token 交换失败的消息
//   五花八门（各服务器的错误体不同），而 message 匹配的可靠性
//   远不如「一个精确埋点的布尔量」。
//
//   【通用手法】在长 try 块里埋几个这样的「里程碑布尔量」，
//   归因准确率远高于事后解析错误信息。
    authorizationCodeObtained = true

    // Now complete the auth flow with the received code
    logMCPDebug(serverName, `Completing auth flow with authorization code`)
    const result = await sdkAuth(provider, {
      serverUrl: serverConfig.url,
      authorizationCode,
      resourceMetadataUrl: wwwAuthParams.resourceMetadataUrl,
    })

    logMCPDebug(serverName, `Auth result: ${result}`)

    if (result === 'AUTHORIZED') {
      // Debug: Check if tokens were properly saved
      const savedTokens = await provider.tokens()
      logMCPDebug(
        serverName,
        `Tokens after auth: ${savedTokens ? 'Present' : 'Missing'}`,
      )
      if (savedTokens) {
        logMCPDebug(
          serverName,
          `Token access_token length: ${savedTokens.access_token?.length}`,
        )
        logMCPDebug(serverName, `Token expires_in: ${savedTokens.expires_in}`)
      }

      logEvent('tengu_mcp_oauth_flow_success', {
        flowAttemptId:
          flowAttemptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        transportType:
          serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(getLoggingSafeMcpBaseUrl(serverConfig)
          ? {
              mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
                serverConfig,
              ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
      })
    } else {
      throw new Error('Unexpected auth result: ' + result)
    }
  } catch (error) {
    logMCPDebug(serverName, `Error during auth completion: ${error}`)

// 【归因链的顺序：从最确定的判据开始】
//
//   ① instanceof AuthenticationCancelledError  → 'cancelled'
//      最确定。这是我们自己抛的类型。
//
//   ② authorizationCodeObtained                → 'token_exchange_failed'
//      次确定。这是上面那个里程碑布尔量。
//
//   ③ message 子串匹配                          → timeout / state_mismatch /
//                                                provider_denied / port_unavailable /
//                                                sdk_auth_failed
//      最不确定，所以放最后，且只作兜底。
//
//   顺序不能反：如果先做 message 匹配，
//   一个「用户取消」的消息里恰好含 "OAuth error" 就会被误归成 provider_denied。
//
//   ── 为什么这些消息串是安全的 ──
//
//   它们都是**这个文件自己拼的**（1116、1138、1161、1194 行），
//   不是来自服务器。所以改文案时编译器不会提醒你 ——
//   这是一处需要人肉维护的耦合。
//
//   【更好的做法】抛自定义错误类型。但这里已经有一堆 SDK 抛的裸 Error，
//   改动面大，所以先用 message 兜着。这是本文件里一处没有标 TODO 的债。
    // Determine failure reason for attribution telemetry. The try block covers
    // port acquisition, the callback server, the redirect flow, and token
    // exchange. Map known failure paths to stable reason codes.
    let reason: MCPOAuthFlowErrorReason = 'unknown'
    let oauthErrorCode: string | undefined
    let httpStatus: number | undefined

    if (error instanceof AuthenticationCancelledError) {
      reason = 'cancelled'
    } else if (authorizationCodeObtained) {
      reason = 'token_exchange_failed'
    } else {
      const msg = errorMessage(error)
      if (msg.includes('Authentication timeout')) {
        reason = 'timeout'
      } else if (msg.includes('OAuth state mismatch')) {
        reason = 'state_mismatch'
      } else if (msg.includes('OAuth error:')) {
        reason = 'provider_denied'
      } else if (
        msg.includes('already in use') ||
        msg.includes('EADDRINUSE') ||
        msg.includes('callback server failed') ||
        msg.includes('No available port')
      ) {
        reason = 'port_unavailable'
      } else if (msg.includes('SDK auth failed')) {
        reason = 'sdk_auth_failed'
      }
    }

// 【SDK 不暴露 HTTP 状态码，只能从 message 里抠】
//
//   1301 行的正则 /^HTTP (\d{3}):/ 匹配的是 SDK 内部的错误文案格式：
//   "HTTP 500: <原始响应体>"（只在响应体解析不了时才这么拼）。
//
//   为什么需要这个状态码？因为埋点里要区分
//     · 400/401 客户端问题（用户或配置错）
//     · 429       限流（等一下就好）
//     · 5xx       服务器故障（不怪用户）
//   这三种在运维看板上是完全不同的信号，合并成一个 request_failed 就失去意义了。
//
//   ── 这是「向上游要能力，还是在下游凑」的取舍 ──
//
//   正确做法是给 SDK 提 PR 让 OAuthError 带 status 字段。
//   用正则抠是权宜之计，一旦 SDK 改文案就静默失效（httpStatus 变 undefined，
//   埋点少一个字段，不报错）。
//
//   【凡是解析别人的字符串格式，都要假设它会变。】
//   这里的做法是「失败就退化成 undefined」，不崩，可接受。
    // sdkAuth uses native fetch and throws OAuthError subclasses (InvalidGrantError,
    // ServerError, InvalidClientError, etc.) via parseErrorResponse. Extract the
    // OAuth error code directly from the SDK error instance.
    if (error instanceof OAuthError) {
      oauthErrorCode = error.errorCode
      // SDK does not attach HTTP status as a property, but the fallback ServerError
      // embeds it in the message as "HTTP {status}:" when the response body was
      // unparseable. Best-effort extraction.
      const statusMatch = error.message.match(/^HTTP (\d{3}):/)
      if (statusMatch) {
        httpStatus = Number(statusMatch[1])
      }
// 【invalid_client + "Client not found" → 自愈：清掉存的 client_id 重做 DCR】
//
//   场景：服务器重置了数据库 / 换了一套部署，
//   我们存的 client_id 在它那边已经不存在了。
//
//   不处理的话：每次认证都拿旧 client_id → invalid_client → 失败。
//   用户会陷入「点重新认证也没用」的死循环。
//
//   处理方式：把 clientId 和 clientSecret 从凭据里删掉。
//   下次 clientInformation()（1482 行）返回 undefined → SDK 触发 DCR → 拿到新的 client_id。
//
//   ── 为什么这个自愈放在错误处理里，而不是启动时预检 ──
//
//   因为「client_id 无效」只有服务器才知道。
//   本地无法预判，只能等一次失败。所以自愈点必须紧贴失败点。
//
//   ── 注意 message 里必须同时匹配 "Client not found" ──
//
//   只匹配 invalid_client 太宽：密钥错误也会是 invalid_client，
//   那种情况该让用户改密钥，而不是悄悄换一个 client_id。
//
//   【自愈动作的触发条件要窄】宁可多失败一次，
//   也不要在错误的场景下悄悄改变用户的配置。
      // If client not found, clear the stored client ID and suggest retry
      if (
        error.errorCode === 'invalid_client' &&
        error.message.includes('Client not found')
      ) {
        const storage = getSecureStorage()
        const existingData = storage.read() || {}
        const serverKey = getServerKey(serverName, serverConfig)
        if (existingData.mcpOAuth?.[serverKey]) {
          delete existingData.mcpOAuth[serverKey].clientId
          delete existingData.mcpOAuth[serverKey].clientSecret
          storage.update(existingData)
        }
      }
    }

    logEvent('tengu_mcp_oauth_flow_error', {
      flowAttemptId:
        flowAttemptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        oauthErrorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      http_status:
        httpStatus?.toString() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transportType:
        serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(getLoggingSafeMcpBaseUrl(serverConfig)
        ? {
            mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
              serverConfig,
            ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    })
    throw error
  }
}

// 【这段注释描述的是全文件最精妙的一个补丁，值得逐句拆开】
//
//   场景：token 有效，但 scope 不够。服务器返回 403 +
//        WWW-Authenticate: Bearer error="insufficient_scope", scope="files:write"
//
//   期望行为：重新走一次授权（带更大的 scope），用户点同意，拿到新 token。
//
//   ── 不加这个补丁会发生什么（一段真实的死循环）──
//
//     SDK 收到 403 → 进 authInternal → 看到内存里有 refresh_token
//       → 走刷新路径（**这是错的**，RFC 6749 §6 明确禁止 refresh 提升 scope）
//       → 服务器返回一个同样 scope 的 token（它只能这样）
//       → SDK 认为刷新成功，返回 'AUTHORIZED'，重试原请求
//       → 又是 403 → SDK 放弃，报 "Server returned 403 after trying upscoping"
//
//   关键点：它**永远到不了** redirectToAuthorization（1852 行），
//   而 step-up 的 scope 正是在那里被持久化的。
//   所以下一次重新认证时，我们仍然不知道要申请更大 scope，再进同一个循环。
//
//   ── 补丁的思路：不改 SDK，改它的输入 ──
//
//   在 SDK 处理 403 之前，先把这个 scope 记到 provider 上（markStepUpPending）。
//   然后 tokens() 在 step-up 待处理时**故意不返回 refresh_token**（1690 行）。
//
//   于是 SDK 的 authInternal 发现「没有 refresh token」，
//   只能落回 PKCE 授权码流程 → 走到 redirectToAuthorization → scope 被持久化 → 用户授权。
//
//   【这是一个用「返回值的缺失」改变调用方控制流的技巧】
//   它比 patch SDK、比 fork、比在重试层拦截都便宜，
//   代价是把「tokens() 返回什么」和「SDK 内部走哪条分支」耦合成了一条隐式契约。
//   所以注释里必须把这个耦合写清楚 —— 否则下一个人看到
//   `refresh_token: needsStepUp ? undefined : ...` 会觉得这是个 bug。
//
//   参考 issue: github.com/anthropics/claude-code/issues/28258
/**
 * Wraps fetch to detect 403 insufficient_scope responses and mark step-up
 * pending on the provider BEFORE the SDK's 403 handler calls auth(). Without
 * this, the SDK's authInternal sees refresh_token → refreshes (uselessly, since
 * RFC 6749 §6 forbids scope elevation via refresh) → returns 'AUTHORIZED' →
 * retry → 403 again → aborts with "Server returned 403 after trying upscoping",
 * never reaching redirectToAuthorization where step-up scope is persisted.
 * With this flag set, tokens() omits refresh_token so the SDK falls through
 * to the PKCE flow. See github.com/anthropics/claude-code/issues/28258.
 */
export function wrapFetchWithStepUpDetection(
  baseFetch: FetchLike,
  provider: ClaudeAuthProvider,
): FetchLike {
  return async (url, init) => {
    const response = await baseFetch(url, init)
    if (response.status === 403) {
      const wwwAuth = response.headers.get('WWW-Authenticate')
      if (wwwAuth?.includes('insufficient_scope')) {
// 【RFC 6750 §3 允许 scope 带引号或不带引号】
//
//   服务器 A:  scope="files:write admin"
//   服务器 B:  scope=files:write
//
//   正则 `scope=(?:"([^"]+)"|([^\s,]+))` 两个分支分别抓这两种，
//   然后 `match?.[1] ?? match?.[2]` 取非空的那个。
//
//   ── 为什么不直接用 SDK 的解析函数 ──
//
//   注释说 "Same pattern as the SDK's extractFieldFromWwwAuth" ——
//   也就是抄了 SDk 的实现。因为那个函数没导出，只能复制。
//
//   【这是复制代码的合理场景】但不能算好：SDK 改了正则，这里不会跟着改。
//   复制处应该留注释注明来源（这里确实注了）。
        // Match both quoted and unquoted values (RFC 6750 §3 allows either).
        // Same pattern as the SDK's extractFieldFromWwwAuth.
        const match = wwwAuth.match(/scope=(?:"([^"]+)"|([^\s,]+))/)
        const scope = match?.[1] ?? match?.[2]
        if (scope) {
          provider.markStepUpPending(scope)
        }
      }
    }
    return response
  }
}

// 【ClaudeAuthProvider 的角色：MCP SDK 的九方法回调面】
//
//   SDK 不认识 keychain、不认识我们的存储格式、不认识 XAA。
//   它只认这个接口：
//
//     clientMetadata()          我是什么应用（给 DCR 用）
//     clientInformation()       我的 client_id / secret
//     saveClientInformation()   DCR 的返回值存起来
//     tokens()                  给我一个可用的 token（每次请求都调！）
//     saveTokens()              换到了，存起来
//     redirectToAuthorization() 打开浏览器
//     saveCodeVerifier()/codeVerifier()   PKCE
//     state()                   CSRF 令牌
//     invalidateCredentials()   某个东西坏了，清掉
//     discoveryState()/saveDiscoveryState()  发现结果缓存
//
//   所有策略（什么时候刷新、什么时候清、什么时候走 XAA）
//   都藏在这些回调的**实现**里，SDK 完全不知情。
//
//   【这是「适配器模式」在认证领域的典型用法】
//   好处：换存储后端（keychain → 文件 → 内存）不用动 SDK。
//   坏处：控制流变得隐晦 —— SDK 什么时候调 tokens() 是它的自由，
//   你只能通过「返回什么」去影响它（见 1690 行那个例子）。
export class ClaudeAuthProvider implements OAuthClientProvider {
  private serverName: string
  private serverConfig: McpSSEServerConfig | McpHTTPServerConfig
  private redirectUri: string
  private handleRedirection: boolean
  private _codeVerifier?: string
  private _authorizationUrl?: string
  private _state?: string
  private _scopes?: string
  private _metadata?: Awaited<
    ReturnType<typeof discoverAuthorizationServerMetadata>
  >
// 【_refreshInProgress：单飞（single-flight）】
//
//   问题：刷新是网络请求，耗时几百毫秒。
//   而 tokens() 在并发请求下会被同时调用多次
//   （MCP 服务器同时发 5 个工具调用，SDK 会给每个请求都取一次 token）。
//
//   不收敛的话：5 个并发刷新。
//   后果不是「浪费网络」这么轻 —— refresh token 常常是**一次性的**
//   （刷新后旧的立即失效，这是 refresh token rotation）。
//   5 个并发刷新里，只有 1 个成功，另外 4 个拿到 invalid_grant。
//   而那 4 个会把 invalid_grant 当成「token 坏了」→ 清库 → 用户被踢下线。
//
//   所以这里必须把并发合并成一个 Promise：
//   第一个调用创建，后面的 await 同一个（1652-1667 行）。
//
//   【单飞的正确实现要点】
//     ① 用 `.finally()` 清空而不是 `.then()` —— 失败也必须清，否则永久卡住
//     ② 存的是 Promise 不是结果 —— 后来的调用者要能 await
//     ③ 只在「发起」处判空，await 处不能再判（否则中间被清空就漏了）
  private _refreshInProgress?: Promise<OAuthTokens | undefined>
  private _pendingStepUpScope?: string
  private onAuthorizationUrlCallback?: (url: string) => void
  private skipBrowserOpen: boolean

  constructor(
    serverName: string,
    serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
    redirectUri: string = buildRedirectUri(),
    handleRedirection = false,
    onAuthorizationUrl?: (url: string) => void,
    skipBrowserOpen?: boolean,
  ) {
    this.serverName = serverName
    this.serverConfig = serverConfig
    this.redirectUri = redirectUri
    this.handleRedirection = handleRedirection
    this.onAuthorizationUrlCallback = onAuthorizationUrl
    this.skipBrowserOpen = skipBrowserOpen ?? false
  }

  get redirectUrl(): string {
    return this.redirectUri
  }

  get authorizationUrl(): string | undefined {
    return this._authorizationUrl
  }

// 【clientMetadata：我们在 AS 眼里是什么应用】
//
//   `token_endpoint_auth_method: 'none'` 是关键 —— 声明我们是**公共客户端**。
//   意思是：我们没有 client_secret（或者说有也不用），
//   身份靠 PKCE 的 code_verifier 证明。
//
//   这是 CLI / 桌面应用的唯一正确选择：
//   你没法在用户机器上安全地保存 client_secret（任何人拿到二进制都能提取）。
//   所以规范要求这类应用用 PKCE 而不是密钥。
//
//   ── scope 从元数据里推，而不是写死 ──
//
//   1427 行从 AS 的元数据里读 scope。读的顺序见 2445 行：
//   `scope` → `default_scope` → `scopes_supported`（取并集）。
//
//   为什么这么做？因为不同服务器要求的最低 scope 不同，
//   写死一个要么不够（连上就 403），要么过大（用户看到吓人的授权请求）。
//
//   【客户端应该尽量「问服务器要什么」，而不是自己猜。】
  get clientMetadata(): OAuthClientMetadata {
    const metadata: OAuthClientMetadata = {
      client_name: `Claude Code (${this.serverName})`,
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
    }

    // Include scope from metadata if available
    const metadataScope = getScopeFromMetadata(this._metadata)
    if (metadataScope) {
      metadata.scope = metadataScope
      logMCPDebug(
        this.serverName,
        `Using scope from metadata: ${metadata.scope}`,
      )
    }

    return metadata
  }

// 【CIMD（SEP-991）：把 client_id 变成一个 URL】
//
//   传统流程（DCR，Dynamic Client Registration）：
//     客户端 POST /register → 服务器生成 client_id → 存起来
//   问题：每个用户、每台机器都要注册一次，服务器上堆满垃圾记录；
//   而且注册结果是状态，客户端丢了就得重来。
//
//   CIMD 的思路：client_id 直接就是「描述这个应用的 JSON 文档 URL」。
//   服务器自己去 GET 那个 URL 读元数据（client_name、redirect_uris、scope）。
//   无需注册，无状态。
//
//   ── 触发条件 ──
//
//   只有当 AS 元数据里声明 `client_id_metadata_document_supported: true` 时，
//   SDK 才会用这个 URL 当 client_id。否则走 DCR。
//   也就是说**这段代码不需要判断**，它只是「准备好一个 URL 候选」。
//
//   ── MCP_OAUTH_CLIENT_METADATA_URL 这个环境变量的用途 ──
//
//   注释说 "e.g. for testing, FedStart"。FedStart 是合规环境，
//   要求所有元数据文档托管在特定域名下 —— 所以必须能改。
//
//   【这类「测试/合规逃生阀」值得学】默认值写死最安全，
//   但留一个环境变量就能覆盖，成本是一行 if。
  /**
   * CIMD (SEP-991): URL-based client_id. When the auth server advertises
   * client_id_metadata_document_supported: true, the SDK uses this URL as the
   * client_id instead of performing Dynamic Client Registration.
   * Override via MCP_OAUTH_CLIENT_METADATA_URL env var (e.g. for testing, FedStart).
   */
  get clientMetadataUrl(): string | undefined {
    const override = process.env.MCP_OAUTH_CLIENT_METADATA_URL
    if (override) {
      logMCPDebug(this.serverName, `Using CIMD URL from env: ${override}`)
      return override
    }
    return MCP_CLIENT_METADATA_URL
  }

  setMetadata(
    metadata: Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>,
  ): void {
    this._metadata = metadata
  }

// 【markStepUpPending：一个 setter，改变的是 SDK 的控制流】
//
//   看名字像是「设置一个标记」，实际作用远比名字大 ——
//   它让 tokens() 不再返回 refresh_token（1690 行），
//   从而让 SDK 放弃刷新、改走重新授权。
//
//   【命名建议】这类「改状态以影响外部控制流」的方法，
//   名字最好能体现后果。比如 markStepUpPending 也可以叫
//   forceReauthorizationOnNextTokensCall()—— 但太长了。
//   折中：名字保持简短，**紧邻的注释承担说明责任**（这里做到了）。
//
//   只有 provider 是 transport 挂的那个实例（handleRedirection=false）时，
//   这个标记才有意义 —— 见 1884 行那段关于持久化的注释。
  /**
   * Called by the fetch wrapper when a 403 insufficient_scope response is
   * detected. Setting this causes tokens() to omit refresh_token, forcing
   * the SDK's authInternal to skip its (useless) refresh path and fall through
   * to startAuthorization → redirectToAuthorization → step-up persistence.
   * RFC 6749 §6 forbids scope elevation via refresh, so refreshing would just
   * return the same-scoped token and the retry would 403 again.
   */
  markStepUpPending(scope: string): void {
    this._pendingStepUpScope = scope
    logMCPDebug(this.serverName, `Marked step-up pending: ${scope}`)
  }

  async state(): Promise<string> {
    // Generate state if not already generated for this instance
    if (!this._state) {
      this._state = randomBytes(32).toString('base64url')
      logMCPDebug(this.serverName, 'Generated new OAuth state')
    }
    return this._state
  }

// 【clientInformation 的三级回退，顺序体现优先级】
//
//   ① 凭据库里存的 clientId       ← DCR 的结果，或者上次认证留下的
//   ② 配置里预置的 clientId       ← 用户手工在 .mcp.json 里填的
//   ③ undefined                  ← 触发 SDK 去做 DCR
//
//   为什么 ① 优先于 ②？
//
//   因为 DCR 的结果是**服务器认可的**。用户手填的 clientId
//   可能已经过期、或者填错了。有服务器认可的，就用它。
//
//   ── 但 ② 的 secret 从另一个地方取 ──
//
//   1500 行读的是 `mcpOAuthClientConfig`（和 token 分开的那个 map，见 690 行）。
//   而 ① 的 secret 在读 `mcpOAuth` 里。
//   两条路径读两个不同的存储位置 —— 这个不对称很容易看漏。
//
//   原因：DCR 回来的 secret 是**服务器发的**，随 token 生命周期走；
//   用户手填的 secret 是**用户配的**，长期有效（2399 行）。
//
//   【返回 undefined 不是错误，是一个指令】—— 告诉 SDK「去注册」。
  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const storage = getSecureStorage()
    const data = storage.read()
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    // Check session credentials first (from DCR or previous auth)
    const storedInfo = data?.mcpOAuth?.[serverKey]
    if (storedInfo?.clientId) {
      logMCPDebug(this.serverName, `Found client info`)
      return {
        client_id: storedInfo.clientId,
        client_secret: storedInfo.clientSecret,
      }
    }

    // Fallback: pre-configured client ID from server config
    const configClientId = this.serverConfig.oauth?.clientId
    if (configClientId) {
      const clientConfig = data?.mcpOAuthClientConfig?.[serverKey]
      logMCPDebug(this.serverName, `Using pre-configured client ID`)
      return {
        client_id: configClientId,
        client_secret: clientConfig?.clientSecret,
      }
    }

    // If we don't have stored client info, return undefined to trigger registration
    logMCPDebug(this.serverName, `No client info found`)
    return undefined
  }

// 【saveClientInformation：DCR 的返回值落盘】
//
//   注意 1531-1532 行这两个默认值：
//
//     accessToken: existing...?.accessToken || ''
//     expiresAt:   existing...?.expiresAt   || 0
//
//   为什么需要它们？因为这个 entry 的类型要求这两个字段必填
//   （看 SecureStorageData 的定义）。
//
//   ── 而这两个默认值制造了一个「假状态」──
//
//   写入之后，凭据库里会存在一个 `{clientId, accessToken:'', expiresAt:0}` 的条目。
//   从「有没有 token」的角度看：没有。
//   从「有没有 entry」的角度看：有。
//
//   hasMcpDiscoveryButNoToken（349 行）判的正是「有 entry 无 token」→ 必然 401。
//   如果 DCR 写完、用户还没授权就被打断，下次连接会被判成 needs-auth —— 正确。
//
//   ── 但 XAA 那条路径被这个假状态坑过 ──
//
//   1570-1579 行的长注释解释了：曾经想用「accessToken !== ''」作为
//   「是否需要静默换 token」的判据，结果这个 marker 残留在 keychain 里，
//   导致自动认证永久失效。所以最终没有特判。
//
//   【结论】为了满足类型而写的默认值，会在别处变成「有语义的状态」。
//   写的时候要想到：别人会拿这个值做判断。
  async saveClientInformation(
    clientInformation: OAuthClientInformationFull,
  ): Promise<void> {
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    const updatedData: SecureStorageData = {
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...existingData.mcpOAuth?.[serverKey],
          serverName: this.serverName,
          serverUrl: this.serverConfig.url,
          clientId: clientInformation.client_id,
          clientSecret: clientInformation.client_secret,
          // Provide default values for required fields if not present
          accessToken: existingData.mcpOAuth?.[serverKey]?.accessToken || '',
          expiresAt: existingData.mcpOAuth?.[serverKey]?.expiresAt || 0,
        },
      },
    }

    storage.update(updatedData)
  }

// 【tokens()：本文件最热的方法，每次 MCP 请求都会调】
//
//   调用频率的量级：注释里说 30-40 次/秒（见下一条）。
//   所以这个方法里的每一个操作都要按「会被高频执行」来审视：
//
//     · 能不能避免一次同步 IO？
//     · 能不能避免一次网络请求？
//     · 能不能复用上一次的结果？
//
//   但同时它还要承担**正确性**职责：
//     · 过期了要刷新
//     · step-up 时要隐藏 refresh token
//     · XAA 时要静默换 token
//
//   【热路径 + 复杂逻辑 = 最容易出隐蔽 bug 的组合】
//   因为性能压力会诱使人加缓存，而缓存和「凭据可能被别的进程改掉」直接冲突。
//   下面的注释就是在讲这个冲突怎么折中。
  async tokens(): Promise<OAuthTokens | undefined> {
// 【一条用 CPU profile 换来的注释：不要在这里 clearKeychainCache】
//
//   背景：跨进程场景（开了两个 CC 实例，A 刷新了 token）。
//   B 的 tokens() 读的是 keychain 缓存，可能拿到旧值。
//   直觉的修法：每次读之前 clearKeychainCache() 强制读盘。
//
//   ── 为什么不行 ──
//
//   macOS 上读 keychain 要走 `security find-generic-password`，
//   而 secureStorage 的实现用的是 **spawnSync** —— 同步阻塞地起一个子进程。
//
//   tokens() 每秒被调 30-40 次。每次都 spawnSync 一个进程 →
//   CPU profile 显示 spawnSync 占了总 CPU 的 7.2%（PR #19436 之后测到的）。
//
//   7.2% 的 CPU 只是表面代价。真正的代价是**同步阻塞**：
//   每次 spawnSync 期间事件循环停住，UI 掉帧、其他网络回调延迟。
//
//   ── 那跨进程一致性怎么保证 ──
//
//   ① 读的时候用缓存（这里）
//   ② 真要读最新值时，在**低频路径**上清缓存：
//      - refreshAuthorization 拿到锁之后（2140 行）
//      - _doRefresh 遇到 invalid_grant 之后（2294 行）
//   ③ 本进程自己写的，storage.update() 会主动失效缓存（不用手动清）
//
//   【这是一个「用最终一致换性能」的决定，而且它是对的】
//   因为过期的代价只是「多一次 401 → 触发刷新」，
//   而阻塞事件循环的代价是全局的。
    // Cross-process token changes (another CC instance refreshed or invalidated)
    // are picked up via the keychain cache TTL (see macOsKeychainStorage.ts).
    // In-process writes already invalidate the cache via storage.update().
    // We do NOT clearKeychainCache() here — tokens() is called by the MCP SDK's
    // _commonHeaders on every request, and forcing a cache miss would trigger
    // a blocking spawnSync(`security find-generic-password`) 30-40x/sec.
    // See CPU profile: spawnSync was 7.2% of total CPU after PR #19436.
    const storage = getSecureStorage()
    const data = await storage.readAsync()
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    const tokenData = data?.mcpOAuth?.[serverKey]

// 【XAA 静默换 token：把 id_token 当成「另一种 refresh token」】
//
//   UX 上的等价关系：
//     有 refresh_token  → 静默刷出 access_token（1 个请求）
//     有 id_token       → 静默走 XAA 链换 access_token（4 个请求）
//
//   两者都不需要用户操作。所以对用户来说，
//   「id_token 还在缓存里」就等于「不用重新登录」。
//
//   ── 触发条件是三个的合取（1585-1591 行）──
//
//     ① isXaaEnabled() 且 serverConfig.oauth.xaa   这是 XAA 服务器
//     ② !tokenData?.refreshToken                   没有 refresh token
//     ③ !accessToken 或 5 分钟内过期                  当前 token 不可用/快过期
//
//   条件 ② 的意义：如果 AS 给了 refresh token，
//   普通刷新只要 1 个请求，XAA 链要 4 个。有便宜的路就走便宜的。
//
//   但 ② 之后还有个回流：如果刷新被拒（refresh token 被吊销），
//   refreshAuthorization 会 invalidateCredentials('tokens') 清掉它，
//   下一次 tokens() 条件 ② 就成立了 → 落到 XAA 分支。
//   所以两条路是**接续**的，不是互斥的。
//
// 【这段注释值得完整读一遍：它在解释「为什么不做一件看起来更严谨的事」】
//
//   看起来更严谨的判据是：
//     「只有当 accessToken !== '' 时才认为需要换 token」
//   因为空字符串显然代表「没有 token」。
//
//   ── 为什么这个判据会致命 ──
//
//   SDK 在一次认证流程的中途会调用 saveClientInformation，
//   而那里为了满足类型要求写了 `accessToken: ''`（1531 行）。
//   也就是说：**认证进行到一半，凭据库里就有一个 accessToken:'' 的 marker**。
//
//   如果判据是 `accessToken !== ''`：
//     用户上次认证被打断 → marker 留在 keychain
//     → 下次连接：accessToken === '' → 不走 XAA 静默分支
//     → 走普通路径 → 没有 token → 返回 undefined → 401 → needs-auth
//     → 用户点了认证 → 认证中途又写 marker → 又被这个判据挡住
//
//   结果：XAA 的自动认证**永久失效**，用户每次都要手工登录。
//   注释里说 "real bug seen with xaa.dev" —— 这是真发生过的。
//
//   ── 所以最终判据是 `!accessToken`（空字符串也算没有）──
//
//   代价是注释里承认的「无害的重复」：
//   第一次 tokens() 调 XAA 静默换 → 没 id_token → 返回 undefined →
//   auth() 走流程 → 写 marker → 又调 tokens() → 又一次静默换 → 又失败。
//
//   多一次 keychain 读（约 1ms），换来的是「自动认证总能工作」。
//
//   【这段注释的教学价值】它把「一个看似多余的调用」的来源完整交代了。
//   没有它，下一个人优化时会把这个重复调用删掉，然后重新引入同一个 bug。
    // XAA: a cached id_token plays the same UX role as a refresh_token — run
    // the silent exchange to get a fresh access_token without a browser. The
    // id_token does expire (we re-acquire via `xaa login` when it does); the
    // point is that while it's valid, re-auth is zero-interaction.
    //
    // Only fire when we don't have a refresh_token. If the AS returned one,
    // the normal refresh path (below) is cheaper — 1 request vs the 4-request
    // XAA chain. If that refresh is revoked, refreshAuthorization() clears it
    // (invalidateCredentials('tokens')), and the next tokens() falls through
    // to here.
    //
    // Fires on:
    //   - never authed (!tokenData)                 → first connect, auto-auth
    //   - SDK partial write {accessToken:''}        → stale from past session
    //   - expired/expiring, no refresh_token        → proactive XAA re-auth
    //
    // No special-casing of {accessToken:'', expiresAt:0}. Yes, SDK auth()
    // writes that mid-flow (saveClientInformation defaults). But with this
    // auto-auth branch, the *first* tokens() call — before auth() writes
    // anything — fires xaaRefresh. If id_token is cached, SDK short-circuits
    // there and never reaches the write. If id_token isn't cached, xaaRefresh
    // returns undefined in ~1 keychain read, auth() proceeds, writes the
    // marker, calls tokens() again, xaaRefresh fails again identically.
    // Harmless redundancy, not a wasted exchange. And guarding on `!==''`
    // permanently bricks auto-auth when a *prior* session left that marker
    // in keychain — real bug seen with xaa.dev.
    //
    // xaaRefresh() internally short-circuits to undefined when the id_token
    // isn't cached (or settings.xaaIdp is gone) → we fall through to the
    // existing needs-auth path → user runs `xaa login`.
    //
    if (
      isXaaEnabled() &&
      this.serverConfig.oauth?.xaa &&
      !tokenData?.refreshToken &&
      (!tokenData?.accessToken ||
        (tokenData.expiresAt - Date.now()) / 1000 <= 300)
    ) {
      if (!this._refreshInProgress) {
        logMCPDebug(
          this.serverName,
          tokenData
            ? `XAA: access_token expiring, attempting silent exchange`
            : `XAA: no access_token yet, attempting silent exchange`,
        )
        this._refreshInProgress = this.xaaRefresh().finally(() => {
          this._refreshInProgress = undefined
        })
      }
      try {
        const refreshed = await this._refreshInProgress
        if (refreshed) return refreshed
      } catch (e) {
        logMCPDebug(
          this.serverName,
          `XAA silent exchange failed: ${errorMessage(e)}`,
        )
      }
      // Fall through. Either id_token isn't cached (xaaRefresh returned
      // undefined) or the exchange errored. Normal path below handles both:
      // !tokenData → undefined → 401 → needs-auth; expired → undefined → same.
    }

    if (!tokenData) {
      logMCPDebug(this.serverName, `No token data found`)
      return undefined
    }

// 【过期判定的三个分支，每个通向不同的恢复路径】
//
//     expiresIn <= 0 且无 refresh   → 返回 undefined → SDK 报 401 → needs-auth（要人）
//     expiresIn <= 300 且有 refresh → 主动刷新（1650 行）
//     expiresIn > 300               → 直接用（可能还会因 step-up 隐藏 refresh）
//
//   为什么是 300 秒（5 分钟）而不是 0？
//
//   因为「刚好没过期」的 token 在请求发出去的路上就过期了。
//   实际耗时 = 网络往返 + 排队 + 服务器处理，可能几秒到几十秒。
//   留 5 分钟余量是为了让「取 token」和「用 token」之间不会跨过过期点。
//
//   【刷新窗口的取值原则】应该大于 P99 的「取到用到」耗时。
//   网络抖动时这个值偏小会表现为偶发的 401。
//   5 分钟对 CLI 来说很宽松，代价是稍微频繁的刷新（refresh token 寿命消耗快一点）。
    // Check if token is expired
    const expiresIn = (tokenData.expiresAt - Date.now()) / 1000

// 【needsStepUp 的判定：pending scope 里有当前 token 没有的吗】
//
//   1628-1631 行：
//     currentScopes = tokenData.scope?.split(' ') ?? []
//     needsStepUp = pending 存在 && pending 里至少一个不在 current 里
//
//   注意 `?.` 的兜底：tokenData.scope 可能没有（服务器没返回 scope）。
//   这时 currentScopes 是空数组，于是「pending 里任何 scope 都算缺」→ needsStepUp = true。
//
//   这个默认行为是对的：不知道有什么 scope 时，按「什么都没有」处理，
//   多走一次授权比「以为够了然后 403」好。
//
//   ── 为什么要逐个比较而不是字符串相等 ──
//
//   因为 scope 是无序集合，服务器返回的顺序和请求的顺序不一定一致。
//   比 set 包含关系，不比字符串。
//
//   【这类「集合语义 vs 字符串语义」的坑】在 OAuth、CORS、权限系统里到处都是。
    // Step-up check: if a 403 insufficient_scope was detected and the current
    // token doesn't have the requested scope, omit refresh_token below so the
    // SDK skips refresh and falls through to the PKCE flow.
    const currentScopes = tokenData.scope?.split(' ') ?? []
    const needsStepUp =
      this._pendingStepUpScope !== undefined &&
      this._pendingStepUpScope.split(' ').some(s => !currentScopes.includes(s))
    if (needsStepUp) {
      logMCPDebug(
        this.serverName,
        `Step-up pending (${this._pendingStepUpScope}), omitting refresh_token`,
      )
    }

    // If token is expired and we don't have a refresh token, return undefined
    if (expiresIn <= 0 && !tokenData.refreshToken) {
      logMCPDebug(this.serverName, `Token expired without refresh token`)
      return undefined
    }

// 【主动刷新：用一次多余的请求换掉一次失败请求的延迟】
//
//   不主动刷新的流程：
//     发请求 → 401 → SDK 刷新 → 重发请求   （用户多等一个往返）
//
//   主动刷新的流程：
//     刷新 → 发请求                          （用户少等一个往返，但可能白刷）
//
//   代价：如果这次 token 其实还能用（比如用户只是刷了一下 /mcp 命令），
//   就白刷了一次。refresh token rotation 下还会消耗一次轮换次数。
//
//   ── 为什么这里选了主动 ──
//
//   1 小时的 token 寿命、5 分钟的刷新窗口，
//   平均每 55 分钟才刷一次。相比「偶发的多等一个往返」，
//   这个代价可以忽略。
//
//   ── 但 step-up 时必须跳过（`!needsStepUp`）──
//
//   因为刷新**不能**提升 scope（RFC 6749 §6）。
//   刷了还是同样的 scope，然后还是 403，白刷一次还多花时间。
//   所以 step-up 待处理时直接跳过刷新，把控制权交给 SDK 的重新授权路径。
    // If token is expired or about to expire (within 5 minutes) and we have a refresh token, refresh it proactively.
    // This proactive refresh is a UX improvement - it avoids the latency of a failed request followed by token refresh.
    // While MCP servers should return 401 for expired tokens (which triggers SDK-level refresh), proactively refreshing
    // before expiry provides a smoother user experience.
    // Skip when step-up is pending — refreshing can't elevate scope (RFC 6749 §6).
    if (expiresIn <= 300 && tokenData.refreshToken && !needsStepUp) {
      // Reuse existing refresh promise if one is in progress to prevent concurrent refreshes
      if (!this._refreshInProgress) {
        logMCPDebug(
          this.serverName,
          `Token expires in ${Math.floor(expiresIn)}s, attempting proactive refresh`,
        )
        this._refreshInProgress = this.refreshAuthorization(
          tokenData.refreshToken,
        ).finally(() => {
          this._refreshInProgress = undefined
        })
      } else {
        logMCPDebug(
          this.serverName,
          `Token refresh already in progress, reusing existing promise`,
        )
      }

      try {
        const refreshed = await this._refreshInProgress
        if (refreshed) {
          logMCPDebug(this.serverName, `Token refreshed successfully`)
          return refreshed
        }
        logMCPDebug(
          this.serverName,
          `Token refresh failed, returning current tokens`,
        )
      } catch (error) {
        logMCPDebug(
          this.serverName,
          `Token refresh error: ${errorMessage(error)}`,
        )
      }
    }

// 【返回的 token 对象：refresh_token 可以是 undefined】
//
//   1690 行 `needsStepUp ? undefined : tokenData.refreshToken`
//   这是 step-up 补丁的落地点（见 1344 行）。
//
//   ── `expires_in: expiresIn` 可能是负数 ──
//
//   如果走到了这里（说明刷新失败或者不需要刷新），
//   而 token 已经过期了（expiresIn < 0），返回的 expires_in 就是负数。
//
//   这看起来像 bug，其实是**刻意的**：
//   SDK 拿到负的 expires_in 会认为 token 已过期，
//   如果它有 refresh_token 就会去刷；没有就报 401。
//   两条路都是我们想要的。
//
//   如果这里「修正」成 `Math.max(0, expiresIn)`，
//   反而会让 SDK 以为 token 还能用几秒，行为不可预测。
//
//   【不要「修正」看起来不合理的值】先想清楚消费方怎么用它。
    // Return current tokens (may be expired if refresh failed or not needed yet)
    const tokens = {
      access_token: tokenData.accessToken,
      refresh_token: needsStepUp ? undefined : tokenData.refreshToken,
      expires_in: expiresIn,
      scope: tokenData.scope,
      token_type: 'Bearer',
    }

    logMCPDebug(this.serverName, `Returning tokens`)
    logMCPDebug(this.serverName, `Token length: ${tokens.access_token?.length}`)
    logMCPDebug(this.serverName, `Has refresh token: ${!!tokens.refresh_token}`)
    logMCPDebug(this.serverName, `Expires in: ${Math.floor(expiresIn)}s`)

    return tokens
  }

// 【saveTokens 第一行清 _pendingStepUpScope —— 位置很关键】
//
//   1705 行 `this._pendingStepUpScope = undefined`
//
//   为什么必须在最前面？因为「保存了新 token」就意味着
//   step-up 已经完成（新 token 带着更大的 scope）。
//   如果不清，下一次 tokens() 会继续隐藏 refresh_token，
//   于是又走一遍授权流程 —— 用户会被反复要求授权。
//
//   ── 必须在任何 await 之前清吗 ──
//
//   这个方法里没有 await（storage.update 是同步的），所以不存在竞态。
//   但如果将来改成异步存储，这个「第一行」就变成了「在 await 之前」的要求 ——
//   否则并发的 tokens() 会在清理之前读到旧标记。
//
//   【状态清理的位置】要么在函数最开头（同步可见），
//   要么在明确的提交点之后。不要在中间。
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._pendingStepUpScope = undefined
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    logMCPDebug(this.serverName, `Saving tokens`)
    logMCPDebug(this.serverName, `Token expires in: ${tokens.expires_in}`)
    logMCPDebug(this.serverName, `Has refresh token: ${!!tokens.refresh_token}`)

    const updatedData: SecureStorageData = {
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...existingData.mcpOAuth?.[serverKey],
          serverName: this.serverName,
          serverUrl: this.serverConfig.url,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          scope: tokens.scope,
        },
      },
    }

    storage.update(updatedData)
  }

// 【xaaRefresh 里的 TODO 是一份诚实的技术债记录，值得逐条看】
//
//   问题：`_refreshInProgress` 只在**一个进程内**去重。
//   两个 CC 实例同时开着，token 都快过期 → 各自跑完整个 4 请求 XAA 链
//   → 各自 storage.update() 写 keychain → 后写的赢，先写的那次作废。
//
//   ── 注释里最值得学的是「为什么这个 race 不致命」的分析 ──
//
//   对比 inc-4829（另一个 race）：那里 id_token 是**单次使用**的，
//   两个进程抢同一个 id_token，一个成功一个失败 —— 那才是真故障。
//
//   这里 id_token 不是单次使用，所以两次交换都成功，
//   两个 access_token 都有效。损失只是：
//     · 多跑一遍 4 个请求（浪费流量）
//     · keychain 写竞争（后写的赢，但两个值都可用）
//
//   【判断 race 的严重程度，看「失败的那一方会留下什么坏状态」】
//   如果什么都不留，那它只是浪费；如果留了半个状态，那就是故障。
//
//   这段注释还指明了解法（抄 refreshAuthorization 的 lockfile 模式），
//   只是没做。这就是好的 TODO：说明现象、评估影响、给出路径，但没有假装已完成。
  /**
   * XAA silent refresh: cached id_token → Layer-2 exchange → new access_token.
   * No browser.
   *
   * Returns undefined if the id_token is gone from cache — caller treats this
   * as needs-interactive-reauth (transport will 401, CC surfaces it).
   *
   * On exchange failure, clears the id_token cache so the next interactive
   * auth does a fresh IdP login (the cached id_token is likely stale/revoked).
   *
   * TODO(xaa-ga): add cross-process lockfile before GA. `_refreshInProgress`
   * only dedupes within one process — two CC instances with expiring tokens
   * both fire the full 4-request XAA chain and race on storage.update().
   * Unlike inc-4829 the id_token is not single-use so both access_tokens
   * stay valid (wasted round-trips + keychain write race, not brickage),
   * but this is the shape CLAUDE.md flags under "Token/auth caching across
   * process boundaries". Mirror refreshAuthorization()'s lockfile pattern.
   */
  private async xaaRefresh(): Promise<OAuthTokens | undefined> {
    const idp = getXaaIdpSettings()
    if (!idp) return undefined // config was removed mid-session

    const idToken = getCachedIdpIdToken(idp.issuer)
    if (!idToken) {
      logMCPDebug(
        this.serverName,
        'XAA: id_token not cached, needs interactive re-auth',
      )
      return undefined
    }

    const clientId = this.serverConfig.oauth?.clientId
    const clientConfig = getMcpClientConfig(this.serverName, this.serverConfig)
    if (!clientId || !clientConfig?.clientSecret) {
      logMCPDebug(
        this.serverName,
        'XAA: missing clientId or clientSecret in config — skipping silent refresh',
      )
      return undefined // shouldn't happen if `mcp add` was correct
    }

    const idpClientSecret = getIdpClientSecret(idp.issuer)

// 【soft-fail：静默路径上失败一律返回 undefined，不抛】
//
//   xaaRefresh 是从 tokens() 里调用的。tokens() 的语义是
//   「有就给我，没有就返回 undefined 让我走 401 流程」。
//
//   如果这里抛异常，异常会穿过 tokens() 冒到 SDK 里，
//   而 SDK 对 tokens() 抛错的反应是「连接失败」——
//   用户看到的是「服务器连不上」，而不是「需要重新登录」。
//
//   ── 所以每条失败都要软化成 undefined ──
//
//     没 IdP 配置      → return undefined（用户删了配置）
//     没缓存的 id_token → return undefined（要人登录）
//     缺 clientId/secret → return undefined（配置不全）
//     OIDC 发现失败     → return undefined（网络问题）
//
//   四种原因都归到同一个出口，因为**调用方不需要区分**：
//   它只知道「静默换不到了，走需要人工的流程」。
//
//   【分层的错误处理原则】只在能做出不同决策的层区分错误类型。
//   不能做出不同决策的，就该归一。
    // Discover IdP token endpoint. Could cache (fetchCache.ts already
    // caches /.well-known/ requests), but OIDC metadata is cheap + idempotent.
    // xaaRefresh is the silent tokens() path — soft-fail to undefined so the
    // caller falls through to needs-authentication instead of throwing mid-connect.
    let oidc
    try {
      oidc = await discoverOidc(idp.issuer)
    } catch (e) {
      logMCPDebug(
        this.serverName,
        `XAA: OIDC discovery failed in silent refresh: ${errorMessage(e)}`,
      )
      return undefined
    }

    try {
      const tokens = await performCrossAppAccess(
        this.serverConfig.url,
        {
          clientId,
          clientSecret: clientConfig.clientSecret,
          idpClientId: idp.clientId,
          idpClientSecret,
          idpIdToken: idToken,
          idpTokenEndpoint: oidc.token_endpoint,
        },
        this.serverName,
      )
// 【为什么直接写 storage 而不是调 saveTokens —— 一个跨模块的隐性契约】
//
//   表面上 saveTokens 就够了。但 saveTokens 的实现是：
//
//     { ...existing, accessToken, refreshToken, expiresAt, scope }
//
//   它只 **spread 已有数据**，不写 clientId / clientSecret。
//
//   ── 后果链 ──
//
//   如果这是 serverKey 的**第一次**写入（用户配了 XAA 但还没走过完整认证，
//   直接靠静默交换连上），那 entry 里就没有 clientId。
//
//   之后用户点「清除授权」→ revokeServerTokens（467 行）
//   → 读 `tokenData.clientId` 得到 undefined
//   → 发一个不带 client_id 的 RFC 7009 吊销请求
//   → 严格的 AS（Okta / Stytch）直接拒绝
//   → 服务器上的 token 没被吊销，但本地已经清了
//
//   用户以为授权撤销了，实际上服务器上那个 refresh token 还活着。
//   这是一个**安全后果**，不是功能后果。
//
//   【教训】「写入函数」如果只增量更新部分字段，
//   它在不同调用顺序下会留下不同的残缺状态。
//   跨模块依赖这些字段时，必须显式补齐（这里补了 clientId + clientSecret）。
      // Write directly (not via saveTokens) so clientId + clientSecret land in
      // storage even when this is the first write for serverKey. saveTokens
      // only spreads existing data; if no prior performMCPXaaAuth ran,
      // revokeServerTokens would later read tokenData.clientId as undefined
      // and send a client_id-less RFC 7009 request that strict ASes reject.
      const storage = getSecureStorage()
      const existingData = storage.read() || {}
      const serverKey = getServerKey(this.serverName, this.serverConfig)
      const prev = existingData.mcpOAuth?.[serverKey]
      storage.update({
        ...existingData,
        mcpOAuth: {
          ...existingData.mcpOAuth,
          [serverKey]: {
            ...prev,
            serverName: this.serverName,
            serverUrl: this.serverConfig.url,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? prev?.refreshToken,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            scope: tokens.scope,
            clientId,
            clientSecret: clientConfig.clientSecret,
            discoveryState: {
              authorizationServerUrl: tokens.authorizationServerUrl,
            },
          },
        },
      })
      return {
        access_token: tokens.access_token,
        token_type: 'Bearer',
        expires_in: tokens.expires_in,
        scope: tokens.scope,
        refresh_token: tokens.refresh_token,
      }
    } catch (e) {
      if (e instanceof XaaTokenExchangeError && e.shouldClearIdToken) {
        clearIdpIdToken(idp.issuer)
        logMCPDebug(
          this.serverName,
          'XAA: cleared id_token after exchange failure',
        )
      }
      throw e
    }
  }

// 【redirectToAuthorization：scope 的三个来源，按可信度排序】
//
//   ① 授权 URL 里的 scope 参数（1857 行）
//      ← 最可信：这是 SDK 根据 AS 元数据 + step-up 要求拼出来的
//
//   ② 内存里的 _metadata（1872 行）
//      ← 次可信：从 AS 元数据推的（2445 行那个回退链）
//
//   ③ 都没有 → 不设 scope，让服务器用默认值
//
//   为什么不直接用配置里的 scope？
//   因为 step-up 场景下配置里的 scope 是**旧的、不够的**。
//   URL 里带的是这次真正要申请的。
//
//   ── 同时这个函数是「打开浏览器」的唯一位置 ──
//
//   所以它承担了两件事：记录 scope（给 token 交换用）+ 真的开浏览器。
//   两件事分开会更好，但 SDK 的接口只有一个回调点。
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Store the authorization URL
    this._authorizationUrl = authorizationUrl.toString()

    // Extract and store scopes from the authorization URL for later use in token exchange
    const scopes = authorizationUrl.searchParams.get('scope')
    logMCPDebug(
      this.serverName,
      `Authorization URL: ${redactSensitiveUrlParams(authorizationUrl.toString())}`,
    )
    logMCPDebug(this.serverName, `Scopes in URL: ${scopes || 'NOT FOUND'}`)

    if (scopes) {
      this._scopes = scopes
      logMCPDebug(
        this.serverName,
        `Captured scopes from authorization URL: ${scopes}`,
      )
    } else {
      // If no scope in URL, try to get it from metadata
      const metadataScope = getScopeFromMetadata(this._metadata)
      if (metadataScope) {
        this._scopes = metadataScope
        logMCPDebug(
          this.serverName,
          `Using scopes from metadata: ${metadataScope}`,
        )
      } else {
        logMCPDebug(this.serverName, `No scopes available from URL or metadata`)
      }
    }

// 【step-up scope 只在 handleRedirection === false 时持久化 —— 为什么要这个守卫】
//
//   provider 有两种实例：
//
//     handleRedirection = true     performMCPOAuthFlow 里 new 的（968 行）
//                                  这是「用户主动点认证」，会真的开浏览器
//
//     handleRedirection = false    transport 挂的那个（client.ts 里 new）
//                                  它永远不开浏览器，只负责在 401/403 时报告
//
//   ── 只有第二种才该持久化 scope ──
//
//   因为它的 scope 来源**必然是**一次 401/403 响应（服务器说「我要更大的」）。
//
//   而第一种的 scope 可能来自元数据的 scopes_supported（2445 行的回退），
//   那是「服务器支持的所有 scope」，不是「这次需要的」。
//   把它当 stepUpScope 存下来，下次认证会申请一个过大的 scope ——
//   用户看到一个吓人的授权页（"这个应用要读你所有文件"）。
//
//   【同一段代码在两种实例下语义不同，必须用标志位区分】
//   这类分支最好紧贴一个说明「为什么」的注释，否则下一个人会当成冗余判断删掉。
    // Persist scope for step-up auth: only when the transport-attached provider
    // (handleRedirection=false) receives a step-up 401. The SDK calls auth()
    // which calls redirectToAuthorization with the new scope. We persist it
    // so the next performMCPOAuthFlow can use it without an extra probe request.
    // Guard with !handleRedirection to avoid persisting during normal auth flows
    // (where the scope may come from metadata scopes_supported rather than a 401).
// 【`existing` 判空而不是新建 —— 一个刻意的保守选择】
//
//   1895 行 `if (existing)`：只有当 entry 已经存在时才写 stepUpScope。
//
//   如果 entry 不存在（比如凭据被清光了），这里什么都不做。
//   为什么不新建一个？
//
//   因为新建 entry 需要填 accessToken / expiresAt 这些必填字段，
//   而此刻我们知道的值是「没有 token」—— 写进去就是那个「假状态」
//   （见 1513 行的说明），会让 hasMcpDiscoveryButNoToken 误判。
//
//   【宁可少写一个字段，也不要写一个半真半假的条目。】
//   这类「不完整状态」是凭据库里最难排查的问题。
    if (this._scopes && !this.handleRedirection) {
      const storage = getSecureStorage()
      const existingData = storage.read() || {}
      const serverKey = getServerKey(this.serverName, this.serverConfig)
      const existing = existingData.mcpOAuth?.[serverKey]
      if (existing) {
        existing.stepUpScope = this._scopes
        storage.update(existingData)
        logMCPDebug(this.serverName, `Persisted step-up scope: ${this._scopes}`)
      }
    }

    if (!this.handleRedirection) {
      logMCPDebug(
        this.serverName,
        `Redirection handling is disabled, skipping redirect`,
      )
      return
    }

    // Validate URL scheme for security
    const urlString = authorizationUrl.toString()
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      throw new Error(
        'Invalid authorization URL: must use http:// or https:// scheme',
      )
    }

    logMCPDebug(this.serverName, `Redirecting to authorization URL`)
    const redactedUrl = redactSensitiveUrlParams(urlString)
    logMCPDebug(this.serverName, `Authorization URL: ${redactedUrl}`)

// 【先通知 UI，再开浏览器 —— 顺序有讲究】
//
//   1924-1926 行把 URL 交给回调（UI 显示出来），
//   然后 1928 行才尝试打开浏览器。
//
//   反过来的话：如果 openBrowser 失败（无 GUI、SSH、容器、默认浏览器配错），
//   用户会看到「正在打开浏览器…」然后什么都没有，
//   而且**没有任何地方能看到那个 URL** —— 他没法手工复制。
//
//   这个顺序保证了「浏览器失败也不影响用户完成认证」。
//
//   ── openBrowser 的失败只记日志，不抛 ──
//
//   1932-1937 行。因为「开不了浏览器」不是认证失败 ——
//   URL 已经在 UI 上了，用户可以自己开。抛错会让整个流程终止。
//
//   【区分「主路径失败」和「辅助手段失败」】辅助失败只降级，不中断。
    // Notify the UI about the authorization URL BEFORE opening the browser,
    // so users can see the URL as a fallback if the browser fails to open
    if (this.onAuthorizationUrlCallback) {
      this.onAuthorizationUrlCallback(urlString)
    }

    if (!this.skipBrowserOpen) {
      logMCPDebug(this.serverName, `Opening authorization URL: ${redactedUrl}`)

      const success = await openBrowser(urlString)
      if (!success) {
        logMCPDebug(
          this.serverName,
          `Browser didn't open automatically. URL is shown in UI.`,
        )
      }
    } else {
      logMCPDebug(
        this.serverName,
        `Skipping browser open (skipBrowserOpen=true). URL: ${redactedUrl}`,
      )
    }
  }

// 【PKCE 的 code_verifier 只存内存，不落盘 —— 这是对的】
//
//   verifier 的生命周期极短：从发起授权到换 token，中间就几十秒。
//   存到 keychain 里没有任何好处，反而扩大暴露面
//   （拿到 verifier + 截获 code 就能换 token）。
//
//   所以 saveCodeVerifier 只是赋值给字段。
//
//   ── 代价：跨进程的认证流程无法接续 ──
//
//   假如进程在「打开浏览器」之后、用户点同意之前被杀了，
//   重启后是**没法**用那个 code 的（verifier 丢了）。
//   但这不是问题：直接重新发起一次授权即可，成本是用户再点一次。
//
//   【判断「要不要持久化」的方法】问：丢了它，重来一次的代价是什么？
//   代价低 + 它本身敏感 → 不持久化。
  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    logMCPDebug(this.serverName, `Saving code verifier`)
    this._codeVerifier = codeVerifier
  }

  async codeVerifier(): Promise<string> {
    if (!this._codeVerifier) {
      logMCPDebug(this.serverName, `No code verifier saved`)
      throw new Error('No code verifier saved')
    }
    logMCPDebug(this.serverName, `Returning code verifier`)
    return this._codeVerifier
  }

// 【invalidateCredentials 的五个 scope，语义完全不同】
//
//     'all'        删整个 entry（含 clientId、token、discoveryState、stepUpScope）
//     'client'     只删 clientId + clientSecret（保留 token！）
//     'tokens'     只清 access/refresh/expiresAt，**保留 entry 其余字段**
//     'verifier'   只清内存里的 PKCE verifier（不动存储）
//     'discovery'  清 discoveryState + stepUpScope（重新探服务器）
//
//   ── 最容易搞错的是 'tokens' 和 'all' ──
//
//   它们看起来都是「清 token」，但 'tokens' 把字段设成空值
//   （accessToken: ''、expiresAt: 0、refreshToken: undefined）而**不删 entry**。
//
//   为什么保留 entry？因为 entry 里还有 clientId ——
//   SDK 下次认证时可以直接复用这个 client_id（不用重做 DCR）。
//   如果删了整个 entry，每次刷新失败都要重新注册客户端。
//
//   ── 而 'tokens' 留下的正是那个「假状态」──
//
//   有 entry 无 token → hasMcpDiscoveryButNoToken 返回 true →
//   下次连接直接判定 needs-auth，不做无谓的 401 往返。
//   所以这里的空值不是残留，是**有意的信号**。
//
//   【空值和缺失的区别】在这个存储里，空字符串表示「已知为空」，
//   undefined 表示「不知道」。两者承载不同信息。
  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    const storage = getSecureStorage()
    const existingData = storage.read()
    if (!existingData?.mcpOAuth) return

    const serverKey = getServerKey(this.serverName, this.serverConfig)
    const tokenData = existingData.mcpOAuth[serverKey]
    if (!tokenData) return

    switch (scope) {
      case 'all':
        delete existingData.mcpOAuth[serverKey]
        break
      case 'client':
        tokenData.clientId = undefined
        tokenData.clientSecret = undefined
        break
      case 'tokens':
        tokenData.accessToken = ''
        tokenData.refreshToken = undefined
        tokenData.expiresAt = 0
        break
      case 'verifier':
        this._codeVerifier = undefined
        return
      case 'discovery':
        tokenData.discoveryState = undefined
        tokenData.stepUpScope = undefined
        break
    }

    storage.update(existingData)
    logMCPDebug(this.serverName, `Invalidated credentials (scope: ${scope})`)
  }

// 【saveDiscoveryState：只存两个 URL，不存完整元数据】
//
//   这个函数最值得读的是 2007-2015 行的注释，它记录了一个真实事故（#30337）：
//
//     authorizationServerMetadata 单独就 1.5-2KB（每种 grant type、
//     PKCE 方法、端点全列出来）。
//     macOS 上 keychain 写入走 `security -i`，而它的 stdin
//     有 **4096 字节的行长度限制**。
//     凭据库用 hex 编码存储 → 2013 字节的 JSON 上限。
//     两个 OAuth MCP 服务器各存一份完整元数据 → 溢出 → 凭据库损坏。
//
//   「凭据库损坏」不是「这个服务器连不上」，而是**所有** MCP 服务器
//   的凭据一起丢。所以这个 bug 的爆炸半径远大于触发条件。
//
//   ── 解法：只存 URL，元数据下次重新 GET ──
//
//   SDK 内部是 `cachedState.authorizationServerMetadata ?? await discover...`。
//   也就是说「缓存命中就用，没命中就自己去取」——
//   所以丢掉元数据不会导致失败，只会多一次 HTTP GET（幂等、便宜）。
//
//   【这是一个「用一次廉价请求换掉一条硬限制」的经典取舍】
//   判断依据：丢掉的东西能不能廉价重建？能，就丢。
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    logMCPDebug(
      this.serverName,
      `Saving discovery state (authServer: ${state.authorizationServerUrl})`,
    )

    // Persist only the URLs, NOT the full metadata blobs.
    // authorizationServerMetadata alone is ~1.5-2KB per MCP server (every
    // grant type, PKCE method, endpoint the IdP supports). On macOS the
    // keychain write goes through `security -i` which has a 4096-byte stdin
    // line limit — with hex encoding that's ~2013 bytes of JSON total. Two
    // OAuth MCP servers persisting full metadata overflows it, corrupting
    // the credential store (#30337). The SDK re-fetches missing metadata
    // with one HTTP GET on the next auth — see node_modules/.../auth.js
    // `cachedState.authorizationServerMetadata ?? await discover...`.
    const updatedData: SecureStorageData = {
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...existingData.mcpOAuth?.[serverKey],
          serverName: this.serverName,
          serverUrl: this.serverConfig.url,
          accessToken: existingData.mcpOAuth?.[serverKey]?.accessToken || '',
          expiresAt: existingData.mcpOAuth?.[serverKey]?.expiresAt || 0,
          discoveryState: {
            authorizationServerUrl: state.authorizationServerUrl,
            resourceMetadataUrl: state.resourceMetadataUrl,
          },
        },
      },
    }

    storage.update(updatedData)
  }

// 【discoveryState 的三级回退，注意第三级是「现场取」】
//
//   ① 凭据库里缓存的（2042 行）→ 最快，直接用
//   ② 配置里给了 authServerMetadataUrl → 现场 GET 一次
//   ③ 都没有 → undefined，让 SDK 自己走完整发现
//
//   ── 一个容易看漏的细节：返回的对象里有两个可能为 undefined 的字段 ──
//
//   2052-2055 行把 resourceMetadata 和 authorizationServerMetadata
//   从缓存里读出来 —— 但 saveDiscoveryState 根本不写这两个字段（2026 行只写两个 URL）。
//
//   所以正常情况下它们**永远是 undefined**。
//   这两行的唯一作用：兼容老版本写进去的完整数据，
//   让「升级前存的缓存」还能被用一次。
//
//   【这就是「读取端要兼容历史写入格式」】即使新的写入已经不再产生那种形状。
//   否则升级后所有用户都会被强制重新发现一次。
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const storage = getSecureStorage()
    const data = storage.read()
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    const cached = data?.mcpOAuth?.[serverKey]?.discoveryState
    if (cached?.authorizationServerUrl) {
      logMCPDebug(
        this.serverName,
        `Returning cached discovery state (authServer: ${cached.authorizationServerUrl})`,
      )

      return {
        authorizationServerUrl: cached.authorizationServerUrl,
        resourceMetadataUrl: cached.resourceMetadataUrl,
        resourceMetadata:
          cached.resourceMetadata as OAuthDiscoveryState['resourceMetadata'],
        authorizationServerMetadata:
          cached.authorizationServerMetadata as OAuthDiscoveryState['authorizationServerMetadata'],
      }
    }

    // Check config hint for direct metadata URL
    const metadataUrl = this.serverConfig.oauth?.authServerMetadataUrl
    if (metadataUrl) {
      logMCPDebug(
        this.serverName,
        `Fetching metadata from configured URL: ${metadataUrl}`,
      )
      try {
        const metadata = await fetchAuthServerMetadata(
          this.serverName,
          this.serverConfig.url,
          metadataUrl,
        )
        if (metadata) {
          return {
            authorizationServerUrl: metadata.issuer,
            authorizationServerMetadata:
              metadata as OAuthDiscoveryState['authorizationServerMetadata'],
          }
        }
      } catch (error) {
        logMCPDebug(
          this.serverName,
          `Failed to fetch from configured metadata URL: ${errorMessage(error)}`,
        )
      }
    }

    return undefined
  }

// 【refreshAuthorization：为什么要跨进程锁】
//
//   场景：用户开了两个 CC 实例（两个终端窗口）连同一个 MCP 服务器。
//   token 同时快过期 → 两个进程同时发起刷新。
//
//   ── 没有锁会发生什么 ──
//
//   refresh token rotation 下，第一个刷新成功后旧的 refresh token 立即失效。
//   第二个进程拿着已经失效的 token 去刷 → invalid_grant
//   → 按 invalid_grant 的处理逻辑：清空本地 token
//   → **把这个进程刚写好的新 token 也清掉了**（如果写完了的话）
//   → 两个进程都需要用户重新登录。
//
//   一个本来只在「多开」时出现的偶发问题，表现为「莫名其妙被登出」。
//
//   ── 锁的粒度 ──
//
//   按 serverKey 加锁（2096-2097 行），不是全局锁。
//   不同服务器可以并行刷新，互不影响。
//
//   ── 文件名要清洗 ──
//
//   serverKey 里有 `|`（`name|hash`），不能直接做文件名
//   （某些文件系统会拒绝，Windows 上尤其）。所以 2096 行把
//   非字母数字全换成下划线。
//
//   【这类「把逻辑 key 当文件名用」的地方，必须做字符集清洗】——
//   而且清洗后要仍然唯一（这里 `|` 被换掉，但 hash 部分没变，仍唯一）。
  async refreshAuthorization(
    refreshToken: string,
  ): Promise<OAuthTokens | undefined> {
    const serverKey = getServerKey(this.serverName, this.serverConfig)
    const claudeDir = getClaudeConfigHomeDir()
    await mkdir(claudeDir, { recursive: true })
    const sanitizedKey = serverKey.replace(/[^a-zA-Z0-9]/g, '_')
    const lockfilePath = join(claudeDir, `mcp-refresh-${sanitizedKey}.lock`)

// 【锁重试策略：5 次，间隔 1-2 秒随机】
//
//   总等待时间上限约 10 秒（5 × 平均 1.5s）。
//   为什么不是「一直等到拿到」？
//
//   因为锁的持有者可能已经死了（进程崩溃但锁文件残留）。
//   无限等待会让所有实例永久卡住。10 秒是个折中：
//   够覆盖一次正常刷新的耗时（几百毫秒到 2 秒），
//   又不至于让用户觉得程序挂了。
//
//   ── 拿不到锁也继续，这是刻意的 fail-open ──
//
//   2131-2136 行：重试用尽后只记一条日志，然后**不带锁继续刷新**。
//
//   为什么？因为「没有锁」的后果是「可能重复刷新」（偶发、可恢复），
//   而「拒绝刷新」的后果是「token 过期 → 用户被登出」（必然、需人工）。
//   两害相权，宁可重复。
//
//   【锁的设计原则】锁是优化，不是正确性保证 ——
//   除非它保护的东西**绝对不能**做两次。
//   这里刷新做两次只是浪费，所以 fail-open 是对的。
    let release: (() => Promise<void>) | undefined
    for (let retry = 0; retry < MAX_LOCK_RETRIES; retry++) {
      try {
        logMCPDebug(
          this.serverName,
          `Acquiring refresh lock (attempt ${retry + 1})`,
        )
        release = await lockfile.lock(lockfilePath, {
          realpath: false,
          onCompromised: () => {
            logMCPDebug(this.serverName, `Refresh lock was compromised`)
          },
        })
        logMCPDebug(this.serverName, `Acquired refresh lock`)
        break
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code === 'ELOCKED') {
          logMCPDebug(
            this.serverName,
            `Refresh lock held by another process, waiting (attempt ${retry + 1}/${MAX_LOCK_RETRIES})`,
          )
// 【随机抖动防惊群】
//
//   `sleep(1000 + Math.random() * 1000)` —— 1 到 2 秒之间的随机值。
//
//   如果所有等待者都用固定的 1000ms：
//   10 个实例同时被拒 → 同时等 1 秒 → 同时重试 → 9 个又被拒 → 又同时等 1 秒……
//   这种「同步重试」会让冲突持续下去（虽然最终会成功，但慢）。
//
//   加了抖动之后，等待时间被打散，某一个会先成功。
//
//   【凡是「失败后重试」的 sleep，都应该带随机抖动】
//   这是分布式系统里的标准做法（AWS 的 exponential backoff + jitter）。
//   本文件的 _doRefresh 重试（2349 行）**没有**抖动 ——
//   那里是单进程的顺序重试，不存在惊群，所以不需要。
          await sleep(1000 + Math.random() * 1000)
          continue
        }
        logMCPDebug(
          this.serverName,
          `Failed to acquire refresh lock: ${code}, proceeding without lock`,
        )
        break
      }
    }
    if (!release) {
      logMCPDebug(
        this.serverName,
        `Could not acquire refresh lock after ${MAX_LOCK_RETRIES} retries, proceeding without lock`,
      )
    }

    try {
// 【拿到锁之后必须重新读，不能相信进锁前的值】
//
//   这是「锁 + 缓存」组合的经典陷阱：
//
//     进程 B：读缓存 → 发现 token 还有 10 秒过期 → 决定刷新
//     进程 A：（此刻）刷新完成，写入新 token
//     进程 B：拿到锁 → 用 10 秒前读的旧值判断 → 又刷一次
//              → 但 refresh token 已经被 A 用掉了 → invalid_grant → 清库
//
//   所以 2140 行的 `clearKeychainCache()` 是**必须的**：
//   进锁前的读经过了 keychain 缓存（可能几秒前的），
//   必须强制读一次磁盘才能看到 A 的写入。
//
//   ── 注意这里 clearKeychainCache 是安全的 ──
//
//   因为 refreshAuthorization 是低频路径（最多每 55 分钟一次），
//   不像 tokens() 那样每秒 30 次（见 1541 行的 CPU 说明）。
//
//   【同一个操作在不同频次的路径上，代价差三个数量级。】
//   所以「能不能这么做」的答案取决于「在哪个路径上做」。
      // Re-read tokens after acquiring lock — another process may have refreshed
      clearKeychainCache()
      const storage = getSecureStorage()
      const data = storage.read()
      const tokenData = data?.mcpOAuth?.[serverKey]
      if (tokenData) {
        const expiresIn = (tokenData.expiresAt - Date.now()) / 1000
        if (expiresIn > 300) {
          logMCPDebug(
            this.serverName,
            `Another process already refreshed tokens (expires in ${Math.floor(expiresIn)}s)`,
          )
          return {
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken,
            expires_in: expiresIn,
            scope: tokenData.scope,
            token_type: 'Bearer',
          }
        }
        // Use the freshest refresh token from storage
        if (tokenData.refreshToken) {
          refreshToken = tokenData.refreshToken
        }
      }
      return await this._doRefresh(refreshToken)
    } finally {
      if (release) {
        try {
          await release()
          logMCPDebug(this.serverName, `Released refresh lock`)
        } catch {
          logMCPDebug(this.serverName, `Failed to release refresh lock`)
        }
      }
    }
  }

// 【_doRefresh 的三层策略：缓存元数据、白名单重试、精确归因】
//
//   这个函数不算长，但每一段都在处理一种「现实情况」：
//
//     2215-2249  元数据从哪来：内存 → 持久化 → 重新发现（三级）
//     2258-2263  没有 client 信息 → 直接放弃，不重试（重试也没用）
//     2287-2325  invalid_grant → 先查别人刷好没有，再决定清不清
//     2327-2354  只对「临时性」错误重试，指数退避 1/2/4 秒
//
//   ── 一个关键设计：这个函数**从不抛异常** ──
//
//   所有失败都返回 undefined。因为调用方（tokens）需要的是
//   「有没有新 token」这个二元信息，异常只会让它在 SDK 里变成连接错误。
//
//   【「返回 undefined 而不是抛错」是一个明确的接口契约】
//   要写在函数注释里，否则调用方会习惯性 try/catch。
  private async _doRefresh(
    refreshToken: string,
  ): Promise<OAuthTokens | undefined> {
    const MAX_ATTEMPTS = 3

    const mcpServerBaseUrl = getLoggingSafeMcpBaseUrl(this.serverConfig)
    const emitRefreshEvent = (
      outcome: 'success' | 'failure',
      reason?: MCPRefreshFailureReason,
    ): void => {
      logEvent(
        outcome === 'success'
          ? 'tengu_mcp_oauth_refresh_success'
          : 'tengu_mcp_oauth_refresh_failure',
        {
          transportType: this.serverConfig
            .type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...(mcpServerBaseUrl
            ? {
                mcpServerBaseUrl:
                  mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(reason
            ? {
                reason:
                  reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        },
// 【emitRefreshEvent 把埋点的分支收敛成一个闭包】
//
//   没有这个闭包的话，这个函数里会有 6 处 logEvent：
//     metadata_discovery_failed / no_client_info / no_tokens_returned
//     invalid_grant / transient_retries_exhausted / request_failed
//   每处都要重复 transportType + mcpServerBaseUrl 的拼装，
//   以及那个难看的 as AnalyticsMetadata_... 类型断言。
//
//   收敛之后：每个失败点只写 `emitRefreshEvent('failure', 'xxx')`。
//
//   ── 那个类型断言为什么到处都是 ──
//
//   `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
//   是一个**故意起得很长**的类型名。它的作用是：
//   任何人想把一个可能含用户数据/文件路径的字符串塞进埋点，
//   都得手写这个类型名 —— 写的时候会被这个长名字挡一下，
//   从而想起来「这个值安全吗」。
//
//   【这是用类型系统做代码审查】比 lint 规则更有效，
//   因为你没法「顺手」绕过它。
      )
    }

// 【MAX_ATTEMPTS = 3，但只在 isRetryable 时才真的重试】
//
//   循环结构容易误解：`for attempt 1..3` 看起来总会跑三次。
//   实际是：不 retryable 的错误在第一次就 return undefined（2337 行）。
//
//   所以这个循环的本质是「最多 3 次尝试」，而不是「一定 3 次」。
//
//   ── 每个 return 都带着一个归因 ──
//
//     metadata 拿不到        → metadata_discovery_failed（不重试）
//     clientInfo 拿不到      → no_client_info（不重试）
//     SDK 返回空             → no_tokens_returned（不重试）
//     invalid_grant          → invalid_grant（不重试，且清库）
//     timeout / 5xx / 429    → 重试，用尽后 transient_retries_exhausted
//     其他（4xx、逻辑错误）    → request_failed（不重试）
//
//   【「不重试」的判据】这个错误重试一次会不会得到不同结果？
//   配置缺失、授权被拒 → 不会。网络超时、限流 → 会。
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        logMCPDebug(this.serverName, `Starting token refresh`)
        const authFetch = createAuthFetch()

// 【元数据缓存的三级优先级，逐级降级】
//
//   ① this._metadata（内存）
//      同一会话内的多次刷新直接命中，零成本。
//
//   ② 持久化的 discoveryState（跨会话）
//      2231-2240 行：如果只存了 authorizationServerUrl 没存元数据
//      （新的存储策略就是这样，见 1997 行），
//      就对那个 URL 做一次 RFC 8414 发现 —— 比完整 RFC 9728 链便宜。
//
//   ③ fetchAuthServerMetadata（完整发现）
//      最贵的一条路，只在前面全空时走。
//
//   ── 为什么优先 ② 而不是直接 ③ ──
//
//   因为 ③ 需要先探 MCP 服务器拿 authorization_servers[0]，
//   再对那个地址做发现 —— 两个请求。
//   而 ② 已经知道 AS 在哪了，一个请求就够。
//
//   【缓存的价值不在于「省一个请求」，而在于「省掉依赖链上的一环」】
//   ② 省掉的是「MCP 服务器必须在线」这个前提。
        // Reuse cached metadata from the initial OAuth flow if available,
        // since metadata (token endpoint URL, etc.) is static per auth server.
        // Priority:
        // 1. In-memory cache (same-session refreshes)
        // 2. Persisted discovery state from initial auth (cross-session) —
        //    avoids re-running RFC 9728 discovery on every refresh.
        // 3. Full RFC 9728 → RFC 8414 re-discovery via fetchAuthServerMetadata.
        let metadata = this._metadata
        if (!metadata) {
          const cached = await this.discoveryState()
          if (cached?.authorizationServerMetadata) {
            logMCPDebug(
              this.serverName,
              `Using persisted auth server metadata for refresh`,
            )
            metadata = cached.authorizationServerMetadata
          } else if (cached?.authorizationServerUrl) {
            logMCPDebug(
              this.serverName,
              `Re-discovering metadata from persisted auth server URL: ${cached.authorizationServerUrl}`,
            )
            metadata = await discoverAuthorizationServerMetadata(
              cached.authorizationServerUrl,
              { fetchFn: authFetch },
            )
          }
        }
        if (!metadata) {
          metadata = await fetchAuthServerMetadata(
            this.serverName,
            this.serverConfig.url,
            this.serverConfig.oauth?.authServerMetadataUrl,
            authFetch,
          )
        }
        if (!metadata) {
          logMCPDebug(this.serverName, `Failed to discover OAuth metadata`)
          emitRefreshEvent('failure', 'metadata_discovery_failed')
          return undefined
        }
        // Cache for future refreshes
        this._metadata = metadata

        const clientInfo = await this.clientInformation()
        if (!clientInfo) {
          logMCPDebug(this.serverName, `No client information available`)
          emitRefreshEvent('failure', 'no_client_info')
          return undefined
        }

        const newTokens = await sdkRefreshAuthorization(
          new URL(this.serverConfig.url),
          {
            metadata,
            clientInformation: clientInfo,
            refreshToken,
            resource: new URL(this.serverConfig.url),
            fetchFn: authFetch,
          },
        )

        if (newTokens) {
          logMCPDebug(this.serverName, `Token refresh successful`)
          await this.saveTokens(newTokens)
          emitRefreshEvent('success')
          return newTokens
        }

        logMCPDebug(this.serverName, `Token refresh returned no tokens`)
        emitRefreshEvent('failure', 'no_tokens_returned')
        return undefined
      } catch (error) {
// 【invalid_grant 的第一反应不是清库，而是「问别人刷好没有」】
//
//   这个顺序极其重要，写反了就是一个难查的 bug：
//
//   ── 错误顺序 ──
//
//     遇到 invalid_grant → 清空本地 token → 用户被登出
//     但实际上是进程 A 刚刷新成功，B 手里的是旧 refresh token
//     → 清掉的是 A 刚写好的新 token → 两个进程一起被登出
//
//   ── 正确顺序（这里）──
//
//     遇到 invalid_grant → clearKeychainCache + 重新读
//     → 发现 expiresIn > 300（有人刷好了）→ 直接用，不发失败埋点
//     → 确实没有好 token → 才 invalidateCredentials('tokens')
//
//   【「失败」的第一反应应该是「再确认一次状态」，而不是「执行回滚」】
//   因为并发场景下，你看到的失败可能是别人成功之前的残影。
//
//   ── 注意 2294 行的 clearKeychainCache 在这里是必须的 ──
//
//   不加的话读到的还是缓存里的旧值，会误判成「没人刷过」→ 清库。
//   这个操作在低频路径上，代价可接受（对比 tokens() 里的情况，见 1541 行）。
        // Invalid grant means the refresh token itself is invalid/revoked/expired.
        // But another process may have already refreshed successfully — check first.
        if (error instanceof InvalidGrantError) {
          logMCPDebug(
            this.serverName,
            `Token refresh failed with invalid_grant: ${error.message}`,
          )
          clearKeychainCache()
          const storage = getSecureStorage()
          const data = storage.read()
          const serverKey = getServerKey(this.serverName, this.serverConfig)
          const tokenData = data?.mcpOAuth?.[serverKey]
          if (tokenData) {
            const expiresIn = (tokenData.expiresAt - Date.now()) / 1000
            if (expiresIn > 300) {
              logMCPDebug(
                this.serverName,
                `Another process refreshed tokens, using those`,
              )
// 【用别人的结果时不发 success 埋点 —— 遥测准确性的细节】
//
//   注释说得很清楚：
//     "Not emitted as success: this process did not perform a refresh,
//      and the winning process already emitted its own success event.
//      Emitting here would double-count."
//
//   如果不注意，看板上的「刷新成功率」会虚高：
//   一次真实刷新可能被 5 个进程各上报一次成功。
//
//   ── 原则：埋点应该记录「本进程做了什么」，而不是「最终结果如何」 ──
//
//   前者是可加总的（N 个进程的计数加起来 = 总工作量），
//   后者会被重复计数。
//
//   【埋点设计的前置问题】这个指标将来怎么聚合？
//   答不上来就不要加字段。
              // Not emitted as success: this process did not perform a
              // refresh, and the winning process already emitted its own
              // success event. Emitting here would double-count.
              return {
                access_token: tokenData.accessToken,
                refresh_token: tokenData.refreshToken,
                expires_in: expiresIn,
                scope: tokenData.scope,
                token_type: 'Bearer',
              }
            }
          }
          logMCPDebug(
            this.serverName,
            `No valid tokens in storage, clearing stored tokens`,
          )
          await this.invalidateCredentials('tokens')
          emitRefreshEvent('failure', 'invalid_grant')
          return undefined
        }

// 【重试白名单：三类临时性错误】
//
//     ① message 匹配 timeout|timed out|etimedout|econnreset
//        → 网络层抖动。注意是正则不区分大小写（i 标志）。
//
//     ② SDK 的 ServerError（5xx）
//     ③ SDK 的 TemporarilyUnavailableError（503）
//     ④ SDK 的 TooManyRequestsError（429）
//
//   后三个是 SDK 已经归好类的，比字符串匹配可靠。
//
//   ── 为什么 ① 只能用字符串匹配 ──
//
//   因为网络错误在 Node 里是 Error + code 属性（ECONNRESET 等），
//   不是专门的类。而 axios 的错误、undici 的错误、DNS 错误
//   各有各的形态。匹配 message 是最省事的兜底。
//
//   风险：某些非网络错误的 message 里恰好含 "timeout" 会被误重试。
//   误重试的代价是「多等 3 秒然后同样失败」，可接受。
//
//   【判断错误「可不可重试」的可靠顺序】
//   错误类型 > 错误码 > message 匹配。能用前面的就别用后面的。
        // Retry on timeouts or transient server errors
        const isTimeoutError =
          error instanceof Error &&
          /timeout|timed out|etimedout|econnreset/i.test(error.message)
        const isTransientServerError =
          error instanceof ServerError ||
          error instanceof TemporarilyUnavailableError ||
          error instanceof TooManyRequestsError
        const isRetryable = isTimeoutError || isTransientServerError

        if (!isRetryable || attempt >= MAX_ATTEMPTS) {
          logMCPDebug(
            this.serverName,
            `Token refresh failed: ${errorMessage(error)}`,
          )
          emitRefreshEvent(
            'failure',
            isRetryable ? 'transient_retries_exhausted' : 'request_failed',
          )
          return undefined
        }

// 【指数退避 1s / 2s / 4s，没有抖动】
//
//   `1000 * Math.pow(2, attempt - 1)`，attempt 从 1 开始：
//   attempt=1 → 1000ms，attempt=2 → 2000ms，attempt=3 → 但 3 次用尽就退出了。
//
//   所以实际只有两次 sleep：1 秒、2 秒。总阻塞上限 3 秒。
//
//   ── 为什么这里不需要抖动 ──
//
//   抖动是为了打散**多个独立客户端**的重试节奏（防止同时打服务器）。
//   这里是单个 CLI 进程内的顺序重试，天然没有同步问题。
//
//   对比 2121 行那个锁重试 —— 那里多个进程在等同一个锁，所以必须抖动。
//
//   【同一个概念（重试退避）在两种场景下的正确形态不同。】
//   照抄代码之前先确认场景是否相同。
        const delayMs = 1000 * Math.pow(2, attempt - 1) // 1s, 2s, 4s
        logMCPDebug(
          this.serverName,
          `Token refresh failed, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`,
        )
        await sleep(delayMs)
      }
    }

    return undefined
  }
}

// 【readClientSecret：三种环境的三种处理】
//
//   ① 有环境变量 MCP_CLIENT_SECRET → 直接用（CI / 自动化）
//   ② 没有 TTY → 直接报错，并**告诉用户该怎么办**
//      "No TTY available to prompt for client secret. Set MCP_CLIENT_SECRET env var instead."
//      这是好错误文案：说了现象（没有 TTY）+ 说了方案（设环境变量）。
//   ③ 有 TTY → 交互式读，不回显
//
//   ── ② 那个分支很重要 ──
//
//   如果没有这个检查，在管道/重定向环境下
//   `process.stdin.on('data')` 永远不会收到数据（或者立即 EOF），
//   Promise 永远不 resolve —— 进程静默挂住。
//
//   比报错更糟的是挂住：用户不知道发生了什么。
//
//   【凡是要读 stdin 的地方，先判 isTTY】
export async function readClientSecret(): Promise<string> {
  const envSecret = process.env.MCP_CLIENT_SECRET
  if (envSecret) {
    return envSecret
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'No TTY available to prompt for client secret. Set MCP_CLIENT_SECRET env var instead.',
    )
  }

// 【raw mode + 手动处理退格和 Ctrl-C —— 为了不回显】
//
//   `setRawMode(true)` 关掉终端的行缓冲和回显。
//   于是每个按键立即以 data 事件到达，且**不显示在屏幕上**。
//   这就是密码输入框的终端实现方式。
//
//   代价：raw mode 下终端不再帮你处理控制字符，全得自己来：
//
//     Enter      提交（终端发 \n 或 \r，两种都要认）
//     Ctrl-C     取消（ETX，码位 \u0003）→ reject('Cancelled')
//     Backspace  退格（DEL，码位 \u007F；或 BS，即 \b）
//                这两个都要处理，不同终端发的不同
//
//   ── 一个细节：每次按键都可能收到多个字符 ──
//
//   粘贴时 `ch.toString()` 会是多个字符。这里用 `secret += c` 追加，
//   所以粘贴也能工作（但没有逐字符回显，用户看到的是「什么都没发生」）。
//   对 client secret 这种一次性输入来说够用。
//
//   ── 退出时没恢复 raw mode 的风险 ──
//
//   只在提交和 Ctrl-C 两个分支恢复。如果进程在这中间被 kill，
//   终端会卡在 raw mode（回车不换行）。这需要 `stty sane` 才能恢复。
//
//   【健壮做法是 try/finally 恢复，这里没做 —— 因为 kill 时 finally 也不执行。】
//   真正可靠的做法是监听 process.on('exit')，但也只能尽力。
  return new Promise((resolve, reject) => {
    process.stderr.write('Enter OAuth client secret: ')
    process.stdin.setRawMode?.(true)
    let secret = ''
    const onData = (ch: Buffer) => {
      const c = ch.toString()
      if (c === '\n' || c === '\r') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        process.stderr.write('\n')
        resolve(secret)
      } else if (c === '\u0003') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        reject(new Error('Cancelled'))
      } else if (c === '\u007F' || c === '\b') {
        secret = secret.slice(0, -1)
      } else {
        secret += c
      }
    }
    process.stdin.on('data', onData)
  })
}

// 【clientSecret 单独存 mcpOAuthClientConfig，和 token 分开】
//
//   这个设计在前面出现过两次（690 行的读取、1482 行的回退），
//   这里补上「为什么」：
//
//   ── 生命周期完全不同 ──
//
//     token         会被频繁清：刷新失败、用户点清除、step-up 重新授权
//     clientSecret  是长期配置：用户 `mcp add` 时填一次，之后不该被动
//
//   如果存在一起（都在 mcpOAuth[serverKey] 里）：
//   `invalidateCredentials('tokens')` 的实现是
//   `tokenData.accessToken = ''` —— 只改 token 字段，secret 确实不受影响。
//
//   但 `invalidateCredentials('all')` 和 `revokeServerTokens` 会删整个 entry。
//   那时候 secret 就跟着丢了。而丢 secret 的后果比丢 token 严重得多：
//   用户得重新去管理员那里要一次密钥。
//
//   ── 另一层理由：secret 不进 token entry 就不会被当成 token 导出 ──
//
//   有些诊断功能会导出「token 状态」（不含值，但含结构）。
//   分开存让这类功能天然不会碰到 secret。
//
//   【存储分组的依据】不是「属于同一个实体」，而是「生命周期和敏感度」
//   是否一致。
export function saveMcpClientSecret(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  clientSecret: string,
): void {
  const storage = getSecureStorage()
  const existingData = storage.read() || {}
  const serverKey = getServerKey(serverName, serverConfig)
  storage.update({
    ...existingData,
    mcpOAuthClientConfig: {
      ...existingData.mcpOAuthClientConfig,
      [serverKey]: { clientSecret },
    },
  })
}

// 【clearMcpClientConfig vs clearServerTokensFromLocalStorage】
//
//   两个函数名字很像，作用域完全不同：
//
//     clearServerTokensFromLocalStorage  删 mcpOAuth[serverKey]（token + clientId + discovery）
//     clearMcpClientConfig               删 mcpOAuthClientConfig[serverKey]（只有 secret）
//
//   ── 谁调 clearMcpClientConfig ──
//
//   用户改配置（换了 secret）、或者 `mcp remove` 时。
//   注意它**不动 token** —— 换了 secret 但 token 还在有效期内时，
//   现有 token 仍然可用（它不依赖 secret 验证），所以不清是对的。
//
//   【两个相似名字的函数，注释里要写清「它和另一个的区别」】
//   否则半年后没人敢动。
export function clearMcpClientConfig(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): void {
  const storage = getSecureStorage()
  const existingData = storage.read()
  if (!existingData?.mcpOAuthClientConfig) return
  const serverKey = getServerKey(serverName, serverConfig)
  if (existingData.mcpOAuthClientConfig[serverKey]) {
    delete existingData.mcpOAuthClientConfig[serverKey]
    storage.update(existingData)
  }
}

export function getMcpClientConfig(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): { clientSecret?: string } | undefined {
  const storage = getSecureStorage()
  const data = storage.read()
  const serverKey = getServerKey(serverName, serverConfig)
  return data?.mcpOAuthClientConfig?.[serverKey]
}

// 【getScopeFromMetadata：三个字段的回退链，全是非标准的】
//
//   OAuth 标准里**没有**任何一个字段表示「这个 AS 默认要什么 scope」。
//   RFC 8414 只定义了 scopes_supported（服务器支持哪些），
//   它是**可用集合**，不是**必需集合**。
//
//   所以这里依次尝试：
//
//     ① scope            非标准，部分服务器这么写
//     ② default_scope    非标准，OIDC 阵营常见
//     ③ scopes_supported 标准，但语义是「支持」不是「默认」
//
//   ── ③ 作为最后兜底其实是有问题的 ──
//
//   把「支持的 20 个 scope」全申请一遍，用户会看到
//   一个要求全部权限的授权页。很多用户会因此拒绝。
//
//   但反过来说，不申请可能不够用（连上就 403）。
//   两害相权，这里选了「多要」—— 因为 403 是硬失败，
//   而授权页太吓人只是体验问题。
//
//   【这是一个可以争论的默认值】注释里没写这个权衡，值得补。
//
//   ── 三个 if 都用了 `'x' in metadata` 而不是直接取属性 ──
//
//   因为 metadata 是联合类型（OAuthMetadata | OpenIdProviderDiscoveryMetadata），
//   直接访问会 TS 报错。`in` 收窄是标准做法。
//   2445 行的返回类型是 string | undefined —— 所有分支都必须有 return。
/**
 * Safely extracts scope information from AuthorizationServerMetadata.
 * The metadata can be either OAuthMetadata or OpenIdProviderDiscoveryMetadata,
 * and different providers use different fields for scope information.
 */
function getScopeFromMetadata(
  metadata: AuthorizationServerMetadata | undefined,
): string | undefined {
  if (!metadata) return undefined
// 【顺序本身就是信息：先非标准、后标准】
//
//   看起来应该「先用标准字段」，但这里反过来了。
//
//   原因是语义：
//     scope / default_scope  是「该用什么」→ 明确意图
//     scopes_supported       是「能用什么」→ 能力清单
//
//   当服务器同时提供时，前者的意图更精确。
//   标准字段在这里反而是最粗的那个，所以放最后。
//
//   【「标准优先」不是无条件正确的】
//   标准字段往往是最大公约数（表达力最弱），
//   非标准字段常常表达了标准没覆盖的精确意图。
//
//   判断顺序应该按「哪个更贴近真实意图」，不是按「哪个更标准」。
  // Try 'scope' first (non-standard but used by some providers)
  if ('scope' in metadata && typeof metadata.scope === 'string') {
    return metadata.scope
  }
  // Try 'default_scope' (non-standard but used by some providers)
  if (
    'default_scope' in metadata &&
    typeof metadata.default_scope === 'string'
  ) {
    return metadata.default_scope
  }
  // Fall back to scopes_supported (standard OAuth 2.0 field)
// 【数组 join(' ') —— OAuth scope 的传输格式就是空格分隔】
//
//   scopes_supported 是 string[]，但 OAuth 协议里的 scope 参数
//   是**空格分隔的单个字符串**（RFC 6749 §3.3）。
//
//   所以这里必须转换。类似的转换在本文件里出现多次：
//     1628 行  scope.split(' ')     读的时候拆
//     1631 行  pending.split(' ')   比较时拆
//     2462 行  join(' ')            写的时候拼
//
//   ── 这类「存储格式 vs 传输格式」的转换散落各处是个隐患 ──
//
//   如果某天服务器返回的 scope 里含逗号（不规范但存在），
//   split(' ') 就会切错。更稳的做法是 `split(/\s+/)` + filter(Boolean)，
//   但现状能用，没改。
//
//   【看到同一种转换在文件里出现三次以上，就该抽成工具函数。】
//   这里是本文件里最明确的「该抽而未抽」的一处。
  if (metadata.scopes_supported && Array.isArray(metadata.scopes_supported)) {
    return metadata.scopes_supported.join(' ')
  }
  return undefined
}
