import { useState } from 'react'
import { useInterval } from 'usehooks-ts'

export type MemoryUsageStatus = 'normal' | 'high' | 'critical'

export type MemoryUsageInfo = {
  heapUsed: number
  status: MemoryUsageStatus
}

const HIGH_MEMORY_THRESHOLD = 1.5 * 1024 * 1024 * 1024 // 1.5GB in bytes
// 高水位阈值 1.5GB：超过才进入「high」提示态。
const CRITICAL_MEMORY_THRESHOLD = 2.5 * 1024 * 1024 * 1024 // 2.5GB in bytes
// 严重水位阈值 2.5GB：进入「critical」提示态。

/**
 * Hook to monitor Node.js process memory usage.
 * Polls every 10 seconds; returns null while status is 'normal'.
 */
export function useMemoryUsage(): MemoryUsageInfo | null {
// 平时返回 null（不渲染任何提示），只有越过阈值才返回具体占用信息。
  const [memoryUsage, setMemoryUsage] = useState<MemoryUsageInfo | null>(null)

  useInterval(() => {
    const heapUsed = process.memoryUsage().heapUsed
    const status: MemoryUsageStatus =
      heapUsed >= CRITICAL_MEMORY_THRESHOLD
        ? 'critical'
        : heapUsed >= HIGH_MEMORY_THRESHOLD
          ? 'high'
          : 'normal'
    setMemoryUsage(prev => {
      // Bail when status is 'normal' — nothing is shown, so heapUsed is
      // irrelevant and we avoid re-rendering the whole Notifications subtree
      // every 10 seconds for the 99%+ of users who never reach 1.5GB.
      if (status === 'normal') return prev === null ? prev : null
// 关键优化：status 为 normal 时返回 null 而非新对象，避免 99% 用户每 10s 重渲染整个通知子树。
      return { heapUsed, status }
    })
  }, 10_000)

  return memoryUsage
}
