import {
  type AnsiCode,
  type StyledChar,
  styledCharsFromTokens,
  tokenize,
} from '@alcalzone/ansi-tokenize'
import { logForDebugging } from '../utils/debug.js'
import { getGraphemeSegmenter } from '../utils/intl.js'
import sliceAnsi from '../utils/sliceAnsi.js'
import { reorderBidi } from './bidi.js'
import { type Rectangle, unionRect } from './layout/geometry.js'
import {
  blitRegion,
  CellWidth,
  extractHyperlinkFromStyles,
  filterOutHyperlinkStyles,
  markNoSelectRegion,
  OSC8_PREFIX,
  resetScreen,
  type Screen,
  type StylePool,
  setCellAt,
  shiftRows,
} from './screen.js'
import { stringWidth } from './stringWidth.js'
import { widestLine } from './widest-line.js'

// ═══════════════════════════════════════════════════════════════
//  第三层之二：Output —— 一帧的「操作队列」
// ═══════════════════════════════════════════════════════════════
//
//   上一层 render-node-to-output 遍历布局树，把「这里写一行字」「这块从上一帧
//   拷过来」「这块要清掉」记录下来 —— 它记的不是结果，是**动作**。
//   这一层就是那张动作清单，get() 把它逐条应用到 Screen 上。
//
// 【为什么中间要隔一层操作队列】
//   如果是「边遍历边写屏幕」，就没法处理顺序问题。而这里至少有三处
//   顺序敏感：
//     · clip 必须先于它内部的 write（否则裁切信息还没进栈）
//     · blit 必须晚于 clear 的 damage 标记（否则 diff 看不到这块变脏）
//     · noSelect 必须晚于所有 write 和 blit（否则会被拷进来的旧值覆盖）
//   命令模式在这里不是为了「可撤销」，是为了**把时机从调用点解耦**。
//
// 【七种操作，按作用分三类】
//   画：write（文字）、blit（从上一帧整块拷）、shift（整行平移）
//   界：clip / unclip（裁切栈）
//   擦：clear（擦除）、noSelect（标记不可选）
//
// 【本文件三个最值得看的点】
//   ① 289  第一遍遍历里 clear **不写格子** —— 缓冲区刚被 resetScreen 清零，
//      所以 clear 只需要「把这块标成 damage，让 diff 去检查」。
//      「擦除」在这里退化成了「提醒下一阶段检查这里」。
//   ② 365  绝对定位节点的 clear 会让 blit 逐行走慢路径。为什么普通流的
//      clear 不需要：普通流节点的旧位置不可能压在兄弟节点身上。
//   ③ 553  先去重样式 run 再聚类 grapheme —— 顺序反了不影响正确性，
//      但会多算几万次样式 intern。
/**
 * A grapheme cluster with precomputed terminal width, styleId, and hyperlink.
 * Built once per unique line (cached via charCache), so the per-char hot loop
 * is just property reads + setCellAt — no stringWidth, no style interning,
 * no hyperlink extraction per frame.
 *
 * styleId is safe to cache: StylePool is session-lived (never reset).
 * hyperlink is stored as a string (not interned ID) since hyperlinkPool
 * resets every 5 min; setCellAt interns it per-frame (cheap Map.get).
 */
// 一个 grapheme（用户感知的一个字符），把三样开销大的东西预先算好：
// 宽度、styleId、超链接。
//   这些值是「按行」缓存的（见 642 行的 charCache），所以每帧的热循环
//   里只剩属性读取 + setCellAt —— 不量宽、不 intern 样式、不提超链接。
//
// 【两个字段的生存期不一样，这是关键】
//   styleId 可以长期缓存：StylePool 是会话级的，从不重置，ID 永远有效。
//   hyperlink 只能存字符串：hyperlinkPool 每 5 分钟重置一次（见 screen.ts），
//   存 ID 会指向重置后不存在的槽。所以这里存原字符串，setCellAt 每帧
//   现 intern 一次 —— 一次 Map.get，可以接受。
type ClusteredChar = {
  value: string
  width: number
  styleId: number
  hyperlink: string | undefined
}

/**
 * Collects write/blit/clear/clip operations from the render tree, then
 * applies them to a Screen buffer in `get()`. The Screen is what gets
 * diffed against the previous frame to produce terminal updates.
 */

// 构造参数。screen 从外面传进来而不是内部 new，是为了双缓冲：
// 两块 Screen 交替使用，上一帧那块同时还是 diff 的基准。
type Options = {
  width: number
  height: number
  stylePool: StylePool
  /**
   * Screen to render into. Will be reset before use.
   * For double-buffering, pass a reusable screen. Otherwise create a new one.
   */
  screen: Screen
}

export type Operation =
  | WriteOperation
  | ClipOperation
  | UnclipOperation
  | BlitOperation
  | ClearOperation
  | NoSelectOperation
  | ShiftOperation

type WriteOperation = {
  type: 'write'
  x: number
  y: number
  text: string
// softWrap 是**并行数组**：与 text.split('\n') 一一对应。
//   softWrap[i] = true 表示第 i 行是第 i-1 行的续行（这个换行是排版
//   自动加的，不是原文里的换行）。
//   这一点决定了「复制这段文字时要不要补换行」——
//   续行不能补，硬换行必须补。
//
//   undefined 表示生产者根本没跟踪换行（填充块、raw-ansi）——
//   此时屏幕上的 softWrap 位图保持不动，而不是清空。
//   「不知道」和「知道是硬换行」是两件事。
  /**
   * Per-line soft-wrap flags, parallel to text.split('\n'). softWrap[i]=true
   * means line i is a continuation of line i-1 (the `\n` before it was
   * inserted by word-wrap, not in the source). Index 0 is always false.
   * Undefined means the producer didn't track wrapping (e.g. fills,
   * raw-ansi) — the screen's per-row bitmap is left untouched.
   */
  softWrap?: boolean[]
}

type ClipOperation = {
  type: 'clip'
  clip: Clip
}

export type Clip = {
  x1: number | undefined
  x2: number | undefined
  y1: number | undefined
  y2: number | undefined
}

// Clip 的四个边界，undefined 表示「这一轴不限制」。
//   用 undefined 而不是 ±Infinity 或者 0/width，是因为求交时要区分
//   「没有约束」和「约束在 0」——这两者在 max/min 里的行为完全不同：
//   如果「无约束」写成 0，x1 取 max 就会把所有内容裁到 0 以右。
/**
 * Intersect two clips. `undefined` on an axis means unbounded; the other
 * clip's bound wins. If both are bounded, take the tighter constraint
 * (max of mins, min of maxes). If the resulting region is empty
 * (x1 >= x2 or y1 >= y2), writes clipped by it will be dropped.
 */
// 求交：x1 取两者较大的（更靠右），x2 取较小的（更靠左）。
//   无界一侧直接让位给有界一侧。
//   结果可能「反了」（x1 >= x2），表示区域为空 —— 此时不特殊处理，
//   由写入点各自的 startX >= maxX 判断兜住。
function intersectClip(parent: Clip | undefined, child: Clip): Clip {
  if (!parent) return child
  return {
    x1: maxDefined(parent.x1, child.x1),
    x2: minDefined(parent.x2, child.x2),
    y1: maxDefined(parent.y1, child.y1),
    y2: minDefined(parent.y2, child.y2),
  }
}

function maxDefined(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

function minDefined(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

type UnclipOperation = {
  type: 'unclip'
}

type BlitOperation = {
  type: 'blit'
  src: Screen
  x: number
  y: number
  width: number
  height: number
}

type ShiftOperation = {
  type: 'shift'
  top: number
  bottom: number
  n: number
}

type ClearOperation = {
  type: 'clear'
  region: Rectangle
  /**
   * Set when the clear is for an absolute-positioned node's old bounds.
   * Absolute nodes overlay normal-flow siblings, so their stale paint is
   * what an earlier sibling's clean-subtree blit wrongly restores from
   * prevScreen. Normal-flow siblings' clears don't have this problem —
   * their old position can't have been painted on top of a sibling.
   */
  fromAbsolute?: boolean
}

type NoSelectOperation = {
  type: 'noSelect'
  region: Rectangle
}

// Output 实例的**生命周期是一帧**：每帧 reset 一次复用，不是每帧 new。
//   复用省下的是 allocations：200×120 的屏幕缓冲区 + 操作数组 +
//   charCache 都是大对象，每帧重建会让 GC 在滚动时表现为掉帧。
export default class Output {
  width: number
  height: number
  private readonly stylePool: StylePool
  private screen: Screen

  private readonly operations: Operation[] = []

  private charCache: Map<string, ClusteredChar[]> = new Map()

  constructor(options: Options) {
    const { width, height, stylePool, screen } = options

    this.width = width
    this.height = height
    this.stylePool = stylePool
    this.screen = screen

    resetScreen(screen, width, height)
  }

  /**
   * Reuse this Output for a new frame. Zeroes the screen buffer, clears
   * the operation list (backing storage is retained), and caps charCache
   * growth. Preserving charCache across frames is the main win — most
   * lines don't change between renders, so tokenize + grapheme clustering
   * becomes a cache hit.
   */
// 帧开始时重置。四件事，顺序无关但都必要：
//   · 换尺寸（终端 resize 后 width/height 会变）
//   · **保留** operations 数组的底层存储，只清长度（length = 0 不释放容量）
//   · 清空屏幕缓冲并把 damage 归零
//   · charCache 超过 16384 条就整体丢弃
//
// 【charCache 为什么是「硬清」而不是 LRU】
//   缓存的命中条件是「这一行的字符串完全没变」。能积累到 16384 条不同
//   的行，说明屏幕内容一直在变（比如流式输出），此时缓存本来就是低命中率，
//   整体丢掉最省事。而且真要淘汰，LRU 的维护成本（每条 get 都要动链表）
//   会吃掉缓存本身的收益。
//   167 万分之一秒的判断，换来「不会有内存无界增长」的确定性。
  reset(width: number, height: number, screen: Screen): void {
    this.width = width
    this.height = height
    this.screen = screen
    this.operations.length = 0
    resetScreen(screen, width, height)
    if (this.charCache.size > 16384) this.charCache.clear()
  }

  /**
   * Copy cells from a source screen region (blit = block image transfer).
   */
// blit = block image transfer，整块拷贝。
//   注意它只是**记录**，不是执行：源屏幕 src 是上一帧的缓冲，
//   真正的逐格拷贝发生在 get() 里。
  blit(src: Screen, x: number, y: number, width: number, height: number): void {
    this.operations.push({ type: 'blit', src, x, y, width, height })
  }

  /**
   * Shift full-width rows within [top, bottom] by n. n > 0 = up. Mirrors
   * what DECSTBM + SU/SD does to the terminal. Paired with blit() to reuse
   * prevScreen content during pure scroll, avoiding full child re-render.
   */
// shift 与终端里的 DECSTBM + SU/SD（设定滚动区 + 上/下滚）语义一致。
//   它和 blit 配对使用：纯滚动时不必重画整个子树，只要
//   「整行平移 + 补画新露出来的那几行」。
//   n > 0 表示向上（内容上移，即用户往下滚）。
  shift(top: number, bottom: number, n: number): void {
    this.operations.push({ type: 'shift', top, bottom, n })
  }

  /**
   * Clear a region by writing empty cells. Used when a node shrinks to
   * ensure stale content from the previous frame is removed.
   */
// clear 的注释说「写空格子」，但看 get() 的实现会发现它**并不写**（见 289）：
//   缓冲区本来就是清零的，所以这里只需要把区域标成 damage。
//   注释与实现不一致，但真正的语义是「这块与上一帧的对比要强制检查」。
//
//   fromAbsolute 这个参数是后来加的补丁，看 288 与 361 两处注释。
  clear(region: Rectangle, fromAbsolute?: boolean): void {
    this.operations.push({ type: 'clear', region, fromAbsolute })
  }

  /**
   * Mark a region as non-selectable (excluded from fullscreen text
   * selection copy + highlight). Used by <NoSelect> to fence off
   * gutters (line numbers, diff sigils). Applied AFTER blit/write so
   * the mark wins regardless of what's blitted into the region.
   */
// noSelect 标记的区域，在 alt 屏选区里既不参与高亮也不能被复制。
//   典型用途是 diff 的行号栏、树形缩进 —— 拖选一段代码时不想带上那些字符。
//   它被放在**最后一遍**执行（见 510 行），原因写在那边。
  noSelect(region: Rectangle): void {
    this.operations.push({ type: 'noSelect', region })
  }

// write 是唯一真正带内容的操作。空串直接丢弃 ——
//   否则每一帧都会往操作队列里塞几千条空写入。
  write(x: number, y: number, text: string, softWrap?: boolean[]): void {
    if (!text) {
      return
    }

    this.operations.push({
      type: 'write',
      x,
      y,
      text,
      softWrap,
    })
  }

// clip / unclip 是一对，成对出现。get() 里维护一个栈，
//   每个 clip 与**栈顶**求交后压栈 —— 见 315 行那段的注释：嵌套的
//   overflow:hidden 如果各自只用自己的布局边界，内层的写入会逃出外层。
  clip(clip: Clip) {
    this.operations.push({
      type: 'clip',
      clip,
    })
  }

  unclip() {
    this.operations.push({
      type: 'unclip',
    })
  }

// get() 是这一层的终点：把操作清单落成一块 Screen。
//   两遍遍历，分工严格：
//     第一遍：只处理 clear（展开 damage）+ 收集绝对定位的 clear 区域
//     第二遍：clip 栈、blit、shift、write
//     之后：noSelect 单独再跑一遍
//
// 【为什么 clear 必须在第一遍】
//   因为 blit 要用到「哪些区域不能从上一帧拷」。那是第一遍收集的
//   absoluteClears。如果 clear 和第二遍混在一起处理，blit 可能先于
//   对应的 clear 执行，就拷回了本该被擦掉的旧内容。
  get(): Screen {
    const screen = this.screen
    const screenWidth = this.width
    const screenHeight = this.height

    // Track blit vs write cell counts for debugging
    let blitCells = 0
    let writeCells = 0

// 第一遍：把每个 clear 区域与屏幕求交，再并进 screen.damage。
//
//   damage 的语义是「这一帧这些格子可能变了，diff 时必须检查」。
//   对 clear 来说这是必须的：缓冲区已经被清零成「空」，如果不标 damage，
//   diff 会认为「这块没被写过」而整块跳过，屏幕上的旧内容就永远留着。
    // Pass 1: expand damage to cover clear regions. The buffer is freshly
    // zeroed by resetScreen, so this pass only marks damage so diff()
    // checks these regions against the previous frame.
    //
    // Also collect clears from absolute-positioned nodes. An absolute
    // node overlays normal-flow siblings; when it shrinks, its clear is
    // pushed AFTER those siblings' clean-subtree blits (DOM order). The
    // blit copies the absolute node's own stale paint from prevScreen,
    // and since clear is damage-only, the ghost survives diff. Normal-
    // flow clears don't need this — a normal-flow node's old position
    // can't have been painted on top of a sibling's current position.
// absoluteClears：绝对定位节点的 clear 区域单独收集一份。
//
//   原文注释给的理由是「绝对定位节点会盖在普通流兄弟上面」——
//   展开说：DOM 顺序决定操作顺序。绝对定位节点排在兄弟之后，
//   所以它的 clear 也排在那些兄弟的「干净子树 blit」之后。
//   于是 blit 先把 prevScreen 里这块（其实是绝对定位节点上一帧的残影）
//   拷回来，而 clear 只标了 damage 没真写 —— 残影就活过了 diff。
//
//   普通流节点没有这个问题：它的旧位置**不可能**是某个兄弟的当前位置，
//   因为布局不会让两个兄弟占同一块地方。
    const absoluteClears: Rectangle[] = []
    for (const operation of this.operations) {
      if (operation.type !== 'clear') continue
      const { x, y, width, height } = operation.region
      const startX = Math.max(0, x)
      const startY = Math.max(0, y)
      const maxX = Math.min(x + width, screenWidth)
      const maxY = Math.min(y + height, screenHeight)
      if (startX >= maxX || startY >= maxY) continue
      const rect = {
        x: startX,
        y: startY,
        width: maxX - startX,
        height: maxY - startY,
      }
      screen.damage = screen.damage ? unionRect(screen.damage, rect) : rect
      if (operation.fromAbsolute) absoluteClears.push(rect)
    }

// 裁切栈。注意它是「现场求交后压栈」的：栈里每一项已经是
//   从根到当前的**累积**交集，所以取栈顶就是当前有效裁切，
//   不需要每层向上回溯。
    const clips: Clip[] = []

    for (const operation of this.operations) {
      switch (operation.type) {
        case 'clear':
          // handled in pass 1
          continue

// 这一段的注释值得完整读：它在解释「为什么必须与父裁切求交」。
//
//   场景：一个 overflow:hidden 的消息，处在 scrollbox 底部。
//   它按自己的布局边界算裁切，而这个边界**已经减过 scrollTop**，
//   于是裁切区可能延伸到 scrollbox 视口之下 —— 写入就会漏进
//   底下那个兄弟区域的行里。
//
//   规律：**局部坐标系的裁切，必须再被父级裁切裁一次。**
//   只要有一层的边界是「按自己算的」，它就能突破所有祖先。
        case 'clip':
          // Intersect with the parent clip (if any) so nested
          // overflow:hidden boxes can't write outside their ancestor's
          // clip region. Without this, a message with overflow:hidden at
          // the bottom of a scrollbox pushes its OWN clip (based on its
          // layout bounds, already translated by -scrollTop) which can
          // extend below the scrollbox viewport — writes escape into
          // the sibling bottom section's rows.
          clips.push(intersectClip(clips.at(-1), operation.clip))
          continue

        case 'unclip':
          clips.pop()
          continue

// blit：把 src（上一帧）的矩形块拷进当前屏幕。
//
//   下面这段求交同时和**四样东西**取交集：目标屏幕尺寸、源屏幕尺寸、
//   当前 clip。少任何一个都会越界写：
//     · 不裁屏幕 → TypedArray.set 越界，静默丢数据或写错行
//     · 不裁源屏幕 → 读到别的行（stride 不同，行会错位）
//     · 不裁 clip → 子节点缓存的矩形比父容器大时，写穿父容器边界
        case 'blit': {
          // Bulk-copy cells from source screen region using TypedArray.set().
          // Tracking damage ensures diff() checks blitted cells for stale content
          // when a parent blits an area that previously contained child content.
          const {
            src,
            x: regionX,
            y: regionY,
            width: regionWidth,
            height: regionHeight,
          } = operation
          // Intersect with active clip — a child's clean-blit passes its full
          // cached rect, but the parent ScrollBox may have shrunk (pill mount).
          // Without this, the blit writes past the ScrollBox's new bottom edge
          // into the pill's row.
// 子节点传的是它自己**缓存**的矩形，那个矩形可能是父容器还很大时算的。
//   父容器收缩后（比如底部 pill 浮起来），如果不与 clip 求交，
//   blit 就会写进 pill 那一行。
          const clip = clips.at(-1)
          const startX = Math.max(regionX, clip?.x1 ?? 0)
          const startY = Math.max(regionY, clip?.y1 ?? 0)
          const maxY = Math.min(
            regionY + regionHeight,
            screenHeight,
            src.height,
            clip?.y2 ?? Infinity,
          )
          const maxX = Math.min(
            regionX + regionWidth,
            screenWidth,
            src.width,
            clip?.x2 ?? Infinity,
          )
          if (startX >= maxX || startY >= maxY) continue
// 绝对定位 clear 的逐行排除。只在 absoluteClears 非空时才走这条慢路径 ——
//   绝大多数帧里它是空的，所以热路径只有一行 if。
//
//   逐行的理由：绝对定位节点的清除区域通常是「一整块行」，
//   而 blit 的区域可能与它部分重叠。按行切成若干段，被覆盖的行整行跳过，
//   其余行照常 blit。行内的部分重叠不处理 —— 那种情况在终端布局里
//   不会出现（横向位置不由滚动决定）。
          // Skip rows covered by an absolute-positioned node's clear.
          // Absolute nodes overlay normal-flow siblings, so prevScreen in
          // that region holds the absolute node's stale paint — blitting
          // it back would ghost. See absoluteClears collection above.
          if (absoluteClears.length === 0) {
            blitRegion(screen, src, startX, startY, maxX, maxY)
            blitCells += (maxY - startY) * (maxX - startX)
            continue
          }
          let rowStart = startY
          for (let row = startY; row <= maxY; row++) {
            const excluded =
              row < maxY &&
              absoluteClears.some(
                r =>
                  row >= r.y &&
                  row < r.y + r.height &&
                  startX >= r.x &&
                  maxX <= r.x + r.width,
              )
            if (excluded || row === maxY) {
              if (row > rowStart) {
                blitRegion(screen, src, startX, rowStart, maxX, row)
                blitCells += (row - rowStart) * (maxX - startX)
              }
              rowStart = row + 1
            }
          }
          continue
        }

// shift 直接调 screen.ts 的 shiftRows，不做任何边界收窄 ——
//   边界由调用方（ScrollBox 渲染）保证在屏幕内。
        case 'shift': {
          shiftRows(screen, operation.top, operation.bottom, operation.n)
          continue
        }

// write 是分支最长的一段。它做三件事，顺序不能换：
//     ① 先粗判：整块文字完全在 clip 外就整条跳过（省掉下面的逐行计算）
//     ② 横向裁：逐行 sliceAnsi（要保留行内 ANSI 状态）
//     ③ 纵向裁：切行数组，同时修正 softWrap 的起点
//
//   为什么横向必须用 sliceAnsi 而不是按列切字符串：一行里的 ANSI 转义码
//   不占列宽，按字符下标切会把转义序列切两半，输出就乱了。
        case 'write': {
          const { text, softWrap } = operation
          let { x, y } = operation
          let lines = text.split('\n')
          let swFrom = 0
          let prevContentEnd = 0

// 只取栈顶：栈里每一项已经是累积交集（见 307 的注释）。
          const clip = clips.at(-1)

          if (clip) {
            const clipHorizontally =
              typeof clip?.x1 === 'number' && typeof clip?.x2 === 'number'

            const clipVertically =
              typeof clip?.y1 === 'number' && typeof clip?.y2 === 'number'

// 粗判用 widestLine（最宽那一行的宽度）而不是逐行判断 ——
//   这里的目标是「快速排除整块」，宁可保守也不能漏。
//   widestLine 只看最长行，可能高估，但绝不会低估。
            // If text is positioned outside of clipping area altogether,
            // skip to the next operation to avoid unnecessary calculations
            if (clipHorizontally) {
              const width = widestLine(text)

              if (x + width <= clip.x1! || x >= clip.x2!) {
                continue
              }
            }

            if (clipVertically) {
              const height = lines.length

              if (y + height <= clip.y1! || y >= clip.y2!) {
                continue
              }
            }

// 逐行横向裁。from 是「左边被裁掉多少列」，to 是「保留到第几列」。
//   sliceAnsi 的好处是它会重放必要的 SGR 转义序列，
//   让裁出来的片段自带完整的样式上下文。
            if (clipHorizontally) {
              lines = lines.map(line => {
                const from = x < clip.x1! ? clip.x1! - x : 0
                const width = stringWidth(line)
                const to = x + width > clip.x2! ? clip.x2! - x : width
                let sliced = sliceAnsi(line, from, to)
// 宽字符的重切补丁，这段值得单独看。
//
//   假设 clip.x2 落在某个汉字的**第一格**上。sliceAnsi 的切片单位是列，
//   但它不会把一个占两列的字符切成一半 —— 于是它把整个汉字包含进来，
//   结果比你要求的宽度多出一列。
//   后果不是「多显示一个字符」那么简单：多出来的那一列会把该汉字的
//   占位格（SpacerTail）写进相邻的兄弟节点里，污染别人的内容。
//
//   修法很朴素：发现超宽就少切一列。宽字符恰好占两列，所以
//   退一格必然能装下 —— 不需要循环重试。
//   「知道一个约束的具体数值，就能把循环换成一次判断。」
                // Wide chars (CJK, emoji) occupy 2 cells. When `to` lands
                // on the first cell of a wide char, sliceAnsi includes the
                // entire glyph and the result overflows clip.x2 by one cell,
                // writing a SpacerTail into the adjacent sibling. Re-slice
                // one cell earlier; wide chars are exactly 2 cells, so a
                // single retry always fits.
                if (stringWidth(sliced) > to - from) {
                  sliced = sliceAnsi(line, from, to - 1)
                }
                return sliced
              })

              if (x < clip.x1!) {
                x = clip.x1!
              }
            }

            if (clipVertically) {
              const from = y < clip.y1! ? clip.y1! - y : 0
              const height = lines.length
              const to = y + height > clip.y2! ? clip.y2! - y : height

// 纵向裁切时最微妙的一处：如果第一行可见的内容是**软换行续行**，
//   那么它的上一行被裁掉了（从没写进屏幕），但 softWrap 位图仍然需要
//   记录「这一行从哪里接上」。
//
//   所以这里提前把「被裁掉的上一行的结尾列」算出来，存进 prevContentEnd，
//   等真正写第一行时用它填位图。
//   「被裁掉的东西也可能留下必须保留的信息」——
//   这是裁切逻辑里最容易漏的一类。
              // If the first visible line is a soft-wrap continuation, we
              // need the clipped previous line's content end so
              // screen.softWrap[lineY] correctly records the join point
              // even though that line's cells were never written.
              if (softWrap && from > 0 && softWrap[from] === true) {
                prevContentEnd = x + stringWidth(lines[from - 1]!)
              }

              lines = lines.slice(from, to)
              swFrom = from

              if (y < clip.y1!) {
                y = clip.y1!
              }
            }
          }

// swBits 是屏幕的 softWrap 位图，每行一个 int。
//   编码方式见 screen.ts 的文档：0 表示「这一行是硬换行开始的」，
//   非 0 表示「上一行的内容结束在第 N 列」——
//   把「接续点」存在**下一行**身上，而不是存在本行的「我有续行」标志上。
//   这样「删除一行」不需要回头改上一行。
          const swBits = screen.softWrap
          let offsetY = 0

          for (const line of lines) {
            const lineY = y + offsetY
            // Line can be outside screen if `text` is taller than screen height
            if (lineY >= screenHeight) {
              break
            }
            const contentEnd = writeLineToScreen(
              screen,
              line,
              x,
              lineY,
              screenWidth,
              this.stylePool,
              this.charCache,
            )
            writeCells += contentEnd - x
// contentEnd 是 writeLineToScreen 的返回值：这一行实际占到第几列。
//   不能用 x + stringWidth(line) 代替 —— tab 会被展开成多个空格，
//   而 stringWidth 把 tab 当零宽（见 writeLineToScreen 里的 0x09 分支）。
//   「同一个量有两个算法时，选那个知道上下文的。」
            // See Screen.softWrap docstring for the encoding. contentEnd
            // from writeLineToScreen is tab-expansion-aware, unlike
            // x+stringWidth(line) which treats tabs as width 0.
            if (softWrap) {
              const isSW = softWrap[swFrom + offsetY] === true
              swBits[lineY] = isSW ? prevContentEnd : 0
              prevContentEnd = contentEnd
            }
            offsetY++
          }
          continue
        }
      }
    }

// noSelect 单独跑最后一遍，理由有三条，原文注释写了两条：
//     · 它要赢过 blit —— blit 会把上一帧的 noSelect 位图拷过来，
//       如果先标记、后 blit，标记就被旧值盖掉了
//     · 它要赢过 write —— write 完全不碰 noSelect 位，所以只能在之后补
//     · 还有一个原文没写的：resetScreen 已经把位图清零了，
//       所以「一个 NoSelect 盒子从 A 挪到 B」时，A 处的标记会自动消失。
//       这就是「先重置再标记」胜过「标记 + 反标记」的地方 ——
//       不需要维护「上一次标记在哪」。
//
// 【顺带一个实现细节】
//   这一遍是**独立的一次完整遍历**，而不是在第二遍的 switch 里加一个
//   case。多遍历一次 operations 数组的代价，远小于「在长正则的
//   switch 里再加一个分支」带来的分支预测成本和可读性损失。
    // noSelect ops go LAST so they win over blits (which copy noSelect
    // from prevScreen) and writes (which don't touch noSelect). This way
    // a <NoSelect> box correctly fences its region even when the parent
    // blits, and moving a <NoSelect> between frames correctly clears the
    // old region (resetScreen already zeroed the bitmap).
    for (const operation of this.operations) {
      if (operation.type === 'noSelect') {
        const { x, y, width, height } = operation.region
        markNoSelectRegion(screen, x, y, width, height)
      }
    }

// 埋点：blit 与 write 的格子数比例。
//   这是这一层唯一能反映「性能模型有没有失效」的数字 ——
//   blit 率高说明复用生效；write 率接近 100% 说明每个节点都在重画，
//   那前面那些缓存、dirty 标记、blit 判定全都白做了。
//   阈值取 1000 格，是为了排除小屏幕和空帧的噪声。
    // Log blit/write ratio for debugging - high write count suggests blitting isn't working
    const totalCells = blitCells + writeCells
    if (totalCells > 1000 && writeCells > blitCells) {
      logForDebugging(
        `High write ratio: blit=${blitCells}, write=${writeCells} (${((writeCells / totalCells) * 100).toFixed(1)}% writes), screen=${screenHeight}x${screenWidth}`,
      )
    }

    return screen
  }
}

// 样式数组比较。注意第一行：引用相等直接返回 true。
//   这不是微优化 —— 同一行的字符通常共享**同一个** styles 数组实例
//   （tokenize 输出里同一 run 的字符指向同一数组），所以这个快路径
//   命中的比例很高。
//
//   逐项比的是 code 而不是整个对象：AnsiCode 里还有其它字段，
//   但真正决定终端行为的只有 SGR 码本身。
function stylesEqual(a: AnsiCode[], b: AnsiCode[]): boolean {
  if (a === b) return true // Reference equality fast path
  const len = a.length
  if (len !== b.length) return false
  if (len === 0) return true // Both empty
  for (let i = 0; i < len; i++) {
    if (a[i]!.code !== b[i]!.code) return false
  }
  return true
}

// 把「带 ANSI 的字符串」变成「带预计算的 grapheme 序列」。三个步骤：
//     ① tokenize 拆出「字符 + 当前生效的样式」（库函数）
//     ② 按样式分 run，每个 run 才 intern 一次样式（本函数）
//     ③ run 内部按 grapheme 切分，每个 grapheme 算一次宽度（flushBuffer）
//
// 【为什么必须先分 run 再聚类】
//   反过来的顺序（先按 grapheme 切，再按样式分组）也能得到正确结果，
//   但每个 grapheme 都要做一次 stylesEqual 比较 —— 一行 80 列就是
//   80 次比较 + 80 次可能的 intern。现在是一行几个 run 就几次。
//   原文注释说得很准确：80 字符 3 个 run，就是 3 次 intern 而不是 80 次。
//
// 【为什么 grapheme 聚类必须发生在样式边界之内】
//   因为一个 grapheme 内部不可能跨样式：终端渲染时 grapheme 是一个整体，
//   不存在「前半个带红色」这种状态。所以按样式切不会切错任何 grapheme。
/**
 * Convert a string with ANSI codes into styled characters with proper grapheme
 * clustering. Fixes ansi-tokenize splitting grapheme clusters (like family
 * emojis) into individual code points.
 *
 * Also precomputes styleId + hyperlink per style run (not per char) — an
 * 80-char line with 3 style runs does 3 intern calls instead of 80.
 */
function styledCharsWithGraphemeClustering(
  chars: StyledChar[],
  stylePool: StylePool,
): ClusteredChar[] {
  const charCount = chars.length
  if (charCount === 0) return []

  const result: ClusteredChar[] = []
  const bufferChars: string[] = []
  let bufferStyles: AnsiCode[] = chars[0]!.styles

  for (let i = 0; i < charCount; i++) {
    const char = chars[i]!
    const styles = char.styles

// 样式一变就 flush。注意条件是 bufferChars.length > 0 ——
//   空缓冲区不 flush，否则会往结果里塞空片段。
    // Different styles means we need to flush and start new buffer
    if (bufferChars.length > 0 && !stylesEqual(styles, bufferStyles)) {
      flushBuffer(bufferChars.join(''), bufferStyles, stylePool, result)
      bufferChars.length = 0
    }

    bufferChars.push(char.value)
    bufferStyles = styles
  }

  // Final flush
  if (bufferChars.length > 0) {
    flushBuffer(bufferChars.join(''), bufferStyles, stylePool, result)
  }

  return result
}

function flushBuffer(
  buffer: string,
  styles: AnsiCode[],
  stylePool: StylePool,
  out: ClusteredChar[],
): void {
// flushBuffer 的关键原则：**整个 run 只算一次 styleId + 一次 hyperlink**。
//   这个 run 里的每个 grapheme 共享同一组样式，所以没必要逐个 intern。
  // Compute styleId + hyperlink ONCE for the whole style run.
  // Every grapheme in this buffer shares the same styles.
  //
  // Extract and track hyperlinks separately, filter from styles.
  // Always check for OSC 8 codes to filter, not just when a URL is
  // extracted. The tokenizer treats OSC 8 close codes (empty URL) as
  // active styles, so they must be filtered even when no hyperlink
  // URL is present.
// 超链接不是样式的一部分 —— 它在屏幕缓冲里占的是独立的池
//   （见 screen.ts 的 hyperlinkId 位域）。所以这里先把它从样式里摘出来，
//   再给剩下的样式算 styleId。
  const hyperlink = extractHyperlinkFromStyles(styles) ?? undefined
// 这段判断容易被忽略，但它是必须的：**OSC 8 的关闭码（空 URL）
//   也会被 tokenizer 当成「生效中的样式」**。
//
//   所以不能写成「提取到 URL 才过滤」—— 关闭超链接的那一段没有 URL，
//   但它的样式数组里确实有一条 OSC 8 记录。不过滤的话，
//   这条记录会进入 StylePool，于是「同样的视觉样式、但超链接已关闭」
//   和「根本没有超链接」变成两个不同的 styleId —— 样式池的条目数
//   会因为超链接的开合而膨胀。
//
//   判据：**过滤条件要看「有没有这类码」，不能看「有没有取到值」。**
  const hasOsc8Styles =
    hyperlink !== undefined ||
    styles.some(
      s =>
        s.code.length >= OSC8_PREFIX.length && s.code.startsWith(OSC8_PREFIX),
    )
  const filteredStyles = hasOsc8Styles
    ? filterOutHyperlinkStyles(styles)
    : styles
  const styleId = stylePool.intern(filteredStyles)

// 真正的切分。getGraphemeSegmenter 是全局单例的 Intl.Segmenter ——
//   每 new 一个都要加载 ICU 数据，构造开销远大于使用开销。
//
//   宽度在这里一次算好并缓存：这个函数的结果会进 charCache，
//   所以「同一行不变」时连 stringWidth 都不会被调用。
  for (const { segment: grapheme } of getGraphemeSegmenter().segment(buffer)) {
    out.push({
      value: grapheme,
      width: stringWidth(grapheme),
      styleId,
      hyperlink,
    })
  }
}

// 单行写入被抽成独立函数，理由写在注释里：让 JSC（JavaScriptCore）
//   能针对这个**单态**热循环单独优化 —— 寄存器分配、setCellAt 内联、
//   类型反馈都比「埋在 300 行的 switch 里」好得多。
//
//   这是一个很具体的引擎行为约束：V8/JSC 的优化决策是**按函数**做的，
//   函数越大、分支越多，内联和去虚拟化的收益越低。
//   拆函数的动机有时不是可读性，是给优化器一个更干净的输入。
/**
 * Write a single line's characters into the screen buffer.
 * Extracted from Output.get() so JSC can optimize this tight,
 * monomorphic loop independently — better register allocation,
 * setCellAt inlining, and type feedback than when buried inside
 * a 300-line dispatch function.
 *
 * Returns the end column (x + visual width, including tab expansion) so
 * the caller can record it in screen.softWrap without re-walking the
 * line via stringWidth(). Caller computes the debug cell-count as end-x.
 */
function writeLineToScreen(
  screen: Screen,
  line: string,
  x: number,
  y: number,
  screenWidth: number,
  stylePool: StylePool,
  charCache: Map<string, ClusteredChar[]>,
): number {
// charCache 的键是**整行字符串**，值是聚类结果。
//   这个键的选择决定了命中率的形态：
//     · 静态文本（菜单、提示、边框）—— 永远命中
//     · 流式输出的最后一行 —— 每帧都 miss
//     · 计数器、spinner、耗时 —— 每帧都 miss，且每帧产生一个新条目
//   第三种是 16384 上限存在的原因（见 reset()）。
  let characters = charCache.get(line)
  if (!characters) {
    characters = reorderBidi(
      styledCharsWithGraphemeClustering(
        styledCharsFromTokens(tokenize(line)),
        stylePool,
      ),
    )
    charCache.set(line, characters)
  }

  let offsetX = x

  for (let charIdx = 0; charIdx < characters.length; charIdx++) {
    const character = characters[charIdx]!
    const codePoint = character.value.codePointAt(0)

// C0 控制字符（0x00-0x1F）的处理。这一段存在的根本原因：
//   **ansi-tokenize 只认两类序列** —— SGR（ESC [ ... m）和
//   OSC 8 超链接（ESC ] 8 ; ; url BEL）。其它所有转义序列
//   （光标移动、清屏、设置标题、字符集切换）都会被拆成
//   一个个独立的字符 token 交给这里。
//
//   而 stringWidth 把这些控制字符算成宽度 0，终端却可能真的去移动光标 ——
//   于是「我们以为写到第几列」和「终端实际在第几列」就分家了。
//   分家之后所有列坐标都错，症状是整屏内容逐渐右移或错行。
//
//   所以这里的选择是：**要么正确执行，要么完整跳过，绝不能当成零宽字符。**
    // Handle C0 control characters (0x00-0x1F) that cause cursor movement
    // mismatches. stringWidth treats these as width 0, but terminals may
    // move the cursor differently.
    if (codePoint !== undefined && codePoint <= 0x1f) {
      // Tab (0x09): expand to spaces to reach next tab stop
// Tab 展开成空格。制表位是**绝对列位置**的（第 8、16、24… 列），
//   不是「补 8 个空格」—— 所以要用 offsetX % 8 算到下一个制表位的距离。
//   如果写成固定 8 个空格，同一个 tab 在不同起始列上会展开成不同宽度，
//   列的对应关系就全乱了。
//
//   边界：屏幕上放不下就不写（offsetX < screenWidth），
//   不留半截 —— 半个 tab 没有意义。
      if (codePoint === 0x09) {
        const tabWidth = 8
        const spacesToNextStop = tabWidth - (offsetX % tabWidth)
        for (let i = 0; i < spacesToNextStop && offsetX < screenWidth; i++) {
          setCellAt(screen, offsetX, y, {
            char: ' ',
            styleId: stylePool.none,
            width: CellWidth.Narrow,
            hyperlink: undefined,
          })
          offsetX++
        }
      }
// ESC 后面跟什么，决定了要跳过多少个字符。这是手写的
//   转义序列状态机，覆盖 ECMA-48 的几大类：
//     ESC ( ) * +  → 字符集选择，跳 3 个字符（ESC、中间字符、指示符）
//     ESC [        → CSI，跳到终止字节（0x40-0x7E）
//     ESC ] P _ ^ X → 字符串型（OSC/DCS/APC/PM/SOS），跳到 BEL 或 ST
//     其他         → 单字符命令（ESC 7 保存光标、ESC c 复位…）
//
// 【为什么不能直接按 0x40-0x7e 一次扫完】
//   CSI 和「单字符命令」的判据都是「终止字节在 0x40-0x7E」，
//   但 CSI 的终止字节前面可以有任意多个参数字节（0x30-0x3F）。
//   不分情况处理的话，ESC [ 3 8 ; 5 ; 1 0 0 m 里那个 `3` 会被当成终止字节，
//   后面的 `8 ; 5 ; …` 就当成正文写进屏幕了。
      // ESC (0x1B): skip incomplete escape sequences that ansi-tokenize
      // didn't recognize. ansi-tokenize only parses SGR sequences (ESC[...m)
      // and OSC 8 hyperlinks (ESC]8;;url BEL). Other sequences like cursor
      // movement, screen clearing, or terminal title become individual char
      // tokens that we need to skip here.
      else if (codePoint === 0x1b) {
        const nextChar = characters[charIdx + 1]?.value
        const nextCode = nextChar?.codePointAt(0)
        if (
          nextChar === '(' ||
          nextChar === ')' ||
          nextChar === '*' ||
          nextChar === '+'
        ) {
          // Charset selection: ESC ( X, ESC ) X, etc.
          // Skip the intermediate char and the charset designator
          charIdx += 2
// CSI 的扫描：从 `[` 之后一路找终止字节。
//   终止字节范围 0x40-0x7E 是 ECMA-48 的规定，不是随便定的 ——
//   参数字节全在 0x30-0x3F（数字、`;`、`?`、`<`、`=`、`>`），
//   两者不重叠，所以「遇到 0x40 以上就结束」是安全的。
//
//   循环条件用 characters.length - 1 而不是 length，
//   是为了保证 charIdx++ 之后不越界。
        } else if (nextChar === '[') {
          // CSI sequence: ESC [ ... final-byte
          // Final byte is in range 0x40-0x7E (@, A-Z, [\]^_`, a-z, {|}~)
          // Examples: ESC[2J (clear), ESC[?25l (cursor hide), ESC[H (home)
          charIdx++ // skip the [
          while (charIdx < characters.length - 1) {
            charIdx++
            const c = characters[charIdx]?.value.codePointAt(0)
            // Final byte terminates the sequence
            if (c !== undefined && c >= 0x40 && c <= 0x7e) {
              break
            }
          }
// 字符串型序列：OSC（ESC ]）、DCS（ESC P）、APC（ESC _）、
//   PM（ESC ^）、SOS（ESC X）。它们没有「终止字节」，
//   只能靠 BEL（0x07）或 ST（ESC 反斜杠）结束。
//
//   这就是为什么不能把它们和 CSI 合在一起处理：
//   判据完全不同（内容里可以出现 0x40-0x7E 的任意字节，
//   比如 OSC 8 的 URL 里全是可见字符）。
//
//   嵌套判断那段：看到 ESC 时要往前看一个字符，是反斜杠才是 ST。
//   单独的 ESC 不是终止符 —— 而且如果真的遇到单独 ESC 又没跟上反斜杠，
//   说明序列本身已经坏了，此时继续往后找 BEL 是唯一合理的兜底。
        } else if (
          nextChar === ']' ||
          nextChar === 'P' ||
          nextChar === '_' ||
          nextChar === '^' ||
          nextChar === 'X'
        ) {
          // String-based sequences terminated by BEL (0x07) or ST (ESC \):
          // - OSC: ESC ] ... (Operating System Command)
          // - DCS: ESC P ... (Device Control String)
          // - APC: ESC _ ... (Application Program Command)
          // - PM:  ESC ^ ... (Privacy Message)
          // - SOS: ESC X ... (Start of String)
          charIdx++ // skip the introducer char
          while (charIdx < characters.length - 1) {
            charIdx++
            const c = characters[charIdx]?.value
            // BEL (0x07) terminates the sequence
            if (c === '\x07') {
              break
            }
            // ST (String Terminator) is ESC \
            // When we see ESC, check if next char is backslash
            if (c === '\x1b') {
              const nextC = characters[charIdx + 1]?.value
              if (nextC === '\\') {
                charIdx++ // skip the backslash too
                break
              }
            }
          }
// 剩余的单字符命令。分三个区：
//     0x30-0x3F（Fp）—— ESC 7 保存光标、ESC 8 恢复光标
//     0x40-0x5F（Fe）—— ESC D 索引、ESC M 反向索引、ESC c 复位
//     0x60-0x7E（Fs）—— 少见
//   都只需要往前挪一个字符。
        } else if (
          nextCode !== undefined &&
          nextCode >= 0x30 &&
          nextCode <= 0x7e
        ) {
          // Single-character escape sequences: ESC followed by 0x30-0x7E
          // (excluding the multi-char introducers already handled above)
          // - Fp range (0x30-0x3F): ESC 7 (save cursor), ESC 8 (restore)
          // - Fe range (0x40-0x5F): ESC D (index), ESC M (reverse index)
          // - Fs range (0x60-0x7E): ESC c (reset)
          charIdx++ // skip the command char
        }
      }
// 其余控制字符一律跳过，且**不占列**：
//   CR（0x0D）会把光标拉回行首 —— 跳过，因为我们已经在按 (x, y) 绝对定位
//   BS（0x08）会左移一格 —— 同上
//   BEL / VT / FF —— 跳过
//
//   这里的 `continue` 在 for 循环里，所以这些字符既不写格子也不推进 offsetX。
//   总原则：**凡是会移动光标但不产生字符的字节，都必须吞掉。**
      // Carriage return (0x0D): would move cursor to column 0, skip it
      // Backspace (0x08): would move cursor left, skip it
      // Bell (0x07), vertical tab (0x0B), form feed (0x0C): skip
      // All other control chars (0x00-0x06, 0x0E-0x1F): skip
      // Note: newline (0x0A) is already handled by line splitting
      continue
    }

// 零宽字符（组合记号、ZWNJ、ZWS、变体选择符）不占格子。
//
//   为什么不能「当作窄字符存进去」：终端在渲染组合序列时，
//   基字符和组合记号画在**同一格**。如果我们给组合记号单独分配一格，
//   虚拟光标就比终端多走了一格 —— 后面所有列坐标全部右偏。
//
//   宽度在聚类阶段就算好了（charCache 里），这里只是读。
//   这也是「预计算宽度」最大的收益点：热循环里没有一次 stringWidth 调用。
    // Zero-width characters (combining marks, ZWNJ, ZWS, etc.)
    // don't occupy terminal cells — storing them as Narrow cells
    // desyncs the virtual cursor from the real terminal cursor.
    // Width was computed once during clustering (cached via charCache).
    const charWidth = character.width
    if (charWidth === 0) {
      continue
    }

    const isWideCharacter = charWidth >= 2

// 宽字符落在最后一列：放不下。
//
//   终端的行为是把整个宽字符**折到下一行**（不会只画半格）。
//   如果我们照常写进去，虚拟光标认为占了最后两列，终端却折行了 ——
//   于是光标模型从这一刻起就错了，后面每一行都错位。
//
//   所以这里主动写一个 SpacerHead（占位格，表示「这一列是空的但属于
//   一个放不下的宽字符」），只占一列，与终端的折行行为对齐。
//
//   注意 SpacerHead 不是 SpacerTail：前者是「宽字符的左半被推到下一行了」，
//   后者是「这个宽字符的右半」。两者在 setCellAt 的清理逻辑里
//   有不同处理（见 screen.ts）。
    // Wide char at last column can't fit — terminal would wrap it to
    // the next line, desyncing our cursor model. Place a SpacerHead
    // to mark the blank column, matching terminal behavior.
    if (isWideCharacter && offsetX + 2 > screenWidth) {
      setCellAt(screen, offsetX, y, {
        char: ' ',
        styleId: stylePool.none,
        width: CellWidth.SpacerHead,
        hyperlink: undefined,
      })
      offsetX++
      continue
    }

// 热循环的最后一步：写一格。
//   到这里所有开销大的事情都已经做完了 —— 宽度是读出来的，
//   styleId 是读出来的，超链接是读出来的。这一行只做一次
//   setCellAt 调用（内含一次 hyperlink 的 Map.get）。
//
//   返回 offsetX 而不是返回字符数：调用方要拿它做两件事 ——
//   算 softWrap 的接续列（497 行），以及统计 debug 用的格子数。
//   返回值带着「实际占了多少列」这个语义，比返回长度更有用。
    // styleId + hyperlink were precomputed during clustering (once per
    // style run, cached via charCache). Hot loop is now just property
    // reads — no intern, no extract, no filter per frame.
    setCellAt(screen, offsetX, y, {
      char: character.value,
      styleId: character.styleId,
      width: isWideCharacter ? CellWidth.Wide : CellWidth.Narrow,
      hyperlink: character.hyperlink,
    })
    offsetX += isWideCharacter ? 2 : 1
  }

  return offsetX
}
