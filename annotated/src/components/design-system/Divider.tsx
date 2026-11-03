import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Ansi, Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
// 分隔线组件的 props：宽度、主题色、字符、内边距与居中标题，标题可带 ANSI 色彩码
type DividerProps = {
  /**
   * Width of the divider in characters.
   * Defaults to terminal width.
   */
  width?: number;

  /**
   * Theme color for the divider.
   * If not provided, dimColor is used.
   */
  color?: keyof Theme;

  /**
   * Character to use for the divider line.
   * @default '─'
   */
  char?: string;

  /**
   * Padding to subtract from the width (e.g., for indentation).
   * @default 0
   */
  padding?: number;

  /**
   * Title shown in the middle of the divider.
   * May contain ANSI codes (e.g., chalk-styled text).
   *
   * @example
   * // ─────────── Title ───────────
   * <Divider title="Title" />
   */
  title?: string;
};

/**
 * A horizontal divider line.
 *
 * @example
 * // Full-width dimmed divider
 * <Divider />
 *
 * @example
 * // Colored divider
 * <Divider color="suggestion" />
 *
 * @example
 * // Fixed width
 * <Divider width={40} />
 *
 * @example
 * // Full width minus padding (for indented content)
 * <Divider padding={4} />
 *
 * @example
 * // With centered title
 * <Divider title="3 new messages" />
 */
// 分隔线组件：先按是否有标题走两条渲染分支，核心都是把指定字符 `repeat` 成目标宽度的字符串
export function Divider(t0) {
  const $ = _c(21);
  const {
    width,
    color,
    char: t1,
    padding: t2,
    title
  } = t0;
  const char = t1 === undefined ? "\u2500" : t1;
  const padding = t2 === undefined ? 0 : t2;
  const {
    columns: terminalWidth
  } = useTerminalSize();
  const effectiveWidth = Math.max(0, (width ?? terminalWidth) - padding);
// 有效宽度 = 显式宽度或终端宽度，再减去内边距；用 Math.max 兜底避免负数
  if (title) {
    const titleWidth = stringWidth(title) + 2;
// 标题占宽 = 字符串显示宽度 + 2（两侧各留一个空格），用 stringWidth 而非 length 以正确处理中文/emoji
    const sideWidth = Math.max(0, effectiveWidth - titleWidth);
    const leftWidth = Math.floor(sideWidth / 2);
// 左右两段长度相等地平分剩余宽度（向下取整），保证标题视觉居中
    const rightWidth = sideWidth - leftWidth;
    const t3 = !color;
    let t4;
    if ($[0] !== char || $[1] !== leftWidth) {
      t4 = char.repeat(leftWidth);
      $[0] = char;
      $[1] = leftWidth;
      $[2] = t4;
    } else {
      t4 = $[2];
    }
    let t5;
    if ($[3] !== title) {
      t5 = <Text dimColor={true}><Ansi>{title}</Ansi></Text>;
      $[3] = title;
      $[4] = t5;
    } else {
      t5 = $[4];
    }
    let t6;
    if ($[5] !== char || $[6] !== rightWidth) {
      t6 = char.repeat(rightWidth);
      $[5] = char;
      $[6] = rightWidth;
      $[7] = t6;
    } else {
      t6 = $[7];
    }
    let t7;
    if ($[8] !== color || $[9] !== t3 || $[10] !== t4 || $[11] !== t5 || $[12] !== t6) {
      t7 = <Text color={color} dimColor={t3}>{t4}{" "}{t5}{" "}{t6}</Text>;
// 有标题时把「左段 + 空格 + 标题 + 空格 + 右段」拼成一行，颜色与暗淡态按 color 决定
      $[8] = color;
      $[9] = t3;
      $[10] = t4;
      $[11] = t5;
      $[12] = t6;
      $[13] = t7;
    } else {
      t7 = $[13];
    }
    return t7;
  }
  const t3 = !color;
  let t4;
  if ($[14] !== char || $[15] !== effectiveWidth) {
    t4 = char.repeat(effectiveWidth);
// 无标题时直接把字符重复成整行宽度，仍是同一套颜色/暗淡逻辑
    $[14] = char;
    $[15] = effectiveWidth;
    $[16] = t4;
  } else {
    t4 = $[16];
  }
  let t5;
  if ($[17] !== color || $[18] !== t3 || $[19] !== t4) {
    t5 = <Text color={color} dimColor={t3}>{t4}</Text>;
    $[17] = color;
    $[18] = t3;
    $[19] = t4;
    $[20] = t5;
  } else {
    t5 = $[20];
  }
  return t5;
}
// 原文件此处有一行 7728 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。