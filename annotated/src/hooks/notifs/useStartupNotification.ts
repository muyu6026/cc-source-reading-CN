import { useEffect, useRef } from 'react'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import {
  type Notification,
  useNotifications,
} from '../../context/notifications.js'
import { logError } from '../../utils/log.js'

type Result = Notification | Notification[] | null
// 计算函数三种返回：null 跳过 / 单条 / 多条。

/**
 * Fires notification(s) once on mount. Encapsulates the remote-mode gate and
 * once-per-session ref guard that was hand-rolled across 10+ notifs/ hooks.
 *
 * The compute fn runs exactly once on first effect. Return null to skip,
 * a Notification to fire one, or an array to fire several. Sync or async.
 * Rejections are routed to logError.
 */
// 启动通知基座：挂载时跑一次 compute，把结果送进通知系统。
// 封装了 10+ 个 notifs/ hook 各自手写的远程门控与一次性 ref，
// 支持同步/异步返回，异常统一走 logError。
export function useStartupNotification(
// compute 只在首次 effect 执行；返回 null 跳过。
  compute: () => Result | Promise<Result>,
): void {
  const { addNotification } = useNotifications()
  const hasRunRef = useRef(false)
  const computeRef = useRef(compute)
  computeRef.current = compute
// computeRef 每轮同步赋值：effect 依赖里没有 compute，
// 调用方传新函数不会导致重跑（ref 始终指向最新版）。

  useEffect(() => {
    if (getIsRemoteMode() || hasRunRef.current) return
    hasRunRef.current = true

// Promise.resolve 包装：同步函数也走同一 then 链，
// 统一异步时序（compute 抛错与 reject 同路）。
    void Promise.resolve()
      .then(() => computeRef.current())
      .then(result => {
        if (!result) return
// 数组归一化：单条/多条一视同仁。
        for (const n of Array.isArray(result) ? result : [result]) {
          addNotification(n)
        }
      })
// 异常路由 logError，不冒泡到 React 渲染层。
      .catch(logError)
  }, [addNotification])
}
