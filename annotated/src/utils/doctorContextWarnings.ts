// 注：本文件是 doctor 命令的「上下文告警」检查：扫描 CLAUDE.md 过大、智能体描述过长、MCP 工具过多、权限规则不可达四类问题，给出警告级诊断。
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Tool, ToolPermissionContext } from '../Tool.js'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'
import { countMcpToolTokens } from './analyzeContext.js'
import {
  getLargeMemoryFiles,
  getMemoryFiles,
  MAX_MEMORY_CHARACTER_COUNT,
} from './claudemd.js'
import { getMainLoopModel } from './model/model.js'
import { permissionRuleValueToString } from './permissions/permissionRuleParser.js'
import { detectUnreachableRules } from './permissions/shadowedRuleDetection.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import {
  AGENT_DESCRIPTIONS_THRESHOLD,
  getAgentDescriptionsTotalTokens,
} from './statusNoticeHelpers.js'
import { plural } from './stringUtils.js'

// Thresholds (matching status notices and existing patterns)
const MCP_TOOLS_THRESHOLD = 25_000 // 15k tokens
// 注：MCP_TOOLS_THRESHOLD 是 MCP 工具上下文的告警阈值（约两万五千 token），超过就提示用户精简。

// 注：ContextWarning 是一条告警的结构：类型、严重度、消息、明细、当前值与阈值；ContextWarnings 把四类告警打包。
export type ContextWarning = {
  type:
    | 'claudemd_files'
    | 'agent_descriptions'
    | 'mcp_tools'
    | 'unreachable_rules'
  severity: 'warning' | 'error'
  message: string
  details: string[]
  currentValue: number
  threshold: number
}

// 注：ContextWarnings 汇总四种可能的告警（CLAUDE.md / 智能体描述 / MCP 工具 / 不可达规则），任一为 null 表示该项正常。
export type ContextWarnings = {
  claudeMdWarning: ContextWarning | null
  agentWarning: ContextWarning | null
  mcpWarning: ContextWarning | null
  unreachableRulesWarning: ContextWarning | null
}

// 注：checkClaudeMdFiles 找出超过单文件字符上限的 CLAUDE.md，按体积倒序列出明细，超标即告警。
async function checkClaudeMdFiles(): Promise<ContextWarning | null> {
  const largeFiles = getLargeMemoryFiles(await getMemoryFiles())

  // This already filters for files > 40k chars each
  if (largeFiles.length === 0) {
    return null
  }

  const details = largeFiles
    .sort((a, b) => b.content.length - a.content.length)
    .map(file => `${file.path}: ${file.content.length.toLocaleString()} chars`)

  const message =
    largeFiles.length === 1
      ? `Large CLAUDE.md file detected (${largeFiles[0]!.content.length.toLocaleString()} chars > ${MAX_MEMORY_CHARACTER_COUNT.toLocaleString()})`
      : `${largeFiles.length} large CLAUDE.md files detected (each > ${MAX_MEMORY_CHARACTER_COUNT.toLocaleString()} chars)`

  return {
    type: 'claudemd_files',
    severity: 'warning',
    message,
    details,
    currentValue: largeFiles.length, // Number of files exceeding threshold
    threshold: MAX_MEMORY_CHARACTER_COUNT,
  }
}

/**
 * Check agent descriptions token count
 */
// 注：checkAgentDescriptions 统计所有自定义智能体的描述 token 总和，超标时列出最费的几个智能体。
async function checkAgentDescriptions(
  agentInfo: AgentDefinitionsResult | null,
): Promise<ContextWarning | null> {
  if (!agentInfo) {
    return null
  }

  const totalTokens = getAgentDescriptionsTotalTokens(agentInfo)

  if (totalTokens <= AGENT_DESCRIPTIONS_THRESHOLD) {
    return null
  }

  // Calculate tokens for each agent
  const agentTokens = agentInfo.activeAgents
    .filter(a => a.source !== 'built-in')
    .map(agent => {
      const description = `${agent.agentType}: ${agent.whenToUse}`
      return {
        name: agent.agentType,
        tokens: roughTokenCountEstimation(description),
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const details = agentTokens
    .slice(0, 5)
    .map(agent => `${agent.name}: ~${agent.tokens.toLocaleString()} tokens`)

  if (agentTokens.length > 5) {
    details.push(`(${agentTokens.length - 5} more custom agents)`)
  }

  return {
    type: 'agent_descriptions',
    severity: 'warning',
    message: `Large agent descriptions (~${totalTokens.toLocaleString()} tokens > ${AGENT_DESCRIPTIONS_THRESHOLD.toLocaleString()})`,
    details,
    currentValue: totalTokens,
    threshold: AGENT_DESCRIPTIONS_THRESHOLD,
  }
}

/**
 * Check MCP tools token count
 */
// 注：checkMcpTools 统计 MCP 工具上下文用量，按服务器分组排序，列出最费 token 的几个；计数失败则退化为按字符估算。
async function checkMcpTools(
  tools: Tool[],
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
): Promise<ContextWarning | null> {
  const mcpTools = tools.filter(tool => tool.isMcp)

  // Note: MCP tools are loaded asynchronously and may not be available
  // when doctor command runs, as it executes before MCP connections are established
  if (mcpTools.length === 0) {
    return null
  }

  try {
    // Use the existing countMcpToolTokens function from analyzeContext
    const model = getMainLoopModel()
    const { mcpToolTokens, mcpToolDetails } = await countMcpToolTokens(
      tools,
      getToolPermissionContext,
      agentInfo,
      model,
    )

    if (mcpToolTokens <= MCP_TOOLS_THRESHOLD) {
      return null
    }

    // Group tools by server
    const toolsByServer = new Map<string, { count: number; tokens: number }>()

    for (const tool of mcpToolDetails) {
      // Extract server name from tool name (format: mcp__servername__toolname)
      const parts = tool.name.split('__')
      const serverName = parts[1] || 'unknown'

      const current = toolsByServer.get(serverName) || { count: 0, tokens: 0 }
      toolsByServer.set(serverName, {
        count: current.count + 1,
        tokens: current.tokens + tool.tokens,
      })
    }

    // Sort servers by token count
    const sortedServers = Array.from(toolsByServer.entries()).sort(
      (a, b) => b[1].tokens - a[1].tokens,
    )

    const details = sortedServers
      .slice(0, 5)
      .map(
        ([name, info]) =>
          `${name}: ${info.count} tools (~${info.tokens.toLocaleString()} tokens)`,
      )

    if (sortedServers.length > 5) {
      details.push(`(${sortedServers.length - 5} more servers)`)
    }

    return {
      type: 'mcp_tools',
      severity: 'warning',
      message: `Large MCP tools context (~${mcpToolTokens.toLocaleString()} tokens > ${MCP_TOOLS_THRESHOLD.toLocaleString()})`,
      details,
      currentValue: mcpToolTokens,
      threshold: MCP_TOOLS_THRESHOLD,
    }
  } catch (_error) {
    // If token counting fails, fall back to character-based estimation
    const estimatedTokens = mcpTools.reduce((total, tool) => {
      const chars = (tool.name?.length || 0) + tool.description.length
      return total + roughTokenCountEstimation(chars.toString())
    }, 0)

    if (estimatedTokens <= MCP_TOOLS_THRESHOLD) {
      return null
    }

    return {
      type: 'mcp_tools',
      severity: 'warning',
      message: `Large MCP tools context (~${estimatedTokens.toLocaleString()} tokens estimated > ${MCP_TOOLS_THRESHOLD.toLocaleString()})`,
      details: [
        `${mcpTools.length} MCP tools detected (token count estimated)`,
      ],
      currentValue: estimatedTokens,
      threshold: MCP_TOOLS_THRESHOLD,
    }
  }
}

/**
 * Check for unreachable permission rules (e.g., specific allow rules shadowed by tool-wide ask rules)
 */
// 注：checkUnreachableRules 调用影子规则检测，找出被更宽规则盖掉、永远不生效的权限规则，并给出修复建议。
async function checkUnreachableRules(
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
): Promise<ContextWarning | null> {
  const context = await getToolPermissionContext()
  const sandboxAutoAllowEnabled =
    SandboxManager.isSandboxingEnabled() &&
    SandboxManager.isAutoAllowBashIfSandboxedEnabled()

  const unreachable = detectUnreachableRules(context, {
    sandboxAutoAllowEnabled,
  })

  if (unreachable.length === 0) {
    return null
  }

  const details = unreachable.flatMap(r => [
    `${permissionRuleValueToString(r.rule.ruleValue)}: ${r.reason}`,
    `  Fix: ${r.fix}`,
  ])

  return {
    type: 'unreachable_rules',
    severity: 'warning',
    message: `${unreachable.length} ${plural(unreachable.length, 'unreachable permission rule')} detected`,
    details,
    currentValue: unreachable.length,
    threshold: 0,
  }
}

/**
 * Check all context warnings for the doctor command
 */
// 注：checkContextWarnings 并行跑上面四个检查，汇总成 ContextWarnings 一并返回。
export async function checkContextWarnings(
  tools: Tool[],
  agentInfo: AgentDefinitionsResult | null,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
): Promise<ContextWarnings> {
  const [claudeMdWarning, agentWarning, mcpWarning, unreachableRulesWarning] =
    await Promise.all([
      checkClaudeMdFiles(),
      checkAgentDescriptions(agentInfo),
      checkMcpTools(tools, getToolPermissionContext, agentInfo),
      checkUnreachableRules(getToolPermissionContext),
    ])

  return {
    claudeMdWarning,
    agentWarning,
    mcpWarning,
    unreachableRulesWarning,
  }
}
