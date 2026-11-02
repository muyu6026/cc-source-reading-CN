/**
 * Shared infrastructure for profiler modules (startupProfiler, queryProfiler,
 * headlessProfiler). All three use the same perf_hooks timeline and the same
 * line format for detailed reports.
 */
// 文件级：三个 profiler（startup / query / headless）共用的基础设施——同一套 perf_hooks 时间线与同一套详细报告行格式。

import type { performance as PerformanceType } from 'perf_hooks'
import { formatFileSize } from './format.js'

// Lazy-load performance API only when profiling is enabled.
// Shared across all profilers — perf_hooks.performance is a process-wide singleton.
let performance: typeof PerformanceType | null = null

// getPerformance：懒加载 perf_hooks.performance（仅在启用 profiling 时），进程级单例，避免无谓引入。
export function getPerformance(): typeof PerformanceType {
  if (!performance) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    performance = require('perf_hooks').performance
  }
  return performance!
}

// formatMs：把毫秒格式化为三位小数文本。
export function formatMs(ms: number): string {
  return ms.toFixed(3)
}

/**
 * Render a single timeline line in the shared profiler report format:
 *   [+  total.ms] (+  delta.ms) name [extra] [| RSS: .., Heap: ..]
 *
 * totalPad/deltaPad control the padStart width so callers can align columns
 * based on their expected magnitude (startup uses 8/7, query uses 10/9).
 */
// formatTimelineLine：渲染共享报告的一行时间线——「[+总.ms] (+增量.ms) 名称 [额外] [| RSS / Heap]」，totalPad/deltaPad 控制列宽对齐（startup 用 8/7，query 用 10/9）。
export function formatTimelineLine(
  totalMs: number,
  deltaMs: number,
  name: string,
  memory: NodeJS.MemoryUsage | undefined,
  totalPad: number,
  deltaPad: number,
  extra = '',
): string {
  const memInfo = memory
    ? ` | RSS: ${formatFileSize(memory.rss)}, Heap: ${formatFileSize(memory.heapUsed)}`
    : ''
  return `[+${formatMs(totalMs).padStart(totalPad)}ms] (+${formatMs(deltaMs).padStart(deltaPad)}ms) ${name}${extra}${memInfo}`
}
// formatTimelineLine 收尾：把内存信息拼成「| RSS: x, Heap: y」（无内存数据时留空）。
