// CCR session polling for /ultraplan. Waits for an approved ExitPlanMode
// tool_result, then extracts the plan text. Uses pollRemoteSessionEvents
// (shared with RemoteAgentTask) for pagination + typed SDKMessage[].
// Plan mode is set via set_permission_mode control_request in
// teleportToRemote's CreateSession events array.

import type {
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../../tools/ExitPlanModeTool/constants.js'
import { logForDebugging } from '../debug.js'
import { sleep } from '../sleep.js'
import { isTransientNetworkError } from '../teleport/api.js'
import {
  type PollRemoteSessionResponse,
  pollRemoteSessionEvents,
} from '../teleport.js'
// 本文件实现 /ultraplan 的 CCR 会话轮询：等待浏览器里用户批准 ExitPlanMode，再抽取计划文本，复用 RemoteAgentTask 的分页与事件类型。

const POLL_INTERVAL_MS = 3000
// pollRemoteSessionEvents doesn't retry. A 30min poll makes ~600 calls;
// at any nonzero 5xx rate one blip would kill the run.
const MAX_CONSECUTIVE_FAILURES = 5
// 轮询常量：3 秒间隔；pollRemoteSessionEvents 不重试，故设最大连续失败次数以免一次网络抖动中断整轮。

export type PollFailReason =
  | 'terminated'
  | 'timeout_pending'
  | 'timeout_no_plan'
  | 'extract_marker_missing'
  | 'network_or_unknown'
  | 'stopped'

export class UltraplanPollError extends Error {
  constructor(
    message: string,
    readonly reason: PollFailReason,
    readonly rejectCount: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'UltraplanPollError'
  }
}
// UltraplanPollError：携带失败原因与拒绝计数的自定义错误，区分终止、超时、抽取缺失、网络异常等。

// Sentinel string the browser PlanModal includes in the feedback when the user
// clicks "teleport back to terminal". Plan text follows on the next line.
export const ULTRAPLAN_TELEPORT_SENTINEL = '__ULTRAPLAN_TELEPORT_LOCAL__'
// ULTRAPLAN_TELEPORT_SENTINEL：浏览器在反馈里写入的哨兵串，表示用户选择传回终端执行，计划文本紧随其后。

export type ScanResult =
  | { kind: 'approved'; plan: string }
  | { kind: 'teleport'; plan: string }
  | { kind: 'rejected'; id: string }
  | { kind: 'pending' }
  | { kind: 'terminated'; subtype: string }
  | { kind: 'unchanged' }

/**
 * Pill/detail-view state derived from the event stream. Transitions:
 *   running → (turn ends, no ExitPlanMode) → needs_input
 *   needs_input → (user replies in browser) → running
 *   running → (ExitPlanMode emitted, no result yet) → plan_ready
 *   plan_ready → (rejected) → running
 *   plan_ready → (approved) → poll resolves, pill removed
 */
export type UltraplanPhase = 'running' | 'needs_input' | 'plan_ready'
// UltraplanPhase：运行/待输入/计划就绪三态，由事件流推导；传送或批准都会让轮询结束。

/**
 * Pure stateful classifier for the CCR event stream. Ingests SDKMessage[]
 * batches (as delivered by pollRemoteSessionEvents) and returns the current
 * ExitPlanMode verdict. No I/O, no timers — feed it synthetic or recorded
 * events for unit tests and offline replay.
 *
 * Precedence (approved > terminated > rejected > pending > unchanged):
 * pollRemoteSessionEvents paginates up to 50 pages per call, so one ingest
 * can span seconds of session activity. A batch may contain both an approved
 * tool_result AND a subsequent {type:'result'} (user approved, then remote
 * crashed). The approved plan is real and in threadstore — don't drop it.
 */
export class ExitPlanModeScanner {
  private exitPlanCalls: string[] = []
  private results = new Map<string, ToolResultBlockParam>()
  private rejectedIds = new Set<string>()
  private terminated: { subtype: string } | null = null
  private rescanAfterRejection = false
  everSeenPending = false

  get rejectCount(): number {
    return this.rejectedIds.size
  }

  /**
   * True when an ExitPlanMode tool_use exists with no tool_result yet —
   * the remote is showing the approval dialog in the browser.
   */
  get hasPendingPlan(): boolean {
    const id = this.exitPlanCalls.findLast(c => !this.rejectedIds.has(c))
    return id !== undefined && !this.results.has(id)
  }

  ingest(newEvents: SDKMessage[]): ScanResult {
    for (const m of newEvents) {
      if (m.type === 'assistant') {
        for (const block of m.message.content) {
          if (block.type !== 'tool_use') continue
          const tu = block as ToolUseBlock
          if (tu.name === EXIT_PLAN_MODE_V2_TOOL_NAME) {
            this.exitPlanCalls.push(tu.id)
          }
        }
      } else if (m.type === 'user') {
        const content = m.message.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (block.type === 'tool_result') {
            this.results.set(block.tool_use_id, block)
          }
        }
      } else if (m.type === 'result' && m.subtype !== 'success') {
        // result(success) fires after EVERY CCR turn
        // If the remote asks a clarifying question (turn ends without
        // ExitPlanMode), we must keep polling — the user can reply in
        // the browser and reach ExitPlanMode in a later turn.
        // Only error subtypes (error_during_execution, error_max_turns,
        // etc.) mean the session is actually dead.
        this.terminated = { subtype: m.subtype }
      }
    }

    // Skip-scan when nothing could have moved the target: no new events, no
    // rejection last tick. A rejection moves the newest-non-rejected target.
    const shouldScan = newEvents.length > 0 || this.rescanAfterRejection
    this.rescanAfterRejection = false

    let found:
      | { kind: 'approved'; plan: string }
      | { kind: 'teleport'; plan: string }
      | { kind: 'rejected'; id: string }
      | { kind: 'pending' }
      | null = null
    if (shouldScan) {
      for (let i = this.exitPlanCalls.length - 1; i >= 0; i--) {
        const id = this.exitPlanCalls[i]!
        if (this.rejectedIds.has(id)) continue
        const tr = this.results.get(id)
        if (!tr) {
          found = { kind: 'pending' }
        } else if (tr.is_error === true) {
          const teleportPlan = extractTeleportPlan(tr.content)
          found =
            teleportPlan !== null
              ? { kind: 'teleport', plan: teleportPlan }
              : { kind: 'rejected', id }
        } else {
          found = { kind: 'approved', plan: extractApprovedPlan(tr.content) }
        }
        break
      }
      if (found?.kind === 'approved' || found?.kind === 'teleport') return found
    }

    // Bookkeeping before the terminated check — a batch can contain BOTH a
    // rejected tool_result and a {type:'result'}; rejectCount must reflect
    // the rejection even though terminated takes return precedence.
    if (found?.kind === 'rejected') {
      this.rejectedIds.add(found.id)
      this.rescanAfterRejection = true
    }
    if (this.terminated) {
      return { kind: 'terminated', subtype: this.terminated.subtype }
    }
    if (found?.kind === 'rejected') {
      return found
    }
    if (found?.kind === 'pending') {
      this.everSeenPending = true
      return found
    }
    return { kind: 'unchanged' }
  }
}
// ExitPlanModeScanner：纯状态分类器，吞入 SDKMessage 批次并返回当前判定，无 I/O、无定时器，便于单测与离线回放。

export type PollResult = {
  plan: string
  rejectCount: number
  /** 'local' = user clicked teleport (execute here, archive remote). 'remote' = user approved in-CCR execution (don't archive). */
  executionTarget: 'local' | 'remote'
}

// PollResult：返回获批计划文本与执行目标（本地传送或远端批准），决定后续是否归档远端会话。
// Returns the approved plan text and where the user wants it executed.
// 'approved' scrapes from the "## Approved Plan:" marker (ExitPlanModeV2Tool
// default branch) — the model writes plan to a file inside CCR and calls
// ExitPlanMode({allowedPrompts}), so input.plan is never in threadstore.
// 'teleport' scrapes from the ULTRAPLAN_TELEPORT_SENTINEL in a deny tool_result —
// browser sends a rejection so the remote stays in plan mode, with the plan
// text embedded in the feedback. Normal rejections (is_error === true, no
// sentinel) are tracked and skipped so the user can iterate in the browser.
export async function pollForApprovedExitPlanMode(
  sessionId: string,
  timeoutMs: number,
  onPhaseChange?: (phase: UltraplanPhase) => void,
  shouldStop?: () => boolean,
): Promise<PollResult> {
  const deadline = Date.now() + timeoutMs
  const scanner = new ExitPlanModeScanner()
  let cursor: string | null = null
  let failures = 0
  let lastPhase: UltraplanPhase = 'running'

  while (Date.now() < deadline) {
    if (shouldStop?.()) {
      throw new UltraplanPollError(
        'poll stopped by caller',
        'stopped',
        scanner.rejectCount,
      )
    }
    let newEvents: SDKMessage[]
    let sessionStatus: PollRemoteSessionResponse['sessionStatus']
    try {
      // Metadata fetch (session_status) is the needs_input signal —
      // threadstore doesn't persist result(success) turn-end events, so
      // idle status is the only authoritative "remote is waiting" marker.
      const resp = await pollRemoteSessionEvents(sessionId, cursor)
      newEvents = resp.newEvents
      cursor = resp.lastEventId
      sessionStatus = resp.sessionStatus
      failures = 0
    } catch (e) {
      const transient = isTransientNetworkError(e)
      if (!transient || ++failures >= MAX_CONSECUTIVE_FAILURES) {
        throw new UltraplanPollError(
          e instanceof Error ? e.message : String(e),
          'network_or_unknown',
          scanner.rejectCount,
          { cause: e },
        )
      }
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    let result: ScanResult
    try {
      result = scanner.ingest(newEvents)
    } catch (e) {
      throw new UltraplanPollError(
        e instanceof Error ? e.message : String(e),
        'extract_marker_missing',
        scanner.rejectCount,
      )
    }
    if (result.kind === 'approved') {
      return {
        plan: result.plan,
        rejectCount: scanner.rejectCount,
        executionTarget: 'remote',
      }
    }
    if (result.kind === 'teleport') {
      return {
        plan: result.plan,
        rejectCount: scanner.rejectCount,
        executionTarget: 'local',
      }
    }
    if (result.kind === 'terminated') {
      throw new UltraplanPollError(
        `remote session ended (${result.subtype}) before plan approval`,
        'terminated',
        scanner.rejectCount,
      )
    }
    // plan_ready from the event stream wins; otherwise idle session status
    // means the remote asked a question and is waiting for a browser reply.
    // requires_action with no pending plan is also needs_input — the remote
    // may be blocked on a non-ExitPlanMode permission prompt.
    // CCR briefly flips to 'idle' between tool turns (see STABLE_IDLE_POLLS
    // in RemoteAgentTask). Only trust idle when no new events arrived —
    // events flowing means the session is working regardless of the status
    // snapshot. This also makes needs_input → running snap back on the first
    // poll that sees the user's reply event, even if session_status lags.
    const quietIdle =
      (sessionStatus === 'idle' || sessionStatus === 'requires_action') &&
      newEvents.length === 0
    const phase: UltraplanPhase = scanner.hasPendingPlan
      ? 'plan_ready'
      : quietIdle
        ? 'needs_input'
        : 'running'
    if (phase !== lastPhase) {
      logForDebugging(`[ultraplan] phase ${lastPhase} → ${phase}`)
      lastPhase = phase
      onPhaseChange?.(phase)
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new UltraplanPollError(
    scanner.everSeenPending
      ? `no approval after ${timeoutMs / 1000}s`
      : `ExitPlanMode never reached after ${timeoutMs / 1000}s (the remote container failed to start, or session ID mismatch?)`,
    scanner.everSeenPending ? 'timeout_pending' : 'timeout_no_plan',
    scanner.rejectCount,
  )
}
// pollForApprovedExitPlanMode：主轮询循环，按优先级判定批准/传送/终止/待输入，超时按是否见过待定态给出不同错误。

// tool_result content may be string or [{type:'text',text}] depending on
// threadstore encoding.
function contentToText(content: ToolResultBlockParam['content']): string {
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => ('text' in b ? b.text : '')).join('')
      : ''
}
// contentToText：把 tool_result 的内容（字符串或文本块数组）统一转成字符串，兼容 threadstore 不同编码。

// Extracts the plan text after the ULTRAPLAN_TELEPORT_SENTINEL marker.
// Returns null when the sentinel is absent — callers treat null as a normal
// user rejection (scanner falls through to { kind: 'rejected' }).
function extractTeleportPlan(
  content: ToolResultBlockParam['content'],
): string | null {
  const text = contentToText(content)
  const marker = `${ULTRAPLAN_TELEPORT_SENTINEL}\n`
  const idx = text.indexOf(marker)
  if (idx === -1) return null
  return text.slice(idx + marker.length).trimEnd()
}
// extractTeleportPlan：在哨兵串后截取计划文本；哨兵缺失返回 null，调用方视为普通拒绝。

// Plan is echoed in tool_result content as "## Approved Plan:\n<text>" or
// "## Approved Plan (edited by user):\n<text>" (ExitPlanModeV2Tool).
function extractApprovedPlan(content: ToolResultBlockParam['content']): string {
  const text = contentToText(content)
  // Try both markers — edited plans use a different label.
  const markers = [
    '## Approved Plan (edited by user):\n',
    '## Approved Plan:\n',
  ]
  for (const marker of markers) {
    const idx = text.indexOf(marker)
    if (idx !== -1) {
      return text.slice(idx + marker.length).trimEnd()
    }
  }
  throw new Error(
    `ExitPlanMode approved but tool_result has no "## Approved Plan:" marker — remote may have hit the empty-plan or isAgent branch. Content preview: ${text.slice(0, 200)}`,
  )
}
// extractApprovedPlan：从两种不同标签下截取已批准计划文本，缺失则抛出明确错误便于排查。
