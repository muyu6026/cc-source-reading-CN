/**
 * Denial tracking infrastructure for permission classifiers.
 * Tracks consecutive denials and total denials to determine
 * when to fall back to prompting.
 */
// 文件级：权限分类器的拒绝追踪基础设施——统计连续拒绝与累计拒绝次数，决定何时回退到向用户提问。

// DenialTrackingState 类型：只含 consecutiveDenials（连续拒绝）与 totalDenials（累计拒绝）两个计数。
export type DenialTrackingState = {
  consecutiveDenials: number
  totalDenials: number
}

// DENIAL_LIMITS：连续拒绝上限 3、累计拒绝上限 20，超过即触发回退提问。
export const DENIAL_LIMITS = {
  maxConsecutive: 3,
  maxTotal: 20,
} as const

// createDenialTrackingState：初始化两个计数都为 0。
export function createDenialTrackingState(): DenialTrackingState {
  return {
    consecutiveDenials: 0,
    totalDenials: 0,
  }
}

// recordDenial：返回新状态，连续与累计计数各加一（不可变更新，返回新对象）。
export function recordDenial(state: DenialTrackingState): DenialTrackingState {
  return {
    ...state,
    consecutiveDenials: state.consecutiveDenials + 1,
    totalDenials: state.totalDenials + 1,
  }
}

// recordSuccess：只要连续拒绝不为 0 就把连续计数清零（累计保留），记录一次成功后不再连续告警。
export function recordSuccess(state: DenialTrackingState): DenialTrackingState {
  if (state.consecutiveDenials === 0) return state // No change needed
  return {
    ...state,
    consecutiveDenials: 0,
  }
}

export function shouldFallbackToPrompting(state: DenialTrackingState): boolean {
  return (
    state.consecutiveDenials >= DENIAL_LIMITS.maxConsecutive ||
    state.totalDenials >= DENIAL_LIMITS.maxTotal
  )
}
// shouldFallbackToPrompting 收尾：连续拒绝达上限或累计拒绝达上限时返回 true，提示应回退提问。
