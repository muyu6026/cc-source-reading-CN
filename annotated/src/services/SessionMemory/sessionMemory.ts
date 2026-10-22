// 【第 1-5 行】这个文件在做什么：让一个后台子代理替你记笔记
//
// 一句话：**在对话进行中，偷偷派一个 forked 子代理，把当前会话的要点写进一个 markdown 文件。**
//
// 它解决的是压缩的「记忆断裂」问题。上下文满了要压缩成摘要，
// 摘要一定有损；而 session memory 是**持续维护**的笔记，
// 压缩时把它整份塞进去，比「临时让模型总结一遍」可靠得多
// （因为笔记里包含「当时为什么要这么做」，那是摘要最容易丢的东西）。
//
// 三个设计选择值得先记住：
// 1. **用 forked 子代理**（`runForkedAgent`）而不是在主对话里插一轮 ——
//    不打断用户，且能复用父会话的 prompt cache（前缀相同，几乎免费）；
// 2. **用 Edit 改文件**而不是重写整个文件 —— 增量、可并行、省 token；
// 3. **自己判断「什么时候该抽」**（`shouldExtractMemory`）而不是每轮都抽 ——
//    否则抽取本身的开销会超过它省下的压缩开销。
//
// 下面按「何时抽 → 怎么抽 → 怎么限制权限」的顺序读。
/**
 * Session Memory automatically maintains a markdown file with notes about the current conversation.
 * It runs periodically in the background using a forked subagent to extract key information
 * without interrupting the main conversation flow.
 */

import { writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import {
  FileReadTool,
  type Output as FileReadToolOutput,
} from '../../tools/FileReadTool/FileReadTool.js'
import type { Message } from '../../types/message.js'
import { count } from '../../utils/array.js'
import {
  createCacheSafeParams,
  createSubagentContext,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import {
  type REPLHookContext,
  registerPostSamplingHook,
} from '../../utils/hooks/postSamplingHooks.js'
import {
  createUserMessage,
  hasToolCallsInLastAssistantTurn,
} from '../../utils/messages.js'
import {
  getSessionMemoryDir,
  getSessionMemoryPath,
} from '../../utils/permissions/filesystem.js'
import { sequential } from '../../utils/sequential.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getTokenUsage, tokenCountWithEstimation } from '../../utils/tokens.js'
import { logEvent } from '../analytics/index.js'
import { isAutoCompactEnabled } from '../compact/autoCompact.js'
import {
  buildSessionMemoryUpdatePrompt,
  loadSessionMemoryTemplate,
} from './prompts.js'
import {
  DEFAULT_SESSION_MEMORY_CONFIG,
  getSessionMemoryConfig,
  getToolCallsBetweenUpdates,
  hasMetInitializationThreshold,
  hasMetUpdateThreshold,
  isSessionMemoryInitialized,
  markExtractionCompleted,
  markExtractionStarted,
  markSessionMemoryInitialized,
  recordExtractionTokenCount,
  type SessionMemoryConfig,
  setLastSummarizedMessageId,
  setSessionMemoryConfig,
} from './sessionMemoryUtils.js'

// ============================================================================
// Feature Gate and Config (Cached - Non-blocking)
// ============================================================================
// These functions return cached values from disk immediately without blocking
// on GrowthBook initialization. Values may be stale but are updated in background.

import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import {
  getDynamicConfig_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'

// 【第 76-93 行】两个函数名里都带 `_CACHED_MAY_BE_STALE`，这是给调用者的警告
//
// `getFeatureValue_CACHED_MAY_BE_STALE('tengu_session_memory', false)`
// `getDynamicConfig_CACHED_MAY_BE_STALE('tengu_sm_config', {})`
//
// 这种「把警告写进函数名」的做法在这个仓库里出现很多次，它解决一个真实矛盾：
// - 开关和配置来自 GrowthBook（远端），拿最新值要**联网**；
// - 但这段代码跑在 **post-sampling hook 的同步路径**上。
//
// 在用户的每一轮对话里插一次网络请求去问「功能开没开」，显然不行。
// 所以读**磁盘缓存**，立刻返回，值可能是旧的。
// 注释写得很清楚：*Values may be stale but are updated in background.*
//
// 后果是：远端刚打开这个功能，本会话可能要等下次启动才生效；
// 远端刚关掉，本会话可能还会继续跑一会儿。
// 对一个「后台记笔记」的功能，这个延迟完全可接受。
//
// **判断「能不能用旧值」，靠的是「用错旧值的代价」而不是「旧值有多旧」。**
/**
 * Check if session memory feature is enabled.
 * Uses cached gate value - returns immediately without blocking.
 */
function isSessionMemoryGateEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_session_memory', false)
}

/**
 * Get session memory config from cache.
 * Returns immediately without blocking - value may be stale.
 */
function getSessionMemoryRemoteConfig(): Partial<SessionMemoryConfig> {
  return getDynamicConfig_CACHED_MAY_BE_STALE<Partial<SessionMemoryConfig>>(
    'tengu_sm_config',
    {},
  )
}

// ============================================================================
// Module State
// ============================================================================

let lastMemoryMessageUuid: string | undefined

/**
 * Reset the last memory message UUID (for testing)
 */
export function resetLastMemoryMessageUuid(): void {
  lastMemoryMessageUuid = undefined
}

// 【第 108-132 行】用 `uuid` 定位「从哪儿开始数」，而不是下标
//
// `countToolCallsSince(messages, sinceUuid)` 先找到 `sinceUuid` 那条消息，
// 之后的 assistant 消息里数 `tool_use` 块。
//
// 为什么不用下标：`messages` 数组会被**压缩**改写（`compact` 之后整个数组换了一批），
// 也会被中途插入（tool_result 回填）。同一个下标在两次调用里可能指向完全不同的消息。
// `uuid` 是消息的稳定身份，压缩后仍然可查。
//
// 两个细节：
// - `let foundStart = sinceUuid === null || sinceUuid === undefined` ——
//   没有起点时从第一条开始数。注意它同时接受 `null` 和 `undefined`，
//   说明上游有可能传 `null`（TS 里 `string | undefined` 不该出现 null，
//   但运行时会出现）。
// - 找不到 `sinceUuid`（比如那条消息被压缩掉了）时，`foundStart` 一直是 false，
//   **函数返回 0**。0 永远小于阈值 → 不会触发抽取。
//   这是「找不到起点就当作没发生过」，偏保守的一侧。
//
// 如果这里选另一侧（找不到就从 0 开始全数），压缩之后会立刻触发一次抽取 ——
// 而压缩之后恰恰是最不该再抽的时候（正在重建上下文）。
function countToolCallsSince(
  messages: Message[],
  sinceUuid: string | undefined,
): number {
  let toolCallCount = 0
  let foundStart = sinceUuid === null || sinceUuid === undefined

  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }

    if (message.type === 'assistant') {
      const content = message.message.content
      if (Array.isArray(content)) {
        toolCallCount += count(content, block => block.type === 'tool_use')
      }
    }
  }

  return toolCallCount
}

// 【第 134-181 行】两条触发路径，但**共同前提是 token 阈值**
//
// ```
// (hasMetTokenThreshold && hasMetToolCallThreshold) ||
// (hasMetTokenThreshold && !hasToolCallsInLastTurn)
// ```
//
// 提取公因式就是 `hasMetTokenThreshold && (toolCalls够了 || 现在是自然断点)`。
//
// 作者在注释里特意用大写强调：
// *IMPORTANT: The token threshold (minimumTokensBetweenUpdate) is ALWAYS required.
// Even if the tool call threshold is met, extraction won't happen until the token
// threshold is also satisfied. This prevents excessive extractions.*
//
// 为什么一定要这个前提：工具调用次数增长得比上下文快得多。
// 读文件 20 次可能只增加 2k token，但 `toolCallsBetweenUpdates = 3` 早就满足了。
// 只看工具调用数的话，会每 3 次工具调用就派一个子代理去重写笔记 ——
// **抽取的成本（一次子代理调用）反而超过了它带来的收益。**
//
// 所以真正的节流阀是 token 增量（默认 5,000），工具调用只是「顺便确认一下有活干」。
//
// 注意第 138-143 行：初始化阈值满足时**立刻** `markSessionMemoryInitialized()`，
// 即使这一次后面还要判断别的条件。这是「记住已经跨过门槛」，不是「记住抽取过」。
export function shouldExtractMemory(messages: Message[]): boolean {
  // Check if we've met the initialization threshold
  // Uses total context window tokens (same as autocompact) for consistent behavior
  const currentTokenCount = tokenCountWithEstimation(messages)
  if (!isSessionMemoryInitialized()) {
    if (!hasMetInitializationThreshold(currentTokenCount)) {
      return false
    }
    markSessionMemoryInitialized()
  }

  // Check if we've met the minimum tokens between updates threshold
  // Uses context window growth since last extraction (same metric as init threshold)
  const hasMetTokenThreshold = hasMetUpdateThreshold(currentTokenCount)

  // Check if we've met the tool calls threshold
  const toolCallsSinceLastUpdate = countToolCallsSince(
    messages,
    lastMemoryMessageUuid,
  )
  const hasMetToolCallThreshold =
    toolCallsSinceLastUpdate >= getToolCallsBetweenUpdates()

// 【第 157-170 行】`!hasToolCallsInLastTurn` 的意思是「现在是自然断点」
//
// `hasToolCallsInLastAssistantTurn(messages)` 检查最后一条 assistant 消息里有没有 `tool_use`。
// 有 → 说明工具正在跑、结果还没回填；没有 → 说明这一轮已经说完了。
//
// 为什么这时候抽是安全的：抽取是**基于当前 messages 生成笔记**。
// 如果在一堆工具调用中间抽，笔记里会出现「正在读 xxx」这种半句话状态，
// 而下一条消息可能就把这个前提推翻了。自然断点抽出来的笔记是自洽的。
//
// 顺带解释了另一个条件为什么有 `&& hasMetTokenThreshold`：
// 自然断点很常见（每次模型说完话都是），不加 token 限制的话就成了「每轮都抽」。
  // Check if the last assistant turn has no tool calls (safe to extract)
  const hasToolCallsInLastTurn = hasToolCallsInLastAssistantTurn(messages)

  // Trigger extraction when:
  // 1. Both thresholds are met (tokens AND tool calls), OR
  // 2. No tool calls in last turn AND token threshold is met
  //    (to ensure we extract at natural conversation breaks)
  //
  // IMPORTANT: The token threshold (minimumTokensBetweenUpdate) is ALWAYS required.
  // Even if the tool call threshold is met, extraction won't happen until the
  // token threshold is also satisfied. This prevents excessive extractions.
  const shouldExtract =
    (hasMetTokenThreshold && hasMetToolCallThreshold) ||
    (hasMetTokenThreshold && !hasToolCallsInLastTurn)

  if (shouldExtract) {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.uuid) {
      lastMemoryMessageUuid = lastMessage.uuid
    }
    return true
  }

  return false
}

// 【第 183-233 行】为什么要单独建一个「隔离 context」来读文件
//
// `const setupContext = createSubagentContext(toolUseContext)` —— 注意这里是**父上下文的一个副本**。
//
// 原因在 214-216 行那条注释里：
// *Drop any cached entry so FileReadTool's dedup doesn't return a file_unchanged stub*
//
// `FileReadTool` 有一个去重机制：如果同一个文件读第二次、且 mtime 没变，
// 它返回的是「文件未变化」的存根而不是内容（为了省 token）。
// 但这里**需要真实内容**（要把它塞进 prompt），所以必须先删掉缓存条目。
//
// 而删除动作如果发生在父上下文上，就会污染父会话的缓存状态 ——
// 父会话下一轮请求的 `readFileState` 变了，
// 它的 prompt 前缀就变了，缓存全丢。
//
// 所以：**读文件这个副作用，必须发生在一个用完就丢的副本上。**
// 这是「为了拿数据而不得不做的脏操作，要隔离在沙箱里」的实例。
//
// 顺带一提 `mode: 0o700` / `0o600`：目录只有自己可进、文件只有自己可读写。
// session memory 里会有你的代码片段和需求描述，不该被同机其他用户读到。
async function setupSessionMemoryFile(
  toolUseContext: ToolUseContext,
): Promise<{ memoryPath: string; currentMemory: string }> {
  const fs = getFsImplementation()

  // Set up directory and file
  const sessionMemoryDir = getSessionMemoryDir()
  await fs.mkdir(sessionMemoryDir, { mode: 0o700 })

  const memoryPath = getSessionMemoryPath()

  // Create the memory file if it doesn't exist (wx = O_CREAT|O_EXCL)
  try {
    await writeFile(memoryPath, '', {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    })
    // Only load template if file was just created
    const template = await loadSessionMemoryTemplate()
    await writeFile(memoryPath, template, {
      encoding: 'utf-8',
      mode: 0o600,
    })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'EEXIST') {
      throw e
    }
  }

  // Drop any cached entry so FileReadTool's dedup doesn't return a
  // file_unchanged stub — we need the actual content. The Read repopulates it.
  toolUseContext.readFileState.delete(memoryPath)
  const result = await FileReadTool.call(
    { file_path: memoryPath },
    toolUseContext,
  )
  let currentMemory = ''

  const output = result.data as FileReadToolOutput
  if (output.type === 'text') {
    currentMemory = output.file.content
  }

  logEvent('tengu_session_memory_file_read', {
    content_length: currentMemory.length,
  })

  return { memoryPath, currentMemory }
}

/**
 * Initialize session memory config from remote config (lazy initialization).
 * Memoized - only runs once per session, subsequent calls return immediately.
 * Uses cached config values - non-blocking.
 */
// 【第 240-264 行】`memoize` + 「只接受大于 0 的远端值」
//
// 两个设计点：
//
// **1. 为什么 memoize**：这段逻辑要把远端配置合并进本地默认值，
// 每轮对话都会走到（`extractSessionMemory` 里调）。memoize 之后每个会话只算一次。
// 注意 memoize 的语义是「按参数缓存」，这里没有参数，所以就是「只执行一次」。
//
// **2. 为什么每个字段都要 `&& > 0` 判断**：
//
// ```js
// remoteConfig.minimumMessageTokensToInit && remoteConfig.minimumMessageTokensToInit > 0
//   ? remoteConfig.minimumMessageTokensToInit
//   : DEFAULT_SESSION_MEMORY_CONFIG.minimumMessageTokensToInit
// ```
//
// 远端配置里 `0` 通常表示「这个字段没设置」（JSON 反序列化、后台表单留空的常见产物），
// 而不是「真的要把它设成 0」。如果直接取 0：
// `minimumTokensBetweenUpdate = 0` 意味着**每轮都满足条件** → 每轮都抽一次笔记。
//
// 注释原话：*This ensures sensible defaults aren't overridden by zero values.*
//
// **「远端配置里的 0 到底是 0 还是没填」是一个必须在类型上区分、
// 但 JSON 里区分不了的问题。** 这里的做法是选一个业务上不可能的值当哨兵。
const initSessionMemoryConfigIfNeeded = memoize((): void => {
  // Load config from cache (non-blocking, may be stale)
  const remoteConfig = getSessionMemoryRemoteConfig()

  // Only use remote values if they are explicitly set (non-zero positive numbers)
  // This ensures sensible defaults aren't overridden by zero values
  const config: SessionMemoryConfig = {
    minimumMessageTokensToInit:
      remoteConfig.minimumMessageTokensToInit &&
      remoteConfig.minimumMessageTokensToInit > 0
        ? remoteConfig.minimumMessageTokensToInit
        : DEFAULT_SESSION_MEMORY_CONFIG.minimumMessageTokensToInit,
    minimumTokensBetweenUpdate:
      remoteConfig.minimumTokensBetweenUpdate &&
      remoteConfig.minimumTokensBetweenUpdate > 0
        ? remoteConfig.minimumTokensBetweenUpdate
        : DEFAULT_SESSION_MEMORY_CONFIG.minimumTokensBetweenUpdate,
    toolCallsBetweenUpdates:
      remoteConfig.toolCallsBetweenUpdates &&
      remoteConfig.toolCallsBetweenUpdates > 0
        ? remoteConfig.toolCallsBetweenUpdates
        : DEFAULT_SESSION_MEMORY_CONFIG.toolCallsBetweenUpdates,
  }
  setSessionMemoryConfig(config)
})

/**
 * Session memory post-sampling hook that extracts and updates session notes
 */
// Track if we've logged the gate check failure this session (to avoid spam)
let hasLoggedGateFailure = false

// 【第 272-274 行】`sequential(...)` 包一层：抽取绝不允许重入
//
// `extractSessionMemory` 是一个 async 函数，被注册成 post-sampling hook —
// 也就是说**每次模型回完话它都会被调用一次**。如果上一次还没跑完
// （正在等子代理、正在写文件），下一次调用又进来了，就会出现：
// - 两个子代理同时读同一个笔记文件、各自基于旧内容改 → 后写的覆盖先写的；
// - `markExtractionStarted/Completed` 的状态被交替覆盖；
// - `lastSummarizedMessageId` 算错，导致下一轮的「从哪儿开始数」有洞。
//
// `sequential` 的作用是把同一时刻的调用**排队**（不是丢弃），
// 后进来的等前一个结束再跑。
//
// 为什么是排队而不是丢弃：丢弃会让快速连续的两轮里只抽一次，
// 看似省事，但「最后一次抽取之后的内容」永远不会进笔记。
// 排队至少保证每次调用最终都被考虑（虽然轮到它时可能已经不满足条件，
// `shouldExtractMemory` 会在那时返回 false，自然跳过）。
const extractSessionMemory = sequential(async function (
  context: REPLHookContext,
): Promise<void> {
  const { messages, toolUseContext, querySource } = context

  // Only run session memory on main REPL thread
// 【第 278-281 行】只在 `repl_main_thread` 上跑 —— 而且**不记日志**
//
// ```js
// if (querySource !== 'repl_main_thread') {
//   // Don't log this - it's expected for subagents, teammates, etc.
//   return
// }
// ```
//
// 为什么子代理不该有自己的 session memory：
// - 子代理是短命的，抽出来的笔记没有下一位读者；
// - 子代理的上下文是父会话的一个切片，抽出来会和父会话的笔记**互相矛盾**；
// - 更实际的：子代理本身可能就是 session memory 的抽取代理（`querySource: 'session_memory'`），
//   不拦住就会**无限递归**。
//
// 注释里那句「不记日志」也是信息：这是一个**预期内的正常分支**，
// 不是异常。如果每个子代理调用都写一条日志，日志会被这个分支刷屏，
// 真正的异常反而看不见。**「正常路径不打日志」和「异常路径必须打日志」是一对。**
//
// （顺带：`querySource` 这个字段在整份源码里承担了「我是谁发起的」的身份标识，
// hooks、遥测、session memory 都靠它做分流。它比函数参数更适合做这件事，
// 因为要穿过很多层调用。）
  if (querySource !== 'repl_main_thread') {
    // Don't log this - it's expected for subagents, teammates, etc.
    return
  }

  // Check gate lazily when hook runs (cached, non-blocking)
  if (!isSessionMemoryGateEnabled()) {
    // Log gate failure once per session (ant-only)
    if (process.env.USER_TYPE === 'ant' && !hasLoggedGateFailure) {
      hasLoggedGateFailure = true
      logEvent('tengu_session_memory_gate_disabled', {})
    }
    return
  }

  // Initialize config from remote (lazy, only once)
  initSessionMemoryConfigIfNeeded()

  if (!shouldExtractMemory(messages)) {
    return
  }

  markExtractionStarted()

  // Create isolated context for setup to avoid polluting parent's cache
  const setupContext = createSubagentContext(toolUseContext)

  // Set up file system and read current state with isolated context
  const { memoryPath, currentMemory } =
    await setupSessionMemoryFile(setupContext)

  // Create extraction message
  const userPrompt = await buildSessionMemoryUpdatePrompt(
    currentMemory,
    memoryPath,
  )

  // Run session memory extraction using runForkedAgent for prompt caching
  // runForkedAgent creates an isolated context to prevent mutation of parent state
  // Pass setupContext.readFileState so the forked agent can edit the memory file
// 【第 315-325 行】`runForkedAgent` + `createCacheSafeParams`：让这次抽取几乎免费
//
// ```js
// await runForkedAgent({
//   promptMessages: [createUserMessage({ content: userPrompt })],
//   cacheSafeParams: createCacheSafeParams(context),
//   ...
// })
// ```
//
// 关键在于 `cacheSafeParams`：它把父会话的 system prompt、user context、
// system context、上下文消息**原样**带上，使子代理请求的**前缀与父会话逐字节相同**。
//
// Anthropic 的 prompt cache 是按前缀匹配的，前缀相同 → 命中缓存 →
// 这次子代理调用只按「新增部分」计费（工具定义、系统提示词那几万 token 全按缓存价）。
//
// 如果这里自己拼一个 system prompt（比如「你是一个笔记助手」），
// 前缀就不同了 → 全价重算一次 → 每次抽取都比省下来的压缩开销更贵。
//
// **这是「fork vs 新开一个 agent」的本质区别**：
// fork 的全部意义就在于前缀相同。任何「顺手改一下系统提示词」的念头都会让它归零。
// （`AgentTool/forkSubagent.ts` 里有更完整的讨论。）
  await runForkedAgent({
    promptMessages: [createUserMessage({ content: userPrompt })],
    cacheSafeParams: createCacheSafeParams(context),
    canUseTool: createMemoryFileCanUseTool(memoryPath),
    querySource: 'session_memory',
    forkLabel: 'session_memory',
    overrides: { readFileState: setupContext.readFileState },
  })

  // Log extraction event for tracking frequency
  // Use the token usage from the last message in the conversation
  const lastMessage = messages[messages.length - 1]
  const usage = lastMessage ? getTokenUsage(lastMessage) : undefined
  const config = getSessionMemoryConfig()
  logEvent('tengu_session_memory_extraction', {
    input_tokens: usage?.input_tokens,
    output_tokens: usage?.output_tokens,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens:
      usage?.cache_creation_input_tokens ?? undefined,
    config_min_message_tokens_to_init: config.minimumMessageTokensToInit,
    config_min_tokens_between_update: config.minimumTokensBetweenUpdate,
    config_tool_calls_between_updates: config.toolCallsBetweenUpdates,
  })

  // Record the context size at extraction for tracking minimumTokensBetweenUpdate
  recordExtractionTokenCount(tokenCountWithEstimation(messages))

  // Update lastSummarizedMessageId after successful completion
  updateLastSummarizedMessageIdIfSafe(messages)

  markExtractionCompleted()
})

/**
 * Initialize session memory by registering the post-sampling hook.
 * This is synchronous to avoid race conditions during startup.
 * The gate check and config loading happen lazily when the hook runs.
 */
// 【第 357-375 行】`initSessionMemory()` 同步注册 hook，闸门留到 hook 里再查
//
// 函数体只有几行：`getIsRemoteMode()` 早退 → 读 `isAutoCompactEnabled()` →
// 不满足就 return → `registerPostSamplingHook(extractSessionMemory)`。
//
// 注意注释：*This is synchronous to avoid race conditions during startup.*
//
// 这里**没有**做两件看起来很自然的事：
// 1. 没等 GrowthBook 初始化（否则启动会被网络拖住）；
// 2. 没在这里判断 `tengu_session_memory` 开关（留到 hook 里懒查）。
//
// 为什么「同步注册」很重要：如果这里 await 了任何东西，
// 注册动作可能晚于第一轮对话采样完成 —— 那第一轮的笔记就漏了。
// 而 hook 列表是一个数组，晚注册会让顺序不确定。
//
// 第 369 行那个 `if (!autoCompactEnabled) return` 也值得注意：
// session memory 是**给压缩用的**（`sessionMemoryCompact` 读它），
// 关掉自动压缩却还在后台记笔记，等于白烧 token。**功能的开关要跟它的消费者联动。**
export function initSessionMemory(): void {
  if (getIsRemoteMode()) return
  // Session memory is used for compaction, so respect auto-compact settings
  const autoCompactEnabled = isAutoCompactEnabled()

  // Log initialization state (ant-only to avoid noise in external logs)
  if (process.env.USER_TYPE === 'ant') {
    logEvent('tengu_session_memory_init', {
      auto_compact_enabled: autoCompactEnabled,
    })
  }

  if (!autoCompactEnabled) {
    return
  }

  // Register hook unconditionally - gate check happens lazily when hook runs
  registerPostSamplingHook(extractSessionMemory)
}

export type ManualExtractionResult = {
  success: boolean
  memoryPath?: string
  error?: string
}

/**
 * Manually trigger session memory extraction, bypassing threshold checks.
 * Used by the /summary command.
 */
export async function manuallyExtractSessionMemory(
  messages: Message[],
  toolUseContext: ToolUseContext,
): Promise<ManualExtractionResult> {
  if (messages.length === 0) {
    return { success: false, error: 'No messages to summarize' }
  }
  markExtractionStarted()

  try {
    // Create isolated context for setup to avoid polluting parent's cache
    const setupContext = createSubagentContext(toolUseContext)

    // Set up file system and read current state with isolated context
    const { memoryPath, currentMemory } =
      await setupSessionMemoryFile(setupContext)

    // Create extraction message
    const userPrompt = await buildSessionMemoryUpdatePrompt(
      currentMemory,
      memoryPath,
    )

    // Get system prompt for cache-safe params
    const { tools, mainLoopModel } = toolUseContext.options
    const [rawSystemPrompt, userContext, systemContext] = await Promise.all([
      getSystemPrompt(tools, mainLoopModel),
      getUserContext(),
      getSystemContext(),
    ])
    const systemPrompt = asSystemPrompt(rawSystemPrompt)

    // Run session memory extraction using runForkedAgent
    await runForkedAgent({
      promptMessages: [createUserMessage({ content: userPrompt })],
      cacheSafeParams: {
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext: setupContext,
        forkContextMessages: messages,
      },
      canUseTool: createMemoryFileCanUseTool(memoryPath),
      querySource: 'session_memory',
      forkLabel: 'session_memory_manual',
      overrides: { readFileState: setupContext.readFileState },
    })

    // Log manual extraction event
    logEvent('tengu_session_memory_manual_extraction', {})

    // Record the context size at extraction for tracking minimumTokensBetweenUpdate
    recordExtractionTokenCount(tokenCountWithEstimation(messages))

    // Update lastSummarizedMessageId after successful completion
    updateLastSummarizedMessageIdIfSafe(messages)

    return { success: true, memoryPath }
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
    }
  } finally {
    markExtractionCompleted()
  }
}

// Helper functions

/**
 * Creates a canUseTool function that only allows Edit for the exact memory file.
 */
// 【第 460-482 行】这一小段是全项目「最小权限」最干净的示例
//
// `createMemoryFileCanUseTool(memoryPath)` 返回一个审批函数：
// 只有「工具名是 Edit」且「`input.file_path` 恰好等于这个笔记路径」时才 `allow`，
// 其余**全部 deny**，而且 deny 时带一句明确的话术。
//
// 为什么需要它：`runForkedAgent` 的子代理**持有完整的工具集**
// （它要复用父会话的工具定义，否则缓存前缀就不一样了，见上一个锚点）。
// 也就是说这个子代理理论上能改你项目里的任何文件。
//
// 这个函数就是那道闸：**工具集不能削（会破坏缓存），那就把审批函数削到只剩一个文件。**
//
// 注意它比的是**字符串完全相等**（`filePath === memoryPath`），不是
// `endsWith` 或 `resolve` 之后的比较 —— 因为期望值本身就是绝对路径，
// 精确比较最不容易出漏洞（路径归一化之后比较容易被 `..` 之类的技巧绕过，
// 而这里要求输入**必须**是那个规范路径）。
//
// 注释里那句 *only ${FILE_EDIT_TOOL_NAME} on ${memoryPath} is allowed*
// 会被写进模型的 tool_result，所以它既是日志也是**给模型的反馈**：
// 模型能看到「我只能改这一个文件」，从而不会反复尝试别的。
export function createMemoryFileCanUseTool(memoryPath: string): CanUseToolFn {
  return async (tool: Tool, input: unknown) => {
    if (
      tool.name === FILE_EDIT_TOOL_NAME &&
      typeof input === 'object' &&
      input !== null &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && filePath === memoryPath) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }
    return {
      behavior: 'deny' as const,
      message: `only ${FILE_EDIT_TOOL_NAME} on ${memoryPath} is allowed`,
      decisionReason: {
        type: 'other' as const,
        reason: `only ${FILE_EDIT_TOOL_NAME} on ${memoryPath} is allowed`,
      },
    }
  }
}

/**
 * Updates lastSummarizedMessageId after successful extraction.
 * Only sets it if the last message doesn't have tool calls (to avoid orphaned tool_results).
 */
// 【第 488-495 行】只在「最后一条不是工具调用」时才记下摘要进度
//
// ```js
// if (!hasToolCallsInLastAssistantTurn(messages)) {
//   setLastSummarizedMessageId(lastMessage.uuid)
// }
// ```
//
// 注释：*to avoid orphaned tool_results*。
//
// 场景：最后一条 assistant 消息里发了 `tool_use`，笔记抽取正好在这时候完成。
// 如果这时把「已摘要到这条」记下来，下一轮 `countToolCallsSince` 会从这条之后开始数 ——
// 而那条 `tool_use` 的 `tool_result` 还没回填，它就成了一个**孤立的 tool_use**：
// 模型会看到「我调了工具」但看不到结果。
//
// 更糟的是 `sessionMemoryCompact` 会用这个 id 做切割点，
// 切出来的消息序列可能以 `tool_use` 结尾 —— 而 API 不接受这种序列。
//
// 所以这条判断是**为了产出一个协议合法的切割点**。
// 「什么时候可以安全地标记进度」不取决于「我什么时候做完」，
// 而取决于「数据在那一刻是否处于一致状态」。
function updateLastSummarizedMessageIdIfSafe(messages: Message[]): void {
  if (!hasToolCallsInLastAssistantTurn(messages)) {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.uuid) {
      setLastSummarizedMessageId(lastMessage.uuid)
    }
  }
}
