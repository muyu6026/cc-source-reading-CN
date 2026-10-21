// ═══════════════════════════════════════════════════════════════
// 第 5 步 · 主循环 · 3/4 —— 会话容器（src/QueryEngine.ts）
//
// 上一份 query.ts 是「一轮对话怎么跑」：无状态，参数进、消息出。
// 这一份是「一个会话怎么管多轮」：有状态，跨 submitMessage 持久。
//
// 【三层关系，先看清楚再读】
//
//     调用方（REPL / claude -p / SDK）
//          │  只认 SDKMessage 协议
//          ▼
//     QueryEngine          ← 本文件：持会话状态 + 做类型转换
//          │  内部 Message 类型
//          ▼
//     query()              ← 上一份：跑一轮，从头到尾无状态
//
// 所以本文件的核心职责只有两个：
//   ① **状态归属**：mutableMessages、totalUsage、permissionDenials、
//      readFileState —— 这些必须活过一轮，所以不能放 query() 里。
//   ② **边界转换**：内部 Message（含 attachment / tombstone / progress /
//      stream_event 等 9 种类型）→ SDKMessage（对外协议，只有 5 种）。
//
// 【一个容易误读的地方】
// 文件名叫 QueryEngine，但它**不是** query 的引擎 —— 它是 query 的**宿主**。
// query() 才是引擎。这个名字容易让人以为里面是主循环，其实主循环在 query.ts。
//
// 【读这个文件要抓的一条主线】
// 它几乎全部代码都在做同一件事：把一个类型转换 + 更新几个计数器 + 判断
// 要不要提前终止。看下面那张 switch（行 757）就够了 —— 9 个 case，
// 只有 4 个真的 yield 东西给外面。其余都是「内部消化」。
// ═══════════════════════════════════════════════════════════════
import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import last from 'lodash-es/last.js'
import {
  getSessionId,
  isSessionPersistenceDisabled,
} from 'src/bootstrap/state.js'
import type {
  PermissionMode,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPermissionDenial,
  SDKStatus,
  SDKUserMessageReplay,
} from 'src/entrypoints/agentSdkTypes.js'
import { accumulateUsage, updateUsage } from 'src/services/api/claude.js'
import type { NonNullableUsage } from 'src/services/api/logging.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import stripAnsi from 'strip-ansi'
import type { Command } from './commands.js'
import { getSlashCommandToolSkills } from './commands.js'
import {
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from './constants/xml.js'
import {
  getModelUsage,
  getTotalAPIDuration,
  getTotalCost,
} from './cost-tracker.js'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import { loadMemoryPrompt } from './memdir/memdir.js'
import { hasAutoMemPathOverride } from './memdir/paths.js'
import { query } from './query.js'
import { categorizeRetryableAPIError } from './services/api/errors.js'
import type { MCPServerConnection } from './services/mcp/types.js'
import type { AppState } from './state/AppState.js'
import { type Tools, type ToolUseContext, toolMatchesName } from './Tool.js'
import type { AgentDefinition } from './tools/AgentTool/loadAgentsDir.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from './tools/SyntheticOutputTool/SyntheticOutputTool.js'
import type { Message } from './types/message.js'
import type { OrphanedPermission } from './types/textInputTypes.js'
import { createAbortController } from './utils/abortController.js'
import type { AttributionState } from './utils/commitAttribution.js'
import { getGlobalConfig } from './utils/config.js'
import { getCwd } from './utils/cwd.js'
import { isBareMode, isEnvTruthy } from './utils/envUtils.js'
import { getFastModeState } from './utils/fastMode.js'
import {
  type FileHistoryState,
  fileHistoryEnabled,
  fileHistoryMakeSnapshot,
} from './utils/fileHistory.js'
import {
  cloneFileStateCache,
  type FileStateCache,
} from './utils/fileStateCache.js'
import { headlessProfilerCheckpoint } from './utils/headlessProfiler.js'
import { registerStructuredOutputEnforcement } from './utils/hooks/hookHelpers.js'
import { getInMemoryErrors } from './utils/log.js'
import { countToolCalls, SYNTHETIC_MESSAGES } from './utils/messages.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from './utils/model/model.js'
import { loadAllPluginsCacheOnly } from './utils/plugins/pluginLoader.js'
import {
  type ProcessUserInputContext,
  processUserInput,
} from './utils/processUserInput/processUserInput.js'
import { fetchSystemPromptParts } from './utils/queryContext.js'
import { setCwd } from './utils/Shell.js'
import {
  flushSessionStorage,
  recordTranscript,
} from './utils/sessionStorage.js'
import { asSystemPrompt } from './utils/systemPromptType.js'
import { resolveThemeSetting } from './utils/systemTheme.js'
import {
  shouldEnableThinkingByDefault,
  type ThinkingConfig,
} from './utils/thinking.js'

// ── 1. 一个"延迟到用时才加载"的模块 ──
// 注释说得很直白：MessageSelector.tsx 会拉进 React/ink（整个终端 UI 渲染栈），
// 而这里只需要它里面的一个过滤函数。
// 如果顶层 import，headless 模式（claude -p）也会被迫加载整套 React。
// ═══════════════════════════════════════════════════════════════
// Lazy: MessageSelector.tsx pulls React/ink; only needed for message filtering at query time
/* eslint-disable @typescript-eslint/no-require-imports */
const messageSelector =
  (): typeof import('src/components/MessageSelector.js') =>
    require('src/components/MessageSelector.js')
// 注：注意这个写法的形状 —— 它是一个**函数**，不是常量：
//         const messageSelector = () => require('src/components/MessageSelector.js')
//     每次调用 messageSelector() 才 require 一次（Node 的 require 有缓存，
//     第二次是查表，几乎无成本）。
//
//     为什么不用 `import()` 动态导入？因为 import() 返回 Promise，
//     而这里的调用点（行 471、643）都在同步代码里（filter 的回调）。
//     require 是同步的，import() 不是。这就是为什么必须用 require。
//
//     这也是文件里三处 `/* eslint-disable no-require-imports */` 之一，
//     另外两处是条件导入（行 111、121）。三种 require 的用途完全不同：
//       · 行 87  → 延迟加载重模块（避免 headless 拉 React）
//       · 行 115 → 条件导入（DCE）
//       · 行 122 → 条件导入（DCE）

import {
  localCommandOutputToSDKAssistantMessage,
  toSDKCompactMetadata,
} from './utils/messages/mappers.js'
import {
  buildSystemInitMessage,
  sdkCompatToolName,
} from './utils/messages/systemInit.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from './utils/permissions/filesystem.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  handleOrphanedPermission,
  isResultSuccessful,
  normalizeMessage,
} from './utils/queryHelpers.js'

// ── 2. 条件导入的两种写法，对比着看 ──
// Dead code elimination: conditional import for coordinator mode
/* eslint-disable @typescript-eslint/no-require-imports */
const getCoordinatorUserContext: (
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
) => { [k: string]: string } = feature('COORDINATOR_MODE')
  ? require('./coordinator/coordinatorMode.js').getCoordinatorUserContext
  : () => ({})
// 注：这一段和下面行 122 的 snipModule 是**同一个模式**，但写法不同，
//     值得对比：
//
//     【写法 A：带兜底函数】（这里）
//         const getCoordinatorUserContext: (…) => {…} = feature('COORDINATOR_MODE')
//           ? require('./coordinator/coordinatorMode.js').getCoordinatorUserContext
//           : () => ({})
//     特征：类型标注写在变量上（因为两条分支类型不同，要显式收窄），
//           兜底是一个**空实现**而不是 null。
//     好处：调用点不用判空，直接 `getCoordinatorUserContext(mcpClients, ...)`
//           就行（行 304）。外部版里它就是返回空对象的函数，零成本。
//
//     【写法 B：null 兜底】（行 122）
//         const snipModule = feature('HISTORY_SNIP')
//           ? (require(...) as typeof import(...))
//           : null
//     特征：用 `as typeof import(...)` 保留类型，兜底是 null。
//     代价：每个调用点都要判空（`snipModule!.snipCompactIfNeeded`）。
//
//     什么时候用 A、什么时候用 B？看「不启用时该怎么表现」：
//       · 协调器模式不启用 → 就当没这个上下文，返回空对象（A 合适）
//       · snip 不启用 → 整个功能不存在，不该被调用（B 合适，能暴露误用）
//     这个选择标准很实用：**兜底是"空行为"用 A，兜底是"不该发生"用 B。**
/* eslint-enable @typescript-eslint/no-require-imports */

// Dead code elimination: conditional import for snip compaction
/* eslint-disable @typescript-eslint/no-require-imports */
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import('./services/compact/snipCompact.js'))
  : null
const snipProjection = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipProjection.js') as typeof import('./services/compact/snipProjection.js'))
  : null
// ── 3.1 一个字段的注释比代码还长：snipReplay ──
/* eslint-enable @typescript-eslint/no-require-imports */

// ═══════════════════════════════════════════════════════════════
// ── 3. QueryEngineConfig：25 个字段的配置对象 ──
// 这个类型就是「一次会话需要从外部拿到什么」的完整清单。
// 注意它和 query.ts 的 QueryParams 的区别：
//   QueryParams      → 一轮请求要什么（13 个字段）
//   QueryEngineConfig → 整个会话要什么（25 个字段）
//   前者是后者的子集，后者多出来的是「跨轮持久」的东西。
// ═══════════════════════════════════════════════════════════════
export type QueryEngineConfig = {
  cwd: string
  tools: Tools
  commands: Command[]
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  initialMessages?: Message[]
  readFileCache: FileStateCache
  customSystemPrompt?: string
  appendSystemPrompt?: string
  userSpecifiedModel?: string
  fallbackModel?: string
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  taskBudget?: { total: number }
  jsonSchema?: Record<string, unknown>
  verbose?: boolean
  replayUserMessages?: boolean
  /** Handler for URL elicitations triggered by MCP tool -32042 errors. */
  handleElicitation?: ToolUseContext['handleElicitation']
  includePartialMessages?: boolean
  setSDKStatus?: (status: SDKStatus) => void
  abortController?: AbortController
  orphanedPermission?: OrphanedPermission
  /**
   * Snip-boundary handler: receives each yielded system message plus the
   * current mutableMessages store. Returns undefined if the message is not a
   * snip boundary; otherwise returns the replayed snip result. Injected by
   * ask() when HISTORY_SNIP is enabled so feature-gated strings stay inside
   * the gated module (keeps QueryEngine free of excluded strings and testable
   * despite feature() returning false under bun test). SDK-only: the REPL
   * keeps full history for UI scrollback and projects on demand via
   * projectSnippedView; QueryEngine truncates here to bound memory in long
   * headless sessions (no UI to preserve).
   */
  snipReplay?: (
    yieldedSystemMsg: Message,
    store: Message[],
  ) => { messages: Message[]; executed: boolean } | undefined
}
// 译：Snip 边界处理器：接收每条被 yield 的 system 消息 + 当前可变的
//     messages 存储。如果不是 snip 边界就返回 undefined；否则返回重放后的
//     snip 结果。由 ask() 在 HISTORY_SNIP 启用时注入，这样特性门控的
//     字符串就留在被门控的模块里（让 QueryEngine 不含被排除的字符串，
//     且在 bun test 下 feature() 返回 false 时仍然可测）。
//     仅 SDK 路径：REPL 保留完整历史用于 UI 滚动回溯，按需通过
//     projectSnippedView 投影；QueryEngine 在这里截断，是为了在长
//     headless 会话里限制内存（没有 UI 要保留）。
//
// 注：这个字段的设计理由有四层，一层比一层具体，值得逐层拆：
//
//     ① 【职责倒置】为什么 snip 逻辑不写在本文件里？
//        因为本文件要能通过「被排除字符串」检查（excluded-strings check）——
//        这是个构建期检查：外部版 bundle 里不许出现内部特性相关的字符串。
//        如果本文件直接写 `if (feature('HISTORY_SNIP'))`，
//        字符串 'HISTORY_SNIP' 就进了本文件，检查会失败。
//        解法：把判断逻辑塞进回调，由 ask() 在 feature 为 true 时才注入。
//        这样本文件只有 `this.config.snipReplay?.(...)`，不带任何特性名。
//
//     ② 【为什么不用 import 而是回调注入】
//        回调注入让本文件对 HISTORY_SNIP 完全无感知 ——
//        它只知道「有个可选的回调能处理 system 消息」。
//        这比 import 更彻底：import 至少要写模块路径（也是字符串）。
//
//     ③ 【REPL 和 SDK 的差异】
//        REPL 要保留完整历史（用户能往上滚），所以不能真删。
//        SDK/headless 没有 UI，删了能省内存。
//        所以「截断」这个动作只对 SDK 路径做 —— 这就是为什么
//        snipReplay 只在 ask() 里注入（行 1276-1284），
//        而不在 REPL 的调用路径里注入。
//
//     ④ 【可测性】
//        bun test 下 `feature()` 返回 false，所以如果不注入回调，
//        这段逻辑在测试里完全跑不到。用回调注入后，测试可以传一个
//        假回调来覆盖这条路径 —— 这是「为了让代码可测而改变设计」的例子。
//
//     这四条合起来，是「一个字段为什么要存在」的完整答案。
//     本文件里没有第二个字段有这么长的注释，因为它是唯一一个
//     「设计动机跨了构建期、运行时、两条产品路径、测试」的字段。

// ═══════════════════════════════════════════════════════════════
// ── 4. 类的定位（这段注释是官方说明，先读它） ──
// ═══════════════════════════════════════════════════════════════
/**
 * QueryEngine owns the query lifecycle and session state for a conversation.
 * It extracts the core logic from ask() into a standalone class that can be
 * used by both the headless/SDK path and (in a future phase) the REPL.
 *
 * One QueryEngine per conversation. Each submitMessage() call starts a new
 * turn within the same conversation. State (messages, file cache, usage, etc.)
 * persists across turns.
 */
// 译：QueryEngine 拥有一次对话的 query 生命周期与会话状态。
//     它把核心逻辑从 ask() 里抽出来，成为一个独立类，
//     以便 headless/SDK 路径和（未来阶段的）REPL 都能用。
//
//     一个对话一个 QueryEngine。每次 submitMessage() 调用在同一对话内
//     开启新的一个 turn。状态（messages、文件缓存、用量等）跨 turn 持久。
//
// 注：注意三句话里的三个关键信息：
//
//     ① "extracts the core logic from ask()" —— 这是**重构产物**。
//        原来 ask() 是一个巨型函数（可能就是上一个文件 query.ts 的前身），
//        后来把「会话状态 + 类型转换」抽成类，ask() 变成薄包装（行 1186）。
//        这个演化路径很典型：函数太长 → 抽出状态 → 变成类 → 原函数变门面。
//
//     ② "and (in a future phase) the REPL" —— REPL 还没用上。
//        这是个**未完成的迁移**：现在只有 headless/SDK 走 QueryEngine，
//        REPL 还是自己管状态。所以本文件里很多地方写着「SDK 路径怎么做」，
//        潜台词是「REPL 路径在别处做，而且做法不同」。
//        行 164-167 的 snipReplay 注释就是这个差异的直接证据。
//
//     ③ "One QueryEngine per conversation" —— 一个会话一个实例。
//        这意味着：/clear（清空对话）= 新建实例；
//        --resume（恢复会话）= 用 initialMessages 装满再复用。
//        而「一次 submitMessage」才是 query() 的一次调用。
//        所以实例生命周期 : query() 调用 = 1 : N。
export class QueryEngine {
// 注：注意类是 `export class`，而 `ask()` 是 `export async function*`。
//     两个出口，两种使用方式：
//       多轮场景 → new QueryEngine(config)，然后反复 submitMessage
//       一次性   → ask({...})，内部 new 一个用完就丢（行 1249）
//     ask() 存在纯粹是为了「不用管状态」的调用方（脚本、单次查询）。
//
//     还有个细节：类没有实现任何接口，也没被继承。它是一个**封闭的**类 ——
//     这说明它的「可替换性」不是设计目标，只是被抽出来复用。
//     如果哪天要支持第二种引擎（比如换一个 provider），
//     大概会先抽一个 interface 再让这个类实现。
  private config: QueryEngineConfig
// ── 5. 六个私有字段：会话状态的完整清单 ──
  private mutableMessages: Message[]
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage
  private hasHandledOrphanedPermission = false
  private readFileState: FileStateCache
  // Turn-scoped skill discovery tracking (feeds was_discovered on
  // tengu_skill_tool_invocation). Must persist across the two
  // processUserInputContext rebuilds inside submitMessage, but is cleared
  // at the start of each submitMessage to avoid unbounded growth across
  // many turns in SDK mode.
  private discoveredSkillNames = new Set<string>()
  private loadedNestedMemoryPaths = new Set<string>()
// 注：七个字段（含行 197 的两个 Set），分成三类：
//
//   【跨 submitMessage 持久】
//     config              → 配置（行 1175 的 setModel 会改它）
//     mutableMessages     → **完整对话历史**（最重要的一个）
//     abortController     → 取消句柄（跨轮复用！所以一次中断会杀掉整个会话）
//     readFileState       → 文件读取缓存（跨轮累积，避免重复读盘）
//     totalUsage          → 累计 token 用量（result 消息里报这个）
//
//   【每次 submitMessage 重置】
//     permissionDenials   → 构造函数里初始化（行 204），但注意：
//                           **它从不清空**！见下面那条批注。
//     hasHandledOrphanedPermission → 一次性标志，整个生命周期只处理一次
//
//   【每轮清理，但跨两次 context 重建持久】
//     discoveredSkillNames → 行 193-196 的注释解释了为什么需要它：
//                            submitMessage 内部要重建两次
//                            processUserInputContext（行 335、492），
//                            这个 Set 必须在两次之间存活，
//                            但每个 submitMessage 开头要 clear()（行 238）
//                            以免 SDK 模式多轮后无限增长。
//
//   ⚠ 一个值得注意的现象：`permissionDenials` 在构造函数里设为 []
//     （每实例一次），但 submitMessage 里没有清空。
//     所以第二次 submitMessage 的 result.permission_denials
//     会包含第一次的拒绝记录。这可能是 bug，也可能是刻意的
//     （SDK 调用方想知道「这个会话一共被拒过什么」）。
//     从字段名（复数、无 turn 前缀）看，倾向于是刻意的累积语义 ——
//     但和 `totalUsage`（也累积）不同，它没有注释说明。

// ── 6. 构造函数：四行，但有两处默认值值得注意 ──
  constructor(config: QueryEngineConfig) {
    this.config = config
    this.mutableMessages = config.initialMessages ?? []
    this.abortController = config.abortController ?? createAbortController()
    this.permissionDenials = []
    this.readFileState = config.readFileCache
    this.totalUsage = EMPTY_USAGE
  }
// 注：四个默认值：
//       config.initialMessages ?? []        → 空会话（--resume 时由调用方填）
//       config.abortController ?? createAbortController()
//                                           → 外部可以注入，这样调用方能
//                                             在 submitMessage 之外取消
//                                              （比如 SIGINT 处理器）
//       readFileState = config.readFileCache → **注意是直接赋值，不是克隆**
//       totalUsage = EMPTY_USAGE            → 共享的冻结常量
//
//     第二、三行有个对比：abortController 用了 `??` 兜底，
//     而 readFileCache 是必填字段（类型里没有 `?`）。为什么？
//     因为 abort 可以在任何时候发生（包括还没开始跑），
//     而文件缓存一定是调用方已经建好的（它要跨 session 复用）。
//
//     第三行「直接赋值不克隆」值得留意：ask() 里传进来的是
//     `cloneFileStateCache(getReadFileCache())`（行 1259），
//     所以**克隆发生在 ask() 里，不在构造函数里**。
//     这意味着直接 new QueryEngine 的调用方必须自己负责克隆 ——
//     否则两个引擎会共享同一个缓存对象。
//     构造函数不克隆是个有意的选择（避免双重克隆），但把责任
//     推给了调用方，是个隐式契约。

// ═══════════════════════════════════════════════════════════════
// ── 7. submitMessage：整个类的全部逻辑（约 950 行）──
//
// 返回类型 `AsyncGenerator<SDKMessage, void, unknown>` 和 query() 不同：
//     query()        → AsyncGenerator<内部消息, Terminal, unknown>
//     submitMessage  → AsyncGenerator<SDKMessage, void, unknown>
// 两个区别：产出的是 SDKMessage（对外协议），返回的是 void（不暴露终止原因）。
// **内部的控制流细节（Terminal）在这里被吞掉了** —— 对外只说
// 「成功了还是失败了」，不说「因为 max_output_tokens 恢复失败而终止」。
// ═══════════════════════════════════════════════════════════════
  async *submitMessage(
    prompt: string | ContentBlockParam[],
    options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<SDKMessage, void, unknown> {
// ═══════════════════════════════════════════════════════════════
// ── 8. 18 个字段的解构：一次把配置全摊开 ──
//
// 为什么在这里全解构，而不是用 `this.config.xxx`？
// 因为下面 950 行里要反复用这些值，而且有大量 `this.` 会淹没视觉重点。
// 解构成裸名后，`this.` 只出现在「改状态」的地方（this.mutableMessages、
// this.permissionDenials）—— 一眼就能分辨「读配置」和「写状态」。
// ═══════════════════════════════════════════════════════════════
    const {
      cwd,
      commands,
      tools,
      mcpClients,
      verbose = false,
      thinkingConfig,
      maxTurns,
      maxBudgetUsd,
      taskBudget,
      canUseTool,
      customSystemPrompt,
      appendSystemPrompt,
      userSpecifiedModel,
      fallbackModel,
      jsonSchema,
      getAppState,
      setAppState,
      replayUserMessages = false,
      includePartialMessages = false,
      agents = [],
      setSDKStatus,
      orphanedPermission,
    } = this.config

    this.discoveredSkillNames.clear()
// 注：`this.discoveredSkillNames.clear()` 放在最前面 ——
//     这行是行 193-196 那条注释的落点：每轮清空，避免 SDK 模式
//     几百轮之后这个 Set 无限膨胀。
//
//     `setCwd(cwd)` 是个**全局副作用** —— 设置进程级的工作目录。
//     为什么需要它？因为工具实现（BashTool、Read 等）大量使用
//     getCwd() 而不是参数传入。所以每轮开始都要重新对齐，
//     否则并发多会话（SDK 里可能同时跑好几个）会互相踩。
//     ⚠ 注意这也意味着 QueryEngine **不是线程安全的** ——
//     两个引擎的 submitMessage 交错执行时，cwd 会被来回改。
//     在 Node 单线程模型下，「交错」只发生在 await 边界，
//     而工具执行前会重新读 cwd —— 所以实践中能工作，但很脆弱。
    setCwd(cwd)
    const persistSession = !isSessionPersistenceDisabled()
    const startTime = Date.now()

// ── 9. 包装 canUseTool：为了收集"被拒了哪些工具" ──
    // Wrap canUseTool to track permission denials
    const wrappedCanUseTool: CanUseToolFn = async (
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseID,
      forceDecision,
    ) => {
      const result = await canUseTool(
        tool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseID,
        forceDecision,
      )

      // Track denials for SDK reporting
      if (result.behavior !== 'allow') {
        this.permissionDenials.push({
          tool_name: sdkCompatToolName(tool.name),
          tool_use_id: toolUseID,
          tool_input: input,
        })
      }

      return result
    }
// 注：这个包装只做一件事：把每次「非 allow」的决策记下来，
//     最后塞进 result.permission_denials 报给 SDK 调用方。
//
//     为什么 SDK 需要这个？因为 headless 模式下没人能点「允许」——
//     canUseTool 的实现在 SDK 里通常是「一律 deny」或「按预设规则判断」。
//     如果不报告拒绝记录，调用方只会看到「模型说要读文件，然后什么都没发生」，
//     完全不知道是被权限拦了。这条数据是唯一的诊断线索。
//
//     注意 `result.behavior !== 'allow'` 用的是「不等于 allow」而不是
//     「等于 deny」—— 因为 PermissionResult 的行为是联合类型，
//     除了 allow/deny 可能还有 'ask' 等。用否定判断能覆盖未来新增的行为。
//     这是防御性写法：**枚举白名单用 ===，黑名单用 !==**。
//
//     `sdkCompatToolName(tool.name)` 做了一次名字映射 ——
//     内部工具名可能带前缀或别名，对外要统一。这是边界转换的一部分。

// ── 10. 模型与 thinking 的默认值 ──
    const initialAppState = getAppState()
    const initialMainLoopModel = userSpecifiedModel
      ? parseUserSpecifiedModel(userSpecifiedModel)
      : getMainLoopModel()

    const initialThinkingConfig: ThinkingConfig = thinkingConfig
      ? thinkingConfig
      : shouldEnableThinkingByDefault() !== false
        ? { type: 'adaptive' }
        : { type: 'disabled' }
// 注：`thinkingConfig` 的三层兜底：
//      ① 调用方显式传了 → 用它
//      ② 没传但 shouldEnableThinkingByDefault() 不返回 false → { type: 'adaptive' }
//      ③ 否则 → { type: 'disabled' }
//
//     注意 ② 的判断是 `!== false` 而不是 `=== true`。
//     区别在于 `undefined`：如果函数返回 undefined，
//     `!== false` 会走 adaptive 分支。也就是「默认开」。
//     这个细节说明作者想让 thinking 默认启用 —— 用 `!== false`
//     能让「返回 undefined 的旧实现」自动获得新行为。
//
//     'adaptive' 是第三种状态（不是 on/off）：让模型自己决定要不要思考。
//     这解释了为什么默认是 adaptive 而不是 enabled ——
//     强制思考会让简单问题变慢变贵。

// ── 11. 系统提示词的三段式拼装 ──
    headlessProfilerCheckpoint('before_getSystemPrompt')
    // Narrow once so TS tracks the type through the conditionals below.
    const customPrompt =
      typeof customSystemPrompt === 'string' ? customSystemPrompt : undefined
    const {
      defaultSystemPrompt,
      userContext: baseUserContext,
      systemContext,
    } = await fetchSystemPromptParts({
      tools,
      mainLoopModel: initialMainLoopModel,
      additionalWorkingDirectories: Array.from(
        initialAppState.toolPermissionContext.additionalWorkingDirectories.keys(),
      ),
      mcpClients,
      customSystemPrompt: customPrompt,
    })
    headlessProfilerCheckpoint('after_getSystemPrompt')
    const userContext = {
      ...baseUserContext,
      ...getCoordinatorUserContext(
        mcpClients,
        isScratchpadEnabled() ? getScratchpadDir() : undefined,
      ),
    }
// 注：`fetchSystemPromptParts` 返回三样东西：
//       defaultSystemPrompt → 静态提示词（上一份文件 prompts.ts 的产出）
//       baseUserContext     → 用户上下文（拼在 user 消息前面）
//       systemContext       → 系统上下文（拼在系统提示词后面）
//
//     区分 userContext 和 systemContext 是缓存设计的一部分：
//     userContext 进 **user 消息**（每轮都可能变），
//     systemContext 进 **系统提示词尾部**（在 boundary marker 之后）。
//     两者都不进「可全局缓存的前缀」。
//
//     行 285 那句 `// Narrow once so TS tracks the type through the conditionals below`
//     解释了一个 TypeScript 使用技巧：把 `string | undefined` 收窄成
//     一个局部变量，这样下面多个 if 里都能保持收窄结果。
//     直接在 if 里写 `typeof customSystemPrompt === 'string'`，
//     出了 if 又变回宽类型了。
//
//     行 302-308 把 getCoordinatorUserContext 的结果合并进 userContext。
//     注意它排在 baseUserContext **之后**（展开顺序决定覆盖关系）——
//     协调器模式可以覆盖默认上下文。

// ── 12. 记忆机制提示词：一个"三重门"的注入 ──
    // When an SDK caller provides a custom system prompt AND has set
    // CLAUDE_COWORK_MEMORY_PATH_OVERRIDE, inject the memory-mechanics prompt.
    // The env var is an explicit opt-in signal — the caller has wired up
    // a memory directory and needs Claude to know how to use it (which
    // Write/Edit tools to call, MEMORY.md filename, loading semantics).
    // The caller can layer their own policy text via appendSystemPrompt.
    const memoryMechanicsPrompt =
      customPrompt !== undefined && hasAutoMemPathOverride()
        ? await loadMemoryPrompt()
        : null
// 译：当 SDK 调用方提供了自定义系统提示词**且**设了
//     CLAUDE_COWORK_MEMORY_PATH_OVERRIDE 时，注入记忆机制提示词。
//     这个环境变量是显式的选择加入信号 —— 调用方已经配好了一个
//     记忆目录，需要 Claude 知道怎么用它（调哪个 Write/Edit 工具、
//     MEMORY.md 这个文件名、加载语义）。调用方可以通过
//     appendSystemPrompt 叠加自己的策略文本。
//
// 注：三个条件缺一不可：
//       customPrompt !== undefined     调用方给了自己的提示词
//       hasAutoMemPathOverride()       环境变量设了记忆路径
//       （隐含）loadMemoryPrompt() 能返回内容
//
//     为什么必须「调用方给了自定义提示词」才注入？
//     因为如果用的是默认提示词，loadMemoryPrompt() 已经在
//     fetchSystemPromptParts 内部被调过了（见上一份文件行 495 的
//     systemPromptSection('memory', ...)）。这里注入会造成**重复**。
//
//     也就是说：这个 if 是在处理「默认路径不会走到」的补丁场景 ——
//     用户替换了整个提示词，连带把默认记忆段也替换掉了，
//     但他其实还需要记忆能力。所以要用环境变量显式提醒「我要记忆」。

    const systemPrompt = asSystemPrompt([
// 注：三段拼接，顺序决定优先级（靠前的更"基础"）：
//       customPrompt 或 defaultSystemPrompt  → 二选一，不是叠加
//       memoryMechanicsPrompt               → 记忆机制说明
//       appendSystemPrompt                  → 调用方追加的策略
//
//     注意第一项是**替换**而不是追加 —— 这就是「自定义系统提示词」
//     的真实语义：它替换掉整个默认提示词，而不是在后面加一段。
//     很多人会误以为 customSystemPrompt 是「加在默认提示词后面」，
//     实际是「完全接管」。这个歧义在 API 设计上是有代价的，
//     但它让调用方能精确控制（比如只要一个极简的 10 行提示词）。
//
//     `asSystemPrompt([...])` 把数组 brand 成 SystemPrompt 类型。
//     数组形式（而不是单个字符串）是为了保持分段结构 ——
//     下游要按段打 cache_control（见上一份文件行 114 的边界标记）。
      ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
      ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ])

// ── 13. 结构化输出的强制钩子 ──
    // Register function hook for structured output enforcement
    const hasStructuredOutputTool = tools.some(t =>
      toolMatchesName(t, SYNTHETIC_OUTPUT_TOOL_NAME),
    )
    if (jsonSchema && hasStructuredOutputTool) {
      registerStructuredOutputEnforcement(setAppState, getSessionId())
    }
// 注：两个条件：
//       jsonSchema            调用方要求结构化输出
//       hasStructuredOutputTool 工具列表里真的有那个合成工具
//
//     第二个条件为什么必要？因为 jsonSchema 是调用方的要求，
//     而工具是调用方传进来的。如果传了 schema 但没传工具，
//     这个钩子注册了也没用（没有工具可以拦截）。
//     条件齐全才注册，避免注册一个空转的钩子。
//
//     `registerStructuredOutputEnforcement(setAppState, getSessionId())`
//     —— 注意它拿到的是 setAppState 和 sessionId，说明钩子实现
//     需要一个可写的状态和一个身份标识。这是个**全局注册**（不是实例级），
//     所以同一个进程里多次注册可能会叠加 —— 这是潜在风险，
//     但因为有 hasStructuredOutputTool 守门，实际很少触发。

// ═══════════════════════════════════════════════════════════════
// ── 14. 第一处 processUserInputContext（注意 setMessages 的注释） ──
//
// 这个对象要建**两次**（行 335 和行 492）。为什么？
// 因为 processUserInput 可能执行斜杠命令，而斜杠命令会改消息数组、
// 改模型。所以第一次建是为了「让命令能执行」，第二次建是为了
// 「反映命令执行后的状态」。
// ═══════════════════════════════════════════════════════════════
    let processUserInputContext: ProcessUserInputContext = {
      messages: this.mutableMessages,
      // Slash commands that mutate the message array (e.g. /force-snip)
      // call setMessages(fn).  In interactive mode this writes back to
      // AppState; in print mode we write back to mutableMessages so the
      // rest of the query loop (push at :389, snapshot at :392) sees
      // the result.  The second processUserInputContext below (after
      // slash-command processing) keeps the no-op — nothing else calls
      // setMessages past that point.
// 译：会修改消息数组的斜杠命令（比如 /force-snip）会调用
//     setMessages(fn)。交互模式下这会写回 AppState；
//     print 模式（headless）下我们写回 mutableMessages，
//     这样 query 循环的其余部分（行 389 的 push、行 392 的快照）
//     就能看到结果。下面第二个 processUserInputContext（斜杠命令
//     处理之后）保持空操作 —— 那之后没有别的地方调 setMessages。
//
// 注：这段注释精确到行号（「push at :389, snapshot at :392」），
//     而那两行号指的是**改动前**的版本 —— 现在代码已经移位了。
//     这是个很常见的注释腐坏：行号引用会随着代码改动失效。
//     读到这里不要去找 :389，它已经不在了。
//     （这类问题在本项目的其他注释里也有，比如 query.ts 里
//       "query.ts:1192" 的引用。属于可接受的成本 ——
//       留行号比不留强，因为至少能定位到大致区域。）
//
//     语义上，这个 setMessages 的差别很关键：
//       交互模式：状态在 AppState 里，写回去，UI 会重渲染
//       headless：状态就是 this.mutableMessages，直接改字段
//     同一个接口，两种实现，靠注入不同的闭包来区分 ——
//     这是「同一个类服务两条产品路径」的具体代价。
      setMessages: fn => {
        this.mutableMessages = fn(this.mutableMessages)
      },
      onChangeAPIKey: () => {},
      handleElicitation: this.config.handleElicitation,
      options: {
        commands,
        debug: false, // we use stdout, so don't want to clobber it
// 注：`debug: false, // we use stdout, so don't want to clobber it`
//     —— headless 模式下 stdout 是**协议通道**（SDKMessage 往那儿写），
//     如果 debug 日志也往 stdout 写，会把 JSON 流污染掉，调用方解析就崩了。
//
//     这是「CLI 既是程序又是库」的经典矛盾：
//       作为程序：日志打到 stdout 很正常
//       作为库：stdout 必须留给数据，日志只能走 stderr 或文件
//     这里选了后者，代价是 headless 模式的调试信息默认不可见
//     （要 --debug 或看日志文件）。
        tools,
        verbose,
        mainLoopModel: initialMainLoopModel,
        thinkingConfig: initialThinkingConfig,
        mcpClients,
        mcpResources: {},
        ideInstallationStatus: null,
        isNonInteractiveSession: true,
// 注：`isNonInteractiveSession: true` —— 硬编码 true，不是配置项。
//     因为 QueryEngine 只服务 headless/SDK 路径（行 178 的注释说了
//     REPL 还没接进来）。这个字段会一路传到 prompts.ts 的
//     getIsNonInteractiveSession()，影响提示词里的若干判断
//     （比如「建议用户输入 ! 命令」那条会被跳过）。
//
//     所以这行不只是个标志位 —— 它决定了**整个系统提示词的会话类型分支**。
        customSystemPrompt,
        appendSystemPrompt,
        agentDefinitions: { activeAgents: agents, allAgents: [] },
        theme: resolveThemeSetting(getGlobalConfig().theme),
        maxBudgetUsd,
      },
      getAppState,
      setAppState,
      abortController: this.abortController,
      readFileState: this.readFileState,
      nestedMemoryAttachmentTriggers: new Set<string>(),
      loadedNestedMemoryPaths: this.loadedNestedMemoryPaths,
      dynamicSkillDirTriggers: new Set<string>(),
      discoveredSkillNames: this.discoveredSkillNames,
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: (
        updater: (prev: FileHistoryState) => FileHistoryState,
      ) => {
        setAppState(prev => {
          const updated = updater(prev.fileHistory)
          if (updated === prev.fileHistory) return prev
          return { ...prev, fileHistory: updated }
        })
      },
      updateAttributionState: (
        updater: (prev: AttributionState) => AttributionState,
      ) => {
        setAppState(prev => {
          const updated = updater(prev.attribution)
          if (updated === prev.attribution) return prev
          return { ...prev, attribution: updated }
        })
      },
      setSDKStatus,
    }

// ── 15. 孤儿权限：一次会话只处理一次 ──
    // Handle orphaned permission (only once per engine lifetime)
    if (orphanedPermission && !this.hasHandledOrphanedPermission) {
      this.hasHandledOrphanedPermission = true
      for await (const message of handleOrphanedPermission(
        orphanedPermission,
        tools,
        this.mutableMessages,
        processUserInputContext,
      )) {
        yield message
      }
    }
// 注：孤儿权限是什么？是指「上一次会话结束时有工具调用在等权限批准，
//     但会话被杀了」—— 恢复时这条权限请求还挂着，需要处理掉。
//
//     `!this.hasHandledOrphanedPermission` 保证整个引擎生命周期
//     （不是一个 turn）只处理一次。所以这个 if 之外还置了
//     `this.hasHandledOrphanedPermission = true`（行 399）——
//     注意顺序：**先置位再处理**。
//     如果先处理后置位，处理过程中抛异常就会导致下次重试 ——
//     那是好事还是坏事？这里是选了「不重试」（先置位），
//     说明作者认为这个操作不值得重试（重试可能产生重复消息）。
//
//     `for await (const message of handleOrphanedPermission(...))` ——
//     它也是个生成器，产出的消息直接转发出去。这是本文件里
//     第三个「生成器套生成器」的地方（前两个：yield* normalizeMessage
//     和 yield* engine.submitMessage）。

// ── 16. processUserInput：把用户输入变成消息 ──
    const {
      messages: messagesFromUserInput,
      shouldQuery,
      allowedTools,
      model: modelFromUserInput,
      resultText,
    } = await processUserInput({
      input: prompt,
      mode: 'prompt',
      setToolJSX: () => {},
      context: {
        ...processUserInputContext,
        messages: this.mutableMessages,
      },
      messages: this.mutableMessages,
      uuid: options?.uuid,
      isMeta: options?.isMeta,
      querySource: 'sdk',
    })
// 注：返回五个东西，每个都有用途：
//       messages         → 要 push 进历史的（用户消息 + 附件）
//       shouldQuery      → **要不要调模型**（斜杠命令可能就是纯本地的）
//       allowedTools     → 命令执行后新增的 allow 规则
//       model            → 命令可能改了模型（比如 /model）
//       resultText       → 本地命令的输出文本
//
//     `shouldQuery` 是这里的关键分支点：行 556 的
//     `if (!shouldQuery)` 直接走「本地命令」路径，完全不调 API。
//     所以 /help、/clear 这类命令是**零 API 成本**的 —— 它们不进入
//     query()，只在本函数里处理完就返回 result。
//
//     注意传了 `querySource: 'sdk'` —— 硬编码。这个值会出现在所有
//     遥测事件里，也能从 query.ts 的 `querySource !== 'compact'` 之类
//     判断里区分路径。

    // Push new messages, including user input and any attachments
// 注：`this.mutableMessages.push(...messagesFromUserInput)` —— 先落历史，
//     再做快照（行 434 的 `const messages = [...this.mutableMessages]`）。
//
//     为什么要快照？因为这个数组要传给多个地方：
//       · recordTranscript(messages)    —— 落盘
//       · query({ messages, ... })      —— 本轮输入
//       · messages.findLast(...)        —— 最后一条结果提取
//     如果都传 this.mutableMessages，中途被改（query 的 for await 里
//     会 push 新消息，见行 716）就会读到变化中的数组。
//     快照把「本轮开始时的历史」固化下来。
//
//     ⚠ 但注意：`messages` 这个局部数组在行 716 也被 push 了
//     （`messages.push(message)`）—— 所以它不是纯快照，而是
//     「本轮累积的消息序列」。真正的语义是：「这一轮要落盘的全部消息」。
//     命名有点误导，实际是 transcript 累积器。
    this.mutableMessages.push(...messagesFromUserInput)

    // Update params to reflect updates from processing /slash commands
    const messages = [...this.mutableMessages]

// ═══════════════════════════════════════════════════════════════
// ── 17. 全文最值钱的一段注释：为什么要在进入 query 之前落盘 ──
//
// 这段注释记录了一个真实的、能被用户直接感知到的事故：
// 「发完消息立刻点 Stop，然后 --resume 报 No conversation found」。
// 值得完整读完，它是「时序决定可用性」的典型案例。
// ═══════════════════════════════════════════════════════════════
    // Persist the user's message(s) to transcript BEFORE entering the query
    // loop. The for-await below only calls recordTranscript when ask() yields
    // an assistant/user/compact_boundary message — which doesn't happen until
    // the API responds. If the process is killed before that (e.g. user clicks
    // Stop in cowork seconds after send), the transcript is left with only
    // queue-operation entries; getLastSessionLog filters those out, returns
    // null, and --resume fails with "No conversation found". Writing now makes
    // the transcript resumable from the point the user message was accepted,
    // even if no API response ever arrives.
    //
    // --bare / SIMPLE: fire-and-forget. Scripted calls don't --resume after
    // kill-mid-request. The await is ~4ms on SSD, ~30ms under disk contention
    // — the single largest controllable critical-path cost after module eval.
    // Transcript is still written (for post-hoc debugging); just not blocking.
// 译：在进入 query 循环**之前**就把用户消息持久化到 transcript。
//     下面的 for-await 只在 ask() yield 出 assistant/user/compact_boundary
//     消息时才调 recordTranscript —— 而那要等 API 响应才开始。
//     如果进程在那之前被杀（比如用户在发送后几秒内在 cowork 里点了 Stop），
//     transcript 里就只剩 queue-operation 条目；getLastSessionLog 会把那些
//     过滤掉、返回 null，于是 --resume 报 "No conversation found"。
//     现在写，就能保证「从用户消息被接受的那一刻起」transcript 就是可恢复的，
//     即使 API 响应永远没回来。
//
//     --bare / SIMPLE：fire-and-forget。脚本化调用不会在请求中途被杀后
//     再 --resume。这个 await 在 SSD 上约 4ms，磁盘竞争下约 30ms ——
//     是模块求值之后最大的一笔可控关键路径开销。transcript 仍然会写
//     （用于事后调试），只是不阻塞。
//
// 注：这段注释值得逐层拆，因为它展示了「一个可用性 bug 如何决定架构时序」。
//
//     【事故链】
//     用户发消息 → 消息进内存 → 发 API 请求（要 5-30 秒）→
//     在这 30 秒内用户点 Stop → 进程被杀 →
//     此时 transcript 里只有 queue-operation（"消息进队列了"），
//     没有真正的 user 消息 → 下次 --resume 找不到任何对话 → 报错。
//
//     【根因】
//     落盘被绑在「yield 出消息」这个事件上，而 yield 要等 API 回来。
//     换句话说：**持久化依赖了一个可能永远不发生的未来事件。**
//
//     【修复】
//     把落盘提前到「消息被接受」这一刻。代价是多一次 IO，
//     收益是「无论之后发生什么，历史都在」。
//
//     【性能权衡：4ms vs 30ms 的取舍】
//     注释给了具体数字：SSD 4ms，磁盘竞争 30ms。
//     这 30ms 是「模块加载之后最大的一笔可控开销」——
//     也就是说，启动路径已经优化到只剩这一项还能动了。
//     所以 --bare 模式（脚本）跳过它：脚本不会中途被杀再恢复，
//     不值得付这 30ms。
//
//     【为什么 --bare 仍然写，只是不 await】
//     "Transcript is still written (for post-hoc debugging); just not blocking."
//     写还是要写（出问题时能查），只是不等它完成。
//     这是「fire-and-forget 但保留副作用」的标准写法。
//
//     一个额外观察：`isEnvTruthy(CLAUDE_CODE_EAGER_FLUSH) ||
//     isEnvTruthy(CLAUDE_CODE_IS_COWORK)` 这个条件在本文件出现了 5 次
//     （行 456、610、844、974、1017、1074）。每次都一样：
//     「如果是 cowork 或要求 eager flush，就额外 flush 一次」。
//     重复 6 次说明它应该被抽成一个函数 —— 没抽大概是因为
//     每次都在 await 上下文里，抽出来要传 async 回调。
    if (persistSession && messagesFromUserInput.length > 0) {
      const transcriptPromise = recordTranscript(messages)
      if (isBareMode()) {
        void transcriptPromise
      } else {
        await transcriptPromise
        if (
          isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
          isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
        ) {
          await flushSessionStorage()
        }
      }
    }

// ── 18. 过滤"该回执给调用方"的消息 ──
    // Filter messages that should be acknowledged after transcript
    const replayableMessages = messagesFromUserInput.filter(
      msg =>
        (msg.type === 'user' &&
          !msg.isMeta && // Skip synthetic caveat messages
          !msg.toolUseResult && // Skip tool results (they'll be acked from query)
          messageSelector().selectableUserMessagesFilter(msg)) || // Skip non-user-authored messages (task notifications, etc.)
        (msg.type === 'system' && msg.subtype === 'compact_boundary'), // Always ack compact boundaries
    )
    const messagesToAck = replayUserMessages ? replayableMessages : []
// 注：三个排除条件，每个都有明确理由（注释写在代码行尾）：
//       !msg.isMeta          → 合成的说明性消息（比如「caveat」提示）
//       !msg.toolUseResult   → 工具结果（会被 query 的流程单独回执）
//       不是可选择的用户消息 → 非用户本人写的（任务通知等）
//     加上一个总是包含的：system + compact_boundary（压缩边界要回执）。
//
//     `replayUserMessages` 决定要不要真的回执（行 474）：
//       开关开着 → 把用户消息原样回放给 SDK（行 735-750 才 yield）
//       开关关着 → 空数组，不回执
//     为什么默认关？因为回执会让 SDK 收到自己刚发出去的消息，
//     有些调用方会因此重复处理。所以做成可选。
//
//     `messageSelector()` 每次调用都 require 一次（有缓存，成本极低）——
//     这就是行 87 那个延迟加载的实际使用点。

    // Update the ToolPermissionContext based on user input processing (as necessary)
    setAppState(prev => ({
// 注：把 allowedTools 写进 AppState 的 alwaysAllowRules.command。
//     注意是**合并**（`...prev.toolPermissionContext.alwaysAllowRules`），
//     不是替换 —— 因为 allowedTools 是「本次输入新增的规则」，
//     之前会话累积的规则要保留。
//
//     为什么用 setAppState 而不是直接改？因为 AppState 是 React 的
//     状态管理（REPL 用来驱动 UI 重渲染），必须走 setter 才能触发更新。
//     在 headless 模式下这个 setter 是调用方传进来的，可能是个
//     真状态容器，也可能是个空实现。
//
//     `if (updated === prev) return prev` 这个模式在行 381、390 也出现 ——
//     这是 React setState 的标准优化：**引用没变就不触发重渲染**。
//     注意行 477 这里**没有**这个判断，因为它是无条件新建对象
//     （每次都要更新 alwaysAllowRules）。
      ...prev,
      toolPermissionContext: {
        ...prev.toolPermissionContext,
        alwaysAllowRules: {
          ...prev.toolPermissionContext.alwaysAllowRules,
          command: allowedTools,
        },
      },
    }))

    const mainLoopModel = modelFromUserInput ?? initialMainLoopModel
// 注：`modelFromUserInput ?? initialMainLoopModel` —— 斜杠命令
//     （比如 /model opus）可以改模型，改完要反映到后续所有地方。
//
//     这就是为什么下面要重建 context：第一个 context 里
//     `mainLoopModel: initialMainLoopModel`（行 354），
//     已经过期了。第二个 context 用 `mainLoopModel`（行 502）。
//
//     这个「先建 → 跑命令 → 再建」的模式，本质上是**因为没有
//     可变引用**：context 是普通对象，命令改了模型只能通过重构对象传播。
//     如果 context 里有 `model` 的 getter，就不需要重建。
//     代价换来的是「context 是纯数据，好序列化、好测试」。

// ── 19. 第二处 context：为什么 setMessages 变成空操作 ──
    // Recreate after processing the prompt to pick up updated messages and
    // model (from slash commands).
    processUserInputContext = {
      messages,
      setMessages: () => {},
      onChangeAPIKey: () => {},
      handleElicitation: this.config.handleElicitation,
      options: {
        commands,
        debug: false,
        tools,
        verbose,
        mainLoopModel,
        thinkingConfig: initialThinkingConfig,
        mcpClients,
        mcpResources: {},
        ideInstallationStatus: null,
        isNonInteractiveSession: true,
        customSystemPrompt,
        appendSystemPrompt,
        theme: resolveThemeSetting(getGlobalConfig().theme),
        agentDefinitions: { activeAgents: agents, allAgents: [] },
        maxBudgetUsd,
      },
      getAppState,
      setAppState,
      abortController: this.abortController,
      readFileState: this.readFileState,
      nestedMemoryAttachmentTriggers: new Set<string>(),
      loadedNestedMemoryPaths: this.loadedNestedMemoryPaths,
      dynamicSkillDirTriggers: new Set<string>(),
      discoveredSkillNames: this.discoveredSkillNames,
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: processUserInputContext.updateFileHistoryState,
      updateAttributionState: processUserInputContext.updateAttributionState,
      setSDKStatus,
    }
// 注：对比第一个 context（行 335），三处不同：
//       ① `messages` 换成新快照（行 493）
//       ② `setMessages: () => {}` —— 变成空操作（行 494）
//       ③ `mainLoopModel` 换成命令执行后的值（行 502）
//
//     其余字段完全一样 —— 也就是说这是一次**几乎全量的重复**。
//     为什么不用 `{ ...processUserInputContext, messages, setMessages, options: {...} }`？
//     因为要改的是 options 内部的字段（mainLoopModel），
//     展开语法要写成三层嵌套（options: {...ctx.options, mainLoopModel}），
//     而 TypeScript 对深层展开的类型推导会失败（丢失精确类型）。
//     所以宁可全量重写一遍。
//
//     这是「类型系统逼出来的重复代码」。代价是改字段要改两处 ——
//     如果哪天给 ProcessUserInputContext 加了必填字段，
//     这里会编译报错（好事），但两边都要补（成本）。
//
//     为什么第二次的 setMessages 是空操作？行 341-343 的注释说了：
//     「那之后没有别的地方调 setMessages」。斜杠命令都处理完了，
//     后面 query() 循环不再需要写回消息数组（它有自己的 state.messages）。

// ── 20. 技能与插件：cache-only 加载 ──
    headlessProfilerCheckpoint('before_skills_plugins')
    // Cache-only: headless/SDK/CCR startup must not block on network for
    // ref-tracked plugins. CCR populates the cache via CLAUDE_CODE_SYNC_PLUGIN_INSTALL
    // (headlessPluginInstall) or CLAUDE_CODE_PLUGIN_SEED_DIR before this runs;
    // SDK callers that need fresh source can call /reload-plugins.
    const [skills, { enabled: enabledPlugins }] = await Promise.all([
      getSlashCommandToolSkills(getCwd()),
      loadAllPluginsCacheOnly(),
    ])
    headlessProfilerCheckpoint('after_skills_plugins')
// 译：仅用缓存：headless/SDK/CCR 启动不能因为 ref-tracked 插件
//     而阻塞在网络请求上。CCR 在这之前通过
//     CLAUDE_CODE_SYNC_PLUGIN_INSTALL（headlessPluginInstall）或
//     CLAUDE_CODE_PLUGIN_SEED_DIR 填充缓存；需要最新源码的 SDK
//     调用方可以调 /reload-plugins。
//
// 注：这是一个「启动延迟 vs 数据新鲜度」的取舍，落点是**永远选延迟**。
//     理由很硬：headless 调用方通常有超时（CI、编辑器插件、
//     自动化脚本），启动时卡在网络请求上会让整个调用超时。
//
//     填充缓存的责任被推给了部署方（CCR = Claude Code Remote）：
//     要么用 SYNC_PLUGIN_INSTALL 在启动前同步装，要么用 SEED_DIR
//     预置一个目录。这样运行时只读本地，快且确定。
//
//     `Promise.all` 并行拉两个 —— 它们互不依赖（技能扫描文件系统，
//     插件读缓存目录），所以并行。这也说明两者都不快
//     （如果有一个很快，并行的收益就小）。

// ── 21. system init 消息：SDK 收到的第一条 ──
    yield buildSystemInitMessage({
      tools,
      mcpClients,
      model: mainLoopModel,
      permissionMode: initialAppState.toolPermissionContext
        .mode as PermissionMode, // TODO: avoid the cast
      commands,
      agents,
      skills,
      plugins: enabledPlugins,
      fastMode: initialAppState.fastMode,
    })

    // Record when system message is yielded for headless latency tracking
    headlessProfilerCheckpoint('system_message_yielded')
// 注：`buildSystemInitMessage` 是**握手消息** —— SDK 调用方靠它
//     知道自己连上了什么（有哪些工具、哪些 MCP 服务器、什么模型、
//     什么权限模式、有哪些命令/代理/技能/插件）。
//
//     为什么要在调模型之前发？因为调用方需要在「第一句回复」之前
//     就能渲染 UI（工具列表、可用命令提示）。如果等模型回完再发，
//     用户会先看到空白的输入区。
//
//     注意 `permissionMode: ... as PermissionMode, // TODO: avoid the cast`
//     —— 一个遗留的类型断言。内部模式类型的取值比 SDK 协议多，
//     所以只能强转。这类 cast 是「内外类型不完全对等」的标志，
//     数量是衡量边界泄露程度的指标。
//
//     `headlessProfilerCheckpoint('system_message_yielded')` 记录时序 ——
//     和行 284 的 'before_getSystemPrompt'、行 301 的 'after_getSystemPrompt'、
//     行 529 的 'before_skills_plugins' 一起，构成启动阶段的分段计时。
//     这些 checkpoint 只在 headless 下有意义（要测启动延迟）。

// ═══════════════════════════════════════════════════════════════
// ── 22. !shouldQuery：纯本地命令的完整返回路径 ──
//
// 这条路径完全不调 API。但它的代码量不小（80 行），因为要
// 手工把「本地命令产出」转成 SDK 协议消息 —— 三种类型各转一次。
// 这是「绕过主流程」的代价：主流程有的能力（消息规范化、
// 结果包装、计时），这里都要手写一遍。
// ═══════════════════════════════════════════════════════════════
    if (!shouldQuery) {
      // Return the results of local slash commands.
      // Use messagesFromUserInput (not replayableMessages) for command output
      // because selectableUserMessagesFilter excludes local-command-stdout tags.
      for (const msg of messagesFromUserInput) {
        if (
          msg.type === 'user' &&
          typeof msg.message.content === 'string' &&
          (msg.message.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`) ||
            msg.message.content.includes(`<${LOCAL_COMMAND_STDERR_TAG}>`) ||
            msg.isCompactSummary)
        ) {
          yield {
            type: 'user',
            message: {
              ...msg.message,
              content: stripAnsi(msg.message.content),
// 注：`stripAnsi(...)` —— 去掉终端颜色码。为什么需要？
//     因为本地命令（比如 /help）的输出可能带颜色（为了终端好看），
//     但 SDK 调用方拿到的是纯文本协议，颜色码会变成乱码。
//
//     这个细节说明「同一个命令服务两种界面」：
//       终端：需要 ANSI 颜色
//       SDK：需要纯文本
//     所以在边界处剥一次。剥的位置很讲究 ——
//     在 yield 给 SDK 之前剥，而不是在产出时就不带颜色，
//     因为终端渲染仍需要它。
            },
            session_id: getSessionId(),
            parent_tool_use_id: null,
            uuid: msg.uuid,
            timestamp: msg.timestamp,
            isReplay: !msg.isCompactSummary,
            isSynthetic: msg.isMeta || msg.isVisibleInTranscriptOnly,
          } as SDKUserMessageReplay
        }

        // Local command output — yield as a synthetic assistant message so
// 注：本地命令的输出被包装成**assistant 消息**，而不是专门的
//     「本地命令输出」类型。注释给了两个理由：
//       ① RC（远程控制）会渲染成 assistant 风格的文本，而不是用户气泡
//       ② 移动端和 session-ingress 能解析它
//
//     这是一个「协议兼容性优先」的决定：理论上应该有个专门的
//     SDKLocalCommandOutputMessage 类型，但那样所有客户端都要支持新类型。
//     复用 assistant 类型能立刻兼容所有已有客户端 ——
//     代价是语义上略有偏差（这确实不是模型说的话）。
//
//     这类「借用已有类型以兼容存量消费者」的做法，在协议演进里很常见，
//     代价是未来的维护者会困惑「为什么 assistant 消息里会出现
//     /help 的输出」。
        // RC renders it as assistant-style text rather than a user bubble.
        // Emitted as assistant (not the dedicated SDKLocalCommandOutputMessage
        // system subtype) so mobile clients + session-ingress can parse it.
        if (
          msg.type === 'system' &&
          msg.subtype === 'local_command' &&
          typeof msg.content === 'string' &&
          (msg.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`) ||
            msg.content.includes(`<${LOCAL_COMMAND_STDERR_TAG}>`))
        ) {
          yield localCommandOutputToSDKAssistantMessage(msg.content, msg.uuid)
        }

        if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
          yield {
            type: 'system',
            subtype: 'compact_boundary' as const,
            session_id: getSessionId(),
            uuid: msg.uuid,
            compact_metadata: toSDKCompactMetadata(msg.compactMetadata),
          } as SDKCompactBoundaryMessage
        }
      }

      if (persistSession) {
// 注：本地命令路径也要落盘 + flush。这行看起来冗余（前面行 450
//     已经写过一次），但内容不同：这次写的是**执行完命令之后**的状态
//     （包含命令输出）。所以两次写是有意义的。
//
//     这又是一个「同一件事要做多次」的例子 ——
//     本文件里 recordTranscript 出现 5 次（450、609、712、728、730、780、834），
//     每次的时机和参数都不同。这类重复很难消除，因为每次的
//     「写什么内容」都取决于当时的 messages 数组状态。
        await recordTranscript(messages)
        if (
          isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
          isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
        ) {
          await flushSessionStorage()
        }
      }

      yield {
// 注：注意这个 result 的 `num_turns: messages.length - 1` —— 和正常
//     路径的 `num_turns: turnCount`（行 1141）**完全不同的算法**。
//
//       这里：消息数组长度 - 1（粗略估算）
//       正常路径：turnCount 变量（每收到 user 消息 +1，行 754）
//
//     为什么本地命令路径用消息数？因为它根本没进 query 循环，
//     turnCount 永远是初始值 1，没有意义。所以退化成「用消息数近似轮数」。
//
//     这是个**两个字段同名但语义不同**的情况，SDK 调用方如果
//     依赖 num_turns 做统计，在本地命令路径会得到不同的量级。
//     属于协议设计上的小瑕疵。
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: Date.now() - startTime,
        duration_api_ms: getTotalAPIDuration(),
        num_turns: messages.length - 1,
        result: resultText ?? '',
        stop_reason: null,
        session_id: getSessionId(),
        total_cost_usd: getTotalCost(),
        usage: this.totalUsage,
        modelUsage: getModelUsage(),
        permission_denials: this.permissionDenials,
        fast_mode_state: getFastModeState(
          mainLoopModel,
          initialAppState.fastMode,
        ),
        uuid: randomUUID(),
      }
      return
    }

// ── 23. 文件历史快照：为 undo 做准备 ──
    if (fileHistoryEnabled() && persistSession) {
      messagesFromUserInput
        .filter(messageSelector().selectableUserMessagesFilter)
        .forEach(message => {
          void fileHistoryMakeSnapshot(
            (updater: (prev: FileHistoryState) => FileHistoryState) => {
              setAppState(prev => ({
                ...prev,
                fileHistory: updater(prev.fileHistory),
              }))
            },
            message.uuid,
          )
        })
    }
// 注：在进入 query 之前，给每条用户消息做一次文件历史快照。
//     目的是支持「撤销这一轮的所有文件改动」（Esc Esc 或 /undo）。
//
//     条件 `fileHistoryEnabled() && persistSession` —— 两个都必须：
//       功能开关开着 → 用户要这个能力
//       会话持久化开着 → 快照要落盘才能跨会话恢复
//
//     注意 `void fileHistoryMakeSnapshot(...)` —— fire-and-forget。
//     因为快照只是「备份」，失败不该阻止对话开始。
//     而且它是 IO 密集型（要复制文件），await 会明显拖慢启动。
//
//     参数里传了 `message.uuid` —— 每条用户消息一个快照点，
//     这样撤销可以精确定位到「第几条消息之前的状态」。
//     这也是为什么只给 `selectableUserMessagesFilter` 通过的
//     消息做快照（工具结果、系统通知不需要快照点）。

// ═══════════════════════════════════════════════════════════════
// ── 24. 本轮记账：五个计数器 + 一个水位线 ──
//
// 这六个变量全部是 submitMessage 的局部变量（不是 this.xxx），
// 也就是说**每轮重置**。对比行 186 那些 this 字段（跨轮持久）。
// 这条分界线是本文件最需要记清的：this = 会话级，局部 = 轮级。
// ═══════════════════════════════════════════════════════════════
    // Track current message usage (reset on each message_start)
    let currentMessageUsage: NonNullableUsage = EMPTY_USAGE
    let turnCount = 1
    let hasAcknowledgedInitialMessages = false
    // Track structured output from StructuredOutput tool calls
    let structuredOutputFromTool: unknown
    // Track the last stop_reason from assistant messages
    let lastStopReason: string | null = null
    // Reference-based watermark so error_during_execution's errors[] is
// 译：基于引用的水位线，让 error_during_execution 的 errors[] 只包含
//     本轮的错误。基于长度的索引在 100 条环形缓冲 shift() 时会失效 ——
//     索引会滑动。如果这个条目被轮换出去了，lastIndexOf 返回 -1，
//     我们就包含全部（安全的兜底）。
//
// 注：这段注释讲了一个很典型的「环形缓冲 + 索引」陷阱，值得展开：
//
//     【错误日志的结构】
//     getInMemoryErrors() 返回一个最多 100 条的环形缓冲。
//     满了之后每加一条就 shift() 掉最老的。
//
//     【错误做法：存长度】
//         const n = getInMemoryErrors().length
//         ... 之后用 errors.slice(n) 取"本轮新增的"
//     问题：如果本轮新增了 20 条，缓冲区把最老的 20 条移出去了，
//     那么 length 还是 100 —— slice(100) 得到空数组。
//     反过来如果本轮没有新增但缓冲区被别的代码清了，也会算错。
//
//     【正确做法：存引用】
//         const watermark = getInMemoryErrors().at(-1)   // 记住最后一条对象
//         ... 之后用 all.lastIndexOf(watermark) + 1 开始切
//     环形缓冲的 shift 只删头部，不会改变已有对象的引用 ——
//     所以只要那条对象还在，lastIndexOf 就能定位到它。
//
//     【兜底】
//     如果那条对象被轮换出去了（本轮产生了 100+ 条错误），
//     lastIndexOf 返回 -1 → `-1 + 1 = 0` → 从 0 开始切，
//     也就是包含全部。注释说这是 "safe fallback" ——
//     宁可多带一些错误，也不要漏掉本轮的。
//
//     这个模式（用引用当水位线，而不是索引/长度）在日志、队列、
//     快照增量里都适用。核心原则：**水位线要绑定到内容，不要绑定到位置。**
    // turn-scoped. A length-based index breaks when the 100-entry ring buffer
    // shift()s during the turn — the index slides. If this entry is rotated
    // out, lastIndexOf returns -1 and we include everything (safe fallback).
    const errorLogWatermark = getInMemoryErrors().at(-1)
    // Snapshot count before this query for delta-based retry limiting
    const initialStructuredOutputCalls = jsonSchema
      ? countToolCalls(this.mutableMessages, SYNTHETIC_OUTPUT_TOOL_NAME)
      : 0

// ═══════════════════════════════════════════════════════════════
// ── 25. 进入主循环：for await 消费 query() ──
//
// 注意传了 `toolUseContext: processUserInputContext` —— 把整个
// 输入处理上下文当成工具上下文传进去。这两个类型能对上，
// 说明 ProcessUserInputContext 是 ToolUseContext 的超集。
// 这种「结构兼容」是 TypeScript 结构化类型的便利，
// 但也意味着两边的字段语义强耦合（改一边要检查另一边）。
// ═══════════════════════════════════════════════════════════════
    for await (const message of query({
      messages,
      systemPrompt,
      userContext,
      systemContext,
      canUseTool: wrappedCanUseTool,
      toolUseContext: processUserInputContext,
      fallbackModel,
      querySource: 'sdk',
      maxTurns,
      taskBudget,
    })) {
// 注：`querySource: 'sdk'` 是硬编码的 —— 这条路径永远标记为 sdk。
//     它会影响 query.ts 里若干判断（比如 `querySource !== 'compact'`
//     的阻塞检查豁免）。
//
//     注意**没有**传 `maxOutputTokensOverride`、`skipCacheWrite`、
//     以及 `deps` —— 也就是说 SDK 路径不支持这些调优项。
//     这是「两条产品路径能力不对等」的又一处证据：
//     REPL 能做的某些精细控制，SDK 路径没暴露。
// ── 26. 落盘 + 回执：双重条件的前置动作 ──
      // Record assistant, user, and compact boundary messages
      if (
        message.type === 'assistant' ||
        message.type === 'user' ||
        (message.type === 'system' && message.subtype === 'compact_boundary')
      ) {
        // Before writing a compact boundary, flush any in-memory-only
        // messages up through the preservedSegment tail. Attachments and
        // progress are now recorded inline (their switch cases below), but
        // this flush still matters for the preservedSegment tail walk.
        // If the SDK subprocess restarts before then (claude-desktop kills
        // between turns), tailUuid points to a never-written message →
        // applyPreservedSegmentRelinks fails its tail→head walk → returns
        // without pruning → resume loads full pre-compact history.
        if (
          persistSession &&
          message.type === 'system' &&
          message.subtype === 'compact_boundary'
        ) {
          const tailUuid = message.compactMetadata?.preservedSegment?.tailUuid
          if (tailUuid) {
            const tailIdx = this.mutableMessages.findLastIndex(
              m => m.uuid === tailUuid,
            )
            if (tailIdx !== -1) {
              await recordTranscript(this.mutableMessages.slice(0, tailIdx + 1))
            }
          }
        }
// 注：这段是「压缩边界之前先 flush 未落盘的消息」。
//     注释描述的失败场景非常具体：
//
//     「如果 SDK 子进程在这之前重启（claude-desktop 在 turn 之间被杀），
//       tailUuid 指向一条从未被写入的消息 → applyPreservedSegmentRelinks
//       的 tail→head 遍历失败 → 不裁剪就返回 → 恢复时加载完整的压缩前历史。」
//
//     拆开看：
//       · 压缩边界消息里带 preservedSegment（哪些消息被保留了）
//       · 它有一个 tailUuid，指向保留段的最后一条
//       · 恢复时要从这个 tail 往回走到 head，把中间段裁掉
//       · 如果 tail 那条消息根本没落盘，遍历就断了 → 不裁剪 → 加载全部
//     结果就是「压缩白做了」—— 恢复后还是满上下文。
//
//     修复：在写边界消息之前，先把 up to tailUuid 的所有消息写下去。
//     代码只在 `tailIdx !== -1` 时写（找不到就跳过），
//     也就是说「内存里都没有这条消息」时不会误写。
//
//     这是一个**跨进程、跨时间**的一致性要求：一段逻辑的正确性
//     依赖于「另一个进程在某个时刻读到的磁盘状态」。
//     这类 bug 在单进程测试里几乎不可能复现。
        messages.push(message)
// ═══════════════════════════════════════════════════════════════
// ── 27. 一段 10 行的注释，解释一个 await 与不 await 的死锁 ──
//
// 这是全文技术密度最高的注释，值得逐句翻译+解释。
// ═══════════════════════════════════════════════════════════════
        if (persistSession) {
          // Fire-and-forget for assistant messages. claude.ts yields one
          // assistant message per content block, then mutates the last
          // one's message.usage/stop_reason on message_delta — relying on
          // the write queue's 100ms lazy jsonStringify. Awaiting here
          // blocks ask()'s generator, so message_delta can't run until
          // every block is consumed; the drain timer (started at block 1)
          // elapses first. Interactive CC doesn't hit this because
          // useLogMessages.ts fire-and-forgets. enqueueWrite is
          // order-preserving so fire-and-forget here is safe.
          if (message.type === 'assistant') {
            void recordTranscript(messages)
          } else {
            await recordTranscript(messages)
          }
// 译：对 assistant 消息使用 fire-and-forget。claude.ts 会为**每个
//     content block** yield 一条 assistant 消息，然后在 message_delta 时
//     修改最后一条的 message.usage/stop_reason —— 它依赖写队列的
//     100ms 延迟 jsonStringify。在这里 await 会阻塞 ask() 的生成器，
//     于是 message_delta 要等每个 block 都被消费完才能跑；
//     而排空定时器（在第一个 block 时启动）会先到期。
//     交互式 CC 不会踩到这个，因为 useLogMessages.ts 用的是 fire-and-forget。
//     enqueueWrite 是保序的，所以这里 fire-and-forget 是安全的。
//
// 注：这段注释揭开了一个非常深的时序耦合，逐层拆：
//
//     【事实 1：一条 assistant 消息不是一次 yield】
//     claude.ts 流式解析 SSE 时，每遇到一个 content block（一段文字、
//     一次工具调用）就 yield 一条 assistant 消息。所以一段包含
//     「先说一句话 + 调两个工具」的回复，会 yield 3 条 assistant 消息。
//
//     【事实 2：usage 和 stop_reason 是**后来才补上**的】
//     这 3 条消息 yield 的时候，usage 还是空的、stop_reason 是 null。
//     真正的值在流末尾的 message_delta 事件里。所以 claude.ts 会在
//     message_delta 时**回头修改最后一条**已 yield 的消息对象。
//     （注意：修改对象，不是再 yield 一条新消息。）
//
//     【事实 3：写盘的延迟序列化】
//     recordTranscript 不是立刻 JSON.stringify，而是入队，
//     100ms 后批量序列化。所以「对象在序列化之前被改」是安全的 ——
//     最终写下去的是改后的值。这是个刻意的设计：让「消息先发出去、
//     用量后补充」这件事成立。
//
//     【死锁是怎么形成的】
//     假设这里 await recordTranscript(messages)：
//       1. ask() 的生成器在 yield 第 1 条 assistant 消息后，
//          被调用方的 for await 消费，然后回到 ask() 里继续执行
//       2. 但 ask() 现在卡在 await recordTranscript 上
//       3. 于是它无法继续 yield 第 2、3 条消息
//       4. 而 message_delta 事件在流里排在这 3 条之后
//       5. claude.ts 的生成器也因为「没人消费」而卡住
//       6. 100ms 的排空定时器到期，把**还没补上 usage 的**消息序列化落盘
//       结果：transcript 里 usage 全是 0，stop_reason 全是 null。
//
//     【为什么 fire-and-forget 能解决】
//     await 改成 void 后，ask() 立刻能继续 yield 下一条，
//     流继续推进 → message_delta 到达 → claude.ts 修改最后一条消息 →
//     100ms 后序列化时拿到的是完整数据。
//
//     【为什么这是安全的】
//     "enqueueWrite is order-preserving" —— 写队列是保序的。
//     所以即使不 await，第 1 条消息也一定比第 2 条先入队。
//     这个保证是前提；如果队列会乱序，就不能这么写。
//
//     【为什么交互式不会踩到】
//     useLogMessages.ts 本来就是 fire-and-forget —— 它不 await，
//     所以同样的死锁不存在。也就是说这个 bug 只在 headless 路径上出现，
//     这解释了为什么它没被更早发现。
//
//     这段注释的价值在于：它记录的**不是**「这里为什么用 void」，
//     而是「这里为什么不能 await」。这类注释比前者有用得多 ——
//     因为后人最可能做的就是「加个 await 让它更可靠」。
        }

        // Acknowledge initial user messages after first transcript recording
        if (!hasAcknowledgedInitialMessages && messagesToAck.length > 0) {
          hasAcknowledgedInitialMessages = true
          for (const msgToAck of messagesToAck) {
            if (msgToAck.type === 'user') {
              yield {
                type: 'user',
                message: msgToAck.message,
                session_id: getSessionId(),
                parent_tool_use_id: null,
                uuid: msgToAck.uuid,
                timestamp: msgToAck.timestamp,
                isReplay: true,
              } as SDKUserMessageReplay
            }
          }
        }
      }

      if (message.type === 'user') {
// 注：`turnCount++` 只在收到 **user** 类型消息时发生。
//     回顾上一份文件：query.ts 里每轮产出的顺序是
//     assistant（模型说话）→ user（工具结果）→ assistant → user …
//     所以 turnCount 实际计的是「工具结果轮次 + 1」。
//
//     注意这里统计的是**所有** user 消息，包括 attachment 转成的消息。
//     所以 turnCount 会比用户在界面上看到的「轮数」大一些。
//     result.num_turns 用这个值，SDK 调用方不应该拿它当
//     「对话了几轮」的准确指标。
        turnCount++
      }

// ═══════════════════════════════════════════════════════════════
// ── 28. switch：九种内部消息 → SDKMessage 的完整映射表 ──
//
// 这是本文件的核心，也是理解「内外协议差异」最好的地方。
// 九种内部类型，处理方式分三类：
//   ① 转发（但要换形状）  assistant / user / tool_use_summary / system(部分)
//   ② 丢弃（内部信号）    tombstone / stream_request_start
//   ③ 内部消化（不转发）  progress / attachment（除少数分支）
// 注意「内部消化」的三种：它们都 push 进 mutableMessages（历史需要），
// 但不 yield（对外不可见）。这个区分很重要：
// **历史完整性 ≠ 对外可见性**。
// ═══════════════════════════════════════════════════════════════
      switch (message.type) {
        case 'tombstone':
          // Tombstone messages are control signals for removing messages, skip them
          break
// 注：tombstone 是「请删掉这条消息」的控制信号（见上一份文件行 712）。
//     SDK 调用方不需要知道 —— 它收到 tombstone 也不知道该删哪条
//     （因为那条可能压根没发给它）。
//
//     所以这里**完全丢弃**：break，不 push 进 mutableMessages，不 yield。
//     这也是为什么 QueryEngine 的 mutableMessages 里可能有未清理的孤儿消息 ——
//     它没有处理 tombstone。不过这通常无影响，因为
//     `getMessages()` 的消费者（下一次 submitMessage）传进 query() 后，
//     query() 会用 getMessagesAfterCompactBoundary 过滤。
//
//     ⚠ 但严格说这是个潜在不一致：query.ts 认为 tombstone 该删消息，
//     QueryEngine 直接忽略了它。两边的消息数组在极端情况下会分叉。
        case 'assistant':
          // Capture stop_reason if already set (synthetic messages). For
          // streamed responses, this is null at content_block_stop time;
          // the real value arrives via message_delta (handled below).
          if (message.message.stop_reason != null) {
// 注：为什么要在这里捕获 stop_reason？注释解释了：
//     「流式响应在 content_block_stop 时这个值还是 null；
//       真正的值通过 message_delta 到达（下面处理）」。
//
//     所以这个 if 只对**合成消息**（synthetic）有效 ——
//     合成消息是本地造的，stop_reason 一开始就有值。
//     流式消息在这里白跑一次判断，实际值是行 806 捕获的。
//
//     这又是一个「两条路径共用一个分支」的例子：
//     代码为了同时兼容合成消息和流式消息，加了判断，
//     但对流式消息来说这个判断永远是 false（有点浪费，但无害）。
            lastStopReason = message.message.stop_reason
          }
          this.mutableMessages.push(message)
          yield* normalizeMessage(message)
// 注：`yield* normalizeMessage(message)` —— 注意是 `yield*` 而不是 `yield`。
//     normalizeMessage 是个生成器（可能产出 0 条或多条消息），
//     所以用委托。
//
//     为什么需要 normalize？因为内部 Message 和 SDKMessage 的形状不同：
//       内部 assistant 消息有 message.usage、uuid、timestamp 等字段，
//         还可能有 isApiErrorMessage、isMeta 等内部标记
//       SDK 协议只认 { type, message, session_id, parent_tool_use_id, uuid }
//     normalizeMessage 做这次映射，顺带补上 session_id、parent_tool_use_id。
//
//     注意它**不改变** ContentBlock 的结构 —— 文本、工具调用原样透传。
//     所以「模型说的内容」是完全一致的，变的是信封（envelope）。
//     这个区分很重要：**改信封不改内容**，是协议适配的基本原则。
//
//     也是在这一行 push 进 mutableMessages（行 768）——
//     注意顺序：先 push 再 yield。如果反过来（先 yield 再 push），
//     调用方可能在 push 之前就发起下一次 submitMessage，
//     导致这条消息丢失。
          break
// ── 28.1 progress / attachment：为什么要"内联记录" ──
        case 'progress':
          this.mutableMessages.push(message)
          // Record inline so the dedup loop in the next ask() call sees it
          // as already-recorded. Without this, deferred progress interleaves
          // with already-recorded tool_results in mutableMessages, and the
          // dedup walk freezes startingParentUuid at the wrong message —
          // forking the chain and orphaning the conversation on resume.
          if (persistSession) {
            messages.push(message)
            void recordTranscript(messages)
          }
          yield* normalizeMessage(message)
// 注：这段注释记录了一个**只在 resume 时暴露**的 bug，非常值得读：
//
//     「内联记录，这样下一次 ask() 调用里的去重循环就会看到它
//       已经被记录过了。不这样做，延迟的 progress 会和已经记录过的
//       tool_results 在 mutableMessages 里交错，去重遍历就会
//       在错误的消息上冻结 startingParentUuid ——
//       导致链条分叉、resume 时会话变成孤儿。」
//
//     拆解这个机制：
//
//     【transcript 是一条链】
//     sessionStorage 里每条消息有 parentUuid，指向它的上一条。
//     resume 时从最后一条往回走，重建整条链。
//
//     【去重遍历依赖顺序】
//     下一次 ask() 要写新消息时，需要找到「已经写到哪里了」。
//     它遍历 mutableMessages，跳过已经记录过的，找到最后一条已记录的
//     作为 startingParentUuid。
//
//     【交错导致的问题】
//     如果 progress 消息延迟记录（先 yield 后记），那么在这一轮里，
//     mutableMessages 的顺序是：
//         tool_result(已记录) → progress(未记录) → tool_result(已记录)
//     去重遍历走到 progress 时发现「未记录」，就把 startingParentUuid
//     冻结在这里 —— 但后面还有已记录的消息！
//     结果新消息挂在 progress 后面，而 progress 后面本来接着别的 tool_result，
//     链条就分叉了。
//
//     【后果是"会话变成孤儿"】
//     resume 时沿着 parentUuid 走，走到分叉点就断了，
//     分叉出去的那一支永远走不到 → 那部分历史丢失。
//
//     修复：progress 也**内联立刻记录**（行 778-781），
//     这样「未记录的消息」不会出现在中间。
//
//     这是本文件里最隐蔽的一个坑：单轮测试完全正常，
//     只有「resume 一个长会话」才会暴露。注释写这么细是因为
//     任何简化（比如「反正 progress 不重要，晚点记吧」）都会重新引入它。
          break
// ── 28.2 user 消息：最简单的一个 case ──
        case 'user':
          this.mutableMessages.push(message)
          yield* normalizeMessage(message)
          break
// 注：只有三行 —— 因为 user 消息的落盘已经在行 688-732 那个
//     统一块里做过了（`message.type === 'user'` 在那个 if 里）。
//     这里只负责 push 进 mutableMessages 和 yield。
//
//     注意这里**没有**把 user 消息放进 `messages`（本轮 transcript 累积器）——
//     也是因为统一块里已经放了（行 716）。
//     这种「同一件事在两个地方做，各做一半」的分工是本文件
//     最容易读错的地方。判断依据是：**看那个 if 条件覆盖了哪些 type**。
//     行 688-692 覆盖 assistant / user / compact_boundary，
//     所以 switch 里这三个 case 都不用重复落盘。
// ── 28.3 stream_event：用量累加 + stop_reason 捕获 + 可选转发 ──
        case 'stream_event':
          if (message.event.type === 'message_start') {
            // Reset current message usage for new message
            currentMessageUsage = EMPTY_USAGE
            currentMessageUsage = updateUsage(
              currentMessageUsage,
              message.event.message.usage,
            )
          }
          if (message.event.type === 'message_delta') {
            currentMessageUsage = updateUsage(
              currentMessageUsage,
              message.event.usage,
            )
            // Capture stop_reason from message_delta. The assistant message
            // is yielded at content_block_stop with stop_reason=null; the
            // real value only arrives here (see claude.ts message_delta
            // handler). Without this, result.stop_reason is always null.
            if (message.event.delta.stop_reason != null) {
              lastStopReason = message.event.delta.stop_reason
            }
          }
          if (message.event.type === 'message_stop') {
            // Accumulate current message usage into total
            this.totalUsage = accumulateUsage(
              this.totalUsage,
              currentMessageUsage,
            )
          }

          if (includePartialMessages) {
            yield {
              type: 'stream_event' as const,
              event: message.event,
              session_id: getSessionId(),
              parent_tool_use_id: null,
              uuid: randomUUID(),
            }
          }

          break
// 注：这是本文件唯一处理流式细粒度事件的地方，三个子事件各有职责：
//
//     message_start  → 重置 currentMessageUsage（新消息开始）
//     message_delta  → 累加 usage + 捕获 stop_reason（注释解释了原因：
//                      真正的 stop_reason 只在这里到达，见 claude.ts）
//     message_stop   → 把当前消息的 usage 累加进 totalUsage
//
//     注意累加是**两段式**：
//       currentMessageUsage  单条消息的用量（message_start 重置，delta 累加）
//       totalUsage           整个会话的累计（message_stop 时合并）
//     为什么要分两段？因为一条消息的 usage 是**分多次到达**的
//     （message_start 给 input_tokens，message_delta 给增量 output_tokens）。
//     如果直接累到 totalUsage，会重复计算 input_tokens。
//
//     `includePartialMessages` 控制要不要把每个流事件转发给 SDK。
//     默认 false —— 因为转发会让 SDK 收到几百条细粒度事件，
//     大多数调用方只想要「完整消息」，不想要 token 级流。
//     需要「打字机效果」的调用方才打开它。
//
//     注意 yield 里 `uuid: randomUUID()` —— **每次生成新 uuid**，
//     而不是复用 message.uuid。因为流事件不是消息，没有稳定的身份。
//     SDK 调用方不能用这个 uuid 去关联别的消息。
// ── 28.4 attachment：内部消化，但两个分支要转发 ──
        case 'attachment':
          this.mutableMessages.push(message)
          // Record inline (same reason as progress above).
          if (persistSession) {
            messages.push(message)
            void recordTranscript(messages)
          }

          // Extract structured output from StructuredOutput tool calls
          if (message.attachment.type === 'structured_output') {
            structuredOutputFromTool = message.attachment.data
          }
          // Handle max turns reached signal from query.ts
          else if (message.attachment.type === 'max_turns_reached') {
            if (persistSession) {
              if (
                isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
                isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
              ) {
                await flushSessionStorage()
              }
            }
            yield {
              type: 'result',
              subtype: 'error_max_turns',
              duration_ms: Date.now() - startTime,
              duration_api_ms: getTotalAPIDuration(),
              is_error: true,
              num_turns: message.attachment.turnCount,
              stop_reason: lastStopReason,
              session_id: getSessionId(),
              total_cost_usd: getTotalCost(),
              usage: this.totalUsage,
              modelUsage: getModelUsage(),
              permission_denials: this.permissionDenials,
              fast_mode_state: getFastModeState(
                mainLoopModel,
                initialAppState.fastMode,
              ),
              uuid: randomUUID(),
              errors: [
                `Reached maximum number of turns (${message.attachment.maxTurns})`,
              ],
            }
            return
          }
          // Yield queued_command attachments as SDK user message replays
          else if (
            replayUserMessages &&
            message.attachment.type === 'queued_command'
          ) {
            yield {
              type: 'user',
              message: {
                role: 'user' as const,
                content: message.attachment.prompt,
              },
              session_id: getSessionId(),
              parent_tool_use_id: null,
              uuid: message.attachment.source_uuid || message.uuid,
              timestamp: message.timestamp,
              isReplay: true,
            } as SDKUserMessageReplay
          }
          break
// 注：attachment 有几十种类型（max_turns_reached、structured_output、
//     queued_command、edited_text_file、hook_stopped_continuation…），
//     这里只处理三种：
//
//     structured_output  → 提取到 structuredOutputFromTool，最后放进 result
//                          注意**不 yield** —— 它是元数据，不是消息
//     max_turns_reached  → **立即 yield result 并 return**
//                          这是本轮的唯一终止方式（因为 query() 只发这个
//                          attachment，不返回错误）
//     queued_command     → 如果 replayUserMessages 开着，转成 user 回执
//
//     其余所有 attachment 都只是 push 进历史（行 830），对外不可见。
//
//     注意 max_turns_reached 的处理里有个细节：
//     `num_turns: message.attachment.turnCount` —— 用的是 attachment
//     自己带的轮数，而不是本文件的 turnCount 变量。
//     因为本文件的 turnCount 统计口径不同（行 753 的批注）。
//     在终止路径上用准确的那个。
//
//     还有：所有终止路径都先 `flushSessionStorage()`（如果开了 eager flush）——
//     因为进程可能马上退出，未落盘的数据会丢。这个模式在 5 个终止点
//     各重复一次（行 843、973、1016、1073，以及这里）。
// ── 28.5 stream_request_start：内部信号，丢弃 ──
        case 'stream_request_start':
          // Don't yield stream request start messages
          break
// 注：上一份文件里说它是「每轮迭代开头 yield 的第一条消息，给 UI 一个
//     新轮次开始的信号」（query.ts 行 337）。但 SDK 调用方不需要它 ——
//     因为它不参与任何协议语义，只是个渲染提示。
//
//     所以这里 break 丢弃。注意它**也没有** push 进 mutableMessages ——
//     因为它不是对话内容。
//
//     这是一个「内部信号 vs 对外协议」的清晰分界：
//     内部有很多这种「纯控制信号」（tombstone、stream_request_start），
//     它们存在的目的是驱动 UI 或控制流，不属于对话数据。
// ── 28.6 system：四个分支，只有两个会转发 ──
        case 'system': {
          // Snip boundary: replay on our store to remove zombie messages and
          // stale markers. The yielded boundary is a signal, not data to push —
          // the replay produces its own equivalent boundary. Without this,
          // markers persist and re-trigger on every turn, and mutableMessages
          // never shrinks (memory leak in long SDK sessions). The subtype
          // check lives inside the injected callback so feature-gated strings
          // stay out of this file (excluded-strings check).
          const snipResult = this.config.snipReplay?.(
            message,
            this.mutableMessages,
          )
          if (snipResult !== undefined) {
            if (snipResult.executed) {
              this.mutableMessages.length = 0
              this.mutableMessages.push(...snipResult.messages)
            }
            break
          }
          this.mutableMessages.push(message)
// 注：system 消息有十几个 subtype（compact_boundary、api_error、
//     local_command、snip_boundary、init…），这里处理三个：
//
//     ① snip 边界（行 905-915）→ 调注入的回调，重建整个消息数组
//        ⚠ 关键：`if (snipResult !== undefined) { ... break }` ——
//        **命中就 break**，不往下走。也就是说 snip 边界消息本身
//        **不会被 push 进 mutableMessages**（注释行 899-900 说得很清楚：
//        「yielded boundary 是信号，不是要 push 的数据 —— 重放会产出
//        它自己的等价边界」）。
//        如果不 break，就会重复：既 push 了原边界，又 push 了重放产生的边界。
//
//     ② compact_boundary（行 918-942）→ 转发给 SDK
//     ③ api_error（行 943-955）→ 转成 api_retry 转发
//
//     其余 subtype 全部丢弃（行 956：「Don't yield other system messages
//     in headless mode」）。这句注释暴露了一个事实：
//     交互模式下这些 system 消息**是显示的**（比如 local_command 的输出），
//     只是 headless 不显示。所以这个 switch 是「一条路径的裁剪版」，
//     不是「system 消息的完整映射」。
// ── 28.7 压缩后释放内存：splice 两处数组 ──
          // Yield compact boundary messages to SDK
          if (
            message.subtype === 'compact_boundary' &&
            message.compactMetadata
          ) {
            // Release pre-compaction messages for GC. The boundary was just
            // pushed so it's the last element. query.ts already uses
            // getMessagesAfterCompactBoundary() internally, so only
            // post-boundary messages are needed going forward.
            const mutableBoundaryIdx = this.mutableMessages.length - 1
            if (mutableBoundaryIdx > 0) {
              this.mutableMessages.splice(0, mutableBoundaryIdx)
            }
            const localBoundaryIdx = messages.length - 1
            if (localBoundaryIdx > 0) {
              messages.splice(0, localBoundaryIdx)
            }

// 注：这是本文件唯一**主动释放内存**的地方。注释说：
//     「释放压缩前的消息供 GC 回收。边界刚被 push 所以它是最后一个元素。
//       query.ts 内部已经用 getMessagesAfterCompactBoundary() 过滤，
//       所以往后只需要边界之后的消息。」
//
//     两个数组都裁：
//       this.mutableMessages  会话历史（会一直活着）
//       messages              本轮 transcript 累积器
//     两边都裁到「只剩边界」。
//
//     为什么必须在这里裁？因为 mutableMessages 是**跨轮持久**的 ——
//     一个长会话如果不裁，压缩前的所有消息会一直占内存。
//     而压缩的意义本来就是「这些内容已经被摘要替代了」，
//     留着它们既没用又占空间。
//
//     ⚠ 但注意这里只裁 mutableMessages，**没有**裁 sessionStorage
//     （磁盘上的 transcript）。所以 --resume 时还是能回到压缩前 ——
//     这是好的（用户可能想往前翻），但内存和磁盘不一致。
//     这是「内存优化」和「可恢复性」的取舍：内存能省，磁盘不能省。
//
//     `splice(0, idx)` 而不是 `splice(0, idx + 1)` —— 保留边界本身。
//     用 `> 0` 守卫避免 idx 为 0 时空操作（虽然 splice(0,0) 也无害）。
            yield {
              type: 'system',
              subtype: 'compact_boundary' as const,
              session_id: getSessionId(),
              uuid: message.uuid,
              compact_metadata: toSDKCompactMetadata(message.compactMetadata),
            }
          }
          if (message.subtype === 'api_error') {
            yield {
              type: 'system',
              subtype: 'api_retry' as const,
              attempt: message.retryAttempt,
              max_retries: message.maxRetries,
              retry_delay_ms: message.retryInMs,
              error_status: message.error.status ?? null,
              error: categorizeRetryableAPIError(message.error),
              session_id: getSessionId(),
              uuid: message.uuid,
            }
          }
          // Don't yield other system messages in headless mode
          break
        }
// ── 28.8 tool_use_summary：直接转发 ──
        case 'tool_use_summary':
          // Yield tool use summary messages to SDK
          yield {
            type: 'tool_use_summary' as const,
            summary: message.summary,
            preceding_tool_use_ids: message.precedingToolUseIds,
            session_id: getSessionId(),
            uuid: message.uuid,
          }
          break
// 注：最简单的一个 case —— 形状几乎一样，只是加上 session_id。
//     这是上一份文件里「藏在模型流式输出时间里的 Haiku 摘要」
//     （query.ts 行 1469）的最终出口。
//
//     注意 `preceding_tool_use_ids` —— 摘要关联了它总结的是哪几个
//     工具调用。这样 SDK 调用方可以把摘要显示在对应工具调用的旁边，
//     而不是当成一条独立的对话消息。
      }

// ═══════════════════════════════════════════════════════════════
// ── 29. 三个"每收到一条消息就检查"的终止条件 ──
//
// 这三个检查都在 switch **外面**（每条消息之后都跑一遍）：
//   ① USD 预算超了
//   ② 结构化输出重试次数超了
//   （加上 switch 内部 max_turns_reached 那个，一共三个提前终止点）
// ═══════════════════════════════════════════════════════════════
      // Check if USD budget has been exceeded
      if (maxBudgetUsd !== undefined && getTotalCost() >= maxBudgetUsd) {
// 注：`getTotalCost() >= maxBudgetUsd` —— 用**全局**成本计数器，
//     不是本引擎的成本。所以如果有多个引擎并发（SDK 里可能），
//     它们共享同一个成本池 —— 这个检查会互相影响。
//
//     这可能是刻意的（「整个进程的花费上限」），也可能是历史遗留
//     （cost-tracker 是全局单例）。从字段名 maxBudgetUsd 是
//     引擎配置来看，语义上应该是「这个会话的预算」，
//     但实现是「进程总花费」。属于语义和实现不一致的地方。
//
//     注意检查的位置：**每条消息之后**。所以如果一条消息花了很多钱，
//     可能超了还继续跑几条才停下。不是精确的硬限额，
//     而是「尽快停下」的软限额。
        if (persistSession) {
          if (
            isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
            isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
          ) {
            await flushSessionStorage()
          }
        }
        yield {
          type: 'result',
          subtype: 'error_max_budget_usd',
          duration_ms: Date.now() - startTime,
          duration_api_ms: getTotalAPIDuration(),
          is_error: true,
          num_turns: turnCount,
          stop_reason: lastStopReason,
          session_id: getSessionId(),
          total_cost_usd: getTotalCost(),
          usage: this.totalUsage,
          modelUsage: getModelUsage(),
          permission_denials: this.permissionDenials,
          fast_mode_state: getFastModeState(
            mainLoopModel,
            initialAppState.fastMode,
          ),
          uuid: randomUUID(),
          errors: [`Reached maximum budget ($${maxBudgetUsd})`],
        }
        return
      }

// ── 30. 结构化输出的重试限制：一个"增量计数"的技巧 ──
      // Check if structured output retry limit exceeded (only on user messages)
      if (message.type === 'user' && jsonSchema) {
        const currentCalls = countToolCalls(
          this.mutableMessages,
          SYNTHETIC_OUTPUT_TOOL_NAME,
        )
        const callsThisQuery = currentCalls - initialStructuredOutputCalls
        const maxRetries = parseInt(
          process.env.MAX_STRUCTURED_OUTPUT_RETRIES || '5',
          10,
        )
        if (callsThisQuery >= maxRetries) {
          if (persistSession) {
            if (
              isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
              isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
            ) {
              await flushSessionStorage()
            }
          }
          yield {
            type: 'result',
            subtype: 'error_max_structured_output_retries',
            duration_ms: Date.now() - startTime,
            duration_api_ms: getTotalAPIDuration(),
            is_error: true,
            num_turns: turnCount,
            stop_reason: lastStopReason,
            session_id: getSessionId(),
            total_cost_usd: getTotalCost(),
            usage: this.totalUsage,
            modelUsage: getModelUsage(),
            permission_denials: this.permissionDenials,
            fast_mode_state: getFastModeState(
              mainLoopModel,
              initialAppState.fastMode,
            ),
            uuid: randomUUID(),
            errors: [
              `Failed to provide valid structured output after ${maxRetries} attempts`,
            ],
          }
          return
        }
      }
// 注：这段的关键是「增量」而不是「总量」：
//       initialStructuredOutputCalls  本轮开始前已经调用过几次（行 671）
//       currentCalls                  现在总共调用过几次
//       callsThisQuery = 差值        → **本轮**调用了几次
//
//     为什么不能直接用 currentCalls？因为 mutableMessages 是跨轮持久的。
//     如果上一轮已经调了 5 次，这一轮一进来 currentCalls 就是 5，
//     立刻触发上限。用差值才能实现「每轮独立的重试预算」。
//
//     这个技巧在本文件里只出现一次，但模式很常见：
//     **在跨轮持久的结构上做轮级限流，必须用快照差值。**
//
//     `MAX_STRUCTURED_OUTPUT_RETRIES || '5'` 默认 5 次 ——
//     因为结构化输出是「试错」性质的：模型第一次给的 JSON 可能
//     不符合 schema，要让它再试。5 次是个平衡点：
//     够覆盖常见的格式错误，又不至于无限循环烧钱。
//
//     注意这个检查只在 `message.type === 'user'` 时做 ——
//     因为 user 消息代表「一轮工具调用结束」，是检查点的自然位置。
    }

// ═══════════════════════════════════════════════════════════════
// ── 31. 结果提取：一段注释解释"为什么不能用 last(messages)" ──
//
// 这是本文件里最能体现「注释防回归」价值的一段。
// ═══════════════════════════════════════════════════════════════
    // Stop hooks yield progress/attachment messages AFTER the assistant
    // response (via yield* handleStopHooks in query.ts). Since #23537 pushes
    // those to `messages` inline, last(messages) can be a progress/attachment
    // instead of the assistant — which makes textResult extraction below
    // return '' and -p mode emit a blank line. Allowlist to assistant|user:
    // isResultSuccessful handles both (user with all tool_result blocks is a
    // valid successful terminal state).
// 译：stop hooks 在 assistant 响应**之后**产出 progress/attachment 消息
//     （通过 query.ts 里的 yield* handleStopHooks）。自从 #23537 那些消息
//     被内联 push 进 `messages` 之后，last(messages) 可能是 progress/attachment
//     而不是 assistant —— 这会让下面的 textResult 提取返回 ''，
//     于是 -p 模式输出一个空行。改成只允许 assistant|user：
//     isResultSuccessful 两者都能处理（全是 tool_result 块的 user 消息
//     也是合法的成功终态）。
//
// 注：这个 bug 的形态值得记住：
//
//     【起因】一个优化（#23537：把 stop hook 的产出内联 push 进 messages）
//     【后果】数组最后一条不再是「模型的回答」，而是「hook 的副产品」
//     【症状】`claude -p "问题"` 输出了一个空行 —— 但退出码是 0，
//             没有任何错误信息
//     【为什么难查】因为逻辑上一切正常：message 都被正确处理了、
//             历史也是完整的，只是「取最后一条」这个假设失效了。
//
//     【修复】把「最后一条」改成「最后一条 assistant 或 user」——
//     用 findLast + 谓词，而不是 last。
//
//     这是一个典型的「顺序假设被打破」的 bug。原代码隐含假设
//     「messages 最后一条一定是模型刚说的话」，而一旦有别的组件
//     往数组末尾追加东西，假设就不成立了。
//
//     注释里提到 isResultSuccessful 「两者都能处理」，这也是必要的：
//     如果最后一条是 user（全是 tool_result 块），那也是一个**合法的
//     成功终态**（模型调完工具、工具跑完、没有后续输出）。所以
//     不能简单地「找最后一条 assistant」，要把 user 也算进来。
    const result = messages.findLast(
      m => m.type === 'assistant' || m.type === 'user',
    )
    // Capture for the error_during_execution diagnostic — isResultSuccessful
// 注：`edeResultType` / `edeLastContentType` 是给错误诊断用的。
//     注释解释了为什么必须先算出来：
//     「isResultSuccessful 是类型谓词（message is Message），所以
//       在 false 分支里 `result` 会被收窄成 never，那些访问无法通过类型检查。」
//
//     这是 TypeScript 类型谓词的一个反直觉行为：
//         if (!isResultSuccessful(result)) {
//           result.type      // ← 编译错误：result 是 never
//         }
//     因为谓词断言「如果返回 true，result 就是 Message」，
//     那么在一处返回 false 的分支里，TypeScript 推导出
//     「result 不是 Message」—— 而 result 本来就是 Message，
//     所以变成 never（不可能的值）。
//
//     解法：在 if 之前先把需要的字段算成字符串（行 1064-1068），
//     这样 false 分支里只用字符串变量，不碰 result。
//
//     这是个「类型系统太聪明反而碍事」的例子。实际项目里遇到谓词，
//     经常需要在判断前先提取数据 —— 这个模式值得记住。
    // is a type predicate (message is Message), so inside the false branch
    // `result` narrows to never and these accesses don't typecheck.
    const edeResultType = result?.type ?? 'undefined'
    const edeLastContentType =
      result?.type === 'assistant'
        ? (last(result.message.content)?.type ?? 'none')
        : 'n/a'

// ── 32. 五种 result：本文件对外的全部输出契约 ──
    // Flush buffered transcript writes before yielding result.
    // The desktop app kills the CLI process immediately after receiving the
    // result message, so any unflushed writes would be lost.
    if (persistSession) {
      if (
        isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
        isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
      ) {
        await flushSessionStorage()
      }
    }
// 注：`if (persistSession)` + eager flush —— 原因在下一行的注释里：
//     「桌面应用收到 result 消息后会立刻杀掉 CLI 进程，所以任何
//       未 flush 的写入都会丢失。」
//
//     这是「进程生命周期由外部控制」的典型场景：
//     CLI 作为子进程运行，它的生死由父进程（桌面应用）决定。
//     父进程的判据是「收到 result 消息」—— 所以 result 是**最后一条**
//     消息，发出去之后必须保证所有副作用已经落盘。
//
//     这个约束解释了整段代码里为什么有 6 处 flushSessionStorage：
//     每一个可能「发 result 然后退出」的地方都要 flush。
//     少一处就会出现「偶尔丢历史」的间歇性 bug。

    if (!isResultSuccessful(result, lastStopReason)) {
// 注：第一种失败结果。`isResultSuccessful(result, lastStopReason)` 检查两件事：
//       · result 是「assistant 带 text/thinking」或「user 带 tool_result」
//       · stop_reason 是 end_turn
//     任一不满足就认为「这一轮没正常结束」。
//
//     为什么要检查 stop_reason？因为模型可能在 tool_use 处停下
//     （stop_reason: 'tool_use'），而那意味着「还有工具没执行」——
//     不该出现在这里（如果出现了，说明 query.ts 有 bug）。
//
//     注意 errors 数组的构造（行 1106-1115）用了 IIFE（立即执行函数）——
//     因为要在里面做多行逻辑（取水位线、切片、map）。写成内联表达式
//     会很难读。这是「在对象字面量里做复杂计算」的常见技巧。
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        duration_ms: Date.now() - startTime,
        duration_api_ms: getTotalAPIDuration(),
        is_error: true,
        num_turns: turnCount,
        stop_reason: lastStopReason,
        session_id: getSessionId(),
        total_cost_usd: getTotalCost(),
        usage: this.totalUsage,
        modelUsage: getModelUsage(),
        permission_denials: this.permissionDenials,
        fast_mode_state: getFastModeState(
          mainLoopModel,
          initialAppState.fastMode,
        ),
        uuid: randomUUID(),
        // Diagnostic prefix: these are what isResultSuccessful() checks — if
// 注：注释解释了这个诊断字符串的价值：
//     「这些是 isResultSuccessful() 检查的东西 —— 如果 result 类型
//       不是 assistant-with-text/thinking 或 user-with-tool_result，
//       且 stop_reason 不是 end_turn，那就是它触发的原因。」
//
//     也就是说：这个字符串把「判断依据」和「实际值」并列输出：
//         result_type=assistant last_content_type=tool_use stop_reason=tool_use
//     只看这一行就知道为什么判定失败 —— 不需要再去猜。
//
//     后半句还记录了一个改进：
//     「errors[] 通过水位线限定在本轮；之前它会把整个进程的 logError
//       缓冲全倒出来（ripgrep 超时、ENOENT 等）。」
//
//     这是「错误报告的信噪比」问题：一个 result 里塞了几百条
//     无关的历史错误，等于没有错误信息。用水位线（行 669）切出
//     本轮的部分，才让这个字段真正可用。
        // the result type isn't assistant-with-text/thinking or user-with-
        // tool_result, and stop_reason isn't end_turn, that's why this fired.
        // errors[] is turn-scoped via the watermark; previously it dumped the
        // entire process's logError buffer (ripgrep timeouts, ENOENT, etc).
        errors: (() => {
          const all = getInMemoryErrors()
          const start = errorLogWatermark
            ? all.lastIndexOf(errorLogWatermark) + 1
            : 0
          return [
            `[ede_diagnostic] result_type=${edeResultType} last_content_type=${edeLastContentType} stop_reason=${lastStopReason}`,
            ...all.slice(start).map(_ => _.error),
          ]
        })(),
      }
      return
    }

// ── 33. 成功结果：最后一条消息的文本提取 ──
    // Extract the text result based on message type
    let textResult = ''
    let isApiError = false

    if (result.type === 'assistant') {
      const lastContent = last(result.message.content)
      if (
        lastContent?.type === 'text' &&
        !SYNTHETIC_MESSAGES.has(lastContent.text)
      ) {
        textResult = lastContent.text
      }
      isApiError = Boolean(result.isApiErrorMessage)
    }

    yield {
      type: 'result',
      subtype: 'success',
      is_error: isApiError,
      duration_ms: Date.now() - startTime,
      duration_api_ms: getTotalAPIDuration(),
      num_turns: turnCount,
      result: textResult,
      stop_reason: lastStopReason,
      session_id: getSessionId(),
      total_cost_usd: getTotalCost(),
      usage: this.totalUsage,
      modelUsage: getModelUsage(),
      permission_denials: this.permissionDenials,
      structured_output: structuredOutputFromTool,
      fast_mode_state: getFastModeState(
        mainLoopModel,
        initialAppState.fastMode,
      ),
      uuid: randomUUID(),
    }
  }
// 注：成功路径的四个判断，每个都有理由：
//
//     `result.type === 'assistant'`      只有 assistant 才有 text
//     `lastContent?.type === 'text'`     最后一个 block 必须是文本
//                                        （如果是 tool_use，说明还有工具没跑）
//     `!SYNTHETIC_MESSAGES.has(...)`     排除合成的占位文本
//                                        （比如「[Request interrupted]」这类）
//     textResult = lastContent.text      只取最后一段文本
//
//     只取最后一段，不拼接全部 —— 因为前面的文本通常是「过程说明」
//     （「我先看一下文件」），用户真正要的答案是最后那段。
//     这个选择符合 -p 模式的用法（拿一个最终答案）。
//
//     `isApiError = Boolean(result.isApiErrorMessage)` —— 注意
//     subtype 仍然是 'success'，但 is_error 可能是 true。
//     这是个刻意的设计：消息**成功送达**（success），
//     但内容是 API 错误（is_error）。两个维度独立。
//     SDK 调用方要分别判断这两个字段，不能只看一个。
//
//     `structured_output: structuredOutputFromTool` —— 从 attachment 里
//     提取的（行 839）。如果调用方传了 jsonSchema，这就是它的产出。
//     没传时是 undefined，字段仍然出现（值为 undefined）——
//     JSON 序列化时会被省略。

// ── 34. 四个方法：全部是透传 ──
  interrupt(): void {
    this.abortController.abort()
  }

  getMessages(): readonly Message[] {
    return this.mutableMessages
  }

  getReadFileState(): FileStateCache {
    return this.readFileState
  }

  getSessionId(): string {
    return getSessionId()
  }

  setModel(model: string): void {
    this.config.userSpecifiedModel = model
  }
}
// 注：四个方法都不做任何逻辑：
//       interrupt()         → abortController.abort()
//       getMessages()       → 返回 mutableMessages 的只读视图
//       getReadFileState()  → 返回文件缓存引用
//       getSessionId()      → 全局 sessionId
//       setModel()          → 改配置里的模型
//
//     注意 `getMessages()` 返回 `readonly Message[]` —— 只是类型层面的
//     只读，运行时仍是同一个数组引用。调用方如果用 `as Message[]` 强转，
//     还是能改。TypeScript 的 readonly 是约定，不是保护。
//
//     `setModel` 改的是 `this.config.userSpecifiedModel` ——
//     下一轮 submitMessage 会读到新值（行 274 解构）。
//     但**当前正在跑的轮次不受影响**（因为配置已经在行 213 解构成局部变量了）。
//     所以「改模型」的效果从下一轮开始 —— 这个时序没写在文档里，
//     只能从代码推出来。

// ═══════════════════════════════════════════════════════════════
// ── 35. ask()：一次性调用的门面 ──
//
// 本文件有两个出口：QueryEngine 类（多轮）和 ask()（单轮）。
// ask() 的价值只有一个：**让调用方不用管状态**。
// 它内部 new 一个引擎、跑一轮、回写文件缓存，然后整个丢掉。
// ═══════════════════════════════════════════════════════════════
/**
 * Sends a single prompt to the Claude API and returns the response.
 * Assumes that claude is being used non-interactively -- will not
 * ask the user for permissions or further input.
 *
 * Convenience wrapper around QueryEngine for one-shot usage.
 */
// 译：向 Claude API 发送一条提示词并返回响应。
//     假定 claude 是以非交互方式使用的 —— 不会向用户请求权限
//     或进一步输入。是 QueryEngine 的便捷包装，用于一次性使用。
//
// 注：注意 "Assumes that claude is being used non-interactively" ——
//     这不是限制，而是**前提**：如果 canUseTool 的实现会弹交互式
//     权限对话框，那这个假设就不成立，行为会是未定义的
//     （可能在 stdin 上卡死）。
//
//     所以 ask() 的正确用法是：调用方自己提供 canUseTool，
//     且它的实现必须是确定性的（看规则、不弹窗）。
export async function* ask({
  commands,
  prompt,
  promptUuid,
  isMeta,
  cwd,
  tools,
  mcpClients,
  verbose = false,
  thinkingConfig,
  maxTurns,
  maxBudgetUsd,
  taskBudget,
  canUseTool,
  mutableMessages = [],
  getReadFileCache,
  setReadFileCache,
  customSystemPrompt,
  appendSystemPrompt,
  userSpecifiedModel,
  fallbackModel,
  jsonSchema,
  getAppState,
  setAppState,
  abortController,
  replayUserMessages = false,
  includePartialMessages = false,
  handleElicitation,
  agents = [],
  setSDKStatus,
  orphanedPermission,
}: {
  commands: Command[]
  prompt: string | Array<ContentBlockParam>
  promptUuid?: string
  isMeta?: boolean
  cwd: string
  tools: Tools
  verbose?: boolean
  mcpClients: MCPServerConnection[]
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  taskBudget?: { total: number }
  canUseTool: CanUseToolFn
  mutableMessages?: Message[]
  customSystemPrompt?: string
  appendSystemPrompt?: string
  userSpecifiedModel?: string
  fallbackModel?: string
  jsonSchema?: Record<string, unknown>
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getReadFileCache: () => FileStateCache
  setReadFileCache: (cache: FileStateCache) => void
  abortController?: AbortController
  replayUserMessages?: boolean
  includePartialMessages?: boolean
  handleElicitation?: ToolUseContext['handleElicitation']
  agents?: AgentDefinition[]
  setSDKStatus?: (status: SDKStatus) => void
  orphanedPermission?: OrphanedPermission
}): AsyncGenerator<SDKMessage, void, unknown> {
  const engine = new QueryEngine({
    cwd,
    tools,
    commands,
    mcpClients,
    agents,
    canUseTool,
    getAppState,
    setAppState,
    initialMessages: mutableMessages,
    readFileCache: cloneFileStateCache(getReadFileCache()),
    customSystemPrompt,
    appendSystemPrompt,
    userSpecifiedModel,
    fallbackModel,
    thinkingConfig,
    maxTurns,
    maxBudgetUsd,
    taskBudget,
    jsonSchema,
    verbose,
    handleElicitation,
    replayUserMessages,
    includePartialMessages,
    setSDKStatus,
    abortController,
    orphanedPermission,
    ...(feature('HISTORY_SNIP')
// 注：这就是行 158-172 那个 snipReplay 字段的**唯一注入点**。
//     三个细节：
//
//     ① 只在 `feature('HISTORY_SNIP')` 为真时才展开这个属性
//        （`...(cond ? { snipReplay } : {})`）。
//        所以外部版里 QueryEngineConfig 根本没有这个字段 ——
//        这就是「特性门控的字符串留在门控模块里」的实现方式。
//
//     ② 回调内部先 `isSnipBoundaryMessage(yielded)` 判断，
//        不是边界就返回 undefined —— 让 QueryEngine 知道「这条我不能处理」。
//
//     ③ `snipCompactIfNeeded(store, { force: true })` 传了 force ——
//        因为「遇到边界」就是明确的执行信号，不需要再判断阈值。
//
//     注意用了 `snipProjection!` 和 `snipModule!` 两个非空断言 ——
//     因为它们在外部版是 null，但这整段代码只在 feature 为真时才会执行，
//     所以运行时一定非空。这是 DCE 模式下无法避免的断言。
      ? {
          snipReplay: (yielded: Message, store: Message[]) => {
            if (!snipProjection!.isSnipBoundaryMessage(yielded))
              return undefined
            return snipModule!.snipCompactIfNeeded(store, { force: true })
          },
        }
      : {}),
  })

  try {
// 注：`try { yield* ... } finally { setReadFileCache(...) }` ——
//     这个 finally 是本文件最重要的一个正确性保证。
//
//     【为什么需要它】
//     readFileState 是「模型读过哪些文件、内容是什么」的缓存，
//     用来避免重复读盘、以及做「文件是否被外部修改」的检测。
//     它必须**回写**给调用方，否则下一轮 ask() 会从零开始
//     （每个文件都要重新读一遍）。
//
//     【为什么用 finally 而不是正常路径】
//     因为 submitMessage 可能在任意时刻被中断、抛错、
//     或者被调用方提前 .return()。所有这些路径都必须回写 ——
//     否则「读了一半就被中断」的那一轮，读盘成果全丢。
//     用 finally 能覆盖所有退出方式。
//
//     【为什么是 setReadFileCache 而不是直接改】
//     因为传进来的是 `cloneFileStateCache(getReadFileCache())`（行 1259）——
//     引擎内部改的是**克隆**，原件没变。所以必须显式回写。
//     如果不克隆（直接共享引用），就不需要这一步，但那样
//     中断时会把「未完成的读取」污染到调用方的缓存里。
//     克隆 + 回写 = 「要么全成功，要么全不变」的原子性。
//
//     这是一个「用克隆换原子性」的设计，代价是多一次拷贝。
    yield* engine.submitMessage(prompt, {
      uuid: promptUuid,
      isMeta,
    })
  } finally {
    setReadFileCache(engine.getReadFileState())
  }
}
// ═══════════════════════════════════════════════════════════════
// 【本文件小结 · 四个可以带走的结论】
//
// 1. 它是「会话状态的宿主 + 内外协议的边界」
//    query.ts 无状态（Params 进，消息出），所以状态必须有地方存 ——
//    就是这里。而内外两种消息类型（9 种内部 / 5 种 SDK）的转换
//    也在这里。读这个文件只需盯两件事：this 字段（状态）
//    和 switch（转换）。
//
// 2. 大量代码在做「时序正确性」，而不是业务逻辑
//    最重要的三段注释都是时序问题：
//      · 行 436 为什么要在进 query 之前落盘（否则 --resume 失败）
//      · 行 717 为什么 assistant 消息不能 await（否则 usage 丢失）
//      · 行 771 为什么 progress 要内联记录（否则 resume 链条分叉）
//    这三处的共同点：单轮测试正常，长会话/resume 才暴露。
//
// 3. 「内部消化」和「对外可见」是两件事
//    tombstone、progress、attachment、stream_request_start 都要进
//    mutableMessages（历史需要完整），但都不 yield（协议不需要）。
//    混淆这两者会导致两种 bug：历史缺消息（上下文断裂）、
//    或协议收到垃圾（客户端崩溃）。
//
// 4. 每条终止路径都要手动 flush + 包装 result
//    五个终止点（max_turns / max_budget / structured_output_retries /
//    error_during_execution / success）各自写一遍 result 对象，
//    每个都要 flush。这是「进程可能被父进程立刻杀掉」这个约束
//    渗透出来的重复。
//
// 下一步：src/services/api/claude.ts —— 最底层的 API 客户端。
// 如果这个文件是「会话」，query.ts 是「一轮」，那 claude.ts 就是
// 「一次 HTTP 请求」：SSE 解析、重试、缓存控制、图片处理、错误分类。
// ═══════════════════════════════════════════════════════════════
