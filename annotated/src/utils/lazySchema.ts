// 本文件导出一个惰性 schema 工厂 `lazySchema`，用于把 Zod schema 的构建从模块初始化阶段推迟到首次访问，避免无谓的提前构造开销。
/**
 * Returns a memoized factory function that constructs the value on first call.
 * Used to defer Zod schema construction from module init time to first access.
 */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}
// 函数收尾：`lazySchema` 返回一个闭包，首次调用时用 `factory()` 构造值并缓存进 `cached`，之后直接返回缓存；空值合并赋值 `??=` 保证只构造一次，实现一次性记忆化。
