// ═══════════════════════════════════════════════════════════════
//  api/filesApi：Files API 的下载 / 上传（BYOC 模式的底座）
// ═══════════════════════════════════════════════════════════════
//
//  748 行，看起来是「一堆 HTTP 调用」，实际上有三件事值得单独看：
//
//      第 87 行   RetryResult —— 把「要不要重试」变成数据而不是异常
//      第 187 行  buildDownloadPath —— 一个必须防路径穿越的落盘路径
//      第 280 行  parallelWithLimit —— 30 行手写的并发池
//
//  这三个都是「看起来很基础、但自己写常常写错」的东西。
/**
 * Files API client for managing files
 *
 * This module provides functionality to download and upload files to Anthropic Public Files API.
 * Used by the Claude Code agent to download file attachments at session startup.
 *
 * API Reference: https://docs.anthropic.com/en/api/files-content
 */

import axios from 'axios'
import { randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { count } from '../../utils/array.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

// Files API is currently in beta. oauth-2025-04-20 enables Bearer OAuth
// on public-api routes (auth.py: "oauth_auth" not in beta_versions → 404).
// 【两个 beta 头拼在一个字符串里，而且顺序固定】
//
//      'files-api-2025-04-14,oauth-2025-04-20'
//
//  anthropic-beta 头支持逗号分隔的多个版本标识。所以这里同时声明了
//  「我要用 files-api」和「我要用 oauth」两个 beta 能力。
//
//  注意版本号是日期（2025-04-14）—— 这是 beta 接口的惯例：**按日期切片**，
//  而不是按语义版本。好处是服务端可以同时支持多个历史版本的调用方，
//  坏处是客户端必须硬编码日期，永远不知道「最新是哪个」。
//
//  所以升级 beta 版本永远是一次手动改动，而且必须与服务端确认。
//  这类硬编码日期在本仓库里出现很多次 —— 它们都是「有意的钉子」。
const FILES_API_BETA_HEADER = 'files-api-2025-04-14,oauth-2025-04-20'
const ANTHROPIC_VERSION = '2023-06-01'

// API base URL - uses ANTHROPIC_BASE_URL set by env-manager for the appropriate environment
// Falls back to public API for standalone usage
function getDefaultApiBaseUrl(): string {
  return (
    process.env.ANTHROPIC_BASE_URL ||
    process.env.CLAUDE_CODE_API_BASE_URL ||
    'https://api.anthropic.com'
  )
}

function logDebugError(message: string): void {
  logForDebugging(`[files-api] ${message}`, { level: 'error' })
}

function logDebug(message: string): void {
  logForDebugging(`[files-api] ${message}`)
}

/**
 * File specification parsed from CLI args
 * Format: --file=<file_id>:<relative_path>
 */
export type File = {
  fileId: string
  relativePath: string
}

/**
 * Configuration for the files API client
 */
export type FilesApiConfig = {
  /** OAuth token for authentication (from session JWT) */
  oauthToken: string
  /** Base URL for the API (default: https://api.anthropic.com) */
  baseUrl?: string
  /** Session ID for creating session-specific directories */
  sessionId: string
}

/**
 * Result of a file download operation
 */
export type DownloadResult = {
  fileId: string
  path: string
  success: boolean
  error?: string
  bytesWritten?: number
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024 // 500MB

/**
 * Result type for retry operations - signals whether to continue retrying
 */
// 【RetryResult：把「这次该不该重试」变成返回值，而不是靠抛异常】
//
//      { done: true; value: T } | { done: false; error?: string }
//
//  这个设计解决了一个很实际的问题：**有些失败该重试，有些不该，而这个
//  判断只有 attemptFn 内部知道。**
//
//  看下面的 downloadFile（第 147 行）就明白了：
//
//      200       →  done: true
//      404/401/403 →  throw（不该重试，直接冒泡）
//      其他 4xx/5xx →  { done: false }（该重试）
//
//  如果统一用抛异常，那 retryWithBackoff 就必须自己解析错误码来决定
//  重不重试 —— 而错误码是业务知识，属于 attemptFn。
//
//  所以这里的分工是：**attemptFn 决定「能不能重试」，retryWithBackoff
//  负责「怎么重试」。** 用返回值区分这两件事，比用异常类型干净得多。
//
//  判据：当「控制流」本身就是信息（继续 / 停止），让它成为返回值的一部分，
//  而不是靠异常的副作用。
type RetryResult<T> = { done: true; value: T } | { done: false; error?: string }

/**
 * Executes an operation with exponential backoff retry logic
 *
 * @param operation - Operation name for logging
 * @param attemptFn - Function to execute on each attempt, returns RetryResult
 * @returns The successful result value
 * @throws Error if all retries exhausted
 */
// 【三行常量定义了全部重试策略】
//
//      MAX_RETRIES = 3
//      BASE_DELAY_MS = 500         →  500ms / 1000ms / 2000ms
//
//  延迟是 BASE * 2^(attempt-1)，也就是标准指数退避，没有抖动（jitter）。
//
//  为什么这里敢不加抖动？因为重试次数只有 3、总量小，而且这些请求不是
//  「同一时刻成千上万客户端一起打」的场景（那是服务端要考虑的）。
//  **抖动是为了打散并发峰值，客户端单用户工具通常不需要。**
//
//  另外注意没有「最大延迟上限」—— 因为 3 次最多也就退到 2 秒，
//  加上限属于多余防御。**参数要与规模匹配，不要照抄模板。**
async function retryWithBackoff<T>(
  operation: string,
  attemptFn: (attempt: number) => Promise<RetryResult<T>>,
): Promise<T> {
  let lastError = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await attemptFn(attempt)

    if (result.done) {
      return result.value
    }

    lastError = result.error || `${operation} failed`
    logDebug(
      `${operation} attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`,
    )

    if (attempt < MAX_RETRIES) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      logDebug(`Retrying ${operation} in ${delayMs}ms...`)
      await sleep(delayMs)
    }
  }

  throw new Error(`${lastError} after ${MAX_RETRIES} attempts`)
}

/**
 * Downloads a single file from the Anthropic Public Files API
 *
 * @param fileId - The file ID (e.g., "file_011CNha8iCJcU1wXNR6q4V8w")
 * @param config - Files API configuration
 * @returns The file content as a Buffer
 */
export async function downloadFile(
  fileId: string,
  config: FilesApiConfig,
): Promise<Buffer> {
  const baseUrl = config.baseUrl || getDefaultApiBaseUrl()
  const url = `${baseUrl}/v1/files/${fileId}/content`

  const headers = {
    Authorization: `Bearer ${config.oauthToken}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': FILES_API_BETA_HEADER,
  }

  logDebug(`Downloading file ${fileId} from ${url}`)

  return retryWithBackoff(`Download file ${fileId}`, async () => {
    try {
      const response = await axios.get(url, {
        headers,
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout for large files
//       // 【validateStatus: status => status < 500 —— 这一行改变了整个错误模型】
//       //
//       //  axios 默认对 >= 400 直接抛错。设了这个之后，4xx 会正常返回响应，
//       //  于是下面就可以**按状态码分支**，而不是在 catch 里猜。
//       //
//       //  这带来的好处很具体：
//       //
//       //      404 → 抛（文件不存在，重试没用）
//       //      401 → 抛（认证失败，重试没用）
//       //      403 → 抛（没权限，重试没用）
//       //      429 → 返回 done:false（限流，该重试）
//       //      5xx → 由 axios 抛 → catch 里转成 done:false（该重试）
//       //
//       //  注意 5xx 走的是 catch 那条路（因为 `status < 500` 不包含 5xx），
//       //  而 catch 里先判断 `axios.isAxiosError`，不是 axios 错误就原样抛 ——
//       //  这样「我们自己 throw 的 404/401/403」不会被 catch 吞掉。
//       //
//       //  这一套「先分流、再在 catch 里区分来源」的写法容易写错，
//       //  读的时候一定要把两个分支对照着看。
        validateStatus: status => status < 500,
      })

      if (response.status === 200) {
        logDebug(`Downloaded file ${fileId} (${response.data.length} bytes)`)
        return { done: true, value: Buffer.from(response.data) }
      }

      // Non-retriable errors - throw immediately
      if (response.status === 404) {
        throw new Error(`File not found: ${fileId}`)
      }
      if (response.status === 401) {
        throw new Error('Authentication failed: invalid or missing API key')
      }
      if (response.status === 403) {
        throw new Error(`Access denied to file: ${fileId}`)
      }

      return { done: false, error: `status ${response.status}` }
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        throw error
      }
      return { done: false, error: error.message }
    }
  })
}

/**
 * Normalizes a relative path, strips redundant prefixes, and builds the full
 * download path under {basePath}/{session_id}/uploads/.
 * Returns null if the path is invalid (e.g., path traversal).
 */
// 【buildDownloadPath：一个必须自己防穿越的落盘路径】
//
//  输入是「附件里的相对路径」（可能是远端给的），输出是磁盘上的绝对路径。
//  中间只有一道检查：
//
//      const normalized = path.normalize(relativePath)
//      if (normalized.startsWith('..')) return null
//
//  为什么这一句就够？因为 path.normalize 会先把 `a/../../b` 折叠成 `../b`，
//  而折叠之后如果**以 .. 开头**，就说明它逃出了基准目录。
//
//  这是防穿越的标准做法：**先规范化，再看开头**。如果顺序反了
//  （先看开头再 normalize），`foo/../../../etc/passwd` 这种就能绕过。
//
//  返回 null 而不是抛错，因为「附件路径非法」是可以跳过的单条数据 ——
//  一个坏路径不该让整批下载失败。
//
//  注意第 192 行那句注释（Returns null if the path is invalid (e.g., path
//  traversal)）把它写在了 JSDoc 里，也就是**把这个防御写进了公开契约**。
export function buildDownloadPath(
  basePath: string,
  sessionId: string,
  relativePath: string,
): string | null {
  const normalized = path.normalize(relativePath)
  if (normalized.startsWith('..')) {
    logDebugError(
      `Invalid file path: ${relativePath}. Path must not traverse above workspace`,
    )
    return null
  }

  const uploadsBase = path.join(basePath, sessionId, 'uploads')
  const redundantPrefixes = [
    path.join(basePath, sessionId, 'uploads') + path.sep,
    path.sep + 'uploads' + path.sep,
  ]
  const matchedPrefix = redundantPrefixes.find(p => normalized.startsWith(p))
  const cleanPath = matchedPrefix
    ? normalized.slice(matchedPrefix.length)
    : normalized
  return path.join(uploadsBase, cleanPath)
}

/**
 * Downloads a file and saves it to the session-specific workspace directory
 *
 * @param attachment - The file attachment to download
 * @param config - Files API configuration
 * @returns Download result with success/failure status
 */
export async function downloadAndSaveFile(
  attachment: File,
  config: FilesApiConfig,
): Promise<DownloadResult> {
  const { fileId, relativePath } = attachment
  const fullPath = buildDownloadPath(getCwd(), config.sessionId, relativePath)

  if (!fullPath) {
    return {
      fileId,
      path: '',
      success: false,
      error: `Invalid file path: ${relativePath}`,
    }
  }

  try {
    // Download the file content
    const content = await downloadFile(fileId, config)

    // Ensure the parent directory exists
    const parentDir = path.dirname(fullPath)
    await fs.mkdir(parentDir, { recursive: true })

    // Write the file
    await fs.writeFile(fullPath, content)

    logDebug(`Saved file ${fileId} to ${fullPath} (${content.length} bytes)`)

    return {
      fileId,
      path: fullPath,
      success: true,
      bytesWritten: content.length,
    }
  } catch (error) {
    logDebugError(`Failed to download file ${fileId}: ${errorMessage(error)}`)
    if (error instanceof Error) {
      logError(error)
    }

    return {
      fileId,
      path: fullPath,
      success: false,
      error: errorMessage(error),
    }
  }
}

// Default concurrency limit for parallel downloads
const DEFAULT_CONCURRENCY = 5

/**
 * Execute promises with limited concurrency
 *
 * @param items - Items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum concurrent operations
 * @returns Results in the same order as input items
 */
// 【30 行手写并发池 —— 为什么不用现成的库】
//
//  核心是「N 个 worker 抢一个共享游标」：
//
//      while (currentIndex < items.length) {
//        const index = currentIndex++     ← 这一句是原子的（单线程）
//        results[index] = await fn(item, index)
//      }
//
//  JS 是单线程，`currentIndex++` 之间不会被打断，所以不需要锁。
//  每个 worker 拿到一个下标就去干活，干完回来再抢下一个。
//
//  三个细节：
//
//  1. 结果按 index 写入 results，所以**返回顺序和输入顺序一致** ——
//     这一点很重要，调用方不需要自己再排序
//  2. `new Array(items.length)` 而不是 push —— 保持位置语义
//  3. `if (item !== undefined)` 这个判断是为了满足 TS 的 noUncheckedIndexedAccess，
//     不是因为真的会有 undefined
//
//  为什么不装 p-limit 之类的库？因为需求就是「30 行、零依赖、行为完全可预测」。
//  **依赖一个库来省 30 行代码，通常不是好交易。**
async function parallelWithLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++
      const item = items[index]
      if (item !== undefined) {
        results[index] = await fn(item, index)
      }
    }
  }

  // Start workers up to the concurrency limit
  const workers: Promise<void>[] = []
  const workerCount = Math.min(concurrency, items.length)
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }

  await Promise.all(workers)
  return results
}

/**
 * Downloads all file attachments for a session in parallel
 *
 * @param attachments - List of file attachments to download
 * @param config - Files API configuration
 * @param concurrency - Maximum concurrent downloads (default: 5)
 * @returns Array of download results in the same order as input
 */
export async function downloadSessionFiles(
  files: File[],
  config: FilesApiConfig,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<DownloadResult[]> {
  if (files.length === 0) {
    return []
  }

  logDebug(
    `Downloading ${files.length} file(s) for session ${config.sessionId}`,
  )
  const startTime = Date.now()

  // Download files in parallel with concurrency limit
  const results = await parallelWithLimit(
    files,
    file => downloadAndSaveFile(file, config),
    concurrency,
  )

  const elapsedMs = Date.now() - startTime
  const successCount = count(results, r => r.success)
  logDebug(
    `Downloaded ${successCount}/${files.length} file(s) in ${elapsedMs}ms`,
  )

  return results
}

// ============================================================================
// Upload Functions (BYOC mode)
// ============================================================================

/**
 * Result of a file upload operation
 */
export type UploadResult =
  | {
      path: string
      fileId: string
      size: number
      success: true
    }
  | {
      path: string
      error: string
      success: false
    }

/**
 * Upload a single file to the Files API (BYOC mode)
 *
 * Size validation is performed after reading the file to avoid TOCTOU race
 * conditions where the file size could change between initial check and upload.
 *
 * @param filePath - Absolute path to the file to upload
 * @param relativePath - Relative path for the file (used as filename in API)
 * @param config - Files API configuration
 * @returns Upload result with success/failure status
 */
export async function uploadFile(
  filePath: string,
  relativePath: string,
  config: FilesApiConfig,
  opts?: { signal?: AbortSignal },
): Promise<UploadResult> {
  const baseUrl = config.baseUrl || getDefaultApiBaseUrl()
  const url = `${baseUrl}/v1/files`

  const headers = {
    Authorization: `Bearer ${config.oauthToken}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': FILES_API_BETA_HEADER,
  }

  logDebug(`Uploading file ${filePath} as ${relativePath}`)

  // Read file content first (outside retry loop since it's not a network operation)
  let content: Buffer
  try {
    content = await fs.readFile(filePath)
  } catch (error) {
    logEvent('tengu_file_upload_failed', {
      error_type:
        'file_read' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      path: relativePath,
      error: errorMessage(error),
      success: false,
    }
  }

  const fileSize = content.length

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    logEvent('tengu_file_upload_failed', {
      error_type:
        'file_too_large' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      path: relativePath,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${fileSize})`,
      success: false,
    }
  }

  // Use crypto.randomUUID for boundary to avoid collisions when uploads start same millisecond
  const boundary = `----FormBoundary${randomUUID()}`
  const filename = path.basename(relativePath)

  // Build the multipart body
  const bodyParts: Buffer[] = []

  // File part
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
  )
  bodyParts.push(content)
  bodyParts.push(Buffer.from('\r\n'))

  // Purpose part
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="purpose"\r\n\r\n` +
        `user_data\r\n`,
    ),
  )

  // End boundary
  bodyParts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(bodyParts)

  try {
    return await retryWithBackoff(`Upload file ${relativePath}`, async () => {
      try {
        const response = await axios.post(url, body, {
          headers: {
            ...headers,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length.toString(),
          },
          timeout: 120000, // 2 minute timeout for uploads
          signal: opts?.signal,
          validateStatus: status => status < 500,
        })

        if (response.status === 200 || response.status === 201) {
          const fileId = response.data?.id
          if (!fileId) {
            return {
              done: false,
              error: 'Upload succeeded but no file ID returned',
            }
          }
          logDebug(`Uploaded file ${filePath} -> ${fileId} (${fileSize} bytes)`)
          return {
            done: true,
            value: {
              path: relativePath,
              fileId,
              size: fileSize,
              success: true as const,
            },
          }
        }

        // Non-retriable errors - throw to exit retry loop
        if (response.status === 401) {
          logEvent('tengu_file_upload_failed', {
            error_type:
              'auth' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new UploadNonRetriableError(
            'Authentication failed: invalid or missing API key',
          )
        }

        if (response.status === 403) {
          logEvent('tengu_file_upload_failed', {
            error_type:
              'forbidden' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new UploadNonRetriableError('Access denied for upload')
        }

        if (response.status === 413) {
          logEvent('tengu_file_upload_failed', {
            error_type:
              'size' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new UploadNonRetriableError('File too large for upload')
        }

        return { done: false, error: `status ${response.status}` }
      } catch (error) {
        // Non-retriable errors propagate up
        if (error instanceof UploadNonRetriableError) {
          throw error
        }
        if (axios.isCancel(error)) {
          throw new UploadNonRetriableError('Upload canceled')
        }
        // Network errors are retriable
        if (axios.isAxiosError(error)) {
          return { done: false, error: error.message }
        }
        throw error
      }
    })
  } catch (error) {
    if (error instanceof UploadNonRetriableError) {
      return {
        path: relativePath,
        error: error.message,
        success: false,
      }
    }
    logEvent('tengu_file_upload_failed', {
      error_type:
        'network' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      path: relativePath,
      error: errorMessage(error),
      success: false,
    }
  }
}

/** Error class for non-retriable upload failures */
class UploadNonRetriableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadNonRetriableError'
  }
}

/**
 * Upload multiple files in parallel with concurrency limit (BYOC mode)
 *
 * @param files - Array of files to upload (path and relativePath)
 * @param config - Files API configuration
 * @param concurrency - Maximum concurrent uploads (default: 5)
 * @returns Array of upload results in the same order as input
 */
export async function uploadSessionFiles(
  files: Array<{ path: string; relativePath: string }>,
  config: FilesApiConfig,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<UploadResult[]> {
  if (files.length === 0) {
    return []
  }

  logDebug(`Uploading ${files.length} file(s) for session ${config.sessionId}`)
  const startTime = Date.now()

  const results = await parallelWithLimit(
    files,
    file => uploadFile(file.path, file.relativePath, config),
    concurrency,
  )

  const elapsedMs = Date.now() - startTime
  const successCount = count(results, r => r.success)
  logDebug(`Uploaded ${successCount}/${files.length} file(s) in ${elapsedMs}ms`)

  return results
}

// ============================================================================
// List Files Functions (1P/Cloud mode)
// ============================================================================

/**
 * File metadata returned from listFilesCreatedAfter
 */
export type FileMetadata = {
  filename: string
  fileId: string
  size: number
}

/**
 * List files created after a given timestamp (1P/Cloud mode).
 * Uses the public GET /v1/files endpoint with after_created_at query param.
 * Handles pagination via after_id cursor when has_more is true.
 *
 * @param afterCreatedAt - ISO 8601 timestamp to filter files created after
 * @param config - Files API configuration
 * @returns Array of file metadata for files created after the timestamp
 */
export async function listFilesCreatedAfter(
  afterCreatedAt: string,
  config: FilesApiConfig,
): Promise<FileMetadata[]> {
  const baseUrl = config.baseUrl || getDefaultApiBaseUrl()
  const headers = {
    Authorization: `Bearer ${config.oauthToken}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': FILES_API_BETA_HEADER,
  }

  logDebug(`Listing files created after ${afterCreatedAt}`)

  const allFiles: FileMetadata[] = []
  let afterId: string | undefined

  // Paginate through results
  while (true) {
    const params: Record<string, string> = {
      after_created_at: afterCreatedAt,
    }
    if (afterId) {
      params.after_id = afterId
    }

    const page = await retryWithBackoff(
      `List files after ${afterCreatedAt}`,
      async () => {
        try {
          const response = await axios.get(`${baseUrl}/v1/files`, {
            headers,
            params,
            timeout: 60000,
            validateStatus: status => status < 500,
          })

          if (response.status === 200) {
            return { done: true, value: response.data }
          }

          if (response.status === 401) {
            logEvent('tengu_file_list_failed', {
              error_type:
                'auth' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            throw new Error('Authentication failed: invalid or missing API key')
          }
          if (response.status === 403) {
            logEvent('tengu_file_list_failed', {
              error_type:
                'forbidden' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            throw new Error('Access denied to list files')
          }

          return { done: false, error: `status ${response.status}` }
        } catch (error) {
          if (!axios.isAxiosError(error)) {
            throw error
          }
          logEvent('tengu_file_list_failed', {
            error_type:
              'network' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return { done: false, error: error.message }
        }
      },
    )

    const files = page.data || []
    for (const f of files) {
      allFiles.push({
        filename: f.filename,
        fileId: f.id,
        size: f.size_bytes,
      })
    }

    if (!page.has_more) {
      break
    }

    // Use the last file's ID as cursor for next page
    const lastFile = files.at(-1)
    if (!lastFile?.id) {
      break
    }
    afterId = lastFile.id
  }

  logDebug(`Listed ${allFiles.length} files created after ${afterCreatedAt}`)
  return allFiles
}

// ============================================================================
// Parse Functions
// ============================================================================

/**
 * Parse file attachment specs from CLI arguments
 * Format: <file_id>:<relative_path>
 *
 * @param fileSpecs - Array of file spec strings
 * @returns Parsed file attachments
 */
// 【parseFileSpecs：把 `fileId:relativePath` 解析成结构化文件列表】
//
//  格式就一种：冒号前是 fileId，冒号后是相对路径。解析逻辑只有 20 行，
//  但里面有两处「面向真实环境」的容错，各自对应一类曾经发生过的问题：
//
//  1. 第 726 行：先把每个 spec 按空格再拆一次
//
//      Sandbox-gateway may pass multiple specs as a single space-separated string
//
//     也就是说上游可能把「多个附件」拼成一个字符串传进来。这一行是在
//     **容忍上游的格式不一致**，而不是本函数应有的语法。
//
//  2. 第 737 行：fileId 和 path 任一为空就跳过并记日志
//
//      `file_a:` 或 `:src/a.ts` 这种残缺输入不报错，只跳过。
//      **一条坏数据不该让整批失败** —— 和第 187 行 buildDownloadPath
//      返回 null 而不是抛错，是同一个原则。
//
//  注意它用的是 indexOf(':') 而不是 split(':')。因为相对路径里可能带冒号
//  （Windows 盘符、URL），用 split 会把路径劈断。**只取第一个冒号**是正确的。
//
//  这类「语法解析 + 容错」的函数实际上定义了用户契约，改它等于改产品行为 ——
//  比看文档更准确。
export function parseFileSpecs(fileSpecs: string[]): File[] {
  const files: File[] = []

  // Sandbox-gateway may pass multiple specs as a single space-separated string
  const expandedSpecs = fileSpecs.flatMap(s => s.split(' ').filter(Boolean))

  for (const spec of expandedSpecs) {
    const colonIndex = spec.indexOf(':')
    if (colonIndex === -1) {
      continue
    }

    const fileId = spec.substring(0, colonIndex)
    const relativePath = spec.substring(colonIndex + 1)

    if (!fileId || !relativePath) {
      logDebugError(
        `Invalid file spec: ${spec}. Both file_id and path are required`,
      )
      continue
    }

    files.push({ fileId, relativePath })
  }

  return files
}
