// 文件级。把 `nohup` 注册成 bash 内置命令规格：运行一个对挂断免疫的命令。
import type { CommandSpec } from '../registry.js'

const nohup: CommandSpec = {
  name: 'nohup',
  description: 'Run a command immune to hangups',
  args: {
    name: 'command',
    description: 'Command to run with nohup',
    isCommand: true,
  },
}
// `args` 在此收尾，声明必填的 `command` 参数并标 `isCommand`，表示这个参数本身是一条要执行的命令。

export default nohup
// 默认导出交给上层注册器。
