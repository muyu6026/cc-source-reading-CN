import { randomBytes } from 'crypto'
import type { AppState } from './state/AppState.js'
import type { AgentId } from './types/ids.js'
import { getTaskOutputPath } from './utils/task/diskOutput.js'

// 七种任务类型：四种跑在本机，远程代理与 MCP 监控另算两类，最后一个是记忆整理
export type TaskType =
  | 'local_bash'
  | 'local_agent'
  | 'remote_agent'
  | 'in_process_teammate'
  | 'local_workflow'
  | 'monitor_mcp'
  | 'dream'

// 五个状态里三个是终态：判断「还能不能继续」时只认这三个
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'

// 这个判断被三处引用：往死掉的队友里塞消息、从状态表淘汰已完成任务、孤儿清理
/**
 * True when a task is in a terminal state and will not transition further.
 * Used to guard against injecting messages into dead teammates, evicting
 * finished tasks from AppState, and orphan-cleanup paths.
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

// 句柄是注册时拿到的最小凭据：任务 id 加一个可选的清理函数
export type TaskHandle = {
  taskId: string
  cleanup?: () => void
}

export type SetAppState = (f: (prev: AppState) => AppState) => void

// 上下文三件套：中止信号、读状态、写状态。三者都由调用方注入，任务本身不持有全局引用
export type TaskContext = {
  abortController: AbortController
  getAppState: () => AppState
  setAppState: SetAppState
}

// Base fields shared by all task states
// 基类字段覆盖三件事：怎么显示、什么时候结束、输出写到哪
export type TaskStateBase = {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
  toolUseId?: string
  startTime: number
  endTime?: number
  totalPausedMs?: number
// 输出文件与偏移是流式追加的锚点：重启后靠它们接着读，而不是从头再来
  outputFile: string
  outputOffset: number
  notified: boolean
}

// 本机命令的启动参数：kind 只影响界面怎么画，不改变执行
export type LocalShellSpawnInput = {
  command: string
  description: string
  timeout?: number
  toolUseId?: string
  agentId?: AgentId
  /** UI display variant: description-as-label, dialog title, status bar pill. */
  kind?: 'bash' | 'monitor'
}

// What getTaskByType dispatches for: kill. spawn/render were never
// called polymorphically (removed in #22546). All six kill implementations
// use only setAppState — getAppState/abortController were dead weight.
// 任务接口只剩中止：派生与渲染曾经也是多态的，后来证明只有中止真需要按类型分派
export type Task = {
  name: string
  type: TaskType
  kill(taskId: string, setAppState: SetAppState): Promise<void>
}

// Task ID prefixes
// 前缀表让人一眼看出任务类型：日志与输出路径里都带着它
const TASK_ID_PREFIXES: Record<string, string> = {
  local_bash: 'b', // Keep as 'b' for backward compatibility
  local_agent: 'a',
  remote_agent: 'r',
  in_process_teammate: 't',
  local_workflow: 'w',
  monitor_mcp: 'm',
  dream: 'd',
}

// Get task ID prefix
function getTaskIdPrefix(type: TaskType): string {
// 未知类型给一个兜底前缀：新增类型忘了登记时至少 id 还能生成
  return TASK_ID_PREFIXES[type] ?? 'x'
}

// Case-insensitive-safe alphabet (digits + lowercase) for task IDs.
// 36^8 ≈ 2.8 trillion combinations, sufficient to resist brute-force symlink attacks.
// 字符集只用数字与小写：任务 id 会进文件路径，大小写不敏感的文件系统上混用会导致路径不一致
const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

// 八字节熵加三十六进制：约二点八万亿种组合，足以抵抗针对符号链接的暴力猜测
export function generateTaskId(type: TaskType): string {
  const prefix = getTaskIdPrefix(type)
  const bytes = randomBytes(8)
  let id = prefix
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % TASK_ID_ALPHABET.length]
  }
  return id
}

// 新建任务状态一律从待处理起：状态推进由各任务实现负责，基类不预设
export function createTaskStateBase(
  id: string,
  type: TaskType,
  description: string,
  toolUseId?: string,
): TaskStateBase {
  return {
    id,
    type,
    status: 'pending',
    description,
    toolUseId,
    startTime: Date.now(),
    outputFile: getTaskOutputPath(id),
    outputOffset: 0,
    notified: false,
  }
}
