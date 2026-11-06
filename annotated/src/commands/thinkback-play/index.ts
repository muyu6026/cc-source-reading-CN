// 导入命令类型，约束命令对象形状。
import type { Command } from '../../commands.js'
// 导入特性开关判断，用于决定是否启用该命令。
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

// Hidden command that just plays the animation
// Called by the thinkback skill after generation is complete
// 说明这是隐藏的动画播放命令，由 thinkback 技能在生成完成后调用。
const thinkbackPlay = {
  type: 'local',
  name: 'thinkback-play',
  description: 'Play the thinkback animation',
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  isHidden: true,
  supportsNonInteractive: false,
  load: () => import('./thinkback-play.js'),
} satisfies Command

export default thinkbackPlay
// 默认导出命令定义。
