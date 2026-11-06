import { logEvent } from 'src/services/analytics/index.js'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

// 迁移：把 MCP 审批字段从工程配置挪到本地设置，统一管理更一致
/**
 * Migration: Move MCP server approval fields from project config to local settings
 * This migrates both enableAllProjectMcpServers and enabledMcpjsonServers to the
 * settings system for better management and consistency.
 */
// 迁移入口：先读工程配置，判断三类字段有没有值
export function migrateEnableAllProjectMcpServersToSettings(): void {
  const projectConfig = getCurrentProjectConfig()

  // Check if any field exists in project config
// 三个布尔分别探测：总开关、已启用列表、已禁用列表是否非空
  const hasEnableAll = projectConfig.enableAllProjectMcpServers !== undefined
  const hasEnabledServers =
    projectConfig.enabledMcpjsonServers &&
    projectConfig.enabledMcpjsonServers.length > 0
  const hasDisabledServers =
    projectConfig.disabledMcpjsonServers &&
    projectConfig.disabledMcpjsonServers.length > 0

// 三类都没有就直接返回，零成本跳过
  if (!hasEnableAll && !hasEnabledServers && !hasDisabledServers) {
    return
  }

  try {
// 读现有本地设置作为合并基底；字段已迁移过就只标记删除、不再重复写
    const existingSettings = getSettingsForSource('localSettings') || {}
    const updates: Partial<{
      enableAllProjectMcpServers: boolean
      enabledMcpjsonServers: string[]
      disabledMcpjsonServers: string[]
    }> = {}
    const fieldsToRemove: Array<
      | 'enableAllProjectMcpServers'
      | 'enabledMcpjsonServers'
      | 'disabledMcpjsonServers'
    > = []

    // Migrate enableAllProjectMcpServers if it exists and hasn't been migrated
// 总开关若存在且未迁移：写入设置并标记从工程配置移除
    if (
      hasEnableAll &&
      existingSettings.enableAllProjectMcpServers === undefined
    ) {
      updates.enableAllProjectMcpServers =
        projectConfig.enableAllProjectMcpServers
      fieldsToRemove.push('enableAllProjectMcpServers')
    } else if (hasEnableAll) {
      // Already migrated, just mark for removal
      fieldsToRemove.push('enableAllProjectMcpServers')
    }

    // Migrate enabledMcpjsonServers if it exists
// 已启用列表：用 Set 去重合并到现有设置，避免重复项
    if (hasEnabledServers && projectConfig.enabledMcpjsonServers) {
      const existingEnabledServers =
        existingSettings.enabledMcpjsonServers || []
      // Merge the servers (avoiding duplicates)
      updates.enabledMcpjsonServers = [
        ...new Set([
          ...existingEnabledServers,
          ...projectConfig.enabledMcpjsonServers,
        ]),
      ]
      fieldsToRemove.push('enabledMcpjsonServers')
    }

    // Migrate disabledMcpjsonServers if it exists
// 已禁用列表：同样去重合并
    if (hasDisabledServers && projectConfig.disabledMcpjsonServers) {
      const existingDisabledServers =
        existingSettings.disabledMcpjsonServers || []
      // Merge the servers (avoiding duplicates)
      updates.disabledMcpjsonServers = [
        ...new Set([
          ...existingDisabledServers,
          ...projectConfig.disabledMcpjsonServers,
        ]),
      ]
      fieldsToRemove.push('disabledMcpjsonServers')
    }

    // Update settings if there are any updates
// 有更新才写设置；否则只做工程配置侧的字段清理
    if (Object.keys(updates).length > 0) {
      updateSettingsForSource('localSettings', updates)
    }

    // Remove migrated fields from project config
// 把已迁移的字段从工程配置里摘掉，用对象解构把它们省略掉
    if (
      fieldsToRemove.includes('enableAllProjectMcpServers') ||
      fieldsToRemove.includes('enabledMcpjsonServers') ||
      fieldsToRemove.includes('disabledMcpjsonServers')
    ) {
      saveCurrentProjectConfig(current => {
        const {
          enableAllProjectMcpServers: _enableAll,
          enabledMcpjsonServers: _enabledServers,
          disabledMcpjsonServers: _disabledServers,
          ...configWithoutFields
        } = current
        return configWithoutFields
      })
    }

    // Log the migration event
// 成功打点：记录迁移了多少个字段
    logEvent('tengu_migrate_mcp_approval_fields_success', {
      migratedCount: fieldsToRemove.length,
    })
// 失败只记日志不抛错：迁移崩了不能影响启动
  } catch (e: unknown) {
    // Log migration failure but don't throw to avoid breaking startup
    logError(e)
    logEvent('tengu_migrate_mcp_approval_fields_error', {})
  }
}
