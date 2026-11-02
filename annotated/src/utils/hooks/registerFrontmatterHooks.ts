// 本文件把 agent 或 skill 的 frontmatter 中声明的钩子注册为会话作用域钩子：钩子在整个会话/agent 期间有效，会话结束时清理。
import { HOOK_EVENTS, type HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import { logForDebugging } from '../debug.js'
import type { HooksSettings } from '../settings/types.js'
import { addSessionHook } from './sessionHooks.js'

/**
 * Register hooks from frontmatter (agent or skill) into session-scoped hooks.
 * These hooks will be active for the duration of the session/agent and cleaned up
 * when the session/agent ends.
 *
 * @param setAppState Function to update app state
 * @param sessionId Session ID to scope the hooks (agent ID for agents, session ID for skills)
 * @param hooks The hooks settings from frontmatter
 * @param sourceName Human-readable source name for logging (e.g., "agent 'my-agent'")
 * @param isAgent If true, converts Stop hooks to SubagentStop (since subagents trigger SubagentStop, not Stop)
 */
// `registerFrontmatterHooks` 按事件类型遍历 frontmatter 钩子设置，逐项调用 `addSessionHook` 注册；空设置直接返回。
export function registerFrontmatterHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  hooks: HooksSettings,
  sourceName: string,
  isAgent: boolean = false,
): void {
  if (!hooks || Object.keys(hooks).length === 0) {
    return
  }

  let hookCount = 0

  for (const event of HOOK_EVENTS) {
    const matchers = hooks[event]
    if (!matchers || matchers.length === 0) {
      continue
    }

    // For agents, convert Stop hooks to SubagentStop since that's what fires when an agent completes
    // (executeStopHooks uses SubagentStop when called with an agentId)
    let targetEvent: HookEvent = event
    if (isAgent && event === 'Stop') {
      targetEvent = 'SubagentStop'
// 当 `isAgent` 为真时，把 `Stop` 事件改写成 `SubagentStop`，因为子 agent 完成时触发的是 `SubagentStop` 而非 `Stop`。
      logForDebugging(
        `Converting Stop hook to SubagentStop for ${sourceName} (subagents trigger SubagentStop)`,
      )
    }

    for (const matcherConfig of matchers) {
      const matcher = matcherConfig.matcher ?? ''
      const hooksArray = matcherConfig.hooks

      if (!hooksArray || hooksArray.length === 0) {
        continue
      }

      for (const hook of hooksArray) {
        addSessionHook(setAppState, sessionId, targetEvent, matcher, hook)
// 对每个匹配项里的每个钩子调用 `addSessionHook` 注册，并用 `hookCount` 累计实际注册数量。
        hookCount++
      }
    }
  }

// 注册完成后若数量大于 0，记录一条调试日志说明本次从哪个来源注册了多少个钩子。
  if (hookCount > 0) {
    logForDebugging(
      `Registered ${hookCount} frontmatter hook(s) from ${sourceName} for session ${sessionId}`,
    )
  }
}
