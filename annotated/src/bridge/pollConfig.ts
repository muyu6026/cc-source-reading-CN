// 桥接轮询间隔配置：用 Zod schema 校验 GrowthBook 下发的 JSON，非法就回退默认值
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../services/analytics/growthbook.js'
import { lazySchema } from '../utils/lazySchema.js'
import {
  DEFAULT_POLL_CONFIG,
  type PollIntervalConfig,
} from './pollConfigDefaults.js'

// 设计意图：.min(100) 恢复旧的防御下限；与 clamp 不同，Zod 是整对象拒绝，一个坏字段就整段回退
// .min(100) on the seek-work intervals restores the old Math.max(..., 100)
// defense-in-depth floor against fat-fingered GrowthBook values. Unlike a
// clamp, Zod rejects the whole object on violation — a config with one bad
// field falls back to DEFAULT_POLL_CONFIG entirely rather than being
// partially trusted.
//
// The at_capacity intervals use a 0-or-≥100 refinement: 0 means "disabled"
// (heartbeat-only mode), ≥100 is the fat-finger floor. Values 1–99 are
// rejected so unit confusion (ops thinks seconds, enters 10) doesn't poll
// every 10ms against the VerifyEnvironmentSecretAuth DB path.
//
// The object-level refines require at least one at-capacity liveness
// mechanism enabled: heartbeat OR the relevant poll interval. Without this,
// the hb=0, atCapMs=0 drift config (ops disables heartbeat without
// restoring at_capacity) falls through every throttle site with no sleep —
// tight-looping /poll at HTTP-round-trip speed.
// 复用同一报错文案：容量相关间隔只允许 0（禁用）或 ≥100ms
const zeroOrAtLeast100 = {
  message: 'must be 0 (disabled) or ≥100ms',
}
// 轮询间隔 schema：按是否在容量内和单 / 多会话分四组间隔，外加回收与保活
const pollIntervalConfigSchema = lazySchema(() =>
  z
    .object({
// 非容量间隔必须 ≥100ms：下限挡住手抖填错的小值
      poll_interval_ms_not_at_capacity: z.number().int().min(100),
      // 0 = no at-capacity polling. Independent of heartbeat — both can be
      // enabled (heartbeat runs, periodically breaks out to poll).
// 容量间隔 0 表示禁用，与心跳独立；两者可同时开（心跳跑、定期跳出轮询）
      poll_interval_ms_at_capacity: z
        .number()
        .int()
        .refine(v => v === 0 || v >= 100, zeroOrAtLeast100),
      // 0 = disabled; positive value = heartbeat at this interval while at
      // capacity. Runs alongside at-capacity polling, not instead of it.
      // Named non_exclusive to distinguish from the old heartbeat_interval_ms
      // (either-or semantics in pre-#22145 clients). .default(0) so existing
      // GrowthBook configs without this field parse successfully.
// 心跳间隔 0 = 禁用；命名 non_exclusive 是为了和旧的二选一语义区分开
      non_exclusive_heartbeat_interval_ms: z.number().int().min(0).default(0),
      // Multisession (bridgeMain.ts) intervals. Defaults match the
      // single-session values so existing configs without these fields
      // preserve current behavior.
// 多会话（bridgeMain）间隔：默认值对齐单会话，保证旧配置不丢行为
      multisession_poll_interval_ms_not_at_capacity: z
        .number()
        .int()
        .min(100)
        .default(
          DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_not_at_capacity,
        ),
      multisession_poll_interval_ms_partial_capacity: z
        .number()
        .int()
        .min(100)
        .default(
          DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_partial_capacity,
        ),
      multisession_poll_interval_ms_at_capacity: z
        .number()
        .int()
        .refine(v => v === 0 || v >= 100, zeroOrAtLeast100)
        .default(DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_at_capacity),
      // .min(1) matches the server's ge=1 constraint (work_v1.py:230).
// 回收阈值 min(1) 对齐服务端 ge=1 约束；保活间隔默认 120 秒
      reclaim_older_than_ms: z.number().int().min(1).default(5000),
      session_keepalive_interval_v2_ms: z
        .number()
        .int()
        .min(0)
        .default(120_000),
    })
// 对象级校验：容量内至少要有一个保活机制（心跳或轮询），否则配置会空转 tight-loop
    .refine(
      cfg =>
        cfg.non_exclusive_heartbeat_interval_ms > 0 ||
        cfg.poll_interval_ms_at_capacity > 0,
      {
        message:
          'at-capacity liveness requires non_exclusive_heartbeat_interval_ms > 0 or poll_interval_ms_at_capacity > 0',
      },
    )
    .refine(
      cfg =>
        cfg.non_exclusive_heartbeat_interval_ms > 0 ||
        cfg.multisession_poll_interval_ms_at_capacity > 0,
      {
        message:
          'at-capacity liveness requires non_exclusive_heartbeat_interval_ms > 0 or multisession_poll_interval_ms_at_capacity > 0',
      },
    ),
)

// 从 GrowthBook 取配置并 5 分钟刷新；校验失败整段回退默认，standalone 与 REPL 共用
/**
 * Fetch the bridge poll interval config from GrowthBook with a 5-minute
 * refresh window. Validates the served JSON against the schema; falls back
 * to defaults if the flag is absent, malformed, or partially-specified.
 *
 * Shared by bridgeMain.ts (standalone) and replBridge.ts (REPL) so ops
 * can tune both poll rates fleet-wide with a single config push.
 */
// 取原始值安全解析：成功用解析结果，失败回退 DEFAULT_POLL_CONFIG
export function getPollIntervalConfig(): PollIntervalConfig {
  const raw = getFeatureValue_CACHED_WITH_REFRESH<unknown>(
    'tengu_bridge_poll_interval_config',
    DEFAULT_POLL_CONFIG,
    5 * 60 * 1000,
  )
  const parsed = pollIntervalConfigSchema().safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_POLL_CONFIG
}
