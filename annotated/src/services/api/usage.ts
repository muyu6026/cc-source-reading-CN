// ═══════════════════════════════════════════════════════════════
//  usage：查「这个账号这周用了多少」—— 限流条的原料
// ═══════════════════════════════════════════════════════════════
//
//  `/usage` 那个界面上画的三根进度条，数据就来自这里。
//  63 行，一个 GET，但它里面有三个「失败路径各不相同」的提前返回，
//  这是本文件唯一值得细看的地方。
import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { getAuthHeaders } from '../../utils/http.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { isOAuthTokenExpired } from '../oauth/client.js'

// 【利用率是个 0-100 的数，但类型是 number | null】
//
//  为什么不是 0 到 1？因为服务端给的就是百分数，客户端不重新缩放 ——
//  **不改变量纲**是接第三方数据的一条基本原则：变换越少，对不上的时候越好查。
//
//  为什么 null 而不是 0？因为「还不知道」和「用了 0%」在界面上画法不同：
//  前者应该不画进度条，后者应该画一条空的。用 0 代替 null 会让「未加载」
//  看起来像「一点没用」。
export type RateLimit = {
  utilization: number | null // a percentage from 0 to 100
  resets_at: string | null // ISO 8601 timestamp
}

export type ExtraUsage = {
  is_enabled: boolean
  monthly_limit: number | null
  used_credits: number | null
  utilization: number | null
}

// 【五个窗口 + 一个超额，这是全部字段】
//
//      five_hour              5 小时滚动窗口
//      seven_day              7 天窗口
//      seven_day_oauth_apps   7 天内第三方 OAuth 应用额度
//      seven_day_opus         7 天内 Opus 模型单独额度
//      seven_day_sonnet       7 天内 Sonnet 模型单独额度
//      extra_usage            超额付费的部分
//
//  注意它们全是**可选**的（`?:` 加 `| null`）。这个类型不是在描述「一定有
//  六个字段」，而是在描述「服务端可能给你其中任意几个」。
//
//  这是对外类型的常见写法：**宁可全部可选，也不假设服务端一定返回**。
//  代价是渲染层要处理各种「有这几个没那几个」的组合。
export type Utilization = {
  five_hour?: RateLimit | null
  seven_day?: RateLimit | null
  seven_day_oauth_apps?: RateLimit | null
  seven_day_opus?: RateLimit | null
  seven_day_sonnet?: RateLimit | null
  extra_usage?: ExtraUsage | null
}

// 【三个提前返回，返回的东西各不相同 —— 这是本文件的核心】
//
//  第 35 行  return {}    非订阅者 / 没有 profile 权限
//  第 41 行  return null  OAuth token 已过期
//  第 46 行  throw       拿不到认证头
//
//  三种「失败」为什么给三种返回值？
//
//      {}     → 「这个人本来就没有配额概念」，UI 应该当作「无内容」静默处理
//      null   → 「现在问不了，但过会儿可以」，UI 应该显示「稍后重试」或骨架
//      throw  → 「配置坏了，需要人介入」，必须冒泡上去让外层报错
//
//  这是一份很细的**失败语义分级**。读这类函数时，把每个 return/throw 的
//  返回值抄下来对照，比读函数体本身更有价值。
//
//  反例：如果三个分支都 return null，调用方就无法区分「免费用户」和
//  「token 过期」，只能显示同一句话 —— 那就是把信息在源头丢掉了。
export async function fetchUtilization(): Promise<Utilization | null> {
  if (!isClaudeAISubscriber() || !hasProfileScope()) {
    return {}
  }

  // Skip API call if OAuth token is expired to avoid 401 errors
//   // 【先判 token 过期，再发请求 —— 这是避免 401 的常规做法】
//   //
//   //  注释写明目的是 to avoid 401 errors。为什么不干脆发出去让它 401？
//   //  因为移动端/弱网下 401 会触发一次完整的失败重试链，
//   //  而本地判断只需要读一个时间戳。
//   //
//   //  注意顺序：**能本地判的先本地判**，网络请求放在最后。
//   //  这条顺序在本目录里反复出现（bootstrap、metricsOptOut 都是先判能力再发请求）。
  const tokens = getClaudeAIOAuthTokens()
  if (tokens && isOAuthTokenExpired(tokens.expiresAt)) {
    return null
  }

  const authResult = getAuthHeaders()
  if (authResult.error) {
    throw new Error(`Auth error: ${authResult.error}`)
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...authResult.headers,
  }

  const url = `${getOauthConfig().BASE_API_URL}/api/oauth/usage`

  const response = await axios.get<Utilization>(url, {
    headers,
    timeout: 5000, // 5 second timeout
  })

  return response.data
}
