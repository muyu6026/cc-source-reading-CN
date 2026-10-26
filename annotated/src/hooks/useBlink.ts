import { type DOMElement, useAnimationFrame, useTerminalFocus } from '../ink.js'

const BLINK_INTERVAL_MS = 600

/**
 * Hook for synchronized blinking animations that pause when offscreen.
 *
 * Returns a ref to attach to the animated element and the current blink state.
 * All instances blink together because they derive state from the same
 * animation clock. The clock only runs when at least one subscriber is visible.
 * Pauses when the terminal is blurred.
 *
 * @param enabled - Whether blinking is active
 * @returns [ref, isVisible] - Ref to attach to element, true when visible in blink cycle
 *
 * @example
 * function BlinkingDot({ shouldAnimate }) {
 *   const [ref, isVisible] = useBlink(shouldAnimate)
 *   return <Box ref={ref}>{isVisible ? '●' : ' '}</Box>
 * }
 */
// 同步闪烁动画：所有实例共享同一个动画时钟，只在至少一个可见订阅者时跑时钟，终端失焦即暂停。
export function useBlink(
  enabled: boolean,
  intervalMs: number = BLINK_INTERVAL_MS,
): [ref: (element: DOMElement | null) => void, isVisible: boolean] {
  const focused = useTerminalFocus()
  const [ref, time] = useAnimationFrame(enabled && focused ? intervalMs : null)
// 仅当 enabled 且终端聚焦时才挂动画帧；否则直接返回「常显」状态。

  if (!enabled || !focused) return [ref, true]

  // Derive blink state from time - all instances see the same time so they sync
  const isVisible = Math.floor(time / intervalMs) % 2 === 0
// 由时间推导明暗：同时间的实例 floor(time/interval)%2 一致，天然同步闪烁。
  return [ref, isVisible]
}
