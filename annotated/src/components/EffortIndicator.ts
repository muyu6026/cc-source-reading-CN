import {
  EFFORT_HIGH,
  EFFORT_LOW,
  EFFORT_MAX,
  EFFORT_MEDIUM,
} from '../constants/figures.js'
import {
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  modelSupportsEffort,
} from '../utils/effort.js'

/**
 * Build the text for the effort-changed notification, e.g. "◐ medium · /effort".
 * Returns undefined if the model doesn't support effort.
 */
// 通知文案在这里统一生成：调用方只拿到一个字符串或 undefined，不关心字形表与回退规则
export function getEffortNotificationText(
  effortValue: EffortValue | undefined,
  model: string,
): string | undefined {
  if (!modelSupportsEffort(model)) return undefined
// 模型不支持 effort 就直接返回 undefined：调用方据此决定整条通知是否出现，而不是显示半截文案
  const level = getDisplayedEffortLevel(model, effortValue)
  return `${effortLevelToSymbol(level)} ${level} · /effort`
}

// 等级到字形：四个常量来自 figures 常数表，保证与其它状态图标同宽同风格
export function effortLevelToSymbol(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return EFFORT_LOW
    case 'medium':
      return EFFORT_MEDIUM
    case 'high':
      return EFFORT_HIGH
    case 'max':
      return EFFORT_MAX
    default:
// 未知等级回退到 high 而不是抛错：level 可能来自远端配置，坏值不该让界面崩掉
      // Defensive: level can originate from remote config. If an unknown
      // value slips through, render the high symbol rather than undefined.
      return EFFORT_HIGH
  }
}
