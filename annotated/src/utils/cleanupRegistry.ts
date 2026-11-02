// 文件级批注：`cleanupRegistry.ts` 提供优雅关闭时统一登记与执行清理函数的登记处，刻意与 `gracefulShutdown.ts` 分离以避免循环依赖。
/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

/**
 * Register a cleanup function to run during graceful shutdown.
 * @param cleanupFn - Function to run during cleanup (can be sync or async)
 * @returns Unregister function that removes the cleanup handler
 */
// 登记清理函数：把回调加入全局集合，并返回一个取消登记的函数，支持动态撤销。
export function registerCleanup(cleanupFn: () => Promise<void>): () => void {
  cleanupFunctions.add(cleanupFn)
  return () => cleanupFunctions.delete(cleanupFn) // Return unregister function
}
// 收尾：登记时即返回移除自身的闭包，调用方无需手动管理生命周期。

/**
 * Run all registered cleanup functions.
 * Used internally by gracefulShutdown.
 */
// 批量执行清理：并发跑完所有已登记函数，供优雅关闭内部调用。
export async function runCleanupFunctions(): Promise<void> {
  await Promise.all(Array.from(cleanupFunctions).map(fn => fn()))
}
// 收尾：用 `Promise.all` 并行触发全部清理回调，不串行等待。
