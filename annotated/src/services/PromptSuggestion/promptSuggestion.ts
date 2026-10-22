import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { Message } from '../../types/message.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { count } from '../../utils/array.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import { toError } from '../../utils/errors.js'
import {
  type CacheSafeParams,
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import { logError } from '../../utils/log.js'
import {
  createUserMessage,
  getLastAssistantMessage,
} from '../../utils/messages.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { isTeammate } from '../../utils/teammate.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { currentLimits } from '../claudeAiLimits.js'
import { isSpeculationEnabled, startSpeculation } from './speculation.js'

let currentAbortController: AbortController | null = null

export type PromptVariant = 'user_intent' | 'stated_intent'

export function getPromptVariant(): PromptVariant {
  return 'user_intent'
}
// 模块级 abort 句柄 currentAbortController 串起整条生成链路；getPromptVariant 当前只有一个变体 user_intent——「猜用户自己会敲什么」，而不是「猜模型该做什么」。

export function shouldEnablePromptSuggestion(): boolean {
  // Env var overrides everything (for testing)
  const envOverride = process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
  if (isEnvDefinedFalsy(envOverride)) {
    logEvent('tengu_prompt_suggestion_init', {
      enabled: false,
      source:
        'env' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }
  if (isEnvTruthy(envOverride)) {
    logEvent('tengu_prompt_suggestion_init', {
      enabled: true,
      source:
        'env' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return true
  }

  // Keep default in sync with Config.tsx (settings toggle visibility)
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_chomp_inflection', false)) {
    logEvent('tengu_prompt_suggestion_init', {
      enabled: false,
      source:
        'growthbook' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }

  // Disable in non-interactive mode (print mode, piped input, SDK)
  if (getIsNonInteractiveSession()) {
    logEvent('tengu_prompt_suggestion_init', {
      enabled: false,
      source:
        'non_interactive' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }

  // Disable for swarm teammates (only leader should show suggestions)
  if (isAgentSwarmsEnabled() && isTeammate()) {
    logEvent('tengu_prompt_suggestion_init', {
      enabled: false,
      source:
        'swarm_teammate' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }

  const enabled = getInitialSettings()?.promptSuggestionEnabled !== false
  logEvent('tengu_prompt_suggestion_init', {
    enabled,
    source:
      'setting' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return enabled
}
// 多级开关判定，优先级从高到低：环境变量（测试用）> GrowthBook 远程开关 tengu_chomp_inflection > 非交互会话（打印/管道/SDK 一律关）> 多智能体队友（只让 leader 显示）> 用户设置项。每一级都打 tengu_prompt_suggestion_init 日志记 source，便于事后看「为什么没出现建议」。

export function abortPromptSuggestion(): void {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
}
// abortPromptSuggestion：用户开始打字或切换上下文时调用，打断正在进行的建议生成，避免过期建议弹出。

/**
 * Returns a suppression reason if suggestions should not be generated,
 * or null if generation is allowed. Shared by main and pipelined paths.
 */
export function getSuggestionSuppressReason(appState: AppState): string | null {
  if (!appState.promptSuggestionEnabled) return 'disabled'
  if (appState.pendingWorkerRequest || appState.pendingSandboxRequest)
    return 'pending_permission'
  if (appState.elicitation.queue.length > 0) return 'elicitation_active'
  if (appState.toolPermissionContext.mode === 'plan') return 'plan_mode'
  if (
    process.env.USER_TYPE === 'external' &&
    currentLimits.status !== 'allowed'
  )
    return 'rate_limit'
  return null
}
// 运行期抑制原因：开关关了 / 正在等权限弹窗 / 有 elicitation 待回答 / 处于 plan 模式 / 外部用户且触发限流——任一命中就先不生成，主路径与流水线路径共用这份判据。

/**
 * Shared guard + generation logic used by both CLI TUI and SDK push paths.
 * Returns the suggestion with metadata, or null if suppressed/filtered.
 */
export async function tryGenerateSuggestion(
  abortController: AbortController,
  messages: Message[],
  getAppState: () => AppState,
  cacheSafeParams: CacheSafeParams,
  source?: 'cli' | 'sdk',
): Promise<{
  suggestion: string
  promptId: PromptVariant
  generationRequestId: string | null
} | null> {
  if (abortController.signal.aborted) {
    logSuggestionSuppressed('aborted', undefined, undefined, source)
    return null
  }

  const assistantTurnCount = count(messages, m => m.type === 'assistant')
  if (assistantTurnCount < 2) {
    logSuggestionSuppressed('early_conversation', undefined, undefined, source)
    return null
  }

  const lastAssistantMessage = getLastAssistantMessage(messages)
  if (lastAssistantMessage?.isApiErrorMessage) {
    logSuggestionSuppressed('last_response_error', undefined, undefined, source)
    return null
  }
  const cacheReason = getParentCacheSuppressReason(lastAssistantMessage)
  if (cacheReason) {
    logSuggestionSuppressed(cacheReason, undefined, undefined, source)
    return null
  }

  const appState = getAppState()
  const suppressReason = getSuggestionSuppressReason(appState)
  if (suppressReason) {
    logSuggestionSuppressed(suppressReason, undefined, undefined, source)
    return null
  }

  const promptId = getPromptVariant()
  const { suggestion, generationRequestId } = await generateSuggestion(
    abortController,
    promptId,
    cacheSafeParams,
  )
  if (abortController.signal.aborted) {
    logSuggestionSuppressed('aborted', undefined, undefined, source)
    return null
  }
  if (!suggestion) {
    logSuggestionSuppressed('empty', undefined, promptId, source)
    return null
  }
  if (shouldFilterSuggestion(suggestion, promptId, source)) return null

  return { suggestion, promptId, generationRequestId }
}
// 生成前的多道闸门：已被 abort / 对话太短（少于 2 个 assistant 轮次，没上下文可猜）/ 上一条是 API 报错 / 父消息「缓存冷」/ 运行期被抑制——任一挡住就记 suppressed 返回 null，不浪费一次模型调用。

export async function executePromptSuggestion(
  context: REPLHookContext,
): Promise<void> {
  if (context.querySource !== 'repl_main_thread') return

  currentAbortController = new AbortController()
  const abortController = currentAbortController
  const cacheSafeParams = createCacheSafeParams(context)

  try {
    const result = await tryGenerateSuggestion(
      abortController,
      context.messages,
      context.toolUseContext.getAppState,
      cacheSafeParams,
      'cli',
    )
    if (!result) return

    context.toolUseContext.setAppState(prev => ({
      ...prev,
      promptSuggestion: {
        text: result.suggestion,
        promptId: result.promptId,
        shownAt: 0,
        acceptedAt: 0,
        generationRequestId: result.generationRequestId,
      },
    }))

    if (isSpeculationEnabled() && result.suggestion) {
      void startSpeculation(
        result.suggestion,
        context,
        context.toolUseContext.setAppState,
        false,
        cacheSafeParams,
      )
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'APIUserAbortError')
    ) {
      logSuggestionSuppressed('aborted', undefined, undefined, 'cli')
      return
    }
    logError(toError(error))
  } finally {
    if (currentAbortController === abortController) {
      currentAbortController = null
    }
  }
}
// CLI TUI 入口：只在主线程 REPL 触发；生成成功后写进 AppState.promptSuggestion 让 UI 弹建议；若投机功能开启，紧接着用这条建议启动 startSpeculation——建议与投机是上下游关系。

const MAX_PARENT_UNCACHED_TOKENS = 10_000

export function getParentCacheSuppressReason(
  lastAssistantMessage: ReturnType<typeof getLastAssistantMessage>,
): string | null {
  if (!lastAssistantMessage) return null

  const usage = lastAssistantMessage.message.usage
  const inputTokens = usage.input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  // The fork re-processes the parent's output (never cached) plus its own prompt.
  const outputTokens = usage.output_tokens ?? 0

  return inputTokens + cacheWriteTokens + outputTokens >
    MAX_PARENT_UNCACHED_TOKENS
    ? 'cache_cold'
    : null
}
// 父消息 token 预算 MAX_PARENT_UNCACHED_TOKENS=10,000：把 input + cache_creation + output 加起来，超过就说「缓存冷」不投机。因为 fork 要重新处理父消息的输出，父消息太大时投机成本盖过收益。

const SUGGESTION_PROMPT = `[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]

FIRST: Look at the user's recent messages and original request.

Your job is to predict what THEY would type - not what you think they should do.

THE TEST: Would they think "I was just about to type that"?

EXAMPLES:
User asked "fix the bug and run tests", bug is fixed → "run the tests"
After code written → "try it out"
Claude offers options → suggest the one the user would likely pick, based on conversation
Claude asks to continue → "yes" or "go ahead"
Task complete, obvious follow-up → "commit this" or "push it"
After error or misunderstanding → silence (let them assess/correct)

Be specific: "run the tests" beats "continue".

NEVER SUGGEST:
- Evaluative ("looks good", "thanks")
- Questions ("what about...?")
- Claude-voice ("Let me...", "I'll...", "Here's...")
- New ideas they didn't ask about
- Multiple sentences

Stay silent if the next step isn't obvious from what the user said.

Format: 2-12 words, match the user's style. Or nothing.

Reply with ONLY the suggestion, no quotes or explanation.`

const SUGGESTION_PROMPTS: Record<PromptVariant, string> = {
  user_intent: SUGGESTION_PROMPT,
  stated_intent: SUGGESTION_PROMPT,
}
// 预测「用户会自然敲什么」的提示词：核心原则是「他们刚要敲的那句」，不是「模型觉得该做什么」。给了一堆反例——禁止评价性（looks good）、提问、模型口吻（Let me…）、新点子；格式限制 2-12 词，否则就沉默。SUGGESTION_PROMPTS 按变体存，目前两种变体共用同一份。

export async function generateSuggestion(
  abortController: AbortController,
  promptId: PromptVariant,
  cacheSafeParams: CacheSafeParams,
): Promise<{ suggestion: string | null; generationRequestId: string | null }> {
  const prompt = SUGGESTION_PROMPTS[promptId]

  // Deny tools via callback, NOT by passing tools:[] - that busts cache (0% hit)
  const canUseTool = async () => ({
    behavior: 'deny' as const,
    message: 'No tools needed for suggestion',
    decisionReason: { type: 'other' as const, reason: 'suggestion only' },
  })

  // DO NOT override any API parameter that differs from the parent request.
  // The fork piggybacks on the main thread's prompt cache by sending identical
  // cache-key params. The billing cache key includes more than just
  // system/tools/model/messages/thinking — empirically, setting effortValue
  // or maxOutputTokens on the fork (even via output_config or getAppState)
  // busts cache. PR #18143 tried effort:'low' and caused a 45x spike in cache
  // writes (92.7% → 61% hit rate). The only safe overrides are:
  //   - abortController (not sent to API)
  //   - skipTranscript (client-side only)
  //   - skipCacheWrite (controls cache_control markers, not the cache key)
  //   - canUseTool (client-side permission check)
// 缓存安全铁律：fork 绝不改任何会破坏 prompt 缓存的 API 参数。它靠发「和主线程一模一样的 cache key 参数」蹭主线程的缓存。教训来自 PR #18143——曾给 fork 设 effort:low，导致缓存写入暴涨 45 倍、命中率从 92.7% 跌到 61%。唯一安全的覆写是 abortController / skipTranscript / skipCacheWrite / canUseTool 这些「不进缓存键」的客户端侧参数。
  const result = await runForkedAgent({
    promptMessages: [createUserMessage({ content: prompt })],
    cacheSafeParams, // Don't override tools/thinking settings - busts cache
    canUseTool,
    querySource: 'prompt_suggestion',
    forkLabel: 'prompt_suggestion',
    overrides: {
      abortController,
    },
    skipTranscript: true,
    skipCacheWrite: true,
  })

  // Check ALL messages - model may loop (try tool → denied → text in next message)
  // Also extract the requestId from the first assistant message for RL dataset joins
  const firstAssistantMsg = result.messages.find(m => m.type === 'assistant')
  const generationRequestId =
    firstAssistantMsg?.type === 'assistant'
      ? (firstAssistantMsg.requestId ?? null)
      : null

  for (const msg of result.messages) {
    if (msg.type !== 'assistant') continue
    const textBlock = msg.message.content.find(b => b.type === 'text')
    if (textBlock?.type === 'text') {
      const suggestion = textBlock.text.trim()
      if (suggestion) {
        return { suggestion, generationRequestId }
      }
    }
  }

  return { suggestion: null, generationRequestId }
}
// fork 子代理猜下一句：canUseTool 直接全部 deny（猜文字不需要工具），从结果里取第一个 assistant 文本块当建议；同时抓第一条 assistant 的 requestId 供强化学习数据集关联。

export function shouldFilterSuggestion(
  suggestion: string | null,
  promptId: PromptVariant,
  source?: 'cli' | 'sdk',
): boolean {
  if (!suggestion) {
    logSuggestionSuppressed('empty', undefined, promptId, source)
    return true
  }

  const lower = suggestion.toLowerCase()
  const wordCount = suggestion.trim().split(/\s+/).length

  const filters: Array<[string, () => boolean]> = [
    ['done', () => lower === 'done'],
    [
      'meta_text',
      () =>
        lower === 'nothing found' ||
        lower === 'nothing found.' ||
        lower.startsWith('nothing to suggest') ||
        lower.startsWith('no suggestion') ||
        // Model spells out the prompt's "stay silent" instruction
        /\bsilence is\b|\bstay(s|ing)? silent\b/.test(lower) ||
        // Model outputs bare "silence" wrapped in punctuation/whitespace
        /^\W*silence\W*$/.test(lower),
    ],
    [
      'meta_wrapped',
      // Model wraps meta-reasoning in parens/brackets: (silence — ...), [no suggestion]
      () => /^\(.*\)$|^\[.*\]$/.test(suggestion),
    ],
    [
      'error_message',
      () =>
        lower.startsWith('api error:') ||
        lower.startsWith('prompt is too long') ||
        lower.startsWith('request timed out') ||
        lower.startsWith('invalid api key') ||
        lower.startsWith('image was too large'),
    ],
    ['prefixed_label', () => /^\w+:\s/.test(suggestion)],
    [
      'too_few_words',
      () => {
        if (wordCount >= 2) return false
        // Allow slash commands — these are valid user commands
        if (suggestion.startsWith('/')) return false
        // Allow common single-word inputs that are valid user commands
        const ALLOWED_SINGLE_WORDS = new Set([
          // Affirmatives
          'yes',
          'yeah',
          'yep',
          'yea',
          'yup',
          'sure',
          'ok',
          'okay',
          // Actions
          'push',
          'commit',
          'deploy',
          'stop',
          'continue',
          'check',
          'exit',
          'quit',
          // Negation
          'no',
        ])
        return !ALLOWED_SINGLE_WORDS.has(lower)
      },
    ],
    ['too_many_words', () => wordCount > 12],
    ['too_long', () => suggestion.length >= 100],
    ['multiple_sentences', () => /[.!?]\s+[A-Z]/.test(suggestion)],
    ['has_formatting', () => /[\n*]|\*\*/.test(suggestion)],
    [
      'evaluative',
      () =>
        /thanks|thank you|looks good|sounds good|that works|that worked|that's all|nice|great|perfect|makes sense|awesome|excellent/.test(
          lower,
        ),
    ],
    [
      'claude_voice',
      () =>
        /^(let me|i'll|i've|i'm|i can|i would|i think|i notice|here's|here is|here are|that's|this is|this will|you can|you should|you could|sure,|of course|certainly)/i.test(
          suggestion,
        ),
    ],
  ]

  for (const [reason, check] of filters) {
    if (check()) {
      logSuggestionSuppressed(reason, suggestion, promptId, source)
      return true
    }
  }

  return false
}
// 一堆输出过滤器：剔除「看起来不像用户会敲」的结果——done / 元文本（nothing found、silence 等）/ 括号包裹的元推理 / 报错串 / 带前缀标签 / 词数太少（除非是 / 命令或 yes/commit 等白名单单词）/ 词数太多 / 超长 / 多句 / 含格式符 / 评价性语气 / 模型口吻。每命中一条都记 suppressed 并带上原因。

/**
 * Log acceptance/ignoring of a prompt suggestion. Used by the SDK push path
 * to track outcomes when the next user message arrives.
 */
export function logSuggestionOutcome(
  suggestion: string,
  userInput: string,
  emittedAt: number,
  promptId: PromptVariant,
  generationRequestId: string | null,
): void {
  const similarity =
    Math.round((userInput.length / (suggestion.length || 1)) * 100) / 100
  const wasAccepted = userInput === suggestion
  const timeMs = Math.max(0, Date.now() - emittedAt)

  logEvent('tengu_prompt_suggestion', {
    source: 'sdk' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    outcome: (wasAccepted
      ? 'accepted'
      : 'ignored') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    prompt_id:
      promptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(generationRequestId && {
      generationRequestId:
        generationRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(wasAccepted && {
      timeToAcceptMs: timeMs,
    }),
    ...(!wasAccepted && { timeToIgnoreMs: timeMs }),
    similarity,
    ...(process.env.USER_TYPE === 'ant' && {
      suggestion:
        suggestion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      userInput:
        userInput as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
}
// SDK 推送路径的结局记录：用户下一条输入到来时，比对是否与建议完全一致判 accepted/ignored，记省时（accept）或忽略耗时，算一个粗相似度；内部用户额外把建议原文与用户输入也记进去（外部不记，守隐私）。

export function logSuggestionSuppressed(
  reason: string,
  suggestion?: string,
  promptId?: PromptVariant,
  source?: 'cli' | 'sdk',
): void {
  const resolvedPromptId = promptId ?? getPromptVariant()
  logEvent('tengu_prompt_suggestion', {
    ...(source && {
      source:
        source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    outcome:
      'suppressed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    prompt_id:
      resolvedPromptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(process.env.USER_TYPE === 'ant' &&
      suggestion && {
        suggestion:
          suggestion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
  })
}
// 抑制记录收口：所有「为什么没生成建议」的原因（aborted/early_conversation/cache_cold/plan_mode 等）统一从这一个入口打 tengu_prompt_suggestion 事件（outcome=suppressed），便于统计各类抑制占比。
