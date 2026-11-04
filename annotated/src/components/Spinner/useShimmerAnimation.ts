import { useMemo } from 'react'
import { stringWidth } from '../../ink/stringWidth.js'
import { type DOMElement, useAnimationFrame } from '../../ink.js'
import type { SpinnerMode } from './types.js'

// 返回 ref 与光带下标：下标完全由时间推导，消费端是无状态的纯渲染
export function useShimmerAnimation(
  mode: SpinnerMode,
  message: string,
  isStalled: boolean,
): [ref: (element: DOMElement | null) => void, glimmerIndex: number] {
  const glimmerSpeed = mode === 'requesting' ? 50 : 200
// 请求态 50ms 一帧、其余 200ms：等首字时人眼敏感要给足帧率，展示态则没必要费帧
  // Pass null when stalled to unsubscribe from the clock — otherwise the
  // setInterval keeps firing at 20fps even when the shimmer isn't visible.
  // Notably, if the caller never attaches `ref` (e.g. conditional JSX),
  // useTerminalViewport stays at its initial isVisible:true and the
  // viewport-pause never kicks in, so this is the only stop mechanism.
  const [ref, time] = useAnimationFrame(isStalled ? null : glimmerSpeed)
// 卡顿时传 null 退订时钟——这是唯一可靠的停止手段：调用方可能从不挂 ref，视口暂停就永远不会触发
  const messageWidth = useMemo(() => stringWidth(message), [message])
// 消息宽度记忆化：文案不变就不重复量宽，量宽要逐字符算 East Asian 宽度，并不便宜

// 卡顿时返回 -100：远小于任何字符下标，等价于整条光带熄灭
  if (isStalled) {
    return [ref, -100]
  }

  const cyclePosition = Math.floor(time / glimmerSpeed)
  const cycleLength = messageWidth + 20
// 周期取宽度加 20：两端各留 10 格空白，光带进场离场都不会突兀出现或消失

  if (mode === 'requesting') {
    return [ref, (cyclePosition % cycleLength) - 10]
// 请求态从左往右扫；另一态反向返回，两种节奏分别对应等待响应与正在输出
  }
  return [ref, messageWidth + 10 - (cyclePosition % cycleLength)]
}
