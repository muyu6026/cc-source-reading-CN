import { useKeybindings } from '../keybindings/useKeybinding.js'
import { type ExitState, useExitOnCtrlCD } from './useExitOnCtrlCD.js'

export type { ExitState }

/**
 * Convenience hook that wires up useExitOnCtrlCD with useKeybindings.
 *
 * This is the standard way to use useExitOnCtrlCD in components.
 * The separation exists to avoid import cycles - useExitOnCtrlCD.ts
 * doesn't import from the keybindings module directly.
 *
 * @param onExit - Optional custom exit handler
 * @param onInterrupt - Optional callback for features to handle interrupt (ctrl+c).
 *                      Return true if handled, false to fall through to double-press exit.
 * @param isActive - Whether the keybinding is active (default true).
 */
// 便利封装：把 useExitOnCtrlCD 与 useKeybindings 接好，是组件里用退出双按的标准入口。
export function useExitOnCtrlCDWithKeybindings(
  onExit?: () => void,
  onInterrupt?: () => boolean,
  isActive?: boolean,
): ExitState {
  return useExitOnCtrlCD(useKeybindings, onInterrupt, onExit, isActive)
// 拆分是为避 import 循环：useExitOnCtrlCD 不直接引 keybindings 模块，这里再注入。
}
