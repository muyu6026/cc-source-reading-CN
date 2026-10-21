// ═══════════════════════════════════════════════════════════════
//  命中测试：一个终端坐标落在哪个组件上
// ═══════════════════════════════════════════════════════════════
//
//  浏览器的鼠标事件由浏览器做完命中测试再交给页面；终端只给你
//  一串「第 12 列第 5 行按下了」，剩下的全得自己算。这个文件就是那一步。
//
//  它不遍历 yoga 树、不重算布局，只读 `nodeCache` —— render 那一遍
//  （`render-node-to-output` 末尾）已经把每个节点的屏幕矩形存进去了。
//  于是命中用的是**最后一帧的布局**，这在交互上是对的：
//  用户点的是屏幕上看到的东西，而不是「此刻理论上应该在哪里的东西」。
//
//  一条链路：ParsedMouse → App.handleMouseEvent → dispatchClick
//            → hitTest（找最深的节点）→ 沿 parentNode 冒泡找 onClick。
import type { DOMElement } from './dom.js'
import { ClickEvent } from './events/click-event.js'
import type { EventHandlerProps } from './events/event-handlers.js'
import { nodeCache } from './node-cache.js'

// 三个隐含约定，注释里只说了第一个：
//   · 矩形是**屏幕坐标**，滚动位移已经算进去了（所以不用再加 scrollTop）
//   · 矩形只对「这一帧渲染过」的节点存在 —— 别把 cache 当成布局的真相
//   · 容器用半开区间 `[x, x+width)`，所以相邻节点的接缝不会两边都命中
/**
 * Find the deepest DOM element whose rendered rect contains (col, row).
 *
 * Uses the nodeCache populated by renderNodeToOutput — rects are in screen
 * coordinates with all offsets (including scrollTop translation) already
 * applied. Children are traversed in reverse so later siblings (painted on
 * top) win. Nodes not in nodeCache (not rendered this frame, or lacking a
 * yogaNode) are skipped along with their subtrees.
 *
 * Returns the hit node even if it has no onClick — dispatchClick walks up
 * via parentNode to find handlers.
 */
// 注意 `if (!rect) return null` 在**递归之前**：一个节点这帧没渲染，
// 它的整棵子树也都不会被命中 —— 哪怕子树里某些节点自己有条目。
// 这是有意的（父节点不在屏幕上，子节点也不该能点），但读代码时容易以为
// 「只是这个节点被跳过」。
//
// 返回的节点**不保证有 onClick**。这一点是设计：命中测试只回答「在谁身上」，
// 「谁来处理」是调用方冒泡的事。分开之后，同一个命中结果可以同时用于
// 点击、hover、焦点三种用途。
export function hitTest(
  node: DOMElement,
  col: number,
  row: number,
): DOMElement | null {
  const rect = nodeCache.get(node)
  if (!rect) return null
  if (
    col < rect.x ||
    col >= rect.x + rect.width ||
    row < rect.y ||
    row >= rect.y + rect.height
  ) {
    return null
  }
// 倒序遍历 = 「后画的在上层」。这和渲染顺序严格对应：
// 兄弟节点按数组顺序画，后面的盖住前面的，所以命中也该先问后面的。
//
// 用倒序而不是「收集所有命中再取 z 最大」，是因为这里根本没有 z 序 ——
// 绘制顺序就是唯一的层叠规则。
  // Later siblings paint on top; reversed traversal returns topmost hit.
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i]!
    if (child.nodeName === '#text') continue
    const hit = hitTest(child, col, row)
    if (hit) return hit
  }
  return node
}

/**
 * Hit-test the root at (col, row) and bubble a ClickEvent from the deepest
 * containing node up through parentNode. Only nodes with an onClick handler
 * fire. Stops when a handler calls stopImmediatePropagation(). Returns
 * true if at least one onClick handler fired.
 */
// 冒泡是**手工**走的（`while (target)` + `parentNode`），不是递归 return。
// 原因：一个事件可能要经过多个祖先，每个祖先都可能处理，只有
// 「谁都不处理」才算没命中。递归写法只能返回一个节点，做不到这件事。
//
// 顺带说明这里没有**捕获阶段**（DOM 里从根往下走那一段）。
// 终端 UI 的点击语义简单，捕获阶段带来的复杂度换不到东西。
export function dispatchClick(
  root: DOMElement,
  col: number,
  row: number,
  cellIsBlank = false,
): boolean {
  let target: DOMElement | undefined = hitTest(root, col, row) ?? undefined
  if (!target) return false

// 焦点先于事件派发。顺序有意义：一个输入框被点中时，
// 它要**先**拿到焦点、**再**收到 onClick —— 否则 onClick 里读
// 「我是不是焦点」会读到旧状态。
//
// 判据是 `attributes['tabIndex']` 是**数字**（不是布尔），
// 所以 `tabIndex={0}` 算可聚焦，`tabIndex={undefined}` 不算 ——
// 和 DOM 的 tabindex 语义对齐，但没实现负数（不可聚焦）那一档。
  // Click-to-focus: find the closest focusable ancestor and focus it.
  // root is always ink-root, which owns the FocusManager.
  if (root.focusManager) {
    let focusTarget: DOMElement | undefined = target
    while (focusTarget) {
      if (typeof focusTarget.attributes['tabIndex'] === 'number') {
        root.focusManager.handleClickFocus(focusTarget)
        break
      }
      focusTarget = focusTarget.parentNode
    }
  }
  const event = new ClickEvent(col, row, cellIsBlank)
  let handled = false
  while (target) {
// 【每个祖先各自算一次局部坐标】
//
//   `event.localCol/localRow` 在循环里被**反复改写**：走到哪一层，
//   它就变成相对那一层矩形的坐标。所以同一个 handler 拿到的 local 坐标
//   是「相对自己」的 —— 这比 DOM 更宽松（DOM 里 localX 只在 target 上有意义），
//   好处是父容器可以在自己的坐标系里做命中判断。
//
//   代价：handler 如果异步持有这个 event 对象，读到的是**最后一次**改写后的值。
//   同步处理没问题，异步就要先拷出来。
    const handler = target._eventHandlers?.onClick as
      | ((event: ClickEvent) => void)
      | undefined
    if (handler) {
      handled = true
      const rect = nodeCache.get(target)
      if (rect) {
        event.localCol = col - rect.x
        event.localRow = row - rect.y
      }
      handler(event)
// 这里的语义是「停止冒泡」，但名字借的是 DOM 的 `stopImmediatePropagation`
// —— 在 DOM 里后者还额外阻止**同一元素上**剩下的监听器。
// 这里每个节点最多一个 onClick，所以两种语义恰好等价。
//
// 记这一条不是为了挑名字，而是为了知道「这个 event 上没有
// `stopPropagation` 那个更弱的版本」—— 想让父节点仍然收到时不要误用。
      if (event.didStopImmediatePropagation()) return true
    }
    target = target.parentNode
  }
  return handled
}

/**
 * Fire onMouseEnter/onMouseLeave as the pointer moves. Like DOM
 * mouseenter/mouseleave: does NOT bubble — moving between children does
 * not re-fire on the parent. Walks up from the hit node collecting every
 * ancestor with a hover handler; diffs against the previous hovered set;
 * fires leave on the nodes exited, enter on the nodes entered.
 *
 * Mutates `hovered` in place so the caller (App instance) can hold it
 * across calls. Clears the set when the hit is null (cursor moved into a
 * non-rendered gap or off the root rect).
 */
// 【hover 故意不冒泡，和 DOM 的 mouseenter 一致】
//
//   鼠标在父容器里的两个子元素之间移动时，父容器不该重新触发一次 enter/leave ——
//   否则任何带 hover 效果的容器都会在子元素切换时闪一下。
//
//   实现方式是把「命中节点到根」这条链上所有带 hover 处理器的祖先收进一个集合，
//   然后和上一帧的集合做差集：退出的发 leave，进入的发 enter。
//   集合相等 ⇒ 什么都不发，天然去重。
export function dispatchHover(
  root: DOMElement,
  col: number,
  row: number,
  hovered: Set<DOMElement>,
): void {
  const next = new Set<DOMElement>()
  let node: DOMElement | undefined = hitTest(root, col, row) ?? undefined
  while (node) {
    const h = node._eventHandlers as EventHandlerProps | undefined
    if (h?.onMouseEnter || h?.onMouseLeave) next.add(node)
    node = node.parentNode
  }
// 先 leave 再 enter，顺序和 DOM 一致（先离开旧的，再进入新的）。
//
// `if (old.parentNode)` 是关键的一行：两次鼠标事件之间节点可能已经被卸载，
// 在脱离文档的节点上调用 handler，等于在一个已经 dispose 的组件里改状态。
// 这类崩溃通常表现为「点了某个按钮之后随机崩」，很难归因。
//
// 注意这里仍然把这个节点从集合里删掉（不 return），只是跳过回调 ——
// 留着它下次还会被遍历到。
  for (const old of hovered) {
    if (!next.has(old)) {
      hovered.delete(old)
      // Skip handlers on detached nodes (removed between mouse events)
      if (old.parentNode) {
        ;(old._eventHandlers as EventHandlerProps | undefined)?.onMouseLeave?.()
      }
    }
  }
// enter 用 `next`（这一帧的集合）的顺序：从最深命中节点往上，
// 所以子元素先于父元素收到 enter。
// 没有对称地做「父先子后」是有意的 —— enter 通常用来启动动画/高亮，
// 子元素先亮、容器后亮，视觉上是从指针位置扩散的。
  for (const n of next) {
    if (!hovered.has(n)) {
      hovered.add(n)
      ;(n._eventHandlers as EventHandlerProps | undefined)?.onMouseEnter?.()
    }
  }
}
