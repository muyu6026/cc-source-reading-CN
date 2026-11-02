// 多智能体团队的发现层：扫描用户目录下的团队存储，找出当前会话担任 leader 的团队，并给出成员与运行状态。数据来源是磁盘上的团队文件，本身不做轮询与订阅，供页脚的团队状态区一次性取值渲染。
/**
 * Team Discovery - Utilities for discovering teams and teammate status
 *
 * Scans ~/.claude/teams/ to find teams where the current session is the leader.
 * Used by the Teams UI in the footer to show team status.
 */

import { isPaneBackend, type PaneBackendType } from './swarm/backends/types.js'
import { readTeamFile } from './swarm/teamHelpers.js'

export type TeamSummary = {
  name: string
  memberCount: number
  runningCount: number
  idleCount: number
}
// TeamSummary 是团队层面的汇总：成员总数拆成运行中与空闲两个计数，页脚只需要这几个数字，不必下钻到每个成员。

export type TeammateStatus = {
  name: string
  agentId: string
  agentType?: string
  model?: string
  prompt?: string
  status: 'running' | 'idle' | 'unknown'
  color?: string
  idleSince?: string // ISO timestamp from idle notification
  tmuxPaneId: string
  cwd: string
  worktreePath?: string
  isHidden?: boolean // Whether the pane is currently hidden from the swarm view
  backendType?: PaneBackendType // The backend type used for this teammate
  mode?: string // Current permission mode for this teammate
}
// TeammateStatus 是成员级视图，字段明显偏多：既有身份（名字、agentId、agentType、model），也有运行态（status 三值、idleSince），还有载体信息（tmux 窗格、工作目录、worktree 路径）与展示开关（是否隐藏、后端类型、权限模式）。多数字段可选，因为不同后端提供的元数据并不齐平。

/**
 * Get detailed teammate statuses for a team
 * Reads isActive from config to determine status
 */
export function getTeammateStatuses(teamName: string): TeammateStatus[] {
  const teamFile = readTeamFile(teamName)
  if (!teamFile) {
    return []
  }

  const hiddenPaneIds = new Set(teamFile.hiddenPaneIds ?? [])
  const statuses: TeammateStatus[] = []

  for (const member of teamFile.members) {
    // Exclude team-lead from the list
    if (member.name === 'team-lead') {
      continue
    }
// 循环里第一个动作就是把 team-lead 跳过：leader 就是当前会话自己，列进成员表会造成自我引用。

    // Read isActive from config, defaulting to true (active) if undefined
    const isActive = member.isActive !== false
    const status: 'running' | 'idle' = isActive ? 'running' : 'idle'

    statuses.push({
      name: member.name,
      agentId: member.agentId,
      agentType: member.agentType,
      model: member.model,
      prompt: member.prompt,
      status,
      color: member.color,
      tmuxPaneId: member.tmuxPaneId,
      cwd: member.cwd,
      worktreePath: member.worktreePath,
      isHidden: hiddenPaneIds.has(member.tmuxPaneId),
      backendType:
        member.backendType && isPaneBackend(member.backendType)
          ? member.backendType
          : undefined,
      mode: member.mode,
    })
  }

  return statuses
}
// 状态判定用的是「不等于 false 即视为活跃」而不是布尔真值判断，因为磁盘上的旧数据可能没有这个字段，缺省应当算运行中。隐藏标记则反过来由团队的隐藏窗格集合推导，保证与聚合视图的口径一致；后端类型还要过一次类型守卫，非法值降级为 undefined 而不是原样透出。

// Note: For time formatting, use formatRelativeTimeAgo from '../utils/format.js'
