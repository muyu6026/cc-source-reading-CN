import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlPermissionRequest,
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import {
  type RemoteMessageContent,
  sendEventToRemoteSession,
} from '../utils/teleport/api.js'
import {
  SessionsWebSocket,
  type SessionsWebSocketCallbacks,
} from './SessionsWebSocket.js'

// 类型守卫：判断一条消息是不是 SDK 业务消息，而不是控制类消息
/**
 * Type guard to check if a message is an SDKMessage (not a control message)
 */
function isSDKMessage(
  message:
    | SDKMessage
    | SDKControlRequest
    | SDKControlResponse
    | SDKControlCancelRequest,
): message is SDKMessage {
  return (
// 靠 type 字段排除三种控制消息，其余都当成业务消息放行
    message.type !== 'control_request' &&
    message.type !== 'control_response' &&
    message.type !== 'control_cancel_request'
  )
}

/**
 * Simple permission response for remote sessions.
 * This is a simplified version of PermissionResult for CCR communication.
 */
// 远程会话的权限响应：要么放行并带回修正后的输入，要么拒绝并带理由
export type RemotePermissionResponse =
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
    }
  | {
      behavior: 'deny'
      message: string
    }

// 远程会话配置：会话 ID、取令牌的函数、组织 UUID，以及是否纯观众模式
export type RemoteSessionConfig = {
  sessionId: string
  getAccessToken: () => string
  orgUuid: string
  /** True if session was created with an initial prompt that's being processed */
  hasInitialPrompt?: boolean
  /**
   * When true, this client is a pure viewer. Ctrl+C/Escape do NOT send
   * interrupt to the remote agent; 60s reconnect timeout is disabled;
   * session title is never updated. Used by `claude assistant`.
   */
  viewerOnly?: boolean
}
// viewerOnly 是给「claude assistant」用的：不接管中断、不更新标题、禁用重连超时

// 远程会话的回调集合：消息到达、权限请求、连接状态变化等事件
export type RemoteSessionCallbacks = {
  /** Called when an SDKMessage is received from the session */
  onMessage: (message: SDKMessage) => void
  /** Called when a permission request is received from CCR */
  onPermissionRequest: (
    request: SDKControlPermissionRequest,
    requestId: string,
  ) => void
  /** Called when the server cancels a pending permission request */
  onPermissionCancelled?: (
    requestId: string,
    toolUseId: string | undefined,
  ) => void
  /** Called when connection is established */
  onConnected?: () => void
  /** Called when connection is lost and cannot be restored */
  onDisconnected?: () => void
  /** Called on transient WS drop while reconnect backoff is in progress */
  onReconnecting?: () => void
  /** Called on error */
  onError?: (error: Error) => void
}

/**
 * Manages a remote CCR session.
 *
 * Coordinates:
 * - WebSocket subscription for receiving messages from CCR
 * - HTTP POST for sending user messages to CCR
 * - Permission request/response flow
 */
// RemoteSessionManager：管一条远端 CCR 会话，WebSocket 收消息、HTTP 发消息、权限往返
export class RemoteSessionManager {
  private websocket: SessionsWebSocket | null = null
// 两个私有字段：WebSocket 实例与待确认的权限请求表
  private pendingPermissionRequests: Map<string, SDKControlPermissionRequest> =
    new Map()

  constructor(
    private readonly config: RemoteSessionConfig,
    private readonly callbacks: RemoteSessionCallbacks,
  ) {}

  /**
   * Connect to the remote session via WebSocket
   */
// connect：建立 WebSocket 订阅，把各类回调接上
  connect(): void {
    logForDebugging(
      `[RemoteSessionManager] Connecting to session ${this.config.sessionId}`,
    )

    const wsCallbacks: SessionsWebSocketCallbacks = {
      onMessage: message => this.handleMessage(message),
      onConnected: () => {
        logForDebugging('[RemoteSessionManager] Connected')
        this.callbacks.onConnected?.()
      },
      onClose: () => {
        logForDebugging('[RemoteSessionManager] Disconnected')
        this.callbacks.onDisconnected?.()
      },
      onReconnecting: () => {
        logForDebugging('[RemoteSessionManager] Reconnecting')
        this.callbacks.onReconnecting?.()
      },
      onError: error => {
        logError(error)
        this.callbacks.onError?.(error)
      },
    }

    this.websocket = new SessionsWebSocket(
      this.config.sessionId,
      this.config.orgUuid,
      this.config.getAccessToken,
      wsCallbacks,
    )

    void this.websocket.connect()
  }
// 建好会话后立刻发起连接，但不在构造函数里做，避免副作用难以测试

  /**
   * Handle messages from WebSocket
   */
// handleMessage：按消息类型分流到不同处理逻辑
  private handleMessage(
    message:
      | SDKMessage
      | SDKControlRequest
      | SDKControlResponse
      | SDKControlCancelRequest,
  ): void {
    // Handle control requests (permission prompts from CCR)
    if (message.type === 'control_request') {
// 控制请求（权限弹窗）单独处理并提前返回
      this.handleControlRequest(message)
      return
    }

    // Handle control cancel requests (server cancelling a pending permission prompt)
    if (message.type === 'control_cancel_request') {
// 控制取消请求：把待确认项删掉并通知上层已取消
      const { request_id } = message
      const pendingRequest = this.pendingPermissionRequests.get(request_id)
      logForDebugging(
        `[RemoteSessionManager] Permission request cancelled: ${request_id}`,
      )
      this.pendingPermissionRequests.delete(request_id)
      this.callbacks.onPermissionCancelled?.(
        request_id,
        pendingRequest?.tool_use_id,
      )
      return
    }

    // Handle control responses (acknowledgments)
    if (message.type === 'control_response') {
      logForDebugging('[RemoteSessionManager] Received control response')
      return
    }

    // Forward SDK messages to callback (type guard ensures proper narrowing)
    if (isSDKMessage(message)) {
// SDK 业务消息交给类型守卫收窄后回调给上层
      this.callbacks.onMessage(message)
    }
  }

  /**
   * Handle control requests from CCR (e.g., permission requests)
   */
// handleControlRequest：处理 CCR 发来的权限请求或未知子类型
  private handleControlRequest(request: SDKControlRequest): void {
    const { request_id, request: inner } = request

    if (inner.subtype === 'can_use_tool') {
// can_use_tool 子类型才弹权限框，其余返回错误响应防止服务端空等
      logForDebugging(
        `[RemoteSessionManager] Permission request for tool: ${inner.tool_name}`,
      )
      this.pendingPermissionRequests.set(request_id, inner)
      this.callbacks.onPermissionRequest(inner, request_id)
    } else {
      // Send an error response for unrecognized subtypes so the server
      // doesn't hang waiting for a reply that never comes.
      logForDebugging(
        `[RemoteSessionManager] Unsupported control request subtype: ${inner.subtype}`,
      )
      const response: SDKControlResponse = {
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id,
          error: `Unsupported control request subtype: ${inner.subtype}`,
        },
      }
      this.websocket?.sendControlResponse(response)
    }
  }

  /**
   * Send a user message to the remote session via HTTP POST
   */
// sendMessage：通过 HTTP POST 把用户消息发到远端会话
  async sendMessage(
    content: RemoteMessageContent,
    opts?: { uuid?: string },
  ): Promise<boolean> {
    logForDebugging(
      `[RemoteSessionManager] Sending message to session ${this.config.sessionId}`,
    )

    const success = await sendEventToRemoteSession(
      this.config.sessionId,
      content,
      opts,
    )

    if (!success) {
// 发送失败只记日志不抛错，让调用方根据返回值决定是否重试
      logError(
        new Error(
          `[RemoteSessionManager] Failed to send message to session ${this.config.sessionId}`,
        ),
      )
    }

    return success
  }

  /**
   * Respond to a permission request from CCR
   */
// respondToPermissionRequest：把用户对权限请求的决定回给 CCR
  respondToPermissionRequest(
    requestId: string,
    result: RemotePermissionResponse,
  ): void {
    const pendingRequest = this.pendingPermissionRequests.get(requestId)
    if (!pendingRequest) {
// 没有待确认项时记错误并返回，避免对未知请求乱回
      logError(
        new Error(
          `[RemoteSessionManager] No pending permission request with ID: ${requestId}`,
        ),
      )
      return
    }

    this.pendingPermissionRequests.delete(requestId)
// 回完响应后从待确认表删掉，防止重复响应

    const response: SDKControlResponse = {
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
    }

    logForDebugging(
      `[RemoteSessionManager] Sending permission response: ${result.behavior}`,
    )

    this.websocket?.sendControlResponse(response)
  }

  /**
   * Check if connected to the remote session
   */
// isConnected：当前是否连着远端
  isConnected(): boolean {
    return this.websocket?.isConnected() ?? false
  }

  /**
   * Send an interrupt signal to cancel the current request on the remote session
   */
// cancelSession：发中断信号取消远端正在执行的请求
  cancelSession(): void {
    logForDebugging('[RemoteSessionManager] Sending interrupt signal')
    this.websocket?.sendControlRequest({ subtype: 'interrupt' })
  }

  /**
   * Get the session ID
   */
// getSessionId：暴露会话 ID 给上层
  getSessionId(): string {
    return this.config.sessionId
  }

  /**
   * Disconnect from the remote session
   */
// disconnect：关连接、清引用、清空待确认表
  disconnect(): void {
    logForDebugging('[RemoteSessionManager] Disconnecting')
    this.websocket?.close()
// 断开时把 websocket 引用置空，避免后续误用已关闭的连接
    this.websocket = null
    this.pendingPermissionRequests.clear()
  }

  /**
   * Force reconnect the WebSocket.
   * Useful when the subscription becomes stale after container shutdown.
   */
// reconnect：强制重连 WebSocket，容器重启后订阅失效时用
  reconnect(): void {
    logForDebugging('[RemoteSessionManager] Reconnecting WebSocket')
    this.websocket?.reconnect()
  }
}

/**
 * Create a remote session config from OAuth tokens
 */
// createRemoteSessionConfig：用 OAuth 令牌拼出一份会话配置
export function createRemoteSessionConfig(
  sessionId: string,
  getAccessToken: () => string,
  orgUuid: string,
  hasInitialPrompt = false,
  viewerOnly = false,
// 默认不预设初始提示、非观众模式，调用方可按需覆盖
): RemoteSessionConfig {
  return {
    sessionId,
    getAccessToken,
    orgUuid,
    hasInitialPrompt,
    viewerOnly,
  }
}
// 工厂函数收尾：返回组装好的会话配置
