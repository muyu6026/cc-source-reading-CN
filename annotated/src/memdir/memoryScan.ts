// 记忆目录扫描原语，从 findRelevantMemories 拆出以打破循环依赖。
/**
 * Memory-directory scanning primitives. Split out of findRelevantMemories.ts
 * so extractMemories can import the scan without pulling in sideQuery and
 * the API-client chain (which closed a cycle through memdir.ts — #25372).
 */

import { readdir } from 'fs/promises'
import { basename, join } from 'path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { readFileInRange } from '../utils/readFileInRange.js'
import { type MemoryType, parseMemoryType } from './memoryTypes.js'
// 导入文件系统、路径、frontmatter 解析与记忆类型工具。

// 记忆头信息结构：文件名、路径、修改时间、描述、类型。
export type MemoryHeader = {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
}

const MAX_MEMORY_FILES = 200
// 单次扫描最多 200 个文件，frontmatter 至多读 30 行。
const FRONTMATTER_MAX_LINES = 30

// 扫描记忆目录：读 frontmatter 并按修改时间倒序返回（封顶 200）。
/**
 * Scan a memory directory for .md files, read their frontmatter, and return
 * a header list sorted newest-first (capped at MAX_MEMORY_FILES). Shared by
 * findRelevantMemories (query-time recall) and extractMemories (pre-injects
 * the listing so the extraction agent doesn't spend a turn on `ls`).
 *
 * Single-pass: readFileInRange stats internally and returns mtimeMs, so we
 * read-then-sort rather than stat-sort-read. For the common case (N ≤ 200)
 * this halves syscalls vs a separate stat round; for large N we read a few
 * extra small files but still avoid the double-stat on the surviving 200.
 */
// 扫描主函数：递归列出 .md 文件（排除 MEMORY.md）。
export async function scanMemoryFiles(
  memoryDir: string,
  signal: AbortSignal,
): Promise<MemoryHeader[]> {
  try {
    const entries = await readdir(memoryDir, { recursive: true })
// 递归读取目录并筛出 .md 文件。
    const mdFiles = entries.filter(
      f => f.endsWith('.md') && basename(f) !== 'MEMORY.md',
    )

    const headerResults = await Promise.allSettled(
// 并发读取每个文件的 frontmatter 区间与 mtime。
      mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
        const filePath = join(memoryDir, relativePath)
        const { content, mtimeMs } = await readFileInRange(
          filePath,
          0,
          FRONTMATTER_MAX_LINES,
          undefined,
          signal,
        )
        const { frontmatter } = parseFrontmatter(content, filePath)
// 解析 frontmatter 提取描述与类型。
        return {
          filename: relativePath,
          filePath,
          mtimeMs,
          description: frontmatter.description || null,
          type: parseMemoryType(frontmatter.type),
        }
      }),
    )

    return headerResults
// 过滤成功项、按时间倒序并截断到上限。
      .filter(
        (r): r is PromiseFulfilledResult<MemoryHeader> =>
          r.status === 'fulfilled',
      )
      .map(r => r.value)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES)
// 单一 catch：任何异常都返回空列表，避免单文件拖垮整体。
  } catch {
    return []
  }
}

// 把记忆头格式化为文本清单：每行 [类型] 文件名（时间）：描述。
/**
 * Format memory headers as a text manifest: one line per file with
 * [type] filename (timestamp): description. Used by both the recall
 * selector prompt and the extraction-agent prompt.
 */
// 清单格式化函数，供召回选择器与抽取提示共用。
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map(m => {
      const tag = m.type ? `[${m.type}] ` : ''
      const ts = new Date(m.mtimeMs).toISOString()
// 将 mtime 转为 ISO 时间字符串。
      return m.description
        ? `- ${tag}${m.filename} (${ts}): ${m.description}`
// 有描述则带描述输出，否则仅类型与文件名。
        : `- ${tag}${m.filename} (${ts})`
    })
    .join('\n')
}
