// ═══════════════════════════════════════════════════════════════
//  render-to-screen：把一段 React 元素渲染成一块独立屏幕
// ═══════════════════════════════════════════════════════════════
//
//  这是渲染器的**第二种用法**：主路径是「整棵树 → 主屏」，这里是
//  「一条消息 → 一块离屏缓冲」。目的是算出一条消息内部某个匹配在
//  第几行第几列（主屏上那条消息可能被裁剪、被滚动，位置不可靠）。
//
//  但这个文件里有三处「历史沉积」，读之前先知道：
//
//   1. `renderToScreen()` 本身**零外部读者**（只有它自己的日志提到
//      自己）。注释说「Used for search」，但现在的搜索路径
//      （`ink.tsx:1098`）只调 `scanPositions` 扫主屏，不再旁渲染。
//   2. 因此下面那套「单例 root / container / pools」的复用机制，
//      实际服务于一个没人调的函数。
//   3. `scanPositions` 和 `applySearchHighlight` 是**同一段逻辑的
//      两份拷贝**，注释里明写「Keep in sync — or extract to a shared
//      helper (TODO once both are stable)」。
//
//  活着的部分：`scanPositions`（扫主屏）、`applyPositionedHighlight`
//  （给当前匹配上色）。读的时候把注意力放这两处。
import noop from 'lodash-es/noop.js'
import type { ReactElement } from 'react'
import { LegacyRoot } from 'react-reconciler/constants.js'
import { logForDebugging } from '../utils/debug.js'
import { createNode, type DOMElement } from './dom.js'
import { FocusManager } from './focus.js'
import Output from './output.js'
import reconciler from './reconciler.js'
import renderNodeToOutput, {
  resetLayoutShifted,
} from './render-node-to-output.js'
import {
  CellWidth,
  CharPool,
  cellAtIndex,
  createScreen,
  HyperlinkPool,
  type Screen,
  StylePool,
  setCellStyleId,
} from './screen.js'

/** Position of a match within a rendered message, relative to the message's
 *  own bounding box (row 0 = message top). Stable across scroll — to
 *  highlight on the real screen, add the message's screen-row offset. */
// 坐标是**消息相对**的（row 0 = 消息顶部），不是屏幕坐标。
//
// 这个设计让它能跨滚动复用：消息滚动了，匹配在消息内的位置不变，
// 上屏时只要加一个偏移。`applyPositionedHighlight` 的 `rowOffset`
// 就是这个偏移。
//
// `len` 的单位是 **cell**（格子），不是字符数 —— 因为匹配里可能有
// 宽字符。所以 `query.length` 只在纯 ASCII 时等于 `len`。
export type MatchPosition = {
  row: number
  col: number
  /** Number of CELLS the match spans (= query.length for ASCII, more
   *  for wide chars in the query). */
  len: number
}

// 这段注释讲的是**为什么用 LegacyRoot**，理由比「省事」深刻：
//
//   ConcurrentRoot 的 scheduler 有一个跨 root 的待办队列
//   （`flushSyncWork` 会处理所有 root 的待办）。旁渲染每调一次就
//   建一个 root，这些 root 的待办会堆在同一个队列里互相影响 ——
//   实测是「每次调用增长 0.0003ms」，单次无感，但渲染 8000 条消息
//   就是 2.4 秒。
//
//   LegacyRoot 是纯同步的（没有 scheduler），所以没有这个泄漏。
//
// 注释还给了一个更实用的建议：**别 upfront 渲染全部**，按需单条渲染 +
// 上游按 (msg, query, width) 缓存。这一条比「修泄漏」更重要。
//
// 注意 pools 复用：样式/字符/超链接池是累积的，复用意味着后面的调用
// 命中率更高（同一个 styleId 被反复用到）。root 和 container 复用省的是
// createContainer 的约 1ms。
// Shared across calls. Pools accumulate style/char interns — reusing them
// means later calls hit cache more. Root/container reuse saves the
// createContainer cost (~1ms). LegacyRoot: all work sync, no scheduling —
// ConcurrentRoot's scheduler backlog leaks across roots via flushSyncWork.
let root: DOMElement | undefined
let container: ReturnType<typeof reconciler.createContainer> | undefined
let stylePool: StylePool | undefined
let charPool: CharPool | undefined
let hyperlinkPool: HyperlinkPool | undefined
let output: Output | undefined

const timing = { reconcile: 0, yoga: 0, paint: 0, scan: 0, calls: 0 }
const LOG_EVERY = 20

/** Render a React element (wrapped in all contexts the component needs —
 *  caller's job) to an isolated Screen buffer at the given width. Returns
 *  the Screen + natural height (from yoga). Used for search: render ONE
 *  message, scan its Screen for the query, get exact (row, col) positions.
 *
 *  ~1-3ms per call (yoga alloc + calculateLayout + paint). The
 *  flushSyncWork cross-root leak measured ~0.0003ms/call growth — fine
 *  for on-demand single-message rendering, pathological for render-all-
 *  8k-upfront. Cache per (msg, query, width) upstream.
 *
 *  Unmounts between calls. Root/container/pools persist for reuse. */
// ⚠️ 零外部读者。`grep renderToScreen` 只有本文件内的两处命中
// （定义 + 日志字符串）。
//
// 它的设计仍然值得读，因为它是「如何在一个进程里跑第二棵 React 树」
// 的完整示例：
//
//   建 root（自己挂 FocusManager，dispatch 直接返回 false —— 旁渲染不需要焦点）
//   → createContainer(LegacyRoot, ...)
//   → updateContainerSync(el) + flushSyncWork()  ← React 侧同步跑完
//   → 手动 calculateLayout(width)
//   → createScreen(width, max(1, height))
//   → renderNodeToOutput
//   → output.get()      ← **必须有这一步**
//   → updateContainerSync(null) + flushSyncWork()  ← 卸载，但保留 root
//
// 其中 `output.get()` 那一步最容易漏：`renderNodeToOutput` 只是把写操作
// **排队**进 Output，`.get()` 才把它们真正落进 Screen 的格子数组。
// 少了它，screen 是全零（构造时零填充），看起来像「渲染不出东西」。
export function renderToScreen(
  el: ReactElement,
  width: number,
): { screen: Screen; height: number } {
  if (!root) {
    root = createNode('ink-root')
    root.focusManager = new FocusManager(() => false)
    stylePool = new StylePool()
    charPool = new CharPool()
    hyperlinkPool = new HyperlinkPool()
    // @ts-expect-error react-reconciler 0.33 takes 10 args; @types says 11
    container = reconciler.createContainer(
      root,
      LegacyRoot,
      null,
      false,
      null,
      'search-render',
      noop,
      noop,
      noop,
      noop,
    )
  }

  const t0 = performance.now()
  // @ts-expect-error updateContainerSync exists but not in @types
  reconciler.updateContainerSync(el, container, null, noop)
  // @ts-expect-error flushSyncWork exists but not in @types
  reconciler.flushSyncWork()
  const t1 = performance.now()

  // Yoga layout. Root might not have a yogaNode if the tree is empty.
  root.yogaNode?.setWidth(width)
  root.yogaNode?.calculateLayout(width)
  const height = Math.ceil(root.yogaNode?.getComputedHeight() ?? 0)
  const t2 = performance.now()

  // Paint to a fresh Screen. Width = given, height = yoga's natural.
  // No alt-screen, no prevScreen (every call is fresh).
// `Math.max(1, height)` —— createScreen 不接受 0 高。
//
// 但注释写的是「createScreen may choke」，实际后果取决于实现：如果
// 它内部 `new Int32Array(w * 0)`，那是个合法空数组，不会抛错，
// 只是后面任何写入都会越界。所以这里宁可给 1 行。
//
// 空树（`height === 0`）是合法输入 —— 调用方可能在消息还没内容时调它。
  const screen = createScreen(
    width,
    Math.max(1, height), // avoid 0-height Screen (createScreen may choke)
    stylePool!,
    charPool!,
    hyperlinkPool!,
  )
  if (!output) {
    output = new Output({ width, height, stylePool: stylePool!, screen })
  } else {
    output.reset(width, height, screen)
  }
  resetLayoutShifted()
  renderNodeToOutput(root, output, { prevScreen: undefined })
  // renderNodeToOutput queues writes into Output; .get() flushes the
  // queue into the Screen's cell arrays. Without this the screen is
  // blank (constructor-zero).
  const rendered = output.get()
  const t3 = performance.now()

  // Unmount so next call gets a fresh tree. Leaves root/container/pools.
  // @ts-expect-error updateContainerSync exists but not in @types
  reconciler.updateContainerSync(null, container, null, noop)
  // @ts-expect-error flushSyncWork exists but not in @types
  reconciler.flushSyncWork()

  timing.reconcile += t1 - t0
  timing.yoga += t2 - t1
  timing.paint += t3 - t2
  if (++timing.calls % LOG_EVERY === 0) {
    const total = timing.reconcile + timing.yoga + timing.paint + timing.scan
    logForDebugging(
      `renderToScreen: ${timing.calls} calls · ` +
        `reconcile=${timing.reconcile.toFixed(1)}ms yoga=${timing.yoga.toFixed(1)}ms ` +
        `paint=${timing.paint.toFixed(1)}ms scan=${timing.scan.toFixed(1)}ms · ` +
        `total=${total.toFixed(1)}ms · avg ${(total / timing.calls).toFixed(2)}ms/call`,
    )
  }

  return { screen: rendered, height }
}

/** Scan a Screen buffer for all occurrences of query. Returns positions
 *  relative to the buffer (row 0 = buffer top). Same cell-skip logic as
 *  applySearchHighlight (SpacerTail/SpacerHead/noSelect) so positions
 *  match what the overlay highlight would find. Case-insensitive.
 *
 *  For the side-render use: this Screen is the FULL message (natural
 *  height, not viewport-clipped). Positions are stable — to highlight
 *  on the real screen, add the message's screen offset (lo). */
// 扫主屏找匹配。返回值是**缓冲相对**坐标（row 0 = 缓冲顶部），
// 因为主屏的缓冲就是「当前这一屏」。
//
// 三处跳过条件跟 `applySearchHighlight` 完全一致（SpacerTail /
// SpacerHead / noSelect）—— 这不是巧合，是必须：扫描时说「这里有个
// 匹配」而上色时说「这个格子不能改」，用户就会看到「找到了但没高亮」。
//
// 所以这两份实现的生命线是**同步**。注释里那个 TODO 一直没做，
// 意味着每次改跳过条件都要改两处。
export function scanPositions(screen: Screen, query: string): MatchPosition[] {
  const lq = query.toLowerCase()
  if (!lq) return []
  const qlen = lq.length
  const w = screen.width
  const h = screen.height
  const noSelect = screen.noSelect
  const positions: MatchPosition[] = []

  const t0 = performance.now()
  for (let row = 0; row < h; row++) {
// 这三行是为下面那个映射表做准备，而映射表存在的唯一理由是：
// **小写化会改变 code unit 数**。
//
// 两个例子：
//   · emoji 的代理对：`text.length` 是 2，但在屏幕上占 1 个 cell
//   · 土耳其语 İ（U+0130）：`toLowerCase()` 变成 `i` + U+0307 两个 code unit
//
// 于是 `text.indexOf(q)` 得到的位置**不能当成 cell 下标**用。
// `codeUnitToCell` 就是那张翻译表：第 i 个 code unit → 第几个 cell。
//
// 注意小写化是**逐字符**做的（第 179 行 `cell.char.toLowerCase()`），
// 不是对拼好的整串做 —— 对整串做的话，映射表就跟不上了。这一条
// applySearchHighlight 里注释得更详细。
    const rowOff = row * w
    // Same text-build as applySearchHighlight. Keep in sync — or extract
    // to a shared helper (TODO once both are stable). codeUnitToCell
    // maps indexOf positions (code units in the LOWERCASED text) to cell
    // indices in colOf — surrogate pairs (emoji) and multi-unit lowercase
    // (Turkish İ → i + U+0307) make text.length > colOf.length.
    let text = ''
    const colOf: number[] = []
    const codeUnitToCell: number[] = []
    for (let col = 0; col < w; col++) {
      const idx = rowOff + col
      const cell = cellAtIndex(screen, idx)
      if (
        cell.width === CellWidth.SpacerTail ||
        cell.width === CellWidth.SpacerHead ||
        noSelect[idx] === 1
      ) {
        continue
      }
      const lc = cell.char.toLowerCase()
      const cellIdx = colOf.length
      for (let i = 0; i < lc.length; i++) {
        codeUnitToCell.push(cellIdx)
      }
      text += lc
      colOf.push(col)
    }
    // Non-overlapping — same advance as applySearchHighlight.
// 非重叠前进（`pos + qlen`），不是 `pos + 1`。
//
// 区别在 `'aaa'` 里搜 `'aa'`：
//   重叠前进（pos+1）→ 位置 0 和 1 都算匹配，格子 1 被反显两次
//   非重叠（pos+qlen）→ 只有位置 0
//
// 这也是 less / vim / grep / Ctrl+F 的行为。两次反显虽然幂等
// （`withInverse` 应用两次等于一次），但会浪费一遍循环，而且
// 计数会翻倍（影响「1/3」这种提示）。
    let pos = text.indexOf(lq)
    while (pos >= 0) {
      const startCi = codeUnitToCell[pos]!
      const endCi = codeUnitToCell[pos + qlen - 1]!
      const col = colOf[startCi]!
      const endCol = colOf[endCi]! + 1
      positions.push({ row, col, len: endCol - col })
      pos = text.indexOf(lq, pos + qlen)
    }
  }
// 扫描耗时单独记账，每 20 次调用打一行日志。
//
// 这段计时代码是「性能埋点写在业务函数里」的典型 —— 好处是零侵入
// （不用改调用链），坏处是每次都要判 `calls % 20`。在扫一屏
// （几十行 × 每行几十格）的量级下，这个判断的开销可以忽略。
//
// 但注意 `timing.scan` 只有这里在加，`timing.reconcile` / `yoga` /
// `paint` 都在 renderToScreen 里加 —— 而 renderToScreen 零读者，
// 所以那三个数永远是 0。日志里的 `scan=xx ms` 是唯一有意义的字段。
  timing.scan += performance.now() - t0

  return positions
}

/** Write CURRENT (yellow+bold+underline) at positions[currentIdx] +
 *  rowOffset. OTHER positions are NOT styled here — the scan-highlight
 *  (applySearchHighlight with null hint) does inverse for all visible
 *  matches, including these. Two-layer: scan = 'you could go here',
 *  position = 'you ARE here'. Writing inverse again here would be a
 *  no-op (withInverse idempotent) but wasted work.
 *
 *  Positions are message-relative (row 0 = message top). rowOffset =
 *  message's current screen-top (lo). Clips outside [0, height). */
// 给「当前匹配」上色（黄 + 粗 + 下划线），其余匹配的反显由
// `applySearchHighlight` 负责。两层叠加的设计注释讲得很清楚：
//
//   扫描层 = 「你可以去这里」（反显，所有可见匹配）
//   定位层 = 「你现在在这里」（黄底，只有当前那个）
//
// 为什么不在这里也画反显：`withInverse` 幂等，画了等于白画。
//
// ⚠️ 一个隐含前提：这条路径假设 `rowOffset` 给的偏移是**本帧的**。
// 如果消息刚滚动、rowOffset 还是上一帧的值，高亮就会落在错行 ——
// 而且只落错一行，看起来像「高亮稍微偏了一点」，不容易第一时间
// 归因到滚动。
export function applyPositionedHighlight(
  screen: Screen,
  stylePool: StylePool,
  positions: MatchPosition[],
  rowOffset: number,
  currentIdx: number,
): boolean {
// 两个越界判断，语义不同：
//   第一个 `currentIdx` 越界 → 说明「当前匹配」被删了（查询变了或
//                              结果集变了），静默返回 false
//   第二个 `row` 越界     → 匹配在可视区外（滚走了），也返回 false
//
// 返回 false 表示「没画」，调用方据此决定要不要重绘 —— 所以这两种
// 「没画」都必须返回 false，不能装作画了。
  if (currentIdx < 0 || currentIdx >= positions.length) return false
  const p = positions[currentIdx]!
  const row = p.row + rowOffset
  if (row < 0 || row >= screen.height) return false
  const transform = (id: number) => stylePool.withCurrentMatch(id)
  const rowOff = row * screen.width
  for (let col = p.col; col < p.col + p.len; col++) {
    if (col < 0 || col >= screen.width) continue
    const cell = cellAtIndex(screen, rowOff + col)
    setCellStyleId(screen, col, row, transform(cell.styleId))
  }
  return true
}
