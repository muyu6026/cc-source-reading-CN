// 本文件提供 emitTaskProgress：统一构造并发出一个 task_progress 类型的 SDK 系统事件，被后台智能体与工作流两类调用方共用。
import type { SdkWorkflowProgress } from '../../types/tools.js'
import { enqueueSdkEvent } from '../sdkEventQueue.js'

/**
 * Emit a `task_progress` SDK event. Shared by background agents (per tool_use
 * in runAsyncAgentLifecycle) and workflows (per flushProgress batch). Accepts
 * already-computed primitives so callers can derive them from their own state
 * shapes (ProgressTracker for agents, LocalWorkflowTaskState for workflows).
 */
// emitTaskProgress：接收已计算好的原始字段（任务 id、工具调用 id、描述、起始时间、token 数、工具调用次数等），组装成 SDK 事件后通过 sdkEventQueue 入队。调用方各自从自己的状态结构派生这些原语。
export function emitTaskProgress(params: {
  taskId: string
  toolUseId: string | undefined
  description: string
  startTime: number
  totalTokens: number
  toolUses: number
  lastToolName?: string
  summary?: string
  workflowProgress?: SdkWorkflowProgress[]
}): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_progress',
    task_id: params.taskId,
    tool_use_id: params.toolUseId,
    description: params.description,
    usage: {
      total_tokens: params.totalTokens,
      tool_uses: params.toolUses,
      duration_ms: Date.now() - params.startTime,
    },
    last_tool_name: params.lastToolName,
    summary: params.summary,
    workflow_progress: params.workflowProgress,
  })
}
// 函数体仅做字段映射与入队，不持有任何状态；duration_ms 由当前时间与传入的 startTime 实时相减得到。
