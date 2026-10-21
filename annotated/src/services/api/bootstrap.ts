// ═══════════════════════════════════════════════════════════════
//  bootstrap：启动时问服务端「你还有什么额外模型 / 有什么客户端配置」
// ═══════════════════════════════════════════════════════════════
//
//  这个接口是**服务端的遥控器**：让你多几个模型可选、改一些客户端行为，
//  都不需要发新版本。所以它的读取逻辑里塞满了「什么情况下干脆别问」的判断。
//
//  141 行，结构是三层：
//
//      fetchBootstrapAPI    能力判断 + 认证选择 + 请求 + 校验
//      fetchBootstrapData   落盘（带「没变化就不写」的判断）
//      中间的 withOAuth401Retry  刷新重试
import axios from 'axios'
import isEqual from 'lodash-es/isEqual.js'
import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  hasProfileScope,
} from 'src/utils/auth.js'
import { z } from 'zod'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { withOAuth401Retry } from '../../utils/http.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

// 【用 zod 校验服务端返回值，而且用 lazySchema 包了一层】
//
//  lazySchema 的意思是「第一次用到才构造这个 schema」。为什么？
//  因为 zod 的 schema 构造不是免费的（要建一堆对象），而这个接口
//  在**大部分会话里根本不会被调用**（非 firstParty、非订阅者都会提前返回）。
//  在模块加载期就构造好，等于给所有用户都付一次钱。
//
//  transform 那一段是重点：服务端给的是 model/name/description，
//  客户端要的是 value/label/description（下拉框的形状）。
//  转换写在 schema 里，而不是 parse 完再手工 map —— **校验和转换一次做完**，
//  外面拿到的就是能直接用的结构，不会再有人忘记 map。
const bootstrapResponseSchema = lazySchema(() =>
  z.object({
    client_data: z.record(z.unknown()).nullish(),
    additional_model_options: z
      .array(
        z
          .object({
            model: z.string(),
            name: z.string(),
            description: z.string(),
          })
          .transform(({ model, name, description }) => ({
            value: model,
            label: name,
            description,
          })),
      )
      .nullish(),
  }),
)

type BootstrapResponse = z.infer<ReturnType<typeof bootstrapResponseSchema>>

async function fetchBootstrapAPI(): Promise<BootstrapResponse | null> {
// 【第一个门：非必要流量关闭时，整个功能跳过】
//
//  isEssentialTrafficOnly() 是「故障期的总开关」。它判断的依据来自多个来源
//  （环境变量、服务端下发的策略），但所有调用点关心的都是同一件事：
//  **这东西停了，用户的核心工作会不会受影响？**
//
//  bootstrap 只是「多几个模型选项」，所以可以停。
//  注意它的处理是 return null（静默跳过），不是抛错 —— 因为这个函数
//  在启动路径上，抛错会变成「起不来」。
  if (isEssentialTrafficOnly()) {
    logForDebugging('[Bootstrap] Skipped: Nonessential traffic disabled')
    return null
  }

//   // 【第二个门：不是官方 API 就不问】
//   //
//   //  getAPIProvider() 返回 bedrock / vertex / foundry / firstParty。
//   //  /api/claude_cli/bootstrap 只在官方接口上有，第三方网关不会实现它。
//   //  所以不判这一下，Bedrock 用户每次启动都会拿一个 404。
//   //
//   //  这是读代码时容易忽略的一类判断：**它不是为了正确性，是为了不制造
//   //  无意义的错误日志和延迟。** 功能上「问了也没用」，工程上「问了有害」。
  if (getAPIProvider() !== 'firstParty') {
    logForDebugging('[Bootstrap] Skipped: 3P provider')
    return null
  }

//   // 【OAuth 优先、API key 兜底，而且注释写明了为什么】
//   //
//   //  原注释：OAuth preferred (requires user:profile scope — service-key OAuth
//   //  tokens lack it and would 403). Fall back to API key auth for console users.
//   //
//   //  这句话解释了一个很容易踩的坑：**同样是 OAuth token，也分有没有
//   //  user:profile 这个 scope。** 服务账号式的 token 没有它，拿去请求这个
//   //  接口会 403，而且 403 不会被当成「没权限」处理，看起来像服务端坏了。
//   //
//   //  所以这里的判断是 `有 token 且有 scope`，两个条件都要。
//   //  只判 `!!token` 是不够的。
  // OAuth preferred (requires user:profile scope — service-key OAuth tokens
  // lack it and would 403). Fall back to API key auth for console users.
  const apiKey = getAnthropicApiKey()
  const hasUsableOAuth =
    getClaudeAIOAuthTokens()?.accessToken && hasProfileScope()
  if (!hasUsableOAuth && !apiKey) {
    logForDebugging('[Bootstrap] Skipped: no usable OAuth or API key')
    return null
  }

  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli/bootstrap`

  // withOAuth401Retry handles the refresh-and-retry. API key users fail
  // through on 401 (no refresh mechanism — no OAuth token to pass).
  try {
//     // 【重试回调里重新读一次 token —— 一行注释说明了原因】
//     //
//     //  原注释：Re-read OAuth each call so the retry picks up the refreshed token.
//     //
//     //  这是 withOAuth401Retry 的**使用契约**：回调必须无状态。
//     //  如果你在进入回调之前就读好 token 并闭包住，重试时用的还是那个
//     //  已经过期的 token，刷新就白刷了，只会再来一次 401。
//     //
//     //  这类「回调里重读，不要闭包」的约束，在重试/轮询/订阅场景里通用。
//     //  判据：**只要回调可能被调用第二次，它读的所有外部状态都必须在
//     //  函数体内读。**
    return await withOAuth401Retry(async () => {
      // Re-read OAuth each call so the retry picks up the refreshed token.
      const token = getClaudeAIOAuthTokens()?.accessToken
      let authHeaders: Record<string, string>
      if (token && hasProfileScope()) {
        authHeaders = {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
        }
      } else if (apiKey) {
        authHeaders = { 'x-api-key': apiKey }
      } else {
        logForDebugging('[Bootstrap] No auth available on retry, aborting')
        return null
      }

      logForDebugging('[Bootstrap] Fetching')
      const response = await axios.get<unknown>(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getClaudeCodeUserAgent(),
          ...authHeaders,
        },
        timeout: 5000,
      })
//       // 【校验失败不抛错，只记日志并返回 null】
//       //
//       //  这里的选择很克制：服务端返回了不合 schema 的数据，可能是
//       //  服务端在灰度新字段、或者客户端版本旧。抛错会让启动失败，
//       //  而「少几个额外模型」完全不影响使用。
//       //
//       //  反差在于同目录的很多函数是「失败了就 throw」。区别在于这个
//       //  函数在启动路径上 —— **同一个错误在启动路径上和在用户操作路径上，
//       //  严重性不同**，处理方式也该不同。
//       //
//       //  注意最外层（第 107 行）还是 throw 了：那是网络层错误，
//       //  交给调用方 fetchBootstrapData 去 logError。也就是「格式错」吞掉、
//       //  「网络错」上报。
      const parsed = bootstrapResponseSchema().safeParse(response.data)
      if (!parsed.success) {
        logForDebugging(
          `[Bootstrap] Response failed validation: ${parsed.error.message}`,
        )
        return null
      }
      logForDebugging('[Bootstrap] Fetch ok')
      return parsed.data
    })
  } catch (error) {
    logForDebugging(
      `[Bootstrap] Fetch failed: ${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : 'unknown'}`,
    )
    throw error
  }
}

/**
 * Fetch bootstrap data from the API and persist to disk cache.
 */
export async function fetchBootstrapData(): Promise<void> {
  try {
    const response = await fetchBootstrapAPI()
    if (!response) return

    const clientData = response.client_data ?? null
    const additionalModelOptions = response.additional_model_options ?? []

//     // 【「没变化就不写盘」—— 一行注释，一个真实的成本】
//     //
//     //  原注释：Only persist if data actually changed — avoids a config write
//     //  on every startup.
//     //
//     //  为什么值得为它写四行判断？因为配置文件是**加锁读写**的。
//     //  每次启动都写一次，意味着：一次磁盘 IO + 一次锁竞争 + 一次 mtime 变化
//     //  （mtime 变化还可能触发别的监听器）。
//     //
//     //  isEqual 是深比较 —— 这里必须深比较，因为 clientData 是任意结构。
//     //  所以这段的开销是：一次深比较 vs 一次加锁写盘。前者便宜得多。
//     //
//     //  通用结论：**「值没变就不写」是配置类代码里回报最高的一条优化**，
//     //  因为写入往往带着锁，而锁会把成本放大到别人身上。
    // Only persist if data actually changed — avoids a config write on every startup.
    const config = getGlobalConfig()
    if (
      isEqual(config.clientDataCache, clientData) &&
      isEqual(config.additionalModelOptionsCache, additionalModelOptions)
    ) {
      logForDebugging('[Bootstrap] Cache unchanged, skipping write')
      return
    }

    logForDebugging('[Bootstrap] Cache updated, persisting to disk')
    saveGlobalConfig(current => ({
      ...current,
      clientDataCache: clientData,
      additionalModelOptionsCache: additionalModelOptions,
    }))
  } catch (error) {
    logError(error)
  }
}
