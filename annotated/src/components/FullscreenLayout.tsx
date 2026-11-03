// 本文件是 REPL 的全屏布局壳与未读分隔线机制三合一：useUnseenDivider、未读计数、未读定位三件纯逻辑，FullscreenLayout 双模式布局（全屏等于粘性 ScrollBox 加 flex 钉底；非全屏等于顺序渲染走终端自带回滚），以及未读 pill、粘性提示头、两个浮层等 chrome 零件。本文件注释密度全仓罕见——几乎所有 DECSTBM 与粘性滚动的坑都写进了注释，值得整读。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { createContext, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { fileURLToPath } from 'url';
import { ModalContext } from '../context/modalContext.js';
import { PromptOverlayProvider, usePromptOverlay, usePromptOverlayDialog } from '../context/promptOverlayContext.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import ScrollBox, { type ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import instances from '../ink/instances.js';
import { Box, Text } from '../ink.js';
import type { Message } from '../types/message.js';
import { openBrowser, openPath } from '../utils/browser.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { plural } from '../utils/stringUtils.js';
import { isNullRenderingAttachment } from './messages/nullRenderingAttachments.js';
import PromptInputFooterSuggestions from './PromptInput/PromptInputFooterSuggestions.js';
import type { StickyPrompt } from './VirtualMessageList.js';

/** Rows of transcript context kept visible above the modal pane's ▔ divider. */
// 模态面板底部固定保留 2 行对话回滚（peek），让用户在弹层之下仍能看到上下文尾行；ModalContext 的高度预算也基于它扣减。
const MODAL_TRANSCRIPT_PEEK = 2;

/** Context for scroll-derived chrome (sticky header, pill). StickyTracker
 *  in VirtualMessageList writes via this instead of threading a callback
 *  up through Messages → REPL → FullscreenLayout. The setter is stable so
 *  consuming this context never causes re-renders. */
// 滚动 chrome 上下文：VirtualMessageList 里的 StickyTracker 通过这个 context 写「粘性提示」，避免回调沿 Messages、REPL、FullscreenLayout 逐层穿线；setter 引用稳定，消费方不会因此重渲染。
export const ScrollChromeContext = createContext<{
  setStickyPrompt: (p: StickyPrompt | null) => void;
}>({
  setStickyPrompt: () => {}
});
// Props 契约：scrollable 是滚动主体，bottom 钉底，overlay 叠加在滚动区内（权限请求用），bottomFloat 浮在滚动区右下（语音气泡用），modal 是斜杠命令弹层；另有滚动引用、未读 pill 与粘性头的开关与计数。
type Props = {
  /** Content that scrolls (messages, tool output) */
  scrollable: ReactNode;
  /** Content pinned to the bottom (spinner, prompt, permissions) */
  bottom: ReactNode;
  /** Content rendered inside the ScrollBox after messages — user can scroll
   *  up to see context while it's showing (used by PermissionRequest). */
  overlay?: ReactNode;
  /** Absolute-positioned content anchored at the bottom-right of the
   *  ScrollBox area, floating over scrollback. Rendered inside the flexGrow
   *  region (not the bottom slot) so the overflowY:hidden cap doesn't clip
   *  it. Fullscreen only — used for the companion speech bubble. */
  bottomFloat?: ReactNode;
  /** Slash-command dialog content. Rendered in an absolute-positioned
   *  bottom-anchored pane (▔ divider, paddingX=2) that paints over the
   *  ScrollBox AND bottom slot. Provides ModalContext so Pane/Dialog inside
   *  skip their own frame. Fullscreen only; inline after overlay otherwise. */
  modal?: ReactNode;
  /** Ref passed via ModalContext so Tabs (or any scroll-owning descendant)
   *  can attach it to their own ScrollBox for tall content. */
  modalScrollRef?: React.RefObject<ScrollBoxHandle | null>;
  /** Ref to the scroll box for keyboard scrolling. RefObject (not Ref) so
   *  pillVisible's useSyncExternalStore can subscribe to scroll changes. */
  scrollRef?: RefObject<ScrollBoxHandle | null>;
  /** Y-position (scrollHeight at snapshot) of the unseen-divider. Pill
   *  shows while viewport bottom hasn't reached this. Ref so REPL doesn't
   *  re-render on the one-shot snapshot write. */
  dividerYRef?: RefObject<number | null>;
  /** Force-hide the pill (e.g. viewing a sub-agent task). */
  hidePill?: boolean;
  /** Force-hide the sticky prompt header (e.g. viewing a teammate task). */
  hideSticky?: boolean;
  /** Count for the pill text. 0 → "Jump to bottom", >0 → "N new messages". */
  newMessageCount?: number;
  /** Called when the user clicks the "N new" pill. */
  onPillClick?: () => void;
};

/**
 * Tracks the in-transcript "N new messages" divider position while the
 * user is scrolled up. Snapshots message count AND scrollHeight the first
 * time sticky breaks. scrollHeight ≈ the y-position of the divider in the
 * scroll content (it renders right after the last message that existed at
 * snapshot time).
 *
 * `pillVisible` lives in FullscreenLayout (not here) — it subscribes
 * directly to ScrollBox via useSyncExternalStore with a boolean snapshot
 * against `dividerYRef`, so per-frame scroll never re-renders REPL.
 * `dividerIndex` stays here because REPL needs it for computeUnseenDivider
 * → Messages' divider line; it changes only ~twice/scroll-session
 * (first scroll-away + repin), acceptable REPL re-render cost.
 *
 * `onScrollAway` must be called by every scroll-away action with the
 * handle; `onRepin` by submit/scroll-to-bottom.
 */
// 未读分隔线 hook：用户向上滚离底部时记录快照——消息数与 scrollHeight 各存一份，前者决定分隔线画在消息数组的哪个下标，后者是分隔线在滚动内容坐标系里的 y 位置。pillVisible 故意不放在这里：布局层用 useSyncExternalStore 直接订阅 ScrollBox，每帧滚动不会重渲染 REPL。
export function useUnseenDivider(messageCount: number): {
  /** Index into messages[] where the divider line renders. Cleared on
   *  sticky-resume (scroll back to bottom) so the "N new" line doesn't
   *  linger once everything is visible. */
  dividerIndex: number | null;
  /** scrollHeight snapshot at first scroll-away — the divider's y-position.
   *  FullscreenLayout subscribes to ScrollBox and compares viewport bottom
   *  against this for pillVisible. Ref so writes don't re-render REPL. */
  dividerYRef: RefObject<number | null>;
  onScrollAway: (handle: ScrollBoxHandle) => void;
  onRepin: () => void;
  /** Scroll the handle so the divider line is at the top of the viewport. */
  jumpToNew: (handle: ScrollBoxHandle | null) => void;
  /** Shift dividerIndex and dividerYRef when messages are prepended
   *  (infinite scroll-back). indexDelta = number of messages prepended;
   *  heightDelta = content height growth in rows. */
  shiftDivider: (indexDelta: number, heightDelta: number) => void;
} {
// dividerIndex 是 state（变更会重渲染，但一次滚动会话只变约两次）；dividerYRef 是 ref（只写不触发渲染）。
  const [dividerIndex, setDividerIndex] = useState<number | null>(null);
  // Ref holds the current count for onScrollAway to snapshot. Written in
  // the render body (not useEffect) so wheel events arriving between a
  // message-append render and its effect flush don't capture a stale
  // count (off-by-one in the baseline). React Compiler bails out here —
  // acceptable for a hook instantiated once in REPL.
// countRef 在渲染体里直接同步当前消息数（不走 useEffect）——滚轮事件可能落在「消息追加渲染」与「effect 刷写」之间，用 effect 会拿到旧计数导致基线差一。React Compiler 在这里跳过优化，可接受：hook 只在 REPL 实例化一次。
  const countRef = useRef(messageCount);
  countRef.current = messageCount;
  // scrollHeight snapshot — the divider's y in content coords. Ref-only:
  // read synchronously in onScrollAway (setState is batched, can't
  // read-then-write in the same callback) AND by FullscreenLayout's
  // pillVisible subscription. null = pinned to bottom.
// scrollHeight 快照 ref：onScrollAway 里要同步读（setState 批处理下同一回调里读后写做不到），布局层的 pillVisible 订阅也要读它；null 表示仍钉在底部。
  const dividerYRef = useRef<number | null>(null);
// onRepin（提交或滚回底部）只清 dividerIndex 不清 ref：同一 stdin 批次里赶来的触控板惯性滚轮事件会看到 null 而重新快照、覆盖掉这次清除；ref 的清空推迟到下方 useEffect，等 React 提交完 null 状态再放行。
  const onRepin = useCallback(() => {
    // Don't clear dividerYRef here — a trackpad momentum wheel event
    // racing in the same stdin batch would see null and re-snapshot,
    // overriding the setDividerIndex(null) below. The useEffect below
    // clears the ref after React commits the null dividerIndex, so the
    // ref stays non-null until the state settles.
    setDividerIndex(null);
  }, []);
// onScrollAway 先做「下方无内容」早退，覆盖两种坑：空会话滚上也会断粘性但没东西可跳；点击选区在底部时会 scrollTo 当前位置断粘性防流式内容位移，scrollTop 仍在最大值——pendingDelta 补上累积未落地的滚动量，否则从底部滚上会被误判成没动。
  const onScrollAway = useCallback((handle: ScrollBoxHandle) => {
    // Nothing below the viewport → nothing to jump to. Covers both:
    // • empty/short session: scrollUp calls scrollTo(0) which breaks sticky
    //   even at scrollTop=0 (wheel-up on fresh session showed the pill)
    // • click-to-select at bottom: useDragToScroll.check() calls
    //   scrollTo(current) to break sticky so streaming content doesn't shift
    //   under the selection, then onScroll(false, …) — but scrollTop is still
    //   at max (Sarah Deaton, #claude-code-feedback 2026-03-15)
    // pendingDelta: scrollBy accumulates without updating scrollTop. Without
    // it, wheeling up from max would see scrollTop==max and suppress the pill.
    const max = Math.max(0, handle.getScrollHeight() - handle.getViewportHeight());
    if (handle.getScrollTop() + handle.getPendingDelta() >= max) return;
    // Snapshot only on the FIRST scroll-away. onScrollAway fires on EVERY
    // scroll action (not just the initial break from sticky) — this guard
    // preserves the original baseline so the count doesn't reset on the
    // second PageUp. Subsequent calls are ref-only no-ops (no REPL re-render).
// 只在第一次滚离时快照：onScrollAway 每次滚动都触发，这个 null 守卫保住首次基线——第二次 PageUp 不会重置计数，后续调用只是 ref 级空操作。
    if (dividerYRef.current === null) {
      dividerYRef.current = handle.getScrollHeight();
      // New scroll-away session → move the divider here (replaces old one)
      setDividerIndex(countRef.current);
    }
  }, []);
// jumpToNew 用 scrollToBottom 而非 scrollTo 分隔线 y：scrollToBottom 置 stickyScroll 为 true 让虚拟滚动挂上尾部并钉住 scrollTop；scrollTo 会关掉粘性、在 React 重渲染前被夹回原位停在半路。分隔线保留（下标不清），让用户看到新消息从哪开始。
  const jumpToNew = useCallback((handle_0: ScrollBoxHandle | null) => {
    if (!handle_0) return;
    // scrollToBottom (not scrollTo(dividerY)): sets stickyScroll=true so
    // useVirtualScroll mounts the tail and render-node-to-output pins
    // scrollTop=maxScroll. scrollTo sets stickyScroll=false → the clamp
    // (still at top-range bounds before React re-renders) pins scrollTop
    // back, stopping short. The divider stays rendered (dividerIndex
    // unchanged) so users see where new messages started; the clear on
    // next submit/explicit scroll-to-bottom handles cleanup.
    handle_0.scrollToBottom();
  }, []);

  // Sync dividerYRef with dividerIndex. When onRepin fires (submit,
  // scroll-to-bottom), it sets dividerIndex=null but leaves the ref
  // non-null — a wheel event racing in the same stdin batch would
  // otherwise see null and re-snapshot. Deferring the ref clear to
  // useEffect guarantees the ref stays non-null until React has committed
  // the null dividerIndex, blocking the if-null guard in onScrollAway.
  //
  // Also handles /clear, rewind, teammate-view swap — if the count drops
  // below the divider index, the divider would point at nothing.
// 双向同步 effect：repin 后把 ref 清成 null（拦住竞态滚轮的误快照）；clear、rewind、切换队友视图等导致消息数跌破分隔线下标时整体作废——否则分隔线指向不存在的消息。
  useEffect(() => {
    if (dividerIndex === null) {
      dividerYRef.current = null;
    } else if (messageCount < dividerIndex) {
      dividerYRef.current = null;
      setDividerIndex(null);
    }
  }, [messageCount, dividerIndex]);
// shiftDivider 服务向上无限加载历史：消息从头部插入时分隔线下标与 y 快照同步平移，保持指向同一条消息。
  const shiftDivider = useCallback((indexDelta: number, heightDelta: number) => {
    setDividerIndex(idx => idx === null ? null : idx + indexDelta);
    if (dividerYRef.current !== null) {
      dividerYRef.current += heightDelta;
    }
  }, []);
  return {
    dividerIndex,
    dividerYRef,
    onScrollAway,
    onRepin,
    jumpToNew,
    shiftDivider
  };
}

/**
 * Counts assistant turns in messages[dividerIndex..end). A "turn" is what
 * users think of as "a new message from Claude" — not raw assistant entries
 * (one turn yields multiple entries: tool_use blocks + text blocks). We count
 * non-assistant→assistant transitions, but only for entries that actually
 * carry text — tool-use-only entries are skipped (like progress messages)
 * so "⏺ Searched for 13 patterns, read 6 files" doesn't tick the pill.
 */
// 未读计数：把分隔线之后的消息折算成「几条新消息」——按非 assistant 到 assistant 的跳变数计数，且只算真正带文本的条目；纯工具调用条目与进度消息跳过，避免「搜索了 13 个模式」这种输出也点亮 pill。
export function countUnseenAssistantTurns(messages: readonly Message[], dividerIndex: number): number {
  let count = 0;
  let prevWasAssistant = false;
  for (let i = dividerIndex; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.type === 'progress') continue;
    // Tool-use-only assistant entries aren't "new messages" to the user —
    // skip them the same way we skip progress. prevWasAssistant is NOT
    // updated, so a text block immediately following still counts as the
    // same turn (tool_use + text from one API response = 1).
// 纯工具调用条目跳过时 prevWasAssistant 不更新：同一 API 响应里的 tool_use 块加文本块算同一条消息。
    if (m.type === 'assistant' && !assistantHasVisibleText(m)) continue;
    const isAssistant = m.type === 'assistant';
    if (isAssistant && !prevWasAssistant) count++;
    prevWasAssistant = isAssistant;
  }
  return count;
}
// 判定 assistant 条目是否带可见文本：content 里存在非空 text 块即为真。
function assistantHasVisibleText(m: Message): boolean {
  if (m.type !== 'assistant') return false;
  for (const b of m.message.content) {
    if (b.type === 'text' && b.text.trim() !== '') return true;
  }
  return false;
}
export type UnseenDivider = {
  firstUnseenUuid: Message['uuid'];
  count: number;
};

/**
 * Builds the unseenDivider object REPL passes to Messages + the pill.
 * Returns undefined only when no content has arrived past the divider
 * yet (messages[dividerIndex] doesn't exist). Once ANY message arrives
 * — including tool_use-only assistant entries and tool_result user entries
 * that countUnseenAssistantTurns skips — count floors at 1 so the pill
 * flips from "Jump to bottom" to "1 new message". Without the floor,
 * the pill stays "Jump to bottom" through an entire tool-call sequence
 * until Claude's text response lands.
 */
// 组装未读对象给 REPL 传给 Messages 与 pill：锚点消息要先跳过进度与不渲染的附件——Messages 那边渲染前就把它们过滤掉了，锚着它们的 UUID 会查无此消息（CC-724 修复）。
export function computeUnseenDivider(messages: readonly Message[], dividerIndex: number | null): UnseenDivider | undefined {
  if (dividerIndex === null) return undefined;
  // Skip progress and null-rendering attachments when picking the divider
  // anchor — Messages.tsx filters these out of renderableMessages before the
  // dividerBeforeIndex search, so their UUID wouldn't be found (CC-724).
  // Hook attachments use randomUUID() so nothing shares their 24-char prefix.
  let anchorIdx = dividerIndex;
  while (anchorIdx < messages.length && (messages[anchorIdx]?.type === 'progress' || isNullRenderingAttachment(messages[anchorIdx]!))) {
    anchorIdx++;
  }
  const uuid = messages[anchorIdx]?.uuid;
  if (!uuid) return undefined;
// count 下限 1：只要分隔线之后来了任何消息（哪怕是被计数跳过的纯工具条目），pill 就从「跳到底部」翻成「1 条新消息」——没有这个下限，整段工具调用序列期间 pill 会一直假装没新东西。
  const count = countUnseenAssistantTurns(messages, dividerIndex);
  return {
    firstUnseenUuid: uuid,
    count: Math.max(1, count)
  };
}

/**
 * Layout wrapper for the REPL. In fullscreen mode, puts scrollable
 * content in a sticky-scroll box and pins bottom content via flexbox.
 * Outside fullscreen mode, renders content sequentially so the existing
 * main-screen scrollback rendering works unchanged.
 *
 * Fullscreen mode defaults on for ants (CLAUDE_CODE_NO_FLICKER=0 to opt out)
 * and off for external users (CLAUDE_CODE_NO_FLICKER=1 to opt in).
 * The <AlternateScreen> wrapper
 * (alt buffer + mouse tracking + height constraint) lives at REPL's root
 * so nothing can accidentally render outside it.
 */
// 布局主体：全屏模式滚动内容进粘性 ScrollBox、底部内容 flexbox 钉住；非全屏模式四个槽位顺序渲染，沿用终端主屏回滚。全屏对内部用户默认开、对外部用户默认关，环境变量 CLAUDE_CODE_NO_FLICKER 可翻转；AlternateScreen 包裹层在 REPL 根上，保证没有东西能渲染到它外面。
export function FullscreenLayout(t0) {
  const $ = _c(47);
  const {
    scrollable,
    bottom,
    overlay,
    bottomFloat,
    modal,
    modalScrollRef,
    scrollRef,
    dividerYRef,
    hidePill: t1,
    hideSticky: t2,
    newMessageCount: t3,
    onPillClick
  } = t0;
  const hidePill = t1 === undefined ? false : t1;
  const hideSticky = t2 === undefined ? false : t2;
  const newMessageCount = t3 === undefined ? 0 : t3;
  const {
    rows: terminalRows,
    columns
  } = useTerminalSize();
  const [stickyPrompt, setStickyPrompt] = useState(null);
  let t4;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = {
      setStickyPrompt
    };
    $[0] = t4;
  } else {
    t4 = $[0];
  }
  const chromeCtx = t4;
  let t5;
  if ($[1] !== scrollRef) {
    t5 = listener => scrollRef?.current?.subscribe(listener) ?? _temp;
    $[1] = scrollRef;
    $[2] = t5;
  } else {
    t5 = $[2];
  }
  const subscribe = t5;
  let t6;
  if ($[3] !== dividerYRef || $[4] !== scrollRef) {
    t6 = () => {
      const s = scrollRef?.current;
      const dividerY = dividerYRef?.current;
      if (!s || dividerY == null) {
        return false;
      }
      return s.getScrollTop() + s.getPendingDelta() + s.getViewportHeight() < dividerY;
    };
    $[3] = dividerYRef;
    $[4] = scrollRef;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
// pillVisible 用 useSyncExternalStore 订阅 ScrollBox：快照是布尔值（视口底是否未到分隔线 y），每帧滚动只在布尔翻转时才触发重渲染；subscribe 把监听者接到 scrollRef 指向的 ScrollBox 上。
  const pillVisible = useSyncExternalStore(subscribe, t6);
  let t7;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = [];
    $[6] = t7;
  } else {
    t7 = $[6];
  }
  useLayoutEffect(_temp3, t7);
// 全屏分支：以下全部 chrome（粘性头、pill、浮层、弹层）只在这个模式存在。
  if (isFullscreenEnvEnabled()) {
    const sticky = hideSticky ? null : stickyPrompt;
    const headerPrompt = sticky != null && sticky !== "clicked" && overlay == null ? sticky : null;
    const padCollapsed = sticky != null && overlay == null;
    let t8;
    if ($[7] !== headerPrompt) {
      t8 = headerPrompt && <StickyPromptHeader text={headerPrompt.text} onClick={headerPrompt.scrollTo} />;
      $[7] = headerPrompt;
      $[8] = t8;
    } else {
      t8 = $[8];
    }
    const t9 = padCollapsed ? 0 : 1;
    let t10;
    if ($[9] !== scrollable) {
      t10 = <ScrollChromeContext value={chromeCtx}>{scrollable}</ScrollChromeContext>;
      $[9] = scrollable;
      $[10] = t10;
    } else {
      t10 = $[10];
    }
    let t11;
    if ($[11] !== overlay || $[12] !== scrollRef || $[13] !== t10 || $[14] !== t9) {
// ScrollBox 三件事：flexGrow 吃满剩余空间、stickyScroll 开粘底、paddingTop 在有粘性头时收为 0（头已占一行）；overlay 渲染在消息之后、随内容一起滚。
      t11 = <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column" paddingTop={t9} stickyScroll={true}>{t10}{overlay}</ScrollBox>;
      $[11] = overlay;
      $[12] = scrollRef;
      $[13] = t10;
      $[14] = t9;
      $[15] = t11;
    } else {
      t11 = $[15];
    }
    let t12;
    if ($[16] !== hidePill || $[17] !== newMessageCount || $[18] !== onPillClick || $[19] !== overlay || $[20] !== pillVisible) {
// pill 显示条件四合一：未被强制隐藏、pillVisible 为真、没有 overlay 盖着；count 大于 0 显示「N 条新消息」，否则「跳到底部」。
      t12 = !hidePill && pillVisible && overlay == null && <NewMessagesPill count={newMessageCount} onClick={onPillClick} />;
      $[16] = hidePill;
      $[17] = newMessageCount;
      $[18] = onPillClick;
      $[19] = overlay;
      $[20] = pillVisible;
      $[21] = t12;
    } else {
      t12 = $[21];
    }
    let t13;
    if ($[22] !== bottomFloat) {
      t13 = bottomFloat != null && <Box position="absolute" bottom={0} right={0} opaque={true}>{bottomFloat}</Box>;
      $[22] = bottomFloat;
      $[23] = t13;
    } else {
      t13 = $[23];
    }
    let t14;
    if ($[24] !== t11 || $[25] !== t12 || $[26] !== t13 || $[27] !== t8) {
      t14 = <Box flexGrow={1} flexDirection="column" overflow="hidden">{t8}{t11}{t12}{t13}</Box>;
      $[24] = t11;
      $[25] = t12;
      $[26] = t13;
      $[27] = t8;
      $[28] = t14;
    } else {
      t14 = $[28];
    }
    let t15;
    let t16;
    if ($[29] === Symbol.for("react.memo_cache_sentinel")) {
      t15 = <SuggestionsOverlay />;
      t16 = <DialogOverlay />;
      $[29] = t15;
      $[30] = t16;
    } else {
      t15 = $[29];
      t16 = $[30];
    }
    let t17;
    if ($[31] !== bottom) {
// 底部槽位：建议浮层与对话框浮层先渲染（绝对定位画在输入框上方），bottom 内容外包 overflowY 隐藏的 flex 容器并限高一半——输入区再高也不能吃掉一半屏幕。
      t17 = <Box flexDirection="column" flexShrink={0} width="100%" maxHeight="50%">{t15}{t16}<Box flexDirection="column" width="100%" flexGrow={1} overflowY="hidden">{bottom}</Box></Box>;
      $[31] = bottom;
      $[32] = t17;
    } else {
      t17 = $[32];
    }
    let t18;
    if ($[33] !== columns || $[34] !== modal || $[35] !== modalScrollRef || $[36] !== terminalRows) {
// 斜杠命令弹层：绝对定位贴底、盖住 ScrollBox 与底部槽位，顶部一行重复字符画的分隔线，内容区水平内边距 2；外面包 ModalContext 把可用高度（终端行数减 peek 再减分隔线）与宽度（减 4）下发给内部组件，让弹层内的 Pane 与 Dialog 跳过自己的画框。
      t18 = modal != null && <ModalContext value={{
        rows: terminalRows - MODAL_TRANSCRIPT_PEEK - 1,
        columns: columns - 4,
        scrollRef: modalScrollRef ?? null
      }}><Box position="absolute" bottom={0} left={0} right={0} maxHeight={terminalRows - MODAL_TRANSCRIPT_PEEK} flexDirection="column" overflow="hidden" opaque={true}><Box flexShrink={0}><Text color="permission">{"\u2594".repeat(columns)}</Text></Box><Box flexDirection="column" paddingX={2} flexShrink={0} overflow="hidden">{modal}</Box></Box></ModalContext>;
      $[33] = columns;
      $[34] = modal;
      $[35] = modalScrollRef;
      $[36] = terminalRows;
      $[37] = t18;
    } else {
      t18 = $[37];
    }
    let t19;
    if ($[38] !== t14 || $[39] !== t17 || $[40] !== t18) {
      t19 = <PromptOverlayProvider>{t14}{t17}{t18}</PromptOverlayProvider>;
      $[38] = t14;
      $[39] = t17;
      $[40] = t18;
      $[41] = t19;
    } else {
      t19 = $[41];
    }
    return t19;
  }
  let t8;
// 非全屏路径：四个槽位顺序塞进 fragment，交给终端主屏的既有回滚机制，本文件的所有 chrome 都不渲染。
  if ($[42] !== bottom || $[43] !== modal || $[44] !== overlay || $[45] !== scrollable) {
    t8 = <>{scrollable}{bottom}{overlay}{modal}</>;
    $[42] = bottom;
    $[43] = modal;
    $[44] = overlay;
    $[45] = scrollable;
    $[46] = t8;
  } else {
    t8 = $[46];
  }
  return t8;
}

// Slack-style pill. Absolute overlay at bottom={0} of the scrollwrap — floats
// over the ScrollBox's last content row, only obscuring the centered pill
// text (the rest of the row shows ScrollBox content). Scroll-smear from
// DECSTBM shifting the pill's pixels is repaired at the Ink layer
// (absoluteRectsPrev third-pass in render-node-to-output.ts, #23939). Shows
// "Jump to bottom" when count is 0 (scrolled away but no new messages yet —
// the dead zone where users previously thought chat stalled).
function _temp3() {
  if (!isFullscreenEnvEnabled()) {
    return;
  }
  const ink = instances.get(process.stdout);
  if (!ink) {
    return;
  }
  ink.onHyperlinkClick = _temp2;
  return () => {
    ink.onHyperlinkClick = undefined;
  };
}
function _temp2(url) {
  if (url.startsWith("file:")) {
    try {
      openPath(fileURLToPath(url));
    } catch {}
  } else {
    openBrowser(url);
  }
}
function _temp() {}
// 未读 pill（Slack 式胶囊）：绝对定位钉在滚动区底行中央，只遮住胶囊文字那一小段；DECSTBM 挪动像素造成的滚动拖影在 Ink 渲染层修复（render-node-to-output 的第三遍扫描）。
function NewMessagesPill(t0) {
  const $ = _c(10);
  const {
    count,
    onClick
  } = t0;
  const [hover, setHover] = useState(false);
  let t1;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => setHover(true);
    t2 = () => setHover(false);
    $[0] = t1;
    $[1] = t2;
  } else {
    t1 = $[0];
    t2 = $[1];
  }
  const t3 = hover ? "userMessageBackgroundHover" : "userMessageBackground";
  let t4;
  if ($[2] !== count) {
    t4 = count > 0 ? `${count} new ${plural(count, "message")}` : "Jump to bottom";
    $[2] = count;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  let t5;
  if ($[4] !== t3 || $[5] !== t4) {
    t5 = <Text backgroundColor={t3} dimColor={true}>{" "}{t4}{" "}{figures.arrowDown}{" "}</Text>;
    $[4] = t3;
    $[5] = t4;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] !== onClick || $[8] !== t5) {
    t6 = <Box position="absolute" bottom={0} left={0} right={0} justifyContent="center"><Box onClick={onClick} onMouseEnter={t1} onMouseLeave={t2}>{t5}</Box></Box>;
    $[7] = onClick;
    $[8] = t5;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  return t6;
}

// Context breadcrumb: when scrolled up into history, pin the current
// conversation turn's prompt above the viewport so you know what Claude was
// responding to. Normal-flow sibling BEFORE the ScrollBox (mirrors the pill
// below it) — shrinks the ScrollBox by exactly 1 row via flex, stays outside
// the DECSTBM scroll region. Click jumps back to the prompt.
//
// Height is FIXED at 1 row (truncate-end for long prompts). A variable-height
// header (1 when short, 2 when wrapped) shifts the ScrollBox by 1 row every
// time the sticky prompt switches during scroll — content jumps on screen
// even with scrollTop unchanged (the DECSTBM region top shifts with the
// ScrollBox, and the diff engine sees "everything moved"). Fixed height
// keeps the ScrollBox anchored; only the header TEXT changes, not its box.
// 粘性提示头：滚进历史时把当前轮次的用户提示钉在视口上方一行，点击跳回该提示。关键取舍——高度固定 1 行（长提示截断）：变高头部会让 ScrollBox 每次切换粘性提示时整体位移 1 行，DECSTBM 区域顶跟着动，diff 引擎看到「全部移动」，画面跳动。
function StickyPromptHeader(t0) {
  const $ = _c(8);
  const {
    text,
    onClick
  } = t0;
  const [hover, setHover] = useState(false);
  const t1 = hover ? "userMessageBackgroundHover" : "userMessageBackground";
  let t2;
  let t3;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => setHover(true);
    t3 = () => setHover(false);
    $[0] = t2;
    $[1] = t3;
  } else {
    t2 = $[0];
    t3 = $[1];
  }
  let t4;
  if ($[2] !== text) {
    t4 = <Text color="subtle" wrap="truncate-end">{figures.pointer} {text}</Text>;
    $[2] = text;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  let t5;
  if ($[4] !== onClick || $[5] !== t1 || $[6] !== t4) {
    t5 = <Box flexShrink={0} width="100%" height={1} paddingRight={1} backgroundColor={t1} onClick={onClick} onMouseEnter={t2} onMouseLeave={t3}>{t4}</Box>;
    $[4] = onClick;
    $[5] = t1;
    $[6] = t4;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  return t5;
}

// Slash-command suggestion overlay — see promptOverlayContext.tsx for why
// it's portaled. Scroll-smear from floating over the DECSTBM region is
// repaired at the Ink layer (absoluteRectsPrev in render-node-to-output.ts).
// The renderer clamps negative y to 0 for absolute elements (see
// render-node-to-output.ts), so the top rows (best matches) stay visible
// even when the overlay extends above the viewport. We omit minHeight and
// flex-end here: they would create empty padding rows that shift visible
// items down into the prompt area when the list has fewer items than max.
// 斜杠建议浮层：从 promptOverlayContext 门控（portal 化）渲染在输入框上方；渲染器对绝对定位元素的负 y 坐标夹到 0，所以列表超出视口顶部时最好的匹配仍在可见区。故意不设 minHeight 与 flex-end——会在列表不满时制造空行，把可见项往下挤进输入区。
function SuggestionsOverlay() {
  const $ = _c(4);
  const data = usePromptOverlay();
  if (!data || data.suggestions.length === 0) {
    return null;
  }
  let t0;
  if ($[0] !== data.maxColumnWidth || $[1] !== data.selectedSuggestion || $[2] !== data.suggestions) {
    t0 = <Box position="absolute" bottom="100%" left={0} right={0} paddingX={2} paddingTop={1} flexDirection="column" opaque={true}><PromptInputFooterSuggestions suggestions={data.suggestions} selectedSuggestion={data.selectedSuggestion} maxColumnWidth={data.maxColumnWidth} overlay={true} /></Box>;
    $[0] = data.maxColumnWidth;
    $[1] = data.selectedSuggestion;
    $[2] = data.suggestions;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}

// Dialog portaled from PromptInput (AutoModeOptInDialog) — same clip-escape
// pattern as SuggestionsOverlay. Renders later in tree order so it paints
// over suggestions if both are ever up (they shouldn't be).
// 对话框浮层：AutoModeOptInDialog 从 PromptInput portal 过来，与建议浮层同一套「逃离裁剪」模式；树序靠后所以两者同时出现时盖在建议上面（正常不应同时出现）。
function DialogOverlay() {
  const $ = _c(2);
  const node = usePromptOverlayDialog();
  if (!node) {
    return null;
  }
  let t0;
  if ($[0] !== node) {
    t0 = <Box position="absolute" bottom="100%" left={0} right={0} opaque={true}>{node}</Box>;
    $[0] = node;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  return t0;
}
// 原文件此处有一行 59868 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。