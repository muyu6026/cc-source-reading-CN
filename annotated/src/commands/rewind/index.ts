import type { Command } from '../../commands.js'
// 引入命令类型。

const rewind = {
// 命令对象定义，并附带 `checkpoint` 别名。
  description: `Restore the code and/or conversation to a previous point`,
// 描述为模板字符串：说明可把代码与/或对话回滚到此前某一点。
  name: 'rewind',
  aliases: ['checkpoint'],
  argumentHint: '',
  type: 'local',
  supportsNonInteractive: false,
  load: () => import('./rewind.js'),
} satisfies Command

export default rewind
// 默认导出该命令定义。
