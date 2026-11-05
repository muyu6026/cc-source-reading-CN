// SerialBatchEventUploader：串行批量事件上传器，带批处理、指数退避重试与背压。任意时刻最多一个 POST 在飞，失败按配置无限重试或达到连续失败上限后丢弃该批。
import { jsonStringify } from '../../utils/slowOperations.js'

/**
 * Serial ordered event uploader with batching, retry, and backpressure.
 *
 * - enqueue() adds events to a pending buffer
 * - At most 1 POST in-flight at a time
 * - Drains up to maxBatchSize items per POST
 * - New events accumulate while in-flight
 * - On failure: exponential backoff (clamped), retries indefinitely
 *   until success or close() — unless maxConsecutiveFailures is set,
 *   in which case the failing batch is dropped and drain advances
 * - flush() blocks until pending is empty and kicks drain if needed
 * - Backpressure: enqueue() blocks when maxQueueSize is reached
 */

/**
 * Throw from config.send() to make the uploader wait a server-supplied
 * duration before retrying (e.g. 429 with Retry-After). When retryAfterMs
 * is set, it overrides exponential backoff for that attempt — clamped to
 * [baseDelayMs, maxDelayMs] and jittered so a misbehaving server can
 * neither hot-loop nor stall the client, and many sessions sharing a rate
 * limit don't all pounce at the same instant. Without retryAfterMs, behaves
 * like any other thrown error (exponential backoff).
 */
export class RetryableError extends Error {
// RetryableError：从 config.send() 抛出来让上传器按服务端 Retry-After 等待（如 429）。retryAfterMs 会覆盖本次指数退避，但仍被钳制并加抖动。
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

type SerialBatchEventUploaderConfig<T> = {
// 配置类型：maxBatchSize / maxBatchBytes 控制每批大小与字节上限，maxQueueSize 触发背压，baseDelayMs / maxDelayMs / jitterMs 控制退避，maxConsecutiveFailures 控制是否丢弃。
  /** Max items per POST (1 = no batching) */
  maxBatchSize: number
  /**
   * Max serialized bytes per POST. First item always goes in regardless of
   * size; subsequent items only if cumulative JSON bytes stay under this.
   * Undefined = no byte limit (count-only batching).
   */
  maxBatchBytes?: number
  /** Max pending items before enqueue() blocks */
  maxQueueSize: number
  /** The actual HTTP call — caller controls payload format */
  send: (batch: T[]) => Promise<void>
  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number
  /** Max delay cap (ms) */
  maxDelayMs: number
  /** Random jitter range added to retry delay (ms) */
  jitterMs: number
  /**
   * After this many consecutive send() failures, drop the failing batch
   * and move on to the next pending item with a fresh failure budget.
   * Undefined = retry indefinitely (default).
   */
  maxConsecutiveFailures?: number
  /** Called when a batch is dropped for hitting maxConsecutiveFailures. */
  onBatchDropped?: (batchSize: number, failures: number) => void
}

export class SerialBatchEventUploader<T> {
// 主类与私有字段：pending 缓冲、draining 标记、closed 标记、背压/睡眠/刷新三类等待者队列、以及丢弃批次计数。
  private pending: T[] = []
  private pendingAtClose = 0
  private draining = false
  private closed = false
  private backpressureResolvers: Array<() => void> = []
  private sleepResolve: (() => void) | null = null
  private flushResolvers: Array<() => void> = []
  private droppedBatches = 0
  private readonly config: SerialBatchEventUploaderConfig<T>

  constructor(config: SerialBatchEventUploaderConfig<T>) {
    this.config = config
  }

  /**
   * Monotonic count of batches dropped via maxConsecutiveFailures. Callers
   * can snapshot before flush() and compare after to detect silent drops
   * (flush() resolves normally even when batches were dropped).
   */
  get droppedBatchCount(): number {
// droppedBatchCount：单调计数被 maxConsecutiveFailures 丢弃的批次数。调用方可在 flush 前后快照对比，检测静默丢弃（flush 即使丢批也正常 resolve）。
    return this.droppedBatches
  }

  /**
   * Pending queue depth. After close(), returns the count at close time —
   * close() clears the queue but shutdown diagnostics may read this after.
   */
  get pendingCount(): number {
// pendingCount：返回待发队列深度；close 之后返回关闭时刻的计数，便于关停诊断在清空后再读。
    return this.closed ? this.pendingAtClose : this.pending.length
  }

  /**
   * Add events to the pending buffer. Returns immediately if space is
   * available. Blocks (awaits) if the buffer is full — caller pauses
   * until drain frees space.
   */
  async enqueue(events: T | T[]): Promise<void> {
// enqueue：入队事件。空间足够立即返回，否则阻塞等待 drain 腾出空间；关闭后直接返回不接收。
    if (this.closed) return
    const items = Array.isArray(events) ? events : [events]
    if (items.length === 0) return

    // Backpressure: wait until there's space
    while (
      this.pending.length + items.length > this.config.maxQueueSize &&
      !this.closed
    ) {
      await new Promise<void>(resolve => {
        this.backpressureResolvers.push(resolve)
      })
    }

    if (this.closed) return
    this.pending.push(...items)
    void this.drain()
  }

  /**
   * Block until all pending events have been sent.
   * Used at turn boundaries and graceful shutdown.
   */
  flush(): Promise<void> {
// flush：阻塞直到所有待发事件发完，用于回合边界与优雅关停；队列空且未在排干时直接 resolve。
    if (this.pending.length === 0 && !this.draining) {
      return Promise.resolve()
    }
    void this.drain()
    return new Promise<void>(resolve => {
      this.flushResolvers.push(resolve)
    })
  }

  /**
   * Drop pending events and stop processing.
   * Resolves any blocked enqueue() and flush() callers.
   */
  close(): void {
// close：丢弃待发事件并停止处理，唤醒所有被阻塞的 enqueue 与 flush 调用方，同时清掉睡眠计时。
    if (this.closed) return
    this.closed = true
    this.pendingAtClose = this.pending.length
    this.pending = []
    this.sleepResolve?.()
    this.sleepResolve = null
    for (const resolve of this.backpressureResolvers) resolve()
    this.backpressureResolvers = []
    for (const resolve of this.flushResolvers) resolve()
    this.flushResolvers = []
  }

  /**
   * Drain loop. At most one instance runs at a time (guarded by this.draining).
   * Sends batches serially. On failure, backs off and retries indefinitely.
   */
  private async drain(): Promise<void> {
// drain 循环：用 this.draining 保证同时只有一个实例在跑。串行发批，失败则退避无限重试，除非达到连续失败上限丢弃该批。
    if (this.draining || this.closed) return
    this.draining = true
    let failures = 0

    try {
      while (this.pending.length > 0 && !this.closed) {
        const batch = this.takeBatch()
        if (batch.length === 0) continue

        try {
          await this.config.send(batch)
          failures = 0
        } catch (err) {
          failures++
          if (
            this.config.maxConsecutiveFailures !== undefined &&
            failures >= this.config.maxConsecutiveFailures
          ) {
            this.droppedBatches++
            this.config.onBatchDropped?.(batch.length, failures)
            failures = 0
            this.releaseBackpressure()
            continue
          }
          // Re-queue the failed batch at the front. Use concat (single
          // allocation) instead of unshift(...batch) which shifts every
          // pending item batch.length times. Only hit on failure path.
          this.pending = batch.concat(this.pending)
          const retryAfterMs =
            err instanceof RetryableError ? err.retryAfterMs : undefined
          await this.sleep(this.retryDelay(failures, retryAfterMs))
          continue
        }

        // Release backpressure waiters if space opened up
        this.releaseBackpressure()
      }
    } finally {
      this.draining = false
      // Notify flush waiters if queue is empty
      if (this.pending.length === 0) {
        for (const resolve of this.flushResolvers) resolve()
        this.flushResolvers = []
      }
    }
  }

  /**
   * Pull the next batch from pending. Respects both maxBatchSize and
   * maxBatchBytes. The first item is always taken; subsequent items only
   * if adding them keeps the cumulative JSON size under maxBatchBytes.
   *
   * Un-serializable items (BigInt, circular refs, throwing toJSON) are
   * dropped in place — they can never be sent and leaving them at
   * pending[0] would poison the queue and hang flush() forever.
   */
  private takeBatch(): T[] {
// takeBatch：从 pending 取一批，遵守 maxBatchSize 与 maxBatchBytes（首项必取，后续累计 JSON 字节不超上限）。不可序列化的项（BigInt / 循环引用 / toJSON 抛错）就地丢弃，否则会毒化队列让 flush 永久挂起。
    const { maxBatchSize, maxBatchBytes } = this.config
    if (maxBatchBytes === undefined) {
      return this.pending.splice(0, maxBatchSize)
    }
    let bytes = 0
    let count = 0
    while (count < this.pending.length && count < maxBatchSize) {
      let itemBytes: number
      try {
        itemBytes = Buffer.byteLength(jsonStringify(this.pending[count]))
      } catch {
        this.pending.splice(count, 1)
        continue
      }
      if (count > 0 && bytes + itemBytes > maxBatchBytes) break
      bytes += itemBytes
      count++
    }
    return this.pending.splice(0, count)
  }

  private retryDelay(failures: number, retryAfterMs?: number): number {
// retryDelay：退避计算。有服务端 Retry-After 时先钳制再叠加抖动（防多会话共享限流时同时重击），否则走指数退避并叠加抖动。
    const jitter = Math.random() * this.config.jitterMs
    if (retryAfterMs !== undefined) {
      // Jitter on top of the server's hint prevents thundering herd when
      // many sessions share a rate limit and all receive the same
      // Retry-After. Clamp first, then spread — same shape as the
      // exponential path (effective ceiling is maxDelayMs + jitterMs).
      const clamped = Math.max(
        this.config.baseDelayMs,
        Math.min(retryAfterMs, this.config.maxDelayMs),
      )
      return clamped + jitter
    }
    const exponential = Math.min(
      this.config.baseDelayMs * 2 ** (failures - 1),
      this.config.maxDelayMs,
    )
    return exponential + jitter
  }

  private releaseBackpressure(): void {
// releaseBackpressure：把背压等待者一次性取出并全部唤醒，然后清空当前列表。
    const resolvers = this.backpressureResolvers
    this.backpressureResolvers = []
    for (const resolve of resolvers) resolve()
  }

  private sleep(ms: number): Promise<void> {
// sleep：可被 close 提前唤醒的延时（sleepResolve 暴露出来，close 时调用它）。
    return new Promise(resolve => {
      this.sleepResolve = resolve
      setTimeout(
        (self, resolve) => {
          self.sleepResolve = null
          resolve()
        },
        ms,
        this,
        resolve,
      )
    })
  }
}
