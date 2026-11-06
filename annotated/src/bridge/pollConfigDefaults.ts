/**
 * Bridge poll interval defaults. Extracted from pollConfig.ts so callers
 * that don't need live GrowthBook tuning (daemon via Agent SDK) can avoid
 * the growthbook.ts → config.ts → file.ts → sessionStorage.ts → commands.ts
 * transitive dependency chain.
 */

/**
 * Poll interval when actively seeking work (no transport / below maxSessions).
 * Governs user-visible "connecting…" latency on initial work pickup and
 * recovery speed after the server re-dispatches a work item.
 */
const POLL_INTERVAL_MS_NOT_AT_CAPACITY = 2000
// 未达容量时的轮询间隔（2s）：影响初始接单与断线恢复延迟

/**
 * Poll interval when the transport is connected. Runs independently of
 * heartbeat — when both are enabled, the heartbeat loop breaks out to poll
 * at this interval. Set to 0 to disable at-capacity polling entirely.
 *
 * Server-side constraints that bound this value:
 * - BRIDGE_LAST_POLL_TTL = 4h (Redis key expiry → environment auto-archived)
 * - max_poll_stale_seconds = 24h (session-creation health gate, currently disabled)
 *
 * 10 minutes gives 24× headroom on the Redis TTL while still picking up
 * server-initiated token-rotation redispatches within one poll cycle.
 * The transport auto-reconnects internally for 10 minutes on transient WS
 * failures, so poll is not the recovery path — it's strictly a liveness
 * signal plus a backstop for permanent close.
 */
const POLL_INTERVAL_MS_AT_CAPACITY = 600_000
// 已达容量时的轮询间隔（10 分钟）：设为 0 可完全关闭

/**
 * Multisession bridge (bridgeMain.ts) poll intervals. Defaults match the
 * single-session values so existing GrowthBook configs without these fields
 * preserve current behavior. Ops can tune these independently via the
 * tengu_bridge_poll_interval_config GB flag.
 */
const MULTISESSION_POLL_INTERVAL_MS_NOT_AT_CAPACITY =
  POLL_INTERVAL_MS_NOT_AT_CAPACITY
// 多会话桥接的轮询间隔默认值（与单会话对齐，便于旧 GB 配置平滑过渡）
const MULTISESSION_POLL_INTERVAL_MS_PARTIAL_CAPACITY =
  POLL_INTERVAL_MS_NOT_AT_CAPACITY
const MULTISESSION_POLL_INTERVAL_MS_AT_CAPACITY = POLL_INTERVAL_MS_AT_CAPACITY
// 多会话三种容量档位间隔：未达 / 部分 / 已满

export type PollIntervalConfig = {
// PollIntervalConfig 类型：把各间隔与回收 / 保活参数打包
  poll_interval_ms_not_at_capacity: number
  poll_interval_ms_at_capacity: number
  non_exclusive_heartbeat_interval_ms: number
  multisession_poll_interval_ms_not_at_capacity: number
  multisession_poll_interval_ms_partial_capacity: number
  multisession_poll_interval_ms_at_capacity: number
  reclaim_older_than_ms: number
  session_keepalive_interval_v2_ms: number
}

export const DEFAULT_POLL_CONFIG: PollIntervalConfig = {
// DEFAULT_POLL_CONFIG：默认配置对象
  poll_interval_ms_not_at_capacity: POLL_INTERVAL_MS_NOT_AT_CAPACITY,
  poll_interval_ms_at_capacity: POLL_INTERVAL_MS_AT_CAPACITY,
// 未达 / 已达容量两个主间隔取自上方常量
  // 0 = disabled. When > 0, at-capacity loops send per-work-item heartbeats
  // at this interval. Independent of poll_interval_ms_at_capacity — both may
  // run (heartbeat periodically yields to poll). 60s gives 5× headroom under
  // the server's 300s heartbeat TTL. Named non_exclusive to distinguish from
  // the old heartbeat_interval_ms field (either-or semantics in pre-#22145
  // clients — heartbeat suppressed poll). Old clients ignore this key; ops
  // can set both fields during rollout.
  non_exclusive_heartbeat_interval_ms: 0,
// 非独占心跳间隔（0=关）：与轮询独立运行，60s 给服务端 300s TTL 留 5 倍余量
  multisession_poll_interval_ms_not_at_capacity:
    MULTISESSION_POLL_INTERVAL_MS_NOT_AT_CAPACITY,
  multisession_poll_interval_ms_partial_capacity:
    MULTISESSION_POLL_INTERVAL_MS_PARTIAL_CAPACITY,
  multisession_poll_interval_ms_at_capacity:
    MULTISESSION_POLL_INTERVAL_MS_AT_CAPACITY,
// 多会话三档间隔同样映射自上方常量
  // Poll query param: reclaim unacknowledged work items older than this.
  // Matches the server's DEFAULT_RECLAIM_OLDER_THAN_MS (work_service.py:24).
  // Enables picking up stale-pending work after JWT expiry, when the prior
  // ack failed because the session_ingress_token was already stale.
  reclaim_older_than_ms: 5000,
// 回收阈值（5s）：认领超过此时长的未确认工作项，匹配服务端默认值
  // 0 = disabled. When > 0, push a silent {type:'keep_alive'} frame to
  // session-ingress at this interval so upstream proxies don't GC an idle
  // remote-control session. 2 min is the default. _v2: bridge-only gate
  // (pre-v2 clients read the old key, new clients ignore it).
  session_keepalive_interval_v2_ms: 120_000,
// 会话保活间隔（2 分钟）：推静默 keep_alive 帧防止上游代理回收空闲远控会话
}
