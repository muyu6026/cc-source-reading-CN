// ═══════════════════════════════════════════════════════════════
//  全屏模式下的拖选：为什么这件小事要 900 行
// ═══════════════════════════════════════════════════════════════
//
//  在普通终端里，拖选是**终端模拟器**的功能 —— 它握着滚动缓冲，
//  知道整块历史文本。Claude Code 开全屏（alt-screen）时把这套抢过来了：
//  它要自己画高亮、自己复制、自己决定哪些格子不可选。
//
//  抢过来之后立刻背上三个包袱，这份文件的全部复杂度都来自它们：
//
//  1) **只有一个屏。** `Screen` 只装视口那几十行，往上滚出去的内容会被
//     后来的写入覆盖。而选区可以跨越比屏幕更长的范围 —— 所以滚出去的部分
//     必须在被覆盖之前**自己抄下来**（`captureScrolledRows` + 两个累积器）。
//
//  2) **坐标会被 clamp。** 拖到屏幕外时行号被夹到边界，于是「真实位置」丢了。
//     反向滚动时要能还原回真位置，否则高亮的范围和复制出来的文本对不上
//     （这就是 `virtualAnchorRow` 那套「clamp 债务」记账）。
//
//  3) **复制要还原逻辑行。** 屏幕上是**软换行**之后的视觉行，
//     源码里那一行其实是一个长行。复制时得把折行拼回去，且行尾那个
//     被折行吃掉的空格要保留 —— 判定依据是 `screen.softWrap` 位图。
//
//  记住这三条，下面每个看似古怪的分支都能对上号。
//  在这个文件里，「正确」的定义不是「几何上漂亮」，而是**高亮的格子
//  和复制出来的字符一一对应**。
/**
 * Text selection state for fullscreen mode.
 *
 * Tracks a linear selection in screen-buffer coordinates (0-indexed col/row).
 * Selection is line-based: cells from (startCol, startRow) through
 * (endCol, endRow) inclusive, wrapping across line boundaries. This matches
 * terminal-native selection behavior (not rectangular/block).
 *
 * The selection is stored as ANCHOR (where the drag started) + FOCUS (where
 * the cursor is now). The rendered highlight normalizes to start ≤ end.
 */

// 只依赖三个 cell 级操作（读格子、按索引读、改样式）+ 一个 clamp。
// 这个依赖面很窄是刻意的：选区的逻辑可以脱离渲染器单独测试，
// 而 `applySelectionOverlay` 只往屏幕缓冲里写 styleId，不碰输出、不碰 diff。
import { clamp } from './layout/geometry.js'
import type { Screen, StylePool } from './screen.js'
import { CellWidth, cellAt, cellAtIndex, setCellStyleId } from './screen.js'

type Point = { col: number; row: number }

// 【为什么是 anchor + focus，而不是 start + end】
//
//   拖选可以往任意方向进行：从第 10 行往下拖到第 3 行，anchor 在下面、
//   focus 在上面。如果用 start/end，每次反向拖都要**交换两个字段**，
//   而交换会让「原来那个起点」的信息丢失 —— 后续拖动时到底谁该动就说不清了。
//
//   固定语义（anchor = 按下的位置，focus = 当前的位置）就没有这个问题：
//   拖动只改 focus，方向由 `comparePoints` 在渲染/复制时临时归一化。
//   这是一种「存储用自然坐标，显示用规范坐标」的分工。
export type SelectionState = {
  /** Where the mouse-down occurred. Null when no selection. */
  anchor: Point | null
  /** Current drag position (updated on mouse-move while dragging). */
  focus: Point | null
  /** True between mouse-down and mouse-up. */
  isDragging: boolean
  /** For word/line mode: the initial word/line bounds from the first
   *  multi-click. Drag extends from this span to the word/line at the
   *  current mouse position so the original word/line stays selected
   *  even when dragging backward past it. Null ⇔ char mode. The kind
   *  tells extendSelection whether to snap to word or line boundaries. */
// `anchorSpan` 只在双击/三击之后存在。它记录「最初选中的那个词/行的边界」，
// 作用是在继续拖动时**按词扩展**而不是从词中间按字符扩展 ——
// 这个区别用户能直接感觉到：双击一个词再往右拖，原生终端会整词整词地长。
//
// 注意它存的是「最初那个 span」而不是「当前 span」：
// 每次拖动都从原始 span 重新算，所以往回拖回原始词时会精确回到原状，
// 不会累积误差。
  anchorSpan: { lo: Point; hi: Point; kind: 'word' | 'line' } | null
// 【屏幕只有一屏，所以滚出去的行必须自己抄】
//
//   拖到视口上边界外，ScrollBox 会继续滚动 —— 每一行新内容进来，
//   顶上就有一行被覆盖。被覆盖的那一行仍然「属于选区」，但它的文本
//   已经不在屏幕里了。不抄下来，复制结果就只剩后半截。
//
//   做成两个累积器（above / below）而不是一个，是因为两个方向的
//   **插入顺序相反**：往上滚时新行接在末尾（离屏幕最近的最后），
//   往下滚时新行插在最前。第 840 行那两段注释说的就是这个。
  /** Text from rows that scrolled out ABOVE the viewport during
   *  drag-to-scroll. The screen buffer only holds the current viewport,
   *  so without this accumulator, dragging down past the bottom edge
   *  loses the top of the selection once the anchor clamps. Prepended
   *  to the on-screen text by getSelectedText. Reset on start/clear. */
  scrolledOffAbove: string[]
  /** Symmetric: rows scrolled out BELOW when dragging up. Appended. */
  scrolledOffBelow: string[]
// 【为什么还要单独存一份软换行位}
//
//   `screen.softWrap` 是**逐行**位图，而且它会随内容一起滚动、每帧重置。
//   等滚出去之后再回头读它，读到的是「现在屏幕上这一行」的状态，
//   而不是当初抄下来的那一行 —— 拼回去就会多出或少掉换行。
//
//   所以抄文本的同时把 `sw[row]` 也抄一份，两个数组严格平行。
//   `joinRows` 消费它们，决定「这一行是拼到上一行后面，还是另起一行」。
  /** Soft-wrap bits parallel to scrolledOffAbove — true means the row
   *  is a continuation of the one before it (the `\n` was inserted by
   *  word-wrap, not in the source). Captured alongside the text at
   *  scroll time since the screen's softWrap bitmap shifts with content.
   *  getSelectedText uses these to join wrapped rows back into logical
   *  lines. */
  scrolledOffAboveSW: boolean[]
  /** Parallel to scrolledOffBelow. */
  scrolledOffBelowSW: boolean[]
// 【clamp 债务：这个文件里最容易写错的一处】
//
//   举个具体数字：选区起点在第 5 行，用户按 PgUp 把视口上移 10 行。
//   第 5 行早就出屏了，`clamp(5 - 10, 0, h-1)` 得到 0 —— 起点的**真位置丢了**。
//   接着用户按 PgDn 回来 10 行，如果从已 clamp 的 0 算起，结果是 10 而不是 5。
//   高亮错了 5 行，而且累积器还停在「有 5 行在屏外」的旧账上，
//   复制出来的文本会比看到的多。
//
//   解法就是把「未 clamp 的行号」单独记在 virtual 字段里：
//   真位置永远能算回来，中间那一段只影响显示。
//
//   一旦 anchor 回到屏内，virtual 立刻清成 undefined（见第 547 行）——
//   这叫「还清债务」，此后它就只是普通行号了。
  /** Pre-clamp anchor row. Set when shiftSelection clamps anchor so a
   *  reverse scroll can restore the true position and pop accumulators.
   *  Without this, PgDn (clamps anchor) → PgUp leaves anchor at the wrong
   *  row AND scrolledOffAbove stale — highlight ≠ copy. Undefined when
   *  anchor is in-bounds (no clamp debt). Cleared on start/clear. */
  virtualAnchorRow?: number
  /** Same for focus. */
  virtualFocusRow?: number
// 这个字段不参与选区计算，是**探测宿主**用的：
// 全屏模式下 xterm.js 会不会把手势让给我们，取决于 VS Code 的
// `macOptionClickForcesSelection` 是否关闭。我们能观察到的唯一线索，
// 就是按下的那个事件里有没有带 Alt 位（SGR 按钮的 0x08）。
//
//   带了 → 说明 xterm.js 没有拦截，走到了我们这里
//   没带 → 说明用户没按 Option，无法判断
//
// 于是页脚可以据此给出正确的提示（「按住 Option 拖选」还是「直接拖选」），
// 而不是猜。输入侧代码里少见的「读环境」而不是「处理输入」。
  /** True if the mouse-down that started this selection had the alt
   *  modifier set (SGR button bit 0x08). On macOS xterm.js this is a
   *  signal that VS Code's macOptionClickForcesSelection is OFF — if it
   *  were on, xterm.js would have consumed the event for native selection
   *  and we'd never receive it. Used by the footer to show the right hint. */
  lastPressHadAlt: boolean
}

export function createSelectionState(): SelectionState {
  return {
    anchor: null,
    focus: null,
    isDragging: false,
    anchorSpan: null,
    scrolledOffAbove: [],
    scrolledOffBelow: [],
    scrolledOffAboveSW: [],
    scrolledOffBelowSW: [],
    lastPressHadAlt: false,
  }
}

// 【按下时故意不设 focus】
//
//   设了会怎样：一次「按下-抬起」什么都不拖，anchor === focus，
//   于是「选区 = 一格」。而 `useCopyOnSelect` 会在拖选结束时自动复制 ——
//   用户只是想点一下按钮，剪贴板里就被塞进一个空格。
//
//   所以 focus 的语义是「真的开始拖了」，而 `hasSelection` 要求两个点都在。
//   这个设计把「单击」和「选了 1 格」干净地区分开，代价是下面
//   `updateSelection` 里要额外处理「第一次 move 就落在 anchor 上」的情况。
export function startSelection(
  s: SelectionState,
  col: number,
  row: number,
): void {
  s.anchor = { col, row }
  // Focus is not set until the first drag motion. A click-release with no
  // drag leaves focus null → hasSelection/selectionBounds return false/null
  // via the `!s.focus` check, so a bare click never highlights a cell.
  s.focus = null
  s.isDragging = true
  s.anchorSpan = null
  s.scrolledOffAbove = []
  s.scrolledOffBelow = []
  s.scrolledOffAboveSW = []
  s.scrolledOffBelowSW = []
  s.virtualAnchorRow = undefined
  s.virtualFocusRow = undefined
  s.lastPressHadAlt = false
}

// 第一次 move 落在 anchor 同一格 → 什么都不做。
//
// 为什么会有「没动」的 move 事件：鼠标跟踪模式 1002 是「按下期间有任何移动就报」，
// 而物理上的亚像素抖动、或者终端把「按下+抬起」合成一对事件时，
// 都会在 anchor 那一格上补一次移动。若照常设 focus，一次单击又变成 1 格选择 ——
// 上面那个剪贴板问题会从另一个入口回来。
//
// 注意判据是「focus 还没被设过」，不是「位置没变」：
// 真拖出去再拖回 anchor，focus 是有的，此时应该照常更新（回到 1 格）。
export function updateSelection(
  s: SelectionState,
  col: number,
  row: number,
): void {
  if (!s.isDragging) return
  // First motion at the same cell as anchor is a no-op. Terminals in mode
  // 1002 can fire a drag event at the anchor cell (sub-pixel tremor, or a
  // motion-release pair). Setting focus here would turn a bare click into
  // a 1-cell selection and clobber the clipboard via useCopyOnSelect. Once
  // focus is set (real drag), we track normally including back to anchor.
  if (!s.focus && s.anchor && s.anchor.col === col && s.anchor.row === row)
    return
  s.focus = { col, row }
}

export function finishSelection(s: SelectionState): void {
  s.isDragging = false
  // Keep anchor/focus so highlight stays visible and text can be copied.
  // Clear via clearSelection() on Esc or after copy.
}

export function clearSelection(s: SelectionState): void {
  s.anchor = null
  s.focus = null
  s.isDragging = false
  s.anchorSpan = null
  s.scrolledOffAbove = []
  s.scrolledOffBelow = []
  s.scrolledOffAboveSW = []
  s.scrolledOffBelowSW = []
  s.virtualAnchorRow = undefined
  s.virtualFocusRow = undefined
  s.lastPressHadAlt = false
}

// Unicode-aware word character matcher: letters (any script), digits,
// and the punctuation set iTerm2 treats as word-part by default.
// Matching iTerm2's default means double-clicking a path like
// `/usr/bin/bash` or `~/.claude/config.json` selects the whole thing,
// which is the muscle memory most macOS terminal users have.
// iTerm2 default "characters considered part of a word": /-+\~_.
// WORD_CHAR 里那几个标点是**对齐 iTerm2 默认值**的结果（`/-+~_.` 加反斜杠），
// 而不是「什么算单词」的语言学定义。动机很实用：
// 双击 `/usr/bin/bash` 或 `~/.claude/config.json` 能一次选中整条路径，
// 这是 macOS 终端用户的手部记忆。换成「只认字母数字」的话，
// 双击路径只选中一段，得手动补。
//
// `p{L}` / `p{N}` 是任意语言的字母与数字 —— 所以中文、日文、西里尔文
// 都能整词选中，不需要枚举区间。
const WORD_CHAR = /[\p{L}\p{N}_/.\-+~\\]/u

/**
 * Character class for double-click word-expansion. Cells with the same
 * class as the clicked cell are included in the selection; a class change
 * is a boundary. Matches typical terminal-emulator behavior (iTerm2 etc.):
 * double-click on `foo` selects `foo`, on `->` selects `->`, on spaces
 * selects the whitespace run.
 */
// 三个类别：空白 / 词字符 / 其他（标点）。
// 双击时「同类连续段」就是选区，所以：
//   · 双击 `foo` → 选中 `foo`
//   · 双击 `->`  → 选中 `->`（两个字符同类）
//   · 双击空格 → 选中这一整段空白
// 这是终端模拟器的通行行为，不是这里的发明。
//
// 空串也归到「空白」类：宽字符的 SpacerHead 那个格子的 char 是空串，
// 归到空白类可以避免它把相邻的词切开。
function charClass(c: string): 0 | 1 | 2 {
  if (c === ' ' || c === '') return 0
  if (WORD_CHAR.test(c)) return 1
  return 2
}

/**
 * Find the bounds of the same-class character run at (col, row). Returns
 * null if the click is out of bounds or lands on a noSelect cell. Used by
 * selectWordAt (initial double-click) and extendWordSelection (drag).
 */
// 第一步先处理「点在了宽字符的后半格」：宽字符占两格，后一格是
// SpacerTail（char 为空串）。不退回前半格，`charClass('')` 会把整段
// 判成空白 —— 双击一个汉字会选中一片空白而不是那个字。
//
// `noSelect` 在这里出现两次（起点检查 + 扩展时的边界），
// 是因为它同时起两个作用：不可选的格子既不能当起点，也是扩展的墙。
function wordBoundsAt(
  screen: Screen,
  col: number,
  row: number,
): { lo: number; hi: number } | null {
  if (row < 0 || row >= screen.height) return null
  const width = screen.width
  const noSelect = screen.noSelect
  const rowOff = row * width

  // If the click landed on the spacer tail of a wide char, step back to
  // the head so the class check sees the actual grapheme.
  let c = col
  if (c > 0) {
    const cell = cellAt(screen, c, row)
    if (cell && cell.width === CellWidth.SpacerTail) c -= 1
  }
  if (c < 0 || c >= width || noSelect[rowOff + c] === 1) return null

  const startCell = cellAt(screen, c, row)
  if (!startCell) return null
  const cls = charClass(startCell.char)

  // Expand left: include cells of the same class, stop at noSelect or
  // class change. SpacerTail cells are stepped over (the wide-char head
  // at the preceding column determines the class).
// 【左右扩展的规则不对称，这是宽字符逼出来的】
//
//   往左：遇到 SpacerTail 不能直接比类别（它的 char 是空串，类别是空白），
//         必须**跨过它去看前一格的 head**，用 head 的类别做判断，
//         然后把 lo 落到 head 上。
//   往右：遇到 SpacerTail 直接**吞进来**（`hi = next`）—— 它属于刚收下的
//         那个宽字符，不算一个新的字符。
//
//   两边的差别在于「谁是这段的成员」：宽字符的 head 才是成员，
//   tail 只是它的占位。左边要跳过占位找成员，右边顺手把占位收下。
//
//   写反的后果：双击汉字可能只选中半格（复制出半个字或一个乱码），
//   或者把相邻的另一个汉字一起选走。
  let lo = c
  while (lo > 0) {
    const prev = lo - 1
    if (noSelect[rowOff + prev] === 1) break
    const pc = cellAt(screen, prev, row)
    if (!pc) break
    if (pc.width === CellWidth.SpacerTail) {
      // Step over the spacer to the wide-char head
      if (prev === 0 || noSelect[rowOff + prev - 1] === 1) break
      const head = cellAt(screen, prev - 1, row)
      if (!head || charClass(head.char) !== cls) break
      lo = prev - 1
      continue
    }
    if (charClass(pc.char) !== cls) break
    lo = prev
  }

  // Expand right: same logic, skipping spacer tails.
  let hi = c
  while (hi < width - 1) {
    const next = hi + 1
    if (noSelect[rowOff + next] === 1) break
    const nc = cellAt(screen, next, row)
    if (!nc) break
    if (nc.width === CellWidth.SpacerTail) {
      // Include the spacer tail in the selection range (it belongs to
      // the wide char at hi) and continue past it.
      hi = next
      continue
    }
    if (charClass(nc.char) !== cls) break
    hi = next
  }

  return { lo, hi }
}

// 阅读序比较（先比行再比列），不是先算「线性下标」再比。
// 两者等价，但用二维比较的好处是不依赖屏幕宽度 ——
// 宽度在 resize 时会变，而下标算出来的顺序只在同一宽度下成立。
/** -1 if a < b, 1 if a > b, 0 if equal (reading order: row then col). */
function comparePoints(a: Point, b: Point): number {
  if (a.row !== b.row) return a.row < b.row ? -1 : 1
  if (a.col !== b.col) return a.col < b.col ? -1 : 1
  return 0
}

/**
 * Select the word at (col, row) by scanning the screen buffer for the
 * bounds of the same-class character run. Mutates the selection in place.
 * No-op if the click is out of bounds or lands on a noSelect cell.
 * Sets isDragging=true and anchorSpan so a subsequent drag extends the
 * selection word-by-word (native macOS behavior).
 */
// 词选之后设 `anchorSpan` + `isDragging = true`，是为了让**后续的拖动**
// 走 `extendSelection` 而不是 `updateSelection`：前者按词扩展，后者按字符。
// 这个切换点就是「双击」这个动作本身。
export function selectWordAt(
  s: SelectionState,
  screen: Screen,
  col: number,
  row: number,
): void {
  const b = wordBoundsAt(screen, col, row)
  if (!b) return
  const lo = { col: b.lo, row }
  const hi = { col: b.hi, row }
  s.anchor = lo
  s.focus = hi
  s.isDragging = true
  s.anchorSpan = { lo, hi, kind: 'word' }
}

// Printable ASCII minus terminal URL delimiters. Restricting to single-
// codeunit ASCII keeps cell-count === string-index, so the column-span
// check below is exact (no wide-char/grapheme drift).
// 【为什么 URL 扫描只认 ASCII】
//
//   因为要保证「格子数 == 字符串下标」。整个函数都在用
//   `clickIdx = c - lo` 去切片 token —— 只有每个字符恰好占一格时，
//   「第几格」才等于「第几个字符」。宽字符、组合字符、emoji 都会破坏这个等式，
//   于是边界判断就漂了。
//
//   代价：URL 里的非 ASCII（中文路径、IDN 域名）识别不出来。
//   收益：整段逻辑不需要 grapheme 分段，也没有任何宽度换算。
//   这是个很清楚的取舍 —— 终端里能点的 URL 九成是纯 ASCII。
const URL_BOUNDARY = new Set([...'<>"\'` '])
function isUrlChar(c: string): boolean {
  if (c.length !== 1) return false
  const code = c.charCodeAt(0)
  return code >= 0x21 && code <= 0x7e && !URL_BOUNDARY.has(c)
}

/**
 * Scan the screen buffer for a plain-text URL at (col, row). Mirrors the
 * terminal's native Cmd+Click URL detection, which fullscreen mode's mouse
 * tracking intercepts. Called from getHyperlinkAt as a fallback when the
 * cell has no OSC 8 hyperlink.
 */
// 【为什么要自己扫文本里的 URL】
//
//   普通终端里，Cmd+Click 打开链接是终端模拟器的功能（它自己扫可见文本，
//   或者看 OSC 8 超链接）。全屏模式打开了鼠标跟踪，**这些点击全被我们截走了**，
//   终端再也没机会做这件事。所以得自己补一份等价实现。
//
//   调用点在 `getHyperlinkAt`：先看这一格有没有 OSC 8 超链接（程序自己标的），
//   没有再走这个「扫纯文本」的兜底。两条路的优先级和终端原生行为一致。
export function findPlainTextUrlAt(
  screen: Screen,
  col: number,
  row: number,
): string | undefined {
  if (row < 0 || row >= screen.height) return undefined
  const width = screen.width
  const noSelect = screen.noSelect
  const rowOff = row * width

  let c = col
  if (c > 0) {
    const cell = cellAt(screen, c, row)
    if (cell && cell.width === CellWidth.SpacerTail) c -= 1
  }
  if (c < 0 || c >= width || noSelect[rowOff + c] === 1) return undefined

  const startCell = cellAt(screen, c, row)
  if (!startCell || !isUrlChar(startCell.char)) return undefined

  // Expand left/right to the bounds of the URL-char run. URLs are ASCII
  // (CellWidth.Narrow, 1 codeunit), so hitting a non-ASCII/wide/spacer
  // cell is a boundary — no need to step over spacers like wordBoundsAt.
// 扩展到 URL 字符段的左右边界。这里**不需要**像 `wordBoundsAt` 那样
// 跨 SpacerTail —— 因为 URL 字符都是窄字符，遇到宽字符/空串就说明到头了。
// 换句话说，上一段的「1 格 = 1 字符」前提在这里被当成了边界判据用。
  let lo = c
  while (lo > 0) {
    const prev = lo - 1
    if (noSelect[rowOff + prev] === 1) break
    const pc = cellAt(screen, prev, row)
    if (!pc || pc.width !== CellWidth.Narrow || !isUrlChar(pc.char)) break
    lo = prev
  }
  let hi = c
  while (hi < width - 1) {
    const next = hi + 1
    if (noSelect[rowOff + next] === 1) break
    const nc = cellAt(screen, next, row)
    if (!nc || nc.width !== CellWidth.Narrow || !isUrlChar(nc.char)) break
    hi = next
  }

// 取出这一行里这一段的字符，然后在**段内**找 scheme。
//
// 为什么要找「点击位置之前最后一个」scheme：一行里可能并排放两个 URL
// （`https://a.com,https://b.com` 这种日志格式很常见），
// 贪婪匹配会把两条连成一个超长 URL，点第二条也打开第一条。
//
// 判断方式是「顺着扫，遇到第一个位于点击位置之后的 scheme 就停」，
// 前一个就是答案。这是少见的「用一次线性扫描同时得到两个边界」的写法。
  let token = ''
  for (let i = lo; i <= hi; i++) token += cellAt(screen, i, row)!.char

  // 1 cell = 1 char across [lo, hi] (ASCII-only run), so string index =
  // column offset. Find the last scheme anchor at or before the click —
  // a run like `https://a.com,https://b.com` has two, and clicking the
  // second should return the second URL, not the greedy match of both.
  const clickIdx = c - lo
  const schemeRe = /(?:https?|file):\/\//g
  let urlStart = -1
  let urlEnd = token.length
  for (let m; (m = schemeRe.exec(token)); ) {
    if (m.index > clickIdx) {
      urlEnd = m.index
      break
    }
    urlStart = m.index
  }
  if (urlStart < 0) return undefined
  let url = token.slice(urlStart, urlEnd)

// 尾部标点的剥离分两类，因为规则不同：
//   · `. , ; : ! ?` —— 无条件剥。URL 里以这些结尾的极少，而它们在句子里
//     几乎总是句读。
//   · `) ] }` —— **只在括号不平衡时**剥。`/wiki/Foo_(bar)` 的 `)` 是 URL 的一部分，
//     `/arr[0]` 的 `]` 也是；但 `(see https://a.com)` 的 `)` 是句子的。
//     判据是数一数这对括号在 URL 内部是否配平。
//
// 这条规则看着琐碎，但它是「自动识别链接」能不能用的分水岭：
// 剥多了会把有效路径截断（打开 404），剥少了会把句号带进 URL。
  // Strip trailing sentence punctuation. For closers () ] }, only strip
  // if unbalanced — `/wiki/Foo_(bar)` keeps `)`, `/arr[0]` keeps `]`.
  const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  while (url.length > 0) {
    const last = url.at(-1)!
    if ('.,;:!?'.includes(last)) {
      url = url.slice(0, -1)
      continue
    }
    const opener = OPENER[last]
    if (!opener) break
    let opens = 0
    let closes = 0
    for (let i = 0; i < url.length; i++) {
      const ch = url.charAt(i)
      if (ch === opener) opens++
      else if (ch === last) closes++
    }
    if (closes > opens) url = url.slice(0, -1)
    else break
  }

  // urlStart already guarantees click >= URL start; check right edge.
  if (clickIdx >= urlStart + url.length) return undefined

  return url
}

/**
 * Select the entire row. Sets isDragging=true and anchorSpan so a
 * subsequent drag extends the selection line-by-line. The anchor/focus
 * span from col 0 to width-1; getSelectedText handles noSelect skipping
 * and trailing-whitespace trimming so the copied text is just the visible
 * line content.
 */
// 行选：anchor 到 0、focus 到 width-1，看起来是「整行全选」，
// 但实际复制出来是干净的 —— 尾部空格由 `extractRowText` 裁掉，
// 行号/差异符号那些 noSelect 格子被跳过。
// 也就是说「选整行」的语义在**存储**上是全宽，在**输出**上是可见内容。
export function selectLineAt(
  s: SelectionState,
  screen: Screen,
  row: number,
): void {
  if (row < 0 || row >= screen.height) return
  const lo = { col: 0, row }
  const hi = { col: screen.width - 1, row }
  s.anchor = lo
  s.focus = hi
  s.isDragging = true
  s.anchorSpan = { lo, hi, kind: 'line' }
}

// 【三段判断，保证「原始那个词永远还在选区里」】
//
//   设原始 span 是 [lo, hi]，鼠标现在落在 [mLo, mHi]：
//     mHi < lo      → 整体在左侧：anchor 挪到 hi，focus 落到 mLo（反向延伸）
//     mLo > hi      → 整体在右侧：anchor 留在 lo，focus 到 mHi
//     其余（相交）  → 只选原始 span（鼠标还在原来那个词附近）
//
//   关键是 anchor 会**换到 span 的另一端**，这样「拖回原词」时选区自动收缩到
//   只剩原词，而不是留下一条细线。原生 macOS 就是这个手感。
//
//   词模式下找不到词（落在 noSelect 格子上、或拖到边距里）时退回裸格子，
//   让拖动不至于在边距处卡死 —— 注释里叫 fallback，实际是「不能让拖动失去反馈」。
/**
 * Extend a word/line-mode selection to the word/line at (col, row). The
 * anchor span (the original multi-clicked word/line) stays selected; the
 * selection grows from that span to the word/line at the current mouse
 * position. Word mode falls back to the raw cell when the mouse is over a
 * noSelect cell or out of bounds, so dragging into gutters still extends.
 */
export function extendSelection(
  s: SelectionState,
  screen: Screen,
  col: number,
  row: number,
): void {
  if (!s.isDragging || !s.anchorSpan) return
  const span = s.anchorSpan
  let mLo: Point
  let mHi: Point
  if (span.kind === 'word') {
    const b = wordBoundsAt(screen, col, row)
    mLo = { col: b ? b.lo : col, row }
    mHi = { col: b ? b.hi : col, row }
  } else {
    const r = clamp(row, 0, screen.height - 1)
    mLo = { col: 0, row: r }
    mHi = { col: screen.width - 1, row: r }
  }
  if (comparePoints(mHi, span.lo) < 0) {
    // Mouse target ends before anchor span: extend backward.
    s.anchor = span.hi
    s.focus = mLo
  } else if (comparePoints(mLo, span.hi) > 0) {
    // Mouse target starts after anchor span: extend forward.
    s.anchor = span.lo
    s.focus = mHi
  } else {
    // Mouse overlaps the anchor span: just select the anchor span.
    s.anchor = span.lo
    s.focus = span.hi
  }
}

// 键盘扩展的六种语义动作。注意这里只有**语义**，没有行列换算 ——
// 换行要跨到上一行末尾、lineStart/lineEnd 取整行宽度，这些都在
// `ink.tsx` 的 `moveSelectionFocus` 里做，因为只有它知道当前屏幕多大。
//
// 这种「状态机放这里、策略放那里」的切法让本文件不依赖屏幕尺寸，
// 代价是读 `moveFocus` 的人必须同时看 `ink.tsx` 才知道 left 到底是什么。
/** Semantic keyboard focus moves. See moveSelectionFocus in ink.tsx for
 *  how screen bounds + row-wrap are applied. */
export type FocusMove =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'lineStart'
  | 'lineEnd'

/**
 * Set focus to (col, row) for keyboard selection extension (shift+arrow).
 * Anchor stays fixed; selection grows or shrinks depending on where focus
 * moves relative to anchor. Drops to char mode (clears anchorSpan) —
 * native macOS does this too: shift+arrow after a double-click word-select
 * extends char-by-char from the word edge, not word-by-word. Scrolled-off
 * accumulators are preserved: keyboard-extending a drag-scrolled selection
 * keeps the off-screen rows. Caller supplies coords already clamped/wrapped.
 */
// 键盘移动会**丢掉 anchorSpan**（退回字符模式）。
//
// 这不是偷懒：原生 macOS 也这样 —— 双击选词之后按 Shift+右，是逐字符扩展，
// 不是整词扩展。原因是键盘表达的是「精确一格」的意图，
// 而 anchorSpan 的语义是「鼠标的模糊意图」。两种意图不该混用。
//
// 但 `scrolledOff*` 累积器**不清**：键盘继续扩展一个已经滚过的选区时，
// 屏外那些行还在，清掉就等于把用户已经选中的内容丢了。
export function moveFocus(s: SelectionState, col: number, row: number): void {
  if (!s.focus) return
  s.anchorSpan = null
  s.focus = { col, row }
  // Explicit user repositioning — any stale virtual focus (from a prior
  // shiftSelection clamp) no longer reflects intent. Anchor stays put so
  // virtualAnchorRow is still valid for its own round-trip.
  s.virtualFocusRow = undefined
}

// 【这份文件里最绕的一段，绕的原因是「屏幕会动」】
//
//   键盘滚动（PgUp/PgDn/Ctrl+U/D/B/F）会让**内容**在屏幕上移动，
//   而选区是绑在内容上的：选中的第 10 行滚到第 3 行，选区高亮也必须到第 3 行。
//   于是「滚动 dRow 行」要同时平移 anchor 和 focus。
//
//   但平移会遇到边界 clamp，而 clamp 会丢真位置（见第 49 行那段）。
//   所以这里干三件事，顺序不能换：
//     1) 用 virtual 算出「没 clamp 的真位置」，判断是不是整段都出屏了 → 清空
//     2) 按「债务变化」增删累积器里的屏外行（反向滚动时那些行回到屏内了）
//     3) 才真正写入 clamp 后的坐标，并更新 virtual
//
//   第 2 步是全局最反直觉的地方：它不是「存新行」，而是「**删**旧行」。
//   因为往里加行的时机是滚动发生前（`captureScrolledRows`），
//   这里只负责反向时把多记的还回去。两个函数一进一出，才闭合。
//
//   为什么不把两件事合到一个函数里：抓行必须在**内容被覆盖之前**，
//   而平移必须在**坐标更新之时**，两个时机不同，合了就会有一边早/晚一帧。
/**
 * Shift anchor AND focus by dRow, clamped to [minRow, maxRow]. Used for
 * keyboard scroll (PgUp/PgDn/ctrl+u/d/b/f): the whole selection must track
 * the content, unlike drag-to-scroll where focus stays at the mouse. Any
 * point that hits a clamp bound gets its col reset to the full-width edge —
 * its original content scrolled off-screen and was captured by
 * captureScrolledRows, so the col constraint was already consumed. Keeping
 * it would truncate the NEW content now at that screen row. Clamp col is 0
 * for dRow<0 (scrolling down, top leaves, 'above' semantics) or width-1 for
 * dRow>0 (scrolling up, bottom leaves, 'below' semantics).
 *
 * If both ends overshoot the SAME viewport edge (select text → Home/End/g/G
 * jumps far enough that both are out of view), clear — otherwise both clamp
 * to the same corner cell and a ghost 1-cell highlight lingers, and
 * getSelectedText returns one unrelated char from that corner. Symmetric
 * with shiftSelectionForFollow's top-edge check, but bidirectional: keyboard
 * scroll can jump either way.
 */
// 撞上边界时把列号重置成「整行边缘」（向下的那条边用 col 0，向上的用 width-1），
// 理由是「约束只能用一次」：那一行原来的内容已经滚出屏幕、被抄进累积器了，
// 原来的 `col` 约束**已经消费掉**。继续拿它对新的屏幕行做裁剪，
// 会把这一行新内容错误地截掉一截。
//
// 判断用「撞到哪条边」而不是「往哪个方向滚」，也是因为 virtual 位置可能在
// 反向滚动时仍然贴着同一条边（真位置还没回到屏内）。
export function shiftSelection(
  s: SelectionState,
  dRow: number,
  minRow: number,
  maxRow: number,
  width: number,
): void {
  if (!s.anchor || !s.focus) return
  // Virtual rows track pre-clamp positions so reverse scrolls restore
  // correctly. Without this, clamp(5→0) + shift(+10) = 10, not the true 5,
  // and scrolledOffAbove stays stale (highlight ≠ copy).
// virtual 记账的第一段：先算出「没有 clamp 过的真位置」。
// 注意是 `virtual ?? 现值` 再 **加** dRow —— 一旦有债务，就一直在真位置上累加，
// 而不是在 clamp 后的位置上累加。两者的差别会随滚动次数放大。
  const vAnchor = (s.virtualAnchorRow ?? s.anchor.row) + dRow
  const vFocus = (s.virtualFocusRow ?? s.focus.row) + dRow
  if (
    (vAnchor < minRow && vFocus < minRow) ||
    (vAnchor > maxRow && vFocus > maxRow)
  ) {
    clearSelection(s)
    return
  }
  // Debt = how far the nearer endpoint overshoots each edge. When debt
  // shrinks (reverse scroll), those rows are back on-screen — pop from
  // the accumulator so getSelectedText doesn't double-count them.
// 「债务」的定义：最近的端点越出边界多少行。
// 债务>0 就说明有若干行内容已经不在屏幕里，而是躺在累积器里。
// 所以债务本身不是错误状态 —— 它是「累积器里应该有这些行」的账本。
  const oldMin = Math.min(
    s.virtualAnchorRow ?? s.anchor.row,
    s.virtualFocusRow ?? s.focus.row,
  )
  const oldMax = Math.max(
    s.virtualAnchorRow ?? s.anchor.row,
    s.virtualFocusRow ?? s.focus.row,
  )
  const oldAboveDebt = Math.max(0, minRow - oldMin)
  const oldBelowDebt = Math.max(0, oldMax - maxRow)
  const newAboveDebt = Math.max(0, minRow - Math.min(vAnchor, vFocus))
  const newBelowDebt = Math.max(0, Math.max(vAnchor, vFocus) - maxRow)
// 债务变小 = 反向滚动，那些行回到屏幕里了 → 把累积器里对应的条目**弹掉**，
// 否则 `getSelectedText` 会把它们算两遍（屏上一份 + 累积器一份）。
//
// 两个累积器的弹出方向相反，这是最容易写反的一处：
//   · above 用 push 追加（最新在**尾**），所以从尾部截
//   · below 用 unshift 插入（最新在**头**），所以从头部切
// 「最新」的定义是「离屏幕最近」，两个方向相反所以操作也相反。
  if (newAboveDebt < oldAboveDebt) {
    // scrolledOffAbove pushes newest at the end (closest to on-screen).
    const drop = oldAboveDebt - newAboveDebt
    s.scrolledOffAbove.length -= drop
    s.scrolledOffAboveSW.length = s.scrolledOffAbove.length
  }
  if (newBelowDebt < oldBelowDebt) {
    // scrolledOffBelow unshifts newest at the front (closest to on-screen).
    const drop = oldBelowDebt - newBelowDebt
    s.scrolledOffBelow.splice(0, drop)
    s.scrolledOffBelowSW.splice(0, drop)
  }
// 【不变量：累积器长度 ≤ 债务】
//
//   正常情况下两者相等（滚出几行就抄几行）。超过就说明有 stale 条目 ——
//   典型来源是 `moveFocus` 清了 virtual 但没裁累积器（第 449 行），
//   于是那批条目永远等不到「债务变小」的弹出时机，只能靠这里兜底。
//
//   注意判的是 `newDebt` 而不是 `oldDebt`：抓行（`captureScrolledRows`）
//   在平移**之前**跑，所以刚进这个函数时累积器已经有内容、而 oldDebt 还是 0。
//   那是「刚建立债务」的正常路径，不是 stale —— 用 oldDebt 判断会把正常数据砍掉。
//
//   这类「顺序决定判据」的坑在这个文件里出现了三次，都是因为
//   「谁先跑」这个信息只存在于调用方（`ink.tsx`），签名里看不出来。
  // Invariant: accumulator length ≤ debt. If the accumulator exceeds debt,
  // the excess is stale — e.g., moveFocus cleared virtualFocusRow without
  // trimming the accumulator, orphaning entries the pop above can never
  // reach because oldDebt was ALREADY 0. Truncate to debt (keeping the
  // newest = closest-to-on-screen entries). Check newDebt (not oldDebt):
  // captureScrolledRows runs BEFORE this shift in the real flow (ink.tsx),
  // so at entry the accumulator is populated but oldDebt is still 0 —
  // that's the normal establish-debt path, not stale.
  if (s.scrolledOffAbove.length > newAboveDebt) {
    // Above pushes newest at END → keep END.
    s.scrolledOffAbove =
      newAboveDebt > 0 ? s.scrolledOffAbove.slice(-newAboveDebt) : []
    s.scrolledOffAboveSW =
      newAboveDebt > 0 ? s.scrolledOffAboveSW.slice(-newAboveDebt) : []
  }
  if (s.scrolledOffBelow.length > newBelowDebt) {
    // Below unshifts newest at FRONT → keep FRONT.
    s.scrolledOffBelow = s.scrolledOffBelow.slice(0, newBelowDebt)
    s.scrolledOffBelowSW = s.scrolledOffBelowSW.slice(0, newBelowDebt)
  }
  // Clamp col depends on which EDGE (not dRow direction): virtual tracking
  // means a top-clamped point can stay top-clamped during a dRow>0 reverse
  // shift — dRow-based clampCol would give it the bottom col.
  const shift = (p: Point, vRow: number): Point => {
    if (vRow < minRow) return { col: 0, row: minRow }
    if (vRow > maxRow) return { col: width - 1, row: maxRow }
    return { col: p.col, row: vRow }
  }
  s.anchor = shift(s.anchor, vAnchor)
  s.focus = shift(s.focus, vFocus)
  s.virtualAnchorRow =
    vAnchor < minRow || vAnchor > maxRow ? vAnchor : undefined
  s.virtualFocusRow = vFocus < minRow || vFocus > maxRow ? vFocus : undefined
  // anchorSpan not virtual-tracked: it's for word/line extend-on-drag,
  // irrelevant to the keyboard-scroll round-trip case.
// `anchorSpan` 走的是朴素 clamp，不做 virtual 记账。
// 因为它只服务于「鼠标双击后按词扩展」，而键盘滚动是另一条路径 ——
// 两者不会同时活跃（`moveFocus` 已经把 anchorSpan 清成 null）。
// 给它也加一套虚拟行只是把复杂度乘以二，换不到任何正确性。
  if (s.anchorSpan) {
    const sp = (p: Point): Point => {
      const r = p.row + dRow
      if (r < minRow) return { col: 0, row: minRow }
      if (r > maxRow) return { col: width - 1, row: maxRow }
      return { col: p.col, row: r }
    }
    s.anchorSpan = {
      lo: sp(s.anchorSpan.lo),
      hi: sp(s.anchorSpan.hi),
      kind: s.anchorSpan.kind,
    }
  }
}

/**
 * Shift the anchor row by dRow, clamped to [minRow, maxRow]. Used during
 * drag-to-scroll: when the ScrollBox scrolls by N rows, the content that
 * was under the anchor is now at a different viewport row, so the anchor
 * must follow it. Focus is left unchanged (it stays at the mouse position).
 */
// 【拖选滚动：只动 anchor，focus 钉在鼠标上】
//
//   这个不对称是行为上的必然：拖到屏幕边缘时 ScrollBox 继续滚，
//   鼠标（focus）还停在那一格 —— 用户没动鼠标，焦点就不该动；
//   而 anchor 代表的那块**内容**往下走了，所以 anchor 要跟着走。
//
//   对比下面 `shiftSelectionForFollow`：流式输出时代码在自己往下长，
//   两端都是「绑在内容上」的，所以两端都要动。
//   在 `ink.tsx` 里靠 `isDragging` 二选一 —— 一个布尔量决定了两套语义。
//
//   这里也维护 virtual：拖选阶段被 clamp 过之后，如果没有记真位置，
//   交接给 follow 那条路时就会从「已经 clamp 的行」开始数，
//   总漂移量少算，后面 `shiftSelection` 的还账逻辑会误判成「累积器有 stale」。
export function shiftAnchor(
  s: SelectionState,
  dRow: number,
  minRow: number,
  maxRow: number,
): void {
  if (!s.anchor) return
  // Same virtual-row tracking as shiftSelection/shiftSelectionForFollow: the
  // drag→follow transition hands off to shiftSelectionForFollow, which reads
  // (virtualAnchorRow ?? anchor.row). Without this, drag-phase clamping
  // leaves virtual undefined → follow initializes from the already-clamped
  // row, under-counting total drift → shiftSelection's invariant-restore
  // prematurely clears valid drag-phase accumulator entries.
  const raw = (s.virtualAnchorRow ?? s.anchor.row) + dRow
  s.anchor = { col: s.anchor.col, row: clamp(raw, minRow, maxRow) }
  s.virtualAnchorRow = raw < minRow || raw > maxRow ? raw : undefined
  // anchorSpan not virtual-tracked (word/line extend, irrelevant to
  // keyboard-scroll round-trip) — plain clamp from current row.
  if (s.anchorSpan) {
    const shift = (p: Point): Point => ({
      col: p.col,
      row: clamp(p.row + dRow, minRow, maxRow),
    })
    s.anchorSpan = {
      lo: shift(s.anchorSpan.lo),
      hi: shift(s.anchorSpan.hi),
      kind: s.anchorSpan.kind,
    }
  }
}

// 【流式跟随：内容在长，选区得跟着往上走】
//
//   场景：用户选了一段刚生成的回答，然后模型继续输出。新内容从底部进来，
//   整段内容往上推。如果选区不动，高亮就会「贴着屏幕不动」而底下的字全换了 ——
//   那已经不是用户选的东西了。
//
//   所以这里两端都平移，和拖选滚动（只动 anchor）是两种语义。
//   判据只有 `isDragging`：按下未松开 = 鼠标主导；没在拖 = 内容主导。
/**
 * Shift the whole selection (anchor + focus + anchorSpan) by dRow, clamped
 * to [minRow, maxRow]. Used when sticky/auto-follow scrolls the ScrollBox
 * while a selection is active — native terminal behavior is for the
 * highlight to walk up the screen with the text (not stay at the same
 * screen position).
 *
 * Differs from shiftAnchor: during drag-to-scroll, focus tracks the live
 * mouse position and only anchor follows the text. During streaming-follow,
 * the selection is text-anchored at both ends — both must move. The
 * isDragging check in ink.tsx picks which shift to apply.
 *
 * If both ends would shift strictly BELOW minRow (unclamped), the selected
 * text has scrolled entirely off the top. Clear it — otherwise a single
 * inverted cell lingers at the viewport top as a ghost (native terminals
 * drop the selection when it leaves scrollback). Landing AT minRow is
 * still valid: that cell holds the correct text. Returns true if the
 * selection was cleared so the caller can notify React-land subscribers
 * (useHasSelection) — the caller is inside onRender so it can't use
 * notifySelectionChange (recursion), must fire listeners directly.
 */
// 返回 bool 是给调用方用的：整个选区滚出顶部时这里会就地清空，
// 而调用方在 `onRender` 里 —— **不能**走 `notifySelectionChange`
// （那会触发 React 订阅者重新渲染，在渲染过程中再渲染 = 递归）。
// 所以它直接 fire 监听器，用返回值告诉调用方「我清掉了，你去通知」。
//
// 「渲染期间的副作用要绕路」是这套代码里反复出现的约束，
// 和 `log-update` 里「drain 帧不能走 scheduleRender」是同一类问题。
export function shiftSelectionForFollow(
  s: SelectionState,
  dRow: number,
  minRow: number,
  maxRow: number,
): boolean {
  if (!s.anchor) return false
  // Mirror shiftSelection: compute raw (unclamped) positions from virtual
  // if set, else current. This handles BOTH the update path (virtual already
  // set from a prior keyboard scroll) AND the initialize path (first clamp
  // happens HERE via follow-scroll, no prior keyboard scroll). Without the
  // initialize path, follow-scroll-first leaves virtual undefined even
  // though the clamp below occurred → a later PgUp computes debt from the
  // clamped row instead of the true pre-clamp row and never pops the
  // accumulator — getSelectedText double-counts the off-screen rows.
// 两条路径都要处理 virtual，缺一不可：
//   · **更新路径**：之前键盘滚过，virtual 已经有值 → 从它算
//   · **初始化路径**：第一次 clamp 就发生在这里（用户直接拖到边界）→ 也是从它算
//
// 只写更新路径是想当然的写法，漏掉初始化路径的后果延迟出现：
// 先拖到边界（clamp 发生、virtual 没记）→ 再按 PgUp → 债务从 clamp 后的行算，
// 累积器永远不被弹出 → 复制出来的文本比看到的多一截。
//
// 「延迟出现的错误」在这一层的代价特别高，因为症状是「复制出来的字多了几行」，
// 用户很难判断是哪一步出的问题。
  const rawAnchor = (s.virtualAnchorRow ?? s.anchor.row) + dRow
  const rawFocus = s.focus
    ? (s.virtualFocusRow ?? s.focus.row) + dRow
    : undefined
  if (rawAnchor < minRow && rawFocus !== undefined && rawFocus < minRow) {
    clearSelection(s)
    return true
  }
  // Clamp from raw, not p.row+dRow — so a virtual position coming back
  // in-bounds lands at the TRUE position, not the stale clamped one.
  s.anchor = { col: s.anchor.col, row: clamp(rawAnchor, minRow, maxRow) }
  if (s.focus && rawFocus !== undefined) {
    s.focus = { col: s.focus.col, row: clamp(rawFocus, minRow, maxRow) }
  }
  s.virtualAnchorRow =
    rawAnchor < minRow || rawAnchor > maxRow ? rawAnchor : undefined
  s.virtualFocusRow =
    rawFocus !== undefined && (rawFocus < minRow || rawFocus > maxRow)
      ? rawFocus
      : undefined
  // anchorSpan not virtual-tracked (word/line extend, irrelevant to
  // keyboard-scroll round-trip) — plain clamp from current row.
  if (s.anchorSpan) {
    const shift = (p: Point): Point => ({
      col: p.col,
      row: clamp(p.row + dRow, minRow, maxRow),
    })
    s.anchorSpan = {
      lo: shift(s.anchorSpan.lo),
      hi: shift(s.anchorSpan.hi),
      kind: s.anchorSpan.kind,
    }
  }
  return false
}

// 要求 anchor 和 focus **都**在。focus 只在真的拖动过之后才存在，
// 于是「单击」在这个判据下天然不是选区 —— 这是第 88 行那个设计的落点。
export function hasSelection(s: SelectionState): boolean {
  return s.anchor !== null && s.focus !== null
}

// 归一化只在**读**的时候做（渲染、复制、命中判断），存储永远保留原始方向。
// 这样「往左拖」和「往右拖」的中间状态完全一样，没有「要不要交换」的分支 ——
// 分支少了，出错的面积也小。
/**
 * Normalized selection bounds: start is always before end in reading order.
 * Returns null if no active selection.
 */
export function selectionBounds(s: SelectionState): {
  start: { col: number; row: number }
  end: { col: number; row: number }
} | null {
  if (!s.anchor || !s.focus) return null
  return comparePoints(s.anchor, s.focus) <= 0
    ? { start: s.anchor, end: s.focus }
    : { start: s.focus, end: s.anchor }
}

/**
 * Check if a cell at (col, row) is within the current selection range.
 * Used by the renderer to apply inverse style.
 */
// 逐格判定，看起来和 `applySelectionOverlay` 重复，但用途不同：
// 这个函数回答「**这一格**算不算选中」，用在渲染期问单格状态；
// 那个函数是「把整片高亮一次性写进缓冲」，用在帧末。
//
// 真正的上色不走这里 —— 走批量的那个。这里更接近一个查询谓词，
// 语义上的存在感比调用量重要。
export function isCellSelected(
  s: SelectionState,
  col: number,
  row: number,
): boolean {
  const b = selectionBounds(s)
  if (!b) return false
  const { start, end } = b
  if (row < start.row || row > end.row) return false
  if (row === start.row && col < start.col) return false
  if (row === end.row && col > end.col) return false
  return true
}

/** Extract text from one screen row. When the next row is a soft-wrap
 *  continuation (screen.softWrap[row+1]>0), clamp to that content-end
 *  column and skip the trailing trim so the word-separator space survives
 *  the join. See Screen.softWrap for why the clamp is necessary. */
function extractRowText(
  screen: Screen,
  row: number,
  colStart: number,
  colEnd: number,
): string {
  const noSelect = screen.noSelect
  const rowOff = row * screen.width
// 【这一行是整个复制逻辑的关键，而它依赖 screen.ts 的一个巧合】
//
//   `softWrap[row+1] > 0` 说的是「下一行是本行的软换行续行，且本行写过的内容
//   到第 N 列为止」。为什么要这个 N：屏幕里「**没写过的格子**」和
//   「**写过的无样式空格**」在打包的 Int32Array 里**长得一模一样**（都是 0）。
//   见 `screen.ts` 里 `StylePool.none === 0` + `charPool[0] === ' '` 那段。
//
//   于是「行尾那些格子」无法靠内容判断：
//     · 若是折行续行的填充 → 不能当空格复制（会插进词中间）
//     · 若是源文本里真的空格 → 必须保留（否则两个词粘成一个）
//   唯一的分辨办法就是 softWrap 里记的「内容到第几列为止」。
//
//   这就是 `contentEnd` 存在的原因。也说明一件事：**屏幕缓冲的零填充设计
//   是「省一次归一化」换来的，代价被转移到了复制逻辑上**。
//   读这段代码时如果不知道上面那个巧合，`Math.min(colEnd, contentEnd - 1)`
//   看起来就像个随手写的保险。
  const contentEnd = row + 1 < screen.height ? screen.softWrap[row + 1]! : 0
  const lastCol = contentEnd > 0 ? Math.min(colEnd, contentEnd - 1) : colEnd
  let line = ''
  for (let col = colStart; col <= lastCol; col++) {
    // Skip cells marked noSelect (gutters, line numbers, diff sigils).
    // Check before cellAt to avoid the decode cost for excluded cells.
    if (noSelect[rowOff + col] === 1) continue
    const cell = cellAt(screen, col, row)
    if (!cell) continue
    // Skip spacer tails (second half of wide chars) — the head already
    // contains the full grapheme. SpacerHead is a blank at line-end.
    if (
      cell.width === CellWidth.SpacerTail ||
      cell.width === CellWidth.SpacerHead
    ) {
      continue
    }
    line += cell.char
  }
  return contentEnd > 0 ? line : line.replace(/\s+$/, '')
}

// `joinRows` 是「软换行拼回逻辑行」的唯一实现点。
// 判据是 `sw`（这一行是不是续行）：是就拼到上一行尾部，不是就另起一行。
//
// 注意第一个参数是数组而不是字符串 —— 因为拼的是**最后一行**，
// 用字符串拼接会让每次 join 都复制整段（选区可以是几万字符）。
/** Accumulator for selected text that merges soft-wrapped rows back
 *  into logical lines. push(text, sw) appends a newline before text
 *  only when sw=false (i.e. the row starts a new logical line). Rows
 *  with sw=true are concatenated onto the previous row. */
function joinRows(
  lines: string[],
  text: string,
  sw: boolean | undefined,
): void {
  if (sw && lines.length > 0) {
    lines[lines.length - 1] += text
  } else {
    lines.push(text)
  }
}

/**
 * Extract text from the screen buffer within the selection range.
 * Rows are joined with newlines unless the screen's softWrap bitmap
 * marks a row as a word-wrap continuation — those rows are concatenated
 * onto the previous row so the copied text matches the logical source
 * line, not the visual wrapped layout. Trailing whitespace on the last
 * fragment of each logical line is trimmed. Wide-char spacer cells are
 * skipped. Rows that scrolled out of the viewport during drag-to-scroll
 * are joined back in from the scrolledOffAbove/Below accumulators along
 * with their captured softWrap bits.
 */
// 三段拼接：屏外上方 → 屏内 → 屏外下方。
// 顺序就是阅读顺序，中间不需要任何排序操作 —— 两个累积器天然是「按抄下来的顺序」
// 存好的，这正是第 840 行那两个 push/unshift 的用途。
export function getSelectedText(s: SelectionState, screen: Screen): string {
  const b = selectionBounds(s)
  if (!b) return ''
  const { start, end } = b
  const sw = screen.softWrap
  const lines: string[] = []

// 累积器里的文本**已经**是裁好的（抄的时候用的是当时的 col 边界），
// 所以这里只做 join，不再重算列范围。这一点容易忘：
// 抄下来的字符串没有「格子」的概念了，它是成品。
  for (let i = 0; i < s.scrolledOffAbove.length; i++) {
    joinRows(lines, s.scrolledOffAbove[i]!, s.scrolledOffAboveSW[i])
  }

  for (let row = start.row; row <= end.row; row++) {
    const rowStart = row === start.row ? start.col : 0
    const rowEnd = row === end.row ? end.col : screen.width - 1
    joinRows(lines, extractRowText(screen, row, rowStart, rowEnd), sw[row]! > 0)
  }

  for (let i = 0; i < s.scrolledOffBelow.length; i++) {
    joinRows(lines, s.scrolledOffBelow[i]!, s.scrolledOffBelowSW[i])
  }

  return lines.join('\n')
}

/**
 * Capture text from rows about to scroll out of the viewport during
 * drag-to-scroll, BEFORE scrollBy overwrites them. Only the rows that
 * intersect the selection are captured, using the selection's col bounds
 * for the anchor-side boundary row. After capturing the anchor row, the
 * anchor.col AND anchorSpan cols are reset to the full-width boundary so
 * subsequent captures and the final getSelectedText don't re-apply a stale
 * col constraint to content that's no longer under the original anchor.
 * Both span cols are reset (not just the near side): after a blocked
 * reversal the drag can flip direction, and extendSelection then reads the
 * OPPOSITE span side — which would otherwise still hold the original word
 * boundary and truncate one subsequently-captured row.
 *
 * side='above': rows scrolling out the top (dragging down, anchor=start).
 * side='below': rows scrolling out the bottom (dragging up, anchor=end).
 */
// 这个函数有个签名里看不出来的前置条件：**必须在内容被覆盖之前调用**。
// 调用点在 `ink.tsx` 的滚动处理里，紧跟 `scrollBy` 之前；
// 顺序反过来的话拿到的就是新内容，抄下来的行全是错的，
// 而且没有任何断言会报错 —— 复制出来只是「内容不对」，不会崩。
//
// 这类「时序契约」在这个项目里出现过好几次（先写盘再断连、先 native 再 tmux），
// 共同点是：**错了不报错，只是结果微妙地不对**。
export function captureScrolledRows(
  s: SelectionState,
  screen: Screen,
  firstRow: number,
  lastRow: number,
  side: 'above' | 'below',
): void {
  const b = selectionBounds(s)
  if (!b || firstRow > lastRow) return
  const { start, end } = b
  // Intersect [firstRow, lastRow] with [start.row, end.row]. Rows outside
  // the selection aren't captured — they weren't selected.
  const lo = Math.max(firstRow, start.row)
  const hi = Math.min(lastRow, end.row)
  if (lo > hi) return

  const width = screen.width
  const sw = screen.softWrap
  const captured: string[] = []
  const capturedSW: boolean[] = []
  for (let row = lo; row <= hi; row++) {
    const colStart = row === start.row ? start.col : 0
    const colEnd = row === end.row ? end.col : width - 1
    captured.push(extractRowText(screen, row, colStart, colEnd))
    capturedSW.push(sw[row]! > 0)
  }

// 「抄完就把 col 约束置为整宽」这一段值得单独看：
// 它重置的是 `anchor.col` **和** `anchorSpan` 的两端列号，而不只是近端。
//
// 为什么要连远端一起重置：反向拖动是可能的（拖出去、ScrollBox 被卡住、
// 用户往回拖），那时 `extendSelection` 会读 span 的**另一端**。
// 只重置近端的话，那一端还留着原始词的边界，会把随后抄下的整行截断。
//
// 「修一半」在这里的典型症状是：正常拖没问题，**反向拖一次**之后
// 复制少开头几个字。这类 bug 很难复现，所以只能靠把两端都重置掉。
  if (side === 'above') {
    // Newest rows go at the bottom of the above-accumulator (closest to
    // the on-screen content in reading order).
    s.scrolledOffAbove.push(...captured)
    s.scrolledOffAboveSW.push(...capturedSW)
    // We just captured the top of the selection. The anchor (=start when
    // dragging down) is now pointing at content that will scroll out; its
    // col constraint was applied to the captured row. Reset to col 0 so
    // the NEXT tick and the final getSelectedText read the full row.
    if (s.anchor && s.anchor.row === start.row && lo === start.row) {
      s.anchor = { col: 0, row: s.anchor.row }
      if (s.anchorSpan) {
        s.anchorSpan = {
          kind: s.anchorSpan.kind,
          lo: { col: 0, row: s.anchorSpan.lo.row },
          hi: { col: width - 1, row: s.anchorSpan.hi.row },
        }
      }
    }
  } else {
    // Newest rows go at the TOP of the below-accumulator — they're
    // closest to the on-screen content.
    s.scrolledOffBelow.unshift(...captured)
    s.scrolledOffBelowSW.unshift(...capturedSW)
    if (s.anchor && s.anchor.row === end.row && hi === end.row) {
      s.anchor = { col: width - 1, row: s.anchor.row }
      if (s.anchorSpan) {
        s.anchorSpan = {
          kind: s.anchorSpan.kind,
          lo: { col: 0, row: s.anchorSpan.lo.row },
          hi: { col: width - 1, row: s.anchorSpan.hi.row },
        }
      }
    }
  }
}

// 【在正确的层解决：改缓冲，不改 diff】
//
//   高亮可以有三条路：① 另画一层 ② 让 diff 认识选区 ③ 直接改屏幕格子的样式。
//   这里选了 ③：把选区里每一格的 `styleId` 换成「保留前景、换实心底色」的那个 id，
//   然后交给正常的 diff 去发现——`LogUpdate` **完全不知道「选区」存在**。
//
//   这个选择的收益很大：diff 仍然是一个纯粹的两帧比较器，
//   不需要为「高亮变了但文字没变」再开一条路径（那会是最容易出错的地方：
//   只比文字的话高亮变化会被漏掉）。
//
//   为什么不用 SGR-7 反显（老版本的做法）：反显是**逐格交换**前景/背景，
//   而代码是语法高亮的 —— 每个 token 有自己的前景色，一交换，
//   每一段就变成不同的背景色，整片像打了彩色马赛克。
//   实心底色「替换」背景、保留前景，才是终端原生选区的样子。
//
//   性能上靠 `StylePool.withSelectionBg` 的缓存：拖动时每格只是一次 Map 查找
//   加一次整数写入，不重新拼 SGR。所以「每帧重算整片高亮」是可以接受的 ——
//   它不需要增量更新。
/**
 * Apply the selection overlay directly to the screen buffer by changing
 * the style of every cell in the selection range. Called after the
 * renderer produces the Frame but before the diff — the normal diffEach
 * then picks up the restyled cells as ordinary changes, so LogUpdate
 * stays a pure diff engine with no selection awareness.
 *
 * Uses a SOLID selection background (theme-provided via StylePool.
 * setSelectionBg) that REPLACES each cell's bg while PRESERVING its fg —
 * matches native terminal selection. Previously SGR-7 inverse (swapped
 * fg/bg per cell), which fragmented badly over syntax-highlighted text:
 * every distinct fg color became a different bg stripe.
 *
 * Uses StylePool caches so on drag the only work per cell is a Map
 * lookup + packed-int write.
 */
export function applySelectionOverlay(
  screen: Screen,
  selection: SelectionState,
  stylePool: StylePool,
): void {
  const b = selectionBounds(selection)
  if (!b) return
  const { start, end } = b
  const width = screen.width
  const noSelect = screen.noSelect
  for (let row = start.row; row <= end.row && row < screen.height; row++) {
    const colStart = row === start.row ? start.col : 0
    const colEnd = row === end.row ? Math.min(end.col, width - 1) : width - 1
    const rowOff = row * width
    for (let col = colStart; col <= colEnd; col++) {
      const idx = rowOff + col
      // Skip noSelect cells — gutters stay visually unchanged so it's
      // clear they're not part of the copy. Surrounding selectable cells
      // still highlight so the selection extent remains visible.
      if (noSelect[idx] === 1) continue
      const cell = cellAtIndex(screen, idx)
      setCellStyleId(screen, col, row, stylePool.withSelectionBg(cell.styleId))
    }
  }
}
