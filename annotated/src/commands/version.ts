import type { Command, LocalCommandCall } from '../types/command.js'
// `/version` 命令：打印当前会话运行版本（区分构建时间与下载版本），仅内部员工会话启用。

const call: LocalCommandCall = async () => {
// `call` 实现：依据构建时间宏决定输出「版本（构建于某时）」还是仅版本号。
  return {
    type: 'text',
    value: MACRO.BUILD_TIME
      ? `${MACRO.VERSION} (built ${MACRO.BUILD_TIME})`
      : MACRO.VERSION,
  }
}

const version = {
// 命令元数据：类型 `local`、描述文案，并仅在 `USER_TYPE=ant` 时启用。
  type: 'local',
  name: 'version',
  description:
    'Print the version this session is running (not what autoupdate downloaded)',
  isEnabled: () => process.env.USER_TYPE === 'ant',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default version
