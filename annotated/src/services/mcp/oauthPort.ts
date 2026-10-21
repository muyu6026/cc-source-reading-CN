/**
 * OAuth redirect port helpers — extracted from auth.ts to break the
 * auth.ts ↔ xaaIdpLogin.ts circular dependency.
 */
import { createServer } from 'http'
import { getPlatform } from '../../utils/platform.js'

// Windows dynamic port range 49152-65535 is reserved
const REDIRECT_PORT_RANGE =
  getPlatform() === 'windows'
    ? { min: 39152, max: 49151 }
    : { min: 49152, max: 65535 }
const REDIRECT_PORT_FALLBACK = 3118
// Windows 的端口范围反着挪，是一个很容易忽略的平台差异：
//
// 49152-65535 在 Windows 上是系统的**临时端口池**（ephemeral range），出站连接
// 会从这里拿端口。把 OAuth 回调监听在这里，等于和这台机器上的所有出站连接抢地址，
// 失败率随负载上升，而且错误长得像「随机连不上」。于是 Windows 往下一段挪到
// 39152-49151，让出临时端口池。
//
// macOS / Linux 的临时端口段起点更低（32768 附近），所以在那边用 49152+ 是安全的。

/**
 * Builds a redirect URI on localhost with the given port and a fixed `/callback` path.
 *
 * RFC 8252 Section 7.3 (OAuth for Native Apps): loopback redirect URIs match any
 * port as long as the path matches.
 */
// 固定端口 3118 是兜底，存在理由是「有的授权服务器会严格比对 redirect_uri」。
//
// RFC 8252 §7.3 说 loopback 重定向的端口可以任意（只要求 path 一致），
// 但现实里的服务端实现并不都遵守这条。用户能通过 MCP_OAUTH_CALLBACK_PORT
// 指定端口，也是为了对付这类不守规矩的服务端。
export function buildRedirectUri(
  port: number = REDIRECT_PORT_FALLBACK,
): string {
  return `http://localhost:${port}/callback`
}

function getMcpOAuthCallbackPort(): number | undefined {
  const port = parseInt(process.env.MCP_OAUTH_CALLBACK_PORT || '', 10)
  return port > 0 ? port : undefined
}

/**
 * Finds an available port in the specified range for OAuth redirect
 * Uses random selection for better security
 */
export async function findAvailablePort(): Promise<number> {
  // First, try the configured port if specified
  const configuredPort = getMcpOAuthCallbackPort()
  if (configuredPort) {
    return configuredPort
  }

  const { min, max } = REDIRECT_PORT_RANGE
  const range = max - min + 1
  const maxAttempts = Math.min(range, 100) // Don't try forever

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = min + Math.floor(Math.random() * range)
// 随机挑而不是顺序扫，两个理由：
//   · 顺序扫等于向外暴露「我试着监听 49152、49153……」本机会开着什么，
//     而端口冲突的探测结果本身就是信息
//   · 同一台机器上开两个 CLI 时，顺序扫会让它们更容易撞同一批端口
//
// 代价是最多试 100 次就放弃（maxAttempts），落到固定端口兜底。

    try {
      await new Promise<void>((resolve, reject) => {
        const testServer = createServer()
        testServer.once('error', reject)
        testServer.listen(port, () => {
          testServer.close(() => resolve())
        })
      })
      return port
    } catch {
      // Port in use, try another random port
      continue
    }
  }

  // If random selection failed, try the fallback port
// 探测方式是「bind 成功就立刻 close」，端口在手只持续几微秒 —— 真正的监听要等
// 浏览器跳转回来那一刻才建立。中间这段窗口理论上有竞态（TOCTOU）：别的进程可能
// 正好抢走。实践里够用，因为随机端口的碰撞概率本来就很低。
//
// 认清这一点比「把代码写得更严谨」更有用：这里的可靠性来自概率，不是来自逻辑。
  try {
    await new Promise<void>((resolve, reject) => {
      const testServer = createServer()
      testServer.once('error', reject)
      testServer.listen(REDIRECT_PORT_FALLBACK, () => {
        testServer.close(() => resolve())
      })
    })
    return REDIRECT_PORT_FALLBACK
  } catch {
    throw new Error(`No available ports for OAuth redirect`)
  }
}
