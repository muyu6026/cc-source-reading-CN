import emojiRegex from 'emoji-regex'
import { eastAsianWidth } from 'get-east-asian-width'
import stripAnsi from 'strip-ansi'
import { getGraphemeSegmenter } from '../utils/intl.js'

const EMOJI_REGEX = emojiRegex()

// ═══════════════════════════════════════════════════════════════
//  宽度层：整台渲染器的「尺子」
// ═══════════════════════════════════════════════════════════════
//
//   这个函数被调用的频次是全仓库最高的（注释说约 10 万次/帧）。
//   原因很直接：终端里没有排版引擎，每一列的宽度都得自己算。
//     · yoga 只算盒子，不识字宽 —— 所以 <Text> 挂 measure 回调
//     · 裁切要按列切 —— 所以 output.ts 每一行都要量
//     · 折行要按列折 —— 所以 wrap-text 要量
//     · 光标定位要按列 —— 所以 screen.ts 要量
//   这四处的调用全部汇聚到这个文件。
//
// 【它算的不是「字符数」，是「终端会占几列」】
//   这两者在 ASCII 上一致，在其它所有地方都不一样：
//     · 汉字、假名、谚文 —— 2 列
//     · emoji —— 通常 2 列，但国旗是「一对区域指示符 = 2 列」，
//       单个区域指示符是 1 列
//     · 组合记号（重音、变音符）—— 0 列，画在基字符同一格
//     · 变体选择符、零宽连接符 —— 0 列
//     · 印度语系的合字标记 —— 0 列，但整个合字可能占 2 列（见 205 那段）
//     · 制表符 —— 由调用方按「到下一个制表位」展开，这里算 0
//
// 【两套实现，语义不完全一致（重要）】
//   Bun 有原生 Bun.stringWidth，几乎在所有平台上用它；否则退到
//   下面这个纯 JS 版本。两者在**复杂印度语合字**上的结果不同（1 vs 2），
//   而光标定位需要的是 2。也就是说：**JS fallback 在这类文本上是错的**，
//   只是错得很不显眼（那一行会偏一列）。205 行的注释承认了这件事。
/**
 * Fallback JavaScript implementation of stringWidth when Bun.stringWidth is not available.
 *
 * Get the display width of a string as it would appear in a terminal.
 *
 * This is a more accurate alternative to the string-width package that correctly handles
 * characters like ⚠ (U+26A0) which string-width incorrectly reports as width 2.
 *
 * The implementation uses eastAsianWidth directly with ambiguousAsWide: false,
 * which correctly treats ambiguous-width characters as narrow (width 1) as
 * recommended by the Unicode standard for Western contexts.
 */
// JS 版本。三级快路径，每一级都在砍掉一类开销：
//     ① 纯 ASCII —— 数非控制字符个数，O(n) 无函数调用
//     ② 含 ESC —— 先 stripAnsi，再走下面
//     ③ 无 emoji / 变体选择符 / ZWJ —— 逐码点查表，不切 grapheme
//   只有三级都不命中，才进入 Intl.Segmenter 的 grapheme 切分
//   （最慢的一条路，构造迭代器和 ICU 查询）。
//
//   这个分层设计的判据很清晰：**越常见的输入走越短的路**。
//   终端 UI 里 90% 以上的文本是 ASCII（命令、路径、代码），
//   所以第一级命中的比例极高。
function stringWidthJavaScript(str: string): number {
  if (typeof str !== 'string' || str.length === 0) {
    return 0
  }

//   第一级：纯 ASCII。
//   判据是 `code >= 127 || code === 0x1b` —— 注意 127（DEL）算非 ASCII，
//   因为它虽然是单字节但不可打印。0x1b 单独列出来是因为下面要 stripAnsi。
//
//   所以这一级里剩下的码点全在 0x00-0x7E 范围内，计数时只排除
//   `<= 0x1f`，留下的正好是 95 个可打印 ASCII，每个占 1 列。
//
//   为什么这一级值得单独写：一个 for 循环 + charCodeAt，V8 能把它
//   编译成几乎无开销的机器码。相比之下 eastAsianWidth(codePoint, ...)
//   是跨模块调用 + 一张大表。80 个 ASCII 字符的差异是几微秒 vs 几百纳秒。
  // Fast path: pure ASCII string (no ANSI codes, no wide chars)
  let isPureAscii = true
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    // Check for non-ASCII or ANSI escape (0x1b)
    if (code >= 127 || code === 0x1b) {
      isPureAscii = false
      break
    }
  }
  if (isPureAscii) {
    // Count printable characters (exclude control chars)
    let width = 0
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code > 0x1f) {
        width++
      }
    }
    return width
  }

// 第二级：剥掉 ANSI 转义序列。
//   条件是「串里含 ESC（0x1b）」。所以第一级已经排除了纯 ASCII，
//   这一级处理「含 ANSI 的纯 ASCII 文本」——
//   这是**最常见的高频场景**：带颜色的日志行、语法高亮的代码。
//
//   stripAnsi 是正则驱动的，比自己扫一遍慢，但它只在这一级跑。
//   剥完变成空串就返回 0（整串都是转义序列，没有可见内容）。
  // Strip ANSI if escape character is present
  if (str.includes('\x1b')) {
    str = stripAnsi(str)
    if (str.length === 0) {
      return 0
    }
  }

// 第三级：简单 Unicode（有宽字符但不是 emoji / 无变体选择符 / 无 ZWJ）。
//   逐**码点**遍历（for...of 在字符串上按码点迭代，能正确处理代理对），
//   零宽的跳过，其余查 eastAsianWidth。
//
//   注意这一级不切 grapheme —— 判据是「不需要切」：
//   没有 ZWJ 就没有多码点组成的合成字符，没有变体选择符就没有
//   「文本型 vs emoji 型」的分歧。所以逐码点求和等于逐 grapheme 求和。
//
//   `ambiguousAsWide: false` 是这个实现存在的**核心理由**：
//   Unicode 的 East Asian Width 有个 Ambiguous 类（⚠、★、→、℃ 等），
//   在东亚语境下是 2 列，在西文语境下是 1 列。
//   流行的 string-width 包默认当 2 列，于是「一个警告符号占了两格」
//   而终端只画了一格 —— 后面的内容全部左移一格。
//   这里明确选 1 列，因为 Claude Code 的主要用户是西文环境。
  // Fast path: simple Unicode (no emoji, variation selectors, or joiners)
  if (!needsSegmentation(str)) {
    let width = 0
    for (const char of str) {
      const codePoint = char.codePointAt(0)!
      if (!isZeroWidth(codePoint)) {
        width += eastAsianWidth(codePoint, { ambiguousAsWide: false })
      }
    }
    return width
  }

  let width = 0

// 第四级：真·grapheme 切分。只有含 emoji / 变体选择符 / ZWJ 才走到这里。
//
//   两个分支的顺序有讲究：**先判 emoji，再按普通 grapheme 处理**。
//   因为 emoji 的宽度规则是特殊的（见 getEmojiWidth）：
//   国旗是两个区域指示符组成的，整体 2 列，但逐码点求和会得到 1+1=2
//   —— 恰好对；而单个区域指示符应该是 1 列，逐码点也是 1 —— 也对。
//   真正需要特殊处理的是「不完整 keycap」（见 115 行）。
//
//   普通 grapheme 分支里那个 `break` 是关键：一个 grapheme 里
//   只数**第一个非零宽字符**的宽度，剩下的全部忽略。
//   这处理的是「基字符 + 组合记号」—— 组合记号 0 宽，所以求和也行；
//   但「基字符 + 变体选择符」这种，VS16 是 0 宽，求和也对。
//   真正需要 break 的是「多个非零宽字符组成的 grapheme」——
//   比如 Devanagari 的合字（见 205 那段），它们渲染成一个字形，
//   但每个辅音都有自己的宽度。这里选择只算第一个。
  for (const { segment: grapheme } of getGraphemeSegmenter().segment(str)) {
    // Check for emoji first (most emoji sequences are width 2)
    EMOJI_REGEX.lastIndex = 0
    if (EMOJI_REGEX.test(grapheme)) {
      width += getEmojiWidth(grapheme)
      continue
    }

    // Calculate width for non-emoji graphemes
    // For grapheme clusters (like Devanagari conjuncts with virama+ZWJ), only count
    // the first non-zero-width character's width since the cluster renders as one glyph
    for (const char of grapheme) {
      const codePoint = char.codePointAt(0)!
      if (!isZeroWidth(codePoint)) {
        width += eastAsianWidth(codePoint, { ambiguousAsWide: false })
        break
      }
    }
  }

  return width
}

// 「需要切 grapheme 吗」的判据。四类范围：
//     0x1F300-0x1FAFF  大部分 emoji（含表情、符号、交通、补充符号）
//     0x2600-0x27BF    杂项符号 + Dingbats（☀ ✓ ❤ 这类）
//     0x1F1E6-0x1F1FF  区域指示符（国旗）
//     0xFE00-0xFE0F    变体选择符（VS1-VS16）
//     0x200D           ZWJ（零宽连接符，emoji 组合的关键）
//
//   这个判据是**保守的**：只要出现这些码点就切，不做更精细的判断。
//   保守的代价是多跑一次 Segmenter（慢），收益是绝不会漏掉
//   某个需要特殊处理的组合。对于一个每帧 10 万次的函数，
//   这个取舍说明「正确性优先于极限性能」——但要配合第三级快路径
//   才成立，否则纯 ASCII 也会进 Segmenter。
function needsSegmentation(str: string): boolean {
  for (const char of str) {
    const cp = char.codePointAt(0)!
    // Emoji ranges
    if (cp >= 0x1f300 && cp <= 0x1faff) return true
    if (cp >= 0x2600 && cp <= 0x27bf) return true
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true
    // Variation selectors, ZWJ
    if (cp >= 0xfe00 && cp <= 0xfe0f) return true
    if (cp === 0x200d) return true
  }
  return false
}

// emoji 的宽度。默认 2 列，三个例外：
//
//   ① **单个区域指示符 = 1 列**。两个区域指示符拼成国旗（🇨🇳 = U+1F1E8 U+1F1F3）
//      时是 2 列。所以判据是「这个 grapheme 里有几个码点」——
//      1 个是孤立的一半（不成国旗），按 1 列；2 个才算国旗，按 2 列。
//      注意这里用 `for (const _ of grapheme) count++` 数码点，
//      不是 grapheme.length（后者是 UTF-16 码元数，代理对会算成 2）。
//
//   ② **不完整 keycap = 1 列**。完整 keycap 是「数字 + VS16 + U+20E3」，
//      渲染成一个带圈的数字，占 2 列。但如果只有「数字 + VS16」
//      而没有 U+20E3，它就只是个普通的数字，占 1 列。
//      判据写得很具体：length === 2 且第二个码点是 VS16 且第一个是
//      数字 / # / *（keycap 的合法基底）。
//
//   ③ 其余一律 2 列。这一条会误判一些单宽 emoji（比如某些符号），
//      但比「误判成 1 列」安全 —— 多算一列会导致内容右移并被裁掉尾巴，
//      少算一列会导致内容重叠压字。**宁可多占，不要重叠。**
function getEmojiWidth(grapheme: string): number {
  // Regional indicators: single = 1, pair = 2
  const first = grapheme.codePointAt(0)!
  if (first >= 0x1f1e6 && first <= 0x1f1ff) {
    let count = 0
    for (const _ of grapheme) count++
    return count === 1 ? 1 : 2
  }

  // Incomplete keycap: digit/symbol + VS16 without U+20E3
  if (grapheme.length === 2) {
    const second = grapheme.codePointAt(1)
    if (
      second === 0xfe0f &&
      ((first >= 0x30 && first <= 0x39) || first === 0x23 || first === 0x2a)
    ) {
      return 1
    }
  }

  return 2
}

// 零宽判定。这张表是这个文件的真正工作量所在 ——
//   它把 Unicode 里「不占列」的字符按用途分了十组：
//
//     快路径      0x20-0x7E 直接 false（绝大多数调用在这里返回）
//                 0xA0-0x2FF 只查软连字符 U+00AD
//     控制字符    C0（<0x20）与 C1（0x7F-0x9F）
//     零宽/不可见  ZWSP/ZWNJ/ZWJ、BOM、word joiner 系列
//     变体选择符   VS1-16 与 VS17-256（0xE0100 段）
//     组合记号     主区 + 三个扩展区（0x1AB0 / 0x1DC0 / 0x20D0 / 0xFE20）
//     印度语系     0x0900-0x0D4F（天城文到马拉雅拉姆文）用位运算批判
//     泰/老        有明确的例外（SARA AA / SARA AM 是间距元音，宽 1）
//     阿拉伯格式符  0x0600-0x0605、0x06DD、0x070F、0x08E2
//     代理对/标签  0xD800-0xDFFF、0xE0000-0xE007F
//
// 【最巧的一段：印度语系的 `codePoint & 0x7f`】
//   0x0900-0x0D4F 跨越十几个文字系统的区块，每个区块内部结构相似：
//   开头几个是符号、中间是独立元音、后面是元音符号和virama。
//   而每个区块都是 128 对齐的（0x0900、0x0980、0x0A00…），
//   所以 `cp & 0x7f` 就是「区块内偏移」。
//   于是**一条规则同时覆盖十几个文字系统**，不需要写十几张表。
//   这是「利用 Unicode 区块的对齐规律压缩代码」的典型手法 ——
//   前提是你得知道这些区块确实是 128 对齐的。
//
// 【注意 0x0E32 / 0x0E33 的例外】
//   泰语的 SARA AA 和 SARA AM 看起来像元音符号，但它们是**间距元音**
//   （占一格），不是组合记号。所以范围判定里必须把它们挖掉。
//   注释 176 行明确写了这一点 —— 这类「看起来一类、实际另一类」的
//   字符是宽度计算最大的坑。
function isZeroWidth(codePoint: number): boolean {
  // Fast path for common printable range
  if (codePoint >= 0x20 && codePoint < 0x7f) return false
  if (codePoint >= 0xa0 && codePoint < 0x0300) return codePoint === 0x00ad

  // Control characters
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true

  // Zero-width and invisible characters
  if (
    (codePoint >= 0x200b && codePoint <= 0x200d) || // ZW space/joiner
    codePoint === 0xfeff || // BOM
    (codePoint >= 0x2060 && codePoint <= 0x2064) // Word joiner etc.
  ) {
    return true
  }

  // Variation selectors
  if (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  ) {
    return true
  }

  // Combining diacritical marks
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return true
  }

// 上面那个位运算的具体切分。一个区块 128 个位置，按用途分成：
//     0x00-0x03  区块开头的符号（chandrabindu、anusvara、visarga）
//     0x3A-0x4F  元音符号 + virama（合字的关键）
//     0x51-0x57  重音符号
//     0x62-0x63  元音符号
//   其余（独立元音、辅音）都占一格。
//
//   这个切分对不对，取决于每个区块的 Unicode 布局是否一致 ——
//   大体一致，但不是 100%。所以这是一个**近似实现**，
//   错误表现为「某个罕见的组合记号被算成 1 列」（那一行偏一格）。
  // Indic script combining marks (covers Devanagari through Malayalam)
  if (codePoint >= 0x0900 && codePoint <= 0x0d4f) {
    // Signs and vowel marks at start of each script block
    const offset = codePoint & 0x7f
    if (offset <= 0x03) return true // Signs at block start
    if (offset >= 0x3a && offset <= 0x4f) return true // Vowel signs, virama
    if (offset >= 0x51 && offset <= 0x57) return true // Stress signs
    if (offset >= 0x62 && offset <= 0x63) return true // Vowel signs
  }

  // Thai/Lao combining marks
  // Note: U+0E32 (SARA AA), U+0E33 (SARA AM), U+0EB2, U+0EB3 are spacing vowels (width 1), not combining marks
  if (
    codePoint === 0x0e31 || // Thai MAI HAN-AKAT
    (codePoint >= 0x0e34 && codePoint <= 0x0e3a) || // Thai vowel signs (skip U+0E32, U+0E33)
    (codePoint >= 0x0e47 && codePoint <= 0x0e4e) || // Thai vowel signs and marks
    codePoint === 0x0eb1 || // Lao MAI KAN
    (codePoint >= 0x0eb4 && codePoint <= 0x0ebc) || // Lao vowel signs (skip U+0EB2, U+0EB3)
    (codePoint >= 0x0ec8 && codePoint <= 0x0ecd) // Lao tone marks
  ) {
    return true
  }

  // Arabic formatting
  if (
    (codePoint >= 0x0600 && codePoint <= 0x0605) ||
    codePoint === 0x06dd ||
    codePoint === 0x070f ||
    codePoint === 0x08e2
  ) {
    return true
  }

  // Surrogates, tag characters
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return true
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return true

  return false
}

// 这段注释是整份文件最值得读的：**它承认了 JS 版本是错的**。
//
//   以 Devanagari 的 क्ष（ka + virama + ZWJ + ssa）为例：
//     · 它渲染成**一个合字字形**
//     · 但终端分配了 **2 个格子**（wcwidth 逐个辅音求和）
//     · 而 JS 版本按 grapheme 处理，只数第一个非零宽字符 → 得到 1
//     · Bun.stringWidth 返回 2，与终端分配一致
//
//   为什么必须用 2：这个函数的返回值用来**定位光标**。
//   如果算成 1，我们就会认为只占一格，于是下一个字符写到第 x+1 列，
//   而终端已经把它画在第 x+2 列 —— 从这一格开始，整行都错位。
//
//   所以这里的取舍是明确的：
//     「逻辑上正确的 grapheme 宽度」vs「与终端实际分配一致的宽度」
//   选后者。因为**我们要对齐的不是 Unicode 语义，是终端的格子。**
//
// 【这才是 Bun 依赖的真正原因】
//   不是因为快（虽然确实快），是因为它的宽度语义与终端一致，
//   而 JS 版本做不到（做得到但要写完整的 wcwidth 表）。
//   换句话说：这个项目对 Bun 的依赖，一部分是性能，一部分是正确性。
//   在 Node 下跑就会遇到这个 1 vs 2 的偏差 —— 影响范围仅限
//   复杂印度语文本，但一旦遇到就是逐行错位。
// Note: complex-script graphemes like Devanagari क्ष (ka+virama+ZWJ+ssa) render
// as a single ligature glyph but occupy 2 terminal cells (wcwidth sums the base
// consonants). Bun.stringWidth=2 matches terminal cell allocation, which is what
// we need for cursor positioning — the JS fallback's grapheme-cluster width of 1
// would desync Ink's layout from the terminal.
//
// Bun.stringWidth is resolved once at module scope rather than checked on every
// call — typeof guards deopt property access and this is a hot path (~100k calls/frame).
// 在模块作用域解析一次，每次调用不再判断。
//
//   理由注释写得很具体：`typeof` 守卫会让属性访问**去优化**（deopt），
//   而这是每帧 10 万次的热路径。一旦某个函数里的 typeof 检查让
//   V8 把 `Bun.stringWidth` 的属性加载从「内联缓存命中」降级成
//   「通用查找」，那 10 万次调用每次都要多几十纳秒 —— 加起来是毫秒级。
//
//   手法：把「有没有 Bun」这个**环境判断**从调用路径挪到加载路径。
//   环境在进程生命周期内不变，所以判断只需要一次。
//   这是所有热路径适配层的标准写法（和 colorize.ts 里那两个
//   模块级常量是同一个模式）。
const bunStringWidth =
  typeof Bun !== 'undefined' && typeof Bun.stringWidth === 'function'
    ? Bun.stringWidth
    : null

// Bun 的选项名和 JS 版的差一个词：`ambiguousIsNarrow` vs
// `ambiguousAsWide: false`，语义相同（Ambiguous 类按窄处理）。
//   两个库对这个概念的默认值不同，所以两边都要显式指定 ——
//   如果只在一个实现里指定，换运行时就会得到不同的宽度。
//
//   这也是「同一语义两个实现」最典型的坑：**默认值不一致**。
//   类型系统看不出这件事，只有跑起来、遇到 ⚠ 或 ★ 才会发现。
const BUN_STRING_WIDTH_OPTS = { ambiguousIsNarrow: true } as const

export const stringWidth: (str: string) => number = bunStringWidth
  ? str => bunStringWidth(str, BUN_STRING_WIDTH_OPTS)
  : stringWidthJavaScript
