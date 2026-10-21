import { useContext, useEffect, useState } from 'react'
import { ClockContext } from '../components/ClockContext.js'
import type { DOMElement } from '../dom.js'
import { useTerminalViewport } from './use-terminal-viewport.js'

/**
 * Hook for synchronized animations that pause when offscreen.
 *
 * Returns a ref to attach to the animated element and the current animation time.
 * All instances share the same clock, so animations stay in sync.
 * The clock only runs when at least one keepAlive subscriber exists.
 *
 * Pass `null` to pause — unsubscribes from the clock so no ticks fire.
 * Time freezes at the last value and resumes from the current clock time
 * when a number is passed again.
 *
 * @param intervalMs - How often to update, or null to pause
 * @returns [ref, time] - Ref to attach to element, elapsed time in ms
 *
 * @example
 * function Spinner() {
 *   const [ref, time] = useAnimationFrame(120)
 *   const frame = Math.floor(time / 120) % FRAMES.length
 *   return <Box ref={ref}>{FRAMES[frame]}</Box>
 * }
 *
 * The clock automatically slows when the terminal is blurred,
 * so consumers don't need to handle focus state.
 */
// 【两个停的条件，作用不同】
//
//   intervalMs === null  → 调用方主动暂停（比如动画结束了）
//   !isVisible           → 元素滚出视口，被动暂停
//
// 第二个是性能上的关键：一个全屏的应用里可能有几十个 spinner，
// 滚出去的那些如果还在每帧 setState，主线程就被白白占满了。
// 而且注意 active 同时控制下面 effect 的订阅 —— 不可见时**退订**，
// 于是 Clock 的 keepAlive 计数掉到 0，定时器整个停掉（见 ClockContext）。
// 这不是「少画几帧」，是「不唤醒事件循环」。
export function useAnimationFrame(
  intervalMs: number | null = 16,
): [ref: (element: DOMElement | null) => void, time: number] {
  const clock = useContext(ClockContext)
  const [viewportRef, { isVisible }] = useTerminalViewport()
  const [time, setTime] = useState(() => clock?.now() ?? 0)

  const active = isVisible && intervalMs !== null
// 这里把两个暂停条件合成一个布尔量。用 && 而不是把判断散在 effect 里，
// 是因为 active 同时是 effect 的依赖 —— 合成一个值，依赖数组就只写一个，
// 不用每处都记得把 isVisible 和 intervalMs 都列上。

  useEffect(() => {
    if (!clock || !active) return

    let lastUpdate = clock.now()

    const onChange = (): void => {
      const now = clock.now()
      if (now - lastUpdate >= intervalMs!) {
        lastUpdate = now
        setTime(now)
      }
    }

    // keepAlive: true — visible animations drive the clock
    return clock.subscribe(onChange, true)
// keepAlive: true —— 可见的动画**负责驱动**这个时钟（订阅者里只要有一个
// true，Clock 就维持定时器）。
//
// 对照 use-interval.ts 里的 useAnimationTimer：它用 false，也就是
// 「搭便车」—— 有时钟在跑就跟着更新，没人在跑就永远不动。
// 两种用法必须配对：一个页面如果只有非 keepAlive 订阅者，动画是静止的。
// 这不是 bug，是「谁来承担唤醒成本」的显式选择。
  }, [clock, intervalMs, active])

  return [viewportRef, time]
}
