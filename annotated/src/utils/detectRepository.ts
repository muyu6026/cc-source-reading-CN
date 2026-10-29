import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { getRemoteUrl } from './git.js'

export type ParsedRepository = {
  host: string
  owner: string
  name: string
}
// ParsedRepository 描述解析出的仓库三元组：主机、所有者、仓库名。

const repositoryWithHostCache = new Map<string, ParsedRepository | null>()

export function clearRepositoryCaches(): void {
  repositoryWithHostCache.clear()
}
// clearRepositoryCaches 清空按 cwd 缓存的解析结果。

export async function detectCurrentRepository(): Promise<string | null> {
  const result = await detectCurrentRepositoryWithHost()
  if (!result) return null
  // Only return results for github.com to avoid breaking downstream consumers
  // that assume the result is a github.com repository.
  // Use detectCurrentRepositoryWithHost() for GHE support.
  if (result.host !== 'github.com') return null
  return `${result.owner}/${result.name}`
}
// detectCurrentRepository 收尾：只返回 github.com 的 owner/name，
// 其它主机交由带 host 的变体处理，避免下游误以为一定是 github。

/**
 * Like detectCurrentRepository, but also returns the host (e.g. "github.com"
 * or a GHE hostname). Callers that need to construct URLs against a specific
 * GitHub host should use this variant.
 */
// detectCurrentRepositoryWithHost 与上面同源但额外返回主机名，
// 需要针对特定 GitHub 主机拼 URL 的调用方应使用此变体。
export async function detectCurrentRepositoryWithHost(): Promise<ParsedRepository | null> {
  const cwd = getCwd()

  if (repositoryWithHostCache.has(cwd)) {
    return repositoryWithHostCache.get(cwd) ?? null
  }

  try {
    const remoteUrl = await getRemoteUrl()
    logForDebugging(`Git remote URL: ${remoteUrl}`)
    if (!remoteUrl) {
      logForDebugging('No git remote URL found')
      repositoryWithHostCache.set(cwd, null)
      return null
    }

    const parsed = parseGitRemote(remoteUrl)
    logForDebugging(
      `Parsed repository: ${parsed ? `${parsed.host}/${parsed.owner}/${parsed.name}` : null} from URL: ${remoteUrl}`,
    )
    repositoryWithHostCache.set(cwd, parsed)
    return parsed
  } catch (error) {
    logForDebugging(`Error detecting repository: ${error}`)
    repositoryWithHostCache.set(cwd, null)
    return null
  }
}
// detectCurrentRepositoryWithHost 收尾：按 cwd 缓存解析结果，异常或解析失败都回退为空。

/**
 * Synchronously returns the cached github.com repository for the current cwd
 * as "owner/name", or null if it hasn't been resolved yet or the host is not
 * github.com. Call detectCurrentRepository() first to populate the cache.
 *
 * Callers construct github.com URLs, so GHE hosts are filtered out here.
 */
// getCachedRepository 同步返回已缓存的 github.com 仓库 owner/name，未解析或非 github 则返回空。
export function getCachedRepository(): string | null {
  const parsed = repositoryWithHostCache.get(getCwd())
  if (!parsed || parsed.host !== 'github.com') return null
  return `${parsed.owner}/${parsed.name}`
}
// getCachedRepository 收尾：从缓存取解析结果并按 host 过滤。

/**
 * Parses a git remote URL into host, owner, and name components.
 * Accepts any host (github.com, GHE instances, etc.).
 *
 * Supports:
 *   https://host/owner/repo.git
 *   git@host:owner/repo.git
 *   ssh://git@host/owner/repo.git
 *   git://host/owner/repo.git
 *   https://host/owner/repo (no .git)
 *
 * Note: repo names can contain dots (e.g., cc.kurs.web)
 */
// parseGitRemote 把任意主机的 remote URL 解析为 host、owner、name，支持 SSH 与多种 URL 格式。
export function parseGitRemote(input: string): ParsedRepository | null {
  const trimmed = input.trim()

  // SSH format: git@host:owner/repo.git
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (sshMatch?.[1] && sshMatch[2] && sshMatch[3]) {
    if (!looksLikeRealHostname(sshMatch[1])) return null
    return {
      host: sshMatch[1],
      owner: sshMatch[2],
      name: sshMatch[3],
    }
  }

  // URL format: https://host/owner/repo.git, ssh://git@host/owner/repo, git://host/owner/repo
  const urlMatch = trimmed.match(
    /^(https?|ssh|git):\/\/(?:[^@]+@)?([^/:]+(?::\d+)?)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  )
  if (urlMatch?.[1] && urlMatch[2] && urlMatch[3] && urlMatch[4]) {
    const protocol = urlMatch[1]
    const hostWithPort = urlMatch[2]
    const hostWithoutPort = hostWithPort.split(':')[0] ?? ''
    if (!looksLikeRealHostname(hostWithoutPort)) return null
    // Only preserve port for HTTPS — SSH/git ports are not usable for constructing
    // web URLs (e.g. ssh://git@ghe.corp.com:2222 → port 2222 is SSH, not HTTPS).
    const host =
      protocol === 'https' || protocol === 'http'
        ? hostWithPort
        : hostWithoutPort
    return {
      host,
      owner: urlMatch[3],
      name: urlMatch[4],
    }
  }

  return null
}
// parseGitRemote 收尾：用正则分别匹配 SSH 与 https/ssh/git 协议，过滤掉像 SSH 别名的伪主机。

/**
 * Parses a git remote URL or "owner/repo" string and returns "owner/repo".
 * Only returns results for github.com hosts — GHE URLs return null.
 * Use parseGitRemote() for GHE support.
 * Also accepts plain "owner/repo" strings for backward compatibility.
 */
// parseGitHubRepository 解析 URL 或 owner/repo 字符串，仅返回 github.com 结果，GHE 返回空。
export function parseGitHubRepository(input: string): string | null {
  const trimmed = input.trim()

  // Try parsing as a full remote URL first.
  // Only return results for github.com hosts — existing callers (VS Code extension,
  // bridge) assume this function is GitHub.com-specific. Use parseGitRemote() directly
  // for GHE support.
  const parsed = parseGitRemote(trimmed)
  if (parsed) {
    if (parsed.host !== 'github.com') return null
    return `${parsed.owner}/${parsed.name}`
  }

  // If no URL pattern matched, check if it's already in owner/repo format
  if (
    !trimmed.includes('://') &&
    !trimmed.includes('@') &&
    trimmed.includes('/')
  ) {
    const parts = trimmed.split('/')
    if (parts.length === 2 && parts[0] && parts[1]) {
      // Remove .git extension if present
      const repo = parts[1].replace(/\.git$/, '')
      return `${parts[0]}/${repo}`
    }
  }

  logForDebugging(`Could not parse repository from: ${trimmed}`)
  return null
}
// parseGitHubRepository 收尾：先当完整 URL 解析，失败再按 owner/repo 纯文本兜底。

/**
 * Checks whether a hostname looks like a real domain name rather than an
 * SSH config alias. A simple dot-check is not enough because aliases like
 * "github.com-work" still contain a dot. We additionally require that the
 * last segment (the TLD) is purely alphabetic — real TLDs (com, org, io, net)
 * never contain hyphens or digits.
 */
// looksLikeRealHostname 判断是否像真实域名而非 SSH 别名：
// 要求含点且末段 TLD 纯字母，从而排除 github.com-work 这类带连字符的别名。
function looksLikeRealHostname(host: string): boolean {
  if (!host.includes('.')) return false
  const lastSegment = host.split('.').pop()
  if (!lastSegment) return false
  // Real TLDs are purely alphabetic (e.g., "com", "org", "io").
  // SSH aliases like "github.com-work" have a last segment "com-work" which
  // contains a hyphen.
  return /^[a-zA-Z]+$/.test(lastSegment)
}
// looksLikeRealHostname 收尾：用末段是否为纯字母 TLD 区分真实域名与 SSH 配置别名。
