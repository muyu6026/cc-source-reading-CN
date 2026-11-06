import type { Command } from '../../commands.js'
// `/passes` 命令的元数据壳：按推荐奖励与资格动态生成描述与隐藏逻辑，实现懒加载 `passes.js`。
import {
  checkCachedPassesEligibility,
  getCachedReferrerReward,
} from '../../services/api/referral.js'

export default {
// 命令定义：类型 `local-jsx`，根据是否有推荐奖励拼出不同描述文案。
  type: 'local-jsx',
  name: 'passes',
  get description() {
// `description` 取值器：有推荐奖励时多一句「还能赚取额外用量」。
    const reward = getCachedReferrerReward()
    if (reward) {
      return 'Share a free week of Claude Code with friends and earn extra usage'
    }
    return 'Share a free week of Claude Code with friends'
  },
  get isHidden() {
// `isHidden` 取值器：无资格或无缓存时隐藏命令，避免无效入口。
    const { eligible, hasCache } = checkCachedPassesEligibility()
    return !eligible || !hasCache
  },
  load: () => import('./passes.js'),
} satisfies Command
