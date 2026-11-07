import type { Command } from '../../commands.js'
// `Command` 类型为统一形状契约，仅导入类型、运行期零开销。

const skills = {
// 命令对象以 `satisfies Command` 静态校验形状。
  type: 'local-jsx',
  name: 'skills',
  description: 'List available skills',
// `description` 说明命令用于列出可用 skills。
  load: () => import('./skills.js'),
// `load` 用动态 `import()` 惰性加载实现模块，未调用不进包。
} satisfies Command

export default skills
// 默认导出命令对象，供注册表收集。
