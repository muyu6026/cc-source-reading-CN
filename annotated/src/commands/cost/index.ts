/**
 * Cost command - minimal metadata only.
 * Implementation is lazy-loaded from cost.ts to reduce startup time.
 */
// `/cost` 命令的元数据壳：实现体拆到 `cost.ts` 懒加载以缩短启动时间。
import type { Command } from '../../commands.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

const cost = {
// 命令定义：类型 `local`、描述文案，并让 `isHidden` 在订阅用户（非内部员工）身上隐藏命令。
  type: 'local',
  name: 'cost',
  description: 'Show the total cost and duration of the current session',
  get isHidden() {
    // Keep visible for Ants even if they're subscribers (they see cost breakdowns)
    if (process.env.USER_TYPE === 'ant') {
      return false
    }
    return isClaudeAISubscriber()
  },
  supportsNonInteractive: true,
  load: () => import('./cost.js'),
// 按需懒加载真正实现 `cost.js`，整段以 `satisfies Command` 收尾。
} satisfies Command

export default cost
