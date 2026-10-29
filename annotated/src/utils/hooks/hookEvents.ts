/**
 * Hook event system for broadcasting hook execution events.
 *
 * This module provides a generic event system that is separate from the
 * main message stream. Handlers can register to receive events and decide
 * what to do with them (e.g., convert to SDK messages, log, etc.).
 */
// 文件总述：hook 执行事件的广播系统，与主流消息流相互独立。处理器自行注册来接收事件，并决定如何处理（转成 SDK 消息、记日志等）。

import { HOOK_EVENTS } from 'src/entrypoints/sdk/coreTypes.js'

import { logForDebugging } from '../debug.js'

/**
 * Hook events that are always emitted regardless of the includeHookEvents
 * option. These are low-noise lifecycle events that were in the original
 * allowlist and are backwards-compatible.
 */
const ALWAYS_EMITTED_HOOK_EVENTS = ['SessionStart', 'Setup'] as const
// ALWAYS_EMITTED_HOOK_EVENTS：始终广播的低噪声生命周期事件（SessionStart、Setup），属于原始的允许列表且向后兼容。

const MAX_PENDING_EVENTS = 100
// MAX_PENDING_EVENTS：尚未注册处理器时最多缓存 100 个事件，超出丢弃最旧的。

export type HookStartedEvent = {
  type: 'started'
  hookId: string
  hookName: string
  hookEvent: string
}

export type HookProgressEvent = {
  type: 'progress'
  hookId: string
  hookName: string
  hookEvent: string
  stdout: string
  stderr: string
  output: string
}

export type HookResponseEvent = {
  type: 'response'
  hookId: string
  hookName: string
  hookEvent: string
  output: string
  stdout: string
  stderr: string
  exitCode?: number
  outcome: 'success' | 'error' | 'cancelled'
}

export type HookExecutionEvent =
  | HookStartedEvent
  | HookProgressEvent
  | HookResponseEvent
export type HookEventHandler = (event: HookExecutionEvent) => void
// HookExecutionEvent 联合类型：包含 started、progress、response 三种事件。

const pendingEvents: HookExecutionEvent[] = []
let eventHandler: HookEventHandler | null = null
let allHookEventsEnabled = false

export function registerHookEventHandler(
  handler: HookEventHandler | null,
): void {
  eventHandler = handler
  if (handler && pendingEvents.length > 0) {
    for (const event of pendingEvents.splice(0)) {
      handler(event)
    }
  }
}
// registerHookEventHandler：注册处理器，若有积压事件则补发全部。

function emit(event: HookExecutionEvent): void {
  if (eventHandler) {
    eventHandler(event)
  } else {
    pendingEvents.push(event)
    if (pendingEvents.length > MAX_PENDING_EVENTS) {
      pendingEvents.shift()
    }
  }
}
// emit：有处理器立即推送，否则入队（超量丢最旧）。

function shouldEmit(hookEvent: string): boolean {
  if ((ALWAYS_EMITTED_HOOK_EVENTS as readonly string[]).includes(hookEvent)) {
    return true
  }
  return (
    allHookEventsEnabled &&
    (HOOK_EVENTS as readonly string[]).includes(hookEvent)
  )
}
// shouldEmit：事件在白名单内，或全局开启且属于 HOOK_EVENTS 时才广播。

export function emitHookStarted(
  hookId: string,
  hookName: string,
  hookEvent: string,
): void {
  if (!shouldEmit(hookEvent)) return

  emit({
    type: 'started',
    hookId,
    hookName,
    hookEvent,
  })
}
// emitHookStarted：广播 started 事件。

export function emitHookProgress(data: {
  hookId: string
  hookName: string
  hookEvent: string
  stdout: string
  stderr: string
  output: string
}): void {
  if (!shouldEmit(data.hookEvent)) return

  emit({
    type: 'progress',
    ...data,
  })
}
// emitHookProgress：广播 progress 事件。

export function startHookProgressInterval(params: {
  hookId: string
  hookName: string
  hookEvent: string
  getOutput: () => Promise<{ stdout: string; stderr: string; output: string }>
  intervalMs?: number
}): () => void {
  if (!shouldEmit(params.hookEvent)) return () => {}

  let lastEmittedOutput = ''
  const interval = setInterval(() => {
    void params.getOutput().then(({ stdout, stderr, output }) => {
      if (output === lastEmittedOutput) return
      lastEmittedOutput = output
      emitHookProgress({
        hookId: params.hookId,
        hookName: params.hookName,
        hookEvent: params.hookEvent,
        stdout,
        stderr,
        output,
      })
    })
  }, params.intervalMs ?? 1000)
  interval.unref()

  return () => clearInterval(interval)
}
// startHookProgressInterval：定时轮询输出并广播进度；interval.unref 使其不阻止进程退出。

export function emitHookResponse(data: {
  hookId: string
  hookName: string
  hookEvent: string
  output: string
  stdout: string
  stderr: string
  exitCode?: number
  outcome: 'success' | 'error' | 'cancelled'
}): void {
  // Always log full hook output to debug log for verbose mode debugging
  const outputToLog = data.stdout || data.stderr || data.output
  if (outputToLog) {
    logForDebugging(
      `Hook ${data.hookName} (${data.hookEvent}) ${data.outcome}:\n${outputToLog}`,
    )
  }

  if (!shouldEmit(data.hookEvent)) return

  emit({
    type: 'response',
    ...data,
  })
}
// emitHookResponse：先把完整 hook 输出写入调试日志（详细模式排障用），再按开关广播 response。

/**
 * Enable emission of all hook event types (beyond SessionStart and Setup).
 * Called when the SDK `includeHookEvents` option is set or when running
 * in CLAUDE_CODE_REMOTE mode.
 */
export function setAllHookEventsEnabled(enabled: boolean): void {
  allHookEventsEnabled = enabled
}
// setAllHookEventsEnabled：开启全部 hook 事件类型（SDK 设 includeHookEvents 或运行在 CCR 远程模式时调用）。

export function clearHookEventState(): void {
  eventHandler = null
  pendingEvents.length = 0
  allHookEventsEnabled = false
}
// clearHookEventState：重置处理器、积压队列与开关，用于测试或重载。
