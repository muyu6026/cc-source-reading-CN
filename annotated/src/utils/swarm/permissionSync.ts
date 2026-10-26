/**
 * Synchronized Permission Prompts for Agent Swarms
 *
 * This module provides infrastructure for coordinating permission prompts across
 * multiple agents in a swarm. When a worker agent needs permission for a tool use,
 * it can forward the request to the team leader, who can then approve or deny it.
 *
 * The system uses the teammate mailbox for message passing:
 * - Workers send permission requests to the leader's mailbox
 * - Leaders send permission responses to the worker's mailbox
 *
 * Flow:
 * 1. Worker agent encounters a permission prompt
 * 2. Worker sends a permission_request message to the leader's mailbox
 * 3. Leader polls for mailbox messages and detects permission requests
 * 4. User approves/denies via the leader's UI
 * 5. Leader sends a permission_response message to the worker's mailbox
 * 6. Worker polls mailbox for responses and continues execution
 */

import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { lazySchema } from '../lazySchema.js'
import * as lockfile from '../lockfile.js'
import { logError } from '../log.js'
import type { PermissionUpdate } from '../permissions/PermissionUpdateSchema.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import {
  getAgentId,
  getAgentName,
  getTeammateColor,
  getTeamName,
} from '../teammate.js'
import {
  createPermissionRequestMessage,
  createPermissionResponseMessage,
  createSandboxPermissionRequestMessage,
  createSandboxPermissionResponseMessage,
  writeToMailbox,
} from '../teammateMailbox.js'
import { getTeamDir, readTeamFileAsync } from './teamHelpers.js'

/**
 * Full request schema for a permission request from a worker to the leader
 */
// 用 lazySchema 定义的「权限请求」完整 schema（zod v4）：记录请求 ID、worker 的身份（agentId / name / color）、teamName、需要权限的工具名与 toolUseId、人类可读描述、序列化后的工具输入、权限建议、状态（pending / approved / rejected）、以及解决人 / 时间 / 反馈 / 修改后的输入 / 始终允许规则等。
export const SwarmPermissionRequestSchema = lazySchema(() =>
  z.object({
    /** Unique identifier for this request */
    id: z.string(),
    /** Worker's CLAUDE_CODE_AGENT_ID */
    workerId: z.string(),
    /** Worker's CLAUDE_CODE_AGENT_NAME */
    workerName: z.string(),
    /** Worker's CLAUDE_CODE_AGENT_COLOR */
    workerColor: z.string().optional(),
    /** Team name for routing */
    teamName: z.string(),
    /** Tool name requiring permission (e.g., "Bash", "Edit") */
    toolName: z.string(),
    /** Original toolUseID from worker's context */
    toolUseId: z.string(),
    /** Human-readable description of the tool use */
    description: z.string(),
    /** Serialized tool input */
    input: z.record(z.string(), z.unknown()),
    /** Suggested permission rules from the permission result */
    permissionSuggestions: z.array(z.unknown()),
    /** Status of the request */
    status: z.enum(['pending', 'approved', 'rejected']),
    /** Who resolved the request */
    resolvedBy: z.enum(['worker', 'leader']).optional(),
    /** Timestamp when resolved */
    resolvedAt: z.number().optional(),
    /** Rejection feedback message */
    feedback: z.string().optional(),
    /** Modified input if changed by resolver */
    updatedInput: z.record(z.string(), z.unknown()).optional(),
    /** "Always allow" rules applied during resolution */
    permissionUpdates: z.array(z.unknown()).optional(),
    /** Timestamp when request was created */
    createdAt: z.number(),
  }),
)

// 从上面 schema 推断出的权限请求类型。
export type SwarmPermissionRequest = z.infer<
  ReturnType<typeof SwarmPermissionRequestSchema>
>

/**
 * Resolution data returned when leader/worker resolves a request
 */
// 「解决结果」类型：决策（通过 / 拒绝）、解决人（worker / leader）、可选反馈、可选修改后的输入、要施加的权限更新（如始终允许规则）。
export type PermissionResolution = {
  /** Decision: approved or rejected */
  decision: 'approved' | 'rejected'
  /** Who resolved it */
  resolvedBy: 'worker' | 'leader'
  /** Optional feedback message if rejected */
  feedback?: string
  /** Optional updated input if the resolver modified it */
  updatedInput?: Record<string, unknown>
  /** Permission updates to apply (e.g., "always allow" rules) */
  permissionUpdates?: PermissionUpdate[]
}

/**
 * Get the base directory for a team's permission requests
 * Path: ~/.claude/teams/{teamName}/permissions/
 */
// 取某个团队的权限目录：~/.claude/teams/{teamName}/permissions。
export function getPermissionDir(teamName: string): string {
  return join(getTeamDir(teamName), 'permissions')
}

/**
 * Get the pending directory for a team
 */
// 取团队「待处理」请求的目录：权限目录下的 pending。
function getPendingDir(teamName: string): string {
  return join(getPermissionDir(teamName), 'pending')
}

/**
 * Get the resolved directory for a team
 */
// 取团队「已解决」请求的目录：权限目录下的 resolved。
function getResolvedDir(teamName: string): string {
  return join(getPermissionDir(teamName), 'resolved')
}

/**
 * Ensure the permissions directory structure exists (async)
 */
// 异步确保权限目录结构存在：把 permissions / pending / resolved 三个目录都建好（递归）。
async function ensurePermissionDirsAsync(teamName: string): Promise<void> {
  const permDir = getPermissionDir(teamName)
  const pendingDir = getPendingDir(teamName)
  const resolvedDir = getResolvedDir(teamName)

  for (const dir of [permDir, pendingDir, resolvedDir]) {
    await mkdir(dir, { recursive: true })
  }
}

/**
 * Get the path to a pending request file
 */
// 算「待处理请求文件」路径：pending 目录下 {requestId}.json。
function getPendingRequestPath(teamName: string, requestId: string): string {
  return join(getPendingDir(teamName), `${requestId}.json`)
}

/**
 * Get the path to a resolved request file
 */
// 算「已解决请求文件」路径：resolved 目录下 {requestId}.json。
function getResolvedRequestPath(teamName: string, requestId: string): string {
  return join(getResolvedDir(teamName), `${requestId}.json`)
}

/**
 * Generate a unique request ID
 */
// 生成一个唯一请求 ID：perm- 加时间戳加随机串。
export function generateRequestId(): string {
  return `perm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Create a new SwarmPermissionRequest object
 */
// 创建一份权限请求对象：补齐 teamName / workerId / workerName / workerColor（缺省从当前 agent 取），缺 teamName 或 workerId 或 workerName 直接报错，其余字段从参数拷入，状态初始为 pending，记 createdAt。
export function createPermissionRequest(params: {
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  description: string
  permissionSuggestions?: unknown[]
  teamName?: string
  workerId?: string
  workerName?: string
  workerColor?: string
}): SwarmPermissionRequest {
  const teamName = params.teamName || getTeamName()
  const workerId = params.workerId || getAgentId()
  const workerName = params.workerName || getAgentName()
  const workerColor = params.workerColor || getTeammateColor()

  if (!teamName) {
    throw new Error('Team name is required for permission requests')
  }
  if (!workerId) {
    throw new Error('Worker ID is required for permission requests')
  }
  if (!workerName) {
    throw new Error('Worker name is required for permission requests')
  }

  return {
    id: generateRequestId(),
    workerId,
    workerName,
    workerColor,
    teamName,
    toolName: params.toolName,
    toolUseId: params.toolUseId,
    description: params.description,
    input: params.input,
    permissionSuggestions: params.permissionSuggestions || [],
    status: 'pending',
    createdAt: Date.now(),
  }
}

/**
 * Write a permission request to the pending directory with file locking
 * Called by worker agents when they need permission approval from the leader
 *
 * @returns The written request
 */
// 把权限请求写进 pending 目录（带文件锁）：worker 需要 leader 审批时调用。先建目录、在 pending 目录放一个 .lock、用 lockfile 加锁保证原子写，再写请求 JSON，最后释放锁。
export async function writePermissionRequest(
  request: SwarmPermissionRequest,
): Promise<SwarmPermissionRequest> {
  await ensurePermissionDirsAsync(request.teamName)

  const pendingPath = getPendingRequestPath(request.teamName, request.id)
  const lockDir = getPendingDir(request.teamName)

  // Create a directory-level lock file for atomic writes
  const lockFilePath = join(lockDir, '.lock')
  await writeFile(lockFilePath, '', 'utf-8')

  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(lockFilePath)

    // Write the request file
    await writeFile(pendingPath, jsonStringify(request, null, 2), 'utf-8')

    logForDebugging(
      `[PermissionSync] Wrote pending request ${request.id} from ${request.workerName} for ${request.toolName}`,
    )

    return request
  } catch (error) {
    logForDebugging(
      `[PermissionSync] Failed to write permission request: ${error}`,
    )
    logError(error)
    throw error
  } finally {
    if (release) {
      await release()
    }
  }
}

/**
 * Read all pending permission requests for a team
 * Called by the team leader to see what requests need attention
 */
// 读某个团队的全部 pending 请求：leader 用来查看待处理项。目录不存在返回空；逐文件读并安全解析（解析失败跳过），最后按 createdAt 从旧到新排序。
export async function readPendingPermissions(
  teamName?: string,
): Promise<SwarmPermissionRequest[]> {
  const team = teamName || getTeamName()
  if (!team) {
    logForDebugging('[PermissionSync] No team name available')
    return []
  }

  const pendingDir = getPendingDir(team)

  let files: string[]
  try {
    files = await readdir(pendingDir)
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return []
    }
    logForDebugging(`[PermissionSync] Failed to read pending requests: ${e}`)
    logError(e)
    return []
  }

  const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '.lock')

  const results = await Promise.all(
    jsonFiles.map(async file => {
      const filePath = join(pendingDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const parsed = SwarmPermissionRequestSchema().safeParse(
          jsonParse(content),
        )
        if (parsed.success) {
          return parsed.data
        }
        logForDebugging(
          `[PermissionSync] Invalid request file ${file}: ${parsed.error.message}`,
        )
        return null
      } catch (err) {
        logForDebugging(
          `[PermissionSync] Failed to read request file ${file}: ${err}`,
        )
        return null
      }
    }),
  )

  const requests = results.filter(r => r !== null)

  // Sort by creation time (oldest first)
  requests.sort((a, b) => a.createdAt - b.createdAt)

  return requests
}

/**
 * Read a resolved permission request by ID
 * Called by workers to check if their request has been resolved
 *
 * @returns The resolved request, or null if not yet resolved
 */
// 按 ID 读某条「已解决」请求：worker 轮询自己的请求是否被处理。读不到或解析失败都返回 null（ENOENT 也当未解决）。
export async function readResolvedPermission(
  requestId: string,
  teamName?: string,
): Promise<SwarmPermissionRequest | null> {
  const team = teamName || getTeamName()
  if (!team) {
    return null
  }

  const resolvedPath = getResolvedRequestPath(team, requestId)

  try {
    const content = await readFile(resolvedPath, 'utf-8')
    const parsed = SwarmPermissionRequestSchema().safeParse(jsonParse(content))
    if (parsed.success) {
      return parsed.data
    }
    logForDebugging(
      `[PermissionSync] Invalid resolved request ${requestId}: ${parsed.error.message}`,
    )
    return null
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return null
    }
    logForDebugging(
      `[PermissionSync] Failed to read resolved request ${requestId}: ${e}`,
    )
    logError(e)
    return null
  }
}

/**
 * Resolve a permission request
 * Called by the team leader (or worker in self-resolution cases)
 *
 * Writes the resolution to resolved/, removes from pending/
 */
// 解决一条权限请求（leader 或 worker 自决都调它）：加锁后读 pending 请求（找不到返回 false），把解决数据并回原请求造出 resolvedRequest，写进 resolved 目录并从 pending 删除，返回 true。
export async function resolvePermission(
  requestId: string,
  resolution: PermissionResolution,
  teamName?: string,
): Promise<boolean> {
  const team = teamName || getTeamName()
  if (!team) {
    logForDebugging('[PermissionSync] No team name available')
    return false
  }

  await ensurePermissionDirsAsync(team)

  const pendingPath = getPendingRequestPath(team, requestId)
  const resolvedPath = getResolvedRequestPath(team, requestId)
  const lockFilePath = join(getPendingDir(team), '.lock')

  await writeFile(lockFilePath, '', 'utf-8')

  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(lockFilePath)

    // Read the pending request
    let content: string
    try {
      content = await readFile(pendingPath, 'utf-8')
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        logForDebugging(
          `[PermissionSync] Pending request not found: ${requestId}`,
        )
        return false
      }
      throw e
    }

    const parsed = SwarmPermissionRequestSchema().safeParse(jsonParse(content))
    if (!parsed.success) {
      logForDebugging(
        `[PermissionSync] Invalid pending request ${requestId}: ${parsed.error.message}`,
      )
      return false
    }

    const request = parsed.data

    // Update the request with resolution data
    const resolvedRequest: SwarmPermissionRequest = {
      ...request,
      status: resolution.decision === 'approved' ? 'approved' : 'rejected',
      resolvedBy: resolution.resolvedBy,
      resolvedAt: Date.now(),
      feedback: resolution.feedback,
      updatedInput: resolution.updatedInput,
      permissionUpdates: resolution.permissionUpdates,
    }

    // Write to resolved directory
    await writeFile(
      resolvedPath,
      jsonStringify(resolvedRequest, null, 2),
      'utf-8',
    )

    // Remove from pending directory
    await unlink(pendingPath)

    logForDebugging(
      `[PermissionSync] Resolved request ${requestId} with ${resolution.decision}`,
    )

    return true
  } catch (error) {
    logForDebugging(`[PermissionSync] Failed to resolve request: ${error}`)
    logError(error)
    return false
  } finally {
    if (release) {
      await release()
    }
  }
}

/**
 * Clean up old resolved permission files
 * Called periodically to prevent file accumulation
 *
 * @param teamName - Team name
 * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 */
// 清理过期的「已解决」请求文件：周期性调用防止文件堆积。默认保留 1 小时（maxAgeMs），用 >= 以便 maxAgeMs 为 0 时清掉全部；解析不出的文件也一并删掉。
export async function cleanupOldResolutions(
  teamName?: string,
  maxAgeMs = 3600000,
): Promise<number> {
  const team = teamName || getTeamName()
  if (!team) {
    return 0
  }

  const resolvedDir = getResolvedDir(team)

  let files: string[]
  try {
    files = await readdir(resolvedDir)
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return 0
    }
    logForDebugging(`[PermissionSync] Failed to cleanup resolutions: ${e}`)
    logError(e)
    return 0
  }

  const now = Date.now()
  const jsonFiles = files.filter(f => f.endsWith('.json'))

  const cleanupResults = await Promise.all(
    jsonFiles.map(async file => {
      const filePath = join(resolvedDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const request = jsonParse(content) as SwarmPermissionRequest

        // Check if the resolution is old enough to clean up
        // Use >= to handle edge case where maxAgeMs is 0 (clean up everything)
        const resolvedAt = request.resolvedAt || request.createdAt
        if (now - resolvedAt >= maxAgeMs) {
          await unlink(filePath)
          logForDebugging(`[PermissionSync] Cleaned up old resolution: ${file}`)
          return 1
        }
        return 0
      } catch {
        // If we can't parse it, clean it up anyway
        try {
          await unlink(filePath)
          return 1
        } catch {
          // Ignore deletion errors
          return 0
        }
      }
    }),
  )

  const cleanedCount = cleanupResults.reduce<number>((sum, n) => sum + n, 0)

  if (cleanedCount > 0) {
    logForDebugging(
      `[PermissionSync] Cleaned up ${cleanedCount} old resolutions`,
    )
  }

  return cleanedCount
}

/**
 * Legacy response type for worker polling
 * Used for backward compatibility with worker integration code
 */
// 给 worker 轮询用的「响应」类型（旧格式，向后兼容）：含 requestId、决策（approved / denied）、时间戳、反馈、修改后输入、权限更新。
export type PermissionResponse = {
  /** ID of the request this responds to */
  requestId: string
  /** Decision: approved or denied */
  decision: 'approved' | 'denied'
  /** Timestamp when response was created */
  timestamp: string
  /** Optional feedback message if denied */
  feedback?: string
  /** Optional updated input if the resolver modified it */
  updatedInput?: Record<string, unknown>
  /** Permission updates to apply (e.g., "always allow" rules) */
  permissionUpdates?: unknown[]
}

/**
 * Poll for a permission response (worker-side convenience function)
 * Converts the resolved request into a simpler response format
 *
 * @returns The permission response, or null if not yet resolved
 */
// 轮询某条请求的响应（worker 侧便捷函数）：调 readResolvedPermission，把解决结果简化成 PermissionResponse 格式（status 转成 approved / denied，时间戳取 resolvedAt 否则 createdAt）。
export async function pollForResponse(
  requestId: string,
  _agentName?: string,
  teamName?: string,
): Promise<PermissionResponse | null> {
  const resolved = await readResolvedPermission(requestId, teamName)
  if (!resolved) {
    return null
  }

  return {
    requestId: resolved.id,
    decision: resolved.status === 'approved' ? 'approved' : 'denied',
    timestamp: resolved.resolvedAt
      ? new Date(resolved.resolvedAt).toISOString()
      : new Date(resolved.createdAt).toISOString(),
    feedback: resolved.feedback,
    updatedInput: resolved.updatedInput,
    permissionUpdates: resolved.permissionUpdates,
  }
}

/**
 * Remove a worker's response after processing
 * This is an alias for deleteResolvedPermission for backward compatibility
 */
// 处理完响应后删掉 worker 的响应：是 deleteResolvedPermission 的别名，向后兼容。
export async function removeWorkerResponse(
  requestId: string,
  _agentName?: string,
  teamName?: string,
): Promise<void> {
  await deleteResolvedPermission(requestId, teamName)
}

/**
 * Check if the current agent is a team leader
 */
// 判断当前 agent 是不是团队 leader：leader 没设 agentId，或 agentId 等于 team-lead 即视为 leader。
export function isTeamLeader(teamName?: string): boolean {
  const team = teamName || getTeamName()
  if (!team) {
    return false
  }

  // Team leaders don't have an agent ID set, or their ID is 'team-lead'
  const agentId = getAgentId()

  return !agentId || agentId === 'team-lead'
}

/**
 * Check if the current agent is a worker in a swarm
 */
// 判断当前 agent 是不是 swarm 里的 worker：有 teamName 且有 agentId 且不是 leader 才算。
export function isSwarmWorker(): boolean {
  const teamName = getTeamName()
  const agentId = getAgentId()

  return !!teamName && !!agentId && !isTeamLeader()
}

/**
 * Delete a resolved permission file
 * Called after a worker has processed the resolution
 */
// 删除一条已解决的权限文件：worker 处理完响应后调用；ENOENT 视为已删返回 false。
export async function deleteResolvedPermission(
  requestId: string,
  teamName?: string,
): Promise<boolean> {
  const team = teamName || getTeamName()
  if (!team) {
    return false
  }

  const resolvedPath = getResolvedRequestPath(team, requestId)

  try {
    await unlink(resolvedPath)
    logForDebugging(
      `[PermissionSync] Deleted resolved permission: ${requestId}`,
    )
    return true
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return false
    }
    logForDebugging(
      `[PermissionSync] Failed to delete resolved permission: ${e}`,
    )
    logError(e)
    return false
  }
}

/**
 * Submit a permission request (alias for writePermissionRequest)
 * Provided for backward compatibility with worker integration code
 */
// submitPermissionRequest 是 writePermissionRequest 的别名，供旧版 worker 集成代码兼容。
export const submitPermissionRequest = writePermissionRequest

// ============================================================================
// Mailbox-Based Permission System
// ============================================================================

/**
 * Get the leader's name from the team file
 * This is needed to send permission requests to the leader's mailbox
 */
// 从团队文件里取 leader 的名字：读 teamFile，找到 leadAgentId 对应的成员名，找不到就回退 team-lead。给 leader 发信时需要它。
export async function getLeaderName(teamName?: string): Promise<string | null> {
  const team = teamName || getTeamName()
  if (!team) {
    return null
  }

  const teamFile = await readTeamFileAsync(team)
  if (!teamFile) {
    logForDebugging(`[PermissionSync] Team file not found for team: ${team}`)
    return null
  }

  const leadMember = teamFile.members.find(
    m => m.agentId === teamFile.leadAgentId,
  )
  return leadMember?.name || 'team-lead'
}

/**
 * Send a permission request to the leader via mailbox.
 * This is the new mailbox-based approach that replaces the file-based pending directory.
 *
 * @param request - The permission request to send
 * @returns true if the message was sent successfully
 */
// 通过邮箱给 leader 发权限请求（新一代基于邮箱的方案，取代文件式 pending 目录）：先查 leader 名，造 createPermissionRequestMessage 消息，写进 leader 的邮箱（按收件人路由到进程内或文件）。
export async function sendPermissionRequestViaMailbox(
  request: SwarmPermissionRequest,
): Promise<boolean> {
  const leaderName = await getLeaderName(request.teamName)
  if (!leaderName) {
    logForDebugging(
      `[PermissionSync] Cannot send permission request: leader name not found`,
    )
    return false
  }

  try {
    // Create the permission request message
    const message = createPermissionRequestMessage({
      request_id: request.id,
      agent_id: request.workerName,
      tool_name: request.toolName,
      tool_use_id: request.toolUseId,
      description: request.description,
      input: request.input,
      permission_suggestions: request.permissionSuggestions,
    })

    // Send to leader's mailbox (routes to in-process or file-based based on recipient)
    await writeToMailbox(
      leaderName,
      {
        from: request.workerName,
        text: jsonStringify(message),
        timestamp: new Date().toISOString(),
        color: request.workerColor,
      },
      request.teamName,
    )

    logForDebugging(
      `[PermissionSync] Sent permission request ${request.id} to leader ${leaderName} via mailbox`,
    )
    return true
  } catch (error) {
    logForDebugging(
      `[PermissionSync] Failed to send permission request via mailbox: ${error}`,
    )
    logError(error)
    return false
  }
}

/**
 * Send a permission response to a worker via mailbox.
 * This is the new mailbox-based approach that replaces the file-based resolved directory.
 *
 * @param workerName - The worker's name to send the response to
 * @param resolution - The permission resolution
 * @param requestId - The original request ID
 * @param teamName - The team name
 * @returns true if the message was sent successfully
 */
// 通过邮箱给 worker 发权限响应（取代文件式 resolved 目录）：leader 把决策（approved→success / rejected→error）、反馈、修改后输入、权限更新打包成消息，写进 worker 的邮箱。
export async function sendPermissionResponseViaMailbox(
  workerName: string,
  resolution: PermissionResolution,
  requestId: string,
  teamName?: string,
): Promise<boolean> {
  const team = teamName || getTeamName()
  if (!team) {
    logForDebugging(
      `[PermissionSync] Cannot send permission response: team name not found`,
    )
    return false
  }

  try {
    // Create the permission response message
    const message = createPermissionResponseMessage({
      request_id: requestId,
      subtype: resolution.decision === 'approved' ? 'success' : 'error',
      error: resolution.feedback,
      updated_input: resolution.updatedInput,
      permission_updates: resolution.permissionUpdates,
    })

    // Get the sender name (leader's name)
    const senderName = getAgentName() || 'team-lead'

    // Send to worker's mailbox (routes to in-process or file-based based on recipient)
    await writeToMailbox(
      workerName,
      {
        from: senderName,
        text: jsonStringify(message),
        timestamp: new Date().toISOString(),
      },
      team,
    )

    logForDebugging(
      `[PermissionSync] Sent permission response for ${requestId} to worker ${workerName} via mailbox`,
    )
    return true
  } catch (error) {
    logForDebugging(
      `[PermissionSync] Failed to send permission response via mailbox: ${error}`,
    )
    logError(error)
    return false
  }
}

// ============================================================================
// Sandbox Permission Mailbox System
// ============================================================================

/**
 * Generate a unique sandbox permission request ID
 */
// 生成 sandbox 权限请求的唯一 ID：sandbox- 加时间戳加随机串。
export function generateSandboxRequestId(): string {
  return `sandbox-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Send a sandbox permission request to the leader via mailbox.
 * Called by workers when sandbox runtime needs network access approval.
 *
 * @param host - The host requesting network access
 * @param requestId - Unique ID for this request
 * @param teamName - Optional team name
 * @returns true if the message was sent successfully
 */
// 通过邮箱给 leader 发「沙箱权限请求」：当沙箱运行时需要网络访问审批时由 worker 调用。先校验 teamName 与 leader 名、补齐 worker 身份，再把 host 等信息打包发往 leader 邮箱。
export async function sendSandboxPermissionRequestViaMailbox(
  host: string,
  requestId: string,
  teamName?: string,
): Promise<boolean> {
  const team = teamName || getTeamName()
  if (!team) {
    logForDebugging(
      `[PermissionSync] Cannot send sandbox permission request: team name not found`,
    )
    return false
  }

  const leaderName = await getLeaderName(team)
  if (!leaderName) {
    logForDebugging(
      `[PermissionSync] Cannot send sandbox permission request: leader name not found`,
    )
    return false
  }

  const workerId = getAgentId()
  const workerName = getAgentName()
  const workerColor = getTeammateColor()

  if (!workerId || !workerName) {
    logForDebugging(
      `[PermissionSync] Cannot send sandbox permission request: worker ID or name not found`,
    )
    return false
  }

  try {
    const message = createSandboxPermissionRequestMessage({
      requestId,
      workerId,
      workerName,
      workerColor,
      host,
    })

    // Send to leader's mailbox (routes to in-process or file-based based on recipient)
    await writeToMailbox(
      leaderName,
      {
        from: workerName,
        text: jsonStringify(message),
        timestamp: new Date().toISOString(),
        color: workerColor,
      },
      team,
    )

    logForDebugging(
      `[PermissionSync] Sent sandbox permission request ${requestId} for host ${host} to leader ${leaderName} via mailbox`,
    )
    return true
  } catch (error) {
    logForDebugging(
      `[PermissionSync] Failed to send sandbox permission request via mailbox: ${error}`,
    )
    logError(error)
    return false
  }
}

/**
 * Send a sandbox permission response to a worker via mailbox.
 * Called by the leader when approving/denying a sandbox network access request.
 *
 * @param workerName - The worker's name to send the response to
 * @param requestId - The original request ID
 * @param host - The host that was approved/denied
 * @param allow - Whether the connection is allowed
 * @param teamName - Optional team name
 * @returns true if the message was sent successfully
 */
// 通过邮箱给 worker 发「沙箱权限响应」：leader 批准 / 拒绝某个沙箱网络访问请求时调用，把 requestId、host、allow 打包发往 worker 邮箱。
export async function sendSandboxPermissionResponseViaMailbox(
  workerName: string,
  requestId: string,
  host: string,
  allow: boolean,
  teamName?: string,
): Promise<boolean> {
  const team = teamName || getTeamName()
  if (!team) {
    logForDebugging(
      `[PermissionSync] Cannot send sandbox permission response: team name not found`,
    )
    return false
  }

  try {
    const message = createSandboxPermissionResponseMessage({
      requestId,
      host,
      allow,
    })

    const senderName = getAgentName() || 'team-lead'

    // Send to worker's mailbox (routes to in-process or file-based based on recipient)
    await writeToMailbox(
      workerName,
      {
        from: senderName,
        text: jsonStringify(message),
        timestamp: new Date().toISOString(),
      },
      team,
    )

    logForDebugging(
      `[PermissionSync] Sent sandbox permission response for ${requestId} (host: ${host}, allow: ${allow}) to worker ${workerName} via mailbox`,
    )
    return true
  } catch (error) {
    logForDebugging(
      `[PermissionSync] Failed to send sandbox permission response via mailbox: ${error}`,
    )
    logError(error)
    return false
  }
}
