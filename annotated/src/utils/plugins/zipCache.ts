/**
 * Plugin Zip Cache Module
 *
 * Manages plugins as ZIP archives in a mounted directory (e.g., Filestore).
 * When CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE is enabled and CLAUDE_CODE_PLUGIN_CACHE_DIR
 * is set, plugins are stored as ZIPs in that directory and extracted to a
 * session-local temp directory at startup.
 *
 * Limitations:
 * - Only headless mode is supported
 * - All settings sources are used (same as normal plugin flow)
 * - Only github, git, and url marketplace sources are supported
 * - Only strict:true marketplace entries are supported
 * - Auto-update is non-blocking (background, does not affect current session)
 *
 * Directory structure of the zip cache:
 * /mnt/plugins-cache/
 *   ├── known_marketplaces.json
 *   ├── installed_plugins.json
 *   ├── marketplaces/
 *   │   ├── official-marketplace.json
 *   │   └── company-marketplace.json
 *   └── plugins/
 *       ├── official-marketplace/
 *       │   └── plugin-a/
 *       │       └── 1.0.0.zip
 *       └── company-marketplace/
 *           └── plugin-b/
 *               └── 2.1.3.zip
 */
// 文件级：本文件把插件以 ZIP 归档形式管理在挂载目录（如 Filestore）里，开启 `CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE` 且设了缓存目录时，插件存成 ZIP、启动时解压到会话级临时目录；只支持无头模式与 github/git/url/settings 来源，且只认 strict 的市集条目。

import { randomBytes } from 'crypto'
import {
  chmod,
  lstat,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { logForDebugging } from '../debug.js'
import { parseZipModes, unzipFile } from '../dxt/zip.js'
import { isEnvTruthy } from '../envUtils.js'
import { getFsImplementation } from '../fsOperations.js'
import { expandTilde } from '../permissions/pathValidation.js'
import type { MarketplaceSource } from './schemas.js'

/**
 * Check if the plugin zip cache mode is enabled.
 */
// `isPluginZipCacheEnabled`：用环境变量判断 ZIP 缓存模式是否开启。
export function isPluginZipCacheEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE)
}

/**
 * Get the path to the zip cache directory.
 * Requires CLAUDE_CODE_PLUGIN_CACHE_DIR to be set.
 * Returns undefined if zip cache is not enabled.
 */
// `getPluginZipCachePath`：返回 ZIP 缓存目录，未开启或未设目录时返回 `undefined`，目录会先展开波浪号。
export function getPluginZipCachePath(): string | undefined {
  if (!isPluginZipCacheEnabled()) {
    return undefined
  }
  const dir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  return dir ? expandTilde(dir) : undefined
}

/**
 * Get the path to known_marketplaces.json in the zip cache.
 */
// `getZipCacheKnownMarketplacesPath`：取缓存里 `known_marketplaces.json` 的路径，未开启则抛错。
export function getZipCacheKnownMarketplacesPath(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'known_marketplaces.json')
}

/**
 * Get the path to installed_plugins.json in the zip cache.
 */
// `getZipCacheInstalledPluginsPath`：取缓存里 `installed_plugins.json` 的路径。
export function getZipCacheInstalledPluginsPath(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'installed_plugins.json')
}

/**
 * Get the marketplaces directory within the zip cache.
 */
// `getZipCacheMarketplacesDir`：取缓存内 `marketplaces` 子目录。
export function getZipCacheMarketplacesDir(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'marketplaces')
}

/**
 * Get the plugins directory within the zip cache.
 */
// `getZipCachePluginsDir`：取缓存内 `plugins` 子目录。
export function getZipCachePluginsDir(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'plugins')
}

// Session plugin cache: a temp directory on local disk (NOT in the mounted zip cache)
// that holds extracted plugins for the duration of the session.
// 会话插件缓存：放在本地磁盘的临时目录（而非挂载的 ZIP 缓存），仅在本次会话期间持有解压出的插件。
let sessionPluginCachePath: string | null = null
let sessionPluginCachePromise: Promise<string> | null = null

/**
 * Get or create the session plugin cache directory.
 * This is a temp directory on local disk where plugins are extracted for the session.
 */
// `getSessionPluginCachePath`：惰性创建并记忆化会话插件缓存目录，用随机后缀避免冲突。
export async function getSessionPluginCachePath(): Promise<string> {
  if (sessionPluginCachePath) {
    return sessionPluginCachePath
  }
  if (!sessionPluginCachePromise) {
    sessionPluginCachePromise = (async () => {
      const suffix = randomBytes(8).toString('hex')
// 用 8 字节随机十六进制生成会话目录后缀。
      const dir = join(tmpdir(), `claude-plugin-session-${suffix}`)
      await getFsImplementation().mkdir(dir)
      sessionPluginCachePath = dir
      logForDebugging(`Created session plugin cache at ${dir}`)
      return dir
    })()
  }
  return sessionPluginCachePromise
}

/**
 * Clean up the session plugin cache directory.
 * Should be called when the session ends.
 */
// `cleanupSessionPluginCache`：会话结束时递归删掉会话插件缓存目录并复位状态。
export async function cleanupSessionPluginCache(): Promise<void> {
  if (!sessionPluginCachePath) {
    return
  }
  try {
    await rm(sessionPluginCachePath, { recursive: true, force: true })
// 强制递归删除缓存目录，失败时记调试日志，最后清空路径与承诺。
    logForDebugging(
      `Cleaned up session plugin cache at ${sessionPluginCachePath}`,
    )
  } catch (error) {
    logForDebugging(`Failed to clean up session plugin cache: ${error}`)
  } finally {
    sessionPluginCachePath = null
    sessionPluginCachePromise = null
  }
}

/**
 * Reset the session plugin cache path (for testing).
 */
// `resetSessionPluginCache`：测试辅助，复位会话缓存状态。
export function resetSessionPluginCache(): void {
  sessionPluginCachePath = null
  sessionPluginCachePromise = null
}

/**
 * Write data to a file in the zip cache atomically.
 * Writes to a temp file in the same directory, then renames.
 */
// `atomicWriteToZipCache`：写缓存文件时先写同目录临时文件再重命名，保证原子性。
export async function atomicWriteToZipCache(
  targetPath: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = dirname(targetPath)
  await getFsImplementation().mkdir(dir)

  const tmpName = `.${basename(targetPath)}.tmp.${randomBytes(4).toString('hex')}`
// 临时文件名带基名与 4 字节随机串，避免并发冲突。
  const tmpPath = join(dir, tmpName)

  try {
    if (typeof data === 'string') {
      await writeFile(tmpPath, data, { encoding: 'utf-8' })
    } else {
      await writeFile(tmpPath, data)
    }
    await rename(tmpPath, targetPath)
// 写完临时文件后重命名覆盖目标，失败清理临时文件并向上抛错。
  } catch (error) {
    // Clean up tmp file on failure
    try {
      await rm(tmpPath, { force: true })
    } catch {
      // ignore cleanup errors
    }
    throw error
  }
}

// fflate's ZippableFile tuple form: [data, opts]. Using the tuple lets us
// store {os, attrs} so parseZipModes can recover exec bits on extraction.
// fflate 的 `ZippableFile` 元组形式 `[data, opts]` 让我们可以存 `os`/`attrs`，解压时 `parseZipModes` 才能恢复执行位。
type ZipEntry = [Uint8Array, { os: number; attrs: number }]
// `ZipEntry`：ZIP 条目元组，`attrs` 存 Unix 模式位以便恢复 +x。

/**
 * Create a ZIP archive from a directory.
 * Resolves symlinks to actual file contents (replaces symlinks with real data).
 * Stores Unix mode bits in external_attr so extractZipToDirectory can restore
 * +x — otherwise the round-trip (git clone → zip → extract) loses exec bits.
 *
 * @param sourceDir - Directory to zip
 * @returns ZIP file as Uint8Array
 */
// `createZipFromDirectory`：把一个目录打成 ZIP，符号链接解析成真实内容，并把 Unix 模式位存进 `external_attr`，否则 git 克隆→打包→解压的链路会丢执行位。
export async function createZipFromDirectory(
  sourceDir: string,
): Promise<Uint8Array> {
  const files: Record<string, ZipEntry> = {}
  const visited = new Set<string>()
  await collectFilesForZip(sourceDir, '', files, visited)
// 先递归收集目录下的文件，再惰性 `import` fflate 压缩成 6 级压缩的字节数组。

  const { zipSync } = await import('fflate')
  const zipData = zipSync(files, { level: 6 })
  logForDebugging(
    `Created ZIP from ${sourceDir}: ${Object.keys(files).length} files, ${zipData.length} bytes`,
  )
  return zipData
}

/**
 * Recursively collect files from a directory for zipping.
 * Uses lstat to detect symlinks and tracks visited inodes for cycle detection.
 */
// `collectFilesForZip`：递归收集目录文件用于打包，用 `lstat` 识别符号链接，并用 dev+ino 追踪已访问目录以检测环。
async function collectFilesForZip(
  baseDir: string,
  relativePath: string,
  files: Record<string, ZipEntry>,
  visited: Set<string>,
): Promise<void> {
  const currentDir = relativePath ? join(baseDir, relativePath) : baseDir
  let entries: string[]
  try {
    entries = await readdir(currentDir)
  } catch {
    return
  }

  // Track visited directories by dev+ino to detect symlink cycles.
  // bigint: true is required — on Windows NTFS, the file index packs a 16-bit
  // sequence number into the high bits. Once that sequence exceeds ~32 (very
  // common on a busy CI runner that churns through temp files), the value
  // exceeds Number.MAX_SAFE_INTEGER and two adjacent directories round to the
  // same JS number, causing subdirs to be silently skipped as "cycles". This
  // broke the round-trip test on Windows CI when sharding shuffled which tests
  // ran first and pushed MFT sequence numbers over the precision cliff.
  // See also: markdownConfigLoader.ts getFileIdentity, anthropics/claude-code#13893
// 按 dev+ino 追踪访问过的目录来检测符号链接环；Windows NTFS 的 MFT 序号高位会超出安全整数，故用 `bigint:true`，否则相邻目录会被误判成环而漏掉。
  try {
    const dirStat = await stat(currentDir, { bigint: true })
    // ReFS (Dev Drive), NFS, some FUSE mounts report dev=0 and ino=0 for
    // everything. Fail open: skip cycle detection rather than skip the
    // directory. We already skip symlinked directories unconditionally below,
    // so the only cycle left here is a bind mount, which we accept.
    if (dirStat.dev !== 0n || dirStat.ino !== 0n) {
// dev 与 ino 都为 0（ReFS/NFS/部分 FUSE）时放宽处理、跳过环检测，避免把整个目录跳过。
      const key = `${dirStat.dev}:${dirStat.ino}`
      if (visited.has(key)) {
        logForDebugging(`Skipping symlink cycle at ${currentDir}`)
        return
      }
      visited.add(key)
    }
  } catch {
    return
  }

  for (const entry of entries) {
// 遍历目录条目，跳过 `.git` 等 git 相关隐藏项。
    // Skip hidden files that are git-related
    if (entry === '.git') {
      continue
    }

    const fullPath = join(currentDir, entry)
    const relPath = relativePath ? `${relativePath}/${entry}` : entry

    let fileStat
    try {
      fileStat = await lstat(fullPath)
    } catch {
      continue
    }

    // Skip symlinked directories (follow symlinked files)
    if (fileStat.isSymbolicLink()) {
// 符号链接目录直接跳过、符号链接文件则跟随读内容，坏链跳过。
      try {
        const targetStat = await stat(fullPath)
        if (targetStat.isDirectory()) {
          continue
        }
        // Symlinked file — read its contents below
        fileStat = targetStat
      } catch {
        continue // broken symlink
      }
    }

    if (fileStat.isDirectory()) {
// 目录递归收集、文件读取内容并打包。
      await collectFilesForZip(baseDir, relPath, files, visited)
    } else if (fileStat.isFile()) {
      try {
        const content = await readFile(fullPath)
        // os=3 (Unix) + st_mode in high 16 bits of external_attr — this is
        // what parseZipModes reads back on extraction. fileStat is already
        // in hand from the lstat/stat above, so no extra syscall.
        files[relPath] = [
          new Uint8Array(content),
          { os: 3, attrs: (fileStat.mode & 0xffff) << 16 },
        ]
// 每个文件存成 `[内容, {os:3, 模式位}]`，`os:3` 表示 Unix，模式位放进 `external_attr` 高位供解压还原。
      } catch (error) {
        logForDebugging(`Failed to read file for zip: ${relPath}: ${error}`)
      }
    }
  }
}

/**
 * Extract a ZIP file to a target directory.
 *
 * @param zipPath - Path to the ZIP file
 * @param targetDir - Directory to extract into
 */
// `extractZipToDirectory`：把 ZIP 解压到目标目录，并恢复执行位，使 hook/脚本能用 `sh -c` 跑。
export async function extractZipToDirectory(
  zipPath: string,
  targetDir: string,
): Promise<void> {
  const zipBuf = await getFsImplementation().readFileBytes(zipPath)
  const files = await unzipFile(zipBuf)
  // fflate doesn't surface external_attr — parse the central directory so
  // exec bits survive extraction (hooks/scripts need +x to run via `sh -c`).
  const modes = parseZipModes(zipBuf)
// fflate 不暴露 `external_attr`，所以解析中央目录取回模式位，保证 +x 在解压后存活。

  await getFsImplementation().mkdir(targetDir)

  for (const [relPath, data] of Object.entries(files)) {
// 逐条写出文件，目录条目（结尾斜杠）只建目录。
    // Skip directory entries (trailing slash)
    if (relPath.endsWith('/')) {
      await getFsImplementation().mkdir(join(targetDir, relPath))
      continue
    }

    const fullPath = join(targetDir, relPath)
    await getFsImplementation().mkdir(dirname(fullPath))
    await writeFile(fullPath, data)
    const mode = modes[relPath]
    if (mode && mode & 0o111) {
// 若条目带执行位，就 `chmod` 恢复，吞掉 NFS/FUSE 上的 EPERM/ENOTSUP 以免中断解压。
      // Swallow EPERM/ENOTSUP (NFS root_squash, some FUSE mounts) — losing +x
      // is the pre-PR behavior and better than aborting mid-extraction.
      await chmod(fullPath, mode & 0o777).catch(() => {})
    }
  }

  logForDebugging(
    `Extracted ZIP to ${targetDir}: ${Object.keys(files).length} entries`,
  )
}

/**
 * Convert a plugin directory to a ZIP in-place: zip → atomic write → delete dir.
 * Both call sites (cacheAndRegisterPlugin, copyPluginToVersionedCache) need the
 * same sequence; getting it wrong (non-atomic write, forgetting rm) corrupts cache.
 */
// `convertDirectoryToZipInPlace`：把插件目录就地转成 ZIP：打包→原子写→删目录；两个调用点共用同一序列，写错会损坏缓存。
export async function convertDirectoryToZipInPlace(
  dirPath: string,
  zipPath: string,
): Promise<void> {
  const zipData = await createZipFromDirectory(dirPath)
  await atomicWriteToZipCache(zipPath, zipData)
  await rm(dirPath, { recursive: true, force: true })
}

/**
 * Get the relative path for a marketplace JSON file within the zip cache.
 * Format: marketplaces/{marketplace-name}.json
 */
// `getMarketplaceJsonRelativePath`：算市集 JSON 在缓存里的相对路径，格式 `marketplaces/市集名.json`。
export function getMarketplaceJsonRelativePath(
  marketplaceName: string,
): string {
  const sanitized = marketplaceName.replace(/[^a-zA-Z0-9\-_]/g, '-')
// 把市集名里非字母数字与 `-`/`_` 的字符替换成 `-`，得到安全的文件名。
  return join('marketplaces', `${sanitized}.json`)
}

/**
 * Check if a marketplace source type is supported by zip cache mode.
 *
 * Supported sources write to `join(cacheDir, name)` — syncMarketplacesToZipCache
 * reads marketplace.json from that installLocation, source-type-agnostic.
 * - github/git/url: clone to temp, rename into cacheDir
 * - settings: write synthetic marketplace.json directly to cacheDir (no fetch)
 *
 * Excluded: file/directory (installLocation is the user's path OUTSIDE cacheDir —
 * nonsensical in ephemeral containers), npm (node_modules bloat on Filestore mount).
 */
// `isMarketplaceSourceSupportedByZipCache`：判断市集来源类型是否被 ZIP 缓存支持，支持 github/git/url/settings，排除 file/directory 与 npm。
export function isMarketplaceSourceSupportedByZipCache(
  source: MarketplaceSource,
): boolean {
  return ['github', 'git', 'url', 'settings'].includes(source.source)
// 支持列表里的来源才能写进缓存目录；file/directory 的安装位置在缓存外（临时容器里无意义），npm 会让 node_modules 在挂载盘上膨胀。
}
