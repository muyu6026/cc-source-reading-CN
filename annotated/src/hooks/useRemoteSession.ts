import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BoundedUUIDSet } from '../bridge/bridgeMessaging.js'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import {
  type RemotePermissionResponse,
  type RemoteSessionConfig,
  RemoteSessionManager,
} from '../remote/RemoteSessionManager.js'
import {
  createSyntheticAssistantMessage,
  createToolStub,
} from '../remote/remotePermissionBridge.js'
import {
  convertSDKMessage,
  isSessionEndMessage,
} from '../remote/sdkMessageAdapter.js'
import { useSetAppState } from '../state/AppState.js'
import type { AppState } from '../state/AppStateStore.js'
import type { Tool } from '../Tool.js'
import { findToolByName } from '../Tool.js'
import type { Message as MessageType } from '../types/message.js'
import type { PermissionAskDecision } from '../types/permissions.js'
import { logForDebugging } from '../utils/debug.js'
import { truncateToWidth } from '../utils/format.js'
import {
  createSystemMessage,
  extractTextContent,
  handleMessageFromStream,
  type StreamingToolUse,
} from '../utils/messages.js'
import { generateSessionTitle } from '../utils/sessionTitle.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'
import { updateSessionTitle } from '../utils/teleport/api.js'

// How long to wait for a response before showing a warning
const RESPONSE_TIMEOUT_MS = 60000 // 60 seconds
// RESPONSE_TIMEOUT_MS = 60s：POST 之后 60 秒没有任何消息到达就认为会话卡死，插警告 + 重连 WS。
// Extended timeout during compaction — compact API calls take 5-30s and
// block other SDK messages, so the normal 60s timeout isn't enough when
// compaction itself runs close to the edge.
const COMPACTION_TIMEOUT_MS = 180000 // 3 minutes
// compaction 期间拉长到 180s：compact API 调用本身要 5-30s，且会阻塞其他 SDK 消息——贴着 60s 边缘跑 compact 会被误判成卡死。

type UseRemoteSessionProps = {
  config: RemoteSessionConfig | undefined
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setIsLoading: (loading: boolean) => void
  onInit?: (slashCommands: string[]) => void
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  tools: Tool[]
  setStreamingToolUses?: React.Dispatch<
    React.SetStateAction<StreamingToolUse[]>
  >
  setStreamMode?: React.Dispatch<React.SetStateAction<SpinnerMode>>
  setInProgressToolUseIDs?: (f: (prev: Set<string>) => Set<string>) => void
}
// Props 面：远端会话管理器配置、消息/加载态的 setter、init 回调（拿远端可用的 slash 命令）、权限队列 setter，以及三个可选的流式回调（非流式宿主不传）。

type UseRemoteSessionResult = {
  isRemoteMode: boolean
  sendMessage: (
    content: RemoteMessageContent,
    opts?: { uuid?: string },
  ) => Promise<boolean>
  cancelRequest: () => void
  disconnect: () => void
}

/**
 * Hook for managing a remote CCR session in the REPL.
 *
 * Handles:
 * - WebSocket connection to CCR
 * - Converting SDK messages to REPL messages
 * - Sending user input to CCR via HTTP POST
 * - Permission request/response flow via existing ToolUseConfirm queue
 */
// useRemoteSession：把 REPL 接到远端的 CCR 会话上。四条通道：WS 收 SDK 消息并转成 REPL 消息、HTTP POST 发用户输入、权限请求借道现有 ToolUseConfirm 队列、任务/工具进度靠桥 WS 上的系统消息推断。
export function useRemoteSession({
  config,
  setMessages,
  setIsLoading,
  onInit,
  setToolUseConfirmQueue,
  tools,
  setStreamingToolUses,
  setStreamMode,
  setInProgressToolUseIDs,
}: UseRemoteSessionProps): UseRemoteSessionResult {
  const isRemoteMode = !!config

  const setAppState = useSetAppState()
  const setConnStatus = useCallback(
    (s: AppState['remoteConnectionStatus']) =>
      setAppState(prev =>
        prev.remoteConnectionStatus === s
          ? prev
          : { ...prev, remoteConnectionStatus: s },
      ),
    [setAppState],
  )
// 连接状态写入带相等短路——WS 心跳里重复置同一个值不该产生新 state 对象。

  // Event-sourced count of subagents running inside the remote daemon child.
  // The viewer's own AppState.tasks is empty — tasks live in a different
  // process. task_started/task_notification reach us via the bridge WS.
  const runningTaskIdsRef = useRef(new Set<string>())
  const writeTaskCount = useCallback(() => {
    const n = runningTaskIdsRef.current.size
    setAppState(prev =>
      prev.remoteBackgroundTaskCount === n
        ? prev
        : { ...prev, remoteBackgroundTaskCount: n },
    )
  }, [setAppState])
// runningTaskIdsRef 是事件源计数：viewer 自己的 AppState.tasks 是空的（任务跑在另一个进程里），task_started/task_notification 经桥 WS 到达，差值写进 remoteBackgroundTaskCount 供「N in background」角标显示。

  // Timer for detecting stuck sessions
  const responseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Track whether the remote session is compacting. During compaction the
  // CLI worker is busy with an API call and won't emit messages for a while;
  // use a longer timeout and suppress spurious "unresponsive" warnings.
  const isCompactingRef = useRef(false)
// isCompactingRef：compaction 期间 CLI worker 忙于 API 调用、短期内不会发消息——用更长超时并抑制「无响应」误报。

  const managerRef = useRef<RemoteSessionManager | null>(null)

  // Track whether we've already updated the session title (for no-initial-prompt sessions)
  const hasUpdatedTitleRef = useRef(false)

  // UUIDs of user messages we POSTed locally — the WS echoes them back and
  // we must filter them out when convertUserTextMessages is on, or the viewer
  // sees every typed message twice (once from local createUserMessage, once
  // from the echo). A single POST can echo MULTIPLE times with the same uuid:
  // the server may broadcast the POST directly to /subscribe, AND the worker
  // (cowork desktop / CLI daemon) echoes it again on its write path. A
  // delete-on-first-match Set would let the second echo through — use a
  // bounded ring instead. Cap is generous: users don't type 50 messages
  // faster than echoes arrive.
  // NOTE: this does NOT dedup history-vs-live overlap at attach time (nothing
  // seeds the set from history UUIDs; only sendMessage populates it).
  const sentUUIDsRef = useRef(new BoundedUUIDSet(50))
// 为什么是有界环形（50）而不是 delete-on-match：同一个 POST 可能回声多次——服务器直接广播到 /subscribe 一次，worker（cowork 桌面/CLI daemon）在写路径上再回声一次。delete-on-match 会漏放第二次。环形天然兜住重复，容量按「用户不可能比回声更快打 50 条」设定。注意它不处理 attach 时刻的历史-实时重叠（没有东西用历史 UUID 播种，只有 sendMessage 往里加）。

  // Keep a ref to tools so the WebSocket callback doesn't go stale
  const toolsRef = useRef(tools)
  useEffect(() => {
    toolsRef.current = tools
  }, [tools])
// toolsRef 让 WS 回调不读到陈旧工具表（权限请求查找 Tool 对象用）。

  // Initialize and connect to remote session
  useEffect(() => {
    // Skip if not in remote mode
    if (!config) {
      return
    }

    logForDebugging(
      `[useRemoteSession] Initializing for session ${config.sessionId}`,
    )
// onMessage 的调试日志先拼 type/subtype/content 类型摘要——远端会话排障全靠这行，消息本体可能很大不能整个打。

    const manager = new RemoteSessionManager(config, {
      onMessage: sdkMessage => {
        const parts = [`type=${sdkMessage.type}`]
        if ('subtype' in sdkMessage) parts.push(`subtype=${sdkMessage.subtype}`)
        if (sdkMessage.type === 'user') {
          const c = sdkMessage.message?.content
          parts.push(
            `content=${Array.isArray(c) ? c.map(b => b.type).join(',') : typeof c}`,
          )
        }
        logForDebugging(`[useRemoteSession] Received ${parts.join(' ')}`)

        // Clear response timeout on any message received — including the WS
        // echo of our own POST, which acts as a heartbeat. This must run
        // BEFORE the echo filter, or slow-to-stream agents (compaction, cold
        // start) spuriously trip the 60s unresponsive warning + reconnect.
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current)
          responseTimeoutRef.current = null
        }
// 清除超时必须排在回声过滤之前：我们自己 POST 的 WS 回声就是心跳——慢速流式的 agent（compaction、冷启动）靠它活着。放到过滤后面，这些会话会无端触发 60s 无响应警告 + 重连。

        // Echo filter: drop user messages we already added locally before POST.
        // The server and/or worker round-trip our own send back on the WS with
        // the same uuid we passed to sendEventToRemoteSession. DO NOT delete on
        // match — the same uuid can echo more than once (server broadcast +
        // worker echo), and BoundedUUIDSet already caps growth via its ring.
        if (
          sdkMessage.type === 'user' &&
          sdkMessage.uuid &&
          sentUUIDsRef.current.has(sdkMessage.uuid)
        ) {
          logForDebugging(
            `[useRemoteSession] Dropping echoed user message ${sdkMessage.uuid}`,
          )
          return
        }
// 回声过滤命中即丢弃（本地 POST 前已经渲染过这条消息了），但**不删**记录——同一 uuid 会来第二次，环形的使命就是这个。
        // Handle init message - extract available slash commands
        if (
          sdkMessage.type === 'system' &&
          sdkMessage.subtype === 'init' &&
          onInit
        ) {
          logForDebugging(
            `[useRemoteSession] Init received with ${sdkMessage.slash_commands.length} slash commands`,
          )
          onInit(sdkMessage.slash_commands)
        }
// system/init 消息把远端可用的 slash 命令抽出来交给 onInit——本地斜杠菜单要与远端的实际能力对齐。

        // Track remote subagent lifecycle for the "N in background" counter.
        // All task types (Agent/teammate/workflow/bash) flow through
        // registerTask() → task_started, and complete via task_notification.
        // Return early — these are status signals, not renderable messages.
        if (sdkMessage.type === 'system') {
          if (sdkMessage.subtype === 'task_started') {
            runningTaskIdsRef.current.add(sdkMessage.task_id)
            writeTaskCount()
            return
          }
          if (sdkMessage.subtype === 'task_notification') {
            runningTaskIdsRef.current.delete(sdkMessage.task_id)
            writeTaskCount()
            return
          }
          if (sdkMessage.subtype === 'task_progress') {
            return
          }
// task_progress 是纯状态信号，没有可渲染内容，直接丢。
          // Track compaction state. The CLI emits status='compacting' at
          // the start and status=null when done; compact_boundary also
          // signals completion. Repeated 'compacting' status messages
          // (keep-alive ticks) update the ref but don't append to messages.
          if (sdkMessage.subtype === 'status') {
            const wasCompacting = isCompactingRef.current
            isCompactingRef.current = sdkMessage.status === 'compacting'
            if (wasCompacting && isCompactingRef.current) {
              return
            }
          }
          if (sdkMessage.subtype === 'compact_boundary') {
            isCompactingRef.current = false
          }
// compaction 状态机：status=compacting 开始、compact_boundary 或 status=null 结束。重复的 compacting 是 keep-alive tick——只更新 ref 不进消息列表（否则用户每小时看到几十条「压缩中」）。
        }

        // Check if session ended
        if (isSessionEndMessage(sdkMessage)) {
          isCompactingRef.current = false
          setIsLoading(false)
        }
// 会话结束消息：停 loading。注意 assistant 消息**不**停 loading——agent 可能还在工具循环里，只有会话结束或权限请求才停。

        // Clear in-progress tool_use IDs when their tool_result arrives.
        // Must read the RAW sdkMessage: in non-viewerOnly mode,
        // convertSDKMessage returns {type:'ignored'} for user messages, so the
        // delete would never fire post-conversion. Mirrors the add site below
        // and inProcessRunner.ts; without this the set grows unbounded for the
        // session lifetime (BQ: CCR cohort shows 5.2x higher RSS slope).
        if (setInProgressToolUseIDs && sdkMessage.type === 'user') {
          const content = sdkMessage.message?.content
          if (Array.isArray(content)) {
            const resultIds: string[] = []
            for (const block of content) {
              if (block.type === 'tool_result') {
                resultIds.push(block.tool_use_id)
              }
            }
            if (resultIds.length > 0) {
              setInProgressToolUseIDs(prev => {
                const next = new Set(prev)
                for (const id of resultIds) next.delete(id)
                return next.size === prev.size ? prev : next
              })
            }
          }
        }
// 清 in-progress tool_use ID 必须读**原始** sdkMessage：非 viewerOnly 模式下 convertSDKMessage 把 user 消息返 {type:'ignored'}，转换后再删就永远不触发。与下面的 add site 和 inProcessRunner.ts 三处镜像；不清的话集合整个会话周期无限增长（BQ 数据：CCR cohort 的 RSS 斜率高 5.2 倍）。

        // Convert SDK message to REPL message. In viewerOnly mode, the
        // remote agent runs BriefTool (SendUserMessage) — its tool_use block
        // renders empty (userFacingName() === ''), actual content is in the
        // tool_result. So we must convert tool_results to render them.
        const converted = convertSDKMessage(
          sdkMessage,
          config.viewerOnly
            ? { convertToolResults: true, convertUserTextMessages: true }
            : undefined,
        )
// viewerOnly 模式的转换选项：远端 agent 跑 BriefTool（SendUserMessage），它的 tool_use 块 userFacingName() 是空串、渲染出来是空的，实际内容在 tool_result 里——所以必须开 convertToolResults + convertUserTextMessages 才能看到东西。

        if (converted.type === 'message') {
          // When we receive a complete message, clear streaming tool uses
          // since the complete message replaces the partial streaming state
          setStreamingToolUses?.(prev => (prev.length > 0 ? [] : prev))

          // Mark tool_use blocks as in-progress so the UI shows the correct
          // spinner state instead of "Waiting…" (queued). In local sessions,
          // toolOrchestration.ts handles this, but remote sessions receive
          // pre-built assistant messages without running local tool execution.
          if (
            setInProgressToolUseIDs &&
            converted.message.type === 'assistant'
          ) {
            const toolUseIds = converted.message.message.content
              .filter(block => block.type === 'tool_use')
              .map(block => block.id)
            if (toolUseIds.length > 0) {
              setInProgressToolUseIDs(prev => {
                const next = new Set(prev)
                for (const id of toolUseIds) {
                  next.add(id)
                }
                return next
              })
            }
          }
// 完整消息路径三件事：清空流式状态（完整消息取代部分流式状态）；assistant 消息把 tool_use 块标成 in-progress——本地会话这活由 toolOrchestration.ts 干，远端会话收到的是预制 assistant 消息、没有本地工具执行，UI 不补就是「Waiting…」；消息入列。

          setMessages(prev => [...prev, converted.message])
          // Note: Don't stop loading on assistant messages - the agent may still be
          // working (tool use loops). Loading stops only on session end or permission request.
        } else if (converted.type === 'stream_event') {
          // Process streaming events to update UI in real-time
          if (setStreamingToolUses && setStreamMode) {
            handleMessageFromStream(
              converted.event,
              message => setMessages(prev => [...prev, message]),
              () => {
                // No-op for response length - remote sessions don't track this
              },
              setStreamMode,
              setStreamingToolUses,
            )
          } else {
            logForDebugging(
              `[useRemoteSession] Stream event received but streaming callbacks not provided`,
            )
          }
        }
// stream_event 路径交给 handleMessageFromStream 实时更新 UI。'ignored' 类型的消息静默丢弃。
        // 'ignored' messages are silently dropped
      },
      onPermissionRequest: (request, requestId) => {
        logForDebugging(
          `[useRemoteSession] Permission request for tool: ${request.tool_name}`,
        )

        // Look up the Tool object by name, or create a stub for unknown tools
        const tool =
          findToolByName(toolsRef.current, request.tool_name) ??
          createToolStub(request.tool_name)

        const syntheticMessage = createSyntheticAssistantMessage(
          request,
          requestId,
        )
// createSyntheticAssistantMessage：远端的权限请求没有本地 assistant 消息可挂，造一条合成的，让 ToolUseConfirm 队列的渲染组件有东西可渲染。

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
            // No-op for remote — classifier runs on the container
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
          onAllow(updatedInput, _permissionUpdates, _feedback) {
            const response: RemotePermissionResponse = {
              behavior: 'allow',
              updatedInput,
            }
            manager.respondToPermissionRequest(requestId, response)
            setToolUseConfirmQueue(queue =>
              queue.filter(item => item.toolUseID !== request.tool_use_id),
            )
            // Resume loading indicator after approving
            setIsLoading(true)
          },
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
            // No-op for remote — permission state is on the container
          },
        }
// ToolUseConfirm 四回调：abort/reject 都回 deny + 摘队列，allow 回 allow + 摘队列 + 恢复 loading（批准后远端继续跑）。onUserInteraction 和 recheckPermission 是 no-op——分类器跑在容器那头，本地没有可重查的状态。

        setToolUseConfirmQueue(queue => [...queue, toolUseConfirm])
        // Pause loading indicator while waiting for permission
        setIsLoading(false)
      },
      onPermissionCancelled: (requestId, toolUseId) => {
        logForDebugging(
          `[useRemoteSession] Permission request cancelled: ${requestId}`,
        )
        const idToRemove = toolUseId ?? requestId
        setToolUseConfirmQueue(queue =>
          queue.filter(item => item.toolUseID !== idToRemove),
        )
        setIsLoading(true)
      },
// 远端取消权限请求（比如会话被 kill）：摘队列 + 恢复 loading，和本地拒绝一个效果。
      onConnected: () => {
        logForDebugging('[useRemoteSession] Connected')
        setConnStatus('connected')
      },
      onReconnecting: () => {
        logForDebugging('[useRemoteSession] Reconnecting')
        setConnStatus('reconnecting')
        // WS gap = we may miss task_notification events. Clear rather than
        // drift high forever. Undercounts tasks that span the gap; accepted.
        runningTaskIdsRef.current.clear()
        writeTaskCount()
        // Same for tool_use IDs: missed tool_result during the gap would
        // leave stale spinner state forever.
        setInProgressToolUseIDs?.(prev => (prev.size > 0 ? new Set() : prev))
// 重连间隙的两个清理都选「清零而不是漂移」：WS 断开期间可能漏收 task_notification，宁可少算几个后台任务，不让计数永远偏高；同理漏收的 tool_result 会留下永久转圈的 spinner。
      },
      onDisconnected: () => {
        logForDebugging('[useRemoteSession] Disconnected')
        setConnStatus('disconnected')
        setIsLoading(false)
        runningTaskIdsRef.current.clear()
        writeTaskCount()
        setInProgressToolUseIDs?.(prev => (prev.size > 0 ? new Set() : prev))
      },
      onError: error => {
        logForDebugging(`[useRemoteSession] Error: ${error.message}`)
      },
    })
// RemoteSessionManager 的完整回调面：消息、权限请求/取消、连接状态四态、错误。

    managerRef.current = manager
    manager.connect()

    return () => {
      logForDebugging('[useRemoteSession] Cleanup - disconnecting')
      // Clear any pending timeout
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
        responseTimeoutRef.current = null
      }
      manager.disconnect()
      managerRef.current = null
    }
// cleanup：清待决超时 + 断管理器。
  }, [
    config,
    setMessages,
    setIsLoading,
    onInit,
    setToolUseConfirmQueue,
    setStreamingToolUses,
    setStreamMode,
    setInProgressToolUseIDs,
    setConnStatus,
    writeTaskCount,
  ])

  // Send a user message to the remote session
  const sendMessage = useCallback(
    async (
      content: RemoteMessageContent,
      opts?: { uuid?: string },
    ): Promise<boolean> => {
      const manager = managerRef.current
      if (!manager) {
        logForDebugging('[useRemoteSession] Cannot send - no manager')
        return false
      }

      // Clear any existing timeout
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
      }

      setIsLoading(true)

      // Track locally-added message UUIDs so the WS echo can be filtered.
      // Must record BEFORE the POST to close the race where the echo arrives
      // before the POST promise resolves.
      if (opts?.uuid) sentUUIDsRef.current.add(opts.uuid)
// POST **之前**记录 UUID：回声可能比 POST promise 先解析——后记就漏了过滤，用户看到自己刚打的消息出现两遍。

      const success = await manager.sendMessage(content, opts)

      if (!success) {
        // No need to undo the pre-POST add — BoundedUUIDSet's ring evicts it.
        setIsLoading(false)
        return false
      }
// POST 失败也不用撤销预记的 UUID：环形的容量会自然淘汰它，为一次失败维护回退逻辑不划算。

      // Update the session title after the first message when no initial prompt was provided.
      // This gives the session a meaningful title on claude.ai instead of "Background task".
      // Skip in viewerOnly mode — the remote agent owns the session title.
      if (
        !hasUpdatedTitleRef.current &&
        config &&
        !config.hasInitialPrompt &&
        !config.viewerOnly
      ) {
        hasUpdatedTitleRef.current = true
        const sessionId = config.sessionId
        // Extract plain text from content (may be string or content block array)
        const description =
          typeof content === 'string'
            ? content
            : extractTextContent(content, ' ')
        if (description) {
          // generateSessionTitle never rejects (wraps body in try/catch,
          // returns null on failure), so no .catch needed on this chain.
          void generateSessionTitle(
            description,
            new AbortController().signal,
          ).then(title => {
            void updateSessionTitle(
              sessionId,
              title ?? truncateToWidth(description, 75),
            )
          })
        }
      }
// 无初始 prompt 的会话在第一条消息后补标题：给 claude.ai 上一个有意义的标题而不是「Background task」。viewerOnly 跳过——远端 agent 拥有会话标题。generateSessionTitle 内部永不 reject（body 包 try/catch，失败返 null），所以这条链不用挂 .catch。

      // Start timeout to detect stuck sessions. Skip in viewerOnly mode —
      // the remote agent may be idle-shut and take >60s to respawn.
      // Use a longer timeout when the remote session is compacting, since
      // the CLI worker is busy with an API call and won't emit messages.
      if (!config?.viewerOnly) {
        const timeoutMs = isCompactingRef.current
          ? COMPACTION_TIMEOUT_MS
          : RESPONSE_TIMEOUT_MS
        responseTimeoutRef.current = setTimeout(
          (setMessages, manager) => {
            logForDebugging(
              '[useRemoteSession] Response timeout - attempting reconnect',
            )
            // Add a warning message to the conversation
            const warningMessage = createSystemMessage(
              'Remote session may be unresponsive. Attempting to reconnect…',
              'warning',
            )
            setMessages(prev => [...prev, warningMessage])

            // Attempt to reconnect the WebSocket - the subscription may have become stale
            manager.reconnect()
          },
          timeoutMs,
          setMessages,
          manager,
        )
      }
// 卡死检测的装表：viewerOnly 跳过（远端可能 idle-shut，重启要 >60s）；compaction 中用长超时。触发时插一条 warning 系统消息 + manager.reconnect()——订阅可能已经陈旧了。

      return success
    },
    [config, setIsLoading, setMessages],
  )

  // Cancel the current request on the remote session
  const cancelRequest = useCallback(() => {
    // Clear any pending timeout
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }

    // Send interrupt signal to CCR. Skip in viewerOnly mode — Ctrl+C
    // should never interrupt the remote agent.
    if (!config?.viewerOnly) {
      managerRef.current?.cancelSession()
    }

    setIsLoading(false)
  }, [config, setIsLoading])
// cancelRequest：清超时 + 发中断。viewerOnly 不中断远端——Ctrl+C 是本地取消，不该杀远程 agent。

  // Disconnect from the session
  const disconnect = useCallback(() => {
    // Clear any pending timeout
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }
    managerRef.current?.disconnect()
    managerRef.current = null
// disconnect：清超时 + 断管理器 + 清 ref（幂等，重复调用安全）。
  }, [])

  // All four fields are already stable (boolean derived from a prop that
  // doesn't change mid-session, three useCallbacks with stable deps). The
  // result object is consumed by REPL's onSubmit useCallback deps — without
  // memoization the fresh literal invalidates onSubmit on every REPL render,
  // which in turn churns PromptInput's props and downstream memoization.
  return useMemo(
    () => ({ isRemoteMode, sendMessage, cancelRequest, disconnect }),
    [isRemoteMode, sendMessage, cancelRequest, disconnect],
  )
// 返回值必须 useMemo：四个字段本身稳定，但新的对象字面量会让 REPL 的 onSubmit useCallback 每次渲染都失效，进而churn PromptInput 的 props 和下游所有 memo。
}
