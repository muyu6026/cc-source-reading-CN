/**
 * Provides ripgrep glob exclusion patterns for orphaned plugin versions.
 *
 * When plugin versions are updated, old versions are marked with a
 * `.orphaned_at` file but kept on disk for 7 days (since concurrent
 * sessions might still reference them). During this window, Grep/Glob
 * could return files from orphaned versions, causing Claude to use
 * outdated plugin code.
 *
 * We find `.orphaned_at` markers via a single ripgrep call and generate
 * `--glob '!<dir>/**'` patterns for their parent directories. The cache
 * is warmed in main.tsx AFTER cleanupOrphanedPluginVersionsInBackground
 * settles disk state. Once populated, the exclusion list is frozen for
 * the session unless /reload-plugins is called; subsequent disk mutations
 * (autoupdate, concurrent sessions) don't affect it.
 */
// 文件级说明：为孤立（已标记 .orphaned_at）的插件旧版本提供 ripgrep 排除 glob 模式。

import { dirname, isAbsolute, join, normalize, relative, sep } from 'path'
import { ripGrep } from '../ripgrep.js'
import { getPluginsDirectory } from './pluginDirectories.js'

// Inlined from cacheUtils.ts to avoid a circular dep through commands.js.
const ORPHANED_AT_FILENAME = '.orphaned_at'

/** Session-scoped cache. Frozen once computed — only cleared by explicit /reload-plugins. */
let cachedExclusions: string[] | null = null
// 会话级缓存：计算后冻结，仅显式 /reload-plugins 才清。

/**
 * Get ripgrep glob exclusion patterns for orphaned plugin versions.
 *
 * @param searchPath - When provided, exclusions are only returned if the
 *   search overlaps the plugin cache directory (avoids unnecessary --glob
 *   args for searches outside the cache).
 *
 * Warmed eagerly in main.tsx after orphan GC; the lazy-compute path here
 * is a fallback. Best-effort: returns empty array if anything goes wrong.
 */
// getGlobExclusionsForPluginCache 文档：块注释说明入参与惰性回退路径。
export async function getGlobExclusionsForPluginCache(
  searchPath?: string,
): Promise<string[]> {
  const cachePath = normalize(join(getPluginsDirectory(), 'cache'))

  if (searchPath && !pathsOverlap(searchPath, cachePath)) {
    return []
  }

  if (cachedExclusions !== null) {
    return cachedExclusions
  }

  try {
    // Find all .orphaned_at files within the plugin cache directory.
    // --hidden: marker is a dotfile. --no-ignore: don't let a stray
    // .gitignore hide it. --max-depth 4: marker is always at
    // cache/<marketplace>/<plugin>/<version>/.orphaned_at — don't recurse
    // into plugin contents (node_modules, etc.). Never-aborts signal: no
    // caller signal to thread.
    const markers = await ripGrep(
      [
        '--files',
        '--hidden',
        '--no-ignore',
        '--max-depth',
        '4',
        '--glob',
        ORPHANED_AT_FILENAME,
      ],
      cachePath,
      new AbortController().signal,
    )

    cachedExclusions = markers.map(markerPath => {
      // ripgrep may return absolute or relative — normalize to relative.
      const versionDir = dirname(markerPath)
      const rel = isAbsolute(versionDir)
        ? relative(cachePath, versionDir)
        : versionDir
      // ripgrep glob patterns always use forward slashes, even on Windows
      const posixRelative = rel.replace(/\\/g, '/')
      return `!**/${posixRelative}/**`
    })
    return cachedExclusions
  } catch {
    // Best-effort — don't break core search tools if ripgrep fails here
    cachedExclusions = []
    return cachedExclusions
  }
}
// getGlobExclusionsForPluginCache 收尾：把每个标记目录转成 !**/<相对>/** 排除模式，ripgrep 全局用正斜杠。

export function clearPluginCacheExclusions(): void {
  cachedExclusions = null
}
// clearPluginCacheExclusions 收尾：清空排除缓存。

/**
 * One path is a prefix of the other. Special-cases root (normalize('/') + sep
 * = '//'). Case-insensitive on win32 since normalize() doesn't lowercase
 * drive letters and CLAUDE_CODE_PLUGIN_CACHE_DIR may disagree with resolved.
 */
function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  return (
    na === nb ||
    na === sep ||
    nb === sep ||
    na.startsWith(nb + sep) ||
    nb.startsWith(na + sep)
  )
}
// pathsOverlap 收尾：判断两路径是否互为前缀，根目录特判。

function normalizeForCompare(p: string): string {
  const n = normalize(p)
  return process.platform === 'win32' ? n.toLowerCase() : n
}
// normalizeForCompare 收尾：win32 下小写化以兼容大小写不一致的缓存目录配置。
