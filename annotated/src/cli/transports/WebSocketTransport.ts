import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type WsWebSocket from 'ws'
import { logEvent } from '../../services/analytics/index.js'
import { CircularBuffer } from '../../utils/CircularBuffer.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getWebSocketTLSOptions } from '../../utils/mtls.js'
import {
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../utils/proxy.js'
import {
  registerSessionActivityCallback,
  unregisterSessionActivityCallback,
} from '../../utils/sessionActivity.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { Transport } from './Transport.js'

// 保活帧刻意用纯数据帧而不是 ping：很多代理只对 data frame 重置空闲计时器，控制帧不算活动
const KEEP_ALIVE_FRAME = '{"type":"keep_alive"}\n'

// 六个默认值集中在这一段：环形缓冲 1000 条、退避基数 1 秒、退避上限 30 秒、重连总预算 10 分钟、ping 10 秒、保活 5 分钟
const DEFAULT_MAX_BUFFER_SIZE = 1000
const DEFAULT_BASE_RECONNECT_DELAY = 1000
const DEFAULT_MAX_RECONNECT_DELAY = 30000
/** Time budget for reconnection attempts before giving up (10 minutes). */
// 重连总预算十分钟：用完就彻底放弃，把恢复责任交回上层（REPL 桥有自己的一层轮询兜底）
const DEFAULT_RECONNECT_GIVE_UP_MS = 600_000
const DEFAULT_PING_INTERVAL = 10000
const DEFAULT_KEEPALIVE_INTERVAL = 300_000 // 5 minutes

// 休眠检测阈值取最大重连间隔的两倍：连续两次尝试之间隔了 60 秒以上，多半是笔记本合盖睡过一觉
/**
 * Threshold for detecting system sleep/wake. If the gap between consecutive
 * reconnection attempts exceeds this, the machine likely slept. We reset
 * the reconnection budget and retry — the server will reject with permanent
 * close codes (4001/1002) if the session was reaped during sleep.
 */
const SLEEP_DETECTION_THRESHOLD_MS = DEFAULT_MAX_RECONNECT_DELAY * 2 // 60s

// 三个永久关闭码含义明确：协议错误、会话过期、未授权——收到其中任何一个都不该再重试
/**
 * WebSocket close codes that indicate a permanent server-side rejection.
 * The transport transitions to 'closed' immediately without retrying.
 */
const PERMANENT_CLOSE_CODES = new Set([
  1002, // protocol error — server rejected handshake (e.g. session reaped)
  4001, // session expired / not found
  4003, // unauthorized
])

// 两个选项都是给调用方定制的：autoReconnect 让有自己恢复机制的调用方关掉内置重连；isBridge 只让远程控制会话上报遥测
export type WebSocketTransportOptions = {
  /** When false, the transport does not attempt automatic reconnection on
   *  disconnect. Use this when the caller has its own recovery mechanism
   *  (e.g. the REPL bridge poll loop). Defaults to true. */
  autoReconnect?: boolean
  /** Gates the tengu_ws_transport_* telemetry events. Set true at the
   *  REPL-bridge construction site so only Remote Control sessions (the
   *  Cloudflare-idle-timeout population) emit; print-mode workers stay
   *  silent. Defaults to false. */
  isBridge?: boolean
}

// 五态状态机：idle 尚未连过、connected 正常、reconnecting 退避中、closing 主动关闭中、closed 终态
type WebSocketTransportState =
  | 'idle'
  | 'connected'
  | 'reconnecting'
  | 'closing'
  | 'closed'

// 这个结构体让 Bun 原生 WebSocket 与 ws 包共用一套调用：两边都有 close/send，ping 只有二者都实现才标成可选
// Common interface between globalThis.WebSocket and ws.WebSocket
type WebSocketLike = {
  close(): void
  send(data: string): void
  ping?(): void // Bun & ws both support this
}

// 整个类的核心约束写在这一段：所有事件处理器必须是稳定的类属性箭头函数，否则每次重连都会遗留旧的 WS 对象与五个闭包
export class WebSocketTransport implements Transport {
  private ws: WebSocketLike | null = null
  private lastSentId: string | null = null
  protected url: URL
  protected state: WebSocketTransportState = 'idle'
  protected onData?: (data: string) => void
  private onCloseCallback?: (closeCode?: number) => void
  private onConnectCallback?: () => void
  private headers: Record<string, string>
  private sessionId?: string
  private autoReconnect: boolean
  private isBridge: boolean

  // Reconnection state
  private reconnectAttempts = 0
  private reconnectStartTime: number | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private lastReconnectAttemptTime: number | null = null
// 记录最后一次数据帧活动的墙钟时间，专门用于关闭时算空闲时长——排查代理空闲超时断开的关键信号，ping/pong 不计入
  // Wall-clock of last WS data-frame activity (inbound message or outbound
  // ws.send). Used to compute idle time at close — the signal for diagnosing
  // proxy idle-timeout RSTs (e.g. Cloudflare 5-min). Excludes ping/pong
  // control frames (proxies don't count those).
  private lastActivityTime = 0

  // Ping interval for connection health checks
  private pingInterval: NodeJS.Timeout | null = null
  private pongReceived = true

  // Periodic keep_alive data frames to reset proxy idle timers
  private keepAliveInterval: NodeJS.Timeout | null = null

// 环形缓冲是为断线重放准备的：带 uuid 的出站消息按序保留，重连后按服务端确认位点重放
  // Message buffering for replay on reconnection
  private messageBuffer: CircularBuffer<StdoutMessage>
  // Track which runtime's WS we're using so we can detach listeners
  // with the matching API (removeEventListener vs. off).
  private isBunWs = false

// 连接起始时间存成实例字段而非局部变量，为的是让 onOpen 处理器能保持稳定的类属性箭头函数
  // Captured at connect() time for handleOpenEvent timing. Stored as an
  // instance field so the onOpen handler can be a stable class-property
  // arrow function (removable in doDisconnect) instead of a closure over
  // a local variable.
  private connectStartTime = 0

  private refreshHeaders?: () => Record<string, string>

  constructor(
    url: URL,
    headers: Record<string, string> = {},
    sessionId?: string,
    refreshHeaders?: () => Record<string, string>,
    options?: WebSocketTransportOptions,
  ) {
    this.url = url
    this.headers = headers
    this.sessionId = sessionId
    this.refreshHeaders = refreshHeaders
    this.autoReconnect = options?.autoReconnect ?? true
    this.isBridge = options?.isBridge ?? false
    this.messageBuffer = new CircularBuffer(DEFAULT_MAX_BUFFER_SIZE)
  }

  public async connect(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'reconnecting') {
      logForDebugging(
        `WebSocketTransport: Cannot connect, current state is ${this.state}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_connect_failed')
      return
    }
    this.state = 'reconnecting'

    this.connectStartTime = Date.now()
    logForDebugging(`WebSocketTransport: Opening ${this.url.href}`)
    logForDiagnosticsNoPII('info', 'cli_websocket_connect_opening')

    // Start with provided headers and add runtime headers
    const headers = { ...this.headers }
    if (this.lastSentId) {
      headers['X-Last-Request-Id'] = this.lastSentId
      logForDebugging(
        `WebSocketTransport: Adding X-Last-Request-Id header: ${this.lastSentId}`,
      )
    }

// Bun 分支：原生 WebSocket 支持 headers 与 proxy，但 DOM 类型定义里没有这些字段，只能断言成字符串数组绕过类型检查
    if (typeof Bun !== 'undefined') {
      // Bun's WebSocket supports headers/proxy options but the DOM typings don't
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const ws = new globalThis.WebSocket(this.url.href, {
        headers,
        proxy: getWebSocketProxyUrl(this.url.href),
        tls: getWebSocketTLSOptions() || undefined,
      } as unknown as string[])
      this.ws = ws
      this.isBunWs = true

      ws.addEventListener('open', this.onBunOpen)
      ws.addEventListener('message', this.onBunMessage)
      ws.addEventListener('error', this.onBunError)
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      ws.addEventListener('close', this.onBunClose)
      // 'pong' is Bun-specific — not in DOM typings.
      ws.addEventListener('pong', this.onPong)
// Node 分支：动态 import ws 包，走 proxy agent 与 TLS 选项。两条分支的监听 API 完全不同，addEventListener 对 off
    } else {
      const { default: WS } = await import('ws')
      const ws = new WS(this.url.href, {
        headers,
        agent: getWebSocketProxyAgent(this.url.href),
        ...getWebSocketTLSOptions(),
      })
      this.ws = ws
      this.isBunWs = false

      ws.on('open', this.onNodeOpen)
      ws.on('message', this.onNodeMessage)
      ws.on('error', this.onNodeError)
      ws.on('close', this.onNodeClose)
      ws.on('pong', this.onPong)
    }
  }

  // --- Bun (native WebSocket) event handlers ---
  // Stored as class-property arrow functions so they can be removed in
  // doDisconnect(). Without removal, each reconnect orphans the old WS
  // object + its 5 closures until GC, which accumulates under network
  // instability. Mirrors the pattern in src/utils/mcpWebSocketTransport.ts.

// Bun 读不到升级响应头，只能全量重放缓冲，靠服务端按 uuid 去重兜住重复
  private onBunOpen = () => {
    this.handleOpenEvent()
    // Bun's WebSocket doesn't expose upgrade response headers,
    // so replay all buffered messages. The server deduplicates by UUID.
    if (this.lastSentId) {
      this.replayBufferedMessages('')
    }
  }

// 入站消息统一转字符串并立刻刷新活动时间：这个时间戳是后续所有空闲判断的唯一依据
  private onBunMessage = (event: MessageEvent) => {
    const message =
      typeof event.data === 'string' ? event.data : String(event.data)
    this.lastActivityTime = Date.now()
    logForDiagnosticsNoPII('info', 'cli_websocket_message_received', {
      length: message.length,
    })
    if (this.onData) {
      this.onData(message)
    }
  }

  private onBunError = () => {
    logForDebugging('WebSocketTransport: Error', {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_error')
    // close event fires after error — let it call handleConnectionError
  }

  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  private onBunClose = (event: CloseEvent) => {
    const isClean = event.code === 1000 || event.code === 1001
    logForDebugging(
      `WebSocketTransport: Closed: ${event.code}`,
      isClean ? undefined : { level: 'error' },
    )
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_closed')
    this.handleConnectionError(event.code)
  }

  // --- Node (ws package) event handlers ---

// 先把 ws 抓进局部变量再调 handleOpenEvent：onConnect 回调可能同步关闭传输，那样 this.ws 会变 null。旧的内联闭包靠闭包捕获隐式拥有这层安全
  private onNodeOpen = () => {
    // Capture ws before handleOpenEvent() invokes onConnectCallback — if the
    // callback synchronously closes the transport, this.ws becomes null.
    // The old inline-closure code had this safety implicitly via closure capture.
    const ws = this.ws
    this.handleOpenEvent()
    if (!ws) return
    // Check for last-id in upgrade response headers (ws package only)
    const nws = ws as unknown as WsWebSocket & {
      upgradeReq?: { headers?: Record<string, string> }
    }
    const upgradeResponse = nws.upgradeReq
// 只有 ws 包能读到升级响应头里的 x-last-request-id，据此精确知道服务端收到了哪一条，避免重复重放
    if (upgradeResponse?.headers?.['x-last-request-id']) {
      const serverLastId = upgradeResponse.headers['x-last-request-id']
      this.replayBufferedMessages(serverLastId)
    }
  }

// Node 侧入站是 Buffer，转成字符串后与 Bun 分支走完全相同的处理路径
  private onNodeMessage = (data: Buffer) => {
    const message = data.toString()
    this.lastActivityTime = Date.now()
    logForDiagnosticsNoPII('info', 'cli_websocket_message_received', {
      length: message.length,
    })
    if (this.onData) {
      this.onData(message)
    }
  }

  private onNodeError = (err: Error) => {
    logForDebugging(`WebSocketTransport: Error: ${err.message}`, {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_error')
    // close event fires after error — let it call handleConnectionError
  }

// 关闭码 1000 与 1001 视为正常，日志级别才降级；其余一律按错误记，方便线上筛
  private onNodeClose = (code: number, _reason: Buffer) => {
    const isClean = code === 1000 || code === 1001
    logForDebugging(
      `WebSocketTransport: Closed: ${code}`,
      isClean ? undefined : { level: 'error' },
    )
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_closed')
    this.handleConnectionError(code)
  }

  // --- Shared handlers ---

  private onPong = () => {
    this.pongReceived = true
  }

// 连接成功后的统一入口：记连接耗时、发重连成功遥测、重置退避计数、启 ping 与保活、注册会话活动回调
  private handleOpenEvent(): void {
    const connectDuration = Date.now() - this.connectStartTime
    logForDebugging('WebSocketTransport: Connected')
    logForDiagnosticsNoPII('info', 'cli_websocket_connect_connected', {
      duration_ms: connectDuration,
    })

    // Reconnect success — capture attempt count + downtime before resetting.
    // reconnectStartTime is null on first connect, non-null on reopen.
// 重连成功遥测必须在重置计数之前取：一旦重置，尝试次数与停机时长这两个最有诊断价值的字段就永久丢了
    if (this.isBridge && this.reconnectStartTime !== null) {
      logEvent('tengu_ws_transport_reconnected', {
        attempts: this.reconnectAttempts,
        downtimeMs: Date.now() - this.reconnectStartTime,
      })
    }

    this.reconnectAttempts = 0
    this.reconnectStartTime = null
    this.lastReconnectAttemptTime = null
    this.lastActivityTime = Date.now()
    this.state = 'connected'
    this.onConnectCallback?.()

    // Start periodic pings to detect dead connections
    this.startPingInterval()

    // Start periodic keep_alive data frames to reset proxy idle timers
    this.startKeepaliveInterval()

    // Register callback for session activity signals
// 会话活动信号也顺手写一次保活：本地有活动说明用户还在，顺便把代理那边的空闲计时器一起重置
    registerSessionActivityCallback(() => {
      void this.write({ type: 'keep_alive' })
    })
  }

// 发送前的双重检查：既要有 ws 对象也要处于 connected 状态，否则只记日志不抛错
  protected sendLine(line: string): boolean {
    if (!this.ws || this.state !== 'connected') {
      logForDebugging('WebSocketTransport: Not connected')
      logForDiagnosticsNoPII('info', 'cli_websocket_send_not_connected')
      return false
    }

    try {
      this.ws.send(line)
      this.lastActivityTime = Date.now()
      return true
    } catch (error) {
      logForDebugging(`WebSocketTransport: Failed to send: ${error}`, {
        level: 'error',
      })
      logForDiagnosticsNoPII('error', 'cli_websocket_send_error')
// 发送失败时刻意不在这里把 ws 置空：交给 doDisconnect 统一清理，才能保证先摘监听再释放对象
      // Don't null this.ws here — let doDisconnect() (via handleConnectionError)
      // handle cleanup so listeners are removed before the WS is released.
      this.handleConnectionError()
      return false
    }
  }

  /**
   * Remove all listeners attached in connect() for the given WebSocket.
   * Without this, each reconnect orphans the old WS object + its closures
   * until GC — these accumulate under network instability. Mirrors the
   * pattern in src/utils/mcpWebSocketTransport.ts.
   */
// 摘监听必须与连接时用的 API 配对：Bun 走 removeEventListener，ws 包走 off，混用会静默失效
  private removeWsListeners(ws: WebSocketLike): void {
    if (this.isBunWs) {
      const nws = ws as unknown as globalThis.WebSocket
      nws.removeEventListener('open', this.onBunOpen)
      nws.removeEventListener('message', this.onBunMessage)
      nws.removeEventListener('error', this.onBunError)
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      nws.removeEventListener('close', this.onBunClose)
      // 'pong' is Bun-specific — not in DOM typings
      nws.removeEventListener('pong' as 'message', this.onPong)
    } else {
      const nws = ws as unknown as WsWebSocket
      nws.off('open', this.onNodeOpen)
      nws.off('message', this.onNodeMessage)
      nws.off('error', this.onNodeError)
      nws.off('close', this.onNodeClose)
      nws.off('pong', this.onPong)
    }
  }

// 断开时按固定顺序收尾：先停定时器、再注销会话回调、最后摘监听并关闭——顺序颠倒会留下悬空回调
  protected doDisconnect(): void {
    // Stop pinging and keepalive when disconnecting
    this.stopPingInterval()
    this.stopKeepaliveInterval()

    // Unregister session activity callback
    unregisterSessionActivityCallback()

    if (this.ws) {
      // Remove listeners BEFORE close() so the old WS + closures can be
      // GC'd promptly instead of lingering until the next mark-and-sweep.
      this.removeWsListeners(this.ws)
      this.ws.close()
      this.ws = null
    }
  }

// 所有断开路径的唯一汇合点：错误、关闭事件、流结束都走这里，保证状态机只有一处迁移
  private handleConnectionError(closeCode?: number): void {
    logForDebugging(
      `WebSocketTransport: Disconnected from ${this.url.href}` +
        (closeCode != null ? ` (code ${closeCode})` : ''),
    )
    logForDiagnosticsNoPII('info', 'cli_websocket_disconnected')
// 遥测要在 doDisconnect 之前发：wasConnected 读的是关闭前的状态，晚一步就被改掉了
    if (this.isBridge) {
      // Fire on every close — including intermediate ones during a reconnect
      // storm (those never surface to the onCloseCallback consumer). For the
      // Cloudflare-5min-idle hypothesis: cluster msSinceLastActivity; if the
      // peak sits at ~300s with closeCode 1006, that's the proxy RST.
      logEvent('tengu_ws_transport_closed', {
        closeCode,
        msSinceLastActivity:
          this.lastActivityTime > 0 ? Date.now() - this.lastActivityTime : -1,
        // 'connected' = healthy drop (the Cloudflare case); 'reconnecting' =
        // connect-rejection mid-storm. State isn't mutated until the branches
        // below, so this reads the pre-close value.
        wasConnected: this.state === 'connected',
        reconnectAttempts: this.reconnectAttempts,
      })
    }
    this.doDisconnect()

// 已在关闭或已关闭就直接返回：防止 close 引发的关闭事件又折回重连分支
    if (this.state === 'closing' || this.state === 'closed') return

// 永久码不重试，但 4003 留了例外：父进程可能刚签发新令牌，刷头后值得再试一次
    // Permanent codes: don't retry — server has definitively ended the session.
    // Exception: 4003 (unauthorized) can be retried when refreshHeaders is
    // available and returns a new token (e.g. after the parent process mints
    // a fresh session ingress token during reconnection).
    let headersRefreshed = false
// 刷新头只在令牌真的变了时才认账：没变说明刷新也救不回来，照旧走永久关闭
    if (closeCode === 4003 && this.refreshHeaders) {
      const freshHeaders = this.refreshHeaders()
      if (freshHeaders.Authorization !== this.headers.Authorization) {
        Object.assign(this.headers, freshHeaders)
        headersRefreshed = true
        logForDebugging(
          'WebSocketTransport: 4003 received but headers refreshed, scheduling reconnect',
        )
        logForDiagnosticsNoPII('info', 'cli_websocket_4003_token_refreshed')
      }
    }

    if (
      closeCode != null &&
      PERMANENT_CLOSE_CODES.has(closeCode) &&
      !headersRefreshed
    ) {
      logForDebugging(
        `WebSocketTransport: Permanent close code ${closeCode}, not reconnecting`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_permanent_close', {
        closeCode,
      })
      this.state = 'closed'
      this.onCloseCallback?.(closeCode)
      return
    }

    // When autoReconnect is disabled, go straight to closed state.
    // The caller (e.g. REPL bridge poll loop) handles recovery.
// 调用方自己有恢复机制时直接进终态并回调，把重连责任明确交出去
    if (!this.autoReconnect) {
      this.state = 'closed'
      this.onCloseCallback?.(closeCode)
      return
    }

    // Schedule reconnection with exponential backoff and time budget
    const now = Date.now()
    if (!this.reconnectStartTime) {
      this.reconnectStartTime = now
    }

// 休眠检测：与上次尝试的时间间隔远超上限就认为机器睡过，预算与计数全部归零重来
    // Detect system sleep/wake: if the gap since our last reconnection
    // attempt greatly exceeds the max delay, the machine likely slept
    // (e.g. laptop lid closed). Reset the budget and retry from scratch —
    // the server will reject with permanent close codes (4001/1002) if
    // the session was reaped while we were asleep.
    if (
      this.lastReconnectAttemptTime !== null &&
      now - this.lastReconnectAttemptTime > SLEEP_DETECTION_THRESHOLD_MS
    ) {
      logForDebugging(
        `WebSocketTransport: Detected system sleep (${Math.round((now - this.lastReconnectAttemptTime) / 1000)}s gap), resetting reconnection budget`,
      )
      logForDiagnosticsNoPII('info', 'cli_websocket_sleep_detected', {
        gapMs: now - this.lastReconnectAttemptTime,
      })
      this.reconnectStartTime = now
      this.reconnectAttempts = 0
    }
    this.lastReconnectAttemptTime = now

// 预算内才排重连：先清旧定时器防重复，再刷头拿新令牌，然后指数退避加正负 25% 抖动防惊群
    const elapsed = now - this.reconnectStartTime
    if (elapsed < DEFAULT_RECONNECT_GIVE_UP_MS) {
      // Clear any existing reconnection timer to avoid duplicates
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }

// 重连前刷新头是为了拿到父进程可能新签发的令牌；4003 分支已经刷过就跳过，避免白跑两次
      // Refresh headers before reconnecting (e.g. to pick up a new session token).
      // Skip if already refreshed by the 4003 path above.
      if (!headersRefreshed && this.refreshHeaders) {
        const freshHeaders = this.refreshHeaders()
        Object.assign(this.headers, freshHeaders)
        logForDebugging('WebSocketTransport: Refreshed headers for reconnect')
      }

      this.state = 'reconnecting'
      this.reconnectAttempts++

// 指数退避取 2 的幂并封顶 30 秒，抖动让同时掉线的一批客户端不会在同一毫秒一起回来
      const baseDelay = Math.min(
        DEFAULT_BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
        DEFAULT_MAX_RECONNECT_DELAY,
      )
      // Add ±25% jitter to avoid thundering herd
      const delay = Math.max(
        0,
        baseDelay + baseDelay * 0.25 * (2 * Math.random() - 1),
      )

      logForDebugging(
        `WebSocketTransport: Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}, ${Math.round(elapsed / 1000)}s elapsed)`,
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_reconnect_attempt', {
        reconnectAttempts: this.reconnectAttempts,
      })
      if (this.isBridge) {
        logEvent('tengu_ws_transport_reconnecting', {
          attempt: this.reconnectAttempts,
          elapsedMs: elapsed,
          delayMs: Math.round(delay),
        })
      }

// 定时器回调里先把字段清空再连：这样 connect 内部判断状态时看不到过期的定时器句柄
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        void this.connect()
      }, delay)
    } else {
      logForDebugging(
        `WebSocketTransport: Reconnection time budget exhausted after ${Math.round(elapsed / 1000)}s for ${this.url.href}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_reconnect_exhausted', {
        reconnectAttempts: this.reconnectAttempts,
        elapsedMs: elapsed,
      })
      this.state = 'closed'

      // Notify close callback
      if (this.onCloseCallback) {
        this.onCloseCallback(closeCode)
      }
    }
  }

// 主动关闭要清干净三样东西：重连定时器、ping 与保活两个 interval、会话活动回调
  close(): void {
    // Clear any pending reconnection timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Clear ping and keepalive intervals
    this.stopPingInterval()
    this.stopKeepaliveInterval()

    // Unregister session activity callback
    unregisterSessionActivityCallback()

    this.state = 'closing'
    this.doDisconnect()
  }

// 重放依据是服务端确认位点：先按 lastId 找到已确认的最后一条，把更早的全部驱逐
  private replayBufferedMessages(lastId: string): void {
    const messages = this.messageBuffer.toArray()
    if (messages.length === 0) return

    // Find where to start replay based on server's last received message
    let startIndex = 0
// 服务端确认过就重建缓冲，只留未确认的尾部；全确认完连 lastSentId 一起清掉
    if (lastId) {
      const lastConfirmedIndex = messages.findIndex(
        message => 'uuid' in message && message.uuid === lastId,
      )
      if (lastConfirmedIndex >= 0) {
        // Server confirmed messages up to lastConfirmedIndex — evict them
        startIndex = lastConfirmedIndex + 1
        // Rebuild the buffer with only unconfirmed messages
        const remaining = messages.slice(startIndex)
        this.messageBuffer.clear()
        this.messageBuffer.addAll(remaining)
        if (remaining.length === 0) {
          this.lastSentId = null
        }
        logForDebugging(
          `WebSocketTransport: Evicted ${startIndex} confirmed messages, ${remaining.length} remaining`,
        )
        logForDiagnosticsNoPII(
          'info',
          'cli_websocket_evicted_confirmed_messages',
          {
            evicted: startIndex,
            remaining: remaining.length,
          },
        )
      }
    }

// 真正重放前再判一次空：驱逐完可能一条不剩，那就只空转一次日志
    const messagesToReplay = messages.slice(startIndex)
    if (messagesToReplay.length === 0) {
      logForDebugging('WebSocketTransport: No new messages to replay')
      logForDiagnosticsNoPII('info', 'cli_websocket_no_messages_to_replay')
      return
    }

    logForDebugging(
      `WebSocketTransport: Replaying ${messagesToReplay.length} buffered messages`,
    )
    logForDiagnosticsNoPII('info', 'cli_websocket_messages_to_replay', {
      count: messagesToReplay.length,
    })

    for (const message of messagesToReplay) {
      const line = jsonStringify(message) + '\n'
      const success = this.sendLine(line)
      if (!success) {
        this.handleConnectionError()
        break
      }
    }
// 重放后坚决不清缓冲：连接可能在重放后、服务端处理前再断，留着才能保证不丢消息
    // Do NOT clear the buffer after replay — messages remain buffered until
    // the server confirms receipt on the next reconnection. This prevents
    // message loss if the connection drops after replay but before the server
    // processes the messages.
  }

  isConnectedStatus(): boolean {
    return this.state === 'connected'
  }

  isClosedStatus(): boolean {
    return this.state === 'closed'
  }

  setOnData(callback: (data: string) => void): void {
    this.onData = callback
  }

  setOnConnect(callback: () => void): void {
    this.onConnectCallback = callback
  }

  setOnClose(callback: (closeCode?: number) => void): void {
    this.onCloseCallback = callback
  }

  getStateLabel(): string {
    return this.state
  }

// 写入先落缓冲再判断连接：带 uuid 的消息无论发没发出去都必须留在缓冲里，这是重放的唯一依据
  async write(message: StdoutMessage): Promise<void> {
    if ('uuid' in message && typeof message.uuid === 'string') {
      this.messageBuffer.add(message)
      this.lastSentId = message.uuid
    }

    const line = jsonStringify(message) + '\n'

// 未连接时直接返回而不是报错：调用方按「已写入」理解即可，连接恢复后会自动重放
    if (this.state !== 'connected') {
      // Message buffered for replay when connected (if it has a UUID)
      return
    }

    const sessionLabel = this.sessionId ? ` session=${this.sessionId}` : ''
    const detailLabel = this.getControlMessageDetailLabel(message)

    logForDebugging(
      `WebSocketTransport: Sending message type=${message.type}${sessionLabel}${detailLabel}`,
    )

    this.sendLine(line)
  }

// 只有控制消息需要细节标签：权限请求带工具名与 request_id，响应带 subtype，其余类型返回空串
  private getControlMessageDetailLabel(message: StdoutMessage): string {
    if (message.type === 'control_request') {
      const { request_id, request } = message
      const toolName =
        request.subtype === 'can_use_tool' ? request.tool_name : ''
      return ` subtype=${request.subtype} request_id=${request_id}${toolName ? ` tool=${toolName}` : ''}`
    }
    if (message.type === 'control_response') {
      const { subtype, request_id } = message.response
      return ` subtype=${subtype} request_id=${request_id}`
    }
    return ''
  }

// ping 间隔兼任两个职责：正常心跳探活，以及用 tick 间隔突变检测进程被挂起
  private startPingInterval(): void {
    // Clear any existing interval
    this.stopPingInterval()

    this.pongReceived = true
    let lastTickTime = Date.now()

    // Send ping periodically to detect dead connections.
    // If the previous ping got no pong, treat the connection as dead.
    this.pingInterval = setInterval(() => {
      if (this.state === 'connected' && this.ws) {
        const now = Date.now()
        const gap = now - lastTickTime
        lastTickTime = now

// 进程挂起检测：setInterval 不排队补发，唤醒后只触发一次且间隔巨大。此时 socket 几乎必死，直接重连比等 ping/pong 往返更快
        // Process-suspension detector. If the wall-clock gap between ticks
        // greatly exceeds the 10s interval, the process was suspended
        // (laptop lid, SIGSTOP, VM pause). setInterval does not queue
        // missed ticks — it coalesces — so on wake this callback fires
        // once with a huge gap. The socket is almost certainly dead:
        // NAT mappings drop in 30s–5min, and the server has been
        // retransmitting into the void. Don't wait for a ping/pong
        // round-trip to confirm (ws.ping() on a dead socket returns
        // immediately with no error — bytes go into the kernel send
        // buffer). Assume dead and reconnect now. A spurious reconnect
        // after a short sleep is cheap — replayBufferedMessages() handles
        // it and the server dedups by UUID.
        if (gap > SLEEP_DETECTION_THRESHOLD_MS) {
          logForDebugging(
            `WebSocketTransport: ${Math.round(gap / 1000)}s tick gap detected — process was suspended, forcing reconnect`,
          )
          logForDiagnosticsNoPII(
            'info',
            'cli_websocket_sleep_detected_on_ping',
            { gapMs: gap },
          )
          this.handleConnectionError()
          return
        }

// 上一轮 ping 没回 pong 就判死：ws 的 ping 在死 socket 上会立刻返回且不报错，只能靠 pong 缺失判断
        if (!this.pongReceived) {
          logForDebugging(
            'WebSocketTransport: No pong received, connection appears dead',
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_websocket_pong_timeout')
          this.handleConnectionError()
          return
        }

// 发 ping 前先把 pongReceived 置 false，下一轮才有判断依据
        this.pongReceived = false
        try {
          this.ws.ping?.()
        } catch (error) {
          logForDebugging(`WebSocketTransport: Ping failed: ${error}`, {
            level: 'error',
          })
          logForDiagnosticsNoPII('error', 'cli_websocket_ping_failed')
        }
      }
    }, DEFAULT_PING_INTERVAL)
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

// 保活定时器专门对付代理空闲超时：每五分钟发一个数据帧，把五分钟粒度的代理计时器重置掉
  private startKeepaliveInterval(): void {
    this.stopKeepaliveInterval()

// 远程会话有自己的活动心跳，这条保活就成了重复劳动，直接跳过
    // In CCR sessions, session activity heartbeats handle keep-alives
    if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
      return
    }

// 保活发送也要刷活动时间：这一帧本身就是最后一次活动，诊断时不能算成空闲
    this.keepAliveInterval = setInterval(() => {
      if (this.state === 'connected' && this.ws) {
        try {
          this.ws.send(KEEP_ALIVE_FRAME)
          this.lastActivityTime = Date.now()
          logForDebugging(
            'WebSocketTransport: Sent periodic keep_alive data frame',
          )
        } catch (error) {
          logForDebugging(
            `WebSocketTransport: Periodic keep_alive failed: ${error}`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_websocket_keepalive_failed')
        }
      }
    }, DEFAULT_KEEPALIVE_INTERVAL)
  }

  private stopKeepaliveInterval(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
    }
  }
}
