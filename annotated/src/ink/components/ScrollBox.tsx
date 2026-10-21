import React, { type PropsWithChildren, type Ref, useImperativeHandle, useRef, useState } from 'react';
import type { Except } from 'type-fest';
import { markScrollActivity } from '../../bootstrap/state.js';
import type { DOMElement } from '../dom.js';
import { markDirty, scheduleRenderFrom } from '../dom.js';
import { markCommitStart } from '../reconciler.js';
import type { Styles } from '../styles.js';
import '../global.d.ts';
import Box from './Box.js';
export type ScrollBoxHandle = {
  scrollTo: (y: number) => void;
  scrollBy: (dy: number) => void;
  /**
   * Scroll so `el`'s top is at the viewport top (plus `offset`). Unlike
   * scrollTo which bakes a number that's stale by the time the throttled
   * render fires, this defers the position read to render time —
   * render-node-to-output reads `el.yogaNode.getComputedTop()` in the
   * SAME Yoga pass that computes scrollHeight. Deterministic. One-shot.
   */
  scrollToElement: (el: DOMElement, offset?: number) => void;
  scrollToBottom: () => void;
  getScrollTop: () => number;
  getPendingDelta: () => number;
  getScrollHeight: () => number;
  /**
   * Like getScrollHeight, but reads Yoga directly instead of the cached
   * value written by render-node-to-output (throttled, up to 16ms stale).
   * Use when you need a fresh value in useLayoutEffect after a React commit
   * that grew content. Slightly more expensive (native Yoga call).
   */
  getFreshScrollHeight: () => number;
  getViewportHeight: () => number;
  /**
   * Absolute screen-buffer row of the first visible content line (inside
   * padding). Used for drag-to-scroll edge detection.
   */
  getViewportTop: () => number;
  /**
   * True when scroll is pinned to the bottom. Set by scrollToBottom, the
   * initial stickyScroll attribute, and by the renderer when positional
   * follow fires (scrollTop at prevMax, content grows). Cleared by
   * scrollTo/scrollBy. Stable signal for "at bottom" that doesn't depend on
   * layout values (unlike scrollTop+viewportH >= scrollHeight).
   */
  isSticky: () => boolean;
  /**
   * Subscribe to imperative scroll changes (scrollTo/scrollBy/scrollToBottom).
   * Does NOT fire for stickyScroll updates done by the Ink renderer — those
   * happen during Ink's render phase after React has committed. Callers that
   * care about the sticky case should treat "at bottom" as a fallback.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Set the render-time scrollTop clamp to the currently-mounted children's
   * coverage span. Called by useVirtualScroll after computing its range;
   * render-node-to-output clamps scrollTop to [min, max] so burst scrollTo
   * calls that race past React's async re-render show the edge of mounted
   * content instead of blank spacer. Pass undefined to disable (sticky,
   * cold start).
   */
  setClampBounds: (min: number | undefined, max: number | undefined) => void;
};
// 这个接口的注释密度（12 个方法，8 个带多行说明）本身就是文档：
// **每个方法的注释都在解释一个踩过的坑**。
//
// 三个最典型的：
//   scrollToElement  为什么不能烘焙数字（渲染时读才准）
//   getFreshScrollHeight  为什么需要「新鲜」版本（缓存值最多 16ms 旧）
//   isSticky         为什么不能靠 scrollTop + viewportH >= scrollHeight 判断
//
// 读法建议：先读这个类型，再读实现。实现里那些看起来绕的地方，
// 大半是为了满足这里某条注释里的约束。
export type ScrollBoxProps = Except<Styles, 'textWrap' | 'overflow' | 'overflowX' | 'overflowY'> & {
  ref?: Ref<ScrollBoxHandle>;
  /**
   * When true, automatically pins scroll position to the bottom when content
   * grows. Unset manually via scrollTo/scrollBy to break the stickiness.
   */
  stickyScroll?: boolean;
};
// 把 overflow 三个键从 Props 里排除，是因为它们被**写死**成 scroll
// （第 226-227 行）。留着的话调用方传 overflow="hidden" 会以为生效，
// 实际上被覆盖 —— 又是一个「宁可编译报错」的取舍。
//
// stickyScroll 是唯一暴露的行为开关，而且它是**双向**的：
// props 通过 DOM attribute 传（首帧生效），scrollTo/scrollBy 通过
// `el.stickyScroll = false` 打断（运行期生效）。第 187 行的
// `el.stickyScroll ?? Boolean(el.attributes['stickyScroll'])`
// 就是这两种来源的优先级：**命令式的覆盖优先于声明式的**。

/**
 * A Box with `overflow: scroll` and an imperative scroll API.
 *
 * Children are laid out at their full Yoga-computed height inside a
 * constrained container. At render time, only children intersecting the
 * visible window (scrollTop..scrollTop+height) are rendered (viewport
 * culling). Content is translated by -scrollTop and clipped to the box bounds.
 *
 * Works best inside a fullscreen (constrained-height root) Ink tree.
 */
// 结构说明在这里一次讲完：
//
//   ink-box（视口，overflow: scroll，高度被约束）
//     └─ Box（内容，flexGrow 1 / flexShrink 0，至少填满视口）
//          └─ children
//
// 关键在 flexShrink: 0 —— 内容**不许被压缩**，于是一个高 200 行的
// 列表在 30 行的视口里仍然是 200 行（yoga 用 Overflow.Scroll 阻止
// 视口跟着内容长高）。视口裁掉看不见的部分，靠的是渲染期按
// scrollTop 剔除子节点（viewport culling），不是 yoga 的裁剪。
function ScrollBox({
  children,
  ref,
  stickyScroll,
  ...style
}: PropsWithChildren<ScrollBoxProps>): React.ReactNode {
  const domRef = useRef<DOMElement>(null);
  // scrollTo/scrollBy bypass React: they mutate scrollTop on the DOM node,
  // mark it dirty, and call the root's throttled scheduleRender directly.
  // The Ink renderer reads scrollTop from the node — no React state needed,
  // no reconciler overhead per wheel event. The microtask defer coalesces
  // multiple scrollBy calls in one input batch (discreteUpdates) into one
  // render — otherwise scheduleRender's leading edge fires on the FIRST
  // event before subsequent events mutate scrollTop. scrollToBottom still
  // forces a React render: sticky is attribute-observed, no DOM-only path.
// 【为什么绕过 React】
//
// 滚轮是最典型的高频事件：一次拨动可能几十个事件。走 React state 的话
// 每个事件一次重渲染 + 一次完整 yoga 布局，主线程直接卡住。
//
// 所以这里改成命令式：直接改 DOM 节点上的 scrollTop → 标脏 → 调
// 根节点的节流渲染。**React 完全不参与**，一次 reconciler 工作都不做。
//
// 代价（也是这段注释在说的）：既然不经过 React，就不能指望
// 「setState 之后自动重渲染」。所以：
//   · 滚动位置由渲染器从 DOM 节点读（不是从 state 读）
//   · 需要 React 重渲染的情况（sticky 变化、虚拟滚动的挂载范围）
//     必须显式 forceRender，见第 160 行
  const [, forceRender] = useState(0);
  const listenersRef = useRef(new Set<() => void>());
  const renderQueuedRef = useRef(false);
  const notify = () => {
    for (const l of listenersRef.current) l();
  };
  function scrollMutated(el: DOMElement): void {
    // Signal background intervals (IDE poll, LSP poll, GCS fetch, orphan
    // check) to skip their next tick — they compete for the event loop and
    // contributed to 1402ms max frame gaps during scroll drain.
    markScrollActivity();
    markDirty(el);
    markCommitStart();
    notify();
    if (renderQueuedRef.current) return;
    renderQueuedRef.current = true;
    queueMicrotask(() => {
      renderQueuedRef.current = false;
      scheduleRenderFrom(el);
    });
  }
// 这个函数是「一次滚动改动」的完整副作用清单，顺序和内容都有理由：
//
//   markScrollActivity()  通知后台轮询（IDE 轮询、LSP、GCS 拉取）跳过
//                         下一 tick。注释里的数字很具体：滚动排空期间
//                         最大帧间隔到过 1402ms —— 就是这些后台任务
//                         和滚动抢事件循环造成的
//   markDirty(el)         标脏，渲染器据此重画这一支
//   markCommitStart()     告诉 reconciler「一次提交开始了」（计时用）
//   notify()              通知订阅者（虚拟滚动用它重算挂载范围）
//
// 最后那段 microtask 合并是重点：`scheduleRenderFrom` 有自己的
// leading edge（第一次调用立刻渲染），如果每个 scrollBy 都直接调，
// 第一个事件就触发渲染，而它后面还有一批事件在改 scrollTop ——
// 渲染出来的是「中途状态」。推到微任务里，一次输入批（discreteUpdates）
// 内的所有 scrollBy 合成一次。
  useImperativeHandle(ref, (): ScrollBoxHandle => ({
    scrollTo(y: number) {
      const el = domRef.current;
      if (!el) return;
      // Explicit false overrides the DOM attribute so manual scroll
      // breaks stickiness. Render code checks ?? precedence.
      el.stickyScroll = false;
      el.pendingScrollDelta = undefined;
      el.scrollAnchor = undefined;
      el.scrollTop = Math.max(0, Math.floor(y));
      scrollMutated(el);
// 三个赋值分别是「切断」三样东西：
//
//   stickyScroll = false   显式关掉粘底（覆盖 DOM attribute）
//   pendingScrollDelta     丢掉还没排空的累加量
//   scrollAnchor           丢掉正在进行的锚点寻位
//
// 少切任何一个都会打架：比如滚轮正在累加时调 scrollTo，累加量会在
// 渲染时又把它推开；锚点没清掉的话渲染器会用锚点覆盖 scrollTop。
//
// 这类「命令式状态有四个字段，改一个必须清另外三个」的设计，
// 是绕过 React 的必然代价 —— 没有 reducer 帮你保证一致性。
    },
    scrollToElement(el: DOMElement, offset = 0) {
      const box = domRef.current;
      if (!box) return;
      box.stickyScroll = false;
      box.pendingScrollDelta = undefined;
      box.scrollAnchor = {
        el,
        offset
      };
      scrollMutated(box);
    },
    scrollBy(dy: number) {
      const el = domRef.current;
      if (!el) return;
      el.stickyScroll = false;
      // Wheel input cancels any in-flight anchor seek — user override.
      el.scrollAnchor = undefined;
      // Accumulate in pendingScrollDelta; renderer drains it at a capped
      // rate so fast flicks show intermediate frames. Pure accumulator:
      // scroll-up followed by scroll-down naturally cancels.
      el.pendingScrollDelta = (el.pendingScrollDelta ?? 0) + Math.floor(dy);
      scrollMutated(el);
    },
// 【累加器，不是位置】
//
// scrollBy 累加的是**位移**（pendingScrollDelta），不是直接改 scrollTop。
// 两个原因：
//   · 一次拨动的几十个事件天然合并（第 150 行加法）
//   · 滚上再滚下自然抵消 —— 用户快速来回拨，净位移接近 0，
//     不会出现「滚了 10 格又滚回来，内容却跳了一下」
//
// 真正的 scrollTop 由渲染器在 drain 时按**上限速率**推进（所以快速
// 拨动能看到中间帧，而不是瞬间到底）。这也是 getPendingDelta 存在的
// 原因：虚拟滚动要知道「还没排空的位移」，才能预挂载即将进入视口的
// 子节点，否则中间帧会是空白。
    scrollToBottom() {
      const el = domRef.current;
      if (!el) return;
      el.pendingScrollDelta = undefined;
      el.stickyScroll = true;
      markDirty(el);
      notify();
      forceRender(n => n + 1);
// scrollToBottom 是唯一**走 React** 的滚动操作，因为 stickyScroll
// 是 DOM attribute（声明式的），改它必须经过 React 的 props 流。
//
// 顺带：这里不调 scrollMutated（那个会 markDirty + 排渲染），
// 而是自己 markDirty + notify + forceRender。forceRender 会引发一次
// 完整渲染，渲染器在那一轮里读到新的 stickyScroll 属性并自己算位置 ——
// 所以不需要提前写 scrollTop。
    },
    getScrollTop() {
      return domRef.current?.scrollTop ?? 0;
    },
    getPendingDelta() {
      // Accumulated-but-not-yet-drained delta. useVirtualScroll needs
      // this to mount the union [committed, committed+pending] range —
      // otherwise intermediate drain frames find no children (blank).
      return domRef.current?.pendingScrollDelta ?? 0;
    },
    getScrollHeight() {
      return domRef.current?.scrollHeight ?? 0;
    },
    getFreshScrollHeight() {
      const content = domRef.current?.childNodes[0] as DOMElement | undefined;
      return content?.yogaNode?.getComputedHeight() ?? domRef.current?.scrollHeight ?? 0;
// 【为什么需要「新鲜」版本】
//
// scrollHeight 是渲染器写回 DOM 节点的缓存值，而渲染是节流的（最多
// 16ms 一次）。所以刚提交完一次「内容变高了」的更新、在 layout effect
// 里读它，读到的是**上一次渲染的值** —— 差一个内容块的高度。
//
// 这个函数的做法是直接问 yoga：内容节点（childNodes[0]）的
// getComputedHeight()。贵一点（一次原生调用），但那一轮布局已经算完了，
// 值是准的。
//
// 两个都存在的意义：常规路径用缓存（便宜），「刚变大就要读到」的
// 场景用这个。典型的双 API 设计 —— 代价是调用方得知道什么时候用哪个。
    },
    getViewportHeight() {
      return domRef.current?.scrollViewportHeight ?? 0;
    },
    getViewportTop() {
      return domRef.current?.scrollViewportTop ?? 0;
    },
    isSticky() {
      const el = domRef.current;
      if (!el) return false;
      return el.stickyScroll ?? Boolean(el.attributes['stickyScroll']);
    },
    subscribe(listener: () => void) {
      listenersRef.current.add(listener);
      return () => listenersRef.current.delete(listener);
    },
    setClampBounds(min, max) {
      const el = domRef.current;
      if (!el) return;
      el.scrollClampMin = min;
      el.scrollClampMax = max;
    }
  }),
  // notify/scrollMutated are inline (no useCallback) but only close over
  // refs + imports — stable. Empty deps avoids rebuilding the handle on
  // every render (which re-registers the ref = churn).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  // Structure: outer viewport (overflow:scroll, constrained height) >
  // inner content (flexGrow:1, flexShrink:0 — fills at least the viewport
  // but grows beyond it for tall content). flexGrow:1 lets children use
  // spacers to pin elements to the bottom of the scroll area. Yoga's
  // Overflow.Scroll prevents the viewport from growing to fit the content.
  // The renderer computes scrollHeight from the content box and culls
  // content's children based on scrollTop.
  //
  // stickyScroll is passed as a DOM attribute (via ink-box directly) so it's
  // available on the first render — ref callbacks fire after the initial
  // commit, which is too late for the first frame.
  return <ink-box ref={el => {
    domRef.current = el;
    if (el) el.scrollTop ??= 0;
// 【首帧的 stickyScroll 为什么走 DOM 属性】
//
// ref 回调在**首次 commit 之后**才跑 —— 也就是说第一帧渲染时，
// 渲染器还不知道这个盒子是粘底的，会把内容画在顶部。
// 用户看到的是「刚打开时列表在顶部，下一帧才跳到底部」。
//
// 所以 stickyScroll 通过 ink-box 的 attribute 传（`{...stickyScroll ?
// {stickyScroll: true} : {}}`，第 228 行），attribute 在 createInstance
// 那一刻就存在，首帧就生效。
//
// 注意这里还顺手 `el.scrollTop ??= 0`：让「没滚动过」和「滚到 0」
// 在类型上都是数字，省掉下游的 undefined 判断（但 isSticky 那边
// 仍然要处理 undefined，因为命令式赋值会覆盖它）。
  }} style={{
    flexWrap: 'nowrap',
    flexDirection: style.flexDirection ?? 'row',
    flexGrow: style.flexGrow ?? 0,
    flexShrink: style.flexShrink ?? 1,
    ...style,
    overflowX: 'scroll',
    overflowY: 'scroll'
  }} {...stickyScroll ? {
    stickyScroll: true
  } : {}}>
      <Box flexDirection="column" flexGrow={1} flexShrink={0} width="100%">
// 内层 Box 的三个属性各有理由：
//
//   flexDirection="column"  内容默认竖排（列表/聊天记录的唯一常见布局）
//   flexGrow={1}            至少填满视口 —— 于是子元素可以用 Spacer
//                           把东西顶到底部（内容比视口短时的常见需求）
//   flexShrink={0}          不许压缩 —— 内容比视口长时保持完整高度
//
// width="100%" 而不是 flexGrow 在横轴上：横向不滚动，宽度就是视口宽。
        {children}
      </Box>
    </ink-box>;
}
export default ScrollBox;
// 原文件此处有一行 22328 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。