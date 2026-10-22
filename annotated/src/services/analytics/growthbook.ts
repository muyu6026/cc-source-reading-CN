// 【第 1-77 行】`growthbook.ts` 是遥测子系统的**引擎**：它封装了 GrowthBook（一个远程开关 / A-B 实验 SDK），
//     并给全代码库提供「读一个开关值 / 读一个动态配置」的统一入口。几乎所有其他模块拿到的「要不要开某功能」
//     最终都追溯到这里的 `getFeatureValue_CACHED_MAY_BE_STALE`。
//     它和 `firstPartyEventLogger.ts` 互相引用（实验曝光要记入 1P），但靠「谁 import 谁」的单向依赖避免循环。
import { GrowthBook } from '@growthbook/growthbook'
import { isEqual, memoize } from 'lodash-es'
import {
  getIsNonInteractiveSession,
  getSessionTrustAccepted,
} from '../../bootstrap/state.js'
import { getGrowthBookClientKey } from '../../constants/keys.js'
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { getAuthHeaders } from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import { createSignal } from '../../utils/signal.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type GitHubActionsMetadata,
  getUserForGrowthBook,
} from '../../utils/user.js'
import {
  is1PEventLoggingEnabled,
  logGrowthBookExperimentTo1P,
} from './firstPartyEventLogger.js'

/**
 * User attributes sent to GrowthBook for targeting.
 * Uses UUID suffix (not Uuid) to align with GrowthBook conventions.
 */
export type GrowthBookUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
  github?: GitHubActionsMetadata
}

/**
 * Malformed feature response from API that uses "value" instead of "defaultValue".
 * This is a workaround until the API is fixed.
 */
// 【第 49-57 行】`MalformedFeatureDefinition` 这个类型本身就是一段**事故记录**：
//     API 返回的是 `{ value }` 而不是 SDK 期望的 `{ defaultValue }`，这是后端还没修的 bug，客户端先 workaround。
//     第 330-376 行的 `processRemoteEvalPayload` 会把这个 `value` 搬到 `defaultValue` 上。
//     → 当上游契约和 SDK 预期对不上时，客户端用一个类型 + 一段转换来兜底，并在注释里标注「TODO 修好 API 就删」。
type MalformedFeatureDefinition = {
  value?: unknown
  defaultValue?: unknown
  [key: string]: unknown
}

let client: GrowthBook | null = null

// Named handler refs so resetGrowthBook can remove them to prevent accumulation
let currentBeforeExitHandler: (() => void) | null = null
let currentExitHandler: (() => void) | null = null

// Track whether auth was available when the client was created
// This allows us to detect when we need to recreate with fresh auth headers
let clientCreatedWithAuth = false

// Store experiment data from payload for logging exposures later
// 【第 69-90 行】四张内存 Map / Set，是这个模块的「状态中枢」，各自管一件事：
//     - `experimentDataByFeature`：从 payload 里挖出的实验数据，供曝光上报用
//     - `remoteEvalFeatureValues`：**绕过 SDK bug 的自家缓存**（SDK 不尊重 remoteEval 的预求值，见第 378 行）
//     - `pendingExposures` / `loggedExposures`：实验曝光「先记待发、再按 session 去重」的两阶段
//     第 88-89 行注释点出 `loggedExposures` 的存在理由：避免 `getFeatureValue_CACHED_MAY_BE_STALE`
//     在热路径（如 render 循环里的 `isAutoMemoryEnabled`）被反复调用时，刷出重复的曝光事件。
type StoredExperimentData = {
  experimentId: string
  variationId: number
  inExperiment?: boolean
  hashAttribute?: string
  hashValue?: string
}
const experimentDataByFeature = new Map<string, StoredExperimentData>()

// Cache for remote eval feature values - workaround for SDK not respecting remoteEval response
// The SDK's setForcedFeatures also doesn't work reliably with remoteEval
const remoteEvalFeatureValues = new Map<string, unknown>()

// Track features accessed before init that need exposure logging
const pendingExposures = new Set<string>()

// Track features that have already had their exposure logged this session (dedup)
// This prevents firing duplicate exposure events when getFeatureValue_CACHED_MAY_BE_STALE
// is called repeatedly in hot paths (e.g., isAutoMemoryEnabled in render loops)
const loggedExposures = new Set<string>()

// Track re-initialization promise for security gate checks
// When GrowthBook is re-initializing (e.g., after auth change), security gate checks
// should wait for init to complete to avoid returning stale values
// 【第 91-123 行】两个「控制流协调」原语：
//     - `reinitializingPromise`（第 94 行）：安全门检查时要**等这次重初始化完成**，避免在 auth 切换的间隙
//       拿到过期值（见第 851 行的 `checkSecurityRestrictionGate`）
//     - `refreshed` signal（第 107 行）：订阅者通知。注释强调它**不被 `resetGrowthBook` 清理**——
//       订阅者通常在 `init.ts` 注册一次、要跨 auth-change 重置存活。
//     - `callSafe`（第 110 行）：用 `Promise.resolve(listener()).catch(...)` 把「同步 throw」和「异步 reject」
//       **都**导向 `logError`—— 否则异步 listener 的 reject 会变成 unhandled rejection（try/catch 只看到 Promise 本身）。
let reinitializingPromise: Promise<unknown> | null = null

// Listeners notified when GrowthBook feature values refresh (initial init or
// periodic refresh). Use for systems that bake feature values into long-lived
// objects at construction time (e.g. firstPartyEventLogger reads
// tengu_1p_event_batch_config once and builds a LoggerProvider with it) and
// need to rebuild when config changes. Per-call readers like
// getEventSamplingConfig / isSinkKilled don't need this — they're already
// reactive.
//
// NOT cleared by resetGrowthBook — subscribers register once (typically in
// init.ts) and must survive auth-change resets.
type GrowthBookRefreshListener = () => void | Promise<void>
const refreshed = createSignal()

/** Call a listener with sync-throw and async-rejection both routed to logError. */
function callSafe(listener: GrowthBookRefreshListener): void {
  try {
    // Promise.resolve() normalizes sync returns and Promises so both
    // sync throws (caught by outer try) and async rejections (caught
    // by .catch) hit logError. Without the .catch, an async listener
    // that rejects becomes an unhandled rejection — the try/catch
    // only sees the Promise, not its eventual rejection.
    void Promise.resolve(listener()).catch(e => {
      logError(e)
    })
  } catch (e) {
    logError(e)
  }
}

/**
 * Register a callback to fire when GrowthBook feature values refresh.
 * Returns an unsubscribe function.
 *
 * If init has already completed with features by the time this is called
 * (remoteEvalFeatureValues is populated), the listener fires once on the
 * next microtask. This catch-up handles the race where GB's network response
 * lands before the REPL's useEffect commits — on external builds with fast
 * networks and MCP-heavy configs, init can finish in ~100ms while REPL mount
 * takes ~600ms (see #20951 external-build trace at 30.540 vs 31.046).
 *
 * Change detection is on the subscriber: the callback fires on every refresh;
 * use isEqual against your last-seen config to decide whether to act.
 */
// 【第 125-157 行】`onGrowthBookRefresh` 的**追赶 microtask**（第 144-152 行）是修一个真实竞态：
//     外部构建上网络快、MCP 配置重时，GB 的网络响应可能在 REPL 的 `useEffect` 提交前就回来了（~100ms vs ~600ms）。
//     如果订阅者还没注册，就错过这次通知。所以「若 Map 已填充，下一个 microtask 补发一次」。
//     第 154-156 行的 unsubscribe 还要在 microtask 里再查一次 `subscribed`，因为注册和 microtask 之间可能已被取消。
export function onGrowthBookRefresh(
  listener: GrowthBookRefreshListener,
): () => void {
  let subscribed = true
  const unsubscribe = refreshed.subscribe(() => callSafe(listener))
  if (remoteEvalFeatureValues.size > 0) {
    queueMicrotask(() => {
      // Re-check: listener may have been removed, or resetGrowthBook may have
      // cleared the Map, between registration and this microtask running.
      if (subscribed && remoteEvalFeatureValues.size > 0) {
        callSafe(listener)
      }
    })
  }
  return () => {
    subscribed = false
    unsubscribe()
  }
}

/**
 * Parse env var overrides for GrowthBook features.
 * Set CLAUDE_INTERNAL_FC_OVERRIDES to a JSON object mapping feature keys to values
 * to bypass remote eval and disk cache. Useful for eval harnesses that need to
 * test specific feature flag configurations. Only active when USER_TYPE is 'ant'.
 *
 * Example: CLAUDE_INTERNAL_FC_OVERRIDES='{"my_feature": true, "my_config": {"key": "val"}}'
 */
let envOverrides: Record<string, unknown> | null = null
let envOverridesParsed = false

function getEnvOverrides(): Record<string, unknown> | null {
  if (!envOverridesParsed) {
    envOverridesParsed = true
    if (process.env.USER_TYPE === 'ant') {
      const raw = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
      if (raw) {
        try {
          envOverrides = JSON.parse(raw) as Record<string, unknown>
          logForDebugging(
            `GrowthBook: Using env var overrides for ${Object.keys(envOverrides!).length} features: ${Object.keys(envOverrides!).join(', ')}`,
          )
        } catch {
          logError(
            new Error(
              `GrowthBook: Failed to parse CLAUDE_INTERNAL_FC_OVERRIDES: ${raw}`,
            ),
          )
        }
      }
    }
  }
  return envOverrides
}

/**
 * Check if a feature has an env-var override (CLAUDE_INTERNAL_FC_OVERRIDES).
 * When true, _CACHED_MAY_BE_STALE will return the override without touching
 * disk or network — callers can skip awaiting init for that feature.
 */
export function hasGrowthBookEnvOverride(feature: string): boolean {
  const overrides = getEnvOverrides()
  return overrides !== null && feature in overrides
}

/**
 * Local config overrides set via /config Gates tab (ant-only). Checked after
 * env-var overrides — env wins so eval harnesses remain deterministic. Unlike
 * getEnvOverrides this is not memoized: the user can change overrides at
 * runtime, and getGlobalConfig() is already memory-cached (pointer-chase)
 * until the next saveGlobalConfig() invalidates it.
 */
function getConfigOverrides(): Record<string, unknown> | undefined {
  if (process.env.USER_TYPE !== 'ant') return undefined
  try {
    return getGlobalConfig().growthBookOverrides
  } catch {
    // getGlobalConfig() throws before configReadingAllowed is set (early
    // main.tsx startup path). Same degrade as the disk-cache fallback below.
    return undefined
  }
}

/**
 * Enumerate all known GrowthBook features and their current resolved values
 * (not including overrides). In-memory payload first, disk cache fallback —
 * same priority as the getters. Used by the /config Gates tab.
 */
export function getAllGrowthBookFeatures(): Record<string, unknown> {
  if (remoteEvalFeatureValues.size > 0) {
    return Object.fromEntries(remoteEvalFeatureValues)
  }
  return getGlobalConfig().cachedGrowthBookFeatures ?? {}
}

export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return getConfigOverrides() ?? {}
}

/**
 * Set or clear a single config override. Pass undefined to clear.
 * Fires onGrowthBookRefresh listeners so systems that bake gate values into
 * long-lived objects (useMainLoopModel, useSkillsChange, etc.) rebuild —
 * otherwise overriding e.g. tengu_ant_model_override wouldn't actually
 * change the model until the next periodic refresh.
 */
export function setGrowthBookConfigOverride(
  feature: string,
  value: unknown,
): void {
  if (process.env.USER_TYPE !== 'ant') return
  try {
    saveGlobalConfig(c => {
      const current = c.growthBookOverrides ?? {}
      if (value === undefined) {
        if (!(feature in current)) return c
        const { [feature]: _, ...rest } = current
        if (Object.keys(rest).length === 0) {
          const { growthBookOverrides: __, ...configWithout } = c
          return configWithout
        }
        return { ...c, growthBookOverrides: rest }
      }
      if (isEqual(current[feature], value)) return c
      return { ...c, growthBookOverrides: { ...current, [feature]: value } }
    })
    // Subscribers do their own change detection (see onGrowthBookRefresh docs),
    // so firing on a no-op write is fine.
    refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

export function clearGrowthBookConfigOverrides(): void {
  if (process.env.USER_TYPE !== 'ant') return
  try {
    saveGlobalConfig(c => {
      if (
        !c.growthBookOverrides ||
        Object.keys(c.growthBookOverrides).length === 0
      ) {
        return c
      }
      const { growthBookOverrides: _, ...rest } = c
      return rest
    })
    refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

/**
 * Log experiment exposure for a feature if it has experiment data.
 * Deduplicates within a session - each feature is logged at most once.
 */
function logExposureForFeature(feature: string): void {
  // Skip if already logged this session (dedup)
  if (loggedExposures.has(feature)) {
    return
  }

  const expData = experimentDataByFeature.get(feature)
  if (expData) {
    loggedExposures.add(feature)
    logGrowthBookExperimentTo1P({
      experimentId: expData.experimentId,
      variationId: expData.variationId,
      userAttributes: getUserAttributes(),
      experimentMetadata: {
        feature_id: feature,
      },
    })
  }
}

/**
 * Process a remote eval payload from the GrowthBook server and populate
 * local caches. Called after both initial client.init() and after
 * client.refreshFeatures() so that _BLOCKS_ON_INIT callers see fresh values
 * across the process lifetime, not just init-time snapshots.
 *
 * Without this running on refresh, remoteEvalFeatureValues freezes at its
 * init-time snapshot and getDynamicConfig_BLOCKS_ON_INIT returns stale values
 * for the entire process lifetime — which broke the tengu_max_version_config
 * kill switch for long-running sessions.
 */
// 【第 327-394 行】`processRemoteEvalPayload` 是整个模块**最危险也最精巧**的一段。
//     第 334-340 行有一个防黑屏的判据：`{}` 是**真值**—— 如果少了 `features` 长度检查，
//     服务器一次截断的畸形响应（空的 `{features:{}}`）会清空 Map、返回 true、然后 `syncRemoteEvalToDisk`
//     把 `{}` **整盘写盘**，导致所有共享 `~/.claude.json` 的进程**所有开关集体黑屏**。
//     第 342-371 行：先 `clear` 再重建（让被删的 feature 不会留下 stale 幽灵条目），同时把 `value`→`defaultValue` 修正、
//     顺手挖出实验数据。第 382-392 行：把预求值**自己缓存**进 `remoteEvalFeatureValues`（因为 SDK 不尊重 remoteEval）。
async function processRemoteEvalPayload(
  gbClient: GrowthBook,
): Promise<boolean> {
  // WORKAROUND: Transform remote eval response format
  // The API returns { "value": ... } but SDK expects { "defaultValue": ... }
  // TODO: Remove this once the API is fixed to return correct format
  const payload = gbClient.getPayload()
  // Empty object is truthy — without the length check, `{features: {}}`
  // (transient server bug, truncated response) would pass, clear the maps
  // below, return true, and syncRemoteEvalToDisk would wholesale-write `{}`
  // to disk: total flag blackout for every process sharing ~/.claude.json.
  if (!payload?.features || Object.keys(payload.features).length === 0) {
    return false
  }

  // Clear before rebuild so features removed between refreshes don't
  // leave stale ghost entries that short-circuit getFeatureValueInternal.
  experimentDataByFeature.clear()

  const transformedFeatures: Record<string, MalformedFeatureDefinition> = {}
  for (const [key, feature] of Object.entries(payload.features)) {
    const f = feature as MalformedFeatureDefinition
    if ('value' in f && !('defaultValue' in f)) {
      transformedFeatures[key] = {
        ...f,
        defaultValue: f.value,
      }
    } else {
      transformedFeatures[key] = f
    }

    // Store experiment data for later logging when feature is accessed
    if (f.source === 'experiment' && f.experimentResult) {
      const expResult = f.experimentResult as {
        variationId?: number
      }
      const exp = f.experiment as { key?: string } | undefined
      if (exp?.key && expResult.variationId !== undefined) {
        experimentDataByFeature.set(key, {
          experimentId: exp.key,
          variationId: expResult.variationId,
        })
      }
    }
  }
  // Re-set the payload with transformed features
  await gbClient.setPayload({
    ...payload,
    features: transformedFeatures,
  })

  // WORKAROUND: Cache the evaluated values directly from remote eval response.
  // The SDK's evalFeature() tries to re-evaluate rules locally, ignoring the
  // pre-evaluated 'value' from remoteEval. setForcedFeatures also doesn't work
  // reliably. So we cache values ourselves and use them in getFeatureValueInternal.
  remoteEvalFeatureValues.clear()
  for (const [key, feature] of Object.entries(transformedFeatures)) {
    // Under remoteEval:true the server pre-evaluates. Whether the answer
    // lands in `value` (current API) or `defaultValue` (post-TODO API shape),
    // it's the authoritative value for this user. Guarding on both keeps
    // syncRemoteEvalToDisk correct across a partial or full API migration.
    const v = 'value' in feature ? feature.value : feature.defaultValue
    if (v !== undefined) {
      remoteEvalFeatureValues.set(key, v)
    }
  }
  return true
}

/**
 * Write the complete remoteEvalFeatureValues map to disk. Called exactly
 * once per successful processRemoteEvalPayload — never from a failure path,
 * so init-timeout poisoning is structurally impossible (the .catch() at init
 * never reaches here).
 *
 * Wholesale replace (not merge): features deleted server-side are dropped
 * from disk on the next successful payload. Ant builds ⊇ external, so
 * switching builds is safe — the write is always a complete answer for this
 * process's SDK key.
 */
// 【第 396-417 行】`syncRemoteEvalToDisk` 有两条硬约束，注释写得很重：
//     1. **只在成功 payload 路径调用，失败路径永不调用** —— 所以「初始化超时投毒」在结构上不可能发生
//        （init 的 `.catch()` 永远到不了这里）
//     2. **整盘替换，不合并** —— 服务器删掉的 feature 会在下次成功时从磁盘消失；且 ant 构建 ⊇ 外部构建，
//        换构建写盘也安全（总是这个 SDK key 的完整答案）
//     第 410-412 行：和当前磁盘值 `isEqual` 相同就直接 return，避免无意义的写盘（「没变化就不写」）。
function syncRemoteEvalToDisk(): void {
  const fresh = Object.fromEntries(remoteEvalFeatureValues)
  const config = getGlobalConfig()
  if (isEqual(config.cachedGrowthBookFeatures, fresh)) {
    return
  }
  saveGlobalConfig(current => ({
    ...current,
    cachedGrowthBookFeatures: fresh,
  }))
}

/**
 * Check if GrowthBook operations should be enabled
 */
// 【第 419-449 行】`isGrowthBookEnabled()` 只有一行：`return is1PEventLoggingEnabled()`——
//     GrowthBook **依赖** 1P 事件日志（因为实验曝光要记到 1P）。这是一个隐式的依赖关系：
//     关掉遥测，开关系统也随之失效（退化为默认值），用户感知到的是「所有实验/开关都回到默认」。
//     `getApiBaseUrlHost`（第 439 行）处理企业代理部署（Epic / Marble 等）：这些通常走 apiKeyHelper auth，
//     导致 `organizationUUID/accountUUID/email` 都缺失，**没有稳定 attribute 可定向**—— 只能靠每设备 ID。
//     所以这里只取 host（无 path/query/cred），给这类部署一个可定向的锚点。
function isGrowthBookEnabled(): boolean {
  // GrowthBook depends on 1P event logging.
  return is1PEventLoggingEnabled()
}

/**
 * Hostname of ANTHROPIC_BASE_URL when it points at a non-Anthropic proxy.
 *
 * Enterprise-proxy deployments (Epic, Marble, etc.) typically use
 * apiKeyHelper auth, which means isAnthropicAuthEnabled() returns false and
 * organizationUUID/accountUUID/email are all absent from GrowthBook
 * attributes. Without this, there's no stable attribute to target them on
 * — only per-device IDs. See src/utils/auth.ts isAnthropicAuthEnabled().
 *
 * Returns undefined for unset/default (api.anthropic.com) so the attribute
 * is absent for direct-API users. Hostname only — no path/query/creds.
 */
export function getApiBaseUrlHost(): string | undefined {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) return undefined
  try {
    const host = new URL(baseUrl).host
    if (host === 'api.anthropic.com') return undefined
    return host
  } catch {
    return undefined
  }
}

/**
 * Get user attributes for GrowthBook from CoreUserData
 */
function getUserAttributes(): GrowthBookUserAttributes {
  const user = getUserForGrowthBook()

  // For ants, always try to include email from OAuth config even if ANTHROPIC_API_KEY is set.
  // This ensures GrowthBook targeting by email works regardless of auth method.
  let email = user.email
  if (!email && process.env.USER_TYPE === 'ant') {
    email = getGlobalConfig().oauthAccount?.emailAddress
  }

  const apiBaseUrlHost = getApiBaseUrlHost()

  const attributes = {
    id: user.deviceId,
    sessionId: user.sessionId,
    deviceID: user.deviceId,
    platform: user.platform,
    ...(apiBaseUrlHost && { apiBaseUrlHost }),
    ...(user.organizationUuid && { organizationUUID: user.organizationUuid }),
    ...(user.accountUuid && { accountUUID: user.accountUuid }),
    ...(user.userType && { userType: user.userType }),
    ...(user.subscriptionType && { subscriptionType: user.subscriptionType }),
    ...(user.rateLimitTier && { rateLimitTier: user.rateLimitTier }),
    ...(user.firstTokenTime && { firstTokenTime: user.firstTokenTime }),
    ...(email && { email }),
    ...(user.appVersion && { appVersion: user.appVersion }),
    ...(user.githubActionsMetadata && {
      githubActionsMetadata: user.githubActionsMetadata,
    }),
  }
  return attributes
}

/**
 * Get or create the GrowthBook client instance
 */
// 【第 487-617 行】`getGrowthBookClient` 是 `memoize` 的客户端工厂，几个要点：
//     - 第 514-521 行：信任未建立时**不传 auth**（避免信任弹窗前执行 apiKeyHelper），并记 `clientCreatedWithAuth`
//     - 第 524-546 行：把 `client` 捕获进局部变量 `thisClient`，因为 init 是异步的——
//       如果重初始化在 init 完成前发生，回调里必须判断 `client !== thisClient`（第 558、578 行）才能跳过处理旧客户端
//     - 第 609-613 行：beforeExit / exit 处理器用**命名引用**注册，这样 `resetGrowthBook` 能精确移除、防止累积
//     → 「异步初始化 + 可能重初始化」场景下，用闭包捕获 + 身份比对来避免处理一个已被替换的客户端，是这里的精髓。
const getGrowthBookClient = memoize(
  (): { client: GrowthBook; initialized: Promise<void> } | null => {
    if (!isGrowthBookEnabled()) {
      return null
    }

    const attributes = getUserAttributes()
    const clientKey = getGrowthBookClientKey()
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `GrowthBook: Creating client with clientKey=${clientKey}, attributes: ${jsonStringify(attributes)}`,
      )
    }
    const baseUrl =
      process.env.USER_TYPE === 'ant'
        ? process.env.CLAUDE_CODE_GB_BASE_URL || 'https://api.anthropic.com/'
        : 'https://api.anthropic.com/'

    // Skip auth if trust hasn't been established yet
    // This prevents executing apiKeyHelper commands before the trust dialog
    // Non-interactive sessions implicitly have workspace trust
    // getSessionTrustAccepted() covers the case where the TrustDialog auto-resolved
    // without persisting trust for the specific CWD (e.g., home directory) —
    // showSetupScreens() sets this after the trust dialog flow completes.
    const hasTrust =
      checkHasTrustDialogAccepted() ||
      getSessionTrustAccepted() ||
      getIsNonInteractiveSession()
    const authHeaders = hasTrust
      ? getAuthHeaders()
      : { headers: {}, error: 'trust not established' }
    const hasAuth = !authHeaders.error
    clientCreatedWithAuth = hasAuth

    // Capture in local variable so the init callback operates on THIS client,
    // not a later client if reinitialization happens before init completes
    const thisClient = new GrowthBook({
      apiHost: baseUrl,
      clientKey,
      attributes,
      remoteEval: true,
      // Re-fetch when user ID or org changes (org change = login to different org)
      cacheKeyAttributes: ['id', 'organizationUUID'],
      // Add auth headers if available
      ...(authHeaders.error
        ? {}
        : { apiHostRequestHeaders: authHeaders.headers }),
      // Debug logging for Ants
      ...(process.env.USER_TYPE === 'ant'
        ? {
            log: (msg: string, ctx: Record<string, unknown>) => {
              logForDebugging(`GrowthBook: ${msg} ${jsonStringify(ctx)}`)
            },
          }
        : {}),
    })
    client = thisClient

    if (!hasAuth) {
      // No auth available yet — skip HTTP init, rely on disk-cached values.
      // initializeGrowthBook() will reset and re-create with auth when available.
      return { client: thisClient, initialized: Promise.resolve() }
    }

    const initialized = thisClient
      .init({ timeout: 5000 })
      .then(async result => {
        // Guard: if this client was replaced by a newer one, skip processing
        if (client !== thisClient) {
          if (process.env.USER_TYPE === 'ant') {
            logForDebugging(
              'GrowthBook: Skipping init callback for replaced client',
            )
          }
          return
        }

        if (process.env.USER_TYPE === 'ant') {
          logForDebugging(
            `GrowthBook initialized successfully, source: ${result.source}, success: ${result.success}`,
          )
        }

        const hadFeatures = await processRemoteEvalPayload(thisClient)
        // Re-check: processRemoteEvalPayload yields at `await setPayload`.
        // Microtask-only today (no encryption, no sticky-bucket service), but
        // the guard at the top of this callback runs before that await;
        // this runs after.
        if (client !== thisClient) return

        if (hadFeatures) {
          for (const feature of pendingExposures) {
            logExposureForFeature(feature)
          }
          pendingExposures.clear()
          syncRemoteEvalToDisk()
          // Notify subscribers: remoteEvalFeatureValues is populated and
          // disk is freshly synced. _CACHED_MAY_BE_STALE reads memory first
          // (#22295), so subscribers see fresh values immediately.
          refreshed.emit()
        }

        // Log what features were loaded
        if (process.env.USER_TYPE === 'ant') {
          const features = thisClient.getFeatures()
          if (features) {
            const featureKeys = Object.keys(features)
            logForDebugging(
              `GrowthBook loaded ${featureKeys.length} features: ${featureKeys.slice(0, 10).join(', ')}${featureKeys.length > 10 ? '...' : ''}`,
            )
          }
        }
      })
      .catch(error => {
        if (process.env.USER_TYPE === 'ant') {
          logError(toError(error))
        }
      })

    // Register cleanup handlers for graceful shutdown (named refs so resetGrowthBook can remove them)
    currentBeforeExitHandler = () => client?.destroy()
    currentExitHandler = () => client?.destroy()
    process.on('beforeExit', currentBeforeExitHandler)
    process.on('exit', currentExitHandler)

    return { client: thisClient, initialized }
  },
)

/**
 * Initialize GrowthBook client (blocks until ready)
 */
export const initializeGrowthBook = memoize(
// 【第 622-664 行】`initializeGrowthBook` 是 `memoize(async)`，**会阻塞等 init**。
//     第 632-654 行处理一个时序问题：如果客户端创建时还没有 auth，等 auth 可用后再调本函数时，
//     会 `resetGrowthBook()` 重建（因为 `apiHostRequestHeaders` 创建后**不能改**），避免「旧客户端 init 还在跑、
//     新客户端又起一个」的双 init。第 660 行在成功后建周期刷新—— 放在这里（而不是别处）保证任何重init后都重建刷新。
  async (): Promise<GrowthBook | null> => {
    let clientWrapper = getGrowthBookClient()
    if (!clientWrapper) {
      return null
    }

    // Check if auth has become available since the client was created
    // If so, we need to recreate the client with fresh auth headers
    // Only check if trust is established to avoid triggering apiKeyHelper before trust dialog
    if (!clientCreatedWithAuth) {
      const hasTrust =
        checkHasTrustDialogAccepted() ||
        getSessionTrustAccepted() ||
        getIsNonInteractiveSession()
      if (hasTrust) {
        const currentAuth = getAuthHeaders()
        if (!currentAuth.error) {
          if (process.env.USER_TYPE === 'ant') {
            logForDebugging(
              'GrowthBook: Auth became available after client creation, reinitializing',
            )
          }
          // Use resetGrowthBook to properly destroy old client and stop periodic refresh
          // This prevents double-init where old client's init promise continues running
          resetGrowthBook()
          clientWrapper = getGrowthBookClient()
          if (!clientWrapper) {
            return null
          }
        }
      }
    }

    await clientWrapper.initialized

    // Set up periodic refresh after successful initialization
    // This is called here (not separately) so it's always re-established after any reinit
    setupPeriodicGrowthBookRefresh()

    return clientWrapper.client
  },
)

/**
 * Get a feature value with a default fallback - blocks until initialized.
 * @internal Used by both deprecated and cached functions.
 */
async function getFeatureValueInternal<T>(
  feature: string,
  defaultValue: T,
  logExposure: boolean,
): Promise<T> {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return overrides[feature] as T
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return configOverrides[feature] as T
  }

  if (!isGrowthBookEnabled()) {
    return defaultValue
  }

  const growthBookClient = await initializeGrowthBook()
  if (!growthBookClient) {
    return defaultValue
  }

  // Use cached remote eval values if available (workaround for SDK bug)
  let result: T
  if (remoteEvalFeatureValues.has(feature)) {
    result = remoteEvalFeatureValues.get(feature) as T
  } else {
    result = growthBookClient.getFeatureValue(feature, defaultValue) as T
  }

  // Log experiment exposure using stored experiment data
  if (logExposure) {
    logExposureForFeature(feature)
  }

  if (process.env.USER_TYPE === 'ant') {
    logForDebugging(
      `GrowthBook: getFeatureValue("${feature}") = ${jsonStringify(result)}`,
    )
  }
  return result
}

/**
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE instead, which is non-blocking.
 * This function blocks on GrowthBook initialization which can slow down startup.
 */
export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValueInternal(feature, defaultValue, true)
}

// 【第 726-775 行】`getFeatureValue_CACHED_MAY_BE_STALE` 是**启动关键路径和同步上下文的首选**读法。
//     它**不阻塞**：先查 env override、再查 config override、再查内存 `remoteEvalFeatureValues`、最后回退磁盘缓存。
//     第 752-757 行：实验曝光「有数据就记、没有就加到 pendingExposures 待发」—— 因为此时可能还没 init 完。
//     注释点出内存 payload 一旦 `processRemoteEvalPayload` 跑过就是权威的，和磁盘等价、但跳过 JSON 解析更快。
/**
 * Get a feature value from disk cache immediately. Pure read — disk is
 * populated by syncRemoteEvalToDisk on every successful payload (init +
 * periodic refresh), not by this function.
 *
 * This is the preferred method for startup-critical paths and sync contexts.
 * The value may be stale if the cache was written by a previous process.
 */
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return overrides[feature] as T
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return configOverrides[feature] as T
  }

  if (!isGrowthBookEnabled()) {
    return defaultValue
  }

  // Log experiment exposure if data is available, otherwise defer until after init
  if (experimentDataByFeature.has(feature)) {
    logExposureForFeature(feature)
  } else {
    pendingExposures.add(feature)
  }

  // In-memory payload is authoritative once processRemoteEvalPayload has run.
  // Disk is also fresh by then (syncRemoteEvalToDisk runs synchronously inside
  // init), so this is correctness-equivalent to the disk read below — but it
  // skips the config JSON parse and is what onGrowthBookRefresh subscribers
  // depend on to read fresh values the instant they're notified.
  if (remoteEvalFeatureValues.has(feature)) {
    return remoteEvalFeatureValues.get(feature) as T
  }

  // Fall back to disk cache (survives across process restarts)
  try {
    const cached = getGlobalConfig().cachedGrowthBookFeatures?.[feature]
    return cached !== undefined ? (cached as T) : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * @deprecated Disk cache is now synced on every successful payload load
 * (init + 20min/6h periodic refresh). The per-feature TTL never fetched
 * fresh data from the server — it only re-wrote in-memory state to disk,
 * which is now redundant. Use getFeatureValue_CACHED_MAY_BE_STALE directly.
 */
export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)
}

/**
 * Check a Statsig feature gate value via GrowthBook, with fallback to Statsig cache.
 *
 * **MIGRATION ONLY**: This function is for migrating existing Statsig gates to GrowthBook.
 * For new features, use `getFeatureValue_CACHED_MAY_BE_STALE()` instead.
 *
 * - Checks GrowthBook disk cache first
 * - Falls back to Statsig's cachedStatsigGates during migration
 * - The value may be stale if the cache hasn't been updated recently
 *
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE() for new code. This function
 * exists only to support migration of existing Statsig gates.
 */
// 【第 804-837 行】`checkStatsigFeatureGate_CACHED_MAY_BE_STALE` 是**迁移期专用**：把老的 Statsig gate
//     搬到 GrowthBook 时，先查 GB 磁盘缓存，没有再回退 `cachedStatsigGates`。
//     注释明确它是 `@deprecated`、新代码不该用。这段揭示了一段**真实的迁移史**：Claude Code 曾经用 Statsig，
//     现在迁到 GrowthBook，过渡期两套缓存都得认，直到老 Statsig 彻底退役。
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    return false
  }

  // Log experiment exposure if data is available, otherwise defer until after init
  if (experimentDataByFeature.has(gate)) {
    logExposureForFeature(gate)
  } else {
    pendingExposures.add(gate)
  }

  // Return cached value immediately from disk
  // First check GrowthBook cache, then fall back to Statsig cache for migration
  const config = getGlobalConfig()
  const gbCached = config.cachedGrowthBookFeatures?.[gate]
  if (gbCached !== undefined) {
    return Boolean(gbCached)
  }
  // Fallback to Statsig cache for migration period
  return config.cachedStatsigGates?.[gate] ?? false
}

/**
 * Check a security restriction gate, waiting for re-init if in progress.
 *
 * Use this for security-critical gates where we need fresh values after auth changes.
 *
 * Behavior:
 * - If GrowthBook is re-initializing (e.g., after login), waits for it to complete
 * - Otherwise, returns cached value immediately (Statsig cache first, then GrowthBook)
 *
 * Statsig cache is checked first as a safety measure for security-related checks:
 * if the Statsig cache indicates the gate is enabled, we honor it.
 */
// 【第 851-889 行】`checkSecurityRestrictionGate` 是**安全关键**的读法：如果 `reinitializingPromise` 在跑
//     （auth 刚变），先 `await` 它完成，确保拿到 auth 切换后的**新鲜值**。
//     第 874-885 行：先查 Statsig 缓存、再查 GB 缓存—— 注释说「Statsig 优先是安全措施」：
//     如果上次登录 session 的 Statsig 缓存说 gate 开着，就**尊重它**（双重保险，宁可多放不可错关安全限制）。
export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    return false
  }

  // If re-initialization is in progress, wait for it to complete
  // This ensures we get fresh values after auth changes
  if (reinitializingPromise) {
    await reinitializingPromise
  }

  // Check Statsig cache first - it may have correct value from previous logged-in session
  const config = getGlobalConfig()
  const statsigCached = config.cachedStatsigGates?.[gate]
  if (statsigCached !== undefined) {
    return Boolean(statsigCached)
  }

  // Then check GrowthBook cache
  const gbCached = config.cachedGrowthBookFeatures?.[gate]
  if (gbCached !== undefined) {
    return Boolean(gbCached)
  }

  // No cache - return false (don't block on init for uncached gates)
  return false
}

/**
 * Check a boolean entitlement gate with fallback-to-blocking semantics.
 *
 * Fast path: if the disk cache already says `true`, return it immediately.
 * Slow path: if disk says `false`/missing, await GrowthBook init and fetch the
 * fresh server value (max ~5s). Disk is populated by syncRemoteEvalToDisk
 * inside init, so by the time the slow path returns, disk already has the
 * fresh value — no write needed here.
 *
 * Use for user-invoked features (e.g. /remote-control) that are gated on
 * subscription/org, where a stale `false` would unfairly block access but a
 * stale `true` is acceptable (the server is the real gatekeeper).
 */
// 【第 904-935 行】`checkGate_CACHED_OR_BLOCKING` 是「**快速路径 / 慢速路径**」语义的范本：
//     - 磁盘缓存已是 `true` → 立即返回 true（信任缓存，因为服务端才是真正守门人）
//     - 磁盘是 `false` / 缺失 → 可能过期，才 `await` 取服务端新鲜值
//     注释解释为什么 `true` 可以信、`false` 不能信：对一个「按订阅/org 门控的用户功能」来说，
//     **过期的 false 会不公平地拦住用户**，过期的 true 只是让本该被拦的提前用一下（服务端会再拦）。
//     这是「stale-while-false-blocking」—— 只对失败方向做阻塞补偿。
export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    return false
  }

  // Fast path: disk cache already says true — trust it
  const cached = getGlobalConfig().cachedGrowthBookFeatures?.[gate]
  if (cached === true) {
    // Log experiment exposure if data is available, otherwise defer
    if (experimentDataByFeature.has(gate)) {
      logExposureForFeature(gate)
    } else {
      pendingExposures.add(gate)
    }
    return true
  }

  // Slow path: disk says false/missing — may be stale, fetch fresh
  return getFeatureValueInternal(gate, false, true)
}

// 【第 937-982 行】`refreshGrowthBookAfterAuthChange` 必须在 auth 变化（登录/登出）时**销毁并重建**客户端：
//     因为 GrowthBook 的 `apiHostRequestHeaders` 创建后不能改。第 953-959 行的细节很关键：
//     `resetGrowthBook` 清空了 `remoteEvalFeatureValues`，如果后续重建超时或登出短路，init-callback 的通知永远不触发，
//     订阅者会卡在「上一个账号的缓存状态」—— 所以这里**手动再 emit 一次**，至少让它们同步到重置后的状态。
//     第 963-975 行：`.catch` 要写在 `.finally` **之前**，否则 `initializeGrowthBook` 的同步 helper 抛错会
//     被 `.finally` 重新 settle 成原始 rejection，而外层同步 try/catch 抓不到异步 reject。
/**
 * Refresh GrowthBook after auth changes (login/logout).
 *
 * NOTE: This must destroy and recreate the client because GrowthBook's
 * apiHostRequestHeaders cannot be updated after client creation.
 */
export function refreshGrowthBookAfterAuthChange(): void {
  if (!isGrowthBookEnabled()) {
    return
  }

  try {
    // Reset the client completely to get fresh auth headers
    // This is necessary because apiHostRequestHeaders can't be updated after creation
    resetGrowthBook()

    // resetGrowthBook cleared remoteEvalFeatureValues. If re-init below
    // times out (hadFeatures=false) or short-circuits on !hasAuth (logout),
    // the init-callback notify never fires — subscribers stay synced to the
    // previous account's memoized state. Notify here so they re-read now
    // (falls to disk cache). If re-init succeeds, they'll notify again with
    // fresh values; if not, at least they're synced to the post-reset state.
    refreshed.emit()

    // Reinitialize with fresh auth headers and attributes
    // Track this promise so security gate checks can wait for it.
    // .catch before .finally: initializeGrowthBook can reject if its sync
    // helpers throw (getGrowthBookClient, getAuthHeaders, resetGrowthBook —
    // clientWrapper.initialized itself has its own .catch so never rejects),
    // and .finally re-settles with the original rejection — the sync
    // try/catch below cannot catch async rejections.
    reinitializingPromise = initializeGrowthBook()
      .catch(error => {
        logError(toError(error))
        return null
      })
      .finally(() => {
        reinitializingPromise = null
      })
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      throw error
    }
    logError(toError(error))
  }
}

/**
 * Reset GrowthBook client state (primarily for testing)
 */
export function resetGrowthBook(): void {
  stopPeriodicGrowthBookRefresh()
  // Remove process handlers before destroying client to prevent accumulation
  if (currentBeforeExitHandler) {
    process.off('beforeExit', currentBeforeExitHandler)
    currentBeforeExitHandler = null
  }
  if (currentExitHandler) {
    process.off('exit', currentExitHandler)
    currentExitHandler = null
  }
  client?.destroy()
  client = null
  clientCreatedWithAuth = false
  reinitializingPromise = null
  experimentDataByFeature.clear()
  pendingExposures.clear()
  loggedExposures.clear()
  remoteEvalFeatureValues.clear()
  getGrowthBookClient.cache?.clear?.()
  initializeGrowthBook.cache?.clear?.()
  envOverrides = null
  envOverridesParsed = false
}

// Periodic refresh interval (matches Statsig's 6-hour interval)
// 【第 1012-1024 行】周期刷新间隔：外部构建 **6 小时**、ant **20 分钟**。
//     注释说「匹配 Statsig 的 6 小时间隔」—— 又是和迁移前的旧 SDK 对齐。`refreshInterval.unref?.()`（第 1101 行）
//     让这个定时器**不阻止进程正常退出**：长驻会话才需要它，临时 `claude -p` 不该因为它赖着不走。
const GROWTHBOOK_REFRESH_INTERVAL_MS =
  process.env.USER_TYPE !== 'ant'
    ? 6 * 60 * 60 * 1000 // 6 hours
    : 20 * 60 * 1000 // 20 min (for ants)
let refreshInterval: ReturnType<typeof setInterval> | null = null
let beforeExitListener: (() => void) | null = null

/**
 * Light refresh - re-fetch features from server without recreating client.
 * Use this for periodic refresh when auth headers haven't changed.
 *
 * Unlike refreshGrowthBookAfterAuthChange() which destroys and recreates the client,
 * this preserves client state and just fetches fresh feature values.
 */
export async function refreshGrowthBookFeatures(): Promise<void> {
  if (!isGrowthBookEnabled()) {
    return
  }

  try {
    const growthBookClient = await initializeGrowthBook()
    if (!growthBookClient) {
      return
    }

    await growthBookClient.refreshFeatures()

    // Guard: if this client was replaced during the in-flight refresh
    // (e.g. refreshGrowthBookAfterAuthChange ran), skip processing the
    // stale payload. Mirrors the init-callback guard above.
    if (growthBookClient !== client) {
      if (process.env.USER_TYPE === 'ant') {
        logForDebugging(
          'GrowthBook: Skipping refresh processing for replaced client',
        )
      }
      return
    }

    // Rebuild remoteEvalFeatureValues from the refreshed payload so that
    // _BLOCKS_ON_INIT callers (e.g. getMaxVersion for the auto-update kill
    // switch) see fresh values, not the stale init-time snapshot.
    const hadFeatures = await processRemoteEvalPayload(growthBookClient)
    // Same re-check as init path: covers the setPayload yield inside
    // processRemoteEvalPayload (the guard above only covers refreshFeatures).
    if (growthBookClient !== client) return

    if (process.env.USER_TYPE === 'ant') {
      logForDebugging('GrowthBook: Light refresh completed')
    }

    // Gate on hadFeatures: if the payload was empty/malformed,
    // remoteEvalFeatureValues wasn't rebuilt — skip both the no-op disk
    // write and the spurious subscriber churn (clearCommandMemoizationCaches
    // + getCommands + 4× model re-renders).
    if (hadFeatures) {
      syncRemoteEvalToDisk()
      refreshed.emit()
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      throw error
    }
    logError(toError(error))
  }
}

/**
 * Set up periodic refresh of GrowthBook features.
 * Uses light refresh (refreshGrowthBookFeatures) to re-fetch without recreating client.
 *
 * Call this after initialization for long-running sessions to ensure
 * feature values stay fresh. Matches Statsig's 6-hour refresh interval.
 */
export function setupPeriodicGrowthBookRefresh(): void {
  if (!isGrowthBookEnabled()) {
    return
  }

  // Clear any existing interval to avoid duplicates
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }

  refreshInterval = setInterval(() => {
    void refreshGrowthBookFeatures()
  }, GROWTHBOOK_REFRESH_INTERVAL_MS)
  // Allow process to exit naturally - this timer shouldn't keep the process alive
  refreshInterval.unref?.()

  // Register cleanup listener only once
  if (!beforeExitListener) {
    beforeExitListener = () => {
      stopPeriodicGrowthBookRefresh()
    }
    process.once('beforeExit', beforeExitListener)
  }
}

/**
 * Stop periodic refresh (for testing or cleanup)
 */
export function stopPeriodicGrowthBookRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  if (beforeExitListener) {
    process.removeListener('beforeExit', beforeExitListener)
    beforeExitListener = null
  }
}

// ============================================================================
// Dynamic Config Functions
// These are semantic wrappers around feature functions for Statsig API parity.
// In GrowthBook, dynamic configs are just features with object values.
// ============================================================================

/**
 * Get a dynamic config value - blocks until GrowthBook is initialized.
 * Prefer getFeatureValue_CACHED_MAY_BE_STALE for startup-critical paths.
 */
// 【第 1132-1155 行】文件末尾是一组「动态配置」语义封装：
//     `getDynamicConfig_BLOCKS_ON_INIT` 就是 `getFeatureValue_DEPRECATED` 的别名（Statsig API 兼容性），
//     `getDynamicConfig_CACHED_MAY_BE_STALE` 就是 `getFeatureValue_CACHED_MAY_BE_STALE` 的别名。
//     注释说「在 GrowthBook 里，动态配置只是带对象值的 feature」—— 这些 wrapper 纯粹是为了让调用方代码
//     读起来像 Statsig（平滑迁移），**没有额外逻辑**。整个文件反复出现 `@deprecated` 标记，都在记录这场迁移。
export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValue_DEPRECATED(configName, defaultValue)
}

/**
 * Get a dynamic config value from disk cache immediately. Pure read — see
 * getFeatureValue_CACHED_MAY_BE_STALE.
 * This is the preferred method for startup-critical paths and sync contexts.
 *
 * In GrowthBook, dynamic configs are just features with object values.
 */
export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(configName, defaultValue)
}
