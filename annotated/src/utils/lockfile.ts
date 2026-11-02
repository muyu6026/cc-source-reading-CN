/**
 * Lazy accessor for proper-lockfile.
 *
 * proper-lockfile depends on graceful-fs, which monkey-patches every fs
 * method on first require (~8ms). Static imports of proper-lockfile pull this
 * cost into the startup path even when no locking happens (e.g. `--help`).
 *
 * Import this module instead of `proper-lockfile` directly. The underlying
 * package is only loaded the first time a lock function is actually called.
 */
// 模块总述：proper-lockfile 的惰性访问封装。该依赖会在首次 require 时通过 graceful-fs 猴补丁改写所有 fs 方法（约 8ms），直接静态导入会把这笔开销拖进启动路径；本模块改为首次实际调用锁函数时才加载底层包。

import type { CheckOptions, LockOptions, UnlockOptions } from 'proper-lockfile'

type Lockfile = typeof import('proper-lockfile')

let _lockfile: Lockfile | undefined

// 私有 getLockfile：惰性 require 封装，只在第一次调用锁函数时加载 proper-lockfile 并缓存到模块级变量，避免启动期代价。
function getLockfile(): Lockfile {
  if (!_lockfile) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _lockfile = require('proper-lockfile') as Lockfile
  }
  return _lockfile
}

// 公开 lock：异步获取锁，返回的是一个「解锁器」函数，调用它即可释放，便于用 try/finally 管理生命周期。
export function lock(
  file: string,
  options?: LockOptions,
): Promise<() => Promise<void>> {
  return getLockfile().lock(file, options)
}

// 公开 lockSync：lock 的同步版本，供需要在启动早期同步持锁的场景使用。
export function lockSync(file: string, options?: LockOptions): () => void {
  return getLockfile().lockSync(file, options)
}

// 公开 unlock：显式释放指定文件的锁。
export function unlock(file: string, options?: UnlockOptions): Promise<void> {
  return getLockfile().unlock(file, options)
}

// 公开 check：探测某文件当前是否已被加锁，返回布尔值。
export function check(file: string, options?: CheckOptions): Promise<boolean> {
  return getLockfile().check(file, options)
}
