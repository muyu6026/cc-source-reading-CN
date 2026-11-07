// 本文件定义 `doctor` 命令：诊断并校验 Claude Code 的安装与配置。
// 这里显式标注 `Command` 类型（而非 `satisfies`），写法与前几份略有不同。
import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
// 从 `envUtils` 引入 `isEnvTruthy`，把环境变量安全地解析为布尔值。

const doctor: Command = {
  name: 'doctor',
  description: 'Diagnose and verify your Claude Code installation and settings',
// `description` 说明命令用途：检查安装与设置是否正常。
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_DOCTOR_COMMAND),
// `isEnabled` 用 `!isEnvTruthy(DISABLE_DOCTOR_COMMAND)` 控制命令是否出现，
// 设置该环境变量为真即可隐藏 `doctor`，便于受限环境关闭自检。
  type: 'local-jsx',
  load: () => import('./doctor.js'),
// `load` 用动态 `import()` 懒加载实现，命令体按需进入主程序。
}

export default doctor
