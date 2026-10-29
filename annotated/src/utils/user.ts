// 文件总述：用户核心数据聚合层。同步获取设备、会话、平台等基础信息，异步预取邮箱；为不同分析 provider 与 GrowthBook 提供统一的数据基底。
import { execa } from 'execa'
import memoize from 'lodash-es/memoize.js'
import { getSessionId } from '../bootstrap/state.js'
import {
  getOauthAccountInfo,
  getRateLimitTier,
  getSubscriptionType,
} from './auth.js'
import { getGlobalConfig, getOrCreateUserID } from './config.js'
import { getCwd } from './cwd.js'
import { type env, getHostPlatformForAnalytics } from './env.js'
import { isEnvTruthy } from './envUtils.js'

// Cache for email fetched asynchronously at startup
let cachedEmail: string | undefined | null = null // null means not fetched yet
let emailFetchPromise: Promise<string | undefined> | null = null

// 两个邮箱缓存变量：cachedEmail（null 表示尚未获取）与 emailFetchPromise（防止并发重复获取）。
/**
 * GitHub Actions metadata when running in CI
 */
export type GitHubActionsMetadata = {
  actor?: string
  actorId?: string
  repository?: string
  repositoryId?: string
  repositoryOwner?: string
  repositoryOwnerId?: string
}
// GitHubActionsMetadata 类型：CI 环境下透传的 GitHub Actions 元数据。

/**
 * Core user data used as base for all analytics providers.
 * This is also the format used by GrowthBook.
 */
export type CoreUserData = {
  deviceId: string
  sessionId: string
  email?: string
  appVersion: string
  platform: typeof env.platform
  organizationUuid?: string
  accountUuid?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  githubActionsMetadata?: GitHubActionsMetadata
}
// CoreUserData 类型：所有分析 provider 共用的核心用户数据结构，也是 GrowthBook 的格式。

/**
 * Initialize user data asynchronously. Should be called early in startup.
 * This pre-fetches the email so getUser() can remain synchronous.
 */
export async function initUser(): Promise<void> {
  if (cachedEmail === null && !emailFetchPromise) {
    emailFetchPromise = getEmailAsync()
    cachedEmail = await emailFetchPromise
    emailFetchPromise = null
    // Clear memoization cache so next call picks up the email
    getCoreUserData.cache.clear?.()
  }
}
// initUser：启动早期异步预取邮箱，取完清 memoize 缓存以便下次拿到邮箱。

/**
 * Reset all user data caches. Call on auth changes (login/logout/account switch)
 * so the next getCoreUserData() call picks up fresh credentials and email.
 */
export function resetUserCache(): void {
  cachedEmail = null
  emailFetchPromise = null
  getCoreUserData.cache.clear?.()
  getGitEmail.cache.clear?.()
}
// resetUserCache：登录、登出、切换账号时清掉全部用户缓存。

/**
 * Get core user data.
 * This is the base representation that gets transformed for different analytics providers.
 */
export const getCoreUserData = memoize(
  (includeAnalyticsMetadata?: boolean): CoreUserData => {
    const deviceId = getOrCreateUserID()
    const config = getGlobalConfig()

    let subscriptionType: string | undefined
    let rateLimitTier: string | undefined
    let firstTokenTime: number | undefined
    if (includeAnalyticsMetadata) {
      subscriptionType = getSubscriptionType() ?? undefined
      rateLimitTier = getRateLimitTier() ?? undefined
      if (subscriptionType && config.claudeCodeFirstTokenDate) {
        const configFirstTokenTime = new Date(
          config.claudeCodeFirstTokenDate,
        ).getTime()
        if (!isNaN(configFirstTokenTime)) {
          firstTokenTime = configFirstTokenTime
        }
      }
    }

    // Only include OAuth account data when actively using OAuth authentication
    const oauthAccount = getOauthAccountInfo()
// 只在主动使用 OAuth 鉴权时才带上 OAuth 账户信息（组织与账户 uuid）。
    const organizationUuid = oauthAccount?.organizationUuid
    const accountUuid = oauthAccount?.accountUuid

    return {
      deviceId,
      sessionId: getSessionId(),
      email: getEmail(),
      appVersion: MACRO.VERSION,
      platform: getHostPlatformForAnalytics(),
      organizationUuid,
      accountUuid,
      userType: process.env.USER_TYPE,
      subscriptionType,
      rateLimitTier,
      firstTokenTime,
      ...(isEnvTruthy(process.env.GITHUB_ACTIONS) && {
        githubActionsMetadata: {
          actor: process.env.GITHUB_ACTOR,
          actorId: process.env.GITHUB_ACTOR_ID,
          repository: process.env.GITHUB_REPOSITORY,
          repositoryId: process.env.GITHUB_REPOSITORY_ID,
          repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER,
          repositoryOwnerId: process.env.GITHUB_REPOSITORY_OWNER_ID,
        },
      }),
    }
  },
)
// getCoreUserData：用 memoize 包裹的核心数据构造，可选附带订阅类型、速率档位、首 token 时间以及 CI 元数据。

/**
 * Get user data for GrowthBook (same as core data with analytics metadata).
 */
export function getUserForGrowthBook(): CoreUserData {
  return getCoreUserData(true)
}
// getUserForGrowthBook：等价于带分析元数据的核心数据。

function getEmail(): string | undefined {
  // Return cached email if available (from async initialization)
  if (cachedEmail !== null) {
    return cachedEmail
  }

  // Only include OAuth email when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount?.emailAddress) {
    return oauthAccount.emailAddress
  }

  // Ant-only fallbacks below (no execSync)
  if (process.env.USER_TYPE !== 'ant') {
    return undefined
  }

  if (process.env.COO_CREATOR) {
    return `${process.env.COO_CREATOR}@anthropic.com`
  }

  // If initUser() wasn't called, we return undefined instead of blocking
  return undefined
}
// getEmail：同步取邮箱——缓存优先，其次 OAuth 邮箱，ant 用户有 COO_CREATOR 兜底，否则返回 undefined。

async function getEmailAsync(): Promise<string | undefined> {
  // Only include OAuth email when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount?.emailAddress) {
    return oauthAccount.emailAddress
  }

  // Ant-only fallbacks below
  if (process.env.USER_TYPE !== 'ant') {
    return undefined
  }

  if (process.env.COO_CREATOR) {
    return `${process.env.COO_CREATOR}@anthropic.com`
  }

  return getGitEmail()
}
// getEmailAsync：异步取邮箱，CI 环境下回退到 git config user.email。

/**
 * Get the user's git email from `git config user.email`.
 * Memoized so the subprocess only spawns once per process.
 */
export const getGitEmail = memoize(async (): Promise<string | undefined> => {
  const result = await execa('git config --get user.email', {
    shell: true,
    reject: false,
    cwd: getCwd(),
  })
  return result.exitCode === 0 && result.stdout
    ? result.stdout.trim()
    : undefined
})
// getGitEmail：用 memoize 封装的 git user.email 子进程调用，整个进程只启动一次。
