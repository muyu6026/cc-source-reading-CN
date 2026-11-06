import { useEffect } from 'react'
// 成本汇总 Hook：进程退出时把当前会话总成本打印到终端并落盘，供状态栏与退出日志使用。
import { formatTotalCost, saveCurrentSessionCosts } from './cost-tracker.js'
import { hasConsoleBillingAccess } from './utils/billing.js'
import type { FpsMetrics } from './utils/fpsTracker.js'

export function useCostSummary(
  getFpsMetrics?: () => FpsMetrics | undefined,
): void {
// `useCostSummary`：接收可选帧率指标获取器，逻辑全包在 `useEffect` 里、空依赖只跑一次。
  useEffect(() => {
    const f = () => {
      if (hasConsoleBillingAccess()) {
        process.stdout.write('\n' + formatTotalCost() + '\n')
// 有控制台计费权限时才把总成本写入标准输出。
      }

      saveCurrentSessionCosts(getFpsMetrics?.())
// 同时把当前会话成本保存下来，供后续状态栏读取。
    }
    process.on('exit', f)
    return () => {
      process.off('exit', f)
    }
  }, [])
}
