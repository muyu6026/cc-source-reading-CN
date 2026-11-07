import type { Command } from '../../commands.js'
// `/add-dir` 命令的注册入口，用于向会话新增一个工作目录。

const addDir = {
  type: 'local-jsx',
  name: 'add-dir',
  description: 'Add a new working directory',
  argumentHint: '<path>',
// `argumentHint` 取值 `<path>`，这是必填参数，指明要新增的工作目录路径。
  load: () => import('./add-dir.js'),
} satisfies Command
// `type` 取值 `local-jsx`，目录选择界面在 `add-dir.tsx` 中实现。

export default addDir
