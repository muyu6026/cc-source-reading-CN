import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getTask,
  getTaskListId,
  isTodoV2Enabled,
  TaskStatusSchema,
} from '../../utils/tasks.js'
import { TASK_GET_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
// TaskGet 是任务系统的「读单条」入口：输入只有 taskId，输出把任务的完整字段摊开。

const inputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().describe('The ID of the task to retrieve'),
// strictObject 只收一个 taskId——刻意不做「按 subject 模糊查」，那应该是 TaskList 的职责。
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task: z
      .object({
        id: z.string(),
        subject: z.string(),
        description: z.string(),
        status: TaskStatusSchema(),
        blocks: z.array(z.string()),
        blockedBy: z.array(z.string()),
      })
      .nullable(),
// task 可空：任务不存在时返回 task: null 而不是抛错，让模型自己决定下一步（重建 or 报错）。
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
// Output 与 outputSchema 严格同构，z.infer 推导，避免两处定义漂移。

export const TaskGetTool = buildTool({
  name: TASK_GET_TOOL_NAME,
  searchHint: 'retrieve a task by ID',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskGet'
  },
  shouldDefer: true,
// shouldDefer: true —— 读操作更没理由阻塞主循环。
  isEnabled() {
    return isTodoV2Enabled()
  },
// 同样挂在 isTodoV2Enabled() 上，与 TaskCreate 同开同关。
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
// isReadOnly: true —— 纯读，权限系统直接放行，不进分类器。
    return true
  },
  toAutoClassifierInput(input) {
    return input.taskId
  },
// 分类器输入是 taskId：一次「看任务」调用没有任何副作用可判。
  renderToolUseMessage() {
    return null
  },
  async call({ taskId }) {
    const taskListId = getTaskListId()

    const task = await getTask(taskListId, taskId)
// getTask(taskListId, taskId)：taskListId 从会话级存储取，模型感知不到「列表」这个概念。

    if (!task) {
      return {
        data: {
          task: null,
        },
      }
// 找不到任务走 null 分支——注意这里没有 is_error，tool_result 正常返回，由文案层说明情况。
    }

    return {
      data: {
        task: {
          id: task.id,
          subject: task.subject,
          description: task.description,
          status: task.status,
          blocks: task.blocks,
          blockedBy: task.blockedBy,
        },
      },
    }
// 命中时六个字段全量返回：description 是重头，status/blocks/blockedBy 供依赖判断。
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output
    if (!task) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'Task not found',
      }
// 'Task not found' 文案层翻 null：给模型的是一句人话，不是空 content。
    }

    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ]
// 结果渲染成三行固定格式：标题 / 状态 / 描述。

    if (task.blockedBy.length > 0) {
      lines.push(`Blocked by: ${task.blockedBy.map(id => `#${id}`).join(', ')}`)
    }
    if (task.blocks.length > 0) {
      lines.push(`Blocks: ${task.blocks.map(id => `#${id}`).join(', ')}`)
    }
// Blocked by / Blocks 两行只在非空时追加——空依赖不占行，保持输出紧凑。

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
