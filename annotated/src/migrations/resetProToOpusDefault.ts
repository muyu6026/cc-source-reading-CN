import { logEvent } from 'src/services/analytics/index.js'
// 引入分析埋点、Pro 订阅判定、全局配置、供应商解析与已弃用设置读取。
import { isProSubscriber } from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'

export function resetProToOpusDefault(): void {
// 导出的一次性迁移函数：将符合条件的 Pro 用户默认模型迁移到 Opus 4.5。
  const config = getGlobalConfig()
// 读取全局配置，检查迁移完成标志。

  if (config.opusProMigrationComplete) {
// 若已完成迁移则直接返回。
    return
  }

  const apiProvider = getAPIProvider()
// 解析当前 API 供应商。

  // Pro users on firstParty get auto-migrated to Opus 4.5 default
// 注释：第一方 Pro 用户会被自动迁移到 Opus 4.5 默认模型。
  if (apiProvider !== 'firstParty' || !isProSubscriber()) {
// 非第一方或不是 Pro 订阅者：直接标记完成并跳过，不改动模型设置。
    saveGlobalConfig(current => ({
      ...current,
      opusProMigrationComplete: true,
    }))
    logEvent('tengu_reset_pro_to_opus_default', { skipped: true })
// 埋点：记录跳过原因（skipped: true）。
    return
  }

  const settings = getSettings_DEPRECATED()
// 读取已弃用的用户设置（含默认模型）。

  // Only show notification if user was on default (no custom model setting)
// 注释：仅当用户原本使用默认模型（未自定义）时才弹通知。
  if (settings?.model === undefined) {
// 未自定义模型分支：记录迁移时间戳用于后续展示升级通知。
    const opusProMigrationTimestamp = Date.now()
    saveGlobalConfig(current => ({
      ...current,
      opusProMigrationComplete: true,
      opusProMigrationTimestamp,
    }))
// 埋点：记录未自定义模型用户的迁移事件。
    logEvent('tengu_reset_pro_to_opus_default', {
      skipped: false,
      had_custom_model: false,
    })
  } else {
    // User has a custom model setting, just mark migration complete
// 注释：用户已自定义模型，只标记迁移完成、不改动其设置。
    saveGlobalConfig(current => ({
      ...current,
      opusProMigrationComplete: true,
    }))
    logEvent('tengu_reset_pro_to_opus_default', {
// 埋点：记录已自定义模型用户的迁移事件。
      skipped: false,
      had_custom_model: true,
    })
  }
}
// 函数收尾，结束迁移逻辑。
