import type { AppState } from '../../state/AppState.js'
// 设置变更的应用器：磁盘上的 settings 一变，这里负责把权限规则、hooks 快照、AppState 三处全部同步到位。
import { logForDebugging } from '../debug.js'
import { updateHooksConfigSnapshot } from '../hooks/hooksConfigSnapshot.js'
import {
  createDisabledBypassPermissionsContext,
  findOverlyBroadBashPermissions,
  isBypassPermissionsModeDisabled,
  removeDangerousPermissions,
  transitionPlanAutoMode,
} from '../permissions/permissionSetup.js'
import { syncPermissionRulesFromDisk } from '../permissions/permissions.js'
import { loadAllPermissionRulesFromDisk } from '../permissions/permissionsLoader.js'
import type { SettingSource } from './constants.js'
import { getInitialSettings } from './settings.js'
// 依赖分层：权限规则的重读与合并都在 permissions 目录，本模块只做编排，不自己解析任何规则。

/**
 * Apply a settings change to app state. Re-reads settings from disk,
 * reloads permissions and hooks, and pushes the new state.
 *
 * Used by both the interactive path (AppState.tsx via useSettingsChange) and
 * the headless/SDK path (print.ts direct subscribe) so that managed-settings
 * / policy changes are fully applied in both modes.
 *
 * The settings cache is reset by the notifier (changeDetector.fanOut) before
 * listeners are iterated, so getInitialSettings() here reads fresh disk
 * state. Previously this function reset the cache itself, which — combined
 * with useSettingsChange's own reset — caused N disk reloads per notification
 * for N subscribers.
 *
 * Side-effects like clearing auth caches and applying env vars are handled by
 * `onChangeAppState` which fires when `settings` changes in state.
 */
export function applySettingsChange(
  source: SettingSource,
  setAppState: (f: (prev: AppState) => AppState) => void,
): void {
  const newSettings = getInitialSettings()
// 这里直接读新鲜值而不重置缓存：重置职责已经上移到通知器（changeDetector.fanOut），否则 N 个订阅者会触发 N 次磁盘重读——注释里记了这个历史 bug。

  logForDebugging(`Settings changed from ${source}, updating app state`)

  const updatedRules = loadAllPermissionRulesFromDisk()
  updateHooksConfigSnapshot()
// hooks 配置快照单独刷新：hooks 不走 AppState，订阅方读快照文件，因此设置变更后要显式重建。

  setAppState(prev => {
    let newContext = syncPermissionRulesFromDisk(
      prev.toolPermissionContext,
      updatedRules,
    )

    // Ant-only: re-strip overly broad Bash allow rules after settings sync
    if (
      process.env.USER_TYPE === 'ant' &&
      process.env.CLAUDE_CODE_ENTRYPOINT !== 'local-agent'
    ) {
      const overlyBroad = findOverlyBroadBashPermissions(updatedRules, [])
      if (overlyBroad.length > 0) {
        newContext = removeDangerousPermissions(newContext, overlyBroad)
      }
    }
// Ant 内部专属的收紧逻辑：设置同步后重查过宽的 Bash 放行规则，发现就剥掉；本地 agent 入口豁免，避免开发自测被打断。

    if (
      newContext.isBypassPermissionsModeAvailable &&
      isBypassPermissionsModeDisabled()
    ) {
      newContext = createDisabledBypassPermissionsContext(newContext)
    }
// 策略禁用 bypass 模式时强制降级：可用性标记还在，但实际上下文会被替换成「已禁用」版本，模式切换 UI 据此变灰。

    newContext = transitionPlanAutoMode(newContext)
// plan 与 auto 模式之间的过渡归一：设置变更可能改变哪个模式合法，这里统一收敛，不留给各调用方自行判断。

    // Sync effortLevel from settings to top-level AppState when it changes
    // (e.g. via applyFlagSettings from IDE). Only propagate if the setting
    // itself changed — otherwise unrelated settings churn (e.g. tips dismissal
    // on startup) would clobber a --effort CLI flag value held in AppState.
    const prevEffort = prev.settings.effortLevel
    const newEffort = newSettings.effortLevel
    const effortChanged = prevEffort !== newEffort
// effort 级别的传播只认「设置本身变了」：无关的设置抖动（比如启动时关掉一条提示）不能覆盖掉 CLI 传入的 --effort 值——注释详细记了为什么必须比对前后值。

    return {
      ...prev,
      settings: newSettings,
      toolPermissionContext: newContext,
      // Only propagate a defined new value — when the disk key is absent
      // (e.g. /effort max for non-ants writes undefined; --effort CLI flag),
      // prev.settings.effortLevel can be stale (internal writes suppress the
      // watcher that would resync AppState.settings), so effortChanged would
      // be true and we'd wipe a session-scoped value held in effortValue.
      ...(effortChanged && newEffort !== undefined
        ? { effortValue: newEffort }
        : {}),
    }
  })
}
// 返回对象里的条件展开是最后一道防线：磁盘键缺失时 newEffort 是 undefined，此时绝不能把会话内已设的 effortValue 抹掉。
