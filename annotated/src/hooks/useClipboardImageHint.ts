import { useEffect, useRef } from 'react'
import { useNotifications } from '../context/notifications.js'
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js'
import { hasImageInClipboard } from '../utils/imagePaste.js'

const NOTIFICATION_KEY = 'clipboard-image-hint'
// Small debounce to batch rapid focus changes
const FOCUS_CHECK_DEBOUNCE_MS = 1000
// Don't show the hint more than once per this interval
const HINT_COOLDOWN_MS = 30000
// 三个常量：通知 key 固定为 clipboard-image-hint；FOCUS_CHECK_DEBOUNCE_MS=1s 防抖快速焦点变化；HINT_COOLDOWN_MS=30s 冷却防 spam。

/**
 * Hook that shows a notification when the terminal regains focus
 * and the clipboard contains an image.
 *
 * @param isFocused - Whether the terminal is currently focused
 * @param enabled - Whether image paste is enabled (onImagePaste is defined)
 */
// 块注释：终端重新获得焦点且剪贴板含图片时显示提示；isFocused 当前聚焦态，enabled 即 image paste 开（onImagePaste 已定义）。
export function useClipboardImageHint(
  isFocused: boolean,
  enabled: boolean,
): void {
// 返回 void，纯副作用；isFocused 变化触发（effect dep），enabled 为 image paste 开关。
  const { addNotification } = useNotifications()
  const lastFocusedRef = useRef(isFocused)
  const lastHintTimeRef = useRef(0)
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Only trigger on focus regain (was unfocused, now focused)
    const wasFocused = lastFocusedRef.current
    lastFocusedRef.current = isFocused

    if (!enabled || !isFocused || wasFocused) {
      return
    }
// 仅 unfocused→focused 转变触发：lastFocusedRef 跟踪上次态，wasFocused 即当前聚焦则 return（避免重复或失焦触发）。

    // Clear any pending check
    if (checkTimeoutRef.current) {
      clearTimeout(checkTimeoutRef.current)
    }

    // Small debounce to batch rapid focus changes
    checkTimeoutRef.current = setTimeout(
      async (checkTimeoutRef, lastHintTimeRef, addNotification) => {
        checkTimeoutRef.current = null

        // Check cooldown to avoid spamming the user
        const now = Date.now()
        if (now - lastHintTimeRef.current < HINT_COOLDOWN_MS) {
          return
        }

        // Check if clipboard has an image (async osascript call)
        if (await hasImageInClipboard()) {
          lastHintTimeRef.current = now
          addNotification({
            key: NOTIFICATION_KEY,
            text: `Image in clipboard · ${getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v')} to paste`,
            priority: 'immediate',
            timeoutMs: 8000,
          })
        }
      },
      FOCUS_CHECK_DEBOUNCE_MS,
      checkTimeoutRef,
      lastHintTimeRef,
      addNotification,
    )
// 1s 防抖批处理快速焦点变化；冷却 30s 防 spam；hasImageInClipboard（async osascript 调用）命中则发 8s 提示（含 getShortcutDisplay 拼出的 paste 快捷键）。

    return () => {
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current)
        checkTimeoutRef.current = null
      }
    }
  }, [isFocused, enabled, addNotification])
}
