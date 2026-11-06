import type { Command } from '../../commands.js'
// 引入命令类型与两个工具：API Key 鉴权查询、环境变量真值判定，下方据此决定文案与可用性。
import { hasAnthropicApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default () =>
// 默认导出为工厂函数，命令名与描述在调用时才即时计算。
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasAnthropicApiKeyAuth()
      ? 'Switch Anthropic accounts'
      : 'Sign in with your Anthropic account',
// 描述按是否已持有 Anthropic API Key 动态切换：已登录显示「切换账号」，否则显示「登录」。
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
// 环境变量 `DISABLE_LOGIN_COMMAND` 为真时隐藏该命令，用于测试或嵌入式场景。
    load: () => import('./login.js'),
  }) satisfies Command
// `satisfies Command` 在保留对象字面量类型的同时做静态形状校验。
