import type { AgentColorName } from '../../tools/AgentTool/agentColorManager.js'
import { AGENT_COLORS } from '../../tools/AgentTool/agentColorManager.js'
import { detectAndGetBackend } from './backends/registry.js'
import type { PaneBackend } from './backends/types.js'

// Track color assignments for teammates (persisted per session)
const teammateColorAssignments = new Map<string, AgentColorName>()
let colorIndex = 0
// 颜色分配状态：按会话记忆队友颜色，轮转索引。

/**
 * Gets the appropriate backend for the current environment.
 * detectAndGetBackend() caches internally — no need for a second cache here.
 */
async function getBackend(): Promise<PaneBackend> {
  return (await detectAndGetBackend()).backend
}
// getBackend 收尾：后端内部已缓存，无需二次缓存。

/**
 * Assigns a unique color to a teammate from the available palette.
 * Colors are assigned in round-robin order.
 */
export function assignTeammateColor(teammateId: string): AgentColorName {
  const existing = teammateColorAssignments.get(teammateId)
  if (existing) {
    return existing
  }

  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length]!
  teammateColorAssignments.set(teammateId, color)
  colorIndex++

  return color
}
// assignTeammateColor 收尾：从调色板轮转分配唯一颜色，已分配则复用。

/**
 * Gets the assigned color for a teammate, if any.
 */
export function getTeammateColor(
  teammateId: string,
): AgentColorName | undefined {
  return teammateColorAssignments.get(teammateId)
}
// getTeammateColor 收尾：返回既有分配或 undefined。

/**
 * Clears all teammate color assignments.
 * Called during team cleanup to reset state for potential new teams.
 */
export function clearTeammateColors(): void {
  teammateColorAssignments.clear()
  colorIndex = 0
}
// clearTeammateColors 收尾：团队清理时重置以便新团队复用。

/**
 * Checks if we're currently running inside a tmux session.
 * Uses the detection module directly for this check.
 */
export async function isInsideTmux(): Promise<boolean> {
  const { isInsideTmux: checkTmux } = await import('./backends/detection.js')
  return checkTmux()
}
// isInsideTmux 收尾：动态导入检测模块判断是否在 tmux 内。

/**
 * Creates a new teammate pane in the swarm view.
 * Automatically selects the appropriate backend (tmux or iTerm2) based on environment.
 *
 * When running INSIDE tmux:
 * - Uses TmuxBackend to split the current window
 * - Leader stays on left (30%), teammates on right (70%)
 *
 * When running in iTerm2 (not in tmux) with it2 CLI:
 * - Uses ITermBackend for native iTerm2 split panes
 *
 * When running OUTSIDE tmux/iTerm2:
 * - Falls back to TmuxBackend with external claude-swarm session
 */
export async function createTeammatePaneInSwarmView(
  teammateName: string,
  teammateColor: AgentColorName,
): Promise<{ paneId: string; isFirstTeammate: boolean }> {
  const backend = await getBackend()
  return backend.createTeammatePaneInSwarmView(teammateName, teammateColor)
}
// createTeammatePaneInSwarmView 收尾：自动选后端（tmux 或 iTerm2）在蜂群视图开新窗格。

/**
 * Enables pane border status for a window (shows pane titles).
 * Delegates to the detected backend.
 */
export async function enablePaneBorderStatus(
  windowTarget?: string,
  useSwarmSocket = false,
): Promise<void> {
  const backend = await getBackend()
  return backend.enablePaneBorderStatus(windowTarget, useSwarmSocket)
}
// enablePaneBorderStatus 收尾：委托后端开启窗格边框状态显示。

/**
 * Sends a command to a specific pane.
 * Delegates to the detected backend.
 */
export async function sendCommandToPane(
  paneId: string,
  command: string,
  useSwarmSocket = false,
): Promise<void> {
  const backend = await getBackend()
  return backend.sendCommandToPane(paneId, command, useSwarmSocket)
}
// sendCommandToPane 收尾：委托后端向指定窗格发送命令。
