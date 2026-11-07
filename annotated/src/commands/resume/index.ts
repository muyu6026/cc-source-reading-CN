// 本文件定义 `resume` 命令：恢复（继续）一段之前的会话。
// 显式标注 `Command` 类型，最后默认导出。
import type { Command } from '../../commands.js'

const resume: Command = {
  type: 'local-jsx',
// `type: 'local-jsx'` 表示命令会弹出本地界面来挑选要恢复的会话。
  name: 'resume',
  description: 'Resume a previous conversation',
  aliases: ['continue'],
// `aliases: ['continue']` 让 `continue` 成为 `resume` 的等价别名。
  argumentHint: '[conversation id or search term]',
// `argumentHint` 提示参数可以是会话 id 或搜索词，用中括号表示可选。
  load: () => import('./resume.js'),
// `load` 用动态 `import()` 懒加载实现，主包不预先包含它。
}

export default resume
