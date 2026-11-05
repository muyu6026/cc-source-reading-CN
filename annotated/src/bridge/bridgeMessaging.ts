/**
 * Shared transport-layer helpers for bridge message handling.
 *
 * Extracted from replBridge.ts so both the env-based core (initBridgeCore)
 * and the env-less core (initEnvLessBridgeCore) can use the same ingress
 * parsing, control-request handling, and echo-dedup machinery.
 *
 * Everything here is pure — no closure over bridge-specific state. All
 * collaborators (transport, sessionId, UUID sets, callbacks) are passed
 * as params.
 */

// 从桥接主文件里拆出来的传输层公共件：两块核心共用同一套入站解析与控制请求处理
import { randomUUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { SDKResultSuccess } from '../entrypoints/sdk/coreTypes.js'
import { logEvent } from '../services/analytics/index.js'
import { EMPTY_USAGE } from '../services/api/emptyUsage.js'
import type { Message } from '../types/message.js'
import { normalizeControlMessageKeys } from '../utils/controlMessageCompat.js'
import { logForDebugging } from '../utils/debug.js'
import { stripDisplayTagsAllowEmpty } from '../utils/displayTags.js'
import { errorMessage } from '../utils/errors.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import { jsonParse } from '../utils/slowOperations.js'
import type { ReplBridgeTransport } from './replBridgeTransport.js'

// 类型守卫区：这里不深挖结构，只验判别式字段，调用方再按联合类型收窄
// ─── Type guards ─────────────────────────────────────────────────────────────

/** Type predicate for parsed WebSocket messages. SDKMessage is a
 *  discriminated union on `type` — validating the discriminant is
 *  sufficient for the predicate; callers narrow further via the union. */
// 只验类型字段是字符串就够了，因为消息是判别联合，判别式对了其余由类型系统保证
export function isSDKMessage(value: unknown): value is SDKMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

/** Type predicate for control_response messages from the server. */
// 控制响应要先判：它不属于普通消息联合，用普通守卫会漏掉
export function isSDKControlResponse(
  value: unknown,
): value is SDKControlResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'control_response' &&
    'response' in value
  )
}

/** Type predicate for control_request messages from the server. */
// 控制请求带请求号与请求体两个必备字段，缺一个就无法回执
export function isSDKControlRequest(
  value: unknown,
): value is SDKControlRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'control_request' &&
    'request_id' in value &&
    'request' in value
  )
}

// 哪些消息该上桥：只有用户与助手轮次，加上斜杠命令的系统事件
/**
 * True for message types that should be forwarded to the bridge transport.
 * The server only wants user/assistant turns and slash-command system events;
 * everything else (tool_result, progress, etc.) is internal REPL chatter.
 */
// 虚拟消息是界面内部调用，消费方看的是那层工具调用的汇总结果
export function isEligibleBridgeMessage(m: Message): boolean {
  // Virtual messages (REPL inner calls) are display-only — bridge/SDK
  // consumers see the REPL tool_use/result which summarizes the work.
  if ((m.type === 'user' || m.type === 'assistant') && m.isVirtual) {
    return false
  }
// 系统消息只放行本地命令这一类，其余内部事件不上桥
  return (
    m.type === 'user' ||
    m.type === 'assistant' ||
    (m.type === 'system' && m.subtype === 'local_command')
  )
}

// 取标题用：从消息里挑出能代表这一轮的第一段文本
/**
 * Extract title-worthy text from a Message for onUserMessage. Returns
 * undefined for messages that shouldn't title the session: non-user, meta
 * (nudges), tool results, compact summaries, non-human origins (task
 * notifications, channel messages), or pure display-tag content
 * (<ide_opened_file>, <session-start-hook>, etc.).
 *
 * Synthetic interrupts ([Request interrupted by user]) are NOT filtered here —
 * isSyntheticMessage lives in messages.ts (heavy import, pulls command
 * registry). The initialMessages path in initReplBridge checks it; the
 * writeMessages path reaching an interrupt as the *first* message is
 * implausible (an interrupt implies a prior prompt already flowed through).
 */
// 五类不该当标题：非用户、元信息、工具结果、压缩摘要、非人类来源
export function extractTitleText(m: Message): string | undefined {
  if (m.type !== 'user' || m.isMeta || m.toolUseResult || m.isCompactSummary)
    return undefined
  if (m.origin && m.origin.kind !== 'human') return undefined
// 正文可能是字符串也可能是内容块数组，两种形状都要取
  const content = m.message.content
  let raw: string | undefined
  if (typeof content === 'string') {
    raw = content
  } else {
    for (const block of content) {
      if (block.type === 'text') {
        raw = block.text
        break
      }
    }
  }
// 全是显示标签就等于没内容，此时当作取不到标题
  if (!raw) return undefined
  const clean = stripDisplayTagsAllowEmpty(raw)
  return clean || undefined
}

// ─── Ingress routing ─────────────────────────────────────────────────────────

// 入站分发：解析、识别控制消息、去重、最后只处理用户消息
/**
 * Parse an ingress WebSocket message and route it to the appropriate handler.
 * Ignores messages whose UUID is in recentPostedUUIDs (echoes of what we sent)
 * or in recentInboundUUIDs (re-deliveries we've already forwarded — e.g.
 * server replayed history after a transport swap lost the seq-num cursor).
 */
export function handleIngressMessage(
  data: string,
  recentPostedUUIDs: BoundedUUIDSet,
  recentInboundUUIDs: BoundedUUIDSet,
  onInboundMessage: ((msg: SDKMessage) => void | Promise<void>) | undefined,
  onPermissionResponse?: ((response: SDKControlResponse) => void) | undefined,
  onControlRequest?: ((request: SDKControlRequest) => void) | undefined,
): void {
// 整段包在捕获里：一条坏消息不能把连接搞崩
  try {
// 先做键名兼容归一化，历史版本用过不同的字段命名
    const parsed: unknown = normalizeControlMessageKeys(jsonParse(data))

    // control_response is not an SDKMessage — check before the type guard
// 控制响应优先判，它不是普通消息，走普通守卫会被直接丢掉
    if (isSDKControlResponse(parsed)) {
      logForDebugging('[bridge:repl] Ingress message type=control_response')
      onPermissionResponse?.(parsed)
      return
    }

    // control_request from the server (initialize, set_model, can_use_tool).
    // Must respond promptly or the server kills the WS (~10-14s timeout).
// 控制请求必须及时回执，否则服务端十秒出头就会掐断连接
    if (isSDKControlRequest(parsed)) {
      logForDebugging(
        `[bridge:repl] Inbound control_request subtype=${parsed.request.subtype}`,
      )
      onControlRequest?.(parsed)
      return
    }

    if (!isSDKMessage(parsed)) return

// 回显去重：自己发出去的消息会被服务端再推回来一份
    // Check for UUID to detect echoes of our own messages
    const uuid =
      'uuid' in parsed && typeof parsed.uuid === 'string'
        ? parsed.uuid
        : undefined

    if (uuid && recentPostedUUIDs.has(uuid)) {
      logForDebugging(
        `[bridge:repl] Ignoring echo: type=${parsed.type} uuid=${uuid}`,
      )
      return
    }

// 二次去重：传输切换后服务端可能重放历史，那些已经转发过的要丢掉
    // Defensive dedup: drop inbound prompts we've already forwarded. The
    // SSE seq-num carryover (lastTransportSequenceNum) is the primary fix
    // for history-replay; this catches edge cases where that negotiation
    // fails (server ignores from_sequence_num, transport died before
    // receiving any frames, etc).
    if (uuid && recentInboundUUIDs.has(uuid)) {
      logForDebugging(
        `[bridge:repl] Ignoring re-delivered inbound: type=${parsed.type} uuid=${uuid}`,
      )
      return
    }

    logForDebugging(
      `[bridge:repl] Ingress message type=${parsed.type}${uuid ? ` uuid=${uuid}` : ''}`,
    )

// 只有用户消息需要处理，助手与系统消息由本地生成，回推没有意义
    if (parsed.type === 'user') {
      if (uuid) recentInboundUUIDs.add(uuid)
      logEvent('tengu_bridge_message_received', {
        is_repl: true,
      })
// 先登记再调用，即发即忘：处理函数可能是异步的（要解析附件）
      // Fire-and-forget — handler may be async (attachment resolution).
      void onInboundMessage?.(parsed)
    } else {
      logForDebugging(
        `[bridge:repl] Ignoring non-user inbound message: type=${parsed.type}`,
      )
    }
  } catch (err) {
// before
    logForDebugging(
      `[bridge:repl] Failed to parse ingress message: ${errorMessage(err)}`,
    )
  }
}

// ─── Server-initiated control requests ───────────────────────────────────────

// 处理器的入参集合：传输、会话号、四个可选回调
export type ServerControlRequestHandlers = {
  transport: ReplBridgeTransport | null
  sessionId: string
// 仅出站模式：可变请求一律回错误，但初始化必须回成功，否则连接会被掐断
  /**
   * When true, all mutable requests (interrupt, set_model, set_permission_mode,
   * set_max_thinking_tokens) reply with an error instead of false-success.
   * initialize still replies success — the server kills the connection otherwise.
   * Used by the outbound-only bridge mode and the SDK's /bridge subpath so claude.ai sees a
   * proper error instead of "action succeeded but nothing happened locally".
   */
  outboundOnly?: boolean
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
}

// 错误文案要说清怎么办：告诉用户去本地开远程控制，而不是只说不行
const OUTBOUND_ONLY_ERROR =
  'This session is outbound-only. Enable Remote Control locally to allow inbound control.'

/**
 * Respond to inbound control_request messages from the server. The server
 * sends these for session lifecycle events (initialize, set_model) and
 * for turn-level coordination (interrupt, set_max_thinking_tokens). If we
 * don't respond, the server hangs and kills the WS after ~10-14s.
 *
 * Previously a closure inside initBridgeCore's onWorkReceived; now takes
 * collaborators as params so both cores can use it.
 */
// 控制请求分发：没传输就没法回执，只能记日志放弃
export function handleServerControlRequest(
  request: SDKControlRequest,
  handlers: ServerControlRequestHandlers,
): void {
  const {
    transport,
    sessionId,
    outboundOnly,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
  } = handlers
// 没有传输对象时直接返回：请求会超时，但至少不会抛错
  if (!transport) {
    logForDebugging(
      '[bridge:repl] Cannot respond to control_request: transport not configured',
    )
    return
  }

  let response: SDKControlResponse

  // Outbound-only: reply error for mutable requests so claude.ai doesn't show
  // false success. initialize must still succeed (server kills the connection
  // if it doesn't — see comment above).
// 仅出站模式对可变请求统一回错误，初始化例外
  if (outboundOnly && request.request.subtype !== 'initialize') {
    response = {
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: request.request_id,
        error: OUTBOUND_ONLY_ERROR,
      },
    }
    const event = { ...response, session_id: sessionId }
    void transport.write(event)
    logForDebugging(
      `[bridge:repl] Rejected ${request.request.subtype} (outbound-only) request_id=${request.request_id}`,
    )
    return
  }

// 五种请求类型：初始化、设模型、设思考预算、设权限模式、打断
  switch (request.request.subtype) {
    case 'initialize':
      // Respond with minimal capabilities — the REPL handles
      // commands, models, and account info itself.
// 初始化只报最小能力：命令、模型、账户信息都由本地界面自己管
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
          response: {
            commands: [],
            output_style: 'normal',
            available_output_styles: ['normal'],
            models: [],
            account: {},
            pid: process.pid,
          },
        },
      }
      break

// 设模型只转给回调，回执固定成功
    case 'set_model':
      onSetModel?.(request.request.model)
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

// 设思考预算同理，回调可选，缺省就当成功
    case 'set_max_thinking_tokens':
      onSetMaxThinkingTokens?.(request.request.max_thinking_tokens)
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

// 设权限模式特殊：回调要返回裁决结果，好让这里能回错误而不是假成功
    case 'set_permission_mode': {
      // The callback returns a policy verdict so we can send an error
      // control_response without importing isAutoModeGateEnabled /
      // isBypassPermissionsModeDisabled here (bootstrap-isolation). If no
      // callback is registered (daemon context, which doesn't wire this —
      // see daemonBridge.ts), return an error verdict rather than a silent
      // false-success: the mode is never actually applied in that context,
      // so success would lie to the client.
// 回调没注册就回错误：那个上下文里模式根本不会生效，回成功等于骗客户端
      const verdict = onSetPermissionMode?.(request.request.mode) ?? {
        ok: false,
        error:
          'set_permission_mode is not supported in this context (onSetPermissionMode callback not registered)',
      }
      if (verdict.ok) {
        response = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: request.request_id,
          },
        }
      } else {
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: verdict.error,
          },
        }
      }
      break
    }

// 打断只触发回调，回执固定成功
    case 'interrupt':
      onInterrupt?.()
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

// 未知类型也要回错误，否则服务端会一直等一个永远不会来的回复
    default:
      // Unknown subtype — respond with error so the server doesn't
      // hang waiting for a reply that never comes.
      response = {
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: request.request_id,
          error: `REPL bridge does not handle control_request subtype: ${request.request.subtype}`,
        },
      }
  }

// 所有响应都补上会话号再写出去
  const event = { ...response, session_id: sessionId }
  void transport.write(event)
  logForDebugging(
    `[bridge:repl] Sent control_response for ${request.request.subtype} request_id=${request.request_id} result=${response.response.subtype}`,
  )
}

// ─── Result message (for session archival on teardown) ───────────────────────

// 会话归档用的最小结果消息：服务端要在连接关闭前看到它才会启动归档
/**
 * Build a minimal `SDKResultSuccess` message for session archival.
 * The server needs this event before a WS close to trigger archival.
 */
// 除会话号与随机标识外全是零值，它只是一个信号而不是真实结果
export function makeResultMessage(sessionId: string): SDKResultSuccess {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 0,
    result: '',
    stop_reason: null,
    total_cost_usd: 0,
    usage: { ...EMPTY_USAGE },
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
    uuid: randomUUID(),
  }
}

// ─── BoundedUUIDSet (echo-dedup ring buffer) ─────────────────────────────────

// 有界集合：底层是环形缓冲加哈希集合，容量到了就淘汰最旧的一条
/**
 * FIFO-bounded set backed by a circular buffer. Evicts the oldest entry
 * when capacity is reached, keeping memory usage constant at O(capacity).
 *
 * Messages are added in chronological order, so evicted entries are always
 * the oldest. The caller relies on external ordering (the hook's
 * lastWrittenIndexRef) as the primary dedup — this set is a secondary
 * safety net for echo filtering and race-condition dedup.
 */
// 容量、环形数组与集合三者并存：数组保顺序，集合保常数时间查询
export class BoundedUUIDSet {
  private readonly capacity: number
  private readonly ring: (string | undefined)[]
  private readonly set = new Set<string>()
  private writeIdx = 0

// 构造时按容量开数组，之后不再扩容
  constructor(capacity: number) {
    this.capacity = capacity
    this.ring = new Array<string | undefined>(capacity)
  }

// 重复加入直接返回，避免同一个号占掉两个位置
  add(uuid: string): void {
    if (this.set.has(uuid)) return
    // Evict the entry at the current write position (if occupied)
    const evicted = this.ring[this.writeIdx]
    if (evicted !== undefined) {
      this.set.delete(evicted)
    }
    this.ring[this.writeIdx] = uuid
    this.set.add(uuid)
// 写指针取模回到开头，这就是环形缓冲的全部机制
    this.writeIdx = (this.writeIdx + 1) % this.capacity
  }

  has(uuid: string): boolean {
    return this.set.has(uuid)
  }

  clear(): void {
    this.set.clear()
    this.ring.fill(undefined)
    this.writeIdx = 0
  }
}
