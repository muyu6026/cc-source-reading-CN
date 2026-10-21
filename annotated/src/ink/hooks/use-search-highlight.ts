import { useContext, useMemo } from 'react'
import StdinContext from '../components/StdinContext.js'
import type { DOMElement } from '../dom.js'
import instances from '../instances.js'
import type { MatchPosition } from '../render-to-screen.js'

/**
 * Set the search highlight query on the Ink instance. Non-empty → all
 * visible occurrences are inverted on the next frame (SGR 7, screen-buffer
 * overlay, same damage machinery as selection). Empty → clears.
 *
 * This is a screen-space highlight — it matches the RENDERED text, not the
 * source message text. Works for anything visible (bash output, file paths,
 * error messages) regardless of where it came from in the message tree. A
 * query that matched in source but got truncated/ellipsized in rendering
 * won't highlight; that's acceptable — we highlight what you see.
 */
// 【这一条最值得记：高亮的是「屏幕上看见的字」，不是「消息里的字」】
//
// 搜索匹配发生在**渲染之后**：先把 DOM 子树画到一个临时 Screen 上，
// 再在那一块屏幕上扫字符串。于是：
//
//   好的一面 —— 被截断、被省略、被语法高亮拆成多个 Text 节点的内容，
//     照样能搜到，因为扫的是最终结果。换一个直接扫消息源文本的实现，
//     这三类内容全都搜不到
//   代价 —— 源码里有、但因为截断而没画出来的部分搜不到。
//     注释里那句 "we highlight what you see" 就是这个取舍
//
// 同一份文件里三个方法的第三个 setPositions 讲的是另一层：
// 「所有匹配」用反显铺满，而「当前匹配」用黄色盖在上面 ——
// 两层高亮会叠加，所以当前项的颜色必须不透明。
export function useSearchHighlight(): {
  setQuery: (query: string) => void
  /** Paint an existing DOM subtree (from the MAIN tree) to a fresh
   *  Screen at its natural height, scan. Element-relative positions
   *  (row 0 = element top). Zero context duplication — the element
   *  IS the one built with all real providers. */
  scanElement: (el: DOMElement) => MatchPosition[]
  /** Position-based CURRENT highlight. Every frame writes yellow at
   *  positions[currentIdx] + rowOffset. The scan-highlight (inverse on
   *  all matches) still runs — this overlays on top. rowOffset tracks
   *  scroll; positions stay stable (message-relative). null clears. */
  setPositions: (
    state: {
      positions: MatchPosition[]
      rowOffset: number
      currentIdx: number
    } | null,
  ) => void
} {
  useContext(StdinContext) // anchor to App subtree for hook rules
// 和 useSelection 一样的锚定写法（也一样的代价，见那边的批注）。
// 三个 hook 都在做同一件事：从 instances 表里取 Ink 实例，取不到就
// 退化成空实现。
  const ink = instances.get(process.stdout)
  return useMemo(() => {
    if (!ink) {
      return {
        setQuery: () => {},
        scanElement: () => [],
        setPositions: () => {},
      }
    }
    return {
      setQuery: (query: string) => ink.setSearchHighlight(query),
      scanElement: (el: DOMElement) => ink.scanElementSubtree(el),
      setPositions: state => ink.setSearchPositions(state),
    }
  }, [ink])
// 依赖只有 ink，所以返回的对象稳定 —— 可以放心放进依赖数组。
// 这是这一组 hook 的共同约定（useSelection/useSearchHighlight 都遵守），
// 否则每次渲染新对象会让调用方的 useMemo/useEffect 全部失效。
}
