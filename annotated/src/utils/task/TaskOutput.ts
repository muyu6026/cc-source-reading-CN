import { unlink } from 'fs/promises'
import { CircularBuffer } from '../CircularBuffer.js'
import { logForDebugging } from '../debug.js'
import { readFileRange, tailFile } from '../fsOperations.js'
import { getMaxOutputLength } from '../shell/outputLimits.js'
import { safeJoinLines } from '../stringUtils.js'
import { DiskTaskOutput, getTaskOutputPath } from './diskOutput.js'

const DEFAULT_MAX_MEMORY = 8 * 1024 * 1024 // 8MB
const POLL_INTERVAL_MS = 1000
const PROGRESS_TAIL_BYTES = 4096
// 定义三个常量：内存上限 8MB、轮询间隔 1 秒、进度尾巴采样 4KB。

type ProgressCallback = (
  lastLines: string,
  allLines: string,
  totalLines: number,
  totalBytes: number,
  isIncomplete: boolean,
) => void
// `ProgressCallback` 类型：轮询时回传末几行、全部行、总行数、总字节与是否不完整。

/**
 * Single source of truth for a shell command's output.
 *
 * For bash commands (file mode): both stdout and stderr go directly to
 * a file via stdio fds — neither enters JS. Progress is extracted by
 * polling the file tail. getStderr() returns '' since stderr is
 * interleaved in the output file.
 *
 * For hooks (pipe mode): data flows through writeStdout()/writeStderr()
 * and is buffered in memory, spilling to disk if it exceeds the limit.
 */
export class TaskOutput {
// `TaskOutput` 是 shell 命令输出的唯一真相来源，统一封装文件模式（bash）与管道模式（hook）。
  readonly taskId: string
  readonly path: string
  /** True when stdout goes to a file fd (bypassing JS). False for pipe mode (hooks). */
  readonly stdoutToFile: boolean
  #stdoutBuffer = ''
  #stderrBuffer = ''
  #disk: DiskTaskOutput | null = null
  #recentLines = new CircularBuffer<string>(1000)
  #totalLines = 0
  #totalBytes = 0
  #maxMemory: number
  #onProgress: ProgressCallback | null
  /** Set by getStdout() — true when the file was fully read (≤ maxOutputLength). */
  #outputFileRedundant = false
  /** Set by getStdout() — total file size in bytes. */
  #outputFileSize = 0

  // --- Shared poller state ---

  /** Registry of all file-mode TaskOutput instances with onProgress callbacks. */
  static #registry = new Map<string, TaskOutput>()
  /** Subset of #registry currently being polled (visibility-driven by React). */
  static #activePolling = new Map<string, TaskOutput>()
  static #pollInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    taskId: string,
    onProgress: ProgressCallback | null,
    stdoutToFile = false,
    maxMemory: number = DEFAULT_MAX_MEMORY,
  ) {
    this.taskId = taskId
    this.path = getTaskOutputPath(taskId)
    this.stdoutToFile = stdoutToFile
    this.#maxMemory = maxMemory
    this.#onProgress = onProgress

    // Register for polling when stdout goes to a file and progress is needed.
    // Actual polling is started/stopped by React via startPolling/stopPolling.
    if (stdoutToFile && onProgress) {
      TaskOutput.#registry.set(taskId, this)
    }
  }
// 构造函数按 `taskId` 初始化路径，文件模式且有进度回调时注册到静态轮询表。

  /**
   * Begin polling the output file for progress. Called from React
   * useEffect when the progress component mounts.
   */
  static startPolling(taskId: string): void {
// `startPolling` 由 React 组件挂载时调用，把实例加入活跃轮询集合。
    const instance = TaskOutput.#registry.get(taskId)
    if (!instance || !instance.#onProgress) {
      return
    }
    TaskOutput.#activePolling.set(taskId, instance)
    if (!TaskOutput.#pollInterval) {
      TaskOutput.#pollInterval = setInterval(TaskOutput.#tick, POLL_INTERVAL_MS)
      TaskOutput.#pollInterval.unref()
    }
// 首次启动用 `setInterval` 定时读取尾巴，并 `unref` 避免阻止进程退出。
  }

  /**
   * Stop polling the output file. Called from React useEffect cleanup
   * when the progress component unmounts.
   */
  static stopPolling(taskId: string): void {
// `stopPolling` 由 React 卸载清理时调用，移除实例。
    TaskOutput.#activePolling.delete(taskId)
    if (TaskOutput.#activePolling.size === 0 && TaskOutput.#pollInterval) {
      clearInterval(TaskOutput.#pollInterval)
      TaskOutput.#pollInterval = null
    }
// 当活跃集合为空且定时器存在时，清除定时器停止轮询。
  }

  /**
   * Shared tick: reads the file tail for every actively-polled task.
   * Non-async body (.then) to avoid stacking if I/O is slow.
   */
  static #tick(): void {
// `#tick` 共享节拍：为每个活跃实例读取文件尾巴，用 `.then` 而非 async 以免 I/O 慢时堆叠。
    for (const [, entry] of TaskOutput.#activePolling) {
// 遍历所有活跃轮询实例，逐个触发其进度回调。
      if (!entry.#onProgress) {
        continue
      }
      void tailFile(entry.path, PROGRESS_TAIL_BYTES).then(
        ({ content, bytesRead, bytesTotal }) => {
          if (!entry.#onProgress) {
            return
          }
          // Always call onProgress even when content is empty, so the
          // progress loop wakes up and can check for backgrounding.
          // Commands like `git log -S` produce no output for long periods.
          if (!content) {
            entry.#onProgress('', '', entry.#totalLines, bytesTotal, false)
            return
          }
// 内容为空也照常回调，使进度循环保持唤醒并能检测后台化（如 `git log -S` 长时间无输出）。
          // Count all newlines in the tail and capture slice points for the
          // last 5 and last 100 lines. Uncapped so extrapolation stays accurate
          // for dense output (short lines → >100 newlines in 4KB).
          let pos = content.length
          let n5 = 0
          let n100 = 0
          let lineCount = 0
          while (pos > 0) {
            pos = content.lastIndexOf('\n', pos - 1)
            lineCount++
            if (lineCount === 5) n5 = pos <= 0 ? 0 : pos + 1
            if (lineCount === 100) n100 = pos <= 0 ? 0 : pos + 1
          }
// 从尾巴反向扫描所有换行，定位末 5 行与末 100 行的切片起点。
          // lineCount is exact when the whole file fits in PROGRESS_TAIL_BYTES.
          // Otherwise extrapolate from the tail sample; monotone max keeps the
          // counter from going backwards when the tail has longer lines on one tick.
          const totalLines =
            bytesRead >= bytesTotal
              ? lineCount
              : Math.max(
                  entry.#totalLines,
                  Math.round((bytesTotal / bytesRead) * lineCount),
                )
// 文件整体可读时取精确行数；否则按字节比外推，并用单调最大值防止某一拍行数回退。
          entry.#totalLines = totalLines
          entry.#totalBytes = bytesTotal
          entry.#onProgress(
            content.slice(n5),
            content.slice(n100),
            totalLines,
            bytesTotal,
            bytesRead < bytesTotal,
          )
// 构造进度回调参数并触发，包含切片、总行数与是否不完整。
        },
        () => {
          // File may not exist yet
        },
      )
// 文件可能尚未生成，读取错误直接忽略。
    }
  }

  /** Write stdout data (pipe mode only — used by hooks). */
  writeStdout(data: string): void {
// `writeStdout` 仅管道模式（hook）使用，写入内存缓冲。
    this.#writeBuffered(data, false)
  }

  /** Write stderr data (always piped). */
  writeStderr(data: string): void {
// `writeStderr` 始终走管道，与 stdout 分流存储。
    this.#writeBuffered(data, true)
  }

  #writeBuffered(data: string, isStderr: boolean): void {
// `#writeBuffered` 是统一写入入口，先更新进度再决定落盘或缓冲。
    this.#totalBytes += data.length

    this.#updateProgress(data)

    // Write to disk if already overflowed
    if (this.#disk) {
      this.#disk.append(isStderr ? `[stderr] ${data}` : data)
      return
    }
// 若已溢出到磁盘，直接追加并提前返回。

    // Check if this chunk would exceed the in-memory limit
    const totalMem =
      this.#stdoutBuffer.length + this.#stderrBuffer.length + data.length
    if (totalMem > this.#maxMemory) {
      this.#spillToDisk(isStderr ? data : null, isStderr ? null : data)
      return
    }
// 本块将超出内存上限时溢出到磁盘，避免无限增长。

    if (isStderr) {
      this.#stderrBuffer += data
    } else {
      this.#stdoutBuffer += data
    }
// 否则按是否为 stderr 累计到对应内存缓冲。
  }

  /**
   * Single backward pass: count all newlines (for totalLines) and extract
   * the last few lines as flat copies (for the CircularBuffer / progress).
   * Only used in pipe mode (hooks). File mode uses the shared poller.
   */
  #updateProgress(data: string): void {
// `#updateProgress` 单次反向扫描：统计换行数并抽取末几行供进度展示。
    const MAX_PROGRESS_BYTES = 4096
    const MAX_PROGRESS_LINES = 100

    let lineCount = 0
    const lines: string[] = []
    let extractedBytes = 0
    let pos = data.length

    while (pos > 0) {
      const prev = data.lastIndexOf('\n', pos - 1)
      if (prev === -1) {
        break
      }
      lineCount++
      if (
        lines.length < MAX_PROGRESS_LINES &&
        extractedBytes < MAX_PROGRESS_BYTES
      ) {
        const lineLen = pos - prev - 1
        if (lineLen > 0 && lineLen <= MAX_PROGRESS_BYTES - extractedBytes) {
          const line = data.slice(prev + 1, pos)
          if (line.trim()) {
            lines.push(Buffer.from(line).toString())
            extractedBytes += lineLen
          }
        }
      }
      pos = prev
    }
// 扫描完一帧后把本帧行数累加进总计数。

    this.#totalLines += lineCount

    for (let i = lines.length - 1; i >= 0; i--) {
      this.#recentLines.add(lines[i]!)
    }

    if (this.#onProgress && lines.length > 0) {
      const recent = this.#recentLines.getRecent(5)
      this.#onProgress(
        safeJoinLines(recent, '\n'),
        safeJoinLines(this.#recentLines.getRecent(100), '\n'),
        this.#totalLines,
        this.#totalBytes,
        this.#disk !== null,
      )
    }
  }
// 存在进度回调且本帧有内容时，用最近行触发 `onProgress`。

  #spillToDisk(stderrChunk: string | null, stdoutChunk: string | null): void {
    this.#disk = new DiskTaskOutput(this.taskId)
// `#spillToDisk` 创建磁盘输出对象，准备把内存缓冲刷下去。

    // Flush existing buffers
    if (this.#stdoutBuffer) {
      this.#disk.append(this.#stdoutBuffer)
      this.#stdoutBuffer = ''
    }
    if (this.#stderrBuffer) {
      this.#disk.append(`[stderr] ${this.#stderrBuffer}`)
      this.#stderrBuffer = ''
    }

    // Write the chunk that triggered overflow
    if (stdoutChunk) {
      this.#disk.append(stdoutChunk)
    }
    if (stderrChunk) {
      this.#disk.append(`[stderr] ${stderrChunk}`)
    }
  }
// 写入触发溢出的那一块数据，并标记 stderr 前缀。

  /**
   * Get stdout. In file mode, reads from the output file.
   * In pipe mode, returns the in-memory buffer or tail from CircularBuffer.
   */
  async getStdout(): Promise<string> {
// `getStdout`：文件模式从输出文件读取，管道模式返回缓冲或截断提示。
    if (this.stdoutToFile) {
      return this.#readStdoutFromFile()
    }
    // Pipe mode (hooks) — use in-memory data
    if (this.#disk) {
      const recent = this.#recentLines.getRecent(5)
      const tail = safeJoinLines(recent, '\n')
      const sizeKB = Math.round(this.#totalBytes / 1024)
      const notice = `\nOutput truncated (${sizeKB}KB total). Full output saved to: ${this.path}`
      return tail ? tail + notice : notice.trimStart()
    }
    return this.#stdoutBuffer
  }
// 管道模式溢出时返回末尾切片加截断提示，未溢出则回内存缓冲。

  async #readStdoutFromFile(): Promise<string> {
// `#readStdoutFromFile` 从文件读取 stdout，受最大输出长度限制。
    const maxBytes = getMaxOutputLength()
    try {
      const result = await readFileRange(this.path, 0, maxBytes)
      if (!result) {
        this.#outputFileRedundant = true
        return ''
      }
      const { content, bytesRead, bytesTotal } = result
      // If the file fits, it's fully captured inline and can be deleted.
      // If not, return what we read — processToolResultBlock handles
      // the <persisted-output> formatting and persistence downstream.
      this.#outputFileSize = bytesTotal
      this.#outputFileRedundant = bytesTotal <= bytesRead
      return content
// 文件能完整读入则标记冗余（已全在结果里）可删除，否则返回已读部分。
    } catch (err) {
      // Surface the error instead of silently returning empty. An ENOENT here
      // means the output file was deleted while the command was running
      // (historically: cross-session startup cleanup in the same project dir).
      // Returning a diagnostic string keeps the tool_result non-empty, which
      // avoids reminder-only-at-tail confusion downstream and tells the model
      // (and us, via the transcript) what actually happened.
      const code =
        err instanceof Error && 'code' in err ? String(err.code) : 'unknown'
      logForDebugging(
        `TaskOutput.#readStdoutFromFile: failed to read ${this.path} (${code}): ${err}`,
      )
      return `<bash output unavailable: output file ${this.path} could not be read (${code}). This usually means another Claude Code process in the same project deleted it during startup cleanup.>`
    }
// 读取失败返回诊断串而非静默空串，便于排查跨会话启动清理误删输出文件。
  }

  /** Sync getter for ExecResult.stderr */
  getStderr(): string {
// `getStderr` 同步取 stderr；磁盘模式返回空（stderr 已交织进输出文件）。
    if (this.#disk) {
      return ''
    }
    return this.#stderrBuffer
  }

  get isOverflowed(): boolean {
    return this.#disk !== null
  }
// `isOverflowed` 标识是否已溢出到磁盘。

  get totalLines(): number {
    return this.#totalLines
  }
// `totalLines` 返回累计总行数。

  get totalBytes(): number {
    return this.#totalBytes
  }
// `totalBytes` 返回累计总字节。

  /**
   * True after getStdout() when the output file was fully read.
   * The file content is redundant (fully in ExecResult.stdout) and can be deleted.
   */
  get outputFileRedundant(): boolean {
    return this.#outputFileRedundant
  }
// `outputFileRedundant` 表示输出文件已完整读入，可删。

  /** Total file size in bytes, set after getStdout() reads the file. */
  get outputFileSize(): number {
    return this.#outputFileSize
  }
// `outputFileSize` 返回读取后记录的文件总字节。

  /** Force all buffered content to disk. Call when backgrounding. */
  spillToDisk(): void {
    if (!this.#disk) {
      this.#spillToDisk(null, null)
    }
  }
// 公开 `spillToDisk` 强制刷盘，用于后台化场景。

  async flush(): Promise<void> {
    await this.#disk?.flush()
  }
// `flush` 冲刷底层磁盘文件。

  /** Delete the output file (fire-and-forget safe). */
  async deleteOutputFile(): Promise<void> {
    try {
      await unlink(this.path)
    } catch {
      // File may already be deleted or not exist
    }
  }
// `deleteOutputFile` 删除输出文件，忽略已被删除的错误。

  clear(): void {
    this.#stdoutBuffer = ''
    this.#stderrBuffer = ''
    this.#recentLines.clear()
    this.#onProgress = null
    this.#disk?.cancel()
    TaskOutput.stopPolling(this.taskId)
    TaskOutput.#registry.delete(this.taskId)
  }
// `clear` 重置全部状态并注销轮询与注册表条目。
}
