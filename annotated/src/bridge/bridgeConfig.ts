/**
 * Shared bridge auth/URL resolution. Consolidates the ant-only
 * CLAUDE_BRIDGE_* dev overrides that were previously copy-pasted across
 * a dozen files — inboundAttachments, BriefTool/upload, bridgeMain,
 * initReplBridge, remoteBridgeCore, daemon workers, /rename,
 * /remote-control.
 *
 * Two layers: *Override() returns the ant-only env var (or undefined);
 * the non-Override versions fall through to the real OAuth store/config.
 * Callers that compose with a different auth source (e.g. daemon workers
 * using IPC auth) use the Override getters directly.
 */
// 文件头注释：集中管理 bridge 鉴权与 URL 解析，消除十余处重复的蚂蚁内部环境变量覆盖。

import { getOauthConfig } from '../constants/oauth.js'
// 引入 OAuth 配置与令牌读取工具。
import { getClaudeAIOAuthTokens } from '../utils/auth.js'

/** Ant-only dev override: CLAUDE_BRIDGE_OAUTH_TOKEN, else undefined. */
export function getBridgeTokenOverride(): string | undefined {
// 蚂蚁内部开发覆盖：仅当 USER_TYPE 为 ant 且设了 CLAUDE_BRIDGE_OAUTH_TOKEN 时返回该值，否则 undefined。
  return (
    (process.env.USER_TYPE === 'ant' &&
      process.env.CLAUDE_BRIDGE_OAUTH_TOKEN) ||
    undefined
  )
}

/** Ant-only dev override: CLAUDE_BRIDGE_BASE_URL, else undefined. */
export function getBridgeBaseUrlOverride(): string | undefined {
// 蚂蚁内部开发覆盖：返回 CLAUDE_BRIDGE_BASE_URL 或 undefined。
  return (
    (process.env.USER_TYPE === 'ant' && process.env.CLAUDE_BRIDGE_BASE_URL) ||
    undefined
  )
}

/**
 * Access token for bridge API calls: dev override first, then the OAuth
 * keychain. Undefined means "not logged in".
 */
// 注释：bridge API 访问令牌的解析优先级——开发覆盖优先，否则回退到 OAuth 钥匙串。
export function getBridgeAccessToken(): string | undefined {
// 导出访问令牌解析函数：undefined 表示未登录。
  return getBridgeTokenOverride() ?? getClaudeAIOAuthTokens()?.accessToken
// 令牌解析：覆盖值优先，缺失时回退到 OAuth 钥匙串的访问令牌。
}

/**
 * Base URL for bridge API calls: dev override first, then the production
 * OAuth config. Always returns a URL.
 */
// 注释：bridge API base URL 的解析优先级——开发覆盖优先，否则用生产 OAuth 配置，始终返回有效 URL。
export function getBridgeBaseUrl(): string {
// 导出 base URL 解析函数。
  return getBridgeBaseUrlOverride() ?? getOauthConfig().BASE_API_URL
// 优先用开发覆盖，否则回退到生产 OAuth 配置。
}
