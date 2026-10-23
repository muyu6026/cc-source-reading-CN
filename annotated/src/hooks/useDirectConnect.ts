import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import type { RemotePermissionResponse } from '../remote/RemoteSessionManager.js'
import {
  createSyntheticAssistantMessage,
  createToolStub,
} from '../remote/remotePermissionBridge.js'
import {
  convertSDKMessage,
  isSessionEndMessage,
} from '../remote/sdkMessageAdapter.js'
import {
  type DirectConnectConfig,
  DirectConnectSessionManager,
} from '../server/directConnectManager.js'
import type { Tool } from '../Tool.js'
import { findToolByName } from '../Tool.js'
import type { Message as MessageType } from '../types/message.js'
import type { PermissionAskDecision } from '../types/permissions.js'
import { logForDebugging } from '../utils/debug.js'
import { gracefulShutdown } from '../utils/gracefulShutdown.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'

type UseDirectConnectResult = {
  isRemoteMode: boolean
  sendMessage: (content: RemoteMessageContent) => Promise<boolean>
  cancelRequest: () => void
  disconnect: () => void
}

type UseDirectConnectProps = {
  config: DirectConnectConfig | undefined
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setIsLoading: (loading: boolean) => void
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  tools: Tool[]
}

export function useDirectConnect({
  config,
  setMessages,
  setIsLoading,
  setToolUseConfirmQueue,
  tools,
}: UseDirectConnectProps): UseDirectConnectResult {
  const isRemoteMode = !!config
// 同样是「有 config 就是远程模式」；与 useSSHSession 的区别只在于
// 传输层（WebSocket 与 SSH 子进程），REPL 侧接口完全一致。

  const managerRef = useRef<DirectConnectSessionManager | null>(null)
  const hasReceivedInitRef = useRef(false)
  const isConnectedRef = useRef(false)

  // Keep a ref to tools so the WebSocket callback doesn't go stale
// tools 进 ref 的动机：onPermissionRequest 闭包不能过期，
// 但 tools 数组每轮身份都变，进依赖会让 manager 反复重建。
  const toolsRef = useRef(tools)
  useEffect(() => {
    toolsRef.current = tools
  }, [tools])
// 只依赖 [tools]：ref 更新和 manager 生命周期解耦。

  useEffect(() => {
    if (!config) {
      return
    }

    hasReceivedInitRef.current = false
// config 变化 = 换服务器：重置 init 去重，重新收首条 init。
    logForDebugging(`[useDirectConnect] Connecting to ${config.wsUrl}`)

    const manager = new DirectConnectSessionManager(config, {
      onMessage: sdkMessage => {
        if (isSessionEndMessage(sdkMessage)) {
          setIsLoading(false)
        }

        // Skip duplicate init messages (server sends one per turn)
        if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
          if (hasReceivedInitRef.current) {
            return
          }
          hasReceivedInitRef.current = true
        }
// 服务端每轮都重发 system/init，同样只放行第一条。

        const converted = convertSDKMessage(sdkMessage, {
          convertToolResults: true,
        })
        if (converted.type === 'message') {
          setMessages(prev => [...prev, converted.message])
        }
      },
// session end → 灭 loading；其余消息转成 Message 追加进 transcript。
      onPermissionRequest: (request, requestId) => {
        logForDebugging(
          `[useDirectConnect] Permission request for tool: ${request.tool_name}`,
        )

        const tool =
          findToolByName(toolsRef.current, request.tool_name) ??
          createToolStub(request.tool_name)

        const syntheticMessage = createSyntheticAssistantMessage(
          request,
          requestId,
        )
// 合成 assistant 消息：远端只发权限请求，本地要把 tool_use 包成
// 一条 assistant 消息，权限弹窗才有挂载点。

        const permissionResult: PermissionAskDecision = {
          behavior: 'ask',
          message:
            request.description ?? `${request.tool_name} requires permission`,
          suggestions: request.permission_suggestions,
          blockedPath: request.blocked_path,
        }

        const toolUseConfirm: ToolUseConfirm = {
          assistantMessage: syntheticMessage,
          tool,
          description:
            request.description ?? `${request.tool_name} requires permission`,
          input: request.input,
          toolUseContext: {} as ToolUseConfirm['toolUseContext'],
          toolUseID: request.tool_use_id,
          permissionResult,
          permissionPromptStartTimeMs: Date.now(),
          onUserInteraction() {
// onUserInteraction 空实现加注释 No-op for remote：
// 远程会话没有本地交互中间态。
            // No-op for remote
          },
          onAbort() {
            const response: RemotePermissionResponse = {
              behavior: 'deny',
              message: 'User aborted',
            }
            manager.respondToPermissionRequest(requestId, response)
            setToolUseConfirmQueue(queue =>
              queue.filter(item => item.toolUseID !== request.tool_use_id),
            )
          },
// 三种终局都做同一件事：回传 deny/allow 给远端 + 把弹窗从队列摘掉。
// allow 时额外 setIsLoading(true)——远端又要开始跑了。
          onAllow(updatedInput, _permissionUpdates, _feedback) {
            const response: RemotePermissionResponse = {
              behavior: 'allow',
              updatedInput,
            }
            manager.respondToPermissionRequest(requestId, response)
            setToolUseConfirmQueue(queue =>
              queue.filter(item => item.toolUseID !== request.tool_use_id),
            )
            setIsLoading(true)
          },
// onAllow 多带一个 updatedInput：用户可能在弹窗里改过参数
//（如权限建议里追加的路径），要原样回传。
          onReject(feedback?: string) {
            const response: RemotePermissionResponse = {
              behavior: 'deny',
              message: feedback ?? 'User denied permission',
            }
            manager.respondToPermissionRequest(requestId, response)
            setToolUseConfirmQueue(queue =>
              queue.filter(item => item.toolUseID !== request.tool_use_id),
            )
          },
          async recheckPermission() {
            // No-op for remote
          },
        }
// ToolUseConfirm 入队前最后一站：permissionPromptStartTimeMs
// 记的是「弹窗出现时刻」，供慢权限告警用。

        setToolUseConfirmQueue(queue => [...queue, toolUseConfirm])
        setIsLoading(false)
// 入队 + 灭 loading：spinner 让位给权限弹窗。
      },
      onConnected: () => {
        logForDebugging('[useDirectConnect] Connected')
        isConnectedRef.current = true
      },
      onDisconnected: () => {
        logForDebugging('[useDirectConnect] Disconnected')
        if (!isConnectedRef.current) {
// 断开时分岔：从未连上（isConnectedRef=false）多半是认证被拒或
// 地址错；连上又断是服务端退出或网络掉。
          // Never connected — connection failure (e.g. auth rejected)
          process.stderr.write(
            `\nFailed to connect to server at ${config.wsUrl}\n`,
          )
        } else {
          // Was connected then lost — server process exited or network dropped
          process.stderr.write('\nServer disconnected.\n')
        }
        isConnectedRef.current = false
        void gracefulShutdown(1)
// 两条路都 gracefulShutdown(1)：WebSocket 断了没有本地回退，
// 只能退出让用户重连。
        setIsLoading(false)
      },
      onError: error => {
        logForDebugging(`[useDirectConnect] Error: ${error.message}`)
      },
    })
// managerRef + connect()：与 useSSHSession 相同的收尾模式。

    managerRef.current = manager
    manager.connect()

    return () => {
      logForDebugging('[useDirectConnect] Cleanup - disconnecting')
      manager.disconnect()
      managerRef.current = null
    }
  }, [config, setMessages, setIsLoading, setToolUseConfirmQueue])
// 清理只断 manager：config 为 undefined 时 effect 直接 return，
// 本地模式完全不碰这套。

  const sendMessage = useCallback(
    async (content: RemoteMessageContent): Promise<boolean> => {
      const manager = managerRef.current
      if (!manager) {
        return false
      }

      setIsLoading(true)

      return manager.sendMessage(content)
    },
    [setIsLoading],
  )
// manager 不存在时返回 false（已卸载/未连接），不抛异常。

  // Cancel the current request
  const cancelRequest = useCallback(() => {
    // Send interrupt signal to the server
// cancelRequest 用 interrupt 而非 disconnect：停当前轮、保会话。
    managerRef.current?.sendInterrupt()

    setIsLoading(false)
  }, [setIsLoading])
// 与 cancelRequest 共享 setIsLoading(false)：远端已收到中断，
// 本地 spinner 没有理由再转。

  const disconnect = useCallback(() => {
    managerRef.current?.disconnect()
    managerRef.current = null
    isConnectedRef.current = false
  }, [])
// disconnect 空依赖：只操作 ref 和 manager 方法。

  // Same stability concern as useRemoteSession — memoize so consumers
  // that depend on the result object don't see a fresh reference per render.
// useMemo 的理由与 useRemoteSession 相同：返回对象进消费者的
// effect 依赖，身份不稳会反复重建连接。
  return useMemo(
    () => ({ isRemoteMode, sendMessage, cancelRequest, disconnect }),
    [isRemoteMode, sendMessage, cancelRequest, disconnect],
  )
// 收尾：四件套交回 REPL，本地/远程两种模式对 REPL 是同一套接口。
}
