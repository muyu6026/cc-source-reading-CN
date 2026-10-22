/**
 * Remote Managed Settings Service
 *
 * Manages fetching, caching, and validation of remote-managed settings
 * for enterprise customers. Uses checksum-based validation to minimize
 * network traffic and provides graceful degradation on failures.
 *
 * Eligibility:
 * - Console users (API key): All eligible
 * - OAuth users (Claude.ai): Only Enterprise/C4E and Team subscribers are eligible
 * - API fails open (non-blocking) - if fetch fails, continues without remote settings
 * - API returns empty settings for users without managed settings
 */

// 文件头四句话定调：
// 1) 服务对象是企业客户——Console 用户（API key）全部 eligible；OAuth 用户只有 Enterprise/C4E 和 Team eligible；
// 2) **fail open**：拉取失败就当成没有远程设置继续跑，绝不阻塞启动。整个文件所有 catch 分支都在实践这条；
// 3) 没有托管设置的用户，API 返回空而不是报错；
// 4) 用 checksum 做 HTTP 缓存验证，把网络流量压到最低。
import axios from 'axios'
import { createHash } from 'crypto'
import { open, unlink } from 'fs/promises'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { classifyAxiosError, getErrnoCode } from '../../utils/errors.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import {
  type SettingsJson,
  SettingsSchema,
} from '../../utils/settings/types.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { getRetryDelay } from '../api/withRetry.js'
import {
  checkManagedSettingsSecurity,
  handleSecurityCheckResult,
} from './securityCheck.jsx'
import { isRemoteManagedSettingsEligible, resetSyncCache } from './syncCache.js'
import {
  getRemoteManagedSettingsSyncFromCache,
  getSettingsPath,
  setSessionCache,
} from './syncCacheState.js'
import {
  type RemoteManagedSettingsFetchResult,
  RemoteManagedSettingsResponseSchema,
} from './types.js'

// Constants
const SETTINGS_TIMEOUT_MS = 10000 // 10 seconds for settings fetch
const DEFAULT_MAX_RETRIES = 5
const POLLING_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
// 三个常量：10 秒拉取超时（设置拉取挡启动路，不能长）、5 次重试、1 小时后台轮询。
// 轮询 1 小时是为了让管理员改的设置在一小时内生效——不用重登。

// Background polling state
let pollingIntervalId: ReturnType<typeof setInterval> | null = null

// Promise that resolves when initial remote settings loading completes
// This allows other systems to wait for remote settings before initializing
let loadingCompletePromise: Promise<void> | null = null
let loadingCompleteResolve: (() => void) | null = null

// Timeout for the loading promise to prevent deadlocks if loadRemoteManagedSettings() is never called
// (e.g., in Agent SDK tests that don't go through main.tsx)
const LOADING_PROMISE_TIMEOUT_MS = 30000 // 30 seconds
// loading promise 的 30 秒兜底超时。为什么需要：loadRemoteManagedSettings() 在 main.tsx 路径里一定会被调用，
// 但 Agent SDK 测试等场景不走 main.tsx——没有它，await 这个 promise 的系统会永久挂起。
// 30 秒是「正常拉取（含重试）最坏耗时」之上留的余量。

/**
 * Initialize the loading promise for remote managed settings
 * This should be called early (e.g., in init.ts) to allow other systems
 * to await remote settings loading even if loadRemoteManagedSettings()
 * hasn't been called yet.
 *
 * Only creates the promise if the user is eligible for remote settings.
 * Includes a timeout to prevent deadlocks if loadRemoteManagedSettings() is never called.
 */
export function initializeRemoteManagedSettingsLoadingPromise(): void {
  if (loadingCompletePromise) {
    return
  }

  if (isRemoteManagedSettingsEligible()) {
    loadingCompletePromise = new Promise(resolve => {
      loadingCompleteResolve = resolve

      // Set a timeout to resolve the promise even if loadRemoteManagedSettings() is never called
      // This prevents deadlocks in Agent SDK tests and other non-CLI contexts
      setTimeout(() => {
        if (loadingCompleteResolve) {
          logForDebugging(
            'Remote settings: Loading promise timed out, resolving anyway',
          )
          loadingCompleteResolve()
          loadingCompleteResolve = null
        }
      }, LOADING_PROMISE_TIMEOUT_MS)
    })
  }
}
// initializeRemoteManagedSettingsLoadingPromise 在 init.ts 早期调用，让别的系统能在 loadRemoteManagedSettings()
// 还没跑时就先 await 上。只有 eligible 用户才建 promise——不 eligible 的系统本来也不该等。
// 注意 promise 构造器里那个 setTimeout：它保证即使 load 永远不来，等待方最多等 30 秒。

/**
 * Get the remote settings API endpoint
 * Uses the OAuth config base API URL
 */
function getRemoteManagedSettingsEndpoint() {
  return `${getOauthConfig().BASE_API_URL}/api/claude_code/settings`
}
// 端点拼在 OAuth config 的 BASE_API_URL 后面——跟着登录环境（生产/ staging）走，不写死。

/**
 * Recursively sort all keys in an object to match Python's json.dumps(sort_keys=True)
 */
function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysDeep)
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep((obj as Record<string, unknown>)[key])
    }
    return sorted
  }
  return obj
}
// sortKeysDeep 存在的唯一理由：服务端用 Python 的 json.dumps(sort_keys=True) 算校验和。
// JS 对象键序不保证，不递归排序的话同一份设置每次 stringify 出的字节序可能不同，checksum 就会漂。
// 数组元素顺序不动（服务端也不动）。

/**
 * Compute checksum from settings content for HTTP caching
 * Must match server's Python: json.dumps(settings, sort_keys=True, separators=(",", ":"))
 * Exported for testing to verify compatibility with server-side implementation
 */
export function computeChecksumFromSettings(settings: SettingsJson): string {
  const sorted = sortKeysDeep(settings)
  // No spaces after separators to match Python's separators=(",", ":")
  const normalized = jsonStringify(sorted)
  const hash = createHash('sha256').update(normalized).digest('hex')
  return `sha256:${hash}`
}
// checksum 必须和服务端逐字节一致：json.dumps(settings, sort_keys=True, separators=(",", ":"))——
// 注意分隔符后无空格（jsonStringify 默认就是这样，但这是硬约束，写进注释防手滑）。
// 格式是 sha256: 前缀 + hex。导出成公开函数就是为了让测试能验证和服务端的兼容性。

/**
 * Check if the current user is eligible for remote managed settings
 * This is the public API for other systems to check eligibility
 * Used to determine if they should wait for remote settings to load
 */
export function isEligibleForRemoteManagedSettings(): boolean {
  return isRemoteManagedSettingsEligible()
}

/**
 * Wait for the initial remote settings loading to complete
 * Returns immediately if:
 * - User is not eligible for remote settings
 * - Loading has already completed
 * - Loading was never started
 */
export async function waitForRemoteManagedSettingsToLoad(): Promise<void> {
  if (loadingCompletePromise) {
    await loadingCompletePromise
  }
}
// waitForRemoteManagedSettingsToLoad 是给「启动时要读设置的系统」用的闸门：
// 不 eligible / 已加载完 / 从未启动加载，三种情况都立即返回，不会挂。

/**
 * Get auth headers for remote settings without calling getSettings()
 * This avoids circular dependencies during settings loading
 * Supports both API key and OAuth authentication
 */
function getRemoteSettingsAuthHeaders(): {
  headers: Record<string, string>
  error?: string
} {
  // Try API key first (for Console users)
  // Skip apiKeyHelper to avoid circular dependency with getSettings()
  // Wrap in try-catch because getAnthropicApiKeyWithSource throws in CI/test environments
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return {
        headers: {
          'x-api-key': apiKey,
        },
      }
    }
  } catch {
    // No API key available - continue to check OAuth
  }

  // Fall back to OAuth tokens (for Claude.ai users)
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
    error: 'No authentication available',
  }
}
// 取 auth 头有三处刻意的设计：
// 1) **先 API key 后 OAuth**——Console 用户走 key，Claude.ai 用户回退 Bearer；
// 2) skipRetrievingKeyFromApiKeyHelper：apiKeyHelper 会调用户自己的脚本，而那个脚本可能要读 settings——
//    在设置加载链路里触发它就是循环依赖，所以这里明确跳过；
// 3) try-catch 包住 key 获取：CI/测试环境没有 key 时 getAnthropicApiKeyWithSource 会抛，
//    但这里抛出不应该是致命错误，继续试 OAuth 就行。
// 拿不到任何凭据时不抛异常，返回 error 字段让调用方决定（调用方会标 skipRetry）。

/**
 * Fetch remote settings with retry logic and exponential backoff
 * Uses existing codebase retry utilities for consistency
 */
async function fetchWithRetry(
  cachedChecksum?: string,
): Promise<RemoteManagedSettingsFetchResult> {
  let lastResult: RemoteManagedSettingsFetchResult | null = null

  for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES + 1; attempt++) {
    lastResult = await fetchRemoteManagedSettings(cachedChecksum)

    // Return immediately on success
    if (lastResult.success) {
      return lastResult
    }

    // Don't retry if the error is not retryable (e.g., auth errors)
    if (lastResult.skipRetry) {
      return lastResult
    }

    // If we've exhausted retries, return the last error
    if (attempt > DEFAULT_MAX_RETRIES) {
      return lastResult
    }

    // Calculate delay and wait before next retry
    const delayMs = getRetryDelay(attempt)
    logForDebugging(
      `Remote settings: Retry ${attempt}/${DEFAULT_MAX_RETRIES} after ${delayMs}ms`,
    )
    await sleep(delayMs)
  }

  // Should never reach here, but TypeScript needs it
  return lastResult!
}
// fetchWithRetry 的结构：attempt 从 1 到 6（DEFAULT_MAX_RETRIES=5 次重试 + 首次共 6 次尝试）。
// 两条提前退出：成功立即返回；skipRetry（auth 类错误）不重试——key 没权限，重试 6 次只是浪费时间。
// 退避用 getRetryDelay(attempt)，和 api/withRetry.ts 同一套，保证全项目重试节奏一致。
// 最后的 return lastResult! 逻辑上不可达（循环里每个分支都 return 了），是 TS 穷尽性检查的通行税。

/**
 * Fetch the full remote settings (single attempt, no retries)
 * Optionally pass a cached checksum for ETag-based caching
 */
async function fetchRemoteManagedSettings(
  cachedChecksum?: string,
): Promise<RemoteManagedSettingsFetchResult> {
  try {
    // Ensure OAuth token is fresh before fetching settings
    // This prevents 401 errors from stale cached tokens
    await checkAndRefreshOAuthTokenIfNeeded()

    // Use local auth header getter to avoid circular dependency with getSettings()
    const authHeaders = getRemoteSettingsAuthHeaders()
    if (authHeaders.error) {
      // Auth errors should not be retried - return a special flag to skip retries
      return {
        success: false,
        error: `Authentication required for remote settings`,
        skipRetry: true,
      }
    }

    const endpoint = getRemoteManagedSettingsEndpoint()
    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'User-Agent': getClaudeCodeUserAgent(),
    }

    // Add If-None-Match header for ETag-based caching
    if (cachedChecksum) {
      headers['If-None-Match'] = `"${cachedChecksum}"`
    }

    const response = await axios.get(endpoint, {
      headers,
      timeout: SETTINGS_TIMEOUT_MS,
      // Allow 204, 304, and 404 responses without treating them as errors.
      // 204/404 are returned when no settings exist for the user or the feature flag is off.
      validateStatus: status =>
        status === 200 || status === 204 || status === 304 || status === 404,
    })

    // Handle 304 Not Modified - cached version is still valid
    if (response.status === 304) {
      logForDebugging('Remote settings: Using cached settings (304)')
      return {
        success: true,
        settings: null, // Signal that cache is valid
        checksum: cachedChecksum,
      }
    }
// 304 Not Modified 的处理：settings 返回 null 当作「缓存仍有效」的信号（不是「没有设置」）。
// 调用方靠 null 和非 null 区分这两件事——这个约定写在 types.ts 的 RemoteManagedSettingsFetchResult 注释里。

    // Handle 204 No Content / 404 Not Found - no settings exist or feature flag is off.
    // Return empty object (not null) so callers don't fall back to cached settings.
    if (response.status === 204 || response.status === 404) {
      logForDebugging(`Remote settings: No settings found (${response.status})`)
      return {
        success: true,
        settings: {},
        checksum: undefined,
      }
    }
// 204/404 返回空对象 {} 而不是 null，这是个容易搞反的点：返回 null 会让调用方以为「该用缓存」，
// 而 204/404 的真实语义是「服务端确认没有设置」——此时应该清掉本地旧缓存，而不是继续用它。
// 用 {} 把「无设置」和「缓存有效」区分开。

    const parsed = RemoteManagedSettingsResponseSchema().safeParse(
      response.data,
    )
    if (!parsed.success) {
      logForDebugging(
        `Remote settings: Invalid response format - ${parsed.error.message}`,
      )
      return {
        success: false,
        error: 'Invalid remote settings format',
      }
    }
// 第一层 Zod 校验：响应信封（uuid + checksum + settings）。用的是 types.ts 里那个宽松的 record schema——
// 那里解释了为什么不用 SettingsSchema（循环依赖）。

    // Full validation of settings structure
    const settingsValidation = SettingsSchema().safeParse(parsed.data.settings)
    if (!settingsValidation.success) {
      logForDebugging(
        `Remote settings: Settings validation failed - ${settingsValidation.error.message}`,
      )
      return {
        success: false,
        error: 'Invalid settings structure',
      }
    }
// 第二层校验：信封通过了不算完，settings 本体还要过完整的 SettingsSchema。
// 两层分开是有意的——信封 schema 必须宽松（避免循环依赖），严格校验留到能安全 import SettingsSchema 的这里做。

    logForDebugging('Remote settings: Fetched successfully')
    return {
      success: true,
      settings: settingsValidation.data,
      checksum: parsed.data.checksum,
    }
  } catch (error) {
    const { kind, status, message } = classifyAxiosError(error)
    if (status === 404) {
      // 404 means no remote settings configured
      return { success: true, settings: {}, checksum: '' }
    }
    switch (kind) {
      case 'auth':
        // Auth errors (401, 403) should not be retried - the API key doesn't have access
        return {
          success: false,
          error: 'Not authorized for remote settings',
          skipRetry: true,
        }
      case 'timeout':
        return { success: false, error: 'Remote settings request timeout' }
      case 'network':
        return { success: false, error: 'Cannot connect to server' }
      default:
        return { success: false, error: message }
    }
  }
// catch 里的错误分类：
// - status 404 → 当成 success + 空设置（「没有配置」不是错误）；
// - auth（401/403）→ 带 skipRetry，重试无意义；
// - timeout / network → 可重试的瞬时故障；
// - default → 原样带出 message。
// classifyAxiosError 把 axios 的异常归一成 kind/status/message 三件套，避免到处手撕 error.response?.status。
}

/**
 * Save remote settings to file
 * Stores raw settings JSON (checksum is computed on-demand when needed)
 */
async function saveSettings(settings: SettingsJson): Promise<void> {
  try {
    const path = getSettingsPath()
    const handle = await open(path, 'w', 0o600)
    try {
      await handle.writeFile(jsonStringify(settings, null, 2), {
        encoding: 'utf-8',
      })
      await handle.datasync()
    } finally {
      await handle.close()
    }
    logForDebugging(`Remote settings: Saved to ${path}`)
  } catch (error) {
    logForDebugging(
      `Remote settings: Failed to save - ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    // Ignore save errors - we'll refetch on next startup
  }
}
// saveSettings 三个细节：
// 1) 0o600 打开——远程设置可能含敏感策略（权限、环境变量），不给同机其他用户读；
// 2) datasync() 强制落盘再返回——设置是启动路径上的数据，不能停在 OS 缓冲区里；
// 3) 写失败只 log 不抛：磁盘写不进去不影响本次运行，下次启动会重新拉。

/**
 * Clear all remote settings (session, persistent, and stop polling)
 */
export async function clearRemoteManagedSettingsCache(): Promise<void> {
  // Stop background polling
  stopBackgroundPolling()

  // Clear session cache
  resetSyncCache()

  // Clear loading promise state
  loadingCompletePromise = null
  loadingCompleteResolve = null

  try {
    const path = getSettingsPath()
    await unlink(path)
  } catch {
    // Ignore errors when clearing file (ENOENT is expected)
  }
}
// clearRemoteManagedSettingsCache 清四样：停轮询、清 session 缓存、清 loading promise 状态、删磁盘文件。
// unlink 的 ENOENT 是预期内（文件本来就不存在），吞掉。
// 登录/登出时 refreshRemoteManagedSettings 会先调它——不清干净的话前一个账号的远程设置会漏给下一个账号。

/**
 * Fetch and load remote settings with file caching
 * Internal function that handles the full load/fetch logic
 * Fails open - returns null if fetch fails and no cache exists
 */
async function fetchAndLoadRemoteManagedSettings(): Promise<SettingsJson | null> {
  if (!isRemoteManagedSettingsEligible()) {
    return null
  }

  // Load cached settings from file
  const cachedSettings = getRemoteManagedSettingsSyncFromCache()

  // Compute checksum locally from cached settings for HTTP caching validation
  const cachedChecksum = cachedSettings
    ? computeChecksumFromSettings(cachedSettings)
    : undefined
// 读文件缓存，并在本地重算它的 checksum——不信任磁盘上存的任何 checksum 字段，现算现用。
// 这个本地 checksum 就是下面 If-None-Match 的值：服务器说 304 就等于确认「你缓存的和服务器上的一致」。

  try {
    // Fetch settings from API with retry logic
    const result = await fetchWithRetry(cachedChecksum)

    if (!result.success) {
      // On fetch failure, use stale file if available (graceful degradation)
      if (cachedSettings) {
        logForDebugging(
          'Remote settings: Using stale cache after fetch failure',
        )
        setSessionCache(cachedSettings)
        return cachedSettings
      }
      // No cache available - fail open, continue without remote settings
      return null
    }
// fetch 失败时的降级链：有磁盘缓存 → 用 stale 缓存继续（graceful degradation）；
// 没有缓存 → fail open 返回 null，当没有远程设置。
// 「用过期的设置」比「起不来」好——这是文件头 fail open 原则的落地。

    // Handle 304 Not Modified - cached settings are still valid
    if (result.settings === null && cachedSettings) {
      logForDebugging('Remote settings: Cache still valid (304 Not Modified)')
      setSessionCache(cachedSettings)
      return cachedSettings
    }

    // Save new settings to file (only if non-empty)
    const newSettings = result.settings || {}
    const hasContent = Object.keys(newSettings).length > 0

    if (hasContent) {
      // Check for dangerous settings changes before applying
      const securityResult = await checkManagedSettingsSecurity(
        cachedSettings,
        newSettings,
      )
      if (!handleSecurityCheckResult(securityResult)) {
        // User rejected - don't apply settings, return cached or null
        logForDebugging(
          'Remote settings: User rejected new settings, using cached settings',
        )
        return cachedSettings
      }

      setSessionCache(newSettings)
      await saveSettings(newSettings)
      logForDebugging('Remote settings: Applied new settings successfully')
      return newSettings
    }
// 新设置应用前的最后一道人工闸门：checkManagedSettingsSecurity（securityCheck.tsx）。
// 用户拒绝就用回缓存的旧设置——远程推送的危险设置不会静默生效。
// 通过才 setSessionCache + saveSettings 双写（内存 + 磁盘）。

    // Empty settings (404 response) - delete cached file if it exists
    // This ensures stale settings don't persist when a user's remote settings are removed
    setSessionCache(newSettings)
    try {
      const path = getSettingsPath()
      await unlink(path)
      logForDebugging('Remote settings: Deleted cached file (404 response)')
    } catch (e) {
      const code = getErrnoCode(e)
      if (code !== 'ENOENT') {
        logForDebugging(
          `Remote settings: Failed to delete cached file - ${e instanceof Error ? e.message : 'unknown error'}`,
        )
      }
    }
    return newSettings
  } catch {
    // On any error, use stale file if available (graceful degradation)
    if (cachedSettings) {
      logForDebugging('Remote settings: Using stale cache after error')
      setSessionCache(cachedSettings)
      return cachedSettings
    }

    // No cache available - fail open, continue without remote settings
    return null
  }
}
// 空设置（服务端 404）的分支：setSessionCache({}) 之后删掉磁盘缓存文件。
// 这一步是防「用户远程设置被管理员撤掉后，本地 stale 文件永远生效」——
// 只清内存不清磁盘的话，下次启动又会把旧设置读回来。ENOENT 之外的错误才 log。

/**
 * Load remote settings during CLI initialization
 * Fails open - if fetch fails, continues without remote settings
 * Also starts background polling to pick up settings changes mid-session
 *
 * This function sets up a promise that other systems can await via
 * waitForRemoteManagedSettingsToLoad() to ensure they don't initialize
 * until remote settings have been fetched.
 */
export async function loadRemoteManagedSettings(): Promise<void> {
  // Set up the promise for other systems to wait on
  // Only if the user is eligible for remote settings AND promise not already set up
  // (initializeRemoteManagedSettingsLoadingPromise may have been called earlier)
  if (isRemoteManagedSettingsEligible() && !loadingCompletePromise) {
    loadingCompletePromise = new Promise(resolve => {
      loadingCompleteResolve = resolve
    })
  }

  // Cache-first: if we have cached settings on disk, apply them and unblock
  // waiters immediately. The fetch still runs below; notifyChange fires once,
  // after the fetch, as before. Saves the ~77ms fetch-wait on print-mode startup.
  // getRemoteManagedSettingsSyncFromCache has the eligibility guard and populates
  // the session cache internally — no need to call setSessionCache here.
  if (getRemoteManagedSettingsSyncFromCache() && loadingCompleteResolve) {
    loadingCompleteResolve()
    loadingCompleteResolve = null
  }

  try {
    const settings = await fetchAndLoadRemoteManagedSettings()

    // Start background polling to pick up settings changes mid-session
    if (isRemoteManagedSettingsEligible()) {
      startBackgroundPolling()
    }

    // Trigger hot-reload if settings were loaded (new or from cache).
    // notifyChange resets the settings cache internally before iterating
    // listeners — env vars, telemetry, and permissions update on next read.
    if (settings !== null) {
      settingsChangeDetector.notifyChange('policySettings')
    }
  } finally {
    // Always resolve the promise, even if fetch failed (fail-open)
    if (loadingCompleteResolve) {
      loadingCompleteResolve()
      loadingCompleteResolve = null
    }
  }
}
// loadRemoteManagedSettings 是 CLI 初始化入口，两个设计点：
// 1) **cache-first**：磁盘有缓存就立即 apply 并 resolve loading promise，让等待方（print 模式启动路径）
//    马上解阻塞——省掉约 77ms 的 fetch 等待。fetch 仍然继续跑，notifyChange 也仍然在 fetch 后发一次，
//    所以「先放行再更新」不会丢变更通知；
// 2) finally 里无条件 resolve：哪怕 fetch 抛异常，等待方也必须被放行（fail open）。

/**
 * Refresh remote settings asynchronously (for auth state changes)
 * This is used when login/logout occurs
 * Fails open - if fetch fails, continues without remote settings
 */
export async function refreshRemoteManagedSettings(): Promise<void> {
  // Clear caches first
  await clearRemoteManagedSettingsCache()

  // If not enabled, notify that policy settings changed (to empty)
  if (!isRemoteManagedSettingsEligible()) {
    settingsChangeDetector.notifyChange('policySettings')
    return
  }

  // Try to load new settings (fails open if fetch fails)
  await fetchAndLoadRemoteManagedSettings()
  logForDebugging('Remote settings: Refreshed after auth change')

  // Notify listeners. notifyChange resets the settings cache internally;
  // this triggers hot-reload (AppState update, env var application, etc.)
  settingsChangeDetector.notifyChange('policySettings')
}
// refreshRemoteManagedSettings 用于登录/登出导致的身份变化：先清缓存（防止上一个身份的设置残留），
// 再重新拉。注意不 eligible 时也发一次 notifyChange('policySettings')——
// 告诉监听方「策略设置现在变成空了」，否则已加载的旧设置不会从各消费点撤掉。

/**
 * Background polling callback - fetches settings and triggers hot-reload if changed
 */
async function pollRemoteSettings(): Promise<void> {
  if (!isRemoteManagedSettingsEligible()) {
    return
  }

  // Get current cached settings for comparison
  const prevCache = getRemoteManagedSettingsSyncFromCache()
  const previousSettings = prevCache ? jsonStringify(prevCache) : null

  try {
    await fetchAndLoadRemoteManagedSettings()

    // Check if settings actually changed
    const newCache = getRemoteManagedSettingsSyncFromCache()
    const newSettings = newCache ? jsonStringify(newCache) : null
    if (newSettings !== previousSettings) {
      logForDebugging('Remote settings: Changed during background poll')
      settingsChangeDetector.notifyChange('policySettings')
    }
  } catch {
    // Don't fail closed for background polling - just continue
  }
}
// pollRemoteSettings 的变更检测：拉取前后各 jsonStringify 一次缓存做字符串对比，
// 只有真变了才 notifyChange。避免了「每小时无脑触发全设置重载」的浪费。
// catch 里什么都不做——后台轮询失败不该以任何方式影响前台。

/**
 * Start background polling for remote settings
 * Polls every hour to pick up settings changes mid-session
 */
export function startBackgroundPolling(): void {
  if (pollingIntervalId !== null) {
    return
  }

  if (!isRemoteManagedSettingsEligible()) {
    return
  }

  pollingIntervalId = setInterval(() => {
    void pollRemoteSettings()
  }, POLLING_INTERVAL_MS)
  pollingIntervalId.unref()

  // Register cleanup to stop polling on shutdown
  registerCleanup(async () => stopBackgroundPolling())
}
// startBackgroundPolling 三个细节：
// 1) pollingIntervalId 非 null 早退——重复调用不会叠加多个定时器（load 和 auth 变化都可能触发它）；
// 2) unref()——这个定时器不挡进程退出，用户 Ctrl-C 不用等它；
// 3) registerCleanup 停机时清——和 gracefulShutdown 管线对接。

/**
 * Stop background polling for remote settings
 */
export function stopBackgroundPolling(): void {
  if (pollingIntervalId !== null) {
    clearInterval(pollingIntervalId)
    pollingIntervalId = null
  }
}
// stopBackgroundPolling 是 start 的逆操作，clearInterval 后把 id 置回 null（置回 null 才能再次 start）。
