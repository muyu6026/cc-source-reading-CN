import axios from 'axios'
// 依赖：axios、OAuth 配置、SDK 消息类型、调试日志、teleport API 鉴权与请求准备。
import { getOauthConfig } from '../constants/oauth.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { getOAuthHeaders, prepareApiRequest } from '../utils/teleport/api.js'

export const HISTORY_PAGE_SIZE = 100
// HISTORY_PAGE_SIZE：每页拉一百条事件，分页游标固定步长。

export type HistoryPage = {
  /** Chronological order within the page. */
  events: SDKMessage[]
  /** Oldest event ID in this page → before_id cursor for next-older page. */
  firstId: string | null
  /** true = older events exist. */
  hasMore: boolean
}
// HistoryPage 类型：本页事件数组、最旧 id（作 before 游标）、是否还有更旧。

type SessionEventsResponse = {
  data: SDKMessage[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}
// SessionEventsResponse：远端原始响应形状，snake_case 字段。

export type HistoryAuthCtx = {
  baseUrl: string
  headers: Record<string, string>
}
// HistoryAuthCtx：把鉴权与 base URL 备好，跨页复用避免重复准备。

/** Prepare auth + headers + base URL once, reuse across pages. */
export async function createHistoryAuthCtx(
  sessionId: string,
): Promise<HistoryAuthCtx> {
  const { accessToken, orgUUID } = await prepareApiRequest()
  return {
    baseUrl: `${getOauthConfig().BASE_API_URL}/v1/sessions/${sessionId}/events`,
    headers: {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
    },
  }
}
// createHistoryAuthCtx：一次性拼好鉴权头与事件接口地址，含 beta 标头与组织 uuid。

async function fetchPage(
  ctx: HistoryAuthCtx,
  params: Record<string, string | number | boolean>,
  label: string,
): Promise<HistoryPage | null> {
// fetchPage：内部通用拉页函数，带超时与全状态放行（validateStatus 恒真）。
  const resp = await axios
    .get<SessionEventsResponse>(ctx.baseUrl, {
      headers: ctx.headers,
      params,
      timeout: 15000,
      validateStatus: () => true,
    })
    .catch(() => null)
  if (!resp || resp.status !== 200) {
    logForDebugging(`[${label}] HTTP ${resp?.status ?? 'error'}`)
    return null
  }
  return {
    events: Array.isArray(resp.data.data) ? resp.data.data : [],
    firstId: resp.data.first_id,
    hasMore: resp.data.has_more,
  }
}
// fetchPage 收尾：把响应规整成 HistoryPage，坏响应或丢事件都兜底成空数组。

/**
 * Newest page: last `limit` events, chronological, via anchor_to_latest.
 * has_more=true means older events exist.
 */
export async function fetchLatestEvents(
  ctx: HistoryAuthCtx,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  return fetchPage(ctx, { limit, anchor_to_latest: true }, 'fetchLatestEvents')
}
// fetchLatestEvents：取最新一页（anchor_to_latest），has_more 表示有更旧。

/** Older page: events immediately before `beforeId` cursor. */
export async function fetchOlderEvents(
  ctx: HistoryAuthCtx,
  beforeId: string,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  return fetchPage(ctx, { limit, before_id: beforeId }, 'fetchOlderEvents')
}
// fetchOlderEvents：取 beforeId 之前的一页，往前翻历史。
