import { isAbsolute, normalize } from 'path'
import { logForDebugging } from '../debug.js'
import { isENOENT } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { containsPathTraversal } from '../path.js'

const LIMITS = {
  MAX_FILE_SIZE: 512 * 1024 * 1024, // 512MB per file
  MAX_TOTAL_SIZE: 1024 * 1024 * 1024, // 1024MB total uncompressed
  MAX_FILE_COUNT: 100000, // Maximum number of files
  MAX_COMPRESSION_RATIO: 50, // Anything above 50:1 is suspicious
  MIN_COMPRESSION_RATIO: 0.5, // Below 0.5:1 might indicate already compressed malicious content
}
// 解压校验的硬上限：单文件 512MB、总解压 1GB、最多 10 万文件、压缩比 0.5 到 50 区间外都视为可疑（防 zip 炸弹）。

/**
 * State tracker for zip file validation during extraction
 */
type ZipValidationState = {
  fileCount: number
  totalUncompressedSize: number
  compressedSize: number
  errors: string[]
}
// 解压过程中的状态累加器：文件数、累计解压大小、压缩总大小、错误列表。

/**
 * File metadata from fflate filter
 */
type ZipFileMetadata = {
  name: string
  originalSize?: number
}

/**
 * Result of validating a single file in a zip archive
 */
type FileValidationResult = {
  isValid: boolean
  error?: string
}
// 单个文件校验结果：是否合法加可选的错误说明。

/**
 * Validates a file path to prevent path traversal attacks
 */
export function isPathSafe(filePath: string): boolean {
  if (containsPathTraversal(filePath)) {
    return false
  }

  // Normalize the path to resolve any '.' segments
  const normalized = normalize(filePath)

  // Check for absolute paths (we only want relative paths in archives)
  if (isAbsolute(normalized)) {
    return false
  }

  return true
}
// 路径安全检查：拒绝路径穿越与绝对路径，只允许归档里的相对路径。

/**
 * Validates a single file during zip extraction
 */
export function validateZipFile(
  file: ZipFileMetadata,
  state: ZipValidationState,
): FileValidationResult {
  state.fileCount++

  let error: string | undefined

  // Check file count
  if (state.fileCount > LIMITS.MAX_FILE_COUNT) {
    error = `Archive contains too many files: ${state.fileCount} (max: ${LIMITS.MAX_FILE_COUNT})`
  }

  // Validate path safety
  if (!isPathSafe(file.name)) {
    error = `Unsafe file path detected: "${file.name}". Path traversal or absolute paths are not allowed.`
  }

  // Check individual file size
  const fileSize = file.originalSize || 0
  if (fileSize > LIMITS.MAX_FILE_SIZE) {
    error = `File "${file.name}" is too large: ${Math.round(fileSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_FILE_SIZE / 1024 / 1024)}MB)`
  }

  // Track total uncompressed size
  state.totalUncompressedSize += fileSize

  // Check total size
  if (state.totalUncompressedSize > LIMITS.MAX_TOTAL_SIZE) {
    error = `Archive total size is too large: ${Math.round(state.totalUncompressedSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_TOTAL_SIZE / 1024 / 1024)}MB)`
  }

  // Check compression ratio for zip bomb detection
  const currentRatio = state.totalUncompressedSize / state.compressedSize
  if (currentRatio > LIMITS.MAX_COMPRESSION_RATIO) {
    error = `Suspicious compression ratio detected: ${currentRatio.toFixed(1)}:1 (max: ${LIMITS.MAX_COMPRESSION_RATIO}:1). This may be a zip bomb.`
  }
// 压缩比超过 50 比 1 即判定可疑 zip 炸弹（攻击者可借此用极小文件撑爆内存或磁盘）。

  return error ? { isValid: false, error } : { isValid: true }
}
// 逐文件校验：累计大小与文件数，命中任一项上限或路径不安全即判非法；同时顺带做炸弹检测。

/**
 * Unzips data from a Buffer and returns its contents as a record of file paths to Uint8Array data.
 * Uses unzipSync to avoid fflate worker termination crashes in bun.
 * Accepts raw zip bytes so that the caller can read the file asynchronously.
 *
 * fflate is lazy-imported to avoid its ~196KB of top-level lookup tables (revfd
 * Int32Array(32769), rev Uint16Array(32768), etc.) being allocated at startup
 * when this module is reached via the plugin loader chain.
 */
export async function unzipFile(
  zipData: Buffer,
): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = await import('fflate')
  const compressedSize = zipData.length

  const state: ZipValidationState = {
    fileCount: 0,
    totalUncompressedSize: 0,
    compressedSize: compressedSize,
    errors: [],
  }

  const result = unzipSync(new Uint8Array(zipData), {
    filter: file => {
      const validationResult = validateZipFile(file, state)
      if (!validationResult.isValid) {
// 在 fflate 的 filter 回调里逐文件校验，非法就抛错中断解压；合法才放行。
        throw new Error(validationResult.error!)
      }
      return true
    },
  })

  logForDebugging(
    `Zip extraction completed: ${state.fileCount} files, ${Math.round(state.totalUncompressedSize / 1024)}KB uncompressed`,
  )

  return result
}
// 解压入口：惰性 import fflate 避免启动期分配约 196KB 查表；解压时逐个文件校验。

/**
 * Parse Unix file modes from a zip's central directory.
 *
 * fflate's `unzipSync` returns only `Record<string, Uint8Array>` — it does not
 * surface the external file attributes stored in the central directory. This
 * means executable bits are lost during extraction (everything becomes 0644).
 * The git-clone path preserves +x natively, but the GCS/zip path needs this
 * helper to keep parity.
 *
 * Returns `name → mode` for entries created on a Unix host (`versionMadeBy`
 * high byte === 3). Entries from other hosts, or with no mode bits set, are
 * omitted. Callers should treat a missing key as "use default mode".
 *
 * Format per PKZIP APPNOTE.TXT §4.3.12 (central directory) and §4.3.16 (EOCD).
 * ZIP64 is not handled — returns `{}` on archives >4GB or >65535 entries,
 * which is fine for marketplace zips (~3.5MB) and MCPB bundles.
 */
export function parseZipModes(data: Uint8Array): Record<string, number> {
  // Buffer view for readUInt* methods — shares memory, no copy.
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const modes: Record<string, number> = {}

  // 1. Find the End of Central Directory record (sig 0x06054b50). It lives in
  //    the trailing 22 + 65535 bytes (fixed EOCD size + max comment length).
  //    Scan backwards — the EOCD is typically the last 22 bytes.
  const minEocd = Math.max(0, buf.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return modes // malformed — let fflate's error surface elsewhere

  const entryCount = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16) // central directory start offset

  // 2. Walk central directory entries (sig 0x02014b50). Each entry has a
  //    46-byte fixed header followed by variable-length name/extra/comment.
  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break
    const versionMadeBy = buf.readUInt16LE(off + 4)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const externalAttr = buf.readUInt32LE(off + 38)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)

    // versionMadeBy high byte = host OS. 3 = Unix. For Unix zips, the high
    // 16 bits of externalAttr hold st_mode (file type + permission bits).
    if (versionMadeBy >> 8 === 3) {
      const mode = (externalAttr >>> 16) & 0xffff
      if (mode) modes[name] = mode
    }

    off += 46 + nameLen + extraLen + commentLen
  }

  return modes
}
// 从 zip 中央目录解析各条目的 Unix 文件权限位（externalAttr 的高 16 位），让解压后的可执行位不丢失，与 git 克隆路径保持对齐；ZIP64 不处理（超 4GB 返回空）。

/**
 * Reads a zip file from disk asynchronously and unzips it.
 * Returns its contents as a record of file paths to Uint8Array data.
 */
export async function readAndUnzipFile(
  filePath: string,
): Promise<Record<string, Uint8Array>> {
  const fs = getFsImplementation()

  try {
    const zipData = await fs.readFileBytes(filePath)
    // await is required here: without it, rejections from the now-async
    // unzipFile() escape the try/catch and bypass the error wrapping below.
    return await unzipFile(zipData)
  } catch (error) {
    if (isENOENT(error)) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read or unzip file: ${errorMessage}`)
  }
}
// 从磁盘异步读取 zip 并解压；ENOENT 原样上抛，其余错误包成统一的中文错误信息。
