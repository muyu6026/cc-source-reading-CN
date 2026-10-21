// ═══════════════════════════════════════════════════════════════
//  node：布局引擎的**接口**，不是实现
// ═══════════════════════════════════════════════════════════════
//
//  这个文件存在的意义只有一个：让 `dom.ts` / `render-node-to-output.ts`
//  这些上层不直接依赖 yoga。将来换引擎（Taffy、自研、或者其他），
//  只要实现 `LayoutNode` 这 52 个方法即可。
//
//  代价是那一大串 setter 都是「一个方法包一个 yoga 调用」的样板 ——
//  `yoga.ts` 里有 300 行这样的代码，没有一行有逻辑。这是**适配层的
//  正常成本**：它把「yoga 的 API 形状」翻译成「我们想要的 API 形状」，
//  顺带把 yoga 的枚举换成字符串。
//
//  字符串而不是 enum 的理由（见下）：可以直接放进 JSX 属性、
//  可以直接比较、可以直接序列化 —— yoga 的那些 `Yoga.ALIGN_CENTER`
//  之类的数值常量，在调试时只能看到数字。
// --
// Adapter interface for the layout engine (Yoga)

// 九种 edge。注意 `All` / `Horizontal` / `Vertical` 是**组合**边，
//  其余六个是单边。
//
//  使用者必须知道：`getComputedBorder(LayoutEdge.Horizontal)` 在不同
//  引擎上语义可能不一致（返回左右之和？还是只返回左边？）。
//  `get-max-width.ts` 的批注里提过这个坑 —— 那里宁可 Left/Right 相加，
//  也不用 Horizontal。
export const LayoutEdge = {
  All: 'all',
  Horizontal: 'horizontal',
  Vertical: 'vertical',
  Left: 'left',
  Right: 'right',
  Top: 'top',
  Bottom: 'bottom',
  Start: 'start',
  End: 'end',
} as const
export type LayoutEdge = (typeof LayoutEdge)[keyof typeof LayoutEdge]

export const LayoutGutter = {
  All: 'all',
  Column: 'column',
  Row: 'row',
} as const
export type LayoutGutter = (typeof LayoutGutter)[keyof typeof LayoutGutter]

// `display` 只有两个值。CSS 的 display 有几十种，终端里只有
//  「参与布局」和「不参与」 —— 因为没有 inline、grid、table。
//
//  `none` 的语义在渲染器里被特殊处理：`render-node-to-output.ts` 会
//  跳过整棵子树，**并且清掉它的 blit 缓存**。这一条之前踩过坑：
//  不清缓存的话，取消隐藏之后内容会消失（位置恰好没变才出现）。
export const LayoutDisplay = {
  Flex: 'flex',
  None: 'none',
} as const
export type LayoutDisplay = (typeof LayoutDisplay)[keyof typeof LayoutDisplay]

export const LayoutFlexDirection = {
  Row: 'row',
  RowReverse: 'row-reverse',
  Column: 'column',
  ColumnReverse: 'column-reverse',
} as const
export type LayoutFlexDirection =
  (typeof LayoutFlexDirection)[keyof typeof LayoutFlexDirection]

export const LayoutAlign = {
  Auto: 'auto',
  Stretch: 'stretch',
  FlexStart: 'flex-start',
  Center: 'center',
  FlexEnd: 'flex-end',
} as const
export type LayoutAlign = (typeof LayoutAlign)[keyof typeof LayoutAlign]

export const LayoutJustify = {
  FlexStart: 'flex-start',
  Center: 'center',
  FlexEnd: 'flex-end',
  SpaceBetween: 'space-between',
  SpaceAround: 'space-around',
  SpaceEvenly: 'space-evenly',
} as const
export type LayoutJustify = (typeof LayoutJustify)[keyof typeof LayoutJustify]

export const LayoutWrap = {
  NoWrap: 'nowrap',
  Wrap: 'wrap',
  WrapReverse: 'wrap-reverse',
} as const
export type LayoutWrap = (typeof LayoutWrap)[keyof typeof LayoutWrap]

export const LayoutPositionType = {
  Relative: 'relative',
  Absolute: 'absolute',
} as const
export type LayoutPositionType =
  (typeof LayoutPositionType)[keyof typeof LayoutPositionType]

export const LayoutOverflow = {
  Visible: 'visible',
  Hidden: 'hidden',
  Scroll: 'scroll',
} as const
export type LayoutOverflow =
  (typeof LayoutOverflow)[keyof typeof LayoutOverflow]

export type LayoutMeasureFunc = (
  width: number,
  widthMode: LayoutMeasureMode,
) => { width: number; height: number }

// 三态测量模式，直接对应 CSS/yoga 的 `MeasureMode`：
//
//   Undefined —— 父容器没给约束（「你要多宽就多宽」）
//   Exactly   —— 父容器定了宽（「就按这个宽，告诉我多高」）
//   AtMost    —— 父容器给了上限（「不超过这个宽」）
//
//  **这三个值的区别就是 get-max-width.ts 那段警告的根源**：
//  yoga 的两趟测量分别用 AtMost 和 Exactly，于是同一节点会得到
//  两个不同的宽度。
//
//  measure 回调必须尊重这个模式：Exactly 时必须返回**恰好那个宽度**
//  （不能小），AtMost 时不能超过。`dom.ts` 的 measureTextNode 就是
//  按这三态分派的。
export const LayoutMeasureMode = {
  Undefined: 'undefined',
  Exactly: 'exactly',
  AtMost: 'at-most',
} as const
export type LayoutMeasureMode =
  (typeof LayoutMeasureMode)[keyof typeof LayoutMeasureMode]

// 52 个方法，分六组（注释已经分好了）。读这个接口时只需记住三组：
//
//   **Tree**          —— 树的增删（跟 DOM 那棵树平行维护）
//   **Layout**        —— calculateLayout / setMeasureFunc / markDirty
//   **Layout reading** —— 布局**之后**才能读的 computed 值
//
//  最后一组的共同前提：`calculateLayout()` 已经跑过。之前读会拿到
//  NaN（不是 0）。这个约定在 `renderer.ts:52` 和 `measure-element.ts`
//  里各有一处防御。
export type LayoutNode = {
  // Tree
  insertChild(child: LayoutNode, index: number): void
  removeChild(child: LayoutNode): void
  getChildCount(): number
  getParent(): LayoutNode | null

  // Layout computation
  calculateLayout(width?: number, height?: number): void
  setMeasureFunc(fn: LayoutMeasureFunc): void
  unsetMeasureFunc(): void
  markDirty(): void

  // Layout reading (post-layout)
  getComputedLeft(): number
  getComputedTop(): number
  getComputedWidth(): number
  getComputedHeight(): number
  getComputedBorder(edge: LayoutEdge): number
  getComputedPadding(edge: LayoutEdge): number

  // Style setters
  setWidth(value: number): void
  setWidthPercent(value: number): void
  setWidthAuto(): void
  setHeight(value: number): void
  setHeightPercent(value: number): void
  setHeightAuto(): void
  setMinWidth(value: number): void
  setMinWidthPercent(value: number): void
  setMinHeight(value: number): void
  setMinHeightPercent(value: number): void
  setMaxWidth(value: number): void
  setMaxWidthPercent(value: number): void
  setMaxHeight(value: number): void
  setMaxHeightPercent(value: number): void
  setFlexDirection(dir: LayoutFlexDirection): void
  setFlexGrow(value: number): void
  setFlexShrink(value: number): void
  setFlexBasis(value: number): void
  setFlexBasisPercent(value: number): void
  setFlexWrap(wrap: LayoutWrap): void
  setAlignItems(align: LayoutAlign): void
  setAlignSelf(align: LayoutAlign): void
  setJustifyContent(justify: LayoutJustify): void
  setDisplay(display: LayoutDisplay): void
  getDisplay(): LayoutDisplay
  setPositionType(type: LayoutPositionType): void
  setPosition(edge: LayoutEdge, value: number): void
  setPositionPercent(edge: LayoutEdge, value: number): void
  setOverflow(overflow: LayoutOverflow): void
  setMargin(edge: LayoutEdge, value: number): void
  setPadding(edge: LayoutEdge, value: number): void
  setBorder(edge: LayoutEdge, value: number): void
  setGap(gutter: LayoutGutter, value: number): void

// `free` / `freeRecursive` 是**显式生命周期** —— 这套接口不管理内存，
//  调用方负责释放。这在纯 TS 实现里是多余的（GC 会处理），
//  但在 WASM 版 yoga 里是必需的。
//
//  这也解释了 `reconciler.ts` 里那段「三步顺序」的注释：
//  WASM 的 use-after-free **不报错，只给错数字**。所以释放顺序
//  是有语义的，不是风格问题。
//
//  换成纯 TS 实现之后这两个方法还在，是因为接口要兼容两种实现 ——
//  这也是适配层常见的「为最弱的实现保留能力」。
  // Lifecycle
  free(): void
  freeRecursive(): void
}
