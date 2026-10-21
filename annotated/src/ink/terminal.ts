// ═══════════════════════════════════════════════════════════════
//  terminal：这个终端**能做什么**，以及最后那一下 `write`
// ═══════════════════════════════════════════════════════════════
//
//  上半部分全是能力探测，下半部分（第 190 行起）是 `writeDiffToTerminal` ——
//  整条渲染链的最后一站：Diff 变字节，一次 write 交给 stdout。
//
//  探测这件事在这份文件里表现出三种截然不同的态度，值得对照着看：
//
//  1. **白名单**（`isSynchronizedOutputSupported`）—— 列举已知支持的终端，
//     拿不准就返回 false。保守。
//  2. **黑名单 + 例外**（`isProgressReportingAvailable`）—— 先假设支持，
//     但专门排除 Windows Terminal。因为它的**语义不同**（把进度当通知）。
//  3. **问了才知道**（XTVERSION 探测）—— 环境变量在 SSH 下不可靠，
//     于是直接问终端，靠 pty 把答复带回来。
//
//  三种态度的分界线是**错的代价**：探错「支持同步输出」的代价是一帧闪光，
//  探错「支持进度上报」的代价是弹一条通知，探错「扩展按键」的代价是
//  用户的按键被吃 —— 所以最后那一条用的是最保守的白名单，而且注释里
//  明写了「我们曾经无条件开启，踩坑了」。
import { coerce } from 'semver'
import type { Writable } from 'stream'
import { env } from '../utils/env.js'
import { gte } from '../utils/semver.js'
import { getClearTerminalSequence } from './clearTerminal.js'
import type { Diff } from './frame.js'
import { cursorMove, cursorTo, eraseLines } from './termio/csi.js'
import { BSU, ESU, HIDE_CURSOR, SHOW_CURSOR } from './termio/dec.js'
import { link } from './termio/osc.js'

export type Progress = {
  state: 'running' | 'completed' | 'error' | 'indeterminate'
  percentage?: number
}

/**
 * Checks if the terminal supports OSC 9;4 progress reporting.
 * Supported terminals:
 * - ConEmu (Windows) - all versions
 * - Ghostty 1.2.0+
 * - iTerm2 3.6.6+
 *
 * Note: Windows Terminal interprets OSC 9;4 as notifications, not progress.
 */
// 三个前置条件依次收窄：TTY（管道输出没意义）→ 排除 Windows Terminal
// （语义不同）→ ConEmu 全版本都行 → 其余靠 TERM_PROGRAM + 版本号。
//
// 注意 `WT_SESSION` 的排除**排在 ConEmu 判断之前**：Windows Terminal 里
// 也可能有 ConEmu 的残留环境变量（比如从 Cmder 里启动 WT），先排除 WT
// 才能避免走错分支。
export function isProgressReportingAvailable(): boolean {
  // Only available if we have a TTY (not piped)
  if (!process.stdout.isTTY) {
    return false
  }

  // Explicitly exclude Windows Terminal, which interprets OSC 9;4 as
  // notifications rather than progress indicators
  if (process.env.WT_SESSION) {
    return false
  }

  // ConEmu supports OSC 9;4 for progress (all versions)
  if (
    process.env.ConEmuANSI ||
    process.env.ConEmuPID ||
    process.env.ConEmuTask
  ) {
    return true
  }

// `semver.coerce` 而不是 `semver.parse`：终端报的版本号五花八门
// （`3.6.6`、`3.6.6beta1`、`v3.6.6 (build 123)`），coerce 会尽力抠出
// 前三段数字，parse 严格要求格式。
//
// `coerce` 返回 null 时直接 false —— 这同时覆盖了「TERM_PROGRAM_VERSION
// 根本没设」和「设了但不像版本号」两种情况。
  const version = coerce(process.env.TERM_PROGRAM_VERSION)
  if (!version) {
    return false
  }

  // Ghostty 1.2.0+ supports OSC 9;4 for progress
  // https://ghostty.org/docs/install/release-notes/1-2-0
  if (process.env.TERM_PROGRAM === 'ghostty') {
    return gte(version.version, '1.2.0')
  }

  // iTerm2 3.6.6+ supports OSC 9;4 for progress
  // https://iterm2.com/downloads.html
  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return gte(version.version, '3.6.6')
  }

  return false
}

/**
 * Checks if the terminal supports DEC mode 2026 (synchronized output).
 * When supported, BSU/ESU sequences prevent visible flicker during redraws.
 */
// 这份文件里最反直觉的一条：**tmux 排除在同步输出之外**。
//
// 理由是「中间层会破坏语义」：tmux 会把外层终端的每个字节都解析一遍，
// 然后把 BSU/ESU 转发给外层终端 —— 听起来没问题，但 tmux 是**按块**
// 转发输出的（它自己攒缓冲），于是「开始同步」和「结束同步」之间
// 插进了 tmux 自己的刷新时机。原子性已经在 tmux 那一层断掉了，
// 再发这两个序列只是白费 16 个字节加解析开销。
//
// 这条规则可推广：**判断「上游支持某能力」时，要问的是「整条路径上
// 每个中间层是否都不破坏它」**，而不是「最终端支持吗」。
export function isSynchronizedOutputSupported(): boolean {
  // tmux parses and proxies every byte but doesn't implement DEC 2026.
  // BSU/ESU pass through to the outer terminal but tmux has already
  // broken atomicity by chunking. Skip to save 16 bytes/frame + parser work.
  if (process.env.TMUX) return false

  const termProgram = process.env.TERM_PROGRAM
  const term = process.env.TERM

  // Modern terminals with known DEC 2026 support
  if (
    termProgram === 'iTerm.app' ||
    termProgram === 'WezTerm' ||
    termProgram === 'WarpTerminal' ||
    termProgram === 'ghostty' ||
    termProgram === 'contour' ||
    termProgram === 'vscode' ||
    termProgram === 'alacritty'
  ) {
    return true
  }

  // kitty sets TERM=xterm-kitty or KITTY_WINDOW_ID
  if (term?.includes('kitty') || process.env.KITTY_WINDOW_ID) return true

  // Ghostty may set TERM=xterm-ghostty without TERM_PROGRAM
  if (term === 'xterm-ghostty') return true

  // foot sets TERM=foot or TERM=foot-extra
  if (term?.startsWith('foot')) return true

  // Alacritty may set TERM containing 'alacritty'
  if (term?.includes('alacritty')) return true

  // Zed uses the alacritty_terminal crate which supports DEC 2026
  if (process.env.ZED_TERM) return true

  // Windows Terminal
  if (process.env.WT_SESSION) return true

  // VTE-based terminals (GNOME Terminal, Tilix, etc.) since VTE 0.68
// VTE 的版本号是四位数编码：`6800` 表示 0.68.0（前两位主版本、
// 后两位次版本）。所以判断是 `>= 6800` 而不是 `>= 68`。
//
// 这种「版本号压成整数」的编码在终端世界里很常见（DEC 的固件版本也这样），
// 见到四位数版本号先怀疑是这种编码，别当成「版本 6800」。
  const vteVersion = process.env.VTE_VERSION
  if (vteVersion) {
    const version = parseInt(vteVersion, 10)
    if (version >= 6800) return true
  }

  return false
}

// 这整段注释讲的是**环境变量的根本局限**：它描述的是「进程看到的终端」，
// 而不是「人在看的终端」。
//
// SSH 下 TERM_PROGRAM 默认不透传，于是远端进程看到的是 `xterm-256color`
// 之类的兜底值，完全分不清对面是 VS Code、iTerm2 还是 tmux。
// XTVERSION 走的是**数据流**（CSI 查询写进 pty → 终端答复走 stdin），
// 中间层不拦就穿得过去。
//
// 代价是异步：查询发出去了，答复什么时候回来不知道。所以这里的设计是
// 「模块级变量 + undefined 表示还不知道」，读者必须能接受三态：
// 知道是 / 知道不是 / 还不知道。
// -- XTVERSION-detected terminal name (populated async at startup) --
//
// TERM_PROGRAM is not forwarded over SSH by default, so env-based detection
// fails when claude runs remotely inside a VS Code integrated terminal.
// XTVERSION (CSI > 0 q → DCS > | name ST) goes through the pty — the query
// reaches the *client* terminal and the reply comes back through stdin.
// App.tsx fires the query when raw mode enables; setXtversionName() is called
// from the response handler. Readers should treat undefined as "not yet known"
// and fall back to env-var detection.

let xtversionName: string | undefined

/** Record the XTVERSION response. Called once from App.tsx when the reply
 *  arrives on stdin. No-op if already set (defend against re-probe). */
// `if (xtversionName === undefined)` —— 只认第一次答复。
//
// 这不是「防御性编程」而是必需：XTVERSION 可能在 raw mode 每次开启时
// 重发（切出再切回终端），如果每次覆盖，一个会乱答的中间层就能把
// 已经确定的结论改坏。
export function setXtversionName(name: string): void {
  if (xtversionName === undefined) xtversionName = name
}

/** True if running in an xterm.js-based terminal (VS Code, Cursor, Windsurf
 *  integrated terminals). Combines TERM_PROGRAM env check (fast, sync, but
 *  not forwarded over SSH) with the XTVERSION probe result (async, survives
 *  SSH — query/reply goes through the pty). Early calls may miss the probe
 *  reply — call lazily (e.g. in an event handler) if SSH detection matters. */
// 两条来源合一：环境变量（快、同步、穿不过 SSH）+ 探测结果（慢、
// 异步、穿得过 SSH）。
//
// `?? false` 让 undefined 落到 false —— 也就是**探测没回来时按「不是
// xterm.js」处理**。这个默认值是有代价的：xterm.js 需要额外的滚轮补偿，
// 判错了滚轮就会多滚/少滚。所以注释里说「SSH 场景要紧的话就懒调」。
//
// 调用点确实都是懒的：`PromptInputFooterLeftSide.tsx:420`（渲染时）、
// `ScrollKeybindingHandler.tsx`（按键时）—— 都在探测回来之后才可能发生。
export function isXtermJs(): boolean {
  if (process.env.TERM_PROGRAM === 'vscode') return true
  return xtversionName?.startsWith('xterm.js') ?? false
}

// 这段注释记录的是一次**真实的事故**，信息量比代码本身大：
//
//   曾经无条件发 `CSI >1u`（开 Kitty 键盘协议），假设「不认识的终端
//   会静默忽略未知 CSI」。结果有些终端**认真执行了**，然后开始发出
//   这个解析器处理不了的码点 —— 用户按键变成乱码或丢失。
//
//   「未知序列会被忽略」是 VT 世界的惯例，但不是保证。而且失败方式是
//   最难查的那种：不报错、不崩溃，只是输入不对。
//
//   tmux 在名单里是个例外，理由跟同步输出正好相反：tmux **接受**
//   modifyOtherKeys 但**不转发** Kitty 序列给外层 —— 于是它成了
//   一个「安全的降级终点」。
// Terminals known to correctly implement the Kitty keyboard protocol
// (CSI >1u) and/or xterm modifyOtherKeys (CSI >4;2m) for ctrl+shift+<letter>
// disambiguation. We previously enabled unconditionally (#23350), assuming
// terminals silently ignore unknown CSI — but some terminals honor the enable
// and emit codepoints our input parser doesn't handle (notably over SSH and
// in xterm.js-based terminals like VS Code). tmux is allowlisted because it
// accepts modifyOtherKeys and doesn't forward the kitty sequence to the outer
// terminal.
const EXTENDED_KEYS_TERMINALS = [
  'iTerm.app',
  'kitty',
  'WezTerm',
  'ghostty',
  'tmux',
  'windows-terminal',
]

/** True if this terminal correctly handles extended key reporting
 *  (Kitty keyboard protocol + xterm modifyOtherKeys). */
export function supportsExtendedKeys(): boolean {
  return EXTENDED_KEYS_TERMINALS.includes(env.terminal ?? '')
}

/** True if the terminal scrolls the viewport when it receives cursor-up
 *  sequences that reach above the visible area. On Windows, conhost's
 *  SetConsoleCursorPosition follows the cursor into scrollback
 *  (microsoft/terminal#14774), yanking users to the top of their buffer
 *  mid-stream. WT_SESSION catches WSL-in-Windows-Terminal where platform
 *  is linux but output still routes through conhost. */
// 这是 Windows 独有的一个 bug：conhost 的 `SetConsoleCursorPosition`
// 遇到「移动到可视区上方」时，会把**整个视口**跟着滚上去（进 scrollback），
// 而不是把光标钳在顶行。
//
// 后果是流式输出时用户会被猛地拽到缓冲区顶部。所以调用方宁可关掉
// 流式文本（`REPL.tsx:1463`：`!reducedMotion && !hasCursorUpViewportYankBug()`）——
// 一个光标 bug 足以让一个功能整体降级。
//
// `WT_SESSION` 也要算进来：WSL 里 `process.platform` 是 linux，
// 但输出仍然经过 conhost。
export function hasCursorUpViewportYankBug(): boolean {
  return process.platform === 'win32' || !!process.env.WT_SESSION
}

// Computed once at module load — terminal capabilities don't change mid-session.
// Exported so callers can pass a sync-skip hint gated to specific modes.
// 模块加载时算一次，导出成常量。终端能力在会话中途不会变
// （除了 SSH 断线重连，那种情况本来就要重启进程）。
//
// 导出的目的是让调用方能把它当**同步的跳过提示**用：
// `ink.tsx:736` 的 `this.altScreenActive && !SYNC_OUTPUT_SUPPORTED`
// 就是「alt-screen 高频刷新 + 不支持」→ 跳过 BSU/ESU。
export const SYNC_OUTPUT_SUPPORTED = isSynchronizedOutputSupported()

export type Terminal = {
  stdout: Writable
  stderr: Writable
}

// 终点站。三个要点：
//
//  **一次 write**。所有 patch 拼成一个字符串才写 —— 不是性能优化，
//  是**正确性**：多次 write 会给中间层（tmux、ConPTY、SSH 缓冲）
//  插入刷新时机的机会，屏幕可能撕成两半。一次 write 才是一次原子提交。
//
//  **BSU/ESU 包住整串**。这是 DEC 2026 同步输出的用法：终端收到 BSU
//  后停止刷新画面、继续接收字节，收到 ESU 才一次性呈现。所以包裹范围
//  必须是「整帧」而不是「每个 patch」。
//
//  **`skipSyncMarkers` 的默认值是 false**，也就是默认包。调用方负责
//  在「不支持」或「不值得」时传 true（见 `ink.tsx:736`）。
export function writeDiffToTerminal(
  terminal: Terminal,
  diff: Diff,
  skipSyncMarkers = false,
): void {
  // No output if there are no patches
  if (diff.length === 0) {
    return
  }

  // BSU/ESU wrapping is opt-out to keep main-screen behavior unchanged.
  // Callers pass skipSyncMarkers=true when the terminal doesn't support
  // DEC 2026 (e.g. tmux) AND the cost matters (high-frequency alt-screen).
// 注意这里**没有**判断 `SYNC_OUTPUT_SUPPORTED` —— 只看调用方传的
// `skipSyncMarkers`。这是刻意的职责划分：能力判断在调用方（它知道
// 当前是不是 alt-screen、是不是高频路径），这里只负责「要不要包」。
//
// 代价是：任何忘了传 true 的调用方，都会在不支持的终端上白发 16 字节。
// 无害，但会让人误以为「支持」了。
  const useSync = !skipSyncMarkers

  // Buffer all writes into a single string to avoid multiple write calls
  let buffer = useSync ? BSU : ''

  for (const patch of diff) {
    switch (patch.type) {
      case 'stdout':
        buffer += patch.content
        break
      case 'clear':
        if (patch.count > 0) {
          buffer += eraseLines(patch.count)
        }
        break
      case 'clearTerminal':
        buffer += getClearTerminalSequence()
        break
      case 'cursorHide':
        buffer += HIDE_CURSOR
        break
      case 'cursorShow':
        buffer += SHOW_CURSOR
        break
      case 'cursorMove':
        buffer += cursorMove(patch.x, patch.y)
        break
      case 'cursorTo':
        buffer += cursorTo(patch.col)
        break
      case 'carriageReturn':
// `carriageReturn` 单独一个 patch 类型就为了这一个字节。理由在
// frame.ts 里提过：`CSI 1 G`（4 字节）和 CR（1 字节）效果相同，
// 而「回行首」在每一行的输出里都要出现一次 —— 一帧十几行就是
// 几十字节的差别，在高频路径上值得为它开一个 patch 类型。
        buffer += '\r'
        break
      case 'hyperlink':
        buffer += link(patch.uri)
        break
      case 'styleStr':
        buffer += patch.str
        break
    }
  }

  // Add synchronized update end and flush buffer
// 收尾：补 ESU 再一次 write。注意 BSU 是拼进 buffer 里的、ESU 是
// 拼在末尾 —— 看起来像一次 write 其实还是同一次（都在 buffer 里）。
//
// 唯一没被包住的是空 diff 的早退（第 196 行）：没有 patch 就连
// BSU/ESU 都不发。这是对的 —— 一次「什么都没变」的同步开始/结束
// 反而会让某些终端闪一下。
  if (useSync) buffer += ESU
  terminal.stdout.write(buffer)
}
