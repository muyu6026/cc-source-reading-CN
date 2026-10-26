import { useEffect } from 'react'
import { isEnvTruthy } from '../utils/envUtils.js'

export function useAfterFirstRender(): void {
// 首次渲染后（仅 ant 环境 + 指定 env）打印启动耗时并直接退出进程，用于自动化基准测量。
  useEffect(() => {
    if (
      process.env.USER_TYPE === 'ant' &&
      isEnvTruthy(process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER)
    ) {
      process.stderr.write(
        `\nStartup time: ${Math.round(process.uptime() * 1000)}ms\n`,
      )
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(0)
// 打印 uptime 毫秒后 process.exit(0) 干净退出；该分支被 custom-rules 允许越过 no-process-exit。
    }
  }, [])
// effect 依赖空数组，只在挂载后执行一次；非 ant 或未按指定 env 时整段静默跳过。
}
