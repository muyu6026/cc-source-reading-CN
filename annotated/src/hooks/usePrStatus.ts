import { useEffect, useRef, useState } from 'react'
import { getLastInteractionTime } from '../bootstrap/state.js'
import { fetchPrStatus, type PrReviewState } from '../utils/ghPrStatus.js'

const POLL_INTERVAL_MS = 60_000
const SLOW_GH_THRESHOLD_MS = 4_000
const IDLE_STOP_MS = 60 * 60_000 // stop polling after 60 min idle
// 三个轮询参数：POLL_INTERVAL_MS=60s 间隔；SLOW_GH_THRESHOLD_MS=4s 慢 GH 阈值（单次 fetch 超时即永久禁用本 hook）；IDLE_STOP_MS=60min 空闲即停表。

export type PrStatusState = {
  number: number | null
  url: string | null
  reviewState: PrReviewState | null
  lastUpdated: number
}

const INITIAL_STATE: PrStatusState = {
  number: null,
  url: null,
  reviewState: null,
  lastUpdated: 0,
}

/**
 * Polls PR review status every 60s while the session is active.
 * When no interaction is detected for 60 minutes, the loop stops — no
 * timers remain. React re-runs the effect when isLoading changes
 * (turn starts/ends), restarting the loop. Effect setup schedules
 * the next poll relative to the last fetch time so turn boundaries
 * don't spawn `gh` more than once per interval. Disables permanently
 * if a fetch exceeds 4s.
 *
 * Pass `enabled: false` to skip polling entirely (hook still must be
 * called unconditionally to satisfy the rules of hooks).
 */
// 块注释：PR 评审状态每 60s 轮询，会话活跃时跑；60min 无交互则停表（无残留 timer）；慢 GH（>4s）永久禁用；enabled=false 只是跳过轮询但 hook 仍须无条件挂载（rules-of-hooks）；effect 按上次 fetch 时间排下一次，避免回合边界重复 spawn gh。
export function usePrStatus(isLoading: boolean, enabled = true): PrStatusState {
// 签名：isLoading 变化会重启 effect（回合开始/结束）；enabled 默认 true，false 时纯跳过，但 hook 无条件调用以满足规则。
  const [prStatus, setPrStatus] = useState<PrStatusState>(INITIAL_STATE)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disabledRef = useRef(false)
  const lastFetchRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    if (disabledRef.current) return

    let cancelled = false
    let lastSeenInteractionTime = -1
    let lastActivityTimestamp = Date.now()

    async function poll() {
      if (cancelled) return

      const currentInteractionTime = getLastInteractionTime()
      if (lastSeenInteractionTime !== currentInteractionTime) {
        lastSeenInteractionTime = currentInteractionTime
        lastActivityTimestamp = Date.now()
      } else if (Date.now() - lastActivityTimestamp >= IDLE_STOP_MS) {
        return
      }
// 空闲判定：lastInteractionTime 变则刷新 lastActivityTimestamp；否则距上次活动 ≥60min 直接 return 停表（不再排 setTimeout）。

      const start = Date.now()
      const result = await fetchPrStatus()
      if (cancelled) return
      lastFetchRef.current = start

      setPrStatus(prev => {
        const newNumber = result?.number ?? null
        const newReviewState = result?.reviewState ?? null
        if (prev.number === newNumber && prev.reviewState === newReviewState) {
          return prev
        }
        return {
          number: newNumber,
          url: result?.url ?? null,
          reviewState: newReviewState,
          lastUpdated: Date.now(),
        }
      })

      if (Date.now() - start > SLOW_GH_THRESHOLD_MS) {
        disabledRef.current = true
        return
      }

      if (!cancelled) {
        timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }
// fetch 后用 number+reviewState 比较决定是否 setState（避免无变化重渲染）；超 4s 设 disabledRef 永久停；否则排下一次 poll（相对 lastFetchRef，防回合边界重 spawn）。

    const elapsed = Date.now() - lastFetchRef.current
    if (elapsed >= POLL_INTERVAL_MS) {
      void poll()
    } else {
      timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS - elapsed)
    }
// effect 启动：按 lastFetchRef 计算距上次 fetch 的剩余间隔，不足一个间隔则补差，避免 turn 边界重复拉起 gh 进程。

    return () => {
      cancelled = true
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [isLoading, enabled])

  return prStatus
}
