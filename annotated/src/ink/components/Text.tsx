import { c as _c } from "react/compiler-runtime";
import type { ReactNode } from 'react';
import React from 'react';
import type { Color, Styles, TextStyles } from '../styles.js';
type BaseProps = {
  /**
   * Change text color. Accepts a raw color value (rgb, hex, ansi).
   */
  readonly color?: Color;

  /**
   * Same as `color`, but for background.
   */
  readonly backgroundColor?: Color;

  /**
   * Make the text italic.
   */
  readonly italic?: boolean;

  /**
   * Make the text underlined.
   */
  readonly underline?: boolean;

  /**
   * Make the text crossed with a line.
   */
  readonly strikethrough?: boolean;

  /**
   * Inverse background and foreground colors.
   */
  readonly inverse?: boolean;

  /**
   * This property tells Ink to wrap or truncate text if its width is larger than container.
   * If `wrap` is passed (by default), Ink will wrap text and split it into multiple lines.
   * If `truncate-*` is passed, Ink will truncate text instead, which will result in one line of text with the rest cut off.
   */
  readonly wrap?: Styles['textWrap'];
  readonly children?: ReactNode;
};

/**
 * Bold and dim are mutually exclusive in terminals.
 * This type ensures you can use one or the other, but not both.
 */
// 【bold 和 dim 为什么必须互斥】
//
// 不是风格偏好，是 SGR 的表示能力不够：**SGR 22 同时取消粗体和暗色**
// （「normal intensity」，一对二）。终端里没有「只关掉 dim、保留 bold」
// 的办法。
//
// 所以如果允许同时传，渲染时得按顺序发 1（bold）和 2（dim），
// 之后想单独取消其中一个就做不到了 —— 只能两个一起关。
//
// 这里的选择是「把物理限制提前到类型层」：用三个成员的联合类型
// 让 `bold + dim` 编译不过。`bold?: never` 那一手是关键 ——
// 只写 `bold?: boolean; dim?: boolean` 是拦不住的。
//
// 这一条和 termio/sgr.ts 里「22 一对二」是同一件事的两端：
// 那边是解析时承认这个限制，这边是构造时就禁止。
type WeightProps = {
  bold?: never;
  dim?: never;
} | {
  bold: boolean;
  dim?: never;
} | {
  dim: boolean;
  bold?: never;
};
export type Props = BaseProps & WeightProps;
const memoizedStylesForWrap: Record<NonNullable<Styles['textWrap']>, Styles> = {
  wrap: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'wrap'
  },
  'wrap-trim': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'wrap-trim'
  },
  end: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'end'
  },
  middle: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'middle'
  },
  'truncate-end': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate-end'
  },
  truncate: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate'
  },
  'truncate-middle': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate-middle'
  },
  'truncate-start': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate-start'
  }
} as const;
// 【八个常量样式对象，为什么不是每次现造】
//
// 因为 reconciler 的 setStyle 是**按值比较**的（dom.ts 里逐键比）。
// 每次渲染造一个新对象 → 每次都比一遍 → 值相同则不标脏。
// 所以功能上不需要缓存，缓存省的是那 8 个键的比较，以及一次分配。
//
// 真正需要缓存的是别的：`memoizedStylesForWrap[wrap]` 让同一个 wrap
// 值永远拿到**同一个对象引用**，于是下面 `$[26] !== t15` 这一层
// memo 才能命中。换句话说，这八个字面量是为了让 React Compiler
// 的引用比较有效，而不是给 reconciler 看的。
//
// 注意每个条目都重复写了 flexGrow: 0 / flexShrink: 1 / flexDirection: 'row'
// —— 四行一模一样。这不能提取成公共对象（那样每个条目都要展开一次，
// 引用就又不稳定了）。

/**
 * This component can display text, and change its style to make it colorful, bold, underline, italic or strikethrough.
 */
// 组件体只有三件事：把 8 个可选的样式开关拼成 textStyles、
// 按 wrap 查表取布局样式，然后交给 ink-text。
//
// 值得注意的两处：
//   · 每个开关都是 `x && {x}`（第 138 行那种写法），false/undefined
//     时展开的是 false，`{...false}` 是合法且为空的 —— 所以不需要
//     先过滤，八次展开里没开的那些贡献零个键
//   · children 为空时直接返回 null（第 133 行），连一层空节点都不建。
//     这在「条件渲染文本」时很重要：`<Text>{maybe}</Text>` 在 maybe 为
//     undefined 时不占位、不影响布局
export default function Text(t0) {
  const $ = _c(29);
  const {
    color,
    backgroundColor,
    bold,
    dim,
    italic: t1,
    underline: t2,
    strikethrough: t3,
    inverse: t4,
    wrap: t5,
    children
  } = t0;
  const italic = t1 === undefined ? false : t1;
  const underline = t2 === undefined ? false : t2;
  const strikethrough = t3 === undefined ? false : t3;
  const inverse = t4 === undefined ? false : t4;
  const wrap = t5 === undefined ? "wrap" : t5;
  if (children === undefined || children === null) {
    return null;
  }
  let t6;
  if ($[0] !== color) {
    t6 = color && {
      color
    };
    $[0] = color;
    $[1] = t6;
  } else {
    t6 = $[1];
  }
  let t7;
  if ($[2] !== backgroundColor) {
    t7 = backgroundColor && {
      backgroundColor
    };
    $[2] = backgroundColor;
    $[3] = t7;
  } else {
    t7 = $[3];
  }
  let t8;
  if ($[4] !== dim) {
    t8 = dim && {
      dim
    };
    $[4] = dim;
    $[5] = t8;
  } else {
    t8 = $[5];
  }
  let t9;
  if ($[6] !== bold) {
    t9 = bold && {
      bold
    };
    $[6] = bold;
    $[7] = t9;
  } else {
    t9 = $[7];
  }
  let t10;
  if ($[8] !== italic) {
    t10 = italic && {
      italic
    };
    $[8] = italic;
    $[9] = t10;
  } else {
    t10 = $[9];
  }
  let t11;
  if ($[10] !== underline) {
    t11 = underline && {
      underline
    };
    $[10] = underline;
    $[11] = t11;
  } else {
    t11 = $[11];
  }
  let t12;
  if ($[12] !== strikethrough) {
    t12 = strikethrough && {
      strikethrough
    };
    $[12] = strikethrough;
    $[13] = t12;
  } else {
    t12 = $[13];
  }
  let t13;
  if ($[14] !== inverse) {
    t13 = inverse && {
      inverse
    };
    $[14] = inverse;
    $[15] = t13;
  } else {
    t13 = $[15];
  }
  let t14;
  if ($[16] !== t10 || $[17] !== t11 || $[18] !== t12 || $[19] !== t13 || $[20] !== t6 || $[21] !== t7 || $[22] !== t8 || $[23] !== t9) {
    t14 = {
      ...t6,
      ...t7,
      ...t8,
      ...t9,
      ...t10,
      ...t11,
      ...t12,
      ...t13
    };
    $[16] = t10;
    $[17] = t11;
    $[18] = t12;
    $[19] = t13;
    $[20] = t6;
    $[21] = t7;
    $[22] = t8;
    $[23] = t9;
    $[24] = t14;
  } else {
    t14 = $[24];
  }
  const textStyles = t14;
  const t15 = memoizedStylesForWrap[wrap];
// 按 wrap 查表，而不是「用 wrap 构造样式」。
// 好处是布局样式对象引用稳定；坏处是这 8 个 wrap 值被写死了三遍
// （styles.ts 的类型、这里的表、以及 wrap-text.ts 的分支）。
// 新增一种 wrap 要改三处，TypeScript 只能保证前两处一致
// （Record<NonNullable<Styles['textWrap']>, Styles> 会漏掉第三处）。
  let t16;
  if ($[25] !== children || $[26] !== t15 || $[27] !== textStyles) {
    t16 = <ink-text style={t15} textStyles={textStyles}>{children}</ink-text>;
// 【两个 prop，一条世界分割线】
//
//   style       布局（flex、margin、padding、overflow…）→ 走 yoga setter
//   textStyles  字样式（color、bold、italic…）→ 走 StylePool 的字体位
//
// 分成两个不是历史包袱，是**两个不同的求值时机**：
// 布局在 commit 后的同步阶段算（yoga 要它），字体样式要到绘字时才用
// （colorize 拼 SGR）。混在一个对象里的话，每次改颜色都会让 yoga
// 重新设一遍布局属性（dom.ts 的 setStyle 得逐个判断是哪个域）。
//
// 顺带：Text 只能包在 ink-text 里，ink-text 在 yoga 里挂 measure 回调
// （measure-text.ts），这就是「Text 里不能放 Box」「裸字符串必须包 Text」
// 两条规则的来源。
    $[25] = children;
    $[26] = t15;
    $[27] = textStyles;
    $[28] = t16;
  } else {
    t16 = $[28];
  }
  return t16;
}
// 原文件此处有一行 11732 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。