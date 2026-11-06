// 远端权限桥接：为远端模式构造合成助理消息与工具桩
import { randomUUID } from 'crypto'
import type { SDKControlPermissionRequest } from '../entrypoints/sdk/controlTypes.js'
// 导入 randomUUID 生成消息唯一标识
import type { Tool } from '../Tool.js'
// 导入 SDKControlPermissionRequest 权限请求类型
import type { AssistantMessage } from '../types/message.js'
// 导入 Tool 工具接口类型
import { jsonStringify } from '../utils/slowOperations.js'
// 导入 AssistantMessage 助理消息类型

// 导入 jsonStringify 用于工具桩渲染
/**
 * Create a synthetic AssistantMessage for remote permission requests.
 * The ToolUseConfirm type requires an AssistantMessage, but in remote mode
 * we don't have a real one — the tool use runs on the CCR container.
 */
export function createSyntheticAssistantMessage(
// createSyntheticAssistantMessage：为远端权限请求造一个合成助理消息
  request: SDKControlPermissionRequest,
  requestId: string,
): AssistantMessage {
  return {
// 远端模式没有真实助理消息（工具调用跑在 CCR 容器），需合成
    type: 'assistant',
    uuid: randomUUID(),
    message: {
      id: `remote-${requestId}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: request.tool_use_id,
          name: request.tool_name,
          input: request.input,
        },
      ],
      model: '',
      stop_reason: null,
      stop_sequence: null,
      container: null,
      context_management: null,
      usage: {
// usage 全填 0（合成消息不计量真实消耗）
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as AssistantMessage['message'],
    requestId: undefined,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a minimal Tool stub for tools that aren't loaded locally.
 * This happens when the remote CCR has tools (e.g., MCP tools) that the
 * local CLI doesn't know about. The stub routes to FallbackPermissionRequest.
 */
export function createToolStub(toolName: string): Tool {
// createToolStub：为本端未加载的工具（如远端 MCP 工具）造最小桩
  return {
    name: toolName,
    inputSchema: {} as Tool['inputSchema'],
// 桩的 inputSchema 为空对象，isEnabled 恒真
    isEnabled: () => true,
    userFacingName: () => toolName,
    renderToolUseMessage: (input: Record<string, unknown>) => {
// renderToolUseMessage：最多取输入前 3 个键值对做简要渲染
      const entries = Object.entries(input)
      if (entries.length === 0) return ''
      return entries
        .slice(0, 3)
        .map(([key, value]) => {
          const valueStr =
            typeof value === 'string' ? value : jsonStringify(value)
          return `${key}: ${valueStr}`
        })
        .join(', ')
    },
    call: async () => ({ data: '' }),
// call 返回空数据，needsPermissions 恒真以走兜底权限请求
    description: async () => '',
    prompt: () => '',
    isReadOnly: () => false,
    isMcp: false,
    needsPermissions: () => true,
  } as unknown as Tool
}
