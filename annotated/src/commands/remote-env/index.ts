// 导入命令类型，约束命令对象形状。
import type { Command } from '../../commands.js'
// 导入策略允许判断，用于组织策略门禁。
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

export default {
  type: 'local-jsx',
  name: 'remote-env',
  description: 'Configure the default remote environment for teleport sessions',
  isEnabled: () =>
// 启用条件：订阅用户且策略允许远程会话。
    isClaudeAISubscriber() && isPolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return !isClaudeAISubscriber() || !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('./remote-env.js'),
} satisfies Command
// 用 satisfies 校验对象符合 Command 接口。
