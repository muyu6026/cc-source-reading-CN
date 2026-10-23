import { feature } from 'bun:bundle'
import { writeFile } from 'fs/promises'
import { z } from 'zod/v4'
import {
  getAllowedChannels,
  hasExitedPlanModeInSession,
  setHasExitedPlanMode,
  setNeedsAutoModeExitAttachment,
  setNeedsPlanModeExitAttachment,
} from '../../bootstrap/state.js'
import { logEvent } from '../../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/metadata.js'
import {
  buildTool,
  type Tool,
  type ToolDef,
  toolMatchesName,
} from '../../Tool.js'
import { formatAgentId, generateRequestId } from '../../utils/agentId.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  findInProcessTeammateTaskId,
  setAwaitingPlanApproval,
} from '../../utils/inProcessTeammateHelpers.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import {
  getPlan,
  getPlanFilePath,
  persistFileSnapshotIfRemote,
} from '../../utils/plans.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  getAgentName,
  getTeamName,
  isPlanModeRequired,
  isTeammate,
} from '../../utils/teammate.js'
import { writeToMailbox } from '../../utils/teammateMailbox.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '../TeamCreateTool/constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from './constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_PROMPT } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

// 条件 require 防 tree-shaking：autoModeState / permissionSetup 两个模块只在 TRANSCRIPT_CLASSIFIER 特性开启时才引入。若用静态 import，被打包进主 chunk 的顶层副作用（如 autoModeState 的模块级 memoize）会在特性关闭时依然存活——条件 require 让打包器彻底看不到这条路径。
/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null
const permissionSetupModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/permissionSetup.js') as typeof import('../../utils/permissions/permissionSetup.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

// allowedPromptSchema：计划可「语义化」申请权限类别（如「跑测试」「装依赖」）而非逐条命令。这是 exit plan mode 与权限系统的接缝——计划里声明要干什么，用户批准计划即批量批准一类动作。tool 目前只开放 Bash。
/**
 * Schema for prompt-based permission requests.
 * Used by Claude to request semantic permissions when exiting plan mode.
 */
const allowedPromptSchema = lazySchema(() =>
  z.object({
    tool: z.enum(['Bash']).describe('The tool this prompt applies to'),
    prompt: z
      .string()
      .describe(
        'Semantic description of the action, e.g. "run tests", "install dependencies"',
      ),
  }),
)

export type AllowedPrompt = z.infer<ReturnType<typeof allowedPromptSchema>>

// inputSchema 本体：strictObject + passthrough。严格校验未知字段（防模型幻觉参数），但 passthrough 又允许它们通过——因为 normalizeToolInput 会从磁盘注入 plan/planFilePath，而这两字段刻意不进内部 schema（计划内容从文件读，不进上下文两次）。
const inputSchema = lazySchema(() =>
  z
    .strictObject({
      // Prompt-based permissions requested by the plan
      allowedPrompts: z
        .array(allowedPromptSchema())
        .optional()
        .describe(
          'Prompt-based permissions needed to implement the plan. These describe categories of actions rather than specific commands.',
        ),
    })
    .passthrough(),
)
type InputSchema = ReturnType<typeof inputSchema>

// _sdkInputSchema 是 SDK/Hook 面的 schema：把 normalizeToolInput 注入的 plan 与 planFilePath 显式声明出来。内外两套 schema 的差异正是「注入发生在权限校验之后」这一事实的化石。
/**
 * SDK-facing input schema - includes fields injected by normalizeToolInput.
 * The internal inputSchema doesn't have these fields because plan is read from disk,
 * but the SDK/hooks see the normalized version with plan and file path included.
 */
export const _sdkInputSchema = lazySchema(() =>
  inputSchema().extend({
    plan: z
      .string()
      .optional()
      .describe('The plan content (injected by normalizeToolInput from disk)'),
    planFilePath: z
      .string()
      .optional()
      .describe('The plan file path (injected by normalizeToolInput)'),
  }),
)

// outputSchema 字段即状态机快照：计划文本、是否 agent 上下文、落盘路径、有没有 Agent 工具（决定要不要提示拆团队）、用户是否编辑过计划（决定 tool_result 里回显时打什么标签）、是否在等队长审批、审批请求 ID。
export const outputSchema = lazySchema(() =>
  z.object({
    plan: z
      .string()
      .nullable()
      .describe('The plan that was presented to the user'),
    isAgent: z.boolean(),
    filePath: z
      .string()
      .optional()
      .describe('The file path where the plan was saved'),
    hasTaskTool: z
      .boolean()
      .optional()
      .describe('Whether the Agent tool is available in the current context'),
    planWasEdited: z
      .boolean()
      .optional()
      .describe(
        'True when the user edited the plan (CCR web UI or Ctrl+G); determines whether the plan is echoed back in tool_result',
      ),
    awaitingLeaderApproval: z
      .boolean()
      .optional()
      .describe(
        'When true, the teammate has sent a plan approval request to the team leader',
      ),
    requestId: z
      .string()
      .optional()
      .describe('Unique identifier for the plan approval request'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// buildTool 主结构。与 EnterPlanModeTool 的 isEnabled 完全对称——channels 防护成对出现（详见 EnterPlanModeTool 同段批注）。
export const ExitPlanModeV2Tool: Tool<InputSchema, Output> = buildTool({
  name: EXIT_PLAN_MODE_V2_TOOL_NAME,
  searchHint: 'present plan for approval and start coding (plan mode only)',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Prompts the user to exit plan mode and start coding'
  },
  async prompt() {
    return EXIT_PLAN_MODE_V2_TOOL_PROMPT
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
// isEnabled：--channels 下用户在 Telegram/Discord，计划审批对话框会永久挂起，故整体禁用。注释明说与 EnterPlanMode「成对」——单边禁用会让模型进得去出不来。
  isEnabled() {
    // When --channels is active the user is likely on Telegram/Discord, not
    // watching the TUI. The plan-approval dialog would hang. Paired with the
    // same gate on EnterPlanMode so plan mode isn't a trap.
    if (
      (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
      getAllowedChannels().length > 0
    ) {
      return false
    }
    return true
  },
  isConcurrencySafe() {
    return true
  },
// isReadOnly 返回 false——V2 与 V1 的最大分野：计划要落盘（writeFile），从此它是只读工具家族里的异类。EnterPlanMode 仍是只读。
  isReadOnly() {
    return false // Now writes to disk
  },
// requiresUserInteraction：teammate 一律不等本地用户——强制计划的队走 mailbox 等队长审批，自愿计划的队本地直接退出；非 teammate 必须用户点头。同一工具三种交互姿态。
  requiresUserInteraction() {
    // For ALL teammates, no local user interaction needed:
    // - If isPlanModeRequired(): team lead approves via mailbox
    // - Otherwise: exits locally without approval (voluntary plan mode)
    if (isTeammate()) {
      return false
    }
    // For non-teammates, require user confirmation to exit plan mode
    return true
  },
// validateInput 两段式。teammate 直接放行：队友的 AppState 里可能是队长的模式（runAgent.ts 在 acceptEdits/bypassPermissions/auto 下跳过覆盖），isPlanModeRequired() 才是真相源——AppState 会骗人，专用查询函数不会。
  async validateInput(_input, { getAppState, options }) {
    // Teammate AppState may show leader's mode (runAgent.ts skips override in
    // acceptEdits/bypassPermissions/auto); isPlanModeRequired() is the real source
    if (isTeammate()) {
      return { result: true }
    }
    // The deferred-tool list announces this tool regardless of mode, so the
    // model can call it after plan approval (fresh delta on compact/clear).
    // Reject before checkPermissions to avoid showing the approval dialog.
    const mode = getAppState().toolPermissionContext.mode
// 非 plan 模式调用的拒绝逻辑：deferred 工具列表无论当前模式都会广播本工具（压缩/清上下文后的新 delta 里模型还能看见它），所以必须在 checkPermissions 之前拦截——否则用户会看到一个莫名其妙的「退出计划模式？」审批框。拒绝同时打 tengu_exit_plan_mode_called_outside_plan 遥测，这是模型对自身状态失察的量化指标。
    if (mode !== 'plan') {
      logEvent('tengu_exit_plan_mode_called_outside_plan', {
        model:
          options.mainLoopModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        hasExitedPlanModeInSession: hasExitedPlanModeInSession(),
      })
      return {
        result: false,
        message:
          'You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation.',
        errorCode: 1,
      }
    }
    return { result: true }
  },
// checkPermissions：teammate 完全绕过权限 UI（不弹框、不发 permission_request），交互逻辑全部挪进 call()；非 teammate 走 ask——「Exit plan mode?」这个对话框是计划模式的正式出口。
  async checkPermissions(input, context) {
    // For ALL teammates, bypass the permission UI to avoid sending permission_request
    // The call() method handles the appropriate behavior:
    // - If isPlanModeRequired(): sends plan_approval_request to leader
    // - Otherwise: exits plan mode locally (voluntary plan mode)
    if (isTeammate()) {
      return {
        behavior: 'allow' as const,
        updatedInput: input,
      }
    }

    // For non-teammates, require user confirmation to exit plan mode
    return {
      behavior: 'ask' as const,
      message: 'Exit plan mode?',
      updatedInput: input,
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
// call() 开头的三件事：isAgent 标记（子代理里批准计划后只需回个 ok）、定位计划文件、取计划内容。
  async call(input, context) {
    const isAgent = !!context.agentId

    const filePath = getPlanFilePath(context.agentId)
    // CCR web UI may send an edited plan via permissionResult.updatedInput.
    // queryHelpers.ts full-replaces finalInput, so when CCR sends {} (no edit)
    // input.plan is undefined -> disk fallback. The internal inputSchema omits
    // `plan` (normally injected by normalizeToolInput), hence the narrowing.
    const inputPlan =
      'plan' in input && typeof input.plan === 'string' ? input.plan : undefined
// inputPlan 的来源窄化：CCR web UI 允许用户在权限对话框里编辑计划，编辑结果经 permissionResult.updatedInput 回传；queryHelpers.ts 是全量替换 finalInput，CCR 不编辑时传 {}，input.plan 即为 undefined——于是窄化成「有字符串才算编辑过」，否则回落读磁盘。三元表达式只认 typeof string，数字/对象一律视为未提供。
    const plan = inputPlan ?? getPlan(context.agentId)

    // Sync disk so VerifyPlanExecution / Read see the edit. Re-snapshot
    // after: the only other persistFileSnapshotIfRemote call (api.ts) runs
    // in normalizeToolInput, pre-permission — it captured the old plan.
// 编辑回写磁盘：VerifyPlanExecution 与 Read 都要看到编辑后的计划。 persistFileSnapshotIfRemote 必须再调一次——api.ts 里那次快照跑在 normalizeToolInput（权限前），拍到的是旧计划。快照时序是远程协作场景的隐藏接缝。
    if (inputPlan !== undefined && filePath) {
      await writeFile(filePath, inputPlan, 'utf-8').catch(e => logError(e))
      void persistFileSnapshotIfRemote()
    }

    // Check if this is a teammate that requires leader approval
// teammate + isPlanModeRequired 分支：没写计划文件直接抛错（计划是强制产物，不允许空计划过关）；有则生成 plan_approval_request 写进 team-lead  mailbox——审批走消息队列而非本地对话框，异步协作的全部要义。
    if (isTeammate() && isPlanModeRequired()) {
      // Plan is required for plan_mode_required teammates
      if (!plan) {
        throw new Error(
          `No plan file found at ${filePath}. Please write your plan to this file before calling ExitPlanMode.`,
        )
      }
      const agentName = getAgentName() || 'unknown'
      const teamName = getTeamName()
      const requestId = generateRequestId(
        'plan_approval',
        formatAgentId(agentName, teamName || 'default'),
      )

      const approvalRequest = {
        type: 'plan_approval_request',
        from: agentName,
        timestamp: new Date().toISOString(),
        planFilePath: filePath,
        planContent: plan,
        requestId,
      }

      await writeToMailbox(
        'team-lead',
        {
          from: agentName,
          text: jsonStringify(approvalRequest),
          timestamp: new Date().toISOString(),
        },
        teamName,
      )

      // Update task state to show awaiting approval (for in-process teammates)
      const appState = context.getAppState()
      const agentTaskId = findInProcessTeammateTaskId(agentName, appState)
      if (agentTaskId) {
        setAwaitingPlanApproval(agentTaskId, context.setAppState, true)
      }

      return {
        data: {
          plan,
          isAgent: true,
          filePath,
          awaitingLeaderApproval: true,
          requestId,
        },
      }
    }

    // Note: Background verification hook is registered in REPL.tsx AFTER context clear
    // via registerPlanVerificationHook(). Registering here would be cleared during context clear.

    // Ensure mode is changed when exiting plan mode.
    // This handles cases where permission flow didn't set the mode
    // (e.g., when PermissionRequest hook auto-approves without providing updatedPermissions).
    const appState = context.getAppState()
    // Compute gate-off fallback before setAppState so we can notify the user.
    // Circuit breaker defense: if prePlanMode was an auto-like mode but the
    // gate is now off (circuit breaker or settings disable), restore to
    // 'default' instead. Without this, ExitPlanMode would bypass the circuit
    // breaker by calling setAutoModeActive(true) directly.
// 熔断防御：prePlanMode 是 auto 但 auto 模式闸门已关（熔断或设置禁用）时，恢复目标降级为 default 并发通知。没有这段，ExitPlanMode 会绕过熔断器直接 setAutoModeActive(true)——退出计划模式成了自动模式的「侧门」。
    let gateFallbackNotification: string | null = null
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const prePlanRaw = appState.toolPermissionContext.prePlanMode ?? 'default'
      if (
        prePlanRaw === 'auto' &&
        !(permissionSetupModule?.isAutoModeGateEnabled() ?? false)
      ) {
        const reason =
          permissionSetupModule?.getAutoModeUnavailableReason() ??
          'circuit-breaker'
        gateFallbackNotification =
          permissionSetupModule?.getAutoModeUnavailableNotification(reason) ??
          'auto mode unavailable'
        logForDebugging(
          `[auto-mode gate @ ExitPlanModeV2Tool] prePlanMode=${prePlanRaw} ` +
            `but gate is off (reason=${reason}) — falling back to default on plan exit`,
          { level: 'warn' },
        )
      }
    }
    if (gateFallbackNotification) {
      context.addNotification?.({
        key: 'auto-mode-gate-plan-exit-fallback',
        text: `plan exit → default · ${gateFallbackNotification}`,
        priority: 'immediate',
        color: 'warning',
        timeoutMs: 10000,
      })
    }

// setAppState 恢复现场：prePlanMode 还原进计划前的模式；auto 状态以 isAutoModeActive() 为权威（prePlanMode/strippedDangerousRules 在 transitionPlanAutoMode 中途停用后已过期）；恢复非 auto 模式时把进计划前剥掉的危险规则还原，恢复 auto 则保持剥离——退出不是简单的模式回滚，而是权限集合的对称复原。
    context.setAppState(prev => {
      if (prev.toolPermissionContext.mode !== 'plan') return prev
      setHasExitedPlanMode(true)
      setNeedsPlanModeExitAttachment(true)
      let restoreMode = prev.toolPermissionContext.prePlanMode ?? 'default'
      if (feature('TRANSCRIPT_CLASSIFIER')) {
        if (
          restoreMode === 'auto' &&
          !(permissionSetupModule?.isAutoModeGateEnabled() ?? false)
        ) {
          restoreMode = 'default'
        }
        const finalRestoringAuto = restoreMode === 'auto'
        // Capture pre-restore state — isAutoModeActive() is the authoritative
        // signal (prePlanMode/strippedDangerousRules are stale after
        // transitionPlanAutoMode deactivates mid-plan).
        const autoWasUsedDuringPlan =
          autoModeStateModule?.isAutoModeActive() ?? false
        autoModeStateModule?.setAutoModeActive(finalRestoringAuto)
        if (autoWasUsedDuringPlan && !finalRestoringAuto) {
          setNeedsAutoModeExitAttachment(true)
        }
      }
      // If restoring to a non-auto mode and permissions were stripped (either
      // from entering plan from auto, or from shouldPlanUseAutoMode),
      // restore them. If restoring to auto, keep them stripped.
      const restoringToAuto = restoreMode === 'auto'
      let baseContext = prev.toolPermissionContext
      if (restoringToAuto) {
        baseContext =
          permissionSetupModule?.stripDangerousPermissionsForAutoMode(
            baseContext,
          ) ?? baseContext
      } else if (prev.toolPermissionContext.strippedDangerousRules) {
        baseContext =
          permissionSetupModule?.restoreDangerousPermissions(baseContext) ??
          baseContext
      }
      return {
        ...prev,
        toolPermissionContext: {
          ...baseContext,
          mode: restoreMode,
          prePlanMode: undefined,
        },
      }
    })

// hasTaskTool 探测：Agent 工具在当前上下文可用且 agent swarms 开启时，tool_result 里追加「可拆团队并行」的提示——计划批准点是并行化的自然决策点。
    const hasTaskTool =
      isAgentSwarmsEnabled() &&
      context.options.tools.some(t => toolMatchesName(t, AGENT_TOOL_NAME))

    return {
      data: {
        plan,
        isAgent,
        filePath,
        hasTaskTool: hasTaskTool || undefined,
        planWasEdited: inputPlan !== undefined || undefined,
      },
    }
  },
// tool_result 生成四分支：等队长审批（列后续步骤 + 禁止擅动）/ agent 上下文（一句 ok 打发）/ 空计划（一句放行）/ 正常（回显计划全文 + 保存路径 + 团队提示）。
  mapToolResultToToolResultBlockParam(
    {
      isAgent,
      plan,
      filePath,
      hasTaskTool,
      planWasEdited,
      awaitingLeaderApproval,
      requestId,
    },
    toolUseID,
  ) {
    // Handle teammate awaiting leader approval
    if (awaitingLeaderApproval) {
      return {
        type: 'tool_result',
        content: `Your plan has been submitted to the team lead for approval.

Plan file: ${filePath}

**What happens next:**
1. Wait for the team lead to review your plan
2. You will receive a message in your inbox with approval/rejection
3. If approved, you can proceed with implementation
4. If rejected, refine your plan based on the feedback

**Important:** Do NOT proceed until you receive approval. Check your inbox for response.

Request ID: ${requestId}`,
        tool_use_id: toolUseID,
      }
    }

    if (isAgent) {
      return {
        type: 'tool_result',
        content:
          'User has approved the plan. There is nothing else needed from you now. Please respond with "ok"',
        tool_use_id: toolUseID,
      }
    }

    // Handle empty plan
    if (!plan || plan.trim() === '') {
      return {
        type: 'tool_result',
        content: 'User has approved exiting plan mode. You can now proceed.',
        tool_use_id: toolUseID,
      }
    }

    const teamHint = hasTaskTool
      ? `\n\nIf this plan can be broken down into multiple independent tasks, consider using the ${TEAM_CREATE_TOOL_NAME} tool to create a team and parallelize the work.`
      : ''

// 计划全文必须总是回显——Ultraplan CCR 流程的 extractApprovedPlan() 要解析 tool_result 才能把计划文本喂给本地 CLI。用户编辑过的计划打「edited by user」标签：模型必须知道用户改过它的方案，否则会按记忆里的旧版实施。
    // Always include the plan — extractApprovedPlan() in the Ultraplan CCR
    // flow parses the tool_result to retrieve the plan text for the local CLI.
    // Label edited plans so the model knows the user changed something.
    const planLabel = planWasEdited
      ? 'Approved Plan (edited by user)'
      : 'Approved Plan'

// 最终 tool_result 组装：批准语 + 保存路径（可 /plan 随时回看）+ 条件团队提示 + 计划全文。路径回显是给模型的锚点——实现阶段引用计划不用重新探索。
    return {
      type: 'tool_result',
      content: `User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ${filePath}
You can refer back to it if needed during implementation.${teamHint}

## ${planLabel}:
${plan}`,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
