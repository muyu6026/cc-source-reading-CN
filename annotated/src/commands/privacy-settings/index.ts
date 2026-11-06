import type { Command } from '../../commands.js'
// 引入命令类型与订阅身份判定工具 `isConsumerSubscriber`。
import { isConsumerSubscriber } from '../../utils/auth.js'

const privacySettings = {
// 命令对象以 `satisfies Command` 校验字段形状，同时保留字面量类型。
  type: 'local-jsx',
  name: 'privacy-settings',
  description: 'View and update your privacy settings',
  isEnabled: () => {
// 仅当当前用户为终端消费者订阅者时才启用，企业或团队部署不暴露该入口。
    return isConsumerSubscriber()
  },
  load: () => import('./privacy-settings.js'),
} satisfies Command

export default privacySettings
// 默认导出该命令定义，实际实现由加载器惰性 `import` 引入。
