import { sleep } from '../../utils/sleep.js'

/**
 * Coalescing uploader for PUT /worker (session state + metadata).
 *
 * - 1 in-flight PUT + 1 pending patch
 * - New calls coalesce into pending (never grows beyond 1 slot)
 * - On success: send pending if exists
 * - On failure: exponential backoff (clamped), retries indefinitely
 *   until success or close(). Absorbs any pending patches before each retry.
 * - No backpressure needed — naturally bounded at 2 slots
 *
 * Coalescing rules:
 * - Top-level keys (worker_status, external_metadata) — last value wins
 * - Inside external_metadata / internal_metadata — RFC 7396 merge:
 *   keys are added/overwritten, null values preserved (server deletes)
 */

type WorkerStateUploaderConfig = {
  send: (body: Record<string, unknown>) => Promise<boolean>
  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number
  /** Max delay cap (ms) */
  maxDelayMs: number
  /** Random jitter range added to retry delay (ms) */
  jitterMs: number
}

export class WorkerStateUploader {
// 在飞请求用 Promise 占位而不是布尔：并发第二次调用要能立刻看出「已经有一条队列在跑」
  private inflight: Promise<void> | null = null
// 待发槽只有一个：新调用合并进来而不是排队，所以两个槽就是全部状态，永远不需要背压
  private pending: Record<string, unknown> | null = null
  private closed = false
  private readonly config: WorkerStateUploaderConfig

  constructor(config: WorkerStateUploaderConfig) {
    this.config = config
  }

  /**
   * Enqueue a patch to PUT /worker. Coalesces with any existing pending
   * patch. Fire-and-forget — callers don't need to await.
   */
// 入队从不等待：调用方在状态更新路径上，等一次网络往返会把界面拖住
  enqueue(patch: Record<string, unknown>): void {
    if (this.closed) return
// 有旧补丁就合并、没有就直接顶替：待发槽永远不会增长，合并是它唯一的变化方式
    this.pending = this.pending ? coalescePatches(this.pending, patch) : patch
    void this.drain()
  }

// 关闭只做两件事：置位并丢掉待发。正在飞的那次会自己看到标志后退出
  close(): void {
    this.closed = true
    this.pending = null
  }

  private async drain(): Promise<void> {
// 三个守卫的顺序有讲究：先看在飞、再看关闭、最后看有没有待发，避免空转时也去建 Promise
    if (this.inflight || this.closed) return
    if (!this.pending) return

// 取走待发再清空：必须排在发请求之前，否则失败重试会把同一条补丁重放两次
    const payload = this.pending
    this.pending = null

// 用 then 而不是 await：清在飞与续跑都要等发送结束，但调用方要立刻拿回控制权
    this.inflight = this.sendWithRetry(payload).then(() => {
      this.inflight = null
// 续跑前再查一次关闭：关闭发生在请求在飞期间完全可能
      if (this.pending && !this.closed) {
        void this.drain()
      }
    })
  }

  /** Retries indefinitely with exponential backoff until success or close(). */
// 无限重试直到成功或关闭：状态上报丢一条没人发现，丢一批会让服务端视图长期错误
  private async sendWithRetry(payload: Record<string, unknown>): Promise<void> {
    let current = payload
    let failures = 0
// 每轮都看关闭标志：睡醒后第一件事就是确认还该不该继续
    while (!this.closed) {
      const ok = await this.config.send(current)
      if (ok) return

      failures++
// 失败次数先加再算延迟：第一次失败就要退避一档，而不是立刻重试
      await sleep(this.retryDelay(failures))

      // Absorb any patches that arrived during the retry
// 重试期间到达的补丁并进来：否则这些更新要等这次成功才发，最坏要等一整轮退避
      if (this.pending && !this.closed) {
        current = coalescePatches(current, this.pending)
        this.pending = null
      }
    }
  }

// 指数退避封顶再加抖动：没有抖动的话，同一批同时失败的客户端会继续同步撞在一起
  private retryDelay(failures: number): number {
    const exponential = Math.min(
      this.config.baseDelayMs * 2 ** (failures - 1),
      this.config.maxDelayMs,
    )
    const jitter = Math.random() * this.config.jitterMs
    return exponential + jitter
  }
}

/**
 * Coalesce two patches for PUT /worker.
 *
 * Top-level keys: overlay replaces base (last value wins).
 * Metadata keys (external_metadata, internal_metadata): RFC 7396 merge
 * one level deep — overlay keys are added/overwritten, null values
 * preserved for server-side delete.
 */
// 合并只下钻一层：元数据内部的规则是服务端定的，客户端不该猜更深的结构
function coalescePatches(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base }

  for (const [key, value] of Object.entries(overlay)) {
// 只对两个元数据字段做深合并，其余整体替换：包括值为空时的删除语义
    if (
      (key === 'external_metadata' || key === 'internal_metadata') &&
      merged[key] &&
      typeof merged[key] === 'object' &&
      typeof value === 'object' &&
      value !== null
    ) {
      // RFC 7396 merge — overlay keys win, nulls preserved for server
// 浅合并即可：删除语义靠空值本身表达，客户端不需要区分「缺失」与「显式置空」
      merged[key] = {
        ...(merged[key] as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      }
    } else {
      merged[key] = value
    }
  }

  return merged
}
