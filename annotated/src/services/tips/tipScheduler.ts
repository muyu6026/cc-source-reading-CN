import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { getSessionsSinceLastShown, recordTipShown } from './tipHistory.js'
import { getRelevantTips } from './tipRegistry.js'
import type { Tip, TipContext } from './types.js'

export function selectTipWithLongestTimeSinceShown(
  availableTips: Tip[],
): Tip | undefined {
  if (availableTips.length === 0) {
    return undefined
  }

  if (availableTips.length === 1) {
    return availableTips[0]
  }

  // Sort tips by sessions since last shown (descending) and take the first one
  // This is the tip that hasn't been shown for the longest time
  const tipsWithSessions = availableTips.map(tip => ({
    tip,
    sessions: getSessionsSinceLastShown(tip.id),
  }))

  tipsWithSessions.sort((a, b) => b.sessions - a.sessions)
  return tipsWithSessions[0]?.tip
}
// 从候选里挑「最久没出现过的那条」。sessions 是「距上次显示经过几个启动周期」，从未显示过的是 Infinity——所以新 tip 一定最先轮到，这是设计意图：新功能要趁用户还新鲜时露脸。降序 sort 取 [0]，两条并列时按原数组顺序稳定。注意这里只排不滤，冷却过滤已在 getRelevantTips 里做过。

export async function getTipToShowOnSpinner(
  context?: TipContext,
): Promise<Tip | undefined> {
  // Check if tips are disabled (default to true if not set)
  if (getSettings_DEPRECATED().spinnerTipsEnabled === false) {
    return undefined
  }

  const tips = await getRelevantTips(context)
  if (tips.length === 0) {
    return undefined
  }

  return selectTipWithLongestTimeSinceShown(tips)
}
// spinner 的总入口。先查总开关 spinnerTipsEnabled（默认 true——settings 里只有显式 false 才关闭，没这个键时 undefined !== false 照常显示），再取相关列表，最后交给 selectTipWithLongestTimeSinceShown。空列表返回 undefined，调用方（spinner）就什么都不显示。

export function recordShownTip(tip: Tip): void {
  // Record in history
  recordTipShown(tip.id)

  // Log event for analytics
  logEvent('tengu_tip_shown', {
    tipIdLength:
      tip.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    cooldownSessions: tip.cooldownSessions,
  })
}
// 显示后落账 + 遥测。两件事必须一起做：recordTipShown 写冷却账本（决定下次什么时候能再出现），logEvent('tengu_tip_shown') 发分析事件。注意遥测发的是 tipIdLength 而不是 tipId——tip id 里可能带用户信息（自定义 tip 的 id 来自用户设置），只发长度既够做聚合统计又不碰 PII，这是 api/logging.ts 那套 _I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 命名约束的又一应用。
