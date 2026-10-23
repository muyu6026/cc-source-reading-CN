import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type {
  ToolPermissionContext,
  Tool as ToolType,
  ToolUseContext,
} from '../../Tool.js'
import { awaitClassifierAutoApproval } from '../../tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type { AssistantMessage } from '../../types/message.js'
import type {
  PendingClassifierCheck,
  PermissionAllowDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
} from '../../types/permissions.js'
import { setClassifierApproval } from '../../utils/classifierApprovals.js'
import { logForDebugging } from '../../utils/debug.js'
import { executePermissionRequestHooks } from '../../utils/hooks.js'
import {
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  withMemoryCorrectionHint,
} from '../../utils/messages.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
  supportsPersistence,
} from '../../utils/permissions/PermissionUpdate.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import {
  logPermissionDecision,
  type PermissionDecisionArgs,
} from './permissionLogging.js'

// 文件定位：权限决策的「上下文工厂」。两种来源判别联合（批准三源 hook/user/classifier，拒绝三源 hook/user_abort/user_reject）；队列操作接口刻意与 React 解耦——接口本身不认识 setState，REPL 里才由 React state 当后端；以及本文件最重要的原语 createResolveOnce。
type PermissionApprovalSource =
  | { type: 'hook'; permanent?: boolean }
  | { type: 'user'; permanent: boolean }
  | { type: 'classifier' }

type PermissionRejectionSource =
  | { type: 'hook' }
  | { type: 'user_abort' }
  | { type: 'user_reject'; hasFeedback: boolean }

// Generic interface for permission queue operations, decoupled from React.
// In the REPL, these are backed by React state.
type PermissionQueueOps = {
  push(item: ToolUseConfirm): void
  remove(toolUseID: string): void
  update(toolUseID: string, patch: Partial<ToolUseConfirm>): void
// 队列三操作（push/remove/update）正好覆盖权限对话框的整个生命周期：进入队列 → 用户操作后出队 → 自动批准时改字段（指示灯/勾态）。
}

type ResolveOnce<T> = {
  resolve(value: T): void
  isResolved(): boolean
  /**
   * Atomically check-and-mark as resolved. Returns true if this caller
   * won the race (nobody else has resolved yet), false otherwise.
   * Use this in async callbacks BEFORE awaiting, to close the window
   * between the `isResolved()` check and the actual `resolve()` call.
   */
  claim(): boolean
}
// ResolveOnce 的契约重点在 claim()：原子 check-and-mark。异步回调里必须先 claim 再 await，否则 isResolved() 检查与 resolve() 调用之间存在窗口，两个 race 分支可能都通过检查（详见 interactiveHandler 的注释）。

// createResolveOnce：把调用方给出的 resolve 包一层幂等锁。
function createResolveOnce<T>(resolve: (value: T) => void): ResolveOnce<T> {
  let claimed = false
  let delivered = false
  return {
    resolve(value: T) {
      if (delivered) return
      delivered = true
      claimed = true
      resolve(value)
    },
    isResolved() {
      return claimed
    },
    claim() {
      if (claimed) return false
      claimed = true
      return true
    },
  }
}
// 实现是两态分离：delivered（值送没送）与 claimed（有没有人认领过）。resolve 幂等且送达即置认领；claim 只标记不送达。isResolved() 报的是「有没有人认领」而不是「值送达了没有」——recheck 路径正是靠这个区别判断「曾经有人应答过但还在飞行中」。

// createPermissionContext：11 个参数组装出一次工具调用的权限上下文，返回冻结对象（末尾 Object.freeze，handler 解析后不能再往上贴字段）。
function createPermissionContext(
  tool: ToolType,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  setToolPermissionContext: (context: ToolPermissionContext) => void,
  queueOps?: PermissionQueueOps,
) {
  const messageId = assistantMessage.message.id
// messageId 从 assistantMessage 里取而不是当参数传——调用方少一个能传错的入口。
  const ctx = {
// ctx 是个大对象字面量，方法之间用 this 互调（runHooks 里调 this.handleHookAllow）。
    tool,
    input,
    toolUseContext,
    assistantMessage,
    messageId,
    toolUseID,
// logDecision：权限决策遥测的统一出口，转交 permissionLogging 的 logPermissionDecision。opts.input 允许覆盖 input——用户可能改写过输入，遥测要记最终版。
    logDecision(
      args: PermissionDecisionArgs,
      opts?: {
        input?: Record<string, unknown>
        permissionPromptStartTimeMs?: number
      },
    ) {
      logPermissionDecision(
        {
          tool,
          input: opts?.input ?? input,
          toolUseContext,
          messageId,
          toolUseID,
        },
        args,
        opts?.permissionPromptStartTimeMs,
      )
    },
// logCancelled：取消是独立事件（tengu_tool_use_cancelled），不计入 reject 漏斗。
    logCancelled() {
      logEvent('tengu_tool_use_cancelled', {
        messageID:
          messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
      })
    },
// persistPermissions：把「允许且记住」类更新写盘并应用到 appState。
    async persistPermissions(updates: PermissionUpdate[]) {
      if (updates.length === 0) return false
      persistPermissionUpdates(updates)
      const appState = toolUseContext.getAppState()
      setToolPermissionContext(
        applyPermissionUpdates(appState.toolPermissionContext, updates),
      )
      return updates.some(update => supportsPersistence(update.destination))
    },
// 空数组直接短路（大多数交互根本不产生更新）；返回值是「本次批准里有没有需要落盘的项」——调用方用它决定遥测里的 permanent 字段。
// resolveIfAborted：中止优先检查。
    resolveIfAborted(resolve: (decision: PermissionDecision) => void) {
      if (!toolUseContext.abortController.signal.aborted) return false
      this.logCancelled()
      resolve(this.cancelAndAbort(undefined, true))
      return true
    },
// abort 信号已打就直接取消返回，不再问用户——顺序不能反，否则用户刚批完会话已经没了。
// cancelAndAbort：构造拒绝/取消决策，是五个终局回调的共同归宿。
    cancelAndAbort(
      feedback?: string,
      isAbort?: boolean,
      contentBlocks?: ContentBlockParam[],
    ): PermissionDecision {
      const sub = !!toolUseContext.agentId
      const baseMessage = feedback
        ? `${sub ? SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX : REJECT_MESSAGE_WITH_REASON_PREFIX}${feedback}`
        : sub
          ? SUBAGENT_REJECT_MESSAGE
          : REJECT_MESSAGE
      const message = sub ? baseMessage : withMemoryCorrectionHint(baseMessage)
      if (isAbort || (!feedback && !contentBlocks?.length && !sub)) {
        logForDebugging(
          `Aborting: tool=${tool.name} isAbort=${isAbort} hasFeedback=${!!feedback} isSubagent=${sub}`,
        )
        toolUseContext.abortController.abort()
      }
      return { behavior: 'ask', message, contentBlocks }
    },
// 消息三形态：subagent 用 SUBAGENT_ 前缀（不含记忆提示——子代理的记忆纠正没有意义）；主 agent 套 withMemoryCorrectionHint，让模型把这次拒绝记进上下文下次别犯。abort 触发条件是个精心设计的布尔：isAbort，或「无反馈、无内容块、且非 subagent」——子代理里拒绝一条命令不该炸掉整个会话。
// tryClassifier：整组方法被 feature('BASH_CLASSIFIER') 条件展开包着。
    ...(feature('BASH_CLASSIFIER')
      ? {
          async tryClassifier(
            pendingClassifierCheck: PendingClassifierCheck | undefined,
            updatedInput: Record<string, unknown> | undefined,
          ): Promise<PermissionDecision | null> {
            if (tool.name !== BASH_TOOL_NAME || !pendingClassifierCheck) {
              return null
            }
            const classifierDecision = await awaitClassifierAutoApproval(
              pendingClassifierCheck,
              toolUseContext.abortController.signal,
              toolUseContext.options.isNonInteractiveSession,
            )
            if (!classifierDecision) {
              return null
            }
            if (
              feature('TRANSCRIPT_CLASSIFIER') &&
              classifierDecision.type === 'classifier'
            ) {
              const matchedRule = classifierDecision.reason.match(
                /^Allowed by prompt rule: "(.+)"$/,
              )?.[1]
              if (matchedRule) {
                setClassifierApproval(toolUseID, matchedRule)
              }
            }
            logPermissionDecision(
              { tool, input, toolUseContext, messageId, toolUseID },
              { decision: 'accept', source: { type: 'classifier' } },
              undefined,
            )
            return {
              behavior: 'allow' as const,
              updatedInput: updatedInput ?? input,
              userModified: false,
              decisionReason: classifierDecision,
            }
          },
        }
      : {}),
// feature 关闭时对象上根本没有 tryClassifier 键（展开空对象），调用方只能写 ctx.tryClassifier?.() 可选链。TRANSCRIPT_CLASSIFIER 开启时从 reason 里用正则抠出 matchedRule 存进 classifierApprovals——UI 要显示「被哪条 prompt 规则放行」。
// runHooks：执行 PermissionRequest 生命周期钩子。
    async runHooks(
      permissionMode: string | undefined,
      suggestions: PermissionUpdate[] | undefined,
      updatedInput?: Record<string, unknown>,
      permissionPromptStartTimeMs?: number,
    ): Promise<PermissionDecision | null> {
      for await (const hookResult of executePermissionRequestHooks(
        tool.name,
        toolUseID,
        input,
        toolUseContext,
        permissionMode,
        suggestions,
        toolUseContext.abortController.signal,
      )) {
        if (hookResult.permissionRequestResult) {
          const decision = hookResult.permissionRequestResult
          if (decision.behavior === 'allow') {
            const finalInput = decision.updatedInput ?? updatedInput ?? input
            return await this.handleHookAllow(
              finalInput,
              decision.updatedPermissions ?? [],
              permissionPromptStartTimeMs,
            )
          } else if (decision.behavior === 'deny') {
            this.logDecision(
              { decision: 'reject', source: { type: 'hook' } },
              { permissionPromptStartTimeMs },
            )
            if (decision.interrupt) {
              logForDebugging(
                `Hook interrupt: tool=${tool.name} hookMessage=${decision.message}`,
              )
              toolUseContext.abortController.abort()
            }
            return this.buildDeny(
              decision.message || 'Permission denied by hook',
              {
                type: 'hook',
                hookName: 'PermissionRequest',
                reason: decision.message,
              },
            )
          }
        }
      }
      return null
    },
// for await 逐条消费 hook 产出。allow 走 handleHookAllow（含落盘）；deny 只有 interrupt 为真才 abort——默认拒绝只是拒绝这一条，不打断会话，这是钩子作者最容易踩的语义。
// buildAllow / buildDeny：决策对象的两个构造器。
    buildAllow(
      updatedInput: Record<string, unknown>,
      opts?: {
        userModified?: boolean
        decisionReason?: PermissionDecisionReason
        acceptFeedback?: string
        contentBlocks?: ContentBlockParam[]
      },
    ): PermissionAllowDecision {
      return {
        behavior: 'allow' as const,
        updatedInput,
        userModified: opts?.userModified ?? false,
        ...(opts?.decisionReason && { decisionReason: opts.decisionReason }),
        ...(opts?.acceptFeedback && { acceptFeedback: opts.acceptFeedback }),
        ...(opts?.contentBlocks &&
          opts.contentBlocks.length > 0 && {
            contentBlocks: opts.contentBlocks,
          }),
      }
    },
// buildAllow 用条件展开（...(opts?.x && {...})）而不是直接赋 undefined——保证产出的 PermissionAllowDecision 上不会出现值为 undefined 的键，下游 JSON 序列化和缓存键都干净。
    buildDeny(
      message: string,
      decisionReason: PermissionDecisionReason,
    ): PermissionDenyDecision {
      return { behavior: 'deny' as const, message, decisionReason }
    },
// handleUserAllow：用户批准的完整落地路径（落盘 + 遥测 + userModified 判定）。
    async handleUserAllow(
      updatedInput: Record<string, unknown>,
      permissionUpdates: PermissionUpdate[],
      feedback?: string,
      permissionPromptStartTimeMs?: number,
      contentBlocks?: ContentBlockParam[],
      decisionReason?: PermissionDecisionReason,
    ): Promise<PermissionAllowDecision> {
      const acceptedPermanentUpdates =
        await this.persistPermissions(permissionUpdates)
      this.logDecision(
        {
          decision: 'accept',
          source: { type: 'user', permanent: acceptedPermanentUpdates },
        },
        { input: updatedInput, permissionPromptStartTimeMs },
      )
      const userModified = tool.inputsEquivalent
        ? !tool.inputsEquivalent(input, updatedInput)
        : false
      const trimmedFeedback = feedback?.trim()
      return this.buildAllow(updatedInput, {
        userModified,
        decisionReason,
        acceptFeedback: trimmedFeedback || undefined,
        contentBlocks,
      })
    },
// userModified 靠 tool.inputsEquivalent 判定「用户有没有改过输入」——存在才比，没实现的工具默认 false（没有差分能力就不声称有）。
// handleHookAllow：钩子批准的落地路径。
    async handleHookAllow(
      finalInput: Record<string, unknown>,
      permissionUpdates: PermissionUpdate[],
      permissionPromptStartTimeMs?: number,
    ): Promise<PermissionAllowDecision> {
      const acceptedPermanentUpdates =
        await this.persistPermissions(permissionUpdates)
      this.logDecision(
        {
          decision: 'accept',
          source: { type: 'hook', permanent: acceptedPermanentUpdates },
        },
        { input: finalInput, permissionPromptStartTimeMs },
      )
      return this.buildAllow(finalInput, {
        decisionReason: { type: 'hook', hookName: 'PermissionRequest' },
      })
    },
// 与 handleUserAllow 的差别：decisionReason 固定标 hook 源；userModified 不参与——钩子批准的输入没经过用户手改。
// 队列三件套：全部可选链调用 queueOps?.。
    pushToQueue(item: ToolUseConfirm) {
      queueOps?.push(item)
    },
    removeFromQueue() {
      queueOps?.remove(toolUseID)
    },
    updateQueueItem(patch: Partial<ToolUseConfirm>) {
      queueOps?.update(toolUseID, patch)
    },
// 无 UI 环境（headless、测试）下 queueOps 为 undefined，三个方法静默变 no-op——权限上下文不依赖任何渲染层。
  }
  return Object.freeze(ctx)
}

type PermissionContext = ReturnType<typeof createPermissionContext>

/**
 * Create a PermissionQueueOps backed by a React state setter.
 * This is the bridge between React's `setToolUseConfirmQueue` and the
 * generic queue interface used by PermissionContext.
 */
// createPermissionQueueOps：把 React 的 setToolUseConfirmQueue 适配成上面的通用队列接口，注释自称是两者之间的桥。
function createPermissionQueueOps(
  setToolUseConfirmQueue: React.Dispatch<
    React.SetStateAction<ToolUseConfirm[]>
  >,
): PermissionQueueOps {
  return {
    push(item: ToolUseConfirm) {
      setToolUseConfirmQueue(queue => [...queue, item])
    },
    remove(toolUseID: string) {
      setToolUseConfirmQueue(queue =>
        queue.filter(item => item.toolUseID !== toolUseID),
      )
    },
    update(toolUseID: string, patch: Partial<ToolUseConfirm>) {
      setToolUseConfirmQueue(queue =>
        queue.map(item =>
          item.toolUseID === toolUseID ? { ...item, ...patch } : item,
        ),
      )
    },
  }
}
// 三个 setState 全是函数式更新（queue => ...）——并发 push/filter/map 不会互相覆盖，这是 React 状态桥的基本功。

export { createPermissionContext, createPermissionQueueOps, createResolveOnce }
export type {
  PermissionContext,
  PermissionApprovalSource,
  PermissionQueueOps,
  PermissionRejectionSource,
  ResolveOnce,
}
