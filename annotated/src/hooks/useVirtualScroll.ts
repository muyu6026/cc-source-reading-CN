import type { RefObject } from 'react'
import {
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js'
import type { DOMElement } from '../ink/dom.js'

/**
 * Estimated height (rows) for items not yet measured. Intentionally LOW:
 * overestimating causes blank space (we stop mounting too early and the
 * viewport bottom shows empty spacer), while underestimating just mounts
 * a few extra items into overscan. The asymmetry means we'd rather err low.
 */
// 【文件定位】消息列表的 React 层虚拟化。ScrollBox 早已在 Ink 输出层做了视口裁剪（render-node-to-output.ts:617 会跳过可见窗口外的子节点），但 React fiber 和 Yoga 节点仍然全部分配——按每条 MessageRow 约 250KB RSS 算，1000 条消息的会话就是约 250MB 只增不减的内存（Ink 屏幕缓冲、WASM 线性内存、JSC 页保留都是 grow-only）。这个 hook 只挂载视口 ± overscan 内的条目，其余用 spacer 盒子以每条 O(1) 的 fiber 成本撑住滚动高度。
const DEFAULT_ESTIMATE = 3
// 未测条目的估算高度故意取低：高估会提前停止挂载导致视口底部露出空白 spacer，低估只是多挂几条进 overscan。不对称代价，宁可偏低。
/**
 * Extra rows rendered above and below the viewport. Generous because real
 * heights can be 10x the estimate for long tool results.
 */
const OVERSCAN_ROWS = 80
// 视口上下各多渲染 80 行。给得慷慨是因为真实高度可能是估算值的 10 倍（长工具结果）。
/** Items rendered before the ScrollBox has laid out (viewportHeight=0). */
const COLD_START_COUNT = 30
// ScrollBox 完成布局前（viewportHeight=0）先渲染的条目数。
/**
 * scrollTop quantization for the useSyncExternalStore snapshot. Without
 * this, every wheel tick (3-5 per notch) triggers a full React commit +
 * Yoga calculateLayout() + Ink diff cycle — the CPU spike. Visual scroll
 * stays smooth regardless: ScrollBox.forceRender fires on every scrollBy
 * and Ink reads the REAL scrollTop from the DOM node, independent of what
 * React thinks. React only needs to re-render when the mounted range must
 * shift; half of OVERSCAN_ROWS is the tightest safe bin (guarantees ≥40
 * rows of overscan remain before the new range is needed).
 */
const SCROLL_QUANTUM = OVERSCAN_ROWS >> 1
// scrollTop 量化档位。没有它，滚轮每格（3-5 个 tick）都会触发一次完整的 React commit + Yoga calculateLayout() + Ink diff——CPU 尖峰。视觉滚动依然平滑：ScrollBox.forceRender 每次 scrollBy 都触发，Ink 从 DOM 节点读真实 scrollTop，与 React 怎么想无关。React 只在挂载范围必须移动时才需要重渲染；OVERSCAN_ROWS 的一半是最紧的安全档（保证换挡前至少还剩 40 行 overscan）。
/**
 * Worst-case height assumed for unmeasured items when computing coverage.
 * A MessageRow can be as small as 1 row (single-line tool call). Using 1
 * here guarantees the mounted span physically reaches the viewport bottom
 * regardless of how small items actually are — at the cost of over-mounting
 * when items are larger (which is fine, overscan absorbs it).
 */
const PESSIMISTIC_HEIGHT = 1
// 计算覆盖率时未测条目的最坏高度假设。MessageRow 最小可以只有 1 行（单行工具调用）。用 1 保证挂载跨度物理上够到视口底部，不管条目实际多小——代价是条目大时多挂，overscan 吸收得了。
/** Cap on mounted items to bound fiber allocation even in degenerate cases. */
const MAX_MOUNTED_ITEMS = 300
// 挂载条目数上限，给退化情况下的 fiber 分配兜底。
/**
 * Max NEW items to mount in a single commit. Scrolling into a fresh range
 * with PESSIMISTIC_HEIGHT=1 would mount 194 items at once (OVERSCAN_ROWS*2+
 * viewportH = 194); each fresh MessageRow render costs ~1.5ms (marked lexer
 * + formatToken + ~11 createInstance) = ~290ms sync block. Sliding the range
 * toward the target over multiple commits keeps per-commit mount cost
 * bounded. The render-time clamp (scrollClampMin/Max) holds the viewport at
 * the edge of mounted content so there's no blank during catch-up.
 */
const SLIDE_STEP = 25
// 单次 commit 最多新挂载多少条。带着 PESSIMISTIC_HEIGHT=1 滚进新范围一次会挂 194 条（OVERSCAN_ROWS×2+viewportH）；每条新 MessageRow 渲染约 1.5ms（marked lexer + formatToken + ~11 次 createInstance）= ~290ms 同步阻塞。把范围分多次 commit 滑过去，每次的挂载成本有界；渲染期的 clamp（scrollClampMin/Max）把视口按在已挂载内容边缘，追赶期间不出空白。

const NOOP_UNSUB = () => {}

export type VirtualScrollResult = {
  /** [startIndex, endIndex) half-open slice of items to render. */
  range: readonly [number, number]
  /** Height (rows) of spacer before the first rendered item. */
  topSpacer: number
  /** Height (rows) of spacer after the last rendered item. */
  bottomSpacer: number
  /**
   * Callback ref factory. Attach `measureRef(itemKey)` to each rendered
   * item's root Box; after Yoga layout, the computed height is cached.
   */
  measureRef: (key: string) => (el: DOMElement | null) => void
  /**
   * Attach to the topSpacer Box. Its Yoga computedTop IS listOrigin
   * (first child of the virtualized region, so its top = cumulative
   * height of everything rendered before the list in the ScrollBox).
   * Drift-free: no subtraction of offsets, no dependence on item
   * heights that change between renders (tmux resize).
   */
  spacerRef: RefObject<DOMElement | null>
  /**
   * Cumulative y-offset of each item in list-wrapper coords (NOT scrollbox
   * coords — logo/siblings before this list shift the origin).
   * offsets[i] = rows above item i; offsets[n] = totalHeight.
   * Recomputed every render — don't memo on identity.
   */
  offsets: ArrayLike<number>
  /**
   * Read Yoga computedTop for item at index. Returns -1 if the item isn't
   * mounted or hasn't been laid out. Item Boxes are direct Yoga children
   * of the ScrollBox content wrapper (fragments collapse in the Ink DOM),
   * so this is content-wrapper-relative — same coordinate space as
   * scrollTop. Yoga layout is scroll-independent (translation happens
   * later in renderNodeToOutput), so positions stay valid across scrolls
   * without waiting for Ink to re-render. StickyTracker walks the mount
   * range with this to find the viewport boundary at per-scroll-tick
   * granularity (finer than the 40-row quantum this hook re-renders at).
   */
  getItemTop: (index: number) => number
  /**
   * Get the mounted DOMElement for item at index, or null. For
   * ScrollBox.scrollToElement — anchoring by element ref defers the
   * Yoga-position read to render time (deterministic; no throttle race).
   */
  getItemElement: (index: number) => DOMElement | null
  /** Measured Yoga height. undefined = not yet measured; 0 = rendered nothing. */
  getItemHeight: (index: number) => number | undefined
  /**
   * Scroll so item `i` is in the mounted range. Sets scrollTop =
   * offsets[i] + listOrigin. The range logic finds start from
   * scrollTop vs offsets[] — BOTH use the same offsets value, so they
   * agree by construction regardless of whether offsets[i] is the
   * "true" position. Item i mounts; its screen position may be off by
   * a few-dozen rows (overscan-worth of estimate drift), but it's in
   * the DOM. Follow with getItemTop(i) for the precise position.
   */
  scrollToIndex: (i: number) => void
// 【返回结构】range 是 [startIndex, endIndex) 半开区间；topSpacer/bottomSpacer 是上下 spacer 盒子的行高；measureRef 给每条挂载条目的根 Box 挂上，Yoga 布局后把算出的高度写进缓存；spacerRef 挂 topSpacer 盒子——它的 Yoga computedTop 就是 listOrigin；offsets[i] = 第 i 条上方的行数累计、offsets[n] = 总高（列表局部坐标，不含 ScrollBox 里更靠前的 logo 等兄弟节点）；getItemTop 读 Yoga computedTop（-1 = 未挂载或未布局）；getItemElement/getItemHeight 供 ScrollBox.scrollToElement 和 StickyTracker 用；scrollToIndex 设 scrollTop = offsets[i] + listOrigin，把条目弄进挂载区（精确屏幕位置靠后续 getItemTop）。
}

/**
 * React-level virtualization for items inside a ScrollBox.
 *
 * The ScrollBox already does Ink-output-level viewport culling
 * (render-node-to-output.ts:617 skips children outside the visible window),
 * but all React fibers + Yoga nodes are still allocated. At ~250 KB RSS per
 * MessageRow, a 1000-message session costs ~250 MB of grow-only memory
 * (Ink screen buffer, WASM linear memory, JSC page retention all grow-only).
 *
 * This hook mounts only items in viewport + overscan. Spacer boxes hold the
 * scroll height constant for the rest at O(1) fiber cost each.
 *
 * Height estimation: fixed DEFAULT_ESTIMATE for unmeasured items, replaced
 * by real Yoga heights after first layout. No scroll anchoring — overscan
 * absorbs estimate errors. If drift is noticeable in practice, anchoring
 * (scrollBy(delta) when topSpacer changes) is a straightforward followup.
 *
 * stickyScroll caveat: render-node-to-output.ts:450 sets scrollTop=maxScroll
 * during Ink's render phase, which does NOT fire ScrollBox.subscribe. The
 * at-bottom check below handles this — when pinned to the bottom, we render
 * the last N items regardless of what scrollTop claims.
 */
// 【高度策略】未测条目先用固定估算值，首次布局后换成真实 Yoga 高度。没有 scroll anchoring——overscan 吸收估算误差。stickyScroll 有个坑：render-node-to-output.ts:450 在 Ink 渲染期把 scrollTop 设为 maxScroll，这不触发 ScrollBox.subscribe，所以 at-bottom 检查在这里兜底：贴着底时不看 scrollTop 说什么，直接渲染最后 N 条。
export function useVirtualScroll(
  scrollRef: RefObject<ScrollBoxHandle | null>,
  itemKeys: readonly string[],
  /**
   * Terminal column count. On change, cached heights are stale (text
   * rewraps) — SCALED by oldCols/newCols rather than cleared. Clearing
   * made the pessimistic coverage back-walk mount ~190 items (every
   * uncached item → PESSIMISTIC_HEIGHT=1 → walk 190 to reach
   * viewport+2×overscan). Each fresh mount runs marked.lexer + syntax
   * highlighting ≈ 3ms; ~600ms React reconcile on first resize with a
   * long conversation. Scaling keeps heightCache populated → back-walk
   * uses real-ish heights → mount range stays tight. Scaled estimates
   * are overwritten by real Yoga heights on next useLayoutEffect.
   *
   * Scaled heights are close enough that the black-screen-on-widen bug
   * (inflated pre-resize offsets overshoot post-resize scrollTop → end
   * loop stops short of tail) doesn't trigger: ratio<1 on widen scales
   * heights DOWN, keeping offsets roughly aligned with post-resize Yoga.
   */
  columns: number,
): VirtualScrollResult {
// 函数签名。三个参数：scrollRef（ScrollBox 句柄）、itemKeys（条目 key 列表，identity 变化触发缓存 GC）、columns（终端列数）。
  const heightCache = useRef(new Map<string, number>())
  // Bump whenever heightCache mutates so offsets rebuild on next read. Ref
  // (not state) — checked during render phase, zero extra commits.
  const offsetVersionRef = useRef(0)
  // scrollTop at last commit, for detecting fast-scroll mode (slide cap gate).
  const lastScrollTopRef = useRef(0)
  const offsetsRef = useRef<{ arr: Float64Array; version: number; n: number }>({
    arr: new Float64Array(0),
    version: -1,
    n: -1,
  })
  const itemRefs = useRef(new Map<string, DOMElement>())
  const refCache = useRef(new Map<string, (el: DOMElement | null) => void>())
  // Inline ref-compare: must run before offsets is computed below. The
  // skip-flag guards useLayoutEffect from re-populating heightCache with
  // PRE-resize Yoga heights (useLayoutEffect reads Yoga from the frame
  // BEFORE this render's calculateLayout — the one that had the old width).
  // Next render's useLayoutEffect reads post-resize Yoga → correct.
  const prevColumns = useRef(columns)
  const skipMeasurementRef = useRef(false)
  // Freeze the mount range for the resize-settling cycle. Already-mounted
  // items have warm useMemo (marked.lexer, highlighting); recomputing range
  // from scaled/pessimistic estimates causes mount/unmount churn (~3ms per
  // fresh mount = ~150ms visible as a second flash). The pre-resize range is
  // as good as any — items visible at old width are what the user wants at
  // new width. Frozen for 2 renders: render #1 has skipMeasurement (Yoga
  // still pre-resize), render #2's useLayoutEffect reads post-resize Yoga
  // into heightCache. Render #3 has accurate heights → normal recompute.
  const prevRangeRef = useRef<readonly [number, number] | null>(null)
  const freezeRendersRef = useRef(0)
  if (prevColumns.current !== columns) {
    const ratio = prevColumns.current / columns
    prevColumns.current = columns
    for (const [k, h] of heightCache.current) {
      heightCache.current.set(k, Math.max(1, Math.round(h * ratio)))
// 列宽变化时缓存高度整体按 oldCols/newCols 缩放而不是清空。清空会让悲观覆盖回溯一次性挂 ~190 条（每条未缓存 → PESSIMISTIC_HEIGHT=1 → 回溯 190 条才够 viewport+2×overscan），每条新挂载跑 marked.lexer + 语法高亮约 3ms，长会话首次 resize 就是 ~600ms 的 React reconcile。缩放让 heightCache 保持有值，回溯用近似真实高度，挂载范围保持紧凑；缩放值会被下一帧 useLayoutEffect 的真实 Yoga 高度覆盖。缩放还能避开「拉宽黑屏」bug：放大的旧 offsets 会超过新 scrollTop 让结束循环提前收尾，ratio<1 把高度往下缩，与新 Yoga 对齐。
    }
    offsetVersionRef.current++
    skipMeasurementRef.current = true
    freezeRendersRef.current = 2
  }
// 冻结挂载范围两个渲染周期。已挂载条目有热 useMemo（marked.lexer、高亮）；按缩放/悲观估算重算范围会造成挂载/卸载churn（每条约 3ms = ~150ms 二次闪烁）。冻结两帧：第 1 帧 skipMeasurement（Yoga 还是旧宽度的），第 2 帧 useLayoutEffect 把新 Yoga 读进 heightCache，第 3 帧高度准确恢复常规重算。
  const frozenRange = freezeRendersRef.current > 0 ? prevRangeRef.current : null
  // List origin in content-wrapper coords. scrollTop is content-wrapper-
  // relative, but offsets[] are list-local (0 = first virtualized item).
  // Siblings that render BEFORE this list inside the ScrollBox — Logo,
  // StatusNotices, truncation divider in Messages.tsx — shift item Yoga
  // positions by their cumulative height. Without subtracting this, the
  // non-sticky branch's effLo/effHi are inflated and start advances past
  // items that are actually in view (blank viewport on click/scroll when
  // sticky breaks while scrollTop is near max). Read from the topSpacer's
  // Yoga computedTop — it's the first child of the virtualized region, so
  // its top IS listOrigin. No subtraction of offsets → no drift when item
  // heights change between renders (tmux resize: columns change → re-wrap
  // → heights shrink → the old item-sample subtraction went negative →
  // effLo inflated → black screen). One-frame lag like heightCache.
// listOrigin：列表在 content-wrapper 坐标系里的原点。scrollTop 是 content-wrapper 相对的，但 offsets[] 是列表局部的（0 = 第一个虚拟化条目）。ScrollBox 里排在本列表前面的兄弟节点（Messages.tsx 的 Logo、StatusNotices、截断分割线）会把条目 Yoga 位置整体抬高；不减掉这个原点，非 sticky 分支的 effLo/effHi 会虚高，start 越过实际在视口内的条目（sticky 刚断、scrollTop 接近 max 时点击/滚动出现空白视口）。从 topSpacer 的 Yoga computedTop 读——它是虚拟化区的第一个子节点，其 top 就是 listOrigin。不减去任何 item 采样，所以条目高度随渲染变化时（tmux resize：列宽变 → 重排 → 高度缩 → 旧的 item 采样相减会变负 → effLo 虚高 → 黑屏）无漂移。和 heightCache 一样有一帧滞后。
  const listOriginRef = useRef(0)
  const spacerRef = useRef<DOMElement | null>(null)

  // useSyncExternalStore ties re-renders to imperative scroll. Snapshot is
  // scrollTop QUANTIZED to SCROLL_QUANTUM bins — Object.is sees no change
  // for small scrolls (most wheel ticks), so React skips the commit + Yoga
  // + Ink cycle entirely until the accumulated delta crosses a bin.
  // Sticky is folded into the snapshot (sign bit) so sticky→broken also
  // triggers: scrollToBottom sets sticky=true without moving scrollTop
  // (Ink moves it later), and the first scrollBy after may land in the
  // same bin. NaN sentinel = ref not attached.
  const subscribe = useCallback(
    (listener: () => void) =>
      scrollRef.current?.subscribe(listener) ?? NOOP_UNSUB,
    [scrollRef],
  )
  useSyncExternalStore(subscribe, () => {
    const s = scrollRef.current
    if (!s) return NaN
    // Snapshot uses the TARGET (scrollTop + pendingDelta), not committed
    // scrollTop. scrollBy only mutates pendingDelta (renderer drains it
    // across frames); committed scrollTop lags. Using target means
    // notify() on scrollBy actually changes the snapshot → React remounts
    // children for the destination before Ink's drain frames need them.
    const target = s.getScrollTop() + s.getPendingDelta()
    const bin = Math.floor(target / SCROLL_QUANTUM)
    return s.isSticky() ? ~bin : bin
  })
// useSyncExternalStore 把重渲染绑到命令式滚动上。快照是 scrollTop 按 SCROLL_QUANTUM 分档的 bin——小幅滚动（多数滚轮 tick）Object.is 看到没变，React 整个跳过 commit + Yoga + Ink 周期，直到累计差值跨档。sticky 折进快照符号位，sticky→broken 也要触发：scrollToBottom 只置 sticky=true 不动 scrollTop（Ink 稍后移），其后的第一次 scrollBy 可能落在同一档里。NaN 哨兵 = ref 还没挂。注意快照用「目标位置」（scrollTop+pendingDelta）而不是已提交 scrollTop：scrollBy 只改 pendingDelta（渲染器跨帧排空），已提交值滞后；用目标值意味着 scrollBy 的 notify() 真的改变快照 → React 在 Ink 排空帧需要子节点之前就为目的地重挂。
  // Read the REAL committed scrollTop (not quantized) for range math —
  // quantization is only the re-render gate, not the position.
  const scrollTop = scrollRef.current?.getScrollTop() ?? -1
  // Range must span BOTH committed scrollTop (where Ink is rendering NOW)
  // and target (where pending will drain to). During drain, intermediate
  // frames render at scrollTops between the two — if we only mount for
  // the target, those frames find no children (blank rows).
  const pendingDelta = scrollRef.current?.getPendingDelta() ?? 0
  const viewportH = scrollRef.current?.getViewportHeight() ?? 0
  // True means the ScrollBox is pinned to the bottom. This is the ONLY
  // stable "at bottom" signal: scrollTop/scrollHeight both reflect the
  // PREVIOUS render's layout, which depends on what WE rendered (topSpacer +
  // items), creating a feedback loop (range → layout → atBottom → range).
  // stickyScroll is set by user action (scrollToBottom/scrollBy), the initial
  // attribute, AND by render-node-to-output when its positional follow fires
  // (scrollTop>=prevMax → pin to new max → set flag). The renderer write is
  // feedback-safe: it only flips false→true, only when already at the
  // positional bottom, and the flag being true here just means "tail-walk,
  // clear clamp" — the same behavior as if we'd read scrollTop==maxScroll
  // directly, minus the instability. Default true: before the ref attaches,
  // assume bottom (sticky will pin us there on first Ink render).
  const isSticky = scrollRef.current?.isSticky() ?? true
// isSticky = ScrollBox 贴着底。这是唯一稳定的「在底部」信号：scrollTop/scrollHeight 反映的都是上一次渲染的布局，而布局取决于我们渲染了什么（topSpacer+条目）——形成 range→layout→atBottom→range 反馈环。stickyScroll 由用户动作（scrollToBottom/scrollBy）、初始属性、以及 render-node-to-output 位置跟随（scrollTop≥prevMax → 钉到新 max → 置位）写入。渲染器的写入是反馈安全的：只翻转 false→true，只在已经在位置底部时，且此处为真只意味着「尾部走查、清 clamp」——与直接读 scrollTop==maxScroll 行为一致，减去不稳定。默认 true：ref 挂上前假定贴底（首次 Ink 渲染 sticky 会钉过去）。

  // GC stale cache entries (compaction, /clear, screenToggleId bump). Only
  // runs when itemKeys identity changes — scrolling doesn't touch keys.
  // itemRefs self-cleans via ref(null) on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  useMemo(() => {
    const live = new Set(itemKeys)
    let dirty = false
    for (const k of heightCache.current.keys()) {
      if (!live.has(k)) {
        heightCache.current.delete(k)
        dirty = true
      }
    }
    for (const k of refCache.current.keys()) {
      if (!live.has(k)) refCache.current.delete(k)
    }
    if (dirty) offsetVersionRef.current++
  }, [itemKeys])
// GC 陈旧缓存条目（compaction、/clear、screenToggleId bump）。只在 itemKeys identity 变化时跑——滚动不碰 keys。itemRefs 靠卸载时 ref(null) 自清洁。

  // Offsets cached across renders, invalidated by offsetVersion ref bump.
  // The previous approach allocated new Array(n+1) + ran n Map.get per
  // render; for n≈27k at key-repeat scroll rate (~11 commits/sec) that's
  // ~300k lookups/sec on a freshly-allocated array → GC churn + ~2ms/render.
  // Version bumped by heightCache writers (measureRef, resize-scale, GC).
  // No setState — the rebuild is read-side-lazy via ref version check during
  // render (same commit, zero extra schedule). The flicker that forced
  // inline-recompute came from setState-driven invalidation.
// offsets 跨渲染缓存，靠 offsetVersion ref bump 失效。旧方案每渲染分配新 Array(n+1) 且跑 n 次 Map.get：27k 条会话按按键重复滚动速率（~11 commit/s）就是 ~30 万次查询/s 打在 freshly-allocated 数组上 → GC churn + ~2ms/渲染。版本号由 heightCache 写入方（measureRef、resize 缩放、GC）递增；不 setState——重建是渲染期读侧惰性（同一次 commit，零额外调度）；过去逼出内联计算的闪烁正是 setState 失效引起的。
  const n = itemKeys.length
  if (
    offsetsRef.current.version !== offsetVersionRef.current ||
    offsetsRef.current.n !== n
  ) {
    const arr =
      offsetsRef.current.arr.length >= n + 1
        ? offsetsRef.current.arr
        : new Float64Array(n + 1)
    arr[0] = 0
    for (let i = 0; i < n; i++) {
      arr[i + 1] =
        arr[i]! + (heightCache.current.get(itemKeys[i]!) ?? DEFAULT_ESTIMATE)
    }
    offsetsRef.current = { arr, version: offsetVersionRef.current, n }
  }
  const offsets = offsetsRef.current.arr
// totalHeight = offsets[n]，本列表全部条目的高度总和。
  const totalHeight = offsets[n]!

  let start: number
  let end: number

  if (frozenRange) {
    // Column just changed. Keep the pre-resize range to avoid mount churn.
    // Clamp to n in case messages were removed (/clear, compaction).
    ;[start, end] = frozenRange
    start = Math.min(start, n)
    end = Math.min(end, n)
  } else if (viewportH === 0 || scrollTop < 0) {
    // Cold start: ScrollBox hasn't laid out yet. Render the tail — sticky
    // scroll pins to the bottom on first Ink render, so these are the items
    // the user actually sees. Any scroll-up after that goes through
    // scrollBy → subscribe fires → we re-render with real values.
    start = Math.max(0, n - COLD_START_COUNT)
// 冷启动：ScrollBox 还没布局。渲染尾部——sticky 滚动会在首次 Ink 渲染时钉到底，这些正是用户实际看到的条目。之后任何上翻都走 scrollBy → subscribe 触发 → 带真实值重渲染。
    end = n
  } else {
    if (isSticky) {
      // Sticky-scroll fallback. render-node-to-output may have moved scrollTop
      // without notifying us, so trust "at bottom" over the stale snapshot.
      // Walk back from the tail until we've covered viewport + overscan.
      const budget = viewportH + OVERSCAN_ROWS
      start = n
      while (start > 0 && totalHeight - offsets[start - 1]! < budget) {
        start--
      }
// sticky 兜底：render-node-to-output 可能已经移动了 scrollTop 而没通知我们，所以信「在底部」而不是陈旧快照。从尾部往回走，直到覆盖 viewport+overscan。
      end = n
    } else {
      // User has scrolled up. Compute start from offsets (estimate-based:
      // may undershoot which is fine — we just start mounting a bit early).
      // Then extend end by CUMULATIVE BEST-KNOWN HEIGHT, not estimated
      // offsets. The invariant is:
      //   topSpacer + sum(real_heights[start..end]) >= scrollTop + viewportH + overscan
      // Since topSpacer = offsets[start] ≤ scrollTop - overscan, we need:
      //   sum(real_heights) >= viewportH + 2*overscan
      // For unmeasured items, assume PESSIMISTIC_HEIGHT=1 — the smallest a
      // MessageRow can be. This over-mounts when items are large, but NEVER
      // leaves the viewport showing empty spacer during fast scroll through
      // unmeasured territory. Once heights are cached (next render),
      // coverage is computed with real values and the range tightens.
      // Advance start past item K only if K is safe to fold into topSpacer
      // without a visible jump. Two cases are safe:
      //   (a) K is NOT currently mounted (itemRefs has no entry). Its
      //       contribution to offsets has ALWAYS been the estimate — the
      //       spacer already matches what was there. No layout change.
      //   (b) K is mounted AND its height is cached. offsets[start+1] uses
      //       the real height, so topSpacer = offsets[start+1] exactly
      //       equals the Yoga span K occupied. Seamless unmount.
      // The unsafe case — K is mounted but uncached — is the one-render
      // window between mount and useLayoutEffect measurement. Keeping K
      // mounted that one extra render lets the measurement land.
      // Mount range spans [committed, target] so every drain frame is
      // covered. Clamp at 0: aggressive wheel-up can push pendingDelta
      // far past zero (MX Master free-spin), but scrollTop never goes
      // negative. Without the clamp, effLo drags start to 0 while effHi
      // stays at the current (high) scrollTop — span exceeds what
      // MAX_MOUNTED_ITEMS can cover and early drain frames see blank.
      // listOrigin translates scrollTop (content-wrapper coords) into
      // list-local coords before comparing against offsets[]. Without
      // this, pre-list siblings (Logo+notices in Messages.tsx) inflate
      // scrollTop by their height and start over-advances — eats overscan
      // first, then visible rows once the inflation exceeds OVERSCAN_ROWS.
      const listOrigin = listOriginRef.current
      // Cap the [committed..target] span. When input outpaces render,
      // pendingDelta grows unbounded → effLo..effHi covers hundreds of
      // unmounted rows → one commit mounts 194 fresh MessageRows → 3s+
      // sync block → more input queues → bigger delta next time. Death
      // spiral. Capping the span bounds fresh mounts per commit; the
      // clamp (setClampBounds) shows edge-of-mounted during catch-up so
      // there's no blank screen — scroll reaches target over a few
      // frames instead of freezing once for seconds.
// span 封顶。输入快于渲染时 pendingDelta 无限增长 → effLo..effHi 覆盖几百行未挂载内容 → 一次 commit 挂 194 条新 MessageRow → 3 秒以上同步阻塞 → 更多输入排队 → 下次 delta 更大。死亡螺旋。封顶把每次 commit 的新挂载数约束住；clamp（setClampBounds）在追赶期间把视口按在已挂载边缘，不出空白——滚动分几帧到达目标，而不是一次冻住几秒。
      const MAX_SPAN_ROWS = viewportH * 3
      const rawLo = Math.min(scrollTop, scrollTop + pendingDelta)
      const rawHi = Math.max(scrollTop, scrollTop + pendingDelta)
      const span = rawHi - rawLo
      const clampedLo =
        span > MAX_SPAN_ROWS
          ? pendingDelta < 0
            ? rawHi - MAX_SPAN_ROWS // scrolling up: keep near target (low end)
            : rawLo // scrolling down: keep near committed
          : rawLo
      const clampedHi = clampedLo + Math.min(span, MAX_SPAN_ROWS)
      const effLo = Math.max(0, clampedLo - listOrigin)
      const effHi = clampedHi - listOrigin
      const lo = effLo - OVERSCAN_ROWS
      // Binary search for start — offsets is monotone-increasing. The
      // linear while(start++) scan iterated ~27k times per render for the
      // 27k-msg session (scrolling from bottom, start≈27200). O(log n).
      {
        let l = 0
        let r = n
        while (l < r) {
          const m = (l + r) >> 1
          if (offsets[m + 1]! <= lo) l = m + 1
          else r = m
        }
        start = l
      }
// start 用二分查找。offsets 单调递增；旧的 while(start++) 线性扫描在 27k 条会话里每渲染迭代 ~27k 次（从底部滚，start≈27200）。O(log n)。
      // Guard: don't advance past mounted-but-unmeasured items. During the
      // one-render window between mount and useLayoutEffect measurement,
      // unmounting such items would use DEFAULT_ESTIMATE in topSpacer,
      // which doesn't match their (unknown) real span → flicker. Mounted
      // items are in [prevStart, prevEnd); scan that, not all n.
      {
        const p = prevRangeRef.current
        if (p && p[0] < start) {
          for (let i = p[0]; i < Math.min(start, p[1]); i++) {
            const k = itemKeys[i]!
            if (itemRefs.current.has(k) && !heightCache.current.has(k)) {
              start = i
              break
            }
          }
        }
      }
// 守卫：不要越过「已挂载但未测」的条目。挂载与 useLayoutEffect 测量之间有一个渲染窗口，此时卸载它们会让 topSpacer 用 DEFAULT_ESTIMATE，与真实跨度不符 → 闪烁。已挂载条目在 [prevStart, prevEnd) 里，只扫这一段，不扫全部 n。

      const needed = viewportH + 2 * OVERSCAN_ROWS
      const maxEnd = Math.min(n, start + MAX_MOUNTED_ITEMS)
      let coverage = 0
      end = start
      while (
        end < maxEnd &&
        (coverage < needed || offsets[end]! < effHi + viewportH + OVERSCAN_ROWS)
      ) {
        coverage +=
          heightCache.current.get(itemKeys[end]!) ?? PESSIMISTIC_HEIGHT
        end++
      }
// 覆盖率循环：按累计最佳已知高度（未测按 PESSIMISTIC_HEIGHT=1）扩展 end。不变量是 topSpacer + 真实高度之和 ≥ scrollTop + viewportH + overscan；这个过挂策略保证快速滚过未测区域时视口绝不露出空 spacer，下一渲染高度进缓存后范围自动收紧。
    }
    // Same coverage guarantee for the atBottom path (it walked start back
    // by estimated offsets, which can undershoot if items are small).
    const needed = viewportH + 2 * OVERSCAN_ROWS
    const minStart = Math.max(0, end - MAX_MOUNTED_ITEMS)
    let coverage = 0
    for (let i = start; i < end; i++) {
      coverage += heightCache.current.get(itemKeys[i]!) ?? PESSIMISTIC_HEIGHT
    }
    while (start > minStart && coverage < needed) {
      start--
      coverage +=
        heightCache.current.get(itemKeys[start]!) ?? PESSIMISTIC_HEIGHT
    }
// 滑档上限：限制本次 commit 的新挂载量。滚进新范围本来会按 PESSIMISTIC_HEIGHT=1 覆盖率一次挂 194 条——~290ms React 渲染阻塞。按滚动速度触发（|上次 commit 以来 scrollTop 差| > 2×viewportH——按键重复 PageUp 每按约动 viewportH/2，3 次连按成批 = 快模式）。scrollBy（pendingDelta）和 scrollTo（直接写）都覆盖。普通单次 PageUp 或 sticky 断裂跳转不走这条。只封顶范围增长；收缩不设限。
    // Slide cap: limit how many NEW items mount this commit. Scrolling into
    // a fresh range would otherwise mount 194 items at PESSIMISTIC_HEIGHT=1
    // coverage — ~290ms React render block. Gates on scroll VELOCITY
    // (|scrollTop delta since last commit| > 2×viewportH — key-repeat PageUp
    // moves ~viewportH/2 per press, 3+ presses batched = fast mode). Covers
    // both scrollBy (pendingDelta) and scrollTo (direct write). Normal
    // single-PageUp or sticky-break jumps skip this. The clamp
    // (setClampBounds) holds the viewport at the mounted edge during
    // catch-up. Only caps range GROWTH; shrinking is unbounded.
    const prev = prevRangeRef.current
    const scrollVelocity =
      Math.abs(scrollTop - lastScrollTopRef.current) + Math.abs(pendingDelta)
    if (prev && scrollVelocity > viewportH * 2) {
      const [pS, pE] = prev
      if (start < pS - SLIDE_STEP) start = pS - SLIDE_STEP
      if (end > pE + SLIDE_STEP) end = pE + SLIDE_STEP
      // A large forward jump can push start past the capped end (start
      // advances via binary search while end is capped at pE + SLIDE_STEP).
      // Mount SLIDE_STEP items from the new start so the viewport isn't
      // blank during catch-up.
      if (start > end) end = Math.min(start + SLIDE_STEP, n)
    }
    lastScrollTopRef.current = scrollTop
  }

  // Decrement freeze AFTER range is computed. Don't update prevRangeRef
  // during freeze so both frozen renders reuse the ORIGINAL pre-resize
  // range (not the clamped-to-n version if messages changed mid-freeze).
  if (freezeRendersRef.current > 0) {
    freezeRendersRef.current--
  } else {
    prevRangeRef.current = [start, end]
  }
// freeze 计数在范围算完后递减。freeze 期间不更新 prevRangeRef，这样两帧冻结都用最初的 resize 前范围（不是消息中途变化时被 clamp 到 n 的版本）。
  // useDeferredValue lets React render with the OLD range first (cheap —
  // all memo hits) then transition to the NEW range (expensive — fresh
  // mounts with marked.lexer + formatToken). The urgent render keeps Ink
  // painting at input rate; fresh mounts happen in a non-blocking
  // background render. This is React's native time-slicing: the 62ms
  // fresh-mount block becomes interruptible. The clamp (setClampBounds)
  // already handles viewport pinning so there's no visual artifact from
  // the deferred range lagging briefly behind scrollTop.
  //
  // Only defer range GROWTH (start moving earlier / end moving later adds
  // fresh mounts). Shrinking is cheap (unmount = remove fiber, no parse)
  // and the deferred value lagging shrink causes stale overscan to stay
  // mounted one extra tick — harmless but fails tests checking exact
  // range after measurement-driven tightening.
  const dStart = useDeferredValue(start)
  const dEnd = useDeferredValue(end)
// useDeferredValue 让 React 先用旧范围渲染（便宜——全 memo 命中）再过渡到新范围（贵——新挂载要跑 marked.lexer + formatToken）。紧急渲染保持 Ink 按输入速率绘制，新挂载发生在不阻塞的后台渲染里。这是 React 原生的时间分片：62ms 的新挂载阻塞变成可中断的。clamp 已经处理视口钉住，所以延迟范围短暂落后 scrollTop 没有视觉伪影。只延迟范围增长（start 前移/end 后移才有新挂载）；收缩便宜（卸载只是移除 fiber，不解析），延迟收缩会让过期 overscan 多留一跳——无害，但会挂测试对测量后收紧范围的精确断言。
  let effStart = start < dStart ? dStart : start
  let effEnd = end > dEnd ? dEnd : end
  // A large jump can make effStart > effEnd (start jumps forward while dEnd
  // still holds the old range's end). Skip deferral to avoid an inverted
  // range. Also skip when sticky — scrollToBottom needs the tail mounted
  // NOW so scrollTop=maxScroll lands on content, not bottomSpacer. The
  // deferred dEnd (still at old range) would render an incomplete tail,
  // maxScroll stays at the old content height, and "jump to bottom" stops
  // short. Sticky snap is a single frame, not continuous scroll — the
  // time-slicing benefit doesn't apply.
  if (effStart > effEnd || isSticky) {
    effStart = start
    effEnd = end
  }
// 跳变太大时 effStart 可能超过 effEnd（start 前跳而 dEnd 还停在旧范围的 end）。此时跳过延迟避免区间反转。sticky 也跳过：scrollToBottom 需要尾部现在就在——延迟的 dEnd 还在旧范围，渲染出不完整尾部，maxScroll 停在旧内容高度，「跳到底」短一截。sticky 吸附是单帧动作，不是连续滚动，时间分片用不上。
  // Scrolling DOWN (pendingDelta > 0): bypass effEnd deferral so the tail
  // mounts immediately. Without this, the clamp (based on effEnd) holds
  // scrollTop short of the real bottom — user scrolls down, hits clampMax,
  // stops, React catches up effEnd, clampMax widens, but the user already
  // released. Feels stuck-before-bottom. effStart stays deferred so
  // scroll-UP keeps time-slicing (older messages parse on mount — the
  // expensive direction).
  if (pendingDelta > 0) {
    effEnd = end
  }
// 向下滚（pendingDelta>0）时绕过 effEnd 延迟让尾部立刻挂载。否则 clamp（基于 effEnd）把 scrollTop 压在离真底部差一口气的位置——用户往下滚，撞 clampMax，停住，React 追上 effEnd，clampMax 放宽，但用户已经松手了。卡在底部之前的感觉。effStart 保持延迟，所以上滚仍有时间分片（老消息解析才是贵的方向）。
  // Final O(viewport) enforcement. The intermediate caps (maxEnd=start+
  // MAX_MOUNTED_ITEMS, slide cap, deferred-intersection) bound [start,end]
  // but the deferred+bypass combinations above can let [effStart,effEnd]
  // slip: e.g. during sustained PageUp when concurrent mode interleaves
  // dStart updates with effEnd=end bypasses across commits, the effective
  // window can drift wider than either immediate or deferred alone. On a
  // 10K-line resumed session this showed as +270MB RSS during PageUp spam
  // (yoga Node constructor + createWorkInProgress fiber alloc proportional
  // to scroll distance). Trim the far edge — by viewport position — to keep
  // fiber count O(viewport) regardless of deferred-value scheduling.
  if (effEnd - effStart > MAX_MOUNTED_ITEMS) {
    // Trim side is decided by viewport POSITION, not pendingDelta direction.
    // pendingDelta drains to 0 between frames while dStart/dEnd lag under
    // concurrent scheduling; a direction-based trim then flips from "trim
    // tail" to "trim head" mid-settle, bumping effStart → effTopSpacer →
    // clampMin → setClampBounds yanks scrollTop down → scrollback vanishes.
    // Position-based: keep whichever end the viewport is closer to.
    const mid = (offsets[effStart]! + offsets[effEnd]!) / 2
    if (scrollTop - listOriginRef.current < mid) {
      effEnd = effStart + MAX_MOUNTED_ITEMS
    } else {
      effStart = effEnd - MAX_MOUNTED_ITEMS
    }
  }
// 最终 O(viewport) 兜底。中间的各层封顶（maxEnd、slide cap、deferred 取交集）约束 [start,end]，但 deferred+bypass 的组合能让 [effStart,effEnd] 溜出去：持续 PageUp 时并发模式跨 commit 交错 dStart 更新与 effEnd=end 旁路，有效窗口会比单独用立即值或延迟值都宽。10K 行恢复会话上表现为 PageUp 连打期间 +270MB RSS（Yoga Node 构造 + createWorkInProgress fiber 分配与滚动距离成正比）。按视口位置修剪远端，让 fiber 数无论 deferred 怎么调度都是 O(viewport)。修剪方向按视口位置定而不是 pendingDelta 方向：pendingDelta 帧间会排空到 0，而 dStart/dEnd 在并发调度下滞后，方向修剪会在稳定过程中从「修剪尾」翻成「修剪头」，顶高 effStart → effTopSpacer → clampMin → setClampBounds 把 scrollTop 猛往下拽 → 回滚消失。

  // Write render-time clamp bounds in a layout effect (not during render —
  // mutating DOM during React render violates purity). render-node-to-output
  // clamps scrollTop to this span so burst scrollTo calls that race past
  // React's async re-render show the EDGE of mounted content (the last/first
  // visible message) instead of blank spacer.
  //
  // Clamp MUST use the EFFECTIVE (deferred) range, not the immediate one.
  // During fast scroll, immediate [start,end] may already cover the new
  // scrollTop position, but the children still render at the deferred
  // (older) range. If clamp uses immediate bounds, the drain-gate in
  // render-node-to-output sees scrollTop within clamp → drains past the
  // deferred children's span → viewport lands in spacer → white flash.
  // Using effStart/effEnd keeps clamp synced with what's actually mounted.
  //
  // Skip clamp when sticky — render-node-to-output pins scrollTop=maxScroll
  // authoritatively. Clamping during cold-start/load causes flicker: first
  // render uses estimate-based offsets, clamp set, sticky-follow moves
  // scrollTop, measurement fires, offsets rebuild with real heights, second
  // render's clamp differs → scrollTop clamp-adjusts → content shifts.
  const listOrigin = listOriginRef.current
  const effTopSpacer = offsets[effStart]!
  // At effStart=0 there's no unmounted content above — the clamp must allow
  // scrolling past listOrigin to see pre-list content (logo, header) that
  // sits in the ScrollBox but outside VirtualMessageList. Only clamp when
  // the topSpacer is nonzero (there ARE unmounted items above).
  const clampMin = effStart === 0 ? 0 : effTopSpacer + listOrigin
  // At effEnd=n there's no bottomSpacer — nothing to avoid racing past. Using
  // offsets[n] here would bake in heightCache (one render behind Yoga), and
  // when the tail item is STREAMING its cached height lags its real height by
  // however much arrived since last measure. Sticky-break then clamps
  // scrollTop below the real max, pushing the streaming text off-viewport
  // (the "scrolled up, response disappeared" bug). Infinity = unbounded:
  // render-node-to-output's own Math.min(cur, maxScroll) governs instead.
  const clampMax =
    effEnd === n
      ? Infinity
      : Math.max(effTopSpacer, offsets[effEnd]! - viewportH) + listOrigin
// clampMax 在 effEnd=n 时取 Infinity——没有 bottomSpacer 可防 racing past。这里不能用 offsets[n]：那会把 heightCache 烙进去（落后 Yoga 一个渲染），尾部条目正在流式输出时缓存高度落后于真实高度，sticky 断裂后把 scrollTop 压在低于真 max 的位置，把流式文本推出视口（「往上翻，回复不见了」bug）。Infinity = 不设限，交给 render-node-to-output 自己的 Math.min(cur, maxScroll) 管。
  useLayoutEffect(() => {
    if (isSticky) {
      scrollRef.current?.setClampBounds(undefined, undefined)
    } else {
      scrollRef.current?.setClampBounds(clampMin, clampMax)
    }
  })

  // Measure heights from the PREVIOUS Ink render. Runs every commit (no
  // deps) because Yoga recomputes layout without React knowing. yogaNode
  // heights for items mounted ≥1 frame ago are valid; brand-new items
  // haven't been laid out yet (that happens in resetAfterCommit → onRender,
  // after this effect).
  //
  // Distinguishing "h=0: Yoga hasn't run" (transient, skip) from "h=0:
  // MessageRow rendered null" (permanent, cache it): getComputedWidth() > 0
  // proves Yoga HAS laid out this node (width comes from the container,
  // always non-zero for a Box in a column). If width is set and height is
  // 0, the item is genuinely empty — cache 0 so the start-advance gate
  // doesn't block on it forever. Without this, a null-rendering message
  // at the start boundary freezes the range (seen as blank viewport when
  // scrolling down after scrolling up).
  //
  // NO setState. A setState here would schedule a second commit with
  // shifted offsets, and since Ink writes stdout on every commit
  // (reconciler.resetAfterCommit → onRender), that's two writes with
  // different spacer heights → visible flicker. Heights propagate to
  // offsets on the next natural render. One-frame lag, absorbed by overscan.
// 测量上一个 Ink 渲染的高度。每个 commit 都跑（无 deps）——Yoga 重算布局时 React 不知道。区分「h=0：Yoga 还没跑」（瞬态，跳过）与「h=0：MessageRow 渲染了 null」（永久，缓存）：getComputedWidth()>0 证明 Yoga 已经布局过这个节点（宽度来自容器，列里的 Box 永远非零）。宽度有值而高度为 0，条目就是真空——缓存 0，免得 start 前移闸门被它永远卡住（否则一条 null 消息卡在起始边界会冻住范围，表现为上翻后往下滚出现空白视口）。不 setState——那会调度第二次 commit，而 Ink 每次 commit 都写 stdout，两次不同 spacer 高度的写入就是可见闪烁。高度下一个自然渲染进 offsets，一帧滞后，overscan 吸收。
  useLayoutEffect(() => {
    const spacerYoga = spacerRef.current?.yogaNode
    if (spacerYoga && spacerYoga.getComputedWidth() > 0) {
      listOriginRef.current = spacerYoga.getComputedTop()
    }
    if (skipMeasurementRef.current) {
      skipMeasurementRef.current = false
      return
    }
    let anyChanged = false
    for (const [key, el] of itemRefs.current) {
      const yoga = el.yogaNode
      if (!yoga) continue
      const h = yoga.getComputedHeight()
      const prev = heightCache.current.get(key)
      if (h > 0) {
        if (prev !== h) {
          heightCache.current.set(key, h)
          anyChanged = true
        }
      } else if (yoga.getComputedWidth() > 0 && prev !== 0) {
        heightCache.current.set(key, 0)
        anyChanged = true
      }
    }
    if (anyChanged) offsetVersionRef.current++
  })
// ref(null) 路径在卸载时抓高度：yogaNode 那时还有效（reconciler 先调 ref(null) 再 removeChild → freeRecursive），所以能在 WASM 释放前拿到最终测量值。

  // Stable per-key callback refs. React's ref-swap dance (old(null) then
  // new(el)) is a no-op when the callback is identity-stable, avoiding
  // itemRefs churn on every render. GC'd alongside heightCache above.
  // The ref(null) path also captures height at unmount — the yogaNode is
  // still valid then (reconciler calls ref(null) before removeChild →
  // freeRecursive), so we get the final measurement before WASM release.
  const measureRef = useCallback((key: string) => {
    let fn = refCache.current.get(key)
    if (!fn) {
      fn = (el: DOMElement | null) => {
        if (el) {
          itemRefs.current.set(key, el)
        } else {
          const yoga = itemRefs.current.get(key)?.yogaNode
          if (yoga && !skipMeasurementRef.current) {
            const h = yoga.getComputedHeight()
            if (
              (h > 0 || yoga.getComputedWidth() > 0) &&
              heightCache.current.get(key) !== h
            ) {
              heightCache.current.set(key, h)
              offsetVersionRef.current++
            }
          }
          itemRefs.current.delete(key)
        }
      }
      refCache.current.set(key, fn)
    }
    return fn
  }, [])

  const getItemTop = useCallback(
    (index: number) => {
      const yoga = itemRefs.current.get(itemKeys[index]!)?.yogaNode
      if (!yoga || yoga.getComputedWidth() === 0) return -1
      return yoga.getComputedTop()
    },
    [itemKeys],
  )

  const getItemElement = useCallback(
    (index: number) => itemRefs.current.get(itemKeys[index]!) ?? null,
    [itemKeys],
  )
  const getItemHeight = useCallback(
    (index: number) => heightCache.current.get(itemKeys[index]!),
    [itemKeys],
  )
  const scrollToIndex = useCallback(
    (i: number) => {
      // offsetsRef.current holds latest cached offsets (event handlers run
      // between renders; a render-time closure would be stale).
      const o = offsetsRef.current
      if (i < 0 || i >= o.n) return
      scrollRef.current?.scrollTo(o.arr[i]! + listOriginRef.current)
    },
    [scrollRef],
  )
// scrollToIndex 读 offsetsRef.current 而不是渲染期闭包的 offsets——事件处理器跑在两次渲染之间，闭包值会陈旧。

  const effBottomSpacer = totalHeight - offsets[effEnd]!
// bottomSpacer = 总高 - offsets[effEnd]，即最后一条挂载条目之后的高度。

  return {
    range: [effStart, effEnd],
    topSpacer: effTopSpacer,
    bottomSpacer: effBottomSpacer,
    measureRef,
    spacerRef,
    offsets,
    getItemTop,
    getItemElement,
    getItemHeight,
    scrollToIndex,
  }
}
