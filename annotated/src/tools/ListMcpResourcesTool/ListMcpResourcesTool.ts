import { z } from 'zod/v4'
import {
  ensureConnectedClient,
  fetchResourcesForClient,
} from '../../services/mcp/client.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { errorMessage } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logMCPError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { isOutputLineTruncated } from '../../utils/terminal.js'
import { DESCRIPTION, LIST_MCP_RESOURCES_TOOL_NAME, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

// inputSchema 只有一个可选 server 过滤参数——不传就是全服务器罗列。
const inputSchema = lazySchema(() =>
  z.object({
    server: z
      .string()
      .optional()
      .describe('Optional server name to filter resources by'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.array(
    z.object({
      uri: z.string().describe('Resource URI'),
      name: z.string().describe('Resource name'),
      mimeType: z.string().optional().describe('MIME type of the resource'),
      description: z.string().optional().describe('Resource description'),
      server: z.string().describe('Server that provides this resource'),
    }),
  ),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// ListMcpResourcesTool：罗列已连 MCP 服务器的资源。资源（resources）与工具（tools）是 MCP 的两套能力面，这个工具只扫前者。
export const ListMcpResourcesTool = buildTool({
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
// isConcurrencySafe + isReadOnly 双真：纯读、可并行——多个资源列举可以同时跑，不互相挡。
  toAutoClassifierInput(input) {
    return input.server ?? ''
  },
  shouldDefer: true,
  name: LIST_MCP_RESOURCES_TOOL_NAME,
  searchHint: 'list resources from connected MCP servers',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
// call() 从 options.mcpClients 拿连接池。
  async call(input, { options: { mcpClients } }) {
    const { server: targetServer } = input

// 指定了 server 就按名字过滤；过滤完是空的直接抛错并附上可用服务器名单——模型写错服务器名时一次就能自纠。
    const clientsToProcess = targetServer
      ? mcpClients.filter(client => client.name === targetServer)
      : mcpClients

    if (targetServer && clientsToProcess.length === 0) {
      throw new Error(
        `Server "${targetServer}" not found. Available servers: ${mcpClients.map(c => c.name).join(', ')}`,
      )
    }

    // fetchResourcesForClient is LRU-cached (by server name) and already
    // warm from startup prefetch. Cache is invalidated on onclose and on
    // resources/list_changed notifications, so results are never stale.
    // ensureConnectedClient is a no-op when healthy (memoize hit), but after
    // onclose it returns a fresh connection so the re-fetch succeeds.
// 这段注释是三层缓存/重连策略的说明：fetchResourcesForClient 按服务器名 LRU 缓存且启动预热；onclose 和 resources/list_changed 通知会失效缓存，所以结果不会过期；ensureConnectedClient 健康时是 memoize 命中（零成本），掉线后返回新连接让重捞成功。
// Promise.all 并行捞所有服务器，但**单个服务器重连失败不许拖垮整体**——try/catch 里 logMCPError 记一笔后返回空数组，其余服务器的结果照常返回。多服务器场景的默认姿态：部分失败降级为部分结果。
    const results = await Promise.all(
      clientsToProcess.map(async client => {
        if (client.type !== 'connected') return []
        try {
          const fresh = await ensureConnectedClient(client)
          return await fetchResourcesForClient(fresh)
        } catch (error) {
          // One server's reconnect failure shouldn't sink the whole result.
          logMCPError(client.name, errorMessage(error))
          return []
        }
      }),
    )

    return {
      data: results.flat(),
    }
  },
  renderToolUseMessage,
  userFacingName: () => 'listMcpResources',
  renderToolResultMessage,
// isResultTruncated：序列化后按行数判截断（isOutputLineTruncated），与 tool_result 的呈现口径一致。
  isResultTruncated(output: Output): boolean {
    return isOutputLineTruncated(jsonStringify(output))
  },
// 空结果不返回空 content——换成一句人话「没有资源，但服务器可能仍有工具」：防止模型把「零资源」解读成「服务器没用」而错失工具面。
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    if (!content || content.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content:
          'No resources found. MCP servers may still provide tools even if they have no resources.',
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
