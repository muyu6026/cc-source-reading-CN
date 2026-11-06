import type { Command } from '../../commands.js'
// 引入命令类型，以及「是否应当即时执行」的共用判定函数。
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
// 默认导出命令对象，定义 `effort` 子命令。
  type: 'local-jsx',
  name: 'effort',
  description: 'Set effort level for model usage',
  argumentHint: '[low|medium|high|max|auto]',
  get immediate() {
// 用 getter 形式暴露 `immediate`，以便按全局配置动态决定该命令是否即时弹出。
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./effort.js'),
} satisfies Command
// `satisfies Command` 保留对象字面量类型并做静态校验。
