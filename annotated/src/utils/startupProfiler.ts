/**
 * Startup profiling utility for measuring and reporting time spent in various
 * initialization phases.
 *
 * Two modes:
 * 1. Sampled logging: 100% of ant users, 0.1% of external users - logs phases to Statsig
 * 2. Detailed profiling: CLAUDE_CODE_PROFILE_STARTUP=1 - full report with memory snapshots
 *
 * Uses Node.js built-in performance hooks API for standard timing measurement.
 */
// 文件总述：启动期性能剖析工具，测量并上报各初始化阶段耗时。两种模式：采样日志（ant 100%、外部 0.5% 上报 Statsig）与详细剖析（CLAUDE_CODE_PROFILE_STARTUP=1 时输出含内存快照的完整报告）。底层用 Node 内置 performance hooks。

import { dirname, join } from 'path'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { formatMs, formatTimelineLine, getPerformance } from './profilerBase.js'
import { writeFileSync_DEPRECATED } from './slowOperations.js'

// Module-level state - decided once at module load
// eslint-disable-next-line custom-rules/no-process-env-top-level
const DETAILED_PROFILING = isEnvTruthy(process.env.CLAUDE_CODE_PROFILE_STARTUP)
// DETAILED_PROFILING：仅在 CLAUDE_CODE_PROFILE_STARTUP=1 时开启详细剖析，模块加载期一次性决定。

// Sampling for Statsig logging: 100% ant, 0.5% external
// Decision made once at startup - non-sampled users pay no profiling cost
const STATSIG_SAMPLE_RATE = 0.005
// eslint-disable-next-line custom-rules/no-process-env-top-level
const STATSIG_LOGGING_SAMPLED =
  process.env.USER_TYPE === 'ant' || Math.random() < STATSIG_SAMPLE_RATE
// STATSIG 采样：ant 用户 100%、外部用户 0.5%，同样在启动期决定，未采样者不付剖析成本。

// Enable profiling if either detailed mode OR sampled for Statsig
const SHOULD_PROFILE = DETAILED_PROFILING || STATSIG_LOGGING_SAMPLED
// SHOULD_PROFILE：详细模式或采样命中任一为真才做剖析。

// Track memory snapshots separately (perf_hooks doesn't track memory).
// Only used when DETAILED_PROFILING is enabled.
// Stored as an array that appends in the same order as perf.mark() calls, so
// memorySnapshots[i] corresponds to getEntriesByType('mark')[i]. Using a Map
// keyed by checkpoint name is wrong because some checkpoints fire more than
// once (e.g. loadSettingsFromDisk_start fires during init and again after
// plugins reset the settings cache), and the second call would overwrite the
// first's memory snapshot.
const memorySnapshots: NodeJS.MemoryUsage[] = []
// memorySnapshots：按 mark 顺序追加内存快照；不用 Map 按名存，因为有些检查点会触发多次（如加载设置），后者会覆盖前者快照。

// Phase definitions for Statsig logging: [startCheckpoint, endCheckpoint]
const PHASE_DEFINITIONS = {
  import_time: ['cli_entry', 'main_tsx_imports_loaded'],
  init_time: ['init_function_start', 'init_function_end'],
  settings_time: ['eagerLoadSettings_start', 'eagerLoadSettings_end'],
  total_time: ['cli_entry', 'main_after_run'],
} as const
// PHASE_DEFINITIONS：各上报阶段对应的起止检查点（import、init、settings、total）。

// Record initial checkpoint if profiling is enabled
if (SHOULD_PROFILE) {
  // eslint-disable-next-line custom-rules/no-top-level-side-effects
  profileCheckpoint('profiler_initialized')
// 模块加载期若需剖析，先打一个 profiler_initialized 检查点。
}

/**
 * Record a checkpoint with the given name
 */
export function profileCheckpoint(name: string): void {
  if (!SHOULD_PROFILE) return

  const perf = getPerformance()
  perf.mark(name)

  // Only capture memory when detailed profiling enabled (env var)
  if (DETAILED_PROFILING) {
    memorySnapshots.push(process.memoryUsage())
  }
}
// profileCheckpoint：打一个 mark；仅详细剖析模式才抓内存快照。

/**
 * Get a formatted report of all checkpoints
 * Only available when DETAILED_PROFILING is enabled
 */
function getReport(): string {
  if (!DETAILED_PROFILING) {
    return 'Startup profiling not enabled'
  }

  const perf = getPerformance()
  const marks = perf.getEntriesByType('mark')
  if (marks.length === 0) {
    return 'No profiling checkpoints recorded'
  }

  const lines: string[] = []
  lines.push('='.repeat(80))
  lines.push('STARTUP PROFILING REPORT')
  lines.push('='.repeat(80))
  lines.push('')

  let prevTime = 0
  for (const [i, mark] of marks.entries()) {
    lines.push(
      formatTimelineLine(
        mark.startTime,
        mark.startTime - prevTime,
        mark.name,
        memorySnapshots[i],
        8,
        7,
      ),
    )
    prevTime = mark.startTime
  }

  const lastMark = marks[marks.length - 1]
  lines.push('')
  lines.push(`Total startup time: ${formatMs(lastMark?.startTime ?? 0)}ms`)
  lines.push('='.repeat(80))

  return lines.join('\n')
}
// getReport：把全部检查点拼成可读的详细报告文本（含总耗时）。

let reported = false

export function profileReport(): void {
  if (reported) return
  reported = true

  // Log to Statsig (sampled: 100% ant, 0.1% external)
  logStartupPerf()

  // Output detailed report if CLAUDE_CODE_PROFILE_STARTUP=1
  if (DETAILED_PROFILING) {
    // Write to file
    const path = getStartupPerfLogPath()
    const dir = dirname(path)
    const fs = getFsImplementation()
    fs.mkdirSync(dir)
    writeFileSync_DEPRECATED(path, getReport(), {
      encoding: 'utf8',
      flush: true,
    })

    logForDebugging('Startup profiling report:')
    logForDebugging(getReport())
  }
}
// profileReport：上报 Statsig（采样命中时才报），并在详细模式下把报告写入文件与调试日志。

export function isDetailedProfilingEnabled(): boolean {
  return DETAILED_PROFILING
}
// isDetailedProfilingEnabled：导出详细剖析是否开启。

export function getStartupPerfLogPath(): string {
  return join(getClaudeConfigHomeDir(), 'startup-perf', `${getSessionId()}.txt`)
}
// getStartupPerfLogPath：报告文件按 session id 命名，放在配置目录的 startup-perf 子目录。

/**
 * Log startup performance phases to Statsig.
 * Only logs if this session was sampled at startup.
 */
export function logStartupPerf(): void {
  // Only log if we were sampled (decision made at module load)
  if (!STATSIG_LOGGING_SAMPLED) return

  const perf = getPerformance()
  const marks = perf.getEntriesByType('mark')
  if (marks.length === 0) return

  // Build checkpoint lookup
  const checkpointTimes = new Map<string, number>()
  for (const mark of marks) {
    checkpointTimes.set(mark.name, mark.startTime)
  }

  // Compute phase durations
  const metadata: Record<string, number | undefined> = {}

  for (const [phaseName, [startCheckpoint, endCheckpoint]] of Object.entries(
    PHASE_DEFINITIONS,
  )) {
    const startTime = checkpointTimes.get(startCheckpoint)
    const endTime = checkpointTimes.get(endCheckpoint)

    if (startTime !== undefined && endTime !== undefined) {
      metadata[`${phaseName}_ms`] = Math.round(endTime - startTime)
    }
  }

  // Add checkpoint count for debugging
  metadata.checkpoint_count = marks.length

  logEvent(
    'tengu_startup_perf',
    metadata as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  )
}
// logStartupPerf：把各阶段时长算成元数据，上报 Statsig 事件 tengu_startup_perf；未采样则直接返回。
