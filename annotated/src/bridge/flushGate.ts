// 刷写闸门：在初始历史消息刷写期间拦截新消息写入，保证历史与新增消息不会交错到达服务器
/**
 * State machine for gating message writes during an initial flush.
 *
 * When a bridge session starts, historical messages are flushed to the
 * server via a single HTTP POST. During that flush, new messages must
 * be queued to prevent them from arriving at the server interleaved
 * with the historical messages.
 *
 * Lifecycle:
 *   start() → enqueue() returns true, items are queued
 *   end()   → returns queued items for draining, enqueue() returns false
 *   drop()  → discards queued items (permanent transport close)
 *   deactivate() → clears active flag without dropping items
 *                   (transport replacement — new transport will drain)
 */
export class FlushGate<T> {
// FlushGate 类：用一个激活标志 + 待发队列实现刷写期门控
  private _active = false
// 激活标志：刷写进行中为 true
  private _pending: T[] = []
// 待发出队列

  get active(): boolean {
// 只读：是否处于激活态
    return this._active
  }

  get pendingCount(): number {
// 只读：待发消息数量
    return this._pending.length
  }

  /** Mark flush as in-progress. enqueue() will start queuing items. */
  start(): void {
// start：进入刷写，之后 enqueue 开始排队
    this._active = true
  }

  /**
   * End the flush and return any queued items for draining.
   * Caller is responsible for sending the returned items.
   */
  end(): T[] {
// end：结束刷写并返回已排队项供排空，之后 enqueue 返回 false
    this._active = false
    return this._pending.splice(0)
  }

  /**
   * If flush is active, queue the items and return true.
   * If flush is not active, return false (caller should send directly).
   */
  enqueue(...items: T[]): boolean {
// enqueue：激活时入队并返回 true，否则返回 false 由调用方直发
    if (!this._active) return false
    this._pending.push(...items)
    return true
  }

  /**
   * Discard all queued items (permanent transport close).
   * Returns the number of items dropped.
   */
  drop(): number {
// drop：丢弃全部排队项（传输永久关闭），返回丢弃数量
    this._active = false
    const count = this._pending.length
    this._pending.length = 0
    return count
  }

  /**
   * Clear the active flag without dropping queued items.
   * Used when the transport is replaced (onWorkReceived) — the new
   * transport's flush will drain the pending items.
   */
  deactivate(): void {
// deactivate：只清激活标志不丢排队项（传输被替换时由新传输接管排空）
    this._active = false
  }
}
