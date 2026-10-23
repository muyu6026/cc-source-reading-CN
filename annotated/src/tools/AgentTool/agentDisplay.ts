/**
 * Shared utilities for displaying agent information.
 * Used by both the CLI `claude agents` handler and the interactive `/agents` command.
 */
// agentDisplay：agent 信息的展示层共享工具——CLI 的 claude agents 处理器和交互式 /agents 命令共用，保证两处口径一致。

import { getDefaultSubagentModel } from '../../utils/model/agent.js'
import {
  getSourceDisplayName,
  type SettingSource,
} from '../../utils/settings/constants.js'
import type { AgentDefinition } from './loadAgentsDir.js'

type AgentSource = SettingSource | 'built-in' | 'plugin'

export type AgentSourceGroup = {
  label: string
  source: AgentSource
}
// AgentSourceGroup：标签 + source 判别式。

/**
 * Ordered list of agent source groups for display.
 * Both the CLI and interactive UI should use this to ensure consistent ordering.
 */
export const AGENT_SOURCE_GROUPS: AgentSourceGroup[] = [
  { label: 'User agents', source: 'userSettings' },
  { label: 'Project agents', source: 'projectSettings' },
  { label: 'Local agents', source: 'localSettings' },
  { label: 'Managed agents', source: 'policySettings' },
  { label: 'Plugin agents', source: 'plugin' },
  { label: 'CLI arg agents', source: 'flagSettings' },
  { label: 'Built-in agents', source: 'built-in' },
]
// AGENT_SOURCE_GROUPS 是展示顺序：user → project → local → managed → plugin → CLI arg → built-in。注意与 getActiveAgentsFromList 的覆盖优先级不是一回事——那是「谁赢」，这是「怎么排」（built-in 垫底因为最没信息量）。

export type ResolvedAgent = AgentDefinition & {
  overriddenBy?: AgentSource
}
// ResolvedAgent：AgentDefinition + overriddenBy——UI 要能显示「这个 agent 被更高优先级的源覆盖了」。

/**
 * Annotate agents with override information by comparing against the active
 * (winning) agent list. An agent is "overridden" when another agent with the
 * same type from a higher-priority source takes precedence.
 *
 * Also deduplicates by (agentType, source) to handle git worktree duplicates
 * where the same agent file is loaded from both the worktree and main repo.
 */
// resolveAgentOverrides：把全量 agent 列表标注上覆盖关系。
export function resolveAgentOverrides(
  allAgents: AgentDefinition[],
  activeAgents: AgentDefinition[],
): ResolvedAgent[] {
  const activeMap = new Map<string, AgentDefinition>()
  for (const agent of activeAgents) {
    activeMap.set(agent.agentType, agent)
  }

  const seen = new Set<string>()
  const resolved: ResolvedAgent[] = []

  // Iterate allAgents, annotating each with override info from activeAgents.
  // Deduplicate by (agentType, source) to handle git worktree duplicates.
  for (const agent of allAgents) {
    const key = `${agent.agentType}:${agent.source}`
    if (seen.has(key)) continue
    seen.add(key)

    const active = activeMap.get(agent.agentType)
    const overriddenBy =
      active && active.source !== agent.source ? active.source : undefined
    resolved.push({ ...agent, overriddenBy })
  }

  return resolved
}
// 两个细节：activeMap 按 agentType 建索引（赢家列表）；遍历全量列表时按 (agentType, source) 去重——git worktree 场景同一份 agent 文件会从 worktree 和主仓库各加载一次，不去重列表里出现两条一模一样的。active 存在且源不同才标 overriddenBy。

/**
 * Resolve the display model string for an agent.
 * Returns the model alias or 'inherit' for display purposes.
 */
export function resolveAgentModelDisplay(
  agent: AgentDefinition,
): string | undefined {
  const model = agent.model || getDefaultSubagentModel()
  if (!model) return undefined
  return model === 'inherit' ? 'inherit' : model
}
// resolveAgentModelDisplay：没声明 model 取默认 subagent 模型；'inherit' 原样返回（显示用，不做解析）。

/**
 * Get a human-readable label for the source that overrides an agent.
 * Returns lowercase, e.g. "user", "project", "managed".
 */
export function getOverrideSourceLabel(source: AgentSource): string {
  return getSourceDisplayName(source).toLowerCase()
}
// getOverrideSourceLabel：小写 source 名（user/project/managed）——覆盖提示文案里用。

/**
 * Compare agents alphabetically by name (case-insensitive).
 */
export function compareAgentsByName(
  a: AgentDefinition,
  b: AgentDefinition,
): number {
  return a.agentType.localeCompare(b.agentType, undefined, {
    sensitivity: 'base',
  })
}
// compareAgentsByName：localeCompare + sensitivity: 'base'——大小写不敏感排序，Agent 和 agent 相邻，列表稳定。
