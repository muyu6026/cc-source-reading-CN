import { formatTotalCost } from '../../cost-tracker.js'
// `/cost` 实现体（被 `cost/index.ts` 懒加载）：按需展示会话总成本与耗时。
import { currentLimits } from '../../services/claudeAiLimits.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

export const call: LocalCommandCall = async () => {
  if (isClaudeAISubscriber()) {
// 订阅用户走专属分支：按是否超额计费给不同文案，并额外打印总成本。
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your Claude Code usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your Claude Code usage'
    }

    if (process.env.USER_TYPE === 'ant') {
// 内部员工（USER_TYPE=ant）无论订阅与否都强制显示成本明细，便于调试计费。
      value += `\n\n[ANT-ONLY] Showing cost anyway:\n ${formatTotalCost()}`
    }
    return { type: 'text', value }
  }
  return { type: 'text', value: formatTotalCost() }
// 非订阅用户的兜底：直接返回格式化后的总成本文本。
}
