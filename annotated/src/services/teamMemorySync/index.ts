// 【模块总览】`teamMemorySync/index.ts` 实现「团队记忆」的本地文件 ↔ 服务器双向同步。
// 团队记忆是按 **git remote 哈希**隔离的一堆本地文件，同一个组织（org）里所有登录成员共享。
// 核心就三件事：
// ① 三个 HTTP 接口（GET 拉 / GET ?view=hashes 只拉校验和 / PUT 推）；
// ② 拉取时「服务器优先」（per-key 覆盖本地），推送时「只传差异 + 乐观锁」；
// ③ 所有可变状态收口在调用方创建的 `SyncState` 对象里，模块本身零可变全局状态。
/**
 * Team Memory Sync Service
 *
 * Syncs team memory files between the local filesystem and the server API.
 * Team memory is scoped per-repo (identified by git remote hash) and shared
 * across all authenticated org members.
 *
 * API contract (anthropic/anthropic#250711 + #283027):
 *   GET  /api/claude_code/team_memory?repo={owner/repo}            → TeamMemoryData (includes entryChecksums)
 *   GET  /api/claude_code/team_memory?repo={owner/repo}&view=hashes → metadata + entryChecksums only (no entry bodies)
 *   PUT  /api/claude_code/team_memory?repo={owner/repo}            → upload entries (upsert semantics)
 *   404 = no data exists yet
 *
 * Sync semantics:
 *   - Pull overwrites local files with server content (server wins per-key).
 *   - Push uploads only keys whose content hash differs from serverChecksums
 *     (delta upload). Server uses upsert: keys not in the PUT are preserved.
 *   - File deletions do NOT propagate: deleting a local file won't remove it
 *     from the server, and the next pull will restore it locally.
 *
 * State management:
 *   All mutable state (ETag tracking, watcher suppression) lives in a
 *   SyncState object created by the caller and threaded through every call.
 *   This avoids module-level mutable state and gives tests natural isolation.
 */

import axios from 'axios'
import { createHash } from 'crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { join, relative, sep } from 'path'
import {
  CLAUDE_AI_INFERENCE_SCOPE,
  CLAUDE_AI_PROFILE_SCOPE,
  getOauthConfig,
  OAUTH_BETA_HEADER,
} from '../../constants/oauth.js'
import {
  getTeamMemPath,
  PathTraversalError,
  validateTeamMemKey,
} from '../../memdir/teamMemPaths.js'
import { count } from '../../utils/array.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { classifyAxiosError } from '../../utils/errors.js'
import { getGithubRepo } from '../../utils/git.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { logEvent } from '../analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/metadata.js'
import { getRetryDelay } from '../api/withRetry.js'
import { scanForSecrets } from './secretScanner.js'
import {
  type SkippedSecretFile,
  TeamMemoryDataSchema,
  type TeamMemoryHashesResult,
  type TeamMemorySyncFetchResult,
  type TeamMemorySyncPushResult,
  type TeamMemorySyncUploadResult,
  TeamMemoryTooManyEntriesSchema,
} from './types.js'

// 【第 71-91 行】四个常量，背后是两个容易踩的坑：
// · `MAX_FILE_SIZE_BYTES=250K`：单条 entry 上限，上传前先过滤掉超大文件省带宽；
// · `MAX_PUT_BODY_BYTES=200K`：单个 PUT 请求体上限，**比文件上限更紧**。
//   为什么更紧？API 网关会在请求到达应用服务器之前，用**非结构化的 HTML 413**
//   拒掉 >~256-512KB 的请求——这种网关 413 和「应用层条目数超限」的结构化 413
//   只能靠延迟区分（~750ms vs ~2.3s）。所以宁可把批切小，也别撞网关。
// · `MAX_RETRIES=3` / `MAX_CONFLICT_RETRIES=2`：普通重试 vs 冲突（412）专用重试，分开计数。
const TEAM_MEMORY_SYNC_TIMEOUT_MS = 30_000
// Per-entry size cap — server default from anthropic/anthropic#293258.
// Pre-filtering oversized entries saves bandwidth: the structured 413 for
// this case doesn't give us anything to learn (one file is just too big).
const MAX_FILE_SIZE_BYTES = 250_000
// No client-side DEFAULT_MAX_ENTRIES: the server's entry-count cap is
// GB-tunable per-org (claude_code_team_memory_limits), so any compile-time
// constant here will drift.  We only truncate after learning the effective
// limit from a structured 413's extra_details.max_entries.
// Gateway body-size cap.  The API gateway rejects PUT bodies over ~256-512KB
// with an unstructured (HTML) 413 before the request reaches the app server —
// distinguishable from the app's structured entry-count 413 only by latency
// (~750ms gateway vs ~2.3s app on comparable payloads).  #21969 removed the
// client entry-count cap; cold pushes from heavy users then sent 300KB-1.4MB
// bodies and hit this.  200KB leaves headroom under the observed threshold
// and keeps a single-entry-at-MAX_FILE_SIZE_BYTES solo batch (~250KB) just
// under the real gateway limit.  Batches larger than this are split into
// sequential PUTs — server upsert-merge semantics make that safe.
const MAX_PUT_BODY_BYTES = 200_000
const MAX_RETRIES = 3
const MAX_CONFLICT_RETRIES = 2

// ─── Sync state ─────────────────────────────────────────────

/**
 * Mutable state for the team memory sync service.
 * Created once per session by the watcher and passed to all sync functions.
 * Tests create a fresh instance per test for isolation.
 */
// 【第 95-119 行】`SyncState` 把**所有可变状态**收口到一个对象：
// `lastKnownChecksum`（ETag，条件请求用）、`serverChecksums`（每 key 的 sha256 校验和，算差异用）、
// `serverMaxEntries`（从 413 学来的条目上限）。
// 关键设计：**没有模块级可变变量**，状态由调用方（watcher）创建后一路传进来——
// 这样每个测试用例 new 一个 `SyncState` 就能天然隔离，不用 mock 全局。
export type SyncState = {
  /** Last known server checksum (ETag) for conditional requests. */
  lastKnownChecksum: string | null
  /**
   * Per-key content hash (`sha256:<hex>`) of what we believe the server
   * currently holds. Populated from server-provided entryChecksums on pull
   * and from local hashes on successful push. Used to compute the delta on
   * push — only keys whose local hash differs are uploaded.
   */
  serverChecksums: Map<string, string>
  /**
   * Server-enforced max_entries cap, learned from a structured 413 response
   * (anthropic/anthropic#293258 adds error_code + extra_details.max_entries).
   * Stays null until a 413 is observed — the server's cap is GB-tunable
   * per-org so there is no correct client-side default.  While null,
   * readLocalTeamMemory sends everything and lets the server be
   * authoritative (it rejects atomically).
   */
  serverMaxEntries: number | null
}

export function createSyncState(): SyncState {
  return {
    lastKnownChecksum: null,
    serverChecksums: new Map(),
    serverMaxEntries: null,
  }
}

/**
 * Compute `sha256:<hex>` over the UTF-8 bytes of the given content.
 * Format matches the server's entryChecksums values (anthropic/anthropic#283027)
 * so local-vs-server comparison works by direct string equality.
 */
// 【第 129-136 行】`hashContent` 算 `sha256:<hex>`，**前缀和服务器一致**
// （anthropic/anthropic#283027 约定）。因为格式相同，本地 hash 和服务器 `entryChecksums`
// 就能直接用字符串相等比较，不需要解析。注意前缀是写死的 `sha256:` 字符串，不是 base64。
export function hashContent(content: string): string {
  return 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Type guard narrowing an unknown error to a Node.js errno-style exception.
 * Uses `in` narrowing so no `as` cast is needed at call sites.
 */
// 【第 138-144 行】`isErrnoException` 是一个 **TypeScript 类型守卫**：
// 返回值类型是 `e is NodeJS.ErrnoException`。好处是调用点（比如 626 行）
// 不需要写 `as` 强转，TS 看到 `if (isErrnoException(e))` 就会自动把 `e` 收窄成
// 带 `code` 字段的类型。用 `in` 判断 `'code' in e` 而非 `instanceof` 的字面检查，
// 是因为有些错误对象形态不完全标准，但只要有 `code` 字符串就够了。
function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e && typeof e.code === 'string'
}

// ─── Auth & endpoint ─────────────────────────────────────────

/**
 * Check if user is authenticated with first-party OAuth (required for team memory sync).
 */
// 【第 148-161 行】`isUsingOAuth`：团队记忆同步**强制要求 first-party OAuth**。
// 三层判断：API provider 必须是 firstParty、base URL 必须是 Anthropic 官方、且 token 要同时拥有
// `CLAUDE_AI_INFERENCE_SCOPE` 和 `CLAUDE_AI_PROFILE_SCOPE` 两个 scope。
// 任何一个不满足 → 直接 `return false`，后面的拉/推都会短路失败（见 pull/push 开头的检查）。
function isUsingOAuth(): boolean {
  if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) {
    return false
  }
  const tokens = getClaudeAIOAuthTokens()
  return Boolean(
    tokens?.accessToken &&
      tokens.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE) &&
      tokens.scopes.includes(CLAUDE_AI_PROFILE_SCOPE),
  )
}

// 【第 163-167 行】`getTeamMemorySyncEndpoint` 拼同步接口 URL。
// 两个细节：① 默认用 OAuth 配置里的 `BASE_API_URL`，但可以用环境变量
// `TEAM_MEMORY_SYNC_URL` **整体覆盖**（本地联调服务器时用）；
// ② repo 名用 `encodeURIComponent` 编码——repo 是 `owner/repo` 形式，斜杠必须编码，否则会被当成路径分隔。
function getTeamMemorySyncEndpoint(repoSlug: string): string {
  const baseUrl =
    process.env.TEAM_MEMORY_SYNC_URL || getOauthConfig().BASE_API_URL
  return `${baseUrl}/api/claude_code/team_memory?repo=${encodeURIComponent(repoSlug)}`
}

// 【第 169-184 行】`getAuthHeaders` 组装请求头：Bearer token + `anthropic-beta`
// （OAuth 功能在 beta header 后才会生效）+ `User-Agent`。
// 注意返回类型带 `error?` 字段：拿不到 token 时不抛异常，而是返回 `{ error: '...' }`，
// 让调用方决定「这是 skipRetry 的致命错误」还是别的。这种「不抛异常、用返回值表达错误」
// 的模式贯穿整个文件（fetch/upload 都是返回带 `errorType` 的对象）。
function getAuthHeaders(): {
  headers?: Record<string, string>
  error?: string
} {
  const oauthTokens = getClaudeAIOAuthTokens()
  if (oauthTokens?.accessToken) {
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        'User-Agent': getClaudeCodeUserAgent(),
      },
    }
  }
  return { error: 'No OAuth token available for team memory sync' }
}

// ─── Fetch (pull) ────────────────────────────────────────────

// 【第 188-306 行】`fetchTeamMemoryOnce` —— 单次「拉」的核心。
// 几个非显而易见的点：
// · `validateStatus` 把 304 / 404 / 200 都当成「成功」（不抛异常），其余状态码才进 catch；
//   这样「服务器没数据（404）」「没变化（304）」都能在 try 里正常返回，不用走异常分支。
// · 304 走 `notModified` 分支，直接复用传进来的 etag，ETag 链不断；
// · 404 把 `lastKnownChecksum` 清成 null（代表「服务器上根本没有这份数据」）；
// · 解析失败（响应格式不对）也标 `skipRetry`，因为再试也不会变好。
async function fetchTeamMemoryOnce(
  state: SyncState,
  repoSlug: string,
  etag?: string | null,
): Promise<TeamMemorySyncFetchResult> {
  try {
    await checkAndRefreshOAuthTokenIfNeeded()

    const auth = getAuthHeaders()
    if (auth.error) {
      return {
        success: false,
        error: auth.error,
        skipRetry: true,
        errorType: 'auth',
      }
    }

    const headers: Record<string, string> = { ...auth.headers }
    if (etag) {
      headers['If-None-Match'] = `"${etag.replace(/"/g, '')}"`
    }

    const endpoint = getTeamMemorySyncEndpoint(repoSlug)
    const response = await axios.get(endpoint, {
      headers,
      timeout: TEAM_MEMORY_SYNC_TIMEOUT_MS,
      validateStatus: status =>
        status === 200 || status === 304 || status === 404,
    })
// 【第 215-217 行】`validateStatus` 是 axios 的「哪些状态码算成功」回调。
// 默认 axios 只在 2xx 抛错，但这里把 304 / 404 也纳入「不抛错」范围——
// 因为对这个同步接口而言，304（没改）和 404（没有数据）都是**正常的业务结果**，
// 不是网络/服务器错误。把业务结果从异常流里捞出来，代码分支才清晰。

    if (response.status === 304) {
      logForDebugging('team-memory-sync: not modified (304)', {
        level: 'debug',
      })
      return { success: true, notModified: true, checksum: etag ?? undefined }
    }

    if (response.status === 404) {
      logForDebugging('team-memory-sync: no remote data (404)', {
        level: 'debug',
      })
      state.lastKnownChecksum = null
      return { success: true, isEmpty: true }
    }

    const parsed = TeamMemoryDataSchema().safeParse(response.data)
    if (!parsed.success) {
      logForDebugging('team-memory-sync: invalid response format', {
        level: 'warn',
      })
      return {
        success: false,
        error: 'Invalid team memory response format',
        skipRetry: true,
        errorType: 'parse',
      }
    }

    // Extract checksum from response data or ETag header
    const responseChecksum =
      parsed.data.checksum ||
      response.headers['etag']?.replace(/^"|"$/g, '') ||
      undefined
    if (responseChecksum) {
      state.lastKnownChecksum = responseChecksum
    }

    logForDebugging(
      `team-memory-sync: fetched successfully (checksum: ${responseChecksum ?? 'none'})`,
      { level: 'debug' },
    )
    return {
      success: true,
      data: parsed.data,
      isEmpty: false,
      checksum: responseChecksum,
    }
  } catch (error) {
    const { kind, status, message } = classifyAxiosError(error)
    const body = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? '')
      : ''
    if (kind !== 'other') {
      logForDebugging(`team-memory-sync: fetch error ${status}: ${body}`, {
        level: 'warn',
      })
    }
    switch (kind) {
      case 'auth':
        return {
          success: false,
          error: `Not authorized for team memory sync: ${body}`,
          skipRetry: true,
          errorType: 'auth',
          httpStatus: status,
        }
      case 'timeout':
        return {
          success: false,
          error: 'Team memory sync request timeout',
          errorType: 'timeout',
        }
      case 'network':
        return {
          success: false,
          error: 'Cannot connect to server',
          errorType: 'network',
        }
      default:
        return {
          success: false,
          error: message,
          errorType: 'unknown',
          httpStatus: status,
        }
    }
  }
}

/**
 * Fetch only per-key checksums + metadata (no entry bodies).
 * Used for cheap serverChecksums refresh during 412 conflict resolution — avoids
 * downloading ~300KB of content just to learn which keys changed.
 * Requires anthropic/anthropic#283027 deployed; on failure the caller fails the
 * push and the watcher retries on the next edit.
 */
// 【第 308-385 行】`fetchTeamMemoryHashes` —— 冲突解决时的「廉价探针」。
// 它只请求 `?view=hashes`，服务器**只回每 key 的校验和 + 元数据，不回条目正文**。
// 为什么需要它？当推送遇到 412 冲突时，如果先拉全量正文（~300KB）只为知道「哪些 key 变了」，
// 太浪费；这个接口用极小的响应就能刷新 `serverChecksums`，让下一轮 delta 把队友刚推的内容自然排除。
// 它依赖 anthropic/anthropic#283027 部署；若服务器不支持，调用方会让本次推送失败、等下次编辑再重试。
async function fetchTeamMemoryHashes(
  state: SyncState,
  repoSlug: string,
): Promise<TeamMemoryHashesResult> {
  try {
    await checkAndRefreshOAuthTokenIfNeeded()
    const auth = getAuthHeaders()
    if (auth.error) {
      return { success: false, error: auth.error, errorType: 'auth' }
    }

    const endpoint = getTeamMemorySyncEndpoint(repoSlug) + '&view=hashes'
    const response = await axios.get(endpoint, {
      headers: auth.headers,
      timeout: TEAM_MEMORY_SYNC_TIMEOUT_MS,
      validateStatus: status => status === 200 || status === 404,
    })

    if (response.status === 404) {
      state.lastKnownChecksum = null
      return { success: true, entryChecksums: {} }
    }

    const checksum =
      response.data?.checksum || response.headers['etag']?.replace(/^"|"$/g, '')
    const entryChecksums = response.data?.entryChecksums

    // Requires anthropic/anthropic#283027. If entryChecksums is missing,
    // treat as a probe failure — caller fails the push; watcher retries.
    if (!entryChecksums || typeof entryChecksums !== 'object') {
      return {
        success: false,
        error:
          'Server did not return entryChecksums (?view=hashes unsupported)',
        errorType: 'parse',
      }
    }

    if (checksum) {
      state.lastKnownChecksum = checksum
    }
    return {
      success: true,
      version: response.data?.version,
      checksum,
      entryChecksums,
    }
  } catch (error) {
    const { kind, status, message } = classifyAxiosError(error)
    switch (kind) {
      case 'auth':
        return {
          success: false,
          error: 'Not authorized',
          errorType: 'auth',
          httpStatus: status,
        }
      case 'timeout':
        return { success: false, error: 'Timeout', errorType: 'timeout' }
      case 'network':
        return { success: false, error: 'Network error', errorType: 'network' }
      default:
        return {
          success: false,
          error: message,
          errorType: 'unknown',
          httpStatus: status,
        }
    }
  }
}

// 【第 387-410 行】`fetchTeamMemory` —— 给「拉」套一层重试。
// 循环 `MAX_RETRIES + 1` 次：某次成功、或结果带 `skipRetry`（鉴权/解析失败这类不可逆错误）
// 就立刻返回，不白等；否则按 `getRetryDelay(attempt)` 退避后重试。
// 注意 `lastResult!` 这个非空断言：循环至少走一次，所以结束时一定有值。
async function fetchTeamMemory(
  state: SyncState,
  repoSlug: string,
  etag?: string | null,
): Promise<TeamMemorySyncFetchResult> {
  let lastResult: TeamMemorySyncFetchResult | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    lastResult = await fetchTeamMemoryOnce(state, repoSlug, etag)
    if (lastResult.success || lastResult.skipRetry) {
      return lastResult
    }
    if (attempt > MAX_RETRIES) {
      return lastResult
    }
    const delayMs = getRetryDelay(attempt)
    logForDebugging(`team-memory-sync: retry ${attempt}/${MAX_RETRIES}`, {
      level: 'debug',
    })
    await sleep(delayMs)
  }

  return lastResult!
}

// ─── Upload (push) ───────────────────────────────────────────

/**
 * Split a delta into PUT-sized batches under MAX_PUT_BODY_BYTES each.
 *
 * Greedy bin-packing over sorted keys — sorting gives deterministic batches
 * across calls, which matters for ETag stability if the conflict loop retries
 * after a partial commit.  The byte count is the full serialized body
 * including JSON overhead, so what we measure is what axios sends.
 *
 * A single entry exceeding MAX_PUT_BODY_BYTES goes into its own solo batch
 * (MAX_FILE_SIZE_BYTES=250K already caps individual files; a ~250K solo body
 * is above our soft cap but below the gateway's observed real threshold).
 */
// 【第 414-460 行】`batchDeltaByBytes` —— 把差异按**字节数**贪心装箱成多个 PUT。
// 两个关键点：
// ① **先 `Object.keys(delta).sort()` 再装箱**——排序保证每次调用分出的批次完全一致，
//   这对「冲突循环在部分提交后重试」时的 ETag 稳定至关重要（不排序，Promise.all 按完成顺序，
//   每次截断的子集都不同，delta 会膨胀成近乎全量快照）；
// ② 单条 entry 超过 `MAX_PUT_BODY_BYTES` 时单独成批（250K 文件 ≈ 一个略超软上限、但低于网关实测阈值的批）。
//   每个批都是独立的 upsert PUT——批 N 失败，1..N-1 已经在服务器端提交。
export function batchDeltaByBytes(
  delta: Record<string, string>,
): Array<Record<string, string>> {
  const keys = Object.keys(delta).sort()
  if (keys.length === 0) return []

  // Fixed overhead for `{"entries":{}}` — each entry then adds its marginal
  // bytes.  jsonStringify (≡ JSON.stringify under the hood) on the raw
  // strings handles escaping so the count matches what axios serializes.
  const EMPTY_BODY_BYTES = Buffer.byteLength('{"entries":{}}', 'utf8')
  const entryBytes = (k: string, v: string): number =>
    Buffer.byteLength(jsonStringify(k), 'utf8') +
    Buffer.byteLength(jsonStringify(v), 'utf8') +
    2 // colon + comma (comma over-counts by 1 on the last entry; harmless slack)

  const batches: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  let currentBytes = EMPTY_BODY_BYTES

  for (const key of keys) {
    const added = entryBytes(key, delta[key]!)
    if (
      currentBytes + added > MAX_PUT_BODY_BYTES &&
      Object.keys(current).length > 0
    ) {
      batches.push(current)
      current = {}
      currentBytes = EMPTY_BODY_BYTES
    }
    current[key] = delta[key]!
    currentBytes += added
  }
  batches.push(current)
  return batches
}

// 【第 462-553 行】`uploadTeamMemory` —— 单次「推」。
// · 带上 `If-Match: "<checksum>"` 做**乐观锁**：服务器持有旧 etag 时返回 412（冲突），否则 200；
// · 412 直接返回 `conflict: true`，把「要不要重试」留给上层 `pushTeamMemory` 决定；
// · 413（anthropic/anthropic#293258）是**结构化错误**：`error_code` + `extra_details.max_entries`
//   告诉客户端「本 org 的有效条目上限是多少」（这个上限是 per-org GB 可调的，客户端没法写死默认值）。
//   把学到的 `serverMaxEntries` 缓存进 `SyncState`，下次推送就会先截断到正确数量。
async function uploadTeamMemory(
  state: SyncState,
  repoSlug: string,
  entries: Record<string, string>,
  ifMatchChecksum?: string | null,
): Promise<TeamMemorySyncUploadResult> {
  try {
    await checkAndRefreshOAuthTokenIfNeeded()

    const auth = getAuthHeaders()
    if (auth.error) {
      return { success: false, error: auth.error, errorType: 'auth' }
    }

    const headers: Record<string, string> = {
      ...auth.headers,
      'Content-Type': 'application/json',
    }
    if (ifMatchChecksum) {
      headers['If-Match'] = `"${ifMatchChecksum.replace(/"/g, '')}"`
    }

    const endpoint = getTeamMemorySyncEndpoint(repoSlug)
    const response = await axios.put(
      endpoint,
      { entries },
      {
        headers,
        timeout: TEAM_MEMORY_SYNC_TIMEOUT_MS,
        validateStatus: status => status === 200 || status === 412,
      },
    )

    if (response.status === 412) {
      logForDebugging('team-memory-sync: conflict (412 Precondition Failed)', {
        level: 'info',
      })
      return { success: false, conflict: true, error: 'ETag mismatch' }
    }

    const responseChecksum = response.data?.checksum
    if (responseChecksum) {
      state.lastKnownChecksum = responseChecksum
    }

    logForDebugging(
      `team-memory-sync: uploaded ${Object.keys(entries).length} entries (checksum: ${responseChecksum ?? 'none'})`,
      { level: 'debug' },
    )
    return {
      success: true,
      checksum: responseChecksum,
      lastModified: response.data?.lastModified,
    }
  } catch (error) {
    const body = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? '')
      : ''
    logForDebugging(
      `team-memory-sync: upload failed: ${error instanceof Error ? error.message : ''} ${body}`,
      { level: 'warn' },
    )
    const { kind, status: httpStatus, message } = classifyAxiosError(error)
    const errorType = kind === 'http' || kind === 'other' ? 'unknown' : kind
    let serverErrorCode: 'team_memory_too_many_entries' | undefined
    let serverMaxEntries: number | undefined
    let serverReceivedEntries: number | undefined
    // Parse structured 413 (anthropic/anthropic#293258). The server's
    // RequestTooLargeException includes error_code + extra_details with
    // the effective max_entries (may be GB-tuned per-org). Cache it so
    // the next push trims to the right value.
    if (httpStatus === 413 && axios.isAxiosError(error)) {
      const parsed = TeamMemoryTooManyEntriesSchema().safeParse(
        error.response?.data,
      )
      if (parsed.success) {
        serverErrorCode = parsed.data.error.details.error_code
        serverMaxEntries = parsed.data.error.details.max_entries
        serverReceivedEntries = parsed.data.error.details.received_entries
      }
    }
    return {
      success: false,
      error: message,
      errorType,
      httpStatus,
      ...(serverErrorCode !== undefined && { serverErrorCode }),
      ...(serverMaxEntries !== undefined && { serverMaxEntries }),
      ...(serverReceivedEntries !== undefined && { serverReceivedEntries }),
    }
  }
}

// ─── Local file operations ───────────────────────────────────

/**
 * Read all team memory files from the local directory into a flat key-value map.
 * Keys are relative paths from the team memory directory.
 * Empty files are included (content will be empty string).
 *
 * PSR M22174: Each file is scanned for credentials before inclusion
 * using patterns from gitleaks. Files containing secrets are SKIPPED
 * (not uploaded) and collected in skippedSecrets so the caller can
 * warn the user.
 */
// 【第 557-673 行】`readLocalTeamMemory` —— 把本地目录读成 `key→内容` 的扁平 map。
// 两个安全/稳定性要点（PSR M22174）：
// ① **上传前先扫密钥**：每个文件用 gitleaks 规则 `scanForSecrets` 扫一遍，命中就**整文件跳过**
//   （绝不离开本机），并把命中信息收进 `skippedSecrets` 让上层警告用户——密钥值本身绝不记录/上报；
// ② **只在从服务器学到 cap 之后才截断**：条目数上限是 per-org 可调的，没学到之前一律全传，
//   让服务器当裁判（它在合并后校验总数、原子拒绝，413 时不写任何东西）。截断前先 `sort()`，
//   保证「被截断的总是同一批字母序靠后的 key」，否则 delta 计算会失稳。
async function readLocalTeamMemory(maxEntries: number | null): Promise<{
  entries: Record<string, string>
  skippedSecrets: SkippedSecretFile[]
}> {
  const teamDir = getTeamMemPath()
  const entries: Record<string, string> = {}
  const skippedSecrets: SkippedSecretFile[] = []

  async function walkDir(dir: string): Promise<void> {
    try {
      const dirEntries = await readdir(dir, { withFileTypes: true })
      await Promise.all(
        dirEntries.map(async entry => {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walkDir(fullPath)
          } else if (entry.isFile()) {
            try {
              const stats = await stat(fullPath)
              if (stats.size > MAX_FILE_SIZE_BYTES) {
                logForDebugging(
                  `team-memory-sync: skipping oversized file ${entry.name} (${stats.size} > ${MAX_FILE_SIZE_BYTES} bytes)`,
                  { level: 'info' },
                )
                return
              }
              const content = await readFile(fullPath, 'utf8')
              const relPath = relative(teamDir, fullPath).replaceAll('\\', '/')

              // PSR M22174: scan for secrets BEFORE adding to the upload
              // payload. If a secret is detected, skip this file entirely
              // so it never leaves the machine.
              const secretMatches = scanForSecrets(content)
// 【第 596-615 行】密钥扫描的落地处：在把文件塞进上传 map **之前**就 `scanForSecrets`。
// 只报告每文件第一个命中（一条密钥足够跳过，也不想多记凭据位置）。
// 被跳过的文件 `return` 掉、不进 `entries`——所以它在「本地→服务器」方向上**永远不会泄露密钥**，
// 而「服务器→本地」方向由 `writeRemoteEntriesToLocal` 负责（服务器内容本身可信，但仍校验路径边界）。
              if (secretMatches.length > 0) {
                // Report only the first match per file — one secret is
                // enough to skip the file and we don't want to log more
                // than necessary about credential locations.
                const firstMatch = secretMatches[0]!
                skippedSecrets.push({
                  path: relPath,
                  ruleId: firstMatch.ruleId,
                  label: firstMatch.label,
                })
                logForDebugging(
                  `team-memory-sync: skipping "${relPath}" — detected ${firstMatch.label}`,
                  { level: 'warn' },
                )
                return
              }

              entries[relPath] = content
            } catch {
              // Skip unreadable files
            }
          }
        }),
      )
    } catch (e) {
      if (isErrnoException(e)) {
        if (e.code !== 'ENOENT' && e.code !== 'EACCES' && e.code !== 'EPERM') {
          throw e
        }
      } else {
        throw e
      }
    }
  }

  await walkDir(teamDir)

  // Truncate only if we've LEARNED a cap from the server (via a structured
  // 413's extra_details.max_entries — anthropic/anthropic#293258).  The
  // server's entry-count cap is GB-tunable per-org via
  // claude_code_team_memory_limits; we have no way to know it in advance.
  // Before the first 413 we send everything and let the server be
  // authoritative.  The server validates total stored entries after merge
  // (not PUT body count) and rejects atomically — nothing is written on 413.
  //
  // Sorting before truncation is what makes delta computation work: without
  // it, the parallel walk above picks a different N-of-M subset each push
  // (Promise.all resolves in completion order), serverChecksums misses keys,
  // and the "delta" balloons to near-full snapshot.  With deterministic
  // truncation, the same N keys are compared against the same server state.
  //
  // When disk has more files than the learned cap, alphabetically-last ones
  // consistently never sync.  When the merged (server + delta) count exceeds
  // the cap we still fail — recovering requires soft_delete_keys.
  const keys = Object.keys(entries).sort()
// 【第 654-671 行】排序后再截断，是 delta 稳定的关键。
// `Object.keys(entries).sort()` 之后才 `slice(maxEntries)`：磁盘文件数超过学到的上限时，
// **字母序靠后的那些 key 永远同步不出去**（这是已知取舍，注释里也写了「要恢复得用 soft_delete_keys」）。
// 截断时还会 `logEvent('tengu_team_mem_entries_capped', ...)` 上报，方便产品侧知道有多少用户撞到了上限。
  if (maxEntries !== null && keys.length > maxEntries) {
    const dropped = keys.slice(maxEntries)
    logForDebugging(
      `team-memory-sync: ${keys.length} local entries exceeds server cap of ${maxEntries}; ${dropped.length} file(s) will NOT sync: ${dropped.join(', ')}. Consider consolidating or removing some team memory files.`,
      { level: 'warn' },
    )
    logEvent('tengu_team_mem_entries_capped', {
      total_entries: keys.length,
      dropped_count: dropped.length,
      max_entries: maxEntries,
    })
    const truncated: Record<string, string> = {}
    for (const key of keys.slice(0, maxEntries)) {
      truncated[key] = entries[key]!
    }
    return { entries: truncated, skippedSecrets }
  }
  return { entries, skippedSecrets }
}

/**
 * Write remote team memory entries to the local directory.
 * Validates every path against the team memory directory boundary.
 * Skips entries whose on-disk content already matches, so unchanged
 * files keep their mtime and don't spuriously invalidate the
 * getMemoryFiles cache or trigger watcher events.
 *
 * Parallel: each entry is processed independently (validate + read-compare
 * + mkdir + write). Concurrent mkdir on a shared parent is safe with
 * recursive: true (EEXIST is swallowed). The initial pull is the long
 * pole in startTeamMemoryWatcher — p99 was ~22s serial at 50 entries.
 *
 * Returns the number of files actually written.
 */
// 【第 675-755 行】`writeRemoteEntriesToLocal` —— 把服务器条目写回本地。
// 几个非显而易见的点：
// · 每条 key 先用 `validateTeamMemKey` 校验路径，**防路径穿越**（服务器不能借一个 `../../etc/passwd`
//   这样的 key 写坏你机器上的任意文件）；`PathTraversalError` 单独 catch 掉、跳过该条；
// · **内容相同就跳过**（先 readFile 比对）：这能保住未改文件的 mtime，不会无谓地让
//   `getMemoryFiles` 缓存失效、也不会触发文件变更 watcher 事件；
// · 并行写（`Promise.all` + `mkdir(recursive:true)`）：并发 mkdir 同一个父目录是安全的，
//   `EEXIST` 被 recursive 模式吞掉。冷启动首次拉取是 watcher 的最长耗时项（50 条时 p99 串行 ~22s，
//   改成并行后大幅缩短）。
async function writeRemoteEntriesToLocal(
  entries: Record<string, string>,
): Promise<number> {
  const results = await Promise.all(
    Object.entries(entries).map(async ([relPath, content]) => {
      let validatedPath: string
      try {
        validatedPath = await validateTeamMemKey(relPath)
      } catch (e) {
        if (e instanceof PathTraversalError) {
          logForDebugging(`team-memory-sync: ${e.message}`, { level: 'warn' })
          return false
        }
        throw e
      }

      const sizeBytes = Buffer.byteLength(content, 'utf8')
      if (sizeBytes > MAX_FILE_SIZE_BYTES) {
        logForDebugging(
          `team-memory-sync: skipping oversized remote entry "${relPath}"`,
          { level: 'info' },
        )
        return false
      }

      // Skip if on-disk content already matches. Handles the common case
      // where pull returns unchanged entries (skipEtagCache path, first
      // pull of a session with warm disk state from prior session).
      try {
        const existing = await readFile(validatedPath, 'utf8')
        if (existing === content) {
          return false
        }
      } catch (e) {
        if (
          isErrnoException(e) &&
          e.code !== 'ENOENT' &&
          e.code !== 'ENOTDIR'
        ) {
          logForDebugging(
            `team-memory-sync: unexpected read error for "${relPath}": ${e.code}`,
            { level: 'debug' },
          )
        }
        // Fall through to write for ENOENT/ENOTDIR (file doesn't exist yet)
      }

      try {
        const parentDir = validatedPath.substring(
          0,
          validatedPath.lastIndexOf(sep),
        )
        await mkdir(parentDir, { recursive: true })
        await writeFile(validatedPath, content, 'utf8')
        return true
      } catch (e) {
        logForDebugging(
          `team-memory-sync: failed to write "${relPath}": ${e}`,
          { level: 'warn' },
        )
        return false
      }
    }),
  )

  return count(results, Boolean)
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Check if team memory sync is available (requires first-party OAuth).
 */
// 【第 759-764 行】`isTeamMemorySyncAvailable` 就是 `isUsingOAuth()` 的薄包装——
// 把「能不能同步」完全等价于「有没有 first-party OAuth」。UI 层用它来决定要不要显示同步入口。
export function isTeamMemorySyncAvailable(): boolean {
  return isUsingOAuth()
}

/**
 * Pull team memory from the server and write to local directory.
 * Returns true if any files were updated.
 */
// 【第 766-867 行】`pullTeamMemory` —— 公开「拉」接口。
// 流程：没 OAuth / 没 git remote → 直接失败返回；否则带 etag（除非 `skipEtagCache`）去 fetch。
// `notModified` 直接返回（0 文件写入）；`isEmpty` 会**清空 `serverChecksums`**（否则下次推送
// 会以为服务器还持有其实已不存在的 key，从而漏传）；正常则刷新 `serverChecksums`、写盘、
// 若真写了文件就 `clearMemoryFileCaches()` 让记忆缓存失效。
export async function pullTeamMemory(
  state: SyncState,
  options?: { skipEtagCache?: boolean },
): Promise<{
  success: boolean
  filesWritten: number
  /** Number of entries the server returned, regardless of whether they were written to disk. */
  entryCount: number
  notModified?: boolean
  error?: string
}> {
  const skipEtagCache = options?.skipEtagCache ?? false
  const startTime = Date.now()

  if (!isUsingOAuth()) {
    logPull(startTime, { success: false, errorType: 'no_oauth' })
    return {
      success: false,
      filesWritten: 0,
      entryCount: 0,
      error: 'OAuth not available',
    }
  }

  const repoSlug = await getGithubRepo()
  if (!repoSlug) {
    logPull(startTime, { success: false, errorType: 'no_repo' })
    return {
      success: false,
      filesWritten: 0,
      entryCount: 0,
      error: 'No git remote found',
    }
  }

  const etag = skipEtagCache ? null : state.lastKnownChecksum
  const result = await fetchTeamMemory(state, repoSlug, etag)
  if (!result.success) {
    logPull(startTime, {
      success: false,
      errorType: result.errorType,
      status: result.httpStatus,
    })
    return {
      success: false,
      filesWritten: 0,
      entryCount: 0,
      error: result.error,
    }
  }
  if (result.notModified) {
    logPull(startTime, { success: true, notModified: true })
    return { success: true, filesWritten: 0, entryCount: 0, notModified: true }
  }
  if (result.isEmpty || !result.data) {
    // Server has no data — clear stale serverChecksums so the next push
    // doesn't skip entries it thinks the server already has.
    state.serverChecksums.clear()
    logPull(startTime, { success: true })
    return { success: true, filesWritten: 0, entryCount: 0 }
  }

  const entries = result.data.content.entries
  const responseChecksums = result.data.content.entryChecksums

  // Refresh serverChecksums from server-provided per-key hashes.
  // Requires anthropic/anthropic#283027 — if the response lacks entryChecksums
  // (pre-deploy server), serverChecksums stays empty and the next push uploads
  // everything; it self-corrects on push success.
  state.serverChecksums.clear()
  if (responseChecksums) {
    for (const [key, hash] of Object.entries(responseChecksums)) {
      state.serverChecksums.set(key, hash)
    }
  } else {
    logForDebugging(
      'team-memory-sync: server response missing entryChecksums (pre-#283027 deploy) — next push will be full, not delta',
      { level: 'debug' },
    )
  }

  const filesWritten = await writeRemoteEntriesToLocal(entries)
  if (filesWritten > 0) {
    const { clearMemoryFileCaches } = await import('../../utils/claudemd.js')
    clearMemoryFileCaches()
  }
  logForDebugging(`team-memory-sync: pulled ${filesWritten} files`, {
    level: 'info',
  })

  logPull(startTime, { success: true, filesWritten })

  return {
    success: true,
    filesWritten,
    entryCount: Object.keys(entries).length,
  }
}

/**
 * Push local team memory files to the server with optimistic locking.
 *
 * Uses delta upload: only keys whose local content hash differs from
 * serverChecksums are included in the PUT. On 412 conflict, probes
 * GET ?view=hashes to refresh serverChecksums, recomputes the delta
 * (naturally excluding keys where a teammate's push matches ours),
 * and retries. No merge, no disk writes — server-only new keys from
 * a teammate's concurrent push propagate on the next pull.
 *
 * Local-wins-on-conflict is the opposite of syncTeamMemory's pull-first
 * semantics. This is intentional: pushTeamMemory is triggered by a local edit,
 * and that edit must not be silently discarded just because a teammate pushed
 * in the meantime. Content-level merge (same key, both changed) is not
 * attempted — the local version simply overwrites the server version for that
 * key, and the server's edit to that key is lost. This is the lesser evil:
 * the local user is actively editing and can re-incorporate the teammate's
 * changes, whereas silently discarding the local edit loses work the user
 * just did with no recourse.
 */
// 【第 869-1146 行】`pushTeamMemory` —— 整个同步子系统的**核心**，用乐观锁 + 冲突重试。
// 关键设计（注释里写得很清楚，这里点出为什么）：
// · **delta 只传 hash 不同的 key**：`state.serverChecksums` 里和本地 hash 一致的，不上传；
// · **local-wins-on-conflict 是故意的**：推送由「本地刚编辑」触发，这个编辑不能被队友的并发推送静默丢弃；
// · **不做内容合并**：同一 key 双方都改了 → 本地覆盖服务器版本，队友改的那版丢失。这是两害取其轻——
//   本地用户正 actively 编辑、能手动把队友的改动并回来；而静默丢掉本地刚做的编辑是**不可逆**的工作丢失；
// · **冲突循环不重读磁盘**：delta 是拿固定本地内容和「刷新后的 serverChecksums」重算的，
//   队友并发推来的内容自然被排除出 delta，本地编辑绝不会被覆盖。
export async function pushTeamMemory(
  state: SyncState,
): Promise<TeamMemorySyncPushResult> {
  const startTime = Date.now()
  let conflictRetries = 0

  if (!isUsingOAuth()) {
    logPush(startTime, { success: false, errorType: 'no_oauth' })
    return {
      success: false,
      filesUploaded: 0,
      error: 'OAuth not available',
      errorType: 'no_oauth',
    }
  }

  const repoSlug = await getGithubRepo()
  if (!repoSlug) {
    logPush(startTime, { success: false, errorType: 'no_repo' })
    return {
      success: false,
      filesUploaded: 0,
      error: 'No git remote found',
      errorType: 'no_repo',
    }
  }

  // Read local entries once at the start. Conflict resolution does NOT re-read
  // from disk — the delta computation against a refreshed serverChecksums naturally
  // excludes server-origin content, so the user's local edit cannot be clobbered.
  // Secret scanning (PSR M22174) happens here once — files with detected
  // secrets are excluded from the upload set.
  const localRead = await readLocalTeamMemory(state.serverMaxEntries)
  const entries = localRead.entries
  const skippedSecrets = localRead.skippedSecrets
  if (skippedSecrets.length > 0) {
    // Log a user-visible warning listing which files were skipped and why.
    // Don't block the push — just exclude those files. The secret VALUE is
    // never logged, only the type label.
    const summary = skippedSecrets
      .map(s => `"${s.path}" (${s.label})`)
      .join(', ')
    logForDebugging(
      `team-memory-sync: ${skippedSecrets.length} file(s) skipped due to detected secrets: ${summary}. Remove the secret(s) to enable sync for these files.`,
      { level: 'warn' },
    )
    logEvent('tengu_team_mem_secret_skipped', {
      file_count: skippedSecrets.length,
      // Only log gitleaks rule IDs (not values, not paths — paths could
      // leak repo structure). Comma-joined for compact single-field analytics.
      rule_ids: skippedSecrets
        .map(s => s.ruleId)
        .join(
          ',',
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Hash each local entry once. The loop recomputes the delta each iteration
  // (serverChecksums may change after a 412 probe) but local hashes are stable.
  const localHashes = new Map<string, string>()
  for (const [key, content] of Object.entries(entries)) {
    localHashes.set(key, hashContent(content))
  }

  let sawConflict = false

  for (
    let conflictAttempt = 0;
    conflictAttempt <= MAX_CONFLICT_RETRIES;
    conflictAttempt++
  ) {
    // Delta: only upload keys whose content hash differs from what we believe
    // the server holds. On first push after a fresh pull, this is exactly the
    // user's local edits. After a 412 probe, matching hashes are excluded —
    // server-origin content from a teammate's concurrent push is naturally
    // dropped from the delta, so we never re-upload it.
    const delta: Record<string, string> = {}
    for (const [key, localHash] of localHashes) {
      if (state.serverChecksums.get(key) !== localHash) {
// 【第 966-971 行】delta 计算本体：遍历本地 hash，凡是 `serverChecksums` 里没有、
// 或 hash 不等于本地值的 key，就放进 `delta`。`deltaCount === 0` 是「无东西可传」的快速路径
// （刚 pull 完没本地改动、或 412 后队友的推送恰好是我们的超集时就会走到这里）。
        delta[key] = entries[key]!
      }
    }
    const deltaCount = Object.keys(delta).length

    if (deltaCount === 0) {
      // Nothing to upload. This is the expected fast path after a fresh pull
      // with no local edits, and also the convergence point after a 412 where
      // the teammate's push was a strict superset of ours.
      logPush(startTime, {
        success: true,
        conflict: sawConflict,
        conflictRetries,
      })
      return {
        success: true,
        filesUploaded: 0,
        ...(skippedSecrets.length > 0 && { skippedSecrets }),
      }
    }

    // Split the delta into PUT-sized batches to stay under the gateway's
    // body-size limit.  Typical deltas (1-3 edited files) land in one batch;
    // cold pushes with many files are where this earns its keep.  Each batch
    // is a complete PUT that upserts its keys independently — if batch N
    // fails, batches 1..N-1 are already committed server-side.  Updating
    // serverChecksums after each success means the outer conflict-loop retry
    // naturally resumes from the uncommitted tail (those keys still differ).
    // state.lastKnownChecksum is updated inside uploadTeamMemory on each
    // 200, so the ETag chain threads through the batches automatically.
    const batches = batchDeltaByBytes(delta)
    let filesUploaded = 0
    let result: TeamMemorySyncUploadResult | undefined

    for (const batch of batches) {
      result = await uploadTeamMemory(
        state,
        repoSlug,
        batch,
        state.lastKnownChecksum,
      )
      if (!result.success) break

      for (const key of Object.keys(batch)) {
        state.serverChecksums.set(key, localHashes.get(key)!)
      }
      filesUploaded += Object.keys(batch).length
    }
    // batches is non-empty (deltaCount > 0 guaranteed by the check above),
    // so the loop executed at least once.
    result = result!

    if (result.success) {
      // Server-side delta propagation to disk (server-only new keys from a
      // teammate's concurrent push) happens on the next pull — we only
      // fetched hashes during conflict resolution, not bodies.
      logForDebugging(
        batches.length > 1
          ? `team-memory-sync: pushed ${filesUploaded} of ${localHashes.size} files in ${batches.length} batches`
          : `team-memory-sync: pushed ${filesUploaded} of ${localHashes.size} files (delta)`,
        { level: 'info' },
      )
      logPush(startTime, {
        success: true,
        filesUploaded,
        conflict: sawConflict,
        conflictRetries,
        putBatches: batches.length > 1 ? batches.length : undefined,
      })
      return {
        success: true,
        filesUploaded,
        checksum: result.checksum,
        ...(skippedSecrets.length > 0 && { skippedSecrets }),
      }
    }

    if (!result.conflict) {
      // If the server returned a structured 413 with its effective
      // max_entries (anthropic/anthropic#293258), cache it so the next push
      // trims to the right cap. The server may GB-tune this per-org.
      // This push still fails — re-trimming mid-push would require re-reading
      // local entries and re-computing the delta, and we'd need
      // soft_delete_keys to shrink below current server count anyway.
      if (result.serverMaxEntries !== undefined) {
// 【第 1047-1059 行】413 学习的落点：如果服务器在 413 里回了有效的 `serverMaxEntries`，
// 就缓存进 `state.serverMaxEntries` 并打日志。**但本次推送仍然失败**——中途重新截断需要重读本地、
// 重算 delta，而且即便截断也还得 `soft_delete_keys` 才能真正低于服务器现有条数，所以这里选择直接失败、
// 等用户/下次编辑再处理。
        state.serverMaxEntries = result.serverMaxEntries
        logForDebugging(
          `team-memory-sync: learned server max_entries=${result.serverMaxEntries} from 413; next push will truncate to this`,
          { level: 'warn' },
        )
      }
      // filesUploaded may be nonzero if earlier batches committed before this
      // one failed. Those keys ARE on the server; the push is a failure
      // because it's incomplete, but we don't re-upload them on retry
      // (serverChecksums was updated).
      logPush(startTime, {
        success: false,
        filesUploaded,
        conflictRetries,
        putBatches: batches.length > 1 ? batches.length : undefined,
        errorType: result.errorType,
        status: result.httpStatus,
        // Datadog: filter @error_code:team_memory_too_many_entries to track
        // too-many-files rejections distinct from gateway/unstructured 413s
        errorCode: result.serverErrorCode,
        serverMaxEntries: result.serverMaxEntries,
        serverReceivedEntries: result.serverReceivedEntries,
      })
      return {
        success: false,
        filesUploaded,
        error: result.error,
        errorType: result.errorType,
        httpStatus: result.httpStatus,
      }
    }

    // 412 conflict — refresh serverChecksums and retry with a tighter delta.
    sawConflict = true
// 【第 1086-1138 行】412 冲突处理：标记 `sawConflict`，若已达 `MAX_CONFLICT_RETRIES`
// 就放弃；否则 `conflictRetries++` 后发一次廉价 `fetchTeamMemoryHashes` 探针刷新 `serverChecksums`，
// 下一轮循环重算 delta（队友刚推的、内容相同的 key 自然被排除）。探针失败也直接失败、交给 watcher 重试。
    if (conflictAttempt >= MAX_CONFLICT_RETRIES) {
      logForDebugging(
        `team-memory-sync: giving up after ${MAX_CONFLICT_RETRIES} conflict retries`,
        { level: 'warn' },
      )
      logPush(startTime, {
        success: false,
        conflict: true,
        conflictRetries,
        errorType: 'conflict',
      })
      return {
        success: false,
        filesUploaded: 0,
        conflict: true,
        error: 'Conflict resolution failed after retries',
      }
    }

    conflictRetries++

    logForDebugging(
      `team-memory-sync: conflict (412), probing server hashes (attempt ${conflictAttempt + 1}/${MAX_CONFLICT_RETRIES})`,
      { level: 'info' },
    )

    // Cheap probe: fetch only per-key checksums, no entry bodies. Refreshes
    // serverChecksums so the next iteration's delta drops any keys a teammate just
    // pushed with identical content.
    const probe = await fetchTeamMemoryHashes(state, repoSlug)
    if (!probe.success || !probe.entryChecksums) {
      // Requires anthropic/anthropic#283027. A transient probe failure here is
      // fine: the push is failed and the watcher will retry on the next edit.
      logPush(startTime, {
        success: false,
        conflict: true,
        conflictRetries,
        errorType: 'conflict',
      })
      return {
        success: false,
        filesUploaded: 0,
        conflict: true,
        error: `Conflict resolution hashes probe failed: ${probe.error}`,
      }
    }
    state.serverChecksums.clear()
    for (const [key, hash] of Object.entries(probe.entryChecksums)) {
      state.serverChecksums.set(key, hash)
    }
  }

  logPush(startTime, { success: false, conflictRetries })
  return {
    success: false,
    filesUploaded: 0,
    error: 'Unexpected end of conflict resolution loop',
  }
}

/**
 * Bidirectional sync: pull from server, merge with local, push back.
 * Server entries take precedence on conflict (last-write-wins by the server).
 * Push uses conflict resolution (retries on 412) via pushTeamMemory.
 */
// 【第 1148-1191 行】`syncTeamMemory` —— 双向同步的总入口：**先 pull 再 push**。
// pull 用 `{ skipEtagCache: true }` 做全量拉（确保本地是最新），push 用带 412 重试的 `pushTeamMemory`。
// 冲突时「服务器优先」（pull 覆盖本地）；但 push 里是「本地优先」。这看似矛盾，其实分工明确：
// sync 的 pull 是「合并前的全量获取」，push 是「尊重本地用户刚做的编辑」。
export async function syncTeamMemory(state: SyncState): Promise<{
  success: boolean
  filesPulled: number
  filesPushed: number
  error?: string
}> {
  // 1. Pull remote → local (skip ETag cache for full sync)
  const pullResult = await pullTeamMemory(state, { skipEtagCache: true })
  if (!pullResult.success) {
    return {
      success: false,
      filesPulled: 0,
      filesPushed: 0,
      error: pullResult.error,
    }
  }

  // 2. Push local → remote (with conflict resolution)
  const pushResult = await pushTeamMemory(state)
  if (!pushResult.success) {
    return {
      success: false,
      filesPulled: pullResult.filesWritten,
      filesPushed: 0,
      error: pushResult.error,
    }
  }

  logForDebugging(
    `team-memory-sync: synced (pulled ${pullResult.filesWritten}, pushed ${pushResult.filesUploaded})`,
    { level: 'info' },
  )

  return {
    success: true,
    filesPulled: pullResult.filesWritten,
    filesPushed: pushResult.filesUploaded,
  }
}

// ─── Telemetry helpers ───────────────────────────────────────

// 【第 1195-1256 行】`logPull` / `logPush` —— 把每次同步结果上报遥测。
// 注意 `errorType` / `error_code` 都 cast 成那个 `never` 标记类型
// `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`（在 analytics 批注里讲过：
// 这是「用命名做 lint」逼你确认上报字段里没有代码/路径）。`duration_ms` 用 `Date.now() - startTime` 现算，
// 记录整次同步耗时。
function logPull(
  startTime: number,
  outcome: {
    success: boolean
    filesWritten?: number
    notModified?: boolean
    errorType?: string
    status?: number
  },
): void {
  logEvent('tengu_team_mem_sync_pull', {
    success: outcome.success,
    files_written: outcome.filesWritten ?? 0,
    not_modified: outcome.notModified ?? false,
    duration_ms: Date.now() - startTime,
    ...(outcome.errorType && {
      errorType:
        outcome.errorType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(outcome.status && { status: outcome.status }),
  })
}

function logPush(
  startTime: number,
  outcome: {
    success: boolean
    filesUploaded?: number
    conflict?: boolean
    conflictRetries?: number
    errorType?: string
    status?: number
    putBatches?: number
    errorCode?: string
    serverMaxEntries?: number
    serverReceivedEntries?: number
  },
): void {
  logEvent('tengu_team_mem_sync_push', {
    success: outcome.success,
    files_uploaded: outcome.filesUploaded ?? 0,
    conflict: outcome.conflict ?? false,
    conflict_retries: outcome.conflictRetries ?? 0,
    duration_ms: Date.now() - startTime,
    ...(outcome.errorType && {
      errorType:
        outcome.errorType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(outcome.status && { status: outcome.status }),
    ...(outcome.putBatches && { put_batches: outcome.putBatches }),
    ...(outcome.errorCode && {
      error_code:
        outcome.errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(outcome.serverMaxEntries !== undefined && {
      server_max_entries: outcome.serverMaxEntries,
    }),
    ...(outcome.serverReceivedEntries !== undefined && {
      server_received_entries: outcome.serverReceivedEntries,
    }),
  })
}
