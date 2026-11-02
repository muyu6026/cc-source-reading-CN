// 模块总述：推断当前运行所使用的 API provider（一手 Anthropic / Bedrock / Vertex / Foundry），并提供一手 Anthropic base URL 的校验。
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'
// APIProvider 联合类型：四类 provider 的枚举值，决定后续走哪条请求链路。

// getAPIProvider：按 bedrock → vertex → foundry 的优先级，用环境变量逐一判定，均不满足时回退一手 Anthropic。
export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

// getAPIProviderForStatsig：把 provider 结果 cast 成 Statsig 上报所需的遥测元数据类型，仅做类型桥接。
export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
// isFirstPartyAnthropicBaseUrl：未设置 `ANTHROPIC_BASE_URL`（默认一手）或指向 `api.anthropic.com`（内网用户额外含 `api-staging`）时视为一手地址。
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
// catch 兜底：URL 解析异常（格式非法等）一律按非一手地址返回 false，避免漏判。
    return false
  }
}
