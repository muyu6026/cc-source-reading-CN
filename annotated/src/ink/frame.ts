// ═══════════════════════════════════════════════════════════════
//  frame：整个渲染器的**数据契约**
// ═══════════════════════════════════════════════════════════════
//
//  这份文件没有逻辑（除了两个小函数），但它是理解「一帧掉进黑洞时
//  该看哪里」的地图：
//
//    DOM 树 ──renderNodeToOutput──▶  Screen（格子）──log-update──▶ Diff
//                                                      ──optimize──▶ Diff
//                                                      ──writeDiffToTerminal──▶ 字节
//
//  `Frame` 是这条链中间那个「交给下一帧做对比」的快照；
//  `Patch` 是「终端能做的最小原子操作」的枚举 —— 注意它**不是**
//  「屏幕上发生了什么」，而是「要发什么命令」。这个区别很关键：
//  同一个视觉变化可能有不同的 patch 表达（全量重画 vs 局部改），
//  而 log-update 的难度正是「在等价表达里挑最省的那个」。
import type { Cursor } from './cursor.js'
import type { Size } from './layout/geometry.js'
import type { ScrollHint } from './render-node-to-output.js'
import {
  type CharPool,
  createScreen,
  type HyperlinkPool,
  type Screen,
  type StylePool,
} from './screen.js'

// 一帧 = 屏幕缓冲 + 视口 + 光标，全是 readonly。
// 不变性由约定维持（没人去改它），不是由类型强制 —— 但 readonly
// 至少让「想改它」的地方必须显式绕开。
//
// `scrollHint` / `scrollDrainPending` 是可选的：主屏用不上，
// 只有 alt-screen 的 ScrollBox 路径会填。
export type Frame = {
  readonly screen: Screen
  readonly viewport: Size
  readonly cursor: Cursor
  /** DECSTBM scroll optimization hint (alt-screen only, null otherwise). */
  readonly scrollHint?: ScrollHint | null
  /** A ScrollBox has remaining pendingScrollDelta — schedule another frame. */
  readonly scrollDrainPending?: boolean
}

// 空帧。注意 screen 是 **0×0**，不是 viewport 大小。
//
// 这不是省内存，是语义：还没渲染过就没有内容，0 高表示「什么都没有」。
// 如果这里给 rows×cols 的空白屏，首帧的 diff 会以为「上一帧是满屏空白」，
// 于是算出「要把整屏擦干净」的结论 —— 多一轮无谓的全量重绘。
export function emptyFrame(
  rows: number,
  columns: number,
  stylePool: StylePool,
  charPool: CharPool,
  hyperlinkPool: HyperlinkPool,
): Frame {
  return {
    screen: createScreen(0, 0, stylePool, charPool, hyperlinkPool),
    viewport: { width: columns, height: rows },
    cursor: { x: 0, y: 0, visible: true },
  }
}

// 三种清屏理由。它们是给**日志和归因**用的，不是给决策用的 ——
// 决策在 log-update 里靠具体条件判断，这里只是把结论标个名字。
//
// 名字本身有信息量：`resize`（视口变了）、`offscreen`（内容溢出视口）、
// `clear`（主动清）。第三种在 log-update 里对应 setClearOnExit 之类的
// 显式请求。
export type FlickerReason = 'resize' | 'offscreen' | 'clear'

export type FrameEvent = {
  durationMs: number
  /** Phase breakdown in ms + patch count. Populated when the ink instance
   *  has frame-timing instrumentation enabled (via onFrame wiring). */
// 分阶段耗时。这组字段的价值不在「看总耗时」，而在**定位是哪一段慢**：
//   renderer 高 → yoga 或画格子
//   diff 高     → 屏幕比较（cell 数 × 帧率）
//   optimize 高 → patch 特别碎
//   write 高    → 序列化或 stdout 背压
//
// 后面那几个 yoga 相关字段（yogaVisited / yogaMeasured / yogaCacheHits /
// yogaLive）是一组「诊断计数器」，其中 `yogaLive` 尤其值得看 ——
// 它是「创建数减释放数」，只增不减就是泄漏。
  phases?: {
    /** createRenderer output: DOM → yoga layout → screen buffer */
    renderer: number
    /** LogUpdate.render(): screen diff → Patch[] (the hot path this PR optimizes) */
    diff: number
    /** optimize(): patch merge/dedupe */
    optimize: number
    /** writeDiffToTerminal(): serialize patches → ANSI → stdout */
    write: number
    /** Pre-optimize patch count (proxy for how much changed this frame) */
    patches: number
    /** yoga calculateLayout() time (runs in resetAfterCommit, before onRender) */
    yoga: number
    /** React reconcile time: scrollMutated → resetAfterCommit. 0 if no commit. */
    commit: number
    /** layoutNode() calls this frame (recursive, includes cache-hit returns) */
    yogaVisited: number
    /** measureFunc (text wrap/width) calls — the expensive part */
    yogaMeasured: number
    /** early returns via _hasL single-slot cache */
    yogaCacheHits: number
    /** total yoga Node instances alive (create - free). Growth = leak. */
    yogaLive: number
  }
  flickers: Array<{
    desiredHeight: number
    availableHeight: number
    reason: FlickerReason
  }>
}

// 十一种 patch。挑几个容易误解的说：
//
//   `clear`        删 N 行（`eraseLines`），不是「清屏」。清屏是
//                  `clearTerminal`，两者不可混用。
//   `cursorTo`     绝对列定位（`CSI n G`），只动列不动行 —— 因为
//                  log-update 的模型是「行由换行推进、列由它归位」。
//   `carriageReturn` 单发一个 CR。有它是因为「回行首」和「移到第 0 列」
//                  在语义上一样但字节数不同（1 vs 4），热路径上省这三个字节。
//   `styleStr`     已经序列化好的转义串，由 StylePool 缓存 —— 所以
//                  这里存的是字符串而不是样式对象，patch 层完全不认识样式。
//   `hyperlink`    只存 uri，开/关的序列在 terminal.ts 里生成。
export type Patch =
  | { type: 'stdout'; content: string }
  | { type: 'clear'; count: number }
  | {
      type: 'clearTerminal'
      reason: FlickerReason
      // Populated by log-update when a scrollback diff triggers the reset.
      // ink.tsx uses triggerY with findOwnerChainAtRow to attribute the
      // flicker to its source React component.
      debug?: { triggerY: number; prevLine: string; nextLine: string }
    }
  | { type: 'cursorHide' }
  | { type: 'cursorShow' }
  | { type: 'cursorMove'; x: number; y: number }
  | { type: 'cursorTo'; col: number }
  | { type: 'carriageReturn' }
  | { type: 'hyperlink'; uri: string }
  // Pre-serialized style transition string from StylePool.transition() —
  // cached by (fromId, toId), zero allocations after warmup.
  | { type: 'styleStr'; str: string }

export type Diff = Patch[]

// ⚠️ 这个函数**全仓库零读者**。
//
// grep `shouldClearScreen` 只有两处命中：这里定义，和
// `renderer.ts:153` 的一句注释。真正的清屏判据已经在
// `log-update.ts` 里内联展开了（第 143 行 resize、第 205 行
// 「长到贴底」、第 222 行「溢出视口」、第 265 行「删行数超过视口」）——
// 那四处的条件比这里的三个精细得多（要看 cursor.y、要看 next 是否
// 缩回视口内），所以没法复用这个粗判据。
//
// 于是它就成了**判据搬家之后留下的旧函数**。留着不删的代价是：
// 读代码的人会以为清屏决策在这里，然后去改它、发现没效果。
//
// 顺带一个隐藏的语义：`>= viewport.height` 而不是 `>`。恰好填满
// 也算「溢出」，因为再要换行就会滚动 —— 这条在 log-update 里被
// 完整保留了（第 205 行同样用 `>=`）。
/**
 * Determines whether the screen should be cleared based on the current and previous frame.
 * Returns the reason for clearing, or undefined if no clear is needed.
 *
 * Screen clearing is triggered when:
 * 1. Terminal has been resized (viewport dimensions changed) → 'resize'
 * 2. Current frame screen height exceeds available terminal rows → 'offscreen'
 * 3. Previous frame screen height exceeded available terminal rows → 'offscreen'
 */
export function shouldClearScreen(
  prevFrame: Frame,
  frame: Frame,
): FlickerReason | undefined {
  const didResize =
    frame.viewport.height !== prevFrame.viewport.height ||
    frame.viewport.width !== prevFrame.viewport.width
  if (didResize) {
    return 'resize'
  }

  const currentFrameOverflows = frame.screen.height >= frame.viewport.height
  const previousFrameOverflowed =
    prevFrame.screen.height >= prevFrame.viewport.height
  if (currentFrameOverflows || previousFrameOverflowed) {
    return 'offscreen'
  }

  return undefined
}
