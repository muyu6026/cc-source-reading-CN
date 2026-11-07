// 本文件定义 `install-slack-app` 命令：安装 Claude 的 Slack 应用。
// 属于 `type: 'local'` 的后台命令。
import type { Command } from '../../commands.js'

const installSlackApp = {
  type: 'local',
  name: 'install-slack-app',
  description: 'Install the Claude Slack app',
// `description` 说明命令用途：把 Claude 接入 Slack 工作区。
  availability: ['claude-ai'],
// `availability: ['claude-ai']` 限定该命令只在 `claude-ai` 发行渠道中出现，
// 普通开源版看不到它。
  supportsNonInteractive: false,
// `supportsNonInteractive` 为 false，说明这条命令必须走交互流程，不能脚本化。
  load: () => import('./install-slack-app.js'),
// `load` 用动态 `import()` 懒加载实现，主包不预先包含。
} satisfies Command

export default installSlackApp
