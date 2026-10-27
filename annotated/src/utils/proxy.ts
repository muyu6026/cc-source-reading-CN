// 文件级：本文件统一管理 HTTP/HTTPS 代理与 mTLS（双向 TLS）相关的客户端配置——代理 URL 解析、NO_PROXY 绕过判定、axios 实例与全局拦截器、undici 调度器、WebSocket 代理、以及 AWS SDK 的代理支持，并惰性加载重型依赖以省内存。
// @aws-sdk/credential-provider-node and @smithy/node-http-handler are imported
// dynamically in getAWSClientProxyConfig() to defer ~929KB of AWS SDK.
// undici is lazy-required inside getProxyAgent/configureGlobalAgents to defer
// ~1.5MB when no HTTPS_PROXY/mTLS env vars are set (the common case).
import axios, { type AxiosInstance } from 'axios'
import type { LookupOptions } from 'dns'
import type { Agent } from 'http'
import { HttpsProxyAgent, type HttpsProxyAgentOptions } from 'https-proxy-agent'
import memoize from 'lodash-es/memoize.js'
import type * as undici from 'undici'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getMTLSAgent,
  getMTLSConfig,
  getTLSFetchOptions,
  type TLSConfig,
} from './mtls.js'

// Disable fetch keep-alive after a stale-pool ECONNRESET so retries open a
// fresh TCP connection instead of reusing the dead pooled socket. Sticky for
// the process lifetime — once the pool is known-bad, don't trust it again.
// Works under Bun (native fetch respects keepalive:false for pooling).
// Under Node/undici, keepalive is a no-op for pooling, but undici
// naturally evicts dead sockets from the pool on ECONNRESET.
let keepAliveDisabled = false
// `keepAliveDisabled`：一旦遇到过期连接池导致的 ECONNRESET 就关闭 fetch 保活，强制后续重试开新 TCP 连接；进程级 sticky，已知连接池坏掉就不再信任。

// `disableKeepAlive`：把保活关闭标志置真，供出错路径调用。
export function disableKeepAlive(): void {
  keepAliveDisabled = true
}

// `_resetKeepAliveForTesting`：测试辅助，把保活标志复位。
export function _resetKeepAliveForTesting(): void {
  keepAliveDisabled = false
}

/**
 * Convert dns.LookupOptions.family to a numeric address family value
 * Handles: 0 | 4 | 6 | 'IPv4' | 'IPv6' | undefined
 */
// `getAddressFamily`：把 `dns.LookupOptions.family` 的各种写法（0/4/6/'IPv4'/'IPv6'/undefined）归一化成数字地址族 0/4/6。
export function getAddressFamily(options: LookupOptions): 0 | 4 | 6 {
  switch (options.family) {
    case 0:
    case 4:
    case 6:
      return options.family
    case 'IPv6':
      return 6
    case 'IPv4':
    case undefined:
      return 4
    default:
      throw new Error(`Unsupported address family: ${options.family}`)
// 不支持的地址族直接抛错。
  }
}

type EnvLike = Record<string, string | undefined>
// `EnvLike`：环境变量形状，值为字符串或 `undefined` 的字典。

/**
 * Get the active proxy URL if one is configured
 * Prefers lowercase variants over uppercase (https_proxy > HTTPS_PROXY > http_proxy > HTTP_PROXY)
 * @param env Environment variables to check (defaults to process.env for production use)
 */
// `getProxyUrl`：从环境变量取当前生效的代理 URL，小写优先于大写（https_proxy 优于 HTTPS_PROXY 优于 http_proxy 优于 HTTP_PROXY）。
export function getProxyUrl(env: EnvLike = process.env): string | undefined {
  return env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY
// 按优先级链式兜底返回第一个非空代理变量。
}

/**
 * Get the NO_PROXY environment variable value
 * Prefers lowercase over uppercase (no_proxy > NO_PROXY)
 * @param env Environment variables to check (defaults to process.env for production use)
 */
// `getNoProxy`：取 NO_PROXY 值，小写优先于大写。
export function getNoProxy(env: EnvLike = process.env): string | undefined {
  return env.no_proxy || env.NO_PROXY
}

/**
 * Check if a URL should bypass the proxy based on NO_PROXY environment variable
 * Supports:
 * - Exact hostname matches (e.g., "localhost")
 * - Domain suffix matches with leading dot (e.g., ".example.com")
 * - Wildcard "*" to bypass all
 * - Port-specific matches (e.g., "example.com:8080")
 * - IP addresses (e.g., "127.0.0.1")
 * @param urlString URL to check
 * @param noProxy NO_PROXY value (defaults to getNoProxy() for production use)
 */
// `shouldBypassProxy`：按 NO_PROXY 判断某 URL 是否应绕过代理，支持精确主机名、带点的域名后缀、通配符、指定端口与 IP 地址。
export function shouldBypassProxy(
  urlString: string,
  noProxy: string | undefined = getNoProxy(),
): boolean {
  if (!noProxy) return false
// 没有 NO_PROXY 配置就不绕过。

  // Handle wildcard
  if (noProxy === '*') return true
// 通配符 `*` 表示全部绕过。

  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const hostWithPort = `${hostname}:${port}`
// 解析出主机名（转小写）与默认端口（https 用 443、http 用 80），拼成 `主机:端口` 用于端口精确匹配。

    // Split by comma or space and trim each entry
    const noProxyList = noProxy.split(/[,\s]+/).filter(Boolean)
// 把 NO_PROXY 按逗号或空白拆成列表并去空。

    return noProxyList.some(pattern => {
      pattern = pattern.toLowerCase().trim()

      // Check for port-specific match
      if (pattern.includes(':')) {
        return hostWithPort === pattern
      }

      // Check for domain suffix match (with or without leading dot)
      if (pattern.startsWith('.')) {
        // Pattern ".example.com" should match "sub.example.com" and "example.com"
        // but NOT "notexample.com"
        const suffix = pattern
        return hostname === pattern.substring(1) || hostname.endsWith(suffix)
      }

      // Check for exact hostname match or IP address
      return hostname === pattern
    })
// 逐条匹配：带端口的就整串比 `主机:端口`，带点的后缀匹配子域（但不匹配形似 `notexample.com` 的串），否则按精确主机名或 IP 比。
  } catch {
    // If URL parsing fails, don't bypass proxy
    return false
  }
}

/**
 * Create an HttpsProxyAgent with optional mTLS configuration
 * Skips local DNS resolution to let the proxy handle it
 */
// `createHttpsProxyAgent`：创建带可选 mTLS 的 `HttpsProxyAgent`，并把 CA 证书一并注入。
function createHttpsProxyAgent(
  proxyUrl: string,
  extra: HttpsProxyAgentOptions<string> = {},
): HttpsProxyAgent<string> {
  const mtlsConfig = getMTLSConfig()
// 取出 mTLS 配置与 CA 证书用于填充代理选项。
  const caCerts = getCACertificates()

  const agentOptions: HttpsProxyAgentOptions<string> = {
    ...(mtlsConfig && {
      cert: mtlsConfig.cert,
      key: mtlsConfig.key,
      passphrase: mtlsConfig.passphrase,
    }),
    ...(caCerts && { ca: caCerts }),
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS)) {
// 若环境变量要求代理侧解析主机（沙箱里本地没配 DNS），就自定义 `lookup` 把主机名原样回传、由代理去解析。
    // Skip local DNS resolution - let the proxy resolve hostnames
    // This is needed for environments where DNS is not configured locally
    // and instead handled by the proxy (as in sandboxes)
    agentOptions.lookup = (hostname, options, callback) => {
      callback(null, hostname, getAddressFamily(options))
    }
  }

  return new HttpsProxyAgent(proxyUrl, { ...agentOptions, ...extra })
// 用代理 URL 与拼好的选项实例化 `HttpsProxyAgent`。
}

/**
 * Axios instance with its own proxy agent. Same NO_PROXY/mTLS/CA
 * resolution as the global interceptor, but agent options stay
 * scoped to this instance.
 */
// `createAxiosInstance`：创建带自有代理 agent 的 axios 实例，NO_PROXY/mTLS/CA 解析与全局拦截器一致，但选项只作用于该实例。
export function createAxiosInstance(
  extra: HttpsProxyAgentOptions<string> = {},
): AxiosInstance {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()
  const instance = axios.create({ proxy: false })
// 关掉 axios 自身的代理字段，改用自定义 agent。

  if (!proxyUrl) {
// 无代理时若有 mTLS agent 就挂上、直接返回。
    if (mtlsAgent) instance.defaults.httpsAgent = mtlsAgent
    return instance
  }

  const proxyAgent = createHttpsProxyAgent(proxyUrl, extra)
// 有代理时建代理 agent，并用请求拦截器按 NO_PROXY 决定挂 mTLS 还是代理 agent。
  instance.interceptors.request.use(config => {
    if (config.url && shouldBypassProxy(config.url)) {
      config.httpsAgent = mtlsAgent
      config.httpAgent = mtlsAgent
    } else {
      config.httpsAgent = proxyAgent
      config.httpAgent = proxyAgent
    }
    return config
  })
  return instance
}

/**
 * Get or create a memoized proxy agent for the given URI
 * Now respects NO_PROXY environment variable
 */
// `getProxyAgent`：记忆化地为给定 URI 取代理调度器，用 `EnvHttpProxyAgent` 自动尊重 NO_PROXY，并按需注入 mTLS 的 connect 与 requestTls 选项。
export const getProxyAgent = memoize((uri: string): undici.Dispatcher => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undiciMod = require('undici') as typeof undici
// 惰性 `require` undici，避免无代理场景下白白加载约 1.5MB。
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  // Use EnvHttpProxyAgent to respect NO_PROXY
  // This agent automatically checks NO_PROXY for each request
// 用 `EnvHttpProxyAgent` 替代普通 `ProxyAgent`，因为它会对每个请求自动检查 NO_PROXY。
  const proxyOptions: undici.EnvHttpProxyAgent.Options & {
    requestTls?: {
      cert?: string | Buffer
      key?: string | Buffer
      passphrase?: string
      ca?: string | string[] | Buffer
    }
  } = {
    // Override both HTTP and HTTPS proxy with the provided URI
    httpProxy: uri,
    httpsProxy: uri,
    noProxy: process.env.NO_PROXY || process.env.no_proxy,
  }
// 把 http/https 代理都指到同一 URI，并带上 NO_PROXY 环境变量。

  // Set both connect and requestTls so TLS options apply to both paths:
  // - requestTls: used by ProxyAgent for the TLS connection through CONNECT tunnels
  // - connect: used by Agent for direct (no-proxy) connections
  if (mtlsConfig || caCerts) {
// 有 mTLS 或 CA 时同时设置 `connect` 与 `requestTls`，让直连与隧道两条路径都用上 TLS 选项。
    const tlsOpts = {
      ...(mtlsConfig && {
        cert: mtlsConfig.cert,
        key: mtlsConfig.key,
        passphrase: mtlsConfig.passphrase,
      }),
      ...(caCerts && { ca: caCerts }),
    }
    proxyOptions.connect = tlsOpts
    proxyOptions.requestTls = tlsOpts
  }

  return new undiciMod.EnvHttpProxyAgent(proxyOptions)
// 实例化 `EnvHttpProxyAgent` 并返回，记忆化保证同 URI 不重复创建。
})

/**
 * Get an HTTP agent configured for WebSocket proxy support
 * Returns undefined if no proxy is configured or URL should bypass proxy
 */
// `getWebSocketProxyAgent`：取支持代理的 WebSocket HTTP agent，无代理或应绕过时返回 `undefined`。
export function getWebSocketProxyAgent(url: string): Agent | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  // Check if URL should bypass proxy
  if (shouldBypassProxy(url)) {
// 该 URL 命中 NO_PROXY 就返回 `undefined`（直连）。
    return undefined
  }

  return createHttpsProxyAgent(proxyUrl)
}

/**
 * Get the proxy URL for WebSocket connections under Bun.
 * Bun's native WebSocket supports a `proxy` string option instead of Node's `agent`.
 * Returns undefined if no proxy is configured or URL should bypass proxy.
 */
// `getWebSocketProxyUrl`：Bun 原生 WebSocket 用 `proxy` 字符串而非 Node 的 agent，返回代理 URL 或 `undefined`。
export function getWebSocketProxyUrl(url: string): string | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return proxyUrl
}

/**
 * Get fetch options for the Anthropic SDK with proxy and mTLS configuration
 * Returns fetch options with appropriate dispatcher for proxy and/or mTLS
 *
 * @param opts.forAnthropicAPI - Enables ANTHROPIC_UNIX_SOCKET tunneling. This
 *   env var is set by `claude ssh` on the remote CLI to route API calls through
 *   an ssh -R forwarded unix socket to a local auth proxy. It MUST NOT leak
 *   into non-Anthropic-API fetch paths (MCP HTTP/SSE transports, etc.) or those
 *   requests get misrouted to api.anthropic.com. Only the Anthropic SDK client
 *   should pass `true` here.
 */
// `getProxyFetchOptions`：返回给 Anthropic SDK 的 fetch 选项（代理/mTLS/dispatcher/unix/keepalive）。`forAnthropicAPI` 为真才允许 `ANTHROPIC_UNIX_SOCKET` 隧道，绝不能漏给其他 fetch 路径。
export function getProxyFetchOptions(opts?: { forAnthropicAPI?: boolean }): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string
  unix?: string
  keepalive?: false
} {
  const base = keepAliveDisabled ? ({ keepalive: false } as const) : {}
// `base` 在保活关闭时带 `keepalive:false`，否则为空对象。

  // ANTHROPIC_UNIX_SOCKET tunnels through the `claude ssh` auth proxy, which
  // hardcodes the upstream to the Anthropic API. Scope to the Anthropic API
  // client so MCP/SSE/other callers don't get their requests misrouted.
  if (opts?.forAnthropicAPI) {
// 仅 Anthropic API 客户端走 unix socket 隧道（`claude ssh` 设的环境变量），避免 MCP/SSE 等请求被误路由。
    const unixSocket = process.env.ANTHROPIC_UNIX_SOCKET
    if (unixSocket && typeof Bun !== 'undefined') {
      return { ...base, unix: unixSocket }
    }
  }

  const proxyUrl = getProxyUrl()

  // If we have a proxy, use the proxy agent (which includes mTLS config)
  if (proxyUrl) {
    if (typeof Bun !== 'undefined') {
// Bun 下直接返回 `proxy` 字符串加 TLS 选项；Node 下用 `getProxyAgent` 提供的 dispatcher。
      return { ...base, proxy: proxyUrl, ...getTLSFetchOptions() }
    }
    return { ...base, dispatcher: getProxyAgent(proxyUrl) }
  }

  // Otherwise, use TLS options directly if available
  return { ...base, ...getTLSFetchOptions() }
// 没有代理时直接带 TLS 选项返回。
}

/**
 * Configure global HTTP agents for both axios and undici
 * This ensures all HTTP requests use the proxy and/or mTLS if configured
 */
let proxyInterceptorId: number | undefined
// `proxyInterceptorId`：记录已注册的 axios 拦截器 id，便于重复配置时先卸载旧的。

// `configureGlobalAgents`：为 axios 与 undici 配置全局代理/mTLS，让所有 HTTP 请求都走代理或双向 TLS。
export function configureGlobalAgents(): void {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()

  // Eject previous interceptor to avoid stacking on repeated calls
  if (proxyInterceptorId !== undefined) {
// 重复调用前先弹出旧拦截器，避免层层叠加。
    axios.interceptors.request.eject(proxyInterceptorId)
    proxyInterceptorId = undefined
  }

  // Reset proxy-related defaults so reconfiguration is clean
  axios.defaults.proxy = undefined
  axios.defaults.httpAgent = undefined
  axios.defaults.httpsAgent = undefined
// 重置 axios 的代理与 agent 默认，保证重配置干净。

  if (proxyUrl) {
// 有代理时关掉 axios 自带代理、建代理 agent，并注册尊重 NO_PROXY 的请求拦截器。
    // workaround for https://github.com/axios/axios/issues/4531
    axios.defaults.proxy = false

    // Create proxy agent with mTLS options if available
    const proxyAgent = createHttpsProxyAgent(proxyUrl)

    // Add axios request interceptor to handle NO_PROXY
    proxyInterceptorId = axios.interceptors.request.use(config => {
// 拦截器按 URL 是否绕过代理决定挂 mTLS agent、直连还是代理 agent。
      // Check if URL should bypass proxy based on NO_PROXY
      if (config.url && shouldBypassProxy(config.url)) {
        // Bypass proxy - use mTLS agent if configured, otherwise undefined
        if (mtlsAgent) {
          config.httpsAgent = mtlsAgent
          config.httpAgent = mtlsAgent
        } else {
          // Remove any proxy agents to use direct connection
          delete config.httpsAgent
          delete config.httpAgent
        }
      } else {
        // Use proxy agent
        config.httpsAgent = proxyAgent
        config.httpAgent = proxyAgent
      }
      return config
    })

    // Set global dispatcher that now respects NO_PROXY via EnvHttpProxyAgent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
// 把全局 undici 调度器设成尊重 NO_PROXY 的代理 agent（通过惰性 require）。
    ;(require('undici') as typeof undici).setGlobalDispatcher(
      getProxyAgent(proxyUrl),
    )
  } else if (mtlsAgent) {
// 无代理但有 mTLS 时，把 mTLS 的 dispatcher 设成 undici 全局调度器。
    // No proxy but mTLS is configured
    axios.defaults.httpsAgent = mtlsAgent

    // Set undici global dispatcher with mTLS
    const mtlsOptions = getTLSFetchOptions()
    if (mtlsOptions.dispatcher) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ;(require('undici') as typeof undici).setGlobalDispatcher(
        mtlsOptions.dispatcher,
      )
    }
  }
}

/**
 * Get AWS SDK client configuration with proxy support
 * Returns configuration object that can be spread into AWS service client constructors
 */
// `getAWSClientProxyConfig`：返回可展开进 AWS 服务客户端的代理配置，动态加载 AWS SDK 与 smithy 处理器以延迟约 929KB 体积。
export async function getAWSClientProxyConfig(): Promise<object> {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return {}
  }

  const [{ NodeHttpHandler }, { defaultProvider }] = await Promise.all([
    import('@smithy/node-http-handler'),
    import('@aws-sdk/credential-provider-node'),
  ])
// 动态 `import` AWS 的 Node HTTP 处理器与凭证提供者，只在确实需要时加载。

  const agent = createHttpsProxyAgent(proxyUrl)
// 用代理 agent 构造 `NodeHttpHandler`，并把凭证提供者也指向它。
  const requestHandler = new NodeHttpHandler({
    httpAgent: agent,
    httpsAgent: agent,
  })

  return {
    requestHandler,
    credentials: defaultProvider({
      clientConfig: { requestHandler },
    }),
  }
}

/**
 * Clear proxy agent cache.
 */
// `clearProxyCache`：清空代理 agent 的记忆化缓存。
export function clearProxyCache(): void {
  getProxyAgent.cache.clear?.()
  logForDebugging('Cleared proxy agent cache')
}
