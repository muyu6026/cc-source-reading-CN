import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isOverageProvisioningAllowed } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

function isExtraUsageAllowed(): boolean {
// 是否启用「超额用量」命令的总开关。
  if (isEnvTruthy(process.env.DISABLE_EXTRA_USAGE_COMMAND)) {
    return false
  }
  return isOverageProvisioningAllowed()
// 核心判定委托给 isOverageProvisioningAllowed；若 DISABLE_EXTRA_USAGE_COMMAND 为真则直接返回 false（环境变量优先）。
}

export const extraUsage = {
// 交互式版本命令定义：type 为 local-jsx（会弹出配置界面）。
  type: 'local-jsx',
  name: 'extra-usage',
  description: 'Configure extra usage to keep working when limits are hit',
  isEnabled: () => isExtraUsageAllowed() && !getIsNonInteractiveSession(),
  load: () => import('./extra-usage.js'),
} satisfies Command
// 满足 Command 类型约束；isEnabled 在非交互会话下返回 false，使其只在交互场景出现。

export const extraUsageNonInteractive = {
// 非交互版本命令定义：type 为 local，支持管道与脚本调用。
  type: 'local',
  name: 'extra-usage',
  supportsNonInteractive: true,
  description: 'Configure extra usage to keep working when limits are hit',
  isEnabled: () => isExtraUsageAllowed() && getIsNonInteractiveSession(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./extra-usage-noninteractive.js'),
} satisfies Command
// 同样满足 Command；isEnabled 仅当处于非交互会话为真，get isHidden 反向控制可见性，按需懒加载 extra-usage-noninteractive.js。
