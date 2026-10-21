import { useCallback, useContext, useLayoutEffect, useRef } from 'react'
import CursorDeclarationContext from '../components/CursorDeclarationContext.js'
import type { DOMElement } from '../dom.js'

/**
 * Declares where the terminal cursor should be parked after each frame.
 *
 * Terminal emulators render IME preedit text at the physical cursor
 * position, and screen readers / screen magnifiers track the native
 * cursor — so parking it at the text input's caret makes CJK input
 * appear inline and lets accessibility tools follow the input.
 *
 * Returns a ref callback to attach to the Box that contains the input.
 * The declared (line, column) is interpreted relative to that Box's
 * nodeCache rect (populated by renderNodeToOutput).
 *
 * Timing: Both ref attach and useLayoutEffect fire in React's layout
 * phase — after resetAfterCommit calls scheduleRender. scheduleRender
 * defers onRender via queueMicrotask, so onRender runs AFTER layout
 * effects commit and reads the fresh declaration on the first frame
 * (no one-keystroke lag). Test env uses onImmediateRender (synchronous,
 * no microtask), so tests compensate by calling ink.onRender()
 * explicitly after render.
 */
// 【为什么是「声明」而不是「设置光标位置」】
//
// 时序上没得选。渲染顺序是：
//   commit（layout effect 在这里跑，声明被写进 context）
//     → scheduleRender 把 onRender 推到微任务
//       → onRender 里才真正算出这一帧的屏幕缓冲
//         → 最后写光标位置
//
// 也就是说「这一帧内容画在哪」在 layout 阶段还不知道（yoga 算过，
// 但屏幕缓冲还没生成）。所以 hook 只能声明「相对我这个盒子第几行第几列」，
// 由 onRender 在最后用盒子的绝对原点换算。
//
// 这条正好呼应渲染器那条主线上的「量要早、画要晚」：声明也是「量」的
// 一部分，所以它得早（layout），落位必须晚（onRender 之后）。
export function useDeclaredCursor({
  line,
  column,
  active,
}: {
  line: number
  column: number
  active: boolean
}): (element: DOMElement | null) => void {
  const setCursorDeclaration = useContext(CursorDeclarationContext)
  const nodeRef = useRef<DOMElement | null>(null)

  const setNode = useCallback((node: DOMElement | null) => {
    nodeRef.current = node
  }, [])

  // When active, set unconditionally. When inactive, clear conditionally
  // (only if the currently-declared node is ours). The node-identity check
  // handles two hazards:
  //   1. A memo()ized active instance elsewhere (e.g. the search input in
  //      a memo'd Footer) doesn't re-render this commit — an inactive
  //      instance re-rendering here must not clobber it.
  //   2. Sibling handoff (menu focus moving between list items) — when
  //      focus moves opposite to sibling order, the newly-inactive item's
  //      effect runs AFTER the newly-active item's set. Without the node
  //      check it would clobber.
  // No dep array: must re-declare every commit so the active instance
  // re-claims the declaration after another instance's unmount-cleanup or
  // sibling handoff nulls it.
// 【没有依赖数组，是故意的】
//
// 每次 commit 都要重新声明一次。原因在注释第 41-53 行：另一个实例
// 卸载时的 cleanup 会把声明清成 null，而那个 cleanup 可能跑在
// 本实例的 effect 之后。如果这里只在 line/column 变化时才跑，
// 就会出现「声明被清掉、但没人补回来」的窗口。
//
// 无条件重声明 + cleanup 侧做节点身份检查（setCursorDeclaration(null, node)
// 的第二个参数），两半合起来才安全。缺任一半都有 bug：
//   · 只无条件重声明 → 后跑的那个（可能已经不活跃）会覆盖活跃的
//   · 只在 active 时声明 → 卸载顺序一换，声明就永久丢了
  useLayoutEffect(() => {
    const node = nodeRef.current
    if (active && node) {
      setCursorDeclaration({ relativeX: column, relativeY: line, node })
    } else {
      setCursorDeclaration(null, node)
    }
  })

  // Clear on unmount (conditionally — another instance may own by then).
  // Separate effect with empty deps so cleanup only fires once — not on
  // every line/column change, which would transiently null between commits.
  useLayoutEffect(() => {
    return () => {
      setCursorDeclaration(null, nodeRef.current)
    }
  }, [setCursorDeclaration])
// 单独一个空依赖的 layout effect，**只为拿 cleanup**。
//
// 如果把它并进上面那个（无依赖）effect 里，cleanup 会在每次 commit
// 后都跑一次（因为每次都要 cleanup 上一次），于是每次渲染都先清空
// 声明再重设 —— 中间有一个「null」的瞬间。如果 onRender 恰好挤进
// 这个瞬间（比如同步渲染测试环境），那一帧光标就停在默认位置。
//
// 拆成两个 effect，就把「每次都要做的事」和「只在卸载时做的事」
// 分开表达了。代价是多一个 effect 槽位，很便宜。

  return setNode
}
