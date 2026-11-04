import type { Tools } from '../../Tool.js'
import { resolveAgentTools } from '../../tools/AgentTool/agentToolUtils.js'
import type {
  AgentDefinition,
  CustomAgentDefinition,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getAgentSourceDisplayName } from './utils.js'

// AgentValidationResult：isValid 加 errors 与 warnings 两个列表——错误阻止保存，警告只提示不拦截，两级分开收集。
export type AgentValidationResult = {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

// validateAgentType 单独导出：向导第一步（TypeStep）在输入时就实时调用它，保存前的整体验证复用同一套规则——两处校验永不漂移。规则：非空、首尾必须是字母数字（中间可含连字符）、长度 3 到 50。
export function validateAgentType(agentType: string): string | null {
  if (!agentType) {
    return 'Agent type is required'
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(agentType)) {
    return 'Agent type must start and end with alphanumeric characters and contain only letters, numbers, and hyphens'
  }

  if (agentType.length < 3) {
    return 'Agent type must be at least 3 characters long'
  }

  if (agentType.length > 50) {
    return 'Agent type must be less than 50 characters'
  }

  return null
}

// validateAgent 主函数：新建与编辑共用。参数不含 location——来源在调用方决定，验证只关心定义本身。
export function validateAgent(
  agent: Omit<CustomAgentDefinition, 'location'>,
  availableTools: Tools,
  existingAgents: AgentDefinition[],
): AgentValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate agent type
  if (!agent.agentType) {
    errors.push('Agent type is required')
  } else {
    const typeError = validateAgentType(agent.agentType)
    if (typeError) {
      errors.push(typeError)
    }

    // Check for duplicates (excluding self for editing)
// 查重排除同 source 的同名项：编辑场景下代理自己的旧定义也在 existingAgents 里，不过滤会把自己误报成重复。跨 source 撞名（用户配置与插件撞名）仍然报错。
    const duplicate = existingAgents.find(
      a => a.agentType === agent.agentType && a.source !== agent.source,
    )
    if (duplicate) {
      errors.push(
        `Agent type "${agent.agentType}" already exists in ${getAgentSourceDisplayName(duplicate.source)}`,
      )
    }
  }

  // Validate description
// 描述三级：缺失是错误；不足 10 字符是警告（太短_whenToUse_无法指导路由）；超 5000 字符也是警告（路由时全文都要进上下文）。注意 _whenToUse_ 字段同时承担「描述」与「何时使用」两个语义。
  if (!agent.whenToUse) {
    errors.push('Description (description) is required')
  } else if (agent.whenToUse.length < 10) {
    warnings.push(
      'Description should be more descriptive (at least 10 characters)',
    )
  } else if (agent.whenToUse.length > 5000) {
    warnings.push('Description is very long (over 5000 characters)')
  }

  // Validate tools
// 工具校验：类型不是数组是错误；undefined（继承全部工具）与空数组只给警告——前者能力全开需用户知情，后者近乎残废也需知情，但都不是格式错误。无效工具名经 resolveAgentTools 解析后是错误。
  if (agent.tools !== undefined && !Array.isArray(agent.tools)) {
    errors.push('Tools must be an array')
  } else {
    if (agent.tools === undefined) {
      warnings.push('Agent has access to all tools')
    } else if (agent.tools.length === 0) {
      warnings.push(
        'No tools selected - agent will have very limited capabilities',
      )
    }

    // Check for invalid tools
    const resolvedTools = resolveAgentTools(agent, availableTools, false)

    if (resolvedTools.invalidTools.length > 0) {
      errors.push(`Invalid tools: ${resolvedTools.invalidTools.join(', ')}`)
    }
  }

  // Validate system prompt
// 系统提示词：缺失或不足 20 字符是错误（空提示词的代理毫无用处）；超 1 万字符只是警告——长提示词合法，只是费 token。
  const systemPrompt = agent.getSystemPrompt()
  if (!systemPrompt) {
    errors.push('System prompt is required')
  } else if (systemPrompt.length < 20) {
    errors.push('System prompt is too short (minimum 20 characters)')
  } else if (systemPrompt.length > 10000) {
    warnings.push('System prompt is very long (over 10,000 characters)')
  }

// isValid 只看 errors：警告的存在不阻止保存。这个函数是「错误拦、警告劝」分级校验的完整范本。
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
