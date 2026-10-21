// ═══════════════════════════════════════════════════════════════
//  node-cache：渲染器需要「记住上一帧」的两样东西
// ═══════════════════════════════════════════════════════════════
//
//  这张表挂在**节点**上而不是挂在渲染器上，理由是节点会跨帧存活
//  （React 的 DOM 节点就是那几个），而渲染器只知道「这一帧」。
//
//  用 WeakMap 而不是普通 Map：节点被回收时条目自动消失，不需要
//  手动清理。这一点在这里特别重要 —— 一个长会话可能创建几十万个
//  节点，Map 会把它们全钉在内存里（键是强引用）。
import type { DOMElement } from './dom.js'
import type { Rectangle } from './layout/geometry.js'

// `CachedLayout` 是「上一帧这个节点占的矩形」。
//
//  `top` 单独存，且是可选的 —— 因为它是 **yoga 局部坐标**
//  （getComputedTop，不含祖先偏移），跟 x/y（屏幕坐标）不是一回事。
//  它存在的理由是 ScrollBox 的视口裁剪：干净的子节点只要 `top` 没变
//  就不用去读 yoga（省一次跨 JS/WASM 边界的调用）。
//
//  省下来的复杂度是 O(mounted) → O(dirty)：一个装了 500 条消息的
//  ScrollBox，稳定态下只有 1-2 个 dirty 节点。
//
//  `top` 为什么可选：不是所有写入方都能拿到它（比如 hit-test 只关心
//  屏幕矩形）。缺失时退化成「必须读 yoga」。
/**
 * Cached layout bounds for each rendered node (used for blit + clearing).
 * `top` is the yoga-local getComputedTop() — stored so ScrollBox viewport
 * culling can skip yoga reads for clean children whose position hasn't
 * shifted (O(dirty) instead of O(mounted) first-pass).
 */
export type CachedLayout = {
  x: number
  y: number
  width: number
  height: number
  top?: number
}

// 两个表职责完全不同，别混：
//
//   `nodeCache`     节点 → 上一帧的矩形（读多写多）
//   `pendingClears` 父节点 → 待清除的矩形列表（写一次、下一帧读一次）
//
// 后者是「删除节点」的两段式：删除发生在 React 提交阶段，但那时候
// 不能立刻擦屏幕（还在渲染中），所以先登记，下一帧渲染到这个父节点时
// 才真的擦。
export const nodeCache = new WeakMap<DOMElement, CachedLayout>()

/** Rects of removed children that need clearing on next render */
export const pendingClears = new WeakMap<DOMElement, Rectangle[]>()

/**
 * Set when a pendingClear is added for an absolute-positioned node.
 * Signals renderer to disable blit for the next frame: the removed node
 * may have painted over non-siblings (e.g. an overlay over a ScrollBox
 * earlier in tree order), so their blits from prevScreen would restore
 * the overlay's pixels. Normal-flow removals are already handled by
 * hasRemovedChild at the parent level; only absolute positioning paints
 * cross-subtree. Reset at the start of each render.
 */
// 模块级布尔标志 —— 一个**跨调用的一次性信号**。
//
// 为什么不用返回值传：设置它的是 `addPendingClear`（在 dom.ts 的
// removeChild 里被调），读它的是 `renderer.ts` 的开头。两者之间隔着
// 一整条调用链（React 提交 → onRender → createRenderer），没有
// 现成的返回值通道。
//
// 这类「模块级标志位」在渲染器里出现了好几次（还有 resetLayoutShifted
// / scrollHint / drainNode）。它们共同的性质是：**生命周期比一次调用
// 长、比一帧短**。代价是同一帧内不能有两棵树的渲染交错 —— 那会让
// 标志被其中一个消费掉。
let absoluteNodeRemoved = false

// 登记「这里有一块区域要擦」。
//
// `existing.push` 而不是覆盖：一个父节点可能在同一帧里删掉多个子节点，
// 每块区域都要擦。用数组而不是合并成一个矩形，是因为相邻两块之间
// 可能有不必擦的空白 —— 合并会多擦。
export function addPendingClear(
  parent: DOMElement,
  rect: Rectangle,
  isAbsolute: boolean,
): void {
  const existing = pendingClears.get(parent)
  if (existing) {
    existing.push(rect)
  } else {
    pendingClears.set(parent, [rect])
  }
// 只有绝对定位的删除才置这个标志。理由在注释里，也值得再强调：
//
//  正常流（normal flow）的节点删除，影响范围被 `hasRemovedChild`
//  限制在父节点的子树里 —— 它不可能画到兄弟节点上去。
//
//  绝对定位的节点**可以**（`position: absolute` 就是干这个的）。
//  一个覆盖层压在树序更早的 ScrollBox 上，删掉它之后，那个 ScrollBox
//  从 prevScreen blit 回来的像素里还带着覆盖层的痕迹。
//
//  而 blit 的八个条件（screen.ts）里没有任何一条能发现这件事 ——
//  它只知道「这块的 styleId 和 char 跟上一帧一样」。所以只能由
//  删除方**主动作废**整个 blit 基准。
//
//  这是「局部优化必须有逃生门」的一个标准案例：blit 是 O(未变) 的
//  快路径，而它是**有前提**的（上一帧的像素可信）。前提被破坏时，
//  必须有一条路径能退回全量。
  if (isAbsolute) {
    absoluteNodeRemoved = true
  }
}

// consume 语义：读一次就清。名字里带 consume 就是为了让人
// 在调用处看到「这会重置状态」。
//
// 调用点只有一处（renderer.ts:129），且在每帧开头 —— 所以这个标志
// 的寿命严格是「上一次删除到下一次渲染之间」。
export function consumeAbsoluteRemovedFlag(): boolean {
  const had = absoluteNodeRemoved
  absoluteNodeRemoved = false
  return had
}
