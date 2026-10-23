import type {
  AssistantMessage,
  AttachmentMessage,
  SystemMessage,
  UserMessage,
} from 'src/types/message.js'
// 只引类型不引值——编译期全部擦除，这个文件在 bundle 里只剩两个函数体。

/**
 * Tags user messages with a sourceToolUseID so they stay transient until the tool resolves.
 * This prevents the "is running" message from being duplicated in the UI.
 */
export function tagMessagesWithToolUseID(
  messages: (UserMessage | AttachmentMessage | SystemMessage)[],
  toolUseID: string | undefined,
): (UserMessage | AttachmentMessage | SystemMessage)[] {
// tagMessagesWithToolUseID：给用户消息盖上 sourceToolUseID 标签，让它们在工具 resolving 前保持「瞬时」状态，UI 里的「运行中」占位不会重复渲染。
  if (!toolUseID) {
    return messages
  }
// toolUseID 为空（非工具上下文）时原样返回——不打无标签的标。
  return messages.map(m => {
    if (m.type === 'user') {
      return { ...m, sourceToolUseID: toolUseID }
    }
    return m
  })
// map 只处理 type === 'user'：attachment 和 system 消息不参与打标签，原样透传。
}

/**
 * Extracts the tool use ID from a parent message for a given tool name.
 */
export function getToolUseIDFromParentMessage(
  parentMessage: AssistantMessage,
  toolName: string,
): string | undefined {
// getToolUseIDFromParentMessage：从父助手消息里按工具名反查 tool_use 块，拿它的 id。
  const toolUseBlock = parentMessage.message.content.find(
    block => block.type === 'tool_use' && block.name === toolName,
  )
  return toolUseBlock && toolUseBlock.type === 'tool_use'
    ? toolUseBlock.id
    : undefined
// 双重窄化：先判存在再判 type==='tool_use'，TS 才肯让取 .id——窄化失败返回 undefined，调用方自行兜底。
}
