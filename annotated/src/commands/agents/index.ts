import type { Command } from '../../commands.js'
// `Command` 类型来自 `../../commands.js`，仅作形状约束。

const agents = {
// 命令对象以 `satisfies Command` 静态校验形状。
  type: 'local-jsx',
  name: 'agents',
  description: 'Manage agent configurations',
// `description` 说明命令用于管理 agent 配置。
  load: () => import('./agents.js'),
// `load` 用动态 `import()` 惰性加载实现模块。
} satisfies Command

export default agents
// 默认导出命令对象，供注册表收集。
