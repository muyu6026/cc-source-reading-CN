// 文件级批注：`ink.ts` 把颜色字符串转成 Ink 的 `TextProps` 颜色格式，让智能体配色跟随当前主题，未知色回退到原始 ANSI 色。
import type { TextProps } from '../ink.js'
import {
  AGENT_COLOR_TO_THEME_COLOR,
  type AgentColorName,
} from '../tools/AgentTool/agentColorManager.js'

const DEFAULT_AGENT_THEME_COLOR = 'cyan_FOR_SUBAGENTS_ONLY'

/**
 * Convert a color string to Ink's TextProps['color'] format.
 * Colors are typically AgentColorName values like 'blue', 'green', etc.
 * This converts them to theme keys so they respect the current theme.
 * Falls back to the raw ANSI color if the color is not a known agent color.
 */
// 函数签名：接收颜色名（多为智能体色名），先判空再用主题映射表转换。
export function toInkColor(color: string | undefined): TextProps['color'] {
  if (!color) {
    return DEFAULT_AGENT_THEME_COLOR
  }
  // Try to map to a theme color if it's a known agent color
  const themeColor = AGENT_COLOR_TO_THEME_COLOR[color as AgentColorName]
  if (themeColor) {
    return themeColor
  }
  // Fall back to raw ANSI color for unknown colors
  return `ansi:${color}` as TextProps['color']
// 函数收尾：已知智能体色走主题键，未知色直接拼 `ansi:` 前缀回退，保证不丢色。
}
