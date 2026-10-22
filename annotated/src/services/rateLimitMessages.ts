/**
 * Centralized rate limit message generation
 * Single source of truth for all rate limit-related messages
 */
// 模块定位：**所有限流文案的唯一产地**（文件头自己写的 single source of truth）。三个消费方各自只取属于自己的一档：`errors.ts` 取「错误」（进对话流，红色）、UI footer 取「警告」（灰字）、overage 切换时取「临时通知」。这套拆分的价值在于——**同一件事只有一套措辞**，否则「达上限」这句话会在错误流、footer、通知三处长得不一样。

import {
  getOauthAccountInfo,
  getSubscriptionType,
  isOverageProvisioningAllowed,
} from '../utils/auth.js'
import { hasClaudeAiBillingAccess } from '../utils/billing.js'
import { formatResetTime } from '../utils/format.js'
import type { ClaudeAILimits } from './claudeAiLimits.js'

const FEEDBACK_CHANNEL_ANT = '#briarpatch-cc'

/**
 * All possible rate limit error message prefixes
 * Export this to avoid fragile string matching in UI components
 */
export const RATE_LIMIT_ERROR_PREFIXES = [
  "You've hit your",
  "You've used",
  "You're now using extra usage",
  "You're close to",
  "You're out of extra usage",
] as const
// 五个前缀导出给 UI 做识别用。有点讽刺的是：注释说「export this to avoid fragile string matching」，可这套机制本身就是字符串匹配——区别只在于**脆弱的字符串集中在一处**，UI 侧只引用常量。所以任何新增文案都必须记得同步这个数组，否则 UI 认不出（`isRateLimitErrorMessage` 就会漏判）。

/**
 * Check if a message is a rate limit error
 */
export function isRateLimitErrorMessage(text: string): boolean {
  return RATE_LIMIT_ERROR_PREFIXES.some(prefix => text.startsWith(prefix))
}
// 识别用 `startsWith` 而不是包含匹配：文案都以这几个短语**开头**，前缀匹配比 `includes` 更不容易被正文里引用的句子误伤。代价是以后文案改开头就得同步改数组。

export type RateLimitMessage = {
  message: string
  severity: 'error' | 'warning'
}

/**
 * Get the appropriate rate limit message based on limit state
 * Returns null if no message should be shown
 */
export function getRateLimitMessage(
  limits: ClaudeAILimits,
  model: string,
): RateLimitMessage | null {
// `getRateLimitMessage` 是整个模块的骨架，判定顺序不能调：**先判 overage，再判 rejected/warning**。原因很实在——订阅额度打满、但宽松额度（extra usage）可用时，`status` 依然是 `rejected`；如果不先看 `isUsingOverage`，就会对着一个还能继续用的人喊「你已达上限」。
  // Check overage scenarios first (when subscription is rejected but overage is available)
  // getUsingOverageText is rendered separately from warning.
  if (limits.isUsingOverage) {
    // Show warning if approaching overage spending limit
    if (limits.overageStatus === 'allowed_warning') {
      return {
        message: "You're close to your extra usage spending limit",
        severity: 'warning',
      }
    }
    return null
  }
// overage 分支里只留一条消息：接近消费限额的警告。**「正在使用额外额度」不在这里返回**，因为它由 `getUsingOverageText` 单独渲染（`getRateLimitMessage` 的注释明说 getUsingOverageText is rendered separately）——两者同时在屏幕上会变成两句意思重复的话。所以这里其余情况一律 `null`，包括已经打满消费额度的情况（那个交给 `overageStatus === 'rejected'` 走错误分支）。

  // ERROR STATES - when limits are rejected
  if (limits.status === 'rejected') {
    return { message: getLimitReachedText(limits, model), severity: 'error' }
  }

  // WARNING STATES - when approaching limits with early warning
  if (limits.status === 'allowed_warning') {
    // Only show warnings when utilization is above threshold (70%)
    // This prevents false warnings after week reset when API may send
    // allowed_warning with stale data at low usage levels
    const WARNING_THRESHOLD = 0.7
    if (
      limits.utilization !== undefined &&
      limits.utilization < WARNING_THRESHOLD
    ) {
      return null
    }
// `WARNING_THRESHOLD = 0.7` 背后的坑写在上面三行注释里：周限额重置之后，API 可能还带着**陈旧数据**发一个 `allowed_warning`，此时 utilization 很低——不加阈值就会出现「刚重置就警告你用了 0%」的假警报。所以「警告状态」还要再过一道利用率闸。

    // Don't warn non-billing Team/Enterprise users about approaching plan limits
    // if overages are enabled - they'll seamlessly roll into overage
    const subscriptionType = getSubscriptionType()
    const isTeamOrEnterprise =
      subscriptionType === 'team' || subscriptionType === 'enterprise'
    const hasExtraUsageEnabled =
      getOauthAccountInfo()?.hasExtraUsageEnabled === true

    if (
      isTeamOrEnterprise &&
      hasExtraUsageEnabled &&
      !hasClaudeAiBillingAccess()
    ) {
      return null
    }
// 这一段是**不发警告**的特例：Team/Enterprise + 开了 overage + 没有 Claude.ai 计费权限的用户，额度打满后会无缝滚进 overage，不会中断工作。对他们喊「快到限额了」纯属噪音。注意三个条件缺一不可——有计费权限的团队确实会被真的拦住，所以该警告。

    const text = getEarlyWarningText(limits)
    if (text) {
      return { message: text, severity: 'warning' }
    }
  }

  // No message needed
  return null
}

/**
 * Get error message for API errors (used in errors.ts)
 * Returns the message string or null if no error message should be shown
 */
export function getRateLimitErrorMessage(
  limits: ClaudeAILimits,
  model: string,
): string | null {
  const message = getRateLimitMessage(limits, model)

  // Only return error messages, not warnings
  if (message && message.severity === 'error') {
    return message.message
  }

  return null
}
// `getRateLimitErrorMessage` 只透出 `severity === 'error'` 那一档，警告一律吞掉。为什么拆成两个导出函数而不是让调用方自己筛 severity：**展示位置不同**——错误进 AssistantTextMessages（对话流里），警告进 footer。让每个调用方自己去判断，迟早有人把警告塞进错误通道里。

/**
 * Get warning message for UI footer
 * Returns the warning message string or null if no warning should be shown
 */
export function getRateLimitWarning(
  limits: ClaudeAILimits,
  model: string,
): string | null {
  const message = getRateLimitMessage(limits, model)

  // Only return warnings for the footer - errors are shown in AssistantTextMessages
  if (message && message.severity === 'warning') {
    return message.message
  }

  // Don't show errors in the footer
  return null
}
// 对称的另一半：footer 只取警告，错误不进来（上面注释写了 errors are shown in AssistantTextMessages）。两个函数都调同一个 `getRateLimitMessage`，等于「一处判定、两处消费」——判定逻辑永远只有一份。

function getLimitReachedText(limits: ClaudeAILimits, model: string): string {
  const resetsAt = limits.resetsAt
  const resetTime = resetsAt ? formatResetTime(resetsAt, true) : undefined
  const overageResetTime = limits.overageResetsAt
    ? formatResetTime(limits.overageResetsAt, true)
    : undefined
  const resetMessage = resetTime ? ` · resets ${resetTime}` : ''

  // if BOTH subscription (checked before this method) and overage are exhausted
  if (limits.overageStatus === 'rejected') {
    // Show the earliest reset time to indicate when user can resume
    let overageResetMessage = ''
    if (resetsAt && limits.overageResetsAt) {
      // Both timestamps present - use the earlier one
      if (resetsAt < limits.overageResetsAt) {
        overageResetMessage = ` · resets ${resetTime}`
      } else {
        overageResetMessage = ` · resets ${overageResetTime}`
      }
    } else if (resetTime) {
      overageResetMessage = ` · resets ${resetTime}`
    } else if (overageResetTime) {
      overageResetMessage = ` · resets ${overageResetTime}`
    }

    if (limits.overageDisabledReason === 'out_of_credits') {
      return `You're out of extra usage${overageResetMessage}`
    }

    return formatLimitReachedText('limit', overageResetMessage, model)
  }
// 两种额度都打满（订阅 + overage 都 `rejected`）时，文案要告诉用户**什么时候能继续用**，所以取两个重置时刻里**更早的那个**。这段 if/else 链看着啰嗦，实际在穷举「哪个时间戳有值」的三种组合——两都有取较早、只有订阅时间、只有 overage 时间。任何一处漏掉，用户看到的就是「已打满，但不告诉你什么时候恢复」。

  if (limits.rateLimitType === 'seven_day_sonnet') {
    const subscriptionType = getSubscriptionType()
    const isProOrEnterprise =
      subscriptionType === 'pro' || subscriptionType === 'enterprise'
    // For pro and enterprise, Sonnet limit is the same as weekly
    const limit = isProOrEnterprise ? 'weekly limit' : 'Sonnet limit'
    return formatLimitReachedText(limit, resetMessage, model)
  }
// `seven_day_sonnet` 这一支有个反直觉的产品规则：**对 pro / enterprise 用户，Sonnet 限额就是周限额**，所以文案统一说 weekly limit；只有别的订阅档才说 Sonnet limit。同一个 `rateLimitType` 在不同订阅下叫不同名字，这是文案层而非数据层的差异。

  if (limits.rateLimitType === 'seven_day_opus') {
    return formatLimitReachedText('Opus limit', resetMessage, model)
  }

  if (limits.rateLimitType === 'seven_day') {
    return formatLimitReachedText('weekly limit', resetMessage, model)
  }

  if (limits.rateLimitType === 'five_hour') {
    return formatLimitReachedText('session limit', resetMessage, model)
  }

  return formatLimitReachedText('usage limit', resetMessage, model)
}
// 五个 `rateLimitType` 分支 + 一个兜底 `usage limit`。兜底必须有——服务端将来新增一种限额类型时，旧客户端至少能说「你达上限了」，而不是什么都不显示。注意这里用了一串 `if` 而不是 `switch`（下面 `getEarlyWarningText` 用的是 `switch`，两边风格不统一，属于历史演进留下的痕迹）。

function getEarlyWarningText(limits: ClaudeAILimits): string | null {
  let limitName: string | null = null
  switch (limits.rateLimitType) {
    case 'seven_day':
      limitName = 'weekly limit'
      break
    case 'five_hour':
      limitName = 'session limit'
      break
    case 'seven_day_opus':
      limitName = 'Opus limit'
      break
    case 'seven_day_sonnet':
      limitName = 'Sonnet limit'
      break
    case 'overage':
      limitName = 'extra usage'
      break
    case undefined:
      return null
  }
// `case undefined: return null` 是这段 switch 里最该注意的一行：**没有限额类型就根本不猜**。警告文案必须说清「是哪一条限额」，说不清就不说，宁可沉默也不发一条「Approaching undefined」。

  // utilization and resetsAt should be defined since early warning is calculated with them
  const used = limits.utilization
    ? Math.floor(limits.utilization * 100)
    : undefined
  const resetTime = limits.resetsAt
    ? formatResetTime(limits.resetsAt, true)
    : undefined

  // Get upsell command based on subscription type and limit type
  const upsell = getWarningUpsellText(limits.rateLimitType)

  if (used && resetTime) {
    const base = `You've used ${used}% of your ${limitName} · resets ${resetTime}`
    return upsell ? `${base} · ${upsell}` : base
  }

  if (used) {
    const base = `You've used ${used}% of your ${limitName}`
    return upsell ? `${base} · ${upsell}` : base
  }

  if (limits.rateLimitType === 'overage') {
    // For the "Approaching <x>" verbiage, "extra usage limit" makes more sense than "extra usage"
    limitName += ' limit'
  }

  if (resetTime) {
    const base = `Approaching ${limitName} · resets ${resetTime}`
    return upsell ? `${base} · ${upsell}` : base
  }

  const base = `Approaching ${limitName}`
  return upsell ? `${base} · ${upsell}` : base
// 拼句有四级降级，信息缺哪块就少说哪块、绝不编造：① 有百分比 + 有重置时间 → 最完整；② 只有百分比 → 省略 resets；③ 都没有 → 退成 `Approaching <限额名>`；④ overage 这个类型额外把名字改成「extra usage limit」（因为 `Approaching extra usage` 读起来不通）。upsell 后缀统一用 ` · ` 连接。
}

/**
 * Get the upsell command text for warning messages based on subscription and limit type.
 * Returns null if no upsell should be shown.
 * Only used for warnings because actual rate limit hits will see an interactive menu of options.
 */
function getWarningUpsellText(
  rateLimitType: ClaudeAILimits['rateLimitType'],
): string | null {
  const subscriptionType = getSubscriptionType()
  const hasExtraUsageEnabled =
    getOauthAccountInfo()?.hasExtraUsageEnabled === true

  // 5-hour session limit warning
  if (rateLimitType === 'five_hour') {
    // Teams/Enterprise with overages disabled: prompt to request extra usage
    // Only show if overage provisioning is allowed for this org type (e.g., not AWS marketplace)
    if (subscriptionType === 'team' || subscriptionType === 'enterprise') {
      if (!hasExtraUsageEnabled && isOverageProvisioningAllowed()) {
        return '/extra-usage to request more'
      }
      // Teams/Enterprise with overages enabled or unsupported billing type don't need upsell
      return null
    }

    // Pro/Max users: prompt to upgrade
    if (subscriptionType === 'pro' || subscriptionType === 'max') {
      return '/upgrade to keep using Claude Code'
    }
  }

  // Overage warning (approaching spending limit)
  if (rateLimitType === 'overage') {
    if (subscriptionType === 'team' || subscriptionType === 'enterprise') {
      if (!hasExtraUsageEnabled && isOverageProvisioningAllowed()) {
        return '/extra-usage to request more'
      }
    }
  }

  // Weekly limit warnings don't show upsell per spec
  return null
}
// upsell 只在**警告**里出现，理由见函数头注释：真正打满时会看到一整套交互式选项菜单，不需要再在文字里劝。三条规则也很克制：Team/Enterprise 且没开 overage 才提示「去申请更多」（`isOverageProvisioningAllowed()` 还挡掉了 AWS marketplace 这类不支持开通的计费方式）；pro/max 提示升级；**周限额按产品规格一律不给 upsell**。

/**
 * Get notification text for overage mode transitions
 * Used for transient notifications when entering overage mode
 */
export function getUsingOverageText(limits: ClaudeAILimits): string {
  const resetTime = limits.resetsAt
    ? formatResetTime(limits.resetsAt, true)
    : ''

  let limitName = ''
  if (limits.rateLimitType === 'five_hour') {
    limitName = 'session limit'
  } else if (limits.rateLimitType === 'seven_day') {
    limitName = 'weekly limit'
  } else if (limits.rateLimitType === 'seven_day_opus') {
    limitName = 'Opus limit'
  } else if (limits.rateLimitType === 'seven_day_sonnet') {
    const subscriptionType = getSubscriptionType()
    const isProOrEnterprise =
      subscriptionType === 'pro' || subscriptionType === 'enterprise'
    // For pro and enterprise, Sonnet limit is the same as weekly
    limitName = isProOrEnterprise ? 'weekly limit' : 'Sonnet limit'
  }

  if (!limitName) {
    return 'Now using extra usage'
  }

  const resetMessage = resetTime
    ? ` · Your ${limitName} resets ${resetTime}`
    : ''
  return `You're now using extra usage${resetMessage}`
}
// `getUsingOverageText` 单独存在，是因为它描述的是一个**状态切换事件**（「你现在开始用额外额度了」），生命周期与「警告/错误」不同——它只闪现一次，随后 overage 内的用量由 footer 的百分比表达。文案也刻意不同：`You're now using extra usage` 而不是 `Approaching ...`。Sonnet 那一支又做了一次 pro/enterprise 合并（同 `getLimitReachedText`）。

function formatLimitReachedText(
  limit: string,
  resetMessage: string,
  _model: string,
): string {
  // Enhanced messaging for Ant users
  if (process.env.USER_TYPE === 'ant') {
    return `You've hit your ${limit}${resetMessage}. If you have feedback about this limit, post in ${FEEDBACK_CHANNEL_ANT}. You can reset your limits with /reset-limits`
  }

  return `You've hit your ${limit}${resetMessage}`
}
// 最后一行暴露了两件事。① **ant 内部构建多一句**：给一个内部反馈频道 + `/reset-limits` 自助重置入口，开源构建没有这两个东西，所以文案必须分叉。② `_model` 参数前面带下划线、函数体里根本没用——它曾经用来按模型定制文案，现在退化成统一文案；参数保留是为了**调用点签名不变**，五个调用方不用改。
