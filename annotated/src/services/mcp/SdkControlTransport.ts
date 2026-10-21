/**
 * SDK MCP Transport Bridge
 *
 * This file implements a transport bridge that allows MCP servers running in the SDK process
 * to communicate with the Claude Code CLI process through control messages.
 *
 * ## Architecture Overview
 *
 * Unlike regular MCP servers that run as separate processes, SDK MCP servers run in-process
 * within the SDK. This requires a special transport mechanism to bridge communication between:
 * - The CLI process (where the MCP client runs)
 * - The SDK process (where the SDK MCP server runs)
 *
 * ## Message Flow
 *
 * ### CLI → SDK (via SdkControlClientTransport)
 * 1. CLI's MCP Client calls a tool → sends JSONRPC request to SdkControlClientTransport
 * 2. Transport wraps the message in a control request with server_name and request_id
 * 3. Control request is sent via stdout to the SDK process
 * 4. SDK's StructuredIO receives the control response and routes it back to the transport
 * 5. Transport unwraps the response and returns it to the MCP Client
 *
 * ### SDK → CLI (via SdkControlServerTransport)
 * 1. Query receives control request with MCP message and calls transport.onmessage
 * 2. MCP server processes the message and calls transport.send() with response
 * 3. Transport calls sendMcpMessage callback with the response
 * 4. Query's callback resolves the pending promise with the response
 * 5. Query returns the response to complete the control request
 *
 * ## Key Design Points
 *
 * - SdkControlClientTransport: StructuredIO tracks pending requests
 * - SdkControlServerTransport: Query tracks pending requests
 * - The control request wrapper includes server_name to route to the correct SDK server
 * - The system supports multiple SDK MCP servers running simultaneously
 * - Message IDs are preserved through the entire flow for proper correlation
 */
// 这段文件头是全仓库少见的「把协议写清楚了」的注释。补一句读法：
//
// 这里**没有真正的传输**。两个类分别住在 CLI 进程和 SDK 进程里，
// 所谓「transport」只是把 JSON-RPC 消息套进 control 消息的信封里，
// 再交给本来就存在的 stdout/stdin 通道。所以读它时不要找 socket、不要找缓冲，
// 要找的是「谁在等谁」。

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

/**
 * Callback function to send an MCP message and get the response
 */
export type SendMcpMessageCallback = (
  serverName: string,
  message: JSONRPCMessage,
) => Promise<JSONRPCMessage>

/**
 * CLI-side transport for SDK MCP servers.
 *
 * This transport is used in the CLI process to bridge communication between:
 * - The CLI's MCP Client (which wants to call tools on SDK MCP servers)
 * - The SDK process (where the actual MCP server runs)
 *
 * It converts MCP protocol messages into control requests that can be sent
 * through stdout/stdin to the SDK process.
 */
export class SdkControlClientTransport implements Transport {
// 客户端侧：一次 send = 一次等回包的 control 请求。
//
// 这里把 MCP 的 send 语义**放大**了。MCP 的 send 本意是「把消息投出去就返回」，
// 而这里会 await 到对端处理完。对 notification（没有 id、协议上不该有回包）
// 而言，这条依赖的是「CLI 侧对每条 MCP 消息都会回一个 control 响应」这个约定 ——
// 一旦某条路径漏了回包，send 就会一直挂着，而上层看到的是「工具调用没反应」。
  private isClosed = false

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(
    private serverName: string,
    private sendMcpMessage: SendMcpMessageCallback,
  ) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
// 注意回包是**通过 onmessage 塞回去**的，不是 send 的返回值。
//
// 所以真正的「请求 ↔ 响应配对」用的是 JSON-RPC 自己的 id，不是这层信封；
// 信封里的 request_id 只用来配 control 请求。两套 id 同时存在，读日志时
// 要分清自己在看哪一层 —— 这是这份文件最容易看糊涂的地方。
    if (this.isClosed) {
      throw new Error('Transport is closed')
    }

    // Send the message and wait for the response
    const response = await this.sendMcpMessage(this.serverName, message)

    // Pass the response back to the MCP client
    if (this.onmessage) {
      this.onmessage(response)
    }
  }

  async close(): Promise<void> {
    if (this.isClosed) {
      return
    }
    this.isClosed = true
    this.onclose?.()
  }
}

/**
 * SDK-side transport for SDK MCP servers.
 *
 * This transport is used in the SDK process to bridge communication between:
 * - Control requests coming from the CLI (via stdin)
 * - The actual MCP server running in the SDK process
 *
 * It acts as a simple pass-through that forwards messages to the MCP server
 * and sends responses back via a callback.
 *
 * Note: Query handles all request/response correlation and async flow.
 */
export class SdkControlServerTransport implements Transport {
// 服务端侧反过来：不做任何等待，收到就交给回调。
//
// 于是 SDK 侧的背压是零 —— 连着发多条消息不会互相阻塞，也不需要队列。
// 代价是「发送成功」在这里只意味着「交出去了」，不意味着「对方收到了」。
// 两侧的 send 语义并不对称，但类型签名一模一样（都是 Promise<void>），
// 只能靠注释区分。
  private isClosed = false

  constructor(private sendMcpMessage: (message: JSONRPCMessage) => void) {}

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.isClosed) {
      throw new Error('Transport is closed')
    }

    // Simply pass the response back through the callback
    this.sendMcpMessage(message)
  }

  async close(): Promise<void> {
    if (this.isClosed) {
      return
    }
    this.isClosed = true
    this.onclose?.()
  }
}
