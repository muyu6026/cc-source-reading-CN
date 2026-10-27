// 文件级：本文件负责把后台任务与子进程的输出异步落盘，核心是一个带写入队列与 5GB 磁盘上限的 `DiskTaskOutput` 类，并提供符号链接防护与测试专用的清理辅助函数。
import { constants as fsConstants } from 'fs'
import {
  type FileHandle,
  mkdir,
  open,
  stat,
  symlink,
  unlink,
} from 'fs/promises'
import { join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { getErrnoCode } from '../errors.js'
import { readFileRange, tailFile } from '../fsOperations.js'
import { logError } from '../log.js'
import { getProjectTempDir } from '../permissions/filesystem.js'

// SECURITY: O_NOFOLLOW prevents following symlinks when opening task output files.
// Without this, an attacker in the sandbox could create symlinks in the tasks directory
// pointing to arbitrary files, causing Claude Code on the host to write to those files.
// O_NOFOLLOW is not available on Windows, but the sandbox attack vector is Unix-only.
// 安全注释：用 `O_NOFOLLOW` 标志打开输出文件，防止沙箱里的攻击者用符号链接把宿主的写入重定向到任意文件；该标志只在 Unix 上可用，Windows 不存在这个攻击面。
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
// 把 `O_NOFOLLOW` 取出，Windows 上取不到就退化为 0，不影响逻辑。

const DEFAULT_MAX_READ_BYTES = 8 * 1024 * 1024 // 8MB
// `DEFAULT_MAX_READ_BYTES`：单次读取任务输出时的默认上限 8MB，避免一次把超大文件读进内存。

/**
 * Disk cap for task output files. In file mode (bash), a watchdog polls
 * file size and kills the process. In pipe mode (hooks), DiskTaskOutput
 * drops chunks past this limit. Shared so both caps stay in sync.
 */
export const MAX_TASK_OUTPUT_BYTES = 5 * 1024 * 1024 * 1024
// `MAX_TASK_OUTPUT_BYTES`：任务输出文件的磁盘硬上限 5GB；文件模式靠看门狗轮询杀进程，管道模式靠丢超出部分的块，两处共用保证一致。
export const MAX_TASK_OUTPUT_BYTES_DISPLAY = '5GB'
// `MAX_TASK_OUTPUT_BYTES_DISPLAY`：给人看的容量显示串，就是 `5GB`。

/**
 * Get the task output directory for this session.
 * Uses project temp directory so reads are auto-allowed by checkReadableInternalPath.
 *
 * The session ID is included so concurrent sessions in the same project don't
 * clobber each other's output files. Startup cleanup in one session previously
 * unlinked in-flight output files from other sessions — the writing process's fd
 * keeps the inode alive but reads via path fail ENOENT, and getStdout() returned
 * empty string (inc-4586 / boris-20260309-060423).
 *
 * The session ID is captured at FIRST CALL, not re-read on every invocation.
 * /clear calls regenerateSessionId(), which would otherwise cause
 * ensureOutputDir() to create a new-session path while existing TaskOutput
 * instances still hold old-session paths — open() would ENOENT. Background
 * bash tasks surviving /clear need their output files to stay reachable.
 */
let _taskOutputDir: string | undefined
export function getTaskOutputDir(): string {
  if (_taskOutputDir === undefined) {
    _taskOutputDir = join(getProjectTempDir(), getSessionId(), 'tasks')
  }
  return _taskOutputDir
}
// `getTaskOutputDir`：返回本会话的任务输出目录，拼在工程临时目录加会话 ID 加 `tasks` 之下；带会话 ID 是为了并发会话互不覆盖。

/** Test helper — clears the memoized dir. */
export function _resetTaskOutputDirForTest(): void {
  _taskOutputDir = undefined
}
// `_resetTaskOutputDirForTest`：测试辅助，清空记忆化的目录，让下一次调用重新计算。

/**
 * Ensure the task output directory exists
 */
// `ensureOutputDir`：确保任务输出目录存在，递归创建父目录。
async function ensureOutputDir(): Promise<void> {
  await mkdir(getTaskOutputDir(), { recursive: true })
}

/**
 * Get the output file path for a task
 */
// `getTaskOutputPath`：根据任务 ID 算出输出文件路径，命名规则是 `任务ID.output`。
export function getTaskOutputPath(taskId: string): string {
  return join(getTaskOutputDir(), `${taskId}.output`)
}

// Tracks fire-and-forget promises (initTaskOutput, initTaskOutputAsSymlink,
// evictTaskOutput, #drain) so tests can drain before teardown. Prevents the
// async-ENOENT-after-teardown flake class (#24957, #25065): a voided async
// resumes after preload's afterEach nuked the temp dir → ENOENT → unhandled
// rejection → flaky test failure. allSettled so a rejection doesn't short-
// circuit the drain and leave other ops racing the rmSync.
const _pendingOps = new Set<Promise<unknown>>()
function track<T>(p: Promise<T>): Promise<T> {
  _pendingOps.add(p)
  void p.finally(() => _pendingOps.delete(p)).catch(() => {})
  return p
}
// `track`：把所有即发即弃的异步操作登记进 `_pendingOps`，测试可在拆卸前把它们排空，避免异步 ENOENT 抖动；用 `allSettled` 保证一个失败也不会中断其他操作的排空。

/**
 * Encapsulates async disk writes for a single task's output.
 *
 * Uses a flat array as a write queue processed by a single drain loop,
 * so each chunk can be GC'd immediately after its write completes.
 * This avoids the memory retention problem of chained .then() closures
 * where every reaction captures its data until the whole chain resolves.
 */
// `DiskTaskOutput`：单个任务输出的异步落盘封装，内部用扁平数组当写入队列、由单一排空循环消费，每块写完后立刻可被 GC 回收，避免链式 `then` 闭包长期持有数据导致内存膨胀。
export class DiskTaskOutput {
  #path: string
  #fileHandle: FileHandle | null = null
  #queue: string[] = []
  #bytesWritten = 0
  #capped = false
  #flushPromise: Promise<void> | null = null
  #flushResolve: (() => void) | null = null

  constructor(taskId: string) {
    this.#path = getTaskOutputPath(taskId)
  }
// 构造函数只记下输出文件路径，真正的文件句柄延迟到第一次写入才打开。

  append(content: string): void {
    if (this.#capped) {
      return
    }
    // content.length (UTF-16 code units) undercounts UTF-8 bytes by at most ~3×.
    // Acceptable for a coarse disk-fill guard — avoids re-scanning every chunk.
    this.#bytesWritten += content.length
    if (this.#bytesWritten > MAX_TASK_OUTPUT_BYTES) {
      this.#capped = true
      this.#queue.push(
        `\n[output truncated: exceeded ${MAX_TASK_OUTPUT_BYTES_DISPLAY} disk cap]\n`,
      )
    } else {
      this.#queue.push(content)
    }
    if (!this.#flushPromise) {
      this.#flushPromise = new Promise<void>(resolve => {
        this.#flushResolve = resolve
      })
      void track(this.#drain())
    }
  }
// `append`：把新内容推入队列并累加已写字节；超过 5GB 上限就封顶并塞入一句截断提示，之后不再接收内容。首次入队时启动排空循环并准备好 `flush` 承诺。

  flush(): Promise<void> {
    return this.#flushPromise ?? Promise.resolve()
  }
// `flush`：返回排空完成的承诺，还没启动时就是已兑现的空承诺。

  cancel(): void {
    this.#queue.length = 0
  }
// `cancel`：把队列清空（丢弃未写内容），用于任务被取消时。

// `#drainAllChunks`：真正的排空循环，确保目录与文件句柄就绪后反复把队列写光；文件句柄在循环末尾关闭，关闭后若队列又有新内容则重新打开再写，直到彻底排空。
  async #drainAllChunks(): Promise<void> {
    while (true) {
      try {
        if (!this.#fileHandle) {
          await ensureOutputDir()
          this.#fileHandle = await open(
            this.#path,
            process.platform === 'win32'
              ? 'a'
              : fsConstants.O_WRONLY |
                  fsConstants.O_APPEND |
                  fsConstants.O_CREAT |
                  O_NOFOLLOW,
          )
        }
        while (true) {
          await this.#writeAllChunks()
          if (this.#queue.length === 0) {
            break
          }
        }
      } finally {
        if (this.#fileHandle) {
          const fileHandle = this.#fileHandle
          this.#fileHandle = null
          await fileHandle.close()
        }
      }
      // you could have another .append() while we're waiting for the file to close, so we check the queue again before fully exiting
      if (this.#queue.length) {
        continue
      }

      break
    }
  }

// `#writeAllChunks`：把整段队列一次性交付给 `appendFile`，刻意不加 `await`（加在调用方才安全），否则队列增长时内存会暴涨。
  #writeAllChunks(): Promise<void> {
    // This code is extremely precise.
    // You **must not** add an await here!! That will cause memory to balloon as the queue grows.
    // It's okay to add an `await` to the caller of this method (e.g. #drainAllChunks) because that won't cause Buffer[] to be kept alive in memory.
    return this.#fileHandle!.appendFile(
      // This variable needs to get GC'd ASAP.
      this.#queueToBuffers(),
    )
  }

  /** Keep this in a separate method so that GC doesn't keep it alive for any longer than it should. */
// `#queueToBuffers`：把队列内容一次性切成 `Buffer` 并就地清空数组，单独成方法是为了让 GC 尽早回收，不长期持有队列。
  #queueToBuffers(): Buffer {
    // Use .splice to in-place mutate the array, informing the GC it can free it.
    const queue = this.#queue.splice(0, this.#queue.length)
// 用 `splice` 原地取出整段队列，等于告诉 GC 这段可以被释放。

    let totalLength = 0
    for (const str of queue) {
      totalLength += Buffer.byteLength(str, 'utf8')
    }

    const buffer = Buffer.allocUnsafe(totalLength)
    let offset = 0
    for (const str of queue) {
      offset += buffer.write(str, offset, 'utf8')
    }

    return buffer
  }

// `#drain`：驱动排空的主方法，遇到瞬时文件系统错误（CI 繁忙时的 EMFILE、Windows 待删时的 EPERM）先记录日志并重试一次，队列完好就再排一次，否则放弃。
  async #drain(): Promise<void> {
    try {
      await this.#drainAllChunks()
    } catch (e) {
      // Transient fs errors (EMFILE on busy CI, EPERM on Windows pending-
      // delete) previously rode up through `void this.#drain()` as an
      // unhandled rejection while the flush promise resolved anyway — callers
      // saw an empty file with no error. Retry once for the transient case
      // (queue is intact if open() failed), then log and give up.
      logError(e)
      if (this.#queue.length > 0) {
        try {
          await this.#drainAllChunks()
        } catch (e2) {
          logError(e2)
        }
      }
    } finally {
      const resolve = this.#flushResolve!
      this.#flushPromise = null
      this.#flushResolve = null
      resolve()
    }
  }
}
// 无论成功失败，都在 `finally` 里兑现 `flush` 承诺并清空状态，让等待刷新的调用方解除阻塞。

const outputs = new Map<string, DiskTaskOutput>()
// `outputs`：任务 ID 到 `DiskTaskOutput` 实例的内存映射，保证同一任务复用同一份落盘状态。

/**
 * Test helper — cancel pending writes, await in-flight ops, clear the map.
 * backgroundShells.test.ts and other task tests spawn real shells that
 * write through this module without afterEach cleanup; their entries
 * leak into diskOutput.test.ts on the same shard.
 *
 * Awaits all tracked promises until the set stabilizes — a settling promise
 * may spawn another (initTaskOutputAsSymlink's catch → initTaskOutput).
 * Call this in afterEach BEFORE rmSync to avoid async-ENOENT-after-teardown.
 */
// `_clearOutputsForTest`：测试辅助，取消待写、等所有进行中操作落定再清空映射，必须在 `rmSync` 之前调用以免异步 ENOENT。
export async function _clearOutputsForTest(): Promise<void> {
  for (const output of outputs.values()) {
    output.cancel()
  }
  while (_pendingOps.size > 0) {
    await Promise.allSettled([..._pendingOps])
  }
  outputs.clear()
}

// `getOrCreateOutput`：从映射里取已有实例，没有就新建一个并登记。
function getOrCreateOutput(taskId: string): DiskTaskOutput {
  let output = outputs.get(taskId)
  if (!output) {
    output = new DiskTaskOutput(taskId)
    outputs.set(taskId, output)
  }
  return output
}

/**
 * Append output to a task's disk file asynchronously.
 * Creates the file if it doesn't exist.
 */
// `appendTaskOutput`：对外入口，把内容追加到某任务的磁盘文件，文件不存在就创建。
export function appendTaskOutput(taskId: string, content: string): void {
  getOrCreateOutput(taskId).append(content)
}

/**
 * Wait for all pending writes for a task to complete.
 * Useful before reading output to ensure all data is flushed.
 */
// `flushTaskOutput`：等待某任务所有待写内容落盘，适合在读输出前调用以保证数据完整。
export async function flushTaskOutput(taskId: string): Promise<void> {
  const output = outputs.get(taskId)
  if (output) {
    await output.flush()
  }
}

/**
 * Evict a task's DiskTaskOutput from the in-memory map after flushing.
 * Unlike cleanupTaskOutput, this does not delete the output file on disk.
 * Call this when a task completes and its output has been consumed.
 */
// `evictTaskOutput`：刷新后把实例从内存映射移除，但不删磁盘文件；任务结束且输出已被消费时调用。
export function evictTaskOutput(taskId: string): Promise<void> {
  return track(
    (async () => {
      const output = outputs.get(taskId)
      if (output) {
        await output.flush()
        outputs.delete(taskId)
      }
    })(),
  )
}

/**
 * Get delta (new content) since last read.
 * Reads only from the byte offset, up to maxBytes — never loads the full file.
 */
// `getTaskOutputDelta`：按字节偏移读取增量新内容，最多读 `maxBytes`，绝不把整个文件载入内存；文件不存在按空内容处理。
export async function getTaskOutputDelta(
  taskId: string,
  fromOffset: number,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<{ content: string; newOffset: number }> {
  try {
    const result = await readFileRange(
      getTaskOutputPath(taskId),
      fromOffset,
      maxBytes,
    )
    if (!result) {
      return { content: '', newOffset: fromOffset }
    }
    return {
      content: result.content,
      newOffset: fromOffset + result.bytesRead,
    }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return { content: '', newOffset: fromOffset }
    }
    logError(e)
    return { content: '', newOffset: fromOffset }
  }
}

/**
 * Get output for a task, reading the tail of the file.
 * Caps at maxBytes to avoid loading multi-GB files into memory.
 */
// `getTaskOutput`：读任务输出的尾部，超过上限就省略较早部分并提示被省略了多少 KB；文件不存在返回空串。
export async function getTaskOutput(
  taskId: string,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<string> {
  try {
    const { content, bytesTotal, bytesRead } = await tailFile(
      getTaskOutputPath(taskId),
      maxBytes,
    )
    if (bytesTotal > bytesRead) {
      return `[${Math.round((bytesTotal - bytesRead) / 1024)}KB of earlier output omitted]\n${content}`
    }
    return content
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return ''
    }
    logError(e)
    return ''
  }
}

/**
 * Get the current size (offset) of a task's output file.
 */
// `getTaskOutputSize`：返回任务输出文件当前大小（字节偏移），文件不存在按 0 处理。
export async function getTaskOutputSize(taskId: string): Promise<number> {
  try {
    return (await stat(getTaskOutputPath(taskId))).size
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return 0
    }
    logError(e)
    return 0
  }
}

/**
 * Clean up a task's output file and write queue.
 */
// `cleanupTaskOutput`：取消写入队列并删掉磁盘输出文件，文件不存在则忽略。
export async function cleanupTaskOutput(taskId: string): Promise<void> {
  const output = outputs.get(taskId)
  if (output) {
    output.cancel()
    outputs.delete(taskId)
  }

  try {
    await unlink(getTaskOutputPath(taskId))
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return
    }
    logError(e)
  }
}

/**
 * Initialize output file for a new task.
 * Creates an empty file to ensure the path exists.
 */
// `initTaskOutput`：为新任务创建空的输出文件占位，用 `O_EXCL` 保证只建新文件、路径已存在就失败；Windows 改用字符串标志避免 `EINVAL`。
export function initTaskOutput(taskId: string): Promise<string> {
  return track(
    (async () => {
      await ensureOutputDir()
      const outputPath = getTaskOutputPath(taskId)
      // SECURITY: O_NOFOLLOW prevents symlink-following attacks from the sandbox.
      // O_EXCL ensures we create a new file and fail if something already exists at this path.
      // On Windows, use string flags — numeric O_EXCL can produce EINVAL through libuv.
      const fh = await open(
        outputPath,
        process.platform === 'win32'
          ? 'wx'
          : fsConstants.O_WRONLY |
              fsConstants.O_CREAT |
              fsConstants.O_EXCL |
              O_NOFOLLOW,
      )
      await fh.close()
      return outputPath
    })(),
  )
}

/**
 * Initialize output file as a symlink to another file (e.g., agent transcript).
 * Tries to create the symlink first; if a file already exists, removes it and retries.
 */
// `initTaskOutputAsSymlink`：把输出文件建成指向另一文件（如智能体转录）的符号链接，先试建、已存在就删了重试；失败则回退成普通文件初始化。
export function initTaskOutputAsSymlink(
  taskId: string,
  targetPath: string,
): Promise<string> {
  return track(
    (async () => {
      try {
        await ensureOutputDir()
        const outputPath = getTaskOutputPath(taskId)

        try {
          await symlink(targetPath, outputPath)
        } catch {
          await unlink(outputPath)
          await symlink(targetPath, outputPath)
        }

        return outputPath
      } catch (error) {
        logError(error)
        return initTaskOutput(taskId)
      }
    })(),
  )
}
