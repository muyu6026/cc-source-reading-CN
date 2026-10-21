// ═══════════════════════════════════════════════════════════════
//  XAA 的「一次浏览器弹窗」—— id_token 的获取与缓存
// ═══════════════════════════════════════════════════════════════
//
//   上一份文件（xaa.ts）假设「手上已经有一个 id_token」。这个文件负责把它拿到。
//
//   它是整条 XAA 价值链条上唯一需要人类动作的地方：
//   一次 OIDC 登录（authorization_code + PKCE）→ 缓存 id_token →
//   之后 N 个 MCP 服务器都拿它去换 token，全程不再打扰用户。
//
// 【为什么缓存键是 IdP issuer，不是服务器名】
//
//   如果按服务器缓存，10 个服务器就是 10 个 id_token、10 次登录 ——
//   那 XAA 就完全失去意义了。按 issuer 缓存才能做到
//   「同一个 IdP 下的所有服务器共用一次登录」。
//
//   这个文件的三块：
//     ① 32-194    缓存读写（id_token 与 client_secret 分两个槽位）
//     ② 196-263   OIDC 发现 + JWT 解码（不验签，理由见 239 行）
//     ③ 265-487   回调服务器 + 完整登录流程
//
//   第 ③ 块和 auth.ts 里的回调服务器是**同构**的 —— 同样的
//   resolveOnce/rejectOnce、同样的 unref、同样的空 error handler。
//   同一个模式在一个代码库里出现第二次，说明它是规范而不是巧合。
/**
 * XAA IdP Login — acquires an OIDC id_token from an enterprise IdP via the
 * standard authorization_code + PKCE flow, then caches it by IdP issuer.
 *
 * This is the "one browser pop" in the XAA value prop: one IdP login → N silent
 * MCP server auths. The id_token is cached in the keychain and reused until expiry.
 */

import {
  exchangeAuthorization,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  type OAuthClientInformation,
  type OpenIdProviderDiscoveryMetadata,
  OpenIdProviderDiscoveryMetadataSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { randomBytes } from 'crypto'
import { createServer, type Server } from 'http'
import { parse } from 'url'
import xss from 'xss'
import { openBrowser } from '../../utils/browser.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { toError } from '../../utils/errors.js'
import { logMCPDebug } from '../../utils/log.js'
import { getPlatform } from '../../utils/platform.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { buildRedirectUri, findAvailablePort } from './oauthPort.js'

// 【为什么不用 process.env.X ? ... : ...】
//
//   env 里的 "false" 和 "0" 是非空字符串，在 JS 里都是真值。
//   直接判 truthiness 会让 CLAUDE_CODE_ENABLE_XAA=0 **开启** XAA 功能 ——
//   用户以为关掉了，其实开着。
//
//   isEnvTruthy 是这类陷阱的统一解，全仓库的环境开关都走它。
export function isXaaEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_XAA)
}

export type XaaIdpSettings = {
  issuer: string
  clientId: string
  callbackPort?: number
}

// 【类型系统里不存在的字段】
//
//   settings.xaaIdp 在 SettingsSchema 里是 env-gated 的：
//   只有开了 XAA 才会进 schema，所以 SDK 的类型推导里没有它。
//   编译器认为这个字段不存在，运行时它却真的存在。
//
//   注释说「这是唯一一处 cast」。这类「受环境影响的字段」天生有两套真相：
//   编译期看到的是保守子集，运行期是全集。cast 是承认这个裂缝，
//   而不是消灭它 —— 所以必须只此一处，多了就说明类型设计出了问题。
/**
 * Typed accessor for settings.xaaIdp. The field is env-gated in SettingsSchema
 * so it doesn't surface in SDK types/docs — which means the inferred settings
 * type doesn't have it at compile time. This is the one cast.
 */
export function getXaaIdpSettings(): XaaIdpSettings | undefined {
  return (getInitialSettings() as { xaaIdp?: XaaIdpSettings }).xaaIdp
}

// 【三个时间尺度，对应三种不同的等待对象】
//
//   5 分钟（登录）   —— 等人。用户要开浏览器、输密码、可能还要过 MFA。
//                       给 30 秒是不合理的，但也不能无限等。
//   30 秒（请求）    —— 等网络。单次 HTTPS 请求的正常上限。
//   60 秒（缓冲）    —— 不是等待，是「提前多久判定过期」（见 99 行）。
//
//   把这三个数放在一起，一眼能看出它们是三种语义，不是三个随手写的魔法数。
const IDP_LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const IDP_REQUEST_TIMEOUT_MS = 30000
const ID_TOKEN_EXPIRY_BUFFER_S = 60

export type IdpLoginOptions = {
  idpIssuer: string
  idpClientId: string
  /**
   * Optional IdP client secret for confidential clients. Auth method
   * (client_secret_post, client_secret_basic, none) is chosen per IdP
   * metadata. Omit for public clients (PKCE only).
   */
  idpClientSecret?: string
  /**
   * Fixed callback port. If omitted, a random port is chosen.
   * Use this when the IdP client is pre-registered with a specific loopback
   * redirect URI (RFC 8252 §7.3 says IdPs SHOULD accept any port for
   * http://localhost, but many don't).
   */
  callbackPort?: number
  /** Called with the authorization URL before (or instead of) opening the browser */
  onAuthorizationUrl?: (url: string) => void
  /** If true, don't auto-open the browser — just call onAuthorizationUrl */
  skipBrowserOpen?: boolean
  abortSignal?: AbortSignal
}

// 【缓存键必须归一，否则永远命中不了】
//
//   用户在配置里写 https://idp.example.com，OIDC 发现返回的 issuer
//   可能是 https://idp.example.com/ （带尾斜杠），
//   Azure AD 甚至可能大小写不同。
//
//   不归一 → 每次查缓存都 miss → **每次启动都要弹一次浏览器**。
//   症状是「XAA 好像没生效」，而配置看上去完全正确。
//
//   导出这个函数是为了让 setup 命令用**同一套归一逻辑**去比较 issuer，
//   否则「设置时认为两个 issuer 相同、读取时认为不同」这种不对称 bug 极难查。
/**
 * Normalize an IdP issuer URL for use as a cache key: strip trailing slashes,
 * lowercase host. Issuers from config and from OIDC discovery may differ
 * cosmetically but should hit the same cache slot. Exported so the setup
 * command can compare issuers using the same normalization as keychain ops.
 */
export function issuerKey(issuer: string): string {
  try {
    const u = new URL(issuer)
    u.pathname = u.pathname.replace(/\/+$/, '')
    u.host = u.host.toLowerCase()
    return u.toString()
  } catch {
    return issuer.replace(/\/+$/, '')
  }
}

// 【60 秒缓冲：为什么不能等「真的过期」】
//
//   一个 id_token 在 XAA 流程里要被用两次（token exchange、jwt-bearer），
//   中间还夹着两次发现请求。如果缓存里存的是「还剩 5 秒」的 token，
//   第二跳很可能在半路过期，错误信息会指向完全错误的方向。
//
//   60 秒是「够走完整个流程」的经验值：宁可多登一次，也不要中途失败。
//   这类「提前量」的取值依据永远是**下游用它需要多久**，不是 token 的寿命比例。
/**
 * Read a cached id_token for the given IdP issuer from secure storage.
 * Returns undefined if missing or within ID_TOKEN_EXPIRY_BUFFER_S of expiring.
 */
export function getCachedIdpIdToken(idpIssuer: string): string | undefined {
  const storage = getSecureStorage()
  const data = storage.read()
  const entry = data?.mcpXaaIdp?.[issuerKey(idpIssuer)]
  if (!entry) return undefined
  const remainingMs = entry.expiresAt - Date.now()
  if (remainingMs <= ID_TOKEN_EXPIRY_BUFFER_S * 1000) return undefined
  return entry.idToken
}

function saveIdpIdToken(
  idpIssuer: string,
  idToken: string,
  expiresAt: number,
): void {
  const storage = getSecureStorage()
  const existing = storage.read() || {}
  storage.update({
    ...existing,
    mcpXaaIdp: {
      ...existing.mcpXaaIdp,
      [issuerKey(idpIssuer)]: { idToken, expiresAt },
    },
  })
}

// 给 conformance 测试用的注入口：mock IdP 只给一张预签的 token，
// 不实现 /authorize 端点。所以需要一条「直接塞进缓存」的旁路。
//
// 注意它和 acquireIdpIdToken 用的是**同一个缓存槽位**（都走 saveIdpIdToken），
// 所以测试路径和生产路径读到的数据结构完全一致 —— 测试才有意义。
/**
 * Save an externally-obtained id_token into the XAA cache — the exact slot
 * getCachedIdpIdToken/acquireIdpIdToken read from. Used by conformance testing
 * where the mock IdP hands us a pre-signed token but doesn't serve /authorize.
 *
 * Parses the JWT's exp claim for cache TTL (same as acquireIdpIdToken).
 * Returns the expiresAt it computed so the caller can report it.
 */
export function saveIdpIdTokenFromJwt(
  idpIssuer: string,
  idToken: string,
): number {
  const expFromJwt = jwtExp(idToken)
  const expiresAt = expFromJwt ? expFromJwt * 1000 : Date.now() + 3600 * 1000
  saveIdpIdToken(idpIssuer, idToken, expiresAt)
  return expiresAt
}

export function clearIdpIdToken(idpIssuer: string): void {
  const storage = getSecureStorage()
  const existing = storage.read()
  const key = issuerKey(idpIssuer)
  if (!existing?.mcpXaaIdp?.[key]) return
  delete existing.mcpXaaIdp[key]
  storage.update(existing)
}

// 【client_secret 和 id_token 为什么要分两个槽位】
//
//   注释说「不同信任域」，具体拆开看：
//
//     mcpXaaIdp        id_token    短命会话凭据，几小时后就没用
//     mcpXaaIdpConfig  clientSecret 长期配置，要用户去 IdP 后台改
//
//   混在一个槽位的后果：任何「清 token」的操作（比如 claude mcp xaa clear）
//   都会顺手删掉 secret —— 而 secret 用户自己拿不回来，得找管理员重新发。
//
//   返回 { success, warning } 而不是 void：keychain 写入会失败
//   （锁屏、security 命令非零退出）。吞掉失败的表现是「保存成功」，
//   两小时后认证报 invalid_client，用户完全无法把两件事关联起来。
//   **静默失败比报错更难查。**
/**
 * Save an IdP client secret to secure storage, keyed by IdP issuer.
 * Separate from MCP server AS secrets — different trust domain.
 * Returns the storage update result so callers can surface keychain
 * failures (locked keychain, `security` nonzero exit) instead of
 * silently dropping the secret and failing later with invalid_client.
 */
export function saveIdpClientSecret(
  idpIssuer: string,
  clientSecret: string,
): { success: boolean; warning?: string } {
  const storage = getSecureStorage()
  const existing = storage.read() || {}
  return storage.update({
    ...existing,
    mcpXaaIdpConfig: {
      ...existing.mcpXaaIdpConfig,
      [issuerKey(idpIssuer)]: { clientSecret },
    },
  })
}

/**
 * Read the IdP client secret for the given issuer from secure storage.
 */
export function getIdpClientSecret(idpIssuer: string): string | undefined {
  const storage = getSecureStorage()
  const data = storage.read()
  return data?.mcpXaaIdpConfig?.[issuerKey(idpIssuer)]?.clientSecret
}

/**
 * Remove the IdP client secret for the given issuer from secure storage.
 * Used by `claude mcp xaa clear`.
 */
export function clearIdpClientSecret(idpIssuer: string): void {
  const storage = getSecureStorage()
  const existing = storage.read()
  const key = issuerKey(idpIssuer)
  if (!existing?.mcpXaaIdpConfig?.[key]) return
  delete existing.mcpXaaIdpConfig[key]
  storage.update(existing)
}

// 【本文件最有教育意义的一处：URL 拼接的两个坑】
//
//   下面那段英文注释讲的是第一个坑（前导斜杠 = 绝对路径引用，丢掉 pathname）。
//   这里补上它没写的两个延伸：
//
//   ── 坑一的具体后果不只是 404 ──
//
//     Azure AD 的 issuer 是 https://login.microsoftonline.com/{tenant}/v2.0。
//     用绝对路径拼，请求的是 https://login.microsoftonline.com/.well-known/...，
//     拿到的可能是**另一个租户**的配置（多租户端点会返回默认租户）。
//     这时认证会「成功」，但签出来的 token 属于错误的租户 ——
//     比 404 糟糕得多，因为没有任何错误提示。
//
//   ── 坑二：base 必须以斜杠结尾 ──
//
//     new URL('.well-known/x', 'https://a/b')  →  https://a/.well-known/x
//     最后一节 b 被当成文件名替换掉了。
//     new URL('.well-known/x', 'https://a/b/') →  https://a/b/.well-known/x
//     URL 解析里「a/ 后面接相对路径 = 追加，a 后面接 = 替换」，
//     这跟文件系统的 dirname 行为一致。
//
//   所以 205 行的 endsWith('/') 判断不是防御性代码，是**必需的前置条件**。
//   两行合起来才对，删掉任一行都会在某个真实 IdP 上炸。
// OIDC Discovery §4.1 says `{issuer}/.well-known/openid-configuration` — path
// APPEND, not replace. `new URL('/.well-known/...', issuer)` with a leading
// slash is a WHATWG absolute-path reference and drops the issuer's pathname,
// breaking Azure AD (`login.microsoftonline.com/{tenant}/v2.0`), Okta custom
// auth servers, and Keycloak realms. Trailing-slash base + relative path is
// the fix. Exported because auth.ts needs the same discovery.
export async function discoverOidc(
  idpIssuer: string,
): Promise<OpenIdProviderDiscoveryMetadata> {
  const base = idpIssuer.endsWith('/') ? idpIssuer : idpIssuer + '/'
// 这一行和 206 行是一对：base 补尾斜杠 + 相对路径。
// 少补斜杠 → 丢掉 issuer 的最后一节；用带前导斜杠的路径 → 丢掉整个 pathname。
  const url = new URL('.well-known/openid-configuration', base)
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(IDP_REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `XAA IdP: OIDC discovery failed: HTTP ${res.status} at ${url}`,
    )
  }
// 强制门户/反向代理返回 200 + HTML，res.json() 会抛一个裸的 SyntaxError。
// 不包一层的话，用户看到的是「Unexpected token < in JSON at position 0」，
// 完全无法联想到「连的是酒店 WiFi」。
  // Captive portals and proxy auth pages return 200 with HTML. res.json()
  // throws a raw SyntaxError before safeParse can give a useful message.
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new Error(
      `XAA IdP: OIDC discovery returned non-JSON at ${url} (captive portal or proxy?)`,
    )
  }
  const parsed = OpenIdProviderDiscoveryMetadataSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error(`XAA IdP: invalid OIDC metadata: ${parsed.error.message}`)
  }
// 元数据里的 token_endpoint 同样必须强制 HTTPS，理由和 xaa.ts 的 195 行一样：
// 真正承载凭据的是这个 URL，不是 issuer。
//
// 这里的判据是「拒绝 http」，而不是「允许 https」——
// 将来出现新的 scheme（比如某种内部协议）时，默认行为是拒绝而不是放行。
  if (new URL(parsed.data.token_endpoint).protocol !== 'https:') {
    throw new Error(
      `XAA IdP: refusing non-HTTPS token endpoint: ${parsed.data.token_endpoint}`,
    )
  }
  return parsed.data
}

// 【全文最值得读的一段安全论证：为什么不验签】
//
//   下面那段英文注释给的推理链是（值得逐句读）：
//
//     这个 id_token 的唯一用途，是作为 RFC 8693 的 subject_token
//     **送回它自己的签发方**。IdP 会验证自己的签名。
//
//     所以：能伪造一张骗过 IdP 的 token 的攻击者，不需要先骗过我们；
//     伪造不了的攻击者，递过去也是 401。
//     客户端验签在这里**增加代码但不增加安全**。
//
//   --id-token 注入（conformance 用）同理：坏输入最终会被 IdP 拒，
//   不存在提权路径。
//
// 【但这个论证有明确边界，注释也点到了】
//
//   它成立的唯一前提是「**签名验证发生在下游**」。
//   同一个 id_token 一旦被用于**本地授权判断**
//   （比如读 claims 决定「这个用户是不是管理员」），就必须验签 ——
//   因为那时没有下游替你兜底，攻击者伪造的 token 会直接变成权限。
//
//   换句话说：「不验签」是可辩护的，但可辩护的理由是用途，不是省事。
//   判断标准永远是「谁能验证、在什么位置验证」，不是「验签麻不麻烦」。
/**
 * Decode the exp claim from a JWT without verifying its signature.
 * Returns undefined if parsing fails or exp is absent. Used only to
 * derive a cache TTL.
 *
 * Why no signature/iss/aud/nonce validation: per SEP-990, this id_token
 * is the RFC 8693 subject_token in a token-exchange at the IdP's own
 * token endpoint. The IdP validates its own token there. An attacker who
 * can mint a token that fools the IdP has no need to fool us first; an
 * attacker who can't, hands us garbage and gets a 401 from the IdP. The
 * --id-token injection seam is likewise safe: bad input → rejected later,
 * no privesc. Client-side verification would add code and no security.
 */
function jwtExp(jwt: string): number | undefined {
  const parts = jwt.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = jsonParse(
      Buffer.from(parts[1]!, 'base64url').toString('utf-8'),
    ) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch {
    return undefined
  }
}

/**
 * Wait for the OAuth authorization code on a local callback server.
 * Returns the code once /callback is hit with a matching state.
 *
 * `onListening` fires after the socket is actually bound — use it to defer
 * browser-open so EADDRINUSE surfaces before a spurious tab pops open.
 */
// 【和 auth.ts 的回调服务器同构：五个出口全部走幂等 resolve】
//
//   正常 code / IdP 返回 error / state 不匹配 / 缺 code / 用户取消 / 5 分钟超时 /
//   端口被占 —— 七种结局，全部通过 resolveOnce/rejectOnce 收敛。
//
//   为什么必须幂等：原生 Promise 的二次 resolve 是**静默无效**的。
//   如果两个出口几乎同时触发（用户取消的瞬间正好收到回调），
//   后到的那个会以为「我成功让 promise 结束了」，实际什么也没发生。
//   这类 bug 表现为「偶尔卡住」，几乎无法复现。
//
//   onListening 回调的存在理由（434 行）：listen() 是异步的。
//   先开浏览器再 listen，端口被占时用户会看到一个弹窗、然后它自己关掉，
//   而错误在几秒后才出现 —— 用户完全不知道刚才发生了什么。
//   把「开浏览器」放在 socket 真正绑定之后，EADDRINUSE 就会先于弹窗暴露。
function waitForCallback(
  port: number,
  expectedState: string,
  abortSignal: AbortSignal | undefined,
  onListening: () => void,
): Promise<string> {
  let server: Server | null = null
  let timeoutId: NodeJS.Timeout | null = null
  let abortHandler: (() => void) | null = null
// 清理顺序有三处讲究：
//   1. removeAllListeners() 之后再补一个空 error handler ——
//      否则 close() 期间迟到的 error 事件会变成 uncaught exception。
//   2. timeoutId 必须清，否则进程要等 5 分钟才能退出。
//   3. abort 监听必须摘，否则 abortSignal 会持有这个闭包（内存泄漏）。
//
//   后面 387、393 行的两个 unref() 是同一个意思的另一半：
//   宁可进程直接退出，也不要因为一个已经没人等的回调服务器而挂住不退。
  const cleanup = () => {
    server?.removeAllListeners()
    // Defensive: removeAllListeners() strips the error handler, so swallow any late error during close
    server?.on('error', () => {})
    server?.close()
    server = null
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener('abort', abortHandler)
      abortHandler = null
    }
  }
  return new Promise<string>((resolve, reject) => {
    let resolved = false
    const resolveOnce = (v: string) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(v)
    }
    const rejectOnce = (e: Error) => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(e)
    }

    if (abortSignal) {
      abortHandler = () => rejectOnce(new Error('XAA IdP: login cancelled'))
      if (abortSignal.aborted) {
        abortHandler()
        return
      }
      abortSignal.addEventListener('abort', abortHandler, { once: true })
    }

    server = createServer((req, res) => {
      const parsed = parse(req.url || '', true)
// 非 /callback 路径直接 404，且**不 reject**。
// 浏览器会自动请求 /favicon.ico，某些安全软件也会探测根路径 ——
// 把这些请求当成「回调失败」的话，一个正常的登录会被无关请求打断。
      if (parsed.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      const code = parsed.query.code as string | undefined
      const state = parsed.query.state as string | undefined
      const err = parsed.query.error as string | undefined

// 【本机回环不等于可信 —— query 参数必须转义】
//
//   error 和 error_description 来自 URL query，直接拼进 HTML 就是反射型 XSS。
//   攻击者只要诱导用户（或其浏览器里的任意网页）访问
//
//     http://127.0.0.1:PORT/callback?error=<script>...</script>
//
//   就能在这个「本机」页面上执行脚本。127.0.0.1 只挡住了**外网直连**，
//   挡不住用户自己浏览器发起的请求。
//
//   两处都过 xss() 而不是只转义 error：description 才是常被忽略的那个。
      if (err) {
        const desc = parsed.query.error_description as string | undefined
        const safeErr = xss(err)
        const safeDesc = desc ? xss(desc) : ''
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(
          `<html><body><h3>IdP login failed</h3><p>${safeErr}</p><p>${safeDesc}</p></body></html>`,
        )
        rejectOnce(new Error(`XAA IdP: ${err}${desc ? ` — ${desc}` : ''}`))
        return
      }

// state 校验 = CSRF 防护。随机源是 417 行的 randomBytes(32)（base64url 后 43 字符）。
//
// 检查顺序也有讲究：error 分支在 state 校验**之前**。
// 因为 IdP 返回 error 时通常不带 state（或带一个不同的），
// 先校验 state 会把「IdP 明确告诉你的错误」变成「state mismatch」，
// 把有用的信息盖掉。
      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h3>State mismatch</h3></body></html>')
        rejectOnce(new Error('XAA IdP: state mismatch (possible CSRF)'))
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h3>Missing code</h3></body></html>')
        rejectOnce(new Error('XAA IdP: callback missing code'))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        '<html><body><h3>IdP login complete — you can close this window.</h3></body></html>',
      )
      resolveOnce(code)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const findCmd =
          getPlatform() === 'windows'
            ? `netstat -ano | findstr :${port}`
            : `lsof -ti:${port} -sTCP:LISTEN`
        rejectOnce(
          new Error(
            `XAA IdP: callback port ${port} is already in use. Run \`${findCmd}\` to find the holder.`,
          ),
        )
      } else {
        rejectOnce(new Error(`XAA IdP: callback server failed: ${err.message}`))
      }
    })

// 【只绑 127.0.0.1】
//
//   绑 0.0.0.0（或省略 host）会让同一个局域网内的任何机器都能往这个回调端口投 code，
//   而这个端口是可以预测的（固定 callbackPort 时）或可扫描的。
//
//   RFC 8252 §7.3 对 loopback 重定向的整个安全模型就建立在「只有本机能连」上，
//   绑 0.0.0.0 等于把这一层彻底拆掉。
    server.listen(port, '127.0.0.1', () => {
      try {
        onListening()
      } catch (e) {
        rejectOnce(toError(e))
      }
    })
    server.unref()
    timeoutId = setTimeout(
      rej => rej(new Error('XAA IdP: login timed out')),
      IDP_LOGIN_TIMEOUT_MS,
      rejectOnce,
    )
    timeoutId.unref()
  })
}

/**
 * Acquire an id_token from the IdP: return cached if valid, otherwise run
 * the full OIDC authorization_code + PKCE flow (one browser pop).
 */
// 【缓存优先，连发现都不做】
//
//   命中缓存时直接返回，不请求 OIDC 发现端点。这意味着**断网也能继续用**：
//   只要 AS 可达，一个缓存里的 id_token 就能换出新的 access_token。
//
//   这个设计对企业场景很重要 —— 内网 IdP 常常在 VPN 之外不可达，
//   但 MCP 服务器（SaaS）是公网可达的。
export async function acquireIdpIdToken(
  opts: IdpLoginOptions,
): Promise<string> {
  const { idpIssuer, idpClientId } = opts

  const cached = getCachedIdpIdToken(idpIssuer)
  if (cached) {
    logMCPDebug('xaa', `Using cached id_token for ${idpIssuer}`)
    return cached
  }

  logMCPDebug('xaa', `No cached id_token for ${idpIssuer}; starting OIDC login`)

  const metadata = await discoverOidc(idpIssuer)
  const port = opts.callbackPort ?? (await findAvailablePort())
  const redirectUri = buildRedirectUri(port)
  const state = randomBytes(32).toString('base64url')
// clientInformation 里只在有 secret 时才带 client_secret 字段。
// 写成 client_secret: opts.idpClientSecret（可能为 undefined）会让 SDK
// 认为这是「一个值为 undefined 的机密客户端」，走的鉴权分支和公共客户端不同。
  const clientInformation: OAuthClientInformation = {
    client_id: idpClientId,
    ...(opts.idpClientSecret ? { client_secret: opts.idpClientSecret } : {}),
  }

  const { authorizationUrl, codeVerifier } = await startAuthorization(
    idpIssuer,
    {
      metadata,
      clientInformation,
      redirectUrl: redirectUri,
      scope: 'openid',
      state,
    },
  )

// 开浏览器必须在 socket 绑定之后，理由见 272 行那段。
// 注意 onAuthorizationUrl 也在同一个回调里触发 ——
// 它是给「无法开浏览器」的场景用的（远程开发机、容器里），
// 用户拿到 URL 自己去本地浏览器打开。这类场景下更不能提前打印 URL。
  // Open the browser only after the socket is actually bound — listen() is
  // async, and on the fixed-callbackPort path EADDRINUSE otherwise surfaces
  // after a spurious tab has already popped. Mirrors the auth.ts pattern of
  // wrapping sdkAuth inside server.listen's callback.
  const authorizationCode = await waitForCallback(
    port,
    state,
    opts.abortSignal,
    () => {
      if (opts.onAuthorizationUrl) {
        opts.onAuthorizationUrl(authorizationUrl.toString())
      }
      if (!opts.skipBrowserOpen) {
        logMCPDebug('xaa', `Opening browser to IdP authorization endpoint`)
        void openBrowser(authorizationUrl.toString())
      }
    },
  )

  const tokens = await exchangeAuthorization(idpIssuer, {
    metadata,
    clientInformation,
    authorizationCode,
    codeVerifier,
    redirectUri,
    fetchFn: (url, init) =>
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      fetch(url, {
        ...init,
        signal: AbortSignal.timeout(IDP_REQUEST_TIMEOUT_MS),
      }),
  })
// 缺 id_token 最常见的真实原因是 scope 没写 openid。
// 有些 IdP 不报错，只是安静地只返回 access_token ——
// 于是下游会拿一个 undefined 去换 ID-JAG，报错信息完全对不上原因。
// 所以这里必须显式判，并且在错误信息里点出「check scope=openid」。
  if (!tokens.id_token) {
    throw new Error(
      'XAA IdP: token response missing id_token (check scope=openid)',
    )
  }

// 【expiresAt 优先取 JWT 自己的 exp，而不是 expires_in】
//
//   expires_in 描述的是 **access_token** 的寿命。
//   id_token 的寿命可能完全不同（OIDC 里 id_token 通常干脆不带 expires_in）。
//
//   取错了的两种后果：
//     - 取到偏长的值 → 缓存里存着一个已过期的 id_token，下次直接拿去换票失败
//     - 取到偏短的值 → 一个还能用一小时的 token 被提前丢弃，用户多登一次
//
//   三者都缺失时默认 1 小时：这是最常见的 IdP 默认值，
//   而且偏保守（宁可早一点重登，不要晚）。
//
  // Prefer the id_token's own exp claim; fall back to expires_in.
  // expires_in is for the access_token and may differ from the id_token
  // lifetime. If neither is present, default to 1h.
  const expFromJwt = jwtExp(tokens.id_token)
  const expiresAt = expFromJwt
    ? expFromJwt * 1000
    : Date.now() + (tokens.expires_in ?? 3600) * 1000

  saveIdpIdToken(idpIssuer, tokens.id_token, expiresAt)
  logMCPDebug(
    'xaa',
    `Cached id_token for ${idpIssuer} (expires ${new Date(expiresAt).toISOString()})`,
  )

  return tokens.id_token
}
