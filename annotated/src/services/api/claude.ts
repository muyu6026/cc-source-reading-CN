// ═══════════════════════════════════════════════════════════════
// 第 5 步 · 主循环 · 4/4 —— API 客户端（src/services/api/claude.ts）
//
// 前面三个文件在「组装请求」和「消费响应」：
//   prompts.ts     → 决定发给模型什么文字
//   query.ts       → 决定一轮一轮怎么跑
//   QueryEngine.ts → 决定对外的消息长什么样
// 这个文件负责**中间那一段字节流**：把参数变成 HTTP 请求，把 SSE 事件变成
// AssistantMessage，中间夹着重试、超时、缓存、降级。
//
// 【它有多长，为什么这么长】
// 3,419 行，27 个顶层符号。但体重几乎全压在一个函数上：
//
//     queryModel          行 1017 → 2892     1,881 行
//
// 这是整个代码库最长的单个函数。拆开看是五段首尾相接的流程：
//
//     ① 组装（1017-1537）      查开关、拉 betas、滤工具、归一化消息、拼 system
//     ② 参数工厂（1538-1729）  paramsFromContext(重试上下文) → 一次请求的全部参数
//     ③ 发请求（1776-1857）    withRetry 包住，拿到 raw stream
//     ④ 解析流（1932-2403）    for await (part of stream) + 一个大 switch
//     ⑤ 降级与收尾（2404-2892）流挂了 → 非流式重试 → 记日志 → 释放资源
//
// 不要顺序读。先读 ② 和 ④，这两段是「协议本体」；
// ① 是配置拼装（长但没有分支难度），③⑤ 是容错（长且分支密集）。
//
// 【四个贯穿全文件的概念，先记住再往下看】
//
//   ① prompt cache 是第一约束
//      这个文件里几乎每个「看起来奇怪的写法」都在服务同一件事：
//      让两次请求的前缀字节完全一致。sticky-on latch（行 1405）、
//      delta attachment（行 1330）、advisor 工具排在最后（行 1386）、
//      temperature 只在 thinking 关闭时发送（行 1691）——全是这个原因。
//
//   ② 参数必须每次重试重新构造
//      不是「构造一次、重试复用」。paramsFromContext(retryContext) 是工厂函数，
//      withRetry 每个 attempt 调一次，因为重试可能换了模型、改了 max_tokens。
//
//   ③ 流式事件是**碎片**，不是完整消息
//      一个 tool_use 块要经过 content_block_start（给个空壳）→
//      几十个 input_json_delta（片段拼 JSON 字符串）→ content_block_stop（收口）
//      才变成一条完整消息。所以这里有大量「半成品状态」变量。
//
//   ④ 降级路径比正常路径长
//      流式失败 → 非流式重试（行 2534）；流没事件 → 也走非流式（行 2350）；
//      404 → 也走非流式（行 2612）。正常路径约 100 行，其余全是
//      「怎么在坏掉的时候还能出结果」。
// ═══════════════════════════════════════════════════════════════
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageDeltaUsage,
  BetaMessageStreamParams,
  BetaOutputConfig,
  BetaRawMessageStreamEvent,
  BetaRequestDocumentBlock,
  BetaStopReason,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaUsage,
  BetaMessageParam as MessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import { randomUUID } from 'crypto'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import {
  getAttributionHeader,
  getCLISyspromptPrefix,
} from '../../constants/system.js'
import {
  getEmptyToolPermissionContext,
  type QueryChainTracking,
  type Tool,
  type ToolPermissionContext,
  type Tools,
  toolMatchesName,
} from '../../Tool.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import {
  type ConnectorTextBlock,
  type ConnectorTextDelta,
  isConnectorTextBlock,
} from '../../types/connectorText.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../../types/message.js'
import {
  type CacheScope,
  logAPIPrefix,
  splitSysPromptPrefix,
  toolToAPISchema,
} from '../../utils/api.js'
import { getOauthAccountInfo } from '../../utils/auth.js'
import {
  getBedrockExtraBodyParamsBetas,
  getMergedBetas,
  getModelBetas,
} from '../../utils/betas.js'
import { getOrCreateUserID } from '../../utils/config.js'
import {
  CAPPED_DEFAULT_MAX_TOKENS,
  getModelMaxOutputTokens,
  getSonnet1mExpTreatmentEnabled,
} from '../../utils/context.js'
import { resolveAppliedEffort } from '../../utils/effort.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { computeFingerprintFromMessages } from '../../utils/fingerprint.js'
import { captureAPIRequest, logError } from '../../utils/log.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  ensureToolResultPairing,
  normalizeContentFromAPI,
  normalizeMessagesForAPI,
  stripAdvisorBlocks,
  stripCallerFieldFromAssistantMessage,
  stripToolReferenceBlocksFromUserMessage,
} from '../../utils/messages.js'
import {
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getSmallFastModel,
  isNonCustomOpusModel,
} from '../../utils/model/model.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPromptType.js'
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js'
import { getDynamicConfig_BLOCKS_ON_INIT } from '../analytics/growthbook.js'
import {
  currentLimits,
  extractQuotaStatusFromError,
  extractQuotaStatusFromHeaders,
} from '../claudeAiLimits.js'
import { getAPIContextManagement } from '../compact/apiMicrocompact.js'

// 条件导入：feature() 为假时，整个模块不会被打包进来。
//
// 读这段有个顺序陷阱要注意：feature 是从 'bun:bundle' 导入的，但这里在第 105 行
// 就用了，而 import 语句在**第 109 行**才写。能跑是因为 ESM 的 import 声明会被
// 提升（hoist），模块绑定先于语句执行。写代码别学这个顺序，读代码别被它绕进去。
//
// 为什么用 require 而不是 import：import 是静态声明，打包器一定会把模块拉进来；
// require + 三元是唯一能让 bun 的 DCE（死代码消除）整块删掉的写法。
// 这也是全代码库『feature() 只能出现在 if / 三元条件里』这条硬约束的由来——
// 一旦你把 feature() 的结果存进变量，压缩器就不敢删了。
/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null

import { feature } from 'bun:bundle'
import type { ClientOptions } from '@anthropic-ai/sdk'
import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk/error'
import {
  getAfkModeHeaderLatched,
  getCacheEditingHeaderLatched,
  getFastModeHeaderLatched,
  getLastApiCompletionTimestamp,
  getPromptCache1hAllowlist,
  getPromptCache1hEligible,
  getSessionId,
  getThinkingClearLatched,
  setAfkModeHeaderLatched,
  setCacheEditingHeaderLatched,
  setFastModeHeaderLatched,
  setLastMainRequestId,
  setPromptCache1hAllowlist,
  setPromptCache1hEligible,
  setThinkingClearLatched,
} from 'src/bootstrap/state.js'
import {
  AFK_MODE_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  EFFORT_BETA_HEADER,
  FAST_MODE_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  TASK_BUDGETS_BETA_HEADER,
} from 'src/constants/betas.js'
import type { QuerySource } from 'src/constants/querySource.js'
import type { Notification } from 'src/context/notifications.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { AgentId } from 'src/types/ids.js'
import {
  ADVISOR_TOOL_INSTRUCTIONS,
  getExperimentAdvisorModels,
  isAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from 'src/utils/advisor.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { isClaudeAISubscriber } from 'src/utils/auth.js'
import {
  getToolSearchBetaHeader,
  modelSupportsStructuredOutputs,
  shouldIncludeFirstPartyOnlyBetas,
  shouldUseGlobalCacheScope,
} from 'src/utils/betas.js'
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME } from 'src/utils/claudeInChrome/common.js'
import { CHROME_TOOL_SEARCH_INSTRUCTIONS } from 'src/utils/claudeInChrome/prompt.js'
import { getMaxThinkingTokensForModel } from 'src/utils/context.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import { type EffortValue, modelSupportsEffort } from 'src/utils/effort.js'
import {
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from 'src/utils/fastMode.js'
import { returnValue } from 'src/utils/generators.js'
import { headlessProfilerCheckpoint } from 'src/utils/headlessProfiler.js'
import { isMcpInstructionsDeltaEnabled } from 'src/utils/mcpInstructionsDelta.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import { endQueryProfile, queryCheckpoint } from 'src/utils/queryProfiler.js'
import {
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
  type ThinkingConfig,
} from 'src/utils/thinking.js'
import {
  extractDiscoveredToolNames,
  isDeferredToolsDeltaEnabled,
  isToolSearchEnabled,
} from 'src/utils/toolSearch.js'
import { API_MAX_MEDIA_PER_REQUEST } from '../../constants/apiLimits.js'
import { ADVISOR_BETA_HEADER } from '../../constants/betas.js'
import {
  formatDeferredToolLine,
  isDeferredTool,
  TOOL_SEARCH_TOOL_NAME,
} from '../../tools/ToolSearchTool/prompt.js'
import { count } from '../../utils/array.js'
import { insertBlockAfterToolResults } from '../../utils/contentArray.js'
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js'
import { safeParseJSON } from '../../utils/json.js'
import { getInferenceProfileBackingModel } from '../../utils/model/bedrock.js'
import {
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from '../../utils/model/model.js'
import {
  startSessionActivity,
  stopSessionActivity,
} from '../../utils/sessionActivity.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  isBetaTracingEnabled,
  type LLMRequestNewContext,
  startLLMRequestSpan,
} from '../../utils/telemetry/sessionTracing.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  consumePendingCacheEdits,
  getPinnedCacheEdits,
  markToolsSentToAPIState,
  pinCacheEdits,
} from '../compact/microCompact.js'
import { getInitializationStatus } from '../lsp/manager.js'
import { isToolFromMcpServer } from '../mcp/utils.js'
import { withStreamingVCR, withVCR } from '../vcr.js'
import { CLIENT_REQUEST_ID_HEADER, getAnthropicClient } from './client.js'
import {
  API_ERROR_MESSAGE_PREFIX,
  CUSTOM_OFF_SWITCH_MESSAGE,
  getAssistantMessageFromError,
  getErrorMessageIfRefusal,
} from './errors.js'
import {
  EMPTY_USAGE,
  type GlobalCacheStrategy,
  logAPIError,
  logAPIQuery,
  logAPISuccessAndDuration,
  type NonNullableUsage,
} from './logging.js'
import {
  CACHE_TTL_1HOUR_MS,
  checkResponseForCacheBreak,
  recordPromptState,
} from './promptCacheBreakDetection.js'
import {
  CannotRetryError,
  FallbackTriggeredError,
  is529Error,
  type RetryContext,
  withRetry,
} from './withRetry.js'

// Define a type that represents valid JSON values
// 一个极简的 JSON 值类型。用递归类型别名而不是 unknown，
// 是因为 getExtraBodyParams 的返回值要被展开进请求体（...extraBodyParams），
// 用 unknown 会让整个展开处报类型错误。
type JsonValue = string | number | boolean | null | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]

/**
 * Assemble the extra body parameters for the API request, based on the
 * CLAUDE_CODE_EXTRA_BODY environment variable if present and on any beta
 * headers (primarily for Bedrock requests).
 *
 * @param betaHeaders - An array of beta headers to include in the request.
 * @returns A JSON object representing the extra body parameters.
 */
// ── getExtraBodyParams ──
// 把「用户环境变量 + beta 头」翻译成要展开进请求体的键值对。
// 名字叫 extra，实际承担三件事：
//   1. 让用户可以任意注入请求体字段（调试/接入第三方网关的主要口子）
//   2. 内测功能（anti_distillation）
//   3. Bedrock 的 beta 头必须放在 body 里而不是 HTTP 头（见行 1549）
export function getExtraBodyParams(betaHeaders?: string[]): JsonObject {
  // Parse user's extra body parameters first
  const extraBodyStr = process.env.CLAUDE_CODE_EXTRA_BODY
  let result: JsonObject = {}

  if (extraBodyStr) {
    try {
      // Parse as JSON, which can be null, boolean, number, string, array or object
      const parsed = safeParseJSON(extraBodyStr)
      // We expect an object with key-value pairs to spread into API parameters
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Shallow clone — safeParseJSON is LRU-cached and returns the same
        // object reference for the same string. Mutating `result` below
        // would poison the cache, causing stale values to persist.
        result = { ...(parsed as JsonObject) }
// 这一行看着多余，其实是修 bug 的。
// safeParseJSON 是带 LRU 缓存的：同一个字符串第二次解析直接返回**同一个对象引用**。
// 如果这里写 result = parsed，下面 result.anthropic_beta = ... 就是在改缓存里的对象，
// 同一次会话里后续所有请求都会读到被污染的旧值。
// { ...parsed } 是浅克隆——够用，因为下面只改顶层键（anti_distillation / anthropic_beta）。
      } else {
        logForDebugging(
          `CLAUDE_CODE_EXTRA_BODY env var must be a JSON object, but was given ${extraBodyStr}`,
          { level: 'error' },
        )
      }
    } catch (error) {
      logForDebugging(
        `Error parsing CLAUDE_CODE_EXTRA_BODY: ${errorMessage(error)}`,
        { level: 'error' },
      )
    }
  }

// 反蒸馏：给第一方 CLI 发一个「请注入假工具」的信号，
// 让抓取流量的第三方拿到的工具列表是不可用的。
// 条件里三层 and 的顺序是刻意的：先判最便宜的 feature() 常量，
// 再判环境变量，最后才查 GrowthBook（有磁盘缓存但仍是函数调用）。
  // Anti-distillation: send fake_tools opt-in for 1P CLI only
  if (
    feature('ANTI_DISTILLATION_CC')
      ? process.env.CLAUDE_CODE_ENTRYPOINT === 'cli' &&
        shouldIncludeFirstPartyOnlyBetas() &&
        getFeatureValue_CACHED_MAY_BE_STALE(
          'tengu_anti_distill_fake_tool_injection',
          false,
        )
      : false
  ) {
    result.anti_distillation = ['fake_tools']
  }

  // Handle beta headers if provided
  if (betaHeaders && betaHeaders.length > 0) {
    if (result.anthropic_beta && Array.isArray(result.anthropic_beta)) {
      // Add to existing array, avoiding duplicates
      const existingHeaders = result.anthropic_beta as string[]
      const newHeaders = betaHeaders.filter(
        header => !existingHeaders.includes(header),
      )
      result.anthropic_beta = [...existingHeaders, ...newHeaders]
    } else {
      // Create new array with the beta headers
      result.anthropic_beta = betaHeaders
    }
  }

  return result
}

// ── 缓存开关 ──
// 缓存默认开，只能通过环境变量按模型关掉。
// 为什么是「按模型关」而不是全局关：缓存有写入成本（首次请求多花钱），
// 小模型的一次性调用（如 Haiku 分类）几乎不会命中，开了反而更贵。
export function getPromptCachingEnabled(model: string): boolean {
  // Global disable takes precedence
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING)) return false

  // Check if we should disable for small/fast model
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_HAIKU)) {
    const smallFastModel = getSmallFastModel()
    if (model === smallFastModel) return false
  }

  // Check if we should disable for default Sonnet
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_SONNET)) {
    const defaultSonnet = getDefaultSonnetModel()
    if (model === defaultSonnet) return false
  }

  // Check if we should disable for default Opus
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_OPUS)) {
    const defaultOpus = getDefaultOpusModel()
    if (model === defaultOpus) return false
  }

  return true
}

// cache_control 是打在请求体里的「缓存打点」：标在哪一块，
// 服务端就把从开头到这一块的整段前缀缓存起来。
// 它同时决定三件事：缓存到哪、缓存多久（ttl）、缓存放在哪个命名空间（scope）。
//
// 返回值刻意用条件展开而不是给 undefined：{ ttl: undefined } 和 {} 在
// JSON 序列化后虽然一样，但 SDK 会做键存在性判断，多余字段可能触发不同分支。
export function getCacheControl({
  scope,
  querySource,
}: {
  scope?: CacheScope
  querySource?: QuerySource
} = {}): {
  type: 'ephemeral'
  ttl?: '1h'
  scope?: CacheScope
} {
  return {
    type: 'ephemeral',
    ...(should1hCacheTTL(querySource) && { ttl: '1h' }),
    ...(scope === 'global' && { scope }),
  }
}

/**
 * Determines if 1h TTL should be used for prompt caching.
 *
 * Only applied when:
 * 1. User is eligible (ant or subscriber within rate limits)
 * 2. The query source matches a pattern in the GrowthBook allowlist
 *
 * GrowthBook config shape: { allowlist: string[] }
 * Patterns support trailing '*' for prefix matching.
 * Examples:
 * - { allowlist: ["repl_main_thread*", "sdk"] } — main thread + SDK only
 * - { allowlist: ["repl_main_thread*", "sdk", "agent:*"] } — also subagents
 * - { allowlist: ["*"] } — all sources
 *
 * The allowlist is cached in STATE for session stability — prevents mixed
 * TTLs when GrowthBook's disk cache updates mid-request.
 */
// ── 1 小时 TTL 的判定 ──
// 默认 TTL 是 5 分钟，1h 需要单独申请（更贵，但适合长时间思考/长任务）。
// 这个函数最值得注意的是它**把两个判断结果都存进了 bootstrap state**。
// 为什么不每次现算：会话跑到一半，用量跨过分界线会让 isUsingOverage 翻转，
// 于是 cache_control.ttl 从 1h 变回 5m —— 服务端缓存键里带着 TTL，
// 一变整条前缀作废，约 20K token 按全价重算。
function should1hCacheTTL(querySource?: QuerySource): boolean {
  // 3P Bedrock users get 1h TTL when opted in via env var — they manage their own billing
  // No GrowthBook gating needed since 3P users don't have GrowthBook configured
  if (
    getAPIProvider() === 'bedrock' &&
    isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK)
  ) {
    return true
  }

// latch（锁存）：第一次算出来就写进 state，之后永远读缓存值。
// getPromptCache1hEligible() 返回 null 表示「本会话还没算过」，
// 这是三态设计——null（未定）/ true / false，用 null 区分「没算」和「算出来是 false」。
  // Latch eligibility in bootstrap state for session stability — prevents
  // mid-session overage flips from changing the cache_control TTL, which
  // would bust the server-side prompt cache (~20K tokens per flip).
  let userEligible = getPromptCache1hEligible()
  if (userEligible === null) {
    userEligible =
      process.env.USER_TYPE === 'ant' ||
      (isClaudeAISubscriber() && !currentLimits.isUsingOverage)
    setPromptCache1hEligible(userEligible)
  }
  if (!userEligible) return false

  // Cache allowlist in bootstrap state for session stability — prevents mixed
  // TTLs when GrowthBook's disk cache updates mid-request
  let allowlist = getPromptCache1hAllowlist()
  if (allowlist === null) {
    const config = getFeatureValue_CACHED_MAY_BE_STALE<{
      allowlist?: string[]
    }>('tengu_prompt_cache_1h_config', {})
    allowlist = config.allowlist ?? []
    setPromptCache1hAllowlist(allowlist)
  }

  return (
    querySource !== undefined &&
    allowlist.some(pattern =>
      pattern.endsWith('*')
        ? querySource.startsWith(pattern.slice(0, -1))
        : querySource === pattern,
    )
  )
}

// ── effort 参数 ──
// effort 是「模型该花多大力气」的旋钮。三种取值形态：
//   undefined      → 只加 beta 头，不发值（让服务端用默认档）
//   字符串          → 直接放进 output_config.effort
//   数字（仅内测）   → 走 anthropic_internal.effort_override 这个私有通道
// 注意 `'effort' in outputConfig` 这个提前返回：如果用户已经在
// CLAUDE_CODE_EXTRA_BODY 里手填了 effort，就不要覆盖他。
/**
 * Configure effort parameters for API request.
 *
 */
function configureEffortParams(
  effortValue: EffortValue | undefined,
  outputConfig: BetaOutputConfig,
  extraBodyParams: Record<string, unknown>,
  betas: string[],
  model: string,
): void {
  if (!modelSupportsEffort(model) || 'effort' in outputConfig) {
    return
  }

  if (effortValue === undefined) {
    betas.push(EFFORT_BETA_HEADER)
  } else if (typeof effortValue === 'string') {
    // Send string effort level as is
    outputConfig.effort = effortValue
    betas.push(EFFORT_BETA_HEADER)
  } else if (process.env.USER_TYPE === 'ant') {
    // Numeric effort override - ant-only (uses anthropic_internal)
    const existingInternal =
      (extraBodyParams.anthropic_internal as Record<string, unknown>) || {}
    extraBodyParams.anthropic_internal = {
      ...existingInternal,
      effort_override: effortValue,
    }
  }
}

// task_budget 是「服务端记账」的预算：告诉模型总共多少 token、还剩多少，
// 让模型自己规划节奏（比如提前收尾、少调工具）。
//
// 别和 tokenBudget.ts 搞混——那是**客户端记账**：客户端数着 tokens，
// 到 500k 就自动续跑一轮。两者同时存在，各有各的用途：
//   客户端预算 = 控制「什么时候再来一轮」
//   服务端预算 = 告诉模型「你还有多少余量，省着点」
// 因此在 query.ts 里压缩上下文之后，必须把 remaining 补偿回来，
// 否则模型会以为自己快没预算了。
// output_config.task_budget — API-side token budget awareness for the model.
// Stainless SDK types don't yet include task_budget on BetaOutputConfig, so we
// define the wire shape locally and cast. The API validates on receipt; see
// api/api/schemas/messages/request/output_config.py:12-39 in the monorepo.
// Beta: task-budgets-2026-03-13 (EAP, claude-strudel-eap only as of Mar 2026).
type TaskBudgetParam = {
  type: 'tokens'
  total: number
  remaining?: number
}

// 写入 output_config.task_budget，并按需加 beta 头。
//
// shouldIncludeFirstPartyOnlyBetas() 这个门禁很关键：task_budget 是 EAP 阶段
// 的第一方独占能力，发给 Bedrock/Vertex 会直接 400。
export function configureTaskBudgetParams(
  taskBudget: Options['taskBudget'],
  outputConfig: BetaOutputConfig & { task_budget?: TaskBudgetParam },
  betas: string[],
): void {
  if (
    !taskBudget ||
    'task_budget' in outputConfig ||
    !shouldIncludeFirstPartyOnlyBetas()
  ) {
    return
  }
  outputConfig.task_budget = {
    type: 'tokens',
    total: taskBudget.total,
    ...(taskBudget.remaining !== undefined && {
      remaining: taskBudget.remaining,
    }),
  }
  if (!betas.includes(TASK_BUDGETS_BETA_HEADER)) {
    betas.push(TASK_BUDGETS_BETA_HEADER)
  }
}

// ── 请求元数据 ──
// metadata.user_id 是一个**塞了 JSON 的字符串**（不是对象），这是 API 的约定。
// 里面藏了 device_id / account_uuid / session_id——服务端靠这些做用量归因。
// account_uuid 只在真的用 OAuth 时才有值，用 API key 时是空串。
export function getAPIMetadata() {
  // https://docs.google.com/document/d/1dURO9ycXXQCBS0V4Vhl4poDBRgkelFc5t2BNPoEgH5Q/edit?tab=t.0#heading=h.5g7nec5b09w5
  let extra: JsonObject = {}
  const extraStr = process.env.CLAUDE_CODE_EXTRA_METADATA
  if (extraStr) {
    const parsed = safeParseJSON(extraStr, false)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      extra = parsed as JsonObject
    } else {
      logForDebugging(
        `CLAUDE_CODE_EXTRA_METADATA env var must be a JSON object, but was given ${extraStr}`,
        { level: 'error' },
      )
    }
  }

  return {
    user_id: jsonStringify({
      ...extra,
      device_id: getOrCreateUserID(),
      // Only include OAuth account UUID when actively using OAuth authentication
      account_uuid: getOauthAccountInfo()?.accountUuid ?? '',
      session_id: getSessionId(),
    }),
  }
}

// ── 启动时校验 API key ──
// 交互模式下用最小请求（max_tokens: 1，内容就是 "test"）探一次。
// 非交互模式（-p / print 模式）直接返回 true 跳过——因为那种场景下
// 任何一次失败都意味着整个流程失败，没必要多花一次往返。
//
// 这里刻意用 withRetry 而不是裸调用：校验失败要能区分
// 「key 真的错了」（返回 false）和「网络/限流问题」（抛出，由上层重试）。
export async function verifyApiKey(
  apiKey: string,
  isNonInteractiveSession: boolean,
): Promise<boolean> {
  // Skip API verification if running in print mode (isNonInteractiveSession)
  if (isNonInteractiveSession) {
    return true
  }

  try {
    // WARNING: if you change this to use a non-Haiku model, this request will fail in 1P unless it uses getCLISyspromptPrefix.
// 这条 WARNING 值得单独说：换模型会让这个探测请求在第一方直接失败。
// 原因是第一方的系统提示词前缀是白名单校验的（getCLISyspromptPrefix），
// 只有 Haiku 这类小模型的调用被允许带上 CLI 的特定前缀。
// 换句话说：这不是性能考虑，是兼容性约束。
    const model = getSmallFastModel()
    const betas = getModelBetas(model)
    return await returnValue(
      withRetry(
        () =>
          getAnthropicClient({
            apiKey,
            maxRetries: 3,
            model,
            source: 'verify_api_key',
          }),
        async anthropic => {
          const messages: MessageParam[] = [{ role: 'user', content: 'test' }]
          // biome-ignore lint/plugin: API key verification is intentionally a minimal direct call
// biome-ignore 说明这是**故意**绕过 lint 规则：全代码库只有 API key 校验
// 这一处允许直接调 beta.messages.create，不走 queryModel 那条主链路。
// 因为主链路会注入一大堆东西（缓存、beta 头、tool schema、system prompt 前缀），
// 而这些在「只想知道 key 有没有效」这个场景里全是负担，还可能掩盖真实错误。
          await anthropic.beta.messages.create({
            model,
            max_tokens: 1,
            messages,
            temperature: 1,
            ...(betas.length > 0 && { betas }),
            metadata: getAPIMetadata(),
            ...getExtraBodyParams(),
          })
          return true
        },
        { maxRetries: 2, model, thinkingConfig: { type: 'disabled' } }, // Use fewer retries for API key verification
      ),
    )
  } catch (errorFromRetry) {
    let error = errorFromRetry
    if (errorFromRetry instanceof CannotRetryError) {
      error = errorFromRetry.originalError
    }
    logError(error)
    // Check for authentication error
    if (
      error instanceof Error &&
      error.message.includes(
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      )
    ) {
      return false
    }
    throw error
  }
}

// ═══ 内部消息 → API 参数 ═══
//
// 从这一行开始，代码在做一件看起来琐碎但极其重要的事：
// **把内部消息格式翻译成 API 的 line 协议格式**。
//
// 内部格式（UserMessage / AssistantMessage）带着一堆 API 不认识的东西：
// uuid、timestamp、type 标签、isMeta、research……
// 其中 type 这个字段最微妙：内部用 'assistant' 区分消息来源，
// 而 API 的 role 只能是 'user' 或 'assistant'，两者语义**不完全对应**
// （比如内部的 isMeta 用户消息，发出去就是一条普通 user 消息）。
//
// addCache 参数决定「这条消息的最后一个内容块要不要打 cache_control 打点」。
export function userMessageToMessageParam(
  message: UserMessage,
  addCache = false,
  enablePromptCaching: boolean,
  querySource?: QuerySource,
): MessageParam {
  if (addCache) {
    if (typeof message.message.content === 'string') {
      return {
        role: 'user',
        content: [
          {
            type: 'text',
            text: message.message.content,
            ...(enablePromptCaching && {
              cache_control: getCacheControl({ querySource }),
            }),
          },
        ],
      }
    } else {
      return {
        role: 'user',
        content: message.message.content.map((_, i) => ({
          ..._,
          ...(i === message.message.content.length - 1
            ? enablePromptCaching
              ? { cache_control: getCacheControl({ querySource }) }
              : {}
            : {}),
        })),
      }
    }
  }
  // Clone array content to prevent in-place mutations (e.g., insertCacheEditsBlock's
  // splice) from contaminating the original message. Without cloning, multiple calls
  // to addCacheBreakpoints share the same array and each splices in duplicate cache_edits.
// 这段注释说的是一个真实踩过的坑，值得展开：
//
// addCacheBreakpoints 会对同一条消息调用本函数，而它在 useCachedMC 模式下
// 还要做 insertBlockAfterToolResults —— 那个函数用的是 splice（原地改数组）。
// 如果这里直接把 message.message.content 原样返回，那么每调一次
// addCacheBreakpoints 就多插一份 cache_edits，同一条消息里堆叠重复块，
// API 直接 400。
//
// 注意「只在非缓存路径克隆」这个细节：addCache 为真时上面已经 map 出了新数组，
// 天然是副本，不必再克隆一次（那是每次请求都要走的热路径）。
  return {
    role: 'user',
    content: Array.isArray(message.message.content)
      ? [...message.message.content]
      : message.message.content,
  }
}

// assistant 消息的转换和 user 几乎对称，但多三个例外判断（行 658-661）。
// 理由各不相同：
//   thinking / redacted_thinking：签名和模型绑定，把它们当成缓存末端会让
//     下一轮的 thinking 上下文对不上，服务端直接报错
//   connector_text：第三方连接器产出的文本，不参与 Anthropic 的缓存协议
// 也就是说，「最后一个块」不一定是「最后一个可以打点的块」——
// 要往前找第一个能打的。
export function assistantMessageToMessageParam(
  message: AssistantMessage,
  addCache = false,
  enablePromptCaching: boolean,
  querySource?: QuerySource,
): MessageParam {
  if (addCache) {
    if (typeof message.message.content === 'string') {
      return {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: message.message.content,
            ...(enablePromptCaching && {
              cache_control: getCacheControl({ querySource }),
            }),
          },
        ],
      }
    } else {
      return {
        role: 'assistant',
        content: message.message.content.map((_, i) => ({
          ..._,
          ...(i === message.message.content.length - 1 &&
          _.type !== 'thinking' &&
          _.type !== 'redacted_thinking' &&
          (feature('CONNECTOR_TEXT') ? !isConnectorTextBlock(_) : true)
            ? enablePromptCaching
              ? { cache_control: getCacheControl({ querySource }) }
              : {}
            : {}),
        })),
      }
    }
  }
  return {
    role: 'assistant',
    content: message.message.content,
  }
}

// ═══ Options：外部调用方能配的一切 ═══
//
// 33 个字段，几乎每一个都对应一次「线上出过事，所以加个开关」。
// 按用途分四组看会清楚很多：
//
//   必填（模型/环境）     model / querySource / isNonInteractiveSession / agents
//   权限与工具            getToolPermissionContext / mcpTools / extraToolSchemas
//   缓存与预算            enablePromptCaching / skipCacheWrite / taskBudget
//   逃生舱                fetchOverride / temperatureOverride / maxOutputTokensOverride
//                        onStreamingFallback
//
// 值得注意的是 getToolPermissionContext 是个**异步函数**而不是值：
// 权限上下文会随用户操作实时变化，而请求构造可能发生在任意时刻，
// 所以要「用的时候现取」。这也解释了行 1731 那段日志优化为什么要特别处理它。
export type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto | undefined
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  agentId?: AgentId // Only set for subagents
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  addNotification?: (notif: Notification) => void
  // API-side task budget (output_config.task_budget). Distinct from the
  // tokenBudget.ts +500k auto-continue feature — this one is sent to the API
  // so the model can pace itself. `remaining` is computed by the caller
  // (query.ts decrements across the agentic loop).
// 这条注释明确划清了两个预算的边界，值得记住：
// taskBudget 发给 API（模型自己看），tokenBudget.ts 自己记账（客户端看）。
// remaining 由**调用方**递减（query.ts 的 agentic 循环里），
// 而不是在这里扣 —— 这个文件只负责「如实转发当前余额」。
  taskBudget?: { total: number; remaining?: number }
}

// ═══ queryModelWithoutStreaming：包了一层「假装不流式」 ═══
//
// 名字有点误导：它内部**仍然走流式**（queryModel 只实现了流式路径），
// 只是把流全部消费掉，只把最后一条 assistant 消息返回给调用方。
//
// 为什么这么设计而不是另写一条非流式实现：
// 流式路径已经有完整的重试、超时、降级、缓存打点逻辑，
// 再写一份非流式版本意味着两套逻辑要各自维护 bug。
// 唯一真正非流式的地方是「流式降级后的兜底」（executeNonStreamingRequest）。
export async function queryModelWithoutStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<AssistantMessage> {
  // Store the assistant message but continue consuming the generator to ensure
  // logAPISuccessAndDuration gets called (which happens after all yields)
// 这里的写法有个必须理解的怪处：**循环不是为了拿数据，是为了让生成器跑完**。
//
// logAPISuccessAndDuration 在 queryModel 里位于所有 yield **之后**（行 2858）。
// 如果调用方拿到第一条 assistant 消息就 break，生成器停在 yield 处，
// 后面那段永远不会执行——成功日志、成本累计、资源释放全丢。
// 所以这里的 for await 必须跑到 done，assistantMessage 只是「顺便记一下最后一条」。
  let assistantMessage: AssistantMessage | undefined
  for await (const message of withStreamingVCR(messages, async function* () {
    yield* queryModel(
      messages,
      systemPrompt,
      thinkingConfig,
      tools,
      signal,
      options,
    )
  })) {
    if (message.type === 'assistant') {
      assistantMessage = message
    }
  }
// 一条 assistant 消息都没有。两种可能，处理方式不同：
//   signal 已中止 → 抛 APIUserAbortError（上层按「用户主动取消」处理，不报错）
//   否则          → 抛通用 Error（真异常，要暴露出来）
// 区分开的原因：中止是**预期行为**，如果混成普通错误，
// 用户每次按 ESC 都会看到一条红色报错。
  if (!assistantMessage) {
    // If the signal was aborted, throw APIUserAbortError instead of a generic error
    // This allows callers to handle abort scenarios gracefully
    if (signal.aborted) {
      throw new APIUserAbortError()
    }
    throw new Error('No assistant message found')
  }
  return assistantMessage
}

// 和上面完全对称，只是把生成器原样透传出去（yield* 委托）。
// 两个函数的差别只有一行 return：一个有返回值的透传，一个丢弃流只留结果。
//
// withStreamingVCR 是录制/回放层：测试时把真实 API 响应录成文件，
// 重放时不再打网络。这也是为什么这两个薄壳存在——
// 录制钩子必须包在 queryModel 外面，而不能塞进 queryModel 里面。
export async function* queryModelWithStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  return yield* withStreamingVCR(messages, async function* () {
    yield* queryModel(
      messages,
      systemPrompt,
      thinkingConfig,
      tools,
      signal,
      options,
    )
  })
}

/**
 * Determines if an LSP tool should be deferred (tool appears with defer_loading: true)
 * because LSP initialization is not yet complete.
 */
// ── 延迟 LSP 工具 ──
// LSP（语言服务器）启动要几秒。启动期间如果把 LSP 工具放进工具列表，
// 模型可能去调它，然后拿到「还没准备好」的错误，白烧一轮。
// 所以这个窗口期内给工具打 defer_loading 标记 ——
// 工具仍然「存在」于提示词里（模型知道有这么个东西），
// 但不需要立刻把完整 schema 发过去。
function shouldDeferLspTool(tool: Tool): boolean {
  if (!('isLsp' in tool) || !tool.isLsp) {
    return false
  }
  const status = getInitializationStatus()
  // Defer when pending or not started
  return status.status === 'pending' || status.status === 'not-started'
}

// ── 非流式兜底的超时 ──
//
// 默认 300 秒，但远程会话（CLAUDE_CODE_REMOTE）降到 120 秒。
// 原因很具体：远程会话跑在 CCR 容器里，容器有约 5 分钟的 idle-kill。
// 如果超时设 300 秒，请求可能刚好卡在容器被杀的那一刻，
// 用户看到的是「连接莫名断开」而不是一个干净的超时错误。
//
// 120 秒 < 5 分钟，留出余量让 APIConnectionTimeoutError 先抛出来。
/**
 * Per-attempt timeout for non-streaming fallback requests, in milliseconds.
 * Reads API_TIMEOUT_MS when set so slow backends and the streaming path
 * share the same ceiling.
 *
 * Remote sessions default to 120s to stay under CCR's container idle-kill
 * (~5min) so a hung fallback to a wedged backend surfaces a clean
 * APIConnectionTimeoutError instead of stalling past SIGKILL.
 *
 * Otherwise defaults to 300s — long enough for slow backends without
 * approaching the API's 10-minute non-streaming boundary.
 */
function getNonstreamingFallbackTimeoutMs(): number {
  const override = parseInt(process.env.API_TIMEOUT_MS || '', 10)
  if (override) return override
  return isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ? 120_000 : 300_000
}

/**
 * Helper generator for non-streaming API requests.
 * Encapsulates the common pattern of creating a withRetry generator,
 * iterating to yield system messages, and returning the final BetaMessage.
 */
// ═══ executeNonStreamingRequest：真正的一次性请求 ═══
//
// 这是全文件唯一「不流式」的发送路径，只在流式彻底失败后启用。
// 它是一个生成器，但返回值（BetaMessage）才是重点——
// yield 出去的只有 SystemAPIErrorMessage（重试提示），
// 这种「yield 是过程、return 是结果」的双通道模式在 query.ts 里也反复出现。
//
// 六个参数值得逐个看一遍，因为它们划清了职责：
//   clientOptions   → 怎么建 HTTP 客户端
//   retryOptions    → 重试策略（含 fallbackModel、thinking 配置）
//   paramsFromContext → 参数工厂（同一个工厂给流式和非流式共用！）
//   onAttempt       → 回调，把 attempt / 起始时间 / max_tokens 抛回给调用方
//   captureRequest  → 回调，把最终参数留给 bug report
//   originatingRequestId → 失败的那次流式请求 id，用于漏斗关联
export async function* executeNonStreamingRequest(
  clientOptions: {
    model: string
    fetchOverride?: Options['fetchOverride']
    source: string
  },
  retryOptions: {
    model: string
    fallbackModel?: string
    thinkingConfig: ThinkingConfig
    fastMode?: boolean
    signal: AbortSignal
    initialConsecutive529Errors?: number
    querySource?: QuerySource
  },
  paramsFromContext: (context: RetryContext) => BetaMessageStreamParams,
  onAttempt: (attempt: number, start: number, maxOutputTokens: number) => void,
  captureRequest: (params: BetaMessageStreamParams) => void,
  /**
   * Request ID of the failed streaming attempt this fallback is recovering
   * from. Emitted in tengu_nonstreaming_fallback_error for funnel correlation.
   */
  originatingRequestId?: string | null,
): AsyncGenerator<SystemAPIErrorMessage, BetaMessage> {
  const fallbackTimeoutMs = getNonstreamingFallbackTimeoutMs()
  const generator = withRetry(
    () =>
      getAnthropicClient({
        maxRetries: 0,
        model: clientOptions.model,
        fetchOverride: clientOptions.fetchOverride,
        source: clientOptions.source,
      }),
    async (anthropic, attempt, context) => {
      const start = Date.now()
      const retryParams = paramsFromContext(context)
      captureRequest(retryParams)
      onAttempt(attempt, start, retryParams.max_tokens)

// 关键：非流式请求要额外套一层 adjustParamsForNonStreaming。
// 因为非流式有 10 分钟上限，SDK 内部按「10min × 128k tokens/hour」算出
// 21333 token 的隐形上限。这里显式设 client timeout 绕开它，
// 但绕开之后必须自己保证 max_tokens 不越界 —— 见行 3354 的说明。
      const adjustedParams = adjustParamsForNonStreaming(
        retryParams,
        MAX_NON_STREAMING_TOKENS,
      )

      try {
        // biome-ignore lint/plugin: non-streaming API call
        return await anthropic.beta.messages.create(
          {
            ...adjustedParams,
            model: normalizeModelStringForAPI(adjustedParams.model),
          },
          {
            signal: retryOptions.signal,
            timeout: fallbackTimeoutMs,
          },
        )
      } catch (err) {
// 用户主动中止不记日志、直接重抛。
// 这不是省事：如果把 abort 当错误记进 tengu_nonstreaming_fallback_error，
// 每次用户按 ESC 都会污染错误率指标，掩盖真正的故障。
        // User aborts are not errors — re-throw immediately without logging
        if (err instanceof APIUserAbortError) throw err

        // Instrumentation: record when the non-streaming request errors (including
        // timeouts). Lets us distinguish "fallback hung past container kill"
        // (no event) from "fallback hit the bounded timeout" (this event).
        logForDiagnosticsNoPII('error', 'cli_nonstreaming_fallback_error')
        logEvent('tengu_nonstreaming_fallback_error', {
          model:
            clientOptions.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error:
            err instanceof Error
              ? (err.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
              : ('unknown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
          attempt,
          timeout_ms: fallbackTimeoutMs,
          request_id: (originatingRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw err
      }
    },
    {
      model: retryOptions.model,
      fallbackModel: retryOptions.fallbackModel,
      thinkingConfig: retryOptions.thinkingConfig,
      ...(isFastModeEnabled() && { fastMode: retryOptions.fastMode }),
      signal: retryOptions.signal,
      initialConsecutive529Errors: retryOptions.initialConsecutive529Errors,
      querySource: retryOptions.querySource,
    },
  )

// 这个 do/while 是全文件最有代表性的「生成器套生成器」写法，必须看懂：
//
// withRetry 返回的是一个生成器，它会在重试之间 yield 出 system 消息
// （「正在重试第 2 次…」这类提示）。这里边拉边把 system 消息转出去，
// 一直拉到 done，然后 e.value 才是最终的 BetaMessage。
//
// 注意 e.value 的类型在 done 前后不一样：
//   !done 时是 yield 出来的 SystemAPIErrorMessage
//   done 时是 return 的 BetaMessage
// TypeScript 靠 AsyncGenerator 的泛型参数区分这两者，所以最后要 as 一下。
  let e
  do {
    e = await generator.next()
    if (!e.done && e.value.type === 'system') {
      yield e.value
    }
  } while (!e.done)

  return e.value as BetaMessage
}

// ── 请求链追踪 ──
//
// 每次请求带一个 requestId，下一次请求把它作为 previousRequestId 发回去，
// 服务端就能把整条对话串成一条链，用于分析缓存命中率与增量 token。
//
// 这里有个设计选择很值得学：**从消息数组里推导，而不是存全局变量**。
// 好处有三：
//   1. 主线程 / 子 agent / teammate 各自有独立的消息数组，天然互不干扰
//   2. 撤销/回滚会真的删掉消息，链也跟着自动回退（全局变量做不到）
//   3. 无状态，可测——喂一个数组就能验，不用 mock 全局状态
/**
 * Extracts the request ID from the most recent assistant message in the
 * conversation. Used to link consecutive API requests in analytics so we can
 * join them for cache-hit-rate analysis and incremental token tracking.
 *
 * Deriving this from the message array (rather than global state) ensures each
 * query chain (main thread, subagent, teammate) tracks its own request chain
 * independently, and rollback/undo naturally updates the value.
 */
function getPreviousRequestIdFromMessages(
  messages: Message[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type === 'assistant' && msg.requestId) {
      return msg.requestId
    }
  }
  return undefined
}

function isMedia(
  block: BetaContentBlockParam,
): block is BetaImageBlockParam | BetaRequestDocumentBlock {
  return block.type === 'image' || block.type === 'document'
}

function isToolResult(
  block: BetaContentBlockParam,
): block is BetaToolResultBlockParam {
  return block.type === 'tool_result'
}

// ── 媒体数量裁剪 ──
//
// API 限制单次请求最多 100 个媒体块（图片 + PDF），超了会返回一个
// 非常难懂的报错。与其让用户对着那个报错误导半天，不如**静默丢掉最旧的**。
//
// 为什么丢最旧的而不是最新的：截图类工具通常是「越新越相关」，
// 早期的截图基本已经变成对话历史里的结论了，丢掉损失最小。
//
// 实现上有个容易漏的点：媒体块可以嵌在 tool_result 的 content 里（行 965），
// 所以要往下钻一层数。
/**
 * Ensures messages contain at most `limit` media items (images + documents).
 * Strips oldest media first to preserve the most recent.
 */
export function stripExcessMediaItems(
  messages: (UserMessage | AssistantMessage)[],
  limit: number,
): (UserMessage | AssistantMessage)[] {
  let toRemove = 0
  for (const msg of messages) {
    if (!Array.isArray(msg.message.content)) continue
    for (const block of msg.message.content) {
      if (isMedia(block)) toRemove++
      if (isToolResult(block) && Array.isArray(block.content)) {
        for (const nested of block.content) {
          if (isMedia(nested)) toRemove++
        }
      }
    }
  }
  toRemove -= limit
// toRemove -= limit 之后如果 <= 0，说明没超限，**原数组直接返回**。
// 这个 early return 很重要：绝大多数请求不会超限，
// 走完整 map/filter 会给热路径平白加一次全量遍历。
  if (toRemove <= 0) return messages

  return messages.map(msg => {
    if (toRemove <= 0) return msg
    const content = msg.message.content
    if (!Array.isArray(content)) return msg

    const before = toRemove
    const stripped = content
      .map(block => {
        if (
          toRemove <= 0 ||
          !isToolResult(block) ||
          !Array.isArray(block.content)
        )
          return block
        const filtered = block.content.filter(n => {
          if (toRemove > 0 && isMedia(n)) {
            toRemove--
            return false
          }
          return true
        })
        return filtered.length === block.content.length
          ? block
          : { ...block, content: filtered }
      })
      .filter(block => {
        if (toRemove > 0 && isMedia(block)) {
          toRemove--
          return false
        }
        return true
      })

    return before === toRemove
      ? msg
      : {
          ...msg,
          message: { ...msg.message, content: stripped },
        }
  }) as (UserMessage | AssistantMessage)[]
}

// ═══════════════════════════════════════════════════════════════
// queryModel —— 1,881 行，全代码库最长的单个函数
//
// 它是 async generator，但**绝大多数 yield 出去的东西调用方并不关心**：
//
//     yield StreamEvent          流式增量（给 UI 做打字机效果）
//     yield AssistantMessage     一个内容块完成（给上层累积对话）
//     yield SystemAPIErrorMessage 错误/重试提示
//     return void                返回值是空的，结果全靠 yield
//
// 也就是说：调它的人必须边消费边自己拼装状态。
// 这也是为什么 queryModelWithoutStreaming 要写一个「只为跑完」的循环。
//
// 【读这 1,881 行的正确顺序】
//
//   第一步 看 1060-1100   —— betas 怎么来（决定了下面所有 header 逻辑）
//   第二步 看 1538-1729   —— paramsFromContext，这是「一次请求」的完整定义
//   第三步 看 1932-2403   —— for await + switch，这是「一条流」的完整解析
//   其余（过滤、归一化、日志、降级）都是围绕这三段的配套工作。
//
// 【一个容易误解的点】
// 这个函数里所有 `options.xxx` 都是**外部传入的一次性配置**，
// 而所有 `let` 声明的局部变量才是**跨流事件累积的状态**。
// 分辨这两类，1881 行会突然变得有序。
// ═══════════════════════════════════════════════════════════════
async function* queryModel(
  messages: Message[],
  systemPrompt: SystemPrompt,
  thinkingConfig: ThinkingConfig,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
// off-switch：紧急关停开关。
// 注释里那句「先查便宜条件」是性能要求而不是风格偏好：
// getDynamicConfig_BLOCKS_ON_INIT 会 await GrowthBook 初始化（约 10ms），
// 如果放在条件链最前面，每个 Haiku 调用都白等 10ms。
//
// 所以条件顺序是：订阅者判断（同步）→ 模型判断（同步）→ 才会 await。
// 对 haiku/sonnet 这类非自定义 Opus 模型，第一个条件就短路了，await 根本不执行。
> {
  // Check cheap conditions first — the off-switch await blocks on GrowthBook
  // init (~10ms). For non-Opus models (haiku, sonnet) this skips the await
  // entirely. Subscribers don't hit this path at all.
  if (
    !isClaudeAISubscriber() &&
    isNonCustomOpusModel(options.model) &&
    (
      await getDynamicConfig_BLOCKS_ON_INIT<{ activated: boolean }>(
        'tengu-off-switch',
        {
          activated: false,
        },
      )
    ).activated
  ) {
    logEvent('tengu_off_switch_query', {})
    yield getAssistantMessageFromError(
      new Error(CUSTOM_OFF_SWITCH_MESSAGE),
      options.model,
    )
    return
  }
// 这里体现了一个反复出现的原则：**能从数据推导的状态就不要存**。
// previousRequestId 完全由 messages 决定，所以不放进实例字段，
// 也就不会出现「忘了更新」这类 bug。

  // Derive previous request ID from the last assistant message in this query chain.
  // This is scoped per message array (main thread, subagent, teammate each have their own),
  // so concurrent agents don't clobber each other's request chain tracking.
  // Also naturally handles rollback/undo since removed messages won't be in the array.
// Bedrock 的一个特例：application-inference-profile 是个别名，
// 真实模型藏在 profile 后面。而 max_tokens / thinking 支持度都取决于真模型，
// 所以要先反查一次。这是三家云厂商里唯一需要额外往返的一家。
  const previousRequestId = getPreviousRequestIdFromMessages(messages)

  const resolvedModel =
    getAPIProvider() === 'bedrock' &&
    options.model.includes('application-inference-profile')
      ? ((await getInferenceProfileBackingModel(options.model)) ??
        options.model)
      : options.model

  queryCheckpoint('query_tool_schema_build_start')
// isAgenticQuery 是后面十几个分支的总闸门。
// 语义是「这次调用是不是主对话循环的一部分」：
// 主线程、子 agent、SDK、hook agent、verification agent 算；
// 压缩、摘要、分类、提取记忆这些**辅助调用**不算。
//
// 为什么必须区分：辅助调用如果也带上一堆 beta 头，
// 会让它们的请求体跟主线程不同，缓存键跟着变；而且有些能力
// （advisor、AFK、cache editing）在辅助调用里根本没意义。
  const isAgenticQuery =
    options.querySource.startsWith('repl_main_thread') ||
    options.querySource.startsWith('agent:') ||
    options.querySource === 'sdk' ||
    options.querySource === 'hook_agent' ||
    options.querySource === 'verification_agent'
  const betas = getMergedBetas(options.model, { isAgenticQuery })

// advisor beta 头**无条件**发送（只要 advisor 开着），
// 哪怕这次是压缩调用、根本没用到 advisor。
// 原因是历史消息里可能残留 advisor 的 server_tool_use 块，
// 不带这个头，API 会把那些块当成未知类型直接拒绝。
// 「为了读得懂历史而声明能力」——这类兼容性考虑在协议层很常见。
  // Always send the advisor beta header when advisor is enabled, so
  // non-agentic queries (compact, side_question, extract_memories, etc.)
  // can parse advisor server_tool_use blocks already in the conversation history.
  if (isAdvisorEnabled()) {
    betas.push(ADVISOR_BETA_HEADER)
  }

  let advisorModel: string | undefined
  if (isAgenticQuery && isAdvisorEnabled()) {
    let advisorOption = options.advisorModel

    const advisorExperiment = getExperimentAdvisorModels()
    if (advisorExperiment !== undefined) {
      if (
        normalizeModelStringForAPI(advisorExperiment.baseModel) ===
        normalizeModelStringForAPI(options.model)
      ) {
        // Override the advisor model if the base model matches. We
        // should only have experiment models if the user cannot
        // configure it themselves.
        advisorOption = advisorExperiment.advisorModel
      }
    }

    if (advisorOption) {
      const normalizedAdvisorModel = normalizeModelStringForAPI(
        parseUserSpecifiedModel(advisorOption),
      )
      if (!modelSupportsAdvisor(options.model)) {
        logForDebugging(
          `[AdvisorTool] Skipping advisor - base model ${options.model} does not support advisor`,
        )
      } else if (!isValidAdvisorModel(normalizedAdvisorModel)) {
        logForDebugging(
          `[AdvisorTool] Skipping advisor - ${normalizedAdvisorModel} is not a valid advisor model`,
        )
      } else {
        advisorModel = normalizedAdvisorModel
        logForDebugging(
          `[AdvisorTool] Server-side tool enabled with ${advisorModel} as the advisor model`,
        )
// 注意这里连续三处 `!modelSupportsAdvisor` / `!isValidAdvisorModel` 的降级：
// 不满足条件就只是**跳过**并记一条日志，不报错。
// advisor 是增强能力，配置错了不应该让整个会话跑不起来。
      }
    }
  }

  // Check if tool search is enabled (checks mode, model support, and threshold for auto mode)
  // This is async because it may need to calculate MCP tool description sizes for TstAuto mode
// ── 工具搜索（动态工具加载）──
//
// 背景：工具太多了。MCP 服务器一连，工具数量可能上百，
// 全量把 schema 塞进请求会让 prompt 膨胀到几十 K token。
//
// 解法：把一部分工具标成「延迟加载」（defer_loading），
// 提示词里只留一行名字，模型需要时调 ToolSearchTool 去搜，
// 搜到之后那部分 schema 才真正出现在下一轮请求里。
//
// 下面这一整段（1120-1257）都在处理这个机制的副作用。
  let useToolSearch = await isToolSearchEnabled(
    options.model,
    tools,
    options.getToolPermissionContext,
    options.agents,
    'query',
  )

// 这个「预计算」注释暴露了一个真实的成本问题：
// isDeferredTool 内部要做 2 次 GrowthBook 查询，而工具可能有上百个，
// 放在循环里判断就是几百次配置查询。
// 所以先扫一遍收集名字放进 Set，后面全是 O(1) 判断。
  // Precompute once — isDeferredTool does 2 GrowthBook lookups per call
  const deferredToolNames = new Set<string>()
  if (useToolSearch) {
    for (const t of tools) {
      if (isDeferredTool(t)) deferredToolNames.add(t.name)
    }
  }

  // Even if tool search mode is enabled, skip if there are no deferred tools
  // AND no MCP servers are still connecting. When servers are pending, keep
  // ToolSearch available so the model can discover tools after they connect.
// 三种情况会关掉工具搜索，这个第三种最容易被漏掉：
//   · 功能没开
//   · 一个延迟工具都没有（没什么可搜的）
//   · **还有 MCP 服务器在连接中** ← 这个必须保留 ToolSearch
// 第三种的道理：服务器连完之后会冒出新工具，模型得有办法发现它们。
// 如果这时把 ToolSearch 关了，新工具永远不会出现在对话里。
  if (
    useToolSearch &&
    deferredToolNames.size === 0 &&
    !options.hasPendingMcpServers
  ) {
    logForDebugging(
      'Tool search disabled: no deferred tools available to search',
    )
    useToolSearch = false
  }

  // Filter out ToolSearchTool if tool search is not enabled for this model
  // ToolSearchTool returns tool_reference blocks which unsupported models can't handle
  let filteredTools: Tools

// ⚠ 这是整个工具搜索机制的核心，也是最反直觉的一段：
//
//     只有「已经被发现过」的延迟工具才发给 API。
//
// 而「发现」的证据不在任何变量里，而在**消息历史**里——
// extractDiscoveredToolNames 会扫历史消息，看有没有 tool_reference 块。
//
// 为什么用历史当状态：这样服务器重启、进程恢复、会话续接都不用额外同步，
// 历史里有的就算已发现，历史里没有的就当没发现。无状态推导，永不失配。
  if (useToolSearch) {
    // Dynamic tool loading: Only include deferred tools that have been discovered
    // via tool_reference blocks in the message history. This eliminates the need
    // to predeclare all deferred tools upfront and removes limits on tool quantity.
    const discoveredToolNames = extractDiscoveredToolNames(messages)

    filteredTools = tools.filter(tool => {
      // Always include non-deferred tools
      if (!deferredToolNames.has(tool.name)) return true
      // Always include ToolSearchTool (so it can discover more tools)
      if (toolMatchesName(tool, TOOL_SEARCH_TOOL_NAME)) return true
      // Only include deferred tools that have been discovered
      return discoveredToolNames.has(tool.name)
    })
  } else {
    filteredTools = tools.filter(
      t => !toolMatchesName(t, TOOL_SEARCH_TOOL_NAME),
    )
  }

// 工具搜索的 beta 头分三家：
//   第一方 / Foundry → advanced-tool-use
//   Vertex / Bedrock   → tool-search-tool
// 而且 Bedrock 不能走 betas 数组，必须塞进请求体（下面是行 1178 的 if 判断，
// 行 1549 才是真正的 Bedrock 分支）。
  // Add tool search beta header if enabled - required for defer_loading to be accepted
  // Header differs by provider: 1P/Foundry use advanced-tool-use, Vertex/Bedrock use tool-search-tool
  // For Bedrock, this header must go in extraBodyParams, not the betas array
  const toolSearchHeader = useToolSearch ? getToolSearchBetaHeader() : null
  if (toolSearchHeader && getAPIProvider() !== 'bedrock') {
    if (!betas.includes(toolSearchHeader)) {
      betas.push(toolSearchHeader)
    }
  }

// cached microcompact 的能力检测。
//
// 注意这里用 `await import(...)` 动态导入而不是顶部静态 import：
// 这是 DCE 的另一种写法——动态 import 在 feature() 为假的分支里，
// 打包器可以整块删掉，连模块都不进产物。
// 代价是这里要 await，所以它被放在「只执行一次」的位置（函数体靠前处），
// 而不是 paramsFromContext 里（那里每次重试都会跑）。
  // Determine if cached microcompact is enabled for this model.
  // Computed once here (in async context) and captured by paramsFromContext.
  // The beta header is also captured here to avoid a top-level import of the
  // ant-only CACHE_EDITING_BETA_HEADER constant.
  let cachedMCEnabled = false
  let cacheEditingBetaHeader = ''
  if (feature('CACHED_MICROCOMPACT')) {
    const {
      isCachedMicrocompactEnabled,
      isModelSupportedForCacheEditing,
      getCachedMCConfig,
    } = await import('../compact/cachedMicrocompact.js')
    const betas = await import('src/constants/betas.js')
    cacheEditingBetaHeader = betas.CACHE_EDITING_BETA_HEADER
    const featureEnabled = isCachedMicrocompactEnabled()
    const modelSupported = isModelSupportedForCacheEditing(options.model)
    cachedMCEnabled = featureEnabled && modelSupported
    const config = getCachedMCConfig()
    logForDebugging(
      `Cached MC gate: enabled=${featureEnabled} modelSupported=${modelSupported} model=${options.model} supportedModels=${jsonStringify(config.supportedModels)}`,
    )
  }

// ── 全局缓存作用域（global cache scope）──
//
// 默认的 prompt cache 是**按组织**隔离的。全局缓存是跨组织共享，
// 命中率更高，但前提是「这段前缀对所有用户都一样」。
//
// 显然，MCP 工具是每个用户各自的（用户名下的服务器和配置），
// 一旦它出现在要缓存的那一段里，全局缓存就不成立了。
// 所以下面要判断「这一轮有没有 MCP 工具会真的渲染出来」。
  const useGlobalCacheFeature = shouldUseGlobalCacheScope()
  const willDefer = (t: Tool) =>
    useToolSearch && (deferredToolNames.has(t.name) || shouldDeferLspTool(t))
  // MCP tools are per-user → dynamic tool section → can't globally cache.
  // Only gate when an MCP tool will actually render (not defer_loading).
  const needsToolBasedCacheMarker =
    useGlobalCacheFeature &&
    filteredTools.some(t => t.isMcp === true && !willDefer(t))

  // Ensure prompt_caching_scope beta header is present when global cache is enabled.
  if (
    useGlobalCacheFeature &&
    !betas.includes(PROMPT_CACHING_SCOPE_BETA_HEADER)
  ) {
    betas.push(PROMPT_CACHING_SCOPE_BETA_HEADER)
  }

  // Determine global cache strategy for logging
// 三种策略值的含义：
//   'system_prompt' → 系统提示词整体走全局缓存（最理想）
//   'none'          → 有 per-user 内容，放弃全局缓存
// 这个值只用于日志/诊断，不参与请求构造——但它决定了
// 后面 buildSystemPromptBlocks 的 skipGlobalCacheForSystemPrompt 参数。
  const globalCacheStrategy: GlobalCacheStrategy = useGlobalCacheFeature
    ? needsToolBasedCacheMarker
      ? 'none'
      : 'system_prompt'
    : 'none'

// 注意两条注释里的对比：**传给 toolToAPISchema 的是完整 tools（不是 filteredTools）**。
// 因为 ToolSearchTool 的提示词里需要列出「所有可搜索的工具名字」，
// 哪怕那些工具这次不发给 API。过滤只影响「实际发送」，不影响「模型看到什么」。
  // Build tool schemas, adding defer_loading for MCP tools when tool search is enabled
  // Note: We pass the full `tools` list (not filteredTools) to toolToAPISchema so that
  // ToolSearchTool's prompt can list ALL available MCP tools. The filtering only affects
  // which tools are actually sent to the API, not what the model sees in tool descriptions.
  const toolSchemas = await Promise.all(
    filteredTools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: options.model,
        deferLoading: willDefer(tool),
      }),
    ),
  )

  if (useToolSearch) {
    const includedDeferredTools = count(filteredTools, t =>
      deferredToolNames.has(t.name),
    )
    logForDebugging(
      `Dynamic tool loading: ${includedDeferredTools}/${deferredToolNames.size} deferred tools included`,
    )
  }

  queryCheckpoint('query_tool_schema_build_end')

// ── 消息归一化 ──
//
// normalizeMessagesForAPI 做的是「把内部消息格式压平成 API 能吃的形状」：
// 合并相邻同角色消息、把 isMeta 转成普通文本、去掉内部标记、
// 修正 tool_use / tool_result 的配对。
//
// 为什么必须在拼 system prompt **之前**：fingerprint（行 1325）要对
// 归一化后的消息做哈希，而 fingerprint 会进 system prompt（attribution 头）。
// 顺序错了，哈希算的是另一种形状，缓存键就对不上了。
  // Normalize messages before building system prompt (needed for fingerprinting)
  // Instrumentation: Track message count before normalization
  logEvent('tengu_api_before_normalize', {
    preNormalizedMessageCount: messages.length,
  })

  queryCheckpoint('query_message_normalization_start')
  let messagesForAPI = normalizeMessagesForAPI(messages, filteredTools)
  queryCheckpoint('query_message_normalization_end')

// 这段长注释解释了一个「为什么需要两处做同一件事」的问题，非常典型：
//
// normalizeMessagesForAPI 里其实也能剥掉 tool-search 相关字段，但它用的是
// isToolSearchEnabledNoModelCheck()（不带模型判断）。为什么？因为它被约 20 处
// 调用（分析、反馈、分享……），大部分调用方手上没有模型信息，
// 给它加模型参数会是一次大重构。
//
// 于是这里补一刀带模型判断的后处理。触发场景是**中途换模型**
// （比如 Sonnet → Haiku）：上一个模型留下的 tool_reference 字段
// 新模型不认识，直接 400。
  // Model-specific post-processing: strip tool-search-specific fields if the
  // selected model doesn't support tool search.
  //
  // Why is this needed in addition to normalizeMessagesForAPI?
  // - normalizeMessagesForAPI uses isToolSearchEnabledNoModelCheck() because it's
  //   called from ~20 places (analytics, feedback, sharing, etc.), many of which
  //   don't have model context. Adding model to its signature would be a large refactor.
  // - This post-processing uses the model-aware isToolSearchEnabled() check
  // - This handles mid-conversation model switching (e.g., Sonnet → Haiku) where
  //   stale tool-search fields from the previous model would cause 400 errors
  //
  // Note: For assistant messages, normalizeMessagesForAPI already normalized the
  // tool inputs, so stripCallerFieldFromAssistantMessage only needs to remove the
  // 'caller' field (not re-normalize inputs).
  if (!useToolSearch) {
    messagesForAPI = messagesForAPI.map(msg => {
      switch (msg.type) {
        case 'user':
          // Strip tool_reference blocks from tool_result content
          return stripToolReferenceBlocksFromUserMessage(msg)
        case 'assistant':
          // Strip 'caller' field from tool_use blocks
          return stripCallerFieldFromAssistantMessage(msg)
        default:
          return msg
      }
    })
  }

// 修复 tool_use / tool_result 配对。什么时候会不配对？
// 恢复远程/teleport 会话、跨进程续接、历史被裁剪过。
// 修法是「补一个合成的错误 tool_result」而不是删掉孤立的 tool_use——
// 因为删掉会让模型看到一段「有调用没结果」的历史，它下一轮还会重复调用。
  // Repair tool_use/tool_result pairing mismatches that can occur when resuming
  // remote/teleport sessions. Inserts synthetic error tool_results for orphaned
  // tool_uses and strips orphaned tool_results referencing non-existent tool_uses.
  messagesForAPI = ensureToolResultPairing(messagesForAPI)

// 反向：advisor 块必须在没有对应 beta 头时剥掉。
// 这和行 1075 是同一枚硬币的两面：
// 有头 → 不剥（历史里的 advisor 块要保留）；没头 → 必须剥（否则 400）。
  // Strip advisor blocks — the API rejects them without the beta header.
  if (!betas.includes(ADVISOR_BETA_HEADER)) {
    messagesForAPI = stripAdvisorBlocks(messagesForAPI)
  }

  // Strip excess media items before making the API call.
  // The API rejects requests with >100 media items but returns a confusing error.
  // Rather than erroring (which is hard to recover from in Cowork/CCD), we
  // silently drop the oldest media items to stay within the limit.
  messagesForAPI = stripExcessMediaItems(
    messagesForAPI,
    API_MAX_MEDIA_PER_REQUEST,
  )

  // Instrumentation: Track message count after normalization
// 这两个 logEvent 是配套的：before / after 各记一次消息数量，
// 一减就知道归一化到底合并/删除了多少条。
// 排查「消息数异常增长」时这是第一手数据。
  logEvent('tengu_api_after_normalize', {
    postNormalizedMessageCount: messagesForAPI.length,
  })

// fingerprint 用来做归因：同一条用户输入产生同一个指纹，
// 服务端可以据此统计「同一类请求的缓存表现」。
//
// 计算时机卡得很死：必须在注入任何合成消息**之前**。
// 下面 1330 会往开头插 deferred tool 列表、1366 会往 system 里插 advisor 指令，
// 如果那些跑完了再算，指纹反映的就不是「用户原话」了。
  // Compute fingerprint from first user message for attribution.
  // Must run BEFORE injecting synthetic messages (e.g. deferred tool names)
  // so the fingerprint reflects the actual user input.
  const fingerprint = computeFingerprintFromMessages(messagesForAPI)

// ⚠ 这里是 prompt cache 与功能的正面冲突，也是全文件最值得学的一段权衡：
//
//   老做法：每次请求都往消息**开头**插一段 <available-deferred-tools>，
//          告诉模型「还有这些工具可以搜」。
//   问题：  这段内容随工具池变化，一插进开头，**整条前缀缓存作废**。
//
//   新做法：不提「每次插开头」，而是把变化做成「增量附件」
//          （deferred_tools_delta），追加在对话末尾。
//          末端变化不影响前面已缓存的前缀。
//
// 于是这里出现了两个分支：开关开着走 delta，关着走老路。
// 全文件里这种「新旧两套并存、用 feature flag 切」的地方还有很多。
  // When the delta attachment is enabled, deferred tools are announced
  // via persisted deferred_tools_delta attachments instead of this
  // ephemeral prepend (which busts cache whenever the pool changes).
  if (useToolSearch && !isDeferredToolsDeltaEnabled()) {
    const deferredToolList = tools
      .filter(t => deferredToolNames.has(t.name))
      .map(formatDeferredToolLine)
      .sort()
      .join('\n')
    if (deferredToolList) {
      messagesForAPI = [
        createUserMessage({
          content: `<available-deferred-tools>\n${deferredToolList}\n</available-deferred-tools>`,
          isMeta: true,
        }),
        ...messagesForAPI,
      ]
    }
  }

// 同一个道理再演一遍，这次是 Chrome 的工具搜索提示词。
// 老做法往 system prompt 末尾追加 → 只要 Chrome 晚连上，
// 前面整段系统提示词（十几 K token）就全部失效。
// 新做法走 mcp_instructions_delta，作为增量块追加。
  // Chrome tool-search instructions: when the delta attachment is enabled,
  // these are carried as a client-side block in mcp_instructions_delta
  // (attachments.ts) instead of here. This per-request sys-prompt append
  // busts the prompt cache when chrome connects late.
  const hasChromeTools = filteredTools.some(t =>
    isToolFromMcpServer(t.name, CLAUDE_IN_CHROME_MCP_SERVER_NAME),
  )
  const injectChromeHere =
    useToolSearch && hasChromeTools && !isMcpInstructionsDeltaEnabled()

  // filter(Boolean) works by converting each element to a boolean - empty strings become false and are filtered out.
// ── system prompt 的最终拼装 ──
//
// 这里的顺序是**协议的硬性要求**，不能随意调整：
//
//   1. attribution 头   （可执行文件名 + 指纹，第一方用来识别客户端）
//   2. CLI sysprompt 前缀（第一方白名单校验的那段）
//   3. 真正的系统提示词  （prompts.ts 里那一大套）
//   4. advisor 工具说明  （只在开启时）
//   5. Chrome 工具搜索说明（只在需要时）
//
// 为什么 1、2 必须最前：服务端要能只读开头若干字节就判断
// 「这是哪个客户端、什么模式」，早于任何业务内容。
//
// filter(Boolean) 顺手把空串去掉——这也是「三个前缀函数有一个可能返空」的兜底。
  systemPrompt = asSystemPrompt(
    [
      getAttributionHeader(fingerprint),
      getCLISyspromptPrefix({
        isNonInteractive: options.isNonInteractiveSession,
        hasAppendSystemPrompt: options.hasAppendSystemPrompt,
      }),
      ...systemPrompt,
      ...(advisorModel ? [ADVISOR_TOOL_INSTRUCTIONS] : []),
      ...(injectChromeHere ? [CHROME_TOOL_SEARCH_INSTRUCTIONS] : []),
    ].filter(Boolean),
  )

  // Prepend system prompt block for easy API identification
  logAPIPrefix(systemPrompt)

// 缓存开关：先用调用方显式传的，没传就按模型默认。
// 这里的 `??` 而不是 `||` 有讲究：显式传 false 应该生效（关掉），
// 用 || 会把 false 当成「没传」。
  const enablePromptCaching =
    options.enablePromptCaching ?? getPromptCachingEnabled(options.model)
  const system = buildSystemPromptBlocks(systemPrompt, enablePromptCaching, {
// 注意 skipGlobalCacheForSystemPrompt 的值来自 needsToolBasedCacheMarker（行 1212）：
// 有 MCP 工具时要给**工具区**打缓存点，那就不能同时让系统提示词吃掉全局缓存，
// 否则会出现两个全局缓存锚点，服务端拒绝。
// 这就是 buildSystemPromptBlocks 里那句「不要再加缓存块了，会 400」的由来。
    skipGlobalCacheForSystemPrompt: needsToolBasedCacheMarker,
    querySource: options.querySource,
  })
  const useBetas = betas.length > 0

  // Build minimal context for detailed tracing (when beta tracing is enabled)
  // Note: The actual new_context message extraction is done in sessionTracing.ts using
  // hash-based tracking per querySource (agent) from the messagesForAPI array
// 一个很小的顺序决策，背后是缓存成本：
// advisor 工具 append 在 toolSchemas **之后**，而不是插在前面。
// 这样开关 /advisor 时，只有末尾这一小块变了，
// 前面所有工具 schema（可能几 K token）的缓存仍然有效。
  const extraToolSchemas = [...(options.extraToolSchemas ?? [])]
  if (advisorModel) {
    // Server tools must be in the tools array by API contract. Appended after
    // toolSchemas (which carries the cache_control marker) so toggling /advisor
    // only churns the small suffix, not the cached prefix.
    extraToolSchemas.push({
      type: 'advisor_20260301',
      name: 'advisor',
      model: advisorModel,
    } as unknown as BetaToolUnion)
  }
  const allTools = [...toolSchemas, ...extraToolSchemas]

  const isFastMode =
    isFastModeEnabled() &&
    isFastModeAvailable() &&
    !isFastModeCooldown() &&
    isFastModeSupportedByModel(options.model) &&
    !!options.fastMode

// ═══════════════════════════════════════════════════════════════
// sticky-on latch（粘性锁存）—— 这个小机制值得用整段注释讲清楚
//
// 问题：AFK 模式、fast mode、cache editing、thinking clear 这四个能力
// 都是「用户可以中途开关」的。如果每一次开关都反映到 beta 头上，
// 那服务端的请求签名就变了 → 缓存键变了 → 前缀约 50-70K token 全价重算。
//
// 解法：**一旦发出去过，就整个会话一直发。**
// 即使关掉了也继续发头（只是不发对应的 body 参数）。
// 这样缓存永远稳定，代价是「关掉之后服务端仍然以为你开着」——
// 而这个代价由 body 参数承担（比如 fastMode 关了就不再传 speed: 'fast'）。
//
// 注意 latch 状态存在 bootstrap state 里（跨请求），而不是这个函数的局部变量。
// 清理时机：/clear 和 /compact —— 那是两个「上下文重置」的时刻，
// 缓存本来就要重建，正好顺手清 latch。
//
// 四个 latch 的门槛各不相同，下面逐个看：
//   afk       → 只在 agentic query 且自动模式真的激活过
//   fastMode  → 只要求 isFastMode（五个条件的合取，行 1398）
//   cacheEdit → 第一方 + 主线程 + 模型支持，三重门禁
//   thinkingClear → agentic + 距上次请求超过 1h
// ═══════════════════════════════════════════════════════════════
  // Sticky-on latches for dynamic beta headers. Each header, once first
  // sent, keeps being sent for the rest of the session so mid-session
  // toggles don't change the server-side cache key and bust ~50-70K tokens.
  // Latches are cleared on /clear and /compact via clearBetaHeaderLatches().
  // Per-call gates (isAgenticQuery, querySource===repl_main_thread) stay
  // per-call so non-agentic queries keep their own stable header set.

  let afkHeaderLatched = getAfkModeHeaderLatched() === true
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (
      !afkHeaderLatched &&
      isAgenticQuery &&
      shouldIncludeFirstPartyOnlyBetas() &&
      (autoModeStateModule?.isAutoModeActive() ?? false)
    ) {
      afkHeaderLatched = true
      setAfkModeHeaderLatched(true)
    }
  }

  let fastModeHeaderLatched = getFastModeHeaderLatched() === true
  if (!fastModeHeaderLatched && isFastMode) {
    fastModeHeaderLatched = true
    setFastModeHeaderLatched(true)
  }

  let cacheEditingHeaderLatched = getCacheEditingHeaderLatched() === true
  if (feature('CACHED_MICROCOMPACT')) {
    if (
      !cacheEditingHeaderLatched &&
      cachedMCEnabled &&
      getAPIProvider() === 'firstParty' &&
      options.querySource === 'repl_main_thread'
    ) {
      cacheEditingHeaderLatched = true
      setCacheEditingHeaderLatched(true)
    }
  }

// thinkingClear 的 latch 门槛和其他三个不同：它不看「功能是否开启」，
// 而看**时间间隔**——上次请求距今超过 1 小时缓存肯定过期了，
// 这时才需要 clearAllThinking 让服务端丢弃旧的 thinking 上下文。
//
// 「只有 agentic query 才能 latch」这个限制也值得注意，
// 否则一次后台分类调用就可能把主线程的 context_management 翻掉，中途改变请求形状。
  // Only latch from agentic queries so a classifier call doesn't flip the
  // main thread's context_management mid-turn.
  let thinkingClearLatched = getThinkingClearLatched() === true
  if (!thinkingClearLatched && isAgenticQuery) {
    const lastCompletion = getLastApiCompletionTimestamp()
    if (
      lastCompletion !== null &&
      Date.now() - lastCompletion > CACHE_TTL_1HOUR_MS
    ) {
      thinkingClearLatched = true
      setThinkingClearLatched(true)
    }
  }

// effort 在这里就被**解析成最终值**（resolveAppliedEffort），
// 因为后面两处要用：paramsFromContext 里写进 output_config，
// 以及 recordPromptState 里参与缓存键计算。两处必须用同一个值。
  const effort = resolveAppliedEffort(options.model, options.effortValue)

// ── 缓存断裂检测 ──
//
// 这段代码不改变请求，只是**记录**「这一轮可能影响缓存键的所有因素」。
// 下一轮请求返回后，checkResponseForCacheBreak（行 2384）拿实际的
// cache_read_input_tokens 跟记录值对比，就能判断「是不是我们这边改了东西
// 导致缓存失效」，而不是服务端自己的问题。
//
// 注释里两个细节是关键：
//   1. 排除 defer_loading 工具 —— API 会把它们从提示词里剥掉，
//      它们从来不影响真实缓存键。不排除的话，每次发现新工具都会误报
//   2. **传 latch 后的值，不传实时状态** —— 检测的是「我们实际发了什么」，
//      而不是「用户现在开着什么」。差了这一步，每次用户切开关都会误报
  if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
    // Exclude defer_loading tools from the hash -- the API strips them from the
    // prompt, so they never affect the actual cache key. Including them creates
    // false-positive "tool schemas changed" breaks when tools are discovered or
    // MCP servers reconnect.
    const toolsForCacheDetection = allTools.filter(
      t => !('defer_loading' in t && t.defer_loading),
    )
    // Capture everything that could affect the server-side cache key.
    // Pass latched header values (not live state) so break detection
    // reflects what we actually send, not what the user toggled.
    recordPromptState({
      system,
      toolSchemas: toolsForCacheDetection,
      querySource: options.querySource,
      model: options.model,
      agentId: options.agentId,
      fastMode: fastModeHeaderLatched,
      globalCacheStrategy,
      betas,
      autoModeActive: afkHeaderLatched,
      isUsingOverage: currentLimits.isUsingOverage ?? false,
      cachedMCEnabled: cacheEditingHeaderLatched,
      effortValue: effort,
      extraBodyParams: getExtraBodyParams(),
    })
  }

// beta tracing 模式下才构造的上下文快照。
// 这里 jsonStringify(allTools) 把全部工具 schema 序列化了——
// 是个明显的性能开销，所以包在 isBetaTracingEnabled() 三元里，
// 正常路径下这个表达式根本不会求值。
  const newContext: LLMRequestNewContext | undefined = isBetaTracingEnabled()
    ? {
        systemPrompt: systemPrompt.join('\n\n'),
        querySource: options.querySource,
        tools: jsonStringify(allTools),
      }
    : undefined

  // Capture the span so we can pass it to endLLMRequestSpan later
  // This ensures responses are matched to the correct request when multiple requests run in parallel
  const llmSpan = startLLMRequestSpan(
    options.model,
    newContext,
    messagesForAPI,
    isFastMode,
  )

  const startIncludingRetries = Date.now()
  let start = Date.now()
  let attemptNumber = 0
  const attemptStartTimes: number[] = []
  let stream: Stream<BetaRawMessageStreamEvent> | undefined = undefined
  let streamRequestId: string | null | undefined = undefined
  let clientRequestId: string | undefined = undefined
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins -- Response is available in Node 18+ and is used by the SDK
  let streamResponse: Response | undefined = undefined

// ── 释放流资源 ──
//
// 这个函数存在的理由比看上去严重：Response 对象持有**原生 TLS / socket 缓冲**，
// 住在 V8 堆外面（Node.js 路径下观察到过，见 GH #32920）。
// JS 的 GC 管不到它，不显式 cancel，连接就一直挂着直到进程退出。
//
// 所以它的调用点有三处：finally（行 2815）、错误分支（行 2739/2747 等）、
// 以及正常结束后的兜底（行 2891）。宁可多调（幂等），不能漏调。
  // Release all stream resources to prevent native memory leaks.
  // The Response object holds native TLS/socket buffers that live outside the
  // V8 heap (observed on the Node.js/npm path; see GH #32920), so we must
  // explicitly cancel and release it regardless of how the generator exits.
  function releaseStreamResources(): void {
    cleanupStream(stream)
    stream = undefined
    if (streamResponse) {
      streamResponse.body?.cancel().catch(() => {})
      streamResponse = undefined
    }
  }

// ⚠ 这四行是一个很容易踩的坑，注释已经点出来了，我再说明白点：
//
// consumePendingCacheEdits() 是**读取并清空**（消费型 API）。
// 它必须在这里——paramsFromContext 定义**之前**、只调一次。
//
// 如果放进 paramsFromContext 里，会发生什么：
//   第一次调用（日志用途，行 1736）把待发送的删除指令吃掉了，
//   第二次调用（真正发请求，行 1797）拿到空数组。
//   于是「该删的缓存没删」，而且日志里显示的参数和实际发出去的参数不一致。
//
// 这类「消费型 API 被放进会被多次调用的函数」的 bug 极难发现，
// 因为日志看起来完全正常。
  // Consume pending cache edits ONCE before paramsFromContext is defined.
  // paramsFromContext is called multiple times (logging, retries), so consuming
  // inside it would cause the first call to steal edits from subsequent calls.
  const consumedCacheEdits = cachedMCEnabled ? consumePendingCacheEdits() : null
  const consumedPinnedEdits = cachedMCEnabled ? getPinnedCacheEdits() : []

  // Capture the betas sent in the last API request, including the ones that
  // were dynamically added, so we can log and send it to telemetry.
  let lastRequestBetas: string[] | undefined

// ═══════════════════════════════════════════════════════════════
// paramsFromContext —— 一整个 API 请求的定义
//
// 这是全文件第二个必须精读的地方。它是**工厂**不是常量：
// withRetry 每个 attempt 调一次，非流式兜底也调它。
//
// 为什么要工厂：重试不是「原样再发一次」。重试时可能：
//   · 换成 fallbackModel（retryContext.model 变了）
//   · 缩小 max_tokens（上下文超限了，retryContext.maxTokensOverride 有值）
//   · 换 thinking 配置（不同模型支持度不同）
// 所以模型相关的所有判断都读 retryContext 而不是 options。
//
// 结构上它分四段，读的时候按段看：
//   1539-1588  betas 与 body 附加项（effort / task_budget / output_format）
//   1590-1630  max_tokens 与 thinking 的互斥关系
//   1632-1695  context_management / 缓存 / fastMode / AFK / cacheEditing
//   1699-1728  最终对象拼装
// ═══════════════════════════════════════════════════════════════
  const paramsFromContext = (retryContext: RetryContext) => {
    const betasParams = [...betas]

// 1M 上下文是实验特性，只能按模型动态加头。
// 注意它加在 betasParams（副本）而不是 betas（外层变量）：
// betas 是跨 attempt 共享的，往里 push 会让后续 attempt 累积重复项。
    // Append 1M beta dynamically for the Sonnet 1M experiment.
    if (
      !betasParams.includes(CONTEXT_1M_BETA_HEADER) &&
      getSonnet1mExpTreatmentEnabled(retryContext.model)
    ) {
      betasParams.push(CONTEXT_1M_BETA_HEADER)
    }

// Bedrock 的特殊规矩：beta 头不能走 HTTP header，必须放进请求体
// 的 anthropic_beta 字段。所以这里先收集，交给 getExtraBodyParams 处理。
// 这也解释了行 1178 那个 `getAPIProvider() !== 'bedrock'` 的跳过判断。
    // For Bedrock, include both model-based betas and dynamically-added tool search header
    const bedrockBetas =
      getAPIProvider() === 'bedrock'
        ? [
            ...getBedrockExtraBodyParamsBetas(retryContext.model),
            ...(toolSearchHeader ? [toolSearchHeader] : []),
          ]
        : []
    const extraBodyParams = getExtraBodyParams(bedrockBetas)

// output_config 的合并策略：**先从用户的 EXTRA_BODY 里取出已有的**，
// 再往上叠加我们自己的字段（effort / task_budget / format）。
// 顺序反过来的话，用户在环境变量里手配的值会被静默覆盖 ——
// 那是最难排查的一类问题：配置明明写了却不生效。
    const outputConfig: BetaOutputConfig = {
      ...((extraBodyParams.output_config as BetaOutputConfig) ?? {}),
    }

    configureEffortParams(
      effort,
      outputConfig,
      extraBodyParams,
      betasParams,
      options.model,
    )

    configureTaskBudgetParams(
      options.taskBudget,
      outputConfig as BetaOutputConfig & { task_budget?: TaskBudgetParam },
      betasParams,
    )

    // Merge outputFormat into extraBodyParams.output_config alongside effort
    // Requires structured-outputs beta header per SDK (see parse() in messages.mjs)
    if (options.outputFormat && !('format' in outputConfig)) {
      outputConfig.format = options.outputFormat as BetaJSONOutputFormat
      // Add beta header if not already present and provider supports it
      if (
        modelSupportsStructuredOutputs(options.model) &&
        !betasParams.includes(STRUCTURED_OUTPUTS_BETA_HEADER)
      ) {
        betasParams.push(STRUCTURED_OUTPUTS_BETA_HEADER)
      }
    }

// max_tokens 的三级优先，顺序就是重要性：
//   1. retryContext.maxTokensOverride —— 重试时为了「挤进上下文窗口」而动态收紧的
//   2. options.maxOutputTokensOverride —— 调用方显式指定的
//   3. 模型默认值
// 第 1 级为什么最高：它是**为了救这次请求**才出现的，
// 如果被调用方的显式值盖掉，重试就白做了，会陷入「每次都超限」的死循环。
    // Retry context gets preference because it tries to course correct if we exceed the context window limit
    const maxOutputTokens =
      retryContext?.maxTokensOverride ||
      options.maxOutputTokensOverride ||
      getMaxOutputTokensForModel(options.model)

// 注意这里除了看配置，还看环境变量 CLAUDE_CODE_DISABLE_THINKING。
// 后面所有 thinking 相关逻辑（包括 temperature 要不要发）都以这个 hasThinking 为准，
// 所以它是一个「单一事实来源」，不要在下游再各算一遍。
    const hasThinking =
      thinkingConfig.type !== 'disabled' &&
      !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_THINKING)
    let thinking: BetaMessageStreamParams['thinking'] | undefined = undefined

// ⚠⚠ 这条注释是全文件语气的最高级别，值得原样读一遍：
//
//     "IMPORTANT: Do not change the adaptive-vs-budget thinking selection
//      below without notifying the model launch DRI and research."
//
// 为什么这么严：adaptive（模型自己决定想多久）和 budget（给死一个 token 预算）
// 对模型质量的影响非常大，而且不是单调的——某些任务给预算反而更差。
// 这类「参数敏感区」在大模型产品里普遍存在，注释是它们唯一的护栏。
//
// 代码逻辑本身很简单：
//   支持 adaptive → { type: 'adaptive' }（不带预算）
//   不支持       → { type: 'enabled', budget_tokens: min(max_tokens - 1, 默认) }
// 注意那个 max_tokens - 1：API 要求 budget_tokens 严格小于 max_tokens，
// 见行 3383 同样的约束。
    // IMPORTANT: Do not change the adaptive-vs-budget thinking selection below
    // without notifying the model launch DRI and research. This is a sensitive
    // setting that can greatly affect model quality and bashing.
    if (hasThinking && modelSupportsThinking(options.model)) {
      if (
        !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING) &&
        modelSupportsAdaptiveThinking(options.model)
      ) {
        // For models that support adaptive thinking, always use adaptive
        // thinking without a budget.
        thinking = {
          type: 'adaptive',
        } satisfies BetaMessageStreamParams['thinking']
      } else {
        // For models that do not support adaptive thinking, use the default
        // thinking budget unless explicitly specified.
        let thinkingBudget = getMaxThinkingTokensForModel(options.model)
        if (
          thinkingConfig.type === 'enabled' &&
          thinkingConfig.budgetTokens !== undefined
        ) {
          thinkingBudget = thinkingConfig.budgetTokens
        }
        thinkingBudget = Math.min(maxOutputTokens - 1, thinkingBudget)
        thinking = {
          budget_tokens: thinkingBudget,
          type: 'enabled',
        } satisfies BetaMessageStreamParams['thinking']
      }
    }

// context_management 是服务端侧的上下文策略（主要是 thinking 的清理）。
// 三个输入里 clearAllThinking 来自 latch（行 1446），
// 这意味着一旦触发过，整个会话都会持续要求服务端清理旧 thinking。
    // Get API context management strategies if enabled
    const contextManagement = getAPIContextManagement({
      hasThinking,
      isRedactThinkingActive: betasParams.includes(REDACT_THINKING_BETA_HEADER),
      clearAllThinking: thinkingClearLatched,
    })

    const enablePromptCaching =
      options.enablePromptCaching ?? getPromptCachingEnabled(retryContext.model)

// fast mode 这里体现了 latch 机制的「分工」：
//   **header**  走 latch（会话内恒定，保缓存）
//   **body speed** 走实时判断（cooldown 期间只是不发 speed，头照发）
//
// 所以 isFastModeForRetry 为假时 speed 是 undefined，但下面
// fastModeHeaderLatched 为真时照样 push FAST_MODE_BETA_HEADER。
// 这种「声明能力」和「实际使用」分离的做法，在 beta 协议里是常态。
    // Fast mode: header is latched session-stable (cache-safe), but
    // `speed='fast'` stays dynamic so cooldown still suppresses the actual
    // fast-mode request without changing the cache key.
    let speed: BetaMessageStreamParams['speed']
    const isFastModeForRetry =
      isFastModeEnabled() &&
      isFastModeAvailable() &&
      !isFastModeCooldown() &&
      isFastModeSupportedByModel(options.model) &&
      !!retryContext.fastMode
    if (isFastModeForRetry) {
      speed = 'fast'
    }
    if (fastModeHeaderLatched && !betasParams.includes(FAST_MODE_BETA_HEADER)) {
      betasParams.push(FAST_MODE_BETA_HEADER)
    }

    // AFK mode beta: latched once auto mode is first activated. Still gated
    // by isAgenticQuery per-call so classifiers/compaction don't get it.
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (
        afkHeaderLatched &&
        shouldIncludeFirstPartyOnlyBetas() &&
        isAgenticQuery &&
        !betasParams.includes(AFK_MODE_BETA_HEADER)
      ) {
        betasParams.push(AFK_MODE_BETA_HEADER)
      }
    }

    // Cache editing beta: header is latched session-stable; useCachedMC
    // (controls cache_edits body behavior) stays live so edits stop when
    // the feature disables but the header doesn't flip.
    const useCachedMC =
      cachedMCEnabled &&
      getAPIProvider() === 'firstParty' &&
      options.querySource === 'repl_main_thread'
    if (
      cacheEditingHeaderLatched &&
      getAPIProvider() === 'firstParty' &&
      options.querySource === 'repl_main_thread' &&
      !betasParams.includes(cacheEditingBetaHeader)
    ) {
      betasParams.push(cacheEditingBetaHeader)
      logForDebugging(
        'Cache editing beta header enabled for cached microcompact',
      )
    }

// temperature 只在 thinking 关闭时发送。
// 原因不是风格问题：API 硬性要求「thinking 开启时 temperature 必须是 1」，
// 而 1 又是默认值，所以干脆不发。
// 换句话说，这个三元表达式是在避免一个必然的 400。
    // Only send temperature when thinking is disabled — the API requires
    // temperature: 1 when thinking is enabled, which is already the default.
    const temperature = !hasThinking
      ? (options.temperatureOverride ?? 1)
      : undefined

    lastRequestBetas = betasParams
// lastRequestBetas 是给日志用的：把「这次实际发了哪些 beta 头」记下来，
// 后面 logAPISuccessAndDuration 会带上它（行 2886）。
// 排查「某个能力为什么没生效」时，第一个要看的就是这个字段。

// ── 最终对象拼装 ──
//
// 留意三件事：
//   1. messages 走 addCacheBreakpoints —— 缓存打点发生在这里，不在上游
//   2. 所有「可选但语义重要」的字段都用条件展开（...(x && { k: v })），
//      而不是给 undefined。原因：SDK 用键存在性判断，undefined 和不存在不等价
//   3. extraBodyParams 在 output_config 之前展开 ——
//      这样用户显式配的字段会先落地，我们的 output_config 再覆盖它
//      （与行 1559 的策略一致：我们的值优先，但只在没冲突时）
    return {
      model: normalizeModelStringForAPI(options.model),
      messages: addCacheBreakpoints(
        messagesForAPI,
        enablePromptCaching,
        options.querySource,
        useCachedMC,
        consumedCacheEdits,
        consumedPinnedEdits,
        options.skipCacheWrite,
      ),
      system,
      tools: allTools,
      tool_choice: options.toolChoice,
      ...(useBetas && { betas: betasParams }),
      metadata: getAPIMetadata(),
      max_tokens: maxOutputTokens,
      thinking,
      ...(temperature !== undefined && { temperature }),
      ...(contextManagement &&
        useBetas &&
        betasParams.includes(CONTEXT_MANAGEMENT_BETA_HEADER) && {
          context_management: contextManagement,
        }),
      ...extraBodyParams,
      ...(Object.keys(outputConfig).length > 0 && {
        output_config: outputConfig,
      }),
      ...(speed !== undefined && { speed }),
    }
  }

// ═══ 一个纯性能优化，但值得单独讲 ═══
//
// 场景：logAPIQuery 需要 getToolPermissionContext()（异步），
// 而日志是 fire-and-forget（不能 await，不能拖慢请求）。
//
// 直觉写法是：
//     void options.getToolPermissionContext().then(ctx => {
//       logAPIQuery({ ..., messages: queryParams.messages, betas: queryParams.betas })
//     })
// 问题：闭包捕获了 queryParams，而 queryParams 引用了 messagesForAPI ——
// **整个对话历史（可能几十 K token 的对象树）**。这个闭包会被 pin 在
// promise 上直到 resolve，期间一直不能被 GC。
//
// 所以这里先把要用的标量取出来（length / betas 数组 / thinking type / effort），
// 让闭包只捕获几个原始值。注释里「pinned until the promise resolves」就是这个意思。
//
// 同一个模式在行 2852 的 logAPISuccessAndDuration 里又出现一次。
  // Compute log scalars synchronously so the fire-and-forget .then() closure
  // captures only primitives instead of paramsFromContext's full closure scope
  // (messagesForAPI, system, allTools, betas — the entire request-building
  // context), which would otherwise be pinned until the promise resolves.
  {
    const queryParams = paramsFromContext({
      model: options.model,
      thinkingConfig,
    })
    const logMessagesLength = queryParams.messages.length
    const logBetas = useBetas ? (queryParams.betas ?? []) : []
    const logThinkingType = queryParams.thinking?.type ?? 'disabled'
    const logEffortValue = queryParams.output_config?.effort
    void options.getToolPermissionContext().then(permissionContext => {
      logAPIQuery({
        model: options.model,
        messagesLength: logMessagesLength,
        temperature: options.temperatureOverride ?? 1,
        betas: logBetas,
        permissionMode: permissionContext.mode,
        querySource: options.querySource,
        queryTracking: options.queryTracking,
        thinkingType: logThinkingType,
        effortValue: logEffortValue,
        fastMode: isFastMode,
        previousRequestId,
      })
    })
  }

// ═══ 流解析的「半成品状态」 ═══
//
// 这十几个变量就是「流式事件是碎片」的直接体现：
//
//   partialMessage    message_start 给的骨架（content 是空的、usage 是 0）
//   contentBlocks     按 index 存放，每个块逐步长大
//   usage             累积用量（注意 API 给的是累计值，见行 2916）
//   stopReason        message_delta 才有，之前一直是 null
//   newMessages       已经 yield 出去的 assistant 消息（可能要回写）
//   fallbackMessage   非流式兜底产出的消息
//
// 为什么这些不能是函数参数或返回值：它们要跨几十个事件存活，
// 而且要在 catch 块和 finally 块里被读到。只能放在 try 外面。
  const newMessages: AssistantMessage[] = []
  let ttftMs = 0
  let partialMessage: BetaMessage | undefined = undefined
  const contentBlocks: (BetaContentBlock | ConnectorTextBlock)[] = []
  let usage: NonNullableUsage = EMPTY_USAGE
  let costUSD = 0
  let stopReason: BetaStopReason | null = null
  let didFallBackToNonStreaming = false
  let fallbackMessage: AssistantMessage | undefined
  let maxOutputTokens = 0
  let responseHeaders: globalThis.Headers | undefined = undefined
  let research: unknown = undefined
  let isFastModeRequest = isFastMode // Keep separate state as it may change if falling back
  let isAdvisorInProgress = false

  try {
    queryCheckpoint('query_client_creation_start')
// ═══ 发请求：withRetry 包一层 ═══
//
// 注意 maxRetries: 0 —— 显式关掉 SDK 自带的重试。
// 注释说得清楚：manual implementation。为什么不用 SDK 的？
// 因为重试要做的事远超「再发一次」：换模型、缩 max_tokens、
// 识别 529 并统计连续次数、在特定错误上放弃、把重试进度 yield 给 UI。
//
// withRetry 的形态值得记住：它是一个生成器工厂，
// 第一参数建客户端（可能失败，比如认证错误要重建），
// 第二参数是真正的 attempt 函数，第三参数是重试策略。
    const generator = withRetry(
      () =>
        getAnthropicClient({
          maxRetries: 0, // Disabled auto-retry in favor of manual implementation
          model: options.model,
          fetchOverride: options.fetchOverride,
          source: options.querySource,
        }),
      async (anthropic, attempt, context) => {
        attemptNumber = attempt
        isFastModeRequest = context.fastMode ?? false
        start = Date.now()
        attemptStartTimes.push(start)
        // Client has been created by withRetry's getClient() call. This fires
        // once per attempt; on retries the client is usually cached (withRetry
        // only calls getClient() again after auth errors), so the delta from
        // client_creation_start is meaningful on attempt 1.
        queryCheckpoint('query_client_creation_end')

// paramsFromContext(context) —— 每次 attempt 重新构造。
// 紧接着的 captureAPIRequest 把参数存下来给 bug report 用：
// 用户反馈问题时，能附上「当时到底发了什么」。
        const params = paramsFromContext(context)
        captureAPIRequest(params, options.querySource) // Capture for bug reports

        maxOutputTokens = params.max_tokens

// queryCheckpoint 的位置很讲究（注释也强调了）：
// 必须在 .withResponse() **之前**打点。
// 因为 withResponse 会一直 await 到响应头到达，
// 放后面的话「网络 TTFB」这个阶段的耗时就会被算错。
        // Fire immediately before the fetch is dispatched. .withResponse() below
        // awaits until response headers arrive, so this MUST be before the await
        // or the "Network TTFB" phase measurement is wrong.
        queryCheckpoint('query_api_request_sent')
        if (!options.agentId) {
          headlessProfilerCheckpoint('api_request_sent')
        }

// clientRequestId：客户端自己生成的一个 UUID，通过 header 发出去。
//
// 为什么需要它：超时的时候服务端**根本没有 request id**（请求可能没到），
// 这时想在自己的日志和服务端日志之间对上号，只能靠客户端预先埋的 id。
// 注释里的 inc-4029 就是这个需求的事故编号。
//
// 只对第一方生效：第三方（Bedrock/Vertex）不会记录这个头。
        // Generate and track client request ID so timeouts (which return no
        // server request ID) can still be correlated with server logs.
        // First-party only — 3P providers don't log it (inc-4029 class).
        clientRequestId =
          getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
            ? randomUUID()
            : undefined

// ⚠ 这里是一个有明确性能理由的「不用官方封装」决策：
//
//     BetaMessageStream 会对每个 input_json_delta 调 partialParse()
//
// 也就是说，如果一个工具参数是 500 个片段拼成的 JSON，
// 官方封装会把它从 1 个片段解析到 500 个片段，每次从头解析一遍 ——
// O(n²)。而实际上我们**不需要一部分的 JSON**：工具要等参数收完才能执行，
// 中间态完全没用。
//
// 所以这里用 raw stream + 自己拼字符串（行 2111 contentBlock.input += ...），
// 到 content_block_stop 时才解析一次。
        // Use raw stream instead of BetaMessageStream to avoid O(n²) partial JSON parsing
        // BetaMessageStream calls partialParse() on every input_json_delta, which we don't need
        // since we handle tool input accumulation ourselves
        // biome-ignore lint/plugin: main conversation loop handles attribution separately
        const result = await anthropic.beta.messages
          .create(
            { ...params, stream: true },
            {
              signal,
              ...(clientRequestId && {
                headers: { [CLIENT_REQUEST_ID_HEADER]: clientRequestId },
              }),
            },
          )
          .withResponse()
        queryCheckpoint('query_response_headers_received')
        streamRequestId = result.request_id
        streamResponse = result.response
        return result.data
      },
      {
        model: options.model,
        fallbackModel: options.fallbackModel,
        thinkingConfig,
        ...(isFastModeEnabled() ? { fastMode: isFastMode } : false),
        signal,
        querySource: options.querySource,
      },
    )

// 又是「生成器套生成器」的拉取模式，和行 908 一样：
// withRetry 在重试之间 yield 出 system 消息，这里边拉边转发。
//
// 那句 `!'controller' in e.value` 是个类型判断的土办法：
// Stream 对象有 controller 属性，SystemAPIErrorMessage 没有。
// done 之后 e.value 就是 Stream。
    let e
    do {
      e = await generator.next()

      // yield API error messages (the stream has a 'controller' property, error messages don't)
      if (!('controller' in e.value)) {
        yield e.value
      }
    } while (!e.done)
    stream = e.value as Stream<BetaRawMessageStreamEvent>

// 为什么要 reset 一遍？因为上面那段拉取可能经历了多次重试，
// 每次重试理论上都重置过这些状态，但**最后一次 attempt 的残留**必须清掉，
// 否则会把上一次 attempt 的部分内容和新流混在一起。
// 这类「拿到资源后立刻重置」的写法，在流式代码里是防脏数据的标配。
    // reset state
    newMessages.length = 0
    ttftMs = 0
    partialMessage = undefined
    contentBlocks.length = 0
    usage = EMPTY_USAGE
    stopReason = null
    isAdvisorInProgress = false

// ═══ 流式 idle 看门狗 ═══
//
// 为什么需要：SDK 的 request timeout 只覆盖**初始 fetch()**，
// 不覆盖流式 body。所以连接被静默丢弃后，for await 会永远挂着，
// 会话就卡死了。
//
// 默认 90 秒没收到任何 chunk 就主动 abort；一半时间（45s）先打 warning。
// 这个看门狗和下面的 stall detection（行 1944）是**互补**的：
//
//   看门狗         → setTimeout 主动杀，即使后面再也收不到任何东西
//   stall 检测     → 只在**下一块到达时**才算，纯被动记录
//
// 只用 stall 检测的话，连接彻底断了就永远等不到「下一块」，检测永远不会触发。
    // Streaming idle timeout watchdog: abort the stream if no chunks arrive
    // for STREAM_IDLE_TIMEOUT_MS. Unlike the stall detection below (which only
    // fires when the *next* chunk arrives), this uses setTimeout to actively
    // kill hung streams. Without this, a silently dropped connection can hang
    // the session indefinitely since the SDK's request timeout only covers the
    // initial fetch(), not the streaming body.
    const streamWatchdogEnabled = isEnvTruthy(
      process.env.CLAUDE_ENABLE_STREAM_WATCHDOG,
    )
    const STREAM_IDLE_TIMEOUT_MS =
      parseInt(process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS || '', 10) || 90_000
    const STREAM_IDLE_WARNING_MS = STREAM_IDLE_TIMEOUT_MS / 2
    let streamIdleAborted = false
    // performance.now() snapshot when watchdog fires, for measuring abort propagation delay
    let streamWatchdogFiredAt: number | null = null
    let streamIdleWarningTimer: ReturnType<typeof setTimeout> | null = null
    let streamIdleTimer: ReturnType<typeof setTimeout> | null = null
    function clearStreamIdleTimers(): void {
      if (streamIdleWarningTimer !== null) {
        clearTimeout(streamIdleWarningTimer)
        streamIdleWarningTimer = null
      }
      if (streamIdleTimer !== null) {
        clearTimeout(streamIdleTimer)
        streamIdleTimer = null
      }
    }
// 每收到一个 chunk 就重置计时器 —— 这是「idle」语义的实现方式：
// 计时的对象是「距离上一块的间隔」，不是「整个流的时长」。
    function resetStreamIdleTimer(): void {
      clearStreamIdleTimers()
      if (!streamWatchdogEnabled) {
        return
      }
      streamIdleWarningTimer = setTimeout(
        warnMs => {
          logForDebugging(
            `Streaming idle warning: no chunks received for ${warnMs / 1000}s`,
            { level: 'warn' },
          )
          logForDiagnosticsNoPII('warn', 'cli_streaming_idle_warning')
        },
        STREAM_IDLE_WARNING_MS,
        STREAM_IDLE_WARNING_MS,
      )
      streamIdleTimer = setTimeout(() => {
        streamIdleAborted = true
        streamWatchdogFiredAt = performance.now()
        logForDebugging(
          `Streaming idle timeout: no chunks received for ${STREAM_IDLE_TIMEOUT_MS / 1000}s, aborting stream`,
          { level: 'error' },
        )
        logForDiagnosticsNoPII('error', 'cli_streaming_idle_timeout')
        logEvent('tengu_streaming_idle_timeout', {
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          request_id: (streamRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          timeout_ms: STREAM_IDLE_TIMEOUT_MS,
        })
        releaseStreamResources()
      }, STREAM_IDLE_TIMEOUT_MS)
    }
    resetStreamIdleTimer()

    startSessionActivity('api_call')
// startSessionActivity('api_call') 和 finally 里的 stopSessionActivity('api_call')
// 是一对：作用是告诉系统「现在有网络活动，别因为空闲而挂起/休眠」。
// 注意它放在 try 外面，因为要让 finally 一定能配对到。
// ═══════════════════════════════════════════════════════════════
// 流解析主循环 —— 从 1932 到 2403，约 470 行
//
// 结构极其简单，就一层 for await + 一个 switch：
//
//     for await (const part of stream) {
//        重置看门狗
//        检测 stall
//        第一次到达 → 打点
//        switch (part.type) {
//          case 'message_start'        → 存骨架、算 TTFT
//          case 'content_block_start'  → 建空壳
//          case 'content_block_delta'  → 往空壳里累加
//          case 'content_block_stop'   → 收口，yield 一条 assistant 消息
//          case 'message_delta'        → 回写 usage / stop_reason
//          case 'message_stop'         → 什么都不做
//        }
//        yield { type: 'stream_event', event: part }   ← 给 UI 的原始增量
//     }
//
// 注意最后那个 yield：**每个**原始事件都会原样转给 UI（做打字机效果），
// 而 assistant 消息只在 content_block_stop 时 yield 一次。
// 这就是「内部累积」和「对外流式」两条通道。
    try {
      // stream in and accumulate state
      let isFirstChunk = true
      let lastEventTime: number | null = null // Set after first chunk to avoid measuring TTFB as a stall
      const STALL_THRESHOLD_MS = 30_000 // 30 seconds
      let totalStallTime = 0
      let stallCount = 0

      for await (const part of stream) {
        resetStreamIdleTimer()
        const now = Date.now()

// stall 检测：只记录不干预。两个刻意设计：
//   1. 只在**第一块之后**开始计时（lastEventTime 初始为 null），
//      否则 TTFT（首字延迟）会被误算成一次 stall
//   2. 阈值 30s 比看门狗的 90s 小 —— 所以正常情况下会先看到
//      「stall 警告」再看到「idle 超时」，日志顺序本身就说明了问题的严重程度
        // Detect and log streaming stalls (only after first event to avoid counting TTFB)
        if (lastEventTime !== null) {
          const timeSinceLastEvent = now - lastEventTime
          if (timeSinceLastEvent > STALL_THRESHOLD_MS) {
            stallCount++
            totalStallTime += timeSinceLastEvent
            logForDebugging(
              `Streaming stall detected: ${(timeSinceLastEvent / 1000).toFixed(1)}s gap between events (stall #${stallCount})`,
              { level: 'warn' },
            )
            logEvent('tengu_streaming_stall', {
              stall_duration_ms: timeSinceLastEvent,
              stall_count: stallCount,
              total_stall_time_ms: totalStallTime,
              event_type:
                part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              request_id: (streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
          }
        }
        lastEventTime = now

        if (isFirstChunk) {
          logForDebugging('Stream started - received first chunk')
          queryCheckpoint('query_first_chunk_received')
          if (!options.agentId) {
            headlessProfilerCheckpoint('first_chunk')
          }
          endQueryProfile()
          isFirstChunk = false
        }

// switch 的六个分支，按「信息量从少到多」排列。
// 读的时候重点看 content_block_start 和 content_block_delta 这两段，
// 它们是「碎片如何拼成完整块」的全部秘密。
        switch (part.type) {
// message_start：整条流的第一个事件，给的是**骨架**。
// partialMessage = part.message 里 content 是空数组、usage 只有 input_tokens、
// stop_reason 是 null —— 后面的所有内容都往这个骨架上补。
//
// ttftMs 只在这里算一次：Date.now() - start 就是「首字延迟」，
// 这是衡量服务端响应速度最直接的指标。
          case 'message_start': {
            partialMessage = part.message
            ttftMs = Date.now() - start
            usage = updateUsage(usage, part.message?.usage)
            // Capture research from message_start if available (internal only).
            // Always overwrite with the latest value.
            if (
              process.env.USER_TYPE === 'ant' &&
              'research' in (part.message as unknown as Record<string, unknown>)
            ) {
              research = (part.message as unknown as Record<string, unknown>)
                .research
            }
            break
          }
// ═══ content_block_start：给每个块造一个「空壳」 ═══
//
// 四种类型各自要初始化不同的字段，原因都一样：
// **后面要用 += 往里累加，字段必须先存在且类型正确。**
//
//   tool_use          → input: ''（字符串！不是对象）
//   server_tool_use   → input: ''（要 as unknown as 骗过类型系统）
//   text              → text: ''
//   thinking          → thinking: '' + signature: ''
//
// 注意 tool_use 的 input 初始化成**空字符串**而不是 {}，
// 这不是笔误：delta 阶段拿到的是 JSON 文本片段（partial_json），
// 先拼成字符串，到 stop 时才 JSON.parse。见行 2111。
          case 'content_block_start':
            switch (part.content_block.type) {
              case 'tool_use':
                contentBlocks[part.index] = {
                  ...part.content_block,
                  input: '',
                }
                break
              case 'server_tool_use':
                contentBlocks[part.index] = {
                  ...part.content_block,
                  input: '' as unknown as { [key: string]: unknown },
                }
                if ((part.content_block.name as string) === 'advisor') {
                  isAdvisorInProgress = true
                  logForDebugging(`[AdvisorTool] Advisor tool called`)
                  logEvent('tengu_advisor_tool_call', {
                    model:
                      options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    advisor_model: (advisorModel ??
                      'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  })
                }
                break
// 这段注释（2022-2026）指出了 SDK 的一个真实 bug：
// content_block_start 里有时**已经带了部分文本**，然后 content_block_delta
// 又把同样的文本再发一遍。我们无法区分「是重复」还是「是续写」，
// 所以干脆在 start 时把 text 清空，只信 delta。
//
// 代价：如果某些情况下文本**只**在 start 里出现、delta 里没有，
// 那部分会丢。作者判断这种情况不存在（所以注释里说
// "there doesn't seem to be a way to detect"——承认这是权宜之计）。
              case 'text':
                contentBlocks[part.index] = {
                  ...part.content_block,
                  // awkwardly, the sdk sometimes returns text as part of a
                  // content_block_start message, then returns the same text
                  // again in a content_block_delta message. we ignore it here
                  // since there doesn't seem to be a way to detect when a
                  // content_block_delta message duplicates the text.
                  text: '',
                }
                break
// thinking 块需要 **两个** 初始字段，且理由不同：
//   thinking: ''   → 下面要 thinking += delta.thinking
//   signature: ''  → signature_delta 可能永远不来，但后续请求要求这个字段存在，
//                    否则 API 会认为「这个 thinking 块没有签名」而拒绝整条历史。
//
// 注释里三个 "awkward" / "also awkward" / "even more awkwardly"
// 连成一条吐槽线：这四种块没有统一协议，每种都有各自的历史包袱。
              case 'thinking':
                contentBlocks[part.index] = {
                  ...part.content_block,
                  // also awkward
                  thinking: '',
                  // initialize signature to ensure field exists even if signature_delta never arrives
                  signature: '',
                }
                break
              default:
                // even more awkwardly, the sdk mutates the contents of text blocks
                // as it works. we want the blocks to be immutable, so that we can
                // accumulate state ourselves.
                contentBlocks[part.index] = { ...part.content_block }
                if (
                  (part.content_block.type as string) === 'advisor_tool_result'
                ) {
                  isAdvisorInProgress = false
                  logForDebugging(`[AdvisorTool] Advisor tool result received`)
                }
                break
            }
            break
// ═══ content_block_delta：把碎片累加进空壳 ═══
//
// 这里每个 case 的骨架都一样，三件事：
//   1. 校验块类型对不对（不对就 logEvent + throw）
//   2. 校验要累加的字段类型对不对
//   3. += 累加
//
// 为什么每个 case 都要重复这套校验（看起来啰嗦）：
// SSE 是文本协议，服务端如果因为版本不一致发出意外的 delta，
// 这里不拦就会变成「静默拼出错误内容」——比直接报错难查得多。
// 每次校验都带 logEvent，是为了从线上数据里反推协议不匹配的情况。
          case 'content_block_delta': {
            const contentBlock = contentBlocks[part.index]
            const delta = part.delta as typeof part.delta | ConnectorTextDelta
// index 找不到对应的块，直接 RangeError。
// 这个判断在正常网络下永远不成立，成立就说明事件顺序错乱——
// 那已经不是「恢复」能解决的，必须让整条请求失败重来。
            if (!contentBlock) {
              logEvent('tengu_streaming_error', {
                error_type:
                  'content_block_not_found_delta' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                part_type:
                  part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                part_index: part.index,
              })
              throw new RangeError('Content block not found')
            }
// connector_text 是第三方连接器产出的文本，走独立的 delta 类型。
// feature() 判断放在最外层而不是 case 里，是为了让整段在外部构建中被删掉。
            if (
              feature('CONNECTOR_TEXT') &&
              delta.type === 'connector_text_delta'
            ) {
              if (contentBlock.type !== 'connector_text') {
                logEvent('tengu_streaming_error', {
                  error_type:
                    'content_block_type_mismatch_connector_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  expected_type:
                    'connector_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  actual_type:
                    contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                throw new Error('Content block is not a connector_text block')
              }
              contentBlock.connector_text += delta.connector_text
            } else {
              switch (delta.type) {
// citations（引用）收到但没处理——TODO。
// 这是「协议支持了但产品还没做」的地方，留着不报错是为了向前兼容：
// 服务端开始发 citations_delta 时，旧客户端不会崩。
                case 'citations_delta':
                  // TODO: handle citations
                  break
// ⚠ 全文件最关键的几行之一：tool_use 的参数是**分段拼出来的 JSON 字符串**。
//
// 服务端发的是 input_json_delta { partial_json: '{"path":' }、
// { partial_json: '"a.txt"}' }…… 我们一路 += 成完整字符串，
// 到 content_block_stop 才 JSON.parse（在 normalizeContentFromAPI 里做）。
//
// 这就是行 1818 不用 BetaMessageStream 的原因：官方封装会在每个片段上
// 做 partialParse()，是 O(n²)；我们只需要最后一次解析。
//
// 两个校验也说明了预期：块类型必须是 tool_use / server_tool_use，
// input 必须是 string。只要有一处不符，就说明有人（或某个网关）
// 改写了协议，宁可报错也别拼出错误参数去执行工具。
                case 'input_json_delta':
                  if (
                    contentBlock.type !== 'tool_use' &&
                    contentBlock.type !== 'server_tool_use'
                  ) {
                    logEvent('tengu_streaming_error', {
                      error_type:
                        'content_block_type_mismatch_input_json' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      expected_type:
                        'tool_use' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      actual_type:
                        contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                    throw new Error('Content block is not a input_json block')
                  }
                  if (typeof contentBlock.input !== 'string') {
                    logEvent('tengu_streaming_error', {
                      error_type:
                        'content_block_input_not_string' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      input_type:
                        typeof contentBlock.input as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                    throw new Error('Content block input is not a string')
                  }
                  contentBlock.input += delta.partial_json
                  break
// 纯文本增量，最常见的一种。
                case 'text_delta':
                  if (contentBlock.type !== 'text') {
                    logEvent('tengu_streaming_error', {
                      error_type:
                        'content_block_type_mismatch_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      expected_type:
                        'text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      actual_type:
                        contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                    throw new Error('Content block is not a text block')
                  }
                  contentBlock.text += delta.text
                  break
// signature 是 thinking 块的密码学签名，模型切分点绑定。
// 它和 thinking 内容是**分开的两次 delta**，所以下面要单独处理。
//
// CONNECTOR_TEXT 分支说明 connector_text 块也用 signature 字段，
// 但语义不同（不是模型签名，是连接器标识）——所以先判断再赋值。
                case 'signature_delta':
                  if (
                    feature('CONNECTOR_TEXT') &&
                    contentBlock.type === 'connector_text'
                  ) {
                    contentBlock.signature = delta.signature
                    break
                  }
                  if (contentBlock.type !== 'thinking') {
                    logEvent('tengu_streaming_error', {
                      error_type:
                        'content_block_type_mismatch_thinking_signature' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      expected_type:
                        'thinking' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      actual_type:
                        contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                    throw new Error('Content block is not a thinking block')
                  }
                  contentBlock.signature = delta.signature
                  break
// thinking 正文增量。和 text_delta 几乎一样，
// 但必须校验类型：把 thinking 混进 text 会让 UI 显示出模型内心独白。
                case 'thinking_delta':
                  if (contentBlock.type !== 'thinking') {
                    logEvent('tengu_streaming_error', {
                      error_type:
                        'content_block_type_mismatch_thinking_delta' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      expected_type:
                        'thinking' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      actual_type:
                        contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                    throw new Error('Content block is not a thinking block')
                  }
                  contentBlock.thinking += delta.thinking
                  break
              }
            }
// research 是内部字段（USER_TYPE === 'ant'），从每个 delta 里「顺手抓」，
// 而且注释强调 always overwrite —— 只留最新值，不留历史。
// `'research' in part` 用 in 而不是判 undefined，
// 是为了区分「没有这个字段」和「有这个字段但值是 undefined」。
            // Capture research from content_block_delta if available (internal only).
            // Always overwrite with the latest value.
            if (process.env.USER_TYPE === 'ant' && 'research' in part) {
              research = (part as { research: unknown }).research
            }
            break
          }
// ═══ content_block_stop：一个块长完了，收口成一条消息 ═══
//
// 这是全流程的「兑现点」：前面所有累加都在这个块里变成
// 一条完整的 AssistantMessage，push 进 newMessages 并 yield 出去。
//
// 三个细节：
//   1. message 用 { ...partialMessage } —— 骨架里的 model / usage 等元信息沿用
//   2. content 只放**当前这一块**，不是整个 contentBlocks 数组。
//      也就是说一个响应里如果有 text + tool_use 两个块，
//      会产生**两条** assistant 消息，各自带一个 content。
//      上层（query.ts）负责按顺序把它们摊平成一条逻辑消息。
//   3. normalizeContentFromAPI 在这一步做 JSON.parse（把 input 字符串变对象）
          case 'content_block_stop': {
            const contentBlock = contentBlocks[part.index]
            if (!contentBlock) {
              logEvent('tengu_streaming_error', {
                error_type:
                  'content_block_not_found_stop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                part_type:
                  part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                part_index: part.index,
              })
              throw new RangeError('Content block not found')
            }
// partialMessage 为空意味着收到了 block 事件却没有 message_start。
// 这是代理/网关篡改 SSE 的典型症状（比如把事件重排、或只转发部分）。
// 直接抛错，让外层走非流式兜底。
            if (!partialMessage) {
              logEvent('tengu_streaming_error', {
                error_type:
                  'partial_message_not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                part_type:
                  part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              throw new Error('Message not found')
            }
            const m: AssistantMessage = {
              message: {
                ...partialMessage,
                content: normalizeContentFromAPI(
                  [contentBlock] as BetaContentBlock[],
                  tools,
                  options.agentId,
                ),
              },
              requestId: streamRequestId ?? undefined,
              type: 'assistant',
              uuid: randomUUID(),
              timestamp: new Date().toISOString(),
              ...(process.env.USER_TYPE === 'ant' &&
                research !== undefined && { research }),
              ...(advisorModel && { advisorModel }),
            }
            newMessages.push(m)
            yield m
            break
          }
// ═══ message_delta：整条流的「结算事件」 ═══
//
// 两个作用：
//   1. usage 的**最终值**在这里（message_start 给的 output_tokens 是 0）
//   2. stop_reason 在这里（之前一直是 null）
//
// 但问题在于：content_block_stop 已经把消息 yield 出去了，
// 那时 usage/stop_reason 还是旧值。所以这里必须**回头改已 yield 的对象**。
          case 'message_delta': {
            usage = updateUsage(usage, part.usage)
            // Capture research from message_delta if available (internal only).
            // Always overwrite with the latest value. Also write back to
            // already-yielded messages since message_delta arrives after
            // content_block_stop.
            if (
              process.env.USER_TYPE === 'ant' &&
              'research' in (part as unknown as Record<string, unknown>)
            ) {
              research = (part as unknown as Record<string, unknown>).research
              for (const msg of newMessages) {
                msg.research = research
              }
            }

// ⚠ 这段注释（2229-2241）是全文件最实用的一个坑，值得逐字读：
//
//     "IMPORTANT: Use direct property mutation, not object replacement.
//      The transcript write queue holds a reference to message.message
//      and serializes it lazily (100ms flush interval)."
//
// 翻译：会话落盘有一个 100ms 的延迟队列，它持有的是**对象的引用**，
// 在真正序列化时才读值。
//
// 所以如果你写：
//     lastMsg.message = { ...lastMsg.message, usage }     ← 错
// 队列里那个引用还指着旧对象，落盘时序列化出的是 output_tokens: 0、
// stop_reason: null 的版本。会话恢复后成本统计全是 0，排查极其困难。
//
// 正确写法是**原地改属性**：
//     lastMsg.message.usage = usage                        ← 对
// 引用不变，队列在 flush 时读到的是新值。
            // Write final usage and stop_reason back to the last yielded
            // message. Messages are created at content_block_stop from
            // partialMessage, which was set at message_start before any tokens
            // were generated (output_tokens: 0, stop_reason: null).
            // message_delta arrives after content_block_stop with the real
            // values.
            //
            // IMPORTANT: Use direct property mutation, not object replacement.
            // The transcript write queue holds a reference to message.message
            // and serializes it lazily (100ms flush interval). Object
            // replacement ({ ...lastMsg.message, usage }) would disconnect
            // the queued reference; direct mutation ensures the transcript
            // captures the final values.
            stopReason = part.delta.stop_reason

            const lastMsg = newMessages.at(-1)
            if (lastMsg) {
              lastMsg.message.usage = usage
              lastMsg.message.stop_reason = stopReason
            }

            // Update cost
// 成本要在这里算，而不是等流结束。
// 因为 message_delta 是 usage 唯一可靠的出现位置，
// 而后面可能还有异常/降级，流结束时 usage 未必还在作用域里。
            const costUSDForPart = calculateUSDCost(resolvedModel, usage)
            costUSD += addToTotalSessionCost(
              costUSDForPart,
              usage,
              options.model,
            )

// 拒答检测：某些 stop_reason 意味着模型拒绝回答（安全策略）。
// 这时要 yield 一条**错误消息**，让上层把它当成失败处理，
// 而不是当成一段正常（但很短的）回复。
            const refusalMessage = getErrorMessageIfRefusal(
              part.delta.stop_reason,
              options.model,
            )
            if (refusalMessage) {
              yield refusalMessage
            }

// ═══ max_tokens 截断 ═══
//
// 两个动作：
//   1. logEvent 记一条（监控「有多少请求撞到上限」）
//   2. yield 一条错误消息，apiError 设为 'max_output_tokens'
//
// 为什么要 yield 错误而不是静默接受：
// 这个特定的 apiError 值会被 query.ts 识别，触发**自动升级重试**
// （max_output_tokens_escalate：把上限提到 64k 再来一次）。
// 静默接受的话，模型会拿到半截回答，然后在下一轮基于半截内容继续，
// 结果越跑越偏。
            if (stopReason === 'max_tokens') {
              logEvent('tengu_max_tokens_reached', {
                max_tokens: maxOutputTokens,
              })
              yield createAssistantAPIErrorMessage({
                content: `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${
                  maxOutputTokens
                } output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.`,
                apiError: 'max_output_tokens',
                error: 'max_output_tokens',
              })
            }

// model_context_window_exceeded：上下文窗口撞墙了。
// 注释说明了处理策略——**复用 max_tokens 的恢复路径**。
//
// 从模型的角度看，这两种情况的含义是一样的：「我说到一半被截断了，接着来」。
// 所以故意发同样的 apiError 值，让 query.ts 走同一套恢复流程。
// 这类「用同一个错误类型表达语义相近的两种状态」在协议设计里很常见，
// 代价是日志里要靠 stopReason 区分。
            if (stopReason === 'model_context_window_exceeded') {
              logEvent('tengu_context_window_exceeded', {
                max_tokens: maxOutputTokens,
                output_tokens: usage.output_tokens,
              })
              // Reuse the max_output_tokens recovery path — from the model's
              // perspective, both mean "response was cut off, continue from
              // where you left off."
              yield createAssistantAPIErrorMessage({
                content: `${API_ERROR_MESSAGE_PREFIX}: The model has reached its context window limit.`,
                apiError: 'max_output_tokens',
                error: 'max_output_tokens',
              })
            }
            break
          }
          case 'message_stop':
// message_stop 什么都不做。
// 它是「流正常结束」的标记，但真实的收尾判断在循环外面（行 2350），
// 因为流也可能**没有** message_stop 就断了 —— 那才是要检测的情况。
            break
        }

// 每个原始事件都原样转出去，给 UI 做打字机效果。
//
// ttftMs 只在 message_start 那条带上（条件展开）。
// 这样 UI 收到的第一条事件就附带「首字延迟」，
// 不用自己算时间差（客户端时钟和服务端不可比）。
        yield {
          type: 'stream_event',
          event: part,
          ...(part.type === 'message_start' ? { ttftMs } : undefined),
        }
      }
// 循环退出，先拆看门狗 —— 不管是正常结束还是异常退出，
// 都不能留着定时器（否则 90 秒后会莫名其妙 abort 一个已经结束的流）。
      // Clear the idle timeout watchdog now that the stream loop has exited
      clearStreamIdleTimers()

      // If the stream was aborted by our idle timeout watchdog, fall back to
      // non-streaming retry rather than treating it as a completed stream.
// ═══ 三种「流结束了但结果不对」的检测，从这里开始 ═══
//
// 第一种：看门狗杀的流。
// 这里不是 return，而是 **throw** —— 故意的，为了让下面的 catch 块接住，
// 走「流式失败 → 非流式兜底」那条路。
//
// 那段 instrumentation 注释很值得看：exit_delay_ms 测的是
// 「abort 信号发出到 for await 真正退出」的延迟。
//   0-10ms    → abort 生效了，一切正常
//   >>1000ms  → 有别的东西唤醒了循环（说明 abort 根本没起作用）
// 这种「证明清理逻辑真的生效」的埋点，在排查挂死类问题时是救命稻草。
      if (streamIdleAborted) {
        // Instrumentation: proves the for-await exited after the watchdog fired
        // (vs. hung forever). exit_delay_ms measures abort propagation latency:
        // 0-10ms = abort worked; >>1000ms = something else woke the loop.
        const exitDelayMs =
          streamWatchdogFiredAt !== null
            ? Math.round(performance.now() - streamWatchdogFiredAt)
            : -1
        logForDiagnosticsNoPII(
          'info',
          'cli_stream_loop_exited_after_watchdog_clean',
        )
        logEvent('tengu_stream_loop_exited_after_watchdog', {
          request_id: (streamRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          exit_delay_ms: exitDelayMs,
          exit_path:
            'clean' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        // Prevent double-emit: this throw lands in the catch block below,
        // whose exit_path='error' probe guards on streamWatchdogFiredAt.
        streamWatchdogFiredAt = null
        throw new Error('Stream idle timeout - no chunks received')
      }

// 第二种：流正常结束，但一条 assistant 消息都没产出。
//
// 注释列了两个代理故障模式，都是真实遇到过的：
//   1. 完全没事件（!partialMessage）→ 代理返回 200 但 body 不是 SSE
//   2. 有 message_start 但没有 content_block_stop 也没有 stop_reason
//      → 代理转到一半断了
//
// 为什么会写这段：BetaMessageStream 在 _endRequest() 里有这个检查，
// 但我们用的是 raw Stream（行 1818 换的），它没有 —— 于是自己补。
// 不补的后果很隐蔽：生成器静默返回空，上层拿到 undefined，
// -p 模式下报一个看不出原因的 "Execution error"。
// ⚠ 这个 stopReason 判断是防止**误报**的关键，注释给的例子特别值得记：
//
// 结构化输出（--json-schema）模式下，模型第一轮调 StructuredOutput 工具，
// 第二轮只回一个 end_turn、**零个内容块**。
// 这是完全合法的空回复，不是流坏了。
//
// 所以判据不能是「newMessages 为空」，必须是「为空**且**没有 stop_reason」。
// stop_reason 有值 = 服务端明确表示「这一轮结束了」，那就信它。
      // Detect when the stream completed without producing any assistant messages.
      // This covers two proxy failure modes:
      // 1. No events at all (!partialMessage): proxy returned 200 with non-SSE body
      // 2. Partial events (partialMessage set but no content blocks completed AND
      //    no stop_reason received): proxy returned message_start but stream ended
      //    before content_block_stop and before message_delta with stop_reason
      // BetaMessageStream had the first check in _endRequest() but the raw Stream
      // does not - without it the generator silently returns no assistant messages,
      // causing "Execution error" in -p mode.
      // Note: We must check stopReason to avoid false positives. For example, with
      // structured output (--json-schema), the model calls a StructuredOutput tool
      // on turn 1, then on turn 2 responds with end_turn and no content blocks.
      // That's a legitimate empty response, not an incomplete stream.
      if (!partialMessage || (newMessages.length === 0 && !stopReason)) {
        logForDebugging(
          !partialMessage
            ? 'Stream completed without receiving message_start event - triggering non-streaming fallback'
            : 'Stream completed with message_start but no content blocks completed - triggering non-streaming fallback',
          { level: 'error' },
        )
        logEvent('tengu_stream_no_events', {
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          request_id: (streamRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw new Error('Stream ended without receiving any events')
      }

// stall 统计只是诊断，不影响结果。
// 但如果日志里频繁出现 stall_count，说明网络或服务端有抖动，
// 这比等用户投诉「有时候很慢」要早得多。
      // Log summary if any stalls occurred during streaming
      if (stallCount > 0) {
        logForDebugging(
          `Streaming completed with ${stallCount} stall(s), total stall time: ${(totalStallTime / 1000).toFixed(1)}s`,
          { level: 'warn' },
        )
        logEvent('tengu_streaming_stall_summary', {
          stall_count: stallCount,
          total_stall_time_ms: totalStallTime,
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          request_id: (streamRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }

// ⚠ 缓存断裂检测的**消费端**（记录端在行 1460）。
//
// 判据完全来自响应头/usage：如果 cache_read_input_tokens 远低于预期，
// 而这一轮「我们这边什么都没改」，那就是服务端的问题；
// 反之就是我们的改动导致缓存失效。
//
// 注意 void 前缀：这是 fire-and-forget，不 await。
// 检测是纯观测行为，绝不能拖慢主流程——哪怕检测函数自己抛异常也不该影响请求。
      // Check if the cache actually broke based on response tokens
      if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
        void checkResponseForCacheBreak(
          options.querySource,
          usage.cache_read_input_tokens,
          usage.cache_creation_input_tokens,
          messages,
          options.agentId,
          streamRequestId,
        )
      }

// 配额状态从**响应头**里读（不是 body）。
// 这是「订阅制限流」的实现方式：服务端在每 5 小时窗口的响应头里
// 带上剩余额度，客户端读出来显示在 UI 上。
//
// streamResponse 在这里要 as 一下，因为 TypeScript 的控制流分析
// 追不到「它在 withRetry 的回调里被赋值」这件事（注释也说明了）。
      // Process fallback percentage header and quota status if available
      // streamResponse is set when the stream is created in the withRetry callback above
      // TypeScript's control flow analysis can't track that streamResponse is set in the callback
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const resp = streamResponse as unknown as Response | undefined
      if (resp) {
        extractQuotaStatusFromHeaders(resp.headers)
        // Store headers for gateway detection
        responseHeaders = resp.headers
      }
// ═══ 流式失败的统一入口 ═══
//
// 这个 catch 块有 130 行，分四段：
//   2406-2432  看门狗相关的埋点（区分「干净退出」和「异常退出」）
//   2434-2462  用户中止 vs SDK 超时（同一异常类型，两种含义）
//   2464-2502  降级开关判断（disableFallback）
//   2504-2594  真正降级：走非流式
//
// 注意最外层还有一个 finally（行 2595）专门 clearStreamIdleTimers ——
// 因为 catch 里的代码自己也可能抛，finally 才是保证清理的地方。
    } catch (streamingError) {
      // Clear the idle timeout watchdog on error path too
      clearStreamIdleTimers()

      // Instrumentation: if the watchdog had already fired and the for-await
      // threw (rather than exiting cleanly), record that the loop DID exit and
      // how long after the watchdog. Distinguishes true hangs from error exits.
      if (streamIdleAborted && streamWatchdogFiredAt !== null) {
        const exitDelayMs = Math.round(
          performance.now() - streamWatchdogFiredAt,
        )
        logForDiagnosticsNoPII(
          'info',
          'cli_stream_loop_exited_after_watchdog_error',
        )
        logEvent('tengu_stream_loop_exited_after_watchdog', {
          request_id: (streamRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          exit_delay_ms: exitDelayMs,
          exit_path:
            'error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_name:
            streamingError instanceof Error
              ? (streamingError.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
              : ('unknown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }

// ⚠ 同一个异常类型 APIUserAbortError 有两种完全不同的含义，必须分开：
//
//     signal.aborted 为真  → 用户按了 ESC，这是**预期行为**
//                            直接重抛，上层按「中断」处理，不报错
//     signal.aborted 为假  → SDK 内部超时，这是**真错误**
//                            转成 APIConnectionTimeoutError 再抛
//
// 分不清的后果：要么用户每次按 ESC 都看到报错，要么真超时被当成用户取消、
// 静默吞掉。这个 if/else 就是在做这个分辨。
      if (streamingError instanceof APIUserAbortError) {
        // Check if the abort signal was triggered by the user (ESC key)
        // If the signal is aborted, it's a user-initiated abort
        // If not, it's likely a timeout from the SDK
        if (signal.aborted) {
          // This is a real user abort (ESC key was pressed)
          logForDebugging(
            `Streaming aborted by user: ${errorMessage(streamingError)}`,
          )
          if (isAdvisorInProgress) {
            logEvent('tengu_advisor_tool_interrupted', {
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              advisor_model: (advisorModel ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
          }
          throw streamingError
        } else {
          // The SDK threw APIUserAbortError but our signal wasn't aborted
          // This means it's a timeout from the SDK's internal timeout
          logForDebugging(
            `Streaming timeout (SDK abort): ${streamingError.message}`,
            { level: 'error' },
          )
          // Throw a more specific error for timeout
          throw new APIConnectionTimeoutError({ message: 'Request timed out' })
        }
      }

// ⚠ 这段注释记录了一个很隐蔽的双重执行 bug（inc-4258），值得细读：
//
// 开了「流式工具执行」之后，中途降级到非流式会造成工具跑两遍：
//   1. 流式那半截已经收到 tool_use，工具开始执行
//   2. 流断了 → 降级 → 非流式重试重放整个请求 → 又生成同一个 tool_use
//   3. 工具被执行第二次（可能有副作用！写文件、发请求、删数据）
//
// 所以有开关能在这种情况下**直接放弃降级、让错误抛给 withRetry**。
// 这是一种取舍：宁可这次请求失败重试，也不能把有副作用的操作跑两遍。
      // When the flag is enabled, skip the non-streaming fallback and let the
      // error propagate to withRetry. The mid-stream fallback causes double tool
      // execution when streaming tool execution is active: the partial stream
      // starts a tool, then the non-streaming retry produces the same tool_use
      // and runs it again. See inc-4258.
      const disableFallback =
        isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK) ||
        getFeatureValue_CACHED_MAY_BE_STALE(
          'tengu_disable_streaming_to_non_streaming_fallback',
          false,
        )

      if (disableFallback) {
        logForDebugging(
          `Error streaming (non-streaming fallback disabled): ${errorMessage(streamingError)}`,
          { level: 'error' },
        )
        logEvent('tengu_streaming_fallback_to_non_streaming', {
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error:
            streamingError instanceof Error
              ? (streamingError.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
              : (String(
                  streamingError,
                ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
          attemptNumber,
          maxOutputTokens,
          thinkingType:
            thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fallback_disabled: true,
          request_id: (streamRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fallback_cause: (streamIdleAborted
            ? 'watchdog'
            : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw streamingError
      }

      logForDebugging(
        `Error streaming, falling back to non-streaming mode: ${errorMessage(streamingError)}`,
        { level: 'error' },
      )
      didFallBackToNonStreaming = true
      if (options.onStreamingFallback) {
        options.onStreamingFallback()
      }

      logEvent('tengu_streaming_fallback_to_non_streaming', {
        model:
          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error:
          streamingError instanceof Error
            ? (streamingError.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
            : (String(
                streamingError,
              ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
        attemptNumber,
        maxOutputTokens,
        thinkingType:
          thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        fallback_disabled: false,
        request_id: (streamRequestId ??
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        fallback_cause: (streamIdleAborted
          ? 'watchdog'
          : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

// ═══════════════════════════════════════════════════════════════
// 降级到非流式 —— 但这里藏着一个「预算对齐」的细节
//
//     initialConsecutive529Errors: is529Error(streamingError) ? 1 : 0
//
// 注释解释得很清楚：如果**流式**阶段撞的是 529（服务端过载），
// 这个 1 要带进非流式的重试计数里。
// 否则「连续 529 多少次就切换模型」这个阈值，会因为走了哪条路径而不同 ——
// 流式撞 3 次 + 非流式撞 3 次 = 6 次，但计数器只记到 3。
//
// 这是典型的「同一份状态被两条代码路径维护」的问题，
// 修法是把已发生的事实（撞过一次 529）显式传下去。
      // Fall back to non-streaming mode with retries.
      // If the streaming failure was itself a 529, count it toward the
      // consecutive-529 budget so total 529s-before-model-fallback is the
      // same whether the overload was hit in streaming or non-streaming mode.
      // This is a speculative fix for https://github.com/anthropics/claude-code/issues/1513
      // Instrumentation: proves executeNonStreamingRequest was entered (vs. the
      // fallback event firing but the call itself hanging at dispatch).
      logForDiagnosticsNoPII('info', 'cli_nonstreaming_fallback_started')
      logEvent('tengu_nonstreaming_fallback_started', {
        request_id: (streamRequestId ??
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        model:
          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        fallback_cause: (streamIdleAborted
          ? 'watchdog'
          : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      const result = yield* executeNonStreamingRequest(
        { model: options.model, source: options.querySource },
        {
          model: options.model,
          fallbackModel: options.fallbackModel,
          thinkingConfig,
          ...(isFastModeEnabled() && { fastMode: isFastMode }),
          signal,
          initialConsecutive529Errors: is529Error(streamingError) ? 1 : 0,
          querySource: options.querySource,
        },
        paramsFromContext,
        (attempt, _startTime, tokens) => {
          attemptNumber = attempt
          maxOutputTokens = tokens
        },
        params => captureAPIRequest(params, options.querySource),
        streamRequestId,
      )

// 降级成功后，也要走和流式一样的收口流程：
// normalizeContentFromAPI → 构造 AssistantMessage → push → yield。
//
// 并且额外记到 fallbackMessage（行 2593）——
// 因为这段代码可能在 yield 处被 .return() 打断，
// 那样下面的成本统计就执行不到了，所以 finally 里要能靠 fallbackMessage 补救（行 2820）。
      const m: AssistantMessage = {
        message: {
          ...result,
          content: normalizeContentFromAPI(
            result.content,
            tools,
            options.agentId,
          ),
        },
        requestId: streamRequestId ?? undefined,
        type: 'assistant',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        ...(process.env.USER_TYPE === 'ant' &&
          research !== undefined && {
            research,
          }),
        ...(advisorModel && {
          advisorModel,
        }),
      }
      newMessages.push(m)
      fallbackMessage = m
      yield m
// 这个 finally 只做一件事：清看门狗。
// 但它是必需的——catch 块自己也可能抛异常，那时只有 finally 能保证执行。
    } finally {
      clearStreamIdleTimers()
    }
// ═══ withRetry 整体失败（重试次数用尽 / 不可重试） ═══
//
// 到这个 catch，说明「连重试都救不回来了」。剩下能做的：
//   1. 把模型降级信号透传给 query.ts（2603）
//   2. 404 特殊处理：再试一次非流式（2612）
//   3. 否则记日志 + yield 一条错误消息 + return（2750 起）
//
// 注意这里用 return 而不是 throw：生成器正常结束，
// 错误已经通过 yield 一条 SystemAPIErrorMessage 传给上层了。
// 这是「错误即消息」的设计——比抛异常更容易在上层统一处理。
  } catch (errorFromRetry) {
    // FallbackTriggeredError must propagate to query.ts, which performs the
    // actual model switch. Swallowing it here would turn the fallback into a
    // no-op — the user would just see "Model fallback triggered: X -> Y" as
    // an error message with no actual retry on the fallback model.
// ⚠ FallbackTriggeredError 必须原样往上传，绝不能在这里处理。
//
// 注释说明了原因：这个文件的职责是「发一次请求」，
// 而「换到 fallbackModel 再试」是 query.ts 的职责（它要重建整个循环状态）。
// 如果在这里吞掉，用户会看到一条 "Model fallback triggered: X -> Y" 的
// **错误消息**，但实际上什么都没重试。
    if (errorFromRetry instanceof FallbackTriggeredError) {
      throw errorFromRetry
    }

// 404 的特殊性：这一版改成 raw stream 之后，404 的抛出位置变了。
//
//   老版本（BetaMessageStream）：404 在**遍历流的时候**抛 → 被内层 catch 接住 → 降级
//   新版本（raw Stream）：404 在 **.withResponse() 时**抛 → 抛到这一层
//
// 所以这个 catch 里必须补一条 404 判断，否则「网关不支持流式」这个场景
// 会从「自动降级」退化成「直接报错」。
// 这也是升级 SDK 用法时最容易漏的一类回归。
    // Check if this is a 404 error during stream creation that should trigger
    // non-streaming fallback. This handles gateways that return 404 for streaming
    // endpoints but work fine with non-streaming. Before v2.1.8, BetaMessageStream
    // threw 404s during iteration (caught by inner catch with fallback), but now
    // with raw streams, 404s are thrown during creation (caught here).
// 三个条件缺一不可，第二个和第三个说明这不是「所有 CannotRetryError」，
// 而是精确匹配「404 且是 stream 创建阶段」。
// didFallBackToNonStreaming 的判断防止重复降级（已经降过一次就别再试）。
    const is404StreamCreationError =
      !didFallBackToNonStreaming &&
      errorFromRetry instanceof CannotRetryError &&
      errorFromRetry.originalError instanceof APIError &&
      errorFromRetry.originalError.status === 404

// 这里有个细节：requestId 拿不到了，因为 404 在 streamRequestId 被赋值**之前**就抛了。
// 所以从错误对象上抠（error.requestID，SDK 会从响应头里带出来）。
// 注释还说明了 CannotRetryError 的含义：所有重试都失败了，
// 所以这个 id 是最后一次失败请求的。
    if (is404StreamCreationError) {
      // 404 is thrown at .withResponse() before streamRequestId is assigned,
      // and CannotRetryError means every retry failed — so grab the failed
      // request's ID from the error header instead.
      const failedRequestId =
        (errorFromRetry.originalError as APIError).requestID ?? 'unknown'
      logForDebugging(
        'Streaming endpoint returned 404, falling back to non-streaming mode',
        { level: 'warn' },
      )
      didFallBackToNonStreaming = true
      if (options.onStreamingFallback) {
        options.onStreamingFallback()
      }

      logEvent('tengu_streaming_fallback_to_non_streaming', {
        model:
          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error:
          '404_stream_creation' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        attemptNumber,
        maxOutputTokens,
        thinkingType:
          thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        request_id:
          failedRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        fallback_cause:
          '404_stream_creation' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      try {
        // Fall back to non-streaming mode
        const result = yield* executeNonStreamingRequest(
          { model: options.model, source: options.querySource },
          {
            model: options.model,
            fallbackModel: options.fallbackModel,
            thinkingConfig,
            ...(isFastModeEnabled() && { fastMode: isFastMode }),
            signal,
          },
          paramsFromContext,
          (attempt, _startTime, tokens) => {
            attemptNumber = attempt
            maxOutputTokens = tokens
          },
          params => captureAPIRequest(params, options.querySource),
          failedRequestId,
        )

        const m: AssistantMessage = {
          message: {
            ...result,
            content: normalizeContentFromAPI(
              result.content,
              tools,
              options.agentId,
            ),
          },
          requestId: streamRequestId ?? undefined,
          type: 'assistant',
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
          ...(process.env.USER_TYPE === 'ant' &&
            research !== undefined && { research }),
          ...(advisorModel && { advisorModel }),
        }
        newMessages.push(m)
        fallbackMessage = m
        yield m

        // Continue to success logging below
      } catch (fallbackError) {
        // Propagate model-fallback signal to query.ts (see comment above).
        if (fallbackError instanceof FallbackTriggeredError) {
          throw fallbackError
        }

        // Fallback also failed, handle as normal error
        logForDebugging(
          `Non-streaming fallback also failed: ${errorMessage(fallbackError)}`,
          { level: 'error' },
        )

        let error = fallbackError
        let errorModel = options.model
        if (fallbackError instanceof CannotRetryError) {
          error = fallbackError.originalError
          errorModel = fallbackError.retryContext.model
        }

        if (error instanceof APIError) {
          extractQuotaStatusFromError(error)
        }

        const requestId =
          streamRequestId ||
          (error instanceof APIError ? error.requestID : undefined) ||
          (error instanceof APIError
            ? (error.error as { request_id?: string })?.request_id
            : undefined)

        logAPIError({
          error,
          model: errorModel,
          messageCount: messagesForAPI.length,
          messageTokens: tokenCountFromLastAPIResponse(messagesForAPI),
          durationMs: Date.now() - start,
          durationMsIncludingRetries: Date.now() - startIncludingRetries,
          attempt: attemptNumber,
          requestId,
          clientRequestId,
          didFallBackToNonStreaming,
          queryTracking: options.queryTracking,
          querySource: options.querySource,
          llmSpan,
          fastMode: isFastModeRequest,
          previousRequestId,
        })

        if (error instanceof APIUserAbortError) {
          releaseStreamResources()
          return
        }

        yield getAssistantMessageFromError(error, errorModel, {
          messages,
          messagesForAPI,
        })
        releaseStreamResources()
        return
      }
// ═══ 非 404 的普通失败路径 ═══
//
// 和上面 404 分支的处理高度相似（这也是这段代码可以抽象但没抽象的原因：
// 两处的 return 语义不同，硬抽会让控制流更难读）。
//
// 顺序是固定的三步：
//   1. 剥掉 CannotRetryError 外壳，拿到真实 error 和当时用的模型
//   2. 尽量捞到一个 requestId（流 id → 错误头 → 错误体，三级兜底）
//   3. logAPIError → 用户中止则静默 return → 否则 yield 错误消息 → return
    } else {
      // Original error handling for non-404 errors
      logForDebugging(`Error in API request: ${errorMessage(errorFromRetry)}`, {
        level: 'error',
      })

      let error = errorFromRetry
      let errorModel = options.model
      if (errorFromRetry instanceof CannotRetryError) {
        error = errorFromRetry.originalError
        errorModel = errorFromRetry.retryContext.model
      }

      // Extract quota status from error headers if it's a rate limit error
      if (error instanceof APIError) {
        extractQuotaStatusFromError(error)
      }

      // Extract requestId from stream, error header, or error body
      const requestId =
        streamRequestId ||
        (error instanceof APIError ? error.requestID : undefined) ||
        (error instanceof APIError
          ? (error.error as { request_id?: string })?.request_id
          : undefined)

      logAPIError({
        error,
        model: errorModel,
        messageCount: messagesForAPI.length,
        messageTokens: tokenCountFromLastAPIResponse(messagesForAPI),
        durationMs: Date.now() - start,
        durationMsIncludingRetries: Date.now() - startIncludingRetries,
        attempt: attemptNumber,
        requestId,
        clientRequestId,
        didFallBackToNonStreaming,
        queryTracking: options.queryTracking,
        querySource: options.querySource,
        llmSpan,
        fastMode: isFastModeRequest,
        previousRequestId,
      })

// 用户主动中止不 yield 错误消息。
// 注释指明「中断提示由 query.ts 处理」——因为那边知道上下文
// （是用户按了 ESC，还是某个工具执行到一半被取消），能给出更准确的文案。
// 这里只负责安静地 return。
      // Don't yield an assistant error message for user aborts
      // The interruption message is handled in query.ts
      if (error instanceof APIUserAbortError) {
        releaseStreamResources()
        return
      }

      yield getAssistantMessageFromError(error, errorModel, {
        messages,
        messagesForAPI,
      })
      releaseStreamResources()
      return
    }
// ═══ 最外层的 finally ═══
//
// 三件事，每一件都有明确的「不做会怎样」：
//
//   1. stopSessionActivity  —— 不配对的话，系统会一直以为有网络活动
//   2. releaseStreamResources —— 不调就泄漏原生 socket（GH #32920）
//   3. 补算 fallback 的成本   —— 见下面注释
//
// 关于第 2 条，注释里那句 "if the generator is terminated early via .return()"
// 是关键：消费方 break 出 for-await 时会调用生成器的 .return()，
// 那时 try 块里的代码**不会**继续执行，只有 finally 会。
  } finally {
    stopSessionActivity('api_call')
    // Must be in the finally block: if the generator is terminated early
    // via .return() (e.g. consumer breaks out of for-await-of, or query.ts
    // encounters an abort), code after the try/finally never executes.
    // Without this, the Response object's native TLS/socket buffers leak
    // until the generator itself is GC'd (see GH #32920).
    releaseStreamResources()

// fallback 的成本为什么要在 finally 里补算：
//
// 流式路径的 message_delta 处理是在任何 yield **之前**记账的（行 2251），
// 所以即使被打断也已经记上了。
// 但 fallback 路径是「push → yield → 之后才记」，一旦在 yield 处被 .return()，
// 后面就没了。所以搬到这里，用 fallbackMessage 兜底。
    // Non-streaming fallback cost: the streaming path tracks cost in the
    // message_delta handler before any yield. Fallback pushes to newMessages
    // then yields, so tracking must be here to survive .return() at the yield.
    if (fallbackMessage) {
      const fallbackUsage = fallbackMessage.message.usage
      usage = updateUsage(EMPTY_USAGE, fallbackUsage)
      stopReason = fallbackMessage.message.stop_reason
      const fallbackCost = calculateUSDCost(resolvedModel, fallbackUsage)
      costUSD += addToTotalSessionCost(
        fallbackCost,
        fallbackUsage,
        options.model,
      )
    }
  }

// ── 收尾：三件与「下一次请求」有关的记账 ──
//
// 第一件：把所有工具标记为「已发给 API」，这样它们才**有资格被删除**。
// 为什么需要这个状态：工具定义一旦发出去就进了缓存，
// 如果某个工具再也不发，缓存里那段就可以被回收。
// 标记之后缓存管理才知道「这个工具已经出场过了」。
  // Mark all registered tools as sent to API so they become eligible for deletion
  if (feature('CACHED_MICROCOMPACT') && cachedMCEnabled) {
    markToolsSentToAPIState()
  }

// 第二件：记住主对话链的最后一个 requestId。
// 用途在进程退出时——给推理服务发一个「这条链可以清缓存了」的提示。
//
// ⚠ 那个 getAgentContext() 判断很微妙：后台会话（Ctrl+B）虽然也共享
// repl_main_thread 这个 querySource，但它们在 agent context 里运行，
// 是**独立的对话链**。前台清空时不应该把它们的缓存也踢掉。
  // Track the last requestId for the main conversation chain so shutdown
  // can send a cache eviction hint to inference. Exclude backgrounded
  // sessions (Ctrl+B) which share the repl_main_thread querySource but
  // run inside an agent context — they are independent conversation chains
  // whose cache should not be evicted when the foreground session clears.
  if (
    streamRequestId &&
    !getAgentContext() &&
    (options.querySource.startsWith('repl_main_thread') ||
      options.querySource === 'sdk')
  ) {
    setLastMainRequestId(streamRequestId)
  }

// 第三件：成功日志。和行 1731 是同一个优化模式——
// 先把 messagesForAPI 的两个标量（长度、token 数）算出来，
// 免得 fire-and-forget 的 .then() 闭包把整个对话数组 pin 在内存里
// 直到 getToolPermissionContext() resolve。
  // Precompute scalars so the fire-and-forget .then() closure doesn't pin the
  // full messagesForAPI array (the entire conversation up to the context window
  // limit) until getToolPermissionContext() resolves.
  const logMessageCount = messagesForAPI.length
  const logMessageTokens = tokenCountFromLastAPIResponse(messagesForAPI)
  void options.getToolPermissionContext().then(permissionContext => {
    logAPISuccessAndDuration({
      model:
        newMessages[0]?.message.model ?? partialMessage?.model ?? options.model,
      preNormalizedModel: options.model,
      usage,
      start,
      startIncludingRetries,
      attempt: attemptNumber,
      messageCount: logMessageCount,
      messageTokens: logMessageTokens,
      requestId: streamRequestId ?? null,
      stopReason,
      ttftMs,
      didFallBackToNonStreaming,
      querySource: options.querySource,
      headers: responseHeaders,
      costUSD,
      queryTracking: options.queryTracking,
      permissionMode: permissionContext.mode,
      // Pass newMessages for beta tracing - extraction happens in logging.ts
      // only when beta tracing is enabled
      newMessages,
      llmSpan,
      globalCacheStrategy,
      requestSetupMs: start - startIncludingRetries,
      attemptStartTimes,
      fastMode: isFastModeRequest,
      previousRequestId,
      betas: lastRequestBetas,
    })
  })

// 防御性再释放一次。
// 正常路径 finally 已经调过了，cleanupStream 幂等（内部判 aborted），
// 所以这里是安全的空操作。
  // Defensive: also release on normal completion (no-op if finally already ran).
  releaseStreamResources()
}

// ═══ 以下是被导出的工具函数 ═══
//
// 从 2898 到 3419，都是纯函数或近乎纯函数，
// 没有 queryModel 里那些跨事件状态，读起来轻松得多。
// 但它们承担的是「协议微小约束」的实现，每条都对应一个会导致 400 的规则。
/**
 * Cleans up stream resources to prevent memory leaks.
 * @internal Exported for testing
 */
export function cleanupStream(
  stream: Stream<BetaRawMessageStreamEvent> | undefined,
): void {
  if (!stream) {
    return
  }
  try {
    // Abort the stream via its controller if not already aborted
    if (!stream.controller.signal.aborted) {
      stream.controller.abort()
    }
  } catch {
    // Ignore - stream may already be closed
  }
}

// ── updateUsage：合并一次 usage 更新 ──
//
// ⚠ 注释第一句是全文件最容易被忽略的一句话：
//
//     "Anthropic's streaming API provides cumulative usage totals,
//      not incremental deltas."
//
// 也就是说每个事件里的 usage 都是「到目前为止的总数」，**不是增量**。
// 所以这里是覆盖而不是累加。（累加的事由 accumulateUsage 负责，那是跨消息的。）
//
// 第二段注释说的是一个具体的坑：message_delta 可能给
// input_tokens: 0（因为它只想更新 output_tokens），
// 如果直接覆盖，就把 message_start 给的真实输入 token 数抹成 0 了。
// 所以三个 input 类字段都用 **> 0** 才覆盖。
/**
 * Updates usage statistics with new values from streaming API events.
 * Note: Anthropic's streaming API provides cumulative usage totals, not incremental deltas.
 * Each event contains the complete usage up to that point in the stream.
 *
 * Input-related tokens (input_tokens, cache_creation_input_tokens, cache_read_input_tokens)
 * are typically set in message_start and remain constant. message_delta events may send
 * explicit 0 values for these fields, which should not overwrite the values from message_start.
 * We only update these fields if they have a non-null, non-zero value.
 */
export function updateUsage(
  usage: Readonly<NonNullableUsage>,
  partUsage: BetaMessageDeltaUsage | undefined,
): NonNullableUsage {
  if (!partUsage) {
    return { ...usage }
  }
  return {
    input_tokens:
      partUsage.input_tokens !== null && partUsage.input_tokens > 0
        ? partUsage.input_tokens
        : usage.input_tokens,
    cache_creation_input_tokens:
      partUsage.cache_creation_input_tokens !== null &&
      partUsage.cache_creation_input_tokens > 0
        ? partUsage.cache_creation_input_tokens
        : usage.cache_creation_input_tokens,
    cache_read_input_tokens:
      partUsage.cache_read_input_tokens !== null &&
      partUsage.cache_read_input_tokens > 0
        ? partUsage.cache_read_input_tokens
        : usage.cache_read_input_tokens,
    output_tokens: partUsage.output_tokens ?? usage.output_tokens,
// output_tokens 是唯一真正该「取最新值」的字段（它确实是累计递增的），
// 所以这里用 ?? 而不是 > 0。
// 一个 > 0 判断的差别，就是「成本统计准确」和「成本统计为 0」的差别。
    server_tool_use: {
      web_search_requests:
        partUsage.server_tool_use?.web_search_requests ??
        usage.server_tool_use.web_search_requests,
      web_fetch_requests:
        partUsage.server_tool_use?.web_fetch_requests ??
        usage.server_tool_use.web_fetch_requests,
    },
    service_tier: usage.service_tier,
// cache_creation 的两个字段 SDK 类型里没有，但 API 真的会发。
// 所以用 (partUsage as BetaUsage) 强转去读——注释那句
// "SDK type BetaMessageDeltaUsage is missing cache_creation, but it's real!"
// 是一个典型的「类型定义落后于协议」的现场记录。
    cache_creation: {
      // SDK type BetaMessageDeltaUsage is missing cache_creation, but it's real!
      ephemeral_1h_input_tokens:
        (partUsage as BetaUsage).cache_creation?.ephemeral_1h_input_tokens ??
        usage.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        (partUsage as BetaUsage).cache_creation?.ephemeral_5m_input_tokens ??
        usage.cache_creation.ephemeral_5m_input_tokens,
    },
// cache_deleted_input_tokens 更极端：不仅 SDK 类型没有，
// 连 NonNullableUsage 也**故意不带**这个字段。
//
// 注释说明了原因：把它排除在类型之外，外部构建里这个字符串
// 就会被 DCE 一起删掉（连字段名都不出现在产物里）。
// 这是「用类型系统控制代码裁剪」的一个巧妙用法——
// 不是靠 feature()，而是靠「类型里没有 → 所有引用都是 any → 打包器能删」。
    // cache_deleted_input_tokens: returned by the API when cache editing
    // deletes KV cache content, but not in SDK types. Kept off NonNullableUsage
    // so the string is eliminated from external builds by dead code elimination.
    // Uses the same > 0 guard as other token fields to prevent message_delta
    // from overwriting the real value with 0.
    ...(feature('CACHED_MICROCOMPACT')
      ? {
          cache_deleted_input_tokens:
            (partUsage as unknown as { cache_deleted_input_tokens?: number })
              .cache_deleted_input_tokens != null &&
            (partUsage as unknown as { cache_deleted_input_tokens: number })
              .cache_deleted_input_tokens > 0
              ? (partUsage as unknown as { cache_deleted_input_tokens: number })
                  .cache_deleted_input_tokens
              : ((usage as unknown as { cache_deleted_input_tokens?: number })
                  .cache_deleted_input_tokens ?? 0),
        }
      : {}),
    inference_geo: usage.inference_geo,
    iterations: partUsage.iterations ?? usage.iterations,
    speed: (partUsage as BetaUsage).speed ?? usage.speed,
  }
}

/**
 * Accumulates usage from one message into a total usage object.
 * Used to track cumulative usage across multiple assistant turns.
 */
// ── accumulateUsage：跨消息累加 ──
//
// 和 updateUsage 是**相反的操作**，两者容易混：
//   updateUsage(total, part)    合并流内事件 → 得到这一条消息的总量
//   accumulateUsage(a, b)       把多条消息的量加起来 → 得到整轮的总量
//
// 注意最后三个字段用 messageUsage 的「最新值」而不是相加：
//   service_tier / inference_geo / iterations / speed
// 这些是**标签性质**的字段（这一轮用什么档位跑的），相加没有意义。
export function accumulateUsage(
  totalUsage: Readonly<NonNullableUsage>,
  messageUsage: Readonly<NonNullableUsage>,
): NonNullableUsage {
  return {
    input_tokens: totalUsage.input_tokens + messageUsage.input_tokens,
    cache_creation_input_tokens:
      totalUsage.cache_creation_input_tokens +
      messageUsage.cache_creation_input_tokens,
    cache_read_input_tokens:
      totalUsage.cache_read_input_tokens + messageUsage.cache_read_input_tokens,
    output_tokens: totalUsage.output_tokens + messageUsage.output_tokens,
    server_tool_use: {
      web_search_requests:
        totalUsage.server_tool_use.web_search_requests +
        messageUsage.server_tool_use.web_search_requests,
      web_fetch_requests:
        totalUsage.server_tool_use.web_fetch_requests +
        messageUsage.server_tool_use.web_fetch_requests,
    },
    service_tier: messageUsage.service_tier, // Use the most recent service tier
    cache_creation: {
      ephemeral_1h_input_tokens:
        totalUsage.cache_creation.ephemeral_1h_input_tokens +
        messageUsage.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        totalUsage.cache_creation.ephemeral_5m_input_tokens +
        messageUsage.cache_creation.ephemeral_5m_input_tokens,
    },
    // See comment in updateUsage — field is not on NonNullableUsage to keep
    // the string out of external builds.
    ...(feature('CACHED_MICROCOMPACT')
      ? {
          cache_deleted_input_tokens:
            ((totalUsage as unknown as { cache_deleted_input_tokens?: number })
              .cache_deleted_input_tokens ?? 0) +
            ((
              messageUsage as unknown as { cache_deleted_input_tokens?: number }
            ).cache_deleted_input_tokens ?? 0),
        }
      : {}),
    inference_geo: messageUsage.inference_geo, // Use the most recent
    iterations: messageUsage.iterations, // Use the most recent
    speed: messageUsage.speed, // Use the most recent
  }
}

// 一个手写的类型守卫。
// 为什么不用 instanceof 或 in 运算符：这里是处理**跨进程/反序列化**
// 之后的数据（历史消息可能来自磁盘），对象原型已经不可信了，
// 只能靠结构判断（duck typing）。
function isToolResultBlock(
  block: unknown,
): block is { type: 'tool_result'; tool_use_id: string } {
  return (
    block !== null &&
    typeof block === 'object' &&
    'type' in block &&
    (block as { type: string }).type === 'tool_result' &&
    'tool_use_id' in block
  )
}

type CachedMCEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

type CachedMCPinnedEdits = {
  userMessageIndex: number
  block: CachedMCEditsBlock
}

// ═══════════════════════════════════════════════════════════════
// addCacheBreakpoints —— 缓存打点的实现，也是全文件最「省 token」的地方
//
// 先理解 cache_control 的作用：标在哪一块，服务端就把「从头到这一块」
// 整段前缀存起来。下一次请求如果前缀一字不差，从缓存读，价格约 1/10。
//
// 所以这个故事的核心不是「打点」，而是**打在哪最划算**：
//
//   打得太靠前 → 缓存段短，省得少
//   打得太靠后 → 覆盖全部历史，命中率最高，但一旦末尾变了就全废
//
// 这段代码的策略是：**每请求只打一个消息级打点，位置在最后一条消息**
// （或者 skipCacheWrite 模式下倒数第二条）。下面那段关于 Mycro 的注释
// 解释了为什么「只能有一个」，那是一个内部的 KV 页管理细节：
// 两个打点会保护倒数第二个位置，让它的 local-attention 页多活一轮，
// 而那个位置永远不会被复用 —— 纯浪费显存。
// Exported for testing cache_reference placement constraints
export function addCacheBreakpoints(
  messages: (UserMessage | AssistantMessage)[],
  enablePromptCaching: boolean,
  querySource?: QuerySource,
  useCachedMC = false,
  newCacheEdits?: CachedMCEditsBlock | null,
  pinnedEdits?: CachedMCPinnedEdits[],
  skipCacheWrite = false,
): MessageParam[] {
  logEvent('tengu_api_cache_breakpoints', {
    totalMessageCount: messages.length,
    cachingEnabled: enablePromptCaching,
    skipCacheWrite,
  })

  // Exactly one message-level cache_control marker per request. Mycro's
  // turn-to-turn eviction (page_manager/index.rs: Index::insert) frees
  // local-attention KV pages at any cached prefix position NOT in
  // cache_store_int_token_boundaries. With two markers the second-to-last
  // position is protected and its locals survive an extra turn even though
  // nothing will ever resume from there — with one marker they're freed
  // immediately. For fire-and-forget forks (skipCacheWrite) we shift the
  // marker to the second-to-last message: that's the last shared-prefix
  // point, so the write is a no-op merge on mycro (entry already exists)
  // and the fork doesn't leave its own tail in the KVCC. Dense pages are
  // refcounted and survive via the new hash either way.
// skipCacheWrite 模式下打点前移一位。
// 什么场景会用到：fire-and-forget 的分叉调用（比如让另一个模型
// 顺便看一眼当前对话）。这种调用不需要留下自己的尾巴，
// 所以让打点落在「共享前缀的最后一点」上，写入变成 no-op 合并。
//
// 注意 skipCacheWrite ? length - 2 : length - 1。
// 当消息只有 1 条时前者是 -1，意味着**一个打点都不打** —— 这是有意的：
// 单条消息的场景没什么可缓存的。
  const markerIndex = skipCacheWrite ? messages.length - 2 : messages.length - 1
  const result = messages.map((msg, index) => {
    const addCache = index === markerIndex
    if (msg.type === 'user') {
      return userMessageToMessageParam(
        msg,
        addCache,
        enablePromptCaching,
        querySource,
      )
    }
    return assistantMessageToMessageParam(
      msg,
      addCache,
      enablePromptCaching,
      querySource,
    )
  })

  if (!useCachedMC) {
    return result
  }

// ── cache_edits：主动删除缓存内容 ──
//
// 这是 cache editing 能力的配套：服务端允许你「告诉它删掉某段缓存」，
// 用来做精细的上下文管理（比如此前压缩掉的工具结果）。
//
// 但删除指令有两条严格约束，下面的代码就是为它们服务的：
//   1. 同一个 cache_reference 不能删两次（跨块去重 → seenDeleteRefs）
//   2. 删除块必须**固定在同一位置**重发（pinCacheEdits），
//      否则下一轮位置变了，服务端对不上号
  // Track all cache_references being deleted to prevent duplicates across blocks.
  const seenDeleteRefs = new Set<string>()

  // Helper to deduplicate a cache_edits block against already-seen deletions
  const deduplicateEdits = (block: CachedMCEditsBlock): CachedMCEditsBlock => {
    const uniqueEdits = block.edits.filter(edit => {
      if (seenDeleteRefs.has(edit.cache_reference)) {
        return false
      }
      seenDeleteRefs.add(edit.cache_reference)
      return true
    })
    return { ...block, edits: uniqueEdits }
  }

  // Re-insert all previously-pinned cache_edits at their original positions
  for (const pinned of pinnedEdits ?? []) {
    const msg = result[pinned.userMessageIndex]
    if (msg && msg.role === 'user') {
      if (!Array.isArray(msg.content)) {
        msg.content = [{ type: 'text', text: msg.content as string }]
      }
      const dedupedBlock = deduplicateEdits(pinned.block)
      if (dedupedBlock.edits.length > 0) {
        insertBlockAfterToolResults(msg.content, dedupedBlock)
      }
    }
  }

// 新一轮的删除指令人插在**最后一条 user 消息**里，
// 位置是「所有 tool_result 之后」（insertBlockAfterToolResults）——
// 这是 API 对 cache_edits 块的位置约束。
//
// 插入后立刻 pin（行 3153），保证下次请求它还在同一位置。
  // Insert new cache_edits into the last user message and pin them
  if (newCacheEdits && result.length > 0) {
    const dedupedNewEdits = deduplicateEdits(newCacheEdits)
    if (dedupedNewEdits.edits.length > 0) {
      for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i]
        if (msg && msg.role === 'user') {
          if (!Array.isArray(msg.content)) {
            msg.content = [{ type: 'text', text: msg.content as string }]
          }
          insertBlockAfterToolResults(msg.content, dedupedNewEdits)
          // Pin so this block is re-sent at the same position in future calls
          pinCacheEdits(i, newCacheEdits)

          logForDebugging(
            `Added cache_edits block with ${dedupedNewEdits.edits.length} deletion(s) to message[${i}]: ${dedupedNewEdits.edits.map(e => e.cache_reference).join(', ')}`,
          )
          break
        }
      }
    }
  }

// ── cache_reference 的补写，顺序很关键 ──
//
// 规则：tool_result 块上要带 cache_reference，才能被后续的 cache_edits 引用。
// 而它只对「缓存前缀内」的块有意义。
//
// 注释里那个「必须严格 before 而不是 before-or-on」值得注意：
// API 的规则是「cache_reference 必须在最后一个 cache_control 之前或同一个」，
// 这里刻意取更严的「之前」——因为 cache_edits 的插入会**移动块下标**，
// 取边界值会在下标偏移上出错。
//
// 还有一句 "Create new objects instead of mutating in-place"：
// 这些块可能被<b>同一进程内的第二次查询</b>复用（比如用不支持 cache_editing
// 的模型再发一次），原地改会污染那次请求。所以先克隆数组再替换元素。
  // Add cache_reference to tool_result blocks that are within the cached prefix.
  // Must be done AFTER cache_edits insertion since that modifies content arrays.
  if (enablePromptCaching) {
    // Find the last message containing a cache_control marker
    let lastCCMsg = -1
    for (let i = 0; i < result.length; i++) {
      const msg = result[i]!
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === 'object' && 'cache_control' in block) {
            lastCCMsg = i
          }
        }
      }
    }

    // Add cache_reference to tool_result blocks that are strictly before
    // the last cache_control marker. The API requires cache_reference to
    // appear "before or on" the last cache_control — we use strict "before"
    // to avoid edge cases where cache_edits splicing shifts block indices.
    //
    // Create new objects instead of mutating in-place to avoid contaminating
    // blocks reused by secondary queries that use models without cache_editing support.
    if (lastCCMsg >= 0) {
      for (let i = 0; i < lastCCMsg; i++) {
        const msg = result[i]!
        if (msg.role !== 'user' || !Array.isArray(msg.content)) {
          continue
        }
        let cloned = false
        for (let j = 0; j < msg.content.length; j++) {
          const block = msg.content[j]
          if (block && isToolResultBlock(block)) {
            if (!cloned) {
              msg.content = [...msg.content]
              cloned = true
            }
            msg.content[j] = Object.assign({}, block, {
              cache_reference: block.tool_use_id,
            })
          }
        }
      }
    }
  }

  return result
}

// ═══ buildSystemPromptBlocks ═══
//
// 它是 prompts.ts 里 splitSysPromptPrefix 的**消费方**，两个文件在这里对接。
//
// 回顾一下 splitSysPromptPrefix 的输出：把系统提示词切成若干块，
// 每块带一个 cacheScope（'global' / 'session' / null）。
// 这个函数做的事就是「把 cacheScope 翻译成 cache_control」：
//
//     cacheScope !== null → 打点（用 getCacheControl 生成 ttl/scope）
//     cacheScope === null → 不打点（这块是会话专属的，不该进缓存）
//
// 这就是 prompts.ts 里那个 SYSTEM_PROMPT_DYNAMIC_BOUNDARY 哨兵的落地处。
export function buildSystemPromptBlocks(
  systemPrompt: SystemPrompt,
  enablePromptCaching: boolean,
  options?: {
    skipGlobalCacheForSystemPrompt?: boolean
    querySource?: QuerySource
  },
): TextBlockParam[] {
// ⚠⚠ 这一行注释是全文件最短、也最该记住的一句：
//
//     "IMPORTANT: Do not add any more blocks for caching or you will get a 400"
//
// 系统提示词这边只允许有限个缓存块。想「多打几个点提高命中率」是错的，
// 会直接 400。缓存打点的数量约束是双向的：
//   消息侧只能有一个（行 3078 的 Mycro 注释）
//   系统提示词侧也有限（这里）
// 这是协议层的硬约束，不是性能调优空间。
  // IMPORTANT: Do not add any more blocks for caching or you will get a 400
  return splitSysPromptPrefix(systemPrompt, {
    skipGlobalCacheForSystemPrompt: options?.skipGlobalCacheForSystemPrompt,
  }).map(block => {
    return {
      type: 'text' as const,
      text: block.text,
      ...(enablePromptCaching &&
        block.cacheScope !== null && {
          cache_control: getCacheControl({
            scope: block.cacheScope,
            querySource: options?.querySource,
          }),
        }),
    }
  })
}

type HaikuOptions = Omit<Options, 'model' | 'getToolPermissionContext'>

// ═══ queryHaiku / queryWithModel：两个薄封装 ═══
//
// 这两个函数几乎一模一样，唯一区别是 queryHaiku 强制用 getSmallFastModel()。
// 它们存在的原因是：Claude Code 内部有大量「顺手问一下小模型」的场景
// （生成标题、分类、提取记忆、判断意图），这些调用需要
// **走完整的 queryModel 管线**（认证、beta 头、重试、代理配置）
// 但不想要流式、不需要工具。
//
// 所以做法是：调 queryModelWithoutStreaming，把 thinking 关掉、tools 传空数组。
// 用具名函数而不是让调用方自己传参，是为了让这些场景的参数保持一致 ——
// 一旦某个调用忘了关 thinking，就会白白多花思考 token。
export async function queryHaiku({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: HaikuOptions
}): Promise<AssistantMessage> {
// withVCR 是录制/回放层。注意第一个参数是要「喂给录制器」的消息形状，
// 而真正发出去的是下面那个只有 userPrompt 的 messages 数组。
//
// 为什么要拆成两份：录制文件需要包含 system prompt（否则回放时
// 上下文对不上），但实际请求里 system 是走单独的 system 字段，
// 不放进 messages。这是个容易看懵的地方。
  const result = await withVCR(
    [
      createUserMessage({
        content: systemPrompt.map(text => ({ type: 'text', text })),
      }),
      createUserMessage({
        content: userPrompt,
      }),
    ],
    async () => {
      const messages = [
        createUserMessage({
          content: userPrompt,
        }),
      ]

      const result = await queryModelWithoutStreaming({
        messages,
        systemPrompt,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal,
        options: {
          ...options,
          model: getSmallFastModel(),
          enablePromptCaching: options.enablePromptCaching ?? false,
          outputFormat,
          async getToolPermissionContext() {
            return getEmptyToolPermissionContext()
          },
        },
      })
      return [result]
    },
  )
  // We don't use streaming for Haiku so this is safe
  return result[0]! as AssistantMessage
}

type QueryWithModelOptions = Omit<Options, 'getToolPermissionContext'>

/**
 * Query a specific model through the Claude Code infrastructure.
 * This goes through the full query pipeline including proper authentication,
 * betas, and headers - unlike direct API calls.
 */
// 和 queryHaiku 的差别只有一处：不覆盖 model，用调用方传的。
// 用途是「指定模型问一句」，比如让 Opus 做一次关键判断。
//
// 再提醒一遍两个函数都做的事：enablePromptCaching 默认 **false**
// （`options.enablePromptCaching ?? false`）。
// 小模型的一次性调用开缓存几乎必然亏本——写入成本远大于可能的命中收益。
export async function queryWithModel({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: QueryWithModelOptions
}): Promise<AssistantMessage> {
  const result = await withVCR(
    [
      createUserMessage({
        content: systemPrompt.map(text => ({ type: 'text', text })),
      }),
      createUserMessage({
        content: userPrompt,
      }),
    ],
    async () => {
      const messages = [
        createUserMessage({
          content: userPrompt,
        }),
      ]

      const result = await queryModelWithoutStreaming({
        messages,
        systemPrompt,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal,
        options: {
          ...options,
          enablePromptCaching: options.enablePromptCaching ?? false,
          outputFormat,
          async getToolPermissionContext() {
            return getEmptyToolPermissionContext()
          },
        },
      })
      return [result]
    },
  )
  return result[0]! as AssistantMessage
}

// ═══ 非流式的 token 上限 ═══
//
// 这个 64_000 是**故意突破 SDK 默认值**的结果，注释把推导过程写清楚了：
//
//   API 文档：非流式请求上限 10 分钟
//   SDK 内部换算：10 min × 128k tokens/hour ≈ 21333 tokens
//   → SDK 用这个数当隐形上限
//
// 但 SDK 的换算假设是「按 token 生成速度推算超时」，而实际上
// 我们可以自己设 client timeout 绕开它（行 870）。绕开之后
// 这个常量就成了我们自己要守的上限。
//
// 换句话说：21333 是 SDK 的保护，64000 是我们接管保护后的新值。
// Non-streaming requests have a 10min max per the docs:
// https://platform.claude.com/docs/en/api/errors#long-requests
// The SDK's 21333-token cap is derived from 10min × 128k tokens/hour, but we
// bypass it by setting a client-level timeout, so we can cap higher.
export const MAX_NON_STREAMING_TOKENS = 64_000

/**
 * Adjusts thinking budget when max_tokens is capped for non-streaming fallback.
 * Ensures the API constraint: max_tokens > thinking.budget_tokens
 *
 * @param params - The parameters that will be sent to the API
 * @param maxTokensCap - The maximum allowed tokens (MAX_NON_STREAMING_TOKENS)
 * @returns Adjusted parameters with thinking budget capped if needed
 */
// 把 max_tokens 压到上限内，并且**同步调整 thinking 预算**。
//
// 为什么必须联动：API 有硬约束 max_tokens > thinking.budget_tokens。
// 只压 max_tokens 不压 budget_tokens，请求会直接 400。
//
// `cappedMaxTokens - 1` 里那个 -1 就是这个约束的体现：
// budget 必须**严格小于** max_tokens，等号也不行。
export function adjustParamsForNonStreaming<
  T extends {
    max_tokens: number
    thinking?: BetaMessageStreamParams['thinking']
  },
>(params: T, maxTokensCap: number): T {
  const cappedMaxTokens = Math.min(params.max_tokens, maxTokensCap)

  // Adjust thinking budget if it would exceed capped max_tokens
  // to maintain the constraint: max_tokens > thinking.budget_tokens
  const adjustedParams = { ...params }
  if (
    adjustedParams.thinking?.type === 'enabled' &&
    adjustedParams.thinking.budget_tokens
  ) {
    adjustedParams.thinking = {
      ...adjustedParams.thinking,
      budget_tokens: Math.min(
        adjustedParams.thinking.budget_tokens,
        cappedMaxTokens - 1, // Must be at least 1 less than max_tokens
      ),
    }
  }

  return {
    ...adjustedParams,
    max_tokens: cappedMaxTokens,
  }
}

// 这个开关（tengu_otk_slot_v1）控制「是否把默认 max_tokens 降到 8k」。
//
// 注释给了数据支撑：BQ p99 的实际输出是 4,911 tokens，
// 而默认的 32k/64k 会**超额预留 8-16 倍的并发槽位**。
// 也就是说大多数请求根本用不到那么多，但每个请求都按上限占坑，
// 服务端能同时服务的请求数就被这个虚高的默认值拖累了。
//
// 默认 false 是因为三方（Bedrock/Vertex）没验证过这个策略。
function isMaxTokensCapEnabled(): boolean {
  // 3P default: false (not validated on Bedrock/Vertex)
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_otk_slot_v1', false)
}

// 最终生效值的计算，四级优先（从低到高）：
//
//   1. 模型原生默认值
//   2. 若 slot-reservation 开关打开 → min(原生默认, 8k)
//      这里用 min 是为了不抬高本来就更低的模型（如 claude-3-opus 的 4k）
//   3. 环境变量 CLAUDE_CODE_MAX_OUTPUT_TOKENS
//   4. 模型原生上限（validateBoundedIntEnvVar 的 upperLimit，兜底防越界）
//
// 注意开关的施加位置：在环境变量**之前**。
// 所以用户显式设了 CLAUDE_CODE_MAX_OUTPUT_TOKENS 依然能覆盖掉 8k 的压缩——
// 这个顺序是刻意的，用户的显式配置永远优先于我们的成本优化。
export function getMaxOutputTokensForModel(model: string): number {
  const maxOutputTokens = getModelMaxOutputTokens(model)

  // Slot-reservation cap: drop default to 8k for all models. BQ p99 output
  // = 4,911 tokens; 32k/64k defaults over-reserve 8-16× slot capacity.
  // Requests hitting the cap get one clean retry at 64k (query.ts
  // max_output_tokens_escalate). Math.min keeps models with lower native
  // defaults (e.g. claude-3-opus at 4k) at their native value. Applied
  // before the env-var override so CLAUDE_CODE_MAX_OUTPUT_TOKENS still wins.
  const defaultTokens = isMaxTokensCapEnabled()
    ? Math.min(maxOutputTokens.default, CAPPED_DEFAULT_MAX_TOKENS)
    : maxOutputTokens.default

  const result = validateBoundedIntEnvVar(
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    defaultTokens,
    maxOutputTokens.upperLimit,
  )
  return result.effective
}
