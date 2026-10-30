/**
 * Session title generation via Haiku.
 *
 * Standalone module with minimal dependencies so it can be imported from
 * print.ts (SDK control request handler) without pulling in the React/chalk/
 * git dependency chain that teleport.tsx carries.
 *
 * This is the single source of truth for AI-generated session titles across
 * all surfaces. Previously there were separate Haiku title generators:
 * - teleport.tsx generateTitleAndBranch (6-word title + branch for CCR)
 * - rename/generateSessionName.ts (kebab-case name for /rename)
 * Each remains for backwards compat; new callers should use this module.
 */
// 用 Haiku 生成会话标题；做成依赖极少的独立模块，便于从 print.ts（SDK 控制请求处理器）引入而不拉进 teleport.tsx 那套 React/chalk/git 依赖链。此前各端各有标题生成器，本模块是唯一的 AI 标题真源。

import { z } from 'zod/v4'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { queryHaiku } from '../services/api/claude.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from './debug.js'
import { safeParseJSON } from './json.js'
import { lazySchema } from './lazySchema.js'
import { extractTextContent } from './messages.js'
import { asSystemPrompt } from './systemPromptType.js'
// 本模块依赖：zod 校验、bootstrap 状态、遥测、Haiku 查询、消息工具、JSON 安全解析、懒加载 schema、systemPrompt 类型等。

const MAX_CONVERSATION_TEXT = 1000
// 取作标题输入的对话文本上限：超长时只取最后 1000 字符，让近期上下文优先。

/**
 * Flatten a message array into a single text string for Haiku title input.
 * Skips meta/non-human messages. Tail-slices to the last 1000 chars so
 * recent context wins when the conversation is long.
 */
// 把消息数组压平为单个文本串供 Haiku 生成标题；跳过元消息/非人消息，超长时截取尾部 1000 字符。
export function extractConversationText(messages: Message[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue
// 只保留 user 与 assistant 消息，跳过 system 等。
    if ('isMeta' in msg && msg.isMeta) continue
    if ('origin' in msg && msg.origin && msg.origin.kind !== 'human') continue
    const content = msg.message.content
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if ('type' in block && block.type === 'text' && 'text' in block) {
          parts.push(block.text as string)
        }
      }
    }
  }
  const text = parts.join('\n')
// 把各文本片段用换行拼接成一段。
  return text.length > MAX_CONVERSATION_TEXT
    ? text.slice(-MAX_CONVERSATION_TEXT)
    : text
}

const SESSION_TITLE_PROMPT = `Generate a concise, sentence-case title (3-7 words) that captures the main topic or goal of this coding session. The title should be clear enough that the user recognizes the session in a list. Use sentence case: capitalize only the first word and proper nouns.

Return JSON with a single "title" field.

Good examples:
{"title": "Fix login button on mobile"}
{"title": "Add OAuth authentication"}
{"title": "Debug failing CI tests"}
{"title": "Refactor API client error handling"}

Bad (too vague): {"title": "Code changes"}
Bad (too long): {"title": "Investigate and fix the issue where the login button does not respond on mobile devices"}
Bad (wrong case): {"title": "Fix Login Button On Mobile"}`
// 这是发给 Haiku 的标题提示词：要求生成三到七词的 sentence-case 标题，并给了好坏示例。

const titleSchema = lazySchema(() => z.object({ title: z.string() }))
// 用懒加载 schema 定义标题结构：只含一个 title 字符串字段。

/**
 * Generate a sentence-case session title from a description or first message.
 * Returns null on error or if Haiku returns an unparseable response.
 *
 * @param description - The user's first message or a description of the session
 * @param signal - Abort signal for cancellation
 */
// 从描述或首条消息生成 sentence-case 会话标题；出错或 Haiku 返回不可解析时返回 null。
export async function generateSessionTitle(
  description: string,
  signal: AbortSignal,
): Promise<string | null> {
// 参数 description 为用户的首条消息/描述，signal 用于取消。
  const trimmed = description.trim()
// 先 trim，空串直接返回 null，不浪费一次模型调用。
  if (!trimmed) return null

  try {
    const result = await queryHaiku({
      systemPrompt: asSystemPrompt([SESSION_TITLE_PROMPT]),
      userPrompt: trimmed,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      signal,
      options: {
        querySource: 'generate_session_title',
        agents: [],
        // Reflect the actual session mode — this module is called from
        // both the SDK print path (non-interactive) and the CCR remote
        // session path via useRemoteSession (interactive).
        isNonInteractiveSession: getIsNonInteractiveSession(),
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    })

    const text = extractTextContent(result.message.content)
// 取出 Haiku 返回的文本内容。

    const parsed = titleSchema().safeParse(safeParseJSON(text))
// 用 schema 安全解析，成功则 trim 后作为标题，否则回退 null。
    const title = parsed.success ? parsed.data.title.trim() || null : null

    logEvent('tengu_session_title_generated', { success: title !== null })
// 上报标题生成是否成功。

    return title
  } catch (error) {
// 异常时记日志并回退 null，不让标题生成中断会话建立。
    logForDebugging(`generateSessionTitle failed: ${error}`, {
      level: 'error',
    })
    logEvent('tengu_session_title_generated', { success: false })
    return null
  }
}
