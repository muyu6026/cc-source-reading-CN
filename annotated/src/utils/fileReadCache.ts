import { detectFileEncoding } from './file.js'
// 文件内容缓存：以 mtime 做自动失效，专治 FileEditTool 里同一文件被反复读的问题——读一次、改一次、再读一次。
import { getFsImplementation } from './fsOperations.js'

type CachedFileData = {
  content: string
  encoding: BufferEncoding
  mtime: number
}
// 缓存条目保存三样东西：内容、检测到的编码，以及用于失效判断的修改时间。

/**
 * A simple in-memory cache for file contents with automatic invalidation based on modification time.
 * This eliminates redundant file reads in FileEditTool operations.
 */
class FileReadCache {
  private cache = new Map<string, CachedFileData>()
  private readonly maxCacheSize = 1000
// 上限 1000 条，淘汰策略是删掉最早插入的那一条：Map 保持插入顺序，取 keys 的第一个即可，没必要引进 LRU 结构。

  /**
   * Reads a file with caching. Returns both content and encoding.
   * Cache key includes file path and modification time for automatic invalidation.
   */
  readFile(filePath: string): { content: string; encoding: BufferEncoding } {
    const fs = getFsImplementation()

    // Get file stats for cache invalidation
    let stats
    try {
      stats = fs.statSync(filePath)
    } catch (error) {
      // File was deleted, remove from cache and re-throw
      this.cache.delete(filePath)
      throw error
    }
// stat 失败视为文件已消失：先把该路径从缓存里摘掉再抛错，否则后续命中会返回一份已经不存在的文件内容。

    const cacheKey = filePath
    const cachedData = this.cache.get(cacheKey)

    // Check if we have valid cached data
    if (cachedData && cachedData.mtime === stats.mtimeMs) {
      return {
        content: cachedData.content,
        encoding: cachedData.encoding,
      }
    }
// 命中条件是 mtime 完全相同：不做时间窗口比较，宁可多读一次，也不把半旧的内容交给编辑工具。

    // Cache miss or stale data - read the file
    const encoding = detectFileEncoding(filePath)
    const content = fs
      .readFileSync(filePath, { encoding })
      .replaceAll('\r\n', '\n')

    // Update cache
    this.cache.set(cacheKey, {
      content,
      encoding,
      mtime: stats.mtimeMs,
    })
// 写入缓存时存的是已把 CRLF 归一成 LF 的内容：下游拿到的一律是 LF，比较与替换逻辑因此不必两边都处理。

    // Evict oldest entries if cache is too large
    if (this.cache.size > this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
// 淘汰放在写入之后做：先让新数据进表，再判断是否超限，这样刚写的这一条永远不会被自己挤掉。

    return { content, encoding }
  }

  /**
   * Clears the entire cache. Useful for testing or memory management.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Removes a specific file from the cache.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath)
  }

  /**
   * Gets cache statistics for debugging/monitoring.
   */
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }
}

// Export a singleton instance
export const fileReadCache = new FileReadCache()
// 导出的是单例：缓存必须全进程共享才有意义，各处各自 new 一个等于没有缓存。
