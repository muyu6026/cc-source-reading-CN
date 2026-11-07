import type { Command } from '../../commands.js'
// `Command` 类型从 `../../commands.js` 导入，仅作形状约束。

const tasks = {
// 命令对象用 `satisfies Command` 收口，类型与运行时一致。
  type: 'local-jsx',
// `type: 'local-jsx'` 表示这是一个在本地以 JSX 渲染界面的命令。
  name: 'tasks',
  aliases: ['bashes'],
// `aliases: ['bashes']` 给命令起别名，用户输入 `/bashes` 也能唤起。
  description: 'List and manage background tasks',
// `description` 说明命令用于列出与管理后台任务。
  load: () => import('./tasks.js'),
// `load` 经动态 `import()` 惰性加载实现模块。
} satisfies Command

export default tasks
// 默认导出命令对象，供注册表收集。
