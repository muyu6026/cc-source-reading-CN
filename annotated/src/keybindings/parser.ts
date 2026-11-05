import type {
// 模块：键位字符串解析——把 `ctrl+shift+k` 这类输入翻译成结构化的按键描述。
  Chord,
  KeybindingBlock,
  ParsedBinding,
  ParsedKeystroke,
} from './types.js'

/**
 * Parse a keystroke string like "ctrl+shift+k" into a ParsedKeystroke.
 * Supports various modifier aliases (ctrl/control, alt/opt/option/meta,
 * cmd/command/super/win).
 */
// `parseKeystroke`：把单个按键串拆成含修饰键标志的结构体，支持多种别名（ctrl/control、alt/opt、cmd/command 等）。
export function parseKeystroke(input: string): ParsedKeystroke {
  const parts = input.split('+')
  const keystroke: ParsedKeystroke = {
    key: '',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    super: false,
  }
  for (const part of parts) {
    const lower = part.toLowerCase()
    switch (lower) {
      case 'ctrl':
      case 'control':
        keystroke.ctrl = true
        break
      case 'alt':
      case 'opt':
      case 'option':
        keystroke.alt = true
        break
      case 'shift':
        keystroke.shift = true
        break
      case 'meta':
        keystroke.meta = true
        break
      case 'cmd':
      case 'command':
      case 'super':
      case 'win':
        keystroke.super = true
        break
      case 'esc':
        keystroke.key = 'escape'
        break
      case 'return':
        keystroke.key = 'enter'
        break
      case 'space':
        keystroke.key = ' '
        break
      case '↑':
        keystroke.key = 'up'
        break
      case '↓':
        keystroke.key = 'down'
        break
      case '←':
        keystroke.key = 'left'
        break
      case '→':
        keystroke.key = 'right'
        break
      default:
        keystroke.key = lower
        break
    }
  }

  return keystroke
}

/**
 * Parse a chord string like "ctrl+k ctrl+s" into an array of ParsedKeystrokes.
 */
// `parseChord`：把由空格分隔的多个按键串解析成按键序列（和弦）。
export function parseChord(input: string): Chord {
  // A lone space character IS the space key binding, not a separator
// 特例：单独的空格字符本身就是空格键绑定，而不是分隔符。
  if (input === ' ') return [parseKeystroke('space')]
  return input.trim().split(/\s+/).map(parseKeystroke)
}

/**
 * Convert a ParsedKeystroke to its canonical string representation for display.
 */
// `keystrokeToString`：把结构化按键转回规范字符串用于展示。
export function keystrokeToString(ks: ParsedKeystroke): string {
  const parts: string[] = []
  if (ks.ctrl) parts.push('ctrl')
  if (ks.alt) parts.push('alt')
  if (ks.shift) parts.push('shift')
  if (ks.meta) parts.push('meta')
  if (ks.super) parts.push('cmd')
  // Use readable names for display
  const displayKey = keyToDisplayName(ks.key)
  parts.push(displayKey)
  return parts.join('+')
}

/**
 * Map internal key names to human-readable display names.
 */
// `keyToDisplayName`：把内部键名映射成人类可读的展示名（如 `up` 转成上箭头）。
function keyToDisplayName(key: string): string {
  switch (key) {
    case 'escape':
      return 'Esc'
    case ' ':
      return 'Space'
    case 'tab':
      return 'tab'
    case 'enter':
      return 'Enter'
    case 'backspace':
      return 'Backspace'
    case 'delete':
      return 'Delete'
    case 'up':
      return '↑'
    case 'down':
      return '↓'
    case 'left':
      return '←'
    case 'right':
      return '→'
    case 'pageup':
      return 'PageUp'
    case 'pagedown':
      return 'PageDown'
    case 'home':
      return 'Home'
    case 'end':
      return 'End'
    default:
      return key
  }
}

/**
 * Convert a Chord to its canonical string representation for display.
 */
// `chordToString`：把整个和弦转成展示字符串。
export function chordToString(chord: Chord): string {
  return chord.map(keystrokeToString).join(' ')
}

/**
 * Display platform type - a subset of Platform that we care about for display.
 * WSL and unknown are treated as linux for display purposes.
 */
type DisplayPlatform = 'macos' | 'windows' | 'linux' | 'wsl' | 'unknown'

/**
 * Convert a ParsedKeystroke to a platform-appropriate display string.
 * Uses "opt" for alt on macOS, "alt" elsewhere.
 */
// `keystrokeToDisplayString`：按平台生成展示字符串，macOS 用 opt、其余用 alt。
export function keystrokeToDisplayString(
  ks: ParsedKeystroke,
  platform: DisplayPlatform = 'linux',
): string {
  const parts: string[] = []
  if (ks.ctrl) parts.push('ctrl')
  // Alt/meta are equivalent in terminals, show platform-appropriate name
  if (ks.alt || ks.meta) {
    // Only macOS uses "opt", all other platforms use "alt"
    parts.push(platform === 'macos' ? 'opt' : 'alt')
  }
  if (ks.shift) parts.push('shift')
  if (ks.super) {
    parts.push(platform === 'macos' ? 'cmd' : 'super')
  }
  // Use readable names for display
  const displayKey = keyToDisplayName(ks.key)
  parts.push(displayKey)
  return parts.join('+')
}

/**
 * Convert a Chord to a platform-appropriate display string.
 */
// `chordToDisplayString`：按平台把和弦转成展示字符串。
export function chordToDisplayString(
  chord: Chord,
  platform: DisplayPlatform = 'linux',
): string {
  return chord.map(ks => keystrokeToDisplayString(ks, platform)).join(' ')
}

/**
 * Parse keybinding blocks (from JSON config) into a flat list of ParsedBindings.
 */
// `parseBindings`：把配置里的键位块展开成扁平的绑定列表（每条含和弦、动作、上下文）。
export function parseBindings(blocks: KeybindingBlock[]): ParsedBinding[] {
  const bindings: ParsedBinding[] = []
  for (const block of blocks) {
    for (const [key, action] of Object.entries(block.bindings)) {
      bindings.push({
        chord: parseChord(key),
        action,
        context: block.context,
      })
    }
  }
  return bindings
}
