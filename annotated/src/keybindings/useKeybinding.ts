import { useCallback, useEffect } from 'react'
import type { InputEvent } from '../ink/events/input-event.js'
import { type Key, useInput } from '../ink.js'
import { useOptionalKeybindingContext } from './KeybindingContext.js'
import type { KeybindingContextName } from './types.js'

// Options 只暴露两个开关：绑定归属哪个上下文、以及该处理器是否启用；其余判定都委托给上下文对象
type Options = {
  /** Which context this binding belongs to (default: 'Global') */
  context?: KeybindingContextName
  /** Only handle when active (like useInput's isActive) */
  isActive?: boolean
}

/**
 * Ink-native hook for handling a keybinding.
 *
 * The handler stays in the component (React way).
 * The binding (keystroke → action) comes from config.
 *
 * Supports chord sequences (e.g., "ctrl+k ctrl+s"). When a chord is started,
 * the hook will manage the pending state automatically.
 *
 * Uses stopImmediatePropagation() to prevent other handlers from firing
 * once this binding is handled.
 *
 * @example
 * ```tsx
 * useKeybinding('app:toggleTodos', () => {
 *   setShowTodos(prev => !prev)
 * }, { context: 'Global' })
 * ```
 */
// 核心 hook：把处理器注册进上下文、用 useInput 收按键、命中时阻止冒泡
export function useKeybinding(
  action: string,
  handler: () => void | false | Promise<void>,
  options: Options = {},
): void {
// 解构默认值：上下文默认全局、启用默认开；配置不传就用兜底
  const { context = 'Global', isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  // Register handler with the context for ChordInterceptor to invoke
// 副作用里注册处理器：依赖变化就先注销再重挂，避免旧闭包滞留
  useEffect(() => {
    if (!keybindingContext || !isActive) return
    return keybindingContext.registerHandler({ action, context, handler })
  }, [action, context, handler, keybindingContext, isActive])

// 真正处理按键的回调：先把当前上下文与全局排成优先级序列再解析
  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      // If no keybinding context available, skip resolution
      if (!keybindingContext) return

      // Build context list: registered active contexts + this context + Global
      // More specific contexts (registered ones) take precedence over Global
// 上下文列表顺序即优先级：已激活的注册上下文最优先，其次当前上下文，最后全局兜底
      const contextsToCheck: KeybindingContextName[] = [
        ...keybindingContext.activeContexts,
        context,
        'Global',
      ]
      // Deduplicate while preserving order (first occurrence wins for priority)
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

// 按解析结果分五种情况处理：命中、和弦起手、和弦取消、显式解绑、未绑定
      switch (result.type) {
        case 'match':
          // Chord completed (if any) - clear pending state
          keybindingContext.setPendingChord(null)
          if (result.action === action) {
            if (handler() !== false) {
// 只有处理器返回非 false 才拦截冒泡：返回 false 表示事件不消费、放行给后续处理器
              event.stopImmediatePropagation()
            }
          }
          break
        case 'chord_started':
          // User started a chord sequence - update pending state
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case 'chord_cancelled':
          // Chord was cancelled (escape or invalid key)
          keybindingContext.setPendingChord(null)
          break
        case 'unbound':
          // Explicitly unbound - clear any pending chord
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case 'none':
          // No match - let other handlers try
          break
      }
    },
    [action, context, handler, keybindingContext],
  )

// 把处理回调交给 useInput，由 Ink 在每次按键时调用
  useInput(handleInput, { isActive })
}

/**
 * Handle multiple keybindings in one hook (reduces useInput calls).
 *
 * Supports chord sequences. When a chord is started, the hook will
 * manage the pending state automatically.
 *
 * @example
 * ```tsx
 * useKeybindings({
 *   'chat:submit': () => handleSubmit(),
 *   'chat:cancel': () => handleCancel(),
 * }, { context: 'Chat' })
 * ```
 */
// 多绑定版本：一次 hook 注册一组动作，减少 useInput 的调用开销
export function useKeybindings(
  // Handler returning `false` means "not consumed" — the event propagates
  // to later useInput/useKeybindings handlers. Useful for fall-through:
  // e.g. ScrollKeybindingHandler's scroll:line* returns false when the
  // ScrollBox content fits (scroll is a no-op), letting a child component's
  // handler take the wheel event for list navigation instead. Promise<void>
  // is allowed for fire-and-forget async handlers (the `!== false` check
  // only skips propagation for a sync `false`, not a pending Promise).
  handlers: Record<string, () => void | false | Promise<void>>,
  options: Options = {},
): void {
// 与单绑定版本同样的默认值解构
  const { context = 'Global', isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  // Register all handlers with the context for ChordInterceptor to invoke
// 这里要注销所有处理器：用数组收集每个注册的返回函数，卸载时统一调用
  useEffect(() => {
    if (!keybindingContext || !isActive) return

    const unregisterFns: Array<() => void> = []
    for (const [action, handler] of Object.entries(handlers)) {
      unregisterFns.push(
        keybindingContext.registerHandler({ action, context, handler }),
      )
    }

    return () => {
      for (const unregister of unregisterFns) {
        unregister()
      }
    }
  }, [context, handlers, keybindingContext, isActive])

// 多绑定的按键处理与单绑定同构，只是用 handlers 字典按动作名查处理器
  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      // If no keybinding context available, skip resolution
      if (!keybindingContext) return

      // Build context list: registered active contexts + this context + Global
      // More specific contexts (registered ones) take precedence over Global
      const contextsToCheck: KeybindingContextName[] = [
        ...keybindingContext.activeContexts,
        context,
        'Global',
      ]
      // Deduplicate while preserving order (first occurrence wins for priority)
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

// 同样是五种情况的分派，区别在命中后按动作名查表取出对应处理器
      switch (result.type) {
        case 'match':
          // Chord completed (if any) - clear pending state
          keybindingContext.setPendingChord(null)
          if (result.action in handlers) {
            const handler = handlers[result.action]
            if (handler && handler() !== false) {
              event.stopImmediatePropagation()
            }
          }
          break
        case 'chord_started':
          // User started a chord sequence - update pending state
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case 'chord_cancelled':
          // Chord was cancelled (escape or invalid key)
          keybindingContext.setPendingChord(null)
          break
        case 'unbound':
          // Explicitly unbound - clear any pending chord
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case 'none':
          // No match - let other handlers try
          break
      }
    },
    [context, handlers, keybindingContext],
  )

// 多绑定版本同样把回调交给 useInput
  useInput(handleInput, { isActive })
}
