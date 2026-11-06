import {
  checkAdminRequestEligibility,
  createAdminRequest,
  getMyAdminRequests,
} from '../../services/api/adminRequests.js'
import { invalidateOverageCreditGrantCache } from '../../services/api/overageCreditGrant.js'
import { type ExtraUsage, fetchUtilization } from '../../services/api/usage.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { hasClaudeAiBillingAccess } from '../../utils/billing.js'
import { openBrowser } from '../../utils/browser.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logError } from '../../utils/log.js'

// 命令的两种返回：纯文案消息，或已打开浏览器带 URL 与是否成功
type ExtraUsageResult =
  | { type: 'message'; value: string }
  | { type: 'browser-opened'; url: string; opened: boolean }

// /extra-usage 主流程：先置已访问标记、清本组织缓存，再按订阅类型分流
export async function runExtraUsage(): Promise<ExtraUsageResult> {
  if (!getGlobalConfig().hasVisitedExtraUsage) {
    saveGlobalConfig(prev => ({ ...prev, hasVisitedExtraUsage: true }))
  }
// 只清当前组织的超额额度缓存：与已访问标记独立，因为用户可能反复跑
  // Invalidate only the current org's entry so a follow-up read refetches
  // the granted state. Separate from the visited flag since users may run
  // /extra-usage more than once while iterating on the claim flow.
  invalidateOverageCreditGrantCache()

// 订阅类型决定走哪条路：团队 / 企业走审批流，个人直接开浏览器
  const subscriptionType = getSubscriptionType()
  const isTeamOrEnterprise =
    subscriptionType === 'team' || subscriptionType === 'enterprise'
  const hasBillingAccess = hasClaudeAiBillingAccess()

// 团队 / 企业且无自助计费权限：走管理员审批流程，而不是自己开网页
  if (!hasBillingAccess && isTeamOrEnterprise) {
    // Mirror apps/claude-ai useHasUnlimitedOverage(): if overage is enabled
    // with no monthly cap, there is nothing to request. On fetch error, fall
    // through and let the user ask (matching web's "err toward show" behavior).
    let extraUsage: ExtraUsage | null | undefined
    try {
      const utilization = await fetchUtilization()
      extraUsage = utilization?.extra_usage
    } catch (error) {
      logError(error as Error)
    }

// 已经无限额：直接告诉用户无需申请，省掉后续请求
    if (extraUsage?.is_enabled && extraUsage.monthly_limit === null) {
      return {
        type: 'message',
        value:
          'Your organization already has unlimited extra usage. No request needed.',
      }
    }

// 查资格：明确不允许才提示联系管理员；查失败则继续往下走
    try {
      const eligibility = await checkAdminRequestEligibility('limit_increase')
      if (eligibility?.is_allowed === false) {
        return {
          type: 'message',
          value: 'Please contact your admin to manage extra usage settings.',
        }
      }
    } catch (error) {
      logError(error as Error)
      // If eligibility check fails, continue — the create endpoint will enforce if necessary
    }

// 已有待处理 / 已忽略的请求：避免重复提交，直接告知
    try {
      const pendingOrDismissedRequests = await getMyAdminRequests(
        'limit_increase',
        ['pending', 'dismissed'],
      )
      if (pendingOrDismissedRequests && pendingOrDismissedRequests.length > 0) {
        return {
          type: 'message',
          value:
            'You have already submitted a request for extra usage to your admin.',
        }
      }
    } catch (error) {
      logError(error as Error)
      // Fall through to creating a new request below
    }

// 前面都放过才真正发审批请求；失败也不抛错，落到通用提示
    try {
      await createAdminRequest({
        request_type: 'limit_increase',
        details: null,
      })
      return {
        type: 'message',
        value: extraUsage?.is_enabled
          ? 'Request sent to your admin to increase extra usage.'
          : 'Request sent to your admin to enable extra usage.',
      }
    } catch (error) {
      logError(error as Error)
      // Fall through to generic message below
    }

    return {
      type: 'message',
      value: 'Please contact your admin to manage extra usage settings.',
    }
  }

// 个人或非团队：按类型拼 claude.ai 的 usage 设置页 URL
  const url = isTeamOrEnterprise
    ? 'https://claude.ai/admin-settings/usage'
    : 'https://claude.ai/settings/usage'

// 最后兜底：直接开浏览器到对应页；开失败给带 URL 的文案提示
  try {
    const opened = await openBrowser(url)
    return { type: 'browser-opened', url, opened }
  } catch (error) {
    logError(error as Error)
    return {
      type: 'message',
      value: `Failed to open browser. Please visit ${url} to manage extra usage.`,
    }
  }
}
