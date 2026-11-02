// 本文件用「托管设置」（policySettings）实现插件策略校验，作为组织策略拦截插件的唯一真相来源。
/**
 * Plugin policy checks backed by managed settings (policySettings).
 *
 * Kept as a leaf module (only imports settings) to avoid circular dependencies
 * — marketplaceHelpers.ts imports marketplaceManager.ts which transitively
 * reaches most of the plugin subsystem.
 */

import { getSettingsForSource } from '../settings/settings.js'
// 本模块只引入 settings 一个依赖，保持叶子模块身份，避免与 marketplaceManager 等形成循环依赖。

/**
 * Check if a plugin is force-disabled by org policy (managed-settings.json).
 * Policy-blocked plugins cannot be installed or enabled by the user at any
 * scope. Used as the single source of truth for policy blocking across the
 * install chokepoint, enable op, and UI filters.
 */
export function isPluginBlockedByPolicy(pluginId: string): boolean {
  const policyEnabled = getSettingsForSource('policySettings')?.enabledPlugins
  return policyEnabled?.[pluginId] === false
}
// isPluginBlockedByPolicy 读取 policySettings 下 enabledPlugins 中该插件的值；若为 false 即被策略强制禁用，任何作用域都不可安装或启用。
