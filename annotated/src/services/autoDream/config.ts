// Leaf config module — intentionally minimal imports so UI components
// can read the auto-dream enabled state without dragging in the forked
// agent / task registry / message builder chain that autoDream.ts pulls in.
// 这是个「叶子配置模块」，存在的唯一理由就是**打断依赖链**：UI 组件只想问一句「自动整理开没开」，如果直接从 `autoDream.ts` 导入，就会顺着那条链把 forked agent、task registry、message builder 全拖进 UI 的 bundle。所以把判定单独放这里，依赖只剩 `settings` 和 `growthbook` 两个。这也是整套代码里反复出现的模式——判定逻辑与执行逻辑分家，谁需要判定谁只付判定的成本。

import { getInitialSettings } from '../../utils/settings/settings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/**
 * Whether background memory consolidation should run. User setting
 * (autoDreamEnabled in settings.json) overrides the GrowthBook default
 * when explicitly set; otherwise falls through to tengu_onyx_plover.
 */
export function isAutoDreamEnabled(): boolean {
  const setting = getInitialSettings().autoDreamEnabled
  if (setting !== undefined) return setting
  const gb = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: unknown } | null>(
    'tengu_onyx_plover',
    null,
  )
  return gb?.enabled === true
}
// 优先级很明确：**用户在 settings.json 里显式写了 `autoDreamEnabled` 就以用户为准**（写 `false` 也算显式），没写才落到 GrowthBook 的 `tengu_onyx_plover.enabled`。这里用 `setting !== undefined` 而不是真值判断，是刻意的——要尊重用户「我不想开」的明确表达，别让远端开关把它覆盖回去。
