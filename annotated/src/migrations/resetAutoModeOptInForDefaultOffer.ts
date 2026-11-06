import { feature } from 'bun:bundle'
// 引入 bun 编译期开关、分析埋点、全局/用户配置、日志与权限状态等依赖。
import { logEvent } from 'src/services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import { getAutoModeEnabledState } from '../utils/permissions/permissionSetup.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * One-shot migration: clear skipAutoPermissionPrompt for users who accepted
 * the old 2-option AutoModeOptInDialog but don't have auto as their default.
 * Re-surfaces the dialog so they see the new "make it my default mode" option.
 * Guard lives in GlobalConfig (~/.claude.json), not settings.json, so it
 * survives settings resets and doesn't re-arm itself.
 *
 * Only runs when tengu_auto_mode_config.enabled === 'enabled'. For 'opt-in'
 * users, clearing skipAutoPermissionPrompt would remove auto from the carousel
 * (permissionSetup.ts:988) — the dialog would become unreachable and the
 * migration would defeat itself. In practice the ~40 target ants are all
 * 'enabled' (they reached the old dialog via bare Shift+Tab, which requires
 * 'enabled'), but the guard makes it safe regardless.
 */
// 迁移用途说明：一次性清空「已接受旧版两选项 AutoMode 弹窗但默认模式非 auto」用户的 skipAutoPermissionPrompt，让新版「设为默认模式」选项重新浮现。
export function resetAutoModeOptInForDefaultOffer(): void {
// 导出的一次性迁移函数；整体包在 TRANSCRIPT_CLASSIFIER 开关内，仅蚂蚁内部构建执行。
  if (feature('TRANSCRIPT_CLASSIFIER')) {
// 读取全局配置（~/.claude.json），完成标志存于此而非 settings.json，以便跨设置重置保留。
    const config = getGlobalConfig()
    if (config.hasResetAutoModeOptInForDefaultOffer) return
// 若已完成过该迁移则直接返回，保证幂等。
    if (getAutoModeEnabledState() !== 'enabled') return
// 仅当自动模式开启状态为 enabled 时才继续；对 opt-in 用户清空会破坏弹窗可达性。

    try {
// 进入修正分支，整体包在 try 中以捕获异常。
      const user = getSettingsForSource('userSettings')
      if (
// 判定条件：用户层存在「跳过自动权限提示」且默认模式不是 auto。
        user?.skipAutoPermissionPrompt &&
        user?.permissions?.defaultMode !== 'auto'
      ) {
        updateSettingsForSource('userSettings', {
// 将 skipAutoPermissionPrompt 置为 undefined，使弹窗重新出现。
          skipAutoPermissionPrompt: undefined,
        })
        logEvent('tengu_migrate_reset_auto_opt_in_for_default_offer', {})
// 埋点：记录本次迁移事件。
      }

      saveGlobalConfig(c => {
// 写入全局配置，置 hasResetAutoModeOptInForDefaultOffer 完成标志。
        if (c.hasResetAutoModeOptInForDefaultOffer) return c
        return { ...c, hasResetAutoModeOptInForDefaultOffer: true }
      })
    } catch (error) {
      logError(new Error(`Failed to reset auto mode opt-in: ${error}`))
    }
// 异常兜底：迁移失败时记录错误日志，不影响主流程。
  }
}
