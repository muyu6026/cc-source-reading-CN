// ═══════════════════════════════════════════════════════════════
//  ShimmeredInput：输入框里那行「彩虹流光」是怎么画出来的
// ═══════════════════════════════════════════════════════════════
//
//  这里有一个终端 UI 的基本限制：**没有渐变**。每个字符格子只能有一个前景色，
//  无法让一个字符内部从红过渡到蓝。所谓「流光」，只能靠逐字符换色模拟。
//
//  于是这个文件分两段：
//
//    第一段（第 22-49 行）：把 text + highlights 切成「行 → 片段」，
//                          每个片段记住自己在原文里的绝对起点 start
//    第二段（第 105-138 行）：按 50ms 一帧，算出 glimmerIndex（流光的头部位置），
//                          再对带 shimmerColor 的片段**逐字符**渲染 ShimmerChar
//
//  只有 shimmer 片段才逐字符；普通片段整段一个 Text。所以开销和
//  「需要流光的字数」成正比，而不是和总字数成正比。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Ansi, Box, Text, useAnimationFrame } from '../../ink.js';
import { segmentTextByHighlights, type TextHighlight } from '../../utils/textHighlighting.js';
import { ShimmerChar } from '../Spinner/ShimmerChar.js';
type Props = {
  text: string;
  highlights: TextHighlight[];
};
// 【LinePart 的 start 是「绝对偏移」，这是整个文件的锚】
//
//  为什么不只存行内偏移：流光的位置是全局算出来的（一个 glimmerIndex 扫过
//  整段文本），要判断「这个字符此刻该多亮」，必须知道它在全文里的位置。
//
//  所以每个片段都要带上 start，逐字符时再用 start + charIndex 得到绝对下标。
//  这也是为什么下面第 29-31 行要在换行处把 pos 加 1 —— 换行符本身占一个位置，
//  不补上这个 1，之后所有片段的 start 都会偏小，流光会在每行开头错位。
type LinePart = {
  text: string;
  highlight: TextHighlight | undefined;
  start: number;
};
export function HighlightedInput(t0) {
  const $ = _c(23);
  const {
    text,
    highlights
  } = t0;
  let lines;
// 【切分逻辑：按 highlights 切开，再按换行切开，二维展开成一维的「行数组」】
//
//  segmentTextByHighlights(text, highlights) 返回的是「带样式的文本段」，
//  每段里可能包含多个换行。所以内层还要 split(换行) 一次。
//
//  遇到换行（第 29 行 i > 0）要做两件事：
//    1. lines.push([])    开新行
//    2. pos = pos + 1     把被吃掉的那个换行符算进偏移
//
//  空片段（part.length === 0）被跳过 —— 但注意它仍然占过位置吗？不占，
//  因为空串长度是 0。这带来一个边界情况：某一行如果是空的，
//  lines 里会留一个 [] 空数组，第 111 行专门处理了它（渲染一个空格）。
//
//  **空行必须占一行的高度**，否则多行输入的行数会和实际渲染不符。
  if ($[0] !== highlights || $[1] !== text) {
    const segments = segmentTextByHighlights(text, highlights);
    lines = [[]];
    let pos = 0;
    for (const segment of segments) {
      const parts = segment.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push([]);
          pos = pos + 1;
        }
        const part = parts[i];
        if (part.length > 0) {
          lines[lines.length - 1].push({
            text: part,
            highlight: segment.highlight,
            start: pos
          });
        }
        pos = pos + part.length;
      }
    }
    $[0] = highlights;
    $[1] = text;
    $[2] = lines;
  } else {
    lines = $[2];
  }
  let t1;
// 【hasShimmer 决定「要不要跑动画」，也是唯一的性能开关】
//
//  `.some(h => h.shimmerColor)`：只要有一个 highlight 带 shimmerColor，就要动画。
//
//  这个布尔值往下影响三件事：
//    · 第 61 行：要不要算流光窗口（不用就算了）
//    · 第 105 行：useAnimationFrame 传 50 还是 null
//    · 第 106 行：glimmerIndex 是真值还是 -100
//
//  其中最重要的是第二个：`useAnimationFrame(null)` 表示**不订阅任何帧**，
//  没有定时器、没有重渲染。所以「普通输入框」和「彩虹关键字」在性能上
//  是两个完全不同的东西，靠这一个布尔值分流。
  if ($[3] !== highlights) {
    t1 = highlights.some(_temp);
    $[3] = highlights;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const hasShimmer = t1;
  let sweepStart = 0;
  let cycleLength = 1;
// 【流光窗口前后各留 10 格，让光带从外面扫进来、扫出去】
//
//  lo/hi 是所有 shimmer 片段的起止边界。然后：
//
//      sweepStart   = lo - 10        光的起点在第一个关键字之前 10 格
//      cycleLength  = hi - lo + 20   整个周期比关键字跨度多 20 格
//
//  为什么需要这个富余：glimmerIndex 是「光的头部位置」，如果它从 lo 直接开始，
//  光会**突然出现在关键字左边**；如果到 hi 就停，光会**突然消失**。
//  留 10 格让亮度自然地从 0 涨起来、再落回去（亮度曲线在 ShimmerChar 里）。
//
//  这 20 格也就是「两段流光之间的空白期」—— 周期性动画必须有空白期，
//  否则看上去像常亮的渐变条，不像流光。
  if (hasShimmer) {
    let lo = Infinity;
    let hi = -Infinity;
    if ($[5] !== hi || $[6] !== highlights || $[7] !== lo) {
      for (const h_0 of highlights) {
        if (h_0.shimmerColor) {
          lo = Math.min(lo, h_0.start);
          hi = Math.max(hi, h_0.end);
        }
      }
      $[5] = hi;
      $[6] = highlights;
      $[7] = lo;
      $[8] = lo;
      $[9] = hi;
    } else {
      lo = $[8];
      hi = $[9];
    }
    sweepStart = lo - 10;
    cycleLength = hi - lo + 20;
  }
  let t2;
  if ($[10] !== cycleLength || $[11] !== hasShimmer || $[12] !== lines || $[13] !== sweepStart) {
    t2 = {
      lines,
      hasShimmer,
      sweepStart,
      cycleLength
    };
    $[10] = cycleLength;
    $[11] = hasShimmer;
    $[12] = lines;
    $[13] = sweepStart;
    $[14] = t2;
  } else {
    t2 = $[14];
  }
  const {
    lines: lines_0,
    hasShimmer: hasShimmer_0,
    sweepStart: sweepStart_0,
    cycleLength: cycleLength_0
  } = t2;
// 【useAnimationFrame(50) 返回 [ref, time]，ref 必须挂到 Box 上】
//
//  第一个返回值不是 ref 对象而是一个**回调 ref**（要挂到 Box 的 ref 上），
//  它把「当前这一帧」和组件订阅关联起来；第二个是累计时间（毫秒）。
//
//  hasShimmer 为假时传 null → 完全不订阅。这是 Ink 里做动画的标准形态：
//  **动画开销由「有没有东西要动」决定，而不是由组件是否存在决定。**
//
//  对比同目录 VoiceIndicator：它在 reducedMotion 时也传 null。
//  同一个模式出现两次，说明这是这套框架的既定做法。
  const [ref, time] = useAnimationFrame(hasShimmer_0 ? 50 : null);
// 【glimmerIndex = 起点 + (时间/50) 对周期取模；不用动画时钉在 -100】
//
//  三个细节：
//    1. Math.floor(time / 50) —— 帧号，而不是时间。这样「第几帧」和
//       「走过多少格」是同一个数（一帧一格），速度天然是 50ms/字符。
//    2. % cycleLength —— 取模做成循环。time 单调递增，靠取模回到起点。
//    3. 不用动画时给 -100 —— 一个足够小的数，让所有字符的亮度都为 0。
//       为什么不给 0：0 会落在第一个关键字附近，可能有字符被点亮。
//
//  **「关掉动画」要选一个语义上必然无效果的值**，而不是随便给个默认值。
  const glimmerIndex = hasShimmer_0 ? sweepStart_0 + Math.floor(time / 50) % cycleLength_0 : -100;
  let t3;
  if ($[15] !== glimmerIndex || $[16] !== lines_0) {
    let t4;
    if ($[18] !== glimmerIndex) {
// 【逐字符渲染，只对 shimmer 片段做】
//
//  条件 `part.highlight?.shimmerColor && part.highlight.color` —— 两个都要有：
//  shimmerColor 是「光最亮时的颜色」，color 是「底色」。缺任何一个都没法插值。
//
//  每个字符一个 ShimmerChar，各自接收 glimmerIndex。也就是说**亮度函数在
//  ShimmerChar 内部**，这里只负责告诉它「你离光的头部有多远」（通过 index）。
//
//  这个分工很重要：本组件不需要知道亮度曲线长什么样，也就不需要每秒重算
//  一条曲线。它每帧只算一个整数（glimmerIndex），其余全交给子组件。
//
//  代价是每帧要重建 N 个元素（N = 关键字字符数）。所以关键字通常很短
//  （ultrathink、ultraplan 这类单词），这个代价是可控的。
      t4 = (lineParts, lineIndex) => <Box key={lineIndex}>{lineParts.length === 0 ? <Text> </Text> : lineParts.map((part_0, partIndex) => {
          if (part_0.highlight?.shimmerColor && part_0.highlight.color) {
            return <Text key={partIndex}>{part_0.text.split("").map((char, charIndex) => <ShimmerChar key={charIndex} char={char} index={part_0.start + charIndex} glimmerIndex={glimmerIndex} messageColor={part_0.highlight.color} shimmerColor={part_0.highlight.shimmerColor} />)}</Text>;
          }
// 【普通片段为什么要套一层 <Ansi>】
//
//  segmentTextByHighlights 切出来的片段可能**本身包含 ANSI 转义序列**
//  （比如语法高亮后的文本、或者从别处带进来的彩色字符）。
//  直接塞进 <Text> 会被当成普通字符渲染出来（变成一堆 ESC[31m 文本）。
//
//  <Ansi> 的职责就是把字符串里的转义序列**解释**成样式，而不是转义显示。
//
//  注意它和外面 Text 的 color/dimColor/inverse 的关系：外层负责「整体基调」，
//  Ansi 负责「文本自带的局部样式」。两者叠加时，内层（自带的）通常赢。
//
//  `key={partIndex}` 用下标 —— 同样因为这一行是每次重新 map 出来的，
//  没有需要跨帧保留的状态。
          return <Text key={partIndex} color={part_0.highlight?.color} dimColor={part_0.highlight?.dimColor} inverse={part_0.highlight?.inverse}><Ansi>{part_0.text}</Ansi></Text>;
        })}</Box>;
      $[18] = glimmerIndex;
      $[19] = t4;
    } else {
      t4 = $[19];
    }
    t3 = lines_0.map(t4);
    $[15] = glimmerIndex;
    $[16] = lines_0;
    $[17] = t3;
  } else {
    t3 = $[17];
  }
  let t4;
  if ($[20] !== ref || $[21] !== t3) {
    t4 = <Box ref={ref} flexDirection="column">{t3}</Box>;
    $[20] = ref;
    $[21] = t3;
    $[22] = t4;
  } else {
    t4 = $[22];
  }
  return t4;
}
// 【_temp 又是被提升出来的无捕获闭包】
//
//  源码里是高阶写法 `highlights.some(h => h.shimmerColor)`，
//  编译后谓词被提到模块作用域叫 _temp，调用点变成 `highlights.some(_temp)`。
//
//  为什么提升有用：`h => h.shimmerColor` 每次渲染都是新函数，
//  而模块级的 _temp 永远相同。对于 .some 这种立即消费的调用其实无差别，
//  但编译器不区分场景，统一提升 —— 这让产物里到处是 _temp、_temp2…
//
//  读这类代码的技巧：**看到 _temp 就去文件末尾找它的定义**，
//  它一定是个纯粹的、不引用闭包的短函数。
function _temp(h) {
  return h.shimmerColor;
}
// 原文件此处有一行 12776 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。