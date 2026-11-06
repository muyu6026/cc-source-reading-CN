import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { saveGlobalConfig } from '../utils/config.js'
import { isLegacyModelRemapEnabled } from '../utils/model/model.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
// 引入设置读写与全局配置保存工具，供下方迁移使用。

/**
 * Migrate first-party users off explicit Opus 4.0/4.1 model strings.
 *
 * The 'opus' alias already resolves to Opus 4.6 for 1P, so anyone still
 * on an explicit 4.0/4.1 string pinned it in settings before 4.5 launched.
 * parseUserSpecifiedModel now silently remaps these at runtime anyway —
 * this migration cleans up the settings file so /model shows the right
 * thing, and sets a timestamp so the REPL can show a one-time notification.
 *
 * Only touches userSettings. Legacy strings in project/local/policy settings
 * are left alone (we can't/shouldn't rewrite those) and are still remapped at
 * runtime by parseUserSpecifiedModel. Reading and writing the same source
 * keeps this idempotent without a completion flag, and avoids silently
 * promoting 'opus' to the global default for users who only pinned it in one
 * project.
 */
export function migrateLegacyOpusToCurrent(): void {
// 迁移入口：把仍写死 Opus 4.0/4.1 的用户设置收敛为 opus 别名。
  if (getAPIProvider() !== 'firstParty') {
    return
  }
// 非第一方供应商直接跳过——别名解析仅对官方账户生效。

  if (!isLegacyModelRemapEnabled()) {
    return
  }

  const model = getSettingsForSource('userSettings')?.model
  if (
    model !== 'claude-opus-4-20250514' &&
    model !== 'claude-opus-4-1-20250805' &&
    model !== 'claude-opus-4-0' &&
    model !== 'claude-opus-4-1'
  ) {
    return
  }
// 逐串比对排除：仅当命中旧写死串才继续向下迁移。

  updateSettingsForSource('userSettings', { model: 'opus' })
  saveGlobalConfig(current => ({
    ...current,
    legacyOpusMigrationTimestamp: Date.now(),
  }))
// 回写为 opus 并打迁移时间戳，供 REPL 弹一次性通知。
  logEvent('tengu_legacy_opus_migration', {
    from_model:
      model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
// 埋点记录来源模型，便于评估迁移覆盖面。
