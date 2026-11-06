// 停止运行中任务的共享逻辑，供 TaskStopTool 与 SDK stop_task 复用。
// Shared logic for stopping a running task.
// Used by TaskStopTool (LLM-invoked) and SDK stop_task control request.

import type { AppState } from '../state/AppState.js'
import type { TaskStateBase } from '../Task.js'
import { getTaskByType } from '../tasks.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
// 导入应用状态、任务类型、事件队列与本地 shell 判定等依赖。
import { isLocalShellTask } from './LocalShellTask/guards.js'

// 停止任务专用错误，携带 not_found / not_running / unsupported_type 码。
export class StopTaskError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'not_running' | 'unsupported_type',
  ) {
    super(message)
    this.name = 'StopTaskError'
  }
}

// 停止任务的上下文：读取与写入应用状态。
type StopTaskContext = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
}

// 停止结果：任务 ID、类型与展示命令。
type StopTaskResult = {
  taskId: string
  taskType: string
  command: string | undefined
}

/**
 * Look up a task by ID, validate it is running, kill it, and mark it as notified.
 *
 * Throws {@link StopTaskError} when the task cannot be stopped (not found,
 * not running, or unsupported type). Callers can inspect `error.code` to
 * distinguish the failure reason.
 */
// 核心异步停止函数：查表、校验、杀进程、标记已通知。
export async function stopTask(
  taskId: string,
  context: StopTaskContext,
): Promise<StopTaskResult> {
  const { getAppState, setAppState } = context
// 取出当前应用状态与目标任务。
  const appState = getAppState()
  const task = appState.tasks?.[taskId] as TaskStateBase | undefined

  if (!task) {
// 未找到任务则抛出 not_found。
    throw new StopTaskError(`No task found with ID: ${taskId}`, 'not_found')
  }

  if (task.status !== 'running') {
// 非 running 状态则抛出 not_running。
    throw new StopTaskError(
      `Task ${taskId} is not running (status: ${task.status})`,
      'not_running',
    )
  }

  const taskImpl = getTaskByType(task.type)
  if (!taskImpl) {
// 未能拿到任务实现则抛出 unsupported_type。
    throw new StopTaskError(
      `Unsupported task type: ${task.type}`,
      'unsupported_type',
    )
  }

  await taskImpl.kill(taskId, setAppState)
// 调用具体实现的 kill 终止任务。

  // Bash: suppress the "exit code 137" notification (noise). Agent tasks: don't
  // suppress — the AbortError catch sends a notification carrying
  // extractPartialResult(agentMessages), which is the payload not noise.
  if (isLocalShellTask(task)) {
// 本地 shell 任务抑制 exit 137 噪声，agent 任务保留通知。
    let suppressed = false
    setAppState(prev => {
      const prevTask = prev.tasks[taskId]
      if (!prevTask || prevTask.notified) {
        return prev
      }
      suppressed = true
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: { ...prevTask, notified: true },
        },
      }
    })
    // Suppressing the XML notification also suppresses print.ts's parsed
    // task_notification SDK event — emit it directly so SDK consumers see
    // the task close.
    if (suppressed) {
// 抑制时直接补发 task_notified SDK 事件，保证消费者看到关闭。
      emitTaskTerminatedSdk(taskId, 'stopped', {
        toolUseId: task.toolUseId,
        summary: task.description,
      })
    }
  }

  const command = isLocalShellTask(task) ? task.command : task.description
// 展示命令取 command（shell）或 description（agent）。

  return { taskId, taskType: task.type, command }
// 返回任务 ID、类型与命令。
}
