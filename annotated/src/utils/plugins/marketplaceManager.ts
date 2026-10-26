/**
 * Marketplace manager for Claude Code plugins
 *
 * This module provides functionality to:
 * - Manage known marketplace sources (URLs, GitHub repos, npm packages, local files)
 * - Cache marketplace manifests locally for offline access
 * - Install plugins from marketplace entries
 * - Track and update marketplace configurations
 *
 * File structure managed by this module:
 * ~/.claude/
 *   └── plugins/
 *       ├── known_marketplaces.json    # Configuration of all known marketplaces
 *       └── marketplaces/              # Cache directory for marketplace data
 *           ├── my-marketplace.json    # Cached marketplace from URL source
 *           └── github-marketplace/    # Cloned repository for GitHub source
 *               └── .claude-plugin/
 *                   └── marketplace.json
 */
// 文件总述：插件市场管理器。它管两件事——**意图层**（settings.json 里的 `extraKnownMarketplaces`，用户声明「我要哪些市场」）与**状态层**（`known_marketplaces.json` 里每个市场装在哪、什么时候更新的）。磁盘布局：配置一份，缓存目录下 URL 源存成单个 json 文件、git 源存成克隆出来的目录。

import axios from 'axios'
import { writeFile } from 'fs/promises'
import isEqual from 'lodash-es/isEqual.js'
import memoize from 'lodash-es/memoize.js'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  ConfigParseError,
  errorMessage,
  getErrnoCode,
  isENOENT,
  toError,
} from '../errors.js'
import { execFileNoThrow, execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getFsImplementation } from '../fsOperations.js'
import { gitExe } from '../git.js'
import { logError } from '../log.js'
import {
  getInitialSettings,
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../slowOperations.js'
import {
  getAddDirEnabledPlugins,
  getAddDirExtraMarketplaces,
} from './addDirPluginSettings.js'
import { markPluginVersionOrphaned } from './cacheUtils.js'
import { classifyFetchError, logPluginFetch } from './fetchTelemetry.js'
import { removeAllPluginsForMarketplace } from './installedPluginsManager.js'
import {
  extractHostFromSource,
  formatSourceForDisplay,
  getHostPatternsFromAllowlist,
  getStrictKnownMarketplaces,
  isSourceAllowedByPolicy,
  isSourceInBlocklist,
} from './marketplaceHelpers.js'
import {
  OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_MARKETPLACE_SOURCE,
} from './officialMarketplace.js'
import { fetchOfficialMarketplaceFromGcs } from './officialMarketplaceGcs.js'
import {
  deletePluginDataDir,
  getPluginSeedDirs,
  getPluginsDirectory,
} from './pluginDirectories.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'
import { deletePluginOptions } from './pluginOptionsStorage.js'
import {
  isLocalMarketplaceSource,
  type KnownMarketplace,
  type KnownMarketplacesFile,
  KnownMarketplacesFileSchema,
  type MarketplaceSource,
  type PluginMarketplace,
  type PluginMarketplaceEntry,
  PluginMarketplaceSchema,
  validateOfficialNameSource,
} from './schemas.js'

/**
 * Result of loading and caching a marketplace
 */
// 加载并缓存一个市场的结果：校验过的清单加它在磁盘上的缓存路径。返回缓存路径而不只是清单，是因为重命名缓存目录后路径会变，调用方需要拿到最终位置。
type LoadedPluginMarketplace = {
  marketplace: PluginMarketplace
  cachePath: string
}

/**
 * Get the path to the known marketplaces configuration file
 * Using a function instead of a constant allows proper mocking in tests
 */
// 用函数而不是常量返回路径——常量会在模块加载时就把目录定死，测试里没法改环境变量或 mock 目录。整个模块里所有路径都遵循这个约定。
function getKnownMarketplacesFile(): string {
  return join(getPluginsDirectory(), 'known_marketplaces.json')
}

/**
 * Get the path to the marketplaces cache directory
 * Using a function instead of a constant allows proper mocking in tests
 */
// 市场缓存目录：所有克隆的仓库与下载的清单都落在这里。对外导出，因为好几处需要判断「某个路径是否在本目录内」。
export function getMarketplacesCacheDir(): string {
  return join(getPluginsDirectory(), 'marketplaces')
}

/**
 * Memoized inner function to get marketplace data.
 * This caches the marketplace in memory after loading from disk or network.
 */

/**
 * Clear all cached marketplace data (for testing)
 */
// 清空内存缓存，供测试用。可选链式调用是因为 memoize 包装过的函数在测试中被替换成普通函数时没有 cache 属性。
export function clearMarketplacesCache(): void {
  getMarketplace.cache?.clear?.()
}

/**
 * Configuration for known marketplaces
 */
export type KnownMarketplacesConfig = KnownMarketplacesFile

/**
 * Declared marketplace entry (intent layer).
 *
 * Structurally compatible with settings `extraKnownMarketplaces` entries, but
 * adds `sourceIsFallback` for implicit built-in declarations. This is NOT a
 * settings-schema field — it's only ever set in code (never parsed from JSON).
 */
// 声明式市场条目（意图层）：结构上与 settings 里的条目兼容，但多了 `sourceIsFallback` 这个**只在代码里设置、从不从 JSON 解析**的字段。
export type DeclaredMarketplace = {
  source: MarketplaceSource
  installLocation?: string
  autoUpdate?: boolean
  /**
   * Presence suffices. When set, diffMarketplaces treats an already-materialized
   * entry as upToDate regardless of source shape — never reports sourceChanged.
   *
   * Used for the implicit official-marketplace declaration: we want "clone from
   * GitHub if missing", not "replace with GitHub if present under a different
   * source". Without this, a seed dir that registers the official marketplace
   * under e.g. an internal-mirror source would be stomped by a GitHub re-clone.
   */
// `sourceIsFallback` 只要存在就够了。置位后，对账逻辑会把「已经落地」的条目视为最新，不管源形状如何——永远不报「源变了」。用途是内置官方市场的隐式声明：我们要的是「缺了就按 GitHub 克隆」，而不是「已存在但源不同就替换成 GitHub」。没有这个字段，某个种子目录用内部镜像注册的官方市场会被 GitHub 的重新克隆覆盖掉。
  sourceIsFallback?: boolean
}

/**
 * Get declared marketplace intent from merged settings and --add-dir sources.
 * This is what SHOULD exist — used by the reconciler to find gaps.
 *
 * The official marketplace is implicitly declared with `sourceIsFallback: true`
 * when any enabled plugin references it.
 */
// 计算「应该存在哪些市场」——对账器用它找缺口。只有官方市场能被隐式声明，因为它是唯一的已知内置源，别的市场没有默认源可注入。显式禁用的条目（值为 false）不算。优先级三层，后者覆盖前者：隐式声明、`--add-dir` 带来的、合并后的 settings。
export function getDeclaredMarketplaces(): Record<string, DeclaredMarketplace> {
  const implicit: Record<string, DeclaredMarketplace> = {}

  // Only the official marketplace can be implicitly declared — it's the one
  // built-in source we know. Other marketplaces have no default source to inject.
  // Explicitly-disabled entries (value: false) don't count.
  const enabledPlugins = {
    ...getAddDirEnabledPlugins(),
    ...(getInitialSettings().enabledPlugins ?? {}),
  }
  for (const [pluginId, value] of Object.entries(enabledPlugins)) {
    if (
      value &&
      parsePluginIdentifier(pluginId).marketplace === OFFICIAL_MARKETPLACE_NAME
    ) {
      implicit[OFFICIAL_MARKETPLACE_NAME] = {
        source: OFFICIAL_MARKETPLACE_SOURCE,
        sourceIsFallback: true,
      }
      break
    }
  }

  // Lowest precedence: implicit < --add-dir < merged settings.
  // An explicit extraKnownMarketplaces entry for claude-plugins-official
  // in --add-dir or settings wins.
  return {
    ...implicit,
    ...getAddDirExtraMarketplaces(),
    ...(getInitialSettings().extraKnownMarketplaces ?? {}),
  }
}

/**
 * Find which editable settings source declared a marketplace.
 * Checks in reverse precedence order (highest priority last) so the
 * result is the source that "wins" in the merged view.
 * Returns null if the marketplace isn't declared in any editable source.
 */
// 找出是哪个**可编辑**的 settings 源声明了这个市场，用于把改动回写到正确的层。按优先级从高到低检查，第一个命中的就是合并视图里胜出的那个——写回时也要写到它那里，否则会在低优先级层造出重复条目。
export function getMarketplaceDeclaringSource(
  name: string,
): 'userSettings' | 'projectSettings' | 'localSettings' | null {
  // Check highest-precedence editable sources first — the one that wins
  // in the merged view is the one we should write back to.
  const editableSources: Array<
    'localSettings' | 'projectSettings' | 'userSettings'
  > = ['localSettings', 'projectSettings', 'userSettings']

  for (const source of editableSources) {
    const settings = getSettingsForSource(source)
    if (settings?.extraKnownMarketplaces?.[name]) {
      return source
    }
  }
  return null
}

/**
 * Save a marketplace entry to settings (intent layer).
 * Does NOT touch known_marketplaces.json (state layer).
 *
 * @param name - The marketplace name
 * @param entry - The marketplace config
 * @param settingSource - Which settings source to write to (defaults to userSettings)
 */
// 把市场条目写进 settings（意图层），**不碰** `known_marketplaces.json`（状态层）。两个层分开写是刻意设计：意图是用户可编辑的，状态是运行时产物。
export function saveMarketplaceToSettings(
  name: string,
  entry: DeclaredMarketplace,
  settingSource:
    | 'userSettings'
    | 'projectSettings'
    | 'localSettings' = 'userSettings',
): void {
  const existing = getSettingsForSource(settingSource) ?? {}
  const current = { ...existing.extraKnownMarketplaces }
  current[name] = entry
  updateSettingsForSource(settingSource, { extraKnownMarketplaces: current })
}

/**
 * Load known marketplaces configuration from disk
 *
 * Reads the configuration file at ~/.claude/plugins/known_marketplaces.json
 * which contains a mapping of marketplace names to their sources and metadata.
 *
 * Example configuration file content:
 * ```json
 * {
 *   "official-marketplace": {
 *     "source": { "source": "url", "url": "https://example.com/marketplace.json" },
 *     "installLocation": "/Users/me/.claude/plugins/marketplaces/official-marketplace.json",
 *     "lastUpdated": "2024-01-15T10:30:00.000Z"
 *   },
 *   "company-plugins": {
 *     "source": { "source": "github", "repo": "mycompany/plugins" },
 *     "installLocation": "/Users/me/.claude/plugins/marketplaces/company-plugins",
 *     "lastUpdated": "2024-01-14T15:45:00.000Z"
 *   }
 * }
 * ```
 *
 * @returns Configuration object mapping marketplace names to their metadata
 */
// 读状态层配置。文件不存在返回空对象（首次运行）；schema 校验失败抛专门的配置解析错误并带原始数据，方便用户看是哪一条坏了；其他 IO 或 JSON 错误包成可读信息。
export async function loadKnownMarketplacesConfig(): Promise<KnownMarketplacesConfig> {
  const fs = getFsImplementation()
  const configFile = getKnownMarketplacesFile()

  try {
    const content = await fs.readFile(configFile, {
      encoding: 'utf-8',
    })
    const data = jsonParse(content)
    // Validate against schema
    const parsed = KnownMarketplacesFileSchema().safeParse(data)
    if (!parsed.success) {
// 校验失败时把每个问题拼成「路径: 原因」的形式再抛，比只报「配置损坏」有用得多。
      const errorMsg = `Marketplace configuration file is corrupted: ${parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      logForDebugging(errorMsg, {
        level: 'error',
      })
      throw new ConfigParseError(errorMsg, configFile, data)
    }
    return parsed.data
  } catch (error) {
    if (isENOENT(error)) {
      return {}
    }
    // If it's already a ConfigParseError, re-throw it
    if (error instanceof ConfigParseError) {
      throw error
    }
    // For JSON parse errors or I/O errors, throw with helpful message
    const errorMsg = `Failed to load marketplace configuration: ${errorMessage(error)}`
    logForDebugging(errorMsg, {
      level: 'error',
    })
    throw new Error(errorMsg)
  }
}

/**
 * Load known marketplaces config, returning {} on any error instead of throwing.
 *
 * Use this on read-only paths (plugin loading, feature checks) where a corrupted
 * config should degrade gracefully rather than crash. DO NOT use on load→mutate→save
 * paths — returning {} there would cause the save to overwrite the corrupted file
 * with just the new entry, permanently destroying the user's other entries. The
 * throwing variant preserves the file so the user can fix the corruption and recover.
 */
// 不会抛错的变体，**只能用在只读路径上**。注释里那条警告很重要：绝不能在「读-改-写」链路上用它——读失败返回空对象，接着写回就会把损坏的配置文件用一条新记录整个覆盖，用户的其余条目永久丢失。抛错版本会保住原文件，用户还有机会修。
export async function loadKnownMarketplacesConfigSafe(): Promise<KnownMarketplacesConfig> {
  try {
    return await loadKnownMarketplacesConfig()
  } catch {
    // Inner function already logged via logForDebugging. Don't logError here —
    // corrupted user config isn't a Claude Code bug, shouldn't hit the error file.
    return {}
  }
}

/**
 * Save known marketplaces configuration to disk
 *
 * Writes the configuration to ~/.claude/plugins/known_marketplaces.json,
 * creating the directory structure if it doesn't exist.
 *
 * @param config - The marketplace configuration to save
 */
// 写状态层配置前先过一遍 schema。写坏文件比读坏文件更糟，所以这里是硬校验而不是尽力而为。
export async function saveKnownMarketplacesConfig(
  config: KnownMarketplacesConfig,
): Promise<void> {
  // Validate before saving
  const parsed = KnownMarketplacesFileSchema().safeParse(config)
  const configFile = getKnownMarketplacesFile()

  if (!parsed.success) {
    throw new ConfigParseError(
      `Invalid marketplace config: ${parsed.error.message}`,
      configFile,
      config,
    )
  }

  const fs = getFsImplementation()
  // Get directory from config file path to ensure consistency
  const dir = join(configFile, '..')
  await fs.mkdir(dir)
  writeFileSync_DEPRECATED(configFile, jsonStringify(parsed.data, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

/**
 * Register marketplaces from the read-only seed directories into the primary
 * known_marketplaces.json.
 *
 * The seed's known_marketplaces.json contains installLocation paths pointing
 * into the seed dir itself. Registering those entries into the primary JSON
 * makes them visible to all marketplace readers (getMarketplaceCacheOnly,
 * getPluginByIdCacheOnly, etc.) without any loader changes — they just follow
 * the installLocation wherever it points.
 *
 * Seed entries always win for marketplaces declared in the seed — the seed is
 * admin-managed (baked into the container image). If admin updates the seed
 * in a new image, those changes propagate on next boot. Users opt out of seed
 * plugins via `plugin disable`, not by removing the marketplace.
 *
 * With multiple seed dirs (path-delimiter-separated), first-seed-wins: a
 * marketplace name claimed by an earlier seed is skipped by later seeds.
 *
 * autoUpdate is forced to false since the seed is read-only and git-pull would
 * fail. installLocation is computed from the runtime seedDir, not trusted from
 * the seed's JSON (handles multi-stage Docker mount-path drift).
 *
 * Idempotent: second call with unchanged seed writes nothing.
 *
 * @returns true if any marketplace entries were written/changed (caller should
 *   clear caches so earlier plugin-load passes don't keep stale "marketplace
 *   not found" state)
 */
// 把只读种子目录里的市场注册进主配置。种子是烤进容器镜像的、由管理员维护，里面的 `known_marketplaces.json` 指向种子目录自身；把条目搬进主配置后，所有读取方（缓存读、按 ID 查插件）无需改动就能看到它们——它们只是跟着 `installLocation` 走。规则几条：同名时**种子赢**，因为管理员更新镜像后应当生效；多个种子目录时**先到先得**；`autoUpdate` 强制为 false（只读目录里 git pull 必然失败）；安装位置用运行时的种子目录重算，不信任 JSON 里的路径（多阶段 Docker 构建时挂载点会漂移）。幂等：内容没变就不写盘。返回值表示是否有改动，调用方据此清缓存，否则早先加载过的插件会一直以为「市场不存在」。
export async function registerSeedMarketplaces(): Promise<boolean> {
  const seedDirs = getPluginSeedDirs()
  if (seedDirs.length === 0) return false

  const primary = await loadKnownMarketplacesConfig()
  // First-seed-wins across this registration pass. Can't use the isEqual check
  // alone — two seeds with the same name will have different installLocations.
  const claimed = new Set<string>()
  let changed = 0

  for (const seedDir of seedDirs) {
    const seedConfig = await readSeedKnownMarketplaces(seedDir)
    if (!seedConfig) continue

    for (const [name, seedEntry] of Object.entries(seedConfig)) {
      if (claimed.has(name)) continue

      // Compute installLocation relative to THIS seedDir, not the build-time
      // path baked into the seed's JSON. Handles multi-stage Docker builds
      // where the seed is mounted at a different path than where it was built.
// 按**当前**种子目录重算安装位置，而不是用 JSON 里构建期写死的绝对路径——多阶段 Docker 构建里种子常被挂到与构建时不同的路径。找不到就不占用这个名字，留给后面的种子。
      const resolvedLocation = await findSeedMarketplaceLocation(seedDir, name)
      if (!resolvedLocation) {
        // Seed content missing (incomplete build) — leave primary alone, but
        // don't claim the name either: a later seed may have working content.
        logForDebugging(
          `Seed marketplace '${name}' not found under ${seedDir}/marketplaces/, skipping`,
          { level: 'warn' },
        )
        continue
      }
      claimed.add(name)

      const desired: KnownMarketplace = {
        source: seedEntry.source,
        installLocation: resolvedLocation,
        lastUpdated: seedEntry.lastUpdated,
        autoUpdate: false,
      }

      // Skip if primary already matches — idempotent no-op, no write.
      if (isEqual(primary[name], desired)) continue

      // Seed wins — admin-managed. Overwrite any existing primary entry.
      primary[name] = desired
      changed++
    }
  }

  if (changed > 0) {
    await saveKnownMarketplacesConfig(primary)
    logForDebugging(`Synced ${changed} marketplace(s) from seed dir(s)`)
    return true
  }
  return false
}

// 读种子自己的配置文件，任何失败都返回空（种子内容不完整不该让启动失败），但非「文件不存在」的错误会记一条警告，方便排查构建问题。
async function readSeedKnownMarketplaces(
  seedDir: string,
): Promise<KnownMarketplacesConfig | null> {
  const seedJsonPath = join(seedDir, 'known_marketplaces.json')
  try {
    const content = await getFsImplementation().readFile(seedJsonPath, {
      encoding: 'utf-8',
    })
    const parsed = KnownMarketplacesFileSchema().safeParse(jsonParse(content))
    if (!parsed.success) {
      logForDebugging(
        `Seed known_marketplaces.json invalid at ${seedDir}: ${parsed.error.message}`,
        { level: 'warn' },
      )
      return null
    }
    return parsed.data
  } catch (e) {
    if (!isENOENT(e)) {
      logForDebugging(
        `Failed to read seed known_marketplaces.json at ${seedDir}: ${e}`,
        { level: 'warn' },
      )
    }
    return null
  }
}

/**
 * Locate a marketplace in the seed directory by name.
 *
 * Probes the canonical locations under seedDir/marketplaces/ rather than
 * trusting the seed's stored installLocation (which may have a stale absolute
 * path from a different build-time mount point).
 *
 * @returns Readable location, or null if neither format exists/validates
 */
// 在种子的市场目录下按名字探测规范位置：先是同名目录，再是同名 json 文件。探测而不是信任存储的路径，因为存储的路径可能来自另一个构建阶段的挂载点。
async function findSeedMarketplaceLocation(
  seedDir: string,
  name: string,
): Promise<string | null> {
  const dirCandidate = join(seedDir, 'marketplaces', name)
  const jsonCandidate = join(seedDir, 'marketplaces', `${name}.json`)
  for (const candidate of [dirCandidate, jsonCandidate]) {
    try {
      await readCachedMarketplace(candidate)
      return candidate
    } catch {
      // Try next candidate
    }
  }
  return null
}

/**
 * If installLocation points into a configured seed directory, return that seed
 * directory. Seed-managed entries are admin-controlled — users can't
 * remove/refresh/modify them (they'd be overwritten by registerSeedMarketplaces
 * on next startup). Returning the specific seed lets error messages name it.
 */
// 判断某个安装位置是否落在某个种子目录里。种子管理的条目是管理员控制的——用户改不动、删不掉，因为下次启动会被重新注册覆盖。返回具体是哪个种子目录，是为了错误信息能点名。
function seedDirFor(installLocation: string): string | undefined {
  return getPluginSeedDirs().find(
    d => installLocation === d || installLocation.startsWith(d + sep),
  )
}

/**
 * Git pull operation (exported for testing)
 *
 * Pulls latest changes with a configurable timeout (default 120s, override via CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS).
 * Provides helpful error messages for common failure scenarios.
 * If a ref is specified, fetches and checks out that specific branch or tag.
 */
// Environment variables to prevent git from prompting for credentials
// 两个环境变量配合杜绝 git 交互式提问：关掉终端提示，并把 askpass 置空（防止弹出 GUI 密码框）。私有仓库的凭证仍可由用户既有的 credential helper 提供——这里只是保证「没有提示」而不是「没有认证」。
const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0', // Prevent terminal credential prompts
  GIT_ASKPASS: '', // Disable askpass GUI programs
}

const DEFAULT_PLUGIN_GIT_TIMEOUT_MS = 120 * 1000

// 超时可配，默认 120 秒。环境变量解析失败或非正数就回落到默认值，不做报错——配置写错不该让插件系统整体不可用。
function getPluginGitTimeoutMs(): number {
  const envValue = process.env.CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_PLUGIN_GIT_TIMEOUT_MS
}

// git pull。指定了 ref 时走三步：先 fetch 该 ref、再 checkout、最后 pull；任一失败都交给错误增强函数翻译成人话。成功后统一补一次子模块同步。
export async function gitPull(
  cwd: string,
  ref?: string,
  options?: { disableCredentialHelper?: boolean; sparsePaths?: string[] },
): Promise<{ code: number; stderr: string }> {
  logForDebugging(`git pull: cwd=${cwd} ref=${ref ?? 'default'}`)
  const env = { ...process.env, ...GIT_NO_PROMPT_ENV }
  const credentialArgs = options?.disableCredentialHelper
    ? ['-c', 'credential.helper=']
    : []

  if (ref) {
    const fetchResult = await execFileNoThrowWithCwd(
      gitExe(),
      [...credentialArgs, 'fetch', 'origin', ref],
      { cwd, timeout: getPluginGitTimeoutMs(), stdin: 'ignore', env },
    )

    if (fetchResult.code !== 0) {
      return enhanceGitPullErrorMessages(fetchResult)
    }

    const checkoutResult = await execFileNoThrowWithCwd(
      gitExe(),
      [...credentialArgs, 'checkout', ref],
      { cwd, timeout: getPluginGitTimeoutMs(), stdin: 'ignore', env },
    )

    if (checkoutResult.code !== 0) {
      return enhanceGitPullErrorMessages(checkoutResult)
    }

    const pullResult = await execFileNoThrowWithCwd(
      gitExe(),
      [...credentialArgs, 'pull', 'origin', ref],
      { cwd, timeout: getPluginGitTimeoutMs(), stdin: 'ignore', env },
    )
    if (pullResult.code !== 0) {
      return enhanceGitPullErrorMessages(pullResult)
    }
    await gitSubmoduleUpdate(cwd, credentialArgs, env, options?.sparsePaths)
    return pullResult
  }

  const result = await execFileNoThrowWithCwd(
    gitExe(),
    [...credentialArgs, 'pull', 'origin', 'HEAD'],
    { cwd, timeout: getPluginGitTimeoutMs(), stdin: 'ignore', env },
  )
  if (result.code !== 0) {
    return enhanceGitPullErrorMessages(result)
  }
  await gitSubmoduleUpdate(cwd, credentialArgs, env, options?.sparsePaths)
  return result
}

/**
 * Sync submodule working dirs after a successful pull. gitClone() uses
 * --recurse-submodules, but gitPull() didn't — the parent repo's submodule
 * pointer would advance while the working dir stayed at the old commit,
 * making plugin sources in submodules unresolvable after marketplace update.
 * Non-fatal: a failed submodule update logs a warning; most marketplaces
 * don't use submodules at all. (gh-30696)
 *
 * Skipped for sparse clones — gitClone's sparse path intentionally omits
 * --recurse-submodules to preserve partial-clone bandwidth savings, and
 * .gitmodules is a root file that cone-mode sparse-checkout always
 * materializes, so the .gitmodules gate alone can't distinguish sparse repos.
 *
 * Perf: git-submodule is a bash script that spawns ~20 subprocesses (~35ms+)
 * even when no submodules exist. .gitmodules is a tracked file — pull
 * materializes it iff the repo has submodules — so gate on its presence to
 * skip the spawn for the common case.
 *
 * --init performs first-contact clone of newly-added submodules, so maintain
 * parity with gitClone's non-sparse path: StrictHostKeyChecking=yes for
 * fail-closed SSH (unknown hosts reject rather than silently populate
 * known_hosts), and --depth 1 for shallow clone (matching --shallow-submodules).
 * --depth only affects not-yet-initialized submodules; existing shallow
 * submodules are unaffected.
 */
// 子模块同步。为什么需要：克隆时用了「递归子模块」，更新时却没用，于是父仓库的子模块指针前进了、工作目录还停在旧提交，插件源在子模块里就会解析不到（gh-30696）。三个细节：稀疏克隆直接跳过（克隆时就没带子模块，`.gitmodules` 在稀疏模式下仍会被检出，光看这个文件区分不出）；用 `.gitmodules` 是否存在作为闸门（git-submodule 是 bash 脚本，即使没有子模块也要起约 20 个子进程、耗时 35 毫秒以上，而 `.gitmodules` 是跟踪文件，有子模块才会被物化）；`--init` 首次拉子模块时保持与克隆路径一致的安全设置——SSH 严格校验主机键（未知主机拒绝而不是静默写入已知主机），并且浅克隆。
async function gitSubmoduleUpdate(
  cwd: string,
  credentialArgs: string[],
  env: NodeJS.ProcessEnv,
  sparsePaths: string[] | undefined,
): Promise<void> {
  if (sparsePaths && sparsePaths.length > 0) return
  const hasGitmodules = await getFsImplementation()
    .stat(join(cwd, '.gitmodules'))
    .then(
      () => true,
      () => false,
    )
  if (!hasGitmodules) return
  const result = await execFileNoThrowWithCwd(
    gitExe(),
    [
      '-c',
      'core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
      ...credentialArgs,
      'submodule',
      'update',
      '--init',
      '--recursive',
      '--depth',
      '1',
    ],
    { cwd, timeout: getPluginGitTimeoutMs(), stdin: 'ignore', env },
  )
  if (result.code !== 0) {
    logForDebugging(
      `git submodule update failed (non-fatal): ${result.stderr}`,
      { level: 'warn' },
    )
  }
}

/**
 * Enhance error messages for git pull failures
 */
// 把 git 的原始 stderr 翻译成可操作的提示。
function enhanceGitPullErrorMessages(result: {
  code: number
  stderr: string
  error?: string
}): { code: number; stderr: string } {
  if (result.code === 0) {
    return result
  }

  // Detect execa timeout kills via the error field (stderr won't contain "timed out"
  // when the process is killed by SIGTERM — the timeout info is only in error)
// 超时检测必须看错误字段而不是 stderr：进程被 SIGTERM 杀掉时，stderr 里根本没有「timed out」字样，超时信息只在 execa 的错误对象里。
  if (result.error?.includes('timed out')) {
    const timeoutSec = Math.round(getPluginGitTimeoutMs() / 1000)
    return {
      ...result,
      stderr: `Git pull timed out after ${timeoutSec}s. Try increasing the timeout via CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS environment variable.\n\nOriginal error: ${result.stderr}`,
    }
  }

  // Detect SSH host key verification failures (check before the generic
  // 'Could not read from remote' catch — that string appears in both cases).
  // OpenSSH emits "Host key verification failed" for BOTH host-not-in-known_hosts
  // and host-key-has-changed — the latter also includes the "REMOTE HOST
  // IDENTIFICATION HAS CHANGED" banner, which needs different remediation.
// 主机键变化的检测**必须排在**通用的「无法从远端读取」之前——那句话两种情况都会出现。OpenSSH 对「主机不在已知列表」和「主机键变了」都输出同一句「主机键校验失败」，只能靠键变更横幅区分。两者的补救方式完全不同：前者连一次加进已知列表，后者要先 ssh-keygen -R 删掉旧条目（可能是服务器轮换，也可能是中间人攻击）。
  if (result.stderr.includes('REMOTE HOST IDENTIFICATION HAS CHANGED')) {
    return {
      ...result,
      stderr: `SSH host key for this marketplace's git host has changed (server key rotation or possible MITM). Remove the stale entry with: ssh-keygen -R <host>\nThen connect once manually to accept the new key.\n\nOriginal error: ${result.stderr}`,
    }
  }
  if (result.stderr.includes('Host key verification failed')) {
    return {
      ...result,
      stderr: `SSH host key verification failed while updating marketplace. The host key is not in your known_hosts file. Connect once manually to add it (e.g., ssh -T git@<host>), or remove and re-add the marketplace with an HTTPS URL.\n\nOriginal error: ${result.stderr}`,
    }
  }

  // Detect SSH authentication failures
  if (
    result.stderr.includes('Permission denied (publickey)') ||
    result.stderr.includes('Could not read from remote repository')
  ) {
    return {
      ...result,
      stderr: `SSH authentication failed while updating marketplace. Please ensure your SSH keys are configured.\n\nOriginal error: ${result.stderr}`,
    }
  }

  // Detect network issues
  if (
    result.stderr.includes('timed out') ||
    result.stderr.includes('Could not resolve host')
  ) {
    return {
      ...result,
      stderr: `Network error while updating marketplace. Please check your internet connection.\n\nOriginal error: ${result.stderr}`,
    }
  }

  return result
}

/**
 * Check if SSH is likely to work for GitHub
 * This is a quick heuristic check that avoids the full clone timeout
 *
 * Uses StrictHostKeyChecking=yes (not accept-new) so an unknown github.com
 * host key fails closed rather than being silently added to known_hosts.
 * This prevents a network-level MITM from poisoning known_hosts on first
 * contact. Users who already have github.com in known_hosts see no change;
 * users who don't are routed to the HTTPS clone path.
 *
 * @returns true if SSH auth succeeds and github.com is already trusted
 */
// 快速判断 GitHub 的 SSH 是否可用，避免在没配 SSH 的机器上白等克隆超时。用严格主机键校验（不是 accept-new）——未知的 github.com 主机键必须失败，否则网络层中间人能在首次连接时污染已知主机列表。已经信任 github.com 的用户无感，没有的用户会被导向 HTTPS 路径。
async function isGitHubSshLikelyConfigured(): Promise<boolean> {
  try {
    // Quick SSH connection test with 2 second timeout
    // This fails fast if SSH isn't configured
    const result = await execFileNoThrow(
      'ssh',
      [
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=2',
        '-o',
        'StrictHostKeyChecking=yes',
        'git@github.com',
      ],
      {
        timeout: 3000, // 3 second total timeout
      },
    )

    // SSH to github.com always returns exit code 1 with "successfully authenticated"
    // or exit code 255 with "Permission denied" - we want the former
// 判断依据有点反直觉：连 github.com 测试时，成功认证的退出码是 **1** 而不是 0（ssh 在无 shell 访问时返回 1），失败是 255。所以要同时看退出码与「成功认证」字样，stdout 与 stderr 都可能出现。
    const configured =
      result.code === 1 &&
      (result.stderr?.includes('successfully authenticated') ||
        result.stdout?.includes('successfully authenticated'))
    logForDebugging(
      `SSH config check: code=${result.code} configured=${configured}`,
    )
    return configured
  } catch (error) {
    // Any error means SSH isn't configured properly
    logForDebugging(`SSH configuration check failed: ${errorMessage(error)}`, {
      level: 'warn',
    })
    return false
  }
}

/**
 * Check if a git error indicates authentication failure.
 * Used to provide enhanced error messages for auth failures.
 */
// 判断 git 错误是否属于认证失败，用于给 HTTPS 路径更准确的提示（而不是丢一句「克隆失败」）。
function isAuthenticationError(stderr: string): boolean {
  return (
    stderr.includes('Authentication failed') ||
    stderr.includes('could not read Username') ||
    stderr.includes('terminal prompts disabled') ||
    stderr.includes('403') ||
    stderr.includes('401')
  )
}

/**
 * Extract the SSH host from a git URL for error messaging.
 * Matches the SSH format user@host:path (e.g., git@github.com:owner/repo.git).
 */
// 从 SSH 形式的 git 地址里抠出主机名，只用于拼错误提示里的命令示例。
function extractSshHost(gitUrl: string): string | null {
  const match = gitUrl.match(/^[^@]+@([^:]+):/)
  return match?.[1] ?? null
}

/**
 * Git clone operation (exported for testing)
 *
 * Clones a git repository with a configurable timeout (default 120s, override via CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS)
 * and larger repositories. Provides helpful error messages for common failure scenarios.
 * Optionally checks out a specific branch or tag.
 *
 * Does NOT disable credential helpers — this allows the user's existing auth setup
 * (gh auth, keychain, git-credential-store, etc.) to work natively for private repos.
 * Interactive prompts are still prevented via GIT_TERMINAL_PROMPT=0, GIT_ASKPASS='',
 * stdin: 'ignore', and BatchMode=yes for SSH.
 *
 * Uses StrictHostKeyChecking=yes (not accept-new): unknown SSH hosts fail closed
 * with a clear message rather than being silently trusted on first contact. For
 * the github source type, the preflight check routes unknown-host users to HTTPS
 * automatically; for explicit git@host:… URLs, users see an actionable error.
 */
// git clone。与 pull 的差别是**不禁用凭证助手**——私有仓库靠用户既有的认证配置（gh 登录态、钥匙串、凭证存储）原生工作，只是禁止交互提示。
export async function gitClone(
  gitUrl: string,
  targetPath: string,
  ref?: string,
  sparsePaths?: string[],
): Promise<{ code: number; stderr: string }> {
  const useSparse = sparsePaths && sparsePaths.length > 0
  const args = [
    '-c',
    'core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
    'clone',
    '--depth',
    '1',
  ]

// 稀疏克隆走部分克隆：`--filter=blob:none` 推迟下载文件内容，`--no-checkout` 推迟检出，等稀疏规则配好再检出。同时**故意不带子模块**——稀疏单体仓库很少需要子模块，递归子模块会把部分克隆省下的带宽全吃掉。
  if (useSparse) {
    // Partial clone: skip blob download until checkout, defer checkout until
    // after sparse-checkout is configured. Submodules are intentionally dropped
    // for sparse clones — sparse monorepos rarely need them, and recursing
    // submodules would defeat the partial-clone bandwidth savings.
    args.push('--filter=blob:none', '--no-checkout')
  } else {
    args.push('--recurse-submodules', '--shallow-submodules')
  }

  if (ref) {
    args.push('--branch', ref)
  }

  args.push(gitUrl, targetPath)

  const timeoutMs = getPluginGitTimeoutMs()
  logForDebugging(
    `git clone: url=${redactUrlCredentials(gitUrl)} ref=${ref ?? 'default'} timeout=${timeoutMs}ms`,
  )

  const result = await execFileNoThrowWithCwd(gitExe(), args, {
    timeout: timeoutMs,
    stdin: 'ignore',
    env: { ...process.env, ...GIT_NO_PROMPT_ENV },
  })

  // Scrub credentials from execa's error/stderr fields before any logging or
  // returning. execa's shortMessage embeds the full command line (including
  // the credentialed URL), and result.stderr may also contain it on some git
  // versions.
// 凭证擦除：execa 的 shortMessage 会把完整命令行嵌进去（含带 token 的 URL），某些 git 版本的 stderr 也会回显它。所以在任何日志或返回之前，先把 URL 里的凭证替换掉。
  const redacted = redactUrlCredentials(gitUrl)
  if (gitUrl !== redacted) {
    if (result.error) result.error = result.error.replaceAll(gitUrl, redacted)
    if (result.stderr)
      result.stderr = result.stderr.replaceAll(gitUrl, redacted)
  }

  if (result.code === 0) {
// 稀疏检出配置：`sparse-checkout set --cone` 在 git 2.25 以上一步完成初始化与路径选择，然后用 `checkout HEAD` 物化。ref 在克隆时已通过 `--branch` 传入，所以 HEAD 就指向它；没给 ref 时 HEAD 指向远端默认分支。
    if (useSparse) {
      // Configure the sparse cone, then materialize only those paths.
      // `sparse-checkout set --cone` handles both init and path selection
      // in a single step on git >= 2.25.
      const sparseResult = await execFileNoThrowWithCwd(
        gitExe(),
        ['sparse-checkout', 'set', '--cone', '--', ...sparsePaths],
        {
          cwd: targetPath,
          timeout: timeoutMs,
          stdin: 'ignore',
          env: { ...process.env, ...GIT_NO_PROMPT_ENV },
        },
      )
      if (sparseResult.code !== 0) {
        return {
          code: sparseResult.code,
          stderr: `git sparse-checkout set failed: ${sparseResult.stderr}`,
        }
      }

      const checkoutResult = await execFileNoThrowWithCwd(
        gitExe(),
        // ref was already passed to clone via --branch, so HEAD points to it;
        // if no ref, HEAD points to the remote's default branch.
        ['checkout', 'HEAD'],
        {
          cwd: targetPath,
          timeout: timeoutMs,
          stdin: 'ignore',
          env: { ...process.env, ...GIT_NO_PROMPT_ENV },
        },
      )
      if (checkoutResult.code !== 0) {
        return {
          code: checkoutResult.code,
          stderr: `git checkout after sparse-checkout failed: ${checkoutResult.stderr}`,
        }
      }
    }
    logForDebugging(`git clone succeeded: ${redactUrlCredentials(gitUrl)}`)
    return result
  }

  logForDebugging(
    `git clone failed: url=${redactUrlCredentials(gitUrl)} code=${result.code} error=${result.error ?? 'none'} stderr=${result.stderr}`,
    { level: 'warn' },
  )

  // Detect timeout kills — when execFileNoThrowWithCwd kills the process via SIGTERM,
  // stderr may only contain partial output (e.g. "Cloning into '...'") with no
  // "timed out" string. Check the error field from execa which contains the
  // timeout message.
// 克隆超时的提示要带上当前超时值与怎么调大，因为大仓库超时是最常见的失败原因之一。
  if (result.error?.includes('timed out')) {
    return {
      ...result,
      stderr: `Git clone timed out after ${Math.round(timeoutMs / 1000)}s. The repository may be too large for the current timeout. Set CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS to increase it (e.g., 300000 for 5 minutes).\n\nOriginal error: ${result.stderr}`,
    }
  }

  // Enhance error messages for common scenarios
  if (result.stderr) {
    // Host key verification failure — check FIRST, before the generic
    // 'Could not read from remote repository' catch (that string appears
    // in both stderr outputs, so order matters). OpenSSH emits
    // "Host key verification failed" for BOTH host-not-in-known_hosts and
    // host-key-has-changed; distinguish them by the key-change banner.
// 克隆路径的主机键处理与 pull 一致，但这里能拿到 git 地址、可以拼出具体的主机名，提示更可操作。
    if (result.stderr.includes('REMOTE HOST IDENTIFICATION HAS CHANGED')) {
      const host = extractSshHost(gitUrl)
      const removeHint = host ? `ssh-keygen -R ${host}` : 'ssh-keygen -R <host>'
      return {
        ...result,
        stderr: `SSH host key has changed (server key rotation or possible MITM). Remove the stale known_hosts entry:\n  ${removeHint}\nThen connect once manually to verify and accept the new key.\n\nOriginal error: ${result.stderr}`,
      }
    }
    if (result.stderr.includes('Host key verification failed')) {
      const host = extractSshHost(gitUrl)
      const connectHint = host ? `ssh -T git@${host}` : 'ssh -T git@<host>'
      return {
        ...result,
        stderr: `SSH host key is not in your known_hosts file. To add it, connect once manually (this will show the fingerprint for you to verify):\n  ${connectHint}\n\nOr use an HTTPS URL instead (recommended for public repos).\n\nOriginal error: ${result.stderr}`,
      }
    }

    if (
      result.stderr.includes('Permission denied (publickey)') ||
      result.stderr.includes('Could not read from remote repository')
    ) {
      return {
        ...result,
        stderr: `SSH authentication failed. Please ensure your SSH keys are configured for GitHub, or use an HTTPS URL instead.\n\nOriginal error: ${result.stderr}`,
      }
    }

    if (isAuthenticationError(result.stderr)) {
      return {
        ...result,
        stderr: `HTTPS authentication failed. Please ensure your credential helper is configured (e.g., gh auth login).\n\nOriginal error: ${result.stderr}`,
      }
    }

    if (
      result.stderr.includes('timed out') ||
      result.stderr.includes('timeout') ||
      result.stderr.includes('Could not resolve host')
    ) {
      return {
        ...result,
        stderr: `Network error or timeout while cloning repository. Please check your internet connection and try again.\n\nOriginal error: ${result.stderr}`,
      }
    }
  }

  // Fallback for empty stderr — gh-28373: user saw "Failed to clone
  // marketplace repository:" with nothing after the colon. Git CAN fail
  // without writing to stderr (stdout instead, or output swallowed by
  // credential helper / signal). execa's error field has the execa-level
  // message (command, exit code, signal); exit code is the minimum.
// 空 stderr 的兜底（gh-28373）：用户曾看到「克隆市场仓库失败：」后面什么都没有。git 确实可能不写 stderr 就失败（写到了 stdout，或输出被凭证助手吞掉，或被信号打断）。此时至少把 execa 的错误信息或退出码报出来。
  if (!result.stderr) {
    return {
      code: result.code,
      stderr:
        result.error ||
        `git clone exited with code ${result.code} (no stderr output). Run with --debug to see the full command.`,
    }
  }

  return result
}

/**
 * Progress callback for marketplace operations.
 *
 * This callback is invoked at various stages during marketplace operations
 * (downloading, git operations, validation, etc.) to provide user feedback.
 *
 * IMPORTANT: Implementations should handle errors internally and not throw exceptions.
 * If a callback throws, it will be caught and logged but won't abort the operation.
 *
 * @param message - Human-readable progress message to display to the user
 */
// 进度回调。约定：实现方必须自己吞掉异常——回调抛错会被捕获并记录，不会中断操作。这样 UI 层的 bug 不会连带把插件安装搞挂。
export type MarketplaceProgressCallback = (message: string) => void

/**
 * Safely invoke a progress callback, catching and logging any errors.
 * Prevents callback errors from aborting marketplace operations.
 *
 * @param onProgress - The progress callback to invoke
 * @param message - Progress message to pass to the callback
 */
// 安全调用进度回调，把异常关在回调内部。
function safeCallProgress(
  onProgress: MarketplaceProgressCallback | undefined,
  message: string,
): void {
  if (!onProgress) return
  try {
    onProgress(message)
  } catch (callbackError) {
    logForDebugging(`Progress callback error: ${errorMessage(callbackError)}`, {
      level: 'warn',
    })
  }
}

/**
 * Reconcile the on-disk sparse-checkout state with the desired config.
 *
 * Runs before gitPull to handle transitions:
 * - Full→Sparse or SparseA→SparseB: run `sparse-checkout set --cone` (idempotent)
 * - Sparse→Full: return non-zero so caller falls back to rm+reclone. Avoids
 *   `sparse-checkout disable` on a --filter=blob:none partial clone, which would
 *   trigger a lazy fetch of every blob in the monorepo.
 * - Full→Full (common case): single local `git config --get` check, no-op.
 *
 * Failures here (ENOENT, not a repo) are harmless — gitPull will also fail and
 * trigger the clone path, which establishes the correct state from scratch.
 */
// 把磁盘上的稀疏检出状态与期望配置对齐，在 pull 之前跑。三种迁移：完整转稀疏、稀疏 A 转稀疏 B——都直接重设规则（幂等）；**稀疏转完整则返回非零**，让调用方走「删掉重克隆」，而不是执行 `sparse-checkout disable`，因为后者在部分克隆的仓库上会触发把所有 blob 惰性拉一遍，单体仓库可能就是几个 G；完整转完整（绝大多数情况）只做一次本地 config 查询就返回。这里的失败都是无害的——pull 也会失败，照样落到克隆路径，从零建立正确状态。
export async function reconcileSparseCheckout(
  cwd: string,
  sparsePaths: string[] | undefined,
): Promise<{ code: number; stderr: string }> {
  const env = { ...process.env, ...GIT_NO_PROMPT_ENV }

  if (sparsePaths && sparsePaths.length > 0) {
    return execFileNoThrowWithCwd(
      gitExe(),
      ['sparse-checkout', 'set', '--cone', '--', ...sparsePaths],
      { cwd, timeout: getPluginGitTimeoutMs(), stdin: 'ignore', env },
    )
  }

  const check = await execFileNoThrowWithCwd(
    gitExe(),
    ['config', '--get', 'core.sparseCheckout'],
    { cwd, stdin: 'ignore', env },
  )
// 检测到仓库当前是稀疏、但配置里已经没有稀疏路径了，返回非零让上层重克隆。注释解释了为什么不能就地关闭稀疏。
  if (check.code === 0 && check.stdout.trim() === 'true') {
    return {
      code: 1,
      stderr:
        'sparsePaths removed from config but repository is sparse; re-cloning for full checkout',
    }
  }
  return { code: 0, stderr: '' }
}

/**
 * Cache a marketplace from a git repository
 *
 * Clones or updates a git repository containing marketplace data.
 * If the repository already exists at cachePath, pulls the latest changes.
 * If pulling fails, removes the directory and re-clones.
 *
 * Example repository structure:
 * ```
 * my-marketplace/
 *   ├── .claude-plugin/
 *   │   └── marketplace.json    # Default location for marketplace manifest
 *   ├── plugins/                # Plugin implementations
 *   └── README.md
 * ```
 *
 * @param gitUrl - The git URL to clone (https or ssh)
 * @param cachePath - Local directory path to clone/update the repository
 * @param ref - Optional git branch or tag to checkout
 * @param onProgress - Optional callback to report progress
 */
// 按 git 源缓存市场：仓库已在就 pull，pull 失败就删目录重克隆。
async function cacheMarketplaceFromGit(
  gitUrl: string,
  cachePath: string,
  ref?: string,
  sparsePaths?: string[],
  onProgress?: MarketplaceProgressCallback,
  options?: { disableCredentialHelper?: boolean },
): Promise<void> {
  const fs = getFsImplementation()

// **pull 优先**而不是先 stat 再决定：这样避免了「检查与使用之间状态变化」的竞态——缓存目录不存在或没有 `.git` 时 pull 自己就会返回非零，直接走重克隆即可。
  // Attempt incremental update; fall back to re-clone if the repo is absent,
  // stale, or otherwise not updatable. Using pull-first avoids a stat-before-operate
  // TOCTOU check: gitPull returns non-zero when cachePath is missing or has no .git.
  const timeoutSec = Math.round(getPluginGitTimeoutMs() / 1000)
  safeCallProgress(
    onProgress,
    `Refreshing marketplace cache (timeout: ${timeoutSec}s)…`,
  )

  // Reconcile sparse-checkout config before pulling. If this requires a re-clone
  // (Sparse→Full transition) or fails (missing dir, not a repo), skip straight
  // to the rm+clone fallback.
// 稀疏状态对齐失败（需要重克隆，或目录不存在、不是仓库）就跳过 pull，直接进删除加重克隆的分支。
  const reconcileResult = await reconcileSparseCheckout(cachePath, sparsePaths)
  if (reconcileResult.code === 0) {
    const pullStarted = performance.now()
    const pullResult = await gitPull(cachePath, ref, {
      disableCredentialHelper: options?.disableCredentialHelper,
      sparsePaths,
    })
    logPluginFetch(
      'marketplace_pull',
      gitUrl,
      pullResult.code === 0 ? 'success' : 'failure',
      performance.now() - pullStarted,
      pullResult.code === 0 ? undefined : classifyFetchError(pullResult.stderr),
    )
    if (pullResult.code === 0) return
    logForDebugging(`git pull failed, will re-clone: ${pullResult.stderr}`, {
      level: 'warn',
    })
  } else {
    logForDebugging(
      `sparse-checkout reconcile requires re-clone: ${reconcileResult.stderr}`,
    )
  }

// 删旧目录。只有删成功才说明真有陈旧目录，记一条诊断日志；文件不存在（ENOENT）只代表这是全新安装，不算错误；其他删除失败则必须报错让人工介入——否则后面的克隆会因为目标目录已存在而失败，错误信息还看不出根因。
  try {
    await fs.rm(cachePath, { recursive: true })
    // rm succeeded — a stale or partially-cloned directory existed; log for diagnostics
    logForDebugging(
      `Found stale marketplace directory at ${cachePath}, cleaning up to allow re-clone`,
      { level: 'warn' },
    )
    safeCallProgress(
      onProgress,
      'Found stale directory, cleaning up and re-cloning…',
    )
  } catch (rmError) {
    if (!isENOENT(rmError)) {
      const rmErrorMsg = errorMessage(rmError)
      throw new Error(
        `Failed to clean up existing marketplace directory. Please manually delete the directory at ${cachePath} and try again.\n\nTechnical details: ${rmErrorMsg}`,
      )
    }
    // ENOENT — cachePath didn't exist, this is a fresh install, nothing to clean up
  }

  // Clone the repository (one attempt — no internal retry loop)
  const refMessage = ref ? ` (ref: ${ref})` : ''
  safeCallProgress(
    onProgress,
    `Cloning repository (timeout: ${timeoutSec}s): ${redactUrlCredentials(gitUrl)}${refMessage}`,
  )
  const cloneStarted = performance.now()
  const result = await gitClone(gitUrl, cachePath, ref, sparsePaths)
  logPluginFetch(
    'marketplace_clone',
    gitUrl,
    result.code === 0 ? 'success' : 'failure',
    performance.now() - cloneStarted,
    result.code === 0 ? undefined : classifyFetchError(result.stderr),
  )
  if (result.code !== 0) {
    // Clean up any partial directory created by the failed clone so the next
    // attempt starts fresh. Best-effort: if this fails, the stale dir will be
    // auto-detected and removed at the top of the next call.
    try {
      await fs.rm(cachePath, { recursive: true, force: true })
    } catch {
      // ignore
    }
    throw new Error(`Failed to clone marketplace repository: ${result.stderr}`)
  }
  safeCallProgress(onProgress, 'Clone complete, validating marketplace…')
}

/**
 * Redact header values for safe logging
 *
 * @param headers - Headers to redact
 * @returns Headers with values replaced by '***REDACTED***'
 */
// 请求头脱敏：只保留键名，值全部替换成固定标记。市场源可以带认证头，而这些头会进调试日志，可能被贴进 issue。
function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key]) => [key, '***REDACTED***']),
  )
}

/**
 * Redact userinfo (username:password) in a URL to avoid logging credentials.
 *
 * Marketplace URLs may embed credentials (e.g. GitHub PATs in
 * `https://user:token@github.com/org/repo`). Debug logs and progress output
 * are written to disk and may be included in bug reports, so credentials must
 * be redacted before logging.
 *
 * Redacts all credentials from http(s) URLs:
 *   https://user:token@github.com/repo → https://***:***@github.com/repo
 *   https://:token@github.com/repo     → https://:***@github.com/repo
 *   https://token@github.com/repo      → https://***@github.com/repo
 *
 * Both username and password are redacted unconditionally on http(s) because
 * it is impossible to distinguish `placeholder:secret` (e.g. x-access-token:ghp_...)
 * from `secret:placeholder` (e.g. ghp_...:x-oauth-basic) by parsing alone.
 * Non-http(s) schemes (ssh://git@...) and non-URL inputs (`owner/repo` shorthand)
 * pass through unchanged.
 */
// URL 里的用户信息脱敏。为什么要**无条件**同时抹掉用户名和密码：光靠解析分不清「用户名是占位符、密码是真密钥」（如 `x-access-token:ghp_...`）还是「用户名是真密钥、密码是占位符」（如 `ghp_...:x-oauth-basic`）——两种约定都真实存在，所以两个都抹。非 http(s) 协议（ssh 形式）与不是 URL 的简写（owner/repo）原样返回。
function redactUrlCredentials(urlString: string): string {
  try {
    const parsed = new URL(urlString)
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    if (isHttp && (parsed.username || parsed.password)) {
      if (parsed.username) parsed.username = '***'
      if (parsed.password) parsed.password = '***'
      return parsed.toString()
    }
  } catch {
    // Not a valid URL — safe as-is
  }
  return urlString
}

/**
 * Cache a marketplace from a URL
 *
 * Downloads a marketplace.json file from a URL and saves it locally.
 * Creates the cache directory structure if it doesn't exist.
 *
 * Example marketplace.json structure:
 * ```json
 * {
 *   "name": "my-marketplace",
 *   "owner": { "name": "John Doe", "email": "john@example.com" },
 *   "plugins": [
 *     {
 *       "id": "my-plugin",
 *       "name": "My Plugin",
 *       "source": "./plugins/my-plugin.json",
 *       "category": "productivity",
 *       "description": "A helpful plugin"
 *     }
 *   ]
 * }
 * ```
 *
 * @param url - The URL to download the marketplace.json from
 * @param cachePath - Local file path to save the downloaded marketplace
 * @param customHeaders - Optional custom HTTP headers for authentication
 * @param onProgress - Optional callback to report progress
 */
// 按 URL 源缓存市场：下载清单、校验、写盘。
async function cacheMarketplaceFromUrl(
  url: string,
  cachePath: string,
  customHeaders?: Record<string, string>,
  onProgress?: MarketplaceProgressCallback,
): Promise<void> {
  const fs = getFsImplementation()

  const redactedUrl = redactUrlCredentials(url)
  safeCallProgress(onProgress, `Downloading marketplace from ${redactedUrl}`)
  logForDebugging(`Downloading marketplace from URL: ${redactedUrl}`)
  if (customHeaders && Object.keys(customHeaders).length > 0) {
    logForDebugging(
      `Using custom headers: ${jsonStringify(redactHeaders(customHeaders))}`,
    )
  }

// 自定义请求头在前、User-Agent 在后——注释写明了原因：顺序保证用户提供的头无法覆盖 User-Agent，与网页抓取组件的行为保持一致。
  const headers = {
    ...customHeaders,
    // User-Agent must come last to prevent override (for consistency with WebFetch)
    'User-Agent': 'Claude-Code-Plugin-Manager',
  }

  let response
  const fetchStarted = performance.now()
  try {
    response = await axios.get(url, {
      timeout: 10000,
      headers,
    })
  } catch (error) {
    logPluginFetch(
      'marketplace_url',
      url,
      'failure',
      performance.now() - fetchStarted,
      classifyFetchError(error),
    )
// 按错误类型给不同提示：连不上（拒绝连接或域名不存在）、超时、HTTP 状态码错误（多半是清单不在这个地址）。三类之外统一兜底。
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(
          `Could not connect to ${redactedUrl}. Please check your internet connection and verify the URL is correct.\n\nTechnical details: ${error.message}`,
        )
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error(
          `Request timed out while downloading marketplace from ${redactedUrl}. The server may be slow or unreachable.\n\nTechnical details: ${error.message}`,
        )
      }
      if (error.response) {
        throw new Error(
          `HTTP ${error.response.status} error while downloading marketplace from ${redactedUrl}. The marketplace file may not exist at this URL.\n\nTechnical details: ${error.message}`,
        )
      }
    }
    throw new Error(
      `Failed to download marketplace from ${redactedUrl}: ${errorMessage(error)}`,
    )
  }

  safeCallProgress(onProgress, 'Validating marketplace data')
  // Validate the response is a valid marketplace
// 下载回来的内容必须过 schema 校验才写盘——网络来的数据一律不可信，且这里也要上报埋点（区分网络失败与 schema 不合法）。
  const result = PluginMarketplaceSchema().safeParse(response.data)
  if (!result.success) {
    logPluginFetch(
      'marketplace_url',
      url,
      'failure',
      performance.now() - fetchStarted,
      'invalid_schema',
    )
    throw new ConfigParseError(
      `Invalid marketplace schema from URL: ${result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      redactedUrl,
      response.data,
    )
  }
  logPluginFetch(
    'marketplace_url',
    url,
    'success',
    performance.now() - fetchStarted,
  )

  safeCallProgress(onProgress, 'Saving marketplace to cache')
  // Ensure cache directory exists
  const cacheDir = join(cachePath, '..')
  await fs.mkdir(cacheDir)

  // Write the validated marketplace file
  writeFileSync_DEPRECATED(cachePath, jsonStringify(result.data, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

/**
 * Generate a cache path for a marketplace source
 */
// 为源生成一个临时缓存名：github 把仓库全名的斜杠换成横线，npm 去掉 scope 的 at 符号，file 取文件名去扩展名，directory 取目录名，其余用时间戳兜底。这只是**临时名**——真正落地时会重命名成清单里声明的市场名。
function getCachePathForSource(source: MarketplaceSource): string {
  const tempName =
    source.source === 'github'
      ? source.repo.replace('/', '-')
      : source.source === 'npm'
        ? source.package.replace('@', '').replace('/', '-')
        : source.source === 'file'
          ? basename(source.path).replace('.json', '')
          : source.source === 'directory'
            ? basename(source.path)
            : 'temp_' + Date.now()
  return tempName
}

/**
 * Parse and validate JSON file with a Zod schema
 */
// 带 schema 读 JSON 文件：解析失败与校验失败都抛带文件路径和原始内容的配置错误，让用户能直接定位。
async function parseFileWithSchema<T>(
  filePath: string,
  schema: {
    safeParse: (data: unknown) => {
      success: boolean
      data?: T
      error?: {
        issues: Array<{ path: PropertyKey[]; message: string }>
      }
    }
  },
): Promise<T> {
  const fs = getFsImplementation()
  const content = await fs.readFile(filePath, { encoding: 'utf-8' })
  let data: unknown
  try {
    data = jsonParse(content)
  } catch (error) {
    throw new ConfigParseError(
      `Invalid JSON in ${filePath}: ${errorMessage(error)}`,
      filePath,
      content,
    )
  }
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ConfigParseError(
      `Invalid schema: ${filePath} ${result.error?.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      filePath,
      data,
    )
  }
  return result.data!
}

/**
 * Load and cache a marketplace from its source
 *
 * Handles different source types:
 * - URL: Downloads marketplace.json directly
 * - GitHub: Clones repo and looks for .claude-plugin/marketplace.json
 * - Git: Clones repository from git URL
 * - NPM: (Not yet implemented) Would fetch from npm package
 * - File: Reads from local filesystem
 *
 * After loading, validates the marketplace schema and renames the cache
 * to match the marketplace's actual name from the manifest.
 *
 * Cache structure:
 * ~/.claude/plugins/marketplaces/
 *   ├── official-marketplace.json     # From URL source
 *   ├── github-marketplace/          # From GitHub/Git source
 *   │   └── .claude-plugin/
 *   │       └── marketplace.json
 *   └── local-marketplace.json       # From file source
 *
 * @param source - The marketplace source to load from
 * @param onProgress - Optional callback to report progress
 * @returns Object containing the validated marketplace and its cache path
 * @throws If marketplace file not found or validation fails
 */
// 加载并缓存市场的总入口，按源类型分派。共七种：url（直接下清单）、github（智能选 SSH/HTTPS）、git（给定地址）、npm（未实现）、file（本地清单文件）、directory（本地目录加约定子路径）、settings（settings 内联、无网络）。成功后做两件收尾事：校验保留名只能来自官方源；把临时缓存重命名成清单里的真实名字。
async function loadAndCacheMarketplace(
  source: MarketplaceSource,
  onProgress?: MarketplaceProgressCallback,
): Promise<LoadedPluginMarketplace> {
  const fs = getFsImplementation()
  const cacheDir = getMarketplacesCacheDir()

  // Ensure cache directory exists
  await fs.mkdir(cacheDir)

  let temporaryCachePath: string
  let marketplacePath: string
  let cleanupNeeded = false

  // Generate a temp name for the cache path
  const tempName = getCachePathForSource(source)

  try {
    switch (source.source) {
      case 'url': {
        // Direct URL to marketplace.json
        temporaryCachePath = join(cacheDir, `${tempName}.json`)
        cleanupNeeded = true
        await cacheMarketplaceFromUrl(
          source.url,
          temporaryCachePath,
          source.headers,
          onProgress,
        )
        marketplacePath = temporaryCachePath
        break
      }

// github 源先探一次 SSH 是否可用再决定主协议，失败后自动换另一种协议重试。两个方向都覆盖：SSH 配了但克隆失败则退 HTTPS，HTTPS 失败则试 SSH——后者不是多余，有些环境只能走 SSH。每次失败都要清掉可能创建了一半的目录，否则第二次尝试会因为目录已存在而失败。
      case 'github': {
        // Smart SSH/HTTPS selection: check if SSH is configured before trying it
        // This avoids waiting for timeout on SSH when it's not configured
        const sshUrl = `git@github.com:${source.repo}.git`
        const httpsUrl = `https://github.com/${source.repo}.git`
        temporaryCachePath = join(cacheDir, tempName)
        cleanupNeeded = true

        let lastError: Error | null = null

        // Quick check if SSH is likely to work
        const sshConfigured = await isGitHubSshLikelyConfigured()

        if (sshConfigured) {
          // SSH looks good, try it first
          safeCallProgress(onProgress, `Cloning via SSH: ${sshUrl}`)
          try {
            await cacheMarketplaceFromGit(
              sshUrl,
              temporaryCachePath,
              source.ref,
              source.sparsePaths,
              onProgress,
            )
          } catch (err) {
            lastError = toError(err)

            // Log SSH failure for monitoring
            logError(lastError)

            // SSH failed despite being configured, try HTTPS fallback
            safeCallProgress(
              onProgress,
              `SSH clone failed, retrying with HTTPS: ${httpsUrl}`,
            )

            logForDebugging(
              `SSH clone failed for ${source.repo} despite SSH being configured, falling back to HTTPS`,
              { level: 'info' },
            )

            // Clean up failed SSH attempt if it created anything
            await fs.rm(temporaryCachePath, { recursive: true, force: true })

            // Try HTTPS
            try {
              await cacheMarketplaceFromGit(
                httpsUrl,
                temporaryCachePath,
                source.ref,
                source.sparsePaths,
                onProgress,
              )
              lastError = null // Success!
            } catch (httpsErr) {
              // HTTPS also failed - use HTTPS error as the final error
              lastError = toError(httpsErr)

              // Log HTTPS failure for monitoring (both SSH and HTTPS failed)
              logError(lastError)
            }
          }
        } else {
          // SSH not configured, go straight to HTTPS
          safeCallProgress(
            onProgress,
            `SSH not configured, cloning via HTTPS: ${httpsUrl}`,
          )

          logForDebugging(
            `SSH not configured for GitHub, using HTTPS for ${source.repo}`,
            { level: 'info' },
          )

          try {
            await cacheMarketplaceFromGit(
              httpsUrl,
              temporaryCachePath,
              source.ref,
              source.sparsePaths,
              onProgress,
            )
          } catch (err) {
            lastError = toError(err)

            // Always try SSH as fallback for ANY HTTPS failure
            // Log HTTPS failure for monitoring
            logError(lastError)

            // HTTPS failed, try SSH as fallback
            safeCallProgress(
              onProgress,
              `HTTPS clone failed, retrying with SSH: ${sshUrl}`,
            )

            logForDebugging(
              `HTTPS clone failed for ${source.repo} (${lastError.message}), falling back to SSH`,
              { level: 'info' },
            )

            // Clean up failed HTTPS attempt if it created anything
            await fs.rm(temporaryCachePath, { recursive: true, force: true })

            // Try SSH
            try {
              await cacheMarketplaceFromGit(
                sshUrl,
                temporaryCachePath,
                source.ref,
                source.sparsePaths,
                onProgress,
              )
              lastError = null // Success!
            } catch (sshErr) {
              // SSH also failed - use SSH error as the final error
              lastError = toError(sshErr)

              // Log SSH failure for monitoring (both HTTPS and SSH failed)
              logError(lastError)
            }
          }
        }

        // If we still have an error, throw it
        if (lastError) {
          throw lastError
        }

// 清单在仓库里的默认位置是 `.claude-plugin/marketplace.json`，源里可用 `path` 覆盖。
        marketplacePath = join(
          temporaryCachePath,
          source.path || '.claude-plugin/marketplace.json',
        )
        break
      }

      case 'git': {
        temporaryCachePath = join(cacheDir, tempName)
        cleanupNeeded = true
        await cacheMarketplaceFromGit(
          source.url,
          temporaryCachePath,
          source.ref,
          source.sparsePaths,
          onProgress,
        )
        marketplacePath = join(
          temporaryCachePath,
          source.path || '.claude-plugin/marketplace.json',
        )
        break
      }

// npm 源只是占位。留成显式抛错而不是静默跳过，用户能立刻知道这条路没通。
      case 'npm': {
        // TODO: Implement npm package support
        throw new Error('NPM marketplace sources not yet implemented')
      }

// file 源指向 `.claude-plugin/marketplace.json`，所以市场根目录要往上两级。路径解析成绝对路径，错误信息里显示的才是真实检查过的位置（历史上老配置里存过相对路径）。`cleanupNeeded` 为 false——绝不能删用户自己的文件。
      case 'file': {
        // For local files, resolve paths relative to marketplace root directory
        // File sources point to .claude-plugin/marketplace.json, so the marketplace
        // root is two directories up (parent of .claude-plugin/)
        // Resolve to absolute so error messages show the actual path checked
        // (legacy known_marketplaces.json entries may have relative paths)
        const absPath = resolve(source.path)
        marketplacePath = absPath
        temporaryCachePath = dirname(dirname(absPath))
        cleanupNeeded = false
        break
      }

// directory 源给的是市场根目录，清单在约定的子路径下。同样解析成绝对路径、同样不参与清理。
      case 'directory': {
        // For directories, look for .claude-plugin/marketplace.json
        // Resolve to absolute so error messages show the actual path checked
        // (legacy known_marketplaces.json entries may have relative paths)
        const absPath = resolve(source.path)
        marketplacePath = join(absPath, '.claude-plugin', 'marketplace.json')
        temporaryCachePath = absPath
        cleanupNeeded = false
        break
      }

// settings 源是内联清单，不联网。做法是把清单**合成**到磁盘上的标准位置，让「只读缓存」那条路径不需要任何特殊分支就能读到它。直接写到最终名字，所以后面的重命名是空操作。已知市场配置里会存整个源对象（含 plugins 数组），因此对账时用深比较就能发现 settings 里的编辑，不需要额外的脏标记。
      case 'settings': {
        // Inline manifest from settings.json — no fetch. Synthesize the
        // marketplace.json on disk so getMarketplaceCacheOnly reads it
        // like any other source. The plugins array already passed
        // PluginMarketplaceEntrySchema validation when settings were parsed;
        // the post-switch parseFileWithSchema re-validates the full
        // PluginMarketplaceSchema (catches schema drift between the two).
        //
        // Writing to source.name up front means the rename below is a no-op
        // (temporaryCachePath === finalCachePath). known_marketplaces.json
        // stores this source object including the plugins array, so
        // diffMarketplaces detects settings edits via isEqual — no special
        // dirty-tracking needed.
        temporaryCachePath = join(cacheDir, source.name)
        marketplacePath = join(
          temporaryCachePath,
          '.claude-plugin',
          'marketplace.json',
        )
        cleanupNeeded = false
        await fs.mkdir(dirname(marketplacePath))
        // No `satisfies PluginMarketplace` here: source.plugins is the narrow
        // SettingsMarketplacePlugin type (no strict/.default(), no manifest
        // fields). The parseFileWithSchema(PluginMarketplaceSchema()) call
        // below widens and validates — that's the real check.
        await writeFile(
          marketplacePath,
          jsonStringify(
            {
              name: source.name,
              owner: source.owner ?? { name: 'settings' },
              plugins: source.plugins,
            },
            null,
            2,
          ),
        )
        break
      }

      default:
        throw new Error(`Unsupported marketplace source type`)
    }

    // Load and validate the marketplace
    logForDebugging(`Reading marketplace from ${marketplacePath}`)
    let marketplace: PluginMarketplace
    try {
      marketplace = await parseFileWithSchema(
        marketplacePath,
        PluginMarketplaceSchema(),
      )
    } catch (e) {
      if (isENOENT(e)) {
        throw new Error(`Marketplace file not found at ${marketplacePath}`)
      }
      throw new Error(
        `Failed to parse marketplace file at ${marketplacePath}: ${errorMessage(e)}`,
      )
    }

    // Now rename the cache path to use the marketplace's actual name
// 用清单声明里的名字作最终缓存名。
    const finalCachePath = join(cacheDir, marketplace.name)
    // Defense-in-depth: the schema rejects path separators, .., and . in marketplace.name,
    // but verify the computed path is a strict subdirectory of cacheDir before fs.rm.
    // A malicious marketplace.json with a crafted name must never cause us to rm outside
    // cacheDir, nor rm cacheDir itself (e.g. name "." → join normalizes to cacheDir).
// **安全关键**：进入删除逻辑之前，必须确认最终路径严格位于缓存目录**之下**。schema 已经拒绝了路径分隔符、双点、单点，但这里再验一次是纵深防御——一个恶意清单用精心构造的名字绝不能让程序删到缓存目录之外，也不能删掉缓存目录本身（名字为单点时 join 会归一化成缓存目录）。
    const resolvedFinal = resolve(finalCachePath)
    const resolvedCacheDir = resolve(cacheDir)
    if (!resolvedFinal.startsWith(resolvedCacheDir + sep)) {
      throw new Error(
        `Marketplace name '${marketplace.name}' resolves to a path outside the cache directory`,
      )
    }
    // Don't rename if it's a local file or directory, or already has the right name
// 本地源不重命名（那是用户的目录），临时路径已等于最终路径时也不用动。
    if (
      temporaryCachePath !== finalCachePath &&
      !isLocalMarketplaceSource(source)
    ) {
      try {
        // Remove the destination if it already exists, then rename
        try {
          onProgress?.('Cleaning up old marketplace cache…')
        } catch (callbackError) {
          logForDebugging(
            `Progress callback error: ${errorMessage(callbackError)}`,
            { level: 'warn' },
          )
        }
        await fs.rm(finalCachePath, { recursive: true, force: true })
        // Rename temp cache to final name
        await fs.rename(temporaryCachePath, finalCachePath)
        temporaryCachePath = finalCachePath
        cleanupNeeded = false // Successfully renamed, no cleanup needed
      } catch (error) {
        const errorMsg = errorMessage(error)
        throw new Error(
          `Failed to finalize marketplace cache. Please manually delete the directory at ${finalCachePath} if it exists and try again.\n\nTechnical details: ${errorMsg}`,
        )
      }
    }

    return { marketplace, cachePath: temporaryCachePath }
// 任何一步失败都要清掉自己创建的临时缓存，避免下次运行看到半成品目录。本地源跳过——绝不删用户的东西。清理本身的失败只记警告，不掩盖原始错误。
  } catch (error) {
    // Clean up any temporary files/directories on error
    if (
      cleanupNeeded &&
      temporaryCachePath! &&
      !isLocalMarketplaceSource(source)
    ) {
      try {
        await fs.rm(temporaryCachePath!, { recursive: true, force: true })
      } catch (cleanupError) {
        logForDebugging(
          `Warning: Failed to clean up temporary marketplace cache at ${temporaryCachePath}: ${errorMessage(cleanupError)}`,
          { level: 'warn' },
        )
      }
    }
    throw error
  }
}

/**
 * Add a marketplace source to the known marketplaces
 *
 * The marketplace is fetched, validated, and cached locally.
 * The configuration is saved to ~/.claude/plugins/known_marketplaces.json.
 *
 * @param source - MarketplaceSource object representing the marketplace source.
 *                 Callers should parse user input into MarketplaceSource format
 *                 (see AddMarketplace.parseMarketplaceInput for handling shortcuts like "owner/repo").
 * @param onProgress - Optional callback for progress updates during marketplace installation
 * @throws If source format is invalid or marketplace cannot be loaded
 */
// 添加市场源。返回值里的 `alreadyMaterialized` 让调用方能区分「真的克隆了」与「这个源早就在」。
export async function addMarketplaceSource(
  source: MarketplaceSource,
  onProgress?: MarketplaceProgressCallback,
): Promise<{
  name: string
  alreadyMaterialized: boolean
  resolvedSource: MarketplaceSource
}> {
  // Resolve relative directory/file paths to absolute so state is cwd-independent
  let resolvedSource = source
// 先把本地相对路径解析成绝对路径再存——否则状态会依赖当前工作目录，换个目录运行就读不到了。
  if (isLocalMarketplaceSource(source) && !isAbsolute(source.path)) {
    resolvedSource = { ...source, path: resolve(source.path) }
  }

  // Check policy FIRST, before any network/filesystem operations
  // This prevents downloading/cloning when the source is blocked
// **企业策略检查必须排在任何网络与文件操作之前**——源被禁就根本不该开始下载克隆。错误信息区分两种情况：显式在阻止列表里；不在允许列表里（此时把允许的源列出来；若源是 github 简写而策略用的是主机模式，提示改用完整 URL，因为简写默认指向 github.com）。
  if (!isSourceAllowedByPolicy(resolvedSource)) {
    // Check if explicitly blocked vs not in allowlist for better error messages
    if (isSourceInBlocklist(resolvedSource)) {
      throw new Error(
        `Marketplace source '${formatSourceForDisplay(resolvedSource)}' is blocked by enterprise policy.`,
      )
    }
    // Not in allowlist - build helpful error message
    const allowlist = getStrictKnownMarketplaces() || []
    const hostPatterns = getHostPatternsFromAllowlist()
    const sourceHost = extractHostFromSource(resolvedSource)

    let errorMessage = `Marketplace source '${formatSourceForDisplay(resolvedSource)}'`
    if (sourceHost) {
      errorMessage += ` (${sourceHost})`
    }
    errorMessage += ' is blocked by enterprise policy.'

    if (allowlist.length > 0) {
      errorMessage += ` Allowed sources: ${allowlist.map(s => formatSourceForDisplay(s)).join(', ')}`
    } else {
      errorMessage += ' No external marketplaces are allowed.'
    }

    // If source is a github shorthand and there are hostPatterns, suggest using full URL
    if (resolvedSource.source === 'github' && hostPatterns.length > 0) {
      errorMessage +=
        `\n\nTip: The shorthand "${resolvedSource.repo}" assumes github.com. ` +
        `For internal GitHub Enterprise, use the full URL:\n` +
        `  git@your-github-host.com:${resolvedSource.repo}.git`
    }

    throw new Error(errorMessage)
  }

// 源级幂等：完全相同的源已经落地就直接返回，不重复克隆。判据是深比较源对象，所以带不同 ref 或稀疏路径的算不同源。
  // Source-idempotency: if this exact source already exists, skip clone
  const existingConfig = await loadKnownMarketplacesConfig()
  for (const [existingName, existingEntry] of Object.entries(existingConfig)) {
    if (isEqual(existingEntry.source, resolvedSource)) {
      logForDebugging(
        `Source already materialized as '${existingName}', skipping clone`,
      )
      return { name: existingName, alreadyMaterialized: true, resolvedSource }
    }
  }

  // Load and cache the marketplace to validate it and get its name
  const { marketplace, cachePath } = await loadAndCacheMarketplace(
    resolvedSource,
    onProgress,
  )

// 保留名只能来自官方源。校验放在加载之后——名字要先从清单里读出来才知道。
  // Validate that reserved names come from official sources
  const sourceValidationError = validateOfficialNameSource(
    marketplace.name,
    resolvedSource,
  )
  if (sourceValidationError) {
    throw new Error(sourceValidationError)
  }

  // Name collision with different source: overwrite (settings intent wins).
  // Seed-managed entries are admin-controlled and cannot be overwritten.
  // Re-read config after clone (may take a while; another process may have written).
  const config = await loadKnownMarketplacesConfig()
  const oldEntry = config[marketplace.name]
// 同名不同源时按「settings 意图优先」覆盖，但种子管理的条目例外——那是管理员控制的，覆盖会被下次启动还原，所以直接报错并指引用户找管理员或换个名字。这里重读了一次配置，因为克隆可能耗时很久，期间别的进程可能写过。
  if (oldEntry) {
    const seedDir = seedDirFor(oldEntry.installLocation)
    if (seedDir) {
      throw new Error(
        `Marketplace '${marketplace.name}' is seed-managed (${seedDir}). ` +
          `To use a different source, ask your admin to update the seed, ` +
          `or use a different marketplace name.`,
      )
    }
    logForDebugging(
      `Marketplace '${marketplace.name}' exists with different source — overwriting`,
    )
    // Clean up the old cache if it's not a user-owned local path AND it
    // actually differs from the new cachePath. loadAndCacheMarketplace writes
    // to cachePath BEFORE we get here — rm-ing the same dir deletes the fresh
    // write. Settings sources always land on the same dir (name → path);
    // git sources hit this latently when the source repo changes but the
    // fetched marketplace.json declares the same name. Only rm when locations
    // genuinely differ (the only case where there's a stale dir to clean).
    //
    // Defensively validate the stored path before rm: a corrupted
    // installLocation (gh-32793, gh-32661) could point at the user's project
    // dir. If it's outside the cache dir, skip cleanup — the stale dir (if
    // any) is harmless, and blocking the re-add would prevent the user from
    // fixing the corruption.
// 清理旧缓存前有两道判断。第一道：新缓存是否就是旧位置——加载流程**先**写好了新缓存，如果两者同目录，再删一次就把刚写的东西删了（settings 源总是同名同目录；git 源在仓库换了但清单名字没变时会踩到）。第二道：存储的安装位置是否在缓存目录内——历史上出现过配置损坏（Windows 路径在 WSL 下读、字面波浪号、手工编辑）指向用户项目目录的情况（gh-32793、gh-32661）。越界就跳过清理并记警告：陈旧目录（如果有）本身无害，而拦住这次添加会让用户没法修好损坏。
    if (!isLocalMarketplaceSource(oldEntry.source)) {
      const cacheDir = resolve(getMarketplacesCacheDir())
      const resolvedOld = resolve(oldEntry.installLocation)
      const resolvedNew = resolve(cachePath)
      if (resolvedOld === resolvedNew) {
        // Same dir — loadAndCacheMarketplace already overwrote in place.
        // Nothing to clean.
      } else if (
        resolvedOld === cacheDir ||
        resolvedOld.startsWith(cacheDir + sep)
      ) {
        const fs = getFsImplementation()
        await fs.rm(oldEntry.installLocation, { recursive: true, force: true })
      } else {
        logForDebugging(
          `Skipping cleanup of old installLocation (${oldEntry.installLocation}) — ` +
            `outside ${cacheDir}. The path is corrupted; leaving it alone and ` +
            `overwriting the config entry.`,
          { level: 'warn' },
        )
      }
    }
  }

  // Update config using the marketplace's actual name
// 按清单里的真实名字写入状态层，时间戳用当前时间。
  config[marketplace.name] = {
    source: resolvedSource,
    installLocation: cachePath,
    lastUpdated: new Date().toISOString(),
  }
  await saveKnownMarketplacesConfig(config)

  logForDebugging(`Added marketplace source: ${marketplace.name}`)

  return { name: marketplace.name, alreadyMaterialized: false, resolvedSource }
}

/**
 * Remove a marketplace source from known marketplaces
 *
 * Removes the marketplace configuration and cleans up cached files.
 * Deletes both directory caches (for git sources) and file caches (for URL sources).
 * Also cleans up the marketplace from settings.json (extraKnownMarketplaces) and
 * removes related plugin entries from enabledPlugins.
 *
 * @param name - The marketplace name to remove
 * @throws If marketplace with given name is not found
 */
// 移除市场：删配置、删缓存（目录与 json 两种形态都试）、从 settings 里清市场声明与相关插件、最后卸载该市场下所有插件并标记孤立路径、清掉它们存过的选项与密钥。
export async function removeMarketplaceSource(name: string): Promise<void> {
  const config = await loadKnownMarketplacesConfig()

  if (!config[name]) {
    throw new Error(`Marketplace '${name}' not found`)
  }

  // Seed-registered marketplaces are admin-baked into the container — removing
  // them is a category error. They'd resurrect on next startup anyway. Guide
  // the user to the right action instead.
  const entry = config[name]
  const seedDir = seedDirFor(entry.installLocation)
// 种子管理的市场拒绝删除——那是类别错误，删了下次启动也会复活。指引用户真正的动作是禁用具体插件，而不是移除市场。
  if (seedDir) {
    throw new Error(
      `Marketplace '${name}' is registered from the read-only seed directory ` +
        `(${seedDir}) and will be re-registered on next startup. ` +
        `To stop using its plugins: claude plugin disable <plugin>@${name}`,
    )
  }

  // Remove from config
  delete config[name]
  await saveKnownMarketplacesConfig(config)

  // Clean up cached files (both directory and JSON formats)
  const fs = getFsImplementation()
  const cacheDir = getMarketplacesCacheDir()
  const cachePath = join(cacheDir, name)
  await fs.rm(cachePath, { recursive: true, force: true })
  const jsonCachePath = join(cacheDir, `${name}.json`)
  await fs.rm(jsonCachePath, { force: true })

  // Clean up settings.json - remove marketplace from extraKnownMarketplaces
  // and remove related plugin entries from enabledPlugins

  // Check each editable settings source
  const editableSources: Array<
    'userSettings' | 'projectSettings' | 'localSettings'
  > = ['userSettings', 'projectSettings', 'localSettings']

  for (const source of editableSources) {
    const settings = getSettingsForSource(source)
    if (!settings) continue

    let needsUpdate = false
    const updates: {
      extraKnownMarketplaces?: typeof settings.extraKnownMarketplaces
      enabledPlugins?: typeof settings.enabledPlugins
    } = {}

    // Remove from extraKnownMarketplaces if present
// 从 settings 里删市场用的是**赋 undefined** 而不是 delete——配置合并逻辑把 undefined 当作「删除这个键」的信号，直接 delete 在合并视图里看不出来。
    if (settings.extraKnownMarketplaces?.[name]) {
      const updatedMarketplaces: Partial<
        SettingsJson['extraKnownMarketplaces']
      > = { ...settings.extraKnownMarketplaces }
      // Use undefined values (NOT delete) to signal key removal via mergeWith
      updatedMarketplaces[name] = undefined
      updates.extraKnownMarketplaces =
        updatedMarketplaces as SettingsJson['extraKnownMarketplaces']
      needsUpdate = true
    }

    // Remove related plugins from enabledPlugins (format: "plugin@marketplace")
// 插件 ID 的格式是「插件名 at 市场名」，所以按后缀匹配就能一次清掉该市场下的所有插件条目。
    if (settings.enabledPlugins) {
      const marketplaceSuffix = `@${name}`
      const updatedPlugins = { ...settings.enabledPlugins }
      let removedPlugins = false

      for (const pluginId in updatedPlugins) {
        if (pluginId.endsWith(marketplaceSuffix)) {
          updatedPlugins[pluginId] = undefined
          removedPlugins = true
        }
      }

      if (removedPlugins) {
        updates.enabledPlugins = updatedPlugins
        needsUpdate = true
      }
    }

    // Update settings if changes were made
    if (needsUpdate) {
      const result = updateSettingsForSource(source, updates)
      if (result.error) {
        logError(result.error)
        logForDebugging(
          `Failed to clean up marketplace '${name}' from ${source} settings: ${result.error.message}`,
        )
      } else {
        logForDebugging(
          `Cleaned up marketplace '${name}' from ${source} settings`,
        )
      }
    }
  }

  // Remove plugins from installed_plugins.json and mark orphaned paths.
  // Also wipe their stored options/secrets — after marketplace removal
  // zero installations remain, same "last scope gone" condition as
  // uninstallPluginOp.
// 卸载该市场下的全部插件：拿到被孤立的安装路径与被移除的插件 ID，前者标记为孤儿（磁盘上的版本目录可能还被别的市场引用），后者删掉存储的选项与数据目录——市场都没了，这些数据不可能再有归属。
  const { orphanedPaths, removedPluginIds } =
    removeAllPluginsForMarketplace(name)
  for (const installPath of orphanedPaths) {
    await markPluginVersionOrphaned(installPath)
  }
  for (const pluginId of removedPluginIds) {
    deletePluginOptions(pluginId)
    await deletePluginDataDir(pluginId)
  }

  logForDebugging(`Removed marketplace source: ${name}`)
}

/**
 * Read a cached marketplace from disk without updating it
 *
 * @param installLocation - Path to the cached marketplace
 * @returns The marketplace object
 * @throws If marketplace file not found or invalid
 */
// 只读缓存：git 源的清单在约定的子目录里，url/file/directory 源的清单就是安装位置本身。先试嵌套路径，只有两种情况才回退——目录不存在（ENOENT）或它不是目录（ENOTDIR）；**解析错误必须直接抛出**，不能悄悄回退到把整目录当文件读，那样报出来的错会完全误导人。
async function readCachedMarketplace(
  installLocation: string,
): Promise<PluginMarketplace> {
  // For git-sourced directories, the manifest lives at .claude-plugin/marketplace.json.
  // For url/file/directory sources it is the installLocation itself.
  // Try the nested path first; fall back to installLocation when it is a plain file
  // (ENOTDIR) or the nested file is simply missing (ENOENT).
  const nestedPath = join(installLocation, '.claude-plugin', 'marketplace.json')
  try {
    return await parseFileWithSchema(nestedPath, PluginMarketplaceSchema())
  } catch (e) {
    if (e instanceof ConfigParseError) throw e
    const code = getErrnoCode(e)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e
  }
  return await parseFileWithSchema(installLocation, PluginMarketplaceSchema())
}

/**
 * Get a specific marketplace by name from cache only (no network).
 * Returns null if cache is missing or corrupted.
 * Use this for startup paths that should never block on network.
 */
// 按名字只读缓存，绝不联网——给启动路径用，启动绝不能被网络阻塞。缓存缺失或损坏都返回空，不抛错。
export async function getMarketplaceCacheOnly(
  name: string,
): Promise<PluginMarketplace | null> {
  const fs = getFsImplementation()
  const configFile = getKnownMarketplacesFile()

  try {
    const content = await fs.readFile(configFile, { encoding: 'utf-8' })
    const config = jsonParse(content) as KnownMarketplacesConfig
    const entry = config[name]

    if (!entry) {
      return null
    }

    return await readCachedMarketplace(entry.installLocation)
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    logForDebugging(
      `Failed to read cached marketplace ${name}: ${errorMessage(error)}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * Get a specific marketplace by name
 *
 * First attempts to read from cache. Only fetches from source if:
 * - No cached version exists
 * - Cache is invalid/corrupted
 *
 * This avoids unnecessary network/git operations on every access.
 * Use refreshMarketplace() to explicitly update from source.
 *
 * @param name - The marketplace name to fetch
 * @returns The marketplace object or null if not found/failed
 */
// 按名字取市场，带记忆化。命中内存就直接返回；否则先读磁盘缓存，缓存坏了才回源重新加载。
export const getMarketplace = memoize(
  async (name: string): Promise<PluginMarketplace> => {
    const config = await loadKnownMarketplacesConfig()
    const entry = config[name]

    if (!entry) {
      throw new Error(
        `Marketplace '${name}' not found in configuration. Available marketplaces: ${Object.keys(config).join(', ')}`,
      )
    }

    // Legacy entries (pre-#19708) may have relative paths in global config.
    // These are meaningless outside the project that wrote them — resolving
    // against process.cwd() produces the wrong path. Give actionable guidance
    // instead of a misleading ENOENT.
// 遗留状态处理：老版本可能把**相对路径**写进全局配置，而相对路径只有在写它的那个项目目录里才有意义，按当前目录解析必然错。这里不猜、不修，直接给出可操作的指令——比抛一个误导人的「文件不存在」好得多。
    if (
      isLocalMarketplaceSource(entry.source) &&
      !isAbsolute(entry.source.path)
    ) {
      throw new Error(
        `Marketplace "${name}" has a relative source path (${entry.source.path}) ` +
          `in known_marketplaces.json — this is stale state from an older ` +
          `Claude Code version. Run 'claude marketplace remove ${name}' and ` +
          `re-add it from the original project directory.`,
      )
    }

    // Try to read from disk cache
    try {
      return await readCachedMarketplace(entry.installLocation)
    } catch (error) {
      // Log cache corruption before re-fetching
      logForDebugging(
        `Cache corrupted or missing for marketplace ${name}, re-fetching from source: ${errorMessage(error)}`,
        {
          level: 'warn',
        },
      )
    }

// 只有缓存读失败才回源，并且只在**真的回源**之后更新最后更新时间——从缓存读成功不算「更新」，否则时间戳会失去意义。
    // Cache doesn't exist or is invalid, fetch from source
    let marketplace: PluginMarketplace
    try {
      ;({ marketplace } = await loadAndCacheMarketplace(entry.source))
    } catch (error) {
      throw new Error(
        `Failed to load marketplace "${name}" from source (${entry.source.source}): ${errorMessage(error)}`,
      )
    }

    // Update lastUpdated only when we actually fetch
    config[name]!.lastUpdated = new Date().toISOString()
    await saveKnownMarketplacesConfig(config)

    return marketplace
  },
)

/**
 * Get plugin by ID from cache only (no network calls).
 * Returns null if marketplace cache is missing or corrupted.
 * Use this for startup paths that should never block on network.
 *
 * @param pluginId - The plugin ID in format "name@marketplace"
 * @returns The plugin entry or null if not found/cache missing
 */
// 按插件 ID 只读查插件：先解析出插件名与市场名，再取市场缓存，最后在清单的插件数组里按名字找。任何一环缺失都返回空，不抛错。
export async function getPluginByIdCacheOnly(pluginId: string): Promise<{
  entry: PluginMarketplaceEntry
  marketplaceInstallLocation: string
} | null> {
  const { name: pluginName, marketplace: marketplaceName } =
    parsePluginIdentifier(pluginId)
  if (!pluginName || !marketplaceName) {
    return null
  }

  const fs = getFsImplementation()
  const configFile = getKnownMarketplacesFile()

  try {
    const content = await fs.readFile(configFile, { encoding: 'utf-8' })
    const config = jsonParse(content) as KnownMarketplacesConfig
    const marketplaceConfig = config[marketplaceName]

    if (!marketplaceConfig) {
      return null
    }

    const marketplace = await getMarketplaceCacheOnly(marketplaceName)
    if (!marketplace) {
      return null
    }

    const plugin = marketplace.plugins.find(p => p.name === pluginName)
    if (!plugin) {
      return null
    }

    return {
      entry: plugin,
      marketplaceInstallLocation: marketplaceConfig.installLocation,
    }
  } catch {
    return null
  }
}

/**
 * Get plugin by ID from a specific marketplace
 *
 * First tries cache-only lookup. If cache is missing/corrupted,
 * falls back to fetching from source.
 *
 * @param pluginId - The plugin ID in format "name@marketplace"
 * @returns The plugin entry or null if not found
 */
// 先走只读快路径，缓存缺失才回源。回源路径里对市场用的是带记忆化的取法，所以同一进程内不会重复拉。
export async function getPluginById(pluginId: string): Promise<{
  entry: PluginMarketplaceEntry
  marketplaceInstallLocation: string
} | null> {
  // Try cache-only first (fast path)
  const cached = await getPluginByIdCacheOnly(pluginId)
  if (cached) {
    return cached
  }

  // Cache miss - try fetching from source
  const { name: pluginName, marketplace: marketplaceName } =
    parsePluginIdentifier(pluginId)
  if (!pluginName || !marketplaceName) {
    return null
  }

  try {
    const config = await loadKnownMarketplacesConfig()
    const marketplaceConfig = config[marketplaceName]
    if (!marketplaceConfig) {
      return null
    }

    const marketplace = await getMarketplace(marketplaceName)
    const plugin = marketplace.plugins.find(p => p.name === pluginName)

    if (!plugin) {
      return null
    }

    return {
      entry: plugin,
      marketplaceInstallLocation: marketplaceConfig.installLocation,
    }
  } catch (error) {
    logForDebugging(
      `Could not find plugin ${pluginId}: ${errorMessage(error)}`,
      { level: 'debug' },
    )
    return null
  }
}

/**
 * Refresh all marketplace caches
 *
 * Updates all configured marketplaces from their sources.
 * Continues refreshing even if some marketplaces fail.
 * Updates lastUpdated timestamps for successful refreshes.
 *
 * This is useful for:
 * - Periodic updates to get new plugins
 * - Syncing after network connectivity is restored
 * - Ensuring caches are up-to-date before browsing
 *
 * @returns Promise that resolves when all refresh attempts complete
 */
// 批量刷新所有市场。设计要求是「**某个失败不能影响其他**」——所以每个市场单独 try，失败只记日志，最后统一写一次配置。
export async function refreshAllMarketplaces(): Promise<void> {
  const config = await loadKnownMarketplacesConfig()

  for (const [name, entry] of Object.entries(config)) {
    // Seed-managed marketplaces are controlled by the seed image — refreshing
    // them is pointless (registerSeedMarketplaces overwrites on next startup).
// 批量刷新里的两类跳过：种子管理的市场（只读，刷新没意义，下次启动会被覆盖回种子）、settings 内联的市场（没有上游可拉，它的编辑靠对账器发现并重新落地）。
    if (seedDirFor(entry.installLocation)) {
      logForDebugging(
        `Skipping seed-managed marketplace '${name}' in bulk refresh`,
      )
      continue
    }
    // settings-sourced marketplaces have no upstream — see refreshMarketplace.
    if (entry.source.source === 'settings') {
      continue
    }
    // inc-5046: same GCS intercept as refreshMarketplace() — bulk update
    // hits this path on `claude plugin marketplace update` (no name arg).
// 官方市场优先从对象存储镜像取，而不是克隆 GitHub。这是按**名字**特判而不是新增一种源类型——历史配置里写的就是 github 源（镜像本身也是 GitHub 的镜像，说法没错），这样不需要任何数据迁移。镜像失败后是否退到 git 由开关控制，开关关掉就跳过。
    if (name === OFFICIAL_MARKETPLACE_NAME) {
      const sha = await fetchOfficialMarketplaceFromGcs(
        entry.installLocation,
        getMarketplacesCacheDir(),
      )
      if (sha !== null) {
        config[name]!.lastUpdated = new Date().toISOString()
        continue
      }
      if (
        !getFeatureValue_CACHED_MAY_BE_STALE(
          'tengu_plugin_official_mkt_git_fallback',
          true,
        )
      ) {
        logForDebugging(
          `Skipping official marketplace bulk refresh: GCS failed, git fallback disabled`,
        )
        continue
      }
      // fall through to git
    }
// 刷新成功要同时更新最后更新时间与安装位置——重克隆可能改变了目录（比如清单改名）。
    try {
      const { cachePath } = await loadAndCacheMarketplace(entry.source)
      config[name]!.lastUpdated = new Date().toISOString()
      config[name]!.installLocation = cachePath
    } catch (error) {
      logForDebugging(
        `Failed to refresh marketplace ${name}: ${errorMessage(error)}`,
        {
          level: 'error',
        },
      )
    }
  }

  await saveKnownMarketplacesConfig(config)
}

/**
 * Refresh a single marketplace cache
 *
 * Updates a specific marketplace from its source by doing an in-place update.
 * For git sources, runs git pull in the existing directory.
 * For URL sources, re-downloads to the existing file.
 * Clears the memoization cache and updates the lastUpdated timestamp.
 *
 * @param name - The name of the marketplace to refresh
 * @param onProgress - Optional callback to report progress
 * @throws If marketplace not found or refresh fails
 */
// 刷新单个市场：git 源原地 pull，url 源重新下载同一文件，本地源只校验文件还在且合法。
export async function refreshMarketplace(
  name: string,
  onProgress?: MarketplaceProgressCallback,
  options?: { disableCredentialHelper?: boolean },
): Promise<void> {
  const config = await loadKnownMarketplacesConfig()
  const entry = config[name]

  if (!entry) {
    throw new Error(
      `Marketplace '${name}' not found. Available marketplaces: ${Object.keys(config).join(', ')}`,
    )
  }

  // Clear the memoization cache for this specific marketplace
// 先清掉这个市场的记忆化缓存，否则刷新完读到的还是旧对象。
  getMarketplace.cache?.delete?.(name)

  // settings-sourced marketplaces have no upstream to pull. Edits to the
  // inline plugins array surface as sourceChanged in the reconciler, which
  // re-materializes via addMarketplaceSource — refresh is not the vehicle.
  if (entry.source.source === 'settings') {
    logForDebugging(
      `Skipping refresh for settings-sourced marketplace '${name}' — no upstream`,
    )
    return
  }

  try {
    // For updates, use the existing installLocation directly (in-place update)
    const installLocation = entry.installLocation
    const source = entry.source

    // Seed-managed marketplaces are controlled by the seed image. Refreshing
    // would be pointless — registerSeedMarketplaces() overwrites installLocation
    // back to seed on next startup. Error with guidance instead.
    const seedDir = seedDirFor(installLocation)
    if (seedDir) {
      throw new Error(
        `Marketplace '${name}' is seed-managed (${seedDir}) and its content is ` +
          `controlled by the seed image. To update: ask your admin to update the seed.`,
      )
    }

    // For remote sources (github/git/url), installLocation must be inside the
    // marketplaces cache dir. A corrupted value (gh-32793, gh-32661 — e.g.
    // Windows path read on WSL, literal tilde, manual edit) can point at the
    // user's project. cacheMarketplaceFromGit would then run git ops with that
    // cwd (git walks up to the user's .git) and fs.rm it on pull failure.
    // Refuse instead of auto-fixing so the user knows their state is corrupted.
// 远程源的安装位置必须落在缓存目录内。配置损坏时（跨平台路径写入、手工编辑）它可能指向用户项目目录，那样 git 操作会以用户项目为工作目录（git 会一路往上找 `.git`），pull 失败时还会把那个目录删掉。这里选择**拒绝执行**而不是自动修正——用户必须知道自己的状态已经损坏。
    if (!isLocalMarketplaceSource(source)) {
      const cacheDir = resolve(getMarketplacesCacheDir())
      const resolvedLoc = resolve(installLocation)
      if (resolvedLoc !== cacheDir && !resolvedLoc.startsWith(cacheDir + sep)) {
        throw new Error(
          `Marketplace '${name}' has a corrupted installLocation ` +
            `(${installLocation}) — expected a path inside ${cacheDir}. ` +
            `This can happen after cross-platform path writes or manual edits ` +
            `to known_marketplaces.json. ` +
            `Run: claude plugin marketplace remove "${name}" and re-add it.`,
        )
      }
    }

    // inc-5046: official marketplace fetches from a GCS mirror instead of
    // git-cloning GitHub. Special-cased by NAME (not a new source type) so
    // no data migration is needed — existing known_marketplaces.json entries
    // still say source:'github', which is true (GCS is a mirror).
// 官方市场的镜像特例。成功就用镜像的提交号更新配置直接返回。
    if (name === OFFICIAL_MARKETPLACE_NAME) {
      const sha = await fetchOfficialMarketplaceFromGcs(
        installLocation,
        getMarketplacesCacheDir(),
      )
      if (sha !== null) {
        config[name] = { ...entry, lastUpdated: new Date().toISOString() }
        await saveKnownMarketplacesConfig(config)
        return
      }
      // GCS failed — fall through to git ONLY if the kill-switch allows.
      // Default true (backend write perms are pending as of inc-5046); flip
      // to false via GrowthBook once the backend is confirmed live so new
      // clients NEVER hit GitHub for the official marketplace.
// 开关关掉时必须**抛错而不是返回**：这个函数其他所有失败路径都抛错，调用方（交互式管理界面）是按「没抛错就计数加一」来统计的，静默返回会显示「已更新 1 个市场」可实际什么都没刷。
      if (
        !getFeatureValue_CACHED_MAY_BE_STALE(
          'tengu_plugin_official_mkt_git_fallback',
          true,
        )
      ) {
        // Throw, don't return — every other failure path in this function
        // throws, and callers like ManageMarketplaces.tsx:259 increment
        // updatedCount on any non-throwing return. A silent return would
        // report "Updated 1 marketplace" when nothing was refreshed.
        throw new Error(
          'Official marketplace GCS fetch failed and git fallback is disabled',
        )
      }
      logForDebugging('Official marketplace GCS failed; falling back to git', {
        level: 'warn',
      })
      // ...falls through to source.source === 'github' branch below
    }

    // Update based on source type
// github 源原地 pull 也要选协议。注释点出一个细节：pull 成功时用的是仓库自己 `.git/config` 里的远端地址，只有**需要重克隆**时才需要外部给的 URL，所以协议要在进函数前就选好，并且失败能换另一个。
    if (source.source === 'github' || source.source === 'git') {
      // Git sources: do in-place git pull
      if (source.source === 'github') {
        // Same SSH/HTTPS fallback as loadAndCacheMarketplace: if the pull
        // succeeds the remote URL in .git/config is used, but a re-clone
        // needs a URL — pick the right protocol up-front and fall back.
        const sshUrl = `git@github.com:${source.repo}.git`
        const httpsUrl = `https://github.com/${source.repo}.git`

// 远程容器环境永远用 HTTPS——那里没有 SSH 密钥。
        if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
          // CCR: always HTTPS (no SSH keys available)
          await cacheMarketplaceFromGit(
            httpsUrl,
            installLocation,
            source.ref,
            source.sparsePaths,
            onProgress,
            options,
          )
        } else {
          const sshConfigured = await isGitHubSshLikelyConfigured()
          const primaryUrl = sshConfigured ? sshUrl : httpsUrl
          const fallbackUrl = sshConfigured ? httpsUrl : sshUrl

          try {
            await cacheMarketplaceFromGit(
              primaryUrl,
              installLocation,
              source.ref,
              source.sparsePaths,
              onProgress,
              options,
            )
          } catch {
            logForDebugging(
              `Marketplace refresh failed with ${sshConfigured ? 'SSH' : 'HTTPS'} for ${source.repo}, falling back to ${sshConfigured ? 'HTTPS' : 'SSH'}`,
              { level: 'info' },
            )
            await cacheMarketplaceFromGit(
              fallbackUrl,
              installLocation,
              source.ref,
              source.sparsePaths,
              onProgress,
              options,
            )
          }
        }
      } else {
        // Explicit git URL: use as-is (no fallback available)
        await cacheMarketplaceFromGit(
          source.url,
          installLocation,
          source.ref,
          source.sparsePaths,
          onProgress,
          options,
        )
      }
      // Validate that marketplace.json still exists after update
      // The repo may have been restructured or deprecated
// 更新后必须确认清单还在。仓库可能被重构或废弃，此时给出明确原因：官方旧名已被新名取代，或者这个市场可能已迁移。
      try {
        await readCachedMarketplace(installLocation)
      } catch {
        const sourceDisplay =
          source.source === 'github'
            ? source.repo
            : redactUrlCredentials(source.url)
        const reason =
          name === 'claude-code-plugins'
            ? `We've deprecated "claude-code-plugins" in favor of "claude-plugins-official".`
            : `This marketplace may have been deprecated or moved to a new location.`
        throw new Error(
          `The marketplace.json file is no longer present in this repository.\n\n` +
            `${reason}\n` +
            `Source: ${sourceDisplay}\n\n` +
            `You can remove this marketplace with: claude plugin marketplace remove "${name}"`,
        )
      }
// url 源直接覆盖同一文件重新下载。
    } else if (source.source === 'url') {
      // URL sources: re-download to existing file
      await cacheMarketplaceFromUrl(
        source.url,
        installLocation,
        source.headers,
        onProgress,
      )
// 本地源没有上游可拉，只能校验文件还在且合法——但这一步仍有价值，它能提前发现用户删掉了文件。
    } else if (isLocalMarketplaceSource(source)) {
      // Local sources: no remote to update from, but validate the file still exists and is valid
      safeCallProgress(onProgress, 'Validating local marketplace')
      // Read and validate to ensure the marketplace file is still valid
      await readCachedMarketplace(installLocation)
    } else {
      throw new Error(`Unsupported marketplace source type for refresh`)
    }

    // Update lastUpdated timestamp
    config[name]!.lastUpdated = new Date().toISOString()
    await saveKnownMarketplacesConfig(config)

    logForDebugging(`Successfully refreshed marketplace: ${name}`)
// 统一包装错误：日志里留原始信息（便于排查），抛给用户的带市场名（便于定位是哪个）。
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logForDebugging(`Failed to refresh marketplace ${name}: ${errorMessage}`, {
      level: 'error',
    })
    throw new Error(`Failed to refresh marketplace '${name}': ${errorMessage}`)
  }
}

/**
 * Set the autoUpdate flag for a marketplace
 *
 * When autoUpdate is enabled, the marketplace and its installed plugins
 * will be automatically updated on startup.
 *
 * @param name - The name of the marketplace to update
 * @param autoUpdate - Whether to enable auto-update
 * @throws If marketplace not found
 */
// 设置自动更新开关。
export async function setMarketplaceAutoUpdate(
  name: string,
  autoUpdate: boolean,
): Promise<void> {
  const config = await loadKnownMarketplacesConfig()
  const entry = config[name]

  if (!entry) {
    throw new Error(
      `Marketplace '${name}' not found. Available marketplaces: ${Object.keys(config).join(', ')}`,
    )
  }

  // Seed-managed marketplaces always have autoUpdate: false (read-only, git-pull
  // would fail). Toggle appears to work but registerSeedMarketplaces overwrites
  // it on next startup. Error with guidance instead of silent revert.
  const seedDir = seedDirFor(entry.installLocation)
  if (seedDir) {
    throw new Error(
      `Marketplace '${name}' is seed-managed (${seedDir}) and ` +
        `auto-update is always disabled for seed content. ` +
        `To update: ask your admin to update the seed.`,
    )
  }

  // Only update if the value is actually changing
// 值没变就不写盘——避免无意义的文件写入，也避免把配置文件的时间戳搅乱。
  if (entry.autoUpdate === autoUpdate) {
    return
  }

  config[name] = {
    ...entry,
    autoUpdate,
  }
  await saveKnownMarketplacesConfig(config)

// 状态层写完后，如果这个市场也在 settings 里声明过，还要同步更新意图层——并且必须写到**声明它的那个源**，写到别处会在错误的层级造出重复条目。
  // Also update intent in settings if declared there — write to the SAME
  // source that declared it to avoid creating duplicates at wrong scope
  const declaringSource = getMarketplaceDeclaringSource(name)
  if (declaringSource) {
    const declared =
      getSettingsForSource(declaringSource)?.extraKnownMarketplaces?.[name]
    if (declared) {
      saveMarketplaceToSettings(
        name,
        { source: declared.source, autoUpdate },
        declaringSource,
      )
    }
  }

  logForDebugging(`Set autoUpdate=${autoUpdate} for marketplace: ${name}`)
}

// 只为测试导出的内部函数集合。凭证脱敏逻辑最容易出错又最关键，单独暴露出来便于写单元测试。
export const _test = {
  redactUrlCredentials,
}
