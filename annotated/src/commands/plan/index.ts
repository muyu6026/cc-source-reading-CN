import type { Command } from '../../commands.js'
// `/plan` 命令的注册入口，用于进入计划模式或查看当前会话计划。

const plan = {
  type: 'local-jsx',
  name: 'plan',
  description: 'Enable plan mode or view the current session plan',
  argumentHint: '[open|<description>]',
// `argumentHint` 取值 `[open|<description>]`：带 `open` 进入计划模式，或给一段描述让模型先拟定计划。
  load: () => import('./plan.js'),
} satisfies Command
// `type` 取值 `local-jsx`，真正的计划编辑器在 `plan.tsx` 中懒加载。

export default plan
