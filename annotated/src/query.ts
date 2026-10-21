// ═══════════════════════════════════════════════════════════════
// 第 5 步 · 主循环 · 2/4 —— 主循环（src/query.ts）
//
// 如果 prompts.ts 决定「说什么」，这个文件决定「怎么一轮一轮地跑」。
// 它是整个 Claude Code 的心脏：模型说话 → 调工具 → 看结果 → 再说话，
// 加上压缩、重试、回退、中断、预算控制。
//
// 【先建立正确的心智模型，否则这 1729 行会读得很痛苦】
//
// 它**不是**递归函数，尽管注释里到处说 "recursive call"、"next recursive call"。
// 真实结构是：
//
//     query()            ← 薄壳，只做「收尾通知」，行 219
//       └─ yield* queryLoop()   ← 真正的实现，行 241
//            └─ while (true) {   ← 状态机，行 307
//                 ... 读 state
//                 ... 干活
//                 state = next; continue   ← 7 个转换点
//                 ... 或者 return { reason }
//               }
//
// 为什么用 while + state 而不是递归？因为要支持 7 种「重来一次但不一样」：
// 压缩后重试、回退模型后重试、max_tokens 升级后重试、stop hook 拦截后重试…
// 递归写法会让调用栈上堆 7 层同名函数，中断/取消几乎没法处理。
// while 写法只有一个栈帧，`state.transition.reason` 记录「上一轮为什么重来」，
// 测试可以直接断言这个字段，不用去翻消息内容。
//
// 【三个必须先理解的概念，后面会反复出现】
//
//   ① withheld（暂扣）
//      可恢复的错误**先不 yield**，等确认恢复不了再 yield。
//      原因见行 166 那段注释：SDK 客户端看到 error 字段就直接终止会话，
//      而恢复循环还在跑 —— 没人听了。所以错误要先扣住。
//
//   ② State（跨轮可变状态）
//      9 个字段，行 204。每轮开头解构出来，转换时整体重建（而不是逐字段赋值）。
//      注意 taskBudgetRemaining **没**放进 State —— 行 282 的注释说
//      「避免碰那 7 个 continue 站点」，这是真实的设计痛点。
//
//   ③ Terminal（终止原因）
//      return 的是 `{ reason: 'xxx' }` 而不是 void。11 种终止原因，
//      是给测试和遥测用的显式标签。
//
// 建议阅读顺序：行 219 的 query() → 行 204 的 State → 行 241 的 queryLoop
// 初始化 → 行 307 的 while 主体 → 最后挑一个 continue 站点（比如行 1085
// 的 prompt-too-long 恢复）细看它怎么构造 next state。
// ═══════════════════════════════════════════════════════════════
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
// 注：和 prompts.ts 一样的第一行 —— 同一个理由（见上一个文件的批注）：
//     `feature('XXX') ? require(...) : null` 这种条件导入的求值顺序
//     决定了 DCE 能不能奏效，自动整理 import 会破坏它。
import type {
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import { FallbackTriggeredError } from './services/api/withRetry.js'
import {
  calculateTokenWarningState,
  isAutoCompactEnabled,
  type AutoCompactTrackingState,
} from './services/compact/autoCompact.js'
import { buildPostCompactMessages } from './services/compact/compact.js'
// ── 1. 第一组条件导入：三个压缩/上下文模块 ──
// 这三行是整个文件的主题预演 —— 这个主循环有**四层**上下文管理机制：
//   HISTORY_SNIP      → 剪掉历史（行 400）
//   CACHED_MICROCOMPACT → 微压缩（行 423）
//   CONTEXT_COLLAPSE  → 折叠（行 440）
//   REACTIVE_COMPACT  → 反应式压缩（行 1119）
//   加上常规的 autoCompact（行 454），一共五条压缩路径。
// 为什么这么多？因为「上下文满了」有五种不同的成因和解法，
// 而每一种都必须在主循环里占一个位置。
/* eslint-disable @typescript-eslint/no-require-imports */
// 注：这段 eslint-disable/enable 之间的三行，就是本文件的第一组
//     条件导入。注意 REACTIVE_COMPACT 和 CONTEXT_COLLAPSE 都是
//     `const x = feature(...) ? require(...) : null` 的形状 ——
//     外部版里这两个变量是 null，后面所有 `reactiveCompact?.xxx()`
//     都会短路成 undefined，行为等价于「功能不存在」。
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('./services/compact/reactiveCompact.js') as typeof import('./services/compact/reactiveCompact.js'))
  : null
const contextCollapse = feature('CONTEXT_COLLAPSE')
  ? (require('./services/contextCollapse/index.js') as typeof import('./services/contextCollapse/index.js'))
  : null
// ── 2. 第二组条件导入：三个后台任务模块 ──
//   EXPERIMENTAL_SKILL_SEARCH → 技能发现预取（在模型流式输出时并行搜）
//   TEMPLATES                 → 任务分类器
// 加上行 114 那组的 HISTORY_SNIP / BG_SESSIONS，全文件共 8 个条件导入。
// 这是 prompt cache / bundle 体积之外的另一条成本线：
// **每加一个可选功能，主循环就多一个可能是 null 的分支。**
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { ImageSizeError } from './utils/imageValidation.js'
import { ImageResizeError } from './utils/imageResizer.js'
import { findToolByName, type ToolUseContext } from './Tool.js'
import { asSystemPrompt, type SystemPrompt } from './utils/systemPromptType.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  ToolUseSummaryMessage,
  UserMessage,
  TombstoneMessage,
} from './types/message.js'
import { logError } from './utils/log.js'
import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  isPromptTooLongMessage,
} from './services/api/errors.js'
import { logAntError, logForDebugging } from './utils/debug.js'
import {
  createUserMessage,
  createUserInterruptionMessage,
  normalizeMessagesForAPI,
  createSystemMessage,
  createAssistantAPIErrorMessage,
  getMessagesAfterCompactBoundary,
  createToolUseSummaryMessage,
  createMicrocompactBoundaryMessage,
  stripSignatureBlocks,
} from './utils/messages.js'
import { generateToolUseSummary } from './services/toolUseSummary/toolUseSummaryGenerator.js'
import { prependUserContext, appendSystemContext } from './utils/api.js'
import {
  createAttachmentMessage,
  filterDuplicateMemoryAttachments,
  getAttachmentMessages,
  startRelevantMemoryPrefetch,
} from './utils/attachments.js'
/* eslint-disable @typescript-eslint/no-require-imports */
const skillPrefetch = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('./services/skillSearch/prefetch.js') as typeof import('./services/skillSearch/prefetch.js'))
  : null
const jobClassifier = feature('TEMPLATES')
  ? (require('./jobs/classifier.js') as typeof import('./jobs/classifier.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  remove as removeFromQueue,
  getCommandsByMaxPriority,
  isSlashCommand,
} from './utils/messageQueueManager.js'
import { notifyCommandLifecycle } from './utils/commandLifecycle.js'
import { headlessProfilerCheckpoint } from './utils/headlessProfiler.js'
import {
  getRuntimeMainLoopModel,
  renderModelName,
} from './utils/model/model.js'
import {
  doesMostRecentAssistantMessageExceed200k,
  finalContextTokensFromLastResponse,
  tokenCountWithEstimation,
} from './utils/tokens.js'
import { ESCALATED_MAX_TOKENS } from './utils/context.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from './services/analytics/growthbook.js'
import { SLEEP_TOOL_NAME } from './tools/SleepTool/prompt.js'
import { executePostSamplingHooks } from './utils/hooks/postSamplingHooks.js'
import { executeStopFailureHooks } from './utils/hooks.js'
import type { QuerySource } from './constants/querySource.js'
import { createDumpPromptsFetch } from './services/api/dumpPrompts.js'
import { StreamingToolExecutor } from './services/tools/StreamingToolExecutor.js'
import { queryCheckpoint } from './utils/queryProfiler.js'
import { runTools } from './services/tools/toolOrchestration.js'
import { applyToolResultBudget } from './utils/toolResultStorage.js'
import { recordContentReplacement } from './utils/sessionStorage.js'
import { handleStopHooks } from './query/stopHooks.js'
import { buildQueryConfig } from './query/config.js'
import { productionDeps, type QueryDeps } from './query/deps.js'
import type { Terminal, Continue } from './query/transitions.js'
import { feature } from 'bun:bundle'
import {
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  incrementBudgetContinuationCount,
} from './bootstrap/state.js'
import { createBudgetTracker, checkTokenBudget } from './query/tokenBudget.js'
import { count } from './utils/array.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import('./services/compact/snipCompact.js'))
  : null
const taskSummaryModule = feature('BG_SESSIONS')
  ? (require('./utils/taskSummary.js') as typeof import('./utils/taskSummary.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

// ── 3. 补 tool_result：一个"兜底生成器" ──
//
// 这个函数很小，但它承担的是整个 agent 协议里最硬的约束：
// **每一个 tool_use 都必须有一个配对的 tool_result。**
// 如果模型发出了 tool_use，而我们在产出 tool_result 之前出了错
// （抛异常、被中断、模型回退），历史里就留下一个孤儿 tool_use。
// 下一次请求时 API 会直接 400。
//
// 所以每个提前退出的路径都要先调它，把「本来应该有但没产出」的
// tool_result 用错误信息补齐。全文共调用 4 次（行 900、984、1025，
// 以及 streaming executor 内部的等价逻辑）。
//
// 注意它是 `function*`（同步生成器）而不是 `async function*` ——
// 因为它只是拼消息，不需要 await。而调用它的地方用的是 `yield*`，
// 所以同步/异步生成器都能被 yield* 委托，这是生成器套生成器的
// 第一种用法。
function* yieldMissingToolResultBlocks(
  assistantMessages: AssistantMessage[],
  errorMessage: string,
) {
  for (const assistantMessage of assistantMessages) {
    // Extract all tool use blocks from this assistant message
    const toolUseBlocks = assistantMessage.message.content.filter(
      content => content.type === 'tool_use',
    ) as ToolUseBlock[]

    // Emit an interruption message for each tool use
    for (const toolUse of toolUseBlocks) {
      yield createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: errorMessage,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: errorMessage,
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
  }
}
// 注：注意这里生成的是 **user 消息**，不是 system 消息。
//     因为 tool_result 在 Anthropic API 里必须包在 user 角色里 ——
//     「工具的结果」在协议上被表述为「用户告诉模型工具返回了什么」。
//     `is_error: true` 让模型知道这不是成功结果，它会去读 errorMessage 并调整。

// ═══════════════════════════════════════════════════════════════
// ── 4. thinking block 的三条铁律（用巫师口吻写的） ──
// 这是全代码库最有意思的一段注释，但它讲的是硬约束，不是玩笑。
// ═══════════════════════════════════════════════════════════════
/**
 * The rules of thinking are lengthy and fortuitous. They require plenty of thinking
 * of most long duration and deep meditation for a wizard to wrap one's noggin around.
 *
 * The rules follow:
 * 1. A message that contains a thinking or redacted_thinking block must be part of a query whose max_thinking_length > 0
 * 2. A thinking block may not be the last message in a block
 * 3. Thinking blocks must be preserved for the duration of an assistant trajectory (a single turn, or if that turn includes a tool_use block then also its subsequent tool_result and the following assistant message)
 *
 * Heed these rules well, young wizard. For they are the rules of thinking, and
 * the rules of thinking are the rules of the universe. If ye does not heed these
 * rules, ye will be punished with an entire day of debugging and hair pulling.
 */
// 译：思考的规则冗长而偶然。它们要求真正的巫师进行大量、长时间的
//     思考与深度冥想，才能把脑子绕明白。
//
//     规则如下：
//     1. 含 thinking 或 redacted_thinking 块的消息，必须属于一个
//        max_thinking_length > 0 的请求。
//     2. thinking 块不能是消息序列里的最后一条。
//     3. thinking 块必须在整个 assistant trajectory 期间保留
//        （单轮；若该轮含 tool_use 块，则还包括随后的 tool_result
//         和下一条 assistant 消息）。
//
//     好好遵守这些规则，年轻的巫师。因为它们就是思考的规则，
//     而思考的规则就是宇宙的规则。若你不遵守，你将受到惩罚：
//     整整一天的调试和抓头发。
//
// 注：这段"咒语"背后是三个真实的 API 约束，值得翻译成工程语言：
//
//   ① thinking 只能在开了 extended thinking 的请求里出现。
//      否则 API 报错。所以「关掉 thinking 重试」不是个省事的操作。
//
//   ② thinking 块不能是最后一条 —— 因为模型思考完必须给答案。
//      如果你把 thinking 单独当一条消息发回去，400。
//
//   ③ 最要命的一条：thinking 块要跟着整条 trajectory 走。
//      这直接解释了两件事：
//      · 为什么行 716 要发 tombstone（墓碑）：流式失败后重试，
//        旧的 thinking 块签名已失效（签名是和模型绑定的），
//        留在历史里会导致 "thinking blocks cannot be modified" 错误。
//      · 为什么行 928 要 stripSignatureBlocks：从 capybara 回退到 opus 时，
//        capybara 的 thinking 签名对 opus 无效，必须剥掉。
//
//   注释里"整整一天的调试和抓头发"不是修辞 —— 这类错误信息极其晦涩，
//   报错位置离根因很远。所以作者选择在常量定义处写一大段警告，
//   让每个要改这个常量的人都先读一遍。
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3
// 注：值 3。配合行 1223 的重试判断看：
//     最多重试 3 次「输出被截断」，第 4 次就直接把错误吐给用户。
//     为什么是 3 而不是 10？因为每次重试都要重新发一遍完整上下文，
//     连续 3 次截断说明这个任务对当前模型就是太大了，再试也是浪费钱。

// ═══════════════════════════════════════════════════════════════
// ── 5. withheld（暂扣）概念的第一次出场 ──
// 这个函数本身很简单，但那段注释是整个文件里最重要的设计说明之一。
// ═══════════════════════════════════════════════════════════════
/**
 * Is this a max_output_tokens error message? If so, the streaming loop should
 * withhold it from SDK callers until we know whether the recovery loop can
 * continue. Yielding early leaks an intermediate error to SDK callers (e.g.
 * cowork/desktop) that terminate the session on any `error` field — the
 * recovery loop keeps running but nobody is listening.
 *
 * Mirrors reactiveCompact.isWithheldPromptTooLong.
 */
// 译：这是一个 max_output_tokens 错误消息吗？如果是，流式循环就应该
//     先把它扣住、不给 SDK 调用方，直到我们知道恢复循环还能不能继续。
//     提前 yield 会把一个中间态错误泄露给 SDK 调用方（比如 cowork/desktop），
//     而它们遇到任何 `error` 字段就终止会话 —— 恢复循环还在跑，但没人听了。
//
//     与 reactiveCompact.isWithheldPromptTooLong 对称。
//
// 注：这段话值得反复读，它解释了一个非常微妙的时序问题：
//
//     【错误其实是可恢复的】
//     模型输出被 max_tokens 截断 → 我们可以注入一条「继续」消息重试（行 1224）。
//     这在内部是完全正常的流程，用户根本不该感知。
//
//     【但 SDK 调用方不是这么想的】
//     desktop / cowork 这些客户端拿到流式消息后，一看到 `error` 字段
//     就认为会话结束，直接把 UI 关掉。它们不关心「后面还有恢复逻辑」。
//
//     【所以解耦：内部照走恢复流程，外部先扣住错误】
//     把错误推进 assistantMessages（内部状态），但**不 yield**（外部流）。
//     等恢复成功了，用户什么都不会看到；等恢复彻底失败，再 yield 出来（行 1255）。
//
// 这个模式在本文件出现了 4 次（PTL、media、max_output_tokens、
// 以及 collapse 的版本），是这个文件最核心的一个设计范式：
// **「可恢复的错误要延迟上报」**。
//
// 类型谓词 `msg is AssistantMessage` 的作用：调用后 TypeScript 就知道
// 这一定是 assistant 消息，下面可以直接读 .message.content。
function isWithheldMaxOutputTokens(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return msg?.type === 'assistant' && msg.apiError === 'max_output_tokens'
}

// ═══════════════════════════════════════════════════════════════
// ── 6. QueryParams：一次 query() 调用的全部输入 ──
// 注意这个类型是**只读设计**的（虽然没写 readonly）：
// 行 252 的注释明确说 "Immutable params — never reassigned"。
// 跨轮可变的东西全在 State 里，不在 Params 里。这个分离是刻意的。
// ═══════════════════════════════════════════════════════════════
export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
// ── 6.1 taskBudget：和 tokenBudget 是两套完全不同的东西 ──
  // API task_budget (output_config.task_budget, beta task-budgets-2026-03-13).
  // Distinct from the tokenBudget +500k auto-continue feature. `total` is the
  // budget for the whole agentic turn; `remaining` is computed per iteration
  // from cumulative API usage. See configureTaskBudgetParams in claude.ts.
  taskBudget?: { total: number }
// 译：API 侧的 task_budget（output_config.task_budget，
//     beta 头 task-budgets-2026-03-13）。
//     与 tokenBudget +500k 自动续跑功能**不同**。
//     `total` 是整个 agentic turn 的预算；`remaining` 每次迭代
//     由累积的 API 用量算出。见 claude.ts 的 configureTaskBudgetParams。
//
// 注：两个同名但不同层的预算，很容易混。区别在于「谁记账」：
//   · tokenBudget（+500k）   → 客户端记账。模型跑完一轮，客户端看
//                              输出 token 数够不够，不够就注入一条
//                              「继续干」的消息（行 1321）。
//   · taskBudget（API 侧）    → 服务端记账。把 total 发给 API，
//                              API 自己倒计时并在快用完时改变行为。
// 为什么需要服务端记账？因为压缩。压缩后服务端只看到摘要，
// 它算出的已用额度会偏小 —— 所以客户端要把 remaining 补给它（行 282-291）。
// 这个「压缩后要补偿额度」的问题，在行 504 和 1135 各处理了一次，
// 因为压缩有两个触发点。
  deps?: QueryDeps
}

// -- query loop state

// Mutable state carried between loop iterations
// ═══════════════════════════════════════════════════════════════
// ── 7. State：跨轮可变状态（9 个字段） ──
// 每轮开头整体解构，转换时整体重建。不逐字段赋值 —— 行 267 的注释
// 解释了原因：`state = { ... }` 比 9 次独立赋值更不容易漏字段。
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  // Why the previous iteration continued. Undefined on first iteration.
  // Lets tests assert recovery paths fired without inspecting message contents.
  transition: Continue | undefined
}
// 注：9 个字段可以分成三组看：
//
//   【数据】messages, toolUseContext
//     整轮对话的输入。toolUseContext 是唯一会在**一轮内部**被重新赋值的
//     （行 311 注释：「toolUseContext alone is reassigned within an iteration」），
//     所以行 311 用的是 `let { toolUseContext } = state`，
//     其余 7 个用 `const { ... }`。
//
//   【压缩记账】autoCompactTracking
//     记录「上次压缩在第几轮、连续失败几次」。做成对象而不是两个数字，
//     因为要传给 autoCompact 并且可能被它改写。
//
//   【恢复计数器】maxOutputTokensRecoveryCount, hasAttemptedReactiveCompact,
//                 maxOutputTokensOverride
//     三个都是「这条恢复路径走过没有」的标记，防止无限重试。
//     注意它们各自控制一条路径：输出截断重试计数、反应式压缩只做一次、
//     以及 max_tokens 升级只做一次（override 非 undefined 就不再升级）。
//
//   【跨轮延迟任务】pendingToolUseSummary
//     上一轮发起的「工具使用摘要」生成任务（Haiku 调用，约 1 秒），
//     在下一轮开始时 await 它并 yield 出去（行 1054-1060）。
//     这是个很聪明的隐藏延迟：模型流式输出要 5-30 秒，
//     摘要生成在后台跑，用户感知不到。
//
//   【控制流】stopHookActive, turnCount, transition
//     transition 是「上一轮为什么 continue」的标签，11 种取值。
//     行 214 的注释说得很直白：**让测试能断言恢复路径触发过**，
//     不用去比对消息内容。这是可测试性驱动出来的字段。
//
//   ⚠ 注意这里**没有** taskBudgetRemaining（见行 282 的注释）。

// ═══════════════════════════════════════════════════════════════
// ── 8. query()：薄壳，只做一件事 ──
//
// 返回类型值得细看：
//     AsyncGenerator<产出类型, 返回类型, 接收类型>
//                   └ 6 种消息  └ Terminal
// 也就是说这个函数一边「吐消息」（yield），一边最后「返回一个终止原因」（return）。
// 这是 async generator 的双通道特性：yield 是流，return 是结果。
// ═══════════════════════════════════════════════════════════════
export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
// 注：`yield*` 是「委托」：把 queryLoop 吐出的每一条消息原样转吐出去。
//     这行是本文件最像「生成器套生成器」的地方 —— 外层 query 自己不产出
//     任何东西，全部转发给内层。那为什么还要套一层？
//
//     看行 231-238 的注释就明白了：为了在「正常返回之后」做一件事。
//     用 try/finally 也能做到，但语义不同：
//       · finally 在 throw 和 .return()（提前关闭）时也会执行
//       · 而这里只在 queryLoop **正常返回**时才执行
//     注释把这两种情况写清楚了：
//       throw  → 错误通过 yield* 往外传播，这行不执行
//       .return() → Return completion 关闭两个生成器，这行也不执行
//     所以这行代码精确对应「这一轮跑完了」这个语义 ——
//     「已启动但未完成」的信号，正是靠这个不对称性表达的。
  // Only reached if queryLoop returned normally. Skipped on throw (error
  // propagates through yield*) and on .return() (Return completion closes
  // both generators). This gives the same asymmetric started-without-completed
  // signal as print.ts's drainCommandQueue when the turn fails.
  for (const uuid of consumedCommandUuids) {
// 注：只对「真正被消费掉的」命令发 completed 通知。
//     consumedCommandUuids 是 queryLoop 里 push 进来的（行 1638），
//     只有变成了 attachment 送进对话的命令才算消费。
//     逻辑是：started（行 1639）在消费时立刻发，completed 在整轮成功后发。
//     如果中途抛错，客户端就只看到 started 没有 completed ——
//     这正是「这一轮失败了」的信号，不需要额外字段。
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}

// ═══════════════════════════════════════════════════════════════
// ── 9. queryLoop：真正的实现，1729 行里的 1490 行 ──
// 返回类型和 query() 完全一样，因为 query() 就是转发它。
// ═══════════════════════════════════════════════════════════════
async function* queryLoop(
  params: QueryParams,
  consumedCommandUuids: string[],
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
> {
// ═══════════════════════════════════════════════════════════════
// ── 10. 初始化：不可变参数 vs 可变状态的分界线 ──
// 行 252-263 解构出来的是**永不重新赋值**的；行 268 开始的 state 才是可变的。
// 这条分界线很重要：读代码时看到裸名 `messages` 就是本轮快照，
// 看到 `state.messages` 就是完整状态。混用会导致读到过期的值。
// ═══════════════════════════════════════════════════════════════
  // Immutable params — never reassigned during the query loop.
  const {
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    fallbackModel,
    querySource,
    maxTurns,
    skipCacheWrite,
  } = params
  const deps = params.deps ?? productionDeps()
// 注：依赖注入。`params.deps ?? productionDeps()` ——
//     测试可以传一套假 deps（假的大模型、假压缩），完全不走网络。
//     这是一种比 mock 模块更干净的测试方式（不需要 jest.mock 拦截 import）。
//     本文件里所有外部能力都走 deps：callModel、microcompact、autocompact、uuid。
//     ⚠ 但也有漏网的 —— 行 570 的 `toolUseContext.getAppState()`、
//     行 588 的 createDumpPromptsFetch、行 1001 的 executePostSamplingHooks
//     都是直接调用。说明这套 DI 是**逐步引入**的，不是一次性重构完成。

  // Mutable cross-iteration state. The loop body destructures this at the top
  // of each iteration so reads stay bare-name (`messages`, `toolUseContext`).
  // Continue sites write `state = { ... }` instead of 9 separate assignments.
// 译：跨轮可变状态。循环体每轮开头解构它，这样读取时能保持裸名
//     （`messages`、`toolUseContext`）。各个 continue 站点写
//     `state = { ... }`，而不是 9 次独立赋值。
//
// 注：「9 次独立赋值」的问题不只是啰嗦 —— 是**漏字段**。
//     如果某个 continue 站点忘了重置 maxOutputTokensRecoveryCount，
//     那条路径就会带着上一轮的计数继续跑，重试次数被悄悄消耗掉。
//     整体重建则强制你在每个站点显式写全 9 个字段（TypeScript 会检查），
//     漏一个就编译不过。这是用类型系统防错，而不是靠自觉。
  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    maxOutputTokensOverride: params.maxOutputTokensOverride,
    autoCompactTracking: undefined,
    stopHookActive: undefined,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
    pendingToolUseSummary: undefined,
    transition: undefined,
  }
  const budgetTracker = feature('TOKEN_BUDGET') ? createBudgetTracker() : null
// 注：只有开了 TOKEN_BUDGET 才创建 tracker。
//     `budgetTracker!` 在行 1310 用了非空断言 —— 因为那里已经
//     被 `feature('TOKEN_BUDGET')` 包住，编译器推不出来，只能人工保证。
//     这是 DCE 模式常见的代价：feature 常量折叠后 TypeScript
//     不再知道 null 检查关系，只能到处 `!`。

// ═══════════════════════════════════════════════════════════════
// ── 11. 一个刻意不放进 State 的变量，及其原因 ──
// 这段注释是本文件里最能体现「重构成本如何影响设计」的地方。
// ═══════════════════════════════════════════════════════════════
  // task_budget.remaining tracking across compaction boundaries. Undefined
  // until first compact fires — while context is uncompacted the server can
  // see the full history and handles the countdown from {total} itself (see
  // api/api/sampling/prompt/renderer.py:292). After a compact, the server sees
  // only the summary and would under-count spend; remaining tells it the
  // pre-compact final window that got summarized away. Cumulative across
  // multiple compacts: each subtracts the final context at that compact's
  // trigger point. Loop-local (not on State) to avoid touching the 7 continue
  // sites.
// 译：task_budget.remaining 跨压缩边界的跟踪。首次压缩前是 undefined ——
//     上下文未压缩时服务端能看到完整历史，它自己从 {total} 倒计时
//     （见 api/api/sampling/prompt/renderer.py:292）。压缩之后，服务端
//     只看到摘要，会少算已花额度；remaining 就是告诉它「压缩前那个
//     最终窗口有多少被摘要掉了」。跨多次压缩累积：每次减去该次压缩
//     触发点上的最终上下文。**循环局部变量（不放在 State 上），
//     以避免碰那 7 个 continue 站点。**
//
// 注：最后半句是全文最诚实的一句工程说明，值得单独讲。
//
//     【理想的写法】
//     这个值本质上就是跨轮状态，理应在 State 里（和 maxOutputTokens-
//     RecoveryCount 一样）。放进 State 后，每个 continue 站点都要
//     多写一行 `taskBudgetRemaining,`。
//
//     【现实的选择】
//     作者选了「局部变量」。为什么？因为 State 是整体重建的，
//     加一个字段意味着**改 7 处**，每处都要想「这个站点该传什么值」。
//     而 taskBudgetRemaining 语义上在所有站点都一样（原样传下去），
//     所以放局部变量反而更省事、更不容易错。
//
//     【代价】
//     1. 语义不一致：其他跨轮状态在 State，这个不在。读代码的人会困惑。
//     2. 注释必须解释为什么 —— 于是有了这么长一段注释。
//     这是一笔「用注释换重构」的交易，而且是一笔划算的交易：
//     改 7 处 continue 站点的风险，远大于多写一段注释的成本。
//
//     【另一个细节】
//     注释里引用了 `api/api/sampling/prompt/renderer.py:292` ——
//     一个 Python 文件，双 `api/api` 路径，说明这是服务端仓库的路径。
//     客户端代码注释引用服务端实现，是跨仓库协作留下的痕迹。
  let taskBudgetRemaining: number | undefined = undefined

  // Snapshot immutable env/statsig/session state once at entry. See QueryConfig
// 注：`buildQueryConfig()` 是一次性快照。行 293-295 的注释说得很清楚：
//     「在入口处快照不可变的 env/statsig/session 状态」。
//
//     为什么必须快照？因为主循环一轮可能跑几十秒（模型流式输出 + 工具执行）。
//     如果每轮都去读环境变量/特性开关，会出现「同一轮里前后读到不同值」——
//     比如 stream 开始时 gate 是 true，工具执行时变成 false，
//     逻辑就分叉了。快照把这个不确定性锁在入口处。
//
//     行 294 还有一句关键的："why feature() gates are intentionally excluded"
//     —— feature() **不**进 config，因为它是编译期常量，运行时不会变，
//     放进去只会让 config 多一堆恒定字段。这又是 DCE 思路的延伸：
//     编译期能定的，不要留到运行期。
  // for what's included and why feature() gates are intentionally excluded.
  const config = buildQueryConfig()

  // Fired once per user turn — the prompt is invariant across loop iterations,
  // so per-iteration firing would ask sideQuery the same question N times.
  // Consume point polls settledAt (never blocks). `using` disposes on all
  // generator exit paths — see MemoryPrefetch for dispose/telemetry semantics.
// ═══════════════════════════════════════════════════════════════
// ── 12. `using` 声明：全文件最冷门的一行语法 ──
// 这是 TC39 Explicit Resource Management（显式资源管理）提案的语法，
// TypeScript 5.2+ 支持。它等价于「自动 try/finally dispose」，但更精确。
// ═══════════════════════════════════════════════════════════════
  using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
    state.messages,
    state.toolUseContext,
// 译：每个用户轮次只触发一次 —— 提示词在各轮迭代间是不变的，
//     所以每轮都触发等于拿同一个问题问 sideQuery N 次。
//     消费点在轮询 settledAt（绝不阻塞）。`using` 会在所有生成器
//     退出路径上 dispose —— 见 MemoryPrefetch 的 dispose/遥测语义。
//
// 注：这行值得单独讲，因为它是本文件唯一一处 `using`。
//
//     【普通写法的问题】
//     后台预取（startRelevantMemoryPrefetch）会启动一个 Promise 去查记忆。
//     如果主循环提前 return（中断、出错、达到 maxTurns），这个 Promise
//     还挂着，需要清理（取消请求、记遥测）。用 try/finally 包住整个
//     1500 行的 while 循环显然不现实。
//
//     【using 的解法】
//     `using x = expr` 会在**离开作用域的任何路径**上调用 x[Symbol.dispose]()：
//     return、throw、break、generator 的 .return()。也就是「所有退出路径」。
//     对生成器尤其重要：生成器有 4 种关闭方式（自然结束、throw、
//     .return()、.throw()），手写 finally 很容易漏。
//
//     【为什么注释强调 "all generator exit paths"】
//     因为这是这个语法相对 try/finally 的唯一实质优势 ——
//     不是「少写几行」，而是「不可能漏」。
//
//     【一个副作用】
//     必须 target 到 ES2022+ 且 lib 里有 Symbol.dispose 才能编译。
//     所以在使用较老 TS 配置的项目里抄这行会报错。
  )

  // eslint-disable-next-line no-constant-condition
// 注：`while (true)` 加 eslint-disable —— 加 disable 是因为
//     no-constant-condition 规则会警告「条件恒真」。这个警告在
//     一般代码里是对的，但这里就是刻意的（状态机主循环）。
//     这个循环唯一的出口是 return，全文共 11 个 return 站点，
//     每个都带一个 reason 标签：
//       blocking_limit / image_error / model_error / aborted_streaming /
//       prompt_too_long / stop_hook_prevented / completed / aborted_tools /
//       hook_stopped / max_turns / stop_hook_prevented
//     这些标签是 Terminal 联合类型的成员，测试直接断言它们。
  while (true) {
    // Destructure state at the top of each iteration. toolUseContext alone
// 注：解构分成两步，是个很细但重要的区别：
//       let { toolUseContext } = state        ← let，因为本轮内会被重新赋值
//       const { messages, ... } = state       ← const，本轮内只读
//     行 308-310 的注释解释了为什么 toolUseContext 特殊：
//     本轮内 queryTracking 要更新、messages 要更新，都是重建整个对象。
//     注意这里的 messages 是**上一轮结束时的** messages，
//     而本轮真正要发出去的是稍后算出的 messagesForQuery（行 365）——
//     两者不同！这是读这段代码最容易搞错的地方之一。
    // is reassigned within an iteration (queryTracking, messages updates);
    // the rest are read-only between continue sites.
    let { toolUseContext } = state
    const {
      messages,
      autoCompactTracking,
      maxOutputTokensRecoveryCount,
      hasAttemptedReactiveCompact,
      maxOutputTokensOverride,
      pendingToolUseSummary,
      stopHookActive,
      turnCount,
    } = state

// ── 13. 技能发现预取：躲在模型流式输出时间里的第二次后台任务 ──
    // Skill discovery prefetch — per-iteration (uses findWritePivot guard
    // that returns early on non-write iterations). Discovery runs while the
    // model streams and tools execute; awaited post-tools alongside the
    // memory prefetch consume. Replaces the blocking assistant_turn path
    // that ran inside getAttachmentMessages (97% of those calls found
    // nothing in prod). Turn-0 user-input discovery still blocks in
    // userInputAttachments — that's the one signal where there's no prior
    // work to hide under.
    const pendingSkillPrefetch = skillPrefetch?.startSkillDiscoveryPrefetch(
      null,
      messages,
      toolUseContext,
    )
// 注：这段注释讲了一个「从阻塞改成预取」的优化，数字很具体：
//     「替换了 getAttachmentMessages 内部那条阻塞的 assistant_turn 路径
//       （生产环境里那些调用有 97% 什么都没找到）」
//
//     也就是说：原来每轮都**同步等**一次技能搜索，而 97% 的情况是白等。
//     改成预取后，搜索和模型流式输出并行跑，轮末再取结果。
//     这是典型的「把 IO 藏进已有的等待里」。
//
//     但注意最后一句的例外：「Turn-0 用户输入发现仍然在
//     userInputAttachments 里阻塞 —— 那是唯一没有先前工作可以遮蔽的信号」。
//     第一轮没有「正在进行的流式输出」可以藏，所以只能老实阻塞。
//     这个例外说明作者想过「能不能全异步」，答案是第一轮不行。

    yield { type: 'stream_request_start' }
// 注：`stream_request_start` 是**每轮迭代开头**都会 yield 的第一条消息。
//     它没有内容，作用是给 UI 一个信号：「新的一轮开始了，清掉上一轮的
//     进度指示」。想想一个跑了 20 轮的任务，如果没有这个信号，
//     UI 无法区分「还在同一轮」和「已经进入下一轮」。
//
//     类型上它属于 RequestStartEvent，和 Message、StreamEvent 并列 ——
//     在 API 返回任何东西之前就先发出去。

    queryCheckpoint('query_fn_entry')

    // Record query start for headless latency tracking (skip for subagents)
    if (!toolUseContext.agentId) {
      headlessProfilerCheckpoint('query_started')
    }

// ── 14. queryTracking：一条"调用链"的身份 ──
    // Initialize or increment query chain tracking
    const queryTracking = toolUseContext.queryTracking
      ? {
          chainId: toolUseContext.queryTracking.chainId,
          depth: toolUseContext.queryTracking.depth + 1,
        }
      : {
          chainId: deps.uuid(),
          depth: 0,
        }

    const queryChainIdForAnalytics =
      queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

    toolUseContext = {
      ...toolUseContext,
      queryTracking,
    }
// 注：chainId + depth 这两个字段在做一件事：**还原调用栈**。
//     depth 0 是主线程，子代理 depth 1，子代理的子代理 depth 2……
//     同一棵树的调用共享 chainId。
//
//     为什么主循环需要这个？因为所有遥测事件都带 (queryChainId, queryDepth)。
//     想象一次用户请求触发了 5 个子代理、每个又跑 10 轮，
//     产生几十条事件。没有 chainId 就无法把它们归到同一次用户请求下；
//     没有 depth 就无法知道谁是谁的孩子。
//
//     注意 chainId 的生成：有 queryTracking 就继承父的，没有就新建一个 uuid。
//     也就是「第一个进入 query() 的人定 chainId」。
//
//     行 357 那个 `as AnalyticsMetadata_I_VERIFIED_...` 类型断言值得单独说：
//     它是一个**故意起得很长的类型名**，作用是在写埋点时逼你确认
//     「我传的这个值不是代码内容、也不是文件路径」。
//     类型系统在这里被当成 code review 的强制执行手段 ——
//     你没法随手把 error.message 塞进去，必须显式写一个长断言，
//     而写的时候你会想一下。

    let messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]
// 注：`getMessagesAfterCompactBoundary` —— 从最近的压缩边界之后开始取。
//     压缩后历史里会留一条边界标记消息，之前的内容已被摘要取代。
//     如果不过滤，「摘要 + 原文」会重复发给模型，白花 token。
//
//     注意 `[...]` 浅拷贝：后面 snip/microcompact/collapse 都是
//     「返回新数组」而不是原地改，所以必须从一个可安全替换的数组开始。
//     整条压缩管线（下面 5 层）都是这个模式：
//         messagesForQuery = 某层(messagesForQuery)
//     纯函数式替换，不修改入参。

    let tracking = autoCompactTracking

// ═══════════════════════════════════════════════════════════════
// ── 15. 五层上下文管理管线（这是本文件最需要整体理解的部分） ──
//
// 顺序：applyToolResultBudget → snip → microcompact → contextCollapse → autocompact
//
// 为什么要排这个顺序？**从便宜到昂贵、从局部到全局**：
//   ① applyToolResultBudget  只截断超长工具结果（改内容，不改结构）
//   ② snip                   删掉整段历史（最粗暴也最快）
//   ③ microcompact           按 tool_use_id 删除旧结果（不改内容）
//   ④ contextCollapse        把历史折叠成投影视图（保留可回滚）
//   ⑤ autocompact            整体摘要（最贵，会调一次模型）
//
// 前四层都不调模型，第五层要调。所以前面四层能解决问题就绝不进第五层 ——
// 行 428-431 的注释就是这个意思：「如果折叠已经让我们低于 autocompact
// 阈值，autocompact 就是空操作，这样能保住细粒度上下文，而不是一个摘要」。
// ═══════════════════════════════════════════════════════════════
    // Enforce per-message budget on aggregate tool result size. Runs BEFORE
    // microcompact — cached MC operates purely by tool_use_id (never inspects
    // content), so content replacement is invisible to it and the two compose
    // cleanly. No-ops when contentReplacementState is undefined (feature off).
    // Persist only for querySources that read records back on resume: agentId
    // routes to sidechain file (AgentTool resume) or session file (/resume).
    // Ephemeral runForkedAgent callers (agent_summary etc.) don't persist.
// 注：`persistReplacements` 决定「替换记录要不要落盘」：
//        agent:*         → 落到 sidechain 文件（AgentTool resume 用）
//        repl_main_thread → 落到 session 文件（/resume 用）
//        其他（如 agent_summary 这种一次性的 fork）→ 不落盘
//
//     为什么要区分？因为落盘有成本（IO），而只有「之后可能被恢复」的
//     会话才需要记录。一次性的摘要代理跑完就丢，记了也没人读。
//
//     行 383-388 那个回调写法值得注意：
//         persistReplacements ? records => void recordContentReplacement(...).catch(logError) : undefined
//     两个细节：
//       · `void` 前缀表示「故意不 await」——这是 fire-and-forget
//       · `.catch(logError)` 必须有，否则未捕获的 Promise rejection
//         在某些 Node 版本会直接 crash 进程
//     把一个异步副作用塞进同步回调里，就是这种形状。
    const persistReplacements =
      querySource.startsWith('agent:') ||
      querySource.startsWith('repl_main_thread')
    messagesForQuery = await applyToolResultBudget(
      messagesForQuery,
      toolUseContext.contentReplacementState,
      persistReplacements
        ? records =>
            void recordContentReplacement(
              records,
              toolUseContext.agentId,
            ).catch(logError)
        : undefined,
      new Set(
        toolUseContext.options.tools
          .filter(t => !Number.isFinite(t.maxResultSizeChars))
          .map(t => t.name),
      ),
    )

// ═══════════════════════════════════════════════════════════════
// ── 15.1 第②层：snip（剪历史）──
// snip 和 microcompact 都可能在同一次迭代里跑，注释明确说「不是互斥的」。
// ═══════════════════════════════════════════════════════════════
    // Apply snip before microcompact (both may run — they are not mutually exclusive).
    // snipTokensFreed is plumbed to autocompact so its threshold check reflects
    // what snip removed; tokenCountWithEstimation alone can't see it (reads usage
    // from the protected-tail assistant, which survives snip unchanged).
    let snipTokensFreed = 0
    if (feature('HISTORY_SNIP')) {
      queryCheckpoint('query_snip_start')
      const snipResult = snipModule!.snipCompactIfNeeded(messagesForQuery)
      messagesForQuery = snipResult.messages
      snipTokensFreed = snipResult.tokensFreed
      if (snipResult.boundaryMessage) {
        yield snipResult.boundaryMessage
      }
      queryCheckpoint('query_snip_end')
    }
// 注：`snipTokensFreed` 这个变量存在的唯一理由是**给下游提供准确的计数**。
//     注释解释得很清楚：tokenCountWithEstimation 读的是受保护的尾部
//     assistant 消息里的 usage，而那条消息在 snip 后原样保留 ——
//     所以它看不到 snip 释放的 token。必须手动把这个数传下去。
//
//     这引出一个普遍问题：**多条压缩路径之间要互相告知「我释放了多少」**。
//     本文件里这个数字的传递链是：
//         snipTokensFreed → autocompact 的阈值判断（行 466）
//                        → 阻塞检查的减法（行 638）
//     两条链都漏了就会误判 —— 要么白白压缩，要么错误地报 prompt too long。
//
//     这也是「五层管线」的实际复杂度来源：不是每一层难，是层间的
//     记账要一致。

// ── 15.2 第③层：microcompact（按 id 删旧结果）──
    // Apply microcompact before autocompact
    queryCheckpoint('query_microcompact_start')
    const microcompactResult = await deps.microcompact(
      messagesForQuery,
      toolUseContext,
      querySource,
    )
    messagesForQuery = microcompactResult.messages
    // For cached microcompact (cache editing), defer boundary message until after
    // the API response so we can use actual cache_deleted_input_tokens.
    // Gated behind feature() so the string is eliminated from external builds.
    const pendingCacheEdits = feature('CACHED_MICROCOMPACT')
      ? microcompactResult.compactionInfo?.pendingCacheEdits
      : undefined
    queryCheckpoint('query_microcompact_end')
// 注：`pendingCacheEdits` 是「延迟发边界消息」的机制，行 420-422 的注释：
//     「对带缓存的微压缩（cache editing），边界消息延迟到 API 响应之后，
//       这样能用到真实的 cache_deleted_input_tokens」。
//
//     为什么要用真实值？因为微压缩删了多少 token，客户端只能**估算**。
//     估多了会让用户以为省了很多，估少了会让压缩看起来没用。
//     而 API 会在响应里报 cache_deleted_input_tokens —— 真实数字。
//     所以策略是：先压缩，先发请求，等响应回来再发「删了多少」的通知。
//     具体实现见行 870-892。
//
//     最后一句「整段被 feature() 包住，好让字符串从外部构建里被消除」
//     又是 DCE 的痕迹：连 `'CACHED_MICROCOMPACT'` 这个字符串常量
//     都要保证不进外部 bundle。

// ── 15.3 第④层：contextCollapse（折叠成投影视图）──
    // Project the collapsed context view and maybe commit more collapses.
    // Runs BEFORE autocompact so that if collapse gets us under the
    // autocompact threshold, autocompact is a no-op and we keep granular
    // context instead of a single summary.
    //
    // Nothing is yielded — the collapsed view is a read-time projection
    // over the REPL's full history. Summary messages live in the collapse
    // store, not the REPL array. This is what makes collapses persist
    // across turns: projectView() replays the commit log on every entry.
    // Within a turn, the view flows forward via state.messages at the
    // continue site (query.ts:1192), and the next projectView() no-ops
    // because the archived messages are already gone from its input.
    if (feature('CONTEXT_COLLAPSE') && contextCollapse) {
      const collapseResult = await contextCollapse.applyCollapsesIfNeeded(
        messagesForQuery,
        toolUseContext,
        querySource,
      )
      messagesForQuery = collapseResult.messages
    }
// 注：这一段是本文件里最难理解、也最值得理解的设计。逐句拆：
//
//     【Nothing is yielded】
//     折叠**不产生任何消息**。它是「读时投影」—— 每次进入主循环，
//     projectView() 把提交日志重放到完整历史上，得到一个折叠后的视图。
//     所以 UI 看到的历史和模型看到的不一样，而这是故意的。
//
//     【Summary messages live in the collapse store, not the REPL array】
//     摘要存在折叠存储里，不在 REPL 的消息数组里。这意味着
//     「折叠」是可逆的：原始消息还在，只是不参与投影。
//
//     【This is what makes collapses persist across turns】
//     行 436-439 是最关键的一句：折叠能跨轮持久，靠的是
//     projectView() 每次进来都重放提交日志。轮内通过 state.messages
//     往前走（在 continue 站点），下一轮 projectView() 就变成空操作
//     （因为归档的消息已经从输入里消失了）。
//
//     【和 autocompact 的关系】
//     它排在 autocompact **之前**，理由在行 428-431：
//     折叠便宜且保细粒度，如果能压到阈值以下，就不必做整体摘要。
//     这是个明确的优先级：**能不全量摘要就不全量摘要**。
//
//     一句话总结这一层：它不是「删除历史」，而是「改变历史被读到的样子」。

    const fullSystemPrompt = asSystemPrompt(
// 注：`asSystemPrompt(appendSystemContext(systemPrompt, systemContext))`
//     两层包装：
//       · appendSystemContext 把动态的 systemContext 拼到静态提示词后面
//       · asSystemPrompt 加一个 brand（品牌类型），让类型系统能区分
//         「已经拼好的系统提示词」和「裸字符串」
//     为什么要 brand？因为系统提示词有严格的拼装顺序要求（见 prompts.ts
//     里那个 boundary marker），用 brand 可以防止有人随手传一个字符串进来。
//
//     注意这个 fullSystemPrompt 只用于**发给 API**（行 661），
//     而 handleStopHooks、autocompact 收到的还是原始的 systemPrompt
//     （未拼 systemContext 的）。这是刻意的：内部逻辑不需要那层动态内容。
      appendSystemContext(systemPrompt, systemContext),
    )

// ── 15.4 第⑤层：autocompact（唯一会调模型的一层）──
    queryCheckpoint('query_autocompact_start')
    const { compactionResult, consecutiveFailures } = await deps.autocompact(
      messagesForQuery,
      toolUseContext,
      {
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        forkContextMessages: messagesForQuery,
      },
      querySource,
      tracking,
      snipTokensFreed,
    )
    queryCheckpoint('query_autocompact_end')
// 注：注意传给 autocompact 的参数里有个 `forkContextMessages: messagesForQuery`
//     —— 压缩本身是**起一个子代理**去做摘要（fork），这个子代理需要看到
//     完整对话才能写好摘要。
//
//     所以压缩不是「本地算法」，是一次真实的模型调用。这就解释了
//     为什么它排在最后、为什么有连续失败计数（行 536-543）、
//     为什么会有「压缩死亡螺旋」的担心（行 1168-1172）：
//     压缩要花钱、可能失败、失败后重试可能又失败。

// ── 16. autocompact 成功了：10 个埋点字段 + 一处额度补偿 ──
    if (compactionResult) {
      const {
        preCompactTokenCount,
        postCompactTokenCount,
        truePostCompactTokenCount,
        compactionUsage,
      } = compactionResult

      logEvent('tengu_auto_compact_succeeded', {
        originalMessageCount: messages.length,
        compactedMessageCount:
          compactionResult.summaryMessages.length +
          compactionResult.attachments.length +
          compactionResult.hookResults.length,
        preCompactTokenCount,
        postCompactTokenCount,
        truePostCompactTokenCount,
        compactionInputTokens: compactionUsage?.input_tokens,
        compactionOutputTokens: compactionUsage?.output_tokens,
        compactionCacheReadTokens:
          compactionUsage?.cache_read_input_tokens ?? 0,
        compactionCacheCreationTokens:
          compactionUsage?.cache_creation_input_tokens ?? 0,
        compactionTotalTokens: compactionUsage
          ? compactionUsage.input_tokens +
            (compactionUsage.cache_creation_input_tokens ?? 0) +
            (compactionUsage.cache_read_input_tokens ?? 0) +
            compactionUsage.output_tokens
          : 0,

        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })
// 注：`tengu_auto_compact_succeeded` 带了 11 个字段，其中 6 个是 token 账目：
//     preCompactTokenCount / postCompactTokenCount / truePostCompactTokenCount
//     / 输入 / 输出 / 缓存读 / 缓存写 / 总计
//
//     为什么要记这么细？因为压缩是这个系统里**最贵的单次操作** ——
//     它要把整个对话（可能 180K token）发一遍，再生成摘要。
//     如果不细记账，就无法回答「压缩到底花了多少钱、省了多少」。
//     `truePostCompactTokenCount` 和 `postCompactTokenCount` 并存，
//     说明一个是从 API 报的、一个是估算的，两个都要留着对比误差。

      // task_budget: capture pre-compact final context window before
// 注：这是 taskBudgetRemaining 的第一个补偿点（第二个在行 1135 的反应式压缩）。
//     逻辑：压缩前先量一下「当前上下文窗口有多少 token」，从剩余额度里减掉。
//     这样服务端下次收到 remaining 时，就知道「有这么多已经被摘要掉了」。
//
//     `iterations[-1] is the authoritative final window` —— 注释里提到的
//     iterations 是 API 响应里的字段（服务器端工具循环的迭代记录），
//     取最后一条才是最终窗口。这个细节说明客户端对 API 的响应结构
//     依赖得很深。
      // messagesForQuery is replaced with postCompactMessages below.
      // iterations[-1] is the authoritative final window (post server tool
      // loops); see #304930.
      if (params.taskBudget) {
        const preCompactContext =
          finalContextTokensFromLastResponse(messagesForQuery)
        taskBudgetRemaining = Math.max(
          0,
          (taskBudgetRemaining ?? params.taskBudget.total) - preCompactContext,
        )
      }

      // Reset on every compact so turnCounter/turnId reflect the MOST RECENT
// 注：`turnCounter: 0` 重置而不是递增 —— 注释说得很清楚：
//     「每次压缩都重置，好让 turnCounter/turnId 反映**最近一次**压缩」。
//     而 recompactionInfo 在调用前已经捕获了旧值，所以不会丢信息。
//
//     这个字段的用途是「压缩后已经过了几轮」，用于判断
//     「上次压缩后是不是很快就又满了」—— 如果 2 轮就又满了，
//     说明压缩效果不足或上下文增长过快。
      // compact. recompactionInfo (autoCompact.ts:190) already captured the
      // old values for turnsSincePreviousCompact/previousCompactTurnId before
      // the call, so this reset doesn't lose those.
      tracking = {
        compacted: true,
        turnId: deps.uuid(),
        turnCounter: 0,
        consecutiveFailures: 0,
      }

      const postCompactMessages = buildPostCompactMessages(compactionResult)
// 注：`buildPostCompactMessages` 生成的是「摘要 + 保留的尾部消息」。
//     然后这些消息被**逐条 yield 出去**（行 530-532）——
//     用户会在界面上看到「对话已被压缩」的提示。
//
//     注意这里是 yield 而不是替换后继续：UI 需要知道压缩发生了，
//     否则用户会看到历史突然变短却没有任何解释。
//     紧接着行 535 `messagesForQuery = postCompactMessages` ——
//     本地变量也换成压缩后的，所以本轮**剩下的部分**用的是新上下文。
//     一个动作同时更新了外部（UI）和内部（本轮输入）。

      for (const message of postCompactMessages) {
        yield message
      }

      // Continue on with the current query call using the post compact messages
      messagesForQuery = postCompactMessages
    } else if (consecutiveFailures !== undefined) {
      // Autocompact failed — propagate failure count so the circuit breaker
      // can stop retrying on the next iteration.
      tracking = {
        ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
        consecutiveFailures,
      }
    }

    //TODO: no need to set toolUseContext.messages during set-up since it is updated here
// 注：`//TODO: no need to set toolUseContext.messages during set-up since it is updated here`
//     —— 作者自己留的 TODO，说的是一个顺序问题：
//     toolUseContext.messages 在初始化时就被设过一次（在调用 query() 之前，
//     别的地方做的），而这里才是真正该同步的位置。
//     结果是「设置两次，前一次没用」，属于历史遗留的冗余。
    toolUseContext = {
      ...toolUseContext,
      messages: messagesForQuery,
    }

// ── 17. 本轮产出容器：四个"待填"的数组 ──
    const assistantMessages: AssistantMessage[] = []
    const toolResults: (UserMessage | AttachmentMessage)[] = []
    // @see https://docs.claude.com/en/docs/build-with-claude/tool-use
    // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly.
    // Set during streaming whenever a tool_use block arrives — the sole
    // loop-exit signal. If false after streaming, we're done (modulo stop-hook retry).
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false
// 注：这四个变量是本轮的输出缓冲，各有精确职责：
//
//     assistantMessages  → 模型本轮说的所有消息（含 thinking）
//                          **注意：即使被 withheld 也会 push 进来**（行 827）
//     toolResults        → 工具结果 + attachment（都是 user 角色）
//     toolUseBlocks      → 从 assistantMessages 里抽出来的 tool_use 块
//                          单独存一份，因为下面执行工具要用它
//     needsFollowUp      → **唯一的循环出口判断**
//
//     行 553-556 那段注释是重点：
//     「stop_reason === 'tool_use' 不可靠 —— 它不总是被正确设置。
//       改在流式过程中，每逢 tool_use 块到达就置位 —— 这是唯一的出口信号。」
//
//     这是一个从实践中得来的结论：不要相信 API 的 stop_reason 字段，
//     要自己数有没有 tool_use。如果信了 stop_reason，会出现
//     「模型发了工具但 stop_reason 没标 tool_use」→ 主循环以为结束 →
//     工具永远不执行 → 用户看到模型说「我来读一下文件」然后停住。
//     这类 bug 极难排查，所以作者宁可自己维护一个布尔量。

    queryCheckpoint('query_setup_start')
// ═══════════════════════════════════════════════════════════════
// ── 18. 两种工具执行模式：流式 vs 批式 ──
//
// 流式（streamingToolExecution）：模型还在吐 token 时，只要某个
//   tool_use 块完整了，就立刻开始执行。用户感知到的延迟大幅降低。
// 批式（默认）：等模型全部说完，再一次性执行所有工具。
//
// 这个 if 决定了后面所有 `if (streamingToolExecutor)` 分支的走法。
// 两种模式的行为必须严格等价（同样的工具、同样的结果、同样的顺序约束），
// 所以文件里到处是「两条分支各写一遍」的代码 —— 这是双模式并存的代价。
// ═══════════════════════════════════════════════════════════════
    const useStreamingToolExecution = config.gates.streamingToolExecution
    let streamingToolExecutor = useStreamingToolExecution
      ? new StreamingToolExecutor(
          toolUseContext.options.tools,
          canUseTool,
          toolUseContext,
        )
      : null

// ── 18.1 选模型：一个容易被忽略的运行时决策 ──
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode
    let currentModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel: toolUseContext.options.mainLoopModel,
      exceeds200kTokens:
        permissionMode === 'plan' &&
        doesMostRecentAssistantMessageExceed200k(messagesForQuery),
    })
// 注：`getRuntimeMainLoopModel` 有三个参数，第三个很有意思：
//         exceeds200kTokens: permissionMode === 'plan' && doesMostRecentAssistantMessageExceed200k(...)
//     只有 **plan 模式** 且上一条 assistant 消息超过 200K 时才为 true。
//
//     为什么只对 plan 模式特殊？推测：plan 模式下模型在专注思考方案，
//     thinking 可能非常长，此时切到 1M 上下文模型能保住完整推理。
//     普通模式下超 200K 就该压缩了，换模型不解决问题。
//
//     注意 `??` 的短路：permissionMode !== 'plan' 时右边的函数根本不会被调用 ——
//     省掉一次遍历消息内容的开销，每轮都省。

    queryCheckpoint('query_setup_end')

// ── 18.2 一个用内存数字说话的优化 ──
    // Create fetch wrapper once per query session to avoid memory retention.
    // Each call to createDumpPromptsFetch creates a closure that captures the request body.
    // Creating it once means only the latest request body is retained (~700KB),
    // instead of all request bodies from the session (~500MB for long sessions).
    // Note: agentId is effectively constant during a query() call - it only changes
    // between queries (e.g., /clear command or session resume).
    const dumpPromptsFetch = config.gates.isAnt
      ? createDumpPromptsFetch(toolUseContext.agentId ?? config.sessionId)
      : undefined
// 译：每个 query 会话只创建一次 fetch 包装器，避免内存滞留。
//     每次调用 createDumpPromptsFetch 都会创建一个闭包来捕获请求体。
//     只创建一次意味着只保留最新的请求体（约 700KB），
//     而不是会话中所有请求体（长会话约 500MB）。
//     注意：agentId 在一次 query() 调用期间实际上是常量 ——
//     它只在 query 之间变化（比如 /clear 命令或会话恢复）。
//
// 注：这是本文件里唯一给出具体内存数字的注释，值得记住它的量级：
//     单次请求体 ~700KB，长会话累计 ~500MB。
//
//     700KB 是什么概念？一次请求包括：系统提示词（10K token）+ 完整对话历史
//     （可能 180K token）+ 工具定义。token 转字节大概 ×2~3，
//     所以 700KB 是合理的。
//
//     500MB 是什么概念？大约 700 次请求的累积。一个长会话跑 700 轮很正常
//     （每轮可能好几个工具调用）。如果每个请求体都被闭包持有，
//     进程内存会一路涨到 OOM。
//
//     这个 bug 的形态很典型：**闭包捕获 + 长生命周期对象 = 内存泄漏**。
//     修复方式是「让闭包只捕获一个可变的槽位，而不是每次新建闭包」。
//     注意这个优化只对内部版生效（config.gates.isAnt）——
//     因为 dumpPrompts 是内部排查工具，外部版没有这个 fetch 包装器。

// ═══════════════════════════════════════════════════════════════
// ── 19. 阻塞上限检查：一段 56 行的注释解释 6 个豁免条件 ──
// 这是全文注释/代码比最高的地方。代码只有 20 行，注释 56 行。
// 每一行注释都对应一个曾经踩过的坑。
// ═══════════════════════════════════════════════════════════════
    // Block if we've hit the hard blocking limit (only applies when auto-compact is OFF)
    // This reserves space so users can still run /compact manually
    // Skip this check if compaction just happened - the compaction result is already
    // validated to be under the threshold, and tokenCountWithEstimation would use
    // stale input_tokens from kept messages that reflect pre-compaction context size.
    // Same staleness applies to snip: subtract snipTokensFreed (otherwise we'd
    // falsely block in the window where snip brought us under autocompact threshold
    // but the stale usage is still above blocking limit — before this PR that
    // window never existed because autocompact always fired on the stale count).
    // Also skip for compact/session_memory queries — these are forked agents that
    // inherit the full conversation and would deadlock if blocked here (the compact
    // agent needs to run to REDUCE the token count).
    // Also skip when reactive compact is enabled and automatic compaction is
    // allowed — the preempt's synthetic error returns before the API call,
    // so reactive compact would never see a prompt-too-long to react to.
    // Widened to walrus so RC can act as fallback when proactive fails.
    //
    // Same skip for context-collapse: its recoverFromOverflow drains
    // staged collapses on a REAL API 413, then falls through to
    // reactiveCompact. A synthetic preempt here would return before the
    // API call and starve both recovery paths. The isAutoCompactEnabled()
    // conjunct preserves the user's explicit "no automatic anything"
    // config — if they set DISABLE_AUTO_COMPACT, they get the preempt.
// ── 19.1 collapseOwnsIt：把「谁负责处理溢出」显式化 ──
    let collapseOwnsIt = false
    if (feature('CONTEXT_COLLAPSE')) {
      collapseOwnsIt =
        (contextCollapse?.isContextCollapseEnabled() ?? false) &&
        isAutoCompactEnabled()
    }
// 注：这个名字起得很准 —— "collapse owns it"（折叠拥有这件事）。
//     意思是：如果 contextCollapse 开着、且自动压缩也开着，
//     那么溢出处理的责任归折叠，主循环不要抢。
//
//     行 609-614 的注释解释了抢了会怎样：
//     「如果这里做一个合成 preempt，会在 API 调用之前就 return，
//       两条恢复路径（折叠的 recoverFromOverflow、反应式压缩）都吃不到
//       真实的 413 错误」。
//
//     关键词是「合成」。这里想做的检查是**预测**溢出（本地估算 token 数），
//     而恢复机制需要的是**真实**的 413。预测了并提前 return，
//     就等于把真实信号掐掉了。
//
//     最后一句「The isAutoCompactEnabled() conjunct preserves the user's
//     explicit 'no automatic anything' config」是在说：
//     如果用户设了 DISABLE_AUTO_COMPACT，那还是要做 preempt ——
//     因为他明确说了「不要任何自动行为」，此时提前报错才是尊重用户。
// ── 19.2 mediaRecoveryEnabled 为什么要"每轮提前算一次" ──
    // Hoist media-recovery gate once per turn. Withholding (inside the
    // stream loop) and recovery (after) must agree; CACHED_MAY_BE_STALE can
    // flip during the 5-30s stream, and withhold-without-recover would eat
    // the message. PTL doesn't hoist because its withholding is ungated —
    // it predates the experiment and is already the control-arm baseline.
// 译：每轮把 media-recovery 的 gate 提前取一次。扣留（在流循环内）
//     和恢复（在流循环后）必须一致；CACHED_MAY_BE_STALE 可能在
//     5-30 秒的流式过程中翻转，而「扣留了却不恢复」会把消息吞掉。
//     PTL 不做这个提前取，因为它的扣留是无条件的 ——
//     它早于这个实验，已经是控制组的基线。
//
// 注：这段注释讲了一个非常隐蔽的 bug 形态：**同一个 gate 读两次，两次值不同**。
//
//     时间线：
//       T0  循环开始，读 gate → true（开启扣留）
//       T1  流式输出 5-30 秒，期间 GrowthBook 推送新配置
//       T2  流结束后，再读 gate → false（不执行恢复）
//       结果：错误消息被扣住没发，也没恢复 → 消息凭空消失
//
//     修复：T0 读一次，存进变量，T2 用同一个变量。
//     这就是「快照」的思路，和行 293 的 buildQueryConfig 是同一招。
//
//     后半句提到 PTL（prompt-too-long）不需要这么做，因为它「扣留是无条件的」——
//     也就是 PTL 的扣留不依赖任何 gate，所以不存在不一致问题。
//     这是一个很好的对比：**有条件的行为需要快照，无条件的不需要。**
    const mediaRecoveryEnabled =
      reactiveCompact?.isReactiveCompactEnabled() ?? false
    if (
// 注：五个条件全是「不要做阻塞检查」的豁免，逐一对应一个具体场景：
//
//   ① !compactionResult
//      刚压缩过。压缩结果已验证在阈值以下，而 tokenCountWithEstimation
//      会用残留消息里的**过期** input_tokens，反映的是压缩前的上下文大小。
//      → 不豁免就会「明明刚压完，却报太长」。
//
//   ② querySource !== 'compact'
//     自己就是压缩代理。它在满上下文的会话上运行，如果被拦住，
//      就永远跑不起来 —— 而它正是用来**降低** token 数的。死锁。
//
//   ③ querySource !== 'session_memory'
//      同上，会话记忆代理也是 fork 出来的，继承完整对话。
//
//   ④ !(reactiveCompact 开 && autoCompact 开)
//      反应式压缩开着时，它的**合成错误**会在 API 调用之前返回，
//      所以它永远看不到真实的 prompt-too-long，也就永远不触发。
//      → 必须让真实请求发出去，让 API 自己回 413。
//
//   ⑤ !collapseOwnsIt
//      同上，折叠也要真实 413 才能 drain。
//
//     这五条合起来说明一件事：**「提前拦截」和「事后恢复」是互斥的**。
//     你越早拦，恢复机制越拿不到真实信号。所以只在「没有任何恢复机制」
//     的情况下才提前拦 —— 那时候提前拦是在保护用户（至少给个明确错误，
//     而不是等 API 报一个更晦涩的错）。
      !compactionResult &&
      querySource !== 'compact' &&
      querySource !== 'session_memory' &&
      !(
        reactiveCompact?.isReactiveCompactEnabled() && isAutoCompactEnabled()
      ) &&
      !collapseOwnsIt
    ) {
      const { isAtBlockingLimit } = calculateTokenWarningState(
        tokenCountWithEstimation(messagesForQuery) - snipTokensFreed,
// 注：`tokenCountWithEstimation(messagesForQuery) - snipTokensFreed`
//     —— 那个减法就是行 396 注释埋下的伏笔。
//
//     如果不减：snip 刚把上下文剪到阈值以下，但 tokenCountWithEstimation
//     读的是「受保护的尾部 assistant 消息的 usage」，那是 snip **之前**的数 ——
//     于是误判为超限，报 prompt too long。
//     注释里说得很精确：「在本次 PR 之前，这个窗口根本不存在，
//     因为 autocompact 总是基于过期计数触发」。
//
//     也就是：一个修好的 bug（snip 生效了）暴露了另一个潜在 bug（计数过期）。
//     这类「修复 A 暴露 B」的情况在多路径系统里非常常见。
        toolUseContext.options.mainLoopModel,
      )
      if (isAtBlockingLimit) {
        yield createAssistantAPIErrorMessage({
          content: PROMPT_TOO_LONG_ERROR_MESSAGE,
          error: 'invalid_request',
        })
        return { reason: 'blocking_limit' }
      }
    }

    let attemptWithFallback = true
// 注：`attemptWithFallback` 是**内层** while 的开关，和外层 while(true)
//     是两个不同的循环：
//
//         while (true) {                    ← 外层：一轮对话
//           ...
//           while (attemptWithFallback) {    ← 内层：同一次请求的重试
//             attemptWithFallback = false
//             try { ...流式... } catch (FallbackTriggeredError) {
//               attemptWithFallback = true  ← 回到内层开头，用 fallbackModel 重发
//               continue
//             }
//           }
//           ...
//         }
//
//     内层最多跑两次（第一次原模型，第二次 fallback 模型），
//     因为进入 catch 后会 `toolUseContext.options.mainLoopModel = fallbackModel`（行 922），
//     如果 fallback 模型也触发 FallbackTriggeredError……实际上会无限循环，
//     但那种情况不该发生（fallback 模型没有更下一级的 fallback）。
//     这是靠「不存在三级 fallback」这个前提保证的，没有显式计数器。

    queryCheckpoint('query_api_loop_start')
    try {
      while (attemptWithFallback) {
        attemptWithFallback = false
        try {
          let streamingFallbackOccured = false
// 注：`streamingFallbackOccured` 是个**回调标志位**，不是异常。
//     它由 `deps.callModel` 的 `onStreamingFallback` 回调置位（行 678-680）。
//
//     为什么用回调而不是抛异常？因为流已经开始了 —— 可能已经 yield 了
//     好几条消息。抛异常会丢掉「已经产出过东西」这个事实，
//     而这些半成品必须被显式清理（发 tombstone）。
//     所以协议是：继续正常流式返回（用新模型的输出），
//     同时告诉调用方「前面那些作废」。
//
//     这就引出了行 712-741 那段清理逻辑 —— 那是本文件最精细的一段。
          queryCheckpoint('query_api_streaming_start')
          for await (const message of deps.callModel({
            messages: prependUserContext(messagesForQuery, userContext),
            systemPrompt: fullSystemPrompt,
            thinkingConfig: toolUseContext.options.thinkingConfig,
            tools: toolUseContext.options.tools,
            signal: toolUseContext.abortController.signal,
            options: {
              async getToolPermissionContext() {
                const appState = toolUseContext.getAppState()
                return appState.toolPermissionContext
              },
              model: currentModel,
              ...(config.gates.fastModeEnabled && {
                fastMode: appState.fastMode,
              }),
              toolChoice: undefined,
              isNonInteractiveSession:
                toolUseContext.options.isNonInteractiveSession,
              fallbackModel,
              onStreamingFallback: () => {
                streamingFallbackOccured = true
              },
              querySource,
              agents: toolUseContext.options.agentDefinitions.activeAgents,
              allowedAgentTypes:
                toolUseContext.options.agentDefinitions.allowedAgentTypes,
              hasAppendSystemPrompt:
                !!toolUseContext.options.appendSystemPrompt,
              maxOutputTokensOverride,
              fetchOverride: dumpPromptsFetch,
              mcpTools: appState.mcp.tools,
              hasPendingMcpServers: appState.mcp.clients.some(
                c => c.type === 'pending',
              ),
              queryTracking,
              effortValue: appState.effortValue,
              advisorModel: appState.advisorModel,
              skipCacheWrite,
              agentId: toolUseContext.agentId,
              addNotification: toolUseContext.addNotification,
              ...(params.taskBudget && {
                taskBudget: {
                  total: params.taskBudget.total,
                  ...(taskBudgetRemaining !== undefined && {
                    remaining: taskBudgetRemaining,
                  }),
                },
              }),
            },
          })) {
// ═══════════════════════════════════════════════════════════════
// ── 20. 流式回退的清理：tombstone（墓碑）机制 ──
// 这段代码解决的是「已经吐出去半截消息，现在要作废」的问题。
// ═══════════════════════════════════════════════════════════════
            // We won't use the tool_calls from the first attempt
            // We could.. but then we'd have to merge assistant messages
            // with different ids and double up on full the tool_results
            if (streamingFallbackOccured) {
              // Yield tombstones for orphaned messages so they're removed from UI and transcript.
              // These partial messages (especially thinking blocks) have invalid signatures
              // that would cause "thinking blocks cannot be modified" API errors.
              for (const msg of assistantMessages) {
                yield { type: 'tombstone' as const, message: msg }
              }
              logEvent('tengu_orphaned_messages_tombstoned', {
                orphanedMessageCount: assistantMessages.length,
                queryChainId: queryChainIdForAnalytics,
                queryDepth: queryTracking.depth,
              })

              assistantMessages.length = 0
              toolResults.length = 0
              toolUseBlocks.length = 0
              needsFollowUp = false

              // Discard pending results from the failed streaming attempt and create
              // a fresh executor. This prevents orphan tool_results (with old tool_use_ids)
              // from being yielded after the fallback response arrives.
              if (streamingToolExecutor) {
                streamingToolExecutor.discard()
                streamingToolExecutor = new StreamingToolExecutor(
                  toolUseContext.options.tools,
                  canUseTool,
                  toolUseContext,
                )
              }
            }
// 注：翻译一下这段注释的三个要点：
//
//   ① "We won't use the tool_calls from the first attempt"
//      不用第一次尝试的工具调用。因为它们的 id 已经发出去过了，
//      再发一次会出现「同一个 tool_use_id 两份 tool_result」。
//
//   ② "Yield tombstones for orphaned messages so they're removed from UI
//      and transcript"
//      给孤儿消息发墓碑。墓碑是一条特殊消息，告诉 UI「这条请删掉」。
//      为什么要删？因为它们在界面上已经显示出来了（用户看到半句话），
//      现在要撤回。
//
//   ③ 最关键的："These partial messages (especially thinking blocks) have
//      invalid signatures that would cause 'thinking blocks cannot be
//      modified' API errors."
//      这些半成品消息**尤其是 thinking 块**，签名是无效的。
//      如果留在历史里，下次发请求会 400。
//
//      这直接呼应了行 151 那个「巫师咒语」里的第三条铁律：
//      thinking 块必须在整条 trajectory 内保留 —— 但反过来，
//      一旦这条 trajectory 作废，thinking 块也必须一起作废。
//      签名是和「这次具体请求」绑定的，不能跨请求复用。
//
//   清理动作有四个，必须全都做：
//      assistantMessages.length = 0    ← 清空已收的 assistant 消息
//      toolResults.length = 0          ← 清空已收的工具结果
//      toolUseBlocks.length = 0        ← 清空待执行的工具
//      needsFollowUp = false           ← 重置出口信号
//      streamingToolExecutor.discard() ← 丢弃执行器（它的队列里可能有
//                                        基于旧 tool_use_id 的任务）
//   少做任何一个，都会留下「旧 id 的残留物」。
// ── 21. backfillObservableInput：一个关于"什么时候克隆"的精细判断 ──
            // Backfill tool_use inputs on a cloned message before yield so
            // SDK stream output and transcript serialization see legacy/derived
            // fields. The original `message` is left untouched for
            // assistantMessages.push below — it flows back to the API and
            // mutating it would break prompt caching (byte mismatch).
            let yieldMessage: typeof message = message
            if (message.type === 'assistant') {
              let clonedContent: typeof message.message.content | undefined
              for (let i = 0; i < message.message.content.length; i++) {
                const block = message.message.content[i]!
                if (
                  block.type === 'tool_use' &&
                  typeof block.input === 'object' &&
                  block.input !== null
                ) {
                  const tool = findToolByName(
                    toolUseContext.options.tools,
                    block.name,
                  )
                  if (tool?.backfillObservableInput) {
                    const originalInput = block.input as Record<string, unknown>
                    const inputCopy = { ...originalInput }
                    tool.backfillObservableInput(inputCopy)
                    // Only yield a clone when backfill ADDED fields; skip if
                    // it only OVERWROTE existing ones (e.g. file tools
                    // expanding file_path). Overwrites change the serialized
                    // transcript and break VCR fixture hashes on resume,
                    // while adding nothing the SDK stream needs — hooks get
                    // the expanded path via toolExecution.ts separately.
                    const addedFields = Object.keys(inputCopy).some(
                      k => !(k in originalInput),
                    )
                    if (addedFields) {
                      clonedContent ??= [...message.message.content]
                      clonedContent[i] = { ...block, input: inputCopy }
                    }
                  }
                }
              }
              if (clonedContent) {
                yieldMessage = {
                  ...message,
                  message: { ...message.message, content: clonedContent },
                }
              }
            }
// 注：这段是全文件最绕的一处，但它解决的是一个非常具体的问题。
//
//     【背景】
//     某些工具的 input 里有「派生字段」—— 模型只给了 file_path，
//     但工具需要 offset/limit（默认值）。工具通过
//     `backfillObservableInput(input)` 把这些补上。
//
//     【问题】
//     补了之后，要不要把这个补过的 input 发给外界（SDK 流 + transcript）？
//     如果不发，SDK 用户看到的是「只有 file_path」，跟实际执行不一致。
//
//     【关键洞察：只在「新增字段」时克隆，只在「覆盖已有字段」时不克隆】
//     行 765-770 的注释：
//       「只有 backfill **新增**字段时才 yield 克隆；如果只是**覆盖**
//         已有字段（比如文件工具展开 file_path），就跳过。
//         覆盖会改变序列化后的 transcript，破坏恢复时的 VCR fixture 哈希，
//         而 SDK 流并不需要它 —— hook 会通过 toolExecution.ts 单独拿到展开后的路径。」
//
//     三个约束在这里打架：
//       · SDK 用户需要看到真实 input（新增字段要给他们）
//       · VCR 测试需要 transcript 字节稳定（覆盖会让哈希变）
//       · hook 需要展开后的路径（但走另一条路给它）
//     解法就是「按字段增删类型分别处理」：新增 → 克隆并 yield，
//     覆盖 → 不克隆（保持原样，hook 另走通道）。
//
//     【为什么原 message 一定不能改】
//     行 744-746："The original `message` is left untouched ... it flows back
//     to the API and mutating it would break prompt caching (byte mismatch)."
//     这条最容易忽略：**发给 API 的历史必须字节不变**，否则 prompt cache
//     全部失效。所以这里的策略是「克隆一份给外面看，原件留给 API」。
//
//     这也解释了 `clonedContent ??= [...]` 那个延迟拷贝 ——
//     只有真的需要改才复制数组，否则连拷贝都省了。
// ═══════════════════════════════════════════════════════════════
// ── 22. withheld 的完整判断：四路独立扣留 ──
//
// 前面行 166 讲了「为什么要扣留」，这里看「什么时候扣留」。
// 四个来源，任意一个命中就扣住，互不依赖。
// ═══════════════════════════════════════════════════════════════
            // Withhold recoverable errors (prompt-too-long, max-output-tokens)
            // until we know whether recovery (collapse drain / reactive
            // compact / truncation retry) can succeed. Still pushed to
            // assistantMessages so the recovery checks below find them.
            // Either subsystem's withhold is sufficient — they're
            // independent so turning one off doesn't break the other's
            // recovery path.
            //
// ── 22.0 一条硬约束：feature() 只能出现在 if/三元里 ──
            // feature() only works in if/ternary conditions (bun:bundle
            // tree-shaking constraint), so the collapse check is nested
            // rather than composed.
// 译：feature() 只能用在 if/三元条件里（bun:bundle 的 tree-shaking 约束），
//     所以折叠检查是嵌套写而不是组合写。
//
// 注：这是本次分析里发现的、关于 DCE 机制的第二条硬约束
//     （第一条在 prompts.ts：USER_TYPE 必须内联不能提成变量）。
//
//     【为什么只能用 if/三元】
//     bun 的打包器需要把 `feature('X')` 替换成字面量 true/false，
//     然后做常量折叠。这个替换只发生在**条件位置**：
//         if (feature('X')) {...}              ✓ 能折叠
//         feature('X') ? a : b                 ✓ 能折叠
//         const x = feature('X')               ✗ 不保证
//         if (a && feature('X'))               ← 这里就危险了
//     `a && feature('X')` 里 feature 不是「整个条件」，而是子表达式 ——
//     折叠后变成 `a && false`，整个条件变成 false，理论上可折叠，
//     但打包器不一定会做这个推导（保守策略）。
//
//     【所以这段代码长这样】
//         let withheld = false                    ← 先给默认值
//         if (feature('CONTEXT_COLLAPSE')) {      ← 独立 if，保证能折叠
//           if (contextCollapse?.isWithheldPromptTooLong(...)) withheld = true
//         }
//         if (reactiveCompact?.isWithheldPromptTooLong(message)) withheld = true
//         ...
//     而不是：
//         const withheld = feature('X') && collapseWithheld(...) || reactiveWithheld(...)
//     后者更短更清晰，但在外部版里 feature 折叠成 false 后，
//     整个表达式变成 `false && ... `，打包器能不能删掉右边是不确定的。
//
//     【代价】
//     代码变得又长又啰嗦（一个布尔量用 4 个 if 赋值）。
//     这是「构建期优化污染源码可读性」的第三个例证（前两个：
//     USER_TYPE 内联、require 条件导入）。
            let withheld = false
            if (feature('CONTEXT_COLLAPSE')) {
              if (
                contextCollapse?.isWithheldPromptTooLong(
                  message,
                  isPromptTooLongMessage,
                  querySource,
                )
              ) {
                withheld = true
              }
            }
            if (reactiveCompact?.isWithheldPromptTooLong(message)) {
              withheld = true
            }
            if (
              mediaRecoveryEnabled &&
              reactiveCompact?.isWithheldMediaSizeError(message)
            ) {
              withheld = true
            }
            if (isWithheldMaxOutputTokens(message)) {
              withheld = true
            }
            if (!withheld) {
// 注：`if (!withheld) yield yieldMessage` —— 注意这里 yield 的是
//     `yieldMessage`（可能被克隆过的那份），而下面行 827 推进
//     assistantMessages 的是 `message`（原件）。
//     两条通道严格分开：
//       外部流 → 可能带 backfill 的克隆
//       内部历史 → 一定是原件（为 prompt cache 字节稳定）
//     这个分离是整段的核心设计，非常容易被改错。
              yield yieldMessage
            }
// ── 23. 收集本轮产出：三个数组 + 一个标志位 ──
            if (message.type === 'assistant') {
              assistantMessages.push(message)

              const msgToolUseBlocks = message.message.content.filter(
                content => content.type === 'tool_use',
              ) as ToolUseBlock[]
              if (msgToolUseBlocks.length > 0) {
                toolUseBlocks.push(...msgToolUseBlocks)
                needsFollowUp = true
              }

              if (
                streamingToolExecutor &&
                !toolUseContext.abortController.signal.aborted
              ) {
                for (const toolBlock of msgToolUseBlocks) {
                  streamingToolExecutor.addTool(toolBlock, message)
                }
              }
            }
// 注：注意顺序 —— 先 push 到 assistantMessages（行 827），再抽出
//     toolUseBlocks（行 829-831），最后喂给 streamingToolExecutor（行 841-843）。
//
//     这个顺序保证了「即使后面中断，历史里也有完整的 assistant 消息」。
//     如果反过来（先执行工具再记录），中断时会出现
//     「工具跑了一半但历史里没有对应的 tool_use」→ 下次请求 400。
//
//     行 838-839 的守卫 `!toolUseContext.abortController.signal.aborted`
//     也是同一个思路：已经中断了就别再启动新工具，否则必然产生孤儿结果。

// ── 24. 流式执行器的结果收割：每条消息都要双写 ──
            if (
              streamingToolExecutor &&
              !toolUseContext.abortController.signal.aborted
            ) {
              for (const result of streamingToolExecutor.getCompletedResults()) {
                if (result.message) {
                  yield result.message
                  toolResults.push(
                    ...normalizeMessagesForAPI(
                      [result.message],
                      toolUseContext.options.tools,
                    ).filter(_ => _.type === 'user'),
                  )
                }
              }
            }
// 注：这段每收到一个执行结果就做两件事：
//       yield result.message             ← 给外部（UI 立刻显示工具输出）
//       toolResults.push(normalize...)   ← 给内部（下一轮要发给模型的上下文）
//
//     为什么 push 的是 `normalizeMessagesForAPI(...).filter(_ => _.type === 'user')`
//     而不是直接 push result.message？
//     因为 normalizeMessagesForAPI 会把各种内部消息形态（attachment、
//     tombstone、summary）统一成 API 能接受的形状，而 tool_result
//     在 API 里必须是 user 角色 —— 所以 filter 掉非 user 的。
//
//     这个「同一份数据，对外原样、对内规范化」的模式，和前面
//     yieldMessage/message 的分离是同一个思路。
          }
          queryCheckpoint('query_api_streaming_end')

// ── 25. 延迟的微压缩边界消息：用真实数字替换估算 ──
          // Yield deferred microcompact boundary message using actual API-reported
          // token deletion count instead of client-side estimates.
          // Entire block gated behind feature() so the excluded string
          // is eliminated from external builds.
          if (feature('CACHED_MICROCOMPACT') && pendingCacheEdits) {
            const lastAssistant = assistantMessages.at(-1)
            // The API field is cumulative/sticky across requests, so we
            // subtract the baseline captured before this request to get the delta.
            const usage = lastAssistant?.message.usage
            const cumulativeDeleted = usage
              ? ((usage as unknown as Record<string, number>)
                  .cache_deleted_input_tokens ?? 0)
              : 0
            const deletedTokens = Math.max(
              0,
              cumulativeDeleted - pendingCacheEdits.baselineCacheDeletedTokens,
            )
            if (deletedTokens > 0) {
              yield createMicrocompactBoundaryMessage(
                pendingCacheEdits.trigger,
                0,
                deletedTokens,
                pendingCacheEdits.deletedToolIds,
                [],
              )
            }
          }
// 注：这段是行 420-425 那个伏笔的收尾。完整逻辑：
//
//     T0  微压缩跑完，得到 pendingCacheEdits（含 baselineCacheDeletedTokens）
//     T1  发请求（此时不发边界消息）
//     T2  收到响应，读 usage.cache_deleted_input_tokens
//     T3  delta = 累计值 - 基线 → 这就是**本次真正删掉的 token 数**
//     T4  delta > 0 才发边界消息
//
//     注释里两个细节：
//       「The API field is cumulative/sticky across requests」
//        —— 这个字段是**累计**的，不是本次增量。所以必须减基线，
//          否则第二次压缩会报「删了第一次+第二次」的总量。
//       「so we subtract the baseline captured before this request」
//        —— 基线是在发请求前捕获的（存在 pendingCacheEdits 里）。
//
//     最后 `Math.max(0, ...)` 兜底：万一基线比累计值还大（不该发生），
//     也不能报负数。
//
//     这个「估算 → 等真实值 → 回填」的模式，在分布式系统里很常见，
//     但在这里尤其重要：因为 prompt cache 的计费完全依赖这些数字，
//     估错了用户会看到不准确的「已节省」提示。
// ═══════════════════════════════════════════════════════════════
// ── 26. FallbackTriggeredError：模型回退 ──
//
// 和前面的 streamingFallback 是两种不同的回退：
//   streamingFallback  → 流**已经开始**了才发现要换模型（要发墓碑）
//   FallbackTriggered  → 流**还没开始**就失败了（干净重试，不用墓碑）
// 后者简单得多，因为它没有「已经吐出去的东西」要清理。
// ═══════════════════════════════════════════════════════════════
        } catch (innerError) {
          if (innerError instanceof FallbackTriggeredError && fallbackModel) {
            // Fallback was triggered - switch model and retry
            currentModel = fallbackModel
            attemptWithFallback = true

            // Clear assistant messages since we'll retry the entire request
            yield* yieldMissingToolResultBlocks(
              assistantMessages,
              'Model fallback triggered',
            )
// 注：`yield* yieldMissingToolResultBlocks(...)` —— 即使是一次干净的重试，
//     也要先给已经产出的 tool_use 补上 tool_result。
//     因为异常可能发生在「收到几个 tool_use 之后、执行之前」。
//
//     然后清空三个数组、重置 needsFollowUp、重建 executor ——
//     和 streamingFallback 那段（行 716-740）是几乎一样的清理。
//     两处逻辑重复，但很难抽公共函数：因为一处要发墓碑（有已 yield 的消息），
//     一处不用（什么都没 yield 过）。这个差异让抽象变得不划算。
            assistantMessages.length = 0
            toolResults.length = 0
            toolUseBlocks.length = 0
            needsFollowUp = false

            // Discard pending results from the failed attempt and create a
            // fresh executor. This prevents orphan tool_results (with old
            // tool_use_ids) from leaking into the retry.
            if (streamingToolExecutor) {
              streamingToolExecutor.discard()
              streamingToolExecutor = new StreamingToolExecutor(
                toolUseContext.options.tools,
                canUseTool,
                toolUseContext,
              )
            }

            // Update tool use context with new model
            toolUseContext.options.mainLoopModel = fallbackModel
// 注：`toolUseContext.options.mainLoopModel = fallbackModel` —— 直接改对象属性，
//     而不是重建 toolUseContext。这是本文件里少见的原地修改。
//
//     为什么可以这么干？因为 toolUseContext 是「引用透传」的：
//     行 360 那个 `toolUseContext = { ...toolUseContext, queryTracking }` 只是
//     换了外层引用，options 仍是同一个对象。改 options 里的字段，
//     所有持有这个 options 的地方都会看到。
//
//     ⚠ 这是个危险操作 —— 如果后面某处缓存了 mainLoopModel 的旧值，
//     就会不一致。事实上行 572 的 currentModel 就是在循环开头算出来的，
//     这里改了 options 但没改 currentModel，所以行 896 单独写了
//     `currentModel = fallbackModel`。**两处都要改，漏一个就不生效。**

// ── 26.1 一个只有内部版踩得到的坑：thinking 签名跨模型无效 ──
            // Thinking signatures are model-bound: replaying a protected-thinking
            // block (e.g. capybara) to an unprotected fallback (e.g. opus) 400s.
            // Strip before retry so the fallback model gets clean history.
            if (process.env.USER_TYPE === 'ant') {
              messagesForQuery = stripSignatureBlocks(messagesForQuery)
            }
// 注：`stripSignatureBlocks` 只在 USER_TYPE === 'ant' 时执行。
//     为什么？因为这个坑只在内部模型之间出现：
//     capybara 是内部专用模型，它的 thinking 签名格式和 opus 不同。
//     从 capybara 回退到 opus 时，把 capybara 的签名发过去 → 400。
//
//     注意这里是 `process.env.USER_TYPE === 'ant'` 内联写法，
//     不是提成变量 —— 和 prompts.ts 里那条 DCE 铁律一致。
//     外部版里这个 if 整段被删掉，因为外部用户根本用不到 capybara。
//
//     顺带一提：这也是「内部模型有额外约束」的一个例证。
//     整个文件里 USER_TYPE 判断只出现这一次，说明 query.ts
//     的主体逻辑对内外是一致的 —— 差异都集中在 model 层。

            // Log the fallback event
            logEvent('tengu_model_fallback_triggered', {
              original_model:
                innerError.originalModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_model:
                fallbackModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              entrypoint:
                'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
            })

            // Yield system message about fallback — use 'warning' level so
// 注：用 'warning' 级别而不是默认级别，注释说「用户不需要开 verbose 就能看到」。
//     这是个产品判断：换模型是对用户有实际影响的事（输出风格可能变、计费可能变），
//     必须主动告知，不能藏在日志里。
//
//     文案也值得看：`Switched to ${fallback} due to high demand for ${original}`
//     —— 把原因说成「原模型需求过高」，而不是「原模型出错了」。
//     这是对外话术：不给用户制造「服务不稳定」的印象。
            // users see the notification without needing verbose mode
            yield createSystemMessage(
              `Switched to ${renderModelName(innerError.fallbackModel)} due to high demand for ${renderModelName(innerError.originalModel)}`,
              'warning',
            )

            continue
          }
          throw innerError
        }
      }
// ═══════════════════════════════════════════════════════════════
// ── 27. 外层 catch：所有非回退类错误的统一出口 ──
// 注意这是**外层** try（对应行 653 的 try），内层 try 在行 656。
// 两层 catch 的职责完全不同：
//   内层 catch（行 893）→ 只处理 FallbackTriggeredError，其他 rethrow
//   外层 catch（行 955）→ 处理剩下的一切
// ═══════════════════════════════════════════════════════════════
    } catch (error) {
      logError(error)
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logEvent('tengu_query_error', {
        assistantMessages: assistantMessages.length,
        toolUses: assistantMessages.flatMap(_ =>
          _.message.content.filter(content => content.type === 'tool_use'),
        ).length,

        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })

      // Handle image size/resize errors with user-friendly messages
      if (
        error instanceof ImageSizeError ||
        error instanceof ImageResizeError
      ) {
        yield createAssistantAPIErrorMessage({
          content: error.message,
        })
        return { reason: 'image_error' }
// 注：图片错误单独识别，给用户友好文案。
//     为什么要特判？因为图片太大/尺寸不对这类错误，API 原始报错
//     极其晦涩（比如 "invalid_request_error: image exceeds 5MB maximum"），
//     而客户端其实能提前算出来。所以本地校验抛 ImageSizeError/ImageResizeError，
//     这里转成 content 直接展示。
//
//     注意 return 的 reason 是 'image_error'，和下面 media 恢复失败时的
//     reason 一致（行 1175）—— 说明「图片问题」是一个统一的终止分类。
      }

      // Generally queryModelWithStreaming should not throw errors but instead
// 注：注释承认了一个设计不彻底之处：
//     「queryModelWithStreaming 通常不该抛错，而应该把错误作为合成
//       assistant 消息 yield 出来。但万一它因为 bug 抛了，
//       我们可能已经发出了 tool_use 块，却会在发出 tool_result 之前停下。」
//
//     也就是：**正常路径不抛异常，异常路径是未定义行为**。
//     这段代码是在给「未定义行为」兜底。
//
//     这类「理论上不该发生，但我必须处理」的代码，通常是线上事故的产物。
//     注释里那句 "due to a bug" 说明作者见过它真的发生。
      // yield them as synthetic assistant messages. However if it does throw
      // due to a bug, we may end up in a state where we have already emitted
      // a tool_use block but will stop before emitting the tool_result.
      yield* yieldMissingToolResultBlocks(assistantMessages, errorMessage)

      // Surface the real error instead of a misleading "[Request interrupted
// 注：这段注释揭示了一个跨平台 bug：
//     「SDK 调用方在 Node 18 上看到假的 'interrupted by user'，
//       而真实原因是缺少 Array.prototype.with()」
//
//     Node 18 没有 Array.prototype.with（Node 20 才加），
//     所以某个用 `.with()` 的地方抛了 TypeError。
//     但上游把它归类成了「用户中断」，于是用户看到
//     "[Request interrupted by user]" —— 完全误导。
//
//     修复不是「加 polyfill」，而是「把真实错误暴露出来」：
//     这里 yield 的是 errorMessage（真实消息），不是中断文案。
//     这个决定的优先级很高：**错误可读性 > 界面整洁**。
//     一个假的中断提示会让用户以为是自己按错了键。
      // by user]" — this path is a model/runtime failure, not a user action.
      // SDK consumers were seeing phantom interrupts on e.g. Node 18's missing
      // Array.prototype.with(), masking the actual cause.
      yield createAssistantAPIErrorMessage({
        content: errorMessage,
      })

      // To help track down bugs, log loudly for ants
      logAntError('Query error', error)
      return { reason: 'model_error', error }
    }

// ── 28. post-sampling hooks：模型说完之后的扩展点 ──
    // Execute post-sampling hooks after model response is complete
    if (assistantMessages.length > 0) {
      void executePostSamplingHooks(
        [...messagesForQuery, ...assistantMessages],
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        querySource,
      )
    }
// 注：`void executePostSamplingHooks(...)` —— 又是 fire-and-forget（故意不 await）。
//
//     为什么可以不 await？因为这是「通知型」钩子：它不该影响主流程。
//     如果 hook 慢，await 会让整个循环卡住。
//     代价是：hook 里抛的错不会被这里捕获（会变成未处理的 rejection），
//     所以 hook 实现内部必须自己 catch。
//
//     触发条件 `assistantMessages.length > 0` 是必要的：
//     如果模型一个字都没说（比如立刻出错），
//     post-sampling hook 没有任何东西可以评估。
//
//     注意传进去的是 `[...messagesForQuery, ...assistantMessages]` ——
//     完整上下文 + 本轮输出。hook 拿到的是一份能独立理解的材料，
//     不需要再去查别的东西。

// ═══════════════════════════════════════════════════════════════
// ── 29. 流式结束后第一件事：检查中断 ──
// 「before anything else」—— 注释里的这两个词是准确的：
// 中断检查排在所有恢复逻辑之前，因为用户按下 Ctrl+C 之后，
// 任何「自动恢复」都是违背用户意愿的。
// ═══════════════════════════════════════════════════════════════
    // We need to handle a streaming abort before anything else.
    // When using streamingToolExecutor, we must consume getRemainingResults() so the
    // executor can generate synthetic tool_result blocks for queued/in-progress tools.
    // Without this, tool_use blocks would lack matching tool_result blocks.
// 注：注释解释了一个协议漏洞，以及两种模式下的两种补法：
//
//   【漏洞】流式中断了，但模型已经发出了 tool_use 块。
//           如果不补 tool_result，历史里就有孤儿 tool_use → 下次 400。
//
//   【流式执行器模式】必须调 getRemainingResults() 把剩余结果消费完。
//           因为 executor 内部会检查 abort 信号，为被中断的工具
//           生成**合成 tool_result**。不调它就永远生成不出来。
//           注意是 `for await` 而不是 `return` —— 必须等到它 yield 完。
//
//   【批式模式】直接调 yieldMissingToolResultBlocks 补一条
//           「Interrupted by user」的错误结果。因为批式模式下
//           工具可能还没开始执行，没有 executor 能生成合成结果。
//
//   两种模式、两种补法、同一个目标。这就是「双模式并存」的成本。
    if (toolUseContext.abortController.signal.aborted) {
      if (streamingToolExecutor) {
        // Consume remaining results - executor generates synthetic tool_results for
        // aborted tools since it checks the abort signal in executeTool()
        for await (const update of streamingToolExecutor.getRemainingResults()) {
          if (update.message) {
            yield update.message
          }
        }
      } else {
        yield* yieldMissingToolResultBlocks(
          assistantMessages,
          'Interrupted by user',
        )
      }
      // chicago MCP: auto-unhide + lock release on interrupt. Same cleanup
// 注：chicago MCP 的清理 —— auto-unhide + 释放锁。
//
//     注释里三个限定词都重要：
//       · 只在 `!toolUseContext.agentId` 时做（主线程 only）
//       · 和 stopHooks.ts 里的自然结束路径是**同样的清理**
//       · 子代理不做的理由写在 stopHooks.ts（「subagent-releasing-main's-lock」）
//
//     第三点是关键：如果子代理也去释放主线程的锁，就会把主线程正在用的
//     资源抢走。所以「谁持有的谁释放」。
//
//     注意 `try { } catch { }` 是**空 catch**，注释说
//     "Failures are silent — this is dogfooding cleanup, not critical path"。
//     空 catch 通常被视为坏味道，但这里是有意的：清理失败不该
//     阻止会话结束。前提是「这不影响正确性」—— 作者明确判断过了。
//
//     注意用的是动态 `await import(...)` 而不是顶层 import ——
//     因为 CHICAGO_MCP 在外部版里是 false，动态 import 才能被 DCE 掉
//     （如果是顶层 import，模块无论如何都会被打进 bundle）。
      // as the natural turn-end path in stopHooks.ts. Main thread only —
      // see stopHooks.ts for the subagent-releasing-main's-lock rationale.
      if (feature('CHICAGO_MCP') && !toolUseContext.agentId) {
        try {
          const { cleanupComputerUseAfterTurn } = await import(
            './utils/computerUse/cleanup.js'
          )
          await cleanupComputerUseAfterTurn(toolUseContext)
        } catch {
          // Failures are silent — this is dogfooding cleanup, not critical path
        }
      }

      // Skip the interruption message for submit-interrupts — the queued
// 注：`signal.reason !== 'interrupt'` 才发中断消息。
//
//     两种中断的差别：
//       · 'interrupt'（提交式中断）→ 用户按了回车要打断，然后马上会发新消息。
//         此时再插一句「请求被中断」反而多余，因为紧接着就有用户的新消息。
//       · 其他（Esc、Ctrl+C）→ 用户就是想停下来，需要明确告知。
//
//     这个细节说明「中断」不是一个状态，而是有语义区分的两种用户意图。
//     同一份清理逻辑，对两种意图给出不同的界面反馈。
      // user message that follows provides sufficient context.
      if (toolUseContext.abortController.signal.reason !== 'interrupt') {
        yield createUserInterruptionMessage({
          toolUse: false,
        })
      }
      return { reason: 'aborted_streaming' }
    }

// ── 30. 收割上一轮埋下的延迟任务 ──
    // Yield tool use summary from previous turn — haiku (~1s) resolved during model streaming (5-30s)
    if (pendingToolUseSummary) {
      const summary = await pendingToolUseSummary
      if (summary) {
        yield summary
      }
    }
// 注：`await pendingToolUseSummary` —— 这里是整个「工具使用摘要」
//     设计的落点。回顾一下时间线：
//
//       第 N 轮   工具执行完 → 发起摘要生成（Haiku，约 1 秒）→ 存进 state
//       第 N+1 轮 模型流式输出 5-30 秒（摘要并跑）
//                 到这里 await 它 → 早就好了，零等待
//
//     如果摘要生成失败或超时，`.catch(() => null)` 吞掉错误（行 1481），
//     这里 `if (summary)` 判断后跳过。**摘要失败不影响主流程**，
//     因为它只是给移动端 UI 的一个「这次用了什么工具」的友好文案。
//
//     这是个很值得学的模式：**把可选的慢操作藏进已有的等待里**。
//     前提是这个操作「失败也无所谓」，否则就要考虑降级策略。

// ═══════════════════════════════════════════════════════════════
// ── 31. needsFollowUp === false：本轮的"收尾分支" ──
//
// 从行 1062 到 1358，全部在 `if (!needsFollowUp)` 里 —— 也就是
// 「模型这次没有要求调用工具」。听起来简单，但这是全文件最长的一段，
// 因为**所有终止路径和恢复路径都集中在这里**。
//
// 顺序是精心排的，从上到下依次是：
//   ① prompt-too-long 恢复（折叠 drain → 反应式压缩）
//   ② max_output_tokens 恢复（升级 64k → 多轮续写 → 放弃）
//   ③ API 错误 → 跳过 stop hook，直接结束
//   ④ stop hook 检查
//   ⑤ token budget 续跑
//   ⑥ 正常结束
//
// 为什么顺序不能换？因为它们是「从具体到一般」的降级链：
// 先处理最特定的错误，最后才走正常路径。
// 如果把 ⑥ 放前面，所有恢复逻辑都成死代码。
// ═══════════════════════════════════════════════════════════════
    if (!needsFollowUp) {
      const lastMessage = assistantMessages.at(-1)

      // Prompt-too-long recovery: the streaming loop withheld the error
      // (see withheldByCollapse / withheldByReactive above). Try collapse
      // drain first (cheap, keeps granular context), then reactive compact
      // (full summary). Single-shot on each — if a retry still 413's,
      // the next stage handles it or the error surfaces.
// 注：三个条件同时成立才是「被扣留的 413」：
//       lastMessage 是 assistant 消息
//       isApiErrorMessage 为 true（是个错误消息，不是正常回复）
//       isPromptTooLongMessage 为 true（错误类型是上下文太长）
//
//     注意这里检查的是 `lastMessage`（从 assistantMessages 取的最后一条），
//     而 assistantMessages 里**包含被 withheld 的消息**（行 827 无条件 push）。
//     这正是「扣留但不丢弃」的实现方式：
//       外部流：没发（用户看不到错误）
//       内部数组：有（这里能检测到）
//     设计的两半必须同时存在，否则恢复逻辑找不到错误。
      const isWithheld413 =
        lastMessage?.type === 'assistant' &&
        lastMessage.isApiErrorMessage &&
        isPromptTooLongMessage(lastMessage)
      // Media-size rejections (image/PDF/many-image) are recoverable via
// 注：media 错误和 PTL 的关键差别，注释写得很清楚：
//     「不像 PTL，media 错误跳过 collapse drain —— 折叠不会剥掉图片」。
//
//     这是「恢复手段必须匹配错误成因」的原则：
//       · 上下文太长 → 折叠/压缩能解决（减少 token）
//       · 图片太大 → 折叠/压缩解决不了（图片还在那里）
//     所以 media 直接跳到反应式压缩，因为那一层有 strip-retry（剥掉媒体再试）。
//
//     后半句是个重要的失败保护：
//     「如果超大媒体在被保留的尾部，压缩后的下一轮还会 media-error；
//       hasAttemptedReactiveCompact 防止螺旋，最终错误会暴露出来」。
//
//     也就是说：反应式压缩只做一次（标志位），做过了还失败就认输。
//     没有这个标志位，就会出现「压缩 → 图片还在 → 再压缩 → …」的死循环，
//     每一圈都花一次压缩的钱。
      // reactive compact's strip-retry. Unlike PTL, media errors skip the
      // collapse drain — collapse doesn't strip images. mediaRecoveryEnabled
      // is the hoisted gate from before the stream loop (same value as the
      // withholding check — these two must agree or a withheld message is
      // lost). If the oversized media is in the preserved tail, the
      // post-compact turn will media-error again; hasAttemptedReactiveCompact
      // prevents a spiral and the error surfaces.
      const isWithheldMedia =
        mediaRecoveryEnabled &&
        reactiveCompact?.isWithheldMediaSizeError(lastMessage)
// ═══════════════════════════════════════════════════════════════
// ── 32. 恢复策略①：折叠 drain（最便宜的一档） ──
// ═══════════════════════════════════════════════════════════════
      if (isWithheld413) {
        // First: drain all staged context-collapses. Gated on the PREVIOUS
        // transition not being collapse_drain_retry — if we already drained
        // and the retry still 413'd, fall through to reactive compact.
        if (
          feature('CONTEXT_COLLAPSE') &&
          contextCollapse &&
          state.transition?.reason !== 'collapse_drain_retry'
        ) {
          const drained = contextCollapse.recoverFromOverflow(
            messagesForQuery,
            querySource,
          )
          if (drained.committed > 0) {
            const next: State = {
              messages: drained.messages,
              toolUseContext,
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              hasAttemptedReactiveCompact,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              turnCount,
              transition: {
                reason: 'collapse_drain_retry',
                committed: drained.committed,
              },
            }
            state = next
            continue
          }
        }
      }
// 注：这段是「continue 站点」的标准形状，值得当成模板记住：
//
//     1. 前置条件检查
//        `state.transition?.reason !== 'collapse_drain_retry'`
//        —— 上次已经是 drain 了就别再来，否则死循环。
//        这是**用 state 自己记录「我刚做过什么」**，而不是额外的标志位。
//
//     2. 尝试恢复
//        recoverFromOverflow 把暂存的折叠全部提交。
//        返回 committed 数量 —— 0 表示没有可提交的。
//
//     3. 只有真的做了什么才 continue
//        `if (drained.committed > 0)` —— 如果 committed 是 0，
//        说明没东西可折叠，落到下面的反应式压缩。
//        这个守卫很重要：不加它就会「什么也没做但重试一次」，
//        白花一次 API 调用。
//
//     4. 构造 next state（9 个字段全写）
//        messages       → 折叠后的消息
//        autoCompactTracking → tracking（不变）
//        maxOutputTokensOverride → undefined（重置，因为不是这个路径）
//        transition     → { reason: 'collapse_drain_retry', committed }
//        注意 transition 带了 committed 这个附加字段 ——
//        Terminal/Continue 类型允许带上下文，测试可以断言「提交了几个折叠」。
//
//     5. state = next; continue
//
//     全文 7 个 continue 站点都是这个形状。看懂一个，剩下六个就是看差异。
// ── 32.1 恢复策略②：反应式压缩（第二档）──
      if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
        const compacted = await reactiveCompact.tryReactiveCompact({
          hasAttempted: hasAttemptedReactiveCompact,
          querySource,
          aborted: toolUseContext.abortController.signal.aborted,
          messages: messagesForQuery,
          cacheSafeParams: {
            systemPrompt,
            userContext,
            systemContext,
            toolUseContext,
            forkContextMessages: messagesForQuery,
          },
        })

        if (compacted) {
          // task_budget: same carryover as the proactive path above.
          // messagesForQuery still holds the pre-compact array here (the
          // 413-failed attempt's input).
          if (params.taskBudget) {
            const preCompactContext =
              finalContextTokensFromLastResponse(messagesForQuery)
            taskBudgetRemaining = Math.max(
              0,
              (taskBudgetRemaining ?? params.taskBudget.total) -
                preCompactContext,
            )
          }

          const postCompactMessages = buildPostCompactMessages(compacted)
          for (const msg of postCompactMessages) {
            yield msg
          }
          const next: State = {
            messages: postCompactMessages,
            toolUseContext,
            autoCompactTracking: undefined,
            maxOutputTokensRecoveryCount,
            hasAttemptedReactiveCompact: true,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: { reason: 'reactive_compact_retry' },
          }
          state = next
          continue
        }
// 注：注意 `(isWithheld413 || isWithheldMedia) && reactiveCompact` ——
//     PTL 和 media 共用这一个入口，因为反应式压缩能同时处理两者
//     （它内部先 strip 媒体，再摘要）。
//
//     `hasAttempted: hasAttemptedReactiveCompact` 传进去的是**当前**标志位，
//     压缩函数自己决定要不要跳过。成功后 next state 里置 true。
//     这个「传进去 + 置回来」的模式，比在调用点判断更灵活 ——
//     因为压缩函数内部可能还有别的跳过条件。
//
//     注意这里**又一次**补偿 taskBudgetRemaining（行 1138-1146），
//     和行 504 那处是重复的。两处都必须有，因为压缩有两个触发点
//     （主动检查 vs 反应式）。这类「同一件事在两个地方做」的代码，
//     是未来最容易漏改的地方。

        // No recovery — surface the withheld error and exit. Do NOT fall
// 注：这段注释解释了一个**死亡螺旋**，值得完整理解：
//
//     场景：上下文太长 → 压缩也救不回来。
//     如果此时仍然执行 stop hooks：
//       错误 → hook 检查这条错误消息 → hook 觉得「任务没完成」→ 阻止继续
//       → 注入 blockingError → 重试 → 上下文更长 → 又太长 → …
//
//     每一圈 hook 都注入更多 token（因为它要说明「为什么阻止」），
//     所以上下文只会越来越长。注释说「每圈烧掉几千次 API 调用」——
//     这不是夸张，是这类循环的实际规模。
//
//     解法：**模型没产出有效响应时，不要跑 stop hooks**。
//     因为 hooks 的设计目的是「评估模型做了什么」，而这里什么都没做。
//     同样的话在行 1258 又说了一遍（针对 API 错误），说明这是
//     两个不同的入口都要防。
//
//     `void executeStopFailureHooks(...)` —— 注意调的是 *Failure* 版本，
//     不是普通的 stop hooks。语义是「这一轮以失败告终」，
//     让用户配置的钩子有机会做失败通知（比如发 Slack）。
        // through to stop hooks: the model never produced a valid response,
        // so hooks have nothing meaningful to evaluate. Running stop hooks
        // on prompt-too-long creates a death spiral: error → hook blocking
        // → retry → error → … (the hook injects more tokens each cycle).
        yield lastMessage
        void executeStopFailureHooks(lastMessage, toolUseContext)
        return { reason: isWithheldMedia ? 'image_error' : 'prompt_too_long' }
      } else if (feature('CONTEXT_COLLAPSE') && isWithheld413) {
        // reactiveCompact compiled out but contextCollapse withheld and
        // couldn't recover (staged queue empty/stale). Surface. Same
        // early-return rationale — don't fall through to stop hooks.
        yield lastMessage
        void executeStopFailureHooks(lastMessage, toolUseContext)
        return { reason: 'prompt_too_long' }
      }

// ═══════════════════════════════════════════════════════════════
// ── 33. 恢复策略③④⑤：max_output_tokens 的三级阶梯 ──
//
// 三档，从便宜到昂贵：
//   ③ 升级 max_tokens（8k → 64k），同一次请求重发，无额外消息
//   ④ 多轮续写（注入「继续」消息），最多 3 次
//   ⑤ 放弃，把错误抛给用户
// ═══════════════════════════════════════════════════════════════
      // Check for max_output_tokens and inject recovery message. The error
      // was withheld from the stream above; only surface it if recovery
      // exhausts.
      if (isWithheldMaxOutputTokens(lastMessage)) {
        // Escalating retry: if we used the capped 8k default and hit the
        // limit, retry the SAME request at 64k — no meta message, no
        // multi-turn dance. This fires once per turn (guarded by the
        // override check), then falls through to multi-turn recovery if
        // 64k also hits the cap.
        // 3P default: false (not validated on Bedrock/Vertex)
// 注：`// 3P default: false (not validated on Bedrock/Vertex)` ——
//     这个 feature flag 在第三方部署（Bedrock/Vertex）上默认关闭，
//     因为那边还没验证过 64k 输出的行为。
//
//     这是「内外差异」的另一种形式：不是内部/外部，而是
//     「Anthropic 官方 API」vs「第三方云厂商」。同一个模型，
//     不同部署渠道的能力边界不同，所以功能要分别放量。
        const capEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
          'tengu_otk_slot_v1',
          false,
        )
        if (
// 注：三个条件：
//       capEnabled                         feature flag 开着
//       maxOutputTokensOverride === undefined  还没升级过
//       !process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS  用户没手动设过
//
//     第三个条件很容易忽略但很重要：如果用户自己设了
//     CLAUDE_CODE_MAX_OUTPUT_TOKENS=8192，说明他明确要这个值，
//     我们不该偷偷升到 64k（那会超出他的成本预期）。
//     这是「尊重显式配置」的原则：显式设置优先于启发式升级。
//
//     注意 `maxOutputTokensOverride === undefined` 这个守卫，
//     它同时承担了「防重复升级」的职责 —— 升级后 next state 里
//     override 被设成 ESCALATED_MAX_TOKENS（行 1213），
//     下一轮这个条件就不成立了。**用状态本身当计数器**，
//     不需要额外的布尔量。
          capEnabled &&
          maxOutputTokensOverride === undefined &&
          !process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
        ) {
          logEvent('tengu_max_tokens_escalate', {
            escalatedTo: ESCALATED_MAX_TOKENS,
          })
          const next: State = {
            messages: messagesForQuery,
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: ESCALATED_MAX_TOKENS,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: { reason: 'max_output_tokens_escalate' },
          }
          state = next
          continue
        }

        if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
          const recoveryMessage = createUserMessage({
            content:
              `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
// 注：这条恢复消息的措辞非常讲究，逐句看：
//
//     "Output token limit hit."         → 陈述事实，不道歉
//     "Resume directly — no apology, no recap of what you were doing."
//                                       → 明确禁止两种浪费：
//                                         道歉（纯废话）、回顾（重复已有内容）
//     "Pick up mid-thought if that is where the cut happened."
//                                       → 允许在半句话中间接上 ——
//                                         这很反直觉，但正是需要的：
//                                         截断发生在思考中途时，重新组织
//                                         语言反而会丢掉进展
//     "Break remaining work into smaller pieces."
//                                       → 给出防止再次截断的方法
//
//     四句话，每句都在解决一个具体的坏行为。这就是「提示词是补丁」
//     的又一个例证：这条消息不是写给用户看的，是写给模型的指令，
//     而它针对的是「模型被截断后会道歉+重新开头」这个具体毛病。
//
//     `isMeta: true` 很重要：标记为元消息，UI 不会把它渲染成
//     用户说的话（否则用户会看到一句自己没打过的「Output token limit hit」）。
              `Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`,
            isMeta: true,
          })

          const next: State = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              recoveryMessage,
            ],
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: {
              reason: 'max_output_tokens_recovery',
              attempt: maxOutputTokensRecoveryCount + 1,
            },
          }
          state = next
          continue
        }

        // Recovery exhausted — surface the withheld error now.
// 注：`yield lastMessage` —— 到这一步才真正把扣留的错误放出去。
//     回顾整条链：
//       行 820  isWithheldMaxOutputTokens(message) → 不 yield
//       行 1223 recoveryCount < 3 → 注入恢复消息，continue
//       行 1223 不成立（已经 3 次）→ 落到这里，yield 出去
//
//     「扣留 → 尝试恢复 → 恢复不了才上报」，三步缺一不可。
//     如果一开始就上报，用户会在明明可以自动恢复的情况下看到错误；
//     如果不设上限，会无限重试烧钱。
        yield lastMessage
      }

      // Skip stop hooks when the last message is an API error (rate limit,
// 注：这是「死亡螺旋」防御的第二个入口（第一个在行 1168）。
//
//     `lastMessage?.isApiErrorMessage` 覆盖所有 API 错误：
//     限流、认证失败、prompt too long、服务器错误……
//     只要最后一条是错误消息，就跳过 stop hooks。
//
//     注意这里 return 的 reason 是 **'completed'** 而不是 'error' ——
//     有点反直觉。理由可能是：从「这一轮对话」的角度看，它确实结束了
//     （错误消息已经发给用户了），而错误分类由消息本身承载。
//     Terminal 的 reason 是给控制流用的标签，不是给用户看的错误码。
//
//     对比行 996 的 `return { reason: 'model_error', error }` ——
//     那是**抛异常**的路径，属于「我们没处理好」；
//     这里是「API 明确返回了错误」，属于「处理好了，结果是个错误」。
//     两者语义不同，所以 reason 不同。
      // prompt-too-long, auth failure, etc.). The model never produced a
      // real response — hooks evaluating it create a death spiral:
      // error → hook blocking → retry → error → …
      if (lastMessage?.isApiErrorMessage) {
        void executeStopFailureHooks(lastMessage, toolUseContext)
        return { reason: 'completed' }
      }

// ═══════════════════════════════════════════════════════════════
// ── 34. stop hooks：用户可配置的"这一轮做完了吗"检查 ──
//
// 这是本文件里 `yield*` 委托的第二个例子（第一个是 query → queryLoop，
// 第三个是 yieldMissingToolResultBlocks）。handleStopHooks 本身就是
// 一个生成器，它可能在检查过程中 yield 出消息（比如 hook 的输出）。
// ═══════════════════════════════════════════════════════════════
      const stopHookResult = yield* handleStopHooks(
        messagesForQuery,
        assistantMessages,
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        querySource,
        stopHookActive,
      )

      if (stopHookResult.preventContinuation) {
// 注：三种 hook 结果，对应三种处理：
//
//   preventContinuation  → 直接结束。hook 说「不要再继续了」，
//                          比如某个 hook 检测到危险操作已经发生。
//
//   blockingErrors.length > 0 → 注入错误消息并**重试**。
//                          这是「hook 拦下这一轮，让模型看到问题并修正」。
//                          对应下面行 1282-1306 那个 continue 站点。
//
//   两者都没有 → 继续往下走（token budget 检查 → 正常结束）。
//
//   ⚠ preventContinuation 和 blockingErrors 的语义差别值得注意：
//     前者是「终止」，后者是「打回重做」。一个用户配置的 hook
//     要在这两者之间选，说明 hook 协议里本意就是要区分
//     「别做了」和「这么做得不对，改」。
//     本文件没有展示 hook 侧怎么选（在 stopHooks.ts 里）。
        return { reason: 'stop_hook_prevented' }
      }

      if (stopHookResult.blockingErrors.length > 0) {
        const next: State = {
          messages: [
            ...messagesForQuery,
            ...assistantMessages,
            ...stopHookResult.blockingErrors,
          ],
          toolUseContext,
          autoCompactTracking: tracking,
          maxOutputTokensRecoveryCount: 0,
          // Preserve the reactive compact guard — if compact already ran and
// 注：这段注释记录了一个**真实的死循环 bug 及其修复**，极其值得读：
//
//     「保留反应式压缩的守卫 —— 如果压缩已经跑过而且没能从
//       prompt-too-long 恢复，那么在 stop-hook blocking 错误之后重试
//       会得到同样的结果。这里重置成 false 曾导致无限循环：
//       压缩 → 还是太长 → 报错 → stop hook 阻止 → 压缩 → …
//       烧掉几千次 API 调用。」
//
//     看代码：`hasAttemptedReactiveCompact,` —— 直接透传，**不重置**。
//     而紧邻的 `maxOutputTokensRecoveryCount: 0` 是重置的。
//     两个计数器待遇相反，理由就在这里：
//       · maxOutputTokens 计数重置是合理的（新一轮可以再试 3 次续写）
//       · reactiveCompact 标志不能重置（重试也解决不了，因为压缩本身
//         已经证明救不回来）
//
//     这是「两个看起来同类的字段，其实语义相反」的典型陷阱。
//     注释的存在就是为了防止后人「顺手把两个都重置了」。
          // couldn't recover from prompt-too-long, retrying after a stop-hook
          // blocking error will produce the same result. Resetting to false
          // here caused an infinite loop: compact → still too long → error →
          // stop hook blocking → compact → … burning thousands of API calls.
          hasAttemptedReactiveCompact,
          maxOutputTokensOverride: undefined,
          pendingToolUseSummary: undefined,
          stopHookActive: true,
          turnCount,
          transition: { reason: 'stop_hook_blocking' },
        }
        state = next
        continue
      }

// ── 35. token budget：+500k 自动续跑 ──
      if (feature('TOKEN_BUDGET')) {
        const decision = checkTokenBudget(
          budgetTracker!,
          toolUseContext.agentId,
          getCurrentTurnTokenBudget(),
          getTurnOutputTokens(),
        )

        if (decision.action === 'continue') {
          incrementBudgetContinuationCount()
          logForDebugging(
            `Token budget continuation #${decision.continuationCount}: ${decision.pct}% (${decision.turnTokens.toLocaleString()} / ${decision.budget.toLocaleString()})`,
          )
          state = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              createUserMessage({
                content: decision.nudgeMessage,
                isMeta: true,
              }),
            ],
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: 0,
            hasAttemptedReactiveCompact: false,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: { reason: 'token_budget_continuation' },
          }
          continue
        }

        if (decision.completionEvent) {
          if (decision.completionEvent.diminishingReturns) {
            logForDebugging(
              `Token budget early stop: diminishing returns at ${decision.completionEvent.pct}%`,
            )
          }
          logEvent('tengu_token_budget_completed', {
            ...decision.completionEvent,
            queryChainId: queryChainIdForAnalytics,
            queryDepth: queryTracking.depth,
          })
        }
      }

      return { reason: 'completed' }
// 注：注意 block 结尾的 `return { reason: 'completed' }` 在 if 外面 ——
//     也就是说无论 TOKEN_BUDGET 开不开、无论预算是否触发续跑，
//     走到这里就是「这一轮正常完成」。
//
//     这是 `!needsFollowUp` 分支的**唯一正常出口**。
//     上面 6 个 return 都是异常/特殊路径（blocking_limit、image_error、
//     model_error、aborted_streaming、prompt_too_long、stop_hook_prevented），
//     只有这一个代表「模型说完了，没有工具要调，一切正常」。
    }

// ═══════════════════════════════════════════════════════════════
// ── 36. 走到这里意味着：模型要求调用工具 ──
//
// 从这里到行 1728（循环末尾）是「执行工具 → 准备下一轮」的完整流程：
//   执行工具 → 收割结果 → 生成摘要（异步）→ 检查中断
//   → 注入 attachment → 消费预取 → 刷新工具 → 检查 maxTurns
//   → 构造 next state → continue
// ═══════════════════════════════════════════════════════════════
    let shouldPreventContinuation = false
    let updatedToolUseContext = toolUseContext

    queryCheckpoint('query_tool_execution_start')


    if (streamingToolExecutor) {
// 注：`tengu_streaming_tool_execution_used` / `_not_used` 两个事件
//     成对出现，而不是一个事件带布尔字段。
//
//     为什么？因为这样可以直接算「使用率」：
//         used / (used + not_used)
//     如果合成一个事件带 `used: boolean`，分析时要先 group by 再算比例。
//     这是埋点设计的习惯差异 —— 事件名携带维度，查询时就少一步。
//
//     代价是事件种类翻倍。在事件数量可控时（这里有上百个 tengu_* 事件），
//     这种做法能显著简化分析侧的 SQL。
      logEvent('tengu_streaming_tool_execution_used', {
        tool_count: toolUseBlocks.length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })
    } else {
      logEvent('tengu_streaming_tool_execution_not_used', {
        tool_count: toolUseBlocks.length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })
    }

    const toolUpdates = streamingToolExecutor
// 注：这个三元是整个「双执行模式」的收敛点：
//       streamingToolExecutor 存在 → getRemainingResults()（拿剩下的）
//       否则                      → runTools(...)（一次性跑全部）
//
//     两者都返回 `AsyncIterable<ToolUpdate>`，所以下面一个 for await
//     就能统一处理。**接口统一、实现分立** —— 这是双模式能共存的关键。
//
//     注意 getRemainingResults 是「剩下的」：流式模式下，部分工具
//     已经在流式过程中执行完并收割过了（行 851 的 getCompletedResults），
//     这里只拿还没拿过的。如果重复拿，同一条 tool_result 会进两次历史 → 400。
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message

        if (
// 注：`hook_stopped_continuation` 是一个特殊的 attachment 类型 ——
//     hook 通过它在工具结果里插入「别再继续了」的信号。
//
//     为什么用 attachment 而不是直接抛异常？因为工具已经执行了，
//     结果必须进历史（否则孤儿 tool_use）。所以协议是：
//     「工具结果照常返回，但附带一句：到此为止」。
//     然后主循环读到这个附加信息，置 shouldPreventContinuation，
//     在行 1519 干净退出。
//
//     这类「用数据而不是控制流传递信号」的设计在生成器架构里很常见：
//     因为生成器不能随便抛异常（会打断已经 yield 的流）。
          update.message.type === 'attachment' &&
          update.message.attachment.type === 'hook_stopped_continuation'
        ) {
          shouldPreventContinuation = true
        }

        toolResults.push(
          ...normalizeMessagesForAPI(
            [update.message],
            toolUseContext.options.tools,
          ).filter(_ => _.type === 'user'),
        )
      }
      if (update.newContext) {
        updatedToolUseContext = {
          ...update.newContext,
          queryTracking,
        }
      }
    }
    queryCheckpoint('query_tool_execution_end')

// ── 37. 工具使用摘要：又一次"藏在等待里"的异步任务 ──
    // Generate tool use summary after tool batch completes — passed to next recursive call
    let nextPendingToolUseSummary:
      | Promise<ToolUseSummaryMessage | null>
      | undefined
    if (
      config.gates.emitToolUseSummaries &&
      toolUseBlocks.length > 0 &&
      !toolUseContext.abortController.signal.aborted &&
      !toolUseContext.agentId // subagents don't surface in mobile UI — skip the Haiku call
// 注：四个条件决定了要不要生成摘要：
//       config.gates.emitToolUseSummaries  全局开关
//       toolUseBlocks.length > 0           本轮确实用了工具
//       !aborted                           没被中断
//       !toolUseContext.agentId            **不是子代理**
//
//     最后一条的注释：「subagents don't surface in mobile UI — skip the Haiku call」。
//     子代理不在移动端 UI 里显示，所以它们的工具摘要没人看。
//     跳过能省一次 Haiku 调用 —— 而子代理可能很多（一次任务 5 个），
//     每个都生成摘要是纯浪费。
//
//     这是「成本控制下沉到最细粒度」的例子：不是全局关掉摘要功能，
//     而是精确到「这个场景下没人消费这个产物」。
    ) {
      // Extract the last assistant text block for context
      const lastAssistantMessage = assistantMessages.at(-1)
      let lastAssistantText: string | undefined
      if (lastAssistantMessage) {
        const textBlocks = lastAssistantMessage.message.content.filter(
          block => block.type === 'text',
        )
        if (textBlocks.length > 0) {
          const lastTextBlock = textBlocks.at(-1)
          if (lastTextBlock && 'text' in lastTextBlock) {
            lastAssistantText = lastTextBlock.text
          }
        }
      }

      // Collect tool info for summary generation
      const toolUseIds = toolUseBlocks.map(block => block.id)
      const toolInfoForSummary = toolUseBlocks.map(block => {
        // Find the corresponding tool result
        const toolResult = toolResults.find(
          result =>
            result.type === 'user' &&
            Array.isArray(result.message.content) &&
            result.message.content.some(
              content =>
                content.type === 'tool_result' &&
                content.tool_use_id === block.id,
            ),
        )
        const resultContent =
          toolResult?.type === 'user' &&
          Array.isArray(toolResult.message.content)
            ? toolResult.message.content.find(
                (c): c is ToolResultBlockParam =>
                  c.type === 'tool_result' && c.tool_use_id === block.id,
              )
            : undefined
        return {
          name: block.name,
          input: block.input,
          output:
            resultContent && 'content' in resultContent
              ? resultContent.content
              : null,
        }
      })

      // Fire off summary generation without blocking the next API call
      nextPendingToolUseSummary = generateToolUseSummary({
// 注：这里同时用了 `.then()` 和 `.catch()`，而不是 async/await。
//     原因：这个 Promise 要**存起来留给下一轮**，不能在当前轮 await。
//     用 `.then().catch()` 能直接得到「永远不会 reject」的 Promise，
//     下一轮 `await pendingToolUseSummary` 就不用再包 try/catch。
//
//     `.catch(() => null)` 的意思是「摘要生成失败就当没有」——
//     因为摘要只是 UI 的友好文案，失败不该影响任何东西。
//     这就是把一个可失败的可选操作「降级成 null」的标准做法。
        tools: toolInfoForSummary,
        signal: toolUseContext.abortController.signal,
        isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
        lastAssistantText,
      })
        .then(summary => {
          if (summary) {
            return createToolUseSummaryMessage(summary, toolUseIds)
          }
          return null
        })
        .catch(() => null)
    }

// ── 38. 工具执行期间被中断：第二个 abort 检查点 ──
    // We were aborted during tool calls
    if (toolUseContext.abortController.signal.aborted) {
      // chicago MCP: auto-unhide + lock release when aborted mid-tool-call.
      // This is the most likely Ctrl+C path for CU (e.g. slow screenshot).
      // Main thread only — see stopHooks.ts for the subagent rationale.
      if (feature('CHICAGO_MCP') && !toolUseContext.agentId) {
        try {
          const { cleanupComputerUseAfterTurn } = await import(
            './utils/computerUse/cleanup.js'
          )
          await cleanupComputerUseAfterTurn(toolUseContext)
        } catch {
          // Failures are silent — this is dogfooding cleanup, not critical path
        }
      }
      // Skip the interruption message for submit-interrupts — the queued
      // user message that follows provides sufficient context.
      if (toolUseContext.abortController.signal.reason !== 'interrupt') {
        yield createUserInterruptionMessage({
          toolUse: true,
        })
      }
      // Check maxTurns before returning when aborted
      const nextTurnCountOnAbort = turnCount + 1
      if (maxTurns && nextTurnCountOnAbort > maxTurns) {
        yield createAttachmentMessage({
          type: 'max_turns_reached',
          maxTurns,
          turnCount: nextTurnCountOnAbort,
        })
      }
      return { reason: 'aborted_tools' }
    }
// 注：和行 1015 那个 abort 检查相比，这里少了「补 tool_result」那一步 ——
//     因为工具已经执行完了（for await 走完了），结果都在 toolResults 里，
//     不存在孤儿。
//
//     多出来的是 maxTurns 检查（行 1506-1514）：
//       即使被中断，也要检查是不是已经超过轮数上限。
//       如果超了，额外发一条 max_turns_reached attachment。
//     为什么在中断路径上还要检查这个？因为中断也是一种「这一轮结束了」，
//     用户需要知道「你不是被我中断的，是你本来就跑满了」。
//
//     `toolUse: true`（行 1503）和行 1048 的 `toolUse: false` 的区别：
//     中断发生在工具执行阶段还是模型生成阶段。UI 可以用这个字段
//     决定显示「工具被中断」还是「回复被中断」。

    // If a hook indicated to prevent continuation, stop here
    if (shouldPreventContinuation) {
      return { reason: 'hook_stopped' }
    }

    if (tracking?.compacted) {
// 注：`if (tracking?.compacted)` —— 只有压缩过的会话才计数。
//     这个计数器（turnCounter）的含义是「上次压缩之后过了几轮」，
//     用来判断「压缩效果是否足够」：
//       如果 2 轮就又满了 → 压缩没解决问题（可能摘要质量差，或任务本身太大）
//       如果 20 轮才满   → 压缩很有效
//
//     注意 `tracking.turnCounter++` 是**原地修改** trackIng 对象，
//     而不是重建。这是本文件里少见的可变操作 —— 因为 tracking
//     会被原样传进 next state，所以原地改等价于重建。
//     （但这是隐式契约：如果哪天有人在这里做了拷贝，就会失效。）
      tracking.turnCounter++
      logEvent('tengu_post_autocompact_turn', {
        turnId:
          tracking.turnId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        turnCounter: tracking.turnCounter,

        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })
    }

    // Be careful to do this after tool calls are done, because the API
// 注：这句注释是一个**顺序约束**，非常关键：
//     「务必在工具调用完成之后再做这个，因为如果我们把
//       tool_result 消息和普通 user 消息交错，API 会报错。」
//
//     Anthropic API 的协议要求：所有 tool_result 必须**紧跟在**
//     对应的 assistant 消息后面，中间不能插入普通 user 消息。
//     所以工具结果收集完（行 1384-1408）之后，才允许注入 attachment
//     （行 1580）、memory（行 1608）、skill（行 1624）。
//
//     这条约束是整段代码顺序的唯一理由。如果看到有人把 attachment
//     注入提前了，就会踩这个坑 —— 而且报错信息不会告诉你「顺序错了」，
//     只会说「tool_use 没有对应的 tool_result」，非常难查。
    // will error if we interleave tool_result messages with regular user messages.

    // Instrumentation: Track message count before attachments
    logEvent('tengu_query_before_attachments', {
      messagesForQueryCount: messagesForQuery.length,
      assistantMessagesCount: assistantMessages.length,
      toolResultsCount: toolResults.length,
      queryChainId: queryChainIdForAnalytics,
      queryDepth: queryTracking.depth,
    })

// ═══════════════════════════════════════════════════════════════
// ── 39. 队列排空：把「用户中途输入」和「后台任务通知」变成 attachment ──
//
// 这是附件段最长的一段注释（13 行），因为它要同时说清四件事：
// 优先级、Slash 命令排除、Bash 命令排除、Agent 作用域隔离。
// ═══════════════════════════════════════════════════════════════
    // Get queued commands snapshot before processing attachments.
    // These will be sent as attachments so Claude can respond to them in the current turn.
    //
    // Drain pending notifications. LocalShellTask completions are 'next'
    // (when MONITOR_TOOL is on) and drain without Sleep. Other task types
    // (agent/workflow/framework) still default to 'later' — the Sleep flush
    // covers those. If all task types move to 'next', this branch could go.
    //
    // Slash commands are excluded from mid-turn drain — they must go through
    // processSlashCommand after the turn ends (via useQueueProcessor), not be
    // sent to the model as text. Bash-mode commands are already excluded by
    // INLINE_NOTIFICATION_MODES in getQueuedCommandAttachments.
    //
    // Agent scoping: the queue is a process-global singleton shared by the
    // coordinator and all in-process subagents. Each loop drains only what's
    // addressed to it — main thread drains agentId===undefined, subagents
    // drain their own agentId. User prompts (mode:'prompt') still go to main
    // only; subagents never see the prompt stream.
    // eslint-disable-next-line custom-rules/require-tool-match-name -- ToolUseBlock.name has no aliases
    const sleepRan = toolUseBlocks.some(b => b.name === SLEEP_TOOL_NAME)
// 注：`sleepRan` 决定派空队列的优先级档位：
//       本轮跑过 Sleep 工具 → 'later'（一次多拿点）
//       否则                → 'next'（只拿最高优先级）
//
//     为什么 Sleep 会改变这个？因为 Sleep 的语义是「我在等，有时间处理别的事」。
//     跑过 Sleep 说明这一轮本来就是空转，可以顺手把 'later' 档的通知也消化掉。
//     没跑 Sleep 说明正在密集干活，只处理最紧急的。
//
//     这是一个「用工具调用推断当前工作节奏」的技巧 ——
//     比显式传一个 `isIdle` 标志更省事，且不会不一致。
//
//     `// eslint-disable-next-line custom-rules/require-tool-match-name`
//     那行注释说明项目有一条自定义规则：比较工具名时必须用常量而不是字面量。
//     这里用 SLEEP_TOOL_NAME 常量是对的，但规则检测不出来（因为它在 .some()
//     的回调里），所以加 disable。
    const isMainThread =
      querySource.startsWith('repl_main_thread') || querySource === 'sdk'
    const currentAgentId = toolUseContext.agentId
    const queuedCommandsSnapshot = getCommandsByMaxPriority(
// 注：这个 filter 是本段最复杂的逻辑，四个分支各有理由：
//
//       isSlashCommand(cmd) → return false
//         斜杠命令不能在轮中注入。它们必须等这一轮结束后走
//         processSlashCommand（行 1555-1557 的注释）。
//         原因：斜杠命令可能改变整个会话状态，中途执行会撕裂上下文。
//
//       isMainThread → cmd.agentId === undefined
//         主线程只拿「没有指定 agentId」的命令。
//
//       否则（子代理）→ cmd.mode === 'task-notification' && cmd.agentId === 自己
//         子代理**只**拿发给它的任务通知。注意注释的强调：
//         「never user prompts, even if someone stamps an agentId on one」
//         （即使用户提示词上被误盖了 agentId，也不要给子代理）。
//         这是防御性的：用户提示词应该只有主线程处理。
//
//     注释里还有一句解释队列本身：「队列是进程级单例，被协调器和
//     所有进程内子代理共享」。所以这个 filter 是唯一的分发依据 ——
//     没有它，所有代理会抢同一条消息。
      sleepRan ? 'later' : 'next',
    ).filter(cmd => {
      if (isSlashCommand(cmd)) return false
      if (isMainThread) return cmd.agentId === undefined
      // Subagents only drain task-notifications addressed to them — never
      // user prompts, even if someone stamps an agentId on one.
      return cmd.mode === 'task-notification' && cmd.agentId === currentAgentId
    })

    for await (const attachment of getAttachmentMessages(
      null,
      updatedToolUseContext,
      null,
      queuedCommandsSnapshot,
      [...messagesForQuery, ...assistantMessages, ...toolResults],
      querySource,
    )) {
      yield attachment
      toolResults.push(attachment)
    }

// ── 40. 消费两个后台预取 ──
    // Memory prefetch consume: only if settled and not already consumed on
    // an earlier iteration. If not settled yet, skip (zero-wait) and retry
    // next iteration — the prefetch gets as many chances as there are loop
    // iterations before the turn ends. readFileState (cumulative across
    // iterations) filters out memories the model already Read/Wrote/Edited
    // — including in earlier iterations, which the per-iteration
    // toolUseBlocks array would miss.
    if (
      pendingMemoryPrefetch &&
      pendingMemoryPrefetch.settledAt !== null &&
      pendingMemoryPrefetch.consumedOnIteration === -1
    ) {
      const memoryAttachments = filterDuplicateMemoryAttachments(
        await pendingMemoryPrefetch.promise,
        toolUseContext.readFileState,
      )
      for (const memAttachment of memoryAttachments) {
        const msg = createAttachmentMessage(memAttachment)
        yield msg
        toolResults.push(msg)
      }
      pendingMemoryPrefetch.consumedOnIteration = turnCount - 1
    }
// 注：`pendingMemoryPrefetch.consumedOnIteration === -1` 这个守卫，
//     配上行 1613 的 `= turnCount - 1`，实现的语义是：
//     **整个 query() 生命周期内只消费一次**。
//
//     为什么只消费一次？因为记忆预取是针对「本次用户请求」的 ——
//     用户换了话题才需要重新查记忆，同一轮里反复查没意义。
//
//     `settledAt !== null` 是「零等待」判断：还没跑完就跳过，
//     下一轮再来试。注释说得很好：「预取能获得和循环迭代次数一样多的机会」。
//     这比 await 更好 —— await 会阻塞，而这里「没准备好就不等」。
//
//     readFileState 的作用值得单独说：它累积记录了模型已经 Read/Wrote/Edited
//     过的文件，用来过滤掉「模型已经知道的记忆」。
//     如果是按轮过滤（只看本轮的 toolUseBlocks），会漏掉前几轮读过的文件 ——
//     所以用累积状态。这是「跨轮状态」在细节上的必要性。


// ── 41. 技能发现预取：和记忆预取同一形状，但判据不同 ──
    // Inject prefetched skill discovery. collectSkillDiscoveryPrefetch emits
    // hidden_by_main_turn — true when the prefetch resolved before this point
    // (should be >98% at AKI@250ms / Haiku@573ms vs turn durations of 2-30s).
    if (skillPrefetch && pendingSkillPrefetch) {
      const skillAttachments =
        await skillPrefetch.collectSkillDiscoveryPrefetch(pendingSkillPrefetch)
      for (const att of skillAttachments) {
        const msg = createAttachmentMessage(att)
        yield msg
        toolResults.push(msg)
      }
    }
// 注：对比记忆预取（行 1599-1614），技能预取少了一个「只消费一次」的守卫：
//     记忆版有 consumedOnIteration，技能版没有。
//
//     为什么？因为技能发现的语义不同 —— 每轮都可能需要「新技能」。
//     比如第 1 轮在写代码（需要 code review 技能），第 3 轮在写文档
//     （需要 doc 技能）。所以每轮都重新收集是合理的。
//
//     注释里的 `hidden_by_main_turn` 是个遥测字段：
//     「预取在消费点之前就 resolve 了则为 true」。
//     期望值 >98%（因为预取有 2-30 秒可跑，而收集只在最后一步）。
//     这个指标用来验证「这个优化真的藏住了延迟」——
//     如果只有 60%，说明预取经常来不及，优化无效。

    // Remove only commands that were actually consumed as attachments.
// 注：这个 filter 只保留 `mode === 'prompt' || 'task-notification'` 的命令。
//     为什么不保留全部 queuedCommandsSnapshot？
//
//     因为附件生成阶段（getAttachmentMessages）只把这两类转成了 attachment。
//     其他类型（比如 Bash 模式的命令）没有变成消息，所以不能从队列删 ——
//     删了就丢了。
//
//     这是「删除必须与消费严格对应」的原则：
//     先看谁真的被消费了，再删谁。反过来（先删再消费）一旦消费失败，
//     命令就永久丢失。
    // Prompt and task-notification commands are converted to attachments above.
    const consumedCommands = queuedCommandsSnapshot.filter(
      cmd => cmd.mode === 'prompt' || cmd.mode === 'task-notification',
    )
    if (consumedCommands.length > 0) {
      for (const cmd of consumedCommands) {
        if (cmd.uuid) {
          consumedCommandUuids.push(cmd.uuid)
          notifyCommandLifecycle(cmd.uuid, 'started')
        }
      }
      removeFromQueue(consumedCommands)
    }

    // Instrumentation: Track file change attachments after they're added
    const fileChangeAttachmentCount = count(
      toolResults,
      tr =>
        tr.type === 'attachment' && tr.attachment.type === 'edited_text_file',
    )

    logEvent('tengu_query_after_attachments', {
      totalToolResultsCount: toolResults.length,
      fileChangeAttachmentCount,
      queryChainId: queryChainIdForAnalytics,
      queryDepth: queryTracking.depth,
    })

// ── 42. 轮中刷新工具：让新连上的 MCP 服务器立刻可用 ──
    // Refresh tools between turns so newly-connected MCP servers become available
    if (updatedToolUseContext.options.refreshTools) {
      const refreshedTools = updatedToolUseContext.options.refreshTools()
      if (refreshedTools !== updatedToolUseContext.options.tools) {
        updatedToolUseContext = {
          ...updatedToolUseContext,
          options: {
            ...updatedToolUseContext.options,
            tools: refreshedTools,
          },
        }
      }
    }
// 注：`if (refreshedTools !== updatedToolUseContext.options.tools)` ——
//     用**引用相等**判断有没有变化，而不是深比较。
//
//     这意味着 refreshTools 的实现必须遵守一个契约：
//     「没变化就返回原来那个数组的同一个引用」。如果它每次返回一个新数组
//     （哪怕内容一样），这里就会误判为「变了」，然后走一遍对象重建。
//     后果不严重（只是多一次浅拷贝），但会让 `options.tools` 的引用
//     不断变化 —— 而引用变化会影响下游的 memo 缓存。
//
//     这类「靠引用相等做优化判据」的代码，隐式依赖了对方的实现细节。

    const toolUseContextWithQueryTracking = {
      ...updatedToolUseContext,
      queryTracking,
    }

    // Each time we have tool results and are about to recurse, that's a turn
// 注：`const nextTurnCount = turnCount + 1` —— 这里就递增了，
//     但 next state 要到行 1715 才构造。
//
//     中间隔着：attachment 注入、预取消费、队列清理、工具刷新、任务摘要。
//     为什么提前算？因为 maxTurns 检查（行 1705）要用它，
//     而那个检查必须在构造 next state 之前做（超了就 return，不构造）。
//
//     注意 turnCount 的语义：**「有工具结果并准备进入下一轮」才 +1**。
//     所以它不是「模型说了几次话」，而是「工具用了几个批次」。
//     这个定义和用户的直觉（「对话了几轮」）不一样，看遥测数据时要小心。
    const nextTurnCount = turnCount + 1

    // Periodic task summary for `claude ps` — fires mid-turn so a
// 注：`claude ps` 是外部命令（列出正在运行的 Claude 会话）。
//     这个任务摘要就是给它提供「这个会话在干什么」的一句话描述。
//
//     注释里的四个入口列表（REPL, SDK, HFI, remote）说明这个功能
//     覆盖所有顶层会话类型。而 `!agentId` 的判据再次出现 ——
//     和工具摘要（行 1419）用的是同一个守卫，理由也一样：
//     子代理不需要被 `claude ps` 列出来。
//
//     `shouldGenerateTaskSummary()` 内部应该有节流逻辑（不然每轮都生成
//     一次会很贵），本文件看不到，但从「periodic」这个词可以推断。
    // long-running agent still refreshes what it's working on. Gated
    // only on !agentId so every top-level conversation (REPL, SDK, HFI,
    // remote) generates summaries; subagents/forks don't.
    if (feature('BG_SESSIONS')) {
      if (
        !toolUseContext.agentId &&
        taskSummaryModule!.shouldGenerateTaskSummary()
      ) {
        taskSummaryModule!.maybeGenerateTaskSummary({
          systemPrompt,
          userContext,
          systemContext,
          toolUseContext,
          forkContextMessages: [
            ...messagesForQuery,
            ...assistantMessages,
            ...toolResults,
          ],
        })
      }
    }

    // Check if we've reached the max turns limit
// 注：maxTurns 检查放在了**所有副作用之后**。
//
//     顺序是：工具执行 → 摘要生成 → attachment 注入 → 队列清理
//     → 工具刷新 → 任务摘要 → **然后**才检查 maxTurns。
//
//     为什么？因为已经做的工作不能白做 —— 如果提前 return，
//     上面的 attachment 就丢了（用户中途输入的消息不见了）。
//     所以策略是「先保住这一轮的全部成果，再用一条 attachment 告诉用户
//     『到上限了』，然后结束」。
//
//     注意 yield 的是 attachment 而不是错误消息：
//     max_turns_reached 是一个**正常**的结束方式（用户设了上限，
//     我们遵守了），不是错误。用 attachment 能在对话流里显示成
//     一条系统提示，而不是红色报错。
    if (maxTurns && nextTurnCount > maxTurns) {
      yield createAttachmentMessage({
        type: 'max_turns_reached',
        maxTurns,
        turnCount: nextTurnCount,
      })
      return { reason: 'max_turns', turnCount: nextTurnCount }
    }

// ═══════════════════════════════════════════════════════════════
// ── 43. 第七个（也是最后一个）continue 站点：next_turn ──
//
// 这个站点和其他六个有本质区别：其他六个都是「因为出错了所以重来」，
// 只有这个是**正常推进** —— 工具结果拿到了，进入下一轮。
// ═══════════════════════════════════════════════════════════════
    queryCheckpoint('query_recursive_call')
    const next: State = {
      messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
      toolUseContext: toolUseContextWithQueryTracking,
      autoCompactTracking: tracking,
      turnCount: nextTurnCount,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: nextPendingToolUseSummary,
      maxOutputTokensOverride: undefined,
      stopHookActive,
      transition: { reason: 'next_turn' },
    }
// 注：7 个 continue 站点的 transition.reason 汇总，这是读这个文件最好的索引：
//
//   'collapse_drain_retry'        行 1110  折叠 drain 后再试
//   'reactive_compact_retry'      行 1162  反应式压缩后再试
//   'max_output_tokens_escalate'  行 1217  升级 max_tokens 后重发
//   'max_output_tokens_recovery'  行 1246  注入「继续」消息后续写
//   'stop_hook_blocking'          行 1302  hook 拦下，带错误重试
//   'token_budget_continuation'   行 1338  预算没花完，注入催促消息
//   'next_turn'                   行 1725  ← 唯一正常的推进
//
// 前六个都是「异常恢复」，只有第七个是「正常流转」。
// 这个 1:6 的比例很说明问题：**主循环的复杂度绝大部分在恢复上，
// 不在正常路径上**。正常路径其实只有三步：发请求 → 执行工具 → 下一轮。
//
// 注意 `messages: [...messagesForQuery, ...assistantMessages, ...toolResults]`
// 这个拼接顺序是协议要求：历史 + 模型说的话 + 工具结果。
// 而 toolResults 里既有工具结果也有 attachment（都是 user 角色），
// 它们必须紧跟在 assistantMessages 之后 —— 这就是行 1535 那条顺序约束的落点。
    state = next
  } // while (true)
// ═══════════════════════════════════════════════════════════════
// 【本文件小结 · 五个可以带走的结论】
//
// 1. 它是状态机，不是递归
//    while(true) + 9 字段 State + 7 个 continue 站点 + 11 个 return。
//    注释里到处说 "recursive"，但代码从来不是。这个措辞差异是
//    「概念上像递归（自己调自己）」和「实现上是循环」的区别。
//    真正的递归发生在别处：子代理调用（AgentTool 会重新进 query()）。
//
// 2. 复杂度几乎全在恢复上
//    正常路径三步：发请求 → 执行工具 → 下一轮。
//    其余 1400 行都在处理：上下文太长、输出被截断、模型要回退、
//    用户中断、hook 拦截、预算没花完。7 个 continue 站点里 6 个是恢复。
//
// 3. 「扣留 → 恢复 → 失败才上报」是本文件的核心范式
//    错误先不 yield（否则 SDK 客户端会关会话），内部照走恢复流程，
//    恢复不了才吐出来。四个 withheld 来源、三条恢复阶梯，都是这个范式。
//
// 4. 五层上下文压缩，从便宜到昂贵
//    applyToolResultBudget → snip → microcompact → contextCollapse → autocompact。
//    前四层不调模型，第五层要调。能前四层解决就绝不进第五层。
//    代价是层间记账：snipTokensFreed、taskBudgetRemaining、
//    pendingCacheEdits 都要在各层之间正确传递，漏一处就误判。
//
// 5. 双执行模式（流式/批式）是贯穿全文的额外复杂度
//    几乎每段都有 `if (streamingToolExecutor)` 分支，两套清理逻辑。
//    好处是首字延迟大幅降低，代价是「同样的坑要修两遍」。
//
// 下一步：src/QueryEngine.ts —— 包在 query() 外面的一层。
// 如果 query.ts 是「一轮对话怎么跑」，QueryEngine 就是
// 「一次会话里怎么管多轮、怎么存历史、怎么处理并发请求」。
// ═══════════════════════════════════════════════════════════════
}
