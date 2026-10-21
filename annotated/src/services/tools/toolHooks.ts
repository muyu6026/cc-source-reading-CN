// ═══════════════════════════════════════════════════════════════
//  tools/toolHooks：工具执行前后的钩子编排（650 行）
// ═══════════════════════════════════════════════════════════════
//
//  四个出口，正好是钩子的四种时机：
//
//      runPreToolUseHooks             工具跑之前（可以拦、可以改参数）
//      runPostToolUseHooks            成功后（可以看输出、可以改输出）
//      runPostToolUseFailureHooks     失败后（可以观察、可以注入提示）
//      resolveHookPermissionDecision  把钩子的裁决翻译成权限决定
//
//  最后那个函数是本文件的精华 —— 它守着一句很容易被误解的规则：
//  **钩子说 allow，不等于绕过 settings.json 里的 deny。**
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import type z from 'zod/v4'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AnyObject, Tool, ToolUseContext } from '../../Tool.js'
import type { HookProgress } from '../../types/hooks.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  ProgressMessage,
} from '../../types/message.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  executePostToolHooks,
  executePostToolUseFailureHooks,
  executePreToolHooks,
  getPreToolHookBlockingMessage,
} from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import {
  getRuleBehaviorDescription,
  type PermissionDecisionReason,
  type PermissionResult,
} from '../../utils/permissions/PermissionResult.js'
import { checkRuleBasedPermissions } from '../../utils/permissions/permissions.js'
import { formatError } from '../../utils/toolErrors.js'
import { isMcpTool } from '../mcp/utils.js'
import type { McpServerType, MessageUpdateLazy } from './toolExecution.js'

// 【返回类型是一个联合，两种结果混在一个流里】
//
//      MessageUpdateLazy<AttachmentMessage | ProgressMessage<HookProgress>>
//    | { updatedMCPToolOutput: Output }
//
//  前一种是「吐给 UI 的消息」（钩子输出、进度、错误附件），
//  后一种是「钩子把工具的输出改了」。
//
//  为什么用 AsyncGenerator 而不是返回数组？因为钩子可能跑很久
//  （用户配了个脚本），要边跑边显示进度。**用一个流同时承载「消息」和
//  「控制信号」**，是这套代码的惯用手法 —— 消费方靠字段存在与否分流。
export type PostToolUseHooksResult<Output> =
  | MessageUpdateLazy<AttachmentMessage | ProgressMessage<HookProgress>>
  | { updatedMCPToolOutput: Output }

export async function* runPostToolUseHooks<Input extends AnyObject, Output>(
  toolUseContext: ToolUseContext,
  tool: Tool<Input, Output>,
  toolUseID: string,
  messageId: string,
  toolInput: Record<string, unknown>,
  toolResponse: Output,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  mcpServerBaseUrl: string | undefined,
): AsyncGenerator<PostToolUseHooksResult<Output>> {
  const postToolStartTime = Date.now()
  try {
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    let toolOutput = toolResponse
    for await (const result of executePostToolHooks(
      tool.name,
      toolUseID,
      toolInput,
      toolOutput,
      toolUseContext,
      permissionMode,
      toolUseContext.abortController.signal,
    )) {
      try {
        // Check if we were aborted during hook execution
        // IMPORTANT: We emit a cancelled event per hook
        if (
          result.message?.type === 'attachment' &&
          result.message.attachment.type === 'hook_cancelled'
        ) {
          logEvent('tengu_post_tool_hooks_cancelled', {
            toolName: sanitizeToolNameForAnalytics(tool.name),

            queryChainId: toolUseContext.queryTracking
              ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            queryDepth: toolUseContext.queryTracking?.depth,
          })
          yield {
            message: createAttachmentMessage({
              type: 'hook_cancelled',
              hookName: `PostToolUse:${tool.name}`,
              toolUseID,
              hookEvent: 'PostToolUse',
            }),
          }
          continue
        }

// 【这段注释在解释一个「重复显示」的 bug（#31301）】
//
//  原文：
//
//      For JSON {decision:"block"} hooks, executeHooks yields two results:
//      {blockingError} and {message: hook_blocking_error attachment}. The
//      blockingError path below creates that same attachment, so skip it here
//      to avoid displaying the block reason twice (#31301).
//      The exit-code-2 path only yields {blockingError}, so it's unaffected.
//
//  拆开看：钩子拦下工具调用有两条路 ——
//
//      JSON 输出 {decision:"block"}   →  产出两条结果（一个 error + 一个附件）
//      退出码 2                        →  只产出一条（error）
//
//  下面那段代码会给「有 error」的情况**自己造一个附件**。于是 JSON 那条路
//  就变成了「自己造的 + 上游给的」两份，用户看到同一句话两遍。
//
//  修法是「在这里跳过上游那份」。而这个修法的脆弱之处注释也交代了：
//  它依赖「哪条路会多吐一条」这个细节，将来上游改了产出结构就会再生。
//
//  **读这类代码要有意识：这是一个 patch，不是一个设计。**
        // For JSON {decision:"block"} hooks, executeHooks yields two results:
        // {blockingError} and {message: hook_blocking_error attachment}. The
        // blockingError path below creates that same attachment, so skip it
        // here to avoid displaying the block reason twice (#31301). The
        // exit-code-2 path only yields {blockingError}, so it's unaffected.
        if (
          result.message &&
          !(
            result.message.type === 'attachment' &&
            result.message.attachment.type === 'hook_blocking_error'
          )
        ) {
          yield { message: result.message }
        }

        if (result.blockingError) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_blocking_error',
              hookName: `PostToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUse',
              blockingError: result.blockingError,
            }),
          }
        }

        // If hook indicated to prevent continuation, yield a stop reason message
        if (result.preventContinuation) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_stopped_continuation',
              message:
                result.stopReason || 'Execution stopped by PostToolUse hook',
              hookName: `PostToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUse',
            }),
          }
          return
        }

        // If hooks provided additional context, add it as a message
        if (result.additionalContexts && result.additionalContexts.length > 0) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_additional_context',
              content: result.additionalContexts,
              hookName: `PostToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUse',
            }),
          }
        }

        // If hooks provided updatedMCPToolOutput, yield it if this is an MCP tool
        if (result.updatedMCPToolOutput && isMcpTool(tool)) {
          toolOutput = result.updatedMCPToolOutput as Output
          yield {
            updatedMCPToolOutput: toolOutput,
          }
        }
      } catch (error) {
        const postToolDurationMs = Date.now() - postToolStartTime
        logEvent('tengu_post_tool_hook_error', {
          messageID:
            messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          duration: postToolDurationMs,

          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: toolUseContext.queryTracking?.depth,
          ...(mcpServerType
            ? {
                mcpServerType:
                  mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(requestId
            ? {
                requestId:
                  requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        })
        yield {
          message: createAttachmentMessage({
            type: 'hook_error_during_execution',
            content: formatError(error),
            hookName: `PostToolUse:${tool.name}`,
            toolUseID: toolUseID,
            hookEvent: 'PostToolUse',
          }),
        }
      }
    }
  } catch (error) {
    logError(error)
  }
}

export async function* runPostToolUseFailureHooks<Input extends AnyObject>(
  toolUseContext: ToolUseContext,
  tool: Tool<Input, unknown>,
  toolUseID: string,
  messageId: string,
  processedInput: z.infer<Input>,
  error: string,
  isInterrupt: boolean | undefined,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  mcpServerBaseUrl: string | undefined,
): AsyncGenerator<
  MessageUpdateLazy<AttachmentMessage | ProgressMessage<HookProgress>>
> {
  const postToolStartTime = Date.now()
  try {
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    for await (const result of executePostToolUseFailureHooks(
      tool.name,
      toolUseID,
      processedInput,
      error,
      toolUseContext,
      isInterrupt,
      permissionMode,
      toolUseContext.abortController.signal,
    )) {
      try {
        // Check if we were aborted during hook execution
        if (
          result.message?.type === 'attachment' &&
          result.message.attachment.type === 'hook_cancelled'
        ) {
          logEvent('tengu_post_tool_failure_hooks_cancelled', {
            toolName: sanitizeToolNameForAnalytics(tool.name),
            queryChainId: toolUseContext.queryTracking
              ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            queryDepth: toolUseContext.queryTracking?.depth,
          })
          yield {
            message: createAttachmentMessage({
              type: 'hook_cancelled',
              hookName: `PostToolUseFailure:${tool.name}`,
              toolUseID,
              hookEvent: 'PostToolUseFailure',
            }),
          }
          continue
        }

        // Skip hook_blocking_error in result.message — blockingError path
        // below creates the same attachment (see #31301 / PostToolUse above).
        if (
          result.message &&
          !(
            result.message.type === 'attachment' &&
            result.message.attachment.type === 'hook_blocking_error'
          )
        ) {
          yield { message: result.message }
        }

        if (result.blockingError) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_blocking_error',
              hookName: `PostToolUseFailure:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUseFailure',
              blockingError: result.blockingError,
            }),
          }
        }

        // If hooks provided additional context, add it as a message
        if (result.additionalContexts && result.additionalContexts.length > 0) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_additional_context',
              content: result.additionalContexts,
              hookName: `PostToolUseFailure:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUseFailure',
            }),
          }
        }
      } catch (hookError) {
        const postToolDurationMs = Date.now() - postToolStartTime
        logEvent('tengu_post_tool_failure_hook_error', {
          messageID:
            messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          duration: postToolDurationMs,
          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: toolUseContext.queryTracking?.depth,
          ...(mcpServerType
            ? {
                mcpServerType:
                  mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(requestId
            ? {
                requestId:
                  requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        })
        yield {
          message: createAttachmentMessage({
            type: 'hook_error_during_execution',
            content: formatError(hookError),
            hookName: `PostToolUseFailure:${tool.name}`,
            toolUseID: toolUseID,
            hookEvent: 'PostToolUseFailure',
          }),
        }
      }
    }
  } catch (outerError) {
    logError(outerError)
  }
}

// 【resolveHookPermissionDecision 的 JSDoc 里藏着一句硬规则】
//
//  原文：Encapsulates the invariant that hook 'allow' does NOT bypass
//  settings.json deny/ask rules — checkRuleBasedPermissions still applies
//  (inc-4788 analog).
//
//  也就是说：**钩子说「允许」，不能推翻用户在设置文件里写的「禁止」。**
//
//  为什么？因为钩子是「自动化」，而 settings.json 是「人的意志」。
//  自动化不该覆盖人明确写下的拒绝。如果钩子能绕过 deny，那么一个
//  被恶意篡改的钩子脚本就能让所有危险命令通行 —— 而用户以为自己
//  已经禁掉了。
//
//  所以顺序是：
//
//      钩子 allow  →  仍然跑一遍 checkRuleBasedPermissions
//      规则 deny   →  拒绝（钩子说什么都没用）
//      规则 allow  →  放行
//      规则 null   →  继续（走交互提示）
//
//  注释还说明这个函数被两处共用（主循环 + REPL 内层调用），
//  目的是 so the permission semantics stay in lockstep —— **同一套语义
//  只能有一份实现，否则两条路径迟早会不一致。**
/**
 * Resolve a PreToolUse hook's permission result into a final PermissionDecision.
 *
 * Encapsulates the invariant that hook 'allow' does NOT bypass settings.json
 * deny/ask rules — checkRuleBasedPermissions still applies (inc-4788 analog).
 * Also handles the requiresUserInteraction/requireCanUseTool guards and the
 * 'ask' forceDecision passthrough.
 *
 * Shared by toolExecution.ts (main query loop) and REPLTool/toolWrappers.ts
 * (REPL inner calls) so the permission semantics stay in lockstep.
 */
export async function resolveHookPermissionDecision(
  hookPermissionResult: PermissionResult | undefined,
  tool: Tool,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  toolUseID: string,
): Promise<{
  decision: PermissionDecision
  input: Record<string, unknown>
}> {
  const requiresInteraction = tool.requiresUserInteraction?.()
  const requireCanUseTool = toolUseContext.requireCanUseTool

  if (hookPermissionResult?.behavior === 'allow') {
    const hookInput = hookPermissionResult.updatedInput ?? input

//     // 【interactionSatisfied：一个很聪明的特例】
//     //
//     //  原注释：Hook provided updatedInput for an interactive tool — the hook
//     //  IS the user interaction (e.g. headless wrapper that collected
//     //  AskUserQuestion answers). Treat as non-interactive for the rule-check path.
//     //
//     //  场景：AskUserQuestion 这种工具「需要人回答」。在无头环境里没人能回答，
//     //  所以外层包了一个钩子，把答案直接塞进 updatedInput。
//     //
//     //  这时如果还坚持「需要交互 → 走 canUseTool」，就会卡住等一个永远不会
//     //  出现的用户。所以这里的判断是：**钩子给了 updatedInput，就等价于
//     //  用户已经回答了。**
//     //
//     //  注意这个等价不是随便定的 —— 它成立的前提是「钩子有权限代替用户
//     //  提供答案」，而这一点由钩子的配置权限保证（用户自己配的钩子）。
//     //
//     //  **一个特例值不值得写，取决于它背后的信任模型是否成立。**
    // Hook provided updatedInput for an interactive tool — the hook IS the
    // user interaction (e.g. headless wrapper that collected AskUserQuestion
    // answers). Treat as non-interactive for the rule-check path.
    const interactionSatisfied =
      requiresInteraction && hookPermissionResult.updatedInput !== undefined

    if ((requiresInteraction && !interactionSatisfied) || requireCanUseTool) {
      logForDebugging(
        `Hook approved tool use for ${tool.name}, but canUseTool is required`,
      )
      return {
        decision: await canUseTool(
          tool,
          hookInput,
          toolUseContext,
          assistantMessage,
          toolUseID,
        ),
        input: hookInput,
      }
    }

//     // 【这一行是本函数的核心，也是一句大实话的注解】
//     //
//     //      // Hook allow skips the interactive prompt, but deny/ask rules still apply.
//     //
//     //  翻译：钩子允许可以跳过「弹窗问用户」，但设置里的 deny/ask 规则照样生效。
//     //
//     //  拆开是两个正交的维度：
//     //
//     //      要不要弹窗          ← 钩子可以说「不用问」
//     //      允不允许            ← 规则说了算，钩子无权推翻
//     //
//     //  很多人会把这两件事混成一件（「钩子允许了就不用检查了」），
//     //  而混起来的后果是安全边界被自动化绕过。
//     //
//     //  这条区分值得记住：**「省掉交互」和「改变策略」是两件不同的事。**
    // Hook allow skips the interactive prompt, but deny/ask rules still apply.
    const ruleCheck = await checkRuleBasedPermissions(
      tool,
      hookInput,
      toolUseContext,
    )
    if (ruleCheck === null) {
      logForDebugging(
        interactionSatisfied
          ? `Hook satisfied user interaction for ${tool.name} via updatedInput`
          : `Hook approved tool use for ${tool.name}, bypassing permission prompt`,
      )
      return { decision: hookPermissionResult, input: hookInput }
    }
    if (ruleCheck.behavior === 'deny') {
      logForDebugging(
        `Hook approved tool use for ${tool.name}, but deny rule overrides: ${ruleCheck.message}`,
      )
      return { decision: ruleCheck, input: hookInput }
    }
    // ask rule — dialog required despite hook approval
    logForDebugging(
      `Hook approved tool use for ${tool.name}, but ask rule requires prompt`,
    )
    return {
      decision: await canUseTool(
        tool,
        hookInput,
        toolUseContext,
        assistantMessage,
        toolUseID,
      ),
      input: hookInput,
    }
  }

  if (hookPermissionResult?.behavior === 'deny') {
    logForDebugging(`Hook denied tool use for ${tool.name}`)
    return { decision: hookPermissionResult, input }
  }

  // No hook decision or 'ask' — normal permission flow, possibly with
  // forceDecision so the dialog shows the hook's ask message.
  const forceDecision =
    hookPermissionResult?.behavior === 'ask' ? hookPermissionResult : undefined
  const askInput =
    hookPermissionResult?.behavior === 'ask' &&
    hookPermissionResult.updatedInput
      ? hookPermissionResult.updatedInput
      : input
  return {
    decision: await canUseTool(
      tool,
      askInput,
      toolUseContext,
      assistantMessage,
      toolUseID,
      forceDecision,
    ),
    input: askInput,
  }
}

export async function* runPreToolUseHooks(
  toolUseContext: ToolUseContext,
  tool: Tool,
  processedInput: Record<string, unknown>,
  toolUseID: string,
  messageId: string,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  mcpServerBaseUrl: string | undefined,
): AsyncGenerator<
  | {
      type: 'message'
      message: MessageUpdateLazy<
        AttachmentMessage | ProgressMessage<HookProgress>
      >
    }
  | { type: 'hookPermissionResult'; hookPermissionResult: PermissionResult }
  | { type: 'hookUpdatedInput'; updatedInput: Record<string, unknown> }
  | { type: 'preventContinuation'; shouldPreventContinuation: boolean }
  | { type: 'stopReason'; stopReason: string }
  | {
      type: 'additionalContext'
      message: MessageUpdateLazy<AttachmentMessage>
    }
  // stop execution
  | { type: 'stop' }
> {
  const hookStartTime = Date.now()
  try {
    const appState = toolUseContext.getAppState()

    for await (const result of executePreToolHooks(
      tool.name,
      toolUseID,
      processedInput,
      toolUseContext,
      appState.toolPermissionContext.mode,
      toolUseContext.abortController.signal,
      undefined, // timeoutMs - use default
      toolUseContext.requestPrompt,
      tool.getToolUseSummary?.(processedInput),
    )) {
      try {
        if (result.message) {
          yield { type: 'message', message: { message: result.message } }
        }
        if (result.blockingError) {
          const denialMessage = getPreToolHookBlockingMessage(
            `PreToolUse:${tool.name}`,
            result.blockingError,
          )
          yield {
            type: 'hookPermissionResult',
            hookPermissionResult: {
              behavior: 'deny',
              message: denialMessage,
              decisionReason: {
                type: 'hook',
                hookName: `PreToolUse:${tool.name}`,
                reason: denialMessage,
              },
            },
          }
        }
        // Check if hook wants to prevent continuation
        if (result.preventContinuation) {
          yield {
            type: 'preventContinuation',
            shouldPreventContinuation: true,
          }
          if (result.stopReason) {
            yield { type: 'stopReason', stopReason: result.stopReason }
          }
        }
        // Check for hook-defined permission behavior
        if (result.permissionBehavior !== undefined) {
          logForDebugging(
            `Hook result has permissionBehavior=${result.permissionBehavior}`,
          )
          const decisionReason: PermissionDecisionReason = {
            type: 'hook',
            hookName: `PreToolUse:${tool.name}`,
            hookSource: result.hookSource,
            reason: result.hookPermissionDecisionReason,
          }
          if (result.permissionBehavior === 'allow') {
            yield {
              type: 'hookPermissionResult',
              hookPermissionResult: {
                behavior: 'allow',
                updatedInput: result.updatedInput,
                decisionReason,
              },
            }
          } else if (result.permissionBehavior === 'ask') {
            yield {
              type: 'hookPermissionResult',
              hookPermissionResult: {
                behavior: 'ask',
                updatedInput: result.updatedInput,
                message:
                  result.hookPermissionDecisionReason ||
                  `Hook PreToolUse:${tool.name} ${getRuleBehaviorDescription(result.permissionBehavior)} this tool`,
                decisionReason,
              },
            }
          } else {
            // deny - updatedInput is irrelevant since tool won't run
            yield {
              type: 'hookPermissionResult',
              hookPermissionResult: {
                behavior: result.permissionBehavior,
                message:
                  result.hookPermissionDecisionReason ||
                  `Hook PreToolUse:${tool.name} ${getRuleBehaviorDescription(result.permissionBehavior)} this tool`,
                decisionReason,
              },
            }
          }
        }

        // Yield updatedInput for passthrough case (no permission decision)
        // This allows hooks to modify input while letting normal permission flow continue
        if (result.updatedInput && result.permissionBehavior === undefined) {
          yield {
            type: 'hookUpdatedInput',
            updatedInput: result.updatedInput,
          }
        }

        // If hooks provided additional context, add it as a message
        if (result.additionalContexts && result.additionalContexts.length > 0) {
          yield {
            type: 'additionalContext',
            message: {
              message: createAttachmentMessage({
                type: 'hook_additional_context',
                content: result.additionalContexts,
                hookName: `PreToolUse:${tool.name}`,
                toolUseID,
                hookEvent: 'PreToolUse',
              }),
            },
          }
        }

        // Check if we were aborted during hook execution
        if (toolUseContext.abortController.signal.aborted) {
          logEvent('tengu_pre_tool_hooks_cancelled', {
            toolName: sanitizeToolNameForAnalytics(tool.name),

            queryChainId: toolUseContext.queryTracking
              ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            queryDepth: toolUseContext.queryTracking?.depth,
          })
          yield {
            type: 'message',
            message: {
              message: createAttachmentMessage({
                type: 'hook_cancelled',
                hookName: `PreToolUse:${tool.name}`,
                toolUseID,
                hookEvent: 'PreToolUse',
              }),
            },
          }
          yield { type: 'stop' }
          return
        }
      } catch (error) {
        logError(error)
        const durationMs = Date.now() - hookStartTime
        logEvent('tengu_pre_tool_hook_error', {
          messageID:
            messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          duration: durationMs,

          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: toolUseContext.queryTracking?.depth,
          ...(mcpServerType
            ? {
                mcpServerType:
                  mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(requestId
            ? {
                requestId:
                  requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        })
        yield {
          type: 'message',
          message: {
            message: createAttachmentMessage({
              type: 'hook_error_during_execution',
              content: formatError(error),
              hookName: `PreToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PreToolUse',
            }),
          },
        }
        yield { type: 'stop' }
      }
    }
  } catch (error) {
    logError(error)
    yield { type: 'stop' }
    return
  }
}
