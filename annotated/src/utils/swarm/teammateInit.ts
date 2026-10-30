/**
 * Teammate Initialization Module
 *
 * Handles initialization for Claude Code instances running as teammates in a swarm.
 * Registers a Stop hook to notify the team leader when the teammate becomes idle.
 */
// 队友初始化模块：为以「队友」身份运行在 swarm 集群中的 Claude Code 实例做初始化，注册一个 Stop 钩子，在本队友空闲时通知团队 leader。

import type { AppState } from '../../state/AppState.js'
import { logForDebugging } from '../debug.js'
import { addFunctionHook } from '../hooks/sessionHooks.js'
import { applyPermissionUpdate } from '../permissions/PermissionUpdate.js'
import { jsonStringify } from '../slowOperations.js'
import { getTeammateColor } from '../teammate.js'
import {
  createIdleNotification,
  getLastPeerDmSummary,
  writeToMailbox,
} from '../teammateMailbox.js'
import { readTeamFile, setMemberActive } from './teamHelpers.js'

/**
 * Initializes hooks for a teammate running in a swarm.
 * Should be called early in session startup after AppState is available.
 *
 * Registers a Stop hook that sends an idle notification to the team leader
 * when this teammate's session stops.
 */
// 初始化队友的钩子——应在 AppState 就绪后尽早调用；注册 Stop 钩子，在队友会话结束时向 leader 发空闲通知。
export function initializeTeammateHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  teamInfo: { teamName: string; agentId: string; agentName: string },
): void {
// 参数含 setAppState 更新器、sessionId 与团队信息（队名/agentId/agentName）。
  const { teamName, agentId, agentName } = teamInfo

  // Read team file to get leader ID
// 读取团队文件拿到 leader 的 ID；找不到团队文件就直接返回。
  const teamFile = readTeamFile(teamName)
  if (!teamFile) {
    logForDebugging(`[TeammateInit] Team file not found for team: ${teamName}`)
    return
  }

  const leadAgentId = teamFile.leadAgentId

  // Apply team-wide allowed paths if any exist
// 若团队配置了全局允许路径，逐个将「工具名 加 路径」加为 allow 规则（绝对路径前补斜杠形成 //path/双星号 模式，相对路径直接用 path/双星号）。
  if (teamFile.teamAllowedPaths && teamFile.teamAllowedPaths.length > 0) {
    logForDebugging(
      `[TeammateInit] Found ${teamFile.teamAllowedPaths.length} team-wide allowed path(s)`,
    )

    for (const allowedPath of teamFile.teamAllowedPaths) {
      // For absolute paths (starting with /), prepend one / to create //path/** pattern
      // For relative paths, just use path/**
      const ruleContent = allowedPath.path.startsWith('/')
        ? `/${allowedPath.path}/**`
        : `${allowedPath.path}/**`

      logForDebugging(
        `[TeammateInit] Applying team permission: ${allowedPath.toolName} allowed in ${allowedPath.path} (rule: ${ruleContent})`,
      )

      setAppState(prev => ({
        ...prev,
        toolPermissionContext: applyPermissionUpdate(
          prev.toolPermissionContext,
          {
            type: 'addRules',
            rules: [
              {
                toolName: allowedPath.toolName,
                ruleContent,
              },
            ],
            behavior: 'allow',
            destination: 'session',
          },
        ),
      }))
    }
  }

  // Find the leader's name from the members array
// 从成员数组里找出 leader 的名字（找不到用 team-lead 兜底）。
  const leadMember = teamFile.members.find(m => m.agentId === leadAgentId)
  const leadAgentName = leadMember?.name || 'team-lead'

  // Don't register hook if this agent is the leader
// 若本机就是 leader，则不注册空闲通知钩子（leader 不需要通知自己）。
  if (agentId === leadAgentId) {
    logForDebugging(
      '[TeammateInit] This agent is the team leader - skipping idle notification hook',
    )
    return
  }

  logForDebugging(
    `[TeammateInit] Registering Stop hook for teammate ${agentName} to notify leader ${leadAgentName}`,
  )

  // Register Stop hook to notify leader when this teammate stops
// 注册 Stop 钩子，在队友停止时通知 leader。
  addFunctionHook(
    setAppState,
    sessionId,
    'Stop',
    '', // No matcher - applies to all Stop events
    async (messages, _signal) => {
// 钩子回调：先把本队友标记为空闲（fire-and-forget），再向 leader 邮箱发送空闲通知，包含空闲原因与最近的对等私信摘要。
      // Mark this teammate as idle in the team config (fire and forget)
      void setMemberActive(teamName, agentName, false)

      // Send idle notification to the team leader using agent name (not UUID)
      // Must await to ensure the write completes before process shutdown
      const notification = createIdleNotification(agentName, {
        idleReason: 'available',
        summary: getLastPeerDmSummary(messages),
      })
      await writeToMailbox(leadAgentName, {
        from: agentName,
        text: jsonStringify(notification),
        timestamp: new Date().toISOString(),
        color: getTeammateColor(),
      })
      logForDebugging(
        `[TeammateInit] Sent idle notification to leader ${leadAgentName}`,
      )
      return true // Don't block the Stop
// 返回 true 表示不阻断 Stop 流程。
    },
    'Failed to send idle notification to team leader',
// 钩子失败时的错误提示文案。
    {
      timeout: 10000,
    },
// 钩子超时设为 10 秒，避免关闭流程被卡住。
  )
}
