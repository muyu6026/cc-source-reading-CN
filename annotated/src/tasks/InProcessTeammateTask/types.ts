import type { TaskStateBase } from '../../Task.js'
import type { AgentToolResult } from '../../tools/AgentTool/agentToolUtils.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type { Message } from '../../types/message.js'
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js'
import type { AgentProgress } from '../LocalAgentTask/LocalAgentTask.js'

// 队友身份存进任务状态：形状与运行时的 TeammateContext 一致，但这里是纯数据、写进 AppState 做持久化
/**
 * Teammate identity stored in task state.
 * Same shape as TeammateContext (runtime) but stored as plain data.
 * TeammateContext is for AsyncLocalStorage; this is for AppState persistence.
 */
// 队友身份三要素：agentId（如 researcher@my-team）、teamName、以及是否要求计划模式
export type TeammateIdentity = {
  agentId: string // e.g., "researcher@my-team"
  agentName: string // e.g., "researcher"
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId: string // Leader's session ID
}

// 进程内队友任务的完整状态：在通用 TaskStateBase 上叠加身份、执行、UI、生命周期四类字段
export type InProcessTeammateTaskState = TaskStateBase & {
  type: 'in_process_teammate'

  // Identity as sub-object (matches TeammateContext shape for consistency)
  // Stored as plain data in AppState, NOT a reference to AsyncLocalStorage
  identity: TeammateIdentity

  // Execution
  prompt: string
  // Optional model override for this teammate
  model?: string
  // Optional: Only set if teammate uses a specific agent definition
  // Many teammates run as general-purpose agents without a predefined definition
  selectedAgent?: AgentDefinition
// 两个运行时专用的中止控制器：一个杀整个队友，一个只中断当前轮；都不序列化到磁盘
  abortController?: AbortController // Runtime only, not serialized to disk - kills WHOLE teammate
  currentWorkAbortController?: AbortController // Runtime only - aborts current turn without killing teammate
  unregisterCleanup?: () => void // Runtime only

  // Plan mode approval tracking (planModeRequired is in identity)
  awaitingPlanApproval: boolean

  // Permission mode for this teammate (cycled independently via Shift+Tab when viewing)
  permissionMode: PermissionMode

  // State
  error?: string
  result?: AgentToolResult // Reuse existing type since teammates run via runAgent()
  progress?: AgentProgress

// 放大视图用的对话历史单独存：邮箱消息走另一条路（teamContext.inProcessMailboxes），不混在这里
  // Conversation history for zoomed view (NOT mailbox messages)
  // Mailbox messages are stored separately in teamContext.inProcessMailboxes
  messages?: Message[]

  // Tool use IDs currently being executed (for animation in transcript view)
// 查看队友对话时要投递的用户消息队列，是一直在累积的字段
  inProgressToolUseIDs?: Set<string>

  // Queue of user messages to deliver when viewing teammate transcript
  pendingUserMessages: string[]

// UI 用的随机旋转动词：跨重渲染保持稳定，多个组件共享同一份
  // UI: random spinner verbs (stable across re-renders, shared between components)
  spinnerVerb?: string
  pastTenseVerb?: string

  // Lifecycle
// 生命周期两个布尔：空闲标志和关机请求，由收尾路径负责翻转
  isIdle: boolean
  shutdownRequested: boolean

  // Callbacks to notify when teammate becomes idle (runtime only)
  // Used by leader to efficiently wait without polling
  onIdleCallbacks?: Array<() => void>

  // Progress tracking (for computing deltas in notifications)
  lastReportedToolCount: number
  lastReportedTokenCount: number
}

// 类型守卫：靠 type === in_process_teammate 收窄，新增字段时不会误判
export function isInProcessTeammateTask(
  task: unknown,
): task is InProcessTeammateTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'in_process_teammate'
  )
}

// 消息数组的内存成本：BQ 分析显示每个代理持有一份完整副本会吃到约 20MB RSS，所以下面要封顶
/**
 * Cap on the number of messages kept in task.messages (the AppState UI mirror).
 *
 * task.messages exists purely for the zoomed transcript dialog, which only
 * needs recent context. The full conversation lives in the local allMessages
 * array (inProcessRunner) and on disk at the agent transcript path.
 *
 * BQ analysis (round 9, 2026-03-20) showed ~20MB RSS per agent at 500+ turn
 * sessions and ~125MB per concurrent agent in swarm bursts. Whale session
 * 9a990de8 launched 292 agents in 2 minutes and reached 36.8GB. The dominant
 * cost is this array holding a second full copy of every message.
 */
// UI 镜像里最多留 50 条：放大视图只看近期上下文，完整对话存在别处
export const TEAMMATE_MESSAGES_UI_CAP = 50

/**
 * Append an item to a message array, capping the result at
 * TEAMMATE_MESSAGES_UI_CAP entries by dropping the oldest. Always returns
 * a new array (AppState immutability).
 */
// 追加并封顶的纯函数：满了就丢最老的，永远返回新数组以保持 AppState 不可变
export function appendCappedMessage<T>(
  prev: readonly T[] | undefined,
  item: T,
): T[] {
  if (prev === undefined || prev.length === 0) {
    return [item]
  }
  if (prev.length >= TEAMMATE_MESSAGES_UI_CAP) {
    const next = prev.slice(-(TEAMMATE_MESSAGES_UI_CAP - 1))
    next.push(item)
    return next
  }
  return [...prev, item]
}
