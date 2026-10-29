import { readdir, rm, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { clearCommandsCache } from '../../commands.js'
import { clearAllOutputStylesCache } from '../../constants/outputStyles.js'
import { clearAgentDefinitionsCache } from '../../tools/AgentTool/loadAgentsDir.js'
import { clearPromptCache } from '../../tools/SkillTool/prompt.js'
import { resetSentSkillNames } from '../attachments.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { logError } from '../log.js'
import { loadInstalledPluginsFromDisk } from './installedPluginsManager.js'
import { clearPluginAgentCache } from './loadPluginAgents.js'
import { clearPluginCommandCache } from './loadPluginCommands.js'
import {
  clearPluginHookCache,
  pruneRemovedPluginHooks,
} from './loadPluginHooks.js'
import { clearPluginOutputStyleCache } from './loadPluginOutputStyles.js'
import { clearPluginCache, getPluginCachePath } from './pluginLoader.js'
import { clearPluginOptionsCache } from './pluginOptionsStorage.js'
import { isPluginZipCacheEnabled } from './zipCache.js'

const ORPHANED_AT_FILENAME = '.orphaned_at'
// 文件总述：插件缓存清理工具集，统一封装各类插件缓存（命令、代理、hook、选项、输出样式、zip）的清除，并处理孤儿版本目录的 7 天惰性清理。
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// ORPHANED_AT_FILENAME 与 CLEANUP_AGE_MS：孤儿标记文件名与 7 天清理阈值（毫秒）。

export function clearAllPluginCaches(): void {
  clearPluginCache()
  clearPluginCommandCache()
  clearPluginAgentCache()
  clearPluginHookCache()
  // Prune hooks from plugins no longer in the enabled set so uninstalled/
  // disabled plugins stop firing immediately (gh-36995). Prune-only: hooks
  // from newly-enabled plugins are NOT added here — they wait for
  // /reload-plugins like commands/agents/MCP do. Fire-and-forget: old hooks
  // stay valid until the prune completes (preserves gh-29767). No-op when
  // STATE.registeredHooks is empty (test/preload.ts beforeEach clears it via
  // resetStateForTests before reaching here).
  pruneRemovedPluginHooks().catch(e => logError(e))
  clearPluginOptionsCache()
  clearPluginOutputStyleCache()
  clearAllOutputStylesCache()
}
// clearAllPluginCaches：清除全部插件缓存；pruneRemovedPluginHooks 只剪不增（新启用插件的 hook 留给 /reload-plugins 处理）。

export function clearAllCaches(): void {
  clearAllPluginCaches()
  clearCommandsCache()
  clearAgentDefinitionsCache()
  clearPromptCache()
  resetSentSkillNames()
}
// clearAllCaches：在插件缓存之上再清命令、代理定义、提示缓存、已发送技能名。

/**
 * Mark a plugin version as orphaned.
 * Called when a plugin is uninstalled or updated to a new version.
 */
export async function markPluginVersionOrphaned(
  versionPath: string,
): Promise<void> {
  try {
    await writeFile(getOrphanedAtPath(versionPath), `${Date.now()}`, 'utf-8')
  } catch (error) {
    logForDebugging(`Failed to write .orphaned_at: ${versionPath}: ${error}`)
  }
}
// markPluginVersionOrphaned：卸载或升级时写 .orphaned_at 时间戳标记孤儿版本，失败仅记调试日志。

/**
 * Clean up orphaned plugin versions that have been orphaned for more than 7 days.
 *
 * Pass 1: Remove .orphaned_at from installed versions (clears stale markers)
 * Pass 2: For each cached version not in installed_plugins.json:
 *   - If no .orphaned_at exists: create it (handles old CC versions, manual edits)
 *   - If .orphaned_at exists and > 7 days old: delete the version
 */
export async function cleanupOrphanedPluginVersionsInBackground(): Promise<void> {
  // Zip cache mode stores plugins as .zip files, not directories. readSubdirs
  // filters to directories only, so removeIfEmpty would see plugin dirs as empty
  // and delete them (including the ZIPs). Skip cleanup entirely in zip mode.
  if (isPluginZipCacheEnabled()) {
    return
  }
  try {
    const installedVersions = getInstalledVersionPaths()
    if (!installedVersions) return

    const cachePath = getPluginCachePath()

    const now = Date.now()

    // Pass 1: Remove .orphaned_at from installed versions
    // This handles cases where a plugin was reinstalled after being orphaned
    await Promise.all(
      [...installedVersions].map(p => removeOrphanedAtMarker(p)),
    )

    // Pass 2: Process orphaned versions
    for (const marketplace of await readSubdirs(cachePath)) {
      const marketplacePath = join(cachePath, marketplace)

      for (const plugin of await readSubdirs(marketplacePath)) {
        const pluginPath = join(marketplacePath, plugin)

        for (const version of await readSubdirs(pluginPath)) {
          const versionPath = join(pluginPath, version)
          if (installedVersions.has(versionPath)) continue
          await processOrphanedPluginVersion(versionPath, now)
        }

        await removeIfEmpty(pluginPath)
      }

      await removeIfEmpty(marketplacePath)
    }
  } catch (error) {
    logForDebugging(`Plugin cache cleanup failed: ${error}`)
  }
}
// cleanupOrphanedPluginVersionsInBackground：两趟清理孤儿版本——先清已安装版本的标记，再对不在已装集合里的缓存版本补标或删除；zip 缓存模式下跳过整个清理以免把插件目录误删。

function getOrphanedAtPath(versionPath: string): string {
  return join(versionPath, ORPHANED_AT_FILENAME)
}
// getOrphanedAtPath：拼出某个版本目录下 .orphaned_at 的完整路径。

async function removeOrphanedAtMarker(versionPath: string): Promise<void> {
  const orphanedAtPath = getOrphanedAtPath(versionPath)
  try {
    await unlink(orphanedAtPath)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') return
    logForDebugging(`Failed to remove .orphaned_at: ${versionPath}: ${error}`)
  }
}
// removeOrphanedAtMarker：删除孤儿标记，ENOENT 视为已删除而忽略。

function getInstalledVersionPaths(): Set<string> | null {
  try {
    const paths = new Set<string>()
    const diskData = loadInstalledPluginsFromDisk()
    for (const installations of Object.values(diskData.plugins)) {
      for (const entry of installations) {
        paths.add(entry.installPath)
      }
    }
    return paths
  } catch (error) {
    logForDebugging(`Failed to load installed plugins: ${error}`)
    return null
  }
}
// getInstalledVersionPaths：从磁盘 installed_plugins.json 收集所有已装版本路径集合，失败返回 null 表示无法清理。

async function processOrphanedPluginVersion(
  versionPath: string,
  now: number,
): Promise<void> {
  const orphanedAtPath = getOrphanedAtPath(versionPath)

  let orphanedAt: number
  try {
    orphanedAt = (await stat(orphanedAtPath)).mtimeMs
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      await markPluginVersionOrphaned(versionPath)
      return
    }
    logForDebugging(`Failed to stat orphaned marker: ${versionPath}: ${error}`)
    return
  }

  if (now - orphanedAt > CLEANUP_AGE_MS) {
    try {
      await rm(versionPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(
        `Failed to delete orphaned version: ${versionPath}: ${error}`,
      )
    }
  }
}
// processOrphanedPluginVersion：无标记则补标；标记存在且超过 7 天则递归删除整版本目录。

async function removeIfEmpty(dirPath: string): Promise<void> {
  if ((await readSubdirs(dirPath)).length === 0) {
    try {
      await rm(dirPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(`Failed to remove empty dir: ${dirPath}: ${error}`)
    }
  }
}
// removeIfEmpty：目录为空时递归删除。

async function readSubdirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }
}
// readSubdirs：仅列出子目录名，读不到目录时容错返回空数组。
