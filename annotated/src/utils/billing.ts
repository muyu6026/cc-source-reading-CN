// 计费可见性的判定逻辑。两条并行路径：一条给用控制台账号与 API 密钥的用户，看组织与工作区角色；另一条给订阅制用户，看订阅档位与角色。两者都不做网络请求，只读本地已有的认证状态与全局配置。
import {
  getAnthropicApiKey,
  getAuthTokenSource,
  getSubscriptionType,
  isClaudeAISubscriber,
} from './auth.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'

export function hasConsoleBillingAccess(): boolean {
  // Check if cost reporting is disabled via environment variable
  if (isEnvTruthy(process.env.DISABLE_COST_WARNINGS)) {
    return false
  }

  const isSubscriber = isClaudeAISubscriber()

  // This might be wrong if user is signed into Max but also using an API key, but
  // we already show a warning on launch in that case
  if (isSubscriber) return false
// 订阅制用户走的是另一条路径，所以这里直接返回假。注释承认这个判断有边界情况——同时登录订阅并配置了 API 密钥的用户会被算作订阅者，但启动时已经另有一处警告提示过这种混用。

  // Check if user has any form of authentication
  const authSource = getAuthTokenSource()
  const hasApiKey = getAnthropicApiKey() !== null

  // If user has no authentication at all (logged out), don't show costs
  if (!authSource.hasToken && !hasApiKey) {
    return false
  }
// 完全没有认证信息（既没有令牌也没有密钥）时同样不给计费视图：此时拿不到组织信息，显示成本只会误导。

  const config = getGlobalConfig()
  const orgRole = config.oauthAccount?.organizationRole
  const workspaceRole = config.oauthAccount?.workspaceRole

  if (!orgRole || !workspaceRole) {
    return false // hide cost for grandfathered users who have not re-authed since we've added roles
  }

  // Users have billing access if they are admins or billing roles at either workspace or organization level
  return (
    ['admin', 'billing'].includes(orgRole) ||
    ['workspace_admin', 'workspace_billing'].includes(workspaceRole)
  )
}
// 真正的放行条件是两个角色取或：组织级的管理员或计费角色，工作区级的对应角色，满足其一即可。角色字段缺失时先返回假，注释解释这是照顾那些在引入角色字段之前就已登录、之后没重新认证过的老用户。

// Mock billing access for /mock-limits testing (set by mockRateLimits.ts)
let mockBillingAccessOverride: boolean | null = null

export function setMockBillingAccessOverride(value: boolean | null): void {
  mockBillingAccessOverride = value
}
// 测试用的强制开关：非空就短路真实判定。单独抽成函数而不是改环境变量，是为了让测试用例用完能精确置回空值，不影响后续用例。

export function hasClaudeAiBillingAccess(): boolean {
  // Check for mock billing access first (for /mock-limits testing)
  if (mockBillingAccessOverride !== null) {
    return mockBillingAccessOverride
  }

  if (!isClaudeAISubscriber()) {
    return false
  }

  const subscriptionType = getSubscriptionType()

  // Consumer plans (Max/Pro) - individual users always have billing access
  if (subscriptionType === 'max' || subscriptionType === 'pro') {
    return true
  }

  // Team/Enterprise - check for admin or billing roles
  const config = getGlobalConfig()
  const orgRole = config.oauthAccount?.organizationRole

  return (
    !!orgRole &&
    ['admin', 'billing', 'owner', 'primary_owner'].includes(orgRole)
  )
}
// 订阅路径先看测试开关，再看是否订阅者，然后按档位分流：个人档（Pro 与 Max）无条件可见；团队与企业档才回落到组织角色判断，且这里多认了所有者与主所有者两个角色——因为企业场景下这两类人同样有权看账单。
