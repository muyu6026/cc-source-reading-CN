import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  type JSONRPCMessage,
  JSONRPCMessageSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type WsWebSocket from 'ws'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { toError } from './errors.js'
import { jsonParse, jsonStringify } from './slowOperations.js'

// WebSocket readyState constants (same for both native and ws)
const WS_CONNECTING = 0
const WS_OPEN = 1

// 文件顶部说明：WebSocket 就绪状态常量与接口定义，原生与 ws 两种实现取值一致。
// Minimal interface shared by globalThis.WebSocket and ws.WebSocket
type WebSocketLike = {
  readonly readyState: number
  close(): void
  send(data: string): void
}
// WebSocketLike 抽离出原生 WebSocket 与 ws 包共有的最小方法集合，让传输层与具体实现解耦。

export class WebSocketTransport implements Transport {
  private started = false
  private opened: Promise<void>
  private isBun = typeof Bun !== 'undefined'

  constructor(private ws: WebSocketLike) {
    this.opened = new Promise((resolve, reject) => {
      if (this.ws.readyState === WS_OPEN) {
        resolve()
      } else if (this.isBun) {
        const nws = this.ws as unknown as globalThis.WebSocket
        const onOpen = () => {
          nws.removeEventListener('open', onOpen)
          nws.removeEventListener('error', onError)
          resolve()
        }
        const onError = (event: Event) => {
          nws.removeEventListener('open', onOpen)
          nws.removeEventListener('error', onError)
          logForDiagnosticsNoPII('error', 'mcp_websocket_connect_fail')
          reject(event)
        }
        nws.addEventListener('open', onOpen)
        nws.addEventListener('error', onError)
      } else {
        const nws = this.ws as unknown as WsWebSocket
        nws.on('open', () => {
          resolve()
        })
        nws.on('error', error => {
          logForDiagnosticsNoPII('error', 'mcp_websocket_connect_fail')
          reject(error)
        })
      }
    })

    // Attach persistent event handlers
    if (this.isBun) {
      const nws = this.ws as unknown as globalThis.WebSocket
      nws.addEventListener('message', this.onBunMessage)
      nws.addEventListener('error', this.onBunError)
      nws.addEventListener('close', this.onBunClose)
    } else {
      const nws = this.ws as unknown as WsWebSocket
      nws.on('message', this.onNodeMessage)
      nws.on('error', this.onNodeError)
      nws.on('close', this.onNodeClose)
    }
  }
// 构造函数收尾：根据运行环境（Bun 原生或 Node ws）挂载对应的消息、错误、关闭事件处理器。

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  // Bun (native WebSocket) event handlers
  private onBunMessage = (event: MessageEvent) => {
    try {
      const data =
        typeof event.data === 'string' ? event.data : String(event.data)
      const messageObj = jsonParse(data)
      const message = JSONRPCMessageSchema.parse(messageObj)
      this.onmessage?.(message)
    } catch (error) {
      this.handleError(error)
    }
  }
// onBunMessage 把收到的字符串解析为 JSON-RPC 消息并回调 onmessage，解析失败转交错误处理。

  private onBunError = () => {
    this.handleError(new Error('WebSocket error'))
  }
// onBunError 把底层 WebSocket 错误包装成标准 Error 后交给共享错误处理。

  private onBunClose = () => {
    this.handleCloseCleanup()
  }
// onBunClose 在连接关闭时执行共享的清理逻辑。

  // Node (ws package) event handlers
  private onNodeMessage = (data: Buffer) => {
    try {
      const messageObj = jsonParse(data.toString('utf-8'))
      const message = JSONRPCMessageSchema.parse(messageObj)
      this.onmessage?.(message)
    } catch (error) {
      this.handleError(error)
    }
  }
// onNodeMessage 把 Node ws 的 Buffer 转成 UTF-8 字符串后解析 JSON-RPC 消息。

  private onNodeError = (error: unknown) => {
    this.handleError(error)
  }
// onNodeError 透传 Node ws 的错误给共享错误处理。

  private onNodeClose = () => {
    this.handleCloseCleanup()
  }
// onNodeClose 在 Node ws 关闭时执行共享清理逻辑。

  // Shared error handler
  private handleError(error: unknown): void {
    logForDiagnosticsNoPII('error', 'mcp_websocket_message_fail')
    this.onerror?.(toError(error))
  }
// handleError 记录诊断日志并回调 onerror，统一两类运行时的错误出口。

  // Shared close handler with listener cleanup
  private handleCloseCleanup(): void {
    this.onclose?.()
    // Clean up listeners after close
    if (this.isBun) {
      const nws = this.ws as unknown as globalThis.WebSocket
      nws.removeEventListener('message', this.onBunMessage)
      nws.removeEventListener('error', this.onBunError)
      nws.removeEventListener('close', this.onBunClose)
    } else {
      const nws = this.ws as unknown as WsWebSocket
      nws.off('message', this.onNodeMessage)
      nws.off('error', this.onNodeError)
      nws.off('close', this.onNodeClose)
    }
  }
// handleCloseCleanup 收尾：在关闭后移除所有监听器，兼容原生与 ws 两种卸载方式。

  /**
   * Starts listening for messages on the WebSocket.
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Start can only be called once per transport.')
    }
    await this.opened
    if (this.ws.readyState !== WS_OPEN) {
      logForDiagnosticsNoPII('error', 'mcp_websocket_start_not_opened')
      throw new Error('WebSocket is not open. Cannot start transport.')
    }
    this.started = true
    // Unlike stdio, WebSocket connections are typically already established when the transport is created.
    // No explicit connection action needed here, just attaching listeners.
  }
// start 收尾：WebSocket 通常已在创建时建立，这里仅校验状态并标记已开始，无需主动连接。

  /**
   * Closes the WebSocket connection.
   */
  async close(): Promise<void> {
    if (
      this.ws.readyState === WS_OPEN ||
      this.ws.readyState === WS_CONNECTING
    ) {
      this.ws.close()
    }
    // Ensure listeners are removed even if close was called externally or connection was already closed
    this.handleCloseCleanup()
  }
// close 收尾：在连接打开或连接中时主动关闭，并确保外部调用后监听器仍被清理。

  /**
   * Sends a JSON-RPC message over the WebSocket connection.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.ws.readyState !== WS_OPEN) {
      logForDiagnosticsNoPII('error', 'mcp_websocket_send_not_opened')
      throw new Error('WebSocket is not open. Cannot send message.')
    }
    const json = jsonStringify(message)

    try {
      if (this.isBun) {
        // Native WebSocket.send() is synchronous (no callback)
        this.ws.send(json)
      } else {
        await new Promise<void>((resolve, reject) => {
          ;(this.ws as unknown as WsWebSocket).send(json, error => {
            if (error) {
              reject(error)
            } else {
              resolve()
            }
          })
        })
      }
    } catch (error) {
      this.handleError(error)
      throw error
    }
  }
// send 收尾：仅在连接打开时发送 JSON-RPC 消息，Bun 同步发送、Node 异步等待回调结果。
}
