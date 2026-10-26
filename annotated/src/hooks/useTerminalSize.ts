import { useContext } from 'react'
import {
  type TerminalSize,
  TerminalSizeContext,
} from 'src/ink/components/TerminalSizeContext.js'

export function useTerminalSize(): TerminalSize {
// 从 TerminalSizeContext 取终端尺寸；必须在 Ink App 组件内使用。
  const size = useContext(TerminalSizeContext)

  if (!size) {
    throw new Error('useTerminalSize must be used within an Ink App component')
// 取不到 context 直接抛错，提示使用位置错误（非 Ink App 内）。
  }

  return size
}
