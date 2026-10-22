/**
 * Settings Sync Service
 *
 * Syncs user settings and memory files across Claude Code environments.
 *
 * - Interactive CLI: Uploads local settings to remote (incremental, only changed entries)
 * - CCR: Downloads remote settings to local before plugin installation
 *
 * Backend API: anthropic/anthropic#218817
 */
// 模块定位：把用户设置与记忆文件同步到云端、再在别的环境拉回来。两条路径分工明确——交互式 CLI 只负责「上传」（增量，只推变化条目）；CCR（容器/远程运行模式）只负责「下载」，且时机卡在装插件之前。后端契约见 anthropic/anthropic#218817。

import { feature } from 'bun:bundle'
import axios from 'axios'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import pickBy from 'lodash-es/pickBy.js'
import { dirname } from 'path'
import { getIsInteractive } from '../../bootstrap/state.js'
import {
  CLAUDE_AI_INFERENCE_SCOPE,
  getOauthConfig,
  OAUTH_BETA_HEADER,
} from '../../constants/oauth.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { clearMemoryFileCaches } from '../../utils/claudemd.js'
import { getMemoryPath } from '../../utils/config.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { classifyAxiosError } from '../../utils/errors.js'
import { getRepoRemoteHash } from '../../utils/git.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'
import { markInternalWrite } from '../../utils/settings/internalWrites.js'
import { getSettingsFilePathForSource } from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { sleep } from '../../utils/sleep.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import { getRetryDelay } from '../api/withRetry.js'
import {
  type SettingsSyncFetchResult,
  type SettingsSyncUploadResult,
  SYNC_KEYS,
  UserSyncDataSchema,
} from './types.js'

const SETTINGS_SYNC_TIMEOUT_MS = 10000 // 10 seconds
const DEFAULT_MAX_RETRIES = 3
const MAX_FILE_SIZE_BYTES = 500 * 1024 // 500 KB per file (matches backend limit)
// 三个全局常量：单次请求 10 秒超时；默认 3 次重试；单文件 500KB 上限——注释明说与后端限制一致，客户端先拦一道，省一次注定被拒的请求。

/**
 * Upload local settings to remote (interactive CLI only).
 * Called from main.tsx preAction.
 * Runs in background - caller should not await unless needed.
 */
export async function uploadUserSettingsInBackground(): Promise<void> {
  try {
    if (
      !feature('UPLOAD_USER_SETTINGS') ||
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_enable_settings_sync_push',
        false,
      ) ||
      !getIsInteractive() ||
      !isUsingOAuth()
    ) {
      logForDiagnosticsNoPII('info', 'settings_sync_upload_skipped')
      logEvent('tengu_settings_sync_upload_skipped_ineligible', {})
      return
    }
// 上传入口 uploadUserSettingsInBackground 的四重门槛，全部满足才继续：bundle 特性开关 UPLOAD_USER_SETTINGS、GrowthBook 开关 tengu_enable_settings_sync_push、交互模式（getIsInteractive，headless 不上传）、OAuth 登录。任一不过只记一条 settings_sync_upload_skipped_ineligible 遥测就走——上传是纯后台增强，缺任何条件都安静退出。

    logForDiagnosticsNoPII('info', 'settings_sync_upload_starting')
    const result = await fetchUserSettings()
    if (!result.success) {
      logForDiagnosticsNoPII('warn', 'settings_sync_upload_fetch_failed')
      logEvent('tengu_settings_sync_upload_fetch_failed', {})
      return
    }

    const projectId = await getRepoRemoteHash()
    const localEntries = await buildEntriesFromLocalFiles(projectId)
    const remoteEntries = result.isEmpty ? {} : result.data!.content.entries
    const changedEntries = pickBy(
      localEntries,
      (value, key) => remoteEntries[key] !== value,
    )

    const entryCount = Object.keys(changedEntries).length
    if (entryCount === 0) {
      logForDiagnosticsNoPII('info', 'settings_sync_upload_no_changes')
      logEvent('tengu_settings_sync_upload_skipped', {})
      return
    }

    const uploadResult = await uploadUserSettings(changedEntries)
    if (uploadResult.success) {
      logForDiagnosticsNoPII('info', 'settings_sync_upload_success')
      logEvent('tengu_settings_sync_upload_success', { entryCount })
    } else {
      logForDiagnosticsNoPII('warn', 'settings_sync_upload_failed')
      logEvent('tengu_settings_sync_upload_failed', { entryCount })
    }
  } catch {
    // Fail-open: log unexpected errors but don't block startup
    logForDiagnosticsNoPII('error', 'settings_sync_unexpected_error')
  }
}
// 整个上传流程的形状：先 GET 远端全量 → 本地四项文件构建 entries → pickBy 按 key 差量 → 只 PUT 变化的条目。最外层 catch 是 fail-open：任何意外只记 settings_sync_unexpected_error，绝不阻塞启动——同步是赠品，不是门票。

// Cached so the fire-and-forget at runHeadless entry and the await in
// installPluginsAndApplyMcpInBackground share one fetch.
let downloadPromise: Promise<boolean> | null = null

/** Test-only: clear the cached download promise between tests. */
export function _resetDownloadPromiseForTesting(): void {
  downloadPromise = null
}
// downloadPromise 是模块级单例：runHeadless 入口的 fire-and-forget 与 installPluginsAndApplyMcpInBackground 里的 await 共用同一次 fetch，不会因为两个调用方发两遍请求。_resetDownloadPromiseForTesting 仅供测试在用例间清零。

/**
 * Download settings from remote for CCR mode.
 * Fired fire-and-forget at the top of print.ts runHeadless(); awaited in
 * installPluginsAndApplyMcpInBackground before plugin install. First call
 * starts the fetch; subsequent calls join it.
 * Returns true if settings were applied, false otherwise.
 */
export function downloadUserSettings(): Promise<boolean> {
  if (downloadPromise) {
    return downloadPromise
  }
  downloadPromise = doDownloadUserSettings()
  return downloadPromise
}
// downloadUserSettings 的「首调发起、后续 join」语义：第一次调用才真正创建 doDownloadUserSettings() 的 promise，之后的调用直接拿到同一个——后到的调用方自动挂在最先那次请求上。

/**
 * Force a fresh download, bypassing the cached startup promise.
 * Called by /reload-plugins in CCR so mid-session settings changes
 * (enabledPlugins, extraKnownMarketplaces) pushed from the user's local
 * CLI are picked up before the plugin-cache sweep.
 *
 * No retries: user-initiated command, one attempt + fail-open. The user
 * can re-run /reload-plugins to retry. Startup path keeps DEFAULT_MAX_RETRIES.
 *
 * Caller is responsible for firing settingsChangeDetector.notifyChange
 * when this returns true — applyRemoteEntriesToLocal uses markInternalWrite
 * to suppress detection (correct for startup, but mid-session needs
 * applySettingsChange to run). Kept out of this module to avoid the
 * settingsSync → changeDetector cycle edge.
 */
export function redownloadUserSettings(): Promise<boolean> {
  downloadPromise = doDownloadUserSettings(0)
  return downloadPromise
}
// redownloadUserSettings 是 /reload-plugins 专用的强制刷新通道：绕过启动缓存重新下载，且故意零重试——用户主动敲的命令，一次尝试 + fail-open，不满意可以自己再敲一遍；启动路径则保留 DEFAULT_MAX_RETRIES。注释里那段循环依赖的说明很关键：applyRemoteEntriesToLocal 内部用 markInternalWrite 抑制变更检测（启动时正确，会话中期却需要 applySettingsChange 真正跑起来），所以 notifyChange 的责任留给调用方，本模块不引 changeDetector——正是为了掐断 settingsSync → changeDetector 的循环边。

async function doDownloadUserSettings(
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<boolean> {
  if (feature('DOWNLOAD_USER_SETTINGS')) {
    try {
      if (
        !getFeatureValue_CACHED_MAY_BE_STALE('tengu_strap_foyer', false) ||
        !isUsingOAuth()
      ) {
        logForDiagnosticsNoPII('info', 'settings_sync_download_skipped')
        logEvent('tengu_settings_sync_download_skipped', {})
        return false
      }

      logForDiagnosticsNoPII('info', 'settings_sync_download_starting')
      const result = await fetchUserSettings(maxRetries)
      if (!result.success) {
        logForDiagnosticsNoPII('warn', 'settings_sync_download_fetch_failed')
        logEvent('tengu_settings_sync_download_fetch_failed', {})
        return false
      }

      if (result.isEmpty) {
        logForDiagnosticsNoPII('info', 'settings_sync_download_empty')
        logEvent('tengu_settings_sync_download_empty', {})
        return false
      }

      const entries = result.data!.content.entries
      const projectId = await getRepoRemoteHash()
      const entryCount = Object.keys(entries).length
      logForDiagnosticsNoPII('info', 'settings_sync_download_applying', {
        entryCount,
      })
      await applyRemoteEntriesToLocal(entries, projectId)
      logEvent('tengu_settings_sync_download_success', { entryCount })
      return true
    } catch {
      // Fail-open: log error but don't block CCR startup
      logForDiagnosticsNoPII('error', 'settings_sync_download_error')
      logEvent('tengu_settings_sync_download_error', {})
      return false
    }
  }
  return false
}
// doDownloadUserSettings 的三关：bundle 特性 DOWNLOAD_USER_SETTINGS、GrowthBook 开关 tengu_strap_foyer、OAuth。远端为空（isEmpty）时直接返回 false——本地没有就是没有，不制造空文件。同样整体 fail-open：CCR 启动不能被同步拖死。

/**
 * Check if user is authenticated with first-party OAuth.
 * Required for settings sync in both CLI (upload) and CCR (download) modes.
 *
 * Only checks user:inference (not user:profile) — CCR's file-descriptor token
 * hardcodes scopes to ['user:inference'] only, so requiring profile would make
 * download a no-op there. Upload is independently guarded by getIsInteractive().
 */
function isUsingOAuth(): boolean {
  if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) {
    return false
  }

  const tokens = getClaudeAIOAuthTokens()
  return Boolean(
    tokens?.accessToken && tokens.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE),
  )
}
// isUsingOAuth 的判定链：API provider 是 firstParty、base URL 是第一方 Anthropic、且 token scopes 含 user:inference。注释解释了为什么只查 inference 不查 profile——CCR 的文件描述符 token 把 scope 硬编码成 ['user:inference']，若要求 profile，CCR 的下载会直接变成 no-op。上传路径另由 getIsInteractive 独立把关。

function getSettingsSyncEndpoint(): string {
  return `${getOauthConfig().BASE_API_URL}/api/claude_code/user_settings`
}
// 同步端点从 OAuth 配置里取 BASE_API_URL 拼 /api/claude_code/user_settings——不写死域名，跟随账号配置（企业代理/官方直连由 oauth config 决定）。

function getSettingsSyncAuthHeaders(): {
  headers: Record<string, string>
  error?: string
} {
  const oauthTokens = getClaudeAIOAuthTokens()
  if (oauthTokens?.accessToken) {
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    }
  }

  return {
    headers: {},
    error: 'No OAuth token available',
  }
}
// getSettingsSyncAuthHeaders：有 token 时给 Authorization Bearer + anthropic-beta 头；无 token 时不抛异常，而是返回 error 字符串，由 fetchUserSettingsOnce 转成 skipRetry: true——认证缺失重试无意义，第一次就退出。

async function fetchUserSettingsOnce(): Promise<SettingsSyncFetchResult> {
  try {
    await checkAndRefreshOAuthTokenIfNeeded()

    const authHeaders = getSettingsSyncAuthHeaders()
    if (authHeaders.error) {
      return {
        success: false,
        error: authHeaders.error,
        skipRetry: true,
      }
    }

    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'User-Agent': getClaudeCodeUserAgent(),
    }

    const endpoint = getSettingsSyncEndpoint()
    const response = await axios.get(endpoint, {
      headers,
      timeout: SETTINGS_SYNC_TIMEOUT_MS,
      validateStatus: status => status === 200 || status === 404,
    })

    // 404 means no settings exist yet
    if (response.status === 404) {
      logForDiagnosticsNoPII('info', 'settings_sync_fetch_empty')
      return {
        success: true,
        isEmpty: true,
      }
    }
// 404 的语义：远端还没有这份数据 → success: true + isEmpty: true。注意与 remoteManagedSettings/syncCache 的区别——那里 settings:null 配合 ETag 算「有效的 304 未变」，这里是「压根不存在」，两种空值驱动完全不同的后续动作。

    const parsed = UserSyncDataSchema().safeParse(response.data)
    if (!parsed.success) {
      logForDiagnosticsNoPII('warn', 'settings_sync_fetch_invalid_format')
      return {
        success: false,
        error: 'Invalid settings sync response format',
      }
    }
// 200 响应用 UserSyncDataSchema().safeParse 做运行时校验，格式不符记为 settings_sync_fetch_invalid_format 返回失败——后端合同变更时客户端静默降级，而不是把脏数据写进本地文件。

    logForDiagnosticsNoPII('info', 'settings_sync_fetch_success')
    return {
      success: true,
      data: parsed.data,
      isEmpty: false,
    }
  } catch (error) {
    const { kind, message } = classifyAxiosError(error)
    switch (kind) {
      case 'auth':
        return {
          success: false,
          error: 'Not authorized for settings sync',
          skipRetry: true,
        }
      case 'timeout':
        return { success: false, error: 'Settings sync request timeout' }
      case 'network':
        return { success: false, error: 'Cannot connect to server' }
      default:
        return { success: false, error: message }
    }
  }
// classifyAxiosError 的三路分诊：auth → skipRetry（重试救不了登录态）；timeout / network → 可重试的瞬时故障；其余带原始 message 上报。错误分类决定重试策略，而不是无脑退避。
}

async function fetchUserSettings(
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<SettingsSyncFetchResult> {
  let lastResult: SettingsSyncFetchResult | null = null

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    lastResult = await fetchUserSettingsOnce()

    if (lastResult.success) {
      return lastResult
    }

    if (lastResult.skipRetry) {
      return lastResult
    }

    if (attempt > maxRetries) {
      return lastResult
    }

    const delayMs = getRetryDelay(attempt)
    logForDiagnosticsNoPII('info', 'settings_sync_retry', {
      attempt,
      maxRetries,
      delayMs,
    })
    await sleep(delayMs)
  }

  return lastResult!
}
// fetchUserSettings 的重试外循环：最多 maxRetries + 1 次尝试；skipRetry 的结果直接短路返回；退避时长走 getRetryDelay（与 api/withRetry 同一套指数退避，两个模块不各写一套）。

async function uploadUserSettings(
  entries: Record<string, string>,
): Promise<SettingsSyncUploadResult> {
  try {
    await checkAndRefreshOAuthTokenIfNeeded()

    const authHeaders = getSettingsSyncAuthHeaders()
    if (authHeaders.error) {
      return {
        success: false,
        error: authHeaders.error,
      }
    }

    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'User-Agent': getClaudeCodeUserAgent(),
      'Content-Type': 'application/json',
    }

    const endpoint = getSettingsSyncEndpoint()
    const response = await axios.put(
      endpoint,
      { entries },
      {
        headers,
        timeout: SETTINGS_SYNC_TIMEOUT_MS,
      },
    )

    logForDiagnosticsNoPII('info', 'settings_sync_uploaded', {
      entryCount: Object.keys(entries).length,
    })
    return {
      success: true,
      checksum: response.data?.checksum,
      lastModified: response.data?.lastModified,
    }
  } catch (error) {
    logForDiagnosticsNoPII('warn', 'settings_sync_upload_error')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
// uploadUserSettings：一次 PUT 带上整个 entries 对象，回传服务端新算的 checksum 和 lastModified——下次上传的差量比较以服务端版本为准，本地时钟不准不影响。

/**
 * Try to read a file for sync, with size limit and error handling.
 * Returns null if file doesn't exist, is empty, or exceeds size limit.
 */
async function tryReadFileForSync(filePath: string): Promise<string | null> {
  try {
    const stats = await stat(filePath)
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      logForDiagnosticsNoPII('info', 'settings_sync_file_too_large')
      return null
    }

    const content = await readFile(filePath, 'utf8')
    // Check for empty/whitespace-only without allocating a trimmed copy
    if (!content || /^\s*$/.test(content)) {
      return null
    }

    return content
  } catch {
    return null
  }
}
// tryReadFileForSync 的两道过滤：先 stat 看大小超 500KB 直接放弃；读出来后用 /^\s*$/ 正则判空白——注释特意说明不分配 trim 副本，纯文本判空的正则写法。文件不存在也走 catch 返回 null，四种情况对调用方是同一个 null。

async function buildEntriesFromLocalFiles(
  projectId: string | null,
): Promise<Record<string, string>> {
  const entries: Record<string, string> = {}

  // Global user settings
  const userSettingsPath = getSettingsFilePathForSource('userSettings')
  if (userSettingsPath) {
    const content = await tryReadFileForSync(userSettingsPath)
    if (content) {
      entries[SYNC_KEYS.USER_SETTINGS] = content
    }
  }

  // Global user memory
  const userMemoryPath = getMemoryPath('User')
  const userMemoryContent = await tryReadFileForSync(userMemoryPath)
  if (userMemoryContent) {
    entries[SYNC_KEYS.USER_MEMORY] = userMemoryContent
  }

  // Project-specific files (only if we have a project ID from git remote)
  if (projectId) {
    // Project local settings
    const localSettingsPath = getSettingsFilePathForSource('localSettings')
    if (localSettingsPath) {
      const content = await tryReadFileForSync(localSettingsPath)
      if (content) {
        entries[SYNC_KEYS.projectSettings(projectId)] = content
      }
    }

    // Project local memory
    const localMemoryPath = getMemoryPath('Local')
    const localMemoryContent = await tryReadFileForSync(localMemoryPath)
    if (localMemoryContent) {
      entries[SYNC_KEYS.projectMemory(projectId)] = localMemoryContent
    }
  }

  return entries
}
// buildEntriesFromLocalFiles 收集的四个条目：全局 ~/.claude/settings.json、全局 CLAUDE.md（记忆）、项目级 settings.local.json、项目级 CLAUDE.local.md。项目级两项只在拿到 git remote 哈希（projectId）时才收——没有 git 远端的环境不同步项目文件，避免把本地路径身份泄露到云端。

async function writeFileForSync(
  filePath: string,
  content: string,
): Promise<boolean> {
  try {
    const parentDir = dirname(filePath)
    if (parentDir) {
      await mkdir(parentDir, { recursive: true })
    }

    await writeFile(filePath, content, 'utf8')
    logForDiagnosticsNoPII('info', 'settings_sync_file_written')
    return true
  } catch {
    logForDiagnosticsNoPII('warn', 'settings_sync_file_write_failed')
    return false
  }
}
// writeFileForSync：写前 mkdir -p 父目录（CCR 容器里 ~/.claude 可能还不存在），写完记一条 settings_sync_file_written；失败只 warn 返回 false，由调用方计数。

/**
 * Apply remote entries to local files (CCR pull pattern).
 * Only writes files that match expected keys.
 *
 * After writing, invalidates relevant caches:
 * - resetSettingsCache() for settings files
 * - clearMemoryFileCaches() for memory files (CLAUDE.md)
 */
async function applyRemoteEntriesToLocal(
  entries: Record<string, string>,
  projectId: string | null,
): Promise<void> {
  let appliedCount = 0
  let settingsWritten = false
  let memoryWritten = false

  // Helper to check size limit (defense-in-depth, matches backend limit)
  const exceedsSizeLimit = (content: string, _path: string): boolean => {
    const sizeBytes = Buffer.byteLength(content, 'utf8')
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      logForDiagnosticsNoPII('info', 'settings_sync_file_too_large', {
        sizeBytes,
        maxBytes: MAX_FILE_SIZE_BYTES,
      })
      return true
    }
    return false
  }

  // Apply global user settings
  const userSettingsContent = entries[SYNC_KEYS.USER_SETTINGS]
  if (userSettingsContent) {
    const userSettingsPath = getSettingsFilePathForSource('userSettings')
    if (
      userSettingsPath &&
      !exceedsSizeLimit(userSettingsContent, userSettingsPath)
    ) {
      // Mark as internal write to prevent spurious change detection
      markInternalWrite(userSettingsPath)
      if (await writeFileForSync(userSettingsPath, userSettingsContent)) {
        appliedCount++
        settingsWritten = true
      }
    }
  }

  // Apply global user memory
  const userMemoryContent = entries[SYNC_KEYS.USER_MEMORY]
  if (userMemoryContent) {
    const userMemoryPath = getMemoryPath('User')
    if (!exceedsSizeLimit(userMemoryContent, userMemoryPath)) {
      if (await writeFileForSync(userMemoryPath, userMemoryContent)) {
        appliedCount++
        memoryWritten = true
      }
    }
  }

  // Apply project-specific files (only if project ID matches)
  if (projectId) {
    const projectSettingsKey = SYNC_KEYS.projectSettings(projectId)
    const projectSettingsContent = entries[projectSettingsKey]
    if (projectSettingsContent) {
      const localSettingsPath = getSettingsFilePathForSource('localSettings')
      if (
        localSettingsPath &&
        !exceedsSizeLimit(projectSettingsContent, localSettingsPath)
      ) {
        // Mark as internal write to prevent spurious change detection
        markInternalWrite(localSettingsPath)
        if (await writeFileForSync(localSettingsPath, projectSettingsContent)) {
          appliedCount++
          settingsWritten = true
        }
      }
    }

    const projectMemoryKey = SYNC_KEYS.projectMemory(projectId)
    const projectMemoryContent = entries[projectMemoryKey]
    if (projectMemoryContent) {
      const localMemoryPath = getMemoryPath('Local')
      if (!exceedsSizeLimit(projectMemoryContent, localMemoryPath)) {
        if (await writeFileForSync(localMemoryPath, projectMemoryContent)) {
          appliedCount++
          memoryWritten = true
        }
      }
    }
  }

  // Invalidate caches so subsequent reads pick up new content
  if (settingsWritten) {
    resetSettingsCache()
  }
  if (memoryWritten) {
    clearMemoryFileCaches()
  }

  logForDiagnosticsNoPII('info', 'settings_sync_applied', {
    appliedCount,
  })
}
// applyRemoteEntriesToLocal 的三层设计：① 只写 SYNC_KEYS 白名单内的预期 key，响应里多出来的条目一律无视；② 写前 markInternalWrite 抑制变更检测（否则自己刚同步下来的文件会被当成用户改动，触发 reload 循环）；③ 写后按需 resetSettingsCache / clearMemoryFileCaches 失效缓存，让后续读取立刻看到新内容。大小检查是 defense-in-depth——上传侧已拦过，这里按后端上限再对一次。
