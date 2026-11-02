/**
 * A fixed-size circular buffer that automatically evicts the oldest items
 * when the buffer is full. Useful for maintaining a rolling window of data.
 */
// 定长环形缓冲：写满之后自动覆盖最旧的一项，用来维护「最近 N 条」这种滚动窗口。底层就是一个定长数组加两个游标，没有任何链表或搬移。
export class CircularBuffer<T> {
  private buffer: T[]
  private head = 0
  private size = 0

  constructor(private capacity: number) {
    this.buffer = new Array(capacity)
  }
// 构造时就按容量开好数组：之后写入永远只覆盖某个槽位，不会扩容也不会搬移元素，add 是严格 O(1)。

  /**
   * Add an item to the buffer. If the buffer is full,
   * the oldest item will be evicted.
   */
  add(item: T): void {
    this.buffer[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) {
      this.size++
    }
  }
// head 用取模回绕，size 到容量为止不再增长：两个数字一起表达了「写到哪里」与「里面有多少」，不需要额外的首尾指针。

  /**
   * Add multiple items to the buffer at once.
   */
  addAll(items: T[]): void {
    for (const item of items) {
      this.add(item)
    }
  }
// 批量写入逐个调用 add：顺序与逐个写完全一致，不做批量优化是刻意的——真需要批量性能的场合应该换数据结构。

  /**
   * Get the most recent N items from the buffer.
   * Returns fewer items if the buffer contains less than N items.
   */
  getRecent(count: number): T[] {
    const result: T[] = []
    const start = this.size < this.capacity ? 0 : this.head
    const available = Math.min(count, this.size)

    for (let i = 0; i < available; i++) {
      const index = (start + this.size - available + i) % this.capacity
      result.push(this.buffer[index]!)
    }

    return result
  }
// 取最近 N 条要按「相对最新位置」倒推：起点是 head（已满时最旧的一项所在槽位），再偏移到 size 减 available 的位置，取模保证绕圈也对。

  /**
   * Get all items currently in the buffer, in order from oldest to newest.
   */
  toArray(): T[] {
    if (this.size === 0) return []

    const result: T[] = []
    const start = this.size < this.capacity ? 0 : this.head

    for (let i = 0; i < this.size; i++) {
      const index = (start + i) % this.capacity
      result.push(this.buffer[index]!)
    }

    return result
  }
// toArray 从头到尾按逻辑顺序取：未满时从 0 开始，已满时从 head 开始，取 size 个即得到从旧到新的完整序列。

  /**
   * Clear all items from the buffer.
   */
  clear(): void {
    this.buffer.length = 0
    this.head = 0
    this.size = 0
  }
// clear 把数组长度清零而不是重新分配：释放引用让元素可被回收，同时保留 capacity 字段不受影响。

  /**
   * Get the current number of items in the buffer.
   */
  length(): number {
    return this.size
  }
}
// length 返回逻辑长度而非 capacity：调用方关心的是「现在有多少条」，容量是内部实现细节。
