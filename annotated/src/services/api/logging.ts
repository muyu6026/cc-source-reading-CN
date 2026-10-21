// ═══════════════════════════════════════════════════════════════
//  api/logging：一次请求的「出生证明」
// ═══════════════════════════════════════════════════════════════
//
//  788 行，全部是埋点。三个出口：
//
//      logAPIQuery               请求**发出前**：用了什么模型、多少条消息、开了哪些 beta
//      logAPIError               失败：错误分类 + 网关识别 + 耗时 + 第几次重试
//      logAPISuccess             成功：token 用量、缓存命中、首字延迟、成本
//
//  这个文件没有业务逻辑，但它记录的东西决定了「出问题时能不能定位」。
//  所以值得读的不是代码，是**它选择记录哪些字段** —— 每一组字段背后
//  都对应一类曾经发生过的问题。
import { feature } from 'bun:bundle'
import { APIError } from '@anthropic-ai/sdk'
import type {
  BetaStopReason,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  addToTotalDurationState,
  consumePostCompaction,
  getIsNonInteractiveSession,
  getLastApiCompletionTimestamp,
  getTeleportedSessionInfo,
  markFirstTeleportMessageLogged,
  setLastApiCompletionTimestamp,
} from 'src/bootstrap/state.js'
import type { QueryChainTracking } from 'src/Tool.js'
import { isConnectorTextBlock } from 'src/types/connectorText.js'
import type { AssistantMessage } from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import type { EffortLevel } from 'src/utils/effort.js'
import { logError } from 'src/utils/log.js'
import { getAPIProviderForStatsig } from 'src/utils/model/providers.js'
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { logOTelEvent } from 'src/utils/telemetry/events.js'
import {
  endLLMRequestSpan,
  isBetaTracingEnabled,
  type Span,
} from 'src/utils/telemetry/sessionTracing.js'
import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'
import { consumeInvokingRequestId } from '../../utils/agentContext.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../analytics/metadata.js'
import { EMPTY_USAGE } from './emptyUsage.js'
import { classifyAPIError } from './errors.js'
import { extractConnectionErrorDetails } from './errorUtils.js'

export type { NonNullableUsage }
export { EMPTY_USAGE }

// Strategy used for global prompt caching
export type GlobalCacheStrategy = 'tool_based' | 'system_prompt' | 'none'

// 【又一个「从嵌套里挖 message」的函数】
//
//  这个形状在 errorUtils.ts 里已经见过一次（extractNestedErrorMessage，那里
//  处理的是 JSONL 读回来的两层 error）。这里的注释甚至明说了：
//
//      See also: getErrorMessage in logging.ts which handles the same shapes.
//
//  也就是说**同一套形状解析存在两份实现**，而且互相知道对方存在。
//
//  为什么没合并？因为两份的容错程度不同：
//
//      这个版本          只处理 APIError 的一层 error.error.message
//      errorUtils 版本   处理两层 + HTML 清洗 + 空值兜底
//
//  合并会把 errorUtils 那一堆兜底带到埋点路径上，而埋点只需要「尽量拿个
//  能读的字符串」。**相似但不相同的代码，往往是因为可靠性要求不同。**
//
//  判据：看到两份相似实现，先比较它们的「失败时会怎样」，再决定要不要合。
function getErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    const body = error.error as { error?: { message?: string } } | undefined
    if (body?.error?.message) return body.error.message
  }
  return error instanceof Error ? error.message : String(error)
}

type KnownGateway =
  | 'litellm'
  | 'helicone'
  | 'portkey'
  | 'cloudflare-ai-gateway'
  | 'kong'
  | 'braintrust'
  | 'databricks'

// Gateway fingerprints for detecting AI gateways from response headers
// 【七个 AI 网关，靠响应头前缀识别】
//
//      litellm                x-litellm-
//      helicone               helicone-
//      portkey                x-portkey-
//      cloudflare-ai-gateway  cf-aig-
//      kong                   x-kong-
//      braintrust             x-bt-
//      （databricks 走域名，见下一个常量）
//
//  注释里每一条都配了官方文档链接。这在这个仓库里是个好习惯：
//  **「这个魔法字符串是哪来的」有据可查**，不用去翻别人的 SDK。
//
//  为什么要识别网关？因为企业用户经常在中间加一层网关，而网关会改变行为：
//
//      它可能重写错误信息 → 我们的文案匹配全部失效
//      它可能自己重试     → 我们看到的耗时和 attempt 就不准
//      它可能截断流       → 流式解析报错
//
//  所以埋点里带上「走的哪个网关」，出现上面这些症状时第一眼就能归因。
//
//  顺带注意这个类型是 Partial<Record<KnownGateway, ...>> —— 因为不是每个
//  网关都有可识别的前缀（databricks 就没有），用 Partial 表达「可以缺」。
const GATEWAY_FINGERPRINTS: Partial<
  Record<KnownGateway, { prefixes: string[] }>
> = {
  // https://docs.litellm.ai/docs/proxy/response_headers
  litellm: {
    prefixes: ['x-litellm-'],
  },
  // https://docs.helicone.ai/helicone-headers/header-directory
  helicone: {
    prefixes: ['helicone-'],
  },
  // https://portkey.ai/docs/api-reference/response-schema
  portkey: {
    prefixes: ['x-portkey-'],
  },
  // https://developers.cloudflare.com/ai-gateway/evaluations/add-human-feedback-api/
  'cloudflare-ai-gateway': {
    prefixes: ['cf-aig-'],
  },
  // https://developer.konghq.com/ai-gateway/ — X-Kong-Upstream-Latency, X-Kong-Proxy-Latency
  kong: {
    prefixes: ['x-kong-'],
  },
  // https://www.braintrust.dev/docs/guides/proxy — x-bt-used-endpoint, x-bt-cached
  braintrust: {
    prefixes: ['x-bt-'],
  },
}

// Gateways that use provider-owned domains (not self-hosted), so the
// ANTHROPIC_BASE_URL hostname is a reliable signal even without a
// distinctive response header.
// 【databricks 单独走域名匹配 —— 注释解释了原因】
//
//  原文：Gateways that use provider-owned domains (not self-hosted), so the
//  ANTHROPIC_BASE_URL hostname is a reliable signal even without a
//  distinctive response header.
//
//  翻译：其他网关是**用户自己部署**的（所以域名千奇百怪，只能看响应头）；
//  而 databricks 是厂商托管的，域名固定在 *.cloud.databricks.com 这类后缀上，
//  所以域名本身就是一个可靠信号。
//
//  这是一个「同一种识别任务，两种手段」的例子：
//
//      自托管  →  看行为特征（响应头）
//      托管    →  看身份特征（域名）
//
//  用 suffixes 而不是精确域名，是为了覆盖多区域多云的变体
//  （aws / azure / gcp 三套）。
const GATEWAY_HOST_SUFFIXES: Partial<Record<KnownGateway, string[]>> = {
  // https://docs.databricks.com/aws/en/ai-gateway/
  databricks: [
    '.cloud.databricks.com',
    '.azuredatabricks.net',
    '.gcp.databricks.com',
  ],
}

// 【先看头、再看域名，顺序不能反】
//
//  为什么头优先？因为头是**这次请求实际发生的证据**，而 baseUrl 只是配置。
//  用户可能配了 baseUrl 但中间又套了一层网关（那层的头会出现），
//  这时头才是真相。
//
//  实现上有两个细节：
//
//  1. 先把 headerNames 收集成数组，而不是在 forEach 里直接判断
//     —— 因为要「对每个网关，检查是否存在任一前缀匹配的头」，
//        嵌套两层 some，用数组最直观
//  2. new URL(baseUrl) 包在 try 里，注释写着 malformed URL — ignore
//     —— 用户手写错的 baseUrl 不该让埋点崩掉
//
//  第 115 行的注释也值得注意：Header names are already lowercase from the
//  Headers API。**依赖标准库已经做过的规范化，不要再 toLowerCase 一次** ——
//  这是读代码时常见的「多余的防御」，认出来能省一次困惑。
function detectGateway({
  headers,
  baseUrl,
}: {
  headers?: globalThis.Headers
  baseUrl?: string
}): KnownGateway | undefined {
  if (headers) {
    // Header names are already lowercase from the Headers API
    const headerNames: string[] = []
    headers.forEach((_, key) => headerNames.push(key))
    for (const [gw, { prefixes }] of Object.entries(GATEWAY_FINGERPRINTS)) {
      if (prefixes.some(p => headerNames.some(h => h.startsWith(p)))) {
        return gw as KnownGateway
      }
    }
  }

  if (baseUrl) {
    try {
      const host = new URL(baseUrl).hostname.toLowerCase()
      for (const [gw, suffixes] of Object.entries(GATEWAY_HOST_SUFFIXES)) {
        if (suffixes.some(s => host.endsWith(s))) {
          return gw as KnownGateway
        }
      }
    } catch {
      // malformed URL — ignore
    }
  }

  return undefined
}

// 【这个函数的返回类型里有三个一模一样的 as —— 那个类型名是重点】
//
//      AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
//
//  这是一个**把代码审查要求写进类型名**的做法。意思是：把值传给埋点时，
//  你必须人工确认「这不是源码内容、也不是文件路径」。
//
//  为什么？因为埋点会上报到第三方（Statsig / Datadog），而源码内容和
//  用户文件路径属于绝对不能外流的东西。类型系统没法自动判断一个 string
//  是不是路径，所以只能用一个超长的类型名强迫写代码的人停下来想一秒。
//
//  这是一种「用命名做 lint」的技巧，在无法自动校验的地方很有效。
//  同类做法还有 analytics 目录里的 `_I_VERIFIED` 系列。
//
//  注意它包了三个环境变量：BASE_URL / MODEL / SMALL_FAST_MODEL。
//  这三个是「用户自定配置里最可能出问题」的三个 —— 配错了模型名、
//  指错了网关，第一眼就该在埋点里看见。
function getAnthropicEnvMetadata() {
  return {
    ...(process.env.ANTHROPIC_BASE_URL
      ? {
          baseUrl: process.env
            .ANTHROPIC_BASE_URL as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(process.env.ANTHROPIC_MODEL
      ? {
          envModel: process.env
            .ANTHROPIC_MODEL as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(process.env.ANTHROPIC_SMALL_FAST_MODEL
      ? {
          envSmallFastModel: process.env
            .ANTHROPIC_SMALL_FAST_MODEL as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
  }
}

// 【埋点里带「这个构建有多旧了」—— 用来区分问题来源】
//
//      Math.floor((Date.now() - new Date(MACRO.BUILD_TIME).getTime()) / 60000)
//
//  MACRO.BUILD_TIME 是构建期注入的时间戳（打包时替换的字面量）。
//  所以这个字段的意思是：用户跑的这版二进制，编译出来多少分钟了。
//
//  为什么有用？因为一个「刚发版 5 分钟就报错」和「跑了 3 个月的旧版报错」
//  是完全不同的问题：
//
//      很小    →  很可能是这次发布引入的
//      很大    →  用户长期没升级，问题可能早就修了
//
//  没有这个字段，看板上的错误率就分不清「新 bug」和「旧版长尾」。
//
//  两个防御：MACRO.BUILD_TIME 可能为空（开发环境），日期可能非法 ——
//  所以返回类型是 number | undefined，而不是硬算一个 NaN 出去。
//  **NaN 进埋点会污染聚合（平均值变 NaN），所以宁可缺字段。**
function getBuildAgeMinutes(): number | undefined {
  if (!MACRO.BUILD_TIME) return undefined
  const buildTime = new Date(MACRO.BUILD_TIME).getTime()
  if (isNaN(buildTime)) return undefined
  return Math.floor((Date.now() - buildTime) / 60000)
}

export function logAPIQuery({
  model,
  messagesLength,
  temperature,
  betas,
  permissionMode,
  querySource,
  queryTracking,
  thinkingType,
  effortValue,
  fastMode,
  previousRequestId,
}: {
  model: string
  messagesLength: number
  temperature: number
  betas?: string[]
  permissionMode?: PermissionMode
  querySource: string
  queryTracking?: QueryChainTracking
  thinkingType?: 'adaptive' | 'enabled' | 'disabled'
  effortValue?: EffortLevel | null
  fastMode?: boolean
  previousRequestId?: string | null
}): void {
  logEvent('tengu_api_query', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    messagesLength,
    temperature: temperature,
    provider: getAPIProviderForStatsig(),
    buildAgeMins: getBuildAgeMinutes(),
    ...(betas?.length
      ? {
          betas: betas.join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    permissionMode:
      permissionMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(queryTracking
      ? {
          queryChainId:
            queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: queryTracking.depth,
        }
      : {}),
    thinkingType:
      thinkingType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    effortValue:
      effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    fastMode,
    ...(previousRequestId
      ? {
          previousRequestId:
            previousRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...getAnthropicEnvMetadata(),
  })
}

// 【错误埋点的参数列表有 17 个 —— 每一个都对应一类问题】
//
//  按用途分组看：
//
//      定位是哪次请求   requestId / clientRequestId / previousRequestId
//      规模            model / messageCount / messageTokens
//      耗时            durationMs（本次） / durationMsIncludingRetries（含重试）
//      第几次          attempt
//      走了哪条路      didFallBackToNonStreaming（流式失败了降级成非流式？）
//      谁在用          promptCategory / querySource / fastMode / queryTracking
//      环境            headers（用于网关识别） / llmSpan（追踪）
//
//  两个字段特别值得说：
//
//  didFallBackToNonStreaming —— 有这个字段说明「流式失败自动降级」是一个
//  真实存在的路径。所以看到非流式响应不一定是用户没要流式。
//
//  durationMs 和 durationMsIncludingRetries —— **两个耗时都要记**。
//  只记含重试的，就看不出「单次请求本身慢」和「重试拖长了」的差别。
//
//  判据：耗时的埋点必须成对（本次 / 累计），否则数据没法归因。
export function logAPIError({
  error,
  model,
  messageCount,
  messageTokens,
  durationMs,
  durationMsIncludingRetries,
  attempt,
  requestId,
  clientRequestId,
  didFallBackToNonStreaming,
  promptCategory,
  headers,
  queryTracking,
  querySource,
  llmSpan,
  fastMode,
  previousRequestId,
}: {
  error: unknown
  model: string
  messageCount: number
  messageTokens?: number
  durationMs: number
  durationMsIncludingRetries: number
  attempt: number
  requestId?: string | null
  /** Client-generated ID sent as x-client-request-id header (survives timeouts) */
  clientRequestId?: string
// 【那行 JSDoc 解释了为什么需要客户端自己造一个 ID】
//
//  服务端会返回 request-id，但**超时的时候没有响应**，所以拿不到。
//  而超时恰恰是最需要查日志的场景。
//
//  所以客户端在发请求前自己生成一个 UUID 塞进头里（见 client.ts 的
//  buildFetch），这样即使请求超时，服务端日志里也能按这个 ID 找到它。
//
//  第 296 行那句调试日志把用途写全了：
//
//      API error x-client-request-id=... (give this to the API team
//      for server-log lookup)
//
//  **一个可观测性设计是否完整，就看「最坏情况（超时）下还能不能定位」。**
  didFallBackToNonStreaming?: boolean
  promptCategory?: string
  headers?: globalThis.Headers
  queryTracking?: QueryChainTracking
  querySource?: string
  /** The span from startLLMRequestSpan - pass this to correctly match responses to requests */
  llmSpan?: Span
  fastMode?: boolean
  previousRequestId?: string | null
}): void {
  const gateway = detectGateway({
    headers:
      error instanceof APIError && error.headers ? error.headers : headers,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
  })

  const errStr = getErrorMessage(error)
  const status = error instanceof APIError ? String(error.status) : undefined
  const errorType = classifyAPIError(error)

  // Log detailed connection error info to debug logs (visible via --debug)
  const connectionDetails = extractConnectionErrorDetails(error)
  if (connectionDetails) {
    const sslLabel = connectionDetails.isSSLError ? ' (SSL error)' : ''
    logForDebugging(
      `Connection error details: code=${connectionDetails.code}${sslLabel}, message=${connectionDetails.message}`,
      { level: 'error' },
    )
  }

  const invocation = consumeInvokingRequestId()

  if (clientRequestId) {
    logForDebugging(
      `API error x-client-request-id=${clientRequestId} (give this to the API team for server-log lookup)`,
      { level: 'error' },
    )
  }

  logError(error as Error)
  logEvent('tengu_api_error', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error: errStr as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    status:
      status as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    errorType:
      errorType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    messageCount,
    messageTokens,
    durationMs,
    durationMsIncludingRetries,
    attempt,
    provider: getAPIProviderForStatsig(),
    requestId:
      (requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS) ||
      undefined,
    ...(invocation
      ? {
          invokingRequestId:
            invocation.invokingRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          invocationKind:
            invocation.invocationKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    clientRequestId:
      (clientRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS) ||
      undefined,
    didFallBackToNonStreaming,
    ...(promptCategory
      ? {
          promptCategory:
            promptCategory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(gateway
      ? {
          gateway:
            gateway as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(queryTracking
      ? {
          queryChainId:
            queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: queryTracking.depth,
        }
      : {}),
    ...(querySource
      ? {
          querySource:
            querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    fastMode,
    ...(previousRequestId
      ? {
          previousRequestId:
            previousRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...getAnthropicEnvMetadata(),
  })

  // Log API error event for OTLP
  void logOTelEvent('api_error', {
    model: model,
    error: errStr,
    status_code: String(status),
    duration_ms: String(durationMs),
    attempt: String(attempt),
    speed: fastMode ? 'fast' : 'normal',
  })

  // Pass the span to correctly match responses to requests when beta tracing is enabled
  endLLMRequestSpan(llmSpan, {
    success: false,
    statusCode: status ? parseInt(status) : undefined,
    error: errStr,
    attempt,
  })

  // Log first error for teleported sessions (reliability tracking)
  const teleportInfo = getTeleportedSessionInfo()
  if (teleportInfo?.isTeleported && !teleportInfo.hasLoggedFirstMessage) {
    logEvent('tengu_teleport_first_message_error', {
      session_id:
        teleportInfo.sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_type:
        errorType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    markFirstTeleportMessageLogged()
  }
}

// 【logAPISuccess：成功也要记，而且字段比错误更多】
//
//  这个函数是内部函数（没有 export），由下面的 logAPISuccessAndDuration
//  调用。它记的字段里有几个是「只有成功才有意义」的：
//
//      ttftMs                    首字延迟（time to first token）
//      stopReason                为什么停（end_turn / max_tokens / tool_use / refusal）
//      costUSD                   这次花了多少钱
//      usage                     四个 token 桶 + 缓存命中
//      globalCacheStrategy       用的是哪种缓存策略
//      textContentLength / thinkingContentLength / toolUseContentLengths
//                                产出内容的规模
//
//  为什么成功路径的埋点比失败路径还细？因为**成功是绝大多数情况**，
//  成本、延迟、缓存命中率这些指标只有在成功样本上才有统计意义。
//  失败路径记的是「为什么坏」，成功路径记的是「好不好」。
//
//  注意第 457 行那两个时间戳操作：
//
//      const lastCompletion = getLastApiCompletionTimestamp()
//      const timeSinceLastApiCallMs = lastCompletion !== null ? now - lastCompletion : undefined
//      ...
//      setLastApiCompletionTimestamp(now)     // 在函数末尾
//
//  也就是「读旧值 → 算间隔 → 写新值」。**先读后写，顺序不能反**，
//  而且写必须放在最后（否则中途 return 会把时间戳写脏）。
function logAPISuccess({
  model,
  preNormalizedModel,
  messageCount,
  messageTokens,
  usage,
  durationMs,
  durationMsIncludingRetries,
  attempt,
  ttftMs,
  requestId,
  stopReason,
  costUSD,
  didFallBackToNonStreaming,
  querySource,
  gateway,
  queryTracking,
  permissionMode,
  globalCacheStrategy,
  textContentLength,
  thinkingContentLength,
  toolUseContentLengths,
  connectorTextBlockCount,
  fastMode,
  previousRequestId,
  betas,
}: {
  model: string
  preNormalizedModel: string
  messageCount: number
  messageTokens: number
  usage: Usage
  durationMs: number
  durationMsIncludingRetries: number
  attempt: number
  ttftMs: number | null
  requestId: string | null
  stopReason: BetaStopReason | null
  costUSD: number
  didFallBackToNonStreaming: boolean
  querySource: string
  gateway?: KnownGateway
  queryTracking?: QueryChainTracking
  permissionMode?: PermissionMode
  globalCacheStrategy?: GlobalCacheStrategy
  textContentLength?: number
  thinkingContentLength?: number
  toolUseContentLengths?: Record<string, number>
  connectorTextBlockCount?: number
  fastMode?: boolean
  previousRequestId?: string | null
  betas?: string[]
}): void {
  const isNonInteractiveSession = getIsNonInteractiveSession()
  const isPostCompaction = consumePostCompaction()
  const hasPrintFlag =
    process.argv.includes('-p') || process.argv.includes('--print')

  const now = Date.now()
  const lastCompletion = getLastApiCompletionTimestamp()
  const timeSinceLastApiCallMs =
    lastCompletion !== null ? now - lastCompletion : undefined

  const invocation = consumeInvokingRequestId()

  logEvent('tengu_api_success', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(preNormalizedModel !== model
      ? {
          preNormalizedModel:
            preNormalizedModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(betas?.length
      ? {
          betas: betas.join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    messageCount,
    messageTokens,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    uncachedInputTokens: usage.cache_creation_input_tokens ?? 0,
    durationMs: durationMs,
    durationMsIncludingRetries: durationMsIncludingRetries,
    attempt: attempt,
    ttftMs: ttftMs ?? undefined,
    buildAgeMins: getBuildAgeMinutes(),
    provider: getAPIProviderForStatsig(),
    requestId:
      (requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS) ??
      undefined,
    ...(invocation
      ? {
          invokingRequestId:
            invocation.invokingRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          invocationKind:
            invocation.invocationKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    stop_reason:
      (stopReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS) ??
      undefined,
    costUSD,
    didFallBackToNonStreaming,
    isNonInteractiveSession,
    print: hasPrintFlag,
    isTTY: process.stdout.isTTY ?? false,
    querySource:
      querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(gateway
      ? {
          gateway:
            gateway as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(queryTracking
      ? {
          queryChainId:
            queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: queryTracking.depth,
        }
      : {}),
    permissionMode:
      permissionMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(globalCacheStrategy
      ? {
          globalCacheStrategy:
            globalCacheStrategy as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(textContentLength !== undefined
      ? ({
          textContentLength,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      : {}),
    ...(thinkingContentLength !== undefined
      ? ({
          thinkingContentLength,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      : {}),
    ...(toolUseContentLengths !== undefined
      ? ({
          toolUseContentLengths: jsonStringify(
            toolUseContentLengths,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      : {}),
    ...(connectorTextBlockCount !== undefined
      ? ({
          connectorTextBlockCount,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      : {}),
    fastMode,
    // Log cache_deleted_input_tokens for cache editing analysis. Casts needed
    // because the field is intentionally not on NonNullableUsage (excluded from
    // external builds). Set by updateUsage() when cache editing is active.
    ...(feature('CACHED_MICROCOMPACT') &&
    ((usage as unknown as { cache_deleted_input_tokens?: number })
      .cache_deleted_input_tokens ?? 0) > 0
      ? {
          cacheDeletedInputTokens: (
            usage as unknown as { cache_deleted_input_tokens: number }
          ).cache_deleted_input_tokens,
        }
      : {}),
    ...(previousRequestId
      ? {
          previousRequestId:
            previousRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(isPostCompaction ? { isPostCompaction } : {}),
    ...getAnthropicEnvMetadata(),
    timeSinceLastApiCallMs,
  })

  setLastApiCompletionTimestamp(now)
}

// 【对外入口：收 Date 对象，算耗时，再转给内部函数】
//
//  为什么分成两个函数？因为对外接口想收**时间点**（start），而内部函数
//  需要**耗时**（durationMs）。中间这层转换放在这里，好处是：
//
//      - 调用方不用自己算 elapsed（少一处算错的机会）
//      - 内部函数拿到的永远是已经算好的数字（可测试）
//
//  参数里同时有 start 和 startIncludingRetries，加上 llmSpan：
//
//      start                    本次尝试的起点
//      startIncludingRetries    整个重试链的起点
//      llmSpan                  追踪系统的 span
//
//  三者是「一次请求」的三个时间尺度。这也是为什么上面 logAPIError 里
//  也有 durationMs 和 durationMsIncludingRetries 两个字段 —— 一致的。
export function logAPISuccessAndDuration({
  model,
  preNormalizedModel,
  start,
  startIncludingRetries,
  ttftMs,
  usage,
  attempt,
  messageCount,
  messageTokens,
  requestId,
  stopReason,
  didFallBackToNonStreaming,
  querySource,
  headers,
  costUSD,
  queryTracking,
  permissionMode,
  newMessages,
  llmSpan,
  globalCacheStrategy,
  requestSetupMs,
  attemptStartTimes,
  fastMode,
  previousRequestId,
  betas,
}: {
  model: string
  preNormalizedModel: string
  start: number
  startIncludingRetries: number
  ttftMs: number | null
  usage: NonNullableUsage
  attempt: number
  messageCount: number
  messageTokens: number
  requestId: string | null
  stopReason: BetaStopReason | null
  didFallBackToNonStreaming: boolean
  querySource: string
  headers?: globalThis.Headers
  costUSD: number
  queryTracking?: QueryChainTracking
  permissionMode?: PermissionMode
  /** Assistant messages from the response - used to extract model_output and thinking_output
   *  when beta tracing is enabled */
  newMessages?: AssistantMessage[]
  /** The span from startLLMRequestSpan - pass this to correctly match responses to requests */
  llmSpan?: Span
  /** Strategy used for global prompt caching: 'tool_based', 'system_prompt', or 'none' */
  globalCacheStrategy?: GlobalCacheStrategy
  /** Time spent in pre-request setup before the successful attempt */
  requestSetupMs?: number
  /** Timestamps (Date.now()) of each attempt start — used for retry sub-spans in Perfetto */
  attemptStartTimes?: number[]
  fastMode?: boolean
  /** Request ID from the previous API call in this session */
  previousRequestId?: string | null
  betas?: string[]
}): void {
  const gateway = detectGateway({
    headers,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
  })

  let textContentLength: number | undefined
  let thinkingContentLength: number | undefined
  let toolUseContentLengths: Record<string, number> | undefined
  let connectorTextBlockCount: number | undefined

  if (newMessages) {
    let textLen = 0
    let thinkingLen = 0
    let hasToolUse = false
    const toolLengths: Record<string, number> = {}
    let connectorCount = 0

    for (const msg of newMessages) {
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          textLen += block.text.length
        } else if (feature('CONNECTOR_TEXT') && isConnectorTextBlock(block)) {
          connectorCount++
        } else if (block.type === 'thinking') {
          thinkingLen += block.thinking.length
        } else if (
          block.type === 'tool_use' ||
          block.type === 'server_tool_use' ||
          block.type === 'mcp_tool_use'
        ) {
          const inputLen = jsonStringify(block.input).length
          const sanitizedName = sanitizeToolNameForAnalytics(block.name)
          toolLengths[sanitizedName] =
            (toolLengths[sanitizedName] ?? 0) + inputLen
          hasToolUse = true
        }
      }
    }

    textContentLength = textLen
    thinkingContentLength = thinkingLen > 0 ? thinkingLen : undefined
    toolUseContentLengths = hasToolUse ? toolLengths : undefined
    connectorTextBlockCount = connectorCount > 0 ? connectorCount : undefined
  }

  const durationMs = Date.now() - start
  const durationMsIncludingRetries = Date.now() - startIncludingRetries
  addToTotalDurationState(durationMsIncludingRetries, durationMs)

  logAPISuccess({
    model,
    preNormalizedModel,
    messageCount,
    messageTokens,
    usage,
    durationMs,
    durationMsIncludingRetries,
    attempt,
    ttftMs,
    requestId,
    stopReason,
    costUSD,
    didFallBackToNonStreaming,
    querySource,
    gateway,
    queryTracking,
    permissionMode,
    globalCacheStrategy,
    textContentLength,
    thinkingContentLength,
    toolUseContentLengths,
    connectorTextBlockCount,
    fastMode,
    previousRequestId,
    betas,
  })
  // Log API request event for OTLP
  void logOTelEvent('api_request', {
    model,
    input_tokens: String(usage.input_tokens),
    output_tokens: String(usage.output_tokens),
    cache_read_tokens: String(usage.cache_read_input_tokens),
    cache_creation_tokens: String(usage.cache_creation_input_tokens),
    cost_usd: String(costUSD),
    duration_ms: String(durationMs),
    speed: fastMode ? 'fast' : 'normal',
  })

  // Extract model output, thinking output, and tool call flag when beta tracing is enabled
  let modelOutput: string | undefined
  let thinkingOutput: string | undefined
  let hasToolCall: boolean | undefined

  if (isBetaTracingEnabled() && newMessages) {
    // Model output - visible to all users
    modelOutput =
      newMessages
        .flatMap(m =>
          m.message.content
            .filter(c => c.type === 'text')
            .map(c => (c as { type: 'text'; text: string }).text),
        )
        .join('\n') || undefined

    // Thinking output - Ant-only (build-time gated)
    if (process.env.USER_TYPE === 'ant') {
      thinkingOutput =
        newMessages
          .flatMap(m =>
            m.message.content
              .filter(c => c.type === 'thinking')
              .map(c => (c as { type: 'thinking'; thinking: string }).thinking),
          )
          .join('\n') || undefined
    }

    // Check if any tool_use blocks were in the output
    hasToolCall = newMessages.some(m =>
      m.message.content.some(c => c.type === 'tool_use'),
    )
  }

  // Pass the span to correctly match responses to requests when beta tracing is enabled
  endLLMRequestSpan(llmSpan, {
    success: true,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens,
    attempt,
    modelOutput,
    thinkingOutput,
    hasToolCall,
    ttftMs: ttftMs ?? undefined,
    requestSetupMs,
    attemptStartTimes,
  })

  // Log first successful message for teleported sessions (reliability tracking)
  const teleportInfo = getTeleportedSessionInfo()
  if (teleportInfo?.isTeleported && !teleportInfo.hasLoggedFirstMessage) {
    logEvent('tengu_teleport_first_message_success', {
      session_id:
        teleportInfo.sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    markFirstTeleportMessageLogged()
  }
}
