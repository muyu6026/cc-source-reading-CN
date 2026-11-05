// 第一行就是编译器运行时：这份文件不是手写源码，是 React Compiler 的输出，后面满篇的编号记忆槽与临时变量都来自它
import { c as _c } from "react/compiler-runtime";
// 终端符号库提供对钩、指针、叉号这类字形；后面的操作回执直接把符号拼进字符串里
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { Pane } from '../../components/design-system/Pane.js';
import { Tab, Tabs } from '../../components/design-system/Tabs.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { PluginError } from '../../types/plugin.js';
import { errorMessage } from '../../utils/errors.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { loadMarketplacesWithGracefulDegradation } from '../../utils/plugins/marketplaceHelpers.js';
import { loadKnownMarketplacesConfig, removeMarketplaceSource } from '../../utils/plugins/marketplaceManager.js';
import { getPluginEditableScopes } from '../../utils/plugins/pluginStartupCheck.js';
import type { EditableSettingSource } from '../../utils/settings/constants.js';
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { AddMarketplace } from './AddMarketplace.js';
import { BrowseMarketplace } from './BrowseMarketplace.js';
import { DiscoverPlugins } from './DiscoverPlugins.js';
import { ManageMarketplaces } from './ManageMarketplaces.js';
import { ManagePlugins } from './ManagePlugins.js';
import { formatErrorMessage, getErrorGuidance } from './PluginErrors.js';
import { type ParsedCommand, parsePluginArgs } from './parseArgs.js';
import type { PluginSettingsProps, ViewState } from './types.js';
import { ValidatePlugin } from './ValidatePlugin.js';
// 四个页签：发现、已安装、市场、错误。页签是导航层，视图状态才是内容层，两者在这里分成两个状态
type TabId = 'discover' | 'installed' | 'marketplaces' | 'errors';
// 未配置市场时的极简视图：只拉一次配置，把名字列出来就结束
function MarketplaceList(t0) {
  const $ = _c(4);
  const {
    onComplete
  } = t0;
  let t1;
  let t2;
// 编译器为每个依赖开一个槽位，靠引用比较决定要不要重建这个副作用——这里唯一的依赖是完成回调
  if ($[0] !== onComplete) {
    t1 = () => {
      const loadList = async function loadList() {
        ;
        try {
          const config = await loadKnownMarketplacesConfig();
          const names = Object.keys(config);
          if (names.length === 0) {
// 两种回执文案：一个是「没有配置过」，一个是把名字逐行列出；都用完成回调送出去，因为这是无界面的一次性命令
            onComplete("No marketplaces configured");
          } else {
            onComplete(`Configured marketplaces:\n${names.map(_temp).join("\n")}`);
          }
        } catch (t3) {
          const err = t3;
          onComplete(`Error loading marketplaces: ${errorMessage(err)}`);
        }
      };
      loadList();
    };
    t2 = [onComplete];
    $[0] = onComplete;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  let t3;
// 静态界面片段用「已记忆」哨兵占位，第二次渲染直接取缓存，不重新创建元素
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text>Loading marketplaces...</Text>;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  return t3;
}
// 内联箭头被提升成顶层函数：这样每次渲染拿到的是同一个引用，比较槽位才不会每次都判定为变
function _temp(n) {
  return `  • ${n}`;
}
// 这个组件恒返回空：迁移到 MCP 页之后横幅被摘掉了，但调用点还留着——接线保留、渲染关闭
function McpRedirectBanner() {
  return null;
}
// 错误行的动作是五选一：跳转、从设置里摘市场、删已装市场、只能由组织处理、无动作
type ErrorRowAction = {
  kind: 'navigate';
  tab: TabId;
  viewState: ViewState;
} | {
  kind: 'remove-extra-marketplace';
  name: string;
  sources: Array<{
    source: EditableSettingSource;
    scope: string;
  }>;
} | {
  kind: 'remove-installed-marketplace';
  name: string;
} | {
  kind: 'managed-only';
  name: string;
} | {
  kind: 'none';
};
type ErrorRow = {
  label: string;
  message: string;
  guidance?: string | null;
  action: ErrorRowAction;
  scope?: string;
};

/**
 * Determine which settings sources define an extraKnownMarketplace entry.
 * Returns the editable sources (user/project/local) and whether policy also has it.
 */
// 要判断一个市场是谁定义的，就得把三个可编辑源与策略源都查一遍：前者能改、后者只读
function getExtraMarketplaceSourceInfo(name: string): {
  editableSources: Array<{
    source: EditableSettingSource;
    scope: string;
  }>;
  isInPolicy: boolean;
} {
  const editableSources: Array<{
    source: EditableSettingSource;
    scope: string;
  }> = [];
// 三个可编辑源的顺序固定为用户、项目、本地——回执与作用域展示都依赖这个顺序稳定
  const sourcesToCheck = [{
    source: 'userSettings' as const,
    scope: 'user'
  }, {
    source: 'projectSettings' as const,
    scope: 'project'
  }, {
    source: 'localSettings' as const,
    scope: 'local'
  }];
  for (const {
    source,
    scope
  } of sourcesToCheck) {
    const settings = getSettingsForSource(source);
    if (settings?.extraKnownMarketplaces?.[name]) {
      editableSources.push({
        source,
        scope
      });
    }
  }
// 策略源单独查、只取布尔：它不可编辑，只能用来解释「为什么删不掉」
  const policySettings = getSettingsForSource('policySettings');
  const isInPolicy = Boolean(policySettings?.extraKnownMarketplaces?.[name]);
  return {
    editableSources,
    isInPolicy
  };
}
// 动作选择有严格优先级：有可编辑来源就给「从设置里摘」；只在策略里就标记为由组织管理；两者都没有才去市场管理页
function buildMarketplaceAction(name: string): ErrorRowAction {
  const {
    editableSources,
    isInPolicy
  } = getExtraMarketplaceSourceInfo(name);
  if (editableSources.length > 0) {
    return {
      kind: 'remove-extra-marketplace',
      name,
      sources: editableSources
    };
  }
// 只在策略里定义的市场不给删除动作，改为一句「联系管理员」的说明——能做与不能做必须分清，否则点下去只会失败
  if (isInPolicy) {
    return {
      kind: 'managed-only',
      name
    };
  }

// 第三种情况是在市场清单文件里有、但不在设置的已知市场列表里（比如历史上手装过），这时引导到市场管理页去删
  // Marketplace is in known_marketplaces.json but not in extraKnownMarketplaces
  // (e.g. previously installed manually) — route to ManageMarketplaces
  return {
    kind: 'navigate',
    tab: 'marketplaces',
    viewState: {
      type: 'manage-marketplaces',
      targetMarketplace: name,
      action: 'remove'
    }
  };
}
// 插件错误一律导向「卸载」：报错的插件能做的事只有两件，看错误、卸掉重装，所以只给一个动作
function buildPluginAction(pluginName: string): ErrorRowAction {
  return {
    kind: 'navigate',
    tab: 'installed',
    viewState: {
      type: 'manage-plugins',
      targetPlugin: pluginName,
      action: 'uninstall'
    }
  };
}
// 三种瞬时错误单独归类：认证失败、超时、网络错误。它们的共同点是重试可能就好，所以不给修复动作，只提示重启后重试
const TRANSIENT_ERROR_TYPES = new Set(['git-auth-failed', 'git-timeout', 'network-error']);
function isTransientError(error: PluginError): boolean {
  return TRANSIENT_ERROR_TYPES.has(error.type);
}

/**
 * Extract the plugin name from a PluginError, checking explicit fields first,
 * then falling back to the source field (format: "pluginName@marketplace").
 */
// 从错误对象里挖插件名要按顺序试三个来源，因为不同的错误类型填的字段不一样
function getPluginNameFromError(error: PluginError): string | undefined {
  if ('pluginId' in error && error.pluginId) return error.pluginId;
  if ('plugin' in error && error.plugin) return error.plugin;
  // Fallback: source often contains "pluginName@marketplace"
  if (error.source.includes('@')) return error.source.split('@')[0];
  return undefined;
}
// 这个函数把七路来源拼成一张错误表：瞬时错误、失败市场、额外市场、已装但加载失败的市场、插件错误、其余错误
function buildErrorRows(failedMarketplaces: Array<{
  name: string;
  error?: string;
}>, extraMarketplaceErrors: PluginError[], pluginLoadingErrors: PluginError[], otherErrors: PluginError[], brokenInstalledMarketplaces: Array<{
  name: string;
  error: string;
}>, transientErrors: PluginError[], pluginScopes: Map<string, string>): ErrorRow[] {
  const rows: ErrorRow[] = [];

// 瞬时错误排在最上面：它们没法在这里修，能做的只有重启，放最上面用户第一眼就能看到
  // --- Transient errors at the top (restart to retry) ---
  for (const error of transientErrors) {
    const pluginName = 'pluginId' in error ? error.pluginId : 'plugin' in error ? error.plugin : undefined;
    rows.push({
      label: pluginName ?? error.source,
      message: formatErrorMessage(error),
      guidance: 'Restart to retry loading plugins',
      action: {
        kind: 'none'
      }
    });
  }

  // --- Marketplace errors ---
  // Track shown marketplace names to avoid duplicates across sources
// 市场名要跨来源去重：同一个市场可能既在失败列表里又在错误列表里，不去重会出现两行一模一样的条目
  const shownMarketplaceNames = new Set<string>();
  for (const m of failedMarketplaces) {
    shownMarketplaceNames.add(m.name);
    const action = buildMarketplaceAction(m.name);
    const sourceInfo = getExtraMarketplaceSourceInfo(m.name);
    const scope = sourceInfo.isInPolicy ? 'managed' : sourceInfo.editableSources[0]?.scope;
    rows.push({
      label: m.name,
      message: m.error ?? 'Installation failed',
      guidance: action.kind === 'managed-only' ? 'Managed by your organization — contact your admin' : undefined,
      action,
      scope
    });
  }
// 额外市场错误先去重再建行：已在失败市场列表里出现过的不再重复生成
  for (const e of extraMarketplaceErrors) {
    const marketplace = 'marketplace' in e ? e.marketplace : e.source;
    if (shownMarketplaceNames.has(marketplace)) continue;
    shownMarketplaceNames.add(marketplace);
    const action = buildMarketplaceAction(marketplace);
    const sourceInfo = getExtraMarketplaceSourceInfo(marketplace);
    const scope = sourceInfo.isInPolicy ? 'managed' : sourceInfo.editableSources[0]?.scope;
    rows.push({
      label: marketplace,
      message: formatErrorMessage(e),
      guidance: action.kind === 'managed-only' ? 'Managed by your organization — contact your admin' : getErrorGuidance(e),
      action,
      scope
    });
  }

// 已安装但数据加载失败的市场走第三种动作：直接删掉这个市场源，而不是从设置里摘
  // Installed marketplaces that fail to load data (from known_marketplaces.json)
  for (const m of brokenInstalledMarketplaces) {
    if (shownMarketplaceNames.has(m.name)) continue;
    shownMarketplaceNames.add(m.name);
    rows.push({
      label: m.name,
      message: m.error,
      action: {
        kind: 'remove-installed-marketplace',
        name: m.name
      }
    });
  }

// 插件错误按插件名去重，而不是按错误对象：一个插件可能报多条错，界面上只留一行
  // --- Plugin errors ---
  const shownPluginNames = new Set<string>();
  for (const error of pluginLoadingErrors) {
    const pluginName = getPluginNameFromError(error);
    if (pluginName && shownPluginNames.has(pluginName)) continue;
    if (pluginName) shownPluginNames.add(pluginName);
    const marketplace = 'marketplace' in error ? error.marketplace : undefined;
    // Try pluginId@marketplace format first, then just pluginName
// 作用域查两次：先按完整的来源串（可能带市场后缀），再按纯插件名——两种键都可能是写入时的形态
    const scope = pluginName ? pluginScopes.get(error.source) ?? pluginScopes.get(pluginName) : undefined;
    rows.push({
      label: pluginName ? marketplace ? `${pluginName} @ ${marketplace}` : pluginName : error.source,
      message: formatErrorMessage(error),
      guidance: getErrorGuidance(error),
      action: pluginName ? buildPluginAction(pluginName) : {
        kind: 'none'
      },
      scope
    });
  }

// 剩下的都是既不属于市场也不属于具体插件的错误：只展示，不给动作
  // --- Other errors (non-marketplace, non-plugin-specific) ---
  for (const error of otherErrors) {
    rows.push({
      label: error.source,
      message: formatErrorMessage(error),
      guidance: getErrorGuidance(error),
      action: {
        kind: 'none'
      }
    });
  }
  return rows;
}

// 从设置里摘市场的函数：它要同时收拾两处，市场定义本身与依赖这个市场的已启用插件
/**
 * Remove a marketplace from extraKnownMarketplaces in the given settings sources,
 * and also remove any associated enabled plugins.
 */
function removeExtraMarketplace(name: string, sources: Array<{
  source: EditableSettingSource;
}>): void {
  for (const {
    source
  } of sources) {
    const settings = getSettingsForSource(source);
    if (!settings) continue;
    const updates: Record<string, unknown> = {};

// 置空值而不是删键：设置文件序列化时空值字段会整体消失，而直接删键可能触发别的合并逻辑
    // Remove from extraKnownMarketplaces
    if (settings.extraKnownMarketplaces?.[name]) {
      updates.extraKnownMarketplaces = {
        ...settings.extraKnownMarketplaces,
        [name]: undefined
      };
    }

// 连带清插件时用后缀匹配：插件标识的形态是「插件名加艾特加市场名」，只能从尾部判断归属
    // Remove associated enabled plugins (format: "plugin@marketplace")
    if (settings.enabledPlugins) {
      const suffix = `@${name}`;
      let removedPlugins = false;
      const updatedPlugins = {
        ...settings.enabledPlugins
      };
      for (const pluginId in updatedPlugins) {
        if (pluginId.endsWith(suffix)) {
          updatedPlugins[pluginId] = undefined;
          removedPlugins = true;
        }
      }
      if (removedPlugins) {
        updates.enabledPlugins = updatedPlugins;
      }
    }
// 没有任何改动就不写盘：避免为一个不存在的条目产生一次空的设置写入
    if (Object.keys(updates).length > 0) {
      updateSettingsForSource(source, updates);
    }
  }
}
// 错误页是这个文件里最重的组件：二十六个记忆槽，一半给筛选派生值、一半给界面片段
function ErrorsTabContent(t0) {
  const $ = _c(26);
  const {
    setViewState,
    setActiveTab,
    markPluginsChanged
  } = t0;
// 错误与安装状态都从应用状态取：这两份数据是全局刷新的，不归本组件管
  const errors = useAppState(_temp2);
  const installationStatus = useAppState(_temp3);
  const setAppState = useSetAppState();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState(null);
  let t1;
// 连一个空数组都走哨兵：保证初始状态的引用稳定，否则每次渲染都会重建状态
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const [marketplaceLoadFailures, setMarketplaceLoadFailures] = useState(t1);
  let t2;
  let t3;
// 首帧拉一次市场加载失败列表：这是一次性副作用，依赖数组为空，所以只跑一次
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
// 注意这里把异常吞掉了：失败列表拉不到就不显示，不能因为诊断信息取不到而让整个错误页崩掉
      (async () => {
        try {
          const config = await loadKnownMarketplacesConfig();
          const {
            failures
          } = await loadMarketplacesWithGracefulDegradation(config);
          setMarketplaceLoadFailures(failures);
        } catch {}
      })();
    };
    t3 = [];
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
// 失败市场从安装状态里筛，而不是从错误列表里推：安装状态才是「这个市场到底能不能用」的真相
  const failedMarketplaces = installationStatus.marketplaces.filter(_temp4);
  const failedMarketplaceNames = new Set(failedMarketplaces.map(_temp5));
  const transientErrors = errors.filter(isTransientError);
// 筛选时排除已在失败列表里的市场名：同一个问题只报一次，位置在更像根因的那一组
  const extraMarketplaceErrors = errors.filter(e => (e.type === "marketplace-not-found" || e.type === "marketplace-load-failed" || e.type === "marketplace-blocked-by-policy") && !failedMarketplaceNames.has(e.marketplace));
  const pluginLoadingErrors = errors.filter(_temp6);
  const otherErrors = errors.filter(_temp7);
// 作用域映射来自插件启动检查：它能算出每个来源实际落在哪个可编辑作用域
  const pluginScopes = getPluginEditableScopes();
  const rows = buildErrorRows(failedMarketplaces, extraMarketplaceErrors, pluginLoadingErrors, otherErrors, marketplaceLoadFailures, transientErrors, pluginScopes);
  let t4;
  if ($[3] !== setViewState) {
    t4 = () => {
      setViewState({
        type: "menu"
      });
    };
    $[3] = setViewState;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      context: "Confirmation"
    };
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  useKeybinding("confirm:no", t4, t5);
// 选中一行之后按动作类型分派：五种动作里只有三种会真的做事
  const handleSelect = () => {
    const row = rows[selectedIndex];
    if (!row) {
      return;
    }
    const {
      action
    } = row;
// 分派用带标签的 switch：编译器把每个分支重写成带标签的块，break 后面那个标签就是它自己
    bb77: switch (action.kind) {
      case "navigate":
        {
          setActiveTab(action.tab);
          setViewState(action.viewState);
          break bb77;
        }
// 摘市场这一支做了四件事：改设置、清缓存、乐观更新应用状态、写回执
      case "remove-extra-marketplace":
        {
          const scopes = action.sources.map(_temp8).join(", ");
          removeExtraMarketplace(action.name, action.sources);
          clearAllCaches();
// 乐观更新是把两处同时摘掉：错误列表里同市场的条目、安装状态里的市场条目——少删一处就会留下幽灵行
          setAppState(prev_0 => ({
            ...prev_0,
            plugins: {
              ...prev_0.plugins,
              errors: prev_0.plugins.errors.filter(e_2 => !("marketplace" in e_2 && e_2.marketplace === action.name)),
              installationStatus: {
                ...prev_0.plugins.installationStatus,
                marketplaces: prev_0.plugins.installationStatus.marketplaces.filter(m_1 => m_1.name !== action.name)
              }
            }
          }));
// 回执里带上作用域名：用户刚在三个作用域里改过，得知道到底改了哪一个
          setActionMessage(`${figures.tick} Removed "${action.name}" from ${scopes} settings`);
          markPluginsChanged();
          break bb77;
        }
// 删已装市场是异步的，所以整支包成立即执行函数：失败要能回写一条错误回执，而不是静默
      case "remove-installed-marketplace":
        {
          (async () => {
            ;
            try {
              await removeMarketplaceSource(action.name);
              clearAllCaches();
              setMarketplaceLoadFailures(prev => prev.filter(f => f.name !== action.name));
              setActionMessage(`${figures.tick} Removed marketplace "${action.name}"`);
              markPluginsChanged();
            } catch (t6) {
              const err = t6;
              setActionMessage(`Failed to remove "${action.name}": ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
          break bb77;
        }
// 由组织管理的市场按回车什么都不做，也不给提示：可选性已经由「有没有动作」这个判断控制过了，这里只是兜底
      case "managed-only":
        {
          break bb77;
        }
      case "none":
    }
  };
  let t7;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = () => setSelectedIndex(_temp9);
    $[6] = t7;
  } else {
    t7 = $[6];
  }
// 有没有行决定选择键位是否启用：空表时按下方向键不该有任何反应
  const t8 = rows.length > 0;
  let t9;
  if ($[7] !== t8) {
    t9 = {
      context: "Select",
      isActive: t8
    };
    $[7] = t8;
    $[8] = t9;
  } else {
    t9 = $[8];
  }
// 三个键位：上一条、下一条、确认。下一个用夹取而不是取模，到底了就停住
  useKeybindings({
    "select:previous": t7,
    "select:next": () => setSelectedIndex(prev_2 => Math.min(rows.length - 1, prev_2 + 1)),
    "select:accept": handleSelect
  }, t9);
// 序号在这里夹取：行数可能因为应用状态更新而变少，选中位置得跟着收回来
  const clampedIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1));
  if (clampedIndex !== selectedIndex) {
    setSelectedIndex(clampedIndex);
  }
// 把「有没有动作」抽成一个布尔：界面提示与键位启用都用它，避免两处各判一次、判法还不一样
  const selectedAction = rows[clampedIndex]?.action;
  const hasAction = selectedAction && selectedAction.kind !== "none" && selectedAction.kind !== "managed-only";
// 空态直接返回：一行提示加一个返回键提示，不渲染列表骨架
  if (rows.length === 0) {
    let t10;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Box marginLeft={1}><Text dimColor={true}>No plugin errors</Text></Box>;
      $[9] = t10;
    } else {
      t10 = $[9];
    }
    let t11;
    if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
      t11 = <Box flexDirection="column">{t10}<Box marginTop={1}><Text dimColor={true} italic={true}><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" /></Text></Box></Box>;
      $[10] = t11;
    } else {
      t11 = $[10];
    }
    return t11;
  }
  const T0 = Box;
  const t10 = "column";
  let t11;
  if ($[11] !== clampedIndex) {
    t11 = (row_0, idx) => {
      const isSelected = idx === clampedIndex;
// 选中态换指针与强调色、非选中态换叉号与错误色：同一份结构，靠两个三元切换视觉状态
      return <Box key={idx} marginLeft={1} flexDirection="column" marginBottom={1}><Text><Text color={isSelected ? "suggestion" : "error"}>{isSelected ? figures.pointer : figures.cross}{" "}</Text><Text bold={isSelected}>{row_0.label}</Text>{row_0.scope && <Text dimColor={true}> ({row_0.scope})</Text>}</Text><Box marginLeft={3}><Text color="error">{row_0.message}</Text></Box>{row_0.guidance && <Box marginLeft={3}><Text dimColor={true} italic={true}>{row_0.guidance}</Text></Box>}</Box>;
    };
    $[11] = clampedIndex;
    $[12] = t11;
  } else {
    t11 = $[12];
  }
  const t12 = rows.map(t11);
  let t13;
  if ($[13] !== actionMessage) {
    t13 = actionMessage && <Box marginTop={1} marginLeft={1}><Text color="claude">{actionMessage}</Text></Box>;
    $[13] = actionMessage;
    $[14] = t13;
  } else {
    t13 = $[14];
  }
  let t14;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t14 = <ConfigurableShortcutHint action="select:previous" context="Select" fallback={"\u2191"} description="navigate" />;
    $[15] = t14;
  } else {
    t14 = $[15];
  }
  let t15;
  if ($[16] !== hasAction) {
    t15 = hasAction && <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="resolve" />;
    $[16] = hasAction;
    $[17] = t15;
  } else {
    t15 = $[17];
  }
  let t16;
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />;
    $[18] = t16;
  } else {
    t16 = $[18];
  }
  let t17;
  if ($[19] !== t15) {
    t17 = <Box marginTop={1}><Text dimColor={true} italic={true}><Byline>{t14}{t15}{t16}</Byline></Text></Box>;
    $[19] = t15;
    $[20] = t17;
  } else {
    t17 = $[20];
  }
  let t18;
  if ($[21] !== T0 || $[22] !== t12 || $[23] !== t13 || $[24] !== t17) {
    t18 = <T0 flexDirection={t10}>{t12}{t13}{t17}</T0>;
    $[21] = T0;
    $[22] = t12;
    $[23] = t13;
    $[24] = t17;
    $[25] = t18;
  } else {
    t18 = $[25];
  }
  return t18;
}
function _temp9(prev_1) {
  return Math.max(0, prev_1 - 1);
}
function _temp8(s_1) {
  return s_1.scope;
}
function _temp7(e_1) {
  if (isTransientError(e_1)) {
    return false;
  }
  if (e_1.type === "marketplace-not-found" || e_1.type === "marketplace-load-failed" || e_1.type === "marketplace-blocked-by-policy") {
    return false;
  }
  return getPluginNameFromError(e_1) === undefined;
}
function _temp6(e_0) {
  if (isTransientError(e_0)) {
    return false;
  }
  if (e_0.type === "marketplace-not-found" || e_0.type === "marketplace-load-failed" || e_0.type === "marketplace-blocked-by-policy") {
    return false;
  }
  return getPluginNameFromError(e_0) !== undefined;
}
function _temp5(m_0) {
  return m_0.name;
}
function _temp4(m) {
  return m.status === "failed";
}
function _temp3(s_0) {
  return s_0.plugins.installationStatus;
}
function _temp2(s) {
  return s.plugins.errors;
}
// 命令行参数到视图的映射：这是整个命令的入口翻译层，一条命令一个分支
function getInitialViewState(parsedCommand: ParsedCommand): ViewState {
  switch (parsedCommand.type) {
    case 'help':
      return {
        type: 'help'
      };
    case 'validate':
      return {
        type: 'validate',
        path: parsedCommand.path
      };
    case 'install':
// 带市场名就进浏览页并带上目标插件：这样能直接定位到某个市场里的某个插件
      if (parsedCommand.marketplace) {
        return {
          type: 'browse-marketplace',
          targetMarketplace: parsedCommand.marketplace,
          targetPlugin: parsedCommand.plugin
        };
      }
      if (parsedCommand.plugin) {
        return {
          type: 'discover-plugins',
          targetPlugin: parsedCommand.plugin
        };
      }
      return {
        type: 'discover-plugins'
      };
// 管理、卸载、启用、禁用四个动作都落到同一个视图，只是带不同的动作标记
    case 'manage':
      return {
        type: 'manage-plugins'
      };
    case 'uninstall':
      return {
        type: 'manage-plugins',
        targetPlugin: parsedCommand.plugin,
        action: 'uninstall'
      };
    case 'enable':
      return {
        type: 'manage-plugins',
        targetPlugin: parsedCommand.plugin,
        action: 'enable'
      };
    case 'disable':
      return {
        type: 'manage-plugins',
        targetPlugin: parsedCommand.plugin,
        action: 'disable'
      };
// 市场子命令四个分支：列表、添加、删除、更新；什么都不带就进市场菜单
    case 'marketplace':
      if (parsedCommand.action === 'list') {
        return {
          type: 'marketplace-list'
        };
      }
      if (parsedCommand.action === 'add') {
        return {
          type: 'add-marketplace',
          initialValue: parsedCommand.target
        };
      }
      if (parsedCommand.action === 'remove') {
        return {
          type: 'manage-marketplaces',
          targetMarketplace: parsedCommand.target,
          action: 'remove'
        };
      }
      if (parsedCommand.action === 'update') {
        return {
          type: 'manage-marketplaces',
          targetMarketplace: parsedCommand.target,
          action: 'update'
        };
      }
      return {
        type: 'marketplace-menu'
      };
// 没有任何参数时默认进发现页：新用户打开这个命令最可能想看的是「有什么可装」
    case 'menu':
    default:
      // Default to discover view showing all plugins
      return {
        type: 'discover-plugins'
      };
  }
}
// 初始页签由初始视图反推：视图是真相，页签只是它的投影，所以不单独传
function getInitialTab(viewState: ViewState): TabId {
  if (viewState.type === 'manage-plugins') return 'installed';
  if (viewState.type === 'manage-marketplaces') return 'marketplaces';
  return 'discover';
}
// 外壳组件：七十多个记忆槽，因为几乎所有子视图都要从这里接回调
export function PluginSettings(t0) {
  const $ = _c(75);
  const {
    onComplete,
    args,
    showMcpRedirectMessage
  } = t0;
// 参数解析与初始视图一起缓存：两者只依赖参数，绑在同一个槽位上
  let parsedCommand;
  let t1;
  if ($[0] !== args) {
    parsedCommand = parsePluginArgs(args);
    t1 = getInitialViewState(parsedCommand);
    $[0] = args;
    $[1] = parsedCommand;
    $[2] = t1;
  } else {
    parsedCommand = $[1];
    t1 = $[2];
  }
  const initialViewState = t1;
// 视图状态用初始视图做初值：这个组件的整个生命周期就是「视图状态机」本身
  const [viewState, setViewState] = useState(initialViewState);
  let t2;
  if ($[3] !== initialViewState) {
    t2 = getInitialTab(initialViewState);
    $[3] = initialViewState;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const [activeTab, setActiveTab] = useState(t2);
// 输入框初值来自视图：命令行直接带了市场地址时，用户打开就看到它已经填好
  const [inputValue, setInputValue] = useState(viewState.type === "add-marketplace" ? viewState.initialValue || "" : "");
  const [cursorOffset, setCursorOffset] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [childSearchActive, setChildSearchActive] = useState(false);
  const setAppState = useSetAppState();
// 错误数不是只数错误列表：还要加上加载失败的市场，否则页签写着无错、点进去却有行
  const pluginErrorCount = useAppState(_temp0);
  const errorsTabTitle = pluginErrorCount > 0 ? `Errors (${pluginErrorCount})` : "Errors";
  const exitState = useExitOnCtrlCDWithKeybindings();
// 命令行模式判定很具体：市场添加且带了目标值，此时不走交互输入，直接把参数当输入提交
  const cliMode = parsedCommand.type === "marketplace" && parsedCommand.action === "add" && parsedCommand.target !== undefined;
  let t3;
// 标记插件已变的函数只做一件事：把刷新标记置真。真正的重载由别处监听这个标记触发
  if ($[5] !== setAppState) {
    t3 = () => {
      setAppState(_temp1);
    };
    $[5] = setAppState;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const markPluginsChanged = t3;
  let t4;
// 切页签的处理函数是无依赖的，所以整块只构建一次
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = tabId => {
      const tab = tabId as TabId;
      setActiveTab(tab);
      setError(null);
// 四个页签各自设定默认视图：页签是导航，视图是内容，切页签必须把内容也拨回该页签的根
      bb37: switch (tab) {
        case "discover":
          {
            setViewState({
              type: "discover-plugins"
            });
            break bb37;
          }
        case "installed":
          {
            setViewState({
              type: "manage-plugins"
            });
            break bb37;
          }
        case "marketplaces":
          {
            setViewState({
              type: "manage-marketplaces"
            });
            break bb37;
          }
// 错误页是唯一不设视图的分支：它的内容完全由应用状态与本地副作用决定，没有子视图要切
        case "errors":
      }
    };
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const handleTabChange = t4;
  let t5;
  let t6;
// 菜单页且还没有结果时才结束：有结果要先把它交出去，否则一次命令会丢掉回执
  if ($[8] !== onComplete || $[9] !== result || $[10] !== viewState.type) {
    t5 = () => {
      if (viewState.type === "menu" && !result) {
        onComplete();
      }
    };
    t6 = [viewState.type, result, onComplete];
    $[8] = onComplete;
    $[9] = result;
    $[10] = viewState.type;
    $[11] = t5;
    $[12] = t6;
  } else {
    t5 = $[11];
    t6 = $[12];
  }
  useEffect(t5, t6);
  let t7;
  let t8;
// 浏览页强制把页签拨回发现页：浏览属于发现页签下的子视图，停在别的页签上会看不到它
  if ($[13] !== activeTab || $[14] !== viewState.type) {
    t7 = () => {
      if (viewState.type === "browse-marketplace" && activeTab !== "discover") {
        setActiveTab("discover");
      }
    };
    t8 = [viewState.type, activeTab];
    $[13] = activeTab;
    $[14] = viewState.type;
    $[15] = t7;
    $[16] = t8;
  } else {
    t7 = $[15];
    t8 = $[16];
  }
  useEffect(t7, t8);
  let t9;
// 添加市场的退出键位：回市场页签、清输入、清错误，三件事一起做
  if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = () => {
      setActiveTab("marketplaces");
      setViewState({
        type: "manage-marketplaces"
      });
      setInputValue("");
      setError(null);
    };
    $[17] = t9;
  } else {
    t9 = $[17];
  }
  const handleAddMarketplaceEscape = t9;
  const t10 = viewState.type === "add-marketplace";
  let t11;
  if ($[18] !== t10) {
    t11 = {
      context: "Settings",
      isActive: t10
    };
    $[18] = t10;
    $[19] = t11;
  } else {
    t11 = $[19];
  }
  useKeybinding("confirm:no", handleAddMarketplaceEscape, t11);
  let t12;
  let t13;
// 有结果就带着结果结束：这是把「做完了」翻译成「命令返回什么」
  if ($[20] !== onComplete || $[21] !== result) {
    t12 = () => {
      if (result) {
        onComplete(result);
      }
    };
    t13 = [result, onComplete];
    $[20] = onComplete;
    $[21] = result;
    $[22] = t12;
    $[23] = t13;
  } else {
    t12 = $[22];
    t13 = $[23];
  }
  useEffect(t12, t13);
  let t14;
  let t15;
// 帮助页进来就结束：帮助是纯静态内容，不需要留在界面里等用户操作
  if ($[24] !== onComplete || $[25] !== viewState.type) {
    t14 = () => {
      if (viewState.type === "help") {
        onComplete();
      }
    };
    t15 = [viewState.type, onComplete];
    $[24] = onComplete;
    $[25] = viewState.type;
    $[26] = t14;
    $[27] = t15;
  } else {
    t14 = $[26];
    t15 = $[27];
  }
  useEffect(t14, t15);
// 帮助视图整块缓存：二十七行静态文本，构建一次就够
  if (viewState.type === "help") {
    let t16;
    if ($[28] === Symbol.for("react.memo_cache_sentinel")) {
      t16 = <Box flexDirection="column"><Text bold={true}>Plugin Command Usage:</Text><Text> </Text><Text dimColor={true}>Installation:</Text><Text> /plugin install - Browse and install plugins</Text><Text>{" "}{"/plugin install <marketplace> - Install from specific marketplace"}</Text><Text>{" /plugin install <plugin> - Install specific plugin"}</Text><Text>{" "}{"/plugin install <plugin>@<market> - Install plugin from marketplace"}</Text><Text> </Text><Text dimColor={true}>Management:</Text><Text> /plugin manage - Manage installed plugins</Text><Text>{" /plugin enable <plugin> - Enable a plugin"}</Text><Text>{" /plugin disable <plugin> - Disable a plugin"}</Text><Text>{" /plugin uninstall <plugin> - Uninstall a plugin"}</Text><Text> </Text><Text dimColor={true}>Marketplaces:</Text><Text> /plugin marketplace - Marketplace management menu</Text><Text> /plugin marketplace add - Add a marketplace</Text><Text>{" "}{"/plugin marketplace add <path/url> - Add marketplace directly"}</Text><Text> /plugin marketplace update - Update marketplaces</Text><Text>{" "}{"/plugin marketplace update <name> - Update specific marketplace"}</Text><Text> /plugin marketplace remove - Remove a marketplace</Text><Text>{" "}{"/plugin marketplace remove <name> - Remove specific marketplace"}</Text><Text> /plugin marketplace list - List all marketplaces</Text><Text> </Text><Text dimColor={true}>Validation:</Text><Text>{" "}{"/plugin validate <path> - Validate a manifest file or directory"}</Text><Text> </Text><Text dimColor={true}>Other:</Text><Text> /plugin - Main plugin menu</Text><Text> /plugin help - Show this help</Text><Text> /plugins - Alias for /plugin</Text></Box>;
      $[28] = t16;
    } else {
      t16 = $[28];
    }
    return t16;
  }
// 校验视图把路径透传给子组件：路径解析与报错都在那一侧
  if (viewState.type === "validate") {
    let t16;
    if ($[29] !== onComplete || $[30] !== viewState.path) {
      t16 = <ValidatePlugin onComplete={onComplete} path={viewState.path} />;
      $[29] = onComplete;
      $[30] = viewState.path;
      $[31] = t16;
    } else {
      t16 = $[31];
    }
    return t16;
  }
// 市场菜单视图在渲染期改状态再返回空：这是把旧入口重定向到新菜单的最小写法，代价是渲染期有副作用
  if (viewState.type === "marketplace-menu") {
    setViewState({
      type: "menu"
    });
    return null;
  }
// 市场列表视图只有一个依赖：完成回调
  if (viewState.type === "marketplace-list") {
    let t16;
    if ($[32] !== onComplete) {
      t16 = <MarketplaceList onComplete={onComplete} />;
      $[32] = onComplete;
      $[33] = t16;
    } else {
      t16 = $[33];
    }
    return t16;
  }
// 添加市场视图接了十个属性：输入值、光标、错误、结果、视图切换全在这一层托管，子组件只负责按键
  if (viewState.type === "add-marketplace") {
    let t16;
    if ($[34] !== cliMode || $[35] !== cursorOffset || $[36] !== error || $[37] !== inputValue || $[38] !== markPluginsChanged || $[39] !== result) {
      t16 = <AddMarketplace inputValue={inputValue} setInputValue={setInputValue} cursorOffset={cursorOffset} setCursorOffset={setCursorOffset} error={error} setError={setError} result={result} setResult={setResult} setViewState={setViewState} onAddComplete={markPluginsChanged} cliMode={cliMode} />;
      $[34] = cliMode;
      $[35] = cursorOffset;
      $[36] = error;
      $[37] = inputValue;
      $[38] = markPluginsChanged;
      $[39] = result;
      $[40] = t16;
    } else {
      t16 = $[40];
    }
    return t16;
  }
// 横幅只在已安装页显示：它是给「插件其实该去 MCP 那边装」的提示，放在别的页签没有意义
  let t16;
  if ($[41] !== activeTab || $[42] !== showMcpRedirectMessage) {
    t16 = showMcpRedirectMessage && activeTab === "installed" ? <McpRedirectBanner /> : undefined;
    $[41] = activeTab;
    $[42] = showMcpRedirectMessage;
    $[43] = t16;
  } else {
    t16 = $[43];
  }
  let t17;
  if ($[44] !== error || $[45] !== markPluginsChanged || $[46] !== result || $[47] !== viewState.targetMarketplace || $[48] !== viewState.targetPlugin || $[49] !== viewState.type) {
// 发现页是二选一：带市场名就是浏览该市场，否则是全局发现——两者共用同一个页签但与不同的目标参数
    t17 = <Tab id="discover" title="Discover">{viewState.type === "browse-marketplace" ? <BrowseMarketplace error={error} setError={setError} result={result} setResult={setResult} setViewState={setViewState} onInstallComplete={markPluginsChanged} targetMarketplace={viewState.targetMarketplace} targetPlugin={viewState.targetPlugin} /> : <DiscoverPlugins error={error} setError={setError} result={result} setResult={setResult} setViewState={setViewState} onInstallComplete={markPluginsChanged} onSearchModeChange={setChildSearchActive} targetPlugin={viewState.type === "discover-plugins" ? viewState.targetPlugin : undefined} />}</Tab>;
    $[44] = error;
    $[45] = markPluginsChanged;
    $[46] = result;
    $[47] = viewState.targetMarketplace;
    $[48] = viewState.targetPlugin;
    $[49] = viewState.type;
    $[50] = t17;
  } else {
    t17 = $[50];
  }
// 三个条件表达式在这里把目标插件、目标市场、动作从视图里抽出来：子组件拿的是扁平属性，不是整个视图
  const t18 = viewState.type === "manage-plugins" ? viewState.targetPlugin : undefined;
  const t19 = viewState.type === "manage-plugins" ? viewState.targetMarketplace : undefined;
  const t20 = viewState.type === "manage-plugins" ? viewState.action : undefined;
  let t21;
  if ($[51] !== markPluginsChanged || $[52] !== t18 || $[53] !== t19 || $[54] !== t20) {
    t21 = <Tab id="installed" title="Installed"><ManagePlugins setViewState={setViewState} setResult={setResult} onManageComplete={markPluginsChanged} onSearchModeChange={setChildSearchActive} targetPlugin={t18} targetMarketplace={t19} action={t20} /></Tab>;
    $[51] = markPluginsChanged;
    $[52] = t18;
    $[53] = t19;
    $[54] = t20;
    $[55] = t21;
  } else {
    t21 = $[55];
  }
  const t22 = viewState.type === "manage-marketplaces" ? viewState.targetMarketplace : undefined;
  const t23 = viewState.type === "manage-marketplaces" ? viewState.action : undefined;
  let t24;
  if ($[56] !== error || $[57] !== exitState || $[58] !== markPluginsChanged || $[59] !== t22 || $[60] !== t23) {
    t24 = <Tab id="marketplaces" title="Marketplaces"><ManageMarketplaces setViewState={setViewState} error={error} setError={setError} setResult={setResult} exitState={exitState} onManageComplete={markPluginsChanged} targetMarketplace={t22} action={t23} /></Tab>;
    $[56] = error;
    $[57] = exitState;
    $[58] = markPluginsChanged;
    $[59] = t22;
    $[60] = t23;
    $[61] = t24;
  } else {
    t24 = $[61];
  }
  let t25;
  if ($[62] !== markPluginsChanged) {
    t25 = <ErrorsTabContent setViewState={setViewState} setActiveTab={setActiveTab} markPluginsChanged={markPluginsChanged} />;
    $[62] = markPluginsChanged;
    $[63] = t25;
  } else {
    t25 = $[63];
  }
  let t26;
  if ($[64] !== errorsTabTitle || $[65] !== t25) {
    t26 = <Tab id="errors" title={errorsTabTitle}>{t25}</Tab>;
    $[64] = errorsTabTitle;
    $[65] = t25;
    $[66] = t26;
  } else {
    t26 = $[66];
  }
  let t27;
// 外层骨架：外层容器加页签条，四个页签的内容按顺序塞进去，横幅挂在页签条上
  if ($[67] !== activeTab || $[68] !== childSearchActive || $[69] !== t16 || $[70] !== t17 || $[71] !== t21 || $[72] !== t24 || $[73] !== t26) {
    t27 = <Pane color="suggestion"><Tabs title="Plugins" selectedTab={activeTab} onTabChange={handleTabChange} color="suggestion" disableNavigation={childSearchActive} banner={t16}>{t17}{t21}{t24}{t26}</Tabs></Pane>;
    $[67] = activeTab;
    $[68] = childSearchActive;
    $[69] = t16;
    $[70] = t17;
    $[71] = t21;
    $[72] = t24;
    $[73] = t26;
    $[74] = t27;
  } else {
    t27 = $[74];
  }
  return t27;
}
// 置刷新标记时先判一次：已经置真就原样返回，省掉一次状态对象重建与随之而来的重渲染
function _temp1(prev) {
  return prev.plugins.needsRefresh ? prev : {
    ...prev,
    plugins: {
      ...prev.plugins,
      needsRefresh: true
    }
  };
}
// 页签上的错误数是两处相加：错误列表的长度，加上状态为失败的市场数——这才是用户感知到的「有几处问题」
function _temp0(s) {
  let count = s.plugins.errors.length;
  for (const m of s.plugins.installationStatus.marketplaces) {
    if (m.status === "failed") {
      count++;
    }
  }
  return count;
}
// 原文件此处有一行 94228 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。