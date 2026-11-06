import { feature } from 'bun:bundle'
// `bun:bundle` 的 `feature()` 在打包期解析特性开关，用于条件化别名。
import type { Command } from '../../commands.js'

const branch = {
// 命令对象定义，`satisfies` 做静态形状校验。
  type: 'local-jsx',
  name: 'branch',
  // 'fork' alias only when /fork doesn't exist as its own command
  aliases: feature('FORK_SUBAGENT') ? [] : ['fork'],
// 仅当构建产物不含独立的 `/fork` 命令时，才给 `branch` 附加 `fork` 别名。
  description: 'Create a branch of the current conversation at this point',
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command
// 实现文件经 `import()` 惰性加载，未用到不进包。

export default branch
