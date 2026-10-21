// ═══════════════════════════════════════════════════════════════
//  api/sessionIngress：把对话记录「追加」到远端会话日志
// ═══════════════════════════════════════════════════════════════
//
//  这个文件解决的是一个分布式写入问题：**多个进程 / 多次重试往同一条
//  日志末尾追加，怎么保证顺序和不重复。**
//
//  514 行，核心只有两处：
//
//      第 42 行   每个会话一个串行队列（同一个会话的追加一次只跑一个）
//      第 90 行   409 时读服务端的 x-last-uuid 并「认领」（幂等恢复）
//
//  第二处是全文最有意思的地方 —— 它处理的是「客户端以为失败、其实服务端
//  已经写成功了」这个经典区间。
import axios, { type AxiosError } from 'axios'
import type { UUID } from 'crypto'
import { getOauthConfig } from '../../constants/oauth.js'
import type { Entry, TranscriptMessage } from '../../types/logs.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logError } from '../../utils/log.js'
import { sequential } from '../../utils/sequential.js'
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getOAuthHeaders } from '../../utils/teleport/api.js'

interface SessionIngressError {
  error?: {
    message?: string
    type?: string
  }
}

// Module-level state
// 【模块级 Map：每个会话记住「我最后成功写的那个 uuid」】
//
//  这个 lastUuid 是下一次请求的头（Last-Uuid），服务端用它做**乐观并发控制**：
//
//      客户端说「我上一个写的是 X」→ 服务端检查自己的末尾是不是 X
//      是   → 允许追加，顺序没断
//      不是 → 返回 409，说明有别人写过（或我上次其实成功了）
//
//  这就是「链式追加」：每条记录都指向前一条，服务端据此保证没有空洞。
//  它比「带时间戳排序」可靠得多，因为时间戳在不同进程间不可比。
//
//  注意它是**模块级**而不是实例级：一个进程内所有请求共享。
//  这也意味着进程重启后这个 Map 是空的 —— 那时第一次请求不带 Last-Uuid，
//  由服务端决定怎么处理（通常是允许）。
const lastUuidMap: Map<string, UUID> = new Map()

const MAX_RETRIES = 10
const BASE_DELAY_MS = 500

// 【每个会话一个串行包装器 —— 这是「同会话内不并发」的实现】
//
//      Map<sessionId, (entry, url, headers) => Promise<boolean>>
//
//  为什么需要？因为 lastUuid 是个「读—发请求—写」的序列：
//
//      T0  请求 A 读 lastUuid = X
//      T1  请求 B 读 lastUuid = X        ← 还没更新
//      T2  A 发出（Last-Uuid: X），成功，lastUuid = A
//      T3  B 发出（Last-Uuid: X），服务端发现末尾是 A 不是 X → 409
//
//  串行化之后 B 会等 A 完成，读到 lastUuid = A，一次成功。
//
//  注意**粒度是会话级**而不是全局级：不同会话之间可以并行，因为它们
//  的链互不相干。这是「锁的粒度尽量细」的标准应用。
//
//  顺带看第 45 行的 sequential(...)：这是一个工具函数，把任意 async 函数
//  变成「排队执行」的版本。本仓库里有好几处这种用法，值得记住这个名字。
// Per-session sequential wrappers to prevent concurrent log writes
const sequentialAppendBySession: Map<
  string,
  (
    entry: TranscriptMessage,
    url: string,
    headers: Record<string, string>,
  ) => Promise<boolean>
> = new Map()

/**
 * Gets or creates a sequential wrapper for a session
 * This ensures that log appends for a session are processed one at a time
 */
function getOrCreateSequentialAppend(sessionId: string) {
  let sequentialAppend = sequentialAppendBySession.get(sessionId)
  if (!sequentialAppend) {
    sequentialAppend = sequential(
      async (
        entry: TranscriptMessage,
        url: string,
        headers: Record<string, string>,
      ) => await appendSessionLogImpl(sessionId, entry, url, headers),
    )
    sequentialAppendBySession.set(sessionId, sequentialAppend)
  }
  return sequentialAppend
}

// 【方法名是 PUT，语义是「追加」—— 这两件事的张力值得说】
//
//  HTTP PUT 的语义是「把这个资源变成这样」（幂等覆盖），而这里做的是
//  「往末尾加一条」。用 PUT 是因为服务端把「一条 entry」当作资源，
//  url 里带 entry 的位置信息，所以重复 PUT 同一条不会产生两条。
//
//  这就是幂等性的来源：**不是靠服务端查重，而是靠「同一个 key 覆盖同一个值」。**
//
//  注释里还写清了三种状态码的处理策略：
//
//      瞬时错误（网络 / 5xx / 429）  → 重试
//      409                          → 采纳服务端的 last UUID 再重试
//      401                          → 立刻失败
//
//  401 不重试是对的：token 失效重试一万次也一样。**「能不能重试」由错误
//  的性质决定，不由重试次数决定。**
/**
 * Internal implementation of appendSessionLog with retry logic
 * Retries on transient errors (network, 5xx, 429). On 409, adopts the server's
 * last UUID and retries (handles stale state from killed process's in-flight
 * requests). Fails immediately on 401.
 */
async function appendSessionLogImpl(
  sessionId: string,
  entry: TranscriptMessage,
  url: string,
  headers: Record<string, string>,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const lastUuid = lastUuidMap.get(sessionId)
      const requestHeaders = { ...headers }
      if (lastUuid) {
        requestHeaders['Last-Uuid'] = lastUuid
      }

      const response = await axios.put(url, entry, {
        headers: requestHeaders,
        validateStatus: status => status < 500,
      })

      if (response.status === 200 || response.status === 201) {
        lastUuidMap.set(sessionId, entry.uuid)
        logForDebugging(
          `Successfully persisted session log entry for session ${sessionId}`,
        )
        return true
      }

//       // 【409 的处理是整个文件最精妙的一段】
//       //
//       //  场景：客户端发出请求 → 服务端写成功 → 响应在路上丢了（超时/断网）
//       //        → 客户端认为失败，lastUuid 还是旧的
//       //        → 重试时带旧 Last-Uuid → 服务端发现末尾已经是新的 → 409
//       //
//       //  如果简单地把 409 当失败，这条记录就**永远写不进去**（客户端会一直
//       //  带着旧的 Last-Uuid 重试，一直被拒），而其实它已经在服务端了。
//       //
//       //  解法：409 的响应头里带 x-last-uuid（服务端末尾到底是哪个），
//       //  客户端拿它和**自己这条**比较：
//       //
//       //      相同   → 说明我这条就是末尾，上次其实成功了 → 当作成功，更新 lastUuid
//       //      不同   → 说明真的有人插在中间 → 采纳服务端的值，再试
//       //
//       //  这一步叫「状态和解（reconciliation）」：**不假设自己知道真相，
//       //  而是去问对方真相是什么，然后对齐。**
//       //
//       //  注释（第 59 行）还说这个场景来自 killed process's in-flight requests ——
//       //  进程被杀时正在飞的请求，是最典型的「结果未知」状态。
      if (response.status === 409) {
        // Check if our entry was actually stored (server returned 409 but entry exists)
        // This handles the scenario where entry was stored but client received an error
        // response, causing lastUuidMap to be stale
        const serverLastUuid = response.headers['x-last-uuid']
        if (serverLastUuid === entry.uuid) {
          // Our entry IS the last entry on server - it was stored successfully previously
          lastUuidMap.set(sessionId, entry.uuid)
          logForDebugging(
            `Session entry ${entry.uuid} already present on server, recovering from stale state`,
          )
          logForDiagnosticsNoPII('info', 'session_persist_recovered_from_409')
          return true
        }

        // Another writer (e.g. in-flight request from a killed process)
        // advanced the server's chain. Try to adopt the server's last UUID
        // from the response header, or re-fetch the session to discover it.
        if (serverLastUuid) {
          lastUuidMap.set(sessionId, serverLastUuid as UUID)
          logForDebugging(
            `Session 409: adopting server lastUuid=${serverLastUuid} from header, retrying entry ${entry.uuid}`,
          )
        } else {
          // Server didn't return x-last-uuid (e.g. v1 endpoint). Re-fetch
          // the session to discover the current head of the append chain.
          const logs = await fetchSessionLogsFromUrl(sessionId, url, headers)
          const adoptedUuid = findLastUuid(logs)
          if (adoptedUuid) {
            lastUuidMap.set(sessionId, adoptedUuid)
            logForDebugging(
              `Session 409: re-fetched ${logs!.length} entries, adopting lastUuid=${adoptedUuid}, retrying entry ${entry.uuid}`,
            )
          } else {
            // Can't determine server state — give up
            const errorData = response.data as SessionIngressError
            const errorMessage =
              errorData.error?.message || 'Concurrent modification detected'
            logError(
              new Error(
                `Session persistence conflict: UUID mismatch for session ${sessionId}, entry ${entry.uuid}. ${errorMessage}`,
              ),
            )
            logForDiagnosticsNoPII(
              'error',
              'session_persist_fail_concurrent_modification',
            )
            return false
          }
        }
        logForDiagnosticsNoPII('info', 'session_persist_409_adopt_server_uuid')
        continue // retry with updated lastUuid
      }

      if (response.status === 401) {
        logForDebugging('Session token expired or invalid')
        logForDiagnosticsNoPII('error', 'session_persist_fail_bad_token')
        return false // Non-retryable
      }

      // Other 4xx (429, etc.) - retryable
      logForDebugging(
        `Failed to persist session log: ${response.status} ${response.statusText}`,
      )
      logForDiagnosticsNoPII('error', 'session_persist_fail_status', {
        status: response.status,
        attempt,
      })
    } catch (error) {
      // Network errors, 5xx - retryable
      const axiosError = error as AxiosError<SessionIngressError>
      logError(new Error(`Error persisting session log: ${axiosError.message}`))
      logForDiagnosticsNoPII('error', 'session_persist_fail_status', {
        status: axiosError.status,
        attempt,
      })
    }

    if (attempt === MAX_RETRIES) {
      logForDebugging(`Remote persistence failed after ${MAX_RETRIES} attempts`)
      logForDiagnosticsNoPII(
        'error',
        'session_persist_error_retries_exhausted',
        { attempt },
      )
      return false
    }

    const delayMs = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), 8000)
    logForDebugging(
      `Remote persistence attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delayMs}ms…`,
    )
    await sleep(delayMs)
  }

  return false
}

/**
 * Append a log entry to the session using JWT token
 * Uses optimistic concurrency control with Last-Uuid header
 * Ensures sequential execution per session to prevent race conditions
 */
export async function appendSessionLog(
  sessionId: string,
  entry: TranscriptMessage,
  url: string,
): Promise<boolean> {
  const sessionToken = getSessionIngressAuthToken()
  if (!sessionToken) {
    logForDebugging('No session token available for session persistence')
    logForDiagnosticsNoPII('error', 'session_persist_fail_jwt_no_token')
    return false
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${sessionToken}`,
    'Content-Type': 'application/json',
  }

  const sequentialAppend = getOrCreateSequentialAppend(sessionId)
  return sequentialAppend(entry, url, headers)
}

/**
 * Get all session logs for hydration
 */
export async function getSessionLogs(
  sessionId: string,
  url: string,
): Promise<Entry[] | null> {
  const sessionToken = getSessionIngressAuthToken()
  if (!sessionToken) {
    logForDebugging('No session token available for fetching session logs')
    logForDiagnosticsNoPII('error', 'session_get_fail_no_token')
    return null
  }

  const headers = { Authorization: `Bearer ${sessionToken}` }
  const logs = await fetchSessionLogsFromUrl(sessionId, url, headers)

  if (logs && logs.length > 0) {
    // Update our lastUuid to the last entry's UUID
    const lastEntry = logs.at(-1)
    if (lastEntry && 'uuid' in lastEntry && lastEntry.uuid) {
      lastUuidMap.set(sessionId, lastEntry.uuid)
    }
  }

  return logs
}

/**
 * Get all session logs for hydration via OAuth
 * Used for teleporting sessions from the Sessions API
 */
export async function getSessionLogsViaOAuth(
  sessionId: string,
  accessToken: string,
  orgUUID: string,
): Promise<Entry[] | null> {
  const url = `${getOauthConfig().BASE_API_URL}/v1/session_ingress/session/${sessionId}`
  logForDebugging(`[session-ingress] Fetching session logs from: ${url}`)
  const headers = {
    ...getOAuthHeaders(accessToken),
    'x-organization-uuid': orgUUID,
  }
  const result = await fetchSessionLogsFromUrl(sessionId, url, headers)
  return result
}

/**
 * Response shape from GET /v1/code/sessions/{id}/teleport-events.
 * WorkerEvent.payload IS the Entry (TranscriptMessage struct) — the CLI
 * writes it via AddWorkerEvent, the server stores it opaque, we read it
 * back here.
 */
type TeleportEventsResponse = {
  data: Array<{
    event_id: string
    event_type: string
    is_compaction: boolean
    payload: Entry | null
    created_at: string
  }>
  // Unset when there are no more pages — this IS the end-of-stream
  // signal (no separate has_more field).
  next_cursor?: string
}

/**
 * Get worker events (transcript) via the CCR v2 Sessions API. Replaces
 * getSessionLogsViaOAuth once session-ingress is retired.
 *
 * The server dispatches per-session: Spanner for v2-native sessions,
 * threadstore for pre-backfill session_* IDs. The cursor is opaque to us —
 * echo it back until next_cursor is unset.
 *
 * Paginated (500/page default, server max 1000). session-ingress's one-shot
 * 50k is gone; we loop.
 */
export async function getTeleportEvents(
  sessionId: string,
  accessToken: string,
  orgUUID: string,
): Promise<Entry[] | null> {
  const baseUrl = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/teleport-events`
  const headers = {
    ...getOAuthHeaders(accessToken),
    'x-organization-uuid': orgUUID,
  }

  logForDebugging(`[teleport] Fetching events from: ${baseUrl}`)

  const all: Entry[] = []
  let cursor: string | undefined
  let pages = 0

  // Infinite-loop guard: 1000/page × 100 pages = 100k events. Larger than
  // session-ingress's 50k one-shot. If we hit this, something's wrong
  // (server not advancing cursor) — bail rather than hang.
  const maxPages = 100

  while (pages < maxPages) {
    const params: Record<string, string | number> = { limit: 1000 }
    if (cursor !== undefined) {
      params.cursor = cursor
    }

    let response
    try {
      response = await axios.get<TeleportEventsResponse>(baseUrl, {
        headers,
        params,
        timeout: 20000,
        validateStatus: status => status < 500,
      })
    } catch (e) {
      const err = e as AxiosError
      logError(new Error(`Teleport events fetch failed: ${err.message}`))
      logForDiagnosticsNoPII('error', 'teleport_events_fetch_fail')
      return null
    }

    if (response.status === 404) {
      // 404 on page 0 is ambiguous during the migration window:
      //   (a) Session genuinely not found (not in Spanner AND not in
      //       threadstore) — nothing to fetch.
      //   (b) Route-level 404: endpoint not deployed yet, or session is
      //       a threadstore session not yet backfilled into Spanner.
      // We can't tell them apart from the response alone. Returning null
      // lets the caller fall back to session-ingress, which will correctly
      // return empty for case (a) and data for case (b). Once the backfill
      // is complete and session-ingress is gone, the fallback also returns
      // null → same "Failed to fetch session logs" error as today.
      //
      // 404 mid-pagination (pages > 0) means session was deleted between
      // pages — return what we have.
      logForDebugging(
        `[teleport] Session ${sessionId} not found (page ${pages})`,
      )
      logForDiagnosticsNoPII('warn', 'teleport_events_not_found')
      return pages === 0 ? null : all
    }

    if (response.status === 401) {
      logForDiagnosticsNoPII('error', 'teleport_events_bad_token')
      throw new Error(
        'Your session has expired. Please run /login to sign in again.',
      )
    }

    if (response.status !== 200) {
      logError(
        new Error(
          `Teleport events returned ${response.status}: ${jsonStringify(response.data)}`,
        ),
      )
      logForDiagnosticsNoPII('error', 'teleport_events_bad_status')
      return null
    }

    const { data, next_cursor } = response.data
    if (!Array.isArray(data)) {
      logError(
        new Error(
          `Teleport events invalid response shape: ${jsonStringify(response.data)}`,
        ),
      )
      logForDiagnosticsNoPII('error', 'teleport_events_invalid_shape')
      return null
    }

    // payload IS the Entry. null payload happens for threadstore non-generic
    // events (server skips them) or encryption failures — skip here too.
    for (const ev of data) {
      if (ev.payload !== null) {
        all.push(ev.payload)
      }
    }

    pages++
    // == null covers both `null` and `undefined` — the proto omits the
    // field at end-of-stream, but some serializers emit `null`. Strict
    // `=== undefined` would loop forever on `null` (cursor=null in query
    // params stringifies to "null", which the server rejects or echoes).
    if (next_cursor == null) {
      break
    }
    cursor = next_cursor
  }

  if (pages >= maxPages) {
    // Don't fail — return what we have. Better to teleport with a
    // truncated transcript than not at all.
    logError(
      new Error(`Teleport events hit page cap (${maxPages}) for ${sessionId}`),
    )
    logForDiagnosticsNoPII('warn', 'teleport_events_page_cap')
  }

  logForDebugging(
    `[teleport] Fetched ${all.length} events over ${pages} page(s) for ${sessionId}`,
  )
  return all
}

/**
 * Shared implementation for fetching session logs from a URL
 */
async function fetchSessionLogsFromUrl(
  sessionId: string,
  url: string,
  headers: Record<string, string>,
): Promise<Entry[] | null> {
  try {
    const response = await axios.get(url, {
      headers,
      timeout: 20000,
      validateStatus: status => status < 500,
      params: isEnvTruthy(process.env.CLAUDE_AFTER_LAST_COMPACT)
        ? { after_last_compact: true }
        : undefined,
    })

    if (response.status === 200) {
      const data = response.data

      // Validate the response structure
      if (!data || typeof data !== 'object' || !Array.isArray(data.loglines)) {
        logError(
          new Error(
            `Invalid session logs response format: ${jsonStringify(data)}`,
          ),
        )
        logForDiagnosticsNoPII('error', 'session_get_fail_invalid_response')
        return null
      }

      const logs = data.loglines as Entry[]
      logForDebugging(
        `Fetched ${logs.length} session logs for session ${sessionId}`,
      )
      return logs
    }

    if (response.status === 404) {
      logForDebugging(`No existing logs for session ${sessionId}`)
      logForDiagnosticsNoPII('warn', 'session_get_no_logs_for_session')
      return []
    }

    if (response.status === 401) {
      logForDebugging('Auth token expired or invalid')
      logForDiagnosticsNoPII('error', 'session_get_fail_bad_token')
      throw new Error(
        'Your session has expired. Please run /login to sign in again.',
      )
    }

    logForDebugging(
      `Failed to fetch session logs: ${response.status} ${response.statusText}`,
    )
    logForDiagnosticsNoPII('error', 'session_get_fail_status', {
      status: response.status,
    })
    return null
  } catch (error) {
    const axiosError = error as AxiosError<SessionIngressError>
    logError(new Error(`Error fetching session logs: ${axiosError.message}`))
    logForDiagnosticsNoPII('error', 'session_get_fail_status', {
      status: axiosError.status,
    })
    return null
  }
}

/**
 * Walk backward through entries to find the last one with a uuid.
 * Some entry types (SummaryMessage, TagMessage) don't have one.
 */
// 【findLastUuid：往回找「最后一个带 uuid 的条目」】
//
//  注释（第 488 行）说明了一个容易被忽略的事实：
//
//      Some entry types (SummaryMessage, TagMessage) don't have one.
//
//  也就是说「日志里的条目」不是同构的：有几种类型根本没有 uuid。
//  所以不能简单取 logs[logs.length - 1].uuid —— 最后一条可能恰好是
//  一个 SummaryMessage。
//
//  实现用的是 findLast(e => 'uuid' in e && e.uuid)，两个条件：
//
//      'uuid' in e   类型层面：这个条目有 uuid 字段
//      e.uuid        值层面：它不是空值（类型上可能是可选）
//
//  然后还要再过一次 `entry && 'uuid' in entry` 才断言成 UUID ——
//  因为 findLast 的返回可能是 undefined，而且 TS 无法从谓词里
//  跨语句保留收窄。
//
//  参数允许 null（`logs: Entry[] | null`），因为「这个会话还没有任何日志」
//  是正常状态（第一次用），不是错误。**把「空」当正常情况处理，
//  是链式结构能跑起来的前提** —— 如果空要抛错，每次新会话第一步都得特判。
function findLastUuid(logs: Entry[] | null): UUID | undefined {
  if (!logs) {
    return undefined
  }
  const entry = logs.findLast(e => 'uuid' in e && e.uuid)
  return entry && 'uuid' in entry ? (entry.uuid as UUID) : undefined
}

/**
 * Clear cached state for a session
 */
export function clearSession(sessionId: string): void {
  lastUuidMap.delete(sessionId)
  sequentialAppendBySession.delete(sessionId)
}

/**
 * Clear all cached session state (all sessions).
 * Use this on /clear to free sub-agent session entries.
 */
export function clearAllSessions(): void {
  lastUuidMap.clear()
  sequentialAppendBySession.clear()
}
