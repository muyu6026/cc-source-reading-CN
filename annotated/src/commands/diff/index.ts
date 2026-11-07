import type { Command } from '../../commands.js'
// `/diff` 命令的注册入口，既看未提交的改动，也看逐轮对话产生的差异。

export default {
  type: 'local-jsx',
  name: 'diff',
  description: 'View uncommitted changes and per-turn diffs',
// 描述点明命令的双重职责：查看工作区未提交变更，以及按对话轮次回看 diff。
  load: () => import('./diff.js'),
} satisfies Command
// `export default { ... } satisfies Command` 直接导出匿名命令对象并用 `satisfies` 校验形状。
