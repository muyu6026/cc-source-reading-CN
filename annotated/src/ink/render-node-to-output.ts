import indentString from 'indent-string'
import { applyTextStyles } from './colorize.js'
import type { DOMElement } from './dom.js'
import getMaxWidth from './get-max-width.js'
import type { Rectangle } from './layout/geometry.js'
import { LayoutDisplay, LayoutEdge, type LayoutNode } from './layout/node.js'
import { nodeCache, pendingClears } from './node-cache.js'
import type Output from './output.js'
import renderBorder from './render-border.js'
import type { Screen } from './screen.js'
import {
  type StyledSegment,
  squashTextNodesToSegments,
} from './squash-text-nodes.js'
import type { Color } from './styles.js'
import { isXtermJs } from './terminal.js'
import { widestLine } from './widest-line.js'
import wrapText from './wrap-text.js'

// ═══════════════════════════════════════════════════════════════
//  第三层之二：把布局树摊进屏幕缓冲区
// ═══════════════════════════════════════════════════════════════
//
//   上一层（dom + yoga）给的是「每个节点多宽多高、放在哪个坐标」。
//   这一层沿着树走一遍，把每个节点的内容**写进格子**。
//
//   走树时每个节点只有三种去处：
//     ① blit  —— 干净且位置没变，从上一帧的缓冲区整块拷（455 行）
//     ② 重画  —— 脏了或挪了，先清旧位置再画新内容
//     ③ 跳过  —— display:none、h=0 且与兄弟同行、被滚动区裁掉
//
//   全文件的复杂度几乎都来自 ①：**怎么安全地跳过**。每一次「跳过」
//   都是一个「我确信这块没变」的断言，而外部世界总在破坏它
//   （脏兄弟溢出、浮层越界、滚动位移、绝对定位嵌套）。
//
// 【本文件三个最值得看的点】
//   ① 412  display:none 之后的那段清理 —— 不清子孙 cache 会让内容
//      「取消隐藏后消失」，而且只在位置恰好没变时触发
//   ② 688  ScrollBox 的三遍渲染 —— 硬件滚动快路径怎么把
//      「一屏语法高亮的聊天记录」压成「只画边缘几行」
//   ③ 1229 renderChildren 的污染守卫 —— 一个脏兄弟会毒化它后面
//      所有兄弟的 blit 资格，而裁剪能把毒性挡住
//
// 【模块级变量的代价】
//   本文件用了六个模块级变量（layoutShifted / scrollHint /
//   absoluteRectsPrev / absoluteRectsCur / scrollDrainNode / followScroll）。
//   渲染是单线程同步递归，所以不需要传参；代价是**不可重入**，
//   而且每个变量都必须有一对 reset/get 函数，靠调用方在帧首帧尾配对。
//   漏一个就是跨帧脏读。
// Matches detectXtermJsWheel() in ScrollKeybindingHandler.tsx — the curve
// and drain must agree on terminal detection. TERM_PROGRAM check is the sync
// fallback; isXtermJs() is the authoritative XTVERSION-probe result.
function isXtermJsHost(): boolean {
  return process.env.TERM_PROGRAM === 'vscode' || isXtermJs()
}

// 【这个布尔量决定「要不要动大锤」】
//
//   稳态帧（spinner 转一格、时钟跳一秒、往固定高度的盒子里追加文本）
//   布局没动，所以改动的格子局限在一小块 —— diff 只看那一块，
//   代价是 O(改动的格子)。
//
//   一旦有节点位置或尺寸变了，前面所有假设失效（内容整体位移）。
//   这时 ink.tsx 会上「全屏 damage 大锤」：整屏都算脏，
//   diff 退化成 O(行 × 列)。慢，但正确。
//
//   所以这个变量的语义是「这一帧有没有失去位置假设」，
//   而不是「有没有东西变了」。两者差别很大：内容变了但位置没变，
//   依然可以走窄 damage。
// Per-frame scratch: set when any node's yoga position/size differs from
// its cached value, or a child was removed. Read by ink.tsx to decide
// whether the full-damage sledgehammer (PR #20120) is needed this frame.
// Applies on both alt-screen and main-screen. Steady-state frames
// (spinner tick, clock tick, text append into a fixed-height box) don't
// shift layout → narrow damage bounds → O(changed cells) diff instead of
// O(rows×cols).
let layoutShifted = false

export function resetLayoutShifted(): void {
  layoutShifted = false
}

export function didLayoutShift(): boolean {
  return layoutShifted
}

// 【ScrollBox 滚动时给 log-update 的一张便条】
//
//   终端有硬件滚动能力：设一个滚动区域，让它整体上滚 n 行，
//   只有新进区域的那几行需要重画。字节数从「整屏」降到「几行」。
//
//   但要用这个能力，log-update 必须知道三件事：滚哪一段、滚多少、
//   往哪个方向。这三件事只有渲染的时候才知道（scrollTop 是在这里算出来的），
//   所以放在这个模块级变量里传出去。
//
//   注意 delta 的符号约定：正数 = 内容上移（scrollTop 增大）。
//   这个约定和 CSI n S（上滚）对齐，log-update 那边直接用。
// DECSTBM scroll optimization hint. When a ScrollBox's scrollTop changes
// between frames (and nothing else moved), log-update.ts can emit a
// hardware scroll (DECSTBM + SU/SD) instead of rewriting the whole
// viewport. top/bottom are 0-indexed inclusive screen rows; delta > 0 =
// content moved up (scrollTop increased, CSI n S).
export type ScrollHint = { top: number; bottom: number; delta: number }
let scrollHint: ScrollHint | null = null

// 【为什么需要记住「上一帧的绝对定位矩形」】
//
//   绝对定位的浮层可以画到父节点布局范围之外（比如用 bottom:'100%'
//   浮在输入框上方）。硬件滚动快路径做的是「blit 整块 + 位移」——
//   位移会把浮层的像素也一起挪走，而浮层本身的位置不该跟着滚。
//
//   于是需要第三遍修复（1063 行）：知道上一帧浮层在哪、滚完之后
//   它的残影落在哪，把那几行擦掉重画。
//
//   两个数组轮转（Prev/Cur）而不是只留一个：修复要用「上一帧」的矩形，
//   而本帧正在收集新的矩形。resetScrollHint 里的那一行赋值就是轮转点。
// Rects of position:absolute nodes from the PREVIOUS frame, used by
// ScrollBox's blit+shift third-pass repair (see usage site). Recorded at
// three paths — full-render nodeCache.set, node-level blit early-return,
// blitEscapingAbsoluteDescendants — so clean-overlay consecutive scrolls
// still have the rect.
let absoluteRectsPrev: Rectangle[] = []
let absoluteRectsCur: Rectangle[] = []

export function resetScrollHint(): void {
  scrollHint = null
  absoluteRectsPrev = absoluteRectsCur
  absoluteRectsCur = []
}

export function getScrollHint(): ScrollHint | null {
  return scrollHint
}

// 【滚动还没排空时，下一帧必须能再走进这个 ScrollBox】
//
//   滚动是渐进排空的（一次滚几行，剩下留在 pendingScrollDelta 里）。
//   但这一帧处理完之后，ScrollBox 的 dirty 标志已经被清掉了 ——
//   下一帧从 root 往下走，走到 ScrollBox 时「不脏、位置没变、有 cache」
//   → 直接 blit 整块 → **永远到不了排空逻辑** → 滚动卡住。
//
//   所以这里要把这个节点记下来，由 renderer.ts 在本帧之后重新标脏，
//   强制下一帧走下来。这是一个「渲染过程反过来影响下一帧调度」的回路。
//
//   注释里写的「drain stalls」就是这个症状：滚轮转了，画面只动一下。
// The ScrollBox DOM node (if any) with pendingScrollDelta left after this
// frame's drain. renderer.ts calls markDirty(it) post-render so the NEXT
// frame's root blit check fails and we descend to continue draining.
// Without this, after the scrollbox's dirty flag is cleared (line ~721),
// the next frame blits root and never reaches the scrollbox — drain stalls.
let scrollDrainNode: DOMElement | null = null

export function resetScrollDrainNode(): void {
  scrollDrainNode = null
}

export function getScrollDrainNode(): DOMElement | null {
  return scrollDrainNode
}

// 【跟底滚动要通知外面，因为选区得跟着动】
//
//   场景：用户在流式输出时选中了一段文字，内容一直往下长，
//   视图自动跟到底部。此时选中高亮的**屏幕坐标**应该往上走
//   （文字没变，是屏幕在滚）—— 这是原生终端的行为。
//
//   所以这里把「滚了多少、视口在哪」记下来，ink.tsx 拿到之后
//   把选区的 y 减去 delta。
//
//   注意注释里的时序：frontFrame 的缓冲区里还是旧内容，
//   必须在前后帧交换**之前**把它抄走，否则复制出来的文本就是滚动后的新内容。
// At-bottom follow scroll event this frame. When streaming content
// triggers scrollTop = maxScroll, the ScrollBox records the delta +
// viewport bounds here. ink.tsx consumes it post-render to translate any active
// text selection by -delta so the highlight stays anchored to the TEXT
// (native terminal behavior — the selection walks up the screen as content
// scrolls, eventually clipping at the top). The frontFrame screen buffer
// still holds the old content at that point — captureScrolledRows reads
// from it before the front/back swap to preserve the text for copy.
export type FollowScroll = {
  delta: number
  viewportTop: number
  viewportBottom: number
}
let followScroll: FollowScroll | null = null

export function consumeFollowScroll(): FollowScroll | null {
  const f = followScroll
  followScroll = null
  return f
}

// 【两套排空策略，因为两类终端的输入特征完全不同】
//
//   原生终端（iTerm2 / Ghostty / Terminal.app）：滚轮事件是**比例的** ——
//   一次事件可能带十几行。所以按比例排空，让大幅甩动在几帧内收敛。
//
//   xterm.js（VS Code 集成终端）：事件稀疏，而且它自己带一条加速曲线。
//   如果再按比例排空，会和它的曲线叠加成「先慢后暴冲」。
//   所以改成小步固定步长，让动画看起来均匀。
//
//   这个分叉不是「两种终端能力不同」，而是「两种输入节奏不同」。
//   判据（isXtermJsHost）在 23 行，靠 TERM_PROGRAM 同步兜底 +
//   XTVERSION 异步探测两条路 —— 注释特别说明：探测结果在滚轮事件到达时
//   早已就绪（启动 50ms 之后才会有滚轮），所以不会读到未决状态。
// ── Native terminal drain (iTerm2/Ghostty/etc. — proportional events) ──
// Minimum rows applied per frame. Above this, drain is proportional (~3/4
// of remaining) so big bursts catch up in log₄ frames while the tail
// decelerates smoothly. Hard cap is innerHeight-1 so DECSTBM hint fires.
const SCROLL_MIN_PER_FRAME = 4

// ── xterm.js (VS Code) smooth drain ──
// Low pending (≤5) drains ALL in one frame — slow wheel clicks should be
// instant (click → visible jump → done), not micro-stutter 1-row frames.
// Higher pending drains at a small fixed step so fast-scroll animation
// stays smooth (no big jumps). Pending >MAX snaps excess.
const SCROLL_INSTANT_THRESHOLD = 5 // ≤ this: drain all at once
const SCROLL_HIGH_PENDING = 12 // threshold for HIGH step
const SCROLL_STEP_MED = 2 // pending (INSTANT, HIGH): catch-up
const SCROLL_STEP_HIGH = 3 // pending ≥ HIGH: fast flick
const SCROLL_MAX_PENDING = 30 // snap excess beyond this

// 【≤5 行就一次排完】
//
//   慢速滚轮（一格一格转）如果用「每帧 2 行」的动画，会变成
//   「转一下 → 卡两帧 → 再动」的微抖动。用户的意图是「走一行」，
//   立刻到位才是对的。
//
//   只有大量待处理（快速甩动）才需要动画 —— 那时候直接跳会晕。
//   所以阈值把这两种意图分开：小量=瞬时，大量=缓动。
// xterm.js adaptive drain. Returns rows applied; mutates pendingScrollDelta.
function drainAdaptive(
  node: DOMElement,
  pending: number,
  innerHeight: number,
): number {
  const sign = pending > 0 ? 1 : -1
  let abs = Math.abs(pending)
  let applied = 0
  // Snap excess beyond animation window so big flicks don't coast.
  if (abs > SCROLL_MAX_PENDING) {
    applied += sign * (abs - SCROLL_MAX_PENDING)
    abs = SCROLL_MAX_PENDING
  }
  // ≤5: drain all (slow click = instant). Above: small fixed step.
  const step =
    abs <= SCROLL_INSTANT_THRESHOLD
      ? abs
      : abs < SCROLL_HIGH_PENDING
        ? SCROLL_STEP_MED
        : SCROLL_STEP_HIGH
  applied += sign * step
  const rem = abs - step
  // Cap total at innerHeight-1 so DECSTBM blit+shift fast path fires
  // (matches drainProportional). Excess stays in pendingScrollDelta.
  const cap = Math.max(1, innerHeight - 1)
  const totalAbs = Math.abs(applied)
  if (totalAbs > cap) {
    const excess = totalAbs - cap
    node.pendingScrollDelta = sign * (rem + excess)
    return sign * cap
  }
  node.pendingScrollDelta = rem > 0 ? sign * rem : undefined
  return applied
}

// 【3/4 比例 = 每帧剩 1/4，四帧收敛一个数量级】
//
//   step = max(4, floor(pending × 3/4))。剩余量每帧乘 1/4，
//   所以 100 行的甩动大约 4 帧排完，而尾段自动减速（因为剩余量在变小）。
//   这就是「log₄ 帧收敛」：一个固定常数就能得到自然的减速曲线，
//   不需要维护速度状态。
//
//   下限 4 行：剩得很少时不能排太慢，否则最后几行拖很久。
//   上限 innerHeight - 1：超过这个量，DECSTBM 的那张便条（44 行）
//   就不成立了（整屏都换掉等于全清，硬件滚动没有意义），
//   快路径失效就退化成全量重画。
//
//   167 行那个 cap 是同一个理由的两处表达：drainAdaptive 里也有，
//   因为两条路径都要保证「本帧滚动的行数 < 视口高度」。
// Native proportional drain. step = max(MIN, floor(abs*3/4)), capped at
// innerHeight-1 so DECSTBM + blit+shift fast path fire.
function drainProportional(
  node: DOMElement,
  pending: number,
  innerHeight: number,
): number {
  const abs = Math.abs(pending)
  const cap = Math.max(1, innerHeight - 1)
  const step = Math.min(cap, Math.max(SCROLL_MIN_PER_FRAME, (abs * 3) >> 2))
  if (abs <= step) {
    node.pendingScrollDelta = undefined
    return pending
  }
  const applied = pending > 0 ? step : -step
  node.pendingScrollDelta = pending - applied
  return applied
}

// 【OSC 8 的参数位故意留空】
//
//   完整形式是 ESC ] 8 ; params ; URI BEL，这里是 `8;;URI`。
//   params 位可以放 id=xxx（用于把折行的多段归为同一个链接），
//   但那个 id 是在**落盘时**（termio/osc.ts 的 link()）才加的 ——
//   因为只有到了输出阶段才知道哪几行属于同一个链接。
//
//   为什么这里要留空而不是省略：ansi-tokenize 只认这个精确前缀，
//   少了空参数位它就识别不出这是超链接，会把它当普通样式混进 StylePool。
//   这类「格式上冗余但解析器要求」的字段，删掉不会报错，只会静默失效。
// OSC 8 hyperlink escape sequences. Empty params (;;) — ansi-tokenize only
// recognizes this exact prefix. The id= param (for grouping wrapped lines)
// is added at terminal-output time in termio/osc.ts link().
const OSC = '\u001B]'
const BEL = '\u0007'

function wrapWithOsc8Link(text: string, url: string): string {
  return `${OSC}8;;${url}${BEL}${text}${OSC}8;;${BEL}`
}

/**
 * Build a mapping from each character position in the plain text to its segment index.
 * Returns an array where charToSegment[i] is the segment index for character i.
 */
// 【字符 → 段 的映射，为什么要单独建一张表】
//
//   文本在树里是一串「段」（每段有自己的样式和超链接），
//   但换行是对**纯文本**做的 —— wrapText 拿到的是一整串字符，
//   它不知道样式边界在哪。
//
//   换行之后，原来「第 i 个字符」现在可能在第二行第 j 列。
//   要重新套样式，就得知道每个字符原本属于哪一段。
//   这张表就是干这个的：下标是纯文本字符位置，值是段下标。
//
//   为什么不用二分查找（段有累计长度）？因为这里只需要线性扫一遍，
//   而表格查表比二分快，内存也不大（一行文本的长度）。
function buildCharToSegmentMap(segments: StyledSegment[]): number[] {
  const map: number[] = []
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i]!.text.length
    for (let j = 0; j < len; j++) {
      map.push(i)
    }
  }
  return map
}

/**
 * Apply styles to wrapped text by mapping each character back to its original segment.
 * This preserves per-segment styles even when text wraps across lines.
 *
 * @param trimEnabled - Whether whitespace trimming is enabled (wrap-trim mode).
 *   When true, we skip whitespace in the original that was trimmed from the output.
 *   When false (wrap mode), all whitespace is preserved so no skipping is needed.
 */
// 【换行会打乱样式边界，所以要按「字符位置」重新分段】
//
//   做法：走一遍换行后的文本，维护 runStart（当前段的起点）和
//   runSegmentIndex（当前段的样式来源）。段号一变就 flush 一段 ——
//   即把 runStart..i 这段文字套上刚结束的那段的样式。
//
//   这是「先做纯文本变换，再用映射还原格式」的标准套路。
//   反过来（带着样式换行）也行，但需要换行算法理解样式，
//   而 wrapText 是个通用工具，不该知道样式。
//
//   下面 229-243 那段 trim 处理是全函数最脏的地方，理由见 301 行：
//   trim 模式会吃掉行首空白，于是「第 i 个字符」和原文本就错位了。
//   必须把被吃掉的空白跳过去，才能继续保持对齐。
function applyStylesToWrappedText(
  wrappedPlain: string,
  segments: StyledSegment[],
  charToSegment: number[],
  originalPlain: string,
  trimEnabled: boolean = false,
): string {
  const lines = wrappedPlain.split('\n')
  const resultLines: string[] = []

  let charIndex = 0
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!

    // In trim mode, skip leading whitespace that was trimmed from this line.
    // Only skip if the original has whitespace but the output line doesn't start
    // with whitespace (meaning it was trimmed). If both have whitespace, the
    // whitespace was preserved and we shouldn't skip.
    if (trimEnabled && line.length > 0) {
      const lineStartsWithWhitespace = /\s/.test(line[0]!)
      const originalHasWhitespace =
        charIndex < originalPlain.length && /\s/.test(originalPlain[charIndex]!)

      // Only skip if original has whitespace but line doesn't
      if (originalHasWhitespace && !lineStartsWithWhitespace) {
        while (
          charIndex < originalPlain.length &&
          /\s/.test(originalPlain[charIndex]!)
        ) {
          charIndex++
        }
      }
    }

    let styledLine = ''
    let runStart = 0
    let runSegmentIndex = charToSegment[charIndex] ?? 0

    for (let i = 0; i < line.length; i++) {
      const currentSegmentIndex = charToSegment[charIndex] ?? runSegmentIndex

      if (currentSegmentIndex !== runSegmentIndex) {
        // Flush the current run
        const runText = line.slice(runStart, i)
        const segment = segments[runSegmentIndex]
        if (segment) {
          let styled = applyTextStyles(runText, segment.styles)
          if (segment.hyperlink) {
            styled = wrapWithOsc8Link(styled, segment.hyperlink)
          }
          styledLine += styled
        } else {
          styledLine += runText
        }
        runStart = i
        runSegmentIndex = currentSegmentIndex
      }

      charIndex++
    }

    // Flush the final run
    const runText = line.slice(runStart)
    const segment = segments[runSegmentIndex]
    if (segment) {
      let styled = applyTextStyles(runText, segment.styles)
      if (segment.hyperlink) {
        styled = wrapWithOsc8Link(styled, segment.hyperlink)
      }
      styledLine += styled
    } else {
      styledLine += runText
    }

    resultLines.push(styledLine)

    // Skip newline character in original that corresponds to this line break.
    // This is needed when the original text contains actual newlines (not just
    // wrapping-inserted newlines). Without this, charIndex gets out of sync
    // because the newline is in originalPlain/charToSegment but not in the
    // split lines.
    if (charIndex < originalPlain.length && originalPlain[charIndex] === '\n') {
      charIndex++
    }

    // In trim mode, skip whitespace that was replaced by newline when wrapping.
    // We skip whitespace in the original until we reach a character that matches
    // the first character of the next line. This handles cases like:
    // - "AB   \tD" wrapped to "AB\n\tD" - skip spaces until we hit the tab
    // In non-trim mode, whitespace is preserved so no skipping is needed.
    if (trimEnabled && lineIdx < lines.length - 1) {
      const nextLine = lines[lineIdx + 1]!
      const nextLineFirstChar = nextLine.length > 0 ? nextLine[0] : null

      // Skip whitespace until we hit a char that matches the next line's first char
      while (
        charIndex < originalPlain.length &&
        /\s/.test(originalPlain[charIndex]!)
      ) {
        // Stop if we found the character that starts the next line
        if (
          nextLineFirstChar !== null &&
          originalPlain[charIndex] === nextLineFirstChar
        ) {
          break
        }
        charIndex++
      }
    }
  }

  return resultLines.join('\n')
}

// 【为什么要逐行调 wrapText，而不是整串调一次】
//
//   输出结果是一样的（wrapText 本来就是逐行处理的）。差别在**来源标记**：
//   整串调一次，事后无法区分「这个换行是原文里的」还是「折行加的」。
//   逐行调，每行的第一片之外都是折出来的，于是能准确地标出
//   softWrap[i] = i > 0。
//
//   这个标记一路传到 screen 的 softWrap 数组，最后用于「复制文本时
//   把软换行的两行拼回去，硬换行才保留换行符」。
//
//   truncate 类模式不会产生新行（cli-truncate 是整串处理），
//   所以直接返回 undefined —— 不跟踪、行为与引入标记之前完全一致。
/**
 * Wrap text and record which output lines are soft-wrap continuations
 * (i.e. the `\n` before them was inserted by word-wrap, not in the
 * source). wrapAnsi already processes each input line independently, so
 * wrapping per-input-line here gives identical output to a single
 * whole-string wrap while letting us mark per-piece provenance.
 * Truncate modes never add newlines (cli-truncate is whole-string) so
 * they fall through with softWrap undefined — no tracking, no behavior
 * change from the pre-softWrap path.
 */
function wrapWithSoftWrap(
  plainText: string,
  maxWidth: number,
  textWrap: Parameters<typeof wrapText>[2],
): { wrapped: string; softWrap: boolean[] | undefined } {
  if (textWrap !== 'wrap' && textWrap !== 'wrap-trim') {
    return {
      wrapped: wrapText(plainText, maxWidth, textWrap),
      softWrap: undefined,
    }
  }
  const origLines = plainText.split('\n')
  const outLines: string[] = []
  const softWrap: boolean[] = []
  for (const orig of origLines) {
    const pieces = wrapText(orig, maxWidth, textWrap).split('\n')
    for (let i = 0; i < pieces.length; i++) {
      outLines.push(pieces[i]!)
      softWrap.push(i > 0)
    }
  }
  return { wrapped: outLines.join('\n'), softWrap }
}

// If parent container is `<Box>`, text nodes will be treated as separate nodes in
// the tree and will have their own coordinates in the layout.
// To ensure text nodes are aligned correctly, take X and Y of the first text node
// and use it as offset for the rest of the nodes
// Only first node is taken into account, because other text nodes can't have margin or padding,
// so their coordinates will be relative to the first node anyway
// 【文本节点的坐标基准：第一个子节点的位置】
//
//   一个 <Text> 在 yoga 里是一个盒子，但它内部的文字是「流」，
//   流到第几行、从第几列开始，没有逐字符的布局节点。
//
//   所以这里用第一个文本子节点的 computedLeft/Top 当基准：
//   往上补空行、往左缩进，把文字推到正确位置。
//
//   为什么只取第一个？因为后面的文本子节点不能有 margin/padding
//   （见 363 行注释），它们的坐标一定是相对第一个的偏移 ——
//   换句话说，第一个节点定了，其余的自然对。
//
//   这是一个「用布局系统的限制换实现简单」的取舍。限制由 dom 层保证
//   （文本子节点上设 margin 会被忽略或报错）。
function applyPaddingToText(
  node: DOMElement,
  text: string,
  softWrap?: boolean[],
): string {
  const yogaNode = node.childNodes[0]?.yogaNode

  if (yogaNode) {
    const offsetX = yogaNode.getComputedLeft()
    const offsetY = yogaNode.getComputedTop()
    text = '\n'.repeat(offsetY) + indentString(text, offsetX)
    if (softWrap && offsetY > 0) {
      // Prepend `false` for each padding line so indices stay aligned
      // with text.split('\n'). Mutate in place — caller owns the array.
      softWrap.unshift(...Array<boolean>(offsetY).fill(false))
    }
  }

  return text
}

// After nodes are laid out, render each to output object, which later gets rendered to terminal
// ═══════════════════════════════════════════════════════════════
//  主递归：一个节点进来，决定 blit / 清空 / 重画
// ═══════════════════════════════════════════════════════════════
//
//   顺序很重要，从上到下是：
//     412  display:none → 清旧位置 + 丢子孙 cache，返回
//     436  算绝对坐标（yoga 给的是相对父级的）
//     448  负 y 的绝对定位 → 下移到 0
//     455  能 blit 吗？八个条件
//     493  位置变了 → 记 layoutShifted
//     496  脏了或挪了 → 清旧位置
//     510  有子节点被删 → 清它们留下的坑
//     535  h=0 且与兄弟同行 → 跳过
//     541  按元素类型画（raw-ansi / text / box / root）
//     1219 记 cache、清 dirty
//
//   最后两行（1219-1225）是**所有路径的汇合点** ——
//   除了提前 return 的那几个分支，每个节点走完都会到这里更新 cache。
//   这是下一帧能 blit 的前提。
function renderNodeToOutput(
  node: DOMElement,
  output: Output,
  {
    offsetX = 0,
    offsetY = 0,
    prevScreen,
    skipSelfBlit = false,
    inheritedBackgroundColor,
  }: {
    offsetX?: number
    offsetY?: number
    prevScreen: Screen | undefined
    // Force this node to descend instead of blitting its own rect, while
    // still passing prevScreen to children. Used for non-opaque absolute
    // overlays over a dirty clipped region: the overlay's full rect has
    // transparent gaps (stale underlying content in prevScreen), but its
    // opaque descendants' narrower rects are safe to blit.
    skipSelfBlit?: boolean
    inheritedBackgroundColor?: Color
  },
): void {
  const { yogaNode } = node

// 没有 yogaNode 的节点（#text 文本片段）在这里被过滤掉 ——
// 它们的渲染由父级的 ink-text 分支统一处理（549 行）。
// 所以这个递归只处理「有布局盒子的节点」。
  if (yogaNode) {
// 【display:none 之后的清理，注释里有一段完整的 bug 复盘】
//
//   隐藏一个节点时，React 会调 hideInstance，它把 dirty 往上标 ——
//   **只往上**。所以子孙节点的 dirty 保持 false，而它们的 cache 里
//   还留着隐藏前的位置和尺寸。
//
//   危险在于取消隐藏时：如果位置恰好没变（很常见，同一处渲染），
//   455 行的 blit 检查全部通过 → 从这个位置拷上一帧的格子 →
//   但上一帧这个位置已经被清空了 → **拷回来一片空白，内容消失**。
//
//   所以 428 行的 dropSubtreeCache 是必需的，不是优化。
//   它把整棵子树的 cache 丢掉，让取消隐藏时走完整重画。
//
//   ⚠ 这个 bug 的特征：内容不是「不见了」，而是「取消隐藏后还是空的」，
//   而且只在位置没变时出现 —— 挪一下窗口反而好了。
    if (yogaNode.getDisplay() === LayoutDisplay.None) {
      // Clear old position if node was visible before becoming hidden
      if (node.dirty) {
        const cached = nodeCache.get(node)
        if (cached) {
          output.clear({
            x: Math.floor(cached.x),
            y: Math.floor(cached.y),
            width: Math.floor(cached.width),
            height: Math.floor(cached.height),
          })
          // Drop descendants' cache too — hideInstance's markDirty walks UP
          // only, so descendants' .dirty stays false. Their nodeCache entries
          // survive with pre-hide rects. On unhide, if position didn't shift,
          // the blit check at line ~432 passes and copies EMPTY cells from
          // prevScreen (cleared here) → content vanishes.
          dropSubtreeCache(node)
          layoutShifted = true
        }
      }
      return
    }

    // Left and top positions in Yoga are relative to their parent node
    const x = offsetX + yogaNode.getComputedLeft()
    const yogaTop = yogaNode.getComputedTop()
    let y = offsetY + yogaTop
    const width = yogaNode.getComputedWidth()
    const height = yogaNode.getComputedHeight()

    // Absolute-positioned overlays (e.g. autocomplete menus with bottom='100%')
    // can compute negative screen y when they extend above the viewport. Without
    // clamping, setCellAt drops cells at y<0, clipping the TOP of the content
    // (best matches in an autocomplete). By clamping to 0, we shift the element
    // down so the top rows are visible and the bottom overflows below — the
    // opaque prop ensures it paints over whatever is underneath.
// 【负 y 的绝对定位：往回收，不是截断】
//
//   一个 bottom:'100%' 的浮层（比如补全菜单）浮在输入框上方，
//   如果它比上方空间高，yoga 会算出负的 y。
//
//   setCellAt 对 y<0 直接丢弃（越界检查），于是浮层**顶部**被裁掉 ——
//   而顶部往往是「最匹配的几条」。
//
//   这里的做法是把整个元素下移到 y=0：顶部露出来，底部溢出到屏幕外。
//   前提是 opaque 属性保证它盖住下面的东西（否则会看到两层叠着）。
//
//   注意只对 absolute 生效 —— 普通流式元素出现负 y 是布局 bug，
//   应该暴露出来，不该被悄悄修正。
    if (y < 0 && node.style.position === 'absolute') {
      y = 0
    }

    // Check if we can skip this subtree (clean node with unchanged layout).
    // Blit cells from previous screen instead of re-rendering.
    const cached = nodeCache.get(node)
// 【blit 的八个条件，缺一不可】
//
//   !node.dirty                本节点没变
//   !skipSelfBlit              不是因为污染被强制下降
//   pendingScrollDelta === undefined   没有待排空的滚动
//   cached                     有上一帧的矩形
//   cached.x/y/width/height 全等  位置和尺寸都没变
//   prevScreen                 有上一帧缓冲区可拷
//
//   全部满足 → 整块从 prevScreen 拷过来，跳过整棵子树。
//   这是「一屏几万格、一帧只改十几格」能成立的根本。
//
//   ⚠ 这里没有检查子孙的 dirty —— 这正是它能跳过整棵子树的原因，
//   也是所有 blit 相关 bug 的根源：**父节点干净不等于子树干净**。
//   React 的 dirty 是向上冒泡的（子脏父必脏），所以正常情况下成立；
//   但凡是绕过冒泡的路径（hideInstance、pendingScrollDelta、
//   被裁剪的子节点）都会在这里破一个洞。
    if (
      !node.dirty &&
      !skipSelfBlit &&
      node.pendingScrollDelta === undefined &&
      cached &&
      cached.x === x &&
      cached.y === y &&
      cached.width === width &&
      cached.height === height &&
      prevScreen
    ) {
      const fx = Math.floor(x)
      const fy = Math.floor(y)
      const fw = Math.floor(width)
      const fh = Math.floor(height)
      output.blit(prevScreen, fx, fy, fw, fh)
// 绝对定位的节点 blit 完要登记，供 1063 行的第三遍修复使用。
// 这一行看着不起眼，但漏了它，滚动时浮层会留下残影。
      if (node.style.position === 'absolute') {
        absoluteRectsCur.push(cached)
      }
      // Absolute descendants can paint outside this node's layout bounds
      // (e.g. a slash menu with position='absolute' bottom='100%' floats
      // above). If a dirty clipped sibling re-rendered and overwrote those
      // cells, the blit above only restored this node's own rect — the
      // absolute descendants' cells are lost. Re-blit them from prevScreen
      // so the overlays survive.
      blitEscapingAbsoluteDescendants(node, output, prevScreen, fx, fy, fw, fh)
      return
    }

    // Clear stale content from the old position when re-rendering.
    // Dirty: content changed. Moved: position/size changed (e.g., sibling
    // above changed height), old cells still on the terminal.
// 【位置变了 = 位置假设失效】
//
//   和 dirty（内容变了）不同：位置变了意味着**别的节点也可能跟着挪了**，
//   所有基于上一帧坐标的推断都不再可靠。所以这里不只影响本节点，
//   还要置 layoutShifted 让整帧走保守路径。
    const positionChanged =
      cached !== undefined &&
      (cached.x !== x ||
        cached.y !== y ||
        cached.width !== width ||
        cached.height !== height)
    if (positionChanged) {
      layoutShifted = true
    }
    if (cached && (node.dirty || positionChanged)) {
      output.clear(
        {
          x: Math.floor(cached.x),
          y: Math.floor(cached.y),
          width: Math.floor(cached.width),
          height: Math.floor(cached.height),
        },
        node.style.position === 'absolute',
      )
    }

    // Read before deleting — hasRemovedChild disables prevScreen blitting
    // for siblings to prevent stale overflow content from being restored.
// 【子节点被删除留下的坑】
//
//   删掉一个节点时，它的格子还留在上一帧的缓冲区里。而删除操作发生在
//   React 的 mutation 阶段（dom.ts 的 removeChild），那时拿不到它的矩形 ——
//   所以先把矩形记进 pendingClears，等渲染走到父节点时再清。
//
//   508 行那句「Read before deleting」很重要：hasRemovedChild 一旦为真，
//   后面所有兄弟都不能再 blit（见 1229 行）。所以必须在这里读，
//   而不是在 delete 之后 —— 删除之后就无从判断「这一帧有没有删过东西」。
    const clears = pendingClears.get(node)
    const hasRemovedChild = clears !== undefined
    if (hasRemovedChild) {
      layoutShifted = true
      for (const rect of clears) {
        output.clear({
          x: Math.floor(rect.x),
          y: Math.floor(rect.y),
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        })
      }
      pendingClears.delete(node)
    }

    // Yoga squeezed this node to zero height (overflow in a height-constrained
    // parent) AND a sibling lands at the same y. Skip rendering — both would
    // write to the same row; if the sibling's content is shorter, this node's
    // tail chars ghost (e.g. "false" + "true" = "truee"). The clear above
    // already handled the visible→squeezed transition.
    //
    // The sibling-overlap check is load-bearing: Yoga's pixel-grid rounding
    // can give a box h=0 while still leaving a row for it (next sibling at
    // y+1, not y). HelpV2's third shortcuts column hits this — skipping
    // unconditionally drops "ctrl + z to suspend" from /help output.
// 【ghost 的判定：h=0 **且** 有兄弟落在同一行】
//
//   只有 h=0 不够。yoga 的像素取整可能给出 h=0，但下一个兄弟仍被推到
//   y+1 —— 此时两个节点不重叠，画了也不冲突。
//
//   注释里点的例子是 /help 输出的第三列快捷键：无条件跳过会把
//   "ctrl + z to suspend" 整行弄丢。
//
//   真正的 ghost 条件是「两个节点要写同一行」：较短的先写、较长的后写，
//   或者反过来 —— 短的那个擦不掉长的尾巴，屏幕上就是
//   "false" + "true" = "truee"。
    if (height === 0 && siblingSharesY(node, yogaNode)) {
      nodeCache.set(node, { x, y, width, height, top: yogaTop })
      node.dirty = false
      return
    }

// 【预渲染 ANSI：直接写，不解析】
//
//   这类节点的内容已经是「终端就绪」的（调用方自己换好行、发好转义），
//   所以跳过 squash / measure / wrap / 重新套样式四步。
//
//   output.write 会把 ANSI 解析成格子（它内部走 ansi-tokenize），
//   所以最终还是落在同一套数据结构上 —— 只是少了「理解语义」这一步。
//
//   什么时候用：内容来自外部（比如已经渲染好的 diff 补丁、语法高亮结果），
//   重新拆解再拼装只会引入不一致。
    if (node.nodeName === 'ink-raw-ansi') {
      // Pre-rendered ANSI content. The producer already wrapped to width and
      // emitted terminal-ready escape codes. Skip squash, measure, wrap, and
      // style re-application — output.write() parses ANSI directly into cells.
      const text = node.attributes['rawText'] as string
      if (text) {
        output.write(x, y, text)
      }
// 【ink-text 三条分支，按「要不要换行」和「有几段」正交划分】
//
//   不换行 + 任意段   →  逐段套样式拼接（611 行）
//   换行 + 单段       →  先换行，再逐行套同一份样式（576 行）
//   换行 + 多段       →  先换行，再按字符位置还原每段样式（595 行）
//
//   单段单独分一支是因为它便宜得多：整段一个样式，换行之后每行
//   直接套同一个样式即可，不需要建 charToSegment 映射。
//
//   多段那一支的注释（596 行）解释了为什么不能「带着样式换行」：
//   换行是纯文本操作，它会把一行切成两半，样式边界因此错位。
//   先换行再按位置还原，是唯一不要求换行算法理解样式的做法。
    } else if (node.nodeName === 'ink-text') {
      const segments = squashTextNodesToSegments(
        node,
        inheritedBackgroundColor
          ? { backgroundColor: inheritedBackgroundColor }
          : undefined,
      )

      // First, get plain text to check if wrapping is needed
      const plainText = segments.map(s => s.text).join('')

// 空文本直接跳过 —— 但注意这个判断在 squash 之后、wrap 之前，
// 因为「看起来是空的」可能只是样式段拼起来为空（比如全是零宽字符）。
      if (plainText.length > 0) {
        // Upstream Ink uses getMaxWidth(yogaNode) unclamped here. That
        // width comes from Yoga's AtMost pass and can exceed the actual
        // screen space (see getMaxWidth docstring). Yoga's height for this
        // node already reflects the constrained Exactly pass, so clamping
        // the wrap width here keeps line count consistent with layout.
        // Without this, characters past the screen edge are dropped by
        // setCellAt's bounds check.
// 【这一行是「上游不 clamp，这里 clamp」】
//
//   getMaxWidth(yogaNode) 来自 yoga 的 AtMost 测量轮 —— 它的语义是
//   「容器最多愿意给多宽」，可能比实际剩余空间大。
//
//   而 yoga 算高度时用的是 Exactly 轮（真正确定下来的宽度）。
//   如果这里用 AtMost 的宽度去换行，行数会比布局预期少 ——
//   文字挤在几行里，但 yoga 给它留的高度是按更多行算的，于是底部空一块。
//
//   所以取 min(可用宽度, 屏幕剩余宽度)。512 行那半句是理由：
//   不 clamp 的话，超出屏幕的字符会被 setCellAt 的越界检查丢掉，
//   结果是「文字被右边缘截断」，而且行数还算错了。
        const maxWidth = Math.min(getMaxWidth(yogaNode), output.width - x)
        const textWrap = node.style.textWrap ?? 'wrap'

        // Check if wrapping is needed
        const needsWrapping = widestLine(plainText) > maxWidth

        let text: string
        let softWrap: boolean[] | undefined
// 【单段：换行之后每行套同一个样式】
//
//   注意超链接是**逐行**包的（585-591 行的注释）：
//   output.write 把文本按换行切成多段、每段单独 tokenize，
//   所以如果在整块外面包一个 OSC 8，只有第一行会被识别成链接。
//
//   这类「外层包装在内层被切割之后就失效」的问题，凡是「模式型」
//   转义序列（OSC 8、超链接、部分终端的分屏模式）都有。
        if (needsWrapping && segments.length === 1) {
          // Single segment: wrap plain text first, then apply styles to each line
          const segment = segments[0]!
          const w = wrapWithSoftWrap(plainText, maxWidth, textWrap)
          softWrap = w.softWrap
          text = w.wrapped
            .split('\n')
            .map(line => {
              let styled = applyTextStyles(line, segment.styles)
              // Apply OSC 8 hyperlink per-line so each line is independently
              // clickable. output.ts splits on newlines and tokenizes each
              // line separately, so a single wrapper around the whole block
              // would only apply the hyperlink to the first line.
              if (segment.hyperlink) {
                styled = wrapWithOsc8Link(styled, segment.hyperlink)
              }
              return styled
            })
            .join('\n')
// 【多段：换行破坏了样式边界，要靠字符位置还原】
//
//   三步：纯文本换行 → 建字符到段的映射 → 逐字符走一遍，段号变化处切分。
//
//   注意 609 行的注释：超链接在 applyStylesToWrappedText 内部**按 run** 处理，
//   和样式同一时机。所以这里不用再补一层包装 —— 补了会重复包，
//   终端把第二个 OSC 8 当嵌套，行为未定义。
        } else if (needsWrapping) {
          // Multiple segments with wrapping: wrap plain text first, then re-apply
          // each segment's styles based on character positions. This preserves
          // per-segment styles even when text wraps across lines.
          const w = wrapWithSoftWrap(plainText, maxWidth, textWrap)
          softWrap = w.softWrap
          const charToSegment = buildCharToSegmentMap(segments)
          text = applyStylesToWrappedText(
            w.wrapped,
            segments,
            charToSegment,
            plainText,
            textWrap === 'wrap-trim',
          )
          // Hyperlinks are handled per-run in applyStylesToWrappedText via
          // wrapWithOsc8Link, similar to how styles are applied per-run.
        } else {
          // No wrapping needed: apply styles directly
          text = segments
            .map(segment => {
              let styledText = applyTextStyles(segment.text, segment.styles)
              if (segment.hyperlink) {
                styledText = wrapWithOsc8Link(styledText, segment.hyperlink)
              }
              return styledText
            })
            .join('')
        }

// 缩进放在最后一步：先把文字换好行、套好样式，再整体右移/下移。
// 顺序反过来（先缩进再换行）会让缩进参与宽度计算，实际可用宽度变少。
        text = applyPaddingToText(node, text, softWrap)

        output.write(x, y, text, softWrap)
      }
// ═══════════════════════════════════════════════════════════════
//  ink-box：颜色填充、裁剪、滚动
// ═══════════════════════════════════════════════════════════════
//
//   盒子本身不产生字符，它做三件事：
//     644  声明「这块不该被选中」
//     655  设裁剪矩形（overflow）
//     688  如果是滚动容器，算 scrollTop 并走特殊渲染路径
//
//   最后 1206 行才是画边框 —— **在子节点之后**。理由是子节点收缩时
//   会清掉自己原来的区域，那块可能正好是父节点边框现在的位置。
    } else if (node.nodeName === 'ink-box') {
      const boxBackgroundColor =
        node.style.backgroundColor ?? inheritedBackgroundColor

      // Mark this box's region as non-selectable (fullscreen text
      // selection). noSelect ops are applied AFTER blits/writes in
      // output.get(), so this wins regardless of what's rendered into
      // the region — including blits from prevScreen when the box is
      // clean (the op is emitted on both the dirty-render path here
      // AND on the blit fast-path at line ~235 since blitRegion copies
      // the noSelect bitmap alongside cells).
      //
      // 'from-left-edge' extends the exclusion from col 0 so any
      // upstream indentation (tool prefix, tree lines) is covered too
      // — a multi-row drag over a diff gutter shouldn't pick up the
      // `  ⎿  ` prefix on row 0 or the blank cells under it on row 1+.
// 【noSelect 的两种范围】
//
//   true            从盒子左边界开始排除
//   'from-left-edge' 从第 0 列开始排除
//
//   后者是为多行内容准备的：一个 diff 补丁的第一行有 `  ⎿  ` 这样的
//   工具前缀，第二行起是纯空白，但用户拖选时希望两行行为一致
//   （要么都选中代码，要么都不选）。所以把整行从第 0 列排除。
//
//   633 行那句注释解释了为什么这里能「赢」：noSelect 操作在
//   output.get() 里是**最后应用**的，晚于所有 blit 和 write。
//   所以哪怕这块内容是从上一帧 blit 来的，标记也还是本帧说了算。
      if (node.style.noSelect) {
        const boxX = Math.floor(x)
        const fromEdge = node.style.noSelect === 'from-left-edge'
        output.noSelect({
          x: fromEdge ? 0 : boxX,
          y: Math.floor(y),
          width: fromEdge ? boxX + Math.floor(width) : Math.floor(width),
          height: Math.floor(height),
        })
      }

// 【overflow 的两轴独立】
//
//   overflowX / overflowY 各自可以覆盖 overflow 这个总设。
//   React Native 风格的三层配置（总设 + 两轴覆盖）在这里落成两个布尔量。
//
//   裁剪矩形取的是**内容区**（去掉边框），不是边框盒 ——
//   所以 666 行要减 getComputedBorder(Left)。
//   不减的后果：内容会盖在边框内侧，看起来边框被吃掉一半。
      const overflowX = node.style.overflowX ?? node.style.overflow
      const overflowY = node.style.overflowY ?? node.style.overflow
      const clipHorizontally = overflowX === 'hidden' || overflowX === 'scroll'
      const clipVertically = overflowY === 'hidden' || overflowY === 'scroll'
      const isScrollY = overflowY === 'scroll'

      const needsClip = clipHorizontally || clipVertically
      let y1: number | undefined
      let y2: number | undefined
      if (needsClip) {
        const x1 = clipHorizontally
          ? x + yogaNode.getComputedBorder(LayoutEdge.Left)
          : undefined

        const x2 = clipHorizontally
          ? x +
            yogaNode.getComputedWidth() -
            yogaNode.getComputedBorder(LayoutEdge.Right)
          : undefined

        y1 = clipVertically
          ? y + yogaNode.getComputedBorder(LayoutEdge.Top)
          : undefined

        y2 = clipVertically
          ? y +
            yogaNode.getComputedHeight() -
            yogaNode.getComputedBorder(LayoutEdge.Bottom)
          : undefined

        output.clip({ x1, x2, y1, y2 })
      }

// ═══════════════════════════════════════════════════════════════
//  ScrollBox：本文件最复杂的一段（688-1154，约 470 行）
// ═══════════════════════════════════════════════════════════════
//
//   它要同时做四件事，而且互相牵制：
//
//   ① 算出这一帧的 scrollTop（跟底、clamp、排空 pendingDelta）
//   ② 用硬件滚动把上一帧的内容移过去（DECSTBM 快路径）
//   ③ 只重画「新进视口的那几行」
//   ④ 修复硬件滚动带出来的三种残影（脏子节点、中间增长的位移、
//      绝对定位浮层）
//
//   为什么要这么复杂？因为聊天记录可能是一屏几千行的语法高亮文本。
//   每帧全量重画的代价是 O(可见行 × 每行字符数)，滚动时直接掉帧。
//   而实际上滚一行只改了「顶部进一行、底部出一行」。
//
//   这个文件里所有 `// ⚠` 标记的段落，几乎都在解释「某个优化在什么
//   条件下不成立」。读这段的正确姿势不是「它做了什么」，
//   而是「它凭什么敢跳过」。
      if (isScrollY) {
        // Scroll containers follow the ScrollBox component structure:
        // a single content-wrapper child with flexShrink:0 (doesn't shrink
        // to fit), whose children are the scrollable items. scrollHeight
        // comes from the wrapper's intrinsic Yoga height. The wrapper is
        // rendered with its Y translated by -scrollTop; its children are
        // culled against the visible window.
// innerHeight 是**内容区**高度：视口高度减上下边框、减上下内边距。
// 699 行那个 max(0, ...) 是防御：极小的终端里减法可能出负数，
// 而负数会传进 Math.min/max 链，把后面所有计算带偏。
        const padTop = yogaNode.getComputedPadding(LayoutEdge.Top)
        const innerHeight = Math.max(
          0,
          (y2 ?? y + height) -
            (y1 ?? y) -
            padTop -
            yogaNode.getComputedPadding(LayoutEdge.Bottom),
        )

        const content = node.childNodes.find(c => (c as DOMElement).yogaNode) as
          | DOMElement
          | undefined
        const contentYoga = content?.yogaNode
// 【scrollHeight 不加 getComputedTop()】
//
//   容易写错的一处。content 是滚动容器里那个「不收缩」的包装子节点，
//   它的 getComputedTop() 是**它在视口内的偏移**（等于容器的 paddingTop）。
//
//   而 innerHeight 已经减掉了 padding。再加一次 top 就是双算内边距，
//   maxScroll 会凭空多出 padding 那么多 —— 表现是「能往下滚一点点，
//   但滚到底之后下面有一块空白」。
        // scrollHeight is the intrinsic height of the content wrapper.
        // Do NOT add getComputedTop() — that's the wrapper's offset
        // within the viewport (equal to the scroll container's
        // paddingTop), and innerHeight already subtracts padding, so
        // including it double-counts padding and inflates maxScroll.
        const scrollHeight = contentYoga?.getComputedHeight() ?? 0
// 【先存旧值，再覆盖】
//
//   跟底判断要比「这一帧的 max」和「上一帧的 max」（759 行用 prevMaxScroll）。
//   如果先覆盖再判断，比的就是自己和自己，跟底判断永远成立 ——
//   用户往上翻会被一直拽回底部。
//
//   这是「先快照再更新」的经典时序。
        // Capture previous scroll bounds BEFORE overwriting — the at-bottom
        // follow check compares against last frame's max.
        const prevScrollHeight = node.scrollHeight ?? scrollHeight
        const prevInnerHeight = node.scrollViewportHeight ?? innerHeight
        node.scrollHeight = scrollHeight
        node.scrollViewportHeight = innerHeight
        // Absolute screen-buffer row where the scrollable area (inside
        // padding) begins. Exposed via ScrollBoxHandle.getViewportTop() so
        // drag-to-scroll can detect when the drag leaves the scroll viewport.
        node.scrollViewportTop = (y1 ?? y) + padTop

// maxScroll 是**可滚动范围的大小**（内容高度 - 视口高度），
// 不是「最大 scrollTop 之前的某个值」。两者相等，但语义不同：
// 这里把它当「范围」用，所以必须 clamp 到 0 以上。
        const maxScroll = Math.max(0, scrollHeight - innerHeight)
        // scrollAnchor: scroll so the anchored element's top is at the
        // viewport top (plus offset). Yoga is FRESH — same calculateLayout
        // pass that just produced scrollHeight. Deterministic alternative
        // to scrollTo(N) which bakes a number that's stale by the throttled
        // render; the element ref defers the read to now. One-shot snap.
        // A prior eased-seek version (proportional drain over ~5 frames)
        // moved scrollTop without firing React's notify → parent's quantized
        // store snapshot never updated → StickyTracker got stale range props
        // → firstVisible wrong. Also: SCROLL_MIN_PER_FRAME=4 with snap-at-1
        // ping-ponged forever at delta=2. Smooth needs drain-end notify
        // plumbing; shipping instant first. stickyScroll overrides.
// 【scrollAnchor：为什么放弃了缓动】
//
//   锚点滚动的语义是「让某个元素贴到视口顶部」。实现上直接算
//   scrollTop = anchorTop + offset，一次跳到位。
//
//   727-736 行那段注释是一次完整的方案否决记录：
//   先做过缓动版本（按比例在约 5 帧内滚过去），结果发现缓动过程中
//   scrollTop 变了但 React 没有收到通知 —— 父组件的 store 快照是量子化的，
//   拿到的还是旧范围，于是 StickyTracker 的 firstVisible 算错。
//
//   还有一个更细的死循环：最小值 4 行 + 距目标 1 行时自动 snap，
//   会在 delta=2 附近来回振荡，永远停不下来。
//
//   结论是「平滑需要 drain 结束时补一条通知，这套管道当时没有，所以先发瞬时版」。
//   这是「知道正确做法，但因为缺一块基础设施而选择简单版本」的典型记录。
//   373 行的 scrollAnchor 读取时机也值得一提：注释说 yoga 是**刚刚算完的**，
//   同一次 calculateLayout 产出的值，所以读它是确定的 ——
//   而 scrollTo(N) 里的 N 在那个时刻已经过时了（上一次渲染时的数值）。
        if (node.scrollAnchor) {
          const anchorTop = node.scrollAnchor.el.yogaNode?.getComputedTop()
          if (anchorTop != null) {
            node.scrollTop = anchorTop + node.scrollAnchor.offset
            node.pendingScrollDelta = undefined
          }
          node.scrollAnchor = undefined
        }
// 【跟底的判据：位置而不是标志位】
//
//   直觉做法是维护一个 "isAtBottom" 布尔量，滚动时更新它。
//   但那个量在用户拖选、滚轮微动、内容重排时都会失真。
//
//   这里的做法是**每次重新判断位置**：scrollTop 是不是还停在
//   （或超过）上一帧的 max。停着 → 跟；不在 → 不跟。
//   往回滚到低部 → 自动恢复跟。这个模型没有状态需要维护，
//   所以不会出现「标志位和实际位置不一致」。
//
//   764 行那个 grew 条件是必需的补丁：虚拟滚动会让 scrollHeight
//   短暂**变小**（列表尾部卸载 + 陈旧的 heightCache 占位），
//   此时 scrollTop >= prevMaxScroll 会因假象成立 ——
//   用户明明没在底部，却被判定「在底部」。
        // At-bottom follow. Positional: if scrollTop was at (or past) the
        // previous max, pin to the new max. Scroll away → stop following;
        // scroll back (or scrollToBottom/sticky attr) → resume. The sticky
        // flag is OR'd in for cold start (scrollTop=0 before first layout)
        // and scrollToBottom-from-far-away (flag set before scrollTop moves)
        // — the imperative field takes precedence over the attribute so
        // scrollTo/scrollBy can break stickiness. pendingDelta<0 guard:
        // don't cancel an in-flight scroll-up when content races in.
        // Capture scrollTop before follow so ink.tsx can translate any
        // active text selection by the same delta (native terminal behavior:
        // view keeps scrolling, highlight walks up with the text).
        const scrollTopBeforeFollow = node.scrollTop ?? 0
        const sticky =
          node.stickyScroll ?? Boolean(node.attributes['stickyScroll'])
        const prevMaxScroll = Math.max(0, prevScrollHeight - prevInnerHeight)
        // Positional check only valid when content grew — virtualization can
        // transiently SHRINK scrollHeight (tail unmount + stale heightCache
        // spacer) making scrollTop >= prevMaxScroll true by artifact, not
        // because the user was at bottom.
        const grew = scrollHeight >= prevScrollHeight
        const atBottom =
          sticky || (grew && scrollTopBeforeFollow >= prevMaxScroll)
        if (atBottom && (node.pendingScrollDelta ?? 0) >= 0) {
          node.scrollTop = maxScroll
          node.pendingScrollDelta = undefined
          // Sync flag so useVirtualScroll's isSticky() agrees with positional
          // state — sticky-broken-but-at-bottom (wheel tremor, click-select
          // at max) otherwise leaves useVirtualScroll's clamp holding the
          // viewport short of new streaming content. scrollTo/scrollBy set
          // false; this restores true, same as scrollToBottom() would.
          // Only restore when (a) positionally at bottom and (b) the flag
          // was explicitly broken (===false) by scrollTo/scrollBy. When
          // undefined (never set by user action) leave it alone — setting it
          // would make the sticky flag sticky-by-default and lock out
          // direct scrollTop writes (e.g. the alt-screen-perf test).
// 【stickyScroll 是三态：undefined / true / false】
//
//   undefined  用户从没手动滚过 → 不碰它
//   true       跟底
//   false      用户主动上下滚 → 明确不跟
//
//   这段的用途：位置判定为「在底部」且标志位被显式设成 false 时，
//   把它恢复成 true。否则会出现「视图在底部，但 useVirtualScroll
//   以为不跟」的分裂状态 —— 后果是新内容来了不追加，视口停在半空。
//
//   注释里那条「undefined 时不要动」很关键：设成 true 就等于
//   「默认跟底」，那直接改 scrollTop 的用法（测试里就有）会被锁出去。
//   三态在这里承载的是「有没有用户意图」，不是「是不是跟底」。
          if (
            node.stickyScroll === false &&
            scrollTopBeforeFollow >= prevMaxScroll
          ) {
            node.stickyScroll = true
          }
        }
        const followDelta = (node.scrollTop ?? 0) - scrollTopBeforeFollow
        if (followDelta > 0) {
          const vpTop = node.scrollViewportTop ?? 0
          followScroll = {
            delta: followDelta,
            viewportTop: vpTop,
            viewportBottom: vpTop + innerHeight - 1,
          }
        }
// 【排空的分派点】
//
//   isXtermJsHost() 每次调用都查一次 —— 看起来该缓存，但：
//   它内部走的是同步的 TERM_PROGRAM 检查 + 已就绪的探测结果，
//   开销是两次字符串比较。而这是每帧一次（不是每格一次），
//   缓存的收益不值得多一个失效问题。
//
//   803-807 是有 clamp 时的节流：已经滚到 clamp 之外还继续排空，
//   会让 scrollTop 冲到挂载范围前面 5000 行，而 React 的 slide
//   要 200 次 commit 才能追上 —— 表现是「到边缘后长时间卡住」。
//   所以超出时把每帧上限压到约 4 行，跟 React 的推进速度匹配。
        // Drain pendingScrollDelta. Native terminals (proportional burst
        // events) use proportional drain; xterm.js (VS Code, sparse events +
        // app-side accel curve) uses adaptive small-step drain. isXtermJs()
        // depends on the async XTVERSION probe, but by the time this runs
        // (pendingScrollDelta is only set by wheel events, >>50ms after
        // startup) the probe has resolved — same timing guarantee the
        // wheel-accel curve relies on.
        let cur = node.scrollTop ?? 0
        const pending = node.pendingScrollDelta
        const cMin = node.scrollClampMin
        const cMax = node.scrollClampMax
        const haveClamp = cMin !== undefined && cMax !== undefined
        if (pending !== undefined && pending !== 0) {
          // Drain continues even past the clamp — the render-clamp below
          // holds the VISUAL at the mounted edge regardless. Hard-stopping
          // here caused stop-start jutter: drain hits edge → pause → React
          // commits → clamp widens → drain resumes → edge again. Letting
          // scrollTop advance smoothly while the clamp lags gives continuous
          // visual scroll at React's commit rate (the clamp catches up each
          // commit). But THROTTLE the drain when already past the clamp so
          // scrollTop doesn't race 5000 rows ahead of the mounted range
          // (slide-cap would then take 200 commits to catch up = long
          // perceived stall at the edge). Past-clamp drain caps at ~4 rows/
          // frame, roughly matching React's slide rate so the gap stays
          // bounded and catch-up is quick once input stops.
          const pastClamp =
            haveClamp &&
            ((pending < 0 && cur < cMin) || (pending > 0 && cur > cMax))
          const eff = pastClamp ? Math.min(4, innerHeight >> 3) : innerHeight
          cur += isXtermJsHost()
            ? drainAdaptive(node, pending, eff)
            : drainProportional(node, pending, eff)
        } else if (pending === 0) {
          // Opposite scrollBy calls cancelled to zero — clear so we don't
          // schedule an infinite loop of no-op drain frames.
          node.pendingScrollDelta = undefined
        }
// 【clamp 只影响这一帧的绘制，不写回 scrollTop】
//
//   虚拟滚动下，scrollTop 可能跑到「已挂载的子节点范围」之外
//   （比如连按 PageUp，React 还没来得及重新挂载）。
//   此时如果按 scrollTop 画，画出来是一片空白。
//
//   所以绘制用的值 clamp 到已挂载范围，但**真正的 scrollTop 保持原样** ——
//   React 下一次 commit 看到目标值，就会把正确的范围挂上来。
//
//   845 行写回的是未 clamp 的值，850 行才把 clamped 交给渲染。
//   这两步的顺序不能换，否则 React 永远不知道该挂哪一段。
        let scrollTop = Math.max(0, Math.min(cur, maxScroll))
        // Virtual-scroll clamp: if scrollTop raced past the currently-mounted
        // range (burst PageUp before React re-renders), render at the EDGE of
        // the mounted children instead of blank spacer. Do NOT write back to
        // node.scrollTop — the clamped value is for this paint only; the real
        // scrollTop stays so React's next commit sees the target and mounts
        // the right range. Not scheduling scrollDrainNode here keeps the
        // clamp passive — React's commit → resetAfterCommit → onRender will
        // paint again with fresh bounds.
        const clamped = haveClamp
          ? Math.max(cMin, Math.min(scrollTop, cMax))
          : scrollTop
        node.scrollTop = scrollTop
        // Clamp hitting top/bottom consumes any remainder. Set drainPending
        // only after clamp so a wasted no-op frame isn't scheduled.
        if (scrollTop !== cur) node.pendingScrollDelta = undefined
        if (node.pendingScrollDelta !== undefined) scrollDrainNode = node
        scrollTop = clamped

        if (content && contentYoga) {
          // Compute content wrapper's absolute render position with scroll
          // offset applied, then render its children with culling.
          const contentX = x + contentYoga.getComputedLeft()
          const contentY = y + contentYoga.getComputedTop() - scrollTop
// 【layoutShifted 的检测有个缺口，这里补上】
//
//   正常情况下「位置变了 → positionChanged → layoutShifted」。
//   但整屏滚动（连按 PageUp、快速滚轮）时：
//     旧的可见子节点全被裁掉（cache 被删）
//     新的可见子节点全没有 cache
//   于是 487 行那个判断对每个子节点都不成立 —— 没人发现「整屏都挪了」。
//
//   能活下来见证这次滚动的，只有内容包装节点自己：
//   它的 cached.y 里编着 -scrollTop。所以拿它当哨兵。
          // layoutShifted detection gap: when scrollTop moves by >= viewport
          // height (batched PageUps, fast wheel), every visible child gets
          // culled (cache dropped) and every newly-visible child has no
          // cache — so the children's positionChanged check can't fire.
          // The content wrapper's cached y (which encodes -scrollTop) is
          // the only node that survives to witness the scroll.
          const contentCached = nodeCache.get(content)
          let hint: ScrollHint | null = null
// 【DECSTBM 便条的捕获条件，四条】
//
//   cached?.y === y          容器本身没动（动了就不只是滚动）
//   cached.height === height 容器高度没变
//   innerHeight > 0          视口有高度
//   abs(delta) < innerHeight 位移小于一屏
//
//   最后一条最重要：位移 >= 一屏时，滚动区域里的内容**全部换掉**，
//   硬件滚动等于全清再重画，省不下字节，反而多两段转义序列。
//
//   不满足时置 layoutShifted（882 行）—— 退回全量重画。
//   这是「优化不成立就明确放弃」的写法，不是「尽量优化」。
          if (contentCached && contentCached.y !== contentY) {
            // delta = newScrollTop - oldScrollTop (positive = scrolled down).
            // Capture a DECSTBM hint if the container itself didn't move
            // and the shift fits within the viewport — otherwise the full
            // rewrite is needed anyway, and layoutShifted stays the fallback.
            const delta = contentCached.y - contentY
            const regionTop = Math.floor(y + contentYoga.getComputedTop())
            const regionBottom = regionTop + innerHeight - 1
            if (
              cached?.y === y &&
              cached.height === height &&
              innerHeight > 0 &&
              Math.abs(delta) < innerHeight
            ) {
              hint = { top: regionTop, bottom: regionBottom, delta }
              scrollHint = hint
            } else {
              layoutShifted = true
            }
          }
          // Fast path: scroll (hint captured) with usable prevScreen.
          // Blit prevScreen's scroll region into next.screen, shift in-place
          // by delta (mirrors DECSTBM), then render ONLY the edge rows. The
          // nested clip keeps child writes out of stable rows — a tall child
          // that spans edge+stable still renders but stable cells are
          // clipped, preserving the blit. Avoids re-rendering every visible
          // child (expensive for long syntax-highlighted transcripts).
          //
          // When content.dirty (e.g. streaming text at the bottom of the
          // scroll), we still use the fast path — the dirty child is almost
          // always in the edge rows (the bottom, where new content appears).
          // After edge rendering, any dirty children in stable rows are
          // re-rendered in a second pass to avoid showing stale blitted
          // content.
          //
          // Guard: the fast path only handles pure scroll or bottom-append.
          // Child removal/insertion changes the content height in a way that
          // doesn't match the scroll delta — fall back to the full path so
          // removed children don't leave stale cells and shifted siblings
          // render at their new positions.
          const scrollHeight = contentYoga.getComputedHeight()
          const prevHeight = contentCached?.height ?? scrollHeight
          const heightDelta = scrollHeight - prevHeight
// 【fast path 的安全条件：高度变化必须与滚动量自洽】
//
//   硬件滚动假设「内容整体位移了 delta」。如果同时还有子节点被删除/插入，
//   内容高度变化就和位移对不上 —— 位移过去的位置是错的。
//
//   三种可接受的情况（按 910-911 行）：
//     heightDelta === 0                          纯滚动，没有增删
//     delta > 0 && heightDelta === delta         在底部追加（最常见）
//   其余一律退回全量。
//
//   916 行那句「Clear it」是配套的：hint 已经设进模块级变量了，
//   这里判定不安全就必须清掉，否则 log-update 会按一张错的便条去滚终端 ——
//   症状是「滚动时上一屏的内容从下面渗出来」。
          const safeForFastPath =
            !hint ||
            heightDelta === 0 ||
            (hint.delta > 0 && heightDelta === hint.delta)
          // scrollHint is set above when hint is captured. If safeForFastPath
          // is false the full path renders a next.screen that doesn't match
          // the DECSTBM shift — emitting DECSTBM leaves stale rows (seen as
          // content bleeding through during scroll-up + streaming). Clear it.
          if (!safeForFastPath) scrollHint = null
// 【快路径的三步】
//
//   ① blit 上一帧的滚动区域到本帧（整块拷贝，不做任何判断）
//   ② shift 原地位移（模拟硬件滚动做了什么）
//   ③ 只渲染「新进视口的那几行」
//
//   做完这三步，本帧的屏幕缓冲就和「真的滚过之后应该长什么样」一致了，
//   而代价只有一次 blit + 一屏边缘的几行。
//
//   嵌套 clip 的理由（931 行）：一个跨边缘和稳定区的高子节点，
//   渲染时会整块写下去。clip 把稳定区的写入挡掉，
//   保住 ① 拷进来的正确内容 —— 这是「先整体铺底，再局部覆盖」的写法。
          if (hint && prevScreen && safeForFastPath) {
            const { top, bottom, delta } = hint
            const w = Math.floor(width)
            output.blit(prevScreen, Math.floor(x), top, w, bottom - top + 1)
            output.shift(top, bottom, delta)
            // Edge rows: new content entering the viewport.
            const edgeTop = delta > 0 ? bottom - delta + 1 : top
            const edgeBottom = delta > 0 ? bottom : top - delta - 1
            output.clear({
              x: Math.floor(x),
              y: edgeTop,
              width: w,
              height: edgeBottom - edgeTop + 1,
            })
            output.clip({
              x1: undefined,
              x2: undefined,
              y1: edgeTop,
              y2: edgeBottom + 1,
            })
            // Snapshot dirty children before the first pass — the first
            // pass clears dirty flags, and edge-spanning children would be
            // missed by the second pass without this snapshot.
// 【为什么要在第一遍之前快照脏子节点】
//
//   第一遍渲染会把 dirty 标志清掉（1225 行）。如果一个子节点横跨边缘行
//   和稳定行，它在第一遍里被渲染过（因为边缘部分要画），
//   dirty 被清；到第二遍时按「脏」去找就找不到它了。
//
//   所以先把脏集合抓下来。这是「标志位是消耗品」的典型后果 ——
//   任何需要「事后还知道谁脏过」的逻辑，都得自己留快照。
            const dirtyChildren = content.dirty
              ? new Set(content.childNodes.filter(c => (c as DOMElement).dirty))
              : null
            renderScrolledChildren(
              content,
              output,
              contentX,
              contentY,
              hasRemovedChild,
              undefined,
              // Cull to edge in child-local coords (inverse of contentY offset).
              edgeTop - contentY,
              edgeBottom + 1 - contentY,
              boxBackgroundColor,
              true,
            )
            output.unclip()

            // Second pass: re-render children in stable rows whose screen
            // position doesn't match where the shift put their old pixels.
            // Covers TWO cases:
            //   1. Dirty children — their content changed, blitted pixels are
            //      stale regardless of position.
            //   2. Clean children BELOW a middle-growth point — when a dirty
            //      sibling above them grows, their yogaTop increases but
            //      scrollTop increases by the same amount (sticky), so their
            //      screenY is CONSTANT. The shift moved their old pixels to
            //      screenY-delta (wrong); they should stay at screenY. Without
            //      this, the spinner/tmux-monitor ghost at shifted positions
            //      during streaming (e.g. triple spinner, pill duplication).
            //   For bottom-append (the common case), all clean children are
            //   ABOVE the growth point; their screenY decreased by delta and
            //   the shift put them at the right place — skipped here, fast
            //   path preserved.
// 【第二遍要修两类，注释里第 2 类是最容易漏的】
//
//   ① 脏子节点：内容变了，不管位置对不对，blit 过来的像素都是旧的
//
//   ② 干净子节点，但位于「中间增长点」之下：
//      上面某个脏兄弟长高了 → 它的 yogaTop 增大，
//      同时 scrollTop 也增大同样的量（因为跟底）→ 屏幕 y 不变。
//      但硬件滚动把它的旧像素挪到了 y-delta —— 位置错了。
//      它没变脏，所以第一遍不会重画它，看起来就是「残影」。
//
//   注释里给的症状描述很好认：spinner 变三个、pill 复制一份。
//
//   而对于最常见的底部追加，干净子节点都在增长点**之上**，
//   位移过去的位置正好正确 —— 所以第二遍会跳过它们（1025 行的
//   「cached.y - delta === screenY」判断），保住快路径的性能。
            if (dirtyChildren) {
              const edgeTopLocal = edgeTop - contentY
              const edgeBottomLocal = edgeBottom + 1 - contentY
              const spaces = ' '.repeat(w)
              // Track cumulative height change of children iterated so far.
              // A clean child's yogaTop is unchanged iff this is zero (no
              // sibling above it grew/shrank/mounted). When zero, the skip
              // check cached.y−delta === screenY reduces to delta === delta
              // (tautology) → skip without yoga reads. Restores O(dirty)
              // that #24536 traded away: for bottom-append the dirty child
              // is last (all clean children skip); for virtual-scroll range
              // shift the topSpacer shrink + new-item heights self-balance
              // to zero before reaching the clean block. Middle-growth
              // leaves shift non-zero → clean children after the growth
              // point fall through to yoga + the fine-grained check below,
              // preserving the ghost-box fix.
// 【cumHeightShift：把 O(挂载数) 找回到 O(脏数)】
//
//   第二遍要判断每个干净子节点的 yogaTop 变了没有。直接读 yoga 是
//   O(挂载数) 次 WASM 调用，一屏几百个子节点就是几百次 —— 快路径就白快了。
//
//   观察：一个干净子节点的 yogaTop 变没变，只取决于**它上面有没有兄弟
//   长高或变矮**。所以累加已经走过的脏子节点的高度变化：
//   累计为 0 时，后面所有干净子节点的位置都没变，可以直接跳过。
//
//   底部追加时脏子节点是最后一个 → 前面全部跳过 → 一遍 O(1)。
//   中间增长时累计不为 0 → 后面的子节点老实读 yoga（989 行注释）。
//
//   这是「用一个可增量维护的标量替代逐项查询」的经典优化。
//   代价是必须保证累加的准确性 —— 1007 行只对 isDirty 累加，
//   因为干净子节点的高度不可能变（变了就会脏）。
              let cumHeightShift = 0
              for (const childNode of content.childNodes) {
                const childElem = childNode as DOMElement
                const isDirty = dirtyChildren.has(childNode)
                if (!isDirty && cumHeightShift === 0) {
                  if (nodeCache.has(childElem)) continue
                  // Uncached = culled last frame, now re-entering. blit
                  // never painted it → fall through to yoga + render.
                  // Height unchanged (clean), so cumHeightShift stays 0.
                }
                const cy = childElem.yogaNode
                if (!cy) continue
                const childTop = cy.getComputedTop()
                const childH = cy.getComputedHeight()
                const childBottom = childTop + childH
                if (isDirty) {
                  const prev = nodeCache.get(childElem)
                  cumHeightShift += childH - (prev ? prev.height : 0)
                }
                // Skip culled children (outside viewport)
                if (
                  childBottom <= scrollTop ||
                  childTop >= scrollTop + innerHeight
                )
                  continue
                // Skip children entirely within edge rows (already rendered)
                if (childTop >= edgeTopLocal && childBottom <= edgeBottomLocal)
                  continue
                const screenY = Math.floor(contentY + childTop)
                // Clean children reaching here have cumHeightShift ≠ 0 OR
                // no cache. Re-check precisely: cached.y − delta is where
                // the shift left old pixels; if it equals new screenY the
                // blit is correct (shift re-balanced at this child, or
                // yogaTop happens to net out). No cache → blit never
                // painted it → render.
                if (!isDirty) {
                  const childCached = nodeCache.get(childElem)
                  if (
                    childCached &&
                    Math.floor(childCached.y) - delta === screenY
                  ) {
                    continue
                  }
                }
// 【为什么用空格覆盖而不是 output.clear】
//
//   这一块的内容是**从上一帧 blit 过来的旧像素**。clear 的语义是
//   「标记这块脏，让别人别信这里的缓存」—— 它不会把格子清空
//   （1035 行注释：只能扩 damage，不能把 blit 已经写进去的格子归零）。
//
//   所以要真的写一屏空格下去，把旧像素盖掉。
                // Wipe this child's region with spaces to overwrite stale
                // blitted content — output.clear() only expands damage and
                // cannot zero cells that the blit already wrote.
                const screenBottom = Math.min(
                  Math.floor(contentY + childBottom),
                  Math.floor((y1 ?? y) + padTop + innerHeight),
                )
                if (screenY < screenBottom) {
                  const fill = Array(screenBottom - screenY)
                    .fill(spaces)
                    .join('\n')
                  output.write(Math.floor(x), screenY, fill)
                  output.clip({
                    x1: undefined,
                    x2: undefined,
                    y1: screenY,
                    y2: screenBottom,
                  })
                  renderNodeToOutput(childElem, output, {
                    offsetX: contentX,
                    offsetY: contentY,
                    prevScreen: undefined,
                    inheritedBackgroundColor: boxBackgroundColor,
                  })
                  output.unclip()
                }
              }
            }

// 【第三遍：浮层被硬件滚动带走了】
//
//   浮层的渲染顺序在滚动容器**之后**，所以上一帧的缓冲区里，
//   滚动区域那几行里已经混进了浮层的像素。blit + shift 把这些像素
//   挪到了 rect.y - delta —— 既不是浮层的真实位置，也没人负责清掉。
//
//   第一遍只画边缘行，第二遍只画子树，都盖不到这块。所以第三遍
//   专门擦「浮层残影落下的那几行」，然后重画那部分滚动内容。
//
//   1070 行那个空字符串 `''` 是个细节：没有浮层时连空格串都不构造，
//   循环体也进不去。有浮层才 `' '.repeat(w)`。
            // Third pass: repair rows where shifted copies of absolute
            // overlays landed. The blit copied prevScreen cells INCLUDING
            // overlay pixels (overlays render AFTER this ScrollBox so they
            // painted into prevScreen's scroll region). After shift, those
            // pixels sit at (rect.y - delta) — neither edge render nor the
            // overlay's own re-render covers them. Wipe and re-render
            // ScrollBox content so the diff writes correct cells.
            const spaces = absoluteRectsPrev.length ? ' '.repeat(w) : ''
            for (const r of absoluteRectsPrev) {
              if (r.y >= bottom + 1 || r.y + r.height <= top) continue
              const shiftedTop = Math.max(top, Math.floor(r.y) - delta)
              const shiftedBottom = Math.min(
                bottom + 1,
                Math.floor(r.y + r.height) - delta,
              )
              // Skip if entirely within edge rows (already rendered).
              if (shiftedTop >= edgeTop && shiftedBottom <= edgeBottom + 1)
                continue
              if (shiftedTop >= shiftedBottom) continue
              const fill = Array(shiftedBottom - shiftedTop)
                .fill(spaces)
                .join('\n')
              output.write(Math.floor(x), shiftedTop, fill)
              output.clip({
                x1: undefined,
                x2: undefined,
                y1: shiftedTop,
                y2: shiftedBottom,
              })
              renderScrolledChildren(
                content,
                output,
                contentX,
                contentY,
                hasRemovedChild,
                undefined,
                shiftedTop - contentY,
                shiftedBottom - contentY,
                boxBackgroundColor,
                true,
              )
              output.unclip()
            }
// 【全量路径的两种子情况，区别只在「要不要先清视口」】
//
//   滚了但没有可用的便条（大幅跳转、容器本身动了）：
//     上一帧的坐标全都过时 → 清视口 + 禁止 blit
//
//   没滚（spinner tick、内容编辑）：
//     上一帧的坐标依然有效 → 不清视口，传 prevScreen 让干净子节点 blit
//
//   1116-1119 行那句是第二种情况的理由：如果不这么做，
//   ScrollBox 里任何一个 spinner 都会让整个内容每帧全量重写。
//   在宽终端 + tmux（没有 BSU/ESU 同步输出）下，字节量会跨过
//   chunk 边界，画面撕裂。
          } else {
            // Full path. Two sub-cases:
            //
            // Scrolled without a usable hint (big jump, container moved):
            // child positions in prevScreen are stale. Clear the viewport
            // and disable blit so children don't restore shifted content.
            //
            // No scroll (spinner tick, content edit): child positions in
            // prevScreen are still valid. Skip the viewport clear and pass
            // prevScreen so unchanged children blit. Dirty children already
            // self-clear via their own cached-rect clear. Without this, a
            // spinner inside ScrollBox forces a full-content rewrite every
            // frame — on wide terminals over tmux (no BSU/ESU) the
            // bandwidth crosses the chunk boundary and the frame tears.
            const scrolled = contentCached && contentCached.y !== contentY
            if (scrolled && y1 !== undefined && y2 !== undefined) {
              output.clear({
                x: Math.floor(x),
                y: Math.floor(y1),
                width: Math.floor(width),
                height: Math.floor(y2 - y1),
              })
            }
            // positionChanged (ScrollBox height shrunk — pill mount) means a
            // child spanning the old bottom edge would blit its full cached
            // rect past the new clip. output.ts clips blits now, but also
            // disable prevScreen here so the partial-row child re-renders at
            // correct bounds instead of blitting a clipped (truncated) old
            // rect.
            renderScrolledChildren(
              content,
              output,
              contentX,
              contentY,
              hasRemovedChild,
              scrolled || positionChanged ? undefined : prevScreen,
              scrollTop,
              scrollTop + innerHeight,
              boxBackgroundColor,
            )
          }
          nodeCache.set(content, {
            x: contentX,
            y: contentY,
            width: contentYoga.getComputedWidth(),
            height: contentYoga.getComputedHeight(),
          })
          content.dirty = false
        }
// ── 普通盒子（不是滚动容器）──────────────────────────────────
//
//   两件事：先按背景色铺一层底，再渲染子节点。
//   顺序不能反 —— 子节点的文字要压在底色上，
//   而底色是整块铺的（包括 padding 和空白区域）。
      } else {
        // Fill interior with background color before rendering children.
        // This covers padding areas and empty space; child text inherits
        // the color via inheritedBackgroundColor so written cells also
        // get the background.
        // Disable prevScreen for children: the fill overwrites the entire
        // interior each render, so child blits from prevScreen would restore
        // stale cells (wrong bg if it changed) on top of the fresh fill.
// 【背景填充只在两种时候发生：有背景色，或者标了 opaque】
//
//   opaque 单独出现（没有背景色）时的用途：盖住下面一层。
//   一个绝对定位的浮层如果只覆盖部分区域，它下面的旧内容会透出来；
//   标 opaque 就是声明「我这一块是完全不透明的，放心把下面擦掉」。
//
//   注意 fill 用的是**带样式的空格**（1173 行）：applyTextStyles 把空格
//   套上背景色。用裸空格填的话，格子是写过了但没有背景，
//   终端上依然是透明的。
        const ownBackgroundColor = node.style.backgroundColor
        if (ownBackgroundColor || node.style.opaque) {
          const borderLeft = yogaNode.getComputedBorder(LayoutEdge.Left)
          const borderRight = yogaNode.getComputedBorder(LayoutEdge.Right)
          const borderTop = yogaNode.getComputedBorder(LayoutEdge.Top)
          const borderBottom = yogaNode.getComputedBorder(LayoutEdge.Bottom)
          const innerWidth = Math.floor(width) - borderLeft - borderRight
          const innerHeight = Math.floor(height) - borderTop - borderBottom
          if (innerWidth > 0 && innerHeight > 0) {
            const spaces = ' '.repeat(innerWidth)
            const fillLine = ownBackgroundColor
              ? applyTextStyles(spaces, { backgroundColor: ownBackgroundColor })
              : spaces
            const fill = Array(innerHeight).fill(fillLine).join('\n')
            output.write(x + borderLeft, y + borderTop, fill)
          }
        }

// 【有背景色或有 opaque 时，必须禁用子节点的 blit】
//
//   因为上面刚把整个内容区重写了一遍。此时如果某个子节点从 prevScreen
//   blit 回来，等于把**上一帧的旧底色**盖在新底色之上。
//
//   1189 行注释里还有一段撤销记录：以前只在 opaque 时禁用 blit，
//   理由是「纯空格填充 + 子节点没变 = 合成结果一致」。但子节点**会**重排
//   （ScrollBox 重新测量），一重排，blit 过来就是错位内容。
//   触发场景写在括号里：/permissions 页面按下箭头，正文变空白（#25436）。
//
//   这类「假设某件事不会发生」的优化，出问题时症状总是「某个页面在
//   某个操作之后变空」。
        renderChildren(
          node,
          output,
          x,
          y,
          hasRemovedChild,
          // backgroundColor and opaque both disable child blit: the fill
          // overwrites the entire interior each render, so any child whose
          // layout position shifted would blit stale cells from prevScreen
          // on top of the fresh fill. Previously opaque kept blit enabled
          // on the assumption that plain-space fill + unchanged children =
          // valid composite, but children CAN reposition (ScrollBox remeasure
          // on re-render → /permissions body blanked on Down arrow, #25436).
          ownBackgroundColor || node.style.opaque ? undefined : prevScreen,
          boxBackgroundColor,
        )
      }

      if (needsClip) {
        output.unclip()
      }

// 【边框最后画】
//
//   子节点重画时会先清自己的旧区域。如果子节点收缩了，它的旧区域
//   可能正好盖住父节点边框现在的位置 —— 先画边框就会被擦掉。
//
//   反过来的代价：边框永远盖在内容之上。对终端 UI 这是期望行为
//   （边框是容器边界的视觉承诺）。
      // Render border AFTER children to ensure it's not overwritten by child
      // clearing operations. When a child shrinks, it clears its old area,
      // which may overlap with where the parent's border now is.
      renderBorder(x, y, node, output)
    } else if (node.nodeName === 'ink-root') {
      renderChildren(
        node,
        output,
        x,
        y,
        hasRemovedChild,
        prevScreen,
        inheritedBackgroundColor,
      )
    }

    // Cache layout bounds for dirty tracking
    const rect = { x, y, width, height, top: yogaTop }
    nodeCache.set(node, rect)
    if (node.style.position === 'absolute') {
      absoluteRectsCur.push(rect)
    }
    node.dirty = false
  }
}

// ═══════════════════════════════════════════════════════════════
//  污染守卫：什么时候必须放弃 blit
// ═══════════════════════════════════════════════════════════════
//
//   核心问题：一个脏节点重画之后，它的**溢出内容**可能盖到后面的兄弟身上。
//   而后面那些兄弟是干净的，会从 prevScreen blit —— 拷回来的是
//   「被盖之前」的旧像素，于是溢出的部分看不见了。
//
//   所以规则是：**看到一个脏兄弟之后，后面所有兄弟都不许 blit**。
//
//   但这条规则太狠了 —— 一个 ScrollBox 里的 spinner 每 tick 都脏，
//   于是底部提示区每帧都全量重写（1242 行注释：100% writes every frame）。
//
//   于是加两个例外，都是「我确信溢出不可能」的情形：
//     ① 两轴都裁剪的子节点 —— 内容被关在布局盒子里，溢不出去
//     ② 但绝对定位的裁剪子节点不算 —— 它的布局盒子可能和任意兄弟重叠
//
//   还有第三种污染（1247 行，seenDirtyClipped）：一个**后面的绝对兄弟**
//   落在脏裁剪子节点的范围内。裁剪切断的是「溢出」，不是「重叠」。
//   此时那个绝对兄弟 blit 回来会拷到已经被改写过的格子。
//   对非 opaque 的绝对兄弟，做法是强制它下降（skipSelfBlit）但仍传
//   prevScreen —— 它自己的不透明子孙还可以 blit 各自的窄矩形。
//
//   这段 28 行注释本身就是三次 bug 的复盘，密度很高，值得逐句读。
// Overflow contamination: content overflows right/down, so clean siblings
// AFTER a dirty/removed sibling can contain stale overflow in prevScreen.
// Disable blit for siblings after a dirty child — but still pass prevScreen
// TO the dirty child itself so its clean descendants can blit. The dirty
// child's own blit check already fails (node.dirty=true at line 216), so
// passing prevScreen only benefits its subtree.
// For removed children we don't know their original position, so
// conservatively disable blit for all.
//
// Clipped children (overflow hidden/scroll on both axes) cannot overflow
// onto later siblings — their content is confined to their layout bounds.
// Skip the contamination guard for them so later siblings can still blit.
// Without this, a spinner inside a ScrollBox dirties the wrapper on every
// tick and the bottom prompt section never blits → 100% writes every frame.
//
// Exception: absolute-positioned clipped children may have layout bounds
// that overlap arbitrary siblings, so the clipping does not help.
//
// Overlap contamination (seenDirtyClipped): a later ABSOLUTE sibling whose
// rect sits inside a dirty clipped child's bounds would blit stale cells
// from prevScreen — the clipped child just rewrote those cells this frame.
// The clipsBothAxes skip only protects against OVERFLOW (clipped child
// painting outside its bounds), not overlap (absolute sibling painting
// inside them). For non-opaque absolute siblings, skipSelfBlit forces
// descent (the full-width rect has transparent gaps → stale blit) while
// still passing prevScreen so opaque descendants can blit their narrower
// rects (NewMessagesPill's inner Text with backgroundColor). Opaque
// absolute siblings fill their entire rect — direct blit is safe.
function renderChildren(
  node: DOMElement,
  output: Output,
  offsetX: number,
  offsetY: number,
  hasRemovedChild: boolean,
  prevScreen: Screen | undefined,
  inheritedBackgroundColor: Color | undefined,
): void {
  let seenDirtyChild = false
  let seenDirtyClipped = false
  for (const childNode of node.childNodes) {
    const childElem = childNode as DOMElement
    // Capture dirty before rendering — renderNodeToOutput clears the flag
    const wasDirty = childElem.dirty
    const isAbsolute = childElem.style.position === 'absolute'
    renderNodeToOutput(childElem, output, {
      offsetX,
      offsetY,
      prevScreen: hasRemovedChild || seenDirtyChild ? undefined : prevScreen,
      // Short-circuits on seenDirtyClipped (false in the common case) so
      // the opaque/bg reads don't happen per-child per-frame.
      skipSelfBlit:
        seenDirtyClipped &&
        isAbsolute &&
        !childElem.style.opaque &&
        childElem.style.backgroundColor === undefined,
      inheritedBackgroundColor,
    })
// 【两个标志量，区分「毒性会传播」和「毒性只影响重叠」】
//
//   seenDirtyChild    有脏的**非裁剪**兄弟 → 后面全部禁 blit
//   seenDirtyClipped  有脏的**裁剪**兄弟 → 只禁「落在它范围里的绝对兄弟」
//
//   1287 行的条件 `!clipsBothAxes(childElem) || isAbsolute` 是分派：
//   裁剪 + 非绝对 → 记 seenDirtyClipped（毒性弱）
//   其余（不裁剪，或者绝对定位）→ 记 seenDirtyChild（毒性强）
//
//   注意两个标志都**只置一次**（if (wasDirty && !seenDirtyChild)），
//   一旦升级成 seenDirtyChild 就不会再变回弱的 —— 这是对的，
//   因为毒性强的那个已经污染了后面的一切。
    if (wasDirty && !seenDirtyChild) {
      if (!clipsBothAxes(childElem) || isAbsolute) {
        seenDirtyChild = true
      } else {
        seenDirtyClipped = true
      }
    }
  }
}

// 判定「两轴都裁剪」必须看**有效值**（overflowX/Y 可能各自覆盖 overflow），
// 只看 overflow 会漏掉「总设 visible 但两轴都设了 hidden」这种写法。
function clipsBothAxes(node: DOMElement): boolean {
  const ox = node.style.overflowX ?? node.style.overflow
  const oy = node.style.overflowY ?? node.style.overflow
  return (
    (ox === 'hidden' || ox === 'scroll') && (oy === 'hidden' || oy === 'scroll')
  )
}

// 【h=0 的 ghost 还需要第二个条件】
//
//   注释写得很直接：yoga 的像素取整可能给出 h=0，但下一个兄弟的 top
//   仍然被推进了（HelpV2 的第三列快捷键就是这个情况）。
//
//   所以判据是「**有没有兄弟落在同一个 computed top 上**」——
//   有，两个节点会写同一行，短的擦不掉长的尾巴；
//   没有，h=0 就当它不存在，跳过即可。
//
//   1315-1326 的分支顺序：先找后面的兄弟（常见情况），
//   没有就找前面的（尾部一串 h=0 的盒子会彼此共享 y）。
//   两段都只取**第一个有 yogaNode 的兄弟**就 return ——
//   因为一个节点只需要一个共享 y 的证据。
// When Yoga squeezes a box to h=0, the ghost only happens if a sibling
// lands at the same computed top — then both write to that row and the
// shorter content leaves the longer's tail visible. Yoga's pixel-grid
// rounding can give h=0 while still advancing the next sibling's top
// (HelpV2's third shortcuts column), so h=0 alone isn't sufficient.
function siblingSharesY(node: DOMElement, yogaNode: LayoutNode): boolean {
  const parent = node.parentNode
  if (!parent) return false
  const myTop = yogaNode.getComputedTop()
  const siblings = parent.childNodes
  const idx = siblings.indexOf(node)
  for (let i = idx + 1; i < siblings.length; i++) {
    const sib = (siblings[i] as DOMElement).yogaNode
    if (!sib) continue
    return sib.getComputedTop() === myTop
  }
  // No next sibling with a yoga node — check previous. A run of h=0 boxes
  // at the tail would all share y with each other.
  for (let i = idx - 1; i >= 0; i--) {
    const sib = (siblings[i] as DOMElement).yogaNode
    if (!sib) continue
    return sib.getComputedTop() === myTop
  }
  return false
}

// 【blit 只拷自己那个矩形，拷不到越界的子孙】
//
//   场景（注释里给了具体组件）：PromptInputFooter 的斜杠菜单用
//   position:absolute + bottom:'100%' 浮在输入框上方。
//   上面的 ScrollBox 里 spinner 跳一下 → 那几行被重画 → 菜单的像素被盖掉。
//
//   父节点本来会 blit 恢复自己那个矩形，但菜单在自己的矩形**之外**。
//   所以这里递归找所有绝对定位子孙，把它们越界的那部分再从 prevScreen 拷回来。
//
//   1361 行的条件 `cx < px || cy < py || ...` 是「只在越界时才拷」——
//   落在父矩形内的部分已经被父节点的 blit 覆盖了，重复拷是浪费。
//
//   注释里那句「Recurse — absolute descendants can be nested arbitrarily deep」
//   说明了为什么不能只看直接子节点。
// When a node blits, its absolute-positioned descendants that paint outside
// the node's layout bounds are NOT covered by the blit (which only copies
// the node's own rect). If a dirty sibling re-rendered and overwrote those
// cells, we must re-blit them from prevScreen so the overlays survive.
// Example: PromptInputFooter's slash menu uses position='absolute' bottom='100%'
// to float above the prompt; a spinner tick in the ScrollBox above re-renders
// and overwrites those cells. Without this, the menu vanishes on the next frame.
function blitEscapingAbsoluteDescendants(
  node: DOMElement,
  output: Output,
  prevScreen: Screen,
  px: number,
  py: number,
  pw: number,
  ph: number,
): void {
  const pr = px + pw
  const pb = py + ph
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') continue
    const elem = child as DOMElement
    if (elem.style.position === 'absolute') {
      const cached = nodeCache.get(elem)
      if (cached) {
        absoluteRectsCur.push(cached)
        const cx = Math.floor(cached.x)
        const cy = Math.floor(cached.y)
        const cw = Math.floor(cached.width)
        const ch = Math.floor(cached.height)
        // Only blit rects that extend outside the parent's layout bounds —
        // cells within the parent rect are already covered by the parent blit.
        if (cx < px || cy < py || cx + cw > pr || cy + ch > pb) {
          output.blit(prevScreen, cx, cy, cw, ch)
        }
      }
    }
    // Recurse — absolute descendants can be nested arbitrarily deep
    blitEscapingAbsoluteDescendants(elem, output, prevScreen, px, py, pw, ph)
  }
}

// ═══════════════════════════════════════════════════════════════
//  renderScrolledChildren：带视口裁剪的遍历
// ═══════════════════════════════════════════════════════════════
//
//   滚动容器可能有几百上千个子节点，但一屏只看得见十来个。
//   所以这里先判断「在不在可见窗口里」，不在就整棵跳过。
//
//   关键副作用在 1433 行：被裁掉的子节点要**删掉它的 cache**。
//   理由写在 1429-1432：它重新进入视口时，如果 cache 里还留着旧矩形，
//   会针对「现在被别人占着的位置」发一个 clear —— 把邻居擦掉一块。
//
//   这是个反直觉的点：cache 的存在本身是有害的，
//   因为它的语义是「上一次我看到你在这里」，而中间可能已经过了几百帧。
// Render children of a scroll container with viewport culling.
// scrollTopY..scrollBottomY are the visible window in CHILD-LOCAL Yoga coords
// (i.e. what getComputedTop() returns). Children entirely outside this window
// are skipped; their nodeCache entry is deleted so if they re-enter the
// viewport later they don't emit a stale clear for a position now occupied
// by a sibling.
function renderScrolledChildren(
  node: DOMElement,
  output: Output,
  offsetX: number,
  offsetY: number,
  hasRemovedChild: boolean,
  prevScreen: Screen | undefined,
  scrollTopY: number,
  scrollBottomY: number,
  inheritedBackgroundColor: Color | undefined,
// 【preserveCulledCache：快路径下反而不该删 cache】
//
//   矛盾吗？上面刚说被裁的要删。区别在**这一帧的缓冲区是怎么来的**：
//
//   全量路径：被裁的地方是空的（没画），cache 里的旧位置已经不可信
//   快路径：blit + shift 已经把稳定行填好了，被裁的子节点位置没变，
//          cache 依然准确 —— 删了反而要多走一遍子树
//
//   1390 行注释算的是代价：删 cache 是 O(总子节点 × 子树深度)，
//   每帧一次在长列表上是可观的。
  // When true (DECSTBM fast path), culled children keep their cache —
  // the blit+shift put stable rows in next.screen so stale cache is
  // never read. Avoids walking O(total_children * subtree_depth) per frame.
  preserveCulledCache = false,
): void {
  let seenDirtyChild = false
  // Track cumulative height shift of dirty children iterated so far. When
  // zero, a clean child's yogaTop is unchanged (no sibling above it grew),
  // so cached.top is fresh and the cull check skips yoga. Bottom-append
  // has the dirty child last → all prior clean children hit cache →
  // O(dirty) not O(mounted). Middle-growth leaves shift non-zero after
  // the dirty child → subsequent children yoga-read (needed for correct
  // culling since their yogaTop shifted).
  let cumHeightShift = 0
  for (const childNode of node.childNodes) {
    const childElem = childNode as DOMElement
    const cy = childElem.yogaNode
    if (cy) {
      const cached = nodeCache.get(childElem)
      let top: number
      let height: number
// 【cached.top 的复用，条件比 blit 宽】
//
//   这里只需要判断「位置」，不需要判断内容：
//     cached.top 有值 + 子节点不脏 + 累计高度变化为 0
//   → 位置和高度都没变，直接用 cached 值做裁剪判断，不读 yoga。
//
//   1421-1425 那条注释是配套的：走了快速路径也要**回写** cached.top。
//   因为 preserveCulledCache=true 时这是唯一的刷新点 ——
//   中间某帧发生过增长，之后所有帧都会读到陈旧 top，裁剪判断就全错。
//
//   这类「快速路径也要维护缓存新鲜度」的规则，是缓存正确性最容易破的地方。
      if (
        cached?.top !== undefined &&
        !childElem.dirty &&
        cumHeightShift === 0
      ) {
        top = cached.top
        height = cached.height
      } else {
        top = cy.getComputedTop()
        height = cy.getComputedHeight()
        if (childElem.dirty) {
          cumHeightShift += height - (cached ? cached.height : 0)
        }
        // Refresh cached top so next frame's cumShift===0 path stays
        // correct. For culled children with preserveCulledCache=true this
        // is the ONLY refresh point — without it, a middle-growth frame
        // leaves stale tops that misfire next frame.
        if (cached) cached.top = top
      }
      const bottom = top + height
      if (bottom <= scrollTopY || top >= scrollBottomY) {
        // Culled — outside visible window. Drop stale cache entries from
        // the subtree so when this child re-enters it doesn't fire clears
        // at positions now occupied by siblings. The viewport-clear on
        // scroll-change handles the visible-area repaint.
        if (!preserveCulledCache) dropSubtreeCache(childElem)
        continue
      }
    }
    const wasDirty = childElem.dirty
    renderNodeToOutput(childElem, output, {
      offsetX,
      offsetY,
      prevScreen: hasRemovedChild || seenDirtyChild ? undefined : prevScreen,
      inheritedBackgroundColor,
    })
    if (wasDirty) {
      seenDirtyChild = true
    }
  }
}

// 递归删 cache。注意跳过 #text ——
// 文本片段不是 DOMElement，nodeCache 里也没有它们的条目
// （缓存发生在 renderNodeToOutput，而文本是在父级的 ink-text 分支里处理的）。
function dropSubtreeCache(node: DOMElement): void {
  nodeCache.delete(node)
  for (const child of node.childNodes) {
    if (child.nodeName !== '#text') {
      dropSubtreeCache(child as DOMElement)
    }
  }
}

// Exported for testing
export { buildCharToSegmentMap, applyStylesToWrappedText }

export default renderNodeToOutput
