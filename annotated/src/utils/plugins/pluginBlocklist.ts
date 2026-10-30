/**
 * Plugin delisting detection.
 *
 * Compares installed plugins against marketplace manifests to find plugins
 * that have been removed, and auto-uninstalls them.
 *
 * The security.json fetch was removed (see #25447) — ~29.5M/week GitHub hits
 * for UI reason/text only. If re-introduced, serve from downloads.claude.ai.
 */
// 插件「下架」检测——对比已安装插件与各个市场的 manifest，找出已被市场移除的插件并自动卸载。security.json 的拉取已移除（见 #25447），因为纯 UI 文案每周约 29.5M 次 GitHub 命中。

import { uninstallPluginOp } from '../../services/plugins/pluginOperations.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { loadInstalledPluginsV2 } from './installedPluginsManager.js'
import {
  getMarketplace,
  loadKnownMarketplacesConfigSafe,
} from './marketplaceManager.js'
import {
  addFlaggedPlugin,
  getFlaggedPlugins,
  loadFlaggedPlugins,
} from './pluginFlagging.js'
import type { InstalledPluginsFileV2, PluginMarketplace } from './schemas.js'
// 依赖：卸载操作、调试日志、错误处理、已安装插件读取、市场读取、标记/查询下架插件等。

/**
 * Detect plugins installed from a marketplace that are no longer listed there.
 *
 * @param installedPlugins All installed plugins
 * @param marketplace The marketplace to check against
 * @param marketplaceName The marketplace name suffix (e.g. "claude-plugins-official")
 * @returns List of delisted plugin IDs in "name@marketplace" format
 */
export function detectDelistedPlugins(
  installedPlugins: InstalledPluginsFileV2,
  marketplace: PluginMarketplace,
  marketplaceName: string,
): string[] {
// 检测从某市场安装、但已不在该市场列表中的插件，返回 「name@marketplace」 格式的下架 ID 列表。
  const marketplacePluginNames = new Set(marketplace.plugins.map(p => p.name))
  const suffix = `@${marketplaceName}`

  const delisted: string[] = []
  for (const pluginId of Object.keys(installedPlugins.plugins)) {
// 遍历已安装插件，只关心带该市场后缀的。
    if (!pluginId.endsWith(suffix)) continue

    const pluginName = pluginId.slice(0, -suffix.length)
    if (!marketplacePluginNames.has(pluginName)) {
      delisted.push(pluginId)
    }
  }

  return delisted
}

/**
 * Detect delisted plugins across all marketplaces, auto-uninstall them,
 * and record them as flagged.
 *
 * This is the core delisting enforcement logic, shared between interactive
 * mode (useManagePlugins) and headless mode (main.tsx print path).
 *
 * @returns List of newly flagged plugin IDs
 */
// 跨所有市场检测下架插件、自动卸载并标记为 flagged；是下架强制逻辑的核心，交互模式（useManagePlugins）与无头模式（main.tsx print 路径）共用。
export async function detectAndUninstallDelistedPlugins(): Promise<string[]> {
  await loadFlaggedPlugins()
// 先加载已有的 flagged 记录。

  const installedPlugins = loadInstalledPluginsV2()
  const alreadyFlagged = getFlaggedPlugins()
// 只读地加载已知市场配置（Safe 变体，损坏的配置不会在此抛出，以免连带让 loadAllPlugins 的容错失效）。
  // Read-only iteration — Safe variant so a corrupted config doesn't throw
  // out of this function (it's called in the same try-block as loadAllPlugins
  // in useManagePlugins, so a throw here would void loadAllPlugins' resilience).
  const knownMarketplaces = await loadKnownMarketplacesConfigSafe()
  const newlyFlagged: string[] = []

  for (const marketplaceName of Object.keys(knownMarketplaces)) {
// 遍历所有已知市场逐个检查。
    try {
      const marketplace = await getMarketplace(marketplaceName)

      if (!marketplace.forceRemoveDeletedPlugins) continue
// 仅当市场配置了 forceRemoveDeletedPlugins 才执行下架清理。

      const delisted = detectDelistedPlugins(
        installedPlugins,
        marketplace,
        marketplaceName,
      )

      for (const pluginId of delisted) {
        if (pluginId in alreadyFlagged) continue

        // Skip managed-only plugins — enterprise admin should handle those
// 跳过纯 managed 插件——企业管理员应自行处理，不在此自动卸载。
        const installations = installedPlugins.plugins[pluginId] ?? []
        const hasUserInstall = installations.some(
          i =>
            i.scope === 'user' || i.scope === 'project' || i.scope === 'local',
        )
        if (!hasUserInstall) continue

        // Auto-uninstall the delisted plugin from all user-controllable scopes
// 从所有用户可控的安装范围（user/project/local）自动卸载下架插件。
        for (const installation of installations) {
          const { scope } = installation
          if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
            continue
          }
          try {
            await uninstallPluginOp(pluginId, scope)
          } catch (error) {
            logForDebugging(
              `Failed to auto-uninstall delisted plugin ${pluginId} from ${scope}: ${errorMessage(error)}`,
              { level: 'error' },
            )
          }
        }

        await addFlaggedPlugin(pluginId)
// 卸载后把该插件加入 flagged 列表，避免重复处理。
        newlyFlagged.push(pluginId)
      }
    } catch (error) {
// 市场可能尚未就绪——记日志并继续下一个，不中断整体流程。
      // Marketplace may not be available yet — log and continue
      logForDebugging(
        `Failed to check for delisted plugins in "${marketplaceName}": ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }

  return newlyFlagged
}
