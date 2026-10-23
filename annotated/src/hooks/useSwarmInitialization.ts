/**
 * Swarm Initialization Hook
 *
 * Initializes swarm features: teammate hooks and context.
 * Handles both fresh spawns and resumed teammate sessions.
 *
 * This hook is conditionally loaded to allow dead code elimination when swarms are disabled.
 */
// 块注释：swarm 初始化 hook——初始化 teammate hooks 与 context；处理 fresh spawn 与 resume 两种；条件加载以便 swarms 禁用时 DCE 剔除。

import { useEffect } from 'react'
import { getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js'
import { initializeTeammateContextFromSession } from '../utils/swarm/reconnection.js'
import { readTeamFile } from '../utils/swarm/teamHelpers.js'
import { initializeTeammateHooks } from '../utils/swarm/teammateInit.js'
import { getDynamicTeamContext } from '../utils/teammate.js'

type SetAppState = (f: (prevState: AppState) => AppState) => void

/**
 * Hook that initializes swarm features when ENABLE_AGENT_SWARMS is true.
 *
 * Handles both:
 * - Resumed teammate sessions (from --resume or /resume) where teamName/agentName
 *   are stored in transcript messages
 * - Fresh spawns where context is read from environment variables
 */
// 块注释：ENABLE_AGENT_SWARMS=true 时初始化；resume（--resume / /resume）从 transcript 消息读 teamName/agentName；fresh spawn 从环境变量读 context。
export function useSwarmInitialization(
  setAppState: SetAppState,
  initialMessages: Message[] | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): void {
// 仅在 enabled 且 isAgentSwarmsEnabled 时初始化；处理 resume 与 fresh spawn 两条路径，二者互斥。
  useEffect(() => {
    if (!enabled) return
    if (isAgentSwarmsEnabled()) {
      // Check if this is a resumed agent session (from --resume or /resume)
      // Resumed sessions have teamName/agentName stored in transcript messages
      const firstMessage = initialMessages?.[0]
      const teamName =
        firstMessage && 'teamName' in firstMessage
          ? (firstMessage.teamName as string | undefined)
          : undefined
      const agentName =
        firstMessage && 'agentName' in firstMessage
          ? (firstMessage.agentName as string | undefined)
          : undefined

      if (teamName && agentName) {
        // Resumed agent session - set up team context from stored info
        initializeTeammateContextFromSession(setAppState, teamName, agentName)

        // Get agentId from team file for hook initialization
        const teamFile = readTeamFile(teamName)
        const member = teamFile?.members.find(
          (m: { name: string }) => m.name === agentName,
        )
        if (member) {
          initializeTeammateHooks(setAppState, getSessionId(), {
            teamName,
            agentId: member.agentId,
            agentName,
          })
        }
      } else {
        // Fresh spawn or standalone session
        // teamContext is already computed in main.tsx via computeInitialTeamContext()
        // and included in initialState, so we only need to initialize hooks here
        const context = getDynamicTeamContext?.()
        if (context?.teamName && context?.agentId && context?.agentName) {
          initializeTeammateHooks(setAppState, getSessionId(), {
            teamName: context.teamName,
            agentId: context.agentId,
            agentName: context.agentName,
          })
        }
      }
    }
  }, [setAppState, initialMessages, enabled])
// effect：resume 从转录首消息读 teamName/agentName → initializeTeammateContextFromSession 重建 context + 从 team file 取 agentId 初始化 hooks；fresh 从 getDynamicTeamContext（main.tsx 已算进 initialState）初始化 hooks。
}
