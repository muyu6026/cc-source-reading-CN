import { type Options as ExecaOptions, execaSync } from 'execa'
// 同步执行外壳：把 execaSync 包成「永不抛错」的 execSync 替身，全函数已标废弃——同步调用阻塞事件循环，新代码应直接用异步 execa。
import { getCwd } from '../utils/cwd.js'
import { slowLogging } from './slowOperations.js'

const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60

type ExecSyncOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  input?: string
  stdio?: ExecaOptions['stdio']
}
// 选项类型收敛成四个：中止信号、超时、标准输入内容、stdio 配置。比原生 execSync 的选项面窄得多，是刻意收口。

/**
 * @deprecated Use `execa` directly with `{ shell: true, reject: false }` for non-blocking execution.
 * Sync exec calls block the event loop and cause performance issues.
 */
export function execSyncWithDefaults_DEPRECATED(command: string): string | null
// 三个重载全是历史兼容：早期调用方有的传 AbortSignal、有的传选项对象、有的什么都不传，重载把三种签名都接住再在实现里归一。
/**
 * @deprecated Use `execa` directly with `{ shell: true, reject: false }` for non-blocking execution.
 * Sync exec calls block the event loop and cause performance issues.
 */
export function execSyncWithDefaults_DEPRECATED(
  command: string,
  options: ExecSyncOptions,
): string | null
/**
 * @deprecated Use `execa` directly with `{ shell: true, reject: false }` for non-blocking execution.
 * Sync exec calls block the event loop and cause performance issues.
 */
export function execSyncWithDefaults_DEPRECATED(
  command: string,
  abortSignal: AbortSignal,
  timeout?: number,
): string | null
/**
 * @deprecated Use `execa` directly with `{ shell: true, reject: false }` for non-blocking execution.
 * Sync exec calls block the event loop and cause performance issues.
 */
export function execSyncWithDefaults_DEPRECATED(
  command: string,
  optionsOrAbortSignal?: ExecSyncOptions | AbortSignal,
  timeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
): string | null {
// 默认超时 10 分钟：与旧实现保持一致，调用方没显式给就不变。
  let options: ExecSyncOptions

  if (optionsOrAbortSignal === undefined) {
    // No second argument - use defaults
    options = {}
  } else if (optionsOrAbortSignal instanceof AbortSignal) {
    // Old signature - second argument is AbortSignal
    options = {
      abortSignal: optionsOrAbortSignal,
      timeout,
    }
  } else {
    // New signature - second argument is options object
    options = optionsOrAbortSignal
  }
// 参数归一完成：AbortSignal 旧签名映射成选项对象，其余透传。三种调用方式从此走同一条路。

  const {
    abortSignal,
    timeout: finalTimeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    input,
    stdio = ['ignore', 'pipe', 'pipe'],
  } = options
// stdio 默认「忽略输入、管道输出」：stderr 也接管，错误不再打到终端而是被吞进返回值 null。

  abortSignal?.throwIfAborted()
  using _ = slowLogging`exec: ${command.slice(0, 200)}`
// throwIfAborted 先行检查：已经取消的任务不该再起子进程。using 语句是显式资源管理语法，作用域结束自动落慢调用日志。
  try {
    const result = execaSync(command, {
      env: process.env,
      maxBuffer: 1_000_000,
      timeout: finalTimeout,
      cwd: getCwd(),
      stdio,
      shell: true, // execSync typically runs shell commands
      reject: false, // Don't throw on non-zero exit codes
      input,
    })
// execaSync 的关键配置：shell 为 true 对齐 execSync 语义，reject 为 false 让非零退出码不抛错，maxBuffer 1MB 与旧实现一致。
    if (!result.stdout) {
      return null
    }
    return result.stdout.trim() || null
// 空输出归 null 而不是空串：调用方统一按「有没有结果」判断，不用区分空串与失败两种假值。
  } catch {
    return null
  }
}
// catch 全吞是这层的存在意义：调用方拿到 null 即失败，错误细节留给 slowLogging 的日志通道，不污染业务代码。
