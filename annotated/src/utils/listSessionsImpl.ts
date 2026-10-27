// 文件级：本文件是 Agent SDK 专用的 `listSessions` 独立实现，刻意保持依赖最小、可移植——不引入 `bootstrap/state.ts`、不上报统计、不触发 CLI 初始化，让 SDK 入口能安全导入而不拉起重型依赖链。
/**
 * Standalone implementation of listSessions for the Agent SDK.
 *
 * Dependencies are kept minimal and portable — no bootstrap/state.ts,
 * no analytics, no bun:bundle, no module-scope mutable state. This module
 * can be imported safely from the SDK entrypoint without triggering CLI
 * initialization or pulling in expensive dependency chains.
 */

import type { Dirent } from 'fs'
// 从 Node 内置 `fs` 引入目录项类型 `Dirent` 与异步的 `readdir`、`stat`，用于低开销地枚举与会话数文件。
import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { getWorktreePathsPortable } from './getWorktreePathsPortable.js'
// 引入可移植的工作树路径查询工具，避免依赖只能在 CLI 里用的状态模块。
import type { LiteSessionFile } from './sessionStoragePortable.js'
// 引入轻量会话文件类型 `LiteSessionFile`，它只含头尾与状态信息，不做整份 JSONL 解析。
import {
  canonicalizePath,
  extractFirstPromptFromHead,
  extractJsonStringField,
  extractLastJsonStringField,
  findProjectDir,
  getProjectsDir,
  MAX_SANITIZED_LENGTH,
  readSessionLite,
  sanitizePath,
  validateUuid,
} from './sessionStoragePortable.js'

/**
 * Session metadata returned by listSessions.
 * Contains only data extractable from stat + head/tail reads — no full
 * JSONL parsing required.
 */
export type SessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  /** Epoch ms — from first entry's ISO timestamp. Undefined if unparseable. */
  createdAt?: number
}
// `SessionInfo`：列表接口对外返回的会话元信息结构，字段都得靠 `stat` 加头尾读取就能拿到，不需要解析整份 JSONL。

export type ListSessionsOptions = {
  /**
   * Directory to list sessions for. When provided, returns sessions for
   * this project directory (and optionally its git worktrees). When omitted,
   * returns sessions across all projects.
   */
  dir?: string
  /** Maximum number of sessions to return. */
  limit?: number
  /**
   * Number of sessions to skip from the start of the sorted result set.
   * Use with `limit` for pagination. Defaults to 0.
   */
  offset?: number
  /**
   * When `dir` is provided and the directory is inside a git repository,
   * include sessions from all git worktree paths. Defaults to `true`.
   */
  includeWorktrees?: boolean
}
// `ListSessionsOptions`：列表查询选项，`dir` 限定单个工程目录、`limit`/`offset` 做分页、`includeWorktrees` 控制是否顺带扫描 git 工作树。

// ---------------------------------------------------------------------------
// Field extraction — shared by listSessionsImpl and getSessionInfoImpl
// ---------------------------------------------------------------------------

/**
 * Parses SessionInfo fields from a lite session read (head/tail/stat).
 * Returns null for sidechain sessions or metadata-only sessions with no
 * extractable summary.
 *
 * Exported for reuse by getSessionInfoImpl.
 */
// `parseSessionInfoFromLite`：从一次轻量读取（头/尾/状态）里解析出 `SessionInfo`；对旁路会话或没有可提取摘要的纯元数据会话返回 `null`。
export function parseSessionInfoFromLite(
  sessionId: string,
  lite: LiteSessionFile,
  projectPath?: string,
): SessionInfo | null {
  const { head, tail, mtime, size } = lite
// 解构出头部、尾部、修改时间与文件大小，后续字段都从这几样里提炼。

  // Check first line for sidechain sessions
  const firstNewline = head.indexOf('\n')
  const firstLine = firstNewline >= 0 ? head.slice(0, firstNewline) : head
  if (
    firstLine.includes('"isSidechain":true') ||
    firstLine.includes('"isSidechain": true')
  ) {
    return null
  }
// 旁路会话（侧链）判定：首行若带 `isSidechain:true` 就直接丢弃，这种会话不该出现在普通列表里。
  // User title (customTitle) wins over AI title (aiTitle); distinct
  // field names mean extractLastJsonStringField naturally disambiguates.
  const customTitle =
    extractLastJsonStringField(tail, 'customTitle') ||
    extractLastJsonStringField(head, 'customTitle') ||
    extractLastJsonStringField(tail, 'aiTitle') ||
    extractLastJsonStringField(head, 'aiTitle') ||
    undefined
// 标题优先级：用户自定标题 `customTitle` 压过 AI 标题 `aiTitle`；两个字段名不同，所以就近取最后一条即可自然消歧。
  const firstPrompt = extractFirstPromptFromHead(head) || undefined
// 从头部提炼用户的第一句提示词，作为会话的兜底摘要来源。
  // First entry's ISO timestamp → epoch ms. More reliable than
  // stat().birthtime which is unsupported on some filesystems.
  const firstTimestamp = extractJsonStringField(head, 'timestamp')
// 创建时间取首条记录的 ISO 时间戳并转成 epoch 毫秒，`stat().birthtime` 在部分文件系统上不可靠，所以改用时间戮。
  let createdAt: number | undefined
  if (firstTimestamp) {
    const parsed = Date.parse(firstTimestamp)
    if (!Number.isNaN(parsed)) createdAt = parsed
  }
  // last-prompt tail entry (captured by extractFirstPrompt at write
  // time, filtered) shows what the user was most recently doing.
  // Head scan is fallback for sessions without a last-prompt entry.
  const summary =
    customTitle ||
    extractLastJsonStringField(tail, 'lastPrompt') ||
    extractLastJsonStringField(tail, 'summary') ||
    firstPrompt
// 摘要的拼装顺序：自定标题 → 尾部最后提示 → 尾部摘要 → 首句提示，逐层兜底保证总有内容。

  // Skip metadata-only sessions (no title, no summary, no prompt)
  if (!summary) return null
// 纯元数据会话（无标题、无摘要、无提示）直接过滤掉，不进入列表。
  const gitBranch =
    extractLastJsonStringField(tail, 'gitBranch') ||
    extractJsonStringField(head, 'gitBranch') ||
    undefined
// 提取 git 分支名，优先从尾部取、其次从头部取。
  const sessionCwd =
    extractJsonStringField(head, 'cwd') || projectPath || undefined
// 工作目录 `cwd`：文件里没有就回退到工程路径，保证总能定位会话所属目录。
  // Type-scope tag extraction to the {"type":"tag"} JSONL line to avoid
  // collision with tool_use inputs containing a `tag` parameter (git tag,
  // Docker tags, cloud resource tags). Mirrors sessionStorage.ts:608.
  const tagLine = tail.split('\n').findLast(l => l.startsWith('{"type":"tag"'))
// 标签提取只认 type=tag 的那一行 JSON，避免和工具入参里同样叫 `tag` 的字段（git tag、Docker 标签、云资源标签）撞名。
  const tag = tagLine
    ? extractLastJsonStringField(tagLine, 'tag') || undefined
    : undefined

  return {
    sessionId,
    summary,
    lastModified: mtime,
    fileSize: size,
    customTitle,
    firstPrompt,
    gitBranch,
    cwd: sessionCwd,
    tag,
    createdAt,
  }
// 组装并返回完整的 `SessionInfo` 对象，所有字段到此收口。
}

// ---------------------------------------------------------------------------
// Candidate discovery — stat-only pass. Cheap: 1 syscall per file, no
// data reads. Lets us sort/filter before doing expensive head/tail reads.
// ---------------------------------------------------------------------------

type Candidate = {
// `Candidate`：扫描阶段的候选条目，只存会话 ID、路径与修改时间，必要时带上工程路径供 `cwd` 回退。
  sessionId: string
  filePath: string
  mtime: number
  /** Project path for cwd fallback when file lacks a cwd field. */
  projectPath?: string
}

/**
 * Lists candidate session files in a directory via readdir, optionally
 * stat'ing each for mtime. When `doStat` is false, mtime is set to 0
 * (caller must sort/dedup after reading file contents instead).
 */
// `listCandidates`：用 `readdir` 列出目录里的候选会话文件，可选择对每个文件 `stat` 取修改时间；`doStat` 为否时统一把时间置 0，由调用方读完内容后再排序去重。
export async function listCandidates(
  projectDir: string,
  doStat: boolean,
  projectPath?: string,
): Promise<Candidate[]> {
  let names: string[]
  try {
    names = await readdir(projectDir)
// 读目录失败（目录不存在等）就返回空数组，不向上抛错。
  } catch {
    return []
  }

  const results = await Promise.all(
    names.map(async (name): Promise<Candidate | null> => {
      if (!name.endsWith('.jsonl')) return null
      const sessionId = validateUuid(name.slice(0, -6))
// 只收 `.jsonl` 结尾的文件，并用 `validateUuid` 校验文件名前段是否为合法 UUID，过滤掉临时文件与脏数据。
      if (!sessionId) return null
      const filePath = join(projectDir, name)
      if (!doStat) return { sessionId, filePath, mtime: 0, projectPath }
      try {
        const s = await stat(filePath)
        return { sessionId, filePath, mtime: s.mtime.getTime(), projectPath }
      } catch {
        return null
      }
    }),
  )

  return results.filter((c): c is Candidate => c !== null)
// 把映射结果里非空的候选摊平成数组返回。
}

/**
 * Reads a candidate's file contents and extracts full SessionInfo.
 * Returns null if the session should be filtered out (sidechain, no summary).
 */
// `readCandidate`：读取单个候选的完整内容并提炼 `SessionInfo`，若应被过滤（旁路、无摘要）则返回 `null`。
async function readCandidate(c: Candidate): Promise<SessionInfo | null> {
  const lite = await readSessionLite(c.filePath)
// 用轻量读取拿到头尾，失败直接丢弃该候选。
  if (!lite) return null

  const info = parseSessionInfoFromLite(c.sessionId, lite, c.projectPath)
  if (!info) return null

  // Prefer stat-pass mtime for sort-key consistency; fall back to
  // lite.mtime when doStat=false (c.mtime is 0 placeholder).
  if (c.mtime) info.lastModified = c.mtime
// 排序键优先用扫描阶段 `stat` 得到的修改时间；`doStat` 为否时该值为 0 占位，改用轻量读取里的真实时间。

  return info
}

// ---------------------------------------------------------------------------
// Sort + limit — batch-read candidates in sorted order until `limit`
// survivors are collected (some candidates filter out on full read).
// ---------------------------------------------------------------------------

/** Batch size for concurrent reads when walking the sorted candidate list. */
const READ_BATCH_SIZE = 32
// `READ_BATCH_SIZE`：按排序顺序批量并发读取的批大小，平衡并发度与系统调用压力。

/**
 * Sort comparator: lastModified desc, then sessionId desc for stable
 * ordering across mtime ties.
 */
// `compareDesc`：排序比较器，按修改时间倒序；时间相同再用会话 ID 倒序，保证并列时顺序稳定。
function compareDesc(a: Candidate, b: Candidate): number {
  if (b.mtime !== a.mtime) return b.mtime - a.mtime
  return b.sessionId < a.sessionId ? -1 : b.sessionId > a.sessionId ? 1 : 0
}

// `applySortAndLimit`：先整体排序，再按排序顺序批量读取候选，凑满 `limit` 个有效会话即停（部分候选在读全内容时会被过滤）。
async function applySortAndLimit(
  candidates: Candidate[],
  limit: number | undefined,
  offset: number,
): Promise<SessionInfo[]> {
  candidates.sort(compareDesc)

  const sessions: SessionInfo[] = []
  // limit: 0 means "no limit" (matches getSessionMessages semantics)
  const want = limit && limit > 0 ? limit : Infinity
// `limit` 为 0 视为不限（与 `getSessionMessages` 语义一致），于是 `want` 取无穷大。
  let skipped = 0
  // Dedup post-filter: since candidates are sorted mtime-desc, the first
  // non-null read per sessionId is naturally the newest valid copy.
  // Pre-filter dedup would drop a session entirely if its newest-mtime
  // copy is unreadable/empty, diverging from the no-stat readAllAndSort path.
  const seen = new Set<string>()
// `seen` 集合用于读后去重：候选已按时间倒序，每个会话 ID 取到的第一个非空读取天然就是最新一版。

  for (let i = 0; i < candidates.length && sessions.length < want; ) {
// 主循环：每批并发读取最多 `READ_BATCH_SIZE` 个候选，跳过已读过的会话并扣除 `offset` 偏移量，直到凑满 `want` 个。
    const batchEnd = Math.min(i + READ_BATCH_SIZE, candidates.length)
    const batch = candidates.slice(i, batchEnd)
    const results = await Promise.all(batch.map(readCandidate))
    for (let j = 0; j < results.length && sessions.length < want; j++) {
      i++
      const r = results[j]
      if (!r) continue
      if (seen.has(r.sessionId)) continue
      seen.add(r.sessionId)
      if (skipped < offset) {
        skipped++
        continue
      }
      sessions.push(r)
    }
  }

  return sessions
}

/**
 * Read-all path for when no limit/offset is set. Skips the stat pass
 * entirely — reads every candidate, then sorts/dedups on real mtimes
 * from readSessionLite. Matches pre-refactor I/O cost (no extra stats).
 */
// `readAllAndSort`：未设置 `limit`/`offset` 时的全读路径，彻底跳过 `stat` 阶段，读完后按真实修改时间排序去重，I/O 成本和重构前一致。
async function readAllAndSort(candidates: Candidate[]): Promise<SessionInfo[]> {
  const all = await Promise.all(candidates.map(readCandidate))
  const byId = new Map<string, SessionInfo>()
// 用 `Map` 按会话 ID 收口，遇到同一会话多份副本时保留修改时间最新的一份。
  for (const s of all) {
    if (!s) continue
    const existing = byId.get(s.sessionId)
    if (!existing || s.lastModified > existing.lastModified) {
      byId.set(s.sessionId, s)
    }
  }
  const sessions = [...byId.values()]
  sessions.sort((a, b) =>
    b.lastModified !== a.lastModified
      ? b.lastModified - a.lastModified
      : b.sessionId < a.sessionId
        ? -1
        : b.sessionId > a.sessionId
          ? 1
          : 0,
  )
  return sessions
}

// ---------------------------------------------------------------------------
// Project directory enumeration (single-project vs all-projects)
// ---------------------------------------------------------------------------

/**
 * Gathers candidate session files for a specific project directory
 * (and optionally its git worktrees).
 */
// `gatherProjectCandidates`：收集单个工程目录（及其 git 工作树）下的候选会话文件，是否扫工作树由 `includeWorktrees` 决定。
async function gatherProjectCandidates(
  dir: string,
  includeWorktrees: boolean,
  doStat: boolean,
): Promise<Candidate[]> {
  const canonicalDir = await canonicalizePath(dir)
// 先把目录规范化成标准路径，后面匹配工作树和工程目录都基于此。

  let worktreePaths: string[]
  if (includeWorktrees) {
    try {
      worktreePaths = await getWorktreePathsPortable(canonicalDir)
    } catch {
      worktreePaths = []
    }
  } else {
    worktreePaths = []
  }

  // No worktrees (or git not available / scanning disabled) — just scan the single project dir
  if (worktreePaths.length <= 1) {
    const projectDir = await findProjectDir(canonicalDir)
    if (!projectDir) return []
    return listCandidates(projectDir, doStat, canonicalDir)
  }

  // Worktree-aware scanning: find all project dirs matching any worktree
  const projectsDir = getProjectsDir()
  const caseInsensitive = process.platform === 'win32'
// Windows 下路径大小写不敏感，所以匹配前缀时统一转小写，避免漏配。

  // Sort worktree paths by sanitized prefix length (longest first) so
  // more specific matches take priority over shorter ones
  const indexed = worktreePaths.map(wt => {
    const sanitized = sanitizePath(wt)
    return {
      path: wt,
      prefix: caseInsensitive ? sanitized.toLowerCase() : sanitized,
    }
  })
  indexed.sort((a, b) => b.prefix.length - a.prefix.length)
// 工作树路径按净化前缀长度倒序排序，越具体的路径越优先匹配，减少误命中。

  let allDirents: Dirent[]
  try {
    allDirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    // Fall back to single project dir
    const projectDir = await findProjectDir(canonicalDir)
    if (!projectDir) return []
    return listCandidates(projectDir, doStat, canonicalDir)
  }

  const all: Candidate[] = []
  const seenDirs = new Set<string>()

  // Always include the user's actual directory (handles subdirectories
  // like /repo/packages/my-app that won't match worktree root prefixes)
  const canonicalProjectDir = await findProjectDir(canonicalDir)
  if (canonicalProjectDir) {
    const dirBase = basename(canonicalProjectDir)
    seenDirs.add(caseInsensitive ? dirBase.toLowerCase() : dirBase)
    all.push(
      ...(await listCandidates(canonicalProjectDir, doStat, canonicalDir)),
    )
  }

  for (const dirent of allDirents) {
// 遍历工程目录下的子目录，把匹配到任一工作树前缀的目录里的会话文件一并收集。
    if (!dirent.isDirectory()) continue
    const dirName = caseInsensitive ? dirent.name.toLowerCase() : dirent.name
    if (seenDirs.has(dirName)) continue

    for (const { path: wtPath, prefix } of indexed) {
      // Only use startsWith for truncated paths (>MAX_SANITIZED_LENGTH) where
      // a hash suffix follows. For short paths, require exact match to avoid
      // /root/project matching /root/project-foo.
      const isMatch =
        dirName === prefix ||
        (prefix.length >= MAX_SANITIZED_LENGTH &&
          dirName.startsWith(prefix + '-'))
      if (isMatch) {
        seenDirs.add(dirName)
        all.push(
          ...(await listCandidates(
            join(projectsDir, dirent.name),
            doStat,
            wtPath,
          )),
        )
        break
      }
    }
  }

  return all
}

/**
 * Gathers candidate session files across all project directories.
 */
// `gatherAllCandidates`：跨所有工程目录收集候选会话文件，逐工程并发列出后摊平。
async function gatherAllCandidates(doStat: boolean): Promise<Candidate[]> {
  const projectsDir = getProjectsDir()

  let dirents: Dirent[]
  try {
    dirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const perProject = await Promise.all(
    dirents
      .filter(d => d.isDirectory())
      .map(d => listCandidates(join(projectsDir, d.name), doStat)),
  )

  return perProject.flat()
}

/**
 * Lists sessions with metadata extracted from stat + head/tail reads.
 *
 * When `dir` is provided, returns sessions for that project directory
 * and its git worktrees. When omitted, returns sessions across all
 * projects.
 *
 * Pagination via `limit`/`offset` operates on the filtered, sorted result
 * set. When either is set, a cheap stat-only pass sorts candidates before
 * expensive head/tail reads — so `limit: 20` on a directory with 1000
 * sessions does ~1000 stats + ~20 content reads, not 1000 content reads.
 * When neither is set, stat is skipped (read-all-then-sort, same I/O cost
 * as the original implementation).
 */
// `listSessionsImpl`：对外主入口，按是否提供 `dir` 走单工程或全工程收集，再按是否分页决定读取策略。
export async function listSessionsImpl(
  options?: ListSessionsOptions,
): Promise<SessionInfo[]> {
  const { dir, limit, offset, includeWorktrees } = options ?? {}
// 解构出四个查询选项，`offset` 缺省为 0。
  const off = offset ?? 0
  // Only stat when we need to sort before reading (won't read all anyway).
  // limit: 0 means "no limit" (see applySortAndLimit), so treat it as unset.
  const doStat = (limit !== undefined && limit > 0) || off > 0
// `doStat` 判定：只要设了正整数 `limit` 或非零 `offset`，就先做廉价的 `stat` 排序再读内容；否则跳过 `stat` 走全读排序。

  const candidates = dir
// 有 `dir` 走工作树感知的单工程收集，否则收集全部工程的会话。
    ? await gatherProjectCandidates(dir, includeWorktrees ?? true, doStat)
    : await gatherAllCandidates(doStat)

  if (!doStat) return readAllAndSort(candidates)
// 不分页时直接全读排序返回；分页时走带 `stat` 预排序的限量读取，避免对上千个会话做上千次全内容读取。
  return applySortAndLimit(candidates, limit, off)
}
