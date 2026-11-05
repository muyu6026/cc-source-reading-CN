/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlPermissionRequest,
  StdoutMessage,
} from '../entrypoints/sdk/controlTypes.js'
import type { RemotePermissionResponse } from '../remote/RemoteSessionManager.js'
import { logForDebugging } from '../utils/debug.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'

// 直连配置：服务器地址、会话号、WebSocket 地址与可选的鉴权令牌
export type DirectConnectConfig = {
  serverUrl: string
  sessionId: string
  wsUrl: string
  authToken?: string
}

// 直连回调集合：消息、权限请求与连接生命周期事件
export type DirectConnectCallbacks = {
  onMessage: (message: SDKMessage) => void
  onPermissionRequest: (
    request: SDKControlPermissionRequest,
    requestId: string,
  ) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (error: Error) => void
}

// 类型守卫：判断一条消息是否属于标准输出帧
function isStdoutMessage(value: unknown): value is StdoutMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

// 直连会话管理器：在浏览器或本地用 WebSocket 直接对接后端
export class DirectConnectSessionManager {
  private ws: WebSocket | null = null
  private config: DirectConnectConfig
  private callbacks: DirectConnectCallbacks

  constructor(config: DirectConnectConfig, callbacks: DirectConnectCallbacks) {
    this.config = config
    this.callbacks = callbacks
  }

// 建立连接：带上鉴权头并注册各类事件监听器
  connect(): void {
    const headers: Record<string, string> = {}
    if (this.config.authToken) {
      headers['authorization'] = `Bearer ${this.config.authToken}`
    }
    // Bun's WebSocket supports headers option but the DOM typings don't
    this.ws = new WebSocket(this.config.wsUrl, {
      headers,
    } as unknown as string[])

    this.ws.addEventListener('open', () => {
      this.callbacks.onConnected?.()
    })

    this.ws.addEventListener('message', event => {
      const data = typeof event.data === 'string' ? event.data : ''
      const lines = data.split('\n').filter((l: string) => l.trim())

      for (const line of lines) {
        let raw: unknown
        try {
          raw = jsonParse(line)
        } catch {
          continue
        }

        if (!isStdoutMessage(raw)) {
          continue
        }
        const parsed = raw

        // Handle control requests (permission requests)
        if (parsed.type === 'control_request') {
// 识别控制请求（权限询问），未知子类型回送错误以免服务端空等
          if (parsed.request.subtype === 'can_use_tool') {
            this.callbacks.onPermissionRequest(
              parsed.request,
              parsed.request_id,
            )
          } else {
            // Send an error response for unrecognized subtypes so the
            // server doesn't hang waiting for a reply that never comes.
            logForDebugging(
              `[DirectConnect] Unsupported control request subtype: ${parsed.request.subtype}`,
            )
            this.sendErrorResponse(
              parsed.request_id,
              `Unsupported control request subtype: ${parsed.request.subtype}`,
            )
          }
          continue
        }

        // Forward SDK messages (assistant, result, system, etc.)
        if (
          parsed.type !== 'control_response' &&
          parsed.type !== 'keep_alive' &&
          parsed.type !== 'control_cancel_request' &&
          parsed.type !== 'streamlined_text' &&
          parsed.type !== 'streamlined_tool_use_summary' &&
          !(parsed.type === 'system' && parsed.subtype === 'post_turn_summary')
        ) {
          this.callbacks.onMessage(parsed)
        }
      }
    })

    this.ws.addEventListener('close', () => {
      this.callbacks.onDisconnected?.()
    })

    this.ws.addEventListener('error', () => {
      this.callbacks.onError?.(new Error('WebSocket connection error'))
    })
  }

// 发送用户消息：拼成 stream-json 输入格式所需的用户帧
  sendMessage(content: RemoteMessageContent): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }

    // Must match SDKUserMessage format expected by `--input-format stream-json`
    const message = jsonStringify({
      type: 'user',
      message: {
        role: 'user',
        content: content,
      },
      parent_tool_use_id: null,
      session_id: '',
    })
    this.ws.send(message)
    return true
  }

// 回应权限请求：按允许或拒绝两种结果回填控件
  respondToPermissionRequest(
    requestId: string,
    result: RemotePermissionResponse,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    // Must match SDKControlResponse format expected by StructuredIO
    const response = jsonStringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: result.behavior,
          ...(result.behavior === 'allow'
            ? { updatedInput: result.updatedInput }
            : { message: result.message }),
        },
      },
    })
    this.ws.send(response)
  }

  /**
   * Send an interrupt signal to cancel the current request
   */
// 发送中断信号：取消当前正在进行的请求
  sendInterrupt(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    // Must match SDKControlRequest format expected by StructuredIO
    const request = jsonStringify({
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: {
        subtype: 'interrupt',
      },
    })
    this.ws.send(request)
  }

// 私有方法：向服务端回送错误响应
  private sendErrorResponse(requestId: string, error: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    const response = jsonStringify({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error,
      },
    })
    this.ws.send(response)
  }

// 断开连接并清空 WebSocket 句柄
  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

// 判断是否仍处于连接打开状态
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
