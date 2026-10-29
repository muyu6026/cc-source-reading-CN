import { getAllowedSettingSources } from '../../bootstrap/state.js'

/**
 * All possible sources where settings can come from
 * Order matters - later sources override earlier ones
 */
export const SETTING_SOURCES = [
  // User settings (global)
  'userSettings',

  // Project settings (shared per-directory)
  'projectSettings',

  // Local settings (gitignored)
  'localSettings',

  // Flag settings (from --settings flag)
  'flagSettings',

  // Policy settings (managed-settings.json or remote settings from API)
  'policySettings',
] as const
// SETTING_SOURCES 列出配置来源，数组顺序即覆盖优先级：靠后的来源覆盖靠前的。

export type SettingSource = (typeof SETTING_SOURCES)[number]
// SettingSource 是由 SETTING_SOURCES 推导出的联合类型，保证二者始终同步。

export function getSettingSourceName(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
    case 'localSettings':
      return 'project, gitignored'
    case 'flagSettings':
      return 'cli flag'
    case 'policySettings':
      return 'managed'
  }
}
// getSettingSourceName 返回配置来源的内部短名，用于上下文与技能 UI 的展示。

/**
 * Get short display name for a setting source (capitalized, for context/skills UI)
 * @param source The setting source or 'plugin'/'built-in'
 * @returns Short capitalized display name like 'User', 'Project', 'Plugin'
 */
export function getSourceDisplayName(
  source: SettingSource | 'plugin' | 'built-in',
): string {
  switch (source) {
    case 'userSettings':
      return 'User'
    case 'projectSettings':
      return 'Project'
    case 'localSettings':
      return 'Local'
    case 'flagSettings':
      return 'Flag'
    case 'policySettings':
      return 'Managed'
    case 'plugin':
      return 'Plugin'
    case 'built-in':
      return 'Built-in'
  }
}
// getSourceDisplayName 返回配置来源的首字母大写短名，如 User、Project、Managed。

/**
 * Get display name for a setting or permission rule source (lowercase, for inline use)
 * @param source The setting source or permission rule source
 * @returns Display name for the source in lowercase
 */
export function getSettingSourceDisplayNameLowercase(
  source: SettingSource | 'cliArg' | 'command' | 'session',
): string {
  switch (source) {
    case 'userSettings':
      return 'user settings'
    case 'projectSettings':
      return 'shared project settings'
    case 'localSettings':
      return 'project local settings'
    case 'flagSettings':
      return 'command line arguments'
    case 'policySettings':
      return 'enterprise managed settings'
    case 'cliArg':
      return 'CLI argument'
    case 'command':
      return 'command configuration'
    case 'session':
      return 'current session'
  }
}
// getSettingSourceDisplayNameLowercase 返回全小写来源名，用于行内说明文案。

/**
 * Get display name for a setting or permission rule source (capitalized, for UI labels)
 * @param source The setting source or permission rule source
 * @returns Display name for the source with first letter capitalized
 */
export function getSettingSourceDisplayNameCapitalized(
  source: SettingSource | 'cliArg' | 'command' | 'session',
): string {
  switch (source) {
    case 'userSettings':
      return 'User settings'
    case 'projectSettings':
      return 'Shared project settings'
    case 'localSettings':
      return 'Project local settings'
    case 'flagSettings':
      return 'Command line arguments'
    case 'policySettings':
      return 'Enterprise managed settings'
    case 'cliArg':
      return 'CLI argument'
    case 'command':
      return 'Command configuration'
    case 'session':
      return 'Current session'
  }
}
// getSettingSourceDisplayNameCapitalized 返回首字母大写来源名，用于 UI 标签。

/**
 * Parse the --setting-sources CLI flag into SettingSource array
 * @param flag Comma-separated string like "user,project,local"
 * @returns Array of SettingSource values
 */
export function parseSettingSourcesFlag(flag: string): SettingSource[] {
  if (flag === '') return []

  const names = flag.split(',').map(s => s.trim())
  const result: SettingSource[] = []

  for (const name of names) {
    switch (name) {
      case 'user':
        result.push('userSettings')
        break
      case 'project':
        result.push('projectSettings')
        break
      case 'local':
        result.push('localSettings')
        break
      default:
        throw new Error(
          `Invalid setting source: ${name}. Valid options are: user, project, local`,
        )
    }
  }

  return result
}
// parseSettingSourcesFlag 把逗号分隔的命令行标志解析成 SettingSource 数组，非法值直接抛错。

/**
 * Get enabled setting sources with policy/flag always included
 * @returns Array of enabled SettingSource values
 */
export function getEnabledSettingSources(): SettingSource[] {
  const allowed = getAllowedSettingSources()

  // Always include policy and flag settings
  const result = new Set<SettingSource>(allowed)
  result.add('policySettings')
  result.add('flagSettings')
  return Array.from(result)
}
// getEnabledSettingSources 始终包含 policy 与 flag 来源，再并入用户允许的其他来源。

/**
 * Check if a specific source is enabled
 * @param source The source to check
 * @returns true if the source should be loaded
 */
export function isSettingSourceEnabled(source: SettingSource): boolean {
  const enabled = getEnabledSettingSources()
  return enabled.includes(source)
}
// isSettingSourceEnabled 判断某个来源是否应当被加载。

/**
 * Editable setting sources (excludes policySettings and flagSettings which are read-only)
 */
export type EditableSettingSource = Exclude<
  SettingSource,
  'policySettings' | 'flagSettings'
>
// EditableSettingSource 排除只读的 policy 与 flag 来源，仅保留用户可编辑的来源。

/**
 * List of sources where permission rules can be saved, in display order.
 * Used by permission-rule and hook-save UIs to present source options.
 */
export const SOURCES = [
  'localSettings',
  'projectSettings',
  'userSettings',
] as const satisfies readonly EditableSettingSource[]
// SOURCES 是权限规则与 hook 保存 UI 展示的来源顺序，限定为三个可编辑来源。

/**
 * The JSON Schema URL for Claude Code settings
 * You can edit the contents at https://github.com/SchemaStore/schemastore/blob/master/src/schemas/json/claude-code-settings.json
 */
export const CLAUDE_CODE_SETTINGS_SCHEMA_URL =
  'https://json.schemastore.org/claude-code-settings.json'
// CLAUDE_CODE_SETTINGS_SCHEMA_URL 指向 Claude Code 设置的 JSON Schema 地址，供编辑器校验。
