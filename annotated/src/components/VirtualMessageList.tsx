// 全屏模式的消息列表虚拟滚动组件。一个文件承担三件事：按视口挂载（只渲染范围窗口）、可跳转的全文搜索索引（jump / step / highlight 三段）、以及顶部粘性提示头（`StickyTracker`）。之所以从 `Messages.tsx` 拆出来，是为了让 `useVirtualScroll` 无条件调用，满足 hooks 规则——`Messages.tsx` 是在虚拟列表和普通 `map` 之间条件渲染。
import { c as _c } from "react/compiler-runtime";
import type { RefObject } from 'react';
import * as React from 'react';
import { useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { useVirtualScroll } from '../hooks/useVirtualScroll.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import type { DOMElement } from '../ink/dom.js';
import type { MatchPosition } from '../ink/render-to-screen.js';
import { Box } from '../ink.js';
import type { RenderableMessage } from '../types/message.js';
import { TextHoverColorContext } from './design-system/ThemedText.js';
import { ScrollChromeContext } from './FullscreenLayout.js';

// Rows of breathing room above the target when we scrollTo.
const HEADROOM = 3;
// 锚点常量：跳转落点是「消息顶部再上移 3 行」，留出呼吸空间。因为滚动目标按消息顶算，偏移方向只能往上，所以这个值不会是负数；下面 `targetFor` 还会再夹一次 0 兜住内容顶部。
import { logForDebugging } from '../utils/debug.js';
import { sleep } from '../utils/sleep.js';
import { renderableSearchText } from '../utils/transcriptSearch.js';
import { isNavigableMessage, type MessageActionsNav, type MessageActionsState, type NavigableMessage, stripSystemReminders, toolCallOf } from './messageActions.js';

// 兜底取文器：给没有预热缓存的调用方（测试、静态场景）用，自己维护一份 lower 之后的 `WeakMap`。`Messages.tsx` 走的是带工具名提取的自有缓存路径，所以这里只是旁路。
// Fallback extractor: lower + cache here for callers without the
// Messages.tsx tool-lookup path (tests, static contexts). Messages.tsx
// provides its own lowering cache that also handles tool extractSearchText.
const fallbackLowerCache = new WeakMap<RenderableMessage, string>();
function defaultExtractSearchText(msg: RenderableMessage): string {
  const cached = fallbackLowerCache.get(msg);
  if (cached !== undefined) return cached;
  const lowered = renderableSearchText(msg);
  fallbackLowerCache.set(msg, lowered);
  return lowered;
}
// 粘性头的对外契约：文本加一个可点击跳回的滚动函数。类型里还混入了一个 `clicked` 哨兵值（联合类型跨过注释续写），作用是「头部隐藏但内边距保持塌陷」，点完之后内容首行正好落在屏幕第 0 行而不是第 1 行。
export type StickyPrompt = {
  text: string;
  scrollTo: () => void;
}
// Click sets this — header HIDES but padding stays collapsed (0) so
// the content ❯ lands at screen row 0 instead of row 1. Cleared on
// the next sticky-prompt compute (user scrolls again).
| 'clicked';

// `STICKY_TEXT_CAP`：粘贴进来的巨型提示（比如用 cat 把整个文件喂进来）可能有几 MB。头部靠 `overflow:hidden` 最多折成两行，这个上限只约束传给 React 的字符串体积，不改变显示效果。
/** Huge pasted prompts (cat file | claude) can be MBs. Header wraps into
 *  2 rows via overflow:hidden — this just bounds the React prop size. */
const STICKY_TEXT_CAP = 500;

// 命令式句柄：用于对话记录里的跳转与搜索。方法必须在这个组件内部实现，因为匹配位置依赖 `renderableMessages` 的下标——`Messages.tsx` 会过滤和重排，外部算不出来。
/** Imperative handle for transcript navigation. Methods compute matches
 *  HERE (renderableMessages indices are only valid inside this component —
 *  Messages.tsx filters and reorders, REPL can't compute externally). */
export type JumpHandle = {
  jumpToIndex: (i: number) => void;
  setSearchQuery: (q: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  /** Capture current scrollTop as the incsearch anchor. Typing jumps
   *  around as preview; 0-matches snaps back here. Enter/n/N never
   *  restore (they don't call setSearchQuery with empty). Next / call
   *  overwrites. */
  setAnchor: () => void;
  /** Warm the search-text cache by extracting every message's text.
   *  Returns elapsed ms, or 0 if already warm (subsequent / in same
   *  transcript session). Yields before work so the caller can paint
   *  "indexing…" first. Caller shows "indexed in Xms" on resolve. */
  warmSearchIndex: () => Promise<number>;
  /** Manual scroll (j/k/PgUp/wheel) exited the search context. Clear
   *  positions (yellow goes away, inverse highlights stay). Next n/N
   *  re-establishes via step()→jump(). Wired from ScrollKeybindingHandler's
   *  onScroll — only fires for keyboard/wheel, not programmatic scrollTo. */
  disarmSearch: () => void;
};
// 组件入参。三个值得留意的点：`columns` 变化必须让高度缓存失效（不同宽度下文本重排，缓存高度会错，滚上去直接黑屏）；`extractSearchText` 期望拿到「已经 lower 过」的文本，这样 `setSearchQuery` 的每次击键循环只剩 `indexOf`，零 `toLowerCase` 分配；`scanElement` 负责把已渲染的 DOM 子树刷到新 Screen 再扫描，能覆盖任意高度的消息。
type Props = {
  messages: RenderableMessage[];
  scrollRef: RefObject<ScrollBoxHandle | null>;
  /** Invalidates heightCache on change — cached heights from a different
   *  width are wrong (text rewrap → black screen on scroll-up after widen). */
  columns: number;
  itemKey: (msg: RenderableMessage) => string;
  renderItem: (msg: RenderableMessage, index: number) => React.ReactNode;
  /** Fires when a message Box is clicked (toggle per-message verbose). */
  onItemClick?: (msg: RenderableMessage) => void;
  /** Per-item filter — suppress hover/click for messages where the verbose
   *  toggle does nothing (text, file edits, etc). Defaults to all-clickable. */
  isItemClickable?: (msg: RenderableMessage) => boolean;
  /** Expanded items get a persistent grey bg (not just on hover). */
  isItemExpanded?: (msg: RenderableMessage) => boolean;
  /** PRE-LOWERED search text. Messages.tsx caches the lowered result
   *  once at warm time so setSearchQuery's per-keystroke loop does
   *  only indexOf (zero toLowerCase alloc). Falls back to a lowering
   *  wrapper on renderableSearchText for callers without the cache. */
  extractSearchText?: (msg: RenderableMessage) => string;
  /** Enable the sticky-prompt tracker. StickyTracker writes via
   *  ScrollChromeContext (not a callback prop) so state lives in
   *  FullscreenLayout instead of REPL. */
  trackStickyPrompt?: boolean;
  selectedIndex?: number;
  /** Nav handle lives here because height measurement lives here. */
  cursorNavRef?: React.Ref<MessageActionsNav>;
  setCursor?: (c: MessageActionsState | null) => void;
  jumpRef?: RefObject<JumpHandle | null>;
  /** Fires when search matches change (query edit, n/N). current is
   *  1-based for "3/47" display; 0 means no matches. */
  onSearchMatchesChange?: (count: number, current: number) => void;
  /** Paint existing DOM subtree to fresh Screen, scan. Element from the
   *  main tree (all providers). Message-relative positions (row 0 = el
   *  top). Works for any height — closes the tall-message gap. */
  scanElement?: (el: DOMElement) => MatchPosition[];
  /** Position-based CURRENT highlight. Positions known upfront (from
   *  scanElement), navigation = index arithmetic + scrollTo. rowOffset
   *  = message's current screen-top; positions stay stable. */
  setPositions?: (state: {
    positions: MatchPosition[];
    rowOffset: number;
    currentIdx: number;
  } | null) => void;
};

/**
 * Returns the text of a real user prompt, or null for anything else.
 * "Real" = what the human typed: not tool results, not XML-wrapped payloads
 * (<bash-stdout>, <command-message>, <teammate-message>, etc.), not meta.
 *
 * Two shapes land here: NormalizedUserMessage (normal prompts) and
 * AttachmentMessage with type==='queued_command' (prompts sent mid-turn
 * while a tool was executing — they get drained as attachments on the
 * next turn, see query.ts:1410). Both render as ❯-prefixed UserTextMessage
 * in the UI so both should stick.
 *
 * Leading <system-reminder> blocks are stripped before checking — they get
 * prepended to the stored text for Claude's context (memory updates, auto
 * mode reminders) but aren't what the user typed. Without stripping, any
 * prompt that happened to get a reminder is rejected by the startsWith('<')
 * check. Shows up on `cc -c` resumes where memory-update reminders are dense.
 */
// 粘性提示文本的缓存。键是消息对象（追加式、不可变），所以 `WeakMap` 命中永远有效。`StickyTracker` 每个滚动 tick 会用同一批消息调用 5 到 50 次以上，而剥掉系统提示每次都会新分配字符串；缓存顺带在压缩 / 清空（`messages` 数组被替换）时自动回收。
const promptTextCache = new WeakMap<RenderableMessage, string | null>();
// 取「真实用户提示」的文本，其他一律返回 null。判定四步：先按消息类型取原文，再剥掉前导的系统提醒块，然后以尖括号开头的（工具结果、XML 包裹负载）一律拒绝，空串拒绝。
function stickyPromptText(msg: RenderableMessage): string | null {
  // Cache keyed on message object — messages are append-only and don't
  // mutate, so a WeakMap hit is always valid. The walk (StickyTracker,
  // per-scroll-tick) calls this 5-50+ times with the SAME messages every
  // tick; the system-reminder strip allocates a fresh string on each
  // parse. WeakMap self-GCs on compaction/clear (messages[] replaced).
  const cached = promptTextCache.get(msg);
  if (cached !== undefined) return cached;
  const result = computeStickyPromptText(msg);
  promptTextCache.set(msg, result);
  return result;
}
// 真正的提取逻辑。两种来源：普通用户消息取第一个 text 块；排队命令（工具执行中用户插话）以附件形式出现，`commandMode` 为 `task-notification` 的排除。
function computeStickyPromptText(msg: RenderableMessage): string | null {
  let raw: string | null = null;
  if (msg.type === 'user') {
    if (msg.isMeta || msg.isVisibleInTranscriptOnly) return null;
    const block = msg.message.content[0];
    if (block?.type !== 'text') return null;
    raw = block.text;
  } else if (msg.type === 'attachment' && msg.attachment.type === 'queued_command' && msg.attachment.commandMode !== 'task-notification' && !msg.attachment.isMeta) {
    const p = msg.attachment.prompt;
    raw = typeof p === 'string' ? p : p.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n');
  }
  if (raw === null) return null;
  const t = stripSystemReminders(raw);
  if (t.startsWith('<') || t === '') return null;
  return t;
}

/**
 * Virtualized message list for fullscreen mode. Split from Messages.tsx so
 * useVirtualScroll is called unconditionally (rules-of-hooks) — Messages.tsx
 * conditionally renders either this or a plain .map().
 *
 * The wrapping <Box ref> is the measurement anchor — MessageRow doesn't take
 * a ref. Single-child column Box passes Yoga height through unchanged.
 */
type VirtualItemProps = {
  itemKey: string;
  msg: RenderableMessage;
  idx: number;
  measureRef: (key: string) => (el: DOMElement | null) => void;
  expanded: boolean | undefined;
  hovered: boolean;
  clickable: boolean;
  onClickK: (msg: RenderableMessage, cellIsBlank: boolean) => void;
  onEnterK: (k: string) => void;
  onLeaveK: (k: string) => void;
  renderItem: (msg: RenderableMessage, idx: number) => React.ReactNode;
};

// 为什么不给 `VirtualItem` 加 `React.memo`：`renderItem` 每帧都是新闭包，把它放进比较器等于让 memo 永远失效；忽略它又会在命中时用过期闭包（选中的高亮、展开态都会错）。折中办法是把三个逐项闭包换成「稳定回调加绑定 key」，让 JIT 能内联；真正省 CPU 的其实是内层 `MessageRow.memo` 的命中。
// Item wrapper with stable click handlers. The per-item closures were the
// `operationNewArrowFunction` leafs → `FunctionExecutable::finalizeUnconditionally`
// GC cleanup (16% of GC time during fast scroll). 3 closures × 60 mounted ×
// 10 commits/sec = 1800 closures/sec. With stable onClickK/onEnterK/onLeaveK
// threaded via itemKey, the closures here are per-item-per-render but CHEAP
// (just wrap the stable callback with k bound) and don't close over msg/idx
// which lets JIT inline them. The bigger win is inside: MessageRow.memo
// bails for unchanged msgs, skipping marked.lexer + formatToken.
//
// NOT React.memo'd — renderItem captures changing state (cursor, selectedIdx,
// verbose). Memoing with a comparator that ignores renderItem would use a
// STALE closure on bail (wrong selection highlight, stale verbose). Including
// renderItem in the comparator defeats memo since it's fresh each render.
// 编译产物读法：`$ = _c(30)` 是 30 个记忆槽，`$[n] !== x` 的成对分支等价于 `useMemo` 的依赖比较，`t1` 到 `t10` 是被提升的中间表达式。真正要读的是逻辑骨架——测量 ref 按 key 记忆、三个事件处理器按点击态派生、最后拼成一个 `Box`。
function VirtualItem(t0) {
  const $ = _c(30);
  const {
    itemKey: k,
    msg,
    idx,
    measureRef,
    expanded,
    hovered,
    clickable,
    onClickK,
    onEnterK,
    onLeaveK,
    renderItem
  } = t0;
  let t1;
  if ($[0] !== k || $[1] !== measureRef) {
    t1 = measureRef(k);
    $[0] = k;
    $[1] = measureRef;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const t2 = expanded ? "userMessageBackgroundHover" : undefined;
  const t3 = expanded ? 1 : undefined;
  let t4;
  if ($[3] !== clickable || $[4] !== msg || $[5] !== onClickK) {
    t4 = clickable ? e => onClickK(msg, e.cellIsBlank) : undefined;
    $[3] = clickable;
    $[4] = msg;
    $[5] = onClickK;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== clickable || $[8] !== k || $[9] !== onEnterK) {
    t5 = clickable ? () => onEnterK(k) : undefined;
    $[7] = clickable;
    $[8] = k;
    $[9] = onEnterK;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== clickable || $[12] !== k || $[13] !== onLeaveK) {
    t6 = clickable ? () => onLeaveK(k) : undefined;
    $[11] = clickable;
    $[12] = k;
    $[13] = onLeaveK;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  const t7 = hovered && !expanded ? "text" : undefined;
  let t8;
  if ($[15] !== idx || $[16] !== msg || $[17] !== renderItem) {
    t8 = renderItem(msg, idx);
    $[15] = idx;
    $[16] = msg;
    $[17] = renderItem;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  let t9;
  if ($[19] !== t7 || $[20] !== t8) {
    t9 = <TextHoverColorContext.Provider value={t7}>{t8}</TextHoverColorContext.Provider>;
    $[19] = t7;
    $[20] = t8;
    $[21] = t9;
  } else {
    t9 = $[21];
  }
  let t10;
  if ($[22] !== t1 || $[23] !== t2 || $[24] !== t3 || $[25] !== t4 || $[26] !== t5 || $[27] !== t6 || $[28] !== t9) {
    t10 = <Box ref={t1} flexDirection="column" backgroundColor={t2} paddingBottom={t3} onClick={t4} onMouseEnter={t5} onMouseLeave={t6}>{t9}</Box>;
    $[22] = t1;
    $[23] = t2;
    $[24] = t3;
    $[25] = t4;
    $[26] = t5;
    $[27] = t6;
    $[28] = t9;
    $[29] = t10;
  } else {
    t10 = $[29];
  }
  return t10;
}
// 组件主体：先算 key、再取虚拟滚动句柄、然后装配两套命令式接口（光标导航、跳转搜索），最后渲染窗口切片。
export function VirtualMessageList({
  messages,
  scrollRef,
  columns,
  itemKey,
  renderItem,
  onItemClick,
  isItemClickable,
  isItemExpanded,
  extractSearchText = defaultExtractSearchText,
  trackStickyPrompt,
  selectedIndex,
  cursorNavRef,
  setCursor,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions
}: Props): React.ReactNode {
// 性能关键：增量维护 key 数组。流式追加每次只多一条消息，如果每次提交都 `map` 出一整个字符串数组，27k 条消息时每次分配约 1MB。可以在「`itemKey` 函数身份没变、消息数没变少、首条消息没换对象」三个条件同时满足时走增量；压缩、`/clear`、换 key 函数都会让首条变掉，于是退回全量重建。
  // Incremental key array. Streaming appends one message at a time; rebuilding
  // the full string array on every commit allocates O(n) per message (~1MB
  // churn at 27k messages). Append-only delta push when the prefix matches;
  // fall back to full rebuild on compaction, /clear, or itemKey change.
  const keysRef = useRef<string[]>([]);
  const prevMessagesRef = useRef<typeof messages>(messages);
  const prevItemKeyRef = useRef(itemKey);
  if (prevItemKeyRef.current !== itemKey || messages.length < keysRef.current.length || messages[0] !== prevMessagesRef.current[0]) {
    keysRef.current = messages.map(m => itemKey(m));
  } else {
    for (let i = keysRef.current.length; i < messages.length; i++) {
      keysRef.current.push(itemKey(messages[i]!));
    }
  }
  prevMessagesRef.current = messages;
  prevItemKeyRef.current = itemKey;
  const keys = keysRef.current;
  const {
    range,
    topSpacer,
    bottomSpacer,
    measureRef,
    spacerRef,
    offsets,
    getItemTop,
    getItemElement,
    getItemHeight,
    scrollToIndex
  } = useVirtualScroll(scrollRef, keys, columns);
  const [start, end] = range;

// 可见性判定兼可导航过滤：高度为 0 的是被折叠的消息，直接跳过；再要求是导航目标（用户消息、工具调用等），纯文本块不参与光标移动。未测量的项（高度为空）视为可见——宁可多停一次，也不要跳过一条其实在屏幕上的消息。
  // Unmeasured (undefined height) falls through — assume visible.
  const isVisible = useCallback((i: number) => {
    const h = getItemHeight(i);
    if (h === 0) return false;
    return isNavigableMessage(messages[i]!);
  }, [getItemHeight, messages]);
// 光标导航句柄。`scan` 是核心：从 `from` 起按 `dir` 步进，落在第一个满足谓词的位置就 `setCursor`。`enterCursor` 从尾部往前找第一条用户消息（shift 加上箭头 的语义与光标内 shift 加上箭头 一致）；`navigateNext` 越界时不是硬停，而是滚到底并清掉光标。
  useImperativeHandle(cursorNavRef, (): MessageActionsNav => {
    const select = (m: NavigableMessage) => setCursor?.({
      uuid: m.uuid,
      msgType: m.type,
      expanded: false,
      toolName: toolCallOf(m)?.name
    });
    const selIdx = selectedIndex ?? -1;
    const scan = (from: number, dir: 1 | -1, pred: (i: number) => boolean = isVisible) => {
      for (let i = from; i >= 0 && i < messages.length; i += dir) {
        if (pred(i)) {
          select(messages[i]!);
          return true;
        }
      }
      return false;
    };
    const isUser = (i: number) => isVisible(i) && messages[i]!.type === 'user';
    return {
      // Entry via shift+↑ = same semantic as in-cursor shift+↑ (prevUser).
      enterCursor: () => scan(messages.length - 1, -1, isUser),
      navigatePrev: () => scan(selIdx - 1, -1),
      navigateNext: () => {
        if (scan(selIdx + 1, 1)) return;
        // Past last visible → exit + repin. Last message's TOP is at viewport
        // top (selection-scroll effect); its BOTTOM may be below the fold.
        scrollRef.current?.scrollToBottom();
        setCursor?.(null);
      },
      // type:'user' only — queued_command attachments look like prompts but have no raw UserMessage to rewind to.
      navigatePrevUser: () => scan(selIdx - 1, -1, isUser),
      navigateNextUser: () => scan(selIdx + 1, 1, isUser),
      navigateTop: () => scan(0, 1),
      navigateBottom: () => scan(messages.length - 1, -1),
      getSelected: () => selIdx >= 0 ? messages[selIdx] ?? null : null
    };
  }, [messages, selectedIndex, setCursor, isVisible]);
// `jumpState` 是穿透 ref：`offsets`、`messages` 这些每次渲染都换身份，放进 `useImperativeHandle` 的依赖里会让句柄每帧重建，命令式调用方拿到的引用会一直失效。所以句柄只依赖 `scrollRef`，其余状态通过这个 ref 读最新值。
  // Two-phase jump + search engine. Read-through-ref so the handle stays
  // stable across renders — offsets/messages identity changes every render,
  // can't go in useImperativeHandle deps without recreating the handle.
  const jumpState = useRef({
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex
  });
  jumpState.current = {
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex
  };

// 保持选中项可见。依赖只写 `selectedIndex` 与 `scrollRef`：`offsets` 每帧重建，若把它写进依赖，鼠标滚轮每动一格都会重新钉一次视口。已挂载就直接 `scrollToElement`，未挂载走 `scrollToIndex` 把它挂上来，下一次导航再精确。
  // Keep cursor-selected message visible. offsets rebuilds every render
  // — as a bare dep this re-pinned on every mousewheel tick. Read through
  // jumpState instead; past-overscan jumps land via scrollToIndex, next
  // nav is precise.
  useEffect(() => {
    if (selectedIndex === undefined) return;
    const s = jumpState.current;
    const el = s.getItemElement(selectedIndex);
    if (el) {
      scrollRef.current?.scrollToElement(el, 1);
    } else {
      s.scrollToIndex(selectedIndex);
    }
  }, [selectedIndex, scrollRef]);

// 两阶段跳转。`jump()` 只负责「把目标滚进挂载范围」并记下请求，真正的扫描放在 `seekGen` 触发的被动副作用里——那时 DOM 已经画完，元素必然存在。找不到就带更近的锚点重试一次。
  // Pending seek request. jump() sets this + bumps seekGen. The seek
  // effect fires post-paint (passive effect — after resetAfterCommit),
  // checks if target is mounted. Yes → scan+highlight. No → re-estimate
  // with a fresher anchor (start moved toward idx) and scrollTo again.
  const scanRequestRef = useRef<{
    idx: number;
    wantLast: boolean;
    tries: number;
  } | null>(null);
  // Message-relative positions from scanElement. Row 0 = message top.
  // Stable across scroll — highlight computes rowOffset fresh. msgIdx
  // for computing rowOffset = getItemTop(msgIdx) - scrollTop.
  const elementPositions = useRef<{
    msgIdx: number;
    positions: MatchPosition[];
  }>({
    msgIdx: -1,
    positions: []
  });
// 两个防死循环的守卫：`startPtrRef` 记住本轮起点，指针绕回起点说明所有匹配消息都是「引擎有、渲染无」的幽灵，直接放弃；`phantomBurstRef` 限制一次连发最多 20 个幽灵，避免扫不到时无限自动前进。
  // Wraparound guard. Auto-advance stops if ptr wraps back to here.
  const startPtrRef = useRef(-1);
  // Phantom-burst cap. Resets on scan success.
  const phantomBurstRef = useRef(0);
  // One-deep queue: n/N arriving mid-seek gets stored (not dropped) and
  // fires after the seek completes. Holding n stays smooth without
  // queueing 30 jumps. Latest press overwrites — we want the direction
  // the user is going NOW, not where they were 10 keypresses ago.
  const pendingStepRef = useRef<1 | -1 | 0>(0);
// 搜索状态。`matches` 是去重后的消息下标（一条消息一条），`prefixSum[k]` 是第 k 条匹配消息之前的累计出现次数，用来算「3/47」这样的全局序号。引擎按 `indexOf` 计数，与渲染计数可能略有偏差，作为位置提示足够。
  // step + highlight via ref so the seek effect reads latest without
  // closure-capture or deps churn.
  const stepRef = useRef<(d: 1 | -1) => void>(() => {});
  const highlightRef = useRef<(ord: number) => void>(() => {});
  const searchState = useRef({
    matches: [] as number[],
    // deduplicated msg indices
    ptr: 0,
    screenOrd: 0,
    // Cumulative engine-occurrence count before each matches[k]. Lets us
    // compute a global current index: prefixSum[ptr] + screenOrd + 1.
    // Engine-counted (indexOf on extractSearchText), not render-counted —
    // close enough for the badge; exact counts would need scanElement on
    // every matched message (~1-3ms × N). total = prefixSum[matches.length].
    prefixSum: [] as number[]
  });
  // scrollTop at the moment / was pressed. Incsearch preview-jumps snap
  // back here when matches drop to 0. -1 = no anchor (before first /).
  const searchAnchor = useRef(-1);
  const indexWarmed = useRef(false);

  // Scroll target for message i: land at MESSAGE TOP. est = top - HEADROOM
  // so lo = top - est = HEADROOM ≥ 0 (or lo = top if est clamped to 0).
  // Post-clamp read-back in jump() handles the scrollHeight boundary.
  // No frac (render transform didn't respect it), no monotone clamp
  // (was a safety net for frac garbage — without frac, est IS the next
  // message's top, spam-n/N converges because message tops are ordered).
// 跳转目标：消息顶部减 `HEADROOM`，再夹到 0。不做小数插值（渲染变换不吃这个值），也不做单调夹取——去掉小数之后估算值本身就等于下一条消息的顶部，连锁按 n 会自然收敛。
  function targetFor(i: number): number {
    const top = jumpState.current.getItemTop(i);
    return Math.max(0, top - HEADROOM);
  }

  // Highlight positions[ord]. Positions are MESSAGE-RELATIVE (row 0 =
  // element top, from scanElement). Compute rowOffset = getItemTop -
  // scrollTop fresh. If ord's position is off-viewport, scroll to bring
  // it in, recompute rowOffset. setPositions triggers overlay write.
// 高亮写入。位置是「消息相对」的（第 0 行等于元素顶），每帧重算行偏移把消息相对行换算成屏幕绝对行。关键一步是加 `viewportTop`：滚动内容在屏幕上不是从 0 行开始（`FullscreenLayout` 给 `ScrollBox` 有 `paddingTop`，上面还可能有头部），不加就会差一到多行。
  function highlight(ord: number): void {
    const s = scrollRef.current;
    const {
      msgIdx,
      positions
    } = elementPositions.current;
    if (!s || positions.length === 0 || msgIdx < 0) {
      setPositions?.(null);
      return;
    }
    const idx = Math.max(0, Math.min(ord, positions.length - 1));
    const p = positions[idx]!;
    const top = jumpState.current.getItemTop(msgIdx);
    // lo = item's position within scroll content (wrapper-relative).
    // viewportTop = where the scroll content starts on SCREEN (after
    // ScrollBox padding/border + any chrome above). Highlight writes to
    // screen-absolute, so rowOffset = viewportTop + lo. Observed: off-by-
    // 1+ without viewportTop (FullscreenLayout has paddingTop=1 on the
    // ScrollBox, plus any header above).
    const vpTop = s.getViewportTop();
    let lo = top - s.getScrollTop();
    const vp = s.getViewportHeight();
    let screenRow = vpTop + lo + p.row;
    // Off viewport → scroll to bring it in (HEADROOM from top).
    // scrollTo commits sync; read-back after gives fresh lo.
    if (screenRow < vpTop || screenRow >= vpTop + vp) {
      s.scrollTo(Math.max(0, top + p.row - HEADROOM));
      lo = top - s.getScrollTop();
      screenRow = vpTop + lo + p.row;
    }
    setPositions?.({
      positions,
      rowOffset: vpTop + lo,
      currentIdx: idx
    });
    // Badge: global current = sum of occurrences before this msg + ord+1.
    // prefixSum[ptr] is engine-counted (indexOf on extractSearchText);
    // may drift from render-count for ghost messages but close enough —
    // badge is a rough location hint, not a proof.
    const st = searchState.current;
    const total = st.prefixSum.at(-1) ?? 0;
    const current = (st.prefixSum[st.ptr] ?? 0) + idx + 1;
    onSearchMatchesChange?.(total, current);
    logForDebugging(`highlight(i=${msgIdx}, ord=${idx}/${positions.length}): ` + `pos={row:${p.row},col:${p.col}} lo=${lo} screenRow=${screenRow} ` + `badge=${current}/${total}`);
  }
  highlightRef.current = highlight;

// seek 副作用只依赖 `seekGen`。这是刻意的：如果让 `onSearchMatchesChange` 之类的回调进依赖，增量搜索期间每次击键都会重跑这个扫描。
  // Seek effect. jump() sets scanRequestRef + scrollToIndex + bump.
  // bump → re-render → useVirtualScroll mounts the target (scrollToIndex
  // guarantees this — scrollTop and topSpacer agree via the same
  // offsets value) → resetAfterCommit paints → this passive effect
  // fires POST-PAINT with the element mounted. Precise scrollTo + scan.
  //
  // Dep is ONLY seekGen — effect doesn't re-run on random renders
  // (onSearchMatchesChange churn during incsearch).
  const [seekGen, setSeekGen] = useState(0);
  const bumpSeek = useCallback(() => setSeekGen(g => g + 1), []);
// 扫描主体。顺序是：取请求、确认元素已挂载且高度非 0、清请求、精确滚到顶部减 `HEADROOM`、`scanElement` 拿匹配位置。三个特殊分支要留意：挂载失败最多重试一次；扫到 0 个位置判定为幽灵并自动前进（超过 20 次就停）；扫描期间按下的 n / N 只存一个（最新覆盖），扫描完成后补发。
  useEffect(() => {
    const req = scanRequestRef.current;
    if (!req) return;
    const {
      idx,
      wantLast,
      tries
    } = req;
    const s = scrollRef.current;
    if (!s) return;
    const {
      getItemElement,
      getItemTop,
      scrollToIndex
    } = jumpState.current;
    const el = getItemElement(idx);
    const h = el?.yogaNode?.getComputedHeight() ?? 0;
    if (!el || h === 0) {
      // Not mounted after scrollToIndex. Shouldn't happen — scrollToIndex
      // guarantees mount by construction (scrollTop and topSpacer agree
      // via the same offsets value). Sanity: retry once, then skip.
      if (tries > 1) {
        scanRequestRef.current = null;
        logForDebugging(`seek(i=${idx}): no mount after scrollToIndex, skip`);
        stepRef.current(wantLast ? -1 : 1);
        return;
      }
      scanRequestRef.current = {
        idx,
        wantLast,
        tries: tries + 1
      };
      scrollToIndex(idx);
      bumpSeek();
      return;
    }
    scanRequestRef.current = null;
    // Precise scrollTo — scrollToIndex got us in the neighborhood
    // (item is mounted, maybe a few-dozen rows off due to overscan
    // estimate drift). Now land it at top-HEADROOM.
    s.scrollTo(Math.max(0, getItemTop(idx) - HEADROOM));
    const positions = scanElement?.(el) ?? [];
    elementPositions.current = {
      msgIdx: idx,
      positions
    };
    logForDebugging(`seek(i=${idx} t=${tries}): ${positions.length} positions`);
    if (positions.length === 0) {
      // Phantom — engine matched, render didn't. Auto-advance.
      if (++phantomBurstRef.current > 20) {
        phantomBurstRef.current = 0;
        return;
      }
      stepRef.current(wantLast ? -1 : 1);
      return;
    }
    phantomBurstRef.current = 0;
    const ord = wantLast ? positions.length - 1 : 0;
    searchState.current.screenOrd = ord;
    startPtrRef.current = -1;
    highlightRef.current(ord);
    const pending = pendingStepRef.current;
    if (pending) {
      pendingStepRef.current = 0;
      stepRef.current(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekGen]);

// `jump` 只做两件事：清掉旧高亮、把目标滚进挂载范围。已挂载且高度非 0 就直接精确滚；否则 `scrollToIndex` 保证挂载——`scrollTop` 与 `topSpacer` 用同一份 offsets，构造上自洽，不需要估算。
  // Scroll to message i's top, arm scanPending. scan-effect reads fresh
  // screen next tick. wantLast: N-into-message — screenOrd = length-1.
  function jump(i: number, wantLast: boolean): void {
    const s = scrollRef.current;
    if (!s) return;
    const js = jumpState.current;
    const {
      getItemElement,
      scrollToIndex
    } = js;
    // offsets is a Float64Array whose .length is the allocated buffer (only
    // grows) — messages.length is the logical item count.
    if (i < 0 || i >= js.messages.length) return;
    // Clear stale highlight before scroll. Between now and the seek
    // effect's highlight, inverse-only from scan-highlight shows.
    setPositions?.(null);
    elementPositions.current = {
      msgIdx: -1,
      positions: []
    };
    scanRequestRef.current = {
      idx: i,
      wantLast,
      tries: 0
    };
    const el = getItemElement(i);
    const h = el?.yogaNode?.getComputedHeight() ?? 0;
    // Mounted → precise scrollTo. Unmounted → scrollToIndex mounts it
    // (scrollTop and topSpacer agree via the same offsets value — exact
    // by construction, no estimation). Seek effect does the precise
    // scrollTo after paint either way.
    if (el && h > 0) {
      s.scrollTo(targetFor(i));
    } else {
      scrollToIndex(i);
    }
    bumpSeek();
  }

// `step` 是 n / N 的推进器，三层：当前消息内还有位置就只挪屏幕序号；当前消息用完就推进指针、跳到下一条匹配消息重扫；指针绕回起点就判定全是幽灵并清屏。`pendingStepRef` 是一格深的队列——扫描在途时的按键存起来，扫描结束补发，长按 n 才顺滑。
  // Advance screenOrd within elementPositions. Exhausted → ptr advances,
  // jump to next matches[ptr], re-scan. Phantom (scan found 0 after
  // jump) triggers auto-advance from scan-effect. Wraparound guard stops
  // if every message is a phantom.
  function step(delta: 1 | -1): void {
    const st = searchState.current;
    const {
      matches,
      prefixSum
    } = st;
    const total = prefixSum.at(-1) ?? 0;
    if (matches.length === 0) return;

    // Seek in-flight — queue this press (one-deep, latest overwrites).
    // The seek effect fires it after highlight.
    if (scanRequestRef.current) {
      pendingStepRef.current = delta;
      return;
    }
    if (startPtrRef.current < 0) startPtrRef.current = st.ptr;
    const {
      positions
    } = elementPositions.current;
    const newOrd = st.screenOrd + delta;
    if (newOrd >= 0 && newOrd < positions.length) {
      st.screenOrd = newOrd;
      highlight(newOrd); // updates badge internally
      startPtrRef.current = -1;
      return;
    }

    // Exhausted visible. Advance ptr → jump → re-scan.
    const ptr = (st.ptr + delta + matches.length) % matches.length;
    if (ptr === startPtrRef.current) {
      setPositions?.(null);
      startPtrRef.current = -1;
      logForDebugging(`step: wraparound at ptr=${ptr}, all ${matches.length} msgs phantoms`);
      return;
    }
    st.ptr = ptr;
    st.screenOrd = 0; // resolved after scan (wantLast → length-1)
    jump(matches[ptr]!, delta < 0);
    // screenOrd will resolve after scan. Best-effort: prefixSum[ptr] + 0
    // for n (first pos), prefixSum[ptr+1] for N (last pos = count-1).
    // The scan-effect's highlight will be the real value; this is a
    // pre-scan placeholder so the badge updates immediately.
    const placeholder = delta < 0 ? prefixSum[ptr + 1] ?? total : prefixSum[ptr]! + 1;
    onSearchMatchesChange?.(total, placeholder);
  }
// 把最新闭包挂到 ref 上：扫描副作用与幽灵自动前进都要调用最新的 `step`，但这两处的依赖数组刻意保持空或很窄，只能通过 ref 拿。
  stepRef.current = step;
  useImperativeHandle(jumpRef, () => ({
    // Non-search jump (sticky header click, etc). No scan, no positions.
    jumpToIndex: (i: number) => {
      const s = scrollRef.current;
      if (s) s.scrollTo(targetFor(i));
    },
    setSearchQuery: (q: string) => {
      // New search invalidates everything.
      scanRequestRef.current = null;
      elementPositions.current = {
        msgIdx: -1,
        positions: []
      };
      startPtrRef.current = -1;
      setPositions?.(null);
      const lq = q.toLowerCase();
      // One entry per MESSAGE (deduplicated). Boolean "does this msg
      // contain the query". ~10ms for 9k messages with cached lowered.
// 一次性建索引：每条消息算一个是否命中的布尔项，同时累计每条消息内的出现次数，写进 `prefixSum`。9k 条消息、带 lower 缓存时约 10ms。指针定位用「离锚点最近的消息」：以当前视口第一条消息的顶部为原点换算每条匹配消息的绝对位置，取距离最小者（相等取后者）。有锚点用锚点，没有就用当前 `scrollTop`。
      const matches: number[] = [];
      // Per-message occurrence count → prefixSum for global current
      // index. Engine-counted (cheap indexOf loop); may differ from
      // render-count (scanElement) for ghost/phantom messages but close
      // enough for the badge. The badge is a rough location hint.
      const prefixSum: number[] = [0];
      if (lq) {
        const msgs = jumpState.current.messages;
        for (let i = 0; i < msgs.length; i++) {
          const text = extractSearchText(msgs[i]!);
          let pos = text.indexOf(lq);
          let cnt = 0;
          while (pos >= 0) {
            cnt++;
            pos = text.indexOf(lq, pos + lq.length);
          }
          if (cnt > 0) {
            matches.push(i);
            prefixSum.push(prefixSum.at(-1)! + cnt);
          }
        }
      }
      const total = prefixSum.at(-1)!;
      // Nearest MESSAGE to the anchor. <= so ties go to later.
      let ptr = 0;
      const s = scrollRef.current;
      const {
        offsets,
        start,
        getItemTop
      } = jumpState.current;
      const firstTop = getItemTop(start);
      const origin = firstTop >= 0 ? firstTop - offsets[start]! : 0;
      if (matches.length > 0 && s) {
        const curTop = searchAnchor.current >= 0 ? searchAnchor.current : s.getScrollTop();
        let best = Infinity;
        for (let k = 0; k < matches.length; k++) {
          const d = Math.abs(origin + offsets[matches[k]!]! - curTop);
          if (d <= best) {
            best = d;
            ptr = k;
          }
        }
        logForDebugging(`setSearchQuery('${q}'): ${matches.length} msgs · ptr=${ptr} ` + `msgIdx=${matches[ptr]} curTop=${curTop} origin=${origin}`);
      }
      searchState.current = {
        matches,
        ptr,
        screenOrd: 0,
        prefixSum
      };
      if (matches.length > 0) {
        // wantLast=true: preview the LAST occurrence in the nearest
        // message. At sticky-bottom (common / entry), nearest is the
        // last msg; its last occurrence is closest to where the user
        // was — minimal view movement. n advances forward from there.
        jump(matches[ptr]!, true);
      } else if (searchAnchor.current >= 0 && s) {
        // /foob → 0 matches → snap back to anchor. less/vim incsearch.
        s.scrollTo(searchAnchor.current);
      }
      // Global occurrence count + 1-based current. wantLast=true so the
      // scan will land on the last occurrence in matches[ptr]. Placeholder
      // = prefixSum[ptr+1] (count through this msg). highlight() updates
      // to the exact value after scan completes.
      onSearchMatchesChange?.(total, matches.length > 0 ? prefixSum[ptr + 1] ?? total : 0);
    },
    nextMatch: () => step(1),
    prevMatch: () => step(-1),
    setAnchor: () => {
      const s = scrollRef.current;
      if (s) searchAnchor.current = s.getScrollTop();
    },
    disarmSearch: () => {
      // Manual scroll invalidates screen-absolute positions.
      setPositions?.(null);
      scanRequestRef.current = null;
      elementPositions.current = {
        msgIdx: -1,
        positions: []
      };
      startPtrRef.current = -1;
    },
    warmSearchIndex: async () => {
      if (indexWarmed.current) return 0;
      const msgs = jumpState.current.messages;
// 预热索引。分 500 条一块，每块前让出一次主线程，这样调用方可以先画出「正在建索引」，再回来显示耗时。已经预热过则直接返回 0。
      const CHUNK = 500;
      let workMs = 0;
      const wallStart = performance.now();
      for (let i = 0; i < msgs.length; i += CHUNK) {
        await sleep(0);
        const t0 = performance.now();
        const end = Math.min(i + CHUNK, msgs.length);
        for (let j = i; j < end; j++) {
          extractSearchText(msgs[j]!);
        }
        workMs += performance.now() - t0;
      }
      const wallMs = Math.round(performance.now() - wallStart);
      logForDebugging(`warmSearchIndex: ${msgs.length} msgs · work=${Math.round(workMs)}ms wall=${wallMs}ms chunks=${Math.ceil(msgs.length / CHUNK)}`);
      indexWarmed.current = true;
      return Math.round(workMs);
    }
  }),
  // Closures over refs + callbacks. scrollRef stable; others are
  // useCallback([]) or prop-drilled from REPL (stable).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [scrollRef]);

// `StickyTracker` 放在列表内容之后。它返回空，不产生 DOM 节点，顺序理论上无所谓；但放前面会让它自己的高频提交沿着兄弟项一路协调下去，放后面就是一个叶子节点的协调。
  // StickyTracker goes AFTER the list content. It returns null (no DOM node)
  // so order shouldn't matter for layout — but putting it first means every
  // fine-grained commit from its own scroll subscription reconciles THROUGH
  // the sibling items (React walks children in order). After the items, it's
  // a leaf reconcile. Defensive: also avoids any Yoga child-index quirks if
  // the Ink reconciler ever materializes a placeholder for null returns.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Stable click/hover handlers — called with k, dispatch from a ref so
  // closure identity doesn't change per render. The per-item handler
  // closures (`e => ...`, `() => setHoveredKey(k)`) were the
  // `operationNewArrowFunction` leafs in the scroll CPU profile; their
  // cleanup was 16% of GC time (`FunctionExecutable::finalizeUnconditionally`).
  // Allocating 3 closures × 60 mounted items × 10 commits/sec during fast
  // scroll = 1800 short-lived closures/sec. With stable refs the item
  // wrapper props don't change → VirtualItem.memo bails for the ~35
  // unchanged items, only ~25 fresh items pay createElement cost.
// 三个稳定回调。之前的写法是每个消息项自己造三个闭包（点击、进入、离开），实测快速滚动时每秒产生约 1800 个短命闭包，其回收占了 GC 时间的 16%。改成「稳定回调加 key 绑定」后，未变化的项 props 不变，内层组件可以整体跳过。
  const handlersRef = useRef({
    onItemClick,
    setHoveredKey
  });
  handlersRef.current = {
    onItemClick,
    setHoveredKey
  };
  const onClickK = useCallback((msg: RenderableMessage, cellIsBlank: boolean) => {
    const h = handlersRef.current;
    if (!cellIsBlank && h.onItemClick) h.onItemClick(msg);
  }, []);
  const onEnterK = useCallback((k: string) => {
    handlersRef.current.setHoveredKey(k);
  }, []);
  const onLeaveK = useCallback((k: string) => {
    handlersRef.current.setHoveredKey(prev => prev === k ? null : prev);
  }, []);
// 渲染：顶部占位、窗口切片、底部占位、粘性跟踪器。切片用 `messages.slice(start, end)`，`start` 与 `end` 来自虚拟滚动的范围窗口，两侧占位块把总高度撑到真实高度。
  return <>
      <Box ref={spacerRef} height={topSpacer} flexShrink={0} />
      {messages.slice(start, end).map((msg, i) => {
      const idx = start + i;
      const k = keys[idx]!;
      const clickable = !!onItemClick && (isItemClickable?.(msg) ?? true);
      const hovered = clickable && hoveredKey === k;
      const expanded = isItemExpanded?.(msg);
      return <VirtualItem key={k} itemKey={k} msg={msg} idx={idx} measureRef={measureRef} expanded={expanded} hovered={hovered} clickable={clickable} onClickK={onClickK} onEnterK={onEnterK} onLeaveK={onLeaveK} renderItem={renderItem} />;
    })}
      {bottomSpacer > 0 && <Box height={bottomSpacer} flexShrink={0} />}
      {trackStickyPrompt && <StickyTracker messages={messages} start={start} end={end} offsets={offsets} getItemTop={getItemTop} getItemElement={getItemElement} scrollRef={scrollRef} />}
    </>;
}
// 空订阅的占位函数：`scrollRef.current` 还没就绪时，外部状态订阅需要一个稳定的订阅器，用模块级常量避免每次渲染都换身份导致反复重订阅。
const NOOP_UNSUB = () => {};

/**
 * Effect-only child that tracks the last user-prompt scrolled above the
 * viewport top and fires onChange when it changes.
 *
 * Rendered as a separate component (not a hook in VirtualMessageList) so it
 * can subscribe to scroll at FINER granularity than SCROLL_QUANTUM=40. The
 * list needs the coarse quantum to avoid per-wheel-tick Yoga relayouts; this
 * tracker is just a walk + comparison and can afford to run every tick. When
 * it re-renders alone, the list's reconciled output is unchanged (same props
 * from the parent's last commit) — no Yoga work. Without this split, the
 * header lags by ~one conversation turn (40 rows ≈ one prompt + response).
 *
 * firstVisible derivation: item Boxes are direct Yoga children of the
 * ScrollBox content wrapper (fragments collapse in the Ink DOM), so
 * yoga.getComputedTop is content-wrapper-relative — same coordinate space as
 * scrollTop. Compare against scrollTop + pendingDelta (the scroll TARGET —
 * scrollBy only sets pendingDelta, committed scrollTop lags). Walk backward
 * from the mount-range end; break when an item's top is above target.
 */
// 粘性提示跟踪器。它被拆成独立组件（而不是列表里的一个 hook），目的是用比滚动量子更细的粒度订阅：列表本体需要粗粒度来避免每格滚轮都触发 Yoga 重排，而这里只是走一遍加比较，可以每个 tick 都跑。拆开之后它自己重渲染时，列表的协调输出不变（props 来自父组件上一次提交），没有 Yoga 开销。
function StickyTracker({
  messages,
  start,
  end,
  offsets,
  getItemTop,
  getItemElement,
  scrollRef
}: {
  messages: RenderableMessage[];
  start: number;
  end: number;
  offsets: ArrayLike<number>;
  getItemTop: (index: number) => number;
  getItemElement: (index: number) => DOMElement | null;
  scrollRef: RefObject<ScrollBoxHandle | null>;
}): null {
  const {
    setStickyPrompt
  } = useContext(ScrollChromeContext);
// 细粒度订阅：快照是「未量化的 `scrollTop` 加待定增量」，并把粘性位折进符号里（负数偏移），这样「变粘」也会触发——滚到底时 `scrollToBottom` 只置粘性位、不动 `scrollTop`。
  // Fine-grained subscription — snapshot is unquantized scrollTop+delta so
  // every scroll action (wheel tick, PgUp, drag) triggers a re-render of
  // THIS component only. Sticky bit folded into the sign so sticky→broken
  // also triggers (scrollToBottom sets sticky without moving scrollTop).
  const subscribe = useCallback((listener: () => void) => scrollRef.current?.subscribe(listener) ?? NOOP_UNSUB, [scrollRef]);
  useSyncExternalStore(subscribe, () => {
    const s = scrollRef.current;
    if (!s) return NaN;
    const t = s.getScrollTop() + s.getPendingDelta();
    return s.isSticky() ? -1 - t : t;
  });

  // Read live scroll state on every render.
  const isSticky = scrollRef.current?.isSticky() ?? true;
  const target = Math.max(0, (scrollRef.current?.getScrollTop() ?? 0) + (scrollRef.current?.getPendingDelta() ?? 0));

// 从挂载范围尾部往回走，找到第一条顶部在视口目标位置之下的消息。范围来自父组件的粗粒度渲染，可能略微过期，但 overscan 保证它两边都超出视口很多。还没有 Yoga 布局的新挂载项按「在视口内」处理——否则会给一条其实还在屏幕上的提示显示粘性头。
  // Walk the mounted range to find the first item at-or-below the viewport
  // top. `range` is from the parent's coarse-quantum render (may be slightly
  // stale) but overscan guarantees it spans well past the viewport in both
  // directions. Items without a Yoga layout yet (newly mounted this frame)
  // are treated as at-or-below — they're somewhere in view, and assuming
  // otherwise would show a sticky for a prompt that's actually on screen.
  let firstVisible = start;
  let firstVisibleTop = -1;
  for (let i = end - 1; i >= start; i--) {
    const top = getItemTop(i);
    if (top >= 0) {
      if (top < target) break;
      firstVisibleTop = top;
    }
    firstVisible = i;
  }
  let idx = -1;
  let text: string | null = null;
  if (firstVisible > 0 && !isSticky) {
    for (let i = firstVisible - 1; i >= 0; i--) {
      const t = stickyPromptText(messages[i]!);
      if (t === null) continue;
      // The prompt's wrapping Box top is above target (that's why it's in
      // the [0, firstVisible) range), but its ❯ is at top+1 (marginTop=1).
      // If the ❯ is at-or-below target, it's VISIBLE at viewport top —
      // showing the same text in the header would duplicate it. Happens
      // in the 1-row gap between Box top scrolling past and ❯ scrolling
      // past. Skip to the next-older prompt (its ❯ is definitely above).
      const top = getItemTop(i);
      if (top >= 0 && top + 1 >= target) continue;
      idx = i;
      text = t;
      break;
    }
  }
  const baseOffset = firstVisibleTop >= 0 ? firstVisibleTop - offsets[firstVisible]! : 0;
  const estimate = idx >= 0 ? Math.max(0, baseOffset + offsets[idx]!) : -1;

// 点击跳转到尚未挂载的消息时的修正状态。点击时先滚到估算位置把它挂上来，等它出现后这个 ref 负责按元素重新锚定；重试上限 5 次，防止清屏竞态下元素永远不出现。
  // For click-jumps to items not yet mounted (user scrolled far past,
  // prompt is in the topSpacer). Click handler scrolls to the estimate
  // to mount it; this anchors by element once it appears. scrollToElement
  // defers the Yoga-position read to render time (render-node-to-output
  // reads el.yogaNode.getComputedTop() in the SAME calculateLayout pass
  // that produces scrollHeight) — no throttle race. Cap retries: a /clear
  // race could unmount the item mid-sequence.
  const pending = useRef({
    idx: -1,
    tries: 0
  });
  // Suppression state machine. The click handler arms; the onChange effect
  // consumes (armed→force) then fires-and-clears on the render AFTER that
  // (force→none). The force step poisons the dedup: after click, idx often
  // recomputes to the SAME prompt (its top is still above target), so
  // without force the last.idx===idx guard would hold 'clicked' until the
  // user crossed a prompt boundary. Previously encoded in last.idx as
  // -1/-2/-3 which overlapped with real indices — too clever.
// 抑制状态机：`none` 到 `armed` 到 `force` 再到 `none`。点击处理函数只负责置 `armed`，变更副作用消费一次并转 `force`，下一次渲染再清回 `none`。为什么非要 `force` 这一步：点击后算出来的下标往往还是同一条提示（它的顶部仍在目标位置之上），如果没有强制位，按下标去重会把「已点击」状态一直挂着，直到用户跨过下一条提示。
  type Suppress = 'none' | 'armed' | 'force';
  const suppress = useRef<Suppress>('none');
  // Dedup on idx only — estimate derives from firstVisibleTop which shifts
  // every scroll tick, so including it in the key made the guard dead
  // (setStickyPrompt fired a fresh {text,scrollTo} per-frame). The scrollTo
  // closure still captures the current estimate; it just doesn't need to
  // re-fire when only estimate moved.
  const lastIdx = useRef(-1);

// 顺序硬约束：这个副作用必须在前，修正副作用在后。修正副作用会在「元素刚挂载」的那一帧把待定状态清掉；如果设粘性头排在它后面，那道门禁就形同虚设，跳转中途会用旧提示重设头部、把点击后的状态覆盖掉。
  // setStickyPrompt effect FIRST — must see pending.idx before the
  // correction effect below clears it. On the estimate-fallback path, the
  // render that mounts the item is ALSO the render where correction clears
  // pending; if this ran second, the pending gate would be dead and
  // setStickyPrompt(prevPrompt) would fire mid-jump, re-mounting the
  // header over 'clicked'.
  useEffect(() => {
    // Hold while two-phase correction is in flight.
    if (pending.current.idx >= 0) return;
    if (suppress.current === 'armed') {
      suppress.current = 'force';
      return;
    }
    const force = suppress.current === 'force';
    suppress.current = 'none';
    if (!force && lastIdx.current === idx) return;
    lastIdx.current = idx;
    if (text === null) {
      setStickyPrompt(null);
      return;
    }
    // First paragraph only (split on blank line) — a prompt like
    // "still seeing bugs:\n\n1. foo\n2. bar" previews as just the
    // lead-in. trimStart so a leading blank line (queued_command mid-
    // turn messages sometimes have one) doesn't find paraEnd at 0.
    const trimmed = text.trimStart();
    const paraEnd = trimmed.search(/\n\s*\n/);
    const collapsed = (paraEnd >= 0 ? trimmed.slice(0, paraEnd) : trimmed).slice(0, STICKY_TEXT_CAP).replace(/\s+/g, ' ').trim();
    if (collapsed === '') {
      setStickyPrompt(null);
      return;
    }
    const capturedIdx = idx;
    const capturedEstimate = estimate;
    setStickyPrompt({
      text: collapsed,
      scrollTo: () => {
        // Hide header, keep padding collapsed — FullscreenLayout's
        // 'clicked' sentinel → scrollBox_y=0 + pad=0 → viewportTop=0.
        setStickyPrompt('clicked');
        suppress.current = 'armed';
        // scrollToElement anchors by DOMElement ref, not a number:
        // render-node-to-output reads el.yogaNode.getComputedTop() at
        // paint time (same Yoga pass as scrollHeight). No staleness from
        // the throttled render — the ref is stable, the position read is
        // deferred. offset=1 = UserPromptMessage marginTop.
        const el = getItemElement(capturedIdx);
        if (el) {
          scrollRef.current?.scrollToElement(el, 1);
        } else {
          // Not mounted (scrolled far past — in topSpacer). Jump to
          // estimate to mount it; correction effect re-anchors once it
          // appears. Estimate is DEFAULT_ESTIMATE-based — lands short.
          scrollRef.current?.scrollTo(capturedEstimate);
          pending.current = {
            idx: capturedIdx,
            tries: 0
          };
        }
      }
    });
    // No deps — must run every render. Suppression state lives in a ref
    // (not idx/estimate), so a deps-gated effect would never see it tick.
    // Body's own guards short-circuit when nothing changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

// 修正副作用：按元素重新锚定。`scrollToElement` 把 Yoga 位置读取推迟到绘制时（与 `scrollHeight` 同一次布局），所以不存在「节流渲染读到旧位置」的问题。
  // Correction: for click-jumps to unmounted items. Click handler scrolled
  // to the estimate; this re-anchors by element once the item appears.
  // scrollToElement defers the Yoga read to paint time — deterministic.
  // SECOND so it clears pending AFTER the onChange gate above has seen it.
  useEffect(() => {
    if (pending.current.idx < 0) return;
    const el = getItemElement(pending.current.idx);
    if (el) {
      scrollRef.current?.scrollToElement(el, 1);
      pending.current = {
        idx: -1,
        tries: 0
      };
    } else if (++pending.current.tries > 5) {
      pending.current = {
        idx: -1,
        tries: 0
      };
    }
  });
  return null;
}
// 原文件此处有一行 104116 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。