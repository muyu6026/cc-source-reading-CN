import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { errorMessage } from '../utils/errors.js'
import { jsonParse } from '../utils/slowOperations.js'

/** Format a millisecond duration as a human-readable string (e.g. "5m 30s"). */
// formatDuration：把毫秒时长格式化成「5m 30s」这类可读字符串
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

/**
 * Decode a JWT's payload segment without verifying the signature.
 * Strips the `sk-ant-si-` session-ingress prefix if present.
 * Returns the parsed JSON payload as `unknown`, or `null` if the
 * token is malformed or the payload is not valid JSON.
 */
// decodeJwtPayload：不校验签名地解码 JWT 载荷段，剥离 `sk-ant-si-` 前缀；解析失败返回 null
export function decodeJwtPayload(token: string): unknown | null {
  const jwt = token.startsWith('sk-ant-si-')
    ? token.slice('sk-ant-si-'.length)
    : token
  const parts = jwt.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    return jsonParse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Decode the `exp` (expiry) claim from a JWT without verifying the signature.
 * @returns The `exp` value in Unix seconds, or `null` if unparseable
 */
// decodeJwtExpiry：从 JWT 解出 `exp` 过期时间（Unix 秒），解析不出返回 null
export function decodeJwtExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token)
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'exp' in payload &&
    typeof payload.exp === 'number'
  ) {
    return payload.exp
  }
  return null
}

/** Refresh buffer: request a new token before expiry. */
// TOKEN_REFRESH_BUFFER_MS：到期前 5 分钟触发刷新的缓冲时间
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

/** Fallback refresh interval when the new token's expiry is unknown. */
// FALLBACK_REFRESH_INTERVAL_MS：新令牌过期未知时回退的刷新间隔（30 分钟）
const FALLBACK_REFRESH_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

/** Max consecutive failures before giving up on the refresh chain. */
// MAX_REFRESH_FAILURES：连续失败上限，超过即放弃整条刷新链
const MAX_REFRESH_FAILURES = 3

/** Retry delay when getAccessToken returns undefined. */
// REFRESH_RETRY_DELAY_MS：getAccessToken 返回 undefined 时的重试延迟（60 秒）
const REFRESH_RETRY_DELAY_MS = 60_000

/**
 * Creates a token refresh scheduler that proactively refreshes session tokens
 * before they expire. Used by both the standalone bridge and the REPL bridge.
 *
 * When a token is about to expire, the scheduler calls `onRefresh` with the
 * session ID and the bridge's OAuth access token. The caller is responsible
 * for delivering the token to the appropriate transport (child process stdin
 * for standalone bridge, WebSocket reconnect for REPL bridge).
 */
// createTokenRefreshScheduler：创建在令牌到期前主动刷新的调度器，独立桥与 REPL 桥共用
export function createTokenRefreshScheduler({
  getAccessToken,
  onRefresh,
  label,
  refreshBufferMs = TOKEN_REFRESH_BUFFER_MS,
}: {
  getAccessToken: () => string | undefined | Promise<string | undefined>
  onRefresh: (sessionId: string, oauthToken: string) => void
  label: string
  /** How long before expiry to fire refresh. Defaults to 5 min. */
  refreshBufferMs?: number
}): {
  schedule: (sessionId: string, token: string) => void
  scheduleFromExpiresIn: (sessionId: string, expiresInSeconds: number) => void
  cancel: (sessionId: string) => void
  cancelAll: () => void
} {
// 三个模块级 Map：timers 持有刷新定时器、failureCounts 记连续失败、generations 记代次以作废在途刷新
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const failureCounts = new Map<string, number>()
  // Generation counter per session — incremented by schedule() and cancel()
  // so that in-flight async doRefresh() calls can detect when they've been
  // superseded and should skip setting follow-up timers.
  const generations = new Map<string, number>()

// nextGeneration：自增某会话代次，让在途的 doRefresh 知道自己已过期应跳过
  function nextGeneration(sessionId: string): number {
    const gen = (generations.get(sessionId) ?? 0) + 1
    generations.set(sessionId, gen)
    return gen
  }

// schedule：按令牌 exp 计算延迟并注册刷新定时器；无法解码时保留已有定时器不破坏刷新链
  function schedule(sessionId: string, token: string): void {
    const expiry = decodeJwtExpiry(token)
    if (!expiry) {
      // Token is not a decodable JWT (e.g. an OAuth token passed from the
      // REPL bridge WebSocket open handler).  Preserve any existing timer
      // (such as the follow-up refresh set by doRefresh) so the refresh
      // chain is not broken.
      logForDebugging(
        `[${label}:token] Could not decode JWT expiry for sessionId=${sessionId}, token prefix=${token.slice(0, 15)}…, keeping existing timer`,
      )
      return
    }

    // Clear any existing refresh timer — we have a concrete expiry to replace it.
    const existing = timers.get(sessionId)
    if (existing) {
      clearTimeout(existing)
    }

    // Bump generation to invalidate any in-flight async doRefresh.
    const gen = nextGeneration(sessionId)

    const expiryDate = new Date(expiry * 1000).toISOString()
    const delayMs = expiry * 1000 - Date.now() - refreshBufferMs
    if (delayMs <= 0) {
      logForDebugging(
        `[${label}:token] Token for sessionId=${sessionId} expires=${expiryDate} (past or within buffer), refreshing immediately`,
      )
      void doRefresh(sessionId, gen)
      return
    }

    logForDebugging(
      `[${label}:token] Scheduled token refresh for sessionId=${sessionId} in ${formatDuration(delayMs)} (expires=${expiryDate}, buffer=${refreshBufferMs / 1000}s)`,
    )

    const timer = setTimeout(doRefresh, delayMs, sessionId, gen)
    timers.set(sessionId, timer)
  }

  /**
   * Schedule refresh using an explicit TTL (seconds until expiry) rather
   * than decoding a JWT's exp claim. Used by callers whose JWT is opaque
   * (e.g. POST /v1/code/sessions/{id}/bridge returns expires_in directly).
   */
// scheduleFromExpiresIn：用显式 TTL（秒）排程刷新，用于不透明 JWT（如服务端直接给 expires_in）
  function scheduleFromExpiresIn(
    sessionId: string,
    expiresInSeconds: number,
  ): void {
    const existing = timers.get(sessionId)
    if (existing) clearTimeout(existing)
    const gen = nextGeneration(sessionId)
    // Clamp to 30s floor — if refreshBufferMs exceeds the server's expires_in
    // (e.g. very large buffer for frequent-refresh testing, or server shortens
    // expires_in unexpectedly), unclamped delayMs ≤ 0 would tight-loop.
    const delayMs = Math.max(expiresInSeconds * 1000 - refreshBufferMs, 30_000)
    logForDebugging(
      `[${label}:token] Scheduled token refresh for sessionId=${sessionId} in ${formatDuration(delayMs)} (expires_in=${expiresInSeconds}s, buffer=${refreshBufferMs / 1000}s)`,
    )
    const timer = setTimeout(doRefresh, delayMs, sessionId, gen)
    timers.set(sessionId, timer)
  }

// doRefresh：真正执行刷新——取访问令牌、判代次过期、失败计数重试、成功后回调 onRefresh 并排后续刷新
  async function doRefresh(sessionId: string, gen: number): Promise<void> {
    let oauthToken: string | undefined
    try {
      oauthToken = await getAccessToken()
    } catch (err) {
      logForDebugging(
        `[${label}:token] getAccessToken threw for sessionId=${sessionId}: ${errorMessage(err)}`,
        { level: 'error' },
      )
    }

    // If the session was cancelled or rescheduled while we were awaiting,
    // the generation will have changed — bail out to avoid orphaned timers.
    if (generations.get(sessionId) !== gen) {
      logForDebugging(
        `[${label}:token] doRefresh for sessionId=${sessionId} stale (gen ${gen} vs ${generations.get(sessionId)}), skipping`,
      )
      return
    }

    if (!oauthToken) {
      const failures = (failureCounts.get(sessionId) ?? 0) + 1
      failureCounts.set(sessionId, failures)
      logForDebugging(
        `[${label}:token] No OAuth token available for refresh, sessionId=${sessionId} (failure ${failures}/${MAX_REFRESH_FAILURES})`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'bridge_token_refresh_no_oauth')
      // Schedule a retry so the refresh chain can recover if the token
      // becomes available again (e.g. transient cache clear during refresh).
      // Cap retries to avoid spamming on genuine failures.
      if (failures < MAX_REFRESH_FAILURES) {
        const retryTimer = setTimeout(
          doRefresh,
          REFRESH_RETRY_DELAY_MS,
          sessionId,
          gen,
        )
        timers.set(sessionId, retryTimer)
      }
      return
    }

    // Reset failure counter on successful token retrieval
    failureCounts.delete(sessionId)

    logForDebugging(
      `[${label}:token] Refreshing token for sessionId=${sessionId}: new token prefix=${oauthToken.slice(0, 15)}…`,
    )
    logEvent('tengu_bridge_token_refreshed', {})
    onRefresh(sessionId, oauthToken)

    // Schedule a follow-up refresh so long-running sessions stay authenticated.
    // Without this, the initial one-shot timer leaves the session vulnerable
    // to token expiry if it runs past the first refresh window.
    const timer = setTimeout(
      doRefresh,
      FALLBACK_REFRESH_INTERVAL_MS,
      sessionId,
      gen,
    )
    timers.set(sessionId, timer)
    logForDebugging(
      `[${label}:token] Scheduled follow-up refresh for sessionId=${sessionId} in ${formatDuration(FALLBACK_REFRESH_INTERVAL_MS)}`,
    )
  }

// cancel：作废单个会话的定时器并自增代次
  function cancel(sessionId: string): void {
    // Bump generation to invalidate any in-flight async doRefresh.
    nextGeneration(sessionId)
    const timer = timers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionId)
    }
    failureCounts.delete(sessionId)
  }

// cancelAll：作废所有会话的定时器与代次，用于整体关闭
  function cancelAll(): void {
    // Bump all generations so in-flight doRefresh calls are invalidated.
    for (const sessionId of generations.keys()) {
      nextGeneration(sessionId)
    }
    for (const timer of timers.values()) {
      clearTimeout(timer)
    }
    timers.clear()
    failureCounts.clear()
  }

  return { schedule, scheduleFromExpiresIn, cancel, cancelAll }
// 返回四个公开方法：schedule / scheduleFromExpiresIn / cancel / cancelAll
}
