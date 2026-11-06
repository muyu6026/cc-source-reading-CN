import axios from 'axios'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import type { WorkSecret } from './types.js'

// 凭据是 base64url 编码的 JSON：解码后逐项校验，任何一项不合规就直接抛，不做「尽力而为」
/** Decode a base64url-encoded work secret and validate its version. */
export function decodeWorkSecret(secret: string): WorkSecret {
  const json = Buffer.from(secret, 'base64url').toString('utf-8')
  const parsed: unknown = jsonParse(json)
// 版本号先查：格式真要变的时候，宁可明确拒绝，也不要按旧结构从新字段里读出别的意思
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('version' in parsed) ||
    parsed.version !== 1
  ) {
    throw new Error(
      `Unsupported work secret version: ${parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : 'unknown'}`,
    )
  }
// 过了版本检查再转成索引类型：这时已确认是对象
  const obj = parsed as Record<string, unknown>
// 令牌必须是非空字符串：空串与缺失在服务端是两种错误，在这里都不可用
  if (
    typeof obj.session_ingress_token !== 'string' ||
    obj.session_ingress_token.length === 0
  ) {
    throw new Error(
      'Invalid work secret: missing or empty session_ingress_token',
    )
  }
// 基址只校验类型不校验形状：它可能是内网地址，格式判断交给使用方
  if (typeof obj.api_base_url !== 'string') {
    throw new Error('Invalid work secret: missing api_base_url')
  }
  return parsed as WorkSecret
}

/**
 * Build a WebSocket SDK URL from the API base URL and session ID.
 * Strips the HTTP(S) protocol and constructs a ws(s):// ingress URL.
 *
 * Uses /v2/ for localhost (direct to session-ingress, no Envoy rewrite)
 * and /v1/ for production (Envoy rewrites /v1/ → /v2/).
 */
// 本地与生产的路径版本不同：本地直连会话入口用新版，生产走旧版由网关重写
export function buildSdkUrl(apiBaseUrl: string, sessionId: string): string {
  const isLocalhost =
    apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1')
  const protocol = isLocalhost ? 'ws' : 'wss'
  const version = isLocalhost ? 'v2' : 'v1'
// 先剥协议再剥尾部斜杠：顺序反了会让带斜杠的地址留下一个空段
  const host = apiBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`
}

/**
 * Compare two session IDs regardless of their tagged-ID prefix.
 *
 * Tagged IDs have the form {tag}_{body} or {tag}_staging_{body}, where the
 * body encodes a UUID. CCR v2's compat layer returns `session_*` to v1 API
 * clients (compat/convert.go:41) but the infrastructure layer (sandbox-gateway
 * work queue, work poll response) uses `cse_*` (compat/CLAUDE.md:13). Both
 * have the same underlying UUID.
 *
 * Without this, replBridge rejects its own session as "foreign" at the
 * work-received check when the ccr_v2_compat_enabled gate is on.
 */
// 两套标签指向同一个底层 id：兼容层给旧客户端返回一种前缀，基础设施层用另一种
export function sameSessionId(a: string, b: string): boolean {
  if (a === b) return true
  // The body is everything after the last underscore — this handles both
  // `{tag}_{body}` and `{tag}_staging_{body}`.
// 按最后一个下划线切：这样带中间段的写法也能取到主体
  const aBody = a.slice(a.lastIndexOf('_') + 1)
  const bBody = b.slice(b.lastIndexOf('_') + 1)
  // Guard against IDs with no underscore (bare UUIDs): lastIndexOf returns -1,
  // slice(0) returns the whole string, and we already checked a === b above.
  // Require a minimum length to avoid accidental matches on short suffixes
  // (e.g. single-char tag remnants from malformed IDs).
// 短后缀不算匹配：畸形 id 切出来的残片可能意外相等，长度下限是最便宜的护栏
  return aBody.length >= 4 && aBody === bBody
}

/**
 * Build a CCR v2 session URL from the API base URL and session ID.
 * Unlike buildSdkUrl, this returns an HTTP(S) URL (not ws://) and points at
 * /v1/code/sessions/{id} — the child CC will derive the SSE stream path
 * and worker endpoints from this base.
 */
// 这份返回 HTTP 地址而不是 ws 地址：子进程要从这个基址自己推导流与心跳路径
export function buildCCRv2SdkUrl(
  apiBaseUrl: string,
  sessionId: string,
): string {
  const base = apiBaseUrl.replace(/\/+$/, '')
  return `${base}/v1/code/sessions/${sessionId}`
}

/**
 * Register this bridge as the worker for a CCR v2 session.
 * Returns the worker_epoch, which must be passed to the child CC process
 * so its CCRClient can include it in every heartbeat/state/event request.
 *
 * Mirrors what environment-manager does in the container path
 * (api-go/environment-manager/cmd/cmd_task_run.go RegisterWorker).
 */
// 注册即占位：返回的世代号必须传给子进程，之后每次心跳、状态与事件都带着它
export async function registerWorker(
  sessionUrl: string,
  accessToken: string,
): Promise<number> {
// 请求体是空对象：参数全在路径与请求头里
  const response = await axios.post(
    `${sessionUrl}/worker/register`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      timeout: 10_000,
    },
  )
// 世代号可能是字符串也可能是数字：序列化库会把六十四位整数转成字符串以免丢精度
  // protojson serializes int64 as a string to avoid JS number precision loss;
  // the Go side may also return a number depending on encoder settings.
  const raw = response.data?.worker_epoch
  const epoch = typeof raw === 'string' ? Number(raw) : raw
// 三项校验缺一不可：不是数字、不是有限值、超出安全整数范围，任何一种都会让后续心跳带上错值
  if (
    typeof epoch !== 'number' ||
    !Number.isFinite(epoch) ||
    !Number.isSafeInteger(epoch)
  ) {
    throw new Error(
      `registerWorker: invalid worker_epoch in response: ${jsonStringify(response.data)}`,
    )
  }
  return epoch
}
