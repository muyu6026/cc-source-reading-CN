// 导入远程模式判断，决定是否显示该命令。
import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

const session = {
  type: 'local-jsx',
  name: 'session',
  aliases: ['remote'],
// 别名为 remote，两者指向同一命令。
  description: 'Show remote session URL and QR code',
  isEnabled: () => getIsRemoteMode(),
// 仅在远程模式下启用该命令。
  get isHidden() {
    return !getIsRemoteMode()
  },
  load: () => import('./session.js'),
} satisfies Command

export default session
// 默认导出命令定义。
