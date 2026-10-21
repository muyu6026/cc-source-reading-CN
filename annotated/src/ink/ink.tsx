import autoBind from 'auto-bind';
import { closeSync, constants as fsConstants, openSync, readSync, writeSync } from 'fs';
import noop from 'lodash-es/noop.js';
import throttle from 'lodash-es/throttle.js';
import React, { type ReactNode } from 'react';
import type { FiberRoot } from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import { onExit } from 'signal-exit';
import { flushInteractionTime } from 'src/bootstrap/state.js';
import { getYogaCounters } from 'src/native-ts/yoga-layout/index.js';
import { logForDebugging } from 'src/utils/debug.js';
import { logError } from 'src/utils/log.js';
import { format } from 'util';
import { colorize } from './colorize.js';
import App from './components/App.js';
import type { CursorDeclaration, CursorDeclarationSetter } from './components/CursorDeclarationContext.js';
import { FRAME_INTERVAL_MS } from './constants.js';
import * as dom from './dom.js';
import { KeyboardEvent } from './events/keyboard-event.js';
import { FocusManager } from './focus.js';
import { emptyFrame, type Frame, type FrameEvent } from './frame.js';
import { dispatchClick, dispatchHover } from './hit-test.js';
import instances from './instances.js';
import { LogUpdate } from './log-update.js';
import { nodeCache } from './node-cache.js';
import { optimize } from './optimizer.js';
import Output from './output.js';
import type { ParsedKey } from './parse-keypress.js';
import reconciler, { dispatcher, getLastCommitMs, getLastYogaMs, isDebugRepaintsEnabled, recordYogaMs, resetProfileCounters } from './reconciler.js';
import renderNodeToOutput, { consumeFollowScroll, didLayoutShift } from './render-node-to-output.js';
import { applyPositionedHighlight, type MatchPosition, scanPositions } from './render-to-screen.js';
import createRenderer, { type Renderer } from './renderer.js';
import { CellWidth, CharPool, cellAt, createScreen, HyperlinkPool, isEmptyCellAt, migrateScreenPools, StylePool } from './screen.js';
import { applySearchHighlight } from './searchHighlight.js';
import { applySelectionOverlay, captureScrolledRows, clearSelection, createSelectionState, extendSelection, type FocusMove, findPlainTextUrlAt, getSelectedText, hasSelection, moveFocus, type SelectionState, selectLineAt, selectWordAt, shiftAnchor, shiftSelection, shiftSelectionForFollow, startSelection, updateSelection } from './selection.js';
import { SYNC_OUTPUT_SUPPORTED, supportsExtendedKeys, type Terminal, writeDiffToTerminal } from './terminal.js';
import { CURSOR_HOME, cursorMove, cursorPosition, DISABLE_KITTY_KEYBOARD, DISABLE_MODIFY_OTHER_KEYS, ENABLE_KITTY_KEYBOARD, ENABLE_MODIFY_OTHER_KEYS, ERASE_SCREEN } from './termio/csi.js';
import { DBP, DFE, DISABLE_MOUSE_TRACKING, ENABLE_MOUSE_TRACKING, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, SHOW_CURSOR } from './termio/dec.js';
import { CLEAR_ITERM2_PROGRESS, CLEAR_TAB_STATUS, setClipboard, supportsTabStatus, wrapForMultiplexer } from './termio/osc.js';
import { TerminalWriteProvider } from './useTerminalNotification.js';

// 三个常量对象对应 alt 屏每帧发出的三种「补丁」：
//   ALT_SCREEN_ANCHOR_CURSOR  假装「上一帧光标在 (0,0)」，让 diff 从已知点算起
//   CURSOR_HOME_PATCH         帧首那条 CSI H（把物理光标钉回去）
//   ERASE_THEN_HOME_PATCH     清屏 + 归位，只在 resize 之后的那一帧用
//
// 都是 Object.freeze 的模块级单例 —— 这类「每帧都要塞进 patches 数组」的对象，
// 如果每次新建，就是每帧几次无意义的分配。省下来的量很小，
// 但这段代码整体是 profile 过之后才这么写的，不是先验的正确性。
// Alt-screen: renderer.ts sets cursor.visible = !isTTY || screen.height===0,
// which is always false in alt-screen (TTY + content fills screen).
// Reusing a frozen object saves 1 allocation per frame.
const ALT_SCREEN_ANCHOR_CURSOR = Object.freeze({
  x: 0,
  y: 0,
  visible: false
});
const CURSOR_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: CURSOR_HOME
});
const ERASE_THEN_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: ERASE_SCREEN + CURSOR_HOME
});

// Cached per-Ink-instance, invalidated on resize. frame.cursor.y for
// alt-screen is always terminalRows - 1 (renderer.ts).
function makeAltScreenParkPatch(terminalRows: number) {
  return Object.freeze({
    type: 'stdout' as const,
    content: cursorPosition(terminalRows, 1)
  });
}
export type Options = {
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  stderr: NodeJS.WriteStream;
  exitOnCtrlC: boolean;
  patchConsole: boolean;
  waitUntilExit?: () => Promise<void>;
  onFrame?: (event: FrameEvent) => void;
};
// ═══════════════════════════════════════════════════════════════
//  Ink 实例 = 一个终端上的一个 React root
// ═══════════════════════════════════════════════════════════════
//
//   它有四个身份，读的时候容易被绕晕，先分开：
//
//   ① **React 容器的持有者**：持 FiberRoot，render() 往里面塞元素
//   ② **帧循环的驱动者**：scheduleRender（节流）→ onRender（画一帧）
//   ③ **终端模式的管理者**：raw mode、alt screen、鼠标、kitty 键盘、
//      光标可见性 —— 所有「进程和终端之间的约定」都在这里
//   ④ **交互状态的宿主**：选区、搜索高亮、hover、光标声明
//
//   为什么后两件事不放在 React 里：它们必须**跨帧保持一致**，
//   而且要在 React 之外被读写（鼠标事件、终端信号、渲染中间层）。
//   放 React state 会引入「下一帧才生效」的延迟，对光标和选区是致命的。
//
// 【一帧的完整路径】（记住这条线，全文件就通了）
//
//   React commit → resetAfterCommit → onComputeLayout（算布局）
//     → useLayoutEffect（可能改光标声明）
//     → scheduleRender（throttle）→ 微任务 → onRender
//       → renderer()      前后帧 + 尺寸 → 新 Frame
//       → overlay         选区/高亮直接改屏幕缓冲
//       → damage          决定 diff 范围
//       → log.render()    算最小写入序列
//       → optimize()      合并写入
//       → 光标定位        主屏相对移动 / alt 屏绝对定位
//       → writeDiffToTerminal  唯一真正写终端的地方
//       → 埋点 onFrame
export default class Ink {
  private readonly log: LogUpdate;
  private readonly terminal: Terminal;
  private scheduleRender: (() => void) & {
    cancel?: () => void;
  };
  // Ignore last render after unmounting a tree to prevent empty output before exit
  private isUnmounted = false;
  private isPaused = false;
  private readonly container: FiberRoot;
  private rootNode: dom.DOMElement;
  readonly focusManager: FocusManager;
  private renderer: Renderer;
  private readonly stylePool: StylePool;
  private charPool: CharPool;
  private hyperlinkPool: HyperlinkPool;
  private exitPromise?: Promise<void>;
  private restoreConsole?: () => void;
  private restoreStderr?: () => void;
  private readonly unsubscribeTTYHandlers?: () => void;
  private terminalColumns: number;
  private terminalRows: number;
  private currentNode: ReactNode = null;
  private frontFrame: Frame;
  private backFrame: Frame;
  private lastPoolResetTime = performance.now();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private lastYogaCounters: {
    ms: number;
    visited: number;
    measured: number;
    cacheHits: number;
    live: number;
  } = {
    ms: 0,
    visited: 0,
    measured: 0,
    cacheHits: 0,
    live: 0
  };
  private altScreenParkPatch: Readonly<{
    type: 'stdout';
    content: string;
  }>;
  // Text selection state (alt-screen only). Owned here so the overlay
  // pass in onRender can read it and App.tsx can update it from mouse
  // events. Public so instances.get() callers can access.
  readonly selection: SelectionState = createSelectionState();
  // Search highlight query (alt-screen only). Setter below triggers
  // scheduleRender; applySearchHighlight in onRender inverts matching cells.
  private searchHighlightQuery = '';
  // Position-based highlight. VML scans positions ONCE (via
  // scanElementSubtree, when the target message is mounted), stores them
  // message-relative, sets this for every-frame apply. rowOffset =
  // message's current screen-top. currentIdx = which position is
  // "current" (yellow). null clears. Positions are known upfront —
  // navigation is index arithmetic, no scan-feedback loop.
  private searchPositions: {
    positions: MatchPosition[];
    rowOffset: number;
    currentIdx: number;
  } | null = null;
  // React-land subscribers for selection state changes (useHasSelection).
  // Fired alongside the terminal repaint whenever the selection mutates
  // so UI (e.g. footer hints) can react to selection appearing/clearing.
  private readonly selectionListeners = new Set<() => void>();
  // DOM nodes currently under the pointer (mode-1003 motion). Held here
  // so App.tsx's handleMouseEvent is stateless — dispatchHover diffs
  // against this set and mutates it in place.
  private readonly hoveredNodes = new Set<dom.DOMElement>();
  // Set by <AlternateScreen> via setAltScreenActive(). Controls the
  // renderer's cursor.y clamping (keeps cursor in-viewport to avoid
  // LF-induced scroll when screen.height === terminalRows) and gates
  // alt-screen-aware SIGCONT/resize/unmount handling.
  private altScreenActive = false;
  // Set alongside altScreenActive so SIGCONT resume knows whether to
  // re-enable mouse tracking (not all <AlternateScreen> uses want it).
  private altScreenMouseTracking = false;
  // True when the previous frame's screen buffer cannot be trusted for
  // blit — selection overlay mutated it, resetFramesForAltScreen()
  // replaced it with blanks, or forceRedraw() reset it to 0×0. Forces
  // one full-render frame; steady-state frames after clear it and regain
  // the blit + narrow-damage fast path.
  private prevFrameContaminated = false;
  // Set by handleResize: prepend ERASE_SCREEN to the next onRender's patches
  // INSIDE the BSU/ESU block so clear+paint is atomic. Writing ERASE_SCREEN
  // synchronously in handleResize would leave the screen blank for the ~80ms
  // render() takes; deferring into the atomic block means old content stays
  // visible until the new frame is fully ready.
  private needsEraseBeforePaint = false;
  // Native cursor positioning: a component (via useDeclaredCursor) declares
  // where the terminal cursor should be parked after each frame. Terminal
  // emulators render IME preedit text at the physical cursor position, and
  // screen readers / screen magnifiers track it — so parking at the text
  // input's caret makes CJK input appear inline and lets a11y tools follow.
  private cursorDeclaration: CursorDeclaration | null = null;
  // Main-screen: physical cursor position after the declared-cursor move,
  // tracked separately from frame.cursor (which must stay at content-bottom
  // for log-update's relative-move invariants). Alt-screen doesn't need
  // this — every frame begins with CSI H. null = no move emitted last frame.
  private displayCursor: {
    x: number;
    y: number;
  } | null = null;
// 构造函数的顺序不是随意的：
//   patchConsole（先接管 console，避免后面的日志打乱界面）
//   → 读终端尺寸 → 建三个 pool → 建前后帧 → 建 LogUpdate
//   → 建 scheduleRender（throttle）
//   → 注册退出钩子（onExit）与 TTY 钩子（resize / SIGCONT）
//   → 建 rootNode → focusManager → renderer
//   → 建 React container
//
// 注意 rootNode 的三个回调（237-258 行）必须在 createContainer **之前**挂好：
// React 一挂载就会 commit，commit 里就会调 onComputeLayout。
// 顺序反了，第一帧就没有布局。
  constructor(private readonly options: Options) {
    autoBind(this);
    if (this.options.patchConsole) {
      this.restoreConsole = this.patchConsole();
      this.restoreStderr = this.patchStderr();
    }
    this.terminal = {
      stdout: options.stdout,
      stderr: options.stderr
    };
    this.terminalColumns = options.stdout.columns || 80;
    this.terminalRows = options.stdout.rows || 24;
    this.altScreenParkPatch = makeAltScreenParkPatch(this.terminalRows);
    this.stylePool = new StylePool();
    this.charPool = new CharPool();
    this.hyperlinkPool = new HyperlinkPool();
    this.frontFrame = emptyFrame(this.terminalRows, this.terminalColumns, this.stylePool, this.charPool, this.hyperlinkPool);
    this.backFrame = emptyFrame(this.terminalRows, this.terminalColumns, this.stylePool, this.charPool, this.hyperlinkPool);
    this.log = new LogUpdate({
      isTTY: options.stdout.isTTY as boolean | undefined || false,
      stylePool: this.stylePool
    });

// 【为什么要推迟到微任务，而且必须是微任务】
//
//   resetAfterCommit 执行时，React **还没跑 layout effect**。
//   而 useDeclaredCursor 正是在 layout effect 里设置「光标该停在哪」。
//   同步渲染会读到上一帧的声明 —— 表现是打字时光标慢一个字符。
//
//   为什么微任务够：同一个事件循环 tick 内，layout effect 已经执行完，
//   而浏览器的宏任务（下一帧）还没开始。既不慢一帧，也不打乱顺序。
//
//   测试环境例外（reconciler.ts 292 行）：走 onImmediateRender 直接同步渲染，
//   因为测试要 after render 立刻读 lastFrame()。
    // scheduleRender is called from the reconciler's resetAfterCommit, which
    // runs BEFORE React's layout phase (ref attach + useLayoutEffect). Any
    // state set in layout effects — notably the cursorDeclaration from
    // useDeclaredCursor — would lag one commit behind if we rendered
    // synchronously. Deferring to a microtask runs onRender after layout
    // effects have committed, so the native cursor tracks the caret without
    // a one-keystroke lag. Same event-loop tick, so throughput is unchanged.
    // Test env uses onImmediateRender (direct onRender, no throttle) so
    // existing synchronous lastFrame() tests are unaffected.
// 【throttle 的 leading + trailing 各有各的用处】
//
//   leading    用户按一个键，立刻出帧 —— 否则会有 FRAME_INTERVAL_MS 的延迟，
//              在「打字感」上是能感觉到的
//   trailing   高频更新（spinner、流式输出）时，保证**最后一帧**一定画出来；
//              只有 leading 的话，一串更新里最后那个状态会被丢掉
//
//   两者同时开，等于「立刻响应 + 一定收敛到最终状态」。
//   代价是短时间内可能画两帧（leading 一帧、trailing 一帧），可以接受。
    const deferredRender = (): void => queueMicrotask(this.onRender);
    this.scheduleRender = throttle(deferredRender, FRAME_INTERVAL_MS, {
      leading: true,
      trailing: true
    });

    // Ignore last render after unmounting a tree to prevent empty output before exit
    this.isUnmounted = false;

    // Unmount when process exits
// 进程退出也要 unmount：否则终端留在 raw mode / alt screen / 鼠标跟踪开启的状态。
// 对一个 CLI 来说这是最严重的 bug —— 用户回到 shell 后看不到自己打的字。
//
// alwaysLast: false 表示这个回调不排在最后执行（还可以被其他 onExit 回调插队）。
// 具体顺序上的坑见 932 行 detachForShutdown 的注释。
    this.unsubscribeExit = onExit(this.unmount, {
      alwaysLast: false
    });
    if (options.stdout.isTTY) {
      options.stdout.on('resize', this.handleResize);
      process.on('SIGCONT', this.handleResume);
      this.unsubscribeTTYHandlers = () => {
        options.stdout.off('resize', this.handleResize);
        process.off('SIGCONT', this.handleResume);
      };
    }
// rootNode 上挂三个回调，这就是 dom 层与帧循环之间的**唯一接口**：
//   onRender            → throttled scheduleRender（一帧的请求）
//   onImmediateRender   → onRender（测试用，绕过节流）
//   onComputeLayout     → 同步算 yoga 布局（commit 阶段）
//
// 三个都在 237-258 行赋值。除此之外 dom 层不 import ink.tsx，
// 反向的依赖只有 ink.tsx → dom，没有环。
    this.rootNode = dom.createNode('ink-root');
    this.focusManager = new FocusManager((target, event) => dispatcher.dispatchDiscrete(target, event));
    this.rootNode.focusManager = this.focusManager;
    this.renderer = createRenderer(this.rootNode, this.stylePool);
    this.rootNode.onRender = this.scheduleRender;
    this.rootNode.onImmediateRender = this.onRender;
// 【每次 commit 都全树重算布局】
//
//   看起来浪费，但注意两件事：
//   ① setWidth(terminalColumns) 只在根上设一次宽度，剩下是 yoga 自己传播
//   ② yoga 内部有缓存（getYogaCounters 的 cacheHits 就是统计它的命中率），
//      没变的子树不会重新求解
//
//   所以这里不是「放弃增量」，而是**把增量交给 yoga**。
//   我们只负责在最外层给一个宽度约束。
//
//   为什么要在这里同步算（而不是等 onRender 时再算）：
//   紧接着的 useLayoutEffect 要读布局结果（光标定位、滚动边界）。
//   详见 reconciler.ts 247 行。
    this.rootNode.onComputeLayout = () => {
      // Calculate layout during React's commit phase so useLayoutEffect hooks
      // have access to fresh layout data
      // Guard against accessing freed Yoga nodes after unmount
      if (this.isUnmounted) {
        return;
      }
      if (this.rootNode.yogaNode) {
        const t0 = performance.now();
        this.rootNode.yogaNode.setWidth(this.terminalColumns);
        this.rootNode.yogaNode.calculateLayout(this.terminalColumns);
        const ms = performance.now() - t0;
        recordYogaMs(ms);
        const c = getYogaCounters();
        this.lastYogaCounters = {
          ms,
          ...c
        };
      }
    };

    // @ts-expect-error @types/react-reconciler@0.32.3 declares 11 args with transitionCallbacks,
    // but react-reconciler 0.33.0 source only accepts 10 args (no transitionCallbacks)
// createContainer 的九个参数里，三个 noop 是错误处理器：
// onUncaughtError / onCaughtError / onRecoverableError。
//
// **所有 React 错误都被吞掉**。这是有意的：终端里没有 DOM 可以展示错误边界，
// 抛出去会直接崩掉整个 TUI（用户正在输的内容全丢）。
// 代价是 React 内部错误完全静默 —— 只能靠日志排查。
//
// 如果哪天出现「界面某块不更新但也不报错」，第一个该怀疑的就是这里。
    this.container = reconciler.createContainer(this.rootNode, ConcurrentRoot, null, false, null, 'id', noop,
    // onUncaughtError
    noop,
    // onCaughtError
    noop,
    // onRecoverableError
    noop // onDefaultTransitionIndicator
    );
// 【这一行是「编译期常量折叠」的痕迹，不是运行时判断】
//
//   "production" 会被 bundler 替换成当前构建模式的字面量，
//   于是整句变成 `if ("production" === "development")` —— 永远 false，
//   整个 devtools 块在产物里被删掉。
//
//   读的时候要知道：这不是「生产环境跳过」，而是「生产构建里这段代码不存在」。
//   文件里凡是看到 `"production" === 'x'` 这种写法，都是同一个套路。
    if ("production" === 'development') {
      reconciler.injectIntoDevTools({
        bundleType: 0,
        // Reporting React DOM's version, not Ink's
        // See https://github.com/facebook/react/issues/16666#issuecomment-532639905
        version: '16.13.1',
        rendererPackageName: 'ink'
      });
    }
  }
// SIGCONT（进程被恢复）之后要重置一切：
//   主屏：双帧清空 + log.reset()。因为挂起期间 shell 可能往屏幕上写过东西，
//         diff 的基准（frontFrame）已经和物理屏幕不一致了。
//   alt 屏：直接重新进入（reenterAltScreen），因为可能已经被踢出 1049 模式。
//
// 关键的一行是 300 行 `displayCursor = null`：挂起期间物理光标位置未知，
// 如果还按旧位置算相对移动，第一帧就会把内容写歪。
  private handleResume = () => {
    if (!this.options.stdout.isTTY) {
      return;
    }

    // Alt screen: after SIGCONT, content is stale (shell may have written
    // to main screen, switching focus away) and mouse tracking was
    // disabled by handleSuspend.
    if (this.altScreenActive) {
      this.reenterAltScreen();
      return;
    }

    // Main screen: start fresh to prevent clobbering terminal content
    this.frontFrame = emptyFrame(this.frontFrame.viewport.height, this.frontFrame.viewport.width, this.stylePool, this.charPool, this.hyperlinkPool);
    this.backFrame = emptyFrame(this.backFrame.viewport.height, this.backFrame.viewport.width, this.stylePool, this.charPool, this.hyperlinkPool);
    this.log.reset();
    // Physical cursor position is unknown after the shell took over during
    // suspend. Clear displayCursor so the next frame's cursor preamble
    // doesn't emit a relative move from a stale park position.
    this.displayCursor = null;
  };

// 【为什么 resize 不能 debounce —— 这段注释值得逐句读】
//
//   debounce 会制造一个窗口：stdout.columns 已经是新值，而
//   this.terminalColumns / yoga 布局还是旧值。
//   这个窗口里任何一个 scheduleRender（spinner、时钟）都会：
//     log-update 发现「宽度变了」→ 清屏
//   → 然后 debounce 到期 → 又一次 resize 处理 → 再清一次
//   结果是「白 → 画 → 白 → 画」的双闪。
//
//   同步处理则保证：读到新尺寸的那一刻，所有内部尺寸同时更新。
//   **一致性比省几次计算重要** —— 尤其是在「计算本来就不贵」的时候。
  // NOT debounced. A debounce opens a window where stdout.columns is NEW
  // but this.terminalColumns/Yoga are OLD — any scheduleRender during that
  // window (spinner, clock) makes log-update detect a width change and
  // clear the screen, then the debounce fires and clears again (double
  // blank→paint flicker). useVirtualScroll's height scaling already bounds
  // the per-resize cost; synchronous handling keeps dimensions consistent.
  private handleResize = () => {
    const cols = this.options.stdout.columns || 80;
    const rows = this.options.stdout.rows || 24;
    // Terminals often emit 2+ resize events for one user action (window
    // settling). Same-dimension events are no-ops; skip to avoid redundant
    // frame resets and renders.
// 同尺寸事件直接返回：终端一次拖拽窗口会连发好几个 resize 事件
// （窗口管理器 settle 的过程），每一个都触发全树重渲染显然不必要。
    if (cols === this.terminalColumns && rows === this.terminalRows) return;
    this.terminalColumns = cols;
    this.terminalRows = rows;
    this.altScreenParkPatch = makeAltScreenParkPatch(this.terminalRows);

    // Alt screen: reset frame buffers so the next render repaints from
    // scratch (prevFrameContaminated → every cell written, wrapped in
    // BSU/ESU — old content stays visible until the new frame swaps
    // atomically). Re-assert mouse tracking (some emulators reset it on
    // resize). Do NOT write ENTER_ALT_SCREEN: iTerm2 treats ?1049h as a
    // buffer clear even when already in alt — that's the blank flicker.
    // Self-healing re-entry (if something kicked us out of alt) is handled
    // by handleResume (SIGCONT) and the sleep-wake detector; resize itself
    // doesn't exit alt-screen. Do NOT write ERASE_SCREEN: render() below
    // can take ~80ms; erasing first leaves the screen blank that whole time.
// alt 屏 resize 的三个「不做」，每个都是踩出来的：
//
//   ① 不重发 ENTER_ALT_SCREEN —— iTerm2 把 ?1049h 当「清屏」处理，
//      即使已经在 alt 屏里。发了就是一次白屏闪烁。
//   ② 不同步写 ERASE_SCREEN —— render() 要 80ms，先擦就等于让用户看 80ms 空白。
//      改成置 needsEraseBeforePaint，让它进 BSU/ESU 原子块（644 行）。
//   ③ 不假设退出过 alt 屏 —— 真被踢出去的情况由 SIGCONT 和睡眠唤醒检测兜。
//
//   保留的一个「做」：resetFramesForAltScreen。因为新宽高下旧缓冲完全不可用。
    if (this.altScreenActive && !this.isPaused && this.options.stdout.isTTY) {
      if (this.altScreenMouseTracking) {
        this.options.stdout.write(ENABLE_MOUSE_TRACKING);
      }
      this.resetFramesForAltScreen();
      this.needsEraseBeforePaint = true;
    }

    // Re-render the React tree with updated props so the context value changes.
    // React's commit phase will call onComputeLayout() to recalculate yoga layout
    // with the new dimensions, then call onRender() to render the updated frame.
    // We don't call scheduleRender() here because that would render before the
    // layout is updated, causing a mismatch between viewport and content dimensions.
// 【resize 的处理方式是「重新渲染同一棵树」，而不是「通知某个 resize 事件」】
//
//   注意传的是 this.currentNode —— 上一帧那棵 React 元素树，原封不动。
//   真正的变化在 App 的 props 里（terminalColumns / terminalRows）。
//   重渲染让 context value 变，下游组件自然拿到新尺寸。
//
//   注释里那句「不调 scheduleRender」是重点：
//   scheduleRender 会在布局更新**之前**画一帧，viewport 和内容尺寸对不上。
//   走 render() → commit → onComputeLayout → onRender 才是正确顺序。
    if (this.currentNode !== null) {
      this.render(this.currentNode);
    }
  };
  resolveExitPromise: () => void = () => {};
  rejectExitPromise: (reason?: Error) => void = () => {};
  unsubscribeExit: () => void = () => {};

  /**
   * Pause Ink and hand the terminal over to an external TUI (e.g. git
   * commit editor). In non-fullscreen mode this enters the alt screen;
   * in fullscreen mode we're already in alt so we just clear it.
   * Call `exitAlternateScreen()` when done to restore Ink.
   */
// 交接给外部 TUI（git commit 编辑器、vim、less）的第一步。
//
// 顺序：pause（把当前内容画稳）→ suspendStdin（放开键盘）→ 写一长串复位序列。
//
// 364 行把「关 kitty 键盘协议」放在最前面，理由在注释里：
// 不认 CSI-u 的编辑器（nano）会把每个 Ctrl+键都显示成 "Unknown sequence"。
// 这类「我们开了某个终端特性，子进程不认识」的坑，是 TUI 嵌 TUI 的常态。
  enterAlternateScreen(): void {
    this.pause();
    this.suspendStdin();
    this.options.stdout.write(
    // Disable extended key reporting first — editors that don't speak
    // CSI-u (e.g. nano) show "Unknown sequence" for every Ctrl-<key> if
    // kitty/modifyOtherKeys stays active. exitAlternateScreen re-enables.
    DISABLE_KITTY_KEYBOARD + DISABLE_MODIFY_OTHER_KEYS + (this.altScreenMouseTracking ? DISABLE_MOUSE_TRACKING : '') + (
    // disable mouse (no-op if off)
    this.altScreenActive ? '' : '\x1b[?1049h') +
    // enter alt (already in alt if fullscreen)
    '\x1b[?1004l' +
    // disable focus reporting
    '\x1b[0m' +
    // reset attributes
    '\x1b[?25h' +
    // show cursor
    '\x1b[2J' +
    // clear screen
    '\x1b[H' // cursor home
    );
  }

  /**
   * Resume Ink after an external TUI handoff with a full repaint.
   * In non-fullscreen mode this exits the alt screen back to main;
   * in fullscreen mode we re-enter alt and clear + repaint.
   *
   * The re-enter matters: terminal editors (vim, nano, less) write
   * smcup/rmcup (?1049h/?1049l), so even though we started in alt,
   * the editor's rmcup on exit drops us to main screen. Without
   * re-entering, the 2J below wipes the user's main-screen scrollback
   * and subsequent renders land in main — native terminal scroll
   * returns, fullscreen scroll is dead.
   */
// 【exitAlternateScreen 里的 re-enter 技巧】
//
//   全屏模式下我们本来就在 alt 屏，按理说退出编辑器后什么都不用做。
//   但编辑器退出时会写 rmcup（?1049l），把我们**踢回主屏**。
//   此时如果直接 2J 清屏，清的是用户的主屏 + 滚动历史 —— 灾难。
//
//   所以先重新 ENTER_ALT_SCREEN，再清。
//
//   最后那行 pop-before-push（418 行）是另一半：Kitty 键盘协议是**栈**，
//   编辑器进出会 push/pop 自己的层级。不回 pop 一次，深度会一轮轮累积，
//   最终导致 Ctrl+C 泄漏成转义序列。
  exitAlternateScreen(): void {
    this.options.stdout.write((this.altScreenActive ? ENTER_ALT_SCREEN : '') +
    // re-enter alt — vim's rmcup dropped us to main
    '\x1b[2J' +
    // clear screen (now alt if fullscreen)
    '\x1b[H' + (
    // cursor home
    this.altScreenMouseTracking ? ENABLE_MOUSE_TRACKING : '') + (
    // re-enable mouse (skip if CLAUDE_CODE_DISABLE_MOUSE)
    this.altScreenActive ? '' : '\x1b[?1049l') +
    // exit alt (non-fullscreen only)
    '\x1b[?25l' // hide cursor (Ink manages)
    );
    this.resumeStdin();
    if (this.altScreenActive) {
      this.resetFramesForAltScreen();
    } else {
      this.repaint();
    }
    this.resume();
    // Re-enable focus reporting and extended key reporting — terminal
    // editors (vim, nano, etc.) write their own modifyOtherKeys level on
    // entry and reset it on exit, leaving us unable to distinguish
    // ctrl+shift+<letter> from ctrl+<letter>. Pop-before-push keeps the
    // Kitty stack balanced (a well-behaved editor restores our entry, so
    // without the pop we'd accumulate depth on each editor round-trip).
    this.options.stdout.write('\x1b[?1004h' + (supportsExtendedKeys() ? DISABLE_KITTY_KEYBOARD + ENABLE_KITTY_KEYBOARD + ENABLE_MODIFY_OTHER_KEYS : ''));
  }
// ═══════════════════════════════════════════════════════════════
//  onRender —— 一帧的全部。这是全文件最核心的函数
// ═══════════════════════════════════════════════════════════════
//
//   九个阶段，按顺序：
//     ① 440  renderer()         前帧+后帧+尺寸 → 新 Frame（纯计算）
//     ② 462  滚动跟随           把选区按滚动量平移
//     ③ 536  叠加层             选区反色、搜索高亮（直接改屏幕缓冲）
//     ④ 559  damage             决定 diff 的范围
//     ⑤ 586  log.render()       算最小写入序列（diff）
//     ⑥ 621  optimize()         合并写入、去掉冗余光标移动
//     ⑦ 660  光标定位           IME 需要物理光标停在 caret 上
//     ⑧ 736  writeDiffToTerminal 唯一真正写终端的地方
//     ⑨ 772  onFrame            埋点
//
//   读这个函数最容易迷失的地方：它很长，但**没有分支嵌套**。
//   每一段都是「做完一件事，然后下一件」，可以直接按上面九段切开读。
  onRender() {
    if (this.isUnmounted || this.isPaused) {
      return;
    }
// 进入渲染先取消 drain 定时器：这一帧会把待消费的滚动量一起处理掉，
// 并在帧末（757 行）按需重新排一个。
//
// 不取消的话会出现「滚轮触发的一帧」和「drain 定时器的一帧」几乎同时执行，
// 两帧之间只差零点几毫秒 —— 用户看到的是抖动。
    // Entering a render cancels any pending drain tick — this render will
    // handle the drain (and re-schedule below if needed). Prevents a
    // wheel-event-triggered render AND a drain-timer render both firing.
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

// 交互时间戳（用于「多久没输入」这类判断）在这里统一 flush 一次：
// 每帧一次 Date.now()，而不是每次按键一次。
//
// 放在渲染**之前**是为了不弄脏状态 —— 如果在渲染中更新它，
// 可能又触发一轮 React 重渲染，一帧变两帧。
    // Flush deferred interaction-time update before rendering so we call
    // Date.now() at most once per frame instead of once per keypress.
    // Done before the render to avoid dirtying state that would trigger
    // an extra React re-render cycle.
    flushInteractionTime();
    const renderStart = performance.now();
    const terminalWidth = this.options.stdout.columns || 80;
    const terminalRows = this.options.stdout.rows || 24;
// 【renderer 是纯函数式的】
//
//   输入：前帧、后帧、是否 TTY、宽、高、是否 alt 屏、前帧是否被污染
//   输出：一个新 Frame（含 screen 缓冲、viewport、cursor）+ frame.scrollDrainPending
//
//   它不做 IO、不改 this 上的状态。所以「画出来的东西不对」这件事
//   可以只在这一个函数里查 —— 这也是为什么它被单独拆成一个文件（renderer.ts）。
    const frame = this.renderer({
      frontFrame: this.frontFrame,
      backFrame: this.backFrame,
      isTTY: this.options.stdout.isTTY,
      terminalWidth,
      terminalRows,
      altScreen: this.altScreenActive,
      prevFrameContaminated: this.prevFrameContaminated
    });
    const rendererMs = performance.now() - renderStart;

// 【选区锚在「文本」上，不锚在「屏幕坐标」上】
//
//   用户选中了第 10~12 行，然后内容向上滚了一行 —— 选区应该跟着文本走，
//   而不是钉在那三个屏幕行号上。这是原生终端的行为。
//
//   实现方式：每帧把选区按滚动量平移（shift*），同时把「即将滚出屏幕的行」
//   抄进 scrolledOff 缓冲（capture*），这样滚出去的部分还能被复制。
//
//   476-482 行那段注释是本文件最细的一条警告：
//   capture 和 shift 必须**成对**出现在每个分支里。
//   只 capture 不 shift → 同一批行每帧都被重复捕获 → 复制出来的文本无限增长。
//   这类 bug 不会崩，只会让「复制」这个动作越来越离谱。
    // Sticky/auto-follow scrolled the ScrollBox this frame. Translate the
    // selection by the same delta so the highlight stays anchored to the
    // TEXT (native terminal behavior — the selection walks up the screen
    // as content scrolls, eventually clipping at the top). frontFrame
    // still holds the PREVIOUS frame's screen (swap is at ~500 below), so
    // captureScrolledRows reads the rows that are about to scroll out
    // before they're overwritten — the text stays copyable until the
    // selection scrolls entirely off. During drag, focus tracks the mouse
    // (screen-local) so only anchor shifts — selection grows toward the
    // mouse as the anchor walks up. After release, both ends are text-
    // anchored and move as a block.
    const follow = consumeFollowScroll();
    if (follow && this.selection.anchor &&
    // Only translate if the selection is ON scrollbox content. Selections
    // in the footer/prompt/StickyPromptHeader are on static text — the
    // scroll doesn't move what's under them. Without this guard, a
    // footer selection would be shifted by -delta then clamped to
    // viewportBottom, teleporting it into the scrollbox. Mirror the
    // bounds check the deleted check() in ScrollKeybindingHandler had.
    this.selection.anchor.row >= follow.viewportTop && this.selection.anchor.row <= follow.viewportBottom) {
      const {
        delta,
        viewportTop,
        viewportBottom
      } = follow;
      // captureScrolledRows and shift* are a pair: capture grabs rows about
      // to scroll off, shift moves the selection endpoint so the same rows
      // won't intersect again next frame. Capturing without shifting leaves
      // the endpoint in place, so the SAME viewport rows re-intersect every
      // frame and scrolledOffAbove grows without bound — getSelectedText
      // then returns ever-growing text on each re-copy. Keep capture inside
      // each shift branch so the pairing can't be broken by a new guard.
      if (this.selection.isDragging) {
        if (hasSelection(this.selection)) {
          captureScrolledRows(this.selection, this.frontFrame.screen, viewportTop, viewportTop + delta - 1, 'above');
        }
        shiftAnchor(this.selection, -delta, viewportTop, viewportBottom);
      } else if (
// 【flag-3 守卫：两端都在视口内才平移】
//
//   上面 470 行只检查了 anchor 在 scrollbox 里。但用户可以从 scrollbox
//   拖进 footer 再松手 —— 此时 focus 在 footer 上。
//   如果照常平移，focus 会被 clamp 到 viewportBottom，
//   高亮就从 footer「瞬移」回 scrollbox 底部。
//
//   所以跨界的选区**两端都不动**：footer 那个端点把选区钉住，
//   文本在下面滚走，getSelectedText 读的是当前屏幕内容 —— 不会累积。
//
//   拖动分支不需要这个判断：shiftAnchor 不看 focus，anchor 该移还是要移
//   （否则 capture 会漏）。
      // Flag-3 guard: the anchor check above only proves ONE endpoint is
      // on scrollbox content. A drag from row 3 (scrollbox) into the
      // footer at row 6, then release, leaves focus outside the viewport
      // — shiftSelectionForFollow would clamp it to viewportBottom,
      // teleporting the highlight from static footer into the scrollbox.
      // Symmetric check: require BOTH ends inside to translate. A
      // straddling selection falls through to NEITHER shift NOR capture:
      // the footer endpoint pins the selection, text scrolls away under
      // the highlight, and getSelectedText reads the CURRENT screen
      // contents — no accumulation. Dragging branch doesn't need this:
      // shiftAnchor ignores focus, and the anchor DOES shift (so capture
      // is correct there even when focus is in the footer).
      !this.selection.focus || this.selection.focus.row >= viewportTop && this.selection.focus.row <= viewportBottom) {
        if (hasSelection(this.selection)) {
          captureScrolledRows(this.selection, this.frontFrame.screen, viewportTop, viewportTop + delta - 1, 'above');
        }
        const cleared = shiftSelectionForFollow(this.selection, -delta, viewportTop, viewportBottom);
        // Auto-clear (both ends overshot minRow) must notify React-land
        // so useHasSelection re-renders and the footer copy/escape hint
        // disappears. notifySelectionChange() would recurse into onRender;
        // fire the listeners directly — they schedule a React update for
        // LATER, they don't re-enter this frame.
        if (cleared) for (const cb of this.selectionListeners) cb();
      }
    }

// 【把选区写进屏幕缓冲，而不是加一条渲染路径】
//
//   做法：把选中的格子直接在 Screen 里换成反色/底色（setCellStyleId）。
//   于是「选区」对 diff 引擎来说就是普通的内容变化，LogUpdate 完全不需要
//   知道有选区这回事。
//
//   这是一个很值钱的设计选择：**把 UI 状态编码进数据，而不是增加一条渲染分支**。
//   代价在 519 行：写缓冲不走 damage 统计，所以必须手工把整帧标成全 damage。
//
// ── 另一个兜底：全屏 damage ──
//
// 【全屏 damage 是正确性兜底，不是性能退让】
//
//   PR #20120 描述的 bug：flexbox 兄弟在帧间调整大小时
//   （spinner 出现 → 底部变高 → scrollbox 变矮），
//   按节点跟踪的 damage 会在边界漏掉过渡格子，留下残影。
//
//   关键判据是 didLayoutShift()：只有**布局真的动了**才需要全屏重绘。
//   稳态帧（spinner 转动、时钟走、文字流进固定高度的盒子）布局不变，
//   照常走局部 diff。
//
//   所以这里不是「一直全屏」，而是「布局一动就全屏」。
//   代价可接受，因为布局变化本来就是低频事件。
    // Selection overlay: invert cell styles in the screen buffer itself,
    // so the diff picks up selection as ordinary cell changes and
    // LogUpdate remains a pure diff engine.
    //
    // Full-screen damage (PR #20120) is a correctness backstop for the
    // sibling-resize bleed: when flexbox siblings resize between frames
    // (spinner appears → bottom grows → scrollbox shrinks), the
    // cached-clear + clip-and-cull + setCellAt damage union can miss
    // transition cells at the boundary. But that only happens when layout
    // actually SHIFTS — didLayoutShift() tracks exactly this (any node's
    // cached yoga position/size differs from current, or a child was
    // removed). Steady-state frames (spinner rotate, clock tick, text
    // stream into fixed-height box) don't shift layout, so normal damage
    // bounds are correct and diffEach only compares the damaged region.
    //
    // Selection also requires full damage: overlay writes via setCellStyleId
    // which doesn't track damage, and prev-frame overlay cells need to be
    // compared when selection moves/clears. prevFrameContaminated covers
    // the frame-after-selection-clears case.
    let selActive = false;
    let hlActive = false;
// 选区与搜索高亮只在 alt 屏生效。
// 原因和 dispatchClick 一样（1260 行）：主屏的坐标系含滚动历史，
// 屏幕行号 ≠ 视口行号，点击/选中都无法映射。
//
// 545 行的 searchPositions 是第二层高亮（当前项，黄色），
// 叠在「所有匹配项反色」之上。位置由 1071 行扫描一次得到，
// 之后每帧只按 rowOffset 平移 —— 见 1103 行的说明。
    if (this.altScreenActive) {
      selActive = hasSelection(this.selection);
      if (selActive) {
        applySelectionOverlay(frame.screen, this.selection, this.stylePool);
      }
      // Scan-highlight: inverse on ALL visible matches (less/vim style).
      // Position-highlight (below) overlays CURRENT (yellow) on top.
      hlActive = applySearchHighlight(frame.screen, this.searchHighlightQuery, this.stylePool);
      // Position-based CURRENT: write yellow at positions[currentIdx] +
      // rowOffset. No scanning — positions came from a prior scan when
      // the message first mounted. Message-relative + rowOffset = screen.
      if (this.searchPositions) {
        const sp = this.searchPositions;
        const posApplied = applyPositionedHighlight(frame.screen, this.stylePool, sp.positions, sp.rowOffset, sp.currentIdx);
        hlActive = hlActive || posApplied;
      }
    }

// 这个兜底对两种屏幕都生效（不止 alt 屏）：
// 布局位移导致的残影，在主屏上同样会发生 —— 只是主屏更常用、
// 用户更容易注意到「这行字怎么叠了」。
//
// 四个条件是「或」的关系，任一成立就整帧重绘。
    // Full-damage backstop: applies on BOTH alt-screen and main-screen.
    // Layout shifts (spinner appears, status line resizes) can leave stale
    // cells at sibling boundaries that per-node damage tracking misses.
    // Selection/highlight overlays write via setCellStyleId which doesn't
    // track damage. prevFrameContaminated covers the cleanup frame.
    if (didLayoutShift() || selActive || hlActive || this.prevFrameContaminated) {
      frame.screen.damage = {
        x: 0,
        y: 0,
        width: frame.screen.width,
        height: frame.screen.height
      };
    }

// 【alt 屏每帧先把物理光标锚到 (0,0)】
//
//   log-update 里所有光标移动都是**相对**的：从上一帧的光标位置算增量。
//   这假设物理光标真的还在那里。但 tmux 重画状态栏、Cmd+K 清屏、
//   pane 重排都会**背着我们挪动光标**。
//   一旦物理位置偏了，相对移动就会逐帧累积偏移 —— 内容是「每帧上爬一行」。
//
//   解法：每帧先发 CSI H 把光标钉回 (0,0)，并让 diff 从 (0,0) 开始算。
//   这样任何外部干扰都会被下一帧自动纠正。
//
//   主屏不能这么做：那里的光标 y 可能是滚动历史里的第 3000 行，
//   CSI H 只能到可视区第一行，回不去。
    // Alt-screen: anchor the physical cursor to (0,0) before every diff.
    // All cursor moves in log-update are RELATIVE to prev.cursor; if tmux
    // (or any emulator) perturbs the physical cursor out-of-band (status
    // bar refresh, pane redraw, Cmd+K wipe), the relative moves drift and
    // content creeps up 1 row/frame. CSI H resets the physical cursor;
    // passing prev.cursor=(0,0) makes the diff compute from the same spot.
    // Self-healing against any external cursor manipulation. Main-screen
    // can't do this — cursor.y tracks scrollback rows CSI H can't reach.
    // The CSI H write is deferred until after the diff is computed so we
    // can skip it for empty diffs (no writes → physical cursor unused).
    let prevFrame = this.frontFrame;
    if (this.altScreenActive) {
      prevFrame = {
        ...this.frontFrame,
        cursor: ALT_SCREEN_ANCHOR_CURSOR
      };
    }
// diff 引擎只做一件事：对比两份屏幕缓冲，算出「用最少的写入让屏幕变成目标状态」。
// 它不知道内容是什么，也不知道为什么变 —— 这正是它快的原因。
//
// 第三个参数 altScreen 决定「能不能用删除行/插入行这类滚动优化」，
// 第四个参数 SYNC_OUTPUT_SUPPORTED 决定要不要包 BSU/ESU 原子块
// （tmux 不支持 DEC 2026，只能靠外层时序）。
    const tDiff = performance.now();
    const diff = this.log.render(prevFrame, frame, this.altScreenActive,
    // DECSTBM needs BSU/ESU atomicity — without it the outer terminal
    // renders the scrolled-but-not-yet-repainted intermediate state.
    // tmux is the main case (re-emits DECSTBM with its own timing and
    // doesn't implement DEC 2026, so SYNC_OUTPUT_SUPPORTED is false).
    SYNC_OUTPUT_SUPPORTED);
    const diffMs = performance.now() - tDiff;
// 双缓冲交换。三个 Frame 的关系：
//   frame        这一帧刚算出来的（马上要显示）
//   frontFrame   屏上现在显示的（下一帧的「前帧」）
//   backFrame    上一帧的（渲染时复用作「后帧」，避免每帧分配两个大数组）
//
// 屏幕缓冲是 rows × cols 的格子数组，每帧新建一份在 60 帧下会产生大量垃圾，
// 所以这里做循环复用。
    // Swap buffers
    this.backFrame = this.frontFrame;
    this.frontFrame = frame;

// 字符串池/超链接池是无界去重表（格子只存索引，不存字符串）。
// 长时间运行的会话里，流式输出的每一段文字都会进池 —— 不重置会一直涨。
//
// 5 分钟一次，成本是 O(cells) 的迁移（见 1561 行 resetPools）。
// 频率低到这个程度，迁移开销可以忽略。
    // Periodically reset char/hyperlink pools to prevent unbounded growth
    // during long sessions. 5 minutes is infrequent enough that the O(cells)
    // migration cost is negligible. Reuses renderStart to avoid extra clock call.
    if (renderStart - this.lastPoolResetTime > 5 * 60 * 1000) {
      this.resetPools();
      this.lastPoolResetTime = renderStart;
    }
// 整屏重绘（clearTerminal）是「症状」，不是「事件」。
// 这里把它变成结构化数据交给 onFrame —— 上层可以据此统计
// 「这个会话闪了多少次、每次是因为什么原因」。
//
// 612 行的 debug 分支才是真正有用的部分：它把触发行的内容
// （prevLine / nextLine）和 owner chain 一起写进日志，
// 于是「谁导致的闪烁」这个问题有了答案。
    const flickers: FrameEvent['flickers'] = [];
    for (const patch of diff) {
      if (patch.type === 'clearTerminal') {
        flickers.push({
          desiredHeight: frame.screen.height,
          availableHeight: frame.viewport.height,
          reason: patch.reason
        });
        if (isDebugRepaintsEnabled() && patch.debug) {
          const chain = dom.findOwnerChainAtRow(this.rootNode, patch.debug.triggerY);
          logForDebugging(`[REPAINT] full reset · ${patch.reason} · row ${patch.debug.triggerY}\n` + `  prev: "${patch.debug.prevLine}"\n` + `  next: "${patch.debug.nextLine}"\n` + `  culprit: ${chain.length ? chain.join(' < ') : '(no owner chain captured)'}`, {
            level: 'warn'
          });
        }
      }
    }
// 【diff 之后为什么还要 optimize 一趟】
//
//   diff 回答的是「哪些格子变了」，输出是逐格/逐段的写入指令。
//   optimize 回答的是「怎么用最少的字节写出去」：
//     · 相邻同色写入合并
//     · 连续的相对光标移动合并成一条
//     · 能被一次 SGR 覆盖的样式变化不重复发
//
//   两层分开的好处：diff 逻辑可以保持简单直白，字节级优化单独演进，
//   互不影响。终端带宽不是瓶颈，但**写入次数**影响滚动流畅度。
    const tOptimize = performance.now();
    const optimized = optimize(diff);
    const optimizeMs = performance.now() - tOptimize;
    const hasDiff = optimized.length > 0;
// alt 屏的写入被一对「锚定 + 归位」夹住：
//   前置 CSI H   把物理光标钉到 (0,0)，让相对移动有确定的起点
//   后置 CSI row;1 H  把光标停到最底行
//
// 后置那步是为了 iTerm2 的 cursor guide（那条跟着光标走的高亮）。
// 不归位的话，光标停在「最后一次写入的位置」—— 每帧不一样，引导线就在屏幕上乱窜。
//
// 停在底部而不是 (0,0)：底部是输入框所在的位置，也就是用户注意力所在。
//
// 顺带一个反直觉的点：diff 为空（hasDiff 为 false）时这一对**整个不发**。
// 因为不发写入就不需要管光标在哪，多发一次 CSI H 只是白费字节。
    if (this.altScreenActive && hasDiff) {
      // Prepend CSI H to anchor the physical cursor to (0,0) so
      // log-update's relative moves compute from a known spot (self-healing
      // against out-of-band cursor drift, see the ALT_SCREEN_ANCHOR_CURSOR
      // comment above). Append CSI row;1 H to park the cursor at the bottom
      // row (where the prompt input is) — without this, the cursor ends
      // wherever the last diff write landed (a different row every frame),
      // making iTerm2's cursor guide flicker as it chases the cursor.
      // BSU/ESU protects content atomicity but iTerm2's guide tracks cursor
      // position independently. Parking at bottom (not 0,0) keeps the guide
      // where the user's attention is.
      //
      // After resize, prepend ERASE_SCREEN too. The diff only writes cells
      // that changed; cells where new=blank and prev-buffer=blank get skipped
      // — but the physical terminal still has stale content there (shorter
      // lines at new width leave old-width text tails visible). ERASE inside
      // BSU/ESU is atomic: old content stays visible until the whole
      // erase+paint lands, then swaps in one go. Writing ERASE_SCREEN
      // synchronously in handleResize would blank the screen for the ~80ms
      // render() takes.
      if (this.needsEraseBeforePaint) {
        this.needsEraseBeforePaint = false;
        optimized.unshift(ERASE_THEN_HOME_PATCH);
      } else {
        optimized.unshift(CURSOR_HOME_PATCH);
      }
      optimized.push(this.altScreenParkPatch);
    }

// 【原生光标定位：终端里做中文输入的关键机制】
//
//   输入法的预编辑串（拼音、候选）是由**终端模拟器**画在物理光标位置的，
//   不是应用画的。所以要让拼音出现在输入框的 caret 处，
//   就必须把物理光标真的移到那里。
//
//   同理：读屏软件和屏幕放大器也是跟着物理光标走的。
//   这条「把光标停到声明位置」的逻辑对无障碍是必需的，不是锦上添花。
//
//   661 行的查法值得注意：从 nodeCache 取这个节点的屏幕矩形。
//   如果它这帧没渲染（组件已卸载、或滚出视口），缓存里就没有 → 不发移动。
//   **用「缓存里有没有」表达「这个元素现在可不可见」**，比另设标志位可靠。
    // Native cursor positioning: park the terminal cursor at the declared
    // position so IME preedit text renders inline and screen readers /
    // magnifiers can follow the input. nodeCache holds the absolute screen
    // rect populated by renderNodeToOutput this frame (including scrollTop
    // translation) — if the declared node didn't render (stale declaration
    // after remount, or scrolled out of view), it won't be in the cache
    // and no move is emitted.
    const decl = this.cursorDeclaration;
    const rect = decl !== null ? nodeCache.get(decl.node) : undefined;
    const target = decl !== null && rect !== undefined ? {
      x: rect.x + decl.relativeX,
      y: rect.y + decl.relativeY
    } : null;
    const parked = this.displayCursor;

// 【空 diff 的零写入快路径】
//
//   三个条件任一成立才需要处理光标：
//     hasDiff                        有内容要写 → 后面光标会被打乱
//     targetMoved                    光标该去的位置变了
//     target === null && parked !== null   声明被清掉了，得把光标还回去
//
//   都不成立时一条字节都不发 —— 空闲的 CLI 在 60 帧节流下依然是 0 写入。
//
//   676-685 行那段「主屏前导移动」是个容易忽略的坑：
//   log-update 的相对移动假设物理光标在 prevFrame.cursor。
//   但上一帧我们把光标停在了输入框 caret 上（不在这里），
//   所以先补一次相对移动挪回去，否则整帧的坐标全错。
//   alt 屏不需要：它每帧都有 CSI H 兜底。
    // Preserve the empty-diff zero-write fast path: skip all cursor writes
    // when nothing rendered AND the park target is unchanged.
    const targetMoved = target !== null && (parked === null || parked.x !== target.x || parked.y !== target.y);
    if (hasDiff || targetMoved || target === null && parked !== null) {
      // Main-screen preamble: log-update's relative moves assume the
      // physical cursor is at prevFrame.cursor. If last frame parked it
      // elsewhere, move back before the diff runs. Alt-screen's CSI H
      // already resets to (0,0) so no preamble needed.
      if (parked !== null && !this.altScreenActive && hasDiff) {
        const pdx = prevFrame.cursor.x - parked.x;
        const pdy = prevFrame.cursor.y - parked.y;
        if (pdx !== 0 || pdy !== 0) {
          optimized.unshift({
            type: 'stdout',
            content: cursorMove(pdx, pdy)
          });
        }
      }
      if (target !== null) {
        if (this.altScreenActive) {
          // Absolute CUP (1-indexed); next frame's CSI H resets regardless.
          // Emitted after altScreenParkPatch so the declared position wins.
          const row = Math.min(Math.max(target.y + 1, 1), terminalRows);
          const col = Math.min(Math.max(target.x + 1, 1), terminalWidth);
          optimized.push({
            type: 'stdout',
            content: cursorPosition(row, col)
          });
        } else {
          // After the diff (or preamble), cursor is at frame.cursor. If no
          // diff AND previously parked, it's still at the old park position
          // (log-update wrote nothing). Otherwise it's at frame.cursor.
          const from = !hasDiff && parked !== null ? parked : {
            x: frame.cursor.x,
            y: frame.cursor.y
          };
          const dx = target.x - from.x;
          const dy = target.y - from.y;
          if (dx !== 0 || dy !== 0) {
            optimized.push({
              type: 'stdout',
              content: cursorMove(dx, dy)
            });
          }
        }
        this.displayCursor = target;
      } else {
        // Declaration cleared (input blur, unmount). Restore physical cursor
        // to frame.cursor before forgetting the park position — otherwise
        // displayCursor=null lies about where the cursor is, and the NEXT
        // frame's preamble (or log-update's relative moves) computes from a
        // wrong spot. The preamble above handles hasDiff; this handles
        // !hasDiff (e.g. accessibility mode where blur doesn't change
        // renderedValue since invert is identity).
        if (parked !== null && !this.altScreenActive && !hasDiff) {
          const rdx = frame.cursor.x - parked.x;
          const rdy = frame.cursor.y - parked.y;
          if (rdx !== 0 || rdy !== 0) {
            optimized.push({
              type: 'stdout',
              content: cursorMove(rdx, rdy)
            });
          }
        }
        this.displayCursor = null;
      }
    }
// 全文件唯一真正写终端的地方。
// 在这之前的所有步骤都只是构造字符串 —— 可以把 optimized 打印出来看，
// 不会有任何副作用。这一点在调试时非常有用。
    const tWrite = performance.now();
    writeDiffToTerminal(this.terminal, optimized, this.altScreenActive && !SYNC_OUTPUT_SUPPORTED);
    const writeMs = performance.now() - tWrite;

// 【prevFrameContaminated：把「这一帧干过什么」传给下一帧】
//
//   如果这一帧往屏幕缓冲里写了选区反色/搜索高亮，那 frontFrame 里存的就是
//   **被涂改过的**画面。下一帧如果按 blit 快速路径（「这块没变，直接拷贝」），
//   拷的就是涂改后的像素 —— 选区会拖影。
//
//   所以帧末把这个标志置上，下一帧强制全量重绘一次，然后自然恢复快速路径。
//
//   代价是「选区变化后多一帧全绘」。可接受，因为选区变化本来就是低频的。
    // Update blit safety for the NEXT frame. The frame just rendered
    // becomes frontFrame (= next frame's prevScreen). If we applied the
    // selection overlay, that buffer has inverted cells. selActive/hlActive
    // are only ever true in alt-screen; in main-screen this is false→false.
    this.prevFrameContaminated = selActive || hlActive;

// 【为什么这里不能用 scheduleRender —— 一段 lodash throttle 的内部行为】
//
//   此刻我们正处在 throttle 的 trailing 调用里，内部 timerId 已被清空。
//   如果调 scheduleRender()，lodash 看到 timeSinceLastCall >= wait，
//   会认为该走 leading edge → **立即执行** → 和当前帧只差 0.1ms 的第二帧。
//   用户看到的是滚动时轻微抖动。
//
//   所以用一个裸 setTimeout。并且 at onRender 开头（424 行）会把它清掉，
//   如果这期间来了滚轮事件，那一帧会顺便处理掉待消费的量，不会重复。
//
//   另一个数字：FRAME_INTERVAL_MS >> 2，即四分之一帧间隔（约 250fps）。
//   因为 drain 帧极便宜（DECSTBM + 十几个 patch，约 200 字节），
//   跑快点能让快速滑动更顺。
    // A ScrollBox has pendingScrollDelta left to drain — schedule the next
    // frame. MUST NOT call this.scheduleRender() here: we're inside a
    // trailing-edge throttle invocation, timerId is undefined, and lodash's
    // debounce sees timeSinceLastCall >= wait (last call was at the start
    // of this window) → leadingEdge fires IMMEDIATELY → double render ~0.1ms
    // apart → jank. Use a plain timeout. If a wheel event arrives first,
    // its scheduleRender path fires a render which clears this timer at
    // the top of onRender — no double.
    //
    // Drain frames are cheap (DECSTBM + ~10 patches, ~200 bytes) so run at
    // quarter interval (~250fps, setTimeout practical floor) for max scroll
    // speed. Regular renders stay at FRAME_INTERVAL_MS via the throttle.
    if (frame.scrollDrainPending) {
      this.drainTimer = setTimeout(() => this.onRender(), FRAME_INTERVAL_MS >> 2);
    }
    const yogaMs = getLastYogaMs();
    const commitMs = getLastCommitMs();
    const yc = this.lastYogaCounters;
    // Reset so drain-only frames (no React commit) don't repeat stale values.
    resetProfileCounters();
    this.lastYogaCounters = {
      ms: 0,
      visited: 0,
      measured: 0,
      cacheHits: 0,
      live: 0
    };
// 一帧的九个阶段耗时全部吐给 onFrame。这是性能排障的唯一接口：
// 卡顿时看 phases 里哪一项大，就知道该查 renderer（绘制）、
// diff（比较）、optimize（合并）还是 write（真实 IO）。
//
// yogaVisited / measured / cacheHits / live 来自 yoga 自己的计数器 ——
// 「cacheHits 很低」直接意味着布局在反复重算。
//
// 760-771 行把计数器读完就清零，是为了让「只 drain 没有 React commit」的帧
// 不要重复上报上一帧的旧值。
    this.options.onFrame?.({
      durationMs: performance.now() - renderStart,
      phases: {
        renderer: rendererMs,
        diff: diffMs,
        optimize: optimizeMs,
        write: writeMs,
        patches: diff.length,
        yoga: yogaMs,
        commit: commitMs,
        yogaVisited: yc.visited,
        yogaMeasured: yc.measured,
        yogaCacheHits: yc.cacheHits,
        yogaLive: yc.live
      },
      flickers
    });
  }
// pause：交接给外部 TUI 之前，先**同步**把待提交的 React 更新 flush 掉，
// 再画一帧。
//
// 顺序不能反：如果先置 isPaused，onRender 会直接 early-return（421 行），
// 屏幕上就停在一个半旧的状态。外部编辑器退出后用户看到的是「刚才那一瞬间」，
// 而不是最新的对话内容。
  pause(): void {
    // Flush pending React updates and render before pausing.
    // @ts-expect-error flushSyncFromReconciler exists in react-reconciler 0.31 but not in @types/react-reconciler
    reconciler.flushSyncFromReconciler();
    this.onRender();
    this.isPaused = true;
  }
  resume(): void {
    this.isPaused = false;
    this.onRender();
  }

  /**
   * Reset frame buffers so the next render writes the full screen from scratch.
   * Call this before resume() when the terminal content has been corrupted by
   * an external process (e.g. tmux, shell, full-screen TUI).
   */
// repaint 与 forceRedraw 的分工：
//   repaint     只重置内部状态（双帧 + log 基准），不发任何清屏序列
//   forceRedraw 真的清屏，然后再让内部状态失效
//
// 用途不同：repaint 是「我们的基准不可信了」（SIGCONT、外部编辑器退出）；
// forceRedraw 是「屏幕上的内容不可信了」（Cmd+K 清屏、tmux 重排）。
//
// 两者都要把 displayCursor 置 null —— 物理光标位置未知时，
// 任何按旧位置算的相对移动都会把内容写歪。
  repaint(): void {
    this.frontFrame = emptyFrame(this.frontFrame.viewport.height, this.frontFrame.viewport.width, this.stylePool, this.charPool, this.hyperlinkPool);
    this.backFrame = emptyFrame(this.backFrame.viewport.height, this.backFrame.viewport.width, this.stylePool, this.charPool, this.hyperlinkPool);
    this.log.reset();
    // Physical cursor position is unknown after external terminal corruption.
    // Clear displayCursor so the cursor preamble doesn't emit a stale
    // relative move from where we last parked it.
    this.displayCursor = null;
  }

  /**
   * Clear the physical terminal and force a full redraw.
   *
   * The traditional readline ctrl+l — clears the visible screen and
   * redraws the current content. Also the recovery path when the terminal
   * was cleared externally (macOS Cmd+K) and Ink's diff engine thinks
   * unchanged cells don't need repainting. Scrollback is preserved.
   */
// 【Ctrl+L 的传统语义 + 外部清屏后的恢复】
//
//   问题在于：diff 引擎的原则是「没变的格子不用重画」。
//   用户按 Cmd+K 把终端清空了，但 frontFrame 里还记着「这些格子是这些内容」。
//   下一帧 diff 会认为「什么都没变」→ 一条字节都不发 → 屏幕保持空白。
//
//   所以必须**主动**把 frontFrame 清掉，骗 diff 说「之前什么都没有」，
//   于是整屏都会被重画。
//
//   832 行把 prevFrameContaminated 也置真，是因为 repaint 会把 frontFrame
//   重置成 0×0，而 blit 从空白缓冲拷贝等于「把内容擦掉」。两道保险缺一不可。
  forceRedraw(): void {
    if (!this.options.stdout.isTTY || this.isUnmounted || this.isPaused) return;
    this.options.stdout.write(ERASE_SCREEN + CURSOR_HOME);
    if (this.altScreenActive) {
      this.resetFramesForAltScreen();
    } else {
      this.repaint();
      // repaint() resets frontFrame to 0×0. Without this flag the next
      // frame's blit optimization copies from that empty screen and the
      // diff sees no content. onRender resets the flag at frame end.
      this.prevFrameContaminated = true;
    }
    this.onRender();
  }

  /**
   * Mark the previous frame as untrustworthy for blit, forcing the next
   * render to do a full-damage diff instead of the per-node fast path.
   *
   * Lighter than forceRedraw() — no screen clear, no extra write. Call
   * from a useLayoutEffect cleanup when unmounting a tall overlay: the
   * blit fast path can copy stale cells from the overlay frame into rows
   * the shrunken layout no longer reaches, leaving a ghost title/divider.
   * onRender resets the flag at frame end so it's one-shot.
   */
// forceRedraw 的轻量版：不清屏，只让下一帧走全量 diff。
//
// 典型场景（注释里那个）：卸载一个很高的浮层之后，blit 快速路径会把
// 浮层那一帧的残留格子拷进「新布局已经到不了的行」，留下鬼影标题/分隔线。
//
// 一次性的：onRender 帧末（743 行）会把它重置。
  invalidatePrevFrame(): void {
    this.prevFrameContaminated = true;
  }

  /**
   * Called by the <AlternateScreen> component on mount/unmount.
   * Controls cursor.y clamping in the renderer and gates alt-screen-aware
   * behavior in SIGCONT/resize/unmount handlers. Repaints on change so
   * the first alt-screen frame (and first main-screen frame on exit) is
   * a full redraw with no stale diff state.
   */
// 由 <AlternateScreen> 组件在挂载/卸载时调用。
//
// 它做两件事：改两个布尔量（渲染器用它们决定光标钳制策略）、
// 重置帧缓冲（保证切换后的第一帧是全绘）。
//
// 注意 mouseTracking 只在 active 时才可能为真 —— 退出 alt 屏时
// altScreenMouseTracking 一定是 false，不需要单独清理。
  setAltScreenActive(active: boolean, mouseTracking = false): void {
    if (this.altScreenActive === active) return;
    this.altScreenActive = active;
    this.altScreenMouseTracking = active && mouseTracking;
    if (active) {
      this.resetFramesForAltScreen();
    } else {
      this.repaint();
    }
  }
  get isAltScreenActive(): boolean {
    return this.altScreenActive;
  }

  /**
   * Re-assert terminal modes after a gap (>5s stdin silence or event-loop
   * stall). Catches tmux detach→attach, ssh reconnect, and laptop
   * sleep/wake — none of which send SIGCONT. The terminal may reset DEC
   * private modes on reconnect; this method restores them.
   *
   * Always re-asserts extended key reporting and mouse tracking. Mouse
   * tracking is idempotent (DEC private mode set-when-set is a no-op). The
   * Kitty keyboard protocol is NOT — CSI >1u is a stack push, so we pop
   * first to keep depth balanced (pop on empty stack is a no-op per spec,
   * so after a terminal reset this still restores depth 0→1). Without the
   * pop, each >5s idle gap adds a stack entry, and the single pop on exit
   * or suspend can't drain them — the shell is left in CSI u mode where
   * Ctrl+C/Ctrl+D leak as escape sequences. The alt-screen
   * re-entry (ERASE_SCREEN + frame reset) is NOT idempotent — it blanks the
   * screen — so it's opt-in via includeAltScreen. The stdin-gap caller fires
   * on ordinary >5s idle + keypress and must not erase; the event-loop stall
   * detector fires on genuine sleep/wake and opts in. tmux attach / ssh
   * reconnect typically send a resize, which already covers alt-screen via
   * handleResize.
   */
// 【>5 秒静默或事件循环卡顿之后，重新宣示终端模式】
//
//   三个真实场景，都不发 SIGCONT，所以 handleResume 兜不住：
//     tmux detach → attach、ssh 断线重连、笔记本合盖睡眠
//   这些操作会重置终端的 DEC private mode，而我们这边的标志位还是「已开启」。
//
//   两个细节：
//   ① 鼠标跟踪是幂等的（set-when-set 无副作用），可以每次都发。
//   ② Kitty 键盘协议**不是**幂等的 —— CSI >1u 是**压栈**。
//      所以先 pop 再 push，保持深度恒为 1。不回 pop 的话，
//      每次 >5 秒空闲都加一层，退出时单次 pop 排不干净，
//      shell 会残留在 CSI u 模式，Ctrl+C 变成转义序列漏出来。
//
//   916 行的 includeAltScreen 是另一个「幂等性不同」的例子：
//   重新进入 alt 屏会清屏，**不是**无副作用的。
//   所以只有「确定终端真的掉了 1049 模式」的调用方才传 true
//   （事件循环卡顿检测器），普通的空闲+按键不传。
  reassertTerminalModes = (includeAltScreen = false): void => {
    if (!this.options.stdout.isTTY) return;
    // Don't touch the terminal during an editor handoff — re-enabling kitty
    // keyboard here would undo enterAlternateScreen's disable and nano would
    // start seeing CSI-u sequences again.
    if (this.isPaused) return;
    // Extended keys — re-assert if enabled (App.tsx enables these on
    // allowlisted terminals at raw-mode entry; a terminal reset clears them).
    // Pop-before-push keeps Kitty stack depth at 1 instead of accumulating
    // on each call.
    if (supportsExtendedKeys()) {
      this.options.stdout.write(DISABLE_KITTY_KEYBOARD + ENABLE_KITTY_KEYBOARD + ENABLE_MODIFY_OTHER_KEYS);
    }
    if (!this.altScreenActive) return;
    // Mouse tracking — idempotent, safe to re-assert on every stdin gap.
    if (this.altScreenMouseTracking) {
      this.options.stdout.write(ENABLE_MOUSE_TRACKING);
    }
    // Alt-screen re-entry — destructive (ERASE_SCREEN). Only for callers that
    // have a strong signal the terminal actually dropped mode 1049.
    if (includeAltScreen) {
      this.reenterAltScreen();
    }
  };

  /**
   * Mark this instance as unmounted so future unmount() calls early-return.
   * Called by gracefulShutdown's cleanupTerminalModes() after it has sent
   * EXIT_ALT_SCREEN but before the remaining terminal-reset sequences.
   * Without this, signal-exit's deferred ink.unmount() (triggered by
   * process.exit()) runs the full unmount path: onRender() + writeSync
   * cleanup block + updateContainerSync → AlternateScreen unmount cleanup.
   * The result is 2-3 redundant EXIT_ALT_SCREEN sequences landing on the
   * main screen AFTER printResumeHint(), which tmux (at least) interprets
   * as restoring the saved cursor position — clobbering the resume hint.
   */
// 【提早把 isUnmounted 置真，是为了避免重复退出序列】
//
//   正常路径：gracefulShutdown 已经发过 EXIT_ALT_SCREEN，然后 process.exit()。
//   signal-exit 会在退出时再调一次 ink.unmount()。如果那次走完整流程，
//   会再发 2-3 遍 EXIT_ALT_SCREEN —— 而那时主屏上已经打印了 resume 提示，
//   tmux 会把 1049l 解释成「恢复保存的光标位置」，**把提示冲掉**。
//
//   所以这里先短路：置 isUnmounted（1456 行 early-return），取消待执行的渲染，
//   再把 stdin 从 raw mode 恢复。
//
//   938-941 行那句「必须用 this.options.stdin 而不是 process.stdin」也是个坑：
//   stdin 被管道重定向时，getStdinOverride() 会另外打开 /dev/tty，
//   两者不是同一个设备。用错了就恢复不到真正的那个。
  detachForShutdown(): void {
    this.isUnmounted = true;
    // Cancel any pending throttled render so it doesn't fire between
    // cleanupTerminalModes() and process.exit() and write to main screen.
    this.scheduleRender.cancel?.();
    // Restore stdin from raw mode. unmount() used to do this via React
    // unmount (App.componentWillUnmount → handleSetRawMode(false)) but we're
    // short-circuiting that path. Must use this.options.stdin — NOT
    // process.stdin — because getStdinOverride() may have opened /dev/tty
    // when stdin is piped.
    const stdin = this.options.stdin as NodeJS.ReadStream & {
      isRaw?: boolean;
      setRawMode?: (m: boolean) => void;
    };
    this.drainStdin();
    if (stdin.isTTY && stdin.isRaw && stdin.setRawMode) {
      stdin.setRawMode(false);
    }
  }

  /** @see drainStdin */
// 实现见文件末尾 1664 行。这里只是转一层，让类内调用更短。
  drainStdin(): void {
    drainStdin(this.options.stdin);
  }

  /**
   * Re-enter alt-screen, clear, home, re-enable mouse tracking, and reset
   * frame buffers so the next render repaints from scratch. Self-heal for
   * SIGCONT, resize, and stdin-gap/event-loop-stall (sleep/wake) — any of
   * which can leave the terminal in main-screen mode while altScreenActive
   * stays true. ENTER_ALT_SCREEN is a terminal-side no-op if already in alt.
   */
  private reenterAltScreen(): void {
    this.options.stdout.write(ENTER_ALT_SCREEN + ERASE_SCREEN + CURSOR_HOME + (this.altScreenMouseTracking ? ENABLE_MOUSE_TRACKING : ''));
    this.resetFramesForAltScreen();
  }

  /**
   * Seed prev/back frames with full-size BLANK screens (rows×cols of empty
   * cells, not 0×0). In alt-screen mode, next.screen.height is always
   * terminalRows; if prev.screen.height is 0 (emptyFrame's default),
   * log-update sees heightDelta > 0 ('growing') and calls renderFrameSlice,
   * whose trailing per-row CR+LF at the last row scrolls the alt screen,
   * permanently desyncing the virtual and physical cursors by 1 row.
   *
   * With a rows×cols blank prev, heightDelta === 0 → standard diffEach
   * → moveCursorTo (CSI cursorMove, no LF, no scroll).
   *
   * viewport.height = rows + 1 matches the renderer's alt-screen output,
   * preventing a spurious resize trigger on the first frame. cursor.y = 0
   * matches the physical cursor after ENTER_ALT_SCREEN + CSI H (home).
   */
// 【rows×cols 的空白，而不是 0×0 —— 一个「差一行」的经典 bug】
//
//   emptyFrame 默认给 0×0。alt 屏下如果拿 0×0 当「前帧」，
//   log-update 会比较出 heightDelta > 0（长高了），于是走 renderFrameSlice 那条路，
//   它在最后一行补 CR+LF —— **在 alt 屏里 LF 就是滚动**。
//   滚一行之后，虚拟光标和物理光标永久差一行，之后每帧都错位。
//
//   给一个满尺寸空白之后，heightDelta === 0，走标准 diffEach，
//   全部用 CSI 光标移动定位，不产生任何 LF。
//
//   另外 viewport.height = rows + 1 是为了对齐渲染器的 alt 屏输出，
//   避免第一帧就触发一次「尺寸变了」。
//
//   1008 行再置 prevFrameContaminated：新建的 frontFrame 是空白的，
//   从它 blit 等于把内容擦掉。所以第一帧必须全绘。
  private resetFramesForAltScreen(): void {
    const rows = this.terminalRows;
    const cols = this.terminalColumns;
    const blank = (): Frame => ({
      screen: createScreen(cols, rows, this.stylePool, this.charPool, this.hyperlinkPool),
      viewport: {
        width: cols,
        height: rows + 1
      },
      cursor: {
        x: 0,
        y: 0,
        visible: true
      }
    });
    this.frontFrame = blank();
    this.backFrame = blank();
    this.log.reset();
    // Defense-in-depth: alt-screen skips the cursor preamble anyway (CSI H
    // resets), but a stale displayCursor would be misleading if we later
    // exit to main-screen without an intervening render.
    this.displayCursor = null;
    // Fresh frontFrame is blank rows×cols — blitting from it would copy
    // blanks over content. Next alt-screen frame must full-render.
    this.prevFrameContaminated = true;
  }

  /**
   * Copy the current selection to the clipboard without clearing the
   * highlight. Matches iTerm2's copy-on-select behavior where the selected
   * region stays visible after the automatic copy.
   */
// OSC 52 是「让终端自己把文本放进系统剪贴板」的转义序列。
// 好处是不用碰平台 API（pbcopy/xclip），坏处是很多终端默认禁用。
//
// tmux 里要把 OSC 52 用 DCS 包一层（wrapForMultiplexer），
// 而 tmux 默认策略是丢弃 —— 注释里那句「no regression」就是说：
// 在 tmux 里复制不成功不是我们引入的问题，是 tmux 的配置。
  copySelectionNoClear(): string {
    if (!hasSelection(this.selection)) return '';
    const text = getSelectedText(this.selection, this.frontFrame.screen);
    if (text) {
      // Raw OSC 52, or DCS-passthrough-wrapped OSC 52 inside tmux (tmux
      // drops it silently unless allow-passthrough is on — no regression).
      void setClipboard(text).then(raw => {
        if (raw) this.options.stdout.write(raw);
      });
    }
    return text;
  }

  /**
   * Copy the current text selection to the system clipboard via OSC 52
   * and clear the selection. Returns the copied text (empty if no selection).
   */
  copySelection(): string {
    if (!hasSelection(this.selection)) return '';
    const text = this.copySelectionNoClear();
    clearSelection(this.selection);
    this.notifySelectionChange();
    return text;
  }

  /** Clear the current text selection without copying. */
  clearTextSelection(): void {
    if (!hasSelection(this.selection)) return;
    clearSelection(this.selection);
    this.notifySelectionChange();
  }

  /**
   * Set the search highlight query. Non-empty → all visible occurrences
   * are inverted (SGR 7) on the next frame; first one also underlined.
   * Empty → clears (prevFrameContaminated handles the frame after). Same
   * damage-tracking machinery as selection — setCellStyleId doesn't track
   * damage, so the overlay forces full-frame damage while active.
   */
// 搜索高亮和选区用同一套机制（改屏幕缓冲 + 强制全 damage）。
// 这里只存 query 并请求一帧，真正的扫描在 543 行（applySearchHighlight）。
  setSearchHighlight(query: string): void {
    if (this.searchHighlightQuery === query) return;
    this.searchHighlightQuery = query;
    this.scheduleRender();
  }

  /** Paint an EXISTING DOM subtree to a fresh Screen at its natural
   *  height, scan for query. Returns positions relative to the element's
   *  bounding box (row 0 = element top).
   *
   *  The element comes from the MAIN tree — built with all real
   *  providers, yoga already computed. We paint it to a fresh buffer
   *  with offsets so it lands at (0,0). Same paint path as the main
   *  render. Zero drift. No second React root, no context bridge.
   *
   *  ~1-2ms (paint only, no reconcile — the DOM is already built). */
// 【把已经存在的 DOM 子树重画到一块新缓冲里，然后在新缓冲上扫描】
//
//   为什么不直接算坐标：树里的节点可能被裁剪、被滚动、被 overflow 隐藏，
//   「第 3 行第 5 列是不是这段文字」只有**真正画一遍**才知道。
//   所以复用的就是主渲染那条路径（renderNodeToOutput），只是换个目标缓冲。
//
//   1077 行那个「传 -elLeft/-elTop 让偏移抵消成 0」是省事的技巧：
//   renderNodeToOutput 自己会加元素的 computedLeft/Top，
//   外面减掉同样的值，就落到 (0,0)。
//
//   代价有两处，代码里都写了：
//   ① 多画一遍（约 1-2ms，注释里给了数字）
//   ② 会污染 nodeCache（写入的是临时坐标），所以 1097 行必须 markDirty，
//      让下一次主渲染重算并覆盖回来。**正确性优先于省一次绘制。**
  scanElementSubtree(el: dom.DOMElement): MatchPosition[] {
    if (!this.searchHighlightQuery || !el.yogaNode) return [];
    const width = Math.ceil(el.yogaNode.getComputedWidth());
    const height = Math.ceil(el.yogaNode.getComputedHeight());
    if (width <= 0 || height <= 0) return [];
    // renderNodeToOutput adds el's OWN computedLeft/Top to offsetX/Y.
    // Passing -elLeft/-elTop nets to 0 → paints at (0,0) in our buffer.
    const elLeft = el.yogaNode.getComputedLeft();
    const elTop = el.yogaNode.getComputedTop();
    const screen = createScreen(width, height, this.stylePool, this.charPool, this.hyperlinkPool);
    const output = new Output({
      width,
      height,
      stylePool: this.stylePool,
      screen
    });
    renderNodeToOutput(el, output, {
      offsetX: -elLeft,
      offsetY: -elTop,
      prevScreen: undefined
    });
    const rendered = output.get();
    // renderNodeToOutput wrote our offset positions to nodeCache —
    // corrupts the main render (it'd blit from wrong coords). Mark the
    // subtree dirty so the next main render repaints + re-caches
    // correctly. One extra paint of this message, but correct > fast.
    dom.markDirty(el);
    const positions = scanPositions(rendered, this.searchHighlightQuery);
    logForDebugging(`scanElementSubtree: q='${this.searchHighlightQuery}' ` + `el=${width}x${height}@(${elLeft},${elTop}) n=${positions.length} ` + `[${positions.slice(0, 10).map(p => `${p.row}:${p.col}`).join(',')}` + `${positions.length > 10 ? ',…' : ''}]`);
    return positions;
  }

  /** Set the position-based highlight state. Every frame, writes CURRENT
   *  style at positions[currentIdx] + rowOffset. null clears. The scan-
   *  highlight (inverse on all matches) still runs — this overlays yellow
   *  on top. rowOffset changes as the user scrolls (= message's current
   *  screen-top); positions stay stable (message-relative). */
// 【位置只扫一次，之后靠索引算术平移】
//
//   scanElementSubtree 在消息挂载时扫出「这段消息里第几行第几列有命中」，
//   存成**消息相对坐标**。之后每帧只需要知道「这条消息现在屏幕顶在哪」(rowOffset)，
//   就能把位置映射到屏幕 —— 不需要重新扫描。
//
//   于是「下一个匹配」变成了 positions[currentIdx + 1]，纯粹的索引运算。
//   没有「扫描 → 反馈 → 修正」的环，也就没有「搜索结果跳来跳去」这类 bug。
//
//   这也是为什么搜索在长会话里不卡：每帧的工作量与匹配数无关，只有几十次写入。
  setSearchPositions(state: {
    positions: MatchPosition[];
    rowOffset: number;
    currentIdx: number;
  } | null): void {
    this.searchPositions = state;
    this.scheduleRender();
  }

  /**
   * Set the selection highlight background color. Replaces the per-cell
   * SGR-7 inverse with a solid theme-aware bg (matches native terminal
   * selection). Accepts the same color formats as Text backgroundColor
   * (rgb(), ansi:name, #hex, ansi256()) — colorize() routes through
   * chalk so the tmux/xterm.js level clamps in colorize.ts apply and
   * the emitted SGR is correct for the current terminal.
   *
   * Called by React-land once theme is known (ScrollKeybindingHandler's
   * useEffect watching useTheme). Before that call, withSelectionBg
   * falls back to withInverse so selection still renders on the first
   * frame; the effect fires before any mouse input so the fallback is
   * unobservable in practice.
   */
// 【用一个 NUL 标记，从「着色后的字符串」里反解出开/关序列】
//
//   想拿到「设置这个背景色的 SGR 序列」，正常做法是复制一份 colorize 的映射表。
//   这里的做法更巧：给 colorize 传一个 NUL 字符，得到
//   「ESC[48;5;236m + NUL + ESC[49m」这样的串，再按 NUL 切开 ——
//   前半是开序列，后半是关序列。
//
//   好处是**复用 colorize 的终端能力探测**：tmux 下要降级成 256 色、
//   xterm.js 下要避开某些 SGR，这些逻辑不用重写一遍。
//
//   1136-1140 行的防御：颜色串不合法时 colorize 会原样返回（找不到 NUL），
//   此时落回 setSelectionBg(null) —— 用反色，而不是「没有高亮」。
  setSelectionBgColor(color: string): void {
    // Wrap a NUL marker, then split on it to extract the open/close SGR.
    // colorize returns the input unchanged if the color string is bad —
    // no NUL-split then, so fall through to null (inverse fallback).
    const wrapped = colorize('\0', color, 'background');
    const nul = wrapped.indexOf('\0');
    if (nul <= 0 || nul === wrapped.length - 1) {
      this.stylePool.setSelectionBg(null);
      return;
    }
    this.stylePool.setSelectionBg({
      type: 'ansi',
      code: wrapped.slice(0, nul),
      endCode: wrapped.slice(nul + 1) // always \x1b[49m for bg
    });
    // No scheduleRender: this is called from a React effect that already
    // runs inside the render cycle, and the bg only matters once a
    // selection exists (which itself triggers a full-damage frame).
  }

  /**
   * Capture text from rows about to scroll out of the viewport during
   * drag-to-scroll. Must be called BEFORE the ScrollBox scrolls so the
   * screen buffer still holds the outgoing content. Accumulated into
   * the selection state and joined back in by getSelectedText.
   */
// 必须在滚动**之前**调用：滚动之后屏幕缓冲里那几行已经是新内容了。
// 这是「capture 与 shift 成对」那条规则（468 行）的前半。
  captureScrolledRows(firstRow: number, lastRow: number, side: 'above' | 'below'): void {
    captureScrolledRows(this.selection, this.frontFrame.screen, firstRow, lastRow, side);
  }

  /**
   * Shift anchor AND focus by dRow, clamped to [minRow, maxRow]. Used by
   * keyboard scroll handlers (PgUp/PgDn etc.) so the highlight tracks the
   * content instead of disappearing. Unlike shiftAnchor (drag-to-scroll),
   * this moves BOTH endpoints — the user isn't holding the mouse at one
   * edge. Supplies screen.width for the col-reset-on-clamp boundary.
   */
// 键盘滚动（PgUp/PgDn/g/G）时，选区的**两端一起**按 dRow 平移。
// 与拖动不同的理由很直白：用户没按住鼠标，没有一个「固定端」可言。
  shiftSelectionForScroll(dRow: number, minRow: number, maxRow: number): void {
    const hadSel = hasSelection(this.selection);
    shiftSelection(this.selection, dRow, minRow, maxRow, this.frontFrame.screen.width);
    // shiftSelection clears when both endpoints overshoot the same edge
    // (Home/g/End/G page-jump past the selection). Notify subscribers so
    // useHasSelection updates. Safe to call notifySelectionChange here —
    // this runs from keyboard handlers, not inside onRender().
    if (hadSel && !hasSelection(this.selection)) {
      this.notifySelectionChange();
    }
  }

  /**
   * Keyboard selection extension (shift+arrow/home/end). Moves focus;
   * anchor stays fixed so the highlight grows or shrinks relative to it.
   * Left/right wrap across row boundaries — native macOS text-edit
   * behavior: shift+left at col 0 wraps to end of the previous row.
   * Up/down clamp at viewport edges (no scroll-to-extend yet). Drops to
   * char mode. No-op outside alt-screen or without an active selection.
   */
// 键盘扩展选区（Shift+方向键）。
//
// 两个模拟原生行为的细节：
//   左右跨行 wrap（行首按左 → 上一行行尾），这是 macOS 文本编辑的行为
//   上下在视口边缘 clamp —— 不做「滚到边缘继续扩展」，因为在终端里
//   「滚出去的东西」没有可扩展的坐标
//
// 另外它会 drop 到 char 模式（moveFocus 内部），
// 也就是「双击选了词之后按 Shift+右」会变成按字符扩展。
// 这是对的选择：按词扩展反而不可预期。
  moveSelectionFocus(move: FocusMove): void {
    if (!this.altScreenActive) return;
    const {
      focus
    } = this.selection;
    if (!focus) return;
    const {
      width,
      height
    } = this.frontFrame.screen;
    const maxCol = width - 1;
    const maxRow = height - 1;
    let {
      col,
      row
    } = focus;
    switch (move) {
      case 'left':
        if (col > 0) col--;else if (row > 0) {
          col = maxCol;
          row--;
        }
        break;
      case 'right':
        if (col < maxCol) col++;else if (row < maxRow) {
          col = 0;
          row++;
        }
        break;
      case 'up':
        if (row > 0) row--;
        break;
      case 'down':
        if (row < maxRow) row++;
        break;
      case 'lineStart':
        col = 0;
        break;
      case 'lineEnd':
        col = maxCol;
        break;
    }
    if (col === focus.col && row === focus.row) return;
    moveFocus(this.selection, col, row);
    this.notifySelectionChange();
  }

  /** Whether there is an active text selection. */
  hasTextSelection(): boolean {
    return hasSelection(this.selection);
  }

  /**
   * Subscribe to selection state changes. Fires whenever the selection
   * is started, updated, cleared, or copied. Returns an unsubscribe fn.
   */
  subscribeToSelectionChange(cb: () => void): () => void {
    this.selectionListeners.add(cb);
    return () => this.selectionListeners.delete(cb);
  }
// 【这里可以直接调 onRender，而 506 行那边必须绕开】
//
//   同一个类里两种写法，判据只有一条：**当前是否在 onRender 内部**。
//   notifySelectionChange 由鼠标/键盘处理器调用（在帧之外）→ 直接画一帧没问题。
//   follow-scroll 那段在 onRender 里 → 再调 onRender 就是递归，
//   所以那里只挨个调监听器（它们会安排**之后**的 React 更新）。
//
//   这类「看起来应该统一、实际必须分开」的分支，是重入问题最常见的形态。
  private notifySelectionChange(): void {
    this.onRender();
    for (const cb of this.selectionListeners) cb();
  }

  /**
   * Hit-test the rendered DOM tree at (col, row) and bubble a ClickEvent
   * from the deepest hit node up through ancestors with onClick handlers.
   * Returns true if a DOM handler consumed the click. Gated on
   * altScreenActive — clicks only make sense with a fixed viewport where
   * nodeCache rects map 1:1 to terminal cells (no scrollback offset).
   */
// 【点击只在 alt 屏生效】
//
//   命中测试靠 nodeCache 里的屏幕矩形。alt 屏的坐标系是「视口行列」，
//   和终端当前光标位置一一对应。
//   主屏的坐标系含滚动历史（内容可能在第 3000 行），
//   而终端只能告诉你「我点在视口第 5 行」—— 两者无法映射。
//
//   所以主屏下这个函数直接返回 false，鼠标事件不被处理（终端自己会处理
//   文本选择和 Cmd+Click 链接）。
//
//   1262 行的 blank 参数：点在空格上时不应该触发点击（否则整片背景都能点）。
//   这是「事件冒泡要不要穿过空白」的判断，交给调用方决定不合适，所以在这里算。
  dispatchClick(col: number, row: number): boolean {
    if (!this.altScreenActive) return false;
    const blank = isEmptyCellAt(this.frontFrame.screen, col, row);
    return dispatchClick(this.rootNode, col, row, blank);
  }
  dispatchHover(col: number, row: number): void {
    if (!this.altScreenActive) return;
    dispatchHover(this.rootNode, col, row, this.hoveredNodes);
  }
// 【Tab 是「默认动作」，不是「事件处理」】
//
//   先把 KeyboardEvent 派发给当前焦点元素（或 root），让业务组件有机会处理；
//   只有在 event.defaultPrevented 为 false 时才做焦点循环。
//
//   这完全照搬浏览器语义：Tab 的默认行为可以被 preventDefault 阻止。
//   好处是「自定义 tab 行为的组件」和「不关心 tab 的组件」可以共存，
//   前者不用抢全局键盘监听。
//
//   注意 ctrl/meta 被排除：Ctrl+Tab 是终端的标签切换，不该被我们吃掉。
  dispatchKeyboardEvent(parsedKey: ParsedKey): void {
    const target = this.focusManager.activeElement ?? this.rootNode;
    const event = new KeyboardEvent(parsedKey);
    dispatcher.dispatchDiscrete(target, event);

    // Tab cycling is the default action — only fires if no handler
    // called preventDefault(). Mirrors browser behavior.
    if (!event.defaultPrevented && parsedKey.name === 'tab' && !parsedKey.ctrl && !parsedKey.meta) {
      if (parsedKey.shift) {
        this.focusManager.focusPrevious(this.rootNode);
      } else {
        this.focusManager.focusNext(this.rootNode);
      }
    }
  }
  /**
   * Look up the URL at (col, row) in the current front frame. Checks for
   * an OSC 8 hyperlink first, then falls back to scanning the row for a
   * plain-text URL (mouse tracking intercepts the terminal's native
   * Cmd+Click URL detection, so we replicate it). This is a pure lookup
   * with no side effects — call it synchronously at click time so the
   * result reflects the screen the user actually clicked on, then defer
   * the browser-open action via a timer.
   */
// 【为什么要自己找纯文本 URL】
//
//   正常情况下终端会自己做 Cmd+Click 链接检测。但一旦我们开启了鼠标跟踪
//   （alt 屏里就是这样），终端就把所有鼠标事件交给我们，
//   **原生的链接检测随之失效**。
//
//   所以得自己复刻：先看 OSC 8 超链接（格子上的 hyperlink 字段），
//   没有就扫这一行找 URL 文本（findPlainTextUrlAt）。
//
//   1300 行那个 SpacerTail 分支是宽字符（CJK/emoji）的细节：
//   一个双宽字符占两个格子，第二个格子是「尾巴」，属性记在头格上。
//   点在尾巴上要回头看前一个格子，否则中文链接的后半截点不中。
  getHyperlinkAt(col: number, row: number): string | undefined {
    if (!this.altScreenActive) return undefined;
    const screen = this.frontFrame.screen;
    const cell = cellAt(screen, col, row);
    let url = cell?.hyperlink;
    // SpacerTail cells (right half of wide/CJK/emoji chars) store the
    // hyperlink on the head cell at col-1.
    if (!url && cell?.width === CellWidth.SpacerTail && col > 0) {
      url = cellAt(screen, col - 1, row)?.hyperlink;
    }
    return url ?? findPlainTextUrlAt(screen, col, row);
  }

  /**
   * Optional callback fired when clicking an OSC 8 hyperlink in fullscreen
   * mode. Set by FullscreenLayout via useLayoutEffect.
   */
  onHyperlinkClick: ((url: string) => void) | undefined;

  /**
   * Stable prototype wrapper for onHyperlinkClick. Passed to <App> as
   * onOpenHyperlink so the prop is a bound method (autoBind'd) that reads
   * the mutable field at call time — not the undefined-at-render value.
   */
// 【一个关于「传值还是传方法」的教训】
//
//   onHyperlinkClick 是构造之后才由 FullscreenLayout 设置的。
//   如果 render() 时直接把它的**当前值**作为 prop 传给 <App>，
//   那时还是 undefined —— 之后设置了也不会生效（prop 已经传下去了）。
//
//   所以传的是这个绑定方法（autoBind 保证 this 正确），
//   它每次调用才去读字段的当前值。
//
//   同样的理由参见 1429 行 writeRaw：**跨 React 边界传「会变的东西」时，
//   传一个稳定的读取器，别传快照。**
  openHyperlink(url: string): void {
    this.onHyperlinkClick?.(url);
  }

  /**
   * Handle a double- or triple-click at (col, row): select the word or
   * line under the cursor by reading the current screen buffer. Called on
   * PRESS (not release) so the highlight appears immediately and drag can
   * extend the selection word-by-word / line-by-line. Falls back to
   * char-mode startSelection if the click lands on a noSelect cell.
   */
// 双击/三击在**按下**时选中，而不是等释放。
//
// 这样按住不放就能继续拖动，按词/按行扩展 —— 和原生编辑器的行为一致。
// 如果等释放才选，拖动就变成了「重新开始一个字符级选区」，双击的意义就没了。
//
// 1334 行先做一次 startSelection，是为了保证「即使词/行扫描失败（点在
// noSelect 区域或越界），这次按下仍然开始了选区」—— 否则后续拖动无事可做。
  handleMultiClick(col: number, row: number, count: 2 | 3): void {
    if (!this.altScreenActive) return;
    const screen = this.frontFrame.screen;
    // selectWordAt/selectLineAt no-op on noSelect/out-of-bounds. Seed with
    // a char-mode selection so the press still starts a drag even if the
    // word/line scan finds nothing selectable.
    startSelection(this.selection, col, row);
    if (count === 2) selectWordAt(this.selection, screen, col, row);else selectLineAt(this.selection, screen, row);
    // Ensure hasSelection is true so release doesn't re-dispatch onClickAt.
    // selectWordAt no-ops on noSelect; selectLineAt no-ops out-of-bounds.
    if (!this.selection.focus) this.selection.focus = this.selection.anchor;
    this.notifySelectionChange();
  }

  /**
   * Handle a drag-motion at (col, row). In char mode updates focus to the
   * exact cell. In word/line mode snaps to word/line boundaries so the
   * selection extends by word/line like native macOS. Gated on
   * altScreenActive for the same reason as dispatchClick.
   */
// 拖动时按模式分派：
//   anchorSpan 存在（双击/三击建立的）→ 按词/行扩展
//   否则 → 逐字符更新 focus
//
// 「按词扩展」不是「每次移动都重新选词」那么粗暴：extendSelection
// 内部会按 span 边界对齐，所以拖过半个词时会整词选中，
// 再拖回来也不会变成半个 —— 这是 macOS 的行为。
  handleSelectionDrag(col: number, row: number): void {
    if (!this.altScreenActive) return;
    const sel = this.selection;
    if (sel.anchorSpan) {
      extendSelection(sel, this.frontFrame.screen, col, row);
    } else {
      updateSelection(sel, col, row);
    }
    this.notifySelectionChange();
  }

  // Methods to properly suspend stdin for external editor usage
  // This is needed to prevent Ink from swallowing keystrokes when an external editor is active
  private stdinListeners: Array<{
    event: string;
    listener: (...args: unknown[]) => void;
  }> = [];
  private wasRawMode = false;
// 【交接给外部编辑器：光关 raw mode 是不够的】
//
//   还要把 stdin 上所有 'readable' 监听器**摘下来**。
//   因为 Ink 自己的输入循环也挂在 readable 上，不摘的话：
//   编辑器在跑，Ink 也在读键盘，两边抢同一批字节 ——
//   表现是「在 vim 里打字，Claude 的输入框也在动」。
//
//   1372 行的做法是「读 listeners 数组 → 逐个 removeListener → 存起来」，
//   恢复时再 addListener 回去。顺序和身份都必须一致，
//   所以存的是 { event, listener } 而不是只存函数。
  suspendStdin(): void {
    const stdin = this.options.stdin;
    if (!stdin.isTTY) {
      return;
    }

    // Store and remove all 'readable' event listeners temporarily
    // This prevents Ink from consuming stdin while the editor is active
    const readableListeners = stdin.listeners('readable');
    logForDebugging(`[stdin] suspendStdin: removing ${readableListeners.length} readable listener(s), wasRawMode=${(stdin as NodeJS.ReadStream & {
      isRaw?: boolean;
    }).isRaw ?? false}`);
    readableListeners.forEach(listener => {
      this.stdinListeners.push({
        event: 'readable',
        listener: listener as (...args: unknown[]) => void
      });
      stdin.removeListener('readable', listener as (...args: unknown[]) => void);
    });

    // If raw mode is enabled, disable it temporarily
    const stdinWithRaw = stdin as NodeJS.ReadStream & {
      isRaw?: boolean;
      setRawMode?: (mode: boolean) => void;
    };
    if (stdinWithRaw.isRaw && stdinWithRaw.setRawMode) {
      stdinWithRaw.setRawMode(false);
      this.wasRawMode = true;
    }
  }
// 1403 行的告警值得注意：如果恢复时既没有存下的监听器、
// 也没有 wasRawMode，说明这对函数被调用得不配对了。
//
// 但这里**只记日志不抛错** —— 因为 resumeStdin 可能在退出路径上被调用，
// 那里抛异常会让终端留在 raw mode（比不同步严重得多）。
//
// 「不变量被破坏时报警但不中断」是退出路径的通用策略。
  resumeStdin(): void {
    const stdin = this.options.stdin;
    if (!stdin.isTTY) {
      return;
    }

    // Re-attach all the stored listeners
    if (this.stdinListeners.length === 0 && !this.wasRawMode) {
      logForDebugging('[stdin] resumeStdin: called with no stored listeners and wasRawMode=false (possible desync)', {
        level: 'warn'
      });
    }
    logForDebugging(`[stdin] resumeStdin: re-attaching ${this.stdinListeners.length} listener(s), wasRawMode=${this.wasRawMode}`);
    this.stdinListeners.forEach(({
      event,
      listener
    }) => {
      stdin.addListener(event, listener);
    });
    this.stdinListeners = [];

    // Re-enable raw mode if it was enabled before
    if (this.wasRawMode) {
      const stdinWithRaw = stdin as NodeJS.ReadStream & {
        setRawMode?: (mode: boolean) => void;
      };
      if (stdinWithRaw.setRawMode) {
        stdinWithRaw.setRawMode(true);
      }
      this.wasRawMode = false;
    }
  }

// 【一个内联箭头函数能造成的连锁反应】
//
//   如果把 writeRaw 写成内联箭头传给 Context，它每次 render() 都是新引用
//   → useContext 的消费者重渲染 → <AlternateScreen> 的 useLayoutEffect
//   依赖数组变化 → 退出再进入 alt 屏。
//
//   于是用户每拖一次窗口（SIGWINCH → render()），屏幕就闪一次。
//   这行注释记录的就是这个 bug。
//
//   所以它必须是一个**原型上的方法**（autoBind 保证 this 不变）。
  // Stable identity for TerminalWriteContext. An inline arrow here would
  // change on every render() call (initial mount + each resize), which
  // cascades through useContext → <AlternateScreen>'s useLayoutEffect dep
  // array → spurious exit+re-enter of the alt screen on every SIGWINCH.
  private writeRaw(data: string): void {
    this.options.stdout.write(data);
  }
// setCursorDeclaration 的第二个参数 clearIfNode 是个「守卫」：
// 组件卸载时会调用 clear(null)，但那时可能已经有**别的组件**声明了新的光标位置。
// 如果不加判断地清空，后来者的声明就被误删了。
//
// 所以只有当「当前声明的节点 === 要求清理的节点」时才真的清。
// 这是「清理操作必须带上身份」的典型写法 —— 和 React 的 setState 回调、
// 事件监听的 removeEventListener 是同一类问题。
  private setCursorDeclaration: CursorDeclarationSetter = (decl, clearIfNode) => {
    if (decl === null && clearIfNode !== undefined && this.cursorDeclaration?.node !== clearIfNode) {
      return;
    }
    this.cursorDeclaration = decl;
  };
// 【Ink 与 React 树的唯一接缝，就是这一串 props】
//
//   往下传的全是**能力**，不是状态：
//     onClickAt / onHoverAt / onMultiClick / onSelectionDrag  交互回调
//     getHyperlinkAt / onOpenHyperlink                        链接
//     dispatchKeyboardEvent                                   键盘
//     onCursorDeclaration                                     光标
//     onStdinResume                                           终端模式重宣
//
//   组件层（App.tsx）负责把终端字节解析成这些调用，
//   Ink 负责把这些调用翻译成状态变化和重绘。中间没有别的耦合。
//
//   TerminalWriteProvider 单独包一层，是为了给「需要直接写终端」的少数组件
//   （比如进度条 OSC、剪贴板）一个受控出口，而不是让它们去摸 process.stdout。
  render(node: ReactNode): void {
    this.currentNode = node;
    const tree = <App stdin={this.options.stdin} stdout={this.options.stdout} stderr={this.options.stderr} exitOnCtrlC={this.options.exitOnCtrlC} onExit={this.unmount} terminalColumns={this.terminalColumns} terminalRows={this.terminalRows} selection={this.selection} onSelectionChange={this.notifySelectionChange} onClickAt={this.dispatchClick} onHoverAt={this.dispatchHover} getHyperlinkAt={this.getHyperlinkAt} onOpenHyperlink={this.openHyperlink} onMultiClick={this.handleMultiClick} onSelectionDrag={this.handleSelectionDrag} onStdinResume={this.reassertTerminalModes} onCursorDeclaration={this.setCursorDeclaration} dispatchKeyboardEvent={this.dispatchKeyboardEvent}>
        <TerminalWriteProvider value={this.writeRaw}>
          {node}
        </TerminalWriteProvider>
      </App>;

// 【同步渲染，不用并发特性】
//
//   两个理由：
//   ① 帧的输出顺序必须确定 —— 终端是有状态的，两条交错的写入序列会画出乱码
//   ② 调用方依赖同步语义：render() 返回后立刻读 lastFrame() 应该拿到新内容
//      （测试尤其依赖这一点）
//
//   代价是长列表的大更新会阻塞事件循环 —— 所以组件层要做虚拟滚动，
//   而不是指望 React 的 time slicing。
    // @ts-expect-error updateContainerSync exists in react-reconciler but not in @types/react-reconciler
    reconciler.updateContainerSync(tree, this.container, null, noop);
    // @ts-expect-error flushSyncWork exists in react-reconciler but not in @types/react-reconciler
    reconciler.flushSyncWork();
  }
// 【unmount 的顺序是一份「终端资源释放清单」】
//
//     1. 先画最后一帧（1459）—— 让用户看到最终状态
//     2. 恢复 console / stderr（1461-1464）
//     3. 渲染「退出后的静态内容」（1469-1470）
//     4. **同步**写一串终端模式复位（1480-1505）
//     5. 置 isUnmounted，取消所有定时器（1508-1515）
//     6. 卸载 React 树（1518-1520）
//     7. 释放 root 的 yoga 节点（1526-1527）
//
//   第 4 步必须在第 5 步之前：置 isUnmounted 之后 onRender 就 early-return 了，
//   而那时如果还有待写的复位序列，就再也没机会发出去。
  unmount(error?: Error | number | null): void {
    if (this.isUnmounted) {
      return;
    }
    this.onRender();
    this.unsubscribeExit();
    if (typeof this.restoreConsole === 'function') {
      this.restoreConsole();
    }
    this.restoreStderr?.();
    this.unsubscribeTTYHandlers?.();

    // Non-TTY environments don't handle erasing ansi escapes well, so it's better to
    // only render last frame of non-static output
    const diff = this.log.renderPreviousOutput_DEPRECATED(this.frontFrame);
    writeDiffToTerminal(this.terminal, optimize(diff));

// 【为什么用 writeSync 而不是 stdout.write】
//
//   因为这段可能跑在 process.exit() 的路径上，异步写会被直接丢弃。
//   而丢弃的后果是终端留在 raw mode / 鼠标跟踪开启 / 光标不可见 ——
//   用户回到 shell 后打字看不见，这是 CLI 最恶劣的 bug。
//
//   宁可阻塞几毫秒，也要保证这几条序列真的写出去了。
    // Clean up terminal modes synchronously before process exit.
    // React's componentWillUnmount won't run in time when process.exit() is called,
    // so we must reset terminal modes here to prevent escape sequence leakage.
    // Use writeSync to stdout (fd 1) to ensure writes complete before exit.
    // We unconditionally send all disable sequences because terminal detection
    // may not work correctly (e.g., in tmux, screen) and these are no-ops on
    // terminals that don't support them.
    /* eslint-disable custom-rules/no-sync-fs -- process exiting; async writes would be dropped */
// 【无条件发所有 disable 序列，不做探测】
//
//   看起来浪费，但终端能力探测本身不可靠（tmux、screen、各种模拟器
//   对 DA1/DA2 的回应五花八门），而这些都是「关闭某个模式」的序列 ——
//   在没开启该模式的终端上是**无害的 no-op**。
//
//   于是「多发几条」的成本远低于「漏发一条」。这是关闭类操作特有的宽容度：
//   **幂等的清理可以激进，幂等的设置不行。**
//
//   注意 1481 行 EXIT_ALT_SCREEN 必须**第一个**发：
//   否则后面那些复位序列会打在 alt 屏上，用户退出后主屏还是脏的。
    if (this.options.stdout.isTTY) {
      if (this.altScreenActive) {
        // <AlternateScreen>'s unmount effect won't run during signal-exit.
        // Exit alt screen FIRST so other cleanup sequences go to the main screen.
        writeSync(1, EXIT_ALT_SCREEN);
      }
      // Disable mouse tracking — unconditional because altScreenActive can be
      // stale if AlternateScreen's unmount (which flips the flag) raced a
      // blocked event loop + SIGINT. No-op if tracking was never enabled.
      writeSync(1, DISABLE_MOUSE_TRACKING);
      // Drain stdin so in-flight mouse events don't leak to the shell
      this.drainStdin();
      // Disable extended key reporting (both kitty and modifyOtherKeys)
      writeSync(1, DISABLE_MODIFY_OTHER_KEYS);
      writeSync(1, DISABLE_KITTY_KEYBOARD);
      // Disable focus events (DECSET 1004)
      writeSync(1, DFE);
      // Disable bracketed paste mode
      writeSync(1, DBP);
      // Show cursor
      writeSync(1, SHOW_CURSOR);
      // Clear iTerm2 progress bar
      writeSync(1, CLEAR_ITERM2_PROGRESS);
      // Clear tab status (OSC 21337) so a stale dot doesn't linger
      if (supportsTabStatus()) writeSync(1, wrapForMultiplexer(CLEAR_TAB_STATUS));
    }
    /* eslint-enable custom-rules/no-sync-fs */

    this.isUnmounted = true;

    // Cancel any pending throttled renders to prevent accessing freed Yoga nodes
    this.scheduleRender.cancel?.();
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

// 先取消待执行的渲染，再卸 React 树 —— 顺序很重要。
//
//   反过来的话，throttle 的 trailing 调用可能在树已卸载、
//   yoga 节点已释放之后触发，那时 onRender 会访问已 free 的 WASM 节点。
//   而且 isUnmounted 只挡住了 onRender 的开头，挡不住「已经在队列里的回调」。
    // @ts-expect-error updateContainerSync exists in react-reconciler but not in @types/react-reconciler
    reconciler.updateContainerSync(null, this.container, null, noop);
    // @ts-expect-error flushSyncWork exists in react-reconciler but not in @types/react-reconciler
    reconciler.flushSyncWork();
    instances.delete(this.options.stdout);

// free() 而不是 freeRecursive()：子节点已经被 reconciler 的
// removeChildFromContainer 逐个释放过了，再递归一次就是**双重释放**。
//
// 这类「谁负责释放」的问题在 C/WASM 边界上永远要显式想一遍，
// 而在 JS 侧通常被 GC 掩盖掉了。
    // Free the root yoga node, then clear its reference. Children are already
    // freed by the reconciler's removeChildFromContainer; using .free() (not
    // .freeRecursive()) avoids double-freeing them.
    this.rootNode.yogaNode?.free();
    this.rootNode.yogaNode = undefined;
    if (error instanceof Error) {
      this.rejectExitPromise(error);
    } else {
      this.resolveExitPromise();
    }
  }
// 懒 promise：只有真正有人 await 的时候才创建。
// 没人等的时候多建一个 promise 不算大问题，但更重要的是语义 ——
// 这个 promise 的存在本身就代表「有人在等退出」。
  async waitUntilExit(): Promise<void> {
    this.exitPromise ||= new Promise((resolve, reject) => {
      this.resolveExitPromise = resolve;
      this.rejectExitPromise = reject;
    });
    return this.exitPromise;
  }
// 类似 repaint，但**保留 backFrame 用于复用**（不新建两次 emptyFrame）。
//
// 用法是「这一批输出结束了，下一批从头开始」——
// 主屏模式下换一轮内容（比如切换对话）时清掉行数记录。
  resetLineCount(): void {
    if (this.options.stdout.isTTY) {
      // Swap so old front becomes back (for screen reuse), then reset front
      this.backFrame = this.frontFrame;
      this.frontFrame = emptyFrame(this.frontFrame.viewport.height, this.frontFrame.viewport.width, this.stylePool, this.charPool, this.hyperlinkPool);
      this.log.reset();
      // frontFrame is reset, so frame.cursor on the next render is (0,0).
      // Clear displayCursor so the preamble doesn't compute a stale delta.
      this.displayCursor = null;
    }
  }

  /**
   * Replace char/hyperlink pools with fresh instances to prevent unbounded
   * growth during long sessions. Migrates the front frame's screen IDs into
   * the new pools so diffing remains correct. The back frame doesn't need
   * migration — resetScreen zeros it before any reads.
   *
   * Call between conversation turns or periodically.
   */
// 【换池必须迁移，否则全屏重绘】
//
//   屏幕格子不存字符串/样式本身，只存**池里的索引**。
//   换了新池，旧索引在新池里指向完全不同的东西（或者是空的）。
//   diff 一比较，每个格子都「变了」→ 整屏重画。
//
//   所以 frontFrame 必须 migrate（把旧索引映射到新池里的等价项）。
//   backFrame 不用迁 —— 它在被读之前会被 resetScreen 清零，
//   但它的 pool 引用要指向新池（1568 行），否则下一帧写进去的索引
//   会落到旧池里，又对不上。
//
//   这是「间接引用表换表」的经典问题：**数据本身没问题，是解引用失效了。**
  resetPools(): void {
    this.charPool = new CharPool();
    this.hyperlinkPool = new HyperlinkPool();
    migrateScreenPools(this.frontFrame.screen, this.charPool, this.hyperlinkPool);
    // Back frame's data is zeroed by resetScreen before reads, but its pool
    // references are used by the renderer to intern new characters. Point
    // them at the new pools so the next frame's IDs are comparable.
    this.backFrame.screen.charPool = this.charPool;
    this.backFrame.screen.hyperlinkPool = this.hyperlinkPool;
  }
// 【必须接管 console，否则任何一句 console.log 都会毁掉界面】
//
//   终端 UI 独占 stdout。一行 console.log 会插在当前光标处，
//   把布局冲乱（而 diff 引擎还以为屏幕上是它画的内容，之后每帧都在修错）。
//
//   做法：把所有 console 方法重定向到调试日志。
//   注意分了两组（1721-1722 行）：log/info/debug/... → 普通日志，
//   warn/error/trace → 错误日志。分组的目的是让「真错误」留在错误通道里，
//   不被淹没在调试输出中。
//
//   console.assert 单独处理（1585）：它没有输出，只在条件为假时输出。
  patchConsole(): () => void {
    // biome-ignore lint/suspicious/noConsole: intentionally patching global console
    const con = console;
    const originals: Partial<Record<keyof Console, Console[keyof Console]>> = {};
    const toDebug = (...args: unknown[]) => logForDebugging(`console.log: ${format(...args)}`);
    const toError = (...args: unknown[]) => logError(new Error(`console.error: ${format(...args)}`));
    for (const m of CONSOLE_STDOUT_METHODS) {
      originals[m] = con[m];
      con[m] = toDebug;
    }
    for (const m of CONSOLE_STDERR_METHODS) {
      originals[m] = con[m];
      con[m] = toError;
    }
    originals.assert = con.assert;
    con.assert = (condition: unknown, ...args: unknown[]) => {
      if (!condition) toError(...args);
    };
    return () => Object.assign(con, originals);
  }

  /**
   * Intercept process.stderr.write so stray writes (config.ts, hooks.ts,
   * third-party deps) don't corrupt the alt-screen buffer. patchConsole only
   * hooks console.* methods — direct stderr writes bypass it, land at the
   * parked cursor, scroll the alt-screen, and desync frontFrame from the
   * physical terminal. Next diff writes only changed-in-React cells at
   * absolute coords → interleaved garbage.
   *
   * Swallows the write (routes text to the debug log) and, in alt-screen,
   * forces a full-damage repaint as a defensive recovery. Not patching
   * process.stdout — Ink itself writes there.
   */
// 【console 之外还有直接写 stderr 的代码】
//
//   config.ts、hooks.ts、第三方依赖都可能直接 process.stderr.write。
//   在 alt 屏下这些字节会落在**停泊的光标位置**上，把内容顶上去 →
//   frontFrame 与物理终端失步 → 之后 diff 只写「变化过的格子」，
//   于是屏幕上留下交错的垃圾。
//
//   所以连 stderr.write 一起接管：文字转进调试日志，
//   并且（alt 屏下）强制下一帧全绘作为恢复。
//
//   三个细节：
//   ① 不接管 process.stdout —— Ink 自己就要往那儿写
//   ② 1613 行的重入守卫：logForDebugging 内部会写 stderr，
//      又回到这里。放行给原始 write，否则栈溢出。
//   ③ 1619 行把 Buffer 转成 utf8 再记日志 —— 直接打 Buffer 会是一串十六进制
  private patchStderr(): () => void {
    const stderr = process.stderr;
    const originalWrite = stderr.write;
    let reentered = false;
    const intercept = (chunk: Uint8Array | string, encodingOrCb?: BufferEncoding | ((err?: Error) => void), cb?: (err?: Error) => void): boolean => {
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      // Reentrancy guard: logForDebugging → writeToStderr → here. Pass
      // through to the original so --debug-to-stderr still works and we
      // don't stack-overflow.
      if (reentered) {
        const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
        return originalWrite.call(stderr, chunk, encoding, callback);
      }
      reentered = true;
      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        logForDebugging(`[stderr] ${text}`, {
          level: 'warn'
        });
        if (this.altScreenActive && !this.isUnmounted && !this.isPaused) {
          this.prevFrameContaminated = true;
          this.scheduleRender();
        }
      } finally {
        reentered = false;
        callback?.();
      }
      return true;
    };
    stderr.write = intercept;
    return () => {
      if (stderr.write === intercept) {
        stderr.write = originalWrite;
      }
    };
  }
}

/**
 * Discard pending stdin bytes so in-flight escape sequences (mouse tracking
 * reports, bracketed-paste markers) don't leak to the shell after exit.
 *
 * Two layers of trickiness:
 *
 * 1. setRawMode is termios, not fcntl — the stdin fd stays blocking, so
 *    readSync on it would hang forever. Node doesn't expose fcntl, so we
 *    open /dev/tty fresh with O_NONBLOCK (all fds to the controlling
 *    terminal share one line-discipline input queue).
 *
 * 2. By the time forceExit calls this, detachForShutdown has already put
 *    the TTY back in cooked (canonical) mode. Canonical mode line-buffers
 *    input until newline, so O_NONBLOCK reads return EAGAIN even when
 *    mouse bytes are sitting in the buffer. We briefly re-enter raw mode
 *    so reads return any available bytes, then restore cooked mode.
 *
 * Safe to call multiple times. Call as LATE as possible in the exit path:
 * DISABLE_MOUSE_TRACKING has terminal round-trip latency, so events can
 * arrive for a few ms after it's written.
 */
/* eslint-disable custom-rules/no-sync-fs -- must be sync; called from signal handler / unmount */
// 【两层麻烦，注释写得很清楚】
//
//   ① setRawMode 是 termios 操作，不是 fcntl —— stdin 的 fd 仍然是阻塞的，
//      对它 readSync 会永远挂住。Node 不暴露 fcntl，
//      所以只能自己 open('/dev/tty', O_NONBLOCK)（控制终端共享同一个输入队列）。
//
//   ② 走到这里时，detachForShutdown 已经把 TTY 恢复成 cooked 模式了。
//      cooked 模式是**行缓冲**的：不到换行不交出字节。
//      所以 O_NONBLOCK 读也会返回 EAGAIN —— 鼠标上报的字节明明在缓冲区里。
//      解法是临时切回 raw，读完再切回去。
//
//   64 次 × 1KB 的上限（1696 行）是防御「某个终端不认 O_NONBLOCK」：
//   真实情况下一波鼠标事件只有几百字节。
//
//   这段必须在**退出路径的最后**调用：DISABLE_MOUSE_TRACKING 写到终端后，
//   还有几毫秒会让鼠标事件继续到达。早调用等于没调用。
export function drainStdin(stdin: NodeJS.ReadStream = process.stdin): void {
  if (!stdin.isTTY) return;
  // Drain Node's stream buffer (bytes libuv already pulled in). read()
  // returns null when empty — never blocks.
  try {
    while (stdin.read() !== null) {
      /* discard */
    }
  } catch {
    /* stream may be destroyed */
  }
  // No /dev/tty on Windows; CONIN$ doesn't support O_NONBLOCK semantics.
  // Windows Terminal also doesn't buffer mouse reports the same way.
  if (process.platform === 'win32') return;
  // termios is per-device: flip stdin to raw so canonical-mode line
  // buffering doesn't hide partial input from the non-blocking read.
  // Restored in the finally block.
  const tty = stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (raw: boolean) => void;
  };
  const wasRaw = tty.isRaw === true;
  // Drain the kernel TTY buffer via a fresh O_NONBLOCK fd. Bounded at 64
  // reads (64KB) — a real mouse burst is a few hundred bytes; the cap
  // guards against a terminal that ignores O_NONBLOCK.
  let fd = -1;
  try {
    // setRawMode inside try: on revoked TTY (SIGHUP/SSH disconnect) the
    // ioctl throws EBADF — same recovery path as openSync/readSync below.
    if (!wasRaw) tty.setRawMode?.(true);
    fd = openSync('/dev/tty', fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < 64; i++) {
      if (readSync(fd, buf, 0, buf.length, null) <= 0) break;
    }
  } catch {
    // EAGAIN (buffer empty — expected), ENXIO/ENOENT (no controlling tty),
    // EBADF/EIO (TTY revoked — SIGHUP, SSH disconnect)
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    if (!wasRaw) {
      try {
        tty.setRawMode?.(false);
      } catch {
        /* TTY may be gone */
      }
    }
  }
}
/* eslint-enable custom-rules/no-sync-fs */

// 分两组重定向：普通输出走调试日志，warning/error 走错误日志。
// 分开的意义是「真错误」应该在日志里可被过滤出来，
// 而不是和成千上万条调试信息混在一起。
const CONSOLE_STDOUT_METHODS = ['log', 'info', 'debug', 'dir', 'dirxml', 'count', 'countReset', 'group', 'groupCollapsed', 'groupEnd', 'table', 'time', 'timeEnd', 'timeLog'] as const;
const CONSOLE_STDERR_METHODS = ['warn', 'error', 'trace'] as const;
// 原文件此处有一行 174376 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。