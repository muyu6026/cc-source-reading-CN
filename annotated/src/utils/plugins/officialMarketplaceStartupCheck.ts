/**
 * Auto-install logic for the official Anthropic marketplace.
 *
 * This module handles automatically installing the official marketplace
 * on startup for new users, with appropriate checks for:
 * - Enterprise policy restrictions
 * - Git availability
 * - Previous installation attempts
 */
// 文件级：本文件实现「官方 Anthropic 插件市场」的启动自动安装逻辑，针对新用户在新会话启动时自动装好官方市场，并做企业策略、git 可用性、历史安装记录等前置检查。

import { join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
// 引入带缓存但可能过期的特性开关读取函数，用于决定是否允许 git 兜底回退。
import { logEvent } from '../../services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import { checkGitAvailable, markGitUnavailable } from './gitAvailability.js'
import { isSourceAllowedByPolicy } from './marketplaceHelpers.js'
import {
  addMarketplaceSource,
  getMarketplacesCacheDir,
  loadKnownMarketplacesConfig,
  saveKnownMarketplacesConfig,
} from './marketplaceManager.js'
import {
  OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_MARKETPLACE_SOURCE,
} from './officialMarketplace.js'
import { fetchOfficialMarketplaceFromGcs } from './officialMarketplaceGcs.js'

/**
 * Reason why the official marketplace was not installed
 */
export type OfficialMarketplaceSkipReason =
  | 'already_attempted'
  | 'already_installed'
  | 'policy_blocked'
  | 'git_unavailable'
  | 'gcs_unavailable'
  | 'unknown'
// `OfficialMarketplaceSkipReason`：跳过安装的原因枚举，涵盖已尝试、已安装、策略拦截、git 不可用、GCS 不可用与未知错误。

/**
 * Check if official marketplace auto-install is disabled via environment variable.
 */
// `isOfficialMarketplaceAutoInstallDisabled`：通过环境变量判断是否关闭官方市场自动安装，关闭后本模块直接跳过。
export function isOfficialMarketplaceAutoInstallDisabled(): boolean {
  return isEnvTruthy(
    process.env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL,
  )
}

/**
 * Configuration for retry logic
 */
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 10,
  INITIAL_DELAY_MS: 60 * 60 * 1000, // 1 hour
  BACKOFF_MULTIPLIER: 2,
  MAX_DELAY_MS: 7 * 24 * 60 * 60 * 1000, // 1 week
}
// `RETRY_CONFIG`：重试配置，最多 10 次、初始延迟 1 小时、指数退避翻倍、上限 1 周。

/**
 * Calculate next retry delay using exponential backoff
 */
// `calculateNextRetryDelay`：按重试次数计算下一次指数退避延迟，并夹在上限以内。
function calculateNextRetryDelay(retryCount: number): number {
  const delay =
    RETRY_CONFIG.INITIAL_DELAY_MS *
    Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, retryCount)
  return Math.min(delay, RETRY_CONFIG.MAX_DELAY_MS)
// 用 `Math.min` 把退避延迟封顶到 `MAX_DELAY_MS`，避免等待时间过长。
}

/**
 * Determine if installation should be retried based on failure reason and retry state
 */
// `shouldRetryInstallation`：综合失败原因与重试状态判断还要不要再试；从未尝试过就试，已成功就停，超过上限或策略拦截就永久放弃。
function shouldRetryInstallation(
  config: ReturnType<typeof getGlobalConfig>,
): boolean {
  // If never attempted, should try
  if (!config.officialMarketplaceAutoInstallAttempted) {
// 从未尝试过安装就应当尝试。
    return true
  }

  // If already installed successfully, don't retry
  if (config.officialMarketplaceAutoInstalled) {
// 已经安装成功就不再重试。
    return false
  }

  const failReason = config.officialMarketplaceAutoInstallFailReason
  const retryCount = config.officialMarketplaceAutoInstallRetryCount || 0
  const nextRetryTime = config.officialMarketplaceAutoInstallNextRetryTime
  const now = Date.now()

  // Check if we've exceeded max attempts
  if (retryCount >= RETRY_CONFIG.MAX_ATTEMPTS) {
// 重试次数达到上限就不再重试。
    return false
  }

  // Permanent failures - don't retry
  if (failReason === 'policy_blocked') {
// 策略拦截属于永久失败，不再重试。
    return false
  }

  // Check if enough time has passed for next retry
  if (nextRetryTime && now < nextRetryTime) {
// 下一次重试时间还没到就先不重试。
    return false
  }

  // Retry for temporary failures (unknown), semi-permanent (git_unavailable),
  // and legacy state (undefined failReason from before retry logic existed)
  return (
    failReason === 'unknown' ||
    failReason === 'git_unavailable' ||
    failReason === 'gcs_unavailable' ||
    failReason === undefined
  )
// 对临时失败（未知）、半永久（git 不可用、GCS 不可用）以及旧版遗留的未定义原因都允许重试。
}

/**
 * Result of the auto-install check
 */
export type OfficialMarketplaceCheckResult = {
  /** Whether the marketplace was successfully installed */
  installed: boolean
  /** Whether the installation was skipped (and why) */
  skipped: boolean
  /** Reason for skipping, if applicable */
  reason?: OfficialMarketplaceSkipReason
  /** Whether saving retry metadata to config failed */
  configSaveFailed?: boolean
}
// `OfficialMarketplaceCheckResult`：自动安装检查的结果结构，含是否安装成功、是否跳过、跳过原因，以及保存重试元数据是否失败。

/**
 * Check and install the official marketplace on startup.
 *
 * This function is designed to be called as a fire-and-forget operation
 * during startup. It will:
 * 1. Check if installation was already attempted
 * 2. Check if marketplace is already installed
 * 3. Check enterprise policy restrictions
 * 4. Check git availability
 * 5. Attempt installation
 * 6. Record the result in GlobalConfig
 *
 * @returns Result indicating whether installation succeeded or was skipped
 */
// `checkAndInstallOfficialMarketplace`：启动期即发即弃的入口，依次检查是否该重试、是否被环境变量关闭、是否已装、是否策略拦截，再尝试 GCS 镜像或 git 安装，并把结果写进全局配置。
export async function checkAndInstallOfficialMarketplace(): Promise<OfficialMarketplaceCheckResult> {
  const config = getGlobalConfig()

  // Check if we should retry installation
  if (!shouldRetryInstallation(config)) {
// 先问是否还应该重试，不该重试就按既有失败原因返回跳过结果。
    const reason: OfficialMarketplaceSkipReason =
      config.officialMarketplaceAutoInstallFailReason ?? 'already_attempted'
    logForDebugging(`Official marketplace auto-install skipped: ${reason}`)
    return {
      installed: false,
      skipped: true,
      reason,
    }
  }

  try {
    // Check if auto-install is disabled via env var
    if (isOfficialMarketplaceAutoInstallDisabled()) {
// 环境变量关闭自动安装时，把状态记成策略拦截并上报事件后返回。
      logForDebugging(
        'Official marketplace auto-install disabled via env var, skipping',
      )
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'policy_blocked',
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        policy_blocked: true,
      })
      return { installed: false, skipped: true, reason: 'policy_blocked' }
    }

    // Check if marketplace is already installed
    const knownMarketplaces = await loadKnownMarketplacesConfig()
// 读已知市场配置，若官方市场已存在就标记为已尝试并跳过。
    if (knownMarketplaces[OFFICIAL_MARKETPLACE_NAME]) {
      logForDebugging(
        `Official marketplace '${OFFICIAL_MARKETPLACE_NAME}' already installed, skipping`,
      )
      // Mark as attempted so we don't check again
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: true,
      }))
      return { installed: false, skipped: true, reason: 'already_installed' }
    }

    // Check enterprise policy restrictions
    if (!isSourceAllowedByPolicy(OFFICIAL_MARKETPLACE_SOURCE)) {
// 企业策略不允许该来源时，记为策略拦截并上报后跳过。
      logForDebugging(
        'Official marketplace blocked by enterprise policy, skipping',
      )
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'policy_blocked',
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        policy_blocked: true,
      })
      return { installed: false, skipped: true, reason: 'policy_blocked' }
    }

    // inc-5046: try GCS mirror first — doesn't need git, doesn't hit GitHub.
    // Backend (anthropic#317037) publishes a marketplace zip to the same
    // bucket as the native binary. If GCS succeeds, register the marketplace
    // with source:'github' (still true — GCS is a mirror) and skip git
    // entirely.
// 优先试 GCS 镜像：不需要 git、不碰 GitHub，后端把市场压缩包发到与二进制同桶；成功则仍以 `github` 为来源登记并完全跳过 git。
    const cacheDir = getMarketplacesCacheDir()
// 算出缓存目录与安装位置，供后续 GCS 与 git 两种安装路径共用。
    const installLocation = join(cacheDir, OFFICIAL_MARKETPLACE_NAME)
    const gcsSha = await fetchOfficialMarketplaceFromGcs(
// 从 GCS 拉取官方市场压缩包，拿到摘要即视为成功。
      installLocation,
      cacheDir,
    )
    if (gcsSha !== null) {
// GCS 成功：把市场写进已知市场配置并清空重试元数据，上报成功事件后返回。
      const known = await loadKnownMarketplacesConfig()
      known[OFFICIAL_MARKETPLACE_NAME] = {
        source: OFFICIAL_MARKETPLACE_SOURCE,
        installLocation,
        lastUpdated: new Date().toISOString(),
      }
      await saveKnownMarketplacesConfig(known)
// 把更新后的已知市场配置落盘，登记官方市场来源与安装位置。

      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: true,
        officialMarketplaceAutoInstallFailReason: undefined,
        officialMarketplaceAutoInstallRetryCount: undefined,
        officialMarketplaceAutoInstallLastAttemptTime: undefined,
        officialMarketplaceAutoInstallNextRetryTime: undefined,
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: true,
        skipped: false,
        via_gcs: true,
      })
      return { installed: true, skipped: false }
    }
    // GCS failed (404 until backend writes, or network). Fall through to git
    // ONLY if the kill-switch allows — same gate as refreshMarketplace().
// GCS 失败（后端还没写或网络问题）时，只有在特性开关允许的情况下才回退到 git。
    if (
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_plugin_official_mkt_git_fallback',
        true,
      )
    ) {
// 若特性开关关闭 git 兜底，则把失败记成 GCS 不可用并按退避安排下次重试，而非直接放弃。
      logForDebugging(
        'Official marketplace GCS failed; git fallback disabled by flag — skipping install',
      )
      // Same retry-with-backoff metadata as git_unavailable below — transient
      // GCS failures should retry with exponential backoff, not give up.
      const retryCount =
        (config.officialMarketplaceAutoInstallRetryCount || 0) + 1
      const now = Date.now()
      const nextRetryTime = now + calculateNextRetryDelay(retryCount)
// 计算本次重试次数与下一次重试时间点，写入配置的退避元数据。
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'gcs_unavailable',
        officialMarketplaceAutoInstallRetryCount: retryCount,
        officialMarketplaceAutoInstallLastAttemptTime: now,
        officialMarketplaceAutoInstallNextRetryTime: nextRetryTime,
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        gcs_unavailable: true,
        retry_count: retryCount,
      })
      return { installed: false, skipped: true, reason: 'gcs_unavailable' }
    }

    // Check git availability
    const gitAvailable = await checkGitAvailable()
// 检查 git 是否可用，作为回退安装路径的前置条件。
    if (!gitAvailable) {
      logForDebugging(
        'Git not available, skipping official marketplace auto-install',
      )
      const retryCount =
        (config.officialMarketplaceAutoInstallRetryCount || 0) + 1
      const now = Date.now()
      const nextRetryDelay = calculateNextRetryDelay(retryCount)
      const nextRetryTime = now + nextRetryDelay

// git 不可用时记录重试元数据，下次启动按退避再试。
      let configSaveFailed = false
// 用 `configSaveFailed` 标记配置保存是否失败，失败时仍返回结果不丢信息。
      try {
        saveGlobalConfig(current => ({
          ...current,
          officialMarketplaceAutoInstallAttempted: true,
          officialMarketplaceAutoInstalled: false,
          officialMarketplaceAutoInstallFailReason: 'git_unavailable',
          officialMarketplaceAutoInstallRetryCount: retryCount,
          officialMarketplaceAutoInstallLastAttemptTime: now,
          officialMarketplaceAutoInstallNextRetryTime: nextRetryTime,
        }))
      } catch (saveError) {
        configSaveFailed = true
        // Log the error properly so it gets tracked
        const configError = toError(saveError)
        logError(configError)

        logForDebugging(
          `Failed to save marketplace auto-install git_unavailable state: ${saveError}`,
          { level: 'error' },
        )
      }
      logEvent('tengu_official_marketplace_auto_install', {
// 上报 git 不可用的自动安装事件，带上重试次数。
        installed: false,
        skipped: true,
        git_unavailable: true,
        retry_count: retryCount,
      })
      return {
        installed: false,
        skipped: true,
        reason: 'git_unavailable',
        configSaveFailed,
      }
    }

    // Attempt installation
    logForDebugging('Attempting to auto-install official marketplace')
    await addMarketplaceSource(OFFICIAL_MARKETPLACE_SOURCE)
// git 兜底路径：直接通过 `addMarketplaceSource` 把官方市场源加进来。

    // Success
    logForDebugging('Successfully auto-installed official marketplace')
    const previousRetryCount =
      config.officialMarketplaceAutoInstallRetryCount || 0
    saveGlobalConfig(current => ({
      ...current,
      officialMarketplaceAutoInstallAttempted: true,
      officialMarketplaceAutoInstalled: true,
      // Clear retry metadata on success
      officialMarketplaceAutoInstallFailReason: undefined,
      officialMarketplaceAutoInstallRetryCount: undefined,
      officialMarketplaceAutoInstallLastAttemptTime: undefined,
      officialMarketplaceAutoInstallNextRetryTime: undefined,
    }))
    logEvent('tengu_official_marketplace_auto_install', {
      installed: true,
      skipped: false,
      retry_count: previousRetryCount,
    })
    return { installed: true, skipped: false }
  } catch (error) {
    // Handle installation failure
// 安装失败的统一处理：取出错误消息，先识别 macOS 的 xcrun 假 git 这种特殊情形。
    const errorMessage = error instanceof Error ? error.message : String(error)
// 把任意错误归一化成可读的错误消息字符串。

    // On macOS, /usr/bin/git is an xcrun shim that always exists on PATH, so
    // checkGitAvailable() (which only does `which git`) passes even without
    // Xcode CLT installed. The shim then fails at clone time with
    // "xcrun: error: invalid active developer path (...)". Poison the memoized
    // availability check so other git callers in this session skip cleanly,
    // then return silently without recording any attempt state — next startup
    // tries fresh (no backoff machinery for what is effectively "git absent").
    if (errorMessage.includes('xcrun: error:')) {
// macOS 上 `/usr/bin/git` 只是 xcrun 垫片，克隆时才报错；识别后把 git 标记不可用并静默返回，下次启动重新尝试。
      markGitUnavailable()
// 毒化会话内记忆化的 git 可用性检查，让本会话其他 git 调用干净跳过。
      logForDebugging(
        'Official marketplace auto-install: git is a non-functional macOS xcrun shim, treating as git_unavailable',
      )
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        git_unavailable: true,
        macos_xcrun_shim: true,
      })
      return {
        installed: false,
        skipped: true,
        reason: 'git_unavailable',
      }
    }

    logForDebugging(
      `Failed to auto-install official marketplace: ${errorMessage}`,
      { level: 'error' },
    )
    logError(toError(error))
// 把真实的安装错误记进日志，便于排查。

    const retryCount =
      (config.officialMarketplaceAutoInstallRetryCount || 0) + 1
    const now = Date.now()
    const nextRetryDelay = calculateNextRetryDelay(retryCount)
    const nextRetryTime = now + nextRetryDelay
// 未知失败时同样安排指数退避重试，并记录重试次数与时间。

    let configSaveFailed = false
// 保存失败状态时也用 `configSaveFailed` 标记，保证即便存盘失败也如实上报安装失败。
    try {
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'unknown',
        officialMarketplaceAutoInstallRetryCount: retryCount,
        officialMarketplaceAutoInstallLastAttemptTime: now,
        officialMarketplaceAutoInstallNextRetryTime: nextRetryTime,
      }))
    } catch (saveError) {
      configSaveFailed = true
      // Log the error properly so it gets tracked
      const configError = toError(saveError)
      logError(configError)

      logForDebugging(
        `Failed to save marketplace auto-install failure state: ${saveError}`,
        { level: 'error' },
      )

      // Still return the failure result even if config save failed
      // This ensures we report the installation failure correctly
    }
    logEvent('tengu_official_marketplace_auto_install', {
// 上报最终失败事件，标记 `failed` 与重试次数。
      installed: false,
      skipped: true,
      failed: true,
      retry_count: retryCount,
    })

    return {
      installed: false,
      skipped: true,
      reason: 'unknown',
      configSaveFailed,
    }
  }
}
