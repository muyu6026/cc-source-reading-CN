import type { Command } from '../../commands.js'
// `Command` 类型来自 `../../commands.js`，仅作形状约束、运行期零开销。

const theme = {
// 命令对象以 `satisfies Command` 静态校验形状。
  type: 'local-jsx',
  name: 'theme',
  description: 'Change the theme',
// `description` 说明命令用于切换主题。
  load: () => import('./theme.js'),
// `load` 经动态 `import()` 惰性加载实现文件。
} satisfies Command

export default theme
// 默认导出命令对象，供注册表收集。
