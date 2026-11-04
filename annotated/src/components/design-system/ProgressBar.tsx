import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
// ProgressBar 的 props：ratio 规定在 0 到 1，width 是字符宽，fillColor 与 emptyColor 可选
type Props = {
  /**
   * How much progress to display, between 0 and 1 inclusive
   */
  ratio: number; // [0, 1]

  /**
   * How many characters wide to draw the progress bar
   */
  width: number; // how many characters wide

  /**
   * Optional color for the filled portion of the bar
   */
  fillColor?: keyof Theme;

  /**
   * Optional color for the empty portion of the bar
   */
  emptyColor?: keyof Theme;
};
// BLOCKS 是九级部分块字符（空格到全块）：用八分之一块的粒度画出亚字符精度
const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
export function ProgressBar(t0) {
  const $ = _c(13);
  const {
    ratio: inputRatio,
    width,
    fillColor,
    emptyColor
  } = t0;
  const ratio = Math.min(1, Math.max(0, inputRatio));
// ratio 先夹紧到 0 到 1：外部传入越界值也不会画出负宽或超宽
  const whole = Math.floor(ratio * width);
// whole 是整块个数：ratio 乘 width 向下取整
  let t1;
  if ($[0] !== whole) {
    t1 = BLOCKS[BLOCKS.length - 1].repeat(whole);
// 满块段用最后一级字符（全块）重复 whole 次
    $[0] = whole;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let segments;
  if ($[2] !== ratio || $[3] !== t1 || $[4] !== whole || $[5] !== width) {
    segments = [t1];
    if (whole < width) {
// 未满一格时补一个部分块：remainder 乘 BLOCKS 长度取整，决定画 ▏▎▍▌▋▊▉ 里的哪一个
      const remainder = ratio * width - whole;
      const middle = Math.floor(remainder * BLOCKS.length);
      segments.push(BLOCKS[middle]);
      const empty = width - whole - 1;
// empty 等于 width 减 whole 再减 1：那个部分块已经占掉一格
      if (empty > 0) {
        let t2;
        if ($[7] !== empty) {
          t2 = BLOCKS[0].repeat(empty);
          $[7] = empty;
          $[8] = t2;
        } else {
          t2 = $[8];
        }
        segments.push(t2);
      }
    }
    $[2] = ratio;
    $[3] = t1;
    $[4] = whole;
    $[5] = width;
    $[6] = segments;
  } else {
    segments = $[6];
  }
  const t2 = segments.join("");
  let t3;
  if ($[9] !== emptyColor || $[10] !== fillColor || $[11] !== t2) {
    t3 = <Text color={fillColor} backgroundColor={emptyColor}>{t2}</Text>;
// 空段用 backgroundColor 加空格实现，而不是画浅色字符——背景色块不受字体字符宽度影响，对齐更稳
    $[9] = emptyColor;
    $[10] = fillColor;
    $[11] = t2;
    $[12] = t3;
  } else {
    t3 = $[12];
  }
  return t3;
}
// 原文件此处有一行 5128 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。