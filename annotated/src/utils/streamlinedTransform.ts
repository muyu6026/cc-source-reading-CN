/**
 * Transforms SDK messages for streamlined output mode.
 *
 * Streamlined mode is a "distillation-resistant" output format that:
 * - Keeps text messages intact
 * - Summarizes tool calls with cumulative counts (resets when text appears)
 * - Omits thinking content
 * - Strips tool list and model info from init messages
 */

import type { SDKAssistantMessage } from 'src/entrypoints/agentSdkTypes.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { LIST_MCP_RESOURCES_TOOL_NAME } from 'src/tools/ListMcpResourcesTool/prompt.js'
import { LSP_TOOL_NAME } from 'src/tools/LSPTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { TASK_STOP_TOOL_NAME } from 'src/tools/TaskStopTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from 'src/tools/WebSearchTool/prompt.js'
import { extractTextContent } from 'src/utils/messages.js'
import { SHELL_TOOL_NAMES } from 'src/utils/shell/shellToolUtils.js'
import { capitalize } from 'src/utils/stringUtils.js'

type ToolCounts = {
  searches: number
  reads: number
  writes: number
  commands: number
  other: number
}
// ToolCounts 汇总各分类的工具调用次数，供精简输出模式的累计统计使用。

/**
 * Tool categories for summarization.
 */
const SEARCH_TOOLS = [
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  LSP_TOOL_NAME,
]
const READ_TOOLS = [FILE_READ_TOOL_NAME, LIST_MCP_RESOURCES_TOOL_NAME]
const WRITE_TOOLS = [
  FILE_WRITE_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
]
const COMMAND_TOOLS = [...SHELL_TOOL_NAMES, 'Tmux', TASK_STOP_TOOL_NAME]
// 四类工具常量与 categorizeToolName 共同把工具名归入搜索、读取、写入、命令或其他类别。

function categorizeToolName(toolName: string): keyof ToolCounts {
  if (SEARCH_TOOLS.some(t => toolName.startsWith(t))) return 'searches'
  if (READ_TOOLS.some(t => toolName.startsWith(t))) return 'reads'
  if (WRITE_TOOLS.some(t => toolName.startsWith(t))) return 'writes'
  if (COMMAND_TOOLS.some(t => toolName.startsWith(t))) return 'commands'
  return 'other'
}
// categorizeToolName 收尾：按前缀匹配工具名返回对应计数键，未命中归为 other。

function createEmptyToolCounts(): ToolCounts {
  return {
    searches: 0,
    reads: 0,
    writes: 0,
    commands: 0,
    other: 0,
  }
}
// createEmptyToolCounts 返回全零的计数对象，作为每轮文本消息后的重置基线。

/**
 * Generate a summary text for tool counts.
 */
// getToolSummaryText 把累计计数拼成类似 `searched N patterns` 的摘要文案，零计数返回 undefined。
function getToolSummaryText(counts: ToolCounts): string | undefined {
  const parts: string[] = []

  // Use similar phrasing to collapseReadSearch.ts
  if (counts.searches > 0) {
    parts.push(
      `searched ${counts.searches} ${counts.searches === 1 ? 'pattern' : 'patterns'}`,
    )
  }
  if (counts.reads > 0) {
    parts.push(`read ${counts.reads} ${counts.reads === 1 ? 'file' : 'files'}`)
  }
  if (counts.writes > 0) {
    parts.push(
      `wrote ${counts.writes} ${counts.writes === 1 ? 'file' : 'files'}`,
    )
  }
  if (counts.commands > 0) {
    parts.push(
      `ran ${counts.commands} ${counts.commands === 1 ? 'command' : 'commands'}`,
    )
  }
  if (counts.other > 0) {
    parts.push(`${counts.other} other ${counts.other === 1 ? 'tool' : 'tools'}`)
  }

  if (parts.length === 0) {
    return undefined
  }

  return capitalize(parts.join(', '))
}
// getToolSummaryText 收尾：用首字母大写连接各分类描述。

/**
 * Count tool uses in an assistant message and add to existing counts.
 */
// accumulateToolUses 遍历助手消息内容，把每个工具调用的类别计数加一。
function accumulateToolUses(
  message: SDKAssistantMessage,
  counts: ToolCounts,
): void {
  const content = message.message.content
  if (!Array.isArray(content)) {
    return
  }

  for (const block of content) {
    if (block.type === 'tool_use' && 'name' in block) {
      const category = categorizeToolName(block.name as string)
      counts[category]++
    }
  }
}
// accumulateToolUses 收尾：仅处理 tool_use 块，其余内容忽略。

/**
 * Create a stateful transformer that accumulates tool counts between text messages.
 * Tool counts reset when a message with text content is encountered.
 */
// createStreamlinedTransformer 返回一个有状态转换器，在文本消息之间累计工具计数并重置。
export function createStreamlinedTransformer(): (
  message: StdoutMessage,
) => StdoutMessage | null {
  let cumulativeCounts = createEmptyToolCounts()

  return function transformToStreamlined(
    message: StdoutMessage,
  ): StdoutMessage | null {
    switch (message.type) {
      case 'assistant': {
        const content = message.message.content
        const text = Array.isArray(content)
          ? extractTextContent(content, '\n').trim()
          : ''

        // Accumulate tool counts from this message
        accumulateToolUses(message, cumulativeCounts)

        if (text.length > 0) {
          // Text message: emit text only, reset counts
          cumulativeCounts = createEmptyToolCounts()
          return {
            type: 'streamlined_text',
            text,
            session_id: message.session_id,
            uuid: message.uuid,
          }
        }

        // Tool-only message: emit cumulative tool summary
        const toolSummary = getToolSummaryText(cumulativeCounts)
        if (!toolSummary) {
          return null
        }

        return {
          type: 'streamlined_tool_use_summary',
          tool_summary: toolSummary,
          session_id: message.session_id,
          uuid: message.uuid,
        }
      }

      case 'result':
        // Keep result messages as-is (they have structured_output, permission_denials)
        return message

      case 'system':
      case 'user':
      case 'stream_event':
      case 'tool_progress':
      case 'auth_status':
      case 'rate_limit_event':
      case 'control_response':
      case 'control_request':
      case 'control_cancel_request':
      case 'keep_alive':
        return null

      default:
        return null
    }
  }
}
// createStreamlinedTransformer 收尾：文本消息发出纯文本并清零，纯工具消息发出累计摘要。

/**
 * Check if a message should be included in streamlined output.
 * Useful for filtering before transformation.
 */
// shouldIncludeInStreamlined 判断消息是否应进入精简输出，仅保留助手与结果消息。
export function shouldIncludeInStreamlined(message: StdoutMessage): boolean {
  return message.type === 'assistant' || message.type === 'result'
}
// shouldIncludeInStreamlined 收尾：返回是否为助手或结果类型。
