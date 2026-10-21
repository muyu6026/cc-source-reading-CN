import {
  LayoutAlign,
  LayoutDisplay,
  LayoutEdge,
  LayoutFlexDirection,
  LayoutGutter,
  LayoutJustify,
  type LayoutNode,
  LayoutOverflow,
  LayoutPositionType,
  LayoutWrap,
} from './layout/node.js'
import type { BorderStyle, BorderTextOptions } from './render-border.js'
// ═══════════════════════════════════════════════════════════════
//  样式层：从 CSS 风格的 props 到 yoga 指令
// ═══════════════════════════════════════════════════════════════
//
//   这个文件只有两件事：
//     ① 定义两套类型（TextStyles 管字，Styles 管盒子）—— 上半 390 行
//     ② 把 Styles 逐项翻译成 yoga 的 setter —— 下半 380 行
//
// 【为什么两套类型要分开】
//   TextStyles 影响的是「字符怎么画」（颜色、粗体、下划线），
//   最终变成 SGR 转义序列，交给 colorize.ts。
//   Styles 影响的是「盒子怎么摆」（宽高、padding、flex），
//   最终变成 yoga 节点上的数字，交给布局引擎。
//   两者的消费方完全不同，混成一个类型会让「这个属性到底谁在用」
//   永远说不清。
//
// 【上层 390 行为什么不能删】
//   里面的英文注释是从 CSS 文档搬来的定义（flex-grow、justify-content
//   这些概念在终端里和在浏览器里语义一致）。删掉这些注释，
//   读者就得去查 CSS 规范。这是本项目里少见的「注释密度高于代码价值」
//   的文件 —— 但保留了是对的。

// 四种颜色写法，都不是自由字符串而是**模板字面量类型**：
//     rgb(215,119,87)   真彩色（24 位）
//     #d77957           十六进制，等价于上面那行
//     ansi256(174)      256 色索引
//     ansi:red          16 色具名，带 `ansi:` 前缀
//
//   用模板字面量类型而不是 string，好处是编译期就能拦住 rgb(300,0,0)
//   之外的拼写错误。坏处是运行时仍然要正则校验（见 colorize.ts 里的
//   RGB_REGEX）—— 类型只在编译后消失，而颜色值可能来自配置文件。
//
//   `ansi:` 这个前缀不是终端语法，是这个项目自己加的：
//   用来区分「16 色具名」和「十六进制色」。写 #ff0000 是 24 位真彩，
//   写 ansi:red 是终端调色板第 1 号 —— 在很多深色主题下这两个颜色
//   差别很大，而前者会被 tmux 降级（见 colorize.ts）。
export type RGBColor = `rgb(${number},${number},${number})`
export type HexColor = `#${string}`
export type Ansi256Color = `ansi256(${number})`
export type AnsiColor =
  | 'ansi:black'
  | 'ansi:red'
  | 'ansi:green'
  | 'ansi:yellow'
  | 'ansi:blue'
  | 'ansi:magenta'
  | 'ansi:cyan'
  | 'ansi:white'
  | 'ansi:blackBright'
  | 'ansi:redBright'
  | 'ansi:greenBright'
  | 'ansi:yellowBright'
  | 'ansi:blueBright'
  | 'ansi:magentaBright'
  | 'ansi:cyanBright'
  | 'ansi:whiteBright'

/** Raw color value - not a theme key */
export type Color = RGBColor | HexColor | Ansi256Color | AnsiColor

/**
 * Structured text styling properties.
 * Used to style text without relying on ANSI string transforms.
 * Colors are raw values - theme resolution happens at the component layer.
 */
// TextStyles：**只有字，没有盒子**。八项，对应 SGR 的三类：
//     颜色类  color / backgroundColor
//     强度类  bold / dim（这两个在终端里常常互斥，见 Ansi.tsx 的 StyledText）
//     装饰类  italic / underline / strikethrough / inverse
//
//   注意这里没有 fontSize、lineHeight、letterSpacing —— 终端没有这些概念。
//   字体是用户的，行高由终端决定，字距不存在。
//   「终端 UI 的样式系统本质上只有颜色和开关」。
export type TextStyles = {
  readonly color?: Color
  readonly backgroundColor?: Color
  readonly dim?: boolean
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly strikethrough?: boolean
  readonly inverse?: boolean
}

// Styles：盒子。这个类型有 60 多个可选字段，看着吓人，
//   但结构很规整 —— 下面 350 行英文注释把它们按 CSS 概念分好了组：
//     方向与定位（position / top / bottom / left / right）
//     间距（margin / padding 各有 7 个变体）
//     弹性（flexGrow / flexShrink / flexDirection / flexBasis / flexWrap）
//     对齐（alignItems / alignSelf / justifyContent）
//     尺寸（width / height / minX / maxX，每个都是 number 或百分比字符串）
//     边框（borderStyle + 四条边 + 四色 + 四 dim）
//     其它（display / overflow / opaque / noSelect）
//
//   `readonly` 全部加上了。这不是装饰 —— dom.ts 里 setStyle 用
//   **按值比较**来判断「样式变没变」，如果调用方可以原地改 style 对象，
//   比较就会永远得到「没变」，脏标记不触发，屏幕不更新。
//   readonly 是在类型层面把这条约束钉死。
export type Styles = {
  readonly textWrap?:
    | 'wrap'
    | 'wrap-trim'
    | 'end'
    | 'middle'
    | 'truncate-end'
    | 'truncate'
    | 'truncate-middle'
    | 'truncate-start'

  readonly position?: 'absolute' | 'relative'
  readonly top?: number | `${number}%`
  readonly bottom?: number | `${number}%`
  readonly left?: number | `${number}%`
  readonly right?: number | `${number}%`

  /**
   * Size of the gap between an element's columns.
   */
  readonly columnGap?: number

  /**
   * Size of the gap between element's rows.
   */
  readonly rowGap?: number

  /**
   * Size of the gap between an element's columns and rows. Shorthand for `columnGap` and `rowGap`.
   */
  readonly gap?: number

  /**
   * Margin on all sides. Equivalent to setting `marginTop`, `marginBottom`, `marginLeft` and `marginRight`.
   */
  readonly margin?: number

  /**
   * Horizontal margin. Equivalent to setting `marginLeft` and `marginRight`.
   */
  readonly marginX?: number

  /**
   * Vertical margin. Equivalent to setting `marginTop` and `marginBottom`.
   */
  readonly marginY?: number

  /**
   * Top margin.
   */
  readonly marginTop?: number

  /**
   * Bottom margin.
   */
  readonly marginBottom?: number

  /**
   * Left margin.
   */
  readonly marginLeft?: number

  /**
   * Right margin.
   */
  readonly marginRight?: number

  /**
   * Padding on all sides. Equivalent to setting `paddingTop`, `paddingBottom`, `paddingLeft` and `paddingRight`.
   */
  readonly padding?: number

  /**
   * Horizontal padding. Equivalent to setting `paddingLeft` and `paddingRight`.
   */
  readonly paddingX?: number

  /**
   * Vertical padding. Equivalent to setting `paddingTop` and `paddingBottom`.
   */
  readonly paddingY?: number

  /**
   * Top padding.
   */
  readonly paddingTop?: number

  /**
   * Bottom padding.
   */
  readonly paddingBottom?: number

  /**
   * Left padding.
   */
  readonly paddingLeft?: number

  /**
   * Right padding.
   */
  readonly paddingRight?: number

  /**
   * This property defines the ability for a flex item to grow if necessary.
   * See [flex-grow](https://css-tricks.com/almanac/properties/f/flex-grow/).
   */
  readonly flexGrow?: number

  /**
   * It specifies the “flex shrink factor”, which determines how much the flex item will shrink relative to the rest of the flex items in the flex container when there isn’t enough space on the row.
   * See [flex-shrink](https://css-tricks.com/almanac/properties/f/flex-shrink/).
   */
  readonly flexShrink?: number

  /**
   * It establishes the main-axis, thus defining the direction flex items are placed in the flex container.
   * See [flex-direction](https://css-tricks.com/almanac/properties/f/flex-direction/).
   */
  readonly flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'

  /**
   * It specifies the initial size of the flex item, before any available space is distributed according to the flex factors.
   * See [flex-basis](https://css-tricks.com/almanac/properties/f/flex-basis/).
   */
  readonly flexBasis?: number | string

  /**
   * It defines whether the flex items are forced in a single line or can be flowed into multiple lines. If set to multiple lines, it also defines the cross-axis which determines the direction new lines are stacked in.
   * See [flex-wrap](https://css-tricks.com/almanac/properties/f/flex-wrap/).
   */
  readonly flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'

  /**
   * The align-items property defines the default behavior for how items are laid out along the cross axis (perpendicular to the main axis).
   * See [align-items](https://css-tricks.com/almanac/properties/a/align-items/).
   */
  readonly alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch'

  /**
   * It makes possible to override the align-items value for specific flex items.
   * See [align-self](https://css-tricks.com/almanac/properties/a/align-self/).
   */
  readonly alignSelf?: 'flex-start' | 'center' | 'flex-end' | 'auto'

  /**
   * It defines the alignment along the main axis.
   * See [justify-content](https://css-tricks.com/almanac/properties/j/justify-content/).
   */
  readonly justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | 'center'

  /**
   * Width of the element in spaces.
   * You can also set it in percent, which will calculate the width based on the width of parent element.
   */
  readonly width?: number | string

  /**
   * Height of the element in lines (rows).
   * You can also set it in percent, which will calculate the height based on the height of parent element.
   */
  readonly height?: number | string

  /**
   * Sets a minimum width of the element.
   */
  readonly minWidth?: number | string

  /**
   * Sets a minimum height of the element.
   */
  readonly minHeight?: number | string

  /**
   * Sets a maximum width of the element.
   */
  readonly maxWidth?: number | string

  /**
   * Sets a maximum height of the element.
   */
  readonly maxHeight?: number | string

  /**
   * Set this property to `none` to hide the element.
   */
  readonly display?: 'flex' | 'none'

  /**
   * Add a border with a specified style.
   * If `borderStyle` is `undefined` (which it is by default), no border will be added.
   */
  readonly borderStyle?: BorderStyle

  /**
   * Determines whether top border is visible.
   *
   * @default true
   */
  readonly borderTop?: boolean

  /**
   * Determines whether bottom border is visible.
   *
   * @default true
   */
  readonly borderBottom?: boolean

  /**
   * Determines whether left border is visible.
   *
   * @default true
   */
  readonly borderLeft?: boolean

  /**
   * Determines whether right border is visible.
   *
   * @default true
   */
  readonly borderRight?: boolean

  /**
   * Change border color.
   * Shorthand for setting `borderTopColor`, `borderRightColor`, `borderBottomColor` and `borderLeftColor`.
   */
  readonly borderColor?: Color

  /**
   * Change top border color.
   * Accepts raw color values (rgb, hex, ansi).
   */
  readonly borderTopColor?: Color

  /**
   * Change bottom border color.
   * Accepts raw color values (rgb, hex, ansi).
   */
  readonly borderBottomColor?: Color

  /**
   * Change left border color.
   * Accepts raw color values (rgb, hex, ansi).
   */
  readonly borderLeftColor?: Color

  /**
   * Change right border color.
   * Accepts raw color values (rgb, hex, ansi).
   */
  readonly borderRightColor?: Color

  /**
   * Dim the border color.
   * Shorthand for setting `borderTopDimColor`, `borderBottomDimColor`, `borderLeftDimColor` and `borderRightDimColor`.
   *
   * @default false
   */
  readonly borderDimColor?: boolean

  /**
   * Dim the top border color.
   *
   * @default false
   */
  readonly borderTopDimColor?: boolean

  /**
   * Dim the bottom border color.
   *
   * @default false
   */
  readonly borderBottomDimColor?: boolean

  /**
   * Dim the left border color.
   *
   * @default false
   */
  readonly borderLeftDimColor?: boolean

  /**
   * Dim the right border color.
   *
   * @default false
   */
  readonly borderRightDimColor?: boolean

  /**
   * Add text within the border. Only applies to top or bottom borders.
   */
  readonly borderText?: BorderTextOptions

  /**
   * Background color for the box. Fills the interior with background-colored
   * spaces and is inherited by child text nodes as their default background.
   */
  readonly backgroundColor?: Color

  /**
   * Fill the box's interior (padding included) with spaces before
   * rendering children, so nothing behind it shows through. Like
   * `backgroundColor` but without emitting any SGR — the terminal's
   * default background is used. Useful for absolute-positioned overlays
   * where Box padding/gaps would otherwise be transparent.
   */
  readonly opaque?: boolean

  /**
   * Behavior for an element's overflow in both directions.
   * 'scroll' constrains the container's size (children do not expand it)
   * and enables scrollTop-based virtualized scrolling at render time.
   *
   * @default 'visible'
   */
  readonly overflow?: 'visible' | 'hidden' | 'scroll'

  /**
   * Behavior for an element's overflow in horizontal direction.
   *
   * @default 'visible'
   */
  readonly overflowX?: 'visible' | 'hidden' | 'scroll'

  /**
   * Behavior for an element's overflow in vertical direction.
   *
   * @default 'visible'
   */
  readonly overflowY?: 'visible' | 'hidden' | 'scroll'

  /**
   * Exclude this box's cells from text selection in fullscreen mode.
   * Cells inside this region are skipped by both the selection highlight
   * and the copied text — useful for fencing off gutters (line numbers,
   * diff sigils) so click-drag over a diff yields clean copyable code.
   * Only affects alt-screen text selection; no-op otherwise.
   *
   * `'from-left-edge'` extends the exclusion from column 0 to the box's
   * right edge for every row it occupies — this covers any upstream
   * indentation (tool message prefix, tree lines) so a multi-row drag
   * doesn't pick up leading whitespace from middle rows.
   */
  readonly noSelect?: boolean | 'from-left-edge'
}

// 从这里开始是翻译层。九个 apply 函数，每个负责一组属性。
//
// 【最重要的一个约定：`'x' in style` 而不是 `style.x !== undefined`】
//
//   这个 style 参数**不是全量样式**，是 diff。来源在 reconciler.ts 433 行：
//       const style = diff(oldProps.style, newProps.style)
//   而 diff 的实现（同文件 62 行起）有一条关键行为：
//       for (const key of Object.keys(before)) {
//         if (!Object.hasOwn(after, key)) changed[key] = undefined
//       }
//   也就是说，「上一帧有 margin、这一帧没写」这件事在 diff 里变成
//   `{ margin: undefined }` —— **键在，值是 undefined**。
//
//   于是两种写法的语义差别就出来了：
//     'margin' in style          → 「这个键这一帧**变了**」（含被删除、被重置）
//     style.margin !== undefined → 「margin 有新值」
//
//   前者为 true 而后者为 false 的情况，正是「属性被移除」。
//   按后者判断的话，「把 margin 从 4 改回不设置」这个操作永远无法表达 ——
//   屏幕会一直保留 4 格边距。这是这套代码里最容易读错、也最容易写错的地方。
//
//   约定：**值 undefined 表示「重置成默认」**，不是「不要动」。
//   真正「不要动」的表现形式是「这个键根本不在 diff 里」。
//
//   代价：每个 apply 函数里都要写 `'x' in style` 加 `?? 0` 的组合，
//   比 `if (style.margin != null)` 啰嗦。这是「用语法细节表达语义」
//   的典型案例。
const applyPositionStyles = (node: LayoutNode, style: Styles): void => {
  if ('position' in style) {
    node.setPositionType(
      style.position === 'absolute'
        ? LayoutPositionType.Absolute
        : LayoutPositionType.Relative,
    )
  }
  if ('top' in style) applyPositionEdge(node, 'top', style.top)
  if ('bottom' in style) applyPositionEdge(node, 'bottom', style.bottom)
  if ('left' in style) applyPositionEdge(node, 'left', style.left)
  if ('right' in style) applyPositionEdge(node, 'right', style.right)
}

// position 的四个边。三态处理：
//     string（"50%"）→ setPositionPercent
//     number         → setPosition
//     其它（undefined）→ setPosition(edge, NaN)
//
//   NaN 在这里是「未设置」的哨兵值 —— yoga 内部就是用它表示
//   YGValueUndefined。不能用 0 代替：0 是「贴着边」，语义完全不同。
//   走到那个分支的唯一途径是「这个键变了、但新值是 undefined」，
//   也就是上游把 top 删掉了 —— 此时重置成「未设置」才是对的。
//
//   百分比解析用 Number.parseInt，没有校验。`"50%"` 得到 50，
//   `"auto"` 得到 NaN（于是变成「未设置」），`"50.5%"` 得到 50（截断）。
//   宽松解析的后果是「写错了不报错，只是布局奇怪」——
//   这也是终端 UI 调试常见的困惑来源。
function applyPositionEdge(
  node: LayoutNode,
  edge: 'top' | 'bottom' | 'left' | 'right',
  v: number | `${number}%` | undefined,
): void {
  if (typeof v === 'string') {
    node.setPositionPercent(edge, Number.parseInt(v, 10))
  } else if (typeof v === 'number') {
    node.setPosition(edge, v)
  } else {
    node.setPosition(edge, Number.NaN)
  }
}

// overflow 的降维：yoga 只有一个 overflow 开关，而这个 API 有 x/y 两轴。
//
//   处理方式是**取并集，且 scroll 优先于 hidden**：
//     overflowY=hidden + overflowX=scroll → Scroll
//
//   为什么可以这么粗暴：在布局阶段，`hidden` 和 `scroll` 的效果**完全一样**
//   （都阻止子节点把容器撑大）。两者的区别只在渲染阶段 ——
//   `scroll` 额外告诉 render-node-to-output「要应用 scrollTop 平移」。
//   所以布局层只需要知道「会不会被撑开」这一个比特。
//
//   最后那个 else-if 是「重置」分支：三个键里只要有一个出现了（哪怕值是
//   undefined，见 406 那段），就把 yoga 明确设回 Visible。
//   它和「三个键都没出现」是两件事 —— 后者表示这个节点从没设过 overflow，
//   yoga 的默认状态本来就不必动；前者表示「刚刚被删掉了」，必须显式复位。
const applyOverflowStyles = (node: LayoutNode, style: Styles): void => {
  // Yoga's Overflow controls whether children expand the container.
  // 'hidden' and 'scroll' both prevent expansion; 'scroll' additionally
  // signals that the renderer should apply scrollTop translation.
  // overflowX/Y are render-time concerns; for layout we use the union.
  const y = style.overflowY ?? style.overflow
  const x = style.overflowX ?? style.overflow
  if (y === 'scroll' || x === 'scroll') {
    node.setOverflow(LayoutOverflow.Scroll)
  } else if (y === 'hidden' || x === 'hidden') {
    node.setOverflow(LayoutOverflow.Hidden)
  } else if (
    'overflow' in style ||
    'overflowX' in style ||
    'overflowY' in style
  ) {
    node.setOverflow(LayoutOverflow.Visible)
  }
}

// margin 七个变体。注意 `?? 0` 和 `|| 0` 混用：
//     margin / marginX / marginY 用 `?? 0`
//     marginLeft / Right / Top / Bottom 用 `|| 0`
//
//   对 undefined 两者结果相同，唯一的差别是 NaN：`NaN ?? 0` = NaN，
//   `NaN || 0` = 0。所以后者会把 NaN 静默归零，前者会把 NaN 传给 yoga
//   （yoga 里 NaN 也表示未定义，等价于 0）。
//   行为上无害，但风格不统一 —— 这类混用是「分几次写的」留下的痕迹，
//   不是有意为之。
const applyMarginStyles = (node: LayoutNode, style: Styles): void => {
  if ('margin' in style) {
    node.setMargin(LayoutEdge.All, style.margin ?? 0)
  }

  if ('marginX' in style) {
    node.setMargin(LayoutEdge.Horizontal, style.marginX ?? 0)
  }

  if ('marginY' in style) {
    node.setMargin(LayoutEdge.Vertical, style.marginY ?? 0)
  }

  if ('marginLeft' in style) {
    node.setMargin(LayoutEdge.Start, style.marginLeft || 0)
  }

  if ('marginRight' in style) {
    node.setMargin(LayoutEdge.End, style.marginRight || 0)
  }

  if ('marginTop' in style) {
    node.setMargin(LayoutEdge.Top, style.marginTop || 0)
  }

  if ('marginBottom' in style) {
    node.setMargin(LayoutEdge.Bottom, style.marginBottom || 0)
  }
}

const applyPaddingStyles = (node: LayoutNode, style: Styles): void => {
  if ('padding' in style) {
    node.setPadding(LayoutEdge.All, style.padding ?? 0)
  }

  if ('paddingX' in style) {
    node.setPadding(LayoutEdge.Horizontal, style.paddingX ?? 0)
  }

  if ('paddingY' in style) {
    node.setPadding(LayoutEdge.Vertical, style.paddingY ?? 0)
  }

  if ('paddingLeft' in style) {
    node.setPadding(LayoutEdge.Left, style.paddingLeft || 0)
  }

  if ('paddingRight' in style) {
    node.setPadding(LayoutEdge.Right, style.paddingRight || 0)
  }

  if ('paddingTop' in style) {
    node.setPadding(LayoutEdge.Top, style.paddingTop || 0)
  }

  if ('paddingBottom' in style) {
    node.setPadding(LayoutEdge.Bottom, style.paddingBottom || 0)
  }
}

// flex 系列。这一段有 14 个 if，形式高度重复，值得说的只有两处：
//
//   · **每个枚举都是若干独立的 if，不是 switch 或映射表。**
//     好处是非法值（拼错的 'row-revese'）会被静默忽略，
//     不会 fall through 到某个分支。
//     坏处是新增一个枚举值要记得在这堆 if 里加一条 —— 类型系统
//     不会提醒你（因为条件里没有 else 分支）。
//
//   · flexShrink 的默认值是 1，而 flexGrow 是 0。这是 CSS 的原语义：
//     默认会收缩（装不下就挤），但不会增长（有空间也不占）。
//     写反了会让所有「撑满剩余空间」的布局失效。
const applyFlexStyles = (node: LayoutNode, style: Styles): void => {
  if ('flexGrow' in style) {
    node.setFlexGrow(style.flexGrow ?? 0)
  }

  if ('flexShrink' in style) {
    node.setFlexShrink(
      typeof style.flexShrink === 'number' ? style.flexShrink : 1,
    )
  }

  if ('flexWrap' in style) {
    if (style.flexWrap === 'nowrap') {
      node.setFlexWrap(LayoutWrap.NoWrap)
    }

    if (style.flexWrap === 'wrap') {
      node.setFlexWrap(LayoutWrap.Wrap)
    }

    if (style.flexWrap === 'wrap-reverse') {
      node.setFlexWrap(LayoutWrap.WrapReverse)
    }
  }

  if ('flexDirection' in style) {
    if (style.flexDirection === 'row') {
      node.setFlexDirection(LayoutFlexDirection.Row)
    }

    if (style.flexDirection === 'row-reverse') {
      node.setFlexDirection(LayoutFlexDirection.RowReverse)
    }

    if (style.flexDirection === 'column') {
      node.setFlexDirection(LayoutFlexDirection.Column)
    }

    if (style.flexDirection === 'column-reverse') {
      node.setFlexDirection(LayoutFlexDirection.ColumnReverse)
    }
  }

// flexBasis 三态，和 position 一样：
//     number → setFlexBasis
//     string → setFlexBasisPercent（parseInt 取数字部分）
//     其它   → setFlexBasis(NaN) 表示「用 width」
//
//   注意这个分支里没有 `??` 兜底 —— 走到 else 就是「undefined 或 null」，
//   统一给 NaN。NaN 在 yoga 里的含义是「这个维度不指定」，
//   于是 flex 布局会回退到按内容测量。
  if ('flexBasis' in style) {
    if (typeof style.flexBasis === 'number') {
      node.setFlexBasis(style.flexBasis)
    } else if (typeof style.flexBasis === 'string') {
      node.setFlexBasisPercent(Number.parseInt(style.flexBasis, 10))
    } else {
      node.setFlexBasis(Number.NaN)
    }
  }

  if ('alignItems' in style) {
    if (style.alignItems === 'stretch' || !style.alignItems) {
      node.setAlignItems(LayoutAlign.Stretch)
    }

    if (style.alignItems === 'flex-start') {
      node.setAlignItems(LayoutAlign.FlexStart)
    }

    if (style.alignItems === 'center') {
      node.setAlignItems(LayoutAlign.Center)
    }

    if (style.alignItems === 'flex-end') {
      node.setAlignItems(LayoutAlign.FlexEnd)
    }
  }

  if ('alignSelf' in style) {
    if (style.alignSelf === 'auto' || !style.alignSelf) {
      node.setAlignSelf(LayoutAlign.Auto)
    }

    if (style.alignSelf === 'flex-start') {
      node.setAlignSelf(LayoutAlign.FlexStart)
    }

    if (style.alignSelf === 'center') {
      node.setAlignSelf(LayoutAlign.Center)
    }

    if (style.alignSelf === 'flex-end') {
      node.setAlignSelf(LayoutAlign.FlexEnd)
    }
  }

  if ('justifyContent' in style) {
    if (style.justifyContent === 'flex-start' || !style.justifyContent) {
      node.setJustifyContent(LayoutJustify.FlexStart)
    }

    if (style.justifyContent === 'center') {
      node.setJustifyContent(LayoutJustify.Center)
    }

    if (style.justifyContent === 'flex-end') {
      node.setJustifyContent(LayoutJustify.FlexEnd)
    }

    if (style.justifyContent === 'space-between') {
      node.setJustifyContent(LayoutJustify.SpaceBetween)
    }

    if (style.justifyContent === 'space-around') {
      node.setJustifyContent(LayoutJustify.SpaceAround)
    }

    if (style.justifyContent === 'space-evenly') {
      node.setJustifyContent(LayoutJustify.SpaceEvenly)
    }
  }
}

// 尺寸。六个属性各三态（number / 百分比字符串 / undefined），
//   形式与 flexBasis 完全一样，但有两个细节不同：
//
//   · width / height 的 undefined 走的是 **setWidthAuto / setHeightAuto**，
//     不是 NaN。auto 和 undefined 在 flex 布局里语义不同：
//     auto 表示「按内容算」，undefined 表示「不指定」（由父级决定）。
//   · min / max 是四个属性但只有两种处理（百分比 / 数值），
//     没有 auto 那一档 —— CSS 里 min-width 本来就没有 auto。
//
//   统共 6 个属性 × 3 种情况 = 18 个分支，全是手写的。
//   这个文件的价值不在巧妙，在**把 CSS 的边界情况一条不漏地摆出来**。
const applyDimensionStyles = (node: LayoutNode, style: Styles): void => {
  if ('width' in style) {
    if (typeof style.width === 'number') {
      node.setWidth(style.width)
    } else if (typeof style.width === 'string') {
      node.setWidthPercent(Number.parseInt(style.width, 10))
    } else {
      node.setWidthAuto()
    }
  }

  if ('height' in style) {
    if (typeof style.height === 'number') {
      node.setHeight(style.height)
    } else if (typeof style.height === 'string') {
      node.setHeightPercent(Number.parseInt(style.height, 10))
    } else {
      node.setHeightAuto()
    }
  }

  if ('minWidth' in style) {
    if (typeof style.minWidth === 'string') {
      node.setMinWidthPercent(Number.parseInt(style.minWidth, 10))
    } else {
      node.setMinWidth(style.minWidth ?? 0)
    }
  }

  if ('minHeight' in style) {
    if (typeof style.minHeight === 'string') {
      node.setMinHeightPercent(Number.parseInt(style.minHeight, 10))
    } else {
      node.setMinHeight(style.minHeight ?? 0)
    }
  }

  if ('maxWidth' in style) {
    if (typeof style.maxWidth === 'string') {
      node.setMaxWidthPercent(Number.parseInt(style.maxWidth, 10))
    } else {
      node.setMaxWidth(style.maxWidth ?? 0)
    }
  }

  if ('maxHeight' in style) {
    if (typeof style.maxHeight === 'string') {
      node.setMaxHeightPercent(Number.parseInt(style.maxHeight, 10))
    } else {
      node.setMaxHeight(style.maxHeight ?? 0)
    }
  }
}

// display 只有两个值。CSS 有十几个（grid、table、inline-flex…），
//   终端里只需要「在不在流里」。`none` 的节点完全不参与布局，
//   尺寸为 0，也就不会被绘制 —— 这一条是 render-node-to-output 里
//   那堆 blit 判定的前提。
const applyDisplayStyles = (node: LayoutNode, style: Styles): void => {
  if ('display' in style) {
    node.setDisplay(
      style.display === 'flex' ? LayoutDisplay.Flex : LayoutDisplay.None,
    )
  }
}

// 边框。这是全文件唯一一个需要**第二个参数**的 apply 函数，
//   原因值得说清楚。
//
//   问题：setStyle 收到的是增量 diff。假设上一帧是这样：
//       borderStyle: 'single', borderTop: false
//   这一帧只改了一个属性，diff 里是：
//       { borderStyle: 'double' }
//   那么仅凭 diff，我们不知道该给 top 边设多宽 —— diff 里没有 borderTop。
//
//   解决办法：把**新一帧的完整样式**也传进来。调用点是 reconciler.ts 457 行：
//       applyStyles(node.yogaNode, style /* diff */, newProps.style /* 全量 */)
//   diff 里出现 borderStyle 时，用全量里的四条边开关去决定每边宽度。
//   这就是 701 行 `resolvedStyle ?? style` 的作用。
//
//   注意它拿的是 **newProps**（新值）而不是 oldProps —— 要的是「这一帧想
//   长什么样」。另一个调用路径（reconciler.ts 127 行，首次挂载）只传两个
//   参数，此时 style 本身就是全量，resolvedStyle 缺省等于 style。
//
// 【极性为什么是 `!== false` 而不是 `=== true`】
//   因为默认值。`borderTop` 的默认是 true（见 259 行的 @default true），
//   所以「没写」= 显示，「写 false」= 隐藏。
//   如果判据写成 `=== true`，那么只写 borderStyle 不写 borderTop 的人
//   会得到「四条边全是 0 宽」—— 边框样式设了但看不见，排查起来很费时。
//
//   「默认值决定极性」这条规律在这里和 mcp/config.ts 的白黑名单
//   是同一个道理：**判据的方向必须跟着默认值走。**
const applyBorderStyles = (
  node: LayoutNode,
  style: Styles,
  resolvedStyle?: Styles,
): void => {
  // resolvedStyle is the full current style (already set on the DOM node).
  // style may be a diff with only changed properties. For border side props,
  // we need the resolved value because `borderStyle` in a diff may not include
  // unchanged border side values (e.g. borderTop stays false but isn't in the diff).
  const resolved = resolvedStyle ?? style

  if ('borderStyle' in style) {
    const borderWidth = style.borderStyle ? 1 : 0

    node.setBorder(
      LayoutEdge.Top,
      resolved.borderTop !== false ? borderWidth : 0,
    )
    node.setBorder(
      LayoutEdge.Bottom,
      resolved.borderBottom !== false ? borderWidth : 0,
    )
    node.setBorder(
      LayoutEdge.Left,
      resolved.borderLeft !== false ? borderWidth : 0,
    )
    node.setBorder(
      LayoutEdge.Right,
      resolved.borderRight !== false ? borderWidth : 0,
    )
  } else {
    // Handle individual border property changes (when only borderX changes without borderStyle).
    // Skip undefined values — they mean the prop was removed or never set,
    // not that a border should be enabled.
    if ('borderTop' in style && style.borderTop !== undefined) {
      node.setBorder(LayoutEdge.Top, style.borderTop === false ? 0 : 1)
    }
    if ('borderBottom' in style && style.borderBottom !== undefined) {
      node.setBorder(LayoutEdge.Bottom, style.borderBottom === false ? 0 : 1)
    }
    if ('borderLeft' in style && style.borderLeft !== undefined) {
      node.setBorder(LayoutEdge.Left, style.borderLeft === false ? 0 : 1)
    }
    if ('borderRight' in style && style.borderRight !== undefined) {
      node.setBorder(LayoutEdge.Right, style.borderRight === false ? 0 : 1)
    }
  }
}

// gap 三个变体，形式与 margin 一致。gap 在终端布局里的典型用途是
//   表格列间距、列表项间距 —— 它比给每个子节点加 margin 更不容易出错，
//   因为不会在首尾多出一格。
const applyGapStyles = (node: LayoutNode, style: Styles): void => {
  if ('gap' in style) {
    node.setGap(LayoutGutter.All, style.gap ?? 0)
  }

  if ('columnGap' in style) {
    node.setGap(LayoutGutter.Column, style.columnGap ?? 0)
  }

  if ('rowGap' in style) {
    node.setGap(LayoutGutter.Row, style.rowGap ?? 0)
  }
}

// 总入口。九个 apply 按固定顺序调用。
//
//   顺序在这里**不影响结果** —— 每个函数只写自己那组 yoga 属性，
//   互不交叉。但固定成一种顺序有实际价值：
//   调试时可以把 yoga 节点的最终状态按同样的顺序读一遍。
//
//   另一个观察：这里没有「先 diff 再应用」的优化。每个 apply 内部
//   都靠 `'x' in style` 过滤，所以真正落到 yoga setter 的调用
//   只对应实际变化的属性。省下的是 yoga 内部的脏标记 ——
//   重复 set 同一个值不会让 yoga 重算（它自己按值比较）。
//   所以这一层的成本主要是函数调用开销，不是布局重算。
const styles = (
  node: LayoutNode,
  style: Styles = {},
  resolvedStyle?: Styles,
): void => {
  applyPositionStyles(node, style)
  applyOverflowStyles(node, style)
  applyMarginStyles(node, style)
  applyPaddingStyles(node, style)
  applyFlexStyles(node, style)
  applyDimensionStyles(node, style)
  applyDisplayStyles(node, style)
  applyBorderStyles(node, style, resolvedStyle)
  applyGapStyles(node, style)
}

export default styles
