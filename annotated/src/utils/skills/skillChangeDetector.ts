import chokidar, { type FSWatcher } from 'chokidar'
import * as platformPath from 'path'
import { getAdditionalDirectoriesForClaudeMd } from '../../bootstrap/state.js'
import {
  clearCommandMemoizationCaches,
  clearCommandsCache,
} from '../../commands.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  clearSkillCaches,
  getSkillsPath,
  onDynamicSkillsLoaded,
} from '../../skills/loadSkillsDir.js'
import { resetSentSkillNames } from '../attachments.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { getFsImplementation } from '../fsOperations.js'
import { executeConfigChangeHooks, hasBlockingResult } from '../hooks.js'
import { createSignal } from '../signal.js'
// 技能与命令目录的文件监听模块，用 chokidar 监听变更并去抖触发重载，Bun 下改用 stat 轮询规避死锁。

/**
 * Time in milliseconds to wait for file writes to stabilize before processing.
 */
const FILE_STABILITY_THRESHOLD_MS = 1000

/**
 * Polling interval in milliseconds for checking file stability.
 */
const FILE_STABILITY_POLL_INTERVAL_MS = 500

/**
 * Time in milliseconds to debounce rapid skill change events into a single
 * reload. Prevents cascading reloads when many skill files change at once
 * (e.g. during auto-update or when another session modifies skill directories).
 * Without this, each file change triggers a full clearSkillCaches() +
 * clearCommandsCache() + listener notification cycle, which can deadlock the
 * event loop when dozens of events fire in rapid succession.
 */
const RELOAD_DEBOUNCE_MS = 300

/**
 * Polling interval for chokidar when usePolling is enabled.
 * Skill files change rarely (manual edits, git operations), so a 2s interval
 * trades negligible latency for far fewer stat() calls than the default 100ms.
 */
const POLLING_INTERVAL_MS = 2000

/**
 * Bun's native fs.watch() has a PathWatcherManager deadlock (oven-sh/bun#27469,
 * #26385): closing a watcher on the main thread while the File Watcher thread
 * is delivering events can hang both threads in __ulock_wait2 forever. Chokidar
 * with depth: 2 on large skill trees (hundreds of subdirs) triggers this
 * reliably when a git operation touches many directories at once — chokidar
 * internally closes/reopens per-directory FSWatchers as dirs are added/removed.
 *
 * Workaround: use stat() polling under Bun. No FSWatcher = no deadlock.
 * The fix is pending upstream; remove this once the Bun PR lands.
 */
const USE_POLLING = typeof Bun !== 'undefined'
// 在 Bun 下改用 stat 轮询以规避其 fs.watch 死锁缺陷，因为无 FSWatcher 即无死锁。

let watcher: FSWatcher | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
const pendingChangedPaths = new Set<string>()
let initialized = false
let disposed = false
let dynamicSkillsCallbackRegistered = false
let unregisterCleanup: (() => void) | null = null
const skillsChanged = createSignal()

// Test overrides for timing constants
let testOverrides: {
  stabilityThreshold?: number
  pollInterval?: number
  reloadDebounce?: number
  /** Chokidar fs.stat polling interval when USE_POLLING is active. */
  chokidarInterval?: number
} | null = null

/**
 * Initialize file watching for skill directories
 */
export async function initialize(): Promise<void> {
  if (initialized || disposed) return
  initialized = true

  // Register callback for when dynamic skills are loaded (only once)
  if (!dynamicSkillsCallbackRegistered) {
    dynamicSkillsCallbackRegistered = true
    onDynamicSkillsLoaded(() => {
      // Clear memoization caches so new skills are picked up
      // Note: we use clearCommandMemoizationCaches (not clearCommandsCache)
      // because clearCommandsCache would call clearSkillCaches which
      // wipes out the dynamic skills we just loaded
      clearCommandMemoizationCaches()
      // Notify listeners that skills changed
      skillsChanged.emit()
    })
  }

  const paths = await getWatchablePaths()
  if (paths.length === 0) return

  logForDebugging(
    `Watching for changes in skill/command directories: ${paths.join(', ')}...`,
  )

  watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    depth: 2, // Skills use skill-name/SKILL.md format
    awaitWriteFinish: {
      stabilityThreshold:
        testOverrides?.stabilityThreshold ?? FILE_STABILITY_THRESHOLD_MS,
      pollInterval:
        testOverrides?.pollInterval ?? FILE_STABILITY_POLL_INTERVAL_MS,
    },
    // Ignore special file types (sockets, FIFOs, devices) - they cannot be watched
    // and will error with EOPNOTSUPP on macOS. Only allow regular files and directories.
    ignored: (path, stats) => {
      if (stats && !stats.isFile() && !stats.isDirectory()) return true
      // Ignore .git directories
      return path.split(platformPath.sep).some(dir => dir === '.git')
    },
    ignorePermissionErrors: true,
    usePolling: USE_POLLING,
    interval: testOverrides?.chokidarInterval ?? POLLING_INTERVAL_MS,
    atomic: true,
  })

  watcher.on('add', handleChange)
  watcher.on('change', handleChange)
  watcher.on('unlink', handleChange)

  // Register cleanup to properly dispose of the file watcher during graceful shutdown
  unregisterCleanup = registerCleanup(async () => {
    await dispose()
  })
}
// 初始化技能与命令目录的文件监听，注册清理钩子以便优雅关闭时正确释放 watcher。

/**
 * Clean up file watcher
 */
export function dispose(): Promise<void> {
  disposed = true
  if (unregisterCleanup) {
    unregisterCleanup()
    unregisterCleanup = null
  }
  let closePromise: Promise<void> = Promise.resolve()
  if (watcher) {
    closePromise = watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  pendingChangedPaths.clear()
  skillsChanged.clear()
  return closePromise
}
// 释放文件 watcher，关闭监听、清除定时器与待处理路径集合。

/**
 * Subscribe to skill changes
 */
export const subscribe = skillsChanged.subscribe
// 暴露订阅接口，让外部监听技能变化事件。

async function getWatchablePaths(): Promise<string[]> {
  const fs = getFsImplementation()
  const paths: string[] = []

  // User skills directory (~/.claude/skills)
  const userSkillsPath = getSkillsPath('userSettings', 'skills')
  if (userSkillsPath) {
    try {
      await fs.stat(userSkillsPath)
      paths.push(userSkillsPath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // User commands directory (~/.claude/commands)
  const userCommandsPath = getSkillsPath('userSettings', 'commands')
  if (userCommandsPath) {
    try {
      await fs.stat(userCommandsPath)
      paths.push(userCommandsPath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // Project skills directory (.claude/skills)
  const projectSkillsPath = getSkillsPath('projectSettings', 'skills')
  if (projectSkillsPath) {
    try {
      // For project settings, resolve to absolute path
      const absolutePath = platformPath.resolve(projectSkillsPath)
      await fs.stat(absolutePath)
      paths.push(absolutePath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // Project commands directory (.claude/commands)
  const projectCommandsPath = getSkillsPath('projectSettings', 'commands')
  if (projectCommandsPath) {
    try {
      // For project settings, resolve to absolute path
      const absolutePath = platformPath.resolve(projectCommandsPath)
      await fs.stat(absolutePath)
      paths.push(absolutePath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // Additional directories (--add-dir) skills
  for (const dir of getAdditionalDirectoriesForClaudeMd()) {
    const additionalSkillsPath = platformPath.join(dir, '.claude', 'skills')
    try {
      await fs.stat(additionalSkillsPath)
      paths.push(additionalSkillsPath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  return paths
}
// 收集所有可监听路径，含用户/项目技能与命令目录以及附加目录，不存在则跳过。

function handleChange(path: string): void {
  logForDebugging(`Detected skill change: ${path}`)
  logEvent('tengu_skill_file_changed', {
    source:
      'chokidar' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  scheduleReload(path)
}
// 任一文件增删改都记录路径、发埋点，并调度一次去抖重载。

/**
 * Debounce rapid skill changes into a single reload. When many skill files
 * change at once (e.g. auto-update installs a new binary and a new session
 * touches skill directories), each file fires its own chokidar event. Without
 * debouncing, each event triggers clearSkillCaches() + clearCommandsCache() +
 * listener notification — 30 events means 30 full reload cycles, which can
 * deadlock the Bun event loop via rapid FSWatcher watch/unwatch churn.
 */
function scheduleReload(changedPath: string): void {
  pendingChangedPaths.add(changedPath)
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(async () => {
    reloadTimer = null
    const paths = [...pendingChangedPaths]
    pendingChangedPaths.clear()
    // Fire ConfigChange hook once for the batch — the hook query is always
    // 'skills' so firing per-path (which can be hundreds during a git
    // operation) just spams the hook matcher with identical queries. Pass the
    // first path as a representative; hooks can inspect all paths via the
    // skills directory if they need the full set.
    const results = await executeConfigChangeHooks('skills', paths[0]!)
    if (hasBlockingResult(results)) {
      logForDebugging(
        `ConfigChange hook blocked skill reload (${paths.length} paths)`,
      )
      return
    }
    clearSkillCaches()
    clearCommandsCache()
    resetSentSkillNames()
    skillsChanged.emit()
  }, testOverrides?.reloadDebounce ?? RELOAD_DEBOUNCE_MS)
}
// 把多次快速变更去抖成单次重载，按批次触发 ConfigChange 钩子再清空缓存并发事件。

/**
 * Reset internal state for testing purposes only.
 */
export async function resetForTesting(overrides?: {
  stabilityThreshold?: number
  pollInterval?: number
  reloadDebounce?: number
  chokidarInterval?: number
}): Promise<void> {
  // Clean up existing watcher if present to avoid resource leaks
  if (watcher) {
    await watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  pendingChangedPaths.clear()
  skillsChanged.clear()
  initialized = false
  disposed = false
  testOverrides = overrides ?? null
}
// 仅供测试重置内部状态，关闭已有 watcher 并清空所有计时与缓存。

export const skillChangeDetector = {
  initialize,
  dispose,
  subscribe,
  resetForTesting,
}
// 对外聚合导出 initialize/dispose/subscribe/resetForTesting 四个方法。
