import axios from 'axios'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { coerce } from 'semver'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { toError } from './errors.js'
import { logError } from './log.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'
import { gt } from './semver.js'

const MAX_RELEASE_NOTES_SHOWN = 5
// `MAX_RELEASE_NOTES_SHOWN` 每次最多展示的版本更新条数。

/**
 * We fetch the changelog from GitHub instead of bundling it with the build.
 *
 * This is necessary because Ink's static rendering makes it difficult to
 * dynamically update/show components after initial render. By storing the
 * changelog in config, we ensure it's available on the next startup without
 * requiring a full re-render of the current UI.
 *
 * The flow is:
 * 1. User updates to a new version
 * 2. We fetch the changelog in the background and store it in config
 * 3. Next time the user starts Claude, the cached changelog is available immediately
 */
export const CHANGELOG_URL =
  'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'
// `CHANGELOG_URL` 指向 GitHub 上的变更日志页面。
const RAW_CHANGELOG_URL =
  'https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md'

// `RAW_CHANGELOG_URL` 指向可直读的原始变更日志文件。
/**
 * Get the path for the cached changelog file.
 * The changelog is stored at ~/.claude/cache/changelog.md
 */
function getChangelogCachePath(): string {
  return join(getClaudeConfigHomeDir(), 'cache', 'changelog.md')
}
// `getChangelogCachePath` 返回缓存文件路径（位于配置目录的 cache 下）。

// In-memory cache populated by async reads. Sync callers (React render, sync
// helpers) read from this cache after setup.ts awaits checkForReleaseNotes().
let changelogMemoryCache: string | null = null
// `changelogMemoryCache` 内存缓存，供同步渲染路径读取，避免重读磁盘。

/** @internal exported for tests */
export function _resetChangelogCacheForTesting(): void {
  changelogMemoryCache = null
}
// `_resetChangelogCacheForTesting` 仅供测试重置内存缓存。

/**
 * Migrate changelog from old config-based storage to file-based storage.
 * This should be called once at startup to ensure the migration happens
 * before any other config saves that might re-add the deprecated field.
 */
export async function migrateChangelogFromConfig(): Promise<void> {
// `migrateChangelogFromConfig` 把旧的配置内存储迁移到文件。
  const config = getGlobalConfig()
  if (!config.cachedChangelog) {
    return
  }

  const cachePath = getChangelogCachePath()

  // If cache file doesn't exist, create it from old config
  try {
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, config.cachedChangelog, {
      encoding: 'utf-8',
      flag: 'wx', // Write only if file doesn't exist
    })
  } catch {
    // File already exists, which is fine - skip silently
  }

  // Remove the deprecated field from config
  saveGlobalConfig(({ cachedChangelog: _, ...rest }) => rest)
}
// 迁移结束，删除已废弃的 `cachedChangelog` 配置字段。

/**
 * Fetch the changelog from GitHub and store it in cache file
 * This runs in the background and doesn't block the UI
 */
export async function fetchAndStoreChangelog(): Promise<void> {
// `fetchAndStoreChangelog` 后台抓取变更日志并写入缓存，不阻塞界面。
  // Skip in noninteractive mode
  if (getIsNonInteractiveSession()) {
    return
  }

  // Skip network requests if nonessential traffic is disabled
  if (isEssentialTrafficOnly()) {
    return
  }
// 非交互会话或禁用非必要流量时跳过网络请求。

  const response = await axios.get(RAW_CHANGELOG_URL)
  if (response.status === 200) {
    const changelogContent = response.data

    // Skip write if content unchanged — writing Date.now() defeats the
    // dirty-check in saveGlobalConfig since the timestamp always differs.
    if (changelogContent === changelogMemoryCache) {
      return
    }

    const cachePath = getChangelogCachePath()

    // Ensure cache directory exists
    await mkdir(dirname(cachePath), { recursive: true })

    // Write changelog to cache file
    await writeFile(cachePath, changelogContent, { encoding: 'utf-8' })
    changelogMemoryCache = changelogContent
// 写入缓存文件并刷新抓取时间戳到配置。

    // Update timestamp in config
    const changelogLastFetched = Date.now()
    saveGlobalConfig(current => ({
      ...current,
      changelogLastFetched,
    }))
  }
}
// 抓取函数结束。

/**
 * Get the stored changelog from cache file if available.
 * Populates the in-memory cache for subsequent sync reads.
 * @returns The cached changelog content or empty string if not available
 */
export async function getStoredChangelog(): Promise<string> {
// `getStoredChangelog` 异步读取缓存文件并填充内存缓存。
  if (changelogMemoryCache !== null) {
    return changelogMemoryCache
  }
  const cachePath = getChangelogCachePath()
  try {
    const content = await readFile(cachePath, 'utf-8')
    changelogMemoryCache = content
    return content
  } catch {
    changelogMemoryCache = ''
    return ''
  }
}
// 读取结束，文件缺失时内存缓存置空并返回空串。

/**
 * Synchronous accessor for the changelog, reading only from the in-memory cache.
 * Returns empty string if the async getStoredChangelog() hasn't been called yet.
 * Intended for React render paths where async is not possible; setup.ts ensures
 * the cache is populated before first render via `await checkForReleaseNotes()`.
 */
export function getStoredChangelogFromMemory(): string {
// `getStoredChangelogFromMemory` 同步只读内存缓存，供 React 渲染使用。
  return changelogMemoryCache ?? ''
}
// 同步读取结束。

/**
 * Parses a changelog string in markdown format into a structured format
 * @param content - The changelog content string
 * @returns Record mapping version numbers to arrays of release notes
 */
export function parseChangelog(content: string): Record<string, string[]> {
// `parseChangelog` 把 Markdown 变更日志解析为版本号到条目数组的映射。
  try {
    if (!content) return {}

    // Parse the content
    const releaseNotes: Record<string, string[]> = {}

    // Split by heading lines (## X.X.X)
    const sections = content.split(/^## /gm).slice(1) // Skip the first section which is the header
// 按二级标题切分各版本区块，跳过文件头。

    for (const section of sections) {
      const lines = section.trim().split('\n')
      if (lines.length === 0) continue

      // Extract version from the first line
      // Handle both "1.2.3" and "1.2.3 - YYYY-MM-DD" formats
      const versionLine = lines[0]
      if (!versionLine) continue

      // First part before any dash is the version
      const version = versionLine.split(' - ')[0]?.trim() || ''
      if (!version) continue

      // Extract bullet points
      const notes = lines
        .slice(1)
        .filter(line => line.trim().startsWith('- '))
        .map(line => line.trim().substring(2).trim())
// 抽取每个版本下以短横开头的要点行作为更新说明。
        .filter(Boolean)

      if (notes.length > 0) {
        releaseNotes[version] = notes
      }
    }

    return releaseNotes
  } catch (error) {
    logError(toError(error))
    return {}
  }
}
// 解析结束，异常时记录日志并返回空对象。

/**
 * Gets release notes to show based on the previously seen version.
 * Shows up to MAX_RELEASE_NOTES_SHOWN items total, prioritizing the most recent versions.
 *
 * @param currentVersion - The current app version
 * @param previousVersion - The last version where release notes were seen (or null if first time)
 * @param readChangelog - Function to read the changelog (defaults to readChangelogFile)
 * @returns Array of release notes to display
 */
export function getRecentReleaseNotes(
// `getRecentReleaseNotes` 返回上次见过版本之后的更新说明。
  currentVersion: string,
  previousVersion: string | null | undefined,
  changelogContent: string = getStoredChangelogFromMemory(),
): string[] {
  try {
    const releaseNotes = parseChangelog(changelogContent)

    // Strip SHA from both versions to compare only the base versions
    const baseCurrentVersion = coerce(currentVersion)
    const basePreviousVersion = previousVersion ? coerce(previousVersion) : null

    if (
      !basePreviousVersion ||
      (baseCurrentVersion &&
        gt(baseCurrentVersion.version, basePreviousVersion.version))
    ) {
      // Get all versions that are newer than the last seen version
      return Object.entries(releaseNotes)
        .filter(
          ([version]) =>
            !basePreviousVersion || gt(version, basePreviousVersion.version),
        )
        .sort(([versionA], [versionB]) => (gt(versionA, versionB) ? -1 : 1)) // Sort newest first
        .flatMap(([_, notes]) => notes)
        .filter(Boolean)
        .slice(0, MAX_RELEASE_NOTES_SHOWN)
    }
// 只保留比上次版本更新的条目，按新版在前排序并截断到上限。
  } catch (error) {
    logError(toError(error))
    return []
  }
  return []
}
// 最近说明函数结束。

/**
 * Gets all release notes as an array of [version, notes] arrays.
 * Versions are sorted with oldest first.
 *
 * @param readChangelog - Function to read the changelog (defaults to readChangelogFile)
 * @returns Array of [version, notes[]] arrays
 */
export function getAllReleaseNotes(
// `getAllReleaseNotes` 返回全部版本与说明，旧版本在前。
  changelogContent: string = getStoredChangelogFromMemory(),
): Array<[string, string[]]> {
  try {
    const releaseNotes = parseChangelog(changelogContent)

    // Sort versions with oldest first
    const sortedVersions = Object.keys(releaseNotes).sort((a, b) =>
      gt(a, b) ? 1 : -1,
    )

    // Return array of [version, notes] arrays
    return sortedVersions
      .map(version => {
        const versionNotes = releaseNotes[version]
        if (!versionNotes || versionNotes.length === 0) return null

        const notes = versionNotes.filter(Boolean)
        if (notes.length === 0) return null

        return [version, notes] as [string, string[]]
      })
      .filter((item): item is [string, string[]] => item !== null)
  } catch (error) {
    logError(toError(error))
    return []
  }
}
// 全部说明函数结束。

/**
 * Checks if there are release notes to show based on the last seen version.
 * Can be used by multiple components to determine whether to display release notes.
 * Also triggers a fetch of the latest changelog if the version has changed.
 *
 * @param lastSeenVersion The last version of release notes the user has seen
 * @param currentVersion The current application version, defaults to MACRO.VERSION
 * @returns An object with hasReleaseNotes and the releaseNotes content
 */
export async function checkForReleaseNotes(
// `checkForReleaseNotes` 判断是否有新说明并触发后台重新抓取。
  lastSeenVersion: string | null | undefined,
  currentVersion: string = MACRO.VERSION,
): Promise<{ hasReleaseNotes: boolean; releaseNotes: string[] }> {
  // For Ant builds, use VERSION_CHANGELOG bundled at build time
  if (process.env.USER_TYPE === 'ant') {
    const changelog = MACRO.VERSION_CHANGELOG
    if (changelog) {
      const commits = changelog.trim().split('\n').filter(Boolean)
      return {
        hasReleaseNotes: commits.length > 0,
        releaseNotes: commits,
      }
    }
    return {
      hasReleaseNotes: false,
      releaseNotes: [],
    }
  }
// ant 构建使用构建时打包的 `VERSION_CHANGELOG`。

  // Ensure the in-memory cache is populated for subsequent sync reads
  const cachedChangelog = await getStoredChangelog()

  // If the version has changed or we don't have a cached changelog, fetch a new one
  // This happens in the background and doesn't block the UI
  if (lastSeenVersion !== currentVersion || !cachedChangelog) {
// 版本变化或缺失缓存时后台重新抓取，不阻塞界面。
    fetchAndStoreChangelog().catch(error => logError(toError(error)))
  }

  const releaseNotes = getRecentReleaseNotes(
    currentVersion,
    lastSeenVersion,
    cachedChangelog,
  )
  const hasReleaseNotes = releaseNotes.length > 0

  return {
    hasReleaseNotes,
    releaseNotes,
  }
}
// 检查函数结束，返回是否有更新说明与内容。

/**
 * Synchronous variant of checkForReleaseNotes for React render paths.
 * Reads only from the in-memory cache populated by the async version.
 * setup.ts awaits checkForReleaseNotes() before first render, so this
 * returns accurate results in component render bodies.
 */
export function checkForReleaseNotesSync(
// `checkForReleaseNotesSync` 同步变体，仅供 React 渲染路径使用。
  lastSeenVersion: string | null | undefined,
  currentVersion: string = MACRO.VERSION,
): { hasReleaseNotes: boolean; releaseNotes: string[] } {
  // For Ant builds, use VERSION_CHANGELOG bundled at build time
  if (process.env.USER_TYPE === 'ant') {
    const changelog = MACRO.VERSION_CHANGELOG
    if (changelog) {
      const commits = changelog.trim().split('\n').filter(Boolean)
      return {
        hasReleaseNotes: commits.length > 0,
        releaseNotes: commits,
      }
    }
    return {
      hasReleaseNotes: false,
      releaseNotes: [],
    }
  }

  const releaseNotes = getRecentReleaseNotes(currentVersion, lastSeenVersion)
  return {
    hasReleaseNotes: releaseNotes.length > 0,
    releaseNotes,
  }
}
// 同步检查结束。
