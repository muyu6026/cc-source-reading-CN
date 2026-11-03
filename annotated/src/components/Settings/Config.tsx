// 【文件级】`/config` 设置面板主组件：把全局配置、settings 文件、AppState 三处状态聚合成一张可搜索的开关/枚举列表。核心设计是「即时落盘 + 快照回滚」——每次改动立刻写盘并生效，Esc 时用挂载时快照把三处状态整体写回（取消不是不写，而是反向写）。
import { c as _c } from "react/compiler-runtime";
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
// `biome-ignore-all` 关掉本文件的导入排序：`ANT-ONLY import markers must not be reordered` 说明这些导入顺序被内部构建工具当标记用，重排会破坏标记。
import { feature } from 'bun:bundle';
import { Box, Text, useTheme, useThemeSetting, useTerminalFocus } from '../../ink.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import * as React from 'react';
import { useState, useCallback } from 'react';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import figures from 'figures';
import { type GlobalConfig, saveGlobalConfig, getCurrentProjectConfig, type OutputStyle } from '../../utils/config.js';
import { normalizeApiKeyForConfig } from '../../utils/authPortable.js';
import { getGlobalConfig, getAutoUpdaterDisabledReason, formatAutoUpdaterDisabledReason, getRemoteControlAtStartup } from '../../utils/config.js';
import chalk from 'chalk';
import { permissionModeTitle, permissionModeFromString, toExternalPermissionMode, isExternalPermissionMode, EXTERNAL_PERMISSION_MODES, PERMISSION_MODES, type ExternalPermissionMode, type PermissionMode } from '../../utils/permissions/PermissionMode.js';
import { getAutoModeEnabledState, hasAutoModeOptInAnySource, transitionPlanAutoMode } from '../../utils/permissions/permissionSetup.js';
import { logError } from '../../utils/log.js';
import { logEvent, type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js';
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { ThemePicker } from '../ThemePicker.js';
import { useAppState, useSetAppState, useAppStateStore } from '../../state/AppState.js';
import { ModelPicker } from '../ModelPicker.js';
import { modelDisplayString, isOpus1mMergeEnabled } from '../../utils/model/model.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import { ClaudeMdExternalIncludesDialog } from '../ClaudeMdExternalIncludesDialog.js';
import { ChannelDowngradeDialog, type ChannelDowngradeChoice } from '../ChannelDowngradeDialog.js';
import { Dialog } from '../design-system/Dialog.js';
import { Select } from '../CustomSelect/index.js';
import { OutputStylePicker } from '../OutputStylePicker.js';
import { LanguagePicker } from '../LanguagePicker.js';
import { getExternalClaudeMdIncludes, getMemoryFiles, hasExternalClaudeMdIncludes } from 'src/utils/claudemd.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import { useTabHeaderFocus } from '../design-system/Tabs.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { SearchBox } from '../SearchBox.js';
import { isSupportedTerminal, hasAccessToIDEExtensionDiffFeature } from '../../utils/ide.js';
import { getInitialSettings, getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { getUserMsgOptIn, setUserMsgOptIn } from '../../bootstrap/state.js';
import { DEFAULT_OUTPUT_STYLE_NAME } from 'src/constants/outputStyles.js';
import { isEnvTruthy, isRunningOnHomespace } from 'src/utils/envUtils.js';
import type { LocalJSXCommandContext, CommandResultDisplay } from '../../commands.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { getCliTeammateModeOverride, clearCliTeammateModeOverride } from '../../utils/swarm/backends/teammateModeSnapshot.js';
import { getHardcodedTeammateModelFallback } from '../../utils/swarm/teammateModel.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { clearFastModeCooldown, FAST_MODE_MODEL_DISPLAY, isFastModeAvailable, isFastModeEnabled, getFastModeModel, isFastModeSupportedByModel } from '../../utils/fastMode.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
// 组件入参：`onClose` 带可选显示方式（`system` 表示以系统消息样式回执），`context` 提供命令上下文（含已连接 MCP 客户端、会话消息），`setTabsHidden` 用于子菜单/预览时藏掉标签行，`contentHeight` 由父级 Settings 传入以对齐各标签页高度。
type Props = {
  onClose: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  context: LocalJSXCommandContext;
  setTabsHidden: (hidden: boolean) => void;
  onIsSearchModeChange?: (inSearchMode: boolean) => void;
  contentHeight?: number;
};
// 条目公共字段：要么 `label` 是纯字符串，要么是富文本节点并额外给 `searchText`——因为富文本无法直接 `toLowerCase` 做匹配，必须配一份可搜文本。
type SettingBase = {
  id: string;
  label: string;
} | {
  id: string;
  label: React.ReactNode;
  searchText: string;
};
// `Setting` 是三种条目形态的判别联合：`boolean` 直接切换；`enum` 在给定 `options` 里循环；`managedEnum` 由自定义子组件接管取值，父列表只需要一个当前值用于展示。用 `type` 字段做判别，`toggleSetting` 里据此分派。
type Setting = (SettingBase & {
  value: boolean;
  onChange(value: boolean): void;
  type: 'boolean';
}) | (SettingBase & {
  value: string;
  options: string[];
  onChange(value: string): void;
  type: 'enum';
}) | (SettingBase & {
  // For enums that are set by a custom component, we don't need to pass options,
  // but we still need a value to display in the top-level config menu
  value: string;
  onChange(value: string): void;
  type: 'managedEnum';
});
// 可弹出的子菜单名。这些子菜单各有自己的 Enter/Esc 语义，所以主面板在子菜单打开时必须让出按键（见 `handleEscape` 与 `handleSaveAndClose` 开头的早退）。
type SubMenu = 'Theme' | 'Model' | 'TeammateModel' | 'ExternalIncludes' | 'OutputStyle' | 'ChannelDowngrade' | 'Language' | 'EnableAutoUpdates';
// 组件入口。所有状态在这里一次性铺开：既有渲染态（选中项、滚动偏移、搜索态），也有三套「初始快照」用于回滚——全局配置、settings 文件、AppState。
export function Config({
  onClose,
  context,
  setTabsHidden,
  onIsSearchModeChange,
  contentHeight
}: Props): React.ReactNode {
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  const insideModal = useIsInsideModal();
  const [, setTheme] = useTheme();
  const themeSetting = useThemeSetting();
  const [globalConfig, setGlobalConfig] = useState(getGlobalConfig());
// `globalConfig` 是要渲染的实时值，`initialConfig` 是挂载时快照。注意这里调了两次 `getGlobalConfig()`：`useState` 取初值，`useRef` 存快照，后者不参与渲染但保证回滚有据可依。
  const initialConfig = React.useRef(getGlobalConfig());
  const [settingsData, setSettingsData] = useState(getInitialSettings());
  const initialSettingsData = React.useRef(getInitialSettings());
  const [currentOutputStyle, setCurrentOutputStyle] = useState<OutputStyle>(settingsData?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME);
  const initialOutputStyle = React.useRef(currentOutputStyle);
  const [currentLanguage, setCurrentLanguage] = useState<string | undefined>(settingsData?.language);
  const initialLanguage = React.useRef(currentLanguage);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isSearchMode, setIsSearchMode] = useState(true);
  const isTerminalFocused = useTerminalFocus();
  const {
    rows
  } = useTerminalSize();
  // contentHeight is set by Settings.tsx (same value passed to Tabs to fix
  // pane height across all tabs — prevents layout jank when switching).
  // Reserve ~10 rows for chrome (search box, gaps, footer, scroll hints).
  // Fallback calc for standalone rendering (tests).
  const paneCap = contentHeight ?? Math.min(Math.floor(rows * 0.8), 30);
// 面板可用高度：优先用父级给的 `contentHeight`（多标签页统一高度，避免切换时抖动），否则按终端行数 80% 且不超过 30 行兜底。再扣掉约 10 行固定装饰（搜索框、间隙、页脚、滚动提示）得到可显示条目数。
  const maxVisible = Math.max(5, paneCap - 10);
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const verbose = useAppState(s_0 => s_0.verbose);
  const thinkingEnabled = useAppState(s_1 => s_1.thinkingEnabled);
  const isFastMode = useAppState(s_2 => isFastModeEnabled() ? s_2.fastMode : false);
  const promptSuggestionEnabled = useAppState(s_3 => s_3.promptSuggestionEnabled);
  // Show auto in the default-mode dropdown when the user has opted in OR the
  // config is fully 'enabled' — even if currently circuit-broken ('disabled'),
  // an opted-in user should still see it in settings (it's a temporary state).
  const showAutoInDefaultModePicker = feature('TRANSCRIPT_CLASSIFIER') ? hasAutoModeOptInAnySource() || getAutoModeEnabledState() === 'enabled' : false;
// 默认模式下拉里是否出现 `auto`：需要特性开关打开，且满足「用户曾主动选择过」或「当前配置就是启用」。即使此刻因熔断处于 `disabled`，只要用户选过也照常展示——那是临时状态，不该在设置里消失。
  // Chat/Transcript view picker is visible to entitled users (pass the GB
  // gate) even if they haven't opted in this session — it IS the persistent
  // opt-in. 'chat' written here is read at next startup by main.tsx which
  // sets userMsgOptIn if still entitled.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const showDefaultViewPicker = feature('KAIROS') || feature('KAIROS_BRIEF') ? (require('../../tools/BriefTool/BriefTool.js') as typeof import('../../tools/BriefTool/BriefTool.js')).isBriefEntitled() : false;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const setAppState = useSetAppState();
  const [changes, setChanges] = useState<{
    [key: string]: unknown;
  }>({});
// `changes` 记录本次会话改过哪些项，用于关闭时回执一行摘要。值类型是 `unknown` 因为既可能是布尔也可能是字符串标签。
  const initialThinkingEnabled = React.useRef(thinkingEnabled);
  // Per-source settings snapshots for revert-on-escape. getInitialSettings()
  // returns merged-across-sources which can't tell us what to delete vs
  // restore; per-source snapshots + updateSettingsForSource's
  // undefined-deletes-key semantics can. Lazy-init via useState (no setter) to
  // avoid reading settings files on every render — useRef evaluates its arg
  // eagerly even though only the first result is kept.
  const [initialLocalSettings] = useState(() => getSettingsForSource('localSettings'));
// 按来源分别快照 settings（本地/用户）。合并视图无法区分「该删键」还是「该还原值」，而 `updateSettingsForSource` 的语义是「传 `undefined` 即删键」，所以必须分来源留底。用无 setter 的 `useState` 惰性初始化，避免每次渲染都读盘。
  const [initialUserSettings] = useState(() => getSettingsForSource('userSettings'));
  const initialThemeSetting = React.useRef(themeSetting);
  // AppState fields Config may modify — snapshot once at mount.
  const store = useAppStateStore();
  const [initialAppState] = useState(() => {
    const s_4 = store.getState();
    return {
      mainLoopModel: s_4.mainLoopModel,
      mainLoopModelForSession: s_4.mainLoopModelForSession,
      verbose: s_4.verbose,
      thinkingEnabled: s_4.thinkingEnabled,
      fastMode: s_4.fastMode,
      promptSuggestionEnabled: s_4.promptSuggestionEnabled,
      isBriefOnly: s_4.isBriefOnly,
      replBridgeEnabled: s_4.replBridgeEnabled,
      replBridgeOutboundOnly: s_4.replBridgeOutboundOnly,
      settings: s_4.settings
    };
  });
// AppState 快照：Config 可能改到的字段一次性抓齐（模型、verbose、thinking、fastMode、提示建议、Brief、桥接、settings）。回滚时整块写回，避免漏字段导致半回滚。
  // Bootstrap state snapshot — userMsgOptIn is outside AppState, so
  // revertChanges needs to restore it separately. Without this, cycling
  // defaultView to 'chat' then Escape leaves the tool active while the
  // display filter reverts — the exact ambient-activation behavior this
  // PR's entitlement/opt-in split is meant to prevent.
  const [initialUserMsgOptIn] = useState(() => getUserMsgOptIn());
  // Set on first user-visible change; gates revertChanges() on Escape so
  // opening-then-closing doesn't trigger redundant disk writes.
  const isDirty = React.useRef(false);
// `isDirty` 是「本次是否发生过用户可见改动」的闩锁。没有它，打开即关闭也会触发一轮无意义的写盘回滚。
  const [showThinkingWarning, setShowThinkingWarning] = useState(false);
  const [showSubmenu, setShowSubmenu] = useState<SubMenu | null>(null);
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset
  } = useSearchInput({
    isActive: isSearchMode && showSubmenu === null && !headerFocused,
    onExit: () => setIsSearchMode(false),
    onExitUp: focusHeader,
    // Ctrl+C/D must reach Settings' useExitOnCtrlCD; 'd' also avoids
    // double-action (delete-char + exit-pending).
    passthroughCtrlKeys: ['c', 'd']
  });
// 搜索输入接管键盘：仅在搜索态、无子菜单、标签头未聚焦时激活。`passthroughCtrlKeys` 放行 `c`/`d`，让 Ctrl+C/Ctrl+D 仍能走到退出逻辑，同时避开 `d` 的「删字符 + 待退出」双重动作。

  // Tell the parent when Config's own Esc handler is active so Settings cedes
  // confirm:no. Only true when search mode owns the keyboard — not when the
  // tab header is focused (then Settings must handle Esc-to-close).
  const ownsEsc = isSearchMode && !headerFocused;
// `ownsEsc` 表示本组件的 Esc 处理器此刻是否生效，并通过回调告知父级 Settings 让出 `confirm:no`。只有搜索态真正独占键盘时才算——标签头聚焦时 Esc 关面板应由父级处理。
  React.useEffect(() => {
    onIsSearchModeChange?.(ownsEsc);
  }, [ownsEsc, onIsSearchModeChange]);
  const isConnectedToIde = hasAccessToIDEExtensionDiffFeature(context.options.mcpClients);
  const isFileCheckpointingAvailable = !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING);
  const memoryFiles = React.use(getMemoryFiles(true));
  const shouldShowExternalIncludesToggle = hasExternalClaudeMdIncludes(memoryFiles);
  const autoUpdaterDisabledReason = getAutoUpdaterDisabledReason();
// 几个派生开关在这里一次算好：IDE 差异功能是否可用、文件检查点是否被环境变量禁用、记忆文件是否存在外部引用（决定是否显示对应开关）、自动更新被禁的原因（用于把通道项变成「去启用」入口）。
// 改主模型：先打点上报（`tengu_config_model_changed` 记录改前改后），再写 AppState 并清掉会话级覆盖 `mainLoopModelForSession`，最后把展示串塞进 `changes`。额外用量计费时展示串追加一句标注。
  function onChangeMainModelConfig(value: string | null): void {
    const previousModel = mainLoopModel;
    logEvent('tengu_config_model_changed', {
      from_model: previousModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setAppState(prev => ({
      ...prev,
      mainLoopModel: value,
      mainLoopModelForSession: null
    }));
    setChanges(prev_0 => {
      const valStr = modelDisplayString(value) + (isBilledAsExtraUsage(value, false, isOpus1mMergeEnabled()) ? ' · Billed as extra usage' : '');
      if ('model' in prev_0) {
        const {
          model,
          ...rest
        } = prev_0;
        return {
          ...rest,
          model: valStr
        };
      }
      return {
        ...prev_0,
        model: valStr
      };
    });
  }
// 改 verbose：同时写三处——`saveGlobalConfig` 落盘、`setGlobalConfig` 更新本组件渲染值、`setAppState` 让其他组件立刻反应。`changes` 的处理有个细节：若该键已存在则先解构剔除再重新赋值，保证键顺序稳定。
  function onChangeVerbose(value_0: boolean): void {
    // Update the global config to persist the setting
    saveGlobalConfig(current => ({
      ...current,
      verbose: value_0
    }));
    setGlobalConfig({
      ...getGlobalConfig(),
      verbose: value_0
    });

    // Update the app state for immediate UI feedback
    setAppState(prev_1 => ({
      ...prev_1,
      verbose: value_0
    }));
    setChanges(prev_2 => {
      if ('verbose' in prev_2) {
        const {
          verbose: verbose_0,
          ...rest_0
        } = prev_2;
        return rest_0;
      }
      return {
        ...prev_2,
        verbose: value_0
      };
    });
  }

  // TODO: Add MCP servers
// 从这里开始构建 `settingsItems` 大数组，每一项自带 id、标签、当前值与 `onChange`。整段是数据驱动：渲染层只按 `type` 分派，新增设置项只需往数组里加一条。
  const settingsItems: Setting[] = [
  // Global settings
  {
    id: 'autoCompactEnabled',
    label: 'Auto-compact',
    value: globalConfig.autoCompactEnabled,
    type: 'boolean' as const,
    onChange(autoCompactEnabled: boolean) {
      saveGlobalConfig(current_0 => ({
        ...current_0,
        autoCompactEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        autoCompactEnabled
      });
      logEvent('tengu_auto_compact_setting_changed', {
        enabled: autoCompactEnabled
      });
    }
  }, {
    id: 'spinnerTipsEnabled',
    label: 'Show tips',
    value: settingsData?.spinnerTipsEnabled ?? true,
    type: 'boolean' as const,
    onChange(spinnerTipsEnabled: boolean) {
      updateSettingsForSource('localSettings', {
        spinnerTipsEnabled
      });
      // Update local state to reflect the change immediately
      setSettingsData(prev_3 => ({
        ...prev_3,
        spinnerTipsEnabled
      }));
      logEvent('tengu_tips_setting_changed', {
        enabled: spinnerTipsEnabled
      });
    }
  }, {
    id: 'prefersReducedMotion',
    label: 'Reduce motion',
    value: settingsData?.prefersReducedMotion ?? false,
    type: 'boolean' as const,
    onChange(prefersReducedMotion: boolean) {
      updateSettingsForSource('localSettings', {
        prefersReducedMotion
      });
      setSettingsData(prev_4 => ({
        ...prev_4,
        prefersReducedMotion
      }));
      // Sync to AppState so components react immediately
      setAppState(prev_5 => ({
        ...prev_5,
        settings: {
          ...prev_5.settings,
          prefersReducedMotion
        }
      }));
      logEvent('tengu_reduce_motion_setting_changed', {
        enabled: prefersReducedMotion
      });
    }
  }, {
    id: 'thinkingEnabled',
    label: 'Thinking mode',
    value: thinkingEnabled ?? true,
    type: 'boolean' as const,
    onChange(enabled: boolean) {
      setAppState(prev_6 => ({
        ...prev_6,
        thinkingEnabled: enabled
      }));
      updateSettingsForSource('userSettings', {
        alwaysThinkingEnabled: enabled ? undefined : false
      });
      logEvent('tengu_thinking_toggled', {
        enabled
      });
    }
  },
  // Fast mode toggle (ant-only, eliminated from external builds)
  ...(isFastModeEnabled() && isFastModeAvailable() ? [{
    id: 'fastMode',
    label: `Fast mode (${FAST_MODE_MODEL_DISPLAY} only)`,
    value: !!isFastMode,
    type: 'boolean' as const,
    onChange(enabled_0: boolean) {
      clearFastModeCooldown();
      updateSettingsForSource('userSettings', {
        fastMode: enabled_0 ? true : undefined
      });
      if (enabled_0) {
        setAppState(prev_7 => ({
          ...prev_7,
          mainLoopModel: getFastModeModel(),
          mainLoopModelForSession: null,
          fastMode: true
        }));
        setChanges(prev_8 => ({
          ...prev_8,
          model: getFastModeModel(),
          'Fast mode': 'ON'
        }));
      } else {
        setAppState(prev_9 => ({
          ...prev_9,
          fastMode: false
        }));
        setChanges(prev_10 => ({
          ...prev_10,
          'Fast mode': 'OFF'
        }));
      }
    }
  }] : []), ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_chomp_inflection', false) ? [{
    id: 'promptSuggestionEnabled',
    label: 'Prompt suggestions',
    value: promptSuggestionEnabled,
    type: 'boolean' as const,
    onChange(enabled_1: boolean) {
      setAppState(prev_11 => ({
        ...prev_11,
        promptSuggestionEnabled: enabled_1
      }));
      updateSettingsForSource('userSettings', {
        promptSuggestionEnabled: enabled_1 ? undefined : false
      });
    }
  }] : []),
  // Speculation toggle (ant-only)
  ...("external" === 'ant' ? [{
    id: 'speculationEnabled',
    label: 'Speculative execution',
    value: globalConfig.speculationEnabled ?? true,
    type: 'boolean' as const,
    onChange(enabled_2: boolean) {
      saveGlobalConfig(current_1 => {
        if (current_1.speculationEnabled === enabled_2) return current_1;
        return {
          ...current_1,
          speculationEnabled: enabled_2
        };
      });
      setGlobalConfig({
        ...getGlobalConfig(),
        speculationEnabled: enabled_2
      });
      logEvent('tengu_speculation_setting_changed', {
        enabled: enabled_2
      });
    }
  }] : []), ...(isFileCheckpointingAvailable ? [{
    id: 'fileCheckpointingEnabled',
    label: 'Rewind code (checkpoints)',
    value: globalConfig.fileCheckpointingEnabled,
    type: 'boolean' as const,
    onChange(enabled_3: boolean) {
      saveGlobalConfig(current_2 => ({
        ...current_2,
        fileCheckpointingEnabled: enabled_3
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        fileCheckpointingEnabled: enabled_3
      });
      logEvent('tengu_file_history_snapshots_setting_changed', {
        enabled: enabled_3
      });
    }
  }] : []), {
    id: 'verbose',
    label: 'Verbose output',
    value: verbose,
    type: 'boolean',
    onChange: onChangeVerbose
  }, {
    id: 'terminalProgressBarEnabled',
    label: 'Terminal progress bar',
    value: globalConfig.terminalProgressBarEnabled,
    type: 'boolean' as const,
    onChange(terminalProgressBarEnabled: boolean) {
      saveGlobalConfig(current_3 => ({
        ...current_3,
        terminalProgressBarEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        terminalProgressBarEnabled
      });
      logEvent('tengu_terminal_progress_bar_setting_changed', {
        enabled: terminalProgressBarEnabled
      });
    }
  }, ...(getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_sidebar', false) ? [{
    id: 'showStatusInTerminalTab',
    label: 'Show status in terminal tab',
    value: globalConfig.showStatusInTerminalTab ?? false,
    type: 'boolean' as const,
    onChange(showStatusInTerminalTab: boolean) {
      saveGlobalConfig(current_4 => ({
        ...current_4,
        showStatusInTerminalTab
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        showStatusInTerminalTab
      });
      logEvent('tengu_terminal_tab_status_setting_changed', {
        enabled: showStatusInTerminalTab
      });
    }
  }] : []), {
    id: 'showTurnDuration',
    label: 'Show turn duration',
    value: globalConfig.showTurnDuration,
    type: 'boolean' as const,
    onChange(showTurnDuration: boolean) {
      saveGlobalConfig(current_5 => ({
        ...current_5,
        showTurnDuration
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        showTurnDuration
      });
      logEvent('tengu_show_turn_duration_setting_changed', {
        enabled: showTurnDuration
      });
    }
  }, {
    id: 'defaultPermissionMode',
    label: 'Default permission mode',
    value: settingsData?.permissions?.defaultMode || 'default',
    options: (() => {
      const priorityOrder: PermissionMode[] = ['default', 'plan'];
      const allModes: readonly PermissionMode[] = feature('TRANSCRIPT_CLASSIFIER') ? PERMISSION_MODES : EXTERNAL_PERMISSION_MODES;
      const excluded: PermissionMode[] = ['bypassPermissions'];
      if (feature('TRANSCRIPT_CLASSIFIER') && !showAutoInDefaultModePicker) {
        excluded.push('auto');
      }
      return [...priorityOrder, ...allModes.filter(m => !priorityOrder.includes(m) && !excluded.includes(m))];
    })(),
    type: 'enum' as const,
    onChange(mode: string) {
      const parsedMode = permissionModeFromString(mode);
      // Internal modes (e.g. auto) are stored directly
      const validatedMode = isExternalPermissionMode(parsedMode) ? toExternalPermissionMode(parsedMode) : parsedMode;
      const result = updateSettingsForSource('userSettings', {
        permissions: {
          ...settingsData?.permissions,
          defaultMode: validatedMode as ExternalPermissionMode
        }
      });
      if (result.error) {
        logError(result.error);
        return;
      }

      // Update local state to reflect the change immediately.
      // validatedMode is typed as the wide PermissionMode union but at
      // runtime is always a PERMISSION_MODES member (the options dropdown
      // is built from that array above), so this narrowing is sound.
      setSettingsData(prev_12 => ({
        ...prev_12,
        permissions: {
          ...prev_12?.permissions,
          defaultMode: validatedMode as (typeof PERMISSION_MODES)[number]
        }
      }));
      // Track changes
      setChanges(prev_13 => ({
        ...prev_13,
        defaultPermissionMode: mode
      }));
      logEvent('tengu_config_changed', {
        setting: 'defaultPermissionMode' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }, ...(feature('TRANSCRIPT_CLASSIFIER') && showAutoInDefaultModePicker ? [{
    id: 'useAutoModeDuringPlan',
    label: 'Use auto mode during plan',
    value: (settingsData as {
      useAutoModeDuringPlan?: boolean;
    } | undefined)?.useAutoModeDuringPlan ?? true,
    type: 'boolean' as const,
    onChange(useAutoModeDuringPlan: boolean) {
      updateSettingsForSource('userSettings', {
        useAutoModeDuringPlan
      });
      setSettingsData(prev_14 => ({
        ...prev_14,
        useAutoModeDuringPlan
      }));
      // Internal writes suppress the file watcher, so
      // applySettingsChange won't fire. Reconcile directly so
      // mid-plan toggles take effect immediately.
      setAppState(prev_15 => {
        const next = transitionPlanAutoMode(prev_15.toolPermissionContext);
        if (next === prev_15.toolPermissionContext) return prev_15;
        return {
          ...prev_15,
          toolPermissionContext: next
        };
      });
      setChanges(prev_16 => ({
        ...prev_16,
        'Use auto mode during plan': useAutoModeDuringPlan
      }));
    }
  }] : []), {
    id: 'respectGitignore',
    label: 'Respect .gitignore in file picker',
    value: globalConfig.respectGitignore,
    type: 'boolean' as const,
    onChange(respectGitignore: boolean) {
      saveGlobalConfig(current_6 => ({
        ...current_6,
        respectGitignore
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        respectGitignore
      });
      logEvent('tengu_respect_gitignore_setting_changed', {
        enabled: respectGitignore
      });
    }
  }, {
    id: 'copyFullResponse',
    label: 'Always copy full response (skip /copy picker)',
    value: globalConfig.copyFullResponse,
    type: 'boolean' as const,
    onChange(copyFullResponse: boolean) {
      saveGlobalConfig(current_7 => ({
        ...current_7,
        copyFullResponse
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        copyFullResponse
      });
      logEvent('tengu_config_changed', {
        setting: 'copyFullResponse' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: String(copyFullResponse) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  },
  // Copy-on-select is only meaningful with in-app selection (fullscreen
  // alt-screen mode). In inline mode the terminal emulator owns selection.
  ...(isFullscreenEnvEnabled() ? [{
    id: 'copyOnSelect',
    label: 'Copy on select',
    value: globalConfig.copyOnSelect ?? true,
    type: 'boolean' as const,
    onChange(copyOnSelect: boolean) {
      saveGlobalConfig(current_8 => ({
        ...current_8,
        copyOnSelect
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        copyOnSelect
      });
      logEvent('tengu_config_changed', {
        setting: 'copyOnSelect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: String(copyOnSelect) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []),
  // autoUpdates setting is hidden - use DISABLE_AUTOUPDATER env var to control
  autoUpdaterDisabledReason ? {
    id: 'autoUpdatesChannel',
    label: 'Auto-update channel',
    value: 'disabled',
    type: 'managedEnum' as const,
    onChange() {}
  } : {
    id: 'autoUpdatesChannel',
    label: 'Auto-update channel',
    value: settingsData?.autoUpdatesChannel ?? 'latest',
    type: 'managedEnum' as const,
    onChange() {
      // Handled via toggleSetting -> 'ChannelDowngrade'
    }
  }, {
    id: 'theme',
    label: 'Theme',
    value: themeSetting,
    type: 'managedEnum',
    onChange: setTheme
  }, {
    id: 'notifChannel',
    label: feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION') ? 'Local notifications' : 'Notifications',
    value: globalConfig.preferredNotifChannel,
    options: ['auto', 'iterm2', 'terminal_bell', 'iterm2_with_bell', 'kitty', 'ghostty', 'notifications_disabled'],
    type: 'enum',
    onChange(notifChannel: GlobalConfig['preferredNotifChannel']) {
      saveGlobalConfig(current_9 => ({
        ...current_9,
        preferredNotifChannel: notifChannel
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        preferredNotifChannel: notifChannel
      });
    }
  }, ...(feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION') ? [{
    id: 'taskCompleteNotifEnabled',
    label: 'Push when idle',
    value: globalConfig.taskCompleteNotifEnabled ?? false,
    type: 'boolean' as const,
    onChange(taskCompleteNotifEnabled: boolean) {
      saveGlobalConfig(current_10 => ({
        ...current_10,
        taskCompleteNotifEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        taskCompleteNotifEnabled
      });
    }
  }, {
    id: 'inputNeededNotifEnabled',
    label: 'Push when input needed',
    value: globalConfig.inputNeededNotifEnabled ?? false,
    type: 'boolean' as const,
    onChange(inputNeededNotifEnabled: boolean) {
      saveGlobalConfig(current_11 => ({
        ...current_11,
        inputNeededNotifEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        inputNeededNotifEnabled
      });
    }
  }, {
    id: 'agentPushNotifEnabled',
    label: 'Push when Claude decides',
    value: globalConfig.agentPushNotifEnabled ?? false,
    type: 'boolean' as const,
    onChange(agentPushNotifEnabled: boolean) {
      saveGlobalConfig(current_12 => ({
        ...current_12,
        agentPushNotifEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        agentPushNotifEnabled
      });
    }
  }] : []), {
    id: 'outputStyle',
    label: 'Output style',
    value: currentOutputStyle,
    type: 'managedEnum' as const,
    onChange: () => {} // handled by OutputStylePicker submenu
  }, ...(showDefaultViewPicker ? [{
    id: 'defaultView',
    label: 'What you see by default',
    // 'default' means the setting is unset — currently resolves to
    // transcript (main.tsx falls through when defaultView !== 'chat').
    // String() narrows the conditional-schema-spread union to string.
    value: settingsData?.defaultView === undefined ? 'default' : String(settingsData.defaultView),
    options: ['transcript', 'chat', 'default'],
    type: 'enum' as const,
    onChange(selected: string) {
      const defaultView = selected === 'default' ? undefined : selected as 'chat' | 'transcript';
      updateSettingsForSource('localSettings', {
        defaultView
      });
      setSettingsData(prev_17 => ({
        ...prev_17,
        defaultView
      }));
      const nextBrief = defaultView === 'chat';
      setAppState(prev_18 => {
        if (prev_18.isBriefOnly === nextBrief) return prev_18;
        return {
          ...prev_18,
          isBriefOnly: nextBrief
        };
      });
      // Keep userMsgOptIn in sync so the tool list follows the view.
      // Two-way now (same as /brief) — accepting a cache invalidation
      // is better than leaving the tool on after switching away.
      // Reverted on Escape via initialUserMsgOptIn snapshot.
      setUserMsgOptIn(nextBrief);
      setChanges(prev_19 => ({
        ...prev_19,
        'Default view': selected
      }));
      logEvent('tengu_default_view_setting_changed', {
        value: (defaultView ?? 'unset') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), {
    id: 'language',
    label: 'Language',
    value: currentLanguage ?? 'Default (English)',
    type: 'managedEnum' as const,
    onChange: () => {} // handled by LanguagePicker submenu
  }, {
    id: 'editorMode',
    label: 'Editor mode',
    // Convert 'emacs' to 'normal' for backward compatibility
    value: globalConfig.editorMode === 'emacs' ? 'normal' : globalConfig.editorMode || 'normal',
    options: ['normal', 'vim'],
    type: 'enum',
    onChange(value_1: string) {
      saveGlobalConfig(current_13 => ({
        ...current_13,
        editorMode: value_1 as GlobalConfig['editorMode']
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        editorMode: value_1 as GlobalConfig['editorMode']
      });
      logEvent('tengu_editor_mode_changed', {
        mode: value_1 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }, {
    id: 'prStatusFooterEnabled',
    label: 'Show PR status footer',
    value: globalConfig.prStatusFooterEnabled ?? true,
    type: 'boolean' as const,
    onChange(enabled_4: boolean) {
      saveGlobalConfig(current_14 => {
        if (current_14.prStatusFooterEnabled === enabled_4) return current_14;
        return {
          ...current_14,
          prStatusFooterEnabled: enabled_4
        };
      });
      setGlobalConfig({
        ...getGlobalConfig(),
        prStatusFooterEnabled: enabled_4
      });
      logEvent('tengu_pr_status_footer_setting_changed', {
        enabled: enabled_4
      });
    }
  }, {
    id: 'model',
    label: 'Model',
    value: mainLoopModel === null ? 'Default (recommended)' : mainLoopModel,
    type: 'managedEnum' as const,
    onChange: onChangeMainModelConfig
  }, ...(isConnectedToIde ? [{
    id: 'diffTool',
    label: 'Diff tool',
    value: globalConfig.diffTool ?? 'auto',
    options: ['terminal', 'auto'],
    type: 'enum' as const,
    onChange(diffTool: string) {
      saveGlobalConfig(current_15 => ({
        ...current_15,
        diffTool: diffTool as GlobalConfig['diffTool']
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        diffTool: diffTool as GlobalConfig['diffTool']
      });
      logEvent('tengu_diff_tool_changed', {
        tool: diffTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), ...(!isSupportedTerminal() ? [{
    id: 'autoConnectIde',
    label: 'Auto-connect to IDE (external terminal)',
    value: globalConfig.autoConnectIde ?? false,
    type: 'boolean' as const,
    onChange(autoConnectIde: boolean) {
      saveGlobalConfig(current_16 => ({
        ...current_16,
        autoConnectIde
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        autoConnectIde
      });
      logEvent('tengu_auto_connect_ide_changed', {
        enabled: autoConnectIde,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), ...(isSupportedTerminal() ? [{
    id: 'autoInstallIdeExtension',
    label: 'Auto-install IDE extension',
    value: globalConfig.autoInstallIdeExtension ?? true,
    type: 'boolean' as const,
    onChange(autoInstallIdeExtension: boolean) {
      saveGlobalConfig(current_17 => ({
        ...current_17,
        autoInstallIdeExtension
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        autoInstallIdeExtension
      });
      logEvent('tengu_auto_install_ide_extension_changed', {
        enabled: autoInstallIdeExtension,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), {
    id: 'claudeInChromeDefaultEnabled',
    label: 'Claude in Chrome enabled by default',
    value: globalConfig.claudeInChromeDefaultEnabled ?? true,
    type: 'boolean' as const,
    onChange(enabled_5: boolean) {
      saveGlobalConfig(current_18 => ({
        ...current_18,
        claudeInChromeDefaultEnabled: enabled_5
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        claudeInChromeDefaultEnabled: enabled_5
      });
      logEvent('tengu_claude_in_chrome_setting_changed', {
        enabled: enabled_5
      });
    }
  },
  // Teammate mode (only shown when agent swarms are enabled)
  ...(isAgentSwarmsEnabled() ? (() => {
    const cliOverride = getCliTeammateModeOverride();
    const label = cliOverride ? `Teammate mode [overridden: ${cliOverride}]` : 'Teammate mode';
    return [{
      id: 'teammateMode',
      label,
      value: globalConfig.teammateMode ?? 'auto',
      options: ['auto', 'tmux', 'in-process'],
      type: 'enum' as const,
      onChange(mode_0: string) {
        if (mode_0 !== 'auto' && mode_0 !== 'tmux' && mode_0 !== 'in-process') {
          return;
        }
        // Clear CLI override and set new mode (pass mode to avoid race condition)
        clearCliTeammateModeOverride(mode_0);
        saveGlobalConfig(current_19 => ({
          ...current_19,
          teammateMode: mode_0
        }));
        setGlobalConfig({
          ...getGlobalConfig(),
          teammateMode: mode_0
        });
        logEvent('tengu_teammate_mode_changed', {
          mode: mode_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
    }, {
      id: 'teammateDefaultModel',
      label: 'Default teammate model',
      value: teammateModelDisplayString(globalConfig.teammateDefaultModel),
      type: 'managedEnum' as const,
      onChange() {}
    }];
  })() : []),
  // Remote at startup toggle — gated on build flag + GrowthBook + policy
  ...(feature('BRIDGE_MODE') && isBridgeEnabled() ? [{
    id: 'remoteControlAtStartup',
    label: 'Enable Remote Control for all sessions',
    value: globalConfig.remoteControlAtStartup === undefined ? 'default' : String(globalConfig.remoteControlAtStartup),
    options: ['true', 'false', 'default'],
    type: 'enum' as const,
    onChange(selected_0: string) {
      if (selected_0 === 'default') {
        // Unset the config key so it falls back to the platform default
        saveGlobalConfig(current_20 => {
          if (current_20.remoteControlAtStartup === undefined) return current_20;
          const next_0 = {
            ...current_20
          };
          delete next_0.remoteControlAtStartup;
          return next_0;
        });
        setGlobalConfig({
          ...getGlobalConfig(),
          remoteControlAtStartup: undefined
        });
      } else {
        const enabled_6 = selected_0 === 'true';
        saveGlobalConfig(current_21 => {
          if (current_21.remoteControlAtStartup === enabled_6) return current_21;
          return {
            ...current_21,
            remoteControlAtStartup: enabled_6
          };
        });
        setGlobalConfig({
          ...getGlobalConfig(),
          remoteControlAtStartup: enabled_6
        });
      }
      // Sync to AppState so useReplBridge reacts immediately
      const resolved = getRemoteControlAtStartup();
      setAppState(prev_20 => {
        if (prev_20.replBridgeEnabled === resolved && !prev_20.replBridgeOutboundOnly) return prev_20;
        return {
          ...prev_20,
          replBridgeEnabled: resolved,
          replBridgeOutboundOnly: false
        };
      });
    }
  }] : []), ...(shouldShowExternalIncludesToggle ? [{
    id: 'showExternalIncludesDialog',
    label: 'External CLAUDE.md includes',
    value: (() => {
      const projectConfig = getCurrentProjectConfig();
      if (projectConfig.hasClaudeMdExternalIncludesApproved) {
        return 'true';
      } else {
        return 'false';
      }
    })(),
    type: 'managedEnum' as const,
    onChange() {
      // Will be handled by toggleSetting function
    }
  }] : []), ...(process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace() ? [{
    id: 'apiKey',
    label: <Text>
                Use custom API key:{' '}
                <Text bold>
                  {normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY)}
                </Text>
              </Text>,
    searchText: 'Use custom API key',
    value: Boolean(process.env.ANTHROPIC_API_KEY && globalConfig.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY))),
    type: 'boolean' as const,
    onChange(useCustomKey: boolean) {
      saveGlobalConfig(current_22 => {
        const updated = {
          ...current_22
        };
        if (!updated.customApiKeyResponses) {
          updated.customApiKeyResponses = {
            approved: [],
            rejected: []
          };
        }
        if (!updated.customApiKeyResponses.approved) {
          updated.customApiKeyResponses = {
            ...updated.customApiKeyResponses,
            approved: []
          };
        }
        if (!updated.customApiKeyResponses.rejected) {
          updated.customApiKeyResponses = {
            ...updated.customApiKeyResponses,
            rejected: []
          };
        }
        if (process.env.ANTHROPIC_API_KEY) {
          const truncatedKey = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
          if (useCustomKey) {
            updated.customApiKeyResponses = {
              ...updated.customApiKeyResponses,
              approved: [...(updated.customApiKeyResponses.approved ?? []).filter(k => k !== truncatedKey), truncatedKey],
              rejected: (updated.customApiKeyResponses.rejected ?? []).filter(k_0 => k_0 !== truncatedKey)
            };
          } else {
            updated.customApiKeyResponses = {
              ...updated.customApiKeyResponses,
              approved: (updated.customApiKeyResponses.approved ?? []).filter(k_1 => k_1 !== truncatedKey),
              rejected: [...(updated.customApiKeyResponses.rejected ?? []).filter(k_2 => k_2 !== truncatedKey), truncatedKey]
            };
          }
        }
        return updated;
      });
      setGlobalConfig(getGlobalConfig());
    }
  }] : [])];
// 数组收尾。末尾这段用条件展开（三元返回数组或空数组）按特性开关决定是否追加条目——这样关闭特性时条目完全不存在，而不是渲染成禁用态。

  // Filter settings based on search query
// 按搜索词过滤：先匹配 `id`，再匹配可搜文本（富文本条目用自带的 `searchText`，否则用 `label`）。用 `useMemo` 缓存，依赖只有列表与查询词。
  const filteredSettingsItems = React.useMemo(() => {
    if (!searchQuery) return settingsItems;
    const lowerQuery = searchQuery.toLowerCase();
    return settingsItems.filter(setting => {
      if (setting.id.toLowerCase().includes(lowerQuery)) return true;
      const searchableText = 'searchText' in setting ? setting.searchText : setting.label;
      return searchableText.toLowerCase().includes(lowerQuery);
    });
  }, [settingsItems, searchQuery]);

  // Adjust selected index when filtered list shrinks, and keep the selected
  // item visible when maxVisible changes (e.g., terminal resize).
// 列表收缩后校正选中项：若选中下标越界，夹到末项并把滚动窗口跟着推到位；同时监听 `maxVisible` 变化（终端缩放），保证选中项始终可见。
  React.useEffect(() => {
    if (selectedIndex >= filteredSettingsItems.length) {
      const newIndex = Math.max(0, filteredSettingsItems.length - 1);
      setSelectedIndex(newIndex);
      setScrollOffset(Math.max(0, newIndex - maxVisible + 1));
      return;
    }
    setScrollOffset(prev_21 => {
      if (selectedIndex < prev_21) return selectedIndex;
      if (selectedIndex >= prev_21 + maxVisible) return selectedIndex - maxVisible + 1;
      return prev_21;
    });
  }, [filteredSettingsItems.length, selectedIndex, maxVisible]);

  // Keep the selected item visible within the scroll window.
  // Called synchronously from navigation handlers to avoid a render frame
  // where the selected item falls outside the visible window.
// 同步调整滚动偏移。注释点明「由导航处理器同步调用」——不能等 `useEffect`，否则会出现一帧「选中项在可视区外」的闪烁。
  const adjustScrollOffset = useCallback((newIndex_0: number) => {
    setScrollOffset(prev_22 => {
      if (newIndex_0 < prev_22) return newIndex_0;
      if (newIndex_0 >= prev_22 + maxVisible) return newIndex_0 - maxVisible + 1;
      return prev_22;
    });
  }, [maxVisible]);

  // Enter: keep all changes (already persisted by onChange handlers), close
  // with a summary of what changed.
// Enter 保存并关闭。语义上改动早已即时落盘，这里只做两件事：把 `changes` 与各类「初始值 vs 当前值」的差异拼成人话回执，然后关闭。子菜单打开时直接早退，让子菜单自己处理 Enter。
  const handleSaveAndClose = useCallback(() => {
    // Submenu handling: each submenu has its own Enter/Esc — don't close
    // the whole panel while one is open.
    if (showSubmenu !== null) {
      return;
    }
    // Log any changes that were made
    // TODO: Make these proper messages
    const formattedChanges: string[] = Object.entries(changes).map(([key, value_2]) => {
      logEvent('tengu_config_changed', {
        key: key as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: value_2 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      return `Set ${key} to ${chalk.bold(value_2)}`;
    });
    // Check for API key changes
    // On homespace, ANTHROPIC_API_KEY is preserved in process.env for child
    // processes but ignored by Claude Code itself (see auth.ts).
    const effectiveApiKey = isRunningOnHomespace() ? undefined : process.env.ANTHROPIC_API_KEY;
    const initialUsingCustomKey = Boolean(effectiveApiKey && initialConfig.current.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(effectiveApiKey)));
    const currentUsingCustomKey = Boolean(effectiveApiKey && globalConfig.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(effectiveApiKey)));
    if (initialUsingCustomKey !== currentUsingCustomKey) {
      formattedChanges.push(`${currentUsingCustomKey ? 'Enabled' : 'Disabled'} custom API key`);
      logEvent('tengu_config_changed', {
        key: 'env.ANTHROPIC_API_KEY' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: currentUsingCustomKey as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
    if (globalConfig.theme !== initialConfig.current.theme) {
      formattedChanges.push(`Set theme to ${chalk.bold(globalConfig.theme)}`);
    }
    if (globalConfig.preferredNotifChannel !== initialConfig.current.preferredNotifChannel) {
      formattedChanges.push(`Set notifications to ${chalk.bold(globalConfig.preferredNotifChannel)}`);
    }
    if (currentOutputStyle !== initialOutputStyle.current) {
      formattedChanges.push(`Set output style to ${chalk.bold(currentOutputStyle)}`);
    }
    if (currentLanguage !== initialLanguage.current) {
      formattedChanges.push(`Set response language to ${chalk.bold(currentLanguage ?? 'Default (English)')}`);
    }
    if (globalConfig.editorMode !== initialConfig.current.editorMode) {
      formattedChanges.push(`Set editor mode to ${chalk.bold(globalConfig.editorMode || 'emacs')}`);
    }
    if (globalConfig.diffTool !== initialConfig.current.diffTool) {
      formattedChanges.push(`Set diff tool to ${chalk.bold(globalConfig.diffTool)}`);
    }
    if (globalConfig.autoConnectIde !== initialConfig.current.autoConnectIde) {
      formattedChanges.push(`${globalConfig.autoConnectIde ? 'Enabled' : 'Disabled'} auto-connect to IDE`);
    }
    if (globalConfig.autoInstallIdeExtension !== initialConfig.current.autoInstallIdeExtension) {
      formattedChanges.push(`${globalConfig.autoInstallIdeExtension ? 'Enabled' : 'Disabled'} auto-install IDE extension`);
    }
    if (globalConfig.autoCompactEnabled !== initialConfig.current.autoCompactEnabled) {
      formattedChanges.push(`${globalConfig.autoCompactEnabled ? 'Enabled' : 'Disabled'} auto-compact`);
    }
    if (globalConfig.respectGitignore !== initialConfig.current.respectGitignore) {
      formattedChanges.push(`${globalConfig.respectGitignore ? 'Enabled' : 'Disabled'} respect .gitignore in file picker`);
    }
    if (globalConfig.copyFullResponse !== initialConfig.current.copyFullResponse) {
      formattedChanges.push(`${globalConfig.copyFullResponse ? 'Enabled' : 'Disabled'} always copy full response`);
    }
    if (globalConfig.copyOnSelect !== initialConfig.current.copyOnSelect) {
      formattedChanges.push(`${globalConfig.copyOnSelect ? 'Enabled' : 'Disabled'} copy on select`);
    }
    if (globalConfig.terminalProgressBarEnabled !== initialConfig.current.terminalProgressBarEnabled) {
      formattedChanges.push(`${globalConfig.terminalProgressBarEnabled ? 'Enabled' : 'Disabled'} terminal progress bar`);
    }
    if (globalConfig.showStatusInTerminalTab !== initialConfig.current.showStatusInTerminalTab) {
      formattedChanges.push(`${globalConfig.showStatusInTerminalTab ? 'Enabled' : 'Disabled'} terminal tab status`);
    }
    if (globalConfig.showTurnDuration !== initialConfig.current.showTurnDuration) {
      formattedChanges.push(`${globalConfig.showTurnDuration ? 'Enabled' : 'Disabled'} turn duration`);
    }
    if (globalConfig.remoteControlAtStartup !== initialConfig.current.remoteControlAtStartup) {
      const remoteLabel = globalConfig.remoteControlAtStartup === undefined ? 'Reset Remote Control to default' : `${globalConfig.remoteControlAtStartup ? 'Enabled' : 'Disabled'} Remote Control for all sessions`;
      formattedChanges.push(remoteLabel);
    }
    if (settingsData?.autoUpdatesChannel !== initialSettingsData.current?.autoUpdatesChannel) {
      formattedChanges.push(`Set auto-update channel to ${chalk.bold(settingsData?.autoUpdatesChannel ?? 'latest')}`);
    }
    if (formattedChanges.length > 0) {
      onClose(formattedChanges.join('\n'));
    } else {
      onClose('Config dialog dismissed', {
        display: 'system'
      });
    }
  }, [showSubmenu, changes, globalConfig, mainLoopModel, currentOutputStyle, currentLanguage, settingsData?.autoUpdatesChannel, isFastModeEnabled() ? (settingsData as Record<string, unknown> | undefined)?.fastMode : undefined, onClose]);

  // Restore all state stores to their mount-time snapshots. Changes are
  // applied to disk/AppState immediately on toggle, so "cancel" means
  // actively writing the old values back.
// Esc 的回滚实现，也是本文件最需要小心的地方。顺序有讲究：先恢复主题（`setTheme` 内部会用局部更新写一次全局配置），再整体覆盖全局配置快照，否则局部写会盖掉整体快照。
  const revertChanges = useCallback(() => {
    // Theme: restores ThemeProvider React state. Must run before the global
    // config overwrite since setTheme internally calls saveGlobalConfig with
    // a partial update — we want the full snapshot to be the last write.
    if (themeSetting !== initialThemeSetting.current) {
      setTheme(initialThemeSetting.current);
    }
    // Global config: full overwrite from snapshot. saveGlobalConfig skips if
    // the returned ref equals current (test mode checks ref; prod writes to
    // disk but content is identical).
    saveGlobalConfig(() => initialConfig.current);
    // Settings files: restore each key Config may have touched. undefined
    // deletes the key (updateSettingsForSource customizer at settings.ts:368).
    const il = initialLocalSettings;
    updateSettingsForSource('localSettings', {
      spinnerTipsEnabled: il?.spinnerTipsEnabled,
      prefersReducedMotion: il?.prefersReducedMotion,
      defaultView: il?.defaultView,
      outputStyle: il?.outputStyle
    });
    const iu = initialUserSettings;
    updateSettingsForSource('userSettings', {
      alwaysThinkingEnabled: iu?.alwaysThinkingEnabled,
      fastMode: iu?.fastMode,
      promptSuggestionEnabled: iu?.promptSuggestionEnabled,
      autoUpdatesChannel: iu?.autoUpdatesChannel,
      minimumVersion: iu?.minimumVersion,
      language: iu?.language,
      ...(feature('TRANSCRIPT_CLASSIFIER') ? {
        useAutoModeDuringPlan: (iu as {
          useAutoModeDuringPlan?: boolean;
        } | undefined)?.useAutoModeDuringPlan
      } : {}),
      // ThemePicker's Ctrl+T writes this key directly — include it so the
      // disk state reverts along with the in-memory AppState.settings restore.
      syntaxHighlightingDisabled: iu?.syntaxHighlightingDisabled,
      // permissions: the defaultMode onChange (above) spreads the MERGED
      // settingsData.permissions into userSettings — project/policy allow/deny
      // arrays can leak to disk. Spread the full initial snapshot so the
      // mergeWith array-customizer (settings.ts:375) replaces leaked arrays.
      // Explicitly include defaultMode so undefined triggers the customizer's
      // delete path even when iu.permissions lacks that key.
      permissions: iu?.permissions === undefined ? undefined : {
        ...iu.permissions,
        defaultMode: iu.permissions.defaultMode
      }
    });
    // AppState: batch-restore all possibly-touched fields.
    const ia = initialAppState;
    setAppState(prev_23 => ({
      ...prev_23,
      mainLoopModel: ia.mainLoopModel,
      mainLoopModelForSession: ia.mainLoopModelForSession,
      verbose: ia.verbose,
      thinkingEnabled: ia.thinkingEnabled,
      fastMode: ia.fastMode,
      promptSuggestionEnabled: ia.promptSuggestionEnabled,
      isBriefOnly: ia.isBriefOnly,
      replBridgeEnabled: ia.replBridgeEnabled,
      replBridgeOutboundOnly: ia.replBridgeOutboundOnly,
      settings: ia.settings,
      // Reconcile auto-mode state after useAutoModeDuringPlan revert above —
      // the onChange handler may have activated/deactivated auto mid-plan.
      toolPermissionContext: transitionPlanAutoMode(prev_23.toolPermissionContext)
    }));
    // Bootstrap state: restore userMsgOptIn. Only touched by the defaultView
    // onChange above, so no feature() guard needed here (that path only
    // exists when showDefaultViewPicker is true).
    if (getUserMsgOptIn() !== initialUserMsgOptIn) {
      setUserMsgOptIn(initialUserMsgOptIn);
    }
  }, [themeSetting, setTheme, initialLocalSettings, initialUserSettings, initialAppState, initialUserMsgOptIn, setAppState]);

  // Escape: revert all changes (if any) and close.
// Esc 入口：子菜单打开时早退；只有 `isDirty` 才回滚；最后以系统消息样式关闭。回滚与关闭分开，是为了让「打开即关闭」不产生任何写盘。
  const handleEscape = useCallback(() => {
    if (showSubmenu !== null) {
      return;
    }
    if (isDirty.current) {
      revertChanges();
    }
    onClose('Config dialog dismissed', {
      display: 'system'
    });
  }, [showSubmenu, revertChanges, onClose]);

  // Disable when submenu is open so the submenu's Dialog handles ESC, and in
  // search mode so the onKeyDown handler (which clears-then-exits search)
  // wins — otherwise Escape in search would jump straight to revert+close.
  useKeybinding('confirm:no', handleEscape, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused
  });
  // Save-and-close fires on Enter only when not in search mode (Enter there
  // exits search to the list — see the isSearchMode branch in handleKeyDown).
  useKeybinding('settings:close', handleSaveAndClose, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused
  });

  // Settings navigation and toggle actions via configurable keybindings.
  // Only active when not in search mode and no submenu is open.
// 切换当前选中项，按类型分派：布尔直接取反（thinking 还要判断是否回到初值以决定是否收起警告）；需要子菜单的项只打开子菜单并置 `isDirty` 交给子菜单回调；自动更新通道项要先判断是否被禁用、以及是否属于「降级」需要弹确认。
  const toggleSetting = useCallback(() => {
    const setting_0 = filteredSettingsItems[selectedIndex];
    if (!setting_0 || !setting_0.onChange) {
      return;
    }
    if (setting_0.type === 'boolean') {
      isDirty.current = true;
      setting_0.onChange(!setting_0.value);
      if (setting_0.id === 'thinkingEnabled') {
        const newValue = !setting_0.value;
        const backToInitial = newValue === initialThinkingEnabled.current;
        if (backToInitial) {
          setShowThinkingWarning(false);
        } else if (context.messages.some(m_0 => m_0.type === 'assistant')) {
          setShowThinkingWarning(true);
        }
      }
      return;
    }
    if (setting_0.id === 'theme' || setting_0.id === 'model' || setting_0.id === 'teammateDefaultModel' || setting_0.id === 'showExternalIncludesDialog' || setting_0.id === 'outputStyle' || setting_0.id === 'language') {
      // managedEnum items open a submenu — isDirty is set by the submenu's
      // completion callback, not here (submenu may be cancelled).
      switch (setting_0.id) {
        case 'theme':
          setShowSubmenu('Theme');
          setTabsHidden(true);
          return;
        case 'model':
          setShowSubmenu('Model');
          setTabsHidden(true);
          return;
        case 'teammateDefaultModel':
          setShowSubmenu('TeammateModel');
          setTabsHidden(true);
          return;
        case 'showExternalIncludesDialog':
          setShowSubmenu('ExternalIncludes');
          setTabsHidden(true);
          return;
        case 'outputStyle':
          setShowSubmenu('OutputStyle');
          setTabsHidden(true);
          return;
        case 'language':
          setShowSubmenu('Language');
          setTabsHidden(true);
          return;
      }
    }
    if (setting_0.id === 'autoUpdatesChannel') {
      if (autoUpdaterDisabledReason) {
        // Auto-updates are disabled - show enable dialog instead
        setShowSubmenu('EnableAutoUpdates');
        setTabsHidden(true);
        return;
      }
      const currentChannel = settingsData?.autoUpdatesChannel ?? 'latest';
      if (currentChannel === 'latest') {
        // Switching to stable - show downgrade dialog
        setShowSubmenu('ChannelDowngrade');
        setTabsHidden(true);
      } else {
        // Switching to latest - just do it and clear minimumVersion
        isDirty.current = true;
        updateSettingsForSource('userSettings', {
          autoUpdatesChannel: 'latest',
          minimumVersion: undefined
        });
        setSettingsData(prev_24 => ({
          ...prev_24,
          autoUpdatesChannel: 'latest',
          minimumVersion: undefined
        }));
        logEvent('tengu_autoupdate_channel_changed', {
          channel: 'latest' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
      return;
    }
    if (setting_0.type === 'enum') {
      isDirty.current = true;
      const currentIndex = setting_0.options.indexOf(setting_0.value);
      const nextIndex = (currentIndex + 1) % setting_0.options.length;
      setting_0.onChange(setting_0.options[nextIndex]!);
      return;
    }
  }, [autoUpdaterDisabledReason, filteredSettingsItems, selectedIndex, settingsData?.autoUpdatesChannel, setTabsHidden]);
// 上下移动选中项：夹在 `0..length-1` 之间，同时收起 thinking 警告并同步滚动。函数式写法避免闭包拿到过期下标。
  const moveSelection = (delta: -1 | 1): void => {
    setShowThinkingWarning(false);
    const newIndex_1 = Math.max(0, Math.min(filteredSettingsItems.length - 1, selectedIndex + delta));
    setSelectedIndex(newIndex_1);
    adjustScrollOffset(newIndex_1);
  };
// 按键绑定表：上/下、滚轮上下、`select:accept` 切换、`settings:search` 进搜索。注释说明滚轮为何落到这里——列表已分页，`ScrollBox` 内容永远装得下，滚动事件不被消费，于是回落到本处理器做导航。
  useKeybindings({
    'select:previous': () => {
      if (selectedIndex === 0) {
        // ↑ at top enters search mode so users can type-to-filter after
        // reaching the list boundary. Wheel-up (scroll:lineUp) clamps
        // instead — overshoot shouldn't move focus away from the list.
        setShowThinkingWarning(false);
        setIsSearchMode(true);
        setScrollOffset(0);
      } else {
        moveSelection(-1);
      }
    },
    'select:next': () => moveSelection(1),
    // Wheel. ScrollKeybindingHandler's scroll:line* returns false (not
    // consumed) when the ScrollBox content fits — which it always does
    // here because the list is paginated (slice). The event falls through
    // to this handler which navigates the list, clamping at boundaries.
    'scroll:lineUp': () => moveSelection(-1),
    'scroll:lineDown': () => moveSelection(1),
    'select:accept': toggleSetting,
    'settings:search': () => {
      setIsSearchMode(true);
      setSearchQuery('');
    }
  }, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused
  });

  // Combined key handling across search/list modes. Branch order mirrors
  // the original useInput gate priority: submenu and header short-circuit
  // first (their own handlers own input), then search vs. list.
// 原始按键兜底处理，分支顺序刻意与旧 `useInput` 的门控优先级一致：子菜单与标签头先短路，再分搜索态/列表态。搜索态 Esc 先清词再退出；列表态左右/Tab 循环当前项取值；其余可打印字符进入搜索。
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (showSubmenu !== null) return;
    if (headerFocused) return;
    // Search mode: Esc clears then exits, Enter/↓ moves to the list.
    if (isSearchMode) {
      if (e.key === 'escape') {
        e.preventDefault();
        if (searchQuery.length > 0) {
          setSearchQuery('');
        } else {
          setIsSearchMode(false);
        }
        return;
      }
      if (e.key === 'return' || e.key === 'down' || e.key === 'wheeldown') {
        e.preventDefault();
        setIsSearchMode(false);
        setSelectedIndex(0);
        setScrollOffset(0);
      }
      return;
    }
    // List mode: left/right/tab cycle the selected option's value. These
    // keys used to switch tabs; now they only do so when the tab row is
    // explicitly focused (see headerFocused in Settings.tsx).
    if (e.key === 'left' || e.key === 'right' || e.key === 'tab') {
      e.preventDefault();
      toggleSetting();
      return;
    }
    // Fallback: printable characters (other than those bound to actions)
    // enter search mode. Carve out j/k// — useKeybindings (still on the
    // useInput path) consumes these via stopImmediatePropagation, but
    // onKeyDown dispatches independently so we must skip them explicitly.
    if (e.ctrl || e.meta) return;
    if (e.key === 'j' || e.key === 'k' || e.key === '/') return;
    if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault();
      setIsSearchMode(true);
      setSearchQuery(e.key);
    }
  }, [showSubmenu, headerFocused, isSearchMode, searchQuery, setSearchQuery, toggleSetting]);
// 渲染入口。整棵树的顶层用 `Box` 接管按键，随后按 `showSubmenu` 逐个分支渲染子菜单或主列表；页脚提示随「标签头聚焦 / 搜索态 / 列表态」三种情境切换快捷键说明。
  return <Box flexDirection="column" width="100%" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      {showSubmenu === 'Theme' ? <>
          <ThemePicker onThemeSelect={setting_1 => {
        isDirty.current = true;
        setTheme(setting_1);
        setShowSubmenu(null);
        setTabsHidden(false);
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} hideEscToCancel skipExitHandling={true} // Skip exit handling as Config already handles it
      />
          <Box>
            <Text dimColor italic>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="select" />
                <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
              </Byline>
            </Text>
          </Box>
        </> : showSubmenu === 'Model' ? <>
          <ModelPicker initial={mainLoopModel} onSelect={(model_0, _effort) => {
        isDirty.current = true;
        onChangeMainModelConfig(model_0);
        setShowSubmenu(null);
        setTabsHidden(false);
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} showFastModeNotice={isFastModeEnabled() ? isFastMode && isFastModeSupportedByModel(mainLoopModel) && isFastModeAvailable() : false} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'TeammateModel' ? <>
          <ModelPicker initial={globalConfig.teammateDefaultModel ?? null} skipSettingsWrite headerText="Default model for newly spawned teammates. The leader can override via the tool call's model parameter." onSelect={(model_1, _effort_0) => {
        setShowSubmenu(null);
        setTabsHidden(false);
        // First-open-then-Enter from unset: picker highlights "Default"
        // (initial=null) and confirming would write null, silently
        // switching Opus-fallback → follow-leader. Treat as no-op.
        if (globalConfig.teammateDefaultModel === undefined && model_1 === null) {
          return;
        }
        isDirty.current = true;
        saveGlobalConfig(current_23 => current_23.teammateDefaultModel === model_1 ? current_23 : {
          ...current_23,
          teammateDefaultModel: model_1
        });
        setGlobalConfig({
          ...getGlobalConfig(),
          teammateDefaultModel: model_1
        });
        setChanges(prev_25 => ({
          ...prev_25,
          teammateDefaultModel: teammateModelDisplayString(model_1)
        }));
        logEvent('tengu_teammate_default_model_changed', {
          model: model_1 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'ExternalIncludes' ? <>
          <ClaudeMdExternalIncludesDialog onDone={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} externalIncludes={getExternalClaudeMdIncludes(memoryFiles)} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="disable external includes" />
            </Byline>
          </Text>
        </> : showSubmenu === 'OutputStyle' ? <>
          <OutputStylePicker initialStyle={currentOutputStyle} onComplete={style => {
        isDirty.current = true;
        setCurrentOutputStyle(style ?? DEFAULT_OUTPUT_STYLE_NAME);
        setShowSubmenu(null);
        setTabsHidden(false);

        // Save to local settings
        updateSettingsForSource('localSettings', {
          outputStyle: style
        });
        void logEvent('tengu_output_style_changed', {
          style: (style ?? DEFAULT_OUTPUT_STYLE_NAME) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          settings_source: 'localSettings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'Language' ? <>
          <LanguagePicker initialLanguage={currentLanguage} onComplete={language => {
        isDirty.current = true;
        setCurrentLanguage(language);
        setShowSubmenu(null);
        setTabsHidden(false);

        // Save to user settings
        updateSettingsForSource('userSettings', {
          language
        });
        void logEvent('tengu_language_changed', {
          language: (language ?? 'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'EnableAutoUpdates' ? <Dialog title="Enable Auto-Updates" onCancel={() => {
      setShowSubmenu(null);
      setTabsHidden(false);
    }} hideBorder hideInputGuide>
          {autoUpdaterDisabledReason?.type !== 'config' ? <>
              <Text>
                {autoUpdaterDisabledReason?.type === 'env' ? 'Auto-updates are controlled by an environment variable and cannot be changed here.' : 'Auto-updates are disabled in development builds.'}
              </Text>
              {autoUpdaterDisabledReason?.type === 'env' && <Text dimColor>
                  Unset {autoUpdaterDisabledReason.envVar} to re-enable
                  auto-updates.
                </Text>}
            </> : <Select options={[{
        label: 'Enable with latest channel',
        value: 'latest'
      }, {
        label: 'Enable with stable channel',
        value: 'stable'
      }]} onChange={(channel: string) => {
        isDirty.current = true;
        setShowSubmenu(null);
        setTabsHidden(false);
        saveGlobalConfig(current_24 => ({
          ...current_24,
          autoUpdates: true
        }));
        setGlobalConfig({
          ...getGlobalConfig(),
          autoUpdates: true
        });
        updateSettingsForSource('userSettings', {
          autoUpdatesChannel: channel as 'latest' | 'stable',
          minimumVersion: undefined
        });
        setSettingsData(prev_26 => ({
          ...prev_26,
          autoUpdatesChannel: channel as 'latest' | 'stable',
          minimumVersion: undefined
        }));
        logEvent('tengu_autoupdate_enabled', {
          channel: channel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} />}
        </Dialog> : showSubmenu === 'ChannelDowngrade' ? <ChannelDowngradeDialog currentVersion={MACRO.VERSION} onChoice={(choice: ChannelDowngradeChoice) => {
      setShowSubmenu(null);
      setTabsHidden(false);
      if (choice === 'cancel') {
        // User cancelled - don't change anything
        return;
      }
      isDirty.current = true;
      // Switch to stable channel
      const newSettings: {
        autoUpdatesChannel: 'stable';
        minimumVersion?: string;
      } = {
        autoUpdatesChannel: 'stable'
      };
      if (choice === 'stay') {
        // User wants to stay on current version until stable catches up
        newSettings.minimumVersion = MACRO.VERSION;
      }
      updateSettingsForSource('userSettings', newSettings);
      setSettingsData(prev_27 => ({
        ...prev_27,
        ...newSettings
      }));
      logEvent('tengu_autoupdate_channel_changed', {
        channel: 'stable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        minimum_version_set: choice === 'stay'
      });
    }} /> : <Box flexDirection="column" gap={1} marginY={insideModal ? undefined : 1}>
          <SearchBox query={searchQuery} isFocused={isSearchMode && !headerFocused} isTerminalFocused={isTerminalFocused} cursorOffset={searchCursorOffset} placeholder="Search settings…" />
          <Box flexDirection="column">
            {filteredSettingsItems.length === 0 ? <Text dimColor italic>
                No settings match &quot;{searchQuery}&quot;
              </Text> : <>
                {scrollOffset > 0 && <Text dimColor>
                    {figures.arrowUp} {scrollOffset} more above
                  </Text>}
                {filteredSettingsItems.slice(scrollOffset, scrollOffset + maxVisible).map((setting_2, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === selectedIndex && !headerFocused && !isSearchMode;
            return <React.Fragment key={setting_2.id}>
                        <Box>
                          <Box width={44}>
                            <Text color={isSelected ? 'suggestion' : undefined}>
                              {isSelected ? figures.pointer : ' '}{' '}
                              {setting_2.label}
                            </Text>
                          </Box>
                          <Box key={isSelected ? 'selected' : 'unselected'}>
                            {setting_2.type === 'boolean' ? <>
                                <Text color={isSelected ? 'suggestion' : undefined}>
                                  {setting_2.value.toString()}
                                </Text>
                                {showThinkingWarning && setting_2.id === 'thinkingEnabled' && <Text color="warning">
                                      {' '}
                                      Changing thinking mode mid-conversation
                                      will increase latency and may reduce
                                      quality.
                                    </Text>}
                              </> : setting_2.id === 'theme' ? <Text color={isSelected ? 'suggestion' : undefined}>
                                {THEME_LABELS[setting_2.value.toString()] ?? setting_2.value.toString()}
                              </Text> : setting_2.id === 'notifChannel' ? <Text color={isSelected ? 'suggestion' : undefined}>
                                <NotifChannelLabel value={setting_2.value.toString()} />
                              </Text> : setting_2.id === 'defaultPermissionMode' ? <Text color={isSelected ? 'suggestion' : undefined}>
                                {permissionModeTitle(setting_2.value as PermissionMode)}
                              </Text> : setting_2.id === 'autoUpdatesChannel' && autoUpdaterDisabledReason ? <Box flexDirection="column">
                                <Text color={isSelected ? 'suggestion' : undefined}>
                                  disabled
                                </Text>
                                <Text dimColor>
                                  (
                                  {formatAutoUpdaterDisabledReason(autoUpdaterDisabledReason)}
                                  )
                                </Text>
                              </Box> : <Text color={isSelected ? 'suggestion' : undefined}>
                                {setting_2.value.toString()}
                              </Text>}
                          </Box>
                        </Box>
                      </React.Fragment>;
          })}
                {scrollOffset + maxVisible < filteredSettingsItems.length && <Text dimColor>
                    {figures.arrowDown}{' '}
                    {filteredSettingsItems.length - scrollOffset - maxVisible}{' '}
                    more below
                  </Text>}
              </>}
          </Box>
          {headerFocused ? <Text dimColor>
              <Byline>
                <KeyboardShortcutHint shortcut="←/→ tab" action="switch" />
                <KeyboardShortcutHint shortcut="↓" action="return" />
                <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="close" />
              </Byline>
            </Text> : isSearchMode ? <Text dimColor>
              <Byline>
                <Text>Type to filter</Text>
                <KeyboardShortcutHint shortcut="Enter/↓" action="select" />
                <KeyboardShortcutHint shortcut="↑" action="tabs" />
                <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="clear" />
              </Byline>
            </Text> : <Text dimColor>
              <Byline>
                <ConfigurableShortcutHint action="select:accept" context="Settings" fallback="Space" description="change" />
                <ConfigurableShortcutHint action="settings:close" context="Settings" fallback="Enter" description="save" />
                <ConfigurableShortcutHint action="settings:search" context="Settings" fallback="/" description="search" />
                <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
              </Byline>
            </Text>}
        </Box>}
    </Box>;
}
// 主组件到此结束。下面三个是渲染辅助：把模型值转展示串、主题名转人话标签、通知渠道转带协议标注的富文本。
// 模型展示串：`undefined` 表示没设过，回落到硬编码的队友模型；`null` 表示显式跟随队长，单独给人话标签。两种「空」语义不同，不能合并处理。
function teammateModelDisplayString(value: string | null | undefined): string {
  if (value === undefined) {
    return modelDisplayString(getHardcodedTeammateModelFallback());
  }
  if (value === null) return "Default (leader's model)";
  return modelDisplayString(value);
}
// 主题标识到人话标签的映射表，含色盲友好与仅 ANSI 两种降级版本。
const THEME_LABELS: Record<string, string> = {
  auto: 'Auto (match terminal)',
  dark: 'Dark mode',
  light: 'Light mode',
  'dark-daltonized': 'Dark mode (colorblind-friendly)',
  'light-daltonized': 'Light mode (colorblind-friendly)',
  'dark-ansi': 'Dark mode (ANSI colors only)',
  'light-ansi': 'Light mode (ANSI colors only)'
};
// 通知渠道标签组件：每种渠道附带终端协议说明（OSC 9 / 铃 / OSC 99 / OSC 777），让用户知道消息实际怎么送达。未知值原样透出，避免新增渠道时显示空白。
function NotifChannelLabel(t0) {
  const $ = _c(4);
  const {
    value
  } = t0;
  switch (value) {
    case "auto":
      {
        return "Auto";
      }
    case "iterm2":
      {
        let t1;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>iTerm2 <Text dimColor={true}>(OSC 9)</Text></Text>;
          $[0] = t1;
        } else {
          t1 = $[0];
        }
        return t1;
      }
    case "terminal_bell":
      {
        let t1;
        if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>Terminal Bell <Text dimColor={true}>(\a)</Text></Text>;
          $[1] = t1;
        } else {
          t1 = $[1];
        }
        return t1;
      }
    case "kitty":
      {
        let t1;
        if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>Kitty <Text dimColor={true}>(OSC 99)</Text></Text>;
          $[2] = t1;
        } else {
          t1 = $[2];
        }
        return t1;
      }
    case "ghostty":
      {
        let t1;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>Ghostty <Text dimColor={true}>(OSC 777)</Text></Text>;
          $[3] = t1;
        } else {
          t1 = $[3];
        }
        return t1;
      }
    case "iterm2_with_bell":
      {
        return "iTerm2 w/ Bell";
      }
    case "notifications_disabled":
      {
        return "Disabled";
      }
    default:
      {
        return value;
      }
  }
}
// 原文件此处有一行 197028 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。