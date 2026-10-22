// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
// Background memory consolidation. Fires the /dream prompt as a forked
// subagent when time-gate passes AND enough sessions have accumulated.
//
// Gate order (cheapest first):
//   1. Time: hours since lastConsolidatedAt >= minHours (one stat)
//   2. Sessions: transcript count with mtime > lastConsolidatedAt >= minSessions
//   3. Lock: no other process mid-consolidation
//
// State is closure-scoped inside initAutoDream() rather than module-level
// (tests call initAutoDream() in beforeEach for a fresh closure).
// 模块定位：**「做梦」= 后台记忆整理**。一次对话跑完之后（挂 `postSamplingHooks`），如果距上次整理够久、并且又攒够了足够多的会话，就 fork 一个子代理去回看历史 transcript，把零散信号合并进长期记忆。所以它和 `extractMemories/` 是一对搭档：那个负责**抽**（当场把该记的写下），这个负责**整理**（隔天回看、去重、改错、剪枝）。文件头这张「门控顺序」表是全文骨架——**按开销从小到大排**：先一次 `stat`（时间门），再一次目录扫描（会话门），最后才抢文件锁。

import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  createUserMessage,
  createMemorySavedMessage,
} from '../../utils/messages.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import type { ToolUseContext } from '../../Tool.js'
import { logEvent } from '../analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { isAutoMemoryEnabled, getAutoMemPath } from '../../memdir/paths.js'
import { isAutoDreamEnabled } from './config.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import {
  getOriginalCwd,
  getKairosActive,
  getIsRemoteMode,
  getSessionId,
} from '../../bootstrap/state.js'
import { createAutoMemCanUseTool } from '../extractMemories/extractMemories.js'
import { buildConsolidationPrompt } from './consolidationPrompt.js'
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
} from './consolidationLock.js'
import {
  registerDreamTask,
  addDreamTurn,
  completeDreamTask,
  failDreamTask,
  isDreamTask,
} from '../../tasks/DreamTask/DreamTask.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'

// Scan throttle: when time-gate passes but session-gate doesn't, the lock
// mtime doesn't advance, so the time-gate keeps passing every turn.
const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000
// `SESSION_SCAN_INTERVAL_MS` 存在的理由在上面两行注释里，是个容易踩的连环坑：会话门不通过时**锁文件的 mtime 不会推进**（推进 mtime 就等于对外宣布「已整理」），于是下一轮「时间门」依然过得去——每轮都白扫一遍 transcript 目录。所以单独加一个**内存级**节流阀：时间门过了但上次扫描不到 10 分钟，直接早退。

type AutoDreamConfig = {
  minHours: number
  minSessions: number
}

const DEFAULTS: AutoDreamConfig = {
  minHours: 24,
  minSessions: 5,
}
// 默认阈值：**24 小时 + 5 个会话**，两者是「与」关系。时间不够久不整理（避免刚整理完又整理），会话不够多也不整理（没有新信号，整理一次等于白烧一大笔 token）。

/**
 * Thresholds from tengu_onyx_plover. The enabled gate lives in config.ts
 * (isAutoDreamEnabled); this returns only the scheduling knobs. Defensive
 * per-field validation since GB cache can return stale wrong-type values.
 */
function getConfig(): AutoDreamConfig {
  const raw =
    getFeatureValue_CACHED_MAY_BE_STALE<Partial<AutoDreamConfig> | null>(
      'tengu_onyx_plover',
      null,
    )
  return {
    minHours:
      typeof raw?.minHours === 'number' &&
      Number.isFinite(raw.minHours) &&
      raw.minHours > 0
        ? raw.minHours
        : DEFAULTS.minHours,
    minSessions:
      typeof raw?.minSessions === 'number' &&
      Number.isFinite(raw.minSessions) &&
      raw.minSessions > 0
        ? raw.minSessions
        : DEFAULTS.minSessions,
  }
}
// `getConfig` 的防御写法值得专门学：GrowthBook 的缓存**可能返回旧版本、类型错误的字段**（发布端改了 schema、客户端还没刷新），所以每个字段都要单独过 `typeof === 'number'` + `Number.isFinite` + `> 0` 三关，任一不过就退回默认值。这里不能用 `??` 兜底——`null` 和 `NaN` 都能骗过 `??`，而一个 `NaN` 会让后面所有时间比较静默失效。

function isGateOpen(): boolean {
  if (getKairosActive()) return false // KAIROS mode uses disk-skill dream
  if (getIsRemoteMode()) return false
  if (!isAutoMemoryEnabled()) return false
  return isAutoDreamEnabled()
}
// `isGateOpen` 是四道前置，任一为假就整块跳过。两个容易忽略的排除项：**KAIROS 模式**（那条线用的是磁盘 skill 版的 dream，不走这套 fork 逻辑）和**远程模式**（CCR 里跑后台整理没有意义）。另外注意它把 `isAutoMemoryEnabled()` 也算进门——没有记忆目录，整理出来的东西无处可写。

// Ant-build-only test override. Bypasses enabled/time/session gates but NOT
// the lock (so repeated turns don't pile up dreams) or the memory-dir
// precondition. Still scans sessions so the prompt's session-hint is populated.
function isForced(): boolean {
  return false
}
// `isForced` 在这份开源构建里**硬编码为 `false`**——它是 Anthropic 内构建的测试开关，能绕过启用/时间/会话三道门（但**不绕锁**，避免连续回合堆出一串 dream）。保留这个恒假函数而不是删掉、并保留下面那些 `if (!force ...)` 分支，是为了让测试逻辑与内构建保持同构。

type AppendSystemMessageFn = NonNullable<ToolUseContext['appendSystemMessage']>

let runner:
  | ((
      context: REPLHookContext,
      appendSystemMessage?: AppendSystemMessageFn,
    ) => Promise<void>)
  | null = null

/**
 * Call once at startup (from backgroundHousekeeping alongside
 * initExtractMemories), or per-test in beforeEach for a fresh closure.
 */
export function initAutoDream(): void {
// 状态全部收在闭包里，不用模块级变量：`lastSessionScanAt` 就是上面那个节流阀。这么写的好处很具体——**测试可以在 `beforeEach` 里重新 `initAutoDream()` 换到一个全新闭包**，不用手写 reset 函数。也正因为状态在闭包里，真正干活的函数被赋给模块级的 `runner`，而 `executeAutoDream` 只是个转发壳。
  let lastSessionScanAt = 0

  runner = async function runAutoDream(context, appendSystemMessage) {
    const cfg = getConfig()
    const force = isForced()
    if (!force && !isGateOpen()) return
// `force` 的语义在这里第一次生效：内构建测试时**连启用开关都不用打开**，直接往下走。生产构建里 `force` 恒假，所以这行等价于 `if (!isGateOpen()) return`。

    // --- Time gate ---
    let lastAt: number
    try {
      lastAt = await readLastConsolidatedAt()
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] readLastConsolidatedAt failed: ${(e as Error).message}`,
      )
      return
    }
    const hoursSince = (Date.now() - lastAt) / 3_600_000
    if (!force && hoursSince < cfg.minHours) return
// 时间门。常态下**每轮对话的固定开销就这一条 `stat`**（见 `readLastConsolidatedAt`）。注意它在读取失败时**直接 return、而不是当成 0 处理**——若把「读不到」当成「从没整理过」，磁盘一抖动就会立刻触发一次全量整理。

    // --- Scan throttle ---
    const sinceScanMs = Date.now() - lastSessionScanAt
    if (!force && sinceScanMs < SESSION_SCAN_INTERVAL_MS) {
      logForDebugging(
        `[autoDream] scan throttle — time-gate passed but last scan was ${Math.round(sinceScanMs / 1000)}s ago`,
      )
      return
    }
    lastSessionScanAt = Date.now()
// 节流阀在这里落账：**只有真正往下走才更新**。位置也有讲究——放在时间门之后、会话门之前，因为要省的就是会话门那次目录扫描，而不是时间门那一次 `stat`。

    // --- Session gate ---
    let sessionIds: string[]
    try {
      sessionIds = await listSessionsTouchedSince(lastAt)
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] listSessionsTouchedSince failed: ${(e as Error).message}`,
      )
      return
    }
    // Exclude the current session (its mtime is always recent).
    const currentSession = getSessionId()
    sessionIds = sessionIds.filter(id => id !== currentSession)
// 必须排除当前会话——它自己的 mtime 永远是「刚刚」，不排掉的话「攒够 5 个会话」永远差一个，而且整理时还会把正在进行的这一场当成历史会话去读半截。注意会话门只是个**跳过闸**（skip-gate）：估少了顶多晚点整理，估多了才会浪费 token，所以 `listSessionsTouchedSince` 只扫当前 cwd 的 transcript、不算 worktree 里的会话，注释里明说这是安全的。
    if (!force && sessionIds.length < cfg.minSessions) {
      logForDebugging(
        `[autoDream] skip — ${sessionIds.length} sessions since last consolidation, need ${cfg.minSessions}`,
      )
      return
    }

    // --- Lock ---
    // Under force, skip acquire entirely — use the existing mtime so
    // kill's rollback is a no-op (rewinds to where it already is).
    // The lock file stays untouched; next non-force turn sees it as-is.
    let priorMtime: number | null
    if (force) {
      priorMtime = lastAt
    } else {
      try {
        priorMtime = await tryAcquireConsolidationLock()
      } catch (e: unknown) {
        logForDebugging(
          `[autoDream] lock acquire failed: ${(e as Error).message}`,
        )
        return
      }
      if (priorMtime === null) return
    }
// 抢锁。`force` 分支故意**不去抢锁**，而是把「上次整理时间」当作 priorMtime 传下去——这样万一之后失败回滚，`rollbackConsolidationLock(priorMtime)` 只是把 mtime 改回它原本的值，等于空操作，不会破坏别的进程正持有的锁。非 force 路径返回 `null` 表示「有活着的进程正在整理」，安静退出即可，这是常态而非错误。

    logForDebugging(
      `[autoDream] firing — ${hoursSince.toFixed(1)}h since last, ${sessionIds.length} sessions to review`,
    )
    logEvent('tengu_auto_dream_fired', {
      hours_since: Math.round(hoursSince),
      sessions_since: sessionIds.length,
    })

    const setAppState =
      context.toolUseContext.setAppStateForTasks ??
      context.toolUseContext.setAppState
    const abortController = new AbortController()
    const taskId = registerDreamTask(setAppState, {
      sessionsReviewing: sessionIds.length,
      priorMtime,
      abortController,
    })
// **先注册任务再 fork**。这样用户在后台任务面板里立刻就能看到「正在整理记忆 · 回顾 N 个会话」，并且可以点 kill。`abortController` 交给 task 持有——kill 时由 `DreamTask.kill` 一处把 abort、回滚锁、置 `killed` 状态三件事做完。

    try {
      const memoryRoot = getAutoMemPath()
      const transcriptDir = getProjectDir(getOriginalCwd())
      // Tool constraints note goes in `extra`, not the shared prompt body —
      // manual /dream runs in the main loop with normal permissions and this
      // would be misleading there.
      const extra = `

**Tool constraints for this run:** Bash is restricted to read-only commands (\`ls\`, \`find\`, \`grep\`, \`cat\`, \`stat\`, \`wc\`, \`head\`, \`tail\`, and similar). Anything that writes, redirects to a file, or modifies state will be denied. Plan your exploration with this in mind — no need to probe.

Sessions since last consolidation (${sessionIds.length}):
${sessionIds.map(id => `- ${id}`).join('\n')}`
      const prompt = buildConsolidationPrompt(memoryRoot, transcriptDir, extra)
// `extra` 和共享 prompt 体分开拼，理由写在上面那段注释里：手动 `/dream` 是在主循环里跑的、权限正常，如果把「Bash 只能只读」这段约束塞进共享 prompt 正文，手动跑时会直接误导模型。这里 fork 出去的子代理写权限被限死在记忆目录（见下一条 `canUseTool`），所以要把「能干什么」提前讲明白，省得它反复试错被拒。

      const result = await runForkedAgent({
        promptMessages: [createUserMessage({ content: prompt })],
        cacheSafeParams: createCacheSafeParams(context),
        canUseTool: createAutoMemCanUseTool(memoryRoot),
        querySource: 'auto_dream',
        forkLabel: 'auto_dream',
        skipTranscript: true,
        overrides: { abortController },
        onMessage: makeDreamProgressWatcher(taskId, setAppState),
      })
// 三个参数撑起整个沙箱：① `canUseTool: createAutoMemCanUseTool(memoryRoot)` —— **直接复用 `extractMemories/` 的权限函数**，写操作只允许落在记忆目录内；② `skipTranscript: true` —— 这次 fork 不写进会话 transcript，否则下次「回顾 N 个会话」会把整理过程本身也数成用户会话；③ `querySource` 与 `forkLabel` 都固定为 `'auto_dream'`，用于日志与 UI 归因。

      completeDreamTask(taskId, setAppState)
      // Inline completion summary in the main transcript (same surface as
      // extractMemories's "Saved N memories" message).
      const dreamState = context.toolUseContext.getAppState().tasks?.[taskId]
      if (
        appendSystemMessage &&
        isDreamTask(dreamState) &&
        dreamState.filesTouched.length > 0
      ) {
        appendSystemMessage({
          ...createMemorySavedMessage(dreamState.filesTouched),
          verb: 'Improved',
        })
      }
// 整理完在主 transcript 里留一行摘要，和 `extractMemories` 的「Saved N memories」是同一个展示位，区别只在动词：那个是 `'Saved'`（新存），这个是 `'Improved'`（改进已有）。另外它只在**确实改过文件**（`filesTouched.length > 0`）时才说话——没改动就别刷屏。
      logForDebugging(
        `[autoDream] completed — cache: read=${result.totalUsage.cache_read_input_tokens} created=${result.totalUsage.cache_creation_input_tokens}`,
      )
      logEvent('tengu_auto_dream_completed', {
        cache_read: result.totalUsage.cache_read_input_tokens,
        cache_created: result.totalUsage.cache_creation_input_tokens,
        output: result.totalUsage.output_tokens,
        sessions_reviewed: sessionIds.length,
      })
    } catch (e: unknown) {
      // If the user killed from the bg-tasks dialog, DreamTask.kill already
      // aborted, rolled back the lock, and set status=killed. Don't overwrite
      // or double-rollback.
      if (abortController.signal.aborted) {
        logForDebugging('[autoDream] aborted by user')
        return
      }
// 用户从后台任务面板 kill 掉的情况必须**单独早退**：`DreamTask.kill` 已经做过 abort、回滚锁、置状态这三件事，这里再走一遍 `failDreamTask` + `rollbackConsolidationLock` 会把刚回滚过的 mtime 再回滚一次（第二次读到的 priorMtime 已经不对），并把 `killed` 状态覆盖成 `failed`。
      logForDebugging(`[autoDream] fork failed: ${(e as Error).message}`)
      logEvent('tengu_auto_dream_failed', {})
      failDreamTask(taskId, setAppState)
      // Rewind mtime so time-gate passes again. Scan throttle is the backoff.
      await rollbackConsolidationLock(priorMtime)
    }
// 只有真失败才回滚：把锁文件 mtime 倒回抢锁前的值，让时间门下一轮重新放行。**退避靠的是上面那个 10 分钟扫描节流**——回滚后立刻又满足时间门，但节流阀会压住，最多每 10 分钟重试一次，不会退化成死循环重试。
  }
}

/**
 * Watch the forked agent's messages. For each assistant turn, extracts any
 * text blocks (the agent's reasoning/summary — what the user wants to see)
 * and collapses tool_use blocks to a count. Edit/Write file_paths are
 * collected for phase-flip + the inline completion message.
 */
function makeDreamProgressWatcher(
  taskId: string,
  setAppState: import('../../Task.js').SetAppState,
): (msg: Message) => void {
  return msg => {
    if (msg.type !== 'assistant') return
    let text = ''
    let toolUseCount = 0
    const touchedPaths: string[] = []
    for (const block of msg.message.content) {
      if (block.type === 'text') {
        text += block.text
      } else if (block.type === 'tool_use') {
        toolUseCount++
        if (
          block.name === FILE_EDIT_TOOL_NAME ||
          block.name === FILE_WRITE_TOOL_NAME
        ) {
          const input = block.input as { file_path?: unknown }
          if (typeof input.file_path === 'string') {
            touchedPaths.push(input.file_path)
          }
        }
      }
    }
    addDreamTurn(
      taskId,
      { text: text.trim(), toolUseCount },
      touchedPaths,
      setAppState,
    )
  }
}
// 进度观察器只做三件很克制的事：文本块**累加**成这一轮的思考摘要（用户真正想看的就是这个）；`tool_use` 只**数个数**、不展开（否则面板会被几十条 Grep 刷满）；只对 `Edit`/`Write` 收集 `file_path`，用于阶段翻转和最后那行「Improved N files」。注意它比较的是工具**常量**而不是字符串字面量——工具改名时这里会一起编译报错，而不是静默失配。

/**
 * Entry point from stopHooks. No-op until initAutoDream() has been called.
 * Per-turn cost when enabled: one GB cache read + one stat.
 */
export async function executeAutoDream(
  context: REPLHookContext,
  appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {
  await runner?.(context, appendSystemMessage)
}
// 入口是个可空转发：`runner` 为 `null`（还没调用过 `initAutoDream()`）时**整个函数是空操作**——所以初始化顺序很重要。启用状态下的每轮固定开销只有两项：一次 GrowthBook 缓存读（`getConfig`）+ 一次 `stat`（时间门）。
