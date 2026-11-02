// 文件操作的隐私保护分析：用截断或完整的 SHA256 哈希代替真实路径与内容，既能统计又不泄露用户数据。
import { createHash } from 'crypto'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logEvent } from 'src/services/analytics/index.js'

/**
 * Creates a truncated SHA256 hash (16 chars) for file paths
 * Used for privacy-preserving analytics on file operations
 */
// `hashFilePath` 取路径的十六字符截断 SHA256，作为可去标识的分析键；类型被显式标注为非代码或非路径，防止被误用。
function hashFilePath(
  filePath: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Creates a full SHA256 hash (64 chars) for file contents
 * Used for deduplication and change detection analytics
 */
// `hashFileContent` 取内容的完整六十四字符 SHA256，用于去重与变更检测，同样以专用类型约束用途。
function hashFileContent(
  content: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return createHash('sha256')
    .update(content)
    .digest('hex') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

// Maximum content size to hash (100KB)
// Prevents memory exhaustion when hashing large files (e.g., base64-encoded images)
const MAX_CONTENT_HASH_SIZE = 100 * 1024
// `MAX_CONTENT_HASH_SIZE` 把哈希上限设为百 KB，避免为大文件（如 base64 编码图片）做哈希时耗尽内存。

/**
 * Logs file operation analytics to Statsig
 */
// `logFileOperation` 汇总操作类型、工具名与路径哈希后上报；仅当内容存在且未超上限时才附内容哈希，否则跳过。
export function logFileOperation(params: {
  operation: 'read' | 'write' | 'edit'
  tool: 'FileReadTool' | 'FileWriteTool' | 'FileEditTool'
  filePath: string
  content?: string
  type?: 'create' | 'update'
}): void {
  const metadata: Record<
    string,
    | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    | number
    | boolean
  > = {
    operation:
      params.operation as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    tool: params.tool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    filePathHash: hashFilePath(params.filePath),
  }

  // Only hash content if it's provided and below size limit
  // This prevents memory exhaustion from hashing large files (e.g., base64-encoded images)
  if (
    params.content !== undefined &&
    params.content.length <= MAX_CONTENT_HASH_SIZE
  ) {
    metadata.contentHash = hashFileContent(params.content)
  }

  if (params.type !== undefined) {
    metadata.type =
      params.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }

  logEvent('tengu_file_operation', metadata)
}
// 最终以 `tengu_file_operation` 事件名上报，内容哈希按需附带，路径永远只以哈希形式出现。
