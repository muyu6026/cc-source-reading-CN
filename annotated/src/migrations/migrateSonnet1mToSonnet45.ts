import {
// 引入主循环模型覆盖的读写、全局配置、以及用户设置读写。
  getMainLoopModelOverride,
  setMainLoopModelOverride,
} from '../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate users who had "sonnet[1m]" saved to the explicit "sonnet-4-5-20250929[1m]".
 *
 * The "sonnet" alias now resolves to Sonnet 4.6, so users who previously set
 * "sonnet[1m]" (targeting Sonnet 4.5 with 1M context) need to be pinned to the
 * explicit version to preserve their intended model.
 *
 * This is needed because Sonnet 4.6 1M was offered to a different group of users than
 * Sonnet 4.5 1M, so we needed to pin existing sonnet[1m] users to Sonnet 4.5 1M.
 *
 * Reads from userSettings specifically (not merged settings) so we don't
 * promote a project-scoped "sonnet[1m]" to the global default. Runs once,
 * tracked by a completion flag in global config.
 */
// 迁移说明：将旧 sonnet[1m] 别名固定为显式 sonnet-4-5-20250929[1m]，因 sonnet 现指向 Sonnet 4.6。
export function migrateSonnet1mToSonnet45(): void {
  const config = getGlobalConfig()
  if (config.sonnet1m45MigrationComplete) {
// 导出的一次性迁移函数。
    return
// 读取全局配置并检查完成标志。
  }
// 已完成则直接返回。

  const model = getSettingsForSource('userSettings')?.model
  if (model === 'sonnet[1m]') {
    updateSettingsForSource('userSettings', {
// 仅读用户层设置（非合并设置），避免把项目级 sonnet[1m] 提升为全局默认。
      model: 'sonnet-4-5-20250929[1m]',
// 命中旧别名则改写为显式 Sonnet 4.5 1M 版本。
    })
  }

  // Also migrate the in-memory override if already set
  const override = getMainLoopModelOverride()
  if (override === 'sonnet[1m]') {
// 注释：同步迁移内存中的模型覆盖（若已设置）。
    setMainLoopModelOverride('sonnet-4-5-20250929[1m]')
// 若主循环覆盖值也是旧别名，则一并改写。
  }

  saveGlobalConfig(current => ({
    ...current,
    sonnet1m45MigrationComplete: true,
// 写入全局配置，置 sonnet1m45MigrationComplete 完成标志。
  }))
}
