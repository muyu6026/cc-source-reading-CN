// 本文件是 `/clear` 的**主体**：真正把一次会话「抹干净」的 200 行。
//
// 顶部注释交代了它的定位：依赖重，所以能懒加载就懒加载（上层 `index.ts` 就是这么做的）。
//
// 读这个文件的正确顺序不是从上往下，而是**照它的执行顺序**跟一遍：钩子 → 遥测 → 算出要保留谁 → 清消息 → 清缓存 → 清状态树 → 换会话 ID → 重指文件指针 → 恢复模式 → 钩子。这十步的顺序每处都有原因，下面逐个说。
/**
 * Conversation clearing utility.
 * This module has heavier dependencies and should be lazy-loaded when possible.
 */
import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import {
  getLastMainRequestId,
  getOriginalCwd,
  getSessionId,
  regenerateSessionId,
} from '../../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { AppState } from '../../state/AppState.js'
import { isInProcessTeammateTask } from '../../tasks/InProcessTeammateTask/types.js'
import {
  isLocalAgentTask,
  type LocalAgentTaskState,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { isLocalShellTask } from '../../tasks/LocalShellTask/guards.js'
import { asAgentId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'
import { createEmptyAttributionState } from '../../utils/commitAttribution.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import {
  executeSessionEndHooks,
  getSessionEndHookTimeoutMs,
} from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import { clearAllPlanSlugs } from '../../utils/plans.js'
import { setCwd } from '../../utils/Shell.js'
import { processSessionStartHooks } from '../../utils/sessionStart.js'
import {
  clearSessionMetadata,
  getAgentTranscriptPath,
  resetSessionFilePointer,
  saveWorktreeState,
} from '../../utils/sessionStorage.js'
import {
  evictTaskOutput,
  initTaskOutputAsSymlink,
} from '../../utils/task/diskOutput.js'
import { getCurrentWorktreeSession } from '../../utils/worktree.js'
import { clearSessionCaches } from './caches.js'

// `clearConversation` 是唯一导出，也是整条链路的重心。
//
// 它的参数设计很值得注意：**没有直接 import 状态，而是让调用方把 setMessages / setAppState 这些钩子传进来**。这是 React 与命令系统之间的桥——命令层不认识 React，只认识「给我一个能改状态的函数」。所以同一个函数既能在交互式界面里用，也能在 SDK 里用。
export async function clearConversation({
  setMessages,
  readFileState,
  discoveredSkillNames,
  loadedNestedMemoryPaths,
  getAppState,
  setAppState,
  setConversationId,
}: {
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  readFileState: FileStateCache
  discoveredSkillNames?: Set<string>
  loadedNestedMemoryPaths?: Set<string>
  getAppState?: () => AppState
  setAppState?: (f: (prev: AppState) => AppState) => void
  setConversationId?: (id: UUID) => void
}): Promise<void> {
// 七个参数，三种角色，读的时候分开看：
//
// **必须给的**：`setMessages`（换消息列表）、`readFileState`（文件内容缓存，清空后下一次读会重新读盘）。
// **可选的**：`discoveredSkillNames`、`loadedNestedMemoryPaths`（两个 Set，清空即重置技能与嵌套记忆的发现记录）。
// **可能没有的**：`getAppState` / `setAppState` / `setConversationId`——SDK 场景下没有界面状态，这三个就是 undefined，于是下面相关代码整段跳过。
//
// **可选参数不是为了省事，是为了让同一个函数在两种宿主里都能跑。**
  // Execute SessionEnd hooks before clearing (bounded by
  // CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS, default 1.5s)
// 第一步：**先把 SessionEnd 钩子跑完，再清东西**。
//
// 顺序不能反——钩子里的用户脚本可能还要读会话内容（比如把对话归档），清完再跑就什么都读不到了。
//
// `AbortSignal.timeout(...)` 给钩子设了硬上限（默认 1.5 秒）：用户敲 /clear 是想赶紧清掉，不能被一个写坏的钩子卡住。这里同时传了 `timeoutMs` 和 `signal`，是两个层次的双保险（前者给钩子自己看，后者是真正生效的中断源）。
  const sessionEndTimeoutMs = getSessionEndHookTimeoutMs()
  await executeSessionEndHooks('clear', {
    getAppState,
    setAppState,
    signal: AbortSignal.timeout(sessionEndTimeoutMs),
    timeoutMs: sessionEndTimeoutMs,
  })
// 注意这一行是 `await` 的——但等待有上限，所以最坏情况是 1.5 秒。
//
// 如果这里没有 await，钩子会和后面的清理并发跑，钩子读到的就是「清到一半」的状态。**并发不是免费的，顺序有时就是语义。**

  // Signal to inference that this conversation's cache can be evicted.
  const lastRequestId = getLastMainRequestId()
  if (lastRequestId) {
    logEvent('tengu_cache_eviction_hint', {
      scope:
        'conversation_clear' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_request_id:
        lastRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
// 第二步：发一条遥测，告诉后端「这个会话的缓存可以回收了」。
//
// 关键在条件 `if (lastRequestId)`：只有真的发过请求，后端才有可回收的东西。没发过请求还去发提示，是纯噪音。
//
// 那种超长的类型名 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 不是逻辑，是一个**类型层面的护栏**：想让某个字符串进遥测，必须先把它断言成这个类型，等于强迫作者在代码里声明「我确认这里面没有代码或文件路径」。读代码时看到它就跳过，别去追它的定义。

  // Compute preserved tasks up front so their per-agent state survives the
  // cache wipe below. A task is preserved unless it explicitly has
  // isBackgrounded === false. Main-session tasks (Ctrl+B) are preserved —
  // they write to an isolated per-task transcript and run under an agent
  // context, so they're safe across session ID regeneration. See
  // LocalMainSessionTask.ts startBackgroundSession.
// 第三步：**先算出「哪些任务要保留」**，再开始清。
//
// 注释解释了判据：除非任务显式标了 `isBackgrounded === false`（前台任务），否则一律保留。所以前后台的分界线不是「谁在跑」，而是「它有没有说自己必须在前台」。
//
// 为什么要提前算：下面清缓存时要用这个集合（per-agent 状态不能抹），清状态树时还要用同一个判据。**同一个判断两处使用，就必须只写一次**——不然两处判据漂移，就会出现「缓存留了但任务被杀了」这种半死状态。
  const preservedAgentIds = new Set<string>()
  const preservedLocalAgents: LocalAgentTaskState[] = []
  const shouldKillTask = (task: AppState['tasks'][string]): boolean =>
    'isBackgrounded' in task && task.isBackgrounded === false
  if (getAppState) {
    for (const task of Object.values(getAppState().tasks)) {
      if (shouldKillTask(task)) continue
      if (isLocalAgentTask(task)) {
        preservedAgentIds.add(task.agentId)
        preservedLocalAgents.push(task)
      } else if (isInProcessTeammateTask(task)) {
        preservedAgentIds.add(task.identity.agentId)
      }
    }
  }
// 循环里分了两类：本地 agent 任务（记下 agentId 和完整状态，后面要重指它的输出文件），进程内队友任务（只要 agentId）。
//
// `getAppState` 可能是 undefined（SDK 场景），所以整段包在 if 里——这是本文件反复出现的模式。

// 第四步：清空消息列表。
//
// `setMessages(() => [])` 用函数形式而不是 `setMessages([])`：这是 React 状态更新的约定，传函数能拿到最新值。虽然这里根本不用旧值，但**统一用函数形式可以避免闭包拿到过期状态**。
//
// 注意这是**唯一的**消息清空点——后面所有清理都只是外围状态。
  setMessages(() => [])

  // Clear context-blocked flag so proactive ticks resume after /clear
  if (feature('PROACTIVE') || feature('KAIROS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { setContextBlocked } = require('../../proactive/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    setContextBlocked(false)
  }
// 第五步：清掉「上下文已阻塞」标记。
//
// 这个标记是主动模式（PROACTIVE / KAIROS）用来踩刹车的：上下文快满了就停止主动发起。 /clear 之后上下文是空的，刹车必须松开，否则主动能力再也起不来。
//
// `require(...)` 而不是 import，是因为这两个开关是构建期决定的——开关关掉的版本里，这个模块根本不存在，写静态 import 会直接构建失败。

  // Force logo re-render by updating conversationId
// 第六步：换一个新的 conversationId。
//
// 注释说这是为了「强制 logo 重新渲染」——界面上那个启动图标只在会话 ID 变化时重画。用一个随机 UUID 当「重绘触发器」，是个取巧但有效的做法：不需要给渲染层加新接口。
  if (setConversationId) {
    setConversationId(randomUUID())
  }

  // Clear all session-related caches. Per-agent state for preserved background
  // tasks (invoked skills, pending permission callbacks, dump state, cache-break
  // tracking) is retained so those agents keep functioning.
// 第七步：把缓存全清掉，但带上「要保留的 agent」这份名单。
//
// 这一行是本文件与 `caches.ts` 的接口：清缓存那 144 行代码不关心谁该保留，它只接受一个集合，然后对「按 agent 记账」的那几项做选择性清理。**分工很清楚：这里决定策略，那里执行。**
  clearSessionCaches(preservedAgentIds)

// 第八步：把工作目录、文件状态缓存、技能发现记录都恢复成初始态。
//
// `setCwd(getOriginalCwd())` 这一句容易被忽略：用户可能在会话中途 `cd` 到别的目录（或用 EnterWorktree 换了工作树），/clear 要把「当前目录」拉回启动时的那个——因为新会话必须从用户最初打开的位置开始。
  setCwd(getOriginalCwd())
  readFileState.clear()
  discoveredSkillNames?.clear()
  loadedNestedMemoryPaths?.clear()
// 两个可选 Set 用 `?.clear()`：SDK 调用可能没传，没传就跳过。
//
// `readFileState.clear()` 没有问号——它是必传的，因为「文件内容缓存」是新会话正确性的前提：不清的话，模型以为文件还是清之前的样子，Edit 会基于过期内容改。

  // Clean out necessary items from App State
// 第九步：一次性重建整个 AppState 的相关部分。
//
// 这一段是**本文件最长的一块**，做三件事：把前台任务杀掉并从状态里删掉、保留其余任务、重置若干会话级字段（归属、独立 agent 身份、文件历史、MCP 连接）。
//
// 值得记住的是它返回的是一个**新对象**（`{ ...prev, ... }`），而不是就地改 `prev`——React 靠「引用变了没有」判断要不要重渲染，就地改等于界面不更新。
  if (setAppState) {
    setAppState(prev => {
      // Partition tasks using the same predicate computed above:
      // kill+remove foreground tasks, preserve everything else.
      const nextTasks: AppState['tasks'] = {}
      for (const [taskId, task] of Object.entries(prev.tasks)) {
        if (!shouldKillTask(task)) {
          nextTasks[taskId] = task
          continue
        }
        // Foreground task: kill it and drop from state
        try {
// 杀前台任务的细节：三道清理，缺一不可。
//
// 1. 本地 shell 任务要 `kill()` 进程、`cleanup()` 资源、`clearTimeout()` 清掉那个定时器（不清的话定时器会在进程死后还悬着）。
// 2. 有 `abortController` 的任务要 `abort()`——这是给「正在等模型返回」的任务用的取消信号。
// 3. 有 `unregisterCleanup` 的要调它——把注册在全局清理表里的回调摘掉，否则进程退出时它会对着已经不存在的东西执行。
//
// `'x' in task` 这个写法是「类型收窄」：先确认字段存在，再访问。因为这个联合类型里不是每个成员都有这些字段。
          if (task.status === 'running') {
            if (isLocalShellTask(task)) {
              task.shellCommand?.kill()
              task.shellCommand?.cleanup()
              if (task.cleanupTimeoutId) {
                clearTimeout(task.cleanupTimeoutId)
              }
            }
            if ('abortController' in task) {
              task.abortController?.abort()
            }
            if ('unregisterCleanup' in task) {
              task.unregisterCleanup?.()
            }
          }
        } catch (error) {
          logError(error)
        }
        void evictTaskOutput(taskId)
      }
// **这个 try/catch 是故意吞错误的**（对应你读 L2-3 时看到的那 16 行）。
//
// 理由：清理要「尽力做完」。一个任务杀不掉，不能让剩下的任务都不清、更不能让 /clear 整体失败。所以单个失败只记日志，循环继续。
//
// `void evictTaskOutput(taskId)` 的 `void` 是明确表态：这个函数返回 Promise，但我故意不等——清输出文件是后台活，不该拖慢 /clear。

      return {
        ...prev,
        tasks: nextTasks,
        attribution: createEmptyAttributionState(),
        // Clear standalone agent context (name/color set by /rename, /color)
        // so the new session doesn't display the old session's identity badge
        standaloneAgentContext: undefined,
        fileHistory: {
          snapshots: [],
          trackedFiles: new Set(),
          snapshotSequence: 0,
        },
        // Reset MCP state to default to trigger re-initialization.
        // Preserve pluginReconnectKey so /clear doesn't cause a no-op
        // (it's only bumped by /reload-plugins).
        mcp: {
          clients: [],
          tools: [],
          commands: [],
          resources: {},
          pluginReconnectKey: prev.mcp.pluginReconnectKey,
        },
      }
    })
// 状态树重建完成。三个「看似无关」的字段都在这块里，值得单说：
//
// **`standaloneAgentContext: undefined`** —— 清掉上一会话用 /rename、/color 设的身份徽章，否则新会话会顶着旧名字。
// **`fileHistory`** —— 快照数组清空、序列号归零，这样新会话的撤销历史从零开始，不会撤回到上个会话去。
// **`mcp.pluginReconnectKey: prev.mcp.pluginReconnectKey`** —— 全清，**唯独这一项故意保留**。注释写明：它只由 /reload-plugins 递增，/clear 如果把它也重置，就会让插件重连变成一个空操作。
//
// **「重置一切」的代码里，最有信息量的是那个例外。**
  }

  // Clear plan slug cache so a new plan file is used after /clear
// 第十步：清掉计划文件（plan slug）的缓存。
//
// 理由和会话 ID 一样：新会话要有自己的计划文件，不能沿用上一个会话的。
  clearAllPlanSlugs()

  // Clear cached session metadata (title, tag, agent name/color)
  // so the new session doesn't inherit the previous session's identity
// 第十一步：清会话元数据（标题、标签、agent 名与颜色）。
//
// 这和上面清 `standaloneAgentContext` 是一对：一个在状态树里，一个在磁盘/缓存里，两处都必须清，否则 --resume 出来的新会话会带着旧身份。
  clearSessionMetadata()

  // Generate new session ID to provide fresh state
  // Set the old session as parent for analytics lineage tracking
// 第十二步：生成新会话 ID，并把**旧 ID 记成父会话**。
//
// `setCurrentAsParent: true` 这一项是为了分析链路：后端能看到「这个新会话是从哪个旧会话 clear 出来的」，从而把一次连续使用串成一条血缘，而不是两个毫不相干的会话。
  regenerateSessionId({ setCurrentAsParent: true })
  // Update the environment variable so subprocesses use the new session ID
  if (process.env.USER_TYPE === 'ant' && process.env.CLAUDE_CODE_SESSION_ID) {
    process.env.CLAUDE_CODE_SESSION_ID = getSessionId()
  }
// 第十三步：重置「会话文件写到哪了」的指针。
//
// 转录是追加写的，指针决定下一条写到哪个文件、哪个位置。不重置的话，新会话的第一条会追加到旧会话的文件末尾——这是最典型的「看起来清了、其实没清干净」。
  await resetSessionFilePointer()

  // Preserved local_agent tasks had their TaskOutput symlink baked against the
  // old session ID at spawn time, but post-clear transcript writes land under
  // the new session directory (appendEntry re-reads getSessionId()). Re-point
  // the symlinks so TaskOutput reads the live file instead of a frozen pre-clear
  // snapshot. Only re-point running tasks — finished tasks will never write
  // again, so re-pointing would replace a valid symlink with a dangling one.
  // Main-session tasks use the same per-agent path (they write via
  // recordSidechainTranscript to getAgentTranscriptPath), so no special case.
// 第十四步：给保留下来的后台 agent 重指输出文件的符号链接。
//
// 注释把机制说得很清楚：这些任务的 TaskOutput 软链是在**创建时**按旧会话 ID 焊死的，但 /clear 之后转录写到新会话目录，于是软链指向了一个不再更新的旧文件——用户去看任务输出，看到的是清空前的快照。
//
// 所以只对 `status === 'running'` 的重指：已结束的任务再也不会写了，重指只会把一个有效软链换成一个悬空软链。
  for (const task of preservedLocalAgents) {
    if (task.status !== 'running') continue
    void initTaskOutputAsSymlink(
      task.id,
      getAgentTranscriptPath(asAgentId(task.agentId)),
    )
  }
// 循环结束。注意这里是 `void initTaskOutputAsSymlink(...)`——不等它完成。
//
// 重指软链失败不是致命问题（下次读输出时会重新解析），所以不阻塞 /clear。

  // Re-persist mode and worktree state after the clear so future --resume
  // knows what the new post-clear session was in. clearSessionMetadata
  // wiped both from the cache, but the process is still in the same mode
  // and (if applicable) the same worktree directory.
// 第十五步：把「当前模式」和「当前工作树」重新写回磁盘。
//
// 为什么要写回：上一步的 `clearSessionMetadata()` 把这两项从缓存里清掉了，但**进程其实还处在同一个模式、同一个工作树**。如果不写回，下一次 --resume 会以为这是个普通模式的新会话，协调者模式就丢了。
//
// 这是本文件里最反直觉的一处：**清完之后要立刻补写，因为「清」清掉的是缓存，不是事实。**
  if (feature('COORDINATOR_MODE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { saveMode } = require('../../utils/sessionStorage.js')
    const {
      isCoordinatorMode,
    } = require('../../coordinator/coordinatorMode.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    saveMode(isCoordinatorMode() ? 'coordinator' : 'normal')
  }
  const worktreeSession = getCurrentWorktreeSession()
  if (worktreeSession) {
    saveWorktreeState(worktreeSession)
  }
// 工作树状态同理：进程还在那个 worktree 里，必须让磁盘上的记录跟上事实。

  // Execute SessionStart hooks after clearing
// 最后一步：跑 SessionStart 钩子。
//
// 和开头的 SessionEnd 是一对：**先收尾，再开场**。新会话要有自己的开场钩子——用户脚本可以在这里注入欢迎语、加载上下文、检查环境。
  const hookMessages = await processSessionStartHooks('clear')

  // Update messages with hook results
  if (hookMessages.length > 0) {
    setMessages(() => hookMessages)
  }
// 钩子返回的消息如果非空，就**作为新会话的第一批消息**放进去。
//
// 所以一次完整的 `/clear` 时序是：
// 1. SessionEnd 钩子（有 1.5 秒上限）
// 2. 遥测提示缓存可回收
// 3. 算出要保留的后台任务
// 4. 清消息 → 清缓存 → 重建状态树
// 5. 换会话 ID、重置文件指针、重指软链
// 6. 补写模式与工作树
// 7. SessionStart 钩子 → 它的输出成为新会话的第一条消息
//
// **读完之后你应该能回答一个问题**：`/clear` 到底「清」的是什么？（答案：清的是**上下文**和**围绕上下文的缓存**，不是清进程、不是清磁盘上的历史转录。）
}
