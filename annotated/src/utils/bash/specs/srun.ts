// 本文件是 bash 子命令规范中的一种：定义 srun（在 SLURM 集群节点上跑命令）的命令名、描述、选项（-n/--ntasks 任务数、-N/--nodes 节点数）与位置参数（要执行的命令）。
import type { CommandSpec } from '../registry.js'

// srun：一个符合 CommandSpec 的对象，导出为默认成员；选项与参数都带人类可读描述，供自动补全与帮助生成消费。
const srun: CommandSpec = {
  name: 'srun',
  description: 'Run a command on SLURM cluster nodes',
  options: [
    {
      name: ['-n', '--ntasks'],
      description: 'Number of tasks',
      args: {
        name: 'count',
        description: 'Number of tasks to run',
      },
    },
    {
      name: ['-N', '--nodes'],
      description: 'Number of nodes',
      args: {
        name: 'count',
        description: 'Number of nodes to allocate',
      },
    },
  ],
  args: {
    name: 'command',
    description: 'Command to run on the cluster',
    isCommand: true,
  },
}

export default srun
