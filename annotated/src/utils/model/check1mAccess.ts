// 一百万上下文窗口的访问资格判定：区分订阅用户（看额外用量是否启用）与非订阅用户（API/按量直接放行），并对 Opus 与 Sonnet 各提供一个入口。
import type { OverageDisabledReason } from 'src/services/claudeAiLimits.js'
import { isClaudeAISubscriber } from '../auth.js'
import { getGlobalConfig } from '../config.js'
import { is1mContextDisabled } from '../context.js'

/**
 * Check if extra usage is enabled based on the cached disabled reason.
 * Extra usage is considered enabled if there's no disabled reason,
 * or if the disabled reason indicates it's provisioned but temporarily unavailable.
 */
// `isExtraUsageEnabled` 依据缓存的禁用原因判断额外用量是否可用：未缓存时保守判否，空原因判可用，其余按原因分流——仅「已配给但额度耗尽」仍算可用。
function isExtraUsageEnabled(): boolean {
  const reason = getGlobalConfig().cachedExtraUsageDisabledReason
  // undefined = no cache yet, treat as not enabled (conservative)
  if (reason === undefined) {
    return false
  }
  // null = no disabled reason from API, extra usage is enabled
  if (reason === null) {
    return true
  }
  // Check which disabled reasons still mean "provisioned"
  switch (reason as OverageDisabledReason) {
    // Provisioned but credits depleted — still counts as enabled
    case 'out_of_credits':
      return true
    // Not provisioned or actively disabled
    case 'overage_not_provisioned':
    case 'org_level_disabled':
    case 'org_level_disabled_until':
    case 'seat_tier_level_disabled':
    case 'member_level_disabled':
    case 'seat_tier_zero_credit_limit':
    case 'group_zero_credit_limit':
    case 'member_zero_credit_limit':
    case 'org_service_level_disabled':
    case 'org_service_zero_credit_limit':
    case 'no_limits_configured':
    case 'unknown':
      return false
    default:
      return false
  }
}
// 函数末尾统一返回：除「已配给但额度耗尽」外，其余禁用原因一律判否，保证未列出的新原因也落到保守分支。

// @[MODEL LAUNCH]: Add check if the new model supports 1M context
// `checkOpus1mAccess` 先查全局禁用开关，再按订阅与否分流；非订阅用户（API/按量）无条件有权。
export function checkOpus1mAccess(): boolean {
  if (is1mContextDisabled()) {
    return false
  }

  if (isClaudeAISubscriber()) {
    // Subscribers have access if extra usage is enabled for their account
    return isExtraUsageEnabled()
  }

  // Non-subscribers (API/PAYG) have access
  return true
}

// `checkSonnet1mAccess` 逻辑与 Opus 入口完全一致，只是面向 Sonnet 模型；两者共用同一套资格规则。
export function checkSonnet1mAccess(): boolean {
  if (is1mContextDisabled()) {
    return false
  }

  if (isClaudeAISubscriber()) {
    // Subscribers have access if extra usage is enabled for their account
    return isExtraUsageEnabled()
  }

  // Non-subscribers (API/PAYG) have access
  return true
}
