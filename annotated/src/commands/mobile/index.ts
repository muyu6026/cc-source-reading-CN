import type { Command } from '../../commands.js'
// `/mobile` 命令的注册入口，用于展示下载移动端 App 的二维码。

const mobile = {
  type: 'local-jsx',
  name: 'mobile',
  aliases: ['ios', 'android'],
// `aliases` 列表含 `ios` 与 `android` 两个别名，按平台习惯叫法都能唤起同一命令。
  description: 'Show QR code to download the Claude mobile app',
  load: () => import('./mobile.js'),
} satisfies Command
// `type` 取值 `local-jsx`，二维码展示界面在 `mobile.tsx` 中实现。

export default mobile
