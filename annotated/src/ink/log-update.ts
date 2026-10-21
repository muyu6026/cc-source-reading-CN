import {
  type AnsiCode,
  ansiCodesToString,
  diffAnsiCodes,
} from '@alcalzone/ansi-tokenize'
import { logForDebugging } from '../utils/debug.js'
import type { Diff, FlickerReason, Frame } from './frame.js'
import type { Point } from './layout/geometry.js'
import {
  type Cell,
  CellWidth,
  cellAt,
  charInCellAt,
  diffEach,
  type Hyperlink,
  isEmptyCellAt,
  type Screen,
  type StylePool,
  shiftRows,
  visibleCellAtIndex,
} from './screen.js'
import {
  CURSOR_HOME,
  scrollDown as csiScrollDown,
  scrollUp as csiScrollUp,
  RESET_SCROLL_REGION,
  setScrollRegion,
} from './termio/csi.js'
import { LINK_END, link as oscLink } from './termio/osc.js'

// ═══════════════════════════════════════════════════════════════
//  第三层之三：把「两帧的差异」翻成终端字节
// ═══════════════════════════════════════════════════════════════
//
//   上一层（render-node-to-output）已经把这一帧该长什么样写进屏幕缓冲了。
//   这一层负责比较两帧，产出**最小的**转义序列。
//
//   为什么「最少字节」值得单独一层？因为终端是有带宽的：
//   本地终端还好，SSH 或 tmux 里一帧几万字节就会肉眼可见地卡。
//
//   三条策略，按代价从低到高：
//     ① 什么都不发     前一帧和这一帧完全一致（空 diff）
//     ② 硬件滚动       只有 ScrollBox 滚了 → DECSTBM + 光标复位
//     ③ 逐格补丁       其余情况，仅发变化的格子
//   全都做不到时才是 ④ 全量重绘（clearTerminal + 整帧），会有可见闪烁。
//
//   ⚠ 这一层有个贯穿全文的困难：**我们不知道真实光标在哪**。
//   终端不会告诉我们，而所有相对移动都依赖起点。所以下面几乎所有
//   光标操作都配一个「虚拟光标」同步推算 —— 见 752 行的 VirtualScreen。
//
//   State 里只有一个字段（previousOutput），且只在非 TTY 路径用。
//   真正的状态全在参数里传（prev / next 两个 Frame）——
//   这是有意的：把状态做成参数，才不会有「跨帧残留」这类 bug。
type State = {
  previousOutput: string
}

type Options = {
  isTTY: boolean
  stylePool: StylePool
}

const CARRIAGE_RETURN = { type: 'carriageReturn' } as const
const NEWLINE = { type: 'stdout', content: '\n' } as const

// ═══════════════════════════════════════════════════════════════
//  LogUpdate：一帧进，一段转义序列出
// ═══════════════════════════════════════════════════════════════
//
//   对外只有一个 render(prev, next, altScreen, decstbmSafe)。
//   内部的决策树大致是：
//
//     TTY？
//       ├─ 否 → renderFullFrame（整帧拼一个字符串，给管道/日志用）
//       └─ 是 → 视口变小/变窄？
//                 ├─ 是 → fullReset（resize，反正要重排）
//                 └─ 否 → 有硬件滚动便条且安全？
//                           ├─ 是 → 先发 DECSTBM，再走 diff
//                           └─ 否 → 直接 diff
//                         diff 途中发现改到了 scrollback？
//                           └─ 是 → 退回 fullReset
//
//   注意这个「途中发现」—— 它意味着 fullReset 的代价是在循环里被
//   触发的，而不是事先判断的。因为判断需要先扫一遍，而扫一遍和
//   直接 diff 差不多贵。
export class LogUpdate {
  private state: State

  constructor(private readonly options: Options) {
    this.state = {
      previousOutput: '',
    }
  }

// 【名字里带 DEPRECATED 是诚实的做法】
//
//   非 TTY 的「字符串输出」模式已经被移除了（54 行注释），所以这个函数
//   现在只在非 TTY 时返回一个换行。保留它是因为调用点还在，
//   而删掉调用点需要改另一条链路。
//
//   函数名直接把状态写在脸上，比注释更有效 —— 谁想用它，
//   在 IDE 的自动补全列表里就会看到警告。
  renderPreviousOutput_DEPRECATED(prevFrame: Frame): Diff {
    if (!this.options.isTTY) {
      // Non-TTY output is no longer supported (string output was removed)
      return [NEWLINE]
    }
    return this.getRenderOpsForDone(prevFrame)
  }

  // Called when process resumes from suspension (SIGCONT) to prevent clobbering terminal content
  reset(): void {
    this.state.previousOutput = ''
  }

// 【非 TTY：把整帧拼成一整串，一次吐出】
//
//   管道、日志文件、CI 输出都走这里。没有光标定位、没有增量更新 ——
//   因为对面不是终端，没有「屏幕」这个概念，只有字节流。
//
//   两个细节值得注意：
//
//   ① 逐格 diff 样式（86 行 diffAnsiCodes），而不是每格都发完整样式。
//      一行里如果只有开头一个红字，后面全是默认色，那只需要发一次红色
//      加一次复位，而不是每格发一对。
//
//   ② 行尾强制 reset（99-104 行）。因为下面要 trimEnd —— 如果行尾
//      拖着一个未闭合的背景色，trim 掉空格之后那个颜色会带到下一行。
//      先复位再 trim，顺序不能换。
  private renderFullFrame(frame: Frame): Diff {
    const { screen } = frame
    const lines: string[] = []
    let currentStyles: AnsiCode[] = []
    let currentHyperlink: Hyperlink = undefined
    for (let y = 0; y < screen.height; y++) {
      let line = ''
      for (let x = 0; x < screen.width; x++) {
        const cell = cellAt(screen, x, y)
        if (cell && cell.width !== CellWidth.SpacerTail) {
          // Handle hyperlink transitions
          if (cell.hyperlink !== currentHyperlink) {
            if (currentHyperlink !== undefined) {
              line += LINK_END
            }
            if (cell.hyperlink !== undefined) {
              line += oscLink(cell.hyperlink)
            }
            currentHyperlink = cell.hyperlink
          }
          const cellStyles = this.options.stylePool.get(cell.styleId)
          const styleDiff = diffAnsiCodes(currentStyles, cellStyles)
          if (styleDiff.length > 0) {
            line += ansiCodesToString(styleDiff)
            currentStyles = cellStyles
          }
          line += cell.char
        }
      }
// 【关链接必须在复位样式之前】
//
//   OSC 8 的关闭序列是 ESC ] 8 ; ; BEL，它不属于 SGR。
//   如果先发 SGR 复位（0m）再关链接，某些终端会把链接状态带过去 ——
//   表现是「后面的文字也变成了链接」。
//
//   这类「两种转义序列的作用域谁先结束」的顺序问题，
//   在 OSC 和 SGR 混用时会反复出现。
      // Close any open hyperlink before resetting styles
      if (currentHyperlink !== undefined) {
        line += LINK_END
        currentHyperlink = undefined
      }
      // Reset styles at end of line so trimEnd doesn't leave dangling codes
      const resetCodes = diffAnsiCodes(currentStyles, [])
      if (resetCodes.length > 0) {
        line += ansiCodesToString(resetCodes)
        currentStyles = []
      }
      lines.push(line.trimEnd())
    }

    if (lines.length === 0) {
      return []
    }
    return [{ type: 'stdout', content: lines.join('\n') }]
  }

  private getRenderOpsForDone(prev: Frame): Diff {
    this.state.previousOutput = ''

    if (!prev.cursor.visible) {
      return [{ type: 'cursorShow' }]
    }
    return []
  }

// ═══════════════════════════════════════════════════════════════
//  render()：TTY 路径的主入口
// ═══════════════════════════════════════════════════════════════
//
//   七个阶段：
//     142  视口变了 → 直接全量重置（resize 无法增量处理）
//     166  有滚动便条 → 生成 DECSTBM 序列，并原地 shift prev.screen
//     199  判断「上一帧有没有内容滚进 scrollback」
//     250  建虚拟光标
//     259  高度缩小 → 先发清除序列
//     308  逐格 diff，边比边发
//     414  把光标还给调用方指定的位置
//
//   注意 199-248 那一段：**在 diff 之前**先用 diffEach 探一次
//   「有没有改动落在 scrollback 里」。这是「扫描两遍」——
//   但因为第一遍可以在命中第一格时立刻退出，实际代价很小。
  render(
    prev: Frame,
    next: Frame,
    altScreen = false,
    decstbmSafe = true,
  ): Diff {
    if (!this.options.isTTY) {
      return this.renderFullFrame(next)
    }

    const startTime = performance.now()
    const stylePool = this.options.stylePool

    // Since we assume the cursor is at the bottom on the screen, we only need
    // to clear when the viewport gets shorter (i.e. the cursor position drifts)
    // or when it gets thinner (and text wraps). We _could_ figure out how to
    // not reset here but that would involve predicting the current layout
    // _after_ the viewport change which means calcuating text wrapping.
    // Resizing is a rare enough event that it's not practically a big issue.
// 【resize 不能增量处理】
//
//   理由 136-141 行说得很直白：增量更新需要预测「重排之后每一行会变成什么」，
//   而那等于重新算一遍文本换行。
//
//   所以 resize 一律全量。这不是偷懒的判断 —— 它是「这个优化的复杂度
//   远超收益」的判断。终端 resize 是低频事件（用户拖窗口），
//   一帧闪烁可以接受。
//
//   注意条件：高度变小，或者**宽度变了**（prev 宽度为 0 时除外 ——
//   那是首帧，还没有真的宽度可比）。高度变大不需要重置，
//   因为增长走的是「追加新行」的自然路径。
    if (
      next.viewport.height < prev.viewport.height ||
      (prev.viewport.width !== 0 && next.viewport.width !== prev.viewport.width)
    ) {
      return fullResetSequence_CAUSES_FLICKER(next, 'resize', stylePool)
    }

// 【DECSTBM：让终端自己去滚，而不是我们重画每一行】
//
//   做法是：设一个滚动区域（CSI top;bot r），发一个上滚/下滚
//   （CSI n S / CSI n T），然后复位区域。
//
//   但这里有个前提：**prev.screen 必须和终端保持一致**。
//   终端滚了，我们的「上一帧缓冲」没滚，接下来的 diff 会把每一行
//   都判成变了 —— 快路径反而更慢。
//
//   所以 173 行对 prev.screen 调了 shiftRows（原地改内容）。
//   注释 153-154 说的「prev.screen 即将变成 backFrame，复用所以改动安全」
//   是一个**所有权论证**：不是「改了没事」，而是「改完它就要被覆盖了」。
//
//   ⚠ shiftRows 改了 cells 但不更新 damage。这个缺口由 screen.ts 的
//   diffEach 用「prev.damage ∪ next.damage」兜住（见那边的锚点）。
//   两处必须一起读，单独看任何一处都会觉得是 bug。
    // DECSTBM scroll optimization: when a ScrollBox's scrollTop changed,
    // shift content with a hardware scroll (CSI top;bot r + CSI n S/T)
    // instead of rewriting the whole scroll region. The shiftRows on
    // prev.screen simulates the shift so the diff loop below naturally
    // finds only the rows that scrolled IN as diffs. prev.screen is
    // about to become backFrame (reused next render) so mutation is safe.
    // CURSOR_HOME after RESET_SCROLL_REGION is defensive — DECSTBM reset
    // homes cursor per spec but terminal implementations vary.
    //
    // decstbmSafe: caller passes false when the DECSTBM→diff sequence
    // can't be made atomic (no DEC 2026 / BSU/ESU). Without atomicity the
    // outer terminal renders the intermediate state — region scrolled,
    // edge rows not yet painted — a visible vertical jump on every frame
    // where scrollTop moves. Falling through to the diff loop writes all
    // shifted rows: more bytes, no intermediate state. next.screen from
    // render-node-to-output's blit+shift is correct either way.
    let scrollPatch: Diff = []
// 【decstbmSafe：不是「能不能滚」，而是「能不能原子地滚」】
//
//   DECSTBM → 光标复位 → 逐格补丁，这三步在终端里是三次独立操作。
//   如果终端不支持同步输出（DEC 2026 / BSU+ESU），外层就会看到中间态：
//   区域已经滚了，但边缘的几行还没画 —— 于是每帧都有一闪的垂直跳动。
//
//   所以调用方在没有 BSU/ESU 时传 false，这里就**不发** DECSTBM，
//   直接走逐格 diff：字节更多，但没有中间态。
//
//   这是一个明确的「用带宽换无闪烁」的取舍，判据是原子性，不是性能。
//   注意 156-157 行那句：DECSTBM 复位之后**还要发 CURSOR_HOME**，
//   因为规范说复位会把光标移到原点，但各家实现不一。
    if (altScreen && next.scrollHint && decstbmSafe) {
      const { top, bottom, delta } = next.scrollHint
      if (
        top >= 0 &&
        bottom < prev.screen.height &&
        bottom < next.screen.height
      ) {
        shiftRows(prev.screen, top, bottom, delta)
        scrollPatch = [
          {
            type: 'stdout',
            content:
              setScrollRegion(top + 1, bottom + 1) +
              (delta > 0 ? csiScrollUp(delta) : csiScrollDown(-delta)) +
              RESET_SCROLL_REGION +
              CURSOR_HOME,
          },
        ]
      }
    }

// 【只能发相对移动，因为不知道起点】
//
//   终端不会告诉我们光标在哪（DSR 查询要异步往返，代价远高于收益）。
//   所以所有光标定位都是「相对于我刚才推算的位置移动多少」。
//
//   这就是为什么需要一个虚拟光标（VirtualScreen）：每一次移动都
//   同步更新它，下一次移动的 delta 由它算出来。
//
//   唯一的绝对定位是 CHA（设列），只在补偿 emoji 宽度时用（671 行），
//   而且用完之后立刻把虚拟光标也强制对齐。
    // We have to use purely relative operations to manipulate the cursor since
    // we don't know its starting point.
    //
    // When content height >= viewport height AND cursor is at the bottom,
    // the cursor restore at the end of the previous frame caused terminal scroll.
    // viewportY tells us how many rows are in scrollback from content overflow.
    // Additionally, the cursor-restore scroll pushes 1 more row into scrollback.
    // We need fullReset if any changes are to rows that are now in scrollback.
    //
    // This early full-reset check only applies in "steady state" (not growing).
    // For growing, the viewportY calculation below (with cursorRestoreScroll)
    // catches unreachable scrollback rows in the diff loop instead.
// 【这一整套判断都在问同一个问题：上一帧结束时，光标在哪】
//
//   如果内容高度 >= 视口高度且光标停在底部，那上一帧末尾那次
//   「光标归位」会触发终端滚动 —— 有 1 行被推进了 scrollback。
//   scrollback 里的东西**无法用光标移动到达**（往上移不会滚回来）。
//
//   所以后面所有判断都围绕「哪些行已经进了 scrollback」：
//   203 行那个 `>=` 而不是 `>` 就是在覆盖「恰好填满视口」这一格 ——
//   此时末尾的 LF 仍然会滚 1 行。
    const cursorAtBottom = prev.cursor.y >= prev.screen.height
    const isGrowing = next.screen.height > prev.screen.height
    // When content fills the viewport exactly (height == viewport) and the
    // cursor is at the bottom, the cursor-restore LF at the end of the
    // previous frame scrolled 1 row into scrollback. Use >= to catch this.
    const prevHadScrollback =
      cursorAtBottom && prev.screen.height >= prev.viewport.height
    const isShrinking = next.screen.height < prev.screen.height
    const nextFitsViewport = next.screen.height <= prev.viewport.height

    // When shrinking from above-viewport to at-or-below-viewport, content that
    // was in scrollback should now be visible. Terminal clear operations can't
    // bring scrollback content into view, so we need a full reset.
    // Use <= (not <) because even when next height equals viewport height, the
    // scrollback depth from the previous render differs from a fresh render.
// 【从「超出视口」缩到「视口内」必须全量重置】
//
//   直觉上缩小时应该只是清掉下面几行。但当内容原本超出视口时，
//   顶部那些行已经在 scrollback 里了 —— 而终端的清除操作
//   **不能把 scrollback 里的内容拉回视野**。
//
//   于是「缩到视口内」这件事根本无法用增量操作完成：
//   我们需要屏幕顶部出现原来在 scrollback 里的行，而那需要反向滚动，
//   终端的清屏指令做不到。
//
//   213 行那个 `<=` 的注释解释了为什么用小于等于：
//   即使缩完恰好等于视口高度，上一帧的 scrollback 深度也和
//   重新画一遍不一样。
    if (prevHadScrollback && nextFitsViewport && isShrinking) {
      logForDebugging(
        `Full reset (shrink->below): prevHeight=${prev.screen.height}, nextHeight=${next.screen.height}, viewport=${prev.viewport.height}`,
      )
      return fullResetSequence_CAUSES_FLICKER(next, 'offscreen', stylePool)
    }

    if (
      prev.screen.height >= prev.viewport.height &&
      prev.screen.height > 0 &&
      cursorAtBottom &&
      !isGrowing
    ) {
      // viewportY = rows in scrollback from content overflow
      // +1 for the row pushed by cursor-restore scroll
// 【+1 是「光标归位那一行」】
//
//   viewportY 是「内容溢出把多少行挤进了 scrollback」。
//   但上一帧末尾的光标归位如果发的是 LF，还会再多推 1 行 ——
//   所以这里的 scrollback 深度是 viewportY + 1。
//
//   漏掉这 1 行的后果写在 290-291 行：diff 会以为那一行还能写到，
//   但光标在视口顶部就被夹住了，于是实际写入落在上移一行的位置，
//   整块内容错位 —— 看起来像「输出被搅乱了」。
      const viewportY = prev.screen.height - prev.viewport.height
      const scrollbackRows = viewportY + 1

      let scrollbackChangeY = -1
      diffEach(prev.screen, next.screen, (_x, y) => {
        if (y < scrollbackRows) {
          scrollbackChangeY = y
          return true // early exit
        }
      })
      if (scrollbackChangeY >= 0) {
        const prevLine = readLine(prev.screen, scrollbackChangeY)
        const nextLine = readLine(next.screen, scrollbackChangeY)
        return fullResetSequence_CAUSES_FLICKER(next, 'offscreen', stylePool, {
          triggerY: scrollbackChangeY,
          prevLine,
          nextLine,
        })
      }
    }

// 【虚拟光标：从上一帧的光标位置出发】
//
//   起点是 prev.cursor —— 也就是上一帧末尾我们把它留在哪。
//   从那之后每一次移动都由 txn 同步更新（765 行）。
//
//   视口宽度单独传，因为「pending wrap」的判断需要它：
//   cursor.x >= viewportWidth 表示「写满了但还没换行」。
    const screen = new VirtualScreen(prev.cursor, next.viewport.width)

    // Treat empty screen as height 1 to avoid spurious adjustments on first render
    const heightDelta =
      Math.max(next.screen.height, 1) - Math.max(prev.screen.height, 1)
    const shrinking = heightDelta < 0
    const growing = heightDelta > 0

    // Handle shrinking: clear lines from the bottom
// 【高度缩小：clear(N) 之后要往回退一行】
//
//   终端的「清除 N 行」语义是：先把光标上移 N-1 行，然后从那里往下清。
//   所以清完之后光标在新内容的**下一行**（因为上移的是 N-1 而不是 N）。
//
//   279 行补的那个 cursorMove y:-1 就是调整这一行 —— 让它落到
//   next.screen.height - 1，也就是新内容的最后一行。
//
//   不补的后果：后续所有相对移动都多算一行，整块内容上移一行。
//   这类「差一行」的 bug 在终端渲染里反复出现，根源都是
//   「某个操作的副作用把光标挪了，但模型没跟上」。
    if (shrinking) {
      const linesToClear = prev.screen.height - next.screen.height

      // eraseLines only works within the viewport - it can't clear scrollback.
      // If we need to clear more lines than fit in the viewport, some are in
      // scrollback, so we need a full reset.
      if (linesToClear > prev.viewport.height) {
        return fullResetSequence_CAUSES_FLICKER(
          next,
          'offscreen',
          this.options.stylePool,
        )
      }

      // clear(N) moves cursor UP by N-1 lines and to column 0
      // This puts us at line prev.screen.height - N = next.screen.height
      // But we want to be at next.screen.height - 1 (bottom of new screen)
      screen.txn(prev => [
        [
          { type: 'clear', count: linesToClear },
          { type: 'cursorMove', x: 0, y: -1 },
        ],
        { dx: -prev.x, dy: -linesToClear },
      ])
    }

// 【viewportY 的两种算法，按增长/缩小分开】
//
//   增长时：用 prev 的状态。因为新行还没把旧行挤出去 ——
//   终端还没滚，scrollback 深度还是上一帧那个值。
//
//   缩小时：用 max(prev, next)。因为终端的清除操作**不滚动**，
//   所以视口里能容纳的行数取两者较大值（清完之后是从上往下清，
//   腾出来的空间要按原来的高度算）。
//
//   292 行的 cursorRestoreScroll 是那个 +1，和 229 行同一个理由，
//   只是这里用在 diff 循环的坐标换算上。
    // viewportY = number of rows in scrollback (not visible on terminal).
    // For shrinking: use max(prev, next) because terminal clears don't scroll.
    // For growing: use prev state because new rows haven't scrolled old ones yet.
    // When prevHadScrollback, add 1 for the cursor-restore LF that scrolled
    // an additional row out of view at the end of the previous frame. Without
    // this, the diff loop treats that row as reachable — but the cursor clamps
    // at viewport top, causing writes to land 1 row off and garbling the output.
    const cursorRestoreScroll = prevHadScrollback ? 1 : 0
    const viewportY = growing
      ? Math.max(
          0,
          prev.screen.height - prev.viewport.height + cursorRestoreScroll,
        )
      : Math.max(prev.screen.height, next.screen.height) -
        next.viewport.height +
        cursorRestoreScroll

    let currentStyleId = stylePool.none
    let currentHyperlink: Hyperlink = undefined

    // First pass: render changes to existing rows (rows < prev.screen.height)
    let needsFullReset = false
    let resetTriggerY = -1
// 【diff 主循环：六种情况里只有两种真的写字节】
//
//   跳过：
//     310  增长时的新行（另有专门路径）
//     318  占位格（SpacerTail/Head）—— 终端画宽字符时自己会前进两列
//     326  被删掉的占位格（没有对应新增）
//     339  空的且没被删的格子 —— 写空格会让行尾有多余空白，
//          可能在屏幕右边缘触发意外的折行
//
//   处理：
//     345  落在 scrollback 里 → 放弃，全量重置
//     351  正常：移动光标 + 写字符（或写空格擦除）
//
//   注意 318 行那句注释是本层最容易误解的一条：跳过占位格不是优化，
//   是**必需**的。写了的话光标会多前进一列，之后所有位置都偏一格。
    diffEach(prev.screen, next.screen, (x, y, removed, added) => {
      // Skip new rows - we'll render them directly after
      if (growing && y >= prev.screen.height) {
        return
      }

      // Skip spacers during rendering because the terminal will automatically
      // advance 2 columns when we write the wide character itself.
      // SpacerTail: Second cell of a wide character
      // SpacerHead: Marks line-end position where wide char wraps to next line
      if (
        added &&
        (added.width === CellWidth.SpacerTail ||
          added.width === CellWidth.SpacerHead)
      ) {
        return
      }

      if (
        removed &&
        (removed.width === CellWidth.SpacerTail ||
          removed.width === CellWidth.SpacerHead) &&
        !added
      ) {
        return
      }

      // Skip empty cells that don't need to overwrite existing content.
      // This prevents writing trailing spaces that would cause unnecessary
      // line wrapping at the edge of the screen.
      // Uses isEmptyCellAt to check if both packed words are zero (empty cell).
      if (added && isEmptyCellAt(next.screen, x, y) && !removed) {
        return
      }

      // If the cell outside the viewport range has changed, we need to reset
      // because we can't move the cursor there to draw.
// 【发现改到 scrollback 就立刻放弃】
//
//   回调返回 true 让 diffEach 提前退出（它的返回值语义就是这个）。
//   然后整帧走 fullReset。
//
//   为什么不能在循环里「跳过这一格」？因为那意味着终端上还有一个
//   错误的旧字符留在 scrollback 里 —— 用户往回翻历史时会看到它。
//   正确性优先，所以宁可直接重画。
      if (y < viewportY) {
        needsFullReset = true
        resetTriggerY = y
        return true // early exit
      }

      moveCursorTo(screen, x, y)

      if (added) {
        const targetHyperlink = added.hyperlink
        currentHyperlink = transitionHyperlink(
          screen.diff,
          currentHyperlink,
          targetHyperlink,
        )
        const styleStr = stylePool.transition(currentStyleId, added.styleId)
        if (writeCellWithStyleStr(screen, added, styleStr)) {
          currentStyleId = added.styleId
        }
// 【删除一个格子：先复位样式，再写空格】
//
//   如果当前是红底，直接写空格会用红底擦 —— 看起来像一根红线，
//   而不是「这里什么都没有」。
//
//   所以先把样式和链接都复位，再写一个**无样式的空格**。
//
//   注意这里用 screen.txn 包起来（373 行）：三个操作（复位样式、
//   复位链接、写空格）必须作为一个整体推进虚拟光标，
//   而 txn 的 delta 是 {dx:1, dy:0} —— 只前进一列。
      } else if (removed) {
        // Cell was removed - clear it with a space
        // (This handles shrinking content)
        // Reset any active styles/hyperlinks first to avoid leaking into cleared cells
        const styleIdToReset = currentStyleId
        const hyperlinkToReset = currentHyperlink
        currentStyleId = stylePool.none
        currentHyperlink = undefined

        screen.txn(() => {
          const patches: Diff = []
          transitionStyle(patches, stylePool, styleIdToReset, stylePool.none)
          transitionHyperlink(patches, hyperlinkToReset, undefined)
          patches.push({ type: 'stdout', content: ' ' })
          return [patches, { dx: 1, dy: 0 }]
        })
      }
    })
    if (needsFullReset) {
      return fullResetSequence_CAUSES_FLICKER(next, 'offscreen', stylePool, {
        triggerY: resetTriggerY,
        prevLine: readLine(prev.screen, resetTriggerY),
        nextLine: readLine(next.screen, resetTriggerY),
      })
    }

    // Reset styles before rendering new rows (they'll set their own styles)
    currentStyleId = transitionStyle(
      screen.diff,
      stylePool,
      currentStyleId,
      stylePool.none,
    )
    currentHyperlink = transitionHyperlink(
      screen.diff,
      currentHyperlink,
      undefined,
    )

    // Handle growth: render new rows directly (they naturally scroll the terminal)
    if (growing) {
      renderFrameSlice(
        screen,
        next,
        prev.screen.height,
        next.screen.height,
        stylePool,
      )
    }

// 【alt 屏不恢复光标，因为下一帧会重新锚定】
//
//   主屏：光标位置有意义（用户的 shell 提示符在下面），必须还给调用方。
//   alt 屏：光标是隐藏的，位置只作为下一帧相对移动的起点，
//   而下一帧开头一律发 CSI H 归位（ink.tsx 的 onRender）——
//   所以这里恢复不恢复都无所谓。
//
//   注释里算了收益：省一次 CR + 一次光标移动，约 6-10 字节/帧。
//   60 帧/秒就是 600 字节/秒。数值不大，但这是「每帧都发」的量级，
//   而且省掉的是纯粹的浪费。
    // Restore cursor. Skipped in alt-screen: the cursor is hidden, its
    // position only matters as the starting point for the NEXT frame's
    // relative moves, and in alt-screen the next frame always begins with
    // CSI H (see ink.tsx onRender) which resets to (0,0) regardless. This
    // saves a CR + cursorMove round-trip (~6-10 bytes) every frame.
    //
    // Main screen: if cursor needs to be past the last line of content
    // (typical: cursor.y = screen.height), emit \n to create that line
    // since cursor movement can't create new lines.
    if (altScreen) {
      // no-op; next frame's CSI H anchors cursor
// 【光标要在内容下方：只能靠发换行来创建那一行】
//
//   典型场景：屏幕上有 5 行内容，但光标要停在第 6 行（提示框位置）。
//   光标移动做不到 —— 第 6 行还不存在。只有 LF 能让终端滚出新行。
//
//   430 行那个 CR 是「先消化 pending wrap」：如果光标正处在
//   「写满一行等换行」的状态，直接发 LF 会多跳一行。CR 把这个状态
//   清掉，且不换行（回到列 0）。
//
//   这个细节在处理「宽度恰好的整行输出」时才会暴露 ——
//   那种行的最后一格写完之后，光标其实已经越界了（x === width）。
    } else if (next.cursor.y >= next.screen.height) {
      // Move to column 0 of current line, then emit newlines to reach target row
      screen.txn(prev => {
        const rowsToCreate = next.cursor.y - prev.y
        if (rowsToCreate > 0) {
          // Use CR to resolve pending wrap (if any) without advancing
          // to the next line, then LF to create each new row.
          const patches: Diff = new Array<Diff[number]>(1 + rowsToCreate)
          patches[0] = CARRIAGE_RETURN
          for (let i = 0; i < rowsToCreate; i++) {
            patches[1 + i] = NEWLINE
          }
          return [patches, { dx: -prev.x, dy: rowsToCreate }]
        }
        // At or past target row - need to move cursor to correct position
        const dy = next.cursor.y - prev.y
        if (dy !== 0 || prev.x !== next.cursor.x) {
          // Use CR to clear pending wrap (if any), then cursor move
          const patches: Diff = [CARRIAGE_RETURN]
          patches.push({ type: 'cursorMove', x: next.cursor.x, y: dy })
          return [patches, { dx: next.cursor.x - prev.x, dy }]
        }
        return [[], { dx: 0, dy: 0 }]
      })
    } else {
      moveCursorTo(screen, next.cursor.x, next.cursor.y)
    }

    const elapsed = performance.now() - startTime
    if (elapsed > 50) {
      const damage = next.screen.damage
      const damageInfo = damage
        ? `${damage.width}x${damage.height} at (${damage.x},${damage.y})`
        : 'none'
      logForDebugging(
        `Slow render: ${elapsed.toFixed(1)}ms, screen: ${next.screen.height}x${next.screen.width}, damage: ${damageInfo}, changes: ${screen.diff.length}`,
      )
    }

    return scrollPatch.length > 0
      ? [...scrollPatch, ...screen.diff]
      : screen.diff
  }
}

// 【超链接的转移：用一个哨兵表示「关闭」】
//
//   Diff 里推的是 { type:'hyperlink', uri: '' }，空串表示关闭。
//   不用 null/undefined，因为 Diff 这层是「纯数据」——
//   它要能被序列化、能被日志打印，undefined 在展开时会消失。
//
//   470 行这个函数同时干两件事：比较 + 推送。调用方都是
//   `currentHyperlink = transitionHyperlink(diff, currentHyperlink, target)`
//   这种形式，赋值和副作用绑在一行里。
function transitionHyperlink(
  diff: Diff,
  current: Hyperlink,
  target: Hyperlink,
): Hyperlink {
  if (current !== target) {
    diff.push({ type: 'hyperlink', uri: target ?? '' })
    return target
  }
  return current
}

function transitionStyle(
  diff: Diff,
  stylePool: StylePool,
  currentId: number,
  targetId: number,
): number {
  const str = stylePool.transition(currentId, targetId)
  if (str.length > 0) {
    diff.push({ type: 'styleStr', str })
  }
  return targetId
}

// 只在 fullReset 的 debug 路径用（记录触发行的前后内容）。
// 每格调一次 charInCellAt，是 O(width) —— 但只有出问题需要归因时才跑。
function readLine(screen: Screen, y: number): string {
  let line = ''
  for (let x = 0; x < screen.width; x++) {
    line += charInCellAt(screen, x, y) ?? ' '
  }
  return line.trimEnd()
}

// 【函数名就是警告】
//
//   fullResetSequence_CAUSES_FLICKER —— 把代价写在名字里，
//   让每个调用点都无法假装不知道。全文件有四处调用，每一处
//   都在注释里解释了「为什么这次非重置不可」：
//
//     146  resize
//     218  从 scrollback 缩回视口
//     242  改动落在 scrollback 里
//     266  要清的行数超过视口高度
//
//   这个命名策略值得学：**当某个操作有不可避免的副作用时，
//   把副作用写进名字**，比写注释更难被忽略。
function fullResetSequence_CAUSES_FLICKER(
  frame: Frame,
  reason: FlickerReason,
  stylePool: StylePool,
  debug?: { triggerY: number; prevLine: string; nextLine: string },
): Diff {
  // After clearTerminal, cursor is at (0, 0)
  const screen = new VirtualScreen({ x: 0, y: 0 }, frame.viewport.width)
  renderFrame(screen, frame, stylePool)
  return [{ type: 'clearTerminal', reason, debug }, ...screen.diff]
}

// 全量重绘就是「从第 0 行画到第 h 行」。
function renderFrame(
  screen: VirtualScreen,
  frame: Frame,
  stylePool: StylePool,
): void {
  renderFrameSlice(screen, frame, 0, frame.screen.height, stylePool)
}

/**
 * Render a slice of rows from the frame's screen.
 * Each row is rendered followed by a newline. Cursor ends at (0, endY).
 */
// ═══════════════════════════════════════════════════════════════
//  renderFrameSlice：画一段连续的行
// ═══════════════════════════════════════════════════════════════
//
//   两个调用方，语义不同：
//     全量重绘   startY=0, endY=height
//     增长追加   startY=prev.height, endY=next.height
//
//   后者是「新行自然滚动终端」的路径：光标本就在旧内容下方，
//   一路 LF 下去，终端自己会把旧行推出视口。
//
//   每行结束都发 CR+LF（615 行），所以这个函数返回时
//   光标恒在 (0, endY) —— 调用方可以直接依赖这个后置条件。
function renderFrameSlice(
  screen: VirtualScreen,
  frame: Frame,
  startY: number,
  endY: number,
  stylePool: StylePool,
): VirtualScreen {
  let currentStyleId = stylePool.none
  let currentHyperlink: Hyperlink = undefined
  // Track the styleId of the last rendered cell on this line (-1 if none).
  // Passed to visibleCellAtIndex to enable fg-only space optimization.
  let lastRenderedStyleId = -1

  const { width: screenWidth, cells, charPool, hyperlinkPool } = frame.screen

  let index = startY * screenWidth
  for (let y = startY; y < endY; y += 1) {
// 【推进行必须用 LF，不能用 CSI CUD】
//
//   CUD（cursor down）在视口底边**会停住且不滚动** —— 这是规范规定的，
//   它只移动光标，不改变内容。而 LF 会滚动。
//
//   用 CUD 的后果：光标已经到底了，再要求它往下走，它不动 ——
//   而虚拟光标以为它动了。于是虚拟和真实光标永久差一行，
//   之后每一帧的画都错位。
//
//   这是全文件最典型的「虚拟模型必须知道真实终端的行为」的例子：
//   两个操作在虚拟模型里都是 +1 行，但真实终端里一个会滚一个不会。
    // Advance cursor to this row using LF (not CSI CUD / cursor-down).
    // CSI CUD stops at the viewport bottom margin and cannot scroll,
    // but LF scrolls the viewport to create new lines. Without this,
    // when the cursor is at the viewport bottom, moveCursorTo's
    // cursor-down silently fails, creating a permanent off-by-one
    // between the virtual cursor and the real terminal cursor.
    if (screen.cursor.y < y) {
      const rowsToAdvance = y - screen.cursor.y
      screen.txn(prev => {
        const patches: Diff = new Array<Diff[number]>(1 + rowsToAdvance)
        patches[0] = CARRIAGE_RETURN
        for (let i = 0; i < rowsToAdvance; i++) {
          patches[1 + i] = NEWLINE
        }
        return [patches, { dx: -prev.x, dy: rowsToAdvance }]
      })
    }
    // Reset at start of each line — no cell rendered yet
    lastRenderedStyleId = -1

    for (let x = 0; x < screenWidth; x += 1, index += 1) {
      // Skip spacers, unstyled empty cells, and fg-only styled spaces that
      // match the last rendered style (since cursor-forward produces identical
      // visual result). visibleCellAtIndex handles the optimization internally
      // to avoid allocating Cell objects for skipped cells.
      const cell = visibleCellAtIndex(
        cells,
        charPool,
        hyperlinkPool,
        index,
        lastRenderedStyleId,
      )
      if (!cell) {
        continue
      }

      moveCursorTo(screen, x, y)

      // Handle hyperlink
      const targetHyperlink = cell.hyperlink
      currentHyperlink = transitionHyperlink(
        screen.diff,
        currentHyperlink,
        targetHyperlink,
      )

      // Style transition — cached string, zero allocations after warmup
      const styleStr = stylePool.transition(currentStyleId, cell.styleId)
      if (writeCellWithStyleStr(screen, cell, styleStr)) {
        currentStyleId = cell.styleId
        lastRenderedStyleId = cell.styleId
      }
    }
// 【行尾必须显式复位，因为不再写尾部空格了】
//
//   以前的实现靠「把整行用空格填满」来隐式复位样式 ——
//   最后那些空格是无样式的，写完之后终端状态自然干净了。
//
//   但现在（569 行的 visibleCellAtIndex）会跳过空单元格，
//   所以行尾可能是「一个还没闭合的背景色」。
//   如果直接换行，终端的滚动会把那个背景色涂到新行上。
//
//   ⚠ 这类「优化掉某个操作之后，它原来承担的副作用暴露出来」的问题，
//   是重构增量代码时最容易被漏掉的一类。
    // Reset styles/hyperlinks before newline so background color doesn't
    // bleed into the next line when the terminal scrolls. The old code
    // reset implicitly by writing trailing unstyled spaces; now that we
    // skip empty cells, we must reset explicitly.
    currentStyleId = transitionStyle(
      screen.diff,
      stylePool,
      currentStyleId,
      stylePool.none,
    )
    currentHyperlink = transitionHyperlink(
      screen.diff,
      currentHyperlink,
      undefined,
    )
// 【CR + LF，一个都不能少】
//
//   因为跳过了行尾空格，光标可能停在行中间的某列。
//   只发 LF 的话，下一行会从**同一列**开始 —— 整块内容变成斜的。
//
//   CR 回到列 0，LF 下行。两个字节，每行都要。
//
//   代价算过：一屏 60 行 = 120 字节/帧。相对于省掉的
//   「用空格填满整行」（60 行 × 200 列 = 12,000 字节），
//   这个交换非常划算。
    // CR+LF at end of row — \r resets to column 0, \n moves to next line.
    // Without \r, the terminal cursor stays at whatever column content ended
    // (since we skip trailing spaces, this can be mid-row).
    screen.txn(prev => [[CARRIAGE_RETURN, NEWLINE], { dx: -prev.x, dy: 1 }])
  }

  // Reset any open style/hyperlink at end of slice
  transitionStyle(screen.diff, stylePool, currentStyleId, stylePool.none)
  transitionHyperlink(screen.diff, currentHyperlink, undefined)

  return screen
}

type Delta = { dx: number; dy: number }

/**
 * Write a cell with a pre-serialized style transition string (from
 * StylePool.transition). Inlines the txn logic to avoid closure/tuple/delta
 * allocations on every cell.
 *
 * Returns true if the cell was written, false if skipped (wide char at
 * viewport edge). Callers MUST gate currentStyleId updates on this — when
 * skipped, styleStr is never pushed and the terminal's style state is
 * unchanged. Updating the virtual tracker anyway desyncs it from the
 * terminal, and the next transition is computed from phantom state.
 */
// ═══════════════════════════════════════════════════════════════
//  writeCellWithStyleStr：写一格，并返回「到底写了没有」
// ═══════════════════════════════════════════════════════════════
//
//   返回值不是「成功/失败」，而是「**终端的状态变了没有**」。
//
//   唯一的 false 分支是「宽字符会跨过视口右边」—— 此时直接放弃，
//   什么都不发。而调用方拿到 false 时**必须不要更新 currentStyleId**：
//   因为 styleStr 根本没推入 diff，终端的样式还停在旧值。
//   如果虚拟追踪器单方面改成新值，下一次 transition 就会从
//   幻影状态算起 —— 差一个样式，整行颜色错。
//
//   637 行那句 "Callers MUST gate currentStyleId updates on this"
//   就是这个契约的正式表述。这是「返回值携带信息而非状态」的典型：
//   它告诉你的不是「失败」，而是「不要记账」。
function writeCellWithStyleStr(
  screen: VirtualScreen,
  cell: Cell,
  styleStr: string,
): boolean {
// SpacerTail 从来不会被写（visibleCellAtIndex 已经过滤了），
// 所以这里只可能是 Wide 或 Narrow。
// Wide 占两列，Narrow 占一列 —— 这就是光标要前进的量。
  const cellWidth = cell.width === CellWidth.Wide ? 2 : 1
  const px = screen.cursor.x
  const vw = screen.viewportWidth

  // Don't write wide chars that would cross the viewport edge.
  // Single-codepoint chars (CJK) at vw-2 are safe; multi-codepoint
  // graphemes (flags, ZWJ emoji) need stricter threshold.
// 【宽字符越界：两个阈值，因为两类 grapheme 的宽度确定性不同】
//
//   单码点（汉字）：wcwidth 说 2 就是 2，任何现代终端都一致。
//   所以在 vw-2 位置（占最后两列）是安全的。
//
//   多码点（国旗、ZWJ emoji、带 VS16 的符号）：宽度取决于终端的
//   grapheme 分段实现。有些按 2 算，有些按「基字符 1 + 修饰 0」算 1。
//   所以阈值收紧一列 —— 宁可少写一个 emoji，也不让光标模型失步。
//
//   651 行 `cell.char.length > 2` 是判据：单码点在 JS 里长度 1 或 2
//   （代理对），多码点必然 > 2。
  if (cellWidth === 2 && px < vw) {
    const threshold = cell.char.length > 2 ? vw : vw + 1
    if (px + 2 >= threshold) {
      return false
    }
  }

  const diff = screen.diff
  if (styleStr.length > 0) {
    diff.push({ type: 'styleStr', str: styleStr })
  }

// 【补偿的逻辑：先在右边写个空格，再把光标钉死】
//
//   问题：老终端的 wcwidth 表里，某些 emoji 只算 1 列。写下去之后
//   它只前进 1 列，而我们的模型认为前进了 2 列 —— 于是下一格写在
//   错误的位置，右边也空出一列没擦。
//
//   对策（分三步）：
//     ① 用绝对列定位（CHA）跳到右边那一格，写个空格
//        —— 正确终端上这个空格会被宽字符覆盖，无副作用；
//           错误终端上它填住了那个空隙（带 emoji 的背景色）
//     ② 回到原位，写 emoji
//     ③ 再用 CHA 把光标强制定到「emoji 之后两列」
//
//   第二步的 CHA 是关键：它让虚拟光标和真实光标**强制对齐**，
//   不管终端认为那个 emoji 多宽。代价是每遇到一个补偿 emoji
//   多发十几字节 —— 所以只对确实有风险的那两类做（723 行）。
  const needsCompensation = cellWidth === 2 && needsWidthCompensation(cell.char)

  // On terminals with old wcwidth tables, a compensated emoji only advances
  // the cursor 1 column, so the CHA below skips column x+1 without painting
  // it. Write a styled space there first — on correct terminals the emoji
  // glyph (width 2) overwrites it harmlessly; on old terminals it fills the
  // gap with the emoji's background. Also clears any stale content at x+1.
  // CHA is 1-based, so column px+1 (0-based) is CHA target px+2.
  if (needsCompensation && px + 1 < vw) {
    diff.push({ type: 'cursorTo', col: px + 2 })
    diff.push({ type: 'stdout', content: ' ' })
    diff.push({ type: 'cursorTo', col: px + 1 })
  }

  diff.push({ type: 'stdout', content: cell.char })

  // Force terminal cursor to correct column after the emoji.
  if (needsCompensation) {
    diff.push({ type: 'cursorTo', col: px + cellWidth + 1 })
  }

  // Update cursor — mutate in place to avoid Point allocation
  if (px >= vw) {
    screen.cursor.x = cellWidth
    screen.cursor.y++
  } else {
    screen.cursor.x = px + cellWidth
  }
  return true
}

// 【moveCursorTo：三种情况，区别只在「要不要先发 CR」】
//
//   pending wrap（x >= 宽度）：光标在「写满了但没换行」的状态
//     任何写操作都会先触发换行 → 必须先 CR 把它消化掉
//   换行（dy !== 0）：先 CR 回列 0，再做相对移动
//   同行（dy === 0）：直接发移动
//
//   第一种情况是最容易漏的。终端有个延迟换行机制（DEC 的「pending wrap」）：
//   写到最后一列时光标不立即换行，等下一个字符到来才换。
//   此时 cursor.x === width（越界了），而屏幕上还在最后一行。
//
//   不做这个判断的话，后面所有「前进 N 列」的移动都会多算一行。
function moveCursorTo(screen: VirtualScreen, targetX: number, targetY: number) {
  screen.txn(prev => {
    const dx = targetX - prev.x
    const dy = targetY - prev.y
    const inPendingWrap = prev.x >= screen.viewportWidth

    // If we're in pending wrap state (cursor.x >= width), use CR
    // to reset to column 0 on the current line without advancing
    // to the next line, then issue the cursor movement.
    if (inPendingWrap) {
      return [
        [CARRIAGE_RETURN, { type: 'cursorMove', x: targetX, y: dy }],
        { dx, dy },
      ]
    }

    // When moving to a different line, use carriage return (\r) to reset to
    // column 0 first, then cursor move.
    if (dy !== 0) {
      return [
        [CARRIAGE_RETURN, { type: 'cursorMove', x: targetX, y: dy }],
        { dx, dy },
      ]
    }

    // Standard same-line cursor move
    return [[{ type: 'cursorMove', x: dx, y: dy }], { dx, dy }]
  })
}

// 【哪两类 emoji 需要补偿】
//
//   ① U+1FA70–U+1FAFF、U+1FB00–U+1FBFF：Unicode 12-15 才加进来的符号。
//      终端的 wcwidth 表往往是老版本（手写码表，更新很慢），
//      这些码点根本没记录，默认按 1 列算。
//
//   ② 带 VS16（U+FE0F）的「默认文本型」emoji：⚔️ ☠️ ❤️。
//      基码点在 wcwidth 里是 1 列（因为它本来是文字符号），
//      但 VS16 要求按 emoji 呈现，此时视觉宽度是 2。
//      这是规范本身的裂缝，终端实现不统一。
//
//   744 行那个循环只看 length >= 2 的字符（单 BMP 字符不可能是
//   grapheme 簇），且注释确认了 VS16 不会和代理对区间冲突。
//
//   补偿是幂等的：在宽度算对的终端上，那次 CHA 只是个无害的空操作。
//   所以不需要检测终端类型 —— 宁可多发几个字节。
/**
 * Identify emoji where the terminal's wcwidth may disagree with Unicode.
 * On terminals with correct tables, the CHA we emit is a harmless no-op.
 *
 * Two categories:
 * 1. Newer emoji (Unicode 12.0+) missing from terminal wcwidth tables.
 * 2. Text-by-default emoji + VS16 (U+FE0F): the base codepoint is width 1
 *    in wcwidth, but VS16 triggers emoji presentation making it width 2.
 *    Examples: ⚔️ (U+2694), ☠️ (U+2620), ❤️ (U+2764).
 */
function needsWidthCompensation(char: string): boolean {
  const cp = char.codePointAt(0)
  if (cp === undefined) return false
  // U+1FA70-U+1FAFF: Symbols and Pictographs Extended-A (Unicode 12.0-15.0)
  // U+1FB00-U+1FBFF: Symbols for Legacy Computing (Unicode 13.0)
  if ((cp >= 0x1fa70 && cp <= 0x1faff) || (cp >= 0x1fb00 && cp <= 0x1fbff)) {
    return true
  }
  // Text-by-default emoji with VS16: scan for U+FE0F in multi-codepoint
  // graphemes. Single BMP chars (length 1) and surrogate pairs without VS16
  // skip this check. VS16 (0xFE0F) can't collide with surrogates (0xD800-0xDFFF).
  if (char.length >= 2) {
    for (let i = 0; i < char.length; i++) {
      if (char.charCodeAt(i) === 0xfe0f) return true
    }
  }
  return false
}

// ═══════════════════════════════════════════════════════════════
//  VirtualScreen：一个只有两个字段的光标模型
// ═══════════════════════════════════════════════════════════════
//
//   存在的唯一理由：终端不告诉我们光标在哪，所有移动都是相对的。
//   所以每次移动都必须自己记账。
//
//   txn(fn) 的契约：
//     输入  当前光标
//     输出  [要发的补丁, 光标变化量]
//   然后把补丁推入 diff、把 delta 加到光标上。
//
//   为什么要「返回 delta」而不是「让 fn 自己改 cursor」？
//   因为改完之后还得知道改了多少，才能算下一次的相对移动。
//   让 fn 声明 delta，调用点就不可能忘记更新。
//
//   753 行注释说明了为什么 cursor 是 public：writeCellWithStyleStr
//   里直接改（683-689 行），绕开 txn 是为了省一次闭包 + 元组分配。
//   这是个明确的性能例外，代价是那两个字段的状态只能靠人工保证一致。
class VirtualScreen {
  // Public for direct mutation by writeCellWithStyleStr (avoids txn overhead).
  // File-private class — not exposed outside log-update.ts.
  cursor: Point
  diff: Diff = []

  constructor(
    origin: Point,
    readonly viewportWidth: number,
  ) {
    this.cursor = { ...origin }
  }

// txn 的实现只有五行，但这个模式撑起了整个文件：
// 每一个光标操作都走这里，于是「虚拟光标」永远不会漏更新。
//
// 代价是每次调用一个闭包 + 一个元组分配。所以最热的路径
// （writeCellWithStyleStr）绕过了它 —— 那是文件里唯一的不受控写入点。
  txn(fn: (prev: Point) => [patches: Diff, next: Delta]): void {
    const [patches, next] = fn(this.cursor)
    for (const patch of patches) {
      this.diff.push(patch)
    }
    this.cursor.x += next.dx
    this.cursor.y += next.dy
  }
}
