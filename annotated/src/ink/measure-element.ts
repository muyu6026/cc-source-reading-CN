// ═══════════════════════════════════════════════════════════════
//  measureElement：读「已经算好的」尺寸，**不重新布局**
// ═══════════════════════════════════════════════════════════════
//
//  这是 useMeasure 之类 hook 的底层原语。两个真实调用点：
//  `design-system/Ratchet.tsx:47`、`HighlightedCode.tsx:69` ——
//  都是「渲染完之后想知道自己多宽多高」。
//
//  关键性质：**它必须在一帧渲染之后调**。在那之前 yoga 还没
//  calculateLayout，`getComputedWidth()` 返回 NaN —— 而这里用
//  `?? 0` 兜住，于是得到 0×0 而不是 NaN。
//
//  0×0 这个兜底会让「布局前调用」表现为「元素尺寸是 0」，
//  看起来像「ref 还没挂上」—— 排查时要分清是「ref 没挂」还是
//  「布局还没跑」。
import type { DOMElement } from './dom.js'

type Output = {
  /**
   * Element width.
   */
  width: number

  /**
   * Element height.
   */
  height: number
}

/**
 * Measure the dimensions of a particular `<Box>` element.
 */
// 两个 `??` 都兜 undefined（没有 yogaNode 的节点，比如纯文本子节点
//  没被包进 Text 的情况）。
//
//  注意**没有**往下减 padding / border —— 这里返回的是**外框尺寸**
//  （getComputedWidth 是 border-box）。想要内容区宽度得自己减，
//  或者用 `get-max-width.ts`（它减了）。
//
//  这两个函数容易被混用：
//    measureElement  → 外框（盒子占多大）
//    getMaxWidth     → 内容区（文字能占多宽）
//  搞混的后果是「按内容宽算折行，结果边框多占 2 格 → 溢出」。
const measureElement = (node: DOMElement): Output => ({
  width: node.yogaNode?.getComputedWidth() ?? 0,
  height: node.yogaNode?.getComputedHeight() ?? 0,
})

export default measureElement
