import { z } from 'zod/v4'
import type { TaskStateBase } from '../../Task.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { stopTask } from '../../tasks/stopTask.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { DESCRIPTION, TASK_STOP_TOOL_NAME } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'
// 注意 DESCRIPTION 与 TASK_STOP_TOOL_NAME 都从 prompt.ts 导出——与另外三件套（constants.ts 管名字）的布局不同，这里是历史遗留的分工。

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z
      .string()
      .optional()
      .describe('The ID of the background task to stop'),
    // shell_id is accepted for backward compatibility with the deprecated KillShell tool
// shell_id 是已废弃 KillShell 的兼容参数：老 transcript 回放和 SDK 用户还在传它。
    shell_id: z.string().optional().describe('Deprecated: use task_id instead'),
  }),
// 两个参数都可选、语义等价——「至少给一个」的校验放在 validateInput 里做，schema 层不设 required。
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Status message about the operation'),
    task_id: z.string().describe('The ID of the task that was stopped'),
    task_type: z.string().describe('The type of the task that was stopped'),
    // Optional: tool outputs are persisted to transcripts and replayed on --resume
    // without re-validation, so sessions from before this field was added lack it.
    command: z
      .string()
      .optional()
      .describe('The command or description of the stopped task'),
  }),
)
// 输出四字段：message 给人看，task_id/task_type 给程序用，command 记录停掉的是什么。
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskStopTool = buildTool({
  name: TASK_STOP_TOOL_NAME,
  searchHint: 'kill a running background task',
  // KillShell is the deprecated name - kept as alias for backward compatibility
  // with existing transcripts and SDK users
  aliases: ['KillShell'],
// aliases: ['KillShell'] —— 工具曾用名。老会话的 transcript 里存的是 KillShell，回放时按别名匹配才不会断档。
  maxResultSizeChars: 100_000,
  userFacingName: () => (process.env.USER_TYPE === 'ant' ? '' : 'Stop Task'),
// userFacingName 对 ant 内部用户返回空串——同一把工具，对外显示 'Stop Task'。
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  shouldDefer: true,
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.task_id ?? input.shell_id ?? ''
  },
// 分类器输入兜底链 task_id ?? shell_id ?? ''：兼容期两条入口都要过分类器。
  async validateInput({ task_id, shell_id }, { getAppState }) {
    // Support both task_id and shell_id (deprecated KillShell compat)
    const id = task_id ?? shell_id
    if (!id) {
      return {
        result: false,
        message: 'Missing required parameter: task_id',
        errorCode: 1,
      }
// 一个 ID 都没给：errorCode 1（参数缺失）。
    }

    const appState = getAppState()
    const task = appState.tasks?.[id] as TaskStateBase | undefined

    if (!task) {
      return {
        result: false,
        message: `No task found with ID: ${id}`,
        errorCode: 1,
      }
// ID 不存在也是 errorCode 1——validateInput 只查 AppState 内存表，不碰存储。
    }

    if (task.status !== 'running') {
      return {
        result: false,
        message: `Task ${id} is not running (status: ${task.status})`,
        errorCode: 3,
      }
// 存在但不在 running：errorCode 3。错误码把「不存在」和「状态不对」分开，调用方能区分处理。
    }

    return { result: true }
// 三项校验全过才放行——这个工具杀掉的是真实后台进程，宁可错杀验证不可错放。
  },
  async description() {
    return `Stop a running background task by ID`
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
// tool_result 用 jsonStringify 整体序列化 output，不挑字段——resume 回放时靠这个还原完整结构。
  },
  renderToolUseMessage,
  renderToolResultMessage,
// 两个 render 函数直接从 UI.tsx 导入，工具文件不碰渲染细节。
  async call(
    { task_id, shell_id },
    { getAppState, setAppState, abortController },
  ) {
    // Support both task_id and shell_id (deprecated KillShell compat)
    const id = task_id ?? shell_id
    if (!id) {
      throw new Error('Missing required parameter: task_id')
    }

    const result = await stopTask(id, {
      getAppState,
      setAppState,
    })
// stopTask 是真正干活的（在 tasks/stopTask.ts）： abortController 终止 + 任务表状态更新都在那里。

    return {
      data: {
        message: `Successfully stopped task: ${result.taskId} (${result.command})`,
        task_id: result.taskId,
        task_type: result.taskType,
        command: result.command,
      },
    }
// 返回四件套与 outputSchema 对齐；message 里带上 command，用户能看到「停掉的到底是哪条命令」。
  },
} satisfies ToolDef<InputSchema, Output>)
