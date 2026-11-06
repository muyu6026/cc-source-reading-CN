import { feature } from 'bun:bundle'
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js'
import type { Command } from '../../commands.js'

function isEnabled(): boolean {
// 桥接命令的总开关：先确认编译期开启了 BRIDGE_MODE 特性，再调用 isBridgeEnabled 看桥接是否打开。
  if (!feature('BRIDGE_MODE')) {
    return false
  }
  return isBridgeEnabled()
}
// 两层判定都满足才返回 true（特性开关 + 实际桥接开关）。

const bridge = {
// 命令定义：把当前终端接入远程控制会话；命令名为 remote-control，别名 rc。
  type: 'local-jsx',
  name: 'remote-control',
  aliases: ['rc'],
  description: 'Connect this terminal for remote-control sessions',
  argumentHint: '[name]',
  isEnabled,
  get isHidden() {
    return !isEnabled()
  },
  immediate: true,
  load: () => import('./bridge.js'),
} satisfies Command
// 满足 Command 类型；immediate 立即执行，isHidden 与 isEnabled 相反，按需懒加载 bridge.js。

export default bridge
