/**
 * LSP Plugin Recommendation Utility
 *
 * Scans installed marketplaces for LSP plugins and recommends plugins
 * based on file extensions, but ONLY when the LSP binary is already
 * installed on the system.
 *
 * Limitation: Can only detect LSP plugins that declare their servers
 * inline in the marketplace entry. Plugins with separate .lsp.json files
 * are not detectable until after installation.
 */

import { extname } from 'path'
import { isBinaryInstalled } from '../binaryCheck.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isPluginInstalled } from './installedPluginsManager.js'
import {
  getMarketplace,
  loadKnownMarketplacesConfig,
} from './marketplaceManager.js'
import {
  ALLOWED_OFFICIAL_MARKETPLACE_NAMES,
  type PluginMarketplaceEntry,
} from './schemas.js'

/**
 * LSP plugin recommendation returned to the caller
 */
export type LspPluginRecommendation = {
  pluginId: string // "plugin-name@marketplace-name"
  pluginName: string // Human-readable plugin name
  marketplaceName: string // Marketplace name
  description?: string // Plugin description
  isOfficial: boolean // From official marketplace?
  extensions: string[] // File extensions this plugin supports
  command: string // LSP server command (e.g., "typescript-language-server")
}
// `LspPluginRecommendation` 是返回给调用方的推荐结构。

// Maximum number of times user can ignore recommendations before we stop showing
const MAX_IGNORED_COUNT = 5
// `MAX_IGNORED_COUNT` 设定用户可忽略推荐的次数上限，超过则停止提示。

/**
 * Check if a marketplace is official (from Anthropic)
 */
function isOfficialMarketplace(name: string): boolean {
  return ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(name.toLowerCase())
}
// 判断市场是否官方（来自 Anthropic）以决定排序优先级。

/**
 * Internal type for LSP info extracted from plugin manifest
 */
type LspInfo = {
  extensions: Set<string>
  command: string
}

// `LspInfo` 内部类型：扩展名集合与 LSP 命令。
/**
 * Extract LSP info (extensions and command) from inline lspServers config.
 *
 * NOTE: Can only read inline configs, not external .lsp.json files.
 * String paths are skipped as they reference files only available after installation.
 *
 * @param lspServers - The lspServers field from PluginMarketplaceEntry
 * @returns LSP info with extensions and command, or null if not extractable
 */
function extractLspInfoFromManifest(
  lspServers: PluginMarketplaceEntry['lspServers'],
): LspInfo | null {
  if (!lspServers) {
    return null
  }

  // If it's a string path (e.g., "./.lsp.json"), we can't read it from marketplace
  if (typeof lspServers === 'string') {
// 字符串路径形式的 `lspServers` 无法从市场读取，直接跳过。
    logForDebugging(
      '[lspRecommendation] Skipping string path lspServers (not readable from marketplace)',
    )
    return null
  }

  // If it's an array, process each element
  if (Array.isArray(lspServers)) {
// 数组形式逐个尝试提取内联配置。
    for (const item of lspServers) {
      // Skip string paths in arrays
      if (typeof item === 'string') {
        continue
      }
      // Try to extract from inline config object
      const info = extractFromServerConfigRecord(item)
      if (info) {
        return info
      }
    }
    return null
  }

  // It's an inline config object: Record<string, LspServerConfig>
  return extractFromServerConfigRecord(lspServers)
}
// `extractLspInfoFromManifest` 只读取内联配置，无法处理独立 `.lsp.json`。

/**
 * Extract LSP info from a server config record (inline object format)
 */
/**
 * Type guard to check if a value is a record object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
// `isRecord` 类型守卫，判断值是否为普通对象。
  return typeof value === 'object' && value !== null
}

function extractFromServerConfigRecord(
  serverConfigs: Record<string, unknown>,
): LspInfo | null {
  const extensions = new Set<string>()
  let command: string | null = null

  for (const [_serverName, config] of Object.entries(serverConfigs)) {
    if (!isRecord(config)) {
      continue
    }

    // Get command from first valid server config
    if (!command && typeof config.command === 'string') {
      command = config.command
    }

    // Collect all extensions from extensionToLanguage mapping
    const extMapping = config.extensionToLanguage
    if (isRecord(extMapping)) {
      for (const ext of Object.keys(extMapping)) {
        extensions.add(ext.toLowerCase())
      }
    }
  }

  if (!command || extensions.size === 0) {
    return null
  }

  return { extensions, command }
// 从内联配置记录中提取首个命令与全部扩展名。
}

/**
 * Internal type for plugin with LSP info
 */
type LspPluginInfo = {
  entry: PluginMarketplaceEntry
  marketplaceName: string
  extensions: Set<string>
  command: string
  isOfficial: boolean
}

/**
 * Get all LSP plugins from all installed marketplaces
 *
 * @returns Map of pluginId to plugin info with LSP metadata
 */
async function getLspPluginsFromMarketplaces(): Promise<
// `getLspPluginsFromMarketplaces` 异步汇总所有已装市场的 LSP 插件。
  Map<string, LspPluginInfo>
> {
  const result = new Map<string, LspPluginInfo>()

  try {
    const config = await loadKnownMarketplacesConfig()

    for (const marketplaceName of Object.keys(config)) {
      try {
        const marketplace = await getMarketplace(marketplaceName)
        const isOfficial = isOfficialMarketplace(marketplaceName)
// 遍历每个市场插件，提取 LSP 信息并构建记录。

        for (const entry of marketplace.plugins) {
          // Skip plugins without lspServers
          if (!entry.lspServers) {
            continue
          }

          const lspInfo = extractLspInfoFromManifest(entry.lspServers)
          if (!lspInfo) {
            continue
          }

          const pluginId = `${entry.name}@${marketplaceName}`
// 用 `name@marketplace` 构造插件 ID 作为映射键。
          result.set(pluginId, {
            entry,
            marketplaceName,
            extensions: lspInfo.extensions,
            command: lspInfo.command,
            isOfficial,
          })
        }
      } catch (error) {
        logForDebugging(
          `[lspRecommendation] Failed to load marketplace ${marketplaceName}: ${error}`,
        )
      }
    }
  } catch (error) {
    logForDebugging(
      `[lspRecommendation] Failed to load marketplaces config: ${error}`,
    )
  }

  return result
}
// 汇总函数结束，返回插件 ID 到信息的映射。

/**
 * Find matching LSP plugins for a file path.
 *
 * Returns recommendations for plugins that:
 * 1. Support the file's extension
 * 2. Have their LSP binary installed on the system
 * 3. Are not already installed
 * 4. Are not in the user's "never suggest" list
 *
 * Results are sorted with official marketplace plugins first.
 *
 * @param filePath - Path to the file to find LSP plugins for
 * @returns Array of matching plugin recommendations (empty if none or disabled)
 */
export async function getMatchingLspPlugins(
// `getMatchingLspPlugins` 主函数：为某文件路径匹配推荐插件。
  filePath: string,
): Promise<LspPluginRecommendation[]> {
  // Check if globally disabled
  if (isLspRecommendationsDisabled()) {
    logForDebugging('[lspRecommendation] Recommendations are disabled')
    return []
  }
// 全局禁用推荐时直接返回空列表。

  // Extract file extension
  const ext = extname(filePath).toLowerCase()
  if (!ext) {
    logForDebugging('[lspRecommendation] No file extension found')
    return []
  }
// 无法提取文件扩展名时返回空列表。

  logForDebugging(`[lspRecommendation] Looking for LSP plugins for ${ext}`)

  // Get all LSP plugins from marketplaces
  const allLspPlugins = await getLspPluginsFromMarketplaces()
// 拉取所有市场的 LSP 插件。

  // Get config for filtering
  const config = getGlobalConfig()
  const neverPlugins = config.lspRecommendationNeverPlugins ?? []
// 读取全局配置中的「永不推荐」列表。

  // Filter to matching plugins
  const matchingPlugins: Array<{ info: LspPluginInfo; pluginId: string }> = []

  for (const [pluginId, info] of allLspPlugins) {
// 跳过未声明 `lspServers` 的插件。
    // Check extension match
    if (!info.extensions.has(ext)) {
      continue
    }

    // Filter: not in "never" list
    if (neverPlugins.includes(pluginId)) {
      logForDebugging(
        `[lspRecommendation] Skipping ${pluginId} (in never suggest list)`,
      )
      continue
    }

    // Filter: not already installed
    if (isPluginInstalled(pluginId)) {
      logForDebugging(
        `[lspRecommendation] Skipping ${pluginId} (already installed)`,
      )
      continue
    }

    matchingPlugins.push({ info, pluginId })
  }
// 过滤：扩展名命中、不在永不列表、且尚未安装。

  // Filter: binary must be installed (async check)
  const pluginsWithBinary: Array<{ info: LspPluginInfo; pluginId: string }> = []

  for (const { info, pluginId } of matchingPlugins) {
    const binaryExists = await isBinaryInstalled(info.command)
    if (binaryExists) {
      pluginsWithBinary.push({ info, pluginId })
      logForDebugging(
        `[lspRecommendation] Binary '${info.command}' found for ${pluginId}`,
      )
    } else {
      logForDebugging(
        `[lspRecommendation] Skipping ${pluginId} (binary '${info.command}' not found)`,
      )
    }
  }
// 再过滤：仅保留系统已安装对应 LSP 二进制的插件。

  // Sort: official marketplaces first
  pluginsWithBinary.sort((a, b) => {
    if (a.info.isOfficial && !b.info.isOfficial) return -1
    if (!a.info.isOfficial && b.info.isOfficial) return 1
    return 0
  })

// 排序：官方市场插件排在前面。
  // Convert to recommendations
  return pluginsWithBinary.map(({ info, pluginId }) => ({
    pluginId,
    pluginName: info.entry.name,
    marketplaceName: info.marketplaceName,
    description: info.entry.description,
    isOfficial: info.isOfficial,
    extensions: Array.from(info.extensions),
    command: info.command,
  }))
// 映射为对外推荐结构并返回。
}

/**
 * Add a plugin to the "never suggest" list
 *
 * @param pluginId - Plugin ID to never suggest again
 */
export function addToNeverSuggest(pluginId: string): void {
// `addToNeverSuggest` 把插件加入永不推荐列表。
  saveGlobalConfig(currentConfig => {
    const current = currentConfig.lspRecommendationNeverPlugins ?? []
    if (current.includes(pluginId)) {
      return currentConfig
    }
    return {
      ...currentConfig,
      lspRecommendationNeverPlugins: [...current, pluginId],
    }
  })
  logForDebugging(`[lspRecommendation] Added ${pluginId} to never suggest`)
// 记录已加入永不推荐列表。
}

/**
 * Increment the ignored recommendation count.
 * After MAX_IGNORED_COUNT ignores, recommendations are disabled.
 */
export function incrementIgnoredCount(): void {
// `incrementIgnoredCount` 忽略计数加一。
  saveGlobalConfig(currentConfig => {
    const newCount = (currentConfig.lspRecommendationIgnoredCount ?? 0) + 1
    return {
      ...currentConfig,
      lspRecommendationIgnoredCount: newCount,
    }
  })
  logForDebugging('[lspRecommendation] Incremented ignored count')
}
// 记录忽略计数已增加。

/**
 * Check if LSP recommendations are disabled.
 * Disabled when:
 * - User explicitly disabled via config
 * - User has ignored MAX_IGNORED_COUNT recommendations
 */
export function isLspRecommendationsDisabled(): boolean {
  const config = getGlobalConfig()
  return (
    config.lspRecommendationDisabled === true ||
    (config.lspRecommendationIgnoredCount ?? 0) >= MAX_IGNORED_COUNT
  )
}
// `isLspRecommendationsDisabled` 判断推荐是否应禁用（显式关闭或忽略达上限）。

/**
 * Reset the ignored count (useful if user re-enables recommendations)
 */
export function resetIgnoredCount(): void {
  saveGlobalConfig(currentConfig => {
    const currentCount = currentConfig.lspRecommendationIgnoredCount ?? 0
    if (currentCount === 0) {
      return currentConfig
    }
    return {
      ...currentConfig,
      lspRecommendationIgnoredCount: 0,
    }
  })
  logForDebugging('[lspRecommendation] Reset ignored count')
}
// `resetIgnoredCount` 重置忽略计数，便于用户重新开启推荐。
