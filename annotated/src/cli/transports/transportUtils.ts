import { URL } from 'url'
// 引入 URL、环境变量布尔判定与各传输实现类。
import { isEnvTruthy } from '../../utils/envUtils.js'
import { HybridTransport } from './HybridTransport.js'
import { SSETransport } from './SSETransport.js'
import type { Transport } from './Transport.js'
import { WebSocketTransport } from './WebSocketTransport.js'

/**
 * Helper function to get the appropriate transport for a URL.
 *
 * Transport selection priority:
 * 1. SSETransport (SSE reads + POST writes) when CLAUDE_CODE_USE_CCR_V2 is set
 * 2. HybridTransport (WS reads + POST writes) when CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2 is set
 * 3. WebSocketTransport (WS reads + WS writes) — default
 */
// 注释：根据 URL 与开关选择适当传输层的辅助函数，并给出传输选择优先级（SSE > Hybrid > WebSocket）。
export function getTransportForUrl(
// 导出 getTransportForUrl：按协议与环境变量挑选传输实现。
  url: URL,
  headers: Record<string, string> = {},
  sessionId?: string,
  refreshHeaders?: () => Record<string, string>,
): Transport {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_CCR_V2)) {
// v2 开关（CLAUDE_CODE_USE_CCR_V2）：启用时走 SSE 读 + HTTP POST 写。
    // v2: SSE for reads, HTTP POST for writes
    // --sdk-url is the session URL (.../sessions/{id});
    // derive the SSE stream URL by appending /worker/events/stream
// 注释：--sdk-url 是会话 URL，需追加 /worker/events/stream 派生 SSE 流地址。
    const sseUrl = new URL(url.href)
// 克隆 URL 以便改写协议与路径。
    if (sseUrl.protocol === 'wss:') {
// ws/wss 协议需降级为 https/http 以走 SSE。
      sseUrl.protocol = 'https:'
    } else if (sseUrl.protocol === 'ws:') {
      sseUrl.protocol = 'http:'
    }
    sseUrl.pathname =
      sseUrl.pathname.replace(/\/$/, '') + '/worker/events/stream'
// 改写路径名、追加 SSE 流端点。
    return new SSETransport(sseUrl, headers, sessionId, refreshHeaders)
// 返回 SSE 传输实例。
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
// 默认分支：处理 ws/wss 协议。
    if (isEnvTruthy(process.env.CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2)) {
// 第二开关（CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2）：启用时走 WS 读 + POST 写。
      return new HybridTransport(url, headers, sessionId, refreshHeaders)
    }
    return new WebSocketTransport(url, headers, sessionId, refreshHeaders)
// 默认 WebSocket 传输：WS 读 + WS 写。
  } else {
    throw new Error(`Unsupported protocol: ${url.protocol}`)
// 其余协议不支持，抛出错误。
  }
}
