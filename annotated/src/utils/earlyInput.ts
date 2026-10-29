/**
 * Early Input Capture
 *
 * This module captures terminal input that is typed before the REPL is fully
 * initialized. Users often type `claude` and immediately start typing their
 * prompt, but those early keystrokes would otherwise be lost during startup.
 *
 * Usage:
 * 1. Call startCapturingEarlyInput() as early as possible in cli.tsx
 * 2. When REPL is ready, call consumeEarlyInput() to get any buffered text
 * 3. stopCapturingEarlyInput() is called automatically when input is consumed
 */
// 文件总述：早期输入捕获。在 REPL 完全初始化之前捕获终端键入，用户常敲 claude 后立刻开始输入，这些早期按键在启动期会丢失；本模块在 REPL 就绪后把缓冲交还。

import { lastGrapheme } from './intl.js'

// Buffer for early input characters
let earlyInputBuffer = ''
// 三个模块级状态：输入缓冲字符串、是否正在捕获的标志、可读事件处理器的引用（便于后续移除）。
// Flag to track if we're currently capturing
let isCapturing = false
// Reference to the readable handler so we can remove it later
let readableHandler: (() => void) | null = null

/**
 * Start capturing stdin data early, before the REPL is initialized.
 * Should be called as early as possible in the startup sequence.
 *
 * Only captures if stdin is a TTY (interactive terminal).
 */
export function startCapturingEarlyInput(): void {
  // Only capture in interactive mode: stdin must be a TTY, and we must not
  // be in print mode. Raw mode disables ISIG (terminal Ctrl+C → SIGINT),
  // which would make -p uninterruptible.
  if (
    !process.stdin.isTTY ||
    isCapturing ||
    process.argv.includes('-p') ||
    process.argv.includes('--print')
  ) {
    return
  }

  isCapturing = true
  earlyInputBuffer = ''

  // Set stdin to raw mode and use 'readable' event like Ink does
  // This ensures compatibility with how the REPL will handle stdin later
  try {
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.ref()

    readableHandler = () => {
// readableHandler：在原始模式下用 readable 事件循环读取 stdin 分块并交给 processChunk 处理。
      let chunk = process.stdin.read()
      while (chunk !== null) {
        if (typeof chunk === 'string') {
          processChunk(chunk)
        }
        chunk = process.stdin.read()
      }
    }

    process.stdin.on('readable', readableHandler)
  } catch {
    // If we can't set raw mode, just silently continue without early capture
    isCapturing = false
  }
}
// startCapturingEarlyInput：仅在交互 TTY 且非打印模式时才捕获，设原始模式并监听 readable 事件；无法设原始模式时静默放弃。

/**
 * Process a chunk of input data
 */
function processChunk(str: string): void {
  let i = 0
  while (i < str.length) {
    const char = str[i]!
    const code = char.charCodeAt(0)

    // Ctrl+C (code 3) - stop capturing and exit immediately.
    // We use process.exit here instead of gracefulShutdown because at this
    // early stage of startup, the shutdown machinery isn't initialized yet.
    if (code === 3) {
      stopCapturingEarlyInput()
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(130) // Standard exit code for Ctrl+C
// Ctrl+C（码值 3）：停止捕获并立即退出（早期启动期关闭流程尚未初始化，故直接用 process.exit(130)）。
      return
    }

    // Ctrl+D (code 4) - EOF, stop capturing
    if (code === 4) {
      stopCapturingEarlyInput()
      return
    }

    // Backspace (code 127 or 8) - remove last grapheme cluster
    if (code === 127 || code === 8) {
      if (earlyInputBuffer.length > 0) {
        const last = lastGrapheme(earlyInputBuffer)
        earlyInputBuffer = earlyInputBuffer.slice(0, -(last.length || 1))
      }
      i++
      continue
    }

    // Skip escape sequences (arrow keys, function keys, focus events, etc.)
    // All escape sequences start with ESC (0x1B) and end with a byte in 0x40-0x7E
    if (code === 27) {
      i++ // Skip the ESC character
      // Skip until the terminating byte (@ to ~) or end of string
      while (
        i < str.length &&
        !(str.charCodeAt(i) >= 64 && str.charCodeAt(i) <= 126)
      ) {
        i++
      }
      if (i < str.length) i++ // Skip the terminating byte
      continue
    }

    // Skip other control characters (except tab and newline)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      i++
      continue
    }

    // Convert carriage return to newline
    if (code === 13) {
      earlyInputBuffer += '\n'
      i++
      continue
    }

    // Add printable characters and allowed control chars to buffer
    earlyInputBuffer += char
    i++
  }
}
// processChunk：逐字符处理输入——Ctrl+C 退出、退格删掉最后一个字素簇、跳过转义序列与不可打印控制符、回车转成换行，其余可打印字符入缓冲。

/**
 * Stop capturing early input.
 * Called automatically when input is consumed, or can be called manually.
 */
export function stopCapturingEarlyInput(): void {
  if (!isCapturing) {
    return
  }

  isCapturing = false

  if (readableHandler) {
    process.stdin.removeListener('readable', readableHandler)
    readableHandler = null
  }

  // Don't reset stdin state - the REPL's Ink App will manage stdin state.
  // If we call setRawMode(false) here, it can interfere with the REPL's
  // own stdin setup which happens around the same time.
}
// stopCapturingEarlyInput：移除 readable 监听器，但不重置 stdin 状态（交给 REPL 的 Ink 管理，避免干扰其自身的 stdin 设置）。

/**
 * Consume any early input that was captured.
 * Returns the captured input and clears the buffer.
 * Automatically stops capturing when called.
 */
export function consumeEarlyInput(): string {
  stopCapturingEarlyInput()
  const input = earlyInputBuffer.trim()
  earlyInputBuffer = ''
  return input
}
// consumeEarlyInput：取出并清空缓冲（自动停止捕获），返回前会做 trim。

/**
 * Check if there is any early input available without consuming it.
 */
export function hasEarlyInput(): boolean {
  return earlyInputBuffer.trim().length > 0
}
// hasEarlyInput：不消费地判断是否存在早期输入。

/**
 * Seed the early input buffer with text that will appear pre-filled
 * in the prompt input when the REPL renders. Does not auto-submit.
 */
export function seedEarlyInput(text: string): void {
  earlyInputBuffer = text
}
// seedEarlyInput：预填提示输入，REPL 渲染时会显示为已输入内容，但不自动提交。

/**
 * Check if early input capture is currently active.
 */
export function isCapturingEarlyInput(): boolean {
  return isCapturing
}
// isCapturingEarlyInput：查询是否正在捕获。
