import { getPlatform } from '../utils/platform.js'

/**
 * Shortcuts that are typically intercepted by the OS, terminal, or shell
 * and will likely never reach the application.
 */
export type ReservedShortcut = {
  key: string
  reason: string
  severity: 'error' | 'warning'
}

/**
 * Shortcuts that cannot be rebound - they are hardcoded in Claude Code.
 */
// 三条不可改绑的键都是硬编码在主流程里的：列出来是为了在用户尝试改绑时给出准确原因，而不是静默忽略
export const NON_REBINDABLE: ReservedShortcut[] = [
  {
    key: 'ctrl+c',
    reason: 'Cannot be rebound - used for interrupt/exit (hardcoded)',
    severity: 'error',
  },
// 回车与换行在终端里是同一个字节：这条不是产品选择，是终端协议的限制
  {
    key: 'ctrl+d',
    reason: 'Cannot be rebound - used for exit (hardcoded)',
    severity: 'error',
  },
  {
    key: 'ctrl+m',
    reason:
      'Cannot be rebound - identical to Enter in terminals (both send CR)',
    severity: 'error',
  },
]

/**
 * Terminal control shortcuts that are intercepted by the terminal/OS.
 * These will likely never reach the application.
 *
 * Note: ctrl+s (XOFF) and ctrl+q (XON) are NOT included here because:
 * - Most modern terminals disable flow control by default
 * - We use ctrl+s for the stash feature
 */
// 终端控制键单独一张表：它们是被终端截走的，不是我们硬编码的，所以要分开说明
export const TERMINAL_RESERVED: ReservedShortcut[] = [
  {
    key: 'ctrl+z',
    reason: 'Unix process suspend (SIGTSTP)',
    severity: 'warning',
  },
  {
// 反斜杠在键名里也是转义字符：这条能写进配置就算幸存，实际能不能收到要看终端
    key: 'ctrl+\\',
    reason: 'Terminal quit signal (SIGQUIT)',
    severity: 'error',
  },
]

/**
 * macOS-specific shortcuts that the OS intercepts.
 */
// 这一组全是系统级快捷键：应用层根本收不到，列出来是为了让用户别白试
export const MACOS_RESERVED: ReservedShortcut[] = [
  { key: 'cmd+c', reason: 'macOS system copy', severity: 'error' },
  { key: 'cmd+v', reason: 'macOS system paste', severity: 'error' },
  { key: 'cmd+x', reason: 'macOS system cut', severity: 'error' },
  { key: 'cmd+q', reason: 'macOS quit application', severity: 'error' },
  { key: 'cmd+w', reason: 'macOS close window/tab', severity: 'error' },
  { key: 'cmd+tab', reason: 'macOS app switcher', severity: 'error' },
  { key: 'cmd+space', reason: 'macOS Spotlight', severity: 'error' },
]

/**
 * Get all reserved shortcuts for the current platform.
 * Includes non-rebindable shortcuts and terminal-reserved shortcuts.
 */
// 顺序决定优先级：不可改绑的排最前，界面报冲突时先报最严重的那条
export function getReservedShortcuts(): ReservedShortcut[] {
  const platform = getPlatform()
  // Non-rebindable shortcuts first (highest priority)
// 先合并两张通用表再按平台追加：平台专属那组只影响当前平台
  const reserved = [...NON_REBINDABLE, ...TERMINAL_RESERVED]

  if (platform === 'macos') {
    reserved.push(...MACOS_RESERVED)
  }

  return reserved
}

// 归一化的目的是比较而不是显示：两种写法不同但语义相同的键要让冲突检测认成同一个
/**
 * Normalize a key string for comparison (lowercase, sorted modifiers).
 * Chords (space-separated steps like "ctrl+x ctrl+b") are normalized
 * per-step — splitting on '+' first would mangle "x ctrl" into a mainKey
 * overwritten by the next step, collapsing the chord into its last key.
 */
// 先按空白切分再逐段归一化：组合键的每一段各自处理，顺序不能颠倒
export function normalizeKeyForComparison(key: string): string {
  return key.trim().split(/\s+/).map(normalizeStep).join(' ')
}

// 单段只分修饰键与主键两类：除最后出现的那个，其余都当修饰键
function normalizeStep(step: string): string {
  const parts = step.split('+')
  const modifiers: string[] = []
  let mainKey = ''

  for (const part of parts) {
    const lower = part.trim().toLowerCase()
// 别名表在循环里现查：加一个别名不用改两处
    if (
      [
        'ctrl',
        'control',
        'alt',
        'opt',
        'option',
        'meta',
        'cmd',
        'command',
        'shift',
      ].includes(lower)
    ) {
      // Normalize modifier names
// 三个别名各归一到规范写法：界面与配置文件里都可能出现任一写法
      if (lower === 'control') modifiers.push('ctrl')
      else if (lower === 'option' || lower === 'opt') modifiers.push('alt')
      else if (lower === 'command' || lower === 'cmd') modifiers.push('cmd')
      else modifiers.push(lower)
    } else {
// 最后一个非修饰键才是主键：允许修饰键与主键混着写
      mainKey = lower
    }
  }

// 排序后再拼：两种顺序写的是同一个键，不排序就永远比不相等
  modifiers.sort()
  return [...modifiers, mainKey].join('+')
}
