/**
 * Preconnect to the Anthropic API to overlap TCP+TLS handshake with startup.
 *
 * The TCP+TLS handshake is ~100-200ms that normally blocks inside the first
 * API call. Kicking a fire-and-forget fetch during init lets the handshake
 * happen in parallel with action-handler work (~100ms of setup/commands/mcp
 * before the API request in -p mode; unbounded "user is typing" window in
 * interactive mode).
 *
 * Bun's fetch shares a keep-alive connection pool globally, so the real API
 * request reuses the warmed connection.
 *
 * Called from init.ts AFTER applyExtraCACertsFromConfig() + configureGlobalAgents()
 * so settings.json env vars are applied and the TLS cert store is finalized.
 * The early cli.tsx call site was removed — it ran before settings.json loaded,
 * so ANTHROPIC_BASE_URL/proxy/mTLS in settings would be invisible and preconnect
 * would warm the wrong pool (or worse, lock BoringSSL's cert store before
 * NODE_EXTRA_CA_CERTS was applied).
 *
 * Skipped when:
 * - proxy/mTLS/unix socket configured (preconnect would use wrong transport —
 *   the SDK passes a custom dispatcher/agent that doesn't share the global pool)
 * - Bedrock/Vertex/Foundry (different endpoints, different auth)
 */
// 在启动时预先连接 Anthropic API，把 TCP 加 TLS 握手与初始化工作并行，缩短首个请求的真实延迟；Bun 会复用全局保活连接池。

import { getOauthConfig } from '../constants/oauth.js'
import { isEnvTruthy } from './envUtils.js'

let fired = false
// `fired` 是一次性旗标，保证预热只触发一次，避免重复发起无意义的连接。

// `preconnectAnthropicApi` 在诸多跳过条件下直接返回：已触发、使用云厂商后端、或配了代理与双向认证等自定义传输。
export function preconnectAnthropicApi(): void {
  if (fired) return
  fired = true

  // Skip if using a cloud provider — different endpoint + auth
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
  ) {
    return
  }
  // Skip if proxy/mTLS/unix — SDK's custom dispatcher won't reuse this pool
  if (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ANTHROPIC_UNIX_SOCKET ||
    process.env.CLAUDE_CODE_CLIENT_CERT ||
    process.env.CLAUDE_CODE_CLIENT_KEY
  ) {
    return
  }

  // Use configured base URL (staging, local, or custom gateway). Covers
  // ANTHROPIC_BASE_URL env + USE_STAGING_OAUTH + USE_LOCAL_OAUTH in one lookup.
  // NODE_EXTRA_CA_CERTS no longer a skip — init.ts applied it before this fires.
  const baseUrl =
    process.env.ANTHROPIC_BASE_URL || getOauthConfig().BASE_API_URL
// 基址优先用环境变量 `ANTHROPIC_BASE_URL`，否则回落到 OAuth 配置里的 API 基址，一次查找覆盖预发、本地与自定义网关。

  // Fire and forget. HEAD means no response body — the connection is eligible
  // for keep-alive pool reuse immediately after headers arrive. 10s timeout
  // so a slow network doesn't hang the process; abort is fine since the real
  // request will handshake fresh if needed.
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  void fetch(baseUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}
// 用 HEAD 请求发起即弃：无响应体、握手一完成即可入池复用；十秒超时防止弱网拖垮进程，超时也无妨，真实请求会重新握手。
