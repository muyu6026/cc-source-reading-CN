// 整个桥接服务端接口层共用这一个 HTTP 客户端；重试、退避、取消都由调用方管，这里只管单次请求的形状
import axios from 'axios'

import { debugBody, extractErrorDetail } from './debugUtils.js'
import {
  BRIDGE_LOGIN_INSTRUCTION,
  type BridgeApiClient,
  type BridgeConfig,
  type PermissionResponseEvent,
  type WorkResponse,
} from './types.js'

// 依赖全部注入：基址、取令牌、版本号、调试输出、401 处理、可信设备令牌
type BridgeApiDeps = {
  baseUrl: string
  getAccessToken: () => string | undefined
  runnerVersion: string
  onDebug?: (msg: string) => void
// 401 处理做成注入而不是直接导入：真正的刷新函数会连带拉起配置、文件、权限、会话存储、命令表，约一千三百个模块
  /**
   * Called on 401 to attempt OAuth token refresh. Returns true if refreshed,
   * in which case the request is retried once. Injected because
   * handleOAuth401Error from utils/auth.ts transitively pulls in config.ts →
   * file.ts → permissions/filesystem.ts → sessionStorage.ts → commands.ts
   * (~1300 modules). Daemon callers using env-var tokens omit this — their
   * tokens don't refresh, so 401 goes straight to BridgeFatalError.
   */
// 没有注入处理器的调用方（守护进程用环境变量令牌）拿到 401 直接当致命错误，那种令牌本来就不会刷新
  onAuth401?: (staleAccessToken: string) => Promise<boolean>
// 可信设备令牌是可选的：服务端开启强制后会要求它，缺省时省略这个头，服务端走关闭开关的分支
  /**
   * Returns the trusted device token to send as X-Trusted-Device-Token on
   * bridge API calls. Bridge sessions have SecurityTier=ELEVATED on the
   * server (CCR v2); when the server's enforcement flag is on,
   * ConnectBridgeWorker requires a trusted device at JWT-issuance.
   * Optional — when absent or returning undefined, the header is omitted
   * and the server falls through to its flag-off/no-op path. The CLI-side
   * gate is tengu_sessions_elevated_auth_enforcement (see trustedDevice.ts).
   */
  getTrustedDeviceToken?: () => string | undefined
}

// 接口版本用一个固定字符串钉住，所有请求共用
const BETA_HEADER = 'environments-2025-11-01'

// 白名单只允许字母数字下划线连字符：服务端给的标识要拼进路径，先挡住穿越与注入
/** Allowlist pattern for server-provided IDs used in URL path segments. */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Validate that a server-provided ID is safe to interpolate into a URL path.
 * Prevents path traversal (e.g. `../../admin`) and injection via IDs that
 * contain slashes, dots, or other special characters.
 */
// 校验函数单独导出，方便调用方在别处复用同一套判据
export function validateBridgeId(id: string, label: string): string {
// 空串也当非法：空标识拼进路径会变成相邻斜杠，路由会错位
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`)
  }
  return id
}

/** Fatal bridge errors that should not be retried (e.g. auth failures). */
// 致命错误带上状态码与服务端错误类型，上层据此区分过期、无权限与一般失败
export class BridgeFatalError extends Error {
  readonly status: number
  /** Server-provided error type, e.g. "environment_expired". */
  readonly errorType: string | undefined
// 继承内置错误并改名，是为了让序列化与日志里能认出这是桥接的致命错误
  constructor(message: string, status: number, errorType?: string) {
    super(message)
    this.name = 'BridgeFatalError'
    this.status = status
    this.errorType = errorType
  }
}

// 工厂返回一组方法，闭包里持有空轮询计数这类跨请求状态
export function createBridgeApiClient(deps: BridgeApiDeps): BridgeApiClient {
  function debug(msg: string): void {
    deps.onDebug?.(msg)
  }

// 连续空轮询的计数只用于限流日志：每来一次有结果的响应就归零
  let consecutiveEmptyPolls = 0
  const EMPTY_POLL_LOG_INTERVAL = 100

// 请求头统一在这里拼：认证、内容类型、接口版本、运行器版本
  function getHeaders(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'x-environment-runner-version': deps.runnerVersion,
    }
// 设备令牌按需附加：拿到才加，拿不到就不发这个头
    const deviceToken = deps.getTrustedDeviceToken?.()
    if (deviceToken) {
      headers['X-Trusted-Device-Token'] = deviceToken
    }
    return headers
  }

// 取不到令牌直接抛带指引的错误，而不是发一个必然 401 的请求
  function resolveAuth(): string {
    const accessToken = deps.getAccessToken()
    if (!accessToken) {
      throw new Error(BRIDGE_LOGIN_INSTRUCTION)
    }
    return accessToken
  }

  /**
   * Execute an OAuth-authenticated request with a single retry on 401.
   * On 401, attempts token refresh via handleOAuth401Error (same pattern as
   * withRetry.ts for v1/messages). If refresh succeeds, retries the request
   * once with the new token. If refresh fails or the retry also returns 401,
   * the 401 response is returned for handleErrorStatus to throw BridgeFatalError.
   */
// 带认证的请求统一走这里：只重试一次，且只在 401 时重试
  async function withOAuthRetry<T>(
    fn: (accessToken: string) => Promise<{ status: number; data: T }>,
    context: string,
  ): Promise<{ status: number; data: T }> {
    const accessToken = resolveAuth()
    const response = await fn(accessToken)

// 非 401 一律原样返回，包括 4xx 与 5xx，交给状态码处理函数决定怎么抛
    if (response.status !== 401) {
      return response
    }

// 没有刷新处理器就把 401 原样返回，让下面那条按致命错误抛出
    if (!deps.onAuth401) {
      debug(`[bridge:api] ${context}: 401 received, no refresh handler`)
      return response
    }

    // Attempt token refresh — matches the pattern in withRetry.ts
    debug(`[bridge:api] ${context}: 401 received, attempting token refresh`)
// 刷新失败也算走到尽头，同样把原始 401 返回而不是伪造一个错误
    const refreshed = await deps.onAuth401(accessToken)
    if (refreshed) {
      debug(`[bridge:api] ${context}: Token refreshed, retrying request`)
// 重试前重新取一次令牌：刷新可能改了进程级状态，不一定就是刚才那个变量
      const newToken = resolveAuth()
      const retryResponse = await fn(newToken)
// 重试也只做一次：第二次还 401 说明问题不在令牌新鲜度上
      if (retryResponse.status !== 401) {
        return retryResponse
      }
      debug(`[bridge:api] ${context}: Retry after refresh also got 401`)
    } else {
      debug(`[bridge:api] ${context}: Token refresh failed`)
    }

    // Refresh failed — return 401 for handleErrorStatus to throw
    return response
  }

  return {
// 注册环境：把机器名、目录、分支、仓库地址一起上报，服务端据此在网页端展示与筛选
    async registerBridgeEnvironment(
      config: BridgeConfig,
    ): Promise<{ environment_id: string; environment_secret: string }> {
      debug(
        `[bridge:api] POST /v1/environments/bridge bridgeId=${config.bridgeId}`,
      )

      const response = await withOAuthRetry(
        (token: string) =>
          axios.post<{
            environment_id: string
            environment_secret: string
          }>(
// 端点固定在环境桥接这一支，与工作轮询的路径前缀区分开
            `${deps.baseUrl}/v1/environments/bridge`,
            {
              machine_name: config.machineName,
              directory: config.dir,
              branch: config.branch,
              git_repo_url: config.gitRepoUrl,
              // Advertise session capacity so claude.ai/code can show
              // "2/4 sessions" badges and only block the picker when
              // actually at capacity. Backends that don't yet accept
              // this field will silently ignore it.
// 上报并发容量：网页端靠它显示已用几分之几，并且只在真的满了才挡住选择
              max_sessions: config.maxSessions,
              // worker_type lets claude.ai filter environments by origin
              // (e.g. assistant picker only shows assistant-mode workers).
              // Desktop cowork app sends "cowork"; we send a distinct value.
// 工作进程类型塞在元数据里：网页端据此区分助手模式与普通模式的环境
              metadata: { worker_type: config.workerType },
              // Idempotent re-registration: if we have a backend-issued
              // environment_id from a prior session (--session-id resume),
              // send it back so the backend reattaches instead of creating
              // a new env. The backend may still hand back a fresh ID if
              // the old one expired — callers must compare the response.
// 续用旧环境是幂等的关键，但服务端仍可能因为过期而返回新标识，所以调用方必须比对响应
              ...(config.reuseEnvironmentId && {
                environment_id: config.reuseEnvironmentId,
              }),
            },
            {
              headers: getHeaders(token),
// 注册给十五秒，比其余请求宽：它要等后端建环境并下发密钥
              timeout: 15_000,
// 只有 5xx 抛异常：4xx 全部交给状态码处理函数，那样才能产出带错误类型的致命错误
              validateStatus: status => status < 500,
            },
          ),
        'Registration',
      )

// 每个方法都是这套顺序：发请求、判状态、记调试、返回数据
      handleErrorStatus(response.status, response.data, 'Registration')
      debug(
        `[bridge:api] POST /v1/environments/bridge -> ${response.status} environment_id=${response.data.environment_id}`,
      )
      debug(
        `[bridge:api] >>> ${debugBody({ machine_name: config.machineName, directory: config.dir, branch: config.branch, git_repo_url: config.gitRepoUrl, max_sessions: config.maxSessions, metadata: { worker_type: config.workerType } })}`,
      )
      debug(`[bridge:api] <<< ${debugBody(response.data)}`)
      return response.data
    },

// 长轮询取活：超时十秒，可被外部信号中断——关闭桥接时靠它立刻退出
    async pollForWork(
      environmentId: string,
      environmentSecret: string,
      signal?: AbortSignal,
      reclaimOlderThanMs?: number,
    ): Promise<WorkResponse | null> {
      validateBridgeId(environmentId, 'environmentId')

// 先保存再归零：这样任何一次抛错都会打断连续空轮询的记录，日志不会被误判
      // Save and reset so errors break the "consecutive empty" streak.
      // Restored below when the response is truly empty.
      const prevEmptyPolls = consecutiveEmptyPolls
      consecutiveEmptyPolls = 0

// 端点带上环境标识，路径参数已过白名单校验
      const response = await axios.get<WorkResponse | null>(
        `${deps.baseUrl}/v1/environments/${environmentId}/work/poll`,
        {
          headers: getHeaders(environmentSecret),
// 回收参数是可选的：不带就是只领新活，带了才能把旧环境里悬着的活捡回来
          params:
            reclaimOlderThanMs !== undefined
              ? { reclaim_older_than_ms: reclaimOlderThanMs }
              : undefined,
          timeout: 10_000,
          signal,
          validateStatus: status => status < 500,
        },
      )

      handleErrorStatus(response.status, response.data, 'Poll')

      // Empty body or null = no work available
// 响应体为空就代表暂时没有活，这不是错误
      if (!response.data) {
        consecutiveEmptyPolls = prevEmptyPolls + 1
// 第一次空轮询必记，之后每满一百次记一次：既不沉默也不刷屏
        if (
          consecutiveEmptyPolls === 1 ||
          consecutiveEmptyPolls % EMPTY_POLL_LOG_INTERVAL === 0
        ) {
          debug(
            `[bridge:api] GET .../work/poll -> ${response.status} (no work, ${consecutiveEmptyPolls} consecutive empty polls)`,
          )
        }
        return null
      }

      debug(
        `[bridge:api] GET .../work/poll -> ${response.status} workId=${response.data.id} type=${response.data.data?.type}${response.data.data?.id ? ` sessionId=${response.data.data.id}` : ''}`,
      )
      debug(`[bridge:api] <<< ${debugBody(response.data)}`)
      return response.data
    },

// 确认领活：这一步之后服务端才认为活被接手，用会话令牌而不是环境密钥
    async acknowledgeWork(
      environmentId: string,
      workId: string,
      sessionToken: string,
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(workId, 'workId')

      debug(`[bridge:api] POST .../work/${workId}/ack`)

      const response = await axios.post(
        `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/ack`,
        {},
        {
          headers: getHeaders(sessionToken),
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )

      handleErrorStatus(response.status, response.data, 'Acknowledge')
      debug(`[bridge:api] POST .../work/${workId}/ack -> ${response.status}`)
    },

// 停活带强制标志：优雅停止与强杀在服务端是两种处理
    async stopWork(
      environmentId: string,
      workId: string,
      force: boolean,
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(workId, 'workId')

      debug(`[bridge:api] POST .../work/${workId}/stop force=${force}`)

      const response = await withOAuthRetry(
        (token: string) =>
          axios.post(
            `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/stop`,
            { force },
            {
              headers: getHeaders(token),
              timeout: 10_000,
              validateStatus: s => s < 500,
            },
          ),
        'StopWork',
      )

      handleErrorStatus(response.status, response.data, 'StopWork')
      debug(`[bridge:api] POST .../work/${workId}/stop -> ${response.status}`)
    },

// 注销环境：退出时调用，失败也不影响本地，所以调用方通常只记日志
    async deregisterEnvironment(environmentId: string): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')

      debug(`[bridge:api] DELETE /v1/environments/bridge/${environmentId}`)

      const response = await withOAuthRetry(
        (token: string) =>
          axios.delete(
            `${deps.baseUrl}/v1/environments/bridge/${environmentId}`,
            {
              headers: getHeaders(token),
              timeout: 10_000,
              validateStatus: s => s < 500,
            },
          ),
        'Deregister',
      )

      handleErrorStatus(response.status, response.data, 'Deregister')
      debug(
        `[bridge:api] DELETE /v1/environments/bridge/${environmentId} -> ${response.status}`,
      )
    },

// 归档会话：会话记录留在服务端，归档只是从活跃列表里摘掉
    async archiveSession(sessionId: string): Promise<void> {
      validateBridgeId(sessionId, 'sessionId')

      debug(`[bridge:api] POST /v1/sessions/${sessionId}/archive`)

      const response = await withOAuthRetry(
        (token: string) =>
          axios.post(
            `${deps.baseUrl}/v1/sessions/${sessionId}/archive`,
            {},
            {
              headers: getHeaders(token),
              timeout: 10_000,
              validateStatus: s => s < 500,
            },
          ),
        'ArchiveSession',
      )

// 已归档返回冲突码，这是幂等语义而不是错误，直接当成功
      // 409 = already archived (idempotent, not an error)
      if (response.status === 409) {
        debug(
          `[bridge:api] POST /v1/sessions/${sessionId}/archive -> 409 (already archived)`,
        )
        return
      }

      handleErrorStatus(response.status, response.data, 'ArchiveSession')
      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/archive -> ${response.status}`,
      )
    },

// 重连会话：环境丢失后把新会话挂回原来的环境上，网页端的地址因此不变
    async reconnectSession(
      environmentId: string,
      sessionId: string,
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(sessionId, 'sessionId')

      debug(
        `[bridge:api] POST /v1/environments/${environmentId}/bridge/reconnect session_id=${sessionId}`,
      )

      const response = await withOAuthRetry(
        (token: string) =>
          axios.post(
            `${deps.baseUrl}/v1/environments/${environmentId}/bridge/reconnect`,
            { session_id: sessionId },
            {
              headers: getHeaders(token),
              timeout: 10_000,
              validateStatus: s => s < 500,
            },
          ),
        'ReconnectSession',
      )

      handleErrorStatus(response.status, response.data, 'ReconnectSession')
      debug(`[bridge:api] POST .../bridge/reconnect -> ${response.status}`)
    },

// 心跳续租：返回是否延长了租约以及当前状态，调用方据此决定是否放弃
    async heartbeatWork(
      environmentId: string,
      workId: string,
      sessionToken: string,
    ): Promise<{ lease_extended: boolean; state: string }> {
      validateBridgeId(environmentId, 'environmentId')
      validateBridgeId(workId, 'workId')

      debug(`[bridge:api] POST .../work/${workId}/heartbeat`)

      const response = await axios.post<{
        lease_extended: boolean
        state: string
        last_heartbeat: string
        ttl_seconds: number
      }>(
        `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/heartbeat`,
        {},
        {
          headers: getHeaders(sessionToken),
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )

      handleErrorStatus(response.status, response.data, 'Heartbeat')
      debug(
        `[bridge:api] POST .../work/${workId}/heartbeat -> ${response.status} lease_extended=${response.data.lease_extended} state=${response.data.state}`,
      )
      return response.data
    },

// 权限响应也走事件通道，单个事件包成数组发送，与服务端的事件批量接口对齐
    async sendPermissionResponseEvent(
      sessionId: string,
      event: PermissionResponseEvent,
      sessionToken: string,
    ): Promise<void> {
      validateBridgeId(sessionId, 'sessionId')

      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/events type=${event.type}`,
      )

      const response = await axios.post(
        `${deps.baseUrl}/v1/sessions/${sessionId}/events`,
        { events: [event] },
        {
          headers: getHeaders(sessionToken),
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )

      handleErrorStatus(
        response.status,
        response.data,
        'SendPermissionResponseEvent',
      )
      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/events -> ${response.status}`,
      )
      debug(`[bridge:api] >>> ${debugBody({ events: [event] })}`)
      debug(`[bridge:api] <<< ${debugBody(response.data)}`)
    },
  }
}

// 状态码到错误的统一翻译就在这里，所有方法都过这一关
function handleErrorStatus(
  status: number,
  data: unknown,
  context: string,
): void {
// 只有两个成功码：无内容与正常返回，其余一律进分支
  if (status === 200 || status === 204) {
    return
  }
  const detail = extractErrorDetail(data)
  const errorType = extractErrorTypeFromData(data)
  switch (status) {
// 401 抛致命错误并附上登录指引，因为重试没有意义
    case 401:
      throw new BridgeFatalError(
        `${context}: Authentication failed (401)${detail ? `: ${detail}` : ''}. ${BRIDGE_LOGIN_INSTRUCTION}`,
        401,
        errorType,
      )
// 403 分两种：会话过期要提示重开，权限不足要提示查组织策略
    case 403:
      throw new BridgeFatalError(
        isExpiredErrorType(errorType)
          ? 'Remote Control session has expired. Please restart with `claude remote-control` or /remote-control.'
          : `${context}: Access denied (403)${detail ? `: ${detail}` : ''}. Check your organization permissions.`,
        403,
        errorType,
      )
// 404 优先用服务端给的细节，没有才用兜底话术
    case 404:
      throw new BridgeFatalError(
        detail ??
          `${context}: Not found (404). Remote Control may not be available for this organization.`,
        404,
        errorType,
      )
// 410 是环境过期，即使服务端没给错误类型也补上，让上层能统一判断
    case 410:
      throw new BridgeFatalError(
        detail ??
          'Remote Control session has expired. Please restart with `claude remote-control` or /remote-control.',
        410,
        errorType ?? 'environment_expired',
      )
// 限流用普通错误而不是致命错误：它是可重试的，调用方会退避后再来
    case 429:
      throw new Error(`${context}: Rate limited (429). Polling too frequently.`)
    default:
      throw new Error(
        `${context}: Failed with status ${status}${detail ? `: ${detail}` : ''}`,
      )
  }
}

/** Check whether an error type string indicates a session/environment expiry. */
// 过期判定看错误类型里有没有过期或生命周期字样，不依赖具体枚举
export function isExpiredErrorType(errorType: string | undefined): boolean {
  if (!errorType) {
    return false
  }
  return errorType.includes('expired') || errorType.includes('lifetime')
}

/**
 * Check whether a BridgeFatalError is a suppressible 403 permission error.
 * These are 403 errors for scopes like 'external_poll_sessions' or operations
 * like StopWork that fail because the user's role lacks 'environments:manage'.
 * They don't affect core functionality and shouldn't be shown to users.
 */
// 可抑制的 403：角色缺管理权限导致的失败不影响核心功能，不该弹给用户
export function isSuppressible403(err: BridgeFatalError): boolean {
  if (err.status !== 403) {
    return false
  }
  return (
    err.message.includes('external_poll_sessions') ||
    err.message.includes('environments:manage')
  )
}

// 从响应体里挖错误类型，形状不对就返回空，绝不抛错——错误处理路径不能再出错
function extractErrorTypeFromData(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    if (
      'error' in data &&
      data.error &&
      typeof data.error === 'object' &&
      'type' in data.error &&
      typeof data.error.type === 'string'
    ) {
      return data.error.type
    }
  }
  return undefined
}
