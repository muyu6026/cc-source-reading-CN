import isEqual from 'lodash-es/isEqual.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import { getSettingsForSource } from '../settings/settings.js'
import { plural } from '../stringUtils.js'
import { checkGitAvailable } from './gitAvailability.js'
import { getMarketplace } from './marketplaceManager.js'
import type { KnownMarketplace, MarketplaceSource } from './schemas.js'

// 文件总览：插件市场（marketplace）的「策略与判定」层。负责把配置里的市场源解析成可展示、可校验的形态，并处理企业策略（黑名单 / 白名单）的拦截逻辑。核心函数 isSourceAllowedByPolicy 是下载前的守门员——被封的来源根本不会碰文件系统。
/**
 * Format plugin failure details for user display
 * @param failures - Array of failures with names and reasons
 * @param includeReasons - Whether to include failure reasons (true for full errors, false for summaries)
 * @returns Formatted string like "plugin-a (reason); plugin-b (reason)" or "plugin-a, plugin-b"
 */
export function formatFailureDetails(
  failures: Array<{ name: string; reason?: string; error?: string }>,
  includeReasons: boolean,
): string {
  const maxShow = 2
  const details = failures
    .slice(0, maxShow)
    .map(f => {
      const reason = f.reason || f.error || 'unknown error'
      return includeReasons ? `${f.name} (${reason})` : f.name
    })
    .join(includeReasons ? '; ' : ', ')

  const remaining = failures.length - maxShow
  const moreText = remaining > 0 ? ` and ${remaining} more` : ''

  return `${details}${moreText}`
}
// formatFailureDetails：把失败列表压成给用户的短串。最多展示前两条，再多就补「and N more」；区分「带原因」与「只列名字」两种模式。

/**
 * Extract source display string from marketplace configuration
 */
export function getMarketplaceSourceDisplay(source: MarketplaceSource): string {
  switch (source.source) {
    case 'github':
      return source.repo
    case 'url':
      return source.url
    case 'git':
      return source.url
    case 'directory':
      return source.path
    case 'file':
      return source.path
    case 'settings':
      return `settings:${source.name}`
    default:
      return 'Unknown source'
  }
}
// getMarketplaceSourceDisplay：把 MarketplaceSource 各子类型映射成一行可读字符串——github 取 repo、url/git 取 url、directory/file 取 path、settings 取 name。

/**
 * Create a plugin ID from plugin name and marketplace name
 */
export function createPluginId(
  pluginName: string,
  marketplaceName: string,
): string {
  return `${pluginName}@${marketplaceName}`
}
// createPluginId：插件的稳定标识 = 插件名@市场名，是插件去重与查找的键。

/**
 * Load marketplaces with graceful degradation for individual failures.
 * Blocked marketplaces (per enterprise policy) are excluded from the results.
 */
export async function loadMarketplacesWithGracefulDegradation(
  config: Record<string, KnownMarketplace>,
): Promise<{
  marketplaces: Array<{
    name: string
    config: KnownMarketplace
    data: Awaited<ReturnType<typeof getMarketplace>> | null
  }>
  failures: Array<{ name: string; error: string }>
}> {
  const marketplaces: Array<{
    name: string
    config: KnownMarketplace
    data: Awaited<ReturnType<typeof getMarketplace>> | null
  }> = []
  const failures: Array<{ name: string; error: string }> = []

  for (const [name, marketplaceConfig] of Object.entries(config)) {
    // Skip marketplaces blocked by enterprise policy
    if (!isSourceAllowedByPolicy(marketplaceConfig.source)) {
      continue
    }

    let data = null
    try {
      data = await getMarketplace(name)
    } catch (err) {
      // Track individual marketplace failures but continue loading others
      const errorMessage = err instanceof Error ? err.message : String(err)
      failures.push({ name, error: errorMessage })

      // Log for monitoring
      logError(toError(err))
    }

    marketplaces.push({
      name,
      config: marketplaceConfig,
      data,
    })
  }

  return { marketplaces, failures }
}
// loadMarketplacesWithGracefulDegradation：逐个市场加载，单市场失败只记进 failures 不中断其余；被企业策略封禁的源在这里就直接 skip，根本不发起加载。

/**
 * Format marketplace loading failures into appropriate user messages
 */
export function formatMarketplaceLoadingErrors(
  failures: Array<{ name: string; error: string }>,
  successCount: number,
): { type: 'warning' | 'error'; message: string } | null {
  if (failures.length === 0) {
    return null
  }

  // If some marketplaces succeeded, show warning
  if (successCount > 0) {
    const message =
      failures.length === 1
        ? `Warning: Failed to load marketplace '${failures[0]!.name}': ${failures[0]!.error}`
        : `Warning: Failed to load ${failures.length} marketplaces: ${formatFailureNames(failures)}`
    return { type: 'warning', message }
  }

  // All marketplaces failed - this is a critical error
  return {
    type: 'error',
    message: `Failed to load all marketplaces. Errors: ${formatFailureErrors(failures)}`,
  }
}
// formatMarketplaceLoadingErrors：把 failures 翻成 UI 消息。有成功则降级为 warning，全失败时升格为 error。

function formatFailureNames(
  failures: Array<{ name: string; error: string }>,
): string {
  return failures.map(f => f.name).join(', ')
}
// formatFailureNames / formatFailureErrors：两个纯格式化内联函数，分别拼「名字串」与「名字:原因串」，给上面的错误消息复用。

function formatFailureErrors(
  failures: Array<{ name: string; error: string }>,
): string {
  return failures.map(f => `${f.name}: ${f.error}`).join('; ')
}

/**
 * Get the strict marketplace source allowlist from policy settings.
 * Returns null if no restriction is in place, or an array of allowed sources.
 */
export function getStrictKnownMarketplaces(): MarketplaceSource[] | null {
  const policySettings = getSettingsForSource('policySettings')
  if (!policySettings?.strictKnownMarketplaces) {
    return null // No restrictions
  }
  return policySettings.strictKnownMarketplaces
}
// getStrictKnownMarketplaces：从策略设置读「严格白名单」；返回 null 表示无限制。

/**
 * Get the marketplace source blocklist from policy settings.
 * Returns null if no blocklist is in place, or an array of blocked sources.
 */
export function getBlockedMarketplaces(): MarketplaceSource[] | null {
  const policySettings = getSettingsForSource('policySettings')
  if (!policySettings?.blockedMarketplaces) {
    return null // No blocklist
  }
  return policySettings.blockedMarketplaces
}
// getBlockedMarketplaces：从策略设置读「黑名单」；null 表示无封禁。

/**
 * Get the custom plugin trust message from policy settings.
 * Returns undefined if not configured.
 */
export function getPluginTrustMessage(): string | undefined {
  return getSettingsForSource('policySettings')?.pluginTrustMessage
}
// getPluginTrustMessage：读自定义的插件信任提示语（可选配置，没有就返回 undefined）。

/**
 * Compare two MarketplaceSource objects for equality.
 * Sources are equal if they have the same type and all relevant fields match.
 */
function areSourcesEqual(a: MarketplaceSource, b: MarketplaceSource): boolean {
  if (a.source !== b.source) return false

  switch (a.source) {
    case 'url':
      return a.url === (b as typeof a).url
    case 'github':
      return (
        a.repo === (b as typeof a).repo &&
        (a.ref || undefined) === ((b as typeof a).ref || undefined) &&
        (a.path || undefined) === ((b as typeof a).path || undefined)
      )
    case 'git':
      return (
        a.url === (b as typeof a).url &&
        (a.ref || undefined) === ((b as typeof a).ref || undefined) &&
        (a.path || undefined) === ((b as typeof a).path || undefined)
      )
    case 'npm':
      return a.package === (b as typeof a).package
    case 'file':
      return a.path === (b as typeof a).path
    case 'directory':
      return a.path === (b as typeof a).path
    case 'settings':
      return (
        a.name === (b as typeof a).name &&
        isEqual(a.plugins, (b as typeof a).plugins)
      )
    default:
      return false
  }
}
// areSourcesEqual：逐类型比较两个 MarketplaceSource 是否相等。settings 类型额外用 lodash isEqual 比 plugins 数组，其余按关键字段精确比。

/**
 * Extract the host/domain from a marketplace source.
 * Used for hostPattern matching in strictKnownMarketplaces.
 *
 * Currently only supports github, git, and url sources.
 * npm, file, and directory sources are not supported for hostPattern matching.
 *
 * @param source - The marketplace source to extract host from
 * @returns The hostname string, or null if extraction fails or source type not supported
 */
export function extractHostFromSource(
  source: MarketplaceSource,
): string | null {
  switch (source.source) {
    case 'github':
      // GitHub shorthand always means github.com
      return 'github.com'

    case 'git': {
      // SSH format: user@HOST:path (e.g., git@github.com:owner/repo.git)
      const sshMatch = source.url.match(/^[^@]+@([^:]+):/)
      if (sshMatch?.[1]) {
        return sshMatch[1]
      }
      // HTTPS format: extract hostname from URL
      try {
        return new URL(source.url).hostname
      } catch {
        return null
      }
    }

    case 'url':
      try {
        return new URL(source.url).hostname
      } catch {
        return null
      }

    // npm, file, directory, hostPattern, pathPattern sources are not supported for hostPattern matching
    default:
      return null
  }
}
// extractHostFromSource：从源里抠出主机名，供 hostPattern 白名单匹配。只支持 github/git/url 三种；git 同时兼容 SSH（user@host:path）与 HTTPS 两种写法。

/**
 * Check if a source matches a hostPattern entry.
 * Extracts the host from the source and tests it against the regex pattern.
 *
 * @param source - The marketplace source to check
 * @param pattern - The hostPattern entry from strictKnownMarketplaces
 * @returns true if the source's host matches the pattern
 */
function doesSourceMatchHostPattern(
  source: MarketplaceSource,
  pattern: MarketplaceSource & { source: 'hostPattern' },
): boolean {
  const host = extractHostFromSource(source)
  if (!host) {
    return false
  }

  try {
    const regex = new RegExp(pattern.hostPattern)
    return regex.test(host)
  } catch {
    // Invalid regex - log and return false
    logError(new Error(`Invalid hostPattern regex: ${pattern.hostPattern}`))
    return false
  }
}
// doesSourceMatchHostPattern：拿源的主机名跑白名单里的正则；正则非法就记错并返回 false，不抛，避免一处坏规则拖垮整体匹配。

/**
 * Check if a source matches a pathPattern entry.
 * Tests the source's .path (file and directory sources only) against the regex pattern.
 *
 * @param source - The marketplace source to check
 * @param pattern - The pathPattern entry from strictKnownMarketplaces
 * @returns true if the source's path matches the pattern
 */
function doesSourceMatchPathPattern(
  source: MarketplaceSource,
  pattern: MarketplaceSource & { source: 'pathPattern' },
): boolean {
  // Only file and directory sources have a .path to match against
  if (source.source !== 'file' && source.source !== 'directory') {
    return false
  }

  try {
    const regex = new RegExp(pattern.pathPattern)
    return regex.test(source.path)
  } catch {
    logError(new Error(`Invalid pathPattern regex: ${pattern.pathPattern}`))
    return false
  }
}
// doesSourceMatchPathPattern：只对 file/directory 源，拿 .path 跑白名单里的路径正则。

/**
 * Get hosts from hostPattern entries in the allowlist.
 * Used to provide helpful error messages.
 */
export function getHostPatternsFromAllowlist(): string[] {
  const allowlist = getStrictKnownMarketplaces()
  if (!allowlist) return []

  return allowlist
    .filter(
      (entry): entry is MarketplaceSource & { source: 'hostPattern' } =>
        entry.source === 'hostPattern',
    )
    .map(entry => entry.hostPattern)
}
// getHostPatternsFromAllowlist：从白名单里筛出所有 hostPattern 项，专门给错误信息展示用。

/**
 * Extract GitHub owner/repo from a git URL if it's a GitHub URL.
 * Returns null if not a GitHub URL.
 *
 * Handles:
 * - git@github.com:owner/repo.git
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 */
function extractGitHubRepoFromGitUrl(url: string): string | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (sshMatch && sshMatch[1]) {
    return sshMatch[1]
  }

  // HTTPS format: https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  )
  if (httpsMatch && httpsMatch[1]) {
    return httpsMatch[1]
  }

  return null
}
// extractGitHubRepoFromGitUrl：从 git URL 里抠 owner/repo，兼容 SSH 与 HTTPS 两种格式，并忽略可选的 .git 后缀。

/**
 * Check if a blocked ref/path constraint matches a source.
 * If the blocklist entry has no ref/path, it matches ALL refs/paths (wildcard).
 * If the blocklist entry has a specific ref/path, it only matches that exact value.
 */
function blockedConstraintMatches(
  blockedValue: string | undefined,
  sourceValue: string | undefined,
): boolean {
  // If blocklist doesn't specify a constraint, it's a wildcard - matches anything
  if (!blockedValue) {
    return true
  }
  // If blocklist specifies a constraint, source must match exactly
  return (blockedValue || undefined) === (sourceValue || undefined)
}
// blockedConstraintMatches：黑名单 ref/path 约束的匹配。没写约束 = 通配（拦所有 ref/path）；写了就必须精确相等。

/**
 * Check if two sources refer to the same GitHub repository, even if using
 * different source types (github vs git with GitHub URL).
 *
 * Blocklist matching is asymmetric:
 * - If blocklist entry has no ref/path, it blocks ALL refs/paths (wildcard)
 * - If blocklist entry has a specific ref/path, only that exact value is blocked
 */
function areSourcesEquivalentForBlocklist(
  source: MarketplaceSource,
  blocked: MarketplaceSource,
): boolean {
  // Check exact same source type
  if (source.source === blocked.source) {
    switch (source.source) {
      case 'github': {
        const b = blocked as typeof source
        if (source.repo !== b.repo) return false
        return (
          blockedConstraintMatches(b.ref, source.ref) &&
          blockedConstraintMatches(b.path, source.path)
        )
      }
      case 'git': {
        const b = blocked as typeof source
        if (source.url !== b.url) return false
        return (
          blockedConstraintMatches(b.ref, source.ref) &&
          blockedConstraintMatches(b.path, source.path)
        )
      }
      case 'url':
        return source.url === (blocked as typeof source).url
      case 'npm':
        return source.package === (blocked as typeof source).package
      case 'file':
        return source.path === (blocked as typeof source).path
      case 'directory':
        return source.path === (blocked as typeof source).path
      case 'settings':
        return source.name === (blocked as typeof source).name
      default:
        return false
    }
  }

  // Check if a git source matches a github blocklist entry
  if (source.source === 'git' && blocked.source === 'github') {
    const extractedRepo = extractGitHubRepoFromGitUrl(source.url)
    if (extractedRepo === blocked.repo) {
      return (
        blockedConstraintMatches(blocked.ref, source.ref) &&
        blockedConstraintMatches(blocked.path, source.path)
      )
    }
  }

  // Check if a github source matches a git blocklist entry (GitHub URL)
  if (source.source === 'github' && blocked.source === 'git') {
    const extractedRepo = extractGitHubRepoFromGitUrl(blocked.url)
    if (extractedRepo === source.repo) {
      return (
        blockedConstraintMatches(blocked.ref, source.ref) &&
        blockedConstraintMatches(blocked.path, source.path)
      )
    }
  }

  return false
}
// areSourcesEquivalentForBlocklist：黑名单匹配是「非对称」的——除了同类型精确比，还处理 github 与 git 互转（用 git URL 伪装 github 来绕过黑名单也算命中）。

/**
 * Check if a marketplace source is explicitly in the blocklist.
 * Used for error message differentiation.
 *
 * This also catches attempts to bypass a github blocklist entry by using
 * git URLs (e.g., git@github.com:owner/repo.git or https://github.com/owner/repo.git).
 */
export function isSourceInBlocklist(source: MarketplaceSource): boolean {
  const blocklist = getBlockedMarketplaces()
  if (blocklist === null) {
    return false
  }
  return blocklist.some(blocked =>
    areSourcesEquivalentForBlocklist(source, blocked),
  )
}
// isSourceInBlocklist：暴露给外部的「是否在黑名单」判定，也顺手挡住用 git URL 伪装 github 的绕过企图。

/**
 * Check if a marketplace source is allowed by enterprise policy.
 * Returns true if allowed (or no policy), false if blocked.
 * This check happens BEFORE downloading, so blocked sources never touch the filesystem.
 *
 * Policy precedence:
 * 1. blockedMarketplaces (blocklist) - if source matches, it's blocked
 * 2. strictKnownMarketplaces (allowlist) - if set, source must be in the list
 */
export function isSourceAllowedByPolicy(source: MarketplaceSource): boolean {
  // Check blocklist first (takes precedence)
  if (isSourceInBlocklist(source)) {
    return false
  }

  // Then check allowlist
  const allowlist = getStrictKnownMarketplaces()
  if (allowlist === null) {
    return true // No restrictions
  }

  // Check each entry in the allowlist
  return allowlist.some(allowed => {
    // Handle hostPattern entries - match by extracted host
    if (allowed.source === 'hostPattern') {
      return doesSourceMatchHostPattern(source, allowed)
    }
    // Handle pathPattern entries - match file/directory .path by regex
    if (allowed.source === 'pathPattern') {
      return doesSourceMatchPathPattern(source, allowed)
    }
    // Handle regular source entries - exact match
    return areSourcesEqual(source, allowed)
  })
}
// isSourceAllowedByPolicy：策略总入口，下载前调用。优先级：先查黑名单（命中即拦）→ 再查白名单（设了就必须在表内）→ 两者都无则放行。

/**
 * Format a MarketplaceSource for display in error messages
 */
export function formatSourceForDisplay(source: MarketplaceSource): string {
  switch (source.source) {
    case 'github':
      return `github:${source.repo}${source.ref ? `@${source.ref}` : ''}`
    case 'url':
      return source.url
    case 'git':
      return `git:${source.url}${source.ref ? `@${source.ref}` : ''}`
    case 'npm':
      return `npm:${source.package}`
    case 'file':
      return `file:${source.path}`
    case 'directory':
      return `dir:${source.path}`
    case 'hostPattern':
      return `hostPattern:${source.hostPattern}`
    case 'pathPattern':
      return `pathPattern:${source.pathPattern}`
    case 'settings':
      return `settings:${source.name} (${source.plugins.length} ${plural(source.plugins.length, 'plugin')})`
    default:
      return 'unknown source'
  }
}
// formatSourceForDisplay：把源翻成错误信息用的可读串；settings 项顺带带出插件数量。

/**
 * Reasons why no marketplaces are available in the Discover screen
 */
export type EmptyMarketplaceReason =
  | 'git-not-installed'
  | 'all-blocked-by-policy'
  | 'policy-restricts-sources'
  | 'all-marketplaces-failed'
  | 'no-marketplaces-configured'
  | 'all-plugins-installed'
// EmptyMarketplaceReason：Discover 页「空市场」的六类原因联合类型（git 没装 / 全被策略封 / 策略限制了来源 / 全加载失败 / 没配置 / 插件都装完了）。

/**
 * Detect why no marketplaces are available.
 * Checks in order of priority: git availability → policy restrictions → config state → failures
 */
export async function detectEmptyMarketplaceReason({
  configuredMarketplaceCount,
  failedMarketplaceCount,
}: {
  configuredMarketplaceCount: number
  failedMarketplaceCount: number
}): Promise<EmptyMarketplaceReason> {
  // Check if git is installed (required for most marketplace sources)
  const gitAvailable = await checkGitAvailable()
  if (!gitAvailable) {
    return 'git-not-installed'
  }

  // Check policy restrictions
  const allowlist = getStrictKnownMarketplaces()
  if (allowlist !== null) {
    if (allowlist.length === 0) {
      // Policy explicitly blocks all marketplaces
      return 'all-blocked-by-policy'
    }
    // Policy restricts which sources can be used
    if (configuredMarketplaceCount === 0) {
      return 'policy-restricts-sources'
    }
  }

  // Check if any marketplaces are configured
  if (configuredMarketplaceCount === 0) {
    return 'no-marketplaces-configured'
  }

  // Check if all configured marketplaces failed to load
  if (
    failedMarketplaceCount > 0 &&
    failedMarketplaceCount === configuredMarketplaceCount
  ) {
    return 'all-marketplaces-failed'
  }

  // Marketplaces are configured and loaded, but no plugins available
  // This typically means all plugins are already installed
  return 'all-plugins-installed'
}
// detectEmptyMarketplaceReason：按优先级判空——git 是否装 → 策略是否封杀或限制 → 是否配置了市场 → 是否全部加载失败 → 否则就是「能用的都装完了」。
