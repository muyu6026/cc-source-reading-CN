// ═══════════════════════════════════════════════════════════════
//  语义层：把 token 变成 Action，并维护样式状态
// ═══════════════════════════════════════════════════════════════
//
//   这一层是 tokenize.ts 的下游。它做三件事：
//     1. 判断序列类型（CSI / OSC / ESC / SS3）
//     2. 解释成结构化动作（parseCSI / parseOSC / parseEsc）
//     3. 维护跨动作的状态（当前样式、是否在链接里）
//
//   【第 3 件事是这一层和「纯解析器」的分界线】
//   SGR 不是「一个动作」而是「改状态」—— 所以它被拦下来（346 行），
//   不进入 Action 流。后面每一段文本都带上「当时的」样式快照。
//
//   这让消费方极其简单（Ansi.tsx 只需要处理 text 和 link 两种 action），
//   代价是**无法重放**：只拿到 Action 数组的人不知道样式是怎么一路变过来的。
//
//   【唯二的两个消费方】
//     Ansi.tsx        解析要渲染的 ANSI 字符串
//     （内部）tokenize 被 parse-keypress 和 tabstops 直接使用，不经这里
//
//   也就是说：这个 394 行的语义解析器，全仓库只有一个调用点
//   （Ansi.tsx 119 行，每次渲染 new 一个 Parser）。
/**
 * ANSI Parser - Semantic Action Generator
 *
 * A streaming parser for ANSI escape sequences that produces semantic actions.
 * Uses the tokenizer for escape sequence boundary detection, then interprets
 * each sequence to produce structured actions.
 *
 * Key design decisions:
 * - Streaming: can process input incrementally
 * - Semantic output: produces structured actions, not string tokens
 * - Style tracking: maintains current text style state
 */

import { getGraphemeSegmenter } from '../../utils/intl.js'
import { C0 } from './ansi.js'
import { CSI, CURSOR_STYLES, ERASE_DISPLAY, ERASE_LINE_REGION } from './csi.js'
import { DEC } from './dec.js'
import { parseEsc } from './esc.js'
import { parseOSC } from './osc.js'
import { applySGR } from './sgr.js'
import { createTokenizer, type Token, type Tokenizer } from './tokenize.js'
import type { Action, Grapheme, TextStyle } from './types.js'
import { defaultStyle } from './types.js'

// =============================================================================
// Grapheme Utilities
// =============================================================================

// 【这里的宽度表是粗粒度的，和 stringWidth.ts 不是同一份】
//
//   四个区间：杂项符号（2600-26FF）、装饰符号（2700-27BF）、
//   表情（1F300-1F9FF）、扩展表情（1FA00-1FAFF）、区域指示符（1F1E0-1F1FF，
//   国旗用的那两个字母）。
//
//   真正权威的宽度计算在 stringWidth.ts（走 eastAsianWidth 数据表 + Bun）。
//   这里只做「大致判断」，因为它算出来的 width 字段**没有任何消费方读**
//   （见 types.ts 218 行的批注）。
//
//   为什么留着一个没人用的结果：解析阶段需要 grapheme 分割（至少要把
//   一个 emoji 当一个单位，而不是四个码点），宽度是分割时顺手算的。
//   删掉它会让 Gemerator 的返回类型变窄，但不会影响行为。
function isEmoji(codePoint: number): boolean {
  return (
    (codePoint >= 0x2600 && codePoint <= 0x26ff) ||
    (codePoint >= 0x2700 && codePoint <= 0x27bf) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x1fa00 && codePoint <= 0x1faff) ||
    (codePoint >= 0x1f1e0 && codePoint <= 0x1f1ff)
  )
}

function isEastAsianWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe1f) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fffd) ||
    (codePoint >= 0x30000 && codePoint <= 0x3fffd)
  )
}

// 【「多码点就一定是 2 列」这个假设是错的，但无害】
//
//   `e` + 组合重音 → 一个 grapheme，多码点，占 1 列（这里算 2）
//   `👨‍👩‍👧`（ZWJ 序列） → 一个 grapheme，多码点，占 2 列（这里算 2，对）
//   国旗（两个区域指示符）→ 一个 grapheme，多码点，占 2 列（这里算 2，对）
//
//   组合重音这一类算错，原因是没有区分「组合标记」和「ZWJ 连接」。
//   要判对需要 Unicode 的 grapheme cluster 断点规则表 —— 而这里的目标
//   只是「分割成视觉单位」，宽度错了不影响分割。
//
//   又一次：**这个字段的用途决定了它只需要大致对。**
function hasMultipleCodepoints(str: string): boolean {
  let count = 0
  for (const _ of str) {
    count++
    if (count > 1) return true
  }
  return false
}

function graphemeWidth(grapheme: string): 1 | 2 {
  if (hasMultipleCodepoints(grapheme)) return 2
  const codePoint = grapheme.codePointAt(0)
  if (codePoint === undefined) return 1
  if (isEmoji(codePoint) || isEastAsianWide(codePoint)) return 2
  return 1
}

function* segmentGraphemes(str: string): Generator<Grapheme> {
  for (const { segment } of getGraphemeSegmenter().segment(str)) {
    yield { value: segment, width: graphemeWidth(segment) }
  }
}

// =============================================================================
// Sequence Parsing
// =============================================================================

// 【和 sgr.ts 的 parseParams 是两份解析器，且这一份是有损的】
//
//   `split(/[;:]/)` 把冒号和分号一视同仁地切开，空串变 0。
//
//   对 CSI 的光标/擦除命令来说这没问题 —— 它们只有分号参数，没有子参数。
//   但对 SGR 就致命：`38:2::255:0:0` 会被切成 [38,2,0,255,0,0]，
//   色彩空间的「空」变成「0」，而且子参数的结构信息全丢了。
//
//   所以 114 行把 SGR 特判掉，直接把**原始参数串**交给 sgr.ts 重新解析。
//   同一个语法两套解析器，看起来是重复，实际是「有损版够用就别上无损版」
//   —— 光标命令占绝大多数调用量。
function parseCSIParams(paramStr: string): number[] {
  if (paramStr === '') return []
  return paramStr.split(/[;:]/).map(s => (s === '' ? 0 : parseInt(s, 10)))
}

/** Parse a raw CSI sequence (e.g., "\x1b[31m") into an action */
// 【整个文件最长的 if 链，二十来个分支】
//
//   结构：先剥出（私有标记 / 参数 / 中间字节 / 尾字节）四个部分，
//   然后按尾字节分发。分发用的是 if 而不是 switch，理由和 sgr.ts 一样
//   （码位稀疏，switch 会生成带洞的跳转表）。
//
//   读的时候建议倒着读：先看所有 `return null` 和 `return unknown`
//   在哪，再看正常分支 —— 因为「哪些没实现」比「哪些实现了」更能
//   界定这个解析器的能力范围。
function parseCSI(rawSequence: string): Action | null {
  const inner = rawSequence.slice(2)
  if (inner.length === 0) return null

// 【`inner.slice(2)` 之后再取最后一个字符当尾字节】
//
//   `ESC [ 3 1 m` → inner = "31m" → finalByte = 'm'，beforeFinal = "31"
//
//   所以 beforeFinal 里装的是「私有标记 + 参数 + 中间字节」的混合体，
//   下面两步就是把它拆开：先剥私有标记（98 行），再剥中间字节（103 行）。
//
//   注意这个拆法**依赖参数区只在中间、中间字节只在最后**这个语法约束。
//   如果输入是畸形（比如中间字节夹在参数中间），拆出来的东西会错 ——
//   但不会崩，只会得到一条 unknown。
  const finalByte = inner.charCodeAt(inner.length - 1)
  const beforeFinal = inner.slice(0, -1)

  let privateMode = ''
  let paramStr = beforeFinal
  let intermediate = ''

// 私有标记只有四个：`?`（DEC 私有模式）、`>`（次要设备属性 / modifyOtherKeys /
//   kitty 压栈）、`=`（DECKPAM 键盘模式）、`<`（SGR 鼠标编码 / kitty 出栈）。
//
//   它们都在参数字节的 0x3c-0x3f 区间，是「参数」的一种，只是语义特殊。
//   所以词法层不需要区分（tokenize 只认 0x30-0x3f 整段），语义层才剥。
  if (beforeFinal.length > 0 && '?>='.includes(beforeFinal[0]!)) {
    privateMode = beforeFinal[0]!
    paramStr = beforeFinal.slice(1)
  }

// 【中间字节用正则从尾部剥，而不是逐个字符扫】
//
//   `/([^0-9;:]+)$/` —— 匹配结尾那一段「既不是数字也不是分隔符」的字符。
//
//   唯一真正用到的中间字节是**空格**（DECSCUSR 的 `CSI 2 q`，第 2 个参数
//   和 q 之间有一个空格，这是 DEC 的私有约定）。195 行会检查
//   `intermediate === ' '`，否则 `CSI q` 不认。
//
//   用正则而不是手写循环的理由：这条路径上中间字节最多两个字符，
//   正则编译一次后开销可以忽略，而手写循环要多写十几行。
  const intermediateMatch = paramStr.match(/([^0-9;:]+)$/)
  if (intermediateMatch) {
    intermediate = intermediateMatch[1]!
    paramStr = paramStr.slice(0, -intermediate.length)
  }

  const params = parseCSIParams(paramStr)
// 【`?? 1` 这个默认值只对「移动类」命令成立】
//
//   `CSI A`（无参数）→ 上移 1 行。所以移动类默认 1。
//   `CSI J`（无参数）→ 擦到屏尾，即 region=0。不是 1。
//   `CSI r`（无参数）→ 重置滚动区域为整屏。不是 top=1;bottom=1。
//
//   所以这里给 p0/p1 定默认 1，然后在 **ED/EL 里单独用 `params[0] ?? 0`**（161 行），
//   在 DECSTBM 里则……直接用了 p0/p1（179 行）。
//
//   DECSTBM 那处是个真实的语义偏差：`ESC [ r` 按标准是「重置为整屏」，
//   而这里会解析成 `setRegion(top=1, bottom=1)` —— 一个只有一行的滚动区域。
//
//   为什么没暴露：这条序列只**出站**（csi.ts 的 RESET_SCROLL_REGION），
//   从来不出现在要渲染的文本里。解析器只需要覆盖「我们可能渲染到的」
//   那部分语法，而不是完整的 ECMA-48。
//
//   **判断一处「缺实现」是不是 bug，要看它是否可达。**
  const p0 = params[0] ?? 1
  const p1 = params[1] ?? 1

  // SGR (Select Graphic Rendition)
// 【SGR 特判，以及那个 `privateMode === ''` 的作用】
//
//   尾字节 `m` 被两条完全不同的命令共用：
//     `CSI 1 m`         SGR，设加粗
//     `CSI > 4 ; 2 m`   modifyOtherKeys level 2（csi.ts 314 行）
//
//   两者靠私有标记区分。如果没有 `privateMode === ''` 这个条件，
//   `ESC [ > 4 ; 2 m` 会被当成 SGR 处理，参数串 ">4;2" 交给 sgr.ts，
//   parseInt(">4") 得 NaN，NaN ?? 0 得 NaN（`??` 只挡 null/undefined），
//   然后所有分支都不匹配，305 行的 `i++` 一个个跳过 —— **静默无效**。
//
//   反过来，这个条件是「另一个模块的生成函数」逼出来的：
//   csi.ts 的 ENABLE_MODIFY_OTHER_KEYS 决定了这里必须加判断。
//   两个文件的耦合点在一行 if 里，没有任何注释提示 —— 所以只能靠读
//   两边才能发现。
  if (finalByte === CSI.SGR && privateMode === '') {
    return { type: 'sgr', params: paramStr }
  }

  // Cursor movement
  if (finalByte === CSI.CUU) {
    return {
      type: 'cursor',
      action: { type: 'move', direction: 'up', count: p0 },
    }
  }
  if (finalByte === CSI.CUD) {
    return {
      type: 'cursor',
      action: { type: 'move', direction: 'down', count: p0 },
    }
  }
  if (finalByte === CSI.CUF) {
    return {
      type: 'cursor',
      action: { type: 'move', direction: 'forward', count: p0 },
    }
  }
  if (finalByte === CSI.CUB) {
    return {
      type: 'cursor',
      action: { type: 'move', direction: 'back', count: p0 },
    }
  }
  if (finalByte === CSI.CNL) {
    return { type: 'cursor', action: { type: 'nextLine', count: p0 } }
  }
  if (finalByte === CSI.CPL) {
    return { type: 'cursor', action: { type: 'prevLine', count: p0 } }
  }
  if (finalByte === CSI.CHA) {
    return { type: 'cursor', action: { type: 'column', col: p0 } }
  }
  if (finalByte === CSI.CUP || finalByte === CSI.HVP) {
    return { type: 'cursor', action: { type: 'position', row: p0, col: p1 } }
  }
  if (finalByte === CSI.VPA) {
    return { type: 'cursor', action: { type: 'row', row: p0 } }
  }

  // Erase
// 【ED / EL 用的是 `params[0] ?? 0`，和上面的 p0（默认 1）不同】
//
//   这是对的：标准里 ED/EL 无参数等于参数 0（擦到末尾），
//   而移动命令无参数等于 1。所以两个默认值必须分开写。
//
//   双重兜底：`ERASE_DISPLAY[params[0] ?? 0] ?? 'toEnd'`。
//   第二层挡的是「参数越界」—— `CSI 9 J` 的下标 9 在数组里不存在，
//   返回 undefined，退化成 toEnd。标准没说越界怎么办，这里选「做点
//   无害的事」而不是「报错」。
  if (finalByte === CSI.ED) {
    const region = ERASE_DISPLAY[params[0] ?? 0] ?? 'toEnd'
    return { type: 'erase', action: { type: 'display', region } }
  }
  if (finalByte === CSI.EL) {
    const region = ERASE_LINE_REGION[params[0] ?? 0] ?? 'toEnd'
    return { type: 'erase', action: { type: 'line', region } }
  }
  if (finalByte === CSI.ECH) {
    return { type: 'erase', action: { type: 'chars', count: p0 } }
  }

  // Scroll
  if (finalByte === CSI.SU) {
    return { type: 'scroll', action: { type: 'up', count: p0 } }
  }
  if (finalByte === CSI.SD) {
    return { type: 'scroll', action: { type: 'down', count: p0 } }
  }
// DECSTBM：设滚动区域。
//
//   上面 110 行那段批注说了这里的默认值问题（`ESC [ r` 会变成一行区域）。
//   再加一句：`top`/`bottom` 是 **1 基、含两端**，和 yoga 的 0 基坐标不同。
//   跨层传递时这个基数差是常见错误源 —— 和 types.ts 128 行
//   （CursorAction 也是 1 基）是同一类隐含约定。
  if (finalByte === CSI.DECSTBM) {
    return {
      type: 'scroll',
      action: { type: 'setRegion', top: p0, bottom: p1 },
    }
  }

  // Cursor save/restore
  if (finalByte === CSI.SCOSC) {
    return { type: 'cursor', action: { type: 'save' } }
  }
  if (finalByte === CSI.SCORC) {
    return { type: 'cursor', action: { type: 'restore' } }
  }

  // Cursor style
// 【DECSCUSR 只在「有空格中间字节」时才认】
//
//   `CSI 2 q`（中间有个空格）→ 光标样式
//   `CSI 2 q`（没空格）      → 别的命令（DECLL，加载 LED 灯）
//
//   同一个尾字节 `q` 靠中间字节区分。这解释了 103 行那个正则的存在：
//   它不是通用设施，就是为了这一个命令服务的。
//
//   顺带：`CURSOR_STYLES[p0] ?? CURSOR_STYLES[0]` —— 越界退化成
//   「闪烁方块」。默认值选默认样式，和 sgr.ts 里 `4:N` 越界退化成
//   'single' 是同一思路：**不认识的值 → 最保守的那个已知值。**
  if (finalByte === CSI.DECSCUSR && intermediate === ' ') {
    const styleInfo = CURSOR_STYLES[p0] ?? CURSOR_STYLES[0]!
    return { type: 'cursor', action: { type: 'style', ...styleInfo } }
  }

  // Private modes
// 【私有模式的解析只处理 p0，后面的参数全部静默丢弃】
//
//   `CSI ? 25 ; 1049 h` 想同时「显示光标 + 进备用屏」，这里只返回
//   「显示光标」这一件事，1049 被忽略。
//
//   真实的终端里，多模式一条序列是合法的（xterm 支持）。所以这是一个
//   覆盖度缺口。
//
//   为什么可以不管：这程序发模式从来是一条一条发（dec.ts 里
//   ENABLE_MOUSE_TRACKING 也是四个 decset 拼接，不是一条多参数）。
//   而解析方向只处理自己要渲染的文本，那里面不会有模式序列。
//
//   又一次「不可达所以不实现」。但如果哪天要把这个解析器用在
//   通用终端模拟器上，这里就是第一个要补的地方。
  if (privateMode === '?' && (finalByte === CSI.SM || finalByte === CSI.RM)) {
    const enabled = finalByte === CSI.SM

    if (p0 === DEC.CURSOR_VISIBLE) {
      return {
        type: 'cursor',
        action: enabled ? { type: 'show' } : { type: 'hide' },
      }
    }
    if (p0 === DEC.ALT_SCREEN_CLEAR || p0 === DEC.ALT_SCREEN) {
      return { type: 'mode', action: { type: 'alternateScreen', enabled } }
    }
    if (p0 === DEC.BRACKETED_PASTE) {
      return { type: 'mode', action: { type: 'bracketedPaste', enabled } }
    }
    if (p0 === DEC.MOUSE_NORMAL) {
      return {
        type: 'mode',
        action: { type: 'mouseTracking', mode: enabled ? 'normal' : 'off' },
      }
    }
    if (p0 === DEC.MOUSE_BUTTON) {
      return {
        type: 'mode',
        action: { type: 'mouseTracking', mode: enabled ? 'button' : 'off' },
      }
    }
    if (p0 === DEC.MOUSE_ANY) {
      return {
        type: 'mode',
        action: { type: 'mouseTracking', mode: enabled ? 'any' : 'off' },
      }
    }
    if (p0 === DEC.FOCUS_EVENTS) {
      return { type: 'mode', action: { type: 'focusEvents', enabled } }
    }
  }

  return { type: 'unknown', sequence: rawSequence }
}

/**
 * Identify the type of escape sequence from its raw form.
 */
// 【只认四个前缀，其余一律当 ESC 处理】
//
//   ESC [  → csi
//   ESC ]  → osc
//   ESC O  → ss3
//   其它   → esc（交给 parseEsc）
//
//   兜底成 esc 是对的选择：ESC 系序列的尾字节范围最宽（0x30-0x7e），
//   未知前缀最可能属于那一族。
//
//   长度 < 2 时返回 unknown —— 那是 tokenize.ts 双 ESC 分支
//   （175 行）产生的「孤零零一个 ESC」。
function identifySequence(
  seq: string,
): 'csi' | 'osc' | 'esc' | 'ss3' | 'unknown' {
  if (seq.length < 2) return 'unknown'
  if (seq.charCodeAt(0) !== C0.ESC) return 'unknown'

  const second = seq.charCodeAt(1)
  if (second === 0x5b) return 'csi' // [
  if (second === 0x5d) return 'osc' // ]
  if (second === 0x4f) return 'ss3' // O
  return 'esc'
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parser class - maintains state for streaming/incremental parsing
 *
 * Usage:
 * ```typescript
 * const parser = new Parser()
 * const actions1 = parser.feed('partial\x1b[')
 * const actions2 = parser.feed('31mred')  // state maintained internally
 * ```
 */
// 【Parser 是个有状态的类，每次用都得 new】
//
//   Ansi.tsx 119 行就是 `const parser = new Parser(); const actions =
//   parser.feed(input)` —— 每渲染一次 new 一个，用完即弃。
//
//   这看起来浪费，其实是对的：**样式状态必须从「干净状态」开始**。
//   复用同一个实例的话，上一次解析结束时残留的样式会污染下一次渲染的
//   第一段文字（症状：某个组件的文字莫名变成红色）。
//
//   这也说明：这个类的「流式」能力目前没有被真正用上（没有人跨多次
//   feed）。它是为「将来可能接 stdin」留的形状。
export class Parser {
  private tokenizer: Tokenizer = createTokenizer()

// 【三个公开字段里，两个是死状态】
//
//   style            真用：被 applySGR 更新，被 processText 读取
//   inLink / linkUrl 写而不读 —— 全仓库搜不到任何 `.inLink` 或 `.linkUrl`
//                    的读取点（除了 reset 和赋值）
//
//   它们大概是「本来想给消费方提供『现在在链接里吗』的查询入口」，
//   后来 Ansi.tsx 自己用局部变量 `currentHyperlink` 管了（124-129 行），
//   于是这两个字段成了摆设。
//
//   为什么保留：删掉要改三处，留着只有两个字段的内存。
//   **但读代码时要能分清「活着」和「留着」的字段**，否则会花时间
//   去理解一个根本没人用的状态机。
  style: TextStyle = defaultStyle()
  inLink = false
  linkUrl: string | undefined

  reset(): void {
    this.tokenizer.reset()
    this.style = defaultStyle()
    this.inLink = false
    this.linkUrl = undefined
  }

  /** Feed input and get resulting actions */
// feed：token 流 → action 流，逐条转换后拼接。
//
//   注意这里**没有跨 token 的状态机** —— 状态都在 this 上
//   （tokenizer 的内部状态 + style + link）。所以这个函数本身是薄的，
//   复杂度全在被调用的 processToken 里。
  feed(input: string): Action[] {
    const tokens = this.tokenizer.feed(input)
    const actions: Action[] = []

    for (const token of tokens) {
      const tokenActions = this.processToken(token)
      actions.push(...tokenActions)
    }

    return actions
  }

  private processToken(token: Token): Action[] {
    switch (token.type) {
      case 'text':
        return this.processText(token.value)

      case 'sequence':
        return this.processSequence(token.value)
    }
  }

// 【为什么文本要单独处理，而不是直接发射】
//
//   因为 BEL（响铃，0x07）可能嵌在文本中间。而 tokenize 的 ground 状态
//   对控制字符不敏感（只有 ESC 会离开 ground），所以 BEL 会留在
//   text token 里。
//
//   如果不拆，BEL 会被 gemerator 当成一个宽度 1 的字符塞进 span ——
//   于是「本该响铃」变成「文本里多一个不可见的占位」，后面的字符全偏一格。
//
//   拆法是把文本按 BEL 切成若干段，BEL 单独成一个 action。
//   Ansi.tsx 不处理 bell，所以它被丢掉 —— 对渲染来说正确（渲染层
//   不该响铃），但**这解释了为什么 `ESC [ m` 里的 BEL 不会响**。
  private processText(text: string): Action[] {
    // Handle BEL characters embedded in text
    const actions: Action[] = []
    let current = ''

// 逐字符累积 `current`，遇到 BEL 就切一刀。
//
//   这是 O(n) 次字符串拼接。理论上 V8 的 rope 表示让它接近 O(n)，
//   但这不是重点 —— 重点是**文本段通常很短**（一个 span 的内容），
//   而整段大文本会在上游被切好。
    for (const char of text) {
      if (char.charCodeAt(0) === C0.BEL) {
        if (current) {
          const graphemes = [...segmentGraphemes(current)]
          if (graphemes.length > 0) {
// 【`{ ...this.style }` 这个浅拷贝，是快照语义的关键】
//
//   拷贝之后，这个 action 里的 style 就与 Parser 后续的状态变化脱钩。
//   不拷贝的话，所有 text action 会共享同一个对象引用，最后
//   applySGR 一改，**前面所有段落的历史样式全部跟着变** ——
//   屏幕上整段文字变成最后的那个颜色。
//
//   这个 bug 的典型症状是「颜色只在有第二段文字时才错」，
//   因为只有一段时快照和实时值恰好相同。
//
//   注意这里只需要浅拷贝：applySGR 从不原地修改 Color 对象，
//   永远是整体替换（sgr.ts 236 行 `s.fg = { type: 'named', ... }`）。
//   **拷贝的深浅由「下游怎么改」决定**，这是判断这类问题的唯一依据。
            actions.push({ type: 'text', graphemes, style: { ...this.style } })
          }
          current = ''
        }
        actions.push({ type: 'bell' })
      } else {
        current += char
      }
    }

    if (current) {
      const graphemes = [...segmentGraphemes(current)]
      if (graphemes.length > 0) {
        actions.push({ type: 'text', graphemes, style: { ...this.style } })
      }
    }

    return actions
  }

// 【这里的分派是「按语法种类」，不是「按命令」】
//
//   四个 case 对应 identifySequence 的四个返回值，每个 case 里再
//   调对应的解析器。所以这一层的复杂度是 O(1)，二十个 if 全在
//   parseCSI 里。
//
//   ss3 单独一个 case 但直接返回 unknown —— 因为在「解析要渲染的文本」
//   这个用途里，SS3（方向键）不可能出现。留着 case 是为了让
//   `default` 只兜真正的意外。
  private processSequence(seq: string): Action[] {
    const seqType = identifySequence(seq)

    switch (seqType) {
      case 'csi': {
        const action = parseCSI(seq)
        if (!action) return []
// 【SGR 被拦下来了，返回空数组】
//
//   `this.style = applySGR(action.params, this.style)` 之后直接 `return []`
//   —— 样式变化**不进入 Action 流**，只是更新了自己的字段。
//
//   这是整层的设计核心。好处是消费方不用维护样式状态机（Ansi.tsx
//   只有 30 行逻辑），坏处是：
//     · 无法从 Action 流重建原始 ANSI 文本（样式变化丢了）
//     · 无法知道「样式是在哪两个 span 之间变的」
//     · 无法检测「多余的 SGR」（比如连着两个 `ESC [ 0 m`）
//
//   要重建就得改成「SGR 也发射一个 action，消费方自己维护状态」。
//   现在的做法选了「消费方简单」。
        if (action.type === 'sgr') {
          this.style = applySGR(action.params, this.style)
          return []
        }
        return [action]
      }

// 【OSC 的两个麻烦：剥终结符、维护链接状态】
//
//   剥终结符：tokenize 发射的序列是「含 ESC ] 和终结符」的完整串，
//   而 parseOSC 只想要中间的内容。所以这里先 slice(2) 再去尾。
//
//   顺序是先判 BEL 再判 ESC 反斜杠 —— 两者互斥（不会同时结尾），
//   顺序只影响可读性。
//
//   维护链接状态：start 时记 url，end 时清掉。这两个字段是死状态
//   （见 275 行的批注），所以真正维护链接的是 Ansi.tsx 自己。
//   **这里的状态更新是无效功**，但它存在本身就说明「曾经打算在这里管」。
      case 'osc': {
        // Extract OSC content (between ESC ] and terminator)
        let content = seq.slice(2)
        // Remove terminator (BEL or ESC \)
        if (content.endsWith('\x07')) {
          content = content.slice(0, -1)
        } else if (content.endsWith('\x1b\\')) {
          content = content.slice(0, -2)
        }

        const action = parseOSC(content)
        if (action) {
          if (action.type === 'link') {
            if (action.action.type === 'start') {
              this.inLink = true
              this.linkUrl = action.action.url
            } else {
              this.inLink = false
              this.linkUrl = undefined
            }
          }
          return [action]
        }
        return []
      }

      case 'esc': {
        const escContent = seq.slice(1)
        const action = parseEsc(escContent)
        return action ? [action] : []
      }

// SS3 直接归 unknown。
//
//   在终端模拟器里 SS3 是方向键，在「渲染一段 ANSI 文本」里它是垃圾。
//   归成 unknown 而不是 null，区别在于：unknown 会带上原文
//   （`{ type: 'unknown', sequence: seq }`），万一要排查有据可查。
//
//   而 Ansi.tsx 对 unknown 的处理是「什么都不做」，所以行为上和 null
//   一样。**类型上区分「未实现」和「无需实现」，行为上不区分** ——
//   这是可接受的折中，因为成本只有一次对象分配。
      case 'ss3':
        // SS3 sequences are typically cursor keys in application mode
        // For output parsing, treat as unknown
        return [{ type: 'unknown', sequence: seq }]

      default:
        return [{ type: 'unknown', sequence: seq }]
    }
  }
}
