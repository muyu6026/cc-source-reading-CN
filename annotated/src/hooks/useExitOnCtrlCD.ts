import { useCallback, useMemo, useState } from 'react'
import useApp from '../ink/hooks/use-app.js'
import type { KeybindingContextName } from '../keybindings/types.js'
import { useDoublePress } from './useDoublePress.js'

export type ExitState = {
  pending: boolean
  keyName: 'Ctrl-C' | 'Ctrl-D' | null
}

type KeybindingOptions = {
  context?: KeybindingContextName
  isActive?: boolean
}

type UseKeybindingsHook = (
  handlers: Record<string, () => void>,
  options?: KeybindingOptions,
) => void

/**
 * Handle ctrl+c and ctrl+d for exiting the application.
 *
 * Uses a time-based double-press mechanism:
 * - First press: Shows "Press X again to exit" message
 * - Second press within timeout: Exits the application
 *
 * Note: We use time-based double-press rather than the chord system because
 * we want the first ctrl+c to also trigger interrupt (handled elsewhere).
 * The chord system would prevent the first press from firing any action.
 *
 * These keys are hardcoded and cannot be rebound via keybindings.json.
 *
 * @param useKeybindingsHook - The useKeybindings hook to use for registering handlers
 *                            (dependency injection to avoid import cycles)
 * @param onInterrupt - Optional callback for features to handle interrupt (ctrl+c).
 *                      Return true if handled, false to fall through to double-press exit.
 * @param onExit - Optional custom exit handler
 * @param isActive - Whether the keybinding is active (default true). Set false
 *                   while an embedded TextInput is focused — TextInput's own
 *                   ctrl+c/d handlers will manage cancel/exit, and Dialog's
 *                   handler would otherwise double-fire (child useInput runs
 *                   before parent useKeybindings, so both see every keypress).
 */
// 块注释：ctrl+c/d 退出采用基于时间的双按机制（首次显示「再按一次退出」，超时内二次退出）；不用 chord 系统因首次按下需触发中断；键硬编码不可重绑；onInterrupt 让 feature 先处理中断。
export function useExitOnCtrlCD(
  useKeybindingsHook: UseKeybindingsHook,
  onInterrupt?: () => boolean,
  onExit?: () => void,
  isActive = true,
): ExitState {
// 注入 useKeybindingsHook 避免 import 循环；isActive 默认 true，嵌入 TextInput 聚焦时设 false（子 useInput 先于父 useKeybindings 跑，否则同一按键父子 handler 双发）。
  const { exit } = useApp()
  const [exitState, setExitState] = useState<ExitState>({
    pending: false,
    keyName: null,
  })

  const exitFn = useMemo(() => onExit ?? exit, [onExit, exit])
// exitFn = onExit ?? exit：自定义退出处理器优先，否则用全局 useApp().exit。

  // Double-press handler for ctrl+c
  const handleCtrlCDoublePress = useDoublePress(
    pending => setExitState({ pending, keyName: 'Ctrl-C' }),
    exitFn,
  )

  // Double-press handler for ctrl+d
  const handleCtrlDDoublePress = useDoublePress(
    pending => setExitState({ pending, keyName: 'Ctrl-D' }),
    exitFn,
  )
// ctrl+c 与 ctrl+d 各一个 double-press handler：首次置 pending（显示「再按一次退出」），超时内二次调用 exitFn 真正退出。

  // Handler for app:interrupt (ctrl+c by default)
  // Let features handle interrupt first via callback
  const handleInterrupt = useCallback(() => {
    if (onInterrupt?.()) return // Feature handled it
    handleCtrlCDoublePress()
  }, [handleCtrlCDoublePress, onInterrupt])

  // Handler for app:exit (ctrl+d by default)
  // This also uses double-press to confirm exit
  const handleExit = useCallback(() => {
    handleCtrlDDoublePress()
  }, [handleCtrlDDoublePress])
// handleInterrupt 先让 feature 经 onInterrupt 处理（返回 true 短路），否则走 ctrl+c double-press；handleExit 直接走 ctrl+d double-press。

  const handlers = useMemo(
    () => ({
      'app:interrupt': handleInterrupt,
      'app:exit': handleExit,
    }),
    [handleInterrupt, handleExit],
  )

  useKeybindingsHook(handlers, { context: 'Global', isActive })
// 注册 app:interrupt / app:exit 到 Global context；isActive 可关，避免嵌入 TextInput 时父子 handler 双发（child 先跑）。

  return exitState
}
