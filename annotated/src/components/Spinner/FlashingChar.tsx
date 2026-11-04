import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Text, useTheme } from '../../ink.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import { interpolateColor, parseRGB, toRGBColor } from './utils.js';
type Props = {
  char: string;
  flashOpacity: number;
  messageColor: keyof Theme;
  shimmerColor: keyof Theme;
};
// 闪烁字符：按透明度在「消息色」与「流光色」之间插值，渲染单个字符。
export function FlashingChar(t0) {
  const $ = _c(9);
  const {
    char,
    flashOpacity,
    messageColor,
    shimmerColor
  } = t0;
  const [themeName] = useTheme();
  let t1;
  if ($[0] !== char || $[1] !== flashOpacity || $[2] !== messageColor || $[3] !== shimmerColor || $[4] !== themeName) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const theme = getTheme(themeName);
      const baseColorStr = theme[messageColor];
      const shimmerColorStr = theme[shimmerColor];
      const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
      const shimmerRGB = shimmerColorStr ? parseRGB(shimmerColorStr) : null;
      if (baseRGB && shimmerRGB) {
        const interpolated = interpolateColor(baseRGB, shimmerRGB, flashOpacity);
        t1 = <Text color={toRGBColor(interpolated)}>{char}</Text>;
        break bb0;
      }
    }
    $[0] = char;
    $[1] = flashOpacity;
    $[2] = messageColor;
    $[3] = shimmerColor;
    $[4] = themeName;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  const shouldUseShimmer = flashOpacity > 0.5;
// 透明度大于 0.5 时改用流光色，否则沿用消息色（含 ANSI 主题回退）。
  const t2 = shouldUseShimmer ? shimmerColor : messageColor;
  let t3;
  if ($[6] !== char || $[7] !== t2) {
    t3 = <Text color={t2}>{char}</Text>;
    $[6] = char;
    $[7] = t2;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}
// 组件用 React 编译器记忆缓存，仅当相关 prop 或主题变化时重建。
// 原文件此处有一行 4544 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。