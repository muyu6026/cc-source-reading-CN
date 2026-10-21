// ═══════════════════════════════════════════════════════════════
//  oauth/getOauthProfile：两条路查「这个人是什么套餐」
// ═══════════════════════════════════════════════════════════════
//
//  两条路对应两种凭据：
//
//      getOauthProfileFromApiKey        用 API key + account_uuid（查）
//      getOauthProfileFromOauthToken    用 Bearer token（查）
//
//  为什么不能只有一条？因为登录方式有两种（免登/console API key），
//  而两者能证明身份的东西不同。**同一个信息的两个入口，取决于凭据类型。**
import axios from 'axios'
import { getOauthConfig, OAUTH_BETA_HEADER } from 'src/constants/oauth.js'
import type { OAuthProfileResponse } from 'src/services/oauth/types.js'
import { getAnthropicApiKey } from 'src/utils/auth.js'
import { getGlobalConfig } from 'src/utils/config.js'
import { logError } from 'src/utils/log.js'
// 【第一个函数：API key + account_uuid 两个都要有】
//
//  第 16 行的判断写得明确：Need both account UUID and API key to check.
//  缺任一个就返回 undefined（不是抛错）。
//
//  account_uuid 来自本地配置（config.oauthAccount），API key 来自环境或配置。
//  也就是说这个函数只在「用户既有 OAuth 账号记录、又配了 API key」时才有用 ——
//  这正是「用 API key 但想知道自己订阅了什么」的场景。
//
//  返回类型是 `T | undefined`，而 catch 里只 logError 不重新抛。
//  也就是**查不到就等于没有**，调用方全部按「信息缺失」处理。
//
//  注意第 10 行那句注释 Assumes interactive session —— 它承认了一个隐含假设：
//  这个函数不会被非交互模式调用（那边没有配置可读）。
export async function getOauthProfileFromApiKey(): Promise<
  OAuthProfileResponse | undefined
> {
  // Assumes interactive session
  const config = getGlobalConfig()
  const accountUuid = config.oauthAccount?.accountUuid
  const apiKey = getAnthropicApiKey()

  // Need both account UUID and API key to check
  if (!accountUuid || !apiKey) {
    return
  }
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli_profile`
  try {
    const response = await axios.get<OAuthProfileResponse>(endpoint, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
      params: {
        account_uuid: accountUuid,
      },
      timeout: 10000,
    })
    return response.data
  } catch (error) {
    logError(error as Error)
  }
}

// 【第二个函数：只要一个 access token，简单得多】
//
//  对比上一个：没有 account_uuid 参数、没有 params、头里只放 Bearer。
//  因为 OAuth token 本身就编码了「我是谁」，服务端不需要额外线索。
//
//  注意两个函数的 header 组合不同：
//
//      API key 路径     x-api-key + anthropic-beta: OAUTH_BETA_HEADER
//      OAuth 路径       Authorization: Bearer + Content-Type: application/json
//
//  这是两套认证体系各自的规矩，不能互换。**读这类文件时最重要的是记住
//  「哪种凭据配哪种头」，配错了症状是 401，而 401 不会告诉你是配错了。**
//
//  两个函数都是 10 秒超时、都返回 T | undefined、都只 logError。
//  这种一致性不是巧合，是这个目录的约定。
export async function getOauthProfileFromOauthToken(
  accessToken: string,
): Promise<OAuthProfileResponse | undefined> {
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/oauth/profile`
  try {
    const response = await axios.get<OAuthProfileResponse>(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    })
    return response.data
  } catch (error) {
    logError(error as Error)
  }
}
