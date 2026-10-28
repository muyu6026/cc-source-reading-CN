/**
 * Error log sink implementation
 *
 * This module contains the heavy implementation for error logging and should be
 * initialized during app startup. It handles file-based error logging to disk.
 *
 * Usage: Call initializeErrorLogSink() during app startup to attach the sink.
 *
 * DESIGN: This module is separate from log.ts to avoid import cycles.
 * log.ts has NO heavy dependencies - events are queued until this sink is attached.
 */

import axios from 'axios'
import { dirname, join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { createBufferedWriter } from './bufferedWriter.js'
import { CACHE_PATHS } from './cachePaths.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getFsImplementation } from './fsOperations.js'
import { attachErrorLogSink, dateToFilename } from './log.js'
import { jsonStringify } from './slowOperations.js'

const DATE = dateToFilename(new Date())
// 按启动日期生成日志文件名用的日期串，模块加载时定一次

/**
 * Gets the path to the errors log file.
 */
// 错误日志路径：缓存放 errors/<日期>.jsonl
export function getErrorsPath(): string {
  return join(CACHE_PATHS.errors(), DATE + '.jsonl')
}

/**
 * Gets the path to MCP logs for a server.
 */
// 某 MCP 服务器的日志路径：缓存/MCP 日志/<名称>/<日期>.jsonl
export function getMCPLogsPath(serverName: string): string {
  return join(CACHE_PATHS.mcpLogs(serverName), DATE + '.jsonl')
}

type JsonlWriter = {
  write: (obj: object) => void
  flush: () => void
  dispose: () => void
}

// 基于缓冲写入器封装出「写对象即转 JSONL」的写入器
function createJsonlWriter(options: {
  writeFn: (content: string) => void
  flushIntervalMs?: number
  maxBufferSize?: number
}): JsonlWriter {
  const writer = createBufferedWriter(options)
  return {
    write(obj: object): void {
      writer.write(jsonStringify(obj) + '\n')
    },
    flush: writer.flush,
    dispose: writer.dispose,
  }
}

// Buffered writers for JSONL log files, keyed by path
const logWriters = new Map<string, JsonlWriter>()
// 按路径缓存的缓冲写入器，避免重复建连

/**
 * Flush all buffered log writers. Used for testing.
 * @internal
 */
export function _flushLogWritersForTesting(): void {
  for (const writer of logWriters.values()) {
    writer.flush()
  }
}

/**
 * Clear all buffered log writers. Used for testing.
 * @internal
 */
export function _clearLogWritersForTesting(): void {
  for (const writer of logWriters.values()) {
    writer.dispose()
  }
  logWriters.clear()
}

// 取（或懒建）某路径的 JSONL 写入器，首次建时登记退出清理
function getLogWriter(path: string): JsonlWriter {
  let writer = logWriters.get(path)
  if (!writer) {
    const dir = dirname(path)
    writer = createJsonlWriter({
      // sync IO: called from sync context
      writeFn: (content: string) => {
        try {
          // Happy-path: directory already exists
          getFsImplementation().appendFileSync(path, content)
        } catch {
          // If any error occurs, assume it was due to missing directory
          getFsImplementation().mkdirSync(dir)
          // Retry appending
          getFsImplementation().appendFileSync(path, content)
        }
      },
      flushIntervalMs: 1000,
      maxBufferSize: 50,
    })
    logWriters.set(path, writer)
    registerCleanup(async () => writer?.dispose())
  }
  return writer
}

// 仅 ant 类型记录：给消息补上时间戳、cwd、用户类型、会话 ID 与版本后写入
function appendToLog(path: string, message: object): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  const messageWithTimestamp = {
    timestamp: new Date().toISOString(),
    ...message,
    cwd: getFsImplementation().cwd(),
    userType: process.env.USER_TYPE,
    sessionId: getSessionId(),
    version: MACRO.VERSION,
  }

  getLogWriter(path).write(messageWithTimestamp)
}

// 从 MCP 错误响应里尽量取出可读的服务端消息
function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj.message === 'string') {
      return obj.message
    }
    if (
      typeof obj.error === 'object' &&
      obj.error &&
      'message' in obj.error &&
      typeof (obj.error as Record<string, unknown>).message === 'string'
    ) {
      return (obj.error as Record<string, unknown>).message as string
    }
  }
  return undefined
}

/**
 * Implementation for logError - writes error to debug log and file.
 */
// logError 的实现：把错误连同 axios 请求的 URL/状态码/服务端消息一并写入调试日志与文件
function logErrorImpl(error: Error): void {
  const errorStr = error.stack || error.message

  // Enrich axios errors with request URL, status, and server message for debugging
  let context = ''
  if (axios.isAxiosError(error) && error.config?.url) {
    const parts = [`url=${error.config.url}`]
    if (error.response?.status !== undefined) {
      parts.push(`status=${error.response.status}`)
    }
    const serverMessage = extractServerMessage(error.response?.data)
    if (serverMessage) {
      parts.push(`body=${serverMessage}`)
    }
    context = `[${parts.join(',')}] `
  }

  logForDebugging(`${error.name}: ${context}${errorStr}`, { level: 'error' })

  appendToLog(getErrorsPath(), {
    error: `${context}${errorStr}`,
  })
}

/**
 * Implementation for logMCPError - writes MCP error to debug log and file.
 */
// logMCPError 的实现：写 MCP 错误到调试日志与对应服务器日志文件
function logMCPErrorImpl(serverName: string, error: unknown): void {
  // Not themed, to avoid having to pipe theme all the way down
  logForDebugging(`MCP server "${serverName}" ${error}`, { level: 'error' })

  const logFile = getMCPLogsPath(serverName)
  const errorStr =
    error instanceof Error ? error.stack || error.message : String(error)

  const errorInfo = {
    error: errorStr,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    cwd: getFsImplementation().cwd(),
  }

  getLogWriter(logFile).write(errorInfo)
}

/**
 * Implementation for logMCPDebug - writes MCP debug message to log file.
 */
// logMCPDebug 的实现：写 MCP 调试消息到对应服务器日志文件
function logMCPDebugImpl(serverName: string, message: string): void {
  logForDebugging(`MCP server "${serverName}": ${message}`)

  const logFile = getMCPLogsPath(serverName)

  const debugInfo = {
    debug: message,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    cwd: getFsImplementation().cwd(),
  }

  getLogWriter(logFile).write(debugInfo)
}

/**
 * Initialize the error log sink.
 *
 * Call this during app startup to attach the error logging backend.
 * Any errors logged before this is called will be queued and drained.
 *
 * Should be called BEFORE initializeAnalyticsSink() in the startup sequence.
 *
 * Idempotent: safe to call multiple times (subsequent calls are no-ops).
 */
// 启动期挂载错误日志后端：注册三类实现与两个路径函数；须在分析后端之前调用；可重复调用（幂等）
export function initializeErrorLogSink(): void {
  attachErrorLogSink({
    logError: logErrorImpl,
    logMCPError: logMCPErrorImpl,
    logMCPDebug: logMCPDebugImpl,
    getErrorsPath,
    getMCPLogsPath,
  })

  logForDebugging('Error log sink initialized')
}
