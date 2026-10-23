import type {
  Base64ImageSource,
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { readFile, stat } from 'fs/promises'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { pathInAllowedWorkingPath } from 'src/utils/permissions/filesystem.js'
import { setCwd } from 'src/utils/Shell.js'
import { shouldMaintainProjectWorkingDir } from '../../utils/envUtils.js'
import { maybeResizeAndDownsampleImageBuffer } from '../../utils/imageResizer.js'
import { getMaxOutputLength } from '../../utils/shell/outputLimits.js'
import { countCharInString, plural } from '../../utils/stringUtils.js'
/**
 * Strips leading and trailing lines that contain only whitespace/newlines.
 * Unlike trim(), this preserves whitespace within content lines and only removes
 * completely empty lines from the beginning and end.
 */
// stripEmptyLines 与 trim() 的区别：只去掉首尾的纯空白行，内容行内的空白不动。
export function stripEmptyLines(content: string): string {
  const lines = content.split('\n')

  // Find the first non-empty line
  let startIndex = 0
  while (startIndex < lines.length && lines[startIndex]?.trim() === '') {
    startIndex++
  }

  // Find the last non-empty line
  let endIndex = lines.length - 1
  while (endIndex >= 0 && lines[endIndex]?.trim() === '') {
    endIndex--
  }

  // If all lines are empty, return empty string
  if (startIndex > endIndex) {
    return ''
  }

  // Return the slice with non-empty lines
  return lines.slice(startIndex, endIndex + 1).join('\n')
}

/**
 * Check if content is a base64 encoded image data URL
 */
// isImageOutput 判 data URI 图片——shell 命令可以直接往 stdout 打 base64 图片。
export function isImageOutput(content: string): boolean {
  return /^data:image\/[a-z0-9.+_-]+;base64,/i.test(content)
}

const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/

/**
 * Parse a data-URI string into its media type and base64 payload.
 * Input is trimmed before matching.
 */
export function parseDataUri(
  s: string,
): { mediaType: string; data: string } | null {
  const match = s.trim().match(DATA_URI_RE)
  if (!match || !match[1] || !match[2]) return null
  return { mediaType: match[1], data: match[2] }
}

/**
 * Build an image tool_result block from shell stdout containing a data URI.
 * Returns null if parse fails so callers can fall through to text handling.
 */
// buildImageToolResult 把 data URI 组装成 API 的 image tool_result 块。解析失败返回 null，调用方回落到文本处理。
export function buildImageToolResult(
  stdout: string,
  toolUseID: string,
): ToolResultBlockParam | null {
  const parsed = parseDataUri(stdout)
  if (!parsed) return null
  return {
    tool_use_id: toolUseID,
    type: 'tool_result',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType as Base64ImageSource['media_type'],
          data: parsed.data,
        },
      },
    ],
  }
}

// Cap file reads to 20 MB — any image data URI larger than this is
// well beyond what the API accepts (5 MB base64) and would OOM if read
// into memory.
// 文件读取 20MB 硬顶：比这更大的 data URI 远超 API 的 5MB base64 上限，读进内存直接 OOM。
const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024

/**
 * Resize image output from a shell tool. stdout is capped at
 * getMaxOutputLength() when read back from the shell output file — if the
 * full output spilled to disk, re-read it from there, since truncated base64
 * would decode to a corrupt image that either throws here or gets rejected by
 * the API. Caps dimensions too: compressImageBuffer only checks byte size, so
 * a small-but-high-DPI PNG (e.g. matplotlib at dpi=300) sails through at full
 * resolution and poisons many-image requests (CC-304).
 *
 * Returns the re-encoded data URI on success, or null if the source didn't
 * parse as a data URI (caller decides whether to flip isImage).
 */
// resizeShellImageOutput 的两个坑都写在注释里：① stdout 从 shell 输出文件回读时有长度上限，截断的 base64 解出来是 corrupt image（要么这里抛错要么被 API 拒），所以输出溢写到磁盘时要重读原文件；② compressImageBuffer 只查字节大小，小尺寸高 DPI 的 PNG（matplotlib dpi=300）能全分辨率蒙混过关，毒化多图请求（CC-304）。
export async function resizeShellImageOutput(
  stdout: string,
  outputFilePath: string | undefined,
  outputFileSize: number | undefined,
): Promise<string | null> {
  let source = stdout
  if (outputFilePath) {
    const size = outputFileSize ?? (await stat(outputFilePath)).size
    if (size > MAX_IMAGE_FILE_SIZE) return null
    source = await readFile(outputFilePath, 'utf8')
  }
  const parsed = parseDataUri(source)
  if (!parsed) return null
  const buf = Buffer.from(parsed.data, 'base64')
  const ext = parsed.mediaType.split('/')[1] || 'png'
  const resized = await maybeResizeAndDownsampleImageBuffer(
    buf,
    buf.length,
    ext,
  )
  return `data:image/${resized.mediaType};base64,${resized.buffer.toString('base64')}`
}

export function formatOutput(content: string): {
// formatOutput 是输出截断逻辑：图片不截（原样带回）；文本超 getMaxOutputLength() 就切前段 + 剩余行数提示。
  totalLines: number
  truncatedContent: string
  isImage?: boolean
} {
  const isImage = isImageOutput(content)
  if (isImage) {
    return {
      totalLines: 1,
      truncatedContent: content,
      isImage,
    }
  }

  const maxOutputLength = getMaxOutputLength()
  if (content.length <= maxOutputLength) {
    return {
      totalLines: countCharInString(content, '\n') + 1,
      truncatedContent: content,
      isImage,
    }
  }

  const truncatedPart = content.slice(0, maxOutputLength)
// 截断提示数的是剩余行数，从截断点起算。
  const remainingLines = countCharInString(content, '\n', maxOutputLength) + 1
  const truncated = `${truncatedPart}\n\n... [${remainingLines} lines truncated] ...`

  return {
    totalLines: countCharInString(content, '\n') + 1,
    truncatedContent: truncated,
    isImage,
  }
}

export const stdErrAppendShellResetMessage = (stderr: string): string =>
// stderr 追加 shell cwd 重置提示——cd 到项目外被拉回时要让用户知道。
  `${stderr.trim()}\nShell cwd was reset to ${getOriginalCwd()}`

export function resetCwdIfOutsideProject(
// resetCwdIfOutsideProject：cd 到允许工作目录之外时拉回原目录。快路径注释说明 originalCwd 恒在 allWorkingDirectories 里，cwd 没动时跳过 syscall 密集的 pathInAllowedWorkingPath。
  toolPermissionContext: ToolPermissionContext,
): boolean {
  const cwd = getCwd()
  const originalCwd = getOriginalCwd()
  const shouldMaintain = shouldMaintainProjectWorkingDir()
  if (
    shouldMaintain ||
    // Fast path: originalCwd is unconditionally in allWorkingDirectories
    // (filesystem.ts), so when cwd hasn't moved, pathInAllowedWorkingPath is
    // trivially true — skip its syscalls for the no-cd common case.
    (cwd !== originalCwd &&
      !pathInAllowedWorkingPath(cwd, toolPermissionContext))
  ) {
    // Reset to original directory if maintaining project dir OR outside allowed working directory
    setCwd(originalCwd)
    if (!shouldMaintain) {
      logEvent('tengu_bash_tool_reset_to_original_dir', {})
      return true
    }
  }
  return false
}

/**
 * Creates a human-readable summary of structured content blocks.
 * Used to display MCP results with images and text in the UI.
 */
// createContentSummary 给 MCP 的图片+文本结果生成人类可读摘要，UI 展示用。文本块取前 200 字符预览。
export function createContentSummary(content: ContentBlockParam[]): string {
  const parts: string[] = []
  let textCount = 0
  let imageCount = 0

  for (const block of content) {
    if (block.type === 'image') {
      imageCount++
    } else if (block.type === 'text' && 'text' in block) {
      textCount++
      // Include first 200 chars of text blocks for context
      const preview = block.text.slice(0, 200)
      parts.push(preview + (block.text.length > 200 ? '...' : ''))
    }
  }

  const summary: string[] = []
  if (imageCount > 0) {
    summary.push(`[${imageCount} ${plural(imageCount, 'image')}]`)
  }
  if (textCount > 0) {
    summary.push(`[${textCount} text ${plural(textCount, 'block')}]`)
  }

  return `MCP Result: ${summary.join(', ')}${parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''}`
}
