import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
// 引入非交互会话判定函数与命令类型。
import type { Command } from '../../commands.js'

const command: Command = {
// 命令对象定义，对外名称为 `chrome`。
  name: 'chrome',
  description: 'Claude in Chrome (Beta) settings',
  availability: ['claude-ai'],
// `availability: ['claude-ai']` 限定该命令仅出现在 Claude.ai 入口。
  isEnabled: () => !getIsNonInteractiveSession(),
// 非交互会话中隐藏该命令，因为 Beta 设置页需要可交互的运行环境。
  type: 'local-jsx',
  load: () => import('./chrome.js'),
}

export default command
// 默认导出该命令定义。
