/**
 * CancelRequestHandler component for handling cancel/escape keybinding.
 *
 * Must be rendered inside KeybindingSetup to have access to the keybinding context.
 * This component renders nothing - it just registers the cancel keybinding handler.
 */
// 【文件定位】Esc / Ctrl+C / Ctrl+X Ctrl+K 三个「停止」键的统一仲裁者。渲染 null，纯注册 keybinding handler。三个按键的语义分工是理解这个文件的钥匙：Esc 中断当前轮次，Ctrl+C 更强（teammate 视图下连后台 agent 一起杀），Ctrl+X Ctrl+K 两段式专杀后台 agent。
import { useCallback, useRef } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from 'src/state/AppState.js'
import { isVimModeEnabled } from '../components/PromptInput/utils.js'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import { useNotifications } from '../context/notifications.js'
import { useIsOverlayActive } from '../context/overlayContext.js'
import { useCommandQueue } from '../hooks/useCommandQueue.js'
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import type { Screen } from '../screens/REPL.js'
import { exitTeammateView } from '../state/teammateViewHelpers.js'
import {
  killAllRunningAgentTasks,
  markAgentsNotified,
} from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { PromptInputMode, VimMode } from '../types/textInputTypes.js'
import {
  clearCommandQueue,
  enqueuePendingNotification,
  hasCommandsInQueue,
} from '../utils/messageQueueManager.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'

/** Time window in ms during which a second press kills all background agents. */
const KILL_AGENTS_CONFIRM_WINDOW_MS = 3000
// 两段式确认窗口：3 秒内第二按才真杀。杀所有后台 agent 是破坏性操作，防误触。

type CancelRequestHandlerProps = {
  setToolUseConfirmQueue: (
    f: (toolUseConfirmQueue: ToolUseConfirm[]) => ToolUseConfirm[],
  ) => void
  onCancel: () => void
  onAgentsKilled: () => void
  isMessageSelectorVisible: boolean
  screen: Screen
  abortSignal?: AbortSignal
  popCommandFromQueue?: () => void
  vimMode?: VimMode
  isLocalJSXCommand?: boolean
  isSearchingHistory?: boolean
  isHelpOpen?: boolean
  inputMode?: PromptInputMode
  inputValue?: string
  streamMode?: SpinnerMode
}

/**
 * Component that handles cancel requests via keybinding.
 * Renders null but registers the 'chat:cancel' keybinding handler.
 */
export function CancelRequestHandler(props: CancelRequestHandlerProps): null {
  const {
    setToolUseConfirmQueue,
    onCancel,
    onAgentsKilled,
    isMessageSelectorVisible,
    screen,
    abortSignal,
    popCommandFromQueue,
    vimMode,
    isLocalJSXCommand,
    isSearchingHistory,
    isHelpOpen,
    inputMode,
    inputValue,
    streamMode,
  } = props
  const store = useAppStateStore()
  const setAppState = useSetAppState()
  const queuedCommandsLength = useCommandQueue().length
  const { addNotification, removeNotification } = useNotifications()
  const lastKillAgentsPressRef = useRef<number>(0)
  const viewSelectionMode = useAppState(s => s.viewSelectionMode)

  const handleCancel = useCallback(() => {
    const cancelProps = {
      source:
        'escape' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      streamMode:
        streamMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }

    // Priority 1: If there's an active task running, cancel it first
    // This takes precedence over queue management so users can always interrupt Claude
    if (abortSignal !== undefined && !abortSignal.aborted) {
// 优先级 1：有活动任务在跑就先取消它——压过队列管理，「随时能打断 Claude」是硬承诺。注意 setToolUseConfirmQueue(() => []) 顺手清掉待确认的权限对话框：任务都没了，对话框没有存在意义。
      logEvent('tengu_cancel', cancelProps)
      setToolUseConfirmQueue(() => [])
      onCancel()
      return
    }

    // Priority 2: Pop queue when Claude is idle (no running task to cancel)
    if (hasCommandsInQueue()) {
// 优先级 2：Claude 空闲时弹队列（popCommandFromQueue）。队列里的下一条命令是用户提前输入的，Esc = 撤回最后排的那条。
      if (popCommandFromQueue) {
        popCommandFromQueue()
        return
      }
    }

    // Fallback: nothing to cancel or pop (shouldn't reach here if isActive is correct)
    logEvent('tengu_cancel', cancelProps)
    setToolUseConfirmQueue(() => [])
    onCancel()
  }, [
    abortSignal,
    popCommandFromQueue,
    setToolUseConfirmQueue,
    onCancel,
    streamMode,
  ])

  // Determine if this handler should be active
  // Other contexts (Transcript, HistorySearch, Help) have their own escape handlers
  // Overlays (ModelPicker, ThinkingToggle, etc.) register themselves via useRegisterOverlay
  // Local JSX commands (like /model, /btw) handle their own input
  const isOverlayActive = useIsOverlayActive()
  const canCancelRunningTask = abortSignal !== undefined && !abortSignal.aborted
// isContextActive 是「这个 handler 该不该说话」的总闸：Transcript/HistorySearch/Help 各有自己的 Esc 处理；overlay（ModelPicker 等）自己注册；本地 JSX 命令（/model、/btw）自管输入；vim INSERT 模式下 Esc 是退出插入态不是取消。
  const hasQueuedCommands = queuedCommandsLength > 0
  // When in bash/background mode with empty input, escape should exit the mode
  // rather than cancel the request. Let PromptInput handle mode exit.
  // This only applies to Escape, not Ctrl+C which should always cancel.
  const isInSpecialModeWithEmptyInput =
    inputMode !== undefined && inputMode !== 'prompt' && !inputValue
// 特殊模式空输入时 Esc 让位给 PromptInput 的「退出模式」——bash/background 模式下 Esc 应该是离开该模式，而不是取消请求。只对 Esc 生效，Ctrl+C 永远取消。
  // When viewing a teammate's transcript, let useBackgroundTaskNavigation handle Escape
  const isViewingTeammate = viewSelectionMode === 'viewing-agent'
  // Context guards: other screens/overlays handle their own cancel
  const isContextActive =
    screen !== 'transcript' &&
    !isSearchingHistory &&
    !isMessageSelectorVisible &&
    !isLocalJSXCommand &&
    !isHelpOpen &&
    !isOverlayActive &&
    !(isVimModeEnabled() && vimMode === 'INSERT')

  // Escape (chat:cancel) defers to mode-exit when in special mode with empty
  // input, and to useBackgroundTaskNavigation when viewing a teammate
  const isEscapeActive =
    isContextActive &&
    (canCancelRunningTask || hasQueuedCommands) &&
    !isInSpecialModeWithEmptyInput &&
    !isViewingTeammate
// isEscapeActive = 上下文激活 + 确实有东西可取消/弹 + 不在特殊模式空输入 + 没在队友视图。最后一条：看队友 transcript 时 Esc 归 useBackgroundTaskNavigation 管。

  // Ctrl+C (app:interrupt): when viewing a teammate, stops everything and
  // returns to main thread. Otherwise just handleCancel. Must NOT claim
  // ctrl+c when main is idle at the prompt — that blocks the copy-selection
  // handler and double-press-to-exit from ever seeing the keypress.
  const isCtrlCActive =
    isContextActive &&
    (canCancelRunningTask || hasQueuedCommands || isViewingTeammate)
// isCtrlCActive 注释交代了一个关键 negative case：主提示符空闲时绝不能认领 ctrl+c——那会挡住复制选择（copy-selection）和双击退出。所以 Ctrl+C 的活动条件比 Esc 多一条 isViewingTeammate。

  useKeybinding('chat:cancel', handleCancel, {
    context: 'Chat',
    isActive: isEscapeActive,
  })

  // Shared kill path: stop all agents, suppress per-agent notifications,
  // emit SDK events, enqueue a single aggregate model-facing notification.
  // Returns true if anything was killed.
  const killAllAgentsAndNotify = useCallback((): boolean => {
// killAllAgentsAndNotify 共享杀路径：从 store 直读（避免陈旧闭包）→ 过滤 running 的 local_agent → killAllRunningAgentTasks → 逐个 markAgentsNotified（抑制每个 agent 各自的完成通知）→ emitTaskTerminatedSdk 发 SDK 事件 → 汇总成一条模型可见通知（单数/复数两种文案）。返回 false = 什么都没杀，调用方据此区分「已处理」和「无操作」。
    const tasks = store.getState().tasks
    const running = Object.entries(tasks).filter(
      ([, t]) => t.type === 'local_agent' && t.status === 'running',
    )
    if (running.length === 0) return false
    killAllRunningAgentTasks(tasks, setAppState)
    const descriptions: string[] = []
    for (const [taskId, task] of running) {
      markAgentsNotified(taskId, setAppState)
      descriptions.push(task.description)
      emitTaskTerminatedSdk(taskId, 'stopped', {
        toolUseId: task.toolUseId,
        summary: task.description,
      })
    }
    const summary =
      descriptions.length === 1
        ? `Background agent "${descriptions[0]}" was stopped by the user.`
        : `${descriptions.length} background agents were stopped by the user: ${descriptions.map(d => `"${d}"`).join(', ')}.`
    enqueuePendingNotification({ value: summary, mode: 'task-notification' })
    onAgentsKilled()
    return true
  }, [store, setAppState, onAgentsKilled])

  // Ctrl+C (app:interrupt). Scoped to teammate-view: killing agents from the
  // main prompt stays a deliberate gesture (chat:killAgents), not a
  // side-effect of cancelling a turn.
  const handleInterrupt = useCallback(() => {
// handleInterrupt：teammate 视图下先杀全部 agent 再退视图；主线程下只在有东西可取消时走 handleCancel。注释点明设计意图：从主提示符杀 agent 必须是有意手势（chat:killAgents），不是取消轮次的副作用。
    if (isViewingTeammate) {
      killAllAgentsAndNotify()
      exitTeammateView(setAppState)
    }
    if (canCancelRunningTask || hasQueuedCommands) {
      handleCancel()
    }
  }, [
    isViewingTeammate,
    killAllAgentsAndNotify,
    setAppState,
    canCancelRunningTask,
    hasQueuedCommands,
    handleCancel,
  ])

  useKeybinding('app:interrupt', handleInterrupt, {
    context: 'Global',
    isActive: isCtrlCActive,
  })

  // chat:killAgents uses a two-press pattern: first press shows a
  // confirmation hint, second press within the window actually kills all
  // agents. Reads tasks from the store directly to avoid stale closures.
  const handleKillAgents = useCallback(() => {
    const tasks = store.getState().tasks
    const hasRunningAgents = Object.values(tasks).some(
      t => t.type === 'local_agent' && t.status === 'running',
    )
    if (!hasRunningAgents) {
// 没有运行中的 agent 时第一按直接提示「No background agents running」——不进入确认窗口，避免用户按完第一按再按一次却什么都不发生的困惑。
      addNotification({
        key: 'kill-agents-none',
        text: 'No background agents running',
        priority: 'immediate',
        timeoutMs: 2000,
      })
      return
    }
    const now = Date.now()
    const elapsed = now - lastKillAgentsPressRef.current
    if (elapsed <= KILL_AGENTS_CONFIRM_WINDOW_MS) {
// 窗口内第二按：清零计时器、撤确认通知、clearCommandQueue（队列里的命令也一并作废——杀 agent 是「全部停下」语义）、走共享杀路径。
      // Second press within window -- kill all background agents
      lastKillAgentsPressRef.current = 0
      removeNotification('kill-agents-confirm')
      logEvent('tengu_cancel', {
        source:
          'kill_agents' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      clearCommandQueue()
      killAllAgentsAndNotify()
      return
    }
    // First press -- show confirmation hint in status bar
    lastKillAgentsPressRef.current = now
// 第一按：显示「再按一次 <快捷键> 停止后台 agent」，timeoutMs 与确认窗口等长——提示消失的时间点就是窗口关闭的时间点，视觉与语义同步。快捷键显示走 getShortcutDisplay（尊重用户改键）。
    const shortcut = getShortcutDisplay(
      'chat:killAgents',
      'Chat',
      'ctrl+x ctrl+k',
    )
    addNotification({
      key: 'kill-agents-confirm',
      text: `Press ${shortcut} again to stop background agents`,
      priority: 'immediate',
      timeoutMs: KILL_AGENTS_CONFIRM_WINDOW_MS,
    })
  }, [store, addNotification, removeNotification, killAllAgentsAndNotify])

  // Must stay always-active: ctrl+x is consumed as a chord prefix regardless
  // of isActive (because ctrl+x ctrl+e is always live), so an inactive handler
  // here would leak ctrl+k to readline kill-line. Handler gates internally.
// chat:killAgents 必须保持 always-active：ctrl+x 作为 chord 前缀无论 isActive 都会被消费（ctrl+x ctrl+e 永远活着），这里设 isActive:false 会把 ctrl+k 泄漏给 readline 的 kill-line。所以闸门做在 handler 内部（hasRunningAgents 检查），不做在 isActive 上。
  useKeybinding('chat:killAgents', handleKillAgents, {
    context: 'Chat',
  })

  return null
}
