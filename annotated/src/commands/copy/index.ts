/**
 * Copy command - minimal metadata only.
 * Implementation is lazy-loaded from copy.tsx to reduce startup time.
 */
// 本文件仅保存 `/copy` 命令的元数据，实现体懒加载以降低启动耗时。
// 导入命令类型。
import type { Command } from '../../commands.js'

const copy = {
  type: 'local-jsx',
  name: 'copy',
  description:
    "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)",
  load: () => import('./copy.js'),
} satisfies Command
// 用 satisfies 校验对象符合 Command 接口。

export default copy
// 默认导出命令定义。
