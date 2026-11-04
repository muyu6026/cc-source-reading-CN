import { useRef } from 'react'

// Hook to handle the transition to red when tokens stop flowing.
// Driven by the parent's animation clock time instead of independent intervals,
// so it slows down when the terminal is blurred.
// useStalledAnimation：token 停流后把 spinner 渐变成红色的动画，时钟由父组件传入，所以终端失焦时会一起变慢
export function useStalledAnimation(
  time: number,
  currentResponseLength: number,
  hasActiveTools = false,
  reducedMotion = false,
): {
  isStalled: boolean
  stalledIntensity: number
} {
  const lastTokenTime = useRef(time)
// 五个 ref：上次 token 时间、上次响应长度、挂载时间、当前平滑强度、上次平滑时间
  const lastResponseLength = useRef(currentResponseLength)
  const mountTime = useRef(time)
  const stalledIntensityRef = useRef(0)
  const lastSmoothTime = useRef(time)

  // Reset timer when new tokens arrive (check actual length change)
  if (currentResponseLength > lastResponseLength.current) {
// 渲染期直接改 ref：长度增长即视为有新 token，重置计时并把强度归零——这是渲染副作用，靠「只在变长时触发」保证幂等
    lastTokenTime.current = time
    lastResponseLength.current = currentResponseLength
    stalledIntensityRef.current = 0
    lastSmoothTime.current = time
  }

  // Derive time since last token from animation clock
  let timeSinceLastToken: number
  if (hasActiveTools) {
// 有活跃工具时不算卡顿：把 lastTokenTime 顶到当前，工具在跑的时候不该变红
    timeSinceLastToken = 0
    lastTokenTime.current = time
  } else if (currentResponseLength > 0) {
// 已有内容时算距上次 token 的时长；内容还是空时用挂载时间——首个 token 到来前同样在计时
    timeSinceLastToken = time - lastTokenTime.current
  } else {
    timeSinceLastToken = time - mountTime.current
  }

  // Calculate stalled intensity based on time since last token
  // Start showing red after 3 seconds of no new tokens (only when no tools are active)
  const isStalled = timeSinceLastToken > 3000 && !hasActiveTools
// 超过 3 秒且无活跃工具才判为卡顿
  const intensity = isStalled
    ? Math.min((timeSinceLastToken - 3000) / 2000, 1) // Fade over 2 seconds
// 强度在 3 到 5 秒之间线性升到 1（除以 2000 再夹到 1）
    : 0

  // Smooth intensity transition driven by animation frame ticks
  if (!reducedMotion && (intensity > 0 || stalledIntensityRef.current > 0)) {
// 平滑过渡只在需要渐变时做：按 50 毫秒一帧补算，最多补 steps 次
    const dt = time - lastSmoothTime.current
    if (dt >= 50) {
      const steps = Math.floor(dt / 50)
      let current = stalledIntensityRef.current
      for (let i = 0; i < steps; i++) {
        const diff = intensity - current
        if (Math.abs(diff) < 0.01) {
// 差值小于 0.01 直接吸附：避免无限逼近永远到不了目标
          current = intensity
          break
        }
        current += diff * 0.1
// 每帧逼近 10%：指数逼近，快而不生硬
      }
      stalledIntensityRef.current = current
      lastSmoothTime.current = time
    }
  } else {
// 无需渐变时直接对齐：减动效或强度为 0 都不要中间态
    stalledIntensityRef.current = intensity
    lastSmoothTime.current = time
  }

  // When reducedMotion is enabled, use instant intensity change
  const effectiveIntensity = reducedMotion
// 减动效模式用瞬时强度：不做平滑，尊重系统偏好
    ? intensity
    : stalledIntensityRef.current

  return { isStalled, stalledIntensity: effectiveIntensity }
}
