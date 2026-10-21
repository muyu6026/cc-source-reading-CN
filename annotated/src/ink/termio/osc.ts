// ═══════════════════════════════════════════════════════════════
//  OSC：唯一「带自由文本负载」的转义序列族
// ═══════════════════════════════════════════════════════════════
//
//   OSC = Operating System Command。`ESC ] 数字 ; 负载 终止符`。
//
//   和 CSI 的根本区别：CSI 的参数是**数字和分隔符**，可以用字节区间
//   切；OSC 的负载是**任意文本**（URL、标题、base64），只能靠终结符
//   界定。所以词法上它必须是一个「一直吃到终结符为止」的状态
//   （tokenize.ts 270 行）。
//
//   【这份文件比看起来杂，因为它混了四件事】
//     1. 序列生成          osc / link / tabStatus
//     2. 多路复用透传      wrapForMultiplexer / tmuxPassthrough
//     3. 剪贴板            setClipboard / copyNative / tmuxLoadBuffer
//     4. 反向解析          parseOSC / parseOscColor
//
//   前三件是「写终端」，第四件是「读终端」。放在一个文件里是因为
//   它们共用同一张 OSC 命令号表（229 行）—— 但这张表其实是
//   出站和入站的并集，见那一行的批注。
/**
 * OSC (Operating System Command) Types and Parser
 */

import { Buffer } from 'buffer'
import { env } from '../../utils/env.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { BEL, ESC, ESC_TYPE, SEP } from './ansi.js'
import type { Action, Color, TabStatusAction } from './types.js'

export const OSC_PREFIX = ESC + String.fromCharCode(ESC_TYPE.OSC)

/** String Terminator (ESC \) - alternative to BEL for terminating OSC */
export const ST = ESC + '\\'

/** Generate an OSC sequence: ESC ] p1;p2;...;pN <terminator>
 * Uses ST terminator for Kitty (avoids beeps), BEL for others */
export function osc(...parts: (string | number)[]): string {
// 【终结符按终端二选一：kitty 用 ST，其余用 BEL】
//
//   BEL（0x07）是传统写法，xterm 系都认。但 kitty 收到 BEL 会**响铃** ——
//   因为它把 OSC 之外的 BEL 一律当警铃，而在某些时序下（比如 OSC 被
//   提前截断）它认不出这是终结符。
//
//   ST（ESC 反斜杠）是标准写法，kitty 推荐。
//
//   这个判断依赖 `env.terminal`，而那是个启动时算一次的环境探测
//   （utils/env.ts 的 detectTerminal，认 TERM 里的 kitty 和
//   TERM=xterm-ghostty）。探测错的话，症状是「每次设标题都叮一声」。
//
//   注意这是**生成侧的判断**：解析侧两种终结符都认（tokenize 270 行），
//   所以入站方向不受影响。
  const terminator = env.terminal === 'kitty' ? ST : BEL
  return `${OSC_PREFIX}${parts.join(SEP)}${terminator}`
}

/**
 * Wrap an escape sequence for terminal multiplexer passthrough.
 * tmux and GNU screen intercept escape sequences; DCS passthrough
 * tunnels them to the outer terminal unmodified.
 *
 * tmux 3.3+ gates this behind `allow-passthrough` (default off). When off,
 * tmux silently drops the whole DCS — no junk, no worse than unwrapped OSC.
 * Users who want passthrough set it in their .tmux.conf; we don't mutate it.
 *
 * Do NOT wrap BEL: raw \x07 triggers tmux's bell-action (window flag);
 * wrapped \x07 is opaque DCS payload and tmux never sees the bell.
 */
// 【tmux 和 screen 会拦截转义序列，所以要再包一层 DCS】
//
//   tmux   ESC P tmux ; <负载> ESC 反斜杠     负载里的 ESC 要**双写**
//   screen ESC P <负载> ESC 反斜杠            不双写、也没有 `tmux;` 前缀
//
//   两者是不同的私有约定，不能混用。这就是为什么有两个分支而不是
//   一个「包 DCS」的通用函数。
//
//   为什么双写：DCS 的负载里出现 ESC 会被 tmux 当成「字符串结束」的信号，
//   所以要把每个 ESC 变成两个，tmux 解出来是原样一个。
//   **转义嵌套的通用规则：内层出现的转义字符必须在传输层再转义一次。**
//   下面 154 行会看到这个规则如何反过来影响了「内层用哪个终结符」。
export function wrapForMultiplexer(sequence: string): string {
// 【tmux 3.3 之后要用户手动开 allow-passthrough，默认是关的】
//
//   关掉的时候 tmux 会**静默丢掉整个 DCS** —— 注意这是良性降级：
//   丢掉的效果和不包 DCS 一样（序列同样到不了外层终端），
//   不会留下垃圾字符。
//
//   注释里那句「we don't mutate it」值得注意：不改用户的 tmux 配置。
//   这是「工具不该偷偷改环境」这条原则的具体体现，代价是功能
//   在默认配置下不生效。
//
//   对比一下别的项目常见的做法（自动 `tmux set -g allow-passthrough on`）：
//   那种做法会让功能「开箱可用」，但会在用户不知情的情况下改变
//   一个全局安全相关的设置（透传意味着任何程序都能往终端注入序列）。
//   这里选了保守的一侧。
  if (process.env['TMUX']) {
    const escaped = sequence.replaceAll('\x1b', '\x1b\x1b')
    return `\x1bPtmux;${escaped}\x1b\\`
  }
// GNU screen 的约定更老：ESC P <原样负载> ESC 反斜杠，没有 `tmux;` 前缀，
//   也不双写 ESC。
//
//   靠 STY 环境变量识别（screen 特有，值是 `<pid>.<tty>`）。
//   这个变量在 tmux 里也可能存在（tmux 从 screen 派生），所以
//   必须先判 TMUX —— 顺序不能换。
  if (process.env['STY']) {
    return `\x1bP${sequence}\x1b\\`
  }
  return sequence
}

/**
 * Which path setClipboard() will take, based on env state. Synchronous so
 * callers can show an honest toast without awaiting the copy itself.
 *
 * - 'native': pbcopy (or equivalent) will run — high-confidence system
 *   clipboard write. tmux buffer may also be loaded as a bonus.
 * - 'tmux-buffer': tmux load-buffer will run, but no native tool — paste
 *   with prefix+] works. System clipboard depends on tmux's set-clipboard
 *   option + outer terminal OSC 52 support; can't know from here.
 * - 'osc52': only the raw OSC 52 sequence will be written to stdout.
 *   Best-effort; iTerm2 disables OSC 52 by default.
 *
 * pbcopy gating uses SSH_CONNECTION specifically, not SSH_TTY — tmux panes
 * inherit SSH_TTY forever even after local reattach, but SSH_CONNECTION is
 * in tmux's default update-environment set and gets cleared.
 */
// 【三态返回值的用途：让调用方**同步地**说出真相】
//
//   native       本机剪贴板工具会跑（pbcopy 等），高置信
//   tmux-buffer  只会进 tmux 缓冲区，系统剪贴板取决于 set-clipboard 选项
//   osc52        只写 OSC 52，尽力而为（iTerm2 默认禁用 OSC 52）
//
//   为什么必须同步：调用方要在**开始复制之前**弹 toast。如果等
//   setClipboard 的 Promise 回来再显示，用户已经切走了 ——
//   而这个函数的全部意义就是「告诉用户复制成没成」。
//
//   于是它只做环境变量判断，不做任何 I/O。**「同步的预测」和
//   「异步的事实」分开两个函数**，这是让 UI 诚实的最省事做法。
export type ClipboardPath = 'native' | 'tmux-buffer' | 'osc52'

// 【这个函数的口径和 copyNative 不一致 —— 在 Linux/Windows 上会低报】
//
//   nativeAvailable 只认 `platform === 'darwin' && !SSH_CONNECTION`。
//   但 171 行的 copyNative 对 linux（wl-copy / xclip / xsel）和
//   win32（clip.exe）都有实现，而且 setClipboard 会照常调用它。
//
//   所以在 Linux 上：真实动作是「本机工具 + OSC 52 双保险」，
//   而这个函数会返回 'osc52' —— toast 上写「尽力而为」，
//   实际很可能已经成功了。
//
//   这是「保守报喜」还是「保守报忧」的选择题：这里选了**宁可低估**。
//   对用户来说，「可能失败」比「一定成功但其实失败」安全 ——
//   因为前者会让他再按一次 Cmd+C，后者会让他去粘贴然后拿到旧内容。
//
//   也和本机工具的能力差异有关：pbcopy 是系统自带的，wl-copy/xclip
//   在 Linux 上不一定装了。darwin 能确定，Linux 不能预判。
export function getClipboardPath(): ClipboardPath {
  const nativeAvailable =
    process.platform === 'darwin' && !process.env['SSH_CONNECTION']
  if (nativeAvailable) return 'native'
  if (process.env['TMUX']) return 'tmux-buffer'
  return 'osc52'
}

/**
 * Wrap a payload in tmux's DCS passthrough: ESC P tmux ; <payload> ESC \
 * tmux forwards the payload to the outer terminal, bypassing its own parser.
 * Inner ESCs must be doubled. Requires `set -g allow-passthrough on` in
 * ~/.tmux.conf; without it, tmux silently drops the whole DCS (no regression).
 */
// 【和 35 行的 wrapForMultiplexer 是同一件事，但这里只处理 tmux】
//
//   重复的理由：wrapForMultiplexer 还要处理 screen，而剪贴板这条路
//   只在 tmux 下用（screen 根本没有 load-buffer 这个命令）。
//   写个专用版能少一次环境判断、少一个分支。
//
//   代价是「双写 ESC」这条规则现在有两份实现。改格式时两处都得改 ——
//   而这种「通用版 + 专用版」的重复，在本仓库里通常意味着
//   「通用版其实只有一个真消费者，专用版是第二次用到时才分出来的」。
//
//   注意双写只作用于 payload，末尾那个 ST 是拼接时追加的，不参与替换。
//   如果反过来先把 ST 拼进去再双写，收尾的 ESC 会变成两个 ——
//   tmux 会把它解成一个 ESC，然后继续等反斜杠，序列就永远不结束。
function tmuxPassthrough(payload: string): string {
  return `${ESC}Ptmux;${payload.replaceAll(ESC, ESC + ESC)}${ST}`
}

/**
 * Load text into tmux's paste buffer via `tmux load-buffer`.
 * -w (tmux 3.2+) propagates to the outer terminal's clipboard via tmux's
 * own OSC 52 emission. -w is dropped for iTerm2: tmux's OSC 52 emission
 * crashes the iTerm2 session over SSH.
 *
 * Returns true if the buffer was loaded successfully.
 */
// tmux load-buffer：把文本塞进 tmux 的粘贴缓冲区。
//
//   为什么优先走这条路（而不是直接发 OSC 52）：
//     · tmux 缓冲区在 SSH 下也能用（不依赖外层终端的能力）
//     · 断线重连后还在
//     · 不受「终端是否支持 OSC 52」影响
//
//   然后 `-w`（tmux 3.2+）让它**顺便**往外层终端也发一次 OSC 52。
//   老版本 tmux 会忽略 -w，缓冲区照样装着。
//
//   只用 2000ms 超时：这是个「顺手做的事」，卡住整个复制流程不值得。
export async function tmuxLoadBuffer(text: string): Promise<boolean> {
  if (!process.env['TMUX']) return false
// 【参数数组是「整条拼出来」而不是条件式 append，是可读性上的选择】
//
//   `['load-buffer', '-w', '-']` 里的 `-` 表示「缓冲区内容从 stdin 读」，
//   而 stdin 由第三个参数 `{ input: text }` 提供。两个 `-` 的含义
//   完全不同：`-w` 是个开关，裸 `-` 是个占位符。
//
//   至于 iTerm2 那个分支：这是「依赖方某个变体有 bug，就绕过它自己实现」
//   的模式 —— 放弃 -w（少一次向外层终端推送），改用 156 行的
//   DCS 透传 + 自己拼的 OSC 52（带显式 `c`，不走 tmux 那个有问题的
//   空参数形式）。
//
//   代价是要维护一份「本来就是 tmux 职责」的实现。收益是功能在
//   iTerm2 上可用而不是整个禁掉。**这类绕行的代码必须紧贴一段
//   解释，否则半年后会被当成冗余删掉。**
  const args =
    process.env['LC_TERMINAL'] === 'iTerm2'
      ? ['load-buffer', '-']
      : ['load-buffer', '-w', '-']
  const { code } = await execFileNoThrow('tmux', args, {
    input: text,
    useCwd: false,
    timeout: 2000,
  })
  return code === 0
}

/**
 * OSC 52 clipboard write: ESC ] 52 ; c ; <base64> BEL/ST
 * 'c' selects the clipboard (vs 'p' for primary selection on X11).
 *
 * When inside tmux ($TMUX set), `tmux load-buffer -w -` is the primary
 * path. tmux's buffer is always reachable — works over SSH, survives
 * detach/reattach, immune to stale env vars. The -w flag (tmux 3.2+) tells
 * tmux to also propagate to the outer terminal via its own OSC 52 path,
 * which tmux wraps correctly for the attached client. On older tmux, -w is
 * ignored and the buffer is still loaded. -w is dropped for iTerm2 (#22432)
 * because tmux's own OSC 52 emission (empty selection param: ESC]52;;b64)
 * crashes iTerm2 over SSH.
 *
 * After load-buffer succeeds, we ALSO return a DCS-passthrough-wrapped
 * OSC 52 for the caller to write to stdout. Our sequence uses explicit `c`
 * (not tmux's crashy empty-param variant), so it sidesteps the #22432 path.
 * With `allow-passthrough on` + an OSC-52-capable outer terminal, selection
 * reaches the system clipboard; with either off, tmux silently drops the
 * DCS and prefix+] still works. See Greg Smith's "free pony" in
 * https://anthropic.slack.com/archives/C07VBSHV7EV/p1773177228548119.
 *
 * If load-buffer fails entirely, fall through to raw OSC 52.
 *
 * Outside tmux, write raw OSC 52 to stdout (caller handles the write).
 *
 * Local (no SSH_CONNECTION): also shell out to a native clipboard utility.
 * OSC 52 and tmux -w both depend on terminal settings — iTerm2 disables
 * OSC 52 by default, VS Code shows a permission prompt on first use. Native
 * utilities (pbcopy/wl-copy/xclip/xsel/clip.exe) always work locally. Over
 * SSH these would write to the remote clipboard — OSC 52 is the right path there.
 *
 * Returns the sequence for the caller to write to stdout (raw OSC 52
 * outside tmux, DCS-wrapped inside).
 */
// 【这个函数的返回值是「给调用方去写 stdout 的序列」，它自己不写】
//
//   这个分工很重要：函数决定「该发什么」，调用方决定「往哪写、什么时候写」。
//   因为写 stdout 的时机必须和帧渲染对齐（否则序列会插到半帧中间）。
//
//   函数内部做了三件事：算 base64、**先**调本机工具、**再**等 tmux。
//   顺序见下一段。
export async function setClipboard(text: string): Promise<string> {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  const raw = osc(OSC.CLIPBOARD, 'c', b64)

  // Native safety net — fire FIRST, before the tmux await, so a quick
  // focus-switch after selecting doesn't race pbcopy. Previously this ran
  // AFTER awaiting tmux load-buffer, adding ~50-100ms of subprocess latency
  // before pbcopy even started — fast cmd+tab → paste would beat it
  // (https://anthropic.slack.com/archives/C07VBSHV7EV/p1773943921788829).
  // Gated on SSH_CONNECTION (not SSH_TTY) since tmux panes inherit SSH_TTY
  // forever but SSH_CONNECTION is in tmux's default update-environment and
  // clears on local attach. Fire-and-forget.
// 【这一行的位置是本文件最讲究的一处：native 必须在 await 之前】
//
//   历史：原来先 await tmuxLoadBuffer（50-100ms 的子进程），再跑 pbcopy。
//   结果是用户选中文字后立刻 Cmd+Tab 切走再粘贴，pbcopy 还没跑完 ——
//   粘出来是上一份内容。
//
//   现在改成先 fire-and-forget 本机工具，再 await tmux。总耗时没变，
//   但**用户感知的关键路径**从「等 tmux」变成「等 pbcopy 启动」。
//
//   这类优化的特征是：不减少任何工作量，只调整**顺序**。判断依据是
//   「哪个动作决定了用户能不能立刻用」。
//
//   注释里的 Slack 链接（p1773943921788829）说明这是线上问题倒推出来的，
//   不是先验设计。
  if (!process.env['SSH_CONNECTION']) copyNative(text)

  const tmuxBufferLoaded = await tmuxLoadBuffer(text)

  // Inner OSC uses BEL directly (not osc()) — ST's ESC would need doubling
  // too, and BEL works everywhere for OSC 52.
// 【内层 OSC 用 BEL 而不是 ST —— 因为 ST 的 ESC 会被透传层再转义一次】
//
//   如果内层也终止于 ST（ESC 反斜杠），那么 78 行的 tmuxPassthrough
//   会把那个 ESC 双写成两个 ESC。tmux 解出来是一个，正确；
//   但如果透传层实现有偏差（或者层级超过一层，比如 tmux 里再套 screen），
//   双写次数就会算错。
//
//   选 BEL 彻底绕开这个问题：**内层序列里不含 ESC，就不存在嵌套转义**。
//   代价是放弃「kitty 响铃」那个优化 —— 但对 OCS 52 而言 BEL 到处都认
//   （168 行的注释说了这点）。
//
//   通用规律：设计嵌套协议时，**优先选一种「不需要转义的编码」**，
//   而不是把转义规则写对。前者是结构性的，后者是纪律性的。
  if (tmuxBufferLoaded) return tmuxPassthrough(`${ESC}]52;c;${b64}${BEL}`)
  return raw
}

// Linux clipboard tool: undefined = not yet probed, null = none available.
// Probe order: wl-copy (Wayland) → xclip (X11) → xsel (X11 fallback).
// Cached after first attempt so repeated mouse-ups skip the probe chain.
// 【三态缓存：undefined = 还没探过，null = 探过全都没有】
//
//   这个约定和 termio/types.ts 的 TabStatusAction、styles.ts 的
//   `'x' in style` 是同一套思路 —— 只是这里用的是「值的三态」而不是
//   「键的存在性」。
//
//   为什么不只用 null：null 表示「确定没有」，需要每次重试吗？不需要，
//   所以缓存下来。而 undefined 表示「还不知道」，值得试一次。
//   混用的话，要么每次鼠标抬起都跑三条失败的命令（慢），
//   要么第一次没装上就永远不试了（错）。
let linuxCopy: 'wl-copy' | 'xclip' | 'xsel' | null | undefined

/**
 * Shell out to a native clipboard utility as a safety net for OSC 52.
 * Only called when not in an SSH session (over SSH, these would write to
 * the remote machine's clipboard — OSC 52 is the right path there).
 * Fire-and-forget: failures are silent since OSC 52 may have succeeded.
 */
function copyNative(text: string): void {
  const opts = { input: text, useCwd: false, timeout: 2000 }
  switch (process.platform) {
    case 'darwin':
      void execFileNoThrow('pbcopy', [], opts)
      return
    case 'linux': {
      if (linuxCopy === null) return
      if (linuxCopy === 'wl-copy') {
        void execFileNoThrow('wl-copy', [], opts)
        return
      }
      if (linuxCopy === 'xclip') {
        void execFileNoThrow('xclip', ['-selection', 'clipboard'], opts)
        return
      }
      if (linuxCopy === 'xsel') {
        void execFileNoThrow('xsel', ['--clipboard', '--input'], opts)
        return
      }
      // First call: probe wl-copy (Wayland) then xclip/xsel (X11), cache winner.
// 【探测链直接复用「真正要做的复制」，不单独跑 which】
//
//   每一条候选命令都是拿**真实文本**跑的：成功就既探明了、也复制完了。
//   如果先 `which wl-copy` 再执行，就会多一次子进程，而且
//   「which 找到但执行失败」的情况还得处理。
//
//   代价：失败的那几次探测会白跑一遍（把文本喂给不存在的命令）。
//   可以接受，因为失败路径只在第一次鼠标抬起时走一次。
//
//   嵌套 then 而不是 async/await：因为外层是 `void` 的 fire-and-forget，
//   写成 await 需要一个 async IIFE，反而更绕。**回调地狱在这里是
//   有理由的选择** —— 三层，每层只做一件事，且都不需要返回值。
      void execFileNoThrow('wl-copy', [], opts).then(r => {
        if (r.code === 0) {
          linuxCopy = 'wl-copy'
          return
        }
        void execFileNoThrow('xclip', ['-selection', 'clipboard'], opts).then(
          r2 => {
            if (r2.code === 0) {
              linuxCopy = 'xclip'
              return
            }
            void execFileNoThrow('xsel', ['--clipboard', '--input'], opts).then(
              r3 => {
                linuxCopy = r3.code === 0 ? 'xsel' : null
              },
            )
          },
        )
      })
      return
    }
    case 'win32':
      // clip.exe is always available on Windows. Unicode handling is
      // imperfect (system locale encoding) but good enough for a fallback.
      void execFileNoThrow('clip', [], opts)
      return
  }
}

/** @internal test-only */
// 测试专用出口：把探测结果重置回 undefined，让下个用例重新走探测链。
//
//   命令式前缀下划线是明确的「不许业务代码调」信号。但 TypeScript
//   拦不住（只是个名字），所以它导出到了包外 —— 如果哪天有人在
//   正式代码里调它，缓存会在运行期被清掉，症状是「偶尔慢一次」。
export function _resetLinuxCopyCache(): void {
  linuxCopy = undefined
}

/**
 * OSC command numbers
 */
// 【这张表是出站和入站的并集，但只有五个真的会被解析】
//
//   被 parseOSC 认的：0（标题+图标）、1（图标）、2（标题）、8（超链接）、
//                        21337（页签状态）
//   只用于生成、不解析的：4 / 10 / 11 / 12 / 52 / 99 / 104 / 110-112 /
//                        7 / 9 / 133 / 777
//
//   所以「这个文件支持 OSC」这句话要分方向理解：**写远多于读**。
//
//   这也是为什么 4 / 52 / 99 这些数字躺着没人解析也没人删 ——
//   它们在其他文件里被引用（useTerminalNotification 用 9 和 777，
//   ink.tsx 用 52 / 9;4）。
//
//   注意 21337 这个号：它不是标准的 OSC 号，是某个终端厂家的私有扩展
//   （页签状态）。放在这里意味着这个程序在被特定终端渲染时会显示
//   标签页级别的状态点。
export const OSC = {
  SET_TITLE_AND_ICON: 0,
  SET_ICON: 1,
  SET_TITLE: 2,
  SET_COLOR: 4,
  SET_CWD: 7,
  HYPERLINK: 8,
  ITERM2: 9, // iTerm2 proprietary sequences
  SET_FG_COLOR: 10,
  SET_BG_COLOR: 11,
  SET_CURSOR_COLOR: 12,
  CLIPBOARD: 52,
  KITTY: 99, // Kitty notification protocol
  RESET_COLOR: 104,
  RESET_FG_COLOR: 110,
  RESET_BG_COLOR: 111,
  RESET_CURSOR_COLOR: 112,
  SEMANTIC_PROMPT: 133,
  GHOSTTY: 777, // Ghostty notification protocol
  TAB_STATUS: 21337, // Tab status extension
} as const

/**
 * Parse an OSC sequence into an action
 *
 * @param content - The sequence content (without ESC ] and terminator)
 */
// 【parseOSC 的入参是「已经剥掉 ESC ] 和终结符」的内容】
//
//   剥的工作在 parser.ts 353-361 行。所以这里拿到的是
//   `0;标题文字` 或 `8;;https://...` 这样的裸负载。
//
//   分隔方式是「第一个分号之前是命令号，之后全是负载」—— 只切一刀。
//   这对 OSC 8 很重要：URL 里可能有分号，所以 278 行用
//   `parts.slice(1).join(';')` 把分号拼回去。
//
//   如果反过来按「所有分号」切，任何带分号的 URL 都会被截断。
export function parseOSC(content: string): Action | null {
  const semicolonIdx = content.indexOf(';')
  const command = semicolonIdx >= 0 ? content.slice(0, semicolonIdx) : content
  const data = semicolonIdx >= 0 ? content.slice(semicolonIdx + 1) : ''

// parseInt 对非数字命令返回 NaN，然后所有 `=== OSC.XXX` 都不匹配，
//   落到 309 行的 unknown。这是「NaN 天然不相等」带来的免费兜底 ——
//   不需要显式校验命令号是不是数字。
//
//   同类技巧在 sgr.ts 里也出现过（`parseInt` 失败 → NaN → 全部分支不匹配）。
//   它的代价是 NaN 会一路传下去，如果某个分支用 `>=` 比较就会静默为假。
  const commandNum = parseInt(command, 10)

  // Window/icon title
  if (commandNum === OSC.SET_TITLE_AND_ICON) {
    return { type: 'title', action: { type: 'both', title: data } }
  }
  if (commandNum === OSC.SET_ICON) {
    return { type: 'title', action: { type: 'iconName', name: data } }
  }
  if (commandNum === OSC.SET_TITLE) {
    return { type: 'title', action: { type: 'windowTitle', title: data } }
  }

  // Hyperlinks (OSC 8)
// OSC 8 超链接。
//
//   格式：`8 ; 参数 ; URI`。参数是 `key=value:key=value` 形式（可空）。
//
//   两个容易搞错的点：
//     1. 参数区可以为空 —— `8;;url` 是合法的（两个连续分号）
//     2. URL 里可能有分号，所以 278 行是 join 而不是取 parts[1]
//
//   参数解析用 `:` 切、再看有没有 `=`。含 `:` 的值会被切坏 ——
//   规范里没规定值可以含冒号，所以按规范写就行。
  if (commandNum === OSC.HYPERLINK) {
    const parts = data.split(';')
    const paramsStr = parts[0] ?? ''
    const url = parts.slice(1).join(';')

// 【空 URL = 关闭链接，这是 OSC 8 规范里唯一的「结束」表示】
//
//   没有独立的「结束序列」号，靠的是「URI 为空」。所以解析器必须
//   在拿到空 URI 时产出 end 动作，而不是 start 一个空链接。
//
//   如果这里漏判，会得到一个 `url: ''` 的 start —— 下游 Ansi.tsx
//   会把 `currentHyperlink` 设成空串，然后 `if (currentHyperlink)` 为假，
//   看起来「没影响」。**bug 被空字符串的假值性质藏起来了。**
    if (url === '') {
      return { type: 'link', action: { type: 'end' } }
    }

    const params: Record<string, string> = {}
    if (paramsStr) {
      for (const pair of paramsStr.split(':')) {
        const eqIdx = pair.indexOf('=')
        if (eqIdx >= 0) {
          params[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
        }
      }
    }

    return {
      type: 'link',
      action: {
        type: 'start',
        url,
        params: Object.keys(params).length > 0 ? params : undefined,
      },
    }
  }

  // Tab status (OSC 21337)
// OSC 21337：页签状态。这是个非标准扩展，只解析不生成（生成在 476 行）。
//
//   三态设计在 types.ts 194 行有完整说明：字段不存在 / null / 有值。
//   **注意是「字段是否存在」决定语义，不是字段的值** —— 所以
//   parseTabStatus 只在遇到某个 key 时才设置对应字段，遇到未知 key 完全不设。
  if (commandNum === OSC.TAB_STATUS) {
    return { type: 'tabStatus', action: parseTabStatus(data) }
  }

  return { type: 'unknown', sequence: `\x1b]${content}` }
}

/**
 * Parse an XParseColor-style color spec into an RGB Color.
 * Accepts `#RRGGBB` and `rgb:R/G/B` (1–4 hex digits per component, scaled
 * to 8-bit). Returns null on parse failure.
 */
// 【上面注释列了两种格式，但实际接受的比它写的更窄】
//
//   `#FF0000`      ✓  六位，正则写死 `{2}` 三次
//   `#F00`         ✗  三位简写在 CSS 里合法，这里不认（会返回 null）
//   `rgb:ff/00/00` ✓  1-4 位都行
//
//   三位简写收不进来的理由不是「不想支持」，是这个函数只服务
//   OSC 21337（页签状态），而那个协议的发送方就是按六位发的。
//   **按实际来源定支持范围，而不是按「常见的颜色写法」。**
//
//   返回 null 时会发生什么，值得追一遍调用链（349 行）：
//     `action.indicator = value === '' ? null : parseOscColor(value)`
//   → 拼错的颜色得到 **null**，而 null 的语义是「清空这个字段」。
//   于是 `indicator=#GGG` 的净效果是**把页签指示灯擦掉**，
//   而不是「不动」。键存在、值是 null —— 正好落在 tristate 里
//   「显式清空」那一格上。
//
//   这是「用 null 表示两种失败」的典型后果：解析失败和「就是想清空」
//   撞在同一个值上。要分开就得让 parseOscColor 返回
//   「失败」和「没有值」两种不同的东西。
export function parseOscColor(spec: string): Color | null {
  const hex = spec.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (hex) {
    return {
      type: 'rgb',
      r: parseInt(hex[1]!, 16),
      g: parseInt(hex[2]!, 16),
      b: parseInt(hex[3]!, 16),
    }
  }
  const rgb = spec.match(
// 【XParseColor 的缩放规则：N 位十六进制 → 值 / (16^N - 1)】
//
//   `f`      1 位 → 15/15 = 1.0    → 255
//   `ff`     2 位 → 255/255 = 1.0  → 255
//   `fff`    3 位 → 4095/4095      → 255
//   `8000`   4 位 → 32768/65535 ≈ 0.5 → 128
//
//   所以分母随位数变，不是固定的 255。写死 `parseInt / 255` 的话，
//   4 位形式会溢出（值可达 65535，除以 255 得 257，超范围）。
//
//   这个规则来自 X11 的 XParseColor，不是 Web 的颜色语法 ——
//   终端世界里的颜色格式基本都是 X11 那套的遗产。
    /^rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})$/i,
  )
  if (rgb) {
    // XParseColor: N hex digits → value / (16^N - 1), scale to 0-255
    const scale = (s: string) =>
      Math.round((parseInt(s, 16) / (16 ** s.length - 1)) * 255)
    return {
      type: 'rgb',
      r: scale(rgb[1]!),
      g: scale(rgb[2]!),
      b: scale(rgb[3]!),
    }
  }
  return null
}

/**
 * Parse OSC 21337 payload: `key=value;key=value;...` with `\;` and `\\`
 * escapes inside values. Bare key or `key=` clears that field; unknown
 * keys are ignored.
 */
// 【「未知 key 被忽略」这一条，实际意味着拼错了永远发现不了】
//
//   上面那段英文注释说 unknown keys are ignored。换个角度说：
//   把 `status-color` 写成 `statusColor`（这是 JS 里的字段名），
//   解析器会安静地丢掉它 —— 没有告警、没有默认值、也不影响其他字段。
//   症状是「设了没效果」，而代码看起来完全正确。
//
//   注意这里**只处理三个 key**，所以「忽略未知」实际上等于
//   「只支持这三个」。规范之外的东西全都不存在。
//
//   顺带一个不对称：`status` 的空值是 null（清空），有值直接用字符串；
//   而 `indicator` / `status-color` 有值时要过 parseOscColor。
//   三者共用一个 splitter，但值的解释各不相同。
function parseTabStatus(data: string): TabStatusAction {
  const action: TabStatusAction = {}
  for (const [key, value] of splitTabStatusPairs(data)) {
    switch (key) {
      case 'indicator':
        action.indicator = value === '' ? null : parseOscColor(value)
        break
      case 'status':
        action.status = value === '' ? null : value
        break
      case 'status-color':
        action.statusColor = value === '' ? null : parseOscColor(value)
        break
    }
  }
  return action
}

/** Split `k=v;k=v` honoring `\;` and `\\` escapes. Yields [key, unescapedValue]. */
// 【手写一个「认识反斜杠转义」的分割器，而不是用正则 split】
//
//   要处理的是 `k=v;k=v` 里的两种转义：`\;`（字面分号）和 `\\`（字面反斜杠）。
//   这两个在状态文字里都会出现（比如 `compiling; 3/7`）。
//
//   用 `split(';')` 切会把转义的分号也切掉，所以必须写状态机。
//   三个标志位：esc（上一个字符是反斜杠）、inVal（过了等号）、
//   key/val 两个缓冲。
//
//   实现上有一处宽松：转义对**任意字符**生效，不只是 `;` 和 `\`。
//   所以 `status=foo\nbar` 会得到 `foonbar`（反斜杠消失）。
//   规范只要求那两个，所以这个宽松不会误伤 —— 但也没人依赖它。
function* splitTabStatusPairs(data: string): Generator<[string, string]> {
  let key = ''
  let val = ''
  let inVal = false
  let esc = false
  for (const c of data) {
    if (esc) {
      if (inVal) val += c
      else key += c
      esc = false
    } else if (c === '\\') {
      esc = true
    } else if (c === ';') {
      yield [key, val]
      key = ''
      val = ''
      inVal = false
    } else if (c === '=' && !inVal) {
      inVal = true
    } else if (inVal) {
      val += c
    } else {
      key += c
    }
  }
  if (key || inVal) yield [key, val]
}

// Output generators

/** Start a hyperlink (OSC 8). Auto-assigns an id= param derived from the URL
 *  so terminals group wrapped lines of the same link together (the spec says
 *  cells with matching URI *and* nonempty id are joined; without an id each
 *  wrapped line is a separate link — inconsistent hover, partial tooltips).
 *  Empty url = close sequence (empty params per spec). */
// 【上面那段英文注释讲的是「为什么要有 id」，这里补三件它没说的】
//
//   ① `{ id: osc8Id(url), ...params }` 的展开顺序 = 调用方可以覆盖 id。
//      逃生口是「同一个 URL 想显示成两条独立链接」，但传 `{ id: '' }`
//      会正好踩中反面（空 id → 每行独立 → 正是要避免的那个 bug）。
//      这类「覆盖点本身也是错误点」的接口，在配置合并里很常见
//      （mcp/config.ts 的六来源优先级是同一个形状）。
//
//   ② id 是**按 URL 算的**，不是按调用算的。所以同一个 URL 在屏幕上
//      出现两次（比如两份表格里的同一个文档链接），会被终端归成
//      一条链接 —— 鼠标悬停时高亮的范围会跨过中间所有内容。
//      要拆开只能显式传不同的 id。
//
//   ③ `link('')` 走 404 行的早退，返回 LINK_END。所以调用方不需要
//      「有 url 才发开始序列」的判断 —— 空串自动变成关闭。
export function link(url: string, params?: Record<string, string>): string {
  if (!url) return LINK_END
  const p = { id: osc8Id(url), ...params }
  const paramStr = Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(':')
  return osc(OSC.HYPERLINK, paramStr, url)
}

// 【32 位哈希，Java String.hashCode 的变形】
//
//   `h = ((h << 5) - h + c) | 0` 就是 `h * 31 + c`（32 减 1 = 31），
//   最后 `| 0` 截成有符号 32 位，再 `>>> 0` 转无符号，最后 base36。
//
//   碰撞可能吗？可能，32 位空间里几条链接不太会碰，但一定会碰。
//   碰撞的后果：两个不同 URL 得到同一个 id。而终端判「同一链接」还要
//   求 URI 也相同，所以碰撞**没有可见影响**。
//
//   这是「哈希碰撞在这里无所谓」的正确用例 —— 因为 id 只用于分组，
//   不用于识别。如果拿它当唯一标识去查表，就必须处理碰撞了。
function osc8Id(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++)
    h = ((h << 5) - h + url.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** End a hyperlink (OSC 8) */
// 【关闭序列是 `OSC 8 ; ; ST` —— 空参数、空 URI】
//
//   osc() 的 join(';') 把 ['8','',''] 拼成 `8;;`，再拼前缀和终结符。
//   所以这一行同时依赖 osc() 的「用分号连接」和「空串也占一位」两个行为。
//
//   注意它用的是 osc()（按终端选 BEL 或 ST），而 156 行那个内层
//   OSC 52 是手写 BEL。两者不一致是**故意的**：LINK_END 走正常输出路径，
//   而内层 OSC 52 要穿过 tmux 透传，不能含 ESC。
export const LINK_END = osc(OSC.HYPERLINK, '', '')

// iTerm2 OSC 9 subcommands

/** iTerm2 OSC 9 subcommand numbers */
export const ITERM2 = {
  NOTIFY: 0,
  BADGE: 2,
  PROGRESS: 4,
} as const

/** Progress operation codes (for use with ITERM2.PROGRESS) */
export const PROGRESS = {
  CLEAR: 0,
  SET: 1,
  ERROR: 2,
  INDETERMINATE: 3,
} as const

/**
 * Clear iTerm2 progress bar sequence (OSC 9;4;0;BEL)
 * Uses BEL terminator since this is for cleanup (not runtime notification)
 * and we want to ensure it's always sent regardless of terminal type.
 */
// 【清理序列硬编码 BEL，不用 osc()】
//
//   理由和 156 行那个内层 OSC 52 不同，但同源：**清理必须在任何终端上
//   都生效**。用 ST 的话，万一终端不认 ST（老版本 webterm、某些
//   Java 写的终端），这段清理就静默失效 —— 而它偏偏是「退出时
//   擦掉进度条」这种「你不做用户就会看到一个残留的进度条」的事。
//
//   BEL 是所有终端都认的 OSC 终结符（从 VT100 开始就是）。
//
//   同一条规则在 ink.tsx 的退出清理里出现多次：**幂等且必须生效的
//   清理动作，宁可选最保守的写法**。前面 csi.ts 的 EXIT_ALT_SCREEN
//   也是一样（无条件发，不管检测到什么终端）。
export const CLEAR_ITERM2_PROGRESS = `${OSC_PREFIX}${OSC.ITERM2};${ITERM2.PROGRESS};${PROGRESS.CLEAR};${BEL}`

/**
 * Clear terminal title sequence (OSC 0 with empty string + BEL).
 * Uses BEL terminator for cleanup — safe on all terminals.
 */
// 清标题：`OSC 0 ; <空> BEL`。
//
//   注意这里是 OSC 0（同时设标题和图标），不是 OSC 2（只设标题）。
//   清的时候要两个都清 —— 因为设置时也可能用的是 0。
export const CLEAR_TERMINAL_TITLE = `${OSC_PREFIX}${OSC.SET_TITLE_AND_ICON};${BEL}`

/** Clear all three OSC 21337 tab-status fields. Used on exit. */
export const CLEAR_TAB_STATUS = osc(
  OSC.TAB_STATUS,
  'indicator=;status=;status-color=',
)

/**
 * Gate for emitting OSC 21337 (tab-status indicator). Ant-only while the
 * spec is unstable. Terminals that don't recognize it discard silently, so
 * emission is safe unconditionally — we don't gate on terminal detection
 * since support is expected across several terminals.
 *
 * Callers must wrap output with wrapForMultiplexer() so tmux/screen
 * DCS-passthrough carries the sequence to the outer terminal.
 */
// 【一个只返回常量的函数，用途是让打包器做死代码消除】
//
//   `process.env.USER_TYPE === 'ant'` — `ant` 是 Anthropic 内部的
//   终端类型标识。这个表达式在外部构建里被替换成 false，于是
//   所有 `if (supportsTabStatus())` 的调用点连同 import 一起被摇掉。
//
//   所以「函数」而不是「常量」的形式是必要的：常量在模块加载时求值，
//   而打包器需要的是一个可以被内联的**调用表达式**。
//
//   同一套手法在 cli.tsx 的 DCE 里出现过（`feature()` 调用 +
//   `process.env.USER_TYPE` 内联）。这是本仓库最一致的一个模式：
//   **用环境变量做功能开关，靠构建期常量折叠而不是运行期判断。**
//
//   副作用：这个函数在外部版里恒为 false，所以 21337 这条 OSC
//   永远不会被发出去 —— 也就是说上面 305 行的解析器在外部版里
//   收不到自己发的东西。这不矛盾（解析器处理的是外部文本），
//   但读的时候容易误以为它是个闭环。
export function supportsTabStatus(): boolean {
  return process.env.USER_TYPE === 'ant'
}

/**
 * Emit an OSC 21337 tab-status sequence. Omitted fields are left unchanged
 * by the receiving terminal; `null` sends an empty value to clear.
 * `;` and `\` in status text are escaped per the spec.
 */
// 【`'indicator' in fields` —— 又是「键存在性」判据】
//
//   和 styles.ts 的 `'x' in style`、types.ts 的 tristate 是同一个模式：
//   **空值不能表达「不动」，必须用「键在不在」区分。**
//
//   这里三种字段各自的空值形态不同：
//     indicator    Color | null  → null 时发空串（清空）
//     status       string | null → null 时发空串，且要转义 `\` 和 `;`
//     statusColor  同 indicator
//
//   转义顺序不能反：先 `\` → `\\`，再 `;` → `\;`。反过来的话，
//   第一步产生的反斜杠会被第二步再转义一次，变成四个。
//   **多重转义永远是最内层（最先生成）的先转。**
export function tabStatus(fields: TabStatusAction): string {
  const parts: string[] = []
  const rgb = (c: Color) =>
    c.type === 'rgb'
      ? `#${[c.r, c.g, c.b].map(n => n.toString(16).padStart(2, '0')).join('')}`
      : ''
  if ('indicator' in fields)
    parts.push(`indicator=${fields.indicator ? rgb(fields.indicator) : ''}`)
  if ('status' in fields)
    parts.push(
      `status=${fields.status?.replaceAll('\\', '\\\\').replaceAll(';', '\\;') ?? ''}`,
    )
  if ('statusColor' in fields)
    parts.push(
      `status-color=${fields.statusColor ? rgb(fields.statusColor) : ''}`,
    )
  return osc(OSC.TAB_STATUS, parts.join(';'))
}
