// ═══════════════════════════════════════════════════════════════
//  referral：邀请好友的「通行证」资格
// ═══════════════════════════════════════════════════════════════
//
//  281 行，真正的逻辑只有一条：**永远不阻塞等网络**。
//
//  它比 metricsOptOut 更进一步 —— 连「磁盘缓存都没有」的冷启动场景，
//  也是「立刻返回 null + 后台去取」。代价是首次使用那天功能不可用，
//  收益是启动路径上一行网络代码都没有。
//
//  这个文件也是**单飞（single-flight）**最干净的样本，见第 24 行。
import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getOauthAccountInfo,
  getSubscriptionType,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getOAuthHeaders, prepareApiRequest } from '../../utils/teleport/api.js'
import type {
  ReferralCampaign,
  ReferralEligibilityResponse,
  ReferralRedemptionsResponse,
  ReferrerRewardInfo,
} from '../oauth/types.js'

// 【24 小时的依据写在一行注释里】
//
//  原注释：eligibility changes only on subscription/experiment changes.
//
//  「只有订阅变化或实验分组变化才会改」—— 这两个事件的频率都是「天」级，
//  所以 24 小时是安全的。**TTL 不该拍脑袋定，应该由「数据变化的频率」反推。**
//
//  对照上一批读过的 metricsOptOut：那边 TTL 也是 24h，因为「组织设置很少变」。
//  同类推理，说明这不是巧合而是习惯。
// Cache expiration time: 24 hours (eligibility changes only on subscription/experiment changes)
const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000

// Track in-flight fetch to prevent duplicate API calls
// 【单飞：一个模块级变量，存的是 Promise 不是数据】
//
//      let fetchInProgress: Promise<X | null> | null = null
//
//  为什么存 Promise 而不是存结果？因为要解决的是**并发**问题：
//
//      T0  调用 A 进来，没有在途请求 → 发请求，把 promise 存进变量
//      T1  调用 B 进来，发现在途 → 直接 await 同一个 promise
//      T2  请求完成 → 两者拿到同一个结果，变量清空
//
//  如果改存结果（缓存值），那 A 和 B 会**各自发一次请求**，覆盖率更差。
//
//  这也是它和「带 TTL 的 memoize」的区别：memoize 解决「一段时间内不重复」，
//  单飞解决「同一时刻不重复」。两者经常一起用，但概念不同。
//
//  注意实现细节（第 214 行）：清空必须放在 finally 里，否则请求失败后
//  变量会一直挂着一个失败的 promise，之后所有调用都直接拿到那个失败。
let fetchInProgress: Promise<ReferralEligibilityResponse | null> | null = null

export async function fetchReferralEligibility(
  campaign: ReferralCampaign = 'claude_code_guest_pass',
): Promise<ReferralEligibilityResponse> {
  const { accessToken, orgUUID } = await prepareApiRequest()

  const headers = {
    ...getOAuthHeaders(accessToken),
    'x-organization-uuid': orgUUID,
  }

  const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/referral/eligibility`

  const response = await axios.get(url, {
    headers,
    params: { campaign },
    timeout: 5000, // 5 second timeout for background fetch
  })

  return response.data
}

export async function fetchReferralRedemptions(
  campaign: string = 'claude_code_guest_pass',
): Promise<ReferralRedemptionsResponse> {
  const { accessToken, orgUUID } = await prepareApiRequest()

  const headers = {
    ...getOAuthHeaders(accessToken),
    'x-organization-uuid': orgUUID,
  }

  const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/referral/redemptions`

  const response = await axios.get<ReferralRedemptionsResponse>(url, {
    headers,
    params: { campaign },
    timeout: 10000, // 10 second timeout
  })

  return response.data
}

/**
 * Prechecks for if user can access guest passes feature
 */
// 【资格预判：三个条件用 && 串起来，包在一个 !!() 里】
//
//      !!(
//        getOauthAccountInfo()?.organizationUuid &&
//        isClaudeAISubscriber() &&
//        getSubscriptionType() === 'max'
//      )
//
//  外层的 `!!` 是为了把 `string | boolean | undefined` 收成 boolean ——
//  因为 `a && b` 在 a 为假时返回的是 a 本身（可能是空字符串），不是 false。
//  这个函数的返回类型写的是 boolean，所以必须收一次。
//
//  这是 TS 里最容易被忽略的一类小问题：**逻辑与的返回值类型不是 boolean，
//  是「第一个假值」或「最后一个真值」。**
function shouldCheckForPasses(): boolean {
  return !!(
    getOauthAccountInfo()?.organizationUuid &&
    isClaudeAISubscriber() &&
    getSubscriptionType() === 'max'
  )
}

/**
 * Check cached passes eligibility from GlobalConfig
 * Returns current cached state and cache status
 */
// 【返回三个字段：资格、要不要刷新、有没有缓存】
//
//  为什么不是一个布尔？因为调用方要区分三种情况：
//
//      hasCache=false            → 还不知道，UI 什么都不显示
//      hasCache=true, eligible   → 显示入口
//      hasCache=true, !eligible  → 不显示
//      任一情况下 needsRefresh   → 该去后台刷一次了
//
//  这就是「把决策所需的信息一次性给全」的写法：**让调用方做决定，
//  而不是在函数内部替调用方决定。** 如果只返回一个布尔，
//  每个调用点都要自己重新推断「该不该刷新」，逻辑会散开。
export function checkCachedPassesEligibility(): {
  eligible: boolean
  needsRefresh: boolean
  hasCache: boolean
} {
  if (!shouldCheckForPasses()) {
    return {
      eligible: false,
      needsRefresh: false,
      hasCache: false,
    }
  }

  const orgId = getOauthAccountInfo()?.organizationUuid
  if (!orgId) {
    return {
      eligible: false,
      needsRefresh: false,
      hasCache: false,
    }
  }

  const config = getGlobalConfig()
  const cachedEntry = config.passesEligibilityCache?.[orgId]

  if (!cachedEntry) {
    // No cached entry, needs fetch
    return {
      eligible: false,
      needsRefresh: true,
      hasCache: false,
    }
  }

  const { eligible, timestamp } = cachedEntry
  const now = Date.now()
  const needsRefresh = now - timestamp > CACHE_EXPIRATION_MS

  return {
    eligible,
    needsRefresh,
    hasCache: true,
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  BRL: 'R$',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
}

export function formatCreditAmount(reward: ReferrerRewardInfo): string {
  const symbol = CURRENCY_SYMBOLS[reward.currency] ?? `${reward.currency} `
  const amount = reward.amount_minor_units / 100
  const formatted = amount % 1 === 0 ? amount.toString() : amount.toFixed(2)
  return `${symbol}${formatted}`
}

/**
 * Get cached referrer reward info from eligibility cache
 * Returns the reward info if the user is in a v1 campaign, null otherwise
 */
export function getCachedReferrerReward(): ReferrerRewardInfo | null {
  const orgId = getOauthAccountInfo()?.organizationUuid
  if (!orgId) return null
  const config = getGlobalConfig()
  const cachedEntry = config.passesEligibilityCache?.[orgId]
  return cachedEntry?.referrer_reward ?? null
}

/**
 * Get the cached remaining passes count from eligibility cache
 * Returns the number of remaining passes, or null if not available
 */
export function getCachedRemainingPasses(): number | null {
  const orgId = getOauthAccountInfo()?.organizationUuid
  if (!orgId) return null
  const config = getGlobalConfig()
  const cachedEntry = config.passesEligibilityCache?.[orgId]
  return cachedEntry?.remaining_passes ?? null
}

/**
 * Fetch passes eligibility and store in GlobalConfig
 * Returns the fetched response or null on error
 */
// 【这个函数的形状就是单飞本身】
//
//  三段的顺序不能换：
//
//      1. 有在途请求 → 直接返回它（不能先做参数检查）
//      2. 没有 orgId   → 返回 null（不发起、也不缓存）
//      3. 建 promise   → 存进变量，finally 里清空
//
//  为什么第 1 步必须在最前面？因为如果把它放在 orgId 检查之后，
//  虽然结果一样，但会多读一次配置 —— 而更重要的是语义：
//  「在途请求」优先于「我自己的判断」，否则两个并发调用可能一个走进
//  「有 orgId」的分支、一个走进「没 orgId」的分支，行为就不一致了。
export async function fetchAndStorePassesEligibility(): Promise<ReferralEligibilityResponse | null> {
  // Return existing promise if fetch is already in progress
  if (fetchInProgress) {
    logForDebugging('Passes: Reusing in-flight eligibility fetch')
    return fetchInProgress
  }

  const orgId = getOauthAccountInfo()?.organizationUuid

  if (!orgId) {
    return null
  }

  // Store the promise to share with concurrent calls
// 【IIFE（立即执行函数）赋值给变量 —— 这里的写法值得学】
//
//      fetchInProgress = (async () => { try {...} finally {...} })()
//
//  先建好 promise、赋给变量，再 return 它。这样即使在 try 内部同步抛错，
//  变量也已经拿到了一个（已 reject 的）promise，不会出现「变量是 null
//  但请求已经发出」的窗口。
//
//  如果写成「先 await 再赋值」，中间那段 await 期间变量还是 null，
//  并发的第二个调用会以为没有在途请求，于是再发一次。
//
//  **单飞的正确实现是「先登记，再执行」，不是「执行完再登记」。**
  fetchInProgress = (async () => {
    try {
      const response = await fetchReferralEligibility()

      const cacheEntry = {
        ...response,
        timestamp: Date.now(),
      }

      saveGlobalConfig(current => ({
        ...current,
        passesEligibilityCache: {
          ...current.passesEligibilityCache,
          [orgId]: cacheEntry,
        },
      }))

      logForDebugging(
        `Passes eligibility cached for org ${orgId}: ${response.eligible}`,
      )

      return response
    } catch (error) {
      logForDebugging('Failed to fetch and cache passes eligibility')
      logError(error as Error)
      return null
    } finally {
      // Clear the promise when done
      fetchInProgress = null
    }
  })()

  return fetchInProgress
}

/**
 * Get cached passes eligibility data or fetch if needed
 * Main entry point for all eligibility checks
 *
 * This function never blocks on network - it returns cached data immediately
 * and fetches in the background if needed. On cold start (no cache), it returns
 * null and the passes command won't be available until the next session.
 */
// 【主入口：三条路径，注释都写清楚了；重点是「都不同步等网络」】
//
//      无缓存      →  后台取，返回 null（这一整个会话里功能不可用）
//      缓存过期    →  返回旧值 + 后台刷新
//      缓存新鲜    →  直接返回
//
//  注释（第 227 行）把这叫做 This function never blocks on network。
//
//  为什么愿意付「冷启动这天功能不可用」的代价？因为这是一个**增值功能**，
//  不是核心路径。如果在启动时同步等它，用户每次都要多等一次网络往返，
//  而绝大多数会话根本不会用到邀请功能。
//
//  判据可以写成一句：**冷启动时功能缺失 vs 每次启动都变慢，选前者。**
//  但反过来，如果是核心功能（比如认证、模型列表），就绝不能这么做。
export async function getCachedOrFetchPassesEligibility(): Promise<ReferralEligibilityResponse | null> {
  if (!shouldCheckForPasses()) {
    return null
  }

  const orgId = getOauthAccountInfo()?.organizationUuid
  if (!orgId) {
    return null
  }

  const config = getGlobalConfig()
  const cachedEntry = config.passesEligibilityCache?.[orgId]
  const now = Date.now()

  // No cache - trigger background fetch and return null (non-blocking)
  // The passes command won't be available this session, but will be next time
  if (!cachedEntry) {
    logForDebugging(
      'Passes: No cache, fetching eligibility in background (command unavailable this session)',
    )
//     // 【这里是 void 而不是 await —— 而且是故意的】
//     //
//     //   `void fetchAndStorePassesEligibility()` 的语义是「我知道这是个 promise，
//     //  我故意不等它」。加 void 主要是为了告诉 lint 和读代码的人：
//     //  这不是忘记 await。
//     //
//     //  注意它连 .catch 都没加。这在这里是可以的，因为
//     //  fetchAndStorePassesEligibility 内部自己 try/catch 了（第 210 行），
//     //  不会 reject。**「fire-and-forget 能不能省 catch」取决于被调函数
//     //  是否保证不 reject**，不是看心情。
    void fetchAndStorePassesEligibility()
    return null
  }

  // Cache exists but is stale - return stale cache and trigger background refresh
  if (now - cachedEntry.timestamp > CACHE_EXPIRATION_MS) {
    logForDebugging(
      'Passes: Cache stale, returning cached data and refreshing in background',
    )
    void fetchAndStorePassesEligibility() // Background refresh
//     // 【把缓存条目里的 timestamp 摘掉再返回 —— 一个类型上的小把戏】
//     //
//     //      const { timestamp, ...response } = cachedEntry
//     //      return response as ReferralEligibilityResponse
//     //
//     //  cachedEntry 是「服务端响应 + timestamp」，而对外类型是「服务端响应」。
//     //  所以要先剥掉本地加的字段。
//     //
//     //  注意这里用了 `as` 断言。严格说 `...rest` 出来的类型本来就应该匹配，
//     //  用 as 可能是因为 cachedEntry 的类型声明是交叉类型，rest 之后
//     //  TS 无法自动收窄。这类 as 在「剥本地字段」场景里是可以接受的 ——
//     //  **它没有改变运行时行为，只是帮编译器把已知的相等关系说出来。**
    const { timestamp, ...response } = cachedEntry
    return response as ReferralEligibilityResponse
  }

  // Cache is fresh - return it immediately
  logForDebugging('Passes: Using fresh cached eligibility data')
  const { timestamp, ...response } = cachedEntry
  return response as ReferralEligibilityResponse
}

/**
 * Prefetch passes eligibility on startup
 */
export async function prefetchPassesEligibility(): Promise<void> {
  // Skip network requests if nonessential traffic is disabled
  if (isEssentialTrafficOnly()) {
    return
  }

  void getCachedOrFetchPassesEligibility()
}
