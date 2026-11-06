import { logEvent } from 'src/services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
// 依赖：analytics 上报、全局配置、错误日志、设置读写（注意：首个 import 用的是 src/ 绝对前缀）
// 迁移：将用户显式关闭的自动更新偏好迁移到 settings.json 环境变量（保留用户意图，同时让原生安装可自动更新）
/**
 * Migration: Move user-set autoUpdates preference to settings.json env var
 * Only migrates if user explicitly disabled auto-updates (not for protection)
 * This preserves user intent while allowing native installations to auto-update
 */
export function migrateAutoUpdatesToSettings(): void {
// 迁移主函数
  const globalConfig = getGlobalConfig()
// 取全局配置

  // Only migrate if autoUpdates was explicitly set to false by user preference
  // (not automatically for native protection)
  if (
    globalConfig.autoUpdates !== false ||
    globalConfig.autoUpdatesProtectedForNative === true
  ) {
    return
  }
// 仅当用户显式关闭自动更新、且非原生保护时才迁移

  try {
    const userSettings = getSettingsForSource('userSettings') || {}
// 读取现有 userSettings

    // Always set DISABLE_AUTOUPDATER to preserve user intent
    // We need to overwrite even if it exists, to ensure the migration is complete
    updateSettingsForSource('userSettings', {
      ...userSettings,
      env: {
        ...userSettings.env,
        DISABLE_AUTOUPDATER: '1',
      },
    })
// 无论是否已存在都覆盖写入 DISABLE_AUTOUPDATER=1 以保用户意图

    logEvent('tengu_migrate_autoupdates_to_settings', {
      was_user_preference: true,
      already_had_env_var: !!userSettings.env?.DISABLE_AUTOUPDATER,
    })

    // explicitly set, so this takes effect immediately
    process.env.DISABLE_AUTOUPDATER = '1'
// 立即生效：直接设置进程环境变量

    // Remove autoUpdates from global config after successful migration
    saveGlobalConfig(current => {
// 从全局配置移除 autoUpdates 字段
      const {
        autoUpdates: _,
        autoUpdatesProtectedForNative: __,
        ...updatedConfig
      } = current
      return updatedConfig
    })
  } catch (error) {
// catch：迁移失败时记录错误并上报
    logError(new Error(`Failed to migrate auto-updates: ${error}`))
    logEvent('tengu_migrate_autoupdates_error', {
      has_error: true,
    })
  }
// catch 块结束
}
