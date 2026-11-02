// 文件级批注：`standaloneAgent.ts` 为非群组会话提供独立智能体的名称访问能力，一旦处于群组则让位给群组上下文。
/**
 * Standalone agent utilities for sessions with custom names/colors
 *
 * These helpers provide access to standalone agent context (name and color)
 * for sessions that are NOT part of a swarm team. When a session is part
 * of a swarm, these functions return undefined to let swarm context take
 * precedence.
 */

import type { AppState } from '../state/AppState.js'
import { getTeamName } from './teammate.js'

/**
 * Returns the standalone agent name if set and not a swarm teammate.
 * Uses getTeamName() for consistency with isTeammate() swarm detection.
 */
// 入口签名：传入应用状态，返回独立智能体名或 `undefined`。
export function getStandaloneAgentName(appState: AppState): string | undefined {
  // If in a team (swarm), don't return standalone name
  if (getTeamName()) {
    return undefined
// 收尾：若处于群组（swarm）则返回 `undefined`，把命名权交给群组上下文。
  }
  return appState.standaloneAgentContext?.name
}
// 收尾：非群组时返回会话上挂的独立智能体名。
