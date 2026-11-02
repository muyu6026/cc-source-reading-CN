// 计算机操控原生模块的主队列泵。背景是 Swift 侧几个主线程异步方法以及输入模块的按键接口都会派发到主队列，而在 Node 或 Bun 这类基于 libuv 的运行时里这个队列不会被抽干，promise 就永远挂着；Electron 自己有运行循环，所以不需要这套。
import { logForDebugging } from '../debug.js'
import { withResolvers } from '../withResolvers.js'
import { requireComputerUseSwift } from './swiftLoader.js'

/**
 * Shared CFRunLoop pump. Swift's four `@MainActor` async methods
 * (captureExcluding, captureRegion, apps.listInstalled, resolvePrepareCapture)
 * and `@ant/computer-use-input`'s key()/keys() all dispatch to
 * DispatchQueue.main. Under libuv (Node/bun) that queue never drains — the
 * promises hang. Electron drains it via CFRunLoop so Cowork doesn't need this.
 *
 * One refcounted setInterval calls `_drainMainRunLoop` (RunLoop.main.run)
 * every 1ms while any main-queue-dependent call is pending. Multiple
 * concurrent drainRunLoop() calls share the single pump via retain/release.
 */

let pump: ReturnType<typeof setInterval> | undefined
let pending = 0

function drainTick(cu: ReturnType<typeof requireComputerUseSwift>): void {
  cu._drainMainRunLoop()
}
// 每次心跳只做一件事：调原生侧的抽干函数。抽干函数本身不做业务，只让主队列有机会推进一格，所以频率可以给到 1 毫秒。

function retain(): void {
  pending++
  if (pump === undefined) {
    pump = setInterval(drainTick, 1, requireComputerUseSwift())
    logForDebugging('[drainRunLoop] pump started', { level: 'verbose' })
  }
}

function release(): void {
  pending--
  if (pending <= 0 && pump !== undefined) {
    clearInterval(pump)
    pump = undefined
    logForDebugging('[drainRunLoop] pump stopped', { level: 'verbose' })
    pending = 0
  }
}
// 这是一对引用计数的纪律：持有方加一，没有持有方时立刻停表并复位计数。停表条件写成小于等于零而不是等于零，是为了让调用方多释放一次也不至于把泵留在运行状态；计数归零时再显式置零，防止负数累积。

const TIMEOUT_MS = 30_000

function timeoutReject(reject: (e: Error) => void): void {
  reject(new Error(`computer-use native call exceeded ${TIMEOUT_MS}ms`))
}

/**
 * Hold a pump reference for the lifetime of a long-lived registration
 * (e.g. the CGEventTap Escape handler). Unlike `drainRunLoop(fn)` this has
 * no timeout — the caller is responsible for calling `releasePump()`. Same
 * refcount as drainRunLoop calls, so nesting is safe.
 */
export const retainPump = retain
export const releasePump = release
// 长期注册场景（例如全局事件监听）不能走带超时的包装，否则注册本身会被 30 秒切断。所以把引用计数单独导出：持有方自己负责配对释放，与短调用共用同一个计数器，嵌套与共存都安全。

/**
 * Await `fn()` with the shared drain pump running. Safe to nest — multiple
 * concurrent drainRunLoop() calls share one setInterval.
 */
export async function drainRunLoop<T>(fn: () => Promise<T>): Promise<T> {
  retain()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // If the timeout wins the race, fn()'s promise is orphaned — a late
    // rejection from the native layer would become an unhandledRejection.
    // Attaching a no-op catch swallows it; the timeout error is what surfaces.
    // fn() sits inside try so a synchronous throw (e.g. NAPI argument
    // validation) still reaches release() — otherwise the pump leaks.
    const work = fn()
    work.catch(() => {})
    const timeout = withResolvers<never>()
    timer = setTimeout(timeoutReject, TIMEOUT_MS, timeout.reject)
    return await Promise.race([work, timeout.promise])
  } finally {
    clearTimeout(timer)
    release()
  }
}
// 主体做了三件事，顺序都有原因。第一，调用放进 try 里而不是 try 之外，这样同步抛错（比如原生参数校验失败）也能走到 finally 里的释放，否则泵会永久泄漏。第二，给返回的 promise 挂一个空 catch，因为超时胜出后原 promise 就成了孤儿，原生层迟到的拒绝会变成未处理的拒绝。第三，超时用可提前拒绝的容器加定时器参与竞速，timeout 只负责赢，不负责清理。
