/**
 * Built-in Plugin Registry
 *
 * Manages built-in plugins that ship with the CLI and can be enabled/disabled
 * by users via the /plugin UI.
 *
 * Built-in plugins differ from bundled skills (src/skills/bundled/) in that:
 * - They appear in the /plugin UI under a "Built-in" section
 * - Users can enable/disable them (persisted to user settings)
 * - They can provide multiple components (skills, hooks, MCP servers)
 *
 * Plugin IDs use the format `{name}@builtin` to distinguish them from
 * marketplace plugins (`{name}@{marketplace}`).
 */

import type { Command } from '../commands.js'
import type { BundledSkillDefinition } from '../skills/bundledSkills.js'
import type { BuiltinPluginDefinition, LoadedPlugin } from '../types/plugin.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'

// 注册表用映射：同名内置插件后注册的覆盖先注册的
const BUILTIN_PLUGINS: Map<string, BuiltinPluginDefinition> = new Map()

// 内置市场的名字固定，插件标识因此形如 名字@builtin，与市场插件一眼可分
export const BUILTIN_MARKETPLACE_NAME = 'builtin'

/**
 * Register a built-in plugin. Call this from initBuiltinPlugins() at startup.
 */
// 注册入口只写不校验，定义完整性由调用方保证
export function registerBuiltinPlugin(
  definition: BuiltinPluginDefinition,
): void {
  BUILTIN_PLUGINS.set(definition.name, definition)
}

/**
 * Check if a plugin ID represents a built-in plugin (ends with @builtin).
 */
// 判定只看后缀：内置插件与市场插件的区分全靠这一段
export function isBuiltinPluginId(pluginId: string): boolean {
  return pluginId.endsWith(`@${BUILTIN_MARKETPLACE_NAME}`)
}

/**
 * Get a specific built-in plugin definition by name.
 * Useful for the /plugin UI to show the skills/hooks/MCP list without
 * a marketplace lookup.
 */
// 按名字直接取定义，给插件界面展示技能与钩子用，不必走市场查找
export function getBuiltinPluginDefinition(
  name: string,
): BuiltinPluginDefinition | undefined {
  return BUILTIN_PLUGINS.get(name)
}

/**
 * Get all registered built-in plugins as LoadedPlugin objects, split into
 * enabled/disabled based on user settings (with defaultEnabled as fallback).
 * Plugins whose isAvailable() returns false are omitted entirely.
 */
// 一次算出启用与禁用两栏：界面上两个分区都从这份结果取，避免各算一次各漏一处
export function getBuiltinPlugins(): {
  enabled: LoadedPlugin[]
  disabled: LoadedPlugin[]
} {
  const settings = getSettings_DEPRECATED()
  const enabled: LoadedPlugin[] = []
  const disabled: LoadedPlugin[] = []

// 不可用的插件整条略过，两栏都不进
  for (const [name, definition] of BUILTIN_PLUGINS) {
    if (definition.isAvailable && !definition.isAvailable()) {
      continue
    }

    const pluginId = `${name}@${BUILTIN_MARKETPLACE_NAME}`
    const userSetting = settings?.enabledPlugins?.[pluginId]
    // Enabled state: user preference > plugin default > true
// 三级优先：用户设置 > 插件默认 > 默认启用
    const isEnabled =
      userSetting !== undefined
        ? userSetting === true
        : (definition.defaultEnabled ?? true)

// 伪插件对象：路径填市场名当哨兵，表明它没有文件系统位置
    const plugin: LoadedPlugin = {
      name,
      manifest: {
        name,
        description: definition.description,
        version: definition.version,
      },
      path: BUILTIN_MARKETPLACE_NAME, // sentinel — no filesystem path
      source: pluginId,
      repository: pluginId,
      enabled: isEnabled,
      isBuiltin: true,
      hooksConfig: definition.hooks,
      mcpServers: definition.mcpServers,
    }

    if (isEnabled) {
      enabled.push(plugin)
    } else {
      disabled.push(plugin)
    }
  }

  return { enabled, disabled }
}

/**
 * Get skills from enabled built-in plugins as Command objects.
 * Skills from disabled plugins are not returned.
 */
// 只把启用插件的技能转成命令，禁用插件一条都不出
export function getBuiltinPluginSkillCommands(): Command[] {
  const { enabled } = getBuiltinPlugins()
  const commands: Command[] = []

  for (const plugin of enabled) {
// 从注册表再取一次定义：插件对象里并不带技能列表
    const definition = BUILTIN_PLUGINS.get(plugin.name)
    if (!definition?.skills) continue
    for (const skill of definition.skills) {
      commands.push(skillDefinitionToCommand(skill))
    }
  }

  return commands
}

/**
 * Clear built-in plugins registry (for testing).
 */
// 清空仅供测试使用，运行时没有注销单个插件的入口
export function clearBuiltinPlugins(): void {
  BUILTIN_PLUGINS.clear()
}

// --

// 技能定义转命令：字段几乎一一对应，两处刻意不同在下面
function skillDefinitionToCommand(definition: BundledSkillDefinition): Command {
  return {
    type: 'prompt',
    name: definition.name,
    description: definition.description,
    hasUserSpecifiedDescription: true,
    allowedTools: definition.allowedTools ?? [],
    argumentHint: definition.argumentHint,
    whenToUse: definition.whenToUse,
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation ?? false,
    userInvocable: definition.userInvocable ?? true,
    contentLength: 0,
    // 'bundled' not 'builtin' — 'builtin' in Command.source means hardcoded
    // slash commands (/help, /clear). Using 'bundled' keeps these skills in
    // the Skill tool's listing, analytics name logging, and prompt-truncation
    // exemption. The user-toggleable aspect is tracked on LoadedPlugin.isBuiltin.
// 来源写 bundled 而不是 builtin：后者在命令里专指硬编码斜杠命令，写成 builtin 会让这些技能掉出技能列表
    source: 'bundled',
    loadedFrom: 'bundled',
    hooks: definition.hooks,
    context: definition.context,
    agent: definition.agent,
    isEnabled: definition.isEnabled ?? (() => true),
    isHidden: !(definition.userInvocable ?? true),
    progressMessage: 'running',
    getPromptForCommand: definition.getPromptForCommand,
  }
}
