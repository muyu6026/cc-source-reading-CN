// 模块总览：慢操作日志与带性能埋点的封装。
// 对 JSON 序列化、结构化克隆、深拷贝、同步写文件等开销操作做计时，超过阈值才记录并上报，
// 内部构建用低阈值、蚂蚁内部用户用中阈值，外部构建则零开销；同时用重入守卫避免日志自身再触发日志。
import { feature } from 'bun:bundle'
import type { WriteFileOptions } from 'fs'
import {
  closeSync,
  writeFileSync as fsWriteFileSync,
  fsyncSync,
  openSync,
} from 'fs'
// biome-ignore lint: This file IS the cloneDeep wrapper - it must import the original
import lodashCloneDeep from 'lodash-es/cloneDeep.js'
import { addSlowOperation } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'

// Extended WriteFileOptions to include 'flush' which is available in Node.js 20.1.0+
// but not yet in @types/node
type WriteFileOptionsWithFlush =
  | WriteFileOptions
  | (WriteFileOptions & { flush?: boolean })

// --- Slow operation logging infrastructure ---

/**
 * Threshold in milliseconds for logging slow JSON/clone operations.
 * Operations taking longer than this will be logged for debugging.
 * - Override: set CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS to a number
 * - Dev builds: 20ms (lower threshold for development)
 * - Ants: 300ms (enabled for all internal users)
 */
const SLOW_OPERATION_THRESHOLD_MS = (() => {
  const envValue = process.env.CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS
  if (envValue !== undefined) {
    const parsed = Number(envValue)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed
    }
  }
  if (process.env.NODE_ENV === 'development') {
    return 20
  }
  if (process.env.USER_TYPE === 'ant') {
    return 300
  }
  return Infinity
})()
// 慢操作阈值：环境变量可覆盖，开发构建二十毫秒、蚂蚁用户三百毫秒，其余默认正无穷即不记录。

// Re-export for callers that still need the threshold value directly
export { SLOW_OPERATION_THRESHOLD_MS }

// Module-level re-entrancy guard. logForDebugging writes to a debug file via
// appendFileSync, which goes through slowLogging again. Without this guard,
// a slow appendFileSync → dispose → logForDebugging → appendFileSync → dispose → ...
let isLogging = false

/**
 * Extract the first stack frame outside this file, so the DevBar warning
 * points at the actual caller instead of a useless `Object{N keys}`.
 * Only called when an operation was actually slow — never on the fast path.
 */
export function callerFrame(stack: string | undefined): string {
  if (!stack) return ''
  for (const line of stack.split('\n')) {
    if (line.includes('slowOperations')) continue
    const m = line.match(/([^/\\]+?):(\d+):\d+\)?$/)
    if (m) return ` @ ${m[1]}:${m[2]}`
  }
  return ''
}
// 从调用栈里取出本文件之外的第一帧，让 DevBar 警告指向真正的调用方而非无用的对象描述。

/**
 * Builds a human-readable description from tagged template arguments.
 * Only called when an operation was actually slow — never on the fast path.
 *
 * args[0] = TemplateStringsArray, args[1..n] = interpolated values
 */
function buildDescription(args: IArguments): string {
  const strings = args[0] as TemplateStringsArray
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i + 1 < args.length) {
      const v = args[i + 1]
      if (Array.isArray(v)) {
        result += `Array[${(v as unknown[]).length}]`
      } else if (v !== null && typeof v === 'object') {
        result += `Object{${Object.keys(v as Record<string, unknown>).length} keys}`
      } else if (typeof v === 'string') {
        result += v.length > 80 ? `${v.slice(0, 80)}…` : v
      } else {
        result += String(v)
      }
    }
  }
  return result
}
// 把模板字符串参数拍平成可读描述，数组记长度、对象记键数、长字符串截断，只在确实慢时才调用。

class AntSlowLogger {
  startTime: number
  args: IArguments
  err: Error

  constructor(args: IArguments) {
    this.startTime = performance.now()
    this.args = args
    // V8/JSC capture the stack at construction but defer the expensive string
    // formatting until .stack is read — so this stays off the fast path.
    this.err = new Error()
  }

  [Symbol.dispose](): void {
    const duration = performance.now() - this.startTime
    if (duration > SLOW_OPERATION_THRESHOLD_MS && !isLogging) {
      isLogging = true
      try {
        const description =
          buildDescription(this.args) + callerFrame(this.err.stack)
        logForDebugging(
          `[SLOW OPERATION DETECTED] ${description} (${duration.toFixed(1)}ms)`,
        )
        addSlowOperation(description, duration)
      } finally {
        isLogging = false
      }
    }
  }
}
// 慢日志器：构造时记录开始时间，释放时（using 语法）若超过阈值且未在记录中则上报描述与耗时。

const NOOP_LOGGER: Disposable = { [Symbol.dispose]() {} }

// Must be regular functions (not arrows) to access `arguments`
function slowLoggingAnt(
  _strings: TemplateStringsArray,
  ..._values: unknown[]
): AntSlowLogger {
  // eslint-disable-next-line prefer-rest-params
  return new AntSlowLogger(arguments)
}

function slowLoggingExternal(): Disposable {
  return NOOP_LOGGER
}

/**
 * Tagged template for slow operation logging.
 *
 * In ANT builds: creates an AntSlowLogger that times the operation and logs
 * if it exceeds the threshold. Description is built lazily only when slow.
 *
 * In external builds: returns a singleton no-op disposable. Zero allocations,
 * zero timing. AntSlowLogger and buildDescription are dead-code-eliminated.
 *
 * @example
 * using _ = slowLogging`structuredClone(${value})`
 * const result = structuredClone(value)
 */
export const slowLogging: {
  (strings: TemplateStringsArray, ...values: unknown[]): Disposable
} = feature('SLOW_OPERATION_LOGGING') ? slowLoggingAnt : slowLoggingExternal
// 慢日志标签：蚂蚁构建下返回会计时的日志器，外部构建下返回零分配的空操作，保持热路径零成本。

// --- Wrapped operations ---

/**
 * Wrapped JSON.stringify with slow operation logging.
 * Use this instead of JSON.stringify directly to detect performance issues.
 *
 * @example
 * import { jsonStringify } from './slowOperations.js'
 * const json = jsonStringify(data)
 * const prettyJson = jsonStringify(data, null, 2)
 */
export function jsonStringify(
  value: unknown,
  replacer?: (this: unknown, key: string, value: unknown) => unknown,
  space?: string | number,
): string
export function jsonStringify(
  value: unknown,
  replacer?: (number | string)[] | null,
  space?: string | number,
): string
export function jsonStringify(
  value: unknown,
  replacer?:
    | ((this: unknown, key: string, value: unknown) => unknown)
    | (number | string)[]
    | null,
  space?: string | number,
): string {
  using _ = slowLogging`JSON.stringify(${value})`
  return JSON.stringify(
    value,
    replacer as Parameters<typeof JSON.stringify>[1],
    space,
  )
}
// 带埋点的 JSON.stringify：用 using 包裹计时，并显式分支以保留无 reviver 的快速路径。

/**
 * Wrapped JSON.parse with slow operation logging.
 * Use this instead of JSON.parse directly to detect performance issues.
 *
 * @example
 * import { jsonParse } from './slowOperations.js'
 * const data = jsonParse(jsonString)
 */
export const jsonParse: typeof JSON.parse = (text, reviver) => {
  using _ = slowLogging`JSON.parse(${text})`
  // V8 de-opts JSON.parse when a second argument is passed, even if undefined.
  // Branch explicitly so the common (no-reviver) path stays on the fast path.
  return typeof reviver === 'undefined'
    ? JSON.parse(text)
    : JSON.parse(text, reviver)
}
// 带埋点的 JSON.parse：V8 在传入第二个参数时会去优化，所以显式判断 reviver 是否存在以保住快速路径。

/**
 * Wrapped structuredClone with slow operation logging.
 * Use this instead of structuredClone directly to detect performance issues.
 *
 * @example
 * import { clone } from './slowOperations.js'
 * const copy = clone(originalObject)
 */
export function clone<T>(value: T, options?: StructuredSerializeOptions): T {
  using _ = slowLogging`structuredClone(${value})`
  return structuredClone(value, options)
}
// 带埋点的结构化克隆封装，直接转发给原生 structuredClone。

/**
 * Wrapped cloneDeep with slow operation logging.
 * Use this instead of lodash cloneDeep directly to detect performance issues.
 *
 * @example
 * import { cloneDeep } from './slowOperations.js'
 * const copy = cloneDeep(originalObject)
 */
export function cloneDeep<T>(value: T): T {
  using _ = slowLogging`cloneDeep(${value})`
  return lodashCloneDeep(value)
}
// 带埋点的 lodash 深拷贝封装，用于需要深拷贝语义的场景。

/**
 * Wrapper around fs.writeFileSync with slow operation logging.
 * Supports flush option to ensure data is written to disk before returning.
 * @param filePath The path to the file to write to
 * @param data The data to write (string or Buffer)
 * @param options Optional write options (encoding, mode, flag, flush)
 * @deprecated Use `fs.promises.writeFile` instead for non-blocking writes.
 * Sync file writes block the event loop and cause performance issues.
 */
export function writeFileSync_DEPRECATED(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptionsWithFlush,
): void {
  using _ = slowLogging`fs.writeFileSync(${filePath}, ${data})`

  // Check if flush is requested (for object-style options)
  const needsFlush =
    options !== null &&
    typeof options === 'object' &&
    'flush' in options &&
    options.flush === true

  if (needsFlush) {
    // Manual flush: open file, write, fsync, close
    const encoding =
      typeof options === 'object' && 'encoding' in options
        ? options.encoding
        : undefined
    const mode =
      typeof options === 'object' && 'mode' in options
        ? options.mode
        : undefined
    let fd: number | undefined
    try {
      fd = openSync(filePath, 'w', mode)
      fsWriteFileSync(fd, data, { encoding: encoding ?? undefined })
      fsyncSync(fd)
    } finally {
      if (fd !== undefined) {
        closeSync(fd)
      }
    }
  } else {
    // No flush needed, use standard writeFileSync
    fsWriteFileSync(filePath, data, options as WriteFileOptions)
  }
}
// 带埋点的同步写文件（已废弃）：支持 flush 选项做打开-写入-fsync-关闭的强制落盘，
// 非 flush 时退回标准写；同步写会阻塞事件循环，建议改用异步写。
