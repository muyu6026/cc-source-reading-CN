/**
 * Teammate mode snapshot module.
 *
 * Captures the teammate mode at session startup, following the same pattern
 * as hooksConfigSnapshot.ts. This ensures that runtime config changes don't
 * affect the teammate mode for the current session.
 */
// 队友模式的启动快照：会话开始时把模式定死，之后运行期改配置不影响本次会话——与 hooksConfigSnapshot 同一套「启动即定格」的模式。

import { getGlobalConfig } from '../../../utils/config.js'
import { logForDebugging } from '../../../utils/debug.js'
import { logError } from '../../../utils/log.js'

export type TeammateMode = 'auto' | 'tmux' | 'in-process'
// 只有三种模式：auto 由运行时自行选择、tmux 起独立进程、in-process 在当前进程里跑。写死成字面量联合，避免枚举带来的运行时对象。

// Module-level variable to hold the captured mode at startup
let initialTeammateMode: TeammateMode | null = null

// CLI override (set before capture if --teammate-mode is provided)
let cliTeammateModeOverride: TeammateMode | null = null
// 两个模块级变量分工明确：initialTeammateMode 是已定格的快照，cliTeammateModeOverride 是命令行传入、尚未定格时的暂存值。

/**
 * Set the CLI override for teammate mode.
 * Must be called before captureTeammateModeSnapshot().
 */
export function setCliTeammateModeOverride(mode: TeammateMode): void {
  cliTeammateModeOverride = mode
}
// 设置覆盖必须在捕获之前调用：它只写暂存变量，不碰快照，因此顺序错了不会报错但会静默失效。

/**
 * Get the current CLI override, if any.
 * Returns null if no CLI override was set.
 */
export function getCliTeammateModeOverride(): TeammateMode | null {
  return cliTeammateModeOverride
}
// 读取覆盖值时返回 null 而不是 undefined：与快照变量的初始值保持一致，调用方只需判 null 一种情况。

/**
 * Clear the CLI override and update the snapshot to the new mode.
 * Called when user changes the setting in the UI, allowing their change to take effect.
 *
 * @param newMode - The new mode the user selected (passed directly to avoid race condition)
 */
export function clearCliTeammateModeOverride(newMode: TeammateMode): void {
  cliTeammateModeOverride = null
  initialTeammateMode = newMode
  logForDebugging(
    `[TeammateModeSnapshot] CLI override cleared, new mode: ${newMode}`,
  )
}
// 用户在 UI 里改设置时走这里：清掉 CLI 覆盖并直接把新模式写进快照。新值由调用方传入而不是回读配置，是为了避开「配置还没落盘」的竞态。

/**
 * Capture the teammate mode at session startup.
 * Called early in main.tsx, after CLI args are parsed.
 * CLI override takes precedence over config.
 */
export function captureTeammateModeSnapshot(): void {
  if (cliTeammateModeOverride) {
    initialTeammateMode = cliTeammateModeOverride
    logForDebugging(
      `[TeammateModeSnapshot] Captured from CLI override: ${initialTeammateMode}`,
    )
  } else {
    const config = getGlobalConfig()
    initialTeammateMode = config.teammateMode ?? 'auto'
    logForDebugging(
      `[TeammateModeSnapshot] Captured from config: ${initialTeammateMode}`,
    )
  }
}
// 捕获逻辑只有两条分支：有 CLI 覆盖就用覆盖值，否则读全局配置、缺省 auto。两个分支都打调试日志，排障时能看出模式从哪来。

/**
 * Get the teammate mode for this session.
 * Returns the snapshot captured at startup, ignoring any runtime config changes.
 */
export function getTeammateModeFromSnapshot(): TeammateMode {
  if (initialTeammateMode === null) {
    // This indicates an initialization bug - capture should happen in setup()
    logError(
      new Error(
        'getTeammateModeFromSnapshot called before capture - this indicates an initialization bug',
      ),
    )
    captureTeammateModeSnapshot()
  }
  // Fallback to 'auto' if somehow still null (shouldn't happen, but safe)
  return initialTeammateMode ?? 'auto'
}
// 读取时发现快照为空说明初始化顺序有 bug：先记一条错误日志再补捕获，最后仍然兜底返回 auto——宁可行为可预测，也不让整个会话起不来。
