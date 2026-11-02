// 本文件定义 bash 子命令 timeout 的规格：用带时限的方式运行一条命令。此处的 CommandSpec 是「命令元数据」的统一结构。
import type { CommandSpec } from '../registry.js'

const timeout: CommandSpec = {
  name: 'timeout',
  description: 'Run a command with a time limit',
  args: [
    {
      name: 'duration',
      description: 'Duration to wait before timing out (e.g., 10, 5s, 2m)',
      isOptional: false,
    },
    {
      name: 'command',
      description: 'Command to run',
      isCommand: true,
    },
  ],
}
// timeout 规格声明两个参数：duration（等待多久超时，如 10、5s、2m）与 command（真正要运行的命令，标记为 isCommand）。

export default timeout
// 最后用 export default 导出该规格对象，供 bash 命令注册表聚合加载。
