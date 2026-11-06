// 导入命令类型，约束命令对象形状。
import type { Command } from '../../commands.js'
// 导入命令是否立即执行的判断函数。
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '../../utils/model/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
// 描述动态拼接当前模型名，让用户看到正在使用的模型。
    return `Set the AI model for Claude Code (currently ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.js'),
} satisfies Command
// 用 satisfies 校验对象符合 Command 接口。
