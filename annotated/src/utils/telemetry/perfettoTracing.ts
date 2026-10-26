/**
 * Perfetto Tracing for Claude Code (Ant-only)
 *
 * This module generates traces in the Chrome Trace Event format that can be
 * viewed in ui.perfetto.dev or Chrome's chrome://tracing.
 *
 * NOTE: This feature is ant-only and eliminated from external builds.
 *
 * The trace file includes:
 * - Agent hierarchy (parent-child relationships in a swarm)
 * - API requests with TTFT, TTLT, prompt length, cache stats, msg ID, speculative flag
 * - Tool executions with name, duration, and token usage
 * - User input waiting time
 *
 * Usage:
 * 1. Enable via CLAUDE_CODE_PERFETTO_TRACE=1 or CLAUDE_CODE_PERFETTO_TRACE=<path>
 * 2. Optionally set CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S=<positive integer> to write the
 *    trace file periodically (default: write only on exit).
 * 3. Run Claude Code normally
 * 4. Trace file is written to ~/.claude/traces/trace-<session-id>.json
 *    or to the specified path
 * 5. Open in ui.perfetto.dev to visualize
 */
// 本模块是「仅内部（ant）可用」的 Perfetto 追踪器：把关键事件生成 Chrome Trace Event 格式的文件，可在 ui.perfetto.dev 或 Chrome 的 chrome://tracing 里可视化。记录的内容包括智能体层级（集群里的父子关系）、API 请求（首字延迟、采样延迟、提示长度、缓存命中、消息 ID、是否推测执行）、工具执行（名称、耗时、token 用量）以及用户等待输入的时间。入口开关是环境变量 CLAUDE_CODE_PERFETTO_TRACE。

import { feature } from 'bun:bundle'
// 引入 bun:bundle 的 feature 开关做死代码消除，以及文件读写、会话 ID 与各种工具函数。整个追踪器被 feature(PERFETTO_TRACING) 包裹，外部构建里会被整体删掉。
import { mkdirSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import {
  getClaudeConfigHomeDir,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { djb2Hash } from '../hash.js'
import { jsonStringify } from '../slowOperations.js'
import { getAgentId, getAgentName, getParentSessionId } from '../teammate.js'

/**
 * Chrome Trace Event format types
 * See: https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU
 */

export type TraceEventPhase =
  | 'B' // Begin duration event
  | 'E' // End duration event
  | 'X' // Complete event (with duration)
  | 'i' // Instant event
  | 'C' // Counter event
  | 'b' // Async begin
  | 'n' // Async instant
  | 'e' // Async end
  | 'M' // Metadata event

// TraceEventPhase 枚举出 Chrome Trace 协议支持的事件相位：B/E/X 是时长事件（开始/结束/完整），i 是瞬时事件，C 是计数器，b/n/e 是异步事件，M 是元数据。
export type TraceEvent = {
  name: string
  cat: string
  ph: TraceEventPhase
  ts: number // Timestamp in microseconds
  pid: number // Process ID (we use 1 for main, agent IDs for subagents)
  tid: number // Thread ID (we use numeric hash of agent name or 1 for main)
  dur?: number // Duration in microseconds (for 'X' events)
  args?: Record<string, unknown>
  id?: string // For async events
  scope?: string
}
// TraceEvent 是一条事件的形状：名称、分类、相位、时间戳（微秒）、进程 ID（主线程用 1，子智能体用各自 ID）、线程 ID（用智能体名的数值哈希或 1）、可选时长、可选参数与异步 ID。

/**
 * Agent info for tracking hierarchy
 */
type AgentInfo = {
  agentId: string
  agentName: string
  parentAgentId?: string
  processId: number
  threadId: number
}
// AgentInfo 记录一个智能体的层级信息：agent ID、名字、父 agent ID、进程 ID、线程 ID。用于在追踪里还原集群的父子关系。

/**
 * Pending span for tracking begin/end pairs
 */
type PendingSpan = {
  name: string
  category: string
  startTime: number
  agentInfo: AgentInfo
  args: Record<string, unknown>
}
// PendingSpan 是正在进行的 span 的暂存结构：记录名称、分类、开始时间、所属智能体信息与参数，等收到结束事件时再成对地结算。

// Global state for the Perfetto tracer
let isEnabled = false
let tracePath: string | null = null
// Metadata events (ph: 'M' — process/thread names, parent links) are kept
// separate so they survive eviction — Perfetto UI needs them to label
// tracks. Bounded by agent count (~3 events per agent).
const metadataEvents: TraceEvent[] = []
// metadataEvents 与 events 分开存放：M 类元数据（进程名、线程名、父链接）单独保存、不参与淘汰，因为 Perfetto UI 需要它们来给轨道贴标签；数量按智能体数有界（约每个智能体 3 条）。
const events: TraceEvent[] = []
// events[] cap. Cron-driven sessions run for days; 22 push sites × many
// turns would otherwise grow unboundedly (periodicWrite flushes to disk but
// does not truncate — it writes the full snapshot). At ~300B/event this is
// ~30MB, enough trace history for any debugging session. Eviction drops the
// oldest half when hit, amortized O(1).
const MAX_EVENTS = 100_000
// MAX_EVENTS = 100000 是事件数组上限。常驻（cron 驱动）的会话能跑好几天，22 个写入点乘很多轮会无限增长；周期性写盘只快照不截断，所以到上限时丢掉最旧的一半（约 30MB 历史，足够调试）。
const pendingSpans = new Map<string, PendingSpan>()
// pendingSpans 用 span ID 映射到进行中的 span，结算结束事件时从这里取出开始时间算时长。
const agentRegistry = new Map<string, AgentInfo>()
let totalAgentCount = 0
let startTimeMs = 0
let spanIdCounter = 0
let traceWritten = false // Flag to avoid double writes

// Map agent IDs to numeric process IDs (Perfetto requires numeric IDs)
let processIdCounter = 1
const agentIdToProcessId = new Map<string, number>()
// 把 agent ID 映射到数值进程 ID 的表：Perfetto 要求数值 ID，所以每个 agent 首次出现时分配一个递增的进程号。

// Periodic write interval handle
// writeIntervalId 是周期写盘定时器句柄，退出时清除。
let writeIntervalId: ReturnType<typeof setInterval> | null = null

const STALE_SPAN_TTL_MS = 30 * 60 * 1000 // 30 minutes
// STALE_SPAN_TTL_MS 与清理间隔：超过 30 分钟还没收到结束事件的 span 视为陈旧，在清理循环里补一个结束事件，让它在追踪里显示为未完成而不是永远挂着。
const STALE_SPAN_CLEANUP_INTERVAL_MS = 60 * 1000 // 1 minute
let staleSpanCleanupId: ReturnType<typeof setInterval> | null = null
// staleSpanCleanupId 是陈旧 span 清理定时器句柄。

/**
 * Convert a string to a numeric hash for use as thread ID
 */
function stringToNumericHash(str: string): number {
// stringToNumericHash 把智能体名转成数值哈希当线程 ID，用 djb2 再取绝对值并保证非零。
  return Math.abs(djb2Hash(str)) || 1 // Ensure non-zero
}

/**
 * Get or create a numeric process ID for an agent
 */
function getProcessIdForAgent(agentId: string): number {
  const existing = agentIdToProcessId.get(agentId)
  if (existing !== undefined) return existing

  processIdCounter++
  agentIdToProcessId.set(agentId, processIdCounter)
  return processIdCounter
}

/**
 * Get current agent info
 */
function getCurrentAgentInfo(): AgentInfo {
// getCurrentAgentInfo 取当前智能体信息：主进程用会话 ID 当 agent ID、进程号 1；子智能体用各自分配的进程号。首次出现就登记进注册表并返回。
  const agentId = getAgentId() ?? getSessionId()
  const agentName = getAgentName() ?? 'main'
  const parentSessionId = getParentSessionId()

  // Check if we've already registered this agent
  const existing = agentRegistry.get(agentId)
  if (existing) return existing

  const info: AgentInfo = {
    agentId,
    agentName,
    parentAgentId: parentSessionId,
    processId: agentId === getSessionId() ? 1 : getProcessIdForAgent(agentId),
    threadId: stringToNumericHash(agentName),
  }

  agentRegistry.set(agentId, info)
  totalAgentCount++
  return info
}

/**
 * Get timestamp in microseconds relative to trace start
 */
function getTimestamp(): number {
// getTimestamp 返回相对追踪起点的微秒时间戳（当前时间减起点再乘 1000）。
  return (Date.now() - startTimeMs) * 1000
}

/**
 * Generate a unique span ID
 */
function generateSpanId(): string {
// generateSpanId 生成形如 span_N 的唯一 span ID，N 来自全局自增计数器。
  return `span_${++spanIdCounter}`
}

/**
 * Evict pending spans older than STALE_SPAN_TTL_MS.
 * Mirrors the TTL cleanup pattern in sessionTracing.ts.
 */
function evictStaleSpans(): void {
// evictStaleSpans 扫描进行中的 span，超时的补一个结束事件（标记 evicted）再删除，避免陈旧 span 永远占着轨道。逻辑与 sessionTracing.ts 里的 TTL 清理一致。
  const now = getTimestamp()
  const ttlUs = STALE_SPAN_TTL_MS * 1000 // Convert ms to microseconds
  for (const [spanId, span] of pendingSpans) {
    if (now - span.startTime > ttlUs) {
      // Emit an end event so the span shows up in the trace as incomplete
      events.push({
        name: span.name,
        cat: span.category,
        ph: 'E',
        ts: now,
        pid: span.agentInfo.processId,
        tid: span.agentInfo.threadId,
        args: {
          ...span.args,
          evicted: true,
          duration_ms: (now - span.startTime) / 1000,
        },
      })
      pendingSpans.delete(spanId)
    }
  }
}

/**
 * Build the full trace document (Chrome Trace JSON format).
 */
function buildTraceDocument(): string {
// buildTraceDocument 拼出完整的 Chrome Trace JSON：把元数据事件和普通事件合并，附带会话 ID、起点时间、智能体数、事件总数等元数据。
  return jsonStringify({
    traceEvents: [...metadataEvents, ...events],
    metadata: {
      session_id: getSessionId(),
      trace_start_time: new Date(startTimeMs).toISOString(),
      agent_count: totalAgentCount,
      total_event_count: metadataEvents.length + events.length,
    },
  })
}

/**
 * Drop the oldest half of events[] when over MAX_EVENTS. Called from the
 * stale-span cleanup interval (60s). The half-batch splice keeps this
 * amortized O(1) — we don't pay splice cost per-push. A synthetic marker
 * is inserted so the gap is visible in ui.perfetto.dev.
 */
function evictOldestEvents(): void {
// evictOldestEvents 在事件数超过上限时丢掉最旧的一半，并插入一个人工标记事件，让 ui.perfetto.dev 上能看出被截断的缺口；用 splice 批量处理保持均摊 O(1)。
  if (events.length < MAX_EVENTS) return
  const dropped = events.splice(0, MAX_EVENTS / 2)
  events.unshift({
    name: 'trace_truncated',
    cat: '__metadata',
    ph: 'i',
    ts: dropped[dropped.length - 1]?.ts ?? 0,
    pid: 1,
    tid: 0,
    args: { dropped_events: dropped.length },
  })
  logForDebugging(
    `[Perfetto] Evicted ${dropped.length} oldest events (cap ${MAX_EVENTS})`,
  )
}

/**
 * Initialize Perfetto tracing
 * Call this early in the application lifecycle
 */
export function initializePerfettoTracing(): void {
// initializePerfettoTracing 是初始化总入口：读环境变量决定是否开启、算追踪文件路径、按间隔启动周期写盘与陈旧 span 清理，并注册退出时的落盘回调（cleanup、beforeExit、exit 多道保险）。仅在 feature(PERFETTO_TRACING) 为真且环境变量存在时启用。
  const envValue = process.env.CLAUDE_CODE_PERFETTO_TRACE
  logForDebugging(
    `[Perfetto] initializePerfettoTracing called, env value: ${envValue}`,
  )

  // Wrap in feature() for dead code elimination - entire block removed from external builds
  if (feature('PERFETTO_TRACING')) {
    if (!envValue || isEnvDefinedFalsy(envValue)) {
      logForDebugging(
        '[Perfetto] Tracing disabled (env var not set or disabled)',
      )
      return
    }

    isEnabled = true
    startTimeMs = Date.now()

    // Determine trace file path
    if (isEnvTruthy(envValue)) {
      const tracesDir = join(getClaudeConfigHomeDir(), 'traces')
      tracePath = join(tracesDir, `trace-${getSessionId()}.json`)
    } else {
      // Use the provided path
      tracePath = envValue
    }

    logForDebugging(
      `[Perfetto] Tracing enabled, will write to: ${tracePath}, isEnabled=${isEnabled}`,
    )

    // Start periodic full-trace write if CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S is a positive integer
    const intervalSec = parseInt(
      process.env.CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S ?? '',
      10,
    )
    if (intervalSec > 0) {
      writeIntervalId = setInterval(() => {
        void periodicWrite()
      }, intervalSec * 1000)
      // Don't let the interval keep the process alive on its own
      if (writeIntervalId.unref) writeIntervalId.unref()
      logForDebugging(
        `[Perfetto] Periodic write enabled, interval: ${intervalSec}s`,
      )
    }

    // Start stale span cleanup interval
    staleSpanCleanupId = setInterval(() => {
      evictStaleSpans()
      evictOldestEvents()
    }, STALE_SPAN_CLEANUP_INTERVAL_MS)
    if (staleSpanCleanupId.unref) staleSpanCleanupId.unref()

    // Register cleanup to write final trace on exit
    registerCleanup(async () => {
      logForDebugging('[Perfetto] Cleanup callback invoked')
      await writePerfettoTrace()
    })

    // Also register a beforeExit handler as a fallback
    // This ensures the trace is written even if cleanup registry is not called
    process.on('beforeExit', () => {
      logForDebugging('[Perfetto] beforeExit handler invoked')
      void writePerfettoTrace()
    })

    // Register a synchronous exit handler as a last resort
    // This is the final fallback to ensure trace is written before process exits
    process.on('exit', () => {
      if (!traceWritten) {
        logForDebugging(
          '[Perfetto] exit handler invoked, writing trace synchronously',
        )
        writePerfettoTraceSync()
      }
    })

    // Emit process metadata events for main process
    const mainAgent = getCurrentAgentInfo()
    emitProcessMetadata(mainAgent)
  }
}

/**
 * Emit metadata events for a process/agent
 */
function emitProcessMetadata(agentInfo: AgentInfo): void {
// emitProcessMetadata 为某个进程或智能体写入 M 类元数据：进程名、线程名，以及（若有父节点）父智能体信息，供 UI 还原层级与轨道标签。
  if (!isEnabled) return

  // Process name
  metadataEvents.push({
    name: 'process_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid: agentInfo.processId,
    tid: 0,
    args: { name: agentInfo.agentName },
  })

  // Thread name (same as process for now)
  metadataEvents.push({
    name: 'thread_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: { name: agentInfo.agentName },
  })

  // Add parent info if available
  if (agentInfo.parentAgentId) {
    metadataEvents.push({
      name: 'parent_agent',
      cat: '__metadata',
      ph: 'M',
      ts: 0,
      pid: agentInfo.processId,
      tid: 0,
      args: {
        parent_agent_id: agentInfo.parentAgentId,
      },
    })
  }
}

/**
 * Check if Perfetto tracing is enabled
 */
export function isPerfettoTracingEnabled(): boolean {
// isPerfettoTracingEnabled 仅返回全局 isEnabled 开关，供上层判断是否要记录 span。
  return isEnabled
}

/**
 * Register a new agent in the trace
 * Call this when a subagent/teammate is spawned
 */
export function registerAgent(
  agentId: string,
  agentName: string,
  parentAgentId?: string,
): void {
// registerAgent 在子智能体或队友被 spawn 时登记进追踪：分配进程号、计入总数、写入元数据。未启用时直接返回。
  if (!isEnabled) return

  const info: AgentInfo = {
    agentId,
    agentName,
    parentAgentId,
    processId: getProcessIdForAgent(agentId),
    threadId: stringToNumericHash(agentName),
  }

  agentRegistry.set(agentId, info)
  totalAgentCount++
  emitProcessMetadata(info)
}

/**
 * Unregister an agent from the trace.
 * Call this when an agent completes, fails, or is aborted to free memory.
 */
export function unregisterAgent(agentId: string): void {
// unregisterAgent 在智能体结束、失败或中止时注销，释放其进程号与 ID 映射，避免内存无限增长。
  if (!isEnabled) return
  agentRegistry.delete(agentId)
  agentIdToProcessId.delete(agentId)
}

/**
 * Start an API call span
 */
export function startLLMRequestPerfettoSpan(args: {
  model: string
  promptTokens?: number
  messageId?: string
  isSpeculative?: boolean
  querySource?: string
}): string {
// startLLMRequestPerfettoSpan 开启一次 API 调用 span：记录模型、提示 token、消息 ID、是否推测、查询来源，并发出一个 B（开始）事件，返回 span ID 给调用方在结束时回填。
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: 'API Call',
    category: 'api',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      model: args.model,
      prompt_tokens: args.promptTokens,
      message_id: args.messageId,
      is_speculative: args.isSpeculative ?? false,
      query_source: args.querySource,
    },
  })

  // Emit begin event
  events.push({
    name: 'API Call',
    cat: 'api',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End an API call span with response metadata
 */
export function endLLMRequestPerfettoSpan(
  spanId: string,
  metadata: {
    ttftMs?: number
    ttltMs?: number
    promptTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    messageId?: string
    success?: boolean
    error?: string
    /** Time spent in pre-request setup (client creation, retries) before the successful attempt */
    requestSetupMs?: number
    /** Timestamps (Date.now()) of each attempt start — used to emit retry sub-spans */
    attemptStartTimes?: number[]
  },
): void {
// endLLMRequestPerfettoSpan 结算 API 调用 span：读回开始事件、算时长，并推导三个衍生指标——ITPS（输入 token/秒）、OTPS（输出 token/秒）、缓存命中率，再把请求前置耗时与重试拆成子 span，最后发 E 事件闭合整条 API 调用 span。
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  const promptTokens =
    metadata.promptTokens ?? (pending.args.prompt_tokens as number | undefined)
  const ttftMs = metadata.ttftMs
  const ttltMs = metadata.ttltMs
  const outputTokens = metadata.outputTokens
  const cacheReadTokens = metadata.cacheReadTokens

  // Compute derived metrics
  // ITPS: input tokens per second (prompt processing speed)
  const itps =
    ttftMs !== undefined && promptTokens !== undefined && ttftMs > 0
      ? Math.round((promptTokens / (ttftMs / 1000)) * 100) / 100
      : undefined

  // OTPS: output tokens per second (sampling speed)
  const samplingMs =
    ttltMs !== undefined && ttftMs !== undefined ? ttltMs - ttftMs : undefined
  const otps =
    samplingMs !== undefined && outputTokens !== undefined && samplingMs > 0
      ? Math.round((outputTokens / (samplingMs / 1000)) * 100) / 100
      : undefined

  // Cache hit rate: percentage of prompt tokens from cache
  const cacheHitRate =
    cacheReadTokens !== undefined &&
    promptTokens !== undefined &&
    promptTokens > 0
      ? Math.round((cacheReadTokens / promptTokens) * 10000) / 100
      : undefined

  const requestSetupMs = metadata.requestSetupMs
  const attemptStartTimes = metadata.attemptStartTimes

  // Merge metadata with original args
  const args = {
    ...pending.args,
    ttft_ms: ttftMs,
    ttlt_ms: ttltMs,
    prompt_tokens: promptTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: metadata.cacheCreationTokens,
    message_id: metadata.messageId ?? pending.args.message_id,
    success: metadata.success ?? true,
    error: metadata.error,
    duration_ms: duration / 1000,
    request_setup_ms: requestSetupMs,
    // Derived metrics
    itps,
    otps,
    cache_hit_rate_pct: cacheHitRate,
  }

  // Emit Request Setup sub-span when there was measurable setup time
  // (client creation, param building, retries before the successful attempt)
  const setupUs =
    requestSetupMs !== undefined && requestSetupMs > 0
      ? requestSetupMs * 1000
      : 0
  if (setupUs > 0) {
    const setupEndTs = pending.startTime + setupUs

    events.push({
      name: 'Request Setup',
      cat: 'api,setup',
      ph: 'B',
      ts: pending.startTime,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        request_setup_ms: requestSetupMs,
        attempt_count: attemptStartTimes?.length ?? 1,
      },
    })

    // Emit retry attempt sub-spans within Request Setup.
    // Each failed attempt runs from its start to the next attempt's start.
    if (attemptStartTimes && attemptStartTimes.length > 1) {
      // attemptStartTimes[0] is the reference point (first attempt).
      // Convert wall-clock deltas into Perfetto-relative microseconds.
      const baseWallMs = attemptStartTimes[0]!
      for (let i = 0; i < attemptStartTimes.length - 1; i++) {
        const attemptStartUs =
          pending.startTime + (attemptStartTimes[i]! - baseWallMs) * 1000
        const attemptEndUs =
          pending.startTime + (attemptStartTimes[i + 1]! - baseWallMs) * 1000

        events.push({
          name: `Attempt ${i + 1} (retry)`,
          cat: 'api,retry',
          ph: 'B',
          ts: attemptStartUs,
          pid: pending.agentInfo.processId,
          tid: pending.agentInfo.threadId,
          args: { attempt: i + 1 },
        })
        events.push({
          name: `Attempt ${i + 1} (retry)`,
          cat: 'api,retry',
          ph: 'E',
          ts: attemptEndUs,
          pid: pending.agentInfo.processId,
          tid: pending.agentInfo.threadId,
        })
      }
    }

    events.push({
      name: 'Request Setup',
      cat: 'api,setup',
      ph: 'E',
      ts: setupEndTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
    })
  }

  // Emit sub-spans for First Token and Sampling phases (before API Call end)
  // Using B/E pairs in proper nesting order for correct Perfetto visualization
  if (ttftMs !== undefined) {
    // First Token starts after request setup (if any)
    const firstTokenStartTs = pending.startTime + setupUs
    const firstTokenEndTs = firstTokenStartTs + ttftMs * 1000

    // First Token phase: from successful attempt start to first token
    events.push({
      name: 'First Token',
      cat: 'api,ttft',
      ph: 'B',
      ts: firstTokenStartTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        ttft_ms: ttftMs,
        prompt_tokens: promptTokens,
        itps,
        cache_hit_rate_pct: cacheHitRate,
      },
    })
    events.push({
      name: 'First Token',
      cat: 'api,ttft',
      ph: 'E',
      ts: firstTokenEndTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
    })

    // Sampling phase: from first token to last token
    // Note: samplingMs = ttltMs - ttftMs still includes setup time in ttltMs,
    // so we compute the actual sampling duration for the span as the time from
    // first token to API call end (endTime), not samplingMs directly.
    const actualSamplingMs =
      ttltMs !== undefined ? ttltMs - ttftMs - setupUs / 1000 : undefined
    if (actualSamplingMs !== undefined && actualSamplingMs > 0) {
      events.push({
        name: 'Sampling',
        cat: 'api,sampling',
        ph: 'B',
        ts: firstTokenEndTs,
        pid: pending.agentInfo.processId,
        tid: pending.agentInfo.threadId,
        args: {
          sampling_ms: actualSamplingMs,
          output_tokens: outputTokens,
          otps,
        },
      })
      events.push({
        name: 'Sampling',
        cat: 'api,sampling',
        ph: 'E',
        ts: firstTokenEndTs + actualSamplingMs * 1000,
        pid: pending.agentInfo.processId,
        tid: pending.agentInfo.threadId,
      })
    }
  }

  // Emit API Call end event (after sub-spans)
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  pendingSpans.delete(spanId)
}

/**
 * Start a tool execution span
 */
export function startToolPerfettoSpan(
  toolName: string,
  args?: Record<string, unknown>,
): string {
// startToolPerfettoSpan 开启一次工具执行 span：记录工具名与参数，发 B 事件，返回 span ID。
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: `Tool: ${toolName}`,
    category: 'tool',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      tool_name: toolName,
      ...args,
    },
  })

  // Emit begin event
  events.push({
    name: `Tool: ${toolName}`,
    cat: 'tool',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End a tool execution span
 */
export function endToolPerfettoSpan(
  spanId: string,
  metadata?: {
    success?: boolean
    error?: string
    resultTokens?: number
  },
): void {
// endToolPerfettoSpan 结算工具 span：回填成功与否、错误、结果 token 与耗时，发 E 事件并清理 pendingSpans。
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  const args = {
    ...pending.args,
    success: metadata?.success ?? true,
    error: metadata?.error,
    result_tokens: metadata?.resultTokens,
    duration_ms: duration / 1000,
  }

  // Emit end event
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  pendingSpans.delete(spanId)
}

/**
 * Start a user input waiting span
 */
export function startUserInputPerfettoSpan(context?: string): string {
// startUserInputPerfettoSpan 记录「等待用户输入」这段时间，发 B 事件，返回 span ID。
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: 'Waiting for User Input',
    category: 'user_input',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      context,
    },
  })

  // Emit begin event
  events.push({
    name: 'Waiting for User Input',
    cat: 'user_input',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End a user input waiting span
 */
export function endUserInputPerfettoSpan(
  spanId: string,
  metadata?: {
    decision?: string
    source?: string
  },
): void {
// endUserInputPerfettoSpan 结算等待输入 span：回填决策来源与耗时，发 E 事件。
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  const args = {
    ...pending.args,
    decision: metadata?.decision,
    source: metadata?.source,
    duration_ms: duration / 1000,
  }

  // Emit end event
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  pendingSpans.delete(spanId)
}

/**
 * Emit an instant event (marker)
 */
export function emitPerfettoInstant(
  name: string,
  category: string,
  args?: Record<string, unknown>,
// emitPerfettoInstant 发一个瞬时事件（标记点，i 相位），用于在时间线上打点而不占用时长。
): void {
  if (!isEnabled) return

  const agentInfo = getCurrentAgentInfo()

  events.push({
    name,
    cat: category,
    ph: 'i',
    ts: getTimestamp(),
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args,
  })
}

/**
 * Emit a counter event for tracking metrics over time
 */
export function emitPerfettoCounter(
  name: string,
  values: Record<string, number>,
): void {
// emitPerfettoCounter 发一个计数器事件（C 相位），用于随时间的指标曲线，例如并发数。
  if (!isEnabled) return

  const agentInfo = getCurrentAgentInfo()

  events.push({
    name,
    cat: 'counter',
    ph: 'C',
    ts: getTimestamp(),
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: values,
  })
}

/**
 * Start an interaction span (wraps a full user request cycle)
 */
export function startInteractionPerfettoSpan(userPrompt?: string): string {
// startInteractionPerfettoSpan 包裹一次完整的用户请求周期（从提问到回答），发 B 事件并记录提示长度。
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: 'Interaction',
    category: 'interaction',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      user_prompt_length: userPrompt?.length,
    },
  })

  // Emit begin event
  events.push({
    name: 'Interaction',
    cat: 'interaction',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End an interaction span
 */
export function endInteractionPerfettoSpan(spanId: string): void {
// endInteractionPerfettoSpan 结算交互 span：发 E 事件，上报耗时。
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  // Emit end event
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args: {
      ...pending.args,
      duration_ms: duration / 1000,
    },
  })

  pendingSpans.delete(spanId)
}

// ---------------------------------------------------------------------------
// Periodic write helpers
// ---------------------------------------------------------------------------

/**
 * Stop the periodic write timer.
 */
function stopWriteInterval(): void {
// stopWriteInterval 停止周期写盘与陈旧 span 清理两个定时器，退出时调用。
  if (staleSpanCleanupId) {
    clearInterval(staleSpanCleanupId)
    staleSpanCleanupId = null
  }
  if (writeIntervalId) {
    clearInterval(writeIntervalId)
    writeIntervalId = null
  }
}

/**
 * Force-close any remaining open spans at session end.
 */
function closeOpenSpans(): void {
// closeOpenSpans 在会话结束前强制闭合所有还没收到结束事件的 span，标记为 incomplete，让它们出现在追踪里而不是悬空。
  for (const [spanId, pending] of pendingSpans) {
    const endTime = getTimestamp()
    events.push({
      name: pending.name,
      cat: pending.category,
      ph: 'E',
      ts: endTime,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        ...pending.args,
        incomplete: true,
        duration_ms: (endTime - pending.startTime) / 1000,
      },
    })
    pendingSpans.delete(spanId)
  }
}

/**
 * Write the full trace to disk.  Errors are logged but swallowed so that a
 * transient I/O problem does not crash the session — the next periodic tick
 * (or the final exit write) will retry with a complete snapshot.
 */
async function periodicWrite(): Promise<void> {
// periodicWrite 周期写盘：构建完整文档写进追踪文件，错误只记录不抛出（下次周期或最终退出还会再写），保证临时 IO 故障不崩会话。
  if (!isEnabled || !tracePath || traceWritten) return

  try {
    await mkdir(dirname(tracePath), { recursive: true })
    await writeFile(tracePath, buildTraceDocument())
    logForDebugging(
      `[Perfetto] Periodic write: ${events.length} events to ${tracePath}`,
    )
  } catch (error) {
    logForDebugging(
      `[Perfetto] Periodic write failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * Final async write: close open spans and write the complete trace.
 * Idempotent — sets `traceWritten` on success so subsequent calls are no-ops.
 */
async function writePerfettoTrace(): Promise<void> {
// writePerfettoTrace 是最终异步落盘：先停定时器、闭合 open span，再写完整文档并把 traceWritten 置真（幂等）；失败只记录。
  if (!isEnabled || !tracePath || traceWritten) {
    logForDebugging(
      `[Perfetto] Skipping final write: isEnabled=${isEnabled}, tracePath=${tracePath}, traceWritten=${traceWritten}`,
    )
    return
  }

  stopWriteInterval()
  closeOpenSpans()

  logForDebugging(
    `[Perfetto] writePerfettoTrace called: events=${events.length}`,
  )

  try {
    await mkdir(dirname(tracePath), { recursive: true })
    await writeFile(tracePath, buildTraceDocument())
    traceWritten = true
    logForDebugging(`[Perfetto] Trace finalized at: ${tracePath}`)
  } catch (error) {
    logForDebugging(
      `[Perfetto] Failed to write final trace: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * Final synchronous write (fallback for process 'exit' handler where async is forbidden).
 */
function writePerfettoTraceSync(): void {
// writePerfettoTraceSync 是退出处理器里的同步落盘（exit 事件不允许异步）：复用停止定时器与闭合 span 逻辑，用同步文件 API 把文档写盘，同样幂等。
  if (!isEnabled || !tracePath || traceWritten) {
    logForDebugging(
      `[Perfetto] Skipping final sync write: isEnabled=${isEnabled}, tracePath=${tracePath}, traceWritten=${traceWritten}`,
    )
    return
  }

  stopWriteInterval()
  closeOpenSpans()

  logForDebugging(
    `[Perfetto] writePerfettoTraceSync called: events=${events.length}`,
  )

  try {
    const dir = dirname(tracePath)
    // eslint-disable-next-line custom-rules/no-sync-fs -- Only called from process.on('exit') handler
    mkdirSync(dir, { recursive: true })
    // eslint-disable-next-line custom-rules/no-sync-fs, eslint-plugin-n/no-sync -- Required for process 'exit' handler which doesn't support async
    writeFileSync(tracePath, buildTraceDocument())
    traceWritten = true
    logForDebugging(`[Perfetto] Trace finalized synchronously at: ${tracePath}`)
  } catch (error) {
    logForDebugging(
      `[Perfetto] Failed to write final trace synchronously: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * Get all recorded events (for testing)
 */
export function getPerfettoEvents(): TraceEvent[] {
// getPerfettoEvents 返回全部事件（元数据加普通），仅供测试读取。
  return [...metadataEvents, ...events]
}

/**
 * Reset the tracer state (for testing)
 */
export function resetPerfettoTracer(): void {
// resetPerfettoTracer 重置所有追踪状态（仅供测试）：清定时器、清各类注册表与数组、归零计数器、关闭开关，恢复到初始态。
  if (staleSpanCleanupId) {
    clearInterval(staleSpanCleanupId)
    staleSpanCleanupId = null
  }
  stopWriteInterval()
  metadataEvents.length = 0
  events.length = 0
  pendingSpans.clear()
  agentRegistry.clear()
  agentIdToProcessId.clear()
  totalAgentCount = 0
  processIdCounter = 1
  spanIdCounter = 0
  isEnabled = false
  tracePath = null
  startTimeMs = 0
  traceWritten = false
}

/**
 * Trigger a periodic write immediately (for testing)
 */
export async function triggerPeriodicWriteForTesting(): Promise<void> {
// triggerPeriodicWriteForTesting 触发一次周期写盘，仅供测试。
  await periodicWrite()
}

/**
 * Evict stale spans immediately (for testing)
 */
export function evictStaleSpansForTesting(): void {
// evictStaleSpansForTesting 立即触发陈旧 span 淘汰，仅供测试。
  evictStaleSpans()
}

export const MAX_EVENTS_FOR_TESTING = MAX_EVENTS
// MAX_EVENTS_FOR_TESTING 把事件上限暴露给测试，便于断言淘汰行为。
export function evictOldestEventsForTesting(): void {
// evictOldestEventsForTesting 立即触发最旧事件淘汰，仅供测试。
  evictOldestEvents()
}
