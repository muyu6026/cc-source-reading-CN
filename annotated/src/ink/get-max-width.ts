// ═══════════════════════════════════════════════════════════════
//  getMaxWidth：一个函数的文档注释，讲了一整个布局陷阱
// ═══════════════════════════════════════════════════════════════
//
//  这个函数只有 8 行（减 padding 和 border），但上面那段警告是整份
//  ink/ 里信息密度最高的注释之一。它讲的是 **yoga 的两趟测量**：
//
//    AtMost 趟（给上限，问我至少要多宽）→ 决定 width
//    Exactly 趟（给确定值，问我多高）   → 决定 height
//
//  于是 `getComputedWidth()` **可能比 `getComputedHeight()` 大**：
//  前者来自「至少要多宽」那趟（按 intrinsic 算），后者来自
//  「在较窄的宽度下多高」那趟。
//
//  什么时候会真的发生：**column 方向的 flex 父容器里**。因为 cross
//  axis 上的 `align-items: stretch` 从不会把子节点缩到 intrinsic
//  尺寸以下 —— 这是标准 CSS 行为，不是 yoga 的 bug。
//
//  后果：如果按这个宽去折行，折出来的行数比 height 多 → 溢出。
import { LayoutEdge, type LayoutNode } from './layout/node.js'

/**
 * Returns the yoga node's content width (computed width minus padding and
 * border).
 *
 * Warning: can return a value WIDER than the parent container. In a
 * column-direction flex parent, width is the cross axis — align-items:
 * stretch never shrinks children below their intrinsic size, so the text
 * node overflows (standard CSS behavior). Yoga measures leaf nodes in two
 * passes: the AtMost pass determines width, the Exactly pass determines
 * height. getComputedWidth() reflects the wider AtMost result while
 * getComputedHeight() reflects the narrower Exactly result. Callers that
 * use this for wrapping should clamp to actual available screen space so
 * the rendered line count stays consistent with the layout height.
 */
// 四连减：左右 padding + 左右 border。
//
//  **不减 margin** —— margin 在盒子外面，不影响内容区宽度。
//  也不减上下 —— 这是「宽」。
//
//  `LayoutEdge.Left/Right` 而不是 `Horizontal`：yoga 的
//  `getComputedPadding(Edge.Horizontal)` 返回的是什么，各家实现不一致
//  （有的返回左右之和，有的返回单边）。用 Left/Right 相加是唯一
//  跨实现可靠的做法。
const getMaxWidth = (yogaNode: LayoutNode): number => {
  return (
    yogaNode.getComputedWidth() -
    yogaNode.getComputedPadding(LayoutEdge.Left) -
    yogaNode.getComputedPadding(LayoutEdge.Right) -
    yogaNode.getComputedBorder(LayoutEdge.Left) -
    yogaNode.getComputedBorder(LayoutEdge.Right)
  )
}

export default getMaxWidth
// 唯一调用方 `render-node-to-output.ts:568` 用了这个模式：
//
//     const maxWidth = Math.min(getMaxWidth(yogaNode), output.width - x)
//
//  也就是**钳制到屏幕实际剩余宽度**。这正是文档注释最后一句的建议
//  （「Callers that use this for wrapping should clamp to actual
//  available screen space」）。
//
//  值得记的是这个教训的形状：**一个函数返回「逻辑上正确但可能超出
//  物理约束」的值，把钳制的责任交给调用方**。好处是这个函数保持简单、
//  可复用；坏处是每个调用方都必须记得钳 —— 而注释只能提醒，不能强制。
//
//  对比一下另一种设计：「让 getMaxWidth 自己接收 screenWidth 参数并钳好」。
//  那样调用方不会忘，但这个函数就绑定了「屏幕」这个概念，不能用于
//  其他场景。两种设计各有代价，这里选了「灵活 + 靠注释」。
