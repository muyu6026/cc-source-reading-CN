import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  executeTaskCreatedHooks,
  getTaskCreatedHookMessage,
} from '../../utils/hooks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  createTask,
  deleteTask,
  getTaskListId,
  isTodoV2Enabled,
} from '../../utils/tasks.js'
import { getAgentName, getTeamName } from '../../utils/teammate.js'
import { TASK_CREATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
// TaskCreate 的骨架与其它工具完全一致：lazySchema 包 zod 输入/输出 schema，buildTool 组装工具对象。四个字段里 subject 必填，description 承载详细需求，activeForm 控制加载动画文案，metadata 是自由附属区。

const inputSchema = lazySchema(() =>
  z.strictObject({
    subject: z.string().describe('A brief title for the task'),
    description: z.string().describe('What needs to be done'),
// subject 是给模型和人看的短标题；description 才是「要做什么」的正文——批注工作流里前者写「批注 X 文件」，后者写验收判据。
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
// activeForm 用现在进行时（如「Running tests」），省略时加载动画直接显示 subject。
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arbitrary metadata to attach to the task'),
  }),
)
// metadata 不设 schema 约束——任务系统要挂 owner/blocks/blockedBy 等结构化字段，也允许调用方塞任意键。
type InputSchema = ReturnType<typeof inputSchema>

// strictObject：多传任何未声明字段直接报错，防止模型把任务系统当杂物袋。
const outputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
    }),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// 输出只回 id + subject 两样：创建成功后模型真正需要的只有「任务号」，其余字段用 TaskGet 再取。
export type Output = z.infer<OutputSchema>

export const TaskCreateTool = buildTool({
  name: TASK_CREATE_TOOL_NAME,
  searchHint: 'create a task in the task list',
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
    return 'TaskCreate'
  },
  shouldDefer: true,
  isEnabled() {
    return isTodoV2Enabled()
// shouldDefer: true —— 创建任务不阻塞主循环，工具结果可以延迟返回。
  },
  isConcurrencySafe() {
    return true
// isEnabled 挂在 isTodoV2Enabled() 上：Todo v2 未开启时整个任务四件套（Create/Get/List/Update）一起隐身，老会话不受影响。
  },
  toAutoClassifierInput(input) {
    return input.subject
// isConcurrencySafe: true —— 任务写操作本身在存储层串行化，并发调用不会踩状态。
  },
  renderToolUseMessage() {
    return null
// toAutoClassifierInput 只喂 subject：自动分类器靠标题判断这次调用危不危险，description 太长反而稀释信号。
  },
  async call({ subject, description, activeForm, metadata }, context) {
    const taskId = await createTask(getTaskListId(), {
// renderToolUseMessage 返回 null —— 工具调用气泡不显示，只在内联任务面板里可见，避免刷屏。
      subject,
      description,
      activeForm,
      status: 'pending',
      owner: undefined,
      blocks: [],
      blockedBy: [],
      metadata,
    })

    const blockingErrors: string[] = []
// createTask 落盘后才走 hook：先写入存储，再让外部钩子有机会拦截。
    const generator = executeTaskCreatedHooks(
      taskId,
      subject,
      description,
      getAgentName(),
// status 固定 'pending'：TaskCreate 从不直接建「进行中」的任务，状态流转归 TaskUpdate 管。
      getTeamName(),
      undefined,
      context?.abortController?.signal,
      undefined,
      context,
    )
    for await (const result of generator) {
      if (result.blockingError) {
// executeTaskCreatedHooks 是生成器：TaskCreated 钩子可以注册多个，逐个 yield 结果，任一带 blockingError 即整体判负。
        blockingErrors.push(getTaskCreatedHookMessage(result.blockingError))
      }
    }

    if (blockingErrors.length > 0) {
// blockingError 累加成字符串数组——多个钩子同时拦截时，错误信息合并成一条抛出，模型能一次看到全部理由。
      await deleteTask(getTaskListId(), taskId)
      throw new Error(blockingErrors.join('\n'))
    }

    // Auto-expand task list when creating tasks
// 钩子拦截即回滚：刚建的 taskId 立刻 deleteTask 删掉，不在存储里留半条任务。这是「先写后验」模式的标准补偿动作。
    context.setAppState(prev => {
      if (prev.expandedView === 'tasks') return prev
      return { ...prev, expandedView: 'tasks' as const }
    })

    return {
// 建任务后自动展开任务面板：用户视角里「任务出现了」，不用手动切视图。
      data: {
        task: {
          id: taskId,
          subject,
        },
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output
// 返回值刻意最小化——只回 id 和 subject，与 outputSchema 对齐。
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${task.id} created successfully: ${task.subject}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
