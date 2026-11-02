// PDF 工具集：解析页码范围字符串、判断当前模型是否支持 PDF 读取、判断某个扩展名是否为 PDF 文档。
import { getMainLoopModel } from './model/model.js'

// Document extensions that are handled specially
export const DOCUMENT_EXTENSIONS = new Set(['pdf'])
// 目前只有 pdf 这一种「特殊文档」扩展名被单独维护成一个集合，便于后续扩展其它文档类型。

/**
 * Parse a page range string into firstPage/lastPage numbers.
 * Supported formats:
 * - "5" → { firstPage: 5, lastPage: 5 }
 * - "1-10" → { firstPage: 1, lastPage: 10 }
 * - "3-" → { firstPage: 3, lastPage: Infinity }
 *
 * Returns null on invalid input (non-numeric, zero, inverted range).
 * Pages are 1-indexed.
 */
// 解析页码范围字符串，支持单页「5」、闭区间「1-10」与开放区间「3-」三种写法，返回首末页；非法输入返回 null。页码从 1 开始计数。
export function parsePDFPageRange(
  pages: string,
): { firstPage: number; lastPage: number } | null {
  const trimmed = pages.trim()
  if (!trimmed) {
    return null
  }

  // "N-" open-ended range
  if (trimmed.endsWith('-')) {
    const first = parseInt(trimmed.slice(0, -1), 10)
    if (isNaN(first) || first < 1) {
      return null
    }
    return { firstPage: first, lastPage: Infinity }
  }

  const dashIndex = trimmed.indexOf('-')
  if (dashIndex === -1) {
    // Single page: "5"
    const page = parseInt(trimmed, 10)
    if (isNaN(page) || page < 1) {
      return null
    }
    return { firstPage: page, lastPage: page }
  }

  // Range: "1-10"
  const first = parseInt(trimmed.slice(0, dashIndex), 10)
  const last = parseInt(trimmed.slice(dashIndex + 1), 10)
  if (isNaN(first) || isNaN(last) || first < 1 || last < 1 || last < first) {
    return null
  }
  return { firstPage: first, lastPage: last }
}
// 第一函数收尾：返回解析出的 {firstPage, lastPage}；中途任一格式校验失败都直接回退 null。

/**
 * Check if PDF reading is supported with the current model.
 * PDF document blocks work on all providers (1P, Vertex, Bedrock, Foundry).
 * Haiku 3 is the only remaining model that predates PDF support; users on
 * it fall back to the page-extraction path (poppler-utils). Substring match
 * covers all provider ID formats (Bedrock prefixes, Vertex @-dates).
 */
// 判断当前主循环模型是否支持直接读 PDF。除 Haiku 3 这一唯一早于 PDF 支持的模型外，所有提供方都支持 PDF 文档块。
export function isPDFSupported(): boolean {
  return !getMainLoopModel().toLowerCase().includes('claude-3-haiku')
}

/**
 * Check if a file extension is a PDF document.
 * @param ext File extension (with or without leading dot)
 */
// 判断扩展名是否为 PDF：先去掉可能的前导点，再按小写比对集合。
export function isPDFExtension(ext: string): boolean {
  const normalized = ext.startsWith('.') ? ext.slice(1) : ext
  return DOCUMENT_EXTENSIONS.has(normalized.toLowerCase())
}
// 整文件收尾：三个函数分别覆盖「解析页码」「模型能力探测」「扩展名判定」，构成 PDF 读取前的预处理工具层。
