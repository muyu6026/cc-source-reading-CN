// 文件级：本文件是用量统计缓存的持久化层，把聚合后的每日活动、模型用量、会话汇总等信息落盘到 `stats-cache.json`，并负责并发锁、版本迁移、原子写入与增量合并。
import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { open } from 'fs/promises'
import { join } from 'path'
import type { ModelUsage } from '../entrypoints/agentSdkTypes.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import type { DailyActivity, DailyModelTokens, SessionStats } from './stats.js'

export const STATS_CACHE_VERSION = 3
// `STATS_CACHE_VERSION`：当前缓存结构版本号，版本不符就走迁移或重置。
const MIN_MIGRATABLE_VERSION = 1
// `MIN_MIGRATABLE_VERSION`：低于此版本的老缓存无法迁移，直接丢弃。
const STATS_CACHE_FILENAME = 'stats-cache.json'
// `STATS_CACHE_FILENAME`：缓存文件名固定为 `stats-cache.json`。

/**
 * Simple in-memory lock to prevent concurrent cache operations.
 */
let statsCacheLockPromise: Promise<void> | null = null
// 用一个 Promise 充当内存锁，保证同一时刻只有一个缓存操作在跑。

/**
 * Execute a function while holding the stats cache lock.
 * Only one operation can hold the lock at a time.
 */
// `withStatsCacheLock`：在持锁状态下执行传入函数，先等现有锁释放、再建新锁，`finally` 里总是释放，避免死锁。
export async function withStatsCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for any existing lock to be released
  while (statsCacheLockPromise) {
// 循环等待当前锁释放，再创建自己的锁 Promise。
    await statsCacheLockPromise
  }

  // Create our lock
  let releaseLock: (() => void) | undefined
  statsCacheLockPromise = new Promise<void>(resolve => {
    releaseLock = resolve
  })

  try {
    return await fn()
// 在锁内执行真正的操作，返回值透传给调用方。
  } finally {
    // Release the lock
    statsCacheLockPromise = null
// 无论成功失败都把锁清空并通知等待者。
    releaseLock?.()
  }
}

/**
 * Persisted stats cache stored on disk.
 * Contains aggregated historical stats that won't change.
 * All fields are bounded to prevent unbounded file growth.
 */
export type PersistedStatsCache = {
  version: number
  // Last date that was fully computed (YYYY-MM-DD format)
  // Stats up to and including this date are considered complete
  lastComputedDate: string | null
  // Daily aggregates needed for heatmap, streaks, trends (bounded by days)
  dailyActivity: DailyActivity[]
  dailyModelTokens: DailyModelTokens[]
  // Model usage aggregated (bounded by number of models)
  modelUsage: { [modelName: string]: ModelUsage }
  // Session aggregates (replaces unbounded sessionStats array)
  totalSessions: number
  totalMessages: number
  longestSession: SessionStats | null
  // First session date ever recorded
  firstSessionDate: string | null
  // Hour counts for peak hour calculation (bounded to 24 entries)
  hourCounts: { [hour: number]: number }
  // Speculation time saved across all sessions
  totalSpeculationTimeSavedMs: number
  // Shot distribution: map of shot count → number of sessions (ant-only)
  shotDistribution?: { [shotCount: number]: number }
}
// `PersistedStatsCache`：磁盘缓存的结构，所有字段都有上限（按天、按模型、按小时数）以防文件无限膨胀。

// `getStatsCachePath`：返回缓存文件在配置主目录下的完整路径。
export function getStatsCachePath(): string {
  return join(getClaudeConfigHomeDir(), STATS_CACHE_FILENAME)
}

// `getEmptyCache`：返回一个字段全置默认值的空缓存对象，版本号填当前版。
function getEmptyCache(): PersistedStatsCache {
  return {
    version: STATS_CACHE_VERSION,
    lastComputedDate: null,
    dailyActivity: [],
    dailyModelTokens: [],
    modelUsage: {},
    totalSessions: 0,
    totalMessages: 0,
    longestSession: null,
    firstSessionDate: null,
    hourCounts: {},
    totalSpeculationTimeSavedMs: 0,
    shotDistribution: {},
  }
}

/**
 * Migrate an older cache to the current schema.
 * Returns null if the version is unknown or too old to migrate.
 *
 * Preserves historical aggregates that would otherwise be lost when
 * transcript files have already aged out past cleanupPeriodDays.
 * Pre-migration days may undercount (e.g. v2 lacked subagent tokens);
 * we accept that rather than drop the history.
 */
// `migrateStatsCache`：把老版本缓存迁到当前结构，版本未知或太旧、或结构非法都返回 `null`；保留历史聚合以免转录文件老化后丢数据。
function migrateStatsCache(
  parsed: Partial<PersistedStatsCache> & { version: number },
): PersistedStatsCache | null {
  if (
    typeof parsed.version !== 'number' ||
    parsed.version < MIN_MIGRATABLE_VERSION ||
    parsed.version > STATS_CACHE_VERSION
  ) {
    return null
  }
// 版本号非法（非数字、低于最低可迁移版、高于当前版）则无法迁移。
  if (
    !Array.isArray(parsed.dailyActivity) ||
    !Array.isArray(parsed.dailyModelTokens) ||
    typeof parsed.totalSessions !== 'number' ||
    typeof parsed.totalMessages !== 'number'
  ) {
    return null
  }
// 日常数组与计数字段必须是合法类型，否则结构判定为无效。
  return {
    version: STATS_CACHE_VERSION,
    lastComputedDate: parsed.lastComputedDate ?? null,
    dailyActivity: parsed.dailyActivity,
    dailyModelTokens: parsed.dailyModelTokens,
    modelUsage: parsed.modelUsage ?? {},
    totalSessions: parsed.totalSessions,
    totalMessages: parsed.totalMessages,
    longestSession: parsed.longestSession ?? null,
    firstSessionDate: parsed.firstSessionDate ?? null,
    hourCounts: parsed.hourCounts ?? {},
    totalSpeculationTimeSavedMs: parsed.totalSpeculationTimeSavedMs ?? 0,
    // Preserve undefined (don't default to {}) so the SHOT_STATS recompute
    // check in loadStatsCache fires for v1/v2 caches that lacked this field.
    shotDistribution: parsed.shotDistribution,
  }
// 按当前版重建对象，`shotDistribution` 故意保留 `undefined` 不清成空对象，让加载时的重算检查能触发。
}

/**
 * Load the stats cache from disk.
 * Returns an empty cache if the file doesn't exist or is invalid.
 */
// `loadStatsCache`：从磁盘读缓存，文件不存在或损坏都返回空缓存；版本不符先尝试迁移并落盘。
export async function loadStatsCache(): Promise<PersistedStatsCache> {
  const fs = getFsImplementation()
  const cachePath = getStatsCachePath()

  try {
    const content = await fs.readFile(cachePath, { encoding: 'utf-8' })
    const parsed = jsonParse(content) as PersistedStatsCache

    // Validate version
    if (parsed.version !== STATS_CACHE_VERSION) {
// 版本号不匹配时进入迁移分支。
      const migrated = migrateStatsCache(parsed)
      if (!migrated) {
        logForDebugging(
          `Stats cache version ${parsed.version} not migratable (expected ${STATS_CACHE_VERSION}), returning empty cache`,
        )
        return getEmptyCache()
      }
      logForDebugging(
        `Migrated stats cache from v${parsed.version} to v${STATS_CACHE_VERSION}`,
      )
      // Persist migration so we don't re-migrate on every load.
      // aggregateClaudeCodeStats() skips its save when lastComputedDate is
      // already current, so without this the on-disk file stays at the old
      // version indefinitely.
// 迁移后立刻落盘，避免每次加载都重复迁移（聚合函数在该日期已最新时会跳过保存）。
      await saveStatsCache(migrated)
      if (feature('SHOT_STATS') && !migrated.shotDistribution) {
// 开启 `SHOT_STATS` 但老缓存缺 `shotDistribution` 时，强制返回空缓存触发全量重算。
        logForDebugging(
          'Migrated stats cache missing shotDistribution, forcing recomputation',
        )
        return getEmptyCache()
      }
      return migrated
    }

    // Basic validation
    if (
      !Array.isArray(parsed.dailyActivity) ||
      !Array.isArray(parsed.dailyModelTokens) ||
      typeof parsed.totalSessions !== 'number' ||
      typeof parsed.totalMessages !== 'number'
    ) {
// 对当前版本也做基础结构校验，非法就回退空缓存。
      logForDebugging(
        'Stats cache has invalid structure, returning empty cache',
      )
      return getEmptyCache()
    }

    // If SHOT_STATS is enabled but cache doesn't have shotDistribution,
    // force full recomputation to get historical shot data
    if (feature('SHOT_STATS') && !parsed.shotDistribution) {
// 当前版同样处理 `shotDistribution` 缺失：开启特性就强制重算。
      logForDebugging(
        'Stats cache missing shotDistribution, forcing recomputation',
      )
      return getEmptyCache()
    }

    return parsed
  } catch (error) {
    logForDebugging(`Failed to load stats cache: ${errorMessage(error)}`)
// 任何读取异常都记调试日志并返回空缓存，不让加载失败拖垮调用方。
    return getEmptyCache()
  }
}

/**
 * Save the stats cache to disk atomically.
 * Uses a temp file + rename pattern to prevent corruption.
 */
// `saveStatsCache`：原子写缓存——先写随机名临时文件、再重命名覆盖，避免写到一半损坏。
export async function saveStatsCache(
  cache: PersistedStatsCache,
): Promise<void> {
  const fs = getFsImplementation()
  const cachePath = getStatsCachePath()
  const tempPath = `${cachePath}.${randomBytes(8).toString('hex')}.tmp`
// 临时文件用 8 字节随机十六进制命名，避免并发冲突。

  try {
    // Ensure the directory exists
    const configDir = getClaudeConfigHomeDir()
    try {
      await fs.mkdir(configDir)
    } catch {
      // Directory already exists or other error - proceed
    }

    // Write to temp file with fsync for atomic write safety
    const content = jsonStringify(cache, null, 2)
    const handle = await open(tempPath, 'w', 0o600)
// 以 `0o600` 权限打开临时文件，仅本人可读写。
    try {
      await handle.writeFile(content, { encoding: 'utf-8' })
      await handle.sync()
// 写完立刻 `sync` 落盘，保证原子重命名前的持久性。
    } finally {
      await handle.close()
    }

    // Atomic rename
    await fs.rename(tempPath, cachePath)
// 用重命名完成原子替换，失败时删临时文件并记录错误。
    logForDebugging(
      `Stats cache saved successfully (lastComputedDate: ${cache.lastComputedDate})`,
    )
  } catch (error) {
    logError(error)
    // Clean up temp file
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Merge new stats into an existing cache.
 * Used when incrementally adding new days to the cache.
 */
// `mergeCacheWithNewStats`：把新算出的统计增量合并进已有缓存，按日期/模型聚合，并把会话总数、最长会话、首会话日期等汇总更新。
export function mergeCacheWithNewStats(
  existingCache: PersistedStatsCache,
  newStats: {
    dailyActivity: DailyActivity[]
    dailyModelTokens: DailyModelTokens[]
    modelUsage: { [modelName: string]: ModelUsage }
    sessionStats: SessionStats[]
    hourCounts: { [hour: number]: number }
    totalSpeculationTimeSavedMs: number
    shotDistribution?: { [shotCount: number]: number }
  },
  newLastComputedDate: string,
): PersistedStatsCache {
  // Merge daily activity - combine by date
  const dailyActivityMap = new Map<string, DailyActivity>()
// 用 `Map` 按日期归并每日活动，已有日期就累加计数、没有就新增。
  for (const day of existingCache.dailyActivity) {
    dailyActivityMap.set(day.date, { ...day })
  }
  for (const day of newStats.dailyActivity) {
    const existing = dailyActivityMap.get(day.date)
    if (existing) {
      existing.messageCount += day.messageCount
      existing.sessionCount += day.sessionCount
      existing.toolCallCount += day.toolCallCount
    } else {
      dailyActivityMap.set(day.date, { ...day })
    }
  }

  // Merge daily model tokens - combine by date
  const dailyModelTokensMap = new Map<string, { [model: string]: number }>()
// 按日期归并每日模型 token，再把同模型 token 累加。
  for (const day of existingCache.dailyModelTokens) {
    dailyModelTokensMap.set(day.date, { ...day.tokensByModel })
  }
  for (const day of newStats.dailyModelTokens) {
    const existing = dailyModelTokensMap.get(day.date)
    if (existing) {
      for (const [model, tokens] of Object.entries(day.tokensByModel)) {
        existing[model] = (existing[model] || 0) + tokens
      }
    } else {
      dailyModelTokensMap.set(day.date, { ...day.tokensByModel })
    }
  }

  // Merge model usage
  const modelUsage = { ...existingCache.modelUsage }
// 深合并模型用量，逐项累加 token 与费用，上下文窗口与最大输出取较大值。
  for (const [model, usage] of Object.entries(newStats.modelUsage)) {
    if (modelUsage[model]) {
      modelUsage[model] = {
        inputTokens: modelUsage[model]!.inputTokens + usage.inputTokens,
        outputTokens: modelUsage[model]!.outputTokens + usage.outputTokens,
        cacheReadInputTokens:
          modelUsage[model]!.cacheReadInputTokens + usage.cacheReadInputTokens,
        cacheCreationInputTokens:
          modelUsage[model]!.cacheCreationInputTokens +
          usage.cacheCreationInputTokens,
        webSearchRequests:
          modelUsage[model]!.webSearchRequests + usage.webSearchRequests,
        costUSD: modelUsage[model]!.costUSD + usage.costUSD,
        contextWindow: Math.max(
          modelUsage[model]!.contextWindow,
          usage.contextWindow,
        ),
        maxOutputTokens: Math.max(
          modelUsage[model]!.maxOutputTokens,
          usage.maxOutputTokens,
        ),
      }
    } else {
      modelUsage[model] = { ...usage }
    }
  }

  // Merge hour counts
  const hourCounts = { ...existingCache.hourCounts }
// 合并各小时计数，键转成数字后累加。
  for (const [hour, count] of Object.entries(newStats.hourCounts)) {
    const hourNum = parseInt(hour, 10)
    hourCounts[hourNum] = (hourCounts[hourNum] || 0) + count
  }

  // Update session aggregates
  const totalSessions =
    existingCache.totalSessions + newStats.sessionStats.length
// 会话总数加新会话数，消息总数累加各会话消息量。
  const totalMessages =
    existingCache.totalMessages +
    newStats.sessionStats.reduce((sum, s) => sum + s.messageCount, 0)

  // Find longest session (compare existing with new)
  let longestSession = existingCache.longestSession
// 遍历新会话找出耗时最长者，更新最长会话记录。
  for (const session of newStats.sessionStats) {
    if (!longestSession || session.duration > longestSession.duration) {
      longestSession = session
    }
  }

  // Find first session date
  let firstSessionDate = existingCache.firstSessionDate
// 找出所有会话里时间戳最早的那条，更新首会话日期。
  for (const session of newStats.sessionStats) {
    if (!firstSessionDate || session.timestamp < firstSessionDate) {
      firstSessionDate = session.timestamp
    }
  }

  const result: PersistedStatsCache = {
    version: STATS_CACHE_VERSION,
    lastComputedDate: newLastComputedDate,
    dailyActivity: Array.from(dailyActivityMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    dailyModelTokens: Array.from(dailyModelTokensMap.entries())
      .map(([date, tokensByModel]) => ({ date, tokensByModel }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    modelUsage,
    totalSessions,
    totalMessages,
    longestSession,
    firstSessionDate,
    hourCounts,
    totalSpeculationTimeSavedMs:
      existingCache.totalSpeculationTimeSavedMs +
      newStats.totalSpeculationTimeSavedMs,
  }
// 组装合并结果，每日数组按日期排序后回写。

  if (feature('SHOT_STATS')) {
// 开启 `SHOT_STATS` 时合并 shot 分布计数。
    const shotDistribution: { [shotCount: number]: number } = {
      ...(existingCache.shotDistribution || {}),
    }
    for (const [count, sessions] of Object.entries(
      newStats.shotDistribution || {},
    )) {
      const key = parseInt(count, 10)
      shotDistribution[key] = (shotDistribution[key] || 0) + sessions
    }
    result.shotDistribution = shotDistribution
  }

  return result
}

/**
 * Extract the date portion (YYYY-MM-DD) from a Date object.
 */
// `toDateString`：从 `Date` 取 ISO 串的日期部分（YYYY-MM-DD），无效则抛错。
export function toDateString(date: Date): string {
  const parts = date.toISOString().split('T')
  const dateStr = parts[0]
  if (!dateStr) {
    throw new Error('Invalid ISO date string')
  }
  return dateStr
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
// `getTodayDateString`：返回今天日期串。
export function getTodayDateString(): string {
  return toDateString(new Date())
}

/**
 * Get yesterday's date in YYYY-MM-DD format.
 */
// `getYesterdayDateString`：返回昨天日期串（当前日期减一天）。
export function getYesterdayDateString(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return toDateString(yesterday)
}

/**
 * Check if a date string is before another date string.
 * Both should be in YYYY-MM-DD format.
 */
// `isDateBefore`：按字符串比较判断 `date1` 是否早于 `date2`，两者都需 YYYY-MM-DD 格式。
export function isDateBefore(date1: string, date2: string): boolean {
  return date1 < date2
}
