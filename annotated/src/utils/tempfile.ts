// 本文件生成临时文件路径：默认落在系统临时目录，文件名由随机 UUID 或内容 SHA-256 前缀构成，用于把大段内容（如提示缓存用的拒绝列表）落盘成稳定文件。
import { createHash, randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Generate a temporary file path.
 *
 * @param prefix Optional prefix for the temp file name
 * @param extension Optional file extension (defaults to '.md')
 * @param options.contentHash When provided, the identifier is derived from a
 *   SHA-256 hash of this string (first 16 hex chars). This produces a path
 *   that is stable across process boundaries — any process with the same
 *   content will get the same path. Use this when the path ends up in content
 *   sent to the Anthropic API (e.g., sandbox deny lists in tool descriptions),
 *   because a random UUID would change on every subprocess spawn and
 *   invalidate the prompt cache prefix.
 * @returns Temp file path
 */
// generateTempFilePath：可选前缀与扩展名（默认 claude-prompt / .md）。传入 contentHash 时用其 SHA-256 前 16 位作稳定标识，保证跨进程相同内容得到相同路径（避免随机 UUID 每次子进程都变、击穿提示缓存前缀）；否则用随机 UUID。
export function generateTempFilePath(
  prefix: string = 'claude-prompt',
  extension: string = '.md',
  options?: { contentHash?: string },
): string {
  const id = options?.contentHash
    ? createHash('sha256')
        .update(options.contentHash)
        .digest('hex')
        .slice(0, 16)
    : randomUUID()
  return join(tmpdir(), `${prefix}-${id}${extension}`)
}
