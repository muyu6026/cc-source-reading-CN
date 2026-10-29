/**
 * Session activity tracking with refcount-based heartbeat timer.
 *
 * The transport registers its keep-alive sender via registerSessionActivityCallback().
 * Callers (API streaming, tool execution) bracket their work with
 * startSessionActivity() / stopSessionActivity(). When the refcount is >0 a
 * periodic timer fires the registered callback every 30 seconds to keep the
 * container alive.
 *
 * Sending keep-alives is gated behind CLAUDE_CODE_REMOTE_SEND_KEEPALIVES.
 * Diagnostic logging always fires to help diagnose idle gaps.
 */

import { registerCleanup } from './cleanupRegistry.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { isEnvTruthy } from './envUtils.js'
// 导入清理注册、无隐私诊断日志与环境变量判断工具。

const SESSION_ACTIVITY_INTERVAL_MS = 30_000
// 心跳间隔固定 30 秒。

export type SessionActivityReason = 'api_call' | 'tool_exec'

let activityCallback: (() => void) | null = null
let refcount = 0
const activeReasons = new Map<SessionActivityReason, number>()
let oldestActivityStartedAt: number | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let cleanupRegistered = false
// 模块级状态：回调、引用计数、各原因的计数表、计时器与启动时间等。

function startHeartbeatTimer(): void {
  clearIdleTimer()
  heartbeatTimer = setInterval(() => {
    logForDiagnosticsNoPII('debug', 'session_keepalive_heartbeat', {
      refcount,
    })
    if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES)) {
      activityCallback?.()
    }
  }, SESSION_ACTIVITY_INTERVAL_MS)
}
// startHeartbeatTimer：每 30 秒触发一次回调（仅在开启发送开关时真正发送），用于保持容器存活。

function startIdleTimer(): void {
  clearIdleTimer()
  if (activityCallback === null) {
    return
  }
  idleTimer = setTimeout(() => {
    logForDiagnosticsNoPII('info', 'session_idle_30s')
    idleTimer = null
  }, SESSION_ACTIVITY_INTERVAL_MS)
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}
// clearIdleTimer：安全清除空闲计时器。

export function registerSessionActivityCallback(cb: () => void): void {
  activityCallback = cb
  // Restart timer if work is already in progress (e.g. reconnect during streaming)
  if (refcount > 0 && heartbeatTimer === null) {
    startHeartbeatTimer()
  }
}
// registerSessionActivityCallback：注册保活回调，若已有工作进行中则顺带重启心跳。

export function unregisterSessionActivityCallback(): void {
  activityCallback = null
  // Stop timer if the callback is removed
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  clearIdleTimer()
}
// unregisterSessionActivityCallback：注销回调并停止计时器。

export function sendSessionActivitySignal(): void {
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES)) {
    activityCallback?.()
  }
}

export function isSessionActivityTrackingActive(): boolean {
  return activityCallback !== null
}
// isSessionActivityTrackingActive：仅当回调已注册才算激活。

/**
 * Increment the activity refcount. When it transitions from 0→1 and a callback
 * is registered, start a periodic heartbeat timer.
 */
export function startSessionActivity(reason: SessionActivityReason): void {
  refcount++
  activeReasons.set(reason, (activeReasons.get(reason) ?? 0) + 1)
  if (refcount === 1) {
    oldestActivityStartedAt = Date.now()
    if (activityCallback !== null && heartbeatTimer === null) {
      startHeartbeatTimer()
    }
  }
  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(async () => {
      logForDiagnosticsNoPII('info', 'session_activity_at_shutdown', {
        refcount,
        active: Object.fromEntries(activeReasons),
        // Only meaningful while work is in-flight; stale otherwise.
        oldest_activity_ms:
          refcount > 0 && oldestActivityStartedAt !== null
            ? Date.now() - oldestActivityStartedAt
            : null,
      })
    })
  }
}
// startSessionActivity：引用计数加一；从 0 变 1 时启动心跳，并在首次调用时注册一个关闭时的诊断日志。

/**
 * Decrement the activity refcount. When it reaches 0, stop the heartbeat timer
 * and start an idle timer that logs after 30s of inactivity.
 */
export function stopSessionActivity(reason: SessionActivityReason): void {
  if (refcount > 0) {
    refcount--
  }
  const n = (activeReasons.get(reason) ?? 0) - 1
  if (n > 0) activeReasons.set(reason, n)
  else activeReasons.delete(reason)
  if (refcount === 0 && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    startIdleTimer()
  }
}
// stopSessionActivity：计数减一；归零时停心跳并启动空闲计时器，30 秒无活动后记录一次 idle 日志。
