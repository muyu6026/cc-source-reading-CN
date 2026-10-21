import { Event } from './event.js'

/**
 * Mouse click event. Fired on left-button release without drag, only when
 * mouse tracking is enabled (i.e. inside <AlternateScreen>).
 *
 * Bubbles from the deepest hit node up through parentNode. Call
 * stopImmediatePropagation() to prevent ancestors' onClick from firing.
 */
// 它 extends Event 而不是 TerminalEvent —— 也就是**没走** Dispatcher。
// 点击的冒泡是 hit-test.ts 里手写的一个 while 循环。原因有两个：
//
//   · 点击的 target 不是「有焦点的元素」，而是**屏幕上被点中的那一格**
//     所在的节点，得先做命中测试才知道是谁
//   · 每个 handler 看到的坐标要相对**自己**的盒子重算，这是
//     _prepareForTarget 那个钩子本来要干的事，最后在循环里顺手做了
//
// 结果就是：两套事件体系各走各的，onClick 和 onKeyDown 的传播
// 行为看着一样、实现完全不共享。
export class ClickEvent extends Event {
  /** 0-indexed screen column of the click */
  readonly col: number
  /** 0-indexed screen row of the click */
  readonly row: number
  /**
   * Click column relative to the current handler's Box (col - box.x).
   * Recomputed by dispatchClick before each handler fires, so an onClick
   * on a container sees coords relative to that container, not to any
   * child the click landed on.
   */
  localCol = 0
  /** Click row relative to the current handler's Box (row - box.y). */
  localRow = 0
// localCol / localRow 是**可变的**，而且同一个事件对象会在所有 handler
// 之间传递、每到一处重算一次。所以 handler 里不能把 localCol 存下来
// 延后使用 —— 那时它已经是下一个 handler 的坐标系了。
//
// 这在 DOM 里对应的是 offsetX/offsetY，但 DOM 每次派发会造新的
// 事件对象；这里为了省分配复用一个，代价就是这个隐式约定。
  /**
   * True if the clicked cell has no visible content (unwritten in the
   * screen buffer — both packed words are 0). Handlers can check this to
   * ignore clicks on blank space to the right of text, so accidental
   * clicks on empty terminal space don't toggle state.
   */
  readonly cellIsBlank: boolean
// cellIsBlank 的判断依据和 selection 那边是同一个坑的另一面：
// 屏幕缓冲里「从没写过的格子」和「写过但内容是无样式空格」打包后
// 长得一模一样（两个 int 都是 0）。所以这里能回答的只是
// 「这格有没有被写过」，不是「这格看起来空不空」。
//
// 用途在注释里：点在文字右侧的空白上不该触发折叠/展开。
// 值是 Ink.dispatchClick 传进来的（ink.tsx:1262 调 isEmptyCellAt）。

  constructor(col: number, row: number, cellIsBlank: boolean) {
    super()
    this.col = col
    this.row = row
    this.cellIsBlank = cellIsBlank
  }
}
