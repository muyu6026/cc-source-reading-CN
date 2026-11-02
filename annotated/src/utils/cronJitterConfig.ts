// 定时任务抖动配置的读取与校验。之所以从调度器里拆出来单独成文件，是为了依赖裁剪：公开构建的调度器不该因为要读一个抖动参数，就把整条分析平台客户端及其连带依赖（设置、钩子、配置）拖进产物。
// GrowthBook-backed cron jitter configuration.
//
// Separated from cronScheduler.ts so the scheduler can be bundled in the
// Agent SDK public build without pulling in analytics/growthbook.ts and
// its large transitive dependency set (settings/hooks/config cycle).
//
// Usage:
//   REPL (useScheduledTasks.ts): pass `getJitterConfig: getCronJitterConfig`
//   Daemon/SDK: omit getJitterConfig → DEFAULT_CRON_JITTER_CONFIG applies.

import { z } from 'zod/v4'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../services/analytics/growthbook.js'
import {
  type CronJitterConfig,
  DEFAULT_CRON_JITTER_CONFIG,
} from './cronTasks.js'
import { lazySchema } from './lazySchema.js'

// How often to re-fetch tengu_kairos_cron_config from GrowthBook. Short because
// this is an incident lever — when we push a config change to shed :00 load,
// we want the fleet to converge within a minute, not on the next process
// restart. The underlying call is a synchronous cache read; the refresh just
// clears the memoized entry so the next read triggers a background fetch.
const JITTER_CONFIG_REFRESH_MS = 60 * 1000
// 刷新周期给到一分钟，理由写在注释里：这是一个应急拉杆。要在整点把流量摊开时，希望整个集群在一分钟内收敛，而不是等下次进程重启。底层调用本身是同步的缓存读，所谓刷新只是把记忆化的条目清掉，让下一次读取顺带触发后台拉取。

// Upper bounds here are defense-in-depth against fat-fingered GrowthBook
// pushes. Like pollConfig.ts, Zod rejects the whole object on any violation
// rather than partially trusting it — a config with one bad field falls back
// to DEFAULT_CRON_JITTER_CONFIG entirely. oneShotFloorMs shares oneShotMaxMs's
// ceiling (floor > max would invert the jitter range) and is cross-checked in
// the refine; the shared ceiling keeps the individual bound explicit in the
// error path. recurringMaxAgeMs uses .default() so a pre-existing GB config
// without the field doesn't get wholesale-rejected — the other fields were
// added together at config inception and don't need this.
const HALF_HOUR_MS = 30 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
// 两个上界常量分别对应半小时与三十天。半小时用于各种抖动上限，避免配置失误把等待拉得过长；三十天用于重复任务的最大年龄。
const cronJitterConfigSchema = lazySchema(() =>
  z
    .object({
      recurringFrac: z.number().min(0).max(1),
      recurringCapMs: z.number().int().min(0).max(HALF_HOUR_MS),
      oneShotMaxMs: z.number().int().min(0).max(HALF_HOUR_MS),
      oneShotFloorMs: z.number().int().min(0).max(HALF_HOUR_MS),
      oneShotMinuteMod: z.number().int().min(1).max(60),
      recurringMaxAgeMs: z
        .number()
        .int()
        .min(0)
        .max(THIRTY_DAYS_MS)
        .default(DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs),
    })
    .refine(c => c.oneShotFloorMs <= c.oneShotMaxMs),
)
// 校验策略是「一处不合规整份作废」：只要有一个字段越界，整个对象被 zod 拒绝，调用方回落到内置默认值，而不是部分相信。两条细节值得注意——单次任务的下限与上限共用一个天花板，因为下限大于上限会把抖动区间反转，另有 refine 做交叉校验；最大年龄字段带默认值，这样早期没有该字段的存量配置不会整份被拒。

/**
 * Read `tengu_kairos_cron_config` from GrowthBook, validate, fall back to
 * defaults on absent/malformed/out-of-bounds config. Called from check()
 * every tick via the `getJitterConfig` callback — cheap (synchronous cache
 * hit). Refresh window: JITTER_CONFIG_REFRESH_MS.
 *
 * Exported so ops runbooks can point at a single function when documenting
 * the lever, and so tests can spy on it without mocking GrowthBook itself.
 *
 * Pass this as `getJitterConfig` when calling createCronScheduler in REPL
 * contexts. Daemon/SDK callers omit getJitterConfig and get defaults.
 */
export function getCronJitterConfig(): CronJitterConfig {
  const raw = getFeatureValue_CACHED_WITH_REFRESH<unknown>(
    'tengu_kairos_cron_config',
    DEFAULT_CRON_JITTER_CONFIG,
    JITTER_CONFIG_REFRESH_MS,
  )
  const parsed = cronJitterConfigSchema().safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_CRON_JITTER_CONFIG
}
// 读取侧只做三步：从特性开关取原始值（同步缓存命中，不阻塞）、用 schema 安全解析、成功则用解析结果否则回落到默认。因为 safeParse 不抛异常，这个函数在任何情况下都能返回一份可用的配置。
