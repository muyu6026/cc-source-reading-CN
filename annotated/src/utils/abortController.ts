import { setMaxListeners } from 'events'
// 本文件统一 AbortController 的创建与父子联动：解决监听器上限告警，并用弱引用避免父控制器滞留已被丢弃的子控制器。

/**
 * Default max listeners for standard operations
 */
const DEFAULT_MAX_LISTENERS = 50
// 默认监听器上限取 50：一次查询里可能有大量并发子任务同时挂在同一个信号上，Node 默认的 10 个会刷 MaxListenersExceededWarning 噪音。

/**
 * Creates an AbortController with proper event listener limits set.
 * This prevents MaxListenersExceededWarning when multiple listeners
 * are attached to the abort signal.
 *
 * @param maxListeners - Maximum number of listeners (default: 50)
 * @returns AbortController with configured listener limit
 */
export function createAbortController(
  maxListeners: number = DEFAULT_MAX_LISTENERS,
): AbortController {
  const controller = new AbortController()
  setMaxListeners(maxListeners, controller.signal)
// 上限挂在 signal 上而不是 controller 上：告警是按单个事件目标统计监听器数量，而信号才是监听器实际聚集的对象。
  return controller
}
// createAbortController 是全仓创建控制器的唯一入口：保证所有信号都带上调高的上限，直接 new AbortController 的地方容易漏掉这一步。

/**
 * Propagates abort from a parent to a weakly-referenced child controller.
 * Both parent and child are weakly held — neither direction creates a
 * strong reference that could prevent GC.
 * Module-scope function avoids per-call closure allocation.
 */
function propagateAbort(
  this: WeakRef<AbortController>,
  weakChild: WeakRef<AbortController>,
): void {
  const parent = this.deref()
  weakChild.deref()?.abort(parent?.signal.reason)
}
// propagateAbort 用 this 接收父级弱引用：绑定后的函数挂在父信号上，父级被回收时 deref 返回 undefined，调用自然退化成空操作。

/**
 * Removes an abort handler from a weakly-referenced parent signal.
 * Both parent and handler are weakly held — if either has been GC'd
 * or the parent already aborted ({once: true}), this is a no-op.
 * Module-scope function avoids per-call closure allocation.
 */
function removeAbortHandler(
  this: WeakRef<AbortController>,
  weakHandler: WeakRef<(...args: unknown[]) => void>,
): void {
  const parent = this.deref()
  const handler = weakHandler.deref()
  if (parent && handler) {
    parent.signal.removeEventListener('abort', handler)
  }
}
// removeAbortHandler 在子控制器被中止后摘掉父级监听：否则父信号上会留下大量已 GC 子任务的处理器，把监听器数组越撑越大。

/**
 * Creates a child AbortController that aborts when its parent aborts.
 * Aborting the child does NOT affect the parent.
 *
 * Memory-safe: Uses WeakRef so the parent doesn't retain abandoned children.
 * If the child is dropped without being aborted, it can still be GC'd.
 * When the child IS aborted, the parent listener is removed to prevent
 * accumulation of dead handlers.
 *
 * @param parent - The parent AbortController
 * @param maxListeners - Maximum number of listeners (default: 50)
 * @returns Child AbortController
 */
export function createChildAbortController(
  parent: AbortController,
  maxListeners?: number,
): AbortController {
  const child = createAbortController(maxListeners)

  // Fast path: parent already aborted, no listener setup needed
  if (parent.signal.aborted) {
// 父级已中止时直接继承其 reason 并短路返回：省掉一次 WeakRef 创建与两个监听器注册，也避免给一个已完成的信号再加监听。
    child.abort(parent.signal.reason)
    return child
  }

  // WeakRef prevents the parent from keeping an abandoned child alive.
  // If all strong references to child are dropped without aborting it,
  // the child can still be GC'd — the parent only holds a dead WeakRef.
  const weakChild = new WeakRef(child)
  const weakParent = new WeakRef(parent)
  const handler = propagateAbort.bind(weakParent, weakChild)
// bind 把两个弱引用固化成 this 与实参：模块级函数复用同一份代码，避免每次创建子控制器都分配一个新闭包。

  parent.signal.addEventListener('abort', handler, { once: true })

  // Auto-cleanup: remove parent listener when child is aborted (from any source).
  // Both parent and handler are weakly held — if either has been GC'd or the
  // parent already aborted ({once: true}), the cleanup is a harmless no-op.
  child.signal.addEventListener(
    'abort',
    removeAbortHandler.bind(weakParent, new WeakRef(handler)),
    { once: true },
  )

  return child
}
// 组合语义收尾：父中止则子跟着中止；子单独中止则只摘监听器、不动父级。两个方向都不持有强引用，被丢弃的子控制器可正常回收。
