// 迁移脚本：把 Pro / Max / Team Premium 用户的显式 Sonnet 4.5 模型串迁移到 sonnet 别名（现解析为 4.6）；只读 userSettings、幂等
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  isMaxSubscriber,
  isProSubscriber,
  isTeamPremiumSubscriber,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
// 引入订阅判断、设置读写、模型供应商与 analytics 上报

/**
 * Migrate Pro/Max/Team Premium first-party users off explicit Sonnet 4.5
 * model strings to the 'sonnet' alias (which now resolves to Sonnet 4.6).
 *
 * Users may have been pinned to explicit Sonnet 4.5 strings by:
 * - The earlier migrateSonnet1mToSonnet45 migration (sonnet[1m] → explicit 4.5[1m])
 * - Manually selecting it via /model
 *
 * Reads userSettings specifically (not merged) so we only migrate what /model
 * wrote — project/local pins are left alone.
 * Idempotent: only writes if userSettings.model matches a Sonnet 4.5 string.
 */
export function migrateSonnet45ToSonnet46(): void {
// 迁移主函数：非订阅 / 非 first-party / 模型不匹配都直接跳过（幂等）
  if (getAPIProvider() !== 'firstParty') {
// 非官方 API（first-party）用户不迁移
    return
  }

  if (!isProSubscriber() && !isMaxSubscriber() && !isTeamPremiumSubscriber()) {
// 仅 Pro / Max / Team Premium 订阅用户迁移
    return
  }

  const model = getSettingsForSource('userSettings')?.model
// 只读 userSettings 里的模型串
  if (
    model !== 'claude-sonnet-4-5-20250929' &&
    model !== 'claude-sonnet-4-5-20250929[1m]' &&
    model !== 'sonnet-4-5-20250929' &&
    model !== 'sonnet-4-5-20250929[1m]'
  ) {
    return
  }
// 模型不在 4.5 串集合则跳过（保证幂等）

  const has1m = model.endsWith('[1m]')
// 判断是否带 1m 上下文后缀，决定迁到 sonnet 还是 sonnet[1m]
  updateSettingsForSource('userSettings', {
// 写回 userSettings 的模型别名
    model: has1m ? 'sonnet[1m]' : 'sonnet',
  })

  // Skip notification for brand-new users — they never experienced the old default
  const config = getGlobalConfig()
// 取全局配置
  if (config.numStartups > 1) {
// 启动次数大于 1 才记录迁移时间戳（避免新用户被通知）
    saveGlobalConfig(current => ({
      ...current,
      sonnet45To46MigrationTimestamp: Date.now(),
    }))
  }

  logEvent('tengu_sonnet45_to_46_migration', {
// 上报迁移事件（含原模型与是否 1m）
    from_model:
      model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    has_1m: has1m,
  })
}
// 迁移函数结束
