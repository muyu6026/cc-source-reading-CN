/**
 * Shared capacity-wake primitive for bridge poll loops.
 *
 * Both replBridge.ts and bridgeMain.ts need to sleep while "at capacity"
 * but wake early when either (a) the outer loop signal aborts (shutdown),
 * or (b) capacity frees up (session done / transport lost). This module
 * encapsulates the mutable wake-controller + two-signal merger that both
 * poll loops previously duplicated byte-for-byte.
 */

export type CapacitySignal = { signal: AbortSignal; cleanup: () => void }
// 容量信号封装：对外暴露合并后的中止信号与正常收尾时的清理函数。

export type CapacityWake = {
  /**
   * Create a signal that aborts when either the outer loop signal or the
   * capacity-wake controller fires. Returns the merged signal and a cleanup
   * function that removes listeners when the sleep resolves normally
   * (without abort).
   */
  signal(): CapacitySignal
  /**
   * Abort the current at-capacity sleep and arm a fresh controller so the
   * poll loop immediately re-checks for new work.
   */
  wake(): void
}
// CapacityWake 接口：对外暴露取信号与主动唤醒两个能力。

export function createCapacityWake(outerSignal: AbortSignal): CapacityWake {
// 工厂闭包持有可重置的中止控制器，供两个轮询循环复用。
  let wakeController = new AbortController()

// wake 中止旧控制器并新建一个，立即触发下一轮容量复检。
  function wake(): void {
    wakeController.abort()
    wakeController = new AbortController()
  }

  function signal(): CapacitySignal {
    const merged = new AbortController()
    const abort = (): void => merged.abort()
    if (outerSignal.aborted || wakeController.signal.aborted) {
      merged.abort()
      return { signal: merged.signal, cleanup: () => {} }
    }
    outerSignal.addEventListener('abort', abort, { once: true })
    const capSig = wakeController.signal
    capSig.addEventListener('abort', abort, { once: true })
    return {
      signal: merged.signal,
      cleanup: () => {
        outerSignal.removeEventListener('abort', abort)
// signal 合并内外两个中止源，注册一次性监听与双向清理。
        capSig.removeEventListener('abort', abort)
      },
    }
// 返回共享的 signal 与 wake，构成轮询循环可复用的唤醒原语。
  }

  return { signal, wake }
}
