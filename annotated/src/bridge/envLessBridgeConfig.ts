import { z } from 'zod/v4'
import { getFeatureValue_DEPRECATED } from '../services/analytics/growthbook.js'
import { lazySchema } from '../utils/lazySchema.js'
import { lt } from '../utils/semver.js'
import { isEnvLessBridgeEnabled } from './bridgeEnabled.js'

// 配置形状就是一张超时清单：初始化退避、请求、去重缓冲、心跳、令牌刷新、归档、建连、版本地板
export type EnvLessBridgeConfig = {
  // withRetry — init-phase backoff (createSession, POST /bridge, recovery /bridge)
  init_retry_max_attempts: number
  init_retry_base_delay_ms: number
  init_retry_jitter_fraction: number
  init_retry_max_delay_ms: number
  // axios timeout for POST /sessions, POST /bridge, POST /archive
  http_timeout_ms: number
  // BoundedUUIDSet ring size (echo + re-delivery dedup)
  uuid_dedup_buffer_size: number
  // CCRClient worker heartbeat cadence. Server TTL is 60s — 20s gives 3× margin.
  heartbeat_interval_ms: number
  // ±fraction of interval — per-beat jitter to spread fleet load.
  heartbeat_jitter_fraction: number
  // Fire proactive JWT refresh this long before expires_in. Larger buffer =
  // more frequent refresh (refresh cadence ≈ expires_in - buffer).
// 刷新提前量越大刷新越频繁，节奏约等于有效期减去提前量
  token_refresh_buffer_ms: number
  // Archive POST timeout in teardown(). Distinct from http_timeout_ms because
  // gracefulShutdown races runCleanupFunctions() against a 2s cap — a 10s
  // axios timeout on a slow/stalled archive burns the whole budget on a
  // request that forceExit will kill anyway.
// 归档超时单列一项：退出流程只给两秒预算，沿用通用十秒等于把预算烧在一个注定被杀掉的请求上
  teardown_archive_timeout_ms: number
  // Deadline for onConnect after transport.connect(). If neither onConnect
  // nor onClose fires before this, emit tengu_bridge_repl_connect_timeout
  // — the only telemetry for the ~1% of sessions that emit `started` then
  // go silent (no error, no event, just nothing).
// 建连超时兜的是「既没成功也没失败」的静默会话，这是它唯一的遥测来源
  connect_timeout_ms: number
  // Semver floor for the env-less bridge path. Separate from the v1
  // tengu_bridge_min_version config so a v2-specific bug can force upgrades
  // without blocking v1 (env-based) clients, and vice versa.
// 版本地板与旧版桥接分开：新版出问题可以只逼升新版客户端，互不牵连
  min_version: string
  // When true, tell users their claude.ai app may be too old to see v2
  // sessions — lets us roll the v2 bridge before the app ships the new
  // session-list query.
  should_show_app_upgrade_message: boolean
}

// 默认值全部取保守侧：注册重试三次、心跳二十秒、刷新提前五分钟
export const DEFAULT_ENV_LESS_BRIDGE_CONFIG: EnvLessBridgeConfig = {
  init_retry_max_attempts: 3,
  init_retry_base_delay_ms: 500,
  init_retry_jitter_fraction: 0.25,
  init_retry_max_delay_ms: 4000,
  http_timeout_ms: 10_000,
  uuid_dedup_buffer_size: 2000,
  heartbeat_interval_ms: 20_000,
  heartbeat_jitter_fraction: 0.1,
  token_refresh_buffer_ms: 300_000,
  teardown_archive_timeout_ms: 1500,
  connect_timeout_ms: 15_000,
  min_version: '0.0.0',
  should_show_app_upgrade_message: false,
}

// Floors reject the whole object on violation (fall back to DEFAULT) rather
// than partially trusting — same defense-in-depth as pollConfig.ts.
// 任何一项越界就整份丢弃回默认，不做逐字段修补——半个坏配置比没有配置更难查
const envLessBridgeConfigSchema = lazySchema(() =>
  z.object({
    init_retry_max_attempts: z.number().int().min(1).max(10).default(3),
    init_retry_base_delay_ms: z.number().int().min(100).default(500),
    init_retry_jitter_fraction: z.number().min(0).max(1).default(0.25),
    init_retry_max_delay_ms: z.number().int().min(500).default(4000),
    http_timeout_ms: z.number().int().min(2000).default(10_000),
    uuid_dedup_buffer_size: z.number().int().min(100).max(50_000).default(2000),
    // Server TTL is 60s. Floor 5s prevents thrash; cap 30s keeps ≥2× margin.
// 心跳下界防抖、上界保证至少两倍余量
    heartbeat_interval_ms: z
      .number()
      .int()
      .min(5000)
      .max(30_000)
      .default(20_000),
    // ±fraction per beat. Cap 0.5: at max interval (30s) × 1.5 = 45s worst case,
    // still under the 60s TTL.
// 抖动上限一半：最长间隔三十秒乘一点五仍小于六十秒过期
    heartbeat_jitter_fraction: z.number().min(0).max(0.5).default(0.1),
    // Floor 30s prevents tight-looping. Cap 30min rejects buffer-vs-delay
    // semantic inversion: ops entering expires_in-5min (the *delay until
    // refresh*) instead of 5min (the *buffer before expiry*) yields
    // delayMs = expires_in - buffer ≈ 5min instead of ≈4h. Both are positive
    // durations so .min() alone can't distinguish; .max() catches the
    // inverted value since buffer ≥ 30min is nonsensical for a multi-hour JWT.
// 提前量上界防语义反转：把「距过期多久」误填成「多久后刷新」同样是正数，只有上界能分辨
    token_refresh_buffer_ms: z
      .number()
      .int()
      .min(30_000)
      .max(1_800_000)
      .default(300_000),
    // Cap 2000 keeps this under gracefulShutdown's 2s cleanup race — a higher
    // timeout just lies to axios since forceExit kills the socket regardless.
// 归档超时上界压在两秒以内：超过退出预算的等待只是骗自己
    teardown_archive_timeout_ms: z
      .number()
      .int()
      .min(500)
      .max(2000)
      .default(1500),
    // Observed p99 connect is ~2-3s; 15s is ~5× headroom. Floor 5s bounds
    // false-positive rate under transient slowness; cap 60s bounds how long
    // a truly-stalled session stays dark.
    connect_timeout_ms: z.number().int().min(5_000).max(60_000).default(15_000),
// 版本串用一次比较来验形状：解析不了的字符串在这里就炸，好过在版本检查时炸
    min_version: z
      .string()
      .refine(v => {
        try {
          lt(v, '0.0.0')
          return true
        } catch {
          return false
        }
      })
      .default('0.0.0'),
    should_show_app_upgrade_message: z.boolean().default(false),
  }),
)

/**
 * Fetch the env-less bridge timing config from GrowthBook. Read once per
 * initEnvLessBridgeCore call — config is fixed for the lifetime of a bridge
 * session.
 *
 * Uses the blocking getter (not _CACHED_MAY_BE_STALE) because /remote-control
 * runs well after GrowthBook init — initializeGrowthBook() resolves instantly,
 * so there's no startup penalty, and we get the fresh in-memory remoteEval
 * value instead of the stale-on-first-read disk cache. The _DEPRECATED suffix
 * warns against startup-path usage, which this isn't.
 */
// 读远端配置：每次初始化只读一次，整个会话期间固定不变
export async function getEnvLessBridgeConfig(): Promise<EnvLessBridgeConfig> {
  const raw = await getFeatureValue_DEPRECATED<unknown>(
    'tengu_bridge_repl_v2_config',
    DEFAULT_ENV_LESS_BRIDGE_CONFIG,
  )
// 校验失败静默回默认：配置服务出问题不该让遥控整体不可用
  const parsed = envLessBridgeConfigSchema().safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_ENV_LESS_BRIDGE_CONFIG
}

/**
 * Returns an error message if the current CLI version is below the minimum
 * required for the env-less (v2) bridge path, or null if the version is fine.
 *
 * v2 analogue of checkBridgeMinVersion() — reads from tengu_bridge_repl_v2_config
 * instead of tengu_bridge_min_version so the two implementations can enforce
 * independent floors.
 */
// 版本检查读同一份配置，与旧版的地板互不干扰
export async function checkEnvLessBridgeMinVersion(): Promise<string | null> {
  const cfg = await getEnvLessBridgeConfig()
  if (cfg.min_version && lt(MACRO.VERSION, cfg.min_version)) {
    return `Your version of Claude Code (${MACRO.VERSION}) is too old for Remote Control.\nVersion ${cfg.min_version} or higher is required. Run \`claude update\` to update.`
  }
  return null
}

/**
 * Whether to nudge users toward upgrading their claude.ai app when a
 * Remote Control session starts. True only when the v2 bridge is active
 * AND the should_show_app_upgrade_message config bit is set — lets us
 * roll the v2 bridge before the app ships the new session-list query.
 */
// 应用升级提示要两个条件同时成立：新版桥接生效，且开关打开
export async function shouldShowAppUpgradeMessage(): Promise<boolean> {
  if (!isEnvLessBridgeEnabled()) return false
  const cfg = await getEnvLessBridgeConfig()
  return cfg.should_show_app_upgrade_message
}
