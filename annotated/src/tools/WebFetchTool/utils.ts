import axios, { type AxiosResponse } from 'axios'
import { LRUCache } from 'lru-cache'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { queryHaiku } from '../../services/api/claude.js'
import { AbortError } from '../../utils/errors.js'
import { getWebFetchUserAgent } from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import {
  isBinaryContentType,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { isPreapprovedHost } from './preapproved.js'
import { makeSecondaryModelPrompt } from './prompt.js'

// Custom error classes for domain blocking
// 三个领域级错误类：DomainBlockedError（域在服务端黑名单）、
// DomainCheckFailedError（预检本身失败——网络限制或企业策略挡了 claude.ai）、
// EgressBlockedError（出网代理 403 拦截）。第三个的 message 是 JSON 字符串，
// 供上层按结构化错误解析。
class DomainBlockedError extends Error {
  constructor(domain: string) {
    super(`Claude Code is unable to fetch from ${domain}`)
    this.name = 'DomainBlockedError'
  }
}

class DomainCheckFailedError extends Error {
  constructor(domain: string) {
    super(
      `Unable to verify if domain ${domain} is safe to fetch. This may be due to network restrictions or enterprise security policies blocking claude.ai.`,
    )
    this.name = 'DomainCheckFailedError'
  }
}

class EgressBlockedError extends Error {
  constructor(public readonly domain: string) {
    super(
      JSON.stringify({
        error_type: 'EGRESS_BLOCKED',
        domain,
        message: `Access to ${domain} is blocked by the network egress proxy.`,
      }),
    )
    this.name = 'EgressBlockedError'
  }
}

// Cache for storing fetched URL content
type CacheEntry = {
  bytes: number
  code: number
  codeText: string
  content: string
  contentType: string
  persistedPath?: string
  persistedSize?: number
}
// 缓存条目：原始字节、HTTP 状态、markdown 正文、contentType，
// 外加二进制内容落盘后的路径与大小（PDF 等场景）。

// Cache with 15-minute TTL and 50MB size limit
// LRUCache handles automatic expiration and eviction
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB
// 15 分钟 TTL + 50MB 容量上限；LRUCache 自动过期与逐出，
// 按 contentBytes 计 size（空响应钳到 1，lru-cache 要求正整数）。

const URL_CACHE = new LRUCache<string, CacheEntry>({
  maxSize: MAX_CACHE_SIZE_BYTES,
  ttl: CACHE_TTL_MS,
})
// DOMAIN_CHECK_CACHE 与 URL_CACHE 分开的原因：URL 缓存按完整 URL 键控，
// 同域两个路径会触发两次一模一样的预检 HTTP 往返；这里按主机名缓存。
// 只缓存 allowed——blocked/failed 下次重查（黑名单可能随时变化）。

// Separate cache for preflight domain checks. URL_CACHE is URL-keyed, so
// fetching two paths on the same domain triggers two identical preflight
// HTTP round-trips to api.anthropic.com. This hostname-keyed cache avoids
// that. Only 'allowed' is cached — blocked/failed re-check on next attempt.
const DOMAIN_CHECK_CACHE = new LRUCache<string, true>({
  max: 128,
  ttl: 5 * 60 * 1000, // 5 minutes — shorter than URL_CACHE TTL
})

export function clearWebFetchCache(): void {
  URL_CACHE.clear()
  DOMAIN_CHECK_CACHE.clear()
}
// 清缓存入口（/clear 等场景调用）。

// Lazy singleton — defers the turndown → @mixmark-io/domino import (~1.4MB
// retained heap) until the first HTML fetch, and reuses one instance across
// calls (construction builds 15 rule objects; .turndown() is stateless).
// @types/turndown ships only `export =` (no .d.mts), so TS types the import
// as the class itself while Bun wraps CJS in { default } — hence the cast.
// turndown 惰性单例：把 turndown + domino 约 1.4MB 的常驻堆推迟到第一次
// 抓 HTML 才加载；实例跨调用复用（构造要建 15 条规则，.turndown() 本身无状态）。
// @types/turndown 只有 export = 声明，Bun 又把 CJS 包进 default——所以有那个 cast。
type TurndownCtor = typeof import('turndown')
let turndownServicePromise: Promise<InstanceType<TurndownCtor>> | undefined
function getTurndownService(): Promise<InstanceType<TurndownCtor>> {
  return (turndownServicePromise ??= import('turndown').then(m => {
    const Turndown = (m as unknown as { default: TurndownCtor }).default
    return new Turndown()
  }))
}

// PSR requested limiting the length of URLs to 250 to lower the potential
// for a data exfiltration. However, this is too restrictive for some customers'
// legitimate use cases, such as JWT-signed URLs (e.g., cloud service signed URLs)
// that can be much longer. We already require user approval for each domain,
// which provides a primary security boundary. In addition, Claude Code has
// other data exfil channels, and this one does not seem relatively high risk,
// so I'm removing that length restriction. -ab
const MAX_URL_LENGTH = 2000
// URL 长度上限 2000：PSR 最初要求 250 字符防数据外带，但对 JWT 签名的
// 云服务预签名 URL 太紧；鉴于每个域都要用户批准（主安全边界），放宽到 2000。
// 注释里保留了这段决策过程（署名 -ab）。

// Per PSR:
// "Implement resource consumption controls because setting limits on CPU,
// memory, and network usage for the Web Fetch tool can prevent a single
// request or user from overwhelming the system."
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024
// 单次请求 10MB 内容上限（PSR 资源消耗控制要求）——防单个请求压垮系统。

// Timeout for the main HTTP fetch request (60 seconds).
// Prevents hanging indefinitely on slow/unresponsive servers.
const FETCH_TIMEOUT_MS = 60_000
// 主抓取 60 秒超时：慢服务器不能把工具挂死。

// Timeout for the domain blocklist preflight check (10 seconds).
const DOMAIN_CHECK_TIMEOUT_MS = 10_000
// 域预检 10 秒超时，比主抓取短。

// Cap same-host redirect hops. Without this a malicious server can return
// a redirect loop (/a → /b → /a …) and the per-request FETCH_TIMEOUT_MS
// resets on every hop, hanging the tool until user interrupt. 10 matches
// common client defaults (axios=5, follow-redirects=21, Chrome=20).
const MAX_REDIRECTS = 10
// 同域重定向跳数上限 10：没有这条，恶意服务器可以返回重定向环
// （/a → /b → /a …），每跳都重置 FETCH_TIMEOUT_MS，工具会一直挂到用户手动中断。
// 10 与常见客户端默认值对齐（axios=5、follow-redirects=21、Chrome=20）。

// Truncate to not spend too many tokens
export const MAX_MARKDOWN_LENGTH = 100_000
// markdown 10 万字符截断：控制喂给次要模型的 token 量。

export function isPreapprovedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)
  } catch {
    return false
  }
}
// 预批准 URL 判定：解析后按 host+path 查 preapproved 清单；解析失败按不批准。

export function validateURL(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) {
    return false
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // We don't need to check protocol here, as we'll upgrade http to https when making the request

  // As long as we aren't supporting aiming to cookies or internal domains,
  // we should block URLs with usernames/passwords too, even though these
  // seem exceedingly unlikely.
  if (parsed.username || parsed.password) {
    return false
  }

  // Initial filter that this isn't a privileged, company-internal URL
  // by checking that the hostname is publicly resolvable
  const hostname = parsed.hostname
  const parts = hostname.split('.')
  if (parts.length < 2) {
    return false
  }

  return true
// validateURL 三道关：长度 ≤2000、可被 URL 解析、不含 user:password
// （防 cookie/内网域之外还有这条口子）、主机名至少两段（挡内网机器名单段名）。
// 协议不查——http 会在抓取时升级成 https。
}

type DomainCheckResult =
  | { status: 'allowed' }
  | { status: 'blocked' }
  | { status: 'check_failed'; error: Error }
// 域检查三态：allowed / blocked / check_failed。
// check_failed 不等于 blocked——网络不通时不能装作「域被禁」，要如实区分。

export async function checkDomainBlocklist(
  domain: string,
): Promise<DomainCheckResult> {
  if (DOMAIN_CHECK_CACHE.has(domain)) {
    return { status: 'allowed' }
  }
  try {
    const response = await axios.get(
      `https://api.anthropic.com/api/web/domain_info?domain=${encodeURIComponent(domain)}`,
      { timeout: DOMAIN_CHECK_TIMEOUT_MS },
    )
    if (response.status === 200) {
      if (response.data.can_fetch === true) {
        DOMAIN_CHECK_CACHE.set(domain, true)
        return { status: 'allowed' }
      }
      return { status: 'blocked' }
    }
    // Non-200 status but didn't throw
    return {
      status: 'check_failed',
      error: new Error(`Domain check returned status ${response.status}`),
    }
  } catch (e) {
    logError(e)
    return { status: 'check_failed', error: e as Error }
  }
}
// 预检实现：打 api.anthropic.com 的 domain_info 接口，can_fetch === true
// 才放行并缓存；非 200 或异常都归 check_failed（记日志但不吞掉）。

// isPermittedRedirect：允许的重定向只有三类——加/去 www.、
// 同源改路径或查询串、或两者组合。协议、端口、凭据任何一项变了都不放行。
/**
 * Check if a redirect is safe to follow
 * Allows redirects that:
 * - Add or remove "www." in the hostname
 * - Keep the origin the same but change path/query params
 * - Or both of the above
 */
export function isPermittedRedirect(
  originalUrl: string,
  redirectUrl: string,
): boolean {
  try {
    const parsedOriginal = new URL(originalUrl)
    const parsedRedirect = new URL(redirectUrl)

    if (parsedRedirect.protocol !== parsedOriginal.protocol) {
      return false
    }

    if (parsedRedirect.port !== parsedOriginal.port) {
      return false
    }

    if (parsedRedirect.username || parsedRedirect.password) {
      return false
    }

    // Now check hostname conditions
    // 1. Adding www. is allowed: example.com -> www.example.com
    // 2. Removing www. is allowed: www.example.com -> example.com
    // 3. Same host (with or without www.) is allowed: paths can change
    const stripWww = (hostname: string) => hostname.replace(/^www\./, '')
    const originalHostWithoutWww = stripWww(parsedOriginal.hostname)
    const redirectHostWithoutWww = stripWww(parsedRedirect.hostname)
    return originalHostWithoutWww === redirectHostWithoutWww
// stripWww 后比主机名：example.com ↔ www.example.com 互通，其余跨域一律拒绝。
  } catch (_error) {
    return false
  }
// getWithPermittedRedirects：手动重定向处理——PSR 明确禁止自动跟随重定向
// （开放重定向漏洞会让受信域名把用户带去恶意域）。maxRedirects: 0 + 递归跟进。
}

/**
 * Helper function to handle fetching URLs with custom redirect handling
 * Recursively follows redirects if they pass the redirectChecker function
 *
 * Per PSR:
 * "Do not automatically follow redirects because following redirects could
 * allow for an attacker to exploit an open redirect vulnerability in a
 * trusted domain to force a user to make a request to a malicious domain
 * unknowingly"
 */
type RedirectInfo = {
  type: 'redirect'
  originalUrl: string
  redirectUrl: string
  statusCode: number
}

export async function getWithPermittedRedirects(
  url: string,
  signal: AbortSignal,
  redirectChecker: (originalUrl: string, redirectUrl: string) => boolean,
  depth = 0,
): Promise<AxiosResponse<ArrayBuffer> | RedirectInfo> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`)
// depth 超过 MAX_REDIRECTS 直接抛错——重定向环的最终兜底。
  }
  try {
    return await axios.get(url, {
      signal,
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      responseType: 'arraybuffer',
      maxContentLength: MAX_HTTP_CONTENT_LENGTH,
      headers: {
        Accept: 'text/markdown, text/html, */*',
        'User-Agent': getWebFetchUserAgent(),
      },
    })
// 请求参数：arraybuffer 响应、10MB 内容上限、自定义 UA、
// Accept 偏好 markdown/html。
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response &&
      [301, 302, 307, 308].includes(error.response.status)
    ) {
// axios 配 maxRedirects:0 时 3xx 会进 catch：解析 Location（相对地址按原 URL
// 补全），检查器放行则递归跟进，不放行则把 RedirectInfo 返回给调用方
// ——让模型自己决定要不要重新请求新地址。
      const redirectLocation = error.response.headers.location
      if (!redirectLocation) {
        throw new Error('Redirect missing Location header')
      }

      // Resolve relative URLs against the original URL
      const redirectUrl = new URL(redirectLocation, url).toString()

      if (redirectChecker(url, redirectUrl)) {
        // Recursively follow the permitted redirect
        return getWithPermittedRedirects(
          redirectUrl,
          signal,
          redirectChecker,
          depth + 1,
        )
      } else {
        // Return redirect information to the caller
        return {
          type: 'redirect',
          originalUrl: url,
          redirectUrl,
          statusCode: error.response.status,
        }
      }
    }

    // Detect egress proxy blocks: the proxy returns 403 with
    // X-Proxy-Error: blocked-by-allowlist when egress is restricted
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 403 &&
      error.response.headers['x-proxy-error'] === 'blocked-by-allowlist'
    ) {
      const hostname = new URL(url).hostname
      throw new EgressBlockedError(hostname)
    }
// 出网代理识别：403 + X-Proxy-Error: blocked-by-allowlist 头
// → 抛 EgressBlockedError（企业环境专有信号）。

    throw error
  }
}

function isRedirectInfo(
  response: AxiosResponse<ArrayBuffer> | RedirectInfo,
): response is RedirectInfo {
  return 'type' in response && response.type === 'redirect'
}
// 类型守卫：RedirectInfo 与 AxiosResponse 靠 type 字段区分。

export type FetchedContent = {
  content: string
  bytes: number
  code: number
  codeText: string
  contentType: string
  persistedPath?: string
  persistedSize?: number
}
// FetchedContent：抓取成功后的统一形状（含可选的二进制落盘信息）。

export async function getURLMarkdownContent(
  url: string,
  abortController: AbortController,
): Promise<FetchedContent | RedirectInfo> {
  if (!validateURL(url)) {
    throw new Error('Invalid URL')
  }

  // Check cache (LRUCache handles TTL automatically)
  const cachedEntry = URL_CACHE.get(url)
  if (cachedEntry) {
    return {
      bytes: cachedEntry.bytes,
      code: cachedEntry.code,
      codeText: cachedEntry.codeText,
      content: cachedEntry.content,
      contentType: cachedEntry.contentType,
      persistedPath: cachedEntry.persistedPath,
      persistedSize: cachedEntry.persistedSize,
    }
  }
// 缓存命中直接展开返回——注意键是原始 URL（升级/重定向前的）。

  let parsedUrl: URL
  let upgradedUrl = url

  try {
    parsedUrl = new URL(url)

    // Upgrade http to https if needed
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:'
      upgradedUrl = parsedUrl.toString()
    }
// http → https 静默升级。

    const hostname = parsedUrl.hostname

    // Check if the user has opted to skip the blocklist check
    // This is for enterprise customers with restrictive security policies
    // that prevent outbound connections to claude.ai
    const settings = getSettings_DEPRECATED()
    if (!settings.skipWebFetchPreflight) {
      const checkResult = await checkDomainBlocklist(hostname)
      switch (checkResult.status) {
        case 'allowed':
          // Continue with the fetch
          break
        case 'blocked':
          throw new DomainBlockedError(hostname)
        case 'check_failed':
          throw new DomainCheckFailedError(hostname)
      }
    }
// 域预检：除非设置 skipWebFetchPreflight（企业安全策略连不上 claude.ai 的
// 客户可跳过），否则先查黑名单——blocked 抛 DomainBlockedError，
// check_failed 抛 DomainCheckFailedError。

    if (process.env.USER_TYPE === 'ant') {
      logEvent('tengu_web_fetch_host', {
        hostname:
          hostname as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
// 仅内部员工（USER_TYPE=ant）上报抓取主机名遥测；
// 类型断言长名是审计标记：声明该字段不是代码/文件路径。
  } catch (e) {
    if (
      e instanceof DomainBlockedError ||
      e instanceof DomainCheckFailedError
    ) {
      // Expected user-facing failures - re-throw without logging as internal error
      throw e
    }
    logError(e)
  }
// DomainBlocked/CheckFailed 是面向用户的预期失败，原样上抛不记内部错误；
// 其他异常记日志后继续（预检失败不中断主流程，靠后面 getWithPermittedRedirects 抛）。

  const response = await getWithPermittedRedirects(
    upgradedUrl,
    abortController.signal,
    isPermittedRedirect,
  )
// 正式抓取：升级后的 URL + isPermittedRedirect 检查器。

  // Check if we got a redirect response
  if (isRedirectInfo(response)) {
    return response
  }
// 拿到的是跨域重定向信息就原样返回——由 WebFetchTool.call 转述给模型。

  const rawBuffer = Buffer.from(response.data)
  // Release the axios-held ArrayBuffer copy; rawBuffer owns the bytes now.
  // This lets GC reclaim up to MAX_HTTP_CONTENT_LENGTH (10MB) before Turndown
  // builds its DOM tree (which can be 3-5x the HTML size).
  ;(response as { data: unknown }).data = null
// 主动释放 axios 持有的 ArrayBuffer 引用：rawBuffer 已接管字节，
// 让 GC 在 Turndown 构建 DOM 树（可达 HTML 的 3-5 倍内存）之前回收最多 10MB。
  const contentType = response.headers['content-type'] ?? ''

  // Binary content: save raw bytes to disk with a proper extension so Claude
  // can inspect the file later. We still fall through to the utf-8 decode +
  // Haiku path below — for PDFs in particular the decoded string has enough
  // ASCII structure (/Title, text streams) that Haiku can summarize it, and
  // the saved file is a supplement rather than a replacement.
  let persistedPath: string | undefined
  let persistedSize: number | undefined
  if (isBinaryContentType(contentType)) {
    const persistId = `webfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await persistBinaryContent(rawBuffer, contentType, persistId)
    if (!('error' in result)) {
      persistedPath = result.filepath
      persistedSize = result.size
    }
  }
// 二进制内容（PDF 等）落盘存原始字节、按 mime 给扩展名，Claude 之后可直接查文件。
// 但仍继续走 utf-8 解码 + Haiku 路径——PDF 解码字符串里通常有足够 ASCII 结构
// （/Title、文本流）可供摘要；落盘文件是补充而非替代。

  const bytes = rawBuffer.length
  const htmlContent = rawBuffer.toString('utf-8')

  let markdownContent: string
  let contentBytes: number
  if (contentType.includes('text/html')) {
    markdownContent = (await getTurndownService()).turndown(htmlContent)
    contentBytes = Buffer.byteLength(markdownContent)
  } else {
    // It's not HTML - just use it raw. The decoded string's UTF-8 byte
    // length equals rawBuffer.length (modulo U+FFFD replacement on invalid
    // bytes — negligible for cache eviction accounting), so skip the O(n)
    // Buffer.byteLength scan.
    markdownContent = htmlContent
    contentBytes = bytes
  }
// HTML 才走 Turndown 转 markdown；非 HTML 原样用，
// 解码串的 UTF-8 字节长 ≈ rawBuffer.length（无效字节换 U+FFFD 可忽略），
// 省掉一次 O(n) 的 Buffer.byteLength 扫描。

  // Store the fetched content in cache. Note that it's stored under
  // the original URL, not the upgraded or redirected URL.
  const entry: CacheEntry = {
    bytes,
// 入缓存：注意键是原始 URL 而非升级后或重定向后的——
// 同一 URL 的重复请求才命中。
    code: response.status,
    codeText: response.statusText,
    content: markdownContent,
    contentType,
    persistedPath,
    persistedSize,
  }
  // lru-cache requires positive integers; clamp to 1 for empty responses.
  URL_CACHE.set(url, entry, { size: Math.max(1, contentBytes) })
  return entry
// 缓存写入（size 按内容字节数，空响应钳 1）。
}

export async function applyPromptToMarkdown(
  prompt: string,
  markdownContent: string,
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
  isPreapprovedDomain: boolean,
): Promise<string> {
  // Truncate content to avoid "Prompt is too long" errors from the secondary model
  const truncatedContent =
    markdownContent.length > MAX_MARKDOWN_LENGTH
      ? markdownContent.slice(0, MAX_MARKDOWN_LENGTH) +
        '\n\n[Content truncated due to length...]'
      : markdownContent
// 超 10 万字符截断并附标记——防次要模型「Prompt is too long」。

  const modelPrompt = makeSecondaryModelPrompt(
    truncatedContent,
    prompt,
    isPreapprovedDomain,
  )
  const assistantMessage = await queryHaiku({
    systemPrompt: asSystemPrompt([]),
    userPrompt: modelPrompt,
    signal,
    options: {
      querySource: 'web_fetch_apply',
      agents: [],
      isNonInteractiveSession,
      hasAppendSystemPrompt: false,
      mcpTools: [],
    },
  })
// queryHaiku：抓取内容由小快模型按用户 prompt 提炼，
// querySource 固定 web_fetch_apply（遥测与重试策略按此分流）。

  // We need to bubble this up, so that the tool call throws, causing us to return
  // an is_error tool_use block to the server, and render a red dot in the UI.
  if (signal.aborted) {
    throw new AbortError()
  }
// 模型调用返回后检查 signal.aborted：中断要主动抛 AbortError，
// 才能让工具调用变成 is_error 块 + UI 红点——否则中断被静默吞掉。

  const { content } = assistantMessage.message
  if (content.length > 0) {
    const contentBlock = content[0]
    if ('text' in contentBlock!) {
      return contentBlock.text
    }
  }
  return 'No response from model'
// 模型回了但首块不是文本块时给兜底文案「No response from model」。
}
