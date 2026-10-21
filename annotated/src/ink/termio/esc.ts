// ESC 系序列：ESC + 一到两个字符，没有参数区。
//
//   注意入参：`chars` 是**不含 ESC 本身**的剩余部分（parser.ts 380 行
//   `seq.slice(1)` 切掉了 ESC）。所以长度为 1 的 `chars` 表示
//   「ESC 后面紧跟一个字符」，这是最常见的情形。
//
//   整个函数只认 6 个字符，其余全部返回 unknown。这个覆盖率对
//   输出解析来说是够的 —— 我们自己不会发别的 ESC 序列出去。
/**
 * ESC Sequence Parser
 *
 * Handles simple escape sequences: ESC + one or two characters
 */

import type { Action } from './types.js'

/**
 * Parse a simple ESC sequence
 *
 * @param chars - Characters after ESC (not including ESC itself)
 */
// 【三种返回值，语义各不相同】
//
//   Action      认出来了，交给调用方
//   null        认出来了，但不需要做任何事（「已处理，无事发生」）
//   unknown     没认出来（「未处理，可能值得记日志」）
//
//   这两种「空」在 61 行的字符集选择和 56 行的 HTS 上都用到了。
//   混用会导致两个方向的问题：
//     · 该返回 null 的返回了 unknown → 日志里一堆无意义的告警
//     · 该返回 unknown 的返回了 null → 真出问题时什么都看不到
//
//   注意 parser.ts 379 行的处理是不区分的：`action ? [action] : []`。
//   所以在这里，null 和「未知」在行为上一样，区别只在可读性。
export function parseEsc(chars: string): Action | null {
  if (chars.length === 0) return null

  const first = chars[0]!

  // Full reset (RIS)
  if (first === 'c') {
    return { type: 'reset' }
  }

  // Cursor save (DECSC)
  if (first === '7') {
    return { type: 'cursor', action: { type: 'save' } }
  }

  // Cursor restore (DECRC)
  if (first === '8') {
    return { type: 'cursor', action: { type: 'restore' } }
  }

// IND（Index）：光标下移一行。语义等价于 LF，但**不回到行首**。
//
//   有的程序用它代替换行，因为 LF 在有些终端里会顺带做 CR。
//   还有一个 ESC M（83 行的 RI）是它的反向 —— 上移一行。
//
//   ESC D / ESC M 这一对是「滚动区域内的行移动」，和 CSI A / CSI B
//   （光标上/下移，不滚动）语义不同。输出解析里我们只关心坐标变了，
//   所以两者都归成 move。
  // Index - move cursor down (IND)
  if (first === 'D') {
    return {
      type: 'cursor',
      action: { type: 'move', direction: 'down', count: 1 },
    }
  }

  // Reverse index - move cursor up (RI)
  if (first === 'M') {
    return {
      type: 'cursor',
      action: { type: 'move', direction: 'up', count: 1 },
    }
  }

  // Next line (NEL)
  if (first === 'E') {
    return { type: 'cursor', action: { type: 'nextLine', count: 1 } }
  }

  // Horizontal tab set (HTS)
// 【HTS 返回 null，不是因为它无害，而是因为我们不处理制表位】
//
//   HTS = 在当前位置设一个制表位。设了之后 HT（0x09）会跳到那里。
//   这个程序自己不用制表位（tabstops.ts 是「按 8 列固定间隔展开」，
//   与终端设的制表位无关），所以终端设了也白设。
//
//   但这里有个微妙的错位：终端里的制表位是**状态**，我们的 tabstops.ts
//   假设的是固定 8 列。如果外部程序设了奇怪的制表位、又把光标交给我们的
//   TUI，两边对 tab 的理解就会分叉。实际不会发生，因为整屏都由我们重画。
  if (first === 'H') {
    return null // Tab stop, not commonly needed
  }

// 【字符集选择被静默忽略 —— 这是一处真实的能力缺口】
//
//   ESC ( 0  切到 DEC 特殊图形字符集：此时字母 q 画成横线、x 画成竖线
//   ESC ( B  切回 ASCII
//
//   这是 VT100 时代画边框的方式（现在都改用 Unicode 制表符了）。
//   忽略它的后果：如果有人把 `ESC ( 0` + `qqq` 这段文本交给 <Ansi>
//   渲染，会显示成三个字母 q，而不是三条横线。
//
//   为什么可以不管：这个程序的所有输出都是自己生成的，用的是
//   render-border.ts 里的 Unicode 制表符。外部 ANSI 文本只可能来自
//   工具输出，而那些工具早就不用 DEC 图形字符了。
//
//   判据是「输入来自哪里」，不是「这个序列重不重要」。
  // Charset selection (ESC ( X, ESC ) X, etc.) - silently ignore
  if ('()'.includes(first) && chars.length >= 2) {
    return null
  }

// 兜底：把原始序列塞进 unknown，`sequence` 里带完整的 ESC。
//
//   这里拼的是 `ESC + chars`，而 chars 本身已经是「ESC 之后的部分」，
//   所以结果是原文。这类 unknown 在 Ansi.tsx 里会被直接丢弃（它只处理
//   text / link 两种 action），等于静默吞掉。
//
//   对渲染来说这是对的 —— 不认识的序列本来就不该有可见效果。
//   但如果哪天要排查「为什么某个控制序列没生效」，得从这里往回找。
  // Unknown
  return { type: 'unknown', sequence: `\x1b${chars}` }
}
