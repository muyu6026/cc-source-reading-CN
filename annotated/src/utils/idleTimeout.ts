import { logForDebugging } from './debug.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'

// 文件级摘要：给 SDK 模式做一个空闲超时管理器，连续空闲到阈值就主动退出进程。
// 启停由外部控制：start 重置计时，stop 取消计时，是否真的空闲交给注入的 isIdle 回调判断。
/**
 * Creates an idle timeout manager for SDK mode.
 * Automatically exits the process after the specified idle duration.
 *
 * @param isIdle Function that returns true if the system is currently idle
 * @returns Object with start/stop methods to control the idle timer
 */
export function createIdleTimeoutManager(isIdle: () => boolean): {
  start: () => void
  stop: () => void
} {
  // Parse CLAUDE_CODE_EXIT_AFTER_STOP_DELAY environment variable
  const exitAfterStopDelay = process.env.CLAUDE_CODE_EXIT_AFTER_STOP_DELAY
  const delayMs = exitAfterStopDelay ? parseInt(exitAfterStopDelay, 10) : null
  const isValidDelay = delayMs && !isNaN(delayMs) && delayMs > 0
// 环境变量只在创建时读一次。`delayMs && !isNaN(delayMs) && delayMs > 0` 三个条件缺一不可——空串会变成 NaN，负值和 0 都应该视为未配置。

  let timer: NodeJS.Timeout | null = null
  let lastIdleTime = 0
// `lastIdleTime` 记录本轮空闲的起点。它在 start 里被刷新，因此每次有新活动调用 start 就等于把计时归零。

  return {
    start() {
      // Clear any existing timer
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      // Only start timer if delay is configured and valid
      if (isValidDelay) {
        lastIdleTime = Date.now()
// 起点取当前时刻，而不是从上次 stop 算起。语义是「从这次 start 开始连续空闲多久」，不是累计空闲时长。

        timer = setTimeout(() => {
          // Check if we've been continuously idle for the full duration
          const idleDuration = Date.now() - lastIdleTime
          if (isIdle() && idleDuration >= delayMs) {
            logForDebugging(`Exiting after ${delayMs}ms of idle time`)
            gracefulShutdownSync()
          }
        }, delayMs)
      }
    },
// 超时回调里要二次校验：定时器可能在到期瞬间被打断，`Date.now() - lastIdleTime` 未必真到了阈值。
// 两个条件同时满足才退出——只看定时器触发是不够的，只看 isIdle 也会在刚启动时误判。

    stop() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
// 工厂返回的对象只有启停两个方法，不暴露内部计时器，避免调用方误改状态。
