// 文件级：本文件是可移植的会话存储工具集，纯 Node.js 实现、不依赖日志 / 实验 / 特性开关，被 CLI 与 VS Code 扩展共享。核心能力是：校验 UUID、从截断的 JSONL 文本里抠出指定字段、从会话头提取首条用户提示、按需读写文件头尾、路径消毒与项目目录定位、以及按 compact 边界做分块读取。
/**
 * Portable session storage utilities.
 *
 * Pure Node.js — no internal dependencies on logging, experiments, or feature
 * flags. Shared between the CLI (src/utils/sessionStorage.ts) and the VS Code
 * extension (packages/claude-vscode/src/common-host/sessionStorage.ts).
 */

import type { UUID } from 'crypto'
// 从 `crypto` 引入 `UUID` 类型（仅类型，不引入运行时）。
import { open as fsOpen, readdir, realpath, stat } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getWorktreePathsPortable } from './getWorktreePathsPortable.js'
import { djb2Hash } from './hash.js'

/** Size of the head/tail buffer for lite metadata reads. */
// 轻量读取用的头尾缓冲区大小：64KB，足够覆盖绝大多数会话的元信息头部。
export const LITE_READ_BUF_SIZE = 65536

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// UUID 校验正则：8-4-4-4-12 的十六进制分段，大小写不敏感。

export function validateUuid(maybeUuid: unknown): UUID | null {
// `validateUuid`：类型守卫式校验，非字符串或格式不符都返回 null，符合才断言为 `UUID`。
  if (typeof maybeUuid !== 'string') return null
  return uuidRegex.test(maybeUuid) ? (maybeUuid as UUID) : null
}

// ---------------------------------------------------------------------------
// JSON string field extraction — no full parse, works on truncated lines
// ---------------------------------------------------------------------------

/**
 * Unescape a JSON string value extracted as raw text.
 * Only allocates a new string when escape sequences are present.
 */
export function unescapeJsonString(raw: string): string {
// `unescapeJsonString`：对从原文抠出来的 JSON 字符串值做反转义；无转义时直接返回原串，避免无谓分配。
  if (!raw.includes('\\')) return raw
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw
  }
}

/**
 * Extracts a simple JSON string field value from raw text without full parsing.
 * Looks for `"key":"value"` or `"key": "value"` patterns.
 * Returns the first match, or undefined if not found.
 */
export function extractJsonStringField(
// `extractJsonStringField`：不整体解析 JSON，而是按 key 与 value 字面模式抠出第一个字符串字段值，能在被截断的行上工作。
  text: string,
  key: string,
): string | undefined {
  const patterns = [`"${key}":"`, `"${key}": "`]
  for (const pattern of patterns) {
    const idx = text.indexOf(pattern)
    if (idx < 0) continue

    const valueStart = idx + pattern.length
    let i = valueStart
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2
        continue
      }
      if (text[i] === '"') {
        return unescapeJsonString(text.slice(valueStart, i))
      }
      i++
    }
  }
  return undefined
}

/**
 * Like extractJsonStringField but finds the LAST occurrence.
 * Useful for fields that are appended (customTitle, tag, etc.).
 */
export function extractLastJsonStringField(
// `extractLastJsonStringField`：与上一个类似，但取最后一次出现，适合被不断追加的字段（如自定义标题、标签）。
  text: string,
  key: string,
): string | undefined {
  const patterns = [`"${key}":"`, `"${key}": "`]
  let lastValue: string | undefined
  for (const pattern of patterns) {
    let searchFrom = 0
    while (true) {
      const idx = text.indexOf(pattern, searchFrom)
      if (idx < 0) break

      const valueStart = idx + pattern.length
      let i = valueStart
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === '"') {
          lastValue = unescapeJsonString(text.slice(valueStart, i))
          break
        }
        i++
      }
      searchFrom = i + 1
    }
  }
  return lastValue
}

// ---------------------------------------------------------------------------
// First prompt extraction from head chunk
// ---------------------------------------------------------------------------

/**
 * Pattern matching auto-generated or system messages that should be skipped
 * when looking for the first meaningful user prompt. Matches anything that
 * starts with a lowercase XML-like tag (IDE context, hook output, task
 * notifications, channel messages, etc.) or a synthetic interrupt marker.
 */
const SKIP_FIRST_PROMPT_PATTERN =
  /^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/
// 首条提示提取时要跳过的模式：以小写 XML 风格标签开头的系统 / 钩子 / 通知类消息，或合成的中断标记。

const COMMAND_NAME_RE = /<command-name>(.*?)<\/command-name>/
// 从斜杠命令消息里抓出命令名的辅助正则。

/**
 * Extracts the first meaningful user prompt from a JSONL head chunk.
 *
 * Skips tool_result messages, isMeta, isCompactSummary, command-name messages,
 * and auto-generated patterns (session hooks, tick, IDE metadata, etc.).
 * Truncates to 200 chars.
 */
export function extractFirstPromptFromHead(head: string): string {
// `extractFirstPromptFromHead`：从 JSONL 头部按行扫描，跳过工具结果、元消息、压缩摘要、命令名等，返回截断到 200 字符的首条有意义用户提示。
  let start = 0
  let commandFallback = ''
  while (start < head.length) {
    const newlineIdx = head.indexOf('\n', start)
    const line =
      newlineIdx >= 0 ? head.slice(start, newlineIdx) : head.slice(start)
    start = newlineIdx >= 0 ? newlineIdx + 1 : head.length

    if (!line.includes('"type":"user"') && !line.includes('"type": "user"'))
      continue
    if (line.includes('"tool_result"')) continue
    if (line.includes('"isMeta":true') || line.includes('"isMeta": true'))
      continue
    if (
      line.includes('"isCompactSummary":true') ||
      line.includes('"isCompactSummary": true')
    )
      continue

    try {
      const entry = JSON.parse(line) as Record<string, unknown>
      if (entry.type !== 'user') continue

      const message = entry.message as Record<string, unknown> | undefined
      if (!message) continue

      const content = message.content
      const texts: string[] = []
      if (typeof content === 'string') {
        texts.push(content)
      } else if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block.type === 'text' && typeof block.text === 'string') {
            texts.push(block.text as string)
          }
        }
      }

      for (const raw of texts) {
        let result = raw.replace(/\n/g, ' ').trim()
        if (!result) continue

        // Skip slash-command messages but remember first as fallback
        const cmdMatch = COMMAND_NAME_RE.exec(result)
        if (cmdMatch) {
          if (!commandFallback) commandFallback = cmdMatch[1]!
          continue
        }

        // Format bash input with ! prefix before the generic XML skip
        const bashMatch = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(result)
        if (bashMatch) return `! ${bashMatch[1]!.trim()}`

        if (SKIP_FIRST_PROMPT_PATTERN.test(result)) continue

        if (result.length > 200) {
          result = result.slice(0, 200).trim() + '\u2026'
        }
        return result
      }
    } catch {
      continue
    }
  }
  if (commandFallback) return commandFallback
  return ''
}

// ---------------------------------------------------------------------------
// File I/O — read head and tail of a file
// ---------------------------------------------------------------------------

/**
 * Reads the first and last LITE_READ_BUF_SIZE bytes of a file.
 *
 * For small files where head covers tail, `tail === head`.
 * Accepts a shared Buffer to avoid per-file allocation overhead.
 * Returns `{ head: '', tail: '' }` on any error.
 */
export async function readHeadAndTail(
// `readHeadAndTail`：用单个文件描述符一次性读文件头和尾各 64KB；小文件头已覆盖尾时两者相同；任何错误都返回空串。
  filePath: string,
  fileSize: number,
  buf: Buffer,
): Promise<{ head: string; tail: string }> {
  try {
    const fh = await fsOpen(filePath, 'r')
    try {
      const headResult = await fh.read(buf, 0, LITE_READ_BUF_SIZE, 0)
      if (headResult.bytesRead === 0) return { head: '', tail: '' }

      const head = buf.toString('utf8', 0, headResult.bytesRead)

      const tailOffset = Math.max(0, fileSize - LITE_READ_BUF_SIZE)
      let tail = head
      if (tailOffset > 0) {
        const tailResult = await fh.read(buf, 0, LITE_READ_BUF_SIZE, tailOffset)
        tail = buf.toString('utf8', 0, tailResult.bytesRead)
      }

      return { head, tail }
    } finally {
      await fh.close()
    }
  } catch {
    return { head: '', tail: '' }
  }
}

export type LiteSessionFile = {
// `LiteSessionFile` 类型：会话文件的轻量元数据，含修改时间、大小、头尾文本。
  mtime: number
  size: number
  head: string
  tail: string
}

/**
 * Opens a single session file, stats it, and reads head + tail in one fd.
 * Allocates its own buffer — safe for concurrent use with Promise.all.
 * Returns null on any error.
 */
export async function readSessionLite(
// `readSessionLite`：打开单个会话文件、stat 并读头尾，自带缓冲区，可安全并发；任何错误返回 null。
  filePath: string,
): Promise<LiteSessionFile | null> {
  try {
    const fh = await fsOpen(filePath, 'r')
    try {
      const stat = await fh.stat()
      const buf = Buffer.allocUnsafe(LITE_READ_BUF_SIZE)
      const headResult = await fh.read(buf, 0, LITE_READ_BUF_SIZE, 0)
      if (headResult.bytesRead === 0) return null

      const head = buf.toString('utf8', 0, headResult.bytesRead)
      const tailOffset = Math.max(0, stat.size - LITE_READ_BUF_SIZE)
      let tail = head
      if (tailOffset > 0) {
        const tailResult = await fh.read(buf, 0, LITE_READ_BUF_SIZE, tailOffset)
        tail = buf.toString('utf8', 0, tailResult.bytesRead)
      }

      return { mtime: stat.mtime.getTime(), size: stat.size, head, tail }
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Path sanitization
// ---------------------------------------------------------------------------

/**
 * Maximum length for a single filesystem path component (directory or file name).
 * Most filesystems (ext4, APFS, NTFS) limit individual components to 255 bytes.
 * We use 200 to leave room for the hash suffix and separator.
 */
export const MAX_SANITIZED_LENGTH = 200
// 单路径段最大安全长度 200 字节，给哈希后缀和分隔符留余量（多数文件系统限 255）。

function simpleHash(str: string): string {
// `simpleHash`：用 djb2 哈希取绝对值再转 36 进制，作为 Node 环境下的路径后缀。
  return Math.abs(djb2Hash(str)).toString(36)
}

/**
 * Makes a string safe for use as a directory or file name.
 * Replaces all non-alphanumeric characters with hyphens.
 * This ensures compatibility across all platforms, including Windows
 * where characters like colons are reserved.
 *
 * For deeply nested paths that would exceed filesystem limits (255 bytes),
 * truncates and appends a hash suffix for uniqueness.
 *
 * @param name - The string to make safe (e.g., '/Users/foo/my-project' or 'plugin:name:server')
 * @returns A safe name (e.g., '-Users-foo-my-project' or 'plugin-name-server')
 */
export function sanitizePath(name: string): string {
// `sanitizePath`：把非字母数字字符替换成短横，保证跨平台（含 Windows 保留字符）可用；超长则截断并追加哈希后缀保证唯一。
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  const hash =
    typeof Bun !== 'undefined' ? Bun.hash(name).toString(36) : simpleHash(name)
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hash}`
}

// ---------------------------------------------------------------------------
// Project directory discovery (shared by listSessions & getSessionMessages)
// ---------------------------------------------------------------------------

export function getProjectsDir(): string {
// `getProjectsDir`：返回配置目录下的 projects 目录，所有会话按项目归档于此。
  return join(getClaudeConfigHomeDir(), 'projects')
}

export function getProjectDir(projectDir: string): string {
// `getProjectDir`：把项目路径消毒后拼到 projects 目录下，作为该项目的会话归档目录。
  return join(getProjectsDir(), sanitizePath(projectDir))
}

/**
 * Resolves a directory path to its canonical form using realpath + NFC
 * normalization. Falls back to NFC-only if realpath fails (e.g., the
 * directory doesn't exist yet). Ensures symlinked paths (e.g.,
 * /tmp → /private/tmp on macOS) resolve to the same project directory.
 */
export async function canonicalizePath(dir: string): Promise<string> {
// `canonicalizePath`：用 realpath 加 NFC 归一化得到规范路径；realpath 失败（目录尚不存在）时退回仅做 NFC 归一化，确保 macOS 上 /tmp 与 /private/tmp 被当作同一项目。
  try {
    return (await realpath(dir)).normalize('NFC')
  } catch {
    return dir.normalize('NFC')
  }
}

/**
 * Finds the project directory for a given path, tolerating hash mismatches
 * for long paths (>200 chars). The CLI uses Bun.hash while the SDK under
 * Node.js uses simpleHash — for paths that exceed MAX_SANITIZED_LENGTH,
 * these produce different directory suffixes. This function falls back to
 * prefix-based scanning when the exact match doesn't exist.
 */
export async function findProjectDir(
// `findProjectDir`：定位项目目录，容忍长路径的哈希不一致（CLI 用 Bun.hash、Node SDK 用 simpleHash）；精确匹配失败时按前缀扫描兜底。
  projectPath: string,
): Promise<string | undefined> {
  const exact = getProjectDir(projectPath)
  try {
    await readdir(exact)
    return exact
  } catch {
    // Exact match failed — for short paths this means no sessions exist.
    // For long paths, try prefix matching to handle hash mismatches.
    const sanitized = sanitizePath(projectPath)
    if (sanitized.length <= MAX_SANITIZED_LENGTH) {
      return undefined
    }
    const prefix = sanitized.slice(0, MAX_SANITIZED_LENGTH)
    const projectsDir = getProjectsDir()
    try {
      const dirents = await readdir(projectsDir, { withFileTypes: true })
      const match = dirents.find(
        d => d.isDirectory() && d.name.startsWith(prefix + '-'),
      )
      return match ? join(projectsDir, match.name) : undefined
    } catch {
      return undefined
    }
  }
}

/**
 * Resolve a sessionId to its on-disk JSONL file path.
 *
 * When `dir` is provided: canonicalize it, look in that project's directory
 * (with findProjectDir fallback for Bun/Node hash mismatches), then fall back
 * to sibling git worktrees. `projectPath` in the result is the canonical
 * user-facing directory the file was found under.
 *
 * When `dir` is omitted: scan all project directories under ~/.claude/projects/.
 * `projectPath` is undefined in this case (no meaningful project path to report).
 *
 * Existence is checked by stat (operate-then-catch-ENOENT, no existsSync).
 * Zero-byte files are treated as not-found so callers continue searching past
 * a truncated copy to find a valid one in a sibling directory.
 *
 * `fileSize` is returned so callers (loadSessionBuffer) don't need to re-stat.
 *
 * Shared by getSessionInfoImpl and getSessionMessagesImpl — the caller
 * invokes its own reader (readSessionLite / loadSessionBuffer) on the
 * resolved path.
 */
export async function resolveSessionFilePath(
// `resolveSessionFilePath`：把 sessionId 解析成磁盘上的 JSONL 路径；给定目录时先在该项目下找、再退回兄弟 git worktree；无目录时扫描全部项目。用 stat 判存在，零字节文件视作不存在。
  sessionId: string,
  dir?: string,
): Promise<
  | { filePath: string; projectPath: string | undefined; fileSize: number }
  | undefined
> {
  const fileName = `${sessionId}.jsonl`

  if (dir) {
    const canonical = await canonicalizePath(dir)
    const projectDir = await findProjectDir(canonical)
    if (projectDir) {
      const filePath = join(projectDir, fileName)
      try {
        const s = await stat(filePath)
        if (s.size > 0)
          return { filePath, projectPath: canonical, fileSize: s.size }
      } catch {
        // ENOENT/EACCES — keep searching
      }
    }
    // Worktree fallback — sessions may live under a different worktree root
    let worktreePaths: string[]
    try {
      worktreePaths = await getWorktreePathsPortable(canonical)
    } catch {
      worktreePaths = []
    }
    for (const wt of worktreePaths) {
      if (wt === canonical) continue
      const wtProjectDir = await findProjectDir(wt)
      if (!wtProjectDir) continue
      const filePath = join(wtProjectDir, fileName)
      try {
        const s = await stat(filePath)
        if (s.size > 0) return { filePath, projectPath: wt, fileSize: s.size }
      } catch {
        // ENOENT/EACCES — keep searching
      }
    }
    return undefined
  }

  // No dir — scan all project directories
  const projectsDir = getProjectsDir()
  let dirents: string[]
  try {
    dirents = await readdir(projectsDir)
  } catch {
    return undefined
  }
  for (const name of dirents) {
    const filePath = join(projectsDir, name, fileName)
    try {
      const s = await stat(filePath)
      if (s.size > 0)
        return { filePath, projectPath: undefined, fileSize: s.size }
    } catch {
      // ENOENT/ENOTDIR — not in this project, keep scanning
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Compact-boundary chunked read (shared by loadTranscriptFile & SDK getSessionMessages)
// ---------------------------------------------------------------------------

/** Chunk size for the forward transcript reader. 1 MB balances I/O calls vs buffer growth. */
const TRANSCRIPT_READ_CHUNK_SIZE = 1024 * 1024
// 前向分块读取的块大小 1MB，在 I/O 次数与缓冲区增长之间取平衡。

/**
 * File size below which precompact filtering is skipped.
 * Large sessions (>5 MB) almost always have compact boundaries — they got big
 * because of many turns triggering auto-compact.
 */
export const SKIP_PRECOMPACT_THRESHOLD = 5 * 1024 * 1024
// 跳过预压缩过滤的文件大小阈值 5MB：大会话几乎必然有 compact 边界。

/** Marker bytes searched for when locating the boundary. Lazy: allocated on
 * first use, not at module load. Most sessions never resume. */
let _compactBoundaryMarker: Buffer | undefined
function compactBoundaryMarker(): Buffer {
// `compactBoundaryMarker`：懒加载的边界标记字节，首次使用时才分配（多数会话不会 resume）。
  return (_compactBoundaryMarker ??= Buffer.from('"compact_boundary"'))
}

/**
 * Confirm a byte-matched line is a real compact_boundary (marker can appear
 * inside user content) and check for preservedSegment.
 */
function parseBoundaryLine(
// `parseBoundaryLine`：确认字节匹配的行确实是真实 compact 边界（标记可能出现在用户内容里），并探测是否有 preservedSegment。
  line: string,
): { hasPreservedSegment: boolean } | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: string
      subtype?: string
      compactMetadata?: { preservedSegment?: unknown }
    }
    if (parsed.type !== 'system' || parsed.subtype !== 'compact_boundary') {
      return null
    }
    return {
      hasPreservedSegment: Boolean(parsed.compactMetadata?.preservedSegment),
    }
  } catch {
    return null
  }
}

/**
 * Single forward chunked read for the --resume load path. Attr-snap lines
 * are skipped at the fd level; compact boundaries truncate in-stream. Peak
 * is the output size, not the file size.
 *
 * The surviving (last) attr-snap is appended at EOF instead of in-place;
 * restoreAttributionStateFromSnapshots only reads [length-1] so position
 * doesn't matter.
 */

type Sink = { buf: Buffer; len: number; cap: number }

function sinkWrite(s: Sink, src: Buffer, start: number, end: number): void {
// `sinkWrite`：往输出 Sink 追加字节，容量不足时按翻倍策略扩容但不超过上限。
  const n = end - start
  if (n <= 0) return
  if (s.len + n > s.buf.length) {
    const grown = Buffer.allocUnsafe(
      Math.min(Math.max(s.buf.length * 2, s.len + n), s.cap),
    )
    s.buf.copy(grown, 0, 0, s.len)
    s.buf = grown
  }
  src.copy(s.buf, s.len, start, end)
  s.len += n
}

function hasPrefix(
// `hasPrefix`：在缓冲区指定区间比对前缀字节，用于快速识别各类固定前缀行。
  src: Buffer,
  prefix: Buffer,
  at: number,
  end: number,
): boolean {
  return (
    end - at >= prefix.length &&
    src.compare(prefix, 0, prefix.length, at, at + prefix.length) === 0
  )
}

const ATTR_SNAP_PREFIX = Buffer.from('{"type":"attribution-snapshot"')
// 三类前缀常量与边界搜索上限：用于分块读取时就地剥离归属快照、按 compact 边界截断。
const SYSTEM_PREFIX = Buffer.from('{"type":"system"')
const LF = 0x0a
const LF_BYTE = Buffer.from([LF])
const BOUNDARY_SEARCH_BOUND = 256 // marker sits ~28 bytes in; 256 is slack

type LoadState = {
// `LoadState`：分块读取的状态机，记录输出缓冲、边界偏移、最近归属快照、跨块残留等。
  out: Sink
  boundaryStartOffset: number
  hasPreservedSegment: boolean
  lastSnapSrc: Buffer | null // most-recent attr-snap, appended at EOF
  lastSnapLen: number
  lastSnapBuf: Buffer | undefined
  bufFileOff: number // file offset of buf[0]
  carryLen: number
  carryBuf: Buffer | undefined
  straddleSnapCarryLen: number // per-chunk; reset by processStraddle
  straddleSnapTailEnd: number
}

// Line spanning the chunk seam. 0 = fall through to concat.
function processStraddle(
// `processStraddle`：处理跨块接缝处被截断的行，识别跨块归属快照与边界。
  s: LoadState,
  chunk: Buffer,
  bytesRead: number,
): number {
  s.straddleSnapCarryLen = 0
  s.straddleSnapTailEnd = 0
  if (s.carryLen === 0) return 0
  const cb = s.carryBuf!
  const firstNl = chunk.indexOf(LF)
  if (firstNl === -1 || firstNl >= bytesRead) return 0
  const tailEnd = firstNl + 1
  if (hasPrefix(cb, ATTR_SNAP_PREFIX, 0, s.carryLen)) {
    s.straddleSnapCarryLen = s.carryLen
    s.straddleSnapTailEnd = tailEnd
    s.lastSnapSrc = null
  } else if (s.carryLen < ATTR_SNAP_PREFIX.length) {
    return 0 // too short to rule out attr-snap
  } else {
    if (hasPrefix(cb, SYSTEM_PREFIX, 0, s.carryLen)) {
      const hit = parseBoundaryLine(
        cb.toString('utf-8', 0, s.carryLen) +
          chunk.toString('utf-8', 0, firstNl),
      )
      if (hit?.hasPreservedSegment) {
        s.hasPreservedSegment = true
      } else if (hit) {
        s.out.len = 0
        s.boundaryStartOffset = s.bufFileOff
        s.hasPreservedSegment = false
        s.lastSnapSrc = null
      }
    }
    sinkWrite(s.out, cb, 0, s.carryLen)
    sinkWrite(s.out, chunk, 0, tailEnd)
  }
  s.bufFileOff += s.carryLen + tailEnd
  s.carryLen = 0
  return tailEnd
}

// Strip attr-snaps, truncate on boundaries. Kept lines write as runs.
function scanChunkLines(
// `scanChunkLines`：扫描单块内的行，剥离归属快照、遇到 compact 边界则截断输出。
  s: LoadState,
  buf: Buffer,
  boundaryMarker: Buffer,
): { lastSnapStart: number; lastSnapEnd: number; trailStart: number } {
  let boundaryAt = buf.indexOf(boundaryMarker)
  let runStart = 0
  let lineStart = 0
  let lastSnapStart = -1
  let lastSnapEnd = -1
  let nl = buf.indexOf(LF)
  while (nl !== -1) {
    const lineEnd = nl + 1
    if (boundaryAt !== -1 && boundaryAt < lineStart) {
      boundaryAt = buf.indexOf(boundaryMarker, lineStart)
    }
    if (hasPrefix(buf, ATTR_SNAP_PREFIX, lineStart, lineEnd)) {
      sinkWrite(s.out, buf, runStart, lineStart)
      lastSnapStart = lineStart
      lastSnapEnd = lineEnd
      runStart = lineEnd
    } else if (
      boundaryAt >= lineStart &&
      boundaryAt < Math.min(lineStart + BOUNDARY_SEARCH_BOUND, lineEnd)
    ) {
      const hit = parseBoundaryLine(buf.toString('utf-8', lineStart, nl))
      if (hit?.hasPreservedSegment) {
        s.hasPreservedSegment = true // don't truncate; preserved msgs already in output
      } else if (hit) {
        s.out.len = 0
        s.boundaryStartOffset = s.bufFileOff + lineStart
        s.hasPreservedSegment = false
        s.lastSnapSrc = null
        lastSnapStart = -1
        s.straddleSnapCarryLen = 0
        runStart = lineStart
      }
      boundaryAt = buf.indexOf(
        boundaryMarker,
        boundaryAt + boundaryMarker.length,
      )
    }
    lineStart = lineEnd
    nl = buf.indexOf(LF, lineStart)
  }
  sinkWrite(s.out, buf, runStart, lineStart)
  return { lastSnapStart, lastSnapEnd, trailStart: lineStart }
}

// In-buf snap wins over straddle (later in file). carryBuf still valid here.
function captureSnap(
// `captureSnap`：捕获最近一条归属快照（块内优先于跨块），供末尾追加。
  s: LoadState,
  buf: Buffer,
  chunk: Buffer,
  lastSnapStart: number,
  lastSnapEnd: number,
): void {
  if (lastSnapStart !== -1) {
    s.lastSnapLen = lastSnapEnd - lastSnapStart
    if (s.lastSnapBuf === undefined || s.lastSnapLen > s.lastSnapBuf.length) {
      s.lastSnapBuf = Buffer.allocUnsafe(s.lastSnapLen)
    }
    buf.copy(s.lastSnapBuf, 0, lastSnapStart, lastSnapEnd)
    s.lastSnapSrc = s.lastSnapBuf
  } else if (s.straddleSnapCarryLen > 0) {
    s.lastSnapLen = s.straddleSnapCarryLen + s.straddleSnapTailEnd
    if (s.lastSnapBuf === undefined || s.lastSnapLen > s.lastSnapBuf.length) {
      s.lastSnapBuf = Buffer.allocUnsafe(s.lastSnapLen)
    }
    s.carryBuf!.copy(s.lastSnapBuf, 0, 0, s.straddleSnapCarryLen)
    chunk.copy(s.lastSnapBuf, s.straddleSnapCarryLen, 0, s.straddleSnapTailEnd)
    s.lastSnapSrc = s.lastSnapBuf
  }
}

function captureCarry(s: LoadState, buf: Buffer, trailStart: number): void {
// `captureCarry`：把块尾未完成的残留行保存到 carry 缓冲，留给下一块接续。
  s.carryLen = buf.length - trailStart
  if (s.carryLen > 0) {
    if (s.carryBuf === undefined || s.carryLen > s.carryBuf.length) {
      s.carryBuf = Buffer.allocUnsafe(s.carryLen)
    }
    buf.copy(s.carryBuf, 0, trailStart, buf.length)
  }
}

function finalizeOutput(s: LoadState): void {
// `finalizeOutput`：末尾处理残留，并在必要时插入一个换行，把最后一条归属快照追加到 EOF。
  if (s.carryLen > 0) {
    const cb = s.carryBuf!
    if (hasPrefix(cb, ATTR_SNAP_PREFIX, 0, s.carryLen)) {
      s.lastSnapSrc = cb
      s.lastSnapLen = s.carryLen
    } else {
      sinkWrite(s.out, cb, 0, s.carryLen)
    }
  }
  if (s.lastSnapSrc) {
    if (s.out.len > 0 && s.out.buf[s.out.len - 1] !== LF) {
      sinkWrite(s.out, LF_BYTE, 0, 1)
    }
    sinkWrite(s.out, s.lastSnapSrc, 0, s.lastSnapLen)
  }
}

export async function readTranscriptForLoad(
// `readTranscriptForLoad`：--resume 加载路径的前向分块读取总入口，剥离归属快照、按 compact 边界截断，返回边界偏移、边界后缓冲与是否有保留段。
  filePath: string,
  fileSize: number,
): Promise<{
  boundaryStartOffset: number
  postBoundaryBuf: Buffer
  hasPreservedSegment: boolean
}> {
  const boundaryMarker = compactBoundaryMarker()
  const CHUNK_SIZE = TRANSCRIPT_READ_CHUNK_SIZE

  const s: LoadState = {
    out: {
      // Gated callers enter with fileSize > 5MB, so min(fileSize, 8MB) lands
      // in [5, 8]MB; large boundaryless sessions (24-31MB output) take 2
      // grows. Ungated callers (attribution.ts) pass small files too — the
      // min just right-sizes the initial buf, no grows.
      buf: Buffer.allocUnsafe(Math.min(fileSize, 8 * 1024 * 1024)),
      len: 0,
      // +1: finalizeOutput may insert one LF between a non-LF-terminated
      // carry and the reordered last attr-snap (crash-truncated file).
      cap: fileSize + 1,
    },
    boundaryStartOffset: 0,
    hasPreservedSegment: false,
    lastSnapSrc: null,
    lastSnapLen: 0,
    lastSnapBuf: undefined,
    bufFileOff: 0,
    carryLen: 0,
    carryBuf: undefined,
    straddleSnapCarryLen: 0,
    straddleSnapTailEnd: 0,
  }

  const chunk = Buffer.allocUnsafe(CHUNK_SIZE)
  const fd = await fsOpen(filePath, 'r')
  try {
    let filePos = 0
    while (filePos < fileSize) {
      const { bytesRead } = await fd.read(
        chunk,
        0,
        Math.min(CHUNK_SIZE, fileSize - filePos),
        filePos,
      )
      if (bytesRead === 0) break
      filePos += bytesRead

      const chunkOff = processStraddle(s, chunk, bytesRead)

      let buf: Buffer
      if (s.carryLen > 0) {
        const bufLen = s.carryLen + (bytesRead - chunkOff)
        buf = Buffer.allocUnsafe(bufLen)
        s.carryBuf!.copy(buf, 0, 0, s.carryLen)
        chunk.copy(buf, s.carryLen, chunkOff, bytesRead)
      } else {
        buf = chunk.subarray(chunkOff, bytesRead)
      }

      const r = scanChunkLines(s, buf, boundaryMarker)
      captureSnap(s, buf, chunk, r.lastSnapStart, r.lastSnapEnd)
      captureCarry(s, buf, r.trailStart)
      s.bufFileOff += r.trailStart
    }
    finalizeOutput(s)
  } finally {
    await fd.close()
  }

  return {
    boundaryStartOffset: s.boundaryStartOffset,
    postBoundaryBuf: s.out.buf.subarray(0, s.out.len),
    hasPreservedSegment: s.hasPreservedSegment,
  }
}
