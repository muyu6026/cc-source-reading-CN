import type {
  McpbManifest,
  McpbUserConfigurationOption,
} from '@anthropic-ai/mcpb'
import axios from 'axios'
import { createHash } from 'crypto'
import { chmod, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { McpServerConfig } from '../../services/mcp/types.js'
import { logForDebugging } from '../debug.js'
import { parseAndValidateManifestFromBytes } from '../dxt/helpers.js'
import { parseZipModes, unzipFile } from '../dxt/zip.js'
import { errorMessage, getErrnoCode, isENOENT, toError } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import { getSecureStorage } from '../secureStorage/index.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../settings/settings.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getSystemDirectories } from '../systemDirectories.js'
import { classifyFetchError, logPluginFetch } from './fetchTelemetry.js'
/**
 * User configuration values for MCPB
 */
// 用户配置值类型：一个键到「字符串 / 数字 / 布尔 / 字符串数组」的扁平映射，描述某个 MCP 服务器需要用户填的配置。
export type UserConfigValues = Record<
  string,
  string | number | boolean | string[]
>

/**
 * User configuration schema from DXT manifest
 */
// 用户配置 schema 类型：键到 DXT manifest 里 McpbUserConfigurationOption 的映射，决定每个配置项的类型、是否必填、是否敏感。
export type UserConfigSchema = Record<string, McpbUserConfigurationOption>

/**
 * Result of loading an MCPB file (success case)
 */
// 加载 MCPB 成功时的结果：manifest、生成的 MCP 服务配置、解压路径、内容哈希。
export type McpbLoadResult = {
  manifest: McpbManifest
  mcpConfig: McpServerConfig
  extractedPath: string
  contentHash: string
}

/**
 * Result when MCPB needs user configuration
 */
// 加载 MCPB 但「还缺用户输入」时的结果：带回 schema、已有配置、校验错误，让上层弹出配置对话框。
export type McpbNeedsConfigResult = {
  status: 'needs-config'
  manifest: McpbManifest
  extractedPath: string
  contentHash: string
  configSchema: UserConfigSchema
  existingConfig: UserConfigValues
  validationErrors: string[]
}

/**
 * Metadata stored for each cached MCPB
 */
// 每个缓存 MCPB 的元数据：来源、内容哈希、解压路径、缓存时间、最近检查时间。
export type McpbCacheMetadata = {
  source: string
  contentHash: string
  extractedPath: string
  cachedAt: string
  lastChecked: string
}

/**
 * Progress callback for download and extraction operations
 */
// 下载 / 解压进度的回调类型：传一个状态字符串给上层刷新 UI。
export type ProgressCallback = (status: string) => void

/**
 * Check if a source string is an MCPB file reference
 */
// 判断一个来源字符串是不是 MCPB 文件引用：以 .mcpb 或 .dxt 结尾即算。
export function isMcpbSource(source: string): boolean {
  return source.endsWith('.mcpb') || source.endsWith('.dxt')
}

/**
 * Check if a source is a URL
 */
// 判断来源是不是 URL：以 http:// 或 https:// 开头即算，用来区分「远程下载」与「本地读取」。
function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://')
}

/**
 * Generate content hash for an MCPB file
 */
// 为 MCPB 文件算内容哈希：用 sha256 取前 16 位十六进制，作为缓存目录里的版本标识。
function generateContentHash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').substring(0, 16)
}

/**
 * Get cache directory for MCPB files
 */
// 取某个插件目录下专门的缓存目录：在插件目录里建 .mcpb-cache。
function getMcpbCacheDir(pluginPath: string): string {
  return join(pluginPath, '.mcpb-cache')
}

/**
 * Get metadata file path for cached MCPB
 */
// 算缓存元数据文件路径：把来源字符串 md5 取前 8 位当文件名，避免把原始 URL / 路径直接当文件名。
function getMetadataPath(cacheDir: string, source: string): string {
  const sourceHash = createHash('md5')
    .update(source)
    .digest('hex')
    .substring(0, 8)
  return join(cacheDir, `${sourceHash}.metadata.json`)
}

/**
 * Compose the secureStorage key for a per-server secret bucket.
 * `pluginSecrets` is a flat map — per-server secrets share it with top-level
 * plugin options (pluginOptionsStorage.ts) using a `${pluginId}/${server}`
 * composite key. `/` can't appear in plugin IDs (`name@marketplace`) or
 * server names (MCP identifier constraints), so it's unambiguous. Keeps the
 * SecureStorageData schema unchanged and the single-keychain-entry size
 * budget (~2KB stdin-safe, see INC-3028) shared across all plugin secrets.
 */
// 拼「每服务器密钥桶」在 secureStorage 里的键：用 pluginId/serverName 的复合键。pluginId（name@marketplace）与 serverName 都不含斜杠，所以复合键无歧义；这样既能和顶层插件选项共用一个扁平 map，又不必改动 SecureStorageData 的 schema，还能把单个密钥链条目控制在约 2KB 内。
function serverSecretsKey(pluginId: string, serverName: string): string {
  return `${pluginId}/${serverName}`
}

/**
 * Load user configuration for an MCP server, merging non-sensitive values
 * (from settings.json) with sensitive values (from secureStorage keychain).
 * secureStorage wins on collision — schema determines destination so
 * collision shouldn't happen, but if a user hand-edits settings.json we
 * trust the more secure source.
 *
 * Returns null only if NEITHER source has anything — callers skip
 * ${user_config.X} substitution in that case.
 *
 * @param pluginId - Plugin identifier in "plugin@marketplace" format
 * @param serverName - MCP server name from DXT manifest
 */
// 加载某 MCP 服务器的用户配置：把「非敏感值（来自 settings.json）」与「敏感值（来自 secureStorage 钥匙链）」合并。冲突时 secureStorage 优先——因为若用户手改 settings.json，更安全的来源说了算。两个来源都没有才返回 null（上层据此跳过 user_config 替换）。
export function loadMcpServerUserConfig(
  pluginId: string,
  serverName: string,
): UserConfigValues | null {
  try {
    const settings = getSettings_DEPRECATED()
    const nonSensitive =
      settings.pluginConfigs?.[pluginId]?.mcpServers?.[serverName]

    const sensitive =
      getSecureStorage().read()?.pluginSecrets?.[
        serverSecretsKey(pluginId, serverName)
      ]

    if (!nonSensitive && !sensitive) {
      return null
    }

    logForDebugging(
      `Loaded user config for ${pluginId}/${serverName} (settings + secureStorage)`,
    )
    return { ...nonSensitive, ...sensitive }
  } catch (error) {
    const errorObj = toError(error)
    logError(errorObj)
    logForDebugging(
      `Failed to load user config for ${pluginId}/${serverName}: ${error}`,
      { level: 'error' },
    )
    return null
  }
}

/**
 * Save user configuration for an MCP server, splitting by `schema[key].sensitive`.
 * Mirrors savePluginOptions (pluginOptionsStorage.ts:90) for top-level options:
 *   - `sensitive: true` → secureStorage (keychain on macOS, .credentials.json 0600 elsewhere)
 *   - everything else   → settings.json pluginConfigs[pluginId].mcpServers[serverName]
 *
 * Without this split, per-channel `sensitive: true` was a false sense of
 * security — the dialog masked the input but the save went to plaintext
 * settings.json anyway. H1 #3617646 (Telegram/Discord bot tokens in
 * world-readable .env) surfaced this as the gap to close.
 *
 * Writes are skipped if nothing in that category is present.
 *
 * @param pluginId - Plugin identifier in "plugin@marketplace" format
 * @param serverName - MCP server name from DXT manifest
 * @param config - User configuration values
 * @param schema - The userConfig schema for this server (manifest.user_config
 *   or channels[].userConfig) — drives the sensitive/non-sensitive split
 */
// 保存某 MCP 服务器的用户配置，按 schema[key].sensitive 分流：敏感项写 secureStorage（macOS 走钥匙链、其余平台写 .credentials.json 权限 0600），其余写 settings.json 的 pluginConfigs[pluginId].mcpServers[serverName]。这个分流正是堵上 H1 #3617646 那个漏洞——以前弹窗把输入打码了，保存却照样落到明文 settings.json。
export function saveMcpServerUserConfig(
  pluginId: string,
  serverName: string,
  config: UserConfigValues,
  schema: UserConfigSchema,
): void {
  try {
    const nonSensitive: UserConfigValues = {}
    const sensitive: Record<string, string> = {}

    for (const [key, value] of Object.entries(config)) {
      if (schema[key]?.sensitive === true) {
        sensitive[key] = String(value)
      } else {
        nonSensitive[key] = value
      }
    }

    // Scrub ONLY keys we're writing in this call. Covers both directions
    // across schema-version flips:
    //  - sensitive→secureStorage ⇒ remove stale plaintext from settings.json
    //  - nonSensitive→settings.json ⇒ remove stale entry from secureStorage
    //    (otherwise loadMcpServerUserConfig's {...nonSensitive, ...sensitive}
    //    would let the stale secureStorage value win on next read)
    // Partial `config` (user only re-enters one field) leaves other fields
    // untouched in BOTH stores — defense-in-depth against future callers.
    const sensitiveKeysInThisSave = new Set(Object.keys(sensitive))
    const nonSensitiveKeysInThisSave = new Set(Object.keys(nonSensitive))

    // Sensitive → secureStorage FIRST. If this fails (keychain locked,
    // .credentials.json perms), throw before touching settings.json — the
    // old plaintext stays as a fallback instead of losing BOTH copies.
    //
    // Also scrub non-sensitive keys from secureStorage — schema flipped
    // sensitive→false and they're being written to settings.json now. Without
    // this, loadMcpServerUserConfig's merge would let the stale secureStorage
    // value win on next read.
    const storage = getSecureStorage()
    const k = serverSecretsKey(pluginId, serverName)
    const existingInSecureStorage =
      storage.read()?.pluginSecrets?.[k] ?? undefined
    const secureScrubbed = existingInSecureStorage
      ? Object.fromEntries(
          Object.entries(existingInSecureStorage).filter(
            ([key]) => !nonSensitiveKeysInThisSave.has(key),
          ),
        )
      : undefined
    const needSecureScrub =
      secureScrubbed &&
      existingInSecureStorage &&
      Object.keys(secureScrubbed).length !==
        Object.keys(existingInSecureStorage).length
    if (Object.keys(sensitive).length > 0 || needSecureScrub) {
      const existing = storage.read() ?? {}
      if (!existing.pluginSecrets) {
        existing.pluginSecrets = {}
      }
      // secureStorage keyvault is a flat object — direct replace, no merge
      // semantics to worry about (unlike settings.json's mergeWith).
      existing.pluginSecrets[k] = {
        ...secureScrubbed,
        ...sensitive,
      }
      const result = storage.update(existing)
      if (!result.success) {
        throw new Error(
          `Failed to save sensitive config to secure storage for ${k}`,
        )
      }
      if (result.warning) {
        logForDebugging(`Server secrets save warning: ${result.warning}`, {
          level: 'warn',
        })
      }
      if (needSecureScrub) {
        logForDebugging(
          `saveMcpServerUserConfig: scrubbed ${
            Object.keys(existingInSecureStorage!).length -
            Object.keys(secureScrubbed!).length
          } stale non-sensitive key(s) from secureStorage for ${k}`,
        )
      }
    }

    // Non-sensitive → settings.json. Write whenever there are new non-sensitive
    // values OR existing plaintext sensitive values to scrub — so reconfiguring
    // a sensitive-only schema still cleans up the old settings.json. Runs
    // AFTER the secureStorage write succeeded, so the scrub can't leave you
    // with zero copies of the secret.
    //
    // updateSettingsForSource does mergeWith(diskSettings, ourSettings, ...)
    // which PRESERVES destination keys absent from source — so simply omitting
    // sensitive keys doesn't scrub them, the disk copy merges back in. Instead:
    // set each sensitive key to explicit `undefined` — mergeWith (with the
    // customizer at settings.ts:349) treats explicit undefined as a delete.
    const settings = getSettings_DEPRECATED()
    const existingInSettings =
      settings.pluginConfigs?.[pluginId]?.mcpServers?.[serverName] ?? {}
    const keysToScrubFromSettings = Object.keys(existingInSettings).filter(k =>
      sensitiveKeysInThisSave.has(k),
    )
    if (
      Object.keys(nonSensitive).length > 0 ||
      keysToScrubFromSettings.length > 0
    ) {
      if (!settings.pluginConfigs) {
        settings.pluginConfigs = {}
      }
      if (!settings.pluginConfigs[pluginId]) {
        settings.pluginConfigs[pluginId] = {}
      }
      if (!settings.pluginConfigs[pluginId].mcpServers) {
        settings.pluginConfigs[pluginId].mcpServers = {}
      }
      // Build the scrub-via-undefined map. The UserConfigValues type doesn't
      // include undefined, but updateSettingsForSource's mergeWith customizer
      // needs explicit undefined to delete — cast is deliberate internal
      // plumbing (same rationale as deletePluginOptions in
      // pluginOptionsStorage.ts:184, see CLAUDE.md's 10% case).
      const scrubbed = Object.fromEntries(
        keysToScrubFromSettings.map(k => [k, undefined]),
      ) as Record<string, undefined>
      settings.pluginConfigs[pluginId].mcpServers![serverName] = {
        ...nonSensitive,
        ...scrubbed,
      } as UserConfigValues
      const result = updateSettingsForSource('userSettings', settings)
// 非敏感项写 settings.json：只在「有新非敏感值」或「要擦除旧明文敏感值」时才写，确保「改成一个只含敏感项的 schema」时也能顺手清掉旧 settings.json。注意 updateSettingsForSource 用的是 mergeWith，会保留源里没有的目标键，所以想删敏感键不能简单省略，而要把该键显式设成 undefined（settings.ts 的合并器把显式 undefined 当删除）。这里先等 secureStorage 写成功，擦除才不会让你「两份秘密全丢」。
      if (result.error) {
        throw result.error
      }
      if (keysToScrubFromSettings.length > 0) {
        logForDebugging(
          `saveMcpServerUserConfig: scrubbed ${keysToScrubFromSettings.length} plaintext sensitive key(s) from settings.json for ${pluginId}/${serverName}`,
        )
      }
    }

    logForDebugging(
      `Saved user config for ${pluginId}/${serverName} (${Object.keys(nonSensitive).length} non-sensitive, ${Object.keys(sensitive).length} sensitive)`,
    )
  } catch (error) {
    const errorObj = toError(error)
    logError(errorObj)
    throw new Error(
      `Failed to save user configuration for ${pluginId}/${serverName}: ${errorObj.message}`,
    )
  }
}

/**
 * Validate user configuration values against DXT user_config schema
 */
// 按 DXT 的 user_config schema 校验用户输入：必填项缺失即报错；按类型（string / number / boolean / file / directory）逐一检查，string 在 multiple:true 时允许是字符串数组；number 还会查 min / max 区间。返回 { valid, errors }。
export function validateUserConfig(
  values: UserConfigValues,
  schema: UserConfigSchema,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check each field in the schema
  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = values[key]

    // Check required fields
    if (fieldSchema.required && (value === undefined || value === '')) {
      errors.push(`${fieldSchema.title || key} is required but not provided`)
      continue
    }

    // Skip validation for optional fields that aren't provided
    if (value === undefined || value === '') {
      continue
    }

    // Type validation
    if (fieldSchema.type === 'string') {
      if (Array.isArray(value)) {
        // String arrays are allowed if multiple: true
        if (!fieldSchema.multiple) {
          errors.push(
            `${fieldSchema.title || key} must be a string, not an array`,
          )
        } else if (!value.every(v => typeof v === 'string')) {
          errors.push(`${fieldSchema.title || key} must be an array of strings`)
        }
      } else if (typeof value !== 'string') {
        errors.push(`${fieldSchema.title || key} must be a string`)
      }
    } else if (fieldSchema.type === 'number' && typeof value !== 'number') {
      errors.push(`${fieldSchema.title || key} must be a number`)
    } else if (fieldSchema.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${fieldSchema.title || key} must be a boolean`)
    } else if (
      (fieldSchema.type === 'file' || fieldSchema.type === 'directory') &&
      typeof value !== 'string'
    ) {
      errors.push(`${fieldSchema.title || key} must be a path string`)
    }

    // Number range validation
    if (fieldSchema.type === 'number' && typeof value === 'number') {
      if (fieldSchema.min !== undefined && value < fieldSchema.min) {
        errors.push(
          `${fieldSchema.title || key} must be at least ${fieldSchema.min}`,
        )
      }
      if (fieldSchema.max !== undefined && value > fieldSchema.max) {
        errors.push(
          `${fieldSchema.title || key} must be at most ${fieldSchema.max}`,
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Generate MCP server configuration from DXT manifest
 */
// 从 DXT manifest 生成 MCP 服务配置：懒加载 @anthropic-ai/mcpb（它的 barrel 会拉进约 700KB 的 zod v3 闭包，按需 import 避免启动膨胀），调 getMcpConfigForManifest 并补上系统目录、用户配置、路径分隔符。manifest 没生成出配置就报错。
async function generateMcpConfig(
  manifest: McpbManifest,
  extractedPath: string,
  userConfig: UserConfigValues = {},
): Promise<McpServerConfig> {
  // Lazy import: @anthropic-ai/mcpb barrel pulls in zod v3 schemas (~700KB of
  // bound closures). See dxt/helpers.ts for details.
  const { getMcpConfigForManifest } = await import('@anthropic-ai/mcpb')
  const mcpConfig = await getMcpConfigForManifest({
    manifest,
    extensionPath: extractedPath,
    systemDirs: getSystemDirectories(),
    userConfig,
    pathSeparator: '/',
  })

  if (!mcpConfig) {
    const error = new Error(
      `Failed to generate MCP server configuration from manifest "${manifest.name}"`,
    )
    logError(error)
    throw error
  }

  return mcpConfig as McpServerConfig
}

/**
 * Load cache metadata for an MCPB source
 */
// 读某个 MCPB 来源的缓存元数据：读不到或解析失败（ENOENT 等）都返回 null，让上层当作「需要重新加载」。
async function loadCacheMetadata(
  cacheDir: string,
  source: string,
): Promise<McpbCacheMetadata | null> {
  const fs = getFsImplementation()
  const metadataPath = getMetadataPath(cacheDir, source)

  try {
    const content = await fs.readFile(metadataPath, { encoding: 'utf-8' })
    return jsonParse(content) as McpbCacheMetadata
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') return null
    const errorObj = toError(error)
    logError(errorObj)
    logForDebugging(`Failed to load MCPB cache metadata: ${error}`, {
      level: 'error',
    })
    return null
  }
}

/**
 * Save cache metadata for an MCPB source
 */
// 写某个 MCPB 来源的缓存元数据：先建缓存目录，再把元数据 json 落盘。
async function saveCacheMetadata(
  cacheDir: string,
  source: string,
  metadata: McpbCacheMetadata,
): Promise<void> {
  const metadataPath = getMetadataPath(cacheDir, source)

  await getFsImplementation().mkdir(cacheDir)
  await writeFile(metadataPath, jsonStringify(metadata, null, 2), 'utf-8')
}

/**
 * Download MCPB file from URL
 */
// 从 URL 下载 MCPB 文件：用 axios 拉，超时 2 分钟、最多跟 5 次重定向，带下载进度回调。注意遥测在 writeFile 之前打——它量的是网络耗时而非磁盘 IO，否则 writeFile 的 EACCES 会被 classifyFetchError 误判成鉴权失败。下载完先发遥测再落盘，二进制直接写。
async function downloadMcpb(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback,
): Promise<Uint8Array> {
  logForDebugging(`Downloading MCPB from ${url}`)
  if (onProgress) {
    onProgress(`Downloading ${url}...`)
  }

  const started = performance.now()
  let fetchTelemetryFired = false
  try {
    const response = await axios.get(url, {
      timeout: 120000, // 2 minute timeout
      responseType: 'arraybuffer',
      maxRedirects: 5, // Follow redirects (like curl -L)
      onDownloadProgress: progressEvent => {
        if (progressEvent.total && onProgress) {
          const percent = Math.round(
            (progressEvent.loaded / progressEvent.total) * 100,
          )
          onProgress(`Downloading... ${percent}%`)
        }
      },
    })

    const data = new Uint8Array(response.data)
    // Fire telemetry before writeFile — the event measures the network
    // fetch, not disk I/O. A writeFile EACCES would otherwise match
    // classifyFetchError's /permission denied/ → misreport as auth.
    logPluginFetch('mcpb', url, 'success', performance.now() - started)
    fetchTelemetryFired = true

    // Save to disk (binary data)
    await writeFile(destPath, Buffer.from(data))

    logForDebugging(`Downloaded ${data.length} bytes to ${destPath}`)
    if (onProgress) {
      onProgress('Download complete')
    }

    return data
  } catch (error) {
    if (!fetchTelemetryFired) {
      logPluginFetch(
        'mcpb',
        url,
        'failure',
        performance.now() - started,
        classifyFetchError(error),
      )
    }
    const errorMsg = errorMessage(error)
    const fullError = new Error(
      `Failed to download MCPB file from ${url}: ${errorMsg}`,
    )
    logError(fullError)
    throw fullError
  }
}

/**
 * Extract MCPB file and write contents to extraction directory.
 *
 * @param modes - name→mode map from `parseZipModes`. MCPB bundles can ship
 *   native MCP server binaries, so preserving the exec bit matters here.
 */
// 把 MCPB 解压内容写进解压目录：先建目录，逐文件写（区分文本与二进制，文本用 UTF-8）；MCPB 可能带原生服务二进制，所以保留执行位很关键——用 parseZipModes 从中央目录读出权限位再 chmod。chmod 遇到 EPERM / ENOTSUP（NFS root_squash、某些 FUSE 挂载）直接吞掉，避免中途中止。进度每 10 个文件回报一次。
async function extractMcpbContents(
  unzipped: Record<string, Uint8Array>,
  extractPath: string,
  modes: Record<string, number>,
  onProgress?: ProgressCallback,
): Promise<void> {
  if (onProgress) {
    onProgress('Extracting files...')
  }

  // Create extraction directory
  await getFsImplementation().mkdir(extractPath)

  // Write all files. Filter directory entries from the count so progress
  // messages use the same denominator as filesWritten (which skips them).
  let filesWritten = 0
  const entries = Object.entries(unzipped).filter(([k]) => !k.endsWith('/'))
  const totalFiles = entries.length

  for (const [filePath, fileData] of entries) {
    // Directory entries (common in zip -r, Python zipfile, Java ZipOutputStream)
    // are filtered above — writeFile would create `bin/` as an empty regular
    // file, then mkdir for `bin/server` would fail with ENOTDIR. The
    // mkdir(dirname(fullPath)) below creates parent dirs implicitly.

    const fullPath = join(extractPath, filePath)
    const dir = dirname(fullPath)

    // Ensure directory exists (recursive handles already-existing)
    if (dir !== extractPath) {
      await getFsImplementation().mkdir(dir)
    }

    // Determine if text or binary
    const isTextFile =
      filePath.endsWith('.json') ||
      filePath.endsWith('.js') ||
      filePath.endsWith('.ts') ||
      filePath.endsWith('.txt') ||
      filePath.endsWith('.md') ||
      filePath.endsWith('.yml') ||
      filePath.endsWith('.yaml')

    if (isTextFile) {
      const content = new TextDecoder().decode(fileData)
      await writeFile(fullPath, content, 'utf-8')
    } else {
      await writeFile(fullPath, Buffer.from(fileData))
    }

    const mode = modes[filePath]
    if (mode && mode & 0o111) {
      // Swallow EPERM/ENOTSUP (NFS root_squash, some FUSE mounts) — losing +x
      // is the pre-PR behavior and better than aborting mid-extraction.
      await chmod(fullPath, mode & 0o777).catch(() => {})
    }

    filesWritten++
    if (onProgress && filesWritten % 10 === 0) {
      onProgress(`Extracted ${filesWritten}/${totalFiles} files`)
    }
  }

  logForDebugging(`Extracted ${filesWritten} files to ${extractPath}`)
  if (onProgress) {
    onProgress(`Extraction complete (${filesWritten} files)`)
  }
}

/**
 * Check if an MCPB source has changed and needs re-extraction
 */
// 判断某个 MCPB 来源是否「变了、需要重新解压」：先看缓存元数据，没有就视为要加载；解压目录不存在也视为要加载；本地文件比对 mtime（用 floor 对齐 ISO 字符串的毫秒精度，避免同毫秒内「刚缓存的文件比自己的缓存戳还新」的误判）；URL 来源交给显式更新时再查，这里直接返回 false。
export async function checkMcpbChanged(
  source: string,
  pluginPath: string,
): Promise<boolean> {
  const fs = getFsImplementation()
  const cacheDir = getMcpbCacheDir(pluginPath)
  const metadata = await loadCacheMetadata(cacheDir, source)

  if (!metadata) {
    // No cache metadata, needs loading
    return true
  }

  // Check if extraction directory still exists
  try {
    await fs.stat(metadata.extractedPath)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      logForDebugging(`MCPB extraction path missing: ${metadata.extractedPath}`)
    } else {
      logForDebugging(
        `MCPB extraction path inaccessible: ${metadata.extractedPath}: ${error}`,
        { level: 'error' },
      )
    }
    return true
  }

  // For local files, check mtime
  if (!isUrl(source)) {
    const localPath = join(pluginPath, source)
    let stats
    try {
      stats = await fs.stat(localPath)
    } catch (error) {
      const code = getErrnoCode(error)
      if (code === 'ENOENT') {
        logForDebugging(`MCPB source file missing: ${localPath}`)
      } else {
        logForDebugging(
          `MCPB source file inaccessible: ${localPath}: ${error}`,
          { level: 'error' },
        )
      }
      return true
    }

    const cachedTime = new Date(metadata.cachedAt).getTime()
    // Floor to match the ms precision of cachedAt (ISO string). Sub-ms
    // precision on mtimeMs would make a freshly-cached file appear "newer"
    // than its own cache timestamp when both happen in the same millisecond.
    const fileTime = Math.floor(stats.mtimeMs)

    if (fileTime > cachedTime) {
      logForDebugging(
        `MCPB file modified: ${new Date(fileTime)} > ${new Date(cachedTime)}`,
      )
      return true
    }
  }

  // For URLs, we'll re-check on explicit update (handled elsewhere)
  return false
}

/**
 * Load and extract an MCPB file, with caching and user configuration support
 *
 * @param source - MCPB file path or URL
 * @param pluginPath - Plugin directory path
 * @param pluginId - Plugin identifier in "plugin@marketplace" format (for config storage)
 * @param onProgress - Progress callback
 * @param providedUserConfig - User configuration values (for initial setup or reconfiguration)
 * @returns Success with MCP config, or needs-config status with schema
 */
// 加载并解压 MCPB 文件，带缓存与用户配置支持：先查缓存，未变就直接复用（必要时按 user_config 决定返回 needs-config 还是带配置生成）；缓存失效则下载或本地读取、算哈希、解压 ZIP、解析并校验 manifest、确认有 server 配置，再按是否有 user_config 走「需要配置」或「直接生成」两条路，最后写回缓存元数据。是整个 MCPB 加载的主入口。
export async function loadMcpbFile(
  source: string,
  pluginPath: string,
  pluginId: string,
  onProgress?: ProgressCallback,
  providedUserConfig?: UserConfigValues,
  forceConfigDialog?: boolean,
): Promise<McpbLoadResult | McpbNeedsConfigResult> {
  const fs = getFsImplementation()
  const cacheDir = getMcpbCacheDir(pluginPath)
  await fs.mkdir(cacheDir)

  logForDebugging(`Loading MCPB from source: ${source}`)

  // Check cache first
  const metadata = await loadCacheMetadata(cacheDir, source)
  if (metadata && !(await checkMcpbChanged(source, pluginPath))) {
    logForDebugging(
      `Using cached MCPB from ${metadata.extractedPath} (hash: ${metadata.contentHash})`,
    )

    // Load manifest from cache
    const manifestPath = join(metadata.extractedPath, 'manifest.json')
    let manifestContent: string
    try {
      manifestContent = await fs.readFile(manifestPath, { encoding: 'utf-8' })
    } catch (error) {
      if (isENOENT(error)) {
        const err = new Error(`Cached manifest not found: ${manifestPath}`)
        logError(err)
        throw err
      }
      throw error
    }

    const manifestData = new TextEncoder().encode(manifestContent)
    const manifest = await parseAndValidateManifestFromBytes(manifestData)

    // Check for user_config requirement
    if (manifest.user_config && Object.keys(manifest.user_config).length > 0) {
      // Server name from DXT manifest
      const serverName = manifest.name

      // Try to load existing config from settings.json or use provided config
      const savedConfig = loadMcpServerUserConfig(pluginId, serverName)
      const userConfig = providedUserConfig || savedConfig || {}

      // Validate we have all required fields
      const validation = validateUserConfig(userConfig, manifest.user_config)

      // Return needs-config if: forced (reconfiguration) OR validation failed
      if (forceConfigDialog || !validation.valid) {
        return {
          status: 'needs-config',
          manifest,
          extractedPath: metadata.extractedPath,
          contentHash: metadata.contentHash,
          configSchema: manifest.user_config,
          existingConfig: savedConfig || {},
          validationErrors: validation.valid ? [] : validation.errors,
        }
      }

      // Save config if it was provided (first time or reconfiguration)
      if (providedUserConfig) {
        saveMcpServerUserConfig(
          pluginId,
          serverName,
          providedUserConfig,
          manifest.user_config ?? {},
        )
      }

      // Generate MCP config WITH user config
      const mcpConfig = await generateMcpConfig(
        manifest,
        metadata.extractedPath,
        userConfig,
      )

      return {
        manifest,
        mcpConfig,
        extractedPath: metadata.extractedPath,
        contentHash: metadata.contentHash,
      }
    }

    // No user_config required - generate config without it
    const mcpConfig = await generateMcpConfig(manifest, metadata.extractedPath)

    return {
      manifest,
      mcpConfig,
      extractedPath: metadata.extractedPath,
      contentHash: metadata.contentHash,
    }
  }

  // Not cached or changed - need to download/load and extract
  let mcpbData: Uint8Array
  let mcpbFilePath: string

  if (isUrl(source)) {
    // Download from URL
    const sourceHash = createHash('md5')
      .update(source)
      .digest('hex')
      .substring(0, 8)
    mcpbFilePath = join(cacheDir, `${sourceHash}.mcpb`)
    mcpbData = await downloadMcpb(source, mcpbFilePath, onProgress)
  } else {
    // Load from local path
    const localPath = join(pluginPath, source)

    if (onProgress) {
      onProgress(`Loading ${source}...`)
    }

    try {
      mcpbData = await fs.readFileBytes(localPath)
      mcpbFilePath = localPath
    } catch (error) {
      if (isENOENT(error)) {
        const err = new Error(`MCPB file not found: ${localPath}`)
        logError(err)
        throw err
      }
      throw error
    }
  }

  // Generate content hash
  const contentHash = generateContentHash(mcpbData)
  logForDebugging(`MCPB content hash: ${contentHash}`)

  // Extract ZIP
  if (onProgress) {
    onProgress('Extracting MCPB archive...')
  }

  const unzipped = await unzipFile(Buffer.from(mcpbData))
  // fflate doesn't surface external_attr — parse the central directory so
  // native MCP server binaries keep their exec bit after extraction.
  const modes = parseZipModes(mcpbData)

  // Check for manifest.json
  const manifestData = unzipped['manifest.json']
  if (!manifestData) {
    const error = new Error('No manifest.json found in MCPB file')
    logError(error)
    throw error
  }

  // Parse and validate manifest
  const manifest = await parseAndValidateManifestFromBytes(manifestData)
  logForDebugging(
    `MCPB manifest: ${manifest.name} v${manifest.version} by ${manifest.author.name}`,
  )

  // Check if manifest has server config
  if (!manifest.server) {
    const error = new Error(
      `MCPB manifest for "${manifest.name}" does not define a server configuration`,
    )
    logError(error)
    throw error
  }

  // Extract to cache directory
  const extractPath = join(cacheDir, contentHash)
  await extractMcpbContents(unzipped, extractPath, modes, onProgress)

  // Check for user_config requirement
  if (manifest.user_config && Object.keys(manifest.user_config).length > 0) {
    // Server name from DXT manifest
    const serverName = manifest.name

    // Try to load existing config from settings.json or use provided config
    const savedConfig = loadMcpServerUserConfig(pluginId, serverName)
    const userConfig = providedUserConfig || savedConfig || {}

    // Validate we have all required fields
    const validation = validateUserConfig(userConfig, manifest.user_config)

    if (!validation.valid) {
      // Save cache metadata even though config is incomplete
      const newMetadata: McpbCacheMetadata = {
        source,
        contentHash,
        extractedPath: extractPath,
        cachedAt: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
      }
      await saveCacheMetadata(cacheDir, source, newMetadata)

      // Return "needs configuration" status
      return {
        status: 'needs-config',
        manifest,
        extractedPath: extractPath,
        contentHash,
        configSchema: manifest.user_config,
        existingConfig: savedConfig || {},
        validationErrors: validation.errors,
      }
    }

    // Save config if it was provided (first time or reconfiguration)
    if (providedUserConfig) {
      saveMcpServerUserConfig(
        pluginId,
        serverName,
        providedUserConfig,
        manifest.user_config ?? {},
      )
    }

    // Generate MCP config WITH user config
    if (onProgress) {
      onProgress('Generating MCP server configuration...')
    }

    const mcpConfig = await generateMcpConfig(manifest, extractPath, userConfig)

    // Save cache metadata
    const newMetadata: McpbCacheMetadata = {
      source,
      contentHash,
      extractedPath: extractPath,
      cachedAt: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
    }
    await saveCacheMetadata(cacheDir, source, newMetadata)

    return {
      manifest,
      mcpConfig,
      extractedPath: extractPath,
      contentHash,
    }
  }

  // No user_config required - generate config without it
  if (onProgress) {
    onProgress('Generating MCP server configuration...')
  }

  const mcpConfig = await generateMcpConfig(manifest, extractPath)

  // Save cache metadata
  const newMetadata: McpbCacheMetadata = {
    source,
    contentHash,
    extractedPath: extractPath,
    cachedAt: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
  }
  await saveCacheMetadata(cacheDir, source, newMetadata)

  logForDebugging(
    `Successfully loaded MCPB: ${manifest.name} (extracted to ${extractPath})`,
  )

  return {
    manifest,
    mcpConfig: mcpConfig as McpServerConfig,
    extractedPath: extractPath,
    contentHash,
  }
}
