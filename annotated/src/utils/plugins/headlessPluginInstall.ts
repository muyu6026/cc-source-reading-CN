/**
 * Plugin installation for headless/CCR mode.
 *
 * This module provides plugin installation without AppState updates,
 * suitable for non-interactive environments like CCR.
 *
 * When CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE is enabled, plugins are stored as
 * ZIPs on a mounted volume. The storage layer (pluginLoader.ts) handles
 * ZIP creation on install and extraction on load transparently.
 */
// 本文件提供无界面（CCR）模式下的插件安装：不更新 AppState，适合非交互环境，
// 启用 ZIP 缓存时插件以压缩包形式存于挂载卷，加载层透明解包。

import { logEvent } from '../../services/analytics/index.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { withDiagnosticsTiming } from '../diagLogs.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import {
  clearMarketplacesCache,
  getDeclaredMarketplaces,
  registerSeedMarketplaces,
} from './marketplaceManager.js'
import { detectAndUninstallDelistedPlugins } from './pluginBlocklist.js'
import { clearPluginCache } from './pluginLoader.js'
import { reconcileMarketplaces } from './reconciler.js'
import {
  cleanupSessionPluginCache,
  getZipCacheMarketplacesDir,
  getZipCachePluginsDir,
  isMarketplaceSourceSupportedByZipCache,
  isPluginZipCacheEnabled,
} from './zipCache.js'
import { syncMarketplacesToZipCache } from './zipCacheAdapters.js'
// 引入安装所需的分析上报、清理注册、诊断计时与各类插件缓存/协调器依赖。

/**
 * Install plugins for headless/CCR mode.
 *
 * This is the headless equivalent of performBackgroundPluginInstallations(),
 * but without AppState updates (no UI to update in headless mode).
 *
 * @returns true if any plugins were installed (caller should refresh MCP)
 */
// installPluginsForHeadless 是无界面安装的入口，等价于带 UI 的后台安装但无状态更新，返回是否有插件变更。
export async function installPluginsForHeadless(): Promise<boolean> {
  const zipCacheMode = isPluginZipCacheEnabled()
  logForDebugging(
    `installPluginsForHeadless: starting${zipCacheMode ? ' (zip cache mode)' : ''}`,
  )

  // Register seed marketplaces (CLAUDE_CODE_PLUGIN_SEED_DIR) before diffing.
  // Idempotent; no-op if seed not configured. Without this, findMissingMarketplaces
  // would see seed entries as missing → clone → defeats seed's purpose.
  //
  // If registration changed state, clear caches so the early plugin-load pass
  // (which runs during CLI startup before this function) doesn't keep stale
  // "marketplace not found" results. Without this clear, a first-boot headless
  // run with a seed-cached plugin would show 0 plugin commands/agents/skills
  // in the init message even though the seed has everything.
  const seedChanged = await registerSeedMarketplaces()
  if (seedChanged) {
    clearMarketplacesCache()
    clearPluginCache('headlessPluginInstall: seed marketplaces registered')
  }
// 先注册种子市场再比对：幂等，若状态变化则清缓存，避免首启时种子里的插件在初始化消息中显示为零。

  // Ensure zip cache directory structure exists
  if (zipCacheMode) {
    await getFsImplementation().mkdir(getZipCacheMarketplacesDir())
    await getFsImplementation().mkdir(getZipCachePluginsDir())
  }

  // Declared now includes an implicit claude-plugins-official entry when any
  // enabled plugin references it (see getDeclaredMarketplaces). This routes
  // the official marketplace through the same reconciler path as any other —
  // which composes correctly with CLAUDE_CODE_PLUGIN_SEED_DIR: seed registers
  // it in known_marketplaces.json, reconciler diff sees it as upToDate, no clone.
  const declaredCount = Object.keys(getDeclaredMarketplaces()).length

  const metrics = {
    marketplaces_installed: 0,
    delisted_count: 0,
  }

  // Initialize from seedChanged so the caller (print.ts) calls
  // refreshPluginState() → clearCommandsCache/clearAgentDefinitionsCache
  // when seed registration added marketplaces. Without this, the caller
  // only refreshes when an actual plugin install happened.
  let pluginsChanged = seedChanged

// pluginsChanged 以种子是否变更初始化，保证调用方在种子新增市场时也能刷新插件状态。
  try {
    if (declaredCount === 0) {
      logForDebugging('installPluginsForHeadless: no marketplaces declared')
    } else {
      // Reconcile declared marketplaces (settings intent + implicit official)
      // with materialized state. Zip cache: skip unsupported source types.
      const reconcileResult = await withDiagnosticsTiming(
        'headless_marketplace_reconcile',
        () =>
          reconcileMarketplaces({
            skip: zipCacheMode
              ? (_name, source) =>
                  !isMarketplaceSourceSupportedByZipCache(source)
              : undefined,
            onProgress: event => {
              if (event.type === 'installed') {
                logForDebugging(
                  `installPluginsForHeadless: installed marketplace ${event.name}`,
                )
              } else if (event.type === 'failed') {
                logForDebugging(
                  `installPluginsForHeadless: failed to install marketplace ${event.name}: ${event.error}`,
                )
              }
            },
          }),
        r => ({
          installed_count: r.installed.length,
          updated_count: r.updated.length,
          failed_count: r.failed.length,
          skipped_count: r.skipped.length,
        }),
      )

      if (reconcileResult.skipped.length > 0) {
        logForDebugging(
          `installPluginsForHeadless: skipped ${reconcileResult.skipped.length} marketplace(s) unsupported by zip cache: ${reconcileResult.skipped.join(', ')}`,
        )
      }

      const marketplacesChanged =
        reconcileResult.installed.length + reconcileResult.updated.length

      // Clear caches so newly-installed marketplace plugins are discoverable.
      // Plugin caching is the loader's job — after caches clear, the caller's
      // refreshPluginState() → loadAllPlugins() will cache any missing plugins
      // from the newly-materialized marketplaces.
      if (marketplacesChanged > 0) {
        clearMarketplacesCache()
        clearPluginCache('headlessPluginInstall: marketplaces reconciled')
        pluginsChanged = true
      }

      metrics.marketplaces_installed = marketplacesChanged
    }
// 市场协调结果：有安装或更新则清缓存并标记变更，使新落地的市场插件可被发现。

    // Zip cache: save marketplace JSONs for offline access on ephemeral containers.
    // Runs unconditionally so that steady-state containers (all plugins installed)
    // still sync marketplace data that may have been cloned in a previous run.
    if (zipCacheMode) {
      await syncMarketplacesToZipCache()
    }
// ZIP 缓存模式无条件同步市场 JSON，保证稳态容器也能离线拿到上轮克隆的市场数据。

    // Delisting enforcement
    const newlyDelisted = await detectAndUninstallDelistedPlugins()
    metrics.delisted_count = newlyDelisted.length
    if (newlyDelisted.length > 0) {
      pluginsChanged = true
    }
// 下架强制：检测并卸载被下架的插件，有新增下架则标记插件已变更。

    if (pluginsChanged) {
      clearPluginCache('headlessPluginInstall: plugins changed')
    }
// 插件有变更时清安装缓存，触发调用方刷新；ZIP 模式下注册会话清理以回收解包临时目录。

    // Zip cache: register session cleanup for extracted plugin temp dirs
    if (zipCacheMode) {
      registerCleanup(cleanupSessionPluginCache)
    }

    return pluginsChanged
  } catch (error) {
    logError(error)
    return false
  } finally {
    logEvent('tengu_headless_plugin_install', metrics)
  }
}
// installPluginsForHeadless 收尾：最终上报安装指标，异常时记日志并返回假而不抛出。
