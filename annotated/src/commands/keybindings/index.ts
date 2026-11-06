import type { Command } from '../../commands.js'
// 引入命令类型与用户键位绑定加载函数。
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js'

const keybindings = {
// 命令对象定义。
  name: 'keybindings',
  description: 'Open or create your keybindings configuration file',
  isEnabled: () => isKeybindingCustomizationEnabled(),
// 仅当用户已开启键位自定义功能时才显示该命令。
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./keybindings.js'),
} satisfies Command

export default keybindings
// 默认导出该命令定义。
