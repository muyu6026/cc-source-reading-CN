/**
 * Abort-responsive sleep. Resolves after `ms` milliseconds, or immediately
 * when `signal` aborts (so backoff loops don't block shutdown).
 *
 * By default, abort resolves silently; the caller should check
 * `signal.aborted` after the await. Pass `throwOnAbort: true` to have
 * abort reject — useful when the sleep is deep inside a retry loop
 * and you want the rejection to bubble up and cancel the whole operation.
 *
 * Pass `abortError` to customize the rejection error (implies
 * `throwOnAbort: true`). Useful for retry loops that catch a specific
 * error class (e.g. `APIUserAbortError`).
 */
// 可中止的 sleep：等够毫秒数就 resolve，signal 中止就立刻返回。退避重试里用它，进程关停时才不会被一个长 sleep 卡住。
export function sleep(
  ms: number,
  signal?: AbortSignal,
  opts?: { throwOnAbort?: boolean; abortError?: () => Error; unref?: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check aborted state BEFORE setting up the timer. If we defined
    // onAbort first and called it synchronously here, it would reference
    // `timer` while still in the Temporal Dead Zone.
    if (signal?.aborted) {
      if (opts?.throwOnAbort || opts?.abortError) {
        void reject(opts.abortError?.() ?? new Error('aborted'))
      } else {
        void resolve()
      }
      return
    }
// 先判已中止再建定时器：这个顺序是被 TDZ 逼出来的——若先定义 onAbort 再同步调用，它会引用还没赋值的 timer。
    const timer = setTimeout(
      (signal, onAbort, resolve) => {
        signal?.removeEventListener('abort', onAbort)
        void resolve()
      },
      ms,
      signal,
      onAbort,
      resolve,
    )
// 定时器回调把三个参数一起带进来：signal 与 onAbort 用于清监听器，resolve 用于兑现 Promise，避免回调闭包里再抓外层变量。
    function onAbort(): void {
      clearTimeout(timer)
      if (opts?.throwOnAbort || opts?.abortError) {
        void reject(opts.abortError?.() ?? new Error('aborted'))
      } else {
        void resolve()
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
// once 为 true：中止只可能发生一次，监听器用完即弃，不需要手动摘除也能被回收。
    if (opts?.unref) {
      timer.unref()
    }
  })
}
// 默认中止是静默 resolve：调用方 await 之后要自己检查 signal.aborted；需要让异常冒泡的场合才传 throwOnAbort 或 abortError。

function rejectWithTimeout(reject: (e: Error) => void, message: string): void {
  reject(new Error(message))
}
// 独立成一个具名函数是为了给 setTimeout 当参数用：内联箭头会多一层闭包，也没法在定时器回调里被引用。

/**
 * Race a promise against a timeout. Rejects with `Error(message)` if the
 * promise doesn't settle within `ms`. The timeout timer is cleared when
 * the promise settles (no dangling timer) and unref'd so it doesn't
 * block process exit.
 *
 * Note: this doesn't cancel the underlying work — if the promise is
 * backed by a runaway async operation, that keeps running. This just
 * returns control to the caller.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    // eslint-disable-next-line no-restricted-syntax -- not a sleep: REJECTS after ms (timeout guard)
    timer = setTimeout(rejectWithTimeout, ms, reject, message)
    if (typeof timer === 'object') timer.unref?.()
// timeout 的定时器也要 unref：超时守卫本身不该成为「进程还有活干」的理由，否则一个已经没人等的 Promise 能把退出拖到天荒地老。
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
// withTimeout 只归还控制权，不取消底层工作：底层如果是跑飞的异步任务，它会继续跑，调用方需要自己处理这个语义差异。
