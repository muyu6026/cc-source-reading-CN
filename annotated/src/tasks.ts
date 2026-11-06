import { feature } from 'bun:bundle'
// 任务总注册表：汇总各类任务实现（本地 shell/agent、远端 agent、dream），并按构建期 feature 开关条件加载 workflow/monitor 任务，避免非相关构建拉入代码。
import type { Task, TaskType } from './Task.js'
import { DreamTask } from './tasks/DreamTask/DreamTask.js'
import { LocalAgentTask } from './tasks/LocalAgentTask/LocalAgentTask.js'
import { LocalShellTask } from './tasks/LocalShellTask/LocalShellTask.js'
import { RemoteAgentTask } from './tasks/RemoteAgentTask/RemoteAgentTask.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const LocalWorkflowTask: Task | null = feature('WORKFLOW_SCRIPTS')
// 构建期启用 WORKFLOW_SCRIPTS 才加载本地工作流任务。
  ? require('./tasks/LocalWorkflowTask/LocalWorkflowTask.js').LocalWorkflowTask
  : null
const MonitorMcpTask: Task | null = feature('MONITOR_TOOL')
// 启用 MONITOR_TOOL 才加载监控型 MCP 任务。
  ? require('./tasks/MonitorMcpTask/MonitorMcpTask.js').MonitorMcpTask
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Get all tasks.
 * Mirrors the pattern from tools.ts
 * Note: Returns array inline to avoid circular dependency issues with top-level const
 */
export function getAllTasks(): Task[] {
// 返回所有已启用的任务实例数组；内联返回以避免顶层 const 造成的循环依赖。
  const tasks: Task[] = [
// 基础四个任务固定纳入。
    LocalShellTask,
    LocalAgentTask,
    RemoteAgentTask,
    DreamTask,
  ]
  if (LocalWorkflowTask) tasks.push(LocalWorkflowTask)
// 启用了才 push 工作流任务。
  if (MonitorMcpTask) tasks.push(MonitorMcpTask)
  return tasks
}

/**
 * Get a task by its type.
 */
export function getTaskByType(type: TaskType): Task | undefined {
// 按类型查任务：复用 getAllTasks 再 find。
  return getAllTasks().find(t => t.type === type)
}
