// ═══════════════════════════════════════════════════════════════
//  bidi：在**不支持**的地方自己排一遍
// ═══════════════════════════════════════════════════════════════
//
//  这份文件最值得记的不是算法，是**在哪里启用**的判据：
//
//      process.platform === 'win32'  或  WT_SESSION  或  TERM_PROGRAM=vscode
//
//  也就是说：只有在「终端自己不会排」的地方才排。macOS / Linux 的
//  原生终端（Terminal.app、iTerm2、GNOME Terminal）已经实现了 UBA，
//  由它们排 —— 你再排一遍就是**双重反转**，RTL 文本会变回错的。
//
//  这种「有能力的地方交给对方，没能力的地方自己补」的分工，比
//  「到处都自己算一遍」稳得多：自己算的结果未必跟终端一致（字体、
//  连字、双向数字的处理各家有差异），交给终端才是像素级的正确。
//
//  VS Code 被算进来是因为它的终端是 xterm.js —— 一个 JS 实现的终端
//  模拟器，没有实现 bidi。这一条很容易漏：`TERM_PROGRAM=vscode`
//  看起来像「一个正经终端」，实际上是网页。
/**
 * Bidirectional text reordering for terminal rendering.
 *
 * Terminals on Windows do not implement the Unicode Bidi Algorithm,
 * so RTL text (Hebrew, Arabic, etc.) appears reversed. This module
 * applies the bidi algorithm to reorder ClusteredChar arrays from
 * logical order to visual order before Ink's LTR cell placement loop.
 *
 * On macOS terminals (Terminal.app, iTerm2) bidi works natively.
 * Windows Terminal (including WSL) does not implement bidi
 * (https://github.com/microsoft/terminal/issues/538).
 *
 * Detection: Windows Terminal sets WT_SESSION; native Windows cmd/conhost
 * also lacks bidi. We enable bidi reordering when running on Windows or
 * inside Windows Terminal (covers WSL).
 */
import bidiFactory from 'bidi-js'

// 这个类型是**结构**描述（value + width + styleId + hyperlink），
// 跟 output.ts 里 `styledCharsWithGraphemeClustering` 的产物对齐。
//
// 注意它没有 import —— 是本地重复定义的。理由是避免 bidi.ts 依赖
// output.ts（那就循环了）。代价是两边改字段时要手动同步。
type ClusteredChar = {
  value: string
  width: number
  styleId: number
  hyperlink: string | undefined
}

// 两个模块级缓存，都带 `undefined` 三态：
//   `bidiInstance`  —— bidi-js 的工厂产物（首次用到才建）
//   `needsSoftwareBidi` —— 环境判定的结果（算一次）
//
// 环境判定也缓存，是因为它读 process.env / platform —— 这些值理论上
// 不会变，但每次读都有成本（env 是 Proxy）。判定一次最省。
let bidiInstance: ReturnType<typeof bidiFactory> | undefined
let needsSoftwareBidi: boolean | undefined

function needsBidi(): boolean {
  if (needsSoftwareBidi === undefined) {
    needsSoftwareBidi =
      process.platform === 'win32' ||
      typeof process.env['WT_SESSION'] === 'string' || // WSL in Windows Terminal
      process.env['TERM_PROGRAM'] === 'vscode' // VS Code integrated terminal (xterm.js)
  }
  return needsSoftwareBidi
}

function getBidi() {
  if (!bidiInstance) {
    bidiInstance = bidiFactory()
  }
  return bidiInstance
}

/**
 * Reorder an array of ClusteredChars from logical order to visual order
 * using the Unicode Bidi Algorithm. Active on terminals that lack native
 * bidi support (Windows Terminal, conhost, WSL).
 *
 * Returns the same array on bidi-capable terminals (no-op).
 */
// 入口。三道早退，顺序按「便宜程度」排：
//
//   1. `!needsBidi()`        —— 一次布尔判断，绝大多数平台在这里返回
//   2. `length === 0`        —— 空行
//   3. `!hasRTLCharacters()` —— 一次正则扫描
//
// 第 3 道是性能关键：在一台 Windows 机器上，**99% 的行是纯 LTR**
// （英文代码、中文）。跑完整 UBA 要建字符类表、算嵌入层级、做重排，
// 而一次正则就能排除掉。所以这个「快速排除」不是微优化，是把
// 一个每行都要付的成本降到一个正则。
export function reorderBidi(characters: ClusteredChar[]): ClusteredChar[] {
  if (!needsBidi() || characters.length === 0) {
    return characters
  }

  // Build a plain string from the clustered chars to run through bidi
// 把 ClusteredChar 数组拼回一个字符串。注意这里**丢掉了样式**——
// UBA 只需要字符本身。所以重排之后再按位置映射回去，样式跟着字符走。
//
// 这个「先摊平再按索引映射回来」的模式，跟 searchHighlight 里
// 的 codeUnitToCell 是同一类问题：**字符数组和 code unit 数组的
// 下标不是一回事**。
  const plainText = characters.map(c => c.value).join('')

  // Check if there are any RTL characters — skip bidi if pure LTR
  if (!hasRTLCharacters(plainText)) {
    return characters
  }

// `getEmbeddingLevels(text, 'auto')` —— 第二个参数是段落方向，
// 'auto' 表示按首强字符推断（跟浏览器的 dir="auto" 一样）。
//
// 返回的 `levels` 是**每个 code unit** 一个数字（UBA 的嵌入层级，
// 偶数 = LTR、奇数 = RTL，数字越大嵌套越深）。
  const bidi = getBidi()
  const { levels } = bidi.getEmbeddingLevels(plainText, 'auto')

// 这里是整份文件最容易出错的地方：把 code-unit 级的 levels 映射回
// ClusteredChar 级。
//
// 做法是取**每个簇首字符**的 level（`levels[offset]`），然后
// `offset += value.length` 跳到下一个簇。取首字符而不是取最大值，
// 是因为 UBA 的规则里一个簇的字符通常同层（组合符号继承基字符的
// 方向）。如果取 max，一个 LTR 基字符 + RTL 组合符就会把整个簇判成
// RTL —— 那是错的。
//
// 另一个隐含假设：簇的 value 在拼成的字符串里**连续**。这个假设成立，
// 因为 plainText 就是按顺序 join 出来的。
  // Map bidi levels back to ClusteredChar indices.
  // Each ClusteredChar may be multiple code units in the joined string.
  const charLevels: number[] = []
  let offset = 0
  for (let i = 0; i < characters.length; i++) {
    charLevels.push(levels[offset]!)
    offset += characters[i]!.value.length
  }

// 这里没用 bidi-js 自己的 `getReorderSegments()`，而是手写了标准
// 重排算法。注释说清了理由：「we need to work at the ClusteredChar
// level, not the string level」—— 库给的是字符串级的段，而这里
// 要重排的是「簇数组」，两者的下标空间不同。
//
// 算法本身是 UBA 的 L2 规则：
//   从最大层级往下，对每个层级，反转所有「连续 >= 该层级」的段。
//
// 为什么这样能得到正确的嵌套顺序：内层（层级高）先反转，外层
// （层级低）后反转时会把内层的结果当成整体再翻回来。这是 UBA
// 规范里的原始表述，比任何解释都简洁。
  // Get reorder segments from bidi-js, but we need to work at the
  // ClusteredChar level, not the string level. We'll implement the
  // standard bidi reordering: find the max level, then for each level
  // from max down to 1, reverse all contiguous runs >= that level.
  const reordered = [...characters]
  const maxLevel = Math.max(...charLevels)

  for (let level = maxLevel; level >= 1; level--) {
    let i = 0
    while (i < reordered.length) {
      if (charLevels[i]! >= level) {
        // Find the end of this run
        let j = i + 1
        while (j < reordered.length && charLevels[j]! >= level) {
          j++
        }
        // Reverse the run in both arrays
        reverseRange(reordered, i, j - 1)
// ⚠️ 这一行是全文件最容易漏的：**levels 数组也要跟着反转**。
//
// 如果只反转字符、不反转 levels，那么下一轮（level 更低的）用错位
// 的 levels 判断连续段 —— 结果是一部分该翻的没翻、一部分不该翻的
// 翻了。而且**不会报错**，只是 RTL 文本的呈现顺序错乱，看起来像
// 「字体问题」或「终端问题」。
//
// 这种「两个平行数组必须同步重排」的地方，是手写重排最危险的坑。
        reverseRangeNumbers(charLevels, i, j - 1)
        i = j
      } else {
        i++
      }
    }
  }

  return reordered
}

function reverseRange<T>(arr: T[], start: number, end: number): void {
  while (start < end) {
    const temp = arr[start]!
    arr[start] = arr[end]!
    arr[end] = temp
    start++
    end--
  }
}

function reverseRangeNumbers(arr: number[], start: number, end: number): void {
  while (start < end) {
    const temp = arr[start]!
    arr[start] = arr[end]!
    arr[end] = temp
    start++
    end--
  }
}

/**
 * Quick check for RTL characters (Hebrew, Arabic, and related scripts).
 * Avoids running the full bidi algorithm on pure-LTR text.
 */
// 快速排除。字符区间列表覆盖了主要 RTL 文字：
//   希伯来（0590-05FF、FB1D-FB4F）、阿拉伯（0600-06FF、0750-077F、
//   08A0-08FF、FB50-FDFF、FE70-FEFF）、叙利亚（0700-074F）、
//   塔纳（0780-07BF）。
//
// 注意这是「**有没有** RTL」而不是「是不是全 RTL」—— 混排行（英文
// 里夹一个阿拉伯词）也必须进重排，那种行恰恰最需要 UBA。
//
// 这个正则的代价是每行一次全扫。对于长行（比如 4000 字符的
// sourceMappingURL）会有点慢，但 bidi 只在 Windows 上开，
// 而且那种行本来也走不到渲染（见 annotate.py 里的省略规则）。
function hasRTLCharacters(text: string): boolean {
  // Hebrew: U+0590-U+05FF, U+FB1D-U+FB4F
  // Arabic: U+0600-U+06FF, U+0750-U+077F, U+08A0-U+08FF, U+FB50-U+FDFF, U+FE70-U+FEFF
  // Thaana: U+0780-U+07BF
  // Syriac: U+0700-U+074F
  return /[\u0590-\u05FF\uFB1D-\uFB4F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0780-\u07BF\u0700-\u074F]/u.test(
    text,
  )
}
// 一个已知的不完整之处：RTL 的**数字**（阿拉伯-印度数字 ٠١٢٣）和
// 中性标点（括号、逗号）的方向由 UBA 的 W/N 规则决定，不在这份
// 正则的覆盖范围内。
//
// 后果是：纯阿拉伯数字的行不会被重排。这在实践中几乎无害
// （数字的视觉顺序在大多数终端里本来就是对的），但严格来说
// 这份实现是「RTL 文字的近似重排」，不是完整的 UBA 前端。
//
// 这种「近似但对 99% 场景正确」的取舍，在 TUI 里是合理的：
// 完整的 UBA 需要处理段落分隔、显式嵌入符（LRE/RLE/PDF）、
// 镜像字符（括号方向翻转），成本远高于收益。
