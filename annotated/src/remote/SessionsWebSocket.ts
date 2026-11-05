// 连接 CCR 会话的 WebSocket 客户端：读消息流、按 4001 等关闭码决定重连还是放弃，并把控制请求 / 响应发回去
import { randomUUID } from 'crypto'
import { getOauthConfig } from '../constants/oauth.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlRequest,
  SDKControlRequestInner,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { getWebSocketTLSOptions } from '../utils/mtls.js'
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from '../utils/proxy.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

// 三个重连与心跳常量：基础重连延迟、最大尝试次数、ping 间隔
const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5
const PING_INTERVAL_MS = 30000

/**
 * Maximum retries for 4001 (session not found). During compaction the
 * server may briefly consider the session stale; a short retry window
 * lets the client recover without giving up permanently.
 */
const MAX_SESSION_NOT_FOUND_RETRIES = 3

/**
 * WebSocket close codes that indicate a permanent server-side rejection.
 * The client stops reconnecting immediately.
 * Note: 4001 (session not found) is handled separately with limited
 * retries since it can be transient during compaction.
 */
// 永久拒绝的关闭码集合：目前只有 4003（未授权），命中即停止重连，由调用方处理永久关闭
const PERMANENT_CLOSE_CODES = new Set([
  4003, // unauthorized
])

type WebSocketState = 'connecting' | 'connected' | 'closed'

type SessionsMessage =
  | SDKMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKControlCancelRequest

// 消息类型守卫：只要带字符串 type 字段就收下，下游再决定怎么处理——用开放式判断而非白名单，避免后端新增类型时客户端直接丢消息
function isSessionsMessage(value: unknown): value is SessionsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }
  // Accept any message with a string `type` field. Downstream handlers
  // (sdkMessageAdapter, RemoteSessionManager) decide what to do with
  // unknown types. A hardcoded allowlist here would silently drop new
  // message types the backend starts sending before the client is updated.
  return typeof value.type === 'string'
}

// 回调集合：消息、关闭、错误、连接成功，以及「检测到瞬时断开并安排了重连」这一额外回调
export type SessionsWebSocketCallbacks = {
  onMessage: (message: SessionsMessage) => void
  onClose?: () => void
  onError?: (error: Error) => void
  onConnected?: () => void
  /** Fired when a transient close is detected and a reconnect is scheduled.
   *  onClose fires only for permanent close (server ended / attempts exhausted). */
  onReconnecting?: () => void
}

// Common interface between globalThis.WebSocket and ws.WebSocket
// 为同时兼容浏览器原生 WebSocket 与 Node 的 ws 库，抽象出只够用的方法集合
type WebSocketLike = {
  close(): void
  send(data: string): void
  ping?(): void // Bun & ws both support this
}

/**
 * WebSocket client for connecting to CCR sessions via /v1/sessions/ws/{id}/subscribe
 *
 * Protocol:
 * 1. Connect to wss://api.anthropic.com/v1/sessions/ws/{sessionId}/subscribe?organization_uuid=...
 * 2. Send auth message: { type: 'auth', credential: { type: 'oauth', token: '...' } }
 * 3. Receive SDKMessage stream from the session
 */
// SessionsWebSocket 类：持有连接状态、重连计数、ping 定时器
export class SessionsWebSocket {
  private ws: WebSocketLike | null = null
  private state: WebSocketState = 'closed'
  private reconnectAttempts = 0
  private sessionNotFoundRetries = 0
  private pingInterval: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly sessionId: string,
    private readonly orgUuid: string,
    private readonly getAccessToken: () => string,
    private readonly callbacks: SessionsWebSocketCallbacks,
  ) {}

  /**
   * Connect to the sessions WebSocket endpoint
   */
// connect：按运行环境分两条路建连——Bun 用原生 WebSocket，Node 用 ws 库，两者事件名不同但要做同样的事
  async connect(): Promise<void> {
    if (this.state === 'connecting') {
      logForDebugging('[SessionsWebSocket] Already connecting')
      return
    }

    this.state = 'connecting'

    const baseUrl = getOauthConfig().BASE_API_URL.replace('https://', 'wss://')
    const url = `${baseUrl}/v1/sessions/ws/${this.sessionId}/subscribe?organization_uuid=${this.orgUuid}`

    logForDebugging(`[SessionsWebSocket] Connecting to ${url}`)

    // Get fresh token for each connection attempt
    const accessToken = this.getAccessToken()
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
    }

// Bun 分支：原生 WebSocket 支持代理与 TLS 选项，事件用 addEventListener 绑定
    if (typeof Bun !== 'undefined') {
      // Bun's WebSocket supports headers/proxy options but the DOM typings don't
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const ws = new globalThis.WebSocket(url, {
        headers,
        proxy: getWebSocketProxyUrl(url),
        tls: getWebSocketTLSOptions() || undefined,
      } as unknown as string[])
      this.ws = ws

      ws.addEventListener('open', () => {
        logForDebugging(
          '[SessionsWebSocket] Connection opened, authenticated via headers',
        )
        this.state = 'connected'
        this.reconnectAttempts = 0
        this.sessionNotFoundRetries = 0
        this.startPingInterval()
        this.callbacks.onConnected?.()
      })

      ws.addEventListener('message', (event: MessageEvent) => {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data)
        this.handleMessage(data)
      })

      ws.addEventListener('error', () => {
        const err = new Error('[SessionsWebSocket] WebSocket error')
        logError(err)
        this.callbacks.onError?.(err)
      })

      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      ws.addEventListener('close', (event: CloseEvent) => {
        logForDebugging(
          `[SessionsWebSocket] Closed: code=${event.code} reason=${event.reason}`,
        )
        this.handleClose(event.code)
      })

      ws.addEventListener('pong', () => {
        logForDebugging('[SessionsWebSocket] Pong received')
      })
// Node 分支：用 ws 库，事件用 on 绑定；这里不用 addEventListener 写法
    } else {
      const { default: WS } = await import('ws')
      const ws = new WS(url, {
        headers,
        agent: getWebSocketProxyAgent(url),
        ...getWebSocketTLSOptions(),
      })
      this.ws = ws

      ws.on('open', () => {
        logForDebugging(
          '[SessionsWebSocket] Connection opened, authenticated via headers',
        )
        // Auth is handled via headers, so we're immediately connected
        this.state = 'connected'
        this.reconnectAttempts = 0
        this.sessionNotFoundRetries = 0
        this.startPingInterval()
        this.callbacks.onConnected?.()
      })

      ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString())
      })

      ws.on('error', (err: Error) => {
        logError(new Error(`[SessionsWebSocket] Error: ${err.message}`))
        this.callbacks.onError?.(err)
      })

      ws.on('close', (code: number, reason: Buffer) => {
        logForDebugging(
          `[SessionsWebSocket] Closed: code=${code} reason=${reason.toString()}`,
        )
        this.handleClose(code)
      })

      ws.on('pong', () => {
        logForDebugging('[SessionsWebSocket] Pong received')
      })
    }
  }

  /**
   * Handle incoming WebSocket message
   */
// handleMessage：解析后若类型守卫通过就转给回调，否则只记日志忽略，不抛错
  private handleMessage(data: string): void {
    try {
      const message: unknown = jsonParse(data)

      // Forward SDK messages to callback
      if (isSessionsMessage(message)) {
        this.callbacks.onMessage(message)
      } else {
        logForDebugging(
          `[SessionsWebSocket] Ignoring message type: ${typeof message === 'object' && message !== null && 'type' in message ? String(message.type) : 'unknown'}`,
        )
      }
    } catch (error) {
      logError(
        new Error(
          `[SessionsWebSocket] Failed to parse message: ${errorMessage(error)}`,
        ),
      )
    }
  }

  /**
   * Handle WebSocket close
   */
// handleClose：先停 ping，再根据关闭码决定——永久码直接关、4001 有限重试、曾连接才重连，否则放弃
  private handleClose(closeCode: number): void {
    this.stopPingInterval()

    if (this.state === 'closed') {
      return
    }

    this.ws = null

    const previousState = this.state
    this.state = 'closed'

    // Permanent codes: stop reconnecting — server has definitively ended the session
    if (PERMANENT_CLOSE_CODES.has(closeCode)) {
      logForDebugging(
        `[SessionsWebSocket] Permanent close code ${closeCode}, not reconnecting`,
      )
      this.callbacks.onClose?.()
      return
    }

    // 4001 (session not found) can be transient during compaction: the
    // server may briefly consider the session stale while the CLI worker
    // is busy with the compaction API call and not emitting events.
// 4001（会话找不到）在压缩期间可能是瞬时的：给一个小重试预算，耗尽才放弃重连
    if (closeCode === 4001) {
      this.sessionNotFoundRetries++
      if (this.sessionNotFoundRetries > MAX_SESSION_NOT_FOUND_RETRIES) {
        logForDebugging(
          `[SessionsWebSocket] 4001 retry budget exhausted (${MAX_SESSION_NOT_FOUND_RETRIES}), not reconnecting`,
        )
        this.callbacks.onClose?.()
        return
      }
      this.scheduleReconnect(
        RECONNECT_DELAY_MS * this.sessionNotFoundRetries,
        `4001 attempt ${this.sessionNotFoundRetries}/${MAX_SESSION_NOT_FOUND_RETRIES}`,
      )
      return
    }

    // Attempt reconnection if we were connected
    if (
      previousState === 'connected' &&
      this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    ) {
      this.reconnectAttempts++
      this.scheduleReconnect(
        RECONNECT_DELAY_MS,
        `attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`,
      )
    } else {
      logForDebugging('[SessionsWebSocket] Not reconnecting')
      this.callbacks.onClose?.()
    }
  }

// scheduleReconnect：通知调用方即将重连，并延时后重新 connect
  private scheduleReconnect(delay: number, label: string): void {
    this.callbacks.onReconnecting?.()
    logForDebugging(
      `[SessionsWebSocket] Scheduling reconnect (${label}) in ${delay}ms`,
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

// startPingInterval：定时 ping 保活，写失败就忽略，交给关闭处理去兜底
  private startPingInterval(): void {
    this.stopPingInterval()

    this.pingInterval = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        try {
          this.ws.ping?.()
        } catch {
          // Ignore ping errors, close handler will deal with connection issues
        }
      }
    }, PING_INTERVAL_MS)
  }

  /**
   * Stop ping interval
   */
// stopPingInterval：清空并置空 ping 定时器
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  /**
   * Send a control response back to the session
   */
// sendControlResponse：仅已连接时才能发，把控制响应序列化后送出
  sendControlResponse(response: SDKControlResponse): void {
    if (!this.ws || this.state !== 'connected') {
      logError(new Error('[SessionsWebSocket] Cannot send: not connected'))
      return
    }

    logForDebugging('[SessionsWebSocket] Sending control response')
    this.ws.send(jsonStringify(response))
  }

  /**
   * Send a control request to the session (e.g., interrupt)
   */
// sendControlRequest：发出控制请求（如中断），自动补上 request_id
  sendControlRequest(request: SDKControlRequestInner): void {
    if (!this.ws || this.state !== 'connected') {
      logError(new Error('[SessionsWebSocket] Cannot send: not connected'))
      return
    }

    const controlRequest: SDKControlRequest = {
      type: 'control_request',
      request_id: randomUUID(),
      request,
    }

    logForDebugging(
      `[SessionsWebSocket] Sending control request: ${request.subtype}`,
    )
    this.ws.send(jsonStringify(controlRequest))
  }

  /**
   * Check if connected
   */
// isConnected：只看状态是否为 connected
  isConnected(): boolean {
    return this.state === 'connected'
  }

  /**
   * Close the WebSocket connection
   */
// close：停 ping、清重连定时器、关底层连接并置空，断开时要先摘事件处理器避免竞态
  close(): void {
    logForDebugging('[SessionsWebSocket] Closing connection')
    this.state = 'closed'
    this.stopPingInterval()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      // Null out event handlers to prevent race conditions during reconnect.
      // Under Bun (native WebSocket), onX handlers are the clean way to detach.
      // Under Node (ws package), the listeners were attached with .on() in connect(),
      // but since we're about to close and null out this.ws, no cleanup is needed.
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Force reconnect - closes existing connection and establishes a new one.
   * Useful when the subscription becomes stale (e.g., after container shutdown).
   */
// reconnect：强制重连——重置计数、关旧连接、延时后重连，常用于订阅失效后的自救
  reconnect(): void {
    logForDebugging('[SessionsWebSocket] Force reconnecting')
    this.reconnectAttempts = 0
    this.sessionNotFoundRetries = 0
    this.close()
    // Small delay before reconnecting (stored in reconnectTimer so it can be cancelled)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, 500)
  }
}
