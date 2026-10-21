import {
  type AnsiCode,
  ansiCodesToString,
  diffAnsiCodes,
} from '@alcalzone/ansi-tokenize'
import {
  type Point,
  type Rectangle,
  type Size,
  unionRect,
} from './layout/geometry.js'
import { BEL, ESC, SEP } from './termio/ansi.js'
import * as warn from './warn.js'

// ═══════════════════════════════════════════════════════════════
//  第三层之一：屏幕缓冲区 —— 一张「字符 + 样式」的二维表
// ═══════════════════════════════════════════════════════════════
//
//   上一层（dom/reconciler）给的是树和坐标；这一层把它压平成格子。
//   一个 Screen 就是 width × height 个格子，每格记四样东西：
//     字符、样式、宽度分类、超链接
//
// 【本文件三个最值得看的点】
//   ① 129  intern 的 bit 0 —— 用「ID 的最低位」编码「这个样式在空格上
//      有没有视觉效果」。下游靠一次位与就跳过整批不可见的空格。
//   ② 289  CellWidth 四态 —— 宽字符（汉字、emoji）占两格，但这里不是
//      「渲染时才发现」，而是**显式写一个占位格**。选这个的代价与收益。
//   ③ 693  setCellAt 的三种幽灵 —— 宽字符被覆盖时的三种残留形态，
//      每一种都对应一条「不清理就出鬼影」的规则。
//
// 【为什么不用对象数组】
//   200×120 的屏幕就是 24,000 个格子。每格一个对象 = 24,000 次分配/帧，
//   GC 压力直接体现在滚动流畅度上。这里用一条 Int32Array 装下所有格子
//   （每格两个 int），390 行的注释给了完整理由。
//
// 【本层与上下层的数据契约】
//   上：output.write / output.blit / output.clear 只改 cells（不改终端）
//   下：log-update.ts 读 cells，与上一帧 diff，产出最小的转义序列
//   中间没有任何一步碰终端 —— 这是「先算完一整帧再落盘」的前提
// --- Shared Pools (interning for memory efficiency) ---

// Character string pool shared across all screens.
// With a shared pool, interned char IDs are valid across screens,
// so blitRegion can copy IDs directly (no re-interning) and
// diffEach can compare IDs as integers (no string lookup).
// 【为什么这个池必须跨屏幕共享】
//
//   屏幕上存的是 charId（整数），不是字符本身。如果每个 Screen 有自己的池，
//   那 A 屏的第 7 号字符和 B 屏的第 7 号字符可能是不同的东西 ——
//   于是 blit（从 A 屏拷格子到 B 屏）就得把每个 ID 重新翻译一遍。
//
//   共享之后，ID 在全进程内唯一，两个后果都是性能：
//     · blitRegion 直接 memcpy 整数，不碰字符串
//     · diffEach 比较两个整数是否相等，不做字符串比较
//
//   代价：池只增不减（见 540 行的注释），所以需要偶尔换代（migrateScreenPools）。
export class CharPool {
  private strings: string[] = [' ', ''] // Index 0 = space, 1 = empty (spacer)
  private stringMap = new Map<string, number>([
    [' ', 0],
    ['', 1],
  ])
// 【ASCII 快表：为什么值得多维护一张 128 槽的数组】
//
//   屏幕里绝大多数格子是 ASCII（空格、字母、数字、标点）。
//   走 Map 要先哈希字符串；走这里是一次数组索引。
//   `-1` 表示「这个码点还没被 intern 过」，不是「不存在」。
//
//   注意它和 stringMap 是**两份索引**：ASCII 命中时压根不查 Map，
//   非 ASCII（汉字、emoji）才落到 Map。两条路径写同一份 strings 数组。
  private ascii: Int32Array = initCharAscii() // charCode → index, -1 = not interned

  intern(char: string): number {
    // ASCII fast-path: direct array lookup instead of Map.get
    if (char.length === 1) {
      const code = char.charCodeAt(0)
      if (code < 128) {
        const cached = this.ascii[code]!
        if (cached !== -1) return cached
        const index = this.strings.length
        this.strings.push(char)
        this.ascii[code] = index
        return index
      }
    }
    const existing = this.stringMap.get(char)
    if (existing !== undefined) return existing
    const index = this.strings.length
    this.strings.push(char)
    this.stringMap.set(char, index)
    return index
  }

  get(index: number): string {
    return this.strings[index] ?? ' '
  }
}

// Hyperlink string pool shared across all screens.
// Index 0 = no hyperlink.
// 【超链接也是 ID，而且 0 有特殊含义】
//
//   index 0 = '' = 「没有链接」。整个文件反复出现「hid === 0 ? undefined」，
//   靠的就是这条约定。和 CharPool 把 ' ' 放在 0 号位是同一个思路：
//   **让「默认值」等于「数组下标 0」**，这样零填充的缓冲区天然是合法状态。
//
//   OSC 8 超链接是终端层面的一个「模式」而不是逐字符属性，
//   但存的时候按格子存 —— 因为同一行的不同片段可能是不同链接。
export class HyperlinkPool {
  private strings: string[] = [''] // Index 0 = no hyperlink
  private stringMap = new Map<string, number>()

  intern(hyperlink: string | undefined): number {
    if (!hyperlink) return 0
    let id = this.stringMap.get(hyperlink)
    if (id === undefined) {
      id = this.strings.length
      this.strings.push(hyperlink)
      this.stringMap.set(hyperlink, id)
    }
    return id
  }

  get(id: number): string | undefined {
    return id === 0 ? undefined : this.strings[id]
  }
}

// 【四个样式常量，看点在 endCode 而不在 code】
//
//   code 是「打开」，endCode 是「关闭」。这个文件后面判断
//   「这个样式在空格上有没有视觉效果」（271 行）时，**只用 endCode 做匹配**。
//   所以下面这几行的 endCode 写错，不会报错，只会让某些空格莫名其妙被跳过或不被跳过。
//
//   INVERSE 的 endCode 是 27m —— 它同时是「反色的标志位」：
//   StylePool.withInverse 用 `c.endCode === '\x1b[27m'` 判断「已经反过色了」。
//   一个字符串常量被当成类型标签用，这个模式在本文件出现多次。
// SGR 7 (inverse) as an AnsiCode. endCode '\x1b[27m' flags VISIBLE_ON_SPACE
// so bit 0 of the resulting styleId is set → renderer won't skip inverted
// spaces as invisible.
const INVERSE_CODE: AnsiCode = {
  type: 'ansi',
  code: '\x1b[7m',
  endCode: '\x1b[27m',
}
// Bold (SGR 1) — stacks cleanly, no reflow in monospace. endCode 22
// also cancels dim (SGR 2); harmless here since we never add dim.
const BOLD_CODE: AnsiCode = {
  type: 'ansi',
  code: '\x1b[1m',
  endCode: '\x1b[22m',
}
// Underline (SGR 4). Kept alongside yellow+bold — the underline is the
// unambiguous visible-on-any-theme marker. Yellow-bg-via-inverse can
// clash with existing bg colors (user-prompt style, tool chrome, syntax
// bg). If you see underline but no yellow, the yellow is being lost in
// the existing cell styling — the overlay IS finding the match.
const UNDERLINE_CODE: AnsiCode = {
  type: 'ansi',
  code: '\x1b[4m',
  endCode: '\x1b[24m',
}
// 【黄色不直接用「黄色背景」，而是「黄前景 + 反色」】
//
//   因为反色在终端里是**交换前景和背景**，所以先设黄前景、再开反色，
//   视觉上就是黄底。这么做而不是直接发 48;5;xx（设背景色）的理由是：
//   48;5 是 256 色/真彩扩展，而 33m（黄前景）+ 7m（反色）是 80 年代就有的
//   基础 SGR，在任何终端上都成立。
//
//   代价写在 204 行：如果格子本来有显式背景色，两个显式颜色做反色交换时
//   语义因终端而异（有的给「黄底默认字」，有的给「灰底黄字」）。
//   解法是先把原有 fg 和 bg 都滤掉。
// fg→yellow (SGR 33). With inverse already in the stack, the terminal
// swaps fg↔bg at render — so yellow-fg becomes yellow-BG. Original bg
// becomes fg (readable on most themes: dark-bg → dark-text on yellow).
// endCode 39 is 'default fg' — cancels any prior fg color cleanly.
const YELLOW_FG_CODE: AnsiCode = {
  type: 'ansi',
  code: '\x1b[33m',
  endCode: '\x1b[39m',
}

// ═══════════════════════════════════════════════════════════════
//  StylePool：把「一组 ANSI 码」压成一个整数
// ═══════════════════════════════════════════════════════════════
//
//   屏幕每格存 styleId（整数）而不是 AnsiCode[]（数组），理由同 CharPool。
//   这个类上挂了四张缓存，各有各的键：
//
//     ids               AnsiCode[] 序列 → styleId
//     transitionCache   (fromId, toId)  → 转义字符串
//     inverseCache      baseId         → 反色版 styleId
//     selectionBgCache  baseId         → 选中底色版 styleId
//
//   后两张是「对已有样式的变体」，不进 ids 表；只有 intern 出来的才进。
//   所以同一个视觉样式可能有两个不同 styleId（原版和反色版），
//   这是有意的 —— 它们本来就是两种格子状态。
export class StylePool {
  private ids = new Map<string, number>()
  private styles: AnsiCode[][] = []
  private transitionCache = new Map<number, string>()
  readonly none: number

  constructor() {
    this.none = this.intern([])
  }

  /**
   * Intern a style and return its ID. Bit 0 of the ID encodes whether the
   * style has a visible effect on space characters (background, inverse,
   * underline, etc.). Foreground-only styles get even IDs; styles visible
   * on spaces get odd IDs. This lets the renderer skip invisible spaces
   * with a single bitmask check on the packed word.
   */
// 【本文件最精妙的一处设计：用 ID 的最低位当标签】
//
//   一个样式 ID 同时编码两件事：
//     高位（>>> 1）  → 在 this.styles 里的下标
//     最低位（& 1）  → 这个样式作用在**空格**上时，有没有视觉效果
//
//   「有视觉效果」= 背景色、反色、下划线、删除线、上划线（271 行那张表）。
//   只有前景色的样式，画在空格上跟没画一样 —— 终端里看不到任何区别。
//
//   下游怎么用？visibleCellAtIndex（639 行）对整格做一次位与：
//     (word1 & 0x3fffc) === 0  →  这格是空格、没链接、样式也不可见
//   一个操作同时问了三个问题，然后整格跳过不写。
//
//   这是「把语义塞进 ID 的冗余位」的典型用法。代价是 get() 必须
//   `id >>> 1` 才能取回样式 —— 这个小代价换掉的是每格每帧一次数组查找。
//
//   ⚠ 隐含上限：STYLE_SHIFT 是 17，Int32 的符号位在第 31 位，
//   所以 styleId 只有 15 位有效（< 32768）。再因为最低位是标签，
//   实际样式数上限是 16384。没有任何断言保护这条线 —— 超了会静默溢出到符号位。
  intern(styles: AnsiCode[]): number {
    const key = styles.length === 0 ? '' : styles.map(s => s.code).join('\0')
    let id = this.ids.get(key)
    if (id === undefined) {
      const rawId = this.styles.length
      this.styles.push(styles.length === 0 ? [] : styles)
      id =
        (rawId << 1) |
        (styles.length > 0 && hasVisibleSpaceEffect(styles) ? 1 : 0)
      this.ids.set(key, id)
    }
    return id
  }

  /** Recover styles from an encoded ID. Strips the bit-0 flag via >>> 1. */
  get(id: number): AnsiCode[] {
    return this.styles[id >>> 1] ?? []
  }

  /**
   * Returns the pre-serialized ANSI string to transition from one style to
   * another. Cached by (fromId, toId) — zero allocations after first call
   * for a given pair.
   */
// 【(from, to) → 转义串，缓存键是算术拼的】
//
//   一次样式切换要算「从当前样式到目标样式要发哪些 SGR」。这个计算不便宜
//   （要遍历两边求差集），但结果是纯函数 —— 同一对 (from, to) 永远同一个串。
//
//   键用 `fromId * 0x100000 + toId` 而不是 `${from},${to}`：
//   多一次字符串分配就多一次 GC，而这是个每格都会查的表。
//   0x100000 = 2^20，等于宣称「toId 不会超过 2^20」—— 对 15 位 styleId 是安全的。
//
//   fromId === toId 时直接返回空串，不进缓存 —— 最常见的调用，
//   省掉一次 Map 查找。
  transition(fromId: number, toId: number): string {
    if (fromId === toId) return ''
    const key = fromId * 0x100000 + toId
    let str = this.transitionCache.get(key)
    if (str === undefined) {
      str = ansiCodesToString(diffAnsiCodes(this.get(fromId), this.get(toId)))
      this.transitionCache.set(key, str)
    }
    return str
  }

  /**
   * Intern a style that is `base + inverse`. Cached by base ID so
   * repeated calls for the same underlying style don't re-scan the
   * AnsiCode[] array. Used by the selection overlay.
   */
  private inverseCache = new Map<number, number>()
// 【已经反色过就不再叠加】
//
//   SGR 7 在大多数终端里是「切换」语义，连发两次会变回正常色。
//   所以这里先扫一遍 baseCodes，发现 27m 就直接用 baseId。
//
//   这一行同时解释了下游的一个行为：withInverse 是幂等的，
//   调用方不用关心自己拿到的是不是已经反色的样式。
  withInverse(baseId: number): number {
    let id = this.inverseCache.get(baseId)
    if (id === undefined) {
      const baseCodes = this.get(baseId)
      // If already inverted, use as-is (avoids SGR 7 stacking)
      const hasInverse = baseCodes.some(c => c.endCode === '\x1b[27m')
      id = hasInverse ? baseId : this.intern([...baseCodes, INVERSE_CODE])
      this.inverseCache.set(baseId, id)
    }
    return id
  }

  /** Inverse + bold + yellow-bg-via-fg-swap for the CURRENT search match.
   *  OTHER matches are plain inverse — bg inherits from the theme. Current
   *  gets a distinct yellow bg (via fg-then-inverse swap) plus bold weight
   *  so it stands out in a sea of inverse. Underline was too subtle. Zero
   *  reflow risk: all pure SGR overlays, per-cell, post-layout. The yellow
   *  overrides any existing fg (syntax highlighting) on those cells — fine,
   *  the "you are here" signal IS the point, syntax color can yield. */
  private currentMatchCache = new Map<number, number>()
// 【当前搜索命中：为什么要同时滤掉 fg 和 bg】
//
//   目标效果：黄底 + 默认字色。手段是「黄前景 + 反色」（终端会把它们交换）。
//
//   如果格子里本来有显式背景色（用户输入框那个灰底），反色时就是
//   「黄 fg ↔ 灰 bg」的交换 —— 但两个颜色都显式指定时，交换语义因终端而异：
//   有的给灰底黄字，有的给黄底灰字。搜索结果在不同终端上长得不一样。
//
//   解法：把 endCode 是 39m（默认前景）和 49m（默认背景）的**都滤掉**，
//   让反色面对的是「无色可换」的干净状态，结果就是确定的黄底 + 终端默认字。
//
//   下面 210 行的注释还留了一条排障线索：如果看到下划线但没看到黄色，
//   说明覆盖层确实命中这一格了，只是黄色在样式冲突里输了。
  withCurrentMatch(baseId: number): number {
    let id = this.currentMatchCache.get(baseId)
    if (id === undefined) {
      const baseCodes = this.get(baseId)
      // Filter BOTH fg + bg so yellow-via-inverse is unambiguous.
      // User-prompt cells have an explicit bg (grey box); with that bg
      // still set, inverse swaps yellow-fg↔grey-bg → grey-on-yellow on
      // SOME terminals, yellow-on-grey on others (inverse semantics vary
      // when both colors are explicit). Filtering both gives clean
      // yellow-bg + terminal-default-fg everywhere. Bold/dim/italic
      // coexist — keep those.
      const codes = baseCodes.filter(
        c => c.endCode !== '\x1b[39m' && c.endCode !== '\x1b[49m',
      )
      // fg-yellow FIRST so inverse swaps it to bg. Bold after inverse is
      // fine — SGR 1 is fg-attribute-only, order-independent vs 7.
      codes.push(YELLOW_FG_CODE)
      if (!baseCodes.some(c => c.endCode === '\x1b[27m'))
        codes.push(INVERSE_CODE)
      if (!baseCodes.some(c => c.endCode === '\x1b[22m')) codes.push(BOLD_CODE)
      // Underline as the unambiguous marker — yellow-bg can clash with
      // existing bg styling (user-prompt bg, syntax bg). If you see
      // underline but no yellow on a match, the overlay IS finding it;
      // the yellow is just losing a styling fight.
      if (!baseCodes.some(c => c.endCode === '\x1b[24m'))
        codes.push(UNDERLINE_CODE)
      id = this.intern(codes)
      this.currentMatchCache.set(baseId, id)
    }
    return id
  }

  /**
   * Selection overlay: REPLACE the cell's background with a solid color
   * while preserving its foreground (color, bold, italic, dim, underline).
   * Matches native terminal selection — a dedicated bg color, not SGR-7
   * inverse. Inverse swaps fg/bg per-cell, which fragments visually over
   * syntax-highlighted text (every fg color becomes a different bg stripe).
   *
   * Strips any existing bg (endCode 49m — REPLACES, so diff-added green
   * etc. don't bleed through) and any existing inverse (endCode 27m —
   * inverse on top of a solid bg would re-swap and look wrong).
   *
   * bg is set via setSelectionBg(); null → fallback to withInverse() so the
   * overlay still works before theme wiring sets a color (tests, first frame).
   * Cache is keyed by baseId only — setSelectionBg() clears it on change.
   */
  private selectionBgCode: AnsiCode | null = null
  private selectionBgCache = new Map<number, number>()
  setSelectionBg(bg: AnsiCode | null): void {
    if (this.selectionBgCode?.code === bg?.code) return
    this.selectionBgCode = bg
    this.selectionBgCache.clear()
  }
// 【选中底色为什么不用反色】
//
//   反色是逐格交换 fg/bg。一段有语法高亮的代码被选中时，每一个前景色
//   都会变成不同的背景色 —— 视觉上碎成一条条彩色斑马纹。
//   原生终端的选中是「整块涂一个底色，前景不变」，所以这里也这么做。
//
//   代价是要自己管「底色从哪来」：setSelectionBg 由主题决定，
//   在主题还没接上之前（首帧、测试）是 null，此时回落到反色。
//   这个回落让「选中」在两种状态下都可见，只是长得不一样。
  withSelectionBg(baseId: number): number {
    const bg = this.selectionBgCode
    if (bg === null) return this.withInverse(baseId)
    let id = this.selectionBgCache.get(baseId)
    if (id === undefined) {
      // Keep everything except bg (49m) and inverse (27m). Fg, bold, dim,
      // italic, underline, strikethrough all preserved.
      const kept = this.get(baseId).filter(
        c => c.endCode !== '\x1b[49m' && c.endCode !== '\x1b[27m',
      )
      kept.push(bg)
      id = this.intern(kept)
      this.selectionBgCache.set(baseId, id)
    }
    return id
  }
}

// endCodes that produce visible effects on space characters
const VISIBLE_ON_SPACE = new Set([
  '\x1b[49m', // background color
  '\x1b[27m', // inverse
  '\x1b[24m', // underline
  '\x1b[29m', // strikethrough
  '\x1b[55m', // overline
])

// 【判据只有一条：这个样式画在空格上，人眼能不能看出来】
//
//   这五个 endCode 对应：背景色、反色、下划线、删除线、上划线。
//   全是「不管格子里是什么字符都能看见」的样式。
//
//   反过来的例子：前景色、加粗、斜体、变暗 —— 空格没有笔画，
//   这些属性画在空格上等于没画。0 号位（' '）配上这些样式，
//   在终端里和「什么都不写」完全一样，所以整格可以跳过。
//
//   ⚠ 这张表只认 endCode。如果某个样式的 endCode 写得不规范
//   （比如用了 39m 之外的「恢复前景」码），它就会被判成「不可见」，
//   于是该加底色的空格不加底色 —— 这类 bug 不会报错，只会让某些
//   界面元素在特定终端上消失。
function hasVisibleSpaceEffect(styles: AnsiCode[]): boolean {
  for (const style of styles) {
    if (VISIBLE_ON_SPACE.has(style.endCode)) return true
  }
  return false
}

/**
 * Cell width classification for handling double-wide characters (CJK, emoji,
 * etc.)
 *
 * We use explicit spacer cells rather than inferring width at render time. This
 * makes the data structure self-describing and simplifies cursor positioning
 * logic.
 *
 * @see https://mitchellh.com/writing/grapheme-clusters-in-terminals
 */
// const enum is inlined at compile time - no runtime object, no property access
// ═══════════════════════════════════════════════════════════════
//  CellWidth：宽字符的四种身份
// ═══════════════════════════════════════════════════════════════
//
//   汉字的宽度是 2，终端画它时占两列。缓冲区必须跟着占两格，
//   否则「第 x 列」这个坐标就没有意义了。
//
//   做法不是「让每格自己知道自己多宽」，而是**显式写一个占位格**：
//
//     [本][  ]    ← 第一格 Wide（真字符），第二格 SpacerTail（空的，不画）
//
//   为什么不「渲染时按字符串宽度推断」？因为那样每个读格子的地方
//   都得重新算一遍宽度，而算宽度需要看字符本身 —— 拿不到字符就拿不到宽度。
//   显式占位让「一格 = 一列」成为可以无条件依赖的不变量。
//
//   SpacerHead 是软换行的产物：一个宽字符被折成两行时，
//   上一行末尾要留一个标记说「这里本来还有一半」。见 395 行 softWrap 的注释。
export const enum CellWidth {
  // Not a wide character, cell width 1
  Narrow = 0,
  // Wide character, cell width 2. This cell contains the actual character.
  Wide = 1,
  // Spacer occupying the second visual column of a wide character. Do not render.
  SpacerTail = 2,
  // Spacer at the end of a soft-wrapped line indicating that a wide character
  // continues on the next line. Used for preserving wide character semantics
  // across line breaks during soft wrapping.
  SpacerHead = 3,
}

export type Hyperlink = string | undefined

/**
 * Cell is a view type returned by cellAt(). Cells are stored as packed typed
 * arrays internally to avoid GC pressure from allocating objects per cell.
 */
export type Cell = {
  char: string
  styleId: number
  width: CellWidth
  hyperlink: Hyperlink
}

// Constants for empty/spacer cells to enable fast comparisons
// These are indices into the charStrings table, not codepoints
const EMPTY_CHAR_INDEX = 0 // ' ' (space)
const SPACER_CHAR_INDEX = 1 // '' (empty string for spacer cells)
// Unwritten cells are [EMPTY_CHAR_INDEX=0, packWord1(emptyStyleId=0,0,0)=0].
// Since StylePool.none is always 0 (first intern), unwritten cells are
// indistinguishable from explicitly-cleared cells in the packed array.
// This is intentional: diffEach can compare raw ints with zero normalization.
// isEmptyCellByIndex checks if both words are 0 to identify "never visually written" cells.

function initCharAscii(): Int32Array {
  const table = new Int32Array(128)
  table.fill(-1)
  table[32] = EMPTY_CHAR_INDEX // ' ' (space)
  return table
}

// 【一个格子 = 两个 int，位域紧到没有空隙】
//
//   word0:  charId        完整 32 位（池下标）
//   word1:  styleId[31:17] | hyperlinkId[16:2] | width[1:0]
//           15 位           15 位                2 位
//
//   ⚠ Int32Array 是**有符号**的。styleId 左移 17 位后，如果 styleId 的
//   第 14 位是 1（即 styleId >= 16384），word1 就变成负数。
//   这不是 bug —— 只要读的时候用 `>>> 17`（无符号右移）和掩码，
//   拿到的值就是对的。但**不能对 word1 做大小比较**，
//   排序/范围判断会在这条边界上出错。
// --- Packed cell layout ---
// Each cell is 2 consecutive Int32 elements in the cells array:
//   word0 (cells[ci]):     charId (full 32 bits)
//   word1 (cells[ci + 1]): styleId[31:17] | hyperlinkId[16:2] | width[1:0]
const STYLE_SHIFT = 17
const HYPERLINK_SHIFT = 2
const HYPERLINK_MASK = 0x7fff // 15 bits
const WIDTH_MASK = 3 // 2 bits

// Pack styleId, hyperlinkId, and width into a single Int32
// 【打包函数没有范围校验，超了就是静默溢出】
//
//   styleId 超过 15 位会挤掉 hyperlinkId 的高位，hyperlinkId 超过 15 位
//   会挤掉 width。表现不是崩溃，是「某些字符突然变成别的字符」或
//   「宽字符变成窄的」。
//
//   之所以敢不校验：这三个值都来自池下标，而池的大小由「用户实际见过
//   多少种样式/链接/字符」决定，正常使用远达不到 2^15。
//   这是一条用「输入域很小」换来的「省一次比较」—— 每格都调，值得。
function packWord1(
  styleId: number,
  hyperlinkId: number,
  width: number,
): number {
  return (styleId << STYLE_SHIFT) | (hyperlinkId << HYPERLINK_SHIFT) | width
}

// Unwritten cell as BigInt64 — both words are 0, so the 64-bit value is 0n.
// Used by BigInt64Array.fill() for bulk clears (resetScreen, clearRegion).
// Not used for comparison — BigInt element reads cause heap allocation.
// 【为什么空值用 BigInt64 而不是逐格赋 0】
//
//   清屏、清区域这些操作要写几万个格子。逐格 `cells[i] = 0` 是
//   size×2 次赋值；而 `cells64.fill(0n)` 是一次调用，底层可以走 memset。
//
//   同一个 ArrayBuffer 上开两个视图（Int32Array 和 BigInt64Array），
//   按需选 —— 逐格操作用 int32，批量清用 int64。
//
//   ⚠ 注释里那句「Not used for comparison」很重要：BigInt 元素读出来
//   会堆分配一个 BigInt 对象，在 diff 循环里用它会比对象数组还慢。
const EMPTY_CELL_VALUE = 0n

/**
 * Screen uses a packed Int32Array instead of Cell objects to eliminate GC
 * pressure. For a 200x120 screen, this avoids allocating 24,000 objects.
 *
 * Cell data is stored as 2 Int32s per cell in a single contiguous array:
 *   word0: charId (full 32 bits — index into CharPool)
 *   word1: styleId[31:17] | hyperlinkId[16:2] | width[1:0]
 *
 * This layout halves memory accesses in diffEach (2 int loads vs 4) and
 * enables future SIMD comparison via Bun.indexOfFirstDifference.
 */
// 【Screen 的字段分五组看】
//
//   ① 尺寸：width / height
//   ② 格子数据：cells（逐格读写）/ cells64（批量清）。同一块内存两个视图
//   ③ 池：charPool / hyperlinkPool（样式池不在这里 —— 它是 LogUpdate 持有的，
//      因为 transition 缓存是全局的，不属于某个屏幕）
//   ④ 排版副产物：damage（本帧写过哪里）、noSelect（哪些格不该被选中）
//   ⑤ 折行来源：softWrap（哪一行是软换行续行，以及上一行内容到哪一列为止）
//
//   ④ 和 ⑤ 都是「信息外挂」：终端里没有这两个概念，但复制文本、
//   diff 优化需要它们。它们不参与渲染，只参与「渲染之后的事」。
export type Screen = Size & {
  // Packed cell data — 2 Int32s per cell: [charId, packed(styleId|hyperlinkId|width)]
  // cells and cells64 are views over the same ArrayBuffer.
  cells: Int32Array
  cells64: BigInt64Array // 1 BigInt64 per cell — used for bulk fill in resetScreen/clearRegion

  // Shared pools — IDs are valid across all screens using the same pools
  charPool: CharPool
  hyperlinkPool: HyperlinkPool

  // Empty style ID for comparisons
  emptyStyleId: number

  /**
   * Bounding box of cells that were written to (not blitted) during rendering.
   * Used by diff() to limit iteration to only the region that could have changed.
   */
  damage: Rectangle | undefined

  /**
   * Per-cell noSelect bitmap — 1 byte per cell, 1 = exclude from text
   * selection (copy + highlight). Used by <NoSelect> to mark gutters
   * (line numbers, diff sigils) so click-drag over a diff yields clean
   * copyable code. Fully reset each frame in resetScreen; blitRegion
   * copies it alongside cells so the blit optimization preserves marks.
   */
  noSelect: Uint8Array

// 【softWrap 的编码是全文件最绕的一处，值得单独拆开】
//
//   定义：softWrap[r] = N > 0 表示
//     (a) 第 r 行是第 r-1 行的续行（那个换行是折行加的，不是原文里的）
//     (b) 第 r-1 行的**内容结束**在绝对列 N（不含），N 之后是补白
//
//   注意 (b) 说的是「上一行」的结束位置，存在「这一行」身上。
//   为什么要这么拧？
//
//   ① 为什么需要「内容结束列」：打包数组里「没写过的空格」和
//      「写了但无样式的空格」都是全 0，无法区分。复制文本时若不做区分，
//      要么把补白也复制进去（多了尾随空格），要么把真正的词间空格也删了。
//
//   ② 为什么存在下一行而不是自己身上：为了让 shiftRows 保持正确。
//      内容上滚一行时，sw[r] 拿到旧的 sw[r+1] —— 新第 r 行成了续行，
//      而「上一行结束在哪」正好是旧数据里记着的那个值。一次 copyWithin
//      就把语义整体搬对了，不需要逐行重算。
//
//   这类「换一种存放位置，让批量操作自动保持正确」的技巧，
//   和 StylePool 用 ID 最低位当标签是同一类思路：让数据结构自己去承载语义。
  /**
   * Per-ROW soft-wrap continuation marker. softWrap[r]=N>0 means row r
   * is a word-wrap continuation of row r-1 (the `\n` before it was
   * inserted by wrapAnsi, not in the source), and row r-1's written
   * content ends at absolute column N (exclusive — cells [0..N) are the
   * fragment, past N is unwritten padding). 0 means row r is NOT a
   * continuation (hard newline or first row). Selection copy checks
   * softWrap[r]>0 to join row r onto row r-1 without a newline, and
   * reads softWrap[r+1] to know row r's content end when row r+1
   * continues from it. The content-end column is needed because an
   * unwritten cell and a written-unstyled-space are indistinguishable in
   * the packed typed array (both all-zero) — without it we'd either drop
   * the word-separator space (trim) or include trailing padding (no
   * trim). This encoding (continuation-on-self, prev-content-end-here)
   * is chosen so shiftRows preserves the is-continuation semantics: when
   * row r scrolls off the top and row r+1 shifts to row r, sw[r] gets
   * old sw[r+1] — which correctly says the new row r is a continuation
   * of what's now in scrolledOffAbove. Reset each frame; copied by
   * blitRegion/shiftRows.
   */
  softWrap: Int32Array
}

// 【「空」的定义就是全 0，靠的是 StylePool.none === 0 这条不变式】
//
//   ArrayBuffer 分配出来是零填充的，所以未写过的格子是 [0, 0]。
//   要让它等于「空格 + 无样式 + 窄 + 无链接」，必须：
//     charId 0 = ' '          （CharPool 的第 0 项）
//     styleId 0 = 空样式      （StylePool.none，且必须是第一次 intern）
//     hyperlinkId 0 = 无链接  （HyperlinkPool 的第 0 项）
//     width 0 = Narrow
//
//   四条凑齐，「全 0 即空」才成立。而 diffEach 全靠这个前提 ——
//   它比较两个整数，不做任何归一化。
//
//   ⚠ 这是一条**跨文件的隐式契约**：StylePool 的构造函数里那行
//   `this.none = this.intern([])` 必须是这个池的第一次调用，
//   否则 none 不为 0，全零缓冲区就指向了一个错误的样式。
//   没有任何断言守着它。
function isEmptyCellByIndex(screen: Screen, index: number): boolean {
  // An empty/unwritten cell has both words === 0:
  // word0 = EMPTY_CHAR_INDEX (0), word1 = packWord1(emptyStyleId=0, 0, 0) = 0.
  const ci = index << 1
  return screen.cells[ci] === 0 && screen.cells[ci | 1] === 0
}

export function isEmptyCellAt(screen: Screen, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= screen.width || y >= screen.height) return true
  return isEmptyCellByIndex(screen, y * screen.width + x)
}

/**
 * Check if a Cell (view object) represents an empty cell.
 */
export function isCellEmpty(screen: Screen, cell: Cell): boolean {
  // Check if cell looks like an empty cell (space, empty style, narrow, no link).
  // Note: After cellAt mapping, unwritten cells have emptyStyleId, so this
  // returns true for both unwritten AND cleared cells. Use isEmptyCellAt
  // for the internal distinction.
  return (
    cell.char === ' ' &&
    cell.styleId === screen.emptyStyleId &&
    cell.width === CellWidth.Narrow &&
    !cell.hyperlink
  )
}
// Intern a hyperlink string and return its ID (0 = no hyperlink)
function internHyperlink(screen: Screen, hyperlink: Hyperlink): number {
  return screen.hyperlinkPool.intern(hyperlink)
}

// ---

// 【一块内存，两个视图】
//
//   这是本文件反复用的手法：`new ArrayBuffer(size << 3)` 然后
//   在上面开 Int32Array（逐格）和 BigInt64Array（批量）。
//   两个视图指向**同一块内存**，改一个另一个立刻可见。
//
//   `size << 3` 是「每格 8 字节」（两个 int32）。位运算而不是 * 8，
//   因为 size 可能很大，乘法会走到浮点路径。
//
//   477 行那句注释点出了关键：零填充恰好就是「空格子」的编码。
//   所以 createScreen 不需要任何初始化循环 —— 分配即就绪。
export function createScreen(
  width: number,
  height: number,
  styles: StylePool,
  charPool: CharPool,
  hyperlinkPool: HyperlinkPool,
): Screen {
  // Warn if dimensions are not valid integers (likely bad yoga layout output)
  warn.ifNotInteger(width, 'createScreen width')
  warn.ifNotInteger(height, 'createScreen height')

  // Ensure width and height are valid integers to prevent crashes
  if (!Number.isInteger(width) || width < 0) {
    width = Math.max(0, Math.floor(width) || 0)
  }
  if (!Number.isInteger(height) || height < 0) {
    height = Math.max(0, Math.floor(height) || 0)
  }

  const size = width * height

// 【同一块 buffer 的两个视图，不要当成两份数据】
//
//   这是个很容易读错的地方：cells 和 cells64 看起来像两个数组，
//   实际是同一个 ArrayBuffer 的两种解读方式。
//   写 cells[ci] 等于同时改了 cells64[ci >> 1] 的低 32 位。
//
//   所以 resetScreen 用 cells64.fill（一次调用清干净），
//   而热路径用 cells（逐格读写），两者永不冲突 —— 只要不在同一时刻混着用。
  // Allocate one buffer, two views: Int32Array for per-word access,
  // BigInt64Array for bulk fill in resetScreen/clearRegion.
  // ArrayBuffer is zero-filled, which is exactly the empty cell value:
  // [EMPTY_CHAR_INDEX=0, packWord1(emptyStyleId=0,0,0)=0].
  const buf = new ArrayBuffer(size << 3) // 8 bytes per cell
  const cells = new Int32Array(buf)
  const cells64 = new BigInt64Array(buf)

  return {
    width,
    height,
    cells,
    cells64,
    charPool,
    hyperlinkPool,
    emptyStyleId: styles.none,
    damage: undefined,
    noSelect: new Uint8Array(size),
    softWrap: new Int32Array(height),
  }
}

/**
 * Reset an existing screen for reuse, avoiding allocation of new typed arrays.
 * Resizes if needed and clears all cells to empty/unwritten state.
 *
 * For double-buffering, this allows swapping between front and back buffers
 * without allocating new Screen objects each frame.
 */
// ═══════════════════════════════════════════════════════════════
//  resetScreen：复用而不是新建
// ═══════════════════════════════════════════════════════════════
//
//   双缓冲每帧要两块屏幕。如果每帧都 createScreen，就是每帧一次
//   ArrayBuffer 分配 + 一次 GC 候选。所以这里做的是「重置已有对象」：
//   缓冲够大就原地清空，不够大才重新分配。
//
//   注意 521 行的条件：`cells64.length < size` —— **只增不减**。
//   终端从 200 列缩到 80 列时，缓冲区保持 200 列的尺寸，
//   只是 width 改成 80。之后再放大回去就不用重新分配了。
//
//   代价：一块按历史最大尺寸分配的缓冲区会一直留着。
//   对「一个终端窗口」这个量级，不值得为它做收缩策略。
export function resetScreen(
  screen: Screen,
  width: number,
  height: number,
): void {
  // Warn if dimensions are not valid integers
  warn.ifNotInteger(width, 'resetScreen width')
  warn.ifNotInteger(height, 'resetScreen height')

  // Ensure width and height are valid integers to prevent crashes
  if (!Number.isInteger(width) || width < 0) {
    width = Math.max(0, Math.floor(width) || 0)
  }
  if (!Number.isInteger(height) || height < 0) {
    height = Math.max(0, Math.floor(height) || 0)
  }

  const size = width * height

  // Resize if needed (only grow, to avoid reallocations)
  if (screen.cells64.length < size) {
    const buf = new ArrayBuffer(size << 3)
    screen.cells = new Int32Array(buf)
    screen.cells64 = new BigInt64Array(buf)
    screen.noSelect = new Uint8Array(size)
  }
// softWrap 是**逐行**的，所以它的长度是 height 而不是 width×height。
//   这里单独判断，因为上面那个 cells 的 resize 分支不会管它。
  if (screen.softWrap.length < height) {
    screen.softWrap = new Int32Array(height)
  }

// 【三行清空，三个不同尺度】
//
//   cells64.fill(0n, 0, size)   逐格，size 个
//   noSelect.fill(0, 0, size)   逐格，1 字节
//   softWrap.fill(0, 0, height) 逐行，height 个
//
//   三个数组的元素尺寸不同（8 字节 / 1 字节 / 4 字节），
//   但都是 fill —— 没有一个是循环。
//
//   noSelect 每帧清零是必需的：它不在 blit 之外被继承，
//   而是「这一帧谁声明了不该选中，就标谁」。清零 = 撤销上一帧的所有声明。
  // Reset all cells — single fill call, no loop
  screen.cells64.fill(EMPTY_CELL_VALUE, 0, size)
  screen.noSelect.fill(0, 0, size)
  screen.softWrap.fill(0, 0, height)

  // Update dimensions
  screen.width = width
  screen.height = height

  // Shared pools accumulate — no clearing needed. Unique char/hyperlink sets are bounded.

  // Clear damage tracking
  screen.damage = undefined
}

/**
 * Re-intern a screen's char and hyperlink IDs into new pools.
 * Used for generational pool reset — after migrating, the screen's
 * typed arrays contain valid IDs for the new pools, and the old pools
 * can be GC'd.
 *
 * O(width * height) but only called occasionally (e.g., between conversation turns).
 */
// ═══════════════════════════════════════════════════════════════
//  migrateScreenPools：给只增不减的池换一代
// ═══════════════════════════════════════════════════════════════
//
//   池是共享的、只增不减（540 行注释解释了为什么不减）。
//   字符还好 —— 一个会话里出现过的唯一字符有限（几千到几万）。
//   但超链接是无界的：每个不同的 URL 都会 intern 一条，而聊天记录里
//   每轮都可能出现新链接。跑一整天，池里会攒下大量再也用不到的字符串。
//
//   解法是「换代」：新建一对空池，把当前屏幕上的 ID 全部重映射过去，
//   旧池随即失去引用、被 GC 回收。
//
//   代价是 O(width × height) 一次全屏遍历 —— 所以只在
//   「对话轮次之间」这种低频时机调用，不在每帧路径上。
//
//   ⚠ 这个函数有个容易漏的点：它只迁移**当前这一块屏幕**。
//   如果进程里同时存在两块屏幕（双缓冲的前后帧）而只迁移了一块，
//   另一块的 ID 就指向了已经废弃的旧池 —— 表现是随机字符错乱。
export function migrateScreenPools(
  screen: Screen,
  charPool: CharPool,
  hyperlinkPool: HyperlinkPool,
): void {
  const oldCharPool = screen.charPool
  const oldHyperlinkPool = screen.hyperlinkPool
  if (oldCharPool === charPool && oldHyperlinkPool === hyperlinkPool) return

  const size = screen.width * screen.height
  const cells = screen.cells

  // Re-intern chars and hyperlinks in a single pass, stride by 2
  for (let ci = 0; ci < size << 1; ci += 2) {
    // Re-intern charId (word0)
    const oldCharId = cells[ci]!
    cells[ci] = charPool.intern(oldCharPool.get(oldCharId))

    // Re-intern hyperlinkId (packed in word1)
    const word1 = cells[ci + 1]!
    const oldHyperlinkId = (word1 >>> HYPERLINK_SHIFT) & HYPERLINK_MASK
    if (oldHyperlinkId !== 0) {
      const oldStr = oldHyperlinkPool.get(oldHyperlinkId)
      const newHyperlinkId = hyperlinkPool.intern(oldStr)
      // Repack word1 with new hyperlinkId, preserving styleId and width
      const styleId = word1 >>> STYLE_SHIFT
      const width = word1 & WIDTH_MASK
      cells[ci + 1] = packWord1(styleId, newHyperlinkId, width)
    }
  }

  screen.charPool = charPool
  screen.hyperlinkPool = hyperlinkPool
}

/**
 * Get a Cell view at the given position. Returns a new object each call -
 * this is intentional as cells are stored packed, not as objects.
 */
// 【cellAt 每次调用都 new 一个对象 —— 这是有意的】
//
//   格子本身是打包的（两个 int），没有对象形态。想读就得解包，
//   而解包必然产生一个对象。所以这里是「按需分配」：
//
//     cellAt        便利接口，随便调，每次一个对象
//     cellAtCI      写进调用方提供的容器，零分配（656 行）
//     visibleCellAtIndex  只在可见时分配，跳过的格子不产生对象
//     diffEach 内部 复用两个 Cell，回调里看到的是同一个对象（见 1151 行警告）
//
//   四个接口对应四个分配策略。热路径选哪个，取决于「这一格会不会被写出去」。
export function cellAt(screen: Screen, x: number, y: number): Cell | undefined {
  if (x < 0 || y < 0 || x >= screen.width || y >= screen.height)
    return undefined
  return cellAtIndex(screen, y * screen.width + x)
}
/**
 * Get a Cell view by pre-computed array index. Skips bounds checks and
 * index computation — caller must ensure index is valid.
 */
export function cellAtIndex(screen: Screen, index: number): Cell {
  const ci = index << 1
  const word1 = screen.cells[ci + 1]!
  const hid = (word1 >>> HYPERLINK_SHIFT) & HYPERLINK_MASK
  return {
// 未写过的格子 charId 是 0，而 charPool.get(0) 返回空格 —— 所以
// 「没写过」和「写了空格」在这里读出来是一样的。
// 这个模糊性是可接受的：渲染时两者都不产生输出。
// 但复制文本时就有区别了，那靠 softWrap 区分（见 395 行）。
    // Unwritten cells have charIndex=0 (EMPTY_CHAR_INDEX); charPool.get(0) returns ' '
    char: screen.charPool.get(screen.cells[ci]!),
    styleId: word1 >>> STYLE_SHIFT,
    width: word1 & WIDTH_MASK,
    hyperlink: hid === 0 ? undefined : screen.hyperlinkPool.get(hid),
  }
}

/**
 * Get a Cell at the given index, or undefined if it has no visible content.
 * Returns undefined for spacer cells (charId 1), empty unstyled spaces, and
 * fg-only styled spaces that match lastRenderedStyleId (cursor-forward
 * produces an identical visual result, avoiding a Cell allocation).
 *
 * @param lastRenderedStyleId - styleId of the last rendered cell on this
 *   line, or -1 if none yet.
 */
// ═══════════════════════════════════════════════════════════════
//  visibleCellAtIndex：一个函数回答「这格要不要画」
// ═══════════════════════════════════════════════════════════════
//
//   它同时处理三种「不用画」：
//     ① 占位格（charId 1 = SpacerTail）—— 宽字符的后半格，终端画宽字符时
//        自己就占了两列，再写一个空格反而会顶歪
//     ② 纯空空格（全 0）—— 什么都不写等于写空格
//     ③ **只有前景色的空格，且和上一格样式相同** —— 见下
//
//   ③ 是最巧的一档。一个带红色前景的空格，视觉上和空空格一样（空格没笔画）。
//   但如果整行都是这种空格，逐格发「设红 → 写空格」就很浪费；
//   而如果**上一格已经是红色**，那连样式都不用切，直接跳过整格即可 ——
//   终端的「跳过」= 光标没动 = 下一格会自动对齐。
//
//   这就是为什么签名里要传 lastRenderedStyleId：跳过的前提是
//   「我不写这一格，下一格写的时候样式还是对的」。
//
//   639 行那个 0x3fffc 掩码拆开看：
//     bit 2-16  → hyperlinkId（15 位）
//     bit 17    → styleId 的最低位 = StylePool 那个「空格上可见」标志
//   一次位与同时问「有链接吗」和「样式在空格上可见吗」——
//   任意一个为真，这格就不能跳过。
export function visibleCellAtIndex(
  cells: Int32Array,
  charPool: CharPool,
  hyperlinkPool: HyperlinkPool,
  index: number,
  lastRenderedStyleId: number,
): Cell | undefined {
  const ci = index << 1
  const charId = cells[ci]!
  if (charId === 1) return undefined // spacer
  const word1 = cells[ci + 1]!
  // For spaces: 0x3fffc masks bits 2-17 (hyperlinkId + styleId visibility
  // bit). If zero, the space has no hyperlink and at most a fg-only style.
  // Then word1 >>> STYLE_SHIFT is the foreground style — skip if it's zero
  // (truly invisible) or matches the last rendered style on this line.
  if (charId === 0 && (word1 & 0x3fffc) === 0) {
    const fgStyle = word1 >>> STYLE_SHIFT
    if (fgStyle === 0 || fgStyle === lastRenderedStyleId) return undefined
  }
  const hid = (word1 >>> HYPERLINK_SHIFT) & HYPERLINK_MASK
  return {
    char: charPool.get(charId),
    styleId: word1 >>> STYLE_SHIFT,
    width: word1 & WIDTH_MASK,
    hyperlink: hid === 0 ? undefined : hyperlinkPool.get(hid),
  }
}

/**
 * Write cell data into an existing Cell object to avoid allocation.
 * Caller must ensure index is valid.
 */
// 解包到一个**调用方持有的** Cell 对象里。
// diffEach 用它复用两个对象，避免每次差异都分配两个新 Cell。
//
// 代价写在 1151 行：回调拿到的是这两个对象的引用，回调返回后内容就被覆盖了。
// 想留就必须自己拷贝（diff() 这个包装函数就是干这个的）。
function cellAtCI(screen: Screen, ci: number, out: Cell): void {
  const w1 = ci | 1
  const word1 = screen.cells[w1]!
  out.char = screen.charPool.get(screen.cells[ci]!)
  out.styleId = word1 >>> STYLE_SHIFT
  out.width = word1 & WIDTH_MASK
  const hid = (word1 >>> HYPERLINK_SHIFT) & HYPERLINK_MASK
  out.hyperlink = hid === 0 ? undefined : screen.hyperlinkPool.get(hid)
}

export function charInCellAt(
  screen: Screen,
  x: number,
  y: number,
): string | undefined {
  if (x < 0 || y < 0 || x >= screen.width || y >= screen.height)
    return undefined
  const ci = (y * screen.width + x) << 1
  return screen.charPool.get(screen.cells[ci]!)
}
/**
 * Set a cell, optionally creating a spacer for wide characters.
 *
 * Wide characters (CJK, emoji) occupy 2 cells in the buffer:
 * 1. First cell: Contains the actual character with width = Wide
 * 2. Second cell: Spacer cell with width = SpacerTail (empty, not rendered)
 *
 * If the cell has width = Wide, this function automatically creates the
 * corresponding SpacerTail in the next column. This two-cell model keeps
 * the buffer aligned to visual columns, making cursor positioning
 * straightforward.
 *
 * TODO: When soft-wrapping is implemented, SpacerHead cells will be explicitly
 * placed by the wrapping logic at line-end positions where wide characters
 * wrap to the next line. This function doesn't need to handle SpacerHead
 * automatically - it will be set directly by the wrapping code.
 */
// ═══════════════════════════════════════════════════════════════
//  setCellAt：写一格，同时清理三种「幽灵」
// ═══════════════════════════════════════════════════════════════
//
//   一个宽字符占两格：[Wide][SpacerTail]。写新内容时，如果新内容只占一格，
//   那另一半就变成了「没有主体的占位格」—— 缓冲区里还在，但没人认领它。
//
//   三种残留形态，对应下面三段清理：
//
//   ① 706  Wide 被 Narrow 覆盖 → 后面的 SpacerTail 变孤儿
//   ② 723  SpacerTail 被覆盖   → 前面的 Wide 变「半截宽字符」
//   ③ 772  写 Wide 到原本是 Wide 的位置 → 对方的 SpacerTail 落在更后面
//
//   三段的后果不一样，最严重的是 ②：它不只是显示错，是**光标模型失步**
//   （详细理由写在那个锚点里）。
//
//   为什么这些清理必须发生在写入时，而不是「渲染前统一扫一遍」？
//   因为写入是局部的、增量式的 —— 一次只碰一格，而扫描是全屏的。
//   把一致性维护在写入点上，代价是每条写入路径都得记住这三条规则。
export function setCellAt(
  screen: Screen,
  x: number,
  y: number,
  cell: Cell,
): void {
  if (x < 0 || y < 0 || x >= screen.width || y >= screen.height) return
  const ci = (y * screen.width + x) << 1
  const cells = screen.cells

  // When a Wide char is overwritten by a Narrow char, its SpacerTail remains
  // as a ghost cell that the diff/render pipeline skips, causing stale content
  // to leak through from previous frames.
// 【幽灵 ①：宽字符被窄字符顶掉】
//
//   [本][  ] → [A][  ]  第二格还是 SpacerTail，但它前面已经没有宽字符了。
//
//   这一格在渲染时会被「跳过占位格」的规则跳过（visibleCellAtIndex 里
//   charId === 1 直接 return undefined），于是终端上**这一列保持上一帧的内容**。
//
//   这就是「残留内容透过来」：看起来像上一帧的字没擦干净，
//   实际是这一帧根本没人写这一列。
//
//   清理方式：把它重置成「空格 + 空样式 + Narrow」。
  const prevWidth = cells[ci + 1]! & WIDTH_MASK
  if (prevWidth === CellWidth.Wide && cell.width !== CellWidth.Wide) {
    const spacerX = x + 1
    if (spacerX < screen.width) {
      const spacerCI = ci + 2
      if ((cells[spacerCI + 1]! & WIDTH_MASK) === CellWidth.SpacerTail) {
        cells[spacerCI] = EMPTY_CHAR_INDEX
        cells[spacerCI + 1] = packWord1(
          screen.emptyStyleId,
          0,
          CellWidth.Narrow,
        )
      }
    }
  }
  // Track cleared Wide position for damage expansion below
  let clearedWideX = -1
// 【幽灵 ②：占位格被顶掉 —— 这条最严重】
//
//   [本][  ] → [本][B]  前面那个「本」还标着 Wide，但它的后半格已经被 B 占了。
//
//   如果不管，缓冲区里就是一个「占两格、但只占了一格位置」的宽字符。
//   终端并不知道我们的模型，它看到「本」就**照样画两列** ——
//   于是 B 被覆盖，或者光标位置和缓冲区差一格。
//
//   注释里那句话是准确的：不是显示错位，是**光标模型失步**。
//   一旦失步，后面所有基于「第 x 列」的写入都会偏。
//
//   所以必须把前面那个宽字符也降级成空（不是改成窄字符 ——
//   一个「宽度 1 的汉字」同样会让终端画两格）。
  if (
    prevWidth === CellWidth.SpacerTail &&
    cell.width !== CellWidth.SpacerTail
  ) {
    // Overwriting a SpacerTail: clear the orphaned Wide char at (x-1).
    // Keeping the wide character with Narrow width would cause the terminal
    // to still render it with width 2, desyncing the cursor model.
    if (x > 0) {
      const wideCI = ci - 2
      if ((cells[wideCI + 1]! & WIDTH_MASK) === CellWidth.Wide) {
        cells[wideCI] = EMPTY_CHAR_INDEX
        cells[wideCI + 1] = packWord1(screen.emptyStyleId, 0, CellWidth.Narrow)
        clearedWideX = x - 1
      }
    }
  }

  // Pack cell data into cells array
  cells[ci] = internCharString(screen, cell.char)
  cells[ci + 1] = packWord1(
    cell.styleId,
    internHyperlink(screen, cell.hyperlink),
    cell.width,
  )

  // Track damage - expand bounds in place instead of allocating new objects
  // Include the main cell position and any cleared orphan cells
  const minX = clearedWideX >= 0 ? Math.min(x, clearedWideX) : x
  const damage = screen.damage
  if (damage) {
    const right = damage.x + damage.width
    const bottom = damage.y + damage.height
    if (minX < damage.x) {
      damage.width += damage.x - minX
      damage.x = minX
    } else if (x >= right) {
      damage.width = x - damage.x + 1
    }
    if (y < damage.y) {
      damage.height += damage.y - y
      damage.y = y
    } else if (y >= bottom) {
      damage.height = y - damage.y + 1
    }
  } else {
    screen.damage = { x: minX, y, width: x - minX + 1, height: 1 }
  }

  // If this is a wide character, create a spacer in the next column
// 【幽灵 ③：宽字符覆盖宽字符，对方的占位格在更远处】
//
//   注释里给的场景值得读懂：
//
//     [a][💻][  ]   →   [本][  ][  ]（孤儿）
//
//   💻 占第 1、2 列。写「本」到第 1 列时，我们会在第 2 列补自己的 SpacerTail。
//   但 💻 的 SpacerTail 原本就在第 2 列 —— 它被我们的占位格**覆盖**了，
//   看着没问题。
//
//   问题在于 💻 是 Wide，我们把它降级成 SpacerTail 之后，它原来占的
//   **第三列**（x+2）如果也是 SpacerTail，就成了新的孤儿。
//
//   所以这段要做三件事：先清 x+2 的孤儿，再写 x+1 的占位，最后扩 damage。
//   顺序不能换 —— 先写占位就会把「x+1 原本是 Wide」这个信息覆盖掉。
//
//   注释里说的触发场景（yoga 把 a💻 压成高度 0，本 渲染到同一 y）
//   说明这不是理论问题，是排版压缩时会真实撞上的。
  if (cell.width === CellWidth.Wide) {
    const spacerX = x + 1
    if (spacerX < screen.width) {
      const spacerCI = ci + 2
      // If the cell we're overwriting with our SpacerTail is itself Wide,
      // clear ITS SpacerTail at x+2 too. Otherwise the orphan SpacerTail
      // makes diffEach report it as `added` and log-update's skip-spacer
      // rule prevents clearing whatever prev content was at that column.
      // Scenario: [a, 💻, spacer] → [本, spacer, ORPHAN spacer] when
      // yoga squishes a💻 to height 0 and 本 renders at the same y.
      if ((cells[spacerCI + 1]! & WIDTH_MASK) === CellWidth.Wide) {
        const orphanCI = spacerCI + 2
        if (
          spacerX + 1 < screen.width &&
          (cells[orphanCI + 1]! & WIDTH_MASK) === CellWidth.SpacerTail
        ) {
          cells[orphanCI] = EMPTY_CHAR_INDEX
          cells[orphanCI + 1] = packWord1(
            screen.emptyStyleId,
            0,
            CellWidth.Narrow,
          )
        }
      }
      cells[spacerCI] = SPACER_CHAR_INDEX
      cells[spacerCI + 1] = packWord1(
        screen.emptyStyleId,
        0,
        CellWidth.SpacerTail,
      )

      // Expand damage to include SpacerTail so diff() scans it
      const d = screen.damage
      if (d && spacerX >= d.x + d.width) {
        d.width = spacerX - d.x + 1
      }
    }
  }
}

/**
 * Replace the styleId of a cell in-place without disturbing char, width,
 * or hyperlink. Preserves empty cells as-is (char stays ' '). Tracks damage
 * for the cell so diffEach picks up the change.
 */
// 【只改样式，不动字符】
//
//   用途：搜索高亮、选中底色这类「覆盖层」。它们不该改变格子的内容，
//   只该改变外观。
//
//   829 行跳过占位格的理由：反色作用在宽字符的**头格**上时，
//   视觉上会盖住两列（因为终端把宽字符当一个整体画）。
//   如果连占位格也标上反色，某些终端会给那个「看不见的格子」也画个底色，
//   结果是宽字符右边多出一条彩色条。
//
//   这里用 unionRect 而不是像 setCellAt 那样原地扩张 damage ——
//   因为只需要扩一格，不值得为它写一遍原地逻辑。
export function setCellStyleId(
  screen: Screen,
  x: number,
  y: number,
  styleId: number,
): void {
  if (x < 0 || y < 0 || x >= screen.width || y >= screen.height) return
  const ci = (y * screen.width + x) << 1
  const cells = screen.cells
  const word1 = cells[ci + 1]!
  const width = word1 & WIDTH_MASK
  // Skip spacer cells — inverse on the head cell visually covers both columns
  if (width === CellWidth.SpacerTail || width === CellWidth.SpacerHead) return
  const hid = (word1 >>> HYPERLINK_SHIFT) & HYPERLINK_MASK
  cells[ci + 1] = packWord1(styleId, hid, width)
  // Expand damage so diffEach scans this cell
  const d = screen.damage
  if (d) {
    screen.damage = unionRect(d, { x, y, width: 1, height: 1 })
  } else {
    screen.damage = { x, y, width: 1, height: 1 }
  }
}

/**
 * Intern a character string via the screen's shared CharPool.
 * Supports grapheme clusters like family emoji.
 */
// 这层包装看起来多余（直接调 charPool.intern 就行），
// 但它保留了一个「以后可能换成按屏幕池」的接缝。
// 现在所有池都是共享的，所以这层只是转发。
function internCharString(screen: Screen, char: string): number {
  return screen.charPool.intern(char)
}

/**
 * Bulk-copy a rectangular region from src to dst using TypedArray.set().
 * Single cells.set() call per row (or one call for contiguous blocks).
 * Damage is computed once for the whole region.
 *
 * Clamps negative regionX/regionY to 0 (matching clearRegion) — absolute-
 * positioned overlays in tiny terminals can compute negative screen coords.
 * maxX/maxY should already be clamped to both screen bounds by the caller.
 */
// ═══════════════════════════════════════════════════════════════
//  blitRegion：把一块矩形从一块屏幕整块拷到另一块
// ═══════════════════════════════════════════════════════════════
//
//   这是「这一帧没变」的主要实现手段。渲染树里一个干净节点整块跳过，
//   对应的就是这里的一次 blit。
//
//   三条路径：
//     ① 885  全宽、同 stride → 一次 cells.set()（整块连续内存）
//     ② 896  部分宽或 stride 不同 → 逐行 set
//     ③ 927  右边缘的宽字符 → 补一个区域外的占位格
//
//   三条路径的共同前提：**两边的池是同一个**。因为池共享，ID 可以直拷，
//   不需要重新 intern。这就是 CharPool 为什么要跨屏幕共享（21 行）。
//
//   注意 892 行那句：noSelect 是 1 字节/格，cells 是 8 字节/格。
//   同一块区域，两个数组的 stride 差 8 倍。这里分别算了 nsStart / nsLen，
//   漏算就是错位拷贝 —— 表现是「选中时选到不该选的东西」。
export function blitRegion(
  dst: Screen,
  src: Screen,
  regionX: number,
  regionY: number,
  maxX: number,
  maxY: number,
): void {
  regionX = Math.max(0, regionX)
  regionY = Math.max(0, regionY)
  if (regionX >= maxX || regionY >= maxY) return

  const rowLen = maxX - regionX
  const srcStride = src.width << 1
  const dstStride = dst.width << 1
  const rowBytes = rowLen << 1 // 2 Int32s per cell
  const srcCells = src.cells
  const dstCells = dst.cells
  const srcNoSel = src.noSelect
  const dstNoSel = dst.noSelect

  // softWrap is per-row — copy the row range regardless of stride/width.
  // Partial-width blits still carry the row's wrap provenance since the
  // blitted content (a cached ink-text node) is what set the bit.
// softWrap 是逐行的，所以不管 blit 是部分宽还是全宽，
// 都按行范围整体拷贝。
//
// 注释 880 行那句理由值得注意：partial-width 的 blit 也带上整行的
// 折行来源 —— 因为被拷进来的内容（一个缓存过的文本节点）
// 正是当初设置这个位的东西。
  dst.softWrap.set(src.softWrap.subarray(regionY, maxY), regionY)

  // Fast path: contiguous memory when copying full-width rows at same stride
// 【快路径的成立条件，三个都必须满足】
//
//   regionX === 0            从行首开始
//   maxX === src.width       到行尾结束
//   src.width === dst.width  两边行宽相同
//
//   三个条件合起来 = 「这块区域在内存里是连续的」。
//   于是整个矩形变成一次 `set(subarray)`，底层可以走 memcpy。
//
//   注意 890 行那个 `srcStart` 同时被当作目标偏移 —— 这依赖
//   「全宽 + 同 stride」⇒ srcStart === dstStart。条件里已经保证了。
  if (regionX === 0 && maxX === src.width && src.width === dst.width) {
    const srcStart = regionY * srcStride
    const totalBytes = (maxY - regionY) * srcStride
    dstCells.set(
      srcCells.subarray(srcStart, srcStart + totalBytes),
      srcStart, // srcStart === dstStart when strides match and regionX === 0
    )
    // noSelect is 1 byte/cell vs cells' 8 — same region, different scale
    const nsStart = regionY * src.width
    const nsLen = (maxY - regionY) * src.width
    dstNoSel.set(srcNoSel.subarray(nsStart, nsStart + nsLen), nsStart)
  } else {
    // Per-row copy for partial-width or mismatched-stride regions
    let srcRowCI = regionY * srcStride + (regionX << 1)
    let dstRowCI = regionY * dstStride + (regionX << 1)
    let srcRowNS = regionY * src.width + regionX
    let dstRowNS = regionY * dst.width + regionX
    for (let y = regionY; y < maxY; y++) {
      dstCells.set(srcCells.subarray(srcRowCI, srcRowCI + rowBytes), dstRowCI)
      dstNoSel.set(srcNoSel.subarray(srcRowNS, srcRowNS + rowLen), dstRowNS)
      srcRowCI += srcStride
      dstRowCI += dstStride
      srcRowNS += src.width
      dstRowNS += dst.width
    }
  }

  // Compute damage once for the whole region
  const regionRect = {
    x: regionX,
    y: regionY,
    width: rowLen,
    height: maxY - regionY,
  }
  if (dst.damage) {
    dst.damage = unionRect(dst.damage, regionRect)
  } else {
    dst.damage = regionRect
  }

  // Handle wide char at right edge: spacer might be outside blit region
  // but still within dst bounds. Per-row check only at the boundary column.
// 【右边缘的半个宽字符】
//
//   blit 区域的右边界刚好切在一个宽字符中间：
//   头格在区域内的最后一列（maxX-1），占位格在区域外（maxX）。
//
//   如果不补，dst 的 maxX 那一格还是**上一帧的旧内容** ——
//   结果就是「宽字符 + 右边一点残留」，看起来像宽字符右边多了个半字。
//
//   所以这里逐行检查边界列，是 Wide 就把外面的那一格写成 SpacerTail。
//
//   947 行那个 `rightEdge === maxX` 判断很精确：只有当 damage 的右边界
//   正好是 maxX 时才往外扩一格。如果 damage 本来就比 maxX 宽（比如同帧
//   还有别的写入扩过），再扩就会把不该标的地方标脏。
  if (maxX < dst.width) {
    let srcLastCI = (regionY * src.width + (maxX - 1)) << 1
    let dstSpacerCI = (regionY * dst.width + maxX) << 1
    let wroteSpacerOutsideRegion = false
    for (let y = regionY; y < maxY; y++) {
      if ((srcCells[srcLastCI + 1]! & WIDTH_MASK) === CellWidth.Wide) {
        dstCells[dstSpacerCI] = SPACER_CHAR_INDEX
        dstCells[dstSpacerCI + 1] = packWord1(
          dst.emptyStyleId,
          0,
          CellWidth.SpacerTail,
        )
        wroteSpacerOutsideRegion = true
      }
      srcLastCI += srcStride
      dstSpacerCI += dstStride
    }
    // Expand damage to include SpacerTail column if we wrote any
    if (wroteSpacerOutsideRegion && dst.damage) {
      const rightEdge = dst.damage.x + dst.damage.width
      if (rightEdge === maxX) {
        dst.damage = { ...dst.damage, width: dst.damage.width + 1 }
      }
    }
  }
}

/**
 * Bulk-clear a rectangular region of the screen.
 * Uses BigInt64Array.fill() for fast row clears.
 * Handles wide character boundary cleanup at region edges.
 */
// ═══════════════════════════════════════════════════════════════
//  clearRegion：清一块矩形
// ═══════════════════════════════════════════════════════════════
//
//   全宽时一行 fill 搞定（981 行）；部分宽时逐行 fill。
//
//   真正要小心的是**左右边界上的半个宽字符**：
//     · 左边界：startX 是 SpacerTail → 说明 startX-1 有个 Wide 被劈了
//     · 右边界：maxX-1 是 Wide  → 说明 maxX 有个 SpacerTail 被劈了
//
//   两处都要把区域外的那一格也清掉，**并且把 damage 扩过去**（1009、1024 行）。
//   漏掉扩 damage 的后果：格子清了，但 diff 不知道这块变了，
//   于是终端上还留着旧内容 —— 又是「清了但没清掉」这类最难查的 bug。
//
//   注意 1004 行那串下标推导：`leftEdge` 指向 startX 的 word0，
//   那么 startX-1 的 word1 就是 leftEdge-1，word0 是 leftEdge-2。
//   这种手写偏移在整个文件里到处都是，加一个格子就得重算一遍。
export function clearRegion(
  screen: Screen,
  regionX: number,
  regionY: number,
  regionWidth: number,
  regionHeight: number,
): void {
  const startX = Math.max(0, regionX)
  const startY = Math.max(0, regionY)
  const maxX = Math.min(regionX + regionWidth, screen.width)
  const maxY = Math.min(regionY + regionHeight, screen.height)
  if (startX >= maxX || startY >= maxY) return

  const cells = screen.cells
  const cells64 = screen.cells64
  const screenWidth = screen.width
  const rowBase = startY * screenWidth
  let damageMinX = startX
  let damageMaxX = maxX

  // EMPTY_CELL_VALUE (0n) matches the zero-initialized state:
  // word0=EMPTY_CHAR_INDEX(0), word1=packWord1(0,0,0)=0
// 全宽时不需要边界检查：左右边界都在屏幕边缘，
// 不可能有「区域外的半个宽字符」（屏幕外的东西不存在）。
// 所以一次 fill 覆盖整段行范围，连行循环都省了。
  if (startX === 0 && maxX === screenWidth) {
    // Full-width: single fill, no boundary checks needed
    cells64.fill(
      EMPTY_CELL_VALUE,
      rowBase,
      rowBase + (maxY - startY) * screenWidth,
    )
  } else {
    // Partial-width: single loop handles boundary cleanup and fill per row.
    const stride = screenWidth << 1 // 2 Int32s per cell
    const rowLen = maxX - startX
    const checkLeft = startX > 0
    const checkRight = maxX < screenWidth
    let leftEdge = (rowBase + startX) << 1
    let rightEdge = (rowBase + maxX - 1) << 1
    let fillStart = rowBase + startX

    for (let y = startY; y < maxY; y++) {
      // Left boundary: if cell at startX is a SpacerTail, the Wide char
      // at startX-1 (outside the region) will be orphaned. Clear it.
      if (checkLeft) {
        // leftEdge points to word0 of cell at startX; +1 is its word1
        if ((cells[leftEdge + 1]! & WIDTH_MASK) === CellWidth.SpacerTail) {
          // word1 of cell at startX-1 is leftEdge-1; word0 is leftEdge-2
          const prevW1 = leftEdge - 1
          if ((cells[prevW1]! & WIDTH_MASK) === CellWidth.Wide) {
            cells[prevW1 - 1] = EMPTY_CHAR_INDEX
            cells[prevW1] = packWord1(screen.emptyStyleId, 0, CellWidth.Narrow)
            damageMinX = startX - 1
          }
        }
      }

      // Right boundary: if cell at maxX-1 is Wide, its SpacerTail at maxX
      // (outside the region) will be orphaned. Clear it.
      if (checkRight) {
        // rightEdge points to word0 of cell at maxX-1; +1 is its word1
        if ((cells[rightEdge + 1]! & WIDTH_MASK) === CellWidth.Wide) {
          // word1 of cell at maxX is rightEdge+3 (+2 to next word0, +1 to word1)
          const nextW1 = rightEdge + 3
          if ((cells[nextW1]! & WIDTH_MASK) === CellWidth.SpacerTail) {
            cells[nextW1 - 1] = EMPTY_CHAR_INDEX
            cells[nextW1] = packWord1(screen.emptyStyleId, 0, CellWidth.Narrow)
            damageMaxX = maxX + 1
          }
        }
      }

      cells64.fill(EMPTY_CELL_VALUE, fillStart, fillStart + rowLen)
      leftEdge += stride
      rightEdge += stride
      fillStart += screenWidth
    }
  }

  // Update damage once for the whole region
  const regionRect = {
    x: damageMinX,
    y: startY,
    width: damageMaxX - damageMinX,
    height: maxY - startY,
  }
  if (screen.damage) {
    screen.damage = unionRect(screen.damage, regionRect)
  } else {
    screen.damage = regionRect
  }
}

/**
 * Shift full-width rows within [top, bottom] (inclusive, 0-indexed) by n.
 * n > 0 shifts UP (simulating CSI n S); n < 0 shifts DOWN (CSI n T).
 * Vacated rows are cleared. Does NOT update damage. Both cells and the
 * noSelect bitmap are shifted so text-selection markers stay aligned when
 * this is applied to next.screen during scroll fast path.
 */
// ═══════════════════════════════════════════════════════════════
//  shiftRows：在缓冲区里模拟一次硬件滚动
// ═══════════════════════════════════════════════════════════════
//
//   终端有个能力叫 DECSTBM：设一个滚动区域，然后让区域内整体上/下滚，
//   只有新进区域的那几行需要重画。字节数从「整屏」降到「几行」。
//
//   问题是：真实终端滚了，但我们的 prev.screen 还没滚。接下来的 diff
//   会把每一行都判成「变了」（因为内容整体位移了）。
//
//   所以先在这里把 prev.screen 原地滚一遍 —— 让它和终端保持一致 ——
//   这样 diff 只会看到真正新进视野的那几行。
//
//   ⚠ 这里改的是 prev.screen 的**内容**，但**不更新它的 damage**。
//   调用方（log-update.ts 173 行）清楚这一点，而 diffEach 那边
//   用「prev.damage ∪ next.damage」的并集兜住了这个缺口（见 1156 行锚点）。
//
//   四个数组都要跟着移：cells64（内容）、noSelect（选中标记）、softWrap（折行来源）。
//   漏任何一个，都会在滚动之后出现「内容对了但复制/选中行为不对」。
export function shiftRows(
  screen: Screen,
  top: number,
  bottom: number,
  n: number,
): void {
  if (n === 0 || top < 0 || bottom >= screen.height || top > bottom) return
  const w = screen.width
  const cells64 = screen.cells64
  const noSel = screen.noSelect
  const sw = screen.softWrap
  const absN = Math.abs(n)
// 【移得比区域还高 = 整段清空】
//
//   注意条件是 `absN > bottom - top`，而区域行数是 `bottom - top + 1`。
//   所以 absN === bottom - top + 1 时**不会**走这个分支，而是走下面的
//   copyWithin 路径 —— 此时 copyWithin 的源区间长度为 0（一次空操作），
//   紧接着的 fill 仍然会清掉整段。
//
//   两条路的最终结果一样，所以这个 `>` 与 `>=` 的差别只影响「多一次空调用」。
//   读到这里不用怀疑 off-by-one —— 它是冗余的，不是错的。
  if (absN > bottom - top) {
    cells64.fill(EMPTY_CELL_VALUE, top * w, (bottom + 1) * w)
    noSel.fill(0, top * w, (bottom + 1) * w)
    sw.fill(0, top, bottom + 1)
    return
  }
// 【copyWithin 的三行是同一件事，三个数组各做一遍】
//
//   cells64.copyWithin(dst, srcStart, srcEnd)  —— 内存块移动（不分配）
//   noSel.copyWithin(...)                      —— 1 字节/格，但语义同 8 字节/格
//   sw.copyWithin(...)                         —— 4 字节/行，只有 height 个元素
//
//   注意三者的**第三个参数不同**：前两个用格数（要乘 width），
//   最后一个用行数。这是全文件最容易写错的地方之一。
//
//   softWrap 的移位正确性值得单独说：上滚 n 行后，新第 r 行拿到的是
//   旧的 sw[r+n] —— 而旧 sw[r+n] 记着「第 r+n-1 行内容结束在哪」。
//   上滚之后，新第 r-1 行正是旧的第 r+n-1 行，所以这个值依然正确。
//   一次 copyWithin 就把整行折行来源搬对了，不需要逐行重算。
  if (n > 0) {
    // SU: row top+n..bottom → top..bottom-n; clear bottom-n+1..bottom
    cells64.copyWithin(top * w, (top + n) * w, (bottom + 1) * w)
    noSel.copyWithin(top * w, (top + n) * w, (bottom + 1) * w)
    sw.copyWithin(top, top + n, bottom + 1)
    cells64.fill(EMPTY_CELL_VALUE, (bottom - n + 1) * w, (bottom + 1) * w)
    noSel.fill(0, (bottom - n + 1) * w, (bottom + 1) * w)
    sw.fill(0, bottom - n + 1, bottom + 1)
  } else {
    // SD: row top..bottom+n → top-n..bottom; clear top..top-n-1
    cells64.copyWithin((top - n) * w, top * w, (bottom + n + 1) * w)
    noSel.copyWithin((top - n) * w, top * w, (bottom + n + 1) * w)
    sw.copyWithin(top - n, top, bottom + n + 1)
    cells64.fill(EMPTY_CELL_VALUE, top * w, (top - n) * w)
    noSel.fill(0, top * w, (top - n) * w)
    sw.fill(0, top, top - n)
  }
}

// Matches OSC 8 ; ; URI BEL
// 【超链接为什么必须从样式里抠出来】
//
//   OSC 8（ESC ] 8 ; params ; URI BEL）在语法上属于「样式序列」，
//   所以上游传下来时是混在 AnsiCode[] 里的。但它和 SGR 有本质区别：
//
//     SGR   是「模式」，开一次一直有效，逐字符可以不同
//     OSC 8 是「包裹」，必须成对出现，且不能嵌套
//
//   如果把它当普通样式存进 StylePool，那「同样的红字但在不同链接里」
//   会被当成两种样式 —— 样式表会爆炸，而且 diffAnsiCodes 对 OSC 8
//   的差分语义是不确定的（它以为这是可叠加的属性）。
//
//   所以拆开：链接进 HyperlinkPool（一格一个 ID），样式进 StylePool。
//   两者在 diff 时分别算转移，各自有各自的 cache。
const OSC8_REGEX = new RegExp(`^${ESC}\\]8${SEP}${SEP}([^${BEL}]*)${BEL}$`)
// OSC8 prefix: ESC ] 8 ; — cheap check to skip regex for the vast majority of styles (SGR = ESC [)
export const OSC8_PREFIX = `${ESC}]8${SEP}`

export function extractHyperlinkFromStyles(
  styles: AnsiCode[],
): Hyperlink | null {
  for (const style of styles) {
    const code = style.code
    if (code.length < 5 || !code.startsWith(OSC8_PREFIX)) continue
    const match = code.match(OSC8_REGEX)
    if (match) {
      return match[1] || null
    }
  }
  return null
}

export function filterOutHyperlinkStyles(styles: AnsiCode[]): AnsiCode[] {
  return styles.filter(
    style =>
      !style.code.startsWith(OSC8_PREFIX) || !OSC8_REGEX.test(style.code),
  )
}

// ---

/**
 * Returns an array of all changes between two screens. Used by tests.
 * Production code should use diffEach() to avoid allocations.
 */
// 【diff() 是给测试用的便利函数，生产代码用 diffEach】
//
//   区别就一句：diffEach 复用两个 Cell 对象（零分配），
//   所以回调返回之后对象内容就被覆盖了。这里要存进数组，
//   必须 `{...removed}` 深拷贝一份。
//
//   1123 行那句注释就是这个意思：「Production code should use diffEach()」。
//   谁在热路径里用了 diff()，就会每帧分配 N 个对象。
export function diff(
  prev: Screen,
  next: Screen,
): [point: Point, removed: Cell | undefined, added: Cell | undefined][] {
  const output: [Point, Cell | undefined, Cell | undefined][] = []
  diffEach(prev, next, (x, y, removed, added) => {
    // Copy cells since diffEach reuses the objects
    output.push([
      { x, y },
      removed ? { ...removed } : undefined,
      added ? { ...added } : undefined,
    ])
  })
  return output
}

type DiffCallback = (
  x: number,
  y: number,
  removed: Cell | undefined,
  added: Cell | undefined,
) => boolean | void

/**
 * Like diff(), but calls a callback for each change instead of building an array.
 * Reuses two Cell objects to avoid per-change allocations. The callback must not
 * retain references to the Cell objects — their contents are overwritten each call.
 *
 * Returns true if the callback ever returned true (early exit signal).
 */
// ═══════════════════════════════════════════════════════════════
//  diffEach：核心的「两帧之间哪里变了」
// ═══════════════════════════════════════════════════════════════
//
//   这一步决定了每帧要往终端写多少字节。全屏扫描当然正确，但
//   200×120 就是 24,000 次比较；而稳态下一帧往往只改了十几格
//   （spinner 转一格、时钟跳一秒）。
//
//   所以先算一个**扫描区域**（region），只在区域里比。来源是三方并集：
//     ① next.damage —— 这一帧写过哪里
//     ② prev.damage —— 上一帧写过哪里
//     ③ 尺寸变化的补齐区（1180、1188 两段）
//
//   ② 看着多余（基线是 prev.screen 本身，它的内容已经定稿了），
//   但它是必需的：log-update.ts 在 DECSTBM 快路径里对 prev.screen
//   调用了 shiftRows，**改了 cells 却没更新 damage**（见 1057 行锚点）。
//   不并上 prev 的原始 damage，被 shift 过但没标脏的列就会漏 diff。
//
//   ③ 处理的是高度/宽度缩小时，超出去的那一块 —— 那里 prev 有内容、
//   next 没有，必须逐格发删除。
//
//   三方并集是**保守**的：区域可能比实际变化大，但绝不会小。
//   这个方向选对了，代价只是多扫几格；选反了就是漏更新终端。
export function diffEach(
  prev: Screen,
  next: Screen,
  cb: DiffCallback,
): boolean {
  const prevWidth = prev.width
  const nextWidth = next.width
  const prevHeight = prev.height
  const nextHeight = next.height

  let region: Rectangle
// 【首帧特例：prev 是 0×0】
//
//   此时「上一帧」不代表任何终端状态（第一次画），所以不能靠 damage
//   裁剪 —— 直接扫全屏。否则如果这一帧只写了右下角（damage 很小），
//   左上角的空白就不会被写出去，而终端上可能还残留别的东西
//   （比如进入 alt 屏之前的 shell 输出）。
  if (prevWidth === 0 && prevHeight === 0) {
    region = { x: 0, y: 0, width: nextWidth, height: nextHeight }
  } else if (next.damage) {
    region = next.damage
    if (prev.damage) {
      region = unionRect(region, prev.damage)
    }
  } else if (prev.damage) {
    region = prev.damage
  } else {
    region = { x: 0, y: 0, width: 0, height: 0 }
  }

  if (prevHeight > nextHeight) {
    region = unionRect(region, {
      x: 0,
      y: nextHeight,
      width: prevWidth,
      height: prevHeight - nextHeight,
    })
  }
  if (prevWidth > nextWidth) {
    region = unionRect(region, {
      x: nextWidth,
      y: 0,
      width: prevWidth - nextWidth,
      height: prevHeight,
    })
  }

// maxHeight / maxWidth 取两边较大值：diff 要在**并集坐标系**里扫。
// 缩小时多出来的行/列也需要被扫到（要发删除），所以不能用 next 的尺寸。
  const maxHeight = Math.max(prevHeight, nextHeight)
  const maxWidth = Math.max(prevWidth, nextWidth)
  const endY = Math.min(region.y + region.height, maxHeight)
  const endX = Math.min(region.x + region.width, maxWidth)

// 【按宽度是否相同分成两条路】
//
//   宽度相同（稳态，99% 的帧）：行内 stride 一致，可以整行顺序扫，
//   用一个 rowCI 游标。这条路径单独抽出来是为了让 JIT 看到
//   「只有一层循环 + 一段内联比较」的热代码。
//
//   宽度不同（resize 那一帧）：两边的逐格下标不再同步，需要两个游标，
//   而且要处理「一边比另一边宽」的尾巴。这条路径每帧最多走一次，
//   不优化可读性也无所谓。
  if (prevWidth === nextWidth) {
    return diffSameWidth(prev, next, region.x, endX, region.y, endY, cb)
  }
  return diffDifferentWidth(prev, next, region.x, endX, region.y, endY, cb)
}

/**
 * Scan for the next cell that differs between two Int32Arrays.
 * Returns the number of matching cells before the first difference,
 * or `count` if all cells match. Tiny and pure for JIT inlining.
 */
// 【findNextDiff：一个纯函数，只做「下一个不同在哪」】
//
//   为什么单独抽出来？因为 V8 对「短小、无闭包、参数是类型化数组」的函数
//   更容易内联。而这里是全文件调用最密的地方 —— 每一行都要调用若干次。
//
//   返回值是「跳过了多少个相同的格子」，而不是「差异的下标」。
//   调用方直接 `x += skip; ci += skip << 1` 推进游标，
//   省掉一次「相对 → 绝对」的换算。
function findNextDiff(
  a: Int32Array,
  b: Int32Array,
  w0: number,
  count: number,
): number {
  for (let i = 0; i < count; i++, w0 += 2) {
    const w1 = w0 | 1
    if (a[w0] !== b[w0] || a[w1] !== b[w1]) return i
  }
  return count
}

/**
 * Diff one row where both screens are in bounds.
 * Scans for differences with findNextDiff, unpacks and calls cb for each.
 */
// 【一行内的差异扫描】
//
//   循环结构是「找下一个 → 解包 → 回调 → 前进一格 → 再找」。
//   注意跳过的部分**完全不解包** —— 相同格子连 Cell 对象都不产生，
//   这是零分配的关键。
//
//   回调返回真值表示「提前结束」（调用方发现要做全量重绘了）。
//   这个布尔量一路往上返回到 diffEach，最后回到 log-update。
//   用返回值而不是异常，是因为「提前退出」是正常控制流，不是错误。
function diffRowBoth(
  prevCells: Int32Array,
  nextCells: Int32Array,
  prev: Screen,
  next: Screen,
  ci: number,
  y: number,
  startX: number,
  endX: number,
  prevCell: Cell,
  nextCell: Cell,
  cb: DiffCallback,
): boolean {
  let x = startX
  while (x < endX) {
    const skip = findNextDiff(prevCells, nextCells, ci, endX - x)
    x += skip
    ci += skip << 1
    if (x >= endX) break
    cellAtCI(prev, ci, prevCell)
    cellAtCI(next, ci, nextCell)
    if (cb(x, y, prevCell, nextCell)) return true
    x++
    ci += 2
  }
  return false
}

/**
 * Emit removals for a row that only exists in prev (height shrank).
 * Cannot skip empty cells — the terminal still has content from the
 * previous frame that needs to be cleared.
 */
// 【这一行只在 prev 里存在（高度缩小），必须逐格发删除】
//
//   注释 1260 行那句是重点：**不能跳过空格子**。
//
//   为什么？「next 里没有这一行」不等于「终端上没有这一行」——
//   终端上还留着上一帧画的那些字。所以哪怕 prev 这一格本身是空的，
//   也得发一个删除，因为终端上的状态我们不知道（可能是更早的帧留下的）。
//
//   和下面 diffRowAdded 的对称性在这里断掉，是**故意的**。
function diffRowRemoved(
  prev: Screen,
  ci: number,
  y: number,
  startX: number,
  endX: number,
  prevCell: Cell,
  cb: DiffCallback,
): boolean {
  for (let x = startX; x < endX; x++, ci += 2) {
    cellAtCI(prev, ci, prevCell)
    if (cb(x, y, prevCell, undefined)) return true
  }
  return false
}

/**
 * Emit additions for a row that only exists in next (height grew).
 * Skips empty/unwritten cells.
 */
// 【新增的行只写非空格子】
//
//   和上面正好相反：这一行在 next 里新出现，说明终端上这一行本来是
//   屏幕外的空白（滚动出来的），或者是刚扩展出来的区域。
//   空白处不用写 —— 跳过空格子可以把新行的写入量降到只剩内容。
//
//   两段放在一起看，就是一条判据：
//   **「我看到的空白」和「终端上的空白」是不是同一件事。**
//   缩小时不是（终端有旧内容），所以不能跳；增长时是，所以能跳。
function diffRowAdded(
  nextCells: Int32Array,
  next: Screen,
  ci: number,
  y: number,
  startX: number,
  endX: number,
  nextCell: Cell,
  cb: DiffCallback,
): boolean {
  for (let x = startX; x < endX; x++, ci += 2) {
    if (nextCells[ci] === 0 && nextCells[ci | 1] === 0) continue
    cellAtCI(next, ci, nextCell)
    if (cb(x, y, undefined, nextCell)) return true
  }
  return false
}

/**
 * Diff two screens with identical width.
 * Dispatches each row to a small, JIT-friendly function.
 */
// 【按行分派给三个小函数】
//
//   一行有三种状态：两边都有 / 只在 prev / 只在 next。
//   三种情况走三个函数，而不是在一个循环里多次 if ——
//   这样每个函数内部的循环条件都是单一的，JIT 更容易优化。
//
//   prevCell / nextCell 在这里分配一次，然后整行复用（传进 cellAtCI）。
//   一行 200 格可能产生 200 次差异，但只有 2 次对象分配。
function diffSameWidth(
  prev: Screen,
  next: Screen,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  cb: DiffCallback,
): boolean {
  const prevCells = prev.cells
  const nextCells = next.cells
  const width = prev.width
  const prevHeight = prev.height
  const nextHeight = next.height
  const stride = width << 1

  const prevCell: Cell = {
    char: ' ',
    styleId: 0,
    width: CellWidth.Narrow,
    hyperlink: undefined,
  }
  const nextCell: Cell = {
    char: ' ',
    styleId: 0,
    width: CellWidth.Narrow,
    hyperlink: undefined,
  }

  const rowEndX = Math.min(endX, width)
  let rowCI = (startY * width + startX) << 1

  for (let y = startY; y < endY; y++) {
    const prevIn = y < prevHeight
    const nextIn = y < nextHeight

    if (prevIn && nextIn) {
      if (
        diffRowBoth(
          prevCells,
          nextCells,
          prev,
          next,
          rowCI,
          y,
          startX,
          rowEndX,
          prevCell,
          nextCell,
          cb,
        )
      )
        return true
    } else if (prevIn) {
      if (diffRowRemoved(prev, rowCI, y, startX, rowEndX, prevCell, cb))
        return true
    } else if (nextIn) {
      if (
        diffRowAdded(nextCells, next, rowCI, y, startX, rowEndX, nextCell, cb)
      )
        return true
    }

    rowCI += stride
  }

  return false
}

/**
 * Fallback: diff two screens with different widths (resize).
 * Separate indices for prev and next cells arrays.
 */
// 【resize 那一帧的兜底路径】
//
//   结构和上面几乎一样，区别是 prev 和 next 各有一套 stride 和游标，
//   而且每行的有效结束列要分开算（prevEndX / nextEndX）。
//
//   于是每一行分成三段处理：
//     共同宽度内       → 逐格比较
//     prev 更宽的部分  → 逐格发删除
//     next 更宽的部分  → 写非空格子
//
//   这段代码每帧最多跑一次（终端尺寸变了才会进来），
//   所以没做 findNextDiff 那类优化，也没拆小函数。
function diffDifferentWidth(
  prev: Screen,
  next: Screen,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  cb: DiffCallback,
): boolean {
  const prevWidth = prev.width
  const nextWidth = next.width
  const prevCells = prev.cells
  const nextCells = next.cells

  const prevCell: Cell = {
    char: ' ',
    styleId: 0,
    width: CellWidth.Narrow,
    hyperlink: undefined,
  }
  const nextCell: Cell = {
    char: ' ',
    styleId: 0,
    width: CellWidth.Narrow,
    hyperlink: undefined,
  }

  const prevStride = prevWidth << 1
  const nextStride = nextWidth << 1
  let prevRowCI = (startY * prevWidth + startX) << 1
  let nextRowCI = (startY * nextWidth + startX) << 1

  for (let y = startY; y < endY; y++) {
    const prevIn = y < prev.height
    const nextIn = y < next.height
    const prevEndX = prevIn ? Math.min(endX, prevWidth) : startX
    const nextEndX = nextIn ? Math.min(endX, nextWidth) : startX
    const bothEndX = Math.min(prevEndX, nextEndX)

    let prevCI = prevRowCI
    let nextCI = nextRowCI

    for (let x = startX; x < bothEndX; x++) {
      if (
        prevCells[prevCI] === nextCells[nextCI] &&
        prevCells[prevCI + 1] === nextCells[nextCI + 1]
      ) {
        prevCI += 2
        nextCI += 2
        continue
      }
      cellAtCI(prev, prevCI, prevCell)
      cellAtCI(next, nextCI, nextCell)
      prevCI += 2
      nextCI += 2
      if (cb(x, y, prevCell, nextCell)) return true
    }

    if (prevEndX > bothEndX) {
      prevCI = prevRowCI + ((bothEndX - startX) << 1)
      for (let x = bothEndX; x < prevEndX; x++) {
        cellAtCI(prev, prevCI, prevCell)
        prevCI += 2
        if (cb(x, y, prevCell, undefined)) return true
      }
    }

    if (nextEndX > bothEndX) {
      nextCI = nextRowCI + ((bothEndX - startX) << 1)
      for (let x = bothEndX; x < nextEndX; x++) {
        if (nextCells[nextCI] === 0 && nextCells[nextCI | 1] === 0) {
          nextCI += 2
          continue
        }
        cellAtCI(next, nextCI, nextCell)
        nextCI += 2
        if (cb(x, y, undefined, nextCell)) return true
      }
    }

    prevRowCI += prevStride
    nextRowCI += nextStride
  }

  return false
}

/**
 * Mark a rectangular region as noSelect (exclude from text selection).
 * Clamps to screen bounds. Called from output.ts when a <NoSelect> box
 * renders. No damage tracking — noSelect doesn't affect terminal output,
 * only getSelectedText/applySelectionOverlay which read it directly.
 */
// ═══════════════════════════════════════════════════════════════
//  markNoSelectRegion：标记「这块不该被选中」
// ═══════════════════════════════════════════════════════════════
//
//   用途：行号、diff 的 +/- 符号、树的连接线 —— 这些是「给眼睛看的框架」，
//   不该被复制进剪贴板。
//
//   两个设计选择值得注意：
//
//   ① **不标 damage**。注释 1468 行给了理由：noSelect 不影响终端输出，
//      只影响「选中时取什么文本」。标 damage 会让 diff 白扫一片区域。
//      判据是「这个数据会不会改变终端上的像素」。
//
//   ② 用 fill 按行刷，而不是逐格循环。1 字节/格，一行一次 fill 就能刷完。
//
//   时机上有个隐藏依赖：noSelect 每帧在 resetScreen 里清零，
//   然后靠「box 渲染时声明 + blit 时拷贝位图」重建。
//   所以清区域（clearRegion）不清 noSelect 是无害的 ——
//   被清掉的地方如果还有内容，同帧必然有某个 box 重画并重标；
//   如果没内容，那是一片空白，排除在选中之外也没人察觉。
export function markNoSelectRegion(
  screen: Screen,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const maxX = Math.min(x + width, screen.width)
  const maxY = Math.min(y + height, screen.height)
  const noSel = screen.noSelect
  const stride = screen.width
  for (let row = Math.max(0, y); row < maxY; row++) {
    const rowStart = row * stride
    noSel.fill(1, rowStart + Math.max(0, x), rowStart + maxX)
  }
}
