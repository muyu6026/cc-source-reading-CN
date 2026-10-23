import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import {
  getAllowedChannels,
  handlePlanModeTransition,
} from '../../bootstrap/state.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js'
import { prepareContextForPlanMode } from '../../utils/permissions/permissionSetup.js'
import { isPlanModeInterviewPhaseEnabled } from '../../utils/planModeV2.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from './constants.js'
import { getEnterPlanModeToolPrompt } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

// inputSchema 是空 strictObject——进入计划模式不需要任何参数，模型只需表态「我要开始规划了」。参数越少越难被误用。
const inputSchema = lazySchema(() =>
  z.strictObject({
    // No parameters needed
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Confirmation that plan mode was entered'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// buildTool 主结构。注意 userFacingName() 返回空串——这个工具对用户完全静默，只在权限对话框与结果消息里露面。
export const EnterPlanModeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_PLAN_MODE_TOOL_NAME,
  searchHint: 'switch to plan mode to design an approach before coding',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Requests permission to enter plan mode for complex tasks requiring exploration and design'
  },
  async prompt() {
    return getEnterPlanModeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return ''
  },
  shouldDefer: true,
// isEnabled 的 channels 防护：--channels 模式下退出计划模式的审批对话框没人看得见（用户在 Telegram/Discord 上），于是连「进入」也一并禁用——进得去出不来的计划模式是陷阱，入口必须与出口成对设防。
  isEnabled() {
    // When --channels is active, ExitPlanMode is disabled (its approval
    // dialog needs the terminal). Disable entry too so plan mode isn't a
    // trap the model can enter but never leave.
    if (
      (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
      getAllowedChannels().length > 0
    ) {
      return false
    }
    return true
  },
// isConcurrencySafe 为真：进入计划模式只改会话状态，不碰磁盘，可与其他工具并行。
  isConcurrencySafe() {
    return true
  },
// isReadOnly 为真：规划阶段被框架认定为只读操作，权限链路放行。
  isReadOnly() {
    return true
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
// call() 第一道守卫：agentId 存在即抛错。子代理没有「计划模式」这个概念——它们的生命周期由父级编排，让子代理进入计划模式会造成状态机歧义。
  async call(_input, context) {
    if (context.agentId) {
      throw new Error('EnterPlanMode tool cannot be used in agent contexts')
    }

    const appState = context.getAppState()
// handlePlanModeTransition 负责广播模式变更事件（UI 状态栏、hooks 等订阅方据此刷新）。
    handlePlanModeTransition(appState.toolPermissionContext.mode, 'plan')

    // Update the permission mode to 'plan'. prepareContextForPlanMode runs
    // the classifier activation side effects when the user's defaultMode is
    // 'auto' — see permissionSetup.ts for the full lifecycle.
// 权限上下文两连改：先 prepareContextForPlanMode 跑分类器激活副作用（defaultMode 为 auto 时进入计划模式会临时挂起自动放行），再 applyPermissionUpdate 落 setMode。mode 与 destination: session 绑定，计划模式不跨会话持久化。
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(
        prepareContextForPlanMode(prev.toolPermissionContext),
        { type: 'setMode', mode: 'plan', destination: 'session' },
      ),
    }))

// 返回给模型的确认消息。注意 data 里只有一句话——真正的工作指引在下面的 mapToolResultToToolResultBlockParam 里展开。
    return {
      data: {
        message:
          'Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.',
      },
    }
  },
// tool_result 内容按 isPlanModeInterviewPhaseEnabled() 分叉：开启访谈阶段时只给一句「除计划文件外不许写任何文件」（详细流程改由 plan_mode attachment 后续送达，避免重复注入）；关闭时给出六步探索清单 + 只读强调。
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    const instructions = isPlanModeInterviewPhaseEnabled()
      ? `${message}

DO NOT write or edit any files except the plan file. Detailed workflow instructions will follow.`
      : `${message}

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`

    return {
      type: 'tool_result',
      content: instructions,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
