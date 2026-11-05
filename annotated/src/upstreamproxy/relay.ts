// 本地监听 TCP、把字节经 WebSocket 隧道送到上游代理；用隧道而不是原生连接，因为网关只做路径前缀路由
/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */
/**
 * CONNECT-over-WebSocket relay for CCR upstreamproxy.
 *
 * Listens on localhost TCP, accepts HTTP CONNECT from curl/gh/kubectl/etc,
 * and tunnels bytes over WebSocket to the CCR upstreamproxy endpoint.
 * The CCR server-side terminates the tunnel, MITMs TLS, injects org-configured
 * credentials (e.g. DD-API-KEY), and forwards to the real upstream.
 *
 * WHY WebSocket and not raw CONNECT: CCR ingress is GKE L7 with path-prefix
 * routing; there's no connect_matcher in cdk-constructs. The session-ingress
 * tunnel (sessions/tunnel/v1alpha/tunnel.proto) already uses this pattern.
 *
 * Protocol: bytes are wrapped in UpstreamProxyChunk protobuf messages
 * (`message UpstreamProxyChunk { bytes data = 1; }`) for compatibility with
 * gateway.NewWebSocketStreamAdapter on the server side.
 */

import { createServer, type Socket as NodeSocket } from 'node:net'
import { logForDebugging } from '../utils/debug.js'
import { getWebSocketTLSOptions } from '../utils/mtls.js'
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from '../utils/proxy.js'

// 容器出网被网关挡住，升级请求也必须走代理，所以不能直接用全局的 WebSocket
// The CCR container runs behind an egress gateway — direct outbound is
// blocked, so the WS upgrade must go through the same HTTP CONNECT proxy
// everything else uses. undici's globalThis.WebSocket does not consult
// the global dispatcher for the upgrade, so under Node we use the ws package
// with an explicit agent (same pattern as SessionsWebSocket). Bun's native
// WebSocket takes a proxy URL directly. Preloaded in startNodeRelay so
// openTunnel stays synchronous and the CONNECT state machine doesn't race.
type WSCtor = typeof import('ws').default
// 构造器在启动时预加载：让隧道开启保持同步，避免状态机与连接过程竞态
let nodeWSCtor: WSCtor | undefined

// Intersection of the surface openTunnel touches. Both undici's
// globalThis.WebSocket and the ws package satisfy this via property-style
// onX handlers.
// 两种运行时的 WebSocket 只取交集的部分，处理器都用属性赋值的形式
type WebSocketLike = Pick<
  WebSocket,
  | 'onopen'
  | 'onmessage'
  | 'onerror'
  | 'onclose'
  | 'send'
  | 'close'
  | 'readyState'
  | 'binaryType'
>

// Envoy per-request buffer cap. Week-1 Datadog payloads won't hit this, but
// design for it so git-push doesn't need a relay rewrite.
// 单块上限五百一十二 KB：贴合网关的请求缓冲上限，git 推送也不用改实现
const MAX_CHUNK_BYTES = 512 * 1024

// Sidecar idle timeout is 50s; ping well inside that.
// 保活间隔压到三十秒：侧车空闲超时是五十秒，必须留在里面
const PING_INTERVAL_MS = 30_000

/**
 * Encode an UpstreamProxyChunk protobuf message by hand.
 *
 * For `message UpstreamProxyChunk { bytes data = 1; }` the wire format is:
 *   tag = (field_number << 3) | wire_type = (1 << 3) | 2 = 0x0a
 *   followed by varint length, followed by the bytes.
 *
 * protobufjs would be the general answer; for a single-field bytes message
 * the hand encoding is 10 lines and avoids a runtime dep in the hot path.
 */
// 手写编码：单字段字节消息的线上格式只有标签、变长长度与内容三段
export function encodeChunk(data: Uint8Array): Uint8Array {
  const len = data.length
// 长度用变长整数：小块通常一到三个字节就够
  // varint encoding of length — most chunks fit in 1–3 length bytes
  const varint: number[] = []
  let n = len
  while (n > 0x7f) {
    varint.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  varint.push(n)
  const out = new Uint8Array(1 + varint.length + len)
  out[0] = 0x0a
  out.set(varint, 1)
  out.set(data, 1 + varint.length)
  return out
}

/**
 * Decode an UpstreamProxyChunk. Returns the data field, or null if malformed.
 * Tolerates the server sending a zero-length chunk (keepalive semantics).
 */
// 解码容忍空块：服务端把空块当作保活语义，不该判为畸形
export function decodeChunk(buf: Uint8Array): Uint8Array | null {
// 空输入返回空字节而不是空值：空值是畸形信号，两者不能混
  if (buf.length === 0) return new Uint8Array(0)
  if (buf[0] !== 0x0a) return null
  let len = 0
  let shift = 0
  let i = 1
  while (i < buf.length) {
    const b = buf[i]!
    len |= (b & 0x7f) << shift
    i++
    if ((b & 0x80) === 0) break
    shift += 7
// 移位超过二十八位就判畸形：长度不可能这么大，继续移会让位运算溢出
    if (shift > 28) return null
  }
// 声明的长度超过剩余字节说明被截断，按协议不能部分接受
  if (i + len > buf.length) return null
  return buf.subarray(i, i + len)
}

export type UpstreamProxyRelay = {
  port: number
  stop: () => void
}

// 每条连接的状态：套接字、缓冲、保活定时器、待发队列与三个布尔位
type ConnState = {
  ws?: WebSocketLike
  connectBuf: Buffer
  pinger?: ReturnType<typeof setInterval>
// 握手期的待发队列是必需的：连接请求与首包可能被合并在同一个数据块里
  // Bytes that arrived after the CONNECT header but before ws.onopen fired.
  // TCP can coalesce CONNECT + ClientHello into one packet, and the socket's
  // data callback can fire again while the WS handshake is still in flight.
  // Both cases would silently drop bytes without this buffer.
  pending: Buffer[]
  wsOpen: boolean
// 已建立之后不能再写明文错误响应，那会破坏客户端的加密流，只能关掉
  // Set once the server's 200 Connection Established has been forwarded and
  // the tunnel is carrying TLS. After that, writing a plaintext 502 would
  // corrupt the client's TLS stream — just close instead.
  established: boolean
// 错误必随关闭而来，两个处理器都会收尾，所以用首次调用者胜出的标志挡住第二次
  // WS onerror is always followed by onclose; without a guard the second
  // handler would sock.end() an already-ended socket. First caller wins.
  closed: boolean
}

/**
 * Minimal socket abstraction so the CONNECT parser and WS tunnel plumbing
 * are runtime-agnostic. Implementations handle write backpressure internally:
 * Bun's sock.write() does partial writes and needs explicit tail-queueing;
 * Node's net.Socket buffers unconditionally and never drops bytes.
 */
// 套接字抽象：两种运行时的写语义不同，适配层把差异吃掉
type ClientSocket = {
  write: (data: Uint8Array | string) => void
  end: () => void
}

function newConnState(): ConnState {
  return {
    connectBuf: Buffer.alloc(0),
    pending: [],
    wsOpen: false,
    established: false,
    closed: false,
  }
}

/**
 * Start the relay. Returns the ephemeral port it bound and a stop function.
 * Uses Bun.listen when available, otherwise Node's net.createServer — the CCR
 * container runs the CLI under Node, not Bun.
 */
// 启动入口：按运行时选择实现，绑定零号端口让系统分配
export async function startUpstreamProxyRelay(opts: {
  wsUrl: string
  sessionId: string
  token: string
}): Promise<UpstreamProxyRelay> {
// 隧道内的代理认证用基本认证，会话号作用户名、令牌作密码
  const authHeader =
    'Basic ' + Buffer.from(`${opts.sessionId}:${opts.token}`).toString('base64')
// 升级请求另带一个持有者令牌：网关在升级阶段就要验，和隧道内的认证是两套
  // WS upgrade itself is auth-gated (proto authn: PRIVATE_API) — the gateway
  // wants the session-ingress JWT on the upgrade request, separate from the
  // Proxy-Authorization that rides inside the tunneled CONNECT.
  const wsAuthHeader = `Bearer ${opts.token}`

  const relay =
    typeof Bun !== 'undefined'
      ? startBunRelay(opts.wsUrl, authHeader, wsAuthHeader)
      : await startNodeRelay(opts.wsUrl, authHeader, wsAuthHeader)

  logForDebugging(`[upstreamproxy] relay listening on 127.0.0.1:${relay.port}`)
  return relay
}

// Bun 路径：它的写会返回实际交给内核的字节数，剩下的必须自己排队
function startBunRelay(
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): UpstreamProxyRelay {
// 所以每条连接都要一个待发队列，适配层闭包活得比单次回调长
  // Bun TCP sockets don't auto-buffer partial writes: sock.write() returns
  // the byte count actually handed to the kernel, and the remainder is
  // silently dropped. When the kernel buffer fills, we queue the tail and
  // let the drain handler flush it. Per-socket because the adapter closure
  // outlives individual handler calls.
  type BunState = ConnState & { writeBuf: Uint8Array[] }

  // eslint-disable-next-line custom-rules/require-bun-typeof-guard -- caller dispatches on typeof Bun
  const server = Bun.listen<BunState>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(sock) {
        sock.data = { ...newConnState(), writeBuf: [] }
      },
      data(sock, data) {
        const st = sock.data
        const adapter: ClientSocket = {
          write: payload => {
            const bytes =
              typeof payload === 'string'
                ? Buffer.from(payload, 'utf8')
                : payload
// 已有积压时直接排队：保证顺序，不然小块会插到大块前面
            if (st.writeBuf.length > 0) {
              st.writeBuf.push(bytes)
              return
            }
// 写不完就把剩余部分入队，等可写事件再来冲刷
            const n = sock.write(bytes)
            if (n < bytes.length) st.writeBuf.push(bytes.subarray(n))
          },
          end: () => sock.end(),
        }
        handleData(adapter, st, data, wsUrl, authHeader, wsAuthHeader)
      },
// 可写回调按顺序冲刷队列，遇到写不完就更新队首剩余量后返回
      drain(sock) {
        const st = sock.data
        while (st.writeBuf.length > 0) {
          const chunk = st.writeBuf[0]!
          const n = sock.write(chunk)
          if (n < chunk.length) {
            st.writeBuf[0] = chunk.subarray(n)
            return
          }
          st.writeBuf.shift()
        }
      },
      close(sock) {
        cleanupConn(sock.data)
      },
      error(sock, err) {
        logForDebugging(`[upstreamproxy] client socket error: ${err.message}`)
        cleanupConn(sock.data)
      },
    },
  })

  return {
    port: server.port,
    stop: () => server.stop(true),
  }
}

// Node 路径单独导出：测试跑在 Bun 上，运行时分派永远选不到这条
// Exported so tests can exercise the Node path directly — the test runner is
// Bun, so the runtime dispatch in startUpstreamProxyRelay always picks Bun.
export async function startNodeRelay(
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): Promise<UpstreamProxyRelay> {
  nodeWSCtor = (await import('ws')).default
// 状态挂在连接对象上而不是闭包里：多个回调要共享同一份
  const states = new WeakMap<NodeSocket, ConnState>()

  const server = createServer(sock => {
    const st = newConnState()
    states.set(sock, st)
// Node 的写会自己缓冲，返回值只表示背压，字节不会丢，所以不需要尾队列
    // Node's sock.write() buffers internally — a false return signals
    // backpressure but the bytes are already queued, so no tail-tracking
    // needed for correctness. Week-1 payloads won't stress the buffer.
    const adapter: ClientSocket = {
      write: payload => {
        sock.write(typeof payload === 'string' ? payload : Buffer.from(payload))
      },
      end: () => sock.end(),
    }
    sock.on('data', data =>
      handleData(adapter, st, data, wsUrl, authHeader, wsAuthHeader),
    )
    sock.on('close', () => cleanupConn(states.get(sock)))
    sock.on('error', err => {
      logForDebugging(`[upstreamproxy] client socket error: ${err.message}`)
      cleanupConn(states.get(sock))
    })
  })

// 监听成功才解析：失败与无地址两种情况都要显式拒绝，不能挂住调用方
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('upstreamproxy: server has no TCP address'))
        return
      }
      resolve({
        port: addr.port,
        stop: () => server.close(),
      })
    })
  })
}

/**
 * Shared per-connection data handler. Phase 1 accumulates the CONNECT request;
 * phase 2 forwards client bytes over the WS tunnel.
 */
// 共用的数据处理器：第一阶段攒连接请求，第二阶段转发字节
function handleData(
  sock: ClientSocket,
  st: ConnState,
  data: Buffer,
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): void {
  // Phase 1: accumulate until we've seen the full CONNECT request
  // (terminated by CRLF CRLF). curl/gh send this in one packet, but
  // don't assume that.
// 还没有隧道对象说明在攒请求头：按双换行定位请求结束
  if (!st.ws) {
    st.connectBuf = Buffer.concat([st.connectBuf, data])
    const headerEnd = st.connectBuf.indexOf('\r\n\r\n')
// 迟迟等不到双换行就回四百并关闭：防止恶意或错配的客户端占着连接
    if (headerEnd === -1) {
      // Guard against a client that never sends CRLFCRLF.
      if (st.connectBuf.length > 8192) {
        sock.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        sock.end()
      }
      return
    }
// 只解析请求行，头部其余字段不关心，隧道内会用另一套认证
    const reqHead = st.connectBuf.subarray(0, headerEnd).toString('utf8')
    const firstLine = reqHead.split('\r\n')[0] ?? ''
    const m = firstLine.match(/^CONNECT\s+(\S+)\s+HTTP\/1\.[01]$/i)
// 方法不是连接请求就回四百零五，明确告诉客户端这个端口只做隧道
    if (!m) {
      sock.write('HTTP/1.1 405 Method Not Allowed\r\n\r\n')
      sock.end()
      return
    }
    // Stash any bytes that arrived after the CONNECT header so
    // openTunnel can flush them once the WS is open.
// 请求头之后可能已经跟着字节了：先存起来，等隧道打开再补发
    const trailing = st.connectBuf.subarray(headerEnd + 4)
    if (trailing.length > 0) {
      st.pending.push(Buffer.from(trailing))
    }
    st.connectBuf = Buffer.alloc(0)
    openTunnel(sock, st, firstLine, wsUrl, authHeader, wsAuthHeader)
    return
  }
  // Phase 2: WS exists. If it isn't OPEN yet, buffer; ws.onopen will
  // flush. Once open, pump client bytes to WS in chunks.
// 隧道对象已建但还没打开：先入队，打开回调会统一冲刷
  if (!st.wsOpen) {
    st.pending.push(Buffer.from(data))
    return
  }
  forwardToWs(st.ws, data)
}

// 开隧道：先定好内容类型与认证头，再按运行时选构造方式
function openTunnel(
  sock: ClientSocket,
  st: ConnState,
  connectLine: string,
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): void {
// 内容类型必须是二进制原型：缺了它服务端会按 JSON 解析，然后静默失败
  // core/websocket/stream.go picks JSON vs binary-proto from the upgrade
  // request's Content-Type header (defaults to JSON). Without application/proto
  // the server protojson.Unmarshals our hand-encoded binary chunks and fails
  // silently with EOF.
  const headers = {
    'Content-Type': 'application/proto',
    Authorization: wsAuthHeader,
  }
  let ws: WebSocketLike
// Node 走带代理代理者与加密选项的构造器，Bun 走原生扩展参数
  if (nodeWSCtor) {
    ws = new nodeWSCtor(wsUrl, {
      headers,
      agent: getWebSocketProxyAgent(wsUrl),
      ...getWebSocketTLSOptions(),
    }) as unknown as WebSocketLike
  } else {
    ws = new globalThis.WebSocket(wsUrl, {
      // @ts-expect-error — Bun extension; not in lib.dom WebSocket types
      headers,
      proxy: getWebSocketProxyUrl(wsUrl),
      tls: getWebSocketTLSOptions() || undefined,
    })
  }
// 统一按二进制数组接收，两种运行时的默认值不一样
  ws.binaryType = 'arraybuffer'
  st.ws = ws

// 打开后先发连接行与代理认证：服务端据此认证并知道目标主机
  ws.onopen = () => {
    // First chunk carries the CONNECT line plus Proxy-Authorization so the
    // server can auth the tunnel and know the target host:port. Server
    // responds with its own "HTTP/1.1 200" over the tunnel; we just pipe it.
    const head =
      `${connectLine}\r\n` + `Proxy-Authorization: ${authHeader}\r\n` + `\r\n`
    ws.send(encodeChunk(Buffer.from(head, 'utf8')))
    // Flush anything that arrived while the WS handshake was in flight —
    // trailing bytes from the CONNECT packet and any data() callbacks that
    // fired before onopen.
// 先置打开标志再冲刷：这样期间新到的数据会直接走转发而不是继续入队
    st.wsOpen = true
    for (const buf of st.pending) {
      forwardToWs(ws, buf)
    }
    st.pending = []
    // Not all WS implementations expose ping(); empty chunk works as an
    // application-level keepalive the server can ignore.
// 保活定时器在隧道打开后才建，关闭时由收尾函数清掉
    st.pinger = setInterval(sendKeepalive, PING_INTERVAL_MS, ws)
  }

// 收到数据：两种运行时给的形态不同，统一转成字节数组再解包
  ws.onmessage = ev => {
    const raw =
      ev.data instanceof ArrayBuffer
        ? new Uint8Array(ev.data)
        : new Uint8Array(Buffer.from(ev.data))
    const payload = decodeChunk(raw)
// 有内容才写回客户端并置已建立标志：空块是保活，不该算建立
    if (payload && payload.length > 0) {
      st.established = true
      sock.write(payload)
    }
  }

// 错误处理要先判是否已收尾，避免对已经结束的套接字再写一次
  ws.onerror = ev => {
    const msg = 'message' in ev ? String(ev.message) : 'websocket error'
    logForDebugging(`[upstreamproxy] ws error: ${msg}`)
    if (st.closed) return
    st.closed = true
    if (!st.established) {
      sock.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    }
    sock.end()
    cleanupConn(st)
  }

// 关闭同样先判收尾标志，然后结束套接字并清资源
  ws.onclose = () => {
    if (st.closed) return
    st.closed = true
    sock.end()
    cleanupConn(st)
  }
}

// 保活只在打开状态发空块：关闭中或关闭后再发会抛错
function sendKeepalive(ws: WebSocketLike): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encodeChunk(new Uint8Array(0)))
  }
}

// 转发按上限切片：一块超过网关缓冲就会被拒，必须自己拆
function forwardToWs(ws: WebSocketLike, data: Buffer): void {
  if (ws.readyState !== WebSocket.OPEN) return
  for (let off = 0; off < data.length; off += MAX_CHUNK_BYTES) {
    const slice = data.subarray(off, off + MAX_CHUNK_BYTES)
    ws.send(encodeChunk(slice))
  }
}

// 收尾：清定时器、关闭隧道、置空引用，允许重复调用
function cleanupConn(st: ConnState | undefined): void {
  if (!st) return
  if (st.pinger) clearInterval(st.pinger)
  if (st.ws && st.ws.readyState <= WebSocket.OPEN) {
    try {
      st.ws.close()
    } catch {
      // already closing
    }
  }
  st.ws = undefined
}
