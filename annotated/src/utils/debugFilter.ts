import memoize from 'lodash-es/memoize.js'

export type DebugFilter = {
  include: string[]
  exclude: string[]
  isExclusive: boolean
}
// DebugFilter 描述一条调试过滤配置：include 白名单、exclude 黑名单、isExclusive 是否排他模式。

/**
 * Parse debug filter string into a filter configuration
 * Examples:
 * - "api,hooks" -> include only api and hooks categories
 * - "!1p,!file" -> exclude logging and file categories
 * - undefined/empty -> no filtering (show all)
 */
export const parseDebugFilter = memoize(
// parseDebugFilter 把逗号分隔的过滤字符串解析成 DebugFilter；带 ! 前缀表示排除，! 与普通项混用视为非法返回 null。
  (filterString?: string): DebugFilter | null => {
    if (!filterString || filterString.trim() === '') {
      return null
    }

    const filters = filterString
      .split(',')
      .map(f => f.trim())
      .filter(Boolean)

    // If no valid filters remain, return null
    if (filters.length === 0) {
      return null
    }

    // Check for mixed inclusive/exclusive filters
    const hasExclusive = filters.some(f => f.startsWith('!'))
    const hasInclusive = filters.some(f => !f.startsWith('!'))

    if (hasExclusive && hasInclusive) {
      // For now, we'll treat this as an error case and show all messages
      // Log error using logForDebugging to avoid console.error lint rule
      // We'll import and use it later when the circular dependency is resolved
      // For now, just return null silently
      return null
    }

    // Clean up filters (remove ! prefix) and normalize
    const cleanFilters = filters.map(f => f.replace(/^!/, '').toLowerCase())

    return {
      include: hasExclusive ? [] : cleanFilters,
      exclude: hasExclusive ? cleanFilters : [],
      isExclusive: hasExclusive,
    }
  },
)
// parseDebugFilter 结束：清理掉 ! 前缀并转小写，按排他/包含模式填好 include 与 exclude 数组。

/**
 * Extract debug categories from a message
 * Supports multiple patterns:
 * - "category: message" -> ["category"]
 * - "[CATEGORY] message" -> ["category"]
 * - "MCP server \"name\": message" -> ["mcp", "name"]
 * - "[ANT-ONLY] 1P event: tengu_timer" -> ["ant-only", "1p"]
 *
 * Returns lowercase categories for case-insensitive matching
 */
// extractDebugCategories 从一条调试消息里抽取分类标签（兼容 category:、[CATEGORY]、MCP server 名、1p event 等写法），返回小写数组。
export function extractDebugCategories(message: string): string[] {
  const categories: string[] = []

  // Pattern 3: MCP server "servername" - Check this first to avoid false positives
  const mcpMatch = message.match(/^MCP server ["']([^"']+)["']/)
  if (mcpMatch && mcpMatch[1]) {
    categories.push('mcp')
    categories.push(mcpMatch[1].toLowerCase())
  } else {
    // Pattern 1: "category: message" (simple prefix) - only if not MCP pattern
    const prefixMatch = message.match(/^([^:[]+):/)
    if (prefixMatch && prefixMatch[1]) {
      categories.push(prefixMatch[1].trim().toLowerCase())
    }
  }

  // Pattern 2: [CATEGORY] at the start
  const bracketMatch = message.match(/^\[([^\]]+)]/)
  if (bracketMatch && bracketMatch[1]) {
    categories.push(bracketMatch[1].trim().toLowerCase())
  }

  // Pattern 4: Check for additional categories in the message
  // e.g., "[ANT-ONLY] 1P event: tengu_timer" should match both "ant-only" and "1p"
  if (message.toLowerCase().includes('1p event:')) {
    categories.push('1p')
  }

  // Pattern 5: Look for secondary categories after the first pattern
  // e.g., "AutoUpdaterWrapper: Installation type: development"
  const secondaryMatch = message.match(
    /:\s*([^:]+?)(?:\s+(?:type|mode|status|event))?:/,
  )
  if (secondaryMatch && secondaryMatch[1]) {
    const secondary = secondaryMatch[1].trim().toLowerCase()
    // Only add if it's a reasonable category name (not too long, no spaces)
    if (secondary.length < 30 && !secondary.includes(' ')) {
      categories.push(secondary)
    }
  }

  // If no categories found, return empty array (uncategorized)
  return Array.from(new Set(categories)) // Remove duplicates
}
// extractDebugCategories 结束：去重后返回分类数组，没识别到则返回空数组（未分类）。

/**
 * Check if debug message should be shown based on filter
 * @param categories - Categories extracted from the message
 * @param filter - Parsed filter configuration
 * @returns true if message should be shown
 */
// shouldShowDebugCategories 根据分类与过滤配置决定消息是否展示；无过滤则全显示，未分类消息在两种模式下默认都不显示。
export function shouldShowDebugCategories(
  categories: string[],
  filter: DebugFilter | null,
): boolean {
  // No filter means show everything
  if (!filter) {
    return true
  }

  // If no categories found, handle based on filter mode
  if (categories.length === 0) {
    // In exclusive mode, uncategorized messages are excluded by default for security
    // In inclusive mode, uncategorized messages are excluded (must match a category)
    return false
  }

  if (filter.isExclusive) {
    // Exclusive mode: show if none of the categories are in the exclude list
    return !categories.some(cat => filter.exclude.includes(cat))
  } else {
    // Inclusive mode: show if any of the categories are in the include list
    return categories.some(cat => filter.include.includes(cat))
  }
}
// shouldShowDebugCategories 结束：排他模式「不在排除列表才显示」，包含模式「命中包含列表才显示」。

/**
 * Main function to check if a debug message should be shown
 * Combines extraction and filtering
 */
// shouldShowDebugMessage 是组合入口：无过滤直接全显示，有过滤则先抽分类再判定。
export function shouldShowDebugMessage(
  message: string,
  filter: DebugFilter | null,
): boolean {
  // Fast path: no filter means show everything
  if (!filter) {
    return true
  }

  // Only extract categories if we have a filter
  const categories = extractDebugCategories(message)
  return shouldShowDebugCategories(categories, filter)
}
// shouldShowDebugMessage 结束。
