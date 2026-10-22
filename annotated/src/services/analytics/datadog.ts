// 【第 1-17 行】`datadog.ts` 是最早的那批遥测后端（Datadog Logs  ingestion）。
//     和 `firstPartyEventLogger.ts`（走自家 `/api/event_logging/batch`）是两个平行后端，
//     由 `sink.ts` 统一路由。注意第 2 行 `import { createHash } from 'crypto'` ——
//     后面用来做 user bucket 的哈希（隐私保护，见第 295 行）。
import axios from 'axios'
import { createHash } from 'crypto'
import memoize from 'lodash-es/memoize.js'
import { getOrCreateUserID } from '../../utils/config.js'
import { logError } from '../../utils/log.js'
import { getCanonicalName } from '../../utils/model/model.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { MODEL_COSTS } from '../../utils/modelCost.js'
import { isAnalyticsDisabled } from './config.js'
import { getEventMetadata } from './metadata.js'

const DATADOG_LOGS_ENDPOINT =
  'https://http-intake.logs.us5.datadoghq.com/api/v2/logs'
const DATADOG_CLIENT_TOKEN = 'pubbbf48e6d78dae54bceaa4acf463299bf'
const DEFAULT_FLUSH_INTERVAL_MS = 15000
const MAX_BATCH_SIZE = 100
const NETWORK_TIMEOUT_MS = 5000
// 【第 12-17 行】三处常量值得注意：
//     - 端点是 `http-intake.logs.us5.datadoghq.com`（美东 us5 区）
//     - **`DATADOG_CLIENT_TOKEN` 是写死在客户端的公开 token**（`pub...` 前缀 = public）。
//       它只能写日志、不能读数据—— 这是「公开 token 只写不读」的标准设计，
//       token 出现在用户机器上不算是泄露凭据。
//     - 默认 15s 刷新、批上限 100、网络超时 5s。这三个数字都是「延迟 vs 丢失」的权衡结果。

const DATADOG_ALLOWED_EVENTS = new Set([
// 【第 19-64 行】`DATADOG_ALLOWED_EVENTS` 是一份**白名单**（44 个事件名）。
//     只有名单里的事件才发往 Datadog—— 这是**基数控制（cardinality control）**的第一道闸：
//     Datadog 按事件名建索引/告警，事件名一旦失控（比如把动态内容塞进名字），
//     索引成本会爆炸。白名单比黑名单更保守：新事件默认不发，必须显式加入。
  'chrome_bridge_connection_succeeded',
  'chrome_bridge_connection_failed',
  'chrome_bridge_disconnected',
  'chrome_bridge_tool_call_completed',
  'chrome_bridge_tool_call_error',
  'chrome_bridge_tool_call_started',
  'chrome_bridge_tool_call_timeout',
  'tengu_api_error',
  'tengu_api_success',
  'tengu_brief_mode_enabled',
  'tengu_brief_mode_toggled',
  'tengu_brief_send',
  'tengu_cancel',
  'tengu_compact_failed',
  'tengu_exit',
  'tengu_flicker',
  'tengu_init',
  'tengu_model_fallback_triggered',
  'tengu_oauth_error',
  'tengu_oauth_success',
  'tengu_oauth_token_refresh_failure',
  'tengu_oauth_token_refresh_success',
  'tengu_oauth_token_refresh_lock_acquiring',
  'tengu_oauth_token_refresh_lock_acquired',
  'tengu_oauth_token_refresh_starting',
  'tengu_oauth_token_refresh_completed',
  'tengu_oauth_token_refresh_lock_releasing',
  'tengu_oauth_token_refresh_lock_released',
  'tengu_query_error',
  'tengu_session_file_read',
  'tengu_started',
  'tengu_tool_use_error',
  'tengu_tool_use_granted_in_prompt_permanent',
  'tengu_tool_use_granted_in_prompt_temporary',
  'tengu_tool_use_rejected_in_prompt',
  'tengu_tool_use_success',
  'tengu_uncaught_exception',
  'tengu_unhandled_rejection',
  'tengu_voice_recording_started',
  'tengu_voice_toggled',
  'tengu_team_mem_sync_pull',
  'tengu_team_mem_sync_push',
  'tengu_team_mem_sync_started',
  'tengu_team_mem_entries_capped',
])

const TAG_FIELDS = [
  'arch',
  'clientType',
  'errorType',
  'http_status_range',
  'http_status',
  'kairosActive',
  'model',
  'platform',
  'provider',
  'skillMode',
  'subscriptionType',
  'toolName',
  'userBucket',
  'userType',
  'version',
  'versionBase',
]

function camelToSnakeCase(str: string): string {
// 【第 85-96 行】`camelToSnakeCase` 把 `clientType` 之类驼峰键翻成 `client_type`——
//     Datadog 的标签/属性约定用 snake_case（和 BQ 的 1P 后端一致，见 `metadata.ts` 的 `to1PEventFormat`）。
//     `DatadogLog` 类型里 `[key: string]: unknown` 是开放索引签名，允许后面把任意字段塞成属性。
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

type DatadogLog = {
  ddsource: string
  ddtags: string
  message: string
  service: string
  hostname: string
  [key: string]: unknown
}

let logBatch: DatadogLog[] = []
// 【第 98-100 行】三个模块级变量：`logBatch`（待发批次）、`flushTimer`（定时器句柄）、
//     `datadogInitialized`（初始化状态，三态：null=还没查 / true / false）。
//     注意它们都没有用 `let ... : boolean | undefined = undefined` 的显式声明，而是直接赋值——
//     初始化状态用 `null` 表示「未知」是这套代码的惯用法（和 `growthbook.ts` 的 `clientCreatedWithAuth` 等呼应）。
let flushTimer: NodeJS.Timeout | null = null
let datadogInitialized: boolean | null = null

async function flushLogs(): Promise<void> {
  if (logBatch.length === 0) return

  const logsToSend = logBatch
  logBatch = []

  try {
    await axios.post(DATADOG_LOGS_ENDPOINT, logsToSend, {
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': DATADOG_CLIENT_TOKEN,
      },
      timeout: NETWORK_TIMEOUT_MS,
    })
  } catch (error) {
    logError(error)
  }
}

function scheduleFlush(): void {
  if (flushTimer) return

  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushLogs()
  }, getFlushIntervalMs()).unref()
}

export const initializeDatadog = memoize(async (): Promise<boolean> => {
// 【第 130-144 行】`initializeDatadog` 是 `memoize(async ...)`。
//     但这里有个**反直觉点**：整个函数体几乎没有真正的「初始化」动作——
//     `try` 里直接 `datadogInitialized = true; return true`，唯一的失败源 `catch` 也几乎不会触发。
//     换句话说它名不副实，`memoize` 主要是为了「保证整个进程只执行一次」，而不是「做一次昂贵的初始化」。
//     → 读这类函数时要看实际做了什么，不要被名字误导。
  if (isAnalyticsDisabled()) {
    datadogInitialized = false
    return false
  }

  try {
    datadogInitialized = true
    return true
  } catch (error) {
    logError(error)
    datadogInitialized = false
    return false
  }
})

/**
 * Flush remaining Datadog logs and shut down.
 * Called from gracefulShutdown() before process.exit() since
 * forceExit() prevents the beforeExit handler from firing.
 */
export async function shutdownDatadog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flushLogs()
}

// 【第 159-180 行】`trackDatadogEvent` 开头两道快速拦截：
//     - 只跑在 `production`（非生产环境直接 return，省本地/测试噪音）
//     - 只跑在 `firstParty` provider（3P 云 Bedrock/Vertex/Foundry 不回传 Datadog）
//     这两道都是「**早返回**」模式—— 不满足前提就立刻退出，把真正的组装逻辑放到后面，
//     避免层层 if 嵌套。第 174-177 行还有一道：缓存里 initialized 是 null 才去 await 初始化，
//     否则直接用，避开每次上报都 await 的开销（「Fast path」注释）。
// NOTE: use via src/services/analytics/index.ts > logEvent
export async function trackDatadogEvent(
  eventName: string,
  properties: { [key: string]: boolean | number | undefined },
): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    return
  }

  // Don't send events for 3P providers (Bedrock, Vertex, Foundry)
  if (getAPIProvider() !== 'firstParty') {
    return
  }

  // Fast path: use cached result if available to avoid await overhead
  let initialized = datadogInitialized
  if (initialized === null) {
    initialized = await initializeDatadog()
  }
  if (!initialized || !DATADOG_ALLOWED_EVENTS.has(eventName)) {
    return
  }

  try {
    const metadata = await getEventMetadata({
      model: properties.model,
      betas: properties.betas,
    })
    // Destructure to avoid duplicate envContext (once nested, once flattened)
    const { envContext, ...restMetadata } = metadata
    const allData: Record<string, unknown> = {
      ...restMetadata,
      ...envContext,
      ...properties,
      userBucket: getUserBucket(),
    }

    // Normalize MCP tool names to "mcp" for cardinality reduction
// 【第 196-217 行】这一段是**基数控制的二次归一**，和前面的白名单是同一目标的两道防线：
//     - 工具名以 `mcp__` 开头 → 一律压成 `'mcp'`（否则用户各自的 MCP server 名会让标签基数爆炸）
//     - 模型名：先用 `getCanonicalName` 归一，**只在 `shortName in MODEL_COSTS` 时才保留真名，
//       否则记 `'other'`**（外部用户视角下，罕见模型名没有分析价值，只会增加基数）
//     - 版本号：dev 构建的 `2.0.53-dev.20251124.t173302.sha526cc6a` 截成 `2.0.53-dev.20251124`
//       去掉时间戳和 sha（同样是基数 + 避免泄露构建细节）
    if (
      typeof allData.toolName === 'string' &&
      allData.toolName.startsWith('mcp__')
    ) {
      allData.toolName = 'mcp'
    }

    // Normalize model names for cardinality reduction (external users only)
    if (process.env.USER_TYPE !== 'ant' && typeof allData.model === 'string') {
      const shortName = getCanonicalName(allData.model.replace(/\[1m]$/i, ''))
      allData.model = shortName in MODEL_COSTS ? shortName : 'other'
    }

    // Truncate dev version to base + date (remove timestamp and sha for cardinality reduction)
    // e.g. "2.0.53-dev.20251124.t173302.sha526cc6a" -> "2.0.53-dev.20251124"
    if (typeof allData.version === 'string') {
      allData.version = allData.version.replace(
        /^(\d+\.\d+\.\d+-dev\.\d{8})\.t\d+\.sha[a-f0-9]+$/,
        '$1',
      )
    }

    // Transform status to http_status and http_status_range to avoid Datadog reserved field
// 【第 219-232 行】`status` → `http_status` / `http_status_range` 的改写，原因有两层：
//     1. Datadog 的 `status` 是**保留字段**，如果自己塞一个 `status` 会和它内部语义冲突
//     2. 为了能按 `1xx/2xx/3xx/4xx/5xx` 做聚合告警，需要把裸状态码再翻出一个 `range` 维度
//     改完之后第 231 行 `delete allData.status` 把原字段删掉，避免和保留字段撞车。
//     → 「上报前的数据整形」是遥测代码里占比很大的一部分，本质都是「让数据既够用、又不会撑爆后端」。
    if (allData.status !== undefined && allData.status !== null) {
      const statusCode = String(allData.status)
      allData.http_status = statusCode

      // Determine status range (1xx, 2xx, 3xx, 4xx, 5xx)
      const firstDigit = statusCode.charAt(0)
      if (firstDigit >= '1' && firstDigit <= '5') {
        allData.http_status_range = `${firstDigit}xx`
      }

      // Remove original status field to avoid conflict with Datadog's reserved field
      delete allData.status
    }

    // Build ddtags with high-cardinality fields for filtering.
    // event:<name> is prepended so the event name is searchable via the
    // log search API — the `message` field (where eventName also lives)
    // is a DD reserved field and is NOT queryable from dashboard widget
    // queries or the aggregation API. See scripts/release/MONITORING.md.
// 【第 234-262 行】构建 `ddtags` 时有一条**反直觉的正确做法**：
//     `event:<name>` 前缀必须加进去，因为事件名虽然在 `message` 字段里也有，但 `message` 是
//     Datadog 的保留字段，**在 dashboard 查询和聚合 API 里查不了**。只有放进 tags 才能被检索。
//     注释还特意指向 `scripts/release/MONITORING.md`—— 这说明这套 tag 约定是跨文件、跨团队对齐过的，
//     不是一个人拍脑袋定的。第 258 行再把所有剩下的字段作为可搜索属性铺开（不进 tags，避免 tags 膨胀）。
    const allDataRecord = allData
    const tags = [
      `event:${eventName}`,
      ...TAG_FIELDS.filter(
        field =>
          allDataRecord[field] !== undefined && allDataRecord[field] !== null,
      ).map(field => `${camelToSnakeCase(field)}:${allDataRecord[field]}`),
    ]

    const log: DatadogLog = {
      ddsource: 'nodejs',
      ddtags: tags.join(','),
      message: eventName,
      service: 'claude-code',
      hostname: 'claude-code',
      env: process.env.USER_TYPE,
    }

    // Add all fields as searchable attributes (not duplicated in tags)
    for (const [key, value] of Object.entries(allData)) {
      if (value !== undefined && value !== null) {
        log[camelToSnakeCase(key)] = value
      }
    }

    logBatch.push(log)

    // Flush immediately if batch is full, otherwise schedule
    if (logBatch.length >= MAX_BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      void flushLogs()
    } else {
      scheduleFlush()
    }
  } catch (error) {
    logError(error)
  }
}

const NUM_USER_BUCKETS = 30
// 【第 281-299 行】`getUserBucket` 是「**用哈希分桶代替真实 user id 计数**」的经典做法：
//     把 user id 做 sha256，取前 8 位 hex 转数字，再 `mod 30` 落到 30 个桶之一。
//     为什么要这么做？告警想看「受影响的**用户数**」而不是「事件数」（一个用户重试可能刷出很多事件），
//     但又不能直接数 user id（违反隐私、且基数爆炸）。哈希分桶让「数独立桶数」≈「估独立用户数」，
//     同时 user id 本身永远不会离开本机。

/**
 * Gets a 'bucket' that the user ID falls into.
 *
 * For alerting purposes, we want to alert on the number of users impacted
 * by an issue, rather than the number of events- often a small number of users
 * can generate a large number of events (e.g. due to retries). To approximate
 * this without ruining cardinality by counting user IDs directly, we hash the user ID
 * and assign it to one of a fixed number of buckets.
 *
 * This allows us to estimate the number of unique users by counting unique buckets,
 * while preserving user privacy and reducing cardinality.
 */
const getUserBucket = memoize((): number => {
  const userId = getOrCreateUserID()
  const hash = createHash('sha256').update(userId).digest('hex')
  return parseInt(hash.slice(0, 8), 16) % NUM_USER_BUCKETS
})

function getFlushIntervalMs(): number {
// 【第 301-307 行】`getFlushIntervalMs` 的写法又出现了 `parseInt(...) || DEFAULT` 模式——
//     和 `oauth/client.ts` 里解析 refresh 过期时间同源：环境变量没设或解析失败（NaN）时，
//     `||` 兜回默认值。`parseInt` 失败返回 NaN（falsy），只有 `||` 能接住，不能用 `??`
//     （`??` 只认 null/undefined，NaN 会漏过）。这是前面 `oauth` 那批讲过的同一处陷阱。
  // Allow tests to override to not block on the default flush interval.
  return (
    parseInt(process.env.CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS || '', 10) ||
    DEFAULT_FLUSH_INTERVAL_MS
  )
}
