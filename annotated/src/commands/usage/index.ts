import type { Command } from '../../commands.js'
// `Command` 类型来自 `../../commands.js`，仅作形状约束。

export default {
// 命令用 `export default {` 直接导出对象，并以 `satisfies Command` 收口。
  type: 'local-jsx',
  name: 'usage',
  description: 'Show plan usage limits',
  availability: ['claude-ai'],
// `availability: ['claude-ai']` 限制该命令仅在 claude-ai 渠道可见与可用。
  load: () => import('./usage.js'),
// `load` 经动态 `import()` 惰性加载实现文件。
} satisfies Command
// `satisfies Command` 静态校验对象形状，不改动运行时类型。
