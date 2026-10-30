/**
 * Minimal module for firing macOS keychain reads in parallel with main.tsx
 * module evaluation, same pattern as startMdmRawRead() in settings/mdm/rawRead.ts.
 *
 * isRemoteManagedSettingsEligible() reads two separate keychain entries
 * SEQUENTIALLY via sync execSync during applySafeConfigEnvironmentVariables():
 *   1. "Claude Code-credentials" (OAuth tokens)  — ~32ms
 *   2. "Claude Code" (legacy API key)            — ~33ms
 * Sequential cost: ~65ms on every macOS startup.
 *
 * Firing both here lets the subprocesses run in parallel with the ~65ms of
 * main.tsx imports. ensureKeychainPrefetchCompleted() is awaited alongside
 * ensureMdmSettingsLoaded() in main.tsx preAction — nearly free since the
 * subprocesses finish during import evaluation. Sync read() and
 * getApiKeyFromConfigOrMacOSKeychain() then hit their caches.
 *
 * Imports stay minimal: child_process + macOsKeychainHelpers.ts (NOT
 * macOsKeychainStorage.ts — that pulls in execa → human-signals →
 * cross-spawn, ~58ms of synchronous module init). The helpers file's own
 * import chain (envUtils, oauth constants, crypto) is already evaluated by
 * startupProfiler.ts at main.tsx:5, so no new module-init cost lands here.
 */
// 文件级说明：在 main.tsx 顶层并行触发 macOS 钥匙串读取，与导入期重叠以隐藏约 65 毫秒开销。

// 超时常数：预取子进程 10 秒上限。
import { execFile } from 'child_process'
import { isBareMode } from '../envUtils.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getMacOsKeychainStorageServiceName,
  getUsername,
  primeKeychainCacheFromPrefetch,
} from './macOsKeychainHelpers.js'

const KEYCHAIN_PREFETCH_TIMEOUT_MS = 10_000

// Shared with auth.ts getApiKeyFromConfigOrMacOSKeychain() so it can skip its
// sync spawn when the prefetch already landed. Distinguishing "not started" (null)
// from "completed with no key" ({ stdout: null }) lets the sync reader only
// trust a completed prefetch.
let legacyApiKeyPrefetch: { stdout: string | null } | null = null
// legacyApiKeyPrefetch 状态：null 表示未开始，{stdout:null} 表示已完成但无键，便于同步读取器只信任完成的预取。

let prefetchPromise: Promise<void> | null = null

type SpawnResult = { stdout: string | null; timedOut: boolean }

function spawnSecurity(serviceName: string): Promise<SpawnResult> {
  return new Promise(resolve => {
    execFile(
      'security',
      ['find-generic-password', '-a', getUsername(), '-w', '-s', serviceName],
      { encoding: 'utf-8', timeout: KEYCHAIN_PREFETCH_TIMEOUT_MS },
      (err, stdout) => {
        // Exit 44 (entry not found) is a valid "no key" result and safe to
        // prime as null. But timeout (err.killed) means the keychain MAY have
        // a key we couldn't fetch — don't prime, let sync spawn retry.
        // biome-ignore lint/nursery/noFloatingPromises: resolve() is not a floating promise
        resolve({
          stdout: err ? null : stdout?.trim() || null,
          timedOut: Boolean(err && 'killed' in err && err.killed),
        })
      },
    )
  })
}
// spawnSecurity 收尾：退出码 44（未找到）视为有效空结果，超时则不打缓存让同步路径重试。

/**
 * Fire both keychain reads in parallel. Called at main.tsx top-level
 * immediately after startMdmRawRead(). Non-darwin is a no-op.
 */
export function startKeychainPrefetch(): void {
  if (process.platform !== 'darwin' || prefetchPromise || isBareMode()) return

  // Fire both subprocesses immediately (non-blocking). They run in parallel
  // with each other AND with main.tsx imports. The await in Promise.all
  // happens later via ensureKeychainPrefetchCompleted().
  const oauthSpawn = spawnSecurity(
    getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX),
  )
  const legacySpawn = spawnSecurity(getMacOsKeychainStorageServiceName())

  prefetchPromise = Promise.all([oauthSpawn, legacySpawn]).then(
    ([oauth, legacy]) => {
      // Timed-out prefetch: don't prime. Sync read/spawn will retry with its
      // own (longer) timeout. Priming null here would shadow a key that the
      // sync path might successfully fetch.
      if (!oauth.timedOut) primeKeychainCacheFromPrefetch(oauth.stdout)
      if (!legacy.timedOut) legacyApiKeyPrefetch = { stdout: legacy.stdout }
    },
  )
}
// startKeychainPrefetch 收尾：两个子进程各自并行，非 darwin 或裸模式为空操作。

/**
 * Await prefetch completion. Called in main.tsx preAction alongside
 * ensureMdmSettingsLoaded() — nearly free since subprocesses finish during
 * the ~65ms of main.tsx imports. Resolves immediately on non-darwin.
 */
export async function ensureKeychainPrefetchCompleted(): Promise<void> {
  if (prefetchPromise) await prefetchPromise
}
// ensureKeychainPrefetchCompleted 收尾：在 preAction 阶段与 MDM 设置加载一起等待，几乎零额外成本。

/**
 * Consumed by getApiKeyFromConfigOrMacOSKeychain() in auth.ts before it
 * falls through to sync execSync. Returns null if prefetch hasn't completed.
 */
export function getLegacyApiKeyPrefetchResult(): {
  stdout: string | null
} | null {
  return legacyApiKeyPrefetch
}
// getLegacyApiKeyPrefetchResult 收尾：在同步 execSync 回退前消费预取结果。

/**
 * Clear prefetch result. Called alongside getApiKeyFromConfigOrMacOSKeychain
 * cache invalidation so a stale prefetch doesn't shadow a fresh write.
 */
export function clearLegacyApiKeyPrefetch(): void {
  legacyApiKeyPrefetch = null
}
// clearLegacyApiKeyPrefetch 收尾：与同步读取缓存失效一起清空，避免陈旧预取遮蔽新写入。
