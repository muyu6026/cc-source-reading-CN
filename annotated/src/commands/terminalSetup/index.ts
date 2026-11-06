import type { Command } from '../../commands.js'
// `/terminal-setup` 命令：为不同终端配置换行键绑定与视觉提示音。
import { env } from '../../utils/env.js'

// Terminals that natively support CSI u / Kitty keyboard protocol
// 原生支持 CSI u / Kitty 键盘协议的终端清单，用于决定是否隐藏此命令。
const NATIVE_CSIU_TERMINALS: Record<string, string> = {
  ghostty: 'Ghostty',
  kitty: 'Kitty',
  'iTerm.app': 'iTerm2',
  WezTerm: 'WezTerm',
}

const terminalSetup = {
// 命令主体：按当前终端生成不同描述，并在原生支持协议时自动隐藏。
  type: 'local-jsx',
  name: 'terminal-setup',
  description:
    env.terminal === 'Apple_Terminal'
      ? 'Enable Option+Enter key binding for newlines and visual bell'
      : 'Install Shift+Enter key binding for newlines',
  isHidden: env.terminal !== null && env.terminal in NATIVE_CSIU_TERMINALS,
  load: () => import('./terminalSetup.js'),
} satisfies Command

export default terminalSetup
