import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs'
import type { Tools } from '../Tool.js'
import type {
  GroupedToolUseMessage,
  NormalizedAssistantMessage,
  NormalizedMessage,
  NormalizedUserMessage,
  ProgressMessage,
  RenderableMessage,
} from '../types/message.js'

export type MessageWithoutProgress = Exclude<NormalizedMessage, ProgressMessage>
// MessageWithoutProgress 从归一化消息里剔除进度消息，保证分组只处理真正可渲染的内容。

export type GroupingResult = {
  messages: RenderableMessage[]
}
// GroupingResult 仅包含渲染用的消息数组，分组后的消息会被合并成一条 grouped_tool_use。

// Cache the set of tool names that support grouped rendering, keyed by the
// tools array reference. The tools array is stable across renders (only
// replaced on MCP connect/disconnect), so this avoids rebuilding the set on
// every call. WeakMap lets old entries be GC'd when the array is replaced.
const GROUPING_CACHE = new WeakMap<Tools, Set<string>>()
// 用 WeakMap 以 tools 数组引用为键缓存「支持分组渲染的工具名集合」，
// tools 数组稳定时免去每次重建，旧数组被回收时缓存也随之释放。

function getToolsWithGrouping(tools: Tools): Set<string> {
  let cached = GROUPING_CACHE.get(tools)
  if (!cached) {
    cached = new Set(tools.filter(t => t.renderGroupedToolUse).map(t => t.name))
    GROUPING_CACHE.set(tools, cached)
  }
  return cached
}
// getToolUseInfo 从助手消息里抽取工具调用的消息编号、工具调用编号与工具名，
// 非工具调用消息直接返回空，作为后续分组判断的基础。

function getToolUseInfo(
  msg: MessageWithoutProgress,
): { messageId: string; toolUseId: string; toolName: string } | null {
  if (msg.type === 'assistant' && msg.message.content[0]?.type === 'tool_use') {
    const content = msg.message.content[0]
    return {
      messageId: msg.message.id,
      toolUseId: content.id,
      toolName: content.name,
    }
  }
  return null
}

/**
 * Groups tool uses by message.id (same API response) if the tool supports grouped rendering.
 * Only groups 2+ tools of the same type from the same message.
 * Also collects corresponding tool_results and attaches them to the grouped message.
 * When verbose is true, skips grouping so messages render at original positions.
 */
export function applyGrouping(
// applyGrouping 是分组入口：verbose 模式下不做任何分组，消息保持原位置渲染；
// 否则按消息编号加工具名把同一条响应里的多个同类工具调用聚到一起。
  messages: MessageWithoutProgress[],
  tools: Tools,
  verbose: boolean = false,
): GroupingResult {
  // In verbose mode, don't group - each message renders at its original position
  if (verbose) {
    return {
      messages: messages,
    }
  }
  const toolsWithGrouping = getToolsWithGrouping(tools)

  // First pass: group tool uses by message.id + tool name
  const groups = new Map<
    string,
    NormalizedAssistantMessage<BetaToolUseBlock>[]
  >()

// 第一轮扫描把每个工具调用按其消息编号与工具名聚合到 groups，
// 同一键下出现两个及以上才视为有效组。
  for (const msg of messages) {
    const info = getToolUseInfo(msg)
    if (info && toolsWithGrouping.has(info.toolName)) {
      const key = `${info.messageId}:${info.toolName}`
      const group = groups.get(key) ?? []
      group.push(msg as NormalizedAssistantMessage<BetaToolUseBlock>)
      groups.set(key, group)
    }
  }

  // Identify valid groups (2+ items) and collect their tool use IDs
  const validGroups = new Map<
    string,
    NormalizedAssistantMessage<BetaToolUseBlock>[]
  >()
  const groupedToolUseIds = new Set<string>()
// validGroups 收集数量达到两件的组，同时把组内所有工具调用编号登记到 groupedToolUseIds，
// 供后续回收对应的工具结果消息。

  for (const [key, group] of groups) {
    if (group.length >= 2) {
      validGroups.set(key, group)
      for (const msg of group) {
        const info = getToolUseInfo(msg)
        if (info) {
          groupedToolUseIds.add(info.toolUseId)
        }
      }
    }
  }

  // Collect result messages for grouped tool_uses
  // Map from tool_use_id to the user message containing that result
  const resultsByToolUseId = new Map<string, NormalizedUserMessage>()
// resultsByToolUseId 建立从工具调用编号到携带该结果的用户消息的映射，
// 分组时把对应结果一并挂到 grouped 消息上。

  for (const msg of messages) {
    if (msg.type === 'user') {
      for (const content of msg.message.content) {
        if (
          content.type === 'tool_result' &&
          groupedToolUseIds.has(content.tool_use_id)
        ) {
          resultsByToolUseId.set(content.tool_use_id, msg)
        }
      }
    }
  }

  // Second pass: build output, emitting each group only once
// 第二轮扫描重建输出顺序：每个有效组只输出一次合并消息，
// 其余零散消息与未被分组的用户消息按原序追加。
  const result: RenderableMessage[] = []
  const emittedGroups = new Set<string>()

  for (const msg of messages) {
    const info = getToolUseInfo(msg)

    if (info) {
      const key = `${info.messageId}:${info.toolName}`
      const group = validGroups.get(key)

      if (group) {
        if (!emittedGroups.has(key)) {
          emittedGroups.add(key)
          const firstMsg = group[0]!

          // Collect results for this group
          const results: NormalizedUserMessage[] = []
          for (const assistantMsg of group) {
            const toolUseId = (
              assistantMsg.message.content[0] as { id: string }
            ).id
            const resultMsg = resultsByToolUseId.get(toolUseId)
            if (resultMsg) {
              results.push(resultMsg)
            }
          }

          const groupedMessage: GroupedToolUseMessage = {
            type: 'grouped_tool_use',
            toolName: info.toolName,
            messages: group,
            results,
            displayMessage: firstMsg,
            uuid: `grouped-${firstMsg.uuid}`,
            timestamp: firstMsg.timestamp,
            messageId: info.messageId,
          }
          result.push(groupedMessage)
        }
        continue
      }
    }

    // Skip user messages whose tool_results are all grouped
    if (msg.type === 'user') {
// 对工具结果已全部被分组的用户消息直接跳过，避免分组后的结果重复出现。
      const toolResults = msg.message.content.filter(
        (c): c is ToolResultBlockParam => c.type === 'tool_result',
      )
      if (toolResults.length > 0) {
        const allGrouped = toolResults.every(tr =>
          groupedToolUseIds.has(tr.tool_use_id),
        )
        if (allGrouped) {
          continue
        }
      }
    }

    result.push(msg)
  }

  return { messages: result }
}
// applyGrouping 返回最终可渲染消息数组：分组消息携带其原始子消息与结果，
// 非分组消息原样保留，从而保证界面既紧凑又不丢信息。
