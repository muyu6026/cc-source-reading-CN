import type { Command } from '../../commands.js'
// `Command` 类型为统一形状契约，仅导入类型、运行期零成本。
import { isEnvTruthy } from '../../utils/envUtils.js'
// 引入 `isEnvTruthy`，把环境变量解析为布尔，用于条件开关。

export default {
// 命令用 `export default {` 直接导出对象，并以 `satisfies Command` 收口。
  type: 'local-jsx',
  name: 'logout',
  description: 'Sign out from your Anthropic account',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGOUT_COMMAND),
// `isEnabled` 经 `DISABLE_LOGOUT_COMMAND` 环境变量决定是否在界面暴露该命令。
  load: () => import('./logout.js'),
// `load` 用动态 `import()` 惰性加载实现模块，未调用不进包。
} satisfies Command
// `satisfies Command` 静态校验对象形状，不改动运行时类型。
