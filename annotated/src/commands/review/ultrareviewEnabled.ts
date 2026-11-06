import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
// 引入带缓存、可能过期的 GrowthBook 特性读取函数，用于运行期开关判定。

/**
 * Runtime gate for /ultrareview. GB config's `enabled` field controls
 * visibility — isEnabled() on the command filters it from getCommands()
 * when false, so ungated users don't see the command at all.
 */
// 导出开关函数，决定 `/ultrareview` 命令对当前用户是否可见。
export function isUltrareviewEnabled(): boolean {
  const cfg = getFeatureValue_CACHED_MAY_BE_STALE<Record<
    string,
    unknown
  > | null>('tengu_review_bughunter_config', null)
// 读取名为 `tengu_review_bughunter_config` 的 GrowthBook 配置，缺省值为 null。
  return cfg?.enabled === true
// 仅当配置对象存在且 `enabled` 为真才放行，未配置用户不会看到该命令。
}
