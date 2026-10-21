# -*- coding: utf-8 -*-
"""ink/layout/geometry.ts 批注（97 行全文件）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  geometry：七个类型、八个函数，**五个函数是死的**
// ═══════════════════════════════════════════════════════════════
//
//  先把存活情况说清楚，省得后面白读：
//
//    unionRect      ✅ output.ts / screen.ts（damage 矩形合并）
//    clamp          ✅ selection.ts / FuzzyPicker.tsx
//    edges          ❌ 零读者
//    addEdges       ❌ 零读者
//    ZERO_EDGES     ❌ 零读者
//    resolveEdges   ❌ 零读者
//    clampRect      ❌ 零读者
//    withinBounds   ❌ 零读者
//
//  六个死函数 + 一个死常量，全是「几何工具箱」的通用件 ——
//  典型的「从上游 Ink 抄过来、但本项目的用法不需要」。
//  它们的代码是对的，只是没人用。
//
//  这类「工具模块里一半没用」的情况很常见，判定方法只有一个：
//  每个导出符号 grep 一次，只数「定义处以外」的命中。
//
//  反过来说，**类型部分全是活的**（Point / Size / Rectangle / Edges
//  被 output.ts / screen.ts / node-cache.ts 广泛引用），因为它们是
//  **跨模块的坐标契约** —— 屏幕坐标用 x/y，尺寸用 width/height、
//  区域用四元组。这些名字统一之后，读任何一处渲染代码都不用猜
//  「这个 x,y 是屏幕的还是节点的」。'''),

(22, 'before', '''// 三种重载：1 个参数（四边同值）、2 个（垂直/水平）、4 个（CSS 顺序）。
//
//  实现里用 `b === undefined` / `c === undefined` 判参数个数 ——
//  这是 JS 里实现重载的常规手法。注意**不能**用 `arguments.length`：
//  TS 编译后 arguments 在箭头函数里不可用，而且传 `undefined`
//  显式省略时 arguments.length 是 2 但语义是 1。
//
//  ❌ 零读者 —— TSX 里的 `margin` / `padding` 是直接走 yoga setter 的
//  （`Box.tsx` → `setMargin(edge, value)`），没经过这里。'''),

(54, 'before', '''// `Partial<Edges>` → 完整 Edges，缺的补 0。
//
//  ❌ 零读者。而且它的用途本来就跟 `edges()` 重复 ——
//  两者都是「构造 Edges」，只是入口不同（从部分值 vs 从数字）。'''),

(63, 'before', '''// 两个矩形的**最小外接矩形**。这是 damage 跟踪的核心操作：
//  每次有格子被改，就把它的矩形并进 screen.damage，最后得到
//  「这一帧动了哪一大块」。
//
//  注意这是**有损**的合并：两个分散在屏幕两角的小改动会合成一个
//  几乎整屏的矩形。所以 damage 只适合「粗略知道哪里变了」，
//  精确的逐格比较在 `screen.diff()` 里做。
//
//  这也是为什么搜索高亮（散落全屏）会干脆放弃精确 damage、
//  直接标整帧 —— 合并的结果本来就已经接近整屏了。'''),

(71, 'before', '''// 把矩形裁进 [0, size) 范围。
//
//  ❌ 零读者。而它的潜在用途（裁剪越界的绘制区域）已经在
//  `screen.ts` 的 `setCellAt` / `blitRegion` 里各自内联处理了。
//
//  注意边界用的是 `size.width - 1`（闭区间）—— 也就是说它把
//  「宽 10」理解成「列 0..9」。这跟 `withinBounds` 的 `< size.width`
//  一致，跟 `Rectangle.width` 的「宽度」语义不同（后者是长度）。
//  这种「同一个类型在边界处理上有两种念法」的地方，是 off-by-one
//  的高发区。'''),

(84, 'before', '''// `point.x < size.width`（严格小于）—— 对的，因为有效列是 0..width-1。
//
//  ❌ 零读者。'''),

(93, 'before', '''// 唯一被外部用的工具函数之一（另一处是 unionRect）。
//  两个边界都可选 —— 只给 min 或只给 max 的用法都存在。
//
//  `selection.ts` 用它钳列号（拖选不能超出屏幕），
//  `FuzzyPicker.tsx` 用它钳选中项下标（翻页不越界）。
//
//  函数本身极简，但「min/max 都可选」这个签名有个好处：
//  调用处写 `clamp(x, 0, w - 1)` 或 `clamp(i, 0)` 都很自然，
//  不需要两个不同名字（clampMin / clampMax）。'''),
]
