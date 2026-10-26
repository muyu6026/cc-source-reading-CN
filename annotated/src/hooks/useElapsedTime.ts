import { useCallback, useSyncExternalStore } from 'react'
import { formatDuration } from '../utils/format.js'

/**
 * Hook that returns formatted elapsed time since startTime.
 * Uses useSyncExternalStore with interval-based updates for efficiency.
 *
 * @param startTime - Unix timestamp in ms
 * @param isRunning - Whether to actively update the timer
 * @param ms - How often should we trigger updates?
 * @param pausedMs - Total paused duration to subtract
 * @param endTime - If set, freezes the duration at this timestamp (for
 *   terminal tasks). Without this, viewing a 2-min task 30 min after
 *   completion would show "32m".
 * @returns Formatted duration string (e.g., "1m 23s")
 */
// 格式化「自 startTime 起的经过时长」，用 useSyncExternalStore + 定时 notify 实现高效刷新。
export function useElapsedTime(
  startTime: number,
  isRunning: boolean,
  ms: number = 1000,
  pausedMs: number = 0,
  endTime?: number,
): string {
  const get = () =>
    formatDuration(Math.max(0, (endTime ?? Date.now()) - startTime - pausedMs))

// get 算差值：endTime 优先（终态任务冻结时长，避免看完超时任务显示膨胀），否则用当前时间，并减掉暂停时长。
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!isRunning) return () => {}
      const interval = setInterval(notify, ms)
      return () => clearInterval(interval)
    },
    [isRunning, ms],
  )

  return useSyncExternalStore(subscribe, get, get)
// subscribe 仅在 isRunning 时挂 setInterval 周期 notify；get 同时作 server/getSnapshot 同源，避免 hydration 不匹配。
}
