/**
 * Flagged plugin tracking utilities
 *
 * Tracks plugins that were auto-removed because they were delisted from
 * their marketplace. Data is stored in ~/.claude/plugins/flagged-plugins.json.
 * Flagged plugins appear in a "Flagged" section in /plugins until the user
 * dismisses them.
 *
 * Uses a module-level cache so that getFlaggedPlugins() can be called
 * synchronously during React render. The cache is populated on the first
 * async call (loadFlaggedPlugins or addFlaggedPlugin) and kept in sync
 * with writes.
 */

import { randomBytes } from 'crypto'
import { readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getPluginsDirectory } from './pluginDirectories.js'

const FLAGGED_PLUGINS_FILENAME = 'flagged-plugins.json'
// 被下架插件的记录文件名：flagged-plugins.json，放在插件目录下。

export type FlaggedPlugin = {
  flaggedAt: string
  seenAt?: string
}
// FlaggedPlugin：记下被标记时间，seenAt 可选（标记已看到，用于 48 小时过期）。

const SEEN_EXPIRY_MS = 48 * 60 * 60 * 1000 // 48 hours
// seenAt 过期窗口：自 seenAt 起 48 小时后，下次加载自动清除该条目。

// Module-level cache — populated by loadFlaggedPlugins(), updated by writes.
let cache: Record<string, FlaggedPlugin> | null = null
// 模块级缓存：首次异步调用（load 或 add）灌入，之后与写操作保持同步，供 React 渲染同步读取。

function getFlaggedPluginsPath(): string {
  return join(getPluginsDirectory(), FLAGGED_PLUGINS_FILENAME)
}

function parsePluginsData(content: string): Record<string, FlaggedPlugin> {
// parsePluginsData：把磁盘 JSON 解析成 {id: FlaggedPlugin}，形态不符或缺失字段则忽略。
  const parsed = jsonParse(content) as unknown
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('plugins' in parsed) ||
    typeof (parsed as { plugins: unknown }).plugins !== 'object' ||
    (parsed as { plugins: unknown }).plugins === null
  ) {
    return {}
  }
  const plugins = (parsed as { plugins: Record<string, unknown> }).plugins
  const result: Record<string, FlaggedPlugin> = {}
  for (const [id, entry] of Object.entries(plugins)) {
    if (
      entry &&
      typeof entry === 'object' &&
      'flaggedAt' in entry &&
      typeof (entry as { flaggedAt: unknown }).flaggedAt === 'string'
    ) {
      const parsed: FlaggedPlugin = {
        flaggedAt: (entry as { flaggedAt: string }).flaggedAt,
      }
      if (
        'seenAt' in entry &&
        typeof (entry as { seenAt: unknown }).seenAt === 'string'
      ) {
        parsed.seenAt = (entry as { seenAt: string }).seenAt
      }
      result[id] = parsed
    }
  }
  return result
}

async function readFromDisk(): Promise<Record<string, FlaggedPlugin>> {
// readFromDisk：读取并解析文件，读取失败（如文件不存在）返回空对象。
  try {
    const content = await readFile(getFlaggedPluginsPath(), {
      encoding: 'utf-8',
    })
    return parsePluginsData(content)
  } catch {
    return {}
  }
}

async function writeToDisk(
  plugins: Record<string, FlaggedPlugin>,
): Promise<void> {
// writeToDisk：用随机临时文件加 rename 原子写入（权限 0600），写后刷新缓存；失败清理临时文件。
  const filePath = getFlaggedPluginsPath()
  const tempPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`

  try {
    await getFsImplementation().mkdir(getPluginsDirectory())

    const content = jsonStringify({ plugins }, null, 2)
    await writeFile(tempPath, content, {
      encoding: 'utf-8',
      mode: 0o600,
    })
    await rename(tempPath, filePath)
    cache = plugins
  } catch (error) {
    logError(error)
    try {
      await unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Load flagged plugins from disk into the module cache.
 * Must be called (and awaited) before getFlaggedPlugins() returns
 * meaningful data. Called by useManagePlugins during plugin refresh.
 */
export async function loadFlaggedPlugins(): Promise<void> {
// loadFlaggedPlugins：从磁盘载入并清除过期的 seenAt 条目，须在 getFlaggedPlugins 之前 await。
  const all = await readFromDisk()
  const now = Date.now()
  let changed = false

  for (const [id, entry] of Object.entries(all)) {
    if (
      entry.seenAt &&
      now - new Date(entry.seenAt).getTime() >= SEEN_EXPIRY_MS
    ) {
      delete all[id]
      changed = true
    }
  }

  cache = all
  if (changed) {
    await writeToDisk(all)
  }
}

/**
 * Get all flagged plugins from the in-memory cache.
 * Returns an empty object if loadFlaggedPlugins() has not been called yet.
 */
export function getFlaggedPlugins(): Record<string, FlaggedPlugin> {
// getFlaggedPlugins：直接返回内存缓存（未 load 过则返回空对象）。
  return cache ?? {}
}

/**
 * Add a plugin to the flagged list.
 *
 * @param pluginId "name@marketplace" format
 */
export async function addFlaggedPlugin(pluginId: string): Promise<void> {
// addFlaggedPlugin：把插件以 name@marketplace 形式加进标记表并落盘。
  if (cache === null) {
    cache = await readFromDisk()
  }

  const updated = {
    ...cache,
    [pluginId]: {
      flaggedAt: new Date().toISOString(),
    },
  }

  await writeToDisk(updated)
  logForDebugging(`Flagged plugin: ${pluginId}`)
}

/**
 * Mark flagged plugins as seen. Called when the Installed view renders
 * flagged plugins. Sets seenAt on entries that don't already have it.
 * After 48 hours from seenAt, entries are auto-cleared on next load.
 */
export async function markFlaggedPluginsSeen(
  pluginIds: string[],
): Promise<void> {
// markFlaggedPluginsSeen：Installed 视图渲染时调用，给未 seen 的条目补 seenAt（触发 48 小时过期计时）。
  if (cache === null) {
    cache = await readFromDisk()
  }
  const now = new Date().toISOString()
  let changed = false

  const updated = { ...cache }
  for (const id of pluginIds) {
    const entry = updated[id]
    if (entry && !entry.seenAt) {
      updated[id] = { ...entry, seenAt: now }
      changed = true
    }
  }

  if (changed) {
    await writeToDisk(updated)
  }
}

/**
 * Remove a plugin from the flagged list. Called when the user dismisses
 * a flagged plugin notification in /plugins.
 */
export async function removeFlaggedPlugin(pluginId: string): Promise<void> {
// removeFlaggedPlugin：用户在 /plugins 里忽略某条标记时调用，从表里删除并落盘。
  if (cache === null) {
    cache = await readFromDisk()
  }
  if (!(pluginId in cache)) return

  const { [pluginId]: _, ...rest } = cache
  cache = rest
  await writeToDisk(rest)
}
