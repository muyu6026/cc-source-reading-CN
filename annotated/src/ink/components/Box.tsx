// ⚠️ 这是 **React Compiler 的产物**，不是人写的组件。
//
//   _c(42)            申请 42 个 memo 缓存槽（$[0] … $[41]）
//   if ($[0] !== t0)  输入没变就整段跳过，直接从 $ 槽里取上次的结果
//   t1 … t18          展开后的临时变量，原名是 children/style/onClick…
//
// 读这种代码的正确姿势：**先还原成原始 JSX**，再读逻辑。
// 这段代码的原始版本大约 40 行：
//
//   function Box({children, ref, tabIndex, autoFocus, onClick, …,
//                flexWrap = 'nowrap', flexDirection = 'row',
//                flexGrow = 0, flexShrink = 1, ...style}) {
//     warn.ifNotInteger(style.margin, 'margin')  // …共 16 次
//     return <ink-box … style={{flexWrap, flexDirection, flexGrow,
//                               flexShrink, ...style,
//                               overflowX, overflowY}}>{children}</ink-box>
//   }
//
// （Ansi.tsx 那批批注里讲过同一套记号，这里只补 Box 特有的部分。）
import { c as _c } from "react/compiler-runtime";
import '../global.d.ts';
import React, { type PropsWithChildren, type Ref } from 'react';
import type { Except } from 'type-fest';
import type { DOMElement } from '../dom.js';
import type { ClickEvent } from '../events/click-event.js';
import type { FocusEvent } from '../events/focus-event.js';
import type { KeyboardEvent } from '../events/keyboard-event.js';
import type { Styles } from '../styles.js';
import * as warn from '../warn.js';
export type Props = Except<Styles, 'textWrap'> & {
  ref?: Ref<DOMElement>;
  /**
   * Tab order index. Nodes with `tabIndex >= 0` participate in
   * Tab/Shift+Tab cycling; `-1` means programmatically focusable only.
   */
  tabIndex?: number;
  /**
   * Focus this element when it mounts. Like the HTML `autofocus`
   * attribute — the FocusManager calls `focus(node)` during the
   * reconciler's `commitMount` phase.
   */
  autoFocus?: boolean;
  /**
   * Fired on left-button click (press + release without drag). Only works
   * inside `<AlternateScreen>` where mouse tracking is enabled — no-op
   * otherwise. The event bubbles from the deepest hit Box up through
   * ancestors; call `event.stopImmediatePropagation()` to stop bubbling.
   */
  onClick?: (event: ClickEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onFocusCapture?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onBlurCapture?: (event: FocusEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  /**
   * Fired when the mouse moves into this Box's rendered rect. Like DOM
   * `mouseenter`, does NOT bubble — moving between children does not
   * re-fire on the parent. Only works inside `<AlternateScreen>` where
   * mode-1003 mouse tracking is enabled.
   */
  onMouseEnter?: () => void;
  /** Fired when the mouse moves out of this Box's rendered rect. */
  onMouseLeave?: () => void;
};
// `Except<Styles, 'textWrap'>` —— 把 textWrap 从 Props 里**删掉**，
// 不是因为 Box 不支持它，而是因为「折行/截断」是 Text 的语义：
//
//   Text   有子文本节点，折行时要知道在哪断
//   Box    只是容器，自己没有内容可折
//
// 允许 Box 传 textWrap 的后果是「传了但没效果」，比编译期报错糟糕得多。
// 同一份 styles.ts 里 textWrap 是 Styles 的字段（所以 ScrollBox 又把它
// 排除了第二遍），说明这个「谁的字段」的边界是靠 Except 手工划的。

/**
 * `<Box>` is an essential Ink component to build your layout. It's like `<div style="display: flex">` in the browser.
 */
function Box(t0) {
  const $ = _c(42);
  let autoFocus;
  let children;
  let flexDirection;
  let flexGrow;
  let flexShrink;
  let flexWrap;
  let onBlur;
  let onBlurCapture;
  let onClick;
  let onFocus;
  let onFocusCapture;
  let onKeyDown;
  let onKeyDownCapture;
  let onMouseEnter;
  let onMouseLeave;
  let ref;
  let style;
  let tabIndex;
  if ($[0] !== t0) {
    const {
      children: t1,
      flexWrap: t2,
      flexDirection: t3,
      flexGrow: t4,
      flexShrink: t5,
      ref: t6,
      tabIndex: t7,
      autoFocus: t8,
      onClick: t9,
      onFocus: t10,
      onFocusCapture: t11,
      onBlur: t12,
      onBlurCapture: t13,
      onMouseEnter: t14,
      onMouseLeave: t15,
      onKeyDown: t16,
      onKeyDownCapture: t17,
      ...t18
    } = t0;
    children = t1;
    ref = t6;
    tabIndex = t7;
    autoFocus = t8;
    onClick = t9;
    onFocus = t10;
    onFocusCapture = t11;
    onBlur = t12;
    onBlurCapture = t13;
    onMouseEnter = t14;
    onMouseLeave = t15;
    onKeyDown = t16;
    onKeyDownCapture = t17;
    style = t18;
    flexWrap = t2 === undefined ? "nowrap" : t2;
// 【默认值区：和 CSS flexbox 对齐】
//
//   flexDirection 'row'       CSS 默认 row（不是 column —— 这是新人最常
//                             记错的一条，ink 这里跟 CSS 走）
//   flexWrap      'nowrap'    CSS 默认 nowrap
//   flexGrow      0           CSS 默认 0
//   flexShrink    1           CSS 默认 1
//
// 四个默认值全对齐 CSS，一个都没改。好处是从网页转过来的人不用重学；
// 代价是终端里「列布局」比网页更常见（聊天记录、列表），所以
// ink 的调用方几乎每处都要显式写 flexDirection="column"。
    flexDirection = t3 === undefined ? "row" : t3;
    flexGrow = t4 === undefined ? 0 : t4;
    flexShrink = t5 === undefined ? 1 : t5;
    warn.ifNotInteger(style.margin, "margin");
// 【16 次 ifNotInteger，全在这个 memo 分支里】
//
// 它们检查的是「间距类属性必须是整数」—— 因为终端没有半个格子，
// margin 0.5 只能四舍五入，而四舍五入是**静默**的（yoga 里是 DP
// 单位，0.5 真会变成小数，最后取整时丢一位）。
//
// 但注意位置：这一整段只在 `$[0] !== t0`（props 引用变了）时才跑。
// 所以「父组件把 props 对象 memo 住」时，这些警告一次都不会打。
// 对警告来说这个行为可以接受（第一次渲染总会检查），但如果把它
// 当成「校验」用，就会误判。
//
// 另一件事：这 16 行是**手工列举**的。新增一个间距属性（比如 inset）
// 必须记得加一行，没有「遍历所有 Styles 里以 margin/padding 开头的键」
// 这种自动做法。
    warn.ifNotInteger(style.marginX, "marginX");
    warn.ifNotInteger(style.marginY, "marginY");
    warn.ifNotInteger(style.marginTop, "marginTop");
    warn.ifNotInteger(style.marginBottom, "marginBottom");
    warn.ifNotInteger(style.marginLeft, "marginLeft");
    warn.ifNotInteger(style.marginRight, "marginRight");
    warn.ifNotInteger(style.padding, "padding");
    warn.ifNotInteger(style.paddingX, "paddingX");
    warn.ifNotInteger(style.paddingY, "paddingY");
    warn.ifNotInteger(style.paddingTop, "paddingTop");
    warn.ifNotInteger(style.paddingBottom, "paddingBottom");
    warn.ifNotInteger(style.paddingLeft, "paddingLeft");
    warn.ifNotInteger(style.paddingRight, "paddingRight");
    warn.ifNotInteger(style.gap, "gap");
    warn.ifNotInteger(style.columnGap, "columnGap");
    warn.ifNotInteger(style.rowGap, "rowGap");
    $[0] = t0;
    $[1] = autoFocus;
    $[2] = children;
    $[3] = flexDirection;
    $[4] = flexGrow;
    $[5] = flexShrink;
    $[6] = flexWrap;
    $[7] = onBlur;
    $[8] = onBlurCapture;
    $[9] = onClick;
    $[10] = onFocus;
    $[11] = onFocusCapture;
    $[12] = onKeyDown;
    $[13] = onKeyDownCapture;
    $[14] = onMouseEnter;
    $[15] = onMouseLeave;
    $[16] = ref;
    $[17] = style;
    $[18] = tabIndex;
  } else {
    autoFocus = $[1];
    children = $[2];
    flexDirection = $[3];
    flexGrow = $[4];
    flexShrink = $[5];
    flexWrap = $[6];
    onBlur = $[7];
    onBlurCapture = $[8];
    onClick = $[9];
    onFocus = $[10];
    onFocusCapture = $[11];
    onKeyDown = $[12];
    onKeyDownCapture = $[13];
    onMouseEnter = $[14];
    onMouseLeave = $[15];
    ref = $[16];
    style = $[17];
    tabIndex = $[18];
  }
  const t1 = style.overflowX ?? style.overflow ?? "visible";
// 三级回退：`overflowX ?? overflow ?? 'visible'`。
//
// 顺序是「具体 → 通用 → 默认」。所以同时写 overflow 和 overflowX 时，
// 更具体的那个赢。这和 CSS 的 shorthand 展开规则一致。
//
// 为什么要在这个组件里做而不是交给 yoga：yoga 只认 overflowX/overflowY
// 两个轴，没有 shorthand。这层归一化必须有人做，Box 是唯一必经之路。
  const t2 = style.overflowY ?? style.overflow ?? "visible";
  let t3;
  if ($[19] !== flexDirection || $[20] !== flexGrow || $[21] !== flexShrink || $[22] !== flexWrap || $[23] !== style || $[24] !== t1 || $[25] !== t2) {
    t3 = {
      flexWrap,
      flexDirection,
      flexGrow,
      flexShrink,
      ...style,
      overflowX: t1,
      overflowY: t2
    };
    $[19] = flexDirection;
    $[20] = flexGrow;
    $[21] = flexShrink;
    $[22] = flexWrap;
    $[23] = style;
    $[24] = t1;
    $[25] = t2;
    $[26] = t3;
  } else {
    t3 = $[26];
  }
  let t4;
  if ($[27] !== autoFocus || $[28] !== children || $[29] !== onBlur || $[30] !== onBlurCapture || $[31] !== onClick || $[32] !== onFocus || $[33] !== onFocusCapture || $[34] !== onKeyDown || $[35] !== onKeyDownCapture || $[36] !== onMouseEnter || $[37] !== onMouseLeave || $[38] !== ref || $[39] !== t3 || $[40] !== tabIndex) {
    t4 = <ink-box ref={ref} tabIndex={tabIndex} autoFocus={autoFocus} onClick={onClick} onFocus={onFocus} onFocusCapture={onFocusCapture} onBlur={onBlur} onBlurCapture={onBlurCapture} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture} style={t3}>{children}</ink-box>;
// `<ink-box>` 是 **host 组件**（reconciler 的 createInstance 认的就是
// 这个名字，见 reconciler.ts）。所以这里不是「渲染一个叫 ink-box 的
// React 组件」，而是「向 reconciler 要一个 ink-box 类型的 DOM 节点」。
//
// style 的展开顺序：显式的四个 flex 值在前，`...style` 在后 ——
// 后展开的赢。但因为那四个已经从 props 里解构出来了（第 72-91 行），
// style 里不可能再有它们，所以这个顺序实际不产生覆盖。
// 真正有意义的是最后的 overflowX/overflowY：它们在 `...style` **之后**，
// 保证覆盖掉 style 里可能带的 overflow。
    $[27] = autoFocus;
    $[28] = children;
    $[29] = onBlur;
    $[30] = onBlurCapture;
    $[31] = onClick;
    $[32] = onFocus;
    $[33] = onFocusCapture;
    $[34] = onKeyDown;
    $[35] = onKeyDownCapture;
    $[36] = onMouseEnter;
    $[37] = onMouseLeave;
    $[38] = ref;
    $[39] = t3;
    $[40] = tabIndex;
    $[41] = t4;
  } else {
    t4 = $[41];
  }
  return t4;
}
export default Box;
// 原文件此处有一行 14856 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。