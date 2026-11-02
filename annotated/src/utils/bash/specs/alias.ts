// 这是 bash 子命令 specs 目录里的一条命令定义：alias，用于创建或列出命令别名。
import type { CommandSpec } from '../registry.js'

const alias: CommandSpec = {
  name: 'alias',
  description: 'Create or list command aliases',
  args: {
    name: 'definition',
    description: 'Alias definition in the form name=value',
    isOptional: true,
    isVariadic: true,
  },
}

export default alias
// 结构：导出一个 CommandSpec 对象，name 为 alias，带一个可选且可重复的 definition 参数，说明形如 name=value，描述为「创建或列出命令别名」。
