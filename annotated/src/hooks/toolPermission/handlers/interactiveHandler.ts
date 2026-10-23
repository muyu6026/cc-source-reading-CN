import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import { logForDebugging } from 'src/utils/debug.js'
import { getAllowedChannels } from '../../../bootstrap/state.js'
import type { BridgePermissionCallbacks } from '../../../bridge/bridgePermissionCallbacks.js'
import { getTerminalFocused } from '../../../ink/terminal-focus-state.js'
import {
  CHANNEL_PERMISSION_REQUEST_METHOD,
  type ChannelPermissionRequestParams,
  findChannelEntry,
} from '../../../services/mcp/channelNotification.js'
import type { ChannelPermissionCallbacks } from '../../../services/mcp/channelPermissions.js'
import {
  filterPermissionRelayClients,
  shortRequestId,
  truncateForPreview,
} from '../../../services/mcp/channelPermissions.js'
import { executeAsyncClassifierCheck } from '../../../tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '../../../tools/BashTool/toolName.js'
import {
  clearClassifierChecking,
  setClassifierApproval,
  setClassifierChecking,
  setYoloClassifierApproval,
} from '../../../utils/classifierApprovals.js'
import { errorMessage } from '../../../utils/errors.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import { hasPermissionsToUseTool } from '../../../utils/permissions/permissions.js'
import type { PermissionContext } from '../PermissionContext.js'
import { createResolveOnce } from '../PermissionContext.js'

type InteractivePermissionParams = {
  ctx: PermissionContext
  description: string
  result: PermissionDecision & { behavior: 'ask' }
  awaitAutomatedChecksBeforeDialog: boolean | undefined
  bridgeCallbacks?: BridgePermissionCallbacks
  channelCallbacks?: ChannelPermissionCallbacks
}

/**
 * Handles the interactive (main-agent) permission flow.
 *
 * Pushes a ToolUseConfirm entry to the confirm queue with callbacks:
 * onAbort, onAllow, onReject, recheckPermission, onUserInteraction.
 *
 * Runs permission hooks and bash classifier checks asynchronously in the
 * background, racing them against user interaction. Uses a resolve-once
 * guard and `userInteracted` flag to prevent multiple resolutions.
 *
 * This function does NOT return a Promise -- it sets up callbacks that
 * eventually call `resolve()` to resolve the outer promise owned by
 * the caller.
 */
// handleInteractivePermission：主 agent 的交互式权限流，本目录的核心。本函数不返回 Promise——它往确认队列挂一个带回调的条目，最终由某个回调 resolve 调用方持有的外层 Promise。这句话是理解全文的钥匙：后面所有分支都是「谁先到谁赢」的竞速。
function handleInteractivePermission(
  params: InteractivePermissionParams,
  resolve: (decision: PermissionDecision) => void,
): void {
  const {
    ctx,
    description,
    result,
    awaitAutomatedChecksBeforeDialog,
    bridgeCallbacks,
    channelCallbacks,
  } = params

  const { resolve: resolveOnce, isResolved, claim } = createResolveOnce(resolve)
// 闭包顶层提升的竞速状态：resolveOnce/isResolved/claim 三件套 + userInteracted + checkmark 计时器与 abort 处理器 + bridgeRequestId + channelUnsubscribe。四个 race 方（本地用户 / CCR bridge / channel 中继 / hook / classifier）都要能互相取消，所以取消原语必须共享在闭包顶层。
  let userInteracted = false
  let checkmarkTransitionTimer: ReturnType<typeof setTimeout> | undefined
  // Hoisted so onDismissCheckmark (Esc during checkmark window) can also
  // remove the abort listener — not just the timer callback.
  let checkmarkAbortHandler: (() => void) | undefined
  const bridgeRequestId = bridgeCallbacks ? randomUUID() : undefined
  // Hoisted so local/hook/classifier wins can remove the pending channel
  // entry. No "tell remote to dismiss" equivalent — the text sits in your
  // phone, and a stale "yes abc123" after local-resolve falls through
  // tryConsumeReply (entry gone) and gets enqueued as normal chat.
  let channelUnsubscribe: (() => void) | undefined

  const permissionPromptStartTimeMs = Date.now()
// permissionPromptStartTimeMs 在推队列前打表——遥测里「用户等了多久」从这一刻起算。displayInput 用 result.updatedInput ?? ctx.input：规则匹配阶段可能已经改写过输入，对话框要显示最终版。
  const displayInput = result.updatedInput ?? ctx.input

// clearClassifierIndicator：分类器指示灯的 UI 收尾。
  function clearClassifierIndicator(): void {
    if (feature('BASH_CLASSIFIER')) {
      ctx.updateQueueItem({ classifierCheckInProgress: false })
    }
  }

// pushToQueue：把权限请求推进确认队列，对话框出现。
  ctx.pushToQueue({
    assistantMessage: ctx.assistantMessage,
    tool: ctx.tool,
    description,
    input: displayInput,
    toolUseContext: ctx.toolUseContext,
    toolUseID: ctx.toolUseID,
    permissionResult: result,
    permissionPromptStartTimeMs,
    ...(feature('BASH_CLASSIFIER')
      ? {
          classifierCheckInProgress:
            !!result.pendingClassifierCheck &&
            !awaitAutomatedChecksBeforeDialog,
        }
      : {}),
// 初始态只有「不等待自动化检查」模式才预置 classifierCheckInProgress=true——coordinator 路径会先 await 分类器，对话框出现时结果已经出来了，不需要指示灯。
// onUserInteraction：用户开始操作对话框（方向键/tab/输反馈）时触发。
    onUserInteraction() {
      // Called when user starts interacting with the permission dialog
      // (e.g., arrow keys, tab, typing feedback)
      // Hide the classifier indicator since auto-approve is no longer possible
      //
      // Grace period: ignore interactions in the first 200ms to prevent
      // accidental keypresses from canceling the classifier prematurely
      const GRACE_PERIOD_MS = 200
      if (Date.now() - permissionPromptStartTimeMs < GRACE_PERIOD_MS) {
        return
      }
      userInteracted = true
      clearClassifierChecking(ctx.toolUseID)
      clearClassifierIndicator()
    },
// 200ms 宽限期防手抖：开局误触的按键不该提前掐掉分类器（分类器可能下一秒就自动放行）。交互即清分类器状态——用户一碰，自动批准就不再可能。
// onDismissCheckmark：Esc 早退自动批准的 ✓ 过渡动画。
    onDismissCheckmark() {
      if (checkmarkTransitionTimer) {
        clearTimeout(checkmarkTransitionTimer)
        checkmarkTransitionTimer = undefined
        if (checkmarkAbortHandler) {
          ctx.toolUseContext.abortController.signal.removeEventListener(
            'abort',
            checkmarkAbortHandler,
          )
          checkmarkAbortHandler = undefined
        }
        ctx.removeFromQueue()
      }
    },
// checkmarkAbortHandler 提升到闭包顶层就是为了这里也能摘掉 abort 监听——只清 timer 不摘监听会留死闭包。
// onAbort / onAllow / onReject：三个用户侧终局回调。
    onAbort() {
      if (!claim()) return
      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.sendResponse(bridgeRequestId, {
          behavior: 'deny',
          message: 'User aborted',
        })
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()
      ctx.logCancelled()
      ctx.logDecision(
        { decision: 'reject', source: { type: 'user_abort' } },
        { permissionPromptStartTimeMs },
      )
      resolveOnce(ctx.cancelAndAbort(undefined, true))
    },
// 三个回调都以 claim() 开头（原子 check-and-mark，关掉 await 前的竞态窗）。bridge 侧要 sendResponse + cancelRequest 双通知——网页 UI 上的旧对话框必须撤掉，否则用户会在 claude.ai 上对一个已经执行完的工具做决定。
    async onAllow(
      updatedInput,
      permissionUpdates: PermissionUpdate[],
      feedback?: string,
      contentBlocks?: ContentBlockParam[],
    ) {
      if (!claim()) return // atomic check-and-mark before await

      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.sendResponse(bridgeRequestId, {
          behavior: 'allow',
          updatedInput,
          updatedPermissions: permissionUpdates,
        })
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()

      resolveOnce(
        await ctx.handleUserAllow(
          updatedInput,
          permissionUpdates,
          feedback,
          permissionPromptStartTimeMs,
          contentBlocks,
          result.decisionReason,
        ),
      )
    },
    onReject(feedback?: string, contentBlocks?: ContentBlockParam[]) {
      if (!claim()) return

      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.sendResponse(bridgeRequestId, {
          behavior: 'deny',
          message: feedback ?? 'User denied permission',
        })
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()

      ctx.logDecision(
        {
          decision: 'reject',
          source: { type: 'user_reject', hasFeedback: !!feedback },
        },
        { permissionPromptStartTimeMs },
      )
      resolveOnce(ctx.cancelAndAbort(feedback, undefined, contentBlocks))
    },
// recheckPermission：规则可能变了（用户在别处改了权限设置、CCR 模式切换），弹窗期间重查一次。
    async recheckPermission() {
      if (isResolved()) return
      const freshResult = await hasPermissionsToUseTool(
        ctx.tool,
        ctx.input,
        ctx.toolUseContext,
        ctx.assistantMessage,
        ctx.toolUseID,
      )
      if (freshResult.behavior === 'allow') {
        // claim() (atomic check-and-mark), not isResolved() — the async
        // hasPermissionsToUseTool call above opens a window where CCR
        // could have responded in flight. Matches onAllow/onReject/hook
        // paths. cancelRequest tells CCR to dismiss its prompt — without
        // it, the web UI shows a stale prompt for a tool that's already
        // executing (particularly visible when recheck is triggered by
        // a CCR-initiated mode switch, the very case this callback exists
        // for after useReplBridge started calling it).
        if (!claim()) return
        if (bridgeCallbacks && bridgeRequestId) {
          bridgeCallbacks.cancelRequest(bridgeRequestId)
        }
        channelUnsubscribe?.()
        ctx.removeFromQueue()
        ctx.logDecision({ decision: 'accept', source: 'config' })
        resolveOnce(ctx.buildAllow(freshResult.updatedInput ?? ctx.input))
      }
    },
// 重查后必须用 claim() 而不是 isResolved()：await hasPermissionsToUseTool 期间 CCR 可能已经在飞行中应答——这个窗口里 isResolved() 还是 false，两个分支都会通过检查。cancelRequest 通知 CCR 撤提示，否则网页 UI 留着陈旧对话框对着一个已经在执行的工具。此回调的存在理由就是 useReplBridge 的 CCR 模式切换。
  })

  // Race 4: Bridge permission response from CCR (claude.ai)
  // When the bridge is connected, send the permission request to CCR and
  // subscribe for a response. Whichever side (CLI or CCR) responds first
  // wins via claim().
  //
  // All tools are forwarded — CCR's generic allow/deny modal handles any
  // tool, and can return `updatedInput` when it has a dedicated renderer
  // (e.g. plan edit). Tools whose local dialog injects fields (ReviewArtifact
  // `selected`, AskUserQuestion `answers`) tolerate the field being missing
  // so generic remote approval degrades gracefully instead of throwing.
// 所有工具都转发给 CCR：通用 allow/deny 模态框能处理任何工具，有专用渲染器的还能回 updatedInput（如 plan edit）。本地对话框会注入字段的工具（ReviewArtifact 的 selected、AskUserQuestion 的 answers）容忍字段缺失——远程批准降级工作而不是抛错。
// Race：CCR bridge（claude.ai 远程批准）。
  if (bridgeCallbacks && bridgeRequestId) {
    bridgeCallbacks.sendRequest(
      bridgeRequestId,
      ctx.tool.name,
      displayInput,
      ctx.toolUseID,
      description,
      result.suggestions,
      result.blockedPath,
    )

    const signal = ctx.toolUseContext.abortController.signal
    const unsubscribe = bridgeCallbacks.onResponse(
      bridgeRequestId,
      response => {
        if (!claim()) return // Local user/hook/classifier already responded
        signal.removeEventListener('abort', unsubscribe)
        clearClassifierChecking(ctx.toolUseID)
        clearClassifierIndicator()
        ctx.removeFromQueue()
        channelUnsubscribe?.()

        if (response.behavior === 'allow') {
          if (response.updatedPermissions?.length) {
            void ctx.persistPermissions(response.updatedPermissions)
          }
          ctx.logDecision(
            {
              decision: 'accept',
              source: {
                type: 'user',
                permanent: !!response.updatedPermissions?.length,
              },
            },
            { permissionPromptStartTimeMs },
          )
          resolveOnce(ctx.buildAllow(response.updatedInput ?? displayInput))
        } else {
          ctx.logDecision(
            {
              decision: 'reject',
              source: {
                type: 'user_reject',
                hasFeedback: !!response.message,
              },
            },
            { permissionPromptStartTimeMs },
          )
          resolveOnce(ctx.cancelAndAbort(response.message))
        }
      },
    )

    signal.addEventListener('abort', unsubscribe, { once: true })
  }
// bridge 块收尾：signal.addEventListener('abort', unsubscribe, { once: true })——abort 时退订，防泄漏。

// Race：channel 中继（Telegram/iMessage 等远程回复）。与 bridge 块并行竞速。
  // Channel permission relay — races alongside the bridge block above. Send a
  // permission prompt to every active channel (Telegram, iMessage, etc.) via
  // its MCP send_message tool, then race the reply against local/bridge/hook/
  // classifier. The inbound "yes abc123" is intercepted in the notification
  // handler (useManageMCPConnections.ts) BEFORE enqueue, so it never reaches
  // Claude as a conversation turn.
  //
  // Unlike the bridge block, this still guards on `requiresUserInteraction` —
  // channel replies are pure yes/no with no `updatedInput` path. In practice
  // the guard is dead code today: all three `requiresUserInteraction` tools
  // (ExitPlanMode, AskUserQuestion, ReviewArtifact) return `isEnabled()===false`
  // when channels are configured, so they never reach this handler.
  //
  // Fire-and-forget send: if callTool fails (channel down, tool missing),
  // the subscription never fires and another racer wins. Graceful degradation
  // — the local dialog is always there as the floor.
// 三个设计点：① requiresUserInteraction 守卫今天是死代码——三个需要交互的工具（ExitPlanMode/AskUserQuestion/ReviewArtifact）在配置了 channel 时 isEnabled() 返回 false，根本到不了这个 handler；② fire-and-forget 发送：channel 挂了订阅不会触发，别的 race 兜底，本地对话框永远是地板；③ 入站 yes/no 在 useManageMCPConnections 的 notification handler 里拦截，不会变成一轮对话。
// channel 门：feature(KAIROS/KAIROS_CHANNELS) + channelCallbacks + 非交互工具。
  if (
    (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
    channelCallbacks &&
    !ctx.tool.requiresUserInteraction?.()
  ) {
    const channelRequestId = shortRequestId(ctx.toolUseID)
    const allowedChannels = getAllowedChannels()
    const channelClients = filterPermissionRelayClients(
      ctx.toolUseContext.getAppState().mcp.clients,
      name => findChannelEntry(name, allowedChannels) !== undefined,
    )

    if (channelClients.length > 0) {
// filterPermissionRelayClients 按 getAllowedChannels() 过滤——用户配置允许哪些 channel 才转发，不是连着就转。
      // Outbound is structured too (Kenneth's symmetry ask) — server owns
      // message formatting for its platform (Telegram markdown, iMessage
      // rich text, Discord embed). CC sends the RAW parts; server composes.
      // The old callTool('send_message', {text,content,message}) triple-key
      // hack is gone — no more guessing which arg name each plugin takes.
// 出站也是结构化载荷（注释里的 Kenneth's symmetry ask）：服务端拥有各平台的格式化（Telegram markdown、iMessage rich text、Discord embed），CC 只发 RAW parts。旧的 callTool('send_message', {text,content,message}) 三键猜测 hack 已删除——不用再猜每个插件吃哪个参数名。
      const params: ChannelPermissionRequestParams = {
        request_id: channelRequestId,
        tool_name: ctx.tool.name,
        description,
        input_preview: truncateForPreview(displayInput),
      }

// 逐个客户端发 MCP notification（不是 callTool）——permission request 是单向通知，不等响应；失败只记 debug 日志不外抛。
      for (const client of channelClients) {
        if (client.type !== 'connected') continue // refine for TS
        void client.client
          .notification({
            method: CHANNEL_PERMISSION_REQUEST_METHOD,
            params,
          })
          .catch(e => {
            logForDebugging(
              `Channel permission_request failed for ${client.name}: ${errorMessage(e)}`,
              { level: 'error' },
            )
          })
      }

      const channelSignal = ctx.toolUseContext.abortController.signal
      // Wrap so BOTH the map delete AND the abort-listener teardown happen
      // at every call site. The 6 channelUnsubscribe?.() sites after local/
      // hook/classifier wins previously only deleted the map entry — the
      // dead closure stayed registered on the session-scoped abort signal
      // until the session ended. Not a functional bug (Map.delete is
      // idempotent), but it held the closure alive.
// 注释说明的改进：6 个 channelUnsubscribe?.() 调用点以前只删 Map 条目，死闭包还挂在 session 级的 abort signal 上直到会话结束。不是功能 bug（delete 幂等），但白白吊住闭包——改成包装函数后两个清理都做。
// channelUnsubscribe 包装双清理：Map.delete + abort 监听移除。
      const mapUnsub = channelCallbacks.onResponse(
        channelRequestId,
        response => {
          if (!claim()) return // Another racer won
          channelUnsubscribe?.() // both: map delete + listener remove
          clearClassifierChecking(ctx.toolUseID)
          clearClassifierIndicator()
          ctx.removeFromQueue()
          // Bridge is the other remote — tell it we're done.
          if (bridgeCallbacks && bridgeRequestId) {
            bridgeCallbacks.cancelRequest(bridgeRequestId)
          }

          if (response.behavior === 'allow') {
            ctx.logDecision(
              {
                decision: 'accept',
                source: { type: 'user', permanent: false },
              },
              { permissionPromptStartTimeMs },
            )
            resolveOnce(ctx.buildAllow(displayInput))
          } else {
            ctx.logDecision(
              {
                decision: 'reject',
                source: { type: 'user_reject', hasFeedback: false },
              },
              { permissionPromptStartTimeMs },
            )
            resolveOnce(
              ctx.cancelAndAbort(`Denied via channel ${response.fromServer}`),
            )
          }
        },
      )
// channel 的 allow 记 permanent: false——手机上的 yes/no 没有「永久允许」这个选项，只有一次性批准。deny 消息带 fromServer 标识来源。
      channelUnsubscribe = () => {
        mapUnsub()
        channelSignal.removeEventListener('abort', channelUnsubscribe!)
      }

      channelSignal.addEventListener('abort', channelUnsubscribe, {
        once: true,
      })
    }
  }

// Race：PermissionRequest 钩子（异步执行）。
  // Skip hooks if they were already awaited in the coordinator branch above
  if (!awaitAutomatedChecksBeforeDialog) {
    // Execute PermissionRequest hooks asynchronously
    // If hook returns a decision before user responds, apply it
    void (async () => {
      if (isResolved()) return
      const currentAppState = ctx.toolUseContext.getAppState()
      const hookDecision = await ctx.runHooks(
        currentAppState.toolPermissionContext.mode,
        result.suggestions,
        result.updatedInput,
        permissionPromptStartTimeMs,
      )
      if (!hookDecision || !claim()) return
      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()
      ctx.removeFromQueue()
      resolveOnce(hookDecision)
    })()
  }
// awaitAutomatedChecksBeforeDialog 为真时整块跳过——coordinator 路径已经 await 过钩子了，不重复执行。两个 handler 靠这个布尔参数隐式协作。

// Race：bash 分类器（仅 Bash 工具 + 有待查项时）。
  // Execute bash classifier check asynchronously (if applicable)
  if (
    feature('BASH_CLASSIFIER') &&
    result.pendingClassifierCheck &&
    ctx.tool.name === BASH_TOOL_NAME &&
    !awaitAutomatedChecksBeforeDialog
// UI 指示灯放在这里而不是 toolExecution.ts：前缀规则自动放行的命令不会闪一下指示灯才返回 allow——竞速里 UI 状态由最终赢家设置，不由入口设置。
  ) {
    // UI indicator for "classifier running" — set here (not in
    // toolExecution.ts) so commands that auto-allow via prefix rules
    // don't flash the indicator for a split second before allow returns.
    setClassifierChecking(ctx.toolUseID)
// executeAsyncClassifierCheck：带 shouldContinue 谓词的异步分类器检查。
    void executeAsyncClassifierCheck(
      result.pendingClassifierCheck,
      ctx.toolUseContext.abortController.signal,
      ctx.toolUseContext.options.isNonInteractiveSession,
      {
        shouldContinue: () => !isResolved() && !userInteracted,
        onComplete: () => {
          clearClassifierChecking(ctx.toolUseID)
          clearClassifierIndicator()
        },
        onAllow: decisionReason => {
          if (!claim()) return
          if (bridgeCallbacks && bridgeRequestId) {
            bridgeCallbacks.cancelRequest(bridgeRequestId)
          }
          channelUnsubscribe?.()
          clearClassifierChecking(ctx.toolUseID)

          const matchedRule =
            decisionReason.type === 'classifier'
              ? (decisionReason.reason.match(
                  /^Allowed by prompt rule: "(.+)"$/,
                )?.[1] ?? decisionReason.reason)
              : undefined

          // Show auto-approved transition with dimmed options
          if (feature('TRANSCRIPT_CLASSIFIER')) {
            ctx.updateQueueItem({
              classifierCheckInProgress: false,
              classifierAutoApproved: true,
              classifierMatchedRule: matchedRule,
            })
          }

          if (
            feature('TRANSCRIPT_CLASSIFIER') &&
            decisionReason.type === 'classifier'
          ) {
            if (decisionReason.classifier === 'auto-mode') {
              setYoloClassifierApproval(ctx.toolUseID, decisionReason.reason)
            } else if (matchedRule) {
              setClassifierApproval(ctx.toolUseID, matchedRule)
            }
          }

          ctx.logDecision(
            { decision: 'accept', source: { type: 'classifier' } },
            { permissionPromptStartTimeMs },
          )
          resolveOnce(ctx.buildAllow(ctx.input, { decisionReason }))

          // Keep checkmark visible, then remove dialog.
          // 3s if terminal is focused (user can see it), 1s if not.
          // User can dismiss early with Esc via onDismissCheckmark.
          const signal = ctx.toolUseContext.abortController.signal
          checkmarkAbortHandler = () => {
            if (checkmarkTransitionTimer) {
              clearTimeout(checkmarkTransitionTimer)
              checkmarkTransitionTimer = undefined
              // Sibling Bash error can fire this (StreamingToolExecutor
              // cascades via siblingAbortController) — must drop the
              // cosmetic ✓ dialog or it blocks the next queued item.
              ctx.removeFromQueue()
            }
          }
          const checkmarkMs = getTerminalFocused() ? 3000 : 1000
          checkmarkTransitionTimer = setTimeout(() => {
            checkmarkTransitionTimer = undefined
            if (checkmarkAbortHandler) {
              signal.removeEventListener('abort', checkmarkAbortHandler)
              checkmarkAbortHandler = undefined
            }
            ctx.removeFromQueue()
          }, checkmarkMs)
          signal.addEventListener('abort', checkmarkAbortHandler, {
            once: true,
          })
        },
      },
// 分类器赢家的完整 UI 编排：matchedRule 双来源（auto-mode 的 yolo 批准与 prompt rule 批准分别存）；TRANSCRIPT_CLASSIFIER 下更新队列项显示「自动批准 + 命中的规则」；checkmark 停留 3s（终端聚焦，用户能看见）/1s（不聚焦），Esc 可早退；checkmarkAbortHandler 处理 sibling abort 级联——StreamingToolExecutor 的 siblingAbortController 也会触发 abort，cosmetic ✓ 不撤会挡住队列里下一项。
    ).catch(error => {
// catch：分类器 API 错误（网络失败/限流/模型问题）只记日志，绝不当作用户取消传播——这两种失败在遥测里必须是两种形状。
      // Log classifier API errors for debugging but don't propagate them as interruptions
      // These errors can be network failures, rate limits, or model issues - not user cancellations
      logForDebugging(`Async classifier check failed: ${errorMessage(error)}`, {
        level: 'error',
      })
    })
  }
}

// --

export { handleInteractivePermission }
export type { InteractivePermissionParams }
