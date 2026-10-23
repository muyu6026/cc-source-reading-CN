import Fuse from 'fuse.js'
import { basename } from 'path'
import type { SuggestionItem } from 'src/components/PromptInput/PromptInputFooterSuggestions.js'
import { generateFileSuggestions } from 'src/hooks/fileSuggestions.js'
import type { ServerResource } from 'src/services/mcp/types.js'
import { getAgentColor } from 'src/tools/AgentTool/agentColorManager.js'
import type { AgentDefinition } from 'src/tools/AgentTool/loadAgentsDir.js'
import { truncateToWidth } from 'src/utils/format.js'
import { logError } from 'src/utils/log.js'
import type { Theme } from 'src/utils/theme.js'

type FileSuggestionSource = {
  type: 'file'
  displayText: string
  description?: string
  path: string
  filename: string
  score?: number
}

type McpResourceSuggestionSource = {
  type: 'mcp_resource'
  displayText: string
  description: string
  server: string
  uri: string
  name: string
}

type AgentSuggestionSource = {
  type: 'agent'
  displayText: string
  description: string
  agentType: string
  color?: keyof Theme
}

type SuggestionSource =
  | FileSuggestionSource
  | McpResourceSuggestionSource
  | AgentSuggestionSource
// 文件级：@ 补全的三源合一器（文件 / MCP 资源 / subagent）。useTypeahead 的 fetchFileSuggestions 调这里的 generateUnifiedSuggestions，一次查询混排三类结果。

/**
 * Creates a unified suggestion item from a source
 */
function createSuggestionFromSource(source: SuggestionSource): SuggestionItem {
  switch (source.type) {
    case 'file':
      return {
        id: `file-${source.path}`,
        displayText: source.displayText,
        description: source.description,
      }
    case 'mcp_resource':
      return {
        id: `mcp-resource-${source.server}__${source.uri}`,
        displayText: source.displayText,
        description: source.description,
      }
    case 'agent':
      return {
        id: `agent-${source.agentType}`,
        displayText: source.displayText,
        description: source.description,
        color: source.color,
      }
  }
}
// createSuggestionFromSource：id 前缀即类型命名空间（file- / mcp-resource-<server>__<uri> / agent-）。MCP 的 id 用双下划线分隔 server 与 uri——单下划线在 URI 里太常见会歧义。

const MAX_UNIFIED_SUGGESTIONS = 15
const DESCRIPTION_MAX_LENGTH = 60

function truncateDescription(description: string): string {
  return truncateToWidth(description, DESCRIPTION_MAX_LENGTH)
}
// 两个上限：建议 15 条（与 fileSuggestions 的 MAX_SUGGESTIONS 对齐）、描述 60 字符（truncateToWidth 按显示宽度算，CJK 全角字符不会算漏）。

function generateAgentSuggestions(
  agents: AgentDefinition[],
  query: string,
  showOnEmpty = false,
): AgentSuggestionSource[] {
  if (!query && !showOnEmpty) {
    return []
  }

  try {
    const agentSources: AgentSuggestionSource[] = agents.map(agent => ({
      type: 'agent' as const,
      displayText: `${agent.agentType} (agent)`,
      description: truncateDescription(agent.whenToUse),
      agentType: agent.agentType,
      color: getAgentColor(agent.agentType),
    }))

    if (!query) {
      return agentSources
    }

    const queryLower = query.toLowerCase()
    return agentSources.filter(
      agent =>
        agent.agentType.toLowerCase().includes(queryLower) ||
        agent.displayText.toLowerCase().includes(queryLower),
    )
  } catch (error) {
    logError(error as Error)
    return []
  }
}
// generateAgentSuggestions：空查询（showOnEmpty）返回全部 agent；有查询按 agentType 或 displayText 子串匹配。displayText 带 (agent) 后缀——和文件结果混排时用户能看出哪条是起 agent。description 用 whenToUse 截断（「什么时候用我」正是补全时最该看的）。整段 try/catch：agent 定义加载坏了不该炸掉补全。

export async function generateUnifiedSuggestions(
  query: string,
  mcpResources: Record<string, ServerResource[]>,
  agents: AgentDefinition[],
  showOnEmpty = false,
): Promise<SuggestionItem[]> {
  if (!query && !showOnEmpty) {
    return []
  }

  const [fileSuggestions, agentSources] = await Promise.all([
    generateFileSuggestions(query, showOnEmpty),
    Promise.resolve(generateAgentSuggestions(agents, query, showOnEmpty)),
  ])

  const fileSources: FileSuggestionSource[] = fileSuggestions.map(
    suggestion => ({
      type: 'file' as const,
      displayText: suggestion.displayText,
      description: suggestion.description,
      path: suggestion.displayText, // Use displayText as path for files
      filename: basename(suggestion.displayText),
      score: (suggestion.metadata as { score?: number } | undefined)?.score,
    }),
  )

  const mcpSources: McpResourceSuggestionSource[] = Object.values(mcpResources)
    .flat()
    .map(resource => ({
      type: 'mcp_resource' as const,
      displayText: `${resource.server}:${resource.uri}`,
      description: truncateDescription(
        resource.description || resource.name || resource.uri,
      ),
      server: resource.server,
      uri: resource.uri,
      name: resource.name || resource.uri,
    }))

  if (!query) {
    const allSources = [...fileSources, ...mcpSources, ...agentSources]
    return allSources
      .slice(0, MAX_UNIFIED_SUGGESTIONS)
      .map(createSuggestionFromSource)
  }
// 空查询路径：三类直接拼接截断，不打分——用户刚打了 @ 还没输入，列表是「浏览模式」不是「搜索模式」。

  const nonFileSources: SuggestionSource[] = [...mcpSources, ...agentSources]

  // Score non-file sources with Fuse.js
  // File sources are already scored by Rust/nucleo
  type ScoredSource = { source: SuggestionSource; score: number }
  const scoredResults: ScoredSource[] = []

  // Add file sources with their nucleo scores (already 0-1, lower is better)
  for (const fileSource of fileSources) {
    scoredResults.push({
      source: fileSource,
      score: fileSource.score ?? 0.5, // Default to middle score if missing
    })
  }

  // Score non-file sources with Fuse.js and add them
  if (nonFileSources.length > 0) {
    const fuse = new Fuse(nonFileSources, {
      includeScore: true,
      threshold: 0.6, // Allow more matches through, we'll sort by score
      keys: [
        { name: 'displayText', weight: 2 },
        { name: 'name', weight: 3 },
        { name: 'server', weight: 1 },
        { name: 'description', weight: 1 },
        { name: 'agentType', weight: 3 },
      ],
    })

    const fuseResults = fuse.search(query, { limit: MAX_UNIFIED_SUGGESTIONS })
    for (const result of fuseResults) {
      scoredResults.push({
        source: result.item,
        score: result.score ?? 0.5,
      })
    }
  }
// Fuse.js 权重设计：name/agentType 权重 3（精确标识符）> displayText 2 > server/description 1。threshold 0.6 刻意放宽——粗筛交给 Fuse，精排交给后面统一排序。

  // Sort all results by score (lower is better) and return top results
  scoredResults.sort((a, b) => a.score - b.score)

  return scoredResults
    .slice(0, MAX_UNIFIED_SUGGESTIONS)
    .map(r => r.source)
    .map(createSuggestionFromSource)
}
// 混排的关键巧合：nucleo 与 Fuse 都是「0-1 分、越低越好」，所以两套引擎的分数能进同一个池子排序。文件分缺失时默认 0.5（中位）——没分数的不抢榜首也不沉底。这一步是整个「@ 一个字符同时搜文件和 agent」体验的核心。
