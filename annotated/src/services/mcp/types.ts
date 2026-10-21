import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  Resource,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

// Configuration schemas and types
export const ConfigScopeSchema = lazySchema(() =>
  z.enum([
    'local',
    'user',
    'project',
    'dynamic',
    'enterprise',
    'claudeai',
    'managed',
  ]),
)
export type ConfigScope = z.infer<ReturnType<typeof ConfigScopeSchema>>
// 七个 scope 回答的是「配置从哪来」，不是「配置长什么样」：
//   local / user / project 是三层文件（项目私有 / 全局 / 仓库共享）
//   dynamic 来自命令行，enterprise 由组织下发，claudeai 从远端拉，managed 是托管设备
//
// 同一个 server 名可以在多处出现，靠优先级合并。所以 scope 一定要跟着配置走 ——
// 后面所有「要不要信任它」的判断，第一件事都是看 scope。

export const TransportSchema = lazySchema(() =>
  z.enum(['stdio', 'sse', 'sse-ide', 'http', 'ws', 'sdk']),
)
export type Transport = z.infer<ReturnType<typeof TransportSchema>>
// 这个枚举和下面的 type 字面量**对不上**：有 sse-ide / sdk，但没有 ws-ide
// 和 claudeai-proxy。
//
// 而且它在整个仓库里没有任何读者（只有这两行自己引用自己）。
// 判定方法很简单：grep 符号名，只命中定义处。这是历史残留，可以跳过。

export const McpStdioServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('stdio').optional(), // Optional for backwards compatibility
    command: z.string().min(1, 'Command cannot be empty'),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
  }),
)

// Cross-App Access (XAA / SEP-990): just a per-server flag. IdP connection
// details (issuer, clientId, callbackPort) come from settings.xaaIdp — configured
// once, shared across all XAA-enabled servers. clientId/clientSecret (parent
// oauth config + keychain slot) are for the MCP server's AS.
const McpXaaConfigSchema = lazySchema(() => z.boolean())
// xaa 只是一个布尔：IdP 的连接细节（issuer、clientId、callbackPort）在全局
// settings.xaaIdp 里配一次，所有开了 xaa 的 server 共用。
//
// 这个设计把「企业 SSO 的复杂度」从 N 个 server 收到 1 处 —— 加一台新 server
// 不需要再走一次 IdP 注册。代价是那套全局配置成了新的单点，改它影响所有 server。

const McpOAuthConfigSchema = lazySchema(() =>
  z.object({
    clientId: z.string().optional(),
    callbackPort: z.number().int().positive().optional(),
    authServerMetadataUrl: z
      .string()
      .url()
      .startsWith('https://', {
        message: 'authServerMetadataUrl must use https://',
      })
      .optional(),
    xaa: McpXaaConfigSchema().optional(),
  }),
)

export const McpSSEServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('sse'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    headersHelper: z.string().optional(),
    oauth: McpOAuthConfigSchema().optional(),
  }),
)

// Internal-only server type for IDE extensions
export const McpSSEIDEServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('sse-ide'),
    url: z.string(),
    ideName: z.string(),
    ideRunningInWindows: z.boolean().optional(),
  }),
)

// Internal-only server type for IDE extensions
export const McpWebSocketIDEServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('ws-ide'),
    url: z.string(),
    ideName: z.string(),
    authToken: z.string().optional(),
    ideRunningInWindows: z.boolean().optional(),
  }),
)

export const McpHTTPServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    headersHelper: z.string().optional(),
    oauth: McpOAuthConfigSchema().optional(),
  }),
)

export const McpWebSocketServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('ws'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    headersHelper: z.string().optional(),
  }),
)

export const McpSdkServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('sdk'),
    name: z.string(),
  }),
)

// Config type for Claude.ai proxy servers
export const McpClaudeAIProxyServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('claudeai-proxy'),
    url: z.string(),
    id: z.string(),
  }),
)

export const McpServerConfigSchema = lazySchema(() =>
  z.union([
    McpStdioServerConfigSchema(),
    McpSSEServerConfigSchema(),
    McpSSEIDEServerConfigSchema(),
    McpWebSocketIDEServerConfigSchema(),
    McpHTTPServerConfigSchema(),
    McpWebSocketServerConfigSchema(),
    McpSdkServerConfigSchema(),
    McpClaudeAIProxyServerConfigSchema(),
  ]),
)
// union 是**按顺序**试的，两个后果：
//   · stdio 的 type 是 optional，所以一个不写 type 的对象会先命中 stdio
//   · 写错 type 值的对象会一路掉到底，报的是 union 错误（列出全部分支，很长）
//
// 所以看配置解析失败的错误信息时，别被那一长串分支吓到：真正的错因通常只是
// 「type 写错了」或「少了一个必填字段」。

export type McpStdioServerConfig = z.infer<
  ReturnType<typeof McpStdioServerConfigSchema>
>
export type McpSSEServerConfig = z.infer<
  ReturnType<typeof McpSSEServerConfigSchema>
>
export type McpSSEIDEServerConfig = z.infer<
  ReturnType<typeof McpSSEIDEServerConfigSchema>
>
export type McpWebSocketIDEServerConfig = z.infer<
  ReturnType<typeof McpWebSocketIDEServerConfigSchema>
>
export type McpHTTPServerConfig = z.infer<
  ReturnType<typeof McpHTTPServerConfigSchema>
>
export type McpWebSocketServerConfig = z.infer<
  ReturnType<typeof McpWebSocketServerConfigSchema>
>
export type McpSdkServerConfig = z.infer<
  ReturnType<typeof McpSdkServerConfigSchema>
>
export type McpClaudeAIProxyServerConfig = z.infer<
  ReturnType<typeof McpClaudeAIProxyServerConfigSchema>
>
export type McpServerConfig = z.infer<ReturnType<typeof McpServerConfigSchema>>

export type ScopedMcpServerConfig = McpServerConfig & {
  scope: ConfigScope
  // For plugin-provided servers: the providing plugin's LoadedPlugin.source
  // (e.g. 'slack@anthropic'). Stashed at config-build time so the channel
  // gate doesn't have to race AppState.plugins.enabled hydration.
  pluginSource?: string
}
// scope 挂在类型上、而不是塞进配置对象里，是因为它描述的是「出身」不是「内容」。
//
// 这条区分有具体后果：hashMcpConfig（utils.ts）必须把 scope 摘掉再算哈希，
// 否则「把同一个 server 从 .mcp.json 挪到 settings.json」会被判成配置变了、
// 白重连一次 —— 用户看到的是「改了个文件位置，所有工具抖了一下」。
//
// pluginSource 则相反，它是内容的一部分（决定能不能被通道闸放行），所以要参与哈希。

export const McpJsonConfigSchema = lazySchema(() =>
  z.object({
    mcpServers: z.record(z.string(), McpServerConfigSchema()),
  }),
)

export type McpJsonConfig = z.infer<ReturnType<typeof McpJsonConfigSchema>>

// Server connection types
export type ConnectedMCPServer = {
  client: Client
  name: string
  type: 'connected'
  capabilities: ServerCapabilities
  serverInfo?: {
    name: string
    version: string
  }
  instructions?: string
  config: ScopedMcpServerConfig
  cleanup: () => Promise<void>
}

export type FailedMCPServer = {
  name: string
  type: 'failed'
  config: ScopedMcpServerConfig
  error?: string
}

export type NeedsAuthMCPServer = {
  name: string
  type: 'needs-auth'
  config: ScopedMcpServerConfig
}

export type PendingMCPServer = {
  name: string
  type: 'pending'
  config: ScopedMcpServerConfig
  reconnectAttempt?: number
  maxReconnectAttempts?: number
}

export type DisabledMCPServer = {
  name: string
  type: 'disabled'
  config: ScopedMcpServerConfig
}

export type MCPServerConnection =
  | ConnectedMCPServer
  | FailedMCPServer
  | NeedsAuthMCPServer
  | PendingMCPServer
  | DisabledMCPServer

// Resource types
export type ServerResource = Resource & { server: string }

// MCP CLI State types
// 从这里往下三个 interface 在本仓库内是**死代码**：
// SerializedTool / SerializedClient 只被 MCPCliState 用到，而 MCPCliState 没人用。
//
// 形状明显是给「外部消费者读 CLI 的 MCP 状态」准备的（序列化过的，适合过 IPC），
// 但那条链路没接上。读的时候可以直接跳到文件末尾 ——
// 判断方法还是老一套：grep 符号名，只命中自身。
//
// 留着而不是删掉，通常是因为「不确定外部有没有人 import」——
// 这类犹豫在闭源仓库里很常见，在能全局 grep 的仓库里其实是可以确定的。
export interface SerializedTool {
  name: string
  description: string
  inputJSONSchema?: {
    [x: string]: unknown
    type: 'object'
    properties?: {
      [x: string]: unknown
    }
  }
  isMcp?: boolean
  originalToolName?: string // Original unnormalized tool name from MCP server
}

export interface SerializedClient {
  name: string
  type: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  capabilities?: ServerCapabilities
}

export interface MCPCliState {
  clients: SerializedClient[]
  configs: Record<string, ScopedMcpServerConfig>
  tools: SerializedTool[]
  resources: Record<string, ServerResource[]>
  normalizedNames?: Record<string, string> // Maps normalized names to original names
}
