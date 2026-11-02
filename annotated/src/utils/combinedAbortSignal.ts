import { createAbortController } from './abortController.js'
// 文件级：组合多个 AbortSignal 与可选超时，返回一个合并 signal 与 cleanup；在 Bun 下特意用 setTimeout+clearTimeout 而非 AbortSignal.timeout（后者计时器会被惰性持有约 2.4KB/次直到触发）。

/**
 * Creates a combined AbortSignal that aborts when the input signal aborts,
 * an optional second signal aborts, or an optional timeout elapses.
 * Returns both the signal and a cleanup function that removes event listeners
 * and clears the internal timeout timer.
 *
 * Use `timeoutMs` instead of passing `AbortSignal.timeout(ms)` as a signal —
 * under Bun, `AbortSignal.timeout` timers are finalized lazily and accumulate
 * in native memory until they fire (measured ~2.4KB/call held for the full
 * timeout duration). This implementation uses `setTimeout` + `clearTimeout`
 * so the timer is freed immediately on cleanup.
 */
// createCombinedAbortSignal：入参是主 signal、可选 signalB、可选 timeoutMs；任一已 aborted 则直接返回已中止的 signal 与空 cleanup。
export function createCombinedAbortSignal(
  signal: AbortSignal | undefined,
  opts?: { signalB?: AbortSignal; timeoutMs?: number },
): { signal: AbortSignal; cleanup: () => void } {
  const { signalB, timeoutMs } = opts ?? {}
  const combined = createAbortController()

  if (signal?.aborted || signalB?.aborted) {
    combined.abort()
    return { signal: combined.signal, cleanup: () => {} }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const abortCombined = () => {
    if (timer !== undefined) clearTimeout(timer)
    combined.abort()
  }

  if (timeoutMs !== undefined) {
    timer = setTimeout(abortCombined, timeoutMs)
// 设超时：timeoutMs 给定时启用 setTimeout 调 abortCombined，并 unref 避免阻止进程退出。
    timer.unref?.()
  }
  signal?.addEventListener('abort', abortCombined)
  signalB?.addEventListener('abort', abortCombined)

  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer)
    signal?.removeEventListener('abort', abortCombined)
    signalB?.removeEventListener('abort', abortCombined)
  }

  return { signal: combined.signal, cleanup }
}
// 收尾：返回合并后的 signal 与 cleanup（cleanup 会清定时器并移除两个 signal 的 abort 监听）。
