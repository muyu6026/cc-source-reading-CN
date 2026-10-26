import { useMemo } from 'react'
import { useAppState } from '../state/AppState.js'
import {
  hasVoiceAuth,
  isVoiceGrowthBookEnabled,
} from '../voice/voiceModeEnabled.js'

/**
 * Combines user intent (settings.voiceEnabled) with auth + GB kill-switch.
 * Only the auth half is memoized on authVersion — it's the expensive one
 * (cold getClaudeAIOAuthTokens memoize → sync `security` spawn, ~60ms/call,
 * ~180ms total in profile v5 when token refresh cleared the cache mid-session).
 * GB is a cheap cached-map lookup and stays outside the memo so a mid-session
 * kill-switch flip still takes effect on the next render.
 *
 * authVersion bumps on /login only. Background token refresh leaves it alone
 * (user is still authed), so the auth memo stays correct without re-eval.
 */
// 综合「用户开关 + 鉴权 + GB kill-switch」三者决定语音是否可用。
export function useVoiceEnabled(): boolean {
  const userIntent = useAppState(s => s.settings.voiceEnabled === true)
  const authVersion = useAppState(s => s.authVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authed = useMemo(hasVoiceAuth, [authVersion])
// 只把贵的鉴权半（冷启动 sync security spawn ~60ms）memo 在 authVersion 上；GB 是廉价缓存查，留在 memo 外以便中途翻转即时生效。
  return userIntent && authed && isVoiceGrowthBookEnabled()
// 三者取与：用户想开 + 已鉴权 + GB 未关。authVersion 仅 /login 时 bump，后台刷新不动它，memo 才保持正确。
}
