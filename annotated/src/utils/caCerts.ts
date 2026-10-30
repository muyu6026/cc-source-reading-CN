import memoize from 'lodash-es/memoize.js'
import { logForDebugging } from './debug.js'
import { hasNodeOption } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'

/**
 * Load CA certificates for TLS connections.
 *
 * Since setting `ca` on an HTTPS agent replaces the default certificate store,
 * we must always include base CAs (either system or bundled Mozilla) when returning.
 *
 * Returns undefined when no custom CA configuration is needed, allowing the
 * runtime's default certificate handling to apply.
 *
 * Behavior:
 * - Neither NODE_EXTRA_CA_CERTS nor --use-system-ca/--use-openssl-ca set: undefined (runtime defaults)
 * - NODE_EXTRA_CA_CERTS only: bundled Mozilla CAs + extra cert file contents
 * - --use-system-ca or --use-openssl-ca only: system CAs
 * - --use-system-ca + NODE_EXTRA_CA_CERTS: system CAs + extra cert file contents
 *
 * Memoized for performance. Call clearCACertsCache() to invalidate after
 * environment variable changes (e.g., after trust dialog applies settings.json).
 *
 * Reads ONLY `process.env.NODE_EXTRA_CA_CERTS`. `caCertsConfig.ts` populates
 * that env var from settings.json at CLI init; this module stays config-free
 * so `proxy.ts`/`mtls.ts` don't transitively pull in the command registry.
 */
// 文件级说明：为 TLS 连接加载 CA 证书，只认 NODE_EXTRA_CA_CERTS，保持配置无关以便 proxy 与 mtls 不污染命令注册表。
export const getCACertificates = memoize((): string[] | undefined => {
  const useSystemCA =
    hasNodeOption('--use-system-ca') || hasNodeOption('--use-openssl-ca')

  const extraCertsPath = process.env.NODE_EXTRA_CA_CERTS

  logForDebugging(
    `CA certs: useSystemCA=${useSystemCA}, extraCertsPath=${extraCertsPath}`,
  )

  // If neither is set, return undefined (use runtime defaults, no override)
  if (!useSystemCA && !extraCertsPath) {
    return undefined
  }

  // Deferred load: Bun's node:tls module eagerly materializes ~150 Mozilla
  // root certificates (~750KB heap) on import, even if tls.rootCertificates
  // is never accessed. Most users hit the early return above, so we only
  // pay this cost when custom CA handling is actually needed.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const tls = require('tls') as typeof import('tls')
  /* eslint-enable @typescript-eslint/no-require-imports */

// 延迟加载 tls：Bun 会在导入时 eager 物化约 150 个 Mozilla 根证书，故仅在确需自定义 CA 时才 require。
  const certs: string[] = []

  if (useSystemCA) {
    // Load system CA store (Bun API)
    const getCACerts = (
      tls as typeof tls & { getCACertificates?: (type: string) => string[] }
    ).getCACertificates
    const systemCAs = getCACerts?.('system')
    if (systemCAs && systemCAs.length > 0) {
      certs.push(...systemCAs)
      logForDebugging(
        `CA certs: Loaded ${certs.length} system CA certificates (--use-system-ca)`,
      )
    } else if (!getCACerts && !extraCertsPath) {
      // Under Node.js where getCACertificates doesn't exist and no extra certs,
      // return undefined to let Node.js handle --use-system-ca natively.
      logForDebugging(
        'CA certs: --use-system-ca set but system CA API unavailable, deferring to runtime',
      )
      return undefined
    } else {
      // System CA API returned empty or unavailable; fall back to bundled root certs
      certs.push(...tls.rootCertificates)
      logForDebugging(
        `CA certs: Loaded ${certs.length} bundled root certificates as base (--use-system-ca fallback)`,
      )
    }
  } else {
    // Must include bundled Mozilla CAs as base since ca replaces defaults
    certs.push(...tls.rootCertificates)
    logForDebugging(
      `CA certs: Loaded ${certs.length} bundled root certificates as base`,
    )
  }
// 否则分支：必须附带打包的 Mozilla 根证书作底，因为设置 ca 会替换默认证书库。

  // Append extra certs from file
  if (extraCertsPath) {
    try {
      const extraCert = getFsImplementation().readFileSync(extraCertsPath, {
        encoding: 'utf8',
      })
      certs.push(extraCert)
      logForDebugging(
        `CA certs: Appended extra certificates from NODE_EXTRA_CA_CERTS (${extraCertsPath})`,
      )
    } catch (error) {
      logForDebugging(
        `CA certs: Failed to read NODE_EXTRA_CA_CERTS file (${extraCertsPath}): ${error}`,
        { level: 'error' },
      )
    }
  }

  return certs.length > 0 ? certs : undefined
})
// getCACertificates 收尾：按系统 CA 与额外证书文件组合返回，两者皆无则返回 undefined 交给运行时默认。

/**
 * Clear the CA certificates cache.
 * Call this when environment variables that affect CA certs may have changed
 * (e.g., NODE_EXTRA_CA_CERTS, NODE_OPTIONS).
 */
export function clearCACertsCache(): void {
  getCACertificates.cache.clear?.()
  logForDebugging('Cleared CA certificates cache')
}
// clearCACertsCache 收尾：环境变量变更（如信任弹窗套用设置）后清缓存。
