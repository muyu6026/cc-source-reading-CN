// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 1/N —— 重试器（src/services/api/withRetry.ts）
//
// 上一个文件 claude.ts 里，每一个「发请求」的地方都被这个函数包着：
//
//     const generator = withRetry(getClient, async (anthropic, attempt, ctx) => {...}, opts)
//
// 也就是说：claude.ts 负责「怎么把一次请求发出去」，
// 这个文件负责「发失败了怎么办」。822 行，全是后者。
//
// 【为什么不用 SDK 自带的重试】
// SDK 的 maxRetries 只会做一件事：等一会儿，原样再发。而这里要做的有八件：
//
//   ① 换客户端     认证错误后必须重建 client（token 变了、连接池脏了）
//   ② 改参数       上下文溢出时缩小 max_tokens 再试
//   ③ 换模型       连续 3 次 529 就抛 FallbackTriggeredError 交给上层
//   ④ 降档         快模式被限流 → 进冷却、退回标准速度
//   ⑤ 分类放弃     非前台调用撞 529 直接放弃（避免容量雪崩时放大流量）
//   ⑥ 无限重试     无人值守模式（ant 内部）可以一直等下去
//   ⑦ 心跳         长等待期间定期 yield，防止宿主把会话判定为空闲
//   ⑧ 报告进度     每次重试 yield 一条 SystemAPIErrorMessage 给 UI
//
// 【和 claude.ts 完全同构的形态】
// 它也是 async generator，签名是 AsyncGenerator<SystemAPIErrorMessage, T>：
//
//     yield  → 过程中的「我要重试了，还要等 N 毫秒」
//     return → 最终成功的结果 T
//
// 所以调用方必须像行 claude.ts:1848 那样「边拉边转发」，
// 拉完之后 e.value 才是结果。这个双通道约定在两个文件里是同一个模式。
//
// 【全文件的组织方式】
//   50-168    常量、类型、两个 Error 类（控制流信号）
//   170-517   withRetry 主体（348 行，唯一有复杂分支的地方）
//   519-595   退避计算 + 一个「正则解析错误消息」的脆弱函数
//   597-694   各家认证错误的识别与凭证缓存清理
//   696-787   shouldRetry —— 一张从特殊到一般的决策树
//
// 读法建议：先看 696 的 shouldRetry（它定义了「什么算可重试」），
// 再回来看 170 的主循环 —— 否则主循环里那十几个 if 会显得毫无章法。
// ═══════════════════════════════════════════════════════════════
import { feature } from 'bun:bundle'
import type Anthropic from '@anthropic-ai/sdk'
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import type { QuerySource } from 'src/constants/querySource.js'
import type { SystemAPIErrorMessage } from 'src/types/message.js'
import { isAwsCredentialsProviderError } from 'src/utils/aws.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import { createSystemAPIErrorMessage } from 'src/utils/messages.js'
import { getAPIProviderForStatsig } from 'src/utils/model/providers.js'
import {
  clearApiKeyHelperCache,
  clearAwsCredentialsCache,
  clearGcpCredentialsCache,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
  isClaudeAISubscriber,
  isEnterpriseSubscriber,
} from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import {
  type CooldownReason,
  handleFastModeOverageRejection,
  handleFastModeRejectedByAPI,
  isFastModeCooldown,
  isFastModeEnabled,
  triggerFastModeCooldown,
} from '../../utils/fastMode.js'
import { isNonCustomOpusModel } from '../../utils/model/model.js'
import { disableKeepAlive } from '../../utils/proxy.js'
import { sleep } from '../../utils/sleep.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  checkMockRateLimitError,
  isMockRateLimitError,
} from '../rateLimitMocking.js'
import { REPEATED_529_ERROR_MESSAGE } from './errors.js'
import { extractConnectionErrorDetails } from './errorUtils.js'

// 用工厂函数而不是共享实例：APIUserAbortError 会被上层当作控制流信号比较，
// 每次 new 一个能保证 stack 指向真正的抛出点（共享实例的 stack 会是首次创建的）。
// 它主要作为 sleep() 的 abortError 回调传下去，见行 288 / 501 / 511。
const abortError = () => new APIUserAbortError()

// ── 四个数字，每个都对应一次线上事故或一次成本权衡 ──
//
//   DEFAULT_MAX_RETRIES = 10    总共 11 次尝试。看起来很多，但退避是指数的，
//                               第 10 次已经等到 32 秒上限，全部耗完约 5 分钟。
//   FLOOR_OUTPUT_TOKENS = 3000  缩 max_tokens 时的保底值（行 398）。
//                               再小就没有实用价值了，不如直接失败。
//   MAX_529_RETRIES = 3         连续过载 3 次就切模型（行 335）。
//   BASE_DELAY_MS = 500         指数退避的基数（行 543）。
//                               导出是因为测试要断言退避曲线。
const DEFAULT_MAX_RETRIES = 10
const FLOOR_OUTPUT_TOKENS = 3000
const MAX_529_RETRIES = 3
export const BASE_DELAY_MS = 500

// ═══ 「哪些调用值得为 529 重试」白名单 ═══
//
// 这是全文件最重要的一个设计决定，也是最容易被误读成「优化」的一处。
//
// 语义：529 = 服务端过载。这时候重试**不是免费的**——
// 每一次重试都会打到已经过载的网关上，容量雪崩时单个客户端的
// 重试会被放大 3-10 倍（注释原话：3-10× gateway amplification）。
//
// 所以策略是：**只有用户真的在等结果的那几条路径才重试。**
// 摘要、标题、建议、分类器 —— 用户根本看不到它们失败，直接放弃。
//
// 注意这是**白名单**而不是黑名单：新增的 querySource 默认不重试。
// 注释里那句 "add here only if the user is waiting on the result"
// 是一条明确的准入规则，不是建议。
//
// 白名单里的三类值得注意：
//   repl_main_thread:*  主线程的四种输出风格（各自是独立 querySource！）
//   agent:*             子 agent（用户也在等，因为主线程被它挡住了）
//   compact             压缩（不做完整个会话就卡住）
//   分类器（auto_mode / bash_classifier）——「必须完成否则自动模式会判错」
// Foreground query sources where the user IS blocking on the result — these
// retry on 529. Everything else (summaries, titles, suggestions, classifiers)
// bails immediately: during a capacity cascade each retry is 3-10× gateway
// amplification, and the user never sees those fail anyway. New sources
// default to no-retry — add here only if the user is waiting on the result.
const FOREGROUND_529_RETRY_SOURCES = new Set<QuerySource>([
  'repl_main_thread',
  'repl_main_thread:outputStyle:custom',
  'repl_main_thread:outputStyle:Explanatory',
  'repl_main_thread:outputStyle:Learning',
  'sdk',
  'agent:custom',
  'agent:default',
  'agent:builtin',
  'compact',
  'hook_agent',
  'hook_prompt',
  'verification_agent',
  'side_question',
  // Security classifiers — must complete for auto-mode correctness.
  // yoloClassifier.ts uses 'auto_mode' (not 'yolo_classifier' — that's
  // type-only). bash_classifier is ant-only; feature-gate so the string
  // tree-shakes out of external builds (excluded-strings.txt).
// 这一行展示了 feature() 在**数组字面量**里的用法，是个值得记的变体：
// 展开一个空数组时，'bash_classifier' 这个字符串不会进入产物，
// 也就不会出现在 excluded-strings.txt 的检查里（那是防止内部词汇外泄的清单）。
// 注意注释里那个纠正：yoloClassifier.ts 用的 querySource 是 'auto_mode'，
// 'yolo_classifier' 只存在于类型定义里、从没被真正传过。
  'auto_mode',
  ...(feature('BASH_CLASSIFIER') ? (['bash_classifier'] as const) : []),
])

// 一个反直觉的默认值：**querySource 为 undefined 时选择重试**。
//
// 这和上面「默认不重试」看似矛盾，其实不矛盾：
//   白名单未命中     → 这是**已知**的后台调用，明确不重试
//   querySource 缺失 → 这是**未知**来源，无法判断用户在不在等，保守选重试
//
// 「已知的次要路径」和「未知路径」要给不同的默认值 —— 这个区分很值得学。
function shouldRetry529(querySource: QuerySource | undefined): boolean {
  // undefined → retry (conservative for untagged call paths)
  return (
    querySource === undefined || FOREGROUND_529_RETRY_SOURCES.has(querySource)
  )
}

// ═══ 无人值守模式（ant 内部）═══
//
// 场景：自动化任务在远端跑，没人看着，失败了没人重来，所以必须一直等。
// 三个常量对应三个约束：
//
//   PERSISTENT_MAX_BACKOFF_MS = 5min   单次退避封顶（别等太久，及时响应恢复）
//   PERSISTENT_RESET_CAP_MS   = 6h     总等待封顶（配额重置可能远在天边，
//                                      但不能真的等 24 小时不返回）
//   HEARTBEAT_INTERVAL_MS     = 30s    心跳间隔（分块 sleep，每 30s yield 一次）
//
// 那条 TODO 很坦诚：用心跳消息当保活是临时方案，
// 理想情况应该有一条独立的保活通道（不占用业务消息流）。
// CLAUDE_CODE_UNATTENDED_RETRY: for unattended sessions (ant-only). Retries 429/529
// indefinitely with higher backoff and periodic keep-alive yields so the host
// environment does not mark the session idle mid-wait.
// TODO(ANT-344): the keep-alive via SystemAPIErrorMessage yields is a stopgap
// until there's a dedicated keep-alive channel.
const PERSISTENT_MAX_BACKOFF_MS = 5 * 60 * 1000
const PERSISTENT_RESET_CAP_MS = 6 * 60 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 30_000

// 双重门禁：编译期 feature() + 运行期环境变量。
// 编译期为假时整个分支被删掉，连环境变量名都不在产物里 ——
// 这是内部功能的标配写法（和 claude.ts 里 USER_TYPE === 'ant' 内联同源）。
function isPersistentRetryEnabled(): boolean {
  return feature('UNATTENDED_RETRY')
    ? isEnvTruthy(process.env.CLAUDE_CODE_UNATTENDED_RETRY)
    : false
}

// 「暂时性容量错误」= 服务端忙，不是请求错了。只有 529 和 429 两种。
// 这个判定只被 persistent 模式用（行 369 / 704）——
// 普通模式下的重试判断走 shouldRetry（行 696），比这里细得多。
function isTransientCapacityError(error: unknown): boolean {
  return (
    is529Error(error) || (error instanceof APIError && error.status === 429)
  )
}

// ⚠ ECONNRESET / EPIPE 的语义要理解对：
// 这两个错误码几乎总是**复用了一条已被服务端关闭的 socket**。
// HTTP keep-alive 连接池里，服务端到期单方面关闭，客户端不知道，
// 下一次请求写到这条死连接上 → EPIPE（写）或 ECONNRESET（读）。
//
// 结论不是「重试」，而是「重试 + 关掉连接池」（行 229 的 disableKeepAlive）。
// 只重试不关池子，下一次还会撞上同一条死连接。
function isStaleConnectionError(error: unknown): boolean {
  if (!(error instanceof APIConnectionError)) {
    return false
  }
  const details = extractConnectionErrorDetails(error)
  return details?.code === 'ECONNRESET' || details?.code === 'EPIPE'
}

// ═══ RetryContext：可变的「重试上下文」═══
//
// 只有四个字段，但每一个都可能被主循环在重试之间**改掉**：
//   maxTokensOverride   ← 上下文溢出时调小（行 416）
//   model               ← 这里不会被改，但它决定了用哪个模型
//   thinkingConfig      ← 不同模型支持度不同
//   fastMode            ← 进冷却时置 false（行 280 / 302 / 312）
//
// 注意它同时是 CannotRetryError 的字段（行 147）：失败时把「最终用的什么配置」
// 一起带上去，上层才能知道「到底哪个模型失败了、max_tokens 是多少」。
// 这就是 claude.ts:2706 那句 `errorModel = fallbackError.retryContext.model` 的来源。
export interface RetryContext {
  maxTokensOverride?: number
  model: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
}

// ═══ RetryOptions：调用方（其实就是 claude.ts）能配的 ═══
//
// 注意 maxRetries 是**可选**的，而 claude.ts 显式传了 0 ——
// 因为那边自己管重试（流式降级），不想要 SDK 内部再重试一层。
// 这也解释了行 796 为什么用 ?? 而不是 ||：0 是合法且有意义的值。
interface RetryOptions {
  maxRetries?: number
  model: string
  fallbackModel?: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
  signal?: AbortSignal
  querySource?: QuerySource
  /**
   * Pre-seed the consecutive 529 counter. Used when this retry loop is a
   * non-streaming fallback after a streaming 529 — the streaming 529 should
   * count toward MAX_529_RETRIES so total 529s-before-fallback is consistent
   * regardless of which request mode hit the overload.
   */
// 这个字段就是上一轮在 claude.ts:2559 看到的那个参数的**消费端**。
//
// 「预置连续 529 计数」的意义：流式阶段撞了 1 次 529 才降级过来的话，
// 非流式这边要接着往下数（2、3…），否则同一个故障在两种模式下
// 会给出不同的「连续几次才切模型」阈值。
  initialConsecutive529Errors?: number
}

// ═══ CannotRetryError：包装 + 携带上下文 ═══
//
// 为什么不用原错误直接抛：需要把 retryContext 一起带上去。
// 上层拿到它之后要做两件事：
//   1. 取 originalError 做日志和用户提示（claude.ts:2759）
//   2. 取 retryContext.model 作为「出错时到底用的哪个模型」（claude.ts:2760）
//
// 还有一个细节：它**复用了原错误的 stack**（行 154-156）。
// 不复用的话，堆栈会指向 withRetry 内部这一行，
// 而真正出错的调用链信息就丢了。
export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    const message = errorMessage(originalError)
    super(message)
    this.name = 'RetryError'
// ⚠ 这里有个不一致值得指出：类名叫 CannotRetryError，name 却写成 'RetryError'。
//
// 影响不大但真实存在：任何按 `error.name` 做分支的代码（日志聚合、
// 错误上报的 group by）看到的是 'RetryError'，跟类名对不上。
// 注释里没写原因，推测是历史包袱——先有 name 字面量，后重构出这个类。

    // Preserve the original stack trace if available
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack
    }
  }
}

// ═══ FallbackTriggeredError：一个「不是错误」的错误 ═══
//
// 它的作用完全是控制流：告诉上层「别重试了，换模型吧」。
//
// 为什么必须用异常：它在 while/for 循环最深处产生（行 347），
// 中间隔了 try/catch、两层生成器、还有 claude.ts 的降级逻辑。
// 用返回值传出来要改一路的签名；用异常只需要两处 catch 各写一行
// 「原样往上抛」（claude.ts:2603 和 2692）。
//
// 两个接收者的分工：
//   claude.ts  → 识别到它必须**立即 rethrow**，绝不能吞（否则降级变空操作）
//   query.ts   → 接住它，重建整个循环状态、换 fallbackModel 重跑
//
// 这也是为什么它的消息文案是给用户看的：
// 「Model fallback triggered: X -> Y」——真的会显示出来。
export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
  }
}

// ═══════════════════════════════════════════════════════════════
// withRetry —— 主循环，348 行
//
// 参数三件套：
//   getClient  建客户端。**只在需要时调用**，不是每次都建（行 232 的条件）
//   operation  一次尝试。注意它的第三个参数是 retryContext —— 每次都会传，
//              因为参数可能被上一个 catch 改过
//   options    策略
//
// 返回 AsyncGenerator<SystemAPIErrorMessage, T>：
//   yield  重试进度（UI 显示「正在重试 2/11，等待 1.2 秒」）
//   return 成功的结果
//
// 【主循环的骨架】
//
//     for (attempt = 1; attempt <= maxRetries + 1; attempt++) {
//         if (aborted) throw
//         记下 wasFastModeActive（这一轮开始时快模式是否生效）
//         try {
//             必要时重建 client
//             return await operation(...)          ← 成功，直接 return
//         } catch (error) {
//             ...十几个 if，按「特殊 → 一般」排列...
//             计算 delay → yield 进度 → sleep
//         }
//     }
//     throw CannotRetryError(lastError)            ← 循环走完还没成功
//
// 注意 `maxRetries + 1` 这个上界：maxRetries=10 意味着 11 次尝试
// （首次 + 10 次重试）。而循环体里 `attempt > maxRetries` 就抛错，
// 所以最后一次（第 11 次）实际上永远不会执行到「重试」分支 ——
// 它只是给 operation 一次机会。
// ═══════════════════════════════════════════════════════════════
export async function* withRetry<T>(
  getClient: () => Promise<Anthropic>,
  operation: (
    client: Anthropic,
    attempt: number,
    context: RetryContext,
  ) => Promise<T>,
  options: RetryOptions,
): AsyncGenerator<SystemAPIErrorMessage, T> {
  const maxRetries = getMaxRetries(options)
  const retryContext: RetryContext = {
    model: options.model,
    thinkingConfig: options.thinkingConfig,
    ...(isFastModeEnabled() && { fastMode: options.fastMode }),
  }
// client 放在循环外，是「连接复用」的关键：
// Anthropic SDK 的 client 内部持有 HTTP agent / 连接池，
// 每次重建等于丢掉所有 keep-alive 连接。所以只在**必须**时重建（行 232）。
  let client: Anthropic | null = null
  let consecutive529Errors = options.initialConsecutive529Errors ?? 0
  let lastError: unknown
  let persistentAttempt = 0
// 注意 `attempt` 在循环体里会被**改写**（行 506：`attempt = maxRetries`）。
// 一个 for 循环的计数器被手动赋值来「阻止循环退出」，这是全文件最 hck 的一处，
// 到 504 行再详细讲。
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (options.signal?.aborted) {
      throw new APIUserAbortError()
    }

// 为什么要在「这一轮开始时」快照快模式状态，而不是 catch 里现查：
// 因为 catch 的分支可能**改变**这个状态（进冷却、被拒绝 → fastMode = false）。
// 现查的话，第一轮改了、第二轮就判断不出「上一轮开始时是开的」，
// 于是「被 API 拒绝后永久关闭」这类逻辑会反复触发。
    // Capture whether fast mode is active before this attempt
    // (fallback may change the state mid-loop)
    const wasFastModeActive = isFastModeEnabled()
      ? retryContext.fastMode && !isFastModeCooldown()
      : false

    try {
// 测试专用的假限流器：/mock-limits 命令可以让内部员工模拟 429。
// 它被放在 try 里的**最前面**，抛出后走完整的真实重试路径 ——
// 这样测的就是真代码，不是打桩。
      // Check for mock rate limits (used by /mock-limits command for Ant employees)
      if (process.env.USER_TYPE === 'ant') {
        const mockError = checkMockRateLimitError(
          retryContext.model,
          wasFastModeActive,
        )
        if (mockError) {
          throw mockError
        }
      }

// ═══ 客户端重建策略 ═══
//
// 六种情况会重建，每一种都对应「旧 client 已经不可用或它的缓存已脏」：
//
//   client === null          首次
//   401                      API key 错误 → 可能换了 key
//   OAuth token revoked      另一个进程刷新过 token（本进程手里的是旧的）
//   Bedrock 认证错误         AWS 凭证过期
//   Vertex 认证错误          GCP token 过期
//   ECONNRESET / EPIPE       连接池里有死连接 → 重建池子
//
// 注释里那句「Get a fresh client instance on first attempt or after
// authentication errors」是在说：**其余情况下 client 要复用**。
// 因为重建 client 会丢掉连接复用，每次 TLS 握手都是几十毫秒。
      // Get a fresh client instance on first attempt or after authentication errors
      // - 401 for first-party API authentication failures
      // - 403 "OAuth token has been revoked" (another process refreshed the token)
      // - Bedrock-specific auth errors (403 or CredentialsProviderError)
      // - Vertex-specific auth errors (credential refresh failures, 401)
      // - ECONNRESET/EPIPE: stale keep-alive socket; disable pooling and reconnect
      const isStaleConnection = isStaleConnectionError(lastError)
      if (
        isStaleConnection &&
        getFeatureValue_CACHED_MAY_BE_STALE(
          'tengu_disable_keepalive_on_econnreset',
          false,
        )
      ) {
        logForDebugging(
          'Stale connection (ECONNRESET/EPIPE) — disabling keep-alive for retry',
        )
        disableKeepAlive()
      }

      if (
        client === null ||
        (lastError instanceof APIError && lastError.status === 401) ||
        isOAuthTokenRevokedError(lastError) ||
        isBedrockAuthError(lastError) ||
        isVertexAuthError(lastError) ||
        isStaleConnection
      ) {
// 注意这里的顺序：**先刷新 token，再建 client**。
// 反过来的话，新建的 client 拿到的还是那个已过期的 accessToken，
// 下一次请求继续 401 —— 会白白耗掉一次重试机会。
//
// handleOAuth401Error(failedAccessToken) 传的是「失败时用的那个 token」，
// 而不是「当前 token」：因为另一个进程可能已经换过了，
// 传失败的那个才能让刷新逻辑判断「要不要真的去刷」。
        // On 401 "token expired" or 403 "token revoked", force a token refresh
        if (
          (lastError instanceof APIError && lastError.status === 401) ||
          isOAuthTokenRevokedError(lastError)
        ) {
          const failedAccessToken = getClaudeAIOAuthTokens()?.accessToken
          if (failedAccessToken) {
            await handleOAuth401Error(failedAccessToken)
          }
        }
        client = await getClient()
      }

      return await operation(client, attempt, retryContext)
// 正常路径到这里就结束了。下面整个 catch 块（254-513）都是错误处理，
// 260 行 vs 1 行 —— 这个比例说明了这个文件的本质：
// 它的价值几乎全在「出错时怎么兜」。
    } catch (error) {
      lastError = error
      logForDebugging(
        `API error (attempt ${attempt}/${maxRetries + 1}): ${error instanceof APIError ? `${error.status} ${error.message}` : errorMessage(error)}`,
        { level: 'error' },
      )
// 每一条错误都先记一行日志，不管后面怎么处理。
// 格式里同时放了 attempt 序号和「非 APIError 时用 errorMessage() 兜底」——
// 因为这里见过太多不是 APIError 的东西（AWS SDK 的怪对象、字符串、
// 甚至 undefined），直接读 .message 会二次崩溃。

// ═══ 快模式（fast mode）的三条退出路径 ═══
//
// 快模式 = 用更快的推理档位跑。撞到限流或过载时不能傻重试，要分情况：
//
//   A. 429 且原因是「超额用量不可用」 → 永久关闭快模式（行 278）
//   B. retry-after 很短（<20s）        → 原地等待，**保持快模式**
//   C. retry-after 很长或未知          → 进冷却（切回标准速度），有 10min 下限
//
// B 和 C 的分界（SHORT_RETRY_THRESHOLD_MS = 20s）背后是缓存成本：
// 切速度意味着换模型名 → prompt cache 全废（几十 K token）。
// 所以「只等 3 秒」的情况宁可等，也不愿切档。
// 而「要等 10 分钟」的情况，缓存反正也过期了，切档更划算。
//
// 行 267 那个 `!isPersistentRetryEnabled()` 门禁见下面的注释——两个机制会打架。
      // Fast mode fallback: on 429/529, either wait and retry (short delays)
      // or fall back to standard speed (long delays) to avoid cache thrashing.
      // Skip in persistent mode: the short-retry path below loops with fast
      // mode still active, so its `continue` never reaches the attempt clamp
      // and the for-loop terminates. Persistent sessions want the chunked
      // keep-alive path instead of fast-mode cache-preservation anyway.
      if (
        wasFastModeActive &&
        !isPersistentRetryEnabled() &&
        error instanceof APIError &&
        (error.status === 429 || is529Error(error))
      ) {
// 这一条是唯一「永久性」的处理：响应头明确说超额用量不可用，
// 那就不是暂时限流，而是账号状态问题，重试一万次也没用。
//
// 处理方式是三步：写状态（handleFastModeOverageRejection）→
// 改 retryContext → continue 立刻重试（不 sleep！因为不是容量问题）。
        // If the 429 is specifically because extra usage (overage) is not
        // available, permanently disable fast mode with a specific message.
        const overageReason = error.headers?.get(
          'anthropic-ratelimit-unified-overage-disabled-reason',
        )
        if (overageReason !== null && overageReason !== undefined) {
          handleFastModeOverageRejection(overageReason)
          retryContext.fastMode = false
          continue
        }

// 短/长分叉的具体阈值逻辑，上一段注释已经讲了原理。
// 这里补充一个实现细节：`retryAfterMs ?? DEFAULT_FAST_MODE_FALLBACK_HOLD_MS`
// 再套 `Math.max(..., MIN_COOLDOWN_MS)` —— 即使服务端说「3 秒后重试」，
// 冷却也至少 10 分钟。为什么：避免在临界点上反复切档（flip-flopping），
// 每次切档都是一次缓存作废。
        const retryAfterMs = getRetryAfterMs(error)
        if (retryAfterMs !== null && retryAfterMs < SHORT_RETRY_THRESHOLD_MS) {
          // Short retry-after: wait and retry with fast mode still active
          // to preserve prompt cache (same model name on retry).
          await sleep(retryAfterMs, options.signal, { abortError })
          continue
        }
        // Long or unknown retry-after: enter cooldown (switches to standard
        // speed model), with a minimum floor to avoid flip-flopping.
        const cooldownMs = Math.max(
          retryAfterMs ?? DEFAULT_FAST_MODE_FALLBACK_HOLD_MS,
          MIN_COOLDOWN_MS,
        )
        const cooldownReason: CooldownReason = is529Error(error)
          ? 'overloaded'
          : 'rate_limit'
        triggerFastModeCooldown(Date.now() + cooldownMs, cooldownReason)
        if (isFastModeEnabled()) {
          retryContext.fastMode = false
        }
        continue
      }

// 第二条退出路径：API 直接说「这个组织没开快模式」（400）。
// 这是配置问题，不是容量问题 → 永久关闭 + 立刻重试。
      // Fast mode fallback: if the API rejects the fast mode parameter
      // (e.g., org doesn't have fast mode enabled), permanently disable fast
      // mode and retry at standard speed.
      if (wasFastModeActive && isFastModeNotEnabledError(error)) {
        handleFastModeRejectedByAPI()
        retryContext.fastMode = false
        continue
      }

// ═══ 非前台调用的 529 直接放弃 ═══
//
// 这是白名单（行 62）的执行点。为什么放在快模式分支**之后**：
// 快模式的三种处理都是「立刻有结论」的，优先于「要不要重试」这个更一般的问题。
//
// logEvent 里只带 query_source，没有 error 详情 —— 因为这不是错误，
// 是**预期内的丢弃**，指标上看的是「每秒丢弃多少后台调用」这个量。
      // Non-foreground sources bail immediately on 529 — no retry amplification
      // during capacity cascades. User never sees these fail.
      if (is529Error(error) && !shouldRetry529(options.querySource)) {
        logEvent('tengu_api_529_background_dropped', {
          query_source:
            options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw new CannotRetryError(error, retryContext)
      }

// ═══ 连续 529 计数 → 切模型 ═══
//
// 那个条件的含义需要拆开看：
//
//     process.env.FALLBACK_FOR_ALL_PRIMARY_MODELS
//     || (!isClaudeAISubscriber() && isNonCustomOpusModel(options.model))
//
// 意思是：只有「环境变量强制开」或者「非订阅者 + 用的是官方 Opus」才计数。
// 也就是说订阅用户不走这条切模型路径（他们有自己的配额模型）。
//
// 注释里那条 TODO 很坦诚：「isNonCustomOpusModel 这个检查可能只是
// Claude Code 还硬编码在 Opus 上那个年代留下的化石」。
      // Track consecutive 529 errors
      if (
        is529Error(error) &&
        // If FALLBACK_FOR_ALL_PRIMARY_MODELS is not set, fall through only if the primary model is a non-custom Opus model.
        // TODO: Revisit if the isNonCustomOpusModel check should still exist, or if isNonCustomOpusModel is a stale artifact of when Claude Code was hardcoded on Opus.
// 「化石代码」的自我标注。这类 TODO 在成熟项目里是健康信号：
// 它承认了「这段逻辑的原始理由已经不存在，但没人敢删」。
// 判断能不能删的方法通常是看它保护的分支还有没有真实流量。
        (process.env.FALLBACK_FOR_ALL_PRIMARY_MODELS ||
          (!isClaudeAISubscriber() && isNonCustomOpusModel(options.model)))
      ) {
        consecutive529Errors++
        if (consecutive529Errors >= MAX_529_RETRIES) {
          // Check if fallback model is specified
          if (options.fallbackModel) {
            logEvent('tengu_api_opus_fallback_triggered', {
              original_model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_model:
                options.fallbackModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              provider: getAPIProviderForStatsig(),
            })

            // Throw special error to indicate fallback was triggered
            throw new FallbackTriggeredError(
              options.model,
              options.fallbackModel,
            )
          }

// 走到这里说明：连续 3 次 529，但没有 fallbackModel 可用。
// 对**外部用户**（USER_TYPE === 'external'）且不在沙箱里，
// 给一条明确的「服务过载」错误文案，而不是让用户看着重试转圈 5 分钟。
//
// 注意 `!isPersistentRetryEnabled()`：无人值守模式下绝不能放弃，
// 那个模式下这个 if 直接跳过，继续往下走无限重试。
          if (
            process.env.USER_TYPE === 'external' &&
            !process.env.IS_SANDBOX &&
            !isPersistentRetryEnabled()
          ) {
            logEvent('tengu_api_custom_529_overloaded_error', {})
            throw new CannotRetryError(
              new Error(REPEATED_529_ERROR_MESSAGE),
              retryContext,
            )
          }
        }
      }

// ═══ 「要不要重试」的总判断，顺序不能动 ═══
//
//   1. 重试次数用尽 且 不是 persistent       → 放弃
//   2. 云厂商凭证错误（AWS/GCP）             → 已经清了缓存，视为可重试
//   3. 不是 APIError 或 shouldRetry 说不行    → 放弃
//   4. 可修的 400（上下文溢出）              → 改参数后重试
//   5. 其余                                  → 正常退避重试
//
// 第 2 步放在第 3 步之前是必须的：AWS/GCP 的凭证错误**不是 APIError**，
// 如果先过第 3 步就会被误判成「不可重试」。
      // Only retry if the error indicates we should
      const persistent =
        isPersistentRetryEnabled() && isTransientCapacityError(error)
      if (attempt > maxRetries && !persistent) {
        throw new CannotRetryError(error, retryContext)
      }

// 这两个 handler 有副作用（清凭证缓存），所以不能写成纯判断。
// `||` 的短路在这里也是必须的：AWS 那条命中就不该再去试 GCP 的
// （两个环境变量同时为真的情况虽少，但清错缓存会让另一次重试拿着坏凭证）。
      // AWS/GCP errors aren't always APIError, but can be retried
      const handledCloudAuthError =
        handleAwsCredentialError(error) || handleGcpCredentialError(error)
      if (
        !handledCloudAuthError &&
        (!(error instanceof APIError) || !shouldRetry(error))
      ) {
        throw new CannotRetryError(error, retryContext)
      }

// ═══ 唯一会「改参数再重试」的分支 ═══
//
// 场景：400，消息是 "input length and `max_tokens` exceed context limit:
// 188059 + 20000 > 200000"。意思是输入 + 最大输出超过了窗口。
//
// 处理：把 max_tokens 调小到「窗口剩余空间 - 1000 缓冲」，
// 保证这次请求能装进去，然后 continue（不 sleep，不是容量问题）。
//
// ⚠ 注释里那三行（385-387）是**这段代码已经过时**的自白：
// 有了 extended-context-window beta 之后，API 改成返回
// stop_reason = 'model_context_window_exceeded'，不再返回这个 400。
// 这里保留纯粹为了「万一还有老网关」。
      // Handle max tokens context overflow errors by adjusting max_tokens for the next attempt
      // NOTE: With extended-context-window beta, this 400 error should not occur.
      // The API now returns 'model_context_window_exceeded' stop_reason instead.
      // Keeping for backward compatibility.
      if (error instanceof APIError) {
        const overflowData = parseMaxTokensContextOverflowError(error)
        if (overflowData) {
          const { inputTokens, contextLimit } = overflowData

          const safetyBuffer = 1000
          const availableContext = Math.max(
            0,
            contextLimit - inputTokens - safetyBuffer,
          )
          if (availableContext < FLOOR_OUTPUT_TOKENS) {
            logError(
              new Error(
                `availableContext ${availableContext} is less than FLOOR_OUTPUT_TOKENS ${FLOOR_OUTPUT_TOKENS}`,
              ),
            )
            throw error
          }
          // Ensure we have enough tokens for thinking + at least 1 output token
// 这个 minRequired 是第三次遇到同一条 API 约束了（前两次在 claude.ts）。
//
// 约束：max_tokens 必须**严格大于** thinking.budget_tokens。
// 所以缩小 max_tokens 时，下界不是 1，而是「思考预算 + 1」。
//
// 三个值取 max：保底 3000、实际可用空间、思考预算 + 1。
// 取 max 而不是 min 的理由：这三个都是「不能低于」的下界，
// 而不是「不能超过」的上界。如果思考预算本身就大于可用空间，
// 那这个请求无论怎么调都装不下 —— 但那时 max 会取到 minRequired，
// 让请求带着一个明确的原因失败（400），而不是悄悄改成 1 然后输出被截断。
          const minRequired =
            (retryContext.thinkingConfig.type === 'enabled'
              ? retryContext.thinkingConfig.budgetTokens
              : 0) + 1
          const adjustedMaxTokens = Math.max(
            FLOOR_OUTPUT_TOKENS,
            availableContext,
            minRequired,
          )
          retryContext.maxTokensOverride = adjustedMaxTokens

          logEvent('tengu_max_tokens_context_overflow_adjustment', {
            inputTokens,
            contextLimit,
            adjustedMaxTokens,
            attempt,
          })

          continue
        }
      }

// ═══ 正常的退避重试 ═══
//
// 三个分支的差别只在「延迟怎么算」：
//   persistent + 429    → 优先按服务端的配额重置时间等（可能是几小时）
//   persistent + 其他    → 指数退避，但用独立的 persistentAttempt 计数
//   普通                → 指数退避，用 attempt 计数
//
// 为什么 persistent 要用两个计数器：因为 for 循环的 attempt 被 clamp 住了
// （行 506，永远不增长），退避若跟着它就会卡在同一个延迟上永远不长。
      // For other errors, proceed with normal retry logic
      // Get retry-after header if available
      const retryAfter = getRetryAfter(error)
      let delayMs: number
// 配额窗口类限流（Max/Pro 的 5 小时窗口）会带一个**重置时间戳**。
// 既然知道什么时候恢复，就没必要每 5 分钟探一次 —— 直接睡到那个时刻。
// 这个优化对无人值守模式价值最大：能省下几百次无用的请求。
      if (persistent && error instanceof APIError && error.status === 429) {
        persistentAttempt++
        // Window-based limits (e.g. 5hr Max/Pro) include a reset timestamp.
        // Wait until reset rather than polling every 5 min uselessly.
        const resetDelay = getRateLimitResetDelayMs(error)
        delayMs =
          resetDelay ??
          Math.min(
            getRetryDelay(
              persistentAttempt,
              retryAfter,
              PERSISTENT_MAX_BACKOFF_MS,
            ),
            PERSISTENT_RESET_CAP_MS,
          )
      } else if (persistent) {
        persistentAttempt++
        // Retry-After is a server directive and bypasses maxDelayMs inside
        // getRetryDelay (intentional — honoring it is correct). Cap at the
        // 6hr reset-cap here so a pathological header can't wait unbounded.
        delayMs = Math.min(
          getRetryDelay(
            persistentAttempt,
            retryAfter,
            PERSISTENT_MAX_BACKOFF_MS,
          ),
          PERSISTENT_RESET_CAP_MS,
        )
      } else {
        delayMs = getRetryDelay(attempt, retryAfter)
      }

// persistent 模式下 for 循环的 attempt 被钉在 maxRetries，
// 所以遥测和进度提示必须用 persistentAttempt，否则永远是「第 11 次」。
      // In persistent mode the for-loop `attempt` is clamped at maxRetries+1;
      // use persistentAttempt for telemetry/yields so they show the true count.
      const reportedAttempt = persistent ? persistentAttempt : attempt
      logEvent('tengu_api_retry', {
        attempt: reportedAttempt,
        delayMs: delayMs,
        error: (error as APIError)
          .message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        status: (error as APIError).status,
        provider: getAPIProviderForStatsig(),
      })

// ═══ 分块 sleep + 心跳 ═══
//
// 为什么要分块：无人值守会话跑在某个宿主里（CI、容器、远程 agent），
// 宿主通常有「N 分钟没有 stdout 输出就认为空闲并挂起/回收」的机制。
// 一次 sleep 300 秒，宿主看到的就是 5 分钟静默 → 会话被杀。
//
// 所以切成 30 秒一块，每块之前 yield 一条 SystemAPIErrorMessage。
// 注释里那句 TODO 承认这是权宜之计：用业务消息当保活信号，
// 理想方案是一条独立的保活通道。
      if (persistent) {
        if (delayMs > 60_000) {
          logEvent('tengu_api_persistent_retry_wait', {
            status: (error as APIError).status,
            delayMs,
            attempt: reportedAttempt,
            provider: getAPIProviderForStatsig(),
          })
        }
        // Chunk long sleeps so the host sees periodic stdout activity and
        // does not mark the session idle. Each yield surfaces as
        // {type:'system', subtype:'api_retry'} on stdout via QueryEngine.
        let remaining = delayMs
        while (remaining > 0) {
          if (options.signal?.aborted) throw new APIUserAbortError()
          if (error instanceof APIError) {
            yield createSystemAPIErrorMessage(
              error,
              remaining,
              reportedAttempt,
              maxRetries,
            )
          }
          const chunk = Math.min(remaining, HEARTBEAT_INTERVAL_MS)
          await sleep(chunk, options.signal, { abortError })
          remaining -= chunk
        }
// ⚠⚠ 全文件最刁钻的一行，值得单独讲：
//
//     if (attempt >= maxRetries) attempt = maxRetries
//
// 效果：**把 for 循环的计数器手动钉死，让循环永不退出。**
// 因为循环条件是 attempt <= maxRetries + 1，而进到循环体后立刻
// attempt++ 变成 maxRetries + 1，仍 <= 上界 → 下一轮继续。
//
// 为什么不用 `while(true)` 加显式 break：那样要重写整个循环结构，
// 而这个 hack 只用一行。代价是**循环变量变成了一个被污染的、语义混乱的变量**——
// 它既表示「第几次尝试」（给非 persistent 用），又被拿来当退出条件。
// 所以上面才需要 persistentAttempt 这个第二计数器。
//
// 这是一种「用状态污染换控制流改动最小」的取舍。看得出来作者知道这不优雅：
// 注释写的是 "Clamp so the for-loop never terminates"，
// 而不是假装这是一个正常设计。
        // Clamp so the for-loop never terminates. Backoff uses the separate
        // persistentAttempt counter which keeps growing to the 5-min cap.
        if (attempt >= maxRetries) attempt = maxRetries
      } else {
        if (error instanceof APIError) {
          yield createSystemAPIErrorMessage(error, delayMs, attempt, maxRetries)
        }
        await sleep(delayMs, options.signal, { abortError })
      }
    }
  }

// 循环正常走完（没 return、没 throw）才会到这里。
// 只在 maxRetries = 0 这类边界下会发生：循环体做了一次尝试，
// 失败了，`attempt > maxRetries` 判断其实已经抛过了，所以正常不可达。
// 留着是防御性的 —— 生成器必须有明确的结束路径。
  throw new CannotRetryError(lastError, retryContext)
}

// ═══ 读 retry-after ═══
//
// 为什么要写两种取法：error.headers 有两种形态。
//   · 普通对象形态：headers['retry-after']（直接下标）
//   · Headers 实例形态：headers.get('retry-after')
//
// 取决于错误从哪来：SDK 抛的 APIError 一般是 Headers 实例，
// 但经过某些网关/包装层之后可能退化成普通对象。所以先试下标、再试 get。
// 那个 `?.get?.()` 的双问号就是在防「headers 是对象但没有 get 方法」。
function getRetryAfter(error: unknown): string | null {
  return (
    ((error as { headers?: { 'retry-after'?: string } }).headers?.[
      'retry-after'
    ] ||
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      ((error as APIError).headers as Headers)?.get?.('retry-after')) ??
    null
  )
}

// ═══════════════════════════════════════════════════════════════
// getRetryDelay —— 退避计算，14 行，但有两个容易忽略的细节
// ═══════════════════════════════════════════════════════════════
export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
// ⚠ 细节一：服务端给的 retry-after **优先于一切本地计算，且不受 maxDelayMs 约束**。
//
// 看 538 行：`return seconds * 1000` —— 直接返回，没有 Math.min。
// 这是有意的（行 450 的注释也提到了）：服务端的指令应当被尊重。
//
// 代价是理论上可能等很久，所以调用方在 persistent 分支外面
// 又套了一层 PERSISTENT_RESET_CAP_MS（6 小时）兜底（行 446 / 459）——
// 防止一个病态的 header 让进程睡到下辈子。
//
// 另一个细节：parseInt 而不是 Number。'30abc' 会得到 30 而不是 NaN，
// 对 header 这种可能带多余字符的输入更宽容。
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }

// 细节二：**指数退避的上限是 32 秒**（maxDelayMs 默认值）。
//
//   第 1 次 → 0.5s    第 5 次 → 8s
//   第 2 次 → 1s      第 6 次 → 16s
//   第 3 次 → 2s      第 7 次起 → 32s（封顶）
//   第 4 次 → 4s
//
// 10 次重试全耗完约 5 分钟。封顶 32 秒的理由：再长的话用户体验太差，
// 而且真要恢复的话 32 秒足够探测出来（服务端过载通常在秒级恢复）。
  const baseDelay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attempt - 1),
    maxDelayMs,
  )
// ⚠ 这里用的是「正抖动」（0 到 +25%），不是业界常见的 full jitter
// （0 到 base 的均匀随机）。
//
// 差别很实际：
//   full jitter     可能把 32 秒缩成 2 秒，打散效果好但等待时间不可控
//   正抖动（这里）  保证不低于理论退避值，只在上面加噪声
//
// 目的是一样的：让同时失败的 N 个客户端不要在同一毫秒一起重试
// （thundering herd）。代价是打散效果比 full jitter 弱 ——
// 但对一个桌面 CLI 来说，「不会莫名等很短」比「打散更彻底」更重要。
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

// ═══ 正则解析错误消息：全文件最脆弱的一段 ═══
//
// 它靠匹配 API 返回的**自然语言**来提取三个数字。看行 569 的格式例子：
//
//     "input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000"
//
// 服务端只要改一个标点（比如把 `+` 换成 `and`、把反引号去掉），
// 这个函数就永远返回 undefined，那条「缩小 max_tokens 再试」的恢复路径
// 就直接失效 —— 而且是**静默失效**，不会有任何报错。
//
// 为什么还是这么写了：因为 API 没有给这三个数字提供结构化字段
// （没有 header、没有 error.details）。只能从文案里抠。
// 这也是为什么上面 385 行的注释说「这个 400 现在根本不该发生了」——
// 新机制用 stop_reason 替代了它，这段代码是给老网关留的后路。
export function parseMaxTokensContextOverflowError(error: APIError):
  | {
      inputTokens: number
      maxTokens: number
      contextLimit: number
    }
  | undefined {
// 三道闸门，缺一不可：状态码必须是 400、必须有 message、
// message 里必须含那句特征串。先便宜后贵，避免每次错误都跑正则。
  if (error.status !== 400 || !error.message) {
    return undefined
  }

  if (
    !error.message.includes(
      'input length and `max_tokens` exceed context limit',
    )
  ) {
    return undefined
  }

  // Example format: "input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000"
  const regex =
    /input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)/
  const match = error.message.match(regex)

  if (!match || match.length !== 4) {
    return undefined
  }

  if (!match[1] || !match[2] || !match[3]) {
    logError(
      new Error(
        'Unable to parse max_tokens from max_tokens exceed context limit error message',
      ),
    )
    return undefined
  }
  const inputTokens = parseInt(match[1], 10)
  const maxTokens = parseInt(match[2], 10)
  const contextLimit = parseInt(match[3], 10)

// parseInt 之后还要防 NaN。理论上正则已经保证是数字了
// （`\d+`），但防御性检查在这里是必要的——
// 因为如果哪天有人把正则放宽成 `(\S+)`，NaN 会一路传下去，
// 变成 max_tokens = NaN 发给 API，错误会变得完全不可理解。
  if (isNaN(inputTokens) || isNaN(maxTokens) || isNaN(contextLimit)) {
    return undefined
  }

  return { inputTokens, maxTokens, contextLimit }
}

// ═══ 快模式被拒绝的识别 ═══
//
// ⚠ 这个函数有一个作者自己标注的 TODO，而且说得很直白：
//
//   "String-matching the error message is fragile and will break
//    if the API wording changes."
//
// 靠字符串 'Fast mode is not enabled' 判断「组织没开快模式」。
// 正确的做法是服务端给一个专用响应头（比如 x-fast-mode-rejected），
// 但那个头还不存在。
//
// 三个「靠文案判断」的地方在这份源码里都很显眼：
//   · 这里（快模式拒绝）
//   · 行 550（上下文溢出，改用正则抠数字）
//   · 行 619（overloaded_error，因为流式时状态码会丢）
// 三个都是同一类妥协：**协议没提供结构化信息时，只能读自然语言。
// TODO: Replace with a response header check once the API adds a dedicated
// header for fast-mode rejection (e.g., x-fast-mode-rejected). String-matching
// the error message is fragile and will break if the API wording changes.
function isFastModeNotEnabledError(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false
  }
  return (
    error.status === 400 &&
    (error.message?.includes('Fast mode is not enabled') ?? false)
  )
}

// ═══ is529Error ═══
//
// 注意它有两个判据，第二个（看 message 里有没有 overloaded_error）
// 不是冗余 —— 注释和 719 行都说明了原因：
//
//     SDK 在**流式**响应里有时传不出 529 状态码，status 是空的，
//     只有 body 里的 error type 能认出来。
//
// 这就是为什么 claude.ts 里那么多地方调 is529Error 而不是直接判 status。
// 一个跨层的事实：状态码在流式路径上不可靠。
export function is529Error(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false
  }

  // Check for 529 status code or overloaded error in message
  return (
    error.status === 529 ||
    // See below: the SDK sometimes fails to properly pass the 529 status code during streaming
    (error.message?.includes('"type":"overloaded_error"') ?? false)
  )
}

// ═══ 四家认证错误的识别（623-694）═══
//
// 这段代码存在的唯一理由是：**认证失败时，凭证缓存是脏的**。
// 只重试不清缓存 = 拿着同一个过期 token 再试 10 次，全是 401。
//
// 四家的错误形态完全不同，所以识别逻辑也完全不同：
//
//   第一方 401        APIError.status === 401
//   第一方 403 revoked APIError + message 含 'OAuth token has been revoked'
//   Bedrock           SDK 层的 CredentialsProviderError，或 403
//   Vertex            google-auth-library 的**裸 Error**（没有类型名！），或 401
//
// 下面每一个函数都在做同一件事：把「各家 SDK 五花八门的失败形态」
// 归一成「是不是认证问题」。
function isOAuthTokenRevokedError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    error.status === 403 &&
    (error.message?.includes('OAuth token has been revoked') ?? false)
  )
}

// Bedrock 有两种失败形态，注释把区别说清楚了：
//   · .aws 文件里是过期凭证 → AWS SDK **不发请求**就直接拒（CredentialsProviderError）
//   · 发出去之后服务端拒   → 普通 403，message 是
//                             "The security token included in the request is invalid"
//
// 第一种特别坑：它根本不产生网络请求，所以日志里看不到任何 HTTP 痕迹，
// 看起来像「请求凭空消失了」。
function isBedrockAuthError(error: unknown): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) {
    // AWS libs reject without an API call if .aws holds a past Expiration value
    // otherwise, API calls that receive expired tokens give generic 403
    // "The security token included in the request is invalid"
    if (
      isAwsCredentialsProviderError(error) ||
      (error instanceof APIError && error.status === 403)
    ) {
      return true
    }
  }
  return false
}

/**
 * Clear AWS auth caches if appropriate.
 * @returns true if action was taken.
 */
function handleAwsCredentialError(error: unknown): boolean {
  if (isBedrockAuthError(error)) {
    clearAwsCredentialsCache()
    return true
  }
  return false
}

// ⚠ 注释点出了 Vertex 比 Bedrock 恶心的地方：
//
//     "google-auth-library throws plain Error (no typed name like AWS's
//      CredentialsProviderError)"
//
// AWS 至少给了一个带名字的错误类型可以 instanceof。Google 的库
// 直接 throw new Error('Could not load the default credentials')，
// 和其他任何普通错误无法区分 —— 只能匹配消息文案。
//
// 三个特征串覆盖三种常见失败：
//   Could not load the default credentials   没配凭证
//   Could not refresh access token           刷新失败
//   invalid_grant                            refresh token 被吊销
// google-auth-library throws plain Error (no typed name like AWS's
// CredentialsProviderError). Match common SDK-level credential-failure messages.
function isGoogleAuthLibraryCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message
  return (
    msg.includes('Could not load the default credentials') ||
    msg.includes('Could not refresh access token') ||
    msg.includes('invalid_grant')
  )
}

function isVertexAuthError(error: unknown): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)) {
    // SDK-level: google-auth-library fails in prepareOptions() before the HTTP call
    if (isGoogleAuthLibraryCredentialError(error)) {
      return true
    }
    // Server-side: Vertex returns 401 for expired/invalid tokens
    if (error instanceof APIError && error.status === 401) {
      return true
    }
  }
  return false
}

/**
 * Clear GCP auth caches if appropriate.
 * @returns true if action was taken.
 */
function handleGcpCredentialError(error: unknown): boolean {
  if (isVertexAuthError(error)) {
    clearGcpCredentialsCache()
    return true
  }
  return false
}

// ═══════════════════════════════════════════════════════════════
// shouldRetry —— 「这个错误值不值得再试一次」
//
// 这是全文件最该先读的函数：它定义了「可重试」的边界，主循环只是执行者。
//
// 决策树的顺序**不可调整**，因为后面的判据会被前面的否决。按优先级：
//
//   1. 测试用假错误             → 永不重试（否则 /mock-limits 停不下来）
//   2. persistent + 429/529     → 一律重试（绕过一切门禁，含服务端 header）
//   3. CCR 远程 + 401/403       → 重试（架构保证 key 是好的，只是抖动）
//   4. message 含 overloaded    → 重试（流式丢状态码的兜底）
//   5. 可修的上下文溢出 400      → 重试（参数会改）
//   6. x-should-retry: true     → 重试，但订阅用户除外（他们的 true 意味着「几小时后」）
//   7. x-should-retry: false    → 不重试，唯一例外是 ant + 5xx
//   8. 连接错误（无状态码）      → 重试
//   9. 具体状态码：408 / 409 / 429 / 401 / 403revoked / 5xx
//  10. 其余                     → 不重试
//
// 为什么 6、7 必须排在 9 之前：服务端的显式指令优先于我们对状态码的猜测。
// 一个 500 配 x-should-retry: false，说明服务端知道重试没用（是确定性 bug）。
function shouldRetry(error: APIError): boolean {
// 第一条就是测试专用：/mock-limits 造的假 429 必须**立刻**失败，
// 否则测试会被自己的重试逻辑拖住，永远测不完。
  // Never retry mock errors - they're from /mock-limits command for testing
  if (isMockRateLimitError(error)) {
    return false
  }

// persistent 模式的「超级通行证」：连服务端的 x-should-retry 都不看。
// 理由是场景不同 —— 无人值守任务的目标是「最终跑完」，
// 服务端说「别重试」通常是对交互式会话的建议。
// 注意它仍然只对 429/529 生效，其他错误照常走下面的判断。
  // Persistent mode: 429/529 always retryable, bypass subscriber gates and
  // x-should-retry header.
  if (isPersistentRetryEnabled() && isTransientCapacityError(error)) {
    return true
  }

// ⚠ CCR（远程容器）模式下的 401/403 语义完全不同，这段注释值得逐字读：
//
//     "auth is via infrastructure-provided JWTs, so a 401/403 is a
//      transient blip (auth service flap, network hiccup) rather than
//      bad credentials."
//
// 关键那半句："the server assumes we'd retry the same bad key,
// but our key is fine" —— 服务端认为「你都 401 了还重试同一个坏 key，
// 没意义」，所以发 x-should-retry: false；但我们的 key 是基础设施注入的，
// 坏不了，所以那个 false 是**基于错误前提**的建议，可以无视。
//
// 这是一个「同一个状态码在不同部署形态下含义不同」的典型例子。
  // CCR mode: auth is via infrastructure-provided JWTs, so a 401/403 is a
  // transient blip (auth service flap, network hiccup) rather than bad
  // credentials. Bypass x-should-retry:false — the server assumes we'd retry
  // the same bad key, but our key is fine.
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    (error.status === 401 || error.status === 403)
  ) {
    return true
  }

// overloaded_error 的文本匹配放在状态码判断**之前**，
// 因为流式情况下 status 是空的（见 610 行注释）——
// 只靠状态码会漏掉最常见的那种过载。
  // Check for overloaded errors first by examining the message content
  // The SDK sometimes fails to properly pass the 529 status code during streaming,
  // so we need to check the error message directly
  if (error.message?.includes('"type":"overloaded_error"')) {
    return true
  }

// 能修的 400 才是可重试的 400。判据就是那个正则能不能解析出三个数字。
// 其他 400（参数错、格式错）重试一万次也一样。
  // Check for max tokens context overflow errors that we can handle
  if (parseMaxTokensContextOverflowError(error)) {
    return true
  }

// ═══ 服务端的显式指令 ═══
//
// x-should-retry 不是标准头（注释也说了 "not a standard header"），
// 是 Anthropic API 自己加的。
//
// true 的处理里那个例外非常微妙，值得单独记：
//
//     "For Max and Pro users, should-retry is true, but in several hours,
//      so we shouldn't."
//
// 订阅用户的 429 是**配额窗口**（几小时）造成的，服务端说「可以重试」
// 在法律上正确，但在实践上意味着「几小时后再来」。本地重试毫无意义。
// 而企业用户是 PAYG 计费，429 只是瞬时速率限制，重试有意义。
//
// 「同一个 header 值，对不同付费形态的用户含义不同」—— 这个信息
// header 里没有，只能靠 isClaudeAISubscriber() / isEnterpriseSubscriber() 补。
  // Note this is not a standard header.
  const shouldRetryHeader = error.headers?.get('x-should-retry')

  // If the server explicitly says whether or not to retry, obey.
  // For Max and Pro users, should-retry is true, but in several hours, so we shouldn't.
  // Enterprise users can retry because they typically use PAYG instead of rate limits.
  if (
    shouldRetryHeader === 'true' &&
    (!isClaudeAISubscriber() || isEnterpriseSubscriber())
  ) {
    return true
  }

// false 的处理唯一例外：ant 内部 + 5xx。
// 理由大概是「5xx 是我们自己的服务出错，值得再试一次」，
// 而 401/400/429 这些 false 是可信的。
  // Ants can ignore x-should-retry: false for 5xx server errors only.
  // For other status codes (401, 403, 400, 429, etc.), respect the header.
  if (shouldRetryHeader === 'false') {
    const is5xxError = error.status !== undefined && error.status >= 500
    if (!(process.env.USER_TYPE === 'ant' && is5xxError)) {
      return false
    }
  }

// APIConnectionError 通常**没有 status**（连接都没建立起来）。
// 所以它必须排在 `if (!error.status) return false` 之前 ——
// 否则所有网络错误都会被判成不可重试，这是最容易写错的地方。
  if (error instanceof APIConnectionError) {
    return true
  }

// 到这里还没有状态码 = 不是 HTTP 层的错误，也没有被上面任何规则接住。
// 保守选择：不重试。
  if (!error.status) return false

// 408 请求超时、409 锁冲突 —— 这两个是「等一下再来真的会好」的经典状态码。
  // Retry on request timeouts.
  if (error.status === 408) return true

  // Retry on lock timeouts.
  if (error.status === 409) return true

// 429 对订阅用户不重试，和 737 行是同一个逻辑的另一半：
// 订阅者的限流是配额窗口，不是速率限制。企业用户（PAYG）才重试。
// 注意这里用的是同一个表达式 `!isClaudeAISubscriber() || isEnterpriseSubscriber()`，
// 说明这个「谁能重试 429」的判据在两处必须保持一致。
  // Retry on rate limits, but not for ClaudeAI Subscription users
  // Enterprise users can retry because they typically use PAYG instead of rate limits
  if (error.status === 429) {
    return !isClaudeAISubscriber() || isEnterpriseSubscriber()
  }

// 401 的处理有副作用：清掉 apiKeyHelper 的缓存。
// 因为 apiKeyHelper 是一个「外部命令取 key」的机制（比如从密钥管理器读），
// 它缓存了结果；401 说明缓存的那个 key 已经失效，必须清掉重取。
//
// 注意注释的边界说明：OAuth 的刷新不在这里做，
// 而是在主循环里（行 240）—— 因为刷新是异步的，而 shouldRetry 是同步纯判断。
// 「纯判断函数不产生异步副作用」这条边界守得很干净。
  // Clear API key cache on 401 and allow retry.
  // OAuth token handling is done in the main retry loop via handleOAuth401Error.
  if (error.status === 401) {
    clearApiKeyHelperCache()
    return true
  }

  // Retry on 403 "token revoked" (same refresh logic as 401, see above)
  if (isOAuthTokenRevokedError(error)) {
    return true
  }

// 5xx 一律重试。这是最后一条，也是兜底最宽的一条。
// 注意它用 `error.status && error.status >= 500` 而不是直接 `>= 500`，
// 因为 status 可能是 undefined（TS 也要求先判）。
  // Retry internal errors.
  if (error.status && error.status >= 500) return true

  return false
}

// ═══ 次数配置 ═══
//
// 两层：调用方显式传 > 环境变量 > 默认 10。
// getMaxRetries 用 `??` 而不是 `||`，因为 **0 是合法值** ——
// claude.ts 就传 0（它自己管重试，不想 SDK 再来一层）。
export function getDefaultMaxRetries(): number {
  if (process.env.CLAUDE_CODE_MAX_RETRIES) {
    return parseInt(process.env.CLAUDE_CODE_MAX_RETRIES, 10)
  }
  return DEFAULT_MAX_RETRIES
}
function getMaxRetries(options: RetryOptions): number {
  return options.maxRetries ?? getDefaultMaxRetries()
}

// 快模式冷却的三个时间常量，配合行 284 的逻辑看：
//
//   DEFAULT_FAST_MODE_FALLBACK_HOLD_MS = 30min  服务端没说多久时，冷却 30 分钟
//   SHORT_RETRY_THRESHOLD_MS = 20s              小于这个就原地等，不切档
//   MIN_COOLDOWN_MS = 10min                     切档后至少 10 分钟不切回来
//
// 三个数字合起来是一条「防抖曲线」：短等待忍着，长等待切档，切了就稳住。
const DEFAULT_FAST_MODE_FALLBACK_HOLD_MS = 30 * 60 * 1000 // 30 minutes
const SHORT_RETRY_THRESHOLD_MS = 20 * 1000 // 20 seconds
const MIN_COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes

// 这两个函数是「从错误里读出时间信息」的两种来源：
//   getRetryAfterMs        读 retry-after（相对秒数）
//   getRateLimitResetDelayMs 读配额重置时间戳（绝对 unix 秒）
//
// 后者只用于 persistent + 429 分支（行 437），因为只有配额窗口类
// 限流才会带那个头。它自己也算了一次 Math.min(delayMs, PERSISTENT_RESET_CAP_MS)，
// 和调用方的 cap 重复了 —— 双重保险，不算问题但可以记一笔。
function getRetryAfterMs(error: APIError): number | null {
  const retryAfter = getRetryAfter(error)
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }
  return null
}

// 三个细节：
//   1. `headers?.get?.()` 的双问号 —— 和 519 行同一个原因（两种 headers 形态）
//   2. `Number.isFinite` 而不是 isNaN —— 同时挡掉 Infinity
//   3. `delayMs <= 0` 返回 null —— 已经过了重置时间，别返回负数给 sleep
//
// 返回 null 的语义是「这个 header 没用，走指数退避吧」，不是「无限等」。
function getRateLimitResetDelayMs(error: APIError): number | null {
  const resetHeader = error.headers?.get?.('anthropic-ratelimit-unified-reset')
  if (!resetHeader) return null
  const resetUnixSec = Number(resetHeader)
  if (!Number.isFinite(resetUnixSec)) return null
  const delayMs = resetUnixSec * 1000 - Date.now()
  if (delayMs <= 0) return null
  return Math.min(delayMs, PERSISTENT_RESET_CAP_MS)
}
