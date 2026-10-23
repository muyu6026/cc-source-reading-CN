import { useEffect, useRef } from 'react'
import { KeyboardEvent } from '../ink/events/keyboard-event.js'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge until REPL wires handleKeyDown to <Box onKeyDown>
// eslint 特批说明：REPL 还没把 handleKeyDown 挂到 <Box onKeyDown> 上，
// 这个 hook 暂时借 useInput 收键，属向后兼容的过渡桥接。
import { useInput } from '../ink.js'
import {
  type AppState,
  useAppState,
  useSetAppState,
} from '../state/AppState.js'
import {
  enterTeammateView,
  exitTeammateView,
} from '../state/teammateViewHelpers.js'
import {
  getRunningTeammatesSorted,
  InProcessTeammateTask,
} from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import {
  type InProcessTeammateTaskState,
  isInProcessTeammateTask,
} from '../tasks/InProcessTeammateTask/types.js'
import { isBackgroundTask } from '../tasks/types.js'

// Step teammate selection by delta, wrapping across leader(-1)..teammates(0..n-1)..hide(n).
// First step from a collapsed tree expands it and parks on leader.
// 按 delta 步进队友选择，越界回绕：索引 -1 = 主代理（leader），
// 0..n-1 = 各队友，n = 「隐藏」行。从收起态第一次步进只负责展开并停在 leader。
function stepTeammateSelection(
  delta: 1 | -1,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
// delta 只接受 1 或 -1；setAppState 由调用方传入，
// 此模块不直接 import store，保持可独立测试。
  setAppState(prev => {
    const currentCount = getRunningTeammatesSorted(prev.tasks).length
    if (currentCount === 0) return prev
// 没有运行中队友时原样返回 prev——不制造新 state 对象，
// 避免无意义重渲染。

    if (prev.expandedView !== 'teammates') {
      return {
        ...prev,
        expandedView: 'teammates' as const,
        viewSelectionMode: 'selecting-agent',
        selectedIPAgentIndex: -1,
      }
    }
// 当前不在 teammates 展开态：首次步进只展开并把选择落到
// leader(-1)，不移动队友索引，也不碰 viewing 状态。

    const maxIdx = currentCount // hide row
// maxIdx 比队友数多 1，多出来的一行是「隐藏」行
// （收起 spinner 树专用）。
    const cur = prev.selectedIPAgentIndex
    const next =
      delta === 1
        ? cur >= maxIdx
          ? -1
          : cur + 1
        : cur <= -1
          ? maxIdx
          : cur - 1
// 回绕方向不对称：down 越过 maxIdx 回 -1，up 在 -1 时回 maxIdx。
// 返回时统一把 viewSelectionMode 复位成 selecting-agent，
// 防止从 viewing 态直接步进时残留查看模式。
    return {
      ...prev,
      selectedIPAgentIndex: next,
      viewSelectionMode: 'selecting-agent',
    }
  })
// 整个步进走 setAppState(prev => ...) 函数式更新：读最新 state、
// 不依赖渲染闭包，也免除了把 tasks 依赖进 useCallback。
}

/**
 * Custom hook that handles Shift+Up/Down keyboard navigation for background tasks.
 * When teammates (swarm) are present, navigates between leader and teammates.
 * When only non-teammate background tasks exist, opens the background tasks dialog.
 * Also handles Enter to confirm selection, 'f' to view transcript, and 'k' to kill.
 */
export function useBackgroundTaskNavigation(options?: {
// 职责：Shift+↑/↓ 在后台任务间导航。有队友时切 leader/队友树，
// 只有普通后台任务时调 onOpenBackgroundTasks 开对话框；
// 另管 Enter 确认、f 看记录、k 杀队友。
  onOpenBackgroundTasks?: () => void
}): { handleKeyDown: (e: KeyboardEvent) => void } {
// 返回 handleKeyDown 交给 REPL 组合键链；对话框开启走注入的
// options 回调，hook 本身不依赖 REPL。
  const tasks = useAppState(s => s.tasks)
  const viewSelectionMode = useAppState(s => s.viewSelectionMode)
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId)
  const selectedIPAgentIndex = useAppState(s => s.selectedIPAgentIndex)
  const setAppState = useSetAppState()
// 四个 useAppState 选择器订阅同一 store；teammateTasks 每渲染重算
// （getRunningTeammatesSorted 是纯函数，无缓存）。

  // Filter to running teammates and sort alphabetically to match TeammateSpinnerTree display
  const teammateTasks = getRunningTeammatesSorted(tasks)
  const teammateCount = teammateTasks.length
// 字母序排序是为了与 TeammateSpinnerTree 的显示顺序逐行对齐——
// 界面上的第 N 行必须等于 selectedIPAgentIndex = N，
// 否则方向键会跳错行。

  // Check for non-teammate background tasks (local_agent, local_bash, etc.)
  const hasNonTeammateBackgroundTasks = Object.values(tasks).some(
    t => isBackgroundTask(t) && t.type !== 'in_process_teammate',
  )
// 非队友后台任务（local_agent/local_bash 等）走另一条路：
// 不进队友树，直接开后台任务对话框。

  // Track previous teammate count to detect when teammates are removed
  const prevTeammateCountRef = useRef<number>(teammateCount)
// 用 ref 记住上一帧的队友数：effect 里要区分「首次挂载就是 0」
// 和「队友被移除后变成 0」，后者才需要重置选择索引。

  // Clamp selection index if teammates are removed or reset when count becomes 0
  useEffect(() => {
    const prevCount = prevTeammateCountRef.current
    prevTeammateCountRef.current = teammateCount

    setAppState(prev => {
      const currentTeammates = getRunningTeammatesSorted(prev.tasks)
      const currentCount = currentTeammates.length

      // When teammates are removed (count goes from >0 to 0), reset selection
      // Only reset if we previously had teammates (not on initial mount with 0)
      // Don't clobber viewSelectionMode if actively viewing a teammate transcript —
      // the user may be reviewing a completed teammate and needs escape to exit
// 三个条件同时满足才重置：当前 0 个 + 上一帧 >0 + 索引不是 -1。
// 初始挂载（prevCount=0）不动状态，避免开机就乱清。
      if (
        currentCount === 0 &&
        prevCount > 0 &&
        prev.selectedIPAgentIndex !== -1
      ) {
        if (prev.viewSelectionMode === 'viewing-agent') {
          return {
            ...prev,
            selectedIPAgentIndex: -1,
          }
        }
        return {
          ...prev,
          selectedIPAgentIndex: -1,
          viewSelectionMode: 'none',
        }
      }
// 正在看已完成队友的记录时只清索引、保留 viewing-agent 模式——
// 用户还要靠 Esc 自己退出查看；其余情况连模式一起清。

      // Clamp if index is out of bounds
      // Max valid index is currentCount (the "hide" row) when spinner tree is shown
      const maxIndex =
        prev.expandedView === 'teammates' ? currentCount : currentCount - 1
// 夹取上限随展开态变化：teammates 展开时「隐藏」行
// （index = count）合法，未展开时最大只能到 count-1。
      if (currentCount > 0 && prev.selectedIPAgentIndex > maxIndex) {
        return {
          ...prev,
          selectedIPAgentIndex: maxIndex,
        }
      }

      return prev
    })
  }, [teammateCount, setAppState])
// 依赖只有 teammateCount 和 setAppState：队友数变化才是重算时机，
// 每帧都夹取反而会和步进逻辑抢写同一字段。

  // Get the selected teammate's task info
  const getSelectedTeammate = (): {
    taskId: string
    task: InProcessTeammateTaskState
  } | null => {
    if (teammateCount === 0) return null
    const selectedIndex = selectedIPAgentIndex
    const task = teammateTasks[selectedIndex]
    if (!task) return null

    return { taskId: task.id, task }
  }
// 取当前选中队友；索引越界或空树都返回 null，调用方各自判空。

  const handleKeyDown = (e: KeyboardEvent): void => {
    // Escape in viewing mode:
    // - If teammate is running: abort current work only (stops current turn, teammate stays alive)
    // - If teammate is not running (completed/killed/failed): exit the view back to leader
// Esc 在查看态的两栖语义：队友还在跑 → 只中止当前轮
// （currentWorkAbortController），队友本身活着；已结束 → 退出查看。
    if (e.key === 'escape' && viewSelectionMode === 'viewing-agent') {
      e.preventDefault()
      const taskId = viewingAgentTaskId
      if (taskId) {
        const task = tasks[taskId]
        if (isInProcessTeammateTask(task) && task.status === 'running') {
          // Abort currentWorkAbortController (stops current turn) NOT abortController (kills teammate)
          task.currentWorkAbortController?.abort()
          return
        }
// 故意用 currentWorkAbortController 而不是 abortController：
// 后者是杀死整个队友进程的开关，这里只想停掉它这一轮的工作。
      }
      // Teammate is not running or task doesn't exist — exit the view
      exitTeammateView(setAppState)
      return
// 队友不在跑（或任务已不存在）→ 直接退出查看态，不停任何东西。
    }

    // Escape in selection mode: exit selection without aborting leader
    if (e.key === 'escape' && viewSelectionMode === 'selecting-agent') {
      e.preventDefault()
      setAppState(prev => ({
        ...prev,
        viewSelectionMode: 'none',
        selectedIPAgentIndex: -1,
      }))
      return
    }
// Esc 在选择态：只退出选择模式，不动 leader 进行中的工作。

    // Shift+Up/Down for teammate transcript switching (with wrapping)
    // Index -1 represents the leader, 0+ are teammates
    // When showSpinnerTree is true, index === teammateCount is the "hide" row
// Shift+↑/↓ 的路由：有队友 → 步进选择；没队友但有普通后台任务
// → 开对话框。
    if (e.shift && (e.key === 'up' || e.key === 'down')) {
      e.preventDefault()
      if (teammateCount > 0) {
        stepTeammateSelection(e.key === 'down' ? 1 : -1, setAppState)
      } else if (hasNonTeammateBackgroundTasks) {
        options?.onOpenBackgroundTasks?.()
      }
      return
// 两条分支都 preventDefault + return，避免按键继续冒泡到输入框。
    }

    // 'f' to view selected teammate's transcript (only in selecting mode)
    if (
      e.key === 'f' &&
      viewSelectionMode === 'selecting-agent' &&
      teammateCount > 0
    ) {
      e.preventDefault()
      const selected = getSelectedTeammate()
      if (selected) {
        enterTeammateView(selected.taskId, setAppState)
      }
      return
    }
// f 只在 selecting 态有效：把选中队友设为查看目标
// （enterTeammateView）。

    // Enter to confirm selection (only when in selecting mode)
    if (e.key === 'return' && viewSelectionMode === 'selecting-agent') {
      e.preventDefault()
      if (selectedIPAgentIndex === -1) {
        exitTeammateView(setAppState)
      } else if (selectedIPAgentIndex >= teammateCount) {
        // "Hide" row selected - collapse the spinner tree
        setAppState(prev => ({
          ...prev,
          expandedView: 'none' as const,
          viewSelectionMode: 'none',
          selectedIPAgentIndex: -1,
// 「隐藏」行被回车：收起整棵队友树并退回 none，
// 等价于视觉上隐藏 spinner。
        }))
      } else {
        const selected = getSelectedTeammate()
        if (selected) {
          enterTeammateView(selected.taskId, setAppState)
        }
      }
      return
    }
// 回车的三态：-1 回 leader；>=count 命中隐藏行收起树；
// 其余进入查看。

    // k to kill selected teammate (only in selecting mode)
    if (
      e.key === 'k' &&
      viewSelectionMode === 'selecting-agent' &&
      selectedIPAgentIndex >= 0
    ) {
      e.preventDefault()
      const selected = getSelectedTeammate()
      if (selected && selected.task.status === 'running') {
        void InProcessTeammateTask.kill(selected.taskId, setAppState)
      }
      return
    }
// k 只杀 running 的队友；对已结束的任务静默忽略，
// 防止误触报错。
  }

  // Backward-compat bridge: REPL.tsx doesn't yet wire handleKeyDown to
  // <Box onKeyDown>. Subscribe via useInput and adapt InputEvent →
  // KeyboardEvent until the consumer is migrated (separate PR).
  // TODO(onKeyDown-migration): remove once REPL passes handleKeyDown.
// 过渡桥接：REPL 尚未接线，这里用 useInput 收键并包成
// KeyboardEvent，等 REPL 迁移后随 TODO 一起删。
  useInput((_input, _key, event) => {
    handleKeyDown(new KeyboardEvent(event.keypress))
  })
// useInput 回调里把 InputEvent 适配成 KeyboardEvent——
// 两套事件体系的 key 字段名不同，这里只透传 keypress。

  return { handleKeyDown }
}
