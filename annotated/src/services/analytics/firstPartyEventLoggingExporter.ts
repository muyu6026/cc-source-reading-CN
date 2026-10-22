// 【第 1-56 行】`firstPartyEventLoggingExporter.ts` 是 1P 后端的**导出器（Exporter）**，
//     实现 OTel 的 `LogRecordExporter` 接口。它和 `firstPartyEventLogger.ts` 的关系是：
//     logger 负责「收集 + 触发导出」，本文件负责「**怎么把事件可靠地发到服务器**」。
//     注释开头把这套 Exporter 在 BatchLogRecordProcessor 之上的额外韧性列得很全：
//     追加式失败日志、二次方退避、成功后立刻重试排队事件、大批次分片、401 时退化为无 auth 重试。
import type { HrTime } from '@opentelemetry/api'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { appendFile, mkdir, readdir, unlink, writeFile } from 'fs/promises'
import * as path from 'path'
import type { CoreUserData } from 'src/utils/user.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import { ClaudeCodeInternalEvent } from '../../types/generated/events_mono/claude_code/v1/claude_code_internal_event.js'
import { GrowthbookExperimentEvent } from '../../types/generated/events_mono/growthbook/v1/growthbook_experiment_event.js'
import {
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage, isFsInaccessible, toError } from '../../utils/errors.js'
import { getAuthHeaders } from '../../utils/http.js'
import { readJSONLFile } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { isOAuthTokenExpired } from '../oauth/client.js'
import { stripProtoFields } from './index.js'
import { type EventMetadata, to1PEventFormat } from './metadata.js'

// Unique ID for this process run - used to isolate failed event files between runs
// 【第 37-46 行】`BATCH_UUID` 是**本进程运行**的唯一 ID，`getStorageDir()` 返回
//     `~/.claude/telemetry`。这两个配合实现「**跨进程重启的失败事件恢复**」：
//     失败事件按 `1p_failed_events.<sessionId>.<BATCH_UUID>.json` 存盘，
//     文件名里带 BATCH_UUID，所以**重启后只重试上一 session、不会误吞别人或自己当前批**（见第 220 行）。
//     路径在运行时才求值（第 43 行注释），是为了尊重测试里的 `CLAUDE_CONFIG_DIR` 覆盖。
const BATCH_UUID = randomUUID()

// File prefix for failed event storage
const FILE_PREFIX = '1p_failed_events.'

// Storage directory for failed events - evaluated at runtime to respect CLAUDE_CONFIG_DIR in tests
function getStorageDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'telemetry')
}

// API envelope - event_data is the JSON output from proto toJSON()
type FirstPartyEventLoggingEvent = {
  event_type: 'ClaudeCodeInternalEvent' | 'GrowthbookExperimentEvent'
  event_data: unknown
}

type FirstPartyEventLoggingPayload = {
  events: FirstPartyEventLoggingEvent[]
}

/**
 * Exporter for 1st-party event logging to /api/event_logging/batch.
 *
 * Export cycles are controlled by OpenTelemetry's BatchLogRecordProcessor, which
 * triggers export() when either:
 * - Time interval elapses (default: 5 seconds via scheduledDelayMillis)
 * - Batch size is reached (default: 200 events via maxExportBatchSize)
 *
 * This exporter adds resilience on top:
 * - Append-only log for failed events (concurrency-safe)
 * - Quadratic backoff retry for failed events, dropped after maxAttempts
 * - Immediate retry of queued events when any export succeeds (endpoint is healthy)
 * - Chunking large event sets into smaller batches
 * - Auth fallback: retries without auth on 401 errors
 */
export class FirstPartyEventLoggingExporter implements LogRecordExporter {
// 【第 73-139 行】构造函数里一堆 `?? / ||` 默认值，值得留意几个：
//     - `baseUrl`（第 114-118 行）：默认生产 `api.anthropic.com`，**仅当** ANTHROPIC_BASE_URL 显式是
//       staging 时才用 staging；可被动态配置覆盖
//     - `maxAttempts ?? 8`：最多重试 8 次后丢弃（第 128 行）
//     - `schedule`（第 130 行）：注入式定时器，默认 `setTimeout`，**可注入是为了测试时摆脱真实时钟**
//     构造末尾第 138 行 `void this.retryPreviousBatches()` 在后台重试上一 session 的失败文件——
//     这是「启动时静默续传」，用户完全无感。
  private readonly endpoint: string
  private readonly timeout: number
  private readonly maxBatchSize: number
  private readonly skipAuth: boolean
  private readonly batchDelayMs: number
  private readonly baseBackoffDelayMs: number
  private readonly maxBackoffDelayMs: number
  private readonly maxAttempts: number
  private readonly isKilled: () => boolean
  private pendingExports: Promise<void>[] = []
  private isShutdown = false
  private readonly schedule: (
    fn: () => Promise<void>,
    delayMs: number,
  ) => () => void
  private cancelBackoff: (() => void) | null = null
  private attempts = 0
  private isRetrying = false
  private lastExportErrorContext: string | undefined

  constructor(
    options: {
      timeout?: number
      maxBatchSize?: number
      skipAuth?: boolean
      batchDelayMs?: number
      baseBackoffDelayMs?: number
      maxBackoffDelayMs?: number
      maxAttempts?: number
      path?: string
      baseUrl?: string
      // Injected killswitch probe. Checked per-POST so that disabling the
      // firstParty sink also stops backoff retries (not just new emits).
      // Passed in rather than imported to avoid a cycle with firstPartyEventLogger.ts.
      isKilled?: () => boolean
      schedule?: (fn: () => Promise<void>, delayMs: number) => () => void
    } = {},
  ) {
    // Default: prod, except when ANTHROPIC_BASE_URL is explicitly staging.
    // Overridable via tengu_1p_event_batch_config.baseUrl.
    const baseUrl =
      options.baseUrl ||
      (process.env.ANTHROPIC_BASE_URL === 'https://api-staging.anthropic.com'
        ? 'https://api-staging.anthropic.com'
        : 'https://api.anthropic.com')

    this.endpoint = `${baseUrl}${options.path || '/api/event_logging/batch'}`

    this.timeout = options.timeout || 10000
    this.maxBatchSize = options.maxBatchSize || 200
    this.skipAuth = options.skipAuth ?? false
    this.batchDelayMs = options.batchDelayMs || 100
    this.baseBackoffDelayMs = options.baseBackoffDelayMs || 500
    this.maxBackoffDelayMs = options.maxBackoffDelayMs || 30000
    this.maxAttempts = options.maxAttempts ?? 8
    this.isKilled = options.isKilled ?? (() => false)
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      })

    // Retry any failed events from previous runs of this session (in background)
    void this.retryPreviousBatches()
  }

  // Expose for testing
  async getQueuedEventCount(): Promise<number> {
    return (await this.loadEventsFromCurrentBatch()).length
  }

  // --- Storage helpers ---
// 【第 146-216 行】一组存储 helper，全部走 JSONL（每行一个事件）。
//     - `saveEventsToFile`（第 171 行）：空了就删文件、非空就整文件重写（不是追加）
//     - `appendEventsToFile`（第 194 行）：**追加**，注释说「在大多数文件系统上是原子的」——
//       因为并发写同一个失败文件时，append 不会把两条记录交错
//     → 设计上把「整批重写」和「增量追加」两个语义分开，避免互相干扰。

  private getCurrentBatchFilePath(): string {
    return path.join(
      getStorageDir(),
      `${FILE_PREFIX}${getSessionId()}.${BATCH_UUID}.json`,
    )
  }

  private async loadEventsFromFile(
    filePath: string,
  ): Promise<FirstPartyEventLoggingEvent[]> {
    try {
      return await readJSONLFile<FirstPartyEventLoggingEvent>(filePath)
    } catch {
      return []
    }
  }

  private async loadEventsFromCurrentBatch(): Promise<
    FirstPartyEventLoggingEvent[]
  > {
    return this.loadEventsFromFile(this.getCurrentBatchFilePath())
  }

  private async saveEventsToFile(
    filePath: string,
    events: FirstPartyEventLoggingEvent[],
  ): Promise<void> {
    try {
      if (events.length === 0) {
        try {
          await unlink(filePath)
        } catch {
          // File doesn't exist, nothing to delete
        }
      } else {
        // Ensure storage directory exists
        await mkdir(getStorageDir(), { recursive: true })
        // Write as JSON lines (one event per line)
        const content = events.map(e => jsonStringify(e)).join('\n') + '\n'
        await writeFile(filePath, content, 'utf8')
      }
    } catch (error) {
      logError(error)
    }
  }

  private async appendEventsToFile(
    filePath: string,
    events: FirstPartyEventLoggingEvent[],
  ): Promise<void> {
    if (events.length === 0) return
    try {
      // Ensure storage directory exists
      await mkdir(getStorageDir(), { recursive: true })
      // Append as JSON lines (one event per line) - atomic on most filesystems
      const content = events.map(e => jsonStringify(e)).join('\n') + '\n'
      await appendFile(filePath, content, 'utf8')
    } catch (error) {
      logError(error)
    }
  }

  private async deleteFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    } catch {
      // File doesn't exist or can't be deleted, ignore
    }
  }

  // --- Previous batch retry (startup) ---
// 【第 220-275 行】`retryPreviousBatches`（启动）和 `retryFileInBackground`（单文件）：
//     启动时扫 storage 目录里「本 session、但 BATCH_UUID 不是当前」的 `.json` 文件（排除当前批），
//     逐个后台重试。第 243-245 行：单文件重试次数也受 `maxAttempts` 限制，超限直接删文件丢弃——
//     「重试」和「丢弃」的边界是**次数**，不是「永远试」。第 266-273 行：重试后只把**失败的那部分**
//     写回磁盘，不重写原始全部，省一次 IO。

  private async retryPreviousBatches(): Promise<void> {
    try {
      const prefix = `${FILE_PREFIX}${getSessionId()}.`
      let files: string[]
      try {
        files = (await readdir(getStorageDir()))
          .filter((f: string) => f.startsWith(prefix) && f.endsWith('.json'))
          .filter((f: string) => !f.includes(BATCH_UUID)) // Exclude current batch
      } catch (e) {
        if (isFsInaccessible(e)) return
        throw e
      }

      for (const file of files) {
        const filePath = path.join(getStorageDir(), file)
        void this.retryFileInBackground(filePath)
      }
    } catch (error) {
      logError(error)
    }
  }

  private async retryFileInBackground(filePath: string): Promise<void> {
    if (this.attempts >= this.maxAttempts) {
      await this.deleteFile(filePath)
      return
    }

    const events = await this.loadEventsFromFile(filePath)
    if (events.length === 0) {
      await this.deleteFile(filePath)
      return
    }

    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `1P event logging: retrying ${events.length} events from previous batch`,
      )
    }

    const failedEvents = await this.sendEventsInBatches(events)
    if (failedEvents.length === 0) {
      await this.deleteFile(filePath)
      if (process.env.USER_TYPE === 'ant') {
        logForDebugging('1P event logging: previous batch retry succeeded')
      }
    } else {
      // Save only the failed events back (not all original events)
      await this.saveEventsToFile(filePath, failedEvents)
      if (process.env.USER_TYPE === 'ant') {
        logForDebugging(
          `1P event logging: previous batch retry failed, ${failedEvents.length} events remain`,
        )
      }
    }
  }

  async export(
// 【第 277-304 行】`export()` 是 OTel 调的入口。它把每次导出都 push 进 `pendingExports` 数组，
//     再用 `.finally` 在完成后从数组里移除（第 298-303 行）。这个数组给 `forceFlush()` 用——
//     shutdown 时要等所有在途导出结束。`isShutdown` 后直接返回 FAILED（第 281-292 行），
//     防止进程退出最后阶段还在往已关闭的通道写。
    logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    if (this.isShutdown) {
      if (process.env.USER_TYPE === 'ant') {
        logForDebugging(
          '1P event logging export failed: Exporter has been shutdown',
        )
      }
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('Exporter has been shutdown'),
      })
      return
    }

    const exportPromise = this.doExport(logs, resultCallback)
    this.pendingExports.push(exportPromise)

    // Clean up completed exports
    void exportPromise.finally(() => {
      const index = this.pendingExports.indexOf(exportPromise)
      if (index > -1) {
        void this.pendingExports.splice(index, 1)
      }
    })
  }

  private async doExport(
// 【第 306-377 行】`doExport` 是真正的导出逻辑，几道闸门：
//     - 第 312 行按 `instrumentationScope.name` 过滤，只处理本模块自己的事件（隔离客户遥测）
//     - 第 330 行 `attempts >= maxAttempts` 直接 FAILED 丢弃
//     - 第 341 行发送，第 342 行 `attempts++`（**无论成败都 +1**，因为一次导出尝试就是一次）
//     - 失败时（第 344 行）排队到磁盘 + 调度退避重试；成功时（第 360 行）reset 退避并**立刻**重试排队事件
//     → 这套「成功即清退避、立即排空」让 endpoint 一旦恢复就能快速追上积压。
    logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    try {
      // Filter for event logs only (by scope name)
      const eventLogs = logs.filter(
        log =>
          log.instrumentationScope?.name === 'com.anthropic.claude_code.events',
      )

      if (eventLogs.length === 0) {
        resultCallback({ code: ExportResultCode.SUCCESS })
        return
      }

      // Transform new logs (failed events are retried independently via backoff)
      const events = this.transformLogsToEvents(eventLogs).events

      if (events.length === 0) {
        resultCallback({ code: ExportResultCode.SUCCESS })
        return
      }

      if (this.attempts >= this.maxAttempts) {
        resultCallback({
          code: ExportResultCode.FAILED,
          error: new Error(
            `Dropped ${events.length} events: max attempts (${this.maxAttempts}) reached`,
          ),
        })
        return
      }

      // Send events
      const failedEvents = await this.sendEventsInBatches(events)
      this.attempts++

      if (failedEvents.length > 0) {
        await this.queueFailedEvents(failedEvents)
        this.scheduleBackoffRetry()
        const context = this.lastExportErrorContext
          ? ` (${this.lastExportErrorContext})`
          : ''
        resultCallback({
          code: ExportResultCode.FAILED,
          error: new Error(
            `Failed to export ${failedEvents.length} events${context}`,
          ),
        })
        return
      }

      // Success - reset backoff and immediately retry any queued events
      this.resetBackoff()
      if ((await this.getQueuedEventCount()) > 0 && !this.isRetrying) {
        void this.retryFailedEvents()
      }
      resultCallback({ code: ExportResultCode.SUCCESS })
    } catch (error) {
      if (process.env.USER_TYPE === 'ant') {
        logForDebugging(
          `1P event logging export failed: ${errorMessage(error)}`,
        )
      }
      logError(error)
      resultCallback({
        code: ExportResultCode.FAILED,
        error: toError(error),
      })
    }
  }

  private async sendEventsInBatches(
// 【第 379-428 行】`sendEventsInBatches` 把事件按 `maxBatchSize` 切片，逐批发送。
//     关键策略在第 394-416 行：**第一批一失败，就假设 endpoint 挂了，剩下的批全部 short-circuit**
//     （不再 POST，直接归入 failedEvents），退避定时器下一 tick 再用单批探测。
//     这避免了「endpoint 已挂、还逐个重试后面 N 个批」的浪费。`lastErrorContext` 被记下来带进结果，
//     方便日志里看到是哪种失败（第 423-425 行）。
    events: FirstPartyEventLoggingEvent[],
  ): Promise<FirstPartyEventLoggingEvent[]> {
    // Chunk events into batches
    const batches: FirstPartyEventLoggingEvent[][] = []
    for (let i = 0; i < events.length; i += this.maxBatchSize) {
      batches.push(events.slice(i, i + this.maxBatchSize))
    }

    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `1P event logging: exporting ${events.length} events in ${batches.length} batch(es)`,
      )
    }

    // Send each batch with delay between them. On first failure, assume the
    // endpoint is down and short-circuit: queue the failed batch plus all
    // remaining unsent batches without POSTing them. The backoff retry will
    // probe again with a single batch next tick.
    const failedBatchEvents: FirstPartyEventLoggingEvent[] = []
    let lastErrorContext: string | undefined
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!
      try {
        await this.sendBatchWithRetry({ events: batch })
      } catch (error) {
        lastErrorContext = getAxiosErrorContext(error)
        for (let j = i; j < batches.length; j++) {
          failedBatchEvents.push(...batches[j]!)
        }
        if (process.env.USER_TYPE === 'ant') {
          const skipped = batches.length - 1 - i
          logForDebugging(
            `1P event logging: batch ${i + 1}/${batches.length} failed (${lastErrorContext}); short-circuiting ${skipped} remaining batch(es)`,
          )
        }
        break
      }

      if (i < batches.length - 1 && this.batchDelayMs > 0) {
        await sleep(this.batchDelayMs)
      }
    }

    if (failedBatchEvents.length > 0 && lastErrorContext) {
      this.lastExportErrorContext = lastErrorContext
    }

    return failedBatchEvents
  }

  private async queueFailedEvents(
// 【第 430-443 行】`queueFailedEvents` 用**追加**方式把失败事件写盘（第 436 行 appendEventsToFile），
//     注释再次强调「append-only，原子」。然后把上下文拼进报错 message 调 `logError`——
//     失败事件被排队这件事本身也要被记录，否则就真的静默消失了。
    events: FirstPartyEventLoggingEvent[],
  ): Promise<void> {
    const filePath = this.getCurrentBatchFilePath()

    // Append-only: just add new events to file (atomic on most filesystems)
    await this.appendEventsToFile(filePath, events)

    const context = this.lastExportErrorContext
      ? ` (${this.lastExportErrorContext})`
      : ''
    const message = `1P event logging: ${events.length} events failed to export${context}`
    logError(new Error(message))
  }

  private scheduleBackoffRetry(): void {
// 【第 445-467 行】`scheduleBackoffRetry` 用**二次方退避**（第 451-455 行）：
//     `delay = min(base * attempts², max)`，注释说「匹配 Statsig SDK」—— 这是和成熟 SDK 对齐的刻意选择，
//     不是自己拍的。三个早退条件（已退避中 / 已 shutdown / 已被取消）防止重复调度。
//     注入式 `schedule`（构造时传入）让定时器可测试。
    // Don't schedule if already retrying or shutdown
    if (this.cancelBackoff || this.isRetrying || this.isShutdown) {
      return
    }

    // Quadratic backoff (matching Statsig SDK): base * attempts²
    const delay = Math.min(
      this.baseBackoffDelayMs * this.attempts * this.attempts,
      this.maxBackoffDelayMs,
    )

    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `1P event logging: scheduling backoff retry in ${delay}ms (attempt ${this.attempts})`,
      )
    }

    this.cancelBackoff = this.schedule(async () => {
      this.cancelBackoff = null
      await this.retryFailedEvents()
    }, delay)
  }

  private async retryFailedEvents(): Promise<void> {
// 【第 469-517 行】`retryFailedEvents` 是一个**排空循环**：只要没 shutdown、文件里还有事件，就反复读盘→发→删文件→发。
//     第 491 行「**先删文件再重试**」（事件已在内存里了）—— 这很关键：如果先发再删，发到一半进程崩了，
//     文件还在，下次会重复发；而先删再发，崩了就丢这批（可接受，因为终会重试耗尽）。
//     第 504-508 行：失败就写回磁盘 + 调度退避 + return（等下一轮），成功就 reset 退避继续循环排空。
    const filePath = this.getCurrentBatchFilePath()

    // Keep retrying while there are events and endpoint is healthy
    while (!this.isShutdown) {
      const events = await this.loadEventsFromFile(filePath)
      if (events.length === 0) break

      if (this.attempts >= this.maxAttempts) {
        if (process.env.USER_TYPE === 'ant') {
          logForDebugging(
            `1P event logging: max attempts (${this.maxAttempts}) reached, dropping ${events.length} events`,
          )
        }
        await this.deleteFile(filePath)
        this.resetBackoff()
        return
      }

      this.isRetrying = true

      // Clear file before retry (we have events in memory now)
      await this.deleteFile(filePath)

      if (process.env.USER_TYPE === 'ant') {
        logForDebugging(
          `1P event logging: retrying ${events.length} failed events (attempt ${this.attempts + 1})`,
        )
      }

      const failedEvents = await this.sendEventsInBatches(events)
      this.attempts++

      this.isRetrying = false

      if (failedEvents.length > 0) {
        // Write failures back to disk
        await this.saveEventsToFile(filePath, failedEvents)
        this.scheduleBackoffRetry()
        return // Failed - wait for backoff
      }

      // Success - reset backoff and continue loop to drain any newly queued events
      this.resetBackoff()
      if (process.env.USER_TYPE === 'ant') {
        logForDebugging('1P event logging: backoff retry succeeded')
      }
    }
  }

  private resetBackoff(): void {
    this.attempts = 0
    if (this.cancelBackoff) {
      this.cancelBackoff()
      this.cancelBackoff = null
    }
  }

  private async sendBatchWithRetry(
// 【第 527-615 行】`sendBatchWithRetry` 是最底层的一次 POST，几个要点：
//     - 第 530-536 行：如果 `isKilled()` 为 true，**直接 throw**—— 让上层 short-circuit 剩余批并全部落盘，
//       被杀期间**零网络流量**；退避定时器继续走，GrowthBook 缓存一旦清掉 flag，下一 tick 自动恢复
//     - 第 547-568 行：**信任未建立时跳过 auth**（避免信任弹窗前就执行 apiKeyHelper），
//       OAuth token 过期或缺少 `user:profile` scope（service key 会话）时也跳过，退化为无 auth 发送
//     - 第 594-611 行：**401 时重试不带 auth**（带 auth 反而被拒时，裸发一次兜底）
    payload: FirstPartyEventLoggingPayload,
  ): Promise<void> {
    if (this.isKilled()) {
      // Throw so the caller short-circuits remaining batches and queues
      // everything to disk. Zero network traffic while killed; the backoff
      // timer keeps ticking and will resume POSTs as soon as the GrowthBook
      // cache picks up the cleared flag.
      throw new Error('firstParty sink killswitch active')
    }

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getClaudeCodeUserAgent(),
      'x-service-name': 'claude-code',
    }

    // Skip auth if trust hasn't been established yet
    // This prevents executing apiKeyHelper commands before the trust dialog
    // Non-interactive sessions implicitly have workspace trust
    const hasTrust =
      checkHasTrustDialogAccepted() || getIsNonInteractiveSession()
    if (process.env.USER_TYPE === 'ant' && !hasTrust) {
      logForDebugging('1P event logging: Trust not accepted')
    }

    // Skip auth when the OAuth token is expired or lacks user:profile
    // scope (service key sessions). Falls through to unauthenticated send.
    let shouldSkipAuth = this.skipAuth || !hasTrust
    if (!shouldSkipAuth && isClaudeAISubscriber()) {
      const tokens = getClaudeAIOAuthTokens()
      if (!hasProfileScope()) {
        shouldSkipAuth = true
      } else if (tokens && isOAuthTokenExpired(tokens.expiresAt)) {
        shouldSkipAuth = true
        if (process.env.USER_TYPE === 'ant') {
          logForDebugging(
            '1P event logging: OAuth token expired, skipping auth to avoid 401',
          )
        }
      }
    }

    // Try with auth headers first (unless trust not established or token is known to be expired)
    const authResult = shouldSkipAuth
      ? { headers: {}, error: 'trust not established or Oauth token expired' }
      : getAuthHeaders()
    const useAuth = !authResult.error

    if (!useAuth && process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `1P event logging: auth not available, sending without auth`,
      )
    }

    const headers = useAuth
      ? { ...baseHeaders, ...authResult.headers }
      : baseHeaders

    try {
      const response = await axios.post(this.endpoint, payload, {
        timeout: this.timeout,
        headers,
      })
      this.logSuccess(payload.events.length, useAuth, response.data)
      return
    } catch (error) {
      // Handle 401 by retrying without auth
      if (
        useAuth &&
        axios.isAxiosError(error) &&
        error.response?.status === 401
      ) {
        if (process.env.USER_TYPE === 'ant') {
          logForDebugging(
            '1P event logging: 401 auth error, retrying without auth',
          )
        }
        const response = await axios.post(this.endpoint, payload, {
          timeout: this.timeout,
          headers: baseHeaders,
        })
        this.logSuccess(payload.events.length, false, response.data)
        return
      }

      throw error
    }
  }

  private logSuccess(
    eventCount: number,
    withAuth: boolean,
    responseData: unknown,
  ): void {
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `1P event logging: ${eventCount} events exported successfully${withAuth ? ' (with auth)' : ' (without auth)'}`,
      )
      logForDebugging(`API Response: ${jsonStringify(responseData, null, 2)}`)
    }
  }

  private hrTimeToDate(hrTime: HrTime): Date {
    const [seconds, nanoseconds] = hrTime
    return new Date(seconds * 1000 + nanoseconds / 1000000)
  }

  private transformLogsToEvents(
// 【第 635-762 行】`transformLogsToEvents` 把 OTel 的 `ReadableLogRecord` 翻成 1P 的事件格式。
//     第 643-669 行先判是不是 GrowthBook 实验事件（走另一条 `GrowthbookExperimentEvent.toJSON`）。
//     普通事件在第 708 行调 `to1PEventFormat`（见 `metadata.ts`）翻成 snake_case，再在第 719-725 行处理 `_PROTO_*`：
//     **先把已知的 3 个 PII 字段（skill_name / plugin_name / marketplace_name）hoist 到顶层 proto 字段，
//     再防御性 strip 任何剩余的 `_PROTO_*`**—— 这样万一将来服务器加了个没识别的 `_PROTO_foo`，
//     也不会悄悄落进通用访问的 `additional_metadata` blob。第 714-718 行注释明确说这是和 `sink.ts` 对称的另一半。
//     第 692-703 行：`core_metadata` 缺失时退化为发一个「partial event」（带 `transform_error`），
//     而不是整条丢—— 遥测的容错哲学是「能发多少发多少」。
    logs: ReadableLogRecord[],
  ): FirstPartyEventLoggingPayload {
    const events: FirstPartyEventLoggingEvent[] = []

    for (const log of logs) {
      const attributes = log.attributes || {}

      // Check if this is a GrowthBook experiment event
      if (attributes.event_type === 'GrowthbookExperimentEvent') {
        const timestamp = this.hrTimeToDate(log.hrTime)
        const account_uuid = attributes.account_uuid as string | undefined
        const organization_uuid = attributes.organization_uuid as
          | string
          | undefined
        events.push({
          event_type: 'GrowthbookExperimentEvent',
          event_data: GrowthbookExperimentEvent.toJSON({
            event_id: attributes.event_id as string,
            timestamp,
            experiment_id: attributes.experiment_id as string,
            variation_id: attributes.variation_id as number,
            environment: attributes.environment as string,
            user_attributes: attributes.user_attributes as string,
            experiment_metadata: attributes.experiment_metadata as string,
            device_id: attributes.device_id as string,
            session_id: attributes.session_id as string,
            auth:
              account_uuid || organization_uuid
                ? { account_uuid, organization_uuid }
                : undefined,
          }),
        })
        continue
      }

      // Extract event name
      const eventName =
        (attributes.event_name as string) || (log.body as string) || 'unknown'

      // Extract metadata objects directly (no JSON parsing needed)
      const coreMetadata = attributes.core_metadata as EventMetadata | undefined
      const userMetadata = attributes.user_metadata as CoreUserData
      const eventMetadata = (attributes.event_metadata || {}) as Record<
        string,
        unknown
      >

      if (!coreMetadata) {
        // Emit partial event if core metadata is missing
        if (process.env.USER_TYPE === 'ant') {
          logForDebugging(
            `1P event logging: core_metadata missing for event ${eventName}`,
          )
        }
        events.push({
          event_type: 'ClaudeCodeInternalEvent',
          event_data: ClaudeCodeInternalEvent.toJSON({
            event_id: attributes.event_id as string | undefined,
            event_name: eventName,
            client_timestamp: this.hrTimeToDate(log.hrTime),
            session_id: getSessionId(),
            additional_metadata: Buffer.from(
              jsonStringify({
                transform_error: 'core_metadata attribute is missing',
              }),
            ).toString('base64'),
          }),
        })
        continue
      }

      // Transform to 1P format
      const formatted = to1PEventFormat(
        coreMetadata,
        userMetadata,
        eventMetadata,
      )

      // _PROTO_* keys are PII-tagged values meant only for privileged BQ
      // columns. Hoist known keys to proto fields, then defensively strip any
      // remaining _PROTO_* so an unrecognized future key can't silently land
      // in the general-access additional_metadata blob. sink.ts applies the
      // same strip before Datadog; this closes the 1P side.
      const {
        _PROTO_skill_name,
        _PROTO_plugin_name,
        _PROTO_marketplace_name,
        ...rest
      } = formatted.additional
      const additionalMetadata = stripProtoFields(rest)

      events.push({
        event_type: 'ClaudeCodeInternalEvent',
        event_data: ClaudeCodeInternalEvent.toJSON({
          event_id: attributes.event_id as string | undefined,
          event_name: eventName,
          client_timestamp: this.hrTimeToDate(log.hrTime),
          device_id: attributes.user_id as string | undefined,
          email: userMetadata?.email,
          auth: formatted.auth,
          ...formatted.core,
          env: formatted.env,
          process: formatted.process,
          skill_name:
            typeof _PROTO_skill_name === 'string'
              ? _PROTO_skill_name
              : undefined,
          plugin_name:
            typeof _PROTO_plugin_name === 'string'
              ? _PROTO_plugin_name
              : undefined,
          marketplace_name:
            typeof _PROTO_marketplace_name === 'string'
              ? _PROTO_marketplace_name
              : undefined,
          additional_metadata:
            Object.keys(additionalMetadata).length > 0
              ? Buffer.from(jsonStringify(additionalMetadata)).toString(
                  'base64',
                )
              : undefined,
        }),
      })
    }

    return { events }
  }

  async shutdown(): Promise<void> {
// 【第 764-778 行】`shutdown` / `forceFlush`：`shutdown` 先置 `isShutdown`、reset 退避，再 `forceFlush`
//     （等所有 `pendingExports` 结束）。`forceFlush` 用 `Promise.all` 等齐在途导出——
//     这是进程退出前「发干净最后一波」的保证，和 `firstPartyEventLogger.ts` 末尾的 graceful shutdown 串起来。
    this.isShutdown = true
    this.resetBackoff()
    await this.forceFlush()
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging('1P event logging exporter shutdown complete')
    }
  }

  async forceFlush(): Promise<void> {
    await Promise.all(this.pendingExports)
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging('1P event logging exporter flush complete')
    }
  }
}

function getAxiosErrorContext(error: unknown): string {
// 【第 781-806 行】`getAxiosErrorContext` 把 axios 错误翻成一段紧凑的上下文字符串：
//     优先取响应头里的 `request-id`（对接服务端日志用），再拼 `status` / `code` / `message`。
//     这个字符串会随失败事件一起落盘、进日志，让「为什么这批事件没发出去」事后可查——
//     失败路径上的可观测性，和成功路径同样重要。
  if (!axios.isAxiosError(error)) {
    return errorMessage(error)
  }

  const parts: string[] = []

  const requestId = error.response?.headers?.['request-id']
  if (requestId) {
    parts.push(`request-id=${requestId}`)
  }

  if (error.response?.status) {
    parts.push(`status=${error.response.status}`)
  }

  if (error.code) {
    parts.push(`code=${error.code}`)
  }

  if (error.message) {
    parts.push(error.message)
  }

  return parts.join(', ')
}
