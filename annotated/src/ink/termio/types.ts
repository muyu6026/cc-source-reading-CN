// ═══════════════════════════════════════════════════════════════
//  termio 的「语义层」：解析结果长什么样
// ═══════════════════════════════════════════════════════════════
//
//   英文头注释里那句「represent the semantic meaning, not their string
//   representation」是整层的设计纲领。举例来说：
//
//     输入      ESC [ 3 1 m
//     不这样    { type: 'sgr', codes: [31] }          ← 还是字符串换了个壳
//     而是      { fg: { type: 'named', name: 'red' } } ← 已经是语义
//
//   这个转换发生在 sgr.ts，而**这一层不产生任何字符串**，所以
//   消费方（Ansi.tsx）不需要再解析一次。
//
// 【一个容易忽略的事实：这份文件里有两种「结果」】
//   动作类（Action 联合）——「发生了一件事」，如移动光标、开超链接
//   状态类（TextStyle）  ——「现在是什么样」，被 Action 引用
//
//   区别在 parser.ts：SGR 不进 Action 流，它直接改 Parser 的 style 字段，
//   后续的 text 动作才带上那个 style。所以 SGR 是**状态**不是**事件**。
/**
 * ANSI Parser - Semantic Types
 *
 * These types represent the semantic meaning of ANSI escape sequences,
 * not their string representation. Inspired by ghostty's action-based design.
 */

// =============================================================================
// Colors
// =============================================================================

/** Named colors from the 16-color palette */
// 【这 16 个名字的顺序是有承载的】
//
//   它必须与 SGR 的码位严格对齐：下标 0 对应 30（黑），下标 7 对应 37（白），
//   下标 8 对应 90（亮黑），下标 15 对应 97（亮白）。
//
//   sgr.ts 全靠这个对齐做查表：`NAMED_COLORS[code - 30]` 和
//   `NAMED_COLORS[code - 90 + 8]`。**改这个数组的顺序会静默改变所有颜色**，
//   而且没有任何断言保护 —— 错位不会报错，只会红变绿。
//
//   这种「隐式下标的表」，本项目里已经出现过三次（screen.ts 的 StylePool.none
//   必须为 0、charPool[0] 必须是空格、这里）。共同点是：**跨文件契约，
//   靠注释维系，靠人记住。**
export type NamedColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'

/** Color specification - can be named, indexed (256), or RGB */
// 【四种颜色，覆盖终端的三套色域】
//
//   named      16 色（SGR 30-37 / 90-97）
//   indexed    256 色（SGR 38;5;n）—— 其中 0-15 与 named 重叠
//   rgb        真彩色（SGR 38;2;r;g;b）
//   default    恢复默认（SGR 39）—— **不是黑色，是「终端说了算」**
//
//   最后一个最容易搞错。default 表示「把这个属性交还给终端」，
//   在深色主题下是浅灰、浅色主题下是深灰。用 named black 代替它，
//   在浅色主题下就变成不可读的黑底黑字。
//
//   注意这里**不校验 index 的范围**（注释写了 0-255 但类型是 number）。
//   越界值下游怎么处理取决于 screen.ts 的样式池。
export type Color =
  | { type: 'named'; name: NamedColor }
  | { type: 'indexed'; index: number } // 0-255
  | { type: 'rgb'; r: number; g: number; b: number }
  | { type: 'default' }

// =============================================================================
// Text Styles
// =============================================================================

/** Underline style variants */
// 六种下划线。只有 `4` 带冒号子参数时才能表达中间四种
//   （`4:3` = 波浪线），裸 `4` 一律是 single。
//
//   terminal 支持度差异很大：curly（波浪）基本只有 kitty/wezterm/ghostty 有，
//   老终端会把 `4:3` 整条忽略 —— 于是「该有下划线的地方什么都没有」。
//   所以用之前要确认目标终端。
export type UnderlineStyle =
  | 'none'
  | 'single'
  | 'double'
  | 'curly'
  | 'dotted'
  | 'dashed'

/** Text style attributes - represents current styling state */
// 【全部字段必填，没有一个是可选的 —— 这是有意的】
//
//   好处：stylesEqual 可以逐字段比较，不需要处理 undefined；
//   applySGR 从 `{...style}` 开始改，不需要「继承缺失字段」。
//
//   代价：这个类型**不能表达「部分样式」**。所以下游 Ansi.tsx 必须把它
//   转成 span props（textStyleToSpanProps），那个 props 类型才是可选的。
//   边界划在这里：termio 内部要完整状态，UI 层要增量覆盖。
//
//   还有一处值得注意：这里的 TextStyle 和 screen.ts 里的样式表示
//   **完全不是一回事**。screen 那边是一个整数 ID（进 StylePool 去重），
//   这里是一个对象。两者的转换发生在渲染管线的很后面。
export type TextStyle = {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: UnderlineStyle
  blink: boolean
  inverse: boolean
  hidden: boolean
  strikethrough: boolean
  overline: boolean
  fg: Color
  bg: Color
  underlineColor: Color
}

/** Create a default (reset) text style */
// 【必须每次返回新对象，不能返回共享的冻结常量】
//
//   applySGR 的第一行是 `let s = { ...style }`，然后原地改 s 的字段。
//   如果 defaultStyle 返回一个模块级常量，`code === 0`（SGR 重置）时
//   拿到的就是那个共享对象，后续的修改会污染全局默认值 ——
//   症状是「重置样式之后屏幕变成上一次的残留颜色」，而且只在
//   「先设过样式、又遇到重置」的特定顺序下出现。
//
//   函数名是 default**Style**（造一个新对象）而不是 DEFAULT_STYLE
//   （一个常量），这个命名本身就说明了契约。
export function defaultStyle(): TextStyle {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: 'none',
    blink: false,
    inverse: false,
    hidden: false,
    strikethrough: false,
    overline: false,
    fg: { type: 'default' },
    bg: { type: 'default' },
    underlineColor: { type: 'default' },
  }
}

/** Check if two styles are equal */
// 逐字段比较，没有短路技巧。12 个字段，其中 3 个要递归比较颜色。
//
//   为什么需要它：Ansi.tsx 用它判断相邻的两个 text 动作能不能合并成
//   一个 span（少一个节点就少一次 yoga 布局）。没有它的话，
//   一段红色文字会被拆成「红、红、红…」很多个 span。
//
//   性能上这个函数在解析期被调用，量级是「文本段数」，不是「字符数」，
//   所以逐字段比较完全够用。
export function stylesEqual(a: TextStyle, b: TextStyle): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.blink === b.blink &&
    a.inverse === b.inverse &&
    a.hidden === b.hidden &&
    a.strikethrough === b.strikethrough &&
    a.overline === b.overline &&
    colorsEqual(a.fg, b.fg) &&
    colorsEqual(a.bg, b.bg) &&
    colorsEqual(a.underlineColor, b.underlineColor)
  )
}

/** Check if two colors are equal */
// 【`case 'default': return true` —— 两个「默认色」永远相等】
//
//   这一行看着像漏了比较，其实是对的：default 类型不带任何数据，
//   两个 default 之间没有可比的字段。
//
//   但它必须放在 `a.type !== b.type` 之后。如果放在前面，
//   default 和 rgb 也会被判定相等 —— 而那是完全不同的一件事
//   （「交给终端」vs「指定颜色」）。
//
//   下面三个分支的 `b as typeof a` 强制转换是 TypeScript 的局限：
//   switch 已经窄化了 a 的类型，但不会同时窄化 b。运行时没问题，
//   因为 105 行已经确认两者 type 相同。
export function colorsEqual(a: Color, b: Color): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'named':
      return a.name === (b as typeof a).name
    case 'indexed':
      return a.index === (b as typeof a).index
    case 'rgb':
      return (
        a.r === (b as typeof a).r &&
        a.g === (b as typeof a).g &&
        a.b === (b as typeof a).b
      )
    case 'default':
      return true
  }
}

// =============================================================================
// Cursor Actions
// =============================================================================

export type CursorDirection = 'up' | 'down' | 'forward' | 'back'

// 【相对移动和绝对定位混在一个联合里，且坐标基准不一致】
//
//   move      相对，count 是「多少格」
//   position  绝对，row/col 从 1 开始（CSI H 的语义）
//   column    绝对列，1 基（CSI G）
//   row       绝对行，1 基（CSI d）
//   nextLine  下移并回到行首（CSI E / ESC E）
//
//   基准的不一致是个真实风险：parser.ts 把 CSI 的参数原样塞进来，
//   所以调用方拿到 row=1 时必须知道「这是第一行，不是第零行」。
//   类型上没有任何标记区分 0 基和 1 基，全靠约定。
export type CursorAction =
  | { type: 'move'; direction: CursorDirection; count: number }
  | { type: 'position'; row: number; col: number }
  | { type: 'column'; col: number }
  | { type: 'row'; row: number }
  | { type: 'save' }
  | { type: 'restore' }
  | { type: 'show' }
  | { type: 'hide' }
  | {
      type: 'style'
      style: 'block' | 'underline' | 'bar'
      blinking: boolean
    }
  | { type: 'nextLine'; count: number }
  | { type: 'prevLine'; count: number }

// =============================================================================
// Erase Actions
// =============================================================================

// 三种擦除，粒度不同：
//   display  整屏（或到屏首/屏尾/连回滚缓冲一起擦）
//   line     整行
//   chars    从光标往后的 n 个字符（ECH，不移动光标）
//
//   display 有四个 region 而 line 只有三个，因为「擦回滚缓冲」（CSI 3 J）
//   只对整屏有意义。这个不对称在 csi.ts 的 ERASE_DISPLAY /
//   ERASE_LINE_REGION 两个数组长度上也体现着。
export type EraseAction =
  | { type: 'display'; region: 'toEnd' | 'toStart' | 'all' | 'scrollback' }
  | { type: 'line'; region: 'toEnd' | 'toStart' | 'all' }
  | { type: 'chars'; count: number }

// =============================================================================
// Scroll Actions
// =============================================================================

// 滚动三态。setRegion 是 DECSTBM（设滚动区域），不是「滚」，但归在
//   同一类里 —— 因为它们都改变「屏幕内容的位移方式」。
//
//   up/down 是内容滚动，光标不动；这和 cursor 的 move 是两件事
//   （后者光标动、内容不动）。混起来会导致「滚动了却按光标位置去算」
//   这类错误。
export type ScrollAction =
  | { type: 'up'; count: number }
  | { type: 'down'; count: number }
  | { type: 'setRegion'; top: number; bottom: number }

// =============================================================================
// Mode Actions
// =============================================================================

// 【mouseTracking 是四态，但它建模的是「等级」不是「开关集合」】
//
//   off / normal(1000) / button(1002) / any(1003)
//
//   真实的终端里这三个模式是**可以同时开**的（dec.ts 51 行就四个一起开）。
//   而这个类型只能表示「最高的那个」。所以丢失了「1000 是否也开着」
//   这个信息 —— 对重放场景（把这个 action 再渲染成序列）会失真。
//
//   实际影响很小：目前没有任何消费方拿它去重建序列，只用来判断
//   「鼠标事件会不会来」。**类型随用途简化**，不是缺陷但要知道边界。
export type ModeAction =
  | { type: 'alternateScreen'; enabled: boolean }
  | { type: 'bracketedPaste'; enabled: boolean }
  | { type: 'mouseTracking'; mode: 'off' | 'normal' | 'button' | 'any' }
  | { type: 'focusEvents'; enabled: boolean }

// =============================================================================
// Link Actions (OSC 8)
// =============================================================================

// OSC 8 超链接：start 带 url，end 不带任何东西。
//
//   `end` 没有 url 字段是刻意的 —— OSC 8 的关闭序列就是「空 url」，
//   而「关掉哪个链接」由位置决定（栈顶那个）。所以不需要 id。
//
//   【但 start 的 params 里其实有 id】见 osc.ts 403 行的 link()：
//   它会自动从 url 算一个 id 塞进 params。原因是 OSC 8 规范说
//   「只有 URI 和**非空 id** 都相同」的格子才算同一个链接 ——
//   没有 id 的话，一段跨行的链接会被终端当成多个独立链接，
//   hover 时提示框会断在换行处。
export type LinkAction =
  | { type: 'start'; url: string; params?: Record<string, string> }
  | { type: 'end' }

// =============================================================================
// Title Actions (OSC 0/1/2)
// =============================================================================

export type TitleAction =
  | { type: 'windowTitle'; title: string }
  | { type: 'iconName'; name: string }
  | { type: 'both'; title: string }

// =============================================================================
// Tab Status Action (OSC 21337)
// =============================================================================

/**
 * Per-tab chrome metadata. Tristate for each field:
 *  - property absent → not mentioned in sequence, no change
 *  - null → explicitly cleared (bare key or key= with empty value)
 *  - value → set to this
 */
// 【上面那段三态说明，是全仓库注释里写得最清楚的一处 —— 补一句它没说的】
//
//   它提到「property absent → no change」。这个「键不存在」的判据，
//   和 styles.ts 的 `'x' in style`（reconciler 的 diff 把删除写成
//   `{key: undefined}`）是**同一个问题的第二次出现**：缺省值到底表示
//   「不动」还是「清空」，必须在类型层面能区分。
//
//   那次踩的坑是判据写错（用了 `!== undefined`，把「显式清空」和
//   「没提到」混成一类）；这次直接把三态写进了类型。同一个坑，
//   第一次靠约定，第二次靠类型 —— 这是很典型的演进路径。
export type TabStatusAction = {
  indicator?: Color | null
  status?: string | null
  statusColor?: Color | null
}

// =============================================================================
// Parsed Segments - The output of the parser
// =============================================================================

/** A segment of styled text */
// 【这个类型没有使用者】
//
//   全仓库搜 TextSegment，只有 utils/textHighlighting.ts 里另一个同名
//   类型（高亮用，字段完全不同）。这里导出的这个，从 termio.ts 的
//   桶文件里也 export 出去了，但没有任何 import。
//
//   留着的原因大概是「本来打算让 Parser 返回 TextSegment 流，后来改成了
//   Action 流」。所以它是设计的残留物 —— 读的时候不用花时间理解它。
export type TextSegment = {
  type: 'text'
  text: string
  style: TextStyle
}

/** A grapheme (visual character unit) with width info */
// 【width 只有 1 和 2，没有 0 —— 而唯一的消费方根本不读它】
//
//   组合字符（é 由 e + 组合重音构成）在终端里占 0 列，但它们被
//   Intl.Segmenter 合并进了同一个 grapheme，所以 grapheme 级别
//   不会出现 0 宽。只有一个孤立的组合符才会 —— 那种情况这里会算成 1，
//   是错的，但孤立组合符本来就不该出现在文本里。
//
//   【真正值得注意的是：Ansi.tsx 只用 grapheme.value】
//   它 133 行是 `action.graphemes.map(g => g.value).join('')` ——
//   把 grapheme 拼回字符串，宽度信息直接丢弃。最终宽度由 stringWidth.ts
//   在布局阶段重新算一遍。
//
//   所以 parser.ts 里那套 isEmoji / isEastAsianWide 的粗粒度区间判断
//   （见那一份的批注）**目前是死代码级的冗余**。它不影响正确性
//   （因为没人读），但如果哪天有人拿它当权威宽度去布局，会踩坑 ——
//   它的表格精度远不如 stringWidth.ts。
export type Grapheme = {
  value: string
  width: 1 | 2 // Display width in columns
}

/** All possible parsed actions */
// 【Action 联合的读法：先看哪些是「事件」，哪些是「状态」】
//
//   text        事件：一段文字 + 当时的样式（样式是快照，不是引用）
//   sgr         状态：**只带原始参数串，不带解析结果**
//   reset       事件：ESC c 全量重置
//   unknown     事件：没认出来，带原文
//   其余        事件：光标 / 擦除 / 滚动 / 模式 / 链接 / 标题 / 页签 / 响铃
//
//   sgr 那一项是最特别的：`{ type: 'sgr'; params: string }` 只装字符串，
//   因为解析器（parser.ts 346 行）会把它**拦下来**应用到自己身上，
//   根本不会传给消费方。所以这个 variant 实际上从不逃出 Parser。
//
//   这意味着：**Action 流的接收方永远看不到样式变化事件**，
//   只能看到「带样式的文本」。想看样式怎么变的，得读 Parser 的内部状态。
//   这是一个明确的取舍 —— 简化了消费方，代价是无法重放样式序列。
export type Action =
  | { type: 'text'; graphemes: Grapheme[]; style: TextStyle }
  | { type: 'cursor'; action: CursorAction }
  | { type: 'erase'; action: EraseAction }
  | { type: 'scroll'; action: ScrollAction }
  | { type: 'mode'; action: ModeAction }
  | { type: 'link'; action: LinkAction }
  | { type: 'title'; action: TitleAction }
  | { type: 'tabStatus'; action: TabStatusAction }
  | { type: 'sgr'; params: string } // Select Graphic Rendition (style change)
  | { type: 'bell' }
  | { type: 'reset' } // Full terminal reset (ESC c)
  | { type: 'unknown'; sequence: string } // Unrecognized sequence
