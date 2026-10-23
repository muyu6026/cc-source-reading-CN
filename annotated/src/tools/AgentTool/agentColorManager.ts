import { getAgentColorMap } from '../../bootstrap/state.js'
import type { Theme } from '../../utils/theme.js'

export type AgentColorName =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'cyan'

export const AGENT_COLORS: readonly AgentColorName[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
] as const

export const AGENT_COLOR_TO_THEME_COLOR = {
  red: 'red_FOR_SUBAGENTS_ONLY',
  blue: 'blue_FOR_SUBAGENTS_ONLY',
  green: 'green_FOR_SUBAGENTS_ONLY',
  yellow: 'yellow_FOR_SUBAGENTS_ONLY',
  purple: 'purple_FOR_SUBAGENTS_ONLY',
  orange: 'orange_FOR_SUBAGENTS_ONLY',
  pink: 'pink_FOR_SUBAGENTS_ONLY',
  cyan: 'cyan_FOR_SUBAGENTS_ONLY',
} as const satisfies Record<AgentColorName, keyof Theme>
// AGENT_COLOR_TO_THEME_COLOR：satisfies Record<AgentColorName, keyof Theme> 是编译期约束——八色必须齐全且都真是主题色键，漏一个编译不过。主题色名带 _FOR_SUBAGENTS_ONLY 后缀：subagent 专用色板，不与主 agent 的配色语义混用。

export function getAgentColor(agentType: string): keyof Theme | undefined {
  if (agentType === 'general-purpose') {
    return undefined
  }

  const agentColorMap = getAgentColorMap()

  // Check if color already assigned
  const existingColor = agentColorMap.get(agentType)
  if (existingColor && AGENT_COLORS.includes(existingColor)) {
    return AGENT_COLOR_TO_THEME_COLOR[existingColor]
  }

  return undefined
}
// getAgentColor：general-purpose 恒返回 undefined——默认 agent 不搞特殊色，UI 上用默认样式。颜色表是 bootstrap state 里的运行时注册表（frontmatter 声明 color 的 agent 在加载时 setAgentColor 注册）；表里的值还要过一遍白名单，脏数据直接当没有。

export function setAgentColor(
  agentType: string,
  color: AgentColorName | undefined,
): void {
  const agentColorMap = getAgentColorMap()

  if (!color) {
    agentColorMap.delete(agentType)
    return
  }

  if (AGENT_COLORS.includes(color)) {
    agentColorMap.set(agentType, color)
  }
}
// setAgentColor：传 undefined = 删除注册（frontmatter 里去掉 color 字段时清理旧值）；白名单外的值静默忽略——不抛错，坏颜色不该让 agent 加载失败。
