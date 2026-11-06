/**
 * /reload-plugins — Layer-3 refresh. Applies pending plugin changes to the
 * running session. Implementation lazy-loaded.
 */
// 本文件是 `/reload-plugins` 命令的元数据，描述三层刷新的作用，实现体懒加载。
// 导入命令类型，约束命令对象形状。
import type { Command } from '../../commands.js'

const reloadPlugins = {
  type: 'local',
  name: 'reload-plugins',
  description: 'Activate pending plugin changes in the current session',
  // SDK callers use query.reloadPlugins() (control request) instead of
  // sending this as a text prompt — that returns structured data
  // (commands, agents, plugins, mcpServers) for UI updates.
  supportsNonInteractive: false,
  load: () => import('./reload-plugins.js'),
} satisfies Command
// 用 satisfies 校验对象符合 Command 接口契约。

export default reloadPlugins
// 默认导出命令定义。
