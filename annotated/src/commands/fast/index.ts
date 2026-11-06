import type { Command } from '../../commands.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeEnabled,
} from '../../utils/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

const fast = {
// 命令定义：切换「快速模式」，仅作用于 FAST_MODE_MODEL_DISPLAY 指定的那个模型。
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return `Toggle fast mode (${FAST_MODE_MODEL_DISPLAY} only)`
// 描述动态拼出当前快速模式模型名（例如「Toggle fast mode (Haiku only)」）。
  },
  availability: ['claude-ai', 'console'],
  isEnabled: () => isFastModeEnabled(),
// 只在快速模式本身被启用时才显示此命令；get isHidden 反向控制隐藏。
  get isHidden() {
    return !isFastModeEnabled()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
// immediate 是否立即执行，跟随通用的「推断配置命令是否即时」判定。
  load: () => import('./fast.js'),
} satisfies Command
// 满足 Command 类型；availability 限定 claude-ai 与 console 两种渠道。

export default fast
