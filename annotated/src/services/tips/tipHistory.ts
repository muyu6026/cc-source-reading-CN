import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

export function recordTipShown(tipId: string): void {
  const numStartups = getGlobalConfig().numStartups
  saveGlobalConfig(c => {
    const history = c.tipsHistory ?? {}
    if (history[tipId] === numStartups) return c
    return { ...c, tipsHistory: { ...history, [tipId]: numStartups } }
  })
}
// 把「本 session 是第几次启动」记进该 tip 的历史槽位。用 numStartups 而不是时间戳是刻意的：冷却单位是「启动次数」不是「天数」——一天启动 20 次和 20 天启动一次对提示语疲劳度的影响完全不同。同一个启动周期内重复记则原样返回 c（不产生新对象），避免无谓写盘。

export function getSessionsSinceLastShown(tipId: string): number {
  const config = getGlobalConfig()
  const lastShown = config.tipsHistory?.[tipId]
  if (!lastShown) return Infinity
  return config.numStartups - lastShown
}
// 距上次显示过了几个启动周期。从没显示过返回 Infinity 而不是 0——配合调度器的降序排序，Infinity 保证新 tip 一定被优先选中（若返回 0，新 tip 会永远排在最末位轮不到）。这是全子系统最容易被改错的单点：把 Infinity 改成 0 不会报任何错，只会让新功能永远不上墙。
