// 文件级：本文件集中管理「beta 头」的判定与组装——决定每个模型、每家供应商（firstParty/foundry/bedrock/vertex）下应该携带哪些 beta 头，并处理 SDK 传入、订阅用户、环境变量开关等多路来源。
import { feature } from 'bun:bundle'
import memoize from 'lodash-es/memoize.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from 'src/services/analytics/growthbook.js'
import { getIsNonInteractiveSession, getSdkBetas } from '../bootstrap/state.js'
import {
  BEDROCK_EXTRA_PARAMS_HEADERS,
  CLAUDE_CODE_20250219_BETA_HEADER,
  CLI_INTERNAL_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER,
  TOKEN_EFFICIENT_TOOLS_BETA_HEADER,
  TOOL_SEARCH_BETA_HEADER_1P,
  TOOL_SEARCH_BETA_HEADER_3P,
  WEB_SEARCH_BETA_HEADER,
} from '../constants/betas.js'
import { OAUTH_BETA_HEADER } from '../constants/oauth.js'
import { isClaudeAISubscriber } from './auth.js'
import { has1mContext } from './context.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { getAPIProvider } from './model/providers.js'
import { getInitialSettings } from './settings/settings.js'

/**
 * SDK-provided betas that are allowed for API key users.
 * Only betas in this list can be passed via SDK options.
 */
const ALLOWED_SDK_BETAS = [CONTEXT_1M_BETA_HEADER]
// `ALLOWED_SDK_BETAS`：API key 用户通过 SDK 选项能传入的 beta 白名单，目前只放开 1M 上下文这一个。

/**
 * Filter betas to only include those in the allowlist.
 * Returns allowed and disallowed betas separately.
 */
// `partitionBetasByAllowlist`：把传入的 beta 列表按白名单拆成允许与不允许两份。
function partitionBetasByAllowlist(betas: string[]): {
  allowed: string[]
  disallowed: string[]
} {
  const allowed: string[] = []
  const disallowed: string[] = []
  for (const beta of betas) {
    if (ALLOWED_SDK_BETAS.includes(beta)) {
      allowed.push(beta)
    } else {
      disallowed.push(beta)
    }
  }
  return { allowed, disallowed }
}

/**
 * Filter SDK betas to only include allowed ones.
 * Warns about disallowed betas and subscriber restrictions.
 * Returns undefined if no valid betas remain or if user is a subscriber.
 */
// `filterAllowedSdkBetas`：过滤 SDK 传入的 beta，订阅用户直接忽略并告警，非白名单项逐个告警后只保留允许的。
export function filterAllowedSdkBetas(
  sdkBetas: string[] | undefined,
): string[] | undefined {
  if (!sdkBetas || sdkBetas.length === 0) {
    return undefined
  }

  if (isClaudeAISubscriber()) {
// 订阅用户只能用 API key 用户的专属 beta，传入自定义 beta 会被忽略。
    // biome-ignore lint/suspicious/noConsole: intentional warning
    console.warn(
      'Warning: Custom betas are only available for API key users. Ignoring provided betas.',
    )
    return undefined
  }

  const { allowed, disallowed } = partitionBetasByAllowlist(sdkBetas)
  for (const beta of disallowed) {
    // biome-ignore lint/suspicious/noConsole: intentional warning
    console.warn(
      `Warning: Beta header '${beta}' is not allowed. Only the following betas are supported: ${ALLOWED_SDK_BETAS.join(', ')}`,
    )
  }
  return allowed.length > 0 ? allowed : undefined
// 只返回白名单内且非空的结果；没有任何合法 beta 就返回 `undefined`。
}

// Generally, foundry supports all 1P features;
// however out of an abundance of caution, we do not enable any which are behind an experiment
// 注释说明：出于谨慎，foundry 虽然支持所有 1P 特性，但不自动开启任何处于实验后的 beta。

// `modelSupportsISP`：判断模型是否支持交错思考（interleaved thinking），优先看 3P 能力覆盖表，再看供应商与规范化模型名。
export function modelSupportsISP(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(
    model,
    'interleaved_thinking',
  )
  if (supported3P !== undefined) {
    return supported3P
  }
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  // Foundry supports interleaved thinking for all models
  if (provider === 'foundry') {
// foundry 对所有模型都支持交错思考，直接放行。
    return true
  }
  if (provider === 'firstParty') {
    return !canonical.includes('claude-3-')
  }
  return (
    canonical.includes('claude-opus-4') || canonical.includes('claude-sonnet-4')
  )
// firstParty 排除 `claude-3-` 前缀，其他供应商只认 opus-4 与 sonnet-4 家族。
}

// `vertexModelSupportsWebSearch`：Vertex 上只有 Claude 4.0 及以上模型支持联网搜索。
function vertexModelSupportsWebSearch(model: string): boolean {
  const canonical = getCanonicalName(model)
  // Web search only supported on Claude 4.0+ models on Vertex
  return (
    canonical.includes('claude-opus-4') ||
    canonical.includes('claude-sonnet-4') ||
    canonical.includes('claude-haiku-4')
  )
}

// Context management is supported on Claude 4+ models
// `modelSupportsContextManagement`：上下文管理在 Claude 4+ 模型上支持，逻辑与交错思考类似。
export function modelSupportsContextManagement(model: string): boolean {
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  if (provider === 'foundry') {
    return true
  }
  if (provider === 'firstParty') {
    return !canonical.includes('claude-3-')
  }
  return (
    canonical.includes('claude-opus-4') ||
    canonical.includes('claude-sonnet-4') ||
    canonical.includes('claude-haiku-4')
  )
}

// @[MODEL LAUNCH]: Add the new model ID to this list if it supports structured outputs.
// 模型上线提示：新增支持结构化输出的模型 ID 要加进 `modelSupportsStructuredOutputs` 的列表。
// `modelSupportsStructuredOutputs`：结构化输出仅限 firstParty 与 foundry（Bedrock/Vertex 暂不支持），并在给定模型名清单内。
export function modelSupportsStructuredOutputs(model: string): boolean {
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  // Structured outputs only supported on firstParty and Foundry (not Bedrock/Vertex yet)
  if (provider !== 'firstParty' && provider !== 'foundry') {
// 非 firstParty 且非 foundry 的供应商一律不支持结构化输出。
    return false
  }
  return (
    canonical.includes('claude-sonnet-4-6') ||
    canonical.includes('claude-sonnet-4-5') ||
    canonical.includes('claude-opus-4-1') ||
    canonical.includes('claude-opus-4-5') ||
    canonical.includes('claude-opus-4-6') ||
    canonical.includes('claude-haiku-4-5')
  )
// 命中 sonnet-4-6/4-5、opus-4-1/4-5/4-6、haiku-4-5 等模型即支持。
}

// @[MODEL LAUNCH]: Add the new model if it supports auto mode (specifically PI probes) — ask in #proj-claude-code-safety-research.
// 模型上线提示：新增支持自动模式（尤其 PI 探测）的模型要改 `modelSupportsAutoMode`，并去安全研究频道确认。
// `modelSupportsAutoMode`：判断是否启用自动模式，受 `TRANSCRIPT_CLASSIFIER` 特性、供应商与 GrowthBook 覆盖共同约束。
export function modelSupportsAutoMode(model: string): boolean {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    const m = getCanonicalName(model)
    // External: firstParty-only at launch (PI probes not wired for
    // Bedrock/Vertex/Foundry yet). Checked before allowModels so the GB
    // override can't enable auto mode on unsupported providers.
    if (process.env.USER_TYPE !== 'ant' && getAPIProvider() !== 'firstParty') {
// 外部用户且非 firstParty 供应商直接判定不支持，先于允许清单检查以免被覆盖绕过。
      return false
    }
    // GrowthBook override: tengu_auto_mode_config.allowModels force-enables
    // auto mode for listed models, bypassing the denylist/allowlist below.
    // Exact model IDs (e.g. "claude-strudel-v6-p") match only that model;
    // canonical names (e.g. "claude-strudel") match the whole family.
    const config = getFeatureValue_CACHED_MAY_BE_STALE<{
      allowModels?: string[]
    }>('tengu_auto_mode_config', {})
    const rawLower = model.toLowerCase()
    if (
      config?.allowModels?.some(
        am => am.toLowerCase() === rawLower || am.toLowerCase() === m,
      )
    ) {
      return true
    }
    if (process.env.USER_TYPE === 'ant') {
      // Denylist: block known-unsupported claude models, allow everything else (ant-internal models etc.)
      if (m.includes('claude-3-')) return false
      // claude-*-4 not followed by -[6-9]: blocks bare -4, -4-YYYYMMDD, -4@, -4-0 thru -4-5
      if (/claude-(opus|sonnet|haiku)-4(?!-[6-9])/.test(m)) return false
      return true
    }
    // External allowlist (firstParty already checked above).
    return /^claude-(opus|sonnet)-4-6/.test(m)
// 外部允许清单只放行 `claude-opus-4-6` 与 `claude-sonnet-4-6` 家族。
  }
  return false
}

/**
 * Get the correct tool search beta header for the current API provider.
 * - Claude API / Foundry: advanced-tool-use-2025-11-20
 * - Vertex AI / Bedrock: tool-search-tool-2025-10-19
 */
// `getToolSearchBetaHeader`：按当前供应商返回对应的工具搜索 beta 头，3P（vertex/bedrock）用一套、1P（Claude API/foundry）用另一套。
export function getToolSearchBetaHeader(): string {
  const provider = getAPIProvider()
  if (provider === 'vertex' || provider === 'bedrock') {
    return TOOL_SEARCH_BETA_HEADER_3P
  }
  return TOOL_SEARCH_BETA_HEADER_1P
}

/**
 * Check if experimental betas should be included.
 * These are betas that are only available on firstParty provider
 * and may not be supported by proxies or other providers.
 */
// `shouldIncludeFirstPartyOnlyBetas`：判断是否带上仅 firstParty 的实验 beta，需供应商为 firstParty 或 foundry 且未用环境变量关闭实验 beta。
export function shouldIncludeFirstPartyOnlyBetas(): boolean {
  return (
    (getAPIProvider() === 'firstParty' || getAPIProvider() === 'foundry') &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)
  )
}

/**
 * Global-scope prompt caching is firstParty only. Foundry is excluded because
 * GrowthBook never bucketed Foundry users into the rollout experiment — the
 * treatment data is firstParty-only.
 */
// `shouldUseGlobalCacheScope`：全局提示缓存范围仅 firstParty 可用，foundry 因未纳入实验分桶而被排除。
export function shouldUseGlobalCacheScope(): boolean {
  return (
    getAPIProvider() === 'firstParty' &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)
  )
}

// `getAllModelBetas`：记忆化地组装某模型应带的全部 beta 头，是后续所有 beta 计算的基础。
export const getAllModelBetas = memoize((model: string): string[] => {
  const betaHeaders = []
  const isHaiku = getCanonicalName(model).includes('haiku')
  const provider = getAPIProvider()
  const includeFirstPartyOnlyBetas = shouldIncludeFirstPartyOnlyBetas()

  if (!isHaiku) {
    betaHeaders.push(CLAUDE_CODE_20250219_BETA_HEADER)
    if (
      process.env.USER_TYPE === 'ant' &&
      process.env.CLAUDE_CODE_ENTRYPOINT === 'cli'
    ) {
      if (CLI_INTERNAL_BETA_HEADER) {
        betaHeaders.push(CLI_INTERNAL_BETA_HEADER)
      }
    }
  }
  if (isClaudeAISubscriber()) {
    betaHeaders.push(OAUTH_BETA_HEADER)
  }
  if (has1mContext(model)) {
    betaHeaders.push(CONTEXT_1M_BETA_HEADER)
  }
  if (
    !isEnvTruthy(process.env.DISABLE_INTERLEAVED_THINKING) &&
    modelSupportsISP(model)
  ) {
    betaHeaders.push(INTERLEAVED_THINKING_BETA_HEADER)
  }
// 未关闭交错思考且模型支持时就带上交错思考 beta 头。

  // Skip the API-side Haiku thinking summarizer — the summary is only used
  // for ctrl+o display, which interactive users rarely open. The API returns
  // redacted_thinking blocks instead; AssistantRedactedThinkingMessage already
  // renders those as a stub. SDK / print-mode keep summaries because callers
  // may iterate over thinking content. Users can opt back in via settings.json
  // showThinkingSummaries.
  if (
    includeFirstPartyOnlyBetas &&
    modelSupportsISP(model) &&
    !getIsNonInteractiveSession() &&
    getInitialSettings().showThinkingSummaries !== true
  ) {
    betaHeaders.push(REDACT_THINKING_BETA_HEADER)
  }
// 带 redact thinking beta 头的条件：1P 实验开启、模型支持交错思考、非交互会话、且设置里没开显示思考摘要。

  // POC: server-side connector-text summarization (anti-distillation). The
  // API buffers assistant text between tool calls, summarizes it, and returns
  // the summary with a signature so the original can be restored on subsequent
  // turns — same mechanism as thinking blocks. Ant-only while we measure
  // TTFT/TTLT/capacity; betas already flow to tengu_api_success for splitting.
  // Backend independently requires Capability.ANTHROPIC_INTERNAL_RESEARCH.
  //
  // USE_CONNECTOR_TEXT_SUMMARIZATION is tri-state: =1 forces on (opt-in even
  // if GB is off), =0 forces off (opt-out of a GB rollout you were bucketed
  // into), unset defers to GB.
  if (
    SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER &&
    process.env.USER_TYPE === 'ant' &&
    includeFirstPartyOnlyBetas &&
    !isEnvDefinedFalsy(process.env.USE_CONNECTOR_TEXT_SUMMARIZATION) &&
    (isEnvTruthy(process.env.USE_CONNECTOR_TEXT_SUMMARIZATION) ||
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_prism', false))
  ) {
    betaHeaders.push(SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER)
  }
// 连接器文本摘要 beta：蚂蚁内部专用，按环境变量三态（强制开/强制关/跟随 GrowthBook）决定是否启用。

  // Add context management beta for tool clearing (ant opt-in) or thinking preservation
  const antOptedIntoToolClearing =
    isEnvTruthy(process.env.USE_API_CONTEXT_MANAGEMENT) &&
    process.env.USER_TYPE === 'ant'

  const thinkingPreservationEnabled = modelSupportsContextManagement(model)

  if (
    shouldIncludeFirstPartyOnlyBetas() &&
    (antOptedIntoToolClearing || thinkingPreservationEnabled)
  ) {
    betaHeaders.push(CONTEXT_MANAGEMENT_BETA_HEADER)
  }
// 按蚂蚁内部选择工具清空或思考保留来加上下文管理 beta 头。
  // Add strict tool use beta if experiment is enabled.
  // Gate on includeFirstPartyOnlyBetas: CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  // already strips schema.strict from tool bodies at api.ts's choke point, but
  // this header was escaping that kill switch. Proxy gateways that look like
  // firstParty but forward to Vertex reject this header with 400.
  // github.com/deshaw/anthropic-issues/issues/5
  const strictToolsEnabled =
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_tool_pear')
// `strictToolsEnabled`：由 Statsig 特性门控制是否启用严格工具模式。
  // 3P default: false. API rejects strict + token-efficient-tools together
  // (tool_use.py:139), so these are mutually exclusive — strict wins.
  const tokenEfficientToolsEnabled =
    !strictToolsEnabled &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_json_tools', false)
// `tokenEfficientToolsEnabled`：严格模式与 JSON 高效工具互斥（API 会拒绝同时带两者），所以严格优先。
  if (
    includeFirstPartyOnlyBetas &&
    modelSupportsStructuredOutputs(model) &&
    strictToolsEnabled
  ) {
    betaHeaders.push(STRUCTURED_OUTPUTS_BETA_HEADER)
  }
// 模型支持结构化输出且严格工具开启时带结构化输出 beta 头。
  // JSON tool_use format (FC v3) — ~4.5% output token reduction vs ANTML.
  // Sends the v2 header (2026-03-28) added in anthropics/anthropic#337072 to
  // isolate the CC A/B cohort from ~9.2M/week existing v1 senders. Ant-only
  // while the restored JsonToolUseOutputParser soaks.
  if (
    process.env.USER_TYPE === 'ant' &&
    includeFirstPartyOnlyBetas &&
    tokenEfficientToolsEnabled
  ) {
    betaHeaders.push(TOKEN_EFFICIENT_TOOLS_BETA_HEADER)
  }
// JSON 工具调用格式（FC v3）约省 4.5% 输出 token，蚂蚁内部且在实验开启时带对应 beta 头。

  // Add web search beta for Vertex Claude 4.0+ models only
  if (provider === 'vertex' && vertexModelSupportsWebSearch(model)) {
// 仅 Vertex 上的 Claude 4.0+ 模型带联网搜索 beta 头。
    betaHeaders.push(WEB_SEARCH_BETA_HEADER)
  }
  // Foundry only ships models that already support Web Search
  if (provider === 'foundry') {
// foundry 只发布本身已支持联网搜索的模型，一律带上该 beta 头。
    betaHeaders.push(WEB_SEARCH_BETA_HEADER)
  }

  // Always send the beta header for 1P. The header is a no-op without a scope field.
  if (includeFirstPartyOnlyBetas) {
// 只要开启 1P 实验就始终发送提示缓存范围 beta 头，不带范围字段时它是空操作。
    betaHeaders.push(PROMPT_CACHING_SCOPE_BETA_HEADER)
  }

  // If ANTHROPIC_BETAS is set, split it by commas and add to betaHeaders.
  // This is an explicit user opt-in, so honor it regardless of model.
  if (process.env.ANTHROPIC_BETAS) {
// 环境变量 `ANTHROPIC_BETAS` 是用户显式选择，按逗号拆分后无条件追加，不受模型限制。
    betaHeaders.push(
      ...process.env.ANTHROPIC_BETAS.split(',')
        .map(_ => _.trim())
        .filter(Boolean),
    )
  }
  return betaHeaders
// 返回组装好的 beta 头数组，记忆化保证同模型不重复计算。
})

// `getModelBetas`：在全部 beta 基础上，bedrock 供应商过滤掉需要额外请求体的 beta 头。
export const getModelBetas = memoize((model: string): string[] => {
  const modelBetas = getAllModelBetas(model)
  if (getAPIProvider() === 'bedrock') {
    return modelBetas.filter(b => !BEDROCK_EXTRA_PARAMS_HEADERS.has(b))
  }
  return modelBetas
})

// `getBedrockExtraBodyParamsBetas`：与上一个相反，只挑出 bedrock 需要放进额外请求体的 beta 头。
export const getBedrockExtraBodyParamsBetas = memoize(
  (model: string): string[] => {
    const modelBetas = getAllModelBetas(model)
    return modelBetas.filter(b => BEDROCK_EXTRA_PARAMS_HEADERS.has(b))
  },
)

/**
 * Merge SDK-provided betas with auto-detected model betas.
 * SDK betas are read from global state (set via setSdkBetas in main.tsx).
 * The betas are pre-filtered by filterAllowedSdkBetas which handles
 * subscriber checks and allowlist validation with warnings.
 *
 * @param options.isAgenticQuery - When true, ensures the beta headers needed
 *   for agentic queries are present. For non-Haiku models these are already
 *   included by getAllModelBetas(); for Haiku they're excluded since
 *   non-agentic calls (compaction, classifiers, token estimation) don't need them.
 */
// `getMergedBetas`：把 SDK 传入的 beta 与自动探测的模型 beta 合并，去重后返回；`isAgenticQuery` 为真时确保代理查询必需的 beta 头在场。
export function getMergedBetas(
  model: string,
  options?: { isAgenticQuery?: boolean },
): string[] {
  const baseBetas = [...getModelBetas(model)]

  // Agentic queries always need claude-code and cli-internal beta headers.
  // For non-Haiku models these are already in baseBetas; for Haiku they're
  // excluded by getAllModelBetas() since non-agentic Haiku calls don't need them.
  if (options?.isAgenticQuery) {
// 代理查询必定需要 claude-code 与 cli-internal beta 头，Haiku 在基础集合里不含、这里补上。
    if (!baseBetas.includes(CLAUDE_CODE_20250219_BETA_HEADER)) {
      baseBetas.push(CLAUDE_CODE_20250219_BETA_HEADER)
    }
    if (
      process.env.USER_TYPE === 'ant' &&
      process.env.CLAUDE_CODE_ENTRYPOINT === 'cli' &&
      CLI_INTERNAL_BETA_HEADER &&
      !baseBetas.includes(CLI_INTERNAL_BETA_HEADER)
    ) {
      baseBetas.push(CLI_INTERNAL_BETA_HEADER)
    }
  }

  const sdkBetas = getSdkBetas()

  if (!sdkBetas || sdkBetas.length === 0) {
    return baseBetas
  }

  // Merge SDK betas without duplicates (already filtered by filterAllowedSdkBetas)
  return [...baseBetas, ...sdkBetas.filter(b => !baseBetas.includes(b))]
// 合并时只追加 SDK beta 中基础集合没有的项，避免重复。
}

// `clearBetasCaches`：清空三个记忆化函数的缓存，模型或供应商切换后调用以刷新。
export function clearBetasCaches(): void {
  getAllModelBetas.cache?.clear?.()
  getModelBetas.cache?.clear?.()
  getBedrockExtraBodyParamsBetas.cache?.clear?.()
}
