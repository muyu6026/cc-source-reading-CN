// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Env-less Remote Control bridge core.
 *
 * "Env-less" = no Environments API layer. Distinct from "CCR v2" (the
 * /worker/* transport protocol) — the env-based path (replBridge.ts) can also
 * use CCR v2 transport via CLAUDE_CODE_USE_CCR_V2. This file is about removing
 * the poll/dispatch layer, not about which transport protocol is underneath.
 *
 * Unlike initBridgeCore (env-based, ~2400 lines), this connects directly
 * to the session-ingress layer without the Environments API work-dispatch
 * layer:
 *
 *   1. POST /v1/code/sessions              (OAuth, no env_id)  → session.id
 *   2. POST /v1/code/sessions/{id}/bridge  (OAuth)             → {worker_jwt, expires_in, api_base_url, worker_epoch}
 *      Each /bridge call bumps epoch — it IS the register. No separate /worker/register.
 *   3. createV2ReplTransport(worker_jwt, worker_epoch)         → SSE + CCRClient
 *   4. createTokenRefreshScheduler                             → proactive /bridge re-call (new JWT + new epoch)
 *   5. 401 on SSE → rebuild transport with fresh /bridge credentials (same seq-num)
 *
 * No register/poll/ack/stop/heartbeat/deregister environment lifecycle.
 * The Environments API historically existed because CCR's /worker/*
 * endpoints required a session_id+role=worker JWT that only the work-dispatch
 * layer could mint. Server PR #292605 (renamed in #293280) adds the /bridge endpoint as a direct
 * OAuth→worker_jwt exchange, making the env layer optional for REPL sessions.
 *
 * Gated by `tengu_bridge_repl_v2` GrowthBook flag in initReplBridge.ts.
 * REPL-only — daemon/print stay on env-based.
 */
// 本文件实现「无环境层（Env-less）」远程控制桥接核心：不经过 Environments API 的工作派发层，直接连到会话入口层。注意它和 CCR v2 传输协议是两件不同的事——CCR v2 指 /worker/* 传输，而本文件说的是「去掉 poll/dispatch 那一层」，与底层用哪种传输无关。

import { feature } from 'bun:bundle'
import axios from 'axios'
import {
  createV2ReplTransport,
  type ReplBridgeTransport,
} from './replBridgeTransport.js'
import { buildCCRv2SdkUrl } from './workSecret.js'
import { toCompatSessionId } from './sessionIdCompat.js'
import { FlushGate } from './flushGate.js'
import { createTokenRefreshScheduler } from './jwtUtils.js'
import { getTrustedDeviceToken } from './trustedDevice.js'
import {
  getEnvLessBridgeConfig,
  type EnvLessBridgeConfig,
} from './envLessBridgeConfig.js'
import {
  handleIngressMessage,
  handleServerControlRequest,
  makeResultMessage,
  isEligibleBridgeMessage,
  extractTitleText,
  BoundedUUIDSet,
} from './bridgeMessaging.js'
import { logBridgeSkip } from './debugUtils.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { isInProtectedNamespace } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'
import { sleep } from '../utils/sleep.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { ReplBridgeHandle, BridgeState } from './replBridge.js'
import type { Message } from '../types/message.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'

const ANTHROPIC_VERSION = '2023-06-01'

// Telemetry discriminator for ws_connected. 'initial' is the default and
// never passed to rebuildTransport (which can only be called post-init);
// Exclude<> makes that constraint explicit at both signatures.
type ConnectCause = 'initial' | 'proactive_refresh' | 'auth_401_recovery'
// 连接原因三态：initial 初始、proactive_refresh 主动刷新、auth_401_recovery 鉴权恢复。用 Exclude<ConnectCause, 『initial』> 把「初始态不会出现在重建时」这条约束直接写进函数签名。

function oauthHeaders(accessToken: string): Record<string, string> {
// oauthHeaders 构造 OAuth 请求头：Bearer 令牌 + JSON 内容类型 + anthropic-version。
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

export type EnvLessBridgeParams = {
  baseUrl: string
  orgUUID: string
  title: string
  getAccessToken: () => string | undefined
  onAuth401?: (staleAccessToken: string) => Promise<boolean>
  /**
   * Converts internal Message[] → SDKMessage[] for writeMessages() and the
   * initial-flush/drain paths. Injected rather than imported — mappers.ts
   * transitively pulls in src/commands.ts (entire command registry + React
   * tree) which would bloat bundles that don't already have it.
   */
  toSDKMessages: (messages: Message[]) => SDKMessage[]
  initialHistoryCap: number
  initialMessages?: Message[]
  onInboundMessage?: (msg: SDKMessage) => void | Promise<void>
  /**
   * Fired on each title-worthy user message seen in writeMessages() until
   * the callback returns true (done). Mirrors replBridge.ts's onUserMessage —
   * caller derives a title and PATCHes /v1/sessions/{id} so auto-started
   * sessions don't stay at the generic fallback. The caller owns the
   * derive-at-count-1-and-3 policy; the transport just keeps calling until
   * told to stop. sessionId is the raw cse_* — updateBridgeSessionTitle
   * retags internally.
   */
  onUserMessage?: (text: string, sessionId: string) => boolean
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  /**
   * When true, skip opening the SSE read stream — only the CCRClient write
   * path is activated. Threaded to createV2ReplTransport and
   * handleServerControlRequest.
   */
  outboundOnly?: boolean
  /** Free-form tags for session categorization (e.g. ['ccr-mirror']). */
  tags?: string[]
}
// EnvLessBridgeParams 是 initEnvLessBridgeCore 的入参契约。注意 toSDKMessages 用注入而非直接 import——因为 mappers.ts 会顺带引入整个 commands.ts（指令注册表加 React 树），会撑大不需要它的包体。

/**
 * Create a session, fetch a worker JWT, connect the v2 transport.
 *
 * Returns null on any pre-flight failure (session create failed, /bridge
 * failed, transport setup failed). Caller (initReplBridge) surfaces this
 * as a generic "initialization failed" state.
 */
// 主入口：建会话 → 取桥接凭证 → 建 v2 传输 → 接线回调 → 返回句柄；任何预检失败返回 null，由上层 initReplBridge 表现为「初始化失败」。
export async function initEnvLessBridgeCore(
  params: EnvLessBridgeParams,
): Promise<ReplBridgeHandle | null> {
  const {
    baseUrl,
    orgUUID,
    title,
    getAccessToken,
    onAuth401,
    toSDKMessages,
    initialHistoryCap,
    initialMessages,
    onInboundMessage,
    onUserMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    outboundOnly,
    tags,
  } = params

  const cfg = await getEnvLessBridgeConfig()
// 读取桥接配置（超时、心跳间隔/抖动、刷新缓冲、去重缓冲等），后续步骤都从 cfg 取参数。

  // ── 1. Create session (POST /v1/code/sessions, no env_id) ───────────────
// 步骤一：创建会话（POST /v1/code/sessions，无 env_id）。
  const accessToken = getAccessToken()
// 取 OAuth 访问令牌；没有就直接返回 null，连会话都不建。
  if (!accessToken) {
    logForDebugging('[remote-bridge] No OAuth token')
    return null
  }

  const createdSessionId = await withRetry(
// 带指数退避重试地创建会话，失败重试上限由 cfg 控制。
    () =>
      createCodeSession(baseUrl, accessToken, title, cfg.http_timeout_ms, tags),
    'createCodeSession',
    cfg,
  )
  if (!createdSessionId) {
    onStateChange?.('failed', 'Session creation failed — see debug log')
    logBridgeSkip('v2_session_create_failed', undefined, true)
    return null
  }
  const sessionId: string = createdSessionId
// 记录服务端返回的会话 id（常量，全程不复建）。
  logForDebugging(`[remote-bridge] Created session ${sessionId}`)
  logForDiagnosticsNoPII('info', 'bridge_repl_v2_session_created')

  // ── 2. Fetch bridge credentials (POST /bridge → worker_jwt, expires_in, api_base_url) ──
// 步骤二：拉取桥接凭证（POST /bridge → worker_jwt、expires_in、api_base_url、worker_epoch）。每次 /bridge 调用都会把 epoch 加一，它本身就是「注册」，没有单独的 /worker/register。
  const credentials = await withRetry(
// 带重试地取凭证；凭证里含 worker_jwt 与 epoch。
    () =>
      fetchRemoteCredentials(
        sessionId,
        baseUrl,
        accessToken,
        cfg.http_timeout_ms,
      ),
    'fetchRemoteCredentials',
    cfg,
  )
  if (!credentials) {
// 取凭证失败则通知 failed 状态、记 skip 事件，并归档会话后返回 null。
    onStateChange?.('failed', 'Remote credentials fetch failed — see debug log')
    logBridgeSkip('v2_remote_creds_failed', undefined, true)
    void archiveSession(
      sessionId,
      baseUrl,
      accessToken,
      orgUUID,
      cfg.http_timeout_ms,
    )
    return null
  }
  logForDebugging(
    `[remote-bridge] Fetched bridge credentials (expires_in=${credentials.expires_in}s)`,
  )

  // ── 3. Build v2 transport (SSETransport + CCRClient) ────────────────────
// 步骤三：构建 v2 传输（SSETransport + CCRClient）。
  const sessionUrl = buildCCRv2SdkUrl(credentials.api_base_url, sessionId)
// buildCCRv2SdkUrl 用 api_base_url 与 sessionId 拼出 v2 会话 URL。
  logForDebugging(`[remote-bridge] v2 session URL: ${sessionUrl}`)

  let transport: ReplBridgeTransport
// 声明传输句柄变量，实际赋值放在下面的 try 里（建失败要 catch）。
  try {
    transport = await createV2ReplTransport({
      sessionUrl,
      ingressToken: credentials.worker_jwt,
      sessionId,
      epoch: credentials.worker_epoch,
      heartbeatIntervalMs: cfg.heartbeat_interval_ms,
      heartbeatJitterFraction: cfg.heartbeat_jitter_fraction,
      // Per-instance closure — keeps the worker JWT out of
      // process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN, which mcp/client.ts
      // reads ungatedly and would otherwise send to user-configured ws/http
      // MCP servers. Frozen-at-construction is correct: transport is fully
      // rebuilt on refresh (rebuildTransport below).
      getAuthToken: () => credentials.worker_jwt,
// getAuthToken 用闭包持有 JWT，而不是写进 process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN——后者会被 mcp/client.ts 无门槛读取并可能发给用户配置的 MCP 服务端。
      outboundOnly,
    })
  } catch (err) {
    logForDebugging(
      `[remote-bridge] v2 transport setup failed: ${errorMessage(err)}`,
      { level: 'error' },
    )
    onStateChange?.('failed', `Transport setup failed: ${errorMessage(err)}`)
    logBridgeSkip('v2_transport_setup_failed', undefined, true)
    void archiveSession(
      sessionId,
      baseUrl,
      accessToken,
      orgUUID,
      cfg.http_timeout_ms,
    )
    return null
  }
  logForDebugging(
    `[remote-bridge] v2 transport created (epoch=${credentials.worker_epoch})`,
  )
  onStateChange?.('ready')
// 传输建好，通知外层状态变为 ready。

  // ── 4. State ────────────────────────────────────────────────────────────
// 步骤四：声明本闭包内的一堆状态变量。

  // Echo dedup: messages we POST come back on the read stream. Seeded with
  // initial message UUIDs so server echoes of flushed history are recognized.
  // Both sets cover initial UUIDs — recentPostedUUIDs is a 2000-cap ring buffer
  // and could evict them after enough live writes; initialMessageUUIDs is the
  // unbounded fallback. Defense-in-depth; mirrors replBridge.ts.
  const recentPostedUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)
// 回声去重：我们 POST 出去的消息会回流到读流。用初始消息 uuid 播种，使服务端回显的历史 flush 被识别。recentPostedUUIDs 是 2000 上限的环形缓冲（可能淘汰旧 uuid），initialMessageUUIDs 是无界兜底，双保险。
  const initialMessageUUIDs = new Set<string>()
  if (initialMessages) {
    for (const msg of initialMessages) {
      initialMessageUUIDs.add(msg.uuid)
      recentPostedUUIDs.add(msg.uuid)
    }
  }

  // Defensive dedup for re-delivered inbound prompts (seq-num negotiation
  // edge cases, server history replay after transport swap).
  const recentInboundUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)
// 入站重试去重：应对 seq-num 协商边界、传输置换后服务端重放历史的情况。

  // FlushGate: queue live writes while the history flush POST is in flight,
  // so the server receives [history..., live...] in order.
  const flushGate = new FlushGate<Message>()
// FlushGate：历史 flush POST 在途时，把实时写入排队，保证服务端按 [历史..., 实时...] 顺序收到。

  let initialFlushDone = false
// initialFlushDone 标记历史首刷是否完成；tornDown 拆除标记；authRecoveryInFlight 401 恢复是否进行中。
  let tornDown = false
  let authRecoveryInFlight = false
  // Latch for onUserMessage — flips true when the callback returns true
  // (policy says "done deriving"). sessionId is const (no re-create path —
  // rebuildTransport swaps JWT/epoch, same session), so no reset needed.
  let userMessageCallbackDone = !onUserMessage
// onUserMessage 闩锁：回调返回 true（策略判定「标题推导完成」）即翻真。sessionId 是常量无重建路径，故无需重置。

  // Telemetry: why did onConnect fire? Set by rebuildTransport before
  // wireTransportCallbacks; read asynchronously by onConnect. Race-safe
  // because authRecoveryInFlight serializes rebuild callers, and a fresh
  // initEnvLessBridgeCore() call gets a fresh closure defaulting to 'initial'.
  let connectCause: ConnectCause = 'initial'
// connectCause 遥测：onConnect 为何触发。由 rebuildTransport 在接线前设置，onConnect 异步读取；因 authRecoveryInFlight 串行化重建调用方，且新闭包默认 initial，故无竞态。

  // Deadline for onConnect after transport.connect(). Cleared by onConnect
  // (connected) and onClose (got a close — not silent). If neither fires
  // before cfg.connect_timeout_ms, onConnectTimeout emits — the only
  // signal for the `started → (silence)` gap.
  let connectDeadline: ReturnType<typeof setTimeout> | undefined
// connectDeadline：transport.connect() 之后的连接超时兜底。onConnect（已连）或 onClose（收到关闭，非静默）都会清除它；若两个都没在 connect_timeout_ms 内触发，onConnectTimeout 上报——这是 started→(静默) 缺口的唯一信号。
  function onConnectTimeout(cause: ConnectCause): void {
// onConnectTimeout：超时未连上则上报遥测事件。
    if (tornDown) return
    logEvent('tengu_bridge_repl_connect_timeout', {
      v2: true,
      elapsed_ms: cfg.connect_timeout_ms,
      cause:
        cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // ── 5. JWT refresh scheduler ────────────────────────────────────────────
  // Schedule a callback 5min before expiry (per response.expires_in). On fire,
  // re-fetch /bridge with OAuth → rebuild transport with fresh credentials.
  // Each /bridge call bumps epoch server-side, so a JWT-only swap would leave
  // the old CCRClient heartbeating with a stale epoch → 409 within 20s.
  // JWT is opaque — do not decode.
// 步骤五：JWT 刷新调度器。
  const refresh = createTokenRefreshScheduler({
// createTokenRefreshScheduler：在过期前 refreshBufferMs 排程回调，触发时重新 /bridge 取凭证并重建传输。每次 /bridge 都让 epoch 加一，所以只换 JWT 不换 epoch 会让旧 CCRClient 用过期 epoch 心跳 → 20 秒内 409。JWT 是不透明令牌，不要解码。
    refreshBufferMs: cfg.token_refresh_buffer_ms,
    getAccessToken: async () => {
      // Unconditionally refresh OAuth before calling /bridge — getAccessToken()
      // returns expired tokens as non-null strings (doesn't check expiresAt),
      // so truthiness doesn't mean valid. Pass the stale token to onAuth401
      // so handleOAuth401Error's keychain-comparison can detect parallel refresh.
      const stale = getAccessToken()
      if (onAuth401) await onAuth401(stale ?? '')
      return getAccessToken() ?? stale
    },
    onRefresh: (sid, oauthToken) => {
// onRefresh：主动刷新回调。
      void (async () => {
        // Laptop wake: overdue proactive timer + SSE 401 fire ~simultaneously.
        // Claim the flag BEFORE the /bridge fetch so the other path skips
        // entirely — prevents double epoch bump (each /bridge call bumps; if
        // both fetch, the first rebuild gets a stale epoch and 409s).
        if (authRecoveryInFlight || tornDown) {
// 在 /bridge 拉取前就抢占标志，使另一条路径整体跳过，避免双重 epoch 加一（两次 /bridge 会让第一次重建拿到过期 epoch 而 409）。
          logForDebugging(
            '[remote-bridge] Recovery already in flight, skipping proactive refresh',
          )
          return
        }
        authRecoveryInFlight = true
        try {
          const fresh = await withRetry(
            () =>
              fetchRemoteCredentials(
                sid,
                baseUrl,
                oauthToken,
                cfg.http_timeout_ms,
              ),
            'fetchRemoteCredentials (proactive)',
            cfg,
          )
          if (!fresh || tornDown) return
          await rebuildTransport(fresh, 'proactive_refresh')
          logForDebugging(
            '[remote-bridge] Transport rebuilt (proactive refresh)',
          )
        } catch (err) {
          logForDebugging(
            `[remote-bridge] Proactive refresh rebuild failed: ${errorMessage(err)}`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII(
            'error',
            'bridge_repl_v2_proactive_refresh_failed',
          )
          if (!tornDown) {
            onStateChange?.('failed', `Refresh failed: ${errorMessage(err)}`)
          }
        } finally {
          authRecoveryInFlight = false
        }
      })()
    },
    label: 'remote',
  })
  refresh.scheduleFromExpiresIn(sessionId, credentials.expires_in)
// 按凭证 expires_in 排程首次刷新。

  // ── 6. Wire callbacks (extracted so transport-rebuild can re-wire) ──────
// 步骤六：接线回调（抽成函数以便传输重建时能重新接线）。
  function wireTransportCallbacks(): void {
// wireTransportCallbacks：给传输挂 onConnect / onData / onClose 三个回调。
    transport.setOnConnect(() => {
      clearTimeout(connectDeadline)
      logForDebugging('[remote-bridge] v2 transport connected')
      logForDiagnosticsNoPII('info', 'bridge_repl_v2_transport_connected')
      logEvent('tengu_bridge_repl_ws_connected', {
        v2: true,
        cause:
          connectCause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      if (!initialFlushDone && initialMessages && initialMessages.length > 0) {
        initialFlushDone = true
        // Capture current transport — if 401/teardown happens mid-flush,
        // the stale .finally() must not drain the gate or signal connected.
        // (Same guard pattern as replBridge.ts:1119.)
        const flushTransport = transport
        void flushHistory(initialMessages)
          .catch(e =>
            logForDebugging(`[remote-bridge] flushHistory failed: ${e}`),
          )
          .finally(() => {
            // authRecoveryInFlight catches the v1-vs-v2 asymmetry: v1 nulls
            // transport synchronously in setOnClose (replBridge.ts:1175), so
            // transport !== flushTransport trips immediately. v2 doesn't null —
            // transport reassigned only at rebuildTransport:346, 3 awaits deep.
            // authRecoveryInFlight is set synchronously at rebuildTransport entry.
            if (
              transport !== flushTransport ||
              tornDown ||
              authRecoveryInFlight
            ) {
              return
            }
            drainFlushGate()
            onStateChange?.('connected')
          })
      } else if (!flushGate.active) {
        onStateChange?.('connected')
      }
    })

    transport.setOnData((data: string) => {
// setOnData：收到数据交给 handleIngressMessage 分发，含权限响应与服务器控制请求的处理。
      handleIngressMessage(
        data,
        recentPostedUUIDs,
        recentInboundUUIDs,
        onInboundMessage,
        // Remote client answered the permission prompt — the turn resumes.
        // Without this the server stays on requires_action until the next
        // user message or turn-end result.
        onPermissionResponse
          ? res => {
              transport.reportState('running')
              onPermissionResponse(res)
            }
          : undefined,
        req =>
          handleServerControlRequest(req, {
            transport,
            sessionId,
            onInterrupt,
            onSetModel,
            onSetMaxThinkingTokens,
            onSetPermissionMode,
            outboundOnly,
          }),
      )
    })

    transport.setOnClose((code?: number) => {
// setOnClose：仅处理终态失败——401（JWT 失效）、4090（CCR epoch 不匹配）、4091（CCR 初始化失败）或 SSE 10 分钟重连预算耗尽。瞬时断线由 SSETransport 内部透明处理。401 可恢复，其余都是死路。
      clearTimeout(connectDeadline)
      if (tornDown) return
      logForDebugging(`[remote-bridge] v2 transport closed (code=${code})`)
      logEvent('tengu_bridge_repl_ws_closed', { code, v2: true })
      // onClose fires only for TERMINAL failures: 401 (JWT invalid),
      // 4090 (CCR epoch mismatch), 4091 (CCR init failed), or SSE 10-min
      // reconnect budget exhausted. Transient disconnects are handled
      // transparently inside SSETransport. 401 we can recover from (fetch
      // fresh JWT, rebuild transport); all other codes are dead-ends.
      if (code === 401 && !authRecoveryInFlight) {
// code===401 且不在恢复中 → 触发 JWT 恢复流程。
        void recoverFromAuthFailure()
        return
      }
      onStateChange?.('failed', `Transport closed (code ${code})`)
    })
  }

  // ── 7. Transport rebuild (shared by proactive refresh + 401 recovery) ──
  // Every /bridge call bumps epoch server-side. Both refresh paths must
  // rebuild the transport with the new epoch — a JWT-only swap leaves the
  // old CCRClient heartbeating stale epoch → 409. SSE resumes from the old
  // transport's high-water-mark seq-num so no server-side replay.
  // Caller MUST set authRecoveryInFlight = true before calling (synchronously,
  // before any await) and clear it in a finally. This function doesn't manage
  // the flag — moving it here would be too late to prevent a double /bridge
  // fetch, and each fetch bumps epoch.
// 步骤七：传输重建（主动刷新与 401 恢复共用）。每次 /bridge 都会让 epoch 加一，两条路径都必须用新 epoch 重建，否则旧 CCRClient 用过期 epoch 心跳 → 409。SSE 从旧传输的高水位 seq-num 续传，服务端不重放。
// rebuildTransport：换 JWT/epoch 重建传输，沿用旧 seq-num。调用方必须在任何 await 之前同步把 authRecoveryInFlight 置真、在 finally 里清掉——本函数不管理该标志，移进来就太晚，无法阻止双重 /bridge 拉取（每次拉取都会 bump epoch）。
  async function rebuildTransport(
    fresh: RemoteCredentials,
    cause: Exclude<ConnectCause, 'initial'>,
  ): Promise<void> {
    connectCause = cause
    // Queue writes during rebuild — once /bridge returns, the old transport's
    // epoch is stale and its next write/heartbeat 409s. Without this gate,
    // writeMessages adds UUIDs to recentPostedUUIDs then writeBatch silently
    // no-ops (closed uploader after 409) → permanent silent message loss.
// 重建期间开闸门排队写：一旦 /bridge 返回，旧传输 epoch 失效、下次写/心跳会 409。不排队的话 writeMessages 会把 uuid 加进 recentPostedUUIDs 然后 writeBatch 静默 no-op（409 后上传器关闭）→ 永久静默丢消息。
    flushGate.start()
    try {
      const seq = transport.getLastSequenceNum()
      transport.close()
      transport = await createV2ReplTransport({
        sessionUrl: buildCCRv2SdkUrl(fresh.api_base_url, sessionId),
        ingressToken: fresh.worker_jwt,
        sessionId,
        epoch: fresh.worker_epoch,
        heartbeatIntervalMs: cfg.heartbeat_interval_ms,
        heartbeatJitterFraction: cfg.heartbeat_jitter_fraction,
        initialSequenceNum: seq,
        getAuthToken: () => fresh.worker_jwt,
        outboundOnly,
      })
      if (tornDown) {
// 若重建途中触发了拆除：不接线/连接/排程，直接关掉新传输返回，避免取消后还重设定时器、把入站消息打进已拆的桥。
        // Teardown fired during the async createV2ReplTransport window.
        // Don't wire/connect/schedule — we'd re-arm timers after cancelAll()
        // and fire onInboundMessage into a torn-down bridge.
        transport.close()
        return
      }
      wireTransportCallbacks()
// 重建完成后重新接线（re-wire）。
      transport.connect()
      connectDeadline = setTimeout(
        onConnectTimeout,
        cfg.connect_timeout_ms,
        connectCause,
      )
      refresh.scheduleFromExpiresIn(sessionId, fresh.expires_in)
      // Drain queued writes into the new uploader. Runs before
      // ccr.initialize() resolves (transport.connect() is fire-and-forget),
      // but the uploader serializes behind the initial PUT /worker. If
      // init fails (4091), events drop — but only recentPostedUUIDs
      // (per-instance) is populated, so re-enabling the bridge re-flushes.
      drainFlushGate()
    } finally {
      // End the gate on failure paths too — drainFlushGate already ended
      // it on success. Queued messages are dropped (transport still dead).
      flushGate.drop()
    }
  }

  // ── 8. 401 recovery (OAuth refresh + rebuild) ───────────────────────────
// 步骤八：401 恢复（OAuth 刷新 + 重建）。
// recoverFromAuthFailure：SSE 上收到 401 时，做 OAuth 刷新再重建传输。
  async function recoverFromAuthFailure(): Promise<void> {
    // setOnClose already guards `!authRecoveryInFlight` but that check and
    // this set must be atomic against onRefresh — claim synchronously before
    // any await. Laptop wake fires both paths ~simultaneously.
    if (authRecoveryInFlight) return
// setOnClose 已用 !authRecoveryInFlight 守卫，但那次检查和这里的置位必须对 onRefresh 原子——在任何 await 前同步抢占。笔记本唤醒会几乎同时触发两条路径。
    authRecoveryInFlight = true
    onStateChange?.('reconnecting', 'JWT expired — refreshing')
    logForDebugging('[remote-bridge] 401 on SSE — attempting JWT refresh')
    try {
      // Unconditionally try OAuth refresh — getAccessToken() returns expired
      // tokens as non-null strings, so !oauthToken doesn't catch expiry.
      // Pass the stale token so handleOAuth401Error's keychain-comparison
      // can detect if another tab already refreshed.
      const stale = getAccessToken()
      if (onAuth401) await onAuth401(stale ?? '')
      const oauthToken = getAccessToken() ?? stale
      if (!oauthToken || tornDown) {
        if (!tornDown) {
          onStateChange?.('failed', 'JWT refresh failed: no OAuth token')
        }
        return
      }

      const fresh = await withRetry(
// 带重试地取新凭证（恢复路径）。
        () =>
          fetchRemoteCredentials(
            sessionId,
            baseUrl,
            oauthToken,
            cfg.http_timeout_ms,
          ),
        'fetchRemoteCredentials (recovery)',
        cfg,
      )
      if (!fresh || tornDown) {
        if (!tornDown) {
          onStateChange?.('failed', 'JWT refresh failed after 401')
        }
        return
      }
      // If 401 interrupted the initial flush, writeBatch may have silently
      // no-op'd on the closed uploader (ccr.close() ran in the SSE wrapper
      // before our setOnClose callback). Reset so the new onConnect re-flushes.
      // (v1 scopes initialFlushDone inside the per-transport closure at
      // replBridge.ts:1027 so it resets naturally; v2 has it at outer scope.)
      initialFlushDone = false
// 若 401 打断初始 flush，writeBatch 可能已在关闭的上传器上静默 no-op，故重置首刷标记，让新 onConnect 重新 flush。
      await rebuildTransport(fresh, 'auth_401_recovery')
      logForDebugging('[remote-bridge] Transport rebuilt after 401')
    } catch (err) {
      logForDebugging(
        `[remote-bridge] 401 recovery failed: ${errorMessage(err)}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'bridge_repl_v2_jwt_refresh_failed')
      if (!tornDown) {
        onStateChange?.('failed', `JWT refresh failed: ${errorMessage(err)}`)
      }
    } finally {
      authRecoveryInFlight = false
    }
  }

  wireTransportCallbacks()
// 初次接线（重建时会被再次调用）。

  // Start flushGate BEFORE connect so writeMessages() during handshake
  // queues instead of racing the history POST.
// 连之前就开闸门，使握手期的 writeMessages 排队而非和 history POST 竞速。
  if (initialMessages && initialMessages.length > 0) {
    flushGate.start()
  }
  transport.connect()
// 发起传输连接。
  connectDeadline = setTimeout(
    onConnectTimeout,
    cfg.connect_timeout_ms,
    connectCause,
  )

  // ── 8. History flush + drain helpers ────────────────────────────────────
// 步骤八（续）：历史 flush 与排水的助手函数。
// drainFlushGate：把闸门里排队的消息取出并写出去，含回声去重与 running 状态上报。
  function drainFlushGate(): void {
    const msgs = flushGate.end()
    if (msgs.length === 0) return
    for (const msg of msgs) recentPostedUUIDs.add(msg.uuid)
    const events = toSDKMessages(msgs).map(m => ({
      ...m,
      session_id: sessionId,
    }))
    if (msgs.some(m => m.type === 'user')) {
      transport.reportState('running')
    }
    logForDebugging(
      `[remote-bridge] Drained ${msgs.length} queued message(s) after flush`,
    )
    void transport.writeBatch(events)
  }

// flushHistory：首连时把初始历史 flush 给服务端。v2 总是新建服务端会话，无复用、无重复 POST 风险；与 v1 不同，这里不过滤 previouslyFlushedUUIDs（那套集合跨 REPL 开关周期存活，重开会误抑制历史）。
  async function flushHistory(msgs: Message[]): Promise<void> {
    // v2 always creates a fresh server session (unconditional createCodeSession
    // above) — no session reuse, no double-post risk. Unlike v1, we do NOT
    // filter by previouslyFlushedUUIDs: that set persists across REPL enable/
    // disable cycles (useRef), so it would wrongly suppress history on re-enable.
    const eligible = msgs.filter(isEligibleBridgeMessage)
    const capped =
      initialHistoryCap > 0 && eligible.length > initialHistoryCap
        ? eligible.slice(-initialHistoryCap)
        : eligible
    if (capped.length < eligible.length) {
      logForDebugging(
        `[remote-bridge] Capped initial flush: ${eligible.length} -> ${capped.length} (cap=${initialHistoryCap})`,
      )
    }
    const events = toSDKMessages(capped).map(m => ({
      ...m,
      session_id: sessionId,
    }))
    if (events.length === 0) return
    // Mid-turn init: if Remote Control is enabled while a query is running,
    // the last eligible message is a user prompt or tool_result (both 'user'
    // type). Without this the init PUT's 'idle' sticks until the next user-
    // type message forwards via writeMessages — which for a pure-text turn
    // is never (only assistant chunks stream post-init). Check eligible (pre-
    // cap), not capped: the cap may truncate to a user message even when the
    // actual trailing message is assistant.
    if (eligible.at(-1)?.type === 'user') {
// 末条合格消息是 user 类型时上报 running——应对「查询进行中才开远程控制」的中途初始化场景。检查 eligible（截断前）而非 capped，因为 cap 可能截到 user 消息而实际末条是 assistant。
      transport.reportState('running')
    }
    logForDebugging(`[remote-bridge] Flushing ${events.length} history events`)
    await transport.writeBatch(events)
  }

  // ── 9. Teardown ───────────────────────────────────────────────────────────
  // On SIGINT/SIGTERM/⁠/exit, gracefulShutdown races runCleanupFunctions()
  // against a 2s cap before forceExit kills the process. Budget accordingly:
  //   - archive: teardown_archive_timeout_ms (default 1500, cap 2000)
  //   - result write: fire-and-forget, archive latency covers the drain
  //   - 401 retry: only if first archive 401s, shares the same budget
// 步骤九：拆除（优雅关闭）。
// teardown：SIGINT/SIGTERM/exit 时的优雅关闭，gracefulShutdown 在 2 秒预算内与 runCleanupFunctions 竞速后才 forceExit。归档、结果写、401 重试都共享这同一预算。
  async function teardown(): Promise<void> {
    if (tornDown) return
// 幂等保护：已拆过就直接返回。
    tornDown = true
    refresh.cancelAll()
    clearTimeout(connectDeadline)
    flushGate.drop()

    // Fire the result message before archive — transport.write() only awaits
    // enqueue (SerialBatchEventUploader resolves once buffered, drain is
    // async). Archiving before close() gives the uploader's drain loop a
    // window (typical archive ≈ 100-500ms) to POST the result without an
    // explicit sleep. close() sets closed=true which interrupts drain at the
    // next while-check, so close-before-archive drops the result.
    transport.reportState('idle')
// 先发结果再归档——write 只等入队（SerialBatchEventUploader 缓冲即 resolve，排水异步）。归档在 close 前给上传器排水循环留出窗口（典型归档 100–500ms）。close 会把 closed 置真，在下次 while 检查处打断排水，故 close-before-archive 会丢掉结果。
    void transport.write(makeResultMessage(sessionId))

    let token = getAccessToken()
    let status = await archiveSession(
      sessionId,
      baseUrl,
      token,
      orgUUID,
      cfg.teardown_archive_timeout_ms,
    )

    // Token is usually fresh (refresh scheduler runs 5min before expiry) but
    // laptop-wake past the refresh window leaves getAccessToken() returning a
    // stale string. Retry once on 401 — onAuth401 (= handleOAuth401Error)
    // clears keychain cache + force-refreshes. No proactive refresh on the
    // happy path: handleOAuth401Error force-refreshes even valid tokens,
    // which would waste budget 99% of the time. try/catch mirrors
    // recoverFromAuthFailure: keychain reads can throw (macOS locked after
    // wake); an uncaught throw here would skip transport.close + telemetry.
    if (status === 401 && onAuth401) {
// 令牌通常新鲜（刷新调度器在过期前 5 分钟跑），但笔记本唤醒越过刷新窗口会让 getAccessToken 返回陈旧串。仅在首次归档 401 时重试一次：onAuth401 清 keychain 缓存并强制刷新。
      try {
        await onAuth401(token ?? '')
        token = getAccessToken()
        status = await archiveSession(
          sessionId,
          baseUrl,
          token,
          orgUUID,
          cfg.teardown_archive_timeout_ms,
        )
      } catch (err) {
        logForDebugging(
          `[remote-bridge] Teardown 401 retry threw: ${errorMessage(err)}`,
          { level: 'error' },
        )
      }
    }

    transport.close()
// 关闭传输。

    const archiveStatus: ArchiveTelemetryStatus =
      status === 'no_token'
        ? 'skipped_no_token'
        : status === 'timeout' || status === 'error'
          ? 'network_error'
          : status >= 500
            ? 'server_5xx'
            : status >= 400
              ? 'server_4xx'
              : 'ok'

    logForDebugging(`[remote-bridge] Torn down (archive=${status})`)
    logForDiagnosticsNoPII('info', 'bridge_repl_v2_teardown')
    logEvent(
      feature('CCR_MIRROR') && outboundOnly
        ? 'tengu_ccr_mirror_teardown'
        : 'tengu_bridge_repl_teardown',
      {
        v2: true,
        archive_status:
          archiveStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        archive_ok: typeof status === 'number' && status < 400,
        archive_http_status: typeof status === 'number' ? status : undefined,
        archive_timeout: status === 'timeout',
        archive_no_token: status === 'no_token',
      },
    )
  }
  const unregister = registerCleanup(teardown)
// registerCleanup(teardown) 注册清理钩子，返回注销函数。

  if (feature('CCR_MIRROR') && outboundOnly) {
    logEvent('tengu_ccr_mirror_started', {
      v2: true,
      expires_in_s: credentials.expires_in,
    })
  } else {
    logEvent('tengu_bridge_repl_started', {
      has_initial_messages: !!(initialMessages && initialMessages.length > 0),
      v2: true,
      expires_in_s: credentials.expires_in,
      inProtectedNamespace: isInProtectedNamespace(),
    })
  }

  // ── 10. Handle ──────────────────────────────────────────────────────────
// 步骤十：组装并返回对外句柄对象。
  return {
    bridgeSessionId: sessionId,
    environmentId: '',
    sessionIngressUrl: credentials.api_base_url,
    writeMessages(messages) {
// writeMessages：过滤掉回声与已发消息后写出。
      const filtered = messages.filter(
        m =>
          isEligibleBridgeMessage(m) &&
          !initialMessageUUIDs.has(m.uuid) &&
          !recentPostedUUIDs.has(m.uuid),
      )
      if (filtered.length === 0) return

      // Fire onUserMessage for title derivation. Scan before the flushGate
      // check — prompts are title-worthy even if they queue. Keeps calling
      // on every title-worthy message until the callback returns true; the
      // caller owns the policy (derive at 1st and 3rd, skip if explicit).
      if (!userMessageCallbackDone) {
// 若标题回调未完成，遍历过滤后消息触发 onUserMessage 做标题推导，回调返回 true 即停。
        for (const m of filtered) {
          const text = extractTitleText(m)
          if (text !== undefined && onUserMessage?.(text, sessionId)) {
            userMessageCallbackDone = true
            break
          }
        }
      }

      if (flushGate.enqueue(...filtered)) {
// 闸门激活则入队并直接返回（握手期排队）。
        logForDebugging(
          `[remote-bridge] Queued ${filtered.length} message(s) during flush`,
        )
        return
      }

      for (const msg of filtered) recentPostedUUIDs.add(msg.uuid)
      const events = toSDKMessages(filtered).map(m => ({
        ...m,
        session_id: sessionId,
      }))
      // v2 does not derive worker_status from events server-side (unlike v1
      // session-ingress session_status_updater.go). Push it from here so the
      // CCR web session list shows Running instead of stuck on Idle. A user
      // message in the batch marks turn start. CCRClient.reportState dedupes
      // consecutive same-state pushes.
      if (filtered.some(m => m.type === 'user')) {
// 批次里含 user 消息则标记回合开始并上报 running；CCRClient.reportState 会对连续相同状态去重。
        transport.reportState('running')
      }
      logForDebugging(`[remote-bridge] Sending ${filtered.length} message(s)`)
      void transport.writeBatch(events)
    },
    writeSdkMessages(messages: SDKMessage[]) {
// writeSdkMessages：直接写 SDK 消息，走更轻的过滤（仅去重 recentPostedUUIDs）。
      const filtered = messages.filter(
        m => !m.uuid || !recentPostedUUIDs.has(m.uuid),
      )
      if (filtered.length === 0) return
      for (const msg of filtered) {
        if (msg.uuid) recentPostedUUIDs.add(msg.uuid)
      }
      const events = filtered.map(m => ({ ...m, session_id: sessionId }))
      void transport.writeBatch(events)
    },
    sendControlRequest(request: SDKControlRequest) {
// sendControlRequest：发控制请求；can_use_tool 子类型上报 requires_action 状态。
      if (authRecoveryInFlight) {
        logForDebugging(
          `[remote-bridge] Dropping control_request during 401 recovery: ${request.request_id}`,
        )
        return
      }
      const event = { ...request, session_id: sessionId }
      if (request.request.subtype === 'can_use_tool') {
        transport.reportState('requires_action')
      }
      void transport.write(event)
      logForDebugging(
        `[remote-bridge] Sent control_request request_id=${request.request_id}`,
      )
    },
    sendControlResponse(response: SDKControlResponse) {
// sendControlResponse：发控制响应，上报 running。
      if (authRecoveryInFlight) {
        logForDebugging(
          '[remote-bridge] Dropping control_response during 401 recovery',
        )
        return
      }
      const event = { ...response, session_id: sessionId }
      transport.reportState('running')
      void transport.write(event)
      logForDebugging('[remote-bridge] Sent control_response')
    },
    sendControlCancelRequest(requestId: string) {
// sendControlCancelRequest：本地（hook/分类器/通道/recheck）已解决权限时只发取消请求（不上响应），使服务端离开 requires_action。
      if (authRecoveryInFlight) {
        logForDebugging(
          `[remote-bridge] Dropping control_cancel_request during 401 recovery: ${requestId}`,
        )
        return
      }
      const event = {
        type: 'control_cancel_request' as const,
        request_id: requestId,
        session_id: sessionId,
      }
      // Hook/classifier/channel/recheck resolved the permission locally —
      // interactiveHandler calls only cancelRequest (no sendResponse) on
      // those paths, so without this the server stays on requires_action.
      transport.reportState('running')
      void transport.write(event)
      logForDebugging(
        `[remote-bridge] Sent control_cancel_request request_id=${requestId}`,
      )
    },
    sendResult() {
// sendResult：发结果并置 idle。
      if (authRecoveryInFlight) {
        logForDebugging('[remote-bridge] Dropping result during 401 recovery')
        return
      }
      transport.reportState('idle')
      void transport.write(makeResultMessage(sessionId))
      logForDebugging(`[remote-bridge] Sent result`)
    },
    async teardown() {
// 句柄级 teardown：先注销清理钩子再调内部 teardown。
      unregister()
      await teardown()
    },
  }
}

// ─── Session API (v2 /code/sessions, no env) ─────────────────────────────────
// 会话 API 段：v2 /code/sessions（无 env）相关函数。

/** Retry an async init call with exponential backoff + jitter. */
// withRetry：指数退避 + 抖动重试某个返回 T|null 的初始化调用，到上限仍 null 则返回 null。
async function withRetry<T>(
  fn: () => Promise<T | null>,
  label: string,
  cfg: EnvLessBridgeConfig,
): Promise<T | null> {
  const max = cfg.init_retry_max_attempts
  for (let attempt = 1; attempt <= max; attempt++) {
    const result = await fn()
    if (result !== null) return result
    if (attempt < max) {
      const base = cfg.init_retry_base_delay_ms * 2 ** (attempt - 1)
      const jitter =
        base * cfg.init_retry_jitter_fraction * (2 * Math.random() - 1)
      const delay = Math.min(base + jitter, cfg.init_retry_max_delay_ms)
      logForDebugging(
        `[remote-bridge] ${label} failed (attempt ${attempt}/${max}), retrying in ${Math.round(delay)}ms`,
      )
      await sleep(delay)
    }
  }
  return null
}

// Moved to codeSessionApi.ts so the SDK /bridge subpath can bundle them
// without pulling in this file's heavy CLI tree (analytics, transport).
export {
  createCodeSession,
  type RemoteCredentials,
} from './codeSessionApi.js'
import {
  createCodeSession,
  fetchRemoteCredentials as fetchRemoteCredentialsRaw,
  type RemoteCredentials,
} from './codeSessionApi.js'
import { getBridgeBaseUrlOverride } from './bridgeConfig.js'

// CLI-side wrapper that applies the CLAUDE_BRIDGE_BASE_URL dev override and
// injects the trusted-device token (both are env/GrowthBook reads that the
// SDK-facing codeSessionApi.ts export must stay free of).
// CLI 侧包装 fetchRemoteCredentials：套用 CLAUDE_BRIDGE_BASE_URL 开发覆盖并注入可信设备令牌，这两样都是 env/GrowthBook 读取，SDK 面向的 codeSessionApi.ts 导出必须保持纯净。
// fetchRemoteCredentials（导出版）：在原始拉取之上应用 base url 覆盖（有覆盖就把 api_base_url 换成 baseUrl）并注入可信设备令牌。
export async function fetchRemoteCredentials(
  sessionId: string,
  baseUrl: string,
  accessToken: string,
  timeoutMs: number,
): Promise<RemoteCredentials | null> {
  const creds = await fetchRemoteCredentialsRaw(
    sessionId,
    baseUrl,
    accessToken,
    timeoutMs,
    getTrustedDeviceToken(),
  )
  if (!creds) return null
  return getBridgeBaseUrlOverride()
    ? { ...creds, api_base_url: baseUrl }
    : creds
}

type ArchiveStatus = number | 'timeout' | 'error' | 'no_token'
// ArchiveStatus：归档返回类型，HTTP 状态码或 『timeout』『error』『no_token』。

// Single categorical for BQ `GROUP BY archive_status`. The booleans on
// _teardown predate this and are redundant with it (except archive_timeout,
// which distinguishes ECONNABORTED from other network errors — both map to
// 'network_error' here since the dominant cause in a 1.5s window is timeout).
type ArchiveTelemetryStatus =
  | 'ok'
  | 'skipped_no_token'
  | 'network_error'
  | 'server_4xx'
  | 'server_5xx'

// ArchiveTelemetryStatus：归档遥测分类，供 BigQuery 按 archive_status 聚合；比 teardown 上的若干布尔更统一（仅 archive_timeout 区分 ECONNABORTED 与其他网络错误）。
// archiveSession：调 /v1/sessions/{compatId}/archive 归档会话。
async function archiveSession(
  sessionId: string,
  baseUrl: string,
  accessToken: string | undefined,
  orgUUID: string,
  timeoutMs: number,
): Promise<ArchiveStatus> {
  if (!accessToken) return 'no_token'
// 无访问令牌直接返回 『no_token』 跳过归档。
  // Archive lives at the compat layer (/v1/sessions/*, not /v1/code/sessions).
  // compat.parseSessionID only accepts TagSession (session_*), so retag cse_*.
  // anthropic-beta + x-organization-uuid are required — without them the
  // compat gateway 404s before reaching the handler.
  //
  // Unlike bridgeMain.ts (which caches compatId in sessionCompatIds to keep
  // in-memory titledSessions/logger keys consistent across a mid-session
  // gate flip), this compatId is only a server URL path segment — no
  // in-memory state. Fresh compute matches whatever the server currently
  // validates: if the gate is OFF, the server has been updated to accept
  // cse_* and we correctly send it.
  const compatId = toCompatSessionId(sessionId)
// 归档走兼容层（/v1/sessions/* 而非 /v1/code/sessions/*）；compat.parseSessionID 只接受 TagSession（session_*），故把 cse_* 重打标签。anthropic-beta 与 x-organization-uuid 必填，否则兼容网关 404。
  try {
    const response = await axios.post(
      `${baseUrl}/v1/sessions/${compatId}/archive`,
      {},
      {
        headers: {
          ...oauthHeaders(accessToken),
          'anthropic-beta': 'ccr-byoc-2025-07-29',
          'x-organization-uuid': orgUUID,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
      },
    )
    logForDebugging(
      `[remote-bridge] Archive ${compatId} status=${response.status}`,
    )
    return response.status
  } catch (err) {
    const msg = errorMessage(err)
    logForDebugging(`[remote-bridge] Archive failed: ${msg}`)
    return axios.isAxiosError(err) && err.code === 'ECONNABORTED'
      ? 'timeout'
      : 'error'
  }
}
