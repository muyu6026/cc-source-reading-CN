/**
 * Built-in terminal panel toggled with Meta+J.
 *
 * Uses tmux for shell persistence: a separate tmux server with a per-instance
 * socket (e.g., "claude-panel-a1b2c3d4") holds the shell session. Each Claude
 * Code instance gets its own isolated terminal panel that persists within the
 * session but is destroyed when the instance exits.
 *
 * Meta+J is bound to detach-client inside tmux, so pressing it returns to
 * Claude Code while the shell keeps running. Next toggle re-attaches to the
 * same session.
 *
 * When tmux is not available, falls back to a non-persistent shell via spawnSync.
 *
 * Uses the same suspend-Ink pattern as the external editor (promptEditor.ts).
 */
// 文件级：内置终端面板，Meta+J 切换；用 tmux 维护持久 shell 会话，每个实例持有独立 socket，实例退出即销毁；无 tmux 时退回非持久 shell。

import { spawn, spawnSync } from 'child_process'
import { getSessionId } from '../bootstrap/state.js'
import instances from '../ink/instances.js'
import { registerCleanup } from './cleanupRegistry.js'
import { pwd } from './cwd.js'
import { logForDebugging } from './debug.js'

const TMUX_SESSION = 'panel'
// TMUX_SESSION 常量：固定会话名 panel，所有实例共用同一 tmux 会话名，靠 socket 区分彼此。

/**
 * Get the tmux socket name for the terminal panel.
 * Uses a unique socket per Claude Code instance (based on session ID)
 * so that each instance has its own isolated terminal panel.
 */
export function getTerminalPanelSocket(): string {
  // Use first 8 chars of session UUID for uniqueness while keeping name short
  const sessionId = getSessionId()
  return `claude-panel-${sessionId.slice(0, 8)}`
}
// getTerminalPanelSocket：取 session UUID 前 8 位拼成唯一 socket 名，保证每个实例的终端面板互相隔离。

let instance: TerminalPanel | undefined

/**
 * Return the singleton TerminalPanel, creating it lazily on first use.
 */
export function getTerminalPanel(): TerminalPanel {
  if (!instance) {
    instance = new TerminalPanel()
  }
  return instance
}
// getTerminalPanel：懒加载单例，首次使用时创建 TerminalPanel。

class TerminalPanel {
  private hasTmux: boolean | undefined
  private cleanupRegistered = false

  // ── public API ────────────────────────────────────────────────────

  toggle(): void {
    this.showShell()
  }

  // ── tmux helpers ──────────────────────────────────────────────────

  private checkTmux(): boolean {
    if (this.hasTmux !== undefined) return this.hasTmux
    const result = spawnSync('tmux', ['-V'], { encoding: 'utf-8' })
    this.hasTmux = result.status === 0
    if (!this.hasTmux) {
      logForDebugging(
        'Terminal panel: tmux not found, falling back to non-persistent shell',
      )
    }
    return this.hasTmux
  }
// checkTmux：缓存式探测 tmux 是否可用，不可用时记日志并退回非持久 shell。

  private hasSession(): boolean {
    const result = spawnSync(
      'tmux',
      ['-L', getTerminalPanelSocket(), 'has-session', '-t', TMUX_SESSION],
      { encoding: 'utf-8' },
    )
    return result.status === 0
  }
// hasSession：判断当前 socket 下 panel 会话是否已存在。

  private createSession(): boolean {
    const shell = process.env.SHELL || '/bin/bash'
    const cwd = pwd()
    const socket = getTerminalPanelSocket()

    const result = spawnSync(
      'tmux',
      [
        '-L',
        socket,
        'new-session',
        '-d',
        '-s',
        TMUX_SESSION,
        '-c',
        cwd,
        shell,
        '-l',
      ],
      { encoding: 'utf-8' },
    )

    if (result.status !== 0) {
      logForDebugging(
        `Terminal panel: failed to create tmux session: ${result.stderr}`,
      )
      return false
    }

    // Bind Meta+J (toggles back to Claude Code from inside the terminal)
    // and configure the status bar hint. Chained with ';' to collapse
    // 5 spawnSync calls into 1.
    // biome-ignore format: one tmux command per line
    spawnSync('tmux', [
      '-L', socket,
      'bind-key', '-n', 'M-j', 'detach-client', ';',
      'set-option', '-g', 'status-style', 'bg=default', ';',
      'set-option', '-g', 'status-left', '', ';',
      'set-option', '-g', 'status-right', ' Alt+J to return to Claude ', ';',
      'set-option', '-g', 'status-right-style', 'fg=brightblack',
    ])

    if (!this.cleanupRegistered) {
      this.cleanupRegistered = true
      registerCleanup(async () => {
        // Detached async spawn — spawnSync here would block the event loop
        // and serialize the entire cleanup Promise.all in gracefulShutdown.
        // .on('error') swallows ENOENT if tmux disappears between session
        // creation and cleanup — prevents spurious uncaughtException noise.
        spawn('tmux', ['-L', socket, 'kill-server'], {
          detached: true,
          stdio: 'ignore',
        })
          .on('error', () => {})
          .unref()
      })
    }

    return true
  }
// createSession：用当前 shell 与 cwd 在独立 socket 上新建 tmux 会话；绑定 Meta+J 返回 Claude、配置状态栏提示，并注册清理时杀掉 tmux server。

  private attachSession(): void {
    spawnSync(
      'tmux',
      ['-L', getTerminalPanelSocket(), 'attach-session', '-t', TMUX_SESSION],
      { stdio: 'inherit' },
    )
  }
// attachSession：把已存在的 tmux 会话挂接回终端（inherit stdio）。

  // ── show shell ────────────────────────────────────────────────────

  private showShell(): void {
    const inkInstance = instances.get(process.stdout)
    if (!inkInstance) {
      logForDebugging('Terminal panel: no Ink instance found, aborting')
      return
    }

    inkInstance.enterAlternateScreen()
    try {
      if (this.checkTmux() && this.ensureSession()) {
        this.attachSession()
      } else {
        this.runShellDirect()
      }
    } finally {
      inkInstance.exitAlternateScreen()
    }
  }
// showShell：进入备用屏后，有 tmux 则确保会话存在并挂接，否则直接跑 shell；finally 中退出备用屏。

  // ── helpers ───────────────────────────────────────────────────────

  /** Ensure a tmux session exists, creating one if needed. */
  private ensureSession(): boolean {
    if (this.hasSession()) return true
    return this.createSession()
  }
// ensureSession：会话已存在直接返回，否则创建。

  /** Fallback when tmux is not available — runs a non-persistent shell. */
  private runShellDirect(): void {
    const shell = process.env.SHELL || '/bin/bash'
    const cwd = pwd()
    spawnSync(shell, ['-i', '-l'], {
      stdio: 'inherit',
      cwd,
      env: process.env,
    })
  }
// runShellDirect：无 tmux 时的兜底，用交互式登录 shell 直接运行。
}
