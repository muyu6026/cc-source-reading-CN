// ═══════════════════════════════════════════════════════════════
//  清屏：Windows 上有三档，其余一律一档
// ═══════════════════════════════════════════════════════════════
//
//  「清屏」在终端里其实是两个动作的组合：
//
//    `ESC[2J`  擦可视区（不含 scrollback）
//    `ESC[3J`  擦 scrollback（xterm 扩展，不是所有终端支持）
//    `ESC[H`   光标归位
//
//  现代终端三个都发；老 conhost **不认识 `ESC[3J`**，所以不能发 ——
//  但更麻烦的是它也**不认 `ESC[H`**（那是 ANSI 的 CUP/HVP 形式），
//  得用 legacy 的 HVP `ESC[0;0f`。
//
//  这就是为什么这个文件存在：一个「清屏」操作，在 Windows 老控制台
//  和别处是两套序列。
/**
 * Cross-platform terminal clearing with scrollback support.
 * Detects modern terminals that support ESC[3J for clearing scrollback.
 */

import {
  CURSOR_HOME,
  csi,
  ERASE_SCREEN,
  ERASE_SCROLLBACK,
} from './termio/csi.js'

// HVP (Horizontal Vertical Position) - legacy Windows cursor home
const CURSOR_HOME_WINDOWS = csi(0, 'f')

function isWindowsTerminal(): boolean {
  return process.platform === 'win32' && !!process.env.WT_SESSION
}

// mintty 的判断有两路：TERM_PROGRAM（3.1.5+ 才设）和 MSYSTEM
//  （GitBash / MSYS2 / MINGW 都会设）。
//
//  为什么需要第二路：mintty 的老版本不设 TERM_PROGRAM，但它们在
//  Windows 上跑、且**支持现代序列**。漏判的话会退到 legacy 分支，
//  清不干净 scrollback。
//
//  这是「同一个终端，新老版本能力不同，但环境变量只在某一版之后才有」
//  的通用问题。解法只能是「多重信号取或」。
function isMintty(): boolean {
  // mintty 3.1.5+ sets TERM_PROGRAM to 'mintty'
  if (process.env.TERM_PROGRAM === 'mintty') {
    return true
  }
  // GitBash/MSYS2/MINGW use mintty and set MSYSTEM
  if (process.platform === 'win32' && process.env.MSYSTEM) {
    return true
  }
  return false
}

// 三档判断，顺序是「确定 → 较确定 → 猜」：
//   WT_SESSION              → Windows Terminal，确定
//   vscode + 有版本号        → VS Code 的 ConPTY，较确定
//   mintty                  → 猜（但有 MSYSTEM 兜底）
//
//  第二条为什么要 `&& TERM_PROGRAM_VERSION`：光有 TERM_PROGRAM=vscode
//  还不够 —— 在 Windows 上用非 ConPTY 的老版 VS Code 时，
//  `ESC[3J` 可能不被支持。版本号存在是「这是个较新的 VS Code」的
//  弱证据。
function isModernWindowsTerminal(): boolean {
  // Windows Terminal sets WT_SESSION environment variable
  if (isWindowsTerminal()) {
    return true
  }

  // VS Code integrated terminal on Windows with ConPTY support
  if (
    process.platform === 'win32' &&
    process.env.TERM_PROGRAM === 'vscode' &&
    process.env.TERM_PROGRAM_VERSION
  ) {
    return true
  }

  // mintty (GitBash/MSYS2/Cygwin) supports modern escape sequences
  if (isMintty()) {
    return true
  }

  return false
}

/**
 * Returns the ANSI escape sequence to clear the terminal including scrollback.
 * Automatically detects terminal capabilities.
 */
// 分派只有两级：Windows 分两档，其余一律「现代」。
//
//  这个简化有个前提：**非 Windows 的终端基本都支持 `ESC[3J`**。
//  不成立的场景是老的 xterm / 某些精简实现的终端 —— 它们会
//  把 `ESC[3J` 当未知序列忽略（无害，只是 scrollback 没清）。
//
//  所以这个简化的代价是「在极老的终端上 scrollback 清不掉」，
//  而不是「出错」。可以接受。
export function getClearTerminalSequence(): string {
  if (process.platform === 'win32') {
    if (isModernWindowsTerminal()) {
      return ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
    } else {
      // Legacy Windows console - can't clear scrollback
      return ERASE_SCREEN + CURSOR_HOME_WINDOWS
    }
  }
  return ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
}

/**
 * Clears the terminal screen. On supported terminals, also clears scrollback.
 */
// ⚠️ `export const clearTerminal` **全仓库零读者**。
//
//  grep `clearTerminal` 的命中全是：
//    · `frame.ts` 的 patch 类型字符串 `'clearTerminal'`
//    · `ink.tsx:606` / `log-update.ts:509` 里对那个类型的处理
//    · `terminal.ts:5` 导入的是 `getClearTerminalSequence`（函数，不是这个常量）
//
//  也就是说：真正被用的是**函数**（每次调用重新判断），而这个
//  「模块加载时算好一次的常量」没人用。
//
//  从设计上看，常量版其实更合理（终端能力不会中途变），
//  没被采用可能只是「后来改成了按需调」。留着它不会出错，
//  但它是一个**误导性的出口**：读代码的人会以为清屏走这条路径。
export const clearTerminal = getClearTerminalSequence()
