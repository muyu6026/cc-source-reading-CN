import { appendFile, rename } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import { createBufferedWriter } from './bufferedWriter.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { sanitizePath } from './path.js'
import { jsonStringify } from './slowOperations.js'

// Mutable recording state — filePath is updated when session ID changes (e.g., --resume)
const recordingState: { filePath: string | null; timestamp: number } = {
  filePath: null,
  timestamp: 0,
}
// 录制状态挂在模块级：filePath 会随会话切换（如 --resume）而更新

/**
 * Get the asciicast recording file path.
 * For ants with CLAUDE_CODE_TERMINAL_RECORDING=1: returns a path.
 * Otherwise: returns null.
 * The path is computed once and cached in recordingState.
 */
// 取录制文件路径：仅 ant 类型且开了终端录制时返回路径，否则 null；结果缓存到 recordingState
export function getRecordFilePath(): string | null {
  if (recordingState.filePath !== null) {
    return recordingState.filePath
  }
  if (process.env.USER_TYPE !== 'ant') {
    return null
  }
  if (!isEnvTruthy(process.env.CLAUDE_CODE_TERMINAL_RECORDING)) {
    return null
  }
  // Record alongside the transcript.
  // Each launch gets its own file so --continue produces multiple recordings.
  const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
  const projectDir = join(projectsDir, sanitizePath(getOriginalCwd()))
  recordingState.timestamp = Date.now()
  recordingState.filePath = join(
    projectDir,
    `${getSessionId()}-${recordingState.timestamp}.cast`,
  )
  return recordingState.filePath
}

// 测试专用：清空录制状态
export function _resetRecordingStateForTesting(): void {
  recordingState.filePath = null
  recordingState.timestamp = 0
}

/**
 * Find all .cast files for the current session.
 * Returns paths sorted by filename (chronological by timestamp suffix).
 */
// 找出当前会话的全部 .cast 文件，按文件名（时间戳后缀）排序
export function getSessionRecordingPaths(): string[] {
  const sessionId = getSessionId()
  const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
  const projectDir = join(projectsDir, sanitizePath(getOriginalCwd()))
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- called during /share before upload, not in hot path
    const entries = getFsImplementation().readdirSync(projectDir)
    const names = (
      typeof entries[0] === 'string'
        ? entries
        : (entries as { name: string }[]).map(e => e.name)
    ) as string[]
    const files = names
      .filter(f => f.startsWith(sessionId) && f.endsWith('.cast'))
      .sort()
    return files.map(f => join(projectDir, f))
  } catch {
    return []
  }
}

/**
 * Rename the recording file to match the current session ID.
 * Called after --resume/--continue changes the session ID via switchSession().
 * The recorder was installed with the initial (random) session ID; this renames
 * the file so getSessionRecordingPaths() can find it by the resumed session ID.
 */
// 会话 ID 变化（--resume/--continue）后把录制文件改名，使其仍能被新会话 ID 找到
export async function renameRecordingForSession(): Promise<void> {
  const oldPath = recordingState.filePath
  if (!oldPath || recordingState.timestamp === 0) {
    return
  }
  const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
  const projectDir = join(projectsDir, sanitizePath(getOriginalCwd()))
  const newPath = join(
    projectDir,
    `${getSessionId()}-${recordingState.timestamp}.cast`,
  )
  if (oldPath === newPath) {
    return
  }
  // Flush pending writes before renaming
  await recorder?.flush()
  const oldName = basename(oldPath)
  const newName = basename(newPath)
  try {
    await rename(oldPath, newPath)
    recordingState.filePath = newPath
    logForDebugging(`[asciicast] Renamed recording: ${oldName} → ${newName}`)
  } catch {
    logForDebugging(
      `[asciicast] Failed to rename recording from ${oldName} to ${newName}`,
    )
  }
}

type AsciicastRecorder = {
  flush(): Promise<void>
  dispose(): Promise<void>
}

let recorder: AsciicastRecorder | null = null

// 直接读 stdout 的行列尺寸（这里不在 React 组件内）
function getTerminalSize(): { cols: number; rows: number } {
  // Direct access to stdout dimensions — not in a React component
  // eslint-disable-next-line custom-rules/prefer-use-terminal-size
  const cols = process.stdout.columns || 80
  // eslint-disable-next-line custom-rules/prefer-use-terminal-size
  const rows = process.stdout.rows || 24
  return { cols, rows }
}

/**
 * Flush pending recording data to disk.
 * Call before reading the .cast file (e.g., during /share).
 */
export async function flushAsciicastRecorder(): Promise<void> {
  await recorder?.flush()
}

/**
 * Install the asciicast recorder.
 * Wraps process.stdout.write to capture all terminal output with timestamps.
 * Must be called before Ink mounts.
 */
// 安装录制器：包住 process.stdout.write 抓取带时间戳的终端输出；须在 Ink 挂载前调用
export function installAsciicastRecorder(): void {
  const filePath = getRecordFilePath()
  if (!filePath) {
    return
  }

  const { cols, rows } = getTerminalSize()
  const startTime = performance.now()

  // Write the asciicast v2 header
  const header = jsonStringify({
    version: 2,
    width: cols,
    height: rows,
    timestamp: Math.floor(Date.now() / 1000),
    env: {
      SHELL: process.env.SHELL || '',
      TERM: process.env.TERM || '',
    },
  })
// 写 asciicast v2 协议头，记录宽高、起始时间戳与终端环境

  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- one-time init before Ink mounts
    getFsImplementation().mkdirSync(dirname(filePath))
  } catch {
    // Directory may already exist
  }
  // eslint-disable-next-line custom-rules/no-sync-fs -- one-time init before Ink mounts
  getFsImplementation().appendFileSync(filePath, header + '\n', { mode: 0o600 })

  let pendingWrite: Promise<void> = Promise.resolve()
// 用链式 Promise 把异步写串行化，避免落盘顺序乱掉

  const writer = createBufferedWriter({
    writeFn(content: string) {
      // Use recordingState.filePath (mutable) so writes follow renames from --resume
      const currentPath = recordingState.filePath
      if (!currentPath) {
        return
      }
      pendingWrite = pendingWrite
        .then(() => appendFile(currentPath, content))
        .catch(() => {
          // Silently ignore write errors — don't break the session
        })
    },
    flushIntervalMs: 500,
    maxBufferSize: 50,
    maxBufferBytes: 10 * 1024 * 1024, // 10MB
  })

  // Wrap process.stdout.write to capture output
  const originalWrite = process.stdout.write.bind(
    process.stdout,
  ) as typeof process.stdout.write
  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): boolean {
    // Record the output event
    const elapsed = (performance.now() - startTime) / 1000
    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
    writer.write(jsonStringify([elapsed, 'o', text]) + '\n')

    // Pass through to the real stdout
    if (typeof encodingOrCb === 'function') {
      return originalWrite(chunk, encodingOrCb)
    }
    return originalWrite(chunk, encodingOrCb, cb)
  } as typeof process.stdout.write
// 重写 stdout.write：把输出事件连同耗时写进录制器，再透传给真正的 stdout

  // Handle terminal resize events
  function onResize(): void {
    const elapsed = (performance.now() - startTime) / 1000
    const { cols: newCols, rows: newRows } = getTerminalSize()
    writer.write(jsonStringify([elapsed, 'r', `${newCols}x${newRows}`]) + '\n')
  }
  process.stdout.on('resize', onResize)
// 监听终端尺寸变化并记录 resize 事件

  recorder = {
    async flush(): Promise<void> {
      writer.flush()
      await pendingWrite
    },
    async dispose(): Promise<void> {
      writer.dispose()
      await pendingWrite
      process.stdout.removeListener('resize', onResize)
      process.stdout.write = originalWrite
    },
  }

  registerCleanup(async () => {
    await recorder?.dispose()
    recorder = null
  })
// 注册退出清理：释放录制器并把被替换的 stdout.write 还原

  logForDebugging(`[asciicast] Recording to ${filePath}`)
}
