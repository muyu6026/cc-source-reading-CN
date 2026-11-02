import { openSync } from 'fs'
import { ReadStream } from 'tty'
import type { RenderOptions } from '../ink.js'
import { isEnvTruthy } from './envUtils.js'
import { logError } from './log.js'

// Cached stdin override - computed once per process
// 渲染参数的基础包装。核心目的是一个兼容问题：标准输入被管道接管时，交互式界面拿不到按键，所以要改从终端设备读。这个替代输入源每个进程只探测一次并缓存，因为打开终端设备是有副作用的操作。
let cachedStdinOverride: ReadStream | undefined | null = null

/**
 * Gets a ReadStream for /dev/tty when stdin is piped.
 * This allows interactive Ink rendering even when stdin is a pipe.
 * Result is cached for the lifetime of the process.
 */
function getStdinOverride(): ReadStream | undefined {
  // Return cached result if already computed
  if (cachedStdinOverride !== null) {
    return cachedStdinOverride
  }

  // No override needed if stdin is already a TTY
  if (process.stdin.isTTY) {
    cachedStdinOverride = undefined
    return undefined
  }
// 缓存用三态而不是两态：null 表示还没算过，undefined 表示算过且确认不需要替代，具体流对象表示确实需要。这样重复调用不会反复去开设备。标准输入本来就是终端时直接判定不需要。

  // Skip in CI environments
  if (isEnvTruthy(process.env.CI)) {
    cachedStdinOverride = undefined
    return undefined
  }

  // Skip if running MCP (input hijacking breaks MCP)
  if (process.argv.includes('mcp')) {
    cachedStdinOverride = undefined
    return undefined
  }

  // No /dev/tty on Windows
  if (process.platform === 'win32') {
    cachedStdinOverride = undefined
    return undefined
  }
// 三类必须放弃替代的场景各自早退并写缓存：持续集成环境没有真实终端；以 MCP 子命令启动时劫持输入会破坏协议通信；Windows 上根本没有这个设备路径。这三处都不抛错，只安静降级。

  // Try to open /dev/tty as an alternative input source
  try {
    const ttyFd = openSync('/dev/tty', 'r')
    const ttyStream = new ReadStream(ttyFd)
    // Explicitly set isTTY to true since we know /dev/tty is a TTY.
    // This is needed because some runtimes (like Bun's compiled binaries)
    // may not correctly detect isTTY on ReadStream created from a file descriptor.
    ttyStream.isTTY = true
    cachedStdinOverride = ttyStream
    return cachedStdinOverride
  } catch (err) {
    logError(err as Error)
    cachedStdinOverride = undefined
    return undefined
  }
}
// 真正打开设备时，打开文件与构造流都可能失败，所以整段包在 try 里，失败只记日志并写缓存为「不需要」。拿到流后手工把是否终端标记置真——注释说明了原因：某些运行时（例如编译成单文件的 Bun）从文件描述符构造的流上探测这个标记并不可靠。

/**
 * Returns base render options for Ink, including stdin override when needed.
 * Use this for all render() calls to ensure piped input works correctly.
 *
 * @param exitOnCtrlC - Whether to exit on Ctrl+C (usually false for dialogs)
 */
export function getBaseRenderOptions(
  exitOnCtrlC: boolean = false,
): RenderOptions {
  const stdin = getStdinOverride()
  const options: RenderOptions = { exitOnCtrlC }
  if (stdin) {
    options.stdin = stdin
  }
  return options
}
// 对外只暴露这一个函数，保证所有渲染调用拿到一致的参数：默认不因 Ctrl 加 C 退出（对话框场景通常要自己处理），有替代输入源时才把它塞进参数对象。注释要求所有渲染调用都走这里，否则管道输入下的按键仍会失效。
