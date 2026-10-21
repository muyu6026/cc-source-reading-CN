// ═══════════════════════════════════════════════════════════════
//  App：stdin 的唯一拥有者
// ═══════════════════════════════════════════════════════════════
//
//  整个 ink 里只有这一个地方读 stdin。它同时是五件事的负责人：
//
//  1. raw mode 的**引用计数**（谁要谁 +1，最后一个 -1 时才真的关）
//  2. 终端模式的**宣示**（bracketed paste / focus reporting /
//     extended keys / 光标可见性）—— 这些是「开启后要靠自己关掉」的，
//     所以必须有一个唯一的所有者，否则没人负责收尾
//  3. 按键流水线的**批处理边界**：一批字节 → 一批事件 → 一次
//     discreteUpdates（否则会 "Maximum update depth exceeded"）
//  4. 终端查询的**应答分发**（kind === 'response' → querier）
//  5. 鼠标的**状态机**（单击 / 双击 / 三击 / 拖选 / hover /
//     丢失 release 的三种恢复）
//
//  第 5 件事占了文件的一半，而且它本可以放在 Ink 里 —— 之所以留在这，
//  是因为状态都挂在 App 实例上（lastClickTime / clickCount / hovered 坐标），
//  而 App 是唯一一个「跨帧存活、又能被 stdin 回调直接触到」的对象。
//
//  ── 阅读顺序建议 ──
//  handleSetRawMode（模式宣示）→ processInput / flushIncomplete（解析）
//  → processKeysInBatch（分流）→ handleMouseEvent（鼠标状态机）
import React, { PureComponent, type ReactNode } from 'react';
import { updateLastInteractionTime } from '../../bootstrap/state.js';
import { logForDebugging } from '../../utils/debug.js';
import { stopCapturingEarlyInput } from '../../utils/earlyInput.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isMouseClicksDisabled } from '../../utils/fullscreen.js';
import { logError } from '../../utils/log.js';
import { EventEmitter } from '../events/emitter.js';
import { InputEvent } from '../events/input-event.js';
import { TerminalFocusEvent } from '../events/terminal-focus-event.js';
import { INITIAL_STATE, type ParsedInput, type ParsedKey, type ParsedMouse, parseMultipleKeypresses } from '../parse-keypress.js';
import reconciler from '../reconciler.js';
import { finishSelection, hasSelection, type SelectionState, startSelection } from '../selection.js';
import { isXtermJs, setXtversionName, supportsExtendedKeys } from '../terminal.js';
import { getTerminalFocused, setTerminalFocused } from '../terminal-focus-state.js';
import { TerminalQuerier, xtversion } from '../terminal-querier.js';
import { DISABLE_KITTY_KEYBOARD, DISABLE_MODIFY_OTHER_KEYS, ENABLE_KITTY_KEYBOARD, ENABLE_MODIFY_OTHER_KEYS, FOCUS_IN, FOCUS_OUT } from '../termio/csi.js';
import { DBP, DFE, DISABLE_MOUSE_TRACKING, EBP, EFE, HIDE_CURSOR, SHOW_CURSOR } from '../termio/dec.js';
import AppContext from './AppContext.js';
import { ClockProvider } from './ClockContext.js';
import CursorDeclarationContext, { type CursorDeclarationSetter } from './CursorDeclarationContext.js';
import ErrorOverview from './ErrorOverview.js';
import StdinContext from './StdinContext.js';
import { TerminalFocusProvider } from './TerminalFocusContext.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';

// Platforms that support Unix-style process suspension (SIGSTOP/SIGCONT)
const SUPPORTS_SUSPEND = process.platform !== 'win32';

// After this many milliseconds of stdin silence, the next chunk triggers
// a terminal mode re-assert (mouse tracking). Catches tmux detach→attach,
// ssh reconnect, and laptop wake — the terminal resets DEC private modes
// but no signal reaches us. 5s is well above normal inter-keystroke gaps
// but short enough that the first scroll after reattach works.
const STDIN_RESUME_GAP_MS = 5000;
// 【为什么是「静默 5 秒」这种时间判据】
//
// tmux detach 再 attach、ssh 断线重连、笔记本合盖再打开 —— 这三种情况
// 终端都会重置 DEC 私有模式（鼠标追踪、bracketed paste 全没了），
// 但**没有任何信号能到达进程**：stdin 不 EOF、不报错，它只是安静了。
//
// 唯一可观测的东西是「安静了多久」。5 秒的取舍写在注释里：远高于
// 正常打字间隔，又短到「重新接上后的第一次滚动就能生效」。
//
// 这是整份文件里第二处「用时间猜状态」的地方（第一处是 50ms 的
// flush 定时器）。两处都是无奈之举，也都有明确的取值理由。
type Props = {
  readonly children: ReactNode;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
  readonly exitOnCtrlC: boolean;
  readonly onExit: (error?: Error) => void;
  readonly terminalColumns: number;
  readonly terminalRows: number;
  // Text selection state. App mutates this directly from mouse events
  // and calls onSelectionChange to trigger a repaint. Mouse events only
  // arrive when <AlternateScreen> (or similar) enables mouse tracking,
  // so the handler is always wired but dormant until tracking is on.
  readonly selection: SelectionState;
  readonly onSelectionChange: () => void;
  // Dispatch a click at (col, row) — hit-tests the DOM tree and bubbles
  // onClick handlers. Returns true if a DOM handler consumed the click.
  // No-op (returns false) outside fullscreen mode (Ink.dispatchClick
  // gates on altScreenActive).
  readonly onClickAt: (col: number, row: number) => boolean;
  // Dispatch hover (onMouseEnter/onMouseLeave) as the pointer moves over
  // DOM elements. Called for mode-1003 motion events with no button held.
  // No-op outside fullscreen (Ink.dispatchHover gates on altScreenActive).
  readonly onHoverAt: (col: number, row: number) => void;
  // Look up the OSC 8 hyperlink at (col, row) synchronously at click
  // time. Returns the URL or undefined. The browser-open is deferred by
  // MULTI_CLICK_TIMEOUT_MS so double-click can cancel it.
  readonly getHyperlinkAt: (col: number, row: number) => string | undefined;
  // Open a hyperlink URL in the browser. Called after the timer fires.
  readonly onOpenHyperlink: (url: string) => void;
  // Called on double/triple-click PRESS at (col, row). count=2 selects
  // the word under the cursor; count=3 selects the line. Ink reads the
  // screen buffer to find word/line boundaries and mutates selection,
  // setting isDragging=true so a subsequent drag extends by word/line.
  readonly onMultiClick: (col: number, row: number, count: 2 | 3) => void;
  // Called on drag-motion. Mode-aware: char mode updates focus to the
  // exact cell; word/line mode snaps to word/line boundaries. Needs
  // screen-buffer access (word boundaries) so lives on Ink, not here.
  readonly onSelectionDrag: (col: number, row: number) => void;
  // Called when stdin data arrives after a >STDIN_RESUME_GAP_MS gap.
  // Ink re-asserts terminal modes: extended key reporting, and (when in
  // fullscreen) re-enters alt-screen + mouse tracking. Idempotent on the
  // terminal side. Optional so testing.tsx doesn't need to stub it.
  readonly onStdinResume?: () => void;
// 注意这两个回调是 optional 的，注释给的理由很实在：
// "Optional so testing.tsx doesn't need to stub it"。
//
// 也就是说 **Props 的形状被测试便利性影响过**。这在生产代码里很常见，
// 但读的时候如果不注意，会误以为「可选 = 可有可无」。实际上
// onStdinResume 缺失的后果是「tmux 重连后鼠标不能用」，
// onCursorDeclaration 缺失的后果是「IME 输入法候选框位置不对」。
// 两者都只在真实终端里才暴露。
  // Receives the declared native-cursor position from useDeclaredCursor
  // so ink.tsx can park the terminal cursor there after each frame.
  // Enables IME composition at the input caret and lets screen readers /
  // magnifiers track the input. Optional so testing.tsx doesn't stub it.
  readonly onCursorDeclaration?: CursorDeclarationSetter;
  // Dispatch a keyboard event through the DOM tree. Called for each
  // parsed key alongside the legacy EventEmitter path.
  readonly dispatchKeyboardEvent: (parsedKey: ParsedKey) => void;
};

// Multi-click detection thresholds. 500ms is the macOS default; a small
// position tolerance allows for trackpad jitter between clicks.
const MULTI_CLICK_TIMEOUT_MS = 500;
const MULTI_CLICK_DISTANCE = 1;
type State = {
  readonly error?: Error;
};

// Root component for all Ink apps
// It renders stdin and stdout contexts, so that children can access them if needed
// It also handles Ctrl+C exiting and cursor visibility
export default class App extends PureComponent<Props, State> {
  static displayName = 'InternalApp';
  static getDerivedStateFromError(error: Error) {
    return {
      error
    };
  }
  override state = {
    error: undefined
  };

  // Count how many components enabled raw mode to avoid disabling
  // raw mode until all components don't need it anymore
  rawModeEnabledCount = 0;
// 引用计数，不是布尔。原因：raw mode 是**全局终端状态**，而想开它的
// 组件有很多（每个 useInput 一个）。用布尔的话，第一个组件卸载就会
// 把还在用的其他组件一起关掉 —— 表现为「关掉某个面板后输入框失灵」。
//
// 计数的另一个好处是 handleSuspend 能把计数存下来、恢复时按原数
// 重新加上（第 396-422 行），这样挂起/恢复不会丢层级。
  internal_eventEmitter = new EventEmitter();
  keyParseState = INITIAL_STATE;
  // Timer for flushing incomplete escape sequences
  incompleteEscapeTimer: NodeJS.Timeout | null = null;
  // Timeout durations for incomplete sequences (ms)
  readonly NORMAL_TIMEOUT = 50; // Short timeout for regular esc sequences
// 【两个超时，差 10 倍，原因只有一个：粘贴不是按键】
//
// 50ms：普通转义序列的续块间隔。人在终端里敲键盘，ESC 后面的字节
// 几乎同时到达；50ms 已经远超正常间隔。
//
// 500ms：粘贴（bracketed paste 模式）。一份大粘贴会被终端切成很多块，
// 块之间的间隔取决于终端处理速度，可能远超过 50ms。用 50ms 的话，
// 长粘贴会在中途被判成「不完整序列」而 flush —— 结果是粘贴内容被
// 切成几段，中间还漏进几个假的 Esc。
//
// 判据在第 329 行：解析状态机的 mode 是不是 'IN_PASTE'。也就是说
// **超时时长由解析器告诉它**，不是 App 自己猜。
  readonly PASTE_TIMEOUT = 500; // Longer timeout for paste operations

  // Terminal query/response dispatch. Responses arrive on stdin (parsed
  // out by parse-keypress) and are routed to pending promise resolvers.
  querier = new TerminalQuerier(this.props.stdout);

  // Multi-click tracking for double/triple-click text selection. A click
  // within MULTI_CLICK_TIMEOUT_MS and MULTI_CLICK_DISTANCE of the previous
  // click increments clickCount; otherwise it resets to 1.
  lastClickTime = 0;
  lastClickCol = -1;
  lastClickRow = -1;
  clickCount = 0;
  // Deferred hyperlink-open timer — cancelled if a second click arrives
  // within MULTI_CLICK_TIMEOUT_MS (so double-clicking a hyperlink selects
  // the word without also opening the browser). DOM onClick dispatch is
  // NOT deferred — it returns true from onClickAt and skips this timer.
  pendingHyperlinkTimer: ReturnType<typeof setTimeout> | null = null;
  // Last mode-1003 motion position. Terminals already dedupe to cell
  // granularity but this also lets us skip dispatchHover entirely on
  // repeat events (drag-then-release at same cell, etc.).
  lastHoverCol = -1;
  lastHoverRow = -1;

  // Timestamp of last stdin chunk. Used to detect long gaps (tmux attach,
  // ssh reconnect, laptop wake) and trigger terminal mode re-assert.
  // Initialized to now so startup doesn't false-trigger.
  lastStdinTime = Date.now();
// 初始化成 now，而不是 0 —— 否则启动后第一次输入就会被判成
// 「安静了很久」（now - 0 是个巨大的数），立刻触发一次
// reassertTerminalModes。无害但会多写一串序列，而且日志里会出现
// 一条莫名其妙的「resume」。

  // Determines if TTY is supported on the provided stdin
  isRawModeSupported(): boolean {
    return this.props.stdin.isTTY;
  }
  override render() {
    return <TerminalSizeContext.Provider value={{
      columns: this.props.terminalColumns,
      rows: this.props.terminalRows
    }}>
        <AppContext.Provider value={{
        exit: this.handleExit
      }}>
          <StdinContext.Provider value={{
          stdin: this.props.stdin,
          setRawMode: this.handleSetRawMode,
          isRawModeSupported: this.isRawModeSupported(),
          internal_exitOnCtrlC: this.props.exitOnCtrlC,
          internal_eventEmitter: this.internal_eventEmitter,
          internal_querier: this.querier
        }}>
            <TerminalFocusProvider>
              <ClockProvider>
                <CursorDeclarationContext.Provider value={this.props.onCursorDeclaration ?? (() => {})}>
                  {this.state.error ? <ErrorOverview error={this.state.error as Error} /> : this.props.children}
                </CursorDeclarationContext.Provider>
              </ClockProvider>
            </TerminalFocusProvider>
          </StdinContext.Provider>
        </AppContext.Provider>
      </TerminalSizeContext.Provider>;
  }
  override componentDidMount() {
    // In accessibility mode, keep the native cursor visible for screen magnifiers and other tools
    if (this.props.stdout.isTTY && !isEnvTruthy(process.env.CLAUDE_CODE_ACCESSIBILITY)) {
      this.props.stdout.write(HIDE_CURSOR);
    }
  }
  override componentWillUnmount() {
    if (this.props.stdout.isTTY) {
      this.props.stdout.write(SHOW_CURSOR);
    }

    // Clear any pending timers
    if (this.incompleteEscapeTimer) {
      clearTimeout(this.incompleteEscapeTimer);
      this.incompleteEscapeTimer = null;
    }
    if (this.pendingHyperlinkTimer) {
      clearTimeout(this.pendingHyperlinkTimer);
      this.pendingHyperlinkTimer = null;
    }
    // ignore calling setRawMode on an handle stdin it cannot be called
    if (this.isRawModeSupported()) {
      this.handleSetRawMode(false);
    }
  }
  override componentDidCatch(error: Error) {
    this.handleExit(error);
  }
  handleSetRawMode = (isEnabled: boolean): void => {
// 【这个函数的形状是两个约束挤出来的】
//
//   · 幂等门：只有 count === 0 时才真的写那串开启序列（第 223 行）。
//     每次 +1 都重写一遍会导致模式被反复 push（kitty 键盘协议是**栈**）
//   · 不支持 raw mode 时抛错而不是静默返回。注释里区分了
//     「用的是 process.stdin」和「用的是自定义 stream」两种情况，
//     因为报错信息要指向不同的修法
//
//  关闭路径（第 269 行）也是「减到 0 才真关」，顺序是反的：
// 先关扩展按键、再关 focus、再关粘贴、最后 setRawMode(false)。
// 顺序有讲究 —— 先关掉「会产生额外序列的模式」，再退出 raw mode，
// 否则最后几个字节可能以奇怪的形状漏到 shell 上。
    const {
      stdin
    } = this.props;
    if (!this.isRawModeSupported()) {
      if (stdin === process.stdin) {
        throw new Error('Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported');
      } else {
        throw new Error('Raw mode is not supported on the stdin provided to Ink.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported');
      }
    }
    stdin.setEncoding('utf8');
    if (isEnabled) {
      // Ensure raw mode is enabled only once
      if (this.rawModeEnabledCount === 0) {
        // Stop early input capture right before we add our own readable handler.
        // Both use the same stdin 'readable' + read() pattern, so they can't
        // coexist -- our handler would drain stdin before Ink's can see it.
        // The buffered text is preserved for REPL.tsx via consumeEarlyInput().
        stopCapturingEarlyInput();
// earlyInput 是「应用还没起来时先把用户敲的字存着」的机制
// （用户在启动那一秒就开始打字是常见的）。
//
// 它和 ink 抢同一个 stdin：两者都用 'readable' + read()。两个消费者
// 不能共存 —— 谁先读谁把数据拿走。所以这里必须显式让它停手，
// 而且要在 addListener 之前（下一行）。
//
// 已经存下的文本不会丢，REPL 那边用 consumeEarlyInput() 取走。
        stdin.ref();
        stdin.setRawMode(true);
        stdin.addListener('readable', this.handleReadable);
        // Enable bracketed paste mode
        this.props.stdout.write(EBP);
        // Enable terminal focus reporting (DECSET 1004)
        this.props.stdout.write(EFE);
        // Enable extended key reporting so ctrl+shift+<letter> is
        // distinguishable from ctrl+<letter>. We write both the kitty stack
        // push (CSI >1u) and xterm modifyOtherKeys level 2 (CSI >4;2m) —
        // terminals honor whichever they implement (tmux only accepts the
        // latter).
        if (supportsExtendedKeys()) {
          this.props.stdout.write(ENABLE_KITTY_KEYBOARD);
          this.props.stdout.write(ENABLE_MODIFY_OTHER_KEYS);
        }
// 【两个序列都发，因为不知道对面认哪个】
//
//   ENABLE_KITTY_KEYBOARD   = CSI > 1 u   （push，栈式）
//   ENABLE_MODIFY_OTHER_KEYS = CSI > 4 ; 2 m
//
// 注释里那句 "tmux only accepts the latter" 是关键：tmux 会过滤掉
// 它不认识的 CSI，而 kitty 协议较新。两个都发，谁认谁生效。
//
// 门控在 supportsExtendedKeys()（terminal.ts 的白名单 + 事故记忆）。
// 保守是必要的 —— 见下面第 271 行那条**不对称**。
        // Probe terminal identity. XTVERSION survives SSH (query/reply goes
        // through the pty), unlike TERM_PROGRAM. Used for wheel-scroll base
        // detection when env vars are absent. Fire-and-forget: the DA1
        // sentinel bounds the round-trip, and if the terminal ignores the
        // query, flush() still resolves and name stays undefined.
        // Deferred to next tick so it fires AFTER the current synchronous
        // init sequence completes — avoids interleaving with alt-screen/mouse
        // tracking enable writes that may happen in the same render cycle.
        setImmediate(() => {
          void Promise.all([this.querier.send(xtversion()), this.querier.flush()]).then(([r]) => {
            if (r) {
              setXtversionName(r.name);
              logForDebugging(`XTVERSION: terminal identified as "${r.name}"`);
            } else {
              logForDebugging('XTVERSION: no reply (terminal ignored query)');
            }
          });
        });
// setImmediate 延后一轮，不是「随手加个异步」：
//
// 这一段之前已经同步写了 alt screen、鼠标追踪等一串序列。XTVERSION
// 是**查询**，它的应答会从 stdin 回来 —— 如果和开启序列挤在同一个
// 同步块里，应答可能先于 alt screen 建立就到达，被当成普通按键处理。
// 推到下一轮，保证「本轮所有写入已经完成」。
//
// 查询本身是 fire-and-forget：只影响滚轮补偿系数，失败也不影响功能。
      }
      this.rawModeEnabledCount++;
      return;
    }

    // Disable raw mode only when no components left that are using it
    if (--this.rawModeEnabledCount === 0) {
      this.props.stdout.write(DISABLE_MODIFY_OTHER_KEYS);
      this.props.stdout.write(DISABLE_KITTY_KEYBOARD);
// ⚠️ 【启用受门控，禁用不受门控 —— 这个不对称值得记下来】
//
// 第 241 行：`if (supportsExtendedKeys())` 才写 ENABLE_KITTY_KEYBOARD
// 第 271 行：无条件写 DISABLE_KITTY_KEYBOARD
//
// 而 DISABLE_KITTY_KEYBOARD 是 `CSI < u`，它的语义是 **pop** ——
// 从终端的键盘协议栈里弹出一层，不是「关掉」。
//
// 后果分两种情况：
//   · 终端不支持 kitty 协议 → 这条序列被忽略，没问题
//   · 终端支持，但 supportsExtendedKeys() 判成了 false（白名单漏了
//     某个终端、或者判断依赖的环境变量缺失）→ 我们**没 push 却 pop 了**，
//     弹掉的是外层（用户 shell / 上层应用）push 的那一层
//
// 第二种情况下，退出 Claude Code 之后终端的键盘行为会变（变成基础
// 协议，ctrl+shift+字母 之类失效）。这类 bug 极难归因，因为症状
// 出现在「另一个程序」里。
//
// 正确写法本该是「记录有没有 push 过」。这不是当前的实现 —— 记下来
// 是因为读代码时这一对必须对照着看，单看任何一行都合理。
      // Disable terminal focus reporting (DECSET 1004)
      this.props.stdout.write(DFE);
      // Disable bracketed paste mode
      this.props.stdout.write(DBP);
      stdin.setRawMode(false);
      stdin.removeListener('readable', this.handleReadable);
      stdin.unref();
    }
  };

  // Helper to flush incomplete escape sequences
  flushIncomplete = (): void => {
    // Clear the timer reference
    this.incompleteEscapeTimer = null;

    // Only proceed if we have incomplete sequences
    if (!this.keyParseState.incomplete) return;

    // Fullscreen: if stdin has data waiting, it's almost certainly the
    // continuation of the buffered sequence (e.g. `[<64;74;16M` after a
    // lone ESC). Node's event loop runs the timers phase before the poll
    // phase, so when a heavy render blocks the loop past 50ms, this timer
    // fires before the queued readable event even though the bytes are
    // already buffered. Re-arm instead of flushing: handleReadable will
    // drain stdin next and clear this timer. Prevents both the spurious
    // Escape key and the lost scroll event.
    if (this.props.stdin.readableLength > 0) {
      this.incompleteEscapeTimer = setTimeout(this.flushIncomplete, this.NORMAL_TIMEOUT);
      return;
    }
// 【Node 事件循环阶段的顺序，在这里救了场】
//
// 定时器到点时，续块可能**已经在缓冲区里**了 —— 但因为一次重渲染
// 阻塞了事件循环超过 50ms，timers 阶段先于 poll 阶段跑，于是这个
// 定时器比 readable 回调先执行。
//
// 如果按「超时了就 flush」处理，就会把一个完整的鼠标序列劈成
// 「一个假的 Esc + 一截尾巴」（那截尾巴的善后逻辑在
// events/input-event.ts:90）。
//
// 所以这里先问一句：stdin 里还有没有已经到货的字节？有就**重新装
// 一个定时器**，把机会让给下一轮 readable。
//
// 这是「时间判据错了，但可以再问一次事实」的补救 —— 比把超时
// 调大可靠得多（调大只会让另一个方向的延迟变差）。

    // Process incomplete as a flush operation (input=null)
    // This reuses all existing parsing logic
    this.processInput(null);
  };

  // Process input through the parser and handle the results
  processInput = (input: string | Buffer | null): void => {
    // Parse input using our state machine
    const [keys, newState] = parseMultipleKeypresses(this.keyParseState, input);
    this.keyParseState = newState;

    // Process ALL keys in a SINGLE discreteUpdates call to prevent
    // "Maximum update depth exceeded" error when many keys arrive at once
    // (e.g., from paste operations or holding keys rapidly).
    // This batches all state updates from handleInput and all useInput
    // listeners together within one high-priority update context.
    if (keys.length > 0) {
      reconciler.discreteUpdates(processKeysInBatch, this, keys, undefined, undefined);
// 【一次 discreteUpdates 包住整批，为什么不能一次一个】
//
// 粘贴 100 个字符时，如果每个字符调一次 discreteUpdates，就是 100 次
// 同步渲染；而这 100 次里每次都会触发 useInput → setState → 又一次
// 渲染，React 会认为更新在渲染期间无限发生，抛
// "Maximum update depth exceeded"。
//
// 包成一批之后：一次同步 flush，所有监听者的 setState 合并。
// 代价是「批内任何一次 setState 都要等整批处理完」，但按键处理本来就
// 是同步且极快的。
//
// 注意 processKeysInBatch 的签名 (app, items, undefined, undefined) ——
// 后面两个 undefined 是为了凑 discreteUpdates 的四个参数位（它只支持
// 两个自定义参数）。这是 react-reconciler 的接口限制，不是设计。
    }

    // If we have incomplete escape sequences, set a timer to flush them
    if (this.keyParseState.incomplete) {
      // Cancel any existing timer first
      if (this.incompleteEscapeTimer) {
        clearTimeout(this.incompleteEscapeTimer);
      }
      this.incompleteEscapeTimer = setTimeout(this.flushIncomplete, this.keyParseState.mode === 'IN_PASTE' ? this.PASTE_TIMEOUT : this.NORMAL_TIMEOUT);
// 超时时长由解析器的 mode 决定，见第 120 行的批注。
// 注意每次重设定时器前要先清旧的 —— 否则连打两个不完整序列时，
// 第一个定时器会提前把第二个序列刷掉。
    }
  };
  handleReadable = (): void => {
    // Detect long stdin gaps (tmux attach, ssh reconnect, laptop wake).
    // The terminal may have reset DEC private modes; re-assert mouse
    // tracking. Checked before the read loop so one Date.now() covers
    // all chunks in this readable event.
    const now = Date.now();
    if (now - this.lastStdinTime > STDIN_RESUME_GAP_MS) {
      this.props.onStdinResume?.();
    }
    this.lastStdinTime = now;
    try {
      let chunk;
      while ((chunk = this.props.stdin.read() as string | null) !== null) {
        // Process the input chunk
        this.processInput(chunk);
      }
    } catch (error) {
      // In Bun, an uncaught throw inside a stream 'readable' handler can
      // permanently wedge the stream: data stays buffered and 'readable'
      // never re-emits. Catching here ensures the stream stays healthy so
      // subsequent keystrokes are still delivered.
      logError(error);
// 【Bun 的流会「焊死」】
//
// 注释描述的现象很具体：'readable' 回调里抛未捕获异常，在 Bun 下会
// 让整个流永久卡住 —— 数据还在缓冲里，但 readable 再也不触发。
// 于是「一个按键解析出 bug」的表现是「整个会话失去输入」，
// 而进程还活着。
//
// 所以这里 triple 保险：catch 住 → 记日志 → **检查监听者还在不在，
// 不在就重新挂**。第三件事是关键，因为 Bun 可能因为异常把监听者摘掉。
//
// 这类「不报错只失效」的失败模式，比抛错难查一个数量级。

      // Re-attach the listener in case the exception detached it.
      // Bun may remove the listener after an error; without this,
      // the session freezes permanently (stdin reader dead, event loop alive).
      const {
        stdin
      } = this.props;
      if (this.rawModeEnabledCount > 0 && !stdin.listeners('readable').includes(this.handleReadable)) {
        logForDebugging('handleReadable: re-attaching stdin readable listener after error recovery', {
          level: 'warn'
        });
        stdin.addListener('readable', this.handleReadable);
      }
    }
  };
  handleInput = (input: string | undefined): void => {
    // Exit on Ctrl+C
    if (input === '\x03' && this.props.exitOnCtrlC) {
      this.handleExit();
    }

    // Note: Ctrl+Z (suspend) is now handled in processKeysInBatch using the
    // parsed key to support both raw (\x1a) and CSI u format from Kitty
    // keyboard protocol terminals (Ghostty, iTerm2, kitty, WezTerm)
  };
  handleExit = (error?: Error): void => {
    if (this.isRawModeSupported()) {
      this.handleSetRawMode(false);
    }
    this.props.onExit(error);
  };
  handleTerminalFocus = (isFocused: boolean): void => {
    // setTerminalFocused notifies subscribers: TerminalFocusProvider (context)
    // and Clock (interval speed) — no App setState needed.
    setTerminalFocused(isFocused);
  };
// 焦点变化**不经过 App 的 setState**。理由注释里写了：setTerminalFocused
// 会通知订阅者（TerminalFocusProvider 用 useSyncExternalStore 接），
// 只有真正消费焦点的组件重渲染。
//
// 如果在这里 setState，「切到别的应用」会让整个 App 树重渲染一次 ——
// 而 App 是所有东西的祖先，等于全屏重画。切窗口时闪一下就是这个原因。
  handleSuspend = (): void => {
    if (!this.isRawModeSupported()) {
      return;
    }

    // Store the exact raw mode count to restore it properly
    const rawModeCountBeforeSuspend = this.rawModeEnabledCount;

    // Completely disable raw mode before suspending
    while (this.rawModeEnabledCount > 0) {
      this.handleSetRawMode(false);
    }

    // Show cursor, disable focus reporting, and disable mouse tracking
    // before suspending. DISABLE_MOUSE_TRACKING is a no-op if tracking
    // wasn't enabled, so it's safe to emit unconditionally — without
    // it, SGR mouse sequences would appear as garbled text at the
    // shell prompt while suspended.
    if (this.props.stdout.isTTY) {
      this.props.stdout.write(SHOW_CURSOR + DFE + DISABLE_MOUSE_TRACKING);
// 挂起前必须做的事，三件都不是「顺手」：
//
//   SHOW_CURSOR                 挂起后是 shell 在用这个终端，光标得还回去
//   DFE                         关掉 DECSET 1004，否则 shell 里会收到 CSI I/O
//   DISABLE_MOUSE_TRACKING      关掉鼠标追踪，否则 shell 提示符上会出现
//                               SGR 鼠标序列的原始文本（乱码）
//
// 注释里那句「DISABLE_MOUSE_TRACKING 没开过也无害，所以可以无条件发」
// 是这里唯一能偷懒的地方 —— 其余两个必须条件判断（外层有 isTTY 守卫）。
//
// 恢复（SIGCONT）是三件的镜像：重新开 raw mode（按原计数）、
// HIDE_CURSOR（除非无障碍模式）、EFE。注意它**不恢复**鼠标追踪 ——
// 那是全屏组件自己该管的事（AlternateScreen 的 effect 会重跑）。
    }

    // Emit suspend event for Claude Code to handle. Mostly just has a notification
    this.internal_eventEmitter.emit('suspend');

    // Set up resume handler
    const resumeHandler = () => {
      // Restore raw mode to exact previous state
      for (let i = 0; i < rawModeCountBeforeSuspend; i++) {
        if (this.isRawModeSupported()) {
          this.handleSetRawMode(true);
        }
      }

      // Hide cursor (unless in accessibility mode) and re-enable focus reporting after resuming
      if (this.props.stdout.isTTY) {
        if (!isEnvTruthy(process.env.CLAUDE_CODE_ACCESSIBILITY)) {
          this.props.stdout.write(HIDE_CURSOR);
        }
        // Re-enable focus reporting to restore terminal state
        this.props.stdout.write(EFE);
      }

      // Emit resume event for Claude Code to handle
      this.internal_eventEmitter.emit('resume');
      process.removeListener('SIGCONT', resumeHandler);
    };
    process.on('SIGCONT', resumeHandler);
    process.kill(process.pid, 'SIGSTOP');
// 给自己发 SIGSTOP —— 进程在此处真的停住，直到外部 SIGCONT
// （通常是 shell 的 job control：用户执行 fg）。
//
// 所以 resumeHandler 里那句 process.removeListener('SIGCONT', ...)
// 必须在恢复后立刻执行，否则每次挂起都挂一个新监听者，
// 切几次之后一次 SIGCONT 会触发一串恢复逻辑。
  };
}

// Helper to process all keys within a single discrete update context.
// discreteUpdates expects (fn, a, b, c, d) -> fn(a, b, c, d)
function processKeysInBatch(app: App, items: ParsedInput[], _unused1: undefined, _unused2: undefined): void {
  // Update interaction time for notification timeout tracking.
  // This is called from the central input handler to avoid having multiple
  // stdin listeners that can cause race conditions and dropped input.
  // Terminal responses (kind: 'response') are automated, not user input.
  // Mode-1003 no-button motion is also excluded — passive cursor drift is
  // not engagement (would suppress idle notifications + defer housekeeping).
  if (items.some(i => i.kind === 'key' || i.kind === 'mouse' && !((i.button & 0x20) !== 0 && (i.button & 0x03) === 3))) {
    updateLastInteractionTime();
  }
// 【「什么算用户交互」的判据写在这里】
//
//   kind === 'key'                                   算
//   kind === 'mouse' 且不是「无按钮的 mode-1003 漂移」   算
//   kind === 'response'（终端对查询的应答）             不算
//
// 第三条很容易漏：终端应答也是 stdin 数据，如果不排除，启动时的
// XTVERSION / DA1 应答会把「最后交互时间」刷成当前时间，
// 于是空闲通知永远不触发。
//
// 第二条是为了「鼠标划过窗口」不算 engagement —— 光标漂移不该
// 压住空闲检测，也不该推迟后台维护任务。位运算 (button & 0x20)
// 是 SGR 的 motion 标志，(button & 0x03) === 3 是「无按钮」。
  for (const item of items) {
    // Terminal responses (DECRPM, DA1, OSC replies, etc.) are not user
    // input — route them to the querier to resolve pending promises.
    if (item.kind === 'response') {
      app.querier.onResponse(item.response);
      continue;
    }

    // Mouse click/drag events update selection state (fullscreen only).
    // Terminal sends 1-indexed col/row; convert to 0-indexed for the
    // screen buffer. Button bit 0x20 = drag (motion while button held).
    if (item.kind === 'mouse') {
      handleMouseEvent(app, item);
      continue;
    }
    const sequence = item.sequence;

    // Handle terminal focus events (DECSET 1004)
    if (sequence === FOCUS_IN) {
      app.handleTerminalFocus(true);
      const event = new TerminalFocusEvent('terminalfocus');
      app.internal_eventEmitter.emit('terminalfocus', event);
      continue;
    }
// 【FOCUS_IN / FOCUS_OUT 是按「序列」比较的，不是按 name】
//
// 它们是 DECSET 1004 的回执：CSI I（获焦）和 CSI O（失焦）。在
// parse-keypress 眼里这两个就是两个特殊按键，没有专门的 name，
// 所以这里只能比原始序列。
//
// 也就是说它们**不走 Dispatcher**，不走 onKeyDown —— 它们不是 DOM
// 事件，只是「两个特殊按键」。终端窗口的焦点和组件的焦点是两回事，
// 后者才走 FocusEvent。
    if (sequence === FOCUS_OUT) {
      app.handleTerminalFocus(false);
      // Defensive: if we lost the release event (mouse released outside
      // terminal window — some emulators drop it rather than capturing the
      // pointer), focus-out is the next observable signal that the drag is
      // over. Without this, drag-to-scroll's timer runs until the scroll
      // boundary is hit.
      if (app.props.selection.isDragging) {
        finishSelection(app.props.selection);
        app.props.onSelectionChange();
      }
// 【丢失 release 的三种恢复之一：失焦】
//
// 鼠标在终端窗口外松开时，有些终端模拟器不会捕获指针 → SGR 的 'm'
// （release）序列永远不到 → isDragging 卡在 true → 拖选不结束、
// 拖选滚动的定时器一直跑到边界。
//
// 三个恢复点，覆盖三种「用户去哪了」：
//   1. 失焦（这里）—— 切到别的应用了
//   2. 无按钮移动（第 535 行）—— 松在窗口外又回来了
//   3. 新的按下（第 561 行）—— 只支持 mode-1002 的终端，没有无按钮移动
//
// 为什么需要三个而不是一个：注释里写明 tmux 默认**不转发焦点事件**
// （要 focus-events on），所以第 1 个在 tmux 里失效，第 2 个才是主力。
      const event = new TerminalFocusEvent('terminalblur');
      app.internal_eventEmitter.emit('terminalblur', event);
      continue;
    }

    // Failsafe: if we receive input, the terminal must be focused
    if (!getTerminalFocused()) {
      setTerminalFocused(true);
    }
// 乐观纠正：只要收到输入，终端必然有焦点。
//
// 这条兜底的价值在于 DECSET 1004 并不可靠（不支持、或被 tmux 过滤）。
// 没有它的话，用户在一个不支持 1004 的终端里切回来打字，应用还以为
// 自己没焦点 —— 动画停在半速、某些交互被禁用。
//
// 注意是「单向纠正」：只在 false → true 时补，不会反过来把 true 改成
// false（那需要真的收到失焦序列）。

    // Handle Ctrl+Z (suspend) using parsed key to support both raw (\x1a) and
    // CSI u format (\x1b[122;5u) from Kitty keyboard protocol terminals
    if (item.name === 'z' && item.ctrl && SUPPORTS_SUSPEND) {
      app.handleSuspend();
      continue;
    }
// Ctrl+Z 用**解析后的 key** 判断，不是比 sequence ——
// 因为 kitty 协议下 Ctrl+Z 发的是 CSI 122;5u，原始字节里没有 0x1a。
// 同一个动作两种编码，只有解析层统一了才好判断。
//
// 顺带：这条在 processKeysInBatch 里而不是 handleInput 里，注释
// 第 375-377 行解释了原因（handleInput 拿到的已经是剥过 ESC 的 input，
// 信息不够）。
    app.handleInput(sequence);
    const event = new InputEvent(item);
    app.internal_eventEmitter.emit('input', event);

    // Also dispatch through the DOM tree so onKeyDown handlers fire.
    app.props.dispatchKeyboardEvent(item);
  }
}

/** Exported for testing. Mutates app.props.selection and click/hover state. */
export function handleMouseEvent(app: App, m: ParsedMouse): void {
  // Allow disabling click handling while keeping wheel scroll (which goes
  // through the keybinding system as 'wheelup'/'wheeldown', not here).
  if (isMouseClicksDisabled()) return;
  const sel = app.props.selection;
  // Terminal coords are 1-indexed; screen buffer is 0-indexed
  const col = m.col - 1;
  const row = m.row - 1;
  const baseButton = m.button & 0x03;
  if (m.action === 'press') {
    if ((m.button & 0x20) !== 0 && baseButton === 3) {
      // Mode-1003 motion with no button held. Dispatch hover; skip the
      // rest of this handler (no selection, no click-count side effects).
      // Lost-release recovery: no-button motion while isDragging=true means
      // the release happened outside the terminal window (iTerm2 doesn't
      // capture the pointer past window bounds, so the SGR 'm' never
      // arrives). Finish the selection here so copy-on-select fires. The
      // FOCUS_OUT handler covers the "switched apps" case but not "released
      // past the edge, came back" — and tmux drops focus events unless
      // `focus-events on` is set, so this is the more reliable signal.
      if (sel.isDragging) {
        finishSelection(sel);
        app.props.onSelectionChange();
      }
      if (col === app.lastHoverCol && row === app.lastHoverRow) return;
      app.lastHoverCol = col;
      app.lastHoverRow = row;
      app.props.onHoverAt(col, row);
      return;
    }
// 【无按钮的移动：同时是两个身份】
//
//   · hover 派发（onMouseEnter / onMouseLeave）—— 这是它的正常用途，
//     只有 mode-1003 才发这种事件
//   · lost-release 恢复 —— 正在拖选却收到无按钮移动，说明已经松手了
//
// 两种含义共用同一个序列，所以同一个分支里做了两件事。
//
// 还有一个细节：坐标去重（第 539 行）。终端本来就会按格子去重，
// 但「拖到同一格再松开」这类序列会重复发同一个坐标，多派发一次
// hover 就是白跑一遍命中测试。
    if (baseButton !== 0) {
      // Non-left press breaks the multi-click chain.
      app.clickCount = 0;
      return;
    }
    if ((m.button & 0x20) !== 0) {
      // Drag motion: mode-aware extension (char/word/line). onSelectionDrag
      // calls notifySelectionChange internally — no extra onSelectionChange.
      app.props.onSelectionDrag(col, row);
      return;
    }
    // Lost-release fallback for mode-1002-only terminals: a fresh press
    // while isDragging=true means the previous release was dropped (cursor
    // left the window). Finish that selection so copy-on-select fires
    // before startSelection/onMultiClick clobbers it. Mode-1003 terminals
    // hit the no-button-motion recovery above instead, so this is rare.
    if (sel.isDragging) {
      finishSelection(sel);
      app.props.onSelectionChange();
    }
// 第三种恢复：新按下时发现 isDragging 还是 true。
//
// 这一条只对 **mode-1002 终端**有意义（它们不发无按钮移动，所以第 535
// 行那条走不到）。而且必须**先 finish 再 startSelection** ——
// 顺序反了的话，新选区会把旧选区的 anchor 覆盖掉，copy-on-select
// 就永远不会触发（旧的那次选择被静默丢弃）。
//
// 这类「先收尾再开新局」的顺序契约，在 ScrollBox 的 toggleMcpServer
// 里也出现过（先写盘再断连）。
    // Fresh left press. Detect multi-click HERE (not on release) so the
    // word/line highlight appears immediately and a subsequent drag can
    // extend by word/line like native macOS. Previously detected on
    // release, which meant (a) visible latency before the word highlights
    // and (b) double-click+drag fell through to char-mode selection.
    const now = Date.now();
    const nearLast = now - app.lastClickTime < MULTI_CLICK_TIMEOUT_MS && Math.abs(col - app.lastClickCol) <= MULTI_CLICK_DISTANCE && Math.abs(row - app.lastClickRow) <= MULTI_CLICK_DISTANCE;
    app.clickCount = nearLast ? app.clickCount + 1 : 1;
    app.lastClickTime = now;
    app.lastClickCol = col;
    app.lastClickRow = row;
    if (app.clickCount >= 2) {
      // Cancel any pending hyperlink-open from the first click — this is
      // a double-click, not a single-click on a link.
      if (app.pendingHyperlinkTimer) {
        clearTimeout(app.pendingHyperlinkTimer);
        app.pendingHyperlinkTimer = null;
      }
      // Cap at 3 (line select) for quadruple+ clicks.
      const count = app.clickCount === 2 ? 2 : 3;
      app.props.onMultiClick(col, row, count);
      return;
    }
// 【多击检测放在 press，不放在 release】
//
// 两个理由都在注释里，都是体感问题：
//   · 放在 release → 高亮要等松手才出现，用户觉得卡
//   · 放在 release → 「双击后继续拖」会被判成字符模式拖选，
//     而 macOS 的原生行为是按词/按行扩展
//
// 代价是「按下去就选中」，如果用户按下去又反悔（没松开就移开），
// 选中的词已经高亮了。真实交互里这个代价小到可以忽略。
//
// 第 584 行把 count 截到 3：四击以上一律当三击（选整行），
// 不做「四击选中段落」这种更细的层级。
    startSelection(sel, col, row);
    // SGR bit 0x08 = alt (xterm.js wires altKey here, not metaKey — see
    // comment at the hyperlink-open guard below). On macOS xterm.js,
    // receiving alt means macOptionClickForcesSelection is OFF (otherwise
    // xterm.js would have consumed the event for native selection).
    sel.lastPressHadAlt = (m.button & 0x08) !== 0;
// SGR 的 0x08 位在这里被读成 **alt**，不是 meta。
//
// 注释解释了原因：xterm.js（VS Code / Cursor / Windsurf 的终端）
// 把 altKey 接到这个位上 —— 终端的 SGR 编码里根本没有 meta 的表示。
//
// 这个位只在 macOS 的 xterm.js 上有意义（macOptionClickForcesSelection
// 关掉时，带 alt 的点击才会传给我们）。之所以要记它，是为了让
// 「Option+点击」不被当成普通点击去改选区。
    app.props.onSelectionChange();
    return;
  }

  // Release: end the drag even for non-zero button codes. Some terminals
  // encode release with the motion bit or button=3 "no button" (carried
  // over from pre-SGR X10 encoding) — filtering those would orphan
  // isDragging=true and leave drag-to-scroll's timer running until the
  // scroll boundary. Only act on non-left releases when we ARE dragging
  // (so an unrelated middle/right click-release doesn't touch selection).
  if (baseButton !== 0) {
    if (!sel.isDragging) return;
    finishSelection(sel);
    app.props.onSelectionChange();
    return;
  }
// 【release 时不要过滤「非零按钮」】
//
// 直觉写法是「只有左键的 release 才处理」，但真实终端的编码很乱：
// 有些把 release 编码成「带 motion 位」，有些用 button=3（沿用 X10 的
// 「无按钮」约定）。过滤掉这些会导致 isDragging 永远为 true。
//
// 折中方案是这里：非零按钮的 release **只在正在拖选时**才处理
// （`if (!sel.isDragging) return`），这样「中键/右键的按下松开」
// 不会影响选区，而「拖选过程中的任何 release」都能收尾。
  finishSelection(sel);
  // NOTE: unlike the old release-based detection we do NOT reset clickCount
  // on release-after-drag. This aligns with NSEvent.clickCount semantics:
  // an intervening drag doesn't break the click chain. Practical upside:
  // trackpad jitter during an intended double-click (press→wobble→release
  // →press) now correctly resolves to word-select instead of breaking to a
  // fresh single click. The nearLast window (500ms, 1 cell) bounds the
  // effect — a deliberate drag past that just starts a fresh chain.
  // A press+release with no drag in char mode is a click: anchor set,
  // focus null → hasSelection false. In word/line mode the press already
  // set anchor+focus (hasSelection true), so release just keeps the
  // highlight. The anchor check guards against an orphaned release (no
  // prior press — e.g. button was held when mouse tracking was enabled).
// 【release 时**不**重置 clickCount —— 这一点反直觉】
//
// 直觉是「松手就结束一次点击」。注释里给的是 NSEvent 的语义：
// 中间的拖动不打断连击链。实际收益很具体：触控板抖动时
// 「按下→歪一点→松开→再按下」仍然算双击，而不是退化成两次单击。
//
// 兜住这个宽松判据的是 nearLast 窗口（500ms + 1 格，第 571 行）：
// 真拖远了就自然开始新的一链。
//
// 还有一个锚点检查 `!hasSelection(sel) && sel.anchor`：
// 这是「孤立的 release」（没有对应按下，比如鼠标按下时才开始追踪）
// 的防线 —— 没有 anchor 就没有可处理的东西。
  if (!hasSelection(sel) && sel.anchor) {
    // Single click: dispatch DOM click immediately (cursor repositioning
    // etc. are latency-sensitive). If no DOM handler consumed it, defer
    // the hyperlink check so a second click can cancel it.
    if (!app.props.onClickAt(col, row)) {
      // Resolve the hyperlink URL synchronously while the screen buffer
      // still reflects what the user clicked — deferring only the
      // browser-open so double-click can cancel it.
      const url = app.props.getHyperlinkAt(col, row);
      // xterm.js (VS Code, Cursor, Windsurf, etc.) has its own OSC 8 link
      // handler that fires on Cmd+click *without consuming the mouse event*
      // (Linkifier._handleMouseUp calls link.activate() but never
      // preventDefault/stopPropagation). The click is also forwarded to the
      // pty as SGR, so both VS Code's terminalLinkManager AND our handler
      // here would open the URL — twice. We can't filter on Cmd: xterm.js
      // drops metaKey before SGR encoding (ICoreMouseEvent has no meta
      // field; the SGR bit we call 'meta' is wired to alt). Let xterm.js
      // own link-opening; Cmd+click is the native UX there anyway.
      // TERM_PROGRAM is the sync fast-path; isXtermJs() is the XTVERSION
      // probe result (catches SSH + non-VS Code embedders like Hyper).
      if (url && process.env.TERM_PROGRAM !== 'vscode' && !isXtermJs()) {
        // Clear any prior pending timer — clicking a second link
        // supersedes the first (only the latest click opens).
        if (app.pendingHyperlinkTimer) {
          clearTimeout(app.pendingHyperlinkTimer);
        }
        app.pendingHyperlinkTimer = setTimeout((app, url) => {
          app.pendingHyperlinkTimer = null;
          app.props.onOpenHyperlink(url);
        }, MULTI_CLICK_TIMEOUT_MS, app, url);
      }
// 【为什么不能按 Cmd 过滤，只能按「终端是不是 xterm.js」】
//
// xterm.js 的行为（注释第 632-640 行写得很细）：它自己处理 OSC 8 链接，
// 触发时**不消费鼠标事件**（不 preventDefault、不 stopPropagation），
// 事件照样以 SGR 转给 pty。于是 VS Code 的链接管理器和我们这个 handler
// 会**各打开一次浏览器**。
//
// 想按修饰键过滤是不行的：xterm.js 编码 SGR 时把 metaKey 丢了
// （ICoreMouseEvent 里没有这个字段），我们能看到的 0x08 位是 alt。
// 所以判据只能是「这个终端是不是 xterm.js 系」——
// TERM_PROGRAM 是同步快路径，isXtermJs() 是 XTVERSION 探测结果
// （覆盖 SSH 和非 VS Code 的内嵌场景，比如 Hyper）。
//
// 结论是「让 xterm.js 自己负责开链接」。Cmd+点击在那些终端里
// 本来就是原生体验。
    }
  }
  app.props.onSelectionChange();
}
// 原文件此处有一行 67784 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。