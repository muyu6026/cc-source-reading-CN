import { useEffect, useRef, useState } from 'react'

/**
 * Throttles a value so each distinct value stays visible for at least `minMs`.
 * Prevents fast-cycling progress text from flickering past before it's readable.
 *
 * Unlike debounce (wait for quiet) or throttle (limit rate), this guarantees
 * each value gets its minimum screen time before being replaced.
 */
// 节流显示：保证每个值至少停留 minMs 才被替换，防止快速轮转的进度文本一闪而过读不清。
export function useMinDisplayTime<T>(value: T, minMs: number): T {
  const [displayed, setDisplayed] = useState(value)
  const lastShownAtRef = useRef(0)

  useEffect(() => {
    const elapsed = Date.now() - lastShownAtRef.current
    if (elapsed >= minMs) {
// 已停留够久：立即更新 lastShownAt 并切换显示值。
      lastShownAtRef.current = Date.now()
      setDisplayed(value)
      return
    }
    const timer = setTimeout(
      (shownAtRef, setFn, v) => {
        shownAtRef.current = Date.now()
        setFn(v)
      },
      minMs - elapsed,
      lastShownAtRef,
      setDisplayed,
      value,
    )
    return () => clearTimeout(timer)
// 不够久：setTimeout 补足剩余时间，并把 ref/setter/value 作为参数传进去（避免闭包捕获过期值）。
  }, [value, minMs])

  return displayed
}
