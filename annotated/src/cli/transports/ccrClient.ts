import { randomUUID } from 'crypto'
import type {
  SDKPartialAssistantMessage,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import { decodeJwtExpiry } from '../../bridge/jwtUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import { createAxiosInstance } from '../../utils/proxy.js'
import {
  registerSessionActivityCallback,
  unregisterSessionActivityCallback,
} from '../../utils/sessionActivity.js'
import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
} from '../../utils/sessionIngressAuth.js'
import type {
  RequiresActionDetails,
  SessionState,
} from '../../utils/sessionState.js'
import { sleep } from '../../utils/sleep.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import {
  RetryableError,
  SerialBatchEventUploader,
} from './SerialBatchEventUploader.js'
import type { SSETransport, StreamClientEvent } from './SSETransport.js'
import { WorkerStateUploader } from './WorkerStateUploader.js'
// CCRClient：CCR v2 的 worker 生命周期协议客户端。负责 epoch 管理（读 CLAUDE_CODE_WORKER_EPOCH）、运行时状态上报（PUT /worker）、心跳探活（POST /worker/heartbeat），以及把 stdio 事件经多个串行批量上传器投递给服务端。所有写操作都走统一的 this.request()。

/** Default interval between heartbeat events (20s; server TTL is 60s). */
// 默认心跳间隔 20s，服务端 TTL 是 60s，留足余量。
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000

/**
 * stream_event messages accumulate in a delay buffer for up to this many ms
 * before enqueue. Mirrors HybridTransport's batching window. text_delta
 * events for the same content block accumulate into a single full-so-far
 * snapshot per flush — each emitted event is self-contained so a client
 * connecting mid-stream sees complete text, not a fragment.
 */
const STREAM_EVENT_FLUSH_INTERVAL_MS = 100
// stream_event 延迟缓冲窗口 100ms：累积 delta 后再入队，既减少 POST 次数又支持 text_delta 合并；对齐 HybridTransport 的批处理窗口。

/** Hoisted axios validateStatus callback to avoid per-request closure allocation. */
// alwaysValidStatus：提升为顶层函数以避免每次请求都分配闭包。
function alwaysValidStatus(): boolean {
  return true
}

export type CCRInitFailReason =
  | 'no_auth_headers'
  | 'missing_epoch'
  | 'worker_register_failed'
// CCRInitFailReason：初始化失败原因三态——无鉴权头 / 缺 epoch / worker 注册失败。

/** Thrown by initialize(); carries a typed reason for the diag classifier. */
// CCRInitError：initialize() 抛出，携带类型化 reason 供诊断分类器用。
export class CCRInitError extends Error {
  constructor(readonly reason: CCRInitFailReason) {
    super(`CCRClient init failed: ${reason}`)
  }
}

/**
 * Consecutive 401/403 with a VALID-LOOKING token before giving up. An
 * expired JWT short-circuits this (exits immediately — deterministic,
 * retry is futile). This threshold is for the uncertain case: token's
 * exp is in the future but server says 401 (userauth down, KMS hiccup,
 * clock skew). 10 × 20s heartbeat ≈ 200s to ride it out.
 */
// MAX_CONSECUTIVE_AUTH_FAILURES：连续 401/403（且令牌看起来有效）的重试上限为 10。过期的 JWT 会短路直接退出（确定性的，重试无意义）；此阈值针对不确定情形——exp 在未来但服务端仍 401（userauth 宕机、KMS 抖动、时钟偏移）。10×20s 心跳约 200s 扛过去。
const MAX_CONSECUTIVE_AUTH_FAILURES = 10

type EventPayload = {
// EventPayload / ClientEvent：事件载荷与客户端事件包（ephemeral 标记瞬时事件）。
  uuid: string
  type: string
  [key: string]: unknown
}

type ClientEvent = {
  payload: EventPayload
  ephemeral?: boolean
}

/**
 * Structural subset of a stream_event carrying a text_delta. Not a narrowing
 * of SDKPartialAssistantMessage — RawMessageStreamEvent's delta is a union and
 * narrowing through two levels defeats the discriminant.
 */
// CoalescedStreamEvent：text_delta 合并后的流事件结构——每次 flush 每区块只发一个「截至当前完整文本」的快照。
type CoalescedStreamEvent = {
  type: 'stream_event'
  uuid: string
  session_id: string
  parent_tool_use_id: string | null
  event: {
    type: 'content_block_delta'
    index: number
    delta: { type: 'text_delta'; text: string }
  }
}

/**
 * Accumulator state for text_delta coalescing. Keyed by API message ID so
 * lifetime is tied to the assistant message — cleared when the complete
 * SDKAssistantMessage arrives (writeEvent), which is reliable even when
 * abort/error paths skip content_block_stop/message_stop delivery.
 */
// StreamAccumulatorState：text_delta 合并累加器状态，按 API message id 与 scope（session_id:parent_tool_use_id）双键索引。
export type StreamAccumulatorState = {
  /** API message ID (msg_...) → blocks[blockIndex] → chunk array. */
  byMessage: Map<string, string[][]>
  /**
   * {session_id}:{parent_tool_use_id} → active message ID.
   * content_block_delta events don't carry the message ID (only
   * message_start does), so we track which message is currently streaming
   * for each scope. At most one message streams per scope at a time.
   */
  scopeToMessage: Map<string, string>
}

export function createStreamAccumulator(): StreamAccumulatorState {
// createStreamAccumulator：新建一个空的累加器。
  return { byMessage: new Map(), scopeToMessage: new Map() }
}

function scopeKey(m: {
// scopeKey：用 session_id:parent_tool_use_id 拼出 scope 键，定位当前正在流式输出的消息。
  session_id: string
  parent_tool_use_id: string | null
}): string {
  return `${m.session_id}:${m.parent_tool_use_id ?? ''}`
}

/**
 * Accumulate text_delta stream_events into full-so-far snapshots per content
 * block. Each flush emits ONE event per touched block containing the FULL
 * accumulated text from the start of the block — a client connecting
 * mid-stream receives a self-contained snapshot, not a fragment.
 *
 * Non-text-delta events pass through unchanged. message_start records the
 * active message ID for the scope; content_block_delta appends chunks;
 * the snapshot event reuses the first text_delta UUID seen for that block in
 * this flush so server-side idempotency remains stable across retries.
 *
 * Cleanup happens in writeEvent when the complete assistant message arrives
 * (reliable), not here on stop events (abort/error paths skip those).
 */
// accumulateStreamEvents：把 text_delta 累积成「截至当前完整文本」快照。每个 flush 每区块只发一个自包含事件，使中途连入的客户端看到完整文本而非碎片；非 text_delta 事件原样透传。message_start 记录 scope 的活跃消息 id，content_block_delta 追加分块。
export function accumulateStreamEvents(
  buffer: SDKPartialAssistantMessage[],
  state: StreamAccumulatorState,
): EventPayload[] {
  const out: EventPayload[] = []
  // chunks[] → snapshot already in `out` this flush. Keyed by the chunks
  // array reference (stable per {messageId, index}) so subsequent deltas
  // rewrite the same entry instead of emitting one event per delta.
  const touched = new Map<string[], CoalescedStreamEvent>()
  for (const msg of buffer) {
    switch (msg.event.type) {
      case 'message_start': {
        const id = msg.event.message.id
        const prevId = state.scopeToMessage.get(scopeKey(msg))
        if (prevId) state.byMessage.delete(prevId)
        state.scopeToMessage.set(scopeKey(msg), id)
        state.byMessage.set(id, [])
        out.push(msg)
        break
      }
      case 'content_block_delta': {
        if (msg.event.delta.type !== 'text_delta') {
          out.push(msg)
          break
        }
        const messageId = state.scopeToMessage.get(scopeKey(msg))
        const blocks = messageId ? state.byMessage.get(messageId) : undefined
        if (!blocks) {
          // Delta without a preceding message_start (reconnect mid-stream,
          // or message_start was in a prior buffer that got dropped). Pass
          // through raw — can't produce a full-so-far snapshot without the
          // prior chunks anyway.
          out.push(msg)
          break
        }
        const chunks = (blocks[msg.event.index] ??= [])
        chunks.push(msg.event.delta.text)
        const existing = touched.get(chunks)
        if (existing) {
          existing.event.delta.text = chunks.join('')
          break
        }
        const snapshot: CoalescedStreamEvent = {
          type: 'stream_event',
          uuid: msg.uuid,
          session_id: msg.session_id,
          parent_tool_use_id: msg.parent_tool_use_id,
          event: {
            type: 'content_block_delta',
            index: msg.event.index,
            delta: { type: 'text_delta', text: chunks.join('') },
          },
        }
        touched.set(chunks, snapshot)
        out.push(snapshot)
        break
      }
      default:
        out.push(msg)
    }
  }
  return out
}

/**
 * Clear accumulator entries for a completed assistant message. Called from
 * writeEvent when the SDKAssistantMessage arrives — the reliable end-of-stream
 * signal that fires even when abort/interrupt/error skip SSE stop events.
 */
// clearStreamAccumulatorForMessage：完整 assistant 消息到达时清理累加器。放在 writeEvent 里调用——这是可靠的流结束信号，即便 abort/interrupt/error 跳过 SSE 的 stop 事件也会触发。
export function clearStreamAccumulatorForMessage(
  state: StreamAccumulatorState,
  assistant: {
    session_id: string
    parent_tool_use_id: string | null
    message: { id: string }
  },
): void {
  state.byMessage.delete(assistant.message.id)
  const scope = scopeKey(assistant)
  if (state.scopeToMessage.get(scope) === assistant.message.id) {
    state.scopeToMessage.delete(scope)
  }
}

type RequestResult = { ok: true } | { ok: false; retryAfterMs?: number }
// RequestResult / WorkerEvent / InternalEvent 等类型：请求结果（ok + 可选 retryAfterMs）、worker 事件、内部事件（用于会话恢复，前端不可见）。

type WorkerEvent = {
  payload: EventPayload
  is_compaction?: boolean
  agent_id?: string
}

export type InternalEvent = {
  event_id: string
  event_type: string
  payload: Record<string, unknown>
  event_metadata?: Record<string, unknown> | null
  is_compaction: boolean
  created_at: string
  agent_id?: string
}

type ListInternalEventsResponse = {
  data: InternalEvent[]
  next_cursor?: string
}

type WorkerStateResponse = {
  worker?: {
    external_metadata?: Record<string, unknown>
  }
}

/**
 * Manages the worker lifecycle protocol with CCR v2:
 * - Epoch management: reads worker_epoch from CLAUDE_CODE_WORKER_EPOCH env var
 * - Runtime state reporting: PUT /sessions/{id}/worker
 * - Heartbeat: POST /sessions/{id}/worker/heartbeat for liveness detection
 *
 * All writes go through this.request().
 */
// CCRClient 类：管理与 CCR v2 的 worker 生命周期协议——epoch 管理、状态上报、心跳。所有写操作经 this.request()。
// CCRClient 类定义，含大量私有字段（epoch、心跳参数、关闭标记、连续鉴权失败计数、会话 url/id、四个上传器、文本累加器）。
export class CCRClient {
  private workerEpoch = 0
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatJitterFraction: number
  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatInFlight = false
  private closed = false
  private consecutiveAuthFailures = 0
  private currentState: SessionState | null = null
  private readonly sessionBaseUrl: string
  private readonly sessionId: string
  private readonly http = createAxiosInstance({ keepAlive: true })

  // stream_event delay buffer — accumulates content deltas for up to
  // STREAM_EVENT_FLUSH_INTERVAL_MS before enqueueing (reduces POST count
  // and enables text_delta coalescing). Mirrors HybridTransport's pattern.
// streamEventBuffer：stream_event 延迟缓冲，最多累积 STREAM_EVENT_FLUSH_INTERVAL_MS 再入队，减少 POST 并支持 text_delta 合并。
  private streamEventBuffer: SDKPartialAssistantMessage[] = []
  private streamEventTimer: ReturnType<typeof setTimeout> | null = null
  // Full-so-far text accumulator. Persists across flushes so each emitted
  // text_delta event carries the complete text from the start of the block —
  // mid-stream reconnects see a self-contained snapshot. Keyed by API message
  // ID; cleared in writeEvent when the complete assistant message arrives.
// streamTextAccumulator：全量文本累加器，跨 flush 持久，使每个发出的 text_delta 都带从区块开头起的完整文本——中途重连能看到自包含快照；按 API 消息 id 键控，完整 assistant 消息到达时清理。
  private streamTextAccumulator = createStreamAccumulator()

  private readonly workerState: WorkerStateUploader
// 四个串行批量上传器：workerState（状态）/ eventUploader（客户端事件）/ internalEventUploader（内部事件）/ deliveryUploader（投递状态）。
  private readonly eventUploader: SerialBatchEventUploader<ClientEvent>
  private readonly internalEventUploader: SerialBatchEventUploader<WorkerEvent>
  private readonly deliveryUploader: SerialBatchEventUploader<{
    eventId: string
    status: 'received' | 'processing' | 'processed'
  }>

  /**
   * Called when the server returns 409 (a newer worker epoch superseded ours).
   * Default: process.exit(1) — correct for spawn-mode children where the
   * parent bridge re-spawns. In-process callers (replBridge) MUST override
   * this to close gracefully instead; exit would kill the user's REPL.
   */
// onEpochMismatch：服务端返回 409（更新的 worker epoch 取代了我们）时调用。默认 process.exit(1)——对 spawn 模式的子进程正确（父桥会重拉起）；in-process 调用方（replBridge）必须覆写成优雅关闭，否则 exit 会干掉用户的 REPL。
  private readonly onEpochMismatch: () => never

  /**
   * Auth header source. Defaults to the process-wide session-ingress token
   * (CLAUDE_CODE_SESSION_ACCESS_TOKEN env var). Callers managing multiple
   * concurrent sessions with distinct JWTs MUST inject this — the env-var
   * path is a process global and would stomp across sessions.
   */
// getAuthHeaders：鉴权头来源。默认读进程级 ingress 令牌（CLAUDE_CODE_SESSION_ACCESS_TOKEN 环境变量）；管理多个并发会话且各用不同 JWT 的调用方必须注入此函数——环境变量是进程全局，会跨会话互相踩。
  private readonly getAuthHeaders: () => Record<string, string>

// constructor：设 onEpochMismatch / 心跳参数 / 鉴权来源，解析 sessionUrl 取出 sessionId 与 baseUrl，建立四个上传器，并接线 transport 的 onEvent 回调。
  constructor(
    transport: SSETransport,
    sessionUrl: URL,
    opts?: {
      onEpochMismatch?: () => never
      heartbeatIntervalMs?: number
      heartbeatJitterFraction?: number
      /**
       * Per-instance auth header source. Omit to read the process-wide
       * CLAUDE_CODE_SESSION_ACCESS_TOKEN (single-session callers — REPL,
       * daemon). Required for concurrent multi-session callers.
       */
      getAuthHeaders?: () => Record<string, string>
    },
  ) {
    this.onEpochMismatch =
      opts?.onEpochMismatch ??
      (() => {
        // eslint-disable-next-line custom-rules/no-process-exit
        process.exit(1)
      })
    this.heartbeatIntervalMs =
      opts?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.heartbeatJitterFraction = opts?.heartbeatJitterFraction ?? 0
    this.getAuthHeaders = opts?.getAuthHeaders ?? getSessionIngressAuthHeaders
    // Session URL: https://host/v1/code/sessions/{id}
// 从 sessionUrl 解析 session id（路径最后一段）与 base url。
    if (sessionUrl.protocol !== 'http:' && sessionUrl.protocol !== 'https:') {
      throw new Error(
        `CCRClient: Expected http(s) URL, got ${sessionUrl.protocol}`,
      )
    }
    const pathname = sessionUrl.pathname.replace(/\/$/, '')
    this.sessionBaseUrl = `${sessionUrl.protocol}//${sessionUrl.host}${pathname}`
    // Extract session ID from the URL path (last segment)
    this.sessionId = pathname.split('/').pop() || ''

    this.workerState = new WorkerStateUploader({
      send: body =>
        this.request(
          'put',
          '/worker',
          { worker_epoch: this.workerEpoch, ...body },
          'PUT worker',
        ).then(r => r.ok),
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.eventUploader = new SerialBatchEventUploader<ClientEvent>({
// eventUploader：客户端事件上传器。flushStreamEventBuffer 一次入队整个 100ms 窗口的 stream_events；maxQueueSize 10 万（对齐 HybridTransport 上限，纯内存以防背压死锁）。
      maxBatchSize: 100,
      maxBatchBytes: 10 * 1024 * 1024,
      // flushStreamEventBuffer() enqueues a full 100ms window of accumulated
      // stream_events in one call. A burst of mixed delta types that don't
      // fold into a single snapshot could exceed the old cap (50) and deadlock
      // on the SerialBatchEventUploader backpressure check. Match
      // HybridTransport's bound — high enough to be memory-only.
      maxQueueSize: 100_000,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/events',
          { worker_epoch: this.workerEpoch, events: batch },
          'client events',
        )
        if (!result.ok) {
          throw new RetryableError(
            'client event POST failed',
            result.retryAfterMs,
          )
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.internalEventUploader = new SerialBatchEventUploader<WorkerEvent>({
// internalEventUploader：内部事件上传器，存 worker 内部状态（transcript、压缩标记），供会话恢复用，前端不可见。
      maxBatchSize: 100,
      maxBatchBytes: 10 * 1024 * 1024,
      maxQueueSize: 200,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/internal-events',
          { worker_epoch: this.workerEpoch, events: batch },
          'internal events',
        )
        if (!result.ok) {
          throw new RetryableError(
            'internal event POST failed',
            result.retryAfterMs,
          )
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.deliveryUploader = new SerialBatchEventUploader<{
// deliveryUploader：投递状态上报上传器（received / processing / processed）。
      eventId: string
      status: 'received' | 'processing' | 'processed'
    }>({
      maxBatchSize: 64,
      maxQueueSize: 64,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/events/delivery',
          {
            worker_epoch: this.workerEpoch,
            updates: batch.map(d => ({
              event_id: d.eventId,
              status: d.status,
            })),
          },
          'delivery batch',
        )
        if (!result.ok) {
          throw new RetryableError('delivery POST failed', result.retryAfterMs)
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    // Ack each received client_event so CCR can track delivery status.
    // Wired here (not in initialize()) so the callback is registered the
    // moment new CCRClient() returns — remoteIO must be free to call
    // transport.connect() immediately after without racing the first
    // SSE catch-up frame against an unwired onEventCallback.
// transport.setOnEvent：收到 client_event 即回报 delivery=received。放在构造器而非 initialize——确保 new CCRClient() 一返回就注册，remoteIO 可在其后立刻 transport.connect() 而不与首帧 SSE 竞态。
    transport.setOnEvent((event: StreamClientEvent) => {
      this.reportDelivery(event.event_id, 'received')
    })
  }

  /**
   * Initialize the session worker:
   * 1. Take worker_epoch from the argument, or fall back to
   *    CLAUDE_CODE_WORKER_EPOCH (set by env-manager / bridge spawner)
   * 2. Report state as 'idle'
   * 3. Start heartbeat timer
   *
   * In-process callers (replBridge) pass the epoch directly — they
   * registered the worker themselves and there is no parent process
   * setting env vars.
   */
// initialize：初始化 worker 三步——取 epoch → 报 idle 状态 → 起心跳。in-process 调用方直接传 epoch（它们自己注册过 worker，没有父进程设环境变量）。
  async initialize(epoch?: number): Promise<Record<string, unknown> | null> {
// initialize 入口：校验鉴权头与 epoch，并发拉取旧状态，PUT /worker 报 idle，起心跳，注册 activity 回调。
    const startMs = Date.now()
    if (Object.keys(this.getAuthHeaders()).length === 0) {
      throw new CCRInitError('no_auth_headers')
    }
    if (epoch === undefined) {
      const rawEpoch = process.env.CLAUDE_CODE_WORKER_EPOCH
      epoch = rawEpoch ? parseInt(rawEpoch, 10) : NaN
    }
    if (isNaN(epoch)) {
      throw new CCRInitError('missing_epoch')
    }
    this.workerEpoch = epoch

    // Concurrent with the init PUT — neither depends on the other.
// restoredPromise：与 init PUT 并发地拉取旧 worker 状态（两者互不依赖）。
    const restoredPromise = this.getWorkerState()

    const result = await this.request(
      'put',
      '/worker',
      {
        worker_status: 'idle',
        worker_epoch: this.workerEpoch,
        // Clear stale pending_action/task_summary left by a prior
        // worker crash — the in-session clears don't survive process restart.
        external_metadata: {
          pending_action: null,
          task_summary: null,
        },
      },
      'PUT worker (init)',
    )
    if (!result.ok) {
// PUT 失败（含 409）检查：request() 已吞掉 409 异常并返回 false，故这里抛 worker_register_failed 以走 connect() 的拒绝处理而非成功路径——否则会泄漏一个挂在死 epoch 上的 20s 定时器。
      // 409 → onEpochMismatch may throw, but request() catches it and returns
      // false. Without this check we'd continue to startHeartbeat(), leaking a
      // 20s timer against a dead epoch. Throw so connect()'s rejection handler
      // fires instead of the success path.
      throw new CCRInitError('worker_register_failed')
    }
    this.currentState = 'idle'
    this.startHeartbeat()

    // sessionActivity's refcount-gated timer fires while an API call or tool
    // is in-flight; without a write the container lease can expire mid-wait.
    // v1 wires this in WebSocketTransport per-connection.
    registerSessionActivityCallback(() => {
// registerSessionActivityCallback：API 调用或工具在途时写 keep_alive，防止容器租约在等待中途过期（v1 在 WebSocketTransport 里按连接接线）。
      void this.writeEvent({ type: 'keep_alive' })
    })

    logForDebugging(`CCRClient: initialized, epoch=${this.workerEpoch}`)
    logForDiagnosticsNoPII('info', 'cli_worker_lifecycle_initialized', {
      epoch: this.workerEpoch,
      duration_ms: Date.now() - startMs,
    })

    // Await the concurrent GET and log state_restored here, after the PUT
    // has succeeded — logging inside getWorkerState() raced: if the GET
    // resolved before the PUT failed, diagnostics showed both init_failed
    // and state_restored for the same session.
    const { metadata, durationMs } = await restoredPromise
// 等并发 GET 返回后再在此记录 state_restored——若把日志写进 getWorkerState() 会竞态：若 GET 先于 PUT 失败解析，诊断会同时显示 init_failed 与 state_restored。
    if (!this.closed) {
      logForDiagnosticsNoPII('info', 'cli_worker_state_restored', {
        duration_ms: durationMs,
        had_state: metadata !== null,
      })
    }
    return metadata
  }

  // Control_requests are marked processed and not re-delivered on
  // restart, so read back what the prior worker wrote.
// getWorkerState 文档：control_request 标记为 processed 且重启后不重投，所以要回读旧 worker 写入的状态。
// getWorkerState：拉取旧 worker 的 external_metadata（供会话恢复）。
  private async getWorkerState(): Promise<{
    metadata: Record<string, unknown> | null
    durationMs: number
  }> {
    const startMs = Date.now()
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) {
      return { metadata: null, durationMs: 0 }
    }
    const data = await this.getWithRetry<WorkerStateResponse>(
      `${this.sessionBaseUrl}/worker`,
      authHeaders,
      'worker_state',
    )
    return {
      metadata: data?.worker?.external_metadata ?? null,
      durationMs: Date.now() - startMs,
    }
  }

  /**
   * Send an authenticated HTTP request to CCR. Handles auth headers,
   * 409 epoch mismatch, and error logging. Returns { ok: true } on 2xx.
   * On 429, reads Retry-After (integer seconds) so the uploader can honor
   * the server's backoff hint instead of blindly exponentiating.
   */
// request 文档：统一的认证 HTTP 请求。处理鉴权头、409 epoch 不匹配、错误日志；2xx 返 {ok:true}；429 读 Retry-After（整数秒）让上传器按服务端退避提示退避而非盲目指数退避。
// request：私有统一请求方法（post/put）。
  private async request(
    method: 'post' | 'put',
    path: string,
    body: unknown,
    label: string,
    { timeout = 10_000 }: { timeout?: number } = {},
  ): Promise<RequestResult> {
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) return { ok: false }

    try {
      const response = await this.http[method](
        `${this.sessionBaseUrl}${path}`,
        body,
        {
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'User-Agent': getClaudeCodeUserAgent(),
          },
          validateStatus: alwaysValidStatus,
          timeout,
        },
      )

      if (response.status >= 200 && response.status < 300) {
        this.consecutiveAuthFailures = 0
        return { ok: true }
      }
      if (response.status === 409) {
        this.handleEpochMismatch()
      }
      if (response.status === 401 || response.status === 403) {
// 401/403 处理：先查令牌自身 exp，过期则确定性退出（任何重试都不会成功）；若令牌看起来有效但服务端仍 401（服务端抖动），计入连续失败阈值，到上限（10）才退出。
        // A 401 with an expired JWT is deterministic — no retry will
        // ever succeed. Check the token's own exp before burning
        // wall-clock on the threshold loop.
        const tok = getSessionIngressAuthToken()
        const exp = tok ? decodeJwtExpiry(tok) : null
        if (exp !== null && exp * 1000 < Date.now()) {
          logForDebugging(
            `CCRClient: session_token expired (exp=${new Date(exp * 1000).toISOString()}) — no refresh was delivered, exiting`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_worker_token_expired_no_refresh')
          this.onEpochMismatch()
        }
        // Token looks valid but server says 401 — possible server-side
        // blip (userauth down, KMS hiccup). Count toward threshold.
        this.consecutiveAuthFailures++
        if (this.consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
          logForDebugging(
            `CCRClient: ${this.consecutiveAuthFailures} consecutive auth failures with a valid-looking token — server-side auth unrecoverable, exiting`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_worker_auth_failures_exhausted')
          this.onEpochMismatch()
        }
      }
      logForDebugging(`CCRClient: ${label} returned ${response.status}`, {
        level: 'warn',
      })
      logForDiagnosticsNoPII('warn', 'cli_worker_request_failed', {
        method,
        path,
        status: response.status,
      })
      if (response.status === 429) {
// 429 处理：读响应头的 retry-after 秒数，转成毫秒回报 uploader 作为退避提示。
        const raw = response.headers?.['retry-after']
        const seconds = typeof raw === 'string' ? parseInt(raw, 10) : NaN
        if (!isNaN(seconds) && seconds >= 0) {
          return { ok: false, retryAfterMs: seconds * 1000 }
        }
      }
      return { ok: false }
    } catch (error) {
// catch：请求抛异常时记录错误日志与 errno 码，返回 {ok:false}。
      logForDebugging(`CCRClient: ${label} failed: ${errorMessage(error)}`, {
        level: 'warn',
      })
      logForDiagnosticsNoPII('warn', 'cli_worker_request_error', {
        method,
        path,
        error_code: getErrnoCode(error),
      })
      return { ok: false }
    }
  }

  /** Report worker state to CCR via PUT /sessions/{id}/worker. */
// reportState：PUT /worker 上报 worker 状态（idle / running / requires_action 等），带可选 requires_action_details。
  reportState(state: SessionState, details?: RequiresActionDetails): void {
    if (state === this.currentState && !details) return
    this.currentState = state
    this.workerState.enqueue({
      worker_status: state,
      requires_action_details: details
        ? {
            tool_name: details.tool_name,
            action_description: details.action_description,
            request_id: details.request_id,
          }
        : null,
    })
  }

  /** Report external metadata to CCR via PUT /worker. */
// reportMetadata：PUT /worker 上报 external_metadata。
  reportMetadata(metadata: Record<string, unknown>): void {
    this.workerState.enqueue({ external_metadata: metadata })
  }

  /**
   * Handle epoch mismatch (409 Conflict). A newer CC instance has replaced
   * this one — exit immediately.
   */
// handleEpochMismatch：409 epoch 不匹配，说明有更新的 CC 实例取代了我们，立即退出。
  private handleEpochMismatch(): never {
    logForDebugging('CCRClient: Epoch mismatch (409), shutting down', {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_worker_epoch_mismatch')
    this.onEpochMismatch()
  }

  /** Start periodic heartbeat. */
// startHeartbeat：起周期心跳定时器（带抖动）。
  private startHeartbeat(): void {
    this.stopHeartbeat()
    const schedule = (): void => {
      const jitter =
        this.heartbeatIntervalMs *
        this.heartbeatJitterFraction *
        (2 * Math.random() - 1)
      this.heartbeatTimer = setTimeout(tick, this.heartbeatIntervalMs + jitter)
    }
    const tick = (): void => {
      void this.sendHeartbeat()
      // stopHeartbeat nulls the timer; check after the fire-and-forget send
      // but before rescheduling so close() during sendHeartbeat is honored.
      if (this.heartbeatTimer === null) return
      schedule()
    }
    schedule()
  }

  /** Stop heartbeat timer. */
// stopHeartbeat：清掉心跳定时器。
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** Send a heartbeat via POST /sessions/{id}/worker/heartbeat. */
// sendHeartbeat：POST /worker/heartbeat 探活；heartbeatInFlight 防止重入。
  private async sendHeartbeat(): Promise<void> {
    if (this.heartbeatInFlight) return
    this.heartbeatInFlight = true
    try {
      const result = await this.request(
        'post',
        '/worker/heartbeat',
        { session_id: this.sessionId, worker_epoch: this.workerEpoch },
        'Heartbeat',
        { timeout: 5_000 },
      )
      if (result.ok) {
        logForDebugging('CCRClient: Heartbeat sent')
      }
    } finally {
      this.heartbeatInFlight = false
    }
  }

  /**
   * Write a StdoutMessage as a client event via POST /sessions/{id}/worker/events.
   * These events are visible to frontend clients via the SSE stream.
   * Injects a UUID if missing to ensure server-side idempotency on retry.
   *
   * stream_event messages are held in a 100ms delay buffer and accumulated
   * (text_deltas for the same content block emit a full-so-far snapshot per
   * flush). A non-stream_event write flushes the buffer first so downstream
   * ordering is preserved.
   */
// writeEvent 文档：把 StdoutMessage 写成 client event（POST /worker/events），前端经 SSE 可见。缺 UUID 时注入以保证重试幂等。stream_event 进 100ms 延迟缓冲累积，非 stream 消息先 flush 缓冲以保下游顺序。
// writeEvent：主写入入口。
  async writeEvent(message: StdoutMessage): Promise<void> {
    if (message.type === 'stream_event') {
      this.streamEventBuffer.push(message)
      if (!this.streamEventTimer) {
        this.streamEventTimer = setTimeout(
          () => void this.flushStreamEventBuffer(),
          STREAM_EVENT_FLUSH_INTERVAL_MS,
        )
      }
      return
    }
    await this.flushStreamEventBuffer()
    if (message.type === 'assistant') {
// 非 stream 消息先 flush 缓冲；assistant 消息到达时清理文本累加器（可靠清理点）。
      clearStreamAccumulatorForMessage(this.streamTextAccumulator, message)
    }
    await this.eventUploader.enqueue(this.toClientEvent(message))
  }

  /** Wrap a StdoutMessage as a ClientEvent, injecting a UUID if missing. */
// toClientEvent：把 StdoutMessage 包成 ClientEvent，uuid 非字符串则注入 randomUUID。
  private toClientEvent(message: StdoutMessage): ClientEvent {
    const msg = message as unknown as Record<string, unknown>
    return {
      payload: {
        ...msg,
        uuid: typeof msg.uuid === 'string' ? msg.uuid : randomUUID(),
      } as EventPayload,
    }
  }

  /**
   * Drain the stream_event delay buffer: accumulate text_deltas into
   * full-so-far snapshots, clear the timer, enqueue the resulting events.
   * Called from the timer, from writeEvent on a non-stream message, and from
   * flush(). close() drops the buffer — call flush() first if you need
   * delivery.
   */
// flushStreamEventBuffer：排空 stream_event 延迟缓冲，把 text_delta 累积成完整快照后入队。可由定时器、非 stream 写入、flush() 三处触发。close() 会丢弃缓冲，需要投递先调 flush()。
  private async flushStreamEventBuffer(): Promise<void> {
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    if (this.streamEventBuffer.length === 0) return
    const buffered = this.streamEventBuffer
    this.streamEventBuffer = []
    const payloads = accumulateStreamEvents(
      buffered,
      this.streamTextAccumulator,
    )
    await this.eventUploader.enqueue(
      payloads.map(payload => ({ payload, ephemeral: true })),
    )
  }

  /**
   * Write an internal worker event via POST /sessions/{id}/worker/internal-events.
   * These events are NOT visible to frontend clients — they store worker-internal
   * state (transcript messages, compaction markers) needed for session resume.
   */
// writeInternalEvent：写内部 worker 事件（POST /worker/internal-events），前端不可见，存 transcript 与压缩标记供会话恢复。
  async writeInternalEvent(
    eventType: string,
    payload: Record<string, unknown>,
    {
      isCompaction = false,
      agentId,
    }: {
      isCompaction?: boolean
      agentId?: string
    } = {},
  ): Promise<void> {
    const event: WorkerEvent = {
      payload: {
        type: eventType,
        ...payload,
        uuid: typeof payload.uuid === 'string' ? payload.uuid : randomUUID(),
      } as EventPayload,
      ...(isCompaction && { is_compaction: true }),
      ...(agentId && { agent_id: agentId }),
    }
    await this.internalEventUploader.enqueue(event)
  }

  /**
   * Flush pending internal events. Call between turns and on shutdown
   * to ensure transcript entries are persisted.
   */
// flushInternalEvents：回合间或关闭前刷内部事件，确保 transcript 落盘。
  flushInternalEvents(): Promise<void> {
    return this.internalEventUploader.flush()
  }

  /**
   * Flush pending client events (writeEvent queue). Call before close()
   * when the caller needs delivery confirmation — close() abandons the
   * queue. Resolves once the uploader drains or rejects; returns
   * regardless of whether individual POSTs succeeded (check server state
   * separately if that matters).
   */
// flush：刷客户端事件队列（writeEvent 队列）。close() 前调用以保证投递；close 会放弃队列。
  async flush(): Promise<void> {
    await this.flushStreamEventBuffer()
    return this.eventUploader.flush()
  }

  /**
   * Read foreground agent internal events from
   * GET /sessions/{id}/worker/internal-events.
   * Returns transcript entries from the last compaction boundary, or null on failure.
   * Used for session resume.
   */
// readInternalEvents：GET /worker/internal-events 读前台 agent 内部事件（从最近压缩边界起），用于会话恢复。
  async readInternalEvents(): Promise<InternalEvent[] | null> {
    return this.paginatedGet('/worker/internal-events', {}, 'internal_events')
  }

  /**
   * Read all subagent internal events from
   * GET /sessions/{id}/worker/internal-events?subagents=true.
   * Returns a merged stream across all non-foreground agents, each from its
   * compaction point. Used for session resume.
   */
// readSubagentInternalEvents：GET ?subagents=true 读所有 subagent 内部事件的合并流，各自从其压缩点起。
  async readSubagentInternalEvents(): Promise<InternalEvent[] | null> {
    return this.paginatedGet(
      '/worker/internal-events',
      { subagents: 'true' },
      'subagent_events',
    )
  }

  /**
   * Paginated GET with retry. Fetches all pages from a list endpoint,
   * retrying each page on failure with exponential backoff + jitter.
   */
// paginatedGet 文档：分页 GET + 重试，逐页拉全列表端点，每页失败指数退避+抖动。
// paginatedGet：私有分页拉取，用 cursor 翻页直到没有 next_cursor。
  private async paginatedGet(
    path: string,
    params: Record<string, string>,
    context: string,
  ): Promise<InternalEvent[] | null> {
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) return null

    const allEvents: InternalEvent[] = []
    let cursor: string | undefined

    do {
      const url = new URL(`${this.sessionBaseUrl}${path}`)
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v)
      }
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }

      const page = await this.getWithRetry<ListInternalEventsResponse>(
        url.toString(),
        authHeaders,
        context,
      )
      if (!page) return null

      allEvents.push(...(page.data ?? []))
      cursor = page.next_cursor
    } while (cursor)

    logForDebugging(
      `CCRClient: Read ${allEvents.length} internal events from ${path}${params.subagents ? ' (subagents)' : ''}`,
    )
    return allEvents
  }

  /**
   * Single GET request with retry. Returns the parsed response body
   * on success, null if all retries are exhausted.
   */
// getWithRetry 文档：单 GET + 重试，成功返解析后的响应体，重试耗尽返 null。
// getWithRetry：私有单次 GET，最多 10 次，指数退避+抖动。
  private async getWithRetry<T>(
    url: string,
    authHeaders: Record<string, string>,
    context: string,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= 10; attempt++) {
      let response
      try {
        response = await this.http.get<T>(url, {
          headers: {
            ...authHeaders,
            'anthropic-version': '2023-06-01',
            'User-Agent': getClaudeCodeUserAgent(),
          },
          validateStatus: alwaysValidStatus,
          timeout: 30_000,
        })
      } catch (error) {
        logForDebugging(
          `CCRClient: GET ${url} failed (attempt ${attempt}/10): ${errorMessage(error)}`,
          { level: 'warn' },
        )
        if (attempt < 10) {
          const delay =
            Math.min(500 * 2 ** (attempt - 1), 30_000) + Math.random() * 500
          await sleep(delay)
        }
        continue
      }

      if (response.status >= 200 && response.status < 300) {
        return response.data
      }
      if (response.status === 409) {
        this.handleEpochMismatch()
      }
      logForDebugging(
        `CCRClient: GET ${url} returned ${response.status} (attempt ${attempt}/10)`,
        { level: 'warn' },
      )

      if (attempt < 10) {
        const delay =
          Math.min(500 * 2 ** (attempt - 1), 30_000) + Math.random() * 500
        await sleep(delay)
      }
    }

    logForDebugging('CCRClient: GET retries exhausted', { level: 'error' })
    logForDiagnosticsNoPII('error', 'cli_worker_get_retries_exhausted', {
      context,
    })
    return null
  }

  /**
   * Report delivery status for a client-to-worker event.
   * POST /v1/code/sessions/{id}/worker/events/delivery (batch endpoint)
   */
// reportDelivery：向 /worker/events/delivery 批量上报事件投递状态（received / processing / processed）。
  reportDelivery(
    eventId: string,
    status: 'received' | 'processing' | 'processed',
  ): void {
    void this.deliveryUploader.enqueue({ eventId, status })
  }

  /** Get the current epoch (for external use). */
// getWorkerEpoch / internalEventsPending：对外暴露当前 epoch 与内部事件队列深度（关闭快照的背压信号）。
  getWorkerEpoch(): number {
    return this.workerEpoch
  }

  /** Internal-event queue depth — shutdown-snapshot backpressure signal. */
  get internalEventsPending(): number {
    return this.internalEventUploader.pendingCount
  }

  /** Clean up uploaders and timers. */
// close：清理定时器、取消 activity 回调、清空缓冲与文本累加器，并关闭四个上传器。
  close(): void {
    this.closed = true
    this.stopHeartbeat()
    unregisterSessionActivityCallback()
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    this.streamEventBuffer = []
    this.streamTextAccumulator.byMessage.clear()
    this.streamTextAccumulator.scopeToMessage.clear()
    this.workerState.close()
    this.eventUploader.close()
    this.internalEventUploader.close()
    this.deliveryUploader.close()
  }
}
