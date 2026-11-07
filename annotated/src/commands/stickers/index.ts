import type { Command } from '../../commands.js'
// `Command` 类型是命令的统一形状契约，仅导入类型、运行期零开销。

const stickers = {
// 命令对象以 `satisfies Command` 静态校验形状，运行时类型不变。
  type: 'local',
  name: 'stickers',
  description: 'Order Claude Code stickers',
// `description` 描述命令用途，显示在帮助与命令列表中。
  supportsNonInteractive: false,
// `supportsNonInteractive` 为 false，说明该命令需要交互界面、不能纯脚本驱动。
  load: () => import('./stickers.js'),
// `load` 用动态 `import()` 惰性加载实现文件，未调用不进主包。
} satisfies Command

export default stickers
// 默认导出，供上层命令注册表收集。
