// 整份文件禁止 organizeImports：注释里那些 ANT-ONLY 标记本身就是 import 排序的依据，重排会打乱它们，这是 codegen 与人工维护共存的妥协
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
// 导入面很宽，但每一条都有理由：bridgeApi（HTTP）、bridgeMessaging（消息协议）、workSecret（工作凭据）、replBridgeTransport（v1/v2 传输适配）、capacityWake（容量唤醒）、flushGate（初始历史冲刷闸门）
import { randomUUID } from 'crypto'
import {
  createBridgeApiClient,
  BridgeFatalError,
  isExpiredErrorType,
  isSuppressible403,
} from './bridgeApi.js'
import type { BridgeConfig, BridgeApiClient } from './types.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import {
  handleIngressMessage,
  handleServerControlRequest,
  makeResultMessage,
  isEligibleBridgeMessage,
  extractTitleText,
  BoundedUUIDSet,
} from './bridgeMessaging.js'
import {
  decodeWorkSecret,
  buildSdkUrl,
  buildCCRv2SdkUrl,
  sameSessionId,
} from './workSecret.js'
import { toCompatSessionId, toInfraSessionId } from './sessionIdCompat.js'
import { updateSessionBridgeId } from '../utils/concurrentSessions.js'
import { getTrustedDeviceToken } from './trustedDevice.js'
import { HybridTransport } from '../cli/transports/HybridTransport.js'
import {
  type ReplBridgeTransport,
  createV1ReplTransport,
  createV2ReplTransport,
} from './replBridgeTransport.js'
import { updateSessionIngressAuthToken } from '../utils/sessionIngressAuth.js'
import { isEnvTruthy, isInProtectedNamespace } from '../utils/envUtils.js'
import { validateBridgeId } from './bridgeApi.js'
import {
  describeAxiosError,
  extractHttpStatus,
  logBridgeSkip,
} from './debugUtils.js'
import type { Message } from '../types/message.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { createCapacityWake, type CapacitySignal } from './capacityWake.js'
import { FlushGate } from './flushGate.js'
import {
  DEFAULT_POLL_CONFIG,
  type PollIntervalConfig,
} from './pollConfigDefaults.js'
import { errorMessage } from '../utils/errors.js'
import { sleep } from '../utils/sleep.js'
import {
  wrapApiForFaultInjection,
  registerBridgeDebugHandle,
  clearBridgeDebugHandle,
  injectBridgeFault,
} from './bridgeDebug.js'

// ReplBridgeHandle 是 REPL 侧唯一的写入口：写消息、发控制请求、发结果、拆除。所有方法内部都先判 transport 是否存在，因为传输会随工作项反复重建
export type ReplBridgeHandle = {
  bridgeSessionId: string
  environmentId: string
  sessionIngressUrl: string
  writeMessages(messages: Message[]): void
  writeSdkMessages(messages: SDKMessage[]): void
  sendControlRequest(request: SDKControlRequest): void
  sendControlResponse(response: SDKControlResponse): void
  sendControlCancelRequest(requestId: string): void
  sendResult(): void
  teardown(): Promise<void>
}

// 四个状态构成 UI 可见的状态机：ready（已注册待工作）→ connected（传输已连）→ reconnecting（断了在救）→ failed（放弃）。注意没有 idle——注册成功即 ready
export type BridgeState = 'ready' | 'connected' | 'reconnecting' | 'failed'

// BridgeCoreParams 是刻意「去 bootstrap 化」的产物：initReplBridge 原本要从全局状态读 cwd、会话 ID、git、OAuth，这里全部改成显式字段，好让不跑 main.tsx 的守护进程（Agent SDK）也能直接用
/**
 * Explicit-param input to initBridgeCore. Everything initReplBridge reads
 * from bootstrap state (cwd, session ID, git, OAuth) becomes a field here.
 * A daemon caller (Agent SDK, PR 4) that never runs main.tsx fills these
 * in itself.
 */
export type BridgeCoreParams = {
  dir: string
  machineName: string
  branch: string
  gitRepoUrl: string | null
  title: string
  baseUrl: string
  sessionIngressUrl: string
  /**
   * Opaque string sent as metadata.worker_type. Use BridgeWorkerType for
   * the two CLI-originated values; daemon callers may send any string the
   * backend recognizes (it's just a filter key on the web side).
   */
  workerType: string
// getAccessToken 用函数而不是值：OAuth token 会过期，每次用的时候现取，才能拿到刷新后的新值
  getAccessToken: () => string | undefined
  /**
   * POST /v1/sessions. Injected because `createSession.ts` lazy-loads
   * `auth.ts`/`model.ts`/`oauth/client.ts` and `bun --outfile` inlines
   * dynamic imports — the lazy-load doesn't help, the whole REPL tree ends
   * up in the Agent SDK bundle.
   *
   * REPL wrapper passes `createBridgeSession` from `createSession.ts`.
   * Daemon wrapper passes `createBridgeSessionLean` from `sessionApi.ts`
   * (HTTP-only, orgUUID+model supplied by the daemon caller).
   *
   * Receives `gitRepoUrl`+`branch` so the REPL wrapper can build the git
   * source/outcome for claude.ai's session card. Daemon ignores them.
   */
// createSession 与下面的 archiveSession 都是注入的，原因写在注释里：createSession.ts 会惰性加载 auth/model/oauth，而 bun --outfile 会把动态导入也内联——惰性加载根本没省下体积，整个 REPL 树还是被打进了 Agent SDK 包。改成注入，守护进程那边就只依赖一个纯 HTTP 的轻量实现
  createSession: (opts: {
    environmentId: string
    title: string
    gitRepoUrl: string | null
    branch: string
    signal: AbortSignal
  }) => Promise<string | null>
// archiveSession 的契约是「绝不抛异常」：它在拆除路径上被调用，那里已经在赶时间（整体预算 2 秒），再抛错只会把清理流程打断
  /**
   * POST /v1/sessions/{id}/archive. Same injection rationale. Best-effort;
   * the callback MUST NOT throw.
   */
  archiveSession: (sessionId: string) => Promise<void>
  /**
   * Invoked on reconnect-after-env-lost to refresh the title. REPL wrapper
   * reads session storage (picks up /rename); daemon returns the static
   * title. Defaults to () => title.
   */
  getCurrentTitle?: () => string
// getCurrentTitle 只在「环境丢失后重建会话」时用到：用户可能在会话中途 /rename，重建时得带上新标题，否则 web 卡片会退回初始标题
  /**
   * Converts internal Message[] → SDKMessage[] for writeMessages() and the
   * initial-flush/drain paths. REPL wrapper passes the real toSDKMessages
   * from utils/messages/mappers.ts. Daemon callers that only use
   * writeSdkMessages() and pass no initialMessages can omit this — those
   * code paths are unreachable.
   *
   * Injected rather than imported because mappers.ts transitively pulls in
   * src/commands.ts via messages.ts → api.ts → prompts.ts, dragging the
   * entire command registry + React tree into the Agent SDK bundle.
   */
// toSDKMessages 同样是注入：mappers.ts 会经 messages.ts → api.ts → prompts.ts 把整个命令注册表加 React 树拖进 Agent SDK 包。守护进程只用 writeSdkMessages，压根走不到这条路，所以默认实现是「抛错」而不是「空数组」——静默返回空会让消息凭空消失
  toSDKMessages?: (messages: Message[]) => SDKMessage[]
  /**
   * OAuth 401 refresh handler passed to createBridgeApiClient. REPL wrapper
   * passes handleOAuth401Error; daemon passes its AuthManager's handler.
   * Injected because utils/auth.ts transitively pulls in the command
   * registry via config.ts → file.ts → permissions/filesystem.ts →
   * sessionStorage.ts → commands.ts.
   */
// onAuth401 注入的理由同上：utils/auth.ts 会经 config.ts 链条把命令注册表拖进来
  onAuth401?: (staleAccessToken: string) => Promise<boolean>
  /**
   * Poll interval config getter for the work-poll heartbeat loop. REPL
   * wrapper passes the GrowthBook-backed getPollIntervalConfig (allows ops
   * to live-tune poll rates fleet-wide). Daemon passes a static config
   * with a 60s heartbeat (5× headroom under the 300s work-lease TTL).
   * Injected because growthbook.ts transitively pulls in the command
   * registry via the same config.ts chain.
   */
// poll 间隔配置注入，是为了让运维能通过 GrowthBook 全网实时调轮询频率；守护进程传静态配置（60 秒心跳，比 300 秒的工作租约留 5 倍余量）
  getPollIntervalConfig?: () => PollIntervalConfig
  /**
   * Max initial messages to replay on connect. REPL wrapper reads from the
   * tengu_bridge_initial_history_cap GrowthBook flag. Daemon passes no
   * initialMessages so this is never read. Default 200 matches the flag
   * default.
   */
  initialHistoryCap?: number
  // Same REPL-flush machinery as InitBridgeOptions — daemon omits these.
  initialMessages?: Message[]
  previouslyFlushedUUIDs?: Set<string>
  onInboundMessage?: (msg: SDKMessage) => void
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
// onSetPermissionMode 返回「判决」而不是直接改状态，原因注释写得很重：transitionPermissionMode 内部的 auto 门控是「防御性抛错」而不是优雅拦截，而且它是先 setAutoModeActive(true) 再抛——一旦抛出逃逸到这里，CLAUDE.md 里写的三方不变量就被破坏了。所以判据必须由调用方在调用之前把好
  /**
   * Returns a policy verdict so this module can emit an error control_response
   * without importing the policy checks itself (bootstrap-isolation constraint).
   * The callback must guard `auto` (isAutoModeGateEnabled) and
   * `bypassPermissions` (isBypassPermissionsModeDisabled AND
   * isBypassPermissionsModeAvailable) BEFORE calling transitionPermissionMode —
   * that function's internal auto-gate check is a defensive throw, not a
   * graceful guard, and its side-effect order is setAutoModeActive(true) then
   * throw, which corrupts the 3-way invariant documented in src/CLAUDE.md if
   * the callback lets the throw escape here.
   */
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
// onUserMessage 的回调契约是「返回 true 表示不用再问了」：调用方掌握「在第 1 条与第 3 条消息时各试一次」这样的策略，传输层只负责持续调用直到被告知停止
  /**
   * Fires on each real user message to flow through writeMessages() until
   * the callback returns true (done). Mirrors remoteBridgeCore.ts's
   * onUserMessage so the REPL bridge can derive a session title from early
   * prompts when none was set at init time (e.g. user runs /remote-control
   * on an empty conversation, then types). Tool-result wrappers, meta
   * messages, and display-tag-only messages are skipped. Receives
   * currentSessionId so the wrapper can PATCH the title without a closure
   * dance to reach the not-yet-returned handle. The caller owns the
   * derive-at-count-1-and-3 policy; the transport just keeps calling until
   * told to stop. Not fired for the writeSdkMessages daemon path (daemon
   * sets its own title at init). Distinct from SessionSpawnOpts's
   * onFirstUserMessage (spawn-bridge, PR #21250), which stays fire-once.
   */
  onUserMessage?: (text: string, sessionId: string) => boolean
  /** See InitBridgeOptions.perpetual. */
  perpetual?: boolean
// initialSSESequenceNum 是跨进程续接的关键：SSE 事件流的高水位线。守护进程在关闭时持久化、下次启动再传回来，第一次连接就能带上 from_sequence_num，服务端不会重放全部历史
  /**
   * Seeds lastTransportSequenceNum — the SSE event-stream high-water mark
   * that's carried across transport swaps within one process. Daemon callers
   * pass the value they persisted at shutdown so the FIRST SSE connect of a
   * fresh process sends from_sequence_num and the server doesn't replay full
   * history. REPL callers omit (fresh session each run → 0 is correct).
   */
  initialSSESequenceNum?: number
}

/**
 * Superset of ReplBridgeHandle. Adds getSSESequenceNum for daemon callers
 * that persist the SSE seq-num across process restarts and pass it back as
 * initialSSESequenceNum on the next start.
 */
export type BridgeCoreHandle = ReplBridgeHandle & {
  /**
   * Current SSE sequence-number high-water mark. Updates as transports
   * swap. Daemon callers persist this on shutdown and pass it back as
   * initialSSESequenceNum on next start.
   */
  getSSESequenceNum(): number
}

// 三个 poll 退避常量。放弃阈值刻意设到 15 分钟——服务端才是「这个会话真死了」的权威，只要它还在接受轮询，就继续等它重新派发工作项
/**
 * Poll error recovery constants. When the work poll starts failing (e.g.
 * server 500s), we use exponential backoff and give up after this timeout.
 * This is deliberately long — the server is the authority on when a session
 * is truly dead. As long as the server accepts our poll, we keep waiting
 * for it to re-dispatch the work item.
 */
const POLL_ERROR_INITIAL_DELAY_MS = 2_000
const POLL_ERROR_MAX_DELAY_MS = 60_000
const POLL_ERROR_GIVE_UP_MS = 15 * 60 * 1000

// 自增序号只用于日志里区分多次 init 调用（同一进程可能反复进出远程控制），不参与任何业务判断
// Monotonically increasing counter for distinguishing init calls in logs
let initSequence = 0

/**
 * Bootstrap-free core: env registration → session creation → poll loop →
 * ingress WS → teardown. Reads nothing from bootstrap/state or
 * sessionStorage — all context comes from params. Caller (initReplBridge
 * below, or a daemon in PR 4) has already passed entitlement gates and
 * gathered git/auth/title.
 *
 * Returns null on registration or session-creation failure.
 */
// initBridgeCore 是「无 bootstrap 依赖」的核心：注册环境 → 建会话 → 起轮询 → 连入口 WebSocket → 拆除。它不读 bootstrap/state 也不读 sessionStorage，全部上下文来自参数；注册或建会话失败返回 null
export async function initBridgeCore(
  params: BridgeCoreParams,
): Promise<BridgeCoreHandle | null> {
// 解构时就地给默认值，而不是在函数体里逐个别写 if：默认值本身也是文档——toSDKMessages 的默认实现是抛错（见上），poll 配置默认走 DEFAULT_POLL_CONFIG，历史条数上限默认 200（与 GrowthBook 开关的默认值一致）
  const {
    dir,
    machineName,
    branch,
    gitRepoUrl,
    title,
    baseUrl,
    sessionIngressUrl,
    workerType,
    getAccessToken,
    createSession,
    archiveSession,
    getCurrentTitle = () => title,
    toSDKMessages = () => {
      throw new Error(
        'BridgeCoreParams.toSDKMessages not provided. Pass it if you use writeMessages() or initialMessages — daemon callers that only use writeSdkMessages() never hit this path.',
      )
    },
    onAuth401,
    getPollIntervalConfig = () => DEFAULT_POLL_CONFIG,
    initialHistoryCap = 200,
    initialMessages,
    previouslyFlushedUUIDs,
    onInboundMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    onUserMessage,
    perpetual,
    initialSSESequenceNum = 0,
  } = params

// 序号在真正开始任何异步操作之前取，这样并发两次 init 的日志顺序就是可判读的
  const seq = ++initSequence

  // bridgePointer import hoisted: perpetual mode reads it before register;
  // non-perpetual writes it after session create; both use clear at teardown.
// bridgePointer 用动态导入而不是顶层 import：顶层会形成循环依赖（bridgePointer 依赖 bridgeApi，bridgeApi 又依赖本模块的类型）。写在函数里且只为拿三个函数，代价可以忽略
  const { writeBridgePointer, clearBridgePointer, readBridgePointer } =
    await import('./bridgePointer.js')

// perpetual（常驻）模式是唯一读崩溃恢复指针的路径：指针里存着上次的 environmentId 与会话 ID，先当作「前次状态」，后面尝试原地重连
  // Perpetual mode: read the crash-recovery pointer and treat it as prior
  // state. The pointer is written unconditionally after session create
  // (crash-recovery for all sessions); perpetual mode just skips the
  // teardown clear so it survives clean exits too. Only reuse 'repl'
  // pointers — a crashed standalone bridge (`claude remote-control`)
  // writes source:'standalone' with a different workerType.
// 只复用 source 为 repl 的指针：独立桥（claude remote-control）写的是 source:standalone 且 workerType 不同，两边的环境不能混用，否则会连到一个语义完全不同的会话上
  const rawPrior = perpetual ? await readBridgePointer(dir) : null
  const prior = rawPrior?.source === 'repl' ? rawPrior : null

  logForDebugging(
    `[bridge:repl] initBridgeCore #${seq} starting (initialMessages=${initialMessages?.length ?? 0}${prior ? ` perpetual prior=env:${prior.environmentId}` : ''})`,
  )

// 创建 HTTP 客户端。runnerVersion 取自构建期宏 MACRO.VERSION，onDebug 直接接到 logForDebugging，onAuth401 由调用方注入
  // 5. Register bridge environment
  const rawApi = createBridgeApiClient({
    baseUrl,
    getAccessToken,
    runnerVersion: MACRO.VERSION,
    onDebug: logForDebugging,
    onAuth401,
    getTrustedDeviceToken,
  })
// 仅 ANT 内网构建：在客户端外面包一层故障注入垫片，让 /bridge-kick 能人为制造轮询/注册/心跳失败。外部构建里 rawApi 原样通过，零成本
  // Ant-only: interpose so /bridge-kick can inject poll/register/heartbeat
  // failures. Zero cost in external builds (rawApi passes through unchanged).
  const api =
    process.env.USER_TYPE === 'ant' ? wrapApiForFaultInjection(rawApi) : rawApi

// BridgeConfig 每次 init 都新建：bridgeId 与 environmentId 都是新 UUID，只有 reuseEnvironmentId 可能带上历史值（常驻模式重连时用）
  const bridgeConfig: BridgeConfig = {
    dir,
    machineName,
    branch,
    gitRepoUrl,
    maxSessions: 1,
    spawnMode: 'single-session',
    verbose: false,
    sandbox: false,
    bridgeId: randomUUID(),
    workerType,
    environmentId: randomUUID(),
    reuseEnvironmentId: prior?.environmentId,
    apiBaseUrl: baseUrl,
    sessionIngressUrl,
  }

  let environmentId: string
  let environmentSecret: string
// 注册环境是这个函数唯一「失败就返回 null」的硬失败点：注册不上就什么都没得做
  try {
    const reg = await api.registerBridgeEnvironment(bridgeConfig)
    environmentId = reg.environment_id
    environmentSecret = reg.environment_secret
  } catch (err) {
// 失败时先用 logBridgeSkip 记一条结构化跳过原因（这是运维统计「为什么没起来」的主要来源），再判断要不要清指针——指针可能正是指向一个已经被删除的环境，不清掉下次启动还会拿同一个死 ID 去撞
    logBridgeSkip(
      'registration_failed',
      `[bridge:repl] Environment registration failed: ${errorMessage(err)}`,
    )
    // Stale pointer may be the cause (expired/deleted env) — clear it so
    // the next start doesn't retry the same dead ID.
    if (prior) {
      await clearBridgePointer(dir)
    }
    onStateChange?.('failed', errorMessage(err))
    return null
  }

  logForDebugging(`[bridge:repl] Environment registered: ${environmentId}`)
  logForDiagnosticsNoPII('info', 'bridge_repl_env_registered')
  logEvent('tengu_bridge_repl_env_registered', {})

  /**
   * Reconnect-in-place: if the just-registered environmentId matches what
   * was requested, call reconnectSession to force-stop stale workers and
   * re-queue the session. Used at init (perpetual mode — env is alive but
   * idle after clean teardown) and in doReconnect() Strategy 1 (env lost
   * then resurrected). Returns true on success; caller falls back to
   * fresh session creation on false.
   */
// tryReconnectInPlace：先确认「服务端给回来的环境 ID」与「我们想要的那个」一致，一致才谈得上原地重连；不一致说明老环境真没了，调用方只能走新建会话
  async function tryReconnectInPlace(
    requestedEnvId: string,
    sessionId: string,
  ): Promise<boolean> {
    if (environmentId !== requestedEnvId) {
      logForDebugging(
        `[bridge:repl] Env mismatch (requested ${requestedEnvId}, got ${environmentId}) — cannot reconnect in place`,
      )
      return false
    }
// 这里有一段很细的兼容性推理：指针里存的是 createBridgeSession 返回的 session_* 形式，而 /bridge/reconnect 是环境层接口，在服务端 ccr_v2_compat_enabled 打开后只认基础设施层的 cse_* 形式，对 session_* 会返回「会话不存在」。因为拿不到开关状态，只能两种形式都试一遍
    // The pointer stores what createBridgeSession returned (session_*,
    // compat/convert.go:41). /bridge/reconnect is an environments-layer
    // endpoint — once the server's ccr_v2_compat_enabled gate is on it
    // looks sessions up by their infra tag (cse_*) and returns "Session
    // not found" for the session_* costume. We don't know the gate state
    // pre-poll, so try both; the re-tag is a no-op if the ID is already
    // cse_* (doReconnect Strategy 1 path — currentSessionId never mutates
    // to cse_* but future-proof the check).
    const infraId = toInfraSessionId(sessionId)
// toInfraSessionId 是纯字符串改写（同 UUID 换前缀），所以两种形式相同时只试一次；注释里还留了一句「未来若 currentSessionId 会变成 cse_*，这个判断仍然成立」
    const candidates =
      infraId === sessionId ? [sessionId] : [sessionId, infraId]
    for (const id of candidates) {
      try {
        await api.reconnectSession(environmentId, id)
        logForDebugging(
          `[bridge:repl] Reconnected session ${id} in place on env ${environmentId}`,
        )
        return true
      } catch (err) {
        logForDebugging(
          `[bridge:repl] reconnectSession(${id}) failed: ${errorMessage(err)}`,
        )
      }
    }
    logForDebugging(
      '[bridge:repl] reconnectSession exhausted — falling through to fresh session',
    )
    return false
  }

  // Perpetual init: env is alive but has no queued work after clean
  // teardown. reconnectSession re-queues it. doReconnect() has the same
  // call but only fires on poll 404 (env dead);
  // here the env is alive but idle.
// 常驻模式初始化时环境其实还活着，只是清退之后没有排队的工作项——reconnectSession 的作用就是把它重新排上队。doReconnect 里也有同样的调用，但那里只在轮询 404（环境已死）时触发
  const reusedPriorSession = prior
    ? await tryReconnectInPlace(prior.environmentId, prior.sessionId)
    : false
  if (prior && !reusedPriorSession) {
    await clearBridgePointer(dir)
  }

// 关键设计：初始消息不作为「会话创建事件」发送。原因是这类事件用 STREAM_ONLY 持久化且发布时机早于 CCR 界面订阅，必然丢失；所以初始历史改由入口 WebSocket 连上之后再冲刷
  // 6. Create session on the bridge. Initial messages are NOT included as
  // session creation events because those use STREAM_ONLY persistence and
  // are published before the CCR UI subscribes, so they get lost. Instead,
  // initial messages are flushed via the ingress WebSocket once it connects.

  // Mutable session ID — updated when the environment+session pair is
  // re-created after a connection loss.
  let currentSessionId: string


// 两条分岔：复用了常驻会话就直接用回原 ID，否则新建。复用分支还要把初始消息全部塞进 previouslyFlushedUUIDs——服务端上一次运行已经收过这些消息，重复 UUID 会导致服务端直接杀掉 WebSocket
  if (reusedPriorSession && prior) {
    currentSessionId = prior.sessionId
    logForDebugging(
      `[bridge:repl] Perpetual session reused: ${currentSessionId}`,
    )
    // Server already has all initialMessages from the prior CLI run. Mark
    // them as previously-flushed so the initial flush filter excludes them
    // (previouslyFlushedUUIDs is a fresh Set on every CLI start). Duplicate
    // UUIDs cause the server to kill the WebSocket.
    if (initialMessages && previouslyFlushedUUIDs) {
      for (const msg of initialMessages) {
        previouslyFlushedUUIDs.add(msg.uuid)
      }
    }
  } else {
    const createdSessionId = await createSession({
      environmentId,
      title,
      gitRepoUrl,
      branch,
      signal: AbortSignal.timeout(15_000),
    })

// 建会话失败要把环境注销掉再返回 null，否则会留下一个注册了但永远不会被使用的环境（服务端会一直为它保留资源直到 TTL）
    if (!createdSessionId) {
      logForDebugging(
        '[bridge:repl] Session creation failed, deregistering environment',
      )
      logEvent('tengu_bridge_repl_session_failed', {})
      await api.deregisterEnvironment(environmentId).catch(() => {})
      onStateChange?.('failed', 'Session creation failed')
      return null
    }

    currentSessionId = createdSessionId
    logForDebugging(`[bridge:repl] Session created: ${currentSessionId}`)
  }

// 崩溃恢复指针在会话创建之后立刻写：从这一刻起到拆除之前，任何 kill -9 都会留下可恢复的线索，claude remote-control --continue 会读它并提示续接
  // Crash-recovery pointer: written now so a kill -9 at any point after
  // this leaves a recoverable trail. Cleared in teardown (non-perpetual)
  // or left alone (perpetual mode — pointer survives clean exit too).
  // `claude remote-control --continue` from the same directory will detect
  // it and offer to resume.
  await writeBridgePointer(dir, {
    sessionId: currentSessionId,
    environmentId,
    source: 'repl',
  })
  logForDiagnosticsNoPII('info', 'bridge_repl_session_created')
  logEvent('tengu_bridge_repl_started', {
    has_initial_messages: !!(initialMessages && initialMessages.length > 0),
    inProtectedNamespace: isInProtectedNamespace(),
  })

// 两份 UUID 集合各有分工：initialMessageUUIDs 用于 writeMessages 的去重（这些消息已经在历史冲刷里发过了），recentPostedUUIDs 是有界环形缓冲，负责回声过滤与二级去重
  // UUIDs of initial messages. Used for dedup in writeMessages to avoid
  // re-sending messages that were already flushed on WebSocket open.
  const initialMessageUUIDs = new Set<string>()
  if (initialMessages) {
    for (const msg of initialMessages) {
      initialMessageUUIDs.add(msg.uuid)
    }
  }

// 环形缓冲容量 2000：回声在毫秒级就会回来，2000 远超任何现实回声窗口，也覆盖压缩之后重新遇到的老消息。真正的主去重是 hook 里的 lastWrittenIndexRef，这只是安全网
  // Bounded ring buffer of UUIDs for messages we've already sent to the
  // server via the ingress WebSocket. Serves two purposes:
  //  1. Echo filtering — ignore our own messages bouncing back on the WS.
  //  2. Secondary dedup in writeMessages — catch race conditions where
  //     the hook's index-based tracking isn't sufficient.
  //
  // Seeded with initialMessageUUIDs so that when the server echoes back
  // the initial conversation context over the ingress WebSocket, those
  // messages are recognized as echoes and not re-injected into the REPL.
  //
  // Capacity of 2000 covers well over any realistic echo window (echoes
  // arrive within milliseconds) and any messages that might be re-encountered
  // after compaction. The hook's lastWrittenIndexRef is the primary dedup;
  // this is a safety net.
  const recentPostedUUIDs = new BoundedUUIDSet(2000)
  for (const uuid of initialMessageUUIDs) {
    recentPostedUUIDs.add(uuid)
  }

// 入站方向也要一份有界集合：服务端可能重投递同一条提示（序号协商失败、传输换手竞态）。上面的序号续接才是主修复手段，这份同样是安全网
  // Bounded set of INBOUND prompt UUIDs we've already forwarded to the REPL.
  // Defensive dedup for when the server re-delivers prompts (seq-num
  // negotiation failure, server edge cases, transport swap races). The
  // seq-num carryover below is the primary fix; this is the safety net.
  const recentInboundUUIDs = new BoundedUUIDSet(2000)

// 从第 7 步开始是本模块最复杂的一段：轮询循环让会话「活着」——用户在 claude.ai 上打字时，后端把工作项派发到本机环境，我们轮询拿到入口令牌，再连入口 WebSocket
  // 7. Start poll loop for work items — this is what makes the session
  // "live" on claude.ai. When a user types there, the backend dispatches
  // a work item to our environment. We poll for it, get the ingress token,
  // and connect the ingress WebSocket.
  //
  // The poll loop keeps running: when work arrives it connects the ingress
  // WebSocket, and if the WebSocket drops unexpectedly (code != 1000) it
  // resumes polling to get a fresh ingress token and reconnect.
// pollController 用一个 AbortController 统领整个生命周期：拆除时 abort 一次，轮询循环、睡眠、传输都会跟着退出
  const pollController = new AbortController()
  // Adapter over either HybridTransport (v1: WS reads + POST writes to
  // Session-Ingress) or SSETransport+CCRClient (v2: SSE reads + POST
  // writes to CCR /worker/*). The v1/v2 choice is made in onWorkReceived:
  // server-driven via secret.use_code_sessions, with CLAUDE_BRIDGE_USE_CCR_V2
  // as an ant-dev override.
// transport 是「当前入口连接」，可能为 null（还没拿到工作项，或刚断）。v1 是 HybridTransport（WS 读 + POST 写），v2 是 SSE 读 + CCR 写，用同一个适配接口包起来
  let transport: ReplBridgeTransport | null = null
// v2Generation 专治一类竞态：transport 为 null 时连来两次工作项，两次都去 registerWorker（服务端 epoch 递增），后解析出的那次才是对的——但「transport 是否为 null」这个判断把结论弄反了（先解析的装上，后解析的被丢弃）。代际号不看 transport 状态，能独立判出谁新
  // Bumped on every onWorkReceived. Captured in createV2ReplTransport's .then()
  // closure to detect stale resolutions: if two calls race while transport is
  // null, both registerWorker() (bumping server epoch), and whichever resolves
  // SECOND is the correct one — but the transport !== null check gets this
  // backwards (first-to-resolve installs, second discards). The generation
  // counter catches it independent of transport state.
  let v2Generation = 0
// SSE 序号高水位必须跨传输换手携带：不带的话每个新传输都从 0 开始，首连不发 from_sequence_num 也不带 Last-Event-ID，服务端就把整个会话历史全部重放一遍——等于每次收到工作项都把历史上所有提示重新当成新消息投进 REPL
// 但只在真的复用了前一会话时才带：如果走的是新建会话分支，调用方持久化的那个序号属于一个已死的流，硬套到从 1 开始的新流上会静默丢事件
  // SSE sequence-number high-water mark carried across transport swaps.
  // Without this, each new SSETransport starts at 0, sends no
  // from_sequence_num / Last-Event-ID on its first connect, and the server
  // replays the entire session event history — every prompt ever sent
  // re-delivered as fresh inbound messages on every onWorkReceived.
  //
  // Seed only when we actually reconnected the prior session. If
  // `reusedPriorSession` is false we fell through to `createSession()` —
  // the caller's persisted seq-num belongs to a dead session and applying
  // it to the fresh stream (starting at 1) silently drops events. Same
  // hazard as doReconnect Strategy 2; same fix as the reset there.
  let lastTransportSequenceNum = reusedPriorSession ? initialSSESequenceNum : 0
// 这一行就是上面两条结论的合成：复用才继承，否则归零
  // Track the current work ID so teardown can call stopWork
  let currentWorkId: string | null = null
  // Session ingress JWT for the current work item — used for heartbeat auth.
  let currentIngressToken: string | null = null
  // Signal to wake the at-capacity sleep early when the transport is lost,
  // so the poll loop immediately switches back to fast polling for new work.
// 容量唤醒是「打断睡眠的通道」：传输丢失时唤醒轮询循环，让它立刻从「满容量心跳模式」切回快轮询，而不是傻等 10 分钟
  const capacityWake = createCapacityWake(pollController.signal)
  const wakePollLoop = capacityWake.wake
  const capacitySignal = capacityWake.signal
  // Gates message writes during the initial flush to prevent ordering
  // races where new messages arrive at the server interleaved with history.
// 冲刷闸门：初始历史正在上传期间，把新产生的消息先排队，避免新消息与历史在服务端交错
  const flushGate = new FlushGate<Message>()

  // Latch for onUserMessage — flips true when the callback returns true
  // (policy says "done deriving"). If no callback, skip scanning entirely
  // (daemon path — no title derivation needed).
// 这个闩锁的初值取反很关键：没有回调（守护进程路径）就直接标记「已完成」，连扫描都省了
  let userMessageCallbackDone = !onUserMessage

  // Shared counter for environment re-creations, used by both
  // onEnvironmentLost and the abnormal-close handler.
// 环境重建次数上限 3 次，且只在「短时间内连续失败」时计数——成功轮询会把它清零，避免隔几小时一次的独立重连把终身配额耗光
  const MAX_ENVIRONMENT_RECREATIONS = 3
  let environmentRecreations = 0
  let reconnectPromise: Promise<boolean> | null = null

  /**
   * Recover from onEnvironmentLost (poll returned 404 — env was reaped
   * server-side). Tries two strategies in order:
   *
   *   1. Reconnect-in-place: idempotent re-register with reuseEnvironmentId
   *      → if the backend returns the same env ID, call reconnectSession()
   *      to re-queue the existing session. currentSessionId stays the same;
   *      the URL on the user's phone stays valid; previouslyFlushedUUIDs is
   *      preserved so history isn't re-sent.
   *
   *   2. Fresh session fallback: if the backend returns a different env ID
   *      (original TTL-expired, e.g. laptop slept >4h) or reconnectSession()
   *      throws, archive the old session and create a new one on the
   *      now-registered env. Old behavior before #20460 primitives landed.
   *
   * Uses a promise-based reentrancy guard so concurrent callers share the
   * same reconnection attempt.
   */
// 基于 Promise 的重入保护：并发的多个调用方（WebSocket 关闭处理、轮询 404、调试命令）共享同一次重连尝试，而不是各起一套
  async function reconnectEnvironmentWithSession(): Promise<boolean> {
    if (reconnectPromise) {
      return reconnectPromise
    }
    reconnectPromise = doReconnect()
    try {
      return await reconnectPromise
    } finally {
      reconnectPromise = null
    }
  }

// doReconnect 是本模块最长的一段，做四件事：作废在途的 v2 握手、关掉旧传输并记下序号、按两种策略重建（原地重连 / 新建会话）、把每个 await 之后的状态重新校验一遍
  async function doReconnect(): Promise<boolean> {
    environmentRecreations++
    // Invalidate any in-flight v2 handshake — the environment is being
    // recreated, so a stale transport arriving post-reconnect would be
    // pointed at a dead session.
    v2Generation++
    logForDebugging(
      `[bridge:repl] Reconnecting after env lost (attempt ${environmentRecreations}/${MAX_ENVIRONMENT_RECREATIONS})`,
    )

    if (environmentRecreations > MAX_ENVIRONMENT_RECREATIONS) {
      logForDebugging(
        `[bridge:repl] Environment reconnect limit reached (${MAX_ENVIRONMENT_RECREATIONS}), giving up`,
      )
      return false
    }

// 关闭旧传输之前先取序号：策略 1 成功时会话不变，下一个传输必须从这个位置续上，而不是从上次换手的检查点重放
    // Close the stale transport. Capture seq BEFORE close — if Strategy 1
    // (tryReconnectInPlace) succeeds we keep the SAME session, and the
    // next transport must resume where this one left off, not replay from
    // the last transport-swap checkpoint.
    if (transport) {
      const seq = transport.getLastSequenceNum()
      if (seq > lastTransportSequenceNum) {
        lastTransportSequenceNum = seq
      }
      transport.close()
      transport = null
    }
// 传输没了必须唤醒轮询循环，否则它还在「满容量」的假设下睡 10 分钟——而实际上现在完全有空接新工作
    // Transport is gone — wake the poll loop out of its at-capacity
    // heartbeat sleep so it can fast-poll for re-dispatched work.
    wakePollLoop()
    // Reset flush gate so writeMessages() hits the !transport guard
    // instead of silently queuing into a dead buffer.
// 闸门里的待发消息要丢掉而不是保留：旧传输已经死了，留着只会在新传输上错序
    flushGate.drop()

    // Release the current work item (force=false — we may want the session
    // back). Best-effort: the env is probably gone, so this likely 404s.
    if (currentWorkId) {
      const workIdBeingCleared = currentWorkId
      await api
        .stopWork(environmentId, workIdBeingCleared, false)
        .catch(() => {})
// 这里处理一个很隐蔽的竞态：doReconnect 与轮询循环并发运行时（WebSocket 关闭是不 await 直接调的），在 stopWork 的 await 期间可能收到新工作项并设置了新的 currentWorkId。此时轮询循环已经自己恢复了，再往下走 archiveSession 会把新传输正连着的会话毁掉
      // When doReconnect runs concurrently with the poll loop (ws_closed
      // handler case — void-called, unlike the awaited onEnvironmentLost
      // path), onWorkReceived can fire during the stopWork await and set
      // a fresh currentWorkId. If it did, the poll loop has already
      // recovered on its own — defer to it rather than proceeding to
      // archiveSession, which would destroy the session its new
      // transport is connected to.
// 判据就是「currentWorkId 变了没变」：变了说明轮询循环已接管，直接返回成功并把重建计数清零
      if (currentWorkId !== workIdBeingCleared) {
        logForDebugging(
          '[bridge:repl] Poll loop recovered during stopWork await — deferring to it',
        )
        environmentRecreations = 0
        return true
      }
      currentWorkId = null
      currentIngressToken = null
    }

    // Bail out if teardown started while we were awaiting
    if (pollController.signal.aborted) {
      logForDebugging('[bridge:repl] Reconnect aborted by teardown')
      return false
    }

// 策略 1：带着服务端下发的环境 ID 做幂等重注册。后端若能复活同一个环境（新密钥），就能原地重连已有会话；若返回不同 ID，说明原环境真没了，落到策略 2
    // Strategy 1: idempotent re-register with the server-issued env ID.
    // If the backend resurrects the same env (fresh secret), we can
    // reconnect the existing session. If it hands back a different ID, the
    // original env is truly gone and we fall through to a fresh session.
    const requestedEnvId = environmentId
    bridgeConfig.reuseEnvironmentId = requestedEnvId
    try {
      const reg = await api.registerBridgeEnvironment(bridgeConfig)
      environmentId = reg.environment_id
      environmentSecret = reg.environment_secret
    } catch (err) {
      bridgeConfig.reuseEnvironmentId = undefined
      logForDebugging(
        `[bridge:repl] Environment re-registration failed: ${errorMessage(err)}`,
      )
      return false
    }
// reuseEnvironmentId 在任何 await 之前就清掉：留着旧值会污染下一次全新注册（如果 doReconnect 再跑一轮）
    // Clear before any await — a stale value would poison the next fresh
    // registration if doReconnect runs again.
    bridgeConfig.reuseEnvironmentId = undefined

    logForDebugging(
      `[bridge:repl] Re-registered: requested=${requestedEnvId} got=${environmentId}`,
    )

    // Bail out if teardown started while we were registering
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after env registration, cleaning up',
      )
      await api.deregisterEnvironment(environmentId).catch(() => {})
      return false
    }

// 同一类竞态的更窄窗口：在 registerBridgeEnvironment 的 await 期间轮询循环可能已经装上了传输。这里必须在 tryReconnectInPlace/archiveSession 于服务端杀掉它之前退出
    // Same race as above, narrower window: poll loop may have set up a
    // transport during the registerBridgeEnvironment await. Bail before
    // tryReconnectInPlace/archiveSession kill it server-side.
    if (transport !== null) {
      logForDebugging(
        '[bridge:repl] Poll loop recovered during registerBridgeEnvironment await — deferring to it',
      )
      environmentRecreations = 0
      return true
    }

    // Strategy 1: same helper as perpetual init. currentSessionId stays
    // the same on success; URL on mobile/web stays valid;
    // previouslyFlushedUUIDs preserved (no re-flush).
    if (await tryReconnectInPlace(requestedEnvId, currentSessionId)) {
      logEvent('tengu_bridge_repl_reconnected_in_place', {})
      environmentRecreations = 0
      return true
    }
    // Env differs → TTL-expired/reaped; or reconnect failed.
    // Don't deregister — we have a fresh secret for this env either way.
    if (environmentId !== requestedEnvId) {
      logEvent('tengu_bridge_repl_env_expired_fresh_session', {})
    }

// 策略 2：在刚注册好的环境上建新会话。旧会话先归档——它已经成了孤儿（绑在死环境上，或被 reconnectSession 拒绝）。环境不要注销，因为刚拿到它的新密钥、马上要用
    // Strategy 2: fresh session on the now-registered environment.
    // Archive the old session first — it's orphaned (bound to a dead env,
    // or reconnectSession rejected it). Don't deregister the env — we just
    // got a fresh secret for it and are about to use it.
    await archiveSession(currentSessionId)

    // Bail out if teardown started while we were archiving
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after archive, cleaning up',
      )
      await api.deregisterEnvironment(environmentId).catch(() => {})
      return false
    }

// 重建会话前重读标题：用户可能已经 /rename 过，用最初捕获的标题会让 web 卡片回退
    // Re-read the current title in case the user renamed the session.
    // REPL wrapper reads session storage; daemon wrapper returns the
    // original title (nothing to refresh).
    const currentTitle = getCurrentTitle()

    // Create a new session on the now-registered environment
    const newSessionId = await createSession({
      environmentId,
      title: currentTitle,
      gitRepoUrl,
      branch,
      signal: AbortSignal.timeout(15_000),
    })

    if (!newSessionId) {
      logForDebugging(
        '[bridge:repl] Session creation failed during reconnection',
      )
      return false
    }

    // Bail out if teardown started during session creation (up to 15s)
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after session creation, cleaning up',
      )
      await archiveSession(newSessionId)
      return false
    }

// 会话 ID 换掉之后，有一串「会话作用域」的状态必须立刻重置，且必须在任何 await 之前——注释里详细写了两个 bug 的成因
    currentSessionId = newSessionId
    // Re-publish to the PID file so peer dedup (peerRegistry.ts) picks up the
    // new ID — setReplBridgeHandle only fires at init/teardown, not reconnect.
    void updateSessionBridgeId(toCompatSessionId(newSessionId)).catch(() => {})
    // Reset per-session transport state IMMEDIATELY after the session swap,
    // before any await. If this runs after `await writeBridgePointer` below,
    // there's a window where handle.bridgeSessionId already returns session B
    // but getSSESequenceNum() still returns session A's seq — a daemon
    // persistState() in that window writes {bridgeSessionId: B, seq: OLD_A},
    // which PASSES the session-ID validation check and defeats it entirely.
    //
    // The SSE seq-num is scoped to the session's event stream — carrying it
    // over leaves the transport's lastSequenceNum stuck high (seq only
    // advances when received > last), and its next internal reconnect would
    // send from_sequence_num=OLD_SEQ against a stream starting at 1 → all
    // events in the gap silently dropped. Inbound UUID dedup is also
    // session-scoped.
// 第一个：如果这段重置写在后面的 writeBridgePointer 之后，就存在一个窗口——handle.bridgeSessionId 已经返回会话 B，但 getSSESequenceNum() 还返回会话 A 的序号。守护进程在这个窗口里持久化，会写出「B 的会话 ID 配 A 的序号」，而这个组合恰好能通过会话 ID 校验，等于让校验完全失效
// 第二个：SSE 序号是会话作用域的。带着旧序号过去，传输的 lastSequenceNum 会卡在高位（只有收到更大的才前进），下一次内部重连会发 from_sequence_num=旧值，而新流从 1 开始——中间那段事件全部静默丢失。入站 UUID 去重同理
    lastTransportSequenceNum = 0
    recentInboundUUIDs.clear()
// 标题推导也是会话作用域的：如果用户在 createSession 的 await 期间打了字，回调是对着已经被归档的旧会话 ID 触发的（PATCH 丢了），而新会话拿到的是「用户打字之前」捕获的标题。重置闩锁让下一条消息能重新推导，而且这个重置是自纠正的——调用方的策略若已经完成，第一次调用就返回 true 并重新上锁
    // Title derivation is session-scoped too: if the user typed during the
    // createSession await above, the callback fired against the OLD archived
    // session ID (PATCH lost) and the new session got `currentTitle` captured
    // BEFORE they typed. Reset so the next prompt can re-derive. Self-
    // correcting: if the caller's policy is already done (explicit title or
    // count ≥ 3), it returns true on the first post-reset call and re-latches.
    userMessageCallbackDone = !onUserMessage
    logForDebugging(`[bridge:repl] Re-created session: ${currentSessionId}`)

    // Rewrite the crash-recovery pointer with the new IDs so a crash after
    // this point resumes the right session. (The reconnect-in-place path
    // above doesn't touch the pointer — same session, same env.)
    await writeBridgePointer(dir, {
      sessionId: currentSessionId,
      environmentId,
      source: 'repl',
    })

// 清空已冲刷 UUID：新会话在服务端是全新的 UUID 命名空间，重发历史是安全的，而且必须重发，否则用户在网页上看到的是空会话
    // Clear flushed UUIDs so initial messages are re-sent to the new session.
    // UUIDs are scoped per-session on the server, so re-flushing is safe.
    previouslyFlushedUUIDs?.clear()


    // Reset the counter so independent reconnections hours apart don't
    // exhaust the limit — it guards against rapid consecutive failures,
    // not lifetime total.
    environmentRecreations = 0

    return true
  }

  // Helper: get the current OAuth access token for session ingress auth.
  // Unlike the JWT path, OAuth tokens are refreshed by the standard OAuth
  // flow — no proactive scheduler needed.
// OAuth 令牌每次现取：与 JWT 不同，OAuth 有标准刷新流程，不需要额外的续期调度器
  function getOAuthToken(): string | undefined {
    return getAccessToken()
  }

  // Drain any messages that were queued during the initial flush.
  // Called after writeBatch completes (or fails) so queued messages
  // are sent in order after the historical messages.
// drainFlushGate 在初始冲刷完成（或失败）之后调用，把闸门里排队的消息按序发出去——顺序必须是「历史在前、新消息在后」，否则用户在网页上看到的消息时序是乱的
  function drainFlushGate(): void {
    const msgs = flushGate.end()
    if (msgs.length === 0) return
    if (!transport) {
      logForDebugging(
        `[bridge:repl] Cannot drain ${msgs.length} pending message(s): no transport`,
      )
      return
    }
    for (const msg of msgs) {
      recentPostedUUIDs.add(msg.uuid)
    }
    const sdkMessages = toSDKMessages(msgs)
    const events = sdkMessages.map(sdkMsg => ({
      ...sdkMsg,
      session_id: currentSessionId,
    }))
    logForDebugging(
      `[bridge:repl] Drained ${msgs.length} pending message(s) after flush`,
    )
    void transport.writeBatch(events)
  }

// doTeardownImpl 用「先声明后赋值」的方式暴露给 triggerTeardown：所有调用方都是异步回调，执行时赋值一定已经完成，所以不需要额外的空值保护
  // Teardown reference — set after definition below. All callers are async
  // callbacks that run after assignment, so the reference is always valid.
  let doTeardownImpl: (() => Promise<void>) | null = null
  function triggerTeardown(): void {
    void doTeardownImpl?.()
  }

  /**
   * Body of the transport's setOnClose callback, hoisted to initBridgeCore
   * scope so /bridge-kick can fire it directly. setOnClose wraps this with
   * a stale-transport guard; debugFireClose calls it bare.
   *
   * With autoReconnect:true, this only fires on: clean close (1000),
   * permanent server rejection (4001/1002/4003), or 10-min budget
   * exhaustion. Transient drops are retried internally by the transport.
   */
// handleTransportPermanentClose 只在三种情况下被触发：干净关闭（1000）、服务端永久拒绝（4001/1002/4003）、重连预算（10 分钟）耗尽。瞬时掉线由传输内部自己重试，不会走到这里
  function handleTransportPermanentClose(closeCode: number | undefined): void {
    logForDebugging(
      `[bridge:repl] Transport permanently closed: code=${closeCode}`,
    )
    logEvent('tengu_bridge_repl_ws_closed', {
      code: closeCode,
    })
// 关之前先抢序号；这里允许 transport 已经是 null（/bridge-kick 可能连点两次），所以整段包在 if 里
    // Capture SSE seq high-water mark before nulling. When called from
    // setOnClose the guard guarantees transport !== null; when fired from
    // /bridge-kick it may already be null (e.g. fired twice) — skip.
    if (transport) {
      const closedSeq = transport.getLastSequenceNum()
      if (closedSeq > lastTransportSequenceNum) {
        lastTransportSequenceNum = closedSeq
      }
      transport = null
    }
    // Transport is gone — wake the poll loop out of its at-capacity
    // heartbeat sleep so it's fast-polling by the time the reconnect
    // below completes and the server re-queues work.
    wakePollLoop()
// 与 onWorkReceived 里的处理刻意不同：那里保留待发消息（新传输会来排空），这里是永久关闭——不会再有新传输来排空，所以必须 drop 并记一条 warn
    // Reset flush state so writeMessages() hits the !transport guard
    // (with a warning log) instead of silently queuing into a buffer
    // that will never be drained. Unlike onWorkReceived (which
    // preserves pending messages for the new transport), onClose is
    // a permanent close — no new transport will drain these.
    const dropped = flushGate.drop()
    if (dropped > 0) {
      logForDebugging(
        `[bridge:repl] Dropping ${dropped} pending message(s) on transport close (code=${closeCode})`,
        { level: 'warn' },
      )
    }

// 干净关闭（1000）意味着会话正常结束：直接进入拆除，不尝试重连
    if (closeCode === 1000) {
      // Clean close — session ended normally. Tear down the bridge.
      onStateChange?.('failed', 'session ended')
      pollController.abort()
      triggerTeardown()
      return
    }

// 其余情况：重连预算耗尽或被服务端永久拒绝。注释里给了数据支撑——2026-03-12 的统计显示约 98% 的 ws_closed 单靠轮询永远恢复不了，所以必须走「环境重建」这条更重的路
    // Transport reconnect budget exhausted or permanent server
    // rejection. By this point the env has usually been reaped
    // server-side (BQ 2026-03-12: ~98% of ws_closed never recover
    // via poll alone). stopWork(force=false) can't re-dispatch work
    // from an archived env; reconnectEnvironmentWithSession can
    // re-activate it via POST /bridge/reconnect, or fall through
    // to a fresh session if the env is truly gone. The poll loop
    // (already woken above) picks up the re-queued work once
    // doReconnect completes.
    onStateChange?.(
      'reconnecting',
      `Remote Control connection lost (code ${closeCode})`,
    )
    logForDebugging(
      `[bridge:repl] Transport reconnect budget exhausted (code=${closeCode}), attempting env reconnect`,
    )
// 重连失败后要区分两种 false：一种是拆除进行中（doReconnect 里四个 abort 检查点都会返回 false），一种是真失败。前者不能记失败埋点、也不能再拆一次——用户只是退出了
    void reconnectEnvironmentWithSession().then(success => {
      if (success) return
      // doReconnect has four abort-check return-false sites for
      // teardown-in-progress. Don't pollute the BQ failure signal
      // or double-teardown when the user just quit.
      if (pollController.signal.aborted) return
// 最危险的失败形态：环境注册成功（environmentId 已指向一个全新的有效环境）但建会话失败。此时轮询循环会一直轮询一个没有会话的环境，拿到 null 工作项且毫无错误，永远不会命中任何放弃路径。必须显式拆除
      // doReconnect returns false (never throws) on genuine failure.
      // The dangerous case: registerBridgeEnvironment succeeded (so
      // environmentId now points at a fresh valid env) but
      // createSession failed — poll loop would poll a sessionless
      // env getting null work with no errors, never hitting any
      // give-up path. Tear down explicitly.
      logForDebugging(
        '[bridge:repl] reconnectEnvironmentWithSession resolved false — tearing down',
      )
      logEvent('tengu_bridge_repl_reconnect_failed', {
        close_code: closeCode,
      })
      onStateChange?.('failed', 'reconnection failed')
      triggerTeardown()
    })
  }

// 仅 ANT：SIGUSR2 强制触发一次 doReconnect，用于手工测试（省掉约 30 秒的轮询等待）。Windows 没有 USR 信号，process.on 会直接抛错，所以要判平台
  // Ant-only: SIGUSR2 → force doReconnect() for manual testing. Skips the
  // ~30s poll wait — fire-and-observe in the debug log immediately.
  // Windows has no USR signals; `process.on` would throw there.
  let sigusr2Handler: (() => void) | undefined
  if (process.env.USER_TYPE === 'ant' && process.platform !== 'win32') {
    sigusr2Handler = () => {
      logForDebugging(
        '[bridge:repl] SIGUSR2 received — forcing doReconnect() for testing',
      )
      void reconnectEnvironmentWithSession()
    }
    process.on('SIGUSR2', sigusr2Handler)
  }

// 仅 ANT：把「强制关闭传输」与「强制重连」注册成一个调试句柄，供 /bridge-kick 斜杠命令调用——真实的 setOnClose 回调埋在 wireTransport 里面，深层嵌套，拿不到
  // Ant-only: /bridge-kick fault injection. handleTransportPermanentClose
  // is defined below and assigned into this slot so the slash command can
  // invoke it directly — the real setOnClose callback is buried inside
  // wireTransport which is itself inside onWorkReceived.
  let debugFireClose: ((code: number) => void) | null = null
  if (process.env.USER_TYPE === 'ant') {
    registerBridgeDebugHandle({
      fireClose: code => {
        if (!debugFireClose) {
          logForDebugging('[bridge:debug] fireClose: no transport wired yet')
          return
        }
        logForDebugging(`[bridge:debug] fireClose(${code}) — injecting`)
        debugFireClose(code)
      },
      forceReconnect: () => {
        logForDebugging('[bridge:debug] forceReconnect — injecting')
        void reconnectEnvironmentWithSession()
      },
      injectFault: injectBridgeFault,
      wakePollLoop,
      describe: () =>
        `env=${environmentId} session=${currentSessionId} transport=${transport?.getStateLabel() ?? 'null'} workId=${currentWorkId ?? 'null'}`,
    })
  }

// pollOpts 是把轮询循环需要的所有能力注入进去：凭据读取、状态上报、容量判定、心跳信息、心跳致命错误处理、环境丢失恢复、工作项到达处理
  const pollOpts = {
    api,
    getCredentials: () => ({ environmentId, environmentSecret }),
    signal: pollController.signal,
    getPollIntervalConfig,
    onStateChange,
    getWsState: () => transport?.getStateLabel() ?? 'null',
// 单会话桥的容量判定就是「有没有传输」——不需要再判连接状态：即使传输正在内部自动重连（最长 10 分钟），轮询也只该发心跳，不该领新活
    // REPL bridge is single-session: having any transport == at capacity.
    // No need to check isConnectedStatus() — even while the transport is
    // auto-reconnecting internally (up to 10 min), poll is heartbeat-only.
    isAtCapacity: () => transport !== null,
    capacitySignal,
    onFatalError: triggerTeardown,
    getHeartbeatInfo: () => {
      if (!currentWorkId || !currentIngressToken) {
        return null
      }
      return {
        environmentId,
        workId: currentWorkId,
        sessionToken: currentIngressToken,
      }
    },
// onHeartbeatFatal 存在的理由是一条实测故障：工作项 JWT 过期后，传输彻底没用（SSE 重连与 CCR 写都会用同一个过期令牌）。没有这个回调，轮询循环会做 10 分钟的满容量退避，而工作租约只有 300 秒——租约过期后服务端不再转发提示，形成约 25 分钟的死窗口
    // Work-item JWT expired (or work gone). The transport is useless —
    // SSE reconnects and CCR writes use the same stale token. Without
    // this callback the poll loop would do a 10-min at-capacity backoff,
    // during which the work lease (300s TTL) expires and the server stops
    // forwarding prompts → ~25-min dead window observed in daemon logs.
    // Kill the transport + work state so isAtCapacity()=false; the loop
    // fast-polls and picks up the server's re-dispatched work in seconds.
    onHeartbeatFatal: (err: BridgeFatalError) => {
      logForDebugging(
        `[bridge:repl] heartbeatWork fatal (status=${err.status}) — tearing down work item for fast re-dispatch`,
      )
      if (transport) {
        const seq = transport.getLastSequenceNum()
        if (seq > lastTransportSequenceNum) {
          lastTransportSequenceNum = seq
        }
        transport.close()
        transport = null
      }
      flushGate.drop()
      // force=false → server re-queues. Likely already expired, but
      // idempotent and makes re-dispatch immediate if not.
      if (currentWorkId) {
        void api
          .stopWork(environmentId, currentWorkId, false)
          .catch((e: unknown) => {
            logForDebugging(
              `[bridge:repl] stopWork after heartbeat fatal: ${errorMessage(e)}`,
            )
          })
      }
      currentWorkId = null
      currentIngressToken = null
      wakePollLoop()
      onStateChange?.(
        'reconnecting',
        'Work item lease expired, fetching fresh token',
      )
    },
// 环境丢失时轮询循环调用这里拿新凭据；返回 null 表示救不回来，循环自行判定放弃
    async onEnvironmentLost() {
      const success = await reconnectEnvironmentWithSession()
      if (!success) {
        return null
      }
      return { environmentId, environmentSecret }
    },
// onWorkReceived 是「拿到工作项之后」的全部处理：先刷新指针与校验会话、再决定 v1 还是 v2、然后关旧传输、接新传输、冲刷历史、进入连接态
    onWorkReceived: (
      workSessionId: string,
      ingressToken: string,
      workId: string,
      serverUseCcrV2: boolean,
    ) => {
      // When new work arrives while a transport is already open, the
      // server has decided to re-dispatch (e.g. token rotation, server
      // restart). Close the existing transport and reconnect — discarding
      // the work causes a stuck 'reconnecting' state if the old WS dies
      // shortly after (the server won't re-dispatch a work item it
      // already delivered).
      // ingressToken (JWT) is stored for heartbeat auth (both v1 and v2).
      // Transport auth diverges — see the v1/v2 split below.
// 传输已连状态下又收到工作项，说明服务端决定重派（令牌轮换、服务端重启）。必须关掉旧传输重连——直接丢弃工作项会导致卡在 reconnecting：旧 WebSocket 很快会死，而服务端不会重复派发一个它已经投递过的工作项
      if (transport?.isConnectedStatus()) {
        logForDebugging(
          `[bridge:repl] Work received while transport connected, replacing with fresh token (workId=${workId})`,
        )
      }

      logForDebugging(
        `[bridge:repl] Work received: workId=${workId} workSessionId=${workSessionId} currentSessionId=${currentSessionId} match=${sameSessionId(workSessionId, currentSessionId)}`,
      )

      // Refresh the crash-recovery pointer's mtime. Staleness checks file
      // mtime (not embedded timestamp) so this re-write bumps the clock —
      // a 5h+ session that crashes still has a fresh pointer. Fires once
      // per work dispatch (infrequent — bounded by user message rate).
      void writeBridgePointer(dir, {
        sessionId: currentSessionId,
        environmentId,
        source: 'repl',
      })

// 拒绝外来会话 ID：环境与会话是成对创建的，ID 对不上说明服务端发生了意外的重新分配
// 比较的是底层 UUID 而不是带前缀的完整 ID：CCR v2 的兼容层给 createBridgeSession 返回 session_* 形式，但基础设施层在工作队列里投递的是 cse_* 形式——同一个 UUID、不同前缀
      // Reject foreign session IDs — the server shouldn't assign sessions
      // from other environments. Since we create env+session as a pair,
      // a mismatch indicates an unexpected server-side reassignment.
      //
      // Compare by underlying UUID, not by tagged-ID prefix. When CCR
      // v2's compat layer serves the session, createBridgeSession gets
      // session_* from the v1-facing API (compat/convert.go:41) but the
      // infrastructure layer delivers cse_* in the work queue
      // (container_manager.go:129). Same UUID, different tag.
      if (!sameSessionId(workSessionId, currentSessionId)) {
        logForDebugging(
          `[bridge:repl] Rejecting foreign session: expected=${currentSessionId} got=${workSessionId}`,
        )
        return
      }

      currentWorkId = workId
      currentIngressToken = ingressToken

      // Server decides per-session (secret.use_code_sessions from the work
      // secret, threaded through runWorkPollLoop). The env var is an ant-dev
      // override for forcing v2 before the server flag is on for your user —
      // requires ccr_v2_compat_enabled server-side or registerWorker 404s.
      //
      // Kept separate from CLAUDE_CODE_USE_CCR_V2 (the child-SDK transport
      // selector set by sessionRunner/environment-manager) to avoid the
      // inheritance hazard in spawn mode where the parent's orchestrator
      // var would leak into a v1 child.
// v1/v2 由服务端按会话决定（工作密钥里的 use_code_sessions），环境变量 CLAUDE_BRIDGE_USE_CCR_V2 只是内网开发用的强制开关，且服务端必须已开启 ccr_v2_compat_enabled 否则 registerWorker 直接 404
      const useCcrV2 =
        serverUseCcrV2 || isEnvTruthy(process.env.CLAUDE_BRIDGE_USE_CCR_V2)

// 鉴权是 v1 与 v2 唯一硬分叉的地方：v1（Session-Ingress）接受 OAuth 或 JWT，优先 OAuth 因为有标准刷新流程；v2（CCR /worker/*）强制要求 JWT，因为 register_worker 要校验 session_id 声明，而 OAuth 令牌不带这个声明
      // Auth is the one place v1 and v2 diverge hard:
      //
      // - v1 (Session-Ingress): accepts OAuth OR JWT. We prefer OAuth
      //   because the standard OAuth refresh flow handles expiry — no
      //   separate JWT refresh scheduler needed.
      //
      // - v2 (CCR /worker/*): REQUIRES the JWT. register_worker.go:32
      //   validates the session_id claim, which OAuth tokens don't carry.
      //   The JWT from the work secret has both that claim and the worker
      //   role (environment_auth.py:856). JWT refresh: when it expires the
      //   server re-dispatches work with a fresh one, and onWorkReceived
      //   fires again. createV2ReplTransport stores it via
      //   updateSessionIngressAuthToken() before touching the network.
      let v1OauthToken: string | undefined
      if (!useCcrV2) {
        v1OauthToken = getOAuthToken()
        if (!v1OauthToken) {
          logForDebugging(
            '[bridge:repl] No OAuth token available for session ingress, skipping work',
          )
          return
        }
        updateSessionIngressAuthToken(v1OauthToken)
      }
      logEvent('tengu_bridge_repl_work_received', {})

// 关旧传输前先把 transport 置空，顺序不能反：否则 close 回调会把这次「程序性关闭」当成「会话正常结束」，触发整条拆除流程
      // Close the previous transport. Nullify BEFORE calling close() so
      // the close callback doesn't treat the programmatic close as
      // "session ended normally" and trigger a full teardown.
      if (transport) {
        const oldTransport = transport
        transport = null
// 序号取最大值而不是直接赋值：一个还没收到任何帧就死掉的传输会把非零的高水位重置回 0
        // Capture the SSE sequence high-water mark so the next transport
        // resumes the stream instead of replaying from seq 0. Use max() —
        // a transport that died early (never received any frames) would
        // otherwise reset a non-zero mark back to 0.
        const oldSeq = oldTransport.getLastSequenceNum()
        if (oldSeq > lastTransportSequenceNum) {
          lastTransportSequenceNum = oldSeq
        }
        oldTransport.close()
      }
      // Reset flush state — the old flush (if any) is no longer relevant.
      // Preserve pending messages so they're drained after the new
      // transport's flush completes (the hook has already advanced its
      // lastWrittenIndex and won't re-send them).
// deactivate 而不是 drop：这里保留待发消息，等新传输的历史冲刷完成后再排空（hook 那边已经推进了 lastWrittenIndex，不会再重发这些消息）
      flushGate.deactivate()

      // Closure adapter over the shared handleServerControlRequest —
      // captures transport/currentSessionId so the transport.setOnData
      // callback below doesn't need to thread them through.
// 把 handleServerControlRequest 包一层闭包，捕获 transport 与 currentSessionId——因为回调绑在传输上，没法再往下传参
      const onServerControlRequest = (request: SDKControlRequest): void =>
        handleServerControlRequest(request, {
          transport,
          sessionId: currentSessionId,
          onInterrupt,
          onSetModel,
          onSetMaxThinkingTokens,
          onSetPermissionMode,
        })

      let initialFlushDone = false

      // Wire callbacks onto a freshly constructed transport and connect.
      // Extracted so the (sync) v1 and (async) v2 construction paths can
      // share the identical callback + flush machinery.
// wireTransport 抽出来是为了让同步构造的 v1 与异步构造的 v2 共用同一套回调与冲刷机制
      const wireTransport = (newTransport: ReplBridgeTransport): void => {
        transport = newTransport

// setOnConnect 里第一件事是「我还是当前传输吗」：连接期间可能已经有更新的工作项把它替换掉了，此时这个回调必须自我作废
        newTransport.setOnConnect(() => {
          // Guard: if transport was replaced by a newer onWorkReceived call
          // while the WS was connecting, ignore this stale callback.
          if (transport !== newTransport) return

          logForDebugging('[bridge:repl] Ingress transport connected')
          logEvent('tengu_bridge_repl_ws_connected', {})

          // Update the env var with the latest OAuth token so POST writes
          // (which read via getSessionIngressAuthToken()) use a fresh token.
          // v2 skips this — createV2ReplTransport already stored the JWT,
          // and overwriting it with OAuth would break subsequent /worker/*
          // requests (session_id claim check).
          if (!useCcrV2) {
            const freshToken = getOAuthToken()
            if (freshToken) {
              updateSessionIngressAuthToken(freshToken)
            }
          }

// 每次成功连接都把 teardownStarted 复位——否则一次失败的拆除会永久卡住后续所有拆除
          // Reset teardownStarted so future teardowns are not blocked.
          teardownStarted = false

          // Flush initial messages only on first connect, not on every
          // WS reconnection. Re-flushing would cause duplicate messages.
          // IMPORTANT: onStateChange('connected') is deferred until the
          // flush completes. This prevents writeMessages() from sending
          // new messages that could arrive at the server interleaved with
          // the historical messages, and delays the web UI from showing
          // the session as active until history is persisted.
// 初始历史只冲刷一次，WS 重连不重发（重发就是重复消息）。而且 onStateChange(connected) 必须等冲刷完成才发：既避免新消息与历史交错到达，也避免网页面板在历史持久化之前就把会话显示成活跃
          if (
            !initialFlushDone &&
            initialMessages &&
            initialMessages.length > 0
          ) {
            initialFlushDone = true

// 历史条数上限：完整历史只是给界面看的（模型看不到），超大重放会拖慢 session-ingress 的逐事件持久化并抬高 Firestore 压力。上限为 0 或负数表示不限制
            // Cap the initial flush to the most recent N messages. The full
            // history is UI-only (model doesn't see it) and large replays cause
            // slow session-ingress persistence (each event is a threadstore write)
            // plus elevated Firestore pressure. A 0 or negative cap disables it.
            const historyCap = initialHistoryCap
            const eligibleMessages = initialMessages.filter(
              m =>
                isEligibleBridgeMessage(m) &&
                !previouslyFlushedUUIDs?.has(m.uuid),
            )
// 截断取的是「最近 N 条」而不是「最早 N 条」：用户最关心的是刚刚发生的内容
            const cappedMessages =
              historyCap > 0 && eligibleMessages.length > historyCap
                ? eligibleMessages.slice(-historyCap)
                : eligibleMessages
            if (cappedMessages.length < eligibleMessages.length) {
              logForDebugging(
                `[bridge:repl] Capped initial flush: ${eligibleMessages.length} -> ${cappedMessages.length} (cap=${historyCap})`,
              )
              logEvent('tengu_bridge_repl_history_capped', {
                eligible_count: eligibleMessages.length,
                capped_count: cappedMessages.length,
              })
            }
            const sdkMessages = toSDKMessages(cappedMessages)
            if (sdkMessages.length > 0) {
              logForDebugging(
                `[bridge:repl] Flushing ${sdkMessages.length} initial message(s) via transport`,
              )
              const events = sdkMessages.map(sdkMsg => ({
                ...sdkMsg,
                session_id: currentSessionId,
              }))
// 记录冲刷前的丢弃计数，冲刷结束再比对——如果期间有批次被丢弃（Session-Ingress 连续失败到上限），writeBatch 仍然会正常 resolve，但事件根本没送到
              const dropsBefore = newTransport.droppedBatchCount
              void newTransport
                .writeBatch(events)
                .then(() => {
                  // If any batch was dropped during this flush (SI down for
                  // maxConsecutiveFailures attempts), flush() still resolved
                  // normally but the events were NOT delivered. Don't mark
                  // UUIDs as flushed — keep them eligible for re-send on the
                  // next onWorkReceived (JWT refresh re-dispatch, line ~1144).
// 所以这种情况不能把 UUID 标记成已冲刷：留着让它在下次 onWorkReceived（JWT 刷新重派）时重新入选
                  if (newTransport.droppedBatchCount > dropsBefore) {
                    logForDebugging(
                      `[bridge:repl] Initial flush dropped ${newTransport.droppedBatchCount - dropsBefore} batch(es) — not marking ${sdkMessages.length} UUID(s) as flushed`,
                    )
                    return
                  }
                  if (previouslyFlushedUUIDs) {
                    for (const sdkMsg of sdkMessages) {
                      if (sdkMsg.uuid) {
                        previouslyFlushedUUIDs.add(sdkMsg.uuid)
                      }
                    }
                  }
                })
                .catch(e =>
                  logForDebugging(`[bridge:repl] Initial flush failed: ${e}`),
                )
// finally 里再判一次「传输有没有被换掉」：换了就说明新传输接管了生命周期，这里不该再发 connected，也不该排空闸门
                .finally(() => {
                  // Guard: if transport was replaced during the flush,
                  // don't signal connected or drain — the new transport
                  // owns the lifecycle now.
                  if (transport !== newTransport) return
                  drainFlushGate()
                  onStateChange?.('connected')
                })
            } else {
              // All initial messages were already flushed (filtered by
              // previouslyFlushedUUIDs). No flush POST needed — clear
              // the flag and signal connected immediately. This is the
              // first connect for this transport (inside !initialFlushDone),
              // so no flush POST is in-flight — the flag was set before
              // connect() and must be cleared here.
              drainFlushGate()
              onStateChange?.('connected')
            }
// 没有初始消息、或首次连接已冲刷过（WS 自动重连路径）时，只在「没有冲刷 POST 在途」的情况下才发 connected——有在途就由那个 .finally 负责
          } else if (!flushGate.active) {
            // No initial messages or already flushed on first connect.
            // WS auto-reconnect path — only signal connected if no flush
            // POST is in-flight. If one is, .finally() owns the lifecycle.
            onStateChange?.('connected')
          }
        })

// 入站数据统一交给 handleIngressMessage，带上两个 UUID 集合（回声过滤、入站去重）与三个回调
        newTransport.setOnData(data => {
          handleIngressMessage(
            data,
            recentPostedUUIDs,
            recentInboundUUIDs,
            onInboundMessage,
            onPermissionResponse,
            onServerControlRequest,
          )
        })

        // Body lives at initBridgeCore scope so /bridge-kick can call it
        // directly via debugFireClose. All referenced closures (transport,
        // wakePollLoop, flushGate, reconnectEnvironmentWithSession, etc.)
        // are already at that scope. The only lexical dependency on
        // wireTransport was `newTransport.getLastSequenceNum()` — but after
        // the guard below passes we know transport === newTransport.
// 把 handleTransportPermanentClose 挂到调试槽位上，供 /bridge-kick 直接点火；同时正式注册 setOnClose，外面再包一层「不是当前传输就忽略」的守卫
        debugFireClose = handleTransportPermanentClose
        newTransport.setOnClose(closeCode => {
          // Guard: if transport was replaced, ignore stale close.
          if (transport !== newTransport) return
          handleTransportPermanentClose(closeCode)
        })

// 闸门必须在 connect() 之前启动：从传输赋值到 setOnConnect 触发之间有一段握手窗口，期间的 writeMessages 会走 HTTP POST 抢在历史之前到达。没有初始消息时闸门保持不激活
        // Start the flush gate before connect() to cover the WS handshake
        // window. Between transport assignment and setOnConnect firing,
        // writeMessages() could send messages via HTTP POST before the
        // initial flush starts. Starting the gate here ensures those
        // calls are queued. If there are no initial messages, the gate
        // stays inactive.
        if (
          !initialFlushDone &&
          initialMessages &&
          initialMessages.length > 0
        ) {
          flushGate.start()
        }

        newTransport.connect()
      } // end wireTransport

// 无条件递增代际号：任何新传输（无论 v1 还是 v2）都要作废在途的 v2 握手
      // Bump unconditionally — ANY new transport (v1 or v2) invalidates an
      // in-flight v2 handshake. Also bumped in doReconnect().
      v2Generation++

// v2 分支：URL 用工作队列给的 cse_* 形式（/v1/code/sessions/{id}/worker/* 只认这个），session_* 那个形式在这里不可用
      if (useCcrV2) {
        // workSessionId is the cse_* form (infrastructure-layer ID from the
        // work queue), which is what /v1/code/sessions/{id}/worker/* wants.
        // The session_* form (currentSessionId) is NOT usable here —
        // handler/convert.go:30 validates TagCodeSession.
        const sessionUrl = buildCCRv2SdkUrl(baseUrl, workSessionId)
        const thisGen = v2Generation
        logForDebugging(
          `[bridge:repl] CCR v2: sessionUrl=${sessionUrl} session=${workSessionId} gen=${thisGen}`,
        )
        void createV2ReplTransport({
          sessionUrl,
          ingressToken,
          sessionId: workSessionId,
          initialSequenceNum: lastTransportSequenceNum,
        }).then(
          t => {
// 异步握手成功后有三道检查：拆除是否已开始（此时装了传输会泄漏心跳定时器）、代际号是否还是自己这一代（不是就丢弃，这是修「两次并发都看到 null」那个竞态的关键）、都过了才真正装配
            // Teardown started while registerWorker was in flight. Teardown
            // saw transport === null and skipped close(); installing now
            // would leak CCRClient heartbeat timers and reset
            // teardownStarted via wireTransport's side effects.
            if (pollController.signal.aborted) {
              t.close()
              return
            }
            // onWorkReceived may have fired again while registerWorker()
            // was in flight (server re-dispatch with a fresh JWT). The
            // transport !== null check alone gets the race wrong when BOTH
            // attempts saw transport === null — it keeps the first resolver
            // (stale epoch) and discards the second (correct epoch). The
            // generation check catches it regardless of transport state.
            if (thisGen !== v2Generation) {
              logForDebugging(
                `[bridge:repl] CCR v2: discarding stale handshake gen=${thisGen} current=${v2Generation}`,
              )
              t.close()
              return
            }
            wireTransport(t)
          },
          (err: unknown) => {
            logForDebugging(
              `[bridge:repl] CCR v2: createV2ReplTransport failed: ${errorMessage(err)}`,
              { level: 'error' },
            )
            logEvent('tengu_bridge_repl_ccr_v2_init_failed', {})
            // If a newer attempt is in flight or already succeeded, don't
            // touch its work item — our failure is irrelevant.
// 握手失败的收尾：先判代际号（更新的尝试在跑或已成功，我们的失败无关痛痒），再把工作项还给服务端——不还的话用户那边看到的是会话卡住，得等服务端自己的超时才恢复
            if (thisGen !== v2Generation) return
            // Release the work item so the server re-dispatches immediately
            // instead of waiting for its own timeout. currentWorkId was set
            // above; without this, the session looks stuck to the user.
            if (currentWorkId) {
              void api
                .stopWork(environmentId, currentWorkId, false)
                .catch((e: unknown) => {
                  logForDebugging(
                    `[bridge:repl] stopWork after v2 init failure: ${errorMessage(e)}`,
                  )
                })
              currentWorkId = null
              currentIngressToken = null
            }
            wakePollLoop()
          },
        )
// v1 分支：HybridTransport 自带自动重连（指数退避），WS 掉了它会自己救；POST 写不受 WS 状态影响，因为它独立读环境变量里的令牌
      } else {
        // v1: HybridTransport (WS reads + POST writes to Session-Ingress).
        // autoReconnect is true (default) — when the WS dies, the transport
        // reconnects automatically with exponential backoff. POST writes
        // continue during reconnection (they use getSessionIngressAuthToken()
        // independently of WS state). The poll loop remains as a secondary
        // fallback if the reconnect budget is exhausted (10 min).
        //
        // Auth: uses OAuth tokens directly instead of the JWT from the work
        // secret. refreshHeaders picks up the latest OAuth token on each
        // WS reconnect attempt.
        const wsUrl = buildSdkUrl(sessionIngressUrl, workSessionId)
        logForDebugging(`[bridge:repl] Ingress URL: ${wsUrl}`)
        logForDebugging(
          `[bridge:repl] Creating HybridTransport: session=${workSessionId}`,
        )
        // v1OauthToken was validated non-null above (we'd have returned early).
        const oauthToken = v1OauthToken ?? ''
        wireTransport(
          createV1ReplTransport(
            new HybridTransport(
              new URL(wsUrl),
              {
                Authorization: `Bearer ${oauthToken}`,
                'anthropic-version': '2023-06-01',
              },
              workSessionId,
              () => ({
                Authorization: `Bearer ${getOAuthToken() ?? oauthToken}`,
                'anthropic-version': '2023-06-01',
              }),
// maxConsecutiveFailures 设 50（约 20 分钟）专门针对桥接场景：不设上限的话，一个持续失败的 session-ingress 能把上传队列的排空循环钉死到桥的整个生命周期。注释里还注明「1P 保持无限」，说明这是桥专属的取舍
              // Cap retries so a persistently-failing session-ingress can't
              // pin the uploader drain loop for the lifetime of the bridge.
              // 50 attempts ≈ 20 min (15s POST timeout + 8s backoff + jitter
              // per cycle at steady state). Bridge-only — 1P keeps indefinite.
              {
                maxConsecutiveFailures: 50,
                isBridge: true,
// 批次被丢弃时的回调：既把状态改成 reconnecting（告知用户丢了同步），又唤醒轮询循环——否则 Session-Ingress 恢复之后状态仍停在 reconnecting，而守护进程那边会因为状态不对而拒绝所有权限
                onBatchDropped: () => {
                  onStateChange?.(
                    'reconnecting',
                    'Lost sync with Remote Control — events could not be delivered',
                  )
                  // SI has been down ~20 min. Wake the poll loop so that when
                  // SI recovers, next poll → onWorkReceived → fresh transport
                  // → initial flush succeeds → onStateChange('connected') at
                  // ~line 1420. Without this, state stays 'reconnecting' even
                  // after SI recovers — daemon.ts:437 denies all permissions,
                  // useReplBridge.ts:311 keeps replBridgeSessionActive=false.
                  // If the env was archived during the outage, poll 404 →
                  // onEnvironmentLost recovery path handles it.
                  wakePollLoop()
                },
              },
            ),
          ),
        )
      }
    },
  }
// 轮询循环是不 await 启动的：它要跑整个桥的生命周期，而 init 需要立刻返回句柄
  void startWorkPollLoop(pollOpts)

// 常驻模式下每小时刷新一次指针的 mtime：onWorkReceived 的刷新只在用户发消息时触发，一个空闲超过 4 小时的守护进程会留下过期指针，下次启动读到时判定陈旧就直接新建会话了
  // Perpetual mode: hourly mtime refresh of the crash-recovery pointer.
  // The onWorkReceived refresh only fires per user prompt — a
  // daemon idle for >4h would have a stale pointer, and the next restart
  // would clear it (readBridgePointer TTL check) → fresh session. The
  // standalone bridge (bridgeMain.ts) has an identical hourly timer.
  const pointerRefreshTimer = perpetual
// 定时器里先判 reconnectPromise：doReconnect 会非原子地先后改写 environmentId 与 currentSessionId（中间有 await），如果定时器正好在这个窗口里触发，它的 fire-and-forget 写会覆盖掉 doReconnect 自己的写，把指针留在已归档的旧会话上。doReconnect 自己会写指针，所以这里跳过是免费的
    ? setInterval(() => {
        // doReconnect() reassigns currentSessionId/environmentId non-
        // atomically (env at ~:634, session at ~:719, awaits in between).
        // If this timer fires in that window, its fire-and-forget write can
        // race with (and overwrite) doReconnect's own pointer write at ~:740,
        // leaving the pointer at the now-archived old session. doReconnect
        // writes the pointer itself, so skipping here is free.
        if (reconnectPromise) return
        void writeBridgePointer(dir, {
          sessionId: currentSessionId,
          environmentId,
          source: 'repl',
        })
      }, 60 * 60_000)
    : null
  pointerRefreshTimer?.unref?.()

// keep_alive 帧：固定间隔往上游推一个静默帧，防止代理层把空闲的远程控制会话回收。这个类型在到达客户端界面之前就被过滤掉了（Query.ts 丢弃，web/iOS/Android 的消息循环都看不到）
  // Push a silent keep_alive frame on a fixed interval so upstream proxies
  // and the session-ingress layer don't GC an otherwise-idle remote control
  // session. The keep_alive type is filtered before reaching any client UI
  // (Query.ts drops it; web/iOS/Android never see it in their message loop).
  // Interval comes from GrowthBook (tengu_bridge_poll_interval_config
  // session_keepalive_interval_v2_ms, default 120s); 0 = disabled.
  const keepAliveIntervalMs =
    getPollIntervalConfig().session_keepalive_interval_v2_ms
  const keepAliveTimer =
    keepAliveIntervalMs > 0
      ? setInterval(() => {
          if (!transport) return
          logForDebugging('[bridge:repl] keep_alive sent')
          void transport.write({ type: 'keep_alive' }).catch((err: unknown) => {
            logForDebugging(
              `[bridge:repl] keep_alive write failed: ${errorMessage(err)}`,
            )
          })
        }, keepAliveIntervalMs)
      : null
  keepAliveTimer?.unref?.()

// doTeardownImpl 是幂等的：重入直接返回并记日志。拆除路径可能被多条路触发（用户退出、干净关闭、致命错误、清理注册），重复执行会重复归档会话
  // Shared teardown sequence used by both cleanup registration and
  // the explicit teardown() method on the returned handle.
  let teardownStarted = false
  doTeardownImpl = async (): Promise<void> => {
    if (teardownStarted) {
      logForDebugging(
        `[bridge:repl] Teardown already in progress, skipping duplicate call env=${environmentId} session=${currentSessionId}`,
      )
      return
    }
    teardownStarted = true
    const teardownStart = Date.now()
    logForDebugging(
      `[bridge:repl] Teardown starting: env=${environmentId} session=${currentSessionId} workId=${currentWorkId ?? 'none'} transportState=${transport?.getStateLabel() ?? 'null'}`,
    )

// 先清定时器、摘信号处理、清调试句柄，再 abort 轮询——顺序反了的话，定时器可能在拆除过程中再触发一次写指针
    if (pointerRefreshTimer !== null) {
      clearInterval(pointerRefreshTimer)
    }
    if (keepAliveTimer !== null) {
      clearInterval(keepAliveTimer)
    }
    if (sigusr2Handler) {
      process.off('SIGUSR2', sigusr2Handler)
    }
    if (process.env.USER_TYPE === 'ant') {
      clearBridgeDebugHandle()
      debugFireClose = null
    }
    pollController.abort()
    logForDebugging('[bridge:repl] Teardown: poll loop aborted')

// 显式拆除时要先抢一次传输的序号：close() 是同步的（只是中止 SSE 请求）且不会触发 onClose，所以 setOnClose 里那段捕获逻辑对显式拆除根本不执行。不在这里补一次，getSSESequenceNum() 在拆除后返回的就是上次换手的旧值，守护进程持久化它会丢掉之后的所有事件
    // Capture the live transport's seq BEFORE close() — close() is sync
    // (just aborts the SSE fetch) and does NOT invoke onClose, so the
    // setOnClose capture path never runs for explicit teardown.
    // Without this, getSSESequenceNum() after teardown returns the stale
    // lastTransportSequenceNum (captured at the last transport swap), and
    // daemon callers persisting that value lose all events since then.
    if (transport) {
      const finalSeq = transport.getLastSequenceNum()
      if (finalSeq > lastTransportSequenceNum) {
        lastTransportSequenceNum = finalSeq
      }
    }

// 常驻模式的拆除是「本地行为」：不发结果、不 stopWork、不关传输。这些动作都会向服务端与订阅方宣告「会话结束」。这里的做法是停轮询、让 socket 随进程一起死，后端自己按 300 秒租约把工作项退回 pending，下次启动读指针再 reconnectSession 重新排队
    if (perpetual) {
      // Perpetual teardown is LOCAL-ONLY — do not send result, do not call
      // stopWork, do not close the transport. All of those signal the
      // server (and any mobile/attach subscribers) that the session is
      // ending. Instead: stop polling, let the socket die with the
      // process; the backend times the work-item lease back to pending on
      // its own (TTL 300s). Next daemon start reads the pointer and
      // reconnectSession re-queues work.
      transport = null
      flushGate.drop()
      // Refresh the pointer mtime so that sessions lasting longer than
      // BRIDGE_POINTER_TTL_MS (4h) don't appear stale on next start.
      await writeBridgePointer(dir, {
        sessionId: currentSessionId,
        environmentId,
        source: 'repl',
      })
      logForDebugging(
        `[bridge:repl] Teardown (perpetual): leaving env=${environmentId} session=${currentSessionId} alive on server, duration=${Date.now() - teardownStart}ms`,
      )
      return
    }

// 非常驻拆除的顺序是精心排过的：先发结果消息、再归档、最后关传输。transport.write 只是入队（上传器在入队时就 resolve），stopWork 加 archive 的 200-500 毫秒正好是结果 POST 的排空窗口；反过来先关再归档就只能靠传输那个没人 await 的 3 秒宽限期，而 forceExit 可能在 POST 中途就把 socket 杀掉
    // Fire the result message, then archive, THEN close. transport.write()
    // only enqueues (SerialBatchEventUploader resolves on buffer-add); the
    // stopWork/archive latency (~200-500ms) is the drain window for the
    // result POST. Closing BEFORE archive meant relying on HybridTransport's
    // void-ed 3s grace period, which nothing awaits — forceExit can kill the
    // socket mid-POST. Same reorder as remoteBridgeCore.ts teardown (#22803).
    const teardownTransport = transport
    transport = null
    flushGate.drop()
    if (teardownTransport) {
      void teardownTransport.write(makeResultMessage(currentSessionId))
    }

    const stopWorkP = currentWorkId
      ? api
          .stopWork(environmentId, currentWorkId, true)
          .then(() => {
            logForDebugging('[bridge:repl] Teardown: stopWork completed')
          })
          .catch((err: unknown) => {
            logForDebugging(
              `[bridge:repl] Teardown stopWork failed: ${errorMessage(err)}`,
            )
          })
      : Promise.resolve()

// stopWork 与 archiveSession 并行跑：清理总预算只有 2 秒（gracefulShutdown 里 runCleanupFunctions 与 2 秒赛跑，不是外面那 5 秒兜底），所以注入点把 archive 压到 1.5 秒以内
    // Run stopWork and archiveSession in parallel. gracefulShutdown.ts:407
    // races runCleanupFunctions() against 2s (NOT the 5s outer failsafe),
    // so archive is capped at 1.5s at the injection site to stay under budget.
    // archiveSession is contractually no-throw; the injected implementations
    // log their own success/failure internally.
    await Promise.all([stopWorkP, archiveSession(currentSessionId)])

// 传输必须在归档完成之后才关：上面的并行等待就是给结果消息留的排空时间
    teardownTransport?.close()
    logForDebugging('[bridge:repl] Teardown: transport closed')

    await api.deregisterEnvironment(environmentId).catch((err: unknown) => {
      logForDebugging(
        `[bridge:repl] Teardown deregister failed: ${errorMessage(err)}`,
      )
    })

// 清指针只在这里做：显式断开或正常退出意味着用户不想续接了。崩溃与 kill -9 走不到这行，指针正好留给下次启动恢复
    // Clear the crash-recovery pointer — explicit disconnect or clean REPL
    // exit means the user is done with this session. Crash/kill-9 never
    // reaches this line, leaving the pointer for next-launch recovery.
    await clearBridgePointer(dir)

    logForDebugging(
      `[bridge:repl] Teardown complete: env=${environmentId} duration=${Date.now() - teardownStart}ms`,
    )
  }

// 注册到全局清理表，进程优雅退出时会被调用（gracefulShutdown 负责调度）
  // 8. Register cleanup for graceful shutdown
  const unregister = registerCleanup(() => doTeardownImpl?.())

  logForDebugging(
    `[bridge:repl] Ready: env=${environmentId} session=${currentSessionId}`,
  )
  onStateChange?.('ready')

// 返回的句柄用 getter 暴露可变状态：bridgeSessionId 与 environmentId 在重连后会变，取值时必须拿最新的而不是初始化时的快照
  return {
    get bridgeSessionId() {
      return currentSessionId
    },
    get environmentId() {
      return environmentId
    },
// getSSESequenceNum 取「已关闭传输记下的高水位」与「当前传输的实时值」两者的最大值：前者只在换手/关闭时更新，正常运行时它是落后的，只看它会算少
    getSSESequenceNum() {
      // lastTransportSequenceNum only updates when a transport is CLOSED
      // (captured at swap/onClose). During normal operation the CURRENT
      // transport's live seq isn't reflected there. Merge both so callers
      // (e.g. daemon persistState()) get the actual high-water mark.
      const live = transport?.getLastSequenceNum() ?? 0
      return Math.max(lastTransportSequenceNum, live)
    },
    sessionIngressUrl,
// writeMessages 有三层过滤：只要用户/助手消息（isEligibleBridgeMessage）、排除初始历史（已经冲刷过）、排除刚发过的（回声）
    writeMessages(messages) {
      // Filter to user/assistant messages that haven't already been sent.
      // Two layers of dedup:
      //  - initialMessageUUIDs: messages sent as session creation events
      //  - recentPostedUUIDs: messages recently sent via POST
      const filtered = messages.filter(
        m =>
          isEligibleBridgeMessage(m) &&
          !initialMessageUUIDs.has(m.uuid) &&
          !recentPostedUUIDs.has(m.uuid),
      )
      if (filtered.length === 0) return

// 标题推导放在闸门检查之前：即使这条消息要排队等历史冲刷，它依然是「值得用来起标题」的。持续调用直到回调返回 true，策略由调用方掌握
      // Fire onUserMessage for title derivation. Scan before the flushGate
      // check — prompts are title-worthy even if they queue behind the
      // initial history flush. Keeps calling on every title-worthy message
      // until the callback returns true; the caller owns the policy.
      if (!userMessageCallbackDone) {
        for (const m of filtered) {
          const text = extractTitleText(m)
          if (text !== undefined && onUserMessage?.(text, currentSessionId)) {
            userMessageCallbackDone = true
            break
          }
        }
      }

// 闸门开启期间入队而不是直接发：这是防止新消息与历史在服务端交错的那道闸
      // Queue messages while the initial flush is in progress to prevent
      // them from arriving at the server interleaved with history.
      if (flushGate.enqueue(...filtered)) {
        logForDebugging(
          `[bridge:repl] Queued ${filtered.length} message(s) during initial flush`,
        )
        return
      }

// 没有传输就记一条 warn 再丢弃：这里的静默丢弃会让用户以为消息发出去了，所以必须留痕，且把消息类型一起打出来便于定位
      if (!transport) {
        const types = filtered.map(m => m.type).join(',')
        logForDebugging(
          `[bridge:repl] Transport not configured, dropping ${filtered.length} message(s) [${types}] for session=${currentSessionId}`,
          { level: 'warn' },
        )
        return
      }

      // Track in the bounded ring buffer for echo filtering and dedup.
      for (const msg of filtered) {
        recentPostedUUIDs.add(msg.uuid)
      }

      logForDebugging(
        `[bridge:repl] Sending ${filtered.length} message(s) via transport`,
      )

      // Convert to SDK format and send via HTTP POST (HybridTransport).
      // The web UI receives them via the subscribe WebSocket.
      const sdkMessages = toSDKMessages(filtered)
      const events = sdkMessages.map(sdkMsg => ({
        ...sdkMsg,
        session_id: currentSessionId,
      }))
      void transport.writeBatch(events)
    },
// writeSdkMessages 是守护进程路径：query() 直接产出 SDKMessage，跳过转换；但回声去重仍然要做（服务端会把写入反弹回来）；没有初始历史过滤（守护进程不传初始消息），也没有闸门（守护进程从不启动初始冲刷）
    writeSdkMessages(messages) {
      // Daemon path: query() already yields SDKMessage, skip conversion.
      // Still run echo dedup (server bounces writes back on the WS).
      // No initialMessageUUIDs filter — daemon has no initial messages.
      // No flushGate — daemon never starts it (no initial flush).
      const filtered = messages.filter(
        m => !m.uuid || !recentPostedUUIDs.has(m.uuid),
      )
      if (filtered.length === 0) return
      if (!transport) {
        logForDebugging(
          `[bridge:repl] Transport not configured, dropping ${filtered.length} SDK message(s) for session=${currentSessionId}`,
          { level: 'warn' },
        )
        return
      }
      for (const msg of filtered) {
        if (msg.uuid) recentPostedUUIDs.add(msg.uuid)
      }
      const events = filtered.map(m => ({ ...m, session_id: currentSessionId }))
      void transport.writeBatch(events)
    },
// 四个 sendXXX 方法结构一致：判传输、拼事件（补上 session_id）、不 await 地写出去、记日志。控制请求与响应都是「尽力而为」，失败不重试——重试会破坏控制协议的一次性语义
    sendControlRequest(request: SDKControlRequest) {
      if (!transport) {
        logForDebugging(
          '[bridge:repl] Transport not configured, skipping control_request',
        )
        return
      }
      const event = { ...request, session_id: currentSessionId }
      void transport.write(event)
      logForDebugging(
        `[bridge:repl] Sent control_request request_id=${request.request_id}`,
      )
    },
    sendControlResponse(response: SDKControlResponse) {
      if (!transport) {
        logForDebugging(
          '[bridge:repl] Transport not configured, skipping control_response',
        )
        return
      }
      const event = { ...response, session_id: currentSessionId }
      void transport.write(event)
      logForDebugging('[bridge:repl] Sent control_response')
    },
    sendControlCancelRequest(requestId: string) {
      if (!transport) {
        logForDebugging(
          '[bridge:repl] Transport not configured, skipping control_cancel_request',
        )
        return
      }
      const event = {
        type: 'control_cancel_request' as const,
        request_id: requestId,
        session_id: currentSessionId,
      }
      void transport.write(event)
      logForDebugging(
        `[bridge:repl] Sent control_cancel_request request_id=${requestId}`,
      )
    },
    sendResult() {
      if (!transport) {
        logForDebugging(
          `[bridge:repl] sendResult: skipping, transport not configured session=${currentSessionId}`,
        )
        return
      }
      void transport.write(makeResultMessage(currentSessionId))
      logForDebugging(
        `[bridge:repl] Sent result for session=${currentSessionId}`,
      )
    },
// teardown 先摘清理注册再显式执行：不摘的话，进程退出时这条清理函数会再跑一次（虽然幂等，但会多一条「已在拆除中」的日志）
    async teardown() {
      unregister()
      await doTeardownImpl?.()
      logForDebugging('[bridge:repl] Torn down')
      logEvent('tengu_bridge_repl_teardown', {})
    },
  }
}

/**
 * Persistent poll loop for work items. Runs in the background for the
 * lifetime of the bridge connection.
 *
 * When a work item arrives, acknowledges it and calls onWorkReceived
 * with the session ID and ingress token (which connects the ingress
 * WebSocket). Then continues polling — the server will dispatch a new
 * work item if the ingress WebSocket drops, allowing automatic
 * reconnection without tearing down the bridge.
 */
// startWorkPollLoop 是一个长期存活的轮询循环：拿到工作项就 ack 并回调，然后继续轮询——服务端在入口 WebSocket 掉线时会派发新的工作项，这样自动重连不需要拆掉整个桥
async function startWorkPollLoop({
  api,
  getCredentials,
  signal,
  onStateChange,
  onWorkReceived,
  onEnvironmentLost,
  getWsState,
  isAtCapacity,
  capacitySignal,
  onFatalError,
  getPollIntervalConfig = () => DEFAULT_POLL_CONFIG,
  getHeartbeatInfo,
  onHeartbeatFatal,
}: {
  api: BridgeApiClient
  getCredentials: () => { environmentId: string; environmentSecret: string }
  signal: AbortSignal
  onStateChange?: (state: BridgeState, detail?: string) => void
  onWorkReceived: (
    sessionId: string,
    ingressToken: string,
    workId: string,
    useCodeSessions: boolean,
  ) => void
  /** Called when the environment has been deleted. Returns new credentials or null. */
  onEnvironmentLost?: () => Promise<{
    environmentId: string
    environmentSecret: string
  } | null>
  /** Returns the current WebSocket readyState label for diagnostic logging. */
  getWsState?: () => string
  /**
   * Returns true when the caller cannot accept new work (transport already
   * connected). When true, the loop polls at the configured at-capacity
   * interval as a heartbeat only. Server-side BRIDGE_LAST_POLL_TTL is
   * 4 hours — anything shorter than that is sufficient for liveness.
   */
  isAtCapacity?: () => boolean
  /**
   * Produces a signal that aborts when capacity frees up (transport lost),
   * merged with the loop signal. Used to interrupt the at-capacity sleep
   * so recovery polling starts immediately.
   */
  capacitySignal?: () => CapacitySignal
  /** Called on unrecoverable errors (e.g. server-side expiry) to trigger full teardown. */
  onFatalError?: () => void
  /** Poll interval config getter — defaults to DEFAULT_POLL_CONFIG. */
  getPollIntervalConfig?: () => PollIntervalConfig
  /**
   * Returns the current work ID and session ingress token for heartbeat.
   * When null, heartbeat is not possible (no active work item).
   */
  getHeartbeatInfo?: () => {
    environmentId: string
    workId: string
    sessionToken: string
  } | null
  /**
   * Called when heartbeatWork throws BridgeFatalError (401/403/404/410 —
   * JWT expired or work item gone). Caller should tear down the transport
   * + work state so isAtCapacity() flips to false and the loop fast-polls
   * for the server's re-dispatched work item. When provided, the loop
   * SKIPS the at-capacity backoff sleep (which would otherwise cause a
   * ~10-minute dead window before recovery). When omitted, falls back to
   * the backoff sleep to avoid a tight poll+heartbeat loop.
   */
  onHeartbeatFatal?: (err: BridgeFatalError) => void
}): Promise<void> {
// 循环内部自己维护一份重建计数，与 initBridgeCore 里那份是独立的两套：一个管「环境丢失后的重建」，一个管「传输关闭后的重连」，触发源与判定阈值都不同
  const MAX_ENVIRONMENT_RECREATIONS = 3

  logForDebugging(
    `[bridge:repl] Starting work poll loop for env=${getCredentials().environmentId}`,
  )

// 四个循环状态：连续错误数、首个错误时间、上次错误时间、环境重建次数。放弃判定用的是「首个错误到现在的时长」而不是错误次数——因为退避是指数的，次数与时长的关系不直观
  let consecutiveErrors = 0
  let firstErrorTime: number | null = null
  let lastPollErrorTime: number | null = null
  let environmentRecreations = 0
// suspensionDetected：满容量睡眠超时超出预期很多（进程被挂起：合盖、SIGSTOP、虚拟机暂停）时置位，下一轮强制走一次快轮询。因为 isAtCapacity() 就是「传输非空」，而传输可能正在自动重连一个已经死掉的 socket，不强制一次快轮询就会又睡 10 分钟
  // Set when the at-capacity sleep overruns its deadline by a large margin
  // (process suspension). Consumed at the top of the next iteration to
  // force one fast-poll cycle — isAtCapacity() is `transport !== null`,
  // which stays true while the transport auto-reconnects, so the poll
  // loop would otherwise go straight back to a 10-minute sleep on a
  // transport that may be pointed at a dead socket.
  let suspensionDetected = false

// 主循环：每轮先取凭据与配置，再轮询。凭据在 try 之外取，是为了让 catch 块能判断「并发的重连是不是已经把环境换掉了」
  while (!signal.aborted) {
    // Capture credentials outside try so the catch block can detect
    // whether a concurrent reconnection replaced the environment.
    const { environmentId: envId, environmentSecret: envSecret } =
      getCredentials()
    const pollConfig = getPollIntervalConfig()
    try {
      const work = await api.pollForWork(
        envId,
        envSecret,
        signal,
        pollConfig.reclaim_older_than_ms,
      )

// 轮询成功就是「环境健康」的证据：把重建计数清零。这一步放在状态变更判断之外，因为 onEnvironmentLost 成功路径已经发过 ready，这里再发就是重复
      // A successful poll proves the env is genuinely healthy — reset the
      // env-loss counter so events hours apart each start fresh. Outside
      // the state-change guard below because onEnvLost's success path
      // already emits 'ready'; emitting again here would be a duplicate.
      // (onEnvLost returning creds does NOT reset this — that would break
      // oscillation protection when the new env immediately dies.)
      environmentRecreations = 0

      // Reset error tracking on successful poll
      if (consecutiveErrors > 0) {
        logForDebugging(
          `[bridge:repl] Poll recovered after ${consecutiveErrors} consecutive error(s)`,
        )
        consecutiveErrors = 0
        firstErrorTime = null
        lastPollErrorTime = null
        onStateChange?.('ready')
      }

// 没有工作项：先读并清掉「刚检测到挂起」的标志，让这一轮跳过满容量分支——上面那次 pollForWork 已经刷新了服务端的存活 TTL，这轮快轮询是给重派的工作项一个落地机会
      if (!work) {
        // Read-and-clear: after a detected suspension, skip the at-capacity
        // branch exactly once. The pollForWork above already refreshed the
        // server's BRIDGE_LAST_POLL_TTL; this fast cycle gives any
        // re-dispatched work item a chance to land before we go back under.
        const skipAtCapacityOnce = suspensionDetected
        suspensionDetected = false
// 满容量且有唤醒通道时才进心跳模式：心跳与轮询是「组合」而不是「互相压制」——满容量轮询也开启时（atCapMs 大于 0），循环会记一个截止时间，到点就跳出去轮询
        if (isAtCapacity?.() && capacitySignal && !skipAtCapacityOnce) {
          const atCapMs = pollConfig.poll_interval_ms_at_capacity
          // Heartbeat loops WITHOUT polling. When at-capacity polling is also
          // enabled (atCapMs > 0), the loop tracks a deadline and breaks out
          // to poll at that interval — heartbeat and poll compose instead of
          // one suppressing the other. Breaks out when:
          //   - Poll deadline reached (atCapMs > 0 only)
          //   - Auth fails (JWT expired → poll refreshes tokens)
          //   - Capacity wake fires (transport lost → poll for new work)
          //   - Heartbeat config disabled (GrowthBook update)
          //   - Loop aborted (shutdown)
// 内层心跳循环的四个退出条件：轮询截止时间到、鉴权失败、容量唤醒（传输丢了）、心跳配置被关掉、循环被中止
          if (
            pollConfig.non_exclusive_heartbeat_interval_ms > 0 &&
            getHeartbeatInfo
          ) {
            logEvent('tengu_bridge_heartbeat_mode_entered', {
              heartbeat_interval_ms:
                pollConfig.non_exclusive_heartbeat_interval_ms,
            })
// 截止时间只在进入时算一次：GrowthBook 中途改了配置不会移动在途的截止时间，下一次进入才生效
            // Deadline computed once at entry — GB updates to atCapMs don't
            // shift an in-flight deadline (next entry picks up the new value).
            const pollDeadline = atCapMs > 0 ? Date.now() + atCapMs : null
            let needsBackoff = false
            let hbCycles = 0
            while (
              !signal.aborted &&
              isAtCapacity() &&
              (pollDeadline === null || Date.now() < pollDeadline)
            ) {
              const hbConfig = getPollIntervalConfig()
              if (hbConfig.non_exclusive_heartbeat_interval_ms <= 0) break

              const info = getHeartbeatInfo()
              if (!info) break

// 容量信号要在心跳请求之前抓：这样请求期间传输丢失会被随后的 sleep 捕捉到（sleep 的 signal 已经包含了那个通道）
              // Capture capacity signal BEFORE the async heartbeat call so
              // a transport loss during the HTTP request is caught by the
              // subsequent sleep.
              const cap = capacitySignal()

              try {
                await api.heartbeatWork(
                  info.environmentId,
                  info.workId,
                  info.sessionToken,
                )
              } catch (err) {
                logForDebugging(
                  `[bridge:repl:heartbeat] Failed: ${errorMessage(err)}`,
                )
// BridgeFatalError 意味着令牌过期（401/403）或工作项没了（404/410）。两条路都说明当前传输彻底没用——SSE 重连与 CCR 写会用同一个过期令牌
                if (err instanceof BridgeFatalError) {
                  cap.cleanup()
                  logEvent('tengu_bridge_heartbeat_error', {
                    status:
                      err.status as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    error_type: (err.status === 401 || err.status === 403
                      ? 'auth_failed'
                      : 'fatal') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  })
                  // JWT expired (401/403) or work item gone (404/410).
                  // Either way the current transport is dead — SSE
                  // reconnects and CCR writes will fail on the same
                  // stale token. If the caller gave us a recovery hook,
                  // tear down work state and skip backoff: isAtCapacity()
                  // flips to false, next outer-loop iteration fast-polls
                  // for the server's re-dispatched work item. Without
                  // the hook, backoff to avoid tight poll+heartbeat loop.
// 有恢复钩子就让调用方拆掉工作状态并跳过退避（isAtCapacity 变 false，下一轮外层循环立刻快轮询拿重派的工作项）；没有钩子只能退避，否则会形成「轮询 + 心跳」的紧密失败循环
                  if (onHeartbeatFatal) {
                    onHeartbeatFatal(err)
                    logForDebugging(
                      `[bridge:repl:heartbeat] Fatal (status=${err.status}), work state cleared — fast-polling for re-dispatch`,
                    )
                  } else {
                    needsBackoff = true
                  }
                  break
                }
              }

              hbCycles++
              await sleep(
                hbConfig.non_exclusive_heartbeat_interval_ms,
                cap.signal,
              )
              cap.cleanup()
            }

// 退出原因要算得精确：它要进埋点，运维靠它区分「到点轮询」与「配置被关」
            const exitReason = needsBackoff
              ? 'error'
              : signal.aborted
                ? 'shutdown'
                : !isAtCapacity()
                  ? 'capacity_changed'
                  : pollDeadline !== null && Date.now() >= pollDeadline
                    ? 'poll_due'
                    : 'config_disabled'
            logEvent('tengu_bridge_heartbeat_mode_exited', {
              reason:
                exitReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              heartbeat_cycles: hbCycles,
            })

            // On auth_failed or fatal, backoff before polling to avoid a
            // tight poll+heartbeat loop. Fall through to the shared sleep
            // below — it's the same capacitySignal-wrapped sleep the legacy
            // path uses, and both need the suspension-overrun check.
// 只要不是需要退避，就直接 continue 回外层循环——poll_due 与 capacity_changed 都是正常路径，不该付一次睡眠
            if (!needsBackoff) {
              if (exitReason === 'poll_due') {
                // bridgeApi throttles empty-poll logs (EMPTY_POLL_LOG_INTERVAL=100)
                // so the once-per-10min poll_due poll is invisible at counter=2.
                // Log it here so verification runs see both endpoints in the debug log.
                logForDebugging(
                  `[bridge:repl] Heartbeat poll_due after ${hbCycles} cycles — falling through to pollForWork`,
                )
              }
              continue
            }
          }
// 满容量睡眠：老路径（心跳关闭）与心跳失败退避路径共用同一段，所以那个「挂起检测」对两者都生效。之前退避路径没有越界检查，笔记本合盖醒来后会直接再睡 10 分钟
          // At-capacity sleep — reached by both the legacy path (heartbeat
          // disabled) and the heartbeat-backoff path (needsBackoff=true).
          // Merged so the suspension detector covers both; previously the
          // backoff path had no overrun check and could go straight back
          // under for 10 min after a laptop wake. Use atCapMs when enabled,
          // else the heartbeat interval as a floor (guaranteed > 0 on the
          // backoff path) so heartbeat-only configs don't tight-loop.
          const sleepMs =
            atCapMs > 0
              ? atCapMs
              : pollConfig.non_exclusive_heartbeat_interval_ms
          if (sleepMs > 0) {
            const cap = capacitySignal()
            const sleepStart = Date.now()
            await sleep(sleepMs, cap.signal)
            cap.cleanup()
// 挂起检测的阈值取 60 秒：setTimeout 超期一分钟以上只可能是进程被挂起了（再糟的 GC 也就几秒）。wakePollLoop 这类提前中止会让超期变成负数，自然落空
            // Process-suspension detector. A setTimeout overshooting its
            // deadline by 60s means the process was suspended (laptop lid,
            // SIGSTOP, VM pause) — even a pathological GC pause is seconds,
            // not minutes. Early aborts (wakePollLoop → cap.signal) produce
            // overrun < 0 and fall through. Note: this only catches sleeps
            // that outlast their deadline; WebSocketTransport's ping
            // interval (10s granularity) is the primary detector for shorter
            // suspensions. This is the backstop for when that detector isn't
            // running (transport mid-reconnect, interval stopped).
            const overrun = Date.now() - sleepStart - sleepMs
            if (overrun > 60_000) {
              logForDebugging(
                `[bridge:repl] At-capacity sleep overran by ${Math.round(overrun / 1000)}s — process suspension detected, forcing one fast-poll cycle`,
              )
              logEvent('tengu_bridge_repl_suspension_detected', {
                overrun_ms: overrun,
              })
              suspensionDetected = true
            }
          }
// 不在满容量时才按常规间隔睡眠——这条路径没有心跳、没有截止时间，单纯等下一轮
        } else {
          await sleep(pollConfig.poll_interval_ms_not_at_capacity, signal)
        }
        continue
      }

// 工作密钥先解码再用：类型分发需要用到里面的会话入口令牌。解不开说明这是一个毒化的工作项，既无法 ack（ack 需要那个 JWT），只能用 OAuth 身份 stopWork 把它还回去，否则 XAUTOCLAIM 会每个周期重投一次
      // Decode before type dispatch — need the JWT for the explicit ack.
      let secret
      try {
        secret = decodeWorkSecret(work.secret)
      } catch (err) {
        logForDebugging(
          `[bridge:repl] Failed to decode work secret: ${errorMessage(err)}`,
        )
        logEvent('tengu_bridge_repl_work_secret_failed', {})
        // Can't ack (needs the JWT we failed to decode). stopWork uses OAuth.
        // Prevents XAUTOCLAIM re-delivering this poisoned item every cycle.
        await api.stopWork(envId, work.id, false).catch(() => {})
        continue
      }

// 显式 ack 防止重投；ack 失败不致命——服务端会重投，onWorkReceived 那边有去重
      // Explicitly acknowledge to prevent redelivery. Non-fatal on failure:
      // server re-delivers, and the onWorkReceived callback handles dedup.
      logForDebugging(`[bridge:repl] Acknowledging workId=${work.id}`)
      try {
        await api.acknowledgeWork(envId, work.id, secret.session_ingress_token)
      } catch (err) {
        logForDebugging(
          `[bridge:repl] Acknowledge failed workId=${work.id}: ${errorMessage(err)}`,
        )
      }

// healthcheck 只需要 ack 就够，不建任何东西。这是服务端用来探测环境存活的轻量工作项
      if (work.data.type === 'healthcheck') {
        logForDebugging('[bridge:repl] Healthcheck received')
        continue
      }

// session 类型才是真正的工作：校验 ID 形状后再回调。use_code_sessions 就是服务端决定走 CCR v2 的开关
      if (work.data.type === 'session') {
        const workSessionId = work.data.id
        try {
          validateBridgeId(workSessionId, 'session_id')
        } catch {
          logForDebugging(
            `[bridge:repl] Invalid session_id in work: ${workSessionId}`,
          )
          continue
        }

        onWorkReceived(
          workSessionId,
          secret.session_ingress_token,
          work.id,
          secret.use_code_sessions === true,
        )
        logForDebugging('[bridge:repl] Work accepted, continuing poll loop')
      }
// 异常处理分四档，优先级从高到低：环境已删除（404）→ 其他致命错误（401/403/404/410）→ 系统休眠导致的预算重置 → 普通错误退避
    } catch (err) {
      if (signal.aborted) break

      // Detect permanent "environment deleted" error — no amount of
      // retrying will recover. Re-register a new environment instead.
      // Checked BEFORE the generic BridgeFatalError bail. pollForWork uses
      // validateStatus: s => s < 500, so 404 is always wrapped into a
      // BridgeFatalError by handleErrorStatus() — never an axios-shaped
      // error. The poll endpoint's only path param is the env ID; 404
      // unambiguously means env-gone (no-work is a 200 with null body).
      // The server sends error.type='not_found_error' (standard Anthropic
      // API shape), not a bridge-specific string — but status===404 is
      // the real signal and survives body-shape changes.
// 404 在这里的含义是唯一的：pollForWork 用 validateStatus 把 5xx 之外全归为桥接致命错误，而轮询端点的唯一路径参数就是环境 ID，所以 404 只能是「环境没了」（没有工作项是 200 加空体）
      if (
        err instanceof BridgeFatalError &&
        err.status === 404 &&
        onEnvironmentLost
      ) {
// 但如果凭据已经被并发重连换掉了，这次 404 是「过期的轮询」打出来的，属预期之内——跳过环境重建，用新凭据重试
        // If credentials have already been refreshed by a concurrent
        // reconnection (e.g. WS close handler), the stale poll's error
        // is expected — skip onEnvironmentLost and retry with fresh creds.
        const currentEnvId = getCredentials().environmentId
        if (envId !== currentEnvId) {
          logForDebugging(
            `[bridge:repl] Stale poll error for old env=${envId}, current env=${currentEnvId} — skipping onEnvironmentLost`,
          )
          consecutiveErrors = 0
          firstErrorTime = null
          continue
        }

// 环境重建计数在这里递增，超过上限就报 failed 并退出循环。注意它只有「轮询成功」才清零，onEnvironmentLost 返回凭据不算——那只证明我们试过了，不代表环境健康
        environmentRecreations++
        logForDebugging(
          `[bridge:repl] Environment deleted, attempting re-registration (attempt ${environmentRecreations}/${MAX_ENVIRONMENT_RECREATIONS})`,
        )
        logEvent('tengu_bridge_repl_env_lost', {
          attempt: environmentRecreations,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)

        if (environmentRecreations > MAX_ENVIRONMENT_RECREATIONS) {
          logForDebugging(
            `[bridge:repl] Environment re-registration limit reached (${MAX_ENVIRONMENT_RECREATIONS}), giving up`,
          )
          onStateChange?.(
            'failed',
            'Environment deleted and re-registration limit reached',
          )
          onFatalError?.()
          break
        }

        onStateChange?.('reconnecting', 'environment lost, recreating session')
// 重建期间发起多个串行网络调用（1 到 5 秒），所以返回之后要重新判中止：拆除若在这个窗口里开始，doReconnect 内部的检查会返回 false，但这里仍需再确认一次，避免优雅退出时冒出一条虚假的 failed 与重复的拆除
        const newCreds = await onEnvironmentLost()
        // doReconnect() makes several sequential network calls (1-5s).
        // If the user triggered teardown during that window, its internal
        // abort checks return false — but we need to re-check here to
        // avoid emitting a spurious 'failed' + onFatalError() during
        // graceful shutdown.
        if (signal.aborted) break
// 拿到新凭据也不清零重建计数：新环境若立刻又死，仍要能命中上限
        if (newCreds) {
          // Credentials are updated in the outer scope via
          // reconnectEnvironmentWithSession — getCredentials() will
          // return the fresh values on the next poll iteration.
          // Do NOT reset environmentRecreations here — onEnvLost returning
          // creds only proves we tried to fix it, not that the env is
          // healthy. A successful poll (above) is the reset point; if the
          // new env immediately dies again we still want the limit to fire.
          consecutiveErrors = 0
          firstErrorTime = null
          onStateChange?.('ready')
          logForDebugging(
            `[bridge:repl] Re-registered environment: ${newCreds.environmentId}`,
          )
          continue
        }

        onStateChange?.(
          'failed',
          'Environment deleted and re-registration failed',
        )
        onFatalError?.()
        break
      }

// 其他致命错误（401/403/404/410）没有重试价值。这里还要区分「到期」与「可抑制的 403」：前者给用户「会话过期，用 /remote-control 重连」的提示，后者（如缺少 environments:manage 权限这类装饰性 403）不报错但依然要拆除，好让清理跑完
      // Fatal errors (401/403/404/410) — no point retrying
      if (err instanceof BridgeFatalError) {
        const isExpiry = isExpiredErrorType(err.errorType)
        const isSuppressible = isSuppressible403(err)
        logForDebugging(
          `[bridge:repl] Fatal poll error: ${err.message} (status=${err.status}, type=${err.errorType ?? 'unknown'})${isSuppressible ? ' (suppressed)' : ''}`,
        )
        logEvent('tengu_bridge_repl_fatal_error', {
          status: err.status,
          error_type:
            err.errorType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        logForDiagnosticsNoPII(
          isExpiry ? 'info' : 'error',
          'bridge_repl_fatal_error',
          { status: err.status, error_type: err.errorType },
        )
        // Cosmetic 403 errors (e.g., external_poll_sessions scope,
        // environments:manage permission) — suppress user-visible error
        // but always trigger teardown so cleanup runs.
        if (!isSuppressible) {
          onStateChange?.(
            'failed',
            isExpiry
              ? 'session expired · /remote-control to reconnect'
              : err.message,
          )
        }
        // Always trigger teardown — matches bridgeMain.ts where fatalExit=true
        // is unconditional and post-loop cleanup always runs.
        onFatalError?.()
        break
      }

// 普通错误：先判系统休眠——如果距上次错误的时间远超最大退避间隔，说明机器睡过觉，把错误预算整个重置，而不是立刻放弃
      const now = Date.now()

      // Detect system sleep/wake: if the gap since the last poll error
      // greatly exceeds the max backoff delay, the machine likely slept.
      // Reset error tracking so we retry with a fresh budget instead of
      // immediately giving up.
      if (
        lastPollErrorTime !== null &&
        now - lastPollErrorTime > POLL_ERROR_MAX_DELAY_MS * 2
      ) {
        logForDebugging(
          `[bridge:repl] Detected system sleep (${Math.round((now - lastPollErrorTime) / 1000)}s gap), resetting poll error budget`,
        )
        logForDiagnosticsNoPII('info', 'bridge_repl_poll_sleep_detected', {
          gapMs: now - lastPollErrorTime,
        })
        consecutiveErrors = 0
        firstErrorTime = null
      }
      lastPollErrorTime = now

      consecutiveErrors++
      if (firstErrorTime === null) {
        firstErrorTime = now
      }
      const elapsed = now - firstErrorTime
      const httpStatus = extractHttpStatus(err)
      const errMsg = describeAxiosError(err)
      const wsLabel = getWsState?.() ?? 'unknown'

      logForDebugging(
        `[bridge:repl] Poll error (attempt ${consecutiveErrors}, elapsed ${Math.round(elapsed / 1000)}s, ws=${wsLabel}): ${errMsg}`,
      )
      logEvent('tengu_bridge_repl_poll_error', {
        status: httpStatus,
        consecutiveErrors,
        elapsedMs: elapsed,
      } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)

// 只在第一次错误时切到 reconnecting：之后一直停在这个状态直到轮询成功，避免界面状态来回闪
      // Only transition to 'reconnecting' on the first error — stay
      // there until a successful poll (avoid flickering the UI state).
      if (consecutiveErrors === 1) {
        onStateChange?.('reconnecting', errMsg)
      }

// 放弃判据是「首个错误到现在已超过 15 分钟」，不是错误次数——指数退避下次数与真实等待时长不成正比
      // Give up after continuous failures
      if (elapsed >= POLL_ERROR_GIVE_UP_MS) {
        logForDebugging(
          `[bridge:repl] Poll failures exceeded ${POLL_ERROR_GIVE_UP_MS / 1000}s (${consecutiveErrors} errors), giving up`,
        )
        logForDiagnosticsNoPII('info', 'bridge_repl_poll_give_up')
        logEvent('tengu_bridge_repl_poll_give_up', {
          consecutiveErrors,
          elapsedMs: elapsed,
          lastStatus: httpStatus,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        onStateChange?.('failed', 'connection to server lost')
        break
      }

// 指数退避 2 → 4 → 8 → 16 → 32 → 60 秒封顶
      // Exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s (cap)
      const backoff = Math.min(
        POLL_ERROR_INITIAL_DELAY_MS * 2 ** (consecutiveErrors - 1),
        POLL_ERROR_MAX_DELAY_MS,
      )
// 退避睡眠之前还要补一次心跳：poll_due 退出心跳循环时租约是健康的，若这之后正好赶上 /poll 故障，不心跳就会让 300 秒的租约白白过期——这正是当初引入心跳要解决的那条数据库鉴权路径
      // The poll_due heartbeat-loop exit leaves a healthy lease exposed to
      // this backoff path. Heartbeat before each sleep so /poll outages
      // (the VerifyEnvironmentSecretAuth DB path heartbeat was introduced to
      // avoid) don't kill the 300s lease TTL.
      if (getPollIntervalConfig().non_exclusive_heartbeat_interval_ms > 0) {
        const info = getHeartbeatInfo?.()
        if (info) {
          try {
            await api.heartbeatWork(
              info.environmentId,
              info.workId,
              info.sessionToken,
            )
          } catch {
            // Best-effort — if heartbeat also fails the lease dies, same as
            // pre-poll_due behavior (where the only heartbeat-loop exits were
            // ones where the lease was already dying).
          }
        }
      }
      await sleep(backoff, signal)
    }
  }

  logForDebugging(
    `[bridge:repl] Work poll loop ended (aborted=${signal.aborted}) env=${getCredentials().environmentId}`,
  )
}

// 三个退避常量与轮询循环本身只为测试导出（命名带 ForTesting 后缀）：测试需要直接构造错误时长，不能真等 15 分钟
// Exported for testing only
export {
  startWorkPollLoop as _startWorkPollLoopForTesting,
  POLL_ERROR_INITIAL_DELAY_MS as _POLL_ERROR_INITIAL_DELAY_MS_ForTesting,
  POLL_ERROR_MAX_DELAY_MS as _POLL_ERROR_MAX_DELAY_MS_ForTesting,
  POLL_ERROR_GIVE_UP_MS as _POLL_ERROR_GIVE_UP_MS_ForTesting,
}
