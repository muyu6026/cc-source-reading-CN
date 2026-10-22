/**
 * Git can be weaponized for sandbox escape via two vectors:
 * 1. Bare-repo attack: if cwd contains HEAD + objects/ + refs/ but no valid
 *    .git/HEAD, Git treats cwd as a bare repository and runs hooks from cwd.
 * 2. Git-internal write + git: a compound command creates HEAD/objects/refs/
 *    hooks/ then runs git — the git subcommand executes the freshly-created
 *    malicious hooks.
 */
// git 的两条武器化路径：裸仓库攻击（cwd 里有 HEAD、objects、refs 就被当成 bare 仓库、执行 cwd 里的 hooks）与「先写 git 内部文件再跑 git」的复合命令——本模块专门识别「参数指向 git 内部路径」的写操作。

import { basename, posix, resolve, sep } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { PS_TOKENIZER_DASH_CHARS } from '../../utils/powershell/parser.js'

/**
 * If a normalized path starts with `../<cwd-basename>/`, it re-enters cwd
 * via the parent — resolve it to the cwd-relative form. posix.normalize
 * preserves leading `..` (no cwd context), so `../project/hooks` with
 * cwd=/x/project stays `../project/hooks` and misses the `hooks/` prefix
 * match even though it resolves to the same directory at runtime.
 * Check/use divergence: validator sees `../project/hooks`, PowerShell
 * resolves against cwd to `hooks`.
 */
function resolveCwdReentry(normalized: string): string {
  if (!normalized.startsWith('../')) return normalized
  const cwdBase = basename(getCwd()).toLowerCase()
  if (!cwdBase) return normalized
  // Iteratively strip `../<cwd-basename>/` pairs (handles `../../p/p/hooks`
  // when cwd has repeated basename segments is unlikely, but one-level is
  // the common attack).
  const prefix = '../' + cwdBase + '/'
  let s = normalized
  while (s.startsWith(prefix)) {
    s = s.slice(prefix.length)
  }
  // Also handle exact `../<cwd-basename>` (no trailing slash)
  if (s === '../' + cwdBase) return '.'
  return s
}
// 「绕经父目录再回到 cwd」的归一：以 ../ 加 cwd 目录名开头的路径先剥掉这层。posix.normalize 不带 cwd 上下文会保留前导 ..，导致校验器看到的路径与 PowerShell 运行时解析的不一致（检查/使用分歧）——../project/hooks 在 cwd=/x/project 时运行时就是 hooks。

/**
 * Normalize PS arg text → canonical path for git-internal matching.
 * Order matters: structural strips first (colon-bound param, quotes,
 * backtick escapes, provider prefix, drive-relative prefix), then NTFS
 * per-component trailing-strip (spaces always; dots only if not `./..`
 * after space-strip), then posix.normalize (resolves `..`, `.`, `//`),
 * then case-fold.
 */
function normalizeGitPathArg(arg: string): string {
  let s = arg
  // Normalize parameter prefixes: dash chars (–, —, ―) and forward-slash
  // (PS 5.1). /Path:hooks/pre-commit → extract colon-bound value. (bug #28)
  if (s.length > 0 && (PS_TOKENIZER_DASH_CHARS.has(s[0]!) || s[0] === '/')) {
    const c = s.indexOf(':', 1)
    if (c > 0) s = s.slice(c + 1)
  }
  s = s.replace(/^['"]|['"]$/g, '')
  s = s.replace(/`/g, '')
  // PS provider-qualified path: FileSystem::hooks/pre-commit → hooks/pre-commit
  // Also handles fully-qualified form: Microsoft.PowerShell.Core\FileSystem::path
  s = s.replace(/^(?:[A-Za-z0-9_.]+\\){0,3}FileSystem::/i, '')
  // Drive-relative C:foo (no separator after colon) is cwd-relative on that
  // drive. C:\foo (WITH separator) is absolute and must NOT match — the
  // negative lookahead preserves it.
  s = s.replace(/^[A-Za-z]:(?![/\\])/, '')
  s = s.replace(/\\/g, '/')
  // Win32 CreateFileW per-component: iteratively strip trailing spaces,
  // then trailing dots, stopping if the result is `.` or `..` (special).
  // `.. ` → `..`, `.. .` → `..`, `...` → '' → `.`, `hooks .` → `hooks`.
  // Originally-'' (leading slash split) stays '' (absolute-path marker).
  s = s
    .split('/')
    .map(c => {
      if (c === '') return c
      let prev
      do {
        prev = c
        c = c.replace(/ +$/, '')
        if (c === '.' || c === '..') return c
        c = c.replace(/\.+$/, '')
      } while (c !== prev)
      return c || '.'
    })
    .join('/')
  s = posix.normalize(s)
  if (s.startsWith('./')) s = s.slice(2)
  return s.toLowerCase()
}
// 归一化顺序有讲究：先结构性剥离（冒号绑定参数值、引号、反引号转义、provider 前缀、盘符相对前缀），再按 NTFS 规则逐组件剥尾部空格与点（两点变一点、hooks. 变 hooks），最后 posix.normalize 加小写。每一步都对应一种真实的绕过尝试（bug #28、#22、#6 都在这修过）。

const GIT_INTERNAL_PREFIXES = ['head', 'objects', 'refs', 'hooks'] as const
// git 内部前缀名单：head、objects、refs、hooks 四个裸仓库目录，外加 .git 与 git~N 短名——裸仓库与标准仓库两种形态都覆盖。

/**
 * SECURITY: Resolve a normalized path that escapes cwd (leading `../` or
 * absolute) against the actual cwd, then check if it lands back INSIDE cwd.
 * If so, strip cwd and return the cwd-relative remainder for prefix matching.
 * If it lands outside cwd, return null (genuinely external — path-validation's
 * concern). Covers `..\<cwd-basename>\HEAD` and `C:\<full-cwd>\HEAD` which
 * posix.normalize alone cannot resolve (it leaves leading `..` as-is).
 *
 * This is the SOLE guard for the bare-repo HEAD attack. path-validation's
 * DANGEROUS_FILES deliberately excludes bare `HEAD` (false-positive risk
 * on legitimate non-git files named HEAD) and DANGEROUS_DIRECTORIES
 * matches per-segment `.git` only — so `<cwd>/HEAD` passes that layer.
 * The cwd-resolution here is load-bearing; do not remove without adding
 * an alternative guard.
 */
// 这是裸仓库 HEAD 攻击的唯一防线：pathValidation 层刻意不把裸 HEAD 列入危险文件（合法同名文件误报太多）、危险目录也只按段匹配 .git——所以逃出 cwd 又落回 cwd 的路径必须在这里用真实 cwd 解析兜底。注释明说 load-bearing：删掉必须先补替代防线。
function resolveEscapingPathToCwdRelative(n: string): string | null {
  const cwd = getCwd()
  // Reconstruct a platform-resolvable path from the posix-normalized form.
  // `n` has forward slashes (normalizeGitPathArg converted \\ → /); resolve()
  // handles forward slashes on Windows.
  const abs = resolve(cwd, n)
  const cwdWithSep = cwd.endsWith(sep) ? cwd : cwd + sep
  // Case-insensitive comparison: normalizeGitPathArg lowercased `n`, so
  // resolve() output has lowercase components from `n` but cwd may be
  // mixed-case (e.g. C:\Users\...). Windows paths are case-insensitive.
  const absLower = abs.toLowerCase()
  const cwdLower = cwd.toLowerCase()
  const cwdWithSepLower = cwdWithSep.toLowerCase()
  if (absLower === cwdLower) return '.'
  if (!absLower.startsWith(cwdWithSepLower)) return null
  return abs.slice(cwdWithSep.length).replace(/\\/g, '/').toLowerCase()
}

function matchesGitInternalPrefix(n: string): boolean {
  if (n === 'head' || n === '.git') return true
  if (n.startsWith('.git/') || /^git~\d+($|\/)/.test(n)) return true
  for (const p of GIT_INTERNAL_PREFIXES) {
    if (p === 'head') continue
    if (n === p || n.startsWith(p + '/')) return true
  }
  return false
}
// head 与 .git 精确匹配；objects/refs/hooks 按目录段匹配（hooks/ 命中、hooksaw/ 不命中）；git~N 正则覆盖 NTFS 8.3 短文件名——多个 git 开头的点文件时 .git 可能注册成 GIT~1 甚至 GIT~2。

/**
 * True if arg (raw PS arg text) resolves to a git-internal path in cwd.
 * Covers both bare-repo paths (hooks/, refs/) and standard-repo paths
 * (.git/hooks/, .git/config).
 */
export function isGitInternalPathPS(arg: string): boolean {
  const n = resolveCwdReentry(normalizeGitPathArg(arg))
  if (matchesGitInternalPrefix(n)) return true
  // SECURITY: leading `../` or absolute paths that resolveCwdReentry and
  // posix.normalize couldn't fully resolve. Resolve against actual cwd — if
  // the result lands back in cwd at a git-internal location, the guard must
  // still fire.
  if (n.startsWith('../') || n.startsWith('/') || /^[a-z]:/.test(n)) {
    const rel = resolveEscapingPathToCwdRelative(n)
    if (rel !== null && matchesGitInternalPrefix(rel)) return true
  }
  return false
}
// 两段判定：先归一化直接匹配；仍带前导 .. 或绝对路径的，用真实 cwd 解析后若落回 cwd 内的 git 内部位置，防线照样触发——..\<cwd 名>\HEAD 与 C:\全路径\HEAD 这类 posix.normalize 处理不了的形态都在这收口。

/**
 * True if arg resolves to a path inside .git/ (standard-repo metadata dir).
 * Unlike isGitInternalPathPS, does NOT match bare-repo-style root-level
 * `hooks/`, `refs/` etc. — those are common project directory names.
 */
export function isDotGitPathPS(arg: string): boolean {
  const n = resolveCwdReentry(normalizeGitPathArg(arg))
  if (matchesDotGitPrefix(n)) return true
  // SECURITY: same cwd-resolution as isGitInternalPathPS — catch
  // `..\<cwd-basename>\.git\hooks\pre-commit` that lands back in cwd.
  if (n.startsWith('../') || n.startsWith('/') || /^[a-z]:/.test(n)) {
    const rel = resolveEscapingPathToCwdRelative(n)
    if (rel !== null && matchesDotGitPrefix(rel)) return true
  }
  return false
}
// isDotGitPathPS 与上者的差异：不匹配根级 hooks、refs 等裸仓库形态——那些是常见的项目目录名，只认 .git 内部，减少误伤。

function matchesDotGitPrefix(n: string): boolean {
  if (n === '.git' || n.startsWith('.git/')) return true
  // NTFS 8.3 short names: .git becomes GIT~1 (or GIT~2, etc. if multiple
  // dotfiles start with "git"). normalizeGitPathArg lowercases, so check
  // for git~N as the first component.
  return /^git~\d+($|\/)/.test(n)
}
// 8.3 短名的完整处理：.git 变 GIT~1、第二个 git 开头的点文件变 GIT~2——归一化已小写，正则用数字兜住任意序号。
