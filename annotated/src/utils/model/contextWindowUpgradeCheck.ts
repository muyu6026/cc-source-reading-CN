import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
// 文件级：根据当前模型与 1M 上下文访问权限，给出可升级提示（opus[1m] / sonnet[1m]，倍数 5x）。
import { getUserSpecifiedModelSetting } from './model.js'

// @[MODEL LAUNCH]: Add a branch for the new model if it supports a 1M context upgrade path.
/**
 * Get available model upgrade for more context
 * Returns null if no upgrade available or user already has max context
 */
// getAvailableUpgrade（私有）：读用户所选模型，opus 且通过 checkOpus1mAccess 则给 opus[1m]，sonnet 同理给 sonnet[1m]，否则 null。
function getAvailableUpgrade(): {
  alias: string
  name: string
  multiplier: number
} | null {
  const currentModelSetting = getUserSpecifiedModelSetting()
  if (currentModelSetting === 'opus' && checkOpus1mAccess()) {
    return {
      alias: 'opus[1m]',
      name: 'Opus 1M',
      multiplier: 5,
    }
  } else if (currentModelSetting === 'sonnet' && checkSonnet1mAccess()) {
    return {
      alias: 'sonnet[1m]',
      name: 'Sonnet 1M',
      multiplier: 5,
    }
  }

  return null
}
// getAvailableUpgrade 收尾：无可用升级时返回 null（已是最满上下文或无权升级）。

/**
 * Get upgrade message for different contexts
 */
// getUpgradeMessage：按 context 是 warning 还是 tip 返回不同文案；warning 给「/model 别名」，tip 给带倍数说明的提示句。
export function getUpgradeMessage(context: 'warning' | 'tip'): string | null {
  const upgrade = getAvailableUpgrade()
  if (!upgrade) return null

  switch (context) {
    case 'warning':
      return `/model ${upgrade.alias}`
    case 'tip':
      return `Tip: You have access to ${upgrade.name} with ${upgrade.multiplier}x more context`
    default:
      return null
  }
}
// 收尾：无升级时返回 null，default 分支同样兜底返回 null。
