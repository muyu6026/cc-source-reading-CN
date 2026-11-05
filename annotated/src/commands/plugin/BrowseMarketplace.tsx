import figures from 'figures';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import type { LoadedPlugin } from '../../types/plugin.js';
import { count } from '../../utils/array.js';
import { openBrowser } from '../../utils/browser.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage } from '../../utils/errors.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { formatInstallCount, getInstallCounts } from '../../utils/plugins/installCounts.js';
import { isPluginGloballyInstalled, isPluginInstalled } from '../../utils/plugins/installedPluginsManager.js';
import { createPluginId, formatFailureDetails, formatMarketplaceLoadingErrors, getMarketplaceSourceDisplay, loadMarketplacesWithGracefulDegradation } from '../../utils/plugins/marketplaceHelpers.js';
import { getMarketplace, loadKnownMarketplacesConfig } from '../../utils/plugins/marketplaceManager.js';
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js';
import { installPluginFromMarketplace } from '../../utils/plugins/pluginInstallationHelpers.js';
import { isPluginBlockedByPolicy } from '../../utils/plugins/pluginPolicy.js';
import { plural } from '../../utils/stringUtils.js';
import { truncateToWidth } from '../../utils/truncate.js';
import { findPluginOptionsTarget, PluginOptionsFlow } from './PluginOptionsFlow.js';
import { PluginTrustWarning } from './PluginTrustWarning.js';
import { buildPluginDetailsMenuOptions, extractGitHubRepo, type InstallablePlugin, PluginSelectionKeyHint } from './pluginDetailsHelpers.js';
import type { ViewState as ParentViewState } from './types.js';
import { usePagination } from './usePagination.js';
type Props = {
  error: string | null;
  setError: (error: string | null) => void;
  result: string | null;
  setResult: (result: string | null) => void;
  setViewState: (state: ParentViewState) => void;
  onInstallComplete?: () => void | Promise<void>;
  targetMarketplace?: string;
  targetPlugin?: string;
};
// Props：组件入参——错误/结果回写、视图切换、可选的目标市场 targetMarketplace 与目标插件 targetPlugin（用于直接跳转）。
type ViewState = 'marketplace-list' | 'plugin-list' | 'plugin-details' | {
  type: 'plugin-options';
  plugin: LoadedPlugin;
  pluginId: string;
};
// ViewState：内部视图状态，四态——marketplace-list / plugin-list / plugin-details，以及 plugin-options 联合态（携带已装插件对象与 pluginId）。
type MarketplaceInfo = {
  name: string;
  totalPlugins: number;
  installedCount: number;
  source?: string;
};
// MarketplaceInfo：市场列表项展示结构（名称、插件总数、已装数、来源）。
// BrowseMarketplace：插件浏览与安装主组件。支持按市场浏览插件、查看详情、批量或单件安装（user/project/local 三种 scope），并可在传入目标时直接跳转。
export function BrowseMarketplace({
  error,
  setError,
  result: _result,
  setResult,
  setViewState: setParentViewState,
  onInstallComplete,
  targetMarketplace,
  targetPlugin
}: Props): React.ReactNode {
  // View state
  const [viewState, setViewState] = useState<ViewState>('marketplace-list');
// 视图状态：viewState、选中市场、选中插件。
  const [selectedMarketplace, setSelectedMarketplace] = useState<string | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<InstallablePlugin | null>(null);

  // Data state
// 数据状态：市场列表、可用插件、加载中、安装计数。
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [availablePlugins, setAvailablePlugins] = useState<InstallablePlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [installCounts, setInstallCounts] = useState<Map<string, number> | null>(null);

  // Selection state
// 选择状态：当前选中索引、待安装插件集合、安装中插件集合。
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedForInstall, setSelectedForInstall] = useState<Set<string>>(new Set());
  const [installingPlugins, setInstallingPlugins] = useState<Set<string>>(new Set());

  // Pagination for plugin list (continuous scrolling)
// usePagination：插件列表分页（连续滚动），按 availablePlugins 总数与选中索引计算可见窗口。
  const pagination = usePagination<InstallablePlugin>({
    totalItems: availablePlugins.length,
    selectedIndex
  });

  // Details view state
// 详情菜单索引、安装中标记、安装错误、非致命警告（如部分市场加载失败）等状态。
  const [detailsMenuIndex, setDetailsMenuIndex] = useState(0);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // Warning state for non-critical errors (e.g., some marketplaces failed to load)
  const [warning, setWarning] = useState<string | null>(null);

  // Handle escape to go back - viewState-dependent navigation
// handleBack：按当前 viewState 决定返回去处——plugin-list 回市场或父菜单，plugin-details 回插件列表，marketplace-list 退出插件菜单。用 useCallback 记忆化。
  const handleBack = React.useCallback(() => {
    if (viewState === 'plugin-list') {
      // If navigated directly to a specific marketplace via targetMarketplace,
      // go back to manage-marketplaces showing that marketplace's details
      if (targetMarketplace) {
        setParentViewState({
          type: 'manage-marketplaces',
          targetMarketplace
        });
      } else if (marketplaces.length === 1) {
        // If there's only one marketplace, skip the marketplace-list view
        // since we auto-navigated past it on load
        setParentViewState({
          type: 'menu'
        });
      } else {
        setViewState('marketplace-list');
        setSelectedMarketplace(null);
        setSelectedForInstall(new Set());
      }
    } else if (viewState === 'plugin-details') {
      setViewState('plugin-list');
      setSelectedPlugin(null);
    } else {
      // At root level (marketplace-list), exit the plugin menu
      setParentViewState({
        type: 'menu'
      });
    }
  }, [viewState, targetMarketplace, setParentViewState, marketplaces.length]);
  useKeybinding('confirm:no', handleBack, {
// useKeybinding confirm:no 绑定 handleBack（Esc 返回）。
    context: 'Confirmation'
  });

  // Load marketplaces and count installed plugins
// 首个 useEffect：加载所有市场并统计各市场已装插件数。依赖 [setError, targetMarketplace, targetPlugin]。
  useEffect(() => {
// loadMarketplaceData：异步加载——读配置、带优雅降级加载市场、构造 MarketplaceInfo 列表。
    async function loadMarketplaceData() {
      try {
        const config = await loadKnownMarketplacesConfig();

        // Load marketplaces with graceful degradation
        const {
          marketplaces: marketplaces_0,
          failures
        } = await loadMarketplacesWithGracefulDegradation(config);
        const marketplaceInfos: MarketplaceInfo[] = [];
        for (const {
          name,
          config: marketplaceConfig,
          data: marketplace
        } of marketplaces_0) {
          if (marketplace) {
// 统计每个市场已安装的插件数（isPluginInstalled + createPluginId）。
            // Count how many plugins from this marketplace are installed
            const installedFromThisMarketplace = count(marketplace.plugins, plugin => isPluginInstalled(createPluginId(plugin.name, name)));
            marketplaceInfos.push({
              name,
              totalPlugins: marketplace.plugins.length,
              installedCount: installedFromThisMarketplace,
              source: getMarketplaceSourceDisplay(marketplaceConfig.source)
            });
          }
        }

        // Sort so claude-plugin-directory is always first
// 排序：claude-plugin-directory 永远排第一，其余保持原序。
        marketplaceInfos.sort((a, b) => {
          if (a.name === 'claude-plugin-directory') return -1;
          if (b.name === 'claude-plugin-directory') return 1;
          return 0;
        });
        setMarketplaces(marketplaceInfos);

        // Handle marketplace loading errors/warnings
// 处理市场加载错误/警告：formatMarketplaceLoadingErrors 区分 warning（仅提示）与 error（抛异常）。
        const successCount = count(marketplaces_0, m => m.data !== null);
        const errorResult = formatMarketplaceLoadingErrors(failures, successCount);
        if (errorResult) {
          if (errorResult.type === 'warning') {
            setWarning(errorResult.message + '. Showing available marketplaces.');
          } else {
            throw new Error(errorResult.message);
          }
        }

        // Skip marketplace selection if there's only one marketplace
// 若只有一个市场且无 target 指定，跳过市场选择直接进插件列表。
        if (marketplaceInfos.length === 1 && !targetMarketplace && !targetPlugin) {
          const singleMarketplace = marketplaceInfos[0];
          if (singleMarketplace) {
            setSelectedMarketplace(singleMarketplace.name);
            setViewState('plugin-list');
          }
        }

        // Handle targetMarketplace and targetPlugin after marketplaces are loaded
// 处理 targetPlugin：跨所有市场查找目标插件；跳转详情时仅全局（user/managed）已装才拦截，project/local 不拦（用户可能想升级到 user scope，见 gh-29997）。
        if (targetPlugin) {
          // Search for the plugin across all marketplaces
          let foundPlugin: InstallablePlugin | null = null;
          let foundMarketplace: string | null = null;
          for (const [name_0] of Object.entries(config)) {
            const marketplace_0 = await getMarketplace(name_0);
            if (marketplace_0) {
              const plugin_0 = marketplace_0.plugins.find(p => p.name === targetPlugin);
              if (plugin_0) {
                const pluginId = createPluginId(plugin_0.name, name_0);
                foundPlugin = {
                  entry: plugin_0,
                  marketplaceName: name_0,
                  pluginId,
                  // isPluginGloballyInstalled: only block when user/managed scope
                  // exists (nothing to add). Project/local-scope installs don't
                  // block — user may want to promote to user scope (gh-29997).
                  isInstalled: isPluginGloballyInstalled(pluginId)
                };
                foundMarketplace = name_0;
                break;
              }
            }
          }
          if (foundPlugin && foundMarketplace) {
            // Block only on global (user/managed) install — project/local scope
            // means the user might still want to add a user-scope entry so the
            // plugin is available in other projects (gh-29997, gh-29240, gh-29392).
            // The plugin-details view offers all three scope options; the backend
            // (installPluginOp → addInstalledPlugin) already supports multiple
            // scope entries per plugin.
            const pluginId_0 = foundPlugin.pluginId;
            const globallyInstalled = isPluginGloballyInstalled(pluginId_0);
            if (globallyInstalled) {
              setError(`Plugin '${pluginId_0}' is already installed globally. Use '/plugin' to manage existing plugins.`);
            } else {
              // Navigate to the plugin details view
              setSelectedMarketplace(foundMarketplace);
              setSelectedPlugin(foundPlugin);
              setViewState('plugin-details');
            }
          } else {
            setError(`Plugin "${targetPlugin}" not found in any marketplace`);
          }
        } else if (targetMarketplace) {
// 处理 targetMarketplace：直接跳到指定市场的插件列表，不存在则报错。
          // Navigate directly to the specified marketplace
          const marketplaceExists = marketplaceInfos.some(m_0 => m_0.name === targetMarketplace);
          if (marketplaceExists) {
            setSelectedMarketplace(targetMarketplace);
            setViewState('plugin-list');
          } else {
            setError(`Marketplace "${targetMarketplace}" not found`);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load marketplaces');
      } finally {
        setLoading(false);
      }
    }
    void loadMarketplaceData();
  }, [setError, targetMarketplace, targetPlugin]);

  // Load plugins when a marketplace is selected
// 第二个 useEffect：选中市场时加载其插件；用 cancelled 标志防止快速切换造成的竞态。
  useEffect(() => {
    if (!selectedMarketplace) return;
    let cancelled = false;
// loadPluginsForMarketplace：异步加载某市场的可安装插件。
    async function loadPluginsForMarketplace(marketplaceName: string) {
      setLoading(true);
      try {
        const marketplace_1 = await getMarketplace(marketplaceName);
        if (cancelled) return;
        if (!marketplace_1) {
          throw new Error(`Failed to load marketplace: ${marketplaceName}`);
        }

        // Filter out already installed plugins
// 过滤已装插件（isPluginGloballyInstalled 标记），并跳过被策略阻断的插件（isPluginBlockedByPolicy）。
        const installablePlugins: InstallablePlugin[] = [];
        for (const entry of marketplace_1.plugins) {
          const pluginId_1 = createPluginId(entry.name, marketplaceName);
          if (isPluginBlockedByPolicy(pluginId_1)) continue;
          installablePlugins.push({
            entry,
            marketplaceName: marketplaceName,
            pluginId: pluginId_1,
            // Only mark as "installed" when globally scoped (user/managed).
            // Project/local installs don't block — user can add user scope
            // via the plugin-details view (gh-29997).
            isInstalled: isPluginGloballyInstalled(pluginId_1)
          });
        }

        // Fetch install counts and sort by popularity
// 拉取安装计数后按热度（下载量降序）排序；计数失败则降级为字母序。
        try {
          const counts = await getInstallCounts();
          if (cancelled) return;
          setInstallCounts(counts);
          if (counts) {
            // Sort by install count (descending), then alphabetically
            installablePlugins.sort((a_1, b_1) => {
              const countA = counts.get(a_1.pluginId) ?? 0;
              const countB = counts.get(b_1.pluginId) ?? 0;
              if (countA !== countB) return countB - countA;
              return a_1.entry.name.localeCompare(b_1.entry.name);
            });
          } else {
            // No counts available - sort alphabetically
            installablePlugins.sort((a_2, b_2) => a_2.entry.name.localeCompare(b_2.entry.name));
          }
        } catch (error_0) {
          if (cancelled) return;
          // Log the error, then gracefully degrade to alphabetical sort
          logForDebugging(`Failed to fetch install counts: ${errorMessage(error_0)}`);
          installablePlugins.sort((a_0, b_0) => a_0.entry.name.localeCompare(b_0.entry.name));
        }
        setAvailablePlugins(installablePlugins);
        setSelectedIndex(0);
        setSelectedForInstall(new Set());
      } catch (err_0) {
        if (cancelled) return;
        setError(err_0 instanceof Error ? err_0.message : 'Failed to load plugins');
      } finally {
        setLoading(false);
      }
    }
    void loadPluginsForMarketplace(selectedMarketplace);
    return () => {
      cancelled = true;
    };
  }, [selectedMarketplace, setError]);

// installSelectedPlugins：批量安装所有待安装插件（scope=user），统计成败。
  // Install selected plugins
  const installSelectedPlugins = async () => {
    if (selectedForInstall.size === 0) return;
    const pluginsToInstall = availablePlugins.filter(p_0 => selectedForInstall.has(p_0.pluginId));
    setInstallingPlugins(new Set(pluginsToInstall.map(p_1 => p_1.pluginId)));
    let successCount_0 = 0;
    let failureCount = 0;
    const newFailedPlugins: Array<{
      name: string;
      reason: string;
    }> = [];
    for (const plugin_1 of pluginsToInstall) {
// 逐个调用 installPluginFromMarketplace 安装，记录成功数与失败原因。
      const result = await installPluginFromMarketplace({
        pluginId: plugin_1.pluginId,
        entry: plugin_1.entry,
        marketplaceName: plugin_1.marketplaceName,
        scope: 'user'
      });
      if (result.success) {
        successCount_0++;
      } else {
        failureCount++;
        newFailedPlugins.push({
          name: plugin_1.entry.name,
          reason: result.error
        });
      }
    }
    setInstallingPlugins(new Set());
    setSelectedForInstall(new Set());
    clearAllCaches();
// clearAllCaches：安装后清空缓存。

    // Handle installation results
    if (failureCount === 0) {
// 处理成败结果：全成功 / 全失败（含原因）/ 部分成功，分别写 result 或 error。
      // All succeeded
      const message = `✓ Installed ${successCount_0} ${plural(successCount_0, 'plugin')}. ` + `Run /reload-plugins to activate.`;
      setResult(message);
    } else if (successCount_0 === 0) {
      // All failed - show error with reasons
      setError(`Failed to install: ${formatFailureDetails(newFailedPlugins, true)}`);
    } else {
      // Mixed results - show partial success
      const message_0 = `✓ Installed ${successCount_0} of ${successCount_0 + failureCount} plugins. ` + `Failed: ${formatFailureDetails(newFailedPlugins, false)}. ` + `Run /reload-plugins to activate successfully installed plugins.`;
      setResult(message_0);
    }

    // Handle completion callback and navigation
// 成功时有 onInstallComplete 回调；安装后导航回父菜单。
    if (successCount_0 > 0) {
      if (onInstallComplete) {
        await onInstallComplete();
      }
    }
    setParentViewState({
      type: 'menu'
    });
  };

// handleSinglePluginInstall：详情视图单插件安装，支持 user/project/local 三种 scope；装完若有选项目标则进入 plugin-options 视图。
  // Install single plugin from details view
  const handleSinglePluginInstall = async (plugin_2: InstallablePlugin, scope: 'user' | 'project' | 'local' = 'user') => {
    setIsInstalling(true);
    setInstallError(null);
    const result_0 = await installPluginFromMarketplace({
      pluginId: plugin_2.pluginId,
      entry: plugin_2.entry,
      marketplaceName: plugin_2.marketplaceName,
      scope
    });
    if (result_0.success) {
      const loaded = await findPluginOptionsTarget(plugin_2.pluginId);
      if (loaded) {
        setIsInstalling(false);
        setViewState({
          type: 'plugin-options',
          plugin: loaded,
          pluginId: plugin_2.pluginId
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
// 第三个 useEffect：error 变化时把错误回写到 result 展示。
  useEffect(() => {
    if (error) {
      setResult(error);
    }
  }, [error, setResult]);

  // Marketplace-list navigation
// useKeybindings：市场列表导航（上/下/回车进入插件列表）。
  useKeybindings({
    'select:previous': () => {
      if (selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      }
    },
    'select:next': () => {
      if (selectedIndex < marketplaces.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      }
    },
    'select:accept': () => {
      const marketplace_2 = marketplaces[selectedIndex];
      if (marketplace_2) {
        setSelectedMarketplace(marketplace_2.name);
        setViewState('plugin-list');
      }
    }
  }, {
    context: 'Select',
    isActive: viewState === 'marketplace-list'
  });

  // Plugin-list navigation
// useKeybindings：插件列表导航——回车进入详情或触发安装；选中项为末项且有待安装集合时执行批量安装。
  useKeybindings({
    'select:previous': () => {
      if (selectedIndex > 0) {
        pagination.handleSelectionChange(selectedIndex - 1, setSelectedIndex);
      }
    },
    'select:next': () => {
      if (selectedIndex < availablePlugins.length - 1) {
        pagination.handleSelectionChange(selectedIndex + 1, setSelectedIndex);
      }
    },
    'select:accept': () => {
      if (selectedIndex === availablePlugins.length && selectedForInstall.size > 0) {
        void installSelectedPlugins();
      } else if (selectedIndex < availablePlugins.length) {
        const plugin_3 = availablePlugins[selectedIndex];
        if (plugin_3) {
          if (plugin_3.isInstalled) {
            setParentViewState({
              type: 'manage-plugins',
              targetPlugin: plugin_3.entry.name,
              targetMarketplace: plugin_3.marketplaceName
            });
          } else {
            setSelectedPlugin(plugin_3);
            setViewState('plugin-details');
            setDetailsMenuIndex(0);
            setInstallError(null);
          }
        }
      }
    }
  }, {
    context: 'Select',
    isActive: viewState === 'plugin-list'
  });
  useKeybindings({
// useKeybindings：plugin:toggle 切换待安装集合，plugin:install 触发批量安装。
    'plugin:toggle': () => {
      if (selectedIndex < availablePlugins.length) {
        const plugin_4 = availablePlugins[selectedIndex];
        if (plugin_4 && !plugin_4.isInstalled) {
          const newSelection = new Set(selectedForInstall);
          if (newSelection.has(plugin_4.pluginId)) {
            newSelection.delete(plugin_4.pluginId);
          } else {
            newSelection.add(plugin_4.pluginId);
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
    isActive: viewState === 'plugin-list'
  });

  // Plugin-details navigation
// detailsMenuOptions（useMemo）：根据是否有 homepage / github 仓库构建详情菜单项（安装各 scope / 主页 / github / 返回）。
  const detailsMenuOptions = React.useMemo(() => {
    if (!selectedPlugin) return [];
    const hasHomepage = selectedPlugin.entry.homepage;
    const githubRepo = extractGitHubRepo(selectedPlugin);
    return buildPluginDetailsMenuOptions(hasHomepage, githubRepo);
  }, [selectedPlugin]);
  useKeybindings({
// useKeybindings：详情视图导航——按菜单动作执行安装（三种 scope）、打开主页/仓库、或返回。
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
  if (typeof viewState === 'object' && viewState.type === 'plugin-options') {
    const {
      plugin: plugin_5,
      pluginId: pluginId_2
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
    return <PluginOptionsFlow plugin={plugin_5} pluginId={pluginId_2} onDone={(outcome, detail) => {
      switch (outcome) {
        case 'configured':
          finish(`✓ Installed and configured ${plugin_5.name}. Run /reload-plugins to apply.`);
          break;
        case 'skipped':
          finish(`✓ Installed ${plugin_5.name}. Run /reload-plugins to apply.`);
          break;
        case 'error':
          finish(`Installed but failed to save config: ${detail}`);
          break;
      }
    }} />;
  }
// plugin-options 视图：渲染 PluginOptionsFlow 收集插件选项，按 configured/skipped/error 收尾并回菜单。

  // Loading state
  if (loading) {
    return <Text>Loading…</Text>;
  }
// loading 时渲染加载态。

  // Error state
  if (error) {
    return <Text color="error">{error}</Text>;
  }
// error 时渲染错误态。

  // Marketplace selection view
  if (viewState === 'marketplace-list') {
    if (marketplaces.length === 0) {
      return <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Select marketplace</Text>
          </Box>
          <Text>No marketplaces configured.</Text>
          <Text dimColor>
            Add a marketplace first using {"'Add marketplace'"}.
          </Text>
          <Box marginTop={1} paddingLeft={1}>
            <Text dimColor>
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
            </Text>
          </Box>
        </Box>;
    }
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Select marketplace</Text>
        </Box>

        {/* Warning banner for marketplace load failures */}
        {warning && <Box marginBottom={1} flexDirection="column">
            <Text color="warning">
              {figures.warning} {warning}
            </Text>
          </Box>}
        {marketplaces.map((marketplace_3, index) => <Box key={marketplace_3.name} flexDirection="column" marginBottom={index < marketplaces.length - 1 ? 1 : 0}>
            <Box>
              <Text color={selectedIndex === index ? 'suggestion' : undefined}>
                {selectedIndex === index ? figures.pointer : ' '}{' '}
                {marketplace_3.name}
              </Text>
            </Box>
            <Box marginLeft={2}>
              <Text dimColor>
                {marketplace_3.totalPlugins}{' '}
                {plural(marketplace_3.totalPlugins, 'plugin')} available
                {marketplace_3.installedCount > 0 && ` · ${marketplace_3.installedCount} already installed`}
                {marketplace_3.source && ` · ${marketplace_3.source}`}
              </Text>
            </Box>
          </Box>)}

        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
            </Byline>
          </Text>
        </Box>
      </Box>;
  }
// 市场选择视图：列出市场（含插件数/已装数/来源）与加载失败警告横幅。

  // Plugin details view
  if (viewState === 'plugin-details' && selectedPlugin) {
    const hasHomepage_1 = selectedPlugin.entry.homepage;
    const githubRepo_1 = extractGitHubRepo(selectedPlugin);
    const menuOptions = buildPluginDetailsMenuOptions(hasHomepage_1, githubRepo_1);
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Plugin Details</Text>
        </Box>

        {/* Plugin metadata */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{selectedPlugin.entry.name}</Text>
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

        {/* What will be installed */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Will install:</Text>
          {selectedPlugin.entry.commands && <Text dimColor>
              · Commands:{' '}
              {Array.isArray(selectedPlugin.entry.commands) ? selectedPlugin.entry.commands.join(', ') : Object.keys(selectedPlugin.entry.commands).join(', ')}
            </Text>}
          {selectedPlugin.entry.agents && <Text dimColor>
              · Agents:{' '}
              {Array.isArray(selectedPlugin.entry.agents) ? selectedPlugin.entry.agents.join(', ') : Object.keys(selectedPlugin.entry.agents).join(', ')}
            </Text>}
          {selectedPlugin.entry.hooks && <Text dimColor>
              · Hooks: {Object.keys(selectedPlugin.entry.hooks).join(', ')}
            </Text>}
          {selectedPlugin.entry.mcpServers && <Text dimColor>
              · MCP Servers:{' '}
              {Array.isArray(selectedPlugin.entry.mcpServers) ? selectedPlugin.entry.mcpServers.join(', ') : typeof selectedPlugin.entry.mcpServers === 'object' ? Object.keys(selectedPlugin.entry.mcpServers).join(', ') : 'configured'}
            </Text>}
          {!selectedPlugin.entry.commands && !selectedPlugin.entry.agents && !selectedPlugin.entry.hooks && !selectedPlugin.entry.mcpServers && <>
                {typeof selectedPlugin.entry.source === 'object' && 'source' in selectedPlugin.entry.source && (selectedPlugin.entry.source.source === 'github' || selectedPlugin.entry.source.source === 'url' || selectedPlugin.entry.source.source === 'npm' || selectedPlugin.entry.source.source === 'pip') ? <Text dimColor>
                    · Component summary not available for remote plugin
                  </Text> :
          // TODO: Actually scan local plugin directories to show real components
          // This would require accessing the filesystem to check for:
          // - commands/ directory and list files
          // - agents/ directory and list files
          // - hooks/ directory and list files
          // - .mcp.json or mcp-servers.json files
          <Text dimColor>
                    · Components will be discovered at installation
                  </Text>}
              </>}
        </Box>

        <PluginTrustWarning />

        {/* Error message */}
        {installError && <Box marginBottom={1}>
            <Text color="error">Error: {installError}</Text>
          </Box>}

        {/* Menu options */}
        <Box flexDirection="column">
          {menuOptions.map((option, index_0) => <Box key={option.action}>
              {detailsMenuIndex === index_0 && <Text>{'> '}</Text>}
              {detailsMenuIndex !== index_0 && <Text>{'  '}</Text>}
              <Text bold={detailsMenuIndex === index_0}>
                {isInstalling && option.action === 'install' ? 'Installing…' : option.label}
              </Text>
            </Box>)}
        </Box>

        <Box marginTop={1} paddingLeft={1}>
          <Text dimColor>
            <Byline>
              <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>;
  }
// 插件详情视图：展示名称/版本/作者/描述、将安装的组件（命令/智能体/钩子/MCP）、信任警告与安装菜单。

  // Plugin installation view
  if (availablePlugins.length === 0) {
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Install plugins</Text>
        </Box>
        <Text dimColor>No new plugins available to install.</Text>
        <Text dimColor>
          All plugins from this marketplace are already installed.
        </Text>
        <Box marginLeft={3}>
          <Text dimColor italic>
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
          </Text>
        </Box>
      </Box>;
  }
// 无可安装新插件视图：市场插件已全部安装时的提示。

  // Get visible plugins from pagination
  const visiblePlugins = pagination.getVisibleItems(availablePlugins);
  return <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Install Plugins</Text>
      </Box>

      {/* Scroll up indicator */}
      {pagination.scrollPosition.canScrollUp && <Box>
          <Text dimColor> {figures.arrowUp} more above</Text>
        </Box>}

      {/* Plugin list */}
      {visiblePlugins.map((plugin_6, visibleIndex) => {
      const actualIndex = pagination.toActualIndex(visibleIndex);
      const isSelected = selectedIndex === actualIndex;
      const isSelectedForInstall = selectedForInstall.has(plugin_6.pluginId);
      const isInstalling_0 = installingPlugins.has(plugin_6.pluginId);
      const isLast = visibleIndex === visiblePlugins.length - 1;
      return <Box key={plugin_6.pluginId} flexDirection="column" marginBottom={isLast && !error ? 0 : 1}>
            <Box>
              <Text color={isSelected ? 'suggestion' : undefined}>
                {isSelected ? figures.pointer : ' '}{' '}
              </Text>
              <Text color={plugin_6.isInstalled ? 'success' : undefined}>
                {plugin_6.isInstalled ? figures.tick : isInstalling_0 ? figures.ellipsis : isSelectedForInstall ? figures.radioOn : figures.radioOff}{' '}
                {plugin_6.entry.name}
                {plugin_6.entry.category && <Text dimColor> [{plugin_6.entry.category}]</Text>}
                {plugin_6.entry.tags?.includes('community-managed') && <Text dimColor> [Community Managed]</Text>}
                {plugin_6.isInstalled && <Text dimColor> (installed)</Text>}
                {installCounts && selectedMarketplace === OFFICIAL_MARKETPLACE_NAME && <Text dimColor>
                      {' · '}
                      {formatInstallCount(installCounts.get(plugin_6.pluginId) ?? 0)}{' '}
                      installs
                    </Text>}
              </Text>
            </Box>
            {plugin_6.entry.description && <Box marginLeft={4}>
                <Text dimColor>
                  {truncateToWidth(plugin_6.entry.description, 60)}
                </Text>
                {plugin_6.entry.version && <Text dimColor> · v{plugin_6.entry.version}</Text>}
              </Box>}
          </Box>;
    })}

      {/* Scroll down indicator */}
      {pagination.scrollPosition.canScrollDown && <Box>
          <Text dimColor> {figures.arrowDown} more below</Text>
        </Box>}

      {/* Error messages shown in the UI */}
      {error && <Box marginTop={1}>
          <Text color="error">
            {figures.cross} {error}
          </Text>
        </Box>}

      <PluginSelectionKeyHint hasSelection={selectedForInstall.size > 0} />
    </Box>;
// 安装清单视图：按分页取可见插件渲染（含已装标记、热度、滚动上下指示与底部快捷键提示）。
}
// 原文件此处有一行 87684 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。