import { c as _c } from "react/compiler-runtime";
// ThemedBox 是主题感知的 Box 包装组件：把 borderColor / backgroundColor 等可以传主题键（如 claude / permission）的属性，解析成真正的颜色值再交给底层 Box。
import React, { type PropsWithChildren, type Ref } from 'react';
import Box from '../../ink/components/Box.js';
import type { DOMElement } from '../../ink/dom.js';
import type { ClickEvent } from '../../ink/events/click-event.js';
import type { FocusEvent } from '../../ink/events/focus-event.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import type { Color, Styles } from '../../ink/styles.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import { useTheme } from './ThemeProvider.js';

// Color props that accept theme keys
type ThemedColorProps = {
  readonly borderColor?: keyof Theme | Color;
  readonly borderTopColor?: keyof Theme | Color;
  readonly borderBottomColor?: keyof Theme | Color;
  readonly borderLeftColor?: keyof Theme | Color;
  readonly borderRightColor?: keyof Theme | Color;
  readonly backgroundColor?: keyof Theme | Color;
};
// ThemedColorProps 列出哪些颜色属性接受主题键或原始 Color 两种写法。

// Base Styles without color props (they'll be overridden)
type BaseStylesWithoutColors = Omit<Styles, 'textWrap' | 'borderColor' | 'borderTopColor' | 'borderBottomColor' | 'borderLeftColor' | 'borderRightColor' | 'backgroundColor'>;
// BaseStylesWithoutColors 从底层 Styles 里剔除颜色相关属性，避免和主题解析后的颜色冲突。
export type Props = BaseStylesWithoutColors & ThemedColorProps & {
  ref?: Ref<DOMElement>;
  tabIndex?: number;
  autoFocus?: boolean;
  onClick?: (event: ClickEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onFocusCapture?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onBlurCapture?: (event: FocusEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};
// Props 在基础样式之上叠加主题色属性，并补充 ref / tabIndex / 各种事件回调。

/**
 * Resolves a color value that may be a theme key to a raw Color.
 */
// resolveColor 的注释说明：它把可能是主题键的颜色值解析成原始 Color。
function resolveColor(color: keyof Theme | Color | undefined, theme: Theme): Color | undefined {
  if (!color) return undefined;
  // Check if it's a raw color (starts with rgb(, #, ansi256(, or ansi:)
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi256(') || color.startsWith('ansi:')) {
    return color as Color;
  }
  // It's a theme key - resolve it
  return theme[color as keyof Theme] as Color;
}
// resolveColor 先判断空值；若以 rgb( / # / ansi256( / ansi: 开头就当作原始颜色直接返回，否则当作主题键去 theme 里查表。

/**
 * Theme-aware Box component that resolves theme color keys to raw colors.
 * This wraps the base Box component with theme resolution for border colors.
 */
// ThemedBox 的注释说明：这是一个把主题色键解析成原始颜色、再包一层基础 Box 的主题感知组件。
function ThemedBox(t0) {
  const $ = _c(33);
  let backgroundColor;
  let borderBottomColor;
  let borderColor;
  let borderLeftColor;
  let borderRightColor;
  let borderTopColor;
  let children;
  let ref;
  let rest;
  if ($[0] !== t0) {
    ({
      borderColor,
      borderTopColor,
      borderBottomColor,
      borderLeftColor,
      borderRightColor,
      backgroundColor,
      children,
      ref,
      ...rest
    } = t0);
    $[0] = t0;
    $[1] = backgroundColor;
    $[2] = borderBottomColor;
    $[3] = borderColor;
    $[4] = borderLeftColor;
    $[5] = borderRightColor;
    $[6] = borderTopColor;
    $[7] = children;
    $[8] = ref;
    $[9] = rest;
  } else {
    backgroundColor = $[1];
    borderBottomColor = $[2];
    borderColor = $[3];
    borderLeftColor = $[4];
    borderRightColor = $[5];
    borderTopColor = $[6];
    children = $[7];
    ref = $[8];
    rest = $[9];
  }
// 组件把 props 解构出各颜色字段与 children / ref / 其余属性 rest，并做依赖记忆化。
  const [themeName] = useTheme();
// useTheme 取当前主题名，用于后续查表。
  let resolvedBorderBottomColor;
  let resolvedBorderColor;
  let resolvedBorderLeftColor;
  let resolvedBorderRightColor;
  let resolvedBorderTopColor;
  let t1;
  if ($[10] !== backgroundColor || $[11] !== borderBottomColor || $[12] !== borderColor || $[13] !== borderLeftColor || $[14] !== borderRightColor || $[15] !== borderTopColor || $[16] !== themeName) {
    const theme = getTheme(themeName);
    resolvedBorderColor = resolveColor(borderColor, theme);
    resolvedBorderTopColor = resolveColor(borderTopColor, theme);
    resolvedBorderBottomColor = resolveColor(borderBottomColor, theme);
    resolvedBorderLeftColor = resolveColor(borderLeftColor, theme);
    resolvedBorderRightColor = resolveColor(borderRightColor, theme);
    t1 = resolveColor(backgroundColor, theme);
    $[10] = backgroundColor;
    $[11] = borderBottomColor;
    $[12] = borderColor;
    $[13] = borderLeftColor;
    $[14] = borderRightColor;
    $[15] = borderTopColor;
    $[16] = themeName;
    $[17] = resolvedBorderBottomColor;
    $[18] = resolvedBorderColor;
    $[19] = resolvedBorderLeftColor;
    $[20] = resolvedBorderRightColor;
    $[21] = resolvedBorderTopColor;
    $[22] = t1;
  } else {
    resolvedBorderBottomColor = $[17];
    resolvedBorderColor = $[18];
    resolvedBorderLeftColor = $[19];
    resolvedBorderRightColor = $[20];
    resolvedBorderTopColor = $[21];
    t1 = $[22];
  }
// 用 getTheme 拿到主题对象，把六个颜色字段（含背景）逐一经 resolveColor 解析；背景色单独存为 resolvedBackgroundColor。
  const resolvedBackgroundColor = t1;
// resolvedBackgroundColor 保存解析后的背景色。
  let t2;
  if ($[23] !== children || $[24] !== ref || $[25] !== resolvedBackgroundColor || $[26] !== resolvedBorderBottomColor || $[27] !== resolvedBorderColor || $[28] !== resolvedBorderLeftColor || $[29] !== resolvedBorderRightColor || $[30] !== resolvedBorderTopColor || $[31] !== rest) {
    t2 = <Box ref={ref} borderColor={resolvedBorderColor} borderTopColor={resolvedBorderTopColor} borderBottomColor={resolvedBorderBottomColor} borderLeftColor={resolvedBorderLeftColor} borderRightColor={resolvedBorderRightColor} backgroundColor={resolvedBackgroundColor} {...rest}>{children}</Box>;
    $[23] = children;
    $[24] = ref;
    $[25] = resolvedBackgroundColor;
    $[26] = resolvedBorderBottomColor;
    $[27] = resolvedBorderColor;
    $[28] = resolvedBorderLeftColor;
    $[29] = resolvedBorderRightColor;
    $[30] = resolvedBorderTopColor;
    $[31] = rest;
    $[32] = t2;
  } else {
    t2 = $[32];
  }
// t2 把解析后的颜色全部交给底层 Box，并透传 ref / rest / children。
  return t2;
// 组件返回渲染好的主题感知 Box。
}
export default ThemedBox;
// ThemedBox 作为默认导出供其他组件引用。
// 原文件此处有一行 12336 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。