import {
  type ReadResourceResult,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { ensureConnectedClient } from '../../services/mcp/client.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getBinaryBlobSavedMessage,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { isOutputLineTruncated } from '../../utils/terminal.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

// inputSchema：server + uri 双必填——MCP 资源寻址是「哪台服务器的哪个 URI」，少一个都定位不了。
export const inputSchema = lazySchema(() =>
  z.object({
    server: z.string().describe('The MCP server name'),
    uri: z.string().describe('The resource URI to read'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    contents: z.array(
      z.object({
        uri: z.string().describe('Resource URI'),
        mimeType: z.string().optional().describe('MIME type of the content'),
        text: z.string().optional().describe('Text content of the resource'),
        blobSavedTo: z
          .string()
          .optional()
          .describe('Path where binary blob content was saved'),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// ReadMcpResourceTool：按 URI 读一个资源。与 ListMcpResourcesTool 成对（先列举后读取），同样双只读标志。
export const ReadMcpResourceTool = buildTool({
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
// 这两个方法标志本工具**可并行、纯只读**——读资源不碰本地状态，多个读取调用可以同时跑。
  toAutoClassifierInput(input) {
    return `${input.server} ${input.uri}`
  },
  shouldDefer: true,
  name: 'ReadMcpResourceTool',
  searchHint: 'read a specific MCP resource by URI',
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
// call() 主流程。
  async call(input, { options: { mcpClients } }) {
    const { server: serverName, uri } = input

// 三步前置检查之一：服务器存在吗。不存在就抛错附名单（同 List 工具的自纠式报错）。
    const client = mcpClients.find(client => client.name === serverName)

    if (!client) {
      throw new Error(
        `Server "${serverName}" not found. Available servers: ${mcpClients.map(c => c.name).join(', ')}`,
      )
    }

// 之二：连上了吗。
    if (client.type !== 'connected') {
      throw new Error(`Server "${serverName}" is not connected`)
    }

// 之三：这台服务器声明了 resources 能力吗—— capabilities?.resources 是 MCP 握手时服务器自报的能力位，没报就是没有，读了也白读。
    if (!client.capabilities?.resources) {
      throw new Error(`Server "${serverName}" does not support resources`)
    }

    const connectedClient = await ensureConnectedClient(client)
    const result = (await connectedClient.client.request(
      {
        method: 'resources/read',
        params: { uri },
      },
      ReadResourceResultSchema,
    )) as ReadResourceResult

    // Intercept any blob fields: decode, write raw bytes to disk with a
    // mime-derived extension, and replace with a path. Otherwise the base64
    // would be stringified straight into the context.
// blob 拦截的设计动机：base64 原样进 context 是灾难——一张图的 base64 能烧掉几万 token。这里解码后把原始字节按 mime 推断扩展名落盘，content 里只留路径。
// 逐条 content 分流：text 原样带回；blob 落盘换路径；两者都不是就只回 uri+mimeType 空壳。
    const contents = await Promise.all(
      result.contents.map(async (c, i) => {
        if ('text' in c) {
          return { uri: c.uri, mimeType: c.mimeType, text: c.text }
        }
        if (!('blob' in c) || typeof c.blob !== 'string') {
          return { uri: c.uri, mimeType: c.mimeType }
        }
// persistId 用时间戳 + 索引 + 随机串拼，保证同一批次多条 blob 不互相覆盖。
        const persistId = `mcp-resource-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`
        const persisted = await persistBinaryContent(
          Buffer.from(c.blob, 'base64'),
          c.mimeType,
          persistId,
        )
        if ('error' in persisted) {
          return {
            uri: c.uri,
            mimeType: c.mimeType,
            text: `Binary content could not be saved to disk: ${persisted.error}`,
          }
        }
        return {
          uri: c.uri,
          mimeType: c.mimeType,
          blobSavedTo: persisted.filepath,
          text: getBinaryBlobSavedMessage(
            persisted.filepath,
            c.mimeType,
            persisted.size,
            `[Resource from ${serverName} at ${c.uri}] `,
          ),
        }
      }),
    )

    return {
      data: { contents },
    }
  },
  renderToolUseMessage,
  userFacingName,
  renderToolResultMessage,
// 截断判定与 List 工具同一套口径：序列化后按行数判断是否超限。
  isResultTruncated(output: Output): boolean {
    return isOutputLineTruncated(jsonStringify(output))
  },
// tool_result 直接序列化 contents——落盘后的 content 已经是「路径 + 一句说明」的轻量形态，可以安全进 context。
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
