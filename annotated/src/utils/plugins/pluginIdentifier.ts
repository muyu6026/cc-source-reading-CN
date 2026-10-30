import type {
  EditableSettingSource,
  SettingSource,
} from '../settings/constants.js'
import {
  ALLOWED_OFFICIAL_MARKETPLACE_NAMES,
  type PluginScope,
} from './schemas.js'
// 插件标识符与来源映射：负责解析「name@marketplace」形式的插件标识，并在插件作用域（scope）与可编辑设置来源（SettingSource）之间双向映射。

/**
 * Extended scope type that includes 'flag' for session-only plugins.
 * 'flag' scope is NOT persisted to installed_plugins.json.
 */
export type ExtendedPluginScope = PluginScope | 'flag'
// ExtendedPluginScope：在基础作用域之上增加「flag」，表示仅当前会话生效、不持久化到 installed_plugins.json 的插件。

/**
 * Scopes that are persisted to installed_plugins.json.
 * Excludes 'flag' which is session-only.
 */
export type PersistablePluginScope = Exclude<ExtendedPluginScope, 'flag'>
// PersistablePluginScope：从扩展作用域中排除 flag，得到可持久化的作用域集合。

/**
 * Map from SettingSource to plugin scope.
 * Note: flagSettings maps to 'flag' which is session-only and not persisted.
 */
export const SETTING_SOURCE_TO_SCOPE = {
  policySettings: 'managed',
  userSettings: 'user',
  projectSettings: 'project',
  localSettings: 'local',
  flagSettings: 'flag',
} as const satisfies Record<SettingSource, ExtendedPluginScope>

// SETTING_SOURCE_TO_SCOPE：把各类设置来源映射到插件作用域，用 satisfies 保证类型完备且单一来源。
/**
 * Parsed plugin identifier with name and optional marketplace
 */
export type ParsedPluginIdentifier = {
  name: string
  marketplace?: string
}

// ParsedPluginIdentifier：解析后的插件标识结构，包含 name 与可选的 marketplace。
/**
 * Parse a plugin identifier string into name and marketplace components
 * @param plugin The plugin identifier (name or name@marketplace)
 * @returns Parsed plugin name and optional marketplace
 *
 * Note: Only the first '@' is used as separator. If the input contains multiple '@' symbols
 * (e.g., "plugin@market@place"), everything after the second '@' is ignored.
 * This is intentional as marketplace names should not contain '@'.
 */
export function parsePluginIdentifier(plugin: string): ParsedPluginIdentifier {
  if (plugin.includes('@')) {
    const parts = plugin.split('@')
    return { name: parts[0] || '', marketplace: parts[1] }
  }
  return { name: plugin }
}
// parsePluginIdentifier：按第一个「@」拆分插件标识为名称与来源；多个「@」时后续部分忽略（来源名不应含「@」）。

/**
 * Build a plugin ID from name and marketplace
 * @param name The plugin name
 * @param marketplace Optional marketplace name
 * @returns Plugin ID in format "name" or "name@marketplace"
 */
export function buildPluginId(name: string, marketplace?: string): string {
  return marketplace ? `${name}@${marketplace}` : name
}
// buildPluginId：把名称与来源拼回「name@marketplace」格式的插件 ID。

/**
 * Check if a marketplace name is an official (Anthropic-controlled) marketplace.
 * Used for telemetry redaction — official plugin identifiers are safe to log to
 * general-access additional_metadata; third-party identifiers go only to the
 * PII-tagged _PROTO_* BQ columns.
 */
export function isOfficialMarketplaceName(
  marketplace: string | undefined,
): boolean {
  return (
    marketplace !== undefined &&
    ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(marketplace.toLowerCase())
  )
}
// isOfficialMarketplaceName：判断来源名是否为官方（Anthropic 控制）市场，用于遥测脱敏——官方标识可进通用字段，第三方进 PII 标记列。

/**
 * Map from installable plugin scope to editable setting source.
 * This is the inverse of SETTING_SOURCE_TO_SCOPE for editable scopes only.
 * Note: 'managed' scope cannot be installed to, so it's not included here.
 */
const SCOPE_TO_EDITABLE_SOURCE: Record<
  Exclude<PluginScope, 'managed'>,
  EditableSettingSource
> = {
  user: 'userSettings',
  project: 'projectSettings',
  local: 'localSettings',
}
// SCOPE_TO_EDITABLE_SOURCE：可编辑作用域到可写设置来源的反向映射，不含 managed（托管作用域不可安装）。

/**
 * Convert a plugin scope to its corresponding editable setting source
 * @param scope The plugin installation scope
 * @returns The corresponding setting source for reading/writing settings
 * @throws Error if scope is 'managed' (cannot install plugins to managed scope)
 */
export function scopeToSettingSource(
  scope: PluginScope,
): EditableSettingSource {
  if (scope === 'managed') {
    throw new Error('Cannot install plugins to managed scope')
  }
  return SCOPE_TO_EDITABLE_SOURCE[scope]
}
// scopeToSettingSource：把插件作用域转换成对应的可编辑设置来源；遇到 managed 抛错，因为托管作用域不能安装插件。

/**
 * Convert an editable setting source to its corresponding plugin scope.
 * Derived from SETTING_SOURCE_TO_SCOPE to maintain a single source of truth.
 * @param source The setting source
 * @returns The corresponding plugin scope
 */
export function settingSourceToScope(
  source: EditableSettingSource,
): Exclude<PluginScope, 'managed'> {
  return SETTING_SOURCE_TO_SCOPE[source] as Exclude<PluginScope, 'managed'>
}
// settingSourceToScope：把可编辑设置来源转换回插件作用域，与 SETTING_SOURCE_TO_SCOPE 保持一致。
