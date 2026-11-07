import type { Command } from '../../commands.js'
// `Command` 类型为统一形状契约，仅导入类型、运行期零开销。

const help = {
// 命令对象以 `satisfies Command` 收口，类型与运行时一致。
  type: 'local-jsx',
  name: 'help',
  description: 'Show help and available commands',
// `description` 说明命令用于展示帮助与可用命令列表。
  load: () => import('./help.js'),
// `load` 经动态 `import()` 惰性加载实现文件，未用到不进包。
} satisfies Command

export default help
// 默认导出命令对象，供注册表收集。
