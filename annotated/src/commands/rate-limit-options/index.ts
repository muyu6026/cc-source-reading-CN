// 导入命令类型，用于约束下方命令对象的结构。
import type { Command } from '../../commands.js'
// 导入订阅状态判断函数，决定命令对哪些用户启用。
import { isClaudeAISubscriber } from '../../utils/auth.js'

const rateLimitOptions = {
  type: 'local-jsx',
  name: 'rate-limit-options',
  description: 'Show options when rate limit is reached',
  isEnabled: () => {
    if (!isClaudeAISubscriber()) {
      return false
    }

    return true
  },
// 标记为隐藏命令，仅内部调用，不对外暴露到帮助列表。
  isHidden: true, // Hidden from help - only used internally
  load: () => import('./rate-limit-options.js'),
} satisfies Command

export default rateLimitOptions
// 默认导出速率限制选项命令定义。
