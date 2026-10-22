// Anthropic voice_stream speech-to-text client for push-to-talk.
//
// Only reachable in ant builds (gated by feature('VOICE_MODE') in useVoice.ts import).
//
// Connects to Anthropic's voice_stream WebSocket endpoint using the same
// OAuth credentials as Claude Code.  The endpoint uses conversation_engine
// backed models for speech-to-text.  Designed for hold-to-talk: hold the
// keybinding to record, release to stop and submit.
//
// The wire protocol uses JSON control messages (KeepAlive, CloseStream) and
// binary audio frames.  The server responds with TranscriptText and
// TranscriptEndpoint JSON messages.
// 模块定位：Anthropic `voice_stream` 的流式语音转写客户端，只服务按住说话。只在 ant 构建里可达（`useVoice.ts` 的 import 处用 `feature('VOICE_MODE')` 门控）。用与 Claude Code 相同的 OAuth 凭据连 WebSocket，服务端走 conversation_engine 背后的 STT 模型。协议：客户端发 JSON 控制消息（KeepAlive / CloseStream）+ 二进制音频帧，服务端回 TranscriptText / TranscriptEndpoint。

import type { ClientRequest, IncomingMessage } from 'http'
import WebSocket from 'ws'
import { getOauthConfig } from '../constants/oauth.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  isAnthropicAuthEnabled,
} from '../utils/auth.js'
import { logForDebugging } from '../utils/debug.js'
import { getUserAgent } from '../utils/http.js'
import { logError } from '../utils/log.js'
import { getWebSocketTLSOptions } from '../utils/mtls.js'
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from '../utils/proxy.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

const KEEPALIVE_MSG = '{"type":"KeepAlive"}'
const CLOSE_STREAM_MSG = '{"type":"CloseStream"}'
// 两条控制消息**预先序列化成字符串常量**，而不是每次 `JSON.stringify({type:...})`——KeepAlive 每 8 秒发一次、整个会话都在发，省掉重复序列化。

import { getFeatureValue_CACHED_MAY_BE_STALE } from './analytics/growthbook.js'

// ─── Constants ───────────────────────────────────────────────────────

const VOICE_STREAM_PATH = '/api/ws/speech_to_text/voice_stream'

const KEEPALIVE_INTERVAL_MS = 8_000

// finalize() resolution timers. `noData` fires when no TranscriptText
// arrives post-CloseStream — the server has nothing; don't wait out the
// full ~3-5s WS teardown to confirm emptiness. `safety` is the last-
// resort cap if the WS hangs. Exported so tests can shorten them.
export const FINALIZE_TIMEOUTS_MS = {
  safety: 5_000,
  noData: 1_500,
}
// finalize 的两个定时器上限：`noData` 1.5 秒——CloseStream 之后一条 TranscriptText 都没来，说明服务端确实没东西，不值得为确认「空」干等完整的 3–5 秒 WS 拆除；`safety` 5 秒是 WS 彻底卡死时的最后兜底。导出是为了测试能把它们改短。

// ─── Types ──────────────────────────────────────────────────────────

export type VoiceStreamCallbacks = {
  onTranscript: (text: string, isFinal: boolean) => void
  onError: (error: string, opts?: { fatal?: boolean }) => void
  onClose: () => void
  onReady: (connection: VoiceStreamConnection) => void
}
// 回调契约四件套：onTranscript(text, isFinal) 同时承担「实时预览」（isFinal=false）与「最终提交」；onError 带 `fatal` 标记（4xx 升级被拒时置 true，重试无意义）；onClose 是连接结束的统一通知；onReady 拿到 connection 对象——**只在 WS 真正 open 之后才触发**，保证调用方拿到它就能安全 send，不会有音频被静默丢弃。

// How finalize() resolved. `no_data_timeout` means zero server messages
// after CloseStream — the silent-drop signature (anthropics/anthropic#287008).
export type FinalizeSource =
  | 'post_closestream_endpoint'
  | 'no_data_timeout'
  | 'safety_timeout'
  | 'ws_close'
  | 'ws_already_closed'

export type VoiceStreamConnection = {
  send: (audioChunk: Buffer) => void
  finalize: () => Promise<FinalizeSource>
  close: () => void
  isConnected: () => boolean
}
// FinalizeSource 记录 finalize() 是**怎么**结束的，五种来源按速度排列：`post_closestream_endpoint`（最快，约 300ms，服务端冲完最后一段）→ `no_data_timeout`（1.5s，零消息）→ `ws_close`（3–5s，正常拆除）→ `safety_timeout`（5s，卡死兜底）→ `ws_already_closed`（进函数时就已结束）。`no_data_timeout` 是**静默丢弃**的特征签名（anthropics/anthropic#287008），专门留这个枚举值给排障用。

// The voice_stream endpoint returns transcript chunks and endpoint markers.
type VoiceStreamTranscriptText = {
  type: 'TranscriptText'
  data: string
}

type VoiceStreamTranscriptEndpoint = {
  type: 'TranscriptEndpoint'
}

type VoiceStreamTranscriptError = {
  type: 'TranscriptError'
  error_code?: string
  description?: string
}

type VoiceStreamMessage =
  | VoiceStreamTranscriptText
  | VoiceStreamTranscriptEndpoint
  | VoiceStreamTranscriptError
  | { type: 'error'; message?: string }

// ─── Availability ──────────────────────────────────────────────────────

export function isVoiceStreamAvailable(): boolean {
  // voice_stream uses the same OAuth as Claude Code — available when the
  // user is authenticated with Anthropic (Claude.ai subscriber or has
  // valid OAuth tokens).
  if (!isAnthropicAuthEnabled()) {
    return false
  }
  const tokens = getClaudeAIOAuthTokens()
  return tokens !== null && tokens.accessToken !== null
}
// isVoiceStreamAvailable 只看两件事：Anthropic 认证已启用、且手上有 access token。voice_stream 和 Claude Code 共用 OAuth，所以「Claude.ai 订阅者或有有效 OAuth token」即可用——不需要单独的语音权限。

// ─── Connection ────────────────────────────────────────────────────────

export async function connectVoiceStream(
  callbacks: VoiceStreamCallbacks,
  options?: { language?: string; keyterms?: string[] },
): Promise<VoiceStreamConnection | null> {
  // Ensure OAuth token is fresh before connecting
  await checkAndRefreshOAuthTokenIfNeeded()

  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken) {
    logForDebugging('[voice_stream] No OAuth token available')
    return null
  }
// connectVoiceStream 进门前先刷 token，刷完仍没有就直接返回 null（不抛异常）——调用方拿到 null 就当语音不可用处理，把「认证缺失」降级成普通不可用，而不是错误弹窗。

  // voice_stream is a private_api route, but /api/ws/ is also exposed on
  // the api.anthropic.com listener (service_definitions.yaml private-api:
  // visibility.external: true). We target that host instead of claude.ai
  // because the claude.ai CF zone uses TLS fingerprinting and challenges
  // non-browser clients (anthropics/claude-code#34094). Same private-api
  // pod, same OAuth Bearer auth — just a CF zone that doesn't block us.
  // Desktop dictation still uses claude.ai (Swift URLSession has a
  // browser-class JA3 fingerprint, so CF lets it through).
  const wsBaseUrl =
    process.env.VOICE_STREAM_BASE_URL ||
    getOauthConfig()
      .BASE_API_URL.replace('https://', 'wss://')
      .replace('http://', 'ws://')

  if (process.env.VOICE_STREAM_BASE_URL) {
    logForDebugging(
      `[voice_stream] Using VOICE_STREAM_BASE_URL override: ${process.env.VOICE_STREAM_BASE_URL}`,
    )
  }
// WS 基址：`VOICE_STREAM_BASE_URL` 环境变量优先（测试/私有部署用），否则把 OAuth 配置的 BASE_API_URL 的 https 换成 wss。注释里这段是整份文件最有信息量的排障记录：voice_stream 是 private_api 路由，但 `/api/ws/` 在 api.anthropic.com 监听器上也暴露着（service_definitions.yaml 里 private-api 的 `visibility.external: true`），所以**故意打 api.anthropic.com 而不是 claude.ai**——claude.ai 的 CF zone 做 TLS 指纹识别，会 challenge 非浏览器客户端（anthropics/claude-code#34094）。同一个 private-api pod、同一套 Bearer 认证，只是换了个不拦我们的 CF zone。桌面端听写仍走 claude.ai，因为 Swift URLSession 的 JA3 指纹是浏览器级别，CF 放行。

  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    endpointing_ms: '300',
    utterance_end_ms: '1000',
    language: options?.language ?? 'en',
  })
// URL 参数就是整条音频管线的规格：`linear16` 编码、16000 Hz、单声道、`endpointing_ms=300`（静音 300ms 判一句结束）、`utterance_end_ms=1000`（整段话结束）、language 默认 en。这几个值与录音层的 16 kHz 单声道严格对齐——两边不一致就是噪音。

  // Route through conversation-engine with Deepgram Nova 3 (bypassing
  // the server's project_bell_v2_config GrowthBook gate). The server
  // side is anthropics/anthropic#278327 + #281372; this lets us ramp
  // clients independently.
  const isNova3 = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_cobalt_frost',
    false,
  )
  if (isNova3) {
    params.set('use_conversation_engine', 'true')
    params.set('stt_provider', 'deepgram-nova3')
    logForDebugging('[voice_stream] Nova 3 gate enabled (tengu_cobalt_frost)')
  }
// Nova 3 开关（GrowthBook `tengu_cobalt_frost`）：打开后显式指定 `use_conversation_engine=true` + `stt_provider=deepgram-nova3`，**绕过服务端的 project_bell_v2_config 门**（服务端改动见 anthropics/anthropic#278327 / #281372）。这样客户端可以独立灰度，不用等服务端配置。

  // Append keyterms as query params — the voice_stream proxy forwards
  // these to the STT service which applies appropriate boosting.
  if (options?.keyterms?.length) {
    for (const term of options.keyterms) {
      params.append('keyterms', term)
    }
  }
// keyterms 以**重复的 query 参数**追加（`?keyterms=a&keyterms=b`），voice_stream 代理把它们转给 STT 服务做 boosting。词表来源见 voiceKeyterms.ts：全局编程词 + 项目名 + 分支名 + 最近文件名。

  const url = `${wsBaseUrl}${VOICE_STREAM_PATH}?${params.toString()}`

  logForDebugging(`[voice_stream] Connecting to ${url}`)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    'User-Agent': getUserAgent(),
    'x-app': 'cli',
  }

  const tlsOptions = getWebSocketTLSOptions()
  const wsOptions =
    typeof Bun !== 'undefined'
      ? {
          headers,
          proxy: getWebSocketProxyUrl(url),
          tls: tlsOptions || undefined,
        }
      : { headers, agent: getWebSocketProxyAgent(url), ...tlsOptions }
// Bun 与 Node 的 WS 建连参数不同：Bun 的 ws shim 认 `proxy`（URL 字符串）和 `tls`；Node 的 ws 认 `agent`（代理 agent 对象）并把 TLS 选项平铺。这段分支是「同一份代码跑两个运行时」的最小适配层，代理与 mTLS 两条链路都不能丢。

  const ws = new WebSocket(url, wsOptions)

  let keepaliveTimer: ReturnType<typeof setInterval> | null = null
  let connected = false
  // Set to true once CloseStream has been sent (or the ws is closed).
  // After this, further audio sends are dropped.
  let finalized = false
  // Set to true when finalize() is first called, to prevent double-fire.
  let finalizing = false
  // Set when the HTTP upgrade was rejected (unexpected-response). The
  // close event that follows (1006 from our req.destroy()) is just
  // mechanical teardown; the upgrade handler already reported the error.
  let upgradeRejected = false
  // Resolves finalize(). Four triggers: TranscriptEndpoint post-CloseStream
  // (~300ms); no-data timer (1.5s); WS close (~3-5s); safety timer (5s).
  let resolveFinalize: ((source: FinalizeSource) => void) | null = null
  let cancelNoDataTimer: (() => void) | null = null
// 连接生命周期全部状态收在这一组变量里，值得一次看完：`connected`（已 open，send 的非严格前提）、`finalized`（CloseStream 已发或已关闭，**之后丢弃所有音频**）、`finalizing`（finalize() 已进入，防重入；一旦置 true 永不清零，用来在 close 事件里压制误报 error）、`upgradeRejected`（HTTP 升级被拒，后续 close 只是机械拆除，别再报一次错）、`resolveFinalize`（finalize 的唯一出口）、`cancelNoDataTimer`（收到真实数据后关掉 1.5s 空等计时）。六个布尔/句柄，把「谁先谁后」的竞态全钉死了。

  // Define the connection object before event handlers so it can be passed
  // to onReady when the WebSocket opens.
  const connection: VoiceStreamConnection = {
    send(audioChunk: Buffer): void {
      if (ws.readyState !== WebSocket.OPEN) {
        return
      }
      if (finalized) {
        // After CloseStream has been sent, the server rejects further audio.
        // Drop the chunk to avoid a protocol error.
        logForDebugging(
          `[voice_stream] Dropping audio chunk after CloseStream: ${String(audioChunk.length)} bytes`,
        )
        return
      }
      logForDebugging(
        `[voice_stream] Sending audio chunk: ${String(audioChunk.length)} bytes`,
      )
      // Copy the buffer before sending: NAPI Buffer objects from native
      // modules may share a pooled ArrayBuffer.  Creating a view with
      // `new Uint8Array(buf.buffer, offset, len)` can reference stale or
      // overlapping memory by the time the ws library reads it.
      // `Buffer.from()` makes an owned copy that the ws library can safely
      // consume as a binary WebSocket frame.
      ws.send(Buffer.from(audioChunk))
// send 里这行 `Buffer.from(audioChunk)` 是必须的**拷贝**，不是多此一举：NAPI 音频模块返回的 Buffer 可能共享池化的 ArrayBuffer，`new Uint8Array(buf.buffer, offset, len)` 这种视图在 ws 库真正读取时可能指向已失效或重叠的内存。`Buffer.from()` 造一份自有拷贝，ws 才能安全地当二进制帧消费。
    },
    finalize(): Promise<FinalizeSource> {
      if (finalizing || finalized) {
        // Already finalized or WebSocket already closed — resolve immediately.
        return Promise.resolve('ws_already_closed')
      }
// finalize 的重入保护：已经 finalize 过或已经关闭，立刻 resolve `ws_already_closed`，不再走后面那套定时器——避免第二次调用把上一轮的 resolveFinalize 覆盖掉。
      finalizing = true

      return new Promise<FinalizeSource>(resolve => {
        const safetyTimer = setTimeout(
          () => resolveFinalize?.('safety_timeout'),
          FINALIZE_TIMEOUTS_MS.safety,
        )
        const noDataTimer = setTimeout(
          () => resolveFinalize?.('no_data_timeout'),
          FINALIZE_TIMEOUTS_MS.noData,
        )
        cancelNoDataTimer = () => {
          clearTimeout(noDataTimer)
          cancelNoDataTimer = null
        }

        resolveFinalize = (source: FinalizeSource) => {
          clearTimeout(safetyTimer)
          clearTimeout(noDataTimer)
          resolveFinalize = null
          cancelNoDataTimer = null
          // Legacy Deepgram can leave an interim in lastTranscriptText
          // with no TranscriptEndpoint (websocket_manager.py sends
          // TranscriptChunk and TranscriptEndpoint as independent
          // channel items). All resolve triggers must promote it;
          // centralize here. No-op when the close handler already did.
          if (lastTranscriptText) {
            logForDebugging(
              `[voice_stream] Promoting unreported interim before ${source} resolve`,
            )
            const t = lastTranscriptText
            lastTranscriptText = ''
            callbacks.onTranscript(t, true)
          }
          logForDebugging(`[voice_stream] Finalize resolved via ${source}`)
          resolve(source)
        }
// resolveFinalize 是所有结束路径的**唯一出口**，四件事必须在这里做：清掉两个定时器、清空句柄、把 `lastTranscriptText` 里残留的 interim 提升为最终结果、记录来源。注释解释了为什么提升要放在这里而不是各分支各写一遍：老版 Deepgram 会把 TranscriptChunk 和 TranscriptEndpoint 当**独立通道消息**发（websocket_manager.py），于是可能出现「有 interim、没有 endpoint」，任何一条结束路径都可能踩到，集中在出口处理才不会漏。

        // If the WebSocket is already closed, resolve immediately.
        if (
          ws.readyState === WebSocket.CLOSED ||
          ws.readyState === WebSocket.CLOSING
        ) {
          resolveFinalize('ws_already_closed')
          return
        }

        // Defer CloseStream to the next event-loop iteration so any audio
        // callbacks already queued by the native recording module are flushed
        // to the WebSocket before the server is told to stop accepting audio.
        // Without this, stopRecording() can return synchronously while the
        // native module still has a pending onData callback in the event queue,
        // causing audio to arrive after CloseStream.
        setTimeout(() => {
          finalized = true
          if (ws.readyState === WebSocket.OPEN) {
            logForDebugging('[voice_stream] Sending CloseStream (finalize)')
            ws.send(CLOSE_STREAM_MSG)
          }
        }, 0)
// CloseStream 用 `setTimeout(..., 0)` 推迟到下一轮事件循环——这是全文件最微妙的一处竞态修复：调用方 stopRecording() 可以同步返回，但原生录音模块可能还有一个 onData 回调排在事件队列里；如果立刻发 CloseStream，那段音频就会在「服务端已被告知停止收音频」之后才到，直接协议错误。推迟一拍，先让排队的音频冲出去。
      })
    },
    close(): void {
      finalized = true
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer)
        keepaliveTimer = null
      }
      connected = false
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    },
// close() 是**硬关闭**（与 finalize 的「优雅收尾」相对）：置 finalized 丢掉后续音频、清 keepalive、置 connected=false，然后才真正 ws.close()。之所以先改状态再关连接，是为了让 close 事件里那些「还在 finalizing 吗」的判断看到正确的前置条件。
    isConnected(): boolean {
      return connected && ws.readyState === WebSocket.OPEN
    },
  }

  ws.on('open', () => {
    logForDebugging('[voice_stream] WebSocket connected')
    connected = true

    // Send an immediate KeepAlive so the server knows the client is active.
    // Audio hardware initialisation can take >1s, so this prevents the
    // server from closing the connection before audio capture starts.
    logForDebugging('[voice_stream] Sending initial KeepAlive')
    ws.send(KEEPALIVE_MSG)

    // Send periodic keepalive to prevent idle timeout
    keepaliveTimer = setInterval(
      ws => {
        if (ws.readyState === WebSocket.OPEN) {
          logForDebugging('[voice_stream] Sending periodic KeepAlive')
          ws.send(KEEPALIVE_MSG)
        }
      },
      KEEPALIVE_INTERVAL_MS,
      ws,
    )

    // Pass the connection to the caller so it can start sending audio.
    // This fires only after the WebSocket is truly open, guaranteeing
    // that send() calls will not be silently dropped.
    callbacks.onReady(connection)
  })
// on('open') 里三件事有严格顺序：① 置 connected；② **立刻发一条 KeepAlive**——音频硬件初始化可能超过 1 秒，不发这条服务端可能在采集开始前就把连接关了；③ 起 8 秒周期的 KeepAlive 定时器防空闲超时；④ 最后才回调 onReady(connection)，把「可以发音频了」这个保证交给调用方。

  // Track the last TranscriptText so that when TranscriptEndpoint arrives
  // we can emit it as the final transcript.  The server sometimes sends
  // multiple non-cumulative TranscriptText messages without endpoints
  // between them; the TranscriptText handler auto-finalizes previous
  // segments when it detects the text has changed non-cumulatively.
  let lastTranscriptText = ''
// lastTranscriptText 是「已收到但还没定稿」的最近一段文本。注释说明它的必要性：服务端有时连发多条**非累积**的 TranscriptText 而中间没有 TranscriptEndpoint，所以必须自己记着上一段，等结束信号来时补发。

  ws.on('message', (raw: Buffer | string) => {
    const text = raw.toString()
    logForDebugging(
      `[voice_stream] Message received (${String(text.length)} chars): ${text.slice(0, 200)}`,
    )
    let msg: VoiceStreamMessage
    try {
      msg = jsonParse(text) as VoiceStreamMessage
    } catch {
      return
    }

    switch (msg.type) {
      case 'TranscriptText': {
        const transcript = msg.data
        logForDebugging(`[voice_stream] TranscriptText: "${transcript ?? ''}"`)
        // Data arrived after CloseStream — disarm the no-data timer so
        // a slow-but-real flush isn't cut off. Only disarm once finalized
        // (CloseStream sent); pre-CloseStream data racing the deferred
        // send would cancel the timer prematurely, falling back to the
        // slower 5s safety timeout instead of the 1.5s no-data timer.
        if (finalized) {
          cancelNoDataTimer?.()
        }
// cancelNoDataTimer 的时机讲究：**只在 finalized 之后**（CloseStream 已发）收到数据才取消 1.5 秒计时。如果在 CloseStream 之前就取消，那条「抢在推迟发送之前的」数据会把计时器提前关掉，结果反而退回到更慢的 5 秒 safety 兜底——本想加速，实际变慢。
        if (transcript) {
          // Detect when the server has moved to a new speech segment.
          // Progressive refinements extend or shorten the previous text
          // (e.g., "hello" → "hello world", or "hello wor" → "hello wo").
          // A new segment starts with completely different text (neither
          // is a prefix of the other). When detected, emit the previous
          // text as final so the caller can accumulate it, preventing
          // the new segment from overwriting and losing the old one.
          //
          // Nova 3's interims are cumulative across segments AND can
          // revise earlier text ("Hello?" → "Hello."). Revision breaks
          // the prefix check, causing false auto-finalize → the same
          // text committed once AND re-appearing in the cumulative
          // interim = duplication. Nova 3 only endpoints on the final
          // flush, so auto-finalize is never correct for it.
          if (!isNova3 && lastTranscriptText) {
            const prev = lastTranscriptText.trimStart()
            const next = transcript.trimStart()
            if (
              prev &&
              next &&
              !next.startsWith(prev) &&
              !prev.startsWith(next)
            ) {
              logForDebugging(
                `[voice_stream] Auto-finalizing previous segment (new segment detected): "${lastTranscriptText}"`,
              )
              callbacks.onTranscript(lastTranscriptText, true)
            }
          }
// 老版 Deepgram 的「换段检测」：正常情况是渐进式修正（"hello" → "hello world"，或反向缩短），一个方向必是另一个的前缀；如果**两个方向互不为前缀**，说明服务端已经开始了新的一段，先把上一段当最终结果发出去，避免被新段覆盖丢失。但 Nova 3 必须跳过这段逻辑：它的 interim 跨段累积、还会回改前面的文字（"Hello?" → "Hello."），一改就破掉前缀判断，造成**同一段既被提交又被累积 interim 重复显示**；而 Nova 3 只在最后一次 flush 才给 endpoint，所以对它在任何时刻自动定稿都是错的——这就是 `!isNova3` 闸门存在的理由。
          lastTranscriptText = transcript
          // Emit as interim so the caller can show a live preview.
          callbacks.onTranscript(transcript, false)
// 两件事：把最新文本记进 lastTranscriptText（供 endpoint / close / finalize 兜底提升），并以 `isFinal=false` 发给 UI 做实时预览。预览与提交走同一个回调，靠第二个参数区分——UI 侧不需要两套接口。
        }
        break
      }
      case 'TranscriptEndpoint': {
        logForDebugging(
          `[voice_stream] TranscriptEndpoint received, lastTranscriptText="${lastTranscriptText}"`,
        )
        // The server signals the end of an utterance.  Emit the last
        // TranscriptText as a final transcript so the caller can commit it.
        const finalText = lastTranscriptText
        lastTranscriptText = ''
        if (finalText) {
          callbacks.onTranscript(finalText, true)
        }
        // When TranscriptEndpoint arrives after CloseStream was sent,
        // the server has flushed its final transcript — nothing more is
        // coming.  Resolve finalize now so the caller reads the
        // accumulated buffer immediately (~300ms) instead of waiting
        // for the WebSocket close event (~3-5s of server teardown).
        // `finalized` (not `finalizing`) is the right gate: it flips
        // inside the setTimeout(0) that actually sends CloseStream, so
        // a TranscriptEndpoint that races the deferred send still waits.
        if (finalized) {
          resolveFinalize?.('post_closestream_endpoint')
        }
// TranscriptEndpoint 是「一句话说完了」的信号：把攒着的 lastTranscriptText 当最终结果发出并清空。如果这时 CloseStream 已经发过（`finalized`），说明服务端把最后一段也冲完了，**立刻 resolve**，调用方约 300ms 就能读到结果，而不是干等 3–5 秒的 WS 拆除。注释特意强调这里该用 `finalized` 而不是 `finalizing`：前者在真正发出 CloseStream 的 setTimeout 里才翻转，所以「抢在推迟发送之前的」endpoint 仍会乖乖等——**闸门选错就是提前截断**。
        break
      }
      case 'TranscriptError': {
        const desc =
          msg.description ?? msg.error_code ?? 'unknown transcription error'
        logForDebugging(`[voice_stream] TranscriptError: ${desc}`)
        if (!finalizing) {
          callbacks.onError(desc)
        }
        break
// 两类错误消息（TranscriptError 与通用 error）处理一样：**finalizing 期间一律不回调**。原因在 close 处理器那段注释里说透了——收尾阶段报错会把调用方已拿到的转写结果冲掉，服务端拆除连接时的噪声不该变成用户可见的失败。
      }
      case 'error': {
        const errorDetail = msg.message ?? jsonStringify(msg)
        logForDebugging(`[voice_stream] Server error: ${errorDetail}`)
        if (!finalizing) {
          callbacks.onError(errorDetail)
        }
        break
      }
      default:
        break
    }
  })

  ws.on('close', (code, reason) => {
    const reasonStr = reason?.toString() ?? ''
    logForDebugging(
      `[voice_stream] WebSocket closed: code=${String(code)} reason="${reasonStr}"`,
    )
    connected = false
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
    // If the server closed the connection before sending TranscriptEndpoint,
    // promote the last interim transcript to final so no text is lost.
    if (lastTranscriptText) {
      logForDebugging(
        '[voice_stream] Promoting unreported interim transcript to final on close',
      )
      const finalText = lastTranscriptText
      lastTranscriptText = ''
      callbacks.onTranscript(finalText, true)
    }
// close 事件承担收尾三件事：① 服务端没发 endpoint 就走了，把残留 interim 提升为最终（不丢字）；② resolve `ws_close`；③ 只有「非收尾中、非升级被拒、且不是 1000/1005 正常码」才报 onError——`finalizing` 这个闸门之所以不能用 resolveFinalize 代替，是因为它在 finalize 入口就置位且永不清零，快速路径或定时器已经 resolve 之后它仍然准确。注释还点明了代价：useVoice 的 onError 会清空 accumulatedRef，若在收尾时报错，finalize 的 .then 读到的就是空的。
    // During finalize, suppress onError — the session already delivered
    // whatever it had. useVoice's onError path wipes accumulatedRef,
    // which would destroy the transcript before the finalize .then()
    // reads it. `finalizing` (not resolveFinalize) is the gate: set once
    // at finalize() entry, never cleared, so it stays accurate after the
    // fast path or a timer already resolved.
    resolveFinalize?.('ws_close')
    if (!finalizing && !upgradeRejected && code !== 1000 && code !== 1005) {
      callbacks.onError(
        `Connection closed: code ${String(code)}${reasonStr ? ` — ${reasonStr}` : ''}`,
      )
    }
    callbacks.onClose()
// 无论正常关闭、异常关闭还是升级被拒，onClose 都必发——调用方靠它做资源清理，不能有「静默结束」的路径。
  })

  // The ws library fires 'unexpected-response' when the HTTP upgrade
  // returns a non-101 status. Listening lets us surface the actual status
  // and flag 4xx as fatal (same token/TLS fingerprint won't change on
  // retry). With a listener registered, ws does NOT abort on our behalf —
  // we destroy the request; 'error' does not fire, 'close' does (suppressed
  // via upgradeRejected above).
  //
  // Bun's ws shim historically didn't implement this event (a warning
  // is logged once at registration). Under Bun a non-101 upgrade falls
  // through to the generic 'error' + 'close' 1002 path with no recoverable
  // status; the attemptGenRef guard in useVoice.ts still surfaces the
  // retry-attempt failure, the user just sees "Expected 101 status code"
  // instead of "HTTP 503". No harm — the gen fix is the load-bearing part.
  ws.on('unexpected-response', (req: ClientRequest, res: IncomingMessage) => {
    const status = res.statusCode ?? 0
    // Bun's ws implementation on Windows can fire this event for a
    // successful 101 Switching Protocols response (anthropics/claude-code#40510).
    // 101 is never a rejection — bail before we destroy a working upgrade.
    if (status === 101) {
      logForDebugging(
        '[voice_stream] unexpected-response fired with 101; ignoring',
      )
      return
    }
    logForDebugging(
      `[voice_stream] Upgrade rejected: status=${String(status)} cf-mitigated=${String(res.headers['cf-mitigated'])} cf-ray=${String(res.headers['cf-ray'])}`,
    )
    upgradeRejected = true
    res.resume()
    req.destroy()
    if (finalizing) return
    callbacks.onError(
      `WebSocket upgrade rejected with HTTP ${String(status)}`,
      { fatal: status >= 400 && status < 500 },
    )
// unexpected-response 是拿**真实 HTTP 状态码**的唯一机会：ws 库默认遇到非 101 就直接中止，注册了这个监听器之后它不再代劳，由我们 `res.resume()` + `req.destroy()` 收尾，并抑制后续 close 里的重复报错（`upgradeRejected`）。两处细节：① 101 要提前 return——Bun 的 ws 在 Windows 上会对**成功的 101** 也触发这个事件（anthropics/claude-code#40510），不判就会亲手掐掉一条好连接；② 4xx 标 `fatal: true`——同一个 token 和 TLS 指纹重试也不会变。另外 Bun 的 ws shim 历史上不实现这个事件，非 101 会掉到通用 error + close 1002，用户看到的是「Expected 101 status code」而不是「HTTP 503」，但 useVoice.ts 的 attemptGenRef 守卫仍能汇报重试失败——**降级信息少一点，不影响正确性**。
  })

  ws.on('error', (err: Error) => {
    logError(err)
    logForDebugging(`[voice_stream] WebSocket error: ${err.message}`)
    if (!finalizing) {
      callbacks.onError(`Voice stream connection error: ${err.message}`)
    }
  })
// error 事件：先 `logError` 进错误日志（完整堆栈），再记一行 debug，最后**仅在不收尾时报给用户**。与 close 的抑制逻辑同源——收尾期间硬件/网络层的噪声不该覆盖已经拿到的转写。

  return connection
}
