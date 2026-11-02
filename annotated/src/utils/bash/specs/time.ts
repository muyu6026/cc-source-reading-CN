// 文件级。把 `time` 注册成 bash 内置命令规格：对一条命令计时。
import type { CommandSpec } from '../registry.js'

const time: CommandSpec = {
  name: 'time',
  description: 'Time a command',
  args: {
    name: 'command',
    description: 'Command to time',
    isCommand: true,
  },
}
// `args` 在此收尾，声明必填的 `command` 参数并标 `isCommand`。

export default time
// 默认导出交给上层注册器。
