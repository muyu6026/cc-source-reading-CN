// 本文件封装 macOS 原生修饰键检测模块 modifiers-napi 的加载与调用，提供预热与同步查询接口，且仅在 darwin 平台生效。
export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

let prewarmed = false

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
// prewarmModifiers：提前加载原生模块以避免首次使用时的延迟。非 darwin 平台或已预热则直接返回；加载失败静默忽略。
export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  // Load module in background
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prewarm } = require('modifiers-napi') as { prewarm: () => void }
    prewarm()
  } catch {
    // Ignore errors during prewarm
  }
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 */
// isModifierPressed：同步查询某个修饰键（shift / command / control / option）当前是否被按住。非 darwin 平台直接返回 false；通过动态 require 避免顶层加载原生模块。
export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  // Dynamic import to avoid loading native module at top level
  const { isModifierPressed: nativeIsModifierPressed } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('modifiers-napi') as { isModifierPressed: (m: string) => boolean }
  return nativeIsModifierPressed(modifier)
}
