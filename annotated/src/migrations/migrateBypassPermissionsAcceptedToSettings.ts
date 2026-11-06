import { logEvent } from 'src/services/analytics/index.js'
// 迁移：把全局配置里的 bypassPermissionsModeAccepted 搬到 settings.json 的 skipDangerousModePermissionPrompt；settings 才是用户可配置项。
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  hasSkipDangerousModePermissionPrompt,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migration: Move bypassPermissionsModeAccepted from global config to settings.json
 * as skipDangerousModePermissionPrompt. This is a better home since settings.json
 * is the user-configurable settings file.
 */
export function migrateBypassPermissionsAcceptedToSettings(): void {
// 入口：读全局配置，若没设过跳过危险模式提示则写到 settings，并打点、再清掉旧全局字段。
  const globalConfig = getGlobalConfig()
// 读取全局配置。

  if (!globalConfig.bypassPermissionsModeAccepted) {
// 没有旧字段就直接返回，幂等。
    return
  }

  try {
    if (!hasSkipDangerousModePermissionPrompt()) {
// 仅在尚未设置时写入 skipDangerousModePermissionPrompt = true。
      updateSettingsForSource('userSettings', {
        skipDangerousModePermissionPrompt: true,
      })
    }

    logEvent('tengu_migrate_bypass_permissions_accepted', {})

    saveGlobalConfig(current => {
// 用函数式更新删掉旧的 bypassPermissionsModeAccepted 字段。
      if (!('bypassPermissionsModeAccepted' in current)) return current
      const { bypassPermissionsModeAccepted: _, ...updatedConfig } = current
      return updatedConfig
    })
  } catch (error) {
// 任何失败都记错误日志，不让迁移中断主流程。
    logError(
      new Error(`Failed to migrate bypass permissions accepted: ${error}`),
    )
  }
}
