// Union of all concrete task state types
// Use this for components that need to work with any task type
// 注释：所有具体任务状态的联合类型，供需要兼容任意任务类型的组件使用。

import type { DreamTaskState } from './DreamTask/DreamTask.js'
// 引入七种具体任务状态类型（Dream / InProcessTeammate / LocalAgent / LocalShell 等）。
import type { InProcessTeammateTaskState } from './InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from './LocalAgentTask/LocalAgentTask.js'
import type { LocalShellTaskState } from './LocalShellTask/guards.js'
import type { LocalWorkflowTaskState } from './LocalWorkflowTask/LocalWorkflowTask.js'
import type { MonitorMcpTaskState } from './MonitorMcpTask/MonitorMcpTask.js'
import type { RemoteAgentTaskState } from './RemoteAgentTask/RemoteAgentTask.js'

export type TaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | RemoteAgentTaskState
  | InProcessTeammateTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | DreamTaskState
// TaskState 联合类型：涵盖全部七种任务状态。

// Task types that can appear in the background tasks indicator
// 注释：可在后台任务指示器出现的任务类型集合。
export type BackgroundTaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | RemoteAgentTaskState
  | InProcessTeammateTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | DreamTaskState
// BackgroundTaskState 联合类型：当前内容与 TaskState 一致。

/**
 * Check if a task should be shown in the background tasks indicator.
 * A task is considered a background task if:
 * 1. It is running or pending
 * 2. It has been explicitly backgrounded (not a foreground task)
 */
// 注释：判定任务是否应显示在后台指示器——需处于运行/挂起且已后台化。
export function isBackgroundTask(task: TaskState): task is BackgroundTaskState {
// 类型守卫 isBackgroundTask：通过状态与 isBackgrounded 标志收窄类型。
  if (task.status !== 'running' && task.status !== 'pending') {
// 非运行且非挂起的任务不算后台任务。
    return false
  }
  // Foreground tasks (isBackgrounded === false) are not yet "background tasks"
// 注释：前台任务（isBackgrounded===false）尚未成为后台任务。
  if ('isBackgrounded' in task && task.isBackgrounded === false) {
    return false
  }
  return true
// 其余情况均视为后台任务并返回 true。
}
