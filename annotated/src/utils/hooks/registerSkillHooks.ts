// 本文件把某个 skill 的 frontmatter 钩子注册为会话作用域钩子；若钩子带 `once: true`，则在首次成功执行后自动移除。
import { HOOK_EVENTS } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import { logForDebugging } from '../debug.js'
import type { HooksSettings } from '../settings/types.js'
import { addSessionHook, removeSessionHook } from './sessionHooks.js'

/**
 * Registers hooks from a skill's frontmatter as session hooks.
 *
 * Hooks are registered as session-scoped hooks that persist for the duration
 * of the session. If a hook has `once: true`, it will be automatically removed
 * after its first successful execution.
 *
 * @param setAppState - Function to update the app state
 * @param sessionId - The current session ID
 * @param hooks - The hooks settings from the skill's frontmatter
 * @param skillName - The name of the skill (for logging)
 * @param skillRoot - The base directory of the skill (for CLAUDE_PLUGIN_ROOT env var)
 */
// `registerSkillHooks` 遍历所有事件与匹配项，为每个钩子调用 `addSessionHook`，并通过 `registeredCount` 累计注册数量。
export function registerSkillHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  hooks: HooksSettings,
  skillName: string,
  skillRoot?: string,
): void {
  let registeredCount = 0

  for (const eventName of HOOK_EVENTS) {
    const matchers = hooks[eventName]
    if (!matchers) continue

    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        // For once: true hooks, use onHookSuccess callback to remove after execution
        const onHookSuccess = hook.once
// 对带 `once: true` 的钩子，构造 `onHookSuccess` 回调：首次成功后记录调试日志并调用 `removeSessionHook` 自动移除。
          ? () => {
              logForDebugging(
                `Removing one-shot hook for event ${eventName} in skill '${skillName}'`,
              )
              removeSessionHook(setAppState, sessionId, eventName, hook)
            }
          : undefined

// 调用 `addSessionHook` 注册单个钩子，传入事件名、匹配器、钩子本体、可选的成功回调与 skill 根目录（用于 `CLAUDE_PLUGIN_ROOT`）。
        addSessionHook(
          setAppState,
          sessionId,
          eventName,
          matcher.matcher || '',
          hook,
          onHookSuccess,
          skillRoot,
        )
        registeredCount++
      }
    }
  }

  if (registeredCount > 0) {
    logForDebugging(
// 注册完成后若数量大于 0，记录调试日志说明本次从该 skill 注册了多少个钩子。
      `Registered ${registeredCount} hooks from skill '${skillName}'`,
    )
  }
}
