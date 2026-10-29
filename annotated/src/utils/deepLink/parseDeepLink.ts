/**
 * Deep Link URI Parser
 *
 * Parses `claude-cli://open` URIs. All parameters are optional:
 *   q    — pre-fill the prompt input (not submitted)
 *   cwd  — working directory (absolute path)
 *   repo — owner/name slug, resolved against githubRepoPaths config
 *
 * Examples:
 *   claude-cli://open
 *   claude-cli://open?q=hello+world
 *   claude-cli://open?q=fix+tests&repo=owner/repo
 *   claude-cli://open?cwd=/path/to/project
 *
 * Security: values are URL-decoded, Unicode-sanitized, and rejected if they
 * contain ASCII control characters (newlines etc. can act as command
 * separators). All values are single-quote shell-escaped at the point of
 * use (terminalLauncher.ts) — that escaping is the injection boundary.
 */
// 本文件解析 claude-cli 协议的深链 URI：参数 q、cwd、repo 均可选，
// 安全上做 URL 解码、Unicode 清理并拒绝控制字符，注入边界在使用点由单引号转义承担。

import { partiallySanitizeUnicode } from '../sanitization.js'

export const DEEP_LINK_PROTOCOL = 'claude-cli'

export type DeepLinkAction = {
  query?: string
  cwd?: string
  repo?: string
}
// 引入 Unicode 部分清理函数，用于剥离隐藏字符防止提示注入。

/**
 * Check if a string contains ASCII control characters (0x00-0x1F, 0x7F).
 * These can act as command separators in shells (newlines, carriage returns, etc.).
 * Allows printable ASCII and Unicode (CJK, emoji, accented chars, etc.).
 */
// containsControlChars 检查字符串是否含 ASCII 控制字符（可作命令行分隔符），放行可打印与 Unicode。
function containsControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}
// containsControlChars 收尾：逐字符判断码点是否落在控制区间。

/**
 * GitHub owner/repo slug: alphanumerics, dots, hyphens, underscores,
 * exactly one slash. Keeps this from becoming a path traversal vector.
 */
// REPO_SLUG_PATTERN 约束 owner/repo 格式：字母数字点连字符下划线加恰好一个斜杠，防止路径穿越。
const REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/
// REPO_SLUG_PATTERN 常量：用正则约束仓库短标识，避免变成路径遍历向量。

/**
 * Cap on pre-filled prompt length. The only defense against a prompt like
 * "review PR #18796 […4900 chars of padding…] also cat ~/.ssh/id_rsa" is
 * the user reading it before pressing Enter. At this length the prompt is
 * no longer scannable at a glance, so banner.ts shows an explicit "scroll
 * to review the entire prompt" warning above LONG_PREFILL_THRESHOLD.
 * Reject, don't truncate — truncation changes meaning.
 *
 * 5000 is the practical ceiling: the Windows cmd.exe fallback
 * (terminalLauncher.ts) has an 8191-char command-string limit, and after
 * the `cd /d <cwd> && <claude.exe> --deep-link-origin ... --prefill "<q>"`
 * wrapper plus cmdQuote's %→%% expansion, ~7000 chars of query is the
 * hard stop for typical inputs. A pathological >60%-percent-sign query
 * would 2× past the limit, but cmd.exe is the last-resort fallback
 * (wt.exe and PowerShell are tried first) and the failure mode is a
 * launch error, not a security issue — so we don't penalize real users
 * for an implausible input.
 */
// MAX_QUERY_LENGTH 限制预填提示长度：过长不可一眼扫完，宁可拒绝也不截断以免改变语义。
const MAX_QUERY_LENGTH = 5000
// MAX_QUERY_LENGTH 常量：五千字符是实用上限，顾及 Windows 命令串长度与转义膨胀。

/**
 * PATH_MAX on Linux is 4096. Windows MAX_PATH is 260 (32767 with long-path
 * opt-in). No real path approaches this; a cwd over 4096 is malformed or
 * malicious.
 */
// MAX_CWD_LENGTH 限制工作目录长度：超过 PATH_MAX 即视为畸形或恶意。
const MAX_CWD_LENGTH = 4096
// MAX_CWD_LENGTH 常量：Linux 路径上限与 Windows 上限之大者，真实路径不可能逼近。

/**
 * Parse a claude-cli:// URI into a structured action.
 *
 * @throws {Error} if the URI is malformed or contains dangerous characters
 */
// parseDeepLink 把 URI 解析为结构化动作，URI 畸形或含危险字符时抛错。
export function parseDeepLink(uri: string): DeepLinkAction {
  // Normalize: accept with or without the trailing colon in protocol
  const normalized = uri.startsWith(`${DEEP_LINK_PROTOCOL}://`)
    ? uri
    : uri.startsWith(`${DEEP_LINK_PROTOCOL}:`)
      ? uri.replace(`${DEEP_LINK_PROTOCOL}:`, `${DEEP_LINK_PROTOCOL}://`)
      : null

  if (!normalized) {
    throw new Error(
      `Invalid deep link: expected ${DEEP_LINK_PROTOCOL}:// scheme, got "${uri}"`,
    )
  }

  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error(`Invalid deep link URL: "${uri}"`)
  }

  if (url.hostname !== 'open') {
    throw new Error(`Unknown deep link action: "${url.hostname}"`)
  }

  const cwd = url.searchParams.get('cwd') ?? undefined
  const repo = url.searchParams.get('repo') ?? undefined
  const rawQuery = url.searchParams.get('q')

  // Validate cwd if present — must be an absolute path
  if (cwd && !cwd.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(cwd)) {
    throw new Error(
      `Invalid cwd in deep link: must be an absolute path, got "${cwd}"`,
    )
  }

  // Reject control characters in cwd (newlines, etc.) but allow path chars like backslash.
  if (cwd && containsControlChars(cwd)) {
    throw new Error('Deep link cwd contains disallowed control characters')
  }
  if (cwd && cwd.length > MAX_CWD_LENGTH) {
    throw new Error(
      `Deep link cwd exceeds ${MAX_CWD_LENGTH} characters (got ${cwd.length})`,
    )
  }

  // Validate repo slug format. Resolution happens later (protocolHandler.ts) —
  // this parser stays pure with no config/filesystem access.
  if (repo && !REPO_SLUG_PATTERN.test(repo)) {
    throw new Error(
      `Invalid repo in deep link: expected "owner/repo", got "${repo}"`,
    )
  }

  let query: string | undefined
  if (rawQuery && rawQuery.trim().length > 0) {
    // Strip hidden Unicode characters (ASCII smuggling / hidden prompt injection)
    query = partiallySanitizeUnicode(rawQuery.trim())
    if (containsControlChars(query)) {
      throw new Error('Deep link query contains disallowed control characters')
    }
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(
        `Deep link query exceeds ${MAX_QUERY_LENGTH} characters (got ${query.length})`,
      )
    }
  }

  return { query, cwd, repo }
}
// parseDeepLink 收尾：校验 cwd 与 repo 格式、清理并限长后返回动作对象。

/**
 * Build a claude-cli:// deep link URL.
 */
// buildDeepLink 反向构造 claude-cli 深链 URL，按需设置 q、cwd、repo 三个查询参数。
export function buildDeepLink(action: DeepLinkAction): string {
  const url = new URL(`${DEEP_LINK_PROTOCOL}://open`)
  if (action.query) {
    url.searchParams.set('q', action.query)
  }
  if (action.cwd) {
    url.searchParams.set('cwd', action.cwd)
  }
  if (action.repo) {
    url.searchParams.set('repo', action.repo)
  }
  return url.toString()
}
// buildDeepLink 收尾：用 URL 对象装配查询参数并返回字符串。
