import { feature } from 'bun:bundle'
import { useEffect, useRef } from 'react'
import {
  type AppState,
  useAppState,
  useAppStateStore,
  useSetAppState,
} from 'src/state/AppState.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import {
  createDisabledBypassPermissionsContext,
  shouldDisableBypassPermissions,
  verifyAutoModeGateAccess,
} from './permissionSetup.js'

// bypass 权限与 auto 模式的开关守卫：按 Statsig 灰度门在首次查询前关掉 bypass 权限或 auto 模式，并在 /login 后重置一次性标志以重新评估。
let bypassPermissionsCheckRan = false
// bypassPermissionsCheckRan 是 bypass 检查的一次性标志。

export async function checkAndDisableBypassPermissionsIfNeeded(
  toolPermissionContext: ToolPermissionContext,
  setAppState: (f: (prev: AppState) => AppState) => void,
// checkAndDisableBypassPermissionsIfNeeded：仅首次、且仅当 bypass 模式可用时，按灰度门结果把 toolPermissionContext 替换成禁用态。
): Promise<void> {
  // Check if bypassPermissions should be disabled based on Statsig gate
  // Do this only once, before the first query, to ensure we have the latest gate value
  if (bypassPermissionsCheckRan) {
    return
  }
  bypassPermissionsCheckRan = true

  if (!toolPermissionContext.isBypassPermissionsModeAvailable) {
    return
  }

  const shouldDisable = await shouldDisableBypassPermissions()
  if (!shouldDisable) {
    return
  }

  setAppState(prev => {
    return {
      ...prev,
      toolPermissionContext: createDisabledBypassPermissionsContext(
        prev.toolPermissionContext,
      ),
    }
  })
}
// checkAndDisableBypassPermissionsIfNeeded 结束。

/**
 * Reset the run-once flag for checkAndDisableBypassPermissionsIfNeeded.
 * Call this after /login so the gate check re-runs with the new org.
 */
export function resetBypassPermissionsCheck(): void {
  bypassPermissionsCheckRan = false
}
// resetBypassPermissionsCheck 在 /login 后把一次性标志复位，让灰度门按新组织重新评估。

export function useKickOffCheckAndDisableBypassPermissionsIfNeeded(): void {
  const toolPermissionContext = useAppState(s => s.toolPermissionContext)
  const setAppState = useSetAppState()

  // Run once, when the component mounts
  useEffect(() => {
    if (getIsRemoteMode()) return
    void checkAndDisableBypassPermissionsIfNeeded(
      toolPermissionContext,
      setAppState,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
// useKickOffCheckAndDisableBypassPermissionsIfNeeded 是 React 钩子，组件挂载时触发一次上述检查（远程模式跳过）。

let autoModeCheckRan = false

export async function checkAndDisableAutoModeIfNeeded(
  toolPermissionContext: ToolPermissionContext,
  setAppState: (f: (prev: AppState) => AppState) => void,
  fastMode?: boolean,
// checkAndDisableAutoModeIfNeeded：在 TRANSCRIPT_CLASSIFIER 特性开启时，按灰度门禁用 auto 模式，并把通知并入应用状态（用当前 context 而非陈旧快照，防中途切模式被回退）。
): Promise<void> {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (autoModeCheckRan) {
      return
    }
    autoModeCheckRan = true

    const { updateContext, notification } = await verifyAutoModeGateAccess(
      toolPermissionContext,
      fastMode,
    )
    setAppState(prev => {
      // Apply the transform to CURRENT context, not the stale snapshot we
      // passed to verifyAutoModeGateAccess. The async GrowthBook await inside
      // can be outrun by a mid-turn shift-tab; spreading a stale context here
      // would revert the user's mode change.
      const nextCtx = updateContext(prev.toolPermissionContext)
      const newState =
        nextCtx === prev.toolPermissionContext
          ? prev
          : { ...prev, toolPermissionContext: nextCtx }
      if (!notification) return newState
      return {
        ...newState,
        notifications: {
          ...newState.notifications,
          queue: [
            ...newState.notifications.queue,
            {
              key: 'auto-mode-gate-notification',
              text: notification,
              color: 'warning' as const,
              priority: 'high' as const,
            },
          ],
        },
      }
    })
  }
}
// checkAndDisableAutoModeIfNeeded 结束。

/**
 * Reset the run-once flag for checkAndDisableAutoModeIfNeeded.
 * Call this after /login so the gate check re-runs with the new org.
 */
export function resetAutoModeGateCheck(): void {
  autoModeCheckRan = false
}
// resetAutoModeGateCheck 复位 auto 模式检查的一次性标志。

export function useKickOffCheckAndDisableAutoModeIfNeeded(): void {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const fastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const store = useAppStateStore()
  const isFirstRunRef = useRef(true)

  // Runs on mount (startup check) AND whenever the model or fast mode changes
  // (kick-out / carousel-restore). Watching both model fields covers /model,
  // Cmd+P picker, /config, and bridge onSetModel paths; fastMode covers
  // /fast on|off for the tengu_auto_mode_config.disableFastMode circuit
  // breaker. The print.ts headless paths are covered by the sync
  // isAutoModeGateEnabled() check.
  useEffect(() => {
    if (getIsRemoteMode()) return
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false
    } else {
      resetAutoModeGateCheck()
    }
    void checkAndDisableAutoModeIfNeeded(
      store.getState().toolPermissionContext,
      setAppState,
      fastMode,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainLoopModel, mainLoopModelForSession, fastMode])
}
// useKickOffCheckAndDisableAutoModeIfNeeded 在挂载及模型/快速模式变化时重跑 auto 模式门检查，覆盖 /model、Cmd+P、/config、bridge 等多条入口。
