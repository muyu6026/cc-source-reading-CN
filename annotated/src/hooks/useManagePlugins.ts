import { useCallback, useEffect } from 'react'
import type { Command } from '../commands.js'
import { useNotifications } from '../context/notifications.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { reinitializeLspServerManager } from '../services/lsp/manager.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { count } from '../utils/array.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { toError } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { loadPluginAgents } from '../utils/plugins/loadPluginAgents.js'
import { getPluginCommands } from '../utils/plugins/loadPluginCommands.js'
import { loadPluginHooks } from '../utils/plugins/loadPluginHooks.js'
import { loadPluginLspServers } from '../utils/plugins/lspPluginIntegration.js'
import { loadPluginMcpServers } from '../utils/plugins/mcpPluginIntegration.js'
import { detectAndUninstallDelistedPlugins } from '../utils/plugins/pluginBlocklist.js'
import { getFlaggedPlugins } from '../utils/plugins/pluginFlagging.js'
import { loadAllPlugins } from '../utils/plugins/pluginLoader.js'

/**
 * Hook to manage plugin state and synchronize with AppState.
 *
 * On mount: loads all plugins, runs delisting enforcement, surfaces flagged-
 * plugin notifications, populates AppState.plugins. This is the initial
 * Layer-3 load — subsequent refresh goes through /reload-plugins.
 *
 * On needsRefresh: shows a notification directing the user to /reload-plugins.
 * Does NOT auto-refresh. All Layer-3 swap (commands, agents, hooks, MCP)
 * goes through refreshActivePlugins() via /reload-plugins for one consistent
 * mental model. See Outline: declarative-settings-hXHBMDIf4b PR 5c.
 */
// 【插件加载三层模型】挂载时做初始 Layer-3 加载：loadAllPlugins → delisting 强制 → flagged 通知 → 填 AppState.plugins。之后的刷新一律走 /reload-plugins，这个 hook 不自动刷新——注释解释了原因：历史上的自动刷新有 stale-cache bug（只清了 loadAllPlugins，下游 memoized loader 返回旧数据）且不完整（不含 MCP、agentDefinitions）。一个命令一个心智模型。
export function useManagePlugins({
  enabled = true,
}: {
  enabled?: boolean
} = {}) {
  const setAppState = useSetAppState()
  const needsRefresh = useAppState(s => s.plugins.needsRefresh)
  const { addNotification } = useNotifications()

  // Initial plugin load. Runs once on mount. NOT used for refresh — all
  // post-mount refresh goes through /reload-plugins → refreshActivePlugins().
  // Unlike refreshActivePlugins, this also runs delisting enforcement and
  // flagged-plugin notifications (session-start concerns), and does NOT bump
  // mcp.pluginReconnectKey (MCP effects fire on their own mount).
// 初始加载与会话刷新的差异：初始加载跑 delisting 强制和 flagged 通知（session-start 关切），且不 bump mcp.pluginReconnectKey（MCP effect 自己挂载时触发）；刷新路径 refreshActivePlugins 全换（commands/agents/hooks/MCP 一处不漏）。
  const initialPluginLoad = useCallback(async () => {
    try {
      // Load all plugins - capture errors array
      const { enabled, disabled, errors } = await loadAllPlugins()

      // Detect delisted plugins, auto-uninstall them, and record as flagged.
      await detectAndUninstallDelistedPlugins()

      // Notify if there are flagged plugins pending dismissal
      const flagged = getFlaggedPlugins()
// flagged 插件通知。key 固定 'plugin-delisted-flagged'——同一个 key 的通知是替换而不是堆叠，重复挂载不会弹出一串。
      if (Object.keys(flagged).length > 0) {
        addNotification({
          key: 'plugin-delisted-flagged',
          text: 'Plugins flagged. Check /plugins',
          color: 'warning',
          priority: 'high',
        })
      }

      // Load commands, agents, and hooks with individual error handling
      // Errors are added to the errors array for user visibility in Doctor UI
      let commands: Command[] = []
      let agents: AgentDefinition[] = []

      try {
        commands = await getPluginCommands()
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        errors.push({
          type: 'generic-error',
          source: 'plugin-commands',
          error: `Failed to load plugin commands: ${errorMessage}`,
        })
      }

      try {
        agents = await loadPluginAgents()
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        errors.push({
          type: 'generic-error',
          source: 'plugin-agents',
          error: `Failed to load plugin agents: ${errorMessage}`,
        })
      }

      try {
        await loadPluginHooks()
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        errors.push({
          type: 'generic-error',
          source: 'plugin-hooks',
          error: `Failed to load plugin hooks: ${errorMessage}`,
        })
      }

      // Load MCP server configs per plugin to get an accurate count.
      // LoadedPlugin.mcpServers is not populated by loadAllPlugins — it's a
      // cache slot that extractMcpServersFromPlugins fills later, which races
      // with this metric. Calling loadPluginMcpServers directly (as
      // cli/handlers/plugins.ts does) gives the correct count and also
      // warms the cache for the MCP connection manager.
      //
      // Runs BEFORE setAppState so any errors pushed by these loaders make it
      // into AppState.plugins.errors (Doctor UI), not just telemetry.
// MCP 计数必须在 setAppState 之前算。LoadedPlugin.mcpServers 这个字段 loadAllPlugins 不填——它是给 extractMcpServersFromPlugins 后填的缓存槽，与这里的指标计算存在竞态。直接调 loadPluginMcpServers 既拿得到正确计数，又顺带预热了 MCP 连接管理器的缓存。且这些 loader 推的 errors 要在 setAppState 前进数组，才能进 AppState.plugins.errors 被 Doctor UI 看见，而不只是遥测。
      const mcpServerCounts = await Promise.all(
        enabled.map(async p => {
          if (p.mcpServers) return Object.keys(p.mcpServers).length
          const servers = await loadPluginMcpServers(p, errors)
          if (servers) p.mcpServers = servers
          return servers ? Object.keys(servers).length : 0
        }),
      )
      const mcp_count = mcpServerCounts.reduce((sum, n) => sum + n, 0)

      // LSP: the primary fix for issue #15521 is in refresh.ts (via
      // performBackgroundPluginInstallations → refreshActivePlugins, which
      // clears caches first). This reinit is defensive — it reads the same
      // memoized loadAllPlugins() result as the original init unless a cache
      // invalidation happened between main.tsx:3203 and REPL mount (e.g.
      // seed marketplace registration or policySettings hot-reload).
// LSP reinit 是防御性的：#15521 的真正修复在 refresh.ts（performBackgroundPluginInstallations → refreshActivePlugins 先清缓存）。这里再 init 一次，是因为 main.tsx:3203 到 REPL 挂载之间可能发生缓存失效（marketplace 种子注册、policySettings 热重载）。
      const lspServerCounts = await Promise.all(
        enabled.map(async p => {
          if (p.lspServers) return Object.keys(p.lspServers).length
          const servers = await loadPluginLspServers(p, errors)
          if (servers) p.lspServers = servers
          return servers ? Object.keys(servers).length : 0
        }),
      )
      const lsp_count = lspServerCounts.reduce((sum, n) => sum + n, 0)
      reinitializeLspServerManager()

      // Update AppState - merge errors to preserve LSP errors
      setAppState(prevState => {
        // Keep existing LSP/non-plugin-loading errors (source 'lsp-manager' or 'plugin:*')
        const existingLspErrors = prevState.plugins.errors.filter(
          e => e.source === 'lsp-manager' || e.source.startsWith('plugin:'),
        )
        // Deduplicate: remove existing LSP errors that are also in new errors
        const newErrorKeys = new Set(
          errors.map(e =>
            e.type === 'generic-error'
              ? `generic-error:${e.source}:${e.error}`
              : `${e.type}:${e.source}`,
          ),
        )
        const filteredExisting = existingLspErrors.filter(e => {
          const key =
            e.type === 'generic-error'
              ? `generic-error:${e.source}:${e.error}`
              : `${e.type}:${e.source}`
          return !newErrorKeys.has(key)
        })
        const mergedErrors = [...filteredExisting, ...errors]
// errors 合并而非覆盖：prevState 里 LSP 相关的错误（source 'lsp-manager' 或 'plugin:*'）要保留——它们不是本次加载产生的。新 errors 里已有的按 type+source 去重键剔除旧条目，防 Doctor UI 里同一条错误出现两次。

        return {
          ...prevState,
          plugins: {
            ...prevState.plugins,
            enabled,
            disabled,
            commands,
            errors: mergedErrors,
          },
        }
      })

      logForDebugging(
        `Loaded plugins - Enabled: ${enabled.length}, Disabled: ${disabled.length}, Commands: ${commands.length}, Agents: ${agents.length}, Errors: ${errors.length}`,
      )

      // Count component types across enabled plugins
      const hook_count = enabled.reduce((sum, p) => {
        if (!p.hooksConfig) return sum
        return (
          sum +
          Object.values(p.hooksConfig).reduce(
            (s, matchers) =>
              s + (matchers?.reduce((h, m) => h + m.hooks.length, 0) ?? 0),
            0,
          )
        )
      }, 0)

      return {
        enabled_count: enabled.length,
        disabled_count: disabled.length,
        inline_count: count(enabled, p => p.source.endsWith('@inline')),
        marketplace_count: count(enabled, p => !p.source.endsWith('@inline')),
        error_count: errors.length,
        skill_count: commands.length,
        agent_count: agents.length,
        hook_count,
        mcp_count,
        lsp_count,
        // Ant-only: which plugins are enabled, to correlate with RSS/FPS.
        // Kept separate from base metrics so it doesn't flow into
        // logForDiagnosticsNoPII.
        ant_enabled_names:
// ant 构建专属指标：启用了哪些插件，与 RSS/FPS 关联分析。刻意与基础指标分开——它不该流进 logForDiagnosticsNoPII（no-PII 日志），且类型名 AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 本身就是「人工验过这不再是代码或路径」的标记类型。
          process.env.USER_TYPE === 'ant' && enabled.length > 0
            ? (enabled
                .map(p => p.name)
                .sort()
                .join(
                  ',',
                ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
            : undefined,
      }
    } catch (error) {
      // Only plugin loading errors should reach here - log for monitoring
      const errorObj = toError(error)
      logError(errorObj)
      logForDebugging(`Error loading plugins: ${error}`)
      // Set empty state on error, but preserve LSP errors and add the new error
      setAppState(prevState => {
// catch 兜底：只有插件系统级失败（loadAllPlugins 本身炸）才到这里。置空 enabled/disabled/commands，但保留 LSP 错误 + 追加 plugin-system 错误——用户看到「插件加载失败」但 LSP 诊断不丢。返回全 0 指标带 load_failed: true。
        // Keep existing LSP/non-plugin-loading errors
        const existingLspErrors = prevState.plugins.errors.filter(
          e => e.source === 'lsp-manager' || e.source.startsWith('plugin:'),
        )
        const newError = {
          type: 'generic-error' as const,
          source: 'plugin-system',
          error: errorObj.message,
        }
        return {
          ...prevState,
          plugins: {
            ...prevState.plugins,
            enabled: [],
            disabled: [],
            commands: [],
            errors: [...existingLspErrors, newError],
          },
        }
      })

      return {
        enabled_count: 0,
        disabled_count: 0,
        inline_count: 0,
        marketplace_count: 0,
        error_count: 1,
        skill_count: 0,
        agent_count: 0,
        hook_count: 0,
        mcp_count: 0,
        lsp_count: 0,
        load_failed: true,
        ant_enabled_names: undefined,
      }
    }
  }, [setAppState, addNotification])

  // Load plugins on mount and emit telemetry
  useEffect(() => {
    if (!enabled) return
    void initialPluginLoad().then(metrics => {
      const { ant_enabled_names, ...baseMetrics } = metrics
      const allMetrics = {
        ...baseMetrics,
        has_custom_plugin_cache_dir: !!process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR,
      }
      logEvent('tengu_plugins_loaded', {
        ...allMetrics,
        ...(ant_enabled_names !== undefined && {
          enabled_names: ant_enabled_names,
        }),
      })
      logForDiagnosticsNoPII('info', 'tengu_plugins_loaded', allMetrics)
    })
  }, [initialPluginLoad, enabled])

  // Plugin state changed on disk (background reconcile, /plugin menu,
  // external settings edit). Show a notification; user runs /reload-plugins
  // to apply. The previous auto-refresh here had a stale-cache bug (only
  // cleared loadAllPlugins, downstream memoized loaders returned old data)
  // and was incomplete (no MCP, no agentDefinitions). /reload-plugins
  // handles all of that correctly via refreshActivePlugins().
  useEffect(() => {
// needsRefresh（磁盘上插件变了：后台 reconcile、/plugin 菜单、外部改 settings）只弹通知指向 /reload-plugins。不自动刷新、不重置 needsRefresh——后者由 /reload-plugins 经 refreshActivePlugins 消费。两个 effect 的分工是：这个 hook 负责「启动时加载 + 提示变更」，命令负责「应用变更」。
    if (!enabled || !needsRefresh) return
    addNotification({
      key: 'plugin-reload-pending',
      text: 'Plugins changed. Run /reload-plugins to activate.',
      color: 'suggestion',
      priority: 'low',
    })
    // Do NOT auto-refresh. Do NOT reset needsRefresh — /reload-plugins
    // consumes it via refreshActivePlugins().
  }, [enabled, needsRefresh, addNotification])
}
