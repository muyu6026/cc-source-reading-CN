// 本文件定义 `tag` 命令：给当前会话打一个可搜索的标签。
// 通过 `isEnabled` 控制是否对当前用户开放。
import type { Command } from '../../commands.js'

const tag = {
  type: 'local-jsx',
  name: 'tag',
  description: 'Toggle a searchable tag on the current session',
// `name` 是命令在 REPL 中的实际名称，用户输入 `tag` 即可触发。
  isEnabled: () => process.env.USER_TYPE === 'ant',
// `isEnabled` 用函数动态决定是否显示该命令，
// 这里仅当环境变量 `USER_TYPE` 等于 `ant` 时才启用，属于内部专用命令。
  argumentHint: '<tag-name>',
// `argumentHint` 用尖括号 `<tag-name>` 表示必填的标签名。
  load: () => import('./tag.js'),
// `load` 用动态 `import()` 懒加载真正的实现，保持主包精简。
} satisfies Command

export default tag
