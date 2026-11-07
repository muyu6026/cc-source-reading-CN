import type { Command } from '../../commands.js'
// `/output-style` 命令的注册入口，现已废弃，统一改用 `/config` 调整输出风格。

const outputStyle = {
  type: 'local-jsx',
  name: 'output-style',
  description: 'Deprecated: use /config to change output style',
// 描述直接写明已废弃并指向 `/config`，让旧调用方在帮助里就能看到迁移路径。
  isHidden: true,
// `isHidden: true` 把命令从补全列表里隐藏，但历史脚本仍可显式调用，避免硬删除破坏兼容性。
  load: () => import('./output-style.js'),
} satisfies Command

export default outputStyle
