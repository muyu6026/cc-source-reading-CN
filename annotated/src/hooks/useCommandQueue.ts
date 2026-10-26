import { useSyncExternalStore } from 'react'
import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  getCommandQueueSnapshot,
  subscribeToCommandQueue,
} from '../utils/messageQueueManager.js'

/**
 * React hook to subscribe to the unified command queue.
 * Returns a frozen array that only changes reference on mutation.
 * Components re-render only when the queue changes.
 */
// 订阅统一命令队列的 hook：返回冻结数组，仅队列变更时才改引用，组件只在队列变化时重渲染。
export function useCommandQueue(): readonly QueuedCommand[] {
  return useSyncExternalStore(subscribeToCommandQueue, getCommandQueueSnapshot)
// 用 useSyncExternalStore 接 subscribeToCommandQueue / getCommandQueueSnapshot，二者配合保证引用稳定。
}
