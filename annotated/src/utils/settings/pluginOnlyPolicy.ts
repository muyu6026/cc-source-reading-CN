// 本文件实现「定制面是否锁定为仅插件来源」的策略判断，依据受管设置 `strictPluginOnlyCustomization` 决定用户级与项目级来源是否被跳过。
import { getSettingsForSource } from './settings.js'
import type { CUSTOMIZATION_SURFACES } from './types.js'

export type CustomizationSurface = (typeof CUSTOMIZATION_SURFACES)[number]
// `CustomizationSurface` 是定制面类型，取自 `CUSTOMIZATION_SURFACES` 联合类型的成员。

/**
 * Check whether a customization surface is locked to plugin-only sources
 * by the managed `strictPluginOnlyCustomization` policy.
 *
 * "Locked" means user-level (~/.claude/*) and project-level (.claude/*)
 * sources are skipped for that surface. Managed (policySettings) and
 * plugin-provided sources always load regardless — the policy is admin-set,
 * so managed sources are already admin-controlled, and plugins are gated
 * separately via `strictKnownMarketplaces`.
 *
 * `true` locks all four surfaces; array form locks only those listed.
 * Absent/undefined → nothing locked (the default).
 */
// `isRestrictedToPluginOnly` 判断某定制面是否被锁定为仅插件来源：`true` 锁定全部四个面，数组只锁定列出的面，缺省不锁定。
export function isRestrictedToPluginOnly(
  surface: CustomizationSurface,
): boolean {
  const policy =
    getSettingsForSource('policySettings')?.strictPluginOnlyCustomization
  if (policy === true) return true
  if (Array.isArray(policy)) return policy.includes(surface)
  return false
}

/**
 * Sources that bypass strictPluginOnlyCustomization. Admin-trusted because:
 *   plugin — gated separately by strictKnownMarketplaces
 *   policySettings — from managed settings, admin-controlled by definition
 *   built-in / builtin / bundled — ship with the CLI, not user-authored
 *
 * Everything else (userSettings, projectSettings, localSettings, flagSettings,
 * mcp, undefined) is user-controlled and blocked when the relevant surface
 * is locked. Covers both AgentDefinition.source ('built-in' with hyphen) and
 * Command.source ('builtin' no hyphen, plus 'bundled').
 */
// `ADMIN_TRUSTED_SOURCES` 是管理员可信来源集合：插件、受管设置、内置/打包来源即使面被锁定也照常加载。
const ADMIN_TRUSTED_SOURCES: ReadonlySet<string> = new Set([
  'plugin',
  'policySettings',
  'built-in',
  'builtin',
  'bundled',
])

/**
 * Whether a customization's source is admin-trusted under
 * strictPluginOnlyCustomization. Use this to gate frontmatter-hook
 * registration and similar per-item checks where the item carries a
 * source tag but the surface's filesystem loader already ran.
 *
 * Pattern at call sites:
 *   const allowed = !isRestrictedToPluginOnly(surface) || isSourceAdminTrusted(item.source)
 *   if (item.hooks && allowed) { register(...) }
 */
// `isSourceAdminTrusted` 判断某来源是否属于管理员可信来源，用于在按项检查时放宽锁定（如 frontmatter 钩子注册）。
export function isSourceAdminTrusted(source: string | undefined): boolean {
  return source !== undefined && ADMIN_TRUSTED_SOURCES.has(source)
}
