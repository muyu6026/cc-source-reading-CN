import { logEvent } from '../services/analytics/index.js'
import { isTerminalTaskStatus } from '../Task.js'
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'

// Inlined from framework.ts — importing creates a cycle through
// BackgroundTasksDialog. Keep in sync with PANEL_GRACE_MS there.
// 三十秒宽限期：终态任务不立刻消失，让用户看到最后一帧结果再清。数值与对话框那份必须同步
const PANEL_GRACE_MS = 30_000

import type { AppState } from './AppState.js'

// Inline type check instead of importing isLocalAgentTask — breaks the
// teammateViewHelpers → LocalAgentTask runtime edge that creates a cycle
// through BackgroundTasksDialog.
// 类型守卫内联而不导入：这里导一次就会形成「本文件 → 本地代理任务 → 任务对话框」的环，运行时直接崩
function isLocalAgent(task: unknown): task is LocalAgentTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_agent'
  )
}

/**
 * Return the task released back to stub form: retain dropped, messages
 * cleared, evictAfter set if terminal. Shared by exitTeammateView and
 * the switch-away path in enterTeammateView.
 */
// 释放只做三件事：撤保留、清消息、按是否终态安排淘汰。两个退出路径共用这一份
function release(task: LocalAgentTaskState): LocalAgentTaskState {
  return {
    ...task,
    retain: false,
    messages: undefined,
    diskLoaded: false,
// 只有终态才给淘汰时间；运行中的任务释放后必须留在表里，否则会丢掉中止入口
    evictAfter: isTerminalTaskStatus(task.status)
      ? Date.now() + PANEL_GRACE_MS
      : undefined,
  }
}

/**
 * Transitions the UI to view a teammate's transcript.
 * Sets viewingAgentTaskId and, for local_agent, retain: true (blocks eviction,
 * enables stream-append, triggers disk bootstrap) and clears evictAfter.
 * If switching from another agent, releases the previous one back to stub.
 */
// 进入视图是幂等的：已经在这个视图且已保留就直接返回原状态，避免每次渲染都写一次状态
export function enterTeammateView(
  taskId: string,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  logEvent('tengu_transcript_view_enter', {})
// 三个条件分别对应三件事：要不要保留、要不要切视图、要不要释放上一个
  setAppState(prev => {
    const task = prev.tasks[taskId]
    const prevId = prev.viewingAgentTaskId
    const prevTask = prevId !== undefined ? prev.tasks[prevId] : undefined
// 只有「切到另一个本地代理」才算切换：目标不是本地代理时没有可释放的对象
    const switching =
      prevId !== undefined &&
      prevId !== taskId &&
      isLocalAgent(prevTask) &&
      prevTask.retain
    const needsRetain =
      isLocalAgent(task) && (!task.retain || task.evictAfter !== undefined)
    const needsView =
      prev.viewingAgentTaskId !== taskId ||
      prev.viewSelectionMode !== 'viewing-agent'
// 三者都不需要时返回原引用：这是让外层跳过更新、不触发重渲染的关键
    if (!needsRetain && !needsView && !switching) return prev
    let tasks = prev.tasks
// 只有真要改任务表时才浅复制：不需要时保持引用，下游的浅比较才不会白跑
    if (switching || needsRetain) {
      tasks = { ...prev.tasks }
// 切换时先释放旧任务：不释放的话两个任务同时被保留，内存与消息流订阅会一起叠加
      if (switching) tasks[prevId] = release(prevTask)
      if (needsRetain) {
// 保留的同时要清掉淘汰时间：否则宽限期一到，正在看的任务会被静默移除
        tasks[taskId] = { ...task, retain: true, evictAfter: undefined }
      }
    }
    return {
      ...prev,
      viewingAgentTaskId: taskId,
      viewSelectionMode: 'viewing-agent',
      tasks,
    }
  })
}

/**
 * Exit teammate transcript view and return to leader's view.
 * Drops retain and clears messages back to stub form; if terminal,
 * schedules eviction via evictAfter so the row lingers briefly.
 */
// 退出视图只改视图字段，任务表在确有保留对象时才动
export function exitTeammateView(
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  logEvent('tengu_transcript_view_exit', {})
  setAppState(prev => {
    const id = prev.viewingAgentTaskId
    const cleared = {
      ...prev,
      viewingAgentTaskId: undefined,
      viewSelectionMode: 'none' as const,
    }
// 没有查看对象时只需归零选择模式；已经归零就返回原引用
    if (id === undefined) {
      return prev.viewSelectionMode === 'none' ? prev : cleared
    }
    const task = prev.tasks[id]
// 不是本地代理、或本来就没保留：只清视图字段，任务表整个复用
    if (!isLocalAgent(task) || !task.retain) return cleared
    return {
      ...cleared,
      tasks: { ...prev.tasks, [id]: release(task) },
    }
  })
}

/**
 * Context-sensitive x: running → abort, terminal → dismiss.
 * Dismiss sets evictAfter=0 so the filter hides immediately.
 * If viewing the dismissed agent, also exits to leader.
 */
// 一个按键两种语义：运行中是中止，终态是移除——用户不需要记两套操作
export function stopOrDismissAgent(
  taskId: string,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (!isLocalAgent(task)) return prev
// 中止只发信号、不改状态：状态由任务自己的失败收尾路径写，这里抢先写会和它打架
    if (task.status === 'running') {
      task.abortController?.abort()
      return prev
    }
// 淘汰时间设成零表示「立即隐藏」，重复设置没有意义，直接返回
    if (task.evictAfter === 0) return prev
    const viewingThis = prev.viewingAgentTaskId === taskId
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
// 释放再加零淘汰：这一行让任务立刻从列表消失，而不是等三十秒宽限期
        [taskId]: { ...release(task), evictAfter: 0 },
      },
// 正在看的就是它，顺手退回主线视图：否则界面会停在一个已经被移除的任务上
      ...(viewingThis && {
        viewingAgentTaskId: undefined,
        viewSelectionMode: 'none',
      }),
    }
  })
}
