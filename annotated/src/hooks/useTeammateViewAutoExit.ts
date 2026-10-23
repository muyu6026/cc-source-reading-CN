import { useEffect } from 'react'
import { useAppState, useSetAppState } from '../state/AppState.js'
import { exitTeammateView } from '../state/teammateViewHelpers.js'
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js'

/**
 * Auto-exits teammate viewing mode when the viewed teammate
 * is killed or encounters an error. Users stay viewing completed
 * teammates so they can review the full transcript.
 */
// 被查看的队友被杀/出错时自动退出查看模式；但已完成的队友保留，方便回看完整转录。
export function useTeammateViewAutoExit(): void {
  const setAppState = useSetAppState()
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId)
  // Select only the viewed task, not the full tasks map — otherwise every
  // streaming update from any teammate re-renders this hook.
// 只选「被查看的那条 task」而非整张 tasks map：否则任何队友的流式更新都会重渲染本 hook。
  const task = useAppState(s =>
    s.viewingAgentTaskId ? s.tasks[s.viewingAgentTaskId] : undefined,
  )

  const viewedTask = task && isInProcessTeammateTask(task) ? task : undefined
  const viewedStatus = viewedTask?.status
  const viewedError = viewedTask?.error
  const taskExists = task !== undefined

  useEffect(() => {
    // Not viewing any teammate
    if (!viewingAgentTaskId) {
      return
    }

    // Task no longer exists in the map — evicted out from under us.
    // Check raw `task` not teammate-narrowed `viewedTask`; local_agent
    // tasks exist but narrow to undefined, which would eject immediately.
// 判断「任务已从 map 中消失」要用原始 task 而非 teammate 收窄后的 viewedTask——
// local_agent 任务存在但收窄成 undefined，会立刻误踢出查看。
    if (!taskExists) {
      exitTeammateView(setAppState)
      return
    }
    // Status checks below are teammate-only (viewedTask is teammate-narrowed).
    // For local_agent, viewedStatus is undefined → all checks falsy → no eject.
    if (!viewedTask) return

    // Auto-exit if teammate is killed, stopped, has error, or is no longer running
    // This handles shutdown scenarios where teammate becomes inactive
    if (
// 自动退出条件：队友 killed / failed / 有 error / 或状态既非 running 也非 completed 也非 pending；
// 下面这段状态判定只针对 teammate（viewedTask 已收窄），local_agent 的 viewedStatus 为 undefined 全落空不踢。
      viewedStatus === 'killed' ||
      viewedStatus === 'failed' ||
      viewedError ||
      (viewedStatus !== 'running' &&
        viewedStatus !== 'completed' &&
        viewedStatus !== 'pending')
    ) {
      exitTeammateView(setAppState)
      return
    }
  }, [
    viewingAgentTaskId,
    taskExists,
    viewedTask,
    viewedStatus,
    viewedError,
    setAppState,
  ])
}
