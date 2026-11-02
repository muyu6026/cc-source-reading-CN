// 本文件集中处理进程输出与错误相关的辅助逻辑：包括管道断裂防护、统一写 stdout/stderr、快速失败退出，以及探测 stdin 是否真的有数据。
function handleEPIPE(
  stream: NodeJS.WriteStream,
): (err: NodeJS.ErrnoException) => void {
  return (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      stream.destroy()
    }
  }
}

// Prevents memory leak when pipe is broken (e.g., `claude -p | head -1`)
// `registerProcessOutputErrorHandlers` 为 stdout/stderr 注册 `EPIPE` 错误处理器，防止「管道被提前关闭（如 `claude -p | head -1`）」时进程内存泄漏或崩溃。
export function registerProcessOutputErrorHandlers(): void {
  process.stdout.on('error', handleEPIPE(process.stdout))
  process.stderr.on('error', handleEPIPE(process.stderr))
}

function writeOut(stream: NodeJS.WriteStream, data: string): void {
  if (stream.destroyed) {
    return
  }

  // Note: we don't handle backpressure (write() returning false).
  //
  // We should consider handling the callback to ensure we wait for data to flush.
  stream.write(data /* callback to handle here */)
}

// `writeToStdout` 把数据写入标准输出；底层 `writeOut` 会先判断流是否已销毁，且刻意不处理背压（写返回 `false` 时不等待）。
export function writeToStdout(data: string): void {
  writeOut(process.stdout, data)
}

export function writeToStderr(data: string): void {
  writeOut(process.stderr, data)
}

// Write error to stderr and exit with code 1. Consolidates the
// console.error + process.exit(1) pattern used in entrypoint fast-paths.
// `exitWithError` 向 stderr 打印错误后立刻以退出码 1 结束进程，合并了入口快路径里常见的「`console.error` + `process.exit(1)`」写法。
export function exitWithError(message: string): never {
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.error(message)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

// Wait for a stdin-like stream to close, but give up after ms if no data ever
// arrives. First data chunk cancels the timeout — after that, wait for end
// unconditionally (caller's accumulator needs all chunks, not just the first).
// Returns true on timeout, false on end. Used by -p mode to distinguish a
// real pipe producer from an inherited-but-idle parent stdin.
// `peekForStdinData` 探测一个类 stdin 流是否在 `ms` 毫秒内真的有数据到达：超时返回 `true`，流正常结束返回 `false`。首个数据块会取消超时（之后无条件等待结束），用于区分「真实管道生产者」与「继承但闲置的父进程 stdin」。
export function peekForStdinData(
  stream: NodeJS.EventEmitter,
  ms: number,
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const done = (timedOut: boolean) => {
      clearTimeout(peek)
      stream.off('end', onEnd)
      stream.off('data', onFirstData)
      void resolve(timedOut)
    }
    const onEnd = () => done(false)
    const onFirstData = () => clearTimeout(peek)
    // eslint-disable-next-line no-restricted-syntax -- not a sleep: races timeout against stream end/data events
    const peek = setTimeout(done, ms, true)
    stream.once('end', onEnd)
    stream.once('data', onFirstData)
  })
}
