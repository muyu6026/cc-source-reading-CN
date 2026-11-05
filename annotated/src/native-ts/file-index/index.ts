// vendor/file-index-src（Rust NAPI 模块）的纯 TypeScript 移植：复刻 nucleo 风格的模糊搜索 API 与打分行为，不依赖任何原生模块，用于文件快速检索
/**
 * Pure-TypeScript port of vendor/file-index-src (Rust NAPI module).
 *
 * The native module wraps nucleo (https://github.com/helix-editor/nucleo) for
 * high-performance fuzzy file searching. This port reimplements the same API
 * and scoring behavior without native dependencies.
 *
 * Key API:
 *   new FileIndex()
 *   .loadFromFileList(fileList: string[]): void   — dedupe + index paths
 *   .search(query: string, limit: number): SearchResult[]
 *
 * Score semantics: lower = better. Score is position-in-results / result-count,
 * so the best match is 0.0. Paths containing "test" get a 1.05× penalty (capped
 * at 1.0) so non-test files rank slightly higher.
 */

// SearchResult：搜索结果 = 路径 + 分数（分数越低越好，最佳为 0）
export type SearchResult = {
  path: string
  score: number
}

// nucleo-style scoring constants (approximating fzf-v2 / nucleo bonuses)
// 一组 nucleo 风格的打分常数：匹配基础分、边界 / 驼峰 / 连续 / 首字符奖励，以及间隙惩罚
const SCORE_MATCH = 16
const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 6
const BONUS_CONSECUTIVE = 4
const BONUS_FIRST_CHAR = 8
const PENALTY_GAP_START = 3
const PENALTY_GAP_EXTENSION = 1

// 顶层缓存上限与查询长度上限
const TOP_LEVEL_CACHE_LIMIT = 100
const MAX_QUERY_LEN = 64
// Yield to event loop after this many ms of sync work. Chunk sizes are
// time-based (not count-based) so slow machines get smaller chunks and
// stay responsive — 5k paths is ~2ms on M-series but could be 15ms+ on
// older Windows hardware.
const CHUNK_MS = 4

// Reusable buffer: records where each needle char matched during the indexOf scan
// 复用缓冲：记录 indexOf 扫描时每个 needle 字符命中的位置，避免二次扫描
const posBuf = new Int32Array(MAX_QUERY_LEN)

// FileIndex 类：持有路径、小写副本、字符位图、长度数组与顶层缓存，支持同步与异步两种建索引
export class FileIndex {
  private paths: string[] = []
  private lowerPaths: string[] = []
  private charBits: Int32Array = new Int32Array(0)
  private pathLens: Uint16Array = new Uint16Array(0)
  private topLevelCache: SearchResult[] | null = null
  // During async build, tracks how many paths have bitmap/lowerPath filled.
  // search() uses this to search the ready prefix while build continues.
  private readyCount = 0

  /**
   * Load paths from an array of strings.
   * This is the main way to populate the index — ripgrep collects files, we just search them.
   * Automatically deduplicates paths.
   */
// loadFromFileList：主入口，去重后建索引（ripgrep 负责收集文件，这里只搜）
  loadFromFileList(fileList: string[]): void {
    // Deduplicate and filter empty strings (matches Rust HashSet behavior)
    const seen = new Set<string>()
    const paths: string[] = []
    for (const line of fileList) {
      if (line.length > 0 && !seen.has(line)) {
        seen.add(line)
        paths.push(line)
      }
    }

    this.buildIndex(paths)
  }

  /**
   * Async variant: yields to the event loop every ~8–12k paths so large
   * indexes (270k+ files) don't block the main thread for >10ms at a time.
   * Identical result to loadFromFileList.
   *
   * Returns { queryable, done }:
   *   - queryable: resolves as soon as the first chunk is indexed (search
   *     returns partial results). For a 270k-path list this is ~5–10ms of
   *     sync work after the paths array is available.
   *   - done: resolves when the entire index is built.
   */
// loadFromFileListAsync：异步变体，每约若干毫秒让出事件循环，避免大索引（27 万文件）阻塞主线程；返回可查询与完成两个 Promise
  loadFromFileListAsync(fileList: string[]): {
    queryable: Promise<void>
    done: Promise<void>
  } {
    let markQueryable: () => void = () => {}
    const queryable = new Promise<void>(resolve => {
      markQueryable = resolve
    })
    const done = this.buildAsync(fileList, markQueryable)
    return { queryable, done }
  }

// buildAsync：去重 + 分块建索引，首块建完即可查询（返回部分结果），全程让出事件循环
  private async buildAsync(
    fileList: string[],
    markQueryable: () => void,
  ): Promise<void> {
    const seen = new Set<string>()
    const paths: string[] = []
    let chunkStart = performance.now()
    for (let i = 0; i < fileList.length; i++) {
      const line = fileList[i]!
      if (line.length > 0 && !seen.has(line)) {
        seen.add(line)
        paths.push(line)
      }
      // Check every 256 iterations to amortize performance.now() overhead
      if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
        await yieldToEventLoop()
        chunkStart = performance.now()
      }
    }

    this.resetArrays(paths)

    chunkStart = performance.now()
    let firstChunk = true
    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i)
      if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
        this.readyCount = i + 1
        if (firstChunk) {
          markQueryable()
          firstChunk = false
        }
        await yieldToEventLoop()
        chunkStart = performance.now()
      }
    }
    this.readyCount = paths.length
    markQueryable()
  }

// buildIndex：同步建索引，一次性填完所有数组
  private buildIndex(paths: string[]): void {
    this.resetArrays(paths)
    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i)
    }
    this.readyCount = paths.length
  }

// resetArrays：分配并初始化底层数组，并预计算顶层目录缓存
  private resetArrays(paths: string[]): void {
    const n = paths.length
    this.paths = paths
    this.lowerPaths = new Array(n)
    this.charBits = new Int32Array(n)
    this.pathLens = new Uint16Array(n)
    this.readyCount = 0
    this.topLevelCache = computeTopLevelEntries(paths, TOP_LEVEL_CACHE_LIMIT)
  }

  // Precompute: lowercase, a–z bitmap, length. Bitmap gives O(1) rejection
  // of paths missing any needle letter (89% survival for broad queries like
  // "test" → still a 10%+ free win; 90%+ rejection for rare chars).
// indexPath：预处理单行——小写、a-z 位图、长度，位图用于后续 O(1) 排除缺字母的路径
  private indexPath(i: number): void {
    const lp = this.paths[i]!.toLowerCase()
    this.lowerPaths[i] = lp
    const len = lp.length
    this.pathLens[i] = len
    let bits = 0
    for (let j = 0; j < len; j++) {
      const c = lp.charCodeAt(j)
      if (c >= 97 && c <= 122) bits |= 1 << (c - 97)
    }
    this.charBits[i] = bits
  }

  /**
   * Search for files matching the query using fuzzy matching.
   * Returns top N results sorted by match score.
   */
// search：核心模糊匹配，返回前 N 名按分数排序；先位图排除、再用 indexOf 找位置并内联累计间隙与连续奖励，最后做边界 / 驼峰打分
  search(query: string, limit: number): SearchResult[] {
    if (limit <= 0) return []
    if (query.length === 0) {
      if (this.topLevelCache) {
        return this.topLevelCache.slice(0, limit)
      }
      return []
    }

    // Smart case: lowercase query → case-insensitive; any uppercase → case-sensitive
    const caseSensitive = query !== query.toLowerCase()
    const needle = caseSensitive ? query : query.toLowerCase()
    const nLen = Math.min(needle.length, MAX_QUERY_LEN)
    const needleChars: string[] = new Array(nLen)
    let needleBitmap = 0
    for (let j = 0; j < nLen; j++) {
      const ch = needle.charAt(j)
      needleChars[j] = ch
      const cc = ch.charCodeAt(0)
      if (cc >= 97 && cc <= 122) needleBitmap |= 1 << (cc - 97)
    }

    // Upper bound on score assuming every match gets the max boundary bonus.
    // Used to reject paths whose gap penalties alone make them unable to beat
    // the current top-k threshold, before the charCodeAt-heavy boundary pass.
// 分数上限：假设每个匹配都拿满边界奖励，用于提前排除那些仅靠间隙惩罚就不可能进前 k 的路径
    const scoreCeiling =
      nLen * (SCORE_MATCH + BONUS_BOUNDARY) + BONUS_FIRST_CHAR + 32

    // Top-k: maintain a sorted-ascending array of the best `limit` matches.
    // Avoids O(n log n) sort of all matches when we only need `limit` of them.
    const topK: { path: string; fuzzScore: number }[] = []
    let threshold = -Infinity

// 解构出常用数组与 readyCount 副本，减少属性访问
    const { paths, lowerPaths, charBits, pathLens, readyCount } = this

// 外层循环带 readyCount 上限：异步建索引时只对已就绪的前缀搜索
    outer: for (let i = 0; i < readyCount; i++) {
      // O(1) bitmap reject: path must contain every letter in the needle
      if ((charBits[i]! & needleBitmap) !== needleBitmap) continue

      const haystack = caseSensitive ? paths[i]! : lowerPaths[i]!

      // Fused indexOf scan: find positions (SIMD-accelerated in JSC/V8) AND
      // accumulate gap/consecutive terms inline. The greedy-earliest positions
      // found here are identical to what the charCodeAt scorer would find, so
      // we score directly from them — no second scan.
// 融合的 indexOf 扫描：找位置的同时内联累计间隙与连续奖励，得到的位置与字符扫描打分器等价，省掉第二次扫描
      let pos = haystack.indexOf(needleChars[0]!)
      if (pos === -1) continue
      posBuf[0] = pos
      let gapPenalty = 0
      let consecBonus = 0
      let prev = pos
      for (let j = 1; j < nLen; j++) {
        pos = haystack.indexOf(needleChars[j]!, prev + 1)
        if (pos === -1) continue outer
        posBuf[j] = pos
        const gap = pos - prev - 1
        if (gap === 0) consecBonus += BONUS_CONSECUTIVE
        else gapPenalty += PENALTY_GAP_START + gap * PENALTY_GAP_EXTENSION
        prev = pos
      }

      // Gap-bound reject: if the best-case score (all boundary bonuses) minus
      // known gap penalties can't beat threshold, skip the boundary pass.
// 间隙边界排除：最好情况分数减去已知间隙惩罚仍打不过阈值时，跳过昂贵的边界打分
      if (
        topK.length === limit &&
        scoreCeiling + consecBonus - gapPenalty <= threshold
      ) {
        continue
      }

      // Boundary/camelCase scoring: check the char before each match position.
      const path = paths[i]!
      const hLen = pathLens[i]!
      let score = nLen * SCORE_MATCH + consecBonus - gapPenalty
      score += scoreBonusAt(path, posBuf[0]!, true)
// 边界 / 驼峰打分：检查每个匹配位置的前一个字符，分号、斜杠等边界与驼峰处给奖励
      for (let j = 1; j < nLen; j++) {
        score += scoreBonusAt(path, posBuf[j]!, false)
      }
      score += Math.max(0, 32 - (hLen >> 2))

// top-k 维护：未排满直接压入并可能在满时排序定阈值，已满且超阈值则二分插入替换最小者
      if (topK.length < limit) {
        topK.push({ path, fuzzScore: score })
        if (topK.length === limit) {
          topK.sort((a, b) => a.fuzzScore - b.fuzzScore)
          threshold = topK[0]!.fuzzScore
        }
      } else if (score > threshold) {
        let lo = 0
        let hi = topK.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (topK[mid]!.fuzzScore < score) lo = mid + 1
          else hi = mid
        }
        topK.splice(lo, 0, { path, fuzzScore: score })
        topK.shift()
        threshold = topK[0]!.fuzzScore
      }
    }

    // topK is ascending; reverse to descending (best first)
// topK 升序反转成降序（最佳在前）
    topK.sort((a, b) => b.fuzzScore - a.fuzzScore)

    const matchCount = topK.length
    const denom = Math.max(matchCount, 1)
    const results: SearchResult[] = new Array(matchCount)

// 把分数换算成位置占比，含 test 的路径给 1.05 倍轻微惩罚（上限 1.0）
    for (let i = 0; i < matchCount; i++) {
      const path = topK[i]!.path
      const positionScore = i / denom
      const finalScore = path.includes('test')
        ? Math.min(positionScore * 1.05, 1.0)
        : positionScore
      results[i] = { path, score: finalScore }
    }

// 返回最终排序后的结果
    return results
  }
}

/**
 * Boundary/camelCase bonus for a match at position `pos` in the original-case
 * path. `first` enables the start-of-string bonus (only for needle[0]).
 */
// scoreBonusAt：匹配位置处的边界 / 驼峰奖励，首字符额外给首字符奖励
function scoreBonusAt(path: string, pos: number, first: boolean): number {
  if (pos === 0) return first ? BONUS_FIRST_CHAR : 0
  const prevCh = path.charCodeAt(pos - 1)
  if (isBoundary(prevCh)) return BONUS_BOUNDARY
  if (isLower(prevCh) && isUpper(path.charCodeAt(pos))) return BONUS_CAMEL
  return 0
}

// isBoundary：判断字符是否为分隔符（斜杠、反斜杠、横线、下划线、点、空格）
function isBoundary(code: number): boolean {
  // / \ - _ . space
  return (
    code === 47 || // /
    code === 92 || // \
    code === 45 || // -
    code === 95 || // _
    code === 46 || // .
    code === 32 // space
  )
}

// isLower / isUpper：字符大小写判断
function isLower(code: number): boolean {
  return code >= 97 && code <= 122
}

function isUpper(code: number): boolean {
  return code >= 65 && code <= 90
}

// yieldToEventLoop：用 setImmediate 让出事件循环
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

// 重导出 CHUNK_MS 常量
export { CHUNK_MS }

/**
 * Extract unique top-level path segments, sorted by (length asc, then alpha asc).
 * Handles both Unix (/) and Windows (\) path separators.
 * Mirrors FileIndex::compute_top_level_entries in lib.rs.
 */
// computeTopLevelEntries：抽取唯一的顶层路径段，按长度升、字母升排序，镜像 Rust 端的同名函数
function computeTopLevelEntries(
  paths: string[],
  limit: number,
): SearchResult[] {
  const topLevel = new Set<string>()

  for (const p of paths) {
    // Split on first / or \ separator
    let end = p.length
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i)
      if (c === 47 || c === 92) {
        end = i
        break
      }
    }
    const segment = p.slice(0, end)
    if (segment.length > 0) {
      topLevel.add(segment)
      if (topLevel.size >= limit) break
    }
  }

  const sorted = Array.from(topLevel)
  sorted.sort((a, b) => {
    const lenDiff = a.length - b.length
    if (lenDiff !== 0) return lenDiff
    return a < b ? -1 : a > b ? 1 : 0
  })

  return sorted.slice(0, limit).map(path => ({ path, score: 0.0 }))
}

// 默认导出 FileIndex 类
export default FileIndex
// 同时导出 FileIndex 类型别名，供外部按类型引用
export type { FileIndex as FileIndexType }
