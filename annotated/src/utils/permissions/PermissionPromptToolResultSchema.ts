import type { Tool, ToolUseContext } from 'src/Tool.js'
import z from 'zod/v4'
import { logForDebugging } from '../debug.js'
import { lazySchema } from '../lazySchema.js'
import type {
  PermissionDecision,
  PermissionDecisionReason,
} from './PermissionResult.js'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
} from './PermissionUpdate.js'
import { permissionUpdateSchema } from './PermissionUpdateSchema.js'
// 本模块定义「权限提示工具」结果的结构（Zod schema）并把结果规整成内部的 PermissionDecision；SDK 主机可能传畸形数据，这里用 .catch 兜底而非整体拒绝。

export const inputSchema = lazySchema(() =>
  z.object({
    tool_name: z
      .string()
      .describe('The name of the tool requesting permission'),
    input: z.record(z.string(), z.unknown()).describe('The input for the tool'),
    tool_use_id: z
      .string()
      .optional()
      .describe('The unique tool use request ID'),
  }),
)
// 定义权限提示工具的输入 schema：工具名、工具输入、可选的 tool_use_id。

export type Input = z.infer<ReturnType<typeof inputSchema>>
// 由 schema 推导出的输入类型。

// Zod schema for permission results
// This schema is used to validate the MCP permission prompt tool
// so we maintain it as a subset of the real PermissionDecision type
// 权限结果的 Zod schema：作为真实 PermissionDecision 类型的子集来维护。

// Matches PermissionDecisionClassificationSchema in entrypoints/sdk/coreSchemas.ts.
// Malformed values fall through to undefined (same pattern as updatedPermissions
// below) so a bad string from the SDK host doesn't reject the whole decision.
const decisionClassificationField = lazySchema(() =>
  z
    .enum(['user_temporary', 'user_permanent', 'user_reject'])
    .optional()
    .catch(undefined),
)
// 决策分类字段（user_temporary/user_permanent/user_reject），可选；畸形值兜底为 undefined 而非拒绝整个决策（与下方 updatedPermissions 同一模式）。

const PermissionAllowResultSchema = lazySchema(() =>
  z.object({
    behavior: z.literal('allow'),
    updatedInput: z.record(z.string(), z.unknown()),
    // SDK hosts may send malformed entries; fall back to undefined rather
    // than rejecting the entire allow decision (anthropics/claude-code#29440)
    updatedPermissions: z
      .array(permissionUpdateSchema())
      .optional()
      .catch(ctx => {
        logForDebugging(
          `Malformed updatedPermissions from SDK host ignored: ${ctx.error.issues[0]?.message ?? 'unknown'}`,
          { level: 'warn' },
        )
        return undefined
      }),
    toolUseID: z.string().optional(),
    decisionClassification: decisionClassificationField(),
  }),
)
// allow 结果 schema：含 behavior=allow、updatedInput、可选的 updatedPermissions（SDK 主机传畸形项时忽略而非拒绝，见 issue #29440）、toolUseID、decisionClassification。

const PermissionDenyResultSchema = lazySchema(() =>
  z.object({
    behavior: z.literal('deny'),
    message: z.string(),
    interrupt: z.boolean().optional(),
    toolUseID: z.string().optional(),
    decisionClassification: decisionClassificationField(),
  }),
)
// deny 结果 schema：含 behavior=deny、message、可选的 interrupt、toolUseID、decisionClassification。

export const outputSchema = lazySchema(() =>
  z.union([PermissionAllowResultSchema(), PermissionDenyResultSchema()]),
)
// 输出 schema 为 allow/deny 两种结果之一的联合类型。

export type Output = z.infer<ReturnType<typeof outputSchema>>
// 由输出 schema 推导的类型。

/**
 * Normalizes the result of a permission prompt tool to a PermissionDecision.
 */
export function permissionPromptToolResultToPermissionDecision(
  result: Output,
  tool: Tool,
  input: { [key: string]: unknown },
  toolUseContext: ToolUseContext,
): PermissionDecision {
// 把权限提示工具的结果规整成内部 PermissionDecision；参数含 tool、原始 input、toolUseContext。
  const decisionReason: PermissionDecisionReason = {
    type: 'permissionPromptTool',
    permissionPromptToolName: tool.name,
    toolResult: result,
  }
  if (result.behavior === 'allow') {
// 允许分支：若有 updatedPermissions 就写回 appState 并持久化。
    const updatedPermissions = result.updatedPermissions
    if (updatedPermissions) {
      toolUseContext.setAppState(prev => ({
        ...prev,
        toolPermissionContext: applyPermissionUpdates(
          prev.toolPermissionContext,
          updatedPermissions,
        ),
      }))
      persistPermissionUpdates(updatedPermissions)
    }
    // Mobile clients responding from a push notification don't have the
    // original tool input, so they send `{}` to satisfy the schema. Treat an
    // empty object as "use original" so the tool doesn't run with no args.
// 移动端从推送通知回应的客户端没有原始工具输入，会发空对象满足 schema；空对象当作「用原始输入」，避免工具在零参数下运行。
    const updatedInput =
      Object.keys(result.updatedInput).length > 0 ? result.updatedInput : input
// 据此决定使用更新后的输入还是原始输入（空对象时用原始）。
    return {
      ...result,
      updatedInput,
      decisionReason,
    }
  } else if (result.behavior === 'deny' && result.interrupt) {
// 拒绝且要求中断时，记日志并中止当前控制器。
    logForDebugging(
      `SDK permission prompt deny+interrupt: tool=${tool.name} message=${result.message}`,
    )
    toolUseContext.abortController.abort()
  }
  return {
// 其余情况（deny 不中断）返回带 decisionReason 的结果。
    ...result,
    decisionReason,
  }
}
