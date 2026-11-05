import { appendFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getProjectRoot, getSessionId } from './bootstrap/state.js'
import { registerCleanup } from './utils/cleanupRegistry.js'
import type { HistoryEntry, PastedContent } from './utils/config.js'
import { logForDebugging } from './utils/debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './utils/envUtils.js'
import { getErrnoCode } from './utils/errors.js'
import { readLinesReverse } from './utils/fsOperations.js'
import { lock } from './utils/lockfile.js'
import {
  hashPastedText,
  retrievePastedText,
  storePastedText,
} from './utils/pasteStore.js'
import { sleep } from './utils/sleep.js'
import { jsonParse, jsonStringify } from './utils/slowOperations.js'

// 历史上限一百条：上翻记忆不需要无限长，超出的直接被窗口截掉
const MAX_HISTORY_ITEMS = 100
// 一千零二十四字符以内的粘贴内容内联存，超过的走内容寻址的外部存储
const MAX_PASTED_CONTENT_LENGTH = 1024

/**
 * Stored paste content - either inline content or a hash reference to paste store.
 */
// 存下来的粘贴内容有两种形态：内联正文，或者指向外部存储的哈希
type StoredPastedContent = {
  id: number
  type: 'text' | 'image'
  content?: string // Inline content for small pastes
  contentHash?: string // Hash reference for large pastes stored externally
  mediaType?: string
  filename?: string
}

// 占位符格式必须与解析正则严格对应，数字在单次提示内唯一但跨提示会重号
/**
 * Claude Code parses history for pasted content references to match back to
 * pasted content. The references look like:
 *   Text: [Pasted text #1 +10 lines]
 *   Image: [Image #2]
 * The numbers are expected to be unique within a single prompt but not across
 * prompts. We choose numeric, auto-incrementing IDs as they are more
 * user-friendly than other ID options.
 */

// 沿用旧实现的计数口径：三段文本算两行而不是三行，改动会破坏已有历史
// Note: The original text paste implementation would consider input like
// "line1\nline2\nline3" to have +2 lines, not 3 lines. We preserve that
// behavior here.
// 数换行符的个数而不是行数：这是上一行说到的旧口径
export function getPastedTextRefNumLines(text: string): number {
  return (text.match(/\r\n|\r|\n/g) || []).length
}

// 零行时省掉行数后缀，避免出现加零行这种读起来别扭的写法
export function formatPastedTextRef(id: number, numLines: number): string {
  if (numLines === 0) {
    return `[Pasted text #${id}]`
  }
  return `[Pasted text #${id} +${numLines} lines]`
}

export function formatImageRef(id: number): string {
  return `[Image #${id}]`
}

// 解析占位符：三种前缀共用一条正则，截断文本也按同一形状处理
export function parseReferences(
  input: string,
): Array<{ id: number; match: string; index: number }> {
  const referencePattern =
    /\[(Pasted text|Image|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g
  const matches = [...input.matchAll(referencePattern)]
  return matches
    .map(match => ({
      id: parseInt(match[2] || '0'),
      match: match[0],
      index: match.index,
    }))
    .filter(match => match.id > 0)
}

/**
 * Replace [Pasted text #N] placeholders in input with their actual content.
 * Image refs are left alone — they become content blocks, not inlined text.
 */
// 展开文本占位符：图片占位符不动，它们会变成内容块而不是内联文本
export function expandPastedTextRefs(
  input: string,
  pastedContents: Record<number, PastedContent>,
): string {
  const refs = parseReferences(input)
  let expanded = input
// 从后往前替换：先动后面的位置，前面的偏移才不会被自己改写掉
  // Splice at the original match offsets so placeholder-like strings inside
  // pasted content are never confused for real refs. Reverse order keeps
  // earlier offsets valid after later replacements.
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!
    const content = pastedContents[ref.id]
// 只展开文本类型，图片与未知类型原样保留
    if (content?.type !== 'text') continue
    expanded =
      expanded.slice(0, ref.index) +
      content.content +
      expanded.slice(ref.index + ref.match.length)
  }
  return expanded
}

function deserializeLogEntry(line: string): LogEntry {
  return jsonParse(line) as LogEntry
}

// 日志读取器：先吐还没落盘的，再倒序读文件，两段拼起来才是完整的倒序历史
async function* makeLogEntryReader(): AsyncGenerator<LogEntry> {
  const currentSession = getSessionId()

  // Start with entries that have yet to be flushed to disk
// 待写缓冲按倒序吐：数组是追加的，最新的一条在末尾
  for (let i = pendingEntries.length - 1; i >= 0; i--) {
    yield pendingEntries[i]!
  }

  // Read from global history file (shared across all projects)
// 历史文件是全局共享的，会话与项目过滤在读出来之后做
  const historyPath = join(getClaudeConfigHomeDir(), 'history.jsonl')

// 文件不存在不是错误：第一次使用还没有历史文件
  try {
    for await (const line of readLinesReverse(historyPath)) {
      try {
        const entry = deserializeLogEntry(line)
        // removeLastFromHistory slow path: entry was flushed before removal,
        // so filter here so both getHistory (Up-arrow) and makeHistoryReader
        // (ctrl+r search) skip it consistently.
// 撤销过的条目可能已经落盘，读的时候按时间戳跳过，两条读取路径都要遵守
        if (
          entry.sessionId === currentSession &&
          skippedTimestamps.has(entry.timestamp)
        ) {
          continue
        }
        yield entry
      } catch (error) {
// before
        // Not a critical error - just skip malformed lines
        logForDebugging(`Failed to parse history line: ${error}`)
      }
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return
    }
    throw e
  }
}

// 对外读取器：把存储结构翻译成对外的历史条目，顺带解析粘贴内容
export async function* makeHistoryReader(): AsyncGenerator<HistoryEntry> {
  for await (const entry of makeLogEntryReader()) {
    yield await logEntryToHistoryEntry(entry)
  }
}

export type TimestampedHistoryEntry = {
  display: string
  timestamp: number
  resolve: () => Promise<HistoryEntry>
}

/**
 * Current-project history for the ctrl+r picker: deduped by display text,
 * newest first, with timestamps. Paste contents are resolved lazily via
 * `resolve()` — the picker only reads display+timestamp for the list.
 */
// 给搜索面板用的版本：按显示文本去重、只留当前项目、粘贴内容延迟解析
export async function* getTimestampedHistory(): AsyncGenerator<TimestampedHistoryEntry> {
  const currentProject = getProjectRoot()
// 去重集合按项目内计数，达到上限就停，不再继续扫文件
  const seen = new Set<string>()

  for await (const entry of makeLogEntryReader()) {
    if (!entry || typeof entry.project !== 'string') continue
    if (entry.project !== currentProject) continue
    if (seen.has(entry.display)) continue
    seen.add(entry.display)

    yield {
      display: entry.display,
      timestamp: entry.timestamp,
// 延迟解析很关键：列表只读显示文本与时间戳，正文等用户选中再取
      resolve: () => logEntryToHistoryEntry(entry),
    }

    if (seen.size >= MAX_HISTORY_ITEMS) return
  }
}

/**
 * Get history entries for the current project, with current session's entries first.
 *
 * Entries from the current session are yielded before entries from other sessions,
 * so concurrent sessions don't interleave their up-arrow history. Within each group,
 * order is newest-first. Scans the same MAX_HISTORY_ITEMS window as before —
 * entries are reordered within that window, not beyond it.
 */
// 上翻历史：本会话的条目先吐，其他会话的排队等候，避免并发会话互相插入
export async function* getHistory(): AsyncGenerator<HistoryEntry> {
  const currentProject = getProjectRoot()
  const currentSession = getSessionId()
// 其他会话的条目先攒着，等本会话吐完再按原顺序补上
  const otherSessionEntries: LogEntry[] = []
  let yielded = 0

  for await (const entry of makeLogEntryReader()) {
    // Skip malformed entries (corrupted file, old format, or invalid JSON structure)
    if (!entry || typeof entry.project !== 'string') continue
    if (entry.project !== currentProject) continue

// 本会话直接吐，保证连续按上翻时看到的都是自己刚输入的
    if (entry.sessionId === currentSession) {
      yield await logEntryToHistoryEntry(entry)
      yielded++
    } else {
      otherSessionEntries.push(entry)
    }

    // Same MAX_HISTORY_ITEMS window as before — just reordered within it.
    if (yielded + otherSessionEntries.length >= MAX_HISTORY_ITEMS) break
  }

// 补吐其他会话时再检查一次上限，两段加起来不超过一百条
  for (const entry of otherSessionEntries) {
    if (yielded >= MAX_HISTORY_ITEMS) return
    yield await logEntryToHistoryEntry(entry)
    yielded++
  }
}

// 存储结构：显示文本、粘贴内容表、时间戳、项目路径与会话号
type LogEntry = {
  display: string
  pastedContents: Record<number, StoredPastedContent>
  timestamp: number
  project: string
  sessionId?: string
}

/**
 * Resolve stored paste content to full PastedContent by fetching from paste store if needed.
 */
// 解析粘贴内容：有内联正文就直接用，有哈希就去外部存储取
async function resolveStoredPastedContent(
  stored: StoredPastedContent,
): Promise<PastedContent | null> {
  // If we have inline content, use it directly
  if (stored.content) {
    return {
      id: stored.id,
      type: stored.type,
      content: stored.content,
      mediaType: stored.mediaType,
      filename: stored.filename,
    }
  }

  // If we have a hash reference, fetch from paste store
// 外部存储里也找不到就返回空，调用方会把这一条剔除
  if (stored.contentHash) {
    const content = await retrievePastedText(stored.contentHash)
    if (content) {
      return {
        id: stored.id,
        type: stored.type,
        content,
        mediaType: stored.mediaType,
        filename: stored.filename,
      }
    }
  }

  // Content not available
  return null
}

/**
 * Convert LogEntry to HistoryEntry by resolving paste store references.
 */
// 逐条解析粘贴内容，取不到的条目直接跳过，不让一条坏数据拖垮整条历史
async function logEntryToHistoryEntry(entry: LogEntry): Promise<HistoryEntry> {
  const pastedContents: Record<number, PastedContent> = {}

  for (const [id, stored] of Object.entries(entry.pastedContents || {})) {
    const resolved = await resolveStoredPastedContent(stored)
    if (resolved) {
      pastedContents[Number(id)] = resolved
    }
  }

  return {
    display: entry.display,
    pastedContents,
  }
}

// 待写缓冲与写入中的标志：两者配合避免并发写与重入
let pendingEntries: LogEntry[] = []
let isWriting = false
let currentFlushPromise: Promise<void> | null = null
let cleanupRegistered = false
let lastAddedEntry: LogEntry | null = null
// Timestamps of entries already flushed to disk that should be skipped when
// reading. Used by removeLastFromHistory when the entry has raced past the
// pending buffer. Session-scoped (module state resets on process restart).
// 已落盘却被撤销的条目按时间戳记录，读取时跳过
const skippedTimestamps = new Set<number>()

// Core flush logic - writes pending entries to disk
// 真正落盘：先创建文件（追加模式），再拿文件锁，最后一次性追加
async function immediateFlushHistory(): Promise<void> {
  if (pendingEntries.length === 0) {
    return
  }

  let release
  try {
    const historyPath = join(getClaudeConfigHomeDir(), 'history.jsonl')

    // Ensure the file exists before acquiring lock (append mode creates if missing)
// 先建文件再上锁：锁的实现依赖文件已存在
    await writeFile(historyPath, '', {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'a',
    })

// 锁带十秒过期与三次重试，防止上一个进程崩溃后永久占锁
    release = await lock(historyPath, {
      stale: 10000,
      retries: {
        retries: 3,
        minTimeout: 50,
      },
    })

// 序列化在清空缓冲之前做：序列化抛错时缓冲还在，下一次能重试
    const jsonLines = pendingEntries.map(entry => jsonStringify(entry) + '\n')
    pendingEntries = []

    await appendFile(historyPath, jsonLines.join(''), { mode: 0o600 })
  } catch (error) {
    logForDebugging(`Failed to write prompt history: ${error}`)
  } finally {
    if (release) {
      await release()
    }
  }
}

// 带重试的刷写：正在写就返回，缓冲空了也返回
async function flushPromptHistory(retries: number): Promise<void> {
  if (isWriting || pendingEntries.length === 0) {
    return
  }

  // Stop trying to flush history until the next user prompt
// 重试超过五次就放弃，等下一次用户输入时再试，避免热循环
  if (retries > 5) {
    return
  }

  isWriting = true

  try {
    await immediateFlushHistory()
  } finally {
    isWriting = false

// 写完还有剩余说明期间又来了新条目，隔半秒再刷一轮
    if (pendingEntries.length > 0) {
      // Avoid trying again in a hot loop
      await sleep(500)

      void flushPromptHistory(retries + 1)
    }
  }
}

// 加入一条历史：先把粘贴内容按大小分流存储，再落进缓冲
async function addToPromptHistory(
  command: HistoryEntry | string,
): Promise<void> {
  const entry =
    typeof command === 'string'
      ? { display: command, pastedContents: {} }
      : command

  const storedPastedContents: Record<number, StoredPastedContent> = {}
  if (entry.pastedContents) {
    for (const [id, content] of Object.entries(entry.pastedContents)) {
      // Filter out images (they're stored separately in image-cache)
      if (content.type === 'image') {
        continue
      }

      // For small text content, store inline
// 小文本内联存，重新打开历史时不需要再读外部文件
      if (content.content.length <= MAX_PASTED_CONTENT_LENGTH) {
        storedPastedContents[Number(id)] = {
          id: content.id,
          type: content.type,
          content: content.content,
          mediaType: content.mediaType,
          filename: content.filename,
        }
      } else {
        // For large text content, compute hash synchronously and store reference
        // The actual disk write happens async (fire-and-forget)
// 大文本算哈希做内容寻址，重复内容天然去重
        const hash = hashPastedText(content.content)
        storedPastedContents[Number(id)] = {
          id: content.id,
          type: content.type,
          contentHash: hash,
          mediaType: content.mediaType,
          filename: content.filename,
        }
        // Fire-and-forget disk write - don't block history entry creation
        void storePastedText(hash, content.content)
      }
    }
  }

// 补齐时间戳、项目与会话号，这三个字段是后续过滤与排序的依据
  const logEntry: LogEntry = {
    ...entry,
    pastedContents: storedPastedContents,
    timestamp: Date.now(),
    project: getProjectRoot(),
    sessionId: getSessionId(),
  }

  pendingEntries.push(logEntry)
  lastAddedEntry = logEntry
  currentFlushPromise = flushPromptHistory(0)
  void currentFlushPromise
}

// 对外入口：验证会话可以整体跳过历史写入，避免污染真实历史
export function addToHistory(command: HistoryEntry | string): void {
  // Skip history when running in a tmux session spawned by Claude Code's Tungsten tool.
  // This prevents verification/test sessions from polluting the user's real command history.
  if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY)) {
    return
  }

  // Register cleanup on first use
  if (!cleanupRegistered) {
    cleanupRegistered = true
// 首次调用时注册清理：退出前等当前刷写完成，再做最后一次
    registerCleanup(async () => {
      // If there's an in-progress flush, wait for it
      if (currentFlushPromise) {
        await currentFlushPromise
      }
      // If there are still pending entries after the flush completed, do one final flush
      if (pendingEntries.length > 0) {
        await immediateFlushHistory()
      }
    })
  }

  void addToPromptHistory(command)
}

// 清空待写缓冲与撤销记录：换会话或重置时调用
export function clearPendingHistoryEntries(): void {
  pendingEntries = []
  lastAddedEntry = null
  skippedTimestamps.clear()
}

// 撤销最近一条：先试缓冲，缓冲区里没有说明已经落盘，改走时间戳跳过
/**
 * Undo the most recent addToHistory call. Used by auto-restore-on-interrupt:
 * when Esc rewinds the conversation before any response arrives, the submit is
 * semantically undone — the history entry should be too, otherwise Up-arrow
 * shows the restored text twice (once from the input box, once from disk).
 *
 * Fast path pops from the pending buffer. If the async flush already won the
 * race (TTFT is typically >> disk write latency), the entry's timestamp is
 * added to a skip-set consulted by getHistory. One-shot: clears the tracked
 * entry so a second call is a no-op.
 */
export function removeLastFromHistory(): void {
  if (!lastAddedEntry) return
  const entry = lastAddedEntry
  lastAddedEntry = null

// 缓冲里找到就直接删除，这条还没落盘，删除即彻底
  const idx = pendingEntries.lastIndexOf(entry)
  if (idx !== -1) {
    pendingEntries.splice(idx, 1)
  } else {
    skippedTimestamps.add(entry.timestamp)
  }
}
