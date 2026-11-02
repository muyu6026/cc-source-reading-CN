/**
 * Deterministic Agent ID System
 *
 * This module provides helper functions for formatting and parsing deterministic
 * agent IDs used in the swarm/teammate system.
 *
 * ## ID Formats
 *
 * **Agent IDs**: `agentName@teamName`
 * - Example: `team-lead@my-project`, `researcher@my-project`
 * - The @ symbol acts as a separator between agent name and team name
 *
 * **Request IDs**: `{requestType}-{timestamp}@{agentId}`
 * - Example: `shutdown-1702500000000@researcher@my-project`
 * - Used for shutdown requests, plan approvals, etc.
 *
 * ## Why Deterministic IDs?
 *
 * Deterministic IDs provide several benefits:
 *
 * 1. **Reproducibility**: The same agent spawned with the same name in the same team
 *    always gets the same ID, enabling reconnection after crashes/restarts.
 *
 * 2. **Human-readable**: IDs are meaningful and debuggable (e.g., `tester@my-project`).
 *
 * 3. **Predictable**: Team leads can compute a teammate's ID without looking it up,
 *    simplifying message routing and task assignment.
 *
 * ## Constraints
 *
 * - Agent names must NOT contain `@` (it's used as the separator)
 * - Use `sanitizeAgentName()` from TeammateTool.ts to strip @ from names
 */

/**
 * Formats an agent ID in the format `agentName@teamName`.
 */
export function formatAgentId(agentName: string, teamName: string): string {
// 把 agent 名与团队名拼成 agentName@teamName 形式的 ID。
  return `${agentName}@${teamName}`
}

/**
 * Parses an agent ID into its components.
 * Returns null if the ID doesn't contain the @ separator.
 */
export function parseAgentId(
// 按 @ 切分解析 agent ID；不含 @ 返回 null。
  agentId: string,
): { agentName: string; teamName: string } | null {
  const atIndex = agentId.indexOf('@')
  if (atIndex === -1) {
    return null
  }
  return {
    agentName: agentId.slice(0, atIndex),
    teamName: agentId.slice(atIndex + 1),
  }
}

/**
 * Formats a request ID in the format `{requestType}-{timestamp}@{agentId}`.
 */
export function generateRequestId(
// 生成 {请求类型}-{时间戳}@{agentId} 形式的请求 ID，用于关机、计划审批等。
  requestType: string,
  agentId: string,
): string {
  const timestamp = Date.now()
  return `${requestType}-${timestamp}@${agentId}`
}

/**
 * Parses a request ID into its components.
 * Returns null if the request ID doesn't match the expected format.
 */
export function parseRequestId(
// 解析请求 ID：拆出请求类型、时间戳与 agent ID；格式不符或时间戳非数字返回 null。
  requestId: string,
): { requestType: string; timestamp: number; agentId: string } | null {
  const atIndex = requestId.indexOf('@')
  if (atIndex === -1) {
    return null
  }

  const prefix = requestId.slice(0, atIndex)
  const agentId = requestId.slice(atIndex + 1)

  const lastDashIndex = prefix.lastIndexOf('-')
  if (lastDashIndex === -1) {
    return null
  }

  const requestType = prefix.slice(0, lastDashIndex)
  const timestampStr = prefix.slice(lastDashIndex + 1)
  const timestamp = parseInt(timestampStr, 10)

  if (isNaN(timestamp)) {
    return null
  }

  return { requestType, timestamp, agentId }
}
// 本模块只做确定式 ID 的拼接与拆解，不含网络或状态逻辑。
