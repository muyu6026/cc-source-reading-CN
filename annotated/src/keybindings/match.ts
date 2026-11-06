import type { Key } from '../ink.js'
import type { ParsedBinding, ParsedKeystroke } from './types.js'

// 只取 Ink 的四种修饰键；fn 故意排除，因为它在终端里很少用也不常配
/**
 * Modifier keys from Ink's Key type that we care about for matching.
 * Note: `fn` from Key is intentionally excluded as it's rarely used and
 * not commonly configurable in terminal applications.
 */
// 修饰键的子类型：从 Ink 的 Key 里挑出 ctrl、shift、meta、super 四个
type InkModifiers = Pick<Key, 'ctrl' | 'shift' | 'meta' | 'super'>

/**
 * Extract modifiers from an Ink Key object.
 * This function ensures we're explicitly extracting the modifiers we care about.
 */
// 显式抽取我们关心的修饰键，避免把无关字段带进来
function getInkModifiers(key: Key): InkModifiers {
  return {
    ctrl: key.ctrl,
    shift: key.shift,
    meta: key.meta,
    super: key.super,
  }
}

// 把 Ink 的布尔标志（escape、return、…）映射成 ParsedKeystroke 用的字符串名
/**
 * Extract the normalized key name from Ink's Key + input.
 * Maps Ink's boolean flags (key.escape, key.return, etc.) to string names
 * that match our ParsedKeystroke.key format.
 */
// 单字符按键直接用原值小写；特殊键各有一行映射
export function getKeyName(input: string, key: Key): string | null {
  if (key.escape) return 'escape'
  if (key.return) return 'enter'
  if (key.tab) return 'tab'
  if (key.backspace) return 'backspace'
  if (key.delete) return 'delete'
  if (key.upArrow) return 'up'
  if (key.downArrow) return 'down'
  if (key.leftArrow) return 'left'
  if (key.rightArrow) return 'right'
  if (key.pageUp) return 'pageup'
  if (key.pageDown) return 'pagedown'
  if (key.wheelUp) return 'wheelup'
  if (key.wheelDown) return 'wheeldown'
  if (key.home) return 'home'
  if (key.end) return 'end'
// 普通字符键：长度为一就转小写，大小写不敏感地匹配
  if (input.length === 1) return input.toLowerCase()
  return null
}

// 修饰键匹配：alt 与 meta 在 Ink 里都走 key.meta，所以配置里的 meta 其实是 alt 的别名
/**
 * Check if all modifiers match between Ink Key and ParsedKeystroke.
 *
 * Alt and Meta: Ink historically set `key.meta` for Alt/Option. A `meta`
 * modifier in config is treated as an alias for `alt` — both match when
 * `key.meta` is true.
 *
 * Super (Cmd/Win): distinct from alt/meta. Only arrives via the kitty
 * keyboard protocol on supporting terminals. A `cmd`/`super` binding will
 * simply never fire on terminals that don't send it.
 */
// 四个修饰键逐一比对，任何一项不等就判不匹配
function modifiersMatch(
  inkMods: InkModifiers,
  target: ParsedKeystroke,
): boolean {
  // Check ctrl modifier
  if (inkMods.ctrl !== target.ctrl) return false

  // Check shift modifier
  if (inkMods.shift !== target.shift) return false

  // Alt and meta both map to key.meta in Ink (terminal limitation)
  // So we check if EITHER alt OR meta is required in target
// 把 alt 与 meta 合并成需要 meta 一个维度，处理终端把 Alt 写成 meta 的历史行为
  const targetNeedsMeta = target.alt || target.meta
  if (inkMods.meta !== targetNeedsMeta) return false

  // Super (cmd/win) is a distinct modifier from alt/meta
  if (inkMods.super !== target.super) return false

  return true
}

// 单键匹配的总入口：先比键名再比修饰键；展示文字按平台给 opt 或 alt
/**
 * Check if a ParsedKeystroke matches the given Ink input + Key.
 *
 * The display text will show platform-appropriate names (opt on macOS, alt elsewhere).
 */
// 先取键名，不等直接返回；再取修饰键交给 modifiersMatch
export function matchesKeystroke(
  input: string,
  key: Key,
  target: ParsedKeystroke,
): boolean {
  const keyName = getKeyName(input, key)
  if (keyName !== target.key) return false

  const inkMods = getInkModifiers(key)

// Ink 按 esc 时会把 key.meta 置真（历史遗留），匹配 escape 本身时要忽略这个 meta
  // QUIRK: Ink sets key.meta=true when escape is pressed (see input-event.ts).
  // This is a legacy behavior from how escape sequences work in terminals.
  // We need to ignore the meta modifier when matching the escape key itself,
  // otherwise bindings like "escape" (without modifiers) would never match.
  if (key.escape) {
    return modifiersMatch({ ...inkMods, meta: false }, target)
  }

  return modifiersMatch(inkMods, target)
}

// 只匹配绑定第一拍的键：用于单键绑定（Phase 1 和弦只取首拍）
/**
 * Check if Ink's Key + input matches a parsed binding's first keystroke.
 * For single-keystroke bindings only (Phase 1).
 */
// 和弦长度不是 1 直接返回 false；取第一拍交给 matchesKeystroke
export function matchesBinding(
  input: string,
  key: Key,
  binding: ParsedBinding,
): boolean {
  if (binding.chord.length !== 1) return false
  const keystroke = binding.chord[0]
  if (!keystroke) return false
  return matchesKeystroke(input, key, keystroke)
}
