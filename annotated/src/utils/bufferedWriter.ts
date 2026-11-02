type WriteFn = (content: string) => void

export type BufferedWriter = {
// BufferedWriter 形态：write 追加内容、flush 立即落盘、dispose 收尾。
  write: (content: string) => void
  flush: () => void
  dispose: () => void
}

export function createBufferedWriter({
// 工厂函数：把零散 write 聚合成批，按时间、条数、字节数阈值触发落盘。
  writeFn,
  flushIntervalMs = 1000,
  maxBufferSize = 100,
  maxBufferBytes = Infinity,
  immediateMode = false,
}: {
  writeFn: WriteFn
  flushIntervalMs?: number
  maxBufferSize?: number
  maxBufferBytes?: number
  immediateMode?: boolean
}): BufferedWriter {
  let buffer: string[] = []
  let bufferBytes = 0
  let flushTimer: NodeJS.Timeout | null = null
  // Batch detached by overflow that hasn't been written yet. Tracked so
  // flush()/dispose() can drain it synchronously if the process exits
  // before the setImmediate fires.
  let pendingOverflow: string[] | null = null

  function clearTimer(): void {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  function flush(): void {
// flush 同步把缓冲与溢出内容交给 writeFn，并清空计时器。
    if (pendingOverflow) {
      writeFn(pendingOverflow.join(''))
      pendingOverflow = null
    }
    if (buffer.length === 0) return
    writeFn(buffer.join(''))
    buffer = []
    bufferBytes = 0
    clearTimer()
  }

  function scheduleFlush(): void {
    if (!flushTimer) {
      flushTimer = setTimeout(flush, flushIntervalMs)
    }
  }

  // Detach the buffer synchronously so the caller never waits on writeFn.
  // writeFn may block (e.g. errorLogSink.ts appendFileSync) — if overflow fires
  // mid-render or mid-keystroke, deferring the write keeps the current tick
  // short. Timer-based flushes already run outside user code paths so they
  // stay synchronous.
  function flushDeferred(): void {
// flushDeferred 把缓冲同步摘离：writeFn 可能阻塞，故用 setImmediate 延后真正写入，保持当前 tick 短小。
    if (pendingOverflow) {
      // A previous overflow write is still queued. Coalesce into it to
      // preserve ordering — writes land in a single setImmediate-ordered batch.
      pendingOverflow.push(...buffer)
      buffer = []
      bufferBytes = 0
      clearTimer()
      return
    }
    const detached = buffer
    buffer = []
    bufferBytes = 0
    clearTimer()
    pendingOverflow = detached
    setImmediate(() => {
      const toWrite = pendingOverflow
      pendingOverflow = null
      if (toWrite) writeFn(toWrite.join(''))
    })
  }

  return {
    write(content: string): void {
      if (immediateMode) {
        writeFn(content)
        return
      }
      buffer.push(content)
      bufferBytes += content.length
      scheduleFlush()
      if (buffer.length >= maxBufferSize || bufferBytes >= maxBufferBytes) {
        flushDeferred()
      }
    },
    flush,
    dispose(): void {
      flush()
    },
  }
}
// 本工厂用闭包维护缓冲与计时器，返回的对象对外只暴露 write / flush / dispose。
