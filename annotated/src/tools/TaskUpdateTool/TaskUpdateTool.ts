import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import {
  executeTaskCompletedHooks,
  getTaskCompletedHookMessage,
} from '../../utils/hooks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  blockTask,
  deleteTask,
  getTask,
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  type TaskStatus,
  TaskStatusSchema,
  updateTask,
} from '../../utils/tasks.js'
import {
  getAgentId,
  getAgentName,
  getTeammateColor,
  getTeamName,
} from '../../utils/teammate.js'
import { writeToMailbox } from '../../utils/teammateMailbox.js'
import { VERIFICATION_AGENT_TYPE } from '../AgentTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() => {
// inputSchema 用 lazySchema 包着——schema 构造延后到首次访问，模块加载零成本（TaskStatusSchema 依赖任务子系统，提前构造会拖慢启动）。
  // Extended status schema that includes 'deleted' as a special action
  const TaskUpdateStatusSchema = TaskStatusSchema().or(z.literal('deleted'))
// status schema 用 or 扩展出 'deleted' 字面量——删除不是状态而是动作，提前返回、删文件，所以不能进 TaskStatus 本体。

  return z.strictObject({
    taskId: z.string().describe('The ID of the task to update'),
    subject: z.string().optional().describe('New subject for the task'),
    description: z.string().optional().describe('New description for the task'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    status: TaskUpdateStatusSchema.optional().describe(
      'New status for the task',
    ),
    addBlocks: z
      .array(z.string())
      .optional()
      .describe('Task IDs that this task blocks'),
    addBlockedBy: z
      .array(z.string())
      .optional()
      .describe('Task IDs that block this task'),
    owner: z.string().optional().describe('New owner for the task'),
    metadata: z
// metadata 是字典合并语义：null 值=删键，其余=设值——「清空某个元数据」与「设成空串」由此区分。
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Metadata keys to merge into the task. Set a key to null to delete it.',
      ),
  })
})
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
// outputSchema 里 statusChange 记旧值→新值，verificationNudgeNeeded 是给 tool_result 层用的信号（@internal，不进公开 SDK）。
  z.object({
    success: z.boolean(),
    taskId: z.string(),
    updatedFields: z.array(z.string()),
    error: z.string().optional(),
    statusChange: z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .optional(),
    verificationNudgeNeeded: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// buildTool 主定义开始。
export const TaskUpdateTool = buildTool({
  name: TASK_UPDATE_TOOL_NAME,
  searchHint: 'update a task',
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
    return 'TaskUpdate'
  },
  shouldDefer: true,
// shouldDefer: true——任务更新按需加载，不占常驻工具位。
  isEnabled() {
// isEnabled 跟着 isTodoV2Enabled() 走：V1 会话（TodoWrite 时代）整个工具不存在，V2 才注册。
    return isTodoV2Enabled()
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
// toAutoClassifierInput 拼 taskId + status + subject——权限分类器要判断的是「改哪个任务、改成什么」。
    const parts = [input.taskId]
    if (input.status) parts.push(input.status)
    if (input.subject) parts.push(input.subject)
    return parts.join(' ')
  },
  renderToolUseMessage() {
// renderToolUseMessage 返回 null——工具调用过程不值得占一行 UI（任务面板自己会刷新）。
    return null
  },
  async call(
    {
      taskId,
      subject,
      description,
      activeForm,
      status,
      owner,
      addBlocks,
      addBlockedBy,
      metadata,
    },
    context,
  ) {
    const taskListId = getTaskListId()
// call() 第一件事：把 expandedView 强制切到 'tasks'——模型改任务时用户正该看着任务面板，这是「动作即视角」。

    // Auto-expand task list when updating tasks
    context.setAppState(prev => {
      if (prev.expandedView === 'tasks') return prev
      return { ...prev, expandedView: 'tasks' as const }
    })

    // Check if task exists
    const existingTask = await getTask(taskListId, taskId)
// 任务不存在就失败返回（不是抛错）——任务列表可能已被清理，这是良性状况，见下面 mapToolResult 的处理。
    if (!existingTask) {
      return {
        data: {
          success: false,
          taskId,
          updatedFields: [],
          error: 'Task not found',
        },
      }
    }

    const updatedFields: string[] = []

    // Update basic fields if provided and different from current value
    const updates: {
      subject?: string
      description?: string
      activeForm?: string
      status?: TaskStatus
      owner?: string
      metadata?: Record<string, unknown>
    } = {}
    if (subject !== undefined && subject !== existingTask.subject) {
// 字段 diff 更新：每个字段先与现值比较，不同才进 updates 并记名——updatedFields 因此是「真变了什么」的精确清单。
      updates.subject = subject
      updatedFields.push('subject')
    }
    if (description !== undefined && description !== existingTask.description) {
      updates.description = description
      updatedFields.push('description')
    }
    if (activeForm !== undefined && activeForm !== existingTask.activeForm) {
      updates.activeForm = activeForm
      updatedFields.push('activeForm')
    }
    if (owner !== undefined && owner !== existingTask.owner) {
      updates.owner = owner
      updatedFields.push('owner')
    }
    // Auto-set owner when a teammate marks a task as in_progress without
    // explicitly providing an owner. This ensures the task list can match
    // todo items to teammates for showing activity status.
    if (
// 队友认领的半自动机制：swarm 模式下有人把任务标 in_progress 但没带 owner，自动填上当前 agent 名——否则任务面板匹配不到活跃度。
      isAgentSwarmsEnabled() &&
      status === 'in_progress' &&
      owner === undefined &&
      !existingTask.owner
    ) {
      const agentName = getAgentName()
      if (agentName) {
        updates.owner = agentName
        updatedFields.push('owner')
      }
    }
    if (metadata !== undefined) {
// metadata 合并在本地做：先铺旧值再逐键覆写/删除，最后整体写回——避免多次落盘。
      const merged = { ...(existingTask.metadata ?? {}) }
      for (const [key, value] of Object.entries(metadata)) {
        if (value === null) {
          delete merged[key]
        } else {
          merged[key] = value
        }
      }
      updates.metadata = merged
      updatedFields.push('metadata')
    }
    if (status !== undefined) {
      // Handle deletion - delete the task file and return early
      if (status === 'deleted') {
// deleted 动作提前返回：deleteTask 删文件，updatedFields 记 ['deleted']，statusChange 走 from→'deleted'。
        const deleted = await deleteTask(taskListId, taskId)
        return {
          data: {
            success: deleted,
            taskId,
            updatedFields: deleted ? ['deleted'] : [],
            error: deleted ? undefined : 'Failed to delete task',
            statusChange: deleted
              ? { from: existingTask.status, to: 'deleted' }
              : undefined,
          },
        }
      }

      // For regular status updates, validate and apply if different
      if (status !== existingTask.status) {
        // Run TaskCompleted hooks when marking a task as completed
        if (status === 'completed') {
// 标 completed 前先跑 TaskCompleted hooks——blockingError 出现即整体失败返回，钩子拦得住这次完成。
          const blockingErrors: string[] = []

          const generator = executeTaskCompletedHooks(
            taskId,
            existingTask.subject,
            existingTask.description,
            getAgentName(),
            getTeamName(),
            undefined,
            context?.abortController?.signal,
            undefined,
            context,
          )

          for await (const result of generator) {
// generator 逐个消费 hook 结果，只收 blockingError——非阻塞 hook 的提示不进 tool_result。
            if (result.blockingError) {
              blockingErrors.push(
                getTaskCompletedHookMessage(result.blockingError),
              )
            }
          }

          if (blockingErrors.length > 0) {
            return {
              data: {
                success: false,
                taskId,
                updatedFields: [],
                error: blockingErrors.join('\n'),
              },
            }
          }
        }

        updates.status = status
        updatedFields.push('status')
      }
    }

    if (Object.keys(updates).length > 0) {
// updates 非空才落盘 updateTask——纯 blocks 增补也走得到这里（见下）。
      await updateTask(taskListId, taskId, updates)
    }

    // Notify new owner via mailbox when ownership changes
    if (updates.owner && isAgentSwarmsEnabled()) {
// owner 变更即通知：往新 owner 的 mailbox 写一条 task_assignment（含 taskId/subject/description/assignedBy）——指派不是改个字段就算，对方要收得到。
      const senderName = getAgentName() || 'team-lead'
      const senderColor = getTeammateColor()
      const assignmentMessage = JSON.stringify({
        type: 'task_assignment',
        taskId,
        subject: existingTask.subject,
        description: existingTask.description,
        assignedBy: senderName,
        timestamp: new Date().toISOString(),
      })
      await writeToMailbox(
        updates.owner,
        {
          from: senderName,
          text: assignmentMessage,
          timestamp: new Date().toISOString(),
          color: senderColor,
        },
        taskListId,
      )
    }

    // Add blocks if provided and not already present
    if (addBlocks && addBlocks.length > 0) {
// addBlocks 增量添加：先过滤掉已存在的边再逐条 blockTask——重复依赖不重复写。
      const newBlocks = addBlocks.filter(
        id => !existingTask.blocks.includes(id),
      )
      for (const blockId of newBlocks) {
        await blockTask(taskListId, taskId, blockId)
      }
      if (newBlocks.length > 0) {
        updatedFields.push('blocks')
      }
    }

    // Add blockedBy if provided and not already present (reverse: the blocker blocks this task)
    if (addBlockedBy && addBlockedBy.length > 0) {
// addBlockedBy 是反向调用：blockTask(blockerId, taskId)——「A 被 B 挡」与「B 挡 A」是同一数据结构的两面，入口参数顺序刻意反传。
      const newBlockedBy = addBlockedBy.filter(
        id => !existingTask.blockedBy.includes(id),
      )
      for (const blockerId of newBlockedBy) {
        await blockTask(taskListId, blockerId, taskId)
      }
      if (newBlockedBy.length > 0) {
        updatedFields.push('blockedBy')
      }
    }

    // Structural verification nudge: if the main-thread agent just closed
    // out a 3+ task list and none of those tasks was a verification step,
    // append a reminder to the tool result. Fires at the loop-exit moment
    // where skips happen ("when the last task closed, the loop exited").
    // Mirrors the TodoWriteTool nudge for V1 sessions; this covers V2
    // (interactive CLI). TaskUpdateToolOutput is @internal so this field
    // does not touch the public SDK surface.
// 结构性防跳验证：四个条件同时命中才触发 nudge——VERIFICATION_AGENT 特性开、hive_evidence 开关开、主线程（无 agentId）、刚标完 completed。
    let verificationNudgeNeeded = false
    if (
      feature('VERIFICATION_AGENT') &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false) &&
      !context.agentId &&
      updates.status === 'completed'
    ) {
      const allTasks = await listTasks(taskListId)
// 命中判定还要数全清单：≥3 项任务全部 completed 且没有一项 subject 匹配 /verif/i——「干完了一堆活但没验证」正是统计上跳步骤的时刻。
      const allDone = allTasks.every(t => t.status === 'completed')
      if (
        allDone &&
        allTasks.length >= 3 &&
        !allTasks.some(t => /verif/i.test(t.subject))
      ) {
        verificationNudgeNeeded = true
      }
    }

    return {
      data: {
        success: true,
        taskId,
        updatedFields,
        statusChange:
          updates.status !== undefined
            ? { from: existingTask.status, to: updates.status }
            : undefined,
        verificationNudgeNeeded,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
// mapToolResult 把失败包成普通 tool_result（不带 is_error）——「任务不存在」是良性状况，标错误会触发兄弟工具连锁取消。
    const {
      success,
      taskId,
      updatedFields,
      error,
      statusChange,
      verificationNudgeNeeded,
    } = content as Output
    if (!success) {
      // Return as non-error so it doesn't trigger sibling tool cancellation
      // in StreamingToolExecutor. "Task not found" is a benign condition
      // (e.g., task list already cleaned up) that the model can handle.
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: error || `Task #${taskId} not found`,
      }
    }

    let resultContent = `Updated task #${taskId} ${updatedFields.join(', ')}`

    // Add reminder for teammates when they complete a task (supports in-process teammates)
// 队友完成任务时追加提醒：立刻调 TaskList 找下一件——防「干完就闲着」。
    if (
      statusChange?.to === 'completed' &&
      getAgentId() &&
      isAgentSwarmsEnabled()
    ) {
      resultContent +=
        '\n\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.'
    }

    if (verificationNudgeNeeded) {
// nudge 文案堵死自评后门：必须 spawn 验证 agent，在总结里列 caveats 不算 PARTIAL——只有验证者能下判决。
      resultContent += `\n\nNOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your final summary, spawn the verification agent (subagent_type="${VERIFICATION_AGENT_TYPE}"). You cannot self-assign PARTIAL by listing caveats in your summary — only the verifier issues a verdict.`
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: resultContent,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
