// 文件级：本文件管理「会话级」内存 hook——增删查命令 hook、提示 hook 与函数 hook，全部存进 `AppState` 里一个按会话 ID 索引的 `Map`，会话结束即清空，不落盘到 `settings.json`。
import { HOOK_EVENTS, type HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import type { Message } from 'src/types/message.js'
import { logForDebugging } from '../debug.js'
import type { AggregatedHookResult } from '../hooks.js'
import type { HookCommand } from '../settings/types.js'
import { isHookEqual } from './hooksSettings.js'

type OnHookSuccess = (
  hook: HookCommand | FunctionHook,
  result: AggregatedHookResult,
) => void
// `OnHookSuccess`：hook 执行成功后回调的类型，拿到 hook 与聚合结果，用于后续联动。

/** Function hook callback - returns true if check passes, false to block */
// `FunctionHookCallback`：函数 hook 的回调签名，收到消息列表与中止信号，返回是否放行（布尔或承诺）。
export type FunctionHookCallback = (
  messages: Message[],
  signal?: AbortSignal,
) => boolean | Promise<boolean>

/**
 * Function hook type with callback embedded.
 * Session-scoped only, cannot be persisted to settings.json.
 */
export type FunctionHook = {
  type: 'function'
  id?: string // Optional unique ID for removal
  timeout?: number
  callback: FunctionHookCallback
  errorMessage: string
  statusMessage?: string
}
// `FunctionHook`：内嵌回调的函数 hook 类型，仅会话级、不能持久化；带可选唯一 ID（便于移除）、超时、错误信息与状态文案。

type SessionHookMatcher = {
  matcher: string
  skillRoot?: string
  hooks: Array<{
    hook: HookCommand | FunctionHook
    onHookSuccess?: OnHookSuccess
  }>
}
// `SessionHookMatcher`：把匹配串、技能根目录与一组 hook 绑在一起，是会话 hook 存储的最小单元。

export type SessionStore = {
  hooks: {
    [event in HookEvent]?: SessionHookMatcher[]
  }
}
// `SessionStore`：按 hook 事件分类，每个事件挂一串 matcher。

/**
 * Map (not Record) so .set/.delete don't change the container's identity.
 * Mutator functions mutate the Map and return prev unchanged, letting
 * store.ts's Object.is(next, prev) check short-circuit and skip listener
 * notification. Session hooks are ephemeral per-agent runtime callbacks,
 * never reactively read (only getAppState() snapshots in the query loop).
 * Same pattern as agentControllers on LocalWorkflowTaskState.
 *
 * This matters under high-concurrency workflows: parallel() with N
 * schema-mode agents fires N addFunctionHook calls in one synchronous
 * tick. With a Record + spread, each call cost O(N) to copy the growing
 * map (O(N²) total) plus fired all ~30 store listeners. With Map: .set()
 * is O(1), return prev means zero listener fires.
 */
export type SessionHooksState = Map<string, SessionStore>
// `SessionHooksState`：会话 ID 到 `SessionStore` 的 `Map`（不用 `Record`），因 `.set`/`.delete` 不改变容器身份，`store.ts` 的 `Object.is` 比较能短路、跳过监听器通知；高并发下 `Map` 的 O(1) 增删也避免 `Record` 展开复制的 O(N²) 代价。

/**
 * Add a command or prompt hook to the session.
 * Session hooks are temporary, in-memory only, and cleared when session ends.
 */
// `addSessionHook`：往会话加一条命令或提示 hook，是对内部 `addHookToSession` 的薄封装。
export function addSessionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand,
  onHookSuccess?: OnHookSuccess,
  skillRoot?: string,
): void {
  addHookToSession(
    setAppState,
    sessionId,
    event,
    matcher,
    hook,
    onHookSuccess,
    skillRoot,
  )
}

/**
 * Add a function hook to the session.
 * Function hooks execute TypeScript callbacks in-memory for validation.
 * @returns The hook ID (for removal)
 */
// `addFunctionHook`：往会话加一条函数 hook，在内存里执行 TypeScript 回调做校验，返回 hook ID 供后续移除。
export function addFunctionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  callback: FunctionHookCallback,
  errorMessage: string,
  options?: {
    timeout?: number
    id?: string
  },
): string {
  const id = options?.id || `function-hook-${Date.now()}-${Math.random()}`
// 若调用方没给 ID，就用时间戳加随机数拼一个唯一 ID。
  const hook: FunctionHook = {
    type: 'function',
    id,
    timeout: options?.timeout || 5000,
    callback,
    errorMessage,
  }
  addHookToSession(setAppState, sessionId, event, matcher, hook)
// 组装好函数 hook 对象后交给 `addHookToSession` 登记，并返回 ID。
  return id
}

/**
 * Remove a function hook by ID from the session.
 */
// `removeFunctionHook`：按 ID 移除某事件的某条函数 hook，从所有 matcher 里过滤掉匹配 ID 的项。
export function removeFunctionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  hookId: string,
): void {
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId)
    if (!store) {
      return prev
    }

    const eventMatchers = store.hooks[event] || []

    // Remove the hook with matching ID from all matchers
// 移除逻辑：对每个 matcher 过滤掉 ID 相同的函数 hook，空了的 matcher 整段删掉，事件下全空则连事件键也移除。
    const updatedMatchers = eventMatchers
      .map(matcher => {
        const updatedHooks = matcher.hooks.filter(h => {
          if (h.hook.type !== 'function') return true
          return h.hook.id !== hookId
        })

        return updatedHooks.length > 0
          ? { ...matcher, hooks: updatedHooks }
          : null
      })
      .filter((m): m is SessionHookMatcher => m !== null)

    const newHooks =
      updatedMatchers.length > 0
        ? { ...store.hooks, [event]: updatedMatchers }
        : Object.fromEntries(
            Object.entries(store.hooks).filter(([e]) => e !== event),
          )

    prev.sessionHooks.set(sessionId, { hooks: newHooks })
// 把更新后的 matcher 列表写回该会话的存储，保持 `prev` 引用不变以跳过通知。
    return prev
  })

  logForDebugging(
    `Removed function hook ${hookId} for event ${event} in session ${sessionId}`,
  )
}

/**
 * Internal helper to add a hook to session state
 */
// `addHookToSession`：真正把 hook 写进会话状态的内部辅助；按匹配串与技能根目录找已有 matcher，有就追加、没有就新建。
function addHookToSession(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
  onHookSuccess?: OnHookSuccess,
  skillRoot?: string,
): void {
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId) ?? { hooks: {} }
    const eventMatchers = store.hooks[event] || []

    // Find existing matcher or create new one
// 先找同匹配串同技能根的现有 matcher，决定是追加到已有项还是新建一项。
    const existingMatcherIndex = eventMatchers.findIndex(
      m => m.matcher === matcher && m.skillRoot === skillRoot,
    )

    let updatedMatchers: SessionHookMatcher[]
    if (existingMatcherIndex >= 0) {
      // Add to existing matcher
      updatedMatchers = [...eventMatchers]
      const existingMatcher = updatedMatchers[existingMatcherIndex]!
      updatedMatchers[existingMatcherIndex] = {
        matcher: existingMatcher.matcher,
        skillRoot: existingMatcher.skillRoot,
        hooks: [...existingMatcher.hooks, { hook, onHookSuccess }],
      }
    } else {
      // Create new matcher
      updatedMatchers = [
        ...eventMatchers,
        {
          matcher,
          skillRoot,
          hooks: [{ hook, onHookSuccess }],
        },
      ]
    }

    const newHooks = { ...store.hooks, [event]: updatedMatchers }
// 把该事件的 matcher 列表整体替换成更新后的版本。

    prev.sessionHooks.set(sessionId, { hooks: newHooks })
// 用 `.set` 写回会话存储，容器身份不变，避免触发所有监听器。
    return prev
  })

  logForDebugging(
    `Added session hook for event ${event} in session ${sessionId}`,
  )
}

/**
 * Remove a specific hook from the session
 * @param setAppState The function to update the app state
 * @param sessionId The session ID
 * @param event The hook event
 * @param hook The hook command to remove
 */
// `removeSessionHook`：按 hook 命令对象移除会话里的指定 hook（不按 ID）。
export function removeSessionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  hook: HookCommand,
): void {
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId)
    if (!store) {
      return prev
    }

    const eventMatchers = store.hooks[event] || []

    // Remove the hook from all matchers
// 从所有 matcher 里过滤掉与该 hook 相等的项，空 matcher 删掉，事件下全空则删事件键。
    const updatedMatchers = eventMatchers
      .map(matcher => {
        const updatedHooks = matcher.hooks.filter(
          h => !isHookEqual(h.hook, hook),
        )

        return updatedHooks.length > 0
          ? { ...matcher, hooks: updatedHooks }
          : null
      })
      .filter((m): m is SessionHookMatcher => m !== null)

    const newHooks =
      updatedMatchers.length > 0
        ? { ...store.hooks, [event]: updatedMatchers }
        : { ...store.hooks }

    if (updatedMatchers.length === 0) {
      delete newHooks[event]
    }

    prev.sessionHooks.set(sessionId, { ...store, hooks: newHooks })
// 写回更新后的存储；函数 hook 不会被 `isHookEqual` 命中，所以这条只删命令/提示类。
    return prev
  })

  logForDebugging(
    `Removed session hook for event ${event} in session ${sessionId}`,
  )
}

// Extended hook matcher that includes optional skillRoot for skill-scoped hooks
// 扩展版 matcher：在普通 matcher 基础上加可选 `skillRoot`，用于技能作用域的 hook。
export type SessionDerivedHookMatcher = {
  matcher: string
  hooks: HookCommand[]
  skillRoot?: string
}
// `SessionDerivedHookMatcher`：对外导出的派生 matcher 形态，hooks 退化成纯命令数组。

/**
 * Convert session hook matchers to regular hook matchers
 * @param sessionMatchers The session hook matchers to convert
 * @returns Regular hook matchers (with optional skillRoot preserved)
 */
// `convertToHookMatchers`：把会话 matcher 转换成普通 matcher，过程中过滤掉函数 hook（函数 hook 无法持久化成 `HookMatcher` 格式）。
function convertToHookMatchers(
  sessionMatchers: SessionHookMatcher[],
): SessionDerivedHookMatcher[] {
  return sessionMatchers.map(sm => ({
    matcher: sm.matcher,
    skillRoot: sm.skillRoot,
    // Filter out function hooks - they can't be persisted to HookMatcher format
// 转换时只保留命令类 hook，函数 hook 因类型不符被剔除。
    hooks: sm.hooks
      .map(h => h.hook)
      .filter((h): h is HookCommand => h.type !== 'function'),
  }))
}

/**
 * Get all session hooks for a specific event (excluding function hooks)
 * @param appState The app state
 * @param sessionId The session ID
 * @param event Optional event to filter by
 * @returns Hook matchers for the event, or all hooks if no event specified
 */
// `getSessionHooks`：取某事件（或全部事件）的会话 hook，返回的 matcher 已过滤掉函数 hook。
export function getSessionHooks(
  appState: AppState,
  sessionId: string,
  event?: HookEvent,
): Map<HookEvent, SessionDerivedHookMatcher[]> {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) {
    return new Map()
  }

  const result = new Map<HookEvent, SessionDerivedHookMatcher[]>()
// 用 `Map` 收集结果，按事件归类成派生 matcher 列表。

  if (event) {
    const sessionMatchers = store.hooks[event]
    if (sessionMatchers) {
      result.set(event, convertToHookMatchers(sessionMatchers))
    }
    return result
  }

  for (const evt of HOOK_EVENTS) {
// 未指定事件时遍历所有 `HOOK_EVENTS`，逐个转换并收集非空结果。
    const sessionMatchers = store.hooks[evt]
    if (sessionMatchers) {
      result.set(evt, convertToHookMatchers(sessionMatchers))
    }
  }

  return result
}

type FunctionHookMatcher = {
  matcher: string
  hooks: FunctionHook[]
}
// `FunctionHookMatcher`：函数 hook 专用的派生 matcher 形态。

/**
 * Get all session function hooks for a specific event
 * Function hooks are kept separate because they can't be persisted to HookMatcher format.
 * @param appState The app state
 * @param sessionId The session ID
 * @param event Optional event to filter by
 * @returns Function hook matchers for the event
 */
// `getSessionFunctionHooks`：取某事件（或全部事件）的会话函数 hook，与命令 hook 分开存储是因为函数 hook 不能持久化。
export function getSessionFunctionHooks(
  appState: AppState,
  sessionId: string,
  event?: HookEvent,
): Map<HookEvent, FunctionHookMatcher[]> {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) {
    return new Map()
  }

  const result = new Map<HookEvent, FunctionHookMatcher[]>()

  const extractFunctionHooks = (
// 内部 `extractFunctionHooks`：从 matcher 里挑出类型为函数的 hook，并丢弃空列表。
    sessionMatchers: SessionHookMatcher[],
  ): FunctionHookMatcher[] => {
    return sessionMatchers
      .map(sm => ({
        matcher: sm.matcher,
        hooks: sm.hooks
          .map(h => h.hook)
          .filter((h): h is FunctionHook => h.type === 'function'),
      }))
      .filter(m => m.hooks.length > 0)
  }

  if (event) {
    const sessionMatchers = store.hooks[event]
    if (sessionMatchers) {
      const functionMatchers = extractFunctionHooks(sessionMatchers)
      if (functionMatchers.length > 0) {
        result.set(event, functionMatchers)
      }
    }
    return result
  }

  for (const evt of HOOK_EVENTS) {
    const sessionMatchers = store.hooks[evt]
    if (sessionMatchers) {
      const functionMatchers = extractFunctionHooks(sessionMatchers)
      if (functionMatchers.length > 0) {
        result.set(evt, functionMatchers)
      }
    }
  }

  return result
}

/**
 * Get the full hook entry (including callbacks) for a specific session hook
 */
// `getSessionHookCallback`：按事件、匹配串与 hook 对象精确查出完整 hook 条目（含 `onHookSuccess` 回调），查不到返回 `undefined`。
export function getSessionHookCallback(
  appState: AppState,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
):
  | {
      hook: HookCommand | FunctionHook
      onHookSuccess?: OnHookSuccess
    }
  | undefined {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) {
    return undefined
  }

  const eventMatchers = store.hooks[event]
  if (!eventMatchers) {
    return undefined
  }

  // Find the hook in the matchers
  for (const matcherEntry of eventMatchers) {
// 遍历该事件的 matcher，匹配串相等或为空时再按 `isHookEqual` 找具体 hook。
    if (matcherEntry.matcher === matcher || matcher === '') {
      const hookEntry = matcherEntry.hooks.find(h => isHookEqual(h.hook, hook))
      if (hookEntry) {
        return hookEntry
      }
    }
  }

  return undefined
}

/**
 * Clear all session hooks for a specific session
 * @param setAppState The function to update the app state
 * @param sessionId The session ID
 */
// `clearSessionHooks`：清空某会话的全部会话 hook，直接从 `Map` 里删掉该会话键。
export function clearSessionHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
): void {
  setAppState(prev => {
    prev.sessionHooks.delete(sessionId)
// 从会话存储里删除该会话 ID，会话结束或重置时调用。
    return prev
  })

  logForDebugging(`Cleared all session hooks for session ${sessionId}`)
}
