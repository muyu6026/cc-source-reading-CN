// 【第 1-9 行】`index.ts` 是整个 `analytics/` 的**公共入口**，也是层级最低的模块。
//     开头那句 DESIGN 注释是重点：**本模块零依赖，专门为了避免 import 循环**。
//     遥测子系统天生容易被各种模块调用（几乎每个功能都想上报事件），一旦让 `index.ts`
//     反向依赖某个业务模块，就会出现循环引用。所以它只暴露 `logEvent` / `attachAnalyticsSink`，
//     把具体的路由实现留给 `sink.ts`，把后端留给 `datadog.ts` / `firstPartyEventLogger.ts`。
/**
 * Analytics service - public API for event logging
 *
 * This module serves as the main entry point for analytics events in Claude CLI.
 *
 * DESIGN: This module has NO dependencies to avoid import cycles.
 * Events are queued until attachAnalyticsSink() is called during app initialization.
 * The sink handles routing to Datadog and 1P event logging.
 */

/**
 * Marker type for verifying analytics metadata doesn't contain sensitive data
 *
 * This type forces explicit verification that string values being logged
 * don't contain code snippets, file paths, or other sensitive information.
 *
 * Usage: `myString as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
 */
// 【第 11-19 行】又是这个 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 标记类型。
//     在 `metadata.ts` 里也会大量出现—— 它是用「命名即 lint」的方式，强迫写代码的人
//     在把一个 string 塞进遥测 metadata 时，停下来想一秒：「这串字符串里有没有代码、文件路径、
//     或其他敏感信息？」类型本身是 `never`（永远不能真正持有值），纯粹是给类型系统看的意图声明。
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

/**
 * Marker type for values routed to PII-tagged proto columns via `_PROTO_*`
 * payload keys. The destination BQ column has privileged access controls,
 * so unredacted values are acceptable — unlike general-access backends.
 *
 * sink.ts strips `_PROTO_*` keys before Datadog fanout; only the 1P
 * exporter (firstPartyEventLoggingExporter) sees them and hoists them to the
 * top-level proto field. A single stripProtoFields call guards all non-1P
 * sinks — no per-sink filtering to forget.
 *
 * Usage: `rawName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED`
 */
// 【第 21-34 行】第二个标记类型 `AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED` 和上面那个正交：
//     - 上一个说「我保证这段不是代码/路径」
//     - 这一个说「我知道这段是 PII，但它只去 1P 的特权 BQ 列，所以未脱敏也可以接受」
//     注释特意点出 `stripProtoFields` 只在**非 1P** 后端前调用一次，把所有 `_PROTO_*` 摘掉；
//     1P 的 exporter 反而会把这些字段「hoist（提升）」到顶层 proto 字段。
//     → 一条 strip 调用守住了所有通用后端，1P 单独再处理，分工很干净。
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

/**
 * Strip `_PROTO_*` keys from a payload destined for general-access storage.
 * Used by:
 *   - sink.ts: before Datadog fanout (never sees PII-tagged values)
 *   - firstPartyEventLoggingExporter: defensive strip of additional_metadata
 *     after hoisting known _PROTO_* keys to proto fields — prevents a future
 *     unrecognized _PROTO_foo from silently landing in the BQ JSON blob.
 *
 * Returns the input unchanged (same reference) when no _PROTO_ keys present.
 */
// 【第 45-58 行】`stripProtoFields` 的实现有一个小但关键的细节：
//     它**不**创建新对象，除非真的有 `_PROTO_*` 键要删（第 52 行才 `{...metadata}`）。
//     没有相关键时返回原引用（第 57 行），避免每次上报都做一次无意义的深拷贝。
//     高频上报路径上，这种「先判断再分配」能省下不少 GC 压力。
export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  let result: Record<string, V> | undefined
  for (const key in metadata) {
    if (key.startsWith('_PROTO_')) {
      if (result === undefined) {
        result = { ...metadata }
      }
      delete result[key]
    }
  }
  return result ?? metadata
}

// Internal type for logEvent metadata - different from the enriched EventMetadata in metadata.ts
type LogEventMetadata = { [key: string]: boolean | number | undefined }

type QueuedEvent = {
  eventName: string
  metadata: LogEventMetadata
  async: boolean
}

/**
 * Sink interface for the analytics backend
 */
// 【第 69-78 行】`AnalyticsSink` 接口只有两个方法：`logEvent` 和 `logEventAsync`。
//     注意参数类型 `LogEventMetadata` 是 `{ [key: string]: boolean | number | undefined }`——
//     **故意不含 string**。这是类型层面的「防手滑」：想上报一个字符串值（比如文件名、URL），
//     类型系统会直接报错，逼你先想清楚要不要上报、有没有脱敏。
export type AnalyticsSink = {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void
  logEventAsync: (
    eventName: string,
    metadata: LogEventMetadata,
  ) => Promise<void>
}

// Event queue for events logged before sink is attached
// 【第 80-123 行】`eventQueue` + `sink` 实现了「先消费、后连接」：
//     - sink 未 attach 时，事件 push 进队列（第 140 / 160 行）
//     - attach 时把队列拷出来、清空，再用 `queueMicrotask` 异步排空（第 113 行）
//     为什么用 `queueMicrotask` 而不是立即循环？为了**不阻塞启动路径**——
//     排空遥测不能拖慢用户看到第一个 prompt 的速度。`USER_TYPE === 'ant'` 时还会上报一个
//     `analytics_sink_attached` 事件带队列长度，方便内部调试「初始化时序」。
const eventQueue: QueuedEvent[] = []

// Sink - initialized during app startup
let sink: AnalyticsSink | null = null

/**
 * Attach the analytics sink that will receive all events.
 * Queued events are drained asynchronously via queueMicrotask to avoid
 * adding latency to the startup path.
 *
 * Idempotent: if a sink is already attached, this is a no-op. This allows
 * calling from both the preAction hook (for subcommands) and setup() (for
 * the default command) without coordination.
 */
export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  if (sink !== null) {
    return
  }
  sink = newSink

  // Drain the queue asynchronously to avoid blocking startup
  if (eventQueue.length > 0) {
    const queuedEvents = [...eventQueue]
    eventQueue.length = 0

    // Log queue size for ants to help debug analytics initialization timing
    if (process.env.USER_TYPE === 'ant') {
      sink.logEvent('analytics_sink_attached', {
        queued_event_count: queuedEvents.length,
      })
    }

    queueMicrotask(() => {
      for (const event of queuedEvents) {
        if (event.async) {
          void sink!.logEventAsync(event.eventName, event.metadata)
        } else {
          sink!.logEvent(event.eventName, event.metadata)
        }
      }
    })
  }
}

/**
 * Log an event to analytics backends (synchronous)
 *
 * Events may be sampled based on the 'tengu_event_sampling_config' dynamic config.
 * When sampled, the sample_rate is added to the event metadata.
 *
 * If no sink is attached, events are queued and drained when the sink attaches.
 */
// 【第 125-164 行】`logEvent` / `logEventAsync` 是公开的同步/异步入口，逻辑对称：
//     sink 为 null → 入队；否则直接交给 sink。
//     注意第 135 / 156 行的参数注释又强调了一遍「intentionally no strings」——
//     同一个约束在文件里出现了至少四次（类型、参数声明、两个函数），这不是啰嗦，
//     而是因为这种「防误报敏感数据」的约束，每过一道关口都得有人在门口重申一遍。
export function logEvent(
  eventName: string,
  // intentionally no strings unless AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  // to avoid accidentally logging code/filepaths
  metadata: LogEventMetadata,
): void {
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: false })
    return
  }
  sink.logEvent(eventName, metadata)
}

/**
 * Log an event to analytics backends (asynchronous)
 *
 * Events may be sampled based on the 'tengu_event_sampling_config' dynamic config.
 * When sampled, the sample_rate is added to the event metadata.
 *
 * If no sink is attached, events are queued and drained when the sink attaches.
 */
export async function logEventAsync(
  eventName: string,
  // intentionally no strings, to avoid accidentally logging code/filepaths
  metadata: LogEventMetadata,
): Promise<void> {
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: true })
    return
  }
  await sink.logEventAsync(eventName, metadata)
}

/**
 * Reset analytics state for testing purposes only.
 * @internal
 */
// 【第 166-173 行】`_resetForTesting()` 只被测试调用（`@internal`），
//     把 `sink` 和 `eventQueue` 都清空。生产代码里看不到调用—— 这说明遥测子系统也遵循
//     「状态集中在模块级变量、提供一个测试重置钩子」的惯例，和 `growthbook.ts` 的 `resetGrowthBook()` 同理。
export function _resetForTesting(): void {
  sink = null
  eventQueue.length = 0
}
