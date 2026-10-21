// ═══════════════════════════════════════════════════════════════
//  ultrareviewQuota：一个「只读、失败就返回 null」的配额查询
// ═══════════════════════════════════════════════════════════════
//
//  这是 api/ 目录里最简单的一类文件：一个 GET，四个字段，失败返回 null。
//  38 行。挑出来讲它，是因为它把「查询型接口」的三个约定都摆在了明面上，
//  后面几十个同类文件都是这个形状的变体。
import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { getOAuthHeaders, prepareApiRequest } from '../../utils/teleport/api.js'

export type UltrareviewQuotaResponse = {
  reviews_used: number
  reviews_limit: number
  reviews_remaining: number
  is_overage: boolean
}

// 【注释里有两句话值得逐字读】
//
//  第一句：Peek the ultrareview quota for display and nudge decisions.
//
//    peek 这个词是关键词 —— 看一眼，不改状态。
//  第二句：Consume happens server-side at session creation.
//
//    真正扣次数发生在服务端「创建会话」那一刻，不是在查询时。
//
//  这两句合起来说明一个设计：**查询和消费分离，而且消费不在客户端**。
//  客户端永远不可能因为一次失败的重试而多扣一次配额 —— 它根本没有
//  扣减的权限。这是把「可能出错的操作」全部推到服务端的好处。
/**
 * Peek the ultrareview quota for display and nudge decisions. Consume
 * happens server-side at session creation. Null when not a subscriber or
 * the endpoint errors.
 */
// 【返回类型是 X | null，不是 X | undefined，也不是抛异常】
//
//  三者的区别在调用点：
//
//      抛异常     → 每个调用点都要 try/catch，漏一个就崩
//      undefined → 调用点写 `?.` 或 `??`，容易把「没有」和「有但为空」混了
//      null      → 调用点必须显式判断，TypeScript 会强迫你处理
//
//  注释最后一句给了调用约定：Null when not a subscriber or the endpoint errors.
//  也就是「非订阅者」和「网络失败」被合并成了同一个返回值 —— 因为对展示层
//  来说这两种情况的处理是一样的：什么都不显示。
export async function fetchUltrareviewQuota(): Promise<UltrareviewQuotaResponse | null> {
//   // 【第一道门：不是订阅者就不发请求】
//   //
//   //  注意这里返回的是 null 而不是 {}。因为调用方要判断的是「有没有数据」，
//   //  不是「字段是不是零」。
//   //
//   //  这条提前返回同时省掉了一次 OAuth 准备流程（prepareApiRequest 会读凭据、
//   //  可能触发刷新），所以它不只是逻辑正确，也是性能上的必要。
  if (!isClaudeAISubscriber()) return null
  try {
    const { accessToken, orgUUID } = await prepareApiRequest()
    const response = await axios.get<UltrareviewQuotaResponse>(
      `${getOauthConfig().BASE_API_URL}/v1/ultrareview/quota`,
      {
        headers: {
          ...getOAuthHeaders(accessToken),
          'x-organization-uuid': orgUUID,
        },
        timeout: 5000,
      },
    )
    return response.data
//   // 【catch 里只记调试日志，不记错误日志 —— 为什么】
//   //
//   //  因为这是「展示用的旁路信息」。配额查不到，功能不受影响，只是少显示一行字。
//   //  对它 logError 会把真正的错误（比如认证失败）淹没在噪声里。
//   //
//   //  判据：**能降级的功能用 logForDebugging，不能降级的才用 logError。**
//   //  这份代码里两个函数（logForDebugging / logError）的分工非常一致，
//   //  读的时候可以用它反推「作者认为这个失败有多严重」。
  } catch (error) {
    logForDebugging(`fetchUltrareviewQuota failed: ${error}`)
    return null
  }
}
