// 文件级：本文件实现各类「过期文件清理」逻辑——消息日志、会话文件、计划文件、文件历史备份、调试日志、npm 缓存、旧版本等，按用户配置的保留天数（默认 30 天）统一删除，并在后台一键清理中组合调用。
import * as fs from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { logEvent } from '../services/analytics/index.js'
import { CACHE_PATHS } from './cachePaths.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { type FsOperations, getFsImplementation } from './fsOperations.js'
import { cleanupOldImageCaches } from './imageStore.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { cleanupOldVersions } from './nativeInstaller/index.js'
import { cleanupOldPastes } from './pasteStore.js'
import { getProjectsDir } from './sessionStorage.js'
import { getSettingsWithAllErrors } from './settings/allErrors.js'
import {
  getSettings_DEPRECATED,
  rawSettingsContainsKey,
} from './settings/settings.js'
import { TOOL_RESULTS_SUBDIR } from './toolResultStorage.js'
import { cleanupStaleAgentWorktrees } from './worktree.js'

const DEFAULT_CLEANUP_PERIOD_DAYS = 30
// 默认清理周期 30 天，可被设置项 cleanupPeriodDays 覆盖。

// `getCutoffDate`：根据保留天数算出过期时间线，早于它的文件算「旧」。
function getCutoffDate(): Date {
  const settings = getSettings_DEPRECATED() || {}
  const cleanupPeriodDays =
    settings.cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS
  const cleanupPeriodMs = cleanupPeriodDays * 24 * 60 * 60 * 1000
  return new Date(Date.now() - cleanupPeriodMs)
}

export type CleanupResult = {
// `CleanupResult`：清理结果只含两个计数——删除的消息数（含各类日志）与错误数。
  messages: number
  errors: number
}

// `addCleanupResults`：把两次清理结果的数量相加，便于累积统计。
export function addCleanupResults(
  a: CleanupResult,
  b: CleanupResult,
): CleanupResult {
  return {
    messages: a.messages + b.messages,
    errors: a.errors + b.errors,
  }
}

// `convertFileNameToDate`：文件名里 `:` 被替换成 `-`，这里用正则还原成 ISO 时间戳以便比较。
export function convertFileNameToDate(filename: string): Date {
  const isoStr = filename
    .split('.')[0]!
    .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z')
  return new Date(isoStr)
}

// `cleanupOldFilesInDirectory`：通用单目录清理——遍历文件、按时间裁剪、删除旧文件并按 isMessagePath 分流计数，目录不存在则静默跳过。
async function cleanupOldFilesInDirectory(
  dirPath: string,
  cutoffDate: Date,
  isMessagePath: boolean,
): Promise<CleanupResult> {
  const result: CleanupResult = { messages: 0, errors: 0 }

  try {
    const files = await getFsImplementation().readdir(dirPath)

    for (const file of files) {
      try {
        // Convert filename format where all ':.' were replaced with '-'
        const timestamp = convertFileNameToDate(file.name)
        if (timestamp < cutoffDate) {
          await getFsImplementation().unlink(join(dirPath, file.name))
          // Increment the appropriate counter
          if (isMessagePath) {
            result.messages++
          } else {
            result.errors++
          }
        }
      } catch (error) {
        // Log but continue processing other files
        logError(error as Error)
      }
    }
  } catch (error: unknown) {
    // Ignore if directory doesn't exist
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      logError(error)
    }
  }

  return result
}

// `cleanupOldMessageFiles`：清理错误日志与 MCP 日志目录下的旧文件。
export async function cleanupOldMessageFiles(): Promise<CleanupResult> {
  const fsImpl = getFsImplementation()
  const cutoffDate = getCutoffDate()
  const errorPath = CACHE_PATHS.errors()
  const baseCachePath = CACHE_PATHS.baseLogs()

  // Clean up message and error logs
  let result = await cleanupOldFilesInDirectory(errorPath, cutoffDate, false)

  // Clean up MCP logs
  try {
    let dirents
    try {
      dirents = await fsImpl.readdir(baseCachePath)
    } catch {
      return result
    }

    const mcpLogDirs = dirents
      .filter(
        dirent => dirent.isDirectory() && dirent.name.startsWith('mcp-logs-'),
      )
      .map(dirent => join(baseCachePath, dirent.name))

    for (const mcpLogDir of mcpLogDirs) {
      // Clean up files in MCP log directory
      result = addCleanupResults(
        result,
        await cleanupOldFilesInDirectory(mcpLogDir, cutoffDate, true),
      )
      await tryRmdir(mcpLogDir, fsImpl)
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      logError(error)
    }
  }

  return result
}

// `unlinkIfOld`/`tryRmdir`：两个小工具——按 mtime 判断是否过期再删；rmdir 失败（非空/不存在）则忽略。
async function unlinkIfOld(
  filePath: string,
  cutoffDate: Date,
  fsImpl: FsOperations,
): Promise<boolean> {
  const stats = await fsImpl.stat(filePath)
  if (stats.mtime < cutoffDate) {
    await fsImpl.unlink(filePath)
    return true
  }
  return false
}

async function tryRmdir(dirPath: string, fsImpl: FsOperations): Promise<void> {
  try {
    await fsImpl.rmdir(dirPath)
  } catch {
    // not empty / doesn't exist
  }
}

// `cleanupOldSessionFiles`：递归清理各项目目录下旧的 .jsonl/.cast 会话文件，以及其内的 tool-results 子目录，逐层尝试删除空目录。
export async function cleanupOldSessionFiles(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result: CleanupResult = { messages: 0, errors: 0 }
  const projectsDir = getProjectsDir()
  const fsImpl = getFsImplementation()

  let projectDirents
  try {
    projectDirents = await fsImpl.readdir(projectsDir)
  } catch {
    return result
  }

  for (const projectDirent of projectDirents) {
    if (!projectDirent.isDirectory()) continue
    const projectDir = join(projectsDir, projectDirent.name)

    // Single readdir per project directory — partition into files and session dirs
    let entries
    try {
      entries = await fsImpl.readdir(projectDir)
    } catch {
      result.errors++
      continue
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        if (!entry.name.endsWith('.jsonl') && !entry.name.endsWith('.cast')) {
          continue
        }
        try {
          if (
            await unlinkIfOld(join(projectDir, entry.name), cutoffDate, fsImpl)
          ) {
            result.messages++
          }
        } catch {
          result.errors++
        }
      } else if (entry.isDirectory()) {
        // Session directory — clean up tool-results/<toolDir>/* beneath it
        const sessionDir = join(projectDir, entry.name)
        const toolResultsDir = join(sessionDir, TOOL_RESULTS_SUBDIR)
        let toolDirs
        try {
          toolDirs = await fsImpl.readdir(toolResultsDir)
        } catch {
          // No tool-results dir — still try to remove an empty session dir
          await tryRmdir(sessionDir, fsImpl)
          continue
        }
        for (const toolEntry of toolDirs) {
          if (toolEntry.isFile()) {
            try {
              if (
                await unlinkIfOld(
                  join(toolResultsDir, toolEntry.name),
                  cutoffDate,
                  fsImpl,
                )
              ) {
                result.messages++
              }
            } catch {
              result.errors++
            }
          } else if (toolEntry.isDirectory()) {
            const toolDirPath = join(toolResultsDir, toolEntry.name)
            let toolFiles
            try {
              toolFiles = await fsImpl.readdir(toolDirPath)
            } catch {
              continue
            }
            for (const tf of toolFiles) {
              if (!tf.isFile()) continue
              try {
                if (
                  await unlinkIfOld(
                    join(toolDirPath, tf.name),
                    cutoffDate,
                    fsImpl,
                  )
                ) {
                  result.messages++
                }
              } catch {
                result.errors++
              }
            }
            await tryRmdir(toolDirPath, fsImpl)
          }
        }
        await tryRmdir(toolResultsDir, fsImpl)
        await tryRmdir(sessionDir, fsImpl)
      }
    }

    await tryRmdir(projectDir, fsImpl)
  }

  return result
}

/**
 * Generic helper for cleaning up old files in a single directory
 * @param dirPath Path to the directory to clean
 * @param extension File extension to filter (e.g., '.md', '.jsonl')
 * @param removeEmptyDir Whether to remove the directory if empty after cleanup
 */
// `cleanupSingleDirectory`：通用单目录清理封装（按扩展名过滤），供计划文件等小目录复用。
async function cleanupSingleDirectory(
  dirPath: string,
  extension: string,
  removeEmptyDir: boolean = true,
): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result: CleanupResult = { messages: 0, errors: 0 }
  const fsImpl = getFsImplementation()

  let dirents
  try {
    dirents = await fsImpl.readdir(dirPath)
  } catch {
    return result
  }

  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith(extension)) continue
    try {
      if (await unlinkIfOld(join(dirPath, dirent.name), cutoffDate, fsImpl)) {
        result.messages++
      }
    } catch {
      result.errors++
    }
  }

  if (removeEmptyDir) {
    await tryRmdir(dirPath, fsImpl)
  }

  return result
}

// `cleanupOldPlanFiles`：清理 `~/.claude/plans` 下的旧 .md 计划文件。
export function cleanupOldPlanFiles(): Promise<CleanupResult> {
  const plansDir = join(getClaudeConfigHomeDir(), 'plans')
  return cleanupSingleDirectory(plansDir, '.md')
}

// `cleanupOldFileHistoryBackups`：并行删除过期的文件历史会话快照目录。
export async function cleanupOldFileHistoryBackups(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result: CleanupResult = { messages: 0, errors: 0 }
  const fsImpl = getFsImplementation()

  try {
    const configDir = getClaudeConfigHomeDir()
    const fileHistoryStorageDir = join(configDir, 'file-history')

    let dirents
    try {
      dirents = await fsImpl.readdir(fileHistoryStorageDir)
    } catch {
      return result
    }

    const fileHistorySessionsDirs = dirents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => join(fileHistoryStorageDir, dirent.name))

    await Promise.all(
      fileHistorySessionsDirs.map(async fileHistorySessionDir => {
        try {
          const stats = await fsImpl.stat(fileHistorySessionDir)
          if (stats.mtime < cutoffDate) {
            await fsImpl.rm(fileHistorySessionDir, {
              recursive: true,
              force: true,
            })
            result.messages++
          }
        } catch {
          result.errors++
        }
      }),
    )

    await tryRmdir(fileHistoryStorageDir, fsImpl)
  } catch (error) {
    logError(error as Error)
  }

  return result
}

// `cleanupOldSessionEnvDirs`：清理过期的会话环境目录（`session-env`）。
export async function cleanupOldSessionEnvDirs(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result: CleanupResult = { messages: 0, errors: 0 }
  const fsImpl = getFsImplementation()

  try {
    const configDir = getClaudeConfigHomeDir()
    const sessionEnvBaseDir = join(configDir, 'session-env')

    let dirents
    try {
      dirents = await fsImpl.readdir(sessionEnvBaseDir)
    } catch {
      return result
    }

    const sessionEnvDirs = dirents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => join(sessionEnvBaseDir, dirent.name))

    for (const sessionEnvDir of sessionEnvDirs) {
      try {
        const stats = await fsImpl.stat(sessionEnvDir)
        if (stats.mtime < cutoffDate) {
          await fsImpl.rm(sessionEnvDir, { recursive: true, force: true })
          result.messages++
        }
      } catch {
        result.errors++
      }
    }

    await tryRmdir(sessionEnvBaseDir, fsImpl)
  } catch (error) {
    logError(error as Error)
  }

  return result
}

/**
 * Cleans up old debug log files from ~/.claude/debug/
 * Preserves the 'latest' symlink which points to the current session's log.
 * Debug logs can grow very large (especially with the infinite logging loop bug)
 * and accumulate indefinitely without this cleanup.
 */
// `cleanupOldDebugLogs`：清理 `~/.claude/debug` 下的旧 .txt 调试日志，但保留 `latest` 软链与调试目录本身。
export async function cleanupOldDebugLogs(): Promise<CleanupResult> {
  const cutoffDate = getCutoffDate()
  const result: CleanupResult = { messages: 0, errors: 0 }
  const fsImpl = getFsImplementation()
  const debugDir = join(getClaudeConfigHomeDir(), 'debug')

  let dirents
  try {
    dirents = await fsImpl.readdir(debugDir)
  } catch {
    return result
  }

  for (const dirent of dirents) {
    // Preserve the 'latest' symlink
    if (
      !dirent.isFile() ||
      !dirent.name.endsWith('.txt') ||
      dirent.name === 'latest'
    ) {
      continue
    }
    try {
      if (await unlinkIfOld(join(debugDir, dirent.name), cutoffDate, fsImpl)) {
        result.messages++
      }
    } catch {
      result.errors++
    }
  }

  // Intentionally do NOT remove debugDir even if empty — needed for future logs
  return result
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Clean up old npm cache entries for Anthropic packages.
 * This helps reduce disk usage since we publish many dev versions per day.
 * Only runs once per day for Ant users.
 */
// `cleanupNpmCacheForAnthropicPackages`：为蚂蚁内网用户清理 npm 缓存里的 Anthropic 包旧版本——每天最多一次（标记文件+锁），用流式列举避免整库 GC 卡死事件循环。
export async function cleanupNpmCacheForAnthropicPackages(): Promise<void> {
  const markerPath = join(getClaudeConfigHomeDir(), '.npm-cache-cleanup')

  try {
    const stat = await fs.stat(markerPath)
    if (Date.now() - stat.mtimeMs < ONE_DAY_MS) {
      logForDebugging('npm cache cleanup: skipping, ran recently')
      return
    }
  } catch {
    // File doesn't exist, proceed with cleanup
  }

  try {
    await lockfile.lock(markerPath, { retries: 0, realpath: false })
  } catch {
    logForDebugging('npm cache cleanup: skipping, lock held')
    return
  }

  logForDebugging('npm cache cleanup: starting')

  const npmCachePath = join(homedir(), '.npm', '_cacache')

  const NPM_CACHE_RETENTION_COUNT = 5

  const startTime = Date.now()
  try {
    const cacache = await import('cacache')
    const cutoff = startTime - ONE_DAY_MS

    // Stream index entries and collect all Anthropic package entries.
    // Previous implementation used cacache.verify() which does a full
    // integrity check + GC of the ENTIRE cache — O(all content blobs).
    // On large caches this took 60+ seconds and blocked the event loop.
    const stream = cacache.ls.stream(npmCachePath)
    const anthropicEntries: { key: string; time: number }[] = []
    for await (const entry of stream as AsyncIterable<{
      key: string
      time: number
    }>) {
      if (entry.key.includes('@anthropic-ai/claude-')) {
        anthropicEntries.push({ key: entry.key, time: entry.time })
      }
    }

    // Group by package name (everything before the last @version separator)
    const byPackage = new Map<string, { key: string; time: number }[]>()
    for (const entry of anthropicEntries) {
      const atVersionIdx = entry.key.lastIndexOf('@')
      const pkgName =
        atVersionIdx > 0 ? entry.key.slice(0, atVersionIdx) : entry.key
      const existing = byPackage.get(pkgName) ?? []
      existing.push(entry)
      byPackage.set(pkgName, existing)
    }

    // Remove entries older than 1 day OR beyond the top N most recent per package
    const keysToRemove: string[] = []
    for (const [, entries] of byPackage) {
      entries.sort((a, b) => b.time - a.time) // newest first
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        if (entry.time < cutoff || i >= NPM_CACHE_RETENTION_COUNT) {
          keysToRemove.push(entry.key)
        }
      }
    }

    await Promise.all(
      keysToRemove.map(key => cacache.rm.entry(npmCachePath, key)),
    )

    await fs.writeFile(markerPath, new Date().toISOString())

    const durationMs = Date.now() - startTime
    if (keysToRemove.length > 0) {
      logForDebugging(
        `npm cache cleanup: Removed ${keysToRemove.length} old @anthropic-ai entries in ${durationMs}ms`,
      )
    } else {
      logForDebugging(`npm cache cleanup: completed in ${durationMs}ms`)
    }
    logEvent('tengu_npm_cache_cleanup', {
      success: true,
      durationMs,
      entriesRemoved: keysToRemove.length,
    })
  } catch (error) {
    logError(error as Error)
    logEvent('tengu_npm_cache_cleanup', {
      success: false,
      durationMs: Date.now() - startTime,
    })
  } finally {
    await lockfile.unlock(markerPath, { realpath: false }).catch(() => {})
  }
}

/**
 * Throttled wrapper around cleanupOldVersions for recurring cleanup in long-running sessions.
 * Uses a marker file and lock to ensure it runs at most once per 24 hours,
 * and does not block if another process is already running cleanup.
 * The regular cleanupOldVersions() should still be used for installer flows.
 */
// `cleanupOldVersionsThrottled`：带节流封装的版本清理，24 小时内至多一次且不阻塞。
export async function cleanupOldVersionsThrottled(): Promise<void> {
  const markerPath = join(getClaudeConfigHomeDir(), '.version-cleanup')

  try {
    const stat = await fs.stat(markerPath)
    if (Date.now() - stat.mtimeMs < ONE_DAY_MS) {
      logForDebugging('version cleanup: skipping, ran recently')
      return
    }
  } catch {
    // File doesn't exist, proceed with cleanup
  }

  try {
    await lockfile.lock(markerPath, { retries: 0, realpath: false })
  } catch {
    logForDebugging('version cleanup: skipping, lock held')
    return
  }

  logForDebugging('version cleanup: starting (throttled)')

  try {
    await cleanupOldVersions()
    await fs.writeFile(markerPath, new Date().toISOString())
  } catch (error) {
    logError(error as Error)
  } finally {
    await lockfile.unlock(markerPath, { realpath: false }).catch(() => {})
  }
}

// `cleanupOldMessageFilesInBackground`：后台总清理——依序清理消息/会话/计划/文件历史/session-env/调试/图片/粘贴/工树，并额外跑蚂蚁内网的 npm 缓存清理；设置校验出错但显式设了保留期时整段跳过以免误删。
export async function cleanupOldMessageFilesInBackground(): Promise<void> {
  // If settings have validation errors but the user explicitly set cleanupPeriodDays,
  // skip cleanup entirely rather than falling back to the default (30 days).
  // This prevents accidentally deleting files when the user intended a different retention period.
  const { errors } = getSettingsWithAllErrors()
  if (errors.length > 0 && rawSettingsContainsKey('cleanupPeriodDays')) {
    logForDebugging(
      'Skipping cleanup: settings have validation errors but cleanupPeriodDays was explicitly set. Fix settings errors to enable cleanup.',
    )
    return
  }

  await cleanupOldMessageFiles()
  await cleanupOldSessionFiles()
  await cleanupOldPlanFiles()
  await cleanupOldFileHistoryBackups()
  await cleanupOldSessionEnvDirs()
  await cleanupOldDebugLogs()
  await cleanupOldImageCaches()
  await cleanupOldPastes(getCutoffDate())
  const removedWorktrees = await cleanupStaleAgentWorktrees(getCutoffDate())
  if (removedWorktrees > 0) {
    logEvent('tengu_worktree_cleanup', { removed: removedWorktrees })
  }
  if (process.env.USER_TYPE === 'ant') {
    await cleanupNpmCacheForAnthropicPackages()
  }
}
