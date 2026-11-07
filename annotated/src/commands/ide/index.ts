import type { Command } from '../../commands.js'
// `/ide` 命令的注册入口，用于管理 IDE 集成并展示接入状态。

const ide = {
  type: 'local-jsx',
  name: 'ide',
  description: 'Manage IDE integrations and show status',
  argumentHint: '[open]',
// `argumentHint` 取值 `[open]`（方括号表示可选）：带 `open` 可直接唤起 IDE 接入流程。
  load: () => import('./ide.js'),
} satisfies Command
// `type` 取值 `local-jsx`，实现模块 `ide.tsx` 负责渲染集成面板。

export default ide
