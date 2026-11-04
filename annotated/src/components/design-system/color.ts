import { type ColorType, colorize } from '../../ink/colorize.js'
import type { Color } from '../../ink/styles.js'
import { getTheme, type Theme, type ThemeName } from '../../utils/theme.js'

/**
 * Curried theme-aware color function. Resolves theme keys to raw color
 * values before delegating to the ink renderer's colorize.
 */
// 柯里化：先定颜色、主题、前景或背景，返回文本到文本的函数，便于在 map 里复用一个着色器
export function color(
  c: keyof Theme | Color | undefined,
  theme: ThemeName,
  type: ColorType = 'foreground',
): (text: string) => string {
  return text => {
    if (!c) {
// 没有颜色就直接透传原文，避免把 undefined 交给下游 colorize
      return text
    }
    // Raw color values bypass theme lookup
    if (
// 四种原始色语法直接下发：rgb、井号、ansi256、ansi 前缀自带完整信息，再去查主题只会查出错值
      c.startsWith('rgb(') ||
      c.startsWith('#') ||
      c.startsWith('ansi256(') ||
      c.startsWith('ansi:')
    ) {
      return colorize(text, c, type)
    }
    // Theme key lookup
    return colorize(text, getTheme(theme)[c as keyof Theme], type)
// 其余一律当主题键查表：换主题后同一份调用代码自动换色，调用点不需要感知主题
  }
}
