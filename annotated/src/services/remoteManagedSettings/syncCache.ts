/**
 * Eligibility check for remote managed settings.
 *
 * The cache state itself lives in syncCacheState.ts (a leaf, no auth import).
 * This file keeps isRemoteManagedSettingsEligible — the one function that
 * needs auth.ts — plus resetSyncCache wrapped to clear the local eligibility
 * mirror alongside the leaf's state.
 */

import { CLAUDE_AI_INFERENCE_SCOPE } from '../../constants/oauth.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'

import {
  resetSyncCache as resetLeafCache,
  setEligibility,
} from './syncCacheState.js'

// 这个文件是「资格判定 + 本地镜像」的拆分产物：缓存状态本身在 syncCacheState.ts（叶子，不 import auth），
// 这里只留 isRemoteManagedSettingsEligible——全子系统唯一需要碰 auth.ts 的函数。
// 拆开的原因见 syncCacheState.ts 文件头：不断环的话 settings.ts 的依赖链会把几百个模块拖进启动期求值的 SCC。
let cached: boolean | undefined

export function resetSyncCache(): void {
  cached = undefined
  resetLeafCache()
}
// resetSyncCache 清两份：本文件的 cached 镜像 + 叶子的 sessionCache/eligible。
// 两份不同步就会出现「判定结果还记得、缓存内容已丢」的撕裂状态，所以包一层统一下发。

/**
 * Check if the current user is eligible for remote managed settings
 *
 * Eligibility:
 * - Console users (API key): All eligible (must have actual key, not just apiKeyHelper)
 * - OAuth users with known subscriptionType: Only Enterprise/C4E and Team
 * - OAuth users with subscriptionType === null (externally-injected tokens via
 *   CLAUDE_CODE_OAUTH_TOKEN / FD, or keychain tokens missing metadata): Eligible —
 *   the API returns empty settings for ineligible orgs, so the cost of a false
 *   positive is one round-trip
 *
 * This is a pre-check to determine if we should query the API.
 * The API will return empty settings for users without managed settings.
 *
 * IMPORTANT: This function must NOT call getSettings() or any function that calls
 * getSettings() to avoid circular dependencies during settings loading.
 */
// isRemoteManagedSettingsEligible 是全子系统的总闸——文件头的 docblock 列了资格规则，
// 并留了一条硬约束：**不许调 getSettings() 或任何会调到它的函数**（设置加载链路里触发循环依赖）。
// 判定结果写进模块级 cached，一次进程只算一遍。
export function isRemoteManagedSettingsEligible(): boolean {
  if (cached !== undefined) return cached

  // 3p provider users should not hit the settings endpoint
  if (getAPIProvider() !== 'firstParty') {
    return (cached = setEligibility(false))
  }
// 第一道早退：3p provider 用户（Bedrock/Vertex/自定义网关）不配 hit 这个端点——
// 设置端点是一方服务，别的 provider 用户打过去只会 401。

  // Custom base URL users should not hit the settings endpoint
  if (!isFirstPartyAnthropicBaseUrl()) {
    return (cached = setEligibility(false))
  }
// 第二道：自定义 base URL 同样挡掉。理由同上——endpoint 拼在一方 BASE_API_URL 后面，
// 用户换过 base URL 就说明人不在一方环境里。

  // Cowork runs in a VM with its own permission model; server-managed settings
  // (designed for CLI/CCD) don't apply there, and per-surface settings don't
  // exist yet. MDM/file-based managed settings still apply via settings.ts —
  // those require physical deployment and a different IT intent.
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') {
    return (cached = setEligibility(false))
  }
// 第三道：CLAUDE_CODE_ENTRYPOINT === 'local-agent'（Cowork，跑在有自己的权限模型的 VM 里）。
// 服务端托管设置是为 CLI/CCD 设计的，在 Cowork 语义不匹配；且 per-surface 设置还不存在。
// 注意注释特意说明：MDM/文件式托管设置**仍然生效**——那些走 settings.ts 的另一条路，
// 需要物理部署，IT 意图不同。这道闸门只拦服务端下发这一路。

  // Check OAuth first: most Claude.ai users have no API key in the keychain.
  // The API key check spawns `security find-generic-password` (~20-50ms) which
  // returns null for OAuth-only users. Checking OAuth first short-circuits
  // that subprocess for the common case.
  const tokens = getClaudeAIOAuthTokens()

  // Externally-injected tokens (CCD via CLAUDE_CODE_OAUTH_TOKEN, CCR via
  // CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, Agent SDK, CI) carry no
  // subscriptionType metadata — getClaudeAIOAuthTokens() constructs them with
  // subscriptionType: null. The token itself is valid; let the API decide.
  // fetchRemoteManagedSettings handles 204/404 gracefully (returns {}), and
  // settings.ts falls through to MDM/file when remote is empty, so ineligible
  // orgs pay one round-trip and nothing else changes.
  if (tokens?.accessToken && tokens.subscriptionType === null) {
    return (cached = setEligibility(true))
  }
// 外部注入的 token 放行：CLAUDE_CODE_OAUTH_TOKEN / _FILE_DESCRIPTOR（CCD）、Agent SDK、CI——
// 这些 token 是调用方塞进来的，不带 subscriptionType metadata（构造时就是 null）。
// token 本身有效，所以让 API 裁决：fetchRemoteManagedSettings 对 204/404 返回 {}，
// settings.ts 在远程为空时落到 MDM/文件设置。假阳性的成本是一次往返，换来不漏配。

  if (
    tokens?.accessToken &&
    tokens.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE) &&
    (tokens.subscriptionType === 'enterprise' ||
      tokens.subscriptionType === 'team')
  ) {
    return (cached = setEligibility(true))
  }
// 标准 OAuth 路径：有 accessToken、带 inference scope、订阅是 enterprise 或 team 才 eligible。
// scope 检查是防「有 token 但这个 token 不是干这个的」——CLAUDE_AI_INFERENCE_SCOPE 是推理权限的标记。

  // Console users (API key) are eligible if we can get the actual key
  // Skip apiKeyHelper to avoid circular dependency with getSettings()
  // Wrap in try-catch because getAnthropicApiKeyWithSource throws in CI/test environments
  // when no API key is available
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return (cached = setEligibility(true))
    }
  } catch {
    // No API key available (e.g., CI/test environment)
  }
// 最后试 Console 用户路径：拿到真 API key 就 eligible。同样 skipApiKeyHelper（断环）+ try-catch（CI 抛错）。
// 顺序上 OAuth 先查是性能考虑：多数 Claude.ai 用户 keychain 里没有 API key，
// 而 getAnthropicApiKeyWithSource 会 spawn 一个 security find-generic-password 子进程（约 20-50ms）——
// 先查 OAuth 能让这波人短路掉这个子进程。

  return (cached = setEligibility(false))
}
// 兜底 false，同时把结果写进 cached（和 setEligibility 的 leaf 镜像）。
// return (cached = setEligibility(x)) 这个惯用法全函数复用：一行同时完成「算一次、存两份」。
