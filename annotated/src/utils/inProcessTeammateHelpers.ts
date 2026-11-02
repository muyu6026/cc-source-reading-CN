/**
 * In-Process Teammate Helpers
 *
 * Helper functions for in-process teammate integration.
 * Provides utilities to:
 * - Find task ID by agent name
 * - Handle plan approval responses
 * - Update awaitingPlanApproval state
 * - Detect permission-related messages
 */

import type { AppState } from '../state/AppState.js'
// 导入 AppState 类型，作为任务列表与状态更新的数据根。
import {
  type InProcessTeammateTaskState,
  isInProcessTeammateTask,
} from '../tasks/InProcessTeammateTask/types.js'
import { updateTaskState } from './task/framework.js'
import {
  isPermissionResponse,
  isSandboxPermissionResponse,
  type PlanApprovalResponseMessage,
} from './teammateMailbox.js'

type SetAppState = (updater: (prev: AppState) => AppState) => void

/**
 * Find the task ID for an in-process teammate by agent name.
 *
 * @param agentName - The agent name (e.g., "researcher")
 * @param appState - Current AppState
 * @returns Task ID if found, undefined otherwise
 */
export function findInProcessTeammateTaskId(
// 遍历当前所有任务，按 agentName 找出对应的进程内队友任务 ID；找不到返回 undefined。
  agentName: string,
  appState: AppState,
): string | undefined {
  for (const task of Object.values(appState.tasks)) {
    if (
      isInProcessTeammateTask(task) &&
      task.identity.agentName === agentName
    ) {
      return task.id
    }
  }
  return undefined
}

/**
 * Set awaitingPlanApproval state for an in-process teammate.
 *
 * @param taskId - Task ID of the in-process teammate
 * @param setAppState - AppState setter
 * @param awaiting - Whether teammate is awaiting plan approval
 */
export function setAwaitingPlanApproval(
// 设置某队友任务是否正在等待计划审批，内部复用 updateTaskState 更新 awaitingPlanApproval 字段。
  taskId: string,
  setAppState: SetAppState,
  awaiting: boolean,
): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => ({
    ...task,
    awaitingPlanApproval: awaiting,
  }))
}

/**
 * Handle plan approval response for an in-process teammate.
 * Called by the message callback when a plan_approval_response arrives.
 *
 * This resets awaitingPlanApproval to false. The permissionMode from the
 * response is handled separately by the agent loop (Task #11).
 *
 * @param taskId - Task ID of the in-process teammate
 * @param _response - The plan approval response message (for future use)
 * @param setAppState - AppState setter
 */
export function handlePlanApprovalResponse(
// 处理计划审批响应：把 awaitingPlanApproval 复位为 false；权限模式由 agent 主循环另行处理。
  taskId: string,
  _response: PlanApprovalResponseMessage,
  setAppState: SetAppState,
): void {
  setAwaitingPlanApproval(taskId, setAppState, false)
}

// ============ Permission Delegation Helpers ============
// 以下进入权限委派辅助函数分区。

/**
 * Check if a message is a permission-related response.
 * Used by in-process teammate message handlers to detect and process
 * permission responses from the team leader.
 *
 * Handles both tool permissions and sandbox (network host) permissions.
 *
 * @param messageText - The raw message text to check
 * @returns true if the message is a permission response
 */
export function isPermissionRelatedResponse(messageText: string): boolean {
// 判断一条消息是否为权限相关响应，覆盖工具权限与沙箱（网络主机）权限两类。
  return (
    !!isPermissionResponse(messageText) ||
    !!isSandboxPermissionResponse(messageText)
  )
}
