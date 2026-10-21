import { createContext } from 'react'
import type { DOMElement } from '../dom.js'

export type CursorDeclaration = {
  /** Display column (terminal cell width) within the declared node */
  readonly relativeX: number
  /** Line number within the declared node */
  readonly relativeY: number
  /** The ink-box DOMElement whose yoga layout provides the absolute origin */
  readonly node: DOMElement
}

/**
 * Setter for the declared cursor position.
 *
 * The optional second argument makes `null` a conditional clear: the
 * declaration is only cleared if the currently-declared node matches
 * `clearIfNode`. This makes the hook safe for sibling components
 * (e.g. list items) that transfer focus among themselves — without the
 * node check, a newly-unfocused item's clear could clobber a
 * newly-focused sibling's set depending on layout-effect order.
 */
export type CursorDeclarationSetter = (
  declaration: CursorDeclaration | null,
  clearIfNode?: DOMElement | null,
) => void
// 【第二个参数是这个类型里唯一有意思的部分：条件清除】
//
//   setCursorDeclaration(null, node)   → 只有当「当前声明的节点」
//                                        正好是 node 时才清
//   setCursorDeclaration(null)         → 无条件清
//
// 为什么需要它：光标声明是**全局唯一**的（一个终端只有一个光标），
// 而声明它的组件可能有很多（多个输入框、多个列表项）。焦点在它们
// 之间转移时，layout effect 的执行顺序是「按组件树顺序」，不是
// 「按逻辑顺序」——
//
//   焦点从第 5 项移到第 2 项时，第 5 项的「清除」可能跑在第 2 项的
//   「设置」**之后**，于是刚刚设好的声明被清掉了
//
// 加上节点身份判断之后，第 5 项的清除会发现「当前声明的节点不是我了」
// 于是跳过 —— 顺序问题被化解成幂等操作。这也是 useDeclaredCursor
// 里那个无依赖 layout effect 的另一半（见那里的批注）。

const CursorDeclarationContext = createContext<CursorDeclarationSetter>(
  () => {},
)

export default CursorDeclarationContext
