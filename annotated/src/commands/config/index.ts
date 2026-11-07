import type { Command } from '../../commands.js'
// `/config` 命令的注册入口，元数据在此声明，面板实现在 `config.tsx` 中懒加载。

const config = {
  aliases: ['settings'],
// `aliases` 列表含 `settings` 这个别名，输入 `/settings` 也能打开同一配置面板。
  type: 'local-jsx',
  name: 'config',
  description: 'Open config panel',
  load: () => import('./config.js'),
} satisfies Command
// `type` 取值 `local-jsx` 配合 `satisfies Command`，保证命令字段在编译期就被类型系统校验。

export default config
