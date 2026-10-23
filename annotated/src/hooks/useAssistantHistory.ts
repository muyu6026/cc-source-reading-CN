import { randomUUID } from 'crypto'
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import {
  createHistoryAuthCtx,
  fetchLatestEvents,
  fetchOlderEvents,
  type HistoryAuthCtx,
  type HistoryPage,
} from '../assistant/sessionHistory.js'
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js'
import type { RemoteSessionConfig } from '../remote/RemoteSessionManager.js'
import { convertSDKMessage } from '../remote/sdkMessageAdapter.js'
import type { Message, SystemInformationalMessage } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'

type Props = {
  /** Gated on viewerOnly — non-viewer sessions have no remote history to page. */
  config: RemoteSessionConfig | undefined
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  scrollRef: RefObject<ScrollBoxHandle | null>
  /** Called after prepend from the layout effect with message count + height
   *  delta. Lets useUnseenDivider shift dividerIndex + dividerYRef. */
  onPrepend?: (indexDelta: number, heightDelta: number) => void
}

type Result = {
  /** Trigger for ScrollKeybindingHandler's onScroll composition. */
  maybeLoadOlder: (handle: ScrollBoxHandle) => void
}

/** Fire loadOlder when scrolled within this many rows of the top. */
const PREFETCH_THRESHOLD_ROWS = 40
// 预取阈值：scrollTop 距顶 40 行内就触发加载更旧页——
// 等用户真的滚到顶再拉会有可见空窗。

/** Max chained page loads to fill the viewport on mount. Bounds the loop if
 *  events convert to zero visible messages (everything filtered). */
const MAX_FILL_PAGES = 10
// 挂载时补满视口的链式上限：防止事件全被过滤成 0 条可见消息时
// 无限自链。

const SENTINEL_LOADING = 'loading older messages…'
const SENTINEL_LOADING_FAILED =
  'failed to load older messages — scroll up to retry'
const SENTINEL_START = 'start of session'
// 三个哨兵文案共用一个稳定 UUID（见 sentinelUuidRef）——
// 虚拟滚动把同一 UUID 视为同一个 item，文案变化只是原地 mutate，
// 不是 删除+插入，不会丢滚动位置。

/** Convert a HistoryPage to REPL Message[] using the same opts as viewer mode. */
function pageToMessages(page: HistoryPage): Message[] {
  const out: Message[] = []
  for (const ev of page.events) {
    const c = convertSDKMessage(ev, {
      convertUserTextMessages: true,
      convertToolResults: true,
    })
    if (c.type === 'message') out.push(c.message)
  }
  return out
}
// 转换选项与 viewer 模式保持一致；非 message 型事件直接丢弃。

/**
 * Lazy-load `claude assistant` history on scroll-up.
 *
 * On mount: fetch newest page via anchor_to_latest, prepend to messages.
 * On scroll-up near top: fetch next-older page via before_id, prepend with
 * scroll anchoring (viewport stays put).
 *
 * No-op unless config.viewerOnly. REPL only calls this hook inside a
 * feature('KAIROS') gate, so build-time elimination is handled there.
 */
// 惰性加载 claude assistant 历史：挂载时拉最新一页
// （anchor_to_latest），上滚近顶时按 before_id 拉更旧一页，
// 前置插入并保持视口不动。
// 仅 viewerOnly 生效；REPL 侧还有 feature('KAIROS') 门控，
// 关闭时整个 hook 被静态消除。
export function useAssistantHistory({
  config,
  setMessages,
  scrollRef,
  onPrepend,
}: Props): Result {
// 注意 onPrepend 是可选回调：把「新增了几条、增高了多少」透出去，
// 让 useUnseenDivider 能同步平移分割线。
  const enabled = config?.viewerOnly === true

  // Cursor state: ref-only (no re-render on cursor change). `null` = no
  // older pages. `undefined` = initial page not fetched yet.
  const cursorRef = useRef<string | null | undefined>(undefined)
// 游标三态：undefined = 首页还没拉；null = 没有更旧页了；
// string = 更旧页的 before_id。纯 ref，不触发重渲染。
  const ctxRef = useRef<HistoryAuthCtx | null>(null)
  const inflightRef = useRef(false)

  // Scroll-anchor: snapshot height + prepended count before setMessages;
  // compensate in useLayoutEffect after React commits. getFreshScrollHeight
  // reads Yoga directly so the value is correct post-commit.
  const anchorRef = useRef<{ beforeHeight: number; count: number } | null>(null)
// 滚动锚点快照：prepend 前记下高度与条数，
// commit 后按真实高度差补偿。

  // Fill-viewport chaining: after the initial page commits, if content doesn't
  // fill the viewport yet, load another page. Self-chains via the layout effect
  // until filled or the budget runs out. Budget set once on initial load; user
  // scroll-ups don't need it (maybeLoadOlder re-fires on next wheel event).
  const fillBudgetRef = useRef(0)
// 补满预算只在首次加载时设定一次；用户主动上滚不需要预算限制
// （maybeLoadOlder 会在下次滚轮事件重新触发）。

  // Stable sentinel UUID — reused across swaps so virtual-scroll treats it
  // as one item (text-only mutation, not remove+insert).
  const sentinelUuidRef = useRef(randomUUID())
// 稳定哨兵 UUID：跨 loading / failed / start 三种文案复用，
// 让虚拟滚动视其为同一行。

  function mkSentinel(text: string): SystemInformationalMessage {
    return {
      type: 'system',
      subtype: 'informational',
      content: text,
      isMeta: false,
      timestamp: new Date().toISOString(),
      uuid: sentinelUuidRef.current,
      level: 'info',
    }
  }
// 哨兵是 system/informational 消息：走消息渲染通道，
// 不需要为它单独造 UI 分支。

  /** Prepend a page at the front, with scroll-anchor snapshot for non-initial.
   *  Replaces the sentinel (always at index 0 when present) in-place. */
  const prepend = useCallback(
    (page: HistoryPage, isInitial: boolean) => {
      const msgs = pageToMessages(page)
      cursorRef.current = page.hasMore ? page.firstId : null
// 游标推进：还有更旧页 → 记 firstId 作下一页 before_id；
// 否则置 null 封底，后续 loadOlder 直接短路。

      if (!isInitial) {
        const s = scrollRef.current
        anchorRef.current = s
          ? { beforeHeight: s.getFreshScrollHeight(), count: msgs.length }
          : null
      }
// 非首次加载才记锚点：首屏前置发生在挂载时，
// 视口本来就在顶，无需补偿。

      const sentinel = page.hasMore ? null : mkSentinel(SENTINEL_START)
// 没有更旧页时插入「start of session」哨兵——
// 用户滚到顶知道到底了。
      setMessages(prev => {
        // Drop existing sentinel (index 0, known stable UUID — O(1)).
        const base =
          prev[0]?.uuid === sentinelUuidRef.current ? prev.slice(1) : prev
        return sentinel ? [sentinel, ...msgs, ...base] : [...msgs, ...base]
      })
// O(1) 摘除旧哨兵：哨兵恒定在 index 0 且 UUID 已知，
// 不必整表 find。

      logForDebugging(
        `[useAssistantHistory] ${isInitial ? 'initial' : 'older'} page: ${msgs.length} msgs (raw ${page.events.length}), hasMore=${page.hasMore}`,
      )
// 调试日志带原始事件数与可见消息数：两者差异即被过滤掉的事件量，
// 排查「拉了一页却看不到东西」时看这行。
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollRef is a stable ref; mkSentinel reads refs only
    [setMessages],
  )
// useCallback 依赖只有 setMessages；scrollRef/mkSentinel 都走 ref，
// 身份永远稳定（eslint 特批）。

  // Initial fetch on mount — best-effort.
  useEffect(() => {
    if (!enabled || !config) return
    let cancelled = false
    void (async () => {
      const ctx = await createHistoryAuthCtx(config.sessionId).catch(() => null)
      if (!ctx || cancelled) return
      ctxRef.current = ctx
      const page = await fetchLatestEvents(ctx)
      if (cancelled || !page) return
      fillBudgetRef.current = MAX_FILL_PAGES
      prepend(page, true)
// 首屏走 prepend(page, true)：不记锚点，
// 同时把补满预算设为 10 页。
    })()
    return () => {
      cancelled = true
    }
    // config identity is stable (created once in main.tsx, never recreated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
// 挂载效应只依赖 enabled：config 在 main.tsx 创建后不再重建
// （eslint 特批）；cancelled 标志防卸载后 setState。

  const loadOlder = useCallback(async () => {
    if (!enabled || inflightRef.current) return
    const cursor = cursorRef.current
    const ctx = ctxRef.current
    if (!cursor || !ctx) return // null=exhausted, undefined=initial pending
// 三态游标在这里分流：null = 已到底，undefined = 首页未回，
// 两者都直接返回，只有 string 游标才发请求。
    inflightRef.current = true
    // Swap sentinel to "loading…" — O(1) slice since sentinel is at index 0.
    setMessages(prev => {
      const base =
        prev[0]?.uuid === sentinelUuidRef.current ? prev.slice(1) : prev
      return [mkSentinel(SENTINEL_LOADING), ...base]
    })
// 拉取期间把哨兵换成 loading 文案：O(1) slice，
// 因为哨兵恒在 index 0。
    try {
      const page = await fetchOlderEvents(ctx, cursor)
      if (!page) {
        // Fetch failed — revert sentinel back to "start" placeholder so the user
        // can retry on next scroll-up. Cursor is preserved (not nulled out).
        setMessages(prev => {
          const base =
            prev[0]?.uuid === sentinelUuidRef.current ? prev.slice(1) : prev
          return [mkSentinel(SENTINEL_LOADING_FAILED), ...base]
        })
        return
      }
// 失败不回打消游标：哨兵换成 failed 文案，下次上滚会重试
// （游标仍指向同一页）。
      prepend(page, false)
    } finally {
      inflightRef.current = false
    }
// finally 里释放 in-flight 锁：允许下一个滚轮事件再次触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mkSentinel reads refs only
  }, [enabled, prepend, setMessages])

  // Scroll-anchor compensation — after React commits the prepended items,
  // shift scrollTop by the height delta so the viewport stays put. Also
  // fire onPrepend here (not in prepend()) so dividerIndex + baseline ref
  // are shifted with the ACTUAL height delta, not an estimate.
  // No deps: runs every render; cheap no-op when anchorRef is null.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null) return
    anchorRef.current = null
    const s = scrollRef.current
    if (!s || s.isSticky()) return // sticky = pinned bottom; prepend is invisible
    const delta = s.getFreshScrollHeight() - anchor.beforeHeight
    if (delta > 0) s.scrollBy(delta)
    onPrepend?.(anchor.count, delta)
  })
// 布局效应做滚动锚点补偿：用 getFreshScrollHeight 直读 Yoga，
// 拿到的是 commit 后的真实高度；sticky（钉底）态不做补偿——
// 那时前置内容不可见。onPrepend 也在这里调，拿到的是真实高度差
// 而不是预估值。

  // Fill-viewport chain: after paint, if content doesn't exceed the viewport,
  // load another page. Runs as useEffect (not layout effect) so Ink has
  // painted and scrollViewportHeight is populated. Self-chains via next
  // render's effect; budget caps the chain.
  //
  // The ScrollBox content wrapper has flexGrow:1 flexShrink:0 — it's clamped
  // to ≥ viewport. So `content < viewport` is never true; `<=` detects "no
  // overflow yet" correctly. Stops once there's at least something to scroll.
  useEffect(() => {
    if (
      fillBudgetRef.current <= 0 ||
      !cursorRef.current ||
      inflightRef.current
    ) {
      return
    }
    const s = scrollRef.current
    if (!s) return
    const contentH = s.getFreshScrollHeight()
    const viewH = s.getViewportHeight()
    logForDebugging(
      `[useAssistantHistory] fill-check: content=${contentH} viewport=${viewH} budget=${fillBudgetRef.current}`,
    )
    if (contentH <= viewH) {
      fillBudgetRef.current--
      void loadOlder()
    } else {
      fillBudgetRef.current = 0
    }
  })
// 补满链：Ink 画完（useEffect 而非 layout effect）后量高度，
// 内容不超视口就再拉一页，自链到预算耗尽或出现滚动条为止。
// 用 <= 而非 <：ScrollBox 内容壳 flexGrow:1 flexShrink:0，
// 内容永远不低于视口，只有「还没有可滚余量」时才继续拉。

  // Trigger wrapper for onScroll composition in REPL.
  const maybeLoadOlder = useCallback(
    (handle: ScrollBoxHandle) => {
      if (handle.getScrollTop() < PREFETCH_THRESHOLD_ROWS) void loadOlder()
    },
    [loadOlder],
  )
// REPL 把 maybeLoadOlder 组合进 onScroll：距顶 40 行内即触发，
// 与挂载时的补满链共用同一个 loadOlder（有 in-flight 锁，不会重入）。

  return { maybeLoadOlder }
}
