import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  TaskStatusSchema,
} from '../../utils/tasks.js'
import { TASK_LIST_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const inputSchema = lazySchema(() => z.strictObject({}))
// 空 strictObject：列任务不需要任何参数，全部任务一次给全。
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        status: TaskStatusSchema(),
        owner: z.string().optional(),
        blockedBy: z.array(z.string()),
      }),
    ),
  }),
)
// 输出是摘要形态：没有 description——那是 TaskGet 的活，列表只负责「有什么、谁在做、被什么堵」。
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
// Output 与 outputSchema 严格同构。

export const TaskListTool = buildTool({
  name: TASK_LIST_TOOL_NAME,
  searchHint: 'list all tasks',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskList'
  },
  shouldDefer: true,
// shouldDefer: true。
  isEnabled() {
    return isTodoV2Enabled()
  },
// isTodoV2Enabled() 门控，四件套统一开关。
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
// isReadOnly: true —— 纯读。
  renderToolUseMessage() {
    return null
// renderToolUseMessage 返回 null，同样只在任务面板可见。
  },
  async call() {
    const taskListId = getTaskListId()

    const allTasks = (await listTasks(taskListId)).filter(
      t => !t.metadata?._internal,
    )
// metadata._internal 过滤：teammate 注册的后台任务等系统内部条目不混进用户可见列表。

    // Build a set of resolved task IDs for filtering
    const resolvedTaskIds = new Set(
      allTasks.filter(t => t.status === 'completed').map(t => t.id),
    )
// resolvedTaskIds 预计算 completed 集合——O(n) 建索引，避免下面每条任务再扫一遍全表。

    const tasks = allTasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      blockedBy: task.blockedBy.filter(id => !resolvedTaskIds.has(id)),
    }))
// blockedBy 过滤掉已完成项：「被已完成任务堵住」不是堵，显示出来只会误导模型去催一个早已完事的任务。

    return {
      data: {
        tasks,
      },
    }
// 返回加工后的 tasks 数组。
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { tasks } = content as Output
    if (tasks.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No tasks found',
      }
// 空列表文案 'No tasks found'——不是错误，正常 tool_result。
    }

    const lines = tasks.map(task => {
      const owner = task.owner ? ` (${task.owner})` : ''
      const blocked =
        task.blockedBy.length > 0
          ? ` [blocked by ${task.blockedBy.map(id => `#${id}`).join(', ')}]`
          : ''
      return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`
    })
// 单行紧凑格式：`#id [status] subject (owner) [blocked by ...]`，owner 和 blocked 按需追加。

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
