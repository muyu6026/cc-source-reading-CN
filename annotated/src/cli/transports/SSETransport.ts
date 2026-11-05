import axios, { type AxiosError } from 'axios'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { errorMessage } from '../../utils/errors.js'
import { getSessionIngressAuthHeaders } from '../../utils/sessionIngressAuth.js'
import { sleep } from '../../utils/sleep.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import type { Transport } from './Transport.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// 四个时间常量构成读侧的重连策略：退避基数 1 秒、上限 30 秒、总预算 10 分钟、静默 45 秒判死
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000
// 服务端每 15 秒发一次 keepalive，所以 45 秒静默意味着漏了三次，足以判定连接已死
/** Time budget for reconnection attempts before giving up (10 minutes). */
const RECONNECT_GIVE_UP_MS = 600_000
/** Server sends keepalives every 15s; treat connection as dead after 45s of silence. */
const LIVENESS_TIMEOUT_MS = 45_000

// 三个永久 HTTP 码：未授权、禁止、不存在——都不是重试能解决的问题
/**
 * HTTP status codes that indicate a permanent server-side rejection.
 * The transport transitions to 'closed' immediately without retrying.
 */
const PERMANENT_HTTP_CODES = new Set([401, 403, 404])

// POST 侧的重试参数与 HybridTransport 对齐：10 次、500 毫秒起、封顶 8 秒
// POST retry configuration (matches HybridTransport)
const POST_MAX_RETRIES = 10
const POST_BASE_DELAY_MS = 500
const POST_MAX_DELAY_MS = 8000

// 两处提升到模块级是为了避免热路径上反复新建对象：解码选项与 validateStatus 回调每次请求都会用到
/** Hoisted TextDecoder options to avoid per-chunk allocation in readStream. */
const STREAM_DECODE_OPTS: TextDecodeOptions = { stream: true }

/** Hoisted axios validateStatus callback to avoid per-request closure allocation. */
function alwaysValidStatus(): boolean {
  return true
}

// ---------------------------------------------------------------------------
// SSE Frame Parser
// ---------------------------------------------------------------------------

type SSEFrame = {
  event?: string
  id?: string
  data?: string
}

// 解析器是纯函数并单独导出，注释里写明是给测试用的，于是可以脱离网络单测分帧逻辑
/**
 * Incrementally parse SSE frames from a text buffer.
 * Returns parsed frames and the remaining (incomplete) buffer.
 *
 * @internal exported for testing
 */
export function parseSSEFrames(buffer: string): {
  frames: SSEFrame[]
  remaining: string
} {
  const frames: SSEFrame[] = []
  let pos = 0

  // SSE frames are delimited by double newlines
  let idx: number
// SSE 的帧边界就是两个连续换行，剩下的不完整尾巴留在 buffer 里等下一块数据
  while ((idx = buffer.indexOf('\n\n', pos)) !== -1) {
    const rawFrame = buffer.slice(pos, idx)
    pos = idx + 2

    // Skip empty frames
    if (!rawFrame.trim()) continue

    const frame: SSEFrame = {}
    let isComment = false

    for (const line of rawFrame.split('\n')) {
// 以冒号开头的行是注释帧：服务端的 keepalive 就是这种，不带数据但能证明连接还活着
      if (line.startsWith(':')) {
        // SSE comment (e.g., `:keepalive`)
        isComment = true
        continue
      }

// 字段解析按规范只剥一个前导空格，多余的空白属于值本身
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue

      const field = line.slice(0, colonIdx)
      // Per SSE spec, strip one leading space after colon if present
      const value =
        line[colonIdx + 1] === ' '
          ? line.slice(colonIdx + 2)
          : line.slice(colonIdx + 1)

// 三种字段里只有 data 会累加：同一帧多个 data 行按规范用换行拼接，其余字段后值覆盖前值
      switch (field) {
        case 'event':
          frame.event = value
          break
        case 'id':
          frame.id = value
          break
        case 'data':
          // Per SSE spec, multiple data: lines are concatenated with \n
          frame.data = frame.data ? frame.data + '\n' + value : value
          break
        // Ignore other fields (retry:, etc.)
      }
    }

// 只有带 data 或纯注释的帧才向上抛：纯注释帧的用途是重置存活计时器，空帧直接丢弃
    // Only emit frames that have data (or are pure comments which reset liveness)
    if (frame.data || isComment) {
      frames.push(frame)
    }
  }

  return { frames, remaining: buffer.slice(pos) }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SSETransportState =
  | 'idle'
  | 'connected'
  | 'reconnecting'
  | 'closing'
  | 'closed'

// 这段注释把协议边界讲透了：worker 订阅者只会收到 client_event，其余事件类型是客户端通道专属
/**
 * Payload for `event: client_event` frames, matching the StreamClientEvent
 * proto message in session_stream.proto. This is the only event type sent
 * to worker subscribers — delivery_update, session_update, ephemeral_event,
 * and catch_up_truncated are client-channel-only (see notifier.go and
 * event_stream.go SubscriberClient guard).
 */
export type StreamClientEvent = {
  event_id: string
  sequence_num: number
  event_type: string
  source: string
  payload: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// SSETransport
// ---------------------------------------------------------------------------

// 读用 SSE、写用 POST 的分工：读侧要长连与断点续传，写侧要的是可靠的 HTTP 重试
/**
 * Transport that uses SSE for reading and HTTP POST for writing.
 *
 * Reads events via Server-Sent Events from the CCR v2 event stream endpoint.
 * Writes events via HTTP POST with retry logic (same pattern as HybridTransport).
 *
 * Each `event: client_event` frame carries a StreamClientEvent proto JSON
 * directly in `data:`. The transport extracts `payload` and passes it to
 * `onData` as newline-delimited JSON for StructuredIO consumers.
 *
 * Supports automatic reconnection with exponential backoff and Last-Event-ID
 * for resumption after disconnection.
 */
// 每个 client_event 帧把 proto JSON 直接塞在 data 里，没有外层信封，所以传输层要拆出 payload 再交给上层
export class SSETransport implements Transport {
  private state: SSETransportState = 'idle'
  private onData?: (data: string) => void
  private onCloseCallback?: (closeCode?: number) => void
  private onEventCallback?: (event: StreamClientEvent) => void
  private headers: Record<string, string>
  private sessionId?: string
  private refreshHeaders?: () => Record<string, string>
  private readonly getAuthHeaders: () => Record<string, string>

  // SSE connection state
// 三个连接期状态：abortController 中断在途请求，lastSequenceNum 是高水位，seenSequenceNums 负责去重
  private abortController: AbortController | null = null
  private lastSequenceNum = 0
  private seenSequenceNums = new Set<number>()

  // Reconnection state
  private reconnectAttempts = 0
  private reconnectStartTime: number | null = null
  private reconnectTimer: NodeJS.Timeout | null = null

  // Liveness detection
  private livenessTimer: NodeJS.Timeout | null = null

  // POST URL (derived from SSE URL)
  private postUrl: string

  // Runtime epoch for CCR v2 event format

// 构造器里 getAuthHeaders 是可选的：单会话调用方读进程级环境变量即可，多会话并发必须按实例注入，否则会互相踩令牌
  constructor(
    private readonly url: URL,
    headers: Record<string, string> = {},
    sessionId?: string,
    refreshHeaders?: () => Record<string, string>,
    initialSequenceNum?: number,
    /**
     * Per-instance auth header source. Omit to read the process-wide
     * CLAUDE_CODE_SESSION_ACCESS_TOKEN (single-session callers). Required
     * for concurrent multi-session callers — the env-var path is a process
     * global and would stomp across sessions.
     */
    getAuthHeaders?: () => Record<string, string>,
  ) {
    this.headers = headers
    this.sessionId = sessionId
    this.refreshHeaders = refreshHeaders
    this.getAuthHeaders = getAuthHeaders ?? getSessionIngressAuthHeaders
// 初始高水位是换传输时的续传依据：不传就会让新实例从 0 开始索要全量历史
    this.postUrl = convertSSEUrlToPostUrl(url)
    // Seed with a caller-provided high-water mark so the first connect()
    // sends from_sequence_num / Last-Event-ID. Without this, a fresh
    // SSETransport always asks the server to replay from sequence 0 —
    // the entire session history on every transport swap.
    if (initialSequenceNum !== undefined && initialSequenceNum > 0) {
      this.lastSequenceNum = initialSequenceNum
    }
    logForDebugging(`SSETransport: SSE URL = ${url.href}`)
    logForDebugging(`SSETransport: POST URL = ${this.postUrl}`)
    logForDiagnosticsNoPII('info', 'cli_sse_transport_initialized')
  }

// 这个读取器的存在就是为了换手：调用方在 close 之前读一次，把位点交给下一个实例
  /**
   * High-water mark of sequence numbers seen on this stream. Callers that
   * recreate the transport (e.g. replBridge onWorkReceived) read this before
   * close() and pass it as `initialSequenceNum` to the next instance so the
   * server resumes from the right point instead of replaying everything.
   */
  getLastSequenceNum(): number {
    return this.lastSequenceNum
  }

  async connect(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'reconnecting') {
      logForDebugging(
        `SSETransport: Cannot connect, current state is ${this.state}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_sse_connect_failed')
      return
    }

    this.state = 'reconnecting'
    const connectStartTime = Date.now()

// 续传走两条通道：查询参数给服务端做首次定位，Last-Event-ID 头给中间层做重放
    // Build SSE URL with sequence number for resumption
    const sseUrl = new URL(this.url.href)
    if (this.lastSequenceNum > 0) {
      sseUrl.searchParams.set('from_sequence_num', String(this.lastSequenceNum))
    }

// 用 Cookie 认证时要把旧的 Authorization 删掉：两个头同时存在会干扰认证拦截器的判断
    // Build headers -- use fresh auth headers (supports Cookie for session keys).
    // Remove stale Authorization header from this.headers when Cookie auth is used,
    // since sending both confuses the auth interceptor.
    const authHeaders = this.getAuthHeaders()
    const headers: Record<string, string> = {
      ...this.headers,
      ...authHeaders,
      Accept: 'text/event-stream',
      'anthropic-version': '2023-06-01',
      'User-Agent': getClaudeCodeUserAgent(),
    }
    if (authHeaders['Cookie']) {
      delete headers['Authorization']
    }
    if (this.lastSequenceNum > 0) {
      headers['Last-Event-ID'] = String(this.lastSequenceNum)
    }

    logForDebugging(`SSETransport: Opening ${sseUrl.href}`)
    logForDiagnosticsNoPII('info', 'cli_sse_connect_opening')

    this.abortController = new AbortController()

    try {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const response = await fetch(sseUrl.href, {
        headers,
        signal: this.abortController.signal,
      })

// 非 2xx 分两级：永久码直接进终态并回调状态码，其余交给统一的重连逻辑
      if (!response.ok) {
        const isPermanent = PERMANENT_HTTP_CODES.has(response.status)
        logForDebugging(
          `SSETransport: HTTP ${response.status}${isPermanent ? ' (permanent)' : ''}`,
          { level: 'error' },
        )
        logForDiagnosticsNoPII('error', 'cli_sse_connect_http_error', {
          status: response.status,
        })

        if (isPermanent) {
          this.state = 'closed'
          this.onCloseCallback?.(response.status)
          return
        }

        this.handleConnectionError()
        return
      }

      if (!response.body) {
        logForDebugging('SSETransport: No response body')
        this.handleConnectionError()
        return
      }

// 连上之后的三件事：重置退避、启动存活计时器、进入读流循环——读流返回就意味着连接结束
      // Successfully connected
      const connectDuration = Date.now() - connectStartTime
      logForDebugging('SSETransport: Connected')
      logForDiagnosticsNoPII('info', 'cli_sse_connect_connected', {
        duration_ms: connectDuration,
      })

      this.state = 'connected'
      this.reconnectAttempts = 0
      this.reconnectStartTime = null
      this.resetLivenessTimer()

      // Read the SSE stream
      await this.readStream(response.body)
// catch 里先判 abort：主动关闭触发的异常不是错误，直接静默返回
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        // Intentional close
        return
      }

      logForDebugging(
        `SSETransport: Connection error: ${errorMessage(error)}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_sse_connect_error')
      this.handleConnectionError()
    }
  }

  /**
   * Read and process the SSE stream body.
   */
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
// 读流是单 reader 单解码器，解码用流式选项，避免多字节字符被数据块边界劈开
  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, STREAM_DECODE_OPTS)
        const { frames, remaining } = parseSSEFrames(buffer)
        buffer = remaining

// 每一帧都重置存活计时器，包括纯注释帧——这正是 keepalive 的设计目的
        for (const frame of frames) {
          // Any frame (including keepalive comments) proves the connection is alive
          this.resetLivenessTimer()

// 序号去重是幂等性的最后一道：重连后服务端可能重发边界帧，seenSequenceNums 拦住它们
          if (frame.id) {
            const seqNum = parseInt(frame.id, 10)
            if (!isNaN(seqNum)) {
              if (this.seenSequenceNums.has(seqNum)) {
                logForDebugging(
                  `SSETransport: DUPLICATE frame seq=${seqNum} (lastSequenceNum=${this.lastSequenceNum}, seenCount=${this.seenSequenceNums.size})`,
                  { level: 'warn' },
                )
                logForDiagnosticsNoPII('warn', 'cli_sse_duplicate_sequence')
              } else {
                this.seenSequenceNums.add(seqNum)
                // Prevent unbounded growth: once we have many entries, prune
                // old sequence numbers that are well below the high-water mark.
                // Only sequence numbers near lastSequenceNum matter for dedup.
// 去重集合不能无限增长：超过 1000 条就把远低于高水位的清掉，只有靠近高水位的序号还有去重价值
                if (this.seenSequenceNums.size > 1000) {
                  const threshold = this.lastSequenceNum - 200
                  for (const s of this.seenSequenceNums) {
                    if (s < threshold) {
                      this.seenSequenceNums.delete(s)
                    }
                  }
                }
              }
              if (seqNum > this.lastSequenceNum) {
                this.lastSequenceNum = seqNum
              }
            }
          }

// 缺 event 字段的帧被丢弃并记告警：说明服务端在发旧格式或出了 bug，静默丢会让事故无声无息
          if (frame.event && frame.data) {
            this.handleSSEFrame(frame.event, frame.data)
          } else if (frame.data) {
            // data: without event: — server is emitting the old envelope format
            // or a bug. Log so incidents show as a signal instead of silent drops.
            logForDebugging(
              'SSETransport: Frame has data: but no event: field — dropped',
              { level: 'warn' },
            )
            logForDiagnosticsNoPII('warn', 'cli_sse_frame_missing_event_field')
          }
        }
      }
    } catch (error) {
      if (this.abortController?.signal.aborted) return
      logForDebugging(
        `SSETransport: Stream read error: ${errorMessage(error)}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_sse_stream_read_error')
    } finally {
      reader.releaseLock()
    }

// 流自然结束不等于主动关闭：只要不在 closing 或 closed，就按断线处理重连
    // Stream ended — reconnect unless we're closing
    if (this.state !== 'closing' && this.state !== 'closed') {
      logForDebugging('SSETransport: Stream ended, reconnecting')
      this.handleConnectionError()
    }
  }

// 处理函数只认一种事件类型：worker 订阅者收到别的类型说明服务端变了，记遥测以便尽早发现
  /**
   * Handle a single SSE frame. The event: field names the variant; data:
   * carries the inner proto JSON directly (no envelope).
   *
   * Worker subscribers only receive client_event frames (see notifier.go) —
   * any other event type indicates a server-side change that CC doesn't yet
   * understand. Log a diagnostic so we notice in telemetry.
   */
  private handleSSEFrame(eventType: string, data: string): void {
    if (eventType !== 'client_event') {
      logForDebugging(
        `SSETransport: Unexpected SSE event type '${eventType}' on worker stream`,
        { level: 'warn' },
      )
      logForDiagnosticsNoPII('warn', 'cli_sse_unexpected_event_type', {
        event_type: eventType,
      })
      return
    }

    let ev: StreamClientEvent
    try {
      ev = jsonParse(data) as StreamClientEvent
    } catch (error) {
      logForDebugging(
        `SSETransport: Failed to parse client_event data: ${errorMessage(error)}`,
        { level: 'error' },
      )
      return
    }

// payload 里必须有 type 才往上传：没有 type 事件上层无法分派；未上传时仍把原始事件交给回调，供需要原始帧的调用方使用
    const payload = ev.payload
    if (payload && typeof payload === 'object' && 'type' in payload) {
      const sessionLabel = this.sessionId ? ` session=${this.sessionId}` : ''
      logForDebugging(
        `SSETransport: Event seq=${ev.sequence_num} event_id=${ev.event_id} event_type=${ev.event_type} payload_type=${String(payload.type)}${sessionLabel}`,
      )
      logForDiagnosticsNoPII('info', 'cli_sse_message_received')
      // Pass the unwrapped payload as newline-delimited JSON,
      // matching the format that StructuredIO/WebSocketTransport consumers expect
      this.onData?.(jsonStringify(payload) + '\n')
    } else {
      logForDebugging(
        `SSETransport: Ignoring client_event with no type in payload: event_id=${ev.event_id}`,
      )
    }

    this.onEventCallback?.(ev)
  }

// 错误处理先清存活计时器再判状态，然后主动 abort 在途请求——不 abort 会留下一个仍在读的流
  /**
   * Handle connection errors with exponential backoff and time budget.
   */
  private handleConnectionError(): void {
    this.clearLivenessTimer()

    if (this.state === 'closing' || this.state === 'closed') return

    // Abort any in-flight SSE fetch
    this.abortController?.abort()
    this.abortController = null

    const now = Date.now()
    if (!this.reconnectStartTime) {
      this.reconnectStartTime = now
    }

    const elapsed = now - this.reconnectStartTime
    if (elapsed < RECONNECT_GIVE_UP_MS) {
      // Clear any existing timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }

      // Refresh headers before reconnecting
      if (this.refreshHeaders) {
        const freshHeaders = this.refreshHeaders()
        Object.assign(this.headers, freshHeaders)
        logForDebugging('SSETransport: Refreshed headers for reconnect')
      }

      this.state = 'reconnecting'
      this.reconnectAttempts++

      const baseDelay = Math.min(
        RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
        RECONNECT_MAX_DELAY_MS,
      )
      // Add ±25% jitter
      const delay = Math.max(
        0,
        baseDelay + baseDelay * 0.25 * (2 * Math.random() - 1),
      )

      logForDebugging(
        `SSETransport: Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}, ${Math.round(elapsed / 1000)}s elapsed)`,
      )
      logForDiagnosticsNoPII('error', 'cli_sse_reconnect_attempt', {
        reconnectAttempts: this.reconnectAttempts,
      })

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        void this.connect()
      }, delay)
    } else {
      logForDebugging(
        `SSETransport: Reconnection time budget exhausted after ${Math.round(elapsed / 1000)}s`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_sse_reconnect_exhausted', {
        reconnectAttempts: this.reconnectAttempts,
        elapsedMs: elapsed,
      })
      this.state = 'closed'
      this.onCloseCallback?.()
    }
  }

// 存活超时回调提升成类属性箭头函数：它每帧都会被重置计时器引用，内联闭包等于每秒新建一个
  /**
   * Bound timeout callback. Hoisted from an inline closure so that
   * resetLivenessTimer (called per-frame) does not allocate a new closure
   * on every SSE frame.
   */
  private readonly onLivenessTimeout = (): void => {
    this.livenessTimer = null
    logForDebugging('SSETransport: Liveness timeout, reconnecting', {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_sse_liveness_timeout')
    this.abortController?.abort()
    this.handleConnectionError()
  }

// 重置即重建：先清旧的再设新的，避免两个计时器同时倒计时
  /**
   * Reset the liveness timer. If no SSE frame arrives within the timeout,
   * treat the connection as dead and reconnect.
   */
  private resetLivenessTimer(): void {
    this.clearLivenessTimer()
    this.livenessTimer = setTimeout(this.onLivenessTimeout, LIVENESS_TIMEOUT_MS)
  }

  private clearLivenessTimer(): void {
    if (this.livenessTimer) {
      clearTimeout(this.livenessTimer)
      this.livenessTimer = null
    }
  }

// 写侧与读侧完全解耦：POST 失败不影响 SSE 长连，反之亦然
  // -----------------------------------------------------------------------
  // Write (HTTP POST) — same pattern as HybridTransport
  // -----------------------------------------------------------------------

  async write(message: StdoutMessage): Promise<void> {
// 没有会话令牌就直接放弃并记告警：这种情况下重试无意义，只会刷出一堆 401
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) {
      logForDebugging('SSETransport: No session token available for POST')
      logForDiagnosticsNoPII('warn', 'cli_sse_post_no_token')
      return
    }

    const headers: Record<string, string> = {
      ...authHeaders,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'User-Agent': getClaudeCodeUserAgent(),
    }

    logForDebugging(
      `SSETransport: POST body keys=${Object.keys(message as Record<string, unknown>).join(',')}`,
    )

// 重试循环最多十次：每次先判状态码再决定是成功、永久失败还是继续退避
    for (let attempt = 1; attempt <= POST_MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(this.postUrl, message, {
          headers,
          validateStatus: alwaysValidStatus,
        })

// 200 与 201 都算成功：服务端对幂等写入可能返回其中任意一个
        if (response.status === 200 || response.status === 201) {
          logForDebugging(`SSETransport: POST success type=${message.type}`)
          return
        }

        logForDebugging(
          `SSETransport: POST ${response.status} body=${jsonStringify(response.data).slice(0, 200)}`,
        )
// 4xx 除 429 外一律不重试：请求本身有问题，重发只会重复失败
        // 4xx errors (except 429) are permanent - don't retry
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          logForDebugging(
            `SSETransport: POST returned ${response.status} (client error), not retrying`,
          )
          logForDiagnosticsNoPII('warn', 'cli_sse_post_client_error', {
            status: response.status,
          })
          return
        }

        // 429 or 5xx - retry
        logForDebugging(
          `SSETransport: POST returned ${response.status}, attempt ${attempt}/${POST_MAX_RETRIES}`,
        )
        logForDiagnosticsNoPII('warn', 'cli_sse_post_retryable_error', {
          status: response.status,
          attempt,
        })
      } catch (error) {
        const axiosError = error as AxiosError
        logForDebugging(
          `SSETransport: POST error: ${axiosError.message}, attempt ${attempt}/${POST_MAX_RETRIES}`,
        )
        logForDiagnosticsNoPII('warn', 'cli_sse_post_network_error', {
          attempt,
        })
      }

// 次数用尽就记一笔然后返回：写失败不上抛，避免一条消息发不出去就打断整个会话
      if (attempt === POST_MAX_RETRIES) {
        logForDebugging(
          `SSETransport: POST failed after ${POST_MAX_RETRIES} attempts, continuing`,
        )
        logForDiagnosticsNoPII('warn', 'cli_sse_post_retries_exhausted')
        return
      }

// 写侧退避是纯指数不带抖动：并发量小，不需要防惊群
      const delayMs = Math.min(
        POST_BASE_DELAY_MS * Math.pow(2, attempt - 1),
        POST_MAX_DELAY_MS,
      )
      await sleep(delayMs)
    }
  }

  // -----------------------------------------------------------------------
  // Transport interface
  // -----------------------------------------------------------------------

  isConnectedStatus(): boolean {
    return this.state === 'connected'
  }

  isClosedStatus(): boolean {
    return this.state === 'closed'
  }

  setOnData(callback: (data: string) => void): void {
    this.onData = callback
  }

  setOnClose(callback: (closeCode?: number) => void): void {
    this.onCloseCallback = callback
  }

  setOnEvent(callback: (event: StreamClientEvent) => void): void {
    this.onEventCallback = callback
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearLivenessTimer()

    this.state = 'closing'
    this.abortController?.abort()
    this.abortController = null
  }
}

// ---------------------------------------------------------------------------
// URL Conversion
// ---------------------------------------------------------------------------

// URL 转换只做一件事：把流端点末尾的 stream 去掉就是 POST 端点，两者共享同一路径前缀
/**
 * Convert an SSE URL to the HTTP POST endpoint URL.
 * The SSE stream URL and POST URL share the same base; the POST endpoint
 * is at `/events` (without `/stream`).
 *
 * From: https://api.example.com/v2/session_ingress/session/<session_id>/events/stream
 * To:   https://api.example.com/v2/session_ingress/session/<session_id>/events
 */
function convertSSEUrlToPostUrl(sseUrl: URL): string {
  let pathname = sseUrl.pathname
  // Remove /stream suffix to get the POST events endpoint
  if (pathname.endsWith('/stream')) {
    pathname = pathname.slice(0, -'/stream'.length)
  }
  return `${sseUrl.protocol}//${sseUrl.host}${pathname}`
}
