/**
 * Terminal Launcher
 *
 * Detects the user's preferred terminal emulator and launches Claude Code
 * inside it. Used by the deep link protocol handler when invoked by the OS
 * (i.e., not already running inside a terminal).
 *
 * Platform support:
 *   macOS  — Terminal.app, iTerm2, Ghostty, Kitty, Alacritty, WezTerm
 *   Linux  — $TERMINAL, x-terminal-emulator, gnome-terminal, konsole, etc.
 *   Windows — Windows Terminal (wt.exe), PowerShell, cmd.exe
 */
// 本模块负责在用户通过操作系统深链协议唤起 Claude Code、但当前并不在终端内运行时，检测其偏好的终端模拟器并启动 Claude Code。支持 macOS、Linux、Windows 多款终端。

import { spawn } from 'child_process'
import { basename } from 'path'
import { getGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { which } from '../which.js'

export type TerminalInfo = {
  name: string
  command: string
}
// 终端信息类型：包含显示名与启动命令两部分。

// macOS terminals in preference order.
// Each entry: [display name, app bundle name or CLI command, detection method]
const MACOS_TERMINALS: Array<{
  name: string
  bundleId: string
  app: string
}> = [
  { name: 'iTerm2', bundleId: 'com.googlecode.iterm2', app: 'iTerm' },
  { name: 'Ghostty', bundleId: 'com.mitchellh.ghostty', app: 'Ghostty' },
  { name: 'Kitty', bundleId: 'net.kovidgoyal.kitty', app: 'kitty' },
  { name: 'Alacritty', bundleId: 'org.alacritty', app: 'Alacritty' },
  { name: 'WezTerm', bundleId: 'com.github.wez.wezterm', app: 'WezTerm' },
  {
    name: 'Terminal.app',
    bundleId: 'com.apple.Terminal',
    app: 'Terminal',
  },
]
// macOS 终端按偏好排序的清单；每项含显示名、应用包标识与可执行名，检测时优先看运行中的进程，其次查已安装的应用包。

// Linux terminals in preference order (command name)
const LINUX_TERMINALS = [
  'ghostty',
  'kitty',
  'alacritty',
  'wezterm',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'mate-terminal',
  'tilix',
  'xterm',
]
// Linux 终端按偏好排序的命令名清单，检测时逐个用 which 查找是否存在。

/**
 * Detect the user's preferred terminal on macOS.
 * Checks running processes first (most likely to be what the user prefers),
 * then falls back to checking installed .app bundles.
 */
// 检测 macOS 上用户偏好的终端。先读全局配置里记录的偏好，再查 TERM_PROGRAM 环境变量，最后逐个用 mdfind 与直接检查 /Applications 来确认已安装的终端；兜底使用系统自带的 Terminal.app。
async function detectMacosTerminal(): Promise<TerminalInfo> {
  // Stored preference from a previous interactive session. This is the only
  // signal that survives into the headless LaunchServices context — the env
  // var check below never hits when we're launched from a browser link.
  const stored = getGlobalConfig().deepLinkTerminal
  if (stored) {
    const match = MACOS_TERMINALS.find(t => t.app === stored)
    if (match) {
      return { name: match.name, command: match.app }
    }
  }

  // Check the TERM_PROGRAM env var — if set, the user has a clear preference.
  // TERM_PROGRAM may include a .app suffix (e.g., "iTerm.app"), so strip it.
  const termProgram = process.env.TERM_PROGRAM
  if (termProgram) {
    const normalized = termProgram.replace(/\.app$/i, '').toLowerCase()
    const match = MACOS_TERMINALS.find(
      t =>
        t.app.toLowerCase() === normalized ||
        t.name.toLowerCase() === normalized,
    )
    if (match) {
      return { name: match.name, command: match.app }
    }
  }

  // Check which terminals are installed by looking for .app bundles.
  // Try mdfind first (Spotlight), but fall back to checking /Applications
  // directly since mdfind can return empty results if Spotlight is disabled
  // or hasn't indexed the app yet.
  for (const terminal of MACOS_TERMINALS) {
    const { code, stdout } = await execFileNoThrow(
      'mdfind',
      [`kMDItemCFBundleIdentifier == "${terminal.bundleId}"`],
      { timeout: 5000, useCwd: false },
    )
    if (code === 0 && stdout.trim().length > 0) {
      return { name: terminal.name, command: terminal.app }
    }
  }

  // Fallback: check /Applications directly (mdfind may not work if
  // Spotlight indexing is disabled or incomplete)
  for (const terminal of MACOS_TERMINALS) {
    const { code: lsCode } = await execFileNoThrow(
      'ls',
      [`/Applications/${terminal.app}.app`],
      { timeout: 1000, useCwd: false },
    )
    if (lsCode === 0) {
      return { name: terminal.name, command: terminal.app }
    }
  }

  // Terminal.app is always available on macOS
  return { name: 'Terminal.app', command: 'Terminal' }
}
// 函数收尾：以上都未命中时返回系统自带的 Terminal.app。

/**
 * Detect the user's preferred terminal on Linux.
 * Checks $TERMINAL, then x-terminal-emulator, then walks a priority list.
 */
// 检测 Linux 上用户偏好的终端。依次检查 $TERMINAL、x-terminal-emulator，再按优先级清单逐个用 which 查找，未找到返回 null。
async function detectLinuxTerminal(): Promise<TerminalInfo | null> {
  // Check $TERMINAL env var
  const termEnv = process.env.TERMINAL
  if (termEnv) {
    const resolved = await which(termEnv)
    if (resolved) {
      return { name: basename(termEnv), command: resolved }
    }
  }

  // Check x-terminal-emulator (Debian/Ubuntu alternative)
  const xte = await which('x-terminal-emulator')
  if (xte) {
    return { name: 'x-terminal-emulator', command: xte }
  }

  // Walk the priority list
  for (const terminal of LINUX_TERMINALS) {
    const resolved = await which(terminal)
    if (resolved) {
      return { name: terminal, command: resolved }
    }
  }

  return null
}
// 函数收尾：所有候选都未命中时返回 null。

/**
 * Detect the user's preferred terminal on Windows.
 */
// 检测 Windows 上用户偏好的终端。依次尝试 Windows Terminal、PowerShell 7+、内置 Windows PowerShell 5.1，兜底使用 cmd.exe。
async function detectWindowsTerminal(): Promise<TerminalInfo> {
  // Check for Windows Terminal first
  const wt = await which('wt.exe')
  if (wt) {
    return { name: 'Windows Terminal', command: wt }
  }

  // PowerShell 7+ (separate install)
  const pwsh = await which('pwsh.exe')
  if (pwsh) {
    return { name: 'PowerShell', command: pwsh }
  }

  // Windows PowerShell 5.1 (built into Windows)
  const powershell = await which('powershell.exe')
  if (powershell) {
    return { name: 'PowerShell', command: powershell }
  }

  // cmd.exe is always available
  return { name: 'Command Prompt', command: 'cmd.exe' }
}
// 函数收尾：cmd.exe 始终可用，作为最终兜底。

/**
 * Detect the user's preferred terminal emulator.
 */
// 统一的终端检测入口：按当前平台分发到对应的检测函数，未知平台返回 null。
export async function detectTerminal(): Promise<TerminalInfo | null> {
  switch (process.platform) {
    case 'darwin':
      return detectMacosTerminal()
    case 'linux':
      return detectLinuxTerminal()
    case 'win32':
      return detectWindowsTerminal()
    default:
      return null
  }
}

// 函数收尾：平台不匹配任何已知分支时返回 null。
/**
 * Launch Claude Code in the detected terminal emulator.
 *
 * Pure argv paths (no shell, user input never touches an interpreter):
 *   macOS — Ghostty, Alacritty, Kitty, WezTerm (via open -na --args)
 *   Linux — all ten in LINUX_TERMINALS
 *   Windows — Windows Terminal
 *
 * Shell-string paths (user input is shell-quoted and relied upon):
 *   macOS — iTerm2, Terminal.app (AppleScript `write text` / `do script`
 *           are inherently shell-interpreted; no argv interface exists)
 *   Windows — PowerShell -Command, cmd.exe /k (no argv exec mode)
 *
 * For pure-argv paths: claudePath, --prefill, query, cwd travel as distinct
 * argv elements end-to-end. No sh -c. No shellQuote(). The terminal does
 * chdir(cwd) and execvp(claude, argv). Spaces/quotes/metacharacters in
 * query or cwd are preserved by argv boundaries with zero interpretation.
 */
// 在检测到的终端里启动 Claude Code。先把深链参数组装成 argv，再按平台分发给对应的启动函数；若检测不到终端则记录错误并返回 false。
export async function launchInTerminal(
  claudePath: string,
  action: {
    query?: string
    cwd?: string
    repo?: string
    lastFetchMs?: number
  },
): Promise<boolean> {
  const terminal = await detectTerminal()
  if (!terminal) {
    logForDebugging('No terminal emulator detected', { level: 'error' })
    return false
  }

  logForDebugging(
    `Launching in terminal: ${terminal.name} (${terminal.command})`,
  )
  const claudeArgs = ['--deep-link-origin']
  if (action.repo) {
    claudeArgs.push('--deep-link-repo', action.repo)
    if (action.lastFetchMs !== undefined) {
      claudeArgs.push('--deep-link-last-fetch', String(action.lastFetchMs))
    }
  }
  if (action.query) {
    claudeArgs.push('--prefill', action.query)
  }

  switch (process.platform) {
    case 'darwin':
      return launchMacosTerminal(terminal, claudePath, claudeArgs, action.cwd)
    case 'linux':
      return launchLinuxTerminal(terminal, claudePath, claudeArgs, action.cwd)
    case 'win32':
      return launchWindowsTerminal(terminal, claudePath, claudeArgs, action.cwd)
    default:
      return false
  }
}
// 函数收尾：无匹配平台时返回 false。

// macOS 启动逻辑。iTerm2 与 Terminal.app 通过 AppleScript 注入命令（必须做 shell 转义），其余终端用 open -na 走纯 argv 方式启动，用户内容不经过 shell 解释。
async function launchMacosTerminal(
  terminal: TerminalInfo,
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): Promise<boolean> {
  switch (terminal.command) {
    // --- SHELL-STRING PATHS (AppleScript has no argv interface) ---
    // User input is shell-quoted via shellQuote(). These two are the only
    // macOS paths where shellQuote() correctness is load-bearing.

    case 'iTerm': {
      const shCmd = buildShellCommand(claudePath, claudeArgs, cwd)
      // If iTerm isn't running, `tell application` launches it and iTerm's
      // default startup behavior opens a window — so `create window` would
      // make a second one. Check `running` first: if already running (even
      // with zero windows), create a window; if not, `activate` lets iTerm's
      // startup create the first window.
      const script = `tell application "iTerm"
  if running then
    create window with default profile
  else
    activate
  end if
  tell current session of current window
    write text ${appleScriptQuote(shCmd)}
  end tell
end tell`
      const { code } = await execFileNoThrow('osascript', ['-e', script], {
        useCwd: false,
      })
      if (code === 0) return true
      break
    }

    case 'Terminal': {
      const shCmd = buildShellCommand(claudePath, claudeArgs, cwd)
      const script = `tell application "Terminal"
  do script ${appleScriptQuote(shCmd)}
  activate
end tell`
      const { code } = await execFileNoThrow('osascript', ['-e', script], {
        useCwd: false,
      })
      return code === 0
    }

    // --- PURE ARGV PATHS (no shell, no shellQuote) ---
    // open -na <App> --args <argv> → app receives argv verbatim →
    // terminal's native --working-directory + -e exec the command directly.

    case 'Ghostty': {
      const args = [
        '-na',
        terminal.command,
        '--args',
        '--window-save-state=never',
      ]
      if (cwd) args.push(`--working-directory=${cwd}`)
      args.push('-e', claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }

    case 'Alacritty': {
      const args = ['-na', terminal.command, '--args']
      if (cwd) args.push('--working-directory', cwd)
      args.push('-e', claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }

    case 'kitty': {
      const args = ['-na', terminal.command, '--args']
      if (cwd) args.push('--directory', cwd)
      args.push(claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }

    case 'WezTerm': {
      const args = ['-na', terminal.command, '--args', 'start']
      if (cwd) args.push('--cwd', cwd)
      args.push('--', claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }
  }

  logForDebugging(
    `Failed to launch ${terminal.name}, falling back to Terminal.app`,
  )
  return launchMacosTerminal(
    { name: 'Terminal.app', command: 'Terminal' },
    claudePath,
    claudeArgs,
    cwd,
  )
}
// 函数收尾：主路径失败则回退到 Terminal.app 再试一次。

// Linux 启动逻辑。所有终端都走纯 argv 方式，按各自支持的参数拼接工作目录与命令，最后用 spawnDetached 以分离进程启动。
async function launchLinuxTerminal(
  terminal: TerminalInfo,
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): Promise<boolean> {
  // All Linux paths are pure argv. Each terminal's --working-directory
  // (or equivalent) sets cwd natively; the command is exec'd directly.
  // For the few terminals without a cwd flag (xterm, and the opaque
  // x-terminal-emulator / $TERMINAL), spawn({cwd}) sets the terminal
  // process's cwd — most inherit it for the child.

  let args: string[]
  let spawnCwd: string | undefined

  switch (terminal.name) {
    case 'gnome-terminal':
      args = cwd ? [`--working-directory=${cwd}`, '--'] : ['--']
      args.push(claudePath, ...claudeArgs)
      break
    case 'konsole':
      args = cwd ? ['--workdir', cwd, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    case 'kitty':
      args = cwd ? ['--directory', cwd] : []
      args.push(claudePath, ...claudeArgs)
      break
    case 'wezterm':
      args = cwd ? ['start', '--cwd', cwd, '--'] : ['start', '--']
      args.push(claudePath, ...claudeArgs)
      break
    case 'alacritty':
      args = cwd ? ['--working-directory', cwd, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    case 'ghostty':
      args = cwd ? [`--working-directory=${cwd}`, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    case 'xfce4-terminal':
    case 'mate-terminal':
      args = cwd ? [`--working-directory=${cwd}`, '-x'] : ['-x']
      args.push(claudePath, ...claudeArgs)
      break
    case 'tilix':
      args = cwd ? [`--working-directory=${cwd}`, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    default:
      // xterm, x-terminal-emulator, $TERMINAL — no reliable cwd flag.
      // spawn({cwd}) sets the terminal's own cwd; most inherit.
      args = ['-e', claudePath, ...claudeArgs]
      spawnCwd = cwd
      break
  }

  return spawnDetached(terminal.command, args, { cwd: spawnCwd })
}
// 函数收尾：对没有原生工作目录参数的终端（如 xterm），用 spawn 的 cwd 选项设置子进程目录。

// Windows 启动逻辑。Windows Terminal 走纯 argv；PowerShell 与 cmd.exe 需要命令字符串（按各自规则转义），其中 cmd.exe 要绕过 libuv 的 MSVCRT 风格参数解析。
async function launchWindowsTerminal(
  terminal: TerminalInfo,
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): Promise<boolean> {
  const args: string[] = []

  switch (terminal.name) {
    // --- PURE ARGV PATH ---
    case 'Windows Terminal':
      if (cwd) args.push('-d', cwd)
      args.push('--', claudePath, ...claudeArgs)
      break

    // --- SHELL-STRING PATHS ---
    // PowerShell -Command and cmd /k take a command string. No argv exec
    // mode that also keeps the session interactive after claude exits.
    // User input is escaped per-shell; correctness of that escaping is
    // load-bearing here.

    case 'PowerShell': {
      // Single-quoted PowerShell strings have NO escape sequences (only
      // '' for a literal quote). Double-quoted strings interpret backtick
      // escapes — a query containing `" could break out.
      const cdCmd = cwd ? `Set-Location ${psQuote(cwd)}; ` : ''
      args.push(
        '-NoExit',
        '-Command',
        `${cdCmd}& ${psQuote(claudePath)} ${claudeArgs.map(psQuote).join(' ')}`,
      )
      break
    }

    default: {
      const cdCmd = cwd ? `cd /d ${cmdQuote(cwd)} && ` : ''
      args.push(
        '/k',
        `${cdCmd}${cmdQuote(claudePath)} ${claudeArgs.map(a => cmdQuote(a)).join(' ')}`,
      )
      break
    }
  }

  // cmd.exe does NOT use MSVCRT-style argument parsing. libuv's default
  // quoting for spawn() on Windows assumes MSVCRT rules and would double-
  // escape our already-cmdQuote'd string. Bypass it for cmd.exe only.
  return spawnDetached(terminal.command, args, {
    windowsVerbatimArguments: terminal.name === 'Command Prompt',
  })
}
// 函数收尾：对 cmd.exe 使用 windowsVerbatimArguments 避免双重转义。

/**
 * Spawn a terminal detached so the handler process can exit without
 * waiting for the terminal to close. Resolves false on spawn failure
 * (ENOENT, EACCES) rather than crashing.
 */
// 以分离方式启动终端进程，使处理器进程无需等待终端关闭即可退出。启动失败（ENOENT、EACCES）时返回 false 而非抛错。
function spawnDetached(
  command: string,
  args: string[],
  opts: { cwd?: string; windowsVerbatimArguments?: boolean } = {},
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      cwd: opts.cwd,
      windowsVerbatimArguments: opts.windowsVerbatimArguments,
    })
    child.once('error', err => {
      logForDebugging(`Failed to spawn ${command}: ${err.message}`, {
        level: 'error',
      })
      void resolve(false)
    })
    child.once('spawn', () => {
      child.unref()
      void resolve(true)
    })
  })
}
// 函数收尾：注册 error 与 spawn 回调来解析 Promise。

/**
 * Build a single-quoted POSIX shell command string. ONLY used by the
 * AppleScript paths (iTerm, Terminal.app) which have no argv interface.
 */
// 构造单引号包裹的 POSIX shell 命令字符串，仅用于没有 argv 接口的 AppleScript 路径（iTerm、Terminal.app）。
function buildShellCommand(
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): string {
  const cdPrefix = cwd ? `cd ${shellQuote(cwd)} && ` : ''
  return `${cdPrefix}${[claudePath, ...claudeArgs].map(shellQuote).join(' ')}`
}
// 函数收尾：拼接 cd 前缀与命令主体。

/**
 * POSIX single-quote escaping. Single-quoted strings have zero
 * interpretation except for the closing single quote itself.
 * Only used by buildShellCommand() for the AppleScript paths.
 */
// POSIX 单引号转义：单引号字符串内部除闭合单引号外不被解释，用单引号包裹单引号的特殊写法来表示字面单引号。
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
// 函数收尾：返回转义后的单引号字符串。

/**
 * AppleScript string literal escaping (backslash then double-quote).
 */
// AppleScript 字符串字面量转义：对转义字符与双引号分别加前缀转义符，避免命令被截断。
function appleScriptQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
// 函数收尾：返回双引号包裹的转义字符串。

/**
 * PowerShell single-quoted string. The ONLY special sequence is '' for a
 * literal single quote — no backtick escapes, no variable expansion, no
 * subexpressions. This is the safe PowerShell quoting; double-quoted
 * strings interpret `n `t `" etc. and can be escaped out of.
 */
// cmd.exe 参数转义：cmd 不采用标准反斜杠转义，而是遇裸双引号就切换引用状态，因此直接剔除双引号以防命令注入；同时把百分号写成双百分号阻止环境变量展开，并对尾部反斜杠加倍。
function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
// 函数收尾：返回双引号包裹的安全参数。

/**
 * cmd.exe argument quoting. cmd.exe does NOT use CommandLineToArgvW-style
 * backslash escaping — it toggles its quoting state on every raw "
 * character, so an embedded " breaks out of the quoted region and exposes
 * metacharacters (& | < > ^) to cmd.exe interpretation = command injection.
 *
 * Strategy: strip " from the input (it cannot be safely represented in a
 * cmd.exe double-quoted string). Escape % as %% to prevent environment
 * variable expansion (%PATH% etc.) which cmd.exe performs even inside
 * double quotes. Trailing backslashes are still doubled because the
 * *child process* (claude.exe) uses CommandLineToArgvW, where a trailing
 * \ before our closing " would eat the close-quote.
 */
// cmd.exe 参数转义入口：先剔除双引号与转义百分号，再对尾部反斜杠加倍，最后用双引号包裹。
function cmdQuote(arg: string): string {
  const stripped = arg.replace(/"/g, '').replace(/%/g, '%%')
  const escaped = stripped.replace(/(\\+)$/, '$1$1')
  return `"${escaped}"`
}
// 函数收尾：返回最终的安全参数字符串。
