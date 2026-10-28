/**
 * Layer-3 refresh primitive: swap active plugin components in the running session.
 *
 * Three-layer model (see reconciler.ts for Layer-2):
 * - Layer 1: intent (settings)
 * - Layer 2: materialization (~/.claude/plugins/) — reconcileMarketplaces()
 * - Layer 3: active components (AppState) — this file
 *
 * Called from:
 * - /reload-plugins command (interactive, user-initiated)
 * - print.ts refreshPluginState() (headless, auto before first query with SYNC_PLUGIN_INSTALL)
 * - performBackgroundPluginInstallations() (background, auto after new marketplace install)
 *
 * NOT called from:
 * - useManagePlugins needsRefresh effect — interactive mode shows a notification;
 *   user explicitly runs /reload-plugins (PR 5c)
 * - /plugin menu — sets needsRefresh, user runs /reload-plugins (PR 5b)
 */

import { getOriginalCwd } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { reinitializeLspServerManager } from '../../services/lsp/manager.js'
import type { AppState } from '../../state/AppState.js'
import type { AgentDefinitionsResult } from '../../tools/AgentTool/loadAgentsDir.js'
import { getAgentDefinitionsWithOverrides } from '../../tools/AgentTool/loadAgentsDir.js'
import type { PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { clearAllCaches } from './cacheUtils.js'
import { getPluginCommands } from './loadPluginCommands.js'
import { loadPluginHooks } from './loadPluginHooks.js'
import { loadPluginLspServers } from './lspPluginIntegration.js'
import { loadPluginMcpServers } from './mcpPluginIntegration.js'
import { clearPluginCacheExclusions } from './orphanedPluginFilter.js'
import { loadAllPlugins } from './pluginLoader.js'

type SetAppState = (updater: (prev: AppState) => AppState) => void
// 三层模型：L1 意图（settings）、L2 物化（~/.claude/plugins/）、L3 本文件负责把激活组件换进运行中的 AppState。

export type RefreshActivePluginsResult = {
  enabled_count: number
  disabled_count: number
  command_count: number
  agent_count: number
  hook_count: number
  mcp_count: number
  /** LSP servers provided by enabled plugins. reinitializeLspServerManager()
   * is called unconditionally so the manager picks these up (no-op if
   * manager was never initialized). */
  lsp_count: number
  error_count: number
  /** The refreshed agent definitions, for callers (e.g. print.ts) that also
   * maintain a local mutable reference outside AppState. */
  agentDefinitions: AgentDefinitionsResult
  /** The refreshed plugin commands, same rationale as agentDefinitions. */
  pluginCommands: Command[]
}

// 刷新结果结构：各计数 + 刷新后的 agent/mcp 定义，供调用方同步 AppState 之外的本地可变引用。
/**
 * Refresh all active plugin components: commands, agents, hooks, MCP-reconnect
 * trigger, AppState plugin arrays. Clears ALL plugin caches (unlike the old
 * needsRefresh path which only cleared loadAllPlugins and returned stale data
 * from downstream memoized loaders).
 *
 * Consumes plugins.needsRefresh (sets to false).
 * Increments mcp.pluginReconnectKey so useManageMCPConnections effects re-run
 * and pick up new plugin MCP servers.
 *
 * LSP: if plugins now contribute LSP servers, reinitializeLspServerManager()
 * re-reads config. Servers are lazy-started so this is just config parsing.
 */
export async function refreshActivePlugins(
  setAppState: SetAppState,
): Promise<RefreshActivePluginsResult> {
// refreshActivePlugins：清全部插件缓存 → 完整加载 → 填充 mcp/lsp → 更新 AppState → 触发 LSP 重初始化与 hook 全量交换。
  logForDebugging('refreshActivePlugins: clearing all plugin caches')
// 先清所有插件缓存（旧 needsRefresh 路径只清 loadAllPlugins，会返回下游记忆化的陈旧数据）。
  clearAllCaches()
  // Orphan exclusions are session-frozen by default, but /reload-plugins is
  // an explicit "disk changed, re-read it" signal — recompute them too.
  clearPluginCacheExclusions()

  // Sequence the full load before cache-only consumers. Before #23693 all
  // three shared loadAllPlugins()'s memoize promise so Promise.all was a
  // no-op race. After #23693 getPluginCommands/getAgentDefinitions call
  // loadAllPluginsCacheOnly (separate memoize) — racing them means they
  // read installed_plugins.json before loadAllPlugins() has cloned+cached
  // the plugin, returning plugin-cache-miss. loadAllPlugins warms the
  // cache-only memoize on completion, so the awaits below are ~free.
  const pluginResult = await loadAllPlugins()
// 先 await 完整 loadAllPlugins 预热缓存；它完成后再读的 cacheOnly 记忆化近乎免费，避免竞态导致插件缓存未命中。
  const [pluginCommands, agentDefinitions] = await Promise.all([
    getPluginCommands(),
    getAgentDefinitionsWithOverrides(getOriginalCwd()),
  ])

  const { enabled, disabled, errors } = pluginResult

  // Populate mcpServers/lspServers on each enabled plugin. These are lazy
  // cache slots NOT filled by loadAllPlugins() — they're written later by
  // extractMcpServersFromPlugins/getPluginLspServers, which races with this.
  // Loading here gives accurate metrics AND warms the cache slots so the MCP
  // connection manager (triggered by pluginReconnectKey bump) sees the servers
  // without re-parsing manifests. Errors are pushed to the shared errors array.
  const [mcpCounts, lspCounts] = await Promise.all([
    Promise.all(
      enabled.map(async p => {
        if (p.mcpServers) return Object.keys(p.mcpServers).length
        const servers = await loadPluginMcpServers(p, errors)
        if (servers) p.mcpServers = servers
        return servers ? Object.keys(servers).length : 0
      }),
    ),
    Promise.all(
      enabled.map(async p => {
        if (p.lspServers) return Object.keys(p.lspServers).length
        const servers = await loadPluginLspServers(p, errors)
        if (servers) p.lspServers = servers
        return servers ? Object.keys(servers).length : 0
      }),
    ),
  ])
  const mcp_count = mcpCounts.reduce((sum, n) => sum + n, 0)
  const lsp_count = lspCounts.reduce((sum, n) => sum + n, 0)

  setAppState(prev => ({
// 一次性更新 AppState：enabled/disabled/commands/errors，并把 mcp.pluginReconnectKey 自增以触发 MCP 重连 effect。
    ...prev,
    plugins: {
      ...prev.plugins,
      enabled,
      disabled,
      commands: pluginCommands,
      errors: mergePluginErrors(prev.plugins.errors, errors),
      needsRefresh: false,
    },
    agentDefinitions,
    mcp: {
      ...prev.mcp,
      pluginReconnectKey: prev.mcp.pluginReconnectKey + 1,
    },
  }))

  // Re-initialize LSP manager so newly-loaded plugin LSP servers are picked
  // up. No-op if LSP was never initialized (headless subcommand path).
  // Unconditional so removing the last LSP plugin also clears stale config.
  // Fixes issue #15521: LSP manager previously read a stale memoized
  // loadAllPlugins() result from before marketplaces were reconciled.
  reinitializeLspServerManager()
// 无条件重初始化 LSP 管理器（无 LSP 时 no-op），确保新增或移除的 LSP 插件配置都被正确拾取（修 issue #15521）。

  // clearAllCaches() prunes removed-plugin hooks; this does the FULL swap
  // (adds hooks from newly-enabled plugins too). Catching here so
  // hook_load_failed can feed error_count; a failure doesn't lose the
  // plugin/command/agent data above (hooks go to STATE.registeredHooks, not
  // AppState).
  let hook_load_failed = false
// hook 全量交换（含新启用插件的 hook）；失败只计 error_count，不丢上面的插件/命令/agent 数据（hook 进 STATE 不进 AppState）。
  try {
    await loadPluginHooks()
  } catch (e) {
    hook_load_failed = true
    logError(e)
    logForDebugging(
      `refreshActivePlugins: loadPluginHooks failed: ${errorMessage(e)}`,
    )
  }

  const hook_count = enabled.reduce((sum, p) => {
// 汇总所有启用插件的 hook 总数（按各 hooksConfig 匹配器里的 hook 长度累加）。
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

  logForDebugging(
    `refreshActivePlugins: ${enabled.length} enabled, ${pluginCommands.length} commands, ${agentDefinitions.allAgents.length} agents, ${hook_count} hooks, ${mcp_count} MCP, ${lsp_count} LSP`,
  )

  return {
    enabled_count: enabled.length,
    disabled_count: disabled.length,
    command_count: pluginCommands.length,
    agent_count: agentDefinitions.allAgents.length,
    hook_count,
    mcp_count,
    lsp_count,
    error_count: errors.length + (hook_load_failed ? 1 : 0),
    agentDefinitions,
    pluginCommands,
  }
}

/**
 * Merge fresh plugin-load errors with existing errors, preserving LSP and
 * plugin-component errors that were recorded by other systems and
 * deduplicating. Same logic as refreshPlugins()/updatePluginState(), extracted
 * so refresh.ts doesn't leave those errors stranded.
 */
function mergePluginErrors(
  existing: PluginError[],
  fresh: PluginError[],
): PluginError[] {
// mergePluginErrors：把本系统记录的 lsp-manager 与 plugin:* 错误与本次新鲜错误合并去重，避免刷新丢错误。
  const preserved = existing.filter(
    e => e.source === 'lsp-manager' || e.source.startsWith('plugin:'),
  )
  const freshKeys = new Set(fresh.map(errorKey))
  const deduped = preserved.filter(e => !freshKeys.has(errorKey(e)))
  return [...deduped, ...fresh]
}

function errorKey(e: PluginError): string {
// errorKey：用 type/source/error 生成去重键，generic-error 额外带上 error 文本。
  return e.type === 'generic-error'
    ? `generic-error:${e.source}:${e.error}`
    : `${e.type}:${e.source}`
}
