/**
 * Background plugin and marketplace installation manager
 *
 * This module handles automatic installation of plugins and marketplaces
 * from trusted sources (repository and user settings) without blocking startup.
 */

import type { AppState } from '../../state/AppState.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { logError } from '../../utils/log.js'
import {
  clearMarketplacesCache,
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
} from '../../utils/plugins/marketplaceManager.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import {
  diffMarketplaces,
  reconcileMarketplaces,
} from '../../utils/plugins/reconciler.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { logEvent } from '../analytics/index.js'

type SetAppState = (f: (prevState: AppState) => AppState) => void

/**
 * Update marketplace installation status in app state
 */
function updateMarketplaceStatus(
  setAppState: SetAppState,
  name: string,
  status: 'pending' | 'installing' | 'installed' | 'failed',
  error?: string,
): void {
// updateMarketplaceStatus：把某个市场的安装状态写进 AppState。用函数式更新（prevState => ...）保证并发 setState 不互相覆盖——React/ink 的 AppState 更新范式。
  setAppState(prevState => ({
    ...prevState,
    plugins: {
      ...prevState.plugins,
      installationStatus: {
        ...prevState.plugins.installationStatus,
        marketplaces: prevState.plugins.installationStatus.marketplaces.map(
          m => (m.name === name ? { ...m, status, error } : m),
        ),
      },
    },
  }))
}

/**
 * Perform background plugin startup checks and installations.
 *
 * This is a thin wrapper around reconcileMarketplaces() that maps onProgress
 * events to AppState updates for the REPL UI. After marketplaces are
 * reconciled:
 * - New installs → auto-refresh plugins (fixes "plugin-not-found" errors
 *   from the initial cache-only load on fresh homespace/cleared cache)
 * - Updates only → set needsRefresh, show notification for /reload-plugins
 */
export async function performBackgroundPluginInstallations(
  setAppState: SetAppState,
): Promise<void> {
// performBackgroundPluginInstallations：启动时的后台安装入口。职责是「从受信来源（仓库设置 + 用户设置）自动装声明了的市场和插件，且不阻塞启动」。它是 reconcileMarketplaces 的薄包装，真正干活的是 reconciler；这里只负责把 onProgress 事件映射成 REPL UI 能看的状态。
  logForDebugging('performBackgroundPluginInstallations called')

  try {
    // Compute diff upfront for initial UI status (pending spinners)
    const declared = getDeclaredMarketplaces()
    const materialized = await loadKnownMarketplacesConfig().catch(() => ({}))
    const diff = diffMarketplaces(declared, materialized)

    const pendingNames = [
      ...diff.missing,
      ...diff.sourceChanged.map(c => c.name),
    ]
// pendingNames = 缺失的市场 + 源变了的市场。diff 是「声明 vs 已物化」的比对：missing 是声明了但没装的，sourceChanged 是装过但源地址变了的（要重装）。先算 diff 是为了让 UI 一开始就能显示 pending 转圈，而不是等 reconcile 跑起来才有反馈。

    // Initialize AppState with pending status. No per-plugin pending status —
    // plugin load is fast (cache hit or local copy); marketplace clone is the
    // slow part worth showing progress for.
    setAppState(prev => ({
      ...prev,
      plugins: {
        ...prev.plugins,
        installationStatus: {
          marketplaces: pendingNames.map(name => ({
            name,
            status: 'pending' as const,
          })),
          plugins: [],
        },
      },
    }))

    if (pendingNames.length === 0) {
// 没有 pending 就直接返回——不需要 reconcile，也不需要碰 AppState。注意上面已经用 pendingNames（空数组）初始化过 UI 状态了，所以这里返回时 UI 显示的是「无待装项」而非残留的旧状态。
      return
    }

    logForDebugging(
      `Installing ${pendingNames.length} marketplace(s) in background`,
    )

    const result = await reconcileMarketplaces({
      onProgress: event => {
        switch (event.type) {
          case 'installing':
            updateMarketplaceStatus(setAppState, event.name, 'installing')
            break
          case 'installed':
            updateMarketplaceStatus(setAppState, event.name, 'installed')
            break
          case 'failed':
            updateMarketplaceStatus(
              setAppState,
              event.name,
              'failed',
              event.error,
            )
            break
        }
      },
    })
// reconcileMarketplaces 的 onProgress 回调：installing / installed / failed 三类事件分别推进 AppState，让 REPL 实时显示每个市场的安装进度。失败也写进状态（带 error），用户在 UI 里能看到哪个市场挂了、为什么。

    const metrics = {
      installed_count: result.installed.length,
      updated_count: result.updated.length,
      failed_count: result.failed.length,
      up_to_date_count: result.upToDate.length,
    }
    logEvent('tengu_marketplace_background_install', metrics)
    logForDiagnosticsNoPII(
      'info',
      'tengu_marketplace_background_install',
      metrics,
    )

    if (result.installed.length > 0) {
// 有新市场装成功 → 自动刷新插件。这修的是「plugin-not-found」错误：全新 homespace 或缓存被清时，首次加载只有缓存、市场还没 clone 完，插件自然找不到。刷新会清所有缓存、重载插件、bump pluginReconnectKey 让 MCP 连接重建。
      // New marketplaces were installed — auto-refresh plugins. This fixes
      // "Plugin not found in marketplace" errors from the initial cache-only
      // load (e.g., fresh homespace where marketplace cache was empty).
      // refreshActivePlugins clears all caches, reloads plugins, and bumps
      // pluginReconnectKey so MCP connections are re-established.
      clearMarketplacesCache()
      logForDebugging(
        `Auto-refreshing plugins after ${result.installed.length} new marketplace(s) installed`,
      )
      try {
        await refreshActivePlugins(setAppState)
      } catch (refreshError) {
        // If auto-refresh fails, fall back to needsRefresh notification so
        // the user can manually run /reload-plugins to recover.
        logError(refreshError)
        logForDebugging(
          `Auto-refresh failed, falling back to needsRefresh: ${refreshError}`,
          { level: 'warn' },
        )
        clearPluginCache(
          'performBackgroundPluginInstallations: auto-refresh failed',
        )
        setAppState(prev => {
          if (prev.plugins.needsRefresh) return prev
          return {
            ...prev,
            plugins: { ...prev.plugins, needsRefresh: true },
          }
        })
      }
    } else if (result.updated.length > 0) {
// 只有更新（没有新装）→ 不自动刷新，只置 needsRefresh 提示用户手动跑 /reload-plugins。更新没那么急，且该由用户决定什么时候应用——避免用户正干着活时被重载打断。
      // Existing marketplaces updated — notify user to run /reload-plugins.
      // Updates are less urgent and the user should choose when to apply them.
      clearMarketplacesCache()
      clearPluginCache(
        'performBackgroundPluginInstallations: marketplaces reconciled',
      )
      setAppState(prev => {
        if (prev.plugins.needsRefresh) return prev
        return {
          ...prev,
          plugins: { ...prev.plugins, needsRefresh: true },
        }
      })
    }
  } catch (error) {
    logError(error)
  }
}
