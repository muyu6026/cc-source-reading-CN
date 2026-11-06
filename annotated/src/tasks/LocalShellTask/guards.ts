// Pure type + type guard for LocalShellTask state.
// Extracted from LocalShellTask.tsx so non-React consumers (stopTask.ts via
// print.ts) don't pull React/ink into the module graph.
// 纯类型与类型守卫文件：把 LocalShellTask 的状态类型独立出来，让非 React 的消费者（如 stopTask、print）不必把 React/ink 拉进模块图。

import type { TaskStateBase } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import type { ShellCommand } from '../../utils/ShellCommand.js'

export type BashTaskKind = 'bash' | 'monitor'
// 任务种类：bash 普通命令或 monitor 监听型。

export type LocalShellTaskState = TaskStateBase & {
// 状态结构：在通用 TaskStateBase 上加本地 bash 专属字段；type 固定为「local_bash」以兼容已持久化的会话状态。
  type: 'local_bash' // Keep as 'local_bash' for backward compatibility with persisted session state
  command: string
  result?: {
    code: number
    interrupted: boolean
  }
  completionStatusSentInAttachment: boolean
// 标记完成状态是否已通过附件发出，避免重复。
  shellCommand: ShellCommand | null
  unregisterCleanup?: () => void
  cleanupTimeoutId?: NodeJS.Timeout
  // Track what we last reported for computing deltas (total lines from TaskOutput)
  lastReportedTotalLines: number
// 记录上次汇报的总行数，用于计算增量（相对 TaskOutput）。
  // Whether the task has been backgrounded (false = foreground running, true = backgrounded)
  isBackgrounded: boolean
  // Agent that spawned this task. Used to kill orphaned bash tasks when the
  // agent exits (see killShellTasksForAgent). Undefined = main thread.
  agentId?: AgentId
// 记录是哪个 agent 派生的任务，agent 退出时据此清理孤儿 bash 任务。
  // UI display variant. 'monitor' → shows description instead of command,
  // 'Monitor details' dialog title, distinct status bar pill.
  kind?: BashTaskKind
}

export function isLocalShellTask(task: unknown): task is LocalShellTaskState {
// 类型守卫：判断未知任务是否为本地 bash 任务，依据 type === 'local_bash'。
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_bash'
  )
}
