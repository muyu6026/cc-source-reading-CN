import type { Command } from '../../commands.js'

function isSupportedPlatform(): boolean {
// 平台白名单判定：只有 macOS（darwin）或 Windows x64 才支持桌面端命令。
  if (process.platform === 'darwin') {
    return true
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return true
  }
  return false
}
// 其余平台（如 Linux、Windows ARM）一律返回 false，命令隐藏。

const desktop = {
// 命令定义：在 Claude Desktop 中继续当前会话；别名 app，availability 限 claude-ai。
  type: 'local-jsx',
  name: 'desktop',
  aliases: ['app'],
  description: 'Continue the current session in Claude Desktop',
  availability: ['claude-ai'],
  isEnabled: isSupportedPlatform,
  get isHidden() {
    return !isSupportedPlatform()
  },
  load: () => import('./desktop.js'),
} satisfies Command
// 满足 Command 类型；isEnabled 等于平台支持判定，get isHidden 反向控制可见性，按需懒加载 desktop.js。

export default desktop
