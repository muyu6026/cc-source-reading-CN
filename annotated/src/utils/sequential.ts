// 把一个异步函数包装成串行执行：并发调用不会并行进入原函数，而是排进队列依次执行，且各自拿到属于自己的结果或错误。用于写文件、更新数据库这类并发就会互相踩踏的操作。
type QueueItem<T extends unknown[], R> = {
  args: T
  resolve: (value: R) => void
  reject: (reason?: unknown) => void
  context: unknown
}

/**
 * Creates a sequential execution wrapper for async functions to prevent race conditions.
 * Ensures that concurrent calls to the wrapped function are executed one at a time
 * in the order they were received, while preserving the correct return values.
 *
 * This is useful for operations that must be performed sequentially, such as
 * file writes or database updates that could cause conflicts if executed concurrently.
 *
 * @param fn - The async function to wrap with sequential execution
 * @returns A wrapped version of the function that executes calls sequentially
 */
export function sequential<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  const queue: QueueItem<T, R>[] = []
  let processing = false
// 两个模块级状态就够：队列本身，以及一个「正在处理」标记。标记的作用不是限流，而是防止多个调用各自启动一轮消费循环——否则同一个队列会被多个循环同时取走，串行性立刻失效。

  async function processQueue(): Promise<void> {
    if (processing) return
    if (queue.length === 0) return

    processing = true
// 进入消费循环后立刻置位标记，注意它是在取第一个元素之前置位：如果放到循环内部，中间任何一次 await 让出都可能让另一个调用挤进来另起循环。

    while (queue.length > 0) {
      const { args, resolve, reject, context } = queue.shift()!

      try {
        const result = await fn.apply(context, args)
        resolve(result)
      } catch (error) {
        reject(error)
      }
    }

    processing = false

    // Check if new items were added while we were processing
    if (queue.length > 0) {
      void processQueue()
    }
  }
// 循环体是一次「取出、调用、按结果兑现」的固定序列：成功就兑现解决、抛错就兑现拒绝——错误被转成对应调用的拒绝，而不是让整个队列中断，所以一个失败不会影响后面排队的调用。循环退出后先清标记，再补一次自检：清标记与检查队列之间可能有新元素在 await 期间入队，这个自检就是为那个窗口准备的。

  return function (this: unknown, ...args: T): Promise<R> {
    return new Promise((resolve, reject) => {
      queue.push({ args, resolve, reject, context: this })
      void processQueue()
    })
  }
}
// 对外返回的函数只做两件事：把参数、两个兑现回调、以及调用时的 this 一起入队，然后立刻尝试启动消费。this 也要存下来，因为原函数可能是依赖 this 的方法，而包装函数不能用箭头函数否则会丢绑定。
