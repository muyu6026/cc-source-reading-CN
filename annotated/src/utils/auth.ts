import chalk from 'chalk'
import { exec } from 'child_process'
import { execa } from 'execa'
import { mkdir, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { CLAUDE_AI_PROFILE_SCOPE } from 'src/constants/oauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getModelStrings } from 'src/utils/model/modelStrings.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  getIsNonInteractiveSession,
  preferThirdPartyAuthentication,
} from '../bootstrap/state.js'
import {
  getMockSubscriptionType,
  shouldUseMockSubscription,
} from '../services/mockRateLimits.js'
import {
  isOAuthTokenExpired,
  refreshOAuthToken,
  shouldUseClaudeAIAuth,
} from '../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../services/oauth/getOauthProfile.js'
import type { OAuthTokens, SubscriptionType } from '../services/oauth/types.js'
import {
  getApiKeyFromFileDescriptor,
  getOAuthTokenFromFileDescriptor,
} from './authFileDescriptor.js'
import {
  maybeRemoveApiKeyFromMacOSKeychainThrows,
  normalizeApiKeyForConfig,
} from './authPortable.js'
import {
  checkStsCallerIdentity,
  clearAwsIniCache,
  isValidAwsStsOutput,
} from './aws.js'
import { AwsAuthStatusManager } from './awsAuthStatusManager.js'
import { clearBetasCaches } from './betas.js'
import {
  type AccountInfo,
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from './config.js'
import { logAntError, logForDebugging } from './debug.js'
import {
  getClaudeConfigHomeDir,
  isBareMode,
  isEnvTruthy,
  isRunningOnHomespace,
} from './envUtils.js'
import { errorMessage } from './errors.js'
import { execSyncWithDefaults_DEPRECATED } from './execFileNoThrow.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { memoizeWithTTLAsync } from './memoize.js'
import { getSecureStorage } from './secureStorage/index.js'
import {
  clearLegacyApiKeyPrefetch,
  getLegacyApiKeyPrefetchResult,
} from './secureStorage/keychainPrefetch.js'
import {
  clearKeychainCache,
  getMacOsKeychainStorageServiceName,
  getUsername,
} from './secureStorage/macOsKeychainHelpers.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'
import { sleep } from './sleep.js'
import { jsonParse } from './slowOperations.js'
import { clearToolSchemaCache } from './toolSchemaCache.js'

// apiKeyHelper 结果缓存默认五分钟。这个缓存很短，因为 helper 常用来取短期凭证（Vault、SSO 临时令牌之类），缓存太久会拿到过期的。
/** Default TTL for API key helper cache in milliseconds (5 minutes) */
const DEFAULT_API_KEY_HELPER_TTL = 5 * 60 * 1000

/**
 * CCR and Claude Desktop spawn the CLI with OAuth and should never fall back
 * to the user's ~/.claude/settings.json API-key config (apiKeyHelper,
 * env.ANTHROPIC_API_KEY, env.ANTHROPIC_AUTH_TOKEN). Those settings exist for
 * the user's terminal CLI, not managed sessions. Without this guard, a user
 * who runs `claude` in their terminal with an API key sees every CCD session
 * also use that key — and fail if it's stale/wrong-org.
 */
// 判断当前是否处于「托管 OAuth」上下文（远程容器或桌面端）。为什么要单独判断：这两种环境是**由平台带着 OAuth 身份**启动 CLI 的，绝不该回落到用户终端配置里的 API key（apiKeyHelper、环境变量里的 key 或 auth token）。那些配置是给用户自己终端的，不是给托管会话的。没有这道闸门，用户在终端里用 API key 跑过 claude，之后每个托管会话都会用那个 key，而且 key 一旦过期或属于别的组织就全线失败。
function isManagedOAuthContext(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
    process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
  )
}

/** Whether we are supporting direct 1P auth. */
// this code is closely related to getAuthTokenSource
// 是否启用第一方 Anthropic 认证。这是一道总闸，多个地方依赖它判断「该不该读 OAuth」。分支顺序本身就是一张优先级表：裸模式直接否；ssh 远程看占位令牌；第三方云服务否；有外部 key 或 token 且非托管上下文则否。
export function isAnthropicAuthEnabled(): boolean {
  // --bare: API-key-only, never OAuth.
  if (isBareMode()) return false

  // `claude ssh` remote: ANTHROPIC_UNIX_SOCKET tunnels API calls through a
  // local auth-injecting proxy. The launcher sets CLAUDE_CODE_OAUTH_TOKEN as a
  // placeholder iff the local side is a subscriber (so the remote includes the
  // oauth-2025 beta header to match what the proxy will inject). The remote's
  // ~/.claude settings (apiKeyHelper, settings.env.ANTHROPIC_API_KEY) MUST NOT
  // flip this — they'd cause a header mismatch with the proxy and a bogus
  // "invalid x-api-key" from the API. See src/ssh/sshAuthProxy.ts.
// `claude ssh` 远程场景：API 调用经本地代理隧道走，代理负责注入真凭证。启动器只在**本地是订阅用户**时才设置一个占位 OAuth 令牌，目的是让远端带上对应的 beta 头，与代理将要注入的身份保持一致。所以这里只看这个环境变量存不存在——远端的设置文件（apiKeyHelper、settings 里的 key）绝不能参与判断，否则请求头会与代理不匹配，API 报一个莫名其妙的 x-api-key 无效。
  if (process.env.ANTHROPIC_UNIX_SOCKET) {
    return !!process.env.CLAUDE_CODE_OAUTH_TOKEN
  }

  const is3P =
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)

  // Check if user has configured an external API key source
  // This allows externally-provided API keys to work (without requiring proxy configuration)
  const settings = getSettings_DEPRECATED() || {}
  const apiKeyHelper = settings.apiKeyHelper
  const hasExternalAuthToken =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    apiKeyHelper ||
    process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR

  // Check if API key is from an external source (not managed by /login)
  const { source: apiKeySource } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  const hasExternalApiKey =
    apiKeySource === 'ANTHROPIC_API_KEY' || apiKeySource === 'apiKeyHelper'

  // Disable Anthropic auth if:
  // 1. Using 3rd party services (Bedrock/Vertex/Foundry)
  // 2. User has an external API key (regardless of proxy configuration)
  // 3. User has an external auth token (regardless of proxy configuration)
  // this may cause issues if users have complex proxy / gateway "client-side creds" auth scenarios,
  // e.g. if they want to set X-Api-Key to a gateway key but use Anthropic OAuth for the Authorization
  // if we get reports of that, we should probably add an env var to force OAuth enablement
// 三种情况禁用第一方认证：用第三方云服务、有外部 auth token、有外部 API key。后两条都排除托管上下文——那正是上面那道闸门要处理的情形。
  const shouldDisableAuth =
    is3P ||
    (hasExternalAuthToken && !isManagedOAuthContext()) ||
    (hasExternalApiKey && !isManagedOAuthContext())

  return !shouldDisableAuth
}

/** Where the auth token is being sourced from, if any. */
// this code is closely related to isAnthropicAuthEnabled
// 返回凭证来源，只描述「从哪来」不返回凭证本身——用于展示与诊断，避免把密钥带到调用方。与上面的启用判断是配套的两面：一个决定「用不用 OAuth」，一个说明「实际用的是哪个源」。
export function getAuthTokenSource() {
  // --bare: API-key-only. apiKeyHelper (from --settings) is the only
  // bearer-token-shaped source allowed. OAuth env vars, FD tokens, and
  // keychain are ignored.
// 裸模式是密闭认证：只认 `--settings` 传进来的 apiKeyHelper，OAuth 环境变量、文件描述符令牌、钥匙串一律忽略。
  if (isBareMode()) {
    if (getConfiguredApiKeyHelper()) {
      return { source: 'apiKeyHelper' as const, hasToken: true }
    }
    return { source: 'none' as const, hasToken: false }
  }

  if (process.env.ANTHROPIC_AUTH_TOKEN && !isManagedOAuthContext()) {
    return { source: 'ANTHROPIC_AUTH_TOKEN' as const, hasToken: true }
  }

// OAuth 令牌环境变量优先级高于文件描述符——它是显式设置的，用户意图最强。
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { source: 'CLAUDE_CODE_OAUTH_TOKEN' as const, hasToken: true }
  }

  // Check for OAuth token from file descriptor (or its CCR disk fallback)
// 文件描述符令牌有个磁盘回退：远程容器里的子进程继承不到管道 fd，会把令牌落到磁盘上。两者要区分开，否则组织不匹配的错误信息会让用户去 unset 一个根本不存在的环境变量。
  const oauthTokenFromFd = getOAuthTokenFromFileDescriptor()
  if (oauthTokenFromFd) {
    // getOAuthTokenFromFileDescriptor has a disk fallback for CCR subprocesses
    // that can't inherit the pipe FD. Distinguish by env var presence so the
    // org-mismatch message doesn't tell the user to unset a variable that
    // doesn't exist. Call sites fall through correctly — the new source is
    // !== 'none' (cli/handlers/auth.ts → oauth_token) and not in the
    // isEnvVarToken set (auth.ts:1844 → generic re-login message).
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR) {
      return {
        source: 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR' as const,
        hasToken: true,
      }
    }
    return {
      source: 'CCR_OAUTH_TOKEN_FILE' as const,
      hasToken: true,
    }
  }

  // Check if apiKeyHelper is configured without executing it
  // This prevents security issues where arbitrary code could execute before trust is established
// 这里只**检查是否配置**了 apiKeyHelper，不去执行它。原因写在注释里：执行任意命令必须等用户确认工作区信任之后，否则打开一个目录就可能触发代码执行。真正取值的路径会做信任检查。
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (apiKeyHelper && !isManagedOAuthContext()) {
    return { source: 'apiKeyHelper' as const, hasToken: true }
  }

  const oauthTokens = getClaudeAIOAuthTokens()
  if (shouldUseClaudeAIAuth(oauthTokens?.scopes) && oauthTokens?.accessToken) {
    return { source: 'claude.ai' as const, hasToken: true }
  }

  return { source: 'none' as const, hasToken: false }
}

// API key 来源的四种取值。`/login managed key` 是登录流程存下来的（macOS 进钥匙串，其他平台进配置文件）。
export type ApiKeySource =
  | 'ANTHROPIC_API_KEY'
  | 'apiKeyHelper'
  | '/login managed key'
  | 'none'

// 取 key 的便捷包装，丢掉来源信息。需要区分来源的地方用下面那个带来源的版本。
export function getAnthropicApiKey(): null | string {
  const { key } = getAnthropicApiKeyWithSource()
  return key
}

export function hasAnthropicApiKeyAuth(): boolean {
  const { key, source } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  return key !== null && source !== 'none'
}

// 带来源的取 key 主函数。参数 `skipRetrievingKeyFromApiKeyHelper` 用于「只想判断有没有配置、不想执行命令」的场景——比如启动时探测认证能力。
export function getAnthropicApiKeyWithSource(
  opts: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): {
  key: null | string
  source: ApiKeySource
} {
  // --bare: hermetic auth. Only ANTHROPIC_API_KEY env or apiKeyHelper from
  // the --settings flag. Never touches keychain, config file, or approval
  // lists. 3P (Bedrock/Vertex/Foundry) uses provider creds, not this path.
// 裸模式：只用环境变量或 `--settings` 里的 helper，绝不碰钥匙串、配置文件、批准列表。
  if (isBareMode()) {
    if (process.env.ANTHROPIC_API_KEY) {
      return { key: process.env.ANTHROPIC_API_KEY, source: 'ANTHROPIC_API_KEY' }
    }
    if (getConfiguredApiKeyHelper()) {
      return {
        key: opts.skipRetrievingKeyFromApiKeyHelper
          ? null
          : getApiKeyFromApiKeyHelperCached(),
        source: 'apiKeyHelper',
      }
    }
    return { key: null, source: 'none' }
  }

  // On homespace, don't use ANTHROPIC_API_KEY (use Console key instead)
  // https://anthropic.slack.com/archives/C08428WSLKV/p1747331773214779
// 内部托管平台上忽略环境变量里的 key，改走 Console 密钥——那里预置的是 Console 身份，环境变量往往是误传。
  const apiKeyEnv = isRunningOnHomespace()
    ? undefined
    : process.env.ANTHROPIC_API_KEY

  // Always check for direct environment variable when the user ran claude --print.
  // This is useful for CI, etc.
  if (preferThirdPartyAuthentication() && apiKeyEnv) {
    return {
      key: apiKeyEnv,
      source: 'ANTHROPIC_API_KEY',
    }
  }

// CI 与测试环境走一条单独的严格路径：允许从文件描述符读 key，但两者都没有就**直接报错**，而不是悄悄返回空。CI 里静默无凭证会让整条流水线以一个难查的 401 结束，不如早点失败说清楚。
  if (isEnvTruthy(process.env.CI) || process.env.NODE_ENV === 'test') {
    // Check for API key from file descriptor first
    const apiKeyFromFd = getApiKeyFromFileDescriptor()
    if (apiKeyFromFd) {
      return {
        key: apiKeyFromFd,
        source: 'ANTHROPIC_API_KEY',
      }
    }

    if (
      !apiKeyEnv &&
      !process.env.CLAUDE_CODE_OAUTH_TOKEN &&
      !process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
    ) {
      throw new Error(
        'ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN env var is required',
      )
    }

    if (apiKeyEnv) {
      return {
        key: apiKeyEnv,
        source: 'ANTHROPIC_API_KEY',
      }
    }

    // OAuth token is present but this function returns API keys only
    return {
      key: null,
      source: 'none',
    }
  }
  // Check for ANTHROPIC_API_KEY before checking the apiKeyHelper or /login-managed key
// **安全闸门**：环境变量里的 key 只有在用户明确批准过之后才会被使用。批准记录存的是 key 的规范化哈希（不存明文），当目录里有陌生项目能注入环境变量时，这条记录能防止它悄悄把请求指向别处。
  if (
    apiKeyEnv &&
    getGlobalConfig().customApiKeyResponses?.approved?.includes(
      normalizeApiKeyForConfig(apiKeyEnv),
    )
  ) {
    return {
      key: apiKeyEnv,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  // Check for API key from file descriptor
  const apiKeyFromFd = getApiKeyFromFileDescriptor()
  if (apiKeyFromFd) {
    return {
      key: apiKeyFromFd,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  // Check for apiKeyHelper — use sync cache, never block
// apiKeyHelper 必须**优先于**钥匙串，而且即使缓存还是冷的也不能回落到钥匙串——回落会造成「同一个会话里两个身份交替」的混乱。缓存冷时返回空 key 但来源仍标为 apiKeyHelper，需要真 key 的调用方应先 await 取回。
  const apiKeyHelperCommand = getConfiguredApiKeyHelper()
  if (apiKeyHelperCommand) {
    if (opts.skipRetrievingKeyFromApiKeyHelper) {
      return {
        key: null,
        source: 'apiKeyHelper',
      }
    }
    // Cache may be cold (helper hasn't finished yet). Return null with
    // source='apiKeyHelper' rather than falling through to keychain —
    // apiKeyHelper must win. Callers needing a real key must await
    // getApiKeyFromApiKeyHelper() first (client.ts, useApiKeyVerification do).
    return {
      key: getApiKeyFromApiKeyHelperCached(),
      source: 'apiKeyHelper',
    }
  }

// 最后才是配置文件或 macOS 钥匙串里的登录密钥。
  const apiKeyFromConfigOrMacOSKeychain = getApiKeyFromConfigOrMacOSKeychain()
  if (apiKeyFromConfigOrMacOSKeychain) {
    return apiKeyFromConfigOrMacOSKeychain
  }

  return {
    key: null,
    source: 'none',
  }
}

/**
 * Get the configured apiKeyHelper from settings.
 * In bare mode, only the --settings flag source is consulted — apiKeyHelper
 * from ~/.claude/settings.json or project settings is ignored.
 */
// 读取配置的 apiKeyHelper。裸模式只看命令行传入的 settings 源，忽略用户级与项目级配置。
export function getConfiguredApiKeyHelper(): string | undefined {
  if (isBareMode()) {
    return getSettingsForSource('flagSettings')?.apiKeyHelper
  }
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.apiKeyHelper
}

/**
 * Check if the configured apiKeyHelper comes from project settings (projectSettings or localSettings)
 */
// 判断 helper 是否来自项目或本地级配置。这个判断是安全关键：只有来自**项目**配置的命令才需要工作区信任检查，因为那是别人仓库里带的；用户自己全局配置的命令属于用户自己的意图。
function isApiKeyHelperFromProjectOrLocalSettings(): boolean {
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (!apiKeyHelper) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.apiKeyHelper === apiKeyHelper ||
    localSettings?.apiKeyHelper === apiKeyHelper
  )
}

/**
 * Get the configured awsAuthRefresh from settings
 */
function getConfiguredAwsAuthRefresh(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.awsAuthRefresh
}

/**
 * Check if the configured awsAuthRefresh comes from project settings
 */
export function isAwsAuthRefreshFromProjectSettings(): boolean {
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()
  if (!awsAuthRefresh) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.awsAuthRefresh === awsAuthRefresh ||
    localSettings?.awsAuthRefresh === awsAuthRefresh
  )
}

/**
 * Get the configured awsCredentialExport from settings
 */
function getConfiguredAwsCredentialExport(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.awsCredentialExport
}

/**
 * Check if the configured awsCredentialExport comes from project settings
 */
export function isAwsCredentialExportFromProjectSettings(): boolean {
  const awsCredentialExport = getConfiguredAwsCredentialExport()
  if (!awsCredentialExport) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.awsCredentialExport === awsCredentialExport ||
    localSettings?.awsCredentialExport === awsCredentialExport
  )
}

/**
 * Calculate TTL in milliseconds for the API key helper cache
 * Uses CLAUDE_CODE_API_KEY_HELPER_TTL_MS env var if set and valid,
 * otherwise defaults to 5 minutes
 */
// helper 缓存 TTL：环境变量可覆盖，非法值记一条错误日志后回落默认——配置写错不该让认证整体崩掉。注意这里允许 0，表示「每次都重新执行」。
export function calculateApiKeyHelperTTL(): number {
  const envTtl = process.env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS

  if (envTtl) {
    const parsed = parseInt(envTtl, 10)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed
    }
    logForDebugging(
      `Found CLAUDE_CODE_API_KEY_HELPER_TTL_MS env var, but it was not a valid number. Got ${envTtl}`,
      { level: 'error' },
    )
  }

  return DEFAULT_API_KEY_HELPER_TTL
}

// Async API key helper with sync cache for non-blocking reads.
// Epoch bumps on clearApiKeyHelperCache() — orphaned executions check their
// captured epoch before touching module state so a settings-change or 401-retry
// mid-flight can't clobber the newer cache/inflight.
// 三个模块级状态。`epoch`（世代号）是关键设计：清缓存时递增，正在执行的旧任务在写回结果之前先比对自己捕获的世代号，不一致就丢弃——否则一次设置变更或 401 重试期间的旧结果会把新的缓存与在途任务覆盖掉。
let _apiKeyHelperCache: { value: string; timestamp: number } | null = null
let _apiKeyHelperInflight: {
  promise: Promise<string | null>
  // Only set on cold launches (user is waiting); null for SWR background refreshes.
  startedAt: number | null
} | null = null
let _apiKeyHelperEpoch = 0

// 报告 helper 已执行多久，用于 UI 显示「正在获取凭证」，只在冷启动（用户真的在等）时有值。
export function getApiKeyHelperElapsedMs(): number {
  const startedAt = _apiKeyHelperInflight?.startedAt
  return startedAt ? Date.now() - startedAt : 0
}

// 异步取 key，带同步缓存，读路径永不阻塞。这是 stale-while-revalidate 语义：有缓存且未过期就返回；已过期则**先返回旧值**并在后台刷新。冷缓存时去重并发调用。
export async function getApiKeyFromApiKeyHelper(
  isNonInteractiveSession: boolean,
): Promise<string | null> {
  if (!getConfiguredApiKeyHelper()) return null
  const ttl = calculateApiKeyHelperTTL()
// 过期的处理方式是先给旧值、后台刷新——比让 UI 卡住等一个新 key 体验好得多。这里注释提到一个 ESLint 规则禁用空值赋值运算符，因为运行时有个已知 bug。
  if (_apiKeyHelperCache) {
    if (Date.now() - _apiKeyHelperCache.timestamp < ttl) {
      return _apiKeyHelperCache.value
    }
    // Stale — return stale value now, refresh in the background.
    // `??=` banned here by eslint no-nullish-assign-object-call (bun bug).
    if (!_apiKeyHelperInflight) {
      _apiKeyHelperInflight = {
        promise: _runAndCache(
          isNonInteractiveSession,
          false,
          _apiKeyHelperEpoch,
        ),
        startedAt: null,
      }
    }
    return _apiKeyHelperCache.value
  }
// 冷缓存：并发调用共享同一个在途 Promise，避免同时起多个 helper 进程。`startedAt` 有值表示「用户在等」，刷新路径则置空。
  // Cold cache — deduplicate concurrent calls
  if (_apiKeyHelperInflight) return _apiKeyHelperInflight.promise
  _apiKeyHelperInflight = {
    promise: _runAndCache(isNonInteractiveSession, true, _apiKeyHelperEpoch),
    startedAt: Date.now(),
  }
  return _apiKeyHelperInflight.promise
}

// 真正执行并写缓存的内部函数。开头就捕获了世代号，之后每次写状态前都要比对。
async function _runAndCache(
  isNonInteractiveSession: boolean,
  isCold: boolean,
  epoch: number,
): Promise<string | null> {
  try {
    const value = await _executeApiKeyHelper(isNonInteractiveSession)
// 世代号不匹配就直接返回结果但不写缓存——这是一次已被作废的执行。
    if (epoch !== _apiKeyHelperEpoch) return value
    if (value !== null) {
      _apiKeyHelperCache = { value, timestamp: Date.now() }
    }
    return value
  } catch (e) {
    if (epoch !== _apiKeyHelperEpoch) return ' '
    const detail = e instanceof Error ? e.message : String(e)
    // biome-ignore lint/suspicious/noConsole: user-configured script failed; must be visible without --debug
    console.error(chalk.red(`apiKeyHelper failed: ${detail}`))
    logForDebugging(`Error getting API key from apiKeyHelper: ${detail}`, {
      level: 'error',
    })
    // SWR path: a transient failure shouldn't replace a working key with
    // the ' ' sentinel — keep serving the stale value and bump timestamp
    // so we don't hammer-retry every call.
// 后台刷新失败时**不要**用失败哨兵覆盖还能用的旧值：继续返回旧值，但把时间戳更新成现在，避免每次调用都立刻重试、把 helper 打成雪崩。
    if (!isCold && _apiKeyHelperCache && _apiKeyHelperCache.value !== ' ') {
      _apiKeyHelperCache = { ..._apiKeyHelperCache, timestamp: Date.now() }
      return _apiKeyHelperCache.value
    }
// 冷缓存或此前已失败，则缓存一个空格作为失败哨兵。为什么要哨兵而不是 null：null 会让调用方回落到 OAuth，而 apiKeyHelper 配置了就必须赢——失败也要明确失败，不能让身份悄悄切换。
    // Cold cache or prior error — cache ' ' so callers don't fall back to OAuth
    _apiKeyHelperCache = { value: ' ', timestamp: Date.now() }
    return ' '
  } finally {
    if (epoch === _apiKeyHelperEpoch) {
      _apiKeyHelperInflight = null
    }
  }
}

// 执行 helper 命令。
async function _executeApiKeyHelper(
  isNonInteractiveSession: boolean,
): Promise<string | null> {
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (!apiKeyHelper) {
    return null
  }

// **信任检查**：命令来自项目或本地配置、且用户还没确认工作区信任、且是交互式会话时，拒绝执行并上报埋点。非交互会话例外——那里没有对话框可确认，信任由外层（如 CI 配置）保证。
  if (isApiKeyHelperFromProjectOrLocalSettings()) {
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !isNonInteractiveSession) {
      const error = new Error(
        `Security: apiKeyHelper executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('apiKeyHelper invoked before trust check', error)
      logEvent('tengu_apiKeyHelper_missing_trust11', {})
      return null
    }
  }

// 用 shell 执行（helper 通常是带管道的复合命令），超时十分钟。`reject` 关掉，让非零退出码与超时以结果形式返回而不是抛异常，这样错误信息能把 stderr 一起带上。
  const result = await execa(apiKeyHelper, {
    shell: true,
    timeout: 10 * 60 * 1000,
    reject: false,
  })
// 把失败原因拼清楚：是超时还是退出码非零，并把 stderr 附上——helper 失败最常见的原因就是脚本里某个命令报错，不带 stderr 等于让人盲猜。
  if (result.failed) {
    // reject:false — execa resolves on exit≠0/timeout, stderr is on result
    const why = result.timedOut ? 'timed out' : `exited ${result.exitCode}`
    const stderr = result.stderr?.trim()
    throw new Error(stderr ? `${why}: ${stderr}` : why)
  }
  const stdout = result.stdout?.trim()
  if (!stdout) {
    throw new Error('did not return a value')
  }
  return stdout
}

/**
 * Sync cache reader — returns the last fetched apiKeyHelper value without executing.
 * Returns stale values to match SWR semantics of the async reader.
 * Returns null only if the async fetch hasn't completed yet.
 */
// 同步读缓存，绝不执行命令。返回过期值以与异步读的 stale-while-revalidate 语义保持一致；只有异步首次取值还没完成时才返回 null。
export function getApiKeyFromApiKeyHelperCached(): string | null {
  return _apiKeyHelperCache?.value ?? null
}

// 清缓存时先递增世代号，再清值——顺序很重要，先清值会让在途任务以为自己是有效的。
export function clearApiKeyHelperCache(): void {
  _apiKeyHelperEpoch++
  _apiKeyHelperCache = null
  _apiKeyHelperInflight = null
}

// 安全前提下的预取：如果 helper 来自项目配置且信任还没确认，就先不预取。虽然内层执行时也会拦，但这里提前返回可以避免发出一个虚假的「缺信任」埋点事件。
export function prefetchApiKeyFromApiKeyHelperIfSafe(
  isNonInteractiveSession: boolean,
): void {
  // Skip if trust not yet accepted — the inner _executeApiKeyHelper check
  // would catch this too, but would fire a false-positive analytics event.
  if (
    isApiKeyHelperFromProjectOrLocalSettings() &&
    !checkHasTrustDialogAccepted()
  ) {
    return
  }
  void getApiKeyFromApiKeyHelper(isNonInteractiveSession)
}

/** Default STS credentials are one hour. We manually manage invalidation, so not too worried about this being accurate. */
const DEFAULT_AWS_STS_TTL = 60 * 60 * 1000

/**
 * Run awsAuthRefresh to perform interactive authentication (e.g., aws sso login)
 * Streams output in real-time for user visibility
 */
// 跑 awsAuthRefresh（比如触发 SSO 登录）。同样的信任检查模式：项目配置的命令需要先确认工作区信任。
async function runAwsAuthRefresh(): Promise<boolean> {
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()

  if (!awsAuthRefresh) {
    return false // Not configured, treat as success
  }

  // SECURITY: Check if awsAuthRefresh is from project settings
  if (isAwsAuthRefreshFromProjectSettings()) {
    // Check if trust has been established for this project
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: awsAuthRefresh executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('awsAuthRefresh invoked before trust check', error)
      logEvent('tengu_awsAuthRefresh_missing_trust', {})
      return false
    }
  }

// 先探测一次 STS 调用者身份，**成功了就不跑刷新命令**——避免每次启动都弹出浏览器登录。只有探测失败（凭证过期或没有）才真正执行刷新。这是「按需刷新」的核心。
  try {
    logForDebugging('Fetching AWS caller identity for AWS auth refresh command')
    await checkStsCallerIdentity()
    logForDebugging(
      'Fetched AWS caller identity, skipping AWS auth refresh command',
    )
    return false
  } catch {
    // only actually do the refresh if caller-identity calls
    return refreshAwsAuth(awsAuthRefresh)
  }
}

// Timeout for AWS auth refresh command (3 minutes).
// Long enough for browser-based SSO flows, short enough to prevent indefinite hangs.
const AWS_AUTH_REFRESH_TIMEOUT_MS = 3 * 60 * 1000

// 真正执行刷新命令，用流式输出把进度实时推给 UI（SSO 登录需要用户看到「正在等待浏览器」之类的提示）。三分钟超时：够浏览器流程走完，又不至于无限挂住。
export function refreshAwsAuth(awsAuthRefresh: string): Promise<boolean> {
  logForDebugging('Running AWS auth refresh command')
  // Start tracking authentication status
  const authStatusManager = AwsAuthStatusManager.getInstance()
  authStatusManager.startAuthentication()

  return new Promise(resolve => {
    const refreshProc = exec(awsAuthRefresh, {
      timeout: AWS_AUTH_REFRESH_TIMEOUT_MS,
    })
    refreshProc.stdout!.on('data', data => {
      const output = data.toString().trim()
      if (output) {
        // Add output to status manager for UI display
        authStatusManager.addOutput(output)
        // Also log for debugging
        logForDebugging(output, { level: 'debug' })
      }
    })

    refreshProc.stderr!.on('data', data => {
      const error = data.toString().trim()
      if (error) {
        authStatusManager.setError(error)
        logForDebugging(error, { level: 'error' })
      }
    })

// 收尾：超时被杀时信号是 SIGTERM，据此给出「请手动在另一个终端执行」的提示，而不是笼统报错。
    refreshProc.on('close', (code, signal) => {
      if (code === 0) {
        logForDebugging('AWS auth refresh completed successfully')
        authStatusManager.endAuthentication(true)
        void resolve(true)
      } else {
        const timedOut = signal === 'SIGTERM'
        const message = timedOut
          ? chalk.red(
              'AWS auth refresh timed out after 3 minutes. Run your auth command manually in a separate terminal.',
            )
          : chalk.red(
              'Error running awsAuthRefresh (in settings or ~/.claude.json):',
            )
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(message)
        authStatusManager.endAuthentication(false)
        void resolve(false)
      }
    })
  })
}

/**
 * Run awsCredentialExport to get credentials and set environment variables
 * Expects JSON output containing AWS credentials
 */
// 跑 awsCredentialExport 拿凭证。与刷新相同的先探测逻辑：身份已有效就不跑导出命令。
async function getAwsCredsFromCredentialExport(): Promise<{
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
} | null> {
  const awsCredentialExport = getConfiguredAwsCredentialExport()

  if (!awsCredentialExport) {
    return null
  }

  // SECURITY: Check if awsCredentialExport is from project settings
  if (isAwsCredentialExportFromProjectSettings()) {
    // Check if trust has been established for this project
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: awsCredentialExport executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('awsCredentialExport invoked before trust check', error)
      logEvent('tengu_awsCredentialExport_missing_trust', {})
      return null
    }
  }

// 先探身份，成功则跳过导出。
  try {
    logForDebugging(
      'Fetching AWS caller identity for credential export command',
    )
    await checkStsCallerIdentity()
    logForDebugging(
      'Fetched AWS caller identity, skipping AWS credential export command',
    )
    return null
  } catch {
    // only actually do the export if caller-identity calls
    try {
      logForDebugging('Running AWS credential export command')
      const result = await execa(awsCredentialExport, {
        shell: true,
        reject: false,
      })
      if (result.exitCode !== 0 || !result.stdout) {
        throw new Error('awsCredentialExport did not return a valid value')
      }

      // Parse the JSON output from aws sts commands
// 解析导出命令的 JSON 输出，并用专门的校验函数确认结构符合 AWS STS 的返回形状——不能只信 JSON 能解析，字段名不对会在很久之后才炸。
      const awsOutput = jsonParse(result.stdout.trim())

      if (!isValidAwsStsOutput(awsOutput)) {
        throw new Error(
          'awsCredentialExport did not return valid AWS STS output structure',
        )
      }

      logForDebugging('AWS credentials retrieved from awsCredentialExport')
      return {
        accessKeyId: awsOutput.Credentials.AccessKeyId,
        secretAccessKey: awsOutput.Credentials.SecretAccessKey,
        sessionToken: awsOutput.Credentials.SessionToken,
      }
    } catch (e) {
      const message = chalk.red(
        'Error getting AWS credentials from awsCredentialExport (in settings or ~/.claude.json):',
      )
      if (e instanceof Error) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(message, e.message)
      } else {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(message, e)
      }
      return null
    }
  }
}

/**
 * Refresh AWS authentication and get credentials with cache clearing
 * This combines runAwsAuthRefresh, getAwsCredsFromCredentialExport, and clearAwsIniCache
 * to ensure fresh credentials are always used
 */
// 刷新加导出合成一个带 TTL 的记忆化函数：一次调用内先刷新（如果需要）、再导出、最后清 AWS ini 缓存确保后续读到的是新凭证。注意清理条件——只要做过刷新**或**拿到了凭证就要清，两者任一都意味着底层状态可能变了。
export const refreshAndGetAwsCredentials = memoizeWithTTLAsync(
  async (): Promise<{
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
  } | null> => {
    // First run auth refresh if needed
    const refreshed = await runAwsAuthRefresh()

    // Get credentials from export
    const credentials = await getAwsCredsFromCredentialExport()

    // Clear AWS INI cache to ensure fresh credentials are used
    if (refreshed || credentials) {
      await clearAwsIniCache()
    }

    return credentials
  },
  DEFAULT_AWS_STS_TTL,
)

export function clearAwsCredentialsCache(): void {
  refreshAndGetAwsCredentials.cache.clear()
}

/**
 * Get the configured gcpAuthRefresh from settings
 */
// GCP 版的三件套与 AWS 完全对称：配置读取、来源判断、刷新、导出、记忆化。
function getConfiguredGcpAuthRefresh(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.gcpAuthRefresh
}

/**
 * Check if the configured gcpAuthRefresh comes from project settings
 */
export function isGcpAuthRefreshFromProjectSettings(): boolean {
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()
  if (!gcpAuthRefresh) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.gcpAuthRefresh === gcpAuthRefresh ||
    localSettings?.gcpAuthRefresh === gcpAuthRefresh
  )
}

// GCP 凭证探测的短超时（5 秒）。必要性写在注释里：本地没有任何凭证源时，认证库会去问 GCE 元数据服务器，在非 GCP 环境里这个请求要挂约 12 秒。没有这个超时，每个启动都会白等十几秒。
/** Short timeout for the GCP credentials probe. Without this, when no local
 *  credential source exists (no ADC file, no env var), google-auth-library falls
 *  through to the GCE metadata server which hangs ~12s outside GCP. */
const GCP_CREDENTIALS_CHECK_TIMEOUT_MS = 5_000

/**
 * Check if GCP credentials are currently valid by attempting to get an access token.
 * This uses the same authentication chain that the Vertex SDK uses.
 */
// 探测 GCP 凭证是否可用：走与 Vertex SDK 完全相同的认证链（动态 import 认证库，避免不用 GCP 的用户也加载它），取一次访问令牌来验证。
export async function checkGcpCredentialsValid(): Promise<boolean> {
  try {
    // Dynamically import to avoid loading google-auth-library unnecessarily
    const { GoogleAuth } = await import('google-auth-library')
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
// 用「探测 Promise 与超时 Promise 竞速」实现超时——认证库本身不保证响应超时，靠这个外部竞速把它关进 5 秒的笼子里。捕获所有异常返回 false：探测失败就等于没凭证。
    const probe = (async () => {
      const client = await auth.getClient()
      await client.getAccessToken()
    })()
    const timeout = sleep(GCP_CREDENTIALS_CHECK_TIMEOUT_MS).then(() => {
      throw new GcpCredentialsTimeoutError('GCP credentials check timed out')
    })
    await Promise.race([probe, timeout])
    return true
  } catch {
    return false
  }
}

/** Default GCP credential TTL - 1 hour to match typical ADC token lifetime */
const DEFAULT_GCP_CREDENTIAL_TTL = 60 * 60 * 1000

/**
 * Run gcpAuthRefresh to perform interactive authentication (e.g., gcloud auth application-default login)
 * Streams output in real-time for user visibility
 */
// GCP 刷新，结构与 AWS 一致：信任检查、先探测再决定是否执行。
async function runGcpAuthRefresh(): Promise<boolean> {
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()

  if (!gcpAuthRefresh) {
    return false // Not configured, treat as success
  }

  // SECURITY: Check if gcpAuthRefresh is from project settings
  if (isGcpAuthRefreshFromProjectSettings()) {
    // Check if trust has been established for this project
    // Pass true to indicate this is a dangerous feature that requires trust
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: gcpAuthRefresh executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('gcpAuthRefresh invoked before trust check', error)
      logEvent('tengu_gcpAuthRefresh_missing_trust', {})
      return false
    }
  }

  try {
    logForDebugging('Checking GCP credentials validity for auth refresh')
    const isValid = await checkGcpCredentialsValid()
    if (isValid) {
      logForDebugging(
        'GCP credentials are valid, skipping auth refresh command',
      )
      return false
    }
  } catch {
    // Credentials check failed, proceed with refresh
  }

  return refreshGcpAuth(gcpAuthRefresh)
}

// Timeout for GCP auth refresh command (3 minutes).
// Long enough for browser-based auth flows, short enough to prevent indefinite hangs.
const GCP_AUTH_REFRESH_TIMEOUT_MS = 3 * 60 * 1000

// 执行 GCP 刷新命令。注释点明一个命名遗留：状态管理器叫 AWS 名字，但它与云厂商无关，输出会被转成通用的认证状态消息发给 UI。
export function refreshGcpAuth(gcpAuthRefresh: string): Promise<boolean> {
  logForDebugging('Running GCP auth refresh command')
  // Start tracking authentication status. AwsAuthStatusManager is cloud-provider-agnostic
  // despite the name — print.ts emits its updates as generic SDK 'auth_status' messages.
  const authStatusManager = AwsAuthStatusManager.getInstance()
  authStatusManager.startAuthentication()

  return new Promise(resolve => {
    const refreshProc = exec(gcpAuthRefresh, {
      timeout: GCP_AUTH_REFRESH_TIMEOUT_MS,
    })
    refreshProc.stdout!.on('data', data => {
      const output = data.toString().trim()
      if (output) {
        // Add output to status manager for UI display
        authStatusManager.addOutput(output)
        // Also log for debugging
        logForDebugging(output, { level: 'debug' })
      }
    })

    refreshProc.stderr!.on('data', data => {
      const error = data.toString().trim()
      if (error) {
        authStatusManager.setError(error)
        logForDebugging(error, { level: 'error' })
      }
    })

    refreshProc.on('close', (code, signal) => {
      if (code === 0) {
        logForDebugging('GCP auth refresh completed successfully')
        authStatusManager.endAuthentication(true)
        void resolve(true)
      } else {
        const timedOut = signal === 'SIGTERM'
        const message = timedOut
          ? chalk.red(
              'GCP auth refresh timed out after 3 minutes. Run your auth command manually in a separate terminal.',
            )
          : chalk.red(
              'Error running gcpAuthRefresh (in settings or ~/.claude.json):',
            )
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(message)
        authStatusManager.endAuthentication(false)
        void resolve(false)
      }
    })
  })
}

/**
 * Refresh GCP authentication if needed.
 * This function checks if credentials are valid and runs the refresh command if not.
 * Memoized with TTL to avoid excessive refresh attempts.
 */
// GCP 刷新也做了记忆化，TTL 一小时（对齐应用默认凭证的典型生命周期），避免短时间内反复尝试。
export const refreshGcpCredentialsIfNeeded = memoizeWithTTLAsync(
  async (): Promise<boolean> => {
    // Run auth refresh if needed
    const refreshed = await runGcpAuthRefresh()
    return refreshed
  },
  DEFAULT_GCP_CREDENTIAL_TTL,
)

export function clearGcpCredentialsCache(): void {
  refreshGcpCredentialsIfNeeded.cache.clear()
}

/**
 * Prefetches GCP credentials only if workspace trust has already been established.
 * This allows us to start the potentially slow GCP commands early for trusted workspaces
 * while maintaining security for untrusted ones.
 *
 * Returns void to prevent misuse - use refreshGcpCredentialsIfNeeded() to actually refresh.
 */
// 安全预取 GCP：只有「不是来自项目配置」或「信任已确认」才真正预取。返回值故意是 void——防止有人误把它当「获取凭证」来用，真正要凭证应调记忆化的刷新函数。
export function prefetchGcpCredentialsIfSafe(): void {
  // Check if gcpAuthRefresh is configured
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()

  if (!gcpAuthRefresh) {
    return
  }

  // Check if gcpAuthRefresh is from project settings
  if (isGcpAuthRefreshFromProjectSettings()) {
    // Only prefetch if trust has already been established
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      // Don't prefetch - wait for trust to be established first
      return
    }
  }

  // Safe to prefetch - either not from project settings or trust already established
  void refreshGcpCredentialsIfNeeded()
}

/**
 * Prefetches AWS credentials only if workspace trust has already been established.
 * This allows us to start the potentially slow AWS commands early for trusted workspaces
 * while maintaining security for untrusted ones.
 *
 * Returns void to prevent misuse - use refreshAndGetAwsCredentials() to actually retrieve credentials.
 */
// 安全预取 AWS：两个命令任一来自项目配置，就都要等信任确认。预取同时还会把模型字符串预热（Bedrock 的模型列表要调云 API，提前拉能省掉首屏等待）。
export function prefetchAwsCredentialsAndBedRockInfoIfSafe(): void {
  // Check if either AWS command is configured
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()
  const awsCredentialExport = getConfiguredAwsCredentialExport()

  if (!awsAuthRefresh && !awsCredentialExport) {
    return
  }

  // Check if either command is from project settings
  if (
    isAwsAuthRefreshFromProjectSettings() ||
    isAwsCredentialExportFromProjectSettings()
  ) {
    // Only prefetch if trust has already been established
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      // Don't prefetch - wait for trust to be established first
      return
    }
  }

  // Safe to prefetch - either not from project settings or trust already established
  void refreshAndGetAwsCredentials()
  getModelStrings()
}

/** @private Use {@link getAnthropicApiKey} or {@link getAnthropicApiKeyWithSource} */
// 从配置或 macOS 钥匙串取登录密钥，带记忆化。注释标明这是私有实现，外部应走上面两个公开入口。
export const getApiKeyFromConfigOrMacOSKeychain = memoize(
  (): { key: string; source: ApiKeySource } | null => {
    if (isBareMode()) return null
    // TODO: migrate to SecureStorage
// macOS 上优先用启动时并行发起的钥匙串预取结果。为什么要预取：读钥匙串要起一个 `security` 子进程，同步读取约 33 毫秒，放在启动主路径上就是肉眼可见的卡顿。预取没拿到 key 时**回落到配置文件而不是再查钥匙串**——预取已经是权威结果了。
    if (process.platform === 'darwin') {
      // keychainPrefetch.ts fires this read at main.tsx top-level in parallel
      // with module imports. If it completed, use that instead of spawning a
      // sync `security` subprocess here (~33ms).
      const prefetch = getLegacyApiKeyPrefetchResult()
      if (prefetch) {
        if (prefetch.stdout) {
          return { key: prefetch.stdout, source: '/login managed key' }
        }
        // Prefetch completed with no key — fall through to config, not keychain.
      } else {
        const storageServiceName = getMacOsKeychainStorageServiceName()
        try {
          const result = execSyncWithDefaults_DEPRECATED(
            `security find-generic-password -a $USER -w -s "${storageServiceName}"`,
          )
          if (result) {
            return { key: result, source: '/login managed key' }
          }
        } catch (e) {
          logError(e)
        }
      }
    }

    const config = getGlobalConfig()
    if (!config.primaryApiKey) {
      return null
    }

    return { key: config.primaryApiKey, source: '/login managed key' }
  },
)

// API key 格式白名单：只允许字母数字、横线、下划线。收紧字符集能避免把奇怪的东西塞进 shell 命令、HTTP 头或配置里。
function isValidApiKey(apiKey: string): boolean {
  // Only allow alphanumeric characters, dashes, and underscores
  return /^[a-zA-Z0-9-_]+$/.test(apiKey)
}

// 保存 API key：先校验格式，再清掉钥匙串里的旧值（避免新旧并存），然后按平台写入。
export async function saveApiKey(apiKey: string): Promise<void> {
  if (!isValidApiKey(apiKey)) {
    throw new Error(
      'Invalid API key format. API key must contain only alphanumeric characters, dashes, and underscores.',
    )
  }

  // Store as primary API key
  await maybeRemoveApiKeyFromMacOSKeychain()
  let savedToKeychain = false
// macOS 写入钥匙串有个精心的设计：把 key 转成十六进制，并通过 `security -i` 的交互模式把命令从 stdin 喂进去，而不是放在命令行参数里。原因写在注释里——**进程监视器能看到命令行参数**，密钥若是参数就会泄漏给同机任意用户；走 stdin 后别人只看到 `security -i`。
  if (process.platform === 'darwin') {
    try {
      // TODO: migrate to SecureStorage
      const storageServiceName = getMacOsKeychainStorageServiceName()
      const username = getUsername()

      // Convert to hexadecimal to avoid any escaping issues
      const hexValue = Buffer.from(apiKey, 'utf-8').toString('hex')

      // Use security's interactive mode (-i) with -X (hexadecimal) option
      // This ensures credentials never appear in process command-line arguments
      // Process monitors only see "security -i", not the password
      const command = `add-generic-password -U -a "${username}" -s "${storageServiceName}" -X "${hexValue}"\n`

      await execa('security', ['-i'], {
        input: command,
        reject: false,
      })

      logEvent('tengu_api_key_saved_to_keychain', {})
      savedToKeychain = true
    } catch (e) {
      logError(e)
      logEvent('tengu_api_key_keychain_error', {
        error: errorMessage(
          e,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logEvent('tengu_api_key_saved_to_config', {})
    }
  } else {
    logEvent('tengu_api_key_saved_to_config', {})
  }

  const normalizedKey = normalizeApiKeyForConfig(apiKey)

  // Save config with all updates
// 保存配置用「读-改-写」的原子更新形式，并顺带把 key 的哈希加进批准列表。注意 `primaryApiKey` 的写法：钥匙串写成功了就保留原值不动，只有钥匙串失败或非 macOS 才把明文写进配置文件——减少明文落盘的范围。
  saveGlobalConfig(current => {
    const approved = current.customApiKeyResponses?.approved ?? []
    return {
      ...current,
      // Only save to config if keychain save failed or not on darwin
      primaryApiKey: savedToKeychain ? current.primaryApiKey : apiKey,
      customApiKeyResponses: {
        ...current.customApiKeyResponses,
        approved: approved.includes(normalizedKey)
          ? approved
          : [...approved, normalizedKey],
        rejected: current.customApiKeyResponses?.rejected ?? [],
      },
    }
  })

  // Clear memo cache
  getApiKeyFromConfigOrMacOSKeychain.cache.clear?.()
  clearLegacyApiKeyPrefetch()
}

// 查询某个 key 是否被用户批准过（用于决定要不要用环境变量里的 key）。
export function isCustomApiKeyApproved(apiKey: string): boolean {
  const config = getGlobalConfig()
  const normalizedKey = normalizeApiKeyForConfig(apiKey)
  return (
    config.customApiKeyResponses?.approved?.includes(normalizedKey) ?? false
  )
}

// 删除 API key：钥匙串与配置**两处都清**，不能因为钥匙串成功就提前返回——老版本客户端曾经把 key 存在配置里，只清钥匙串会留下残留。
export async function removeApiKey(): Promise<void> {
  await maybeRemoveApiKeyFromMacOSKeychain()

  // Also remove from config instead of returning early, for older clients
  // that set keys before we supported keychain.
  saveGlobalConfig(current => ({
    ...current,
    primaryApiKey: undefined,
  }))

  // Clear memo cache
  getApiKeyFromConfigOrMacOSKeychain.cache.clear?.()
  clearLegacyApiKeyPrefetch()
}

async function maybeRemoveApiKeyFromMacOSKeychain(): Promise<void> {
  try {
    await maybeRemoveApiKeyFromMacOSKeychainThrows()
  } catch (e) {
    logError(e)
  }
}

// Function to store OAuth tokens in secure storage
// 保存 OAuth 令牌。返回值带 `warning` 字段而不是抛异常：令牌保存失败不该让登录流程整体失败，用户可能已经在内存里有可用令牌。
export function saveOAuthTokensIfNeeded(tokens: OAuthTokens): {
  success: boolean
  warning?: string
} {
  if (!shouldUseClaudeAIAuth(tokens.scopes)) {
    logEvent('tengu_oauth_tokens_not_claude_ai', {})
    return { success: true }
  }

  // Skip saving inference-only tokens (they come from env vars)
// 只有推理权限的令牌不落盘：它们通常来自环境变量或服务端注入，没有刷新令牌和过期时间，存下来反而会让下次启动误以为有完整登录态。
  if (!tokens.refreshToken || !tokens.expiresAt) {
    logEvent('tengu_oauth_tokens_inference_only', {})
    return { success: true }
  }

  const secureStorage = getSecureStorage()
  const storageBackend =
    secureStorage.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

  try {
    const storageData = secureStorage.read() || {}
    const existingOauth = storageData.claudeAiOauth

    storageData.claudeAiOauth = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
// 订阅类型与限流档位用「新值优先、否则沿用旧值」的写法。原因很具体：刷新令牌时会顺带拉一次用户资料，那个调用对瞬时失败（网络、5xx、限流）是吞掉错误返回空的——如果直接用空值覆盖，一次网络抖动就会把用户有效的订阅信息抹掉，界面上突然从 Max 变成 API。
      // Profile fetch in refreshOAuthToken swallows errors and returns null on
      // transient failures (network, 5xx, rate limit). Don't clobber a valid
      // stored subscription with null — fall back to the existing value.
      subscriptionType:
        tokens.subscriptionType ?? existingOauth?.subscriptionType ?? null,
      rateLimitTier:
        tokens.rateLimitTier ?? existingOauth?.rateLimitTier ?? null,
    }

    const updateStatus = secureStorage.update(storageData)

    if (updateStatus.success) {
      logEvent('tengu_oauth_tokens_saved', { storageBackend })
    } else {
      logEvent('tengu_oauth_tokens_save_failed', { storageBackend })
    }

// 令牌变了要清三类缓存：令牌记忆化、beta 特性列表（与订阅级别相关）、工具 schema 缓存（部分工具按订阅可见）。
    getClaudeAIOAuthTokens.cache?.clear?.()
    clearBetasCaches()
    clearToolSchemaCache()
    return updateStatus
  } catch (error) {
    logError(error)
    logEvent('tengu_oauth_tokens_save_exception', {
      storageBackend,
      error: errorMessage(
        error,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { success: false, warning: 'Failed to save OAuth tokens' }
  }
}

// 读 OAuth 令牌，带记忆化。三种来源按优先级：环境变量、文件描述符、安全存储。前两种是**推理专用**令牌：没有刷新令牌、没有过期时间、作用域只有推理——因为它们的生命周期由外部管理。
export const getClaudeAIOAuthTokens = memoize((): OAuthTokens | null => {
  // --bare: API-key-only. No OAuth env tokens, no keychain, no credentials file.
  if (isBareMode()) return null

  // Check for force-set OAuth token from environment variable
// 环境变量令牌造一个「只有推理权限」的令牌对象。作用域硬编码为推理，正是为了让下面的资料接口判断能正确拒绝——服务账号不该去请求用户资料接口，那会引发 403 风暴。
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    // Return an inference-only token (unknown refresh and expiry)
    return {
      accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
      subscriptionType: null,
      rateLimitTier: null,
    }
  }

  // Check for OAuth token from file descriptor
  const oauthTokenFromFd = getOAuthTokenFromFileDescriptor()
  if (oauthTokenFromFd) {
    // Return an inference-only token (unknown refresh and expiry)
    return {
      accessToken: oauthTokenFromFd,
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
      subscriptionType: null,
      rateLimitTier: null,
    }
  }

// 从安全存储（钥匙串或加密文件）读令牌。读失败只记日志返回空，不抛——认证读取失败应当在调用方以「未登录」的方式表现，而不是让整个进程崩溃。
  try {
    const secureStorage = getSecureStorage()
    const storageData = secureStorage.read()
    const oauthData = storageData?.claudeAiOauth

    if (!oauthData?.accessToken) {
      return null
    }

    return oauthData
  } catch (error) {
    logError(error)
    return null
  }
})

/**
 * Clears all OAuth token caches. Call this on 401 errors to ensure
 * the next token read comes from secure storage, not stale in-memory caches.
 * This handles the case where the local expiration check disagrees with the
 * server (e.g., due to clock corrections after token was issued).
 */
// 清 OAuth 缓存。用途写在注释里：遇到 401 时强制下次从磁盘/钥匙串重读。为什么本地过期检查不够——本地时钟可能与服务端不一致（令牌签发后系统做过时间校正），本地认为没过期而服务端认为过期。
export function clearOAuthTokenCache(): void {
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearKeychainCache()
}

// 记住上次看到的凭证文件修改时间，用于跨进程感知令牌更新。
let lastCredentialsMtimeMs = 0

// Cross-process staleness: another CC instance may write fresh tokens to
// disk (refresh or /login), but this process's memoize caches forever.
// Without this, terminal 1's /login fixes terminal 1; terminal 2's /login
// then revokes terminal 1 server-side, and terminal 1's memoize never
// re-reads — infinite /login regress (CC-1096, GH#24317).
// 跨进程陈旧问题（注释里给了完整的 bug 编号与复现）：另一个实例刷新令牌或重新登录写了磁盘，而本进程的记忆化缓存永不失效。曾经出现的现象是——终端 1 登录修好了终端 1，终端 2 再登录会服务端吊销终端 1 的令牌，而终端 1 的缓存永不重读，于是两边陷入无限重登。解法是每次取令牌前比对凭证文件的修改时间，变了就清缓存。
async function invalidateOAuthCacheIfDiskChanged(): Promise<void> {
  try {
    const { mtimeMs } = await stat(
      join(getClaudeConfigHomeDir(), '.credentials.json'),
    )
    if (mtimeMs !== lastCredentialsMtimeMs) {
      lastCredentialsMtimeMs = mtimeMs
      clearOAuthTokenCache()
    }
  } catch {
    // ENOENT — macOS keychain path (file deleted on migration). Clear only
    // the memoize so it delegates to the keychain cache's 30s TTL instead
    // of caching forever on top. `security find-generic-password` is
    // ~15ms; bounded to once per 30s by the keychain cache.
// 文件不存在（macOS 走钥匙串，没有凭证文件）时只清记忆化，让读取下沉到钥匙串缓存自己的 30 秒 TTL——而不是在记忆化层永久缓存。钥匙串读取约 15 毫秒，被 30 秒 TTL 兜住，代价可接受。
    getClaudeAIOAuthTokens.cache?.clear?.()
  }
}

// In-flight dedup: when N claude.ai proxy connectors hit 401 with the same
// token simultaneously (common at startup — #20930), only one should clear
// caches and re-read the keychain. Without this, each call's clearOAuthTokenCache()
// nukes readInFlight in macOsKeychainStorage and triggers a fresh spawn —
// sync spawns stacked to 800ms+ of blocked render frames.
// 401 处理的在途去重表。场景很具体：启动时多个代理连接同时拿着同一个令牌撞 401（有对应 issue 编号）。不去重的话每个调用都会清缓存并触发一次钥匙串读取，同步子进程叠加起来能阻塞渲染帧 800 毫秒以上。
const pending401Handlers = new Map<string, Promise<boolean>>()

/**
 * Handle a 401 "OAuth token has expired" error from the API.
 *
 * This function forces a token refresh when the server says the token is expired,
 * even if our local expiration check disagrees (which can happen due to clock
 * issues when the token was issued).
 *
 * Safety: We compare the failed token with what's in keychain. If another tab
 * already refreshed (different token in keychain), we use that instead of
 * refreshing again. Concurrent calls with the same failedAccessToken are
 * deduplicated to a single keychain read.
 *
 * @param failedAccessToken - The access token that was rejected with 401
 * @returns true if we now have a valid token, false otherwise
 */
// 处理 401 的入口，按失败令牌做去重：同一个令牌的并发 401 共享一个 Promise。
export function handleOAuth401Error(
  failedAccessToken: string,
): Promise<boolean> {
  const pending = pending401Handlers.get(failedAccessToken)
  if (pending) return pending

  const promise = handleOAuth401ErrorImpl(failedAccessToken).finally(() => {
    pending401Handlers.delete(failedAccessToken)
  })
  pending401Handlers.set(failedAccessToken, promise)
  return promise
}

// 401 的实际处理。核心安全逻辑是「先看钥匙串里现在是什么」——如果已经被别的实例刷新过（令牌与失败的不同），直接用新的，不要重复刷新。重复刷新会让服务端把先前的令牌吊销，形成互相吊销的死循环。
async function handleOAuth401ErrorImpl(
  failedAccessToken: string,
): Promise<boolean> {
  // Clear caches and re-read from keychain (async — sync read blocks ~100ms/call)
  clearOAuthTokenCache()
  const currentTokens = await getClaudeAIOAuthTokensAsync()

  if (!currentTokens?.refreshToken) {
    return false
  }

  // If keychain has a different token, another tab already refreshed - use it
// 令牌已被别人换过，直接用——这是把「刷新风暴」消掉的关键分支。
  if (currentTokens.accessToken !== failedAccessToken) {
    logEvent('tengu_oauth_401_recovered_from_keychain', {})
    return true
  }

  // Same token that failed - force refresh, bypassing local expiration check
  return checkAndRefreshOAuthTokenIfNeeded(0, true)
}

/**
 * Reads OAuth tokens asynchronously, avoiding blocking keychain reads.
 * Delegates to the sync memoized version for env var / file descriptor tokens
 * (which don't hit the keychain), and only uses async for storage reads.
 */
// 异步读令牌，避免阻塞式钥匙串读取。环境变量与文件描述符来源本身是同步的且不碰钥匙串，直接委托给同步版本；只有安全存储读取才走异步。
export async function getClaudeAIOAuthTokensAsync(): Promise<OAuthTokens | null> {
  if (isBareMode()) return null

  // Env var and FD tokens are sync and don't hit the keychain
  if (
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    getOAuthTokenFromFileDescriptor()
  ) {
    return getClaudeAIOAuthTokens()
  }

  try {
    const secureStorage = getSecureStorage()
    const storageData = await secureStorage.readAsync()
    const oauthData = storageData?.claudeAiOauth
    if (!oauthData?.accessToken) {
      return null
    }
    return oauthData
  } catch (error) {
    logError(error)
    return null
  }
}

// In-flight promise for deduplicating concurrent calls
let pendingRefreshCheck: Promise<boolean> | null = null

// 检查并在需要时刷新令牌。带两个逃生参数：重试计数（内部递归用）与强制标志（服务端已明确说令牌过期时用）。只有「首次且非强制」的调用才参与去重——重试与强制刷新本来就该各自独立执行。
export function checkAndRefreshOAuthTokenIfNeeded(
  retryCount = 0,
  force = false,
): Promise<boolean> {
  // Deduplicate concurrent non-retry, non-force calls
  if (retryCount === 0 && !force) {
    if (pendingRefreshCheck) {
      return pendingRefreshCheck
    }

    const promise = checkAndRefreshOAuthTokenIfNeededImpl(retryCount, force)
    pendingRefreshCheck = promise.finally(() => {
      pendingRefreshCheck = null
    })
    return pendingRefreshCheck
  }

  return checkAndRefreshOAuthTokenIfNeededImpl(retryCount, force)
}

async function checkAndRefreshOAuthTokenIfNeededImpl(
  retryCount: number,
  force: boolean,
): Promise<boolean> {
// 最多重试五次。为什么需要重试：刷新要在进程间加锁，多个实例同时发现令牌过期时只有一个能拿到锁，其余的要等它刷完再读。
  const MAX_RETRIES = 5

  await invalidateOAuthCacheIfDiskChanged()

  // First check if token is expired with cached value
  // Skip this check if force=true (server already told us token is bad)
  const tokens = getClaudeAIOAuthTokens()
// 强制模式跳过本地过期检查——服务端已经说令牌坏了，本地时钟的判断不再可信。
  if (!force) {
    if (!tokens?.refreshToken || !isOAuthTokenExpired(tokens.expiresAt)) {
      return false
    }
  }

  if (!tokens?.refreshToken) {
    return false
  }

  if (!shouldUseClaudeAIAuth(tokens.scopes)) {
    return false
  }

// 清缓存后重读一次：可能另一个进程刚刚刷完，那就什么都不用做。这一步能显著减少无谓的锁竞争。
  // Re-read tokens async to check if they're still expired
  // Another process might have refreshed them
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearKeychainCache()
  const freshTokens = await getClaudeAIOAuthTokensAsync()
  if (
    !freshTokens?.refreshToken ||
    !isOAuthTokenExpired(freshTokens.expiresAt)
  ) {
    return false
  }

  // Tokens are still expired, try to acquire lock and refresh
// 在配置目录上加文件锁——这是跨进程互斥，同一个令牌只应被刷新一次。
  const claudeDir = getClaudeConfigHomeDir()
  await mkdir(claudeDir, { recursive: true })

  let release
  try {
    logEvent('tengu_oauth_token_refresh_lock_acquiring', {})
    release = await lockfile.lock(claudeDir)
    logEvent('tengu_oauth_token_refresh_lock_acquired', {})
  } catch (err) {
// 锁被别人占着时等一会儿再试，等待时间加了一秒的随机抖动——多个进程同时退避时，抖动能把它们错开，避免同一时刻再次全部抢锁。
    if ((err as { code?: string }).code === 'ELOCKED') {
      // Another process has the lock, let's retry if we haven't exceeded max retries
      if (retryCount < MAX_RETRIES) {
        logEvent('tengu_oauth_token_refresh_lock_retry', {
          retryCount: retryCount + 1,
        })
        // Wait a bit before retrying
        await sleep(1000 + Math.random() * 1000)
        return checkAndRefreshOAuthTokenIfNeededImpl(retryCount + 1, force)
      }
      logEvent('tengu_oauth_token_refresh_lock_retry_limit_reached', {
        maxRetries: MAX_RETRIES,
      })
      return false
    }
    logError(err)
    logEvent('tengu_oauth_token_refresh_lock_error', {
      error: errorMessage(
        err,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }
// 拿到锁之后**必须再查一遍**：等锁的这段时间里前一个持锁者可能已经刷好了。这是标准的双重检查，跳过它会导致重复刷新。
  try {
    // Check one more time after acquiring lock
    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    const lockedTokens = await getClaudeAIOAuthTokensAsync()
    if (
      !lockedTokens?.refreshToken ||
      !isOAuthTokenExpired(lockedTokens.expiresAt)
    ) {
      logEvent('tengu_oauth_token_refresh_race_resolved', {})
      return false
    }

    logEvent('tengu_oauth_token_refresh_starting', {})
// 刷新时对订阅用户**省略作用域**，让服务端用默认作用域集。这样服务端可以在不要求重新登录的前提下给令牌加新权限（比如后来新增的上传文件权限）。非订阅用户传入原作用域，避免被意外扩权。
    const refreshedTokens = await refreshOAuthToken(lockedTokens.refreshToken, {
      // For Claude.ai subscribers, omit scopes so the default
      // CLAUDE_AI_OAUTH_SCOPES applies — this allows scope expansion
      // (e.g. adding user:file_upload) on refresh without re-login.
      scopes: shouldUseClaudeAIAuth(lockedTokens.scopes)
        ? undefined
        : lockedTokens.scopes,
    })
    saveOAuthTokensIfNeeded(refreshedTokens)

    // Clear the cache after refreshing token
    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    return true
// 刷新抛错时不要立刻认输：可能在报错之前令牌已被别的进程刷新成功了，所以再读一次，若已不过期就算成功。
  } catch (error) {
    logError(error)

    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    const currentTokens = await getClaudeAIOAuthTokensAsync()
    if (currentTokens && !isOAuthTokenExpired(currentTokens.expiresAt)) {
      logEvent('tengu_oauth_token_refresh_race_recovered', {})
      return true
    }

    return false
// 无论成败都要释放锁。日志在释放前后各打一条，便于排查「锁没释放」这类卡死问题。
  } finally {
    logEvent('tengu_oauth_token_refresh_lock_releasing', {})
    await release()
    logEvent('tengu_oauth_token_refresh_lock_released', {})
  }
}

// 是否订阅用户：既要第一方认证启用，也要令牌的作用域表明是 claude.ai 的订阅身份。
export function isClaudeAISubscriber(): boolean {
  if (!isAnthropicAuthEnabled()) {
    return false
  }

  return shouldUseClaudeAIAuth(getClaudeAIOAuthTokens()?.scopes)
}

/**
 * Check if the current OAuth token has the user:profile scope.
 *
 * Real /login tokens always include this scope. Env-var and file-descriptor
 * tokens (service keys) hardcode scopes to ['user:inference'] only. Use this
 * to gate calls to profile-scoped endpoints so service key sessions don't
 * generate 403 storms against /api/oauth/profile, bootstrap, etc.
 */
// 是否有资料作用域。用途写在注释里：真实登录的令牌一定带这个作用域，而环境变量与服务账号令牌的作用域被硬编码成只有推理——用这个判断来把资料类接口的调用挡在门外，否则服务账号会话会对着资料接口打出一片 403。
export function hasProfileScope(): boolean {
  return (
    getClaudeAIOAuthTokens()?.scopes?.includes(CLAUDE_AI_PROFILE_SCOPE) ?? false
  )
}

// 是否第一方 API 客户：既不是云服务用户、也不是订阅用户。这个分类用于决定展示哪些计费与用量信息。
export function is1PApiCustomer(): boolean {
  // 1P API customers are users who are NOT:
  // 1. Claude.ai subscribers (Max, Pro, Enterprise, Team)
  // 2. Vertex AI users
  // 3. AWS Bedrock users
  // 4. Foundry users

  // Exclude Vertex, Bedrock, and Foundry customers
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
  ) {
    return false
  }

  // Exclude Claude.ai subscribers
  if (isClaudeAISubscriber()) {
    return false
  }

  // Everyone else is an API customer (OAuth API customers, direct API key users, etc.)
  return true
}

/**
 * Gets OAuth account information when Anthropic auth is enabled.
 * Returns undefined when using external API keys or third-party services.
 */
// OAuth 账户信息只在第一方认证启用时返回；用外部 key 或云服务时返回 undefined，因为那些身份没有对应的账户资料。
export function getOauthAccountInfo(): AccountInfo | undefined {
  return isAnthropicAuthEnabled() ? getGlobalConfig().oauthAccount : undefined
}

/**
 * Checks if overage/extra usage provisioning is allowed for this organization.
 * This mirrors the logic in apps/claude-ai `useIsOverageProvisioningAllowed` hook as closely as possible.
 */
// 是否允许购买超额用量。两道门槛：必须是订阅用户且账单类型有值；账单类型必须是 Stripe 或应用内购买（苹果、谷歌）——企业合同账单等类型不走自助购买。
export function isOverageProvisioningAllowed(): boolean {
  const accountInfo = getOauthAccountInfo()
  const billingType = accountInfo?.billingType

  // Must be a Claude subscriber with a supported subscription type
  if (!isClaudeAISubscriber() || !billingType) {
    return false
  }

  // only allow Stripe and mobile billing types to purchase extra usage
  if (
    billingType !== 'stripe_subscription' &&
    billingType !== 'stripe_subscription_contracted' &&
    billingType !== 'apple_subscription' &&
    billingType !== 'google_play_subscription'
  ) {
    return false
  }

  return true
}

// Returns whether the user has Opus access at all, regardless of whether they
// are a subscriber or PayG.
// 是否有 Opus 模型访问权。注意最后一个条件：订阅类型为空时**也返回有权限**——空值既覆盖纯 API 用户，也覆盖「订阅用户但类型没填」的情况；后者若按无权限处理会误伤真实付费用户，宁可放宽。
export function hasOpusAccess(): boolean {
  const subscriptionType = getSubscriptionType()

  return (
    subscriptionType === 'max' ||
    subscriptionType === 'enterprise' ||
    subscriptionType === 'team' ||
    subscriptionType === 'pro' ||
    // subscriptionType === null covers both API users and the case where
    // subscribers do not have subscription type populated. For those
    // subscribers, when in doubt, we should not limit their access to Opus.
    subscriptionType === null
  )
}

// 取订阅类型。测试用的模拟类型优先（仅内部环境），然后要求第一方认证启用。
export function getSubscriptionType(): SubscriptionType | null {
  // Check for mock subscription type first (ANT-only testing)
  if (shouldUseMockSubscription()) {
    return getMockSubscriptionType()
  }

  if (!isAnthropicAuthEnabled()) {
    return null
  }
  const oauthTokens = getClaudeAIOAuthTokens()
  if (!oauthTokens) {
    return null
  }

  return oauthTokens.subscriptionType ?? null
}

export function isMaxSubscriber(): boolean {
  return getSubscriptionType() === 'max'
}

export function isTeamSubscriber(): boolean {
  return getSubscriptionType() === 'team'
}

export function isTeamPremiumSubscriber(): boolean {
  return (
    getSubscriptionType() === 'team' &&
    getRateLimitTier() === 'default_claude_max_5x'
  )
}

export function isEnterpriseSubscriber(): boolean {
  return getSubscriptionType() === 'enterprise'
}

export function isProSubscriber(): boolean {
  return getSubscriptionType() === 'pro'
}

// 取限流档位（如 Max 的五倍档）。团队高级版就是用「团队类型加这个档位」判定的。
export function getRateLimitTier(): string | null {
  if (!isAnthropicAuthEnabled()) {
    return null
  }
  const oauthTokens = getClaudeAIOAuthTokens()
  if (!oauthTokens) {
    return null
  }

  return oauthTokens.rateLimitTier ?? null
}

// 订阅的展示名，用于状态栏与账户页面。默认落到 API，因为非订阅用户就是按量付费的 API 客户。
export function getSubscriptionName(): string {
  const subscriptionType = getSubscriptionType()

  switch (subscriptionType) {
    case 'enterprise':
      return 'Claude Enterprise'
    case 'team':
      return 'Claude Team'
    case 'max':
      return 'Claude Max'
    case 'pro':
      return 'Claude Pro'
    default:
      return 'Claude API'
  }
}

/** Check if using third-party services (Bedrock or Vertex or Foundry) */
// 是否使用第三方云服务（Bedrock、Vertex、Foundry）。
export function isUsing3PServices(): boolean {
  return !!(
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
  )
}

/**
 * Get the configured otelHeadersHelper from settings
 */
function getConfiguredOtelHeadersHelper(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.otelHeadersHelper
}

/**
 * Check if the configured otelHeadersHelper comes from project settings (projectSettings or localSettings)
 */
// 判断 otelHeadersHelper 是否来自项目或本地配置——与其他 helper 一致，来自项目的命令需要信任检查。
export function isOtelHeadersHelperFromProjectOrLocalSettings(): boolean {
  const otelHeadersHelper = getConfiguredOtelHeadersHelper()
  if (!otelHeadersHelper) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.otelHeadersHelper === otelHeadersHelper ||
    localSettings?.otelHeadersHelper === otelHeadersHelper
  )
}

// Cache for debouncing otelHeadersHelper calls
// 遥测请求头的缓存与默认去抖时间（29 分钟）。为什么是 29 分钟而不是 30：底下 OAuth 令牌的有效期通常按小时算，留一分钟余量避免在令牌边界上取到即将过期的头。
let cachedOtelHeaders: Record<string, string> | null = null
let cachedOtelHeadersTimestamp = 0
const DEFAULT_OTEL_HEADERS_DEBOUNCE_MS = 29 * 60 * 1000 // 29 minutes

// 取遥测请求头，同步执行 helper（遥测头要在发请求的那一刻就绪，没法异步等）。带 30 秒超时，容忍认证服务的延迟。
export function getOtelHeadersFromHelper(): Record<string, string> {
  const otelHeadersHelper = getConfiguredOtelHeadersHelper()

  if (!otelHeadersHelper) {
    return {}
  }

  // Return cached headers if still valid (debounce)
  const debounceMs = parseInt(
    process.env.CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS ||
      DEFAULT_OTEL_HEADERS_DEBOUNCE_MS.toString(),
  )
  if (
    cachedOtelHeaders &&
    Date.now() - cachedOtelHeadersTimestamp < debounceMs
  ) {
    return cachedOtelHeaders
  }

// 这里**没有**非交互会话的例外——只要 helper 来自项目配置且信任未确认，就返回空头。因为遥测头会随每个请求发出去，泄漏面比单次命令执行更大。
  if (isOtelHeadersHelperFromProjectOrLocalSettings()) {
    // Check if trust has been established for this project
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust) {
      return {}
    }
  }

  try {
    const result = execSyncWithDefaults_DEPRECATED(otelHeadersHelper, {
      timeout: 30000, // 30 seconds - allows for auth service latency
    })
      ?.toString()
      .trim()
    if (!result) {
      throw new Error('otelHeadersHelper did not return a valid value')
    }

// 严格校验返回值：必须是 JSON 对象、不能是数组、不能是 null，且**每个值都必须是字符串**。宽松校验会把数字或嵌套对象塞进 HTTP 头，表现为请求被服务端拒绝或更隐蔽的行为异常。
    const headers = jsonParse(result)
    if (
      typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers)
    ) {
      throw new Error(
        'otelHeadersHelper must return a JSON object with string key-value pairs',
      )
    }

    // Validate all values are strings
// 逐项检查值类型，报错时带上出问题的键名——不然用户面对一个几十行的 JSON 完全不知道该改哪。
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') {
        throw new Error(
          `otelHeadersHelper returned non-string value for key "${key}": ${typeof value}`,
        )
      }
    }

    // Cache the result
    cachedOtelHeaders = headers as Record<string, string>
    cachedOtelHeadersTimestamp = Date.now()

    return cachedOtelHeaders
  } catch (error) {
    logError(
      new Error(
        `Error getting OpenTelemetry headers from otelHeadersHelper (in settings): ${errorMessage(error)}`,
      ),
    )
    throw error
  }
}

function isConsumerPlan(plan: SubscriptionType): plan is 'max' | 'pro' {
  return plan === 'max' || plan === 'pro'
}

// 是否消费级订阅用户（Max 或 Pro）。企业版与团队版不算——它们有独立的计费与限额模型。
export function isConsumerSubscriber(): boolean {
  const subscriptionType = getSubscriptionType()
  return (
    isClaudeAISubscriber() &&
    subscriptionType !== null &&
    isConsumerPlan(subscriptionType)
  )
}

export type UserAccountInfo = {
  subscription?: string
  tokenSource?: string
  apiKeySource?: ApiKeySource
  organization?: string
  email?: string
}

// 组装账户信息用于展示。只对第一方 API 提供：云服务与外部网关的身份没有统一账户概念。字段填充有优先级——环境变量令牌只报来源不报订阅；订阅用户报订阅名；其余报令牌来源。
export function getAccountInformation() {
  const apiProvider = getAPIProvider()
  // Only provide account info for first-party Anthropic API
  if (apiProvider !== 'firstParty') {
    return undefined
  }
  const { source: authTokenSource } = getAuthTokenSource()
  const accountInfo: UserAccountInfo = {}
  if (
    authTokenSource === 'CLAUDE_CODE_OAUTH_TOKEN' ||
    authTokenSource === 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'
  ) {
    accountInfo.tokenSource = authTokenSource
  } else if (isClaudeAISubscriber()) {
    accountInfo.subscription = getSubscriptionName()
  } else {
    accountInfo.tokenSource = authTokenSource
  }
  const { key: apiKey, source: apiKeySource } = getAnthropicApiKeyWithSource()
  if (apiKey) {
    accountInfo.apiKeySource = apiKeySource
  }

// 组织名与邮箱只在「claude.ai 登录」或「登录流程托管的密钥」这两种来源下才可信。用外部 key 或 auth token 时我们根本不知道对方属于哪个组织，硬填就是撒谎。
  // We don't know the organization if we're relying on an external API key or auth token
  if (
    authTokenSource === 'claude.ai' ||
    apiKeySource === '/login managed key'
  ) {
    // Get organization name from OAuth account info
    const orgName = getOauthAccountInfo()?.organizationName
    if (orgName) {
      accountInfo.organization = orgName
    }
  }
  const email = getOauthAccountInfo()?.emailAddress
  if (
    (authTokenSource === 'claude.ai' ||
      apiKeySource === '/login managed key') &&
    email
  ) {
    accountInfo.email = email
  }
  return accountInfo
}

/**
 * Result of org validation — either success or a descriptive error.
 */
export type OrgValidationResult =
  | { valid: true }
  | { valid: false; message: string }

/**
 * Validate that the active OAuth token belongs to the organization required
 * by `forceLoginOrgUUID` in managed settings. Returns a result object
 * rather than throwing so callers can choose how to surface the error.
 *
 * Fails closed: if `forceLoginOrgUUID` is set and we cannot determine the
 * token's org (network error, missing profile data), validation fails.
 */
// 校验当前令牌是否属于企业策略要求的组织。返回结果对象而不是抛异常，让调用方能自行决定怎么呈现——有的场景是硬失败，有的只是警告。**失败即拒绝**：策略设了要求但拿不到组织信息（网络错误、资料缺失），一律判无效。
export async function validateForceLoginOrg(): Promise<OrgValidationResult> {
  // `claude ssh` remote: real auth lives on the local machine and is injected
  // by the proxy. The placeholder token can't be validated against the profile
  // endpoint. The local side already ran this check before establishing the session.
// ssh 远程直接放行：真正的认证在本地机器、由代理注入，占位令牌没法拿去查资料接口；本地那一侧在建立会话前已经做过这个校验了。
  if (process.env.ANTHROPIC_UNIX_SOCKET) {
    return { valid: true }
  }

  if (!isAnthropicAuthEnabled()) {
    return { valid: true }
  }

  const requiredOrgUuid =
    getSettingsForSource('policySettings')?.forceLoginOrgUUID
  if (!requiredOrgUuid) {
    return { valid: true }
  }

  // Ensure the access token is fresh before hitting the profile endpoint.
  // No-op for env-var tokens (refreshToken is null).
  await checkAndRefreshOAuthTokenIfNeeded()

  const tokens = getClaudeAIOAuthTokens()
  if (!tokens) {
    return { valid: true }
  }

// **必须服务端验证**，不能用本地缓存的 UUID：`~/.claude.json` 里的组织信息是用户可写的，信任它等于把策略校验拱手让给被约束方。所以哪怕是钥匙串来的令牌也要去问一次资料接口。
  // Always fetch the authoritative org UUID from the profile endpoint.
  // Even keychain-sourced tokens verify server-side: the cached org UUID
  // in ~/.claude.json is user-writable and cannot be trusted.
  const { source } = getAuthTokenSource()
  const isEnvVarToken =
    source === 'CLAUDE_CODE_OAUTH_TOKEN' ||
    source === 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'

  const profile = await getOauthProfileFromOauthToken(tokens.accessToken)
// 拿不到资料就**失败**，并且错误信息里解释三种可能：网络问题、令牌缺少资料作用域（特别点名了某种精简登录方式产出的令牌没有这个作用域）、或者令牌本身有问题。这类错误如果只说「校验失败」，用户完全无从下手。
  if (!profile) {
    // Fail closed — we can't verify the org
    return {
      valid: false,
      message:
        `Unable to verify organization for the current authentication token.\n` +
        `This machine requires organization ${requiredOrgUuid} but the profile could not be fetched.\n` +
        `This may be a network error, or the token may lack the user:profile scope required for\n` +
        `verification (tokens from 'claude setup-token' do not include this scope).\n` +
        `Try again, or obtain a full-scope token via 'claude auth login'.`,
    }
  }

  const tokenOrgUuid = profile.organization.uuid
  if (tokenOrgUuid === requiredOrgUuid) {
    return { valid: true }
  }

// 组织不匹配时的提示分两种：来自环境变量令牌要告诉用户**具体是哪个变量**、并提示删掉它或换正确组织的令牌；其他来源则提示重新登录。区分开是因为前者用户可能根本不知道有这个变量在起作用。
  if (isEnvVarToken) {
    const envVarName =
      source === 'CLAUDE_CODE_OAUTH_TOKEN'
        ? 'CLAUDE_CODE_OAUTH_TOKEN'
        : 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'
    return {
      valid: false,
      message:
        `The ${envVarName} environment variable provides a token for a\n` +
        `different organization than required by this machine's managed settings.\n\n` +
        `Required organization: ${requiredOrgUuid}\n` +
        `Token organization:   ${tokenOrgUuid}\n\n` +
        `Remove the environment variable or obtain a token for the correct organization.`,
    }
  }

  return {
    valid: false,
    message:
      `Your authentication token belongs to organization ${tokenOrgUuid},\n` +
      `but this machine requires organization ${requiredOrgUuid}.\n\n` +
      `Please log in with the correct organization: claude auth login`,
  }
}

// 专门用于把「超时」与其他失败区分开的错误类型——探测逻辑里超时要被当成「没凭证」处理，与真正的认证错误同样返回 false，但保留类型便于将来细分。
class GcpCredentialsTimeoutError extends Error {}
