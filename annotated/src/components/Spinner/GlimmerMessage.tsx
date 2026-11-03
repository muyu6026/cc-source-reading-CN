// 旋转指示器（spinner）里那句会「流动发光」的文案。整份文件只做一件事：把一条消息按**字素簇**切成 before / shimmer / after 三段，中间那段换成高亮色再拼回去。看着像纯装饰，但里面每一处都在处理终端特有的坑：宽字符、非 BMP 字符、颜色模块缺失、以及「为什么末尾要多渲染一个空格」。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { stringWidth } from '../../ink/stringWidth.js';
import { Text, useTheme } from '../../ink.js';
import { getGraphemeSegmenter } from '../../utils/intl.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import type { SpinnerMode } from './types.js';
import { interpolateColor, parseRGB, toRGBColor } from './utils.js';
// Props 里 `messageColor` 与 `shimmerColor` 的类型都是 `keyof Theme` 而不是字符串——这样主题里改名会编译报错。`glimmerIndex` 是「发光点当前在第几列」，由外层动画每帧推进；组件本身无状态，也就没有动画定时器。
type Props = {
  message: string;
  mode: SpinnerMode;
  messageColor: keyof Theme;
  glimmerIndex: number;
  flashOpacity: number;
  shimmerColor: keyof Theme;
  stalledIntensity?: number;
};
// ERROR_RED 是一个写死的 RGB 三元组，不是主题色。用途是「卡住」状态：把消息色朝这个红插值（interpolateColor），插值系数由外层给的 stalledIntensity 控制。写死不进主题，是因为它要作为一个**基准色**参与插值，主题里改它会连带改变插值数学。
const ERROR_RED = {
  r: 171,
  g: 43,
  b: 63
};
export function GlimmerMessage(t0) {
  const $ = _c(75);
  const {
    message,
    mode,
    messageColor,
    glimmerIndex,
    flashOpacity,
    shimmerColor,
    stalledIntensity: t1
  } = t0;
  const stalledIntensity = t1 === undefined ? 0 : t1;
  const [themeName] = useTheme();
  let messageWidth;
  let segments;
  let t2;
  if ($[0] !== flashOpacity || $[1] !== message || $[2] !== messageColor || $[3] !== mode || $[4] !== shimmerColor || $[5] !== stalledIntensity || $[6] !== themeName) {
// `Symbol.for(「react.early_return_sentinel」)` 是编译器为「函数体里有提前 return」准备的值：整个 bb0 块可能提前返回（空消息、卡住态、tool-use 态），所以结果先写进 t2，块外再判断「是不是哨兵」决定要不要直接返回。读法：t2 有值且不是哨兵 → 直接 return t2。
    t2 = Symbol.for("react.early_return_sentinel");
// `bb0: {` 是带标签的裸块，`break bb0` 相当于跳到块尾。编译器用这个模式把源码里四个 `return` 收敛成一个出口，好让缓存写入只出现在一处。它不是业务语法，不要当成「命名块分组」。
    bb0: {
      const theme = getTheme(themeName);
      let segs;
      if ($[10] !== message) {
        segs = [];
// 按**字素簇**（grapheme cluster）切分而不是按 char / code unit：emoji（尤其带 ZWJ 的组合 emoji）、组合音标都必须在一次切分里完整取出，否则会被切成两半、渲染成两个豆腐块。同时每个簇单独算 `stringWidth`，因为终端里一个字符可能占 2 列。
        for (const {
          segment
        } of getGraphemeSegmenter().segment(message)) {
          segs.push({
            segment,
            width: stringWidth(segment)
          });
        }
        $[10] = message;
        $[11] = segs;
      } else {
        segs = $[11];
      }
      let t3;
      if ($[12] !== message) {
// 整条消息的总显示宽度单独算一次（`stringWidth(message)`），**不是把各段宽度相加**。原因是 stringWidth 对整串可能有额外处理（例如变体选择符、行内 ANSI），相加不一定等于整体。这里以整体为准，各段宽度只用来定位切点。
        t3 = stringWidth(message);
        $[12] = message;
        $[13] = t3;
      } else {
        t3 = $[13];
      }
      let t4;
      if ($[14] !== segs || $[15] !== t3) {
        t4 = {
          segments: segs,
          messageWidth: t3
        };
        $[14] = segs;
        $[15] = t3;
        $[16] = t4;
      } else {
        t4 = $[16];
      }
      ({
        segments,
        messageWidth
      } = t4);
// 空消息直接返回 null（早退）。看起来是防御，实际是必要：上层在等待阶段会先渲染 `''`，若这里继续往下走就会算出 shimmerStart = -1、shimmerEnd = 1，然后渲染出一个纯空格的 Text——终端里表现为那一行莫名多出一个空格、把后面的内容推了一格。
      if (!message) {
        t2 = null;
        break bb0;
      }
// 卡住态优先于 tool-use 态：只要 stalledIntensity > 0 就不再做流动效果，整条消息朝红色插值。这是一个「状态覆盖动画」的取舍——卡住时用户最需要的是「它没死但很慢」，让颜色呼吸反而误导。
      if (stalledIntensity > 0) {
        const baseColorStr = theme[messageColor];
        const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
        if (baseRGB) {
// 插值需要基准色是 RGB。`parseRGB(theme[messageColor])` 失败（主题里该色是 ANSI 索引色如 `red`，没有 RGB 表示）时返回 null，往下走降级分支。这就是为什么要先判断 `baseRGB` 再插值。
          const interpolated = interpolateColor(baseRGB, ERROR_RED, stalledIntensity);
          const color = toRGBColor(interpolated);
          let t5;
          if ($[17] !== color) {
            t5 = <Text color={color}> </Text>;
            $[17] = color;
            $[18] = t5;
          } else {
            t5 = $[18];
          }
          t2 = <><Text color={color}>{message}</Text>{t5}</>;
          break bb0;
        }
// 降级分支：拿不到 RGB 就只能在两档里硬切——stalledIntensity 过半用 `error`，否则用原色。阈值 0.5 是**二值量化**的简化，视觉上会看到颜色「跳变」而不是渐变，这是无色值可用时唯一能做的。
        const color_0 = stalledIntensity > 0.5 ? "error" : messageColor;
        let t5;
        if ($[19] !== color_0 || $[20] !== message) {
          t5 = <Text color={color_0}>{message}</Text>;
          $[19] = color_0;
          $[20] = message;
          $[21] = t5;
        } else {
          t5 = $[21];
        }
        let t6;
        if ($[22] !== color_0) {
          t6 = <Text color={color_0}> </Text>;
          $[22] = color_0;
          $[23] = t6;
        } else {
          t6 = $[23];
        }
        let t7;
        if ($[24] !== t5 || $[25] !== t6) {
          t7 = <>{t5}{t6}</>;
          $[24] = t5;
          $[25] = t6;
          $[26] = t7;
        } else {
          t7 = $[26];
        }
        t2 = t7;
        break bb0;
      }
// tool-use 模式：消息色朝 shimmerColor 插值，插值系数是 flashOpacity（外层给的闪烁透明度）。与卡住态不同，这里插的是**流动闪光的亮度**，所以插值对象是 shimmer 而不是错误色。两个分支结构几乎一样但基准色与系数不同，编译器没有合并它们。
      if (mode === "tool-use") {
        const baseColorStr_0 = theme[messageColor];
        const shimmerColorStr = theme[shimmerColor];
        const baseRGB_0 = baseColorStr_0 ? parseRGB(baseColorStr_0) : null;
        const shimmerRGB = shimmerColorStr ? parseRGB(shimmerColorStr) : null;
        if (baseRGB_0 && shimmerRGB) {
          const interpolated_0 = interpolateColor(baseRGB_0, shimmerRGB, flashOpacity);
          const t5 = <Text color={toRGBColor(interpolated_0)}>{message}</Text>;
          let t6;
          if ($[27] !== messageColor) {
            t6 = <Text color={messageColor}> </Text>;
            $[27] = messageColor;
            $[28] = t6;
          } else {
            t6 = $[28];
          }
          let t7;
          if ($[29] !== t5 || $[30] !== t6) {
            t7 = <>{t5}{t6}</>;
            $[29] = t5;
            $[30] = t6;
            $[31] = t7;
          } else {
            t7 = $[31];
          }
          t2 = t7;
          break bb0;
        }
// 同样有无 RGB 的降级：flashOpacity 过半用 shimmerColor 否则原色。注意这里判断条件用的还是 `flashOpacity > 0.5`，与卡住态的 `stalledIntensity > 0.5` 是两个独立阈值——它们的含义不同（一个是闪烁相位，一个是卡住程度）。
        const color_1 = flashOpacity > 0.5 ? shimmerColor : messageColor;
        let t5;
        if ($[32] !== color_1 || $[33] !== message) {
          t5 = <Text color={color_1}>{message}</Text>;
          $[32] = color_1;
          $[33] = message;
          $[34] = t5;
        } else {
          t5 = $[34];
        }
        let t6;
        if ($[35] !== messageColor) {
          t6 = <Text color={messageColor}> </Text>;
          $[35] = messageColor;
          $[36] = t6;
        } else {
          t6 = $[36];
        }
        let t7;
        if ($[37] !== t5 || $[38] !== t6) {
          t7 = <>{t5}{t6}</>;
          $[37] = t5;
          $[38] = t6;
          $[39] = t7;
        } else {
          t7 = $[39];
        }
        t2 = t7;
        break bb0;
      }
    }
    $[0] = flashOpacity;
    $[1] = message;
    $[2] = messageColor;
    $[3] = mode;
    $[4] = shimmerColor;
    $[5] = stalledIntensity;
    $[6] = themeName;
    $[7] = messageWidth;
    $[8] = segments;
    $[9] = t2;
  } else {
    messageWidth = $[7];
    segments = $[8];
    t2 = $[9];
  }
// 哨兵判断在块外。走到这里说明上面三个早退分支都没命中，要继续做流动效果。注意此时 messageWidth 与 segments 是从缓存槽读回来的（203-207 行），不是重新算的。
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
// 发光窗口是 `[glimmerIndex - 1, glimmerIndex + 1]`，也就是**三列宽**：一列前导、一列高亮、一列拖尾。用半开区间加 1/-1 而不是宽度 3 的矩形，是为了让高亮看起来像「有方向的扫过」而不是「一个方块在跳」。
  const shimmerStart = glimmerIndex - 1;
  const shimmerEnd = glimmerIndex + 1;
// 窗口完全在消息之外（起点超过总宽，或终点还在 0 之前）时返回纯色版本。这个判断保证了循环动画在两端不会「半截悬空」——否则 glimmerIndex 绕回 0 时会看到右边缘突然亮一下。
  if (shimmerStart >= messageWidth || shimmerEnd < 0) {
    let t3;
    if ($[40] !== message || $[41] !== messageColor) {
      t3 = <Text color={messageColor}>{message}</Text>;
      $[40] = message;
      $[41] = messageColor;
      $[42] = t3;
    } else {
      t3 = $[42];
    }
    let t4;
    if ($[43] !== messageColor) {
      t4 = <Text color={messageColor}> </Text>;
      $[43] = messageColor;
      $[44] = t4;
    } else {
      t4 = $[44];
    }
    let t5;
    if ($[45] !== t3 || $[46] !== t4) {
      t5 = <>{t3}{t4}</>;
      $[45] = t3;
      $[46] = t4;
      $[47] = t5;
    } else {
      t5 = $[47];
    }
    return t5;
  }
// `clampedStart = Math.max(0, shimmerStart)` 只钳左端不钳右端：右端越界由分段的 `colPos > shimmerEnd` 条件自然处理（剩下的都进 after，after 为空就不渲染）。两处各管一半，是有意为之而不是漏钳。
  const clampedStart = Math.max(0, shimmerStart);
  let colPos = 0;
  let before = "";
  let shim = "";
  let after = "";
  if ($[48] !== after || $[49] !== before || $[50] !== clampedStart || $[51] !== colPos || $[52] !== segments || $[53] !== shim || $[54] !== shimmerEnd) {
// 分段循环只有三条分支：整个段落在起点之前 → before；段起点已越过终点 → after；其余 → shimmer。判断用的是**段的起始列**而不是「与窗口相交」，这是简化：跨窗口边界的段会整段被划进 shimmer，视觉上就是高亮多覆盖一个宽字符——比把一个宽字符劈成两半安全得多。
    for (const {
      segment: segment_0,
      width
    } of segments) {
      if (colPos + width <= clampedStart) {
        before = before + segment_0;
      } else {
// `colPos > shimmerEnd` 用严格大于而不是大于等于：终点那一列仍算高亮（闭区间语义）。这样三列窗口实际覆盖 `glimmerIndex-1 / glimmerIndex / glimmerIndex+1`，与上面 shimmerEnd 的定义对齐。
        if (colPos > shimmerEnd) {
          after = after + segment_0;
        } else {
          shim = shim + segment_0;
        }
      }
      colPos = colPos + width;
    }
    $[48] = after;
    $[49] = before;
    $[50] = clampedStart;
    $[51] = colPos;
    $[52] = segments;
    $[53] = shim;
    $[54] = shimmerEnd;
    $[55] = before;
    $[56] = after;
    $[57] = shim;
    $[58] = colPos;
  } else {
    before = $[55];
    after = $[56];
    shim = $[57];
    colPos = $[58];
  }
  let t3;
  if ($[59] !== before || $[60] !== messageColor) {
    t3 = before && <Text color={messageColor}>{before}</Text>;
    $[59] = before;
    $[60] = messageColor;
    $[61] = t3;
  } else {
    t3 = $[61];
  }
  let t4;
  if ($[62] !== shim || $[63] !== shimmerColor) {
    t4 = <Text color={shimmerColor}>{shim}</Text>;
    $[62] = shim;
    $[63] = shimmerColor;
    $[64] = t4;
  } else {
    t4 = $[64];
  }
  let t5;
  if ($[65] !== after || $[66] !== messageColor) {
    t5 = after && <Text color={messageColor}>{after}</Text>;
    $[65] = after;
    $[66] = messageColor;
    $[67] = t5;
  } else {
    t5 = $[67];
  }
  let t6;
  if ($[68] !== messageColor) {
// 每个分支末尾都渲染一个 `<Text color={messageColor}> </Text>`（一个空格）。这个尾随空格不是为了好看：终端里 Text 节点末尾的空白可能被 Ink 裁掉，若消息最后一列正好是高亮色，裁掉后颜色块会紧贴边框。固定补一个原色空格，等于给渲染结果一个确定的右边界。
    t6 = <Text color={messageColor}> </Text>;
    $[68] = messageColor;
    $[69] = t6;
  } else {
    t6 = $[69];
  }
  let t7;
  if ($[70] !== t3 || $[71] !== t4 || $[72] !== t5 || $[73] !== t6) {
    t7 = <>{t3}{t4}{t5}{t6}</>;
    $[70] = t3;
    $[71] = t4;
    $[72] = t5;
    $[73] = t6;
    $[74] = t7;
  } else {
    t7 = $[74];
  }
  return t7;
}
// 原文件此处有一行 18536 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。