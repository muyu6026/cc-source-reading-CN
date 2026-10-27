import { feature } from 'bun:bundle'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { readdir, readFile, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import type { QuerySource } from 'src/constants/querySource.js'
import {
  setLastAPIRequest,
  setLastAPIRequestMessages,
} from '../bootstrap/state.js'
import { TICK_TAG } from '../constants/xml.js'
import {
  type LogOption,
  type SerializedMessage,
  sortLogs,
} from '../types/logs.js'
import { CACHE_PATHS } from './cachePaths.js'
import { stripDisplayTags, stripDisplayTagsAllowEmpty } from './displayTags.js'
import { isEnvTruthy } from './envUtils.js'
import { toError } from './errors.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'
import { jsonParse } from './slowOperations.js'

/**
 * Gets the display title for a log/session with fallback logic.
 * Skips firstPrompt if it starts with a tick/goal tag (autonomous mode auto-prompt).
 * Strips display-unfriendly tags (like <ide_opened_file>) from the result.
 * Falls back to a truncated session ID when no other title is available.
 */
export function getLogDisplayTitle(
// `getLogDisplayTitle` 按优先级拼出日志或会话的显示标题，并去除不友好标签。
  log: LogOption,
  defaultTitle?: string,
): string {
  // Skip firstPrompt if it's a tick/goal message (autonomous mode auto-prompt)
  const isAutonomousPrompt = log.firstPrompt?.startsWith(`<${TICK_TAG}>`)
  // Strip display-unfriendly tags (command-name, ide_opened_file, etc.) early
  // so that command-only prompts (e.g. /clear) become empty and fall through
  // to the next fallback instead of showing raw XML tags.
  // Note: stripDisplayTags returns the original when stripping yields empty,
  // so we call stripDisplayTagsAllowEmpty to detect command-only prompts.
  const strippedFirstPrompt = log.firstPrompt
    ? stripDisplayTagsAllowEmpty(log.firstPrompt)
    : ''
  const useFirstPrompt = strippedFirstPrompt && !isAutonomousPrompt
  const title =
    log.agentName ||
    log.customTitle ||
    log.summary ||
    (useFirstPrompt ? strippedFirstPrompt : undefined) ||
    defaultTitle ||
    // For autonomous sessions without other context, show a meaningful label
    (isAutonomousPrompt ? 'Autonomous session' : undefined) ||
    // Fall back to truncated session ID for lite logs with no metadata
    (log.sessionId ? log.sessionId.slice(0, 8) : '') ||
    ''
  // Strip display-unfriendly tags (like <ide_opened_file>) for cleaner titles
  return stripDisplayTags(title).trim()
}
// 标题函数结束，去除显示不友好标签后返回干净标题。

export function dateToFilename(date: Date): string {
// `dateToFilename` 把日期转成文件名安全格式（冒号与点替换为短横）。
  return date.toISOString().replace(/[:.]/g, '-')
}
// 文件名转换结束。

// In-memory error log for recent errors
// Moved from bootstrap/state.ts to break import cycle
const MAX_IN_MEMORY_ERRORS = 100
// `MAX_IN_MEMORY_ERRORS` 内存错误日志上限。
let inMemoryErrorLog: Array<{ error: string; timestamp: string }> = []

function addToInMemoryErrorLog(errorInfo: {
  error: string
  timestamp: string
}): void {
  if (inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {
    inMemoryErrorLog.shift() // Remove oldest error
  }
  inMemoryErrorLog.push(errorInfo)
}
// `addToInMemoryErrorLog` 环形写入，超出上限丢弃最旧一条。

/**
 * Sink interface for the error logging backend
 */
export type ErrorLogSink = {
  logError: (error: Error) => void
  logMCPError: (serverName: string, error: unknown) => void
  logMCPDebug: (serverName: string, message: string) => void
  getErrorsPath: () => string
  getMCPLogsPath: (serverName: string) => string
}
// `ErrorLogSink` 定义错误日志后端的接口契约。

// Queued events for events logged before sink is attached
type QueuedErrorEvent =
  | { type: 'error'; error: Error }
  | { type: 'mcpError'; serverName: string; error: unknown }
  | { type: 'mcpDebug'; serverName: string; message: string }

// `QueuedErrorEvent` 描述 sink 挂载前排队的事件类型。
const errorQueue: QueuedErrorEvent[] = []

// Sink - initialized during app startup
let errorLogSink: ErrorLogSink | null = null
// `errorLogSink` 在应用启动时初始化。

/**
 * Attach the error log sink that will receive all error events.
 * Queued events are drained immediately to ensure no errors are lost.
 *
 * Idempotent: if a sink is already attached, this is a no-op. This allows
 * calling from both the preAction hook (for subcommands) and setup() (for
 * the default command) without coordination.
 */
export function attachErrorLogSink(newSink: ErrorLogSink): void {
// `attachErrorLogSink` 挂载后端并立即排空队列，确保不丢错误。
  if (errorLogSink !== null) {
    return
  }
  errorLogSink = newSink

  // Drain the queue immediately - errors should not be delayed
  if (errorQueue.length > 0) {
    const queuedEvents = [...errorQueue]
    errorQueue.length = 0

    for (const event of queuedEvents) {
      switch (event.type) {
        case 'error':
          errorLogSink.logError(event.error)
          break
        case 'mcpError':
          errorLogSink.logMCPError(event.serverName, event.error)
          break
        case 'mcpDebug':
          errorLogSink.logMCPDebug(event.serverName, event.message)
          break
      }
    }
  }
}
// 挂载函数结束，依次派发排队事件。

/**
 * Logs an error to multiple destinations for debugging and monitoring.
 *
 * This function logs errors to:
 * - Debug logs (visible via `claude --debug` or `tail -f ~/.claude/debug/latest`)
 * - In-memory error log (accessible via `getInMemoryErrors()`, useful for including
 *   in bug reports or displaying recent errors to users)
 * - Persistent error log file (only for internal 'ant' users, stored in ~/.claude/errors/)
 *
 * Usage:
 * ```ts
 * logError(new Error('Failed to connect'))
 * ```
 *
 * To view errors:
 * - Debug: Run `claude --debug` or `tail -f ~/.claude/debug/latest`
 * - In-memory: Call `getInMemoryErrors()` to get recent errors for the current session
 */
const isHardFailMode = memoize((): boolean => {
// `isHardFailMode` 记忆化判断是否带 `--hard-fail` 参数。
  return process.argv.includes('--hard-fail')
})
// 硬失败模式判断结束。

export function logError(error: unknown): void {
// `logError` 主入口：向多渠道记录错误用于调试与监控。
  const err = toError(error)
  if (feature('HARD_FAIL') && isHardFailMode()) {
    // biome-ignore lint/suspicious/noConsole:: intentional crash output
    console.error('[HARD FAIL] logError called with:', err.stack || err.message)
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
  }
// 硬失败模式下直接打印堆栈并退出进程。
  try {
    // Check if error reporting should be disabled
    if (
      // Cloud providers (Bedrock/Vertex/Foundry) always disable features
      isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
      isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
      isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
      process.env.DISABLE_ERROR_REPORTING ||
      isEssentialTrafficOnly()
    ) {
      return
// 云端提供商或关闭错误上报时跳过记录。
    }

    const errorStr = err.stack || err.message

    const errorInfo = {
      error: errorStr,
      timestamp: new Date().toISOString(),
    }

    // Always add to in-memory log (no dependencies needed)
    addToInMemoryErrorLog(errorInfo)
// 始终写入内存日志，无需任何外部依赖。

    // If sink not attached, queue the event
    if (errorLogSink === null) {
// sink 未挂载时把错误暂存到队列。
      errorQueue.push({ type: 'error', error: err })
      return
    }

    errorLogSink.logError(err)
  } catch {
// `logError` 结束，自身异常被吞掉以免雪崩。
    // pass
  }
}

export function getInMemoryErrors(): { error: string; timestamp: string }[] {
  return [...inMemoryErrorLog]
}
// `getInMemoryErrors` 返回内存中的错误列表，便于缺陷报告。

/**
 * Loads the list of error logs
 * @returns List of error logs sorted by date
 */
export function loadErrorLogs(): Promise<LogOption[]> {
  return loadLogList(CACHE_PATHS.errors())
}
// `loadErrorLogs` 读取错误日志列表。

/**
 * Gets an error log by its index
 * @param index Index in the sorted list of logs (0-based)
 * @returns Log data or null if not found
 */
export async function getErrorLogByIndex(
  index: number,
): Promise<LogOption | null> {
  const logs = await loadErrorLogs()
  return logs[index] || null
}
// `getErrorLogByIndex` 按排序后索引取单条日志。

/**
 * Internal function to load and process logs from a specified path
 * @param path Directory containing logs
 * @returns Array of logs sorted by date
 * @private
 */
async function loadLogList(path: string): Promise<LogOption[]> {
// `loadLogList` 内部函数：读取并处理指定路径下的日志文件。
  let files: Awaited<ReturnType<typeof readdir>>
  try {
    files = await readdir(path, { withFileTypes: true })
  } catch {
    logError(new Error(`No logs found at ${path}`))
    return []
  }
  const logData = await Promise.all(
    files.map(async (file, i) => {
      const fullPath = join(path, file.name)
      const content = await readFile(fullPath, { encoding: 'utf8' })
      const messages = jsonParse(content) as SerializedMessage[]
      const firstMessage = messages[0]
      const lastMessage = messages[messages.length - 1]
      const firstPrompt =
        firstMessage?.type === 'user' &&
        typeof firstMessage?.message?.content === 'string'
          ? firstMessage?.message?.content
          : 'No prompt'

      // For new random filenames, we'll get stats from the file itself
      const fileStats = await stat(fullPath)

      // Check if it's a sidechain by looking at filename
      const isSidechain = fullPath.includes('sidechain')

      // For new files, use the file modified time as date
      const date = dateToFilename(fileStats.mtime)

      return {
        date,
        fullPath,
        messages,
        value: i, // hack: overwritten after sorting, right below this
        created: parseISOString(firstMessage?.timestamp || date),
        modified: lastMessage?.timestamp
          ? parseISOString(lastMessage.timestamp)
          : parseISOString(date),
        firstPrompt:
          firstPrompt.split('\n')[0]?.slice(0, 50) +
            (firstPrompt.length > 50 ? '…' : '') || 'No prompt',
        messageCount: messages.length,
        isSidechain,
      }
    }),
  )

  return sortLogs(logData.filter(_ => _ !== null)).map((_, i) => ({
    ..._,
    value: i,
  }))
}
// 列表加载结束，按日期排序并补齐排序下标。

function parseISOString(s: string): Date {
  const b = s.split(/\D+/)
  return new Date(
    Date.UTC(
      parseInt(b[0]!, 10),
      parseInt(b[1]!, 10) - 1,
      parseInt(b[2]!, 10),
      parseInt(b[3]!, 10),
      parseInt(b[4]!, 10),
      parseInt(b[5]!, 10),
      parseInt(b[6]!, 10),
    ),
  )
}
// `parseISOString` 把 ISO 字符串解析为日期对象。

export function logMCPError(serverName: string, error: unknown): void {
  try {
    // If sink not attached, queue the event
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpError', serverName, error })
      return
    }

    errorLogSink.logMCPError(serverName, error)
  } catch {
    // Silently fail
  }
}
// `logMCPError` 记录 MCP 服务器错误，未挂载则排队。

export function logMCPDebug(serverName: string, message: string): void {
  try {
    // If sink not attached, queue the event
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpDebug', serverName, message })
      return
    }

    errorLogSink.logMCPDebug(serverName, message)
  } catch {
    // Silently fail
  }
}
// `logMCPDebug` 记录 MCP 调试信息，未挂载则排队。

/**
 * Captures the last API request for inclusion in bug reports.
 */
export function captureAPIRequest(
  params: BetaMessageStreamParams,
  querySource?: QuerySource,
): void {
  // startsWith, not exact match — users with non-default output styles get
  // variants like 'repl_main_thread:outputStyle:Explanatory' (querySource.ts).
  if (!querySource || !querySource.startsWith('repl_main_thread')) {
    return
  }

  // Store params WITHOUT messages to avoid retaining the entire conversation
  // for all users. Messages are already persisted to the transcript file and
  // available via React state.
// 仅 ant 用户保留最近一次消息引用，用于分享会话序列化。
  const { messages, ...paramsWithoutMessages } = params
  setLastAPIRequest(paramsWithoutMessages)
  // For ant users only: also keep a reference to the final messages array so
  // /share's serialized_conversation.json captures the exact post-compaction,
  // CLAUDE.md-injected payload the API received. Overwritten each turn;
  // dumpPrompts.ts already holds 5 full request bodies for ants, so this is
  // not a new retention class.
  setLastAPIRequestMessages(process.env.USER_TYPE === 'ant' ? messages : null)
}
// `captureAPIRequest` 抓取最近一次 API 请求参数用于缺陷报告。

/**
 * Reset error log state for testing purposes only.
 * @internal
 */
export function _resetErrorLogForTesting(): void {
  errorLogSink = null
  errorQueue.length = 0
  inMemoryErrorLog = []
}
// `_resetErrorLogForTesting` 仅供测试重置错误日志状态。
