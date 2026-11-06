import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
// `/context` 双入口：交互态用彩色网格可视化上下文占用，非交互态只展示纯文本用量。
import type { Command } from '../../commands.js'

export const context: Command = {
// 交互版：仅在交互会话启用，类型 `local-jsx`，按需懒加载 `context.js`。
  name: 'context',
  description: 'Visualize current context usage as a colored grid',
  isEnabled: () => !getIsNonInteractiveSession(),
  type: 'local-jsx',
  load: () => import('./context.js'),
}

export const contextNonInteractive: Command = {
// 非交互版：靠 `isHidden`/`isEnabled` 与交互版互斥，只在非交互会话可见可运行。
  type: 'local',
  name: 'context',
  supportsNonInteractive: true,
  description: 'Show current context usage',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./context-noninteractive.js'),
}
