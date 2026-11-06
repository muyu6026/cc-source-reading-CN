import { logEvent } from '../services/analytics/index.js'
// 将设置中固定为「opus」的用户，在符合合并条件时迁移到「opus[1m]」；CLI 的 --model opus 是运行时覆盖、不改设置，故不受影响。
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate users with 'opus' pinned in their settings to 'opus[1m]' when they
 * are eligible for the merged Opus 1M experience (Max/Team Premium on 1P).
 *
 * CLI invocations with --model opus are unaffected: that flag is a runtime
 * override and does not touch userSettings, so it continues to use plain Opus.
 *
 * Pro subscribers are skipped — they retain separate Opus and Opus 1M options.
 * 3P users are skipped — their model strings are full model IDs, not aliases.
 *
 * Idempotent: only writes if userSettings.model is exactly 'opus'.
 */
export function migrateOpusToOpus1m(): void {
// 入口函数：先判合并开关，再读用户设置，仅当恰好是「opus」才写回「opus[1m]」或清空（与默认主循环模型一致时写 undefined 以回落默认）。
  if (!isOpus1mMergeEnabled()) {
// 合并未启用则直接返回，不在非 1M 体验下改动任何设置。
    return
  }

  const model = getSettingsForSource('userSettings')?.model
// 读取用户设置里的 model 字段，非「opus」直接跳过，保证幂等（只动恰好等于「opus」的情况）。
  if (model !== 'opus') {
    return
  }

  const migrated = 'opus[1m]'
// 目标字符串是「opus[1m]」；若解析后与默认主循环模型相同，则 modelToSet 为 undefined，让设置回落默认、避免冗余覆盖。
  const modelToSet =
    parseUserSpecifiedModel(migrated) ===
    parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
      ? undefined
      : migrated
  updateSettingsForSource('userSettings', { model: modelToSet })
// 写入新的 model 设置；若等于默认则 modelToSet 为 undefined，等价于清空该字段。

  logEvent('tengu_opus_to_opus1m_migration', {})
// 打点记录迁移发生，供后续统计覆盖率。
}
