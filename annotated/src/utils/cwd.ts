// 本文件用 AsyncLocalStorage 实现「按异步上下文覆盖当前工作目录」，让并发的智能体各自看到自己的 cwd 而不互相污染全局状态。
import { AsyncLocalStorage } from 'async_hooks'
import { getCwdState, getOriginalCwd } from '../bootstrap/state.js'

const cwdOverrideStorage = new AsyncLocalStorage<string>()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
// runWithCwdOverride：在给定 cwd 下运行 fn，fn 及其所有异步后代调用 pwd() / getCwd() 都会拿到这个覆盖值。
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return cwdOverrideStorage.run(cwd, fn)
}

/**
 * Get the current working directory
 */
// pwd：优先读取 AsyncLocalStorage 中本上下文的覆盖值，否则回退到全局 cwd 状态。
export function pwd(): string {
  return cwdOverrideStorage.getStore() ?? getCwdState()
}

/**
 * Get the current working directory or the original working directory if the current one is not available
 */
// getCwd：在 pwd() 之外再加一层兜底——若读取失败则回退到原始启动目录 getOriginalCwd()。
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}
