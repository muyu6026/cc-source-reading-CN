// ═══════════════════════════════════════════════════════════════
//  PromptInput.tsx：2338 行，整个产品只有一个输入框
// ═══════════════════════════════════════════════════════════════
//
//  这是 components 目录里最大的单文件（除 Messages.tsx 外）。它为什么这么大？
//
//  因为它同时是六种东西：
//
//    ① 文本框           —— 光标、选区、多行、vimpl 模式、粘贴
//    ② 命令面板         —— / 命令补全、@ 文件补全、参数提示
//    ③ 通知中心         —— 十几种一次性提示（ultrathink / 模型切换 / 存草稿…）
//    ④ 导航器           —— footer 药丸的上下左右、任务列表、队友切换
//    ⑤ 弹窗宿主         —— 模型选择、快速打开、历史、任务、团队、Bridge…
//    ⑥ 提交前的总闸     —— 一大堆守卫（建议在显示、footer 有选中、正在看队友…）
//
//  「输入框」在终端应用里就是这个地位：**它是唯一能接收按键的地方**，
//  所以所有交互都必须先经过它，或者至少要在它这里让路。
//
//  读这个文件的唯一正确方式：**按 hook 分组读，不要按行读**。
//  1-1230 是状态与派生值，1230-1700 是一堆 handler，1700-1960 是键位注册，
//  1960-2338 是渲染与早退。下面每一段批注都标了它属于哪一组。
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import * as path from 'path';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { useCommandQueue } from 'src/hooks/useCommandQueue.js';
import { type IDEAtMentioned, useIdeAtMentioned } from 'src/hooks/useIdeAtMentioned.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { type AppState, useAppState, useAppStateStore, useSetAppState } from 'src/state/AppState.js';
import type { FooterItem } from 'src/state/AppStateStore.js';
import { getCwd } from 'src/utils/cwd.js';
import { isQueuedCommandEditable, popAllEditable } from 'src/utils/messageQueueManager.js';
import stripAnsi from 'strip-ansi';
import { companionReservedColumns } from '../../buddy/CompanionSprite.js';
import { findBuddyTriggerPositions, useBuddyNotification } from '../../buddy/useBuddyNotification.js';
import { FastModePicker } from '../../commands/fast/fast.js';
import { isUltrareviewEnabled } from '../../commands/review/ultrareviewEnabled.js';
import { getNativeCSIuTerminalDisplayName } from '../../commands/terminalSetup/terminalSetup.js';
import { type Command, hasCommand } from '../../commands.js';
import { useIsModalOverlayActive } from '../../context/overlayContext.js';
import { useSetPromptOverlayDialog } from '../../context/promptOverlayContext.js';
import { formatImageRef, formatPastedTextRef, getPastedTextRefNumLines, parseReferences } from '../../history.js';
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js';
import { type HistoryMode, useArrowKeyHistory } from '../../hooks/useArrowKeyHistory.js';
import { useDoublePress } from '../../hooks/useDoublePress.js';
import { useHistorySearch } from '../../hooks/useHistorySearch.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useInputBuffer } from '../../hooks/useInputBuffer.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { usePromptSuggestion } from '../../hooks/usePromptSuggestion.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useTypeahead } from '../../hooks/useTypeahead.js';
import type { BorderTextOptions } from '../../ink/render-border.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, type ClickEvent, type Key, Text, useInput } from '../../ink.js';
import { useOptionalKeybindingContext } from '../../keybindings/KeybindingContext.js';
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import { abortPromptSuggestion, logSuggestionSuppressed } from '../../services/PromptSuggestion/promptSuggestion.js';
import { type ActiveSpeculationState, abortSpeculation } from '../../services/PromptSuggestion/speculation.js';
import { getActiveAgentForInput, getViewedTeammateTask } from '../../state/selectors.js';
import { enterTeammateView, exitTeammateView, stopOrDismissAgent } from '../../state/teammateViewHelpers.js';
import type { ToolPermissionContext } from '../../Tool.js';
import { getRunningTeammatesSorted } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { isPanelAgentTask, type LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { isBackgroundTask } from '../../tasks/types.js';
import { AGENT_COLOR_TO_THEME_COLOR, AGENT_COLORS, type AgentColorName } from '../../tools/AgentTool/agentColorManager.js';
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js';
import type { Message } from '../../types/message.js';
import type { PermissionMode } from '../../types/permissions.js';
import type { BaseTextInputProps, PromptInputMode, VimMode } from '../../types/textInputTypes.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { count } from '../../utils/array.js';
import type { AutoUpdaterResult } from '../../utils/autoUpdater.js';
import { Cursor } from '../../utils/Cursor.js';
import { getGlobalConfig, type PastedContent, saveGlobalConfig } from '../../utils/config.js';
import { logForDebugging } from '../../utils/debug.js';
import { parseDirectMemberMessage, sendDirectMemberMessage } from '../../utils/directMemberMessage.js';
import type { EffortLevel } from '../../utils/effort.js';
import { env } from '../../utils/env.js';
import { errorMessage } from '../../utils/errors.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import { getFastModeUnavailableReason, isFastModeAvailable, isFastModeCooldown, isFastModeEnabled, isFastModeSupportedByModel } from '../../utils/fastMode.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import type { PromptInputHelpers } from '../../utils/handlePromptSubmit.js';
import { getImageFromClipboard, PASTE_THRESHOLD } from '../../utils/imagePaste.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import { cacheImagePath, storeImage } from '../../utils/imageStore.js';
import { isMacosOptionChar, MACOS_OPTION_SPECIAL_CHARS } from '../../utils/keyboardShortcuts.js';
import { logError } from '../../utils/log.js';
import { isOpus1mMergeEnabled, modelDisplayString } from '../../utils/model/model.js';
import { setAutoModeActive } from '../../utils/permissions/autoModeState.js';
import { cyclePermissionMode, getNextPermissionMode } from '../../utils/permissions/getNextPermissionMode.js';
import { transitionPermissionMode } from '../../utils/permissions/permissionSetup.js';
import { getPlatform } from '../../utils/platform.js';
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js';
import { editPromptInEditor } from '../../utils/promptEditor.js';
import { hasAutoModeOptIn } from '../../utils/settings/settings.js';
import { findBtwTriggerPositions } from '../../utils/sideQuestion.js';
import { findSlashCommandPositions } from '../../utils/suggestions/commandSuggestions.js';
import { findSlackChannelPositions, getKnownChannelsVersion, hasSlackMcpServer, subscribeKnownChannels } from '../../utils/suggestions/slackChannelSuggestions.js';
import { isInProcessEnabled } from '../../utils/swarm/backends/registry.js';
import { syncTeammateMode } from '../../utils/swarm/teamHelpers.js';
import type { TeamSummary } from '../../utils/teamDiscovery.js';
import { getTeammateColor } from '../../utils/teammate.js';
import { isInProcessTeammate } from '../../utils/teammateContext.js';
import { writeToMailbox } from '../../utils/teammateMailbox.js';
import type { TextHighlight } from '../../utils/textHighlighting.js';
import type { Theme } from '../../utils/theme.js';
import { findThinkingTriggerPositions, getRainbowColor, isUltrathinkEnabled } from '../../utils/thinking.js';
import { findTokenBudgetPositions } from '../../utils/tokenBudget.js';
import { findUltraplanTriggerPositions, findUltrareviewTriggerPositions } from '../../utils/ultraplan/keyword.js';
import { AutoModeOptInDialog } from '../AutoModeOptInDialog.js';
import { BridgeDialog } from '../BridgeDialog.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { getVisibleAgentTasks, useCoordinatorTaskCount } from '../CoordinatorAgentStatus.js';
import { getEffortNotificationText } from '../EffortIndicator.js';
import { getFastIconString } from '../FastIcon.js';
import { GlobalSearchDialog } from '../GlobalSearchDialog.js';
import { HistorySearchDialog } from '../HistorySearchDialog.js';
import { ModelPicker } from '../ModelPicker.js';
import { QuickOpenDialog } from '../QuickOpenDialog.js';
import TextInput from '../TextInput.js';
import { ThinkingToggle } from '../ThinkingToggle.js';
import { BackgroundTasksDialog } from '../tasks/BackgroundTasksDialog.js';
import { shouldHideTasksFooter } from '../tasks/taskStatusUtils.js';
import { TeamsDialog } from '../teams/TeamsDialog.js';
import VimTextInput from '../VimTextInput.js';
import { getModeFromInput, getValueFromInput } from './inputModes.js';
import { FOOTER_TEMPORARY_STATUS_TIMEOUT, Notifications } from './Notifications.js';
import PromptInputFooter from './PromptInputFooter.js';
import type { SuggestionItem } from './PromptInputFooterSuggestions.js';
import { PromptInputModeIndicator } from './PromptInputModeIndicator.js';
import { PromptInputQueuedCommands } from './PromptInputQueuedCommands.js';
import { PromptInputStashNotice } from './PromptInputStashNotice.js';
import { useMaybeTruncateInput } from './useMaybeTruncateInput.js';
import { usePromptInputPlaceholder } from './usePromptInputPlaceholder.js';
import { useShowFastIconHint } from './useShowFastIconHint.js';
import { useSwarmBanner } from './useSwarmBanner.js';
import { isNonSpacePrintable, isVimModeEnabled } from './utils.js';
// 【Props：39 个字段，其中一半是「回传的 setter」】
//
//  这个签名暴露了一个架构事实：**PromptInput 不持有业务状态**。
//  输入的文本、模式、粘贴内容、草稿、vim 模式、搜索状态，全都由 App 持有，
//  通过 props 传进来、回调传出去。
//
//  好处：输入框可以随时卸载重挂（比如切到全屏再切回来），状态不丢。
//  代价：这个组件变成了「巨型回调汇聚点」——39 个字段里，光 set* 就有 9 个。
//
//  三个值得单独看的字段：
//    · insertTextRef —— 反向通道。父组件拿一个 ref，往里塞一个 insert 函数，
//      让语音转写这类外部系统能在光标处插字（第 268 行赋值）。
//    · getToolUseContext —— 传的是**函数**而不是值，因为要打开任务对话框时
//      才需要构造上下文（构造有成本，且依赖那一刻的 messages）。
//    · onSubmit —— 签名极长（含 speculation 对象），因为提交有四种模式：
//      普通、接受推测、接受显式推测、按键触发。
type Props = {
  debug: boolean;
  ideSelection: IDESelection | undefined;
  toolPermissionContext: ToolPermissionContext;
  setToolPermissionContext: (ctx: ToolPermissionContext) => void;
  apiKeyStatus: VerificationStatus;
  commands: Command[];
  agents: AgentDefinition[];
  isLoading: boolean;
  verbose: boolean;
  messages: Message[];
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  input: string;
  onInputChange: (value: string) => void;
  mode: PromptInputMode;
  onModeChange: (mode: PromptInputMode) => void;
  stashedPrompt: {
    text: string;
    cursorOffset: number;
    pastedContents: Record<number, PastedContent>;
  } | undefined;
  setStashedPrompt: (value: {
    text: string;
    cursorOffset: number;
    pastedContents: Record<number, PastedContent>;
  } | undefined) => void;
  submitCount: number;
  onShowMessageSelector: () => void;
  /** Fullscreen message actions: shift+↑ enters cursor. */
  onMessageActionsEnter?: () => void;
  mcpClients: MCPServerConnection[];
  pastedContents: Record<number, PastedContent>;
  setPastedContents: React.Dispatch<React.SetStateAction<Record<number, PastedContent>>>;
  vimMode: VimMode;
  setVimMode: (mode: VimMode) => void;
  showBashesDialog: string | boolean;
  setShowBashesDialog: (show: string | boolean) => void;
  onExit: () => void;
  getToolUseContext: (messages: Message[], newMessages: Message[], abortController: AbortController, mainLoopModel: string) => ProcessUserInputContext;
  onSubmit: (input: string, helpers: PromptInputHelpers, speculationAccept?: {
    state: ActiveSpeculationState;
    speculationSessionTimeSavedMs: number;
    setAppState: (f: (prev: AppState) => AppState) => void;
  }, options?: {
    fromKeybinding?: boolean;
  }) => Promise<void>;
  onAgentSubmit?: (input: string, task: InProcessTeammateTaskState | LocalAgentTaskState, helpers: PromptInputHelpers) => Promise<void>;
  isSearchingHistory: boolean;
  setIsSearchingHistory: (isSearching: boolean) => void;
  onDismissSideQuestion?: () => void;
  isSideQuestionVisible?: boolean;
  helpOpen: boolean;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hasSuppressedDialogs?: boolean;
  isLocalJSXCommandActive?: boolean;
  insertTextRef?: React.MutableRefObject<{
    insert: (text: string) => void;
    setInputWithCursor: (value: string, cursor: number) => void;
    cursorOffset: number;
  } | null>;
  voiceInterimRange?: {
    start: number;
    end: number;
  } | null;
};

// 【两个常量定义了「输入框最少占几行」】
//
//  PROMPT_FOOTER_LINES = 5：给 footer / 边框 / 状态行预留的行数。
//  MIN_INPUT_VIEWPORT_LINES = 3：输入框至少显示 3 行（哪怕终端很矮）。
//
//  它们在第 1999 行一起用：
//
//      maxVisibleLines = isFullscreen ? max(3, floor(rows/2) - 5) : undefined
//
//  逻辑是「输入框最多占一半屏，但要先扣掉 footer 的 5 行」。
//  为何是一半：输入框是临时内容，正文才是主体。用户写长 prompt 时会滚动查看，
//  但绝不会希望输入框挤满整个屏幕。
//
//  undefined 在非全屏时表示「不限制」—— 因为普通模式有 scrollback，
//  输入框长高了往上顶就行，不会破坏任何东西。
// Bottom slot has maxHeight="50%"; reserve lines for footer, border, status.
const PROMPT_FOOTER_LINES = 5;
const MIN_INPUT_VIEWPORT_LINES = 3;
function PromptInput({
  debug,
  ideSelection,
  toolPermissionContext,
  setToolPermissionContext,
  apiKeyStatus,
  commands,
  agents,
  isLoading,
  verbose,
  messages,
  onAutoUpdaterResult,
  autoUpdaterResult,
  input,
  onInputChange,
  mode,
  onModeChange,
  stashedPrompt,
  setStashedPrompt,
  submitCount,
  onShowMessageSelector,
  onMessageActionsEnter,
  mcpClients,
  pastedContents,
  setPastedContents,
  vimMode,
  setVimMode,
  showBashesDialog,
  setShowBashesDialog,
  onExit,
  getToolUseContext,
  onSubmit: onSubmitProp,
  onAgentSubmit,
  isSearchingHistory,
  setIsSearchingHistory,
  onDismissSideQuestion,
  isSideQuestionVisible,
  helpOpen,
  setHelpOpen,
  hasSuppressedDialogs,
  isLocalJSXCommandActive = false,
  insertTextRef,
  voiceInterimRange
}: Props): React.ReactNode {
  const mainLoopModel = useMainLoopModel();
  // A local-jsx command (e.g., /mcp while agent is running) renders a full-
  // screen dialog on top of PromptInput via the immediate-command path with
  // shouldHidePromptInput: false. Those dialogs don't register in the overlay
  // system, so treat them as a modal overlay here to stop navigation keys from
  // leaking into TextInput/footer handlers and stacking a second dialog.
// 【把「本地 JSX 命令」也算成模态遮罩】
//
//  isModalOverlayActive 有两个来源：
//    1. 正规的 overlay 系统（useIsModalOverlayActive）
//    2. 本地的全屏 JSX 命令（isLocalJSXCommandActive）
//
//  第 239-243 行的注释解释了为什么第 2 种要手动并进来：像 /mcp 这种命令
//  会盖住输入框，但它们**没有在 overlay 系统里注册**。如果不并入，
//  上下键会同时被输入框和弹窗处理，结果是「按一下 ↓，弹窗里动一格，
//  输入框里的建议也动一格」，甚至叠出第二个弹窗。
//
//  这个布尔值后面被用在十几处 isActive 判断里 —— 它本质上是一个
//  「现在谁能接收按键」的总闸。**终端 UI 没有焦点系统，焦点是这个组件自己算的。**
  const isModalOverlayActive = useIsModalOverlayActive() || isLocalJSXCommandActive;
  const [isAutoUpdating, setIsAutoUpdating] = useState(false);
  const [exitMessage, setExitMessage] = useState<{
    show: boolean;
    key?: string;
  }>({
    show: false
  });
// 【光标位置是本地状态，但输入文本不是】
//
//  cursorOffset 用 useState 存在这里，而 input 从 props 来。
//  这个不对称带来一个必须解决的问题：**外部改了 input，光标怎么办？**
//
//  第 255-260 行就是答案，而且是一个很少见的写法：**渲染期 setState**。
//
//      const lastInternalInputRef = useRef(input)
//      if (input !== lastInternalInputRef.current) {
//        setCursorOffset(input.length)
//        lastInternalInputRef.current = input
//      }
//
//  逻辑是：如果新的 input 不等于「上一次由我们内部设置的 input」，
//  说明是外部改的（语音转写、IDE 注入、历史回填），那就把光标挪到末尾。
//
//  React 允许渲染期 setState（它会把这次渲染重做一遍），但要求条件是
//  「基于 props/state 的纯计算」。这里能成立的关键是那个 ref：
//  它在第一次渲染时被写入，所以第二次渲染不会再触发（ref 不参与重渲染）。
//
//  为什么不用 useEffect：effect 要等提交后跑，用户会先看到「文本变了但光标
//  还在旧位置」的一帧。在终端里一帧就是一次可见的重绘。
  const [cursorOffset, setCursorOffset] = useState<number>(input.length);
  // Track the last input value set via internal handlers so we can detect
  // external input changes (e.g. speech-to-text injection) and move cursor to end.
  const lastInternalInputRef = React.useRef(input);
  if (input !== lastInternalInputRef.current) {
    // Input changed externally (not through any internal handler) — move cursor to end
    setCursorOffset(input.length);
    lastInternalInputRef.current = input;
  }
  // Wrap onInputChange to track internal changes before they trigger re-render
  const trackAndSetInput = React.useCallback((value: string) => {
    lastInternalInputRef.current = value;
    onInputChange(value);
  }, [onInputChange]);
  // Expose an insertText function so callers (e.g. STT) can splice text at the
  // current cursor position instead of replacing the entire input.
// 【渲染期间给 ref 赋值：一个「命令式出口」】
//
//  insertTextRef 是父组件传进来的 MutableRefObject。这里每次渲染都重新
//  往里写一个对象（含 insert 和 setInputWithCursor），意味着：
//
//    · 父组件随时可以调 insertTextRef.current.insert('文字')
//    · 调到的永远是「最新一次渲染」的版本（闭包里的 cursorOffset、input 都是新的）
//
//  如果不用这个模式，父组件就只能拿一个陈旧的函数（第一次渲染时的闭包），
//  插字时会用旧光标位置，把文字插到错误的地方。
//
//  第 272 行那个 needsSpace 判断很细：如果光标在末尾、输入非空、且末尾不是空白，
//  就先补一个空格。因为语音转写是连续注入的，不补空格会粘成一片。
//
//  这类「ref 里放最新函数」的模式，React 文档里叫 latest ref pattern。
//  它是 useImperativeHandle 的手工版，比 useImperativeHandle 更灵活
//  （能传多个方法、能读到最新 state），代价是要自己在渲染期写。
  if (insertTextRef) {
    insertTextRef.current = {
      cursorOffset,
      insert: (text: string) => {
        const needsSpace = cursorOffset === input.length && input.length > 0 && !/\s$/.test(input);
        const insertText = needsSpace ? ' ' + text : text;
        const newValue = input.slice(0, cursorOffset) + insertText + input.slice(cursorOffset);
        lastInternalInputRef.current = newValue;
        onInputChange(newValue);
        setCursorOffset(cursorOffset + insertText.length);
      },
      setInputWithCursor: (value: string, cursor: number) => {
        lastInternalInputRef.current = value;
        onInputChange(value);
        setCursorOffset(cursor);
      }
    };
  }
  const store = useAppStateStore();
  const setAppState = useSetAppState();
  const tasks = useAppState(s => s.tasks);
  const replBridgeConnected = useAppState(s => s.replBridgeConnected);
  const replBridgeExplicit = useAppState(s => s.replBridgeExplicit);
  const replBridgeReconnecting = useAppState(s => s.replBridgeReconnecting);
  // Must match BridgeStatusIndicator's render condition (PromptInputFooter.tsx) —
  // the pill returns null for implicit-and-not-reconnecting, so nav must too,
  // otherwise bridge becomes an invisible selection stop.
  const bridgeFooterVisible = replBridgeConnected && (replBridgeExplicit || replBridgeReconnecting);
  // Tmux pill (ant-only) — visible when there's an active tungsten session
  const hasTungstenSession = useAppState(s => "external" === 'ant' && s.tungstenActiveSession !== undefined);
  const tmuxFooterVisible = "external" === 'ant' && hasTungstenSession;
  // WebBrowser pill — visible when a browser is open
  const bagelFooterVisible = useAppState(s => false);
  const teamContext = useAppState(s => s.teamContext);
  const queuedCommands = useCommandQueue();
  const promptSuggestionState = useAppState(s => s.promptSuggestion);
  const speculation = useAppState(s => s.speculation);
  const speculationSessionTimeSavedMs = useAppState(s => s.speculationSessionTimeSavedMs);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const viewSelectionMode = useAppState(s => s.viewSelectionMode);
  const showSpinnerTree = useAppState(s => s.expandedView) === 'teammates';
  const {
    companion: _companion,
    companionMuted
  } = feature('BUDDY') ? getGlobalConfig() : {
    companion: undefined,
    companionMuted: undefined
  };
  const companionFooterVisible = !!_companion && !companionMuted;
  // Brief mode: BriefSpinner/BriefIdleStatus own the 2-row footprint above
  // the input. Dropping marginTop here lets the spinner sit flush against
  // the input bar. viewingAgentTaskId mirrors the gate on both (Spinner.tsx,
  // REPL.tsx) — teammate view falls back to SpinnerWithVerbInner which has
  // its own marginTop, so the gap stays even without ours.
  const briefOwnsGap = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s => s.isBriefOnly) && !viewingAgentTaskId : false;
  const mainLoopModel_ = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const thinkingEnabled = useAppState(s => s.thinkingEnabled);
  const isFastMode = useAppState(s => isFastModeEnabled() ? s.fastMode : false);
  const effortValue = useAppState(s => s.effortValue);
  const viewedTeammate = getViewedTeammateTask(store.getState());
  const viewingAgentName = viewedTeammate?.identity.agentName;
  // identity.color is typed as `string | undefined` (not AgentColorName) because
  // teammate identity comes from file-based config. Validate before casting to
  // ensure we only use valid color names (falls back to cyan if invalid).
  const viewingAgentColor = viewedTeammate?.identity.color && AGENT_COLORS.includes(viewedTeammate.identity.color as AgentColorName) ? viewedTeammate.identity.color as AgentColorName : undefined;
  // In-process teammates sorted alphabetically for footer team selector
  const inProcessTeammates = useMemo(() => getRunningTeammatesSorted(tasks), [tasks]);

  // Team mode: all background tasks are in-process teammates
  const isTeammateMode = inProcessTeammates.length > 0 || viewedTeammate !== undefined;

  // When viewing a teammate, show their permission mode in the footer instead of the leader's
  const effectiveToolPermissionContext = useMemo((): ToolPermissionContext => {
    if (viewedTeammate) {
      return {
        ...toolPermissionContext,
        mode: viewedTeammate.permissionMode
      };
    }
    return toolPermissionContext;
  }, [viewedTeammate, toolPermissionContext]);
  const {
    historyQuery,
    setHistoryQuery,
    historyMatch,
    historyFailedMatch
  } = useHistorySearch(entry => {
    setPastedContents(entry.pastedContents);
    void onSubmit(entry.display);
  }, input, trackAndSetInput, setCursorOffset, cursorOffset, onModeChange, mode, isSearchingHistory, setIsSearchingHistory, setPastedContents, pastedContents);
  // Counter for paste IDs (shared between images and text).
  // Compute initial value once from existing messages (for --continue/--resume).
  // useRef(fn()) evaluates fn() on every render and discards the result after
  // mount — getInitialPasteId walks all messages + regex-scans text blocks,
  // so guard with a lazy-init pattern to run it exactly once.
// 【-1 当哨兵，因为 0 是合法的粘贴 ID】
//
//      const nextPasteIdRef = useRef(-1)
//      if (nextPasteIdRef.current === -1) {
//        nextPasteIdRef.current = getInitialPasteId(messages)
//      }
//
//  注释（第 362-365 行）点出了真正的原因：`useRef(getInitialPasteId(messages))`
//  会在**每次渲染时都调用** getInitialPasteId（虽然结果被丢弃），
//  而那个函数要遍历所有消息 + 正则扫描每个文本块。7 轮对话后这可能涉及
//  上千条消息，每敲一个字都扫一遍，是纯粹的浪费。
//
//  所以用一个「不可能的值」当哨兵，实现惰性初始化。
//  为什么不用 null：因为 useRef 的类型推断会变成 `number | null`，
//  后面每次用都要收窄。用 -1 保持了 number 类型，代价是「-1 不能是合法 ID」这个约定。
//
//  getInitialPasteId 的作用是避开 --continue / --resume 场景下的 ID 冲突：
//  历史消息里可能已经有 [Image #3]，新粘贴必须从更大的号开始。
  const nextPasteIdRef = useRef(-1);
  if (nextPasteIdRef.current === -1) {
    nextPasteIdRef.current = getInitialPasteId(messages);
  }
  // Armed by onImagePaste; if the very next keystroke is a non-space
  // printable, inputFilter prepends a space before it. Any other input
  // (arrow, escape, backspace, paste, space) disarms without inserting.
// 【pendingSpaceAfterPillRef：一个「等下一个键」的延迟动作】
//
//  需求：粘完一张图后，输入框里出现 `[Image #1]`，用户接着打字。
//  如果不加空格，会变成 `[Image #1]hello` —— 图后面直接粘着文字。
//  但如果用户粘完图就按了回车，多出来的空格又很碍事。
//
//  解法：粘图时不加空格，**只「武装」一个标记**。下一个键进来时判断：
//    · 是可打印字符 → 补一个空格，然后清标记
//    · 是任何其他输入（方向键、退格、粘贴、空格本身）→ 只清标记，不补
//
//  这个判断的实现在第 1241 行的 lazySpaceInputFilter：
//  它作为 inputFilter 传给 TextInput，在每次输入前跑一遍。
//
//  **「延迟到下一个动作再决定」** 是处理这类「需要预判用户意图」需求的标准手法。
//  它的好处是永远不会多插（因为多插之后用户还得删），坏处是有状态
//  （多一个 ref），而且只对「下一个键」有效。
  const pendingSpaceAfterPillRef = useRef(false);
  const [showTeamsDialog, setShowTeamsDialog] = useState(false);
  const [showBridgeDialog, setShowBridgeDialog] = useState(false);
  const [teammateFooterIndex, setTeammateFooterIndex] = useState(0);
  // -1 sentinel: tasks pill is selected but no specific agent row is selected yet.
  // First ↓ selects the pill, second ↓ moves to row 0. Prevents double-select
  // of pill + row when both bg tasks (pill) and forked agents (rows) are visible.
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex);
  const setCoordinatorTaskIndex = useCallback((v: number | ((prev: number) => number)) => setAppState(prev => {
    const next = typeof v === 'function' ? v(prev.coordinatorTaskIndex) : v;
    if (next === prev.coordinatorTaskIndex) return prev;
    return {
      ...prev,
      coordinatorTaskIndex: next
    };
  }), [setAppState]);
  const coordinatorTaskCount = useCoordinatorTaskCount();
  // The pill (BackgroundTaskStatus) only renders when non-local_agent bg tasks
  // exist. When only local_agent tasks are running (coordinator/fork mode), the
  // pill is absent, so the -1 sentinel would leave nothing visually selected.
  // In that case, skip -1 and treat 0 as the minimum selectable index.
// 【-1 哨兵 + 动态下限：同一个「选中」概念，两个最小值】
//
//  coordinatorTaskIndex 的 -1 表示「停在任务胶囊上，还没进入具体任务行」。
//  但第 394 行发现了一个边界：胶囊本身可能不存在。
//
//    胶囊 → 只在有「非 local_agent 的后台任务」时才渲染
//    任务行 → 协调者模式下有 local_agent 任务就会出现
//
//  如果只有任务行、没有胶囊，那 -1 就指向一个**看不见的东西**：
//  用户按 ↓ 选中的是一个不存在的元素，屏幕上没有任何高亮，看起来像卡住了。
//
//  所以 minCoordinatorIndex 动态变化：有胶囊时是 -1，没胶囊时是 0。
//  第 397-403 行的 effect 负责把 index 钳回合法范围 ——
//  因为任务会结束、列表会缩短，光标可能落在不存在的行上。
//
//  这类「索引型状态 + 列表会缩短」的组合，**必须有一个钳制 effect**，
//  否则就会读到 undefined 然后安静地什么都不做（比报错更难查）。
  const hasBgTaskPill = useMemo(() => Object.values(tasks).some(t => isBackgroundTask(t) && !("external" === 'ant' && isPanelAgentTask(t))), [tasks]);
  const minCoordinatorIndex = hasBgTaskPill ? -1 : 0;
  // Clamp index when tasks complete and the list shrinks beneath the cursor
  useEffect(() => {
    if (coordinatorTaskIndex >= coordinatorTaskCount) {
      setCoordinatorTaskIndex(Math.max(minCoordinatorIndex, coordinatorTaskCount - 1));
    } else if (coordinatorTaskIndex < minCoordinatorIndex) {
      setCoordinatorTaskIndex(minCoordinatorIndex);
    }
  }, [coordinatorTaskCount, coordinatorTaskIndex, minCoordinatorIndex]);
  const [isPasting, setIsPasting] = useState(false);
  const [isExternalEditorActive, setIsExternalEditorActive] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [showFastModePicker, setShowFastModePicker] = useState(false);
  const [showThinkingToggle, setShowThinkingToggle] = useState(false);
  const [showAutoModeOptIn, setShowAutoModeOptIn] = useState(false);
  const [previousModeBeforeAuto, setPreviousModeBeforeAuto] = useState<PermissionMode | null>(null);
  const autoModeOptInTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if cursor is on the first line of input
  const isCursorOnFirstLine = useMemo(() => {
    const firstNewlineIndex = input.indexOf('\n');
    if (firstNewlineIndex === -1) {
      return true; // No newlines, cursor is always on first line
    }
    return cursorOffset <= firstNewlineIndex;
  }, [input, cursorOffset]);
  const isCursorOnLastLine = useMemo(() => {
    const lastNewlineIndex = input.lastIndexOf('\n');
    if (lastNewlineIndex === -1) {
      return true; // No newlines, cursor is always on last line
    }
    return cursorOffset > lastNewlineIndex;
  }, [input, cursorOffset]);

  // Derive team info from teamContext (no filesystem I/O needed)
  // A session can only lead one team at a time
  const cachedTeams: TeamSummary[] = useMemo(() => {
    if (!isAgentSwarmsEnabled()) return [];
    // In-process mode uses Shift+Down/Up navigation instead of footer menu
    if (isInProcessEnabled()) return [];
    if (!teamContext) {
      return [];
    }
    const teammateCount = count(Object.values(teamContext.teammates), t => t.name !== 'team-lead');
    return [{
      name: teamContext.teamName,
      memberCount: teammateCount,
      runningCount: 0,
      idleCount: 0
    }];
  }, [teamContext]);

// 【footer 药丸的导航：顺序就是数组顺序，没有第二套映射】
//
//  注释（第 450-453 行）说得很好：**Order here IS the nav order**。
//  也就是说「用户按 ↓ 会去哪」这件事，完全由下面 footerItems 的拼装顺序决定，
//  没有任何单独的导航配置表。
//
//  这个设计的好处是不会出现「显示顺序和导航顺序不一致」的 bug
//  （那是菜单类 UI 最常见的 bug）。坏处是调整顺序时容易只改了渲染、
//  忘了这里就是导航定义。
//
//  第 451 行还有一句关键约束：down/right = 前进，up/left = 后退。
//  四个方向键映射成两个动作（±1），所以不需要四份代码。
//
//  第 452-453 行：选中状态存在 AppState 里，而不是组件 state。
//  原因很具体 —— 有些药丸（CompanionSprite）渲染在 PromptInput 之外，
//  它们也要读到「我现在被选中了吗」。**跨组件边界的焦点状态必须上提。**
  // ─── Footer pill navigation ─────────────────────────────────────────────
  // Which pills render below the input box. Order here IS the nav order
  // (down/right = forward, up/left = back). Selection lives in AppState so
  // pills rendered outside PromptInput (CompanionSprite) can read focus.
  const runningTaskCount = useMemo(() => count(Object.values(tasks), t => t.status === 'running'), [tasks]);
  // Panel shows retained-completed agents too (getVisibleAgentTasks), so the
  // pill must stay navigable whenever the panel has rows — not just when
  // something is running.
  const tasksFooterVisible = (runningTaskCount > 0 || "external" === 'ant' && coordinatorTaskCount > 0) && !shouldHideTasksFooter(tasks, showSpinnerTree);
  const teamsFooterVisible = cachedTeams.length > 0;
// 【footerItems：一行代码定下导航顺序，同时过滤掉不可见项】
//
//      [tasksFooterVisible && 'tasks', tmuxFooterVisible && 'tmux', …]
//        .filter(Boolean)
//
//  这个写法的巧妙之处：`false` 会被 filter 掉，所以不需要 if。
//  代价是类型上要 `as FooterItem[]`（因为数组元素类型是 `false | 'tasks' | …`）。
//
//  顺序背后的产品判断：tasks 第一（最常用），tmux 第二（内部功能），
//  然后是 bagel（浏览器）、teams、bridge、companion。越靠前越容易按到
//  （因为从输入框按 ↓ 一次就到第一个）。
//
//  第 458 行 tasksFooterVisible 的条件里藏着那句 `"external" === 'ant'`：
//  对外构建里它恒假，于是条件退化成「有任务在跑 且 不该隐藏」。
//  也就是说**协调者模式的任务面板在对外版本里根本不存在**。
  const footerItems = useMemo(() => [tasksFooterVisible && 'tasks', tmuxFooterVisible && 'tmux', bagelFooterVisible && 'bagel', teamsFooterVisible && 'teams', bridgeFooterVisible && 'bridge', companionFooterVisible && 'companion'].filter(Boolean) as FooterItem[], [tasksFooterVisible, tmuxFooterVisible, bagelFooterVisible, teamsFooterVisible, bridgeFooterVisible, companionFooterVisible]);

  // Effective selection: null if the selected pill stopped rendering (bridge
  // disconnected, task finished). The derivation makes the UI correct
  // immediately; the useEffect below clears the raw state so it doesn't
  // resurrect when the same pill reappears (new task starts → focus stolen).
  const rawFooterSelection = useAppState(s => s.footerSelection);
// 【派生值 vs 原始值：一个「立刻正确」+ 一个「迟早清理」】
//
//  这是本文件里最值得学的一个模式：
//
//      const rawFooterSelection = useAppState(s => s.footerSelection)   // 原始
//      const footerItemSelected = rawFooterSelection && footerItems.includes(raw)
//        ? rawFooterSelection : null                                   // 派生
//
//  raw 可能是过期的：选中的是 bridge 药丸，但连接断了、药丸不渲染了。
//  这时：
//    · **派生的 footerItemSelected 立刻变 null** → UI 当帧就正确
//    · **第 468 行的 effect 再把 raw 清成 null** → 防止「将来药丸又出现时
//      焦点凭空回到它身上」（比如新任务开始，tasks 药丸重新出现，用户按 ↓
//      却直接跳到了 tasks 上）
//
//  两个状态，一个负责「现在对不对」，一个负责「以后别诈尸」。
//  只用派生值：raw 会一直是脏的。只用 raw：会有一帧的错位。
//
//  注释里那句 "so it doesn't resurrect when the same pill reappears"
//  就是这个模式存在的全部理由。
  const footerItemSelected = rawFooterSelection && footerItems.includes(rawFooterSelection) ? rawFooterSelection : null;
  useEffect(() => {
    if (rawFooterSelection && !footerItemSelected) {
      setAppState(prev => prev.footerSelection === null ? prev : {
        ...prev,
        footerSelection: null
      });
    }
  }, [rawFooterSelection, footerItemSelected, setAppState]);
  const tasksSelected = footerItemSelected === 'tasks';
  const tmuxSelected = footerItemSelected === 'tmux';
  const bagelSelected = footerItemSelected === 'bagel';
  const teamsSelected = footerItemSelected === 'teams';
  const bridgeSelected = footerItemSelected === 'bridge';
  function selectFooterItem(item: FooterItem | null): void {
    setAppState(prev => prev.footerSelection === item ? prev : {
      ...prev,
      footerSelection: item
    });
    if (item === 'tasks') {
      setTeammateFooterIndex(0);
      setCoordinatorTaskIndex(minCoordinatorIndex);
    }
  }

  // delta: +1 = down/right, -1 = up/left. Returns true if nav happened
  // (including deselecting at the start), false if at a boundary.
// 【navigateFooter：返回布尔值，因为「有没有动」要告诉调用方】
//
//      navigateFooter(delta, exitAtStart = false): boolean
//
//  三种情况：
//    1. 下一个位置存在 → 选中它，返回 true
//    2. 到头了但 delta 是 -1 且允许「退出」→ 取消选中，返回 true
//    3. 到头了且不允许退出 → 返回 false
//
//  返回 false 的意义：调用方（↓ 键的处理）要知道「footer 这边接不住这个键」，
//  于是可以把键让给别的处理器（比如把焦点还给输入框）。
//
//  这是终端按键处理里的通用约定：**handler 返回 true/false 表示「消费了没有」**。
//  不消费就让事件继续冒泡。第 1841 行的 footer:close 也是同样思路
//  （返回 false 让 'x' 落进输入框）。
//
//  注意 exitAtStart 只在向上时生效：从第一个药丸再往上，应该「退出 footer 回到输入」，
//  而不是卡住。向下则不退出 —— 因为下面没有别的东西了。
  function navigateFooter(delta: 1 | -1, exitAtStart = false): boolean {
    const idx = footerItemSelected ? footerItems.indexOf(footerItemSelected) : -1;
    const next = footerItems[idx + delta];
    if (next) {
      selectFooterItem(next);
      return true;
    }
    if (delta < 0 && exitAtStart) {
      selectFooterItem(null);
      return true;
    }
    return false;
  }

  // Prompt suggestion hook - reads suggestions generated by forked agent in query loop
  const {
    suggestion: promptSuggestion,
    markAccepted,
    logOutcomeAtSubmission,
    markShown
  } = usePromptSuggestion({
    inputValue: input,
    isAssistantResponding: isLoading
  });
// 【displayedValue：屏幕上显示的文本 ≠ 状态里的文本】
//
//      isSearchingHistory && historyMatch ? getValueFromInput(historyMatch…) : input
//
//  在 ctrl+r 搜历史时，输入框显示的是**历史匹配项**，而 input 仍然是用户
//  正在输入的搜索词。于是整个渲染链（高亮、宽度、光标）都要基于 displayedValue，
//  而提交、编辑、写入仍然基于 input。
//
//  这就是「两本账」：**显示账和状态账**。整个文件里所有和「显示」有关的
//  计算（下面十个 useMemo 全是）都用 displayedValue，
//  所有和「数据」有关的操作用 input。
//
//  混用会出两种 bug：用 input 算高亮 → 搜索时高亮位置全错；
//  用 displayedValue 提交 → 用户搜到的东西被当成输入发出去。
//
//  getValueFromInput 还顺手剥掉了 bash 模式的 ! 前缀 —— 因为搜索框里
//  不该显示那个模式字符。
  const displayedValue = useMemo(() => isSearchingHistory && historyMatch ? getValueFromInput(typeof historyMatch === 'string' ? historyMatch : historyMatch.display) : input, [isSearchingHistory, historyMatch, input]);
// 【十个独立的「触发器扫描器」，每个都返回位置区间】
//
//  从第 519 行到第 538 行，连续十个 useMemo，形状完全一样：
//
//      useMemo(() => feature 关闭 ? [] : findXxxPositions(displayedValue), [deps])
//
//  扫的东西分别是：思考关键字、ultraplan、ultrareview、/btw、/buddy、
//  斜杠命令、token 预算、slack 频道、@队友、图片引用。
//
//  为什么拆成十个而不是一个扫描器：**每个的开启条件不同**。
//  三个被 feature 门控（编译期剔除）、一个被用户设置控制（ultrareview）、
//  一个依赖外部订阅（slack 频道版本号）。合成一个的话，条件会变成
//  「十个开关的笛卡尔积」，不可维护。
//
//  代价是每次输入变化跑十次正则扫描。但每个扫描都只遍历一遍短字符串
//  （输入框通常几十到几百字符），总量可忽略 —— **拆开的可读性收益远大于开销**。
  const thinkTriggers = useMemo(() => findThinkingTriggerPositions(displayedValue), [displayedValue]);
  const ultraplanSessionUrl = useAppState(s => s.ultraplanSessionUrl);
  const ultraplanLaunching = useAppState(s => s.ultraplanLaunching);
  const ultraplanTriggers = useMemo(() => feature('ULTRAPLAN') && !ultraplanSessionUrl && !ultraplanLaunching ? findUltraplanTriggerPositions(displayedValue) : [], [displayedValue, ultraplanSessionUrl, ultraplanLaunching]);
  const ultrareviewTriggers = useMemo(() => isUltrareviewEnabled() ? findUltrareviewTriggerPositions(displayedValue) : [], [displayedValue]);
  const btwTriggers = useMemo(() => findBtwTriggerPositions(displayedValue), [displayedValue]);
  const buddyTriggers = useMemo(() => findBuddyTriggerPositions(displayedValue), [displayedValue]);
// 【斜杠命令要再过滤一遍「是不是真的存在」】
//
//      findSlashCommandPositions 找出所有 `/xxx` 的位置
//      → filter: hasCommand(name, commands) 只留真实存在的命令
//
//  为什么扫描器不自己过滤：因为扫描器（utils/suggestions/commandSuggestions.js）
//  只看文本形状，不认识命令表。**形状识别和语义校验是两个层次**，
//  分开之后扫描器可以被复用到别处（比如判断「这行是不是命令」）。
//
//  效果差异很直观：用户打 `/foo bar`，如果 foo 不存在，`/foo` 不会被染成蓝色。
//  用户一眼就知道「这个命令没有」。
//
//  注意 slice(pos.start + 1, pos.end) 那个 +1：跳过 `/` 本身。
//  pos.end 是**不含**的右边界，所以这段切片正好是命令名。
  const slashCommandTriggers = useMemo(() => {
    const positions = findSlashCommandPositions(displayedValue);
    // Only highlight valid commands
    return positions.filter(pos => {
      const commandName = displayedValue.slice(pos.start + 1, pos.end); // +1 to skip "/"
      return hasCommand(commandName, commands);
    });
  }, [displayedValue, commands]);
  const tokenBudgetTriggers = useMemo(() => feature('TOKEN_BUDGET') ? findTokenBudgetPositions(displayedValue) : [], [displayedValue]);
  const knownChannelsVersion = useSyncExternalStore(subscribeKnownChannels, getKnownChannelsVersion);
  const slackChannelTriggers = useMemo(() => hasSlackMcpServer(store.getState().mcp.clients) ? findSlackChannelPositions(displayedValue) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps -- store is a stable ref
  [displayedValue, knownChannelsVersion]);

  // Find @name mentions and highlight with team member's color
  const memberMentionHighlights = useMemo((): Array<{
    start: number;
    end: number;
    themeColor: keyof Theme;
  }> => {
    if (!isAgentSwarmsEnabled()) return [];
    if (!teamContext?.teammates) return [];
    const highlights: Array<{
      start: number;
      end: number;
      themeColor: keyof Theme;
    }> = [];
    const members = teamContext.teammates;
    if (!members) return highlights;

    // Find all @name patterns in the input
// 【@名字的正则要有「前导边界」，不能只匹配 @】
//
//      /(行首或空白)@(字母数字下划线连字符)/ 加 g 全局标志
//
//  两个细节：
//    · (行首竖线空白) —— 前面必须是行首或空白。否则 `a@b.com` 里的 @b 会被当成
//      队友名。邮箱地址在 prompt 里太常见了，不加这个边界会产生大量误判。
//    · 后半段是字母数字下划线加连字符。队友名允许连字符（比如 ui-designer），
//      不允许点、空格、中文 —— 因为这是「团队标识符」，不是显示名。
//
//  第 561-563 行还要再算一次位置：match.index 是 `(行首竖线空白)` 那个组的起点，
//  要跳过前导空白。fullMatch.trimStart() 得到 `@名字` 的长度，
//  于是 end = nameStart + 长度。**正则里有分组时，下标计算必须逐个校正**，
//  这是最容易差一位的地方。
//
//  最后的判断是 member?.color：只有真在团队表里、且有颜色的名字才高亮。
//  也就是说这里同时做了「识别」和「校验」，和上面斜杠命令的两层结构不同 ——
//  因为「是不是队友」这个判断需要的数据就在手边（teamContext），
//  不值得再拆一层。
    const regex = /(^|\s)@([\w-]+)/g;
    const memberValues = Object.values(members);
    let match;
    while ((match = regex.exec(displayedValue)) !== null) {
      const leadingSpace = match[1] ?? '';
      const nameStart = match.index + leadingSpace.length;
      const fullMatch = match[0].trimStart();
      const name = match[2];

      // Check if this name matches a team member
      const member = memberValues.find(t => t.name === name);
      if (member?.color) {
        const themeColor = AGENT_COLOR_TO_THEME_COLOR[member.color as AgentColorName];
        if (themeColor) {
          highlights.push({
            start: nameStart,
            end: nameStart + fullMatch.length,
            themeColor
          });
        }
      }
    }
    return highlights;
  }, [displayedValue, teamContext]);
  const imageRefPositions = useMemo(() => parseReferences(displayedValue).filter(r => r.match.startsWith('[Image')).map(r => ({
    start: r.index,
    end: r.index + r.match.length
  })), [displayedValue]);

  // chip.start is the "selected" state: the inverted chip IS the cursor.
  // chip.end stays a normal position so you can park the cursor right after
  // `]` like any other character.
// 【反色胶囊就是光标 —— 这句话是整段的设计核心】
//
//  注释（第 586-588 行）：
//
//      chip.start is the "selected" state: the inverted chip IS the cursor.
//      chip.end stays a normal position so you can park the cursor right after
//      `]` like any other character.
//
//  `[Image #1]` 是一段不可分割的文本（chip）。光标停在哪：
//    · 停在 start（左边界）→ 这个 chip 反色显示，表示「已选中，按退格删掉它」
//    · 停在 end（右边界）→ 正常光标，表示「就在它后面，可以继续打字」
//
//  两个位置都合法，但语义不同。所以 start 是「选中态」，end 是「普通位置」。
//
//  这和文本编辑器的「对象选中」是一个概念：图片不是字符，不能逐字符编辑，
//  只能整体选中/整体删除。终端里没有真正的「对象模型」，所以用反色来模拟。
//
//  cursorAtImageChip 这个布尔值后面传给 TextInput 的 showCursor={false}——
//  因为此时「光标」已经由反色块表达了，再画一个竖线会出现两个光标。
  const cursorAtImageChip = imageRefPositions.some(r => r.start === cursorOffset);

  // up/down movement or a fullscreen click can land the cursor strictly
  // inside a chip; snap to the nearer boundary so it's never editable
  // char-by-char.
// 【把落进 chip 内部的光标「吸附」到最近的边界】
//
//  怎么会出现「在 chip 内部」：方向键上下移动、全屏模式下点击，
//  都会算出任意位置 —— 而这些操作不知道 chip 的存在。
//
//  处理方式：算中点，偏左就吸附到 start，偏右吸附到 end。
//  效果类似「磁吸」：光标永远不会停在 `[Ima|ge #1]` 这种位置。
//
//  为什么必须吸附而不是允许停在内部：因为 chip 是整体删除的
//  （退格删整个引用），如果光标在内部，用户按退格会得到一个
//  「删了一半的引用」—— 那个字符串不再匹配引用格式，附件就变成孤儿了。
//
//  这个 effect 的依赖是 [cursorOffset, imageRefPositions]，注意它会在
//  **每次光标移动时**执行。所以吸附逻辑必须非常便宜（一个 find，量级是个位数）。
//
//  一个容易忽略的细节：setCursorOffset 在这里被调用，会触发一次额外渲染。
//  React 会批处理，但如果 find 找到的 inside 恰好等于当前位置（不可能，
//  因为条件是严格不等），就会死循环。条件写 > 和 < 而不是 >= <=，就是为了这个。
  useEffect(() => {
    const inside = imageRefPositions.find(r => cursorOffset > r.start && cursorOffset < r.end);
    if (inside) {
      const mid = (inside.start + inside.end) / 2;
      setCursorOffset(cursorOffset < mid ? inside.start : inside.end);
    }
  }, [cursorOffset, imageRefPositions, setCursorOffset]);
// 【combinedHighlights：一个数组里按 priority 决定谁盖谁】
//
//  九种高亮全塞进一个数组，每一种带一个 priority 数字：
//
//    20 历史搜索匹配（最高，因为它就是用户当下在找的东西）
//    15 /btw 关键字
//    10 彩虹词（ultrathink / ultraplan / ultrareview / buddy）
//     8 图片胶囊反色
//     5 斜杠命令 / token 预算 / slack 频道 / @队友
//     1 语音的临时转写文字（最弱，只是变暗）
//
//  渲染层（segmentTextByHighlights）按 priority 排序后依次覆盖 ——
//  也就是**分段函数**：每一格取「覆盖它的最高优先级」的那个样式。
//
//  为什么 @队友 (5) 低于彩虹词 (10)：因为 @名字 和 ultrathink 可能重叠
//  （`@bob ultrathink` 不重叠，但 `ultrathink @bob` 中如果队友叫 ultrathink…）。
//  实际上这个优先级表真正的意义在于「重叠时谁赢」，而重叠最常见的场景是
//  斜杠命令里带 @（`/review @bob`）—— 这时命令的蓝色赢，因为
//  @bob 在命令参数里不是「队友提及」而是普通文本。
//
//  **优先级数字不是重要性排序，是冲突解决顺序。**
  const combinedHighlights = useMemo((): TextHighlight[] => {
    const highlights: TextHighlight[] = [];

    // Invert the [Image #N] chip when the cursor is at chip.start (the
    // "selected" state) so backspace-to-delete is visually obvious.
    for (const ref of imageRefPositions) {
      if (cursorOffset === ref.start) {
        highlights.push({
          start: ref.start,
          end: ref.end,
          color: undefined,
          inverse: true,
          priority: 8
        });
      }
    }
    if (isSearchingHistory && historyMatch && !historyFailedMatch) {
      highlights.push({
        start: cursorOffset,
        end: cursorOffset + historyQuery.length,
        color: 'warning',
        priority: 20
      });
    }

    // Add "btw" highlighting (solid yellow)
    for (const trigger of btwTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'warning',
        priority: 15
      });
    }

    // Add /command highlighting (blue)
    for (const trigger of slashCommandTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'suggestion',
        priority: 5
      });
    }

    // Add token budget highlighting (blue)
    for (const trigger of tokenBudgetTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'suggestion',
        priority: 5
      });
    }
    for (const trigger of slackChannelTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'suggestion',
        priority: 5
      });
    }

    // Add @name highlighting with team member's color
    for (const mention of memberMentionHighlights) {
      highlights.push({
        start: mention.start,
        end: mention.end,
        color: mention.themeColor,
        priority: 5
      });
    }

    // Dim interim voice dictation text
    if (voiceInterimRange) {
      highlights.push({
        start: voiceInterimRange.start,
        end: voiceInterimRange.end,
        color: undefined,
        dimColor: true,
        priority: 1
      });
    }

    // Rainbow highlighting for ultrathink keyword (per-character cycling colors)
// 【彩虹高亮：一个字符一个 highlight】
//
//  为了做出「每个字颜色不同」的效果，这里对一个词的每个字符都 push 一条
//  独立的 highlight：start=i, end=i+1，颜色由 getRainbowColor(偏移) 算。
//
//  一个五个字母的词就产生五条记录。看起来很低效，但这正是终端渲染的
//  唯一实现方式 —— 没有渐变，只能逐格上色。
//
//  注意每条还带了 shimmerColor（第二个参数传 true 得到「亮版本」），
//  于是 ShimmeredInput 会把它当成流光的候选，逐字符渲染 ShimmerChar。
//  也就是说**彩虹和流光用的是同一套机制**：color 定底色，shimmerColor 定高光。
//
//  这段代码出现了四遍（ultrathink / ultraplan / ultrareview / buddy），
//  每遍 12 行，只有触发器和 feature 条件不同。没有抽成函数，是因为
//  feature() 必须在调用点才能被编译期折叠 —— 抽成函数就折不动了
//  （函数体是共享的，无法为不同调用点生成不同产物）。
//
//  这是个「为构建工具让步，牺牲 DRY」的典型例子。
    if (isUltrathinkEnabled()) {
      for (const trigger of thinkTriggers) {
        for (let i = trigger.start; i < trigger.end; i++) {
          highlights.push({
            start: i,
            end: i + 1,
            color: getRainbowColor(i - trigger.start),
            shimmerColor: getRainbowColor(i - trigger.start, true),
            priority: 10
          });
        }
      }
    }

    // Same rainbow treatment for the ultraplan keyword
    if (feature('ULTRAPLAN')) {
      for (const trigger of ultraplanTriggers) {
        for (let i = trigger.start; i < trigger.end; i++) {
          highlights.push({
            start: i,
            end: i + 1,
            color: getRainbowColor(i - trigger.start),
            shimmerColor: getRainbowColor(i - trigger.start, true),
            priority: 10
          });
        }
      }
    }

    // Same rainbow treatment for the ultrareview keyword
    for (const trigger of ultrareviewTriggers) {
      for (let i = trigger.start; i < trigger.end; i++) {
        highlights.push({
          start: i,
          end: i + 1,
          color: getRainbowColor(i - trigger.start),
          shimmerColor: getRainbowColor(i - trigger.start, true),
          priority: 10
        });
      }
    }

    // Rainbow for /buddy
    for (const trigger of buddyTriggers) {
      for (let i = trigger.start; i < trigger.end; i++) {
        highlights.push({
          start: i,
          end: i + 1,
          color: getRainbowColor(i - trigger.start),
          shimmerColor: getRainbowColor(i - trigger.start, true),
          priority: 10
        });
      }
    }
    return highlights;
  }, [isSearchingHistory, historyQuery, historyMatch, historyFailedMatch, cursorOffset, btwTriggers, imageRefPositions, memberMentionHighlights, slashCommandTriggers, tokenBudgetTriggers, slackChannelTriggers, displayedValue, voiceInterimRange, thinkTriggers, ultraplanTriggers, ultrareviewTriggers, buddyTriggers]);
  const {
    addNotification,
    removeNotification
  } = useNotifications();

  // Show ultrathink notification
// 【三个「触发器一出现就弹提示」的 effect，结构完全一样】
//
//      if (有触发器 && 功能开着) addNotification({key, text, timeoutMs})
//      else removeNotification(key)
//
//  三个 key 分别是 ultrathink-active / ultraplan-active / ultrareview-active。
//
//  设计要点有三：
//    1. **用固定的 key**：通知系统按 key 去重，同一个 key 重复 add 只更新时间，
//       不会堆出三条一样的话。
//    2. **else 分支必须 remove**：用户把关键词删掉后，提示要立刻消失。
//       这是提示类 effect 最常见的遗漏点。
//    3. **依赖只放 length**：`[addNotification, removeNotification, thinkTriggers.length]`
//       —— 位置变了但数量没变（比如关键词往后挪了几格）不会重跑，
//       因为提示内容一样，没必要。
//
//  唯一不一致的是第三个（ultrareview）：它**没有 else 分支**。
//  也就是说提示弹出后，删掉关键词它也不会立刻消失，要等 5 秒 timeout。
//  这是三处复制粘贴留下的不一致 —— 影响很小（提示本来就会自动消失），
//  但这种「三份几乎一样、其中一份少了行」的代码，是将来改需求时最容易出错的地方。
  useEffect(() => {
    if (thinkTriggers.length && isUltrathinkEnabled()) {
      addNotification({
        key: 'ultrathink-active',
        text: 'Effort set to high for this turn',
        priority: 'immediate',
        timeoutMs: 5000
      });
    } else {
      removeNotification('ultrathink-active');
    }
  }, [addNotification, removeNotification, thinkTriggers.length]);
  useEffect(() => {
    if (feature('ULTRAPLAN') && ultraplanTriggers.length) {
      addNotification({
        key: 'ultraplan-active',
        text: 'This prompt will launch an ultraplan session in Claude Code on the web',
        priority: 'immediate',
        timeoutMs: 5000
      });
    } else {
      removeNotification('ultraplan-active');
    }
  }, [addNotification, removeNotification, ultraplanTriggers.length]);
  useEffect(() => {
    if (isUltrareviewEnabled() && ultrareviewTriggers.length) {
      addNotification({
        key: 'ultrareview-active',
        text: 'Run /ultrareview after Claude finishes to review these changes in the cloud',
        priority: 'immediate',
        timeoutMs: 5000
      });
    }
  }, [addNotification, ultrareviewTriggers.length]);

  // Track input length for stash hint
  const prevInputLengthRef = useRef(input.length);
  const peakInputLengthRef = useRef(input.length);

  // Dismiss stash hint when user makes any input change
  const dismissStashHint = useCallback(() => {
    removeNotification('stash-hint');
  }, [removeNotification]);

  // Show stash hint when user gradually clears substantial input
// 【「用户慢慢把输入删光了」—— 靠两个 ref 记录峰值和上一次长度】
//
//  需求：用户写了一大段，然后一个个删掉。这时候提示他「ctrl+s 可以存草稿」。
//  但如果他是按了 esc esc 一键清空，就不该提示（他明显是故意的）。
//
//  怎么区分：看**变化是一次性还是渐进的**。
//
//    peakLengthRef  记录这段输入的峰值长度（只在变长时更新）
//    prevInputLengthRef 记录上一次渲染时的长度
//
//  第 813-814 行两个判据：
//    clearedSubstantialInput = peak >= 20 && current <= 5     峰值够高，现在快没了
//    wasRapidClear           = prev >= 20 && current <= 5     上一帧还在 20+，这一帧就没了
//
//  前者是「确实删掉了大量内容」，后者是「这一步删得太猛，像是快捷键」。
//
//  这两个判据**只在渐进删除时同时成立一个**：一步步删，prev 会跟着降，
//  所以 wasRapidClear 是假；一键清空，prev 还是 20+，两个都真 → 不提示。
//
//  第 815 行 `clearedSubstantialInput && !wasRapidClear` 就是完整条件。
//
//  这是个很典型的「从状态轨迹推断意图」的设计 —— 没有哪个单一状态能区分
//  这两种情况，只有变化模式能。
  useEffect(() => {
    const prevLength = prevInputLengthRef.current;
    const peakLength = peakInputLengthRef.current;
    const currentLength = input.length;
    prevInputLengthRef.current = currentLength;

    // Update peak when input grows
    if (currentLength > peakLength) {
      peakInputLengthRef.current = currentLength;
      return;
    }

    // Reset state when input is empty
    if (currentLength === 0) {
      peakInputLengthRef.current = 0;
      return;
    }

    // Detect gradual clear: peak was high, current is low, but this wasn't a single big jump
    // (rapid clears like esc-esc go from 20+ to 0 in one step)
    const clearedSubstantialInput = peakLength >= 20 && currentLength <= 5;
    const wasRapidClear = prevLength >= 20 && currentLength <= 5;
    if (clearedSubstantialInput && !wasRapidClear) {
      const config = getGlobalConfig();
      if (!config.hasUsedStash) {
        addNotification({
          key: 'stash-hint',
          jsx: <Text dimColor>
              Tip:{' '}
              <ConfigurableShortcutHint action="chat:stash" context="Chat" fallback="ctrl+s" description="stash" />
            </Text>,
          priority: 'immediate',
          timeoutMs: FOOTER_TEMPORARY_STATUS_TIMEOUT
        });
      }
      peakInputLengthRef.current = currentLength;
    }
  }, [input.length, addNotification]);

  // Initialize input buffer for undo functionality
  const {
    pushToBuffer,
    undo,
    canUndo,
    clearBuffer
  } = useInputBuffer({
    maxBufferSize: 50,
    debounceMs: 1000
  });
  useMaybeTruncateInput({
    input,
    pastedContents,
    onInputChange: trackAndSetInput,
    setCursorOffset,
    setPastedContents
  });
  const defaultPlaceholder = usePromptInputPlaceholder({
    input,
    submitCount,
    viewingAgentName
  });
// 【onChange：输入恰好是 ? 时，不插入而是打开帮助】
//
//      if (value === '?') { setHelpOpen(v => !v); return }
//
//  注意判据是「新值整体等于 ?」，不是「刚敲的是 ?」。所以：
//    · 空输入里敲 ? → 新值就是 "?" → 打开帮助，字符不入库
//    · 已有内容时敲 ? → 新值是 "abc?" → 正常插入
//
//  也就是说 **? 只有在句首才是快捷键**。这是个很聪明的设计：
//  句首的 ? 大概率是「我想知道有什么功能」，句中/句尾的 ? 是正常标点。
//
//  代价：用户没法以问号开头的句子（比如「? 这个怎么用」）。
//  这类「有损的快捷键」在终端应用里很常见（vim 的 : 也一样），
//  判断标准是「以该字符开头的正常输入有多常见」。
//
//  后面几行（第 862-867 行）做了四件事：收起帮助、收起草稿提示、
//  取消待定的 prompt 建议、取消推测执行。**用户一动手，所有「预判」都要让路**。
  const onChange = useCallback((value: string) => {
    if (value === '?') {
      logEvent('tengu_help_toggled', {});
      setHelpOpen(v => !v);
      return;
    }
    setHelpOpen(false);

    // Dismiss stash hint when user makes any input change
    dismissStashHint();

    // Cancel any pending prompt suggestion and speculation when user types
    abortPromptSuggestion();
    abortSpeculation(setAppState);

    // Check if this is a single character insertion at the start
// 【模式字符的处理分两种情况，区别在「插入长度」】
//
//      isSingleCharInsertion = value.length === input.length + 1
//      insertedAtStart       = cursorOffset === 0
//
//  情况 A（单字符插入到开头）：用户敲了 ! → 切到 bash 模式，字符不插入。
//  情况 B（多字符插入到空输入）：用户 Tab 接受了建议「! gcloud auth login」
//      → 切模式 + 插入去掉 ! 之后的剩余部分（还要把 Tab 换成 4 个空格）。
//
//  为什么 B 要单独处理：因为 Tab 补全一次性塞进来一整串，如果按「单字符」
//  那条路走（切模式后 return），那 `! gcloud auth login` 里的命令就丢了。
//
//  注意 B 的条件里还有 `input.length === 0`：只在输入框为空时这么做。
//  如果用户已经写了半句，再接受一个 ! 开头的建议，就不该强行切模式
//  （那会把已有的内容变成 shell 命令）。
//
//  第 888 行的 `replaceAll(Tab, 4 空格)` 是全局行为：不管哪条路径，
//  输入里的 Tab 都变成 4 空格。因为终端渲染里 Tab 的宽度取决于当前列位置，
//  一个 Tab 可能占 1-8 列，光标计算会彻底失准。**用空格换掉所有 Tab，
//  是终端文本输入的必要之恶。**
    const isSingleCharInsertion = value.length === input.length + 1;
    const insertedAtStart = cursorOffset === 0;
    const mode = getModeFromInput(value);
    if (insertedAtStart && mode !== 'prompt') {
      if (isSingleCharInsertion) {
        onModeChange(mode);
        return;
      }
      // Multi-char insertion into empty input (e.g. tab-accepting "! gcloud auth login")
      if (input.length === 0) {
        onModeChange(mode);
        const valueWithoutMode = getValueFromInput(value).replaceAll('\t', '    ');
        pushToBuffer(input, cursorOffset, pastedContents);
        trackAndSetInput(valueWithoutMode);
        setCursorOffset(valueWithoutMode.length);
        return;
      }
    }
    const processedValue = value.replaceAll('\t', '    ');

    // Push current state to buffer before making changes
    if (input !== processedValue) {
      pushToBuffer(input, cursorOffset, pastedContents);
    }

    // Deselect footer items when user types
    setAppState(prev => prev.footerSelection === null ? prev : {
      ...prev,
      footerSelection: null
    });
    trackAndSetInput(processedValue);
  }, [trackAndSetInput, onModeChange, input, cursorOffset, pushToBuffer, pastedContents, dismissStashHint, setAppState]);
  const {
    resetHistory,
    onHistoryUp,
    onHistoryDown,
    dismissSearchHint,
    historyIndex
  } = useArrowKeyHistory((value: string, historyMode: HistoryMode, pastedContents: Record<number, PastedContent>) => {
    onChange(value);
    onModeChange(historyMode);
    setPastedContents(pastedContents);
  }, input, pastedContents, setCursorOffset, mode);

  // Dismiss search hint when user starts searching
  useEffect(() => {
    if (isSearchingHistory) {
      dismissSearchHint();
    }
  }, [isSearchingHistory, dismissSearchHint]);

  // Only use history navigation when there are 0 or 1 slash command suggestions.
  // Footer nav is NOT here — when a pill is selected, TextInput focus=false so
  // these never fire. The Footer keybinding context handles ↑/↓ instead.
// 【↑ 键的三重让路，顺序就是优先级】
//
//      if (suggestions.length > 1) return     ← 补全列表在显示，↑ 归它
//      if (!isCursorOnFirstLine) return       ← 光标不在首行，↑ 是移动光标
//      if (有可编辑的排队命令) { 弹出并 return } ← ↑ 是把排队命令捞回来编辑
//      onHistoryUp()                          ← 以上都不是，才翻历史
//
//  这三条都是「我的默认行为可以被更高优先级的语义打断」。
//
//  第二条尤其重要，注释（第 929-931 行）解释了：多行输入时按 ↑，
//  用户要的是「光标上一行」，不是「翻历史」。只有在首行再按 ↑ 才是翻历史。
//  这是所有多行输入框的标准行为（浏览器 textarea 也一样）。
//
//  第 922-923 行的注释还说明了为什么 footer 导航不在这里：
//  **当药丸被选中时，TextInput 的 focus 是 false**（见第 2199 行），
//  它的 useInput 根本不活跃，所以这里压根收不到 ↑。footer 那边由
//  Footer 键位上下文处理。
//
//  「这个 handler 里为什么没有 X」的答案，常常在「X 发生时这段代码根本不执行」。
  function handleHistoryUp() {
    if (suggestions.length > 1) {
      return;
    }

    // Only navigate history when cursor is on the first line.
    // In multiline inputs, up arrow should move the cursor (handled by TextInput)
    // and only trigger history when at the top of the input.
    if (!isCursorOnFirstLine) {
      return;
    }

    // If there's an editable queued command, move it to the input for editing when UP is pressed
    const hasEditableCommand = queuedCommands.some(isQueuedCommandEditable);
    if (hasEditableCommand) {
      void popAllCommandsFromQueue();
      return;
    }
    onHistoryUp();
  }
  function handleHistoryDown() {
    if (suggestions.length > 1) {
      return;
    }

    // Only navigate history/footer when cursor is on the last line.
    // In multiline inputs, down arrow should move the cursor (handled by TextInput)
    // and only trigger navigation when at the bottom of the input.
    if (!isCursorOnLastLine) {
      return;
    }

    // At bottom of history → enter footer at first visible pill
// 【↓ 翻到底之后再按一下，就进入 footer —— 两个动作接在一行里】
//
//      if (onHistoryDown() && footerItems.length > 0) {
//        selectFooterItem(footerItems[0])
//      }
//
//  onHistoryDown() 的返回值含义是「历史到底了」（没东西可翻）。
//  于是这一行表达的是：**翻不动了，就把 ↓ 转交给 footer**。
//
//  这是「链式焦点」的手工实现：输入框 → footer 药丸。
//  用户的体感是按 ↓ 一路往下走，看不见有边界。
//
//  第 960-965 行还顺手记了一个「见过任务提示」的标记：
//  第一次进 footer 时把 hasSeenTasksHint 写成 true，以后就不弹「↓ 可以管理任务」的提示了。
//  写配置时用了 `c.hasSeenTasksHint ? c : {...}` —— 已经为真就返回原对象，
//  避免无意义的写盘（同 PromptInputFooterLeftSide 里那个 saveGlobalConfig 的写法）。
    if (onHistoryDown() && footerItems.length > 0) {
      const first = footerItems[0]!;
      selectFooterItem(first);
      if (first === 'tasks' && !getGlobalConfig().hasSeenTasksHint) {
        saveGlobalConfig(c => c.hasSeenTasksHint ? c : {
          ...c,
          hasSeenTasksHint: true
        });
      }
    }
  }

  // Create a suggestions state directly - we'll sync it with useTypeahead later
  const [suggestionsState, setSuggestionsStateRaw] = useState<{
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  }>({
    suggestions: [],
    selectedSuggestion: -1,
    commandArgumentHint: undefined
  });

  // Setter for suggestions state
  const setSuggestionsState = useCallback((updater: typeof suggestionsState | ((prev: typeof suggestionsState) => typeof suggestionsState)) => {
    setSuggestionsStateRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);
// 【onSubmit 是整个文件的「总闸」，第一个动作是读最新状态】
//
//      const state = store.getState()
//      if (state.footerSelection && footerItems.includes(state.footerSelection)) return
//
//  为什么不读闭包里的 footerItemSelected？注释（第 987-991 行）给了具体理由：
//  footer:openSelected 的处理是「先 selectFooterItem(null) 再 onSubmit」，
//  两步在**同一个 tick** 里发生，React 还没重渲染，闭包里的值还是旧的。
//
//  所以这里绕过 React 直接读 store。注意还复用了 includes 判断 ——
//  因为 store 里的值也可能是「选中的药丸已经消失了」的脏值，
//  派生的那套逻辑必须再跑一遍。
//
//  这是「命令式读取 + 同一判据」的组合。判据不统一就会出现：
//  UI 显示没有选中，但 submit 认为有选中，回车没反应 —— 用户完全无法理解。
//
//  第 1000 行的第二个守卫更微妙：`viewSelectionMode === 'selecting-agent'`
//  就 return，因为「选择 agent 模式」下回车是确认选择，不是提交。
//  注释说 BaseTextInput 的 useInput 注册得更早（子组件的 effect 先跑），
//  所以它那边的回车会先触发一次提交 —— 不加这个守卫就会「选中的同时把输入发出去了」。
  const onSubmit = useCallback(async (inputParam: string, isSubmittingSlashCommand = false) => {
    inputParam = inputParam.trimEnd();

    // Don't submit if a footer indicator is being opened. Read fresh from
    // store — footer:openSelected calls selectFooterItem(null) then onSubmit
    // in the same tick, and the closure value hasn't updated yet. Apply the
    // same "still visible?" derivation as footerItemSelected so a stale
    // selection (pill disappeared) doesn't swallow Enter.
    const state = store.getState();
    if (state.footerSelection && footerItems.includes(state.footerSelection)) {
      return;
    }

    // Enter in selection modes confirms selection (useBackgroundTaskNavigation).
    // BaseTextInput's useInput registers before that hook (child effects fire first),
    // so without this guard Enter would double-fire and auto-submit the suggestion.
    if (state.viewSelectionMode === 'selecting-agent') {
      return;
    }

    // Check for images early - we need this for suggestion logic below
    const hasImages = Object.values(pastedContents).some(c => c.type === 'image');

    // If input is empty OR matches the suggestion, submit it
    // But if there are images attached, don't auto-accept the suggestion -
    // the user wants to submit just the image(s).
    // Only in leader view — promptSuggestion is leader-context, not teammate.
    const suggestionText = promptSuggestionState.text;
// 【空输入按回车 = 接受 prompt 建议（但不是总是）】
//
//      inputMatchesSuggestion = 输入为空 或 输入正好等于建议文本
//      if (inputMatchesSuggestion && 有建议 && !有图片 && !正在看队友)
//
//  三个排除条件都很有道理：
//    · 有图片时不接受建议 —— 用户想「只发这张图」，不是想发建议里那段话
//    · 正在看队友时不接受 —— 建议是 leader 上下文的（生成时按 leader 的对话算的），
//      发给队友会莫名其妙
//
//  第 1015-1031 行是「推测执行」（speculation）路径：如果已经推测过这条建议的
//  回复，就直接把流式消息注入，跳过整轮 API 调用。
//  这里调 logOutcomeAtSubmission 时传了 skipReset: true，注释解释了原因：
//  正常路径会 resetSuggestion，而 reset 会 abort 掉正在进行的推测 ——
//  那就等于把自己要用的东西取消了。
//
//  第 1034 行 `promptSuggestionState.shownAt > 0` 这个条件容易被忽略：
//  建议必须**真的显示过**才允许接受。否则用户看到的是一片空白，
//  按回车却发出去一段他从没见过的文字 —— 那是最糟的体验。
    const inputMatchesSuggestion = inputParam.trim() === '' || inputParam === suggestionText;
    if (inputMatchesSuggestion && suggestionText && !hasImages && !state.viewingAgentTaskId) {
      // If speculation is active, inject messages immediately as they stream
      if (speculation.status === 'active') {
        markAccepted();
        // skipReset: resetSuggestion would abort the speculation before we accept it
        logOutcomeAtSubmission(suggestionText, {
          skipReset: true
        });
        void onSubmitProp(suggestionText, {
          setCursorOffset,
          clearBuffer,
          resetHistory
        }, {
          state: speculation,
          speculationSessionTimeSavedMs: speculationSessionTimeSavedMs,
          setAppState
        });
        return; // Skip normal query - speculation handled it
      }

      // Regular suggestion acceptance (requires shownAt > 0)
      if (promptSuggestionState.shownAt > 0) {
        markAccepted();
        inputParam = suggestionText;
      }
    }

    // Handle @name direct message
// 【@名字开头 = 直接给队友发消息，不走模型】
//
//  parseDirectMemberMessage 判断输入是不是「@某人 内容」的形式。
//  如果是，直接写进那个队友的 mailbox（文件消息队列），然后提示「已发送」。
//
//  这是一个**语法层面的分流**：同一个输入框，`@bob 帮忙看下这个` 是
//  「发给队友」，而 `@bob` 出现在句子中间就是「提及」。
//
//  三种失败处理值得学（第 1057-1062 行）：
//    · no_team_context（没有团队）→ 落到普通提交
//    · 其他错误（找不到这个人）   → 也落到普通提交
//
//  为什么不报错：因为 `@utils explain this code` 是很自然的诉求
//  （提到一个目录），不应该被「utils 不是队友」挡住。
//  所以策略是**只在确实能发的时候走捷径，其余全部退化成普通 prompt**。
//
//  这类「尽量别挡住用户」的降级设计，在输入处理里应该默认采用。
    if (isAgentSwarmsEnabled()) {
      const directMessage = parseDirectMemberMessage(inputParam);
      if (directMessage) {
        const result = await sendDirectMemberMessage(directMessage.recipientName, directMessage.message, teamContext, writeToMailbox);
        if (result.success) {
          addNotification({
            key: 'direct-message-sent',
            text: `Sent to @${result.recipientName}`,
            priority: 'immediate',
            timeoutMs: 3000
          });
          trackAndSetInput('');
          setCursorOffset(0);
          clearBuffer();
          resetHistory();
          return;
        } else if (result.error === 'no_team_context') {
          // No team context - fall through to normal prompt submission
        } else {
          // Unknown recipient - fall through to normal prompt submission
          // This allows e.g. "@utils explain this code" to be sent as a prompt
        }
      }
    }

    // Allow submission if there are images attached, even without text
// 【空输入不放行，除非有图片】
//
//  一行守卫，但它体现了「有附件就算有内容」这个规则：
//  用户粘一张图、什么都不写就回车 —— 这是合法的请求。
//
//  配合第 1005 行的 hasImages（只看 type === 'image'，不看文本粘贴）：
//  纯文本粘贴不算附件，因为文本粘贴的内容已经在输入框里了（占了位）。
//
//  注意这个判断在**建议接受之后**：所以「空输入 + 有建议 + 有图片」的情况，
//  会先跳过建议接受（前面的 !hasImages），然后在这里放行 —— 发图。
//  **守卫的顺序决定了优先级**，这段代码里每一条 return 都在排除一种组合。
    if (inputParam.trim() === '' && !hasImages) {
      return;
    }

    // PromptInput UX: Check if suggestions dropdown is showing
    // For directory suggestions, allow submission (Tab is used for completion)
// 【补全列表显示时不提交 —— 但目录补全例外】
//
//      if (suggestions.length > 0 && !isSubmittingSlashCommand && !hasDirectorySuggestions)
//        return
//
//  规则：补全列表开着时，回车是「选中这一项」，不是「提交」。
//  所以这里必须拦住，否则用户想选一个文件，结果把半截路径发出去了。
//
//  两个例外：
//    · isSubmittingSlashCommand —— 用户在命令面板里主动提交（比如按了 ctrl+enter）
//    · 全是目录建议 —— 目录补全之后用户还要继续打文件名，此时回车应该是
//      「进入/确认这个目录」而不是提交，所以放行让 TextInput 处理
//
//  第三个条件 `every(s => s.description === 'directory')` 用的是描述文字
//  当类型判据 —— 和 PromptInputFooter 里拿 status.label 当状态判据是同一个问题：
//  改文案就失效。更稳的做法是给 SuggestionItem 加个 kind 字段。
//
//  第 1075 行的 logForDebugging 也值得一提：这种「本该提交却没提交」的
//  路径最难排查，加一行日志比加十个断言有用。
    const hasDirectorySuggestions = suggestionsState.suggestions.length > 0 && suggestionsState.suggestions.every(s => s.description === 'directory');
    if (suggestionsState.suggestions.length > 0 && !isSubmittingSlashCommand && !hasDirectorySuggestions) {
      logForDebugging(`[onSubmit] early return: suggestions showing (count=${suggestionsState.suggestions.length})`);
      return; // Don't submit, user needs to clear suggestions first
    }

    // Log suggestion outcome if one exists
    if (promptSuggestionState.text && promptSuggestionState.shownAt > 0) {
      logOutcomeAtSubmission(inputParam);
    }

    // Clear stash hint notification on submit
    removeNotification('stash-hint');

    // Route input to viewed agent (in-process teammate or named local_agent).
// 【输入要发给谁：leader 还是当前正在看的 agent】
//
//      const activeAgent = getActiveAgentForInput(store.getState())
//      if (activeAgent.type !== 'leader' && onAgentSubmit) { … onAgentSubmit(…) ; return }
//
//  这是一个「路由」而不是「分支」：同样的文本、同样的回车，
//  根据「你在看谁的会话」决定送去哪个模型。
//
//  注意两个细节：
//    · 用 store.getState() 而不是闭包里的 viewingAgentTaskId —— 同 onSubmit
//      开头的理由（同一 tick 内的选中变更还没反映到渲染）
//    · onAgentSubmit 是可选的，所以条件是「不是 leader **且** 有这个回调」；
//      没有回调就退化成普通提交（而不是丢掉输入）
//
//  helpers 里传的 setCursorOffset / clearBuffer / resetHistory 是**清场三件套**：
//  提交后必须清空输入、清空撤销缓冲、重置历史游标。任何一处漏掉都会让
//  下一次 ↑ 键翻到错的记录。
    const activeAgent = getActiveAgentForInput(store.getState());
    if (activeAgent.type !== 'leader' && onAgentSubmit) {
      logEvent('tengu_transcript_input_to_teammate', {});
      await onAgentSubmit(inputParam, activeAgent.task, {
        setCursorOffset,
        clearBuffer,
        resetHistory
      });
      return;
    }

    // Normal leader submission
    await onSubmitProp(inputParam, {
      setCursorOffset,
      clearBuffer,
      resetHistory
    });
  }, [promptSuggestionState, speculation, speculationSessionTimeSavedMs, teamContext, store, footerItems, suggestionsState.suggestions, onSubmitProp, onAgentSubmit, clearBuffer, resetHistory, logOutcomeAtSubmission, setAppState, markAccepted, pastedContents, removeNotification]);
  const {
    suggestions,
    selectedSuggestion,
    commandArgumentHint,
    inlineGhostText,
    maxColumnWidth
  } = useTypeahead({
    commands,
    onInputChange: trackAndSetInput,
    onSubmit,
    setCursorOffset,
    input,
    cursorOffset,
    mode,
    agents,
    setSuggestionsState,
    suggestionsState,
    suppressSuggestions: isSearchingHistory || historyIndex > 0,
    markAccepted,
    onModeChange
  });

  // Track if prompt suggestion should be shown (computed later with terminal width).
  // Hidden in teammate view — suggestion is leader-context only.
// 【showPromptSuggestion 算在渲染期，markShown 也在渲染期调】
//
//  `if (showPromptSuggestion) markShown()` —— 这一句在渲染期间执行副作用。
//
//  为什么能这么写：markShown 大概率只是写一个「已展示」的时间戳，
//  幂等、不触发重渲染（或者触发但很快稳定）。如果它会 setState，
//  在渲染期调用会造成「渲染 → setState → 再渲染」的循环。
//
//  这是个需要谨慎对待的写法 —— 它依赖被调用函数的实现细节。
//  更安全的做法是放进 useEffect，代价是多一帧延迟（第一帧 UI 上建议已显示，
//  但统计上还没记）。
//
//  条件本身值得看：mode === 'prompt' 且 没有补全列表 且 有建议 且 不在看队友。
//  四个都要满足 —— **建议是「最弱的信息」，任何其他 UI 都能压过它**。
  const showPromptSuggestion = mode === 'prompt' && suggestions.length === 0 && promptSuggestion && !viewingAgentTaskId;
  if (showPromptSuggestion) {
    markShown();
  }

  // If suggestion was generated but can't be shown due to timing, log suppression.
  // Exclude teammate view: markShown() is gated above, so shownAt stays 0 there —
  // but that's not a timing failure, the suggestion is valid when returning to leader.
// 【「生成了但显示不出来」要记一笔，然后清掉】
//
//  条件：状态里有建议文本，但 promptSuggestion 为空，且 shownAt 还是 0。
//  意思是：建议对象生成了，但从没被 markShown 过 —— 说明它一直没能显示。
//
//  这是「埋点用于诊断」的典型：一行 logSuggestionSuppressed('timing', …)
//  能告诉你「建议功能是不是真的在起作用」。没有这个埋点，
//  产品侧只能看到「建议接受率低」，却不知道原因是「压根没显示」。
//
//  然后第 1140-1149 行把状态清空。注意它 setAppState 时没做「是否已经为空」的
//  判断（其它地方都会写 `prev.x === y ? prev : {...}`）—— 所以这段代码
//  只要条件成立，每次渲染都会 setAppState 一次。因为清空后 shownAt 变 0、
//  text 变 null，下次渲染条件就不成立了，所以实际上只会跑一次。
//  但这种「靠状态变化自然收敛」的写法，比显式判等脆一些。
  if (promptSuggestionState.text && !promptSuggestion && promptSuggestionState.shownAt === 0 && !viewingAgentTaskId) {
    logSuggestionSuppressed('timing', promptSuggestionState.text);
    setAppState(prev => ({
      ...prev,
      promptSuggestion: {
        text: null,
        promptId: null,
        shownAt: 0,
        acceptedAt: 0,
        generationRequestId: null
      }
    }));
  }
// 【图片粘贴：同步缓存路径、异步落盘】
//
//      cacheImagePath(newContent)   ← 同步，立即生效
//      void storeImage(newContent)  ← 异步，不等待
//
//  为什么要分两步：cacheImagePath 建立「id → 本地路径」的映射，
//  让下一帧渲染时就能显示图片链接（终端里显示成路径或链接）。
//  而真正把 base64 写到磁盘是慢操作，不需要阻塞渲染。
//
//  `void` 前缀是显式声明「我知道这个 Promise 没人等」——
//  比裸调用更能表达意图（并让 lint 闭嘴）。代价是**失败被静默吞掉**：
//  如果磁盘写失败，界面上有链接但文件不存在。这类「乐观更新」必须
//  有兜底（比如提交时检查文件存在），否则用户会看到一个点不开的链接。
//
//  第 1180-1182 行的 lazy space 逻辑针对多图粘贴：连续粘两张图时，
//  第一张的「待补空格」要在第二张之前兑现，否则空格会丢。
//  所以 prefix 取自上一次的标记，处理完再重新置 true。
  function onImagePaste(image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) {
    logEvent('tengu_paste_image', {});
    onModeChange('prompt');
    const pasteId = nextPasteIdRef.current++;
    const newContent: PastedContent = {
      id: pasteId,
      type: 'image',
      content: image,
      mediaType: mediaType || 'image/png',
      // default to PNG if not provided
      filename: filename || 'Pasted image',
      dimensions,
      sourcePath
    };

    // Cache path immediately (fast) so links work on render
    cacheImagePath(newContent);

    // Store image to disk in background
    void storeImage(newContent);

    // Update UI
    setPastedContents(prev => ({
      ...prev,
      [pasteId]: newContent
    }));
    // Multi-image paste calls onImagePaste in a loop. If the ref is already
    // armed, the previous pill's lazy space fires now (before this pill)
    // rather than being lost.
    const prefix = pendingSpaceAfterPillRef.current ? ' ' : '';
    insertTextAtCursor(prefix + formatImageRef(pasteId));
    pendingSpaceAfterPillRef.current = true;
  }

  // Prune images whose [Image #N] placeholder is no longer in the input text.
  // Covers pill backspace, Ctrl+U, char-by-char deletion — any edit that drops
  // the ref. onImagePaste batches setPastedContents + insertTextAtCursor in the
  // same event, so this effect sees the placeholder already present.
// 【孤儿图片清理：文字里没有引用了，附件就该删】
//
//  用户可能用三种方式删掉 `[Image #1]`：
//    · 退格（删整个 chip，光标在 start 时）
//    · ctrl+u（清空整行）
//    · 逐字符删除（如果能删到的话）
//
//  这三种都会让 pastedContents 里留下一条没人引用的图片 —— 它占内存、
//  而且提交时会跟着发出去（因为提交逻辑是遍历 pastedContents）。
//  所以要有一个 effect 定期对账：**文本里引用了哪些 id，就保留哪些**。
//
//  第 1193 行 `if (orphaned.length === 0) return prev` 是关键：
//  没有孤儿就返回同一个对象，避免每敲一个字都触发一次状态更新。
//  这个 early return 让这个 effect 在 99% 的渲染里是零成本的。
//
//  注释（第 1186-1188 行）还解释了为什么这个 effect 不会误删：
//  onImagePaste 里 setPastedContents 和 insertTextAtCursor 是同一个事件里的
//  两次状态写入，React 批处理之后一起提交，所以这个 effect 看到的时候
//  占位符已经在文本里了。
//
//  **依赖顺序敏感的 effect，必须证明「两个状态总是同时到位」。**
  useEffect(() => {
    const referencedIds = new Set(parseReferences(input).map(r => r.id));
    setPastedContents(prev => {
      const orphaned = Object.values(prev).filter(c => c.type === 'image' && !referencedIds.has(c.id));
      if (orphaned.length === 0) return prev;
      const next = {
        ...prev
      };
      for (const img of orphaned) delete next[img.id];
      return next;
    });
  }, [input, setPastedContents]);
// 【粘贴文本的三道清洗，每一道都对应一种现实问题】
//
//      stripAnsi(rawText)              去 ANSI 转义序列
//        .replace(CR, LF)              回车换行 → 单个换行
//        .replaceAll(Tab, 4 空格)      Tab → 4 空格
//
//  第一道：从浏览器/终端复制带颜色的输出时，会夹带 ESC[...m 这类序列。
//  不清掉的话，输入框里会显示一堆乱码，而且光标宽度全错。
//
//  第二道：Windows 换行是 CR+LF，Mac 老式是 CR。统一成 LF，
//  否则 getPastedTextRefNumLines 数出来的行数会翻倍。
//
//  第三道：同上面的 onChange，Tab 宽度不可预测。
//
//  第 1207-1213 行还有一段「粘贴 ! 开头的内容自动进 bash 模式」：
//  只在整个输入为空时生效。这和手打 ! 的行为保持一致 —— **粘贴和手打
//  应该走同一套规则**，否则用户会觉得「粘贴的东西不受控制」。
//
//  这类「统一入口」的设计很重要：如果只处理按键、不处理粘贴，
//  会出现一堆「只有粘贴才复现」的 bug。
  function onTextPaste(rawText: string) {
    pendingSpaceAfterPillRef.current = false;
    // Clean up pasted text - strip ANSI escape codes and normalize line endings and tabs
    let text = stripAnsi(rawText).replace(/\r/g, '\n').replaceAll('\t', '    ');

    // Match typed/auto-suggest: `!cmd` pasted into empty input enters bash mode.
    if (input.length === 0) {
      const pastedMode = getModeFromInput(text);
      if (pastedMode !== 'prompt') {
        onModeChange(pastedMode);
        text = getValueFromInput(text);
      }
    }
    const numLines = getPastedTextRefNumLines(text);
    // Limit the number of lines to show in the input
    // If the overall layout is too high then Ink will repaint
    // the entire terminal.
    // The actual required height is dependent on the content, this
    // is just an estimate.
// 【`maxLines = Math.min(rows - 10, 2)` —— 上限永远是 2 行】
//
//  这行值得停一下：Math.min(rows - 10, 2) 在 rows > 12 时恒等于 2。
//  也就是说**粘贴的文本最多在输入框里展开 2 行**，超过就折叠成占位符。
//
//  注释（第 1216-1219 行）给了理由，而且是终端特有的：
//  「如果整体布局太高，Ink 会重绘整个终端」。终端没有局部更新，
//  一次全屏重绘在慢速连接（SSH、tmux）上就是肉眼可见的闪烁。
//
//  所以这里宁可激进地折叠，也不让输入框长高。Math.min(rows-10, 2) 里
//  那个 rows-10 只在**极小窗口**（rows < 12）时才生效 —— 那时连 2 行都放不下。
//
//  对比 onImagePaste 的插入逻辑：图片只插一个短占位符，从不展开。
//  两条路径的策略一致：**长内容一律折叠，绝不撑高输入框。**
    const maxLines = Math.min(rows - 10, 2);

    // Use special handling for long pasted text (>PASTE_THRESHOLD chars)
    // or if it exceeds the number of lines we want to show
    if (text.length > PASTE_THRESHOLD || numLines > maxLines) {
      const pasteId = nextPasteIdRef.current++;
      const newContent: PastedContent = {
        id: pasteId,
        type: 'text',
        content: text
      };
      setPastedContents(prev => ({
        ...prev,
        [pasteId]: newContent
      }));
      insertTextAtCursor(formatPastedTextRef(pasteId, numLines));
    } else {
      // For shorter pastes, just insert the text normally
      insertTextAtCursor(text);
    }
  }
// 【inputFilter：TextInput 提供的「输入前置管道」】
//
//  签名是 (input, key) => string —— 拿到这次要插入的文本，返回处理后的文本。
//  用它实现 lazy space，比在 onChange 里判断更好，因为：
//
//    · onChange 只能看到「变化后的整体文本」，无法区分「是打字还是方向键」
//    · inputFilter 能看到原始按键（key 对象），所以能判断「这是可打印字符吗」
//
//  实现只有四行：没武装就原样返回；武装了就解除，然后看是不是可打印字符，
//  是就补一个空格。
//
//  注意**解除武装发生在判断之前**：所以任何一次按键都会消耗掉这个标记，
//  不管它是不是可打印的。这保证了「最多补一个空格」。
//
//  第 1244 行调用 isNonSpacePrintable（同目录 utils.ts），
//  那个函数有 16 个修饰键的排除清单 —— 整条 lazy space 逻辑的正确性
//  最后落在那张清单上。
  const lazySpaceInputFilter = useCallback((input: string, key: Key): string => {
    if (!pendingSpaceAfterPillRef.current) return input;
    pendingSpaceAfterPillRef.current = false;
    if (isNonSpacePrintable(input, key)) return ' ' + input;
    return input;
  }, []);
  function insertTextAtCursor(text: string) {
    // Push current state to buffer before inserting
    pushToBuffer(input, cursorOffset, pastedContents);
    const newInput = input.slice(0, cursorOffset) + text + input.slice(cursorOffset);
    trackAndSetInput(newInput);
    setCursorOffset(cursorOffset + text.length);
  }
// 【useDoublePress：第一次按什么也不做，第二次才执行】
//
//      useDoublePress(() => {}, () => onShowMessageSelector())
//
//  第一个参数是「第一次按」（空操作），第二个是「第二次按」。
//  这么设计是因为第一次按必须**吞掉**这个键 —— 如果不吞，
//  它就会落到别的处理器上（比如清空输入）。
//
//  「双击才生效」的键在终端里很常见（esc esc 清空输入、esc esc 打开历史），
//  因为 esc 单按有太多含义。代价是单按 esc 会有一小段「等待第二次」的延迟感，
//  所以 useDoublePress 内部一定有个超时窗口（通常在 500ms 左右）。
//
//  第 1954 行的调用条件也值得看：
//
//      if (messages.length > 0 && !input && !isLoading) doublePressEscFromEmpty()
//
//  三个条件：有消息（没消息时没什么可选的）、输入为空（有内容时 esc 是清空）、
//  没在加载（加载时 esc 是取消请求）。**同一个键在不同上下文里有五种含义**，
//  这里是第五种。
  const doublePressEscFromEmpty = useDoublePress(() => {}, () => onShowMessageSelector());

  // Function to get the queued command for editing. Returns true if commands were popped.
// 【从队列里捞回命令：文本 + 模式 + 光标 + 图片，一样都不能少】
//
//  popAllEditable(input, cursorOffset) 返回的是 result.text / result.cursorOffset /
//  result.images —— 注意它连**图片**都存了。
//
//  为什么：排队时用户可能排了「一张图 + 一段话」。捞回来的时候，
//  文本重新放进输入框、图片要重新登记进 pastedContents
//  （第 1267-1277 行）。漏掉图片恢复，用户会看到 `[Image #2]` 这个占位符，
//  但那张图已经不在附件表里了 —— 提交时占位符解析不出内容。
//
//  第 1263 行 `onModeChange('prompt')` 是硬编码的：捞回来的命令一律进 prompt 模式，
//  哪怕它原本是 bash 命令。因为此刻用户是在**编辑**这条待发消息，
//  编辑完再按回车，走的是普通提交路径。
//
//  这个函数被两处调用：↑ 键（第 939 行）和 esc 键（第 1951 行）。
//  两处的语义略有不同（↑ 是「往上翻到待发消息」，esc 是「取消排队并编辑」），
//  但实现完全一样 —— 因为在用户看来这两件事都是「把它拿回来」。
  const popAllCommandsFromQueue = useCallback((): boolean => {
    const result = popAllEditable(input, cursorOffset);
    if (!result) {
      return false;
    }
    trackAndSetInput(result.text);
    onModeChange('prompt'); // Always prompt mode for queued commands
    setCursorOffset(result.cursorOffset);

    // Restore images from queued commands to pastedContents
    if (result.images.length > 0) {
      setPastedContents(prev => {
        const newContents = {
          ...prev
        };
        for (const image of result.images) {
          newContents[image.id] = image;
        }
        return newContents;
      });
    }
    return true;
  }, [trackAndSetInput, onModeChange, input, cursorOffset, setPastedContents]);

  // Insert the at-mentioned reference (the file and, optionally, a line range) when
  // we receive an at-mentioned notification the IDE.
// 【IDE 里点「@ 这个文件」，文本会带一段行号范围】
//
//      @path/to/file.ts#L10-20      ← 行范围
//      @path/to/file.ts#L10          ← 单行
//      @path/to/file.ts              ← 整个文件
//
//  三个分支对应三种粒度。注意 path.relative(getCwd(), filePath) 用的是
//  **相对路径**：绝对路径在 prompt 里既长又泄露本机目录结构。
//
//  第 1292-1295 行有一个很细的处理：看光标前一个字符是不是空白，
//  不是就先补一个空格。因为 IDE 注入时用户的光标可能贴在某个词后面
//  （`看看这个函数|`），不补空格就变成 `看看这个函数@src/a.ts`，
//  粘在一起会解析不出引用。
//
//  同一个「补空格」问题在这个文件里出现了三次：
//    · onImagePaste 的 lazy space（延迟到下一个键）
//    · 这里的即时判断（看光标前一个字符）
//    · QuickOpen 的 insertWithSpacing（第 2134 行）
//  三种实现说明它们出现的时机不同，无法统一 —— 但**规则是同一个：
//  引用类文本前后必须有空白**。
  const onIdeAtMentioned = function (atMentioned: IDEAtMentioned) {
    logEvent('tengu_ext_at_mentioned', {});
    let atMentionedText: string;
    const relativePath = path.relative(getCwd(), atMentioned.filePath);
    if (atMentioned.lineStart && atMentioned.lineEnd) {
      atMentionedText = atMentioned.lineStart === atMentioned.lineEnd ? `@${relativePath}#L${atMentioned.lineStart} ` : `@${relativePath}#L${atMentioned.lineStart}-${atMentioned.lineEnd} `;
    } else {
      atMentionedText = `@${relativePath} `;
    }
    const cursorChar = input[cursorOffset - 1] ?? ' ';
    if (!/\s/.test(cursorChar)) {
      atMentionedText = ` ${atMentionedText}`;
    }
    insertTextAtCursor(atMentionedText);
  };
  useIdeAtMentioned(mcpClients, onIdeAtMentioned);

  // Handler for chat:undo - undo last edit
// 【撤销：五样东西要一起回滚】
//
//      trackAndSetInput(text) / setCursorOffset / setPastedContents
//
//  只有前两个的话，撤销一张图片会导致文本回来了、附件表没有 ——
//  占位符解析不出来。所以 useInputBuffer 存的是完整的快照
//  （text + cursorOffset + pastedContents），撤销就是整体替换。
//
//  第 1302 行 `if (canUndo)` 是多余的兜底：undo() 内部一定也会判。
//  这类「双保险」在关键路径上可以接受，但它会让「为什么按了没反应」
//  更难排查（因为有两处可能拦住）。
//
//  注意这个 handler 和下面十几个 handler 一样，都用 useCallback 包了，
//  依赖里把用到的每个值都列了出来 —— 因为它们是给键位系统注册的，
//  引用不稳定会导致每帧重新注册。
  const handleUndo = useCallback(() => {
    if (canUndo) {
      const previousState = undo();
      if (previousState) {
        trackAndSetInput(previousState.text);
        setCursorOffset(previousState.cursorOffset);
        setPastedContents(previousState.pastedContents);
      }
    }
  }, [canUndo, undo, trackAndSetInput, setPastedContents]);

  // Handler for chat:newline - insert a newline at the cursor position
  const handleNewline = useCallback(() => {
    pushToBuffer(input, cursorOffset, pastedContents);
    const newInput = input.slice(0, cursorOffset) + '\n' + input.slice(cursorOffset);
    trackAndSetInput(newInput);
    setCursorOffset(cursorOffset + 1);
  }, [input, cursorOffset, trackAndSetInput, setCursorOffset, pushToBuffer, pastedContents]);

  // Handler for chat:externalEditor - edit in $EDITOR
// 【外部编辑器：整个输入框被替换成一行提示】
//
//  流程：setIsExternalEditorActive(true) → 打开 $EDITOR → 等它关闭 →
//  读回内容 → 有变化就替换输入 → setIsExternalEditorActive(false)。
//
//  第 2236 行的 `if (isExternalEditorActive) return <提示行>` 是这个状态的用处：
//  编辑器接管终端的时候，我们的 UI 不能继续画（否则会和 vim 抢屏幕）。
//  所以整个输入框变成一个占位提示「Save and close editor to continue…」。
//
//  三个细节：
//    · 传了 pastedContents，因为编辑器里要**展开**折叠的粘贴内容
//      （用户编辑的是真文本，不是 `[...Pasted text #1 +50 lines]`）
//    · 内容没变就不替换（`result.content !== input`），避免无意义地清掉撤销栈
//    · try/catch/finally：finally 里一定复位状态，否则编辑器崩了之后
//      输入框会永远卡在「提示行」状态，整个应用不能输入 —— 这是最严重的失败模式
//
//  **凡是「切换到外部程序」的操作，必须保证异常路径也能恢复本地状态。**
  const handleExternalEditor = useCallback(async () => {
    logEvent('tengu_external_editor_used', {});
    setIsExternalEditorActive(true);
    try {
      // Pass pastedContents to expand collapsed text references
      const result = await editPromptInEditor(input, pastedContents);
      if (result.error) {
        addNotification({
          key: 'external-editor-error',
          text: result.error,
          color: 'warning',
          priority: 'high'
        });
      }
      if (result.content !== null && result.content !== input) {
        // Push current state to buffer before making changes
        pushToBuffer(input, cursorOffset, pastedContents);
        trackAndSetInput(result.content);
        setCursorOffset(result.content.length);
      }
    } catch (err) {
      if (err instanceof Error) {
        logError(err);
      }
      addNotification({
        key: 'external-editor-error',
        text: `External editor failed: ${errorMessage(err)}`,
        color: 'warning',
        priority: 'high'
      });
    } finally {
      setIsExternalEditorActive(false);
    }
  }, [input, cursorOffset, pastedContents, pushToBuffer, trackAndSetInput, addNotification]);

  // Handler for chat:stash - stash/unstash prompt
// 【草稿暂存：一个键做两件事，取决于输入是否为空】
//
//    输入为空 + 有草稿  → 取出草稿（pop）
//    输入非空          → 存草稿并清空输入（push）
//    其他              → 什么都不做
//
//  这是个很省按键的设计（一个键切换两个方向），但有个隐含约束：
//  **不能暂存空草稿**。否则用户连按两次 ctrl+s，第一次存、第二次取，
//  看起来像「没反应」。
//
//  第 1358 行 `input.trim() === ''` 用的是 trim：全是空格的输入也算空。
//  这很重要 —— 用户按了一堆空格再按 ctrl+s，期望的是取出草稿，而不是
//  把一堆空格存进去。
//
//  第 1375-1381 行顺手记了 hasUsedStash，用来停止显示「ctrl+s 可以存草稿」的提示。
//  注意它用的是「已经为真就返回原对象」的写法，避免重复写盘。
//
//  存的内容有三样：text / cursorOffset / pastedContents。
//  和撤销快照完全一样 —— 因为它们本质是同一件事：**完整状态快照**。
  const handleStash = useCallback(() => {
    if (input.trim() === '' && stashedPrompt !== undefined) {
      // Pop stash when input is empty
      trackAndSetInput(stashedPrompt.text);
      setCursorOffset(stashedPrompt.cursorOffset);
      setPastedContents(stashedPrompt.pastedContents);
      setStashedPrompt(undefined);
    } else if (input.trim() !== '') {
      // Push to stash (save text, cursor position, and pasted contents)
      setStashedPrompt({
        text: input,
        cursorOffset,
        pastedContents
      });
      trackAndSetInput('');
      setCursorOffset(0);
      setPastedContents({});
      // Track usage for /discover and stop showing hint
      saveGlobalConfig(c => {
        if (c.hasUsedStash) return c;
        return {
          ...c,
          hasUsedStash: true
        };
      });
    }
  }, [input, cursorOffset, stashedPrompt, trackAndSetInput, setStashedPrompt, pastedContents, setPastedContents]);

  // Handler for chat:modelPicker - toggle model picker
  const handleModelPicker = useCallback(() => {
    setShowModelPicker(prev => !prev);
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [helpOpen]);

  // Handler for chat:fastMode - toggle fast mode picker
  const handleFastModePicker = useCallback(() => {
    setShowFastModePicker(prev => !prev);
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [helpOpen]);

  // Handler for chat:thinkingToggle - toggle thinking mode
  const handleThinkingToggle = useCallback(() => {
    setShowThinkingToggle(prev => !prev);
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [helpOpen]);

  // Handler for chat:cycleMode - cycle through permission modes
// 【handleCycleMode：全文件最复杂的 handler，因为它要处理「第一次进 auto」】
//
//  正常情况（第 1450 行以后）：算下一个模式 → cyclePermissionMode 应用副作用
//  → setAppState → setToolPermissionContext → 同步给配置文件。
//
//  特殊情况（第 1457-1493 行）：用户第一次进入 auto 模式。这时不能直接应用，
//  因为 auto 模式意味着「模型自己判断权限」，必须先给用户看一段说明并让他同意。
//  所以：
//
//    1. 只改 UI 上的模式标签（让用户看到「auto on」），**不调用任何副作用函数**
//    2. 400ms 后弹出同意对话框
//    3. 用户点同意 → 才调 transitionPermissionMode（真正激活分类器、剥离危险权限）
//    4. 用户点拒绝 → 回滚模式，并把 auto 从模式轮盘里摘掉（本次会话）
//
//  第 1484 行那个 setTimeout 有两个额外参数（setShowAutoModeOptIn 和 ref）：
//  因为回调在 400ms 后执行，那时渲染闭包已经过期，所以把 setter 和 ref
//  **显式传进去**，回调里就能安全地置空 ref。
//
//  为什么要 400ms 延迟：立刻弹窗会让 shift+tab 的连续按（用户可能连按两次
//  跳过 auto）变成「弹窗闪一下就消失」。延迟给了「继续按」一个机会。
//
//  这也解释了第 1495-1513 行那段看起来奇怪的逻辑：如果用户在 400ms 内
//  又按了一次 shift+tab，视为「不想进 auto」，于是取消弹窗、继续轮盘。
//  **连续按键被解释成「跳过」** —— 这是模态切换延迟的常见副产品。
  const handleCycleMode = useCallback(() => {
    // When viewing a teammate, cycle their mode instead of the leader's
    if (isAgentSwarmsEnabled() && viewedTeammate && viewingAgentTaskId) {
      const teammateContext: ToolPermissionContext = {
        ...toolPermissionContext,
        mode: viewedTeammate.permissionMode
      };
      // Pass undefined for teamContext (unused but kept for API compatibility)
      const nextMode = getNextPermissionMode(teammateContext, undefined);
      logEvent('tengu_mode_cycle', {
        to: nextMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const teammateTaskId = viewingAgentTaskId;
      setAppState(prev => {
        const task = prev.tasks[teammateTaskId];
        if (!task || task.type !== 'in_process_teammate') {
          return prev;
        }
        if (task.permissionMode === nextMode) {
          return prev;
        }
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [teammateTaskId]: {
              ...task,
              permissionMode: nextMode
            }
          }
        };
      });
      if (helpOpen) {
        setHelpOpen(false);
      }
      return;
    }

    // Compute the next mode without triggering side effects first
    logForDebugging(`[auto-mode] handleCycleMode: currentMode=${toolPermissionContext.mode} isAutoModeAvailable=${toolPermissionContext.isAutoModeAvailable} showAutoModeOptIn=${showAutoModeOptIn} timeoutPending=${!!autoModeOptInTimeoutRef.current}`);
    const nextMode = getNextPermissionMode(toolPermissionContext, teamContext);

    // Check if user is entering auto mode for the first time. Gated on the
    // persistent settings flag (hasAutoModeOptIn) rather than the broader
    // hasAutoModeOptInAnySource so that --enable-auto-mode users still see
    // the warning dialog once — the CLI flag should grant carousel access,
    // not bypass the safety text.
    let isEnteringAutoModeFirstTime = false;
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      isEnteringAutoModeFirstTime = nextMode === 'auto' && toolPermissionContext.mode !== 'auto' && !hasAutoModeOptIn() && !viewingAgentTaskId; // Only show for primary agent, not subagents
    }
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (isEnteringAutoModeFirstTime) {
        // Store previous mode so we can revert if user declines
        setPreviousModeBeforeAuto(toolPermissionContext.mode);

        // Only update the UI mode label — do NOT call transitionPermissionMode
        // or cyclePermissionMode yet; we haven't confirmed with the user.
        setAppState(prev => ({
          ...prev,
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            mode: 'auto'
          }
        }));
        setToolPermissionContext({
          ...toolPermissionContext,
          mode: 'auto'
        });

        // Show opt-in dialog after 400ms debounce
        if (autoModeOptInTimeoutRef.current) {
          clearTimeout(autoModeOptInTimeoutRef.current);
        }
        autoModeOptInTimeoutRef.current = setTimeout((setShowAutoModeOptIn, autoModeOptInTimeoutRef) => {
          setShowAutoModeOptIn(true);
          autoModeOptInTimeoutRef.current = null;
        }, 400, setShowAutoModeOptIn, autoModeOptInTimeoutRef);
        if (helpOpen) {
          setHelpOpen(false);
        }
        return;
      }
    }

// 【「shift+tab 不代表拒绝」—— 这段注释解释了为什么不能回滚】
//
//  注释原文的意思是：用户在 auto 模式（弹窗还没弹或已弹）时又按了 shift+tab，
//  这时**不能**把模式回滚到 previousModeBeforeAuto。
//
//  为什么：因为 shift+tab 的语义是「在轮盘上前进一格」。如果回滚到上一个模式，
//  那么「上一个模式的下一个模式」又是 auto —— 用户会陷入 auto ↔ 上一个模式
//  的来回弹跳，永远出不去。
//
//  这个推理很值得记：**回滚类逻辑必须检查「回滚后的默认下一步会不会回来」**。
//
//  所以这里只是清掉弹窗状态（第 1505-1510 行），让流程继续往下走到
//  cyclePermissionMode —— 那时当前模式已经是 auto，它的下一个是 default，
//  于是用户成功离开 auto。
//
//  真正的回滚只发生在弹窗的「拒绝」按钮里（handleAutoModeOptInDecline）——
//  那是用户明确表达「我不要」，和 shift+tab 的「我要下一个」是两回事。
    // Dismiss auto mode opt-in dialog if showing or pending (user is cycling away).
    // Do NOT revert to previousModeBeforeAuto here — shift+tab means "advance the
    // carousel", not "decline". Reverting causes a ping-pong loop: auto reverts to
    // the prior mode, whose next mode is auto again, forever.
    // The dialog's own decline button (handleAutoModeOptInDecline) handles revert.
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (showAutoModeOptIn || autoModeOptInTimeoutRef.current) {
        if (showAutoModeOptIn) {
          logEvent('tengu_auto_mode_opt_in_dialog_decline', {});
        }
        setShowAutoModeOptIn(false);
        if (autoModeOptInTimeoutRef.current) {
          clearTimeout(autoModeOptInTimeoutRef.current);
          autoModeOptInTimeoutRef.current = null;
        }
        setPreviousModeBeforeAuto(null);
        // Fall through — mode is 'auto', cyclePermissionMode below goes to 'default'.
      }
    }

    // Now that we know this is NOT the first-time auto mode path,
    // call cyclePermissionMode to apply side effects (e.g. strip
    // dangerous permissions, activate classifier)
    const {
      context: preparedContext
    } = cyclePermissionMode(toolPermissionContext, teamContext);
    logEvent('tengu_mode_cycle', {
      to: nextMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });

    // Track when user enters plan mode
    if (nextMode === 'plan') {
      saveGlobalConfig(current => ({
        ...current,
        lastPlanModeUse: Date.now()
      }));
    }

    // Set the mode via setAppState directly because setToolPermissionContext
    // intentionally preserves the existing mode (to prevent coordinator mode
    // corruption from workers). Then call setToolPermissionContext to trigger
    // recheck of queued permission prompts.
// 【为什么既要 setAppState 又要 setToolPermissionContext】
//
//  注释（第 1533-1536 行）说得很直接：setToolPermissionContext **故意不接收
//  mode**（它内部会保留现有 mode），目的是防止「协调者模式的 mode 被 worker
//  覆盖」这种数据损坏。
//
//  所以想真正改模式，必须绕过它直接写 AppState。但又要调它一次 ——
//  因为它的副作用是「重新检查排队中的权限请求」（那些请求是带着旧模式排的）。
//
//  于是就有了这个看起来重复的双写：
//
//      setAppState(prev => ({...prev, toolPermissionContext: {...preparedContext, mode: nextMode}}))
//      setToolPermissionContext({...preparedContext, mode: nextMode})
//
//  两份状态，同一个值。**这是历史修复留下的结构性重复** ——
//  正确的解法是让 setToolPermissionContext 支持改 mode 并自己防住 worker 覆盖，
//  但那需要改调用方。这类「防御性 API 逼出的双写」在长期项目里很常见。
//
//  第 1550 行的 syncTeammateMode 是第三处写入：teammate 进程要把模式写进
//  共享的 config.json，否则 leader 看不到它切了模式。
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: {
        ...preparedContext,
        mode: nextMode
      }
    }));
    setToolPermissionContext({
      ...preparedContext,
      mode: nextMode
    });

    // If this is a teammate, update config.json so team lead sees the change
    syncTeammateMode(nextMode, teamContext?.teamName);

    // Close help tips if they're open when mode is cycled
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [toolPermissionContext, teamContext, viewingAgentTaskId, viewedTeammate, setAppState, setToolPermissionContext, helpOpen, showAutoModeOptIn]);

  // Handler for auto mode opt-in dialog acceptance
  const handleAutoModeOptInAccept = useCallback(() => {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      setShowAutoModeOptIn(false);
      setPreviousModeBeforeAuto(null);

      // Now that the user accepted, apply the full transition: activate the
      // auto mode backend (classifier, beta headers) and strip dangerous
      // permissions (e.g. Bash(*) always-allow rules).
      const strippedContext = transitionPermissionMode(previousModeBeforeAuto ?? toolPermissionContext.mode, 'auto', toolPermissionContext);
      setAppState(prev => ({
        ...prev,
        toolPermissionContext: {
          ...strippedContext,
          mode: 'auto'
        }
      }));
      setToolPermissionContext({
        ...strippedContext,
        mode: 'auto'
      });

      // Close help tips if they're open when auto mode is enabled
      if (helpOpen) {
        setHelpOpen(false);
      }
    }
  }, [helpOpen, setHelpOpen, previousModeBeforeAuto, toolPermissionContext, setAppState, setToolPermissionContext]);

  // Handler for auto mode opt-in dialog decline
  const handleAutoModeOptInDecline = useCallback(() => {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      logForDebugging(`[auto-mode] handleAutoModeOptInDecline: reverting to ${previousModeBeforeAuto}, setting isAutoModeAvailable=false`);
      setShowAutoModeOptIn(false);
      if (autoModeOptInTimeoutRef.current) {
        clearTimeout(autoModeOptInTimeoutRef.current);
        autoModeOptInTimeoutRef.current = null;
      }

      // Revert to previous mode and remove auto from the carousel
      // for the rest of this session
      if (previousModeBeforeAuto) {
        setAutoModeActive(false);
        setAppState(prev => ({
          ...prev,
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            mode: previousModeBeforeAuto,
            isAutoModeAvailable: false
          }
        }));
        setToolPermissionContext({
          ...toolPermissionContext,
          mode: previousModeBeforeAuto,
          isAutoModeAvailable: false
        });
        setPreviousModeBeforeAuto(null);
      }
    }
  }, [previousModeBeforeAuto, toolPermissionContext, setAppState, setToolPermissionContext]);

  // Handler for chat:imagePaste - paste image from clipboard
  const handleImagePaste = useCallback(() => {
    void getImageFromClipboard().then(imageData => {
      if (imageData) {
        onImagePaste(imageData.base64, imageData.mediaType);
      } else {
        const shortcutDisplay = getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v');
        const message = env.isSSH() ? "No image found in clipboard. You're SSH'd; try scp?" : `No image found in clipboard. Use ${shortcutDisplay} to paste images.`;
        addNotification({
          key: 'no-image-in-clipboard',
          text: message,
          priority: 'immediate',
          timeoutMs: 1000
        });
      }
    });
  }, [addNotification, onImagePaste]);

  // Register chat:submit handler directly in the handler registry (not via
  // useKeybindings) so that only the ChordInterceptor can invoke it for chord
  // completions (e.g., "ctrl+e s"). The default Enter binding for submit is
  // handled by TextInput directly (via onSubmit prop) and useTypeahead (for
  // autocomplete acceptance). Using useKeybindings would cause
  // stopImmediatePropagation on Enter, blocking autocomplete from seeing the key.
  const keybindingContext = useOptionalKeybindingContext();
// 【chat:submit 不走 useKeybindings，而是直接注册 handler】
//
//  注释（第 1637-1642 行）给了完整理由：
//
//  · 用 useKeybindings 会让 Enter 的处理器**抢占**这个键（stopImmediatePropagation），
//    于是补全列表就看不到 Enter 了 —— 用户按回车想选建议，结果直接提交了半截命令。
//  · 直接注册到 handler registry 后，只有 ChordInterceptor（处理组合键的模块）
//    会在「组合键完成」时调用它，比如 ctrl+e s。
//
//  也就是说：**同一个键在两条不同的通道上流动**。
//  普通 Enter 走 TextInput 自己的 onSubmit（第 2174 行），
//  组合键的末尾 Enter 走这里。
//
//  这是键位系统里最容易搞混的地方：同一个物理键，按「是否在组合键序列中」
//  分成两条路径。改任何一条之前，先确认另一条不会受影响。
  useEffect(() => {
    if (!keybindingContext || isModalOverlayActive) return;
    return keybindingContext.registerHandler({
      action: 'chat:submit',
      context: 'Chat',
      handler: () => {
        void onSubmit(input);
      }
    });
  }, [keybindingContext, isModalOverlayActive, onSubmit, input]);

  // Chat context keybindings for editing shortcuts
  // Note: history:previous/history:next are NOT handled here. They are passed as
  // onHistoryUp/onHistoryDown props to TextInput, so that useTextInput's
  // upOrHistoryUp/downOrHistoryDown can try cursor movement first and only
  // fall through to history when the cursor can't move further.
// 【chatHandlers：一张「动作名 → 函数」的表，交给 useKeybindings 注册】
//
//  八个动作：undo / newline / externalEditor / stash / modelPicker /
//  thinkingToggle / cycleMode / imagePaste。
//
//  用表而不是八次 useKeybinding，好处是 useKeybindings 内部可以一次订阅、
//  一次注册，减少键位系统的开销。代价是依赖数组列了八个函数，
//  任何一个不稳定都会导致整批重新注册 —— 所以上面那八个 handler
//  全都用了 useCallback。
//
//  第 1672 行 `isActive: !isModalOverlayActive`：弹窗打开时整批键位失效。
//  这是「总闸」在键位层的体现。注意它拦的是**这一批**，
//  help:dismiss / app:quickOpen 那些是各自单独注册的，各有各的 isActive。
//
//  这种「一组共享 isActive + 个别单独注册」的结构，说明作者是按
//  「这批快捷键属于同一个上下文」来组织的 —— 而不是按功能分类。
  const chatHandlers = useMemo(() => ({
    'chat:undo': handleUndo,
    'chat:newline': handleNewline,
    'chat:externalEditor': handleExternalEditor,
    'chat:stash': handleStash,
    'chat:modelPicker': handleModelPicker,
    'chat:thinkingToggle': handleThinkingToggle,
    'chat:cycleMode': handleCycleMode,
    'chat:imagePaste': handleImagePaste
  }), [handleUndo, handleNewline, handleExternalEditor, handleStash, handleModelPicker, handleThinkingToggle, handleCycleMode, handleImagePaste]);
  useKeybindings(chatHandlers, {
    context: 'Chat',
    isActive: !isModalOverlayActive
  });

  // Shift+↑ enters message-actions cursor. Separate isActive so ctrl+r search
  // doesn't leave stale isSearchingHistory on cursor-exit remount.
  useKeybinding('chat:messageActions', () => onMessageActionsEnter?.(), {
    context: 'Chat',
    isActive: !isModalOverlayActive && !isSearchingHistory
  });

  // Fast mode keybinding is only active when fast mode is enabled and available
  useKeybinding('chat:fastMode', handleFastModePicker, {
    context: 'Chat',
    isActive: !isModalOverlayActive && isFastModeEnabled() && isFastModeAvailable()
  });

  // Handle help:dismiss keybinding (ESC closes help menu)
  // This is registered separately from Chat context so it has priority over
  // CancelRequestHandler when help menu is open
// 【help:dismiss 用 Help 上下文，是为了抢优先级】
//
//  注释（第 1688-1690 行）：注册在 Help 上下文而不是 Chat，这样它的优先级
//  高于 CancelRequestHandler（那个在 Chat 或 Global 上下文里）。
//
//  场景：帮助菜单打开时按 esc。如果走 Chat 上下文的 esc 处理，
//  会先被「取消请求」抢走 —— 用户按 esc 关了帮助，同时也取消了正在跑的请求。
//
//  所以把一个键的语义按**上下文**分层：Help 上下文只在帮助打开时激活，
//  此时它拥有 esc 的第一解释权。
//
//  这是终端 UI 里实现「焦点」的办法：没有真正的焦点系统，就用
//  「激活的上下文集合 + 优先级」模拟。上下文越具体，优先级越高。
//
//  同一段里还有三个 `feature(...)` 门控的注册（quickOpen / globalSearch /
//  historySearch），它们的写法是「hook 无条件调用，handler 内部判 feature」——
//  注释（第 1698-1700 行）解释了原因：hook 不能写在条件里，
//  而 handler 体内的 feature() 能让相关代码在外部构建里被剔除。
  useKeybinding('help:dismiss', () => {
    setHelpOpen(false);
  }, {
    context: 'Help',
    isActive: helpOpen
  });

  // Quick Open / Global Search. Hook calls are unconditional (Rules of Hooks);
  // the handler body is feature()-gated so the setState calls and component
  // references get tree-shaken in external builds.
  const quickSearchActive = feature('QUICK_SEARCH') ? !isModalOverlayActive : false;
  useKeybinding('app:quickOpen', () => {
    if (feature('QUICK_SEARCH')) {
      setShowQuickOpen(true);
      setHelpOpen(false);
    }
  }, {
    context: 'Global',
    isActive: quickSearchActive
  });
  useKeybinding('app:globalSearch', () => {
    if (feature('QUICK_SEARCH')) {
      setShowGlobalSearch(true);
      setHelpOpen(false);
    }
  }, {
    context: 'Global',
    isActive: quickSearchActive
  });
  useKeybinding('history:search', () => {
    if (feature('HISTORY_PICKER')) {
      setShowHistoryPicker(true);
      setHelpOpen(false);
    }
  }, {
    context: 'Global',
    isActive: feature('HISTORY_PICKER') ? !isModalOverlayActive : false
  });

  // Handle Ctrl+C to abort speculation when idle (not loading)
  // CancelRequestHandler only handles Ctrl+C during active tasks
  useKeybinding('app:interrupt', () => {
    abortSpeculation(setAppState);
  }, {
    context: 'Global',
    isActive: !isLoading && speculation.status === 'active'
  });

  // Footer indicator navigation keybindings. ↑/↓ live here (not in
  // handleHistoryUp/Down) because TextInput focus=false when a pill is
  // selected — its useInput is inactive, so this is the only path.
// 【footer 的六个键位，每个都有「先处理局部，再交给全局」的顺序】
//
//  footer:up（第 1743 行）：
//      if (任务胶囊选中 && 有任务行 && index > 最小) index-1   ← 先在任务列表里往上
//      else navigateFooter(-1, true)                          ← 否则离开这一层
//
//  footer:down（第 1751 行）：
//      if (任务胶囊选中 && 有任务行) { index+1; return }        ← **永远不离开胶囊**
//      else if (任务胶囊选中 && 非队友模式) { 打开任务对话框 }
//      else navigateFooter(1)
//
//  注意 up 和 down 不对称：down 在任务列表里「到底了也不出去」，
//  而 up 到头会离开。为什么？因为任务是「你按 ↓ 进来的」，
//  进来之后 ↓ 是「浏览列表」，浏览到底不代表要退出。
//  而 ↑ 是「往回退」的语义，退到顶就该回到上一层。
//
//  这种不对称不是疏忽，是**方向本身带语义**：↓ 是深入，↑ 是返回。
//
//  第 1759 行那个分支更特殊：非队友模式下按 ↓，直接打开任务对话框 ——
//  因为此时胶囊代表「有一批后台任务」，按 ↓ 是「我想看详情」。
  useKeybindings({
    'footer:up': () => {
      // ↑ scrolls within the coordinator task list before leaving the pill
      if (tasksSelected && "external" === 'ant' && coordinatorTaskCount > 0 && coordinatorTaskIndex > minCoordinatorIndex) {
        setCoordinatorTaskIndex(prev => prev - 1);
        return;
      }
      navigateFooter(-1, true);
    },
    'footer:down': () => {
      // ↓ scrolls within the coordinator task list, never leaves the pill
      if (tasksSelected && "external" === 'ant' && coordinatorTaskCount > 0) {
        if (coordinatorTaskIndex < coordinatorTaskCount - 1) {
          setCoordinatorTaskIndex(prev => prev + 1);
        }
        return;
      }
      if (tasksSelected && !isTeammateMode) {
        setShowBashesDialog(true);
        selectFooterItem(null);
        return;
      }
      navigateFooter(1);
    },
    'footer:next': () => {
      // Teammate mode: ←/→ cycles within the team member list
      if (tasksSelected && isTeammateMode) {
        const totalAgents = 1 + inProcessTeammates.length;
        setTeammateFooterIndex(prev => (prev + 1) % totalAgents);
        return;
      }
      navigateFooter(1);
    },
    'footer:previous': () => {
      if (tasksSelected && isTeammateMode) {
        const totalAgents = 1 + inProcessTeammates.length;
        setTeammateFooterIndex(prev => (prev - 1 + totalAgents) % totalAgents);
        return;
      }
      navigateFooter(-1);
    },
// 【footer:openSelected：一个 switch 分发六种「打开」】
//
//    companion → 发 /buddy 命令
//    tasks     → 队友模式：切到选中队友的视图；非队友：进任务对话框
//    tmux      → 切换 tmux 面板可见性（对外构建里是死分支）
//    bagel     → 什么都不做（浏览器面板还没接上）
//    teams     → 打开团队对话框
//    bridge    → 打开 Bridge 对话框
//
//  注意每个 dialog 分支都是「先 selectFooterItem(null) 再打开」：
//  因为对话框是模态的，选中状态留着会让用户按 esc 关闭对话框后
//  发现自己还停在 footer 上，程序继续吃掉方向键。
//
//  第 1784-1786 行的守卫 `if (viewSelectionMode === 'selecting-agent') return`
//  是必须的：那个模式下回车已经用来「确认选择 agent」，
//  如果再走这里，会同时触发两件事。
//
//  第 1803 行 `coordinatorTaskIndex === 0 && coordinatorTaskCount > 0` 时
//  执行 exitTeammateView —— 也就是「选中第 0 行 = 退出队友视图，回到队长」。
//  第 0 行在 UI 上是队长自己，语义对齐得很自然。
    'footer:openSelected': () => {
      if (viewSelectionMode === 'selecting-agent') {
        return;
      }
      switch (footerItemSelected) {
        case 'companion':
          if (feature('BUDDY')) {
            selectFooterItem(null);
            void onSubmit('/buddy');
          }
          break;
        case 'tasks':
          if (isTeammateMode) {
            // Enter switches to the selected agent's view
            if (teammateFooterIndex === 0) {
              exitTeammateView(setAppState);
            } else {
              const teammate = inProcessTeammates[teammateFooterIndex - 1];
              if (teammate) enterTeammateView(teammate.id, setAppState);
            }
          } else if (coordinatorTaskIndex === 0 && coordinatorTaskCount > 0) {
            exitTeammateView(setAppState);
          } else {
            const selectedTaskId = getVisibleAgentTasks(tasks)[coordinatorTaskIndex - 1]?.id;
            if (selectedTaskId) {
              enterTeammateView(selectedTaskId, setAppState);
            } else {
              setShowBashesDialog(true);
              selectFooterItem(null);
            }
          }
          break;
        case 'tmux':
          if ("external" === 'ant') {
            setAppState(prev => prev.tungstenPanelAutoHidden ? {
              ...prev,
              tungstenPanelAutoHidden: false
            } : {
              ...prev,
              tungstenPanelVisible: !(prev.tungstenPanelVisible ?? true)
            });
          }
          break;
        case 'bagel':
          break;
        case 'teams':
          setShowTeamsDialog(true);
          selectFooterItem(null);
          break;
        case 'bridge':
          setShowBridgeDialog(true);
          selectFooterItem(null);
          break;
      }
    },
    'footer:clearSelection': () => {
      selectFooterItem(null);
    },
// 【footer:close：返回 false 表示「我不处理这个键」】
//
//  这个键绑的是 'x'（用来终止或移除一个 agent）。逻辑分三支：
//
//    1. 选中的行就是当前正在看的 agent → **把 x 打进输入框**
//       （因为此时 x 应该是「给这个 agent 发消息」的第一个字母）
//    2. 其他行 → stopOrDismissAgent
//    3. 没选中任务行 → return false，让 'x' 落到输入框里正常打字
//
//  第 1845-1848 行的注释解释了分支 1：当你在看某个 agent 的会话时，
//  输入框是给它的（steering input），所以 x 必须变成文本。
//  这一条的判据是 `viewSelectionMode === 'viewing-agent' && task.id === viewingAgentTaskId`——
//  两个条件都要，因为「看着 A 但选中的是 B」时，x 应该是终止 B。
//
//  返回 false 的语义在键位系统里叫「未消费」。它的价值是：
//  **同一个键在有意义的时候拦截，没意义的时候放行**。
//  如果这里无脑 return true，用户在 footer 选中状态下就永远打不出 x 了。
    'footer:close': () => {
      if (tasksSelected && coordinatorTaskIndex >= 1) {
        const task = getVisibleAgentTasks(tasks)[coordinatorTaskIndex - 1];
        if (!task) return false;
        // When the selected row IS the viewed agent, 'x' types into the
        // steering input. Any other row — dismiss it.
        if (viewSelectionMode === 'viewing-agent' && task.id === viewingAgentTaskId) {
          onChange(input.slice(0, cursorOffset) + 'x' + input.slice(cursorOffset));
          setCursorOffset(cursorOffset + 1);
          return;
        }
        stopOrDismissAgent(task.id, setAppState);
        if (task.status !== 'running') {
          setCoordinatorTaskIndex(i => Math.max(minCoordinatorIndex, i - 1));
        }
        return;
      }
      // Not handled — let 'x' fall through to type-to-exit
      return false;
    }
  }, {
    context: 'Footer',
    isActive: !!footerItemSelected && !isModalOverlayActive
  });
// 【useInput 的兜底处理器：全文件最后一个收到按键的地方】
//
//  它排在所有键位注册之后，所以到这里说明「没有更具体的处理器认领这个键」。
//  内容只有五块，但每一块都在处理「没人要的键」：
//
//    ① 弹窗打开时直接 return（防 esc 泄漏到双击逻辑）
//    ② macOS Option 键被当成特殊字符时，弹提示（但**仍然让字符打进去**）
//    ③ footer 选中时，可打印字符 → 转成输入（type-to-exit）
//    ④ 光标在 0 位置时，退格/esc/delete/ctrl+u → 退出特殊模式
//    ⑤ esc 的五种含义（推测中 / 侧问题 / 帮助 / footer / 排队命令 / 双击）
//
//  第 1874-1888 行那段 macOS 处理很有意思：Option+某键在终端里会变成
//  一个特殊字符（比如 Option+p 是 π），于是「alt+p 切换模型」失效。
//  这里的做法不是吞掉字符，而是**弹一个说明并让字符照常输入** ——
//  因为用户可能真的想打 π。注释最后一句 "Don't return" 就是这个意思。
//
//  这是「诊断性提示」的范式：不改变行为，只解释为什么你的操作没生效。
  useInput((char, key) => {
    // Skip all input handling when a full-screen dialog is open. These dialogs
    // render via early return, but hooks run unconditionally — so without this
    // guard, Escape inside a dialog leaks to the double-press message-selector.
    if (showTeamsDialog || showQuickOpen || showGlobalSearch || showHistoryPicker) {
      return;
    }

    // Detect failed Alt shortcuts on macOS (Option key produces special characters)
    if (getPlatform() === 'macos' && isMacosOptionChar(char)) {
      const shortcut = MACOS_OPTION_SPECIAL_CHARS[char];
      const terminalName = getNativeCSIuTerminalDisplayName();
      const jsx = terminalName ? <Text dimColor>
          To enable {shortcut}, set <Text bold>Option as Meta</Text> in{' '}
          {terminalName} preferences (⌘,)
        </Text> : <Text dimColor>To enable {shortcut}, run /terminal-setup</Text>;
      addNotification({
        key: 'option-meta-hint',
        jsx,
        priority: 'immediate',
        timeoutMs: 5000
      });
      // Don't return - let the character be typed so user sees the issue
    }

    // Footer navigation is handled via useKeybindings above (Footer context)

    // NOTE: ctrl+_, ctrl+g, ctrl+s are handled via Chat context keybindings above

    // Type-to-exit footer: printable chars while a pill is selected refocus
    // the input and type the char. Nav keys are captured by useKeybindings
    // above, so anything reaching here is genuinely not a footer action.
    // onChange clears footerSelection, so no explicit deselect.
// 【type-to-exit：footer 选中状态下，敲字就回到输入框】
//
//      if (footerItemSelected && char && !ctrl && !meta && !escape && !return) {
//        onChange(input.slice(0, cursorOffset) + char + input.slice(cursorOffset))
//        setCursorOffset(cursorOffset + char.length)
//        return
//      }
//
//  实现方式是**手工插入一个字符**，而不是「把焦点还给输入框然后重放这个键」。
//  为什么：重放键需要模拟一次按键事件，在 Inko 里没有这种能力（输入是从
//  stdin 读的）。所以只能直接改文本。
//
//  这就解释了为什么这里要自己拼字符串：TextInput 此刻 focus=false，
//  它不会处理这个键，只能由这里代劳。
//
//  四个排除条件对应四类「不该当打字处理」的键：控制键、元键、esc、回车。
//  注意**没有排除方向键** —— 因为方向键的 char 是空字符串，
//  第一个条件 `char` 就把它们过滤掉了。用「有没有字符」来区分「是不是可打印」，
//  比逐个列举方向键更稳。
//
//  第 1897 行注释也点明：onChange 会顺手清掉 footerSelection，
//  所以不需要显式取消选中。**隐式副作用代替显式调用**，省了一行，
//  但读代码时要注意 onChange 里确实有这一步（第 896 行）。
    if (footerItemSelected && char && !key.ctrl && !key.meta && !key.escape && !key.return) {
      onChange(input.slice(0, cursorOffset) + char + input.slice(cursorOffset));
      setCursorOffset(cursorOffset + char.length);
      return;
    }

    // Exit special modes when backspace/escape/delete/ctrl+u is pressed at cursor position 0
    if (cursorOffset === 0 && (key.escape || key.backspace || key.delete || key.ctrl && char === 'u')) {
      onModeChange('prompt');
      setHelpOpen(false);
    }

    // Exit help mode when backspace is pressed and input is empty
    if (helpOpen && input === '' && (key.backspace || key.delete)) {
      setHelpOpen(false);
    }

// 【esc 的五种含义，按优先级排列】
//
//    1. 有推测在执行      → 中止推测
//    2. 侧问题（/btw）在显示 → 收起侧问题
//    3. 帮助菜单开着       → 关帮助
//    4. footer 有选中      → （交给 Footer 上下文的键位处理，这里 return）
//    5. 队列里有可编辑命令  → 捞回来编辑
//    6. 有消息 且 输入为空 且 没在加载 → 双击打开消息选择器
//
//  注释本身（第 1915-1920 行）列了四种，实际代码是六种 —— 因为「取消请求」
//  那一种不在这个文件里（由 CancelRequestHandler 处理，它在别的上下文）。
//
//  这六种之所以能共存，靠的是**条件互斥**：每个条件都对应一个明确的模式。
//  但要注意顺序：如果两个条件同时成立，先命中的赢。比如「帮助开着 + 队列里有命令」，
//  按 esc 会关帮助（第 3 条），不会捞命令。
//
//  第 1944 行 `if (footerItemSelected) return` 是个「故意不作为」：
//  它把 esc 让给 Footer 上下文（那里绑的是 footer:clearSelection）。
//  如果没有这个 return，这里的逻辑会继续往下走到第 5 条，把排队命令捞出来 ——
//  用户想取消选中，结果输入框里多了一堆文字。
//
//  **「让路」也是逻辑的一部分，而且必须写在正确的位置。**
    // esc is a little overloaded:
    // - when we're loading a response, it's used to cancel the request
    // - otherwise, it's used to show the message selector
    // - when double pressed, it's used to clear the input
    // - when input is empty, pop from command queue

    // Handle ESC key press
    if (key.escape) {
      // Abort active speculation
      if (speculation.status === 'active') {
        abortSpeculation(setAppState);
        return;
      }

      // Dismiss side question response if visible
      if (isSideQuestionVisible && onDismissSideQuestion) {
        onDismissSideQuestion();
        return;
      }

      // Close help menu if open
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }

      // Footer selection clearing is now handled via Footer context keybindings
      // (footer:clearSelection action bound to escape)
      // If a footer item is selected, let the Footer keybinding handle it
      if (footerItemSelected) {
        return;
      }

      // If there's an editable queued command, move it to the input for editing when ESC is pressed
      const hasEditableCommand = queuedCommands.some(isQueuedCommandEditable);
      if (hasEditableCommand) {
        void popAllCommandsFromQueue();
        return;
      }
      if (messages.length > 0 && !input && !isLoading) {
        doublePressEscFromEmpty();
      }
    }
    if (key.return && helpOpen) {
      setHelpOpen(false);
    }
  });
// 【横幅与 fast 图标：两处「按身份/状态决定显示什么」】
//
//  useSwarmBanner 返回 {text, bgColor} 或 null（同目录 useSwarmBanner.ts，
//  六档优先级：队友自己 → tmux attach 提示 → 正在看的队友 → 后台 agent →
//  独立 agent → --agent 参数）。
//
//  showFastIcon 是三个条件的与：fast 模式开启、且（可用 或 在冷却中）。
//  注意「冷却中」也算可见 —— 因为冷却中更需要让用户看到图标（否则他会一直
//  按 alt+o 想知道为什么没反应）。
//
//  第 1991 行 `textInputColumns = columns - 3 - companionReservedColumns(...)`：
//  左边 3 列给 ❯ 和空格，右边扣掉「电子宠物」占的位置。
//  也就是说 **输入框的实际宽度取决于有没有养宠物** —— 这种「功能互相挤占空间」
//  在终端 UI 里是常态，因为没有绝对定位可用。
  const swarmBanner = useSwarmBanner();
  const fastModeCooldown = isFastModeEnabled() ? isFastModeCooldown() : false;
  const showFastIcon = isFastModeEnabled() ? isFastMode && (isFastModeAvailable() || fastModeCooldown) : false;
  const showFastIconHint = useShowFastIconHint(showFastIcon ?? false);

  // Show effort notification on startup and when effort changes.
  // Suppressed in brief/assistant mode — the value reflects the local
  // client's effort, not the connected agent's.
  const effortNotificationText = briefOwnsGap ? undefined : getEffortNotificationText(effortValue, mainLoopModel);
  useEffect(() => {
    if (!effortNotificationText) {
      removeNotification('effort-level');
      return;
    }
    addNotification({
      key: 'effort-level',
      text: effortNotificationText,
      priority: 'high',
      timeoutMs: 12_000
    });
  }, [effortNotificationText, addNotification, removeNotification]);
  useBuddyNotification();
  const companionSpeaking = feature('BUDDY') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s => s.companionReaction !== undefined) : false;
  const {
    columns,
    rows
  } = useTerminalSize();
  const textInputColumns = columns - 3 - companionReservedColumns(columns, companionSpeaking);

  // POC: click-to-position-cursor. Mouse tracking is only enabled inside
  // <AlternateScreen>, so this is dormant in the normal main-screen REPL.
  // localCol/localRow are relative to the onClick Box's top-left; the Box
  // tightly wraps the text input so they map directly to (column, line)
  // in the Cursor wrap model. MeasuredText.getOffsetFromPosition handles
  // wide chars, wrapped lines, and clamps past-end clicks to line end.
// 【点击定位光标：终端也能点，但要自己把坐标换成文本偏移】
//
//  能点的前提是开了鼠标追踪，而注释（第 1993-1994 行）说得很清楚：
//  鼠标追踪**只在 <AlternateScreen> 里开启**，所以普通模式下这段是死代码。
//
//  换算链是三步：
//
//    e.localRow / e.localCol          点击相对于那个 Box 左上角的坐标
//    → + viewportStart                加上视口起点（多行输入滚动过的话）
//    → measuredText.getOffsetFromPosition({line, column})
//                                     再换成字符串下标
//
//  第三步是关键：终端里「列」不等于「字符下标」—— 中日韩字符占两列、
//  emoji 可能占两列、组合字符占 0 列。所以必须用 MeasuredText（它记录
//  每个字符的实际宽度）来换算，不能用简单的算术。
//
//  第 2002-2004 行还有两个守卫：输入为空时不处理（没东西可定位），
//  搜索历史时不处理（此时显示的文本是 historyMatch，不是 input，
//  算出来的偏移会落到错误的字符串上）。
//
//  **一切「坐标 → 文本位置」的换算，都必须经过宽度模型，不能自己数。**
  const maxVisibleLines = isFullscreenEnvEnabled() ? Math.max(MIN_INPUT_VIEWPORT_LINES, Math.floor(rows / 2) - PROMPT_FOOTER_LINES) : undefined;
  const handleInputClick = useCallback((e: ClickEvent) => {
    // During history search the displayed text is historyMatch, not
    // input, and showCursor is false anyway — skip rather than
    // compute an offset against the wrong string.
    if (!input || isSearchingHistory) return;
    const c = Cursor.fromText(input, textInputColumns, cursorOffset);
    const viewportStart = c.getViewportStartLine(maxVisibleLines);
    const offset = c.measuredText.getOffsetFromPosition({
      line: e.localRow + viewportStart,
      column: e.localCol
    });
    setCursorOffset(offset);
  }, [input, textInputColumns, isSearchingHistory, cursorOffset, maxVisibleLines]);
  const handleOpenTasksDialog = useCallback((taskId?: string) => setShowBashesDialog(taskId ?? true), [setShowBashesDialog]);
  const placeholder = showPromptSuggestion && promptSuggestion ? promptSuggestion : defaultPlaceholder;

  // Calculate if input has multiple lines
  const isInputWrapped = useMemo(() => input.includes('\n'), [input]);

  // Memoized callbacks for model picker to prevent re-renders when unrelated
  // state (like notifications) changes. This prevents the inline model picker
  // from visually "jumping" when notifications arrive.
  const handleModelSelect = useCallback((model: string | null, _effort: EffortLevel | undefined) => {
    let wasFastModeDisabled = false;
    setAppState(prev => {
      wasFastModeDisabled = isFastModeEnabled() && !isFastModeSupportedByModel(model) && !!prev.fastMode;
      return {
        ...prev,
        mainLoopModel: model,
        mainLoopModelForSession: null,
        // Turn off fast mode if switching to a model that doesn't support it
        ...(wasFastModeDisabled && {
          fastMode: false
        })
      };
    });
    setShowModelPicker(false);
    const effectiveFastMode = (isFastMode ?? false) && !wasFastModeDisabled;
    let message = `Model set to ${modelDisplayString(model)}`;
    if (isBilledAsExtraUsage(model, effectiveFastMode, isOpus1mMergeEnabled())) {
      message += ' · Billed as extra usage';
    }
    if (wasFastModeDisabled) {
      message += ' · Fast mode OFF';
    }
    addNotification({
      key: 'model-switched',
      jsx: <Text>{message}</Text>,
      priority: 'immediate',
      timeoutMs: 3000
    });
    logEvent('tengu_model_picker_hotkey', {
      model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
  }, [setAppState, addNotification, isFastMode]);
  const handleModelCancel = useCallback(() => {
    setShowModelPicker(false);
  }, []);

  // Memoize the model picker element to prevent unnecessary re-renders
  // when AppState changes for unrelated reasons (e.g., notifications arriving)
  const modelPickerElement = useMemo(() => {
    if (!showModelPicker) return null;
    return <Box flexDirection="column" marginTop={1}>
        <ModelPicker initial={mainLoopModel_} sessionModel={mainLoopModelForSession} onSelect={handleModelSelect} onCancel={handleModelCancel} isStandaloneCommand showFastModeNotice={isFastModeEnabled() && isFastMode && isFastModeSupportedByModel(mainLoopModel_) && isFastModeAvailable()} />
      </Box>;
  }, [showModelPicker, mainLoopModel_, mainLoopModelForSession, handleModelSelect, handleModelCancel]);
  const handleFastModeSelect = useCallback((result?: string) => {
    setShowFastModePicker(false);
    if (result) {
      addNotification({
        key: 'fast-mode-toggled',
        jsx: <Text>{result}</Text>,
        priority: 'immediate',
        timeoutMs: 3000
      });
    }
  }, [addNotification]);

  // Memoize the fast mode picker element
  const fastModePickerElement = useMemo(() => {
    if (!showFastModePicker) return null;
    return <Box flexDirection="column" marginTop={1}>
        <FastModePicker onDone={handleFastModeSelect} unavailableReason={getFastModeUnavailableReason()} />
      </Box>;
  }, [showFastModePicker, handleFastModeSelect]);

  // Memoized callbacks for thinking toggle
  const handleThinkingSelect = useCallback((enabled: boolean) => {
    setAppState(prev => ({
      ...prev,
      thinkingEnabled: enabled
    }));
    setShowThinkingToggle(false);
    logEvent('tengu_thinking_toggled_hotkey', {
      enabled
    });
    addNotification({
      key: 'thinking-toggled-hotkey',
      jsx: <Text color={enabled ? 'suggestion' : undefined} dimColor={!enabled}>
            Thinking {enabled ? 'on' : 'off'}
          </Text>,
      priority: 'immediate',
      timeoutMs: 3000
    });
  }, [setAppState, addNotification]);
  const handleThinkingCancel = useCallback(() => {
    setShowThinkingToggle(false);
  }, []);

  // Memoize the thinking toggle element
  const thinkingToggleElement = useMemo(() => {
    if (!showThinkingToggle) return null;
    return <Box flexDirection="column" marginTop={1}>
        <ThinkingToggle currentValue={thinkingEnabled ?? true} onSelect={handleThinkingSelect} onCancel={handleThinkingCancel} isMidConversation={messages.some(m => m.type === 'assistant')} />
      </Box>;
  }, [showThinkingToggle, thinkingEnabled, handleThinkingSelect, handleThinkingCancel, messages.length]);

  // Portal dialog to DialogOverlay in fullscreen so it escapes the bottom
  // slot's overflowY:hidden clip (same pattern as SuggestionsOverlay).
  // Must be called before early returns below to satisfy rules-of-hooks.
  // Memoized so the portal useEffect doesn't churn on every PromptInput render.
  const autoModeOptInDialog = useMemo(() => feature('TRANSCRIPT_CLASSIFIER') && showAutoModeOptIn ? <AutoModeOptInDialog onAccept={handleAutoModeOptInAccept} onDecline={handleAutoModeOptInDecline} /> : null, [showAutoModeOptIn, handleAutoModeOptInAccept, handleAutoModeOptInDecline]);
  useSetPromptOverlayDialog(isFullscreenEnvEnabled() ? autoModeOptInDialog : null);
  if (showBashesDialog) {
    return <BackgroundTasksDialog onDone={() => setShowBashesDialog(false)} toolUseContext={getToolUseContext(messages, [], new AbortController(), mainLoopModel)} initialDetailTaskId={typeof showBashesDialog === 'string' ? showBashesDialog : undefined} />;
  }
  if (isAgentSwarmsEnabled() && showTeamsDialog) {
    return <TeamsDialog initialTeams={cachedTeams} onDone={() => {
      setShowTeamsDialog(false);
    }} />;
  }
  if (feature('QUICK_SEARCH')) {
    const insertWithSpacing = (text: string) => {
      const cursorChar = input[cursorOffset - 1] ?? ' ';
      insertTextAtCursor(/\s/.test(cursorChar) ? text : ` ${text}`);
    };
    if (showQuickOpen) {
      return <QuickOpenDialog onDone={() => setShowQuickOpen(false)} onInsert={insertWithSpacing} />;
    }
    if (showGlobalSearch) {
      return <GlobalSearchDialog onDone={() => setShowGlobalSearch(false)} onInsert={insertWithSpacing} />;
    }
  }
  if (feature('HISTORY_PICKER') && showHistoryPicker) {
    return <HistorySearchDialog initialQuery={input} onSelect={entry => {
      const entryMode = getModeFromInput(entry.display);
      const value = getValueFromInput(entry.display);
      onModeChange(entryMode);
      trackAndSetInput(value);
      setPastedContents(entry.pastedContents);
      setCursorOffset(value.length);
      setShowHistoryPicker(false);
    }} onCancel={() => setShowHistoryPicker(false)} />;
  }

  // Show loop mode menu when requested (ant-only, eliminated from external builds)
  if (modelPickerElement) {
    return modelPickerElement;
  }
  if (fastModePickerElement) {
    return fastModePickerElement;
  }
  if (thinkingToggleElement) {
    return thinkingToggleElement;
  }
  if (showBridgeDialog) {
    return <BridgeDialog onDone={() => {
      setShowBridgeDialog(false);
      selectFooterItem(null);
    }} />;
  }
// 【baseProps：一次组装 22 个 prop，全部塞给 TextInput】
//
//  这份对象是「输入框的能力清单」，值得逐个看几个特别的：
//
//    value            —— historyMatch 存在时用匹配项（显示账 vs 状态账）
//    onHistoryUp/Down —— 通过 prop 传而不是键位注册（让 TextInput 内部
//                        先尝试移动光标，移不动才翻历史）
//    disableCursorMovementForUpDownKeys —— 补全列表或 footer 选中时，
//                        上下键不被当成光标移动（否则会同时动两处）
//    focus            —— 四个条件的与；footer 选中时输入框真的失焦
//    showCursor       —— 光标停在图片胶囊左边界时不画光标（反色块就是光标）
//    highlights       —— 全部高亮合成一个数组（render-border 那边的格式）
//    inputFilter      —— lazy space 的挂钩点
//    inlineGhostText  —— 补全的行内灰字预览
//
//  第 2193 行那个 `disableCursorMovementForUpDownKeys` 是「按键仲裁」的
//  又一处体现：同一个键在不同模式下归不同的人管。
//
//  第 2212 行 `inputFilter: lazySpaceInputFilter` 是唯一一个「改写输入」的钩子 ——
//  它能在字符进入文本之前动手，这是其他 prop 都做不到的。
  const baseProps: BaseTextInputProps = {
    multiline: true,
    onSubmit,
    onChange,
    value: historyMatch ? getValueFromInput(typeof historyMatch === 'string' ? historyMatch : historyMatch.display) : input,
    // History navigation is handled via TextInput props (onHistoryUp/onHistoryDown),
    // NOT via useKeybindings. This allows useTextInput's upOrHistoryUp/downOrHistoryDown
    // to try cursor movement first and only fall through to history navigation when the
    // cursor can't move further (important for wrapped text and multi-line input).
    onHistoryUp: handleHistoryUp,
    onHistoryDown: handleHistoryDown,
    onHistoryReset: resetHistory,
    placeholder,
    onExit,
    onExitMessage: (show, key) => setExitMessage({
      show,
      key
    }),
    onImagePaste,
    columns: textInputColumns,
    maxVisibleLines,
    disableCursorMovementForUpDownKeys: suggestions.length > 0 || !!footerItemSelected,
    disableEscapeDoublePress: suggestions.length > 0,
    cursorOffset,
    onChangeCursorOffset: setCursorOffset,
    onPaste: onTextPaste,
    onIsPastingChange: setIsPasting,
    focus: !isSearchingHistory && !isModalOverlayActive && !footerItemSelected,
    showCursor: !footerItemSelected && !isSearchingHistory && !cursorAtImageChip,
    argumentHint: commandArgumentHint,
    onUndo: canUndo ? () => {
      const previousState = undo();
      if (previousState) {
        trackAndSetInput(previousState.text);
        setCursorOffset(previousState.cursorOffset);
        setPastedContents(previousState.pastedContents);
      }
    } : undefined,
    highlights: combinedHighlights,
    inlineGhostText,
    inputFilter: lazySpaceInputFilter
  };
// 【边框颜色：三级优先，最后一档是「不许上色」】
//
//    1. 按模式取值（只有 bash 有专属色）—— 用一个只有一项的映射表
//    2. 进程内 teammate → 直接返回默认色（**不上队友色**）
//    3. 环境里有队友色 → 用队友色
//    4. 都没有 → 默认 promptBorder
//
//  第 2224-2227 行那句 `if (isInProcessTeammate()) return 'promptBorder'`
//  是把「进程内 teammate 是无头的」这件事落到颜色上：它跑在 leader 的进程里，
//  如果给它上队友色，leader 的输入框会突然变色，看起来像换了身份。
//
//  第 2215 行那个只有一项的 Record 值得看：
//
//      const modeColors: Record<string, keyof Theme> = { bash: 'bashBorder' }
//
//  为什么不写成 `mode === 'bash' ? 'bashBorder' : undefined`：
//  因为这是一张**等着被扩充的表**。将来加 plan 模式、auto 模式的颜色，
//  只需要往表里加一行，判断逻辑不动。
//
//  （对比 PromptInputModeIndicator 里那个 switch，两者解决同一个问题，
//  一个用表一个用分支 —— 说明这两处不是同一个人/同一时期写的。）
  const getBorderColor = (): keyof Theme => {
    const modeColors: Record<string, keyof Theme> = {
      bash: 'bashBorder'
    };

    // Mode colors take priority, then teammate color, then default
    if (modeColors[mode]) {
      return modeColors[mode];
    }

    // In-process teammates run headless - don't apply teammate colors to leader UI
    if (isInProcessTeammate()) {
      return 'promptBorder';
    }

    // Check for teammate color from environment
    const teammateColorName = getTeammateColor();
    if (teammateColorName && AGENT_COLORS.includes(teammateColorName as AgentColorName)) {
      return AGENT_COLOR_TO_THEME_COLOR[teammateColorName as AgentColorName];
    }
    return 'promptBorder';
  };
// 【外部编辑器激活时，整个输入框变成一个只有边框的提示条】
//
//  borderLeft={false} borderRight={false} borderBottom —— 只保留上边框？
//  不对，是**去掉左右和上**：只画下边框。所以视觉上是一条横线加一行灰字。
//
//  为什么这么设计：编辑器（vim/nano）占满屏幕，我们的 UI 只剩终端最后一行
//  可用的空间。一条横线 + 一句「保存并关闭编辑器继续」是最省地方的做法。
//
//  这个早退在 baseProps 之后、textInputElement 之前 —— 顺序很关键：
//  baseProps 已经算完（它含 highlights 等较贵的计算），但因为早退，
//  TextInput 完全不会挂载。**省掉的是子树的挂载，不是计算。**
//
//  如果这段提前到 baseProps 之前，能省掉那些计算；但 baseProps 里没有副作用，
//  放在后面读起来更顺（所有渲染分支集中在一处）。这是可读性换来的微小开销。
  if (isExternalEditorActive) {
    return <Box flexDirection="row" alignItems="center" justifyContent="center" borderColor={getBorderColor()} borderStyle="round" borderLeft={false} borderRight={false} borderBottom width="100%">
        <Text dimColor italic>
          Save and close editor to continue...
        </Text>
      </Box>;
  }
  const textInputElement = isVimModeEnabled() ? <VimTextInput {...baseProps} initialMode={vimMode} onModeChange={setVimMode} /> : <TextInput {...baseProps} />;
// 【最终结构：一个纵向 Box，从上到下五层】
//
//    ① PromptInputQueuedCommands   排队中的消息预览（**仅在非全屏**）
//    ② 「Waiting for permission…」  有弹窗被抑制时的说明
//    ③ PromptInputStashNotice       「已暂存」提示
//    ④ 输入行                       swarm 横幅 or 带边框的输入框
//    ⑤ PromptInputFooter            状态行 / 建议列表 / 帮助菜单
//    ⑥ （全屏时）绝对定位的通知层
//
//  第 2245 行 `{!isFullscreenEnvEnabled() && <PromptInputQueuedCommands />}`
//  是个有意思的取舍：全屏模式下不显示排队预览。因为全屏布局里
//  每一行都要从正文区抢，而排队消息是「次要信息」—— 用户可以在
//  footer 的任务胶囊里看到它们。
//
//  marginTop 由 briefOwnsGap 决定：brief 模式下为 0（让 spinner 贴着输入框），
//  否则为 1。注释（第 317-321 行）说过这个 gap 的归属问题 ——
//  两个组件（BriefSpinner 和这里）都在管这个间距，靠一个布尔保证不加倍。
  return <Box flexDirection="column" marginTop={briefOwnsGap ? 0 : 1}>
      {!isFullscreenEnvEnabled() && <PromptInputQueuedCommands />}
      {hasSuppressedDialogs && <Box marginTop={1} marginLeft={2}>
          <Text dimColor>Waiting for permission…</Text>
        </Box>}
      <PromptInputStashNotice hasStash={stashedPrompt !== undefined} />
      {swarmBanner ? <>
          <Text color={swarmBanner.bgColor}>
            {swarmBanner.text ? <>
                {'─'.repeat(Math.max(0, columns - stringWidth(swarmBanner.text) - 4))}
                <Text backgroundColor={swarmBanner.bgColor} color="inverseText">
                  {' '}
                  {swarmBanner.text}{' '}
                </Text>
                {'──'}
              </> : '─'.repeat(columns)}
          </Text>
          <Box flexDirection="row" width="100%">
            <PromptInputModeIndicator mode={mode} isLoading={isLoading} viewingAgentName={viewingAgentName} viewingAgentColor={viewingAgentColor} />
            <Box flexGrow={1} flexShrink={1} onClick={handleInputClick}>
              {textInputElement}
            </Box>
          </Box>
          <Text color={swarmBanner.bgColor}>{'─'.repeat(columns)}</Text>
        </> : <Box flexDirection="row" alignItems="flex-start" justifyContent="flex-start" borderColor={getBorderColor()} borderStyle="round" borderLeft={false} borderRight={false} borderBottom width="100%" borderText={buildBorderText(showFastIcon ?? false, showFastIconHint, fastModeCooldown)}>
          <PromptInputModeIndicator mode={mode} isLoading={isLoading} viewingAgentName={viewingAgentName} viewingAgentColor={viewingAgentColor} />
          <Box flexGrow={1} flexShrink={1} onClick={handleInputClick}>
            {textInputElement}
          </Box>
        </Box>}
      <PromptInputFooter apiKeyStatus={apiKeyStatus} debug={debug} exitMessage={exitMessage} vimMode={isVimModeEnabled() ? vimMode : undefined} mode={mode} autoUpdaterResult={autoUpdaterResult} isAutoUpdating={isAutoUpdating} verbose={verbose} onAutoUpdaterResult={onAutoUpdaterResult} onChangeIsUpdating={setIsAutoUpdating} suggestions={suggestions} selectedSuggestion={selectedSuggestion} maxColumnWidth={maxColumnWidth} toolPermissionContext={effectiveToolPermissionContext} helpOpen={helpOpen} suppressHint={input.length > 0} isLoading={isLoading} tasksSelected={tasksSelected} teamsSelected={teamsSelected} bridgeSelected={bridgeSelected} tmuxSelected={tmuxSelected} teammateFooterIndex={teammateFooterIndex} ideSelection={ideSelection} mcpClients={mcpClients} isPasting={isPasting} isInputWrapped={isInputWrapped} messages={messages} isSearching={isSearchingHistory} historyQuery={historyQuery} setHistoryQuery={setHistoryQuery} historyFailedMatch={historyFailedMatch} onOpenTasksDialog={isFullscreenEnvEnabled() ? handleOpenTasksDialog : undefined} />
      {isFullscreenEnvEnabled() ? null : autoModeOptInDialog}
      {isFullscreenEnvEnabled() ?
    // position=absolute takes zero layout height so the spinner
    // doesn't shift when a notification appears/disappears. Yoga
    // anchors absolute children at the parent's content-box origin;
    // marginTop=-1 pulls it into the marginTop=1 gap row above the
    // prompt border. In brief mode there is no such gap (briefOwnsGap
    // strips our marginTop) and BriefSpinner sits flush against the
    // border — marginTop=-2 skips over the spinner content into
    // BriefSpinner's own marginTop=1 blank row. height=1 +
    // overflow=hidden clips multi-line notifications to a single row.
    // flex-end anchors the bottom line so the visible row is always
    // the most recent. Suppressed while the slash overlay or
    // auto-mode opt-in dialog is up by height=0 (NOT unmount) — this
    // Box renders later in tree order so it would paint over their
    // bottom row. Keeping Notifications mounted prevents AutoUpdater's
    // initial-check effect from re-firing on every slash-completion
    // toggle (PR#22413).
    <Box position="absolute" marginTop={briefOwnsGap ? -2 : -1} height={suggestions.length === 0 && !showAutoModeOptIn ? 1 : 0} width="100%" paddingLeft={2} paddingRight={1} flexDirection="column" justifyContent="flex-end" overflow="hidden">
          <Notifications apiKeyStatus={apiKeyStatus} autoUpdaterResult={autoUpdaterResult} debug={debug} isAutoUpdating={isAutoUpdating} verbose={verbose} messages={messages} onAutoUpdaterResult={onAutoUpdaterResult} onChangeIsUpdating={setIsAutoUpdating} ideSelection={ideSelection} mcpClients={mcpClients} isInputWrapped={isInputWrapped} />
        </Box> : null}
    </Box>;
// 【回头补一句：上面那个绝对定位的通知层，为什么用 height 0 而不是卸载】
//
//  第 2293 行那个 Box 有 position="absolute"、height={有建议或弹窗时 ? 0 : 1}。
//
//  用 height=0 而不是条件卸载（不渲染），原因是注释（第 2287-2292 行）说的：
//  它渲染在树的后段，会盖在建议列表/弹窗的底部一行上。改成不渲染当然更彻底，
//  但会导致 Notifications **重新挂载** —— 而 AutoUpdater 在挂载时会做一次
//  初始检查（PR#22413 就是这个 bug），于是每次补全列表开合都会重新检查更新。
//
//  所以选择「保持挂载、把高度压成 0」。这是典型的「卸载有副作用，所以选择隐藏」。
//
//  另外三个数值也是精确调过的：
//    marginTop = briefOwnsGap ? -2 : -1   拉进上方那一行间距里
//    justifyContent="flex-end"            多行通知时显示最后一行（最新的）
//    overflow="hidden"                    多余的行裁掉
//
//  第 2276-2295 行整段只在全屏时渲染（非全屏时通知在 footer 里正常显示，
//  不需要叠在输入框上）。
}

/**
 * Compute the initial paste ID by finding the max ID used in existing messages.
 * This handles --continue/--resume scenarios where we need to avoid ID collisions.
 */
// 【getInitialPasteId：扫历史消息，找出用过的最大编号】
//
//  --continue / --resume 恢复会话时，历史消息里可能已经有 `[Image #7]`
//  `[...Pasted text #12]`。如果新粘贴从 #1 开始，就会和旧附件撞号 ——
//  提交时还原出错误的内容。
//
//  所以这里扫两条路径：
//    1. message.imagePasteIds（图片的 id 列表，直接是数字）
//    2. 文本块里的引用（用 parseReferences 正则解析）
//
//  返回 maxId + 1，也就是「下一个可用号」。
//
//  第 2314 行 `Array.isArray(message.message.content)` 是必要的：
//  用户消息的 content 可能是字符串（老格式）也可能是块数组（新格式）。
//  只处理数组分支意味着**老格式里的引用不会被统计** —— 如果历史里有
//  很老的会话，ID 仍可能撞。这是兼容性妥协。
//
//  这个函数只在挂载时跑一次（见第 366 行的哨兵），所以 O(消息数) 的遍历
//  不会造成性能问题。
function getInitialPasteId(messages: Message[]): number {
  let maxId = 0;
  for (const message of messages) {
    if (message.type === 'user') {
      // Check image paste IDs
      if (message.imagePasteIds) {
        for (const id of message.imagePasteIds) {
          if (id > maxId) maxId = id;
        }
      }
      // Check text paste references in message content
      if (Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            const refs = parseReferences(block.text);
            for (const ref of refs) {
              if (ref.id > maxId) maxId = ref.id;
            }
          }
        }
      }
    }
  }
  return maxId + 1;
}
// 【buildBorderText：把 fast 图标画在边框上】
//
//  返回值是 {content, position: 'top', align: 'end', offset: 0} ——
//  也就是「在上边框、靠右、不偏移」。
//
//  这是 Ink 的 borderText 能力：边框本来是一条连续的线，可以在其中
//  「挖一段」放文字。用在这里，/fast 状态的图标就长在边框右上角，
//  不占用任何布局高度。
//
//  三个状态：
//    没开 fast        → undefined（不画）
//    开了，首次提示中  → 图标 + 暗色的 /fast
//    开了，提示已用完  → 只有图标
//
//  `chalk.dim('/fast')` 是这里唯一一处直接用 chalk 的地方（其余都用
//  <Text dimColor>）。因为 content 是**字符串**不是 JSX —— borderText 只接受
//  已经带 ANSI 的字符串，所以必须用 chalk 手工上色。
//
//  也就是说：**渲染层用组件，字符串层用 chalk**，两者不能混。
//  看到文件里只有这一处 import chalk，原因就在这里。
function buildBorderText(showFastIcon: boolean, showFastIconHint: boolean, fastModeCooldown: boolean): BorderTextOptions | undefined {
  if (!showFastIcon) return undefined;
  const fastSeg = showFastIconHint ? `${getFastIconString(true, fastModeCooldown)} ${chalk.dim('/fast')}` : getFastIconString(true, fastModeCooldown);
  return {
    content: ` ${fastSeg} `,
    position: 'top',
    align: 'end',
    offset: 0
  };
}
export default React.memo(PromptInput);
// 原文件此处有一行 255416 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。