// 本文件定义 `mcp` 命令：管理 MCP（模型上下文协议）服务器。
// 属于本地 JSX 命令，最后默认导出。
import type { Command } from '../../commands.js'

const mcp = {
  type: 'local-jsx',
// `type: 'local-jsx'` 说明命令会弹出本地界面来配置服务器，而非后台静默完成。
  name: 'mcp',
  description: 'Manage MCP servers',
  immediate: true,
  argumentHint: '[enable|disable [server-name]]',
// `argumentHint` 展示用法：`enable|disable` 后接可选的服务器名称。
  load: () => import('./mcp.js'),
// `load` 用动态 `import()` 按需加载实现，实现细节不会拖慢主程序启动。
} satisfies Command
// `satisfies Command` 在编译期校验对象符合命令接口，运行时类型不变。

export default mcp
