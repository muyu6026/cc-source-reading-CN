import axios from 'axios'
import { z } from 'zod/v4'
import { getOauthConfig } from '../../constants/oauth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getOrganizationUUID } from '../../services/oauth/client.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import type { ToolUseContext } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { DESCRIPTION, PROMPT, REMOTE_TRIGGER_TOOL_NAME } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
// lazySchema 延后构造；trigger_id 用正则锁死 ^[\w-]+$——路径段字符集，防注入进 URL。
  z.strictObject({
    action: z.enum(['list', 'get', 'create', 'update', 'run']),
    trigger_id: z
      .string()
      .regex(/^[\w-]+$/)
      .optional()
      .describe('Required for get, update, and run'),
    body: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('JSON body for create and update'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.number(),
    json: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const TRIGGERS_BETA = 'ccr-triggers-2026-01-30'
// TRIGGERS_BETA 是 anthropic-beta 版本戳（ccr-triggers-2026-01-30）——CCR（远程控制）API 走 beta 头协商，不是公开稳定接口。

export const RemoteTriggerTool = buildTool({
  name: REMOTE_TRIGGER_TOOL_NAME,
  searchHint: 'manage scheduled remote agent triggers',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
// isEnabled 双闸门：GrowthBook 特性 tengu_surreal_dali 且策略允许 allow_remote_sessions——任一门关，工具整个不注册。
    return (
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_surreal_dali', false) &&
      isPolicyAllowed('allow_remote_sessions')
    )
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly(input: Input) {
// isReadOnly 二分：list/get 是读，create/update/run 是写——run 会真触发远程 agent，算写。
    return input.action === 'list' || input.action === 'get'
  },
  toAutoClassifierInput(input: Input) {
    return `RemoteTrigger ${input.action}${input.trigger_id ? ` ${input.trigger_id}` : ''}`
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  async call(input: Input, context: ToolUseContext) {
// call() 先过鉴权三连：刷新 OAuth token → 取 accessToken（没有就抛 /login）→ 解析组织 UUID。token 全程在进程内，不进 shell、不进 prompt。
    await checkAndRefreshOAuthTokenIfNeeded()
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      throw new Error(
        'Not authenticated with a claude.ai account. Run /login and try again.',
      )
    }
    const orgUUID = await getOrganizationUUID()
    if (!orgUUID) {
      throw new Error('Unable to resolve organization UUID.')
    }

    const base = `${getOauthConfig().BASE_API_URL}/v1/code/triggers`
// base URL 拼在 OAuth 配置上（BASE_API_URL/v1/code/triggers），请求头五件套：Bearer token / JSON / anthropic-version / anthropic-beta（版本戳）/ x-organization-uuid。
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': TRIGGERS_BETA,
      'x-organization-uuid': orgUUID,
    }

    const { action, trigger_id, body } = input
    let method: 'GET' | 'POST'
    let url: string
    let data: unknown
    switch (action) {
// 五动作到 REST 的映射表：list=GET 列表、get=GET 单项、create=POST、update=POST（幂等更新语义，不用 PUT）、run=POST /run（空 body）。
      case 'list':
        method = 'GET'
        url = base
        break
      case 'get':
        if (!trigger_id) throw new Error('get requires trigger_id')
        method = 'GET'
        url = `${base}/${trigger_id}`
        break
      case 'create':
        if (!body) throw new Error('create requires body')
        method = 'POST'
        url = base
        data = body
        break
      case 'update':
        if (!trigger_id) throw new Error('update requires trigger_id')
        if (!body) throw new Error('update requires body')
        method = 'POST'
        url = `${base}/${trigger_id}`
        data = body
        break
      case 'run':
        if (!trigger_id) throw new Error('run requires trigger_id')
        method = 'POST'
        url = `${base}/${trigger_id}/run`
        data = {}
        break
    }

    const res = await axios.request({
// validateStatus: () => true 是关键——axios 默认 4xx/5xx 抛异常，这里改成一律放行：HTTP 状态本身就是工具的输出（连同响应体原样交给模型解读）。
      method,
      url,
      headers,
      data,
      timeout: 20_000,
// 20 秒超时 + abort signal 透传——远程 API 慢或用户打断都能干净退出。
      signal: context.abortController.signal,
      validateStatus: () => true,
    })

    return {
// 输出就是 {status, json} 二元组：状态码 + 序列化响应体，不做任何解释——解释权留给模型。
      data: {
        status: res.status,
        json: jsonStringify(res.data),
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
// tool_result 格式：HTTP 状态码一行 + JSON 体，与 WebFetch 的结果行风格一致。
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `HTTP ${output.status}\n${output.json}`,
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)
