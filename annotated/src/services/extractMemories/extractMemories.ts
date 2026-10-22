// 整个文件是「后台记忆抽取器」：每轮 query loop 结束（模型给出最终回复且不带工具调用）时由 stopHooks.ts 的 handleStopHooks 触发一次，用 forked agent 模式（主对话的完美分叉，共享父进程 prompt 缓存）把「值得长期记住的东西」写进 ~/.claude/projects/<path>/memory/。所有可变状态都在 initExtractMemories() 的闭包里而非模块级——测试在 beforeEach 调它拿全新闭包，与 confidenceRating.ts 同一模式。
/**
 * Extracts durable memories from the current session transcript
 * and writes them to the auto-memory directory (~/.claude/projects/<path>/memory/).
 *
 * It runs once at the end of each complete query loop (when the model produces
 * a final response with no tool calls) via handleStopHooks in stopHooks.ts.
 *
 * Uses the forked agent pattern (runForkedAgent) — a perfect fork of the main
 * conversation that shares the parent's prompt cache.
 *
 * State is closure-scoped inside initExtractMemories() rather than module-level,
 * following the same pattern as confidenceRating.ts. Tests call
 * initExtractMemories() in beforeEach to get a fresh closure.
 */

import { feature } from 'bun:bundle'
import { basename } from 'path'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { ENTRYPOINT_NAME } from '../../memdir/memdir.js'
import {
  formatMemoryManifest,
  scanMemoryFiles,
} from '../../memdir/memoryScan.js'
import {
  getAutoMemPath,
  isAutoMemoryEnabled,
  isAutoMemPath,
} from '../../memdir/paths.js'
import type { Tool } from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { REPL_TOOL_NAME } from '../../tools/REPLTool/constants.js'
import type {
  AssistantMessage,
  Message,
  SystemLocalCommandMessage,
  SystemMessage,
} from '../../types/message.js'
import { createAbortController } from '../../utils/abortController.js'
import { count, uniq } from '../../utils/array.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import {
  createMemorySavedMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../analytics/metadata.js'
import {
  buildExtractAutoOnlyPrompt,
  buildExtractCombinedPrompt,
} from './prompts.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM')
  ? (require('../../memdir/teamMemPaths.js') as typeof import('../../memdir/teamMemPaths.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
// 惰性 require：只有 TEAMMEM feature 开启时才加载 teamMemPaths.js，与 teamMemSecretGuard.ts 同款模式——feature 关闭时连模块都不进 bundle。

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true if a message is visible to the model (sent in API calls).
 * Excludes progress, system, and attachment messages.
 */
function isModelVisibleMessage(message: Message): boolean {
  return message.type === 'user' || message.type === 'assistant'
}

function countModelVisibleMessagesSince(
  messages: Message[],
  sinceUuid: string | undefined,
): number {
  if (sinceUuid === null || sinceUuid === undefined) {
    return count(messages, isModelVisibleMessage)
  }

  let foundStart = false
  let n = 0
  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }
    if (isModelVisibleMessage(message)) {
      n++
    }
  }
  // If sinceUuid was not found (e.g., removed by context compaction),
  // fall back to counting all model-visible messages rather than returning 0
  // which would permanently disable extraction for the rest of the session.
  if (!foundStart) {
    return count(messages, isModelVisibleMessage)
  }
  return n
}
// 注意 106-108 的兜底：sinceUuid 找不到（比如被 context compaction 删掉了）时，回退成「数全部 model-visible 消息」而不是返回 0——返回 0 会让本 session 余下时间永久禁用抽取，属于静默失效。

/**
 * Returns true if any assistant message after the cursor UUID contains a
 * Write/Edit tool_use block targeting an auto-memory path.
 *
 * The main agent's prompt has full save instructions — when it writes
 * memories, the forked extraction is redundant. runExtraction skips the
 * agent and advances the cursor past this range, making the main agent
 * and the background agent mutually exclusive per turn.
 */
function hasMemoryWritesSince(
  messages: Message[],
  sinceUuid: string | undefined,
): boolean {
  let foundStart = sinceUuid === undefined
  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }
    if (message.type !== 'assistant') {
      continue
    }
    const content = (message as AssistantMessage).message.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      const filePath = getWrittenFilePath(block)
      if (filePath !== undefined && isAutoMemPath(filePath)) {
        return true
      }
    }
  }
  return false
}
// 互斥设计：主 agent 的系统提示里本来就有完整保存指令，它自己写记忆时 forked 抽取就是多余的。所以检测到光标之后有 Write/Edit 落在 auto-memory 路径，就跳过 agent 并把光标直接推过去——主 agent 和后台 agent 每轮二选一，绝不双写。

// ============================================================================
// Tool Permissions
// ============================================================================

function denyAutoMemTool(tool: Tool, reason: string) {
  logForDebugging(`[autoMem] denied ${tool.name}: ${reason}`)
  logEvent('tengu_auto_mem_tool_denied', {
    tool_name: sanitizeToolNameForAnalytics(tool.name),
  })
  return {
    behavior: 'deny' as const,
    message: reason,
    decisionReason: { type: 'other' as const, reason },
  }
}
// 拒绝也要记账：denyAutoMemTool 统一发 tengu_auto_mem_tool_denied 遥测（工具名过 sanitizeToolNameForAnalytics 脱敏），返回标准 deny 形状 + decisionReason，让上层 hook 链路知道为什么被拒。

/**
 * Creates a canUseTool function that allows Read/Grep/Glob (unrestricted),
 * read-only Bash commands, and Edit/Write only for paths within the
 * auto-memory directory. Shared by extractMemories and autoDream.
 */
export function createAutoMemCanUseTool(memoryDir: string): CanUseToolFn {
  return async (tool: Tool, input: Record<string, unknown>) => {
    // Allow REPL — when REPL mode is enabled (ant-default), primitive tools
    // are hidden from the tool list so the forked agent calls REPL instead.
    // REPL's VM context re-invokes this canUseTool for each inner primitive
    // (toolWrappers.ts createToolWrapper), so the Read/Bash/Edit/Write checks
    // below still gate the actual file and shell operations. Giving the fork a
    // different tool list would break prompt cache sharing (tools are part of
    // the cache key — see CacheSafeParams in forkedAgent.ts).
    if (tool.name === REPL_TOOL_NAME) {
      return { behavior: 'allow' as const, updatedInput: input }
    }
// REPL 一律放行的理由：REPL 模式（ant 默认）下 primitive 工具从工具列表里隐藏，forked agent 只能调 REPL；而 REPL 的 VM 上下文会对每个内部 primitive 重新走一遍这个 canUseTool，所以下面的 Read/Bash/Edit/Write 检查照样把关真正的文件与 shell 操作。给 fork 一份不同的工具列表会破坏 prompt 缓存共享——tools 是缓存 key 的一部分（forkedAgent.ts 的 CacheSafeParams）。

    // Allow Read/Grep/Glob unrestricted — all inherently read-only
    if (
      tool.name === FILE_READ_TOOL_NAME ||
      tool.name === GREP_TOOL_NAME ||
      tool.name === GLOB_TOOL_NAME
    ) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Allow Bash only for commands that pass BashTool.isReadOnly.
    // `tool` IS BashTool here — no static import needed.
    if (tool.name === BASH_TOOL_NAME) {
      const parsed = tool.inputSchema.safeParse(input)
      if (parsed.success && tool.isReadOnly(parsed.data)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      return denyAutoMemTool(
        tool,
        'Only read-only shell commands are permitted in this context (ls, find, grep, cat, stat, wc, head, tail, and similar)',
      )
    }

    if (
      (tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && isAutoMemPath(filePath)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }

    return denyAutoMemTool(
      tool,
      `only ${FILE_READ_TOOL_NAME}, ${GREP_TOOL_NAME}, ${GLOB_TOOL_NAME}, read-only ${BASH_TOOL_NAME}, and ${FILE_EDIT_TOOL_NAME}/${FILE_WRITE_TOOL_NAME} within ${memoryDir} are allowed`,
    )
  }
}
// 权限模型总纲：Read/Grep/Glob 天生只读所以不限；Bash 只放行 BashTool.isReadOnly 判定为只读的命令（ls/find/grep/cat/stat/wc/head/tail 一类，rm 明确不许）；Edit/Write 只许落在 memoryDir 内。这个 canUseTool 由 extractMemories 和 autoDream 共用一份。

// ============================================================================
// Extract file paths from agent output
// ============================================================================

/**
 * Extract file_path from a tool_use block's input, if present.
 * Returns undefined when the block is not an Edit/Write tool use or has no file_path.
 */
function getWrittenFilePath(block: {
  type: string
  name?: string
  input?: unknown
}): string | undefined {
  if (
    block.type !== 'tool_use' ||
    (block.name !== FILE_EDIT_TOOL_NAME && block.name !== FILE_WRITE_TOOL_NAME)
  ) {
    return undefined
  }
  const input = block.input
  if (typeof input === 'object' && input !== null && 'file_path' in input) {
    const fp = (input as { file_path: unknown }).file_path
    return typeof fp === 'string' ? fp : undefined
  }
  return undefined
}
// 只从 tool_use 块里取 file_path，且只认 Edit/Write 两种工具；其他块（纯文本、其他工具）返回 undefined。

function extractWrittenPaths(agentMessages: Message[]): string[] {
  const paths: string[] = []
  for (const message of agentMessages) {
    if (message.type !== 'assistant') {
      continue
    }
    const content = (message as AssistantMessage).message.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      const filePath = getWrittenFilePath(block)
      if (filePath !== undefined) {
        paths.push(filePath)
      }
    }
  }
  return uniq(paths)
}
// 收集所有写过的路径并用 uniq 去重——同一轮里反复改一个文件只算一条，遥测的 files_written 和「记忆保存了几条」都基于这个去重后的列表。

// ============================================================================
// Initialization & Closure-scoped State
// ============================================================================

type AppendSystemMessageFn = (
  msg: Exclude<SystemMessage, SystemLocalCommandMessage>,
) => void

/** The active extractor function, set by initExtractMemories(). */
let extractor:
  | ((
      context: REPLHookContext,
      appendSystemMessage?: AppendSystemMessageFn,
    ) => Promise<void>)
  | null = null

/** The active drain function, set by initExtractMemories(). No-op until init. */
let drainer: (timeoutMs?: number) => Promise<void> = async () => {}
// extractor/drainer 是模块级句柄，但真正干活的闭包由 initExtractMemories() 注入；未初始化时 executeExtractMemories/drainPendingExtraction 都是 no-op（可选调用 + 空实现），避免启动顺序耦合。

/**
 * Initialize the memory extraction system.
 * Creates a fresh closure that captures all mutable state (cursor position,
 * overlap guard, pending context). Call once at startup alongside
 * initConfidenceRating/initPromptCoaching, or per-test in beforeEach.
 */
export function initExtractMemories(): void {
  // --- Closure-scoped mutable state ---

  /** Every promise handed out by the extractor that hasn't settled yet.
   *  Coalesced calls that stash-and-return add fast-resolving promises
   *  (harmless); the call that starts real work adds a promise covering the
   *  full trailing-run chain via runExtraction's recursive finally. */
  const inFlightExtractions = new Set<Promise<void>>()

  /** UUID of the last message processed — cursor so each run only
   *  considers messages added since the previous extraction. */
  let lastMemoryMessageUuid: string | undefined

  /** One-shot flag: once we log that the gate is disabled, don't repeat. */
  let hasLoggedGateFailure = false

  /** True while runExtraction is executing — prevents overlapping runs. */
  let inProgress = false

  /** Counts eligible turns since the last extraction run. Resets to 0 after each run. */
  let turnsSinceLastExtraction = 0

  /** When a call arrives during an in-progress run, we stash the context here
   *  and run one trailing extraction after the current one finishes. */
  let pendingContext:
    | {
        context: REPLHookContext
        appendSystemMessage?: AppendSystemMessageFn
      }
    | undefined
// 闭包里的六个可变状态：inFlightExtractions（所有未 settle 的 promise，合并调用塞进的快返 promise 无害，真干活的调用覆盖整条 trailing 链）、lastMemoryMessageUuid（光标，每轮只处理上次抽取后新增的消息）、hasLoggedGateFailure（gate 关着只记一次日志）、inProgress（防重叠运行）、turnsSinceLastExtraction（节流计数，每次跑完清零）、pendingContext（运行中到达的调用暂存，只留最新一份）。

  // --- Inner extraction logic ---

  async function runExtraction({
    context,
    appendSystemMessage,
    isTrailingRun,
  }: {
    context: REPLHookContext
    appendSystemMessage?: AppendSystemMessageFn
    isTrailingRun?: boolean
  }): Promise<void> {
// runExtraction 是真正的抽取逻辑；isTrailingRun 标记来自暂存上下文补跑的那一次。
    const { messages } = context
    const memoryDir = getAutoMemPath()
    const newMessageCount = countModelVisibleMessagesSince(
      messages,
      lastMemoryMessageUuid,
    )

    // Mutual exclusion: when the main agent wrote memories, skip the
    // forked agent and advance the cursor past this range so the next
    // extraction only considers messages after the main agent's write.
    if (hasMemoryWritesSince(messages, lastMemoryMessageUuid)) {
      logForDebugging(
        '[extractMemories] skipping — conversation already wrote to memory files',
      )
      const lastMessage = messages.at(-1)
      if (lastMessage?.uuid) {
        lastMemoryMessageUuid = lastMessage.uuid
      }
      logEvent('tengu_extract_memories_skipped_direct_write', {
        message_count: newMessageCount,
      })
      return
    }
// 检测到主 agent 已经写过记忆文件：跳过 forked agent，把光标推到最新消息，并发 tengu_extract_memories_skipped_direct_write 遥测——这就是「每轮互斥」的落点。

    const teamMemoryEnabled = feature('TEAMMEM')
      ? teamMemPaths!.isTeamMemoryEnabled()
      : false

    const skipIndex = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_moth_copse',
      false,
    )
// 两个 feature 开关：TEAMMEM 决定走 combined 还是 auto-only prompt；tengu_moth_copse 决定 skipIndex（跳过 MEMORY.md 索引维护）。都走 getFeatureValue_CACHED_MAY_BE_STALE——允许短暂陈旧，换取零延迟。

    const canUseTool = createAutoMemCanUseTool(memoryDir)
    const cacheSafeParams = createCacheSafeParams(context)

    // Only run extraction every N eligible turns (tengu_bramble_lintel, default 1).
    // Trailing extractions (from stashed contexts) skip this check since they
    // process already-committed work that should not be throttled.
    if (!isTrailingRun) {
      turnsSinceLastExtraction++
      if (
        turnsSinceLastExtraction <
        (getFeatureValue_CACHED_MAY_BE_STALE('tengu_bramble_lintel', null) ?? 1)
      ) {
        return
      }
    }
    turnsSinceLastExtraction = 0
// 节流门（tengu_bramble_lintel，默认 1 = 每轮都抽）：不够 N 个合格轮次就 return；trailing run 跳过这个检查——它处理的是已经承诺过的工作，不该再被节流。计数器在真跑之前清零。

    inProgress = true
    const startTime = Date.now()
    try {
      logForDebugging(
        `[extractMemories] starting — ${newMessageCount} new messages, memoryDir=${memoryDir}`,
      )

      // Pre-inject the memory directory manifest so the agent doesn't spend
      // a turn on `ls`. Reuses findRelevantMemories' frontmatter scan.
      // Placed after the throttle gate so skipped turns don't pay the scan cost.
      const existingMemories = formatMemoryManifest(
        await scanMemoryFiles(memoryDir, createAbortController().signal),
      )
// 预注入现有记忆清单（formatMemoryManifest 复用 findRelevantMemories 的 frontmatter 扫描），省掉 agent 第一轮 ls 的轮次。故意放在节流门之后——被跳过的轮次不付这个扫描成本。

      const userPrompt =
        feature('TEAMMEM') && teamMemoryEnabled
          ? buildExtractCombinedPrompt(
              newMessageCount,
              existingMemories,
              skipIndex,
            )
          : buildExtractAutoOnlyPrompt(
              newMessageCount,
              existingMemories,
              skipIndex,
            )

      const result = await runForkedAgent({
        promptMessages: [createUserMessage({ content: userPrompt })],
        cacheSafeParams,
        canUseTool,
        querySource: 'extract_memories',
        forkLabel: 'extract_memories',
        // The extractMemories subagent does not need to record to transcript.
        // Doing so can create race conditions with the main thread.
        skipTranscript: true,
        // Well-behaved extractions complete in 2-4 turns (read → write).
        // A hard cap prevents verification rabbit-holes from burning turns.
        maxTurns: 5,
      })
// 两个关键参数：skipTranscript: true——抽取子代理不写 transcript，否则会跟主线程抢记录产生竞态；maxTurns: 5——正常抽取 2-4 轮（读→写），硬顶防止验证兔子洞烧轮次（prompt 里也明令禁止 grep/读码/git 验证）。

      // Advance the cursor only after a successful run. If the agent errors
      // out (caught below), the cursor stays put so those messages are
      // reconsidered on the next extraction.
      const lastMessage = messages.at(-1)
      if (lastMessage?.uuid) {
        lastMemoryMessageUuid = lastMessage.uuid
      }

      const writtenPaths = extractWrittenPaths(result.messages)
      const turnCount = count(result.messages, m => m.type === 'assistant')

      const totalInput =
        result.totalUsage.input_tokens +
        result.totalUsage.cache_creation_input_tokens +
        result.totalUsage.cache_read_input_tokens
      const hitPct =
        totalInput > 0
          ? (
              (result.totalUsage.cache_read_input_tokens / totalInput) *
              100
            ).toFixed(1)
          : '0.0'
// 光标只在成功后推进：agent 抛错被下面 catch 住时光标不动，那些消息下次抽取会重新考虑。同时算出缓存命中率进调试日志——forked agent 的整个价值就在于蹭父进程缓存，命中率掉了说明缓存键被破坏了。
      logForDebugging(
        `[extractMemories] finished — ${writtenPaths.length} files written, cache: read=${result.totalUsage.cache_read_input_tokens} create=${result.totalUsage.cache_creation_input_tokens} input=${result.totalUsage.input_tokens} (${hitPct}% hit)`,
      )

      if (writtenPaths.length > 0) {
        logForDebugging(
          `[extractMemories] memories saved: ${writtenPaths.join(', ')}`,
        )
      } else {
        logForDebugging('[extractMemories] no memories saved this run')
      }

      // Index file updates are mechanical — the agent touches MEMORY.md to add
      // a topic link, but the user-visible "memory" is the topic file itself.
      const memoryPaths = writtenPaths.filter(
        p => basename(p) !== ENTRYPOINT_NAME,
      )
      const teamCount = feature('TEAMMEM')
        ? count(memoryPaths, teamMemPaths!.isTeamMemPath)
        : 0
// 用户可见的「记忆」是话题文件本身，MEMORY.md（ENTRYPOINT_NAME）只是索引——所以 memoryPaths 把索引文件过滤掉再计数和展示；teamCount 只在 TEAMMEM 开启时统计团队记忆条数。

      // Log extraction event with usage from the forked agent
      logEvent('tengu_extract_memories_extraction', {
        input_tokens: result.totalUsage.input_tokens,
        output_tokens: result.totalUsage.output_tokens,
        cache_read_input_tokens: result.totalUsage.cache_read_input_tokens,
        cache_creation_input_tokens:
          result.totalUsage.cache_creation_input_tokens,
        message_count: newMessageCount,
        turn_count: turnCount,
        files_written: writtenPaths.length,
        memories_saved: memoryPaths.length,
        team_memories_saved: teamCount,
        duration_ms: Date.now() - startTime,
      })

      logForDebugging(
        `[extractMemories] writtenPaths=${writtenPaths.length} memoryPaths=${memoryPaths.length} appendSystemMessage defined=${appendSystemMessage != null}`,
      )
      if (memoryPaths.length > 0) {
        const msg = createMemorySavedMessage(memoryPaths)
        if (feature('TEAMMEM')) {
          msg.teamCount = teamCount
        }
        appendSystemMessage?.(msg)
      }
// tengu_extract_memories_extraction 遥测带齐 token 用量（input/output/cache_read/cache_creation）、消息数、轮数、写文件数、保存记忆数、团队记忆数、耗时。有真记忆落盘才向界面 append createMemorySavedMessage（含 teamCount 区分）。
    } catch (error) {
      // Extraction is best-effort — log but don't notify on error
      logForDebugging(`[extractMemories] error: ${error}`)
      logEvent('tengu_extract_memories_error', {
        duration_ms: Date.now() - startTime,
      })
// 抽取是 best-effort：出错只进调试日志 + tengu_extract_memories_error 遥测（带耗时），不弹通知、不重试——它跑在 query loop 尾部，绝不能因为后台抽取失败而打扰用户或改变主流程行为。
    } finally {
      inProgress = false

      // If a call arrived while we were running, run a trailing extraction
      // with the latest stashed context. The trailing run will compute its
      // newMessageCount relative to the cursor we just advanced — so it only
      // picks up messages added between the two calls, not the full history.
      const trailing = pendingContext
      pendingContext = undefined
      if (trailing) {
        logForDebugging(
          '[extractMemories] running trailing extraction for stashed context',
        )
        await runExtraction({
          context: trailing.context,
          appendSystemMessage: trailing.appendSystemMessage,
          isTrailingRun: true,
        })
      }
// trailing run 机制：finally 里取走暂存上下文，用刚推进过的光标再跑一次——所以它只捡两次调用之间新增的消息，不是全历史重放。递归调用靠 finally 链式传递，保证 inFlightExtractions 里的 promise 覆盖整条 trailing 链。
    }
  }

  // --- Public entry point (captured by extractor) ---

  async function executeExtractMemoriesImpl(
    context: REPLHookContext,
    appendSystemMessage?: AppendSystemMessageFn,
  ): Promise<void> {
    // Only run for the main agent, not subagents
    if (context.toolUseContext.agentId) {
      return
    }

    if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', false)) {
      if (process.env.USER_TYPE === 'ant' && !hasLoggedGateFailure) {
        hasLoggedGateFailure = true
        logEvent('tengu_extract_memories_gate_disabled', {})
      }
      return
    }

    // Check auto-memory is enabled
    if (!isAutoMemoryEnabled()) {
      return
    }

    // Skip in remote mode
    if (getIsRemoteMode()) {
      return
    }
// 入口四道闸（顺序即优先级）：只服务主 agent（toolUseContext.agentId 非空的子代理直接返回，子代理不抽记忆）；tengu_passport_quail feature 门（关着时 ant 用户只记一次 tengu_extract_memories_gate_disabled）；auto-memory 总开关；remote 模式跳过（远程模式的记忆同步走另一套）。

    // If an extraction is already in progress, stash this context for a
    // trailing run (overwrites any previously stashed context — only the
    // latest matters since it has the most messages).
    if (inProgress) {
      logForDebugging(
        '[extractMemories] extraction in progress — stashing for trailing run',
      )
      logEvent('tengu_extract_memories_coalesced', {})
      pendingContext = { context, appendSystemMessage }
      return
    }
// 合并（coalesce）：已经在抽时新调用到达，只暂存最新上下文（最新的消息最全，旧的没意义），发 tengu_extract_memories_coalesced 遥测后立即返回——调用方拿到的是快返 promise，不阻塞。

    await runExtraction({ context, appendSystemMessage })
  }

  extractor = async (context, appendSystemMessage) => {
    const p = executeExtractMemoriesImpl(context, appendSystemMessage)
    inFlightExtractions.add(p)
    try {
      await p
    } finally {
      inFlightExtractions.delete(p)
    }
  }

  drainer = async (timeoutMs = 60_000) => {
    if (inFlightExtractions.size === 0) return
    await Promise.race([
      Promise.all(inFlightExtractions).catch(() => {}),
      // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
      new Promise<void>(r => setTimeout(r, timeoutMs).unref()),
    ])
  }
// drainer 等所有 in-flight promise（含 trailing 链），与一个 unref 的软超时赛跑。setTimeout 的 promise 必须 .unref()——sleep() 没有 unref，不让它吊住事件循环，否则 print 模式跑完进程退不出去。
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run memory extraction at the end of a query loop.
 * Called fire-and-forget from handleStopHooks, alongside prompt suggestion/coaching.
 * No-ops until initExtractMemories() has been called.
 */
export async function executeExtractMemories(
  context: REPLHookContext,
  appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {
  await extractor?.(context, appendSystemMessage)
}

/**
 * Awaits all in-flight extractions (including trailing stashed runs) with a
 * soft timeout. Called by print.ts after the response is flushed but before
 * gracefulShutdownSync, so the forked agent completes before the 5s shutdown
 * failsafe kills it. No-op until initExtractMemories() has been called.
 */
export async function drainPendingExtraction(
  timeoutMs?: number,
): Promise<void> {
  await drainer(timeoutMs)
}
// print.ts 在响应 flush 之后、gracefulShutdownSync 之前调它，让 forked agent 在 5 秒关停保险丝动手前跑完；默认 60s 软超时。未初始化时是 no-op。
