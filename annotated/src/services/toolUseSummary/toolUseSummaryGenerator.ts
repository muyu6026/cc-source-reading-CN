/**
 * Tool Use Summary Generator
 *
 * Generates human-readable summaries of completed tool batches using Haiku.
 * Used by the SDK to provide high-level progress updates to clients.
 */

import { E_TOOL_USE_SUMMARY_GENERATION_FAILED } from '../../constants/errorIds.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { queryHaiku } from '../api/claude.js'

// 系统 prompt 只有四句，但每句都在防一种具体的失败：① **字数**——「手机端单行约 30 字符就截断」，所以按 git commit subject 写、不按句子写；② **语态**——动词用过去时（这些工具已经跑完了）；③ **取舍**——先丢冠词、连词、长位置信息，保住「最有辨识度的名词」；④ 给 5 个示例把抽象的规则落成可模仿的形状。
const TOOL_USE_SUMMARY_SYSTEM_PROMPT = `Write a short summary label describing what these tool calls accomplished. It appears as a single-line row in a mobile app and truncates around 30 characters, so think git-commit-subject, not sentence.

Keep the verb in past tense and the most distinctive noun. Drop articles, connectors, and long location context first.

Examples:
- Searched in auth/
- Fixed NPE in UserService
- Created signup endpoint
- Read config.json
- Ran failing tests`

type ToolInfo = {
  name: string
  input: unknown
  output: unknown
}

export type GenerateToolUseSummaryParams = {
  tools: ToolInfo[]
  signal: AbortSignal
  isNonInteractiveSession: boolean
  lastAssistantText?: string
}

/**
 * Generates a human-readable summary of completed tools.
 *
 * @param params - Parameters including tools executed and their results
 * @returns A brief summary string, or null if generation fails
 */
export async function generateToolUseSummary({
  tools,
  signal,
  isNonInteractiveSession,
  lastAssistantText,
}: GenerateToolUseSummaryParams): Promise<string | null> {
// 空批次直接返 `null`，**连请求都不发**。这一条被调用得很频繁（每轮工具执行完都调），一个空数组也要发一次 Haiku 请求的话，成本会很难看。
  if (tools.length === 0) {
    return null
  }

  try {
    // Build a concise representation of what tools did
// 输入和输出**各截 300 字符**再拼成摘要素材。为什么不像 `diagnosticTracking` 那样给总预算而是逐项截：一批里可能有 10 个工具，按总量截会让靠后的工具完全消失；逐项截保证每个工具都露脸，模型才有机会说「批量改了什么」。
    const toolSummaries = tools
      .map(tool => {
        const inputStr = truncateJson(tool.input, 300)
        const outputStr = truncateJson(tool.output, 300)
        return `Tool: ${tool.name}\nInput: ${inputStr}\nOutput: ${outputStr}`
      })
      .join('\n\n')

// `lastAssistantText` 只取前 200 字符当「用户意图」。为什么要它：单看工具调用只知道「读了 config.json」，加上助手上一句话才知道「是在排查启动失败」。截 200 是够的——意图通常在开头一句里。
    const contextPrefix = lastAssistantText
      ? `User's intent (from assistant's last message): ${lastAssistantText.slice(0, 200)}\n\n`
      : ''

    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([TOOL_USE_SUMMARY_SYSTEM_PROMPT]),
      userPrompt: `${contextPrefix}Tools completed:\n\n${toolSummaries}\n\nLabel:`,
      signal,
      options: {
        querySource: 'tool_use_summary_generation',
        enablePromptCaching: true,
        agents: [],
        isNonInteractiveSession,
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    })
// `queryHaiku` 的 options 全部取空：`agents: []`、`mcpTools: []`、`hasAppendSystemPrompt: false`——摘要模型不需要知道项目里有什么工具和子代理，把工具定义塞进去只会让 prompt 变长、cache key 变复杂。`enablePromptCaching: true` 倒是留着：system prompt 是常量，高频调用下缓存命中能省掉绝大部分输入费。

    const summary = response.message.content
      .filter(block => block.type === 'text')
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    return summary || null
// 失败**不抛**：打一条带 `errorId` 的错误日志后返 `null`。调用方拿 `null` 就是「这次没摘要」，UI 少显示一行而已。`err.cause = { errorId }` 而不是拼进 message——这样遥测按 errorId 聚合，不会因为 message 里的动态内容散成几千个不同错误。
  } catch (error) {
    // Log but don't fail - summaries are non-critical
    const err = toError(error)
    err.cause = { errorId: E_TOOL_USE_SUMMARY_GENERATION_FAILED }
    logError(err)
    return null
  }
}

/**
 * Truncates a JSON value to a maximum length for the prompt.
 */
function truncateJson(value: unknown, maxLength: number): string {
// `maxLength - 3` 是给省略号留位置：直接 `slice(0, maxLength) + '...'` 会超出上限 3 个字符，而调用方是按 300 这个数字估算 prompt 长度的。`jsonStringify` 单独抽在 `slowOperations` 里（同一处还有 `jsonParse`），序列化失败就返 `[unable to serialize]`——工具输出里可能有循环引用的对象。
  try {
    const str = jsonStringify(value)
    if (str.length <= maxLength) {
      return str
    }
    return str.slice(0, maxLength - 3) + '...'
  } catch {
    return '[unable to serialize]'
  }
}
