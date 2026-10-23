/**
 * REPL integration hook for `claude ssh` sessions.
 *
 * Sibling to useDirectConnect — same shape (isRemoteMode/sendMessage/
 * cancelRequest/disconnect), same REPL wiring, but drives an SSH child
 * process instead of a WebSocket. Kept separate rather than generalizing
 * useDirectConnect because the lifecycle differs: the ssh process and auth
 * proxy are created BEFORE this hook runs (during startup, in main.tsx) and
 * handed in; useDirectConnect creates its WebSocket inside the effect.
 */
// REPL 侧 SSH 会话集成钩子。与 useDirectConnect 是姊妹（同样的
// isRemoteMode/sendMessage/cancelRequest/disconnect 形状、同样的 REPL 接线），
// 但驱动的是 SSH 子进程而不是 WebSocket。为什么不合并泛化：
// 生命周期不同——ssh 进程和 auth proxy 在本钩子运行前就已创建
// （启动期 main.tsx）并交进来；useDirectConnect 的 WebSocket
// 是自己在 effect 里建的。

import { randomUUID } from 'crypto'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import {
  createSyntheticAssistantMessage,
  createToolStub,
} from '../remote/remotePermissionBridge.js'
import {
  convertSDKMessage,
  isSessionEndMessage,
} from '../remote/sdkMessageAdapter.js'
import type { SSHSession } from '../ssh/createSSHSession.js'
import type { SSHSessionManager } from '../ssh/SSHSessionManager.js'
import type { Tool } from '../Tool.js'
import { findToolByName } from '../Tool.js'
import type { Message as MessageType } from '../types/message.js'
import type { PermissionAskDecision } from '../types/permissions.js'
import { logForDebugging } from '../utils/debug.js'
import { gracefulShutdown } from '../utils/gracefulShutdown.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'

type UseSSHSessionResult = {
  isRemoteMode: boolean
  sendMessage: (content: RemoteMessageContent) => Promise<boolean>
  cancelRequest: () => void
  disconnect: () => void
}
// 对 REPL 暴露的四件套：isRemoteMode 决定 REPL 走远程分支；
// sendMessage 返回 boolean 让调用方知道有没有真正发出去。

type UseSSHSessionProps = {
  session: SSHSession | undefined
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setIsLoading: (loading: boolean) => void
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  tools: Tool[]
}
// props 里 session 为 undefined 即「非远程模式」，整个钩子退化成
// 恒 false 的 isRemoteMode 加三个空操作。

export function useSSHSession({
  session,
  setMessages,
  setIsLoading,
  setToolUseConfirmQueue,
  tools,
}: UseSSHSessionProps): UseSSHSessionResult {
  const isRemoteMode = !!session
// 远程模式判定就是「有没有 session」：
// undefined 走本地 REPL 原链路。

  const managerRef = useRef<SSHSessionManager | null>(null)
  const hasReceivedInitRef = useRef(false)
  const isConnectedRef = useRef(false)

  const toolsRef = useRef(tools)
  useEffect(() => {
    toolsRef.current = tools
  }, [tools])
// tools 进 ref：onPermissionRequest 回调闭包不能过期，
// 但 tools 数组身份每轮都可能变，不能进 effect 依赖。

  useEffect(() => {
    if (!session) return

    hasReceivedInitRef.current = false
    logForDebugging('[useSSHSession] wiring SSH session manager')
// 每次 session 变化重置 init 去重标志：
// 新会话要重新收第一条 init。

    const manager = session.createManager({
      onMessage: sdkMessage => {
        if (isSessionEndMessage(sdkMessage)) {
          setIsLoading(false)
        }

        // Skip duplicate init messages (one per turn from stream-json mode).
        if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
          if (hasReceivedInitRef.current) return
          hasReceivedInitRef.current = true
        }
// stream-json 模式下服务端每轮都发一条 system/init，只放行第一条——
// 否则 transcript 里会出现一排重复的初始化消息。

        const converted = convertSDKMessage(sdkMessage, {
          convertToolResults: true,
        })
        if (converted.type === 'message') {
          setMessages(prev => [...prev, converted.message])
        }
      },
// onMessage 只管转换和入列；session end 消息顺带把 loading 灭掉
// （SSH 侧没有单独的「轮次结束」信号）。
      onPermissionRequest: (request, requestId) => {
        logForDebugging(
          `[useSSHSession] permission request: ${request.tool_name}`,
        )

        const tool =
          findToolByName(toolsRef.current, request.tool_name) ??
          createToolStub(request.tool_name)
// 本地没注册这个工具名时造 stub：权限弹窗要渲染工具名和描述，
// 不能因为找不到工具定义就整个丢掉请求。

        const syntheticMessage = createSyntheticAssistantMessage(
          request,
          requestId,
        )

        const permissionResult: PermissionAskDecision = {
          behavior: 'ask',
          message:
            request.description ?? `${request.tool_name} requires permission`,
          suggestions: request.permission_suggestions,
          blockedPath: request.blocked_path,
        }
// 远程权限请求统一降级成 behavior:'ask'：判定权在远端，
// 本地只负责弹窗和把用户选择回传。

        const toolUseConfirm: ToolUseConfirm = {
          assistantMessage: syntheticMessage,
          tool,
          description:
            request.description ?? `${request.tool_name} requires permission`,
          input: request.input,
          toolUseContext: {} as ToolUseConfirm['toolUseContext'],
// 远程会话没有本地 toolUseContext，cast 个空对象占位——
// PermissionRequest 组件只会读它的个别字段。
          toolUseID: request.tool_use_id,
          permissionResult,
          permissionPromptStartTimeMs: Date.now(),
          onUserInteraction() {},
          onAbort() {
            manager.respondToPermissionRequest(requestId, {
              behavior: 'deny',
              message: 'User aborted',
            })
            setToolUseConfirmQueue(q =>
              q.filter(i => i.toolUseID !== request.tool_use_id),
            )
          },
          onAllow(updatedInput) {
            manager.respondToPermissionRequest(requestId, {
              behavior: 'allow',
              updatedInput,
            })
            setToolUseConfirmQueue(q =>
              q.filter(i => i.toolUseID !== request.tool_use_id),
            )
            setIsLoading(true)
          },
          onReject(feedback) {
            manager.respondToPermissionRequest(requestId, {
              behavior: 'deny',
              message: feedback ?? 'User denied permission',
            })
            setToolUseConfirmQueue(q =>
              q.filter(i => i.toolUseID !== request.tool_use_id),
            )
          },
          async recheckPermission() {},
// 重检权限在远程模式下是空操作：本地缓存不了远端的判定逻辑，
// 每次都是新请求。
        }

        setToolUseConfirmQueue(q => [...q, toolUseConfirm])
// 入队即展示：三个交互回调都从这里挂载，
// 用户一动就回传远端。
        setIsLoading(false)
// 注意顺序：先入队再灭 loading，避免弹窗出现前 spinner 先闪一下。
      },
      onConnected: () => {
        logForDebugging('[useSSHSession] connected')
        isConnectedRef.current = true
      },
      onReconnecting: (attempt, max) => {
        logForDebugging(
          `[useSSHSession] ssh dropped, reconnecting (${attempt}/${max})`,
        )
        isConnectedRef.current = false
        // Surface a transient system message in the transcript so the user
        // knows what's happening — the next onConnected clears the state.
        // Any in-flight request is lost; the remote's --continue reloads
        // history but there's no turn in progress to resume.
        setIsLoading(false)
        const msg: MessageType = {
// 断线时插一条 warning 级系统消息：让用户知道发生了什么，
// 下一条 onConnected 会清掉这个状态。
          type: 'system',
          subtype: 'informational',
          content: `SSH connection dropped — reconnecting (attempt ${attempt}/${max})...`,
          timestamp: new Date().toISOString(),
          uuid: randomUUID(),
          level: 'warning',
        }
        setMessages(prev => [...prev, msg])
      },
// 重连中的三个动作：灭 loading、发提示消息、把 isConnectedRef 置 false
// （供 onDisconnected 判断「从未连上」与「连上又断」）。
// 在途请求救不回来：远端 --continue 会重放历史，
// 但没有进行中的轮次要恢复。
      onDisconnected: () => {
        logForDebugging('[useSSHSession] ssh process exited (giving up)')
        const stderr = session.getStderrTail().trim()
        const connected = isConnectedRef.current
        const exitCode = session.proc.exitCode
        isConnectedRef.current = false
        setIsLoading(false)

        let msg = connected
// 断开文案按「是否曾连上」分流：从未连上 = 失败；
// 连上又断 = 正常结束。
          ? 'Remote session ended.'
          : 'SSH session failed before connecting.'
        // Surface remote stderr if it looks like an error (pre-connect always,
        // post-connect only on nonzero exit — normal --verbose noise otherwise).
        if (stderr && (!connected || exitCode !== 0)) {
// stderr 只在该看的时候拼：连接前失败必看；连接后仅当退出码非 0
//（否则 --verbose 的常规输出会淹没真正的错误）。
          msg += `\nRemote stderr (exit ${exitCode ?? 'signal ' + session.proc.signalCode}):\n${stderr}`
        }
        void gracefulShutdown(1, 'other', { finalMessage: msg })
// 走到这里就是终局：gracefulShutdown(1) 带 finalMessage 退出，
// reason 'other' 表示非用户主动退出。
      },
      onError: error => {
        logForDebugging(`[useSSHSession] error: ${error.message}`)
      },
    })
// managerRef 存一份供 sendMessage/cancelRequest/disconnect 用；
// connect() 立即发起连接。

    managerRef.current = manager
    manager.connect()

    return () => {
      logForDebugging('[useSSHSession] cleanup')
      manager.disconnect()
      session.proxy.stop()
      managerRef.current = null
    }
  }, [session, setMessages, setIsLoading, setToolUseConfirmQueue])
// 清理三件套：断开 manager、停 auth proxy、清 ref。
// proxy 是在 main.tsx 启动期创建的，这里只负责停。

  const sendMessage = useCallback(
    async (content: RemoteMessageContent): Promise<boolean> => {
      const m = managerRef.current
      if (!m) return false
      setIsLoading(true)
      return m.sendMessage(content)
    },
    [setIsLoading],
  )
// manager 不存在（已卸载）时静默返回 false，不抛。

  const cancelRequest = useCallback(() => {
    managerRef.current?.sendInterrupt()
    setIsLoading(false)
  }, [setIsLoading])
// cancelRequest 发的是 interrupt 不是 disconnect：
// 远端停当前轮，会话保持。

  const disconnect = useCallback(() => {
    managerRef.current?.disconnect()
    managerRef.current = null
    isConnectedRef.current = false
  }, [])
// disconnect 是「用户主动断」：停 manager 并清 ref，
// 与 effect 清理的区别是不触发 gracefulShutdown。

  return useMemo(
    () => ({ isRemoteMode, sendMessage, cancelRequest, disconnect }),
    [isRemoteMode, sendMessage, cancelRequest, disconnect],
  )
// useMemo 稳住返回对象身份：消费者（REPL）把它放进 effect 依赖，
// 每渲染新对象会导致反复重连。
}
