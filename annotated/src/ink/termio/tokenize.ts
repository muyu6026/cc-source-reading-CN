// ═══════════════════════════════════════════════════════════════
//  词法层：只切边界，不懂语义
// ═══════════════════════════════════════════════════════════════
//
//   这个文件回答的唯一问题是「从哪到哪是一条完整的转义序列」，
//   不关心它是移动光标还是设颜色。语义解释在 parser.ts。
//
//   分成两层的好处是**两个消费方需要不同粒度的东西**：
//
//     parse-keypress.ts   只要边界（它自己解释按键序列）
//     tabstops.ts         只要边界（它要跳过序列、只处理文本里的 tab）
//     parser.ts           要语义，所以内部先用这一层切，再解释
//
//   如果只有「词法 + 语义」一体的实现，前两个消费方就得被迫引入
//   整个 parser（包括 SGR 状态机）。**分层是为了让轻消费者不必付重代价。**
//
//   【流式是硬需求】
//   stdin 是流，`ESC [ 3` 可能一次到达、`1 m` 下一次到达。所以状态机
//   必须能「停在半个序列中间」，把已读的部分存起来。这就是
//   Tokenizer 的 feed / flush / buffer 三件套。
/**
 * Input Tokenizer - Escape sequence boundary detection
 *
 * Splits terminal input into tokens: text chunks and raw escape sequences.
 * Unlike the Parser which interprets sequences semantically, this just
 * identifies boundaries for use by keyboard input parsing.
 */

import { C0, ESC_TYPE, isEscFinal } from './ansi.js'
import { isCSIFinal, isCSIIntermediate, isCSIParam } from './csi.js'

// 【只有两种 token，界限极粗】
//
//   text      普通字符（**包括 LF / CR / BEL 这些控制字符**）
//   sequence  一条完整的转义序列（含 ESC 本身）
//
//   注意 text 里不拆控制字符 —— ground 状态只对 ESC 敏感，其余一律
//   当文本累积。所以 "abc\n" 是一个 text token，不是两个。
//
//   谁负责处理 LF？消费方。tabstops.ts 自己在 token 内部按 tab 和换行
//   再切一次（`split(/(\t|\n)/)`）。parse-keypress 也是自己按字符走。
//
//   这个设计的意思是：**词法层只切「机器语言」（转义序列），
//   「人类语言」（文本）原样传下去。**
export type Token =
  | { type: 'text'; value: string }
  | { type: 'sequence'; value: string }

// 【八个状态，但只有 ground 之外七个才是「在序列里」】
//
//   ground             普通文本
//   escape             ESC 之后，等引导字节或尾字节
//   escapeIntermediate ESC + 中间字节之后（如 ESC ( 之后等 B）
//   csi                ESC [ 之后
//   ss3                ESC O 之后
//   osc / dcs / apc    ESC ] / P / _ 之后，等字符串终结符
//
//   这八个状态**不是 ECMA-48 的完整状态图**（标准的有十几个，
//   还区分 entry/exit 动作）。这里只保留「能切出边界」所需的最小集。
//
//   缺的那几个就是 ansi.ts 里声明了但没实现的 PM / SOS。
//   它们会走 escape 状态的 isEscFinal 分支，被当成两字符序列发射，
//   后面的负载当文本漏出去 —— 见 ansi.ts 54 行的批注。
type State =
  | 'ground'
  | 'escape'
  | 'escapeIntermediate'
  | 'csi'
  | 'ss3'
  | 'osc'
  | 'dcs'
  | 'apc'

// 【buffer() 是给「等下一个数据块」用的】
//
//   feed(input)  喂数据，返回这次能确定的 token
//   flush()      强制结束（流关闭时），把半截序列也吐出来
//   reset()      回到初始状态
//   buffer()     看一眼「现在卡在哪半个序列上」
//
//   buffer() 的唯一调用方是 parse-keypress（296 行），它把这个值塞进
//   返回的 state 里，让**下一次按键**能接上。返回值形如 "ESC [" ——
//   也就是「已收到但还不能判定」的部分。
//
//   为什么不能让 feed 自己记住就好：因为 parse-keypress 的 state 是
//   一个纯对象（可以存进 React state / 序列化），tokenizer 实例挂在
//   它的下划线字段 `_tokenizer` 上。两者必须能分开走。
export type Tokenizer = {
  /** Feed input and get resulting tokens */
  feed(input: string): Token[]
  /** Flush any buffered incomplete sequences */
  flush(): Token[]
  /** Reset tokenizer state */
  reset(): void
  /** Get any buffered incomplete sequence */
  buffer(): string
}

// 【只有一个开关，而它的默认值决定了这个模块能否复用于输出】
//
//   x10Mouse = false（默认）
//     `ESC [ M` 按 CSI DL（Delete Lines）处理 —— 这是**输出**语义
//   x10Mouse = true（只有 stdin 开）
//     `ESC [ M` 后面再吃 3 个原始字节 —— 这是**输入**语义（老式鼠标事件）
//
//   同一个字节串在入站和出站是两个完全不同的东西。默认取 false，
//   是因为输出方向的量远大于输入（整屏重绘 vs 一次按键），
//   默认错在那个方向会造成文本被吞。
//
//   这是「同一套语法、两个方向、语义不同」的典型 —— 和 FOCUS_IN /
//   CHT 那对歧义（csi.ts 287 行）是同一个问题的两次出现。
type TokenizerOptions = {
  /**
   * Treat `CSI M` as an X10 mouse event prefix and consume 3 payload bytes.
   * Only enable for stdin input — `\x1b[M` is also CSI DL (Delete Lines) in
   * output streams, and enabling this there swallows display text. Default false.
   */
  x10Mouse?: boolean
}

/**
 * Create a streaming tokenizer for terminal input.
 *
 * Usage:
 * ```typescript
 * const tokenizer = createTokenizer()
 * const tokens1 = tokenizer.feed('hello\x1b[')
 * const tokens2 = tokenizer.feed('A')  // completes the escape sequence
 * const remaining = tokenizer.flush()  // force output incomplete sequences
 * ```
 */
// 工厂函数而不是 class：状态（currentState / currentBuffer）是闭包变量，
//   外部拿不到也不该拿到。class 会把这些暴露成可写字段。
//
//   代价是没有 instanceof 判断、没法序列化。但 Tokenizer 类型的四个方法
//   已经够用了，而且 parse-keypress 需要把 tokenizer 挂在 React state 上
//   的一个下划线字段里 —— 闭包对象正好合适（不参与深比较）。
export function createTokenizer(options?: TokenizerOptions): Tokenizer {
  let currentState: State = 'ground'
  let currentBuffer = ''
  const x10Mouse = options?.x10Mouse ?? false

  return {
// 【feed 和 flush 是同一个函数的两种收尾方式】
//
//   两者都调 tokenize()，区别只在两个参数：
//     flush()  传空输入 + flush=true  → 「现在没有更多数据了，把半截也给我」
//     feed()   传输入   + flush=false → 「数据可能还会有，半截先存着」
//
//   把「流结束」做成一个布尔参数，而不是复制一份状态机 —— 这是
//   这个文件最重要的结构选择。复制的话两份逻辑迟早会分叉。
//
//   注意两者都把 state 和 buffer 写回去，所以 feed 之后还能继续 feed。
    feed(input: string): Token[] {
      const result = tokenize(
        input,
        currentState,
        currentBuffer,
        false,
        x10Mouse,
      )
      currentState = result.state.state
      currentBuffer = result.state.buffer
      return result.tokens
    },

    flush(): Token[] {
      const result = tokenize('', currentState, currentBuffer, true, x10Mouse)
      currentState = result.state.state
      currentBuffer = result.state.buffer
      return result.tokens
    },

    reset(): void {
      currentState = 'ground'
      currentBuffer = ''
    },

    buffer(): string {
      return currentBuffer
    },
  }
}

type InternalState = {
  state: State
  buffer: string
}

// 【主函数是纯的：状态进、状态出，不碰外部】
//
//   签名里 initialState / initialBuffer 是入参，返回的 state 是出参 ——
//   这就是「可测试」的形状。createTokenizer 只负责保管这两个值。
//
//   flushText / emitSequence 写成闭包而不是模块函数，是因为它们要读写
//   i / textStart / seqStart 三个局部变量。传参也能做，但那样每个调用点
//   都要写上四五个实参。
function tokenize(
  input: string,
  initialState: State,
  initialBuffer: string,
  flush: boolean,
  x10Mouse: boolean,
): { tokens: Token[]; state: InternalState } {
  const tokens: Token[] = []
  const result: InternalState = {
    state: initialState,
    buffer: '',
  }

// 【把上次的半截拼到这次前面，然后从头重新扫】
//
//   代价：已经扫过的那半截会被再扫一遍。但半截序列最长也就几十字节
//   （OSC 的 URL 可能长一点），重复扫描的量和「整块数据」相比可忽略。
//
//   收益：不需要维护「上次停在哪个字符」的游标 —— 状态机只记状态，
//   不记位置。如果记位置，那么「状态 + 位置」的组合会引出更多边界情况
//   （位置越界、buffer 被替换…）。
//
//   这是「重新开始 vs 保存现场」的经典取舍：**重新开始的成本是
//   O(半截长度)，保存现场的成本是 O(状态空间)**。前者小得多。
  const data = initialBuffer + input
  let i = 0
  let textStart = 0
  let seqStart = 0

// flushText：把 [textStart, i) 这一段当文本发射。
//
//   注意它同时做了两件事：发射 token、把 textStart 推到 i。
//   少推一次的话，同一段文本会在下一次 flush 时重复发射。
//
//   传参版本会写成 `flushText(i)`，但这里靠闭包读 i —— 因为 i 每轮都变。
  const flushText = (): void => {
    if (i > textStart) {
      const text = data.slice(textStart, i)
      if (text) {
        tokens.push({ type: 'text', value: text })
      }
    }
    textStart = i
  }

// emitSequence：发射序列并**重置状态到 ground**，同时把 textStart 推到 i。
//
//   【`textStart = i` 这一行不能省】
//   序列发射完之后，位置 i 就是新文本的起点。如果只改 state 不改
//   textStart，下一次 flushText 会从旧位置开始切，把刚刚当序列发出去的
//   那几个字节**又当文本发一遍** —— 屏幕上出现肉眼可见的 `[31m`。
//
//   这是这个文件里最容易写错的一行，因为它看起来像「顺手同步一下」。
  const emitSequence = (seq: string): void => {
    if (seq) {
      tokens.push({ type: 'sequence', value: seq })
    }
    result.state = 'ground'
    textStart = i
  }

  while (i < data.length) {
    const code = data.charCodeAt(i)

    switch (result.state) {
// ground：只有 ESC 能让你离开这个状态。其余一切都算文本。
//
//   所以 C0 控制字符（LF、CR、BEL、BS…）都留在 text token 里，
//   由消费方处理。这是刻意的分层：**词法层不解释控制字符的语义。**
      case 'ground':
        if (code === C0.ESC) {
          flushText()
          seqStart = i
          result.state = 'escape'
          i++
        } else {
          i++
        }
        break

// 【这个分支的判定顺序是有承载的，不能重排】
//
//   看这五步的顺序：
//     1. CSI / OSC / DCS / APC（0x5b / 0x5d / 0x50 / 0x5f）
//     2. SS3（0x4f，字母 O）
//     3. isCSIIntermediate（0x20-0x2f）
//     4. isEscFinal（0x30-0x7e）
//     5. 双 ESC
//
//   第 1、2 步**必须**在第 4 步之前。原因：0x50 / 0x5b / 0x5d / 0x5f /
//   0x4f 全都落在 0x30-0x7e 这个「合法尾字节」区间里。如果先判
//   isEscFinal，那么 `ESC [ 3 1 m` 会在 ESC[ 这一步就被判成
//   「两字符序列 ESC [」发射出去，剩下的 `31m` 变成文本 ——
//   **所有 CSI 序列全部失效**。
//
//   第 3 步和 4 步的区间不重叠（0x20-0x2f vs 0x30-0x7e），交换无害，
//   但保持「中间字节在前」与标准的状态机图一致，读起来顺。
//
//   这类「看似随意的 if 顺序其实是正确性前提」的代码，是本项目里
//   反复出现的模式（log-update 的 LF vs CSI CUD、setClipboard 的
//   先 native 后 tmux，都是同一类）。
      case 'escape':
        if (code === ESC_TYPE.CSI) {
          result.state = 'csi'
          i++
        } else if (code === ESC_TYPE.OSC) {
          result.state = 'osc'
          i++
        } else if (code === ESC_TYPE.DCS) {
          result.state = 'dcs'
          i++
        } else if (code === ESC_TYPE.APC) {
          result.state = 'apc'
          i++
        } else if (code === 0x4f) {
          // 'O' - SS3
          result.state = 'ss3'
          i++
// 中间字节：ESC ( / ESC ) / ESC # 这类准备切换字符集或行属性的前缀，
//   后面还要再等一个尾字节。
//
//   所以 `ESC ( B` 会被完整切成一条三字符序列。至于怎么解释它，
//   esc.ts 里直接返回 null（不处理字符集）—— **分词和解释彻底分开**，
//   分词器不需要知道「这个序列有没有人实现」。
        } else if (isCSIIntermediate(code)) {
          // Intermediate byte (e.g., ESC ( for charset) - continue buffering
          result.state = 'escapeIntermediate'
          i++
        } else if (isEscFinal(code)) {
          // Two-character escape sequence
          i++
          emitSequence(data.slice(seqStart, i))
// 【双 ESC：把前一个单独发射，然后从当前位置重开一个 escape 状态】
//
//   `data.slice(seqStart, i)` 的长度是 1 —— 也就是一个孤零零的 ESC。
//   所以下游可能收到 `{ type: 'sequence', value: 'ESC' }` 这种「一条只有
//   前缀的序列」。
//
//   消费方必须能容忍它。parser.ts 的 identifySequence 对长度 < 2 返回
//   unknown，然后被归成 unknown 丢掉 —— 正好。
//
//   为什么会连着两个 ESC：终端在某些情况下会发 `ESC ESC [ ...`
//   （前一个是「取消当前序列」），也有些程序写错。**不崩就行。**
        } else if (code === C0.ESC) {
          // Double escape - emit first, start new
          emitSequence(data.slice(seqStart, i))
          seqStart = i
          result.state = 'escape'
          i++
// 【非法序列的降级：注意这里没有 i++】
//
//   `result.state = 'ground'; textStart = seqStart` —— 只改状态，
//   不前移游标。于是 while 循环**原地重来一次**，这次在 ground 状态下
//   把当前字符当普通文本处理。
//
//   如果这里加了 i++，那个「导致非法的字符」就被吞掉了。不加 i++ 才能
//   保证「所有输入字节要么进 sequence，要么进 text，一个都不丢」。
//
//   这是状态机降级的标准做法：**回退到能处理当前字符的状态，
//   而不是跳过当前字符。** 三个降级点（181 / 251 / 263）都是这个形状。
        } else {
          // Invalid - treat ESC as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'escapeIntermediate':
        // After intermediate byte(s), wait for final byte
        if (isCSIIntermediate(code)) {
          // More intermediate bytes
          i++
        } else if (isEscFinal(code)) {
          // Final byte - complete the sequence
          i++
          emitSequence(data.slice(seqStart, i))
        } else {
          // Invalid - treat as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

// CSI 分支。顺序同样是「先判会不会被误吞」：
//   228 行的 X10 分支在最前，因为 `ESC [ M` 只有在「M 是第 3 个字节」
//   时才是鼠标事件；一旦有参数进来就不可能是它。
//
//   其后 isCSIFinal（0x40-0x7e）与 isCSIParam/isCSIIntermediate
//   （0x20-0x3f）区间不重叠，交换顺序无害。
      case 'csi':
        // X10 mouse: CSI M + 3 raw payload bytes (Cb+32, Cx+32, Cy+32).
        // M immediately after [ (offset 2) means no params — SGR mouse
        // (CSI < … M) has a `<` param byte first and reaches M at offset > 2.
        // Terminals that ignore DECSET 1006 but honor 1000/1002 emit this
        // legacy encoding; without this branch the 3 payload bytes leak
        // through as text (`` `rK `` / `arK` garbage in the prompt).
        //
        // Gated on x10Mouse — `\x1b[M` is also CSI DL (Delete Lines) and
        // blindly consuming 3 chars corrupts output rendering (Parser/Ansi)
        // and fragments bracketed-paste PASTE_END. Only stdin enables this.
        // The ≥0x20 check on each payload slot is belt-and-suspenders: X10
        // guarantees Cb≥32, Cx≥33, Cy≥33, so a control byte (ESC=0x1B) in
        // any slot means this is CSI DL adjacent to another sequence, not a
        // mouse event. Checking all three slots prevents PASTE_END's ESC
        // from being consumed when paste content ends in `\x1b[M`+0-2 chars.
        //
        // Known limitation: this counts JS string chars, but X10 is byte-
        // oriented and stdin uses utf8 encoding (App.tsx). At col 162-191 ×
        // row 96-159 the two coord bytes (0xC2-0xDF, 0x80-0xBF) form a valid
        // UTF-8 2-byte sequence and collapse to one char — the length check
        // fails and the event buffers until the next keypress absorbs it.
        // Fixing this requires latin1 stdin; X10's 223-coord cap is exactly
        // why SGR was invented, and no-SGR terminals at 162+ cols are rare.
// 【上面那段英文注释把来龙去脉写全了，这里只补两个它没提的点】
//
//   ① 四个条件里有两个是「数据不够也算通过」
//      `(i + 1 >= data.length || ...)` —— 越界时短路为真。
//      于是「字节还没到齐」这个情况和「这里确实是鼠标事件」走了同一条
//      判断，靠 236 行的 `i + 4 <= data.length` 再分一次流：
//      够就发射，不够就 `i = data.length` 退出去缓冲。
//
//      为什么不把长度检查和内容检查合成一个条件：**两者要分开处理**。
//      内容不合格 = 这不是鼠标事件（就地降级成 CSI DL）；
//      长度不够 = 现在还不知道（留着等下一块）。合成一个条件的话，
//      这两种情况都得走同一个分支，必有一边是错的。
//
//   ② 这一支**只切边界，不解码**。它发射的是「ESC [ M + 三个字节」的
//      原始四字节串，坐标换算（减 32、转 1 基）在 parse-keypress 那边。
//      所以 tokenize.ts 里看不到任何鼠标语义 —— 和它「只切边界」
//      的定位一致。
        if (
          x10Mouse &&
          code === 0x4d /* M */ &&
          i - seqStart === 2 &&
          (i + 1 >= data.length || data.charCodeAt(i + 1) >= 0x20) &&
          (i + 2 >= data.length || data.charCodeAt(i + 2) >= 0x20) &&
          (i + 3 >= data.length || data.charCodeAt(i + 3) >= 0x20)
        ) {
          if (i + 4 <= data.length) {
            i += 4
            emitSequence(data.slice(seqStart, i))
          } else {
            // Incomplete — exit loop; end-of-input buffers from seqStart.
            // Re-entry re-tokenizes from ground via the invalid-CSI fallthrough.
            i = data.length
          }
          break
        }
// X10 不成立时走正常 CSI：尾字节 → 发射；参数/中间字节 → 继续吃。
        if (isCSIFinal(code)) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (isCSIParam(code) || isCSIIntermediate(code)) {
          i++
        } else {
          // Invalid CSI - abort, treat as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

// SS3：`ESC O` + 一个尾字节。方向键在 application mode 下走这条。
//
//   尾字节范围 0x40-0x7e，比 CSI 的尾字节范围窄（不含参数区）。
//   所以这里直接硬编码范围，没有复用 csi.ts 的 isCSIFinal ——
//   虽然数值一样，但语义上 SS3 不允许参数，用同一张表会暗示它允许。
      case 'ss3':
        // SS3 sequences: ESC O followed by a single final byte
        if (code >= 0x40 && code <= 0x7e) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else {
          // Invalid - treat as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

// OSC / DCS / APC：三种「带负载的字符串」，终止方式完全一样。
//
//   BEL（0x07）        传统方式
//   ESC 反斜杠（ST）   标准方式，也是唯一能出现在 DCS 内部的方式
//
//   两者都要认，因为终端厂家各行其是：xterm 系多用 BEL 终止 OSC，
//   kitty 用 ST（因为 BEL 在 kitty 里会响铃）。
//
//   【这里有一个分块边界上的缺陷，但在当前用法下不会触发】
//   285 行的条件是 `i + 1 < data.length`。如果数据块正好停在 ESC 上，
//   `i+1 < length` 为假，走 else 分支 `i++` —— **那个 ESC 被当成
//   OSC 的负载内容吞掉了**。下一块开头的反斜杠也会被当负载，
//   于是这条 OSC 永远不终止，一直吃到下一个 BEL 为止。
//
//   为什么不用管：OSC 解析只发生在 Ansi.tsx 里，而它拿到的是一整段
//   完整字符串，永远不会在 ESC 处被切开。输入方向（stdin）几乎不发 OSC。
//
//   判据还是那一条：**缺陷是否可达，取决于调用方式，而不是缺陷本身。**
      case 'osc':
        if (code === C0.BEL) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (
          code === C0.ESC &&
          i + 1 < data.length &&
          data.charCodeAt(i + 1) === ESC_TYPE.ST
        ) {
          i += 2
          emitSequence(data.slice(seqStart, i))
        } else {
          i++
        }
        break

      case 'dcs':
      case 'apc':
        if (code === C0.BEL) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (
          code === C0.ESC &&
          i + 1 < data.length &&
          data.charCodeAt(i + 1) === ESC_TYPE.ST
        ) {
          i += 2
          emitSequence(data.slice(seqStart, i))
        } else {
          i++
        }
        break
    }
  }

  // Handle end of input
// 【三种收尾，对应「流结束时的三种处境」】
//
//   state === ground      已回到普通文本 → 把剩余文本发射完
//   flush === true        调用方说「没有更多了」→ 强制把半截当序列发射
//   else                  还有可能来数据 → 存进 buffer，状态保持不动
//
//   注意第三种**不改 state**。所以下次 feed 会从同一个状态继续 ——
//   这是流式能力的核心，也是 63 行 feed/flush 共用一个函数的前提。
//
//   还要注意 flush 时发射的是「半截序列」而不是丢弃。为什么：调用方
//   （parse-keypress）在流关闭时希望拿到一切能拿到的输入，哪怕它
//   看起来不完整 —— 丢掉就等于丢按键。
  if (result.state === 'ground') {
    flushText()
  } else if (flush) {
    // Force output incomplete sequence
    const remaining = data.slice(seqStart)
    if (remaining) tokens.push({ type: 'sequence', value: remaining })
    result.state = 'ground'
// 缓冲的是「从 seqStart 到结尾」的整段，包含引导的 ESC。
//
//   所以 buffer() 返回的字符串可以原样拼到下一块数据前面（112 行），
//   这就是「重新开始 vs 保存现场」里选「重新开始」的具体形态：
//   要保存的现场只有一个字符串，不是一个游标。
//
//   buffer 也可能返回空串（ground 状态收尾时 result.buffer 保持 ''），
//   所以调用方拿到它只能当「可能为空」处理。
  } else {
    // Buffer incomplete sequence for next call
    result.buffer = data.slice(seqStart)
  }

  return { tokens, state: result }
}
