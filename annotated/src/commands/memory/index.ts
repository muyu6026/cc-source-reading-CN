import type { Command } from '../../commands.js'
// `Command` 类型从 `../../commands.js` 导入，仅作形状约束。

const memory: Command = {
// 命令对象以 `: Command` 类型注解声明（非 `satisfies`），缺字段即编译失败。
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit Claude memory files',
// `description` 说明命令用于编辑 Claude 记忆文件。
  load: () => import('./memory.js'),
// `load` 用动态 `import()` 惰性加载实现模块。
}

export default memory
// 默认导出命令对象，供注册表收集。
