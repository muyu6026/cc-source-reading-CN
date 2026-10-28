/**
 * inc-5046: fetch the official marketplace from a GCS mirror instead of
 * git-cloning GitHub on every startup.
 *
 * Backend (anthropic#317037) publishes a marketplace-only zip alongside the
 * titanium squashfs, keyed by base repo SHA. This module fetches the `latest`
 * pointer, compares against a local sentinel, and downloads+extracts the zip
 * when there's a new SHA. Callers decide fallback behavior on failure.
 */

import axios from 'axios'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { waitForScrollIdle } from '../../bootstrap/state.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import { parseZipModes, unzipFile } from '../dxt/zip.js'
import { errorMessage, getErrnoCode } from '../errors.js'

type SafeString = AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

// CDN-fronted domain for the public GCS bucket (same bucket the native
// binary ships from — nativeInstaller/download.ts:24 uses the raw GCS URL).
// `{sha}.zip` is content-addressed so CDN can cache it indefinitely;
// `latest` has Cache-Control: max-age=300 so CDN staleness is bounded.
// Backend (anthropic#317037) populates this prefix.
const GCS_BASE =
  'https://downloads.claude.ai/claude-code-releases/plugins/claude-plugins-official'
// GCS 下载基址：与本地二进制同一公共桶（原生安装器也用这个原始 GCS URL），按 base repo SHA 内容寻址。

// Zip arc paths are seed-dir-relative (marketplaces/claude-plugins-official/…)
// so the titanium seed machinery can use the same zip. Strip this prefix when
// extracting for a laptop install.
const ARC_PREFIX = 'marketplaces/claude-plugins-official/'
// 归档内路径前缀：zip 里的条目都以 marketplaces/claude-plugins-official/ 开头，解压到笔记本安装时要把这段剥掉。

/**
 * Fetch the official marketplace from GCS and extract to installLocation.
 * Idempotent — checks a `.gcs-sha` sentinel before downloading the ~3.5MB zip.
 *
 * @param installLocation where to extract (must be inside marketplacesCacheDir)
 * @param marketplacesCacheDir the plugins marketplace cache root — passed in
 *   by callers (rather than imported from pluginDirectories) to break a
 *   circular-dep edge through marketplaceManager
 * @returns the fetched SHA on success (including no-op), null on any failure
 *   (network, 404, zip parse). Caller decides whether to fall through to git.
 */
export async function fetchOfficialMarketplaceFromGcs(
  installLocation: string,
  marketplacesCacheDir: string,
): Promise<string | null> {
// 幂等拉取官方市场：先比对 .gcs-sha 哨兵，仅在新 SHA 时下载约 3.5MB 的 zip 并解压；失败返回 null 由调用方决定回退 git。
  // Defense in depth: this function does `rm(installLocation, {recursive})`
  // during the atomic swap. A corrupted known_marketplaces.json (gh-32793 —
  // Windows path read on WSL, literal tilde, manual edit) could point at the
  // user's project. Refuse any path outside the marketplaces cache dir.
  // Same guard as refreshMarketplace() at marketplaceManager.ts:~2392 but
  // inside the function so ALL callers are covered.
  const cacheDir = resolve(marketplacesCacheDir)
// 防御式校验：解析后拒绝落在市场缓存目录之外的任何路径（防损坏的 known_marketplaces.json 指向用户工程）。
  const resolvedLoc = resolve(installLocation)
  if (resolvedLoc !== cacheDir && !resolvedLoc.startsWith(cacheDir + sep)) {
    logForDebugging(
      `fetchOfficialMarketplaceFromGcs: refusing path outside cache dir: ${installLocation}`,
      { level: 'error' },
    )
    return null
  }

  // Network + zip extraction competes for the event loop with scroll frames.
  // This is a fire-and-forget startup call — delaying by a few hundred ms
  // until scroll settles is invisible to the user.
  await waitForScrollIdle()
// 先等滚动空闲再联网，避免与滚动帧抢事件循环（启动期 fire-and-forget，几百毫秒延迟用户无感）。

  const start = performance.now()
  let outcome: 'noop' | 'updated' | 'failed' = 'failed'
  let sha: string | undefined
  let bytes: number | undefined
  let errKind: string | undefined

  try {
    // 1. Latest pointer — ~40 bytes, backend sets Cache-Control: no-cache,
    //    max-age=300. Cheap enough to hit every startup.
    const latest = await axios.get(`${GCS_BASE}/latest`, {
// 第一步取 latest 指针（约 40 字节，Cache-Control 短），每次启动都打，成本低。
      responseType: 'text',
      timeout: 10_000,
    })
    sha = String(latest.data).trim()
    if (!sha) {
      // Empty /latest body — backend misconfigured. Bail (null), don't
      // lock into a permanently-broken empty-sentinel state.
      throw new Error('latest pointer returned empty body')
    }

    // 2. Sentinel check — `.gcs-sha` at the install root holds the last
    //    extracted SHA. Matching means we already have this content.
    const sentinelPath = join(installLocation, '.gcs-sha')
// 第二步读 .gcs-sha 哨兵；命中即视为已是最新，直接 noop 返回（不重复下载）。
    const currentSha = await readFile(sentinelPath, 'utf8').then(
      s => s.trim(),
      () => null, // ENOENT — first fetch, proceed to download
    )
    if (currentSha === sha) {
      outcome = 'noop'
      return sha
    }

    // 3. Download zip and extract to a staging dir, then atomic-swap into
    //    place. Crash mid-extract leaves a .staging dir (next run rm's it)
    //    rather than a half-written installLocation.
    const zipResp = await axios.get(`${GCS_BASE}/${sha}.zip`, {
// 第三步下载 zip 到临时目录再原子交换；解压中途崩溃只留 .staging（下次清理），而不是半写的安装位置。
      responseType: 'arraybuffer',
      timeout: 60_000,
    })
    const zipBuf = Buffer.from(zipResp.data)
    bytes = zipBuf.length
    const files = await unzipFile(zipBuf)
    // fflate doesn't surface external_attr, so parse the central directory
    // ourselves to recover exec bits. Without this, hooks/scripts extract as
    // 0644 and `sh -c "/path/script.sh"` (hooks.ts:~1002) fails with EACCES
    // on Unix. Git-clone preserves +x natively; this keeps GCS at parity.
    const modes = parseZipModes(zipBuf)
// fflate 不暴露 exec 位，于是自行解析 zip 中央目录恢复 Unix 权限，使 GCS 路径与 git 克隆的 +x 对齐（否则 Unix 上 sh 调用脚本会 EACCES）。

    const staging = `${installLocation}.staging`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    for (const [arcPath, data] of Object.entries(files)) {
      if (!arcPath.startsWith(ARC_PREFIX)) continue
      const rel = arcPath.slice(ARC_PREFIX.length)
      if (!rel || rel.endsWith('/')) continue // prefix dir entry or subdir entry
      const dest = join(staging, rel)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, data)
      const mode = modes[arcPath]
      if (mode && mode & 0o111) {
// 仅当某条目带可执行位才 chmod，普通文件跳过以省系统调用；吞掉 EPERM/ENOTSUP（丢 +x 优于中断解压）。
        // Only chmod when an exec bit is set — skip plain files to save syscalls.
        // Swallow EPERM/ENOTSUP (NFS root_squash, some FUSE mounts) — losing +x
        // is the pre-PR behavior and better than aborting mid-extraction.
        await chmod(dest, mode & 0o777).catch(() => {})
      }
    }
    await writeFile(join(staging, '.gcs-sha'), sha)

    // Atomic swap: rm old, rename staging. Brief window where installLocation
    // doesn't exist — acceptable for a background refresh (caller retries next
    // startup if it crashes here).
    await rm(installLocation, { recursive: true, force: true })
// 原子交换：删旧 + 改名；交换瞬间安装位置不存在，作为后台刷新可接受（崩溃则下次启动重试）。
    await rename(staging, installLocation)

    outcome = 'updated'
    return sha
  } catch (e) {
    errKind = classifyGcsError(e)
    logForDebugging(
      `Official marketplace GCS fetch failed: ${errorMessage(e)}`,
      { level: 'warn' },
    )
    return null
  } finally {
    // tengu_plugin_remote_fetch schema shared with the telemetry PR
    // (.daisy/inc-5046/index.md) — adds source:'marketplace_gcs'. All string
    // values below are static enums or a git SHA — not code/filepaths/PII.
    logEvent('tengu_plugin_remote_fetch', {
// finally 里上报 tengu_plugin_remote_fetch 遥测（source 为 marketplace_gcs），所有字符串均为静态枚举或 git SHA，不含代码/路径/隐私。
      source: 'marketplace_gcs' as SafeString,
      host: 'downloads.claude.ai' as SafeString,
      is_official: true,
      outcome: outcome as SafeString,
      duration_ms: Math.round(performance.now() - start),
      ...(bytes !== undefined && { bytes }),
      ...(sha && { sha: sha as SafeString }),
      ...(errKind && { error_kind: errKind as SafeString }),
    })
  }
}

// Bounded set of errno codes we report by name. Anything else buckets as
// fs_other to keep dashboard cardinality tractable.
const KNOWN_FS_CODES = new Set([
  'ENOSPC',
  'EACCES',
  'EPERM',
  'EXDEV',
  'EBUSY',
  'ENOENT',
  'ENOTDIR',
  'EROFS',
  'EMFILE',
  'ENAMETOOLONG',
])

/**
 * Classify a GCS fetch error into a stable telemetry bucket.
 *
 * Telemetry from v2.1.83+ showed 50% of failures landing in 'other' — and
 * 99.99% of those had both sha+bytes set, meaning download succeeded but
 * extraction/fs failed. This splits that bucket so we can see whether the
 * failures are fixable (wrong staging dir, cross-device rename) or inherent
 * (disk full, permission denied) before flipping the git-fallback kill switch.
 */
export function classifyGcsError(e: unknown): string {
// 把失败归入稳定遥测桶（timeout/network/http_*/fs_*/zip_parse/empty_latest/other），以便决定是否翻 git 回退开关。
  if (axios.isAxiosError(e)) {
    if (e.code === 'ECONNABORTED') return 'timeout'
    if (e.response) return `http_${e.response.status}`
    return 'network'
  }
  const code = getErrnoCode(e)
  // Node fs errno codes are E<UPPERCASE> (ENOSPC, EACCES). Axios also sets
  // .code (ERR_NETWORK, ERR_BAD_OPTION, EPROTO) — don't bucket those as fs.
  if (code && /^E[A-Z]+$/.test(code) && !code.startsWith('ERR_')) {
    return KNOWN_FS_CODES.has(code) ? `fs_${code}` : 'fs_other'
  }
  // fflate sets numeric .code (0-14) on inflate/unzip errors — catches
  // deflate-level corruption ("unexpected EOF", "invalid block type") that
  // the message regex misses.
  if (typeof (e as { code?: unknown })?.code === 'number') return 'zip_parse'
  const msg = errorMessage(e)
  if (/unzip|invalid zip|central directory/i.test(msg)) return 'zip_parse'
  if (/empty body/.test(msg)) return 'empty_latest'
  return 'other'
}
