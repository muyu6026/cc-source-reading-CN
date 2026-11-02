import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
// Plan Mode v2 的配额与实验开关：并行探索的 agent 数量、访谈阶段是否启用，以及计划文件结构的实验分组。
import { getRateLimitTier, getSubscriptionType } from './auth.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export function getPlanModeV2AgentCount(): number {
  // Environment variable override takes precedence
  if (process.env.CLAUDE_CODE_PLAN_V2_AGENT_COUNT) {
    const count = parseInt(process.env.CLAUDE_CODE_PLAN_V2_AGENT_COUNT, 10)
    if (!isNaN(count) && count > 0 && count <= 10) {
      return count
    }
  }
// 环境变量覆盖优先级最高，且有 1 到 10 的合法性夹取：非法值不报错，直接忽略并回退到按订阅档位的默认值。

  const subscriptionType = getSubscriptionType()
  const rateLimitTier = getRateLimitTier()

  if (
    subscriptionType === 'max' &&
    rateLimitTier === 'default_claude_max_20x'
  ) {
    return 3
  }

  if (subscriptionType === 'enterprise' || subscriptionType === 'team') {
    return 3
  }

  return 1
}
// 默认档位分三层：Max 20x 与团队企业给 3 个并行 agent，其余给 1 个。数量直接对应并发 token 消耗，故与订阅档位绑定。

export function getPlanModeV2ExploreAgentCount(): number {
  if (process.env.CLAUDE_CODE_PLAN_V2_EXPLORE_AGENT_COUNT) {
    const count = parseInt(
      process.env.CLAUDE_CODE_PLAN_V2_EXPLORE_AGENT_COUNT,
      10,
    )
    if (!isNaN(count) && count > 0 && count <= 10) {
      return count
    }
  }

  return 3
}
// 探索阶段固定 3 个：它只读不写，成本可控，因此不按订阅档位分层。

/**
 * Check if plan mode interview phase is enabled.
 *
 * Config: ant=always_on, external=tengu_plan_mode_interview_phase gate, envVar=true
 */
export function isPlanModeInterviewPhaseEnabled(): boolean {
  // Always on for ants
  if (process.env.USER_TYPE === 'ant') return true

  const env = process.env.CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE
  if (isEnvTruthy(env)) return true
  if (isEnvDefinedFalsy(env)) return false

  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_plan_mode_interview_phase',
    false,
  )
}
// 访谈阶段三级判定：Ant 内部恒开；环境变量显式真假优先；都没设才看灰度开关，且允许读到可能过期的缓存值。

export type PewterLedgerVariant = 'trim' | 'cut' | 'cap' | null
// 变体只有四种取值，null 代表对照组：用字面量联合而不是枚举，是为了让灰度值能直接当字符串比对。

/**
 * tengu_pewter_ledger — plan file structure prompt experiment.
 *
 * Controls the Phase 4 "Final Plan" bullets in the 5-phase plan mode
 * workflow (messages.ts getPlanPhase4Section). 5-phase is 99% of plan
 * traffic; interview-phase (ants) is untouched as a reference population.
 *
 * Arms: null (control), 'trim', 'cut', 'cap' — progressively stricter
 * guidance on plan file size.
 *
 * Baseline (control, 14d ending 2026-03-02, N=26.3M):
 *   p50 4,906 chars | p90 11,617 | mean 6,207 | 82% Opus 4.6
 *   Reject rate monotonic with size: 20% at <2K → 50% at 20K+
 *
 * Primary: session-level Avg Cost (fact__201omjcij85f) — Opus output is
 *   5× input price so cost is an output-weighted proxy. planLengthChars
 *   on tengu_plan_exit is the mechanism but NOT the goal — the cap arm
 *   could shrink the plan file while increasing total output via
 *   write→count→edit cycles.
 * Guardrail: feedback-bad rate, requests/session (too-thin plans →
 *   more implementation iterations), tool error rate
 */
export function getPewterLedgerVariant(): PewterLedgerVariant {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<string | null>(
    'tengu_pewter_ledger',
    null,
  )
  if (raw === 'trim' || raw === 'cut' || raw === 'cap') return raw
  return null
}
// 未知取值一律归为对照组：灰度平台可能下发脏数据，这里做一次收口，避免上层因为拿到意料之外的分支而改变行为。
