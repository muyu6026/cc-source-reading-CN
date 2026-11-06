import type { Command } from '../../commands.js'
// 引入命令类型与环境变量真值判定工具。
import { isEnvTruthy } from '../../utils/envUtils.js'

const installGitHubApp = {
// 命令对象定义。
  type: 'local-jsx',
  name: 'install-github-app',
  description: 'Set up Claude GitHub Actions for a repository',
  availability: ['claude-ai', 'console'],
// `availability` 限定该命令仅出现在 `claude-ai` 与 `console` 两种入口。
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_INSTALL_GITHUB_APP_COMMAND),
// 环境变量 `DISABLE_INSTALL_GITHUB_APP_COMMAND` 为真时隐藏该命令。
  load: () => import('./install-github-app.js'),
} satisfies Command

export default installGitHubApp
// 默认导出该命令定义。
