import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text, useTheme } from '../../ink.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import { getDefaultCharacters, interpolateColor, parseRGB, toRGBColor } from './utils.js';
// DEFAULT_CHARACTERS 在模块加载时求值一次：字符表取决于 TERM 与平台，运行期不会变
const DEFAULT_CHARACTERS = getDefaultCharacters();
const SPINNER_FRAMES = [...DEFAULT_CHARACTERS, ...[...DEFAULT_CHARACTERS].reverse()];
// SPINNER_FRAMES 是正向加反向拼接：六帧正放再六帧倒放，视觉上是来回摆动而不是循环跳回
const REDUCED_MOTION_DOT = '●';
// reducedMotion 模式只用一个实心点，不用字符动画
const REDUCED_MOTION_CYCLE_MS = 2000; // 2-second cycle: 1s visible, 1s dim
// 两秒一周期：一秒亮一秒暗，取 time 的一半判奇偶即得明暗
const ERROR_RED = {
// ERROR_RED 是固定深红 RGB（171 43 63）：卡顿渐变的终点色，不取主题色以免主题切换时终点漂移
  r: 171,
  g: 43,
  b: 63
};
type Props = {
  frame: number;
  messageColor: keyof Theme;
  stalledIntensity?: number;
  reducedMotion?: boolean;
  time?: number;
};
// SpinnerGlyph：单帧 spinner 字符的渲染，三条分支——减动效、卡顿渐变、常规
export function SpinnerGlyph(t0) {
  const $ = _c(9);
  const {
    frame,
    messageColor,
    stalledIntensity: t1,
    reducedMotion: t2,
    time: t3
  } = t0;
  const stalledIntensity = t1 === undefined ? 0 : t1;
  const reducedMotion = t2 === undefined ? false : t2;
  const time = t3 === undefined ? 0 : t3;
  const [themeName] = useTheme();
  const theme = getTheme(themeName);
  if (reducedMotion) {
    const isDim = Math.floor(time / (REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1;
// isDim 由时间算出：每半周期翻转一次，纯函数不存 state
    let t4;
    if ($[0] !== isDim || $[1] !== messageColor) {
      t4 = <Box flexWrap="wrap" height={1} width={2}><Text color={messageColor} dimColor={isDim}>{REDUCED_MOTION_DOT}</Text></Box>;
      $[0] = isDim;
      $[1] = messageColor;
      $[2] = t4;
    } else {
      t4 = $[2];
    }
    return t4;
  }
  const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
// 取模取帧：frame 可无限增长，索引永远落在字符表内
  if (stalledIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    if (baseRGB) {
      const interpolated = interpolateColor(baseRGB, ERROR_RED, stalledIntensity);
// 卡顿渐变：把消息色与 ERROR_RED 按 intensity 插值——前提是主题色能解析成 RGB
      return <Box flexWrap="wrap" height={1} width={2}><Text color={toRGBColor(interpolated)}>{spinnerChar}</Text></Box>;
    }
    const color = stalledIntensity > 0.5 ? "error" : messageColor;
// 解析不出 RGB 时的降级：强度过半直接切 error 语义色，否则保持原色——两档而非连续渐变
    let t4;
    if ($[3] !== color || $[4] !== spinnerChar) {
      t4 = <Box flexWrap="wrap" height={1} width={2}><Text color={color}>{spinnerChar}</Text></Box>;
      $[3] = color;
      $[4] = spinnerChar;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    return t4;
  }
  let t4;
  if ($[6] !== messageColor || $[7] !== spinnerChar) {
    t4 = <Box flexWrap="wrap" height={1} width={2}><Text color={messageColor}>{spinnerChar}</Text></Box>;
// 常规分支：字符直接用 messageColor，不加 dim
    $[6] = messageColor;
    $[7] = spinnerChar;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  return t4;
}
// 原文件此处有一行 7700 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。