/**
 * Telemetry for plugin/marketplace fetches that hit the network.
 *
 * Added for inc-5046 (GitHub complained about claude-plugins-official load).
 * Before this, fetch operations only had logForDebugging — no way to measure
 * actual network volume. This surfaces what's hitting GitHub vs GCS vs
 * user-hosted so we can see the GCS migration take effect and catch future
 * hot-path regressions before GitHub emails us again.
 *
 * Volume: these fire at startup (install-counts 24h-TTL)
 * and on explicit user action (install/update). NOT per-interaction. Similar
 * envelope to tengu_binary_download_*.
 */

import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS as SafeString,
} from '../../services/analytics/index.js'
import { OFFICIAL_MARKETPLACE_NAME } from './officialMarketplace.js'
// 导入遥测上报与官方市场名常量，用于统计插件/市场网络拉取。

export type PluginFetchSource =
  | 'install_counts'
  | 'marketplace_clone'
  | 'marketplace_pull'
  | 'marketplace_url'
  | 'plugin_clone'
  | 'mcpb'

export type PluginFetchOutcome = 'success' | 'failure' | 'cache_hit'
// 两类枚举：拉取来源（安装计数、市场克隆、插件克隆等）与拉取结果（成功、失败、命中缓存）。

// Allowlist of public hosts we report by name. Anything else (enterprise
// git, self-hosted, internal) is bucketed as 'other' — we don't want
// internal hostnames (git.mycorp.internal) landing in telemetry. Bounded
// cardinality also keeps the dashboard host-breakdown tractable.
const KNOWN_PUBLIC_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'gist.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
  'dev.azure.com',
  'ssh.dev.azure.com',
  'storage.googleapis.com', // GCS — where Dickson's migration points
])
// 公开主机白名单：只按名上报这些公共主机，企业内部或自托管主机统一归为 other，避免泄漏内部主机名。

/**
 * Extract hostname from a URL or git spec and bucket to the allowlist.
 * Handles `https://host/...`, `git@host:path`, `ssh://host/...`.
 * Returns a known public host, 'other' (parseable but not allowlisted —
 * don't leak private hostnames), or 'unknown' (unparseable / local path).
 */
function extractHost(urlOrSpec: string): string {
  let host: string
  const scpMatch = /^[^@/]+@([^:/]+):/.exec(urlOrSpec)
  if (scpMatch) {
    host = scpMatch[1]!
  } else {
    try {
      host = new URL(urlOrSpec).hostname
    } catch {
      return 'unknown'
    }
  }
  const normalized = host.toLowerCase()
  return KNOWN_PUBLIC_HOSTS.has(normalized) ? normalized : 'other'
}
// extractHost：从 URL 或 git 规格里抽出主机名并按白名单归类，无法解析或本地路径归为 unknown。

/**
 * True if the URL/spec points at anthropics/claude-plugins-official — the
 * repo GitHub complained about. Lets the dashboard separate "our problem"
 * traffic from user-configured marketplaces.
 */
function isOfficialRepo(urlOrSpec: string): boolean {
  return urlOrSpec.includes(`anthropics/${OFFICIAL_MARKETPLACE_NAME}`)
}
// isOfficialRepo：判断是否指向官方插件仓库（GitHub 投诉过的那个），便于在面板里把「我们的问题」和用户市场分开。

export function logPluginFetch(
  source: PluginFetchSource,
  urlOrSpec: string | undefined,
  outcome: PluginFetchOutcome,
  durationMs: number,
  errorKind?: string,
): void {
  // String values are bounded enums / hostname-only — no code, no paths,
  // no raw error messages. Same privacy envelope as tengu_web_fetch_host.
  logEvent('tengu_plugin_remote_fetch', {
    source: source as SafeString,
    host: (urlOrSpec ? extractHost(urlOrSpec) : 'unknown') as SafeString,
    is_official: urlOrSpec ? isOfficialRepo(urlOrSpec) : false,
    outcome: outcome as SafeString,
    duration_ms: Math.round(durationMs),
    ...(errorKind && { error_kind: errorKind as SafeString }),
  })
}
// logPluginFetch：上报一次拉取遥测，字段只含受限枚举与主机名，不含代码、路径或原始报错，与既有隐私口径一致。

/**
 * Classify an error into a stable bucket for the error_kind field. Keeps
 * cardinality bounded — raw error messages would explode dashboard grouping.
 *
 * Handles both axios Error objects (Node.js error codes like ENOTFOUND) and
 * git stderr strings (human phrases like "Could not resolve host"). DNS
 * checked BEFORE timeout because gitClone's error enhancement at
 * marketplaceManager.ts:~950 rewrites DNS failures to include the word
 * "timeout" — ordering the other way would misclassify git DNS as timeout.
 */
export function classifyFetchError(error: unknown): string {
  const msg = String((error as { message?: unknown })?.message ?? error)
  if (
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|Could not resolve host|Connection refused/i.test(
      msg,
    )
  ) {
    return 'dns_or_refused'
  }
  if (/ETIMEDOUT|timed out|timeout/i.test(msg)) return 'timeout'
  if (
    /ECONNRESET|socket hang up|Connection reset by peer|remote end hung up/i.test(
      msg,
    )
  ) {
    return 'conn_reset'
  }
  if (/403|401|authentication|permission denied/i.test(msg)) return 'auth'
  if (/404|not found|repository not found/i.test(msg)) return 'not_found'
  if (/certificate|SSL|TLS|unable to get local issuer/i.test(msg)) return 'tls'
  // Schema validation throws "Invalid response format" (install_counts) —
  // distinguish from true unknowns so the dashboard can
  // see "server sent garbage" separately.
  if (/Invalid response format|Invalid marketplace schema/i.test(msg)) {
    return 'invalid_schema'
  }
  return 'other'
}
// classifyFetchError：把错误归到稳定的桶（DNS、超时、连接重置、鉴权、未找到、TLS、非法结构、其它），控制维度基数；DNS 判定排在超时前以免被改写后的措辞误分类。
