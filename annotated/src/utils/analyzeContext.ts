import { feature } from 'bun:bundle'
import type { Anthropic } from '@anthropic-ai/sdk'
import {
  getSystemPrompt,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from 'src/constants/prompts.js'
import { microcompactMessages } from 'src/services/compact/microCompact.js'
import { getSdkBetas } from '../bootstrap/state.js'
import { getCommandName } from '../commands.js'
import { getSystemContext } from '../context.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
  MANUAL_COMPACT_BUFFER_TOKENS,
} from '../services/compact/autoCompact.js'
import {
  countMessagesTokensWithAPI,
  countTokensViaHaikuFallback,
  roughTokenCountEstimation,
} from '../services/tokenEstimation.js'
import { estimateSkillFrontmatterTokens } from '../skills/loadSkillsDir.js'
import {
  findToolByName,
  type Tool,
  type ToolPermissionContext,
  type Tools,
  type ToolUseContext,
  toolMatchesName,
} from '../Tool.js'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from '../tools/AgentTool/loadAgentsDir.js'
import { SKILL_TOOL_NAME } from '../tools/SkillTool/constants.js'
import {
  getLimitedSkillToolCommands,
  getSkillToolInfo as getSlashCommandInfo,
} from '../tools/SkillTool/prompt.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  NormalizedAssistantMessage,
  NormalizedUserMessage,
  UserMessage,
} from '../types/message.js'
import { toolToAPISchema } from './api.js'
import { filterInjectedMemoryFiles, getMemoryFiles } from './claudemd.js'
import { getContextWindowForModel } from './context.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { errorMessage, toError } from './errors.js'
import { logError } from './log.js'
import { normalizeMessagesForAPI } from './messages.js'
import { getRuntimeMainLoopModel } from './model/model.js'
import type { SettingSource } from './settings/constants.js'
import { jsonStringify } from './slowOperations.js'
import { buildEffectiveSystemPrompt } from './systemPrompt.js'
import type { Theme } from './theme.js'
import { getCurrentUsage } from './tokens.js'
// 文件总览：上下文用量分析器，也就是 `/context` 面板的全部数据来源。它把「窗口里到底装了什么」拆成七个可并行的计数器（系统提示、记忆文件、内置工具、MCP 工具、子代理、斜杠命令、消息体），各自调 token 计数 API，最后拼成分区列表 + 10×10 字符网格。三个贯穿全文件的主题：① token 计数既贵又不稳，所有计数器都走「API 优先、Haiku 兜底、失败返 null」三层；② 延迟工具（tool search）不算进真实占用，但要在界面里可见；③ 显示用的百分比有两套口径（估算 vs 上次 API 返回的真实用量），最终以真实为准。

const RESERVED_CATEGORY_NAME = 'Autocompact buffer'
const MANUAL_COMPACT_BUFFER_NAME = 'Compact buffer'

/**
 * Fixed token overhead added by the API when tools are present.
 * The API adds a tool prompt preamble (~500 tokens) once per API call when tools are present.
 * When we count tools individually via the token counting API, each call includes this overhead,
 * leading to N × overhead instead of 1 × overhead for N tools.
 * We subtract this overhead from per-tool counts to show accurate tool content sizes.
 */
export const TOOL_TOKEN_COUNT_OVERHEAD = 500
// TOOL_TOKEN_COUNT_OVERHEAD 定 500 并附了一整段解释：只要请求里带工具，API 就会加一段工具前言（约 500 token）。逐个工具计数时每次调用都带这段开销，N 个工具就多算 N 份；所以每个「单工具」计数都要减 500。这是本文件最容易被误读的常量——它不是工具本身的成本，而是**计数的系统性偏差**。

async function countTokensWithFallback(
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
  tools: Anthropic.Beta.Messages.BetaToolUnion[],
): Promise<number | null> {
  try {
    const result = await countMessagesTokensWithAPI(messages, tools)
    if (result !== null) {
      return result
    }
    logForDebugging(
      `countTokensWithFallback: API returned null, trying haiku fallback (${tools.length} tools)`,
    )
  } catch (err) {
    logForDebugging(`countTokensWithFallback: API failed: ${errorMessage(err)}`)
    logError(err)
  }

  try {
    const fallbackResult = await countTokensViaHaikuFallback(messages, tools)
    if (fallbackResult === null) {
      logForDebugging(
        `countTokensWithFallback: haiku fallback also returned null (${tools.length} tools)`,
      )
    }
    return fallbackResult
  } catch (err) {
    logForDebugging(
      `countTokensWithFallback: haiku fallback failed: ${errorMessage(err)}`,
    )
    logError(err)
    return null
  }
}
// countTokensWithFallback 是全局的计数闸门，三层结构：① 官方 count_tokens API；② 返回 null 或抛错时改用 Haiku 兜底；③ 兜底也失败就返回 null（让调用方各自决定降级策略）。每一层都记 debug 日志并带上工具数量——排查「面板数字为什么是 0」时，这几行日志是唯一线索。

interface ContextCategory {
  name: string
  tokens: number
  color: keyof Theme
  /** When true, these tokens are deferred and don't count toward context usage */
  isDeferred?: boolean
}
// ContextCategory 是分区模型。isDeferred 字段的含义写在注释里：**延迟的 token 不计入上下文占用**（它们没真发给模型），但仍要显示，否则用户会以为那些工具免费。

interface GridSquare {
  color: keyof Theme
  isFilled: boolean
  categoryName: string
  tokens: number
  percentage: number
  squareFullness: number // 0-1 representing how full this individual square is
}

interface MemoryFile {
  path: string
  type: string
  tokens: number
}

interface McpTool {
  name: string
  serverName: string
  tokens: number
  isLoaded?: boolean
}

export interface DeferredBuiltinTool {
  name: string
  tokens: number
  isLoaded: boolean
}

export interface SystemToolDetail {
  name: string
  tokens: number
}

export interface SystemPromptSectionDetail {
  name: string
  tokens: number
}

interface Agent {
  agentType: string
  source: SettingSource | 'built-in' | 'plugin'
  tokens: number
}

interface SlashCommandInfo {
  readonly totalCommands: number
  readonly includedCommands: number
  readonly tokens: number
}

/** Individual skill detail for context display */
interface SkillFrontmatter {
  name: string
  source: SettingSource | 'plugin'
  tokens: number
}

/**
 * Information about skills included in the context window.
 */
interface SkillInfo {
  /** Total number of available skills */
  readonly totalSkills: number
  /** Number of skills included within token budget */
  readonly includedSkills: number
  /** Total tokens consumed by skills */
  readonly tokens: number
  /** Individual skill details */
  readonly skillFrontmatter: SkillFrontmatter[]
}

export interface ContextData {
  readonly categories: ContextCategory[]
  readonly totalTokens: number
  readonly maxTokens: number
  readonly rawMaxTokens: number
  readonly percentage: number
  readonly gridRows: GridSquare[][]
  readonly model: string
  readonly memoryFiles: MemoryFile[]
  readonly mcpTools: McpTool[]
  /** Ant-only: per-tool breakdown of deferred built-in tools */
  readonly deferredBuiltinTools?: DeferredBuiltinTool[]
  /** Ant-only: per-tool breakdown of always-loaded built-in tools */
  readonly systemTools?: SystemToolDetail[]
  /** Ant-only: per-section breakdown of system prompt */
  readonly systemPromptSections?: SystemPromptSectionDetail[]
  readonly agents: Agent[]
  readonly slashCommands?: SlashCommandInfo
  /** Skill statistics */
  readonly skills?: SkillInfo
  readonly autoCompactThreshold?: number
  readonly isAutoCompactEnabled: boolean
  messageBreakdown?: {
    toolCallTokens: number
    toolResultTokens: number
    attachmentTokens: number
    assistantMessageTokens: number
    userMessageTokens: number
    toolCallsByType: Array<{
      name: string
      callTokens: number
      resultTokens: number
    }>
    attachmentsByType: Array<{ name: string; tokens: number }>
  }
  /** Actual token usage from last API response (if available) */
  readonly apiUsage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null
}
// ContextData 是对外契约，几个字段值得单独看：maxTokens 与 rawMaxTokens 现在同值（都等于上下文窗口），保留两个字段是历史分层的结果；gridRows 是**预计算好的字符网格**而非让渲染层自己算；以 [ANT-ONLY] 前缀标注的三个可选字段（systemTools / deferredBuiltinTools / systemPromptSections）只对内部用户返回；apiUsage 是上一次 API 响应里的真实计数，用于校准估算。

export async function countToolDefinitionTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
  model?: string,
): Promise<number> {
  const toolSchemas = await Promise.all(
    tools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext,
        tools,
        agents: agentInfo?.activeAgents ?? [],
        model,
      }),
    ),
  )
  const result = await countTokensWithFallback([], toolSchemas)
  if (result === null || result === 0) {
    const toolNames = tools.map(t => t.name).join(', ')
    logForDebugging(
      `countToolDefinitionTokens returned ${result} for ${tools.length} tools: ${toolNames.slice(0, 100)}${toolNames.length > 100 ? '...' : ''}`,
    )
  }
  return result ?? 0
}
// countToolDefinitionTokens 把整组工具转成 API schema 后**一次**计数——这是关键：逐个计再相减会累积 N 份 500 开销，一次计只偏差一份。结果为 0 或 null 时打一条带工具名的日志（截断 100 字符），因为「工具全都算成 0」通常意味着 schema 生成失败而不是真的没 token。

/** Extract a human-readable name from a system prompt section's content */
function extractSectionName(content: string): string {
  // Try to find first markdown heading
  const headingMatch = content.match(/^#+\s+(.+)$/m)
  if (headingMatch) {
    return headingMatch[1]!.trim()
  }
  // Fall back to a truncated preview of the first non-empty line
  const firstLine = content.split('\n').find(l => l.trim().length > 0) ?? ''
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine
}
// extractSectionName 给系统提示的每个片段起名字：优先取第一个 markdown 标题，没有就取第一行非空文本截断 40 字符。它服务的是内部用户的逐段明细，普通用户看不到，所以用启发式而非显式命名完全够用。

async function countSystemTokens(
  effectiveSystemPrompt: readonly string[],
): Promise<{
  systemPromptTokens: number
  systemPromptSections: SystemPromptSectionDetail[]
}> {
  // Get system context (gitStatus, etc.) which is always included
  const systemContext = await getSystemContext()

  // Build named entries: system prompt parts + system context values
  // Skip empty strings and the global-cache boundary marker
  const namedEntries: Array<{ name: string; content: string }> = [
    ...effectiveSystemPrompt
      .filter(
        content =>
          content.length > 0 && content !== SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      )
      .map(content => ({ name: extractSectionName(content), content })),
    ...Object.entries(systemContext)
      .filter(([, content]) => content.length > 0)
      .map(([name, content]) => ({ name, content })),
  ]

  if (namedEntries.length < 1) {
    return { systemPromptTokens: 0, systemPromptSections: [] }
  }

  const systemTokenCounts = await Promise.all(
    namedEntries.map(({ content }) =>
      countTokensWithFallback([{ role: 'user', content }], []),
    ),
  )

  const systemPromptSections: SystemPromptSectionDetail[] = namedEntries.map(
    (entry, i) => ({
      name: entry.name,
      tokens: systemTokenCounts[i] || 0,
    }),
  )

  const systemPromptTokens = systemTokenCounts.reduce(
    (sum: number, tokens) => sum + (tokens || 0),
    0,
  )

  return { systemPromptTokens, systemPromptSections }
}
// countSystemTokens 的口径值得注意：它把系统提示的各片段**与 systemContext 的每个值分别计数**，而不是整段计一次。这样能给出逐段明细，代价是 N 次 API 调用——只在 `/context` 这种低频交互路径上可接受。filter 里剔除空串与 SYSTEM_PROMPT_DYNAMIC_BOUNDARY：后者是缓存边界标记，本身没有内容。

async function countMemoryFileTokens(): Promise<{
  memoryFileDetails: MemoryFile[]
  claudeMdTokens: number
}> {
  // Simple mode disables CLAUDE.md loading, so don't report tokens for them
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return { memoryFileDetails: [], claudeMdTokens: 0 }
  }

  const memoryFilesData = filterInjectedMemoryFiles(await getMemoryFiles())
  const memoryFileDetails: MemoryFile[] = []
  let claudeMdTokens = 0

  if (memoryFilesData.length < 1) {
    return {
      memoryFileDetails: [],
      claudeMdTokens: 0,
    }
  }

  const claudeMdTokenCounts = await Promise.all(
    memoryFilesData.map(async file => {
      const tokens = await countTokensWithFallback(
        [{ role: 'user', content: file.content }],
        [],
      )

      return { file, tokens: tokens || 0 }
    }),
  )

  for (const { file, tokens } of claudeMdTokenCounts) {
    claudeMdTokens += tokens
    memoryFileDetails.push({
      path: file.path,
      type: file.type,
      tokens,
    })
  }

  return { claudeMdTokens, memoryFileDetails }
}
// countMemoryFileTokens 有两个前提判断：① CLAUDE_CODE_SIMPLE 模式压根不加载 CLAUDE.md，所以直接返 0（否则面板会显示一个不存在的开销）；② 用 filterInjectedMemoryFiles 过滤——tengu_moth_copse 开启后 MEMORY.md 索引不再注入系统提示，不能算进占用。

async function countBuiltInToolTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
  model?: string,
  messages?: Message[],
): Promise<{
  builtInToolTokens: number
  deferredBuiltinDetails: DeferredBuiltinTool[]
  deferredBuiltinTokens: number
  systemToolDetails: SystemToolDetail[]
}> {
  const builtInTools = tools.filter(tool => !tool.isMcp)
  if (builtInTools.length < 1) {
    return {
      builtInToolTokens: 0,
      deferredBuiltinDetails: [],
      deferredBuiltinTokens: 0,
      systemToolDetails: [],
    }
  }

  // Check if tool search is enabled
  const { isToolSearchEnabled } = await import('./toolSearch.js')
  const { isDeferredTool } = await import('../tools/ToolSearchTool/prompt.js')
  const isDeferred = await isToolSearchEnabled(
    model ?? '',
    tools,
    getToolPermissionContext,
    agentInfo?.activeAgents ?? [],
    'analyzeBuiltIn',
  )

  // Separate always-loaded and deferred builtin tools using dynamic isDeferredTool check
  const alwaysLoadedTools = builtInTools.filter(t => !isDeferredTool(t))
  const deferredBuiltinTools = builtInTools.filter(t => isDeferredTool(t))

  // Count always-loaded tools
  const alwaysLoadedTokens =
    alwaysLoadedTools.length > 0
      ? await countToolDefinitionTokens(
          alwaysLoadedTools,
          getToolPermissionContext,
          agentInfo,
          model,
        )
      : 0

  // Build per-tool breakdown for always-loaded tools (ant-only, proportional
  // split of the bulk count based on rough schema size estimation). Excludes
  // SkillTool since its tokens are shown in the separate Skills category.
  let systemToolDetails: SystemToolDetail[] = []
  if (process.env.USER_TYPE === 'ant') {
    const toolsForBreakdown = alwaysLoadedTools.filter(
      t => !toolMatchesName(t, SKILL_TOOL_NAME),
    )
    if (toolsForBreakdown.length > 0) {
      const estimates = toolsForBreakdown.map(t =>
        roughTokenCountEstimation(jsonStringify(t.inputSchema ?? {})),
      )
      const estimateTotal = estimates.reduce((s, e) => s + e, 0) || 1
      const distributable = Math.max(
        0,
        alwaysLoadedTokens - TOOL_TOKEN_COUNT_OVERHEAD,
      )
      systemToolDetails = toolsForBreakdown
        .map((t, i) => ({
          name: t.name,
          tokens: Math.round((estimates[i]! / estimateTotal) * distributable),
        }))
        .sort((a, b) => b.tokens - a.tokens)
    }
  }

  // Count deferred builtin tools individually for details
  const deferredBuiltinDetails: DeferredBuiltinTool[] = []
  let loadedDeferredTokens = 0
  let totalDeferredTokens = 0

  if (deferredBuiltinTools.length > 0 && isDeferred) {
    // Find which deferred tools have been used in messages
    const loadedToolNames = new Set<string>()
    if (messages) {
      const deferredToolNameSet = new Set(deferredBuiltinTools.map(t => t.name))
      for (const msg of messages) {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (
              'type' in block &&
              block.type === 'tool_use' &&
              'name' in block &&
              typeof block.name === 'string' &&
              deferredToolNameSet.has(block.name)
            ) {
              loadedToolNames.add(block.name)
            }
          }
        }
      }
    }

    // Count each deferred tool
    const tokensByTool = await Promise.all(
      deferredBuiltinTools.map(t =>
        countToolDefinitionTokens(
          [t],
          getToolPermissionContext,
          agentInfo,
          model,
        ),
      ),
    )

    for (const [i, tool] of deferredBuiltinTools.entries()) {
      const tokens = Math.max(
        0,
        (tokensByTool[i] || 0) - TOOL_TOKEN_COUNT_OVERHEAD,
      )
      const isLoaded = loadedToolNames.has(tool.name)
      deferredBuiltinDetails.push({
        name: tool.name,
        tokens,
        isLoaded,
      })
      totalDeferredTokens += tokens
      if (isLoaded) {
        loadedDeferredTokens += tokens
      }
    }
  } else if (deferredBuiltinTools.length > 0) {
    // Tool search not enabled - count deferred tools as regular
    const deferredTokens = await countToolDefinitionTokens(
      deferredBuiltinTools,
      getToolPermissionContext,
      agentInfo,
      model,
    )
    return {
      builtInToolTokens: alwaysLoadedTokens + deferredTokens,
      deferredBuiltinDetails: [],
      deferredBuiltinTokens: 0,
      systemToolDetails,
    }
  }

  return {
    // When deferred, only count always-loaded tools + any loaded deferred tools
    builtInToolTokens: alwaysLoadedTokens + loadedDeferredTokens,
    deferredBuiltinDetails,
    deferredBuiltinTokens: totalDeferredTokens - loadedDeferredTokens,
    systemToolDetails,
  }
}
// countBuiltInToolTokens 是文件里最绕的一段，核心是「延迟工具」的记账规则。三条路径：① tool search 开启时，常驻工具整批计数，延迟工具逐个计数并判断「是否被用过」（扫消息里的 tool_use），用过的算实际占用、没用过的进 deferredBuiltinTokens 只做展示；② tool search 未开启时，延迟工具当普通工具整批加进总量；③ 内部用户的逐工具明细用**比例分摊**（按各工具 schema 的粗估字数占比）把整批数字拆开，并先减掉那 500 开销。排除 SkillTool 是因为它已单列为 Skills 分区，重复列入会双计。

function findSkillTool(tools: Tools): Tool | undefined {
  return findToolByName(tools, SKILL_TOOL_NAME)
}
// findSkillTool 单独抽出来的原因很实际：斜杠命令与技能都挂在同一个 SkillTool 上，需要多处查询同一个工具，包装一层比在每处写 findToolByName 更清楚。

async function countSlashCommandTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
): Promise<{
  slashCommandTokens: number
  commandInfo: { totalCommands: number; includedCommands: number }
}> {
  const info = await getSlashCommandInfo(getCwd())

  const slashCommandTool = findSkillTool(tools)
  if (!slashCommandTool) {
    return {
      slashCommandTokens: 0,
      commandInfo: { totalCommands: 0, includedCommands: 0 },
    }
  }

  const slashCommandTokens = await countToolDefinitionTokens(
    [slashCommandTool],
    getToolPermissionContext,
    agentInfo,
  )

  return {
    slashCommandTokens,
    commandInfo: {
      totalCommands: info.totalCommands,
      includedCommands: info.includedCommands,
    },
  }
}
// countSlashCommandTokens 计的是 SkillTool 的 schema 成本，并顺带返回「总命令数 / 实际包含数」——后者说明命令列表受 token 预算限制，并非全部展开。注意它与 countSkillTokens 计的是**同一个工具**，两处都返回值但只有一处进分区（见后面 skillFrontmatterTokens 的注释）。

async function countSkillTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
): Promise<{
  skillTokens: number
  skillInfo: {
    totalSkills: number
    includedSkills: number
    skillFrontmatter: SkillFrontmatter[]
  }
}> {
  try {
    const skills = await getLimitedSkillToolCommands(getCwd())

    const slashCommandTool = findSkillTool(tools)
    if (!slashCommandTool) {
      return {
        skillTokens: 0,
        skillInfo: { totalSkills: 0, includedSkills: 0, skillFrontmatter: [] },
      }
    }

    // NOTE: This counts the entire SlashCommandTool (which includes both commands AND skills).
    // This is the same tool counted by countSlashCommandTokens(), but we track it separately
    // here for display purposes. These tokens should NOT be added to context categories
    // to avoid double-counting.
    const skillTokens = await countToolDefinitionTokens(
      [slashCommandTool],
      getToolPermissionContext,
      agentInfo,
    )

    // Calculate per-skill token estimates based on frontmatter only
    // (name, description, whenToUse) since full content is only loaded on invocation
    const skillFrontmatter: SkillFrontmatter[] = skills.map(skill => ({
      name: getCommandName(skill),
      source: (skill.type === 'prompt' ? skill.source : 'plugin') as
        | SettingSource
        | 'plugin',
      tokens: estimateSkillFrontmatterTokens(skill),
    }))

    return {
      skillTokens,
      skillInfo: {
        totalSkills: skills.length,
        includedSkills: skills.length,
        skillFrontmatter,
      },
    }
  } catch (error) {
    logError(toError(error))

    // Return zero values rather than failing the entire context analysis
    return {
      skillTokens: 0,
      skillInfo: { totalSkills: 0, includedSkills: 0, skillFrontmatter: [] },
    }
  }
}
// countSkillTokens 用 try/catch 把整个技能统计包住，注释说明了理由：技能目录的扫描可能因环境问题失败（权限、坏 frontmatter），而这是**关键路径之外的附加信息**，不能让它把整个上下文分析带崩。失败时返回全零而不是抛错，面板显示「无技能」总好过整个 /context 打不开。另外这里逐技能算的是**仅 frontmatter**（名字、描述、whenToUse）的估算，因为完整内容只在调用时才加载。

export async function countMcpToolTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
  model: string,
  messages?: Message[],
): Promise<{
  mcpToolTokens: number
  mcpToolDetails: McpTool[]
  deferredToolTokens: number
  loadedMcpToolNames: Set<string>
}> {
  const mcpTools = tools.filter(tool => tool.isMcp)
  const mcpToolDetails: McpTool[] = []
  // Single bulk API call for all MCP tools (instead of N individual calls)
  const totalTokensRaw = await countToolDefinitionTokens(
    mcpTools,
    getToolPermissionContext,
    agentInfo,
    model,
  )
  // Subtract the single overhead since we made one bulk call
  const totalTokens = Math.max(
    0,
    (totalTokensRaw || 0) - TOOL_TOKEN_COUNT_OVERHEAD,
  )

  // Estimate per-tool proportions for display using local estimation.
  // Include name + description + input schema to match what toolToAPISchema
  // sends — otherwise tools with similar schemas but different descriptions
  // get identical counts (MCP tools share the same base Zod inputSchema).
  const estimates = await Promise.all(
    mcpTools.map(async t =>
      roughTokenCountEstimation(
        jsonStringify({
          name: t.name,
          description: await t.prompt({
            getToolPermissionContext,
            tools,
            agents: agentInfo?.activeAgents ?? [],
          }),
          input_schema: t.inputJSONSchema ?? {},
        }),
      ),
    ),
  )
  const estimateTotal = estimates.reduce((s, e) => s + e, 0) || 1
  const mcpToolTokensByTool = estimates.map(e =>
    Math.round((e / estimateTotal) * totalTokens),
  )

  // Check if tool search is enabled - if so, MCP tools are deferred
  // isToolSearchEnabled handles threshold calculation internally for TstAuto mode
  const { isToolSearchEnabled } = await import('./toolSearch.js')
  const { isDeferredTool } = await import('../tools/ToolSearchTool/prompt.js')

  const isDeferred = await isToolSearchEnabled(
    model,
    tools,
    getToolPermissionContext,
    agentInfo?.activeAgents ?? [],
    'analyzeMcp',
  )

  // Find MCP tools that have been used in messages (loaded via ToolSearchTool)
  const loadedMcpToolNames = new Set<string>()
  if (isDeferred && messages) {
    const mcpToolNameSet = new Set(mcpTools.map(t => t.name))
    for (const msg of messages) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (
            'type' in block &&
            block.type === 'tool_use' &&
            'name' in block &&
            typeof block.name === 'string' &&
            mcpToolNameSet.has(block.name)
          ) {
            loadedMcpToolNames.add(block.name)
          }
        }
      }
    }
  }

  // Build tool details with isLoaded flag
  for (const [i, tool] of mcpTools.entries()) {
    mcpToolDetails.push({
      name: tool.name,
      serverName: tool.name.split('__')[1] || 'unknown',
      tokens: mcpToolTokensByTool[i]!,
      isLoaded: loadedMcpToolNames.has(tool.name) || !isDeferredTool(tool),
    })
  }

  // Calculate loaded vs deferred tokens
  let loadedTokens = 0
  let deferredTokens = 0
  for (const detail of mcpToolDetails) {
    if (detail.isLoaded) {
      loadedTokens += detail.tokens
    } else if (isDeferred) {
      deferredTokens += detail.tokens
    }
  }

  return {
    // When deferred but some tools are loaded, count loaded tokens
    mcpToolTokens: isDeferred ? loadedTokens : totalTokens,
    mcpToolDetails,
    // Track deferred tokens separately for display
    deferredToolTokens: deferredTokens,
    loadedMcpToolNames,
  }
}
// countMcpToolTokens 与内置工具版本结构相似但有两处不同：① MCP 工具**一次批量计数**再按比例分摊——因为 MCP 工具共享同一个基础 Zod 输入 schema，只按 schema 估会全部相同，所以比例估算里特意拼上 name、description、input_schema 三项以匹配真实发送内容；② serverName 从工具名的双下划线分段里取（mcp__server__tool），取不到就记 unknown。isLoaded 的判定是「用过 或 本来就不是延迟工具」。

async function countCustomAgentTokens(agentDefinitions: {
  activeAgents: AgentDefinition[]
}): Promise<{
  agentTokens: number
  agentDetails: Agent[]
}> {
  const customAgents = agentDefinitions.activeAgents.filter(
    a => a.source !== 'built-in',
  )
  const agentDetails: Agent[] = []
  let agentTokens = 0

  const tokenCounts = await Promise.all(
    customAgents.map(agent =>
      countTokensWithFallback(
        [
          {
            role: 'user',
            content: [agent.agentType, agent.whenToUse].join(' '),
          },
        ],
        [],
      ),
    ),
  )

  for (const [i, agent] of customAgents.entries()) {
    const tokens = tokenCounts[i] || 0
    agentTokens += tokens || 0
    agentDetails.push({
      agentType: agent.agentType,
      source: agent.source,
      tokens: tokens || 0,
    })
  }
  return { agentTokens, agentDetails }
}
// countCustomAgentTokens 只算子代理的 agentType 与 whenToUse 两个字符串——因为注入系统提示的正是这两段（不是整个 agent 定义）。排除 built-in 是刻意的：内置代理的类型名与描述来自代码而不是用户配置，不算用户的上下文成本。

type MessageBreakdown = {
  totalTokens: number
  toolCallTokens: number
  toolResultTokens: number
  attachmentTokens: number
  assistantMessageTokens: number
  userMessageTokens: number
  toolCallsByType: Map<string, number>
  toolResultsByType: Map<string, number>
  attachmentsByType: Map<string, number>
}
// MessageBreakdown 是消息体的分项统计，用三个 Map 按类型聚合（工具调用、工具结果、附件）。用 Map 而不是对象是因为类型名是用户数据（MCP 工具名可能含任意字符），当键不安全。

function processAssistantMessage(
  msg: AssistantMessage | NormalizedAssistantMessage,
  breakdown: MessageBreakdown,
): void {
  // Process each content block individually
  for (const block of msg.message.content) {
    const blockStr = jsonStringify(block)
    const blockTokens = roughTokenCountEstimation(blockStr)

    if ('type' in block && block.type === 'tool_use') {
      breakdown.toolCallTokens += blockTokens
      const toolName = ('name' in block ? block.name : undefined) || 'unknown'
      breakdown.toolCallsByType.set(
        toolName,
        (breakdown.toolCallsByType.get(toolName) || 0) + blockTokens,
      )
    } else {
      // Text blocks or other non-tool content
      breakdown.assistantMessageTokens += blockTokens
    }
  }
}
// processAssistantMessage 对每个 content block 单独 jsonStringify 后粗估 token。按块而不是整条消息，是因为一条 assistant 消息可能同时含文本与多个工具调用，混在一起就分不出「说话」与「调工具」各花多少。工具调用额外按工具名累加，供后面的「最贵工具」排序。

function processUserMessage(
  msg: UserMessage | NormalizedUserMessage,
  breakdown: MessageBreakdown,
  toolUseIdToName: Map<string, string>,
): void {
  // Handle both string and array content
  if (typeof msg.message.content === 'string') {
    // Simple string content
    const tokens = roughTokenCountEstimation(msg.message.content)
    breakdown.userMessageTokens += tokens
    return
  }

  // Process each content block individually
  for (const block of msg.message.content) {
    const blockStr = jsonStringify(block)
    const blockTokens = roughTokenCountEstimation(blockStr)

    if ('type' in block && block.type === 'tool_result') {
      breakdown.toolResultTokens += blockTokens
      const toolUseId = 'tool_use_id' in block ? block.tool_use_id : undefined
      const toolName =
        (toolUseId ? toolUseIdToName.get(toolUseId) : undefined) || 'unknown'
      breakdown.toolResultsByType.set(
        toolName,
        (breakdown.toolResultsByType.get(toolName) || 0) + blockTokens,
      )
    } else {
      // Text blocks or other non-tool content
      breakdown.userMessageTokens += blockTokens
    }
  }
}
// processUserMessage 要处理两种形态：字符串内容（普通提示）与数组内容（含 tool_result 块）。tool_result 的成本归到**工具名下**而不是用户消息，靠 toolUseIdToName 反查——这个映射必须先在 assistant 消息上建好，映射不到就记 unknown。这是「按工具算总账」的关键一步：结果 tokens 往往是大头。

function processAttachment(
  msg: AttachmentMessage,
  breakdown: MessageBreakdown,
): void {
  const contentStr = jsonStringify(msg.attachment)
  const tokens = roughTokenCountEstimation(contentStr)
  breakdown.attachmentTokens += tokens
  const attachType = msg.attachment.type || 'unknown'
  breakdown.attachmentsByType.set(
    attachType,
    (breakdown.attachmentsByType.get(attachType) || 0) + tokens,
  )
}
// processAttachment 把整个 attachment 对象序列化后粗估。attachmentsByType 的键取 attachment.type，缺省为 unknown——附件类型很多（几十种），面板只展示前几名。

async function approximateMessageTokens(
  messages: Message[],
): Promise<MessageBreakdown> {
  const microcompactResult = await microcompactMessages(messages)

  // Initialize tracking
  const breakdown: MessageBreakdown = {
    totalTokens: 0,
    toolCallTokens: 0,
    toolResultTokens: 0,
    attachmentTokens: 0,
    assistantMessageTokens: 0,
    userMessageTokens: 0,
    toolCallsByType: new Map<string, number>(),
    toolResultsByType: new Map<string, number>(),
    attachmentsByType: new Map<string, number>(),
  }

  // Build a map of tool_use_id to tool_name for easier lookup
  const toolUseIdToName = new Map<string, string>()
  for (const msg of microcompactResult.messages) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if ('type' in block && block.type === 'tool_use') {
          const toolUseId = 'id' in block ? block.id : undefined
          const toolName =
            ('name' in block ? block.name : undefined) || 'unknown'
          if (toolUseId) {
            toolUseIdToName.set(toolUseId, toolName)
          }
        }
      }
    }
  }

  // Process each message for detailed breakdown
  for (const msg of microcompactResult.messages) {
    if (msg.type === 'assistant') {
      processAssistantMessage(msg, breakdown)
    } else if (msg.type === 'user') {
      processUserMessage(msg, breakdown, toolUseIdToName)
    } else if (msg.type === 'attachment') {
      processAttachment(msg, breakdown)
    }
  }

  // Calculate total tokens using the API for accuracy
  const approximateMessageTokens = await countTokensWithFallback(
    normalizeMessagesForAPI(microcompactResult.messages).map(_ => {
      if (_.type === 'assistant') {
        return {
          // Important: strip out fields like id, etc. -- the counting API errors if they're present
          role: 'assistant',
          content: _.message.content,
        }
      }
      return _.message
    }),
    [],
  )

  breakdown.totalTokens = approximateMessageTokens ?? 0
  return breakdown
}
// approximateMessageTokens 有三个关键决定：① 先跑 microcompactMessages 再统计，因为微压缩会把老的工具结果替换成占位符，统计必须反映**实际会发送的形态**，否则面板数字比实际偏大；② 总量交给 API 精确计，但发给计数 API 前要剥掉 assistant 消息的 id 等字段——注释写明计数 API 遇到这些字段会报错；③ 分项之和不必等于总量（分项是粗估），面板上两者并存不矛盾。

export async function analyzeContextUsage(
  messages: Message[],
  model: string,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  tools: Tools,
  agentDefinitions: AgentDefinitionsResult,
  terminalWidth?: number,
  toolUseContext?: Pick<ToolUseContext, 'options'>,
  mainThreadAgentDefinition?: AgentDefinition,
  /** Original messages before microcompact, used to extract API usage */
  originalMessages?: Message[],
): Promise<ContextData> {
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode: (await getToolPermissionContext()).mode,
    mainLoopModel: model,
  })
  // Get context window size
  const contextWindow = getContextWindowForModel(runtimeModel, getSdkBetas())

  // Build the effective system prompt using the shared utility
  const defaultSystemPrompt = await getSystemPrompt(tools, runtimeModel)
  const effectiveSystemPrompt = buildEffectiveSystemPrompt({
    mainThreadAgentDefinition,
    toolUseContext: toolUseContext ?? {
      options: {} as ToolUseContext['options'],
    },
    customSystemPrompt: toolUseContext?.options.customSystemPrompt,
    defaultSystemPrompt,
    appendSystemPrompt: toolUseContext?.options.appendSystemPrompt,
  })

  // Critical operations that should not fail due to skills
  const [
    { systemPromptTokens, systemPromptSections },
    { claudeMdTokens, memoryFileDetails },
    {
      builtInToolTokens,
      deferredBuiltinDetails,
      deferredBuiltinTokens,
      systemToolDetails,
    },
    { mcpToolTokens, mcpToolDetails, deferredToolTokens },
    { agentTokens, agentDetails },
    { slashCommandTokens, commandInfo },
    messageBreakdown,
  ] = await Promise.all([
    countSystemTokens(effectiveSystemPrompt),
    countMemoryFileTokens(),
    countBuiltInToolTokens(
      tools,
      getToolPermissionContext,
      agentDefinitions,
      runtimeModel,
      messages,
    ),
    countMcpToolTokens(
      tools,
      getToolPermissionContext,
      agentDefinitions,
      runtimeModel,
      messages,
    ),
    countCustomAgentTokens(agentDefinitions),
    countSlashCommandTokens(tools, getToolPermissionContext, agentDefinitions),
    approximateMessageTokens(messages),
  ])
// 这七个计数器全部并行（Promise.all），因为每个都可能要发一次或多次网络请求，串行会让 /context 打开慢上好几秒。需要注意它们的失败语义不同：前六个内部各自兜底返 0，approximateMessageTokens 里的计数失败会返 null 再被 ?? 0 收掉。

  // Count skills separately with error isolation
  const skillResult = await countSkillTokens(
    tools,
    getToolPermissionContext,
    agentDefinitions,
  )
  const skillInfo = skillResult.skillInfo
  // Use sum of individual skill token estimates (matches what's shown in details)
  // rather than skillResult.skillTokens which includes tool schema overhead
  const skillFrontmatterTokens = skillInfo.skillFrontmatter.reduce(
    (sum, skill) => sum + skill.tokens,
    0,
  )
// 这里有一段容易看漏的取舍：Skills 分区用的是**逐技能 frontmatter 估算之和**，而不是 countSkillTokens 返回的 skillTokens（后者含整个工具的 schema 开销）。注释写明了原因——要让分区数字与明细列表能对上。而 schema 开销已经在 System tools 里算过了，不重复计。同理下面算 System tools 时用的是 builtInToolTokens 减 skillFrontmatterTokens。

  const messageTokens = messageBreakdown.totalTokens

  // Check if autocompact is enabled and calculate threshold
  const isAutoCompact = isAutoCompactEnabled()
  const autoCompactThreshold = isAutoCompact
    ? getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER_TOKENS
    : undefined
// 自动压缩阈值 = 有效窗口 − 保留缓冲。注意它用的是 getEffectiveContextWindowSize(model)（原始入参 model）而不是 runtimeModel——这一处不一致是老代码留下的，实际影响是子代理模型下的阈值可能按主模型窗口算。

  // Create categories
  const cats: ContextCategory[] = []

  // System prompt is always shown first (fixed overhead)
  if (systemPromptTokens > 0) {
    cats.push({
      name: 'System prompt',
      tokens: systemPromptTokens,
      color: 'promptBorder',
    })
  }
// 分区顺序是按「用户能理解的心理模型」排的：系统提示（固定开销）→ 系统工具 → MCP 工具 → 延迟项 → 自定义代理 → 记忆文件 → 技能 → 消息。每个分区都只在 tokens > 0 时才 push，避免面板上出现一堆 0 值行。颜色字段用的是主题键名而不是色值，渲染层负责映射。

  // Built-in tools right after system prompt (skills shown separately below)
  // Ant users get a per-tool breakdown via systemToolDetails
  const systemToolsTokens = builtInToolTokens - skillFrontmatterTokens
  if (systemToolsTokens > 0) {
    cats.push({
      name:
        process.env.USER_TYPE === 'ant'
          ? '[ANT-ONLY] System tools'
          : 'System tools',
      tokens: systemToolsTokens,
      color: 'inactive',
    })
  }
// System tools 分值对内部用户显示为 [ANT-ONLY] System tools——名字里带前缀是刻意的：它提示这个数字来自比例分摊的估算而非精确值。

  // MCP tools after system tools
  if (mcpToolTokens > 0) {
    cats.push({
      name: 'MCP tools',
      tokens: mcpToolTokens,
      color: 'cyan_FOR_SUBAGENTS_ONLY',
    })
  }
// MCP tools 分区。颜色键名里带 FOR_SUBAGENTS_ONLY 后缀，是主题系统的一个历史遗留命名，与语义无关。

  // Show deferred MCP tools (when tool search is enabled)
  // These don't count toward context usage but we show them for visibility
  if (deferredToolTokens > 0) {
    cats.push({
      name: 'MCP tools (deferred)',
      tokens: deferredToolTokens,
      color: 'inactive',
      isDeferred: true,
    })
  }
// 延迟 MCP 工具单独成一个分区并带 isDeferred: true：**显示但不计入占用**。这是整个面板最重要的一条语义——tool search 开启后 MCP 工具默认不加载，如果把它们算进占用，用户会看到窗口莫名满了。

  // Show deferred builtin tools (when tool search is enabled)
  if (deferredBuiltinTokens > 0) {
    cats.push({
      name: 'System tools (deferred)',
      tokens: deferredBuiltinTokens,
      color: 'inactive',
      isDeferred: true,
    })
  }
// 延迟内置工具同理。两个延迟分区都排在一起，让用户一眼看到「这些还没花我的窗口」。

  // Custom agents after MCP tools
  if (agentTokens > 0) {
    cats.push({
      name: 'Custom agents',
      tokens: agentTokens,
      color: 'permission',
    })
  }
// Custom agents 只统计非内置代理的类型与触发描述。

  // Memory files after custom agents
  if (claudeMdTokens > 0) {
    cats.push({
      name: 'Memory files',
      tokens: claudeMdTokens,
      color: 'claude',
    })
  }
// Memory files：所有 CLAUDE.md 类文件的 token 之和。明细在 memoryFiles 字段里，面板可以展开看每个文件花了多少——这个数字通常是用户唯一能主动优化的部分。

  // Skills after memory files
  if (skillFrontmatterTokens > 0) {
    cats.push({
      name: 'Skills',
      tokens: skillFrontmatterTokens,
      color: 'warning',
    })
  }
// Skills 分区放的是逐技能 frontmatter 估算之和（见上面 997 处的取舍说明）。

  if (messageTokens !== null && messageTokens > 0) {
    cats.push({
      name: 'Messages',
      tokens: messageTokens,
      color: 'purple_FOR_SUBAGENTS_ONLY',
    })
  }
// Messages 是消息体总量，来自 API 精确计数（微压缩后）。

  // Calculate actual content usage (before adding reserved buffers)
  // Exclude deferred categories from the usage calculation
  const actualUsage = cats.reduce(
    (sum, cat) => sum + (cat.isDeferred ? 0 : cat.tokens),
    0,
  )
// actualUsage 求和时**跳过 isDeferred 分区**，这是延迟语义的落点。注意它把保留缓冲也算在内（缓冲已在 cats 里），所以这个值不是「纯内容占用」而是「内容 + 预留」。

  // Reserved space after messages (not counted in actualUsage shown to user).
  // Under reactive-only mode (cobalt_raccoon), proactive autocompact never
  // fires and the reserved buffer is a lie — skip it entirely and let Free
  // space fill the grid. feature() guard keeps the flag string out of
  // external builds. Same for context-collapse (marble_origami) — collapse
  // owns the threshold ladder and autocompact is suppressed in
  // shouldAutoCompact, so the 33k buffer shown here would be a lie too.
  let reservedTokens = 0
  let skipReservedBuffer = false
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      skipReservedBuffer = true
    }
  }
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../services/contextCollapse/index.js') as typeof import('../services/contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      skipReservedBuffer = true
    }
  }
// 这段注释解释了一个反直觉的处理：在某些模式下**故意不显示保留缓冲**。原因是这些模式下前摄性自动压缩根本不会触发（reactive-only 的 cobalt_raccoon 只在需要时被动压缩；context-collapse 自己接管阈值阶梯并在 shouldAutoCompact 里抑制自动压缩），此时界面上画一个 33k 的缓冲条就是在撒谎。用 feature() 守卫是为了把内部开关名从外部构建里剔掉。
  if (skipReservedBuffer) {
    // No buffer category pushed — reactive compaction is transparent and
    // doesn't need a visible reservation in the grid.
  } else if (isAutoCompact && autoCompactThreshold !== undefined) {
    // Autocompact buffer (from effective context)
    reservedTokens = contextWindow - autoCompactThreshold
    cats.push({
      name: RESERVED_CATEGORY_NAME,
      tokens: reservedTokens,
      color: 'inactive',
    })
  } else if (!isAutoCompact) {
    // Compact buffer reserve (3k from actual context limit)
    reservedTokens = MANUAL_COMPACT_BUFFER_TOKENS
    cats.push({
      name: MANUAL_COMPACT_BUFFER_NAME,
      tokens: reservedTokens,
      color: 'inactive',
    })
  }
// 缓冲的三分支：跳过（上一条讲的模式）→ 自动压缩开启时取「窗口 − 阈值」→ 未开启时用固定的手压缩缓冲（3k）。三个分支都会把缓冲作为一个分区 push 进去，因此它会参与 actualUsage 求和但不计入 totalIncludingReserved（那个值在缓冲之前就算好了）。

  // Calculate free space (subtract both actual usage and reserved buffer)
  const freeTokens = Math.max(0, contextWindow - actualUsage - reservedTokens)
// 剩余空间 = max(0, 窗口 − 实际占用 − 保留缓冲)，并作为最后一个分区（Free space）push——网格渲染时它负责填空。用 max(0, ...) 是因为估算可能超窗口，负数画不出格子。

  cats.push({
    name: 'Free space',
    tokens: freeTokens,
    color: 'promptBorder',
  })

  // Total for display (everything except free space)
  const totalIncludingReserved = actualUsage

  // Extract API usage from original messages (if provided) to match status line
  // This uses the same source of truth as the status line for consistency
  const apiUsage = getCurrentUsage(originalMessages ?? messages)

  // When API usage is available, use it for total to match status line calculation
  // Status line uses: input_tokens + cache_creation_input_tokens + cache_read_input_tokens
  const totalFromAPI = apiUsage
    ? apiUsage.input_tokens +
      apiUsage.cache_creation_input_tokens +
      apiUsage.cache_read_input_tokens
    : null
// totalFromAPI 把三项相加：input_tokens + cache_creation_input_tokens + cache_read_input_tokens。这与状态栏用的是同一个口径，注释专门强调「与状态栏一致」——两个界面显示不同数字是用户最常报的 bug 之一。

  // Use API total if available, otherwise fall back to estimated total
  const finalTotalTokens = totalFromAPI ?? totalIncludingReserved
// 最终总量优先用 API 真实值，没有才回落到估算。这个优先级很重要：估算在微压缩与缓存场景下会系统性偏离，而 API 返回的是真实账单。

  // Pre-calculate grid based on model context window and terminal width
  // For narrow screens (< 80 cols), use 5x5 for 200k models, 5x10 for 1M+ models
  // For normal screens, use 10x10 for 200k models, 20x10 for 1M+ models
  const isNarrowScreen = terminalWidth && terminalWidth < 80
  const GRID_WIDTH =
    contextWindow >= 1000000
      ? isNarrowScreen
        ? 5
        : 20
      : isNarrowScreen
        ? 5
        : 10
  const GRID_HEIGHT = contextWindow >= 1000000 ? 10 : isNarrowScreen ? 5 : 10
  const TOTAL_SQUARES = GRID_WIDTH * GRID_HEIGHT
// 网格尺寸规则：1M 窗口用 20×10（每格 5k），200k 窗口用 10×10（每格 2k）；窄屏（< 80 列）宽度减半但高度保持 5 或 10。这样「一格代表多少 token」在不同屏幕上大致稳定，用户对颜色的直觉不会错乱。

  // Filter out deferred categories - they don't take up actual context space
  // (e.g., MCP tools when tool search is enabled)
  const nonDeferredCats = cats.filter(cat => !cat.isDeferred)

  // Calculate squares per category (use rawEffectiveMax for visualization to show full context)
  const categorySquares = nonDeferredCats.map(cat => ({
    ...cat,
    squares:
      cat.name === 'Free space'
        ? Math.round((cat.tokens / contextWindow) * TOTAL_SQUARES)
        : Math.max(1, Math.round((cat.tokens / contextWindow) * TOTAL_SQUARES)),
    percentageOfTotal: Math.round((cat.tokens / contextWindow) * 100),
  }))
// 每个分区的格子数按比例算，但非 Free space 的分区至少 1 格（Math.max(1, ...)）——否则一个 200 token 的小分区会完全不可见，用户会以为它不存在。Free space 不设下限，因为它本来就该按真实剩余取整。

  // Helper function to create grid squares for a category
  function createCategorySquares(
    category: (typeof categorySquares)[0],
  ): GridSquare[] {
    const squares: GridSquare[] = []
    const exactSquares = (category.tokens / contextWindow) * TOTAL_SQUARES
    const wholeSquares = Math.floor(exactSquares)
    const fractionalPart = exactSquares - wholeSquares

    for (let i = 0; i < category.squares; i++) {
      // Determine fullness: full squares get 1.0, partial square gets fractional amount
      let squareFullness = 1.0
      if (i === wholeSquares && fractionalPart > 0) {
        // This is the partial square
        squareFullness = fractionalPart
      }

      squares.push({
        color: category.color,
        isFilled: true,
        categoryName: category.name,
        tokens: category.tokens,
        percentage: category.percentageOfTotal,
        squareFullness,
      })
    }

    return squares
  }
// createCategorySquares 处理「不完整的最后一格」：整格 fullness 为 1.0，第一个不完整的格子取小数部分，让渲染层可以画半格。这是字符网格能表现小数占比的唯一办法。

  // Build the grid as an array of squares with full metadata
  const gridSquares: GridSquare[] = []

  // Separate reserved category for end placement (either autocompact or manual compact buffer)
  const reservedCategory = categorySquares.find(
    cat =>
      cat.name === RESERVED_CATEGORY_NAME ||
      cat.name === MANUAL_COMPACT_BUFFER_NAME,
  )
  const nonReservedCategories = categorySquares.filter(
    cat =>
      cat.name !== RESERVED_CATEGORY_NAME &&
      cat.name !== MANUAL_COMPACT_BUFFER_NAME &&
      cat.name !== 'Free space',
  )

  // Add all non-reserved, non-free-space squares first
  for (const cat of nonReservedCategories) {
    const squares = createCategorySquares(cat)
    for (const square of squares) {
      if (gridSquares.length < TOTAL_SQUARES) {
        gridSquares.push(square)
      }
    }
  }
// 填充顺序是刻意的：先所有非保留、非空闲的分区（截断到总格数），再用 Free space 填到「总数 − 保留格数」，最后才追加保留缓冲。于是缓冲永远在**最后**，视觉上表现为窗口尾部的一段预留——与真实的压缩时机（快满时才压缩）对应。

  // Calculate how many squares are needed for reserved
  const reservedSquareCount = reservedCategory ? reservedCategory.squares : 0

  // Fill with free space, leaving room for reserved at the end
  const freeSpaceCat = cats.find(c => c.name === 'Free space')
  const freeSpaceTarget = TOTAL_SQUARES - reservedSquareCount

  while (gridSquares.length < freeSpaceTarget) {
    gridSquares.push({
      color: 'promptBorder',
      isFilled: true,
      categoryName: 'Free space',
      tokens: freeSpaceCat?.tokens || 0,
      percentage: freeSpaceCat
        ? Math.round((freeSpaceCat.tokens / contextWindow) * 100)
        : 0,
      squareFullness: 1.0, // Free space is always "full"
    })
  }

  // Add reserved squares at the end
  if (reservedCategory) {
    const squares = createCategorySquares(reservedCategory)
    for (const square of squares) {
      if (gridSquares.length < TOTAL_SQUARES) {
        gridSquares.push(square)
      }
    }
  }
// 保留缓冲的格子最后追加，且仍受总格数上限约束（不足一格的余量直接舍弃）。

  // Convert to rows for rendering
  const gridRows: GridSquare[][] = []
  for (let i = 0; i < GRID_HEIGHT; i++) {
    gridRows.push(gridSquares.slice(i * GRID_WIDTH, (i + 1) * GRID_WIDTH))
  }
// gridRows 只是把一维格子数组按宽度切片成行，纯粹为渲染方便——把排版计算留在数据层，渲染层就不必知道任何比例逻辑。

  // Format message breakdown (used by context suggestions for all users)
  // Combine tool calls and results, then get top 5
  const toolsMap = new Map<
    string,
    { callTokens: number; resultTokens: number }
  >()

  // Add call tokens
  for (const [name, tokens] of messageBreakdown.toolCallsByType.entries()) {
    const existing = toolsMap.get(name) || { callTokens: 0, resultTokens: 0 }
    toolsMap.set(name, { ...existing, callTokens: tokens })
  }

  // Add result tokens
  for (const [name, tokens] of messageBreakdown.toolResultsByType.entries()) {
    const existing = toolsMap.get(name) || { callTokens: 0, resultTokens: 0 }
    toolsMap.set(name, { ...existing, resultTokens: tokens })
  }

  // Convert to array and sort by total tokens (calls + results)
  const toolsByTypeArray = Array.from(toolsMap.entries())
    .map(([name, { callTokens, resultTokens }]) => ({
      name,
      callTokens,
      resultTokens,
    }))
    .sort(
      (a, b) => b.callTokens + b.resultTokens - (a.callTokens + a.resultTokens),
    )

  const attachmentsByTypeArray = Array.from(
    messageBreakdown.attachmentsByType.entries(),
  )
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)

  const formattedMessageBreakdown = {
    toolCallTokens: messageBreakdown.toolCallTokens,
    toolResultTokens: messageBreakdown.toolResultTokens,
    attachmentTokens: messageBreakdown.attachmentTokens,
    assistantMessageTokens: messageBreakdown.assistantMessageTokens,
    userMessageTokens: messageBreakdown.userMessageTokens,
    toolCallsByType: toolsByTypeArray,
    attachmentsByType: attachmentsByTypeArray,
  }
// messageBreakdown 的格式化做了两件展示优化：① 工具调用与结果原本是两个 Map，这里按键合并成一个数组并按**总和**排序，于是「最贵的工具」一次就能看出来（工具结果常是真正的大头）；② 附件按 token 降序排。两者都只保留排序后的数组，Map 结构不对外暴露。

  return {
    categories: cats,
    totalTokens: finalTotalTokens,
    maxTokens: contextWindow,
    rawMaxTokens: contextWindow,
    percentage: Math.round((finalTotalTokens / contextWindow) * 100),
    gridRows,
    model: runtimeModel,
    memoryFiles: memoryFileDetails,
    mcpTools: mcpToolDetails,
    deferredBuiltinTools:
      process.env.USER_TYPE === 'ant' ? deferredBuiltinDetails : undefined,
    systemTools:
      process.env.USER_TYPE === 'ant' ? systemToolDetails : undefined,
    systemPromptSections:
      process.env.USER_TYPE === 'ant' ? systemPromptSections : undefined,
    agents: agentDetails,
    slashCommands:
      slashCommandTokens > 0
        ? {
            totalCommands: commandInfo.totalCommands,
            includedCommands: commandInfo.includedCommands,
            tokens: slashCommandTokens,
          }
        : undefined,
    skills:
      skillFrontmatterTokens > 0
        ? {
            totalSkills: skillInfo.totalSkills,
            includedSkills: skillInfo.includedSkills,
            tokens: skillFrontmatterTokens,
            skillFrontmatter: skillInfo.skillFrontmatter,
          }
        : undefined,
    autoCompactThreshold,
    isAutoCompactEnabled: isAutoCompact,
    messageBreakdown: formattedMessageBreakdown,
    apiUsage,
  }
}
// 返回值收尾有几处按用户类型裁剪：三个 [ANT-ONLY] 明细字段对普通用户返回 undefined（不传数据比传空数组更省）；slashCommands 与 skills 仅在 token 数大于 0 时才给对象，否则 undefined——面板据此决定是否渲染那一行。totalTokens 用 API 真实值，percentage 仍按窗口算，因此百分比可能超过估算的网格占比，属于预期。
