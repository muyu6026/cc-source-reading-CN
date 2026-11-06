import { env } from '../utils/env.js'
// 引入平台环境探测 env，用于按操作系统选择终端符号。

// The former is better vertically aligned, but isn't usually supported on Windows/Linux
// 注释：部分符号垂直对齐在 Windows/Linux 不被支持，故 darwin 用特殊符号、其他平台用普通圆。
export const BLACK_CIRCLE = env.platform === 'darwin' ? '⏺' : '●'
// 实心黑圆：darwin 用录影圆点 ⏺，其他平台用普通圆 ●。
export const BULLET_OPERATOR = '∙'
export const TEARDROP_ASTERISK = '✻'
export const UP_ARROW = '\u2191' // ↑ - used for opus 1m merge notice
export const DOWN_ARROW = '\u2193' // ↓ - used for scroll hint
export const LIGHTNING_BOLT = '↯' // \u21af - used for fast mode indicator
export const EFFORT_LOW = '○' // \u25cb - effort level: low
export const EFFORT_MEDIUM = '◐' // \u25d0 - effort level: medium
export const EFFORT_HIGH = '●' // \u25cf - effort level: high
export const EFFORT_MAX = '◉' // \u25c9 - effort level: max (Opus 4.6 only)

// Media/trigger status indicators
// 媒体与触发状态指示符号段。
export const PLAY_ICON = '\u25b6' // ▶
export const PAUSE_ICON = '\u23f8' // ⏸

// MCP subscription indicators
// MCP 订阅指示符号段（资源更新、入站/注入消息、分叉指令）。
export const REFRESH_ARROW = '\u21bb' // ↻ - used for resource update indicator
export const CHANNEL_ARROW = '\u2190' // ← - inbound channel message indicator
export const INJECTED_ARROW = '\u2192' // → - cross-session injected message indicator
export const FORK_GLYPH = '\u2442' // ⑂ - fork directive indicator

// Review status indicators (ultrareview diamond states)
// 审查状态（超审查菱形）指示符号段。
export const DIAMOND_OPEN = '\u25c7' // ◇ - running
export const DIAMOND_FILLED = '\u25c6' // ◆ - completed/failed
export const REFERENCE_MARK = '\u203b' // ※ - komejirushi, away-summary recap marker

// Issue flag indicator
// 问题旗标指示符号段。
export const FLAG_ICON = '\u2691' // ⚑ - used for issue flag banner

// Blockquote indicator
// 引用块与框线符号段。
export const BLOCKQUOTE_BAR = '\u258e' // ▎ - left one-quarter block, used as blockquote line prefix
export const HEAVY_HORIZONTAL = '\u2501' // ━ - heavy box-drawing horizontal

// Bridge status indicators
// 桥接状态指示符号段（含旋转动画帧数组）。
export const BRIDGE_SPINNER_FRAMES = [
// 桥接旋转动画的四帧字符串，用于在桥接连接中展示加载状态。
  '\u00b7|\u00b7',
  '\u00b7/\u00b7',
  '\u00b7\u2014\u00b7',
  '\u00b7\\\u00b7',
]
export const BRIDGE_READY_INDICATOR = '\u00b7\u2714\ufe0e\u00b7'
export const BRIDGE_FAILED_INDICATOR = '\u00d7'
