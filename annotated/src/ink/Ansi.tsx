// ═══════════════════════════════════════════════════════════════
//  先看这一行：这不是人写的代码
// ═══════════════════════════════════════════════════════════════
//
//   `import { c as _c } from "react/compiler-runtime"` 是 React Compiler
//   的注入标记。这个文件里的人写的版本已经被**编译器重写**过了：
//   自动加了 memo 缓存，把每个可能重复计算的值塞进一个数组槽位。
//
// 【怎么读这种代码】
//   记住三条映射，整份文件就通了：
//     const $ = _c(12)        → 「这个组件有 12 个缓存槽」
//     if ($[3] !== children)  → 「依赖变了才重算」
//     $[3] = children         → 「记下这次的值」
//   所以看到 `if ($[3] !== x || $[4] !== y) { 算一遍; $[5] = 结果 }`
//   else `{ 结果 = $[5] }`，直接读成「以 x 和 y 为依赖的 useMemo」。
//
//   `bb0: { ... break bb0 }` 是 labeled block —— 编译器用它表达
//   「可能提前返回」。`Symbol.for('react.early_return_sentinel')`
//   是哨兵值，用来区分「缓存了一个提前返回」和「缓存槽还没填」。
//
// 【想看人写的版本怎么办】
//   文件末尾那行 sourceMappingURL 的 base64 里，除了映射表还内嵌了
//   **原始 TSX 全文**（sourcesContent 字段）。解码那个 JSON 就能拿到
//   308 行的原始文件。这一步值得做 —— 编译后的代码能看懂逻辑，
//   但「为什么这么写」的痕迹（注释、类型、命名）只在原文里。
//   本文件末尾我用脚本解过一次，下面几处批注会引用原文的写法。
//
// 【这个组件在链路里的位置】
//   colorize.ts 是「结构化样式 → ANSI 字符串」，
//   这个文件是反方向：「ANSI 字符串 → 组件树」。
//   用途是接外部工具的输出（语法高亮、diff、lint 结果），
//   它们只给字符串，不给你结构化信息。
//   所以这里是「把别人的字符串重新解析回我们能渲染的东西」。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import Link from './components/Link.js';
import Text from './components/Text.js';
import type { Color } from './styles.js';
import { type NamedColor, Parser, type Color as TermioColor, type TextStyle } from './termio.js';
// 输入只有两种：一个字符串，和一个「强制变暗」的开关。
//   原始版本这里有个 JSDoc 说明 dimColor 的语义，编译器把它挪到上面去了
//   （注释保留，位置变了）。
type Props = {
  children: string;
  /** When true, force all text to be rendered with dim styling */
  dimColor?: boolean;
};
type SpanProps = {
  color?: Color;
  backgroundColor?: Color;
  dim?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  hyperlink?: string;
};

/**
 * Component that parses ANSI escape codes and renders them using Text components.
 *
 * Use this as an escape hatch when you have pre-formatted ANSI strings from
 * external tools (like cli-highlight) that need to be rendered in Ink.
 *
 * Memoized to prevent re-renders when parent changes but children string is the same.
 */
// React.memo 是原文就有的，不是编译器加的 —— 编译器只负责**内部**的
//   缓存，组件级跳过渲染仍然是 memo 的职责。两者解决的不是同一个问题：
//     memo        → props 没变就整个不执行
//     编译器缓存  → 执行了，但内部的重计算跳过
//   所以这个文件里两层都有。
export const Ansi = React.memo(function Ansi(t0) {
// `_c(12)` 声明 12 个缓存槽。编译器会**按需**分配槽位，
//   这个数字是它算出来的（每个可能被重复计算的值占一个）。
//   槽位下标（$[0] 到 $[11]）是编译产物，不要试图手工维护 ——
//   改一行代码，所有下标都可能平移。
  const $ = _c(12);
  const {
    children,
    dimColor
  } = t0;
// 第一个分支：children 不是字符串（比如传了数字、元素）。
//   这是**类型守卫的运行时兜底** —— 类型上 children 是 string，
//   但调用方可能是 JS 代码或者 any 类型的地方。
//
//   注意这里 String(children) 强制转换后再渲染，而不是直接丢给 Text。
//   Text 组件期望字符串或可展平的子树，给个对象会让 measureTextNode
//   的分支走不通（见 dom.ts 的 squashTextNodes）。
  if (typeof children !== "string") {
    let t1;
    if ($[0] !== children || $[1] !== dimColor) {
      t1 = dimColor ? <Text dim={true}>{String(children)}</Text> : <Text>{String(children)}</Text>;
      $[0] = children;
      $[1] = dimColor;
      $[2] = t1;
    } else {
      t1 = $[2];
    }
    return t1;
  }
// 空串直接返回 null。这一条在编译后仍然是一行 if ——
//   因为 null 不需要缓存（没有计算）。
//   原文里的注释说明「空串没有可渲染内容」，编译器把它删掉了。
  if (children === "") {
    return null;
  }
  let t1;
  let t2;
// 从这里开始是编译器缓存的核心模式，值得逐行读一遍：
//
//   if ($[3] !== children || $[4] !== dimColor) {   ← 依赖变了？
//     t2 = Symbol.for("react.early_return_sentinel");  ← 先假设「没有提前返回」
//     bb0: {
//       const spans = parseToSpans(children);       ← 真正的计算
//       if (spans.length === 0) { t2 = null; break bb0 }  ← 提前返回，记进 t2
//       ...
//     }
//     $[3] = children; $[4] = dimColor;             ← 记下依赖
//     $[5] = t1; $[6] = t2;                         ← 记下两个结果
//   } else {
//     t1 = $[5]; t2 = $[6];                         ← 缓存命中
//   }
//
// 【为什么要两个结果变量】
//   因为原函数有**两条不同形态的出口**：
//     · 提前 return（null 或单 span 的快路径）
//     · 正常 return（一组 span 包在 Text 里）
//   靠 t2 是不是 sentinel 来区分走哪条。这是「把控制流编码进数据」——
//   编译器不能把 `return` 语句缓存进数组槽，只能转成值。
//
//   这也解释了为什么缓存槽数会膨胀：原函数里每多一个提前 return，
//   就多一个需要被缓存的结果槽。
  if ($[3] !== children || $[4] !== dimColor) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const spans = parseToSpans(children);
      if (spans.length === 0) {
        t2 = null;
        break bb0;
      }
// 单 span 且无任何样式属性时的快路径：直接一个裸 Text，不套 StyledText。
//   这不是性能优化，是**渲染结果的区别** —— 多套一层组件
//   会在 DOM 树上多一个节点，多一次属性比较，多一次 markDirty 判断。
//   一条纯文本的日志行走这条路径，成本几乎为零。
//
//   原文里这一行还带了一个非空断言 `spans[0]!.props`，编译后类型信息
//   消失，断言也没了。
      if (spans.length === 1 && !hasAnyProps(spans[0].props)) {
        t2 = dimColor ? <Text dim={true}>{spans[0].text}</Text> : <Text>{spans[0].text}</Text>;
        break bb0;
      }
      let t3;
      if ($[7] !== dimColor) {
// 渲染函数被编译成「按依赖缓存的工厂」：只要 dimColor 没变，
//   这个闭包就不重建（$[7] 存依赖，$[8] 存闭包）。
//
//   注意闭包捕获的只有 dimColor —— 不是 spans。因为 spans 是通过
//   参数传进 map 的，而 dimColor 是从外层捕获的。
//   编译器分析出了这个最小依赖集，所以 spans 变了不需要重建闭包。
        t3 = (span, i) => {
          const hyperlink = span.props.hyperlink;
// `span.props.dim = true` —— 这是**原地修改**，不是返回新对象。
//
//   为什么安全：spans 是 parseToSpans 每次调用新建的，没有被外部持有。
//   它在 map 里改自己的元素，不会影响别人。
//
//   但这里有个更微妙的问题：这段代码只在缓存 miss 时执行一次。
//   缓存命中时 span.props.dim 不会被设置 —— 而 content 也是缓存的那一份，
//   所以视觉上一致。**编译器的缓存正确性依赖这个函数是纯的**，
//   而它其实有一个副作用。二者之所以没出问题，是因为副作用和结果
//   被一起缓存了。这类「碰巧安全」是读编译产物时最容易忽略的地方。
          if (dimColor) {
            span.props.dim = true;
          }
          const hasTextProps = hasAnyTextProps(span.props);
          if (hyperlink) {
// 三层嵌套的三元表达式，编译后变成一行超长 JSX。
//   拆开是这样的四种组合：
//     有 hyperlink + 有文本样式 → Link > StyledText > text
//     有 hyperlink + 无文本样式 → Link > text
//     无 hyperlink + 有文本样式 → StyledText > text
//     都没有                    → 裸字符串
//
//   为什么要区分「有文本样式」：StyledText 最终会渲染成一个 Text 组件，
//   而 Text 会参与布局测量。对于无样式的纯文本，直接作为字符串子节点
//   交给父级 Text 展平，省掉一层节点。
//   **节点数在终端 UI 里直接等于布局成本** —— 没有浏览器那种
//   「几千个 div 也还行」的余量，yoga 是纯 CPU 的同步计算。
            return hasTextProps ? <Link key={i} url={hyperlink}><StyledText color={span.props.color} backgroundColor={span.props.backgroundColor} dim={span.props.dim} bold={span.props.bold} italic={span.props.italic} underline={span.props.underline} strikethrough={span.props.strikethrough} inverse={span.props.inverse}>{span.text}</StyledText></Link> : <Link key={i} url={hyperlink}>{span.text}</Link>;
          }
          return hasTextProps ? <StyledText key={i} color={span.props.color} backgroundColor={span.props.backgroundColor} dim={span.props.dim} bold={span.props.bold} italic={span.props.italic} underline={span.props.underline} strikethrough={span.props.strikethrough} inverse={span.props.inverse}>{span.text}</StyledText> : span.text;
        };
        $[7] = dimColor;
        $[8] = t3;
      } else {
        t3 = $[8];
      }
      t1 = spans.map(t3);
    }
    $[3] = children;
    $[4] = dimColor;
    $[5] = t1;
    $[6] = t2;
  } else {
    t1 = $[5];
    t2 = $[6];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  const content = t1;
  let t3;
  if ($[9] !== content || $[10] !== dimColor) {
    t3 = dimColor ? <Text dim={true}>{content}</Text> : <Text>{content}</Text>;
    $[9] = content;
    $[10] = dimColor;
    $[11] = t3;
  } else {
    t3 = $[11];
  }
  return t3;
});
// Span 是「一段同样式的文本」。
//   props 用可选布尔而不是必选 —— 因为「未设置」和「false」在这里
//   需要区分：未设置表示「沿用外层」，false 表示「明确关掉」。
//   不过实际上 propsEqual 用 `===` 比较，两者不等价，
//   所以这个区分在合并时是生效的。
type Span = {
  text: string;
  props: SpanProps;
};

/**
 * Parse an ANSI string into spans using the termio parser.
 */
// parseToSpans：把 ANSI 字符串喂给 termio 的 Parser，得到一串 action
//   （文本片段 / 超链接开关），再把它们转成 Span。
//
//   注意 Parser 是**每次新建**的（`new Parser()`），不是复用 ——
//   因为解析状态（当前样式、当前超链接）必须从零开始。
//   复用会带着上一次的样式进来。
function parseToSpans(input: string): Span[] {
  const parser = new Parser();
  const actions = parser.feed(input);
  const spans: Span[] = [];
  let currentHyperlink: string | undefined;
// link action 只更新 currentHyperlink 状态，不产生 Span。
//
//   这暴露了 termio 的 action 模型：它把「样式变化」**内联到 text action 里**
//   （每个 text action 自带当时的完整样式），但把「超链接变化」**单独发事件**。
//
//   为什么两者不一致？因为样式是「有状态的累加」（SGR 会改变当前状态，
//   影响后续所有文本），而超链接是「开关」（OSC 8 开始 / 结束）。
//   前者适合拍平进每个片段，后者适合当事件。
//   这个不对称在解析器设计里很常见：**累加状态拍平、二值状态发事件。**
  for (const action of actions) {
    if (action.type === 'link') {
      if (action.action.type === 'start') {
        currentHyperlink = action.action.url;
      } else {
        currentHyperlink = undefined;
      }
      continue;
    }
    if (action.type === 'text') {
      const text = action.graphemes.map(g => g.value).join('');
      if (!text) continue;
      const props = textStyleToSpanProps(action.style);
      if (currentHyperlink) {
        props.hyperlink = currentHyperlink;
      }

// 相邻同 props 的 span 合并。
//
//   这一步的必要性来自 termio 的输出粒度：它可能因为一个无意义的
//   转义序列（比如重复设置同一个颜色）把一个逻辑片段切成两段。
//   不合并的话，每段都会变成一个 Text 组件 —— 白白多出节点。
//
//   判据是 propsEqual（见 212 行），逐字段比，不比较对象引用。
//   注意这里有**字符串拼接**（lastSpan.text += text）——
//   复杂度是 O(n²) 的最坏情况，但实际每个 span 都很短，
//   而且合并后的片段数通常是个位数。
      // Try to merge with previous span if props match
      const lastSpan = spans[spans.length - 1];
      if (lastSpan && propsEqual(lastSpan.props, props)) {
        lastSpan.text += text;
      } else {
        spans.push({
          text,
          props
        });
      }
    }
  }
  return spans;
}

/**
 * Convert termio's TextStyle to SpanProps.
 */
// termio 的 TextStyle → SpanProps。
//
//   这一步是**语义降维**，两个方向都有信息丢失：
//   ① underline：termio 有 none / single / double / curly / dotted / dashed，
//      这里只保留「有没有」（见 163 行的判据）
//   ② color：termio 有 named / indexed / rgb / default 四态，
//      这里转成 Ink 的四种字符串写法（ansi:name / ansi256(n) / rgb(r,g,b) / undefined）
//
//   丢掉的 underline 样式是有意的：Ink 的 Text 只支持「有下划线」，
//   而终端对 curly/dotted 的支持极不一致。**接受的损失是样式丰富度，
//   换到的是跨终端一致。**
function textStyleToSpanProps(style: TextStyle): SpanProps {
  const props: SpanProps = {};
  if (style.bold) props.bold = true;
  if (style.dim) props.dim = true;
  if (style.italic) props.italic = true;
// `style.underline !== 'none'` 这个判据值得单独说。
//
//   直觉写法是 `style.underline === 'single'`，但那样会漏掉 double、
//   curly、dotted、dashed 四种 —— 它们都是「有下划线」，
//   只是样式不同。写成 `!== 'none'` 等于「除了明确没有，都算有」。
//
//   这就是「**判据要跟着默认值/枚举的语义走**」的又一个例子：
//   underline 的取值集合里只有一个值表示「没有」，所以判据写成
//   「不等于那一个」而不是「等于我想要的那一个」。
//   前者对未来新增的枚举值友好，后者会静默失效。
//
//   对照：同一个文件里 dim / bold / italic 都是布尔，直接 if 就行。
//   只有多值枚举才需要这种处理。
  if (style.underline !== 'none') props.underline = true;
  if (style.strikethrough) props.strikethrough = true;
  if (style.inverse) props.inverse = true;
  const fgColor = colorToString(style.fg);
  if (fgColor) props.color = fgColor;
  const bgColor = colorToString(style.bg);
  if (bgColor) props.backgroundColor = bgColor;
  return props;
}

// Map termio named colors to the ansi: format
// 16 个具名色的映射表。注意键名是 termio 的写法（brightRed），
//   值是 Ink 的写法（ansi:redBright）—— 两套命名约定之间的桥。
//
//   `ansi:` 前缀的意义见 styles.ts 的开头：它把「终端调色板索引」
//   与「真彩色十六进制」区分开。这 16 个颜色在不同主题下差异巨大，
//   而 #ff0000 是绝对值。混用会让主题适配失效。
const NAMED_COLOR_MAP: Record<NamedColor, string> = {
  black: 'ansi:black',
  red: 'ansi:red',
  green: 'ansi:green',
  yellow: 'ansi:yellow',
  blue: 'ansi:blue',
  magenta: 'ansi:magenta',
  cyan: 'ansi:cyan',
  white: 'ansi:white',
  brightBlack: 'ansi:blackBright',
  brightRed: 'ansi:redBright',
  brightGreen: 'ansi:greenBright',
  brightYellow: 'ansi:yellowBright',
  brightBlue: 'ansi:blueBright',
  brightMagenta: 'ansi:magentaBright',
  brightCyan: 'ansi:cyanBright',
  brightWhite: 'ansi:whiteBright'
};

/**
 * Convert termio's Color to the string format used by Ink.
 */
// 四态转字符串。`default` 返回 undefined 而不是某个具体颜色 ——
//   这是「默认色」的正确表达：不是「白色」，是「终端说了算」。
//
//   如果这里返回 'ansi:white'，那么在浅色主题下所有「默认色」文本
//   都会变成白字白底。这是一个很容易写错、但错得很明显的 bug。
function colorToString(color: TermioColor): Color | undefined {
  switch (color.type) {
    case 'named':
      return NAMED_COLOR_MAP[color.name] as Color;
    case 'indexed':
      return `ansi256(${color.index})` as Color;
    case 'rgb':
      return `rgb(${color.r},${color.g},${color.b})` as Color;
    case 'default':
      return undefined;
  }
}

/**
 * Check if two SpanProps are equal for merging.
 */
// 逐字段比较，九个字段。为什么不用 JSON.stringify 或者深比较库：
//   这个函数在合并循环里被调用，每个 span 一次。九个 `===` 比
//   序列化快两个数量级。
//
//   注意 `a.bold === b.bold` 对 undefined 和 false 是不等的 ——
//   所以「未设置」和「false」不会合并。这在一行里连续出现
//   「默认样式的字」和「显式关闭粗体的字」时会导致多一个 span，
//   但视觉上没区别。可接受的代价。
function propsEqual(a: SpanProps, b: SpanProps): boolean {
  return a.color === b.color && a.backgroundColor === b.backgroundColor && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough && a.inverse === b.inverse && a.hyperlink === b.hyperlink;
}
function hasAnyProps(props: SpanProps): boolean {
  return props.color !== undefined || props.backgroundColor !== undefined || props.dim === true || props.bold === true || props.italic === true || props.underline === true || props.strikethrough === true || props.inverse === true || props.hyperlink !== undefined;
}
function hasAnyTextProps(props: SpanProps): boolean {
  return props.color !== undefined || props.backgroundColor !== undefined || props.dim === true || props.bold === true || props.italic === true || props.underline === true || props.strikethrough === true || props.inverse === true;
}

// Text style props without weight (bold/dim) - these are handled separately
type BaseTextStyleProps = {
  color?: Color;
  backgroundColor?: Color;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
};

// Wrapper component that handles bold/dim mutual exclusivity for Text
// StyledText：处理 bold / dim 的**互斥**。
//
//   为什么需要这个包装：Text 组件的 bold 和 dim 在终端里是
//   两个独立的 SGR 码（1 和 2），但大多数终端渲染 dim 的方式是
//   「降低亮度」—— 如果同时发 bold（提高亮度）和 dim（降低亮度），
//   不同终端的合成结果不一致：有的按后者，有的按 aterm 的模糊处理。
//
//   这里的选择是「dim 优先」（见 257 行）：一旦 dim 为 true，
//   就完全不传 bold。牺牲的是「粗体 + 变暗」这个组合，
//   换到的是跨终端一致。
//
//   注意 colorize.ts 的 applyTextStyles **没有**这个互斥（两个都发）。
//   两处不一致，但走的是不同的输入源：这里还原外部 ANSI（可能同时
//   带 SGR 1 和 SGR 2），那里渲染结构化样式（bold 和 dim 同时为 true
//   是调用方明确要求的）。
function StyledText(t0) {
  const $ = _c(14);
  let bold;
  let children;
  let dim;
  let rest;
  if ($[0] !== t0) {
    ({
      bold,
      dim,
      children,
      ...rest
    } = t0);
    $[0] = t0;
    $[1] = bold;
    $[2] = children;
    $[3] = dim;
    $[4] = rest;
  } else {
    bold = $[1];
    children = $[2];
    dim = $[3];
    rest = $[4];
  }
// 三个分支，每个分支自己管缓存槽（$[5]-$[7] / $[8]-$[10] / $[11]-$[13]）。
//   编译器按「可能的返回值」分配槽位，而不是按代码行。
//   所以一个三分支组件会吃掉三倍的槽数 —— 这也解释了为什么
//   这个只有 20 行的组件要 _c(14)。
//
//   三个分支渲染三个**不同形状的 Text**，这是刻意的：
//   把 `bold={undefined}` 和 `bold={true}` 当成不同的 props 传递，
//   会让 Text 内部的 shallowEqual 判定为「变了」→ markDirty →
//   yoga 重算 → 整条链路重画。少传一个 prop 就是省一次布局。
  if (dim) {
    let t1;
    if ($[5] !== children || $[6] !== rest) {
      t1 = <Text {...rest} dim={true}>{children}</Text>;
      $[5] = children;
      $[6] = rest;
      $[7] = t1;
    } else {
      t1 = $[7];
    }
    return t1;
  }
  if (bold) {
    let t1;
    if ($[8] !== children || $[9] !== rest) {
      t1 = <Text {...rest} bold={true}>{children}</Text>;
      $[8] = children;
      $[9] = rest;
      $[10] = t1;
    } else {
      t1 = $[10];
    }
    return t1;
  }
  let t1;
  if ($[11] !== children || $[12] !== rest) {
    t1 = <Text {...rest}>{children}</Text>;
    $[11] = children;
    $[12] = rest;
    $[13] = t1;
  } else {
    t1 = $[13];
  }
  return t1;
}
// 原文件此处有一行 24672 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。