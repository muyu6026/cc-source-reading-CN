import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import memoize from 'lodash-es/memoize.js'
import { z } from 'zod/v4'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  buildTool,
  findToolByName,
  type Tool,
  type ToolDef,
  type Tools,
} from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { escapeRegExp } from '../../utils/stringUtils.js'
import { isToolSearchEnabledOptimistic } from '../../utils/toolSearch.js'
import { getPrompt, isDeferredTool, TOOL_SEARCH_TOOL_NAME } from './prompt.js'

// inputSchema 两参数：query（「select:工具名」直选或关键词搜索）、max_results（默认 5）。max_results 有默认值——模型不传也能用，schema 层的 .default(5) 比 prompt 里写「建议 5 个」可靠。
export const inputSchema = lazySchema(() =>
  z.object({
    query: z
      .string()
      .describe(
        'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
      ),
    max_results: z
      .number()
      .optional()
      .default(5)
      .describe('Maximum number of results to return (default: 5)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// outputSchema：matches（工具名数组——注意是名字不是完整 schema，真正的 schema 由 mapToolResult 以 tool_reference 块下发）+ query 回显 + total_deferred_tools（让模型知道自己漏了多少）+ pending_mcp_servers（还在连接的服务器，解释「为什么搜不到」）。
export const outputSchema = lazySchema(() =>
  z.object({
    matches: z.array(z.string()),
    query: z.string(),
    total_deferred_tools: z.number(),
    pending_mcp_servers: z.array(z.string()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Track deferred tool names to detect when cache should be cleared
// 模块级缓存变量：记住「上次见到的 deferred 工具集合」。工具集会随 MCP 连接/断开、特性开关变化——集合一变，描述缓存全部作废。
let cachedDeferredToolNames: string | null = null

/**
 * Get a cache key representing the current set of deferred tools.
 */
// getDeferredToolsCacheKey：把工具名排序后拼接成缓存键。排序保证顺序无关——tools 数组的枚举顺序不该影响缓存命中。
function getDeferredToolsCacheKey(deferredTools: Tools): string {
  return deferredTools
    .map(t => t.name)
    .sort()
    .join(',')
}

/**
 * Get tool description, memoized by tool name.
 * Used for keyword search scoring.
 */
// getToolDescriptionMemoized：按工具名 memoize 描述生成。注意 resolver 的第二个参数 tools 不在缓存键里（memoize 只按 toolName）——描述只取决于工具本身，tools 数组只是调用 prompt() 需要的上下文；集合变化由 maybeInvalidateCache 显式清缓存，不依赖键设计。prompt() 调用时现造一个 default 模式的最小权限上下文——搜索只需要文本，不需要真实权限状态。
const getToolDescriptionMemoized = memoize(
  async (toolName: string, tools: Tools): Promise<string> => {
    const tool = findToolByName(tools, toolName)
    if (!tool) {
      return ''
    }
    return tool.prompt({
      getToolPermissionContext: async () => ({
        mode: 'default' as const,
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      }),
      tools,
      agents: [],
    })
  },
  (toolName: string) => toolName,
)

/**
 * Invalidate the description cache if deferred tools have changed.
 */
// maybeInvalidateCache：每次搜索前比对缓存键，变了就清 lodash memoize 缓存并更新键。调试日志说明清缓存是低频事件（只在工具集变化时）——如果它高频出现，说明有地方在反复重建工具列表。
function maybeInvalidateCache(deferredTools: Tools): void {
  const currentKey = getDeferredToolsCacheKey(deferredTools)
  if (cachedDeferredToolNames !== currentKey) {
    logForDebugging(
      `ToolSearchTool: cache invalidated - deferred tools changed`,
    )
    getToolDescriptionMemoized.cache.clear?.()
    cachedDeferredToolNames = currentKey
  }
}

// clearToolSearchDescriptionCache 是导出的手动清除入口——供会话重置、MCP 重连等外部事件调用，不依赖下一次搜索的惰性校验。
export function clearToolSearchDescriptionCache(): void {
  getToolDescriptionMemoized.cache.clear?.()
  cachedDeferredToolNames = null
}

/**
 * Build the search result output structure.
 */
// buildSearchResult：统一构造返回结构。pending_mcp_servers 只在非空时 Spread 进结果——可选字段不出空数组，schema 消费方少一层判空。
function buildSearchResult(
  matches: string[],
  query: string,
  totalDeferredTools: number,
  pendingMcpServers?: string[],
): { data: Output } {
  return {
    data: {
      matches,
      query,
      total_deferred_tools: totalDeferredTools,
      ...(pendingMcpServers && pendingMcpServers.length > 0
        ? { pending_mcp_servers: pendingMcpServers }
        : {}),
    },
  }
}

/**
 * Parse tool name into searchable parts.
 * Handles both MCP tools (mcp__server__action) and regular tools (CamelCase).
 */
// parseToolName：把工具名拆成可搜索的词根。MCP 工具（mcp__server__action）拆成 server+action 词根；普通工具按 CamelCase 与下划线拆。isMcp 标记后面用于加权——服务器名匹配比动作词匹配更值得信任。
function parseToolName(name: string): {
  parts: string[]
  full: string
  isMcp: boolean
} {
  // Check if it's an MCP tool
  if (name.startsWith('mcp__')) {
    const withoutPrefix = name.replace(/^mcp__/, '').toLowerCase()
    const parts = withoutPrefix.split('__').flatMap(p => p.split('_'))
    return {
      parts: parts.filter(Boolean),
      full: withoutPrefix.replace(/__/g, ' ').replace(/_/g, ' '),
      isMcp: true,
    }
  }

  // Regular tool - split by CamelCase and underscores
  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // CamelCase to spaces
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  return {
    parts,
    full: parts.join(' '),
    isMcp: false,
  }
}

/**
 * Pre-compile word-boundary regexes for all search terms.
 * Called once per search instead of tools×terms×2 times.
 */
// compileTermPatterns：一次搜索把词根预编译成词边界正则。注释点明性能动机——否则会是 工具数×词数×2 次的正则编译；Map 去重保证同词只编译一次。escapeRegExp 防用户查询里的正则元字符穿洞。
function compileTermPatterns(terms: string[]): Map<string, RegExp> {
  const patterns = new Map<string, RegExp>()
  for (const term of terms) {
    if (!patterns.has(term)) {
      patterns.set(term, new RegExp(`\\b${escapeRegExp(term)}\\b`))
    }
  }
  return patterns
}

/**
 * Keyword-based search over tool names and descriptions.
 * Handles both MCP tools (mcp__server__action) and regular tools (CamelCase).
 *
 * The model typically queries with:
 * - Server names when it knows the integration (e.g., "slack", "github")
 * - Action words when looking for functionality (e.g., "read", "list", "create")
 * - Tool-specific terms (e.g., "notebook", "shell", "kill")
 */
// searchToolsWithKeywords 主流程。文档注释列出模型的三种典型查询形态：知道集成商时搜服务器名（slack/github）、找功能时搜动作词（read/list/create）、找特定工具时搜专名（notebook/shell/kill）——评分权重就是按这个使用分布调的。
async function searchToolsWithKeywords(
  query: string,
  deferredTools: Tools,
  tools: Tools,
  maxResults: number,
): Promise<string[]> {
  const queryLower = query.toLowerCase().trim()

  // Fast path: if query matches a tool name exactly, return it directly.
  // Handles models using a bare tool name instead of select: prefix (seen
  // from subagents/post-compaction). Checks deferred first, then falls back
  // to the full tool set — selecting an already-loaded tool is a harmless
  // no-op that lets the model proceed without retry churn.
  const exactMatch =
    deferredTools.find(t => t.name.toLowerCase() === queryLower) ??
    tools.find(t => t.name.toLowerCase() === queryLower)
// 精确名匹配快速通道：查询整个就是个工具名（大小写不敏感）时直接返回。注释说明这是给「压缩后/子代理里模型直接用裸工具名」的场景兜底——先查 deferred 再查全量，选中已加载工具是无害 no-op，让模型不用重试。这是对模型习惯的顺应而非纠正。
  if (exactMatch) {
    return [exactMatch.name]
  }

  // If query looks like an MCP tool prefix (mcp__server), find matching tools.
  // Handles models searching by server name with mcp__ prefix.
// mcp__ 前缀特判：模型按服务器名带前缀搜索时，直接前缀过滤取前 N 个。比词根评分更快也更准——服务器名是精确标识，不需要模糊匹配。
  if (queryLower.startsWith('mcp__') && queryLower.length > 5) {
    const prefixMatches = deferredTools
      .filter(t => t.name.toLowerCase().startsWith(queryLower))
      .slice(0, maxResults)
      .map(t => t.name)
    if (prefixMatches.length > 0) {
      return prefixMatches
    }
  }

  const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 0)
// 查询分词：空白切分。+前缀词（如「+slack send」的 +slack）在下一步被提为必选词——「+」是给模型的微型查询语法，比自然语言「必须包含 slack」可靠。

  // Partition into required (+prefixed) and optional terms
// 必选/可选分区：+前缀进 requiredTerms，其余进 optionalTerms。有必选词时先用 ALL 语义预过滤候选（名称词根或描述命中每一个必选词），再对候选评分——两阶段设计避免「高分但缺关键服务器」的错配排前面。
  const requiredTerms: string[] = []
  const optionalTerms: string[] = []
  for (const term of queryTerms) {
    if (term.startsWith('+') && term.length > 1) {
      requiredTerms.push(term.slice(1))
    } else {
      optionalTerms.push(term)
    }
  }

  const allScoringTerms =
    requiredTerms.length > 0 ? [...requiredTerms, ...optionalTerms] : queryTerms
  const termPatterns = compileTermPatterns(allScoringTerms)

  // Pre-filter to tools matching ALL required terms in name or description
  let candidateTools = deferredTools
  if (requiredTerms.length > 0) {
    const matches = await Promise.all(
      deferredTools.map(async tool => {
        const parsed = parseToolName(tool.name)
        const description = await getToolDescriptionMemoized(tool.name, tools)
        const descNormalized = description.toLowerCase()
        const hintNormalized = tool.searchHint?.toLowerCase() ?? ''
        const matchesAll = requiredTerms.every(term => {
          const pattern = termPatterns.get(term)!
          return (
            parsed.parts.includes(term) ||
            parsed.parts.some(part => part.includes(term)) ||
            pattern.test(descNormalized) ||
            (hintNormalized && pattern.test(hintNormalized))
          )
        })
        return matchesAll ? tool : null
      }),
    )
    candidateTools = matches.filter((t): t is Tool => t !== null)
  }

  const scored = await Promise.all(
    candidateTools.map(async tool => {
      const parsed = parseToolName(tool.name)
      const description = await getToolDescriptionMemoized(tool.name, tools)
      const descNormalized = description.toLowerCase()
      const hintNormalized = tool.searchHint?.toLowerCase() ?? ''

      let score = 0
      for (const term of allScoringTerms) {
        const pattern = termPatterns.get(term)!

        // Exact part match (high weight for MCP server names, tool name parts)
        if (parsed.parts.includes(term)) {
          score += parsed.isMcp ? 12 : 10
        } else if (parsed.parts.some(part => part.includes(term))) {
          score += parsed.isMcp ? 6 : 5
        }

        // Full name fallback (for edge cases)
        if (parsed.full.includes(term) && score === 0) {
          score += 3
        }

        // searchHint match — curated capability phrase, higher signal than prompt
        if (hintNormalized && pattern.test(hintNormalized)) {
          score += 4
        }

        // Description match - use word boundary to avoid false positives
        if (pattern.test(descNormalized)) {
          score += 2
        }
      }

      return { name: tool.name, score }
    }),
  )

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(item => item.name)
}

// buildTool 主结构。三个布尔全为真：可并发（纯查询）、只读（不改状态）、但 isEnabled 走 isToolSearchEnabledOptimistic——乐观启用，即使远程开关还没刷新到也先用默认值，避免功能「时灵时不灵」。
export const ToolSearchTool = buildTool({
  isEnabled() {
    return isToolSearchEnabledOptimistic()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  name: TOOL_SEARCH_TOOL_NAME,
  maxResultSizeChars: 100_000,
  async description() {
    return getPrompt()
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
// call() 从 options.tools 里过滤出 deferred 集合，先做缓存校验（工具集可能刚变）。两个内部辅助函数——getPendingServerNames（从 AppState.mcp.clients 找 pending 状态的）与 logSearchOutcome（tengu_tool_search_outcome 遥测：查询类型、命中数、总数、是否有结果）——都定义在 call 作用域内，随调用创建随调用销毁，不污染模块。
  async call(input, { options: { tools }, getAppState }) {
    const { query, max_results = 5 } = input

    const deferredTools = tools.filter(isDeferredTool)
    maybeInvalidateCache(deferredTools)

    // Check for MCP servers still connecting
    function getPendingServerNames(): string[] | undefined {
      const appState = getAppState()
      const pending = appState.mcp.clients.filter(c => c.type === 'pending')
      return pending.length > 0 ? pending.map(s => s.name) : undefined
    }

    // Helper to log search outcome
    function logSearchOutcome(
      matches: string[],
      queryType: 'select' | 'keyword',
    ): void {
      logEvent('tengu_tool_search_outcome', {
        query:
          query as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        queryType:
          queryType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        matchCount: matches.length,
        totalDeferredTools: deferredTools.length,
        maxResults: max_results,
        hasMatches: matches.length > 0,
      })
    }

    // Check for select: prefix — direct tool selection.
    // Supports comma-separated multi-select: `select:A,B,C`.
    // If a name isn't in the deferred set but IS in the full tool set,
    // we still return it — the tool is already loaded, so "selecting" it
    // is a harmless no-op that lets the model proceed without retry churn.
    const selectMatch = query.match(/^select:(.+)$/i)
// select: 直选支持逗号分隔多选（select:A,B,C）。逐个查找时同样先 deferred 后全量——请求一个已加载工具返回它，模型不会因为「已经加载过」而吃到错误。部分命中时 found 照常返回、missing 只记 debug 日志——不因一个坏名字废掉整批。
    if (selectMatch) {
      const requested = selectMatch[1]!
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

      const found: string[] = []
      const missing: string[] = []
      for (const toolName of requested) {
        const tool =
          findToolByName(deferredTools, toolName) ??
          findToolByName(tools, toolName)
        if (tool) {
          if (!found.includes(tool.name)) found.push(tool.name)
        } else {
          missing.push(toolName)
        }
      }

      if (found.length === 0) {
        logForDebugging(
          `ToolSearchTool: select failed — none found: ${missing.join(', ')}`,
        )
        logSearchOutcome([], 'select')
        const pendingServers = getPendingServerNames()
        return buildSearchResult(
          [],
          query,
          deferredTools.length,
          pendingServers,
        )
      }

      if (missing.length > 0) {
        logForDebugging(
          `ToolSearchTool: partial select — found: ${found.join(', ')}, missing: ${missing.join(', ')}`,
        )
      } else {
        logForDebugging(`ToolSearchTool: selected ${found.join(', ')}`)
      }
      logSearchOutcome(found, 'select')
      return buildSearchResult(found, query, deferredTools.length)
    }

    // Keyword search
// 关键词搜索回落：select 不命中（或不是 select 形式）时走评分搜索。零结果时附带 pending_mcp_servers——「搜不到」的常见原因是服务器还在连，这个字段把猜测变成确定信息。
    const matches = await searchToolsWithKeywords(
      query,
      deferredTools,
      tools,
      max_results,
    )

    logForDebugging(
      `ToolSearchTool: keyword search for "${query}", found ${matches.length} matches`,
    )

    logSearchOutcome(matches, 'keyword')

    // Include pending server info when search finds no matches
    if (matches.length === 0) {
      const pendingServers = getPendingServerNames()
      return buildSearchResult(
        matches,
        query,
        deferredTools.length,
        pendingServers,
      )
    }

    return buildSearchResult(matches, query, deferredTools.length)
  },
  renderToolUseMessage() {
    return null
  },
  userFacingName: () => '',
  /**
   * Returns a tool_result with tool_reference blocks.
   * This format works on 1P/Foundry. Bedrock/Vertex may not support
   * client-side tool_reference expansion yet.
   */
// mapToolResult 把 matches 转成 tool_reference 块数组——这是本工具与普通工具的本质区别：它返回的不是文本而是「工具定义句柄」，客户端（1P/Foundry）据此把完整 schema 展开进上下文。注释明说 Bedrock/Vertex 可能不支持客户端展开——跨提供商兼容是这个设计的隐藏成本，as unknown as 强转正是为兜底格式差异。
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    if (content.matches.length === 0) {
// 零命中文案带条件后缀：有 pending 服务器时明说「它们还在连接，稍后再试」——把「搜索失败」重新框定为「时机未到」，模型学会等待而不是换查询词乱试。
      let text = 'No matching deferred tools found'
      if (
        content.pending_mcp_servers &&
        content.pending_mcp_servers.length > 0
      ) {
        text += `. Some MCP servers are still connecting: ${content.pending_mcp_servers.join(', ')}. Their tools will become available shortly — try searching again.`
      }
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: text,
      }
    }
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: content.matches.map(name => ({
        type: 'tool_reference' as const,
        tool_name: name,
      })),
    } as unknown as ToolResultBlockParam
  },
} satisfies ToolDef<InputSchema, Output>)
