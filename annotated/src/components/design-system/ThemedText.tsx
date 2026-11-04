// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import type { ReactNode } from 'react';
import React, { useContext } from 'react';
// 直接从 `../../ink/components/Text.js` 引入底层 `Text`，本组件是它的「主题感知」包装层。
import Text from '../../ink/components/Text.js';
import type { Color, Styles } from '../../ink/styles.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import { useTheme } from './ThemeProvider.js';

// 块注释说明 `TextHoverColorContext`：给子树里未显式指定颜色的 ThemedText 统一上色，优先级为「显式 color > hover > dimColor」，且能跨 Box 边界生效（Ink 原生样式级联做不到）。
/** Colors uncolored ThemedText in the subtree. Precedence: explicit `color` >
 *  this > dimColor. Crosses Box boundaries (Ink's style cascade doesn't). */
// `TextHoverColorContext` 是一个 React Context，用于悬停时统一给未着色文字染色。
export const TextHoverColorContext = React.createContext<keyof Theme | undefined>(undefined);
// Props 提供完整的文字样式开关：color、backgroundColor、dimColor、bold、italic、underline、strikethrough、inverse、wrap，全部为只读可选。
export type Props = {
  /**
   * Change text color. Accepts a theme key or raw color value.
   */
  readonly color?: keyof Theme | Color;

  /**
   * Same as `color`, but for background. Must be a theme key.
   */
  readonly backgroundColor?: keyof Theme;

  /**
   * Dim the color using the theme's inactive color.
   * This is compatible with bold (unlike ANSI dim).
   */
  readonly dimColor?: boolean;

  /**
   * Make the text bold.
   */
  readonly bold?: boolean;

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
 * Resolves a color value that may be a theme key to a raw Color.
 */
// `resolveColor` 把可能是「主题键」的颜色解析成原始 `Color`：若以 `rgb(`、`#`、`ansi256(`、`ansi:` 开头则视为原始值直接返回，否则按主题键查表。
function resolveColor(color: keyof Theme | Color | undefined, theme: Theme): Color | undefined {
  if (!color) return undefined;
  // Check if it's a raw color (starts with rgb(, #, ansi256(, or ansi:)
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi256(') || color.startsWith('ansi:')) {
    return color as Color;
  }
  // It's a theme key - resolve it
  return theme[color as keyof Theme] as Color;
}

/**
 * Theme-aware Text component that resolves theme color keys to raw colors.
 * This wraps the base Text component with theme resolution.
 */
// ThemedText 是主题感知的文字组件，把主题键解析成实际颜色后转发给底层 `Text`。
export default function ThemedText(t0) {
// `_c(10)` 申请 10 个记忆槽位。
  const $ = _c(10);
  const {
    color,
    backgroundColor,
    dimColor: t1,
    bold: t2,
    italic: t3,
    underline: t4,
    strikethrough: t5,
    inverse: t6,
    wrap: t7,
    children
  } = t0;
// 一组带缺省值的布尔样式：未传时 dimColor/bold/italic/underline/strikethrough/inverse 均为 false，wrap 缺省为 `wrap`（自动折行）。
  const dimColor = t1 === undefined ? false : t1;
  const bold = t2 === undefined ? false : t2;
  const italic = t3 === undefined ? false : t3;
  const underline = t4 === undefined ? false : t4;
  const strikethrough = t5 === undefined ? false : t5;
  const inverse = t6 === undefined ? false : t6;
  const wrap = t7 === undefined ? "wrap" : t7;
// 从 `useTheme` 取主题名再 `getTheme` 得到主题对象，并读取悬停色 `hoverColor`。
  const [themeName] = useTheme();
  const theme = getTheme(themeName);
  const hoverColor = useContext(TextHoverColorContext);
// `resolvedColor` 的优先级：未指定 color 且有 hover 色则用 hover 色；否则 dimColor 时用主题的 inactive 色；否则解析显式 color。
  const resolvedColor = !color && hoverColor ? resolveColor(hoverColor, theme) : dimColor ? theme.inactive as Color : resolveColor(color, theme);
  const resolvedBackgroundColor = backgroundColor ? theme[backgroundColor] as Color : undefined;
  let t8;
// 记忆底层 `Text` 元素：把所有解析后的样式与子内容一次性传给 `Text`，得到最终渲染 `t8`。
  if ($[0] !== bold || $[1] !== children || $[2] !== inverse || $[3] !== italic || $[4] !== resolvedBackgroundColor || $[5] !== resolvedColor || $[6] !== strikethrough || $[7] !== underline || $[8] !== wrap) {
    t8 = <Text color={resolvedColor} backgroundColor={resolvedBackgroundColor} bold={bold} italic={italic} underline={underline} strikethrough={strikethrough} inverse={inverse} wrap={wrap}>{children}</Text>;
    $[0] = bold;
    $[1] = children;
    $[2] = inverse;
    $[3] = italic;
    $[4] = resolvedBackgroundColor;
    $[5] = resolvedColor;
    $[6] = strikethrough;
    $[7] = underline;
    $[8] = wrap;
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  return t8;
}
// 原文件此处有一行 9772 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。