/**
 * LocalMainSessionTask - Handles backgrounding the main session query.
 *
 * When user presses Ctrl+B twice during a query, the session is "backgrounded":
 * - The query continues running in the background
 * - The UI clears to a fresh prompt
 * - A notification is sent when the query completes
 *
 * This reuses the LocalAgentTask state structure since the behavior is similar.
 */

// 把主会话的查询搬到后台：界面清空回到新提示符，查询继续跑，完成时发通知
import type { UUID } from 'crypto'
import { randomBytes } from 'crypto'
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js'
import { type QueryParams, query } from '../query.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { SetAppState } from '../Task.js'
import { createTaskStateBase } from '../Task.js'
import type {
  AgentDefinition,
  CustomAgentDefinition,
} from '../tools/AgentTool/loadAgentsDir.js'
import { asAgentId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import { createAbortController } from '../utils/abortController.js'
import {
  runWithAgentContext,
  type SubagentContext,
} from '../utils/agentContext.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import {
  getAgentTranscriptPath,
  recordSidechainTranscript,
} from '../utils/sessionStorage.js'
import {
  evictTaskOutput,
  getTaskOutputPath,
  initTaskOutputAsSymlink,
} from '../utils/task/diskOutput.js'
import { registerTask, updateTaskState } from '../utils/task/framework.js'
import type { LocalAgentTaskState } from './LocalAgentTask/LocalAgentTask.js'

// 类型上只是给通用代理任务状态加了个固定标记，其余字段全部沿用
// Main session tasks use LocalAgentTaskState with agentType='main-session'
export type LocalMainSessionTaskState = LocalAgentTaskState & {
  agentType: 'main-session'
}

/**
 * Default agent definition for main session tasks when no agent is specified.
 */
// 没有指定代理时的占位定义：系统提示为空，因为主会话本身已有完整提示
const DEFAULT_MAIN_SESSION_AGENT: CustomAgentDefinition = {
  agentType: 'main-session',
  whenToUse: 'Main session query',
  source: 'userSettings',
  getSystemPrompt: () => '',
}

// 任务号用 s 前缀与代理任务的 a 前缀区分，一眼能看出这是后台主会话
/**
 * Generate a unique task ID for main session tasks.
 * Uses 's' prefix to distinguish from agent tasks ('a' prefix).
 */
// 字符表取三十六进制：把八个随机字节映射成短号，碰撞概率足够低
const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function generateMainSessionTaskId(): string {
  const bytes = randomBytes(8)
  let id = 's'
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % TASK_ID_ALPHABET.length]
  }
  return id
}

/**
 * Register a backgrounded main session task.
 * Called when the user backgrounds the current session query.
 *
 * @param description - Description of the task
 * @param setAppState - State setter function
 * @param mainThreadAgentDefinition - Optional agent definition if running with --agent
 * @param existingAbortController - Optional abort controller to reuse (for backgrounding an active query)
 * @returns Object with task ID and abort signal for stopping the background query
 */
// 注册入口：可以在已有查询上调用（把正在跑的查询直接转后台），也可以新建
export function registerMainSessionTask(
  description: string,
  setAppState: SetAppState,
  mainThreadAgentDefinition?: AgentDefinition,
  existingAbortController?: AbortController,
): { taskId: string; abortSignal: AbortSignal } {
// 任务号先于一切生成：后面的输出文件、清理注册、状态键都靠它
  const taskId = generateMainSessionTaskId()

// 输出必须指向本任务独立的记录文件，绝不能写主会话那一份
  // Link output to an isolated per-task transcript file (same layout as
  // sub-agents). Do NOT use getTranscriptPath() — that's the main session's
  // file, and writing there from a background query after /clear would corrupt
  // the post-clear conversation. The isolated path lets this task survive
  // /clear: the symlink re-link in clearConversation handles session ID changes.
  void initTaskOutputAsSymlink(
    taskId,
    getAgentTranscriptPath(asAgentId(taskId)),
  )

// 复用调用方的中断控制器：否则中止任务只会中止壳子，真实查询还在跑
  // Use the existing abort controller if provided (important for backgrounding an active query)
  // This ensures that aborting the task will abort the actual query
  const abortController = existingAbortController ?? createAbortController()

// 进程退出时把任务从状态表里摘掉，避免下次启动读到残留的运行中任务
  const unregisterCleanup = registerCleanup(async () => {
    // Clean up on process exit
    setAppState(prev => {
      const { [taskId]: removed, ...rest } = prev.tasks
      return { ...prev, tasks: rest }
    })
  })

  // Use provided agent definition or default
  const selectedAgent = mainThreadAgentDefinition ?? DEFAULT_MAIN_SESSION_AGENT

  // Create task state - already backgrounded since this is called when user backgrounds
// 状态里直接标成已后台：调用这个函数本身就是后台化的动作
  const taskState: LocalMainSessionTaskState = {
    ...createTaskStateBase(taskId, 'local_agent', description),
    type: 'local_agent',
    status: 'running',
    agentId: taskId,
    prompt: description,
    selectedAgent,
    agentType: 'main-session',
    abortController,
    unregisterCleanup,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true, // Already backgrounded
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
  }

// 注册前后各打一条调试日志，排查任务树里看不到任务时先看这两行
  logForDebugging(
    `[LocalMainSessionTask] Registering task ${taskId} with description: ${description}`,
  )
  registerTask(taskState, setAppState)

  // Verify task was registered by checking state
  setAppState(prev => {
    const hasTask = taskId in prev.tasks
    logForDebugging(
      `[LocalMainSessionTask] After registration, task ${taskId} exists in state: ${hasTask}`,
    )
    return prev
  })

  return { taskId, abortSignal: abortController.signal }
}

/**
 * Complete the main session task and send notification.
 * Called when the backgrounded query finishes.
 */
// 完成入口：先把状态改成终态，再决定要不要发通知，顺序不能反
export function completeMainSessionTask(
  taskId: string,
  success: boolean,
  setAppState: SetAppState,
): void {
  let wasBackgrounded = true
  let toolUseId: string | undefined

// 状态不是运行中就直接返回，防止重复完成把终态覆盖回去
  updateTaskState<LocalMainSessionTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task
    }

// 是否发通知取决于任务此刻还在后台：已前台化说明用户正看着，不需要提醒
    // Track if task was backgrounded (for notification decision)
    wasBackgrounded = task.isBackgrounded ?? true
    toolUseId = task.toolUseId

// 清理函数只该注销一次，拿到就调，避免进程退出时重复摘状态
    task.unregisterCleanup?.()

    return {
      ...task,
      status: success ? 'completed' : 'failed',
      endTime: Date.now(),
// 只保留最后一条消息：完整消息在记录文件里，状态表不必再存一份
      messages: task.messages?.length ? [task.messages.at(-1)!] : undefined,
    }
  })

// 输出文件回收放在通知之前：通知里要带路径，但内容已不再需要
  void evictTaskOutput(taskId)

  // Only send notification if task is still backgrounded (not foregrounded)
  // If foregrounded, user is watching it directly - no notification needed
// 前台化过的任务不发界面通知，但 SDK 消费方仍需要收到终止事件
  if (wasBackgrounded) {
    enqueueMainSessionNotification(
      taskId,
      'Background session',
      success ? 'completed' : 'failed',
      setAppState,
      toolUseId,
    )
  } else {
    // Foregrounded: no XML notification (TUI user is watching), but SDK
    // consumers still need to see the task_started bookend close.
    // Set notified so evictTerminalTask/generateTaskAttachments eviction
    // guards pass; the backgrounded path sets this inside
    // enqueueMainSessionNotification's check-and-set.
// 这里补置已通知标记是为了让驱逐与附件的守卫条件通过，不是重复通知
    updateTaskState(taskId, setAppState, task => ({ ...task, notified: true }))
    emitTaskTerminatedSdk(taskId, success ? 'completed' : 'failed', {
      toolUseId,
      summary: 'Background session',
    })
  }
}

/**
 * Enqueue a notification about the backgrounded session completing.
 */
// 通知是一段结构化文本：任务号、输出路径、状态、摘要四项齐全
function enqueueMainSessionNotification(
  taskId: string,
  description: string,
  status: 'completed' | 'failed',
  setAppState: SetAppState,
  toolUseId?: string,
): void {
// 先原子地检查并置位：并发的两次完成只会放行一次，重复通知在这里被挡住
  // Atomically check and set notified flag to prevent duplicate notifications.
  let shouldEnqueue = false
  updateTaskState(taskId, setAppState, task => {
    if (task.notified) {
      return task
    }
    shouldEnqueue = true
    return { ...task, notified: true }
  })

  if (!shouldEnqueue) {
    return
  }

// 摘要文案区分完成与失败，带上描述方便用户认出是哪个会话
  const summary =
    status === 'completed'
      ? `Background session "${description}" completed`
      : `Background session "${description}" failed`

// 工具调用号是可选的：后台化主动发起的任务没有对应的工具调用
  const toolUseIdLine = toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''

// 输出路径来自任务框架，与前面建立符号链接时用的是同一套规则
  const outputPath = getTaskOutputPath(taskId)
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`

  enqueuePendingNotification({ value: message, mode: 'task-notification' })
}

/**
 * Foreground a main session task - mark it as foregrounded so its output
 * appears in the main view. The background query keeps running.
 * Returns the task's accumulated messages, or undefined if task not found.
 */
// 前台化：把任务标成前台，并把上一个前台任务退回后台，保证同时只有一个
export function foregroundMainSessionTask(
  taskId: string,
  setAppState: SetAppState,
): Message[] | undefined {
  let taskMessages: Message[] | undefined

// 整段在一次状态更新里完成：读旧值、算恢复目标、写新值，中间不会被打断
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (!task || task.type !== 'local_agent') {
      return prev
    }

    taskMessages = (task as LocalMainSessionTaskState).messages

// 恢复前一个前台任务是必要的，否则两个任务都以为自己在前台，输出会混
    // Restore previous foregrounded task to background if it exists
    const prevId = prev.foregroundedTaskId
    const prevTask = prevId ? prev.tasks[prevId] : undefined
    const restorePrev =
      prevId && prevId !== taskId && prevTask?.type === 'local_agent'

    return {
      ...prev,
      foregroundedTaskId: taskId,
      tasks: {
        ...prev.tasks,
// 条件展开：只有确实存在另一个前台任务时才写这一项，避免写入空值
        ...(restorePrev && { [prevId]: { ...prevTask, isBackgrounded: true } }),
        [taskId]: { ...task, isBackgrounded: false },
      },
    }
  })

  return taskMessages
}

/**
 * Check if a task is a main session task (vs a regular agent task).
 */
// 类型守卫存在的原因是任务表里混着多种类型，不能只靠字段名判断
export function isMainSessionTask(
  task: unknown,
): task is LocalMainSessionTaskState {
  if (
    typeof task !== 'object' ||
    task === null ||
    !('type' in task) ||
    !('agentType' in task)
  ) {
    return false
  }
  return (
    task.type === 'local_agent' &&
    (task as LocalMainSessionTaskState).agentType === 'main-session'
  )
}

// 最近活动只留五条：界面上一屏能看到的量，多了反而看不出重点
// Max recent activities to keep for display
const MAX_RECENT_ACTIVITIES = 5

type ToolActivity = {
  toolName: string
  input: Record<string, unknown>
}

// 新建后台会话：拿当前消息另起一条独立查询，前台查询完全不受影响
/**
 * Start a fresh background session with the given messages.
 *
 * Spawns an independent query() call with the current messages and registers it
 * as a background task. The caller's foreground query continues running normally.
 */
export function startBackgroundSession({
  messages,
  queryParams,
  description,
  setAppState,
  agentDefinition,
}: {
  messages: Message[]
  queryParams: Omit<QueryParams, 'messages'>
  description: string
  setAppState: SetAppState
  agentDefinition?: AgentDefinition
}): string {
  const { taskId, abortSignal } = registerMainSessionTask(
    description,
    setAppState,
    agentDefinition,
  )

// 先把已有对话写进记录文件，这样任务一出现就能看到上下文
  // Persist the pre-backgrounding conversation to the task's isolated
  // transcript so TaskOutput shows context immediately. Subsequent messages
  // are written incrementally below.
  void recordSidechainTranscript(messages, taskId).catch(err =>
    logForDebugging(`bg-session initial transcript write failed: ${err}`),
  )

// 套一层代理上下文，让技能调用归属到这个任务而不是空身份
  // Wrap in agent context so skill invocations scope to this task's agentId
  // (not null). This lets clearInvokedSkills(preservedAgentIds) selectively
  // preserve this task's skills across /clear. AsyncLocalStorage isolates
  // concurrent async chains — this wrapper doesn't affect the foreground.
  const agentContext: SubagentContext = {
    agentId: taskId,
    agentType: 'subagent',
    subagentName: 'main-session',
    isBuiltIn: true,
  }

// 整段是即发即忘的异步流程：函数立刻返回任务号，进度通过状态更新回报
  void runWithAgentContext(agentContext, async () => {
    try {
      const bgMessages: Message[] = [...messages]
      const recentActivities: ToolActivity[] = []
      let toolCount = 0
      let tokenCount = 0
      let lastRecordedUuid: UUID | null = messages.at(-1)?.uuid ?? null

// 每收到一条消息就追加进本地数组，同时把状态表里的引用指向同一个数组
      for await (const event of query({
        messages: bgMessages,
        ...queryParams,
      })) {
// 中途被中止时走不到完成入口，所以这里要自己补终止事件
        if (abortSignal.aborted) {
          // Aborted mid-stream — completeMainSessionTask won't be reached.
          // chat:killAgents path already marked notified + emitted; stopTask path did not.
          let alreadyNotified = false
          updateTaskState(taskId, setAppState, task => {
            alreadyNotified = task.notified === true
            return alreadyNotified ? task : { ...task, notified: true }
          })
          if (!alreadyNotified) {
            emitTaskTerminatedSdk(taskId, 'stopped', {
              summary: description,
            })
          }
          return
        }

// 只把三类真实对话消息入账，进度与提示变更等其他事件不进历史
        if (
          event.type !== 'user' &&
          event.type !== 'assistant' &&
          event.type !== 'system'
        ) {
          continue
        }

        bgMessages.push(event)

        // Per-message write (matches runAgent.ts pattern) — gives live
        // TaskOutput progress and keeps the transcript file current even if
        // /clear re-links the symlink mid-run.
// 逐条写记录文件：既能让界面看到实时进度，也能在中途重连后接上
        void recordSidechainTranscript([event], taskId, lastRecordedUuid).catch(
          err => logForDebugging(`bg-session transcript write failed: ${err}`),
        )
        lastRecordedUuid = event.uuid

// 助手消息里分别统计文本与工具调用：前者估令牌，后者算工具次数
        if (event.type === 'assistant') {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              tokenCount += roughTokenCountEstimation(block.text)
            } else if (block.type === 'tool_use') {
              toolCount++
              const activity: ToolActivity = {
                toolName: block.name,
                input: block.input as Record<string, unknown>,
              }
              recentActivities.push(activity)
// 活动列表按队列维护，超过上限从头部丢，保留最近发生的几条
              if (recentActivities.length > MAX_RECENT_ACTIVITIES) {
                recentActivities.shift()
              }
            }
          }
        }

// 状态更新前先比一遍：计数与消息数组都没变就不写，避免每帧都触发重渲染
        setAppState(prev => {
          const task = prev.tasks[taskId]
          if (!task || task.type !== 'local_agent') return prev
          const prevProgress = task.progress
          if (
            prevProgress?.tokenCount === tokenCount &&
            prevProgress.toolUseCount === toolCount &&
            task.messages === bgMessages
          ) {
            return prev
          }
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [taskId]: {
                ...task,
// 工具次数没变时复用旧的活动数组，保持引用稳定，减少下游重算
                progress: {
                  tokenCount,
                  toolUseCount: toolCount,
                  recentActivities:
                    prevProgress?.toolUseCount === toolCount
                      ? prevProgress.recentActivities
                      : [...recentActivities],
                },
                messages: bgMessages,
              },
            },
          }
        })
      }

// 正常结束走成功路径，异常统一记日志后走失败路径，两条都落到完成入口
      completeMainSessionTask(taskId, true, setAppState)
    } catch (error) {
      logError(error)
      completeMainSessionTask(taskId, false, setAppState)
    }
  })

  return taskId
}
