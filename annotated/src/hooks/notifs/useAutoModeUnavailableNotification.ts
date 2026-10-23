import { feature } from 'bun:bundle'
import { useEffect, useRef } from 'react'
import { useNotifications } from 'src/context/notifications.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { useAppState } from '../../state/AppState.js'
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js'
import {
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
} from '../../utils/permissions/permissionSetup.js'
import { hasAutoModeOptIn } from '../../utils/settings/settings.js'

/**
 * Shows a one-shot notification when the shift-tab carousel wraps past where
 * auto mode would have been. Covers all reasons (settings, circuit-breaker,
 * org-allowlist). The startup case (defaultMode: auto silently downgraded) is
 * handled by verifyAutoModeGateAccess → checkAndDisableAutoModeIfNeeded.
 */
// shift-tab 权限轮播从非 auto 模式绕回 default、且 auto 不可用
// （设置禁用/熔断/组织白名单）时，一次性提示原因。
// 启动时 defaultMode: auto 被静默降级的情况不归这里管
// （走 verifyAutoModeGateAccess → checkAndDisableAutoModeIfNeeded）。
export function useAutoModeUnavailableNotification(): void {
// 依赖 prevModeRef 做「上一次是什么模式」的跨渲染记忆，
// 才能识别「轮播绕了一圈回来」这个动作。
  const { addNotification } = useNotifications()
  const mode = useAppState(s => s.toolPermissionContext.mode)
  const isAutoModeAvailable = useAppState(
    s => s.toolPermissionContext.isAutoModeAvailable,
  )
  const shownRef = useRef(false)
  const prevModeRef = useRef<PermissionMode>(mode)
// prevModeRef 初值取当前 mode——首帧不误判为「切换过」。

  useEffect(() => {
    const prevMode = prevModeRef.current
    prevModeRef.current = mode

// feature() 是编译期常量条件：没开 TRANSCRIPT_CLASSIFIER
// 的构建里这段代码整块消失（与恒假条件不同，这是有意的死代码消除）。
    if (!feature('TRANSCRIPT_CLASSIFIER')) return
    if (getIsRemoteMode()) return
    if (shownRef.current) return

// 四条件同时满足才算「绕过了 auto 槽位」：
// 落到 default + 上次不在 default + 上次也不在 auto
// + auto 当前不可用 + 用户主动开过 auto（opt-in）。
    const wrappedPastAutoSlot =
      mode === 'default' &&
      prevMode !== 'default' &&
      prevMode !== 'auto' &&
      !isAutoModeAvailable &&
      hasAutoModeOptIn()

    if (!wrappedPastAutoSlot) return

    const reason = getAutoModeUnavailableReason()
    if (!reason) return

// shownRef 一次性闸门：整个会话只提醒一次，
// 不跟着用户反复 shift-tab 刷屏。
    shownRef.current = true
    addNotification({
      key: 'auto-mode-unavailable',
      text: getAutoModeUnavailableNotification(reason),
      color: 'warning',
      priority: 'medium',
    })
  }, [mode, isAutoModeAvailable, addNotification])
}
