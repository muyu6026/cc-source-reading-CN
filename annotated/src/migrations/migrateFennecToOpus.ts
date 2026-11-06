import {
// 引入用户设置读写工具。
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate users on removed fennec model aliases to their new Opus 4.6 aliases.
 * - fennec-latest → opus
 * - fennec-latest[1m] → opus[1m]
 * - fennec-fast-latest → opus[1m] + fast mode
 * - opus-4-5-fast → opus + fast mode
 *
 * Only touches userSettings. Reading and writing the same source keeps this
 * idempotent without a completion flag. Fennec aliases in project/local/policy
 * settings are left alone — we can't rewrite those, and reading merged
 * settings here would cause infinite re-runs + silent global promotion.
 */
// 迁移说明：将已移除的 fennec 模型别名映射到新的 Opus 4.6 别名，并列出四条映射规则。
export function migrateFennecToOpus(): void {
// 导出迁移函数。
  if (process.env.USER_TYPE !== 'ant') {
// 仅蚂蚁用户执行（fennec 为内部代号）；否则直接返回。
    return
  }

  const settings = getSettingsForSource('userSettings')
// 读取用户层模型设置。

  const model = settings?.model
  if (typeof model === 'string') {
// 仅当 model 为字符串时才处理。
    if (model.startsWith('fennec-latest[1m]')) {
// fennec-latest[1m] → opus[1m]。
      updateSettingsForSource('userSettings', {
        model: 'opus[1m]',
      })
    } else if (model.startsWith('fennec-latest')) {
      updateSettingsForSource('userSettings', {
// fennec-latest → opus。
        model: 'opus',
      })
    } else if (
      model.startsWith('fennec-fast-latest') ||
      model.startsWith('opus-4-5-fast')
    ) {
// fennec-fast-latest 或 opus-4-5-fast → opus[1m] 并开启 fast 模式。
      updateSettingsForSource('userSettings', {
        model: 'opus[1m]',
        fastMode: true,
      })
    }
  }
}
// 函数收尾，结束 fennec 别名迁移。
