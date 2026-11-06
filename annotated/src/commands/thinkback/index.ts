import type { Command } from '../../commands.js'
// 引入命令类型与带缓存的 Statsig 特性门读取函数。
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

const thinkback = {
// 命令对象定义，对外名称为 `think-back`。
  type: 'local-jsx',
  name: 'think-back',
  description: 'Your 2025 Claude Code Year in Review',
  isEnabled: () =>
// `isEnabled` 用 Statsig 门 `tengu_thinkback` 控制可见性，这是「2025 年度回顾」入口。
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  load: () => import('./thinkback.js'),
} satisfies Command

export default thinkback
// 默认导出该命令定义。
