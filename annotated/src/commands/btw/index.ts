import type { Command } from '../../commands.js'
// 引入命令类型。

const btw = {
  type: 'local-jsx',
// 命令对象定义。
  name: 'btw',
  description:
    'Ask a quick side question without interrupting the main conversation',
// 描述为跨行字符串：在主线对话之外抛出一个不打断当前任务的旁支提问。
  immediate: true,
// `immediate: true` 让命令无需等待、立即弹出来收集旁支问题。
  argumentHint: '<question>',
  load: () => import('./btw.js'),
} satisfies Command

export default btw
// 默认导出该命令定义。
