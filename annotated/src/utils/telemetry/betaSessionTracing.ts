/**
 * Beta Session Tracing for Claude Code
 *
 * This module contains beta tracing features enabled when
 * ENABLE_BETA_TRACING_DETAILED=1 and BETA_TRACING_ENDPOINT are set.
 *
 * For external users, tracing is enabled in SDK/headless mode, or in
 * interactive mode when the org is allowlisted via the
 * tengu_trace_lantern GrowthBook gate.
 * For ant users, tracing is enabled in all modes.
 *
 * Visibility Rules:
 * | Content          | External | Ant  |
 * |------------------|----------|------|
 * | System prompts   | ✅                  | ✅   |
 * | Model output     | ✅                  | ✅   |
 * | Thinking output  | ❌                  | ✅   |
 * | Tools            | ✅                  | ✅   |
 * | new_context      | ✅                  | ✅   |
 *
 * Features:
 * - Per-agent message tracking with hash-based deduplication
 * - System prompt logging (once per unique hash)
 * - Hook execution spans
 * - Detailed new_context attributes for LLM requests
 */
// 文件级摘要：Beta 会话追踪模块，在开启详细追踪时把系统提示、消息、模型输出等按可见性规则上报到 OpenTelemetry 与 Honeycomb。

import type { Span } from '@opentelemetry/api'
import { createHash } from 'crypto'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import { isEnvTruthy } from '../envUtils.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { logOTelEvent } from './events.js'

// Message type for API calls (UserMessage or AssistantMessage)
// `APIMessage` 类型限定为用户消息或助手消息，是追踪内容的最小单元。
type APIMessage = UserMessage | AssistantMessage

/**
 * Track hashes we've already logged this session (system prompts, tools, etc).
 *
 * WHY: System prompts and tool schemas are large and rarely change within a session.
 * Sending full content on every request would be wasteful. Instead, we hash and
 * only log the full content once per unique hash.
 */
const seenHashes = new Set<string>()
// `seenHashes` 记录本会话已上报过的哈希（系统提示、工具等），大内容只上报一次，避免重复刷屏。

/**
 * Track the last reported message hash per querySource (agent) for incremental context.
 *
 * WHY: When debugging traces, we want to see what NEW information was added each turn,
 * not the entire conversation history (which can be huge). By tracking the last message
 * we reported per agent, we can compute and send only the delta (new messages since
 * the last request). This is tracked per-agent (querySource) because different agents
 * (main thread, subagents, warmup requests) have independent conversation contexts.
 */
const lastReportedMessageHash = new Map<string, string>()
// `lastReportedMessageHash` 按每个 agent（querySource）记录上一次上报的消息哈希，用于增量上报差值。

/**
 * Clear tracking state after compaction.
 * Old hashes are irrelevant once messages have been replaced.
 */
export function clearBetaTracingState(): void {
  seenHashes.clear()
  lastReportedMessageHash.clear()
}

const MAX_CONTENT_SIZE = 60 * 1024 // 60KB (Honeycomb limit is 64KB, staying safe)
// `MAX_CONTENT_SIZE` 为 60KB，留一点余量给 Honeycomb 的 64KB 上限。

/**
 * Check if beta detailed tracing is enabled.
 * - Requires ENABLE_BETA_TRACING_DETAILED=1 and BETA_TRACING_ENDPOINT
 * - For external users, enabled in SDK/headless mode OR when org is
 *   allowlisted via the tengu_trace_lantern GrowthBook gate
 */
// `isBetaTracingEnabled`：需同时开启环境变量且对非 ant 用户额外要求 SDK 模式或被组织灰度放行。
export function isBetaTracingEnabled(): boolean {
  const baseEnabled =
    isEnvTruthy(process.env.ENABLE_BETA_TRACING_DETAILED) &&
    Boolean(process.env.BETA_TRACING_ENDPOINT)

  if (!baseEnabled) {
    return false
  }

  // For external users, enable in SDK/headless mode OR when org is allowlisted.
  // Gate reads from disk cache, so first run after allowlisting returns false;
  // works from second run onward (same behavior as enhanced_telemetry_beta).
  if (process.env.USER_TYPE !== 'ant') {
    return (
      getIsNonInteractiveSession() ||
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_trace_lantern', false)
    )
  }

  return true
}

/**
 * Truncate content to fit within Honeycomb limits.
 */
// `truncateContent`：把内容截断到 60KB 以内，超过则追加提示并标记 truncated。
export function truncateContent(
  content: string,
  maxSize: number = MAX_CONTENT_SIZE,
): { content: string; truncated: boolean } {
  if (content.length <= maxSize) {
    return { content, truncated: false }
  }

  return {
    content:
      content.slice(0, maxSize) +
      '\n\n[TRUNCATED - Content exceeds 60KB limit]',
    truncated: true,
  }
}

/**
 * Generate a short hash (first 12 hex chars of SHA-256).
 */
function shortHash(content: string): string {
// `shortHash` 取 SHA-256 前 12 位十六进制作为内容指纹。
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

/**
 * Generate a hash for a system prompt.
 */
function hashSystemPrompt(systemPrompt: string): string {
  return `sp_${shortHash(systemPrompt)}`
}

/**
 * Generate a hash for a message based on its content.
 */
function hashMessage(message: APIMessage): string {
  const content = jsonStringify(message.message.content)
  return `msg_${shortHash(content)}`
}

// Regex to detect content wrapped in <system-reminder> tags
const SYSTEM_REMINDER_REGEX =
  /^<system-reminder>\n?([\s\S]*?)\n?<\/system-reminder>$/

/**
 * Check if text is entirely a system reminder (wrapped in <system-reminder> tags).
 * Returns the inner content if it is, null otherwise.
 */
function extractSystemReminderContent(text: string): string | null {
// `extractSystemReminderContent`：识别被 `<system-reminder>` 包裹的文本，把它从普通上下文里单独拎出来。
  const match = text.trim().match(SYSTEM_REMINDER_REGEX)
  return match && match[1] ? match[1].trim() : null
}

/**
 * Result of formatting messages - separates regular content from system reminders.
 */
interface FormattedMessages {
  contextParts: string[]
  systemReminders: string[]
}

/**
 * Format user messages for new_context display, separating system reminders.
 * Only handles user messages (assistant messages are filtered out before this is called).
 */
// `formatMessagesForContext`：把用户消息拆成普通上下文片段与系统提醒两类，前者可见、后者单独上报。
function formatMessagesForContext(messages: UserMessage[]): FormattedMessages {
  const contextParts: string[] = []
  const systemReminders: string[] = []

  for (const message of messages) {
    const content = message.message.content
    if (typeof content === 'string') {
      const reminderContent = extractSystemReminderContent(content)
      if (reminderContent) {
        systemReminders.push(reminderContent)
      } else {
        contextParts.push(`[USER]\n${content}`)
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') {
          const reminderContent = extractSystemReminderContent(block.text)
          if (reminderContent) {
            systemReminders.push(reminderContent)
          } else {
            contextParts.push(`[USER]\n${block.text}`)
          }
        } else if (block.type === 'tool_result') {
          const resultContent =
            typeof block.content === 'string'
              ? block.content
              : jsonStringify(block.content)
          // Tool results can also contain system reminders (e.g., malware warning)
          const reminderContent = extractSystemReminderContent(resultContent)
          if (reminderContent) {
            systemReminders.push(reminderContent)
          } else {
            contextParts.push(
              `[TOOL RESULT: ${block.tool_use_id}]\n${resultContent}`,
            )
          }
        }
      }
    }
  }

  return { contextParts, systemReminders }
}

export interface LLMRequestNewContext {
// `LLMRequestNewContext` 接口描述一次 LLM 请求附带的新上下文：系统提示、来源 agent、工具 schema。
  /** System prompt (typically only on first request or if changed) */
  systemPrompt?: string
  /** Query source identifying the agent/purpose (e.g., 'repl_main_thread', 'agent:builtin') */
  querySource?: string
  /** Tool schemas sent with the request */
  tools?: string
}

/**
 * Add beta attributes to an interaction span.
 * Adds new_context with the user prompt.
 */
// `addBetaInteractionAttributes`：给交互 span 加 `new_context`（用户提示），开启追踪才生效。
export function addBetaInteractionAttributes(
  span: Span,
  userPrompt: string,
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const { content: truncatedPrompt, truncated } = truncateContent(
    `[USER PROMPT]\n${userPrompt}`,
  )
  span.setAttributes({
    new_context: truncatedPrompt,
    ...(truncated && {
      new_context_truncated: true,
      new_context_original_length: userPrompt.length,
    }),
  })
}

/**
 * Add beta attributes to an LLM request span.
 * Handles system prompt logging and new_context computation.
 */
// `addBetaLLMRequestAttributes`：处理系统提示与 new_context 的上报，核心是把大内容按哈希去重。
export function addBetaLLMRequestAttributes(
  span: Span,
  newContext?: LLMRequestNewContext,
  messagesForAPI?: APIMessage[],
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  // Add system prompt info to the span
  if (newContext?.systemPrompt) {
    const promptHash = hashSystemPrompt(newContext.systemPrompt)
    const preview = newContext.systemPrompt.slice(0, 500)

    // Always add hash, preview, and length to the span
    span.setAttribute('system_prompt_hash', promptHash)
    span.setAttribute('system_prompt_preview', preview)
    span.setAttribute('system_prompt_length', newContext.systemPrompt.length)

    // Log the full system prompt only once per unique hash this session
    if (!seenHashes.has(promptHash)) {
// 系统提示按哈希去重：同一份只完整上报一次，后续仅附带哈希、预览与长度。
      seenHashes.add(promptHash)

      // Truncate for the log if needed
      const { content: truncatedPrompt, truncated } = truncateContent(
        newContext.systemPrompt,
      )

      void logOTelEvent('system_prompt', {
        system_prompt_hash: promptHash,
        system_prompt: truncatedPrompt,
        system_prompt_length: String(newContext.systemPrompt.length),
        ...(truncated && { system_prompt_truncated: 'true' }),
      })
    }
  }

  // Add tools info to the span
  if (newContext?.tools) {
// 工具 schema 也按哈希去重上报，span 上只留名字与哈希对，完整描述仅在首次出现时记录。
    try {
      const toolsArray = jsonParse(newContext.tools) as Record<
        string,
        unknown
      >[]

      // Build array of {name, hash} for each tool
      const toolsWithHashes = toolsArray.map(tool => {
        const toolJson = jsonStringify(tool)
        const toolHash = shortHash(toolJson)
        return {
          name: typeof tool.name === 'string' ? tool.name : 'unknown',
          hash: toolHash,
          json: toolJson,
        }
      })

      // Set span attribute with array of name/hash pairs
      span.setAttribute(
        'tools',
        jsonStringify(
          toolsWithHashes.map(({ name, hash }) => ({ name, hash })),
        ),
      )
      span.setAttribute('tools_count', toolsWithHashes.length)

      // Log each tool's full description once per unique hash
      for (const { name, hash, json } of toolsWithHashes) {
        if (!seenHashes.has(`tool_${hash}`)) {
          seenHashes.add(`tool_${hash}`)

          const { content: truncatedTool, truncated } = truncateContent(json)

          void logOTelEvent('tool', {
            tool_name: sanitizeToolNameForAnalytics(name),
            tool_hash: hash,
            tool: truncatedTool,
            ...(truncated && { tool_truncated: 'true' }),
          })
        }
      }
    } catch {
      // If parsing fails, log the raw tools string
      span.setAttribute('tools_parse_error', true)
    }
  }

  // Add new_context using hash-based tracking (visible to all users)
  if (messagesForAPI && messagesForAPI.length > 0 && newContext?.querySource) {
// new_context 用「上次上报哈希」定位增量起点，只发送新增的用户输入与工具结果，省带宽。
    const querySource = newContext.querySource
    const lastHash = lastReportedMessageHash.get(querySource)

    // Find where the last reported message is in the array
    let startIndex = 0
    if (lastHash) {
      for (let i = 0; i < messagesForAPI.length; i++) {
        const msg = messagesForAPI[i]
        if (msg && hashMessage(msg) === lastHash) {
          startIndex = i + 1 // Start after the last reported message
          break
        }
      }
      // If lastHash not found, startIndex stays 0 (send everything)
    }

    // Get new messages (filter out assistant messages - we only want user input/tool results)
    const newMessages = messagesForAPI
      .slice(startIndex)
      .filter((m): m is UserMessage => m.type === 'user')

    if (newMessages.length > 0) {
      // Format new messages, separating system reminders from regular content
      const { contextParts, systemReminders } =
        formatMessagesForContext(newMessages)

      // Set new_context (regular user content and tool results)
      if (contextParts.length > 0) {
        const fullContext = contextParts.join('\n\n---\n\n')
        const { content: truncatedContext, truncated } =
          truncateContent(fullContext)

        span.setAttributes({
          new_context: truncatedContext,
          new_context_message_count: newMessages.length,
          ...(truncated && {
            new_context_truncated: true,
            new_context_original_length: fullContext.length,
          }),
        })
      }

      // Set system_reminders as a separate attribute
      if (systemReminders.length > 0) {
        const fullReminders = systemReminders.join('\n\n---\n\n')
        const { content: truncatedReminders, truncated: remindersTruncated } =
          truncateContent(fullReminders)

        span.setAttributes({
          system_reminders: truncatedReminders,
          system_reminders_count: systemReminders.length,
          ...(remindersTruncated && {
            system_reminders_truncated: true,
            system_reminders_original_length: fullReminders.length,
          }),
        })
      }

      // Update last reported hash to the last message in the array
      const lastMessage = messagesForAPI[messagesForAPI.length - 1]
      if (lastMessage) {
        lastReportedMessageHash.set(querySource, hashMessage(lastMessage))
      }
    }
  }
}

/**
 * Add beta attributes to endLLMRequestSpan.
 * Handles model_output and thinking_output truncation.
 */
// `addBetaLLMResponseAttributes`：处理模型输出与思考输出，思考输出仅 ant 内部可见。
export function addBetaLLMResponseAttributes(
  endAttributes: Record<string, string | number | boolean>,
  metadata?: {
    modelOutput?: string
    thinkingOutput?: string
  },
): void {
  if (!isBetaTracingEnabled() || !metadata) {
    return
  }

  // Add model_output (text content) - visible to all users
  if (metadata.modelOutput !== undefined) {
    const { content: modelOutput, truncated: outputTruncated } =
      truncateContent(metadata.modelOutput)
    endAttributes['response.model_output'] = modelOutput
    if (outputTruncated) {
      endAttributes['response.model_output_truncated'] = true
      endAttributes['response.model_output_original_length'] =
        metadata.modelOutput.length
    }
  }

  // Add thinking_output - ant-only
// 思考输出（thinking）按可见性规则只对 ant 用户上报，外部用户看不到。
  if (
    process.env.USER_TYPE === 'ant' &&
    metadata.thinkingOutput !== undefined
  ) {
    const { content: thinkingOutput, truncated: thinkingTruncated } =
      truncateContent(metadata.thinkingOutput)
    endAttributes['response.thinking_output'] = thinkingOutput
    if (thinkingTruncated) {
      endAttributes['response.thinking_output_truncated'] = true
      endAttributes['response.thinking_output_original_length'] =
        metadata.thinkingOutput.length
    }
  }
}

/**
 * Add beta attributes to startToolSpan.
 * Adds tool_input with the serialized tool input.
 */
// `addBetaToolInputAttributes`：给工具 span 加序列化后的工具输入，同样先截断。
export function addBetaToolInputAttributes(
  span: Span,
  toolName: string,
  toolInput: string,
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const { content: truncatedInput, truncated } = truncateContent(
    `[TOOL INPUT: ${toolName}]\n${toolInput}`,
  )
  span.setAttributes({
    tool_input: truncatedInput,
    ...(truncated && {
      tool_input_truncated: true,
      tool_input_original_length: toolInput.length,
    }),
  })
}

/**
 * Add beta attributes to endToolSpan.
 * Adds new_context with the tool result.
 */
// `addBetaToolResultAttributes`：给工具结束 span 加工具结果作为 `new_context`，供追踪回看。
export function addBetaToolResultAttributes(
  endAttributes: Record<string, string | number | boolean>,
  toolName: string | number | boolean,
  toolResult: string,
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const { content: truncatedResult, truncated } = truncateContent(
    `[TOOL RESULT: ${toolName}]\n${toolResult}`,
  )
  endAttributes['new_context'] = truncatedResult
  if (truncated) {
    endAttributes['new_context_truncated'] = true
    endAttributes['new_context_original_length'] = toolResult.length
  }
}
