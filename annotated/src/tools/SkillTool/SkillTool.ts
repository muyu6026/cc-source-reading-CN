import { feature } from 'bun:bundle'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import uniqBy from 'lodash-es/uniqBy.js'
import { dirname } from 'path'
import { getProjectRoot } from 'src/bootstrap/state.js'
import {
  builtInCommandNames,
  findCommand,
  getCommands,
  type PromptCommand,
} from 'src/commands.js'
import type {
  Tool,
  ToolCallProgress,
  ToolResult,
  ToolUseContext,
  ValidationResult,
} from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import type { Command } from 'src/types/command.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  SystemMessage,
  UserMessage,
} from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from 'src/utils/permissions/permissions.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from 'src/utils/plugins/pluginIdentifier.js'
import { buildPluginCommandTelemetryFields } from 'src/utils/telemetry/pluginTelemetry.js'
import { z } from 'zod/v4'
import {
  addInvokedSkill,
  clearInvokedSkillsForAgent,
  getSessionId,
} from '../../bootstrap/state.js'
import { COMMAND_MESSAGE_TAG } from '../../constants/xml.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import { getAgentContext } from '../../utils/agentContext.js'
import { errorMessage } from '../../utils/errors.js'
import {
  extractResultText,
  prepareForkedCommandContext,
} from '../../utils/forkedAgent.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createUserMessage, normalizeMessages } from '../../utils/messages.js'
import type { ModelAlias } from '../../utils/model/aliases.js'
import { resolveSkillModelOverride } from '../../utils/model/model.js'
import { recordSkillUsage } from '../../utils/suggestions/skillUsageTracking.js'
import { createAgentId } from '../../utils/uuid.js'
import { runAgent } from '../AgentTool/runAgent.js'
import {
  getToolUseIDFromParentMessage,
  tagMessagesWithToolUseID,
} from '../utils.js'
import { SKILL_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

/**
 * Gets all commands including MCP skills/prompts from AppState.
 * SkillTool needs this because getCommands() only returns local/bundled skills.
 */
async function getAllCommands(context: ToolUseContext): Promise<Command[]> {
  // Only include MCP skills (loadedFrom === 'mcp'), not plain MCP prompts.
  // Before this filter, the model could invoke MCP prompts via SkillTool
  // if it guessed the mcp__server__prompt name — they weren't discoverable
  // but were technically reachable.
  const mcpSkills = context
    .getAppState()
    .mcp.commands.filter(
      cmd => cmd.type === 'prompt' && cmd.loadedFrom === 'mcp',
    )
  if (mcpSkills.length === 0) return getCommands(getProjectRoot())
  const localCommands = await getCommands(getProjectRoot())
  return uniqBy([...localCommands, ...mcpSkills], 'name')
}
// getAllCommands 补了 getCommands 的盲区：本地/内置技能之外，还要并上 MCP 技能。关键在过滤条件——只收 loadedFrom === 'mcp' 的 prompt 型命令，普通 MCP prompt 不收。英文注释解释了原因：不过滤的话，模型只要猜中 mcp__server__prompt 这种名字就能调到它们——不可发现但可达，等于开了个没文档的后门。uniqBy name 去重时本地命令排前面（同名时本地赢）。

// Re-export Progress from centralized types to break import cycles
export type { SkillToolProgress as Progress } from '../../types/tools.js'

import type { SkillToolProgress as Progress } from '../../types/tools.js'

// Conditional require for remote skill modules — static imports here would
// pull in akiBackend.ts (via remoteSkillLoader → akiBackend), which has
// module-level memoize()/lazySchema() consts that survive tree-shaking as
// side-effecting initializers. All usages are inside
// feature('EXPERIMENTAL_SKILL_SEARCH') guards, so remoteSkillModules is
// non-null at every call site.
/* eslint-disable @typescript-eslint/no-require-imports */
const remoteSkillModules = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? {
      ...(require('../../services/skillSearch/remoteSkillState.js') as typeof import('../../services/skillSearch/remoteSkillState.js')),
      ...(require('../../services/skillSearch/remoteSkillLoader.js') as typeof import('../../services/skillSearch/remoteSkillLoader.js')),
      ...(require('../../services/skillSearch/telemetry.js') as typeof import('../../services/skillSearch/telemetry.js')),
      ...(require('../../services/skillSearch/featureCheck.js') as typeof import('../../services/skillSearch/featureCheck.js')),
    }
  : null
// 条件 require 是这份文件最讲究的一处：远端技能模块不能用静态 import——静态引入会连带拉进 akiBackend.ts，它模块顶层的 memoize()/lazySchema() 常量会在 tree-shaking 后幸存、变成带副作用的初始化器（冷启动白干活）。所有调用点都在 feature 守卫内，所以 remoteSkillModules 在用到处必非空（后面的 ! 断言因此成立）。
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Executes a skill in a forked sub-agent context.
 * This runs the skill prompt in an isolated agent with its own token budget.
 */
async function executeForkedSkill(
  command: Command & { type: 'prompt' },
  commandName: string,
  args: string | undefined,
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  parentMessage: AssistantMessage,
  onProgress?: ToolCallProgress<Progress>,
): Promise<ToolResult<Output>> {
// executeForkedSkill：skill 的 frontmatter 里声明 context: 'fork' 时走这条路——把技能 prompt 丢进一个独立 token 预算的子代理跑完，只把最终结果带回主对话。与 inline（把技能展开成消息注入主对话）是两种完全不同的执行模型。
  const startTime = Date.now()
  const agentId = createAgentId()
  const isBuiltIn = builtInCommandNames().has(commandName)
  const isOfficialSkill = isOfficialMarketplaceSkill(command)
  const isBundled = command.source === 'bundled'
  const forkedSanitizedName =
    isBuiltIn || isBundled || isOfficialSkill ? commandName : 'custom'
// forkedSanitizedName 是遥测脱敏：内置/捆绑/官方市场的技能才发真实名字，第三方的统一记作 'custom'——遥测里不能出现用户自建技能的名字。这个脱敏名在 inline 路径（659 行）再算一遍，两处逻辑一致。

  const wasDiscoveredField =
    feature('EXPERIMENTAL_SKILL_SEARCH') &&
    remoteSkillModules!.isSkillSearchEnabled()
      ? {
          was_discovered:
            context.discoveredSkillNames?.has(commandName) ?? false,
        }
      : {}
  const pluginMarketplace = command.pluginInfo
    ? parsePluginIdentifier(command.pluginInfo.repository).marketplace
    : undefined
  const queryDepth = context.queryTracking?.depth ?? 0
  const parentAgentId = getAgentContext()?.agentId
  logEvent('tengu_skill_tool_invocation', {
    command_name:
      forkedSanitizedName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    // _PROTO_skill_name routes to the privileged skill_name BQ column
    // (unredacted, all users); command_name stays in additional_metadata as
    // the redacted variant for general-access dashboards.
    _PROTO_skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    execution_context:
      'fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: (queryDepth > 0
      ? 'nested-skill'
      : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    query_depth: queryDepth,
    ...(parentAgentId && {
      parent_agent_id:
        parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...wasDiscoveredField,
    ...(process.env.USER_TYPE === 'ant' && {
      skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_source:
        command.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(command.loadedFrom && {
        skill_loaded_from:
          command.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(command.kind && {
        skill_kind:
          command.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    }),
    ...(command.pluginInfo && {
      // _PROTO_* routes to PII-tagged plugin_name/marketplace_name BQ columns
      // (unredacted, all users); plugin_name/plugin_repository stay in
      // additional_metadata as redacted variants.
      _PROTO_plugin_name: command.pluginInfo.pluginManifest
        .name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(pluginMarketplace && {
        _PROTO_marketplace_name:
          pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      plugin_name: (isOfficialSkill
        ? command.pluginInfo.pluginManifest.name
        : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      plugin_repository: (isOfficialSkill
        ? command.pluginInfo.repository
        : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginCommandTelemetryFields(command.pluginInfo),
    }),
  })
// 整块遥测值得学的是双通道设计：_PROTO_ 前缀的字段路由到特权 BQ 列（不脱敏、全员可查审计用），普通字段留在 additional_metadata（脱敏版、一般仪表盘用）。同一份事实按读者权限分两份存。invocation_trigger 区分 nested-skill（queryDepth > 0，技能调技能）与 claude-proactive（模型主动调）；USER_TYPE ant 才附带的细粒度字段是内部排障用的。

  const { modifiedGetAppState, baseAgent, promptMessages, skillContent } =
    await prepareForkedCommandContext(command, args || '', context)

  // Merge skill's effort into the agent definition so runAgent applies it
  const agentDefinition =
    command.effort !== undefined
      ? { ...baseAgent, effort: command.effort }
      : baseAgent
// 技能 frontmatter 可以声明 effort，这里把它并进 agent 定义，让 runAgent 统一应用——技能不只是 prompt，还能带推理力度/模型等执行参数。

  // Collect messages from the forked agent
  const agentMessages: Message[] = []

  logForDebugging(
    `SkillTool executing forked skill ${commandName} with agent ${agentDefinition.agentType}`,
  )

  try {
    // Run the sub-agent
    for await (const message of runAgent({
      agentDefinition,
      promptMessages,
      toolUseContext: {
        ...context,
        getAppState: modifiedGetAppState,
      },
      canUseTool,
      isAsync: false,
      querySource: 'agent:custom',
      model: command.model as ModelAlias | undefined,
      availableTools: context.options.tools,
      override: { agentId },
    })) {
// runAgent 的参数有几个细节：isAsync: false（fork 模式要等结果）、querySource 'agent:custom'、model 用技能声明的覆盖、availableTools 透传主对话的工具集（技能不改工具清单，改的是权限判断）。消息流 for await 逐条推给 agentMessages，同时挑出带 tool_use/tool_result 的消息发进度。
      agentMessages.push(message)

      // Report progress for tool uses (like AgentTool does)
      if (
        (message.type === 'assistant' || message.type === 'user') &&
        onProgress
      ) {
        const normalizedNew = normalizeMessages([message])
        for (const m of normalizedNew) {
          const hasToolContent = m.message.content.some(
            c => c.type === 'tool_use' || c.type === 'tool_result',
          )
          if (hasToolContent) {
            onProgress({
              toolUseID: `skill_${parentMessage.message.id}`,
              data: {
                message: m,
                type: 'skill_progress',
                prompt: skillContent,
                agentId,
              },
            })
          }
        }
      }
    }

    const resultText = extractResultText(
      agentMessages,
      'Skill execution completed',
    )
    // Release message memory after extracting result
    agentMessages.length = 0
// 提取完结果文本立刻 agentMessages.length = 0 释放内存——fork 一整轮的消息数组可能很大，结果已拿到就该放手。这是长会话进程里防内存缓慢爬升的实招。

    const durationMs = Date.now() - startTime
    logForDebugging(
      `SkillTool forked skill ${commandName} completed in ${durationMs}ms`,
    )

    return {
      data: {
        success: true,
        commandName,
        status: 'forked',
        agentId,
        result: resultText,
      },
    }
  } finally {
    // Release skill content from invokedSkills state
    clearInvokedSkillsForAgent(agentId)
  }
// finally 里 clearInvokedSkillsForAgent：invokedSkills 是「压缩时保留技能内容」的登记表（见 remote 路径的 addInvokedSkill），fork 结束（无论成败）都要释放，否则子代理的技能内容会一直占着状态。
}

export const inputSchema = lazySchema(() =>
  z.object({
    skill: z
      .string()
      .describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
    args: z.string().optional().describe('Optional arguments for the skill'),
  }),
)
// 输入 schema 只有 skill + args 两个字段——Skill 工具的输入面刻意做到最小，真正的行为差异全在技能声明的 frontmatter 里（context/model/effort/allowed-tools），而不是调用参数里。
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() => {
  // Output schema for inline skills (default)
  const inlineOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill is valid'),
    commandName: z.string().describe('The name of the skill'),
    allowedTools: z
      .array(z.string())
      .optional()
      .describe('Tools allowed by this skill'),
    model: z.string().optional().describe('Model override if specified'),
    status: z.literal('inline').optional().describe('Execution status'),
  })

  // Output schema for forked skills
  const forkedOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill completed successfully'),
    commandName: z.string().describe('The name of the skill'),
    status: z.literal('forked').describe('Execution status'),
    agentId: z
      .string()
      .describe('The ID of the sub-agent that executed the skill'),
    result: z.string().describe('The result from the forked skill execution'),
  })

  return z.union([inlineOutputSchema, forkedOutputSchema])
// 输出 schema 是 union：inline 模式返回 allowedTools/model（展开成什么），forked 模式返回 agentId/result（跑出了什么）。一个工具两种执行模型，靠 status 字面量在类型层面分开，消费方不用猜。
})
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.input<OutputSchema>

export const SkillTool: Tool<InputSchema, Output, Progress> = buildTool({
  name: SKILL_TOOL_NAME,
  searchHint: 'invoke a slash-command skill',
  maxResultSizeChars: 100_000,
// 100,000 字符上限与 Glob 相同——forked 技能的 result 可能很长（子代理跑完的总结），阈值不能像 Grep 那样卡在 20K 的落盘临界点上。
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  description: async ({ skill }) => `Execute skill: ${skill}`,

  prompt: async () => getPrompt(getProjectRoot()),

  // Only one skill/command should run at a time, since the tool expands the
  // command into a full prompt that Claude must process before continuing.
  // Skill-coach needs the skill name to avoid false-positive "you could have
  // used skill X" suggestions when X was actually invoked. Backseat classifies
  // downstream tool calls from the expanded prompt, not this wrapper, so the
  // name alone is sufficient — it just records that the skill fired.
// toAutoClassifierInput 只给技能名的两个理由（英文注释写明）：① 同一时刻只应跑一个技能——工具会把命令展开成完整 prompt，模型必须先消化完再继续，所以没有并行可言；② skill-coach（「你本可以用技能 X」的提示器）需要知道这个技能真的触发过，否则会给出假阳性建议。分类的是展开后 prompt 里的下游工具调用，不是这层包装，所以只报名字就够。
  toAutoClassifierInput: ({ skill }) => skill ?? '',

  async validateInput({ skill }, context): Promise<ValidationResult> {
    // Skills are just skill names, no arguments
    const trimmed = skill.trim()
    if (!trimmed) {
      return {
        result: false,
        message: `Invalid skill format: ${skill}`,
        errorCode: 1,
      }
    }

    // Remove leading slash if present (for compatibility)
    const hasLeadingSlash = trimmed.startsWith('/')
    if (hasLeadingSlash) {
      logEvent('tengu_skill_tool_slash_prefix', {})
    }
// 模型经常习惯性带前导斜杠调技能（/commit）——这里容忍并把「带斜杠」单独打点统计发生率。兼容性处理带遥测，后续好评估要不要砍掉。
    const normalizedCommandName = hasLeadingSlash
      ? trimmed.substring(1)
      : trimmed

    // Remote canonical skill handling (ant-only experimental). Intercept
    // `_canonical_<slug>` names before local command lookup since remote
    // skills are not in the local command registry.
    if (
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      process.env.USER_TYPE === 'ant'
    ) {
      const slug = remoteSkillModules!.stripCanonicalPrefix(
        normalizedCommandName,
      )
      if (slug !== null) {
        const meta = remoteSkillModules!.getDiscoveredRemoteSkill(slug)
        if (!meta) {
          return {
            result: false,
            message: `Remote skill ${slug} was not discovered in this session. Use DiscoverSkills to find remote skills first.`,
            errorCode: 6,
          }
        }
        // Discovered remote skill — valid. Loading happens in call().
        return { result: true }
      }
    }
// 远端技能（_canonical_ 前缀，ant 内部实验）在本地命令查找之前拦截——因为它们不在本地注册表里，validateInput 只能确认「本会话发现过」，真正加载推迟到 call()。没发现过的远端技能报错并提示先跑 DiscoverSkills。

    // Get available commands (including MCP skills)
    const commands = await getAllCommands(context)

    // Check if command exists
    const foundCommand = findCommand(normalizedCommandName, commands)
    if (!foundCommand) {
      return {
        result: false,
        message: `Unknown skill: ${normalizedCommandName}`,
        errorCode: 2,
      }
    }

    // Check if command has model invocation disabled
    if (foundCommand.disableModelInvocation) {
      return {
        result: false,
        message: `Skill ${normalizedCommandName} cannot be used with ${SKILL_TOOL_NAME} tool due to disable-model-invocation`,
        errorCode: 4,
      }
    }
// disableModelInvocation：技能可以声明「只许用户手动 /调，不许模型自己调」。校验层直接拒绝并说明原因——这条 frontmatter 键是技能作者控制模型行为的第一道闸。

    // Check if command is a prompt-based command
    if (foundCommand.type !== 'prompt') {
      return {
        result: false,
        message: `Skill ${normalizedCommandName} is not a prompt-based skill`,
        errorCode: 5,
      }
    }

    return { result: true }
  },

  async checkPermissions(
    { skill, args },
    context,
  ): Promise<PermissionDecision> {
    // Skills are just skill names, no arguments
    const trimmed = skill.trim()

    // Remove leading slash if present (for compatibility)
    const commandName = trimmed.startsWith('/') ? trimmed.substring(1) : trimmed

    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    // Look up the command object to pass as metadata
    const commands = await getAllCommands(context)
    const commandObj = findCommand(commandName, commands)

    // Helper function to check if a rule matches the skill
    // Normalizes both inputs by stripping leading slashes for consistent matching
    const ruleMatches = (ruleContent: string): boolean => {
      // Normalize rule content by stripping leading slash
      const normalizedRule = ruleContent.startsWith('/')
        ? ruleContent.substring(1)
        : ruleContent

      // Check exact match (using normalized commandName)
      if (normalizedRule === commandName) {
        return true
      }
      // Check prefix match (e.g., "review:*" matches "review-pr 123")
      if (normalizedRule.endsWith(':*')) {
        const prefix = normalizedRule.slice(0, -2) // Remove ':*'
        return commandName.startsWith(prefix)
      }
      return false
    }
// ruleMatches 支持两种规则写法：全名精确匹配，或 review:* 前缀通配（匹配 review-pr 123 这类带参调用）。两边都先剥掉前导斜杠再比——用户写规则时带不带斜杠都能命中。

    // Check for deny rules
    const denyRules = getRuleByContentsForTool(
      permissionContext,
      SkillTool as Tool,
      'deny',
    )
    for (const [ruleContent, rule] of denyRules.entries()) {
      if (ruleMatches(ruleContent)) {
        return {
          behavior: 'deny',
          message: `Skill execution blocked by permission rules`,
          decisionReason: {
            type: 'rule',
            rule,
          },
        }
      }
    }
// deny 规则最先查——权限判定的固定顺序：先否决再放行，任何 allow 路径都不能越过显式 deny。

    // Remote canonical skills are ant-only experimental — auto-grant.
    // Placed AFTER the deny loop so a user-configured Skill(_canonical_:*)
    // deny rule is honored (same pattern as safe-properties auto-allow below).
    // The skill content itself is canonical/curated, not user-authored.
    if (
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      process.env.USER_TYPE === 'ant'
    ) {
      const slug = remoteSkillModules!.stripCanonicalPrefix(commandName)
      if (slug !== null) {
        return {
          behavior: 'allow',
          updatedInput: { skill, args },
          decisionReason: undefined,
        }
      }
    }
// 远端技能自动放行放在 deny 循环之后——顺序即正确性：用户显式配了 Skill(_canonical_:*) 的 deny 规则时必须生效（英文注释点明这与下面的 safe-properties 自动放行是同一模式）。理由是官方策展内容不是用户手写的，但用户的否决权永远更大。

    // Check for allow rules
    const allowRules = getRuleByContentsForTool(
      permissionContext,
      SkillTool as Tool,
      'allow',
    )
    for (const [ruleContent, rule] of allowRules.entries()) {
      if (ruleMatches(ruleContent)) {
        return {
          behavior: 'allow',
          updatedInput: { skill, args },
          decisionReason: {
            type: 'rule',
            rule,
          },
        }
      }
    }

    // Auto-allow skills that only use safe properties.
    // This is an allowlist: if a skill has any property NOT in this set with a
    // meaningful value, it requires permission. This ensures new properties added
    // in the future default to requiring permission.
    if (
      commandObj?.type === 'prompt' &&
      skillHasOnlySafeProperties(commandObj)
    ) {
      return {
        behavior: 'allow',
        updatedInput: { skill, args },
        decisionReason: undefined,
      }
    }
// safe-properties 自动放行是个白名单设计：技能声明的所有属性都在安全清单里（见文件尾部的 SAFE_SKILL_PROPERTIES）才免确认。英文注释强调了方向——将来给 PromptCommand 加新属性时，默认需要权限，直到人工审核后加进白名单。fail-closed 的扩展策略。

    // Prepare suggestions for exact skill and prefix
    // Use normalized commandName (without leading slash) for consistent rules
    const suggestions = [
      // Exact skill suggestion
      {
        type: 'addRules' as const,
        rules: [
          {
            toolName: SKILL_TOOL_NAME,
            ruleContent: commandName,
          },
        ],
        behavior: 'allow' as const,
        destination: 'localSettings' as const,
      },
      // Prefix suggestion to allow any args
      {
        type: 'addRules' as const,
        rules: [
          {
            toolName: SKILL_TOOL_NAME,
            ruleContent: `${commandName}:*`,
          },
        ],
        behavior: 'allow' as const,
        destination: 'localSettings' as const,
      },
    ]
// ask 时附带两条建议规则：精确名（只放这个技能）和 :* 前缀（放这个技能带任意参数）。用户在确认弹窗里一键选「仅这次」还是「以后都行」，不用手写规则文件。

    // Default behavior: ask user for permission
    return {
      behavior: 'ask',
      message: `Execute skill: ${commandName}`,
      decisionReason: undefined,
      suggestions,
      updatedInput: { skill, args },
      metadata: commandObj ? { command: commandObj } : undefined,
    }
  },

  async call(
    { skill, args },
    context,
    canUseTool,
    parentMessage,
    onProgress?,
  ): Promise<ToolResult<Output>> {
    // At this point, validateInput has already confirmed:
    // - Skill format is valid
    // - Skill exists
    // - Skill can be loaded
    // - Skill doesn't have disableModelInvocation
    // - Skill is a prompt-based skill

    // Skills are just names, with optional arguments
    const trimmed = skill.trim()

    // Remove leading slash if present (for compatibility)
    const commandName = trimmed.startsWith('/') ? trimmed.substring(1) : trimmed

    // Remote canonical skill execution (ant-only experimental). Intercepts
    // `_canonical_<slug>` before local command lookup — loads SKILL.md from
    // AKI/GCS (with local cache), injects content directly as a user message.
    // Remote skills are declarative markdown so no slash-command expansion
    // (no !command substitution, no $ARGUMENTS interpolation) is needed.
    if (
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      process.env.USER_TYPE === 'ant'
    ) {
      const slug = remoteSkillModules!.stripCanonicalPrefix(commandName)
      if (slug !== null) {
        return executeRemoteSkill(slug, commandName, parentMessage, context)
      }
    }

    const commands = await getAllCommands(context)
    const command = findCommand(commandName, commands)

    // Track skill usage for ranking
    recordSkillUsage(commandName)

    // Check if skill should run as a forked sub-agent
    if (command?.type === 'prompt' && command.context === 'fork') {
      return executeForkedSkill(
        command,
        commandName,
        args,
        context,
        canUseTool,
        parentMessage,
        onProgress,
      )
    }
// inline 与 fork 的分岔点：技能 frontmatter 的 context === 'fork' 决定走子代理，否则走展开注入。到 call() 这一步 validateInput 已确认过全部五项（格式/存在/可加载/没禁模型调用/是 prompt 型），这里不再重复校验。

    // Process the skill with optional args
    const { processPromptSlashCommand } = await import(
      'src/utils/processUserInput/processSlashCommand.js'
    )
    const processedCommand = await processPromptSlashCommand(
      commandName,
      args || '', // Pass args if provided
      commands,
      context,
    )

    if (!processedCommand.shouldQuery) {
      throw new Error('Command processing failed')
    }

    // Extract metadata from the command
    const allowedTools = processedCommand.allowedTools || []
    const model = processedCommand.model
    const effort = command?.type === 'prompt' ? command.effort : undefined

    const isBuiltIn = builtInCommandNames().has(commandName)
    const isBundled = command?.type === 'prompt' && command.source === 'bundled'
    const isOfficialSkill =
      command?.type === 'prompt' && isOfficialMarketplaceSkill(command)
    const sanitizedCommandName =
      isBuiltIn || isBundled || isOfficialSkill ? commandName : 'custom'

    const wasDiscoveredField =
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      remoteSkillModules!.isSkillSearchEnabled()
        ? {
            was_discovered:
              context.discoveredSkillNames?.has(commandName) ?? false,
          }
        : {}
    const pluginMarketplace =
      command?.type === 'prompt' && command.pluginInfo
        ? parsePluginIdentifier(command.pluginInfo.repository).marketplace
        : undefined
    const queryDepth = context.queryTracking?.depth ?? 0
    const parentAgentId = getAgentContext()?.agentId
    logEvent('tengu_skill_tool_invocation', {
      command_name:
        sanitizedCommandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      // _PROTO_skill_name routes to the privileged skill_name BQ column
      // (unredacted, all users); command_name stays in additional_metadata as
      // the redacted variant for general-access dashboards.
      _PROTO_skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      execution_context:
        'inline' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      invocation_trigger: (queryDepth > 0
        ? 'nested-skill'
        : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      query_depth: queryDepth,
      ...(parentAgentId && {
        parent_agent_id:
          parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...wasDiscoveredField,
      ...(process.env.USER_TYPE === 'ant' && {
        skill_name:
          commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(command?.type === 'prompt' && {
          skill_source:
            command.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(command?.loadedFrom && {
          skill_loaded_from:
            command.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(command?.kind && {
          skill_kind:
            command.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      }),
      ...(command?.type === 'prompt' &&
        command.pluginInfo && {
          _PROTO_plugin_name: command.pluginInfo.pluginManifest
            .name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          ...(pluginMarketplace && {
            _PROTO_marketplace_name:
              pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          }),
          plugin_name: (isOfficialSkill
            ? command.pluginInfo.pluginManifest.name
            : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          plugin_repository: (isOfficialSkill
            ? command.pluginInfo.repository
            : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...buildPluginCommandTelemetryFields(command.pluginInfo),
        }),
    })

    // Get the tool use ID from the parent message for linking newMessages
    const toolUseID = getToolUseIDFromParentMessage(
      parentMessage,
      SKILL_TOOL_NAME,
    )

    // Tag user messages with sourceToolUseID so they stay transient until this tool resolves
    const newMessages = tagMessagesWithToolUseID(
      processedCommand.messages.filter(
        (m): m is UserMessage | AttachmentMessage | SystemMessage => {
          if (m.type === 'progress') {
            return false
          }
          // Filter out command-message since SkillTool handles display
          if (m.type === 'user' && 'message' in m) {
            const content = m.message.content
            if (
              typeof content === 'string' &&
              content.includes(`<${COMMAND_MESSAGE_TAG}>`)
            ) {
              return false
            }
          }
          return true
        },
      ),
      toolUseID,
    )
// newMessages 的组装：过滤掉 progress 消息和 command-message 包装（后者 SkillTool 自己负责展示），然后统一打上 sourceToolUseID——打了标的消息在工具调用结束前保持 transient，保证「技能展开出的这些消息」和「这次工具调用」在 UI 与持久化里绑在一起。

    logForDebugging(
      `SkillTool returning ${newMessages.length} newMessages for skill ${commandName}`,
    )

    // Note: addInvokedSkill and registerSkillHooks are called inside
    // processPromptSlashCommand (via getMessagesForPromptSlashCommand), so
    // calling them again here would double-register hooks and rebuild
    // skillContent redundantly.
// 英文注释预防了一个真实会犯的错：addInvokedSkill 和 registerSkillHooks 已经在 processPromptSlashCommand 内部调过了，这里再调就是双重注册 hook + 白白重建技能内容。跨模块副作用的归属要写清楚，不然下一个改代码的人准会补一遍。

    // Return success with newMessages and contextModifier
    return {
      data: {
        success: true,
        commandName,
        allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
        model,
      },
      newMessages,
      contextModifier(ctx) {
        let modifiedContext = ctx

        // Update allowed tools if specified
        if (allowedTools.length > 0) {
          // Capture the current getAppState to chain modifications properly
          const previousGetAppState = modifiedContext.getAppState
          modifiedContext = {
            ...modifiedContext,
            getAppState() {
              // Use the previous getAppState, not the closure's context.getAppState,
              // to properly chain context modifications
              const appState = previousGetAppState()
              return {
                ...appState,
                toolPermissionContext: {
                  ...appState.toolPermissionContext,
                  alwaysAllowRules: {
                    ...appState.toolPermissionContext.alwaysAllowRules,
                    command: [
                      ...new Set([
                        ...(appState.toolPermissionContext.alwaysAllowRules
                          .command || []),
                        ...allowedTools,
                      ]),
                    ],
                  },
                },
              }
            },
          }
        }
// contextModifier 里的 allowedTools 注入用 previousGetAppState 链式包装而不是直接引用 ctx.getAppState——英文注释点明原因：多个 contextModifier 会叠着改，每个都必须看到前一个的结果。直接闭包引用最外层会互相覆盖。

        // Carry [1m] suffix over — otherwise a skill with `model: opus` on an
        // opus[1m] session drops the effective window to 200K and trips autocompact.
        if (model) {
          modifiedContext = {
            ...modifiedContext,
            options: {
              ...modifiedContext.options,
              mainLoopModel: resolveSkillModelOverride(
                model,
                ctx.options.mainLoopModel,
              ),
            },
          }
        }
// 模型覆盖必须过 resolveSkillModelOverride 而不是直接赋值：技能声明 model: opus 时，要保留会话原有的 [1m] 长窗口后缀——否则 opus[1m] 会话跑了个 opus 技能，有效窗口从 1M 掉回 200K，autocompact 立刻误触发。

        // Override effort level if skill specifies one
        if (effort !== undefined) {
          const previousGetAppState = modifiedContext.getAppState
          modifiedContext = {
            ...modifiedContext,
            getAppState() {
              const appState = previousGetAppState()
              return {
                ...appState,
                effortValue: effort,
              }
            },
          }
        }

        return modifiedContext
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    result: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    // Handle forked skill result
    if ('status' in result && result.status === 'forked') {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `Skill "${result.commandName}" completed (forked execution).\n\nResult:\n${result.result}`,
      }
    }

    // Inline skill result (default)
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: `Launching skill: ${result.commandName}`,
    }
  },
// mapToolResult 的两个分支说清了内容通道：forked 把子代理结果全文放进 tool_result；inline 只回一句 Launching skill——技能展开的真正内容走 newMessages 通道进对话，tool_result 只是张回执。两种承载方式的分工与 FileReadTool 的 PDF 处理（tool_result 存元数据、document block 存正文）同一个思路。

  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
} satisfies ToolDef<InputSchema, Output, Progress>)

// Allowlist of PromptCommand property keys that are safe and don't require permission.
// If a skill has any property NOT in this set with a meaningful value, it requires
// permission. This ensures new properties added to PromptCommand in the future
// default to requiring permission until explicitly reviewed and added here.
// SAFE_SKILL_PROPERTIES 白名单本体：这 30 个属性都「无害」——声明了也不会改变权限边界。注意 context/agent/model/effort 都在清单里（它们只影响执行方式），而 allowed-tools 不在（它扩大权限，必须走确认）。
const SAFE_SKILL_PROPERTIES = new Set([
  // PromptCommand properties
  'type',
  'progressMessage',
  'contentLength',
  'argNames',
  'model',
  'effort',
  'source',
  'pluginInfo',
  'disableNonInteractive',
  'skillRoot',
  'context',
  'agent',
  'getPromptForCommand',
  'frontmatterKeys',
  // CommandBase properties
  'name',
  'description',
  'hasUserSpecifiedDescription',
  'isEnabled',
  'isHidden',
  'aliases',
  'isMcp',
  'argumentHint',
  'whenToUse',
  'paths',
  'version',
  'disableModelInvocation',
  'userInvocable',
  'loadedFrom',
  'immediate',
  'userFacingName',
])

function skillHasOnlySafeProperties(command: Command): boolean {
  for (const key of Object.keys(command)) {
    if (SAFE_SKILL_PROPERTIES.has(key)) {
      continue
    }
    // Property not in safe allowlist - check if it has a meaningful value
    const value = (command as Record<string, unknown>)[key]
    if (value === undefined || value === null) {
      continue
    }
    if (Array.isArray(value) && value.length === 0) {
      continue
    }
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue
    }
    return false
  }
  return true
}
// 「有意义值」的判据：undefined/null/空数组/空对象都不算——技能只在真的设置了越界属性时才需要确认。白名单检查的是「是否有实质内容」，不是「是否有这个键」。

function isOfficialMarketplaceSkill(command: PromptCommand): boolean {
  if (command.source !== 'plugin' || !command.pluginInfo?.repository) {
    return false
  }
  return isOfficialMarketplaceName(
    parsePluginIdentifier(command.pluginInfo.repository).marketplace,
  )
}

/**
 * Extract URL scheme for telemetry. Defaults to 'gs' for unrecognized schemes
 * since the AKI backend is the only production path and the loader throws on
 * unknown schemes before we reach telemetry anyway.
 */
function extractUrlScheme(url: string): 'gs' | 'http' | 'https' | 's3' {
  if (url.startsWith('gs://')) return 'gs'
  if (url.startsWith('https://')) return 'https'
  if (url.startsWith('http://')) return 'http'
  if (url.startsWith('s3://')) return 's3'
  return 'gs'
}

/**
 * Load a remote canonical skill and inject its SKILL.md content into the
 * conversation. Unlike local skills (which go through processPromptSlashCommand
 * for !command / $ARGUMENTS expansion), remote skills are declarative markdown
 * — we wrap the content directly in a user message.
 *
 * The skill is also registered with addInvokedSkill so it survives compaction
 * (same as local skills).
 *
 * Only called from within a feature('EXPERIMENTAL_SKILL_SEARCH') guard in
 * call() — remoteSkillModules is non-null here.
 */
async function executeRemoteSkill(
  slug: string,
  commandName: string,
  parentMessage: AssistantMessage,
  context: ToolUseContext,
): Promise<ToolResult<Output>> {
  const { getDiscoveredRemoteSkill, loadRemoteSkill, logRemoteSkillLoaded } =
    remoteSkillModules!
// executeRemoteSkill：远端技能从 AKI/GCS 加载 SKILL.md（带本地缓存）。validateInput 已确认 slug 在会话状态里，这里重取一次是为了拿 URL——状态若被清掉就明确报错而不是崩。远端技能是声明式 markdown，不需要本地技能的 !command 替换和 $ARGUMENTS 插值。

  // validateInput already confirmed this slug is in session state, but we
  // re-fetch here to get the URL. If it's somehow gone (e.g., state cleared
  // mid-session), fail with a clear error rather than crashing.
  const meta = getDiscoveredRemoteSkill(slug)
  if (!meta) {
    throw new Error(
      `Remote skill ${slug} was not discovered in this session. Use DiscoverSkills to find remote skills first.`,
    )
  }

  const urlScheme = extractUrlScheme(meta.url)
  let loadResult
  try {
    loadResult = await loadRemoteSkill(slug, meta.url)
  } catch (e) {
    const msg = errorMessage(e)
    logRemoteSkillLoaded({
      slug,
      cacheHit: false,
      latencyMs: 0,
      urlScheme,
      error: msg,
    })
    throw new Error(`Failed to load remote skill ${slug}: ${msg}`)
  }

  const {
    cacheHit,
    latencyMs,
    skillPath,
    content,
    fileCount,
    totalBytes,
    fetchMethod,
  } = loadResult

  logRemoteSkillLoaded({
    slug,
    cacheHit,
    latencyMs,
    urlScheme,
    fileCount,
    totalBytes,
    fetchMethod,
  })

  // Remote skills are always model-discovered (never in static skill_listing),
  // so was_discovered is always true. is_remote lets BQ queries separate
  // remote from local invocations without joining on skill name prefixes.
  const queryDepth = context.queryTracking?.depth ?? 0
  const parentAgentId = getAgentContext()?.agentId
  logEvent('tengu_skill_tool_invocation', {
    command_name:
      'remote_skill' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    // _PROTO_skill_name routes to the privileged skill_name BQ column
    // (unredacted, all users); command_name stays in additional_metadata as
    // the redacted variant.
    _PROTO_skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    execution_context:
      'remote' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: (queryDepth > 0
      ? 'nested-skill'
      : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    query_depth: queryDepth,
    ...(parentAgentId && {
      parent_agent_id:
        parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    was_discovered: true,
    is_remote: true,
    remote_cache_hit: cacheHit,
    remote_load_latency_ms: latencyMs,
    ...(process.env.USER_TYPE === 'ant' && {
      skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      remote_slug:
        slug as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })

  recordSkillUsage(commandName)

  logForDebugging(
    `SkillTool loaded remote skill ${slug} (cacheHit=${cacheHit}, ${latencyMs}ms, ${content.length} chars)`,
  )

  // Strip YAML frontmatter (---\nname: x\n---) before prepending the header
  // (matches loadSkillsDir.ts:333). parseFrontmatter returns the original
  // content unchanged if no frontmatter is present.
  const { content: bodyContent } = parseFrontmatter(content, skillPath)

  // Inject base directory header + ${CLAUDE_SKILL_DIR}/${CLAUDE_SESSION_ID}
  // substitution (matches loadSkillsDir.ts) so the model can resolve relative
  // refs like ./schemas/foo.json against the cache dir.
  const skillDir = dirname(skillPath)
  const normalizedDir =
    process.platform === 'win32' ? skillDir.replace(/\\/g, '/') : skillDir
  let finalContent = `Base directory for this skill: ${normalizedDir}\n\n${bodyContent}`
  finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, normalizedDir)
  finalContent = finalContent.replace(
    /\$\{CLAUDE_SESSION_ID\}/g,
    getSessionId(),
  )
// 内容后处理对齐本地技能：注入 Base directory 头（Windows 反斜杠归一成正斜杠）、替换 ${CLAUDE_SKILL_DIR} 和 ${CLAUDE_SESSION_ID}——注释说明这是为了对齐 loadSkillsDir 的行为，让技能里的相对引用 ./schemas/foo.json 能解析到缓存目录。

  // Register with compaction-preservation state. Use the cached file path so
  // post-compact restoration knows where the content came from. Must use
  // finalContent (not raw content) so the base directory header and
  // ${CLAUDE_SKILL_DIR} substitutions survive compaction — matches how local
  // skills store their already-transformed content via processSlashCommand.
  addInvokedSkill(
    commandName,
    skillPath,
    finalContent,
    getAgentContext()?.agentId ?? null,
  )
// 登记进 invokedSkills（压缩保留机制）时必须存 finalContent 而不是原始内容——注释强调：base directory 头和变量替换要在压缩后幸存，这与本地技能经 processSlashCommand 存「已转换内容」的做法对齐。存错一份，压缩恢复出来的技能就是残的。

  // Direct injection — wrap SKILL.md content in a meta user message. Matches
  // the shape of what processPromptSlashCommand produces for simple skills.
  const toolUseID = getToolUseIDFromParentMessage(
    parentMessage,
    SKILL_TOOL_NAME,
  )
  return {
    data: { success: true, commandName, status: 'inline' },
    newMessages: tagMessagesWithToolUseID(
      [createUserMessage({ content: finalContent, isMeta: true })],
      toolUseID,
    ),
  }
}
