import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
// 引入 analytics 上报、键位同步加载、显示文本解析与上下文类型
import { loadKeybindingsSync } from './loadUserBindings.js'
import { getBindingDisplayText } from './resolver.js'
import type { KeybindingContextName } from './types.js'
// 引入键位同步加载、显示文本解析与上下文类型

// TODO(keybindings-migration): Remove fallback parameter after migration is
// complete and we've confirmed no 'keybinding_fallback_used' events are being
// logged. The fallback exists as a safety net during migration - if bindings
// fail to load or an action isn't found, we fall back to hardcoded values.
// Once stable, callers should be able to trust that getBindingDisplayText
// always returns a value for known actions, and we can remove this defensive
// pattern.
// TODO：迁移完成后移除 fallback 参数与防御性逻辑（避免重复 fallback 事件）

// Track which action+context pairs have already logged a fallback event
// to avoid duplicate events from repeated calls in non-React contexts.
// LOGGED_FALLBACKS 之上的说明：记录已上报的 action+context 以避免非 React 上下文重复上报
const LOGGED_FALLBACKS = new Set<string>()
// 已上报 fallback 的去重集合

// getShortcutDisplay：不依赖 React Hook 的快捷键显示文本获取（供命令 / 服务等非 React 场景）
/**
 * Get the display text for a configured shortcut without React hooks.
 * Use this in non-React contexts (commands, services, etc.).
 *
 * This lives in its own module (not useShortcutDisplay.ts) so that
 * non-React callers like query/stopHooks.ts don't pull React into their
 * module graph via the sibling hook.
 *
 * @param action - The action name (e.g., 'app:toggleTranscript')
 * @param context - The keybinding context (e.g., 'Global')
 * @param fallback - Fallback text if binding not found
 * @returns The configured shortcut display text
 *
 * @example
 * const expandShortcut = getShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o')
 * // Returns the user's configured binding, or 'ctrl+o' as default
 */
export function getShortcutDisplay(
// 函数签名：action + context + fallback
  action: string,
  context: KeybindingContextName,
  fallback: string,
): string {
  const bindings = loadKeybindingsSync()
// 同步加载键位并解析显示文本
  const resolved = getBindingDisplayText(action, context, bindings)
  if (resolved === undefined) {
// 未解析到则走 fallback 并上报一次
    const key = `${action}:${context}`
    if (!LOGGED_FALLBACKS.has(key)) {
      LOGGED_FALLBACKS.add(key)
      logEvent('tengu_keybinding_fallback_used', {
        action:
          action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        context:
          context as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        fallback:
          fallback as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        reason:
          'action_not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    return fallback
// 无解析结果返回 fallback
  }
  return resolved
// 有结果返回解析到的文本
}
