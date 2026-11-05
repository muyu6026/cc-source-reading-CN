// 整个文件是 React Compiler 的输出：变量名带 s_0 / item_0 / error_0 这类数字后缀，是编译器为消除重复绑定而做的重命名；`newStates[index]!` 的非空断言也是它的手笔
import figures from 'figures';
import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { MCPRemoteServerMenu } from '../../components/mcp/MCPRemoteServerMenu.js';
import { MCPStdioServerMenu } from '../../components/mcp/MCPStdioServerMenu.js';
import { MCPToolDetailView } from '../../components/mcp/MCPToolDetailView.js';
import { MCPToolListView } from '../../components/mcp/MCPToolListView.js';
import type { ClaudeAIServerInfo, HTTPServerInfo, SSEServerInfo, StdioServerInfo } from '../../components/mcp/types.js';
import { SearchBox } from '../../components/SearchBox.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for raw search mode text input
import { Box, Text, useInput, useTerminalFocus } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { getBuiltinPluginDefinition } from '../../plugins/builtinPlugins.js';
import { useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import type { MCPServerConnection, McpClaudeAIProxyServerConfig, McpHTTPServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '../../services/mcp/types.js';
import { filterToolsByServer } from '../../services/mcp/utils.js';
import { disablePluginOp, enablePluginOp, getPluginInstallationFromV2, isInstallableScope, isPluginEnabledAtProjectScope, uninstallPluginOp, updatePluginOp } from '../../services/plugins/pluginOperations.js';
import { useAppState } from '../../state/AppState.js';
import type { Tool } from '../../Tool.js';
import type { LoadedPlugin, PluginError } from '../../types/plugin.js';
import { count } from '../../utils/array.js';
import { openBrowser } from '../../utils/browser.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage, toError } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js';
import { getMarketplace } from '../../utils/plugins/marketplaceManager.js';
import { isMcpbSource, loadMcpbFile, type McpbNeedsConfigResult, type UserConfigValues } from '../../utils/plugins/mcpbHandler.js';
import { getPluginDataDirSize, pluginDataDirPath } from '../../utils/plugins/pluginDirectories.js';
import { getFlaggedPlugins, markFlaggedPluginsSeen, removeFlaggedPlugin } from '../../utils/plugins/pluginFlagging.js';
import { type PersistablePluginScope, parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import { loadPluginOptions, type PluginOptionSchema, savePluginOptions } from '../../utils/plugins/pluginOptionsStorage.js';
import { isPluginBlockedByPolicy } from '../../utils/plugins/pluginPolicy.js';
import { getPluginEditableScopes } from '../../utils/plugins/pluginStartupCheck.js';
import { getSettings_DEPRECATED, getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { plural } from '../../utils/stringUtils.js';
import { formatErrorMessage, getErrorGuidance } from './PluginErrors.js';
import { PluginOptionsDialog } from './PluginOptionsDialog.js';
import { PluginOptionsFlow } from './PluginOptionsFlow.js';
import type { ViewState as ParentViewState } from './types.js';
import { UnifiedInstalledCell } from './UnifiedInstalledCell.js';
import type { UnifiedInstalledItem } from './unifiedTypes.js';
import { usePagination } from './usePagination.js';
// 父组件的回传通道：setViewState 切到上层菜单、setResult 设一条关闭对话框后展示的结果语。action 与 targetPlugin 是给斜杠命令直连用的——/plugin uninstall foo 会带着目标与动作一次性进到详情页
type Props = {
  setViewState: (state: ParentViewState) => void;
  setResult: (result: string | null) => void;
  onManageComplete?: () => void | Promise<void>;
  onSearchModeChange?: (isActive: boolean) => void;
  targetPlugin?: string;
  targetMarketplace?: string;
  action?: 'enable' | 'disable' | 'uninstall';
};
// 两类「异常条目」各有结构：flagged 是被市场下架的插件（还在设置里，但源没了），failed 是加载失败但设置里仍有记录的插件。它们的展示与可执行动作都不同，所以分成两个类型而不是一个带 kind 的联合
type FlaggedPluginInfo = {
  id: string;
  name: string;
  marketplace: string;
  reason: string;
  text: string;
  flaggedAt: string;
};
type FailedPluginInfo = {
  id: string;
  name: string;
  marketplace: string;
  errors: PluginError[];
  scope: PersistablePluginScope;
};
// ViewState 是 11 个变体的联合：三个字符串字面量加八个带 type 的对象。带参数的那几个（options schema、cleanup size、flagged/failed 条目、MCP 客户端与工具）把上下文直接嵌进状态，避免再开一堆并列的 useState 让它们失步
type ViewState = 'plugin-list' | 'plugin-details' | 'configuring' | {
  type: 'plugin-options';
} | {
  type: 'configuring-options';
  schema: PluginOptionSchema;
} | 'confirm-project-uninstall' | {
  type: 'confirm-data-cleanup';
  size: {
    bytes: number;
    human: string;
  };
} | {
  type: 'flagged-detail';
  plugin: FlaggedPluginInfo;
} | {
  type: 'failed-plugin-details';
  plugin: FailedPluginInfo;
} | {
  type: 'mcp-detail';
  client: MCPServerConnection;
} | {
  type: 'mcp-tools';
  client: MCPServerConnection;
} | {
  type: 'mcp-tool-detail';
  client: MCPServerConnection;
  tool: Tool;
};
// 按市场分组时顺便算启用/禁用计数：列表头的分组标题要用，避免渲染时再遍历一遍
type MarketplaceInfo = {
  name: string;
  installedPlugins: LoadedPlugin[];
  enabledCount?: number;
  disabledCount?: number;
};
// PluginState 是列表项的编辑态：pendingEnable 与 pendingUpdate 是「已操作但未生效」的标记，用来在界面上区分「现在是什么状态」与「刷新后会变成什么状态」
type PluginState = {
  plugin: LoadedPlugin;
  marketplace: string;
  scope?: 'user' | 'project' | 'local' | 'managed' | 'builtin';
  pendingEnable?: boolean; // Toggle enable/disable
  pendingUpdate?: boolean; // Marked for update
};

/**
 * Get list of base file names (without .md extension) from a directory
 * @param dirPath The directory path to list files from
 * @returns Array of base file names without .md extension
 * @example
 * // Given directory contains: agent-sdk-verifier-py.md, agent-sdk-verifier-ts.md, README.txt
 * await getBaseFileNames('/path/to/agents')
 * // Returns: ['agent-sdk-verifier-py', 'agent-sdk-verifier-ts']
 */
// getBaseFileNames 扫一个目录下的 .md 文件并去掉扩展名——插件里的命令与代理都是一目录一文件，文件名就是命令名
async function getBaseFileNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, {
      withFileTypes: true
    });
    return entries.filter((entry: Dirent) => entry.isFile() && entry.name.endsWith('.md')).map((entry: Dirent) => {
      // Remove .md extension specifically
      const baseName = path.basename(entry.name, '.md');
      return baseName;
    });
// 读目录失败一律降级成空数组而不是抛错：插件详情页即使拿不到组件清单也还该能显示，缺一块信息远好于整页崩掉
  } catch (error) {
    const errorMsg = errorMessage(error);
    logForDebugging(`Failed to read plugin components from ${dirPath}: ${errorMsg}`, {
      level: 'error'
    });
    logError(toError(error));
    // Return empty array to allow graceful degradation - plugin details can still be shown
    return [];
  }
}

/**
 * Get list of skill directory names from a skills directory
 * Skills are directories containing a SKILL.md file
 * @param dirPath The skills directory path to scan
 * @returns Array of skill directory names that contain SKILL.md
 * @example
 * // Given directory contains: my-skill/SKILL.md, another-skill/SKILL.md, README.txt
 * await getSkillDirNames('/path/to/skills')
 * // Returns: ['my-skill', 'another-skill']
 */
// getSkillDirNames 与上一个的差别在于「技能是目录不是文件」：每个子目录里得有一个 SKILL.md 才算技能。这里还额外把符号链接算进来，因为技能的常见安装方式就是软链到别处
async function getSkillDirNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, {
      withFileTypes: true
    });
    const skillNames: string[] = [];
    for (const entry of entries) {
      // Check if it's a directory or symlink (symlinks may point to skill directories)
// 目录与软链都试，因为软链可能指向目录（isDirectory 对软链返回 false）
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        // Check if this directory contains a SKILL.md file
        const skillFilePath = path.join(dirPath, entry.name, 'SKILL.md');
        try {
          const st = await fs.stat(skillFilePath);
          if (st.isFile()) {
            skillNames.push(entry.name);
          }
        } catch {
          // No SKILL.md file in this directory, skip it
        }
      }
    }
    return skillNames;
  } catch (error) {
    const errorMsg = errorMessage(error);
    logForDebugging(`Failed to read skill directories from ${dirPath}: ${errorMsg}`, {
      level: 'error'
    });
    logError(toError(error));
    // Return empty array to allow graceful degradation - plugin details can still be shown
    return [];
  }
}

// Component to display installed plugin components
// PluginComponentsDisplay 负责「这个插件到底装了什么」：命令、代理、技能、钩子、MCP 服务器五类。数据来源有两处——已加载插件的路径字段，以及 marketplace.json 里的声明，两边都要合并
function PluginComponentsDisplay({
  plugin,
  marketplace
}: {
  plugin: LoadedPlugin;
  marketplace: string;
}): React.ReactNode {
  const [components, setComponents] = useState<{
    commands?: string | string[] | Record<string, unknown> | null;
    agents?: string | string[] | Record<string, unknown> | null;
    skills?: string | string[] | Record<string, unknown> | null;
    hooks?: unknown;
    mcpServers?: unknown;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    async function loadComponents() {
      try {
        // Built-in plugins don't have a marketplace entry — read from the
        // registered definition directly.
// 内置插件没有市场条目，只能从注册表里读定义；这是唯一需要特判的来源
        if (marketplace === 'builtin') {
          const builtinDef = getBuiltinPluginDefinition(plugin.name);
          if (builtinDef) {
            const skillNames = builtinDef.skills?.map(s => s.name) ?? [];
            const hookEvents = builtinDef.hooks ? Object.keys(builtinDef.hooks) : [];
            const mcpServerNames = builtinDef.mcpServers ? Object.keys(builtinDef.mcpServers) : [];
            setComponents({
              commands: null,
              agents: null,
              skills: skillNames.length > 0 ? skillNames : null,
              hooks: hookEvents.length > 0 ? hookEvents : null,
              mcpServers: mcpServerNames.length > 0 ? mcpServerNames : null
            });
          } else {
            setError(`Built-in plugin ${plugin.name} not found`);
          }
          setLoading(false);
          return;
        }
        const marketplaceData = await getMarketplace(marketplace);
        // Find the plugin entry in the array
        const pluginEntry = marketplaceData.plugins.find(p => p.name === plugin.name);
        if (pluginEntry) {
// 命令、代理、技能三类的收集逻辑完全同构（单路径加多路径、逐个目录扫），MCP 与钩子则直接取声明的键名——因为后两者的存在形式就是配置对象
          // Combine commands from both sources
          const commandPathList = [];
          if (plugin.commandsPath) {
            commandPathList.push(plugin.commandsPath);
          }
          if (plugin.commandsPaths) {
            commandPathList.push(...plugin.commandsPaths);
          }

          // Get base file names from all command paths
          const commandList: string[] = [];
          for (const commandPath of commandPathList) {
            if (typeof commandPath === 'string') {
              // commandPath is already a full path
              const baseNames = await getBaseFileNames(commandPath);
              commandList.push(...baseNames);
            }
          }

          // Combine agents from both sources
          const agentPathList = [];
          if (plugin.agentsPath) {
            agentPathList.push(plugin.agentsPath);
          }
          if (plugin.agentsPaths) {
            agentPathList.push(...plugin.agentsPaths);
          }

          // Get base file names from all agent paths
          const agentList: string[] = [];
          for (const agentPath of agentPathList) {
            if (typeof agentPath === 'string') {
              // agentPath is already a full path
              const baseNames_0 = await getBaseFileNames(agentPath);
              agentList.push(...baseNames_0);
            }
          }

          // Combine skills from both sources
          const skillPathList = [];
          if (plugin.skillsPath) {
            skillPathList.push(plugin.skillsPath);
          }
          if (plugin.skillsPaths) {
            skillPathList.push(...plugin.skillsPaths);
          }

          // Get skill directory names from all skill paths
          // Skills are directories containing SKILL.md files
          const skillList: string[] = [];
          for (const skillPath of skillPathList) {
            if (typeof skillPath === 'string') {
              // skillPath is already a full path to a skills directory
              const skillDirNames = await getSkillDirNames(skillPath);
              skillList.push(...skillDirNames);
            }
          }

          // Combine hooks from both sources
          const hooksList = [];
          if (plugin.hooksConfig) {
            hooksList.push(Object.keys(plugin.hooksConfig));
          }
          if (pluginEntry.hooks) {
            hooksList.push(pluginEntry.hooks);
          }

          // Combine MCP servers from both sources
          const mcpServersList = [];
          if (plugin.mcpServers) {
            mcpServersList.push(Object.keys(plugin.mcpServers));
          }
          if (pluginEntry.mcpServers) {
            mcpServersList.push(pluginEntry.mcpServers);
          }
          setComponents({
            commands: commandList.length > 0 ? commandList : null,
            agents: agentList.length > 0 ? agentList : null,
            skills: skillList.length > 0 ? skillList : null,
            hooks: hooksList.length > 0 ? hooksList : null,
            mcpServers: mcpServersList.length > 0 ? mcpServersList : null
          });
        } else {
          setError(`Plugin ${plugin.name} not found in marketplace`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load components');
      } finally {
        setLoading(false);
      }
    }
    void loadComponents();
  }, [plugin.name, plugin.commandsPath, plugin.commandsPaths, plugin.agentsPath, plugin.agentsPaths, plugin.skillsPath, plugin.skillsPaths, plugin.hooksConfig, plugin.mcpServers, marketplace]);
// 加载中直接返回 null 而不是转圈：这是详情页的一个小节，闪一下加载态反而更乱
  if (loading) {
    return null; // Don't show loading state for cleaner UI
  }
  if (error) {
    return <Box flexDirection="column" marginBottom={1}>
        <Text bold>Components:</Text>
        <Text dimColor>Error: {error}</Text>
      </Box>;
  }
  if (!components) {
    return null; // No components info available
  }
  const hasComponents = components.commands || components.agents || components.skills || components.hooks || components.mcpServers;
  if (!hasComponents) {
    return null; // No components defined
  }
  return <Box flexDirection="column" marginBottom={1}>
      <Text bold>Installed components:</Text>
      {components.commands ? <Text dimColor>
          • Commands:{' '}
          {typeof components.commands === 'string' ? components.commands : Array.isArray(components.commands) ? components.commands.join(', ') : Object.keys(components.commands).join(', ')}
        </Text> : null}
      {components.agents ? <Text dimColor>
          • Agents:{' '}
          {typeof components.agents === 'string' ? components.agents : Array.isArray(components.agents) ? components.agents.join(', ') : Object.keys(components.agents).join(', ')}
        </Text> : null}
      {components.skills ? <Text dimColor>
          • Skills:{' '}
          {typeof components.skills === 'string' ? components.skills : Array.isArray(components.skills) ? components.skills.join(', ') : Object.keys(components.skills).join(', ')}
        </Text> : null}
      {components.hooks ? <Text dimColor>
          • Hooks:{' '}
          {typeof components.hooks === 'string' ? components.hooks : Array.isArray(components.hooks) ? components.hooks.map(String).join(', ') : typeof components.hooks === 'object' && components.hooks !== null ? Object.keys(components.hooks).join(', ') : String(components.hooks)}
        </Text> : null}
      {components.mcpServers ? <Text dimColor>
          • MCP Servers:{' '}
          {typeof components.mcpServers === 'string' ? components.mcpServers : Array.isArray(components.mcpServers) ? components.mcpServers.map(String).join(', ') : typeof components.mcpServers === 'object' && components.mcpServers !== null ? Object.keys(components.mcpServers).join(', ') : String(components.mcpServers)}
        </Text> : null}
    </Box>;
}

/**
 * Check if a plugin is from a local source and cannot be remotely updated
 * @returns Error message if local, null if remote/updatable
 */
// 本地源插件不能远程更新——直接给出「去改哪个路径」的提示，比让用户点更新然后失败要好
async function checkIfLocalPlugin(pluginName: string, marketplaceName: string): Promise<string | null> {
  const marketplace = await getMarketplace(marketplaceName);
  const entry = marketplace?.plugins.find(p => p.name === pluginName);
  if (entry && typeof entry.source === 'string') {
    return `Local plugins cannot be updated remotely. To update, modify the source at: ${entry.source}`;
  }
  return null;
}

// 按组织策略过滤：被策略禁用的插件不该出现在列表里。注意这里查的是策略设置而不是安装作用域，因为托管设置不会产生 scope 为 managed 的安装记录——按作用域判断会漏
/**
 * Filter out plugins that are force-disabled by org policy (policySettings).
 * These are blocked by the organization and cannot be re-enabled by the user.
 * Checks policySettings directly rather than installation scope, since managed
 * settings don't create installation records with scope 'managed'.
 */
export function filterManagedDisabledPlugins(plugins: LoadedPlugin[]): LoadedPlugin[] {
  return plugins.filter(plugin => {
    const marketplace = plugin.source.split('@')[1] || 'local';
    return !isPluginBlockedByPolicy(`${plugin.name}@${marketplace}`);
  });
}
// ManagePlugins 是插件管理的主界面，一个组件承担了列表、详情、配置、确认、MCP 子页共 11 个视图。所有视图共享同一份「选中项 + 状态 + 错误」三个状态槽，靠 viewState 分流
export function ManagePlugins({
  setViewState: setParentViewState,
  setResult,
  onManageComplete,
  onSearchModeChange,
  targetPlugin,
  targetMarketplace,
  action
}: Props): React.ReactNode {
  // App state for MCP access
// MCP 客户端与工具、插件错误都从全局 AppState 订阅——它们由连接管理器维护，组件只读
  const mcpClients = useAppState(s => s.mcp.clients);
  const mcpTools = useAppState(s_0 => s_0.mcp.tools);
  const pluginErrors = useAppState(s_1 => s_1.plugins.errors);
  const flaggedPlugins = getFlaggedPlugins();

  // Search state
// 搜索模式要往外同步：父组件据此禁用一些全局快捷键，否则用户在输入框里打字会被当成导航
  const [isSearchMode, setIsSearchModeRaw] = useState(false);
  const setIsSearchMode = useCallback((active: boolean) => {
    setIsSearchModeRaw(active);
    onSearchModeChange?.(active);
  }, [onSearchModeChange]);
  const isTerminalFocused = useTerminalFocus();
  const {
    columns: terminalWidth
  } = useTerminalSize();

  // View state
// viewState 的初值恒为 plugin-list：所有进入方式（斜杠命令、直接指定目标插件）都先落到列表，再由自动导航效应跳转
  const [viewState, setViewState] = useState<ViewState>('plugin-list');
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset
  } = useSearchInput({
    isActive: viewState === 'plugin-list' && isSearchMode,
    onExit: () => {
      setIsSearchMode(false);
    }
  });
  const [selectedPlugin, setSelectedPlugin] = useState<PluginState | null>(null);

  // Data state
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [pluginStates, setPluginStates] = useState<PluginState[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingToggles, setPendingToggles] = useState<Map<string, 'will-enable' | 'will-disable'>>(new Map());

  // Guard to prevent auto-navigation from re-triggering after the user
  // navigates away (targetPlugin is never cleared by the parent).
// 两个 ref 而非 state，原因都是「一次性消费」：hasAutoNavigated 防止用户离开后又被拽回详情页（父组件的 targetPlugin 永远不会被清空），pendingAutoActionRef 是同一次跳转之后要执行的动作（如 uninstall）
  const hasAutoNavigated = useRef(false);
  // Auto-action (enable/disable/uninstall) to fire after auto-navigation lands.
  // Ref, not state: it's consumed by a one-shot effect that already re-runs on
  // viewState/selectedPlugin, so a render-triggering state var would be redundant.
  const pendingAutoActionRef = useRef<'enable' | 'disable' | 'uninstall' | undefined>(undefined);

  // MCP toggle hook
  const toggleMcpServer = useMcpToggleEnabled();

  // Handle escape to go back - viewState-dependent navigation
// handleBack 是一个 11 分支的返回逻辑：详情回列表、配置回详情、MCP 工具详情回工具列表、工具列表回服务器详情……每个分支还要顺手清掉不该带到上一层的错误信息
  const handleBack = React.useCallback(() => {
    if (viewState === 'plugin-details') {
      setViewState('plugin-list');
      setSelectedPlugin(null);
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
      setViewState('plugin-list');
      setProcessError(null);
    } else if (viewState === 'configuring') {
      setViewState('plugin-details');
      setConfigNeeded(null);
    } else if (typeof viewState === 'object' && (viewState.type === 'plugin-options' || viewState.type === 'configuring-options')) {
      // Cancel mid-sequence — plugin is already enabled, just bail to list.
      // User can configure later via the Configure options menu if they want.
      setViewState('plugin-list');
      setSelectedPlugin(null);
      setResult('Plugin enabled. Configuration skipped — run /reload-plugins to apply.');
      if (onManageComplete) {
        void onManageComplete();
      }
    } else if (typeof viewState === 'object' && viewState.type === 'flagged-detail') {
      setViewState('plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-detail') {
      setViewState('plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-tools') {
      setViewState({
        type: 'mcp-detail',
        client: viewState.client
      });
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-tool-detail') {
      setViewState({
        type: 'mcp-tools',
        client: viewState.client
      });
// 落到最后一档时先看有没有待生效的开关：有就只提示「跑 /reload-plugins」，不退出对话框——用户可能还想继续操作
    } else {
      if (pendingToggles.size > 0) {
        setResult('Run /reload-plugins to apply plugin changes.');
        return;
      }
      setParentViewState({
        type: 'menu'
      });
    }
  }, [viewState, setParentViewState, pendingToggles, setResult]);

  // Escape when not in search mode - go back.
  // Excludes confirm-project-uninstall (has its own confirm:no handler in
  // Confirmation context — letting this fire would create competing handlers)
  // and confirm-data-cleanup (uses raw useInput where n and escape are
  // DIFFERENT actions: keep-data vs cancel).
// Esc 在大多数视图里等于「返回」，但显式排除两种确认页：confirm-project-uninstall 有自己的 confirm:no 绑定（两处都绑会形成竞争处理器），confirm-data-cleanup 里 n 与 esc 是不同动作（保留数据 vs 取消）
  useKeybinding('confirm:no', handleBack, {
    context: 'Confirmation',
    isActive: (viewState !== 'plugin-list' || !isSearchMode) && viewState !== 'confirm-project-uninstall' && !(typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup')
  });

  // Helper to get MCP status
  const getMcpStatus = (client: MCPServerConnection): 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed' => {
    if (client.type === 'connected') return 'connected';
    if (client.type === 'disabled') return 'disabled';
    if (client.type === 'pending') return 'pending';
    if (client.type === 'needs-auth') return 'needs-auth';
    return 'failed';
  };

  // Derive unified items from plugins and MCP servers
// unifiedItems 是这个组件的核心派生数据：把插件、插件内嵌的 MCP、独立 MCP、加载失败的插件、被下架的插件合并成一条扁平列表，按作用域分组再排序。合并的关键约束是「插件的子 MCP 必须紧跟在它后面」，否则排序会把父子关系打散
  const unifiedItems = useMemo(() => {
    const mergedSettings = getSettings_DEPRECATED();

    // Build map of plugin name -> child MCPs
    // Plugin MCPs have names like "plugin:pluginName:serverName"
    const pluginMcpMap = new Map<string, Array<{
      displayName: string;
      client: MCPServerConnection;
    }>>();
// 插件内嵌的 MCP 靠命名约定识别：名字形如 plugin:插件名:服务器名。这里把第三段之后全部拼回服务器名，因为服务器名本身可能含冒号
    for (const client_0 of mcpClients) {
      if (client_0.name.startsWith('plugin:')) {
        const parts = client_0.name.split(':');
        if (parts.length >= 3) {
          const pluginName = parts[1]!;
          const serverName = parts.slice(2).join(':');
          const existing = pluginMcpMap.get(pluginName) || [];
          existing.push({
            displayName: serverName,
            client: client_0
          });
          pluginMcpMap.set(pluginName, existing);
        }
      }
    }

    // Build plugin items (unsorted for now)
    type PluginWithChildren = {
      item: UnifiedInstalledItem & {
        type: 'plugin';
      };
      originalScope: 'user' | 'project' | 'local' | 'managed' | 'builtin';
      childMcps: Array<{
        displayName: string;
        client: MCPServerConnection;
      }>;
    };
    const pluginsWithChildren: PluginWithChildren[] = [];
    for (const state of pluginStates) {
// 启用状态读的是合并后的设置（不是某一个文件的设置），所以组织策略、项目设置、用户设置三层里任何一层禁用都会体现出来
      const pluginId = `${state.plugin.name}@${state.marketplace}`;
      const isEnabled = mergedSettings?.enabledPlugins?.[pluginId] !== false;
      const errors = pluginErrors.filter(e => 'plugin' in e && e.plugin === state.plugin.name || e.source === pluginId || e.source.startsWith(`${state.plugin.name}@`));

      // Built-in plugins use 'builtin' scope; others look up from V2 data.
      const originalScope = state.plugin.isBuiltin ? 'builtin' : state.scope || 'user';
      pluginsWithChildren.push({
        item: {
          type: 'plugin',
          id: pluginId,
          name: state.plugin.name,
          description: state.plugin.manifest.description,
          marketplace: state.marketplace,
          scope: originalScope,
          isEnabled,
          errorCount: errors.length,
          errors,
          plugin: state.plugin,
          pendingEnable: state.pendingEnable,
          pendingUpdate: state.pendingUpdate,
          pendingToggle: pendingToggles.get(pluginId)
        },
        originalScope,
        childMcps: pluginMcpMap.get(state.plugin.name) || []
      });
    }

// 孤儿错误 = 插件彻底没加载起来、但设置里还有记录：这些条目不在 loadAllPlugins 的结果里，只能从错误列表反推，否则用户会看到「设置里明明有、界面里找不到」
    // Find orphan errors (errors for plugins that failed to load entirely)
    const matchedPluginIds = new Set(pluginsWithChildren.map(({
      item
    }) => item.id));
    const matchedPluginNames = new Set(pluginsWithChildren.map(({
      item: item_0
    }) => item_0.name));
    const orphanErrorsBySource = new Map<string, typeof pluginErrors>();
    for (const error of pluginErrors) {
      if (matchedPluginIds.has(error.source) || 'plugin' in error && typeof error.plugin === 'string' && matchedPluginNames.has(error.plugin)) {
        continue;
      }
      const existing_0 = orphanErrorsBySource.get(error.source) || [];
      existing_0.push(error);
      orphanErrorsBySource.set(error.source, existing_0);
    }
    const pluginScopes = getPluginEditableScopes();
    const failedPluginItems: UnifiedInstalledItem[] = [];
    for (const [pluginId_0, errors_0] of orphanErrorsBySource) {
      // Skip plugins that are already shown in the flagged section
      if (pluginId_0 in flaggedPlugins) continue;
      const parsed = parsePluginIdentifier(pluginId_0);
      const pluginName_0 = parsed.name || pluginId_0;
      const marketplace = parsed.marketplace || 'unknown';
      const rawScope = pluginScopes.get(pluginId_0);
// flag（会话级，来自 --plugin-dir）与 undefined 都归成 user：展示用的作用域模型里没有 flag 这一档，宁可显示成 user 也不能丢条目
      // 'flag' is session-only (from --plugin-dir / flagSettings) and undefined
      // means the plugin isn't in any settings source. Default both to 'user'
      // since UnifiedInstalledItem doesn't have a 'flag' scope variant.
      const scope = rawScope === 'flag' || rawScope === undefined ? 'user' : rawScope;
      failedPluginItems.push({
        type: 'failed-plugin',
        id: pluginId_0,
        name: pluginName_0,
        marketplace,
        scope,
        errorCount: errors_0.length,
        errors: errors_0
      });
    }

    // Build standalone MCP items
// 独立 MCP 排除两类：ide（内置的编辑器集成，不是用户装的）与 plugin: 前缀（已经作为插件子项出现过了）
    const standaloneMcps: UnifiedInstalledItem[] = [];
    for (const client_1 of mcpClients) {
      if (client_1.name === 'ide') continue;
      if (client_1.name.startsWith('plugin:')) continue;
      standaloneMcps.push({
        type: 'mcp',
        id: `mcp:${client_1.name}`,
        name: client_1.name,
        description: undefined,
        scope: client_1.config.scope,
        status: getMcpStatus(client_1),
        client: client_1
      });
    }

    // Define scope order for display
// 作用域排序表刻意留了 99 这个默认值：未知作用域排最后而不是崩掉。flagged 用 -1 顶到最前面，因为它是最需要用户注意的一类
    const scopeOrder: Record<string, number> = {
      flagged: -1,
      project: 0,
      local: 1,
      user: 2,
      enterprise: 3,
      managed: 4,
      dynamic: 5,
      builtin: 6
    };

    // Build final list by merging plugins (with their child MCPs) and standalone MCPs
    // Group by scope to avoid duplicate scope headers
    const unified: UnifiedInstalledItem[] = [];

    // Create a map of scope -> items for proper merging
    const itemsByScope = new Map<string, UnifiedInstalledItem[]>();

    // Add plugins with their child MCPs
    for (const {
      item: item_1,
      originalScope: originalScope_0,
      childMcps
    } of pluginsWithChildren) {
      const scope_0 = item_1.scope;
      if (!itemsByScope.has(scope_0)) {
        itemsByScope.set(scope_0, []);
      }
      itemsByScope.get(scope_0)!.push(item_1);
      // Add child MCPs right after the plugin, indented (use original scope, not 'flagged').
      // Built-in plugins map to 'user' for display since MCP ConfigScope doesn't include 'builtin'.
      for (const {
        displayName,
        client: client_2
      } of childMcps) {
        const displayScope = originalScope_0 === 'builtin' ? 'user' : originalScope_0;
        if (!itemsByScope.has(displayScope)) {
          itemsByScope.set(displayScope, []);
        }
        itemsByScope.get(displayScope)!.push({
          type: 'mcp',
          id: `mcp:${client_2.name}`,
          name: displayName,
          description: undefined,
          scope: displayScope,
          status: getMcpStatus(client_2),
          client: client_2,
          indented: true
        });
      }
    }

    // Add standalone MCPs to their respective scope groups
    for (const mcp of standaloneMcps) {
      const scope_1 = mcp.scope;
      if (!itemsByScope.has(scope_1)) {
        itemsByScope.set(scope_1, []);
      }
      itemsByScope.get(scope_1)!.push(mcp);
    }

    // Add failed plugins to their respective scope groups
    for (const failedPlugin of failedPluginItems) {
      const scope_2 = failedPlugin.scope;
      if (!itemsByScope.has(scope_2)) {
        itemsByScope.set(scope_2, []);
      }
      itemsByScope.get(scope_2)!.push(failedPlugin);
    }

    // Add flagged (delisted) plugins from user settings.
    // Reason/text are looked up from the cached security messages file.
    for (const [pluginId_1, entry] of Object.entries(flaggedPlugins)) {
      const parsed_0 = parsePluginIdentifier(pluginId_1);
      const pluginName_1 = parsed_0.name || pluginId_1;
      const marketplace_0 = parsed_0.marketplace || 'unknown';
// 被下架插件的信息（原因、说明文案）从缓存的安全消息文件里查，而不是存在设置里——这样下架名单可以随服务端更新，用户本地只留一个 ID 与时间
      if (!itemsByScope.has('flagged')) {
        itemsByScope.set('flagged', []);
      }
      itemsByScope.get('flagged')!.push({
        type: 'flagged-plugin',
        id: pluginId_1,
        name: pluginName_1,
        marketplace: marketplace_0,
        scope: 'flagged',
        reason: 'delisted',
        text: 'Removed from marketplace',
        flaggedAt: entry.flaggedAt
      });
    }

    // Sort scopes and build final list
    const sortedScopes = [...itemsByScope.keys()].sort((a, b) => (scopeOrder[a] ?? 99) - (scopeOrder[b] ?? 99));
    for (const scope_3 of sortedScopes) {
      const items = itemsByScope.get(scope_3)!;

      // Separate items into plugin groups (with their child MCPs) and standalone MCPs
      // This preserves parent-child relationships that would be broken by naive sorting
      const pluginGroups: UnifiedInstalledItem[][] = [];
      const standaloneMcpsInScope: UnifiedInstalledItem[] = [];
// 这一整段 while 循环的存在理由写在注释里：不能直接对整组条目排序，那会打断「插件 → 它的子 MCP」的相邻关系。所以先切成组（插件加紧随其后的缩进 MCP），组内保序、组间按插件名排序，独立的 MCP 再单独排
      let i = 0;
      while (i < items.length) {
        const item_2 = items[i]!;
        if (item_2.type === 'plugin' || item_2.type === 'failed-plugin' || item_2.type === 'flagged-plugin') {
          // Collect the plugin and its child MCPs as a group
          const group: UnifiedInstalledItem[] = [item_2];
          i++;
          // Look ahead for indented child MCPs
          let nextItem = items[i];
          while (nextItem?.type === 'mcp' && nextItem.indented) {
            group.push(nextItem);
            i++;
            nextItem = items[i];
          }
          pluginGroups.push(group);
        } else if (item_2.type === 'mcp' && !item_2.indented) {
          // Standalone MCP (not a child of a plugin)
          standaloneMcpsInScope.push(item_2);
          i++;
        } else {
          // Skip orphaned indented MCPs (shouldn't happen)
          i++;
        }
      }

      // Sort plugin groups by the plugin name (first item in each group)
      pluginGroups.sort((a_0, b_0) => a_0[0]!.name.localeCompare(b_0[0]!.name));

      // Sort standalone MCPs by name
      standaloneMcpsInScope.sort((a_1, b_1) => a_1.name.localeCompare(b_1.name));

      // Build final list: plugins (with their children) first, then standalone MCPs
      for (const group_0 of pluginGroups) {
        unified.push(...group_0);
      }
      unified.push(...standaloneMcpsInScope);
    }
    return unified;
  }, [pluginStates, mcpClients, pluginErrors, pendingToggles, flaggedPlugins]);

  // Mark flagged plugins as seen when the Installed view renders them.
  // After 48 hours from seenAt, they auto-clear on next load.
// 被下架插件只要在列表里出现过就标记为「已看过」，48 小时后自动清除——不标记的话用户每次打开插件管理都会被同一条已读的通知顶到眼前
  const flaggedIds = useMemo(() => unifiedItems.filter(item_3 => item_3.type === 'flagged-plugin').map(item_4 => item_4.id), [unifiedItems]);
  useEffect(() => {
    if (flaggedIds.length > 0) {
      void markFlaggedPluginsSeen(flaggedIds);
    }
  }, [flaggedIds]);

  // Filter items based on search query (matches name or description)
// 搜索同时匹配名称与描述：用户记得的往往是一句话介绍而不是精确的插件名
  const filteredItems = useMemo(() => {
    if (!searchQuery) return unifiedItems;
    const lowerQuery = searchQuery.toLowerCase();
    return unifiedItems.filter(item_5 => item_5.name.toLowerCase().includes(lowerQuery) || 'description' in item_5 && item_5.description?.toLowerCase().includes(lowerQuery));
  }, [unifiedItems, searchQuery]);

  // Selection state
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Pagination for unified list (continuous scrolling)
// 分页用连续滚动而不是翻页：一屏 8 条，选中项移动时窗口跟着滑动，这样长列表里用方向键一直往下走不会有「翻页断层」
  const pagination = usePagination<UnifiedInstalledItem>({
    totalItems: filteredItems.length,
    selectedIndex,
    maxVisible: 8
  });

  // Details view state
  const [detailsMenuIndex, setDetailsMenuIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  // Configuration state
  const [configNeeded, setConfigNeeded] = useState<McpbNeedsConfigResult | null>(null);
  const [_isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [selectedPluginHasMcpb, setSelectedPluginHasMcpb] = useState(false);

  // Detect if selected plugin has MCPB
  // Reads raw marketplace.json to work with old cached marketplaces
// MCPB 检测要读原始 marketplace.json 而不是走 schema 解析后的缓存：老的缓存条目是在 MCPB 支持之前生成的，正规路径读不到这个字段，只有绕过校验直接读文件才能兼容
  useEffect(() => {
    if (!selectedPlugin) {
      setSelectedPluginHasMcpb(false);
      return;
    }
    async function detectMcpb() {
      // Check plugin manifest first
      const mcpServersSpec = selectedPlugin!.plugin.manifest.mcpServers;
      let hasMcpb = false;
      if (mcpServersSpec) {
        hasMcpb = typeof mcpServersSpec === 'string' && isMcpbSource(mcpServersSpec) || Array.isArray(mcpServersSpec) && mcpServersSpec.some(s_2 => typeof s_2 === 'string' && isMcpbSource(s_2));
      }

      // If not in manifest, read raw marketplace.json directly (bypassing schema validation)
      // This works even with old cached marketplaces from before MCPB support
      if (!hasMcpb) {
        try {
          const marketplaceDir = path.join(selectedPlugin!.plugin.path, '..');
          const marketplaceJsonPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json');
          const content = await fs.readFile(marketplaceJsonPath, 'utf-8');
          const marketplace_1 = jsonParse(content);
          const entry_0 = marketplace_1.plugins?.find((p: {
            name: string;
          }) => p.name === selectedPlugin!.plugin.name);
          if (entry_0?.mcpServers) {
            const spec = entry_0.mcpServers;
            hasMcpb = typeof spec === 'string' && isMcpbSource(spec) || Array.isArray(spec) && spec.some((s_3: unknown) => typeof s_3 === 'string' && isMcpbSource(s_3));
          }
        } catch (err) {
          logForDebugging(`Failed to read raw marketplace.json: ${err}`);
        }
      }
      setSelectedPluginHasMcpb(hasMcpb);
    }
    void detectMcpb();
  }, [selectedPlugin]);

  // Load installed plugins grouped by marketplace
// 首次加载：跑一遍 loadAllPlugins 拿全部插件的启用与禁用两个列表，再按市场分组、算计数、排序（claude-plugin-directory 永远排第一，其余按字母）
  useEffect(() => {
    async function loadInstalledPlugins() {
      setLoading(true);
      try {
        const {
          enabled,
          disabled
        } = await loadAllPlugins();
        const mergedSettings = getSettings_DEPRECATED(); // Use merged settings to respect all layers

        const allPlugins = filterManagedDisabledPlugins([...enabled, ...disabled]);

        // Group plugins by marketplace
        const pluginsByMarketplace: Record<string, LoadedPlugin[]> = {};
        for (const plugin of allPlugins) {
          const marketplace = plugin.source.split('@')[1] || 'local';
          if (!pluginsByMarketplace[marketplace]) {
            pluginsByMarketplace[marketplace] = [];
          }
          pluginsByMarketplace[marketplace]!.push(plugin);
        }

        // Create marketplace info array with enabled/disabled counts
        const marketplaceInfos: MarketplaceInfo[] = [];
        for (const [name, plugins] of Object.entries(pluginsByMarketplace)) {
          const enabledCount = count(plugins, p => {
            const pluginId = `${p.name}@${name}`;
            return mergedSettings?.enabledPlugins?.[pluginId] !== false;
          });
          const disabledCount = plugins.length - enabledCount;
          marketplaceInfos.push({
            name,
            installedPlugins: plugins,
            enabledCount,
            disabledCount
          });
        }

        // Sort marketplaces: claude-plugin-directory first, then alphabetically
        marketplaceInfos.sort((a, b) => {
          if (a.name === 'claude-plugin-directory') return -1;
          if (b.name === 'claude-plugin-directory') return 1;
          return a.name.localeCompare(b.name);
        });
        setMarketplaces(marketplaceInfos);

        // Build flat list of all plugin states
        const allStates: PluginState[] = [];
        for (const marketplace of marketplaceInfos) {
          for (const plugin of marketplace.installedPlugins) {
            const pluginId = `${plugin.name}@${marketplace.name}`;
            // Built-in plugins don't have V2 install entries — skip the lookup.
// 作用域优先取 V2 安装记录的 scope；内置插件没有安装记录，直接给 builtin，否则查表会拿到 undefined 并在后面被当成 user，导致内置插件被允许卸载
            const scope = plugin.isBuiltin ? 'builtin' : getPluginInstallationFromV2(pluginId).scope;
            allStates.push({
              plugin,
              marketplace: marketplace.name,
              scope,
              pendingEnable: undefined,
              pendingUpdate: false
            });
          }
        }
        setPluginStates(allStates);
        setSelectedIndex(0);
      } finally {
        setLoading(false);
      }
    }
    void loadInstalledPlugins();
  }, []);

  // Auto-navigate to target plugin if specified (once only)
// 自动导航：斜杠命令带了目标插件时，直接落到详情页。这里把 targetPlugin 当成可能是 name 或 name@marketplace 两种形式解析，因为 parseArgs 是原样透传的
  useEffect(() => {
    if (hasAutoNavigated.current) return;
    if (targetPlugin && marketplaces.length > 0 && !loading) {
      // targetPlugin may be `name` or `name@marketplace` (parseArgs passes the
      // raw arg through). Parse it so p.name matching works either way.
      const {
        name: targetName,
        marketplace: targetMktFromId
      } = parsePluginIdentifier(targetPlugin);
      const effectiveTargetMarketplace = targetMarketplace ?? targetMktFromId;

      // Use targetMarketplace if provided, otherwise search all
      const marketplacesToSearch = effectiveTargetMarketplace ? marketplaces.filter(m => m.name === effectiveTargetMarketplace) : marketplaces;

      // First check successfully loaded plugins
      for (const marketplace_2 of marketplacesToSearch) {
        const plugin = marketplace_2.installedPlugins.find(p_0 => p_0.name === targetName);
        if (plugin) {
          // Get scope from V2 data for proper operation handling
          const pluginId_2 = `${plugin.name}@${marketplace_2.name}`;
          const {
            scope: scope_4
          } = getPluginInstallationFromV2(pluginId_2);
          const pluginState: PluginState = {
            plugin,
            marketplace: marketplace_2.name,
            scope: scope_4,
            pendingEnable: undefined,
            pendingUpdate: false
          };
          setSelectedPlugin(pluginState);
          setViewState('plugin-details');
          pendingAutoActionRef.current = action;
          hasAutoNavigated.current = true;
          return;
        }
      }

      // Fall back to failed plugins (those with errors but not loaded)
// 成功加载的插件里找不到就查失败列表：用户执行 /plugin uninstall broken-plugin 时，那个插件恰恰是加载失败的，只在错误列表里存在
      const failedItem = unifiedItems.find(item_6 => item_6.type === 'failed-plugin' && item_6.name === targetName);
      if (failedItem && failedItem.type === 'failed-plugin') {
        setViewState({
          type: 'failed-plugin-details',
          plugin: {
            id: failedItem.id,
            name: failedItem.name,
            marketplace: failedItem.marketplace,
            errors: failedItem.errors,
            scope: failedItem.scope
          }
        });
        hasAutoNavigated.current = true;
      }

// 两者都找不到时，只有「带了动作」才关对话框报错。纯粹浏览（/plugin manage）应该停留在列表上，不该被一条「未安装」的提示踢出去
      // No match in loaded OR failed plugins — close the dialog with a
      // message rather than silently landing on the plugin list. Only do
      // this when an action was requested (e.g. /plugin uninstall X);
      // plain navigation (/plugin manage) should still just show the list.
      if (!hasAutoNavigated.current && action) {
        hasAutoNavigated.current = true;
        setResult(`Plugin "${targetPlugin}" is not installed in this project`);
      }
    }
  }, [targetPlugin, targetMarketplace, marketplaces, loading, unifiedItems, action, setResult]);

  // Handle single plugin operations from details view
// handleSingleOperation 是详情页四个动作（启用/禁用/更新/卸载）的唯一入口，前面是两层权限闸门：内置插件不许更新卸载，托管作用域不许启用禁用卸载（只能更新，因为那是组织下发的版本）
  const handleSingleOperation = async (operation: 'enable' | 'disable' | 'update' | 'uninstall') => {
    if (!selectedPlugin) return;
    const pluginScope = selectedPlugin.scope || 'user';
    const isBuiltin = pluginScope === 'builtin';

    // Built-in plugins can only be enabled/disabled, not updated/uninstalled.
    if (isBuiltin && (operation === 'update' || operation === 'uninstall')) {
      setProcessError('Built-in plugins cannot be updated or uninstalled.');
      return;
    }

    // Managed scope plugins can only be updated, not enabled/disabled/uninstalled
    if (!isBuiltin && !isInstallableScope(pluginScope) && operation !== 'update') {
      setProcessError('This plugin is managed by your organization. Contact your admin to disable it.');
      return;
    }
    setIsProcessing(true);
    setProcessError(null);
    try {
      const pluginId_3 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
// enabled/disable 刻意不传 scope：这里的 pluginScope 来自 installed_plugins.json（文件缓存的位置），可能与设置里的作用域不一致，传进去会触发「跨作用域操作」的保护性拒绝。让下游自动探测才是对的
      let reverseDependents: string[] | undefined;

      // enable/disable omit scope — pluginScope is the install scope from
      // installed_plugins.json (where files are cached), which can diverge
      // from the settings scope (where enablement lives). Passing it trips
      // the cross-scope guard. Auto-detect finds the right scope. #38084
      switch (operation) {
        case 'enable':
          {
            const enableResult = await enablePluginOp(pluginId_3);
            if (!enableResult.success) {
              throw new Error(enableResult.message);
            }
            break;
          }
        case 'disable':
          {
            const disableResult = await disablePluginOp(pluginId_3);
            if (!disableResult.success) {
              throw new Error(disableResult.message);
            }
            reverseDependents = disableResult.reverseDependents;
            break;
          }
        case 'uninstall':
          {
            if (isBuiltin) break; // guarded above; narrows pluginScope
            if (!isInstallableScope(pluginScope)) break;
// 卸载前先查「是否在项目级设置里启用」：如果在 .claude/settings.json（团队共享）里启用，直接卸载会让项目里其他人受影响，所以转到一个「只在我本地禁用」的确认页。这里必须直接读设置文件判断，因为 pluginScope 可能是 user 而同一插件同时被项目级启用
            // If the plugin is enabled in .claude/settings.json (shared with the
            // team), divert to a confirmation dialog that offers to disable in
            // settings.local.json instead. Check the settings file directly —
            // `pluginScope` (from installed_plugins.json) can be 'user' even when
            // the plugin is ALSO project-enabled, and uninstalling the user-scope
            // install would leave the project enablement active.
            if (isPluginEnabledAtProjectScope(pluginId_3)) {
              setIsProcessing(false);
              setViewState('confirm-project-uninstall');
              return;
            }
// 有持久数据目录（CLAUDE_PLUGIN_DATA）且这是最后一个安装作用域时才问「要不要连数据一起删」。多作用域安装时下游的 isLastScope 检查本来就不会删，此时再弹窗说「删」却什么都不删，就是在骗用户
            // If the plugin has persistent data (${CLAUDE_PLUGIN_DATA}) AND this
            // is the last scope, prompt before deleting it. For multi-scope
            // installs, the op's isLastScope check won't delete regardless of
            // the user's y/n — showing the dialog would mislead ("y" → nothing
            // happens). Length check mirrors pluginOperations.ts:513.
            const installs = loadInstalledPluginsV2().plugins[pluginId_3];
            const isLastScope = !installs || installs.length <= 1;
            const dataSize = isLastScope ? await getPluginDataDirSize(pluginId_3) : null;
            if (dataSize) {
              setIsProcessing(false);
              setViewState({
                type: 'confirm-data-cleanup',
                size: dataSize
              });
              return;
            }
            const result_0 = await uninstallPluginOp(pluginId_3, pluginScope);
            if (!result_0.success) {
              throw new Error(result_0.message);
            }
            reverseDependents = result_0.reverseDependents;
            break;
          }
        case 'update':
          {
            if (isBuiltin) break; // guarded above; narrows pluginScope
            const result = await updatePluginOp(pluginId_3, pluginScope);
            if (!result.success) {
              throw new Error(result.message);
            }
            // If already up to date, show message and exit
            if (result.alreadyUpToDate) {
              setResult(`${selectedPlugin.plugin.name} is already at the latest version (${result.newVersion}).`);
              if (onManageComplete) {
                await onManageComplete();
              }
              setParentViewState({
                type: 'menu'
              });
              return;
            }
            // Success - will show standard message below
            break;
          }
      }

// 四个操作函数自己负责写设置，所以这里只需清缓存。缓存的清理必须在这里做而不是在操作函数里，因为这些函数也被非交互路径调用
      // Operations (enable, disable, uninstall, update) now use centralized functions
      // that handle their own settings updates, so we only need to clear caches here
      clearAllCaches();

// 操作完不按「操作是不是 enable」来判断要不要弹配置，而是重新读一次设置看插件此刻是否处于启用态：安装流程本身会启用插件，所以从菜单进来时第一项显示的往往是「禁用」
      // Prompt for manifest.userConfig + channel userConfig if the plugin ends
      // up enabled. Re-read settings rather than keying on `operation ===
      // 'enable'`: install enables on install, so the menu shows "Disable"
      // first. PluginOptionsFlow itself checks getUnconfiguredOptions — if
      // nothing needs filling, it calls onDone('skipped') immediately.
      const pluginIdNow = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
      const settingsAfter = getSettings_DEPRECATED();
      const enabledAfter = settingsAfter?.enabledPlugins?.[pluginIdNow] !== false;
      if (enabledAfter) {
        setIsProcessing(false);
        setViewState({
          type: 'plugin-options'
        });
        return;
      }
      const operationName = operation === 'enable' ? 'Enabled' : operation === 'disable' ? 'Disabled' : operation === 'update' ? 'Updated' : 'Uninstalled';

// 依赖被反向引用的警告必须压成一行：通知的存活时间约 8 秒，多行会被截断；持久记录在错误页里（重载后会出现 dependency-unsatisfied）
      // Single-line warning — notification timeout is ~8s, multi-line would scroll off.
      // The persistent record is in the Errors tab (dependency-unsatisfied after reload).
      const depWarn = reverseDependents && reverseDependents.length > 0 ? ` · required by ${reverseDependents.join(', ')}` : '';
      const message = `✓ ${operationName} ${selectedPlugin.plugin.name}${depWarn}. Run /reload-plugins to apply.`;
      setResult(message);
      if (onManageComplete) {
        await onManageComplete();
      }
      setParentViewState({
        type: 'menu'
      });
    } catch (error_0) {
      setIsProcessing(false);
      const errorMessage = error_0 instanceof Error ? error_0.message : String(error_0);
      setProcessError(`Failed to ${operation}: ${errorMessage}`);
      logError(toError(error_0));
    }
  };

// handleSingleOperation 每次渲染都是新函数，直接放进 effect 依赖会让 effect 每次都跑。用 latest-ref 模式：ref 每渲染更新，effect 只依赖 viewState 与 selectedPlugin
  // Latest-ref: lets the auto-action effect call the current closure without
  // adding handleSingleOperation (recreated every render) to its deps.
  const handleSingleOperationRef = useRef(handleSingleOperation);
  handleSingleOperationRef.current = handleSingleOperation;

  // Auto-execute the action prop (/plugin uninstall X, /plugin enable X, etc.)
  // once auto-navigation has landed on plugin-details.
// 自动动作的消费点：导航落到详情页且有待执行动作时才触发，触发前先清空 ref——这个 effect 会因为 viewState 变化重跑，不清空就会重复执行（比如卸载两次）
  useEffect(() => {
    if (viewState === 'plugin-details' && selectedPlugin && pendingAutoActionRef.current) {
      const pending = pendingAutoActionRef.current;
      pendingAutoActionRef.current = undefined;
      void handleSingleOperationRef.current(pending);
    }
  }, [viewState, selectedPlugin]);

  // Handle toggle enable/disable
// 空格键的即时开关：与详情页里的操作不同，这里是「先改设置、再标记为待生效」，而不是攒到最后一起提交。取消时执行反向操作回到原状态
  const handleToggle = React.useCallback(() => {
    if (selectedIndex >= filteredItems.length) return;
    const item_7 = filteredItems[selectedIndex];
    if (item_7?.type === 'flagged-plugin') return;
    if (item_7?.type === 'plugin') {
      const pluginId_4 = `${item_7.plugin.name}@${item_7.marketplace}`;
      const mergedSettings_0 = getSettings_DEPRECATED();
      const currentPending = pendingToggles.get(pluginId_4);
      const isEnabled_0 = mergedSettings_0?.enabledPlugins?.[pluginId_4] !== false;
      const pluginScope_0 = item_7.scope;
      const isBuiltin_0 = pluginScope_0 === 'builtin';
      if (isBuiltin_0 || isInstallableScope(pluginScope_0)) {
        const newPending = new Map(pendingToggles);
        // Omit scope — see handleSingleOperation's enable/disable comment.
        if (currentPending) {
          // Cancel: reverse the operation back to the original state
          newPending.delete(pluginId_4);
          void (async () => {
            try {
              if (currentPending === 'will-disable') {
                await enablePluginOp(pluginId_4);
              } else {
                await disablePluginOp(pluginId_4);
              }
              clearAllCaches();
            } catch (err_0) {
              logError(err_0);
            }
          })();
        } else {
          newPending.set(pluginId_4, isEnabled_0 ? 'will-disable' : 'will-enable');
          void (async () => {
            try {
              if (isEnabled_0) {
                await disablePluginOp(pluginId_4);
              } else {
                await enablePluginOp(pluginId_4);
              }
              clearAllCaches();
            } catch (err_1) {
              logError(err_1);
            }
          })();
        }
        setPendingToggles(newPending);
      }
    } else if (item_7?.type === 'mcp') {
      void toggleMcpServer(item_7.client.name);
    }
  }, [selectedIndex, filteredItems, pendingToggles, pluginStates, toggleMcpServer]);

  // Handle accept (Enter) in plugin-list
// 回车进入详情：按类型分派到五种视图。注意 plugin 类型要回查 pluginStates 拿完整的编辑态，而不是用列表项里那份精简数据
  const handleAccept = React.useCallback(() => {
    if (selectedIndex >= filteredItems.length) return;
    const item_8 = filteredItems[selectedIndex];
    if (item_8?.type === 'plugin') {
      const state_0 = pluginStates.find(s_4 => s_4.plugin.name === item_8.plugin.name && s_4.marketplace === item_8.marketplace);
      if (state_0) {
        setSelectedPlugin(state_0);
        setViewState('plugin-details');
        setDetailsMenuIndex(0);
        setProcessError(null);
      }
    } else if (item_8?.type === 'flagged-plugin') {
      setViewState({
        type: 'flagged-detail',
        plugin: {
          id: item_8.id,
          name: item_8.name,
          marketplace: item_8.marketplace,
          reason: item_8.reason,
          text: item_8.text,
          flaggedAt: item_8.flaggedAt
        }
      });
      setProcessError(null);
    } else if (item_8?.type === 'failed-plugin') {
      setViewState({
        type: 'failed-plugin-details',
        plugin: {
          id: item_8.id,
          name: item_8.name,
          marketplace: item_8.marketplace,
          errors: item_8.errors,
          scope: item_8.scope
        }
      });
      setDetailsMenuIndex(0);
      setProcessError(null);
    } else if (item_8?.type === 'mcp') {
      setViewState({
        type: 'mcp-detail',
        client: item_8.client
      });
      setProcessError(null);
    }
  }, [selectedIndex, filteredItems, pluginStates]);

  // Plugin-list navigation (non-search mode)
// 导航键在列表顶部的行为是「向上越界即进入搜索」——这是一个刻意的设计，让用户不用记 / 键也能开始输入
  useKeybindings({
    'select:previous': () => {
      if (selectedIndex === 0) {
        setIsSearchMode(true);
      } else {
        pagination.handleSelectionChange(selectedIndex - 1, setSelectedIndex);
      }
    },
    'select:next': () => {
      if (selectedIndex < filteredItems.length - 1) {
        pagination.handleSelectionChange(selectedIndex + 1, setSelectedIndex);
      }
    },
    'select:accept': handleAccept
  }, {
    context: 'Select',
    isActive: viewState === 'plugin-list' && !isSearchMode
  });
  useKeybindings({
    'plugin:toggle': handleToggle
  }, {
    context: 'Plugin',
    isActive: viewState === 'plugin-list' && !isSearchMode
  });

  // Handle dismiss action in flagged-detail view
// 被下架插件的详情页只有一个动作：忽略。忽略后从设置里移除记录，下次不再出现
  const handleFlaggedDismiss = React.useCallback(() => {
    if (typeof viewState !== 'object' || viewState.type !== 'flagged-detail') return;
    void removeFlaggedPlugin(viewState.plugin.id);
    setViewState('plugin-list');
  }, [viewState]);
  useKeybindings({
    'select:accept': handleFlaggedDismiss
  }, {
    context: 'Select',
    isActive: typeof viewState === 'object' && viewState.type === 'flagged-detail'
  });

  // Build details menu items (needed for navigation)
// 详情页菜单是动态构建的：启用/禁用恒有；更新/卸载/配置仅非内置有；Mark for update 与 Configure 视清单字段而定；主页与仓库链接视清单字段而定；最后永远有「返回列表」。所以索引导航必须先有这份数组，不能边渲染边算
  const detailsMenuItems = React.useMemo(() => {
    if (viewState !== 'plugin-details' || !selectedPlugin) return [];
    const mergedSettings_1 = getSettings_DEPRECATED();
    const pluginId_5 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const isEnabled_1 = mergedSettings_1?.enabledPlugins?.[pluginId_5] !== false;
// 这里判内置用的是 marketplace 字符串而不是 scope：两者理论上一致，但内置插件的 scope 可能被下游映射过，用市场名更稳
    const isBuiltin_1 = selectedPlugin.marketplace === 'builtin';
    const menuItems: Array<{
      label: string;
      action: () => void;
    }> = [];
    menuItems.push({
      label: isEnabled_1 ? 'Disable plugin' : 'Enable plugin',
      action: () => void handleSingleOperation(isEnabled_1 ? 'disable' : 'enable')
    });

    // Update/Uninstall options — not available for built-in plugins
    if (!isBuiltin_1) {
      menuItems.push({
        label: selectedPlugin.pendingUpdate ? 'Unmark for update' : 'Mark for update',
        action: async () => {
          try {
            const localError = await checkIfLocalPlugin(selectedPlugin.plugin.name, selectedPlugin.marketplace);
            if (localError) {
              setProcessError(localError);
              return;
            }
            const newStates = [...pluginStates];
            const index = newStates.findIndex(s_5 => s_5.plugin.name === selectedPlugin.plugin.name && s_5.marketplace === selectedPlugin.marketplace);
            if (index !== -1) {
              newStates[index]!.pendingUpdate = !selectedPlugin.pendingUpdate;
              setPluginStates(newStates);
              setSelectedPlugin({
                ...selectedPlugin,
                pendingUpdate: !selectedPlugin.pendingUpdate
              });
            }
          } catch (error_1) {
            setProcessError(error_1 instanceof Error ? error_1.message : 'Failed to check plugin update availability');
          }
        }
      });
// 只有检测到 MCPB 才显示 Configure 项——否则点进去必然报「没找到 MCPB 文件」
      if (selectedPluginHasMcpb) {
        menuItems.push({
          label: 'Configure',
          action: async () => {
            setIsLoadingConfig(true);
            try {
              const mcpServersSpec_0 = selectedPlugin.plugin.manifest.mcpServers;
              let mcpbPath: string | null = null;
              if (typeof mcpServersSpec_0 === 'string' && isMcpbSource(mcpServersSpec_0)) {
                mcpbPath = mcpServersSpec_0;
              } else if (Array.isArray(mcpServersSpec_0)) {
                for (const spec_0 of mcpServersSpec_0) {
                  if (typeof spec_0 === 'string' && isMcpbSource(spec_0)) {
                    mcpbPath = spec_0;
                    break;
                  }
                }
              }
              if (!mcpbPath) {
                setProcessError('No MCPB file found in plugin');
                setIsLoadingConfig(false);
                return;
              }
              const pluginId_6 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
              const result_1 = await loadMcpbFile(mcpbPath, selectedPlugin.plugin.path, pluginId_6, undefined, undefined, true);
              if ('status' in result_1 && result_1.status === 'needs-config') {
                setConfigNeeded(result_1);
                setViewState('configuring');
              } else {
                setProcessError('Failed to load MCPB for configuration');
              }
            } catch (err_2) {
              const errorMsg = errorMessage(err_2);
              setProcessError(`Failed to load configuration: ${errorMsg}`);
            } finally {
              setIsLoadingConfig(false);
            }
          }
        });
      }
      if (selectedPlugin.plugin.manifest.userConfig && Object.keys(selectedPlugin.plugin.manifest.userConfig).length > 0) {
        menuItems.push({
          label: 'Configure options',
          action: () => {
            setViewState({
              type: 'configuring-options',
              schema: selectedPlugin.plugin.manifest.userConfig!
            });
          }
        });
      }
      menuItems.push({
        label: 'Update now',
        action: () => void handleSingleOperation('update')
      });
      menuItems.push({
        label: 'Uninstall',
        action: () => void handleSingleOperation('uninstall')
      });
    }
    if (selectedPlugin.plugin.manifest.homepage) {
      menuItems.push({
        label: 'Open homepage',
        action: () => void openBrowser(selectedPlugin.plugin.manifest.homepage!)
      });
    }
// 仓库链接用通用文案而不是 View on GitHub：清单里的 repository 可能是 GitLab、Bitbucket、Azure DevOps，写死 GitHub 会误导。同目录的 pluginDetailsHelpers 保留 GitHub 文案是因为那条路径有显式的 isGitHub 判断
    if (selectedPlugin.plugin.manifest.repository) {
      menuItems.push({
        // Generic label — manifest.repository can be GitLab, Bitbucket,
        // Azure DevOps, etc. (gh-31598). pluginDetailsHelpers.tsx:74 keeps
        // 'View on GitHub' because that path has an explicit isGitHub check.
        label: 'View repository',
        action: () => void openBrowser(selectedPlugin.plugin.manifest.repository!)
      });
    }
    menuItems.push({
      label: 'Back to plugin list',
      action: () => {
        setViewState('plugin-list');
        setSelectedPlugin(null);
        setProcessError(null);
      }
    });
    return menuItems;
  }, [viewState, selectedPlugin, selectedPluginHasMcpb, pluginStates]);

  // Plugin-details navigation
  useKeybindings({
    'select:previous': () => {
      if (detailsMenuIndex > 0) {
        setDetailsMenuIndex(detailsMenuIndex - 1);
      }
    },
    'select:next': () => {
      if (detailsMenuIndex < detailsMenuItems.length - 1) {
        setDetailsMenuIndex(detailsMenuIndex + 1);
      }
    },
    'select:accept': () => {
      if (detailsMenuItems[detailsMenuIndex]) {
        detailsMenuItems[detailsMenuIndex]!.action();
      }
    }
  }, {
    context: 'Select',
    isActive: viewState === 'plugin-details' && !!selectedPlugin
  });

  // Failed-plugin-details: only "Uninstall" option, handle Enter
// 失败插件的详情页只有一个动作：移除。这里做了一件补救——卸载操作失败时，说明这个插件从来没真正安装过（只在 enabledPlugins 里留了记录），于是直接到三个可编辑的设置源里把那条记录抹掉
  useKeybindings({
    'select:accept': () => {
      if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
        void (async () => {
          setIsProcessing(true);
          setProcessError(null);
          const pluginId_7 = viewState.plugin.id;
          const pluginScope_1 = viewState.plugin.scope;
          // Pass scope to uninstallPluginOp so it can find the correct V2
          // installation record and clean up on-disk files. Fall back to
          // default scope if not installable (e.g. 'managed', though that
          // case is guarded by isActive below). deleteDataDir=false: this
          // is a recovery path for a plugin that failed to load — it may
          // be reinstallable, so don't nuke ${CLAUDE_PLUGIN_DATA} silently.
          // The normal uninstall path prompts; this one preserves.
// deleteDataDir 传 false：这是「加载失败」的恢复路径，插件之后可能被重装，静默删掉数据目录是不可接受的。正常卸载路径会弹窗询问
          const result_2 = isInstallableScope(pluginScope_1) ? await uninstallPluginOp(pluginId_7, pluginScope_1, false) : await uninstallPluginOp(pluginId_7, 'user', false);
          let success = result_2.success;
          if (!success) {
            // Plugin was never installed (only in enabledPlugins settings).
            // Remove directly from all editable settings sources.
            const editableSources = ['userSettings' as const, 'projectSettings' as const, 'localSettings' as const];
            for (const source of editableSources) {
              const settings = getSettingsForSource(source);
              if (settings?.enabledPlugins?.[pluginId_7] !== undefined) {
                updateSettingsForSource(source, {
                  enabledPlugins: {
                    ...settings.enabledPlugins,
                    [pluginId_7]: undefined
                  }
                });
                success = true;
              }
            }
            // Clear memoized caches so next loadAllPlugins() picks up settings changes
            clearAllCaches();
          }
          if (success) {
            if (onManageComplete) {
              await onManageComplete();
            }
            setIsProcessing(false);
            // Return to list (don't setResult — that closes the whole dialog)
            setViewState('plugin-list');
          } else {
            setIsProcessing(false);
            setProcessError(result_2.message);
          }
        })();
      }
    }
  }, {
    context: 'Select',
    isActive: typeof viewState === 'object' && viewState.type === 'failed-plugin-details' && viewState.plugin.scope !== 'managed'
  });

  // Confirm-project-uninstall: y/enter disables in settings.local.json, n/escape cancels
// 项目级卸载确认页：确认时直接把 false 写进 settings.local.json。注释说明了为什么不能复用 disablePluginOp——那个函数的跨作用域保护会拒绝这次写入，而这里要的恰恰就是写一条覆盖值
  useKeybindings({
    'confirm:yes': () => {
      if (!selectedPlugin) return;
      setIsProcessing(true);
      setProcessError(null);
      const pluginId_8 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
      // Write `false` directly — disablePluginOp's cross-scope guard would
      // reject this (plugin isn't in localSettings yet; the override IS the
      // point).
      const {
        error: error_2
      } = updateSettingsForSource('localSettings', {
        enabledPlugins: {
          ...getSettingsForSource('localSettings')?.enabledPlugins,
          [pluginId_8]: false
        }
      });
      if (error_2) {
        setIsProcessing(false);
        setProcessError(`Failed to write settings: ${error_2.message}`);
        return;
      }
      clearAllCaches();
      setResult(`✓ Disabled ${selectedPlugin.plugin.name} in .claude/settings.local.json. Run /reload-plugins to apply.`);
      if (onManageComplete) void onManageComplete();
      setParentViewState({
        type: 'menu'
      });
    },
    'confirm:no': () => {
      setViewState('plugin-details');
      setProcessError(null);
    }
  }, {
    context: 'Confirmation',
    isActive: viewState === 'confirm-project-uninstall' && !!selectedPlugin && !isProcessing
  });

// 数据清理确认页用原始 useInput 而不是键位绑定，理由有两条：Confirmation 上下文把回车映射成 confirm:yes，那会让「回车」变成删数据的破坏性默认（而界面文案只写了 y 删、n 留）；另外这里 n 与 esc 是两个不同动作（保留数据 vs 取消），而键位系统里两者都映射成 confirm:no
  // Confirm-data-cleanup: y uninstalls + deletes data dir, n uninstalls + keeps,
  // esc cancels. Raw useInput because: (1) the Confirmation context maps
  // enter→confirm:yes, which would make Enter delete the data directory — a
  // destructive default the UI text ("y to delete · n to keep") doesn't
  // advertise; (2) unlike confirm-project-uninstall (which uses useKeybindings
  // where n and escape both map to confirm:no), here n and escape are DIFFERENT
  // actions (keep-data vs cancel), so this deliberately stays on raw useInput.
  // eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw y/n/esc; Enter must not trigger destructive delete
  useInput((input, key) => {
    if (!selectedPlugin) return;
    const pluginId_9 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const pluginScope_2 = selectedPlugin.scope;
    // Dialog is only reachable from the uninstall case (which guards on
    // isBuiltin), but TS can't track that across viewState transitions.
    if (!pluginScope_2 || pluginScope_2 === 'builtin' || !isInstallableScope(pluginScope_2)) return;
// 卸载与「删不删数据」在同一次操作里完成：先卸载，再按标志决定是否连带删目录。失败时留在当前页显示错误，成功才回到菜单
    const doUninstall = async (deleteDataDir: boolean) => {
      setIsProcessing(true);
      setProcessError(null);
      try {
        const result_3 = await uninstallPluginOp(pluginId_9, pluginScope_2, deleteDataDir);
        if (!result_3.success) throw new Error(result_3.message);
        clearAllCaches();
        const suffix = deleteDataDir ? '' : ' · data preserved';
        setResult(`${figures.tick} ${result_3.message}${suffix}`);
        if (onManageComplete) void onManageComplete();
        setParentViewState({
          type: 'menu'
        });
      } catch (e_0) {
        setIsProcessing(false);
        setProcessError(e_0 instanceof Error ? e_0.message : String(e_0));
      }
    };
    if (input === 'y' || input === 'Y') {
      void doUninstall(true);
    } else if (input === 'n' || input === 'N') {
      void doUninstall(false);
    } else if (key.escape) {
      setViewState('plugin-details');
      setProcessError(null);
    }
  }, {
    isActive: typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup' && !!selectedPlugin && !isProcessing
  });

  // Reset selection when search query changes
// 搜索词一变就把选中项归零：否则选中索引可能落在新结果集的边界之外，出现「高亮在空行上」
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Handle input for entering search mode (text input handled by useSearchInput hook)
  // eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for raw search mode text input
// 列表页的原始输入处理只做一件事：把任意可打印字符（除 j/k/空格这三个导航键）当成搜索的起始字符。这样用户直接打字就能搜，不用先按 /
  useInput((input_0, key_0) => {
    const keyIsNotCtrlOrMeta = !key_0.ctrl && !key_0.meta;
    if (isSearchMode) {
      // Text input is handled by useSearchInput hook
      return;
    }

    // Enter search mode with '/' or any printable character (except navigation keys)
    if (input_0 === '/' && keyIsNotCtrlOrMeta) {
      setIsSearchMode(true);
      setSearchQuery('');
      setSelectedIndex(0);
    } else if (keyIsNotCtrlOrMeta && input_0.length > 0 && !/^\s+$/.test(input_0) && input_0 !== 'j' && input_0 !== 'k' && input_0 !== ' ') {
      setIsSearchMode(true);
      setSearchQuery(input_0);
      setSelectedIndex(0);
    }
  }, {
    isActive: viewState === 'plugin-list'
  });

  // Loading state
// 加载态是一个全局提前返回，返回到这里时所有 hook 都已经调用过——顺序不能颠倒，否则违反 hook 规则
  if (loading) {
    return <Text>Loading installed plugins…</Text>;
  }

  // No plugins or MCPs installed
// 空态也要给「Esc 返回」的提示：否则用户会以为界面卡住了
  if (unifiedItems.length === 0) {
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Manage plugins</Text>
        </Box>
        <Text>No plugins or MCP servers installed.</Text>
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>;
  }
// plugin-options 视图：插件已启用，接着问清单里声明的 userConfig。三条出路（配置了/跳过/出错）都走同一个 finish，因为无论配置成败，插件此刻都是启用状态，都要触发「去重载」的提示
  if (typeof viewState === 'object' && viewState.type === 'plugin-options' && selectedPlugin) {
    const pluginId_10 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    function finish(msg: string): void {
      setResult(msg);
      // Plugin is enabled regardless of whether config was saved or
      // skipped — onManageComplete → markPluginsChanged → the
      // persistent "run /reload-plugins" notice.
      if (onManageComplete) {
        void onManageComplete();
      }
      setParentViewState({
        type: 'menu'
      });
    }
    return <PluginOptionsFlow plugin={selectedPlugin.plugin} pluginId={pluginId_10} onDone={(outcome, detail) => {
      switch (outcome) {
        case 'configured':
          finish(`✓ Enabled and configured ${selectedPlugin.plugin.name}. Run /reload-plugins to apply.`);
          break;
        case 'skipped':
          finish(`✓ Enabled ${selectedPlugin.plugin.name}. Run /reload-plugins to apply.`);
          break;
        case 'error':
          finish(`Failed to save configuration: ${detail}`);
          break;
      }
    }} />;
  }

  // Configure options (from the Manage menu)
// configuring-options 与上面的差别：这里是用户主动点「Configure options」，初始值从已保存的选项里读，保存后回到详情页而不是关闭对话框
  if (typeof viewState === 'object' && viewState.type === 'configuring-options' && selectedPlugin) {
    const pluginId_11 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    return <PluginOptionsDialog title={`Configure ${selectedPlugin.plugin.name}`} subtitle="Plugin options" configSchema={viewState.schema} initialValues={loadPluginOptions(pluginId_11)} onSave={values => {
      try {
        savePluginOptions(pluginId_11, values, viewState.schema);
        clearAllCaches();
        setResult('Configuration saved. Run /reload-plugins for changes to take effect.');
      } catch (err_3) {
        setProcessError(`Failed to save configuration: ${errorMessage(err_3)}`);
      }
      setViewState('plugin-details');
    }} onCancel={() => setViewState('plugin-details')} />;
  }

  // Configuration view
// configuring 视图对应 MCPB 的配置流程：保存时要把 MCPB 路径再找一遍（状态里只存了 schema 没存路径），重新加载一次文件才会把配置写进去
  if (viewState === 'configuring' && configNeeded && selectedPlugin) {
    const pluginId_12 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    async function handleSave(config: UserConfigValues) {
      if (!configNeeded || !selectedPlugin) return;
      try {
        // Find MCPB path again
        const mcpServersSpec_1 = selectedPlugin.plugin.manifest.mcpServers;
        let mcpbPath_0: string | null = null;
        if (typeof mcpServersSpec_1 === 'string' && isMcpbSource(mcpServersSpec_1)) {
          mcpbPath_0 = mcpServersSpec_1;
        } else if (Array.isArray(mcpServersSpec_1)) {
          for (const spec_1 of mcpServersSpec_1) {
            if (typeof spec_1 === 'string' && isMcpbSource(spec_1)) {
              mcpbPath_0 = spec_1;
              break;
            }
          }
        }
        if (!mcpbPath_0) {
          setProcessError('No MCPB file found');
          setViewState('plugin-details');
          return;
        }

        // Reload with provided config
        await loadMcpbFile(mcpbPath_0, selectedPlugin.plugin.path, pluginId_12, undefined, config);

        // Success - go back to details
        setProcessError(null);
        setConfigNeeded(null);
        setViewState('plugin-details');
        setResult('Configuration saved. Run /reload-plugins for changes to take effect.');
      } catch (err_4) {
        const errorMsg_0 = errorMessage(err_4);
        setProcessError(`Failed to save configuration: ${errorMsg_0}`);
        setViewState('plugin-details');
      }
    }
    function handleCancel() {
      setConfigNeeded(null);
      setViewState('plugin-details');
    }
    return <PluginOptionsDialog title={`Configure ${configNeeded.manifest.name}`} subtitle={`Plugin: ${selectedPlugin.plugin.name}`} configSchema={configNeeded.configSchema} initialValues={configNeeded.existingConfig} onSave={handleSave} onCancel={handleCancel} />;
  }

  // Flagged plugin detail view
// 被下架插件的详情：只展示「为什么没了」与「什么时候标记的」，动作只有忽略。用 localeDateString 而不是自写格式化，因为这里不是热路径
  if (typeof viewState === 'object' && viewState.type === 'flagged-detail') {
    const fp = viewState.plugin;
    return <Box flexDirection="column">
        <Box>
          <Text bold>
            {fp.name} @ {fp.marketplace}
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Status: </Text>
          <Text color="error">Removed</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text color="error">
            Removed from marketplace · reason: {fp.reason}
          </Text>
          <Text>{fp.text}</Text>
          <Text dimColor>
            Flagged on {new Date(fp.flaggedAt).toLocaleDateString()}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text>{figures.pointer} </Text>
            <Text color="suggestion">Dismiss</Text>
          </Box>
        </Box>

        <Byline>
          <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="dismiss" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
        </Byline>
      </Box>;
  }

  // Confirm-project-uninstall: warn about shared .claude/settings.json,
  // offer to disable in settings.local.json instead.
// 项目级卸载确认页的文案重点：说明这等价于卸载，但不影响其他协作者。这句话是整个页面的存在理由，必须写在正文里而不是藏进帮助
  if (viewState === 'confirm-project-uninstall' && selectedPlugin) {
    return <Box flexDirection="column">
        <Text bold color="warning">
          {selectedPlugin.plugin.name} is enabled in .claude/settings.json
          (shared with your team)
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Disable it just for you in .claude/settings.local.json?</Text>
          <Text dimColor>
            This has the same effect as uninstalling, without affecting other
            contributors.
          </Text>
        </Box>
        {processError && <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>}
        <Box marginTop={1}>
          {isProcessing ? <Text dimColor>Disabling…</Text> : <Byline>
              <ConfigurableShortcutHint action="confirm:yes" context="Confirmation" fallback="y" description="disable" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>}
        </Box>
      </Box>;
  }

  // Confirm-data-cleanup: prompt before deleting ${CLAUDE_PLUGIN_DATA} dir
// 数据清理确认页把要删的绝对路径直接显示出来：删目录是不可逆操作，用户有权看清到底删哪个路径
  if (typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup' && selectedPlugin) {
    return <Box flexDirection="column">
        <Text bold>
          {selectedPlugin.plugin.name} has {viewState.size.human} of persistent
          data
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Delete it along with the plugin?</Text>
          <Text dimColor>
            {pluginDataDirPath(`${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`)}
          </Text>
        </Box>
        {processError && <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>}
        <Box marginTop={1}>
          {isProcessing ? <Text dimColor>Uninstalling…</Text> : <Text>
              <Text bold>y</Text> to delete · <Text bold>n</Text> to keep ·{' '}
              <Text bold>esc</Text> to cancel
            </Text>}
        </Box>
      </Box>;
  }

  // Plugin details view
// 插件详情页：作用域、版本、描述、作者、状态、组件清单、错误段、动态菜单、处理中与错误提示、底部快捷键。菜单项的配色按语义分：含 Uninstall 用 error 色，含 Update 用 suggestion 色
  if (viewState === 'plugin-details' && selectedPlugin) {
    const mergedSettings_2 = getSettings_DEPRECATED(); // Use merged settings to respect all layers
    const pluginId_13 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const isEnabled_2 = mergedSettings_2?.enabledPlugins?.[pluginId_13] !== false;

    // Compute plugin errors section
// 详情页也把与该插件相关的错误全捞出来：匹配插件名、完整 ID、或 ID 前缀三种形式，因为错误记录里的 source 字段格式不统一
    const filteredPluginErrors = pluginErrors.filter(e_1 => 'plugin' in e_1 && e_1.plugin === selectedPlugin.plugin.name || e_1.source === pluginId_13 || e_1.source.startsWith(`${selectedPlugin.plugin.name}@`));
    const pluginErrorsSection = filteredPluginErrors.length === 0 ? null : <Box flexDirection="column" marginBottom={1}>
          <Text bold color="error">
            {filteredPluginErrors.length}{' '}
            {plural(filteredPluginErrors.length, 'error')}:
          </Text>
          {filteredPluginErrors.map((error_3, i_0) => {
        const guidance = getErrorGuidance(error_3);
        return <Box key={i_0} flexDirection="column" marginLeft={2}>
                <Text color="error">{formatErrorMessage(error_3)}</Text>
                {guidance && <Text dimColor italic>
                    {figures.arrowRight} {guidance}
                  </Text>}
              </Box>;
      })}
        </Box>;
    return <Box flexDirection="column">
        <Box>
          <Text bold>
            {selectedPlugin.plugin.name} @ {selectedPlugin.marketplace}
          </Text>
        </Box>

        {/* Scope */}
        <Box>
          <Text dimColor>Scope: </Text>
          <Text>{selectedPlugin.scope || 'user'}</Text>
        </Box>

        {/* Plugin details */}
        {selectedPlugin.plugin.manifest.version && <Box>
            <Text dimColor>Version: </Text>
            <Text>{selectedPlugin.plugin.manifest.version}</Text>
          </Box>}

        {selectedPlugin.plugin.manifest.description && <Box marginBottom={1}>
            <Text>{selectedPlugin.plugin.manifest.description}</Text>
          </Box>}

        {selectedPlugin.plugin.manifest.author && <Box>
            <Text dimColor>Author: </Text>
            <Text>{selectedPlugin.plugin.manifest.author.name}</Text>
          </Box>}

        {/* Current status */}
        <Box marginBottom={1}>
          <Text dimColor>Status: </Text>
          <Text color={isEnabled_2 ? 'success' : 'warning'}>
            {isEnabled_2 ? 'Enabled' : 'Disabled'}
          </Text>
          {selectedPlugin.pendingUpdate && <Text color="suggestion"> · Marked for update</Text>}
        </Box>

        {/* Installed components */}
        <PluginComponentsDisplay plugin={selectedPlugin.plugin} marketplace={selectedPlugin.marketplace} />

        {/* Plugin errors */}
        {pluginErrorsSection}

        {/* Menu */}
        <Box marginTop={1} flexDirection="column">
          {detailsMenuItems.map((item_9, index_0) => {
          const isSelected = index_0 === detailsMenuIndex;
          return <Box key={index_0}>
                {isSelected && <Text>{figures.pointer} </Text>}
                {!isSelected && <Text>{'  '}</Text>}
// 用 label 里是否包含 Uninstall/Update 来决定颜色，而不是给菜单项加一个 kind 字段——编译产物里这点字符串匹配比多传一个参数便宜，而且标签文案与颜色语义本来就要一起改
                <Text bold={isSelected} color={item_9.label.includes('Uninstall') ? 'error' : item_9.label.includes('Update') ? 'suggestion' : undefined}>
                  {item_9.label}
                </Text>
              </Box>;
        })}
        </Box>

        {/* Processing state */}
        {isProcessing && <Box marginTop={1}>
            <Text>Processing…</Text>
          </Box>}

        {/* Error message */}
        {processError && <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>}

        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              <ConfigurableShortcutHint action="select:previous" context="Select" fallback="↑" description="navigate" />
              <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>;
  }

  // Failed plugin detail view
// 失败插件详情：只显示第一条错误的消息，其余错误在列表页的计数里体现。托管作用域的失败插件不给「移除」入口，改为提示联系管理员
  if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
    const failedPlugin_0 = viewState.plugin;
    const firstError = failedPlugin_0.errors[0];
    const errorMessage_0 = firstError ? formatErrorMessage(firstError) : 'Failed to load';
    return <Box flexDirection="column">
        <Text>
          <Text bold>{failedPlugin_0.name}</Text>
          <Text dimColor> @ {failedPlugin_0.marketplace}</Text>
          <Text dimColor> ({failedPlugin_0.scope})</Text>
        </Text>
        <Text color="error">{errorMessage_0}</Text>

        {failedPlugin_0.scope === 'managed' ? <Box marginTop={1}>
            <Text dimColor>
              Managed by your organization — contact your admin
            </Text>
          </Box> : <Box marginTop={1}>
            <Text color="suggestion">{figures.pointer} </Text>
            <Text bold>Remove</Text>
          </Box>}

        {isProcessing && <Text>Processing…</Text>}
        {processError && <Text color="error">{processError}</Text>}

        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              {failedPlugin_0.scope !== 'managed' && <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="remove" />}
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>;
  }

  // MCP detail view
// MCP 详情页按配置类型分派到四个组件：stdio 用本地服务器菜单，sse/http/claudeai-proxy 共用远程服务器菜单。三者共用一个组件是因为交互完全一样，只有传输字段不同
  if (typeof viewState === 'object' && viewState.type === 'mcp-detail') {
    const client_3 = viewState.client;
    const serverToolsCount = filterToolsByServer(mcpTools, client_3.name).length;

    // Common handlers for MCP menus
    const handleMcpViewTools = () => {
      setViewState({
        type: 'mcp-tools',
        client: client_3
      });
    };
    const handleMcpCancel = () => {
      setViewState('plugin-list');
    };
    const handleMcpComplete = (result_4?: string) => {
      if (result_4) {
        setResult(result_4);
      }
      setViewState('plugin-list');
    };

    // Transform MCPServerConnection to appropriate ServerInfo type
    const scope_5 = client_3.config.scope;
    const configType = client_3.config.type;
    if (configType === 'stdio') {
      const server: StdioServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'stdio',
        config: client_3.config as McpStdioServerConfig
      };
      return <MCPStdioServerMenu server={server} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    } else if (configType === 'sse') {
      const server_0: SSEServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client_3.config as McpSSEServerConfig
      };
      return <MCPRemoteServerMenu server={server_0} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    } else if (configType === 'http') {
      const server_1: HTTPServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'http',
        isAuthenticated: undefined,
        config: client_3.config as McpHTTPServerConfig
      };
      return <MCPRemoteServerMenu server={server_1} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    } else if (configType === 'claudeai-proxy') {
      const server_2: ClaudeAIServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client_3.config as McpClaudeAIProxyServerConfig
      };
      return <MCPRemoteServerMenu server={server_2} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    }

// 兜底分支会直接改状态并返回 null——理论上不可达，但比抛错好：用户看到的是回到列表，而不是整页崩掉
    // Fallback - shouldn't happen but handle gracefully
    setViewState('plugin-list');
    return null;
  }

  // MCP tools view
// 工具列表与工具详情两个视图重复了同一段「按类型拼 ServerInfo」的代码。这是编译产物的常态：原本是内联表达式，被拆成两次独立的构造，不值得为了去重引入运行时判断
  if (typeof viewState === 'object' && viewState.type === 'mcp-tools') {
    const client_4 = viewState.client;
    const scope_6 = client_4.config.scope;
    const configType_0 = client_4.config.type;

    // Build ServerInfo for MCPToolListView
    let server_3: StdioServerInfo | SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo;
    if (configType_0 === 'stdio') {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'stdio',
        config: client_4.config as McpStdioServerConfig
      };
    } else if (configType_0 === 'sse') {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client_4.config as McpSSEServerConfig
      };
    } else if (configType_0 === 'http') {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'http',
        isAuthenticated: undefined,
        config: client_4.config as McpHTTPServerConfig
      };
    } else {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client_4.config as McpClaudeAIProxyServerConfig
      };
    }
    return <MCPToolListView server={server_3} onSelectTool={(tool: Tool) => {
      setViewState({
        type: 'mcp-tool-detail',
        client: client_4,
        tool
      });
    }} onBack={() => setViewState({
      type: 'mcp-detail',
      client: client_4
    })} />;
  }

  // MCP tool detail view
  if (typeof viewState === 'object' && viewState.type === 'mcp-tool-detail') {
    const {
      client: client_5,
      tool: tool_0
    } = viewState;
    const scope_7 = client_5.config.scope;
    const configType_1 = client_5.config.type;

    // Build ServerInfo for MCPToolDetailView
    let server_4: StdioServerInfo | SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo;
    if (configType_1 === 'stdio') {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'stdio',
        config: client_5.config as McpStdioServerConfig
      };
    } else if (configType_1 === 'sse') {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client_5.config as McpSSEServerConfig
      };
    } else if (configType_1 === 'http') {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'http',
        isAuthenticated: undefined,
        config: client_5.config as McpHTTPServerConfig
      };
    } else {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client_5.config as McpClaudeAIProxyServerConfig
      };
    }
    return <MCPToolDetailView tool={tool_0} server={server_4} onBack={() => setViewState({
      type: 'mcp-tools',
      client: client_5
    })} />;
  }

  // Plugin list view (main management interface)
// 主列表：搜索框、无结果提示、上下滚动指示、按作用域分组的条目、底部快捷键、待生效提示。作用域标题只在分组切换处渲染一次，用前一项的 scope 比较得出
  const visibleItems = pagination.getVisibleItems(filteredItems);
  return <Box flexDirection="column">
      {/* Search box */}
      <Box marginBottom={1}>
        <SearchBox query={searchQuery} isFocused={isSearchMode} isTerminalFocused={isTerminalFocused} width={terminalWidth - 4} cursorOffset={searchCursorOffset} />
      </Box>

      {/* No search results */}
      {filteredItems.length === 0 && searchQuery && <Box marginBottom={1}>
          <Text dimColor>No items match &quot;{searchQuery}&quot;</Text>
        </Box>}

      {/* Scroll up indicator */}
      {pagination.scrollPosition.canScrollUp && <Box>
          <Text dimColor> {figures.arrowUp} more above</Text>
        </Box>}

      {/* Unified list of plugins and MCPs grouped by scope */}
      {visibleItems.map((item_10, visibleIndex) => {
      const actualIndex = pagination.toActualIndex(visibleIndex);
      const isSelected_0 = actualIndex === selectedIndex && !isSearchMode;

      // Check if we need to show a scope header
      const prevItem = visibleIndex > 0 ? visibleItems[visibleIndex - 1] : null;
      const showScopeHeader = !prevItem || prevItem.scope !== item_10.scope;

      // Get scope label
// 作用域标签映射里 dynamic 也显示成 Built-in：动态加载的插件对用户而言就是内置的一部分，没必要暴露内部概念
      const getScopeLabel = (scope_8: string): string => {
        switch (scope_8) {
          case 'flagged':
            return 'Flagged';
          case 'project':
            return 'Project';
          case 'local':
            return 'Local';
          case 'user':
            return 'User';
          case 'enterprise':
            return 'Enterprise';
          case 'managed':
            return 'Managed';
          case 'builtin':
            return 'Built-in';
          case 'dynamic':
            return 'Built-in';
          default:
            return scope_8;
        }
      };
      return <React.Fragment key={item_10.id}>
            {showScopeHeader && <Box marginTop={visibleIndex > 0 ? 1 : 0} paddingLeft={2}>
                <Text dimColor={item_10.scope !== 'flagged'} color={item_10.scope === 'flagged' ? 'warning' : undefined} bold={item_10.scope === 'flagged'}>
                  {getScopeLabel(item_10.scope)}
                </Text>
              </Box>}
// 每一行交给 UnifiedInstalledCell 渲染，它负责缩进（子 MCP）、状态点、待生效标记这些细节。主组件只管分组与排序，两者职责分得很清
            <UnifiedInstalledCell item={item_10} isSelected={isSelected_0} />
          </React.Fragment>;
    })}

      {/* Scroll down indicator */}
      {pagination.scrollPosition.canScrollDown && <Box>
          <Text dimColor> {figures.arrowDown} more below</Text>
        </Box>}

      {/* Help text */}
      <Box marginTop={1} marginLeft={1}>
        <Text dimColor italic>
          <Byline>
            <Text>type to search</Text>
            <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description="toggle" />
            <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="details" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
          </Byline>
        </Text>
      </Box>

      {/* Reload disclaimer for plugin changes */}
      {pendingToggles.size > 0 && <Box marginLeft={1}>
          <Text dimColor italic>
            Run /reload-plugins to apply changes
          </Text>
        </Box>}
    </Box>;
}
// 原文件此处有一行 232956 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。