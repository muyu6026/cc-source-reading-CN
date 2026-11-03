// 信任弹窗的「设置来源探测」工具集：判断各类权限或配置是否出现在 project/local 设置里，并把这些来源汇总成文件路径数组。
import type { PermissionRule } from 'src/utils/permissions/PermissionRule.js'
import { getSettingsForSource } from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { SAFE_ENV_VARS } from '../../utils/managedEnvConstants.js'
import { getPermissionRulesForSource } from '../../utils/permissions/permissionsLoader.js'

// hasHooks：判断一份设置是否启用了 hooks——排除 null 与 disableAllHooks，再检查 statusLine、fileSuggestion 或任意非空 hook 配置。
function hasHooks(settings: SettingsJson | null): boolean {
  if (settings === null || settings.disableAllHooks) {
    return false
  }
  if (settings.statusLine) {
    return true
  }
  if (settings.fileSuggestion) {
    return true
  }
  if (!settings.hooks) {
    return false
  }
  for (const hookConfig of Object.values(settings.hooks)) {
    if (hookConfig.length > 0) {
      return true
    }
  }
  return false
}

// getHooksSources：返回含 hooks 的设置来源路径（`.claude/settings.json` 与 `settings.local.json`）。
export function getHooksSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasHooks(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasHooks(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

// hasBashPermission：判断权限规则里是否有允许 Bash 工具的规则（精确名或以 `Bash(` 开头）。
function hasBashPermission(rules: PermissionRule[]): boolean {
  return rules.some(
    rule =>
      rule.ruleBehavior === 'allow' &&
      (rule.ruleValue.toolName === BASH_TOOL_NAME ||
        rule.ruleValue.toolName.startsWith(BASH_TOOL_NAME + '(')),
  )
}

/**
 * Get which setting sources have bash allow rules.
 * Returns an array of file paths that have bash permissions.
 */
// getBashPermissionSources：返回含 bash 放行规则的设置来源路径。
export function getBashPermissionSources(): string[] {
  const sources: string[] = []

  const projectRules = getPermissionRulesForSource('projectSettings')
  if (hasBashPermission(projectRules)) {
    sources.push('.claude/settings.json')
  }

  const localRules = getPermissionRulesForSource('localSettings')
  if (hasBashPermission(localRules)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Format a list of items with proper "and" conjunction.
 * @param items - Array of items to format
 * @param limit - Optional limit for how many items to show before summarizing (ignored if 0)
 */
// formatListWithAnd：把数组格式化成带 and 的英文列举串；limit 为 0 时忽略上限，超出则显示「… and N more」。
export function formatListWithAnd(items: string[], limit?: number): string {
  if (items.length === 0) return ''

  // Ignore limit if it's 0
  const effectiveLimit = limit === 0 ? undefined : limit

  // If no limit or items are within limit, use normal formatting
  if (!effectiveLimit || items.length <= effectiveLimit) {
    if (items.length === 1) return items[0]!
    if (items.length === 2) return `${items[0]} and ${items[1]}`

    const lastItem = items[items.length - 1]!
    const allButLast = items.slice(0, -1)
    return `${allButLast.join(', ')}, and ${lastItem}`
  }

  // If we have more items than the limit, show first few and count the rest
  const shown = items.slice(0, effectiveLimit)
  const remaining = items.length - effectiveLimit

  if (shown.length === 1) {
    return `${shown[0]} and ${remaining} more`
  }

  return `${shown.join(', ')}, and ${remaining} more`
}

/**
 * Check if settings have otelHeadersHelper configured
 */
// hasOtelHeadersHelper：判断设置是否配置了 otelHeadersHelper。
function hasOtelHeadersHelper(settings: SettingsJson | null): boolean {
  return !!settings?.otelHeadersHelper
}

/**
 * Get which setting sources have otelHeadersHelper configured.
 * Returns an array of file paths that have otelHeadersHelper.
 */
// getOtelHeadersHelperSources：返回含 otelHeadersHelper 的设置来源路径。
export function getOtelHeadersHelperSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasOtelHeadersHelper(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasOtelHeadersHelper(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have apiKeyHelper configured
 */
// hasApiKeyHelper：判断设置是否配置了 apiKeyHelper。
function hasApiKeyHelper(settings: SettingsJson | null): boolean {
  return !!settings?.apiKeyHelper
}

/**
 * Get which setting sources have apiKeyHelper configured.
 * Returns an array of file paths that have apiKeyHelper.
 */
// getApiKeyHelperSources：返回含 apiKeyHelper 的设置来源路径。
export function getApiKeyHelperSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasApiKeyHelper(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasApiKeyHelper(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have AWS commands configured
 */
// hasAwsCommands：判断设置是否配置了 awsAuthRefresh 或 awsCredentialExport。
function hasAwsCommands(settings: SettingsJson | null): boolean {
  return !!(settings?.awsAuthRefresh || settings?.awsCredentialExport)
}

/**
 * Get which setting sources have AWS commands configured.
 * Returns an array of file paths that have awsAuthRefresh or awsCredentialExport.
 */
// getAwsCommandsSources：返回含 aws 命令的设置来源路径。
export function getAwsCommandsSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasAwsCommands(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasAwsCommands(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have GCP commands configured
 */
// hasGcpCommands：判断设置是否配置了 gcpAuthRefresh。
function hasGcpCommands(settings: SettingsJson | null): boolean {
  return !!settings?.gcpAuthRefresh
}

/**
 * Get which setting sources have GCP commands configured.
 * Returns an array of file paths that have gcpAuthRefresh.
 */
// getGcpCommandsSources：返回含 gcp 命令的设置来源路径。
export function getGcpCommandsSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasGcpCommands(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasGcpCommands(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have dangerous environment variables configured.
 * Any env var NOT in SAFE_ENV_VARS is considered dangerous.
 */
// hasDangerousEnvVars：判断设置里是否存在不在 SAFE_ENV_VARS 中的环境变量（即危险变量）。
function hasDangerousEnvVars(settings: SettingsJson | null): boolean {
  if (!settings?.env) {
    return false
  }
  return Object.keys(settings.env).some(
    key => !SAFE_ENV_VARS.has(key.toUpperCase()),
  )
}

/**
 * Get which setting sources have dangerous environment variables configured.
 * Returns an array of file paths that have env vars not in SAFE_ENV_VARS.
 */
// getDangerousEnvVarsSources：返回含危险环境变量的设置来源路径。
export function getDangerousEnvVarsSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasDangerousEnvVars(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasDangerousEnvVars(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}
