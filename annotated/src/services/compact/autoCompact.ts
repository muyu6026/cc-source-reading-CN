import { feature } from 'bun:bundle'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getSdkBetas } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getMaxOutputTokensForModel } from '../api/claude.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
  type RecompactionInfo,
} from './compact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { trySessionMemoryCompaction } from './sessionMemoryCompact.js'

// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 3/N —— 自动压缩的决策层（src/services/compact/autoCompact.ts）
//
// 这里不是"怎么压"，而是"什么时候压、压不压"。
// 真正的压缩动作在 compact.ts（1,705 行），这个文件只做**判定**。
//
// query.ts 的循环里，每轮稳定调用一次 autoCompactIfNeeded。
// 它返回 wasCompacted，循环根据这个值决定要不要重来一轮
// （就是 query.ts 里 'collapse_drain_retry' 那类转换的近亲）。
//
// 【这个文件的四层结构，读之前先建立框架】
//
//   第一层 算阈值    getEffectiveContextWindowSize / getAutoCompactThreshold
//                    ——"这个模型还能装多少"
//   第二层 算状态    calculateTokenWarningState
//                    ——"现在到哪个水位了"（百分比 + 四个布尔量）
//   第三层 四道闸门  shouldAutoCompact
//                    ——"即使超了，也未必该压"（递归/模式互斥）
//   第四层 执行      autoCompactIfNeeded
//                    ——"先试 session memory，不行再走传统摘要"
//
// 【先记住一个反直觉的事实】
// 这个文件里最重要的代码不是"怎么算阈值"，而是 169-223 行那**四道
// 抑制闸门**。因为阈值算错了顶多压缩晚一点，而闸门缺失会造成
// 死锁、状态破坏、或者两套上下文机制互相打断。
// ═══════════════════════════════════════════════════════════════
// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens.
// 这个 20,000 不是拍的：注释给了数据来源 —— 压缩摘要输出的 p99.99 是 17,387。
// 取 20k 留了约 15% 余量。
//
// 为什么必须预留：压缩本身要发一次请求，那次请求的**输出**是摘要。
// 如果不预留，压缩请求自己就会撞上下文上限 ——
// 相当于"为了腾出空间而做的动作，自己先没空间做"。
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// ═══ 第一层：可用窗口 ═══
//
// 三步：取模型窗口 → 扣掉摘要预留 → 允许环境变量再往下压。
//
// 注意 `Math.min(getMaxOutputTokensForModel(model), MAX_OUTPUT_TOKENS_FOR_SUMMARY)`：
// 取 min 是为了兼容小模型。如果模型本身最大输出只有 8k，
// 就不能给它预留 20k（那比它的上限还大，等于永远压不了）。
// 这个 getMaxOutputTokensForModel 就是上一轮 claude.ts 行 3399 的函数。
// Returns the context window size minus the max output tokens for the model
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

// 环境变量只能**往下**压（Math.min），不能往上抬。
// 理由：抬高意味着"声称窗口比实际大"，会直接撞 API 的硬上限。
// 调低是安全的，主要用于测试（让压缩早点触发，不用真的跑满 20 万 token）。
  const autoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  return contextWindow - reservedTokensForSummary
}

// ═══ 跨轮的压缩状态 ═══
//
// 四个字段全部由 query.ts 的 State 传进来又传回去（这就是为什么
// 它是参数而不是模块级变量）：
//
//   compacted         这一轮对话里压过没有 → 决定 recompaction 信息
//   turnCounter       距离上次压缩过了几轮 → 诊断用
//   turnId            轮次唯一 id
//   consecutiveFailures  连续失败次数 → 熔断器（下面 70 行）
//
// 注意 consecutiveFailures 是**可选**的：老会话恢复时没有这个字段，
// 视为 0。用 undefined 而不是 0 做默认，是为了区分
// "从没失败过"和"失败计数被显式清零"。
export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  // Unique ID per turn
  turnId: string
  // Consecutive autocompact failures. Reset on success.
  // Used as a circuit breaker to stop retrying when the context is
  // irrecoverably over the limit (e.g., prompt_too_long).
  consecutiveFailures?: number
}

// 四个缓冲常量，全部是"从可用窗口往下退多少"。
// 数值本身不重要，重要的是它们的**相对关系**：
//
//   AUTOCOMPACT_BUFFER 13,000   自动压缩触发线（窗口 - 13k）
//   WARNING_THRESHOLD  20,000   警告线（比压缩线更早）
//   ERROR_THRESHOLD    20,000   错误线（和警告线重合）
//   MANUAL_COMPACT      3,000   手动 /compact 的硬阻断线
//
// 两个反直觉点：
//
//   ① 警告线**早于**压缩线（20k > 13k 意味着更早触发）。
//      也就是说用户先看到"快满了"的提示，然后才真的开始压。
//
//   ② 手动压缩的缓冲只有 3k，远小于自动压缩的 13k。
//      因为手动是用户主动要求的，应该尽量满足；自动是后台行为，
//      要留更多余量避免"压完立刻就又满了"。
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

// ⚠ 熔断器，注释里带的是一组真实数据：
//
//     "BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures
//      (up to 3,272) in a single session, wasting ~250K API calls/day"
//
// 翻译：某天发现有 1,279 个会话出现过连续 50 次以上失败（最多的一个
// 连败 3,272 次），每天白烧约 25 万次 API 调用。
//
// 根因：上下文已经不可恢复地超出上限（比如 prompt_too_long），
// 每次尝试都注定失败，但没有任何机制阻止它继续试。
//
// 修法就是三振出局。**这个常量的价值不在数字 3，而在它背后那条数据**：
// 没有监控数据的话，根本不会想到"重试会失败"这件事本身会成灾。
// Stop trying autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

// ═══ 第二层：阈值 ═══
//
// 正常情况就是"可用窗口 - 13k"。剩下那段是测试用的百分比覆盖，
// 两个细节值得注意：
//   ① 取 min（Math.min），所以百分比只能让压缩**更早**触发，不能更晚
//   ② parseFloat 而不是 parseInt —— 允许传 12.5 这种值
export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)

  const autocompactThreshold =
    effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS

  // Override for easier testing of autocompact
  const envPercent = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const percentageThreshold = Math.floor(
        effectiveContextWindow * (parsed / 100),
      )
      return Math.min(percentageThreshold, autocompactThreshold)
    }
  }

  return autocompactThreshold
}

// ═══════════════════════════════════════════════════════════════
// calculateTokenWarningState —— 一次算出 UI 要的全部水位信息
//
// 返回五个值，但只有一个是数字（percentLeft），其余四个是布尔量。
// 这个形状说明它的用途是"给界面喂状态"，不是"给逻辑做判断"。
//
// 【一个容易看漏的关键点】（104 行）
//
//     const threshold = isAutoCompactEnabled()
//       ? autoCompactThreshold          // 窗口 - 13k
//       : getEffectiveContextWindowSize(model)   // 窗口
//
// 自动压缩关掉时，水位**基准线整个往后挪 13k**。
// 因为那 13k 是"为了能压缩而预留的空间"，不压缩了就不需要预留。
// 如果这里不切换基准，关掉自动压缩的用户会一直看到"只剩 6%"的警告，
// 而这个警告毫无意义（他本来就要手动压）。
// ═══════════════════════════════════════════════════════════════
export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

// percentLeft 用了 Math.max(0, ...) 兜底：
// 超过阈值时百分比会变成负数，显示"-3% 剩余"很怪，所以夹到 0。
  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

// 两条线都从同一个 threshold 往下退，而两个 buffer 都是 20k，
// 所以 warningThreshold 和 errorThreshold 在这里**恰好相等**。
//
// 这不是 bug，是两个常量暂时取了同一个值。留两个名字的理由：
// 将来警告和错误要用不同提前量时，改常量即可，不用改结构。
  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    isAutoCompactEnabled() && tokenUsage >= autoCompactThreshold

// ⚠ 这里重新算了一次 getEffectiveContextWindowSize，而不是复用上面的 threshold。
//
// 为什么：上面那个 threshold 可能是"窗口 - 13k"，而阻断线要的是
// **真实窗口**（不管自动压缩开没开，物理上限都在那里）。
// 所以这里用 actualContextWindow 重新算，只扣 3k。
//
// 这个细节说明了一个设计原则：**同一个概念（可用窗口）在两处含义不同，
// 就不要图省事复用变量**。命名上 actual 这个词就是在提示区别。
  const actualContextWindow = getEffectiveContextWindowSize(model)
  const defaultBlockingLimit =
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS

  // Allow override for testing
  const blockingLimitOverride = process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

// 三道门，从强到弱：
//   DISABLE_COMPACT      全关（自动 + 手动都不行）
//   DISABLE_AUTO_COMPACT 只关自动（手动 /compact 仍可用）
//   用户配置             用户在设置里关掉自动压缩
//
// 两个环境变量分开是有必要的：调试时经常想"保留手动压缩能力，
// 只关掉后台自动压"，这样能精确复现问题。
export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  // Allow disabling just auto-compact (keeps manual /compact working)
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  // Check if user has disabled auto-compact in their settings
  const userConfig = getGlobalConfig()
  return userConfig.autoCompactEnabled
}

// ═══════════════════════════════════════════════════════════════
// 第三层：shouldAutoCompact —— 四道抑制闸门 + 最后一次水位判断
//
// 返回 false 的理由有六种，但只有最后一种是"没超阈值"。
// 前五种都是"超了也不该压"，每一种对应一类真实故障：
//
//   ① querySource === 'compact'         压缩自己不能再触发压缩
//   ② querySource === 'session_memory'  session memory 是分叉 agent，会死锁
//   ③ querySource === 'marble_origami'  ctx-agent 压了会毁掉主线程状态
//   ④ reactive-only 模式开着            改由 413 错误响应式触发
//   ⑤ context-collapse 开着             那是另一套上下文管理，会互相抢
//   ⑥ 没超阈值
//
// 这就是为什么我说这个文件的价值在闸门而不在阈值。
// ═══════════════════════════════════════════════════════════════
export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
): Promise<boolean> {
// ①② 两个递归防护，注释一句话带过但含义很重：
// "session_memory and compact are forked agents that would deadlock."
//
// 压缩要发一次模型调用，而那次调用本身也走完整的 query 链路。
// 如果它撞到上限又想压缩，就会"压缩触发压缩"——
// 而外层的压缩还在等内层返回，两边互相等 → 死锁。
// 所以这两个 querySource 无条件返回 false。
  // Recursion guards. session_memory and compact are forked agents that
  // would deadlock.
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }
// ③ 第三个防护最微妙，值得完整翻译那段注释：
//
//   "marble_origami is the ctx-agent — if ITS context blows up and
//    autocompact fires, runPostCompactCleanup calls resetContextCollapse()
//    which destroys the MAIN thread's committed log (module-level state
//    shared across forks)."
//
// 翻译：marble_origami 是"上下文 agent"。它自己的上下文如果爆了、
// 触发了自动压缩，收尾清理会调 resetContextCollapse()，
// 而那会**销毁主线程已提交的日志** —— 因为那份状态是模块级的，
// 所有 fork 共享同一份。
//
// 一个子 agent 的阈值判断，能通过模块级状态毁掉父线程的数据。
// 这类 bug 极难定位：现象是"主线程莫名其妙丢了一大段上下文"，
// 原因在另一个 agent 的压缩路径里。
//
// 顺带注意 feature() 包住的是整个 if：'marble_origami' 这个字符串
// 在 excluded-strings.txt 里，外部构建必须把它删掉。
  // marble_origami is the ctx-agent — if ITS context blows up and
  // autocompact fires, runPostCompactCleanup calls resetContextCollapse()
  // which destroys the MAIN thread's committed log (module-level state
  // shared across forks). Inside feature() so the string DCEs from
  // external builds (it's in excluded-strings.txt).
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {
      return false
    }
  }

  if (!isAutoCompactEnabled()) {
    return false
  }

// ④ reactive-only 模式：**关掉主动压缩，改由 413 错误驱动**。
//
// 两种压缩哲学的对比很有意思：
//
//   主动（proactive）：算着 token 数，快到上限就先压。可预测，但可能白压。
//   响应（reactive） ：什么都不管，撞到 prompt_too_long 再压。
//                      不浪费任何一次压缩，但要先吃一次失败。
//
// 这个开关（tengu_cobalt_raccoon）就是在两者之间切。
// 注意注释里那句重要的附带说明：这里返回 false 会导致
// **query 循环里永远到不了 trySessionMemoryCompaction**
// （因为它在 autoCompactIfNeeded 里）。而手动 /compact 那条路径
// 仍然会先试 session memory —— 两条入口的行为因此不一致，作者标注了
// "Revisit if reactive-only graduates"（等这个模式转正再说）。
  // Reactive-only mode: suppress proactive autocompact, let reactive compact
  // catch the API's prompt-too-long. feature() wrapper keeps the flag string
  // out of external builds (REACTIVE_COMPACT is ant-only).
  // Note: returning false here also means autoCompactIfNeeded never reaches
  // trySessionMemoryCompaction in the query loop — the /compact call site
  // still tries session memory first. Revisit if reactive-only graduates.
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      return false
    }
  }

// ⑤ 最长的一段注释，讲的是**两套上下文管理机制互斥**的问题。
// 这是全文件最值得精读的设计说明，核心是"两个机制的时间窗重叠了"：
//
//   context-collapse：90% 提交、95% 阻断
//   autocompact：     有效窗口 - 13k ≈ 93%
//
// 93% 正好卡在 90% 和 95% 中间。于是 autocompact 会在 collapse
// "刚开始提交、还没来得及保存"的时刻插进来 —— 而且它通常更快（简单粗暴），
// 于是 collapse 精心保留的细粒度上下文被 autocompact 一把清掉。
//
// "so it would race collapse and usually win, nuking granular context
//  that collapse was about to save" —— 竞态 + 总是赢 = 另一套机制白干。
//
// 处理方式也很讲究：**闸门加在这里，而不是加在 isAutoCompactEnabled() 里。**
// 理由（注释 206-209 行）：因为 reactiveCompact 会**直接**查
// isAutoCompactEnabled 来决定要不要做 413 兜底。如果把闸门塞进那个函数，
// 连 413 兜底一起被关掉，那 collapse 一旦失败就彻底没救了。
// 同样保住的还有 sessionMemory 和手动 /compact。
//
// 一条经验：**抑制逻辑要加在"调用点"而不是"判定函数"里**，
// 因为判定函数往往被多个语义不同的调用方复用。
  // Context-collapse mode: same suppression. Collapse IS the context
  // management system when it's on — the 90% commit / 95% blocking-spawn
  // flow owns the headroom problem. Autocompact firing at effective-13k
  // (~93% of effective) sits right between collapse's commit-start (90%)
  // and blocking (95%), so it would race collapse and usually win, nuking
  // granular context that collapse was about to save. Gating here rather
  // than in isAutoCompactEnabled() keeps reactiveCompact alive as the 413
  // fallback (it consults isAutoCompactEnabled directly) and leaves
  // sessionMemory + manual /compact working.
  //
  // Consult isContextCollapseEnabled (not the raw gate) so the
  // CLAUDE_CONTEXT_COLLAPSE env override is honored here too. require()
  // inside the block breaks the init-time cycle (this file exports
  // getEffectiveContextWindowSize which collapse's index imports).
// 为什么用 require 而不是 import：注释说得很清楚 ——
// 破初始化环。这个文件导出 getEffectiveContextWindowSize，
// 而 contextCollapse/index.js 又要 import 它。
// 静态 import 会形成循环依赖，在 ESM 下可能拿到未初始化的绑定。
//
// 用 require 把求值推迟到"真的走到这一行"的时候，
// 那时两个模块都已经初始化完了。
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      return false
    }
  }

// snipTokensFreed 这个参数解释了一个很容易踩的坑（注释 164-167 行）：
//
// snip（裁剪）删掉了消息，但**存活下来的那条 assistant 消息里记录的 usage
// 仍然是裁剪前的**。而 tokenCountWithEstimation 是"从消息里读用量"的，
// 所以它看不见裁剪省下的空间 —— 会高估。
//
// 解法是让 snip 把自己估算的"省了多少"带过来，在这里减掉。
// 这类"状态是快照、改不了源头"的问题，只能靠显式传差值来补。
  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model)
  const effectiveWindow = getEffectiveContextWindowSize(model)

// 这行日志是排查压缩问题的第一手材料，四个数字要连着看：
// tokens / threshold / effectiveWindow，加上可选的 snipFreed。
//
// 典型故障模式：tokens 已经超过 effectiveWindow 但 threshold 还没到 ——
// 说明 buffer 算错了；或者 tokens 远小于 threshold 却频繁压缩 ——
// 说明阈值被百分比覆盖拉低过。
  logForDebugging(
    `autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}${snipTokensFreed > 0 ? ` snipFreed=${snipTokensFreed}` : ''}`,
  )

  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(
    tokenCount,
    model,
  )

  return isAboveAutoCompactThreshold
}

// ═══════════════════════════════════════════════════════════════
// 第四层：autoCompactIfNeeded —— 执行
//
// 顺序严格，每一步都有"不做会怎样"：
//
//   253  DISABLE_COMPACT 直接返回      调试用
//   260  熔断器检查                    防止对不可恢复状态反复重试
//   268  调 shouldAutoCompact          六道闸门 + 水位
//   279  构造 recompactionInfo         告诉下游"这是第几次压、间隔多少轮"
//   288  **先试 session memory**       便宜的方案优先
//   313  落回传统摘要压缩              贵但通用
//   334  catch：计数 + 熔断            失败也要留下痕迹
// ═══════════════════════════════════════════════════════════════
export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
}> {
// 这里再查一次 DISABLE_COMPACT，和 isAutoCompactEnabled 里重复了。
// 不是冗余：因为这个函数可能被**直接**调用（不经过 shouldAutoCompact），
// 所以必须自己能兜住"全关"这个状态。
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

// 熔断器检查放在水位判断**之前**。顺序有意义：
// 已经三振的会话，连"要不要压"都不用算 —— 省掉一次 token 统计
// （tokenCountWithEstimation 要遍历全部消息，不便宜）。
//
// 注意 `tracking?.consecutiveFailures !== undefined` 这个前置判断：
// 必须显式区分"没有这个字段"和"字段是 0"。如果直接写
// `>= MAX` 而 undefined >= 3 是 false，其实也能工作，
// 但加上这个判断让意图更明确。
  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
  if (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
  )

  if (!shouldCompact) {
    return { wasCompacted: false }
  }

// recompactionInfo 是给压缩器看的"上下文元信息"：
//   是不是链式重压（之前已经压过一次，这是第二次）
//   距离上次压缩过了几轮（-1 表示没记录）
//   上次压缩的 turnId（用于关联分析）
//   阈值（让压缩器知道"我是被什么标准触发的"）
//
// 这些信息不影响压缩算法本身，但影响日志、指标、以及
// "要不要给出更激进的压缩策略"这类判断。
  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model),
    querySource,
  }

// ⚠ 策略优先级：**session memory 先试，失败/不可用才落回传统摘要。**
//
// session memory 是另一套机制（SessionMemory 目录，约 1,000 行）：
// 它平时就在后台维护一份"这段对话在干什么"的结构化记忆，
// 所以压缩时不需要再发一次模型调用去总结，直接拿现成的。
//
// 三种结果对应三条路：
//   返回结果对象 → 用它，直接 return（不走传统压缩）
//   返回 null    → 不可用（没开启/没有记忆/不够用），落回传统压缩
//   抛异常       → 不进 catch，直接往上抛（这是作者的取舍：
//                  让 session memory 的异常暴露出来，而不是静默降级）
//
// 注意这是"EXPERIMENT"（287 行注释），还在实验阶段。
  // EXPERIMENT: Try session memory compaction first
  const sessionMemoryResult = await trySessionMemoryCompaction(
    messages,
    toolUseContext.agentId,
    recompactionInfo.autoCompactThreshold,
  )
  if (sessionMemoryResult) {
// ⚠ 这三行是补 session memory 路径漏掉的收尾动作，注释里带一条数据：
//
//   "BQ 2026-03-01: missing this made 20% of tengu_prompt_cache_break
//    events false positives"
//
// 翻译：漏了这一步，导致 20% 的"缓存断裂"告警是误报。
//
// 原因：压缩必然会让 cache_read_input_tokens 骤降。缓存断裂检测如果不知道
// "这是我们自己压的"，就会把它当成异常上报。
// compactConversation 内部自己会调 notifyCompaction，
// 而 session memory 压缩这条路**不会**（因为它是另一套实现）。
//
// 这是"两条实现路径，其中一条忘了同步某个副作用"的经典案例。
// 也解释了为什么通知要放在调用方（这里）而不是实现里 ——
// 虽然这里恰恰是因为放调用方而漏了一处。
    // Reset lastSummarizedMessageId since session memory compaction prunes messages
    // and the old message UUID will no longer exist after the REPL replaces messages
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    // Reset cache read baseline so the post-compact drop isn't flagged as a
    // break. compactConversation does this internally; SM-compact doesn't.
    // BQ 2026-03-01: missing this made 20% of tengu_prompt_cache_break events
    // false positives (systemPromptChanged=true, timeSinceLastAssistantMsg=-1).
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
    }
    markPostCompaction()
    return {
      wasCompacted: true,
      compactionResult: sessionMemoryResult,
    }
  }

// 传统路径：发一次模型调用，把整段对话总结成摘要，替换掉原消息。
// 六个参数里有三个是布尔量，注释已经标了含义：
//
//   true       = 自动压缩，**抑制向用户提问**
//   undefined  = 没有自定义指令（/compact 时可以带）
//   true       = isAutoCompact（影响日志与策略）
//
// 第一个参数最关键：自动压缩是后台行为，绝不能弹问题给用户 ——
// 用户在写代码，突然被问"要不要保留这条消息"是不能接受的。
// 而手动 /compact 时允许提问（因为是用户主动发起的）。
  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      cacheSafeParams,
      true, // Suppress user questions for autocompact
      undefined, // No custom instructions for autocompact
      true, // isAutoCompact
      recompactionInfo,
    )

// 传统压缩会把**全部消息**换掉，所以旧的消息 UUID 全部失效。
// 必须清掉 lastSummarizedMessageId，否则下一次摘要会去引用一个
// 已经不存在的消息 id。
//
// 注意这段和 session memory 那段（294-296）做的是同一件事 ——
// 两条路径各写一遍。这是"两套实现"必然带来的重复，
// 也意味着将来加第三个路径时还会漏一次。
    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure count on success
      consecutiveFailures: 0,
    }
// 失败处理：**记日志 + 计数 + 返回 false**，不抛出。
//
// 为什么吞掉异常：自动压缩是后台行为。压缩失败不应该让用户当前的
// 请求失败 —— 大不了这一轮上下文超一点，下一轮再试（或者撞 413
// 让 reactive compact 接手）。
//
// 但有一个例外：用户主动中止（ESC）不记 error 日志。
// 那不是故障，是用户的意图，记进去会污染错误率指标。
  } catch (error) {
    if (!hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
      logError(error)
    }
    // Increment consecutive failure count for circuit breaker.
    // The caller threads this through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts.
    const prevFailures = tracking?.consecutiveFailures ?? 0
    const nextFailures = prevFailures + 1
// 三振出局，并且**明确打出 warn 日志**说明"本会话后续都不再尝试"。
//
// 注意这里只是计数，真正的"不再尝试"是下次进入函数时
// 行 260 那个检查生效的。所以这行日志的措辞是
// "skipping future attempts this session" —— 说的是未来，不是现在。
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures — skipping future attempts this session`,
        { level: 'warn' },
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
}
