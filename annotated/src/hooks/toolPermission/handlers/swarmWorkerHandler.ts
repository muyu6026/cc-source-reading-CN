import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { PendingClassifierCheck } from '../../../types/permissions.js'
import { isAgentSwarmsEnabled } from '../../../utils/agentSwarmsEnabled.js'
import { toError } from '../../../utils/errors.js'
import { logError } from '../../../utils/log.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import {
  createPermissionRequest,
  isSwarmWorker,
  sendPermissionRequestViaMailbox,
} from '../../../utils/swarm/permissionSync.js'
import { registerPermissionCallback } from '../../useSwarmPermissionPoller.js'
import type { PermissionContext } from '../PermissionContext.js'
import { createResolveOnce } from '../PermissionContext.js'

type SwarmWorkerPermissionParams = {
  ctx: PermissionContext
  description: string
  pendingClassifierCheck?: PendingClassifierCheck | undefined
  updatedInput: Record<string, unknown> | undefined
  suggestions: PermissionUpdate[] | undefined
}

/**
 * Handles the swarm worker permission flow.
 *
 * When running as a swarm worker:
 * 1. Tries classifier auto-approval for bash commands
 * 2. Forwards the permission request to the leader via mailbox
 * 3. Registers callbacks for when the leader responds
 * 4. Sets the pending indicator while waiting
 *
 * Returns a PermissionDecision if the classifier auto-approves,
 * or a Promise that resolves when the leader responds.
 * Returns null if swarms are not enabled or this is not a swarm worker,
 * so the caller can fall through to interactive handling.
 */
// handleSwarmWorkerPermission：swarm worker 的权限流。worker 自己没有交互 UI——权限请求经 mailbox 转给 leader 决定，worker 挂起等回信。返回 null 让调用方回退到 interactive 处理。
async function handleSwarmWorkerPermission(
  params: SwarmWorkerPermissionParams,
): Promise<PermissionDecision | null> {
  if (!isAgentSwarmsEnabled() || !isSwarmWorker()) {
// 双门：isAgentSwarmsEnabled（全局功能开关）+ isSwarmWorker（当前身份判定）。任一不满足直接 null——不是 worker 的 agent 走主路径。
    return null
  }

  const { ctx, description, updatedInput, suggestions } = params

  // For bash commands, try classifier auto-approval before forwarding to
  // the leader. Agents await the classifier result (rather than racing it
  // against user interaction like the main agent).
// 分类器先行：bash 命令先试自动批准，省掉一次 leader 往返。
  const classifierResult = feature('BASH_CLASSIFIER')
    ? await ctx.tryClassifier?.(params.pendingClassifierCheck, updatedInput)
    : null
  if (classifierResult) {
    return classifierResult
  }
// 与主 agent 的 race 模式刻意不同：worker 没有用户可 race，只能 await 等分类器结果——主 agent 把分类器与用户操作竞速，worker 串行等待。

  // Forward permission request to the leader via mailbox
  try {
// try 块：mailbox 转发 + 等 leader 回信。
    const clearPendingRequest = (): void =>
      ctx.toolUseContext.setAppState(prev => ({
        ...prev,
        pendingWorkerRequest: null,
      }))

// new Promise 包住整个「等 leader」过程。
    const decision = await new Promise<PermissionDecision>(resolve => {
      const { resolve: resolveOnce, claim } = createResolveOnce(resolve)

      // Create the permission request
      const request = createPermissionRequest({
        toolName: ctx.tool.name,
        toolUseId: ctx.toolUseID,
        input: ctx.input,
        description,
        permissionSuggestions: suggestions,
      })
// createPermissionRequest 组装请求体：工具名、toolUseId、输入、描述、建议更新——leader 侧的 UI 要靠这些渲染。

// 注册先于发送——顺序是要害。
      // Register callback BEFORE sending the request to avoid race condition
      // where leader responds before callback is registered
// 先 registerPermissionCallback 再 sendPermissionRequestViaMailbox：leader 秒回时回调必须已就位，否则响应丢了 worker 永远挂起。经典 race 修复模式，注释原文写得很直白。
      registerPermissionCallback({
        requestId: request.id,
        toolUseId: ctx.toolUseID,
// onAllow：leader 批准。
        async onAllow(
          allowedInput: Record<string, unknown> | undefined,
          permissionUpdates: PermissionUpdate[],
          feedback?: string,
          contentBlocks?: ContentBlockParam[],
        ) {
          if (!claim()) return // atomic check-and-mark before await
          clearPendingRequest()

          // Merge the updated input with the original input
          const finalInput =
            allowedInput && Object.keys(allowedInput).length > 0
              ? allowedInput
              : ctx.input

          resolveOnce(
            await ctx.handleUserAllow(
              finalInput,
              permissionUpdates,
              feedback,
              undefined,
              contentBlocks,
            ),
          )
// 输入合并：leader 回了非空 allowedInput 才用它，否则保留 ctx.input——leader 可能只批准不改内容。handleUserAllow 照常走落盘与遥测。
        },
// onReject：leader 拒绝。
        onReject(feedback?: string, contentBlocks?: ContentBlockParam[]) {
          if (!claim()) return
          clearPendingRequest()

          ctx.logDecision({
            decision: 'reject',
            source: { type: 'user_reject', hasFeedback: !!feedback },
          })

          resolveOnce(ctx.cancelAndAbort(feedback, undefined, contentBlocks))
        },
// 拒绝同样落遥测（user_reject 源）后 cancelAndAbort。claim() 保证与 abort 分支互斥。
      })

      // Now that callback is registered, send the request to the leader
      void sendPermissionRequestViaMailbox(request)

      // Show visual indicator that we're waiting for leader approval
// pendingWorkerRequest：等 leader 期间的视觉指示。
      ctx.toolUseContext.setAppState(prev => ({
        ...prev,
        pendingWorkerRequest: {
          toolName: ctx.tool.name,
          toolUseId: ctx.toolUseID,
          description,
        },
      }))
// 发送之后才置指示器——worker 的 TUI 显示「等 leader 批准中」，请求失败（catch 分支）则清掉回退本地。

// abort 监听：等 leader 期间会话被中止。
      // If the abort signal fires while waiting for the leader response,
      // resolve the promise with a cancel decision so it does not hang.
      ctx.toolUseContext.abortController.signal.addEventListener(
        'abort',
        () => {
          if (!claim()) return
          clearPendingRequest()
          ctx.logCancelled()
          resolveOnce(ctx.cancelAndAbort(undefined, true))
        },
        { once: true },
      )
// abort 时 resolve cancelAndAbort——leader 那边已经没人受理这个请求，worker 的 Promise 不主动解决就永远挂起，整个 agent 卡死。这是防挂起的保底分支。
    })

    return decision
// catch：mailbox 提交失败（连接断等）不吞错——记 logError 后返回 null，调用方回退本地 UI 处理。
  } catch (error) {
    // If swarm permission submission fails, fall back to local handling
    logError(toError(error))
    // Continue to local UI handling below
    return null
  }
}

export { handleSwarmWorkerPermission }
export type { SwarmWorkerPermissionParams }
