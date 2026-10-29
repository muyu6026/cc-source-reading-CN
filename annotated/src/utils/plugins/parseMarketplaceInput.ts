import { homedir } from 'os'
import { resolve } from 'path'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import type { MarketplaceSource } from './schemas.js'

/**
 * Parses a marketplace input string and returns the appropriate marketplace source type.
 * Handles various input formats:
 * - Git SSH URLs (user@host:path or user@host:path.git)
 *   - Standard: git@github.com:owner/repo.git
 *   - GitHub Enterprise SSH certificates: org-123456@github.com:owner/repo.git
 *   - Custom usernames: deploy@gitlab.com:group/project.git
 *   - Self-hosted: user@192.168.10.123:path/to/repo
 * - HTTP/HTTPS URLs
 * - GitHub shorthand (owner/repo)
 * - Local file paths (.json files)
 * - Local directory paths
 *
 * @param input The marketplace source input string
 * @returns MarketplaceSource object, error object, or null if format is unrecognized
 */
export async function parseMarketplaceInput(
  input: string,
// parseMarketplaceInput 是插件源字符串的总入口，把用户输入解析成 git/url/file/directory/github 五类源，无法识别返回 null，出错返回 error 对象。
): Promise<MarketplaceSource | { error: string } | null> {
  const trimmed = input.trim()
  const fs = getFsImplementation()

  // Handle git SSH URLs with any valid username (not just 'git')
  // Supports: user@host:path, user@host:path.git, and with #ref suffix
  // Username can contain: alphanumeric, dots, underscores, hyphens
  const sshMatch = trimmed.match(
    /^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$/,
  )
  if (sshMatch?.[1]) {
    const url = sshMatch[1]
    const ref = sshMatch[3]
    return ref ? { source: 'git', url, ref } : { source: 'git', url }
  }
// 先处理 git SSH 地址（任意用户名 @ 主机 : 路径，支持 #ref 后缀），命中即返回 git 源。

  // Handle URLs
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    // Extract fragment (ref) from URL if present
    const fragmentMatch = trimmed.match(/^([^#]+)(#(.+))?$/)
    const urlWithoutFragment = fragmentMatch?.[1] || trimmed
    const ref = fragmentMatch?.[3]

    // When user explicitly provides an HTTPS/HTTP URL that looks like a git
    // repo, use the git source type so we clone rather than fetch-as-JSON.
    // The .git suffix is a GitHub/GitLab/Bitbucket convention. Azure DevOps
    // uses /_git/ in the path with NO suffix (appending .git breaks ADO:
    // TF401019 "repo does not exist"). Without this check, an ADO URL falls
    // through to source:'url' below, which tries to fetch it as a raw
    // marketplace.json — the HTML response parses as "expected object,
    // received string". (gh-31256 / CC-299)
    if (
      urlWithoutFragment.endsWith('.git') ||
      urlWithoutFragment.includes('/_git/')
    ) {
      return ref
        ? { source: 'git', url: urlWithoutFragment, ref }
        : { source: 'git', url: urlWithoutFragment }
    }
    // Parse URL to check hostname
    let url: URL
    try {
      url = new URL(urlWithoutFragment)
    } catch (_err) {
      // Not a valid URL for parsing, treat as generic URL
      // new URL() throws TypeError for invalid URLs
      return { source: 'url', url: urlWithoutFragment }
    }
// 对 http(s) 地址用 new URL 解析；非法 URL 退化为普通 url 源而不是抛错。

    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const match = url.pathname.match(/^\/([^/]+\/[^/]+?)(\/|\.git|$)/)
      if (match?.[1]) {
        // User explicitly provided HTTPS URL - keep it as HTTPS via 'git' type
        // Add .git suffix if not present for proper git clone
        const gitUrl = urlWithoutFragment.endsWith('.git')
          ? urlWithoutFragment
          : `${urlWithoutFragment}.git`
        return ref
          ? { source: 'git', url: gitUrl, ref }
          : { source: 'git', url: gitUrl }
      }
    }
    return { source: 'url', url: urlWithoutFragment }
  }
// URL 分支结束：github.com 域名下且形如 owner/repo 的按 git 克隆，否则按 url 源拉取 JSON。

  // Handle local paths
  // On Windows, also recognize backslash-relative (.\, ..\) and drive letter paths (C:\)
  // These are Windows-only because backslashes are valid filename chars on Unix
  const isWindows = process.platform === 'win32'
  const isWindowsPath =
    isWindows &&
    (trimmed.startsWith('.\\') ||
      trimmed.startsWith('..\\') ||
      /^[a-zA-Z]:[/\\]/.test(trimmed))
  if (
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    isWindowsPath
  ) {
    const resolvedPath = resolve(
      trimmed.startsWith('~') ? trimmed.replace(/^~/, homedir()) : trimmed,
    )

    // Stat the path to determine if it's a file or directory. Swallow all stat
    // errors (ENOENT, EACCES, EPERM, etc.) and return an error result instead
    // of throwing — matches the old existsSync behavior which never threw.
    let stats
    try {
      stats = await fs.stat(resolvedPath)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      return {
        error:
          code === 'ENOENT'
            ? `Path does not exist: ${resolvedPath}`
            : `Cannot access path: ${resolvedPath} (${code ?? e})`,
      }
    }
// 本地路径分支里用 stat 判断文件还是目录，吞掉所有 stat 错误（ENOENT/EACCES 等）转成 error 结果，复刻旧 existsSync 不抛错的行为。

    if (stats.isFile()) {
      if (resolvedPath.endsWith('.json')) {
        return { source: 'file', path: resolvedPath }
      } else {
        return {
          error: `File path must point to a .json file (marketplace.json), but got: ${resolvedPath}`,
        }
      }
    } else if (stats.isDirectory()) {
      return { source: 'directory', path: resolvedPath }
    } else {
      return {
        error: `Path is neither a file nor a directory: ${resolvedPath}`,
      }
    }
  }
// 本地路径分支结束：文件必须指向 .json，目录按 directory 源返回。

  // Handle GitHub shorthand (owner/repo, owner/repo#ref, or owner/repo@ref)
  // Accept both # and @ as ref separators — the display formatter uses @, so users
  // naturally type @ when copying from error messages or managed settings.
  if (trimmed.includes('/') && !trimmed.startsWith('@')) {
    if (trimmed.includes(':')) {
      return null
    }
    // Extract ref if present (either #ref or @ref)
    const fragmentMatch = trimmed.match(/^([^#@]+)(?:[#@](.+))?$/)
    const repo = fragmentMatch?.[1] || trimmed
    const ref = fragmentMatch?.[2]
    // Assume it's a GitHub repo
    return ref ? { source: 'github', repo, ref } : { source: 'github', repo }
  }
// GitHub 简写分支：owner/repo（支持 # 或 @ 作 ref 分隔符，因为展示格式化用 @，用户会自然照抄）解析为 github 源。

  // NPM packages not yet implemented
  // Returning null for unrecognized input

  return null
}
// NPM 包源尚未实现，无法识别的输入一律返回 null。
