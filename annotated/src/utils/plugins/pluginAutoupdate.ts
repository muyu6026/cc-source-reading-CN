// 模块总览：插件后台自动更新。
// 启动时先刷新开启了自动更新的市场，再更新这些市场下与当前项目相关的已安装插件；
// 更新是非原地（仅落盘）的，需要重启才生效。官方市场默认开启自动更新，用户可按市场关闭。
/**
 * Background plugin autoupdate functionality
 *
 * At startup, this module:
 * 1. First updates marketplaces that have autoUpdate enabled
 * 2. Then checks all installed plugins from those marketplaces and updates them
 *
 * Updates are non-inplace (disk-only), requiring a restart to take effect.
 * Official Anthropic marketplaces have autoUpdate enabled by default,
 * but users can disable it per-marketplace.
 */

import { updatePluginOp } from '../../services/plugins/pluginOperations.js'
import { shouldSkipPluginAutoupdate } from '../config.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import {
  getPendingUpdatesDetails,
  hasPendingUpdates,
  isInstallationRelevantToCurrentProject,
  loadInstalledPluginsFromDisk,
} from './installedPluginsManager.js'
import {
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
  refreshMarketplace,
} from './marketplaceManager.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'
import { isMarketplaceAutoUpdate, type PluginScope } from './schemas.js'

/**
 * Callback type for notifying when plugins have been updated
 */
export type PluginAutoUpdateCallback = (updatedPlugins: string[]) => void

// Store callback for plugin update notifications
let pluginUpdateCallback: PluginAutoUpdateCallback | null = null

// Store pending updates that occurred before callback was registered
// This handles the race condition where updates complete before REPL mounts
let pendingNotification: string[] | null = null

/**
 * Register a callback to be notified when plugins are auto-updated.
 * This is used by the REPL to show restart notifications.
 *
 * If plugins were already updated before the callback was registered,
 * the callback will be invoked immediately with the pending updates.
 */
export function onPluginsAutoUpdated(
  callback: PluginAutoUpdateCallback,
): () => void {
  pluginUpdateCallback = callback

  // If there are pending updates that happened before registration, deliver them now
  if (pendingNotification !== null && pendingNotification.length > 0) {
    callback(pendingNotification)
    pendingNotification = null
  }

  return () => {
    pluginUpdateCallback = null
  }
}
// 注册自动更新完成回调：若回调登记前已有更新发生，立即把挂起的更新名单补发给回调，避免漏通知。

/**
 * Check if pending updates came from autoupdate (for notification purposes).
 * Returns the list of plugin names that have pending updates.
 */
export function getAutoUpdatedPluginNames(): string[] {
  if (!hasPendingUpdates()) {
    return []
  }
  return getPendingUpdatesDetails().map(
    d => parsePluginIdentifier(d.pluginId).name,
  )
}
// 取出待更新插件名列表：从待更新明细里解析出插件名，供界面展示。

/**
 * Get the set of marketplaces that have autoUpdate enabled.
 * Returns the marketplace names that should be auto-updated.
 */
async function getAutoUpdateEnabledMarketplaces(): Promise<Set<string>> {
  const config = await loadKnownMarketplacesConfig()
  const declared = getDeclaredMarketplaces()
  const enabled = new Set<string>()

  for (const [name, entry] of Object.entries(config)) {
    // Settings-declared autoUpdate takes precedence over JSON state
    const declaredAutoUpdate = declared[name]?.autoUpdate
    const autoUpdate =
      declaredAutoUpdate !== undefined
        ? declaredAutoUpdate
        : isMarketplaceAutoUpdate(name, entry)
    if (autoUpdate) {
      enabled.add(name.toLowerCase())
    }
  }

  return enabled
}
// 收集开启自动更新的市场名：设置里声明的 autoUpdate 优先于 JSON 状态里的判定，命中即加入集合。

/**
 * Update a single plugin's installations.
 * Returns the plugin ID if any installation was updated, null otherwise.
 */
async function updatePlugin(
  pluginId: string,
  installations: Array<{ scope: PluginScope; projectPath?: string }>,
): Promise<string | null> {
  let wasUpdated = false

  for (const { scope } of installations) {
    try {
      const result = await updatePluginOp(pluginId, scope)

      if (result.success && !result.alreadyUpToDate) {
        wasUpdated = true
        logForDebugging(
          `Plugin autoupdate: updated ${pluginId} from ${result.oldVersion} to ${result.newVersion}`,
        )
      } else if (!result.alreadyUpToDate) {
        logForDebugging(
          `Plugin autoupdate: failed to update ${pluginId}: ${result.message}`,
          { level: 'warn' },
        )
      }
    } catch (error) {
      logForDebugging(
        `Plugin autoupdate: error updating ${pluginId}: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }

  return wasUpdated ? pluginId : null
}
// 更新单个插件的各安装点：逐作用域调用更新操作，记录已更新或失败，全部成功才算该插件被更新。

/**
 * Update all project-relevant installed plugins from the given marketplaces.
 *
 * Iterates installed_plugins.json, filters to plugins whose marketplace is in
 * the set, further filters each plugin's installations to those relevant to
 * the current project (user/managed scope, or project/local scope matching
 * cwd — see isInstallationRelevantToCurrentProject), then calls updatePluginOp
 * per installation. Already-up-to-date plugins are silently skipped.
 *
 * Called by:
 * - updatePlugins() below — background autoupdate path (autoUpdate-enabled
 *   marketplaces only; third-party marketplaces default autoUpdate: false)
 * - ManageMarketplaces.tsx applyChanges() — user-initiated /plugin marketplace
 *   update. Before #29512 this path only called refreshMarketplace() (git
 *   pull on the marketplace clone), so the loader would create the new
 *   version cache dir but installed_plugins.json stayed on the old version,
 *   and the orphan GC stamped the NEW dir with .orphaned_at on next startup.
 *
 * @param marketplaceNames - lowercase marketplace names to update plugins from
 * @returns plugin IDs that were actually updated (not already up-to-date)
 */
export async function updatePluginsForMarketplaces(
  marketplaceNames: Set<string>,
): Promise<string[]> {
  const installedPlugins = loadInstalledPluginsFromDisk()
  const pluginIds = Object.keys(installedPlugins.plugins)

  if (pluginIds.length === 0) {
    return []
  }

  const results = await Promise.allSettled(
    pluginIds.map(async pluginId => {
      const { marketplace } = parsePluginIdentifier(pluginId)
      if (!marketplace || !marketplaceNames.has(marketplace.toLowerCase())) {
        return null
      }

      const allInstallations = installedPlugins.plugins[pluginId]
      if (!allInstallations || allInstallations.length === 0) {
        return null
      }

      const relevantInstallations = allInstallations.filter(
        isInstallationRelevantToCurrentProject,
      )
      if (relevantInstallations.length === 0) {
        return null
      }

      return updatePlugin(pluginId, relevantInstallations)
    }),
  )

  return results
    .filter(
      (r): r is PromiseFulfilledResult<string> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value)
}
// 按市场批量更新插件：遍历已安装插件，过滤出目标市场且与当前项目相关的安装点，聚合出真正被更新的插件标识。

/**
 * Update plugins from marketplaces that have autoUpdate enabled.
 * Returns the list of plugin IDs that were updated.
 */
async function updatePlugins(
  autoUpdateEnabledMarketplaces: Set<string>,
): Promise<string[]> {
  return updatePluginsForMarketplaces(autoUpdateEnabledMarketplaces)
}
// 内部薄封装：直接复用上面的按市场批量更新逻辑，作为自动更新路径的入口。

/**
 * Auto-update marketplaces and plugins in the background.
 *
 * This function:
 * 1. Checks which marketplaces have autoUpdate enabled
 * 2. Refreshes only those marketplaces (git pull/re-download)
 * 3. Updates installed plugins from those marketplaces
 * 4. If any plugins were updated, notifies via the registered callback
 *
 * Official Anthropic marketplaces have autoUpdate enabled by default,
 * but users can disable it per-marketplace in the UI.
 *
 * This function runs silently without blocking user interaction.
 * Called from main.tsx during startup as a background job.
 */
export function autoUpdateMarketplacesAndPluginsInBackground(): void {
  void (async () => {
    if (shouldSkipPluginAutoupdate()) {
      logForDebugging('Plugin autoupdate: skipped (auto-updater disabled)')
      return
    }

    try {
      // Get marketplaces with autoUpdate enabled
      const autoUpdateEnabledMarketplaces =
        await getAutoUpdateEnabledMarketplaces()

      if (autoUpdateEnabledMarketplaces.size === 0) {
        return
      }

      // Refresh only marketplaces with autoUpdate enabled
      const refreshResults = await Promise.allSettled(
        Array.from(autoUpdateEnabledMarketplaces).map(async name => {
          try {
            await refreshMarketplace(name, undefined, {
              disableCredentialHelper: true,
            })
          } catch (error) {
            logForDebugging(
              `Plugin autoupdate: failed to refresh marketplace ${name}: ${errorMessage(error)}`,
              { level: 'warn' },
            )
          }
        }),
      )

      // Log any refresh failures
      const failures = refreshResults.filter(r => r.status === 'rejected')
      if (failures.length > 0) {
        logForDebugging(
          `Plugin autoupdate: ${failures.length} marketplace refresh(es) failed`,
          { level: 'warn' },
        )
      }

      logForDebugging('Plugin autoupdate: checking installed plugins')
      const updatedPlugins = await updatePlugins(autoUpdateEnabledMarketplaces)

      if (updatedPlugins.length > 0) {
        if (pluginUpdateCallback) {
          // Callback is already registered, invoke it immediately
          pluginUpdateCallback(updatedPlugins)
        } else {
          // Callback not yet registered (REPL not mounted), store for later delivery
          pendingNotification = updatedPlugins
        }
      }
    } catch (error) {
      logError(error)
    }
  })()
}
// 后台自动更新入口：跳过开关关闭的情况，刷新目标市场后更新插件，若有更新则通过回调或挂起名单通知界面。
