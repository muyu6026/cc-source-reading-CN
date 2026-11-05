// 桥接层（remote-control）的协议与依赖接口类型总集：从环境注册、工作项轮询、会话生成、到存活心跳与状态展示，所有跨进程契约都在这里定义。
/** Default per-session timeout (24 hours). */
export const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000
// DEFAULT_SESSION_TIMEOUT_MS：每会话默认超时 24 小时。

/** Reusable login guidance appended to bridge auth errors. */
export const BRIDGE_LOGIN_INSTRUCTION =
  'Remote Control is only available with claude.ai subscriptions. Please use `/login` to sign in with your claude.ai account.'
// BRIDGE_LOGIN_INSTRUCTION：拼到桥接鉴权错误后的登录指引文案。

/** Full error printed when `claude remote-control` is run without auth. */
export const BRIDGE_LOGIN_ERROR =
  'Error: You must be logged in to use Remote Control.\n\n' +
  BRIDGE_LOGIN_INSTRUCTION
// BRIDGE_LOGIN_ERROR：未登录就跑 claude remote-control 时打印的完整错误（含登录指引）。

/** Shown when the user disconnects Remote Control (via /remote-control or ultraplan launch). */
export const REMOTE_CONTROL_DISCONNECTED_MSG = 'Remote Control disconnected.'
// REMOTE_CONTROL_DISCONNECTED_MSG：用户断开远程控制时展示的提示。

// --- Protocol types for the environments API ---

export type WorkData = {
  type: 'session' | 'healthcheck'
  id: string
}
// WorkData：环境回传的工作负载形状（会话或健康检查）。

export type WorkResponse = {
  id: string
  type: 'work'
  environment_id: string
  state: string
  data: WorkData
  secret: string // base64url-encoded JSON
  created_at: string
}
// WorkResponse：pollForWork 取回的工作项，secret 是 base64url 编码的 JSON。

export type WorkSecret = {
  version: number
  session_ingress_token: string
  api_base_url: string
  sources: Array<{
    type: string
    git_info?: { type: string; repo: string; ref?: string; token?: string }
  }>
  auth: Array<{ type: string; token: string }>
  claude_code_args?: Record<string, string> | null
  mcp_config?: unknown | null
  environment_variables?: Record<string, string> | null
  /**
   * Server-driven CCR v2 selector. Set by prepare_work_secret() when the
   * session was created via the v2 compat layer (ccr_v2_compat_enabled).
   * Same field the BYOC runner reads at environment-runner/sessionExecutor.ts.
   */
  use_code_sessions?: boolean
}
// WorkSecret：会话凭证载荷，含 ingress token、api base url、来源 git 信息、auth、可选 CCR v2 选择器 use_code_sessions 等。

// SessionDoneStatus：会话结束三态——完成 / 失败 / 被打断。
export type SessionDoneStatus = 'completed' | 'failed' | 'interrupted'

export type SessionActivityType = 'tool_start' | 'text' | 'result' | 'error'
// SessionActivityType：活动类型——工具启动 / 文本 / 结果 / 错误。

export type SessionActivity = {
  type: SessionActivityType
  summary: string // e.g. "Editing src/foo.ts", "Reading package.json"
  timestamp: number
}
// SessionActivity：单条活动记录（类型 + 摘要 + 时间戳），用于状态行展示。

/**
 * How `claude remote-control` chooses session working directories.
 * - `single-session`: one session in cwd, bridge tears down when it ends
 * - `worktree`: persistent server, every session gets an isolated git worktree
 * - `same-dir`: persistent server, every session shares cwd (can stomp each other)
 */
export type SpawnMode = 'single-session' | 'worktree' | 'same-dir'
// SpawnMode：远程控制选工作目录的策略——单会话（结束即拆桥）、worktree（每会话隔离 git worktree）、同目录（共享 cwd，可能互相踩踏）。

/**
 * Well-known worker_type values THIS codebase produces. Sent as
 * `metadata.worker_type` at environment registration so claude.ai can filter
 * the session picker by origin (e.g. assistant tab only shows assistant
 * workers). The backend treats this as an opaque string — desktop cowork
 * sends `"cowork"`, which isn't in this union. REPL code uses this narrow
 * type for its own exhaustiveness; wire-level fields accept any string.
 */
export type BridgeWorkerType = 'claude_code' | 'claude_code_assistant'
// BridgeWorkerType：本代码库产生的已知 worker_type，注册时作为 metadata.worker_type 让 claude.ai 按来源过滤（如助手标签只显示助手 worker）。后端视其为不透明字符串。

export type BridgeConfig = {
  dir: string
  machineName: string
  branch: string
  gitRepoUrl: string | null
  maxSessions: number
  spawnMode: SpawnMode
  verbose: boolean
  sandbox: boolean
  /** Client-generated UUID identifying this bridge instance. */
  bridgeId: string
  /**
   * Sent as metadata.worker_type so web clients can filter by origin.
   * Backend treats this as opaque — any string, not just BridgeWorkerType.
   */
  workerType: string
  /** Client-generated UUID for idempotent environment registration. */
  environmentId: string
  /**
   * Backend-issued environment_id to reuse on re-register. When set, the
   * backend treats registration as a reconnect to the existing environment
   * instead of creating a new one. Used by `claude remote-control
   * --session-id` resume. Must be a backend-format ID — client UUIDs are
   * rejected with 400.
   */
  reuseEnvironmentId?: string
  /** API base URL the bridge is connected to (used for polling). */
  apiBaseUrl: string
  /** Session ingress base URL for WebSocket connections (may differ from apiBaseUrl locally). */
  sessionIngressUrl: string
  /** Debug file path passed via --debug-file. */
  debugFile?: string
  /** Per-session timeout in milliseconds. Sessions exceeding this are killed. */
  sessionTimeoutMs?: number
}
// BridgeConfig：桥接实例配置——目录、机器名、分支、仓库、最大会话数、生成模式、是否沙箱、各类 UUID 与基础 URL 等。

// --- Dependency interfaces (for testability) ---

/**
 * A control_response event sent back to a session (e.g. a permission decision).
 * The `subtype` is `'success'` per the SDK protocol; the inner `response`
 * carries the permission decision payload (e.g. `{ behavior: 'allow' }`).
 */
export type PermissionResponseEvent = {
  type: 'control_response'
  response: {
    subtype: 'success'
    request_id: string
    response: Record<string, unknown>
  }
}
// PermissionResponseEvent：回传给会话的控制响应事件，外层 subtype 为 success，内层 response 携带权限决策载荷。

export type BridgeApiClient = {
  registerBridgeEnvironment(config: BridgeConfig): Promise<{
    environment_id: string
    environment_secret: string
  }>
  pollForWork(
    environmentId: string,
    environmentSecret: string,
    signal?: AbortSignal,
    reclaimOlderThanMs?: number,
  ): Promise<WorkResponse | null>
  acknowledgeWork(
    environmentId: string,
    workId: string,
    sessionToken: string,
  ): Promise<void>
  /** Stop a work item via the environments API. */
  stopWork(environmentId: string, workId: string, force: boolean): Promise<void>
  /** Deregister/delete the bridge environment on graceful shutdown. */
  deregisterEnvironment(environmentId: string): Promise<void>
  /** Send a permission response (control_response) to a session via the session events API. */
  sendPermissionResponseEvent(
    sessionId: string,
    event: PermissionResponseEvent,
    sessionToken: string,
  ): Promise<void>
  /** Archive a session so it no longer appears as active on the server. */
  archiveSession(sessionId: string): Promise<void>
  /**
   * Force-stop stale worker instances and re-queue a session on an environment.
   * Used by `--session-id` to resume a session after the original bridge died.
   */
  reconnectSession(environmentId: string, sessionId: string): Promise<void>
  /**
   * Send a lightweight heartbeat for an active work item, extending its lease.
   * Uses SessionIngressAuth (JWT, no DB hit) instead of EnvironmentSecretAuth.
   * Returns the server's response with lease status.
   */
  heartbeatWork(
    environmentId: string,
    workId: string,
    sessionToken: string,
  ): Promise<{ lease_extended: boolean; state: string }>
}
// BridgeApiClient：桥接对后端的依赖接口——注册/轮询/确认/停止/注销环境，发送权限响应，归档与会话重连，以及轻量存活心跳。

export type SessionHandle = {
  sessionId: string
  done: Promise<SessionDoneStatus>
  kill(): void
  forceKill(): void
  activities: SessionActivity[] // ring buffer of recent activities (last ~10)
  currentActivity: SessionActivity | null // most recent
  accessToken: string // session_ingress_token for API calls
  lastStderr: string[] // ring buffer of last stderr lines
  writeStdin(data: string): void // write directly to child stdin
  /** Update the access token for a running session (e.g. after token refresh). */
  updateAccessToken(token: string): void
}
// SessionHandle：本地持有的一次会话句柄——done 承诺、kill/forceKill、活动环缓冲、访问令牌与 stderr 环缓冲、写 stdin、刷新令牌。

export type SessionSpawnOpts = {
  sessionId: string
  sdkUrl: string
  accessToken: string
  /** When true, spawn the child with CCR v2 env vars (SSE transport + CCRClient). */
  useCcrV2?: boolean
  /** Required when useCcrV2 is true. Obtained from POST /worker/register. */
  workerEpoch?: number
  /**
   * Fires once with the text of the first real user message seen on the
   * child's stdout (via --replay-user-messages). Lets the caller derive a
   * session title when none exists yet. Tool-result and synthetic user
   * messages are skipped.
   */
  onFirstUserMessage?: (text: string) => void
}
// SessionSpawnOpts：生成子会话的选项——会话 id、sdk url、令牌、是否走 CCR v2、epoch，以及首个真实用户消息回调（用于推导标题）。

export type SessionSpawner = {
  spawn(opts: SessionSpawnOpts, dir: string): SessionHandle
}
// SessionSpawner：生成接口的抽象——给定选项与目录产出一个 SessionHandle。

export type BridgeLogger = {
  printBanner(config: BridgeConfig, environmentId: string): void
  logSessionStart(sessionId: string, prompt: string): void
  logSessionComplete(sessionId: string, durationMs: number): void
  logSessionFailed(sessionId: string, error: string): void
  logStatus(message: string): void
  logVerbose(message: string): void
  logError(message: string): void
  /** Log a reconnection success event after recovering from connection errors. */
  logReconnected(disconnectedMs: number): void
  /** Show idle status with repo/branch info and shimmer animation. */
  updateIdleStatus(): void
  /** Show reconnecting status in the live display. */
  updateReconnectingStatus(delayStr: string, elapsedStr: string): void
  updateSessionStatus(
    sessionId: string,
    elapsed: string,
    activity: SessionActivity,
    trail: string[],
  ): void
  clearStatus(): void
  /** Set repository info for status line display. */
  setRepoInfo(repoName: string, branch: string): void
  /** Set debug log glob shown above the status line (ant users). */
  setDebugLogPath(path: string): void
  /** Transition to "Attached" state when a session starts. */
  setAttached(sessionId: string): void
  /** Show failed status in the live display. */
  updateFailedStatus(error: string): void
  /** Toggle QR code visibility. */
  toggleQr(): void
  /** Update the "<n> of <m> sessions" indicator and spawn mode hint. */
  updateSessionCount(active: number, max: number, mode: SpawnMode): void
  /** Update the spawn mode shown in the session-count line. Pass null to hide (single-session or toggle unavailable). */
  setSpawnModeDisplay(mode: 'same-dir' | 'worktree' | null): void
  /** Register a new session for multi-session display (called after spawn succeeds). */
  addSession(sessionId: string, url: string): void
  /** Update the per-session activity summary (tool being run) in the multi-session list. */
  updateSessionActivity(sessionId: string, activity: SessionActivity): void
  /**
   * Set a session's display title. In multi-session mode, updates the bullet list
   * entry. In single-session mode, also shows the title in the main status line.
   * Triggers a render (guarded against reconnecting/failed states).
   */
  setSessionTitle(sessionId: string, title: string): void
  /** Remove a session from the multi-session display when it ends. */
  removeSession(sessionId: string): void
  /** Force a re-render of the status display (for multi-session activity refresh). */
  refreshDisplay(): void
}
// BridgeLogger：状态展示接口全集——横幅、会话起止/失败、各类实时状态（空闲/重连/失败）、二维码、会话计数与标题、调试日志路径等。
