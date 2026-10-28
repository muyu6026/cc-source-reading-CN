import { APIUserAbortError } from '@anthropic-ai/sdk'

// 普通错误基类，构造时把 name 设为类名便于识别
export class ClaudeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class MalformedCommandError extends Error {}

// 中止错误，固定 name 为 AbortError 以便跨构建识别
export class AbortError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * True iff `e` is any of the abort-shaped errors the codebase encounters:
 * our AbortError class, a DOMException from AbortController.abort()
 * (.name === 'AbortError'), or the SDK's APIUserAbortError. The SDK class
 * is checked via instanceof because minified builds mangle class names —
 * constructor.name becomes something like 'nJT' and the SDK never sets
 * this.name, so string matching silently fails in production.
 */
// 统一判定任意中止型错误：自研类、DOMException、或 SDK 的 APIUserAbortError（用 instanceof 而非名字，避免压缩后类名被混淆）
export function isAbortError(e: unknown): boolean {
  return (
    e instanceof AbortError ||
    e instanceof APIUserAbortError ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

/**
 * Custom error class for configuration file parsing errors
 * Includes the file path and the default configuration that should be used
 */
// 配置解析错误，额外携带出错路径与应使用的默认配置
export class ConfigParseError extends Error {
  filePath: string
  defaultConfig: unknown

  constructor(message: string, filePath: string, defaultConfig: unknown) {
    super(message)
    this.name = 'ConfigParseError'
    this.filePath = filePath
    this.defaultConfig = defaultConfig
  }
}

export class ShellError extends Error {
  constructor(
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly code: number,
    public readonly interrupted: boolean,
  ) {
    super('Shell command failed')
    this.name = 'ShellError'
  }
}

export class TeleportOperationError extends Error {
  constructor(
    message: string,
    public readonly formattedMessage: string,
  ) {
    super(message)
    this.name = 'TeleportOperationError'
  }
}

/**
 * Error with a message that is safe to log to telemetry.
 * Use the long name to confirm you've verified the message contains no
 * sensitive data (file paths, URLs, code snippets).
 *
 * Single-arg: same message for user and telemetry
 * Two-arg: different messages (e.g., full message has file path, telemetry doesn't)
 *
 * @example
 * // Same message for both
 * throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
 *   'MCP server "slack" connection timed out'
 * )
 *
 * // Different messages
 * throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
 *   `MCP tool timed out after ${ms}ms`,  // Full message for logs/user
 *   'MCP tool timed out'                  // Telemetry message
 * )
 */
// 用极长的类名刻意提醒：调用前必须确认消息里没有路径或代码这类敏感数据；单参时日志与遥测同消息，双参分开
export class TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends Error {
  readonly telemetryMessage: string

  constructor(message: string, telemetryMessage?: string) {
    super(message)
    this.name = 'TelemetrySafeError'
    this.telemetryMessage = telemetryMessage ?? message
  }
}

export function hasExactErrorMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message
}

/**
 * Normalize an unknown value into an Error.
 * Use at catch-site boundaries when you need an Error instance.
 */
// 把任意值规整成 Error 实例，用于 catch 边界
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

/**
 * Extract a string message from an unknown error-like value.
 * Use when you only need the message (e.g., for logging or display).
 */
// 从未知错误值里取出字符串消息，用于日志或展示
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Extract the errno code (e.g., 'ENOENT', 'EACCES') from a caught error.
 * Returns undefined if the error has no code or is not an ErrnoException.
 * Replaces the `(e as NodeJS.ErrnoException).code` cast pattern.
 */
// 取出错误的 errno 码（如 ENOENT/EACCES），取代直接强转的写法
export function getErrnoCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') {
    return e.code
  }
  return undefined
}

/**
 * True if the error is ENOENT (file or directory does not exist).
 * Replaces `(e as NodeJS.ErrnoException).code === 'ENOENT'`.
 */
export function isENOENT(e: unknown): boolean {
  return getErrnoCode(e) === 'ENOENT'
}

/**
 * Extract the errno path (the filesystem path that triggered the error)
 * from a caught error. Returns undefined if the error has no path.
 * Replaces the `(e as NodeJS.ErrnoException).path` cast pattern.
 */
export function getErrnoPath(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'path' in e && typeof e.path === 'string') {
    return e.path
  }
  return undefined
}

/**
 * Extract error message + top N stack frames from an unknown error.
 * Use when the error flows to the model as a tool_result — full stack
 * traces are ~500-2000 chars of mostly-irrelevant internal frames and
 * waste context tokens. Keep the full stack in debug logs instead.
 */
// 截取错误前 N 个堆栈帧，喂给模型时省 token，完整堆栈留给调试日志
export function shortErrorStack(e: unknown, maxFrames = 5): string {
  if (!(e instanceof Error)) return String(e)
  if (!e.stack) return e.message
  // V8/Bun stack format: "Name: message\n    at frame1\n    at frame2..."
  // First line is the message; subsequent "    at " lines are frames.
  const lines = e.stack.split('\n')
  const header = lines[0] ?? e.message
  const frames = lines.slice(1).filter(l => l.trim().startsWith('at '))
  if (frames.length <= maxFrames) return e.stack
  return [header, ...frames.slice(0, maxFrames)].join('\n')
}

/**
 * True if the error means the path is missing, inaccessible, or
 * structurally unreachable — use in catch blocks after fs operations to
 * distinguish expected "nothing there / no access" from unexpected errors.
 *
 * Covers:
 *  ENOENT    — path does not exist
 *  EACCES    — permission denied
 *  EPERM     — operation not permitted
 *  ENOTDIR   — a path component is not a directory (e.g. a file named
 *              `.claude` exists where a directory is expected)
 *  ELOOP     — too many symlink levels (circular symlinks)
 */
// 判断路径是否「缺失/无权限/结构不可达」，用于 fs 操作后的 catch 区分预期与意外
export function isFsInaccessible(e: unknown): e is NodeJS.ErrnoException {
  const code = getErrnoCode(e)
  return (
    code === 'ENOENT' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ENOTDIR' ||
    code === 'ELOOP'
  )
}

// 把 axios 错误归类的枚举：auth/timeout/network/http/other
export type AxiosErrorKind =
  | 'auth' // 401/403 — caller typically sets skipRetry
  | 'timeout' // ECONNABORTED
  | 'network' // ECONNREFUSED/ENOTFOUND
  | 'http' // other axios error (may have status)
  | 'other' // not an axios error

/**
 * Classify a caught error from an axios request into one of a few buckets.
 * Replaces the ~20-line isAxiosError → 401/403 → ECONNABORTED → ECONNREFUSED
 * chain duplicated across sync-style services (settingsSync, policyLimits,
 * remoteManagedSettings, teamMemorySync).
 *
 * Checks the `.isAxiosError` marker property directly (same as
 * axios.isAxiosError()) to keep this module dependency-free.
 */
// 把一次 axios 请求捕获的错误分桶（401/403→auth、ECONNABORTED→timeout 等），取代各处重复的判错链
export function classifyAxiosError(e: unknown): {
  kind: AxiosErrorKind
  status?: number
  message: string
} {
  const message = errorMessage(e)
  if (
    !e ||
    typeof e !== 'object' ||
    !('isAxiosError' in e) ||
    !e.isAxiosError
  ) {
    return { kind: 'other', message }
  }
  const err = e as {
    response?: { status?: number }
    code?: string
  }
  const status = err.response?.status
  if (status === 401 || status === 403) return { kind: 'auth', status, message }
  if (err.code === 'ECONNABORTED') return { kind: 'timeout', status, message }
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    return { kind: 'network', status, message }
  }
  return { kind: 'http', status, message }
}
