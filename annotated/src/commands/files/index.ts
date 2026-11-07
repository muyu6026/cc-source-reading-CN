// 本文件定义 `files` 命令：列出当前上下文里所有已加载的文件。
// 同样是 `type: 'local'` 的无界面后台命令。
import type { Command } from '../../commands.js'

const files = {
  type: 'local',
  name: 'files',
  description: 'List all files currently in context',
// `description` 说明命令会罗列当前已进入上下文的全部文件。
  isEnabled: () => process.env.USER_TYPE === 'ant',
// `isEnabled` 同样仅在 `USER_TYPE` 等于 `ant` 时启用，属内部命令。
  supportsNonInteractive: true,
// `supportsNonInteractive` 为真，命令可脱离交互模式运行。
  load: () => import('./files.js'),
// `load` 用动态 `import()` 按需加载实现，避免拖慢启动。
} satisfies Command

export default files
