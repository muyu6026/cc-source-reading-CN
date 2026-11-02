// 本文件包裹 Node 的 child_process.execSync，加入慢操作日志埋点。同步 exec 会阻塞事件循环，已标记为 deprecated，建议优先使用异步替代方案。
import {
  type ExecSyncOptions,
  type ExecSyncOptionsWithBufferEncoding,
  type ExecSyncOptionsWithStringEncoding,
  execSync as nodeExecSync,
} from 'child_process'
import { slowLogging } from './slowOperations.js'

/**
 * @deprecated Use async alternatives when possible. Sync exec calls block the event loop.
 *
 * Wrapped execSync with slow operation logging.
 * Use this instead of child_process execSync directly to detect performance issues.
 *
 * @example
 * import { execSync_DEPRECATED } from './execSyncWrapper.js'
 * const result = execSync_DEPRECATED('git status', { encoding: 'utf8' })
 */
// execSync_DEPRECATED：带多重重载签名的同步执行封装。重载区分返回 Buffer 还是 string，便于调用方按需声明编码。
export function execSync_DEPRECATED(command: string): Buffer
export function execSync_DEPRECATED(
  command: string,
  options: ExecSyncOptionsWithStringEncoding,
): string
export function execSync_DEPRECATED(
  command: string,
  options: ExecSyncOptionsWithBufferEncoding,
): Buffer
export function execSync_DEPRECATED(
  command: string,
  options?: ExecSyncOptions,
): Buffer | string
export function execSync_DEPRECATED(
  command: string,
  options?: ExecSyncOptions,
): Buffer | string {
  using _ = slowLogging`execSync: ${command.slice(0, 100)}`
  return nodeExecSync(command, options)
}
// 实现体用 `slowLogging` 模板标签记录慢操作，再转发给底层的 nodeExecSync。命令内容仅取前 100 字符用于日志，避免把整条命令（可能含密钥）写入日志。
