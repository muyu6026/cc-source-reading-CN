// 文件级批注：`managedPlugins.ts` 从组织策略设置（`policySettings.enabledPlugins`）中读出被锁定的插件名集合，供强制启用/禁用插件的策略使用。
import { getSettingsForSource } from '../settings/settings.js'

/**
 * Plugin names locked by org policy (policySettings.enabledPlugins).
 *
 * Returns null when managed settings declare no plugin entries (common
 * case — no policy in effect).
 */
// 函数签名：返回被策略锁定的插件名集合（`Set<string>`），若策略未声明任何插件项则返回 `null`（常见情况：无策略生效）。
export function getManagedPluginNames(): Set<string> | null {
  const enabledPlugins = getSettingsForSource('policySettings')?.enabledPlugins
  if (!enabledPlugins) {
    return null
  }
  const names = new Set<string>()
  for (const [pluginId, value] of Object.entries(enabledPlugins)) {
    // Only plugin@marketplace boolean entries (true OR false) are
    // protected. Legacy owner/repo array form is not.
    if (typeof value !== 'boolean' || !pluginId.includes('@')) {
      continue
    }
    const name = pluginId.split('@')[0]
    if (name) {
      names.add(name)
    }
  }
  return names.size > 0 ? names : null
}
// 函数收尾：仅保护 `plugin@marketplace` 布尔条目（true/false 均算），旧式 owner/repo 数组形式不保护；集合为空也返回 `null`。
