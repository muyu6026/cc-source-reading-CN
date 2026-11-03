import {
  DANGEROUS_SHELL_SETTINGS,
  SAFE_ENV_VARS,
} from '../../utils/managedEnvConstants.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { jsonStringify } from '../../utils/slowOperations.js'

type DangerousShellSetting = (typeof DANGEROUS_SHELL_SETTINGS)[number]
// 从危险 shell 设置常量推导出成员类型，保证后续只用常量里的键

// 危险设置的聚合结构：危险 shell 设置、不在白名单的环境变量、是否含 hooks
export type DangerousSettings = {
  shellSettings: Partial<Record<DangerousShellSetting, string>>
  envVars: Record<string, string>
  hasHooks: boolean
  hooks?: unknown
}

/**
 * Extract dangerous settings from a settings object.
 *
 * Dangerous env vars are determined by checking against SAFE_ENV_VARS -
 * any env var NOT in SAFE_ENV_VARS is considered dangerous.
 * See managedEnv.ts for the authoritative list and threat categories.
 */
// 从 settings 抽取危险设置：空对象直接返回全空结构，避免上层判空
export function extractDangerousSettings(
  settings: SettingsJson | null | undefined,
): DangerousSettings {
  if (!settings) {
    return {
      shellSettings: {},
      envVars: {},
      hasHooks: false,
    }
  }

  // Extract dangerous shell settings
  const shellSettings: Partial<Record<DangerousShellSetting, string>> = {}
  for (const key of DANGEROUS_SHELL_SETTINGS) {
// 遍历危险 shell 设置常量，只保留有非空字符串值的项
    const value = settings[key]
    if (typeof value === 'string' && value.length > 0) {
      shellSettings[key] = value
    }
  }

  // Extract dangerous env vars - any var NOT in SAFE_ENV_VARS is dangerous
  const envVars: Record<string, string> = {}
  if (settings.env && typeof settings.env === 'object') {
    for (const [key, value] of Object.entries(settings.env)) {
      if (typeof value === 'string' && value.length > 0) {
        // Check if this env var is NOT in the safe list
        if (!SAFE_ENV_VARS.has(key.toUpperCase())) {
// 环境变量是否危险以「不在安全白名单」为准：把键转大写后查 SAFE_ENV_VARS 集合
          envVars[key] = value
        }
      }
    }
  }

  // Check for hooks
  const hasHooks =
    settings.hooks !== undefined &&
    settings.hooks !== null &&
    typeof settings.hooks === 'object' &&
    Object.keys(settings.hooks).length > 0
// 是否有 hooks：存在、非空对象且键数大于 0 才算

  return {
    shellSettings,
    envVars,
    hasHooks,
    hooks: hasHooks ? settings.hooks : undefined,
  }
}

/**
 * Check if settings contain any dangerous settings
 */
// 判断是否含任何危险设置：任一类别非空即为真
export function hasDangerousSettings(dangerous: DangerousSettings): boolean {
  return (
    Object.keys(dangerous.shellSettings).length > 0 ||
    Object.keys(dangerous.envVars).length > 0 ||
    dangerous.hasHooks
  )
}

/**
 * Compare two sets of dangerous settings to see if the new settings
 * have changed or added dangerous settings compared to the old settings
 */
// 比较新旧设置：仅当危险设置发生变化（新增或改动）才需要重新弹确认框
export function hasDangerousSettingsChanged(
  oldSettings: SettingsJson | null | undefined,
  newSettings: SettingsJson | null | undefined,
): boolean {
  const oldDangerous = extractDangerousSettings(oldSettings)
  const newDangerous = extractDangerousSettings(newSettings)

  // If new settings don't have any dangerous settings, no prompt needed
  if (!hasDangerousSettings(newDangerous)) {
    return false
  }

  // If old settings didn't have dangerous settings but new does, prompt needed
  if (!hasDangerousSettings(oldDangerous)) {
    return true
  }

  // Compare the dangerous settings - any change triggers a prompt
  const oldJson = jsonStringify({
// 把新旧危险设置序列化成 JSON 再比较字符串，任一不同即视为变化
    shellSettings: oldDangerous.shellSettings,
    envVars: oldDangerous.envVars,
    hooks: oldDangerous.hooks,
  })
  const newJson = jsonStringify({
    shellSettings: newDangerous.shellSettings,
    envVars: newDangerous.envVars,
    hooks: newDangerous.hooks,
  })

  return oldJson !== newJson
}

/**
 * Format dangerous settings as a human-readable list for the UI
 * Only returns setting names, not values
 */
// 格式化为展示用的名称列表（只列名称不列值）：shell 设置、环境变量、hooks 三类依次追加
export function formatDangerousSettingsList(
  dangerous: DangerousSettings,
): string[] {
  const items: string[] = []

  // Shell settings (names only)
  for (const key of Object.keys(dangerous.shellSettings)) {
    items.push(key)
  }

  // Env vars (names only)
  for (const key of Object.keys(dangerous.envVars)) {
    items.push(key)
  }

  // Hooks
  if (dangerous.hasHooks) {
    items.push('hooks')
  }

  return items
}
