import type { Command } from '../../commands.js'
// `Command` 类型从 `../../commands.js` 导入，仅作形状约束、运行期零成本。

const stats = {
// 命令对象以 `satisfies Command` 收口，类型与运行时一致。
  type: 'local-jsx',
  name: 'stats',
  description: 'Show your Claude Code usage statistics and activity',
// `description` 说明命令用于展示使用统计与活动记录。
  load: () => import('./stats.js'),
// `load` 经动态 `import()` 惰性加载实现文件。
} satisfies Command

export default stats
// 默认导出命令对象，供注册表收集。
