// 文件级。为 `Promise.withResolvers()` 做垫片，因为 `package.json` 声明支持 Node 18、用不了 ES2024 的原生版本。
/**
 * Polyfill for Promise.withResolvers() (ES2024, Node 22+).
 * package.json declares "engines": { "node": ">=18.0.0" } so we can't use the native one.
 */
export function withResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
// 返回 `{ promise, resolve, reject }` 三元组，在 Promise 构造器内部把 resolve/reject 暴露出来，等价于原生 API。
}
