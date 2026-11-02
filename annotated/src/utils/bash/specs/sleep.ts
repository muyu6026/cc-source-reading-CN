// 文件级。把 `sleep` 注册成一个 bash 内置命令规格：延迟指定时长。
import type { CommandSpec } from '../registry.js'

const sleep: CommandSpec = {
  name: 'sleep',
  description: 'Delay for a specified amount of time',
  args: {
    name: 'duration',
    description: 'Duration to sleep (seconds or with suffix like 5s, 2m, 1h)',
    isOptional: false,
  },
}
// `args` 在此收尾，声明一个必填的 `duration` 参数，说明里举例可用 `5s`、`2m`、`1h` 这类带后缀的写法。

export default sleep
// 以默认导出把这份规格对象交给上层注册器。
