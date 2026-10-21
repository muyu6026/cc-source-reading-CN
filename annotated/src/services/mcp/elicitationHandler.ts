import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  ElicitationCompleteNotificationSchema,
  type ElicitRequestParams,
  ElicitRequestSchema,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { AppState } from '../../state/AppState.js'
import {
  executeElicitationHooks,
  executeElicitationResultHooks,
  executeNotificationHooks,
} from '../../utils/hooks.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

/** Configuration for the waiting state shown after the user opens a URL. */
export type ElicitationWaitingState = {
  /** Button label, e.g. "Retry now" or "Skip confirmation" */
  actionLabel: string
  /** Whether to show a visible Cancel button (e.g. for error-based retry flow) */
  showCancel?: boolean
}

export type ElicitationRequestEvent = {
  serverName: string
  /** The JSON-RPC request ID, unique per server connection. */
  requestId: string | number
  params: ElicitRequestParams
  signal: AbortSignal
  /**
   * Resolves the elicitation. For explicit elicitations, all actions are
   * meaningful. For error-based retry (-32042), 'accept' is a no-op —
   * the retry is driven by onWaitingDismiss instead.
   */
  respond: (response: ElicitResult) => void
  /** For URL elicitations: shown after user opens the browser. */
  waitingState?: ElicitationWaitingState
  /** Called when phase 2 (waiting) is dismissed by user action or completion. */
  onWaitingDismiss?: (action: 'dismiss' | 'retry' | 'cancel') => void
  /** Set to true by the completion notification handler when the server confirms completion. */
  completed?: boolean
}

function getElicitationMode(params: ElicitRequestParams): 'form' | 'url' {
// mode 只分 form / url 两种，且**未知一律回落到 form**。
//
// 协议将来加第三种 mode 时，这里会把它当表单处理而不是崩。对未知输入给一个
// 保守默认，是这类「协议兼容层」的常规做法 —— 但要意识到：默认值选错方向
// （比如默认成 url）会让不认识的请求被当成「去打开个链接」。
  return params.mode === 'url' ? 'url' : 'form'
}

/** Find a queued elicitation event by server name and elicitationId. */
function findElicitationInQueue(
  queue: ElicitationRequestEvent[],
  serverName: string,
  elicitationId: string,
): number {
  return queue.findIndex(
    e =>
      e.serverName === serverName &&
      e.params.mode === 'url' &&
      'elicitationId' in e.params &&
      e.params.elicitationId === elicitationId,
  )
}

export function registerElicitationHandler(
  client: Client,
  serverName: string,
  setAppState: (f: (prevState: AppState) => AppState) => void,
): void {
  // Register the elicitation request handler.
  // Wrapped in try/catch because setRequestHandler throws if the client wasn't
  // created with elicitation capability declared.
  try {
// 这个 try/catch 包住的是**注册**，不是处理。原因写在注释里，值得展开：
//
// client 创建时如果没声明 elicitation capability，SDK 的 setRequestHandler
// 会直接抛。于是「这个 client 不支持 elicitation」在代码里表现为
// 「注册失败被吞掉」—— 调用方完全看不出区别，server 那边只会收到 method not found。
//
// 读这种 catch 时永远要问一句：吞掉之后，谁知道发生了什么？这里答案是「没人知道」。
    client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
      logMCPDebug(
        serverName,
        `Received elicitation request: ${jsonStringify(request)}`,
      )

      const mode = getElicitationMode(request.params)

      logEvent('tengu_mcp_elicitation_shown', {
        mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      try {
        // Run elicitation hooks first - they can provide a response programmatically
        const hookResponse = await runElicitationHooks(
// hooks 排在 UI **之前**：hook 能直接给出答案，于是这次审批根本不会出现在界面上。
//
// 这也是 CI / 脚本场景唯一能通过 elicitation 的办法 —— 否则会挂在对话框上
// 等一个不存在的人，整条流程僵在那里。所以这个顺序不是性能优化，是可用性前提。
          serverName,
          request.params,
          extra.signal,
        )
        if (hookResponse) {
          logMCPDebug(
            serverName,
            `Elicitation resolved by hook: ${jsonStringify(hookResponse)}`,
          )
          logEvent('tengu_mcp_elicitation_response', {
            mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            action:
              hookResponse.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return hookResponse
        }

        const elicitationId =
          mode === 'url' && 'elicitationId' in request.params
            ? (request.params.elicitationId as string | undefined)
            : undefined

        const response = new Promise<ElicitResult>(resolve => {
          const onAbort = () => {
            resolve({ action: 'cancel' })
          }
// abort 时 resolve 成 cancel，而不是 reject。
//
// 理由在协议层：MCP 那边等的是一份 ElicitResult，reject 会让整个请求变成
// 协议错误（连「用户取消了」这个信息都传不出去）。而「用户中断了」在协议里
// 最接近的语义就是 action: 'cancel'。
//
// 顺带一个通用模式：把「异常」翻译成「协议里表达得出来的那一种正常状态」，
// 几乎总比让异常穿透整条链路要好。

          if (extra.signal.aborted) {
// 先查 aborted 再挂监听，这不是防御性冗余，是必须的：
//
// AbortSignal 的 addEventListener 在 signal **已经** aborted 时不会再触发
// （除非用 { once: true } 之外的选项，也不会补发）。漏了这个前置判断，
// Promise 就永远不会 resolve —— 而它上面的 await 会把整个请求挂住。
//
// 这类「事件已经发生过」的竞态，是 AbortSignal 用得最常踩的一处。
            onAbort()
            return
          }

          const waitingState: ElicitationWaitingState | undefined =
            elicitationId ? { actionLabel: 'Skip confirmation' } : undefined

          setAppState(prev => ({
            ...prev,
            elicitation: {
              queue: [
                ...prev.elicitation.queue,
                {
                  serverName,
                  requestId: extra.requestId,
                  params: request.params,
                  signal: extra.signal,
                  waitingState,
                  respond: (result: ElicitResult) => {
// respond 里先摘掉 abort 监听、再 resolve。顺序看着无关紧要，其实有两个理由：
//   · 不摘的话，监听器会一直挂在 signal 上，直到 signal 自己被杀 —— 长会话里
//     这就是一条泄露的引用链（signal 属于连接，连接属于会话）
//   · resolve 只认第一次，但 abort 之后仍会走 onAbort 里的逻辑；虽然结果一样，
//     埋点/日志会记成「取消」，诊断时误导人
                    extra.signal.removeEventListener('abort', onAbort)
                    logEvent('tengu_mcp_elicitation_response', {
                      mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      action:
                        result.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                    resolve(result)
                  },
                },
              ],
            },
          }))

          extra.signal.addEventListener('abort', onAbort, { once: true })
        })
        const rawResult = await response
        logMCPDebug(
          serverName,
          `Elicitation response: ${jsonStringify(rawResult)}`,
        )
        const result = await runElicitationResultHooks(
// 用户已经在对话框里点完之后，还要过一遍 Result hooks —— 也就是 hooks
// **可以改掉用户的答案**，甚至改成 decline。
//
// 这不是 bug 而是策略层的位置决定的：hooks 是企业/用户下发的规则，
// 它能否决人的选择（「这个字段是敏感信息，不许提交」）。
// 所以 elicitation 的最终答复是「人 + 策略」的合成结果，不是人的原话。
          serverName,
          rawResult,
          extra.signal,
          mode,
          elicitationId,
        )
        return result
      } catch (error) {
        logMCPError(serverName, `Elicitation error: ${error}`)
        return { action: 'cancel' as const }
      }
    })

    // Register handler for elicitation completion notifications (URL mode).
    // Sets `completed: true` on the matching queue event; the dialog reacts to this flag.
// 完成通知只把队列里那一项打上 completed 标志，**不 resolve**。
//
// 因为 URL 模式是两段流程：打开浏览器 → 用户在网页上完成 → server 告诉你完成了。
// 但这次 elicitation 的**答复**仍然要用户在对话框里点。两个信号被刻意分开：
// 一个来自 server（完成了吗），一个来自人（批不批准）。
    client.setNotificationHandler(
      ElicitationCompleteNotificationSchema,
      notification => {
        const { elicitationId } = notification.params
        logMCPDebug(
          serverName,
          `Received elicitation completion notification: ${elicitationId}`,
        )
        void executeNotificationHooks({
          message: `MCP server "${serverName}" confirmed elicitation ${elicitationId} complete`,
          notificationType: 'elicitation_complete',
        })
        let found = false
        setAppState(prev => {
          const idx = findElicitationInQueue(
            prev.elicitation.queue,
            serverName,
            elicitationId,
          )
          if (idx === -1) return prev
          found = true
          const queue = [...prev.elicitation.queue]
          queue[idx] = { ...queue[idx]!, completed: true }
          return { ...prev, elicitation: { queue } }
        })
        if (!found) {
          logMCPDebug(
            serverName,
            `Ignoring completion notification for unknown elicitation: ${elicitationId}`,
          )
        }
      },
    )
  } catch {
    // Client wasn't created with elicitation capability - nothing to register
    return
  }
}

export async function runElicitationHooks(
  serverName: string,
  params: ElicitRequestParams,
  signal: AbortSignal,
): Promise<ElicitResult | undefined> {
  try {
    const mode = params.mode === 'url' ? 'url' : 'form'
    const url = 'url' in params ? (params.url as string) : undefined
    const elicitationId =
      'elicitationId' in params
        ? (params.elicitationId as string | undefined)
        : undefined

    const { elicitationResponse, blockingError } =
      await executeElicitationHooks({
        serverName,
        message: params.message,
        requestedSchema:
          'requestedSchema' in params
            ? (params.requestedSchema as Record<string, unknown>)
            : undefined,
        signal,
        mode,
        url,
        elicitationId,
      })

    if (blockingError) {
      return { action: 'decline' }
    }

    if (elicitationResponse) {
      return {
        action: elicitationResponse.action,
        content: elicitationResponse.content,
      }
    }

    return undefined
  } catch (error) {
    logMCPError(serverName, `Elicitation hook error: ${error}`)
    return undefined
  }
}

/**
 * Run ElicitationResult hooks after the user has responded, then fire a
 * `elicitation_response` notification. Returns a (potentially modified)
 * ElicitResult — hooks may override the action/content or block the response.
 */
export async function runElicitationResultHooks(
  serverName: string,
  result: ElicitResult,
  signal: AbortSignal,
  mode?: 'form' | 'url',
  elicitationId?: string,
): Promise<ElicitResult> {
  try {
    const { elicitationResultResponse, blockingError } =
      await executeElicitationResultHooks({
        serverName,
        action: result.action,
        content: result.content as Record<string, unknown> | undefined,
        signal,
        mode,
        elicitationId,
      })

    if (blockingError) {
      void executeNotificationHooks({
        message: `Elicitation response for server "${serverName}": decline`,
        notificationType: 'elicitation_response',
      })
      return { action: 'decline' }
    }

    const finalResult = elicitationResultResponse
      ? {
          action: elicitationResultResponse.action,
          content: elicitationResultResponse.content ?? result.content,
        }
      : result

    // Fire a notification for observability
    void executeNotificationHooks({
      message: `Elicitation response for server "${serverName}": ${finalResult.action}`,
      notificationType: 'elicitation_response',
    })

    return finalResult
  } catch (error) {
    logMCPError(serverName, `ElicitationResult hook error: ${error}`)
    // Fire notification even on error
    void executeNotificationHooks({
      message: `Elicitation response for server "${serverName}": ${result.action}`,
      notificationType: 'elicitation_response',
    })
    return result
  }
}
