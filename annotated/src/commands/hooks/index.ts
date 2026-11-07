import type { Command } from '../../commands.js'
// `/hooks` 命令的注册入口，用于查看工具事件相关的钩子配置。

const hooks = {
  type: 'local-jsx',
  name: 'hooks',
  description: 'View hook configurations for tool events',
  immediate: true,
// `immediate: true` 表示命令被调用后立即执行并展示结果，无需进入一次新的对话轮次，适合纯查看类命令。
  load: () => import('./hooks.js'),
} satisfies Command
// `type` 取值 `local-jsx`，实现模块 `hooks.tsx` 以对话框形式呈现钩子列表。

export default hooks
