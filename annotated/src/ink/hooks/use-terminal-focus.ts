import { useContext } from 'react'
import TerminalFocusContext from '../components/TerminalFocusContext.js'

/**
 * Hook to check if the terminal has focus.
 *
 * Uses DECSET 1004 focus reporting - the terminal sends escape sequences
 * when it gains or loses focus. These are handled automatically
 * by Ink and filtered from useInput.
 *
 * @returns true if the terminal is focused (or focus state is unknown)
 */
export function useTerminalFocus(): boolean {
// 【「未知」被当成「有焦点」】
//
// 默认 context 值是 isTerminalFocused: true，focusState: 'unknown'。
// 所以启动时（还没收到任何 CSI I / CSI O）所有依赖焦点的逻辑都按
// 「有焦点」处理 —— 动画全速跑、输入框正常响应。
//
// 反过来选（未知 = 无焦点）会让应用在启动那一瞬间降速，而且很多
// 终端压根不支持 DECSET 1004，那些用户就永远停在「无焦点」。
// 也就是说这个默认值是「乐观假设 + 不支持时不惩罚」，不是随手写的。
//
// 另外 App 那边有个兜底（App.tsx:495）：**只要收到任何输入，
// 就认为终端有焦点**。所以哪怕 1004 全程失效，用户一敲键盘也能
// 自己纠正过来。
  const { isTerminalFocused } = useContext(TerminalFocusContext)
  return isTerminalFocused
}
