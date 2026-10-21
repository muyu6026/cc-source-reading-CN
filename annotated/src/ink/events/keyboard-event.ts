import type { ParsedKey } from '../parse-keypress.js'
import { TerminalEvent } from './terminal-event.js'

/**
 * Keyboard event dispatched through the DOM tree via capture/bubble.
 *
 * Follows browser KeyboardEvent semantics: `key` is the literal character
 * for printable keys ('a', '3', ' ', '/') and a multi-char name for
 * special keys ('down', 'return', 'escape', 'f1'). The idiomatic
 * printable-char check is `e.key.length === 1`.
 */
// 【同一按键，两条派发路径】
//
// App.tsx 的 processKeysInBatch 对每个按键做两件事（第 506-510 行）：
//
//   emitter.emit('input', new InputEvent(item))   → 旧的 useInput 路径
//   dispatchKeyboardEvent(item)                   → 新的 onKeyDown 路径
//
// 于是**一次按键会同时触发两套 handler**。这不是过渡期的疏忽，而是
// 刻意的兼容层：useInput 是公开 API（ink.ts 有导出），不能拆；
// onKeyDown 是 DOM 风格的新接口。两套并存，谁也不知道对方存在。
//
// 代价：同一个组件如果既 useInput 又 onKeyDown，会收到两次。
export class KeyboardEvent extends TerminalEvent {
  readonly key: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly superKey: boolean
  readonly fn: boolean

  constructor(parsedKey: ParsedKey) {
    super('keydown', { bubbles: true, cancelable: true })

    this.key = keyFromParsed(parsedKey)
    this.ctrl = parsedKey.ctrl
    this.shift = parsedKey.shift
    this.meta = parsedKey.meta || parsedKey.option
    this.superKey = parsedKey.super
    this.fn = parsedKey.fn
  }
}
// 三段判断，对应三种键：
//
//   1. ctrl 组合   → 用 name（'c'），browser 里 e.key === 'c' 且 ctrlKey
//   2. 单个可打印  → 用 sequence（'3' 而不是 'Digit3'）
//   3. 其余        → 用 name（'down' / 'return' / 'escape' / 'f1'）
//
// 第 2 段的判据是「长度 1 且码点 >= 0x20 且不是 0x7f」。
// 0x7f 是 DEL 单独特判 —— 它是单字节、不是控制字符区间里的，
// 但它显然不是可打印的。

function keyFromParsed(parsed: ParsedKey): string {
  const seq = parsed.sequence ?? ''
  const name = parsed.name ?? ''

  // Ctrl combos: sequence is a control byte (\x03 for ctrl+c), name is the
  // letter. Browsers report e.key === 'c' with e.ctrlKey === true.
  if (parsed.ctrl) return name

  // Single printable char (space through ~, plus anything above ASCII):
  // use the literal char. Browsers report e.key === '3', not 'Digit3'.
  if (seq.length === 1) {
    const code = seq.charCodeAt(0)
    if (code >= 0x20 && code !== 0x7f) return seq
  }
// 顺带一个约定：**可打印字符的判据是 `e.key.length === 1`**（类注释
// 里写了）。终端这边没有 'ArrowDown' 这种长名字的例外，
// 所有多字符的 key 都是特殊键 —— 比浏览器那边干净，因为
// 「特殊键」的名字是我们自己在 keyName 表里定的。

  // Special keys (arrows, F-keys, return, tab, escape, etc.): sequence is
  // either an escape sequence (\x1b[B) or a control byte (\r, \t), so use
  // the parsed name. Browsers report e.key === 'ArrowDown'.
  return name || seq
// `name || seq` 的兜底：既不是 ctrl、又不是单字符、name 还空着 ——
// 那就是没解析出来的序列。宁可把原始字节当 key 交出去，
// 也不要给一个空字符串（调用方会用 `e.key === 'x'` 比较，
// 空串永远不匹配，问题会表现为「这个键没反应」而不是「收到了怪东西」）。
//
// 这和 parse-keypress 里那句「deletable garbage beats silent loss」
// 是同一条取舍的不同表述。
}
