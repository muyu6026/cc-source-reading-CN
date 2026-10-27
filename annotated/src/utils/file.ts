import { chmodSync, writeFileSync as fsWriteFileSync } from 'fs'
import { realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from './debug.js'
import { isENOENT, isFsInaccessible } from './errors.js'
import {
  detectEncodingForResolvedPath,
  detectLineEndingsForString,
  type LineEndingType,
} from './fileRead.js'
import { fileReadCache } from './fileReadCache.js'
import { getFsImplementation, safeResolvePath } from './fsOperations.js'
import { logError } from './log.js'
import { expandPath } from './path.js'
import { getPlatform } from './platform.js'
// 文件总览：文件读写与路径展示的工具箱。围绕一个可替换的文件系统实现（getFsImplementation）展开，提供存在性判断、读写、编码与换行探测、行号前缀、符号链接安全写入、桌面路径解析等底层能力。

export type File = {
  filename: string
  content: string
}
// File 类型：文件名 + 内容的极简结构，是很多读写函数的内部传值形态。

/**
 * Check if a path exists asynchronously.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
// pathExists：异步判路径存在，stat 抛错即返回 false（吞掉所有错误，含权限不足）。
}

export const MAX_OUTPUT_SIZE = 0.25 * 1024 * 1024 // 0.25MB in bytes
// MAX_OUTPUT_SIZE：读文件输出上限 0.25MB（262144 字节），多处读截断都引用它。

export function readFileSafe(filepath: string): string | null {
  try {
    const fs = getFsImplementation()
    return fs.readFileSync(filepath, { encoding: 'utf8' })
  } catch (error) {
    logError(error)
    return null
  }
}
// readFileSafe：同步读文件，失败记日志并返回 null 而非抛——给「读不到就当没有」的场景用。

/**
 * Get the normalized modification time of a file in milliseconds.
 * Uses Math.floor to ensure consistent timestamp comparisons across file operations,
 * reducing false positives from sub-millisecond precision changes (e.g., from IDE
 * file watchers that touch files without changing content).
 */
export function getFileModificationTime(filePath: string): number {
  const fs = getFsImplementation()
  return Math.floor(fs.statSync(filePath).mtimeMs)
}
// getFileModificationTime：取 mtime 并向下取整到毫秒，消除 IDE 文件监听造成的亚毫秒抖动带来的误判。

/**
 * Async variant of getFileModificationTime. Same floor semantics.
 * Use this in async paths (getChangedFiles runs every turn on every readFileState
 * entry — sync statSync there triggers the slow-operation indicator on network/
 * slow disks).
 */
export async function getFileModificationTimeAsync(
  filePath: string,
): Promise<number> {
  const s = await getFsImplementation().stat(filePath)
  return Math.floor(s.mtimeMs)
}
// getFileModificationTimeAsync：异步版，同样 floor 语义；用在每轮每个文件状态检查的热路径上，避免同步 stat 触发慢盘告警。

export function writeTextContent(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  endings: LineEndingType,
): void {
  let toWrite = content
  if (endings === 'CRLF') {
    // Normalize any existing CRLF to LF first so a new_string that already
    // contains \r\n (raw model output) doesn't become \r\r\n after the join.
    toWrite = content.replaceAll('\r\n', '\n').split('\n').join('\r\n')
  }

  writeFileSyncAndFlush_DEPRECATED(filePath, toWrite, { encoding })
}
// writeTextContent：按指定编码与换行符写文本。CRLF 模式先把已有的回车换行归一化，避免重复转义变成双回车。

export function detectFileEncoding(filePath: string): BufferEncoding {
  try {
    const fs = getFsImplementation()
    const { resolvedPath } = safeResolvePath(fs, filePath)
    return detectEncodingForResolvedPath(resolvedPath)
  } catch (error) {
    if (isFsInaccessible(error)) {
      logForDebugging(
        `detectFileEncoding failed for expected reason: ${error.code}`,
        {
          level: 'debug',
        },
      )
    } else {
      logError(error)
    }
    return 'utf8'
  }
}
// detectFileEncoding：读文件探测编码；拿不到权限的错静默降级（debug 级），其余记 error，默认回退 utf8。

export function detectLineEndings(
  filePath: string,
  encoding: BufferEncoding = 'utf8',
): LineEndingType {
  try {
    const fs = getFsImplementation()
    const { resolvedPath } = safeResolvePath(fs, filePath)
    const { buffer, bytesRead } = fs.readSync(resolvedPath, { length: 4096 })

    const content = buffer.toString(encoding, 0, bytesRead)
    return detectLineEndingsForString(content)
  } catch (error) {
    logError(error)
    return 'LF'
  }
}
// detectLineEndings：只读前 4096 字节探测换行符（LF/CRLF），读不出就默认 LF。

export function convertLeadingTabsToSpaces(content: string): string {
  // The /gm regex scans every line even on no-match; skip it entirely
  // for the common tab-free case.
  if (!content.includes('\t')) return content
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length))
}
// convertLeadingTabsToSpaces：把行首制表符按宽度换成空格；无 tab 直接短路返回，避免无谓的正则全文件扫描。

export function getAbsoluteAndRelativePaths(path: string | undefined): {
  absolutePath: string | undefined
  relativePath: string | undefined
} {
  const absolutePath = path ? expandPath(path) : undefined
  const relativePath = absolutePath
    ? relative(getCwd(), absolutePath)
    : undefined
  return { absolutePath, relativePath }
}
// getAbsoluteAndRelativePaths：把输入路径展开成绝对路径，并相对 cwd 算出相对路径。

export function getDisplayPath(filePath: string): string {
  // Use relative path if file is in the current working directory
  const { relativePath } = getAbsoluteAndRelativePaths(filePath)
  if (relativePath && !relativePath.startsWith('..')) {
    return relativePath
  }

  // Use tilde notation for files in home directory
  const homeDir = homedir()
  if (filePath.startsWith(homeDir + sep)) {
    return '~' + filePath.slice(homeDir.length)
  }

  // Otherwise return the absolute path
  return filePath
}
// getDisplayPath：给用户看路径的展示规则——cwd 内用相对路径、home 下用波浪号简写、其余给绝对路径。

/**
 * Find files with the same name but different extensions in the same directory
 * @param filePath The path to the file that doesn't exist
 * @returns The found file with a different extension, or undefined if none found
 */

export function findSimilarFile(filePath: string): string | undefined {
  const fs = getFsImplementation()
  try {
    const dir = dirname(filePath)
    const fileBaseName = basename(filePath, extname(filePath))

    // Get all files in the directory
    const files = fs.readdirSync(dir)

    // Find files with the same base name but different extension
    const similarFiles = files.filter(
      file =>
        basename(file.name, extname(file.name)) === fileBaseName &&
        join(dir, file.name) !== filePath,
    )

    // Return just the filename of the first match if found
    const firstMatch = similarFiles[0]
    if (firstMatch) {
      return firstMatch.name
    }
    return undefined
  } catch (error) {
    // Missing dir (ENOENT) is expected; for other errors log and return undefined
    if (!isENOENT(error)) {
      logError(error)
    }
    return undefined
  }
}
// findSimilarFile：在同级目录找「同名异扩展名」的文件，给「文件不存在」错误做纠偏建议。

/**
 * Marker included in file-not-found error messages that contain a cwd note.
 * UI renderers check for this to show a short "File not found" message.
 */
export const FILE_NOT_FOUND_CWD_NOTE = 'Note: your current working directory is'
// FILE_NOT_FOUND_CWD_NOTE：文件未找到错误里的固定标记串，UI 用它识别是否带了 cwd 提示。

/**
 * Suggests a corrected path under the current working directory when a file/directory
 * is not found. Detects the "dropped repo folder" pattern where the model constructs
 * an absolute path missing the repo directory component.
 *
 * Example:
 *   cwd = /Users/zeeg/src/currentRepo
 *   requestedPath = /Users/zeeg/src/foobar           (doesn't exist)
 *   returns        /Users/zeeg/src/currentRepo/foobar (if it exists)
 *
 * @param requestedPath - The absolute path that was not found
 * @returns The corrected path if found under cwd, undefined otherwise
 */
export async function suggestPathUnderCwd(
  requestedPath: string,
): Promise<string | undefined> {
  const cwd = getCwd()
  const cwdParent = dirname(cwd)

  // Resolve symlinks in the requested path's parent directory (e.g., /tmp -> /private/tmp on macOS)
  // so the prefix comparison works correctly against the cwd (which is already realpath-resolved).
  let resolvedPath = requestedPath
  try {
    const resolvedDir = await realpath(dirname(requestedPath))
    resolvedPath = join(resolvedDir, basename(requestedPath))
  } catch {
    // Parent directory doesn't exist, use the original path
  }

  // Only check if the requested path is under cwd's parent but not under cwd itself.
  // When cwdParent is the root directory (e.g., '/'), use it directly as the prefix
  // to avoid a double-separator '//' that would never match.
  const cwdParentPrefix = cwdParent === sep ? sep : cwdParent + sep
  if (
    !resolvedPath.startsWith(cwdParentPrefix) ||
    resolvedPath.startsWith(cwd + sep) ||
    resolvedPath === cwd
  ) {
    return undefined
  }

  // Get the relative path from the parent directory
  const relFromParent = relative(cwdParent, resolvedPath)

  // Check if the same relative path exists under cwd
  const correctedPath = join(cwd, relFromParent)
  try {
    await stat(correctedPath)
    return correctedPath
  } catch {
    return undefined
  }
}
// suggestPathUnderCwd：纠偏「漏了仓库目录」的路径——当请求路径在 cwd 父目录下但不在 cwd 内时，把相对段拼回 cwd 并返回真实存在的那个。

/**
 * Whether to use the compact line-number prefix format (`N\t` instead of
 * `     N→`). The padded-arrow format costs 9 bytes/line overhead; at
 * 1.35B Read calls × 132 lines avg this is 2.18% of fleet uncached input
 * (bq-queries/read_line_prefix_overhead_verify.sql).
 *
 * Ant soak validated no Edit error regression (6.29% vs 6.86% baseline).
 * Killswitch pattern: GB can disable if issues surface externally.
 */
export function isCompactLinePrefixEnabled(): boolean {
  // 3P default: killswitch off = compact format enabled. Client-side only —
  // no server support needed, safe for Bedrock/Vertex/Foundry.
  return !getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_compact_line_prefix_killswitch',
    false,
  )
}
// isCompactLinePrefixEnabled：行号前缀是否用紧凑格式（N 加制表符，省每行 9 字节）。默认开，由增长实验开关可远程关闭。

/**
 * Adds cat -n style line numbers to the content.
 */
export function addLineNumbers({
  content,
  // 1-indexed
  startLine,
}: {
  content: string
  startLine: number
}): string {
  if (!content) {
    return ''
  }

  const lines = content.split(/\r?\n/)

  if (isCompactLinePrefixEnabled()) {
    return lines
      .map((line, index) => `${index + startLine}\t${line}`)
      .join('\n')
  }

  return lines
    .map((line, index) => {
      const numStr = String(index + startLine)
      if (numStr.length >= 6) {
        return `${numStr}→${line}`
      }
      return `${numStr.padStart(6, ' ')}→${line}`
    })
    .join('\n')
}
// addLineNumbers：给内容加 cat -n 风格行号。紧凑模式用制表符分隔，旧模式用六位补空格加箭头。

/**
 * Inverse of addLineNumbers — strips the `N→` or `N\t` prefix from a single
 * line. Co-located so format changes here and in addLineNumbers stay in sync.
 */
export function stripLineNumberPrefix(line: string): string {
  const match = line.match(/^\s*\d+[\u2192\t](.*)$/)
  return match?.[1] ?? line
}
// stripLineNumberPrefix：addLineNumbers 的逆操作，单行走掉行号前缀；与前者同地维护以保证格式同步。

/**
 * Checks if a directory is empty.
 * @param dirPath The path to the directory to check
 * @returns true if the directory is empty or does not exist, false otherwise
 */
export function isDirEmpty(dirPath: string): boolean {
  try {
    return getFsImplementation().isDirEmptySync(dirPath)
  } catch (e) {
    // ENOENT: directory doesn't exist, consider it empty
    // Other errors (EPERM on macOS protected folders, etc.): assume not empty
    return isENOENT(e)
  }
}
// isDirEmpty：判目录空；不存在按空算，其它错误（如 macOS 受保护目录）按非空算。

/**
 * Reads a file with caching to avoid redundant I/O operations.
 * This is the preferred method for FileEditTool operations.
 */
export function readFileSyncCached(filePath: string): string {
  const { content } = fileReadCache.readFile(filePath)
  return content
}
// readFileSyncCached：走 fileReadCache 的同步读，是 FileEditTool 推荐的读文件入口。

/**
 * Writes to a file and flushes the file to disk
 * @param filePath The path to the file to write to
 * @param content The content to write to the file
 * @param options Options for writing the file, including encoding and mode
 * @deprecated Use `fs.promises.writeFile` with flush option instead for non-blocking writes.
 * Sync file writes block the event loop and cause performance issues.
 */
export function writeFileSyncAndFlush_DEPRECATED(
  filePath: string,
  content: string,
  options: { encoding: BufferEncoding; mode?: number } = { encoding: 'utf-8' },
): void {
  const fs = getFsImplementation()

  // Check if the target file is a symlink to preserve it for all users
  // Note: We don't use safeResolvePath here because we need to manually handle
  // symlinks to ensure we write to the target while preserving the symlink itself
  let targetPath = filePath
  try {
    // Try to read the symlink - if successful, it's a symlink
    const linkTarget = fs.readlinkSync(filePath)
    // Resolve to absolute path
    targetPath = isAbsolute(linkTarget)
      ? linkTarget
      : resolve(dirname(filePath), linkTarget)
    logForDebugging(`Writing through symlink: ${filePath} -> ${targetPath}`)
  } catch {
    // ENOENT (doesn't exist) or EINVAL (not a symlink) — keep targetPath = filePath
  }

  // Try atomic write first
  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`

  // Check if target file exists and get its permissions (single stat, reused in both atomic and fallback paths)
  let targetMode: number | undefined
  let targetExists = false
  try {
    targetMode = fs.statSync(targetPath).mode
    targetExists = true
    logForDebugging(`Preserving file permissions: ${targetMode.toString(8)}`)
  } catch (e) {
    if (!isENOENT(e)) throw e
    if (options.mode !== undefined) {
      // Use provided mode for new files
      targetMode = options.mode
      logForDebugging(
        `Setting permissions for new file: ${targetMode.toString(8)}`,
      )
    }
  }

  try {
    logForDebugging(`Writing to temp file: ${tempPath}`)

    // Write to temp file with flush and mode (if specified for new file)
    const writeOptions: {
      encoding: BufferEncoding
      flush: boolean
      mode?: number
    } = {
      encoding: options.encoding,
      flush: true,
    }
    // Only set mode in writeFileSync for new files to ensure atomic permission setting
    if (!targetExists && options.mode !== undefined) {
      writeOptions.mode = options.mode
    }

    fsWriteFileSync(tempPath, content, writeOptions)
    logForDebugging(
      `Temp file written successfully, size: ${content.length} bytes`,
    )

    // For existing files or if mode was not set atomically, apply permissions
    if (targetExists && targetMode !== undefined) {
      chmodSync(tempPath, targetMode)
      logForDebugging(`Applied original permissions to temp file`)
    }

    // Atomic rename (on POSIX systems, this is atomic)
    // On Windows, this will overwrite the destination if it exists
    logForDebugging(`Renaming ${tempPath} to ${targetPath}`)
    fs.renameSync(tempPath, targetPath)
    logForDebugging(`File ${targetPath} written atomically`)
  } catch (atomicError) {
    logForDebugging(`Failed to write file atomically: ${atomicError}`, {
      level: 'error',
    })
    logEvent('tengu_atomic_write_error', {})

    // Clean up temp file on error
    try {
      logForDebugging(`Cleaning up temp file: ${tempPath}`)
      fs.unlinkSync(tempPath)
    } catch (cleanupError) {
      logForDebugging(`Failed to clean up temp file: ${cleanupError}`)
    }

    // Fallback to non-atomic write
    logForDebugging(`Falling back to non-atomic write for ${targetPath}`)
    try {
      const fallbackOptions: {
        encoding: BufferEncoding
        flush: boolean
        mode?: number
      } = {
        encoding: options.encoding,
        flush: true,
      }
      // Only set mode for new files
      if (!targetExists && options.mode !== undefined) {
        fallbackOptions.mode = options.mode
      }

      fsWriteFileSync(targetPath, content, fallbackOptions)
      logForDebugging(
        `File ${targetPath} written successfully with non-atomic fallback`,
      )
    } catch (fallbackError) {
      logForDebugging(`Non-atomic write also failed: ${fallbackError}`)
      throw fallbackError
    }
  }
}
// writeFileSyncAndFlush_DEPRECATED：同步写文件并刷盘（已废弃，因阻塞事件循环）。先尝试「写临时文件 + 改名」的原子写并保留原权限与符号链接，失败再回退非原子写。

export function getDesktopPath(): string {
  const platform = getPlatform()
  const homeDir = homedir()

  if (platform === 'macos') {
    return join(homeDir, 'Desktop')
  }

  if (platform === 'windows') {
    // For WSL, try to access Windows desktop
    const windowsHome = process.env.USERPROFILE
      ? process.env.USERPROFILE.replace(/\\/g, '/')
      : null

    if (windowsHome) {
      const wslPath = windowsHome.replace(/^[A-Z]:/, '')
      const desktopPath = `/mnt/c${wslPath}/Desktop`

      if (getFsImplementation().existsSync(desktopPath)) {
        return desktopPath
      }
    }

    // Fallback: try to find desktop in typical Windows user location
    try {
      const usersDir = '/mnt/c/Users'
      const userDirs = getFsImplementation().readdirSync(usersDir)

      for (const user of userDirs) {
        if (
          user.name === 'Public' ||
          user.name === 'Default' ||
          user.name === 'Default User' ||
          user.name === 'All Users'
        ) {
          continue
        }

        const potentialDesktopPath = join(usersDir, user.name, 'Desktop')

        if (getFsImplementation().existsSync(potentialDesktopPath)) {
          return potentialDesktopPath
        }
      }
    } catch (error) {
      logError(error)
    }
  }

  // Linux/unknown platform fallback
  const desktopPath = join(homeDir, 'Desktop')
  if (getFsImplementation().existsSync(desktopPath)) {
    return desktopPath
  }

  // If Desktop folder doesn't exist, fallback to home directory
  return homeDir
}
// getDesktopPath：跨平台找桌面目录。macOS 直接用 ~/Desktop；Windows/WSL 要拼 /mnt/c/用户/Desktop 并枚举用户目录；找不到回退 home。

/**
 * Validates that a file size is within the specified limit.
 * Returns true if the file is within the limit, false otherwise.
 *
 * @param filePath The path to the file to validate
 * @param maxSizeBytes The maximum allowed file size in bytes
 * @returns true if file size is within limit, false otherwise
 */
export function isFileWithinReadSizeLimit(
  filePath: string,
  maxSizeBytes: number = MAX_OUTPUT_SIZE,
): boolean {
  try {
    const stats = getFsImplementation().statSync(filePath)
    return stats.size <= maxSizeBytes
  } catch {
    // If we can't stat the file, return false to indicate validation failure
    return false
  }
}
// isFileWithinReadSizeLimit：判文件是否超过读取大小上限（默认 0.25MB）；stat 不到直接算不通过。

/**
 * Normalize a file path for comparison, handling platform differences.
 * On Windows, normalizes path separators and converts to lowercase for
 * case-insensitive comparison.
 */
export function normalizePathForComparison(filePath: string): string {
  // Use path.normalize() to clean up redundant separators and resolve . and ..
  let normalized = normalize(filePath)

  // On Windows, normalize for case-insensitive comparison:
  // - Convert forward slashes to backslashes (path.normalize only does this on actual Windows)
  // - Convert to lowercase (Windows paths are case-insensitive)
  if (getPlatform() === 'windows') {
    normalized = normalized.replace(/\//g, '\\').toLowerCase()
  }

  return normalized
}
// normalizePathForComparison：路径归一化用于比较。Windows 上把斜杠统一成反斜杠并转小写（大小写不敏感）。

/**
 * Compare two file paths for equality, handling Windows case-insensitivity.
 */
export function pathsEqual(path1: string, path2: string): boolean {
  return normalizePathForComparison(path1) === normalizePathForComparison(path2)
}
// pathsEqual：两个路径是否相等，内部走 normalizePathForComparison，自动处理 Windows 大小写不敏感。
