import type { Command } from '../../commands.js'
// `/export` 命令的注册入口，只声明命令元数据并懒加载真正的实现模块 `export.tsx`。

const exportCommand = {
  type: 'local-jsx',
  name: 'export',
  description: 'Export the current conversation to a file or clipboard',
  argumentHint: '[filename]',
  load: () => import('./export.js'),
} satisfies Command
// `} satisfies Command` 在编译期校验这个对象是否符合命令契约；`type` 字段取值 `local-jsx`，表示命令以本地 React 对话框形式渲染。

export default exportCommand
// 默认导出命令对象，命令注册表据此统一加载；模块内变量名仅为可读性，外部只认默认导出。
