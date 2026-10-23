import { statSync } from 'fs'
import ignore from 'ignore'
import * as path from 'path'
import {
  CLAUDE_CONFIG_DIRECTORIES,
  loadMarkdownFilesForSubdir,
} from 'src/utils/markdownConfigLoader.js'
import type { SuggestionItem } from '../components/PromptInput/PromptInputFooterSuggestions.js'
import {
  CHUNK_MS,
  FileIndex,
  yieldToEventLoop,
} from '../native-ts/file-index/index.js'
import { logEvent } from '../services/analytics/index.js'
import type { FileSuggestionCommandInput } from '../types/fileSuggestion.js'
import { getGlobalConfig } from '../utils/config.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { findGitRoot, gitExe } from '../utils/git.js'
import {
  createBaseHookInput,
  executeFileSuggestionCommand,
} from '../utils/hooks.js'
import { logError } from '../utils/log.js'
import { expandPath } from '../utils/path.js'
import { ripGrep } from '../utils/ripgrep.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { createSignal } from '../utils/signal.js'

// Lazily constructed singleton
let fileIndex: FileIndex | null = null

function getFileIndex(): FileIndex {
  if (!fileIndex) {
    fileIndex = new FileIndex()
  }
  return fileIndex
}

let fileListRefreshPromise: Promise<FileIndex> | null = null
// Signal fired when an in-progress index build completes. Lets the
// typeahead UI re-run its last search so partial results upgrade to full.
const indexBuildComplete = createSignal()
export const onIndexBuildComplete = indexBuildComplete.subscribe
let cacheGeneration = 0
// 文件级：@ 文件补全的索引层，useTypeahead 的地基。模块级状态一份：FileIndex 单例（Rust nucleo 模糊搜索引擎）、刷新 Promise、构建完成信号、cacheGeneration（清缓存守卫）、tracked/config/dirs 三份缓存、ignore 模式缓存、节流状态、两份加载签名。

// Background fetch for untracked files
let untrackedFetchPromise: Promise<void> | null = null

// Store tracked files so we can rebuild index with untracked
let cachedTrackedFiles: string[] = []
// Store config files so mergeUntrackedIntoNormalizedCache preserves them
let cachedConfigFiles: string[] = []
// Store tracked directories so mergeUntrackedIntoNormalizedCache doesn't
// recompute ~270k path.dirname() calls on each merge
let cachedTrackedDirs: string[] = []

// Cache for .ignore/.rgignore patterns (keyed by repoRoot:cwd)
let ignorePatternsCache: ReturnType<typeof ignore> | null = null
let ignorePatternsCacheKey: string | null = null

// Throttle state for background refresh. .git/index mtime triggers an
// immediate refresh when tracked files change (add/checkout/commit/rm).
// The time floor still refreshes every 5s to pick up untracked files,
// which don't bump the index.
let lastRefreshMs = 0
let lastGitIndexMtime: number | null = null

// Signatures of the path lists loaded into the Rust index. Two separate
// signatures because the two loadFromFileList call sites use differently
// structured arrays — a shared signature would ping-pong and never match.
// Skips nucleo.restart() when git ls-files returns an unchanged list
// (e.g. `git add` of an already-tracked file bumps index mtime but not the list).
let loadedTrackedSignature: string | null = null
let loadedMergedSignature: string | null = null

/**
 * Clear all file suggestion caches.
 * Call this when resuming a session to ensure fresh file discovery.
 */
export function clearFileSuggestionCaches(): void {
  fileIndex = null
  fileListRefreshPromise = null
  cacheGeneration++
  untrackedFetchPromise = null
  cachedTrackedFiles = []
  cachedConfigFiles = []
  cachedTrackedDirs = []
  indexBuildComplete.clear()
  ignorePatternsCache = null
  ignorePatternsCacheKey = null
  lastRefreshMs = 0
  lastGitIndexMtime = null
  loadedTrackedSignature = null
  loadedMergedSignature = null
}
// clearFileSuggestionCaches：resume 会话时全清——文件发现必须重新来一遍，不能沿用上个 session 的索引。清 signal 也要做（订阅者持有的完成通知作废）。

/**
 * Content hash of a path list. A length|first|last sample misses renames of
 * middle files (same length, same endpoints → stale entry stuck in nucleo).
 *
 * Samples every Nth path (plus length). On a 346k-path list this hashes ~700
 * paths instead of 14MB — enough to catch git operations (checkout, rebase,
 * add/rm) while running in <1ms. A single mid-list rename that happens to
 * fall between samples will miss the rebuild, but the 5s refresh floor picks
 * it up on the next cycle.
 */
export function pathListSignature(paths: string[]): string {
  const n = paths.length
  const stride = Math.max(1, Math.floor(n / 500))
  let h = 0x811c9dc5 | 0
  for (let i = 0; i < n; i += stride) {
    const p = paths[i]!
    for (let j = 0; j < p.length; j++) {
      h = ((h ^ p.charCodeAt(j)) * 0x01000193) | 0
    }
    h = (h * 0x01000193) | 0
  }
  // Stride starts at 0 (first path always hashed); explicitly include last
  // so single-file add/rm at the tail is caught
  if (n > 0) {
    const last = paths[n - 1]!
    for (let j = 0; j < last.length; j++) {
      h = ((h ^ last.charCodeAt(j)) * 0x01000193) | 0
    }
  }
  return `${n}:${(h >>> 0).toString(16)}`
}
// pathListSignature：路径列表的内容指纹。为什么不用 length|first|last 采样——中间文件重命名时长度和端点都不变，陈旧条目会永久卡在 nucleo 里。改成每 500 个采一个 + 显式把最后一个路径并进去（单文件增删在尾部能被抓到），346k 路径只哈希 ~700 个，<1ms。采样间隙漏掉的中部单文件重命名靠 5s 刷新地板兜底。

/**
 * Stat .git/index to detect git state changes without spawning git ls-files.
 * Returns null for worktrees (.git is a file → ENOTDIR), fresh repos with no
 * index yet (ENOENT), and non-git dirs — caller falls back to time throttle.
 */
function getGitIndexMtime(): number | null {
  const repoRoot = findGitRoot(getCwd())
  if (!repoRoot) return null
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- mtimeMs is the operation here, not a pre-check. findGitRoot above already stat-walks synchronously; one more stat is marginal vs spawning git ls-files on every keystroke. Async would force startBackgroundCacheRefresh to become async, breaking the synchronous fileListRefreshPromise contract at the cold-start await site.
    return statSync(path.join(repoRoot, '.git', 'index')).mtimeMs
  } catch {
    return null
  }
}
// getGitIndexMtime：stat .git/index 检测 git 状态变化，不用每次击键都起 git ls-files。三种情况返回 null 让调用方回退时间节流：worktree（.git 是文件 → ENOTDIR）、新仓库还没 index（ENOENT）、非 git 目录。eslint-disable 注释解释了为什么这里刻意用同步 stat：mtimeMs 就是操作本身，上面 findGitRoot 已经同步 stat 走过一遍，异步反而会破坏 fileListRefreshPromise 的同步冷启动契约。

/**
 * Normalize git paths relative to originalCwd
 */
function normalizeGitPaths(
  files: string[],
  repoRoot: string,
  originalCwd: string,
): string[] {
  if (originalCwd === repoRoot) {
    return files
  }
  return files.map(f => {
    const absolutePath = path.join(repoRoot, f)
    return path.relative(originalCwd, absolutePath)
  })
}
// normalizeGitPaths：git ls-files 在 repoRoot 下跑、输出相对 repoRoot，而补全要相对 cwd——两者不同时全部重算。相同（cwd 就是根）时零拷贝返回。

/**
 * Merge already-normalized untracked files into the cache
 */
async function mergeUntrackedIntoNormalizedCache(
  normalizedUntracked: string[],
): Promise<void> {
  if (normalizedUntracked.length === 0) return
  if (!fileIndex || cachedTrackedFiles.length === 0) return

  const untrackedDirs = await getDirectoryNamesAsync(normalizedUntracked)
  const allPaths = [
    ...cachedTrackedFiles,
    ...cachedConfigFiles,
    ...cachedTrackedDirs,
    ...normalizedUntracked,
    ...untrackedDirs,
  ]
  const sig = pathListSignature(allPaths)
  if (sig === loadedMergedSignature) {
    logForDebugging(
      `[FileIndex] skipped index rebuild — merged paths unchanged`,
    )
    return
  }
  await fileIndex.loadFromFileListAsync(allPaths).done
  loadedMergedSignature = sig
  logForDebugging(
    `[FileIndex] rebuilt index with ${cachedTrackedFiles.length} tracked + ${normalizedUntracked.length} untracked files`,
  )
}
// mergeUntrackedIntoNormalizedCache：未跟踪文件后台合入。三道守卫：空列表、无索引、tracked 空。合并签名（loadedMergedSignature）与 tracked 签名分开——两个 loadFromFileList 调用点的数组结构不同，共用签名会乒乓永远不命中。

/**
 * Load ripgrep-specific ignore patterns from .ignore or .rgignore files
 * Returns an ignore instance if patterns were found, null otherwise
 * Results are cached per repoRoot:cwd combination
 */
async function loadRipgrepIgnorePatterns(
  repoRoot: string,
  cwd: string,
): Promise<ReturnType<typeof ignore> | null> {
  const cacheKey = `${repoRoot}:${cwd}`

  // Return cached result if available
  if (ignorePatternsCacheKey === cacheKey) {
    return ignorePatternsCache
  }

  const fs = getFsImplementation()
  const ignoreFiles = ['.ignore', '.rgignore']
  const directories = [...new Set([repoRoot, cwd])]

  const ig = ignore()
  let hasPatterns = false

  const paths = directories.flatMap(dir =>
    ignoreFiles.map(f => path.join(dir, f)),
  )
  const contents = await Promise.all(
    paths.map(p => fs.readFile(p, { encoding: 'utf8' }).catch(() => null)),
  )
  for (const [i, content] of contents.entries()) {
    if (content === null) continue
    ig.add(content)
    hasPatterns = true
    logForDebugging(`[FileIndex] loaded ignore patterns from ${paths[i]}`)
  }

  const result = hasPatterns ? ig : null
  ignorePatternsCache = result
  ignorePatternsCacheKey = cacheKey

  return result
}
// loadRipgrepIgnorePatterns：.ignore/.rgignore 是 ripgrep 专属的，git ls-files 不认识——所以 tracked 文件也要过一遍这个过滤器才能和 ripgrep 兜底路径的结果一致。按 repoRoot:cwd 缓存。

/**
 * Get files using git ls-files (much faster than ripgrep for git repos)
 * Returns tracked files immediately, fetches untracked in background
 * @param respectGitignore If true, excludes gitignored files from untracked results
 *
 * Note: Unlike ripgrep --follow, git ls-files doesn't follow symlinks.
 * This is intentional as git tracks symlinks as symlinks.
 */
async function getFilesUsingGit(
  abortSignal: AbortSignal,
  respectGitignore: boolean,
): Promise<string[] | null> {
  const startTime = Date.now()
  logForDebugging(`[FileIndex] getFilesUsingGit called`)

  // Check if we're in a git repo. findGitRoot is LRU-memoized per path.
  const repoRoot = findGitRoot(getCwd())
  if (!repoRoot) {
    logForDebugging(`[FileIndex] not a git repo, returning null`)
    return null
  }

  try {
    const cwd = getCwd()

    // Get tracked files (fast - reads from git index)
    // Run from repoRoot so paths are relative to repo root, not CWD
    const lsFilesStart = Date.now()
    const trackedResult = await execFileNoThrowWithCwd(
      gitExe(),
      ['-c', 'core.quotepath=false', 'ls-files', '--recurse-submodules'],
      { timeout: 5000, abortSignal, cwd: repoRoot },
    )
    logForDebugging(
      `[FileIndex] git ls-files (tracked) took ${Date.now() - lsFilesStart}ms`,
    )

    if (trackedResult.code !== 0) {
      logForDebugging(
        `[FileIndex] git ls-files failed (code=${trackedResult.code}, stderr=${trackedResult.stderr}), falling back to ripgrep`,
      )
      return null
    }

// getFilesUsingGit 的两个要点：① core.quotepath=false——git 默认把非 ASCII 路径转义成八进制，中文文件名会变乱码；② tracked 立即返回（读 index 快），untracked 后台拉（--others，可选 --exclude-standard 尊重 gitignore）。
    const trackedFiles = trackedResult.stdout.trim().split('\n').filter(Boolean)

    // Normalize paths relative to the current working directory
    let normalizedTracked = normalizeGitPaths(trackedFiles, repoRoot, cwd)

    // Apply .ignore/.rgignore patterns if present (faster than falling back to ripgrep)
    const ignorePatterns = await loadRipgrepIgnorePatterns(repoRoot, cwd)
    if (ignorePatterns) {
      const beforeCount = normalizedTracked.length
      normalizedTracked = ignorePatterns.filter(normalizedTracked)
      logForDebugging(
        `[FileIndex] applied ignore patterns: ${beforeCount} -> ${normalizedTracked.length} files`,
      )
    }

    // Cache tracked files for later merge with untracked
    cachedTrackedFiles = normalizedTracked

    const duration = Date.now() - startTime
    logForDebugging(
      `[FileIndex] git ls-files: ${normalizedTracked.length} tracked files in ${duration}ms`,
    )

    logEvent('tengu_file_suggestions_git_ls_files', {
      file_count: normalizedTracked.length,
      tracked_count: normalizedTracked.length,
      untracked_count: 0,
      duration_ms: duration,
    })

    // Start background fetch for untracked files (don't await)
    if (!untrackedFetchPromise) {
      const untrackedArgs = respectGitignore
        ? [
            '-c',
            'core.quotepath=false',
            'ls-files',
            '--others',
            '--exclude-standard',
          ]
        : ['-c', 'core.quotepath=false', 'ls-files', '--others']

      const generation = cacheGeneration
      untrackedFetchPromise = execFileNoThrowWithCwd(gitExe(), untrackedArgs, {
        timeout: 10000,
        cwd: repoRoot,
      })
        .then(async untrackedResult => {
          if (generation !== cacheGeneration) {
// generation 守卫：untracked 后台拉取期间缓存被清（resume），旧代结果不合入——陈旧文件不会污染新索引。
            return // Cache was cleared; don't merge stale untracked files
          }
          if (untrackedResult.code === 0) {
            const rawUntrackedFiles = untrackedResult.stdout
              .trim()
              .split('\n')
              .filter(Boolean)

            // Normalize paths BEFORE applying ignore patterns (consistent with tracked files)
            let normalizedUntracked = normalizeGitPaths(
              rawUntrackedFiles,
              repoRoot,
              cwd,
            )

            // Apply .ignore/.rgignore patterns to normalized untracked files
            const ignorePatterns = await loadRipgrepIgnorePatterns(
              repoRoot,
              cwd,
            )
            if (ignorePatterns && normalizedUntracked.length > 0) {
              const beforeCount = normalizedUntracked.length
              normalizedUntracked = ignorePatterns.filter(normalizedUntracked)
              logForDebugging(
                `[FileIndex] applied ignore patterns to untracked: ${beforeCount} -> ${normalizedUntracked.length} files`,
              )
            }

            logForDebugging(
              `[FileIndex] background untracked fetch: ${normalizedUntracked.length} files`,
            )
            // Pass already-normalized files directly to merge function
            void mergeUntrackedIntoNormalizedCache(normalizedUntracked)
          }
        })
        .catch(error => {
          logForDebugging(
            `[FileIndex] background untracked fetch failed: ${error}`,
          )
        })
        .finally(() => {
          untrackedFetchPromise = null
        })
    }

    return normalizedTracked
// tracked 路径同步返回，untracked 的 merge 是 void 异步——补全先能用（tracked 部分），完整列表随后到位。注释还说明与 ripgrep --follow 的差异：git 把 symlink 当 symlink 跟踪，不跟随，这是有意的。
  } catch (error) {
    logForDebugging(`[FileIndex] git ls-files error: ${errorMessage(error)}`)
    return null
  }
}

/**
 * This function collects all parent directories for each file path
 * and returns a list of unique directory names with a trailing separator.
 * For example, if the input is ['src/index.js', 'src/utils/helpers.js'],
 * the output will be ['src/', 'src/utils/'].
 * @param files An array of file paths
 * @returns An array of unique directory names with a trailing separator
 */
export function getDirectoryNames(files: string[]): string[] {
  const directoryNames = new Set<string>()
  collectDirectoryNames(files, 0, files.length, directoryNames)
  return [...directoryNames].map(d => d + path.sep)
}

/**
 * Async variant: yields every ~10k files so 270k+ file lists don't block
 * the main thread for >10ms at a time.
 */
export async function getDirectoryNamesAsync(
  files: string[],
): Promise<string[]> {
  const directoryNames = new Set<string>()
  // Time-based chunking: yield after CHUNK_MS of work so slow machines get
  // smaller chunks and stay responsive.
  let chunkStart = performance.now()
  for (let i = 0; i < files.length; i++) {
    collectDirectoryNames(files, i, i + 1, directoryNames)
    if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
      await yieldToEventLoop()
      chunkStart = performance.now()
    }
  }
  return [...directoryNames].map(d => d + path.sep)
}

function collectDirectoryNames(
  files: string[],
  start: number,
  end: number,
  out: Set<string>,
): void {
  for (let i = start; i < end; i++) {
    let currentDir = path.dirname(files[i]!)
    // Early exit if we've already processed this directory and all its parents.
    // Root detection: path.dirname returns its input at the root (fixed point),
    // so we stop when dirname stops changing. Checking this before add() keeps
    // the root out of the result set (matching the old path.parse().root guard).
    // This avoids path.parse() which allocates a 5-field object per file.
    while (currentDir !== '.' && !out.has(currentDir)) {
      const parent = path.dirname(currentDir)
      if (parent === currentDir) break
      out.add(currentDir)
      currentDir = parent
    }
  }
}
// collectDirectoryNames 的早退设计：path.dirname 在根目录返回自身（不动点），所以循环到 dirname 不再变化就停；先查 out.has 再 add 把根挡在结果外——省掉每文件一次的 path.parse()（那会分配五字段对象）。目录列表让补全能提示 src/ 这样的路径片段。

/**
 * Gets additional files from Claude config directories
 */
async function getClaudeConfigFiles(cwd: string): Promise<string[]> {
  const markdownFileArrays = await Promise.all(
    CLAUDE_CONFIG_DIRECTORIES.map(subdir =>
      loadMarkdownFilesForSubdir(subdir, cwd),
    ),
  )
  return markdownFileArrays.flatMap(markdownFiles =>
    markdownFiles.map(f => f.filePath),
  )
}

/**
 * Gets project files using git ls-files (fast) or ripgrep (fallback)
 */
async function getProjectFiles(
  abortSignal: AbortSignal,
  respectGitignore: boolean,
): Promise<string[]> {
  logForDebugging(
    `[FileIndex] getProjectFiles called, respectGitignore=${respectGitignore}`,
  )

  // Try git ls-files first (much faster for git repos)
  const gitFiles = await getFilesUsingGit(abortSignal, respectGitignore)
  if (gitFiles !== null) {
    logForDebugging(
      `[FileIndex] using git ls-files result (${gitFiles.length} files)`,
    )
    return gitFiles
  }

  // Fall back to ripgrep
  logForDebugging(
    `[FileIndex] git ls-files returned null, falling back to ripgrep`,
  )
  const startTime = Date.now()
  const rgArgs = [
    '--files',
    '--follow',
    '--hidden',
    '--glob',
    '!.git/',
    '--glob',
    '!.svn/',
    '--glob',
    '!.hg/',
    '--glob',
    '!.bzr/',
    '--glob',
    '!.jj/',
    '--glob',
    '!.sl/',
  ]
  if (!respectGitignore) {
    rgArgs.push('--no-ignore-vcs')
  }

  const files = await ripGrep(rgArgs, '.', abortSignal)
  const relativePaths = files.map(f => path.relative(getCwd(), f))

  const duration = Date.now() - startTime
  logForDebugging(
    `[FileIndex] ripgrep: ${relativePaths.length} files in ${duration}ms`,
  )

  logEvent('tengu_file_suggestions_ripgrep', {
    file_count: relativePaths.length,
    duration_ms: duration,
  })

  return relativePaths
}
// getProjectFiles：git 优先、ripgrep 兜底。ripgrep 参数 --follow（跟随 symlink）+ --hidden（含点文件）+ 六种 VCS 目录排除（.git/.svn/.hg/.bzr/.jj/.sl，jj 是 jujutsu）；respectGitignore=false 时才加 --no-ignore-vcs。

/**
 * Gets both files and their directory paths for providing path suggestions
 * Uses git ls-files for git repos (fast) or ripgrep as fallback
 * Returns a FileIndex populated for fast fuzzy search
 */
export async function getPathsForSuggestions(): Promise<FileIndex> {
  const signal = AbortSignal.timeout(10_000)
  const index = getFileIndex()

  try {
    // Check project settings first, then fall back to global config
    const projectSettings = getInitialSettings()
    const globalConfig = getGlobalConfig()
    const respectGitignore =
      projectSettings.respectGitignore ?? globalConfig.respectGitignore ?? true

    const cwd = getCwd()
    const [projectFiles, configFiles] = await Promise.all([
      getProjectFiles(signal, respectGitignore),
      getClaudeConfigFiles(cwd),
    ])

    // Cache for mergeUntrackedIntoNormalizedCache
    cachedConfigFiles = configFiles

    const allFiles = [...projectFiles, ...configFiles]
    const directories = await getDirectoryNamesAsync(allFiles)
    cachedTrackedDirs = directories
    const allPathsList = [...directories, ...allFiles]

    // Skip rebuild when the list is unchanged. This is the common case
    // during a typing session — git ls-files returns the same output.
    const sig = pathListSignature(allPathsList)
    if (sig !== loadedTrackedSignature) {
      // Await the full build so cold-start returns complete results. The
      // build yields every ~4ms so the UI stays responsive — user can keep
      // typing during the ~120ms wait without input lag.
      await index.loadFromFileListAsync(allPathsList).done
      loadedTrackedSignature = sig
      // We just replaced the merged index with tracked-only data. Force
      // the next untracked merge to rebuild even if its own sig matches.
      loadedMergedSignature = null
    } else {
      logForDebugging(
        `[FileIndex] skipped index rebuild — tracked paths unchanged`,
      )
    }
  } catch (error) {
    logError(error)
  }

  return index
}
// getPathsForSuggestions：respectGitignore 的优先级是项目设置 > 全局配置 > 默认 true。签名相同就跳过重建（打字期间的常见情况——ls-files 输出不变）；重建后把 loadedMergedSignature 置 null 强制下次合并重建（刚用 tracked-only 覆盖过合并索引，不强制的话合并签名还「匹配」着旧数据）。

/**
 * Finds the common prefix between two strings
 */
function findCommonPrefix(a: string, b: string): string {
  const minLength = Math.min(a.length, b.length)
  let i = 0
  while (i < minLength && a[i] === b[i]) {
    i++
  }
  return a.substring(0, i)
}

/**
 * Finds the longest common prefix among an array of suggestion items
 */
export function findLongestCommonPrefix(suggestions: SuggestionItem[]): string {
  if (suggestions.length === 0) return ''

  const strings = suggestions.map(item => item.displayText)
  let prefix = strings[0]!
  for (let i = 1; i < strings.length; i++) {
    const currentString = strings[i]!
    prefix = findCommonPrefix(prefix, currentString)
    if (prefix === '') return ''
  }
  return prefix
}
// findLongestCommonPrefix：Tab 渐进补全的依据——所有建议的公共前缀比已输入长才替换。

/**
 * Creates a file suggestion item
 */
function createFileSuggestionItem(
  filePath: string,
  score?: number,
): SuggestionItem {
  return {
    id: `file-${filePath}`,
    displayText: filePath,
    metadata: score !== undefined ? { score } : undefined,
  }
}

/**
 * Find matching files and folders for a given query using the TS file index
 */
const MAX_SUGGESTIONS = 15
function findMatchingFiles(
  fileIndex: FileIndex,
  partialPath: string,
): SuggestionItem[] {
  const results = fileIndex.search(partialPath, MAX_SUGGESTIONS)
  return results.map(result =>
    createFileSuggestionItem(result.path, result.score),
  )
}
// MAX_SUGGESTIONS=15：补全列表上限。findMatchingFiles 直接打 nucleo 索引的 search，score 进 metadata 备调试。

/**
 * Starts a background refresh of the file index cache if not already in progress.
 *
 * Throttled: when a cache already exists, we skip the refresh unless git state
 * has actually changed. This prevents every keystroke from spawning git ls-files
 * and rebuilding the nucleo index.
 */
const REFRESH_THROTTLE_MS = 5_000
export function startBackgroundCacheRefresh(): void {
  if (fileListRefreshPromise) return

  // Throttle only when a cache exists — cold start must always populate.
  // Refresh immediately when .git/index mtime changed (tracked files).
  // Otherwise refresh at most once per 5s — this floor picks up new UNTRACKED
  // files, which don't bump .git/index. The signature checks downstream skip
  // the rebuild when the 5s refresh finds nothing actually changed.
  const indexMtime = getGitIndexMtime()
  if (fileIndex) {
    const gitStateChanged =
      indexMtime !== null && indexMtime !== lastGitIndexMtime
    if (!gitStateChanged && Date.now() - lastRefreshMs < REFRESH_THROTTLE_MS) {
      return
    }
  }

  const generation = cacheGeneration
  const refreshStart = Date.now()
  // Ensure the FileIndex singleton exists — it's progressively queryable
  // via readyCount while the build runs. Callers searching early get partial
  // results; indexBuildComplete fires after .done so they can re-search.
  getFileIndex()
  fileListRefreshPromise = getPathsForSuggestions()
    .then(result => {
      if (generation !== cacheGeneration) {
        return result // Cache was cleared; don't overwrite with stale data
      }
      fileListRefreshPromise = null
      indexBuildComplete.emit()
      // Commit the start-time mtime observation on success. If git state
      // changed mid-refresh, the next call will see the newer mtime and
      // correctly refresh again.
      lastGitIndexMtime = indexMtime
      lastRefreshMs = Date.now()
      logForDebugging(
        `[FileIndex] cache refresh completed in ${Date.now() - refreshStart}ms`,
      )
      return result
    })
    .catch(error => {
      logForDebugging(
        `[FileIndex] Cache refresh failed: ${errorMessage(error)}`,
      )
      logError(error)
      if (generation === cacheGeneration) {
        fileListRefreshPromise = null // Allow retry on next call
      }
      return getFileIndex()
    })
}
// startBackgroundCacheRefresh 的节流设计（注释写得很细）：有缓存才节流，冷启动必须填充；.git/index mtime 变了立即刷（add/checkout/commit/rm 都动它）；否则最多 5s 一次——这个地板专捡未跟踪文件（它们不动 .git/index）。刷新期间索引是渐进可查的（readyCount），早到的搜索拿部分结果，构建完成后 indexBuildComplete 信号触发重搜。成功路径才提交 mtime 观察值——刷新中途 git 又变了，下次调用看到新 mtime 会再刷。

/**
 * Gets the top-level files and directories in the current working directory
 * @returns Array of file/directory paths in the current directory
 */
async function getTopLevelPaths(): Promise<string[]> {
  const fs = getFsImplementation()
  const cwd = getCwd()

  try {
    const entries = await fs.readdir(cwd)
    return entries.map(entry => {
      const fullPath = path.join(cwd, entry.name)
      const relativePath = path.relative(cwd, fullPath)
      // Add trailing separator for directories
      return entry.isDirectory() ? relativePath + path.sep : relativePath
    })
  } catch (error) {
    logError(error as Error)
    return []
  }
}
// getTopLevelPaths：空查询（或 ./）时列当前目录——用户打 @ 第一下看到的就是这层。

/**
 * Generate file suggestions for the current input and cursor position
 * @param partialPath The partial file path to match
 * @param showOnEmpty Whether to show suggestions even if partialPath is empty (used for @ symbol)
 */
export async function generateFileSuggestions(
  partialPath: string,
  showOnEmpty = false,
): Promise<SuggestionItem[]> {
  // If input is empty and we don't want to show suggestions on empty, return nothing
  if (!partialPath && !showOnEmpty) {
    return []
  }

  // Use custom command directly if configured. We don't mix in our config files
  // because the command returns pre-ranked results using its own search logic.
  if (getInitialSettings().fileSuggestion?.type === 'command') {
    const input: FileSuggestionCommandInput = {
      ...createBaseHookInput(),
      query: partialPath,
    }
    const results = await executeFileSuggestionCommand(input)
    return results.slice(0, MAX_SUGGESTIONS).map(createFileSuggestionItem)
  }

  // If the partial path is empty or just a dot, return current directory suggestions
  if (partialPath === '' || partialPath === '.' || partialPath === './') {
    const topLevelPaths = await getTopLevelPaths()
    startBackgroundCacheRefresh()
    return topLevelPaths.slice(0, MAX_SUGGESTIONS).map(createFileSuggestionItem)
  }

  const startTime = Date.now()

  try {
    // Kick a background refresh. The index is progressively queryable —
    // searches during build return partial results from ready chunks, and
    // the typeahead callback (setOnIndexBuildComplete) re-fires the search
    // when the build finishes to upgrade partial → full.
    const wasBuilding = fileListRefreshPromise !== null
    startBackgroundCacheRefresh()

    // Handle both './' and '.\'
    let normalizedPath = partialPath
    const currentDirPrefix = '.' + path.sep
    if (partialPath.startsWith(currentDirPrefix)) {
      normalizedPath = partialPath.substring(2)
    }

    // Handle tilde expansion for home directory
    if (normalizedPath.startsWith('~')) {
      normalizedPath = expandPath(normalizedPath)
    }

    const matches = fileIndex
      ? findMatchingFiles(fileIndex, normalizedPath)
      : []

    const duration = Date.now() - startTime
    logForDebugging(
      `[FileIndex] generateFileSuggestions: ${matches.length} results in ${duration}ms (${wasBuilding ? 'partial' : 'full'} index)`,
    )
    logEvent('tengu_file_suggestions_query', {
      duration_ms: duration,
      cache_hit: !wasBuilding,
      result_count: matches.length,
      query_length: partialPath.length,
    })

    return matches
  } catch (error) {
    logError(error)
    return []
  }
}
// generateFileSuggestions 的四条路径：① 自定义 command 优先——用户配了 fileSuggestion command 就全权交给它，不混 config 文件（命令用自己的排序逻辑返回预排结果）；② 空/点查询 → 顶层目录列表并踢一次后台刷新；③ 正常查询——先踢刷新（部分结果立即可用），处理 ./ 与 .\ 两种前缀、~ 家目录展开，然后查索引；④ 任何异常吞掉返回空（补全不该炸输入）。遥测区分 cache_hit（刷新是否在进行中）。

/**
 * Apply a file suggestion to the input
 */
export function applyFileSuggestion(
  suggestion: string | SuggestionItem,
  input: string,
  partialPath: string,
  startPos: number,
  onInputChange: (value: string) => void,
  setCursorOffset: (offset: number) => void,
): void {
  // Extract suggestion text from string or SuggestionItem
  const suggestionText =
    typeof suggestion === 'string' ? suggestion : suggestion.displayText

  // Replace the partial path with the selected file path
  const newInput =
    input.substring(0, startPos) +
    suggestionText +
    input.substring(startPos + partialPath.length)
  onInputChange(newInput)

  // Move cursor to end of the file path
  const newCursorPos = startPos + suggestionText.length
  setCursorOffset(newCursorPos)
}
// applyFileSuggestion：替换 token 并把光标移到路径末尾。accepts 字符串（公共前缀场景）或 SuggestionItem（选中场景）两种形态。
