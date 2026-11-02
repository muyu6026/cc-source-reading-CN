// 本文件是 bash 子命令规格的聚合入口（barrel）：把各个单独的命令规格收集成一个数组并满足 CommandSpec 类型约束。
import type { CommandSpec } from '../registry.js'
import alias from './alias.js'
import nohup from './nohup.js'
import pyright from './pyright.js'
import sleep from './sleep.js'
import srun from './srun.js'
import time from './time.js'
import timeout from './timeout.js'
// 依次引入 pyright、timeout、sleep、alias、nohup、time、srun 七个命令规格模块。

export default [
  pyright,
  timeout,
  sleep,
  alias,
  nohup,
  time,
  srun,
] satisfies CommandSpec[]
// export default 把七个规格按固定顺序拼成一个数组，末尾的 satisfies CommandSpec 保证类型正确；新增命令只需在此登记并 import。
