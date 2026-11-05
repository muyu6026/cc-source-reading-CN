// React Compiler 运行时注入：_c(N) 预留 N 个记忆槽，组件与子组件里的 $[k] 都从这块槽位分配
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { SearchBox } from '../../components/SearchBox.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for raw search mode text input
import { Box, Text, useInput, useTerminalFocus } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import type { LoadedPlugin } from '../../types/plugin.js';
import { count } from '../../utils/array.js';
import { openBrowser } from '../../utils/browser.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage } from '../../utils/errors.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { formatInstallCount, getInstallCounts } from '../../utils/plugins/installCounts.js';
import { isPluginGloballyInstalled } from '../../utils/plugins/installedPluginsManager.js';
import { createPluginId, detectEmptyMarketplaceReason, type EmptyMarketplaceReason, formatFailureDetails, formatMarketplaceLoadingErrors, loadMarketplacesWithGracefulDegradation } from '../../utils/plugins/marketplaceHelpers.js';
import { loadKnownMarketplacesConfig } from '../../utils/plugins/marketplaceManager.js';
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js';
import { installPluginFromMarketplace } from '../../utils/plugins/pluginInstallationHelpers.js';
import { isPluginBlockedByPolicy } from '../../utils/plugins/pluginPolicy.js';
import { plural } from '../../utils/stringUtils.js';
import { truncateToWidth } from '../../utils/truncate.js';
import { findPluginOptionsTarget, PluginOptionsFlow } from './PluginOptionsFlow.js';
import { PluginTrustWarning } from './PluginTrustWarning.js';
import { buildPluginDetailsMenuOptions, extractGitHubRepo, type InstallablePlugin } from './pluginDetailsHelpers.js';
import type { ViewState as ParentViewState } from './types.js';
import { usePagination } from './usePagination.js';
// Props 把父级的四个状态回调透传下来：error 与 result 由父级统一展示，setViewState 用于跳出本视图
type Props = {
  error: string | null;
  setError: (error: string | null) => void;
  result: string | null;
  setResult: (result: string | null) => void;
  setViewState: (state: ParentViewState) => void;
  onInstallComplete?: () => void | Promise<void>;
  onSearchModeChange?: (isActive: boolean) => void;
  targetPlugin?: string;
};
// 视图状态三态：列表、详情、以及带插件对象与 id 的配置流程——对象态靠 type 字段与字符串态区分
type ViewState = 'plugin-list' | 'plugin-details' | {
  type: 'plugin-options';
  plugin: LoadedPlugin;
  pluginId: string;
};
export function DiscoverPlugins({
  error,
  setError,
  result: _result,
  setResult,
  setViewState: setParentViewState,
  onInstallComplete,
  onSearchModeChange,
  targetPlugin
}: Props): React.ReactNode {
  // View state
// 两个视图级状态分开存：viewState 决定渲染哪一屏，selectedPlugin 是详情屏的数据载体
  const [viewState, setViewState] = useState<ViewState>('plugin-list');
  const [selectedPlugin, setSelectedPlugin] = useState<InstallablePlugin | null>(null);

  // Data state
  const [availablePlugins, setAvailablePlugins] = useState<InstallablePlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [installCounts, setInstallCounts] = useState<Map<string, number> | null>(null);

  // Search state
  const [isSearchMode, setIsSearchModeRaw] = useState(false);
// 搜索模式的包装器要同步通知父级：父菜单必须知道搜索是否激活，否则它自己的按键绑定会抢走输入
  const setIsSearchMode = useCallback((active: boolean) => {
    setIsSearchModeRaw(active);
    onSearchModeChange?.(active);
  }, [onSearchModeChange]);
// 搜索输入只在三个条件同时成立时激活：列表屏、搜索模式、且加载已完成
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset
  } = useSearchInput({
    isActive: viewState === 'plugin-list' && isSearchMode && !loading,
    onExit: () => {
      setIsSearchMode(false);
    }
  });
  const isTerminalFocused = useTerminalFocus();
  const {
    columns: terminalWidth
  } = useTerminalSize();

  // Filter plugins based on search query
// 过滤走三个字段：插件名、描述、市场名都参与匹配，用户按市场名也能筛出整批插件
  const filteredPlugins = useMemo(() => {
    if (!searchQuery) return availablePlugins;
    const lowerQuery = searchQuery.toLowerCase();
    return availablePlugins.filter(plugin => plugin.entry.name.toLowerCase().includes(lowerQuery) || plugin.entry.description?.toLowerCase().includes(lowerQuery) || plugin.marketplaceName.toLowerCase().includes(lowerQuery));
  }, [availablePlugins, searchQuery]);

  // Selection state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedForInstall, setSelectedForInstall] = useState<Set<string>>(new Set());
  const [installingPlugins, setInstallingPlugins] = useState<Set<string>>(new Set());

  // Pagination for plugin list (continuous scrolling)
// 分页只负责可视窗口与索引映射，选中下标仍由本组件持有，两者职责分离
  const pagination = usePagination<InstallablePlugin>({
    totalItems: filteredPlugins.length,
    selectedIndex
  });

  // Reset selection when search query changes
// 查询一变就把选中项归零：否则搜索后光标会停在越界的旧位置上
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Details view state
  const [detailsMenuIndex, setDetailsMenuIndex] = useState(0);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // Warning state for non-critical errors
  const [warning, setWarning] = useState<string | null>(null);

  // Empty state reason
  const [emptyReason, setEmptyReason] = useState<EmptyMarketplaceReason | null>(null);

  // Load all plugins from all marketplaces
// 装载 effect 是全屏唯一的数据入口：读市场配置、降级加载、汇总插件、排序、判空态、处理告警
  useEffect(() => {
    async function loadAllPlugins() {
      try {
        const config = await loadKnownMarketplacesConfig();

// 优雅降级的关键：单个市场失败不影响其余，失败列表留到最后统一定性为告警还是致命错误
        // Load marketplaces with graceful degradation
        const {
          marketplaces,
          failures
        } = await loadMarketplacesWithGracefulDegradation(config);

        // Collect all plugins from all marketplaces
        const allPlugins: InstallablePlugin[] = [];
        for (const {
          name,
          data: marketplace
        } of marketplaces) {
          if (marketplace) {
            for (const entry of marketplace.plugins) {
              const pluginId = createPluginId(entry.name, name);
              allPlugins.push({
                entry,
                marketplaceName: name,
                pluginId,
// 只有全局安装才算已装：项目级与本地级装了不挡，用户可能只是想提升到用户级好在各处可用
                // Only block when globally installed (user/managed scope).
                // Project/local-scope installs don't block — user may want to
                // promote to user scope so it's available everywhere (gh-29997).
                isInstalled: isPluginGloballyInstalled(pluginId)
              });
            }
          }
        }

        // Filter out installed and policy-blocked plugins
// 两道过滤叠在一起：已安装的、被策略封禁的都不进候选列表
        const uninstalledPlugins = allPlugins.filter(p => !p.isInstalled && !isPluginBlockedByPolicy(p.pluginId));

// 安装数拿不到不是错误：catch 里降级成字母序，排序只是体验不是正确性
        // Fetch install counts and sort by popularity
        try {
          const counts = await getInstallCounts();
          setInstallCounts(counts);
          if (counts) {
            // Sort by install count (descending), then alphabetically
            uninstalledPlugins.sort((a_0, b_0) => {
              const countA = counts.get(a_0.pluginId) ?? 0;
              const countB = counts.get(b_0.pluginId) ?? 0;
              if (countA !== countB) return countB - countA;
              return a_0.entry.name.localeCompare(b_0.entry.name);
            });
          } else {
            // No counts available - sort alphabetically
            uninstalledPlugins.sort((a_1, b_1) => a_1.entry.name.localeCompare(b_1.entry.name));
          }
        } catch (error_0) {
          // Log the error, then gracefully degrade to alphabetical sort
          logForDebugging(`Failed to fetch install counts: ${errorMessage(error_0)}`);
          uninstalledPlugins.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
        }
        setAvailablePlugins(uninstalledPlugins);

// 空态不能只说没有：要区分没配市场、全被策略挡、全加载失败、全都装过这几种，文案与指引完全不同
        // Detect empty reason if no plugins available
        const configuredCount = Object.keys(config).length;
        if (uninstalledPlugins.length === 0) {
          const reason = await detectEmptyMarketplaceReason({
            configuredMarketplaceCount: configuredCount,
            failedMarketplaceCount: failures.length
          });
          setEmptyReason(reason);
        }

// 市场加载结果分两级处理：部分失败给横幅告警继续展示，全失败才抛成错误屏
        // Handle marketplace loading errors/warnings
        const successCount = count(marketplaces, m => m.data !== null);
        const errorResult = formatMarketplaceLoadingErrors(failures, successCount);
        if (errorResult) {
          if (errorResult.type === 'warning') {
            setWarning(errorResult.message + '. Showing available plugins.');
          } else {
            throw new Error(errorResult.message);
          }
        }

// 指定插件直达详情：在选择前先查未过滤的全量列表，这样已安装的插件能给出准确提示而不是查不到
        // Handle targetPlugin - navigate directly to plugin details
        // Search in allPlugins (before filtering) to handle installed plugins gracefully
        if (targetPlugin) {
          const foundPlugin = allPlugins.find(p_0 => p_0.entry.name === targetPlugin);
          if (foundPlugin) {
            if (foundPlugin.isInstalled) {
              setError(`Plugin '${foundPlugin.pluginId}' is already installed. Use '/plugin' to manage existing plugins.`);
            } else {
              setSelectedPlugin(foundPlugin);
              setViewState('plugin-details');
            }
          } else {
            setError(`Plugin "${targetPlugin}" not found in any marketplace`);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load plugins');
      } finally {
        setLoading(false);
      }
    }
    void loadAllPlugins();
  }, [setError, targetPlugin]);

  // Install selected plugins
// 批量安装串行执行：每个插件独立计成败，最后按成功数分三种文案，失败明细带原因
  const installSelectedPlugins = async () => {
    if (selectedForInstall.size === 0) return;
    const pluginsToInstall = availablePlugins.filter(p_1 => selectedForInstall.has(p_1.pluginId));
    setInstallingPlugins(new Set(pluginsToInstall.map(p_2 => p_2.pluginId)));
    let successCount_0 = 0;
    let failureCount = 0;
    const newFailedPlugins: Array<{
      name: string;
      reason: string;
    }> = [];
    for (const plugin_0 of pluginsToInstall) {
      const result = await installPluginFromMarketplace({
        pluginId: plugin_0.pluginId,
        entry: plugin_0.entry,
        marketplaceName: plugin_0.marketplaceName,
        scope: 'user'
      });
      if (result.success) {
        successCount_0++;
      } else {
        failureCount++;
        newFailedPlugins.push({
          name: plugin_0.entry.name,
          reason: result.error
        });
      }
    }
// 安装完必须清全量缓存：插件清单、插件命令、插件技能三处缓存都还指向磁盘旧状态
    setInstallingPlugins(new Set());
    setSelectedForInstall(new Set());
    clearAllCaches();

    // Handle installation results
// 三种结果措辞各不相同：全成、全败、部分成——部分成时要点明已装好的也必须 reload 才生效
    if (failureCount === 0) {
      const message = `✓ Installed ${successCount_0} ${plural(successCount_0, 'plugin')}. ` + `Run /reload-plugins to activate.`;
      setResult(message);
    } else if (successCount_0 === 0) {
      setError(`Failed to install: ${formatFailureDetails(newFailedPlugins, true)}`);
    } else {
      const message_0 = `✓ Installed ${successCount_0} of ${successCount_0 + failureCount} plugins. ` + `Failed: ${formatFailureDetails(newFailedPlugins, false)}. ` + `Run /reload-plugins to activate successfully installed plugins.`;
      setResult(message_0);
    }
    if (successCount_0 > 0) {
      if (onInstallComplete) {
        await onInstallComplete();
      }
    }
    setParentViewState({
      type: 'menu'
    });
  };

  // Install single plugin from details view
// 单个安装后先查有没有需要配置的项：有就转配置流程，没有才直接回报结果
  const handleSinglePluginInstall = async (plugin_1: InstallablePlugin, scope: 'user' | 'project' | 'local' = 'user') => {
    setIsInstalling(true);
    setInstallError(null);
    const result_0 = await installPluginFromMarketplace({
      pluginId: plugin_1.pluginId,
      entry: plugin_1.entry,
      marketplaceName: plugin_1.marketplaceName,
      scope
    });
    if (result_0.success) {
      const loaded = await findPluginOptionsTarget(plugin_1.pluginId);
      if (loaded) {
        setIsInstalling(false);
        setViewState({
          type: 'plugin-options',
          plugin: loaded,
          pluginId: plugin_1.pluginId
        });
        return;
      }
      setResult(result_0.message);
      if (onInstallComplete) {
        await onInstallComplete();
      }
      setParentViewState({
        type: 'menu'
      });
    } else {
      setIsInstalling(false);
      setInstallError(result_0.error);
    }
  };

  // Handle error state
  useEffect(() => {
    if (error) {
      setResult(error);
    }
  }, [error, setResult]);

  // Escape in plugin-details view - go back to plugin-list
// 详情屏的 Esc 回列表并清掉选中，列表屏的 Esc 才退出到父菜单——同一个按键按层级分流
  useKeybinding('confirm:no', () => {
    setViewState('plugin-list');
    setSelectedPlugin(null);
  }, {
    context: 'Confirmation',
    isActive: viewState === 'plugin-details'
  });

  // Escape in plugin-list view (not search mode) - exit to parent menu
  useKeybinding('confirm:no', () => {
    setParentViewState({
      type: 'menu'
    });
  }, {
    context: 'Confirmation',
    isActive: viewState === 'plugin-list' && !isSearchMode
  });

  // Handle entering search mode (non-escape keys)
// 任意可打印字符直接进搜索模式：但 j/k/i 三个例外是导航与安装键，不能被当成搜索的首字母吃掉
  useInput((input, _key) => {
    const keyIsNotCtrlOrMeta = !_key.ctrl && !_key.meta;
    if (!isSearchMode) {
      // Enter search mode with '/' or any printable character
      if (input === '/' && keyIsNotCtrlOrMeta) {
        setIsSearchMode(true);
        setSearchQuery('');
      } else if (keyIsNotCtrlOrMeta && input.length > 0 && !/^\s+$/.test(input) &&
      // Don't enter search mode for navigation keys
      input !== 'j' && input !== 'k' && input !== 'i') {
        setIsSearchMode(true);
        setSearchQuery(input);
      }
    }
  }, {
    isActive: viewState === 'plugin-list' && !loading
  });

  // Plugin-list navigation (non-search mode)
// 选中项在第一位时再按上键就进搜索模式：这是把「已经到顶」顺势变成「去搜索」的设计
  useKeybindings({
    'select:previous': () => {
      if (selectedIndex === 0) {
        setIsSearchMode(true);
      } else {
        pagination.handleSelectionChange(selectedIndex - 1, setSelectedIndex);
      }
    },
    'select:next': () => {
      if (selectedIndex < filteredPlugins.length - 1) {
        pagination.handleSelectionChange(selectedIndex + 1, setSelectedIndex);
      }
    },
// 回车按位置分三种语义：底部安装行、已装插件跳管理页、未装插件进详情
    'select:accept': () => {
      if (selectedIndex === filteredPlugins.length && selectedForInstall.size > 0) {
        void installSelectedPlugins();
      } else if (selectedIndex < filteredPlugins.length) {
        const plugin_2 = filteredPlugins[selectedIndex];
        if (plugin_2) {
          if (plugin_2.isInstalled) {
            setParentViewState({
              type: 'manage-plugins',
              targetPlugin: plugin_2.entry.name,
              targetMarketplace: plugin_2.marketplaceName
            });
          } else {
            setSelectedPlugin(plugin_2);
            setViewState('plugin-details');
            setDetailsMenuIndex(0);
            setInstallError(null);
          }
        }
      }
    }
  }, {
    context: 'Select',
    isActive: viewState === 'plugin-list' && !isSearchMode
  });
// 空格切换勾选与 i 直接安装分成两组绑定：勾选是累积意图，安装是立即动作
  useKeybindings({
    'plugin:toggle': () => {
      if (selectedIndex < filteredPlugins.length) {
        const plugin_3 = filteredPlugins[selectedIndex];
        if (plugin_3 && !plugin_3.isInstalled) {
          const newSelection = new Set(selectedForInstall);
          if (newSelection.has(plugin_3.pluginId)) {
            newSelection.delete(plugin_3.pluginId);
          } else {
            newSelection.add(plugin_3.pluginId);
          }
          setSelectedForInstall(newSelection);
        }
      }
    },
    'plugin:install': () => {
      if (selectedForInstall.size > 0) {
        void installSelectedPlugins();
      }
    }
  }, {
    context: 'Plugin',
    isActive: viewState === 'plugin-list' && !isSearchMode
  });

  // Plugin-details navigation
// 详情菜单按插件实际可用的链接动态构建：没有主页就不出主页项，所以是构建函数而不是静态表
  const detailsMenuOptions = React.useMemo(() => {
    if (!selectedPlugin) return [];
    const hasHomepage = selectedPlugin.entry.homepage;
    const githubRepo = extractGitHubRepo(selectedPlugin);
    return buildPluginDetailsMenuOptions(hasHomepage, githubRepo);
  }, [selectedPlugin]);
  useKeybindings({
    'select:previous': () => {
      if (detailsMenuIndex > 0) {
        setDetailsMenuIndex(detailsMenuIndex - 1);
      }
    },
    'select:next': () => {
      if (detailsMenuIndex < detailsMenuOptions.length - 1) {
        setDetailsMenuIndex(detailsMenuIndex + 1);
      }
    },
// 动作分派六个分支：三种安装范围、两个外链、一个返回；用外链前都再判一次值存在
    'select:accept': () => {
      if (!selectedPlugin) return;
      const action = detailsMenuOptions[detailsMenuIndex]?.action;
      const hasHomepage_0 = selectedPlugin.entry.homepage;
      const githubRepo_0 = extractGitHubRepo(selectedPlugin);
      if (action === 'install-user') {
        void handleSinglePluginInstall(selectedPlugin, 'user');
      } else if (action === 'install-project') {
        void handleSinglePluginInstall(selectedPlugin, 'project');
      } else if (action === 'install-local') {
        void handleSinglePluginInstall(selectedPlugin, 'local');
      } else if (action === 'homepage' && hasHomepage_0) {
        void openBrowser(hasHomepage_0);
      } else if (action === 'github' && githubRepo_0) {
        void openBrowser(`https://github.com/${githubRepo_0}`);
      } else if (action === 'back') {
        setViewState('plugin-list');
        setSelectedPlugin(null);
      }
    }
  }, {
    context: 'Select',
    isActive: viewState === 'plugin-details' && !!selectedPlugin
  });
// 配置流程整屏接管：三种结局文案不同但出口统一，都走 finish 回报并回父菜单
  if (typeof viewState === 'object' && viewState.type === 'plugin-options') {
    const {
      plugin: plugin_4,
      pluginId: pluginId_0
    } = viewState;
    function finish(msg: string): void {
      setResult(msg);
      if (onInstallComplete) {
        void onInstallComplete();
      }
      setParentViewState({
        type: 'menu'
      });
    }
    return <PluginOptionsFlow plugin={plugin_4} pluginId={pluginId_0} onDone={(outcome, detail) => {
      switch (outcome) {
        case 'configured':
          finish(`✓ Installed and configured ${plugin_4.name}. Run /reload-plugins to apply.`);
          break;
        case 'skipped':
          finish(`✓ Installed ${plugin_4.name}. Run /reload-plugins to apply.`);
          break;
        case 'error':
          finish(`Installed but failed to save config: ${detail}`);
          break;
      }
    }} />;
  }

  // Loading state
  if (loading) {
    return <Text>Loading…</Text>;
  }

  // Error state
  if (error) {
    return <Text color="error">{error}</Text>;
  }

  // Plugin details view
  if (viewState === 'plugin-details' && selectedPlugin) {
    const hasHomepage_1 = selectedPlugin.entry.homepage;
    const githubRepo_1 = extractGitHubRepo(selectedPlugin);
    const menuOptions = buildPluginDetailsMenuOptions(hasHomepage_1, githubRepo_1);
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Plugin details</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{selectedPlugin.entry.name}</Text>
          <Text dimColor>from {selectedPlugin.marketplaceName}</Text>
          {selectedPlugin.entry.version && <Text dimColor>Version: {selectedPlugin.entry.version}</Text>}
          {selectedPlugin.entry.description && <Box marginTop={1}>
              <Text>{selectedPlugin.entry.description}</Text>
            </Box>}
          {selectedPlugin.entry.author && <Box marginTop={1}>
              <Text dimColor>
                By:{' '}
                {typeof selectedPlugin.entry.author === 'string' ? selectedPlugin.entry.author : selectedPlugin.entry.author.name}
              </Text>
            </Box>}
        </Box>

        <PluginTrustWarning />

        {installError && <Box marginBottom={1}>
            <Text color="error">Error: {installError}</Text>
          </Box>}

        <Box flexDirection="column">
          {menuOptions.map((option, index) => <Box key={option.action}>
              {detailsMenuIndex === index && <Text>{'> '}</Text>}
              {detailsMenuIndex !== index && <Text>{'  '}</Text>}
              <Text bold={detailsMenuIndex === index}>
                {isInstalling && option.action.startsWith('install-') ? 'Installing…' : option.label}
              </Text>
            </Box>)}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            <Byline>
              <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>;
  }

  // Empty state
// 空态屏只做一件事：把「为什么空」的判断整体下沉到那个上下文组件里
  if (availablePlugins.length === 0) {
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Discover plugins</Text>
        </Box>
        <EmptyStateMessage reason={emptyReason} />
        <Box marginTop={1}>
          <Text dimColor italic>
            Esc to go back
          </Text>
        </Box>
      </Box>;
  }

  // Get visible plugins from pagination
  const visiblePlugins = pagination.getVisibleItems(filteredPlugins);
// 列表项渲染前先取可视窗口；每行的 key 拼上分页起始下标，滚动时强制重建，避免复用旧位置上的行内容
  return <Box flexDirection="column">
      <Box>
        <Text bold>Discover plugins</Text>
        {pagination.needsPagination && <Text dimColor>
            {' '}
            ({pagination.scrollPosition.current}/
            {pagination.scrollPosition.total})
          </Text>}
      </Box>

      {/* Search box */}
      <Box marginBottom={1}>
        <SearchBox query={searchQuery} isFocused={isSearchMode} isTerminalFocused={isTerminalFocused} width={terminalWidth - 4} cursorOffset={searchCursorOffset} />
      </Box>

      {/* Warning banner */}
      {warning && <Box marginBottom={1}>
          <Text color="warning">
            {figures.warning} {warning}
          </Text>
        </Box>}

      {/* No search results */}
      {filteredPlugins.length === 0 && searchQuery && <Box marginBottom={1}>
          <Text dimColor>No plugins match &quot;{searchQuery}&quot;</Text>
        </Box>}

      {/* Scroll up indicator */}
      {pagination.scrollPosition.canScrollUp && <Box>
          <Text dimColor> {figures.arrowUp} more above</Text>
        </Box>}

      {/* Plugin list - use startIndex in key to force re-render on scroll */}
      {visiblePlugins.map((plugin_5, visibleIndex) => {
      const actualIndex = pagination.toActualIndex(visibleIndex);
      const isSelected = selectedIndex === actualIndex;
      const isSelectedForInstall = selectedForInstall.has(plugin_5.pluginId);
      const isInstallingThis = installingPlugins.has(plugin_5.pluginId);
      const isLast = visibleIndex === visiblePlugins.length - 1;
      return <Box key={`${pagination.startIndex}-${plugin_5.pluginId}`} flexDirection="column" marginBottom={isLast && !error ? 0 : 1}>
            <Box>
              <Text color={isSelected && !isSearchMode ? 'suggestion' : undefined}>
                {isSelected && !isSearchMode ? figures.pointer : ' '}{' '}
              </Text>
              <Text>
                {isInstallingThis ? figures.ellipsis : isSelectedForInstall ? figures.radioOn : figures.radioOff}{' '}
                {plugin_5.entry.name}
                <Text dimColor> · {plugin_5.marketplaceName}</Text>
                {plugin_5.entry.tags?.includes('community-managed') && <Text dimColor> [Community Managed]</Text>}
                {installCounts && plugin_5.marketplaceName === OFFICIAL_MARKETPLACE_NAME && <Text dimColor>
                      {' · '}
                      {formatInstallCount(installCounts.get(plugin_5.pluginId) ?? 0)}{' '}
                      installs
                    </Text>}
              </Text>
            </Box>
            {plugin_5.entry.description && <Box marginLeft={4}>
                <Text dimColor>
                  {truncateToWidth(plugin_5.entry.description, 60)}
                </Text>
              </Box>}
          </Box>;
    })}

      {/* Scroll down indicator */}
      {pagination.scrollPosition.canScrollDown && <Box>
          <Text dimColor> {figures.arrowDown} more below</Text>
        </Box>}

      {/* Error messages */}
      {error && <Box marginTop={1}>
          <Text color="error">
            {figures.cross} {error}
          </Text>
        </Box>}

      <DiscoverPluginsKeyHint hasSelection={selectedForInstall.size > 0} canToggle={selectedIndex < filteredPlugins.length && !filteredPlugins[selectedIndex]?.isInstalled} />
    </Box>;
}
// 按键提示条独立成组件并整体记忆化：它的输入只有两个布尔值，缓存命中率极高
function DiscoverPluginsKeyHint(t0) {
  const $ = _c(10);
  const {
    hasSelection,
    canToggle
  } = t0;
  let t1;
  if ($[0] !== hasSelection) {
    t1 = hasSelection && <ConfigurableShortcutHint action="plugin:install" context="Plugin" fallback="i" description="install" bold={true} />;
    $[0] = hasSelection;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
// memo_cache_sentinel 标记的是无依赖常量节点：编译器认定这些 JSX 永不变化，直接永久缓存
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>type to search</Text>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== canToggle) {
    t3 = canToggle && <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description="toggle" />;
    $[3] = canToggle;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="details" />;
    t5 = <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />;
    $[5] = t4;
    $[6] = t5;
  } else {
    t4 = $[5];
    t5 = $[6];
  }
  let t6;
  if ($[7] !== t1 || $[8] !== t3) {
    t6 = <Box marginTop={1}><Text dimColor={true} italic={true}><Byline>{t1}{t2}{t3}{t4}{t5}</Byline></Text></Box>;
    $[7] = t1;
    $[8] = t3;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  return t6;
}

/**
 * Context-aware empty state message for the Discover screen
 */
// 空态组件按原因分支返回不同文案：六种原因覆盖从没装 git 到全部装完的所有路径
function EmptyStateMessage(t0) {
  const $ = _c(6);
  const {
    reason
  } = t0;
  switch (reason) {
    case "git-not-installed":
      {
        let t1;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <><Text dimColor={true}>Git is required to install marketplaces.</Text><Text dimColor={true}>Please install git and restart Claude Code.</Text></>;
          $[0] = t1;
        } else {
          t1 = $[0];
        }
        return t1;
      }
    case "all-blocked-by-policy":
      {
        let t1;
        if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <><Text dimColor={true}>Your organization policy does not allow any external marketplaces.</Text><Text dimColor={true}>Contact your administrator.</Text></>;
          $[1] = t1;
        } else {
          t1 = $[1];
        }
        return t1;
      }
    case "policy-restricts-sources":
      {
        let t1;
        if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <><Text dimColor={true}>Your organization restricts which marketplaces can be added.</Text><Text dimColor={true}>Switch to the Marketplaces tab to view allowed sources.</Text></>;
          $[2] = t1;
        } else {
          t1 = $[2];
        }
        return t1;
      }
    case "all-marketplaces-failed":
      {
        let t1;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <><Text dimColor={true}>Failed to load marketplace data.</Text><Text dimColor={true}>Check your network connection.</Text></>;
          $[3] = t1;
        } else {
          t1 = $[3];
        }
        return t1;
      }
    case "all-plugins-installed":
      {
        let t1;
        if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <><Text dimColor={true}>All available plugins are already installed.</Text><Text dimColor={true}>Check for new plugins later or add more marketplaces.</Text></>;
          $[4] = t1;
        } else {
          t1 = $[4];
        }
        return t1;
      }
    case "no-marketplaces-configured":
    default:
      {
        let t1;
        if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <><Text dimColor={true}>No plugins available.</Text><Text dimColor={true}>Add a marketplace first using the Marketplaces tab.</Text></>;
          $[5] = t1;
        } else {
          t1 = $[5];
        }
        return t1;
      }
  }
}
// 原文件此处有一行 78216 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。