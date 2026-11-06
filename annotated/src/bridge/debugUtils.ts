import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { jsonStringify } from '../utils/slowOperations.js'

// 两千字符是调试日志的实际上限：再长就不是给人看的，只是给日志系统塞垃圾
const DEBUG_MSG_LIMIT = 2000

// 五个字段名覆盖桥接协议里所有会带密钥的位置：按字段名匹配比扫「长得像令牌的串」可靠得多
const SECRET_FIELD_NAMES = [
  'session_ingress_token',
  'environment_secret',
  'access_token',
  'secret',
  'token',
]

const SECRET_PATTERN = new RegExp(
  `"(${SECRET_FIELD_NAMES.join('|')})"\\s*:\\s*"([^"]*)"`,
  'g',
)

// 短于十六个字符的值整体打码：太短的值露头露尾等于全露
const REDACT_MIN_LENGTH = 16

// 只留头八位与尾四位：够在日志里对上是哪一把钥匙，又不足以还原
export function redactSecrets(s: string): string {
  return s.replace(SECRET_PATTERN, (_match, field: string, value: string) => {
    if (value.length < REDACT_MIN_LENGTH) {
      return `"${field}":"[REDACTED]"`
    }
    const redacted = `${value.slice(0, 8)}...${value.slice(-4)}`
    return `"${field}":"${redacted}"`
  })
}

/** Truncate a string for debug logging, collapsing newlines. */
// 换行压成字面两字符：调试日志一行一条，多行会把后面的上下文挤散，也不会被日志系统正确分行
export function debugTruncate(s: string): string {
  const flat = s.replace(/\n/g, '\\n')
  if (flat.length <= DEBUG_MSG_LIMIT) {
    return flat
  }
// 截断时把原长度附在末尾：看到被截断要能判断是「略长」还是「差了十倍」
  return flat.slice(0, DEBUG_MSG_LIMIT) + `... (${flat.length} chars)`
}

/** Truncate a JSON-serializable value for debug logging. */
// 入参可能是对象也可能是字符串：先序列化再打码，两条路径才能共用同一套脱敏
export function debugBody(data: unknown): string {
  const raw = typeof data === 'string' ? data : jsonStringify(data)
  const s = redactSecrets(raw)
  if (s.length <= DEBUG_MSG_LIMIT) {
    return s
  }
  return s.slice(0, DEBUG_MSG_LIMIT) + `... (${s.length} chars)`
}

/**
 * Extract a descriptive error message from an axios error (or any error).
 * For HTTP errors, appends the server's response body message if available,
 * since axios's default message only includes the status code.
 */
// axios 的默认消息只有状态码，服务端真正的原因在响应体里，所以要把 body 里的说明摘出来
export function describeAxiosError(err: unknown): string {
  const msg = errorMessage(err)
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: unknown } }).response
    if (response?.data && typeof response.data === 'object') {
      const data = response.data as Record<string, unknown>
// 两种响应体形状都出现过：顶层 message，以及包了一层 error 再带 message
      const detail =
        typeof data.message === 'string'
          ? data.message
          : typeof data.error === 'object' &&
              data.error &&
              'message' in data.error &&
              typeof (data.error as Record<string, unknown>).message ===
                'string'
            ? (data.error as Record<string, unknown>).message
            : undefined
      if (detail) {
        return `${msg}: ${detail}`
      }
    }
  }
  return msg
}

/**
 * Extract the HTTP status code from an axios error, if present.
 * Returns undefined for non-HTTP errors (e.g. network failures).
 */
// 状态码单独摘出来：调用方要按 401、409、429 分流，不该在这里被压成字符串再解析回去
export function extractHttpStatus(err: unknown): number | undefined {
  if (
    err &&
    typeof err === 'object' &&
    'response' in err &&
    (err as { response?: { status?: unknown } }).response &&
    typeof (err as { response: { status?: unknown } }).response.status ===
      'number'
  ) {
    return (err as { response: { status: number } }).response.status
  }
  return undefined
}

/**
 * Pull a human-readable message out of an API error response body.
 * Checks `data.message` first, then `data.error.message`.
 */
// 这个函数与上面的 describeAxiosError 重复了一半判断，是刻意保留的：那个负责拼字符串，这个要拿原始值
export function extractErrorDetail(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  if ('message' in data && typeof data.message === 'string') {
    return data.message
  }
  if (
    'error' in data &&
    data.error !== null &&
    typeof data.error === 'object' &&
    'message' in data.error &&
    typeof data.error.message === 'string'
  ) {
    return data.error.message
  }
  return undefined
}

/**
 * Log a bridge init skip — debug message + `tengu_bridge_repl_skipped`
 * analytics event. Centralizes the event name and the AnalyticsMetadata
 * cast so call sites don't each repeat the 5-line boilerplate.
 */
// 事件名与元数据断言收到一处：桥接十来个跳过分支各写一遍五行样板，改一处必然漏几处
export function logBridgeSkip(
  reason: string,
  debugMsg?: string,
  v2?: boolean,
): void {
  if (debugMsg) {
    logForDebugging(debugMsg)
  }
// reason 做了类型断言：分析事件只接受已核验过、不含代码与文件路径的字符串
  logEvent('tengu_bridge_repl_skipped', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
// 可选字段只有传了才写进事件：无条件带上会污染旧版统计的维度
    ...(v2 !== undefined && { v2 }),
  })
}
