import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { isOutputLineTruncated } from '../../utils/terminal.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

// Allow any input object since MCP tools define their own schemas
export const inputSchema = lazySchema(() => z.object({}).passthrough())
// z.object({}).passthrough()：MCP 工具自带 schema，这里不校验形状、任何键都放行——校验责任在服务器端与 mcpClient 的拼接处。
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.string().describe('MCP tool execution result'),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Re-export MCPProgress from centralized types to break import cycles
export type { MCPProgress } from '../../types/tools.js'
// 从集中类型文件 re-export 是为了打断 import 环：UI.tsx 与 mcpClient 都从这里拿 MCPProgress，避免模块间直接互引。

export const MCPTool = buildTool({
  isMcp: true,
  // Overridden in mcpClient.ts with the real MCP tool name + args
// 这 77 行是个「模板工具」：name、description、prompt、call、userFacingName 全部标注 Overridden in mcpClient.ts——真正的工具对象是运行时按每个 MCP 服务器克隆此模板、再覆盖对应字段生成的。
  isOpenWorld() {
    return false
  },
  // Overridden in mcpClient.ts
  name: 'mcp',
  maxResultSizeChars: 100_000,
// 10 万字符是所有 MCP 工具的统一结果上限，防止某个服务器一次吐爆上下文。
  // Overridden in mcpClient.ts
  async description() {
    return DESCRIPTION
  },
  // Overridden in mcpClient.ts
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  // Overridden in mcpClient.ts
  async call() {
    return {
      data: '',
    }
  },
// checkPermissions 直接 passthrough：MCP 工具的权限判定走独立的 MCP 服务器级 allowlist 流程（在服务器连接配置里），不在这个模板里做。
  async checkPermissions(): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: 'MCPTool requires permission.',
    }
  },
  renderToolUseMessage,
  // Overridden in mcpClient.ts
  userFacingName: () => 'mcp',
  renderToolUseProgressMessage,
  renderToolResultMessage,
  isResultTruncated(output: Output): boolean {
    return isOutputLineTruncated(output)
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
