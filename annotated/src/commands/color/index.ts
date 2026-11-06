/**
 * Color command - minimal metadata only.
 * Implementation is lazy-loaded from color.ts to reduce startup time.
 */
// 本文件仅保存 `/color` 命令的元数据，实现体懒加载以降低启动耗时。
// 导入命令类型。
import type { Command } from '../../commands.js'

const color = {
  type: 'local-jsx',
  name: 'color',
  description: 'Set the prompt bar color for this session',
  immediate: true,
  argumentHint: '<color|default>',
  load: () => import('./color.js'),
} satisfies Command
// 用 satisfies 校验对象符合 Command 接口。

export default color
// 默认导出命令定义。
