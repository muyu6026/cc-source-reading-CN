// claude agents 子命令处理器：打印已配置智能体清单；仅在运行该命令时动态导入，避免常驻依赖
/**
 * Agents subcommand handler — prints the list of configured agents.
 * Dynamically imported only when `claude agents` runs.
 */

import {
  AGENT_SOURCE_GROUPS,
  compareAgentsByName,
  getOverrideSourceLabel,
  type ResolvedAgent,
  resolveAgentModelDisplay,
  resolveAgentOverrides,
} from '../../tools/AgentTool/agentDisplay.js'
// 从 AgentTool 展示模块引入聚合、排序与显示相关工具
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '../../tools/AgentTool/loadAgentsDir.js'
// 从 AgentTool 加载模块引入激活与覆盖解析工具
import { getCwd } from '../../utils/cwd.js'
// 引入 cwd 读取工具

function formatAgent(agent: ResolvedAgent): string {
// 单条智能体格式化：类型 · 模型 · 记忆名
  const model = resolveAgentModelDisplay(agent)
  const parts = [agent.agentType]
  if (model) {
    parts.push(model)
  }
  if (agent.memory) {
    parts.push(`${agent.memory} memory`)
  }
  return parts.join(' · ')
}
// formatAgent 结束：用「 · 」拼接各部分

export async function agentsHandler(): Promise<void> {
// 命令主入口：加载并解析该目录下的智能体，按来源分组打印
  const cwd = getCwd()
  const { allAgents } = await getAgentDefinitionsWithOverrides(cwd)
  const activeAgents = getActiveAgentsFromList(allAgents)
  const resolvedAgents = resolveAgentOverrides(allAgents, activeAgents)

  const lines: string[] = []
  let totalActive = 0

  for (const { label, source } of AGENT_SOURCE_GROUPS) {
// 按来源分组遍历（AGENT_SOURCE_GROUPS）
    const groupAgents = resolvedAgents
      .filter(a => a.source === source)
      .sort(compareAgentsByName)

    if (groupAgents.length === 0) continue

    lines.push(`${label}:`)
    for (const agent of groupAgents) {
// 遍历组内每个智能体，处理被覆盖情况并累计 active 数
      if (agent.overriddenBy) {
        const winnerSource = getOverrideSourceLabel(agent.overriddenBy)
        lines.push(`  (shadowed by ${winnerSource}) ${formatAgent(agent)}`)
      } else {
        lines.push(`  ${formatAgent(agent)}`)
        totalActive++
      }
    }
    lines.push('')
  }

  if (lines.length === 0) {
// 无智能体时仅打印提示，否则打印总数与清单
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('No agents found.')
// 无智能体分支（biome-ignore 在此豁免 console 输出）
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${totalActive} active agents\n`)
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(lines.join('\n').trimEnd())
// 有智能体时打印总数与完整清单
  }
}
