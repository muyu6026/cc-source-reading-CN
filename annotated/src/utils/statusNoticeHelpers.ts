// 本文件提供「状态提示」相关的辅助：估算所有 agent 描述的累计 token 数，用于决定是否折叠展示。
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'

export const AGENT_DESCRIPTIONS_THRESHOLD = 15_000
// AGENT_DESCRIPTIONS_THRESHOLD 是累计 token 的阈值，定为 15000；超过即认为描述过多需要精简。

/**
 * Calculate cumulative token estimate for agent descriptions
 */
export function getAgentDescriptionsTotalTokens(
  agentDefinitions?: AgentDefinitionsResult,
): number {
  if (!agentDefinitions) return 0

  return agentDefinitions.activeAgents
    .filter(a => a.source !== 'built-in')
    .reduce((total, agent) => {
      const description = `${agent.agentType}: ${agent.whenToUse}`
      return total + roughTokenCountEstimation(description)
    }, 0)
}
// getAgentDescriptionsTotalTokens 过滤掉内置 agent，把每个自定义 agent 的「类型加使用时机」拼成一句再用粗略 tokenizer 估算，最后累加返回总 token 数；无 agent 定义时直接返回 0。
