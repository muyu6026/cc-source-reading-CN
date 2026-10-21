// ═══════════════════════════════════════════════════════════════
//  输入侧：字节 → 结构化事件
// ═══════════════════════════════════════════════════════════════
//
//   `src/ink/termio/` 那一套解析器有两个消费者，方向相反：
//     · 输出侧：`Ansi.tsx` —— 别人的 ANSI 字符串 → 我们的组件树（解析给别人看）
//     · 输入侧：这个文件 —— 用户按的键 → 结构化事件（解析给自己用）
//
//   两边的字节是一样的，语义不同：`ESC [ M` 在输出流里是「删行」（DL），
//   在输入流里是「X10 鼠标事件」。所以 `createTokenizer` 有个 `x10Mouse`
//   开关，而**全仓库只有本文件传 true**（第 221 行）。
//
//   这一层的完整管线是三段，缺一段都不行：
//
//     stdin 字节
//       ↓  termio/tokenize.ts   只切边界：哪一段是序列、哪一段是文本
//       ↓  本文件逐 token 分类
//       ├→ 终端应答（DECRPM / DA1 / OSC 回包）→ querier 去兑现 promise
//       ├→ 鼠标（SGR / X10）→ 选区或滚轮
//       └→ 其余 → parseKeypress → ParsedKey（名字 + 修饰键）
//
//   【为什么必须先切边界再解释】
//     `ESC` 这个字节有歧义：它是「用户按了 Esc 键」，还是「一个序列的开头」，
//     取决于**后面还有没有字节**（而且可能还没到 —— 分块读 stdin 时序列会被
//     切成两半）。能回答这个问题的只有 tokenizer，因为它有「不完整就缓冲」
//     的能力。所以解释层永远拿到的是一段**完整**的序列。
//
//     兜底在 `App.tsx`：50ms 还没等到续块，就当成真的 Esc 冲出去
//     （`flushIncomplete`）。这个 50ms 是整条输入链唯一的时间假设，
//     也是下面第 262 行那段「孤儿鼠标尾巴」产生的原因。
/**
 * Keyboard input parser - converts terminal input to key events
 *
 * Uses the termio tokenizer for escape sequence boundary detection,
 * then interprets sequences as keypresses.
 */
import { Buffer } from 'buffer'
import { PASTE_END, PASTE_START } from './termio/csi.js'
import { createTokenizer, type Tokenizer } from './termio/tokenize.js'

// 【两个「祖先级」正则：从 node 生态的 keypress 解析器一路继承下来】
//
//   这两个是这份文件里唯一没有重写过的东西，形态（ESC 锚定 + 字符类）
//   和十年前的 node `keypress` 包几乎一样。原因很实际：
//   **终端的按键编码本来就是历史沉积**，没有一代编码能覆盖全部，
//   所以解析器也只能一层层叠加。
//
//   叠加顺序就是优先级：先认新协议（CSI u），再认特例（modifyOtherKeys），
//   最后才是这两条老正则。谁先匹配谁说话。
// eslint-disable-next-line no-control-regex
const META_KEY_CODE_RE = /^(?:\x1b)([a-zA-Z0-9])$/

// eslint-disable-next-line no-control-regex
const FN_KEY_RE =
  // eslint-disable-next-line no-control-regex
  /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/

// 【三条并存的键盘协议，不是三个 bug】
//
//   传统编码有个硬限制：**修饰键只能靠字节本身表达**。
//   Ctrl+A 是 0x01、Ctrl+Z 是 0x1a，一个字节一个含义 —— 于是到 Ctrl+Enter、
//   Ctrl+Shift+A 这种就没法表达了（没有可分配的字节了）。
//
//   补丁修了两轮：
//     · xterm `modifyOtherKeys`（第 31 行）—— 复用 CSI 27 这个编号，
//       把 modifier 和 keycode 塞进参数里。参数顺序是 modifier 在前。
//     · kitty `CSI u`（本行下面）—— 重新设计了整个编码，参数顺序反过来
//       （keycode 在前），还多了「事件类型」「关联文本」等字段。
//
//   两条协议同时存在，所以解析器得两个都认，而且**两条的参数顺序相反** ——
//   这是这一层最容易看错的地方。
// CSI u (kitty keyboard protocol): ESC [ codepoint [; modifier] u
// Example: ESC[13;2u = Shift+Enter, ESC[27u = Escape (no modifiers)
// Modifier is optional - when absent, defaults to 1 (no modifiers)
// eslint-disable-next-line no-control-regex
const CSI_U_RE = /^\x1b\[(\d+)(?:;(\d+))?u/

// xterm modifyOtherKeys: ESC [ 27 ; modifier ; keycode ~
// Example: ESC[27;2;13~ = Shift+Enter. Emitted by Ghostty/tmux/xterm when
// modifyOtherKeys=2 is active or via user keybinds, typically over SSH where
// TERM sniffing misses Ghostty and we never push Kitty keyboard mode.
// Note param order is reversed vs CSI u (modifier first, keycode second).
// eslint-disable-next-line no-control-regex
const MODIFY_OTHER_KEYS_RE = /^\x1b\[27;(\d+);(\d+)~/

// 【同一根 stdin 上跑了两种流量：用户按键 + 终端自己说话】
//
//   查询/应答是异步的：我们发 `CSI ? 2026 $ p` 问「同步输出模式开没开」，
//   终端过一会儿在同一条 stdin 上回 `CSI ? 2026 ; 2 $ y`。
//   如果不把它挑出来，这个回包会被当成一串莫名其妙的按键。
//
//   能挑出来的依据是**语法**，不是时序：没有任何物理键能产生
//   `CSI ? ... c` 或 `CSI ? ... $ y`。所以这些正则可以在任何时候安全匹配，
//   不需要知道「当前有没有在等应答」。
//
//   下面的顺序无所谓（模式互斥），但**存在性**很重要：
//   漏掉一种应答，它就会以「一串乱码按键」的形态出现在输入框里。
// -- Terminal response patterns (inbound sequences from the terminal itself) --
// DECRPM: CSI ? Ps ; Pm $ y  — response to DECRQM (request mode)
// eslint-disable-next-line no-control-regex
const DECRPM_RE = /^\x1b\[\?(\d+);(\d+)\$y$/
// DA1: CSI ? Ps ; ... c  — primary device attributes response
// eslint-disable-next-line no-control-regex
const DA1_RE = /^\x1b\[\?([\d;]*)c$/
// DA2: CSI > Ps ; ... c  — secondary device attributes response
// eslint-disable-next-line no-control-regex
const DA2_RE = /^\x1b\[>([\d;]*)c$/
// Kitty keyboard flags: CSI ? flags u  — response to CSI ? u query
// (private ? marker distinguishes from CSI u key events)
// eslint-disable-next-line no-control-regex
const KITTY_FLAGS_RE = /^\x1b\[\?(\d+)u$/
// DECXCPR cursor position: CSI ? row ; col R
// The ? marker disambiguates from modified F3 keys (Shift+F3 = CSI 1;2 R,
// Ctrl+F3 = CSI 1;5 R, etc.) — plain CSI row;col R is genuinely ambiguous.
// eslint-disable-next-line no-control-regex
const CURSOR_POSITION_RE = /^\x1b\[\?(\d+);(\d+)R$/
// OSC response: OSC code ; data (BEL|ST)
// eslint-disable-next-line no-control-regex
const OSC_RESPONSE_RE = /^\x1b\](\d+);(.*?)(?:\x07|\x1b\\)$/s
// XTVERSION: DCS > | name ST  — terminal name/version string (answer to CSI > 0 q).
// xterm.js replies "xterm.js(X.Y.Z)"; Ghostty, kitty, iTerm2, etc. reply with
// their own name. Unlike TERM_PROGRAM, this survives SSH since the query/reply
// goes through the pty, not the environment.
// eslint-disable-next-line no-control-regex
// XTVERSION 走 DCS 而不是 CSI —— 因为它要回传一个**字符串**（终端名字），
// 而 DCS 天生就是「带负载的串」，正好能装。这也是它比 `TERM_PROGRAM`
// 更可靠的原因：环境变量过不了 SSH，pty 里的查询/应答能过。
const XTVERSION_RE = /^\x1bP>\|(.*?)(?:\x07|\x1b\\)$/s
// SGR 鼠标是唯一**同时**出现在两个方向的编码：输出侧它是「设置鼠标模式」
// 那族的兄弟，输入侧它是点击事件。判定靠 `CSI <` 里那个 `<`（SGR 标记），
// 而 X10 鼠标是 `CSI M` 后面直接跟三个裸字节 —— 后者必须靠 tokenizer 的
// `x10Mouse` 开关才认得出（见第 689 行）。
// SGR mouse event: CSI < button ; col ; row M (press) or m (release)
// Button codes: 64=wheel-up, 65=wheel-down (0x40 | wheel-bit).
// Button 32=left-drag (0x20 | motion-bit). Plain 0/1/2 = left/mid/right click.
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/

// 【空粘贴也要发一个 key】
//
//   直觉写法是「内容为空就不发事件」，但那会让 macOS 上一个功能失效：
//   从剪贴板粘贴**图片**时，终端只发一对空粘贴标记（200~/201~），
//   图片内容根本不过 stdin —— 上层收到「一次空粘贴」才知道要去读剪贴板。
//   所以这里的语义是「一次粘贴动作发生了」，不是一个字符串。
//
//   `name: ''` + `isPasted: true` 就是它的身份证：名字为空但带粘贴标记，
//   下游 `usePasteHandler` 靠 `isPasted` 分流，不靠 name。
function createPasteKey(content: string): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: content,
    raw: content,
    isPasted: true,
  }
}

// DECRPM 的 3 和 4 是「永久设置 / 永久复位」—— 说明它回答的是
// 「这个模式在这个终端上的**态度**」，不只是「当前开关」。
// 对永久态，发 OSC/DECRST 去改是没用的，所以上层拿到 3/4 时不该再尝试切换。
//
// 顺带一个死代码：这个导出全仓库没有任何 import（可以 grep 一遍）。
// 值本身是对的，只是没人消费 —— 上层判断模式状态时直接比了数字字面量。
/** DECRPM status values (response to DECRQM) */
export const DECRPM_STATUS = {
  NOT_RECOGNIZED: 0,
  SET: 1,
  RESET: 2,
  PERMANENTLY_SET: 3,
  PERMANENTLY_RESET: 4,
} as const

/**
 * A response sequence received from the terminal (not a keypress).
 * Emitted in answer to queries like DECRQM, DA1, OSC 11, etc.
 */
// 【七种应答，共同点是「都是我们主动问的」】
//
//   这个性质决定了 `TerminalQuerier` 能用**队列**配对：查询按发送顺序排队，
//   应答按到达顺序兑现。批量查询结束时追加一个 DA1 当哨兵 ——
//   DA1 是所有终端都支持的「你是谁」查询，回得最快，所以拿它当分隔符，
//   一次 flush 之后没被兑现的查询就知道是「终端不理你」。
//
//   `da1` 那条注释里写的 universal sentinel 就是这个意思。
export type TerminalResponse =
  /** DECRPM: answer to DECRQM (request DEC private mode status) */
  | { type: 'decrpm'; mode: number; status: number }
  /** DA1: primary device attributes (used as a universal sentinel) */
  | { type: 'da1'; params: number[] }
  /** DA2: secondary device attributes (terminal version info) */
  | { type: 'da2'; params: number[] }
  /** Kitty keyboard protocol: current flags (answer to CSI ? u) */
  | { type: 'kittyKeyboard'; flags: number }
  /** DSR: cursor position report (answer to CSI 6 n) */
  | { type: 'cursorPosition'; row: number; col: number }
  /** OSC response: generic operating-system-command reply (e.g. OSC 11 bg color) */
  | { type: 'osc'; code: number; data: string }
  /** XTVERSION: terminal name/version string (answer to CSI > 0 q).
   *  Example values: "xterm.js(5.5.0)", "ghostty 1.2.0", "iTerm2 3.6". */
  | { type: 'xtversion'; name: string }

/**
 * Try to recognize a sequence token as a terminal response.
 * Returns null if the sequence is not a known response pattern
 * (i.e. it should be treated as a keypress).
 *
 * These patterns are syntactically distinguishable from keyboard input —
 * no physical key produces CSI ? ... c or CSI ? ... $ y, so they can be
 * safely parsed out of the input stream at any time.
 */
// 返回 null 的语义是「这不是应答，当按键处理」——
// 注意它**不是**「不认识」。不认识的序列在这里一律返回 null，
// 然后继续走鼠标、按键两条路，最后也可能落到「名字为空的 ParsedKey」。
// 那种情况由 `input-event.ts` 统一吞掉（不让原始字节泄漏进输入框）。
function parseTerminalResponse(s: string): TerminalResponse | null {
  // CSI-prefixed responses
  if (s.startsWith('\x1b[')) {
    let m: RegExpExecArray | null

    if ((m = DECRPM_RE.exec(s))) {
      return {
        type: 'decrpm',
        mode: parseInt(m[1]!, 10),
        status: parseInt(m[2]!, 10),
      }
    }

    if ((m = DA1_RE.exec(s))) {
      return { type: 'da1', params: splitNumericParams(m[1]!) }
    }

    if ((m = DA2_RE.exec(s))) {
      return { type: 'da2', params: splitNumericParams(m[1]!) }
    }

    if ((m = KITTY_FLAGS_RE.exec(s))) {
      return { type: 'kittyKeyboard', flags: parseInt(m[1]!, 10) }
    }

    if ((m = CURSOR_POSITION_RE.exec(s))) {
      return {
        type: 'cursorPosition',
        row: parseInt(m[1]!, 10),
        col: parseInt(m[2]!, 10),
      }
    }

    return null
  }

  // OSC responses (e.g. OSC 11 ; rgb:... for bg color query)
  if (s.startsWith('\x1b]')) {
    const m = OSC_RESPONSE_RE.exec(s)
    if (m) {
      return { type: 'osc', code: parseInt(m[1]!, 10), data: m[2]! }
    }
  }

  // DCS responses (e.g. XTVERSION: DCS > | name ST)
  if (s.startsWith('\x1bP')) {
    const m = XTVERSION_RE.exec(s)
    if (m) {
      return { type: 'xtversion', name: m[1]! }
    }
  }

  return null
}

// 先判空再 split：`''.split(';')` 得到的是 `['']` 而不是 `[]`，
// 于是 `parseInt('')` 给 NaN。`DA1_RE` 的参数部分是可空的（`[\d;]*`），
// 所以「没有参数」是常态而不是边界情况。
function splitNumericParams(params: string): number[] {
  if (!params) return []
  return params.split(';').map(p => parseInt(p, 10))
}

// 【解析状态跨 chunk 存活，所以 tokenizer 实例必须放进来】
//
//   这不是为了省一次构造开销，是为了**正确性**：一个序列被 stdin 分块切开时，
//   前半截的状态（走了几个字节、在哪个子状态里）只能存在 tokenizer 里。
//   每次调用都新建一个 tokenizer，被切开的序列就永远拼不回来。
//
//   `_tokenizer` 用下划线是约定「不要从外面碰它」；`incomplete` 则是它的
//   只读快照，给 `App.tsx` 判断「要不要挂 50ms 定时器」用。
//
//   `mode` 只在两态之间切（NORMAL / IN_PASTE），粘贴内容不进 tokenizer 的
//   语义分析 —— 粘贴里的东西全当字面文本，这是 bracketed paste 存在的理由，
//   否则粘贴一段含 `ESC [ 3 ~` 的文本会变成一串删除键。
export type KeyParseState = {
  mode: 'NORMAL' | 'IN_PASTE'
  incomplete: string
  pasteBuffer: string
  // Internal tokenizer instance
  _tokenizer?: Tokenizer
}

export const INITIAL_STATE: KeyParseState = {
  mode: 'NORMAL',
  incomplete: '',
  pasteBuffer: '',
}

// 【0x80 以上的单字节 = 「带 Meta 位」的按键】
//
//   DEC 终端时代 Meta/Alt 是第 8 位：按 Alt+a 发 0xE1 而不是 `ESC a`。
//   所以「单字节且 >= 0x80」要还原成「ESC + (原字节 - 0x80)」。
//
//   两个细节值得留意：
//     · 这段**原地修改了调用方传进来的 Buffer**（`input[0] -= 128`）。
//       副作用不明显，但因为调用方每次读到的都是新 chunk，实际无害。
//     · 单字节 0x80 以上在 UTF-8 里是非法的（合法多字节序列一定有续字节），
//       所以「单字节 >= 0x80」不会误伤正常的 UTF-8 中文 —— 它们必然多字节。
//       换句话说，这个判断靠的正是「UTF-8 的续字节一定存在」这个事实。
function inputToString(input: Buffer | string): string {
  if (Buffer.isBuffer(input)) {
    if (input[0]! > 127 && input[1] === undefined) {
      ;(input[0] as unknown as number) -= 128
      return '\x1b' + String(input)
    } else {
      return String(input)
    }
  } else if (input !== undefined && typeof input !== 'string') {
    return String(input)
  } else if (!input) {
    return ''
  } else {
    return input
  }
}

// 【`input = null` 表示 flush，不是「没有输入」】
//
//   一个参数两种含义：空串是「这次没读到东西」，null 是「别再等了，把
//   缓冲的东西都吐出来」。用 null 而不是加个 bool 参数，好处是调用点读起来
//   像「冲一下」（`processInput(null)`），代价是必须读注释才知道。
//
//   返回 `[items, state]` 而不是写进对象，是因为调用方要把 state 存回
//   `App.keyParseState` —— 函数本身无副作用，除了 tokenizer 内部的游标。
export function parseMultipleKeypresses(
  prevState: KeyParseState,
  input: Buffer | string | null = '',
): [ParsedInput[], KeyParseState] {
  const isFlush = input === null
  const inputString = isFlush ? '' : inputToString(input)

  // Get or create tokenizer
// 全仓库唯一一个 `x10Mouse: true`。同一个 `ESC [ M` 在输出侧是 DL（删行），
// 在输入侧是鼠标 —— 方向决定语义，所以只能由调用方声明。
// tokenizer 的注释里写得很清楚：开错方向的后果不是报错，是**静默吃字符**。
  const tokenizer = prevState._tokenizer ?? createTokenizer({ x10Mouse: true })

  // Tokenize the input
  const tokens = isFlush ? tokenizer.flush() : tokenizer.feed(inputString)

  // Convert tokens to parsed keys, handling paste mode
  const keys: ParsedInput[] = []
  let inPaste = prevState.mode === 'IN_PASTE'
  let pasteBuffer = prevState.pasteBuffer

// 【逐 token 的分类顺序 = 特异性从高到低】
//
//   粘贴标记最特殊（它是「模式开关」而不是事件），
//   然后是终端应答（语法唯一），再是鼠标（有专用的包裹形式），
//   最后剩下的才当按键。
//
//   顺序错了不会崩，会误判：比如先判按键，`CSI ? 2026 ; 2 $ y`
//   就会变成一个名字为空、sequence 很长的「按键」被静默丢弃。
  for (const token of tokens) {
    if (token.type === 'sequence') {
      if (token.value === PASTE_START) {
        inPaste = true
        pasteBuffer = ''
// PASTE_END（CSI 201~）是**唯一**能让 inPaste 变回 false 的地方 ——
// 也就是说，粘贴中途被打断（终端崩溃、ssh 断开）会让状态永久卡在
// IN_PASTE，之后所有按键都被当粘贴内容吞掉。兜底是 flush：
// 第 287 行在 input=null 时把 pasteBuffer 吐出来并复位。
      } else if (token.value === PASTE_END) {
        // Always emit a paste key, even for empty pastes. This allows
        // downstream handlers to detect empty pastes (e.g., for clipboard
        // image handling on macOS). The paste content may be empty string.
        keys.push(createPasteKey(pasteBuffer))
        inPaste = false
        pasteBuffer = ''
      } else if (inPaste) {
        // Sequences inside paste are treated as literal text
        pasteBuffer += token.value
      } else {
// 应答优先于鼠标、鼠标优先于按键。注意 `parseMouseEvent` 返回 null 有**两种**
// 含义：不是 SGR 鼠标，或者是滚轮（滚轮故意留给按键路径，让 keybinding 系统
// 能把它路由给 ScrollBox）。两者在这里不需要区分 —— 都落到 parseKeypress。
        const response = parseTerminalResponse(token.value)
        if (response) {
          keys.push({ kind: 'response', sequence: token.value, response })
        } else {
          const mouse = parseMouseEvent(token.value)
          if (mouse) {
            keys.push(mouse)
          } else {
            keys.push(parseKeypress(token.value))
          }
        }
      }
    } else if (token.type === 'text') {
      if (inPaste) {
        pasteBuffer += token.value
// 【孤立鼠标尾巴：为什么会出现，以及为什么只认滚轮】
//
//   这一整段是真机 bug 的化石，注释已经写了现象和取舍，这里补上机制：
//
//   1) 为什么会断成两截。`App.tsx` 收到不完整序列会挂一个 50ms 定时器；
//      Node 的事件循环里 **timers 阶段先于 poll 阶段**。一次重渲染把循环
//      阻塞超过 50ms 时，续块其实已经躺在缓冲区里了，但定时器先被调度，
//      于是「只有 ESC」被当成 Esc 键冲了出去，剩下的 `[<64;74;16M`
//      在下一轮变成 text token。
//
//   2) 为什么要合成回来而不是丢掉。丢掉的话滚轮事件就没了 ——
//      用户在最需要滚动的时刻（界面正卡着）滚不动。合成回来至少能滚。
//
//   3) 为什么 X10 那条正则把 Cb 槽收窄到 0x60-0x7f。X10 的按钮字节是
//      `0x40 | 修饰 | 32`，滚轮是 0x60/0x61 —— 都在 0x60-0x7f 这一段。
//      如果放宽到 0x20 以上，用户快速输入 `[MAX]` 这种方括号单词、
//      整段一次 read 到达时就会被误判成幽灵点击**并静默丢弃**。
//
//   4) 为什么点击/拖拽不做同样的抢救。因为它们的尾巴长得和普通输入没区别，
//      救错的代价是「吞掉用户真的敲的字」。这里明确选了另一个方向：
//      让点击漏成可见的垃圾（能删掉），而不是让输入静默消失。
//
//   这个「deletable garbage beats silent loss」是本文件里唯一一条
//   写出来的价值判断，值得单独记住 —— 后面遇到取舍时它还会出现。
      } else if (
        /^\[<\d+;\d+;\d+[Mm]$/.test(token.value) ||
        /^\[M[\x60-\x7f][\x20-\uffff]{2}$/.test(token.value)
      ) {
        // Orphaned SGR/X10 mouse tail (fullscreen only — mouse tracking is off
        // otherwise). A heavy render blocked the event loop past App's 50ms
        // flush timer, so the buffered ESC was flushed as a lone Escape and
        // the continuation `[<btn;col;rowM` arrived as text. Re-synthesize
        // with the ESC prefix so the scroll event still fires instead of
        // leaking into the prompt. The spurious Escape is gone; App.tsx's
        // readableLength check prevents it. The X10 Cb slot is narrowed to
        // the wheel range [\x60-\x7f] (0x40|modifiers + 32) — a full [\x20-]
        // range would match typed input like `[MAX]` batched into one read
        // and silently drop it as a phantom click. Click/drag orphans leak
        // as visible garbage instead; deletable garbage beats silent loss.
        const resynthesized = '\x1b' + token.value
        const mouse = parseMouseEvent(resynthesized)
        keys.push(mouse ?? parseKeypress(resynthesized))
      } else {
        keys.push(parseKeypress(token.value))
      }
    }
  }

  // If flushing and still in paste mode, emit what we have
  if (isFlush && inPaste && pasteBuffer) {
    keys.push(createPasteKey(pasteBuffer))
    inPaste = false
    pasteBuffer = ''
  }

  // Build new state
// 注意 `incomplete` 不是自己维护的字符串，而是 `tokenizer.buffer()` ——
// 状态的唯一真相在 tokenizer 里，这里只是取个快照给上层看。
  const newState: KeyParseState = {
    mode: inPaste ? 'IN_PASTE' : 'NORMAL',
    incomplete: tokenizer.buffer(),
    pasteBuffer,
    _tokenizer: tokenizer,
  }

  return [keys, newState]
}

// 【这张表是终端方言史】
//
//   同一次「按 Home 键」，在这里有五种编码：
//     [H / OH / [1~ / [7~ / [7$   —— xterm / application mode / rxvt / rxvt 变体
//   方向键有 [A / OA / [a / Oa 四种（后两种用小写表示 Shift/Ctrl）。
//
//   为什么用扁平对象而不是一堆正则：这张表的键就是「序列去掉 ESC 之后的部分」，
//   查表是 O(1)，而正则要逐条试。60 多个条目全部走一次哈希，比串 60 个分支便宜。
//
//   代价是「表里的名字」和「修饰键」两套知识分开存放：
//   表只给名字，Shift/Ctrl 由下面 `isShiftKey` / `isCtrlKey` 两张小表补
//   （rxvt 的 `[a` 与 `[A` 只能靠大小写区分修饰）。
const keyName: Record<string, string> = {
  /* xterm/gnome ESC O letter */
  OP: 'f1',
  OQ: 'f2',
  OR: 'f3',
  OS: 'f4',
  /* Application keypad mode (numpad digits 0-9) */
  Op: '0',
  Oq: '1',
  Or: '2',
  Os: '3',
  Ot: '4',
  Ou: '5',
  Ov: '6',
  Ow: '7',
  Ox: '8',
  Oy: '9',
  /* Application keypad mode (numpad operators) */
  Oj: '*',
  Ok: '+',
  Ol: ',',
  Om: '-',
  On: '.',
  Oo: '/',
  OM: 'return',
  /* xterm/rxvt ESC [ number ~ */
  '[11~': 'f1',
  '[12~': 'f2',
  '[13~': 'f3',
  '[14~': 'f4',
  /* from Cygwin and used in libuv */
  '[[A': 'f1',
  '[[B': 'f2',
  '[[C': 'f3',
  '[[D': 'f4',
  '[[E': 'f5',
  /* common */
  '[15~': 'f5',
  '[17~': 'f6',
  '[18~': 'f7',
  '[19~': 'f8',
  '[20~': 'f9',
  '[21~': 'f10',
  '[23~': 'f11',
  '[24~': 'f12',
  /* xterm ESC [ letter */
  '[A': 'up',
  '[B': 'down',
  '[C': 'right',
  '[D': 'left',
  '[E': 'clear',
  '[F': 'end',
  '[H': 'home',
  /* xterm/gnome ESC O letter */
  OA: 'up',
  OB: 'down',
  OC: 'right',
  OD: 'left',
  OE: 'clear',
  OF: 'end',
  OH: 'home',
  /* xterm/rxvt ESC [ number ~ */
  '[1~': 'home',
  '[2~': 'insert',
  '[3~': 'delete',
  '[4~': 'end',
  '[5~': 'pageup',
  '[6~': 'pagedown',
  /* putty */
  '[[5~': 'pageup',
  '[[6~': 'pagedown',
  /* rxvt */
  '[7~': 'home',
  '[8~': 'end',
  /* rxvt keys with modifiers */
  '[a': 'up',
  '[b': 'down',
  '[c': 'right',
  '[d': 'left',
  '[e': 'clear',

  '[2$': 'insert',
  '[3$': 'delete',
  '[5$': 'pageup',
  '[6$': 'pagedown',
  '[7$': 'home',
  '[8$': 'end',

  Oa: 'up',
  Ob: 'down',
  Oc: 'right',
  Od: 'left',
  Oe: 'clear',

  '[2^': 'insert',
  '[3^': 'delete',
  '[5^': 'pageup',
  '[6^': 'pagedown',
  '[7^': 'home',
  '[8^': 'end',
  /* misc. */
  '[Z': 'tab',
}

// 【过滤掉单字符的值，不是懒 —— 是必须】
//
//   小键盘数字在应用键盘模式下被编码成 `Op`..`Oy`，解出来是 '0'..'9'；
//   运算符是 '*' '+' '-' 之类。这些都是**应该产生输入**的可打印字符，
//   如果进了这个「非字母数字键」名单，`input-event.ts` 会把输入清空，
//   小键盘就彻底失灵。
//
//   补在末尾的 'escape' / 'backspace' 是另一回事：它们在 `parseKeypress`
//   里是直接赋值（第 708 行起那一串 if），没走这张表，所以展开
//   `Object.values(keyName)` 时漏掉了。漏掉的后果很具体：
//   Ctrl+Esc 经过 kitty 协议时会解出 name='escape'，而 input-event 在
//   ctrl 为真时会把 name 当输入文本 —— 输入框里就出现英文单词「escape」。
export const nonAlphanumericKeys = [
  // Filter out single-character values (digits, operators from numpad) since
  // those are printable characters that should produce input
  ...Object.values(keyName).filter(v => v.length > 1),
  // escape and backspace are assigned directly in parseKeypress (not via the
  // keyName map), so the spread above misses them. Without these, ctrl+escape
  // via Kitty/modifyOtherKeys leaks the literal word "escape" as input text
  // (input-event.ts:58 assigns keypress.name when ctrl is set).
  'escape',
  'backspace',
  'wheelup',
  'wheeldown',
  'mouse',
]

// 两张小表补的是「同一个序列的两种大小写 = 有无修饰」这个方言约定。
// 它们和 `keyName` 是同一份知识的第二份副本（`[a` 在两张表里都出现），
// 改的时候必须同时改 —— 这是扁平表方案的固有代价。
const isShiftKey = (code: string): boolean => {
  return [
    '[a',
    '[b',
    '[c',
    '[d',
    '[e',
    '[2$',
    '[3$',
    '[5$',
    '[6$',
    '[7$',
    '[8$',
    '[Z',
  ].includes(code)
}

const isCtrlKey = (code: string): boolean => {
  return [
    'Oa',
    'Ob',
    'Oc',
    'Od',
    'Oe',
    '[2^',
    '[3^',
    '[5^',
    '[6^',
    '[7^',
    '[8^',
  ].includes(code)
}

// 【modifier 是「1 + 位掩码」，所以要先减 1】
//
//   为什么从 1 开始而不是 0：0 要留给「参数缺省」（`CSI 1 ; A` 里没有 modifier
//   时按 1 处理）。这是 xterm 定下的编码，不是这里的选择。
//
//   `meta` 在本文件里就是 Alt/Option（bit 2），`super` 是 bit 8
//   （macOS 的 Cmd / Windows 键）。传统编码**表达不了 super** ——
//   只有一个字节的空间，早就被 ctrl/alt/shift 占满了。所以 super 能出现，
//   就说明这条序列一定来自 kitty 协议或 modifyOtherKeys。
/**
 * Decode XTerm-style modifier value to individual flags.
 * Modifier encoding: 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (super ? 8 : 0)
 *
 * Note: `meta` here means Alt/Option (bit 2). `super` is a distinct
 * modifier (bit 8, i.e. Cmd on macOS / Win key). Most legacy terminal
 * sequences can't express super — it only arrives via kitty keyboard
 * protocol (CSI u) or xterm modifyOtherKeys.
 */
function decodeModifier(modifier: number): {
  shift: boolean
  meta: boolean
  ctrl: boolean
  super: boolean
} {
  const m = modifier - 1
  return {
    shift: !!(m & 1),
    meta: !!(m & 2),
    ctrl: !!(m & 4),
    super: !!(m & 8),
  }
}

/**
 * Map keycode to key name for modifyOtherKeys/CSI u sequences.
 * Handles both ASCII keycodes and Kitty keyboard protocol functional keys.
 *
 * Numpad codepoints are from Unicode Private Use Area, defined at:
 * https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions
 */
// ASCII 那段用 `toLowerCase()` 是刻意的：CSI u 会把大写字母也送进来
// （`ESC[65;2u` = Shift+A），而项目内部统一用「小写名字 + shift 位」表示，
// 所以这里直接归一化，shift 由 modifier 位表达，不靠大小写。
//
// 57399-57415 是 Kitty 协议给数字键盘分配的 Unicode **私用区**码位 ——
// 传统编码里小键盘是 `Op` 这种字母对，kitty 把它做成了「键码」，
// 于是一张 switch 就能同时覆盖 ASCII 键和功能键。
function keycodeToName(keycode: number): string | undefined {
  switch (keycode) {
    case 9:
      return 'tab'
    case 13:
      return 'return'
    case 27:
      return 'escape'
    case 32:
      return 'space'
    case 127:
      return 'backspace'
    // Kitty keyboard protocol numpad keys (KP_0 through KP_9)
    case 57399:
      return '0'
    case 57400:
      return '1'
    case 57401:
      return '2'
    case 57402:
      return '3'
    case 57403:
      return '4'
    case 57404:
      return '5'
    case 57405:
      return '6'
    case 57406:
      return '7'
    case 57407:
      return '8'
    case 57408:
      return '9'
    case 57409: // KP_DECIMAL
      return '.'
    case 57410: // KP_DIVIDE
      return '/'
    case 57411: // KP_MULTIPLY
      return '*'
    case 57412: // KP_SUBTRACT
      return '-'
    case 57413: // KP_ADD
      return '+'
    case 57414: // KP_ENTER
      return 'return'
    case 57415: // KP_EQUAL
      return '='
    default:
      // Printable ASCII characters
      if (keycode >= 32 && keycode <= 126) {
        return String.fromCharCode(keycode).toLowerCase()
      }
      return undefined
  }
}

// 【ParsedKey 里三个容易搞混的字段】
//
//   name     规范名（'left' / 'return' / 'a'）。**可能是 undefined** ——
//            kitty 协议里没映射的功能键（CapsLock、F13、裸修饰键）就是这种。
//   sequence 原始序列原样带出，给下游「按序列匹配」的绑定用。
//   raw      和 sequence 一开始相同，但**会被清掉**（第 702 行把回车置空）。
//            清掉的用意是：下游拿 raw 判断「还剩下什么原始字节」。
//   code     FN_KEY_RE 匹配成功时拼出来的那段（如 '[1~'）。
//            它不是给读代码的人看的，是给 `input-event.ts` 做**判定依据**的：
//            `code && !name` 表示「像序列、但没有名字」= 不认识的 F 键，
//            该吞掉而不是当文本（否则 ESC[25~ 会把 '[25~' 漏进输入框）。
//
//   所以 code 不是死字段 —— 虽然 grep `key.code` 查不到读者，
//   读者在 `input-event.ts:78` 写的是 `keypress.code`。
export type ParsedKey = {
  kind: 'key'
  fn: boolean
  name: string | undefined
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  super: boolean
  sequence: string | undefined
  raw: string | undefined
  code?: string
  isPasted: boolean
}

/** A terminal response sequence (DECRPM, DA1, OSC reply, etc.) parsed
 *  out of the input stream. Not user input — consumers should dispatch
 *  to a response handler. */
export type ParsedResponse = {
  kind: 'response'
  /** Raw escape sequence bytes, for debugging/logging */
  sequence: string
  response: TerminalResponse
}

/** SGR mouse event with coordinates. Emitted for clicks, drags, and
 *  releases (wheel events remain ParsedKey). col/row are 1-indexed
 *  from the terminal sequence (CSI < btn;col;row M/m). */
export type ParsedMouse = {
  kind: 'mouse'
  /** Raw SGR button code. Low 2 bits = button (0=left,1=mid,2=right),
   *  bit 5 (0x20) = drag/motion, bit 6 (0x40) = wheel. */
  button: number
  /** 'press' for M terminator, 'release' for m terminator */
  action: 'press' | 'release'
  /** 1-indexed column (from terminal) */
  col: number
  /** 1-indexed row (from terminal) */
  row: number
  sequence: string
}

/** Everything that can come out of the input parser: a user keypress/paste,
 *  a mouse click/drag event, or a terminal response to a query we sent. */
// 三种产出物的分野就是「谁处理」：
//   ParsedKey     → 输入框 / keybinding
//   ParsedMouse   → 选区与点击（App.handleMouseEvent）
//   ParsedResponse→ querier（兑现查询 promise，完全不进业务）
//
// 注意滚轮被**故意**排除在 ParsedMouse 之外：它不是「点在某个格子上」，
// 它是滚动意图，应该走 keybinding 系统（ScrollBox 认 'wheelup'/'wheeldown'）。
export type ParsedInput = ParsedKey | ParsedMouse | ParsedResponse

/**
 * Parse an SGR mouse event sequence into a ParsedMouse, or null if not a
 * mouse event or if it's a wheel event (wheel stays as ParsedKey for the
 * keybinding system). Button bit 0x40 = wheel, bit 0x20 = drag/motion.
 */
// 滚轮返回 null 是「不是我的事」，不是「不是鼠标」。
// 于是它继续往下走 `parseKeypress`，在那里被解成 'wheelup' / 'wheeldown'。
function parseMouseEvent(s: string): ParsedMouse | null {
  const match = SGR_MOUSE_RE.exec(s)
  if (!match) return null
  const button = parseInt(match[1]!, 10)
  // Wheel events (bit 6 set, low bits 0/1 for up/down) stay as ParsedKey
  // so the keybinding system can route them to scroll handlers.
  if ((button & 0x40) !== 0) return null
  return {
    kind: 'mouse',
    button,
    action: match[4] === 'M' ? 'press' : 'release',
    col: parseInt(match[2]!, 10),
    row: parseInt(match[3]!, 10),
    sequence: s,
  }
}

// 【这一个函数就是「一条序列 → 一个键」的全部】
//
//   分支顺序 = 协议新旧顺序（从新到旧）：
//     CSI u（kitty） → modifyOtherKeys（xterm 补丁） → SGR/X10 鼠标
//     → 单字节控制字符 → 单字符 → 老正则
//
//   为什么新的必须在前：老正则（FN_KEY_RE）会**部分匹配**新协议的序列，
//   然后把剩下一截当垃圾留下。这不是理论问题 —— 注释里专门写了
//   `ESC[27;...~` 必须在 FN_KEY_RE 之前，就是因为 FN_KEY_RE 只允许
//   两个参数，第三个参数会被漏出去。
function parseKeypress(s: string = ''): ParsedKey {
  let parts

  const key: ParsedKey = {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: s,
    raw: s,
    isPasted: false,
  }

  key.sequence = key.sequence || s || key.name

// 两个坑：
//
//   1) modifier 缺省是 1（无修饰），不是 0 —— 见 `decodeModifier` 的说明。
//      写成 `match[2] ? ... : 0` 会让「没有 modifier」变成「modifier -1」。
//
//   2) **不支持子参数**。kitty 的完整格式是
//      `CSI codepoint:shifted-key ; modifier:event-type u`，
//      带冒号的写法（`ESC[13:13;2u`）匹配不上这个正则，也没有别的分支认它，
//      于是 name 为空、sequence 保留完整字节 —— 最后被 `input-event.ts` 吞掉。
//      表现是「这个键没反应」，好处是至少不会把字节漏进输入框。
//      上游的规避方式是**开启 kitty 协议时不请求子参数**（只请求基础格式）。
  // Handle CSI u (kitty keyboard protocol): ESC [ codepoint [; modifier] u
  // Example: ESC[13;2u = Shift+Enter, ESC[27u = Escape (no modifiers)
  let match: RegExpExecArray | null
  if ((match = CSI_U_RE.exec(s))) {
    const codepoint = parseInt(match[1]!, 10)
    // Modifier defaults to 1 (no modifiers) when not present
    const modifier = match[2] ? parseInt(match[2], 10) : 1
    const mods = decodeModifier(modifier)
    const name = keycodeToName(codepoint)
    return {
      kind: 'key',
      name,
      fn: false,
      ctrl: mods.ctrl,
      meta: mods.meta,
      shift: mods.shift,
      option: false,
      super: mods.super,
      sequence: s,
      raw: s,
      isPasted: false,
    }
  }

// 参数顺序和 CSI u **正好相反**：modifier 在前、keycode 在后。
// 同一个终端可能同时支持两种协议（xterm 补丁 + kitty），所以两个都得认，
// 而且不能靠「参数个数」区分 —— 两者都是两个参数。能区分的只有
// 引导码（CSI 27 ;）和终结符（`~` 对 `u`）。
  // Handle xterm modifyOtherKeys: ESC [ 27 ; modifier ; keycode ~
  // Must run before FN_KEY_RE — FN_KEY_RE only allows 2 params before ~ and
  // would leave the tail as garbage if it partially matched.
  if ((match = MODIFY_OTHER_KEYS_RE.exec(s))) {
    const mods = decodeModifier(parseInt(match[1]!, 10))
    const name = keycodeToName(parseInt(match[2]!, 10))
    return {
      kind: 'key',
      name,
      fn: false,
      ctrl: mods.ctrl,
      meta: mods.meta,
      shift: mods.shift,
      option: false,
      super: mods.super,
      sequence: s,
      raw: s,
      isPasted: false,
    }
  }

// 掩码 0x43 = bit6（滚轮）+ bit1 + bit0（方向），**故意忽略**修饰位
// （Shift=0x04 / Meta=0x08 / Ctrl=0x10）。
//
// 这意味着 Ctrl+滚轮、Shift+滚轮都会被当成普通滚轮。
// 取舍很清楚：修饰滚轮是极少数场景，而「修饰位让滚轮失灵」是很烦的 bug。
// 用掩码而不是相等判断，就是把这个取舍写成代码。
  // SGR mouse wheel events. Click/drag/release events are handled
  // earlier by parseMouseEvent and emitted as ParsedMouse, so they
  // never reach here. Mask with 0x43 (bits 6+1+0) to check wheel-flag
  // + direction while ignoring modifier bits (Shift=0x04, Meta=0x08,
  // Ctrl=0x10) — modified wheel events (e.g. Ctrl+scroll, button=80)
  // should still be recognized as wheelup/wheeldown.
  if ((match = SGR_MOUSE_RE.exec(s))) {
    const button = parseInt(match[1]!, 10)
    if ((button & 0x43) === 0x40) return createNavKey(s, 'wheelup', false)
    if ((button & 0x43) === 0x41) return createNavKey(s, 'wheeldown', false)
    // Shouldn't reach here (parseMouseEvent catches non-wheel) but be safe
    return createNavKey(s, 'mouse', false)
  }

// X10 鼠标是**定长 6 字节**：`ESC [ M` + Cb + Cx + Cy，每个坐标字节都 +32
// 编码（所以最小 33，避开控制字符）。它有两个致命限制，正是 SGR 被发明的原因：
//   · 坐标上限 223（0xFF - 32）—— 宽屏终端右下角的点击直接丢失
//   · 和第 262 行那个 bug 同源：utf8 下两个坐标字节可能拼成一个合法多字节字符，
//     导致长度判断失败（tokenize.ts 里那条 known limitation 说的就是这个）
//
// 非滚轮的 X10 事件在这里被吞成 'mouse'（一个不带坐标的名字）。
// 因为只有 alt-screen 才开鼠标跟踪，而 alt-screen 只需要滚轮。
  // X10 mouse: CSI M + 3 raw bytes (Cb+32, Cx+32, Cy+32). Terminals that
  // ignore DECSET 1006 (SGR) but honor 1000/1002 emit this legacy encoding.
  // Button bits match SGR: 0x40 = wheel, low bit = direction. Non-wheel
  // X10 events (clicks/drags) are swallowed here — we only enable mouse
  // tracking in alt-screen and only need wheel for ScrollBox.
  if (s.length === 6 && s.startsWith('\x1b[M')) {
    const button = s.charCodeAt(3) - 32
    if ((button & 0x43) === 0x40) return createNavKey(s, 'wheelup', false)
    if ((button & 0x43) === 0x41) return createNavKey(s, 'wheeldown', false)
    return createNavKey(s, 'mouse', false)
  }

// 【同一个 Enter 键，两个名字：'return' 和 'enter'】
//
//   终端里 Enter 发 CR（0x0d）还是 LF（0x0a）取决于上下文 ——
//   raw mode 下通常发 CR，某些终端/多路复用器转发 LF。这里没有归一化成
//   一个名字，而是保留两者，**代价是所有消费方都必须两个都认**。
//
//   为什么不归一化：历史行为和用户绑定（比如某些键位把 Ctrl+J 绑成换行）
//   依赖这个区别，归一化会静默改掉既有绑定。
//
//   顺带一处：回车（0x0d）这个分支把 `raw` 置成 undefined，换行（0x0a）分支没有 ——
//   不是笔误，`raw` 的语义就是「还有没有原始字节要交给下游」。
  if (s === '\r') {
    key.raw = undefined
    key.name = 'return'
  } else if (s === '\n') {
    key.name = 'enter'
  } else if (s === '\t') {
    key.name = 'tab'
// 退格有两派：0x08（BS，真·退格）和 0x7f（DEL，大多数终端的退格键）。
// 两种都得认，而且**带不带 ESC 前缀**表示「有没有按 Meta/Alt」——
// 于是 `ESC 0x7f` 是 Alt+Backspace（删一个词），`0x7f` 是删一个字符。
// 这一对映射错了，用户会立刻感觉到「删词的键变成删一个字」。
  } else if (s === '\b' || s === '\x1b\b') {
    key.name = 'backspace'
    key.meta = s.charAt(0) === '\x1b'
  } else if (s === '\x7f' || s === '\x1b\x7f') {
    key.name = 'backspace'
    key.meta = s.charAt(0) === '\x1b'
  } else if (s === '\x1b' || s === '\x1b\x1b') {
    key.name = 'escape'
    key.meta = s.length === 2
  } else if (s === ' ' || s === '\x1b ') {
    key.name = 'space'
    key.meta = s.length === 2
// 0x1f 是 Ctrl+_（有些终端用它表示撤销），不在 a-z 的连续区间里，
// 所以单独一条。下面的 `s <= 0x1a` 是经典的算术映射：控制字符 0x01-0x1a
// 就是 Ctrl+A 到 Ctrl+Z，减 1 加 'a' 的码位即得字母。
//
// 一个 quirk：0x00（NUL）也满足 `s <= 0x1a && s.length === 1`，
// 于是解成 Ctrl+`（0 + 96 = 96 = 反引号）。没有终端会主动发 NUL，
// 所以这条路径实际不可达，但也说明「用区间比较而不是查表」会顺手收进边界值。
  } else if (s === '\x1f') {
    key.name = '_'
    key.ctrl = true
  } else if (s <= '\x1a' && s.length === 1) {
    key.name = String.fromCharCode(s.charCodeAt(0) + 'a'.charCodeAt(0) - 1)
    key.ctrl = true
// 数字键一律叫 'number' —— 具体是哪个数字不放在 name 里，
// 而由 `sequence`（以及 input-event 里算出的 input）承担。
// 这是「name 表示键位类别、sequence 表示具体字节」这个分工的直接后果。
  } else if (s.length === 1 && s >= '0' && s <= '9') {
    key.name = 'number'
  } else if (s.length === 1 && s >= 'a' && s <= 'z') {
    key.name = s
  } else if (s.length === 1 && s >= 'A' && s <= 'Z') {
    key.name = s.toLowerCase()
    key.shift = true
// 这个分支只标修饰键，**不给名字**（name 保持空串）——
// 因为 ESC + 单个字母的真实含义取决于应用（macOS 上 Alt+b 是「后退一个词」，
// 但在别处可能啥都不是）。真正的语义在 `input-event.ts` 里从 sequence
// 取字符。所以这里的结果是「meta=true、name=''」，不是「name='b'」。
//
// 紧接着（第 761 行）有个 iTerm 专用特例，把 ESC b / ESC f 认成左右移动 ——
// 只在「自然文本编辑」模式下成立，属于同一个「语义取决于应用」的范畴。
  } else if ((parts = META_KEY_CODE_RE.exec(s))) {
    key.meta = true
    key.shift = /^[A-Z]$/.test(parts[1]!)
// 【`(?:1;)?` 里那个 1 不是键号，是占位】
//
//   xterm 对光标键的带修饰编码是 `CSI 1 ; modifier A` —— 那个 1 是
//   「按键编号」字段，但对方向键它**永远是 1**（真编号靠终结字母表达）。
//   所以正则里直接写死 `1;`，而不是 `(\d+);`。
//
//   写成 `(\d+);` 会有一个隐蔽后果：`CSI 2 ; 5 A` 这种（不存在的）序列
//   能被匹配上，然后算出错误的键名。写死反而更安全。
//
//   code 的拼法 `[parts[1], parts[2], parts[4], parts[6]]` 是在做
//   「按位置拼回序列形状」：ESC 之后的头字节 + 参数 + 终结符，
//   拼出来的字符串正好是 `keyName` 表的键。
  } else if ((parts = FN_KEY_RE.exec(s))) {
    const segs = [...s]

    if (segs[0] === '\u001b' && segs[1] === '\u001b') {
      key.option = true
    }

    const code = [parts[1], parts[2], parts[4], parts[6]]
      .filter(Boolean)
      .join('')

    const modifier = ((parts[3] || parts[5] || 1) as number) - 1

    key.ctrl = !!(modifier & 4)
    key.meta = !!(modifier & 2)
    key.super = !!(modifier & 8)
    key.shift = !!(modifier & 1)
    key.code = code

    key.name = keyName[code]
    key.shift = isShiftKey(code) || key.shift
    key.ctrl = isCtrlKey(code) || key.ctrl
  }

// iTerm「自然文本编辑」模式：Alt+b / Alt+f 变成「按词移动」，
// 发的是 ESC b / ESC f。注意左右两个分支的**大小写不一致**
// （`ESC b` 与 `ESC f`）—— 这不是笔误，是两个方向的历史字节就是不同，
// 统一成一种反而会认不出其中一边。
  // iTerm in natural text editing mode
  if (key.raw === '\x1Bb') {
    key.meta = true
    key.name = 'left'
  } else if (key.raw === '\x1Bf') {
    key.meta = true
    key.name = 'right'
  }

// 【这六个 case 与上面的 `keyName` 表重复，实测行为完全一样】
//
//   顺着走一遍：`ESC[1~` → FN_KEY_RE 第二分支拼出 code='[1~' →
//   查表得 'home' → 与这里 `createNavKey(s, 'home', false)` 等价；
//   `ESC[1;5D` → 拼出 '[D' + modifier 5 → 'left' + ctrl → 同样等价。
//
//   唯一的实际差别：这里返回的对象**没有 `code` 字段**。
//   而 `code` 在 `input-event.ts` 里与 name 一起判（`code && !name`），
//   这条路径上 name 一定非空，所以抹掉 code 没有影响。
//
//   结论：这是可以删的冗余。但删除它要动一条久经考验的输入路径，
//   而它只占 14 行 —— 于是就这么留着了。「冗余但不值得动」在输入层很常见，
//   因为这一层的回归成本比别处高（错一次用户立刻察觉）。
  switch (s) {
    case '\u001b[1~':
      return createNavKey(s, 'home', false)
    case '\u001b[4~':
      return createNavKey(s, 'end', false)
    case '\u001b[5~':
      return createNavKey(s, 'pageup', false)
    case '\u001b[6~':
      return createNavKey(s, 'pagedown', false)
    case '\u001b[1;5D':
      return createNavKey(s, 'left', true)
    case '\u001b[1;5C':
      return createNavKey(s, 'right', true)
  }

  return key
}

// 纯构造函数，但要注意它把 `option` / `super` / `shift` 全归零 ——
// 也就是说凡是走 createNavKey 的路径，都不再携带这些修饰信息。
// 对滚轮和导航键来说没问题（它们本来没有这些修饰），
// 但这也是第 769 行那六个 case「不能用它替换通用路径」的原因之一。
function createNavKey(s: string, name: string, ctrl: boolean): ParsedKey {
  return {
    kind: 'key',
    name,
    ctrl,
    meta: false,
    shift: false,
    option: false,
    super: false,
    fn: false,
    sequence: s,
    raw: s,
    isPasted: false,
  }
}
