import { env } from '../../../utils/env.js'
import { execFileNoThrow } from '../../../utils/execFileNoThrow.js'
import { TMUX_COMMAND } from '../constants.js'
// 本模块负责检测运行环境：判断是否在 tmux / iTerm2 内、tmux 是否可用、it2 CLI 是否可达，并缓存结果（进程生命周期内不变）。

/**
 * Captured at module load time to detect if the user started Claude from within tmux.
 * Shell.ts may override TMUX env var later, so we capture the original value.
 */
// 模块加载时即抓取用户原始的 TMUX 环境变量，用于判断 Claude 是否从 tmux 内启动；因为 Shell.ts 之后会改写 TMUX，故必须抓原始值。
// eslint-disable-next-line custom-rules/no-process-env-top-level
const ORIGINAL_USER_TMUX = process.env.TMUX

/**
 * Captured at module load time to get the leader's tmux pane ID.
 * TMUX_PANE is set by tmux to the pane ID (e.g., %0, %1) when a process runs inside tmux.
 * We capture this at startup so we always know the leader's original pane, even if
 * the user switches to a different pane later.
 */
// 同理在模块加载时抓取 leader 的 tmux pane ID（tmux 会把它设为当前 pane，如 %0/%1），即便用户之后切换 pane 也能记住原始值。
// eslint-disable-next-line custom-rules/no-process-env-top-level
const ORIGINAL_TMUX_PANE = process.env.TMUX_PANE

/** Cached result for isInsideTmux */
let isInsideTmuxCached: boolean | null = null
// isInsideTmux 的缓存变量，进程生命周期内不变。

/** Cached result for isInITerm2 */
let isInITerm2Cached: boolean | null = null

// isInITerm2 的缓存变量，进程生命周期内不变。
/**
 * Checks if we're currently running inside a tmux session (synchronous version).
 * Uses the original TMUX value captured at module load, not process.env.TMUX,
 * because Shell.ts overrides TMUX when Claude's socket is initialized.
 *
 * IMPORTANT: We ONLY check the TMUX env var. We do NOT run `tmux display-message`
 * as a fallback because that command will succeed if ANY tmux server is running
 * on the system, not just if THIS process is inside tmux.
 */
// 同步版判断是否在 tmux 中——直接看加载时抓到的原始 TMUX 值；只查 TMUX 环境变量，不跑 tmux display-message（因为那条命令只要系统上有任何 tmux server 就会成功，无法区分是否本进程在 tmux 内）。
export function isInsideTmuxSync(): boolean {
  return !!ORIGINAL_USER_TMUX
}

/**
 * Checks if we're currently running inside a tmux session.
 * Uses the original TMUX value captured at module load, not process.env.TMUX,
 * because Shell.ts overrides TMUX when Claude's socket is initialized.
 * Caches the result since this won't change during the process lifetime.
 *
 * IMPORTANT: We ONLY check the TMUX env var. We do NOT run `tmux display-message`
 * as a fallback because that command will succeed if ANY tmux server is running
 * on the system, not just if THIS process is inside tmux.
 */
export async function isInsideTmux(): Promise<boolean> {
// 异步版判断是否在 tmux 内，结果缓存（进程内不变）。
  if (isInsideTmuxCached !== null) {
    return isInsideTmuxCached
  }

  // Check the original TMUX env var (captured at module load)
  // This tells us if the user started Claude from within their tmux session
  // If TMUX is not set, we are NOT inside tmux - period.
  isInsideTmuxCached = !!ORIGINAL_USER_TMUX
  return isInsideTmuxCached
}

/**
 * Gets the leader's tmux pane ID captured at module load.
 * Returns null if not running inside tmux.
 */
export function getLeaderPaneId(): string | null {
// 返回模块加载时抓到的 leader pane ID，不在 tmux 内则 null。
  return ORIGINAL_TMUX_PANE || null
}

/**
 * Checks if tmux is available on the system (installed and in PATH).
 */
export async function isTmuxAvailable(): Promise<boolean> {
// 通过 tmux -V 判断是否安装了 tmux（在 PATH 中可用）。
  const result = await execFileNoThrow(TMUX_COMMAND, ['-V'])
  return result.code === 0
}

/**
 * Checks if we're currently running inside iTerm2.
 * Uses multiple detection methods:
 * 1. TERM_PROGRAM env var set to "iTerm.app"
 * 2. ITERM_SESSION_ID env var is present
 * 3. env.terminal detection from utils/env.ts
 *
 * Caches the result since this won't change during the process lifetime.
 *
 * Note: iTerm2 backend uses AppleScript (osascript) which is built into macOS,
 * so no external CLI tool installation is required.
 */
// 多手段检测是否在 iTerm2 内（TERM_PROGRAM=iTerm.app、ITERM_SESSION_ID 存在、env.terminal 判定）；结果缓存；iTerm2 后端用内建 AppleScript，无需外部 CLI。
export function isInITerm2(): boolean {
  if (isInITerm2Cached !== null) {
    return isInITerm2Cached
  }

  // Check multiple indicators for iTerm2
  const termProgram = process.env.TERM_PROGRAM
  const hasItermSessionId = !!process.env.ITERM_SESSION_ID
  const terminalIsITerm = env.terminal === 'iTerm.app'

  isInITerm2Cached =
    termProgram === 'iTerm.app' || hasItermSessionId || terminalIsITerm

  return isInITerm2Cached
}

/**
 * The it2 CLI command name.
 */
export const IT2_COMMAND = 'it2'
// it2 CLI 命令名常量。

/**
 * Checks if the it2 CLI tool is available AND can reach the iTerm2 Python API.
 * Uses 'session list' (not '--version') because --version succeeds even when
 * the Python API is disabled in iTerm2 preferences — which would cause
 * 'session split' to fail later with no fallback.
 */
export async function isIt2CliAvailable(): Promise<boolean> {
// 用 it2 session list（而非 --version）检测 it2 是否可达 iTerm2 Python API——因为 --version 在 API 被禁用时也会成功，会导致后续 session split 无回退地失败。
  const result = await execFileNoThrow(IT2_COMMAND, ['session', 'list'])
  return result.code === 0
}

/**
 * Resets all cached detection results. Used for testing.
 */
export function resetDetectionCache(): void {
// 供测试用：清空所有检测缓存。
  isInsideTmuxCached = null
  isInITerm2Cached = null
}
