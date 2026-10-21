// ═══════════════════════════════════════════════════════════════
//  api/promptCacheBreakDetection：缓存为什么断了？
// ═══════════════════════════════════════════════════════════════
//
//  提示词缓存能省掉 90% 的输入 token 成本，但它有个残酷的性质：
//  **前缀里改一个字节，后面整段缓存全部失效，而且不会报错。**
//
//  于是这个文件做一件事：每次请求前把「可能影响缓存键的东西」快照下来，
//  和上一次比，一旦发现「缓存命中量掉了」就反查是谁变的，并写一份 diff。
//
//  727 行，是本目录里唯一一个「主动诊断」的模块，其余都是被动记录。
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { createPatch } from 'diff'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AgentId } from 'src/types/ids.js'
import type { Message } from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import { djb2Hash } from 'src/utils/hash.js'
import { logError } from 'src/utils/log.js'
import { getClaudeTempDir } from 'src/utils/permissions/filesystem.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import type { QuerySource } from '../../constants/querySource.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

function getCacheBreakDiffPath(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return join(getClaudeTempDir(), `cache-break-${suffix}.diff`)
}

type PreviousState = {
  systemHash: number
  toolsHash: number
  /** Hash of system blocks WITH cache_control intact. Catches scope/TTL flips
   *  (global↔org, 1h↔5m) that stripCacheControl erases from systemHash. */
  cacheControlHash: number
  toolNames: string[]
  /** Per-tool schema hash. Diffed to name which tool's description changed
   *  when toolSchemasChanged but added=removed=0 (77% of tool breaks per
   *  BQ 2026-03-22). AgentTool/SkillTool embed dynamic agent/command lists. */
  perToolHashes: Record<string, number>
  systemCharCount: number
  model: string
  fastMode: boolean
  /** 'tool_based' | 'system_prompt' | 'none' — flips when MCP tools are
   *  discovered/removed. */
  globalCacheStrategy: string
  /** Sorted beta header list. Diffed to show which headers were added/removed. */
  betas: string[]
  /** AFK_MODE_BETA_HEADER presence — should NOT break cache anymore
   *  (sticky-on latched in claude.ts). Tracked to verify the fix. */
  autoModeActive: boolean
  /** Overage state flip — should NOT break cache anymore (eligibility is
   *  latched session-stable in should1hCacheTTL). Tracked to verify the fix. */
  isUsingOverage: boolean
  /** Cache-editing beta header presence — should NOT break cache anymore
   *  (sticky-on latched in claude.ts). Tracked to verify the fix. */
  cachedMCEnabled: boolean
  /** Resolved effort (env → options → model default). Goes into output_config
   *  or anthropic_internal.effort_override. */
  effortValue: string
  /** Hash of getExtraBodyParams() — catches CLAUDE_CODE_EXTRA_BODY and
   *  anthropic_internal changes. */
  extraBodyHash: number
  callCount: number
  pendingChanges: PendingChanges | null
  prevCacheReadTokens: number | null
  /** Set when cached microcompact sends cache_edits deletions. Cache reads
   *  will legitimately drop — this is expected, not a break. */
  cacheDeletionsPending: boolean
  buildDiffableContent: () => string
}

type PendingChanges = {
  systemPromptChanged: boolean
  toolSchemasChanged: boolean
  modelChanged: boolean
  fastModeChanged: boolean
  cacheControlChanged: boolean
  globalCacheStrategyChanged: boolean
  betasChanged: boolean
  autoModeChanged: boolean
  overageChanged: boolean
  cachedMCChanged: boolean
  effortChanged: boolean
  extraBodyChanged: boolean
  addedToolCount: number
  removedToolCount: number
  systemCharDelta: number
  addedTools: string[]
  removedTools: string[]
  changedToolSchemas: string[]
  previousModel: string
  newModel: string
  prevGlobalCacheStrategy: string
  newGlobalCacheStrategy: string
  addedBetas: string[]
  removedBetas: string[]
  prevEffortValue: string
  newEffortValue: string
  buildPrevDiffableContent: () => string
}

const previousStateBySource = new Map<string, PreviousState>()

// 【上限 10 个追踪源 —— 注释算了一笔内存账】
//
//  原文：Each entry stores a ~300KB+ diffableContent string (serialized system
//  prompt + tool schemas). Without a cap, spawning many subagents (each with a
//  unique agentId key) causes the map to grow indefinitely.
//
//  300KB × 无限个子 agent = 内存泄漏。这就是为什么需要 MAX_TRACKED_SOURCES。
//
//  值得学的是这段注释的写法：**它给了量化依据（300KB），而不是只说
//  「防止内存增长」。** 有了数字，读的人才能判断「10 这个值合不合理」：
//  10 × 300KB ≈ 3MB，可以接受；如果是 10 × 30MB，那这个设计就有问题。
//
//  判据：凡是「加了一个上限」的地方，最好同时写清「单项成本 × 上限 = 总成本」，
//  否则后来的人不知道该不该调这个数。
// Cap the number of tracked sources to prevent unbounded memory growth.
// Each entry stores a ~300KB+ diffableContent string (serialized system prompt
// + tool schemas). Without a cap, spawning many subagents (each with a unique
// agentId key) causes the map to grow indefinitely.
const MAX_TRACKED_SOURCES = 10

// 【只追踪五个前缀 —— 这就是「哪些请求值得诊断」的定义】
//
//      repl_main_thread    主对话线程
//      sdk                 SDK 调用
//      agent:custom / agent:default / agent:builtin    三种子 agent
//
//  注释（第 143 行）解释了**为什么不追踪其他来源**：
//
//      Untracked sources (speculation, session_memory, prompt_suggestion, etc.)
//      are short-lived forked agents where cache break detection provides no
//      value — they run 1-3 turns with a fresh agentId each time, so there's
//      nothing meaningful to compare against.
//
//  翻译：那些 fork 出来的短命 agent 每次都是新 agentId，跑 1-3 轮就结束，
//  没有「上一次」可比 —— 诊断它们毫无意义。
//
//  这正是「诊断类功能」的通用取舍：**它只对「长期存在的对象」有价值。**
//  一次性调用的东西不需要监控趋势，只需要看单次日志。
//
//  注释最后一句也很重要：Their cache metrics are still logged via
//  tengu_api_success for analytics —— 也就是「不诊断」不等于「不采集」，
//  数据照记，只是不做对比分析。
const TRACKED_SOURCE_PREFIXES = [
  'repl_main_thread',
  'sdk',
  'agent:custom',
  'agent:default',
  'agent:builtin',
]

// Minimum absolute token drop required to trigger a cache break warning.
// Small drops (e.g., a few thousand tokens) can happen due to normal variation
// and aren't worth alerting on.
// 【2000 token 的阈值 —— 为什么小抖动不算「断」】
//
//  原文：Small drops (e.g., a few thousand tokens) can happen due to normal
//  variation and aren't worth alerting on.
//
//  正常波动来自哪里？主要是**缓存的分块粒度**：服务端的缓存以一定块大小
//  为单位命中，末尾不满一块的部分不算命中。所以每次请求的 cache_read
//  天然会有几百到几千 token 的浮动。
//
//  阈值定在 2000，就是在「滤掉正常浮动」和「不放过真问题」之间取值。
//  定太低 → 每次请求都报警，没人看；定太高 → 真的断了也发现不了。
//
//  这类阈值没办法算出来，只能**先观察分布再定**。所以注释里写的是
//  「aren't worth alerting on」（不值得报警），而不是「等于噪声上限」——
//  措辞很诚实：这是经验值。
const MIN_CACHE_MISS_TOKENS = 2_000

// 【两个 TTL 常量，其中 1 小时那个是 export 的 —— 为什么】
//
//      CACHE_TTL_5MIN_MS    内部用，判断「这次断是不是 5 分钟过期了」
//      CACHE_TTL_1HOUR_MS   export，别处也要用
//
//  为什么需要这两个阈值？因为「缓存命中量掉了」有一个完全无辜的解释：
//  **上一轮和这一轮隔太久，服务端缓存过期了。**
//
//  所以判断逻辑必然是：
//
//      掉了，但距离上次请求超过 TTL  →  这是过期，不是断
//      掉了，而且距离上次请求很短    →  这是真断，要查
//
//  这就是「先排除正常解释，再报警」的标准思路。没有这一步，所有
//  「用户去泡了杯咖啡」都会被报成缓存断裂。
//
//  另一个 TTL 之所以要 export，是因为别处（成本估算、压缩策略）也要
//  知道「1 小时的缓存什么时候过期」，不能各自硬编码。
// Anthropic's server-side prompt cache TTL thresholds to test.
// Cache breaks after these durations are likely due to TTL expiration
// rather than client-side changes.
const CACHE_TTL_5MIN_MS = 5 * 60 * 1000
export const CACHE_TTL_1HOUR_MS = 60 * 60 * 1000

// Models to exclude from cache break detection (e.g., haiku has different caching behavior)
function isExcludedModel(model: string): boolean {
  return model.includes('haiku')
}

// 【排除 haiku 模型 —— 一行注释，一个被承认的例外】
//
//      function isExcludedModel(model) { return model.includes('haiku') }
//
//  注释：e.g., haiku has different caching behavior
//
//  「行为不同」具体是什么没说，但这一类排除在诊断系统里是必须的：
//  **诊断逻辑建立在「正常情况有稳定模式」的假设上，而有些样本根本不遵循
//  那个模式。** 把它们排除掉，比为了让它们也通过而放宽阈值更好。
//
//  注意判断用的是 includes 而不是精确匹配 —— 因为模型名有一堆变体
//  （带日期、带 provider 前缀）。宽松匹配在这里是对的：**宁可少诊断一个，
//  不要多报一个假警。**
/**
 * Returns the tracking key for a querySource, or null if untracked.
 * Compact shares the same server-side cache as repl_main_thread
 * (same cacheSafeParams), so they share tracking state.
 *
 * For subagents with a tracked querySource, uses the unique agentId to
 * isolate tracking state. This prevents false positive cache break
 * notifications when multiple instances of the same agent type run
 * concurrently.
 *
 * Untracked sources (speculation, session_memory, prompt_suggestion, etc.)
 * are short-lived forked agents where cache break detection provides no
 * value — they run 1-3 turns with a fresh agentId each time, so there's
 * nothing meaningful to compare against. Their cache metrics are still
 * logged via tengu_api_success for analytics.
 */
function getTrackingKey(
  querySource: QuerySource,
  agentId?: AgentId,
): string | null {
  if (querySource === 'compact') return 'repl_main_thread'
  for (const prefix of TRACKED_SOURCE_PREFIXES) {
    if (querySource.startsWith(prefix)) return agentId || querySource
  }
  return null
}

// 【stripCacheControl：比哈希之前先摘掉 cache_control 字段】
//
//  为什么？因为 cache_control 是**我们贴在内容上的标记**（「从这里开始缓存」），
//  它不是内容本身。
//
//  如果把它算进哈希，会出现一个很微妙的问题：缓存断点位置调整了
//  （比如多贴了一个 cache_control），哈希变了，于是报告「内容变了」——
//  但其实内容一个字节没改。
//
//  所以比较之前要摘掉它。**这是「比较的是语义，不是字节」的典型手法**：
//  先归一化，再比较，否则会得到一堆无意义的差异。
//
//  实现用了 `const { cache_control: _, ...rest } = item` ——
//  「取出并丢弃」的写法，和 dumpPrompts.ts 里摘 messages 是同一个套路。
//  注意它返回新对象，不改原数组（Map 里的快照要保持原样，因为别处还要用）。
function stripCacheControl(
  items: ReadonlyArray<Record<string, unknown>>,
): unknown[] {
  return items.map(item => {
    if (!('cache_control' in item)) return item
    const { cache_control: _, ...rest } = item
    return rest
  })
}

function computeHash(data: unknown): number {
  const str = jsonStringify(data)
  if (typeof Bun !== 'undefined') {
    const hash = Bun.hash(str)
    // Bun.hash can return bigint for large inputs; convert to number safely
    return typeof hash === 'bigint' ? Number(hash & 0xffffffffn) : hash
  }
  // Fallback for non-Bun runtimes (e.g. Node.js via npm global install)
  return djb2Hash(str)
}

// 【MCP 工具名必须脱敏 —— 注释写清了原因】
//
//  原文：MCP tool names are user-controlled (server config) and may leak
//  filepaths. Collapse them to 'mcp'; built-in names are a fixed vocabulary.
//
//  两个理由，都很硬：
//
//  1. **工具名来自用户配置**（MCP 服务器自己起的名），可能包含路径、项目名、
//     甚至密钥。这个文件会把 diff 写到磁盘、也可能进日志 —— 所以必须脱敏。
//  2. **内置工具名是固定词汇表**，可以安全地保留原样。
//
//  做法是把所有 mcp__ 开头的名字统一压成 'mcp'。代价是「哪个 MCP 工具变了」
//  看不出来 —— 但能看出「MCP 工具这一块变了」，对定位够了。
//
//  这是一条贯穿整个仓库的规则：**任何「用户可控的字符串」都不许原样进
//  日志或上报。** 前面 logging.ts 里那个超长类型名
//  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 是同一个约束的
//  另一种表达方式（一个靠类型名提醒，一个靠运行时替换）。
/** MCP tool names are user-controlled (server config) and may leak filepaths.
 *  Collapse them to 'mcp'; built-in names are a fixed vocabulary. */
function sanitizeToolName(name: string): string {
  return name.startsWith('mcp__') ? 'mcp' : name
}

function computePerToolHashes(
  strippedTools: ReadonlyArray<unknown>,
  names: string[],
): Record<string, number> {
  const hashes: Record<string, number> = {}
  for (let i = 0; i < strippedTools.length; i++) {
    hashes[names[i] ?? `__idx_${i}`] = computeHash(strippedTools[i])
  }
  return hashes
}

function getSystemCharCount(system: TextBlockParam[]): number {
  let total = 0
  for (const block of system) {
    total += block.text.length
  }
  return total
}

function buildDiffableContent(
  system: TextBlockParam[],
  tools: BetaToolUnion[],
  model: string,
): string {
  const systemText = system.map(b => b.text).join('\n\n')
  const toolDetails = tools
    .map(t => {
      if (!('name' in t)) return 'unknown'
      const desc = 'description' in t ? t.description : ''
      const schema = 'input_schema' in t ? jsonStringify(t.input_schema) : ''
      return `${t.name}\n  description: ${desc}\n  input_schema: ${schema}`
    })
    .sort()
    .join('\n\n')
  return `Model: ${model}\n\n=== System Prompt ===\n\n${systemText}\n\n=== Tools (${tools.length}) ===\n\n${toolDetails}\n`
}

// 【快照类型：所有字段都是可选的】
//
//  原文注释：All fields are optional so the call site can add incrementally;
//  undefined fields compare as stable.
//
//  两个设计意图：
//
//  1. **调用点可以增量接入**。今天只想比 system 和 tools，就只传这两个；
//     以后再补 betas、mcpServers，不用改类型。
//  2. **undefined 等同于「没变化」**。所以老调用点不传的字段永远不会
//     被误报成「变了」。
//
//  这是一个「渐进式诊断」的接口设计：**新增维度不破坏已有调用方。**
//  代价是它无法表达「这个字段被删了」和「这次没采集这个字段」的区别 ——
//  两者都是 undefined。在诊断场景里这个模糊是可以接受的，因为
//  「没采集」只发生在老调用点，而那些调用点本来就不该报这个维度。
/** Extended tracking snapshot — everything that could affect the server-side
 *  cache key that we can observe from the client. All fields are optional so
 *  the call site can add incrementally; undefined fields compare as stable. */
export type PromptStateSnapshot = {
  system: TextBlockParam[]
  toolSchemas: BetaToolUnion[]
  querySource: QuerySource
  model: string
  agentId?: AgentId
  fastMode?: boolean
  globalCacheStrategy?: string
  betas?: readonly string[]
  autoModeActive?: boolean
  isUsingOverage?: boolean
  cachedMCEnabled?: boolean
  effortValue?: string | number
  extraBodyParams?: unknown
}

/**
 * Phase 1 (pre-call): Record the current prompt/tool state and detect what changed.
 * Does NOT fire events — just stores pending changes for phase 2 to use.
 */
export function recordPromptState(snapshot: PromptStateSnapshot): void {
  try {
    const {
      system,
      toolSchemas,
      querySource,
      model,
      agentId,
      fastMode,
      globalCacheStrategy = '',
      betas = [],
      autoModeActive = false,
      isUsingOverage = false,
      cachedMCEnabled = false,
      effortValue,
      extraBodyParams,
    } = snapshot
    const key = getTrackingKey(querySource, agentId)
    if (!key) return

    const strippedSystem = stripCacheControl(
      system as unknown as ReadonlyArray<Record<string, unknown>>,
    )
    const strippedTools = stripCacheControl(
      toolSchemas as unknown as ReadonlyArray<Record<string, unknown>>,
    )

    const systemHash = computeHash(strippedSystem)
    const toolsHash = computeHash(strippedTools)
    // Hash the full system array INCLUDING cache_control — this catches
    // scope flips (global↔org/none) and TTL flips (1h↔5m) that the stripped
    // hash can't see because the text content is identical.
    const cacheControlHash = computeHash(
      system.map(b => ('cache_control' in b ? b.cache_control : null)),
    )
    const toolNames = toolSchemas.map(t => ('name' in t ? t.name : 'unknown'))
    // Only compute per-tool hashes when the aggregate changed — common case
    // (tools unchanged) skips N extra jsonStringify calls.
    const computeToolHashes = () =>
      computePerToolHashes(strippedTools, toolNames)
    const systemCharCount = getSystemCharCount(system)
    const lazyDiffableContent = () =>
      buildDiffableContent(system, toolSchemas, model)
    const isFastMode = fastMode ?? false
    const sortedBetas = [...betas].sort()
    const effortStr = effortValue === undefined ? '' : String(effortValue)
    const extraBodyHash =
      extraBodyParams === undefined ? 0 : computeHash(extraBodyParams)

    const prev = previousStateBySource.get(key)

    if (!prev) {
      // Evict oldest entries if map is at capacity
      while (previousStateBySource.size >= MAX_TRACKED_SOURCES) {
        const oldest = previousStateBySource.keys().next().value
        if (oldest !== undefined) previousStateBySource.delete(oldest)
      }

      previousStateBySource.set(key, {
        systemHash,
        toolsHash,
        cacheControlHash,
        toolNames,
        systemCharCount,
        model,
        fastMode: isFastMode,
        globalCacheStrategy,
        betas: sortedBetas,
        autoModeActive,
        isUsingOverage,
        cachedMCEnabled,
        effortValue: effortStr,
        extraBodyHash,
        callCount: 1,
        pendingChanges: null,
        prevCacheReadTokens: null,
        cacheDeletionsPending: false,
        buildDiffableContent: lazyDiffableContent,
        perToolHashes: computeToolHashes(),
      })
      return
    }

    prev.callCount++

    const systemPromptChanged = systemHash !== prev.systemHash
    const toolSchemasChanged = toolsHash !== prev.toolsHash
    const modelChanged = model !== prev.model
    const fastModeChanged = isFastMode !== prev.fastMode
    const cacheControlChanged = cacheControlHash !== prev.cacheControlHash
    const globalCacheStrategyChanged =
      globalCacheStrategy !== prev.globalCacheStrategy
    const betasChanged =
      sortedBetas.length !== prev.betas.length ||
      sortedBetas.some((b, i) => b !== prev.betas[i])
    const autoModeChanged = autoModeActive !== prev.autoModeActive
    const overageChanged = isUsingOverage !== prev.isUsingOverage
    const cachedMCChanged = cachedMCEnabled !== prev.cachedMCEnabled
    const effortChanged = effortStr !== prev.effortValue
    const extraBodyChanged = extraBodyHash !== prev.extraBodyHash

    if (
      systemPromptChanged ||
      toolSchemasChanged ||
      modelChanged ||
      fastModeChanged ||
      cacheControlChanged ||
      globalCacheStrategyChanged ||
      betasChanged ||
      autoModeChanged ||
      overageChanged ||
      cachedMCChanged ||
      effortChanged ||
      extraBodyChanged
    ) {
      const prevToolSet = new Set(prev.toolNames)
      const newToolSet = new Set(toolNames)
      const prevBetaSet = new Set(prev.betas)
      const newBetaSet = new Set(sortedBetas)
      const addedTools = toolNames.filter(n => !prevToolSet.has(n))
      const removedTools = prev.toolNames.filter(n => !newToolSet.has(n))
      const changedToolSchemas: string[] = []
      if (toolSchemasChanged) {
        const newHashes = computeToolHashes()
        for (const name of toolNames) {
          if (!prevToolSet.has(name)) continue
          if (newHashes[name] !== prev.perToolHashes[name]) {
            changedToolSchemas.push(name)
          }
        }
        prev.perToolHashes = newHashes
      }
      prev.pendingChanges = {
        systemPromptChanged,
        toolSchemasChanged,
        modelChanged,
        fastModeChanged,
        cacheControlChanged,
        globalCacheStrategyChanged,
        betasChanged,
        autoModeChanged,
        overageChanged,
        cachedMCChanged,
        effortChanged,
        extraBodyChanged,
        addedToolCount: addedTools.length,
        removedToolCount: removedTools.length,
        addedTools,
        removedTools,
        changedToolSchemas,
        systemCharDelta: systemCharCount - prev.systemCharCount,
        previousModel: prev.model,
        newModel: model,
        prevGlobalCacheStrategy: prev.globalCacheStrategy,
        newGlobalCacheStrategy: globalCacheStrategy,
        addedBetas: sortedBetas.filter(b => !prevBetaSet.has(b)),
        removedBetas: prev.betas.filter(b => !newBetaSet.has(b)),
        prevEffortValue: prev.effortValue,
        newEffortValue: effortStr,
        buildPrevDiffableContent: prev.buildDiffableContent,
      }
    } else {
      prev.pendingChanges = null
    }

    prev.systemHash = systemHash
    prev.toolsHash = toolsHash
    prev.cacheControlHash = cacheControlHash
    prev.toolNames = toolNames
    prev.systemCharCount = systemCharCount
    prev.model = model
    prev.fastMode = isFastMode
    prev.globalCacheStrategy = globalCacheStrategy
    prev.betas = sortedBetas
    prev.autoModeActive = autoModeActive
    prev.isUsingOverage = isUsingOverage
    prev.cachedMCEnabled = cachedMCEnabled
    prev.effortValue = effortStr
    prev.extraBodyHash = extraBodyHash
    prev.buildDiffableContent = lazyDiffableContent
  } catch (e: unknown) {
    logError(e)
  }
}

/**
 * Phase 2 (post-call): Check the API response's cache tokens to determine
 * if a cache break actually occurred. If it did, use the pending changes
 * from phase 1 to explain why.
 */
export async function checkResponseForCacheBreak(
  querySource: QuerySource,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  messages: Message[],
  agentId?: AgentId,
  requestId?: string | null,
): Promise<void> {
  try {
    const key = getTrackingKey(querySource, agentId)
    if (!key) return

    const state = previousStateBySource.get(key)
    if (!state) return

    // Skip excluded models (e.g., haiku has different caching behavior)
    if (isExcludedModel(state.model)) return

    const prevCacheRead = state.prevCacheReadTokens
    state.prevCacheReadTokens = cacheReadTokens

    // Calculate time since last call for TTL detection by finding the most recent
    // assistant message timestamp in the messages array (before the current response)
    const lastAssistantMessage = messages.findLast(m => m.type === 'assistant')
    const timeSinceLastAssistantMsg = lastAssistantMessage
      ? Date.now() - new Date(lastAssistantMessage.timestamp).getTime()
      : null

    // Skip the first call — no previous value to compare against
    if (prevCacheRead === null) return

    const changes = state.pendingChanges

    // Cache deletions via cached microcompact intentionally reduce the cached
    // prefix. The drop in cache read tokens is expected — reset the baseline
    // so we don't false-positive on the next call.
    if (state.cacheDeletionsPending) {
      state.cacheDeletionsPending = false
      logForDebugging(
        `[PROMPT CACHE] cache deletion applied, cache read: ${prevCacheRead} → ${cacheReadTokens} (expected drop)`,
      )
      // Don't flag as a break — the remaining state is still valid
      state.pendingChanges = null
      return
    }

    // Detect a cache break: cache read dropped >5% from previous AND
    // the absolute drop exceeds the minimum threshold.
    const tokenDrop = prevCacheRead - cacheReadTokens
    if (
      cacheReadTokens >= prevCacheRead * 0.95 ||
      tokenDrop < MIN_CACHE_MISS_TOKENS
    ) {
      state.pendingChanges = null
      return
    }

    // Build explanation from pending changes (if any)
    const parts: string[] = []
    if (changes) {
      if (changes.modelChanged) {
        parts.push(
          `model changed (${changes.previousModel} → ${changes.newModel})`,
        )
      }
      if (changes.systemPromptChanged) {
        const charDelta = changes.systemCharDelta
        const charInfo =
          charDelta === 0
            ? ''
            : charDelta > 0
              ? ` (+${charDelta} chars)`
              : ` (${charDelta} chars)`
        parts.push(`system prompt changed${charInfo}`)
      }
      if (changes.toolSchemasChanged) {
        const toolDiff =
          changes.addedToolCount > 0 || changes.removedToolCount > 0
            ? ` (+${changes.addedToolCount}/-${changes.removedToolCount} tools)`
            : ' (tool prompt/schema changed, same tool set)'
        parts.push(`tools changed${toolDiff}`)
      }
      if (changes.fastModeChanged) {
        parts.push('fast mode toggled')
      }
      if (changes.globalCacheStrategyChanged) {
        parts.push(
          `global cache strategy changed (${changes.prevGlobalCacheStrategy || 'none'} → ${changes.newGlobalCacheStrategy || 'none'})`,
        )
      }
      if (
        changes.cacheControlChanged &&
        !changes.globalCacheStrategyChanged &&
        !changes.systemPromptChanged
      ) {
        // Only report as standalone cause if nothing else explains it —
        // otherwise the scope/TTL flip is a consequence, not the root cause.
        parts.push('cache_control changed (scope or TTL)')
      }
      if (changes.betasChanged) {
        const added = changes.addedBetas.length
          ? `+${changes.addedBetas.join(',')}`
          : ''
        const removed = changes.removedBetas.length
          ? `-${changes.removedBetas.join(',')}`
          : ''
        const diff = [added, removed].filter(Boolean).join(' ')
        parts.push(`betas changed${diff ? ` (${diff})` : ''}`)
      }
      if (changes.autoModeChanged) {
        parts.push('auto mode toggled')
      }
      if (changes.overageChanged) {
        parts.push('overage state changed (TTL latched, no flip)')
      }
      if (changes.cachedMCChanged) {
        parts.push('cached microcompact toggled')
      }
      if (changes.effortChanged) {
        parts.push(
          `effort changed (${changes.prevEffortValue || 'default'} → ${changes.newEffortValue || 'default'})`,
        )
      }
      if (changes.extraBodyChanged) {
        parts.push('extra body params changed')
      }
    }

    // Check if time gap suggests TTL expiration
    const lastAssistantMsgOver5minAgo =
      timeSinceLastAssistantMsg !== null &&
      timeSinceLastAssistantMsg > CACHE_TTL_5MIN_MS
    const lastAssistantMsgOver1hAgo =
      timeSinceLastAssistantMsg !== null &&
      timeSinceLastAssistantMsg > CACHE_TTL_1HOUR_MS

    // Post PR #19823 BQ analysis (bq-queries/prompt-caching/cache_break_pr19823_analysis.sql):
    // when all client-side flags are false and the gap is under TTL, ~90% of breaks
    // are server-side routing/eviction or billed/inference disagreement. Label
    // accordingly instead of implying a CC bug hunt.
    let reason: string
    if (parts.length > 0) {
      reason = parts.join(', ')
    } else if (lastAssistantMsgOver1hAgo) {
      reason = 'possible 1h TTL expiry (prompt unchanged)'
    } else if (lastAssistantMsgOver5minAgo) {
      reason = 'possible 5min TTL expiry (prompt unchanged)'
    } else if (timeSinceLastAssistantMsg !== null) {
      reason = 'likely server-side (prompt unchanged, <5min gap)'
    } else {
      reason = 'unknown cause'
    }

    logEvent('tengu_prompt_cache_break', {
      systemPromptChanged: changes?.systemPromptChanged ?? false,
      toolSchemasChanged: changes?.toolSchemasChanged ?? false,
      modelChanged: changes?.modelChanged ?? false,
      fastModeChanged: changes?.fastModeChanged ?? false,
      cacheControlChanged: changes?.cacheControlChanged ?? false,
      globalCacheStrategyChanged: changes?.globalCacheStrategyChanged ?? false,
      betasChanged: changes?.betasChanged ?? false,
      autoModeChanged: changes?.autoModeChanged ?? false,
      overageChanged: changes?.overageChanged ?? false,
      cachedMCChanged: changes?.cachedMCChanged ?? false,
      effortChanged: changes?.effortChanged ?? false,
      extraBodyChanged: changes?.extraBodyChanged ?? false,
      addedToolCount: changes?.addedToolCount ?? 0,
      removedToolCount: changes?.removedToolCount ?? 0,
      systemCharDelta: changes?.systemCharDelta ?? 0,
      // Tool names are sanitized: built-in names are a fixed vocabulary,
      // MCP tools collapse to 'mcp' (user-configured, could leak paths).
      addedTools: (changes?.addedTools ?? [])
        .map(sanitizeToolName)
        .join(
          ',',
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      removedTools: (changes?.removedTools ?? [])
        .map(sanitizeToolName)
        .join(
          ',',
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      changedToolSchemas: (changes?.changedToolSchemas ?? [])
        .map(sanitizeToolName)
        .join(
          ',',
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      // Beta header names and cache strategy are fixed enum-like values,
      // not code or filepaths. requestId is an opaque server-generated ID.
      addedBetas: (changes?.addedBetas ?? []).join(
        ',',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      removedBetas: (changes?.removedBetas ?? []).join(
        ',',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      prevGlobalCacheStrategy: (changes?.prevGlobalCacheStrategy ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      newGlobalCacheStrategy: (changes?.newGlobalCacheStrategy ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      callNumber: state.callCount,
      prevCacheReadTokens: prevCacheRead,
      cacheReadTokens,
      cacheCreationTokens,
      timeSinceLastAssistantMsg: timeSinceLastAssistantMsg ?? -1,
      lastAssistantMsgOver5minAgo,
      lastAssistantMsgOver1hAgo,
      requestId: (requestId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    // Write diff file for ant debugging via --debug. The path is included in
    // the summary log so ants can find it (DevBar UI removed — event data
    // flows reliably to BQ for analytics).
    let diffPath: string | undefined
    if (changes?.buildPrevDiffableContent) {
      diffPath = await writeCacheBreakDiff(
        changes.buildPrevDiffableContent(),
        state.buildDiffableContent(),
      )
    }

    const diffSuffix = diffPath ? `, diff: ${diffPath}` : ''
    const summary = `[PROMPT CACHE BREAK] ${reason} [source=${querySource}, call #${state.callCount}, cache read: ${prevCacheRead} → ${cacheReadTokens}, creation: ${cacheCreationTokens}${diffSuffix}]`

    logForDebugging(summary, { level: 'warn' })

    state.pendingChanges = null
  } catch (e: unknown) {
    logError(e)
  }
}

// 【notifyCacheDeletion / notifyCompaction：两个「提前告知」的入口】
//
//  这两个函数做的事极其简单（改一个布尔量 / 清一个基准值），但它们是
//  整个诊断系统的关键：**告诉它「接下来缓存命中会掉，但这是预期的」。**
//
//  notifyCacheDeletion（第 673 行）
//      microcompact 主动删掉了一些缓存内容 → 下次 cache_read 必然下降
//      → 标记 cacheDeletionsPending，下次比对时跳过报警
//
//  notifyCompaction（第 689 行）
//      压缩之后消息数变少 → cache_read 自然下降
//      → 直接清空 prevCacheReadTokens，让下次重新建立基准
//
//  两个手法不一样，但目的相同：**把「已知的、预期的下降」从报警里排除掉。**
//
//  这揭示了一个诊断系统的通用结构：
//
//      采集（recordPromptState）
//      比对（算差值）
//      排除已知原因（这两个 notify + TTL 判断）
//      才报警
//
//  第三层最容易被忽略，也最容易让诊断变成噪声源。**先做减法，再报警。**
/**
 * Call when cached microcompact sends cache_edits deletions.
 * The next API response will have lower cache read tokens — that's
 * expected, not a cache break.
 */
export function notifyCacheDeletion(
  querySource: QuerySource,
  agentId?: AgentId,
): void {
  const key = getTrackingKey(querySource, agentId)
  const state = key ? previousStateBySource.get(key) : undefined
  if (state) {
    state.cacheDeletionsPending = true
  }
}

// 【notifyCompaction 为什么是「清空基准」，而不是「打个标记」】
//
//  对比上一个函数：删除用 bool 标记（cacheDeletionsPending），压缩用
//  置 null（prevCacheReadTokens = null）。
//
//  差别在于「下降的幅度可不可预测」：
//
//      删除几段缓存   幅度大致可估，可以「这一次不比，下一次接着比」
//      压缩           可能砍掉一半上下文，基准完全失效，只能重建
//
//  所以压缩之后必须把基准清掉，让下一轮重新建立「压缩后的正常水位」。
//  否则下一轮会拿「压缩前的大值」去做基准，凭空报一次大跌。
//
//  这是一个很细的判断：**同样是「预期内的下降」，处理方式取决于
//  「基准还能不能用」。**
/**
 * Call after compaction to reset the cache read baseline.
 * Compaction legitimately reduces message count, so cache read tokens
 * will naturally drop on the next call — that's not a break.
 */
export function notifyCompaction(
  querySource: QuerySource,
  agentId?: AgentId,
): void {
  const key = getTrackingKey(querySource, agentId)
  const state = key ? previousStateBySource.get(key) : undefined
  if (state) {
    state.prevCacheReadTokens = null
  }
}

export function cleanupAgentTracking(agentId: AgentId): void {
  previousStateBySource.delete(agentId)
}

export function resetPromptCacheBreakDetection(): void {
  previousStateBySource.clear()
}

// 【最后把差异写成一份 diff 文件 —— 但整个函数包在 try 里】
//
//      const patch = createPatch('prompt-state', prevContent, newContent, 'before', 'after')
//      await writeFile(diffPath, patch)
//      return diffPath
//    catch { return undefined }
//
//  为什么要写成文件，而不是直接打进日志？
//
//  因为 diff 内容可能很长（system prompt 几千字 + 几十个工具 schema），
//  塞进日志会把日志淹掉。写成文件，只在日志里留**路径**，需要的时候再去看。
//
//  这是「大对象日志」的标准做法：**日志里放指针，不放内容。**
//
//  整个函数吞掉所有异常并返回 undefined —— 因为它是诊断功能的最后一环，
//  写文件失败（磁盘满、权限不足）不应该影响任何主流程。
//
//  判据同前：**能降级的诊断用 best-effort，不能降级的主流程才用 throw。**
async function writeCacheBreakDiff(
  prevContent: string,
  newContent: string,
): Promise<string | undefined> {
  try {
    const diffPath = getCacheBreakDiffPath()
    await mkdir(getClaudeTempDir(), { recursive: true })
    const patch = createPatch(
      'prompt-state',
      prevContent,
      newContent,
      'before',
      'after',
    )
    await writeFile(diffPath, patch)
    return diffPath
  } catch {
    return undefined
  }
}
