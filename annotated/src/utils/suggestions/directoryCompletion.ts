import { LRUCache } from 'lru-cache'
import { basename, dirname, join, sep } from 'path'
import type { SuggestionItem } from 'src/components/PromptInput/PromptInputFooterSuggestions.js'
import { getCwd } from 'src/utils/cwd.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import { logError } from 'src/utils/log.js'
import { expandPath } from 'src/utils/path.js'
// Types
export type DirectoryEntry = {
  name: string
  path: string
  type: 'directory'
}

export type PathEntry = {
  name: string
  path: string
  type: 'directory' | 'file'
}

export type CompletionOptions = {
  basePath?: string
  maxResults?: number
}

export type PathCompletionOptions = CompletionOptions & {
  includeFiles?: boolean
  includeHidden?: boolean
}

type ParsedPath = {
  directory: string
  prefix: string
}

// Cache configuration
const CACHE_SIZE = 500
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Initialize LRU cache for directory scans
// 目录扫描结果用 LRU 缓存，最多 500 条、5 分钟过期，避免每次按键都读文件系统
const directoryCache = new LRUCache<string, DirectoryEntry[]>({
  max: CACHE_SIZE,
  ttl: CACHE_TTL,
})

// Initialize LRU cache for path scans (files and directories)
const pathCache = new LRUCache<string, PathEntry[]>({
  max: CACHE_SIZE,
  ttl: CACHE_TTL,
})

/**
 * Parses a partial path into directory and prefix components
 */
// 把一个可能没写完的路径拆成「所在目录」和「已输入前缀」两段
export function parsePartialPath(
  partialPath: string,
  basePath?: string,
): ParsedPath {
  // Handle empty input
  if (!partialPath) {
    const directory = basePath || getCwd()
    return { directory, prefix: '' }
  }

  const resolved = expandPath(partialPath, basePath)

  // If path ends with separator, treat as directory with no prefix
  // Handle both forward slash and platform-specific separator
  if (partialPath.endsWith('/') || partialPath.endsWith(sep)) {
    return { directory: resolved, prefix: '' }
  }

  // Split into directory and prefix
  const directory = dirname(resolved)
  const prefix = basename(partialPath)

  return { directory, prefix }
}

/**
 * Scans a directory and returns subdirectories
 * Uses LRU cache to avoid repeated filesystem calls
 */
// 只列子目录、排除隐藏目录，最多取前 100 条（MVP 阶段先限流）
export async function scanDirectory(
  dirPath: string,
): Promise<DirectoryEntry[]> {
  // Check cache first
  const cached = directoryCache.get(dirPath)
  if (cached) {
    return cached
  }

  try {
    // Read directory contents
    const fs = getFsImplementation()
    const entries = await fs.readdir(dirPath)

    // Filter for directories only, exclude hidden directories
    const directories = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        type: 'directory' as const,
      }))
      .slice(0, 100) // Limit results for MVP

    // Cache the results
    directoryCache.set(dirPath, directories)

    return directories
  } catch (error) {
    logError(error)
    return []
  }
}

/**
 * Main function to get directory completion suggestions
 */
// 主入口：按前缀在目录里模糊匹配子目录，拼成补全项
export async function getDirectoryCompletions(
  partialPath: string,
  options: CompletionOptions = {},
): Promise<SuggestionItem[]> {
  const { basePath = getCwd(), maxResults = 10 } = options

  const { directory, prefix } = parsePartialPath(partialPath, basePath)
  const entries = await scanDirectory(directory)
  const prefixLower = prefix.toLowerCase()
  const matches = entries
    .filter(entry => entry.name.toLowerCase().startsWith(prefixLower))
    .slice(0, maxResults)

  return matches.map(entry => ({
    id: entry.path,
    displayText: entry.name + '/',
    description: 'directory',
    metadata: { type: 'directory' as const },
  }))
}

/**
 * Clears the directory cache
 */
export function clearDirectoryCache(): void {
  directoryCache.clear()
}

/**
 * Checks if a string looks like a path (starts with path-like prefixes)
 */
// 判断一段文字是不是路径：以 ~/、/、./、../ 开头，或本身就是 . 或 ..
export function isPathLikeToken(token: string): boolean {
  return (
    token.startsWith('~/') ||
    token.startsWith('/') ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token === '~' ||
    token === '.' ||
    token === '..'
  )
}

/**
 * Scans a directory and returns both files and subdirectories
 * Uses LRU cache to avoid repeated filesystem calls
 */
// 同时扫文件和子目录，结果按「目录优先、再按字母序」排序
export async function scanDirectoryForPaths(
  dirPath: string,
  includeHidden = false,
): Promise<PathEntry[]> {
  const cacheKey = `${dirPath}:${includeHidden}`
  const cached = pathCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const fs = getFsImplementation()
    const entries = await fs.readdir(dirPath)

    const paths = entries
      .filter(entry => includeHidden || !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
      .sort((a, b) => {
        // Sort directories first, then alphabetically
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, 100)

    pathCache.set(cacheKey, paths)
    return paths
  } catch (error) {
    logError(error)
    return []
  }
}

/**
 * Get path completion suggestions for files and directories
 */
// 主入口：在目录下同时匹配文件和子目录，并把相对路径还原回去
export async function getPathCompletions(
  partialPath: string,
  options: PathCompletionOptions = {},
): Promise<SuggestionItem[]> {
  const {
    basePath = getCwd(),
    maxResults = 10,
    includeFiles = true,
    includeHidden = false,
  } = options

  const { directory, prefix } = parsePartialPath(partialPath, basePath)
  const entries = await scanDirectoryForPaths(directory, includeHidden)
  const prefixLower = prefix.toLowerCase()

  const matches = entries
    .filter(entry => {
      if (!includeFiles && entry.type === 'file') return false
      return entry.name.toLowerCase().startsWith(prefixLower)
    })
    .slice(0, maxResults)

  // Construct relative path based on original partialPath
  // e.g., if partialPath is "src/c", directory portion is "src/"
  // Strip leading "./" since it's just used for cwd search
  // Handle both forward slash and platform separator for Windows compatibility
  const hasSeparator = partialPath.includes('/') || partialPath.includes(sep)
  let dirPortion = ''
  if (hasSeparator) {
    // Find the last separator (either / or platform-specific)
    const lastSlash = partialPath.lastIndexOf('/')
    const lastSep = partialPath.lastIndexOf(sep)
    const lastSeparatorPos = Math.max(lastSlash, lastSep)
    dirPortion = partialPath.substring(0, lastSeparatorPos + 1)
  }
  if (dirPortion.startsWith('./') || dirPortion.startsWith('.' + sep)) {
    dirPortion = dirPortion.slice(2)
  }

  return matches.map(entry => {
    const fullPath = dirPortion + entry.name
    return {
      id: fullPath,
      displayText: entry.type === 'directory' ? fullPath + '/' : fullPath,
      metadata: { type: entry.type },
    }
  })
}

/**
 * Clears both directory and path caches
 */
// 清空两类缓存，让下一次补全重新读盘
export function clearPathCache(): void {
  directoryCache.clear()
  pathCache.clear()
}
