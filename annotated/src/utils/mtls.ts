import type * as https from 'https'
import { Agent as HttpsAgent } from 'https'
import memoize from 'lodash-es/memoize.js'
import type * as tls from 'tls'
import type * as undici from 'undici'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { getFsImplementation } from './fsOperations.js'

// MTLSConfig 描述双向 TLS 所需的客户端证书、私钥与可选口令三个字段。
export type MTLSConfig = {
  cert?: string
  key?: string
  passphrase?: string
}
// TLSConfig 在 MTLSConfig 基础上增加可选的 CA 证书字段，覆盖单向与双向 TLS 两种场景。

export type TLSConfig = MTLSConfig & {
  ca?: string | string[] | Buffer
}

/**
 * Get mTLS configuration from environment variables
 */
export const getMTLSConfig = memoize((): MTLSConfig | undefined => {
// getMTLSConfig 从环境变量读取客户端证书、私钥与口令，三者任一存在才返回配置，
// NODE_EXTRA_CA_CERTS 由 Node 运行时自动处理，这里不重复加载。
  const config: MTLSConfig = {}

  // Note: NODE_EXTRA_CA_CERTS is automatically handled by Node.js at runtime
  // We don't need to manually load it - Node.js appends it to the built-in CAs automatically

  // Client certificate
  if (process.env.CLAUDE_CODE_CLIENT_CERT) {
    try {
      config.cert = getFsImplementation().readFileSync(
        process.env.CLAUDE_CODE_CLIENT_CERT,
        { encoding: 'utf8' },
      )
      logForDebugging(
        'mTLS: Loaded client certificate from CLAUDE_CODE_CLIENT_CERT',
      )
    } catch (error) {
      logForDebugging(`mTLS: Failed to load client certificate: ${error}`, {
        level: 'error',
      })
    }
  }
// 读取客户端证书时用 try 包裹，失败只记日志不中断，保证其它字段仍可继续装配。

  // Client key
  if (process.env.CLAUDE_CODE_CLIENT_KEY) {
    try {
      config.key = getFsImplementation().readFileSync(
        process.env.CLAUDE_CODE_CLIENT_KEY,
        { encoding: 'utf8' },
      )
      logForDebugging('mTLS: Loaded client key from CLAUDE_CODE_CLIENT_KEY')
    } catch (error) {
      logForDebugging(`mTLS: Failed to load client key: ${error}`, {
        level: 'error',
      })
    }
  }
// 读取客户端私钥同上，按 CLAUDE_CODE_CLIENT_KEY 指向的文件同步读入。

  // Key passphrase
  if (process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE) {
    config.passphrase = process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE
    logForDebugging('mTLS: Using client key passphrase')
  }
// 口令直接取环境变量 CLAUDE_CODE_CLIENT_KEY_PASSPHRASE，无需读文件。

  // Only return config if at least one option is set
  if (Object.keys(config).length === 0) {
    return undefined
  }

  return config
})

// getMTLSConfig 收尾：仅当至少一项配置被设置时才返回对象，否则返回 undefined。
/**
 * Create an HTTPS agent with mTLS configuration
 */
export const getMTLSAgent = memoize((): HttpsAgent | undefined => {
// getMTLSAgent 在存在 mTLS 或自定义 CA 时创建带 keep-alive 的 HTTPS Agent，
// 把证书与 CA 合并进连接选项以提升复用性能。
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return undefined
  }

  const agentOptions: https.AgentOptions = {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
    // Enable keep-alive for better performance
    keepAlive: true,
  }

  logForDebugging('mTLS: Creating HTTPS agent with custom certificates')
  return new HttpsAgent(agentOptions)
})

/**
 * Get TLS options for WebSocket connections
 */
export function getWebSocketTLSOptions(): tls.ConnectionOptions | undefined {
// getWebSocketTLSOptions 为 WebSocket 连接返回 TLS 选项，逻辑与 Agent 版一致，
// 只是在调用点以不同方式装配到 WebSocket 客户端。
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return undefined
  }

  return {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
  }
}

/**
 * Get fetch options with TLS configuration (mTLS + CA certs) for undici
 */
export function getTLSFetchOptions(): {
// getTLSFetchOptions 针对 undici 返回 TLS 配置或自定义 dispatcher，
// Bun 环境直接走原生 TLS，Node 环境则惰性加载约一点五兆的 undici 包避免无谓开销。
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
} {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return {}
  }

  const tlsConfig: TLSConfig = {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
  }

  if (typeof Bun !== 'undefined') {
    return { tls: tlsConfig }
  }
  logForDebugging('TLS: Created undici agent with custom certificates')
  // Create a custom undici Agent with TLS options. Lazy-required so that
  // the ~1.5MB undici package is only loaded when mTLS/CA certs are configured.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undiciMod = require('undici') as typeof undici
  const agent = new undiciMod.Agent({
    connect: {
      cert: tlsConfig.cert,
      key: tlsConfig.key,
      passphrase: tlsConfig.passphrase,
      ...(tlsConfig.ca && { ca: tlsConfig.ca }),
    },
    pipelining: 1,
  })

  return { dispatcher: agent }
}

/**
 * Clear the mTLS configuration cache.
 */
export function clearMTLSCache(): void {
// clearMTLSCache 清空 mTLS 配置与 Agent 两类 memoize 缓存，便于测试或配置变更后刷新。
  getMTLSConfig.cache.clear?.()
  getMTLSAgent.cache.clear?.()
  logForDebugging('Cleared mTLS configuration cache')
}

/**
 * Configure global Node.js TLS settings
 */
export function configureGlobalMTLS(): void {
// configureGlobalMTLS 仅在有 mTLS 配置时记录提示：NODE_EXTRA_CA_CERTS 由 Node 自动追加到内置 CA，
// 这里只是确认该机制生效，不做额外连接层改动。
  const mtlsConfig = getMTLSConfig()

  if (!mtlsConfig) {
    return
  }

  // NODE_EXTRA_CA_CERTS is automatically handled by Node.js at runtime
  if (process.env.NODE_EXTRA_CA_CERTS) {
    logForDebugging(
      'NODE_EXTRA_CA_CERTS detected - Node.js will automatically append to built-in CAs',
    )
  }
}
