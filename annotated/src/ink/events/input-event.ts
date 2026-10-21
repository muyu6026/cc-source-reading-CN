// ═══════════════════════════════════════════════════════════════
//  Key + input：把 ParsedKey 翻成 useInput 认识的样子
// ═══════════════════════════════════════════════════════════════
//
//  parse-keypress.ts 产出的是「物理层」信息：sequence（原始字节）、
//  name（键名）、ctrl/shift/meta/fn 这些修饰位。这一份把它翻译成
//  **两个产物**，因为两套消费方要的东西不一样：
//
//    key   一组布尔标志（upArrow / ctrl / meta …）  → useInput 的第二个参数
//    input 真正要插进文本的字符串                    → useInput 的第一个参数
//
//  难点全在 input：它不是「把 sequence 抄过来」，而是**六个分支层层修正**
//  的结果。每个分支都对应一个真实发生过的泄漏（原始转义序列漏进输入框，
//  用户看见 `[25~` 或者 `[<64;74;16M` 这种字符）。下面逐个标。
import { nonAlphanumericKeys, type ParsedKey } from '../parse-keypress.js'
import { Event } from './event.js'

export type Key = {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageDown: boolean
  pageUp: boolean
  wheelUp: boolean
  wheelDown: boolean
  home: boolean
  end: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  fn: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  super: boolean
}
// 注意 parseKey 返回的是元组 [key, input]，不是对象 —— 调用处解构一次，
// 少一次属性查找。构造函数在第 199 行。

function parseKey(keypress: ParsedKey): [Key, string] {
  const key: Key = {
    upArrow: keypress.name === 'up',
    downArrow: keypress.name === 'down',
    leftArrow: keypress.name === 'left',
    rightArrow: keypress.name === 'right',
    pageDown: keypress.name === 'pagedown',
    pageUp: keypress.name === 'pageup',
    wheelUp: keypress.name === 'wheelup',
    wheelDown: keypress.name === 'wheeldown',
    home: keypress.name === 'home',
    end: keypress.name === 'end',
    return: keypress.name === 'return',
    escape: keypress.name === 'escape',
    fn: keypress.fn,
    ctrl: keypress.ctrl,
    shift: keypress.shift,
    tab: keypress.name === 'tab',
    backspace: keypress.name === 'backspace',
    delete: keypress.name === 'delete',
    // `parseKeypress` parses \u001B\u001B[A (meta + up arrow) as meta = false
    // but with option = true, so we need to take this into account here
    // to avoid breaking changes in Ink.
    // TODO(vadimdemedes): consider removing this in the next major version.
    meta: keypress.meta || keypress.name === 'escape' || keypress.option,
    // Super (Cmd on macOS / Win key) — only arrives via kitty keyboard
    // protocol CSI u sequences. Distinct from meta (Alt/Option) so
    // bindings like cmd+c can be expressed separately from opt+c.
    super: keypress.super,
  }

// ctrl 按住时 sequence 是**控制字节**（ctrl+c → 0x03），name 才是字母 c。
// 非 ctrl 时反过来：sequence 是真正的字符，name 可能是空的。
// 这一行就是「两种情况下哪个字段可信」的开关。
  let input = keypress.ctrl ? keypress.name : keypress.sequence

  // Handle undefined input case
  if (input === undefined) {
    input = ''
  }

  // When ctrl is set, keypress.name for space is the literal word "space".
  // Convert to actual space character for consistency with the CSI u branch
  // (which maps 'space' → ' '). Without this, ctrl+space leaks the literal
  // word "space" into text input.
// ctrl+space 是个特例：终端发来的是 NUL（0x00），parse-keypress 把
// name 定成字符串 "space"。如果不换成真空格，输入框里就会插进
// 五个字母 s-p-a-c-e。
//
// 同一件事在下面 CSI u 分支里又做了一遍（第 123 行 'space' → ' '），
// 因为那条路径根本不经过这里 —— 两个入口各修一次，是重复但必要的。
  if (keypress.ctrl && input === 'space') {
    input = ' '
  }

  // Suppress unrecognized escape sequences that were parsed as function keys
  // (matched by FN_KEY_RE) but have no name in the keyName map.
  // Examples: ESC[25~ (F13/Right Alt on Windows), ESC[26~ (F14), etc.
  // Without this, the ESC prefix is stripped below and the remainder (e.g.,
  // "[25~") leaks into the input as literal text.
// 【上一轮差点把这行判成死代码】
//
// grep `key.code` 是零结果，因为读者写的是 `keypress.code`。
// 它的作用：FN_KEY_RE 把 ESC[25~ 这类序列匹配成「函数键」，但
// keyName 表里没有 25 这一项 → name 空、code 有值 → 就是这里吞掉它。
// 不吞的后果在注释里：ESC 前缀被第 96 行剥掉，剩下的 `[25~` 变成
// 正常文本插进输入框。
//
// 教训：倒查死代码时，grep 的字符串要连**前缀**一起想。
  if (keypress.code && !keypress.name) {
    input = ''
  }

  // Suppress ESC-less SGR mouse fragments. When a heavy React commit blocks
  // the event loop past App's 50ms NORMAL_TIMEOUT flush, a CSI split across
  // stdin chunks gets its buffered ESC flushed as a lone Escape key, and the
  // continuation arrives as a text token with name='' — which falls through
  // all of parseKeypress's ESC-anchored regexes and the nonAlphanumericKeys
  // clear below (name is falsy). The fragment then leaks into the prompt as
  // literal `[<64;74;16M`. This is the same defensive sink as the F13 guard
  // above; the underlying tokenizer-flush race is upstream of this layer.
// 同一个泄漏的另一半，但成因完全不同：不是「不认识的键」，而是
// **序列被劈开了**。
//
// 完整序列是 ESC[<64;74;16M。重渲染阻塞超过 50ms 时，App 的定时器
// 先把缓冲里的 ESC 当成一个孤立的 Esc 键刷出去，续块 `[<64;74;16M`
// 稍后作为普通文本到达 —— 它不匹配任何以 ESC 锚定的正则，name 为空，
// 于是穿过下面所有守卫。
//
// 判据特意只认 SGR 鼠标的形状（`[<数字;数字;数字M或m`），不做通用
// 「方括号开头就当垃圾」——否则用户真的敲 `[<3;4;5M` 会被吞掉。
  if (!keypress.name && /^\[<\d+;\d+;\d+[Mm]/.test(input)) {
    input = ''
  }

  // Strip meta if it's still remaining after `parseKeypress`
  // TODO(vadimdemedes): remove this in the next major version.
// 到这里 ESC 已经没用了（该提取的信息都提取完），剥掉它，
// 免得残留的前缀跟着 input 一起进输入框。
// 这是第 78 / 90 两处守卫都假设过的前提：它们判断的都是**剥之前**的形态。
  if (input.startsWith('\u001B')) {
    input = input.slice(1)
  }

  // Track whether we've already processed this as a special sequence
  // that converted input to the key name (CSI u or application keypad mode).
  // For these, we don't want to clear input with nonAlphanumericKeys check.
  let processedAsSpecialSequence = false

  // Handle CSI u sequences (Kitty keyboard protocol): after stripping ESC,
  // we're left with "[codepoint;modifieru" (e.g., "[98;3u" for Alt+b).
  // Use the parsed key name instead for input handling. Require a digit
  // after [ — real CSI u is always [<digits>…u, and a bare startsWith('[')
  // false-matches X10 mouse at row 85 (Cy = 85+32 = 'u'), leaking the
  // literal text "mouse" into the prompt via processedAsSpecialSequence.
// 【CSI u 分支：Kitty 键盘协议】
//
// 剥掉 ESC 之后残留 `[98;3u` 这种形状（98 = 'b'，3 = Alt）。
// 要用 name 而不是原始串，因为原始串里没有任何可打印内容。
//
//  `^\[\d` 里的「必须跟着数字」是血的教训，注释写了具体坐标：
//  X10 鼠标序列 ESC[M Cb Cx Cy 里，如果 Cy 恰好等于 85，那么
//  85 + 32 = 117 = 'u' —— 整个序列就成了 `[M...u` 的形状，
//  一个宽松的 startsWith('[') + endsWith('u') 会把它当成 CSI u，
//  然后 processedAsSpecialSequence = true 跳过下面的兜底清除，
//  最后把字面量 "mouse" 插进输入框。
  if (/^\[\d/.test(input) && input.endsWith('u')) {
    if (!keypress.name) {
      // Unmapped Kitty functional key (Caps Lock 57358, F13–F35, KP nav,
      // bare modifiers, etc.) — keycodeToName() returned undefined. Swallow
      // so the raw "[57358u" doesn't leak into the prompt. See #38781.
      input = ''
    } else {
// 三个分支里 escape 最容易被漏：它返回空字符串，而读代码的人会问
// 「那 Esc 键不就没了？」—— 没丢，key.escape 是 true（第 40 行），
// 只是不该往文本框里插字符。而这里必须显式给空串，因为
// processedAsSpecialSequence 会跳过下面的 nonAlphanumericKeys 兜底。
      // 'space' → ' '; 'escape' → '' (key.escape carries it;
      // processedAsSpecialSequence bypasses the nonAlphanumericKeys
      // clear below, so we must handle it explicitly here);
      // otherwise use key name.
      input =
        keypress.name === 'space'
          ? ' '
          : keypress.name === 'escape'
            ? ''
            : keypress.name
    }
    processedAsSpecialSequence = true
  }

  // Handle xterm modifyOtherKeys sequences: after stripping ESC, we're left
  // with "[27;modifier;keycode~" (e.g., "[27;3;98~" for Alt+b). Same
  // extraction as CSI u — without this, printable-char keycodes (single-letter
  // names) skip the nonAlphanumericKeys clear and leak "[27;..." as input.
// 【xterm modifyOtherKeys 分支】
//
// 形状 `[27;修饰;键码~`，语义和 CSI u 一样（27 是 ESC 的键码）。
// 为什么要单独一条：终端支持哪个协议由终端决定，App 那边是**两个都发**
// （App.tsx:242-243），谁认哪个谁回哪个。所以解析侧也必须两个都认。
//
// 注释里那句 "Practically untriggerable today" 很实在：xterm 的
// modifyOtherKeys 只发 ASCII 键码，全都已经在 keyName 表里，
// 所以 `!keypress.name` 那一支目前进不去。留着是防终端以后改行为。
  if (input.startsWith('[27;') && input.endsWith('~')) {
    if (!keypress.name) {
      // Unmapped modifyOtherKeys keycode — swallow for consistency with
      // the CSI u handler above. Practically untriggerable today (xterm
      // modifyOtherKeys only sends ASCII keycodes, all mapped), but
      // guards against future terminal behavior.
      input = ''
    } else {
      input =
        keypress.name === 'space'
          ? ' '
          : keypress.name === 'escape'
            ? ''
            : keypress.name
    }
    processedAsSpecialSequence = true
  }

  // Handle application keypad mode sequences: after stripping ESC,
  // we're left with "O<letter>" (e.g., "Op" for numpad 0, "Oy" for numpad 9).
  // Use the parsed key name (the digit character) for input handling.
// 【应用小键盘模式】ESC O p 是数字键盘的 0，ESC O y 是 9。
// 条件是 length === 2 且 name 恰好一个字符 —— 用 name 当数字，
// 因为小键盘发的是字母（p/y），不是数字。
  if (
    input.startsWith('O') &&
    input.length === 2 &&
    keypress.name &&
    keypress.name.length === 1
  ) {
    input = keypress.name
    processedAsSpecialSequence = true
  }

  // Clear input for non-alphanumeric keys (arrows, function keys, etc.)
  // Skip this for CSI u and application keypad mode sequences since
  // those were already converted to their proper input characters.
// 兜底：箭头、功能键、Home/End 这些的 name 在 nonAlphanumericKeys 里，
// 清空 input。**顺序很关键** —— 必须在上面三个特例分支之后，
// 否则 CSI u 的 'space' 会被当成「非字母数字」清掉。
// 这也是为什么要 processedAsSpecialSequence 这个标志：
// 不能只靠「name 在不在表里」判断，因为特例分支已经把 input 改成
// 正确的字符了。
  if (
    !processedAsSpecialSequence &&
    keypress.name &&
    nonAlphanumericKeys.includes(keypress.name)
  ) {
    input = ''
  }

  // Set shift=true for uppercase letters (A-Z)
  // Must check it's actually a letter, not just any char unchanged by toUpperCase
// shift 位的补齐：大写字母必然意味着 shift 被按下了，但终端的
// 原始序列里没有这个信息（就是个 'A'）。这里从结果反推修饰位。
//
// 为什么要三个条件：input 可能是多字符（粘贴）、可能是空串，
// 而 `input[0] >= 'A'` 对空串永远是 false 但类型上要先确认存在。
// 注释里那句 "not just any char unchanged by toUpperCase" 是针对
// 一个更早的写法（用 toUpperCase 比较）—— 那写法会把 '1' 也算进去。
  if (
    input.length === 1 &&
    typeof input[0] === 'string' &&
    input[0] >= 'A' &&
    input[0] <= 'Z'
  ) {
    key.shift = true
  }

  return [key, input]
}
// 事件对象持有三个字段，全是只读快照：解析一次，多处消费。
// key 和 input 都由 parseKey 算好，构造之后不再变。

export class InputEvent extends Event {
  readonly keypress: ParsedKey
  readonly key: Key
  readonly input: string

  constructor(keypress: ParsedKey) {
    super()
    const [key, input] = parseKey(keypress)

    this.keypress = keypress
    this.key = key
    this.input = input
  }
}
