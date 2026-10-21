// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 7/N —— MCP 接入的全部实现（src/services/mcp/client.ts）
//
// 3,348 行。这是整份源码里第二长的单文件（最长是 claude.ts 3,419）。
//
// 【行号口径】下面所有批注里写的「第 N 行」「N 行」，一律指
// **source/src/services/mcp/client.ts 的原始行号**，不是本批注版的行号
// （批注版插入了 1,400 多行注释，行号整体后移）。
// 想核对某个行号时，请打开 source/ 下的原文。
//
// 【MCP 是什么，为什么要这么长】
//
// Model Context Protocol：让**外部进程或服务**把自己实现的工具、资源、
// 提示词模板暴露给模型。一个 MCP 服务器可以是你本机的一条命令（stdio）、
// 一个 HTTP 服务、一个 WebSocket、IDE 插件，或者 claude.ai 那边的托管连接器。
//
// 它长，是因为要把「七种传输方式 × 四种连接状态 × 三类能力」全部收进
// 一套接口。而且每种传输的失败模式都不一样：
//   · stdio  → 子进程可能不退出、可能需要真信号（SIGINT/SIGTERM/SIGKILL）
//   · SSE    → 长连接可能断、SDK 会自己重连但重连耗尽后不通知你
//   · HTTP   → session 会过期（404 + JSON-RPC -32001）
//   · OAuth  → token 会过期、并发 401 会互相踩
//
// 【五个层次，按调用顺序】
//
//   ① 连接      connectToServer（595-1641，1,046 行）—— 七种 transport 分支
//   ② 发现      fetchToolsForClient / fetchResourcesForClient / fetchCommandsForClient
//   ③ 封装      把 MCP 的工具描述转成内部的 Tool 对象（1766-1989）
//   ④ 调用      callMCPTool / callMCPToolWithUrlElicitationRetry
//   ⑤ 结果处理  transformMCPResult → processMCPResult（截断 / 落盘 / 图片处理）
//
// 【全文件最反直觉的一点，先记住再看代码】
//
// **连接失败不抛异常。** connectToServer 的 catch 块返回的是
// `{ name, type: 'failed', config, error }` 这个**普通对象**。
// 于是「一个服务器」变成了一个四选一的代数类型：
//
//   connected   连上了，带 client 和 capabilities
//   failed      连不上，带 error 字符串
//   needs-auth  连上了但 401，等用户授权
//   disabled    用户明确关闭了，压根没试
//
// 好处：调用方不需要 try/catch 就能遍历所有服务器，一个坏服务器不会
// 中断整批连接。代价：类型检查必须无处不在（每个消费方都要先判 type）。
//
// 【和 claude.ts 的关系】
//
// 这里产出的 Tool 对象，最终会进 claude.ts 的 allTools 数组，
// 被序列化成 API 请求里的 tools 字段。所以这个文件实际上决定了
// **模型能看见哪些工具、描述长什么样、schema 是什么**。
// claude.ts 里那些 hasPendingMcpServers / mcp_instructions_delta
// 都指向这里的产物。
// ═══════════════════════════════════════════════════════════════
import { feature } from 'bun:bundle'
import type {
  Base64ImageSource,
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  createFetchWithInit,
  type FetchLike,
  type Transport,
} from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  type ElicitRequestURLParams,
  type ElicitResult,
  ErrorCode,
  type JSONRPCMessage,
  type ListPromptsResult,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListRootsRequestSchema,
  type ListToolsResult,
  ListToolsResultSchema,
  McpError,
  type PromptMessage,
  type ResourceLink,
} from '@modelcontextprotocol/sdk/types.js'
import mapValues from 'lodash-es/mapValues.js'
import memoize from 'lodash-es/memoize.js'
import zipObject from 'lodash-es/zipObject.js'
import pMap from 'p-map'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { PRODUCT_URL } from '../../constants/product.js'
import type { AppState } from '../../state/AppState.js'
import {
  type Tool,
  type ToolCallProgress,
  toolMatchesName,
} from '../../Tool.js'
import { ListMcpResourcesTool } from '../../tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { type MCPProgress, MCPTool } from '../../tools/MCPTool/MCPTool.js'
import { createMcpAuthTool } from '../../tools/McpAuthTool/McpAuthTool.js'
import { ReadMcpResourceTool } from '../../tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { createAbortController } from '../../utils/abortController.js'
import { count } from '../../utils/array.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
} from '../../utils/auth.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { detectCodeIndexingFromMcpServerName } from '../../utils/codeIndexing.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import {
  errorMessage,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../utils/errors.js'
import { getMCPUserAgent } from '../../utils/http.js'
import { maybeNotifyIDEConnected } from '../../utils/ide.js'
import { maybeResizeAndDownsampleImageBuffer } from '../../utils/imageResizer.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import {
  getBinaryBlobSavedMessage,
  getFormatDescription,
  getLargeOutputInstructions,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import {
  getContentSizeEstimate,
  type MCPToolResult,
  mcpContentNeedsTruncation,
  truncateMcpContentIfNeeded,
} from '../../utils/mcpValidation.js'
import { WebSocketTransport } from '../../utils/mcpWebSocketTransport.js'
import { memoizeWithLRU } from '../../utils/memoize.js'
import { getWebSocketTLSOptions } from '../../utils/mtls.js'
import {
  getProxyFetchOptions,
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../utils/proxy.js'
import { recursivelySanitizeUnicode } from '../../utils/sanitization.js'
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js'
import { subprocessEnv } from '../../utils/subprocessEnv.js'
import {
  isPersistError,
  persistToolResult,
} from '../../utils/toolResultStorage.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  type ElicitationWaitingState,
  runElicitationHooks,
  runElicitationResultHooks,
} from './elicitationHandler.js'
import { buildMcpToolName } from './mcpStringUtils.js'
import { normalizeNameForMCP } from './normalization.js'
import { getLoggingSafeMcpBaseUrl } from './utils.js'

// ═══ feature 门 + 条件 require，两种不同的懒法 ═══
//
// 这里用的是「编译期删 + 运行期懒」的合体：
//   feature('MCP_SKILLS') 为假 → DCE 把整个三元删成 `= null`
//   为真 → 保留 require，但求值推迟到这一行执行时
//
// 后面 235 行的 claudeInChromeToolRendering 则是「只懒不删」：
// 它外面包的不是 feature 门，而是一个返回 require 的**函数**。
// 原因写在注释里：toolRendering.tsx 会拉 React/ink，
// 而这两个东西只在真的连上 Chrome MCP 时才需要。
//
// 241 行的 computerUseWrapper 更极端，两个目的一起做：
// feature 门负责外部构建里删干净，函数包装负责内部构建里不提前拉
// @ant/computer-use-input + @ant/computer-use-swift 两个原生模块。
// ═══
/* eslint-disable @typescript-eslint/no-require-imports */
const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? (
      require('../../skills/mcpSkills.js') as typeof import('../../skills/mcpSkills.js')
    ).fetchMcpSkillsForClient
  : null

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { AssistantMessage } from 'src/types/message.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { classifyMcpToolForCollapse } from '../../tools/MCPTool/classifyForCollapse.js'
import { clearKeychainCache } from '../../utils/secureStorage/macOsKeychainHelpers.js'
import { sleep } from '../../utils/sleep.js'
import {
  ClaudeAuthProvider,
  hasMcpDiscoveryButNoToken,
  wrapFetchWithStepUpDetection,
} from './auth.js'
import { markClaudeAiMcpConnected } from './claudeai.js'
import { getAllMcpConfigs, isMcpServerDisabled } from './config.js'
import { getMcpServerHeaders } from './headersHelper.js'
import { SdkControlClientTransport } from './SdkControlTransport.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  McpSdkServerConfig,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'

// ═══ 三类错误，各自对应一种「谁该处理」═══
//
// McpAuthError              401/鉴权失败 → 工具执行层捕获，把服务器状态改成 needs-auth
// McpSessionExpiredError    会话过期   → 调用方重新拿 client 再试一次（MAX_SESSION_RETRIES）
// McpToolCallError          isError:true → 直接当工具失败上报，但要带 _meta
//
// 注意第三个的类名：
//   McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
// 那个长后缀不是玩笑，是类型系统层面的**声明**：这个错误消息
// 是 MCP 协议级文本，不含用户文件路径或代码，所以可以安全进埋点。
// 继承自 TelemetrySafeError_I_VERIFIED_...，上报时不做路径擦除。
//
// 全代码库这个后缀出现几十次。它是「人来担保 + 类型来强制」的组合：
// 编译器不会验证你的担保是否正确，但它会强制你在**创建**这个错误时
// 显式选择「我担保这条消息安全」还是「走默认擦除路径」。
// ═══
/**
 * Custom error class to indicate that an MCP tool call failed due to
 * authentication issues (e.g., expired OAuth token returning 401).
 * This error should be caught at the tool execution layer to update
 * the client's status to 'needs-auth'.
 */
export class McpAuthError extends Error {
  serverName: string
  constructor(serverName: string, message: string) {
    super(message)
    this.name = 'McpAuthError'
    this.serverName = serverName
  }
}

/**
 * Thrown when an MCP session has expired and the connection cache has been cleared.
 * The caller should get a fresh client via ensureConnectedClient and retry.
 */
class McpSessionExpiredError extends Error {
  constructor(serverName: string) {
    super(`MCP server "${serverName}" session expired`)
    this.name = 'McpSessionExpiredError'
  }
}

/**
 * Thrown when an MCP tool returns `isError: true`. Carries the result's `_meta`
 * so SDK consumers can still receive it — per the MCP spec, `_meta` is on the
 * base Result type and is valid on error results.
 */
export class McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(
    message: string,
    telemetryMessage: string,
    readonly mcpMeta?: { _meta?: Record<string, unknown> },
  ) {
    super(message, telemetryMessage)
    this.name = 'McpToolCallError'
  }
}

// ═══ 为什么 session 过期要同时看两个信号 ═══
//
// MCP 规范说：会话 ID 失效时服务器返回 404。
// 但 404 太常见了 —— URL 打错是 404，服务器下线是 404，反代配置错也是 404。
// 光看 404 会把「这个服务根本不存在」误判成「会话过期，重连就好」。
//
// 所以第二个条件：响应体里必须是 JSON-RPC 的 -32001（Session not found）。
// 两个信号同时满足才算会话过期。
//
// 注意实现方式：从 error.message 里**字符串搜索** `"code":-32001`。
// 写了两个变体（带空格/不带空格），因为不同序列化器输出的 JSON 格式不同。
// 这是和 withRetry.ts 的 parseMaxTokensContextOverflowError 同一类做法：
// 从自然语言/文本消息里抠结构化信息。脆弱，但没有更好的办法 ——
// SDK 没有把 response body 暴露成结构化字段。
// ═══
/**
 * Detects whether an error is an MCP "Session not found" error (HTTP 404 + JSON-RPC code -32001).
 * Per the MCP spec, servers return 404 when a session ID is no longer valid.
 * We check both signals to avoid false positives from generic 404s (wrong URL, server gone, etc.).
 */
export function isMcpSessionExpiredError(error: Error): boolean {
  const httpStatus =
    'code' in error ? (error as Error & { code?: number }).code : undefined
  if (httpStatus !== 404) {
    return false
  }
  // The SDK embeds the response body text in the error message.
  // MCP servers return: {"error":{"code":-32001,"message":"Session not found"},...}
  // Check for the JSON-RPC error code to distinguish from generic web server 404s.
  return (
    error.message.includes('"code":-32001') ||
    error.message.includes('"code": -32001')
  )
}

// ═══ 默认超时 100,000,000 毫秒 = 约 27.8 小时 ═══
//
// 这个数字看着像写错了，但它是有意的：**默认等于没有超时**。
//
// 理由：MCP 工具可能是「跑一次完整构建」「部署到生产」「等 CI 通过」
// 这类操作。给一个 30 秒或 5 分钟的超时，会在正常工作流上造成假失败，
// 而且这种失败往往不可恢复（操作已经开始了，中断它比让它跑完更糟）。
//
// 真正的停止手段是用户的 Esc（AbortSignal），不是超时。
// 需要真超时的用户可以通过 MCP_TOOL_TIMEOUT 环境变量自己设。
// ═══
/**
 * Default timeout for MCP tool calls (effectively infinite - ~27.8 hours).
 */
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000

/**
 * Cap on MCP tool descriptions and server instructions sent to the model.
 * OpenAPI-generated MCP servers have been observed dumping 15-60KB of endpoint
 * docs into tool.description; this caps the p95 tail without losing the intent.
 */
const MAX_MCP_DESCRIPTION_LENGTH = 2048

/**
 * Gets the timeout for MCP tool calls in milliseconds.
 * Uses MCP_TOOL_TIMEOUT environment variable if set, otherwise defaults to ~27.8 hours.
 */
function getMcpToolTimeoutMs(): number {
  return (
    parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10) ||
    DEFAULT_MCP_TOOL_TIMEOUT_MS
  )
}

// ═══ 两种 lazy require 的动机不同，别搞混 ═══
//
// 235 行这里：**只懒不删**。函数包着 require，调用时才求值。
// 目的纯粹是启动时间 —— toolRendering.tsx → React/ink 一整条链，
// 只在真的连上 Claude-in-Chrome 之后才需要。
//
// 241 行那里：**又删又懒**。feature('CHICAGO_MCP') 门负责外部构建里删干净
// （连同 245 行那个 isComputerUseMCPServer 一起），函数包装负责内部构建里
// 不提前拉两个原生模块（@ant/computer-use-input 和 @ant/computer-use-swift，
// 都是 .node 二进制）。
//
// 于是 928 行会出现 `isComputerUseMCPServer!(name)` 这样的非空断言。
// 看着危险，其实安全：那个断言所在的 `feature('CHICAGO_MCP') && ...`
// 分支，在 feature 为假时整个被 DCE 删掉了，永远走不到。
// 断言的真正作用是**让 TypeScript 闭嘴**，因为类型上它可能是 undefined。
// ═══
import { isClaudeInChromeMCPServer } from '../../utils/claudeInChrome/common.js'

// Lazy: toolRendering.tsx pulls React/ink; only needed when Claude-in-Chrome MCP server is connected
/* eslint-disable @typescript-eslint/no-require-imports */
const claudeInChromeToolRendering =
  (): typeof import('../../utils/claudeInChrome/toolRendering.js') =>
    require('../../utils/claudeInChrome/toolRendering.js')
// Lazy: wrapper.tsx → hostAdapter.ts → executor.ts pulls both native modules
// (@ant/computer-use-input + @ant/computer-use-swift). Runtime-gated by
// GrowthBook tengu_malort_pedway (see gates.ts).
const computerUseWrapper = feature('CHICAGO_MCP')
  ? (): typeof import('../../utils/computerUse/wrapper.js') =>
      require('../../utils/computerUse/wrapper.js')
  : undefined
const isComputerUseMCPServer = feature('CHICAGO_MCP')
  ? (
      require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')
    ).isComputerUseMCPServer
  : undefined

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'

const MCP_AUTH_CACHE_TTL_MS = 15 * 60 * 1000 // 15 min

type McpAuthCacheData = Record<string, { timestamp: number }>

function getMcpAuthCachePath(): string {
  return join(getClaudeConfigHomeDir(), 'mcp-needs-auth-cache.json')
}

// ═══ 手写 memoize，因为 lodash 的 memoize 做不到 ═══
//
// 这里缓存的是一个 Promise（文件读取）。三个要点：
//
// 1. 为什么缓存 Promise 而不是结果
//    批量连接时 N 个服务器同时问「我是不是 needs-auth」，
//    缓存 Promise 能让 N 个调用共享**一次** readFile。缓存结果则不行 ——
//    后 N-1 个调用会各自发起一次读，因为第一次还没返回。
//
// 2. 为什么不用 lodash memoize
//    注释写得很直接：需要把整个缓存**置 null**，而不是按 key 删除。
//    因为没有 key —— 只有一个文件、一份缓存。
//
// 3. 失效时机
//    写的时候（setMcpAuthCacheEntry）和清的时候（clearMcpAuthCache）
//    都置 null。前者在写完之后，后者立即。
// ═══
// Memoized so N concurrent isMcpAuthCached() calls during batched connection
// share a single file read instead of N reads of the same file. Invalidated
// on write (setMcpAuthCacheEntry) and clear (clearMcpAuthCache). Not using
// lodash memoize because we need to null out the cache, not delete by key.
let authCachePromise: Promise<McpAuthCacheData> | null = null

function getMcpAuthCache(): Promise<McpAuthCacheData> {
  if (!authCachePromise) {
    authCachePromise = readFile(getMcpAuthCachePath(), 'utf-8')
      .then(data => jsonParse(data) as McpAuthCacheData)
      .catch(() => ({}))
  }
  return authCachePromise
}

async function isMcpAuthCached(serverId: string): Promise<boolean> {
  const cache = await getMcpAuthCache()
  const entry = cache[serverId]
  if (!entry) {
    return false
  }
  return Date.now() - entry.timestamp < MCP_AUTH_CACHE_TTL_MS
}

// ═══ 用 Promise 链串行化写入，防 read-modify-write 竞争 ═══
//
// 场景：一批 20 个服务器同时返回 401，20 个 handler 同时调
// setMcpAuthCacheEntry。每个都是「读文件 → 改内存对象 → 写文件」。
// 并发跑的话，后 19 个的写会覆盖掉前面的新增条目 —— 只有最后一个留下。
//
// 解法是把写操作挂到一条 promise 链上，任何时刻只有一个在跑。
// 简单，而且不需要锁文件。
//
// 注意行 304 `authCachePromise = null` 的位置：在 writeFile **之后**。
// 注释解释了为什么这是安全的 —— 因为写是串行的，下一个写的
// getMcpAuthCache() 一定会重新读到含这条新记录的文件。
// 如果放在 writeFile 之前，就会出现「缓存已失效但文件还没写」的窗口。
// ═══
// Serialize cache writes through a promise chain to prevent concurrent
// read-modify-write races when multiple servers return 401 in the same batch
let writeChain = Promise.resolve()

function setMcpAuthCacheEntry(serverId: string): void {
  writeChain = writeChain
    .then(async () => {
      const cache = await getMcpAuthCache()
      cache[serverId] = { timestamp: Date.now() }
      const cachePath = getMcpAuthCachePath()
      await mkdir(dirname(cachePath), { recursive: true })
      await writeFile(cachePath, jsonStringify(cache))
      // Invalidate the read cache so subsequent reads see the new entry.
      // Safe because writeChain serializes writes: the next write's
      // getMcpAuthCache() call will re-read the file with this entry present.
      authCachePromise = null
    })
    .catch(() => {
      // Best-effort cache write
    })
}

export function clearMcpAuthCache(): void {
  authCachePromise = null
  void unlink(getMcpAuthCachePath()).catch(() => {
    // Cache file may not exist
  })
}

// ═══ 一个「性能微优化」被降到注释级别 ═══
//
// 这个函数存在的唯一理由：原来内联的三元表达式调了两次
// getLoggingSafeMcpBaseUrl()（一次判空、一次取值）。抽成函数后只调一次。
//
// 从类型上也能看出目的：返回值可以直接 spread 进埋点对象
// （`...mcpBaseUrlAnalytics(serverRef)`），无 URL 时返回 {} 而不是 {key: undefined}，
// 避免埋点里出现一堆 undefined 字段。
//
// 这类小函数在源码里很多。读的时候不用花时间，但要注意它揭示的一件事：
// 埋点字段的**形状**是被认真设计过的，不是随手拼的。
// ═══
/**
 * Spread-ready analytics field for the server's base URL. Calls
 * getLoggingSafeMcpBaseUrl once (not twice like the inline ternary it replaces).
 * Typed as AnalyticsMetadata since the URL is query-stripped and safe to log.
 */
function mcpBaseUrlAnalytics(serverRef: ScopedMcpServerConfig): {
  mcpServerBaseUrl?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  const url = getLoggingSafeMcpBaseUrl(serverRef)
  return url
    ? {
        mcpServerBaseUrl:
          url as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }
    : {}
}

// ═══ 401 不抛异常，而是变成一种「连接状态」═══
//
// 这是全文件最重要的设计决策之一，值得单独说清楚链条：
//
//   ① transport 抛 UnauthorizedError
//   ② connectToServer 的 catch 里判断 `instanceof UnauthorizedError`
//   ③ 调这个函数 → 埋点 + 写 15 分钟 needs-auth 缓存 + 返回 needs-auth 对象
//   ④ getMcpToolsCommandsAndResources 收到 needs-auth
//   ⑤ 它塞一个 createMcpAuthTool(name, config) 进 tools 数组
//   ⑥ **模型看到一个「认证这个服务器」的工具**
//   ⑦ 模型可以自己调用它，走 OAuth 流程
//
// 于是「一个错误」变成「一个可执行的修复动作」。这是 agent 系统里
// 很值得学的一招：不要只报告问题，把问题包装成模型能操作的工具。
//
// 三个 transport 共用这个函数（sse / http / claudeai-proxy），
// 差别只在埋点里的 label。
// ═══
/**
 * Shared handler for sse/http/claudeai-proxy auth failures during connect:
 * emits tengu_mcp_server_needs_auth, caches the needs-auth entry, and returns
 * the needs-auth connection result.
 */
function handleRemoteAuthFailure(
  name: string,
  serverRef: ScopedMcpServerConfig,
  transportType: 'sse' | 'http' | 'claudeai-proxy',
): MCPServerConnection {
  logEvent('tengu_mcp_server_needs_auth', {
    transportType:
      transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...mcpBaseUrlAnalytics(serverRef),
  })
  const label: Record<typeof transportType, string> = {
    sse: 'SSE',
    http: 'HTTP',
    'claudeai-proxy': 'claude.ai proxy',
  }
  logMCPDebug(
    name,
    `Authentication required for ${label[transportType]} server`,
  )
  setMcpAuthCacheEntry(name)
  return { name, type: 'needs-auth', config: serverRef }
}

// ═══ 一个非常微妙的并发 401 陷阱 ═══
//
// 看返回值：不是 response，而是 `{ response, sentToken }`。
// 这个「多返回一个 token」是整个函数存在的核心理由。
//
// 错误写法（注释里明确点出来了）：
//
//   const res = await doRequest()
//   if (res.status === 401) {
//     await handleOAuth401Error()        // ← 这里内部会重读 keychain
//   }
//
// 并发场景下会坏：
//   连接器 A 和 B 同时 401。A 先跑 handleOAuth401Error，刷新出新 token
//   并清掉 memoize 缓存。B 再跑时读 getClaudeAIOAuthTokens()，
//   拿到的是**新** token，传给 handleOAuth401Error，
//   它一比对「和 keychain 里的一样」→ 返回 false → 不重试 → B 永久失败。
//
// 正确做法是把「我发出去时用的是哪个 token」显式传参下去。
// 注释最后一句点了同款实现的另一个文件：bridgeApi.ts 的 withOAuthRetry。
//
// 【还有一层放大效应】
// 注释开头说的：Anthropic API 路径在 withRetry.ts / grove.ts 里有同样的
// 401 重试（处理 memoize 缓存陈旧和时钟漂移）。这里如果没有，
// 一个 stale token 会让**所有** claude.ai 连接器同时 401，
// 然后全被钉进 15 分钟的 needs-auth 缓存 —— 用户看到的就是
// 「所有连接器突然全挂了，等 15 分钟才恢复」。
// ═══
/**
 * Fetch wrapper for claude.ai proxy connections. Attaches the OAuth bearer
 * token and retries once on 401 via handleOAuth401Error (force-refresh).
 *
 * The Anthropic API path has this retry (withRetry.ts, grove.ts) to handle
 * memoize-cache staleness and clock drift. Without the same here, a single
 * stale token mass-401s every claude.ai connector and sticks them all in the
 * 15-min needs-auth cache.
 */
export function createClaudeAiProxyFetch(innerFetch: FetchLike): FetchLike {
  return async (url, init) => {
    const doRequest = async () => {
      await checkAndRefreshOAuthTokenIfNeeded()
      const currentTokens = getClaudeAIOAuthTokens()
      if (!currentTokens) {
        throw new Error('No claude.ai OAuth token available')
      }
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${currentTokens.accessToken}`)
      const response = await innerFetch(url, { ...init, headers })
      // Return the exact token that was sent. Reading getClaudeAIOAuthTokens()
      // again after the request is wrong under concurrent 401s: another
      // connector's handleOAuth401Error clears the memoize cache, so we'd read
      // the NEW token from keychain, pass it to handleOAuth401Error, which
      // finds same-as-keychain → returns false → skips retry. Same pattern as
      // bridgeApi.ts withOAuthRetry (token passed as fn param).
      return { response, sentToken: currentTokens.accessToken }
    }

    const { response, sentToken } = await doRequest()
    if (response.status !== 401) {
      return response
    }
    // handleOAuth401Error returns true only if the token actually changed
    // (keychain had a newer one, or force-refresh succeeded). Gate retry on
    // that — otherwise we double round-trip time for every connector whose
    // downstream service genuinely needs auth (the common case: 30+ servers
    // with "MCP server requires authentication but no OAuth token configured").
    const tokenChanged = await handleOAuth401Error(sentToken).catch(() => false)
    logEvent('tengu_mcp_claudeai_proxy_401', {
      tokenChanged:
        tokenChanged as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
// ═══ 双保险：ELOCKED 竞争下的二次确认 ═══
//
// handleOAuth401Error 返回 false 有两种含义：
//   a) 真的没救（keychain 里就是同一个过期 token）
//   b) 我们抢锁失败了，别的进程正在刷新（ELOCKED）
//
// 这两种情况必须分开处理。所以返回 false 后再看一眼：
// 「现在 keychain 里的 token 和我发出去时用的还一样吗？」
// 不一样 → 说明别人刷好了 → 继续重试。
// 一样 → 真没救 → 返回原始 401 让上层分类。
//
// 这个模式在「多进程共享凭据」的系统里很常见：锁竞争失败 ≠ 操作失败，
// 可能只是别人做了你要做的事。
// ═══
    if (!tokenChanged) {
      // ELOCKED contention: another connector may have won the lockfile and refreshed — check if token changed underneath us
      const now = getClaudeAIOAuthTokens()?.accessToken
      if (!now || now === sentToken) {
        return response
      }
    }
    try {
      return (await doRequest()).response
    } catch {
      // Retry itself failed (network error). Return the original 401 so the
      // outer handler can classify it.
      return response
    }
  }
}

// ═══ Bun 的 ws 类型缺 3 参构造函数 ═══
//
// 真实的 ws 包支持 `new WebSocket(url, protocols, options)`，
// 但 Bun 内置的 ws shim 类型定义只声明了两个参数。
// 所以这里把构造函数 cast 成正确的签名再用。
//
// 注意 dynamic import('ws')：和 235 行同样的手法，
// WebSocket 只在配置里有 ws/ws-ide 服务器时才需要。
// ═══
// Minimal interface for WebSocket instances passed to mcpWebSocketTransport
type WsClientLike = {
  readonly readyState: number
  close(): void
  send(data: string): void
}

/**
 * Create a ws.WebSocket client with the MCP protocol.
 * Bun's ws shim types lack the 3-arg constructor (url, protocols, options)
 * that the real ws package supports, so we cast the constructor here.
 */
async function createNodeWsClient(
  url: string,
  options: Record<string, unknown>,
): Promise<WsClientLike> {
  const wsModule = await import('ws')
  const WS = wsModule.default as unknown as new (
    url: string,
    protocols: string[],
    options: Record<string, unknown>,
  ) => WsClientLike
  return new WS(url, ['mcp'], options)
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

function getConnectionTimeoutMs(): number {
  return parseInt(process.env.MCP_TIMEOUT || '', 10) || 30000
}

/**
 * Default timeout for individual MCP requests (auth, tool calls, etc.)
 */
const MCP_REQUEST_TIMEOUT_MS = 60000

// ═══ 这个常量不是我们想要的，是规范强制的 ═══
//
// MCP Streamable HTTP 规范要求：客户端在**每个 POST** 上都要声明
// 同时接受 JSON 和 SSE。严格执行规范的服务器会拒绝不带它的请求（HTTP 406）。
//
// 注意下面 wrapFetchWithTimeout 里为什么要「保证」它存在而不是「设置」它：
// SDK 的 StreamableHTTPClientTransport.send() 内部确实设了，
// 但它是设在一个 Headers 实例上，然后经过一次对象 spread。
// 某些运行时/agent 会在到达网络前把它弄丢（注释给了 issue 编号 202）。
// 所以在**最后一个** fetch 包装层再归一化一次 —— 这是唯一能保证的位置。
// ═══
/**
 * MCP Streamable HTTP spec requires clients to advertise acceptance of both
 * JSON and SSE on every POST. Servers that enforce this strictly reject
 * requests without it (HTTP 406).
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#sending-messages-to-the-server
 */
const MCP_STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream'

// ═══ 这个包装器解决了四个独立问题，注释写得很好，逐条拆 ═══
//
// 【问题一】AbortSignal.timeout() 不能复用
//   在连接时创建一个 AbortSignal.timeout(60s)，60 秒后它永久处于 aborted。
//   之后所有请求都会立刻失败，报 "The operation timed out."
//   听起来很傻，但这个 bug 真的会发生 —— 因为 signal 看起来像无害的配置。
//   解法：每次请求新建一个。
//
// 【问题二】GET 不能加超时
//   MCP 里 GET 请求是**长连 SSE 流**，设计上就该一直开着。
//   给它 60 秒超时等于每 60 秒杀掉一次事件流。
//   所以 498 行直接透传给 baseFetch，一秒钟都不包。
//   （OAuth discovery 的 GET 在 auth.ts 里另有一套带超时的 fetch，不走这里。）
//
// 【问题三】Bun 里 signal 的定时器是懒 GC 的
//   AbortSignal.timeout 的内部定时器只在 signal 被 GC 时才释放，
//   而 Bun 的 GC 很懒。实测每个请求残留约 2.4KB 原生内存，整整 60 秒 ——
//   即使请求在几毫秒内就完成了。
//   解法：用 setTimeout + 手动 clearTimeout（532 行的 cleanup）。
//
// 【问题四】Accept header 会在 spread 中丢失
//   见上面的 MCP_STREAMABLE_HTTP_ACCEPT。
//
// 顺序也讲究：先建 Headers（归一化形状）→ 再设 Accept → 再建 controller。
// 因为 Headers 构造是唯一能同时接受 HeadersInit 三种形态
// （对象 / 元组数组 / Headers 实例）的地方。
// ═══
/**
 * Wraps a fetch function to apply a fresh timeout signal to each request.
 * This avoids the bug where a single AbortSignal.timeout() created at connection
 * time becomes stale after 60 seconds, causing all subsequent requests to fail
 * immediately with "The operation timed out." Uses a 60-second timeout.
 *
 * Also ensures the Accept header required by the MCP Streamable HTTP spec is
 * present on POSTs. The MCP SDK sets this inside StreamableHTTPClientTransport.send(),
 * but it is attached to a Headers instance that passes through an object spread here,
 * and some runtimes/agents have been observed dropping it before it reaches the wire.
 * See https://github.com/anthropics/claude-agent-sdk-typescript/issues/202.
 * Normalizing here (the last wrapper before fetch()) guarantees it is sent.
 *
 * GET requests are excluded from the timeout since, for MCP transports, they are
 * long-lived SSE streams meant to stay open indefinitely. (Auth-related GETs use
 * a separate fetch wrapper with its own timeout in auth.ts.)
 *
 * @param baseFetch - The fetch function to wrap
 */
export function wrapFetchWithTimeout(baseFetch: FetchLike): FetchLike {
  return async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()

    // Skip timeout for GET requests - in MCP transports, these are long-lived SSE streams.
    // (OAuth discovery GETs in auth.ts use a separate createAuthFetch() with its own timeout.)
    if (method === 'GET') {
      return baseFetch(url, init)
    }

    // Normalize headers and guarantee the Streamable-HTTP Accept value. new Headers()
    // accepts HeadersInit | undefined and copies from plain objects, tuple arrays,
    // and existing Headers instances — so whatever shape the SDK handed us, the
    // Accept value survives the spread below as an own property of a concrete object.
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const headers = new Headers(init?.headers)
    if (!headers.has('accept')) {
      headers.set('accept', MCP_STREAMABLE_HTTP_ACCEPT)
    }

    // Use setTimeout instead of AbortSignal.timeout() so we can clearTimeout on
    // completion. AbortSignal.timeout's internal timer is only released when the
    // signal is GC'd, which in Bun is lazy — ~2.4KB of native memory per request
    // lingers for the full 60s even when the request completes in milliseconds.
    const controller = new AbortController()
    const timer = setTimeout(
      c =>
        c.abort(new DOMException('The operation timed out.', 'TimeoutError')),
      MCP_REQUEST_TIMEOUT_MS,
      controller,
    )
    timer.unref?.()

    const parentSignal = init?.signal
    const abort = () => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abort)
    if (parentSignal?.aborted) {
      controller.abort(parentSignal.reason)
    }

    const cleanup = () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    }

    try {
      const response = await baseFetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      })
      cleanup()
      return response
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

// ═══ 本地 3 / 远程 20，差距这么大是因为成本模型不同 ═══
//
// 本地服务器（stdio/sdk）= 每次连接 spawn 一个**子进程**。
// 并发 20 个就是同时 spawn 20 个进程：内存、文件描述符、CPU 争抢。
// 3 是经验值，也是「批量连接时不会把机器打爆」的上限。
//
// 远程服务器 = 只是网络连接，等着就行。
// 20 个并发对客户端几乎无成本，还能把总连接时间压到
// 「最慢那一个」而不是「累加」。
//
// 两个都能用环境变量覆盖，方便用户按机器性能调。
// ═══
export function getMcpServerConnectionBatchSize(): number {
  return parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE || '', 10) || 3
}

function getRemoteMcpServerConnectionBatchSize(): number {
  return (
    parseInt(process.env.MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE || '', 10) ||
    20
  )
}

function isLocalMcpServer(config: ScopedMcpServerConfig): boolean {
  return !config.type || config.type === 'stdio' || config.type === 'sdk'
}

// ═══ 只放行两个 IDE 工具，其余一律过滤 ═══
//
// IDE 的 MCP 服务器（VS Code / JetBrains 插件那类）会暴露一大堆工具，
// 但其中绝大多数是我们已经用内建工具覆盖的能力（读文件、搜索、编辑）。
// 全量放进去会让模型的工具列表膨胀，还会和内建工具打架。
//
// 只留两个内建做不到的：
//   mcp__ide__executeCode     在 IDE 的运行时里跑代码（能访问编辑器的状态）
//   mcp__ide__getDiagnostics  拿 IDE 的语义诊断（比跑 tsc 快，因为已经算好了）
//
// 过滤发生在 fetchToolsForClient 的最后一步（1990 行的 .filter）。
// ═══
// For the IDE MCP servers, we only include specific tools
const ALLOWED_IDE_TOOLS = ['mcp__ide__executeCode', 'mcp__ide__getDiagnostics']
function isIncludedMcpTool(tool: Tool): boolean {
  return (
    !tool.name.startsWith('mcp__ide__') || ALLOWED_IDE_TOOLS.includes(tool.name)
  )
}

// ═══ 缓存键 = 名字 + 序列化后的整个配置 ═══
//
// 这个函数是 connectToServer 的 memoize resolver（1640 行传入）。
// 语义：配置的任何字段变了，键就变了，memoize 自然失效并重连。
//
// 副作用：jsonStringify 的**键顺序**会影响结果。同样内容的配置对象，
// 如果构造时键的顺序不同，会算出两个不同的键 → 缓存不命中 → 重连。
// 实际不会出问题（配置都从同一处 JSON 解析出来，顺序稳定），
// 但它解释了为什么 1710 行的 areMcpConfigsEqual 也用了同样的比较方式。
// ═══
/**
 * Generates the cache key for a server connection
 * @param name Server name
 * @param serverRef Server configuration
 * @returns Cache key string
 */
export function getServerCacheKey(
  name: string,
  serverRef: ScopedMcpServerConfig,
): string {
  return `${name}-${jsonStringify(serverRef)}`
}

// ═══ 作者自己留下的复杂度债，原文照抄 ═══
//
//   "TODO (ollie): The memoization here increases complexity by a lot,
//    and im not sure it really improves performance"
//
// 这句话值得停下来想一想，因为它是**有名字的人**在源码里承认
// 「我加的这层优化可能不值」。而下面这 1,046 行的函数，
// 复杂度确实有相当一部分来自 memoize：
//
//   · 缓存键要包含整个配置（getServerCacheKey）
//   · onclose 里必须手动删缓存，否则重连拿不到新连接（1396 行）
//   · 同样的删除要在 clearServerCache（1666）和
//     clearServerCache 的调用点（2154）各写一遍
//   · 还有四个**独立的** fetch 缓存也要跟着清（1389-1394）
//
// 一个缓存变成了「必须记住在 5 个地方同步维护」的隐式契约。
//
// 对比 2405 行的 prefetchAllMcpResources：那里明确写了**不 memoize**
// 的理由（按对象引用 memoize 会泄漏，因为调用方每次造新对象）。
// 两个函数，两个相反决定，各自的理由都写在注释里 ——
// 这是这套源码里最值得学的习惯之一：**把「为什么不这么做」写下来**。
//
// 读这个函数时的心态建议：不要试图一次搞懂 1,046 行。
// 它是一条 try 里的七个 if-else 分支（每个 transport 一段），
// 加上连接后的通用收尾（错误桥接、缓存清理、清理函数注册）。
// 按分支读，每次只读一种 transport。
// ═══
/**
 * TODO (ollie): The memoization here increases complexity by a lot, and im not sure it really improves performance
 * Attempts to connect to a single MCP server
 * @param name Server name
 * @param serverRef Scoped server configuration
 * @returns A wrapped client (either connected or failed)
 */
export const connectToServer = memoize(
  async (
    name: string,
    serverRef: ScopedMcpServerConfig,
    serverStats?: {
      totalServers: number
      stdioCount: number
      sseCount: number
      httpCount: number
      sseIdeCount: number
      wsIdeCount: number
    },
  ): Promise<MCPServerConnection> => {
    const connectStartTime = Date.now()
    let inProcessServer:
      | { connect(t: Transport): Promise<void>; close(): Promise<void> }
      | undefined
// ═══ 1,046 行的一条 try，七个 transport 分支，一个统一的收尾 ═══
//
// 结构是：
//
//   try {
//     ① 七个 if-else 分支 → 每种 transport 造出 transport 对象
//        （sse / sse-ide / ws-ide / ws / http / claudeai-proxy /
//          Chrome 进程内 / ComputerUse 进程内 / stdio）
//     ② 通用：包 stderr 日志、造 Client、注册 ListRoots / Elicitation handler
//     ③ 通用：Promise.race 连接 + 连接超时
//     ④ 通用：分 transport 记录失败（401 → needs-auth）
//     ⑤ 通用：桥接 SDK 的 onerror/onclose，接管重连
//     ⑥ 通用：清理函数（子进程信号升级 + 注册到全局 cleanup）
//     ⑦ 返回 connected 对象
//   } catch {
//     埋点 + 清理 + 返回 failed 对象（不抛）
//   }
//
// 注意 inProcessServer 这个变量在 try 外面声明（609 行）：
// 因为 catch 块也要能关掉它（1629 行）。这是「跨 try/catch 存活」的典型
// 写法 —— 和 claude.ts 里那些必须在 finally 里被读到的变量同一个道理。
// ═══
    try {
      let transport

      // If we have the session ingress JWT, we will connect via the session ingress rather than
      // to remote MCP's directly.
      const sessionIngressToken = getSessionIngressAuthToken()

// ═══ SSE 分支：两个 fetch，两个完全不同的目的 ═══
//
// transportOptions.fetch（632 行）—— 用于**发消息**（POST）。
//   包了两层：
//     wrapFetchWithStepUpDetection(...)  内层，先看 403
//     wrapFetchWithTimeout(...)          外层，每次请求新超时
//   顺序不能反。注释说明了原因：step-up 检测要在**最内层**，
//   这样 403 能在 SDK 的 auth() → tokens() 处理器之前被看到。
//   （step-up = 服务器要求提升权限范围，需要先识别出来再走 OAuth 升级。）
//
// transportOptions.eventSourceInit.fetch（648 行）—— 用于**收事件**（长连 GET）。
//   **绝对不能**包超时。注释用了 IMPORTANT 开头：
//   EventSource 连接设计上就是无限期开着的，加 60 秒超时就是每 60 秒杀一次。
//
// 同一个 transport 里，一个 fetch 要超时、一个不要。这是 MCP 的 SSE
// 协议形状决定的，不是我们能选的。
//
// 另外 667 行的 header 顺序也是刻意的：...init?.headers 在 ...combinedHeaders
// 之前，意思是**用户配置的 header 能覆盖**调用方传的；而 Accept 放最后，
// 意思是没人能覆盖它（EventSource 必须是 text/event-stream）。
// ═══
      if (serverRef.type === 'sse') {
        // Create an auth provider for this server
        const authProvider = new ClaudeAuthProvider(name, serverRef)

        // Get combined headers (static + dynamic)
        const combinedHeaders = await getMcpServerHeaders(name, serverRef)

        // Use the auth provider with SSEClientTransport
        const transportOptions: SSEClientTransportOptions = {
          authProvider,
          // Use fresh timeout per request to avoid stale AbortSignal bug.
          // Step-up detection wraps innermost so the 403 is seen before the
          // SDK's handler calls auth() → tokens().
          fetch: wrapFetchWithTimeout(
            wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
          ),
          requestInit: {
            headers: {
              'User-Agent': getMCPUserAgent(),
              ...combinedHeaders,
            },
          },
        }

        // IMPORTANT: Always set eventSourceInit with a fetch that does NOT use the
        // timeout wrapper. The EventSource connection is long-lived (stays open indefinitely
        // to receive server-sent events), so applying a 60-second timeout would kill it.
        // The timeout is only meant for individual API requests (POST, auth refresh), not
        // the persistent SSE stream.
        transportOptions.eventSourceInit = {
          fetch: async (url: string | URL, init?: RequestInit) => {
            // Get auth headers from the auth provider
            const authHeaders: Record<string, string> = {}
            const tokens = await authProvider.tokens()
            if (tokens) {
              authHeaders.Authorization = `Bearer ${tokens.access_token}`
            }

            const proxyOptions = getProxyFetchOptions()
            // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
            return fetch(url, {
              ...init,
              ...proxyOptions,
              headers: {
                'User-Agent': getMCPUserAgent(),
                ...authHeaders,
                ...init?.headers,
                ...combinedHeaders,
                Accept: 'text/event-stream',
              },
            })
          },
        }

        transport = new SSEClientTransport(
          new URL(serverRef.url),
          transportOptions,
        )
        logMCPDebug(name, `SSE transport initialized, awaiting connection`)
// ═══ sse-ide：IDE 插件，不需要认证 ═══
//
// 和上面的 sse 比，这个分支少了 authProvider、少了 combinedHeaders、
// 少了 User-Agent 之外的一切。因为 IDE 服务器是本机插件起的，
// 通信走 loopback，认证靠进程边界就够了。
//
// 有个 TODO 留在注释里："Use the auth token provided in the lockfile"
// —— 说明未来可能加一层，防止别的进程冒充。
//
// 注意 704 行那个 `Object.keys(transportOptions).length > 0 ? ... : undefined`：
// 没配代理时传 undefined 而不是 {}。因为 SDK 对 undefined 和 {} 的处理不同
// （{} 可能会覆盖掉它自己的默认值）。
// ═══
      } else if (serverRef.type === 'sse-ide') {
        logMCPDebug(name, `Setting up SSE-IDE transport to ${serverRef.url}`)
        // IDE servers don't need authentication
        // TODO: Use the auth token provided in the lockfile
        const proxyOptions = getProxyFetchOptions()
        const transportOptions: SSEClientTransportOptions =
          proxyOptions.dispatcher
            ? {
                eventSourceInit: {
                  fetch: async (url: string | URL, init?: RequestInit) => {
                    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
                    return fetch(url, {
                      ...init,
                      ...proxyOptions,
                      headers: {
                        'User-Agent': getMCPUserAgent(),
                        ...init?.headers,
                      },
                    })
                  },
                },
              }
            : {}

        transport = new SSEClientTransport(
          new URL(serverRef.url),
          Object.keys(transportOptions).length > 0
            ? transportOptions
            : undefined,
        )
// ═══ ws-ide / ws：同一套 WebSocket 两种运行时 ═══
//
// 718 行 `typeof Bun !== 'undefined'` 是个真实的运行时分支：
//
//   Bun  → 用 globalThis.WebSocket，支持 headers/proxy/tls 选项，
//          但 DOM 类型定义不认识这些选项，所以要 cast 成 string[]
//   Node → 用 ws 包的 3 参构造函数（见 createNodeWsClient）
//
// 两条路的选项名还不一样：
//   Bun:  proxy: url, tls: options
//   Node: agent: proxyAgent, ...tlsOptions（展开合并）
//
// 753 行那个「打日志前擦掉 Authorization」也值得注意。
// 这是埋点卫生的一部分：同一个对象在内存里带凭据，进日志时必须是
// [REDACTED]。写法是 mapValues + key.toLowerCase() 判断 —— 小写化是必须的，
// HTTP header 名大小写不敏感，但 JS 对象键是敏感的。
// ═══
      } else if (serverRef.type === 'ws-ide') {
        const tlsOptions = getWebSocketTLSOptions()
        const wsHeaders = {
          'User-Agent': getMCPUserAgent(),
          ...(serverRef.authToken && {
            'X-Claude-Code-Ide-Authorization': serverRef.authToken,
          }),
        }

        let wsClient: WsClientLike
        if (typeof Bun !== 'undefined') {
          // Bun's WebSocket supports headers/proxy/tls options but the DOM typings don't
          // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
          wsClient = new globalThis.WebSocket(serverRef.url, {
            protocols: ['mcp'],
            headers: wsHeaders,
            proxy: getWebSocketProxyUrl(serverRef.url),
            tls: tlsOptions || undefined,
          } as unknown as string[])
        } else {
          wsClient = await createNodeWsClient(serverRef.url, {
            headers: wsHeaders,
            agent: getWebSocketProxyAgent(serverRef.url),
            ...(tlsOptions || {}),
          })
        }
        transport = new WebSocketTransport(wsClient)
      } else if (serverRef.type === 'ws') {
        logMCPDebug(
          name,
          `Initializing WebSocket transport to ${serverRef.url}`,
        )

        const combinedHeaders = await getMcpServerHeaders(name, serverRef)

        const tlsOptions = getWebSocketTLSOptions()
        const wsHeaders = {
          'User-Agent': getMCPUserAgent(),
          ...(sessionIngressToken && {
            Authorization: `Bearer ${sessionIngressToken}`,
          }),
          ...combinedHeaders,
        }

        // Redact sensitive headers before logging
        const wsHeadersForLogging = mapValues(wsHeaders, (value, key) =>
          key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
        )

        logMCPDebug(
          name,
          `WebSocket transport options: ${jsonStringify({
            url: serverRef.url,
            headers: wsHeadersForLogging,
            hasSessionAuth: !!sessionIngressToken,
          })}`,
        )

        let wsClient: WsClientLike
        if (typeof Bun !== 'undefined') {
          // Bun's WebSocket supports headers/proxy/tls options but the DOM typings don't
          // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
          wsClient = new globalThis.WebSocket(serverRef.url, {
            protocols: ['mcp'],
            headers: wsHeaders,
            proxy: getWebSocketProxyUrl(serverRef.url),
            tls: tlsOptions || undefined,
          } as unknown as string[])
        } else {
          wsClient = await createNodeWsClient(serverRef.url, {
            headers: wsHeaders,
            agent: getWebSocketProxyAgent(serverRef.url),
            ...(tlsOptions || {}),
          })
        }
        transport = new WebSocketTransport(wsClient)
// ═══ HTTP 分支：调试日志密度最高的一段 ═══
//
// 786-799 行先把 Node 版本、平台、NODE_OPTIONS、线程池大小、
// 三个代理环境变量全打进日志。为什么这么啰嗦？
// 因为 HTTP transport 的失败往往和这些环境因素有关，
// 而用户报 bug 时不会想到提供它们。先记下来，省一轮来回。
//
// 807 行那个检查是全分支最关键的一行，注释解释了原因：
//
//   SDK 合并 requestInit 的时机在 authProvider **之后**。
//   意思是：如果服务器存了 OAuth token，authProvider 会设好 Authorization，
//   然后我们的 requestInit.headers 会**覆盖**它。
//
//   所以如果有 OAuth token，就绝不能再塞 sessionIngressToken ——
//   否则会把正确的 OAuth 凭据踩掉，让一个本来能连的服务器变成 401。
//
//   CCR 代理 URL（ccr_shttp_mcp）没有存 OAuth，所以它们仍然该拿到
//   ingress token。
//
// 注释还引了 PR 编号（#24454讨论）。这类「合并顺序决定正确性」的坑
// 在包装第三方 SDK 时非常常见 —— 判断依据不是文档，是**它内部的合并顺序**。
// ═══
      } else if (serverRef.type === 'http') {
        logMCPDebug(name, `Initializing HTTP transport to ${serverRef.url}`)
        logMCPDebug(
          name,
          `Node version: ${process.version}, Platform: ${process.platform}`,
        )
        logMCPDebug(
          name,
          `Environment: ${jsonStringify({
            NODE_OPTIONS: process.env.NODE_OPTIONS || 'not set',
            UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || 'default',
            HTTP_PROXY: process.env.HTTP_PROXY || 'not set',
            HTTPS_PROXY: process.env.HTTPS_PROXY || 'not set',
            NO_PROXY: process.env.NO_PROXY || 'not set',
          })}`,
        )

        // Create an auth provider for this server
        const authProvider = new ClaudeAuthProvider(name, serverRef)

        // Get combined headers (static + dynamic)
        const combinedHeaders = await getMcpServerHeaders(name, serverRef)

        // Check if this server has stored OAuth tokens. If so, the SDK's
        // authProvider will set Authorization — don't override with the
        // session ingress token (SDK merges requestInit AFTER authProvider).
        // CCR proxy URLs (ccr_shttp_mcp) have no stored OAuth, so they still
        // get the ingress token. See PR #24454 discussion.
        const hasOAuthTokens = !!(await authProvider.tokens())

        // Use the auth provider with StreamableHTTPClientTransport
        const proxyOptions = getProxyFetchOptions()
        logMCPDebug(
          name,
          `Proxy options: ${proxyOptions.dispatcher ? 'custom dispatcher' : 'default'}`,
        )

        const transportOptions: StreamableHTTPClientTransportOptions = {
          authProvider,
          // Use fresh timeout per request to avoid stale AbortSignal bug.
          // Step-up detection wraps innermost so the 403 is seen before the
          // SDK's handler calls auth() → tokens().
          fetch: wrapFetchWithTimeout(
            wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
          ),
          requestInit: {
            ...proxyOptions,
            headers: {
              'User-Agent': getMCPUserAgent(),
              ...(sessionIngressToken &&
                !hasOAuthTokens && {
                  Authorization: `Bearer ${sessionIngressToken}`,
                }),
              ...combinedHeaders,
            },
          },
        }

        // Redact sensitive headers before logging
        const headersForLogging = transportOptions.requestInit?.headers
          ? mapValues(
              transportOptions.requestInit.headers as Record<string, string>,
              (value, key) =>
                key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
            )
          : undefined

        logMCPDebug(
          name,
          `HTTP transport options: ${jsonStringify({
            url: serverRef.url,
            headers: headersForLogging,
            hasAuthProvider: !!authProvider,
            timeoutMs: MCP_REQUEST_TIMEOUT_MS,
          })}`,
        )

        transport = new StreamableHTTPClientTransport(
          new URL(serverRef.url),
          transportOptions,
        )
        logMCPDebug(name, `HTTP transport created successfully`)
// ═══ SDK 类型的服务器在这里直接抛错，因为不归这个文件管 ═══
//
// 'sdk' 指的是「跑在同一个进程里、由 Agent SDK 自己管理的 MCP 服务器」。
// 它们不走 connectToServer，而是走文件末尾的 setupSdkMcpClients（3262 行）。
//
// 抛错的措辞直接点名了负责的模块："SDK servers should be handled in print.ts"。
// 这种「明确指路」的错误消息，比"Unsupported type"有用得多。
// ═══
      } else if (serverRef.type === 'sdk') {
        throw new Error('SDK servers should be handled in print.ts')
// ═══ claudeai-proxy：连的是 Anthropic 的代理，不是用户的服务器 ═══
//
// 这类服务器是 claude.ai 网页上配置的「连接器」，本地 CLI 通过
// Anthropic 的代理去访问。所以：
//   · URL 是拼出来的：MCP_PROXY_URL + 模板路径（替换 server_id）
//   · 认证是 claude.ai 的 OAuth token，不是服务器自己的
//   · 走 createClaudeAiProxyFetch（带 401 重试）
//   · 多一个 X-Mcp-Client-Session-Id header（让代理能关联到会话）
//
// 874 行 `if (!tokens) throw` —— 这里是唯一一个「没 token 就直接抛」的地方。
// 因为代理连接必须有 claude.ai 登录，这不是「需要授权」而是
// 「你压根没登录」，属于配置错误。
// ═══
      } else if (serverRef.type === 'claudeai-proxy') {
        logMCPDebug(
          name,
          `Initializing claude.ai proxy transport for server ${serverRef.id}`,
        )

        const tokens = getClaudeAIOAuthTokens()
        if (!tokens) {
          throw new Error('No claude.ai OAuth token found')
        }

        const oauthConfig = getOauthConfig()
        const proxyUrl = `${oauthConfig.MCP_PROXY_URL}${oauthConfig.MCP_PROXY_PATH.replace('{server_id}', serverRef.id)}`

        logMCPDebug(name, `Using claude.ai proxy at ${proxyUrl}`)

        // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
        const fetchWithAuth = createClaudeAiProxyFetch(globalThis.fetch)

        const proxyOptions = getProxyFetchOptions()
        const transportOptions: StreamableHTTPClientTransportOptions = {
          // Wrap fetchWithAuth with fresh timeout per request
          fetch: wrapFetchWithTimeout(fetchWithAuth),
          requestInit: {
            ...proxyOptions,
            headers: {
              'User-Agent': getMCPUserAgent(),
              'X-Mcp-Client-Session-Id': getSessionId(),
            },
          },
        }

        transport = new StreamableHTTPClientTransport(
          new URL(proxyUrl),
          transportOptions,
        )
        logMCPDebug(name, `claude.ai proxy transport created successfully`)
// ═══ 进程内运行，省掉一个 325MB 的子进程 ═══
//
// Chrome MCP 服务器正常做法是 spawn 一个子进程。这里改成在同进程里跑：
//
//   createChromeContext(env)            造服务器端的上下文
//   createClaudeForChromeMcpServer(ctx) 造 MCP 服务器实例
//   createLinkedTransportPair()         造一对**互相连着**的 transport
//   inProcessServer.connect(serverT)    服务器端接上
//   transport = clientTransport         客户端用另一头
//
// 这就是 MCP 传输层抽象的价值：从客户端的角度看，进程内和跨进程
// 完全一样，因为它只看到 transport 接口（send/close/onmessage）。
// InProcessTransport.ts 只有 63 行，实现的就是一对内存里的双工管道。
//
// 代价：inProcessServer 需要单独 close（1406 行），
// 而且它在 try 外声明（609 行）以便 catch 块也能关。
// ═══
      } else if (
        (serverRef.type === 'stdio' || !serverRef.type) &&
        isClaudeInChromeMCPServer(name)
      ) {
        // Run the Chrome MCP server in-process to avoid spawning a ~325 MB subprocess
        const { createChromeContext } = await import(
          '../../utils/claudeInChrome/mcpServer.js'
        )
        const { createClaudeForChromeMcpServer } = await import(
          '@ant/claude-for-chrome-mcp'
        )
        const { createLinkedTransportPair } = await import(
          './InProcessTransport.js'
        )
        const context = createChromeContext(serverRef.env)
        inProcessServer = createClaudeForChromeMcpServer(context)
        const [clientTransport, serverTransport] = createLinkedTransportPair()
        await inProcessServer.connect(serverTransport)
        transport = clientTransport
        logMCPDebug(name, `In-process Chrome MCP server started`)
// ═══ 同样的进程内方案，但外面套了 feature 门 ═══
//
// 注释里有个关键信息："The package's CallTool handler is a stub;
// real dispatch goes through wrapper.tsx's .call() override."
//
// 也就是说这个 MCP 服务器里的 CallTool 实现是**空的**。
// 真正的工具执行走 wrapper.tsx 里覆盖的 .call()（1986 行的
// getComputerUseMCPToolOverrides 就是它的一部分）。
//
// 为什么要这么绕：Computer Use 需要原生模块访问屏幕和输入设备，
// 而原生模块不能跨进程传。所以「MCP 协议」在这里只起到**工具发现**
// 的作用（让模型知道有哪些工具、schema 是什么），执行完全在本地接管。
// ═══
      } else if (
        feature('CHICAGO_MCP') &&
        (serverRef.type === 'stdio' || !serverRef.type) &&
        isComputerUseMCPServer!(name)
      ) {
        // Run the Computer Use MCP server in-process — same rationale as
        // Chrome above. The package's CallTool handler is a stub; real
        // dispatch goes through wrapper.tsx's .call() override.
        const { createComputerUseMcpServerForCli } = await import(
          '../../utils/computerUse/mcpServer.js'
        )
        const { createLinkedTransportPair } = await import(
          './InProcessTransport.js'
        )
        inProcessServer = await createComputerUseMcpServerForCli()
        const [clientTransport, serverTransport] = createLinkedTransportPair()
        await inProcessServer.connect(serverTransport)
        transport = clientTransport
        logMCPDebug(name, `In-process Computer Use MCP server started`)
// ═══ stdio：最常见的一种，也是坑最多的一种 ═══
//
// 947 行 CLAUDE_CODE_SHELL_PREFIX 的处理很有意思：
//
//   没有前缀 → command 和 args 分开传（正常 execve）
//   有前缀   → 把 [command, ...args].join(' ') 变成**一个字符串**，
//              整条交给前缀去执行
//
// 用途：让用户可以用 `npx`、`docker run`、`sandbox-exec` 这类
// 包装器统一拦截所有 MCP 服务器（做沙箱、做审计）。
// 但这样一来参数就不能分开了 —— 因为包装器拿到的是字符串。
//
// 957 行 `stderr: 'pipe'` 的注释说明目的：防止 MCP 服务器往 stderr
// 写的东西直接打到 UI 上（那会把 Ink 渲染出来的终端界面撕烂）。
// 接到管道里之后，由 971 行的 handler 累积、失败时一次性打进调试日志。
// ═══
      } else if (serverRef.type === 'stdio' || !serverRef.type) {
        const finalCommand =
          process.env.CLAUDE_CODE_SHELL_PREFIX || serverRef.command
        const finalArgs = process.env.CLAUDE_CODE_SHELL_PREFIX
          ? [[serverRef.command, ...serverRef.args].join(' ')]
          : serverRef.args
        transport = new StdioClientTransport({
          command: finalCommand,
          args: finalArgs,
          env: {
            ...subprocessEnv(),
            ...serverRef.env,
          } as Record<string, string>,
          stderr: 'pipe', // prevents error output from the MCP server from printing to the UI
        })
      } else {
        throw new Error(`Unsupported server type: ${serverRef.type}`)
      }

// ═══ 在 connect 之前就挂 stderr 监听，因为连接期最容易出错 ═══
//
// 注释说得很清楚：连接启动期间就可能已经有 stderr 输出，
// 而那正是最需要看的时候（连不上时服务器通常会往 stderr 喷错误）。
//
// 两个纪律：
//   1. 64MB 上限（973 行）。不加会无界增长 —— 一个死循环往 stderr
//      写日志的服务器能把内存吃光。
//   2. handler 引用要留着（966 行），cleanup 时 off 掉（1423 行）。
//      不 unref 的话，transport 被回收了、监听器还挂在 stream 上，内存泄漏。
//
// 注意 try/catch 包的是 `stderrOutput += data.toString()`：
// 字符串超过 V8 上限（约 512MB）会抛错。上限 64MB 让这个 catch
// 实际上几乎不会触发，但留着是对的 —— 成本是一对括号。
// ═══
      // Set up stderr logging for stdio transport before connecting in case there are any stderr
      // outputs emitted during the connection start (this can be useful for debugging failed connections).
      // Store handler reference for cleanup to prevent memory leaks
      let stderrHandler: ((data: Buffer) => void) | undefined
      let stderrOutput = ''
      if (serverRef.type === 'stdio' || !serverRef.type) {
        const stdioTransport = transport as StdioClientTransport
        if (stdioTransport.stderr) {
          stderrHandler = (data: Buffer) => {
            // Cap stderr accumulation to prevent unbounded memory growth
            if (stderrOutput.length < 64 * 1024 * 1024) {
              try {
                stderrOutput += data.toString()
              } catch {
                // Ignore errors from exceeding max string length
              }
            }
          }
          stdioTransport.stderr.on('data', stderrHandler)
        }
      }

// ═══ 声明能力时用空对象，是一个兼容性妥协 ═══
//
// 994-1000 行声明两个能力：roots 和 elicitation。
// 注意它们都是 `{}`，注释解释了为什么不能写得更"详细"：
//
//   写 { form: {}, url: {} } 会让 Java 的 MCP SDK 服务器崩掉。
//   原因：Spring AI 的 Elicitation 类零字段，反序列化遇到未知属性就失败。
//
// 于是「按 spec 应该能写」的形状，在具体实现上会炸。
// 所以只能声明能力存在（空对象 = 我支持这个能力），不声明细节。
//
// 这是接生态时的常态：spec 是下限，实现是现实。
// 同类问题在 MCP 生态里还有不少（不同语言 SDK 的 schema 严格程度不同）。
// ═══
      const client = new Client(
        {
          name: 'claude-code',
          title: 'Claude Code',
          version: MACRO.VERSION ?? 'unknown',
          description: "Anthropic's agentic coding tool",
          websiteUrl: PRODUCT_URL,
        },
        {
          capabilities: {
            roots: {},
            // Empty object declares the capability. Sending {form:{},url:{}}
            // breaks Java MCP SDK servers (Spring AI) whose Elicitation class
            // has zero fields and fails on unknown properties.
            elicitation: {},
          },
        },
      )

      // Add debug logging for client events if available
      if (serverRef.type === 'http') {
        logMCPDebug(name, `Client created, setting up request handler`)
      }

// ═══ roots：告诉服务器「你能访问哪里」═══
//
// MCP 的 roots 概念 = 客户端声明的工作区边界。服务器可以问客户端
// 「你的根目录在哪」，然后在自己的实现里据此限制文件访问。
//
// 这里直接返回原始工作目录（getOriginalCwd，注意不是当前 cwd ——
// 用户可能 cd 到别处，但根是启动时的那个）。
//
// 它是个 handler 而不是配置项，因为协议允许服务器**随时**问
// （工作区可能变）。这里每次返回同一个值，是最简实现。
// ═══
      client.setRequestHandler(ListRootsRequestSchema, async () => {
        logMCPDebug(name, `Received ListRoots request from server`)
        return {
          roots: [
            {
              uri: `file://${getOriginalCwd()}`,
            },
          ],
        }
      })

// ═══ 连接超时用 Promise.race + 手动清理，三个细节 ═══
//
// ① 超时后必须**主动关 transport**（1059 行）。
//    race 只是丢弃了 connectPromise，它并没有被取消，底层连接还在建。
//    不关的话就是泄漏：连接最后可能成功，但没人持有它。
//
// ② connectPromise.then(clearTimeout, clearTimeout)（1069 行）。
//    两个回调写成一样，看着冗余，其实是必要的：
//    Promise 的 .then 只处理成功，.catch 只处理失败，
//    要同时处理两者就得传两个参数。写在 then 里比
//    `.finally()` 更早（finally 要等 promise 链下一拍）。
//
// ③ 超时错误用 TelemetrySafeError 包装，消息里带服务器名和配置值。
//    因为连接超时是用户最常报的问题之一，日志得能直接看出
//    「是哪个服务器、等了多久」。
//
// DEFAULT 是 30 秒（456 行 getConnectionTimeoutMs），可用 MCP_TIMEOUT 覆盖。
// 注意它和工具调用超时（约 27.8 小时）差了三个数量级 —— 这不是笔误：
// **连接**该快，**执行**不该限时。
// ═══
      // Add a timeout to connection attempts to prevent tests from hanging indefinitely
      logMCPDebug(
        name,
        `Starting connection with timeout of ${getConnectionTimeoutMs()}ms`,
      )

      // For HTTP transport, try a basic connectivity test first
      if (serverRef.type === 'http') {
        logMCPDebug(name, `Testing basic HTTP connectivity to ${serverRef.url}`)
        try {
          const testUrl = new URL(serverRef.url)
          logMCPDebug(
            name,
            `Parsed URL: host=${testUrl.hostname}, port=${testUrl.port || 'default'}, protocol=${testUrl.protocol}`,
          )

          // Log DNS resolution attempt
          if (
            testUrl.hostname === '127.0.0.1' ||
            testUrl.hostname === 'localhost'
          ) {
            logMCPDebug(name, `Using loopback address: ${testUrl.hostname}`)
          }
        } catch (urlError) {
          logMCPDebug(name, `Failed to parse URL: ${urlError}`)
        }
      }

      const connectPromise = client.connect(transport)
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          const elapsed = Date.now() - connectStartTime
          logMCPDebug(
            name,
            `Connection timeout triggered after ${elapsed}ms (limit: ${getConnectionTimeoutMs()}ms)`,
          )
          if (inProcessServer) {
            inProcessServer.close().catch(() => {})
          }
          transport.close().catch(() => {})
          reject(
            new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
              `MCP server "${name}" connection timed out after ${getConnectionTimeoutMs()}ms`,
              'MCP connection timeout',
            ),
          )
        }, getConnectionTimeoutMs())

        // Clean up timeout if connect resolves or rejects
        connectPromise.then(
          () => {
            clearTimeout(timeoutId)
          },
          _error => {
            clearTimeout(timeoutId)
          },
        )
      })

      try {
        await Promise.race([connectPromise, timeoutPromise])
        if (stderrOutput) {
          logMCPError(name, `Server stderr: ${stderrOutput}`)
          stderrOutput = '' // Release accumulated string to prevent memory growth
        }
        const elapsed = Date.now() - connectStartTime
        logMCPDebug(
          name,
          `Successfully connected (transport: ${serverRef.type || 'stdio'}) in ${elapsed}ms`,
        )
      } catch (error) {
        const elapsed = Date.now() - connectStartTime
        // SSE-specific error logging
        if (serverRef.type === 'sse' && error instanceof Error) {
          logMCPDebug(
            name,
            `SSE Connection failed after ${elapsed}ms: ${jsonStringify({
              url: serverRef.url,
              error: error.message,
              errorType: error.constructor.name,
              stack: error.stack,
            })}`,
          )
          logMCPError(name, error)

          if (error instanceof UnauthorizedError) {
            return handleRemoteAuthFailure(name, serverRef, 'sse')
          }
        } else if (serverRef.type === 'http' && error instanceof Error) {
          const errorObj = error as Error & {
            cause?: unknown
            code?: string
            errno?: string | number
            syscall?: string
          }
          logMCPDebug(
            name,
            `HTTP Connection failed after ${elapsed}ms: ${error.message} (code: ${errorObj.code || 'none'}, errno: ${errorObj.errno || 'none'})`,
          )
          logMCPError(name, error)

          if (error instanceof UnauthorizedError) {
            return handleRemoteAuthFailure(name, serverRef, 'http')
          }
        } else if (
          serverRef.type === 'claudeai-proxy' &&
          error instanceof Error
        ) {
          logMCPDebug(
            name,
            `claude.ai proxy connection failed after ${elapsed}ms: ${error.message}`,
          )
          logMCPError(name, error)

          // StreamableHTTPError has a `code` property with the HTTP status
          const errorCode = (error as Error & { code?: number }).code
          if (errorCode === 401) {
            return handleRemoteAuthFailure(name, serverRef, 'claudeai-proxy')
          }
        } else if (
          serverRef.type === 'sse-ide' ||
          serverRef.type === 'ws-ide'
        ) {
          logEvent('tengu_mcp_ide_server_connection_failed', {
            connectionDurationMs: elapsed,
          })
        }
        if (inProcessServer) {
          inProcessServer.close().catch(() => {})
        }
        transport.close().catch(() => {})
        if (stderrOutput) {
          logMCPError(name, `Server stderr: ${stderrOutput}`)
        }
        throw error
      }

// ═══ instructions 也截断到 2048 字符 ═══
//
// MCP 服务器可以在握手时返回一段 instructions，客户端通常会把它
// 拼进系统提示词。问题：有些服务器（尤其 OpenAPI 自动生成的那些）
// 会塞十几到几十 KB 的端点文档进去。
//
// 2048 这个上限同时用在两处：
//   · 这里的 instructions
//   · fetchToolsForClient 里每个工具的 description（1791 行）
//
// 注释说这个值「caps the p95 tail without losing the intent」——
// 按分位数定的，不是按最大值。
// ═══
      const capabilities = client.getServerCapabilities()
      const serverVersion = client.getServerVersion()
      const rawInstructions = client.getInstructions()
      let instructions = rawInstructions
      if (
        rawInstructions &&
        rawInstructions.length > MAX_MCP_DESCRIPTION_LENGTH
      ) {
        instructions =
          rawInstructions.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '… [truncated]'
        logMCPDebug(
          name,
          `Server instructions truncated from ${rawInstructions.length} to ${MAX_MCP_DESCRIPTION_LENGTH} chars`,
        )
      }

      // Log successful connection details
      logMCPDebug(
        name,
        `Connection established with capabilities: ${jsonStringify({
          hasTools: !!capabilities?.tools,
          hasPrompts: !!capabilities?.prompts,
          hasResources: !!capabilities?.resources,
          hasResourceSubscribe: !!capabilities?.resources?.subscribe,
          serverVersion: serverVersion || 'unknown',
        })}`,
      )
      logForDebugging(
        `[MCP] Server "${name}" connected with subscribe=${!!capabilities?.resources?.subscribe}`,
      )

// ═══ 默认 elicitation handler 返回 cancel，覆盖一个时间窗口 ═══
//
// 时序问题：连接建立之后、真正注册 elicitation handler 之前，
// 有一段窗口期（在 useManageMCPConnections 的 onConnectionAttempt 里
// 才会调 registerElicitationHandler 把它覆盖掉）。
// 这段窗口里如果服务器发来 elicitation 请求，没有 handler 会怎样？
// SDK 的行为是报错或者挂住 —— 两种都不好。
//
// 所以先注册一个「一律 cancel」的默认实现。cancel 是安全的：
// 服务器收到 cancel 会当作「用户拒绝」，走它自己的降级路径，
// 不会卡住。
//
// 这是「初始化期的安全默认值」模式：宁可给出一个保守的确定答案，
// 也不要留一个未定义行为。
// ═══
      // Register default elicitation handler that returns cancel during the
      // window before registerElicitationHandler overwrites it in
      // onConnectionAttempt (useManageMCPConnections).
      client.setRequestHandler(ElicitRequestSchema, async request => {
        logMCPDebug(
          name,
          `Elicitation request received during initialization: ${jsonStringify(request)}`,
        )
        return { action: 'cancel' as const }
      })

      if (serverRef.type === 'sse-ide' || serverRef.type === 'ws-ide') {
        const ideConnectionDurationMs = Date.now() - connectStartTime
        logEvent('tengu_mcp_ide_server_connection_succeeded', {
          connectionDurationMs: ideConnectionDurationMs,
          serverVersion:
            serverVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        try {
          void maybeNotifyIDEConnected(client)
        } catch (error) {
          logMCPError(
            name,
            `Failed to send ide_connected notification: ${error}`,
          )
        }
      }

// ═══════════════════════════════════════════════════════════════
// 【全文件最重要的 140 行】错误桥接：补上 SDK 缺的那一半
//
// 先说清楚 SDK 给了什么、缺了什么：
//
//   transport 连接失败 → 调 client.onerror（✅ 有）
//   transport 连接失败 → 调 client.onclose（❌ 没有）
//
// 而 CC 的重连机制**完全依赖 onclose**（1374 行那个 handler 会
// 清掉连接缓存，让下一次调用重新连）。
//
// 于是出现问题：一条 SSE 流被中间设备掐断后，
//   · onerror 被调用 → 我们只记了日志
//   · onclose 永远不来 → 缓存不清
//   · 下一次工具调用拿到的是那个已经死掉的 client
//   · callTool() 的 promise **永远挂着**（既不 resolve 也不 reject）
//   · 用户在界面上看到工具一直在转，按 Esc 才有反应
//
// 这就是「不是我们的 bug，但必须我们修」的典型。
//
// 解法三件套：
//   ① 自己数连续 terminal 错误（1227 行，阈值 3）
//   ② 数到 3 就主动 close（1359 行）—— 借关闭动作触发 onclose 链
//   ③ 用 hasTriggeredClose 防重入（1232 行）
//
// 还有两条**绕过计数**的快速路径：
//   · 会话过期（404 + -32001）→ 立即 close（1324 行）
//   · SDK 自己重连耗尽（"Maximum reconnection attempts"）→ 立即 close（1343 行）
//
// 第二条的注释特别值得读：SDK 的 StreamableHTTP transport 在耗尽
// 自己的重连次数（默认 maxRetries: 2）后会 fire 这个 onerror，
// 但**从不调 onclose**。所以它是「transport 已放弃」的确定信号，
// 不能等三振，必须立刻 close。
// ═══════════════════════════════════════════════════════════════
      // Enhanced connection drop detection and logging for all transport types
      const connectionStartTime = Date.now()
      let hasErrorOccurred = false

      // Store original handlers
      const originalOnerror = client.onerror
      const originalOnclose = client.onclose

      // The SDK's transport calls onerror on connection failures but doesn't call onclose,
      // which CC uses to trigger reconnection. We bridge this gap by tracking consecutive
      // terminal errors and manually closing after MAX_ERRORS_BEFORE_RECONNECT failures.
      let consecutiveConnectionErrors = 0
      const MAX_ERRORS_BEFORE_RECONNECT = 3

      // Guard against re-entry: close() aborts in-flight streams which may fire
      // onerror again before the close chain completes.
      let hasTriggeredClose = false

      // client.close() → transport.close() → transport.onclose → SDK's _onclose():
      // rejects all pending request handlers (so hung callTool() promises fail with
      // McpError -32000 "Connection closed") and then invokes our client.onclose
      // handler below (which clears the memo cache so the next call reconnects).
      // Calling client.onclose?.() directly would only clear the cache — pending
      // tool calls would stay hung.
// ═══ 为什么不能直接调 client.onclose?.() ═══
//
// 这行注释值得逐句读，因为它解释了一次真实的踩坑：
//
//   我们想做的事：清缓存，让下次调用重连。
//   朴素做法：直接调 client.onclose?.()  ← 只清了缓存，**挂起的调用还挂着**
//
//   正确做法：client.close()
//             → transport.close()
//             → transport.onclose（SDK 内部的）
//             → SDK 的 _onclose()
//             → reject 所有 pending request handler
//                （挂着的 callTool() 得到 McpError -32000 "Connection closed"）
//             → 最后才调我们的 client.onclose（清缓存）
//
// 差别在于**挂起的 promise 有没有被 reject**。
// 直接调我们的 handler 只是「假装关闭」，那些正在等响应的调用
// 会无限期挂着 —— 而它们的调用方（工具执行层）没有超时保护。
//
// hasTriggeredClose 那个 flag（1232 行）是为了防重入：
// client.close() 会中止在途的流，可能再次触发 onerror，
// 而 onerror 里又会调这个函数。没有 flag 就是无限递归。
// ═══
      const closeTransportAndRejectPending = (reason: string) => {
        if (hasTriggeredClose) return
        hasTriggeredClose = true
        logMCPDebug(name, `Closing transport (${reason})`)
        void client.close().catch(e => {
          logMCPDebug(name, `Error during close: ${errorMessage(e)}`)
        })
      }

// ═══ 用字符串匹配判断「这是不是致命错误」═══
//
// 没有别的办法。Node 的 socket 错误和 SDK 的包装错误都不带
// 可分类的 code 字段，只能在 message 里找子串。
//
// 列表分两类：
//   网络层   ECONNRESET / ETIMEDOUT / EPIPE / EHOSTUNREACH / ECONNREFUSED
//            Body Timeout Error / terminated
//   SDK 层   SSE stream disconnected / Failed to reconnect SSE stream
//
// 后者是注释特别说明的：SDK 会把真实网络错误**包在**这些消息里，
// 所以上面那批子串匹配不到 —— 必须单独列出。
//
// 和 withRetry.ts 的 parseMaxTokensContextOverflowError 一样，
// 这类代码是全系统最脆弱的地方：换个 SDK 版本、改个标点，
// 匹配就静默失效。失效后的表现是「重连机制不工作」，
// 而不会有任何报错告诉你原因。
// ═══
      const isTerminalConnectionError = (msg: string): boolean => {
        return (
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('EPIPE') ||
          msg.includes('EHOSTUNREACH') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('Body Timeout Error') ||
          msg.includes('terminated') ||
          // SDK SSE reconnection intermediate errors — may be wrapped around the
          // actual network error, so the substrings above won't match
          msg.includes('SSE stream disconnected') ||
          msg.includes('Failed to reconnect SSE stream')
        )
      }

      // Enhanced error handler with detailed logging
// ═══ 一个 if-else 链，把六种错误翻译成人话 ═══
//
// ECONNRESET     → 服务器可能崩了或重启了
// ETIMEDOUT      → 网络问题或服务器没响应
// ECONNREFUSED   → 服务器可能没起来
// EPIPE          → 服务器异常关闭了连接
// EHOSTUNREACH   → 网络不通
// ESRCH          → stdio 的进程没了
// "spawn"        → 命令没找到或没权限
//
// 这不是给用户看的，是给调试日志看的。但这些翻译有实际价值：
// 用户报「MCP 服务器连不上」时，日志里那句
// "Failed to spawn process - check command and permissions"
// 直接把排查方向指出来了，省掉一整轮问答。
//
// 附带记录 uptime（连接存活了多久）。这个数字在排查时很有用：
// 3 秒就断 vs 3 小时才断，是完全不同的两类问题。
// ═══
      client.onerror = (error: Error) => {
        const uptime = Date.now() - connectionStartTime
        hasErrorOccurred = true
        const transportType = serverRef.type || 'stdio'

        // Log the connection drop with context
        logMCPDebug(
          name,
          `${transportType.toUpperCase()} connection dropped after ${Math.floor(uptime / 1000)}s uptime`,
        )

        // Log specific error details for debugging
        if (error.message) {
          if (error.message.includes('ECONNRESET')) {
            logMCPDebug(
              name,
              `Connection reset - server may have crashed or restarted`,
            )
          } else if (error.message.includes('ETIMEDOUT')) {
            logMCPDebug(
              name,
              `Connection timeout - network issue or server unresponsive`,
            )
          } else if (error.message.includes('ECONNREFUSED')) {
            logMCPDebug(name, `Connection refused - server may be down`)
          } else if (error.message.includes('EPIPE')) {
            logMCPDebug(
              name,
              `Broken pipe - server closed connection unexpectedly`,
            )
          } else if (error.message.includes('EHOSTUNREACH')) {
            logMCPDebug(name, `Host unreachable - network connectivity issue`)
          } else if (error.message.includes('ESRCH')) {
            logMCPDebug(
              name,
              `Process not found - stdio server process terminated`,
            )
          } else if (error.message.includes('spawn')) {
            logMCPDebug(
              name,
              `Failed to spawn process - check command and permissions`,
            )
          } else {
            logMCPDebug(name, `Connection error: ${error.message}`)
          }
        }

// ═══ 会话过期走捷径：不等三振，直接 close ═══
//
// 逻辑链条：
//   404 + -32001 → 这个 session ID 服务器已经不认了
//   → 这个连接**永远**不可用了（不是「可能暂时断了」）
//   → 没必要等三次，立刻 close
//   → close 触发 onclose → 清缓存 → 下次调用重新建连拿新 session ID
//
// 注意 1325 行还调了 originalOnerror：
// 我们接管了 onerror，但不能**吞掉**原 handler。原 handler 负责
// SDK 内部的其他清理。所以每个提前 return 的分支都必须
// 「做完自己的事 + 把事件传下去」。
//
// 这个纪律在 1316-1365 这段里出现三次（1325、1344、1368）。
// 漏一次就会让 SDK 内部状态不一致。
// ═══
        // For HTTP transports, detect session expiry (404 + JSON-RPC -32001)
        // and close the transport so pending tool calls reject and the next
        // call reconnects with a fresh session ID.
        if (
          (transportType === 'http' || transportType === 'claudeai-proxy') &&
          isMcpSessionExpiredError(error)
        ) {
          logMCPDebug(
            name,
            `MCP session expired (server returned 404 with session-not-found), triggering reconnection`,
          )
          closeTransportAndRejectPending('session expired')
          if (originalOnerror) {
            originalOnerror(error)
          }
          return
        }

        // For remote transports (SSE/HTTP), track terminal connection errors
        // and trigger reconnection via close if we see repeated failures.
        if (
          transportType === 'sse' ||
          transportType === 'http' ||
          transportType === 'claudeai-proxy'
        ) {
          // The SDK's StreamableHTTP transport fires this after exhausting its
          // own SSE reconnect attempts (default maxRetries: 2) — but it never
          // calls onclose, so pending callTool() promises hang indefinitely.
          // This is the definitive "transport gave up" signal.
          if (error.message.includes('Maximum reconnection attempts')) {
            closeTransportAndRejectPending('SSE reconnection exhausted')
            if (originalOnerror) {
              originalOnerror(error)
            }
            return
          }

          if (isTerminalConnectionError(error.message)) {
            consecutiveConnectionErrors++
            logMCPDebug(
              name,
              `Terminal connection error ${consecutiveConnectionErrors}/${MAX_ERRORS_BEFORE_RECONNECT}`,
            )

            if (consecutiveConnectionErrors >= MAX_ERRORS_BEFORE_RECONNECT) {
              consecutiveConnectionErrors = 0
              closeTransportAndRejectPending('max consecutive terminal errors')
            }
          } else {
            // Non-terminal error (e.g., transient issue), reset counter
            consecutiveConnectionErrors = 0
          }
        }

        // Call original handler
        if (originalOnerror) {
          originalOnerror(error)
        }
      }

// ═══ onclose：**五个**缓存要清 ═══
//
// 这是最容易被后来者改坏的地方。看清单：
//
//   fetchToolsForClient.cache      工具列表
//   fetchResourcesForClient.cache  资源列表
//   fetchCommandsForClient.cache   提示词/命令列表
//   fetchMcpSkillsForClient.cache  技能（feature 门后面）
//   connectToServer.cache          连接本身
//
// 为什么四个 fetch 缓存也要清（注释 1386 行解释）：
// 重连会造一个**新的**连接对象。但四个 fetch 缓存是按**服务器名**
// 做键的（不是按连接对象），所以不清的话下次 fetch 会
// 返回旧连接的工具列表 —— 而旧连接已经死了。
//
// 表现是什么？重连成功了，但工具调用打到旧 client 上，又失败一次。
// 用户看到「重连了但还是不行」，而日志里完全正常。
//
// 这个 bug 类型叫「按错误维度做键」：缓存键应该跟着**内容的生命周期**走，
// 而内容的生命周期是连接，不是服务器名。用名字做键是为了让重连后
// 能命中同一个缓存槽 —— 那就必须在重连时手动清。
// ═══
      // Enhanced close handler with connection drop context
      client.onclose = () => {
        const uptime = Date.now() - connectionStartTime
        const transportType = serverRef.type ?? 'unknown'

        logMCPDebug(
          name,
          `${transportType.toUpperCase()} connection closed after ${Math.floor(uptime / 1000)}s (${hasErrorOccurred ? 'with errors' : 'cleanly'})`,
        )

        // Clear the memoization cache so next operation reconnects
        const key = getServerCacheKey(name, serverRef)

        // Also clear fetch caches (keyed by server name). Reconnection
        // creates a new connection object; without clearing, the next
        // fetch would return stale tools/resources from the old connection.
        fetchToolsForClient.cache.delete(name)
        fetchResourcesForClient.cache.delete(name)
        fetchCommandsForClient.cache.delete(name)
        if (feature('MCP_SKILLS')) {
          fetchMcpSkillsForClient!.cache.delete(name)
        }

        connectToServer.cache.delete(key)
        logMCPDebug(name, `Cleared connection cache for reconnection`)

        if (originalOnclose) {
          originalOnclose()
        }
      }

// ═══ 清理函数：三级信号升级，总预算 500ms ═══
//
// 这段代码 160 行，全是为了一个目的：**让子进程死透**。
//
// 为什么必须手写（1427 行注释）：
//   StdioClientTransport.close() 只发一个 abort signal。
//   但很多 MCP 服务器（尤其 Docker 容器里的）不响应 abort，
//   它们要真正的 SIGINT/SIGTERM 才能优雅退出。
//   不手写的后果：每次退出 CLI 都留一堆僵尸进程。
//
// 升级序列：
//   SIGINT   → 等 100ms → 检查进程还在不在
//   SIGTERM  → 等 400ms → 再检查
//   SIGKILL  → 不等待
//
// 每一级都用 `process.kill(pid, 0)` 探测存活 —— 信号 0 不发信号，
// 只做权限和存在性检查，是 POSIX 的标准做法。
//
// 总预算 500ms 的理由写在注释里："to keep CLI responsive"。
// 用户按 Ctrl+C 之后，500ms 内必须回到提示符，否则感觉像卡住了。
//
// 另外还有两个 600ms 的 failsafe（1467 行、1542 行）：
// 无论发生什么，500-600ms 内一定 resolve。
// 这类「绝对兜底」在清理路径上很常见 —— 清理代码本身卡住
// 是最糟糕的失败模式，因为它会让整个进程无法退出。
// ═══
      const cleanup = async () => {
        // In-process servers (e.g. Chrome MCP) don't have child processes or stderr
        if (inProcessServer) {
          try {
            await inProcessServer.close()
          } catch (error) {
            logMCPDebug(name, `Error closing in-process server: ${error}`)
          }
          try {
            await client.close()
          } catch (error) {
            logMCPDebug(name, `Error closing client: ${error}`)
          }
          return
        }

        // Remove stderr event listener to prevent memory leaks
        if (stderrHandler && (serverRef.type === 'stdio' || !serverRef.type)) {
          const stdioTransport = transport as StdioClientTransport
          stdioTransport.stderr?.off('data', stderrHandler)
        }

        // For stdio transports, explicitly terminate the child process with proper signals
        // NOTE: StdioClientTransport.close() only sends an abort signal, but many MCP servers
        // (especially Docker containers) need explicit SIGINT/SIGTERM signals to trigger graceful shutdown
        if (serverRef.type === 'stdio') {
          try {
            const stdioTransport = transport as StdioClientTransport
            const childPid = stdioTransport.pid

            if (childPid) {
              logMCPDebug(name, 'Sending SIGINT to MCP server process')

              // First try SIGINT (like Ctrl+C)
              try {
                process.kill(childPid, 'SIGINT')
              } catch (error) {
                logMCPDebug(name, `Error sending SIGINT: ${error}`)
                return
              }

              // Wait for graceful shutdown with rapid escalation (total 500ms to keep CLI responsive)
              await new Promise<void>(async resolve => {
                let resolved = false

                // Set up a timer to check if process still exists
                const checkInterval = setInterval(() => {
                  try {
                    // process.kill(pid, 0) checks if process exists without killing it
                    process.kill(childPid, 0)
                  } catch {
                    // Process no longer exists
                    if (!resolved) {
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      logMCPDebug(name, 'MCP server process exited cleanly')
                      resolve()
                    }
                  }
                }, 50)

                // Absolute failsafe: clear interval after 600ms no matter what
                const failsafeTimeout = setTimeout(() => {
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    logMCPDebug(
                      name,
                      'Cleanup timeout reached, stopping process monitoring',
                    )
                    resolve()
                  }
                }, 600)

                try {
                  // Wait 100ms for SIGINT to work (usually much faster)
                  await sleep(100)

                  if (!resolved) {
                    // Check if process still exists
                    try {
                      process.kill(childPid, 0)
                      // Process still exists, SIGINT failed, try SIGTERM
                      logMCPDebug(
                        name,
                        'SIGINT failed, sending SIGTERM to MCP server process',
                      )
                      try {
                        process.kill(childPid, 'SIGTERM')
                      } catch (termError) {
                        logMCPDebug(name, `Error sending SIGTERM: ${termError}`)
                        resolved = true
                        clearInterval(checkInterval)
                        clearTimeout(failsafeTimeout)
                        resolve()
                        return
                      }
                    } catch {
                      // Process already exited
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      resolve()
                      return
                    }

                    // Wait 400ms for SIGTERM to work (slower than SIGINT, often used for cleanup)
                    await sleep(400)

                    if (!resolved) {
                      // Check if process still exists
                      try {
                        process.kill(childPid, 0)
                        // Process still exists, SIGTERM failed, force kill with SIGKILL
                        logMCPDebug(
                          name,
                          'SIGTERM failed, sending SIGKILL to MCP server process',
                        )
                        try {
                          process.kill(childPid, 'SIGKILL')
                        } catch (killError) {
                          logMCPDebug(
                            name,
                            `Error sending SIGKILL: ${killError}`,
                          )
                        }
                      } catch {
                        // Process already exited
                        resolved = true
                        clearInterval(checkInterval)
                        clearTimeout(failsafeTimeout)
                        resolve()
                      }
                    }
                  }

                  // Final timeout - always resolve after 500ms max (total cleanup time)
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    resolve()
                  }
                } catch {
                  // Handle any errors in the escalation sequence
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    resolve()
                  }
                }
              })
            }
          } catch (processError) {
            logMCPDebug(name, `Error terminating process: ${processError}`)
          }
        }

        // Close the client connection (which also closes the transport)
        try {
          await client.close()
        } catch (error) {
          logMCPDebug(name, `Error closing client: ${error}`)
        }
      }

// ═══ 注册到全局 cleanup，覆盖所有 transport ═══
//
// 注意注释强调的 "even network transports might need cleanup"：
// 直觉上只有 stdio 有子进程要杀，网络连接关了就行。
// 但实际上 HTTP/SSE 也有要清理的东西（在途请求、心跳定时器、
// 原生 socket 的 keep-alive 池）。
//
// wrappedCleanup 做的事很简单：先从全局注册表摘掉自己，再执行清理。
// 摘掉自己是为了避免重复执行 —— 进程退出时会遍历全局注册表，
// 如果这个 server 已经被单独关闭过，它的 cleanup 不该再跑一遍。
// ═══
      // Register cleanup for all transport types - even network transports might need cleanup
      // This ensures all MCP servers get properly terminated, not just stdio ones
      const cleanupUnregister = registerCleanup(cleanup)

      // Create the wrapped cleanup that includes unregistering
      const wrappedCleanup = async () => {
        cleanupUnregister?.()
        await cleanup()
      }

      const connectionDurationMs = Date.now() - connectStartTime
      logEvent('tengu_mcp_server_connection_succeeded', {
        connectionDurationMs,
        transportType: (serverRef.type ??
          'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        totalServers: serverStats?.totalServers,
        stdioCount: serverStats?.stdioCount,
        sseCount: serverStats?.sseCount,
        httpCount: serverStats?.httpCount,
        sseIdeCount: serverStats?.sseIdeCount,
        wsIdeCount: serverStats?.wsIdeCount,
        ...mcpBaseUrlAnalytics(serverRef),
      })
      return {
        name,
        client,
        type: 'connected' as const,
        capabilities: capabilities ?? {},
        serverInfo: serverVersion,
        instructions,
        config: serverRef,
        cleanup: wrappedCleanup,
      }
// ═══ 兜底的 catch：返回 failed 对象，**不抛** ═══
//
// 这是整个「错误即数据」设计的落地点。三个处理：
//   1. 埋点（带 transport 类型和各类服务器计数）
//   2. 日志（调试日志 + MCP 错误日志各一条）
//   3. 关掉可能存在的 inProcessServer（因为 1147 行那个只覆盖连接失败，
//      不覆盖分支里的同步抛错，比如 876 行的「没 claude.ai token」）
//
// 不抛的收益：getMcpToolsCommandsAndResources 里那个 pMap
// 不需要任何 try/catch 就能跑完 20 个服务器。一个坏服务器
// 只是产出 `{type:'failed'}`，不影响其他 19 个。
//
// 代价：所有消费方都必须先判 type。这个代价是实实在在的 ——
// 全文件里 type 检查出现了几十次，每次都是「万一它是 failed 呢」。
// 换来的收益是「局部失败不扩散」，在连接外部系统的场景里值得。
// ═══
    } catch (error) {
      const connectionDurationMs = Date.now() - connectStartTime
      logEvent('tengu_mcp_server_connection_failed', {
        connectionDurationMs,
        totalServers: serverStats?.totalServers || 1,
        stdioCount:
          serverStats?.stdioCount || (serverRef.type === 'stdio' ? 1 : 0),
        sseCount: serverStats?.sseCount || (serverRef.type === 'sse' ? 1 : 0),
        httpCount:
          serverStats?.httpCount || (serverRef.type === 'http' ? 1 : 0),
        sseIdeCount:
          serverStats?.sseIdeCount || (serverRef.type === 'sse-ide' ? 1 : 0),
        wsIdeCount:
          serverStats?.wsIdeCount || (serverRef.type === 'ws-ide' ? 1 : 0),
        transportType: (serverRef.type ??
          'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...mcpBaseUrlAnalytics(serverRef),
      })
      logMCPDebug(
        name,
        `Connection failed after ${connectionDurationMs}ms: ${errorMessage(error)}`,
      )
      logMCPError(name, `Connection failed: ${errorMessage(error)}`)

      if (inProcessServer) {
        inProcessServer.close().catch(() => {})
      }
      return {
        name,
        type: 'failed' as const,
        config: serverRef,
        error: errorMessage(error),
      }
    }
  },
  getServerCacheKey,
)

/**
 * Clears the memoize cache for a specific server
 * @param name Server name
 * @param serverRef Server configuration
 */
export async function clearServerCache(
  name: string,
  serverRef: ScopedMcpServerConfig,
): Promise<void> {
  const key = getServerCacheKey(name, serverRef)

  try {
    const wrappedClient = await connectToServer(name, serverRef)

    if (wrappedClient.type === 'connected') {
      await wrappedClient.cleanup()
    }
  } catch {
    // Ignore errors - server might have failed to connect
  }

  // Clear from cache (both connection and fetch caches so reconnect
  // fetches fresh tools/resources/commands instead of stale ones)
  connectToServer.cache.delete(key)
  fetchToolsForClient.cache.delete(name)
  fetchResourcesForClient.cache.delete(name)
  fetchCommandsForClient.cache.delete(name)
  if (feature('MCP_SKILLS')) {
    fetchMcpSkillsForClient!.cache.delete(name)
  }
}

// ═══ 每次工具调用前都过一遍这个函数 ═══
//
// 逻辑很简单：调 connectToServer，如果拿到 connected 就返回，否则抛错。
//
// 但因为 connectToServer 是 memoize 的，正常路径**不产生任何 IO** ——
// 只是查一次缓存返回同一个对象。
//
// 真正的用途在**缓存被清掉之后**：onclose 清了缓存，
// 下一次调用这个函数就会真的重连。所以它是「透明重连」的实现点。
//
// sdk 类型直接原样返回（1692 行）：它们不进 connectToServer 的缓存，
// 由 setupSdkMcpClients 管理生命周期。
// ═══
/**
 * Ensures a valid connected client for an MCP server.
 * For most server types, uses the memoization cache if available, or reconnects
 * if the cache was cleared (e.g., after onclose). This ensures tool/resource
 * calls always use a valid connection.
 *
 * SDK MCP servers run in-process and are handled separately via setupSdkMcpClients,
 * so they are returned as-is without going through connectToServer.
 *
 * @param client The connected MCP server client
 * @returns Connected MCP server client (same or reconnected)
 * @throws Error if server cannot be connected
 */
export async function ensureConnectedClient(
  client: ConnectedMCPServer,
): Promise<ConnectedMCPServer> {
  // SDK MCP servers run in-process and are handled separately via setupSdkMcpClients
  if (client.config.type === 'sdk') {
    return client
  }

  const connectedClient = await connectToServer(client.name, client.config)
  if (connectedClient.type !== 'connected') {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `MCP server "${client.name}" is not connected`,
      'MCP server not connected',
    )
  }
  return connectedClient
}

// ═══ 比较配置时排除 scope ═══
//
// scope 表示「这个配置从哪来的」：user / project / local / dynamic。
// 它是**元数据**，不影响连接行为 —— 同名同配置的服务器，
// 无论从全局配置还是项目配置来，连出来的东西是一样的。
//
// 所以比较时排除它。否则会出现：配置内容没变，但因为加载顺序变了
// scope 从 project 变成 local，判定为「配置变了，要重连」——
// 一次无意义的重连。
//
// 比较方式是 jsonStringify 后字符串相等（1717 行注释：这样能覆盖
// 所有配置变体）。代价是键顺序敏感（见 p1 对 getServerCacheKey 的说明），
// 但实际配置来源单一，顺序稳定。
// ═══
/**
 * Compares two MCP server configurations to determine if they are equivalent.
 * Used to detect when a server needs to be reconnected due to config changes.
 */
export function areMcpConfigsEqual(
  a: ScopedMcpServerConfig,
  b: ScopedMcpServerConfig,
): boolean {
  // Quick type check first
  if (a.type !== b.type) return false

  // Compare by serializing - this handles all config variations
  // We exclude 'scope' from comparison since it's metadata, not connection config
  const { scope: _scopeA, ...configA } = a
  const { scope: _scopeB, ...configB } = b
  return jsonStringify(configA) === jsonStringify(configB)
}

// ═══ LRU 上限 20，键是服务器名 ═══
//
// 20 这个数字是「典型用户的 MCP 服务器数量」量级。
// 有上限是必需的：每缓存一个服务器的工具列表，就持有一整组
// Tool 对象（含 JSON schema、闭包）。不设限的话，长时间运行的会话
// 里切换配置会无限增长。
//
// 用名字而不是连接对象做键（1996 行）的理由和 onclose 要清缓存
// 是同一个：重连会造新对象，用对象做键就永远不命中。
// 用名字 + 手动清 = 「槽位稳定，内容同步」。
// ═══
// Max cache size for fetch* caches. Keyed by server name (stable across
// reconnects), bounded to prevent unbounded growth with many MCP servers.
const MCP_FETCH_CACHE_SIZE = 20

/**
 * Encode MCP tool input for the auto-mode security classifier.
 * Exported so the auto-mode eval scripts can mirror production encoding
 * for `mcp__*` tool stubs without duplicating this logic.
 */
export function mcpToolInputToAutoClassifierInput(
  input: Record<string, unknown>,
  toolName: string,
): string {
  const keys = Object.keys(input)
  return keys.length > 0
    ? keys.map(k => `${k}=${String(input[k])}`).join(' ')
    : toolName
}

// ═══════════════════════════════════════════════════════════════
// 【这个函数是整个 MCP 系统的转换核心】
//
// 它做的事：调一次 tools/list，把 MCP 协议的工具描述
// 逐个转成内部的 Tool 对象。247 行代码，但几乎每一行都有理由。
//
// 转换后的 Tool 要满足 Tool 接口的全部契约（见第 4 步读的 Tool.ts）：
//   name / description / prompt / inputJSONSchema   → 给模型看的
//   isConcurrencySafe / isReadOnly / isDestructive  → 给权限和调度用的
//   checkPermissions / call                          → 执行
//   userFacingName                                   → 给用户看的
//
// 【一个反直觉的事实】
// MCP 工具的安全性判断全部来自**服务器自己的声明**：
//   1795 行 isConcurrencySafe → annotations.readOnlyHint
//   1798 行 isReadOnly        → annotations.readOnlyHint
//   1804 行 isDestructive     → annotations.destructiveHint
//   1807 行 isOpenWorld       → annotations.openWorldHint
//
// 这些是外部服务器在 tools/list 响应里自己填的。一个恶意的（或
// 只是写错的）MCP 服务器只要声明 readOnlyHint: true，
// 它的工具就会被判定为「只读、可并发、非破坏性」——
// 于是可能被并发执行、可能不需要用户确认。
//
// 所以 MCP 工具（mcp__ 前缀）在权限系统里有单独的规则
// （1814 行的 checkPermissions 返回 passthrough，意思是
// 「交给上层规则系统判，这里不做判断」）。
// ═══════════════════════════════════════════════════════════════
export const fetchToolsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Tool[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.tools) {
        return []
      }

      const result = (await client.client.request(
        { method: 'tools/list' },
        ListToolsResultSchema,
      )) as ListToolsResult

      // Sanitize tool data from MCP server
      const toolsToProcess = recursivelySanitizeUnicode(result.tools)

// ═══ skip-prefix 模式：让 SDK 的 MCP 工具能**覆盖**内建工具 ═══
//
// 正常情况工具名是 `mcp__<server>__<tool>`（buildMcpToolName）。
// 但 SDK 场景下可以设 CLAUDE_AGENT_SDK_MCP_NO_PREFIX，去掉前缀，
// 于是 MCP 工具可以用和内建工具一样的名字 —— 也就是**覆盖**它。
//
// 用途：Agent SDK 的使用者想替换掉某个内建工具的实现（比如
// 自己实现一套 Read，接内部的文件系统）。
//
// 注意 mcpInfo 仍然保留原名（1774 行）。所以：
//   name    = 模型看到的、用来调用的名字（可能不带前缀）
//   mcpInfo = 权限检查用的真实来源（serverName + toolName）
//
// 这两个字段分开，是因为「模型怎么称呼它」和「权限系统怎么识别它」
// 是两个不同的问题。
// ═══
      // Check if we should skip the mcp__ prefix for SDK MCP servers
      const skipPrefix =
        client.config.type === 'sdk' &&
        isEnvTruthy(process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX)

      // Convert MCP tools to our Tool format
      return toolsToProcess
        .map((tool): Tool => {
          const fullyQualifiedName = buildMcpToolName(client.name, tool.name)
          return {
            ...MCPTool,
            // In skip-prefix mode, use the original name for model invocation so MCP tools
            // can override builtins by name. mcpInfo is used for permission checking.
            name: skipPrefix ? tool.name : fullyQualifiedName,
            mcpInfo: { serverName: client.name, toolName: tool.name },
            isMcp: true,
// ═══ 一个换行符能造成 prompt 注入 ═══
//
// searchHint 来自 tool._meta['anthropic/searchHint'] —— 这是
// **外部 MCP 服务器完全可控**的字段。
//
// 为什么要先把所有连续空白压成单个空格：
// 这个 hint 最终会进「延迟工具列表」，而那个列表是**按换行符拼接**的
// （注释点名 formatDeferredToolLine 里 join 的用法）。
//
// 所以一个 hint 里只要带一个换行，就能凭空多出几行工具描述 ——
// 模型会把它当成真的工具条目读。恶意服务器可以用这招往
// 系统提示词里塞任意内容。
//
// 这叫「结构性注入」：不是转义问题，是**用数据去伪造结构**。
// 同一类风险在 tool description、server instructions、
// 甚至工具返回值里都存在（后者靠的是返回值包装成 content block 来隔离）。
//
// 后面 `.trim() || undefined` 也是同一目的：全是空白就当没提供，
// 避免造出空行。
// ═══
            // Collapse whitespace: _meta is open to external MCP servers, and
            // a newline here would inject orphan lines into the deferred-tool
            // list (formatDeferredToolLine joins on '\n').
            searchHint:
              typeof tool._meta?.['anthropic/searchHint'] === 'string'
                ? tool._meta['anthropic/searchHint']
                    .replace(/\s+/g, ' ')
                    .trim() || undefined
                : undefined,
            alwaysLoad: tool._meta?.['anthropic/alwaysLoad'] === true,
            async description() {
              return tool.description ?? ''
            },
            async prompt() {
              const desc = tool.description ?? ''
              return desc.length > MAX_MCP_DESCRIPTION_LENGTH
                ? desc.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '… [truncated]'
                : desc
            },
// ═══ 三个安全属性，全部来自服务器的自称 ═══
//
// isConcurrencySafe  → 并发调用安全吗（能不能和别的工具同时跑）
// isReadOnly         → 只读吗（影响权限弹窗的默认值）
// isDestructive      → 有破坏性吗（影响是否必须确认）
// isOpenWorld        → 会访问外部世界吗（影响是否要额外的网络提示）
//
// 四个都读 tool.annotations，也就是 MCP 服务器在 tools/list 里
// 自己声明的 hint。规范里这些都是 hint（提示），不是保证。
//
// 设计上的取舍：
//   信任 → 好用的服务器能获得流畅体验（只读工具自动放行、并发执行）
//   不信任 → 所有 MCP 工具都要确认，可用性崩塌
//
// 折中方案在权限层：MCP 工具走 passthrough（1816 行），
// 由用户配置的规则决定（`mcp__server__tool` 形式的 allow 规则）。
// 也就是说这些 hint 影响的是**调度**（能不能并发），
// 而**授权**另有独立机制。
// ═══
            isConcurrencySafe() {
              return tool.annotations?.readOnlyHint ?? false
            },
            isReadOnly() {
              return tool.annotations?.readOnlyHint ?? false
            },
            toAutoClassifierInput(input) {
              return mcpToolInputToAutoClassifierInput(input, tool.name)
            },
            isDestructive() {
              return tool.annotations?.destructiveHint ?? false
            },
            isOpenWorld() {
              return tool.annotations?.openWorldHint ?? false
            },
            isSearchOrReadCommand() {
              return classifyMcpToolForCollapse(client.name, tool.name)
            },
            inputJSONSchema: tool.inputSchema as Tool['inputJSONSchema'],
// ═══ passthrough = 「不在这里做决定」═══
//
// 返回 behavior: 'passthrough' 的意思是：这个工具的权限不由自己判断，
// 交回上层的规则系统（allow/deny 规则、用户配置、交互式询问）。
//
// 为什么 MCP 工具要这样：因为服务器是外部提供的，我们无法推断
// 它的行为。一个叫 "read_file" 的 MCP 工具可能在删你的文件。
// 只有用户显式配置的规则才算数。
//
// 但这里同时给了一条**建议**（suggestions）：如果用户决定允许，
// 就把 `mcp__server__tool` 这条规则写进 localSettings。
// 也就是说「一次允许 = 永久允许这个具体工具」，
// 而不是允许整个服务器。
//
// 注意 ruleContent: undefined —— 意味着不限定参数内容，
// 这个工具的所有调用都放行。粒度只能到工具级，不能到参数级
// （因为 MCP 工具的 schema 是任意的，没法通用地描述「哪些参数值危险」）。
// ═══
            async checkPermissions() {
              return {
                behavior: 'passthrough' as const,
                message: 'MCPTool requires permission.',
                suggestions: [
                  {
                    type: 'addRules' as const,
                    rules: [
                      {
                        toolName: fullyQualifiedName,
                        ruleContent: undefined,
                      },
                    ],
                    behavior: 'allow' as const,
                    destination: 'localSettings' as const,
                  },
                ],
              }
            },
// ═══ call()：每次工具调用都从这里进 ═══
//
// 五段：
//   ① 从父消息里抠 toolUseId（用于进度上报和 _meta 透传）
//   ② 发一个 'started' 进度事件
//   ③ 重试循环（session 过期时重试一次）
//   ④ 成功后发 'completed'，失败发 'failed'
//   ⑤ 错误分类包装（见 1937 行）
//
// 注意 1843 行的 meta：`{ 'claudecode/toolUseId': toolUseId }`。
// 这是把自己的 tool_use_id 传给 MCP 服务器 —— 服务器如果支持
// 回传 _meta，就能把自己的内部追踪 id 和我们的 tool_use_id 关联起来。
// 用于跨系统的链路追踪。
//
// 进度事件的设计（1846、1884、1925 三处）：每个都带 toolUseID，
// 因为上层要按 id 把进度路由到对应的 UI 元素。没有 id 就无法渲染。
// ═══
            async call(
              args: Record<string, unknown>,
              context,
              _canUseTool,
              parentMessage,
              onProgress?: ToolCallProgress<MCPProgress>,
            ) {
              const toolUseId = extractToolUseId(parentMessage)
              const meta = toolUseId
                ? { 'claudecode/toolUseId': toolUseId }
                : {}

              // Emit progress when tool starts
              if (onProgress && toolUseId) {
                onProgress({
                  toolUseID: toolUseId,
                  data: {
                    type: 'mcp_progress',
                    status: 'started',
                    serverName: client.name,
                    toolName: tool.name,
                  },
                })
              }

// ═══ 只重试一次，且只重试一种错误 ═══
//
// MAX_SESSION_RETRIES = 1，判断条件是 `error instanceof McpSessionExpiredError`。
//
// 为什么只有这种错误值得重试：它是**唯一**一种「换个 client 就能成功」
// 的失败。其他错误（工具超时、参数不对、服务器内部错误、用户中断）
// 换个连接再试一遍只会得到同样的结果，还白白多花一次时间。
//
// 会话过期重试能成立的前提：callMCPTool 在抛 McpSessionExpiredError
// 之前已经调了 clearServerCache（3229 行）。所以下一轮
// ensureConnectedClient 会真的重建连接，而不是拿到同一个死连接。
//
// 这两个函数之间的隐式契约 ——「抛这个错误意味着缓存已清」——
// 是这段代码正确性的关键。如果没有清缓存，重试是纯浪费。
// ═══
              const startTime = Date.now()
              const MAX_SESSION_RETRIES = 1
              for (let attempt = 0; ; attempt++) {
                try {
                  const connectedClient = await ensureConnectedClient(client)
                  const mcpResult = await callMCPToolWithUrlElicitationRetry({
                    client: connectedClient,
                    clientConnection: client,
                    tool: tool.name,
                    args,
                    meta,
                    signal: context.abortController.signal,
                    setAppState: context.setAppState,
                    onProgress:
                      onProgress && toolUseId
                        ? progressData => {
                            onProgress({
                              toolUseID: toolUseId,
                              data: progressData,
                            })
                          }
                        : undefined,
                    handleElicitation: context.handleElicitation,
                  })

                  // Emit progress when tool completes successfully
                  if (onProgress && toolUseId) {
                    onProgress({
                      toolUseID: toolUseId,
                      data: {
                        type: 'mcp_progress',
                        status: 'completed',
                        serverName: client.name,
                        toolName: tool.name,
                        elapsedTimeMs: Date.now() - startTime,
                      },
                    })
                  }

                  return {
                    data: mcpResult.content,
                    ...((mcpResult._meta || mcpResult.structuredContent) && {
                      mcpMeta: {
                        ...(mcpResult._meta && {
                          _meta: mcpResult._meta,
                        }),
                        ...(mcpResult.structuredContent && {
                          structuredContent: mcpResult.structuredContent,
                        }),
                      },
                    }),
                  }
                } catch (error) {
                  // Session expired — the connection cache has been
                  // cleared, so retry with a fresh client.
                  if (
                    error instanceof McpSessionExpiredError &&
                    attempt < MAX_SESSION_RETRIES
                  ) {
                    logMCPDebug(
                      client.name,
                      `Retrying tool '${tool.name}' after session recovery`,
                    )
                    continue
                  }

                  // Emit progress when tool fails
                  if (onProgress && toolUseId) {
                    onProgress({
                      toolUseID: toolUseId,
                      data: {
                        type: 'mcp_progress',
                        status: 'failed',
                        serverName: client.name,
                        toolName: tool.name,
                        elapsedTimeMs: Date.now() - startTime,
                      },
                    })
                  }
// ═══ 为什么要重新包装错误，而不是原样抛 ═══
//
// 注释说的直接原因："so telemetry gets useful context instead of
// just 'Error' or 'McpError' (the constructor name)"。
//
// 埋点系统记录的通常是 error.constructor.name。而 MCP SDK 抛的
// 是裸 Error 或 McpError —— 埋点里全是 "Error"，完全没法分类。
//
// 处理方式：
//   裸 Error   → 包成 TelemetrySafeError(message, message.slice(0,200))
//   McpError   → 包成 TelemetrySafeError(message, `McpError ${code}`)
//   已经是安全的 → 不动
//
// 第二个参数是**埋点用的消息**，第一个是给人看的。分开的理由：
// 埋点要短、要能聚合（`McpError -32000` 可以按错误码统计），
// 而人看的消息要完整。
//
// 注释里那句 "MCP SDK errors are protocol-level messages and don't
// contain user file paths or code" 是**担保**：这条消息不可能是
// 用户代码或路径，所以可以不做路径擦除直接进埋点。
// 这就是那个长后缀 _I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 的含义。
//
// 顺带：3204 行抛的 McpAuthError、3230 行抛的 McpSessionExpiredError
// 没有被包装，因为它们本来就是有类型的、可分类的。
// ═══
                  // Wrap MCP SDK errors so telemetry gets useful context
                  // instead of just "Error" or "McpError" (the constructor
                  // name). MCP SDK errors are protocol-level messages and
                  // don't contain user file paths or code.
                  if (
                    error instanceof Error &&
                    !(
                      error instanceof
                      TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
                    )
                  ) {
                    const name = error.constructor.name
                    if (name === 'Error') {
                      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                        error.message,
                        error.message.slice(0, 200),
                      )
                    }
                    // McpError has a numeric `code` with the JSON-RPC error
                    // code (e.g. -32000 ConnectionClosed, -32001 RequestTimeout)
                    if (
                      name === 'McpError' &&
                      'code' in error &&
                      typeof error.code === 'number'
                    ) {
                      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                        error.message,
                        `McpError ${error.code}`,
                      )
                    }
                  }
                  throw error
                }
              }
            },
            userFacingName() {
              // Prefer title annotation if available, otherwise use tool name
              const displayName = tool.annotations?.title || tool.name
              return `${client.name} - ${displayName} (MCP)`
            },
// ═══ 两种特殊服务器的工具覆盖 ═══
//
// 这里的 spread 语法 `...(条件 ? 覆盖对象 : {})` 是个干净的模式：
// 条件不满足时展开空对象，等于没覆盖。
//
// Claude-in-Chrome：只是包一层 UI 渲染（getClaudeInChromeMCPToolOverrides），
// 执行逻辑不变。
//
// Computer Use：这里就是前面 930 行注释说的「真正的执行入口」——
// wrapper.tsx 的 .call() 覆盖。所以这个 MCP 服务器的 tools/list 只起到
// 「让模型知道有哪些工具」的作用，实际调用被本地接管。
//
// 两个条件都检查 `config.type === 'stdio' || !config.type`：
// 因为这些服务器只以本地进程形式存在，远程的不该有这些覆盖。
// ═══
            ...(isClaudeInChromeMCPServer(client.name) &&
            (client.config.type === 'stdio' || !client.config.type)
              ? claudeInChromeToolRendering().getClaudeInChromeMCPToolOverrides(
                  tool.name,
                )
              : {}),
            ...(feature('CHICAGO_MCP') &&
            (client.config.type === 'stdio' || !client.config.type) &&
            isComputerUseMCPServer!(client.name)
              ? computerUseWrapper!().getComputerUseMCPToolOverrides(tool.name)
              : {}),
          }
        })
        .filter(isIncludedMcpTool)
    } catch (error) {
      logMCPError(client.name, `Failed to fetch tools: ${errorMessage(error)}`)
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_FETCH_CACHE_SIZE,
)

export const fetchResourcesForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<ServerResource[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.resources) {
        return []
      }

      const result = await client.client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema,
      )

      if (!result.resources) return []

      // Add server name to each resource
      return result.resources.map(resource => ({
        ...resource,
        server: client.name,
      }))
    } catch (error) {
      logMCPError(
        client.name,
        `Failed to fetch resources: ${errorMessage(error)}`,
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_FETCH_CACHE_SIZE,
)

export const fetchCommandsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.prompts) {
        return []
      }

      // Request prompts list from client
      const result = (await client.client.request(
        { method: 'prompts/list' },
        ListPromptsResultSchema,
      )) as ListPromptsResult

      if (!result.prompts) return []

      // Sanitize prompt data from MCP server
      const promptsToProcess = recursivelySanitizeUnicode(result.prompts)

      // Convert MCP prompts to our Command format
      return promptsToProcess.map(prompt => {
        const argNames = Object.values(prompt.arguments ?? {}).map(k => k.name)
        return {
          type: 'prompt' as const,
          name: 'mcp__' + normalizeNameForMCP(client.name) + '__' + prompt.name,
          description: prompt.description ?? '',
          hasUserSpecifiedDescription: !!prompt.description,
          contentLength: 0, // Dynamic MCP content
          isEnabled: () => true,
          isHidden: false,
          isMcp: true,
          progressMessage: 'running',
          userFacingName() {
            // Use prompt.name (programmatic identifier) not prompt.title (display name)
            // to avoid spaces breaking slash command parsing
            return `${client.name}:${prompt.name} (MCP)`
          },
          argNames,
          source: 'mcp',
          async getPromptForCommand(args: string) {
            const argsArray = args.split(' ')
            try {
              const connectedClient = await ensureConnectedClient(client)
              const result = await connectedClient.client.getPrompt({
                name: prompt.name,
                arguments: zipObject(argNames, argsArray),
              })
              const transformed = await Promise.all(
                result.messages.map(message =>
                  transformResultContent(message.content, connectedClient.name),
                ),
              )
              return transformed.flat()
            } catch (error) {
              logMCPError(
                client.name,
                `Error running command '${prompt.name}': ${errorMessage(error)}`,
              )
              throw error
            }
          },
        }
      })
    } catch (error) {
      logMCPError(
        client.name,
        `Failed to fetch commands: ${errorMessage(error)}`,
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_FETCH_CACHE_SIZE,
)

/**
 * Call an IDE tool directly as an RPC
 * @param toolName The name of the tool to call
 * @param args The arguments to pass to the tool
 * @param client The IDE client to use for the RPC call
 * @returns The result of the tool call
 */
export async function callIdeRpc(
  toolName: string,
  args: Record<string, unknown>,
  client: ConnectedMCPServer,
): Promise<string | ContentBlockParam[] | undefined> {
  const result = await callMCPTool({
    client,
    tool: toolName,
    args,
    signal: createAbortController().signal,
  })
  return result.content
}

// ═══ 重连入口，但 UI 不该直接调它 ═══
//
// 注释第一句就划清边界：UI 组件应该用 useManageMcpConnections 里的
// reconnectMcpServer，而不是这个 Impl。因为 UI 那边还要更新
// AppState、清 React 状态、重渲染 —— 这个函数只管连接层。
//
// 分层：Impl（纯连接逻辑，可测）→ 上层（状态同步 + 副作用）。
// ═══
/**
 * Note: This should not be called by UI components directly, they should use the reconnectMcpServer
 * function from useManageMcpConnections.
 * @param name Server name
 * @param config Server configuration
 * @returns Object containing the client connection and its resources
 */
export async function reconnectMcpServerImpl(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<{
  client: MCPServerConnection
  tools: Tool[]
  commands: Command[]
  resources?: ServerResource[]
}> {
  try {
// ═══ 先清 keychain 缓存，再谈连接 ═══
//
// 这个细节来自一个真实的多进程场景：
//
//   用户在 VS Code 里点了「退出登录」/「重新授权」
//   → 扩展宿主进程改了磁盘上的凭据
//   → 扩展让 CLI 子进程重连
//   → CLI 子进程如果读的是**内存里的** keychain 缓存，
//     根本看不到凭据已经变了
//   → 重连用的还是旧 token，永远失败
//
// 所以重连的第一步必须是「忘掉我记住的凭据」。
//
// 这类 bug 的特征：单进程测试永远复现不了，只有跨进程才出现。
// 而跨进程是 IDE 集成的常态。
// ═══
    // Invalidate the keychain cache so we read fresh credentials from disk.
    // This is necessary when another process (e.g. the VS Code extension host)
    // has modified stored tokens (cleared auth, saved new OAuth tokens) and then
    // asks the CLI subprocess to reconnect.  Without this, the subprocess would
    // use stale cached data and never notice the tokens were removed.
    clearKeychainCache()

    await clearServerCache(name, config)
    const client = await connectToServer(name, config)

    if (client.type !== 'connected') {
      return {
        client,
        tools: [],
        commands: [],
      }
    }

    if (config.type === 'claudeai-proxy') {
      markClaudeAiMcpConnected(name)
    }

    const supportsResources = !!client.capabilities?.resources

    const [tools, mcpCommands, mcpSkills, resources] = await Promise.all([
      fetchToolsForClient(client),
      fetchCommandsForClient(client),
      feature('MCP_SKILLS') && supportsResources
        ? fetchMcpSkillsForClient!(client)
        : Promise.resolve([]),
      supportsResources ? fetchResourcesForClient(client) : Promise.resolve([]),
    ])
    const commands = [...mcpCommands, ...mcpSkills]

// ═══ 资源工具全局只加一份 ═══
//
// ListMcpResourcesTool 和 ReadMcpResourceTool 是**内建**工具，
// 但它们要操作的资源来自所有 MCP 服务器。所以不能按服务器重复添加。
//
// 两种场景的判断方式不同：
//   这里（重连单个）：检查这个服务器的工具里有没有 ——
//     有就说明别的服务器已经加过了（或者在它之前的重连加过）
//   2361 行（批量连接）：用一个 resourceToolsAdded 标志 ——
//     因为是并发跑的，没法「检查别人加过没」
//
// 同一个问题，串行和并发两种解法。这是并发编程里很实际的细节。
// ═══
    // Check if we need to add resource tools
    const resourceTools: Tool[] = []
    if (supportsResources) {
      // Only add resource tools if no other server has them
      const hasResourceTools = [ListMcpResourcesTool, ReadMcpResourceTool].some(
        tool => tools.some(t => toolMatchesName(t, tool.name)),
      )
      if (!hasResourceTools) {
        resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
      }
    }

    return {
      client,
      tools: [...tools, ...resourceTools],
      commands,
      resources: resources.length > 0 ? resources : undefined,
    }
  } catch (error) {
    // Handle errors gracefully - connection might have closed during fetch
    logMCPError(name, `Error during reconnection: ${errorMessage(error)}`)

    // Return with failed status
    return {
      client: { name, type: 'failed' as const, config },
      tools: [],
      commands: [],
    }
  }
}

// ═══ 一次调度改造的完整记录，注释里直接写了日期 ═══
//
// 原文（2026-03 的改动说明）：
//   "previous implementation ran fixed-size sequential batches
//    (await batch 1 fully, then start batch 2). That meant one slow
//    server in batch N held up ALL servers in batch N+1, even if the
//    other 19 slots were idle. pMap frees each slot as soon as its
//    server completes, so a single slow server only occupies one slot
//    instead of blocking an entire batch boundary. Same concurrency
//    ceiling, same results, better scheduling."
//
// 拆开看这个分析：
//   旧：分批，批内并发、批间串行。20 个服务器、批大小 20、其中一个慢 10 秒
//       → 第 1 批等 10 秒 → 第 2 批才开始
//   新：滑动窗口。那个慢的占一个槽，其余 19 个槽继续消化后面的
//       → 总时间 ≈ max(最慢的那个, 其余的平均摊分)
//
// 关键点：**并发上限一样、结果一样**，只有调度变了。
// 这是「同样是 O(n) 但常数差很多」的典型优化，而且没有正确性风险。
//
// pMap 是这里唯一的外部依赖（不是自己写的池）。用一个成熟的库
// 而不是手写信号量，是对的取舍 —— 这段代码不需要创新。
// ═══
// Replaced 2026-03: previous implementation ran fixed-size sequential batches
// (await batch 1 fully, then start batch 2). That meant one slow server in
// batch N held up ALL servers in batch N+1, even if the other 19 slots were
// idle. pMap frees each slot as soon as its server completes, so a single
// slow server only occupies one slot instead of blocking an entire batch
// boundary. Same concurrency ceiling, same results, better scheduling.
async function processBatched<T>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<void>,
): Promise<void> {
  await pMap(items, processor, { concurrency })
}

// ═══════════════════════════════════════════════════════════════
// 【启动时最重要的一段】批量连接所有 MCP 服务器
//
// 它的调用方是启动流程（prefetchAllMcpResources → main.tsx），
// 在第一次调模型之前必须跑完 —— 因为模型需要知道有哪些工具。
// 所以这段的**总耗时**直接等于「用户按下回车到看见第一个字」的延迟。
//
// 结构：
//   ① 拿到所有配置，分 disabled / active
//   ② 数各类 transport 的个数（只为埋点）
//   ③ 分本地 / 远程两组
//   ④ 两组各自用不同并发跑，组间并行
//   ⑤ 每个服务器完成后立即回调 onConnectionAttempt（流式产出）
//
// 第 ⑤ 点是设计上的关键：不用等全部完成再返回一个数组，
// 而是**每完成一个就通知一次**。这样 UI 可以逐个显示连接状态
// （用户看到服务器一个个亮起来），而不是卡着等最慢的那个。
// 回调式 API 换来的代价是：调用方要自己数「完成了几个」，
// 见 prefetchAllMcpResources 里那个 completedCount。
// ═══════════════════════════════════════════════════════════════
export async function getMcpToolsCommandsAndResources(
  onConnectionAttempt: (params: {
    client: MCPServerConnection
    tools: Tool[]
    commands: Command[]
    resources?: ServerResource[]
  }) => void,
  mcpConfigs?: Record<string, ScopedMcpServerConfig>,
): Promise<void> {
  let resourceToolsAdded = false

  const allConfigEntries = Object.entries(
    mcpConfigs ?? (await getAllMcpConfigs()).servers,
  )

// ═══ disabled 的服务器不参与并发调度 ═══
//
// 看着啰嗦（先分区，再在 processServer 里又检查一次 2288 行），
// 但两个检查都有必要：
//
//   这里的分区：让 disabled 的服务器不占用并发槽位
//               （否则 20 个禁用服务器会把 20 个槽全占了，什么都不干）
//   里面的检查：因为 mcpConfigs 可能是调用方临时传的，
//               而 isMcpServerDisabled 读的是全局开关 ——
//               两者可能不一致
//
// disabled 的服务器仍然要产出 onConnectionAttempt（2246 行），
// 因为 UI 需要显示它（灰掉的服务器也是信息）。
// ═══
  // Partition into disabled and active entries — disabled servers should
  // never generate HTTP connections or flow through batch processing
  const configEntries: typeof allConfigEntries = []
  for (const entry of allConfigEntries) {
    if (isMcpServerDisabled(entry[0])) {
      onConnectionAttempt({
        client: { name: entry[0], type: 'disabled', config: entry[1] },
        tools: [],
        commands: [],
      })
    } else {
      configEntries.push(entry)
    }
  }

  // Calculate transport counts for logging
  const totalServers = configEntries.length
  const stdioCount = count(configEntries, ([_, c]) => c.type === 'stdio')
  const sseCount = count(configEntries, ([_, c]) => c.type === 'sse')
  const httpCount = count(configEntries, ([_, c]) => c.type === 'http')
  const sseIdeCount = count(configEntries, ([_, c]) => c.type === 'sse-ide')
  const wsIdeCount = count(configEntries, ([_, c]) => c.type === 'ws-ide')

// ═══ 本地 / 远程分两组，各有各的并发上限 ═══
//
// 见 p1 对 getMcpServerConnectionBatchSize 的说明：
// 本地 3（spawn 进程），远程 20（只是网络）。
//
// 重点在 2391 行：两组用 Promise.all **同时**跑。
// 意思是最终总时间 ≈ max(本地组总时间, 远程组总时间)，
// 而不是两者相加。因为它们是不同资源（进程 vs 网络）。
// ═══
  // Split servers by type: local (stdio/sdk) need lower concurrency due to
  // process spawning, remote servers can connect with higher concurrency
  const localServers = configEntries.filter(([_, config]) =>
    isLocalMcpServer(config),
  )
  const remoteServers = configEntries.filter(
    ([_, config]) => !isLocalMcpServer(config),
  )

  const serverStats = {
    totalServers,
    stdioCount,
    sseCount,
    httpCount,
    sseIdeCount,
    wsIdeCount,
  }

  const processServer = async ([name, config]: [
    string,
    ScopedMcpServerConfig,
  ]): Promise<void> => {
    try {
      // Check if server is disabled - if so, just add it to state without connecting
      if (isMcpServerDisabled(name)) {
        onConnectionAttempt({
          client: {
            name,
            type: 'disabled',
            config,
          },
          tools: [],
          commands: [],
        })
        return
      }

// ═══ 双重 needs-auth 检查，堵住 TTL 留下的缺口 ═══
//
// 第一重：isMcpAuthCached（15 分钟 TTL 的文件缓存）。
//   最近 401 过的服务器，15 分钟内不重试。
//
// 第二重：hasMcpDiscoveryButNoToken。
//   检查的是「这个服务器有 OAuth 发现信息，但我们手里没有 token」。
//
// 为什么需要第二重（注释写得很清楚）：
//   TTL 只覆盖 15 分钟。15 分钟一过，那些「压根不可能成功」的服务器
//   会被重新探测一次 —— 每次探测 = 一次 connect 请求（拿到 401）
//   + 一轮 OAuth discovery。
//
//   而用户不主动跑 /mcp 的话，它们永远不会有 token。
//   所以每 15 分钟浪费一轮完整探测。
//
// 放大效应：print 模式会 await 整个批次（注释引了 main.tsx:3503）。
// 于是「一次性的 -p 命令」会因为这轮无用的探测而卡住。
//
// 这是「缓存 TTL 解决了性能问题，但留下了一个语义缺口，
// 需要第二条判据补上」的教科书案例。
// ═══
      // Skip connection for servers that recently returned 401 (15min TTL),
      // or that we have probed before but hold no token for. The second
      // check closes the gap the TTL leaves open: without it, every 15min
      // we re-probe servers that cannot succeed until the user runs /mcp.
      // Each probe is a network round-trip for connect-401 plus OAuth
      // discovery, and print mode awaits the whole batch (main.tsx:3503).
      if (
        (config.type === 'claudeai-proxy' ||
          config.type === 'http' ||
          config.type === 'sse') &&
        ((await isMcpAuthCached(name)) ||
          ((config.type === 'http' || config.type === 'sse') &&
            hasMcpDiscoveryButNoToken(name, config)))
      ) {
        logMCPDebug(name, `Skipping connection (cached needs-auth)`)
        onConnectionAttempt({
          client: { name, type: 'needs-auth' as const, config },
          tools: [createMcpAuthTool(name, config)],
          commands: [],
        })
        return
      }

      const client = await connectToServer(name, config, serverStats)

      if (client.type !== 'connected') {
        onConnectionAttempt({
          client,
          tools:
            client.type === 'needs-auth'
              ? [createMcpAuthTool(name, config)]
              : [],
          commands: [],
        })
        return
      }

      if (config.type === 'claudeai-proxy') {
        markClaudeAiMcpConnected(name)
      }

// ═══ 四个 fetch 并行，但只有两个是必需的 ═══
//
// tools 和 commands：无条件调（函数内部会自己检查 capabilities）
// skills 和 resources：先看 supportsResources 再调
//
// 为什么 skills 依赖 resources：技能的发现走 `skill://` 资源协议，
// 没有 resources 能力的服务器不可能有技能。
//
// 注意 `features('MCP_SKILLS') && supportsResources ? fetch : Promise.resolve([])`
// 这个写法的两层含义：
//   feature 为假 → 整个分支被 DCE 删掉，fetchMcpSkillsForClient 也是 null
//   所以那个非空断言 `fetchMcpSkillsForClient!` 在 DCE 之后才安全
// ═══
      const supportsResources = !!client.capabilities?.resources

      const [tools, mcpCommands, mcpSkills, resources] = await Promise.all([
        fetchToolsForClient(client),
        fetchCommandsForClient(client),
        // Discover skills from skill:// resources
        feature('MCP_SKILLS') && supportsResources
          ? fetchMcpSkillsForClient!(client)
          : Promise.resolve([]),
        // Fetch resources if supported
        supportsResources
          ? fetchResourcesForClient(client)
          : Promise.resolve([]),
      ])
      const commands = [...mcpCommands, ...mcpSkills]

      // If this server resources and we haven't added resource tools yet,
      // include our resource tools with this client's tools
      const resourceTools: Tool[] = []
      if (supportsResources && !resourceToolsAdded) {
        resourceToolsAdded = true
        resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
      }

      onConnectionAttempt({
        client,
        tools: [...tools, ...resourceTools],
        commands,
        resources: resources.length > 0 ? resources : undefined,
      })
    } catch (error) {
      // Handle errors gracefully - connection might have closed during fetch
      logMCPError(
        name,
        `Error fetching tools/commands/resources: ${errorMessage(error)}`,
      )

      // Still update with the client but no tools/commands
      onConnectionAttempt({
        client: { name, type: 'failed' as const, config },
        tools: [],
        commands: [],
      })
    }
  }

  // Process both groups concurrently, each with their own concurrency limits:
  // - Local servers (stdio/sdk): lower concurrency to avoid process spawning resource contention
  // - Remote servers: higher concurrency since they're just network connections
  await Promise.all([
    processBatched(
      localServers,
      getMcpServerConnectionBatchSize(),
      processServer,
    ),
    processBatched(
      remoteServers,
      getRemoteMcpServerConnectionBatchSize(),
      processServer,
    ),
  ])
}

// ═══ 明确写了「故意不 memoize」═══
//
//   "Not memoized: called only 2-3 times at startup/reconfig. The inner
//    work (connectToServer, fetch*ForClient) is already cached.
//    Memoizing here by mcpConfigs object ref leaked — main.tsx creates
//    fresh config objects each call."
//
// 三个理由层层递进：
//   1. 调用频率低（启动 + 重配置，2-3 次）→ memoize 的收益本来就小
//   2. 内层已经缓存了 → 每次重跑只是查缓存，成本接近零
//   3. 真的 memoize 过，然后**泄漏了** → 因为键是对象引用，
//      而 main.tsx 每次调用都造新对象 → 每次新键 → 缓存永不命中
//      且永不释放
//
// 第 3 点是最有教学价值的：memoize 用对象引用做键是一个**静默的**
// 内存泄漏源。它不报错，只是缓存表一直长。
//
// 对比 connectToServer（595 行）是 memoize 的，键是
// `name + jsonStringify(config)` 字符串 —— 内容相同就是同一个键，
// 所以不会因为「新对象」而失效。两个 memoize，一个用对了键，一个没用。
// ═══
// Not memoized: called only 2-3 times at startup/reconfig. The inner work
// (connectToServer, fetch*ForClient) is already cached. Memoizing here by
// mcpConfigs object ref leaked — main.tsx creates fresh config objects each call.
export function prefetchAllMcpResources(
  mcpConfigs: Record<string, ScopedMcpServerConfig>,
): Promise<{
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
}> {
  return new Promise(resolve => {
    let pendingCount = 0
    let completedCount = 0

    pendingCount = Object.keys(mcpConfigs).length

    if (pendingCount === 0) {
      void resolve({
        clients: [],
        tools: [],
        commands: [],
      })
      return
    }

    const clients: MCPServerConnection[] = []
    const tools: Tool[] = []
    const commands: Command[] = []

    getMcpToolsCommandsAndResources(result => {
      clients.push(result.client)
      tools.push(...result.tools)
      commands.push(...result.commands)

      completedCount++
      if (completedCount >= pendingCount) {
        const commandsMetadataLength = commands.reduce((sum, command) => {
          const commandMetadataLength =
            command.name.length +
            (command.description ?? '').length +
            (command.argumentHint ?? '').length
          return sum + commandMetadataLength
        }, 0)
        logEvent('tengu_mcp_tools_commands_loaded', {
          tools_count: tools.length,
          commands_count: commands.length,
          commands_metadata_length: commandsMetadataLength,
        })

        void resolve({
          clients,
          tools,
          commands,
        })
      }
    }, mcpConfigs).catch(error => {
      logMCPError(
        'prefetchAllMcpResources',
        `Failed to get MCP resources: ${errorMessage(error)}`,
      )
      // Still resolve with empty results
      void resolve({
        clients: [],
        tools: [],
        commands: [],
      })
    })
  })
}

// ═══ MCP 内容块 → API 内容块，四种类型 ═══
//
// text          直接透传
// image         必须先 resize（API 有尺寸上限），再转 base64
// audio         落盘（API 不接受音频），返回一个小文本块指路
// resource      文本资源内联；blob 资源看 mime：图片走 image 路径，
//               其他落盘
// resource_link 变成一个带 URI 的文本块
//
// 【贯穿始终的一条原则】
// 二进制内容**不直接进上下文**，而是落盘 + 返回路径。
// 因为 base64 进上下文极其浪费：1MB 图片 = 约 340K token，
// 而且是永久占用（除非压缩）。
//
// persistBlobToTextBlock（2598 行）就是这条原则的实现，
// 注释说得很直接："Replaces the old behavior of dumping raw base64
// into the context."
//
// 例外是图片：图片必须保留为 image block，因为模型要**看**它。
// 所以图片走 resize 而不是落盘。
// ═══
/**
 * Transform result content from an MCP tool or MCP prompt into message blocks
 */
export async function transformResultContent(
  resultContent: PromptMessage['content'],
  serverName: string,
): Promise<Array<ContentBlockParam>> {
  switch (resultContent.type) {
    case 'text':
      return [
        {
          type: 'text',
          text: resultContent.text,
        },
      ]
    case 'audio': {
      const audioData = resultContent as {
        type: 'audio'
        data: string
        mimeType?: string
      }
      return await persistBlobToTextBlock(
        Buffer.from(audioData.data, 'base64'),
        audioData.mimeType,
        serverName,
        `[Audio from ${serverName}] `,
      )
    }
    case 'image': {
      // Resize and compress image data, enforcing API dimension limits
      const imageBuffer = Buffer.from(String(resultContent.data), 'base64')
      const ext = resultContent.mimeType?.split('/')[1] || 'png'
      const resized = await maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        ext,
      )
      return [
        {
          type: 'image',
          source: {
            data: resized.buffer.toString('base64'),
            media_type:
              `image/${resized.mediaType}` as Base64ImageSource['media_type'],
            type: 'base64',
          },
        },
      ]
    }
    case 'resource': {
      const resource = resultContent.resource
      const prefix = `[Resource from ${serverName} at ${resource.uri}] `

      if ('text' in resource) {
        return [
          {
            type: 'text',
            text: `${prefix}${resource.text}`,
          },
        ]
      } else if ('blob' in resource) {
        const isImage = IMAGE_MIME_TYPES.has(resource.mimeType ?? '')

        if (isImage) {
          // Resize and compress image blob, enforcing API dimension limits
          const imageBuffer = Buffer.from(resource.blob, 'base64')
          const ext = resource.mimeType?.split('/')[1] || 'png'
          const resized = await maybeResizeAndDownsampleImageBuffer(
            imageBuffer,
            imageBuffer.length,
            ext,
          )
          const content: MessageParam['content'] = []
          if (prefix) {
            content.push({
              type: 'text',
              text: prefix,
            })
          }
          content.push({
            type: 'image',
            source: {
              data: resized.buffer.toString('base64'),
              media_type:
                `image/${resized.mediaType}` as Base64ImageSource['media_type'],
              type: 'base64',
            },
          })
          return content
        } else {
          return await persistBlobToTextBlock(
            Buffer.from(resource.blob, 'base64'),
            resource.mimeType,
            serverName,
            prefix,
          )
        }
      }
      return []
    }
    case 'resource_link': {
      const resourceLink = resultContent as ResourceLink
      let text = `[Resource link: ${resourceLink.name}] ${resourceLink.uri}`
      if (resourceLink.description) {
        text += ` (${resourceLink.description})`
      }
      return [
        {
          type: 'text',
          text,
        },
      ]
    }
    default:
      return []
  }
}

// ═══ 落盘 + 返回指路牌 ═══
//
// 三步：造一个唯一 id → 写盘（persistBinaryContent 决定扩展名和目录）
// → 返回一句话告诉模型文件在哪。
//
// 失败时（2607 行）返回的不是错误，而是一段说明文本：
// "Binary content (...) could not be saved to disk: <原因>"
//
// 为什么不抛错：二进制内容落盘失败不该让整个工具调用失败。
// 模型读到这段文字，会知道「这里本来有个文件但没存下来」，
// 通常它会继续往下做。抛错则会让工具调用整体失败，前面的工作白做。
//
// 这是「降级优于失败」的实例，但要注意它的适用条件：
// 只适用于**附带信息**。如果用户要的就是那个文件，静默降级
// 会让模型以为拿到了实际没拿到 —— 所以消息里必须说清楚失败原因，
// 让模型自己决定要不要重试。
// ═══
/**
 * Decode base64 binary content, write it to disk with the proper extension,
 * and return a small text block with the file path. Replaces the old behavior
 * of dumping raw base64 into the context.
 */
async function persistBlobToTextBlock(
  bytes: Buffer,
  mimeType: string | undefined,
  serverName: string,
  sourceDescription: string,
): Promise<Array<ContentBlockParam>> {
  const persistId = `mcp-${normalizeNameForMCP(serverName)}-blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const result = await persistBinaryContent(bytes, mimeType, persistId)

  if ('error' in result) {
    return [
      {
        type: 'text',
        text: `${sourceDescription}Binary content (${mimeType || 'unknown type'}, ${bytes.length} bytes) could not be saved to disk: ${result.error}`,
      },
    ]
  }

  return [
    {
      type: 'text',
      text: getBinaryBlobSavedMessage(
        result.filepath,
        mimeType,
        result.size,
        sourceDescription,
      ),
    },
  ]
}

/**
 * Processes MCP tool result into a normalized format.
 */
export type MCPResultType = 'toolResult' | 'structuredContent' | 'contentArray'

export type TransformedMCPResult = {
  content: MCPToolResult
  type: MCPResultType
  schema?: string
}

// ═══ 给 JSON 生成一个「jq 友好」的类型签名 ═══
//
// 输入 { title: 'x', items: [{id: 1, name: 'a'}] }
// 输出 "{title: string, items: [{id: number, name: string}]}"
//
// 用途：大输出落盘之后，模型拿到的是一个文件路径 + 这段签名。
// 签名告诉它「文件长什么样」，于是它能写出正确的 jq 命令去取数据，
// 而不需要先 cat 一遍（那会又占满上下文）。
//
// 三个限制：
//   深度默认 2（超过就 {...}）—— 太深的签名和原文一样长，失去意义
//   对象最多列 10 个键（2662 行）—— 同理
//   数组只看第一个元素 —— 假设同构（JSON 数组通常确实同构）
//
// 20 行的函数，但解决的是「怎么用极少的 token 描述数据结构」
// 这个相当核心的问题。
// ═══
/**
 * Generates a compact, jq-friendly type signature for a value.
 * e.g. "{title: string, items: [{id: number, name: string}]}"
 */
export function inferCompactSchema(value: unknown, depth = 2): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${inferCompactSchema(value[0], depth - 1)}]`
  }
  if (typeof value === 'object') {
    if (depth <= 0) return '{...}'
    const entries = Object.entries(value).slice(0, 10)
    const props = entries.map(
      ([k, v]) => `${k}: ${inferCompactSchema(v, depth - 1)}`,
    )
    const suffix = Object.keys(value).length > 10 ? ', ...' : ''
    return `{${props.join(', ')}${suffix}}`
  }
  return typeof value
}

// ═══ 三种返回形状，按优先级匹配 ═══
//
// toolResult         某些老实现/代理用这个字段直接塞字符串
// structuredContent  MCP 2025-06 之后的结构化输出（优先用它，
//                    因为它有 schema 保证）
// content            标准的 content 数组
//
// 顺序有意义：先看 toolResult（最古老的），再看 structuredContent，
// 最后 content。因为越靠前的越明确 —— 如果响应里有 toolResult 字段，
// 那它就是内容无疑；而 content 字段可能出现在很多地方。
//
// 三个都不匹配 → 抛错（2700 行）。注意错误消息里带了服务器名和工具名：
// "MCP server "slack" tool "search": unexpected response format"
// 因为这类错误几乎总是「某个特定服务器的实现不符合规范」，
// 不点名就没法排查。
// ═══
export async function transformMCPResult(
  result: unknown,
  tool: string, // Tool name for validation (e.g., "search")
  name: string, // Server name for transformation (e.g., "slack")
): Promise<TransformedMCPResult> {
  if (result && typeof result === 'object') {
    if ('toolResult' in result) {
      return {
        content: String(result.toolResult),
        type: 'toolResult',
      }
    }

    if (
      'structuredContent' in result &&
      result.structuredContent !== undefined
    ) {
      return {
        content: jsonStringify(result.structuredContent),
        type: 'structuredContent',
        schema: inferCompactSchema(result.structuredContent),
      }
    }

    if ('content' in result && Array.isArray(result.content)) {
      const transformedContent = (
        await Promise.all(
          result.content.map(item => transformResultContent(item, name)),
        )
      ).flat()
      return {
        content: transformedContent,
        type: 'contentArray',
        schema: inferCompactSchema(transformedContent),
      }
    }
  }

  const errorMessage = `MCP server "${name}" tool "${tool}": unexpected response format`
  logMCPError(name, errorMessage)
  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    errorMessage,
    'MCP tool unexpected response format',
  )
}

// ═══ 四道处理，按代价从低到高 ═══
//
// ① ide 服务器直接返回（2729 行）
//    IDE 工具的结果不发给模型（本地消费），所以不需要处理大小。
//
// ② 不需要截断就返回（2734 行）
//    绝大多数调用走这条。mcpContentNeedsTruncation 是快速判据。
//
// ③ 环境变量禁用落盘 → 退回纯截断（2741 行）
//    ENABLE_MCP_LARGE_OUTPUT_FILES 显式关闭时，走老行为：
//    直接把内容砍到上限。会丢信息，但兼容用户的选择。
//
// ④ 含图片 → 也退回截断（2758 行）
//    原因：落盘会把图片序列化成 JSON（base64 字符串），
//    既废掉了图片压缩逻辑，也让模型再也看不到那张图。
//    所以宁可截断（可能丢部分图），也不落盘。
//
// ⑤ 落盘（实际是第四道成功路径）
//    生成 id、序列化、写盘、返回「文件路径 + 类型签名 + 怎么读」。
//
// 五种结局，每一处埋点都带 outcome 和 reason（如
// {outcome:'truncated', reason:'contains_images'}）。
// 这样能统计出「落盘这条路到底有多少比例被走通了」——
// 没有这些埋点，就无法判断这个功能值不值得留。
// ═══
/**
 * Check if MCP content contains any image blocks.
 * Used to decide whether to persist to file (images should use truncation instead
 * to preserve image compression and viewability).
 */
function contentContainsImages(content: MCPToolResult): boolean {
  if (!content || typeof content === 'string') {
    return false
  }
  return content.some(block => block.type === 'image')
}

export async function processMCPResult(
  result: unknown,
  tool: string, // Tool name for validation (e.g., "search")
  name: string, // Server name for IDE check and transformation (e.g., "slack")
): Promise<MCPToolResult> {
  const { content, type, schema } = await transformMCPResult(result, tool, name)

  // IDE tools are not going to the model directly, so we don't need to
  // handle large output.
  if (name === 'ide') {
    return content
  }

  // Check if content needs truncation (i.e., is too large)
  if (!(await mcpContentNeedsTruncation(content))) {
    return content
  }

  const sizeEstimateTokens = getContentSizeEstimate(content)

  // If large output files feature is disabled, fall back to old truncation behavior
  if (isEnvDefinedFalsy(process.env.ENABLE_MCP_LARGE_OUTPUT_FILES)) {
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'env_disabled',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return await truncateMcpContentIfNeeded(content)
  }

  // Save large output to file and return instructions for reading it
  // Content is guaranteed to exist at this point (we checked mcpContentNeedsTruncation)
  if (!content) {
    return content
  }

  // If content contains images, fall back to truncation - persisting images as JSON
  // defeats the image compression logic and makes them non-viewable
  if (contentContainsImages(content)) {
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'contains_images',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return await truncateMcpContentIfNeeded(content)
  }

  // Generate a unique ID for the persisted file (server__tool-timestamp)
  const timestamp = Date.now()
  const persistId = `mcp-${normalizeNameForMCP(name)}-${normalizeNameForMCP(tool)}-${timestamp}`
  // Convert to string for persistence (persistToolResult expects string or specific block types)
  const contentStr =
    typeof content === 'string' ? content : jsonStringify(content, null, 2)
  const persistResult = await persistToolResult(contentStr, persistId)

  if (isPersistError(persistResult)) {
    // If file save failed, fall back to returning truncated content info
    const contentLength = contentStr.length
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'persist_failed',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return `Error: result (${contentLength.toLocaleString()} characters) exceeds maximum allowed tokens. Failed to save output to file: ${persistResult.error}. If this MCP server provides pagination or filtering tools, use them to retrieve specific portions of the data.`
  }

  logEvent('tengu_mcp_large_result_handled', {
    outcome: 'persisted',
    reason: 'file_saved',
    sizeEstimateTokens,
    persistedSizeChars: persistResult.originalSize,
  } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)

  const formatDescription = getFormatDescription(type, schema)
  return getLargeOutputInstructions(
    persistResult.filepath,
    persistResult.originalSize,
    formatDescription,
  )
}

// ═══ -32042：工具说「我需要用户先打开一个链接」═══
//
// 这是 MCP 里比较新的一个模式：工具不能直接完成，
// 它需要一个 OAuth 授权 / 一个确认页 / 一个外部流程。
// 服务器返回 JSON-RPC -32042（UrlElicitationRequired），
// 在 error.data 里带上要打开的 URL。
//
// 处理流程：
//   ① 解析 error.data.elicitations，逐个验证字段（2886 行）
//   ② 对每个：先跑 elicitation hooks（hooks 可以程序化解决，
//      比如测试环境自动接受）
//   ③ hooks 没解决 → 问用户（两种方式：print 模式走回调，REPL 走 UI 队列）
//   ④ 跑 result hooks（可以修改或拦截用户的回答）
//   ⑤ 全部 accept → **重试工具调用**（3024 行回到循环顶部）
//
// 上限 MAX_URL_ELICITATION_RETRIES = 3。为什么要有上限：
// 一个写错的服务器可能永远返回 -32042，无限重试就是死循环。
//
// 【值得注意的两个细节】
//
// 2862 行：用 `error.code !== ErrorCode.UrlElicitationRequired` 判断，
// 而不是 instanceof UrlElicitationRequiredError。
// 原因写在注释里：SDK 的 Protocol 层对错误响应造的是**裸 McpError**，
// 不是那个专门的子类。所以只能看 code。
//
// 2886 行：对 elicititations 数组**逐字段验证**。因为 error.data 是
// 外部服务器提供的任意 JSON —— 直接当类型用就是信任外部输入。
// 这里检查了 mode/url/elicitationId/message 四个字段的类型。
// ═══
/**
 * Call an MCP tool, handling UrlElicitationRequiredError (-32042) by
 * displaying the URL elicitation to the user, waiting for the completion
 * notification, and retrying the tool call.
 */
type MCPToolCallResult = {
  content: MCPToolResult
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
}

/** @internal Exported for testing. */
export async function callMCPToolWithUrlElicitationRetry({
  client: connectedClient,
  clientConnection,
  tool,
  args,
  meta,
  signal,
  setAppState,
  onProgress,
  callToolFn = callMCPTool,
  handleElicitation,
}: {
  client: ConnectedMCPServer
  clientConnection: MCPServerConnection
  tool: string
  args: Record<string, unknown>
  meta?: Record<string, unknown>
  signal: AbortSignal
  setAppState: (f: (prev: AppState) => AppState) => void
  onProgress?: (data: MCPProgress) => void
  /** Injectable for testing. Defaults to callMCPTool. */
  callToolFn?: (opts: {
    client: ConnectedMCPServer
    tool: string
    args: Record<string, unknown>
    meta?: Record<string, unknown>
    signal: AbortSignal
    onProgress?: (data: MCPProgress) => void
  }) => Promise<MCPToolCallResult>
  /** Handler for URL elicitations when no hook handles them.
   * In print/SDK mode, delegates to structuredIO. In REPL, falls back to queue. */
  handleElicitation?: (
    serverName: string,
    params: ElicitRequestURLParams,
    signal: AbortSignal,
  ) => Promise<ElicitResult>
}): Promise<MCPToolCallResult> {
  const MAX_URL_ELICITATION_RETRIES = 3
  for (let attempt = 0; ; attempt++) {
    try {
      return await callToolFn({
        client: connectedClient,
        tool,
        args,
        meta,
        signal,
        onProgress,
      })
    } catch (error) {
      // The MCP SDK's Protocol creates plain McpError (not UrlElicitationRequiredError)
      // for error responses, so we check the error code instead of instanceof.
      if (
        !(error instanceof McpError) ||
        error.code !== ErrorCode.UrlElicitationRequired
      ) {
        throw error
      }

      // Limit the number of URL elicitation retries
      if (attempt >= MAX_URL_ELICITATION_RETRIES) {
        throw error
      }

      const errorData = error.data
      const rawElicitations =
        errorData != null &&
        typeof errorData === 'object' &&
        'elicitations' in errorData &&
        Array.isArray(errorData.elicitations)
          ? (errorData.elicitations as unknown[])
          : []

      // Validate each element has the required fields for ElicitRequestURLParams
      const elicitations = rawElicitations.filter(
        (e): e is ElicitRequestURLParams => {
          if (e == null || typeof e !== 'object') return false
          const obj = e as Record<string, unknown>
          return (
            obj.mode === 'url' &&
            typeof obj.url === 'string' &&
            typeof obj.elicitationId === 'string' &&
            typeof obj.message === 'string'
          )
        },
      )

      const serverName =
        clientConnection.type === 'connected'
          ? clientConnection.name
          : 'unknown'

      if (elicitations.length === 0) {
        logMCPDebug(
          serverName,
          `Tool '${tool}' returned -32042 but no valid elicitations in error data`,
        )
        throw error
      }

      logMCPDebug(
        serverName,
        `Tool '${tool}' requires URL elicitation (error -32042, attempt ${attempt + 1}), processing ${elicitations.length} elicitation(s)`,
      )

      // Process each URL elicitation from the error.
      // The completion notification handler (in registerElicitationHandler) sets
      // `completed: true` on the matching queue event; the dialog reacts to this flag.
      for (const elicitation of elicitations) {
        const { elicitationId } = elicitation

        // Run elicitation hooks — they can resolve URL elicitations programmatically
        const hookResponse = await runElicitationHooks(
          serverName,
          elicitation,
          signal,
        )
        if (hookResponse) {
          logMCPDebug(
            serverName,
            `URL elicitation ${elicitationId} resolved by hook: ${jsonStringify(hookResponse)}`,
          )
          if (hookResponse.action !== 'accept') {
            return {
              content: `URL elicitation was ${hookResponse.action === 'decline' ? 'declined' : hookResponse.action + 'ed'} by a hook. The tool "${tool}" could not complete because it requires the user to open a URL.`,
            }
          }
          // Hook accepted — skip the UI and proceed to retry
          continue
        }

// ═══ 两种 elicit 投递方式，因为有两种运行形态 ═══
//
// print/SDK 模式（2945 行）：有一个 handleElicitation 回调，
// 直接 await 它。因为这种模式下没有交互式 UI，宿主程序（SDK 使用者）
// 负责回答。
//
// REPL 模式（2948 行）：推一个事件到 AppState 的 elicitation 队列，
// 由 Ink 组件渲染成对话框。等用户操作。
//
// 【REPL 分支里那个两阶段设计，是全文件最绕的一段】
//
// 看 respond 回调（2975 行）：
//   action === 'accept' → **什么都不做**（不 resolve promise）
//   其他 → resolve
//
// 为什么 accept 不 resolve：因为 accept 只是**第一阶段同意**
// （"是的，我要去打开这个链接"），还没完成。真正完成是
// 服务器通知「授权好了」（onWaitingDismiss 的 'retry'）。
//
// 所以流程是：
//   用户点「同意」→ respond('accept') → 什么都不发生
//   → UI 切到「等待中」状态（waitingState.actionLabel = 'Retry now'）
//   → 用户在浏览器里完成授权
//   → 服务器发通知 / 或者用户点「Retry now」
//   → onWaitingDismiss('retry') → resolve({action:'accept'})
//
// 这个"accept 是空操作"的设计非常反直觉，但它是必要的：
// 一次用户点击只能对应一个 promise resolve，而这个流程需要两次
// 用户动作才能算完成。
//
// signal 的处理也很细：abort 时 resolve 成 cancel（2955 行），
// 而且每次 resolve 前都先 removeEventListener —— 否则同一个
// abort 会让后面的 promise 提前 resolve。
// ═══
        // Resolve the URL elicitation via callback (print/SDK mode) or queue (REPL mode).
        let userResult: ElicitResult
        if (handleElicitation) {
          // Print/SDK mode: delegate to structuredIO which sends a control request
          userResult = await handleElicitation(serverName, elicitation, signal)
        } else {
          // REPL mode: queue for ElicitationDialog with two-phase consent/waiting flow
          const waitingState: ElicitationWaitingState = {
            actionLabel: 'Retry now',
            showCancel: true,
          }
          userResult = await new Promise<ElicitResult>(resolve => {
            const onAbort = () => {
              void resolve({ action: 'cancel' })
            }
            if (signal.aborted) {
              onAbort()
              return
            }
            signal.addEventListener('abort', onAbort, { once: true })

            setAppState(prev => ({
              ...prev,
              elicitation: {
                queue: [
                  ...prev.elicitation.queue,
                  {
                    serverName,
                    requestId: `error-elicit-${elicitationId}`,
                    params: elicitation,
                    signal,
                    waitingState,
                    respond: result => {
                      // Phase 1 consent: accept is a no-op (doesn't resolve retry Promise)
                      if (result.action === 'accept') {
                        return
                      }
                      // Decline or cancel: resolve the retry Promise
                      signal.removeEventListener('abort', onAbort)
                      void resolve(result)
                    },
                    onWaitingDismiss: action => {
                      signal.removeEventListener('abort', onAbort)
                      if (action === 'retry') {
                        void resolve({ action: 'accept' })
                      } else {
                        void resolve({ action: 'cancel' })
                      }
                    },
                  },
                ],
              },
            }))
          })
        }

        // Run ElicitationResult hooks — they can modify or block the response
        const finalResult = await runElicitationResultHooks(
          serverName,
          userResult,
          signal,
          'url',
          elicitationId,
        )

        if (finalResult.action !== 'accept') {
          logMCPDebug(
            serverName,
            `User ${finalResult.action === 'decline' ? 'declined' : finalResult.action + 'ed'} URL elicitation ${elicitationId}`,
          )
          return {
            content: `URL elicitation was ${finalResult.action === 'decline' ? 'declined' : finalResult.action + 'ed'} by the user. The tool "${tool}" could not complete because it requires the user to open a URL.`,
          }
        }

        logMCPDebug(
          serverName,
          `Elicitation ${elicitationId} completed, retrying tool call`,
        )
      }

      // Loop back to retry the tool call
    }
  }
}

// ═══ 真正的调用，六段 ═══
//
//   ① 每 30 秒打一条 "still running" 调试日志（3054 行）
//   ② 自己的超时 Promise（3068 行）
//   ③ callTool + onprogress 桥接
//   ④ isError 处理 → 抛 McpToolCallError（带 _meta）
//   ⑤ 成功：埋点 + processMCPResult
//   ⑥ 失败分类：401 / session 过期 / AbortError / 其他
//
// 【为什么要有自己的超时】
// 注释（3068 行）解释：SDK 内部的超时在有些情况下不生效 ——
// 比如 SSE 流中途断了，SDK 根本没机会触发自己的定时器。
// 所以外面再套一层 Promise.race，保证调用方一定能拿到结果。
//
// 注意 finally（3118 行）清 timeoutId：不清的话，一个已经完成的
// 调用会在 timeoutMs（默认 27.8 小时）后触发一个无人处理的 reject。
// Node 里未处理的 rejection 会打警告，在长会话里会积累成噪音。
//
// 【30 秒日志的意义】
// MCP 工具可能跑几十分钟（构建、部署）。没有这条日志，
// 用户和开发者都不知道它在动还是卡死了。日志本身是无害的
// （只写调试日志），但它是「可观测性」的最小实现。
// ═══
async function callMCPTool({
  client: { client, name, config },
  tool,
  args,
  meta,
  signal,
  onProgress,
}: {
  client: ConnectedMCPServer
  tool: string
  args: Record<string, unknown>
  meta?: Record<string, unknown>
  signal: AbortSignal
  onProgress?: (data: MCPProgress) => void
}): Promise<{
  content: MCPToolResult
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
}> {
  const toolStartTime = Date.now()
  let progressInterval: NodeJS.Timeout | undefined

  try {
    logMCPDebug(name, `Calling MCP tool: ${tool}`)

    // Set up progress logging for long-running tools (every 30 seconds)
    progressInterval = setInterval(
      (startTime, name, tool) => {
        const elapsed = Date.now() - startTime
        const elapsedSeconds = Math.floor(elapsed / 1000)
        const duration = `${elapsedSeconds}s`
        logMCPDebug(name, `Tool '${tool}' still running (${duration} elapsed)`)
      },
      30000, // Log every 30 seconds
      toolStartTime,
      name,
      tool,
    )

    // Use Promise.race with our own timeout to handle cases where SDK's
    // internal timeout doesn't work (e.g., SSE stream breaks mid-request)
    const timeoutMs = getMcpToolTimeoutMs()
    let timeoutId: NodeJS.Timeout | undefined

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        (reject, name, tool, timeoutMs) => {
          reject(
            new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
              `MCP server "${name}" tool "${tool}" timed out after ${Math.floor(timeoutMs / 1000)}s`,
              'MCP tool timeout',
            ),
          )
        },
        timeoutMs,
        reject,
        name,
        tool,
        timeoutMs,
      )
    })

    const result = await Promise.race([
      client.callTool(
        {
          name: tool,
          arguments: args,
          _meta: meta,
        },
        CallToolResultSchema,
        {
          signal,
          timeout: timeoutMs,
          onprogress: onProgress
            ? sdkProgress => {
                onProgress({
                  type: 'mcp_progress',
                  status: 'progress',
                  serverName: name,
                  toolName: tool,
                  progress: sdkProgress.progress,
                  total: sdkProgress.total,
                  progressMessage: sdkProgress.message,
                })
              }
            : undefined,
        },
      ),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    })

// ═══ isError: true —— 工具自己报告失败，但结果仍然有价值 ═══
//
// MCP 规范允许工具返回 isError: true 而不走协议错误。这里的处理是
// **抛异常**，但把 _meta 一起带出去（3144 行）。
//
// 注释说明了为什么 _meta 必须带（172-175 行的类注释）：
// "per the MCP spec, _meta is on the base Result type and is valid
//  on error results."
//
// 也就是说：即使工具失败，它也可能在 _meta 里放了诊断信息，
// SDK 消费者需要拿到。如果丢掉，上层就没法给出有用的错误提示。
//
// 错误详情提取的逻辑（3125-3142）也值得看：
//   优先 content[0].text     ← 标准做法
//   退而求其次 result.error  ← 老格式兼容
//   都没有 → 'Unknown error'
//
// 三种形状说明 MCP 生态的实现差异很大，不能只按 spec 写。
// ═══
    if ('isError' in result && result.isError) {
      let errorDetails = 'Unknown error'
      if (
        'content' in result &&
        Array.isArray(result.content) &&
        result.content.length > 0
      ) {
        const firstContent = result.content[0]
        if (
          firstContent &&
          typeof firstContent === 'object' &&
          'text' in firstContent
        ) {
          errorDetails = firstContent.text
        }
      } else if ('error' in result) {
        // Fallback for legacy error format
        errorDetails = String(result.error)
      }
      logMCPError(name, errorDetails)
      throw new McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        errorDetails,
        'MCP tool returned error',
        '_meta' in result && result._meta ? { _meta: result._meta } : undefined,
      )
    }
// ═══ 三段式时长格式化 ═══
//
//   < 1s      → "842ms"
//   < 1min    → "12s"
//   >= 1min   → "3m 27s"
//
// 小细节，但体现了「日志给人看」的态度。
// 一个 3m27s 的工具调用写成 "207000ms" 读者要在脑子里换算，
// 而换算成本会让人跳过这条日志。
// ═══
    const elapsed = Date.now() - toolStartTime
    const duration =
      elapsed < 1000
        ? `${elapsed}ms`
        : elapsed < 60000
          ? `${Math.floor(elapsed / 1000)}s`
          : `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`

    logMCPDebug(name, `Tool '${tool}' completed successfully in ${duration}`)

    // Log code indexing tool usage
    const codeIndexingTool = detectCodeIndexingFromMcpServerName(name)
    if (codeIndexingTool) {
      logEvent('tengu_code_indexing_tool_used', {
        tool: codeIndexingTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source:
          'mcp' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: true,
      })
    }

    const content = await processMCPResult(result, tool, name)
    return {
      content,
      _meta: result._meta as Record<string, unknown> | undefined,
      structuredContent: result.structuredContent as
        | Record<string, unknown>
        | undefined,
    }
  } catch (e) {
    // Clear intervals on error
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }

    const elapsed = Date.now() - toolStartTime

    if (e instanceof Error && e.name !== 'AbortError') {
      logMCPDebug(
        name,
        `Tool '${tool}' failed after ${Math.floor(elapsed / 1000)}s: ${e.message}`,
      )
    }

// ═══ 失败分类的四个出口 ═══
//
// ① 401 / UnauthorizedError → McpAuthError（3204 行）
//    上层会把它翻译成「服务器状态改为 needs-auth」，然后
//    （在批量连接那边）暴露一个认证工具给模型。
//
// ② session 过期 → clearServerCache + McpSessionExpiredError（3223 行）
//    见下面那条批注。
//
// ③ AbortError → **返回 `{ content: undefined }`，不抛**（3238 行）
//    用户按了 Esc。抛错会在日志和 UI 上产生一堆噪音，
//    而这不是「错误」，是用户的正常操作。
//    注释原话："When the users hits esc, avoid logspew"。
//
// ④ 其他 → 原样抛（3236 行）
//
// 【② 的两种错误形状，注释列得很清楚】
//   1. 直接的 404 + JSON-RPC -32001（StreamableHTTPError）
//   2. -32000 "Connection closed"（McpError）——
//      因为 SDK 在 onerror 之后会关 transport，于是挂起的 callTool
//      拿到的是这个**派生**错误，而不是原始的 404
//
// 第二种是「上层看到的错误和底层发生的事不一样」的典型案例。
// 如果不处理它，用户会看到 "Connection closed"，而实际原因
// 是「会话过期了，重连就好」—— 完全没法从错误消息里推出来。
//
// 注意 3220 行的条件里还检查了 config.type：
// 只对 http / claudeai-proxy 生效。因为 -32000 在 stdio 上
// 意味着真的关闭了，不该当成会话过期处理。
// ═══
    // Check for 401 errors indicating expired/invalid OAuth tokens
    // The MCP SDK's StreamableHTTPError has a `code` property with the HTTP status
    if (e instanceof Error) {
      const errorCode = 'code' in e ? (e.code as number | undefined) : undefined
      if (errorCode === 401 || e instanceof UnauthorizedError) {
        logMCPDebug(
          name,
          `Tool call returned 401 Unauthorized - token may have expired`,
        )
        logEvent('tengu_mcp_tool_call_auth_error', {})
        throw new McpAuthError(
          name,
          `MCP server "${name}" requires re-authorization (token expired)`,
        )
      }

      // Check for session expiry — two error shapes can surface here:
      // 1. Direct 404 + JSON-RPC -32001 from the server (StreamableHTTPError)
      // 2. -32000 "Connection closed" (McpError) — the SDK closes the transport
      //    after the onerror handler fires, so the pending callTool() rejects
      //    with this derived error instead of the original 404.
      // In both cases, clear the connection cache so the next tool call
      // creates a fresh session.
      const isSessionExpired = isMcpSessionExpiredError(e)
      const isConnectionClosedOnHttp =
        'code' in e &&
        (e as Error & { code?: number }).code === -32000 &&
        e.message.includes('Connection closed') &&
        (config.type === 'http' || config.type === 'claudeai-proxy')
      if (isSessionExpired || isConnectionClosedOnHttp) {
        logMCPDebug(
          name,
          `MCP session expired during tool call (${isSessionExpired ? '404/-32001' : 'connection closed'}), clearing connection cache for re-initialization`,
        )
        logEvent('tengu_mcp_session_expired', {})
        await clearServerCache(name, config)
        throw new McpSessionExpiredError(name)
      }
    }

    // When the users hits esc, avoid logspew
    if (!(e instanceof Error) || e.name !== 'AbortError') {
      throw e
    }
    return { content: undefined }
  } finally {
    // Always clear intervals
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }
  }
}

// ═══ 只看 content[0]，是个刻意的简化 ═══
//
// tool_use_id 用于进度上报和 _meta 透传。这个函数假设
// 父消息的第一块就是 tool_use。
//
// 什么时候不成立：模型在一条消息里先输出文本再调工具
// （thinking → text → tool_use）。那时 content[0] 是 thinking 或 text，
// 这个函数返回 undefined。
//
// 后果是什么：进度上报被跳过（1846 行 `if (onProgress && toolUseId)`），
// _meta 里不带 toolUseId。**功能降级，但不报错**。
//
// 所以这是个「已知不完整但够用」的实现。生产代码里这类东西很多，
// 判断它合不合理要看：失败时是降级还是崩溃。这里是降级，还行。
// ═══
function extractToolUseId(message: AssistantMessage): string | undefined {
  if (message.message.content[0]?.type !== 'tool_use') {
    return undefined
  }
  return message.message.content[0].id
}

// ═══ SDK 类型的 MCP 服务器：走控制通道，不走网络 ═══
//
// 这类服务器是 Agent SDK 的使用者在自己进程里注册的。
// 通信方式：SdkControlClientTransport 把 JSON-RPC 消息
// 通过 sendMcpMessage 回调交给宿主，宿主的响应再回来。
//
// 相当于把「MCP 协议」当成了一个**进程内的消息格式**，
// 底层可以是控制通道、stdin/stdout、甚至 WebSocket（由宿主决定）。
// transport 抽象在这里又一次证明了自己的价值。
//
// 【Promise.allSettled 而不是 all】
// 一个 SDK 服务器连不上不该让其他的也失败。
// 注意注释（3344 行）说 rejected 是「unexpected」的 ——
// 因为每个 promise 内部已经 try/catch 过了，正常情况下
// 只会 fulfilled（里面装一个 failed 的 client）。
// allSettled 是第二层保险。
//
// 和 connectToServer 对比：那条路是「失败返回对象」，
// 这条也是。全文件贯彻了同一个错误即数据的约定。
// ═══
/**
 * Sets up SDK MCP clients by creating transports and connecting them.
 * This is used for SDK MCP servers that run in the same process as the SDK.
 *
 * @param sdkMcpConfigs - The SDK MCP server configurations
 * @param sendMcpMessage - Callback to send MCP messages through the control channel
 * @returns Connected clients, their tools, and transport map for message routing
 */
export async function setupSdkMcpClients(
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  sendMcpMessage: (
    serverName: string,
    message: JSONRPCMessage,
  ) => Promise<JSONRPCMessage>,
): Promise<{
  clients: MCPServerConnection[]
  tools: Tool[]
}> {
  const clients: MCPServerConnection[] = []
  const tools: Tool[] = []

  // Connect to all servers in parallel
  const results = await Promise.allSettled(
    Object.entries(sdkMcpConfigs).map(async ([name, config]) => {
      const transport = new SdkControlClientTransport(name, sendMcpMessage)

      const client = new Client(
        {
          name: 'claude-code',
          title: 'Claude Code',
          version: MACRO.VERSION ?? 'unknown',
          description: "Anthropic's agentic coding tool",
          websiteUrl: PRODUCT_URL,
        },
        {
          capabilities: {},
        },
      )

// ═══ SDK 服务器的 capabilities 声明为空 ═══
//
// 和 985 行那个 Client 不同（那里声明了 roots + elicitation）。
// 因为 SDK 服务器是宿主自己实现的，宿主不需要我们向它要根目录，
// 也不太可能用我们的 elicitation UI。
//
// 空 capabilities 意味着：不主动声明任何客户端能力。
// 服务器如果请求 elicitation，SDK 会拒绝 —— 而这是合理的，
// 因为宿主自己就是服务器，它怎么会需要问客户端？
// ═══
      try {
        // Connect the client
        await client.connect(transport)

        // Get capabilities from the server
        const capabilities = client.getServerCapabilities()

        // Create the connected client object
        const connectedClient: MCPServerConnection = {
          type: 'connected',
          name,
          capabilities: capabilities || {},
          client,
          config: { ...config, scope: 'dynamic' as const },
          cleanup: async () => {
            await client.close()
          },
        }

        // Fetch tools if the server has them
        const serverTools: Tool[] = []
        if (capabilities?.tools) {
          const sdkTools = await fetchToolsForClient(connectedClient)
          serverTools.push(...sdkTools)
        }

        return {
          client: connectedClient,
          tools: serverTools,
        }
      } catch (error) {
        // If connection fails, return failed server
        logMCPError(name, `Failed to connect SDK MCP server: ${error}`)
        return {
          client: {
            type: 'failed' as const,
            name,
            config: { ...config, scope: 'user' as const },
          },
          tools: [],
        }
      }
    }),
  )

  // Process results and collect clients and tools
  for (const result of results) {
    if (result.status === 'fulfilled') {
      clients.push(result.value.client)
      tools.push(...result.value.tools)
    }
    // If rejected (unexpected), the error was already logged inside the promise
  }

  return { clients, tools }
}
