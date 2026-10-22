// Mock rate limits for testing [ANT-ONLY]
// This allows testing various rate limit scenarios without hitting actual limits
//
// ⚠️  WARNING: This is for internal testing/demo purposes only!
// The mock headers may not exactly match the API specification or real-world behavior.
// Always validate against actual API responses before relying on this for production features.
// 文件级警告：这是 [ANT-ONLY] 模块——整个文件所有公开函数第一句都是 if (process.env.USER_TYPE !== 'ant') return，
// 所以普通用户零开销、零影响。存在的意义是让 Anthropic 内部员工在本地复现各种限流态（429、warning、overage、org 额度……），
// 而不必真的去把配额用光。文件头自己承认：mock 头不保证和真实 API 规范逐字一致，上生产前必须对照真实响应校准。

import type { SubscriptionType } from '../services/oauth/types.js'
import { setMockBillingAccessOverride } from '../utils/billing.js'
import type { OverageDisabledReason } from './claudeAiLimits.js'

type MockHeaders = {
  'anthropic-ratelimit-unified-status'?:
    | 'allowed'
    | 'allowed_warning'
    | 'rejected'
  'anthropic-ratelimit-unified-reset'?: string
  'anthropic-ratelimit-unified-representative-claim'?:
    | 'five_hour'
    | 'seven_day'
    | 'seven_day_opus'
    | 'seven_day_sonnet'
  'anthropic-ratelimit-unified-overage-status'?:
    | 'allowed'
    | 'allowed_warning'
    | 'rejected'
  'anthropic-ratelimit-unified-overage-reset'?: string
  'anthropic-ratelimit-unified-overage-disabled-reason'?: OverageDisabledReason
  'anthropic-ratelimit-unified-fallback'?: 'available'
  'anthropic-ratelimit-unified-fallback-percentage'?: string
  'retry-after'?: string
  // Early warning utilization headers
  'anthropic-ratelimit-unified-5h-utilization'?: string
  'anthropic-ratelimit-unified-5h-reset'?: string
  'anthropic-ratelimit-unified-5h-surpassed-threshold'?: string
  'anthropic-ratelimit-unified-7d-utilization'?: string
  'anthropic-ratelimit-unified-7d-reset'?: string
  'anthropic-ratelimit-unified-7d-surpassed-threshold'?: string
  'anthropic-ratelimit-unified-overage-utilization'?: string
  'anthropic-ratelimit-unified-overage-surpassed-threshold'?: string
}
// MockHeaders 就是「一次 API 响应里所有跟限流有关的头」的形状摹本：
// - unified-status / unified-reset / representative-claim 是订阅配额三件套（allowed / allowed_warning / rejected）；
// - overage-* 一族是「超额用量（extra usage）」状态，disabled-reason 解释为什么超额被禁；
// - fallback / fallback-percentage 表示有备用模型可用；
// - 5h/7d utilization + reset + surpassed-threshold 是「早期预警」族——还没超限，但用量已越过预警线；
// - retry-after 是标准 HTTP 头，唯一不带 anthropic-ratelimit-unified- 前缀的。

export type MockHeaderKey =
  | 'status'
  | 'reset'
  | 'claim'
  | 'overage-status'
  | 'overage-reset'
  | 'overage-disabled-reason'
  | 'fallback'
  | 'fallback-percentage'
  | 'retry-after'
  | '5h-utilization'
  | '5h-reset'
  | '5h-surpassed-threshold'
  | '7d-utilization'
  | '7d-reset'
  | '7d-surpassed-threshold'
// MockHeaderKey 是上面那套长头名的「短键」：setMockHeader('status', 'rejected') 比写全称方便得多。
// 映射规则在 setMockHeader 里：retry-after 原样用，其余一律拼上 anthropic-ratelimit-unified- 前缀。

export type MockScenario =
  | 'normal'
  | 'session-limit-reached'
  | 'approaching-weekly-limit'
  | 'weekly-limit-reached'
  | 'overage-active'
  | 'overage-warning'
  | 'overage-exhausted'
  | 'out-of-credits'
  | 'org-zero-credit-limit'
  | 'org-spend-cap-hit'
  | 'member-zero-credit-limit'
  | 'seat-tier-zero-credit-limit'
  | 'opus-limit'
  | 'opus-warning'
  | 'sonnet-limit'
  | 'sonnet-warning'
  | 'fast-mode-limit'
  | 'fast-mode-short-limit'
  | 'extra-usage-required'
  | 'clear'
// 19 种 mock 场景，按族分：
// - 普通：normal / clear；
// - 订阅配额：session-limit-reached（5 小时会话窗）、approaching-weekly-limit、weekly-limit-reached（7 天周窗）；
// - 超额用量：overage-active / overage-warning / overage-exhausted / out-of-credits（钱包空）；
// - 组织额度（Team/Enterprise）：org-zero-credit-limit、org-spend-cap-hit、member-zero-credit-limit、seat-tier-zero-credit-limit；
// - 分模型：opus-limit/warning、sonnet-limit/warning；
// - fast mode：fast-mode-limit / fast-mode-short-limit；
// - extra-usage-required：headerless 429（只有 4xx 没有限流头）。

let mockHeaders: MockHeaders = {}
let mockEnabled = false
let mockHeaderless429Message: string | null = null
let mockSubscriptionType: SubscriptionType | null = null
let mockFastModeRateLimitDurationMs: number | null = null
let mockFastModeRateLimitExpiresAt: number | null = null
// Default subscription type for mock testing
const DEFAULT_MOCK_SUBSCRIPTION: SubscriptionType = 'max'
// 全部状态都是模块级单例（mockHeaders / mockEnabled / exceededLimits / fastMode 两个时间戳 / mockSubscriptionType）。
// 测试代码不追求纯函数化——一个进程同时只演一种限流态，模块级状态就是最直接的实现。
// DEFAULT_MOCK_SUBSCRIPTION = 'max'：没显式设订阅类型时，对外一律谎称 max，因为大多数限流 UI 分支要按订阅等级走。

// Track individual exceeded limits with their reset times
type ExceededLimit = {
  type: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
  resetsAt: number // Unix timestamp
}

let exceededLimits: ExceededLimit[] = []
// ExceededLimit 不存「哪个窗口超了」的布尔，而是每条超限自带 resetsAt（Unix 时间戳）。
// 这样同时命中 5h 和周窗时，能用「reset 最远的那条」当 representative claim——见 updateRepresentativeClaim。

// setMockHeader 是新方式：逐个头切换，可组合。旧方式（setMockRateLimitScenario）是整包场景，一次覆盖所有头。
// 两者共享同一份 mockHeaders，所以可以先用场景打底、再单独微调某个头。
// New approach: Toggle individual headers
export function setMockHeader(
  key: MockHeaderKey,
  value: string | undefined,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }
// USER_TYPE !== 'ant' 早退是这个文件的统一闸门：非 Anthropic 员工进程里，下面所有 setter 都是 no-op。
// 注意它只挡「写入」；getter 里也各有一次同样的判断（见 getMockHeaders / shouldUseMockSubscription）。

  mockEnabled = true

  // Special case for retry-after which doesn't have the prefix
  const fullKey = (
    key === 'retry-after' ? 'retry-after' : `anthropic-ratelimit-unified-${key}`
  ) as keyof MockHeaders

  if (value === undefined || value === 'clear') {
    delete mockHeaders[fullKey]
    if (key === 'claim') {
      exceededLimits = []
    }
    // Update retry-after if status changed
    if (key === 'status' || key === 'overage-status') {
      updateRetryAfter()
    }
    return
// 删除语义：value 传 undefined 或字面量 'clear' 都表示「删掉这个头」，而不是设成空串。
// 顺手维护两条不变量：删 claim 时 exceededLimits 整体清空（没有代表claim了，超限列表也没意义）；
// 删 status / overage-status 后重算 retry-after。
  } else {
    // Handle special cases for reset times
    if (key === 'reset' || key === 'overage-reset') {
      // If user provides a number, treat it as hours from now
      const hours = Number(value)
      if (!isNaN(hours)) {
        value = String(Math.floor(Date.now() / 1000) + hours * 3600)
      }
    }
// 人性化输入：reset / overage-reset 如果传的是纯数字，按「多少小时后」解释并换算成 Unix 时间戳。
// 传非数字则原样当时间戳用——测试里两种写法都见过。

    // Handle claims - add to exceeded limits
    if (key === 'claim') {
      const validClaims = [
        'five_hour',
        'seven_day',
        'seven_day_opus',
        'seven_day_sonnet',
      ]
      if (validClaims.includes(value)) {
        // Determine reset time based on claim type
        let resetsAt: number
        if (value === 'five_hour') {
          resetsAt = Math.floor(Date.now() / 1000) + 5 * 3600
        } else if (
          value === 'seven_day' ||
          value === 'seven_day_opus' ||
          value === 'seven_day_sonnet'
        ) {
          resetsAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
        } else {
          resetsAt = Math.floor(Date.now() / 1000) + 3600
        }

        // Add to exceeded limits (remove if already exists)
        exceededLimits = exceededLimits.filter(l => l.type !== value)
        exceededLimits.push({ type: value as ExceededLimit['type'], resetsAt })

        // Set the representative claim (furthest reset time)
        updateRepresentativeClaim()
        return
      }
    }
// claim 分支的处理链：
// 1) validClaims 白名单校验，不认识的值直接落到下面的通用赋值（不会污染超限列表）；
// 2) 按 claim 类型推 reset 时间——five_hour +5 小时，三个 seven_day_* +7 天，兜底 +1 小时；
// 3) 同类型先去重再 push（重复设同一个 claim 是覆盖，不是叠加）；
// 4) 最后重算 representative claim 并 return——claim 分支不走通用头赋值。
    // Widen to a string-valued record so dynamic key assignment is allowed.
    // MockHeaders values are string-literal unions; assigning a raw user-input
    // string requires widening, but this is mock/test code so it's acceptable.
    const headers: Partial<Record<keyof MockHeaders, string>> = mockHeaders
    headers[fullKey] = value
// 这里必须 widen：MockHeaders 的值是字符串字面量联合（'allowed' | 'rejected' | ...），
// 直接把用户传进来的裸 string 赋进去 TS 不干。转成 Partial<Record<keyof MockHeaders, string>> 绕开——
// 原文注释自己承认这在生产代码里不可接受，但 mock/测试代码可以。

    // Update retry-after if status changed
    if (key === 'status' || key === 'overage-status') {
      updateRetryAfter()
    }
  }

  // If all headers are cleared, disable mocking
  if (Object.keys(mockHeaders).length === 0) {
    mockEnabled = false
  }
// 自动关闸：所有头都被删光时把 mockEnabled 置回 false。
// 否则会留下「开着 mock 但一个头都没有」的中间态，getMockHeaders 的三条件检查虽然也能兜住，
// 但 getMockStatus 会打出 'Active mock headers:' 后面一片空白。
}

// Helper to update retry-after based on current state
function updateRetryAfter(): void {
  const status = mockHeaders['anthropic-ratelimit-unified-status']
  const overageStatus =
    mockHeaders['anthropic-ratelimit-unified-overage-status']
  const reset = mockHeaders['anthropic-ratelimit-unified-reset']

  if (
    status === 'rejected' &&
    (!overageStatus || overageStatus === 'rejected') &&
    reset
  ) {
    // Calculate seconds until reset
    const resetTimestamp = Number(reset)
    const secondsUntilReset = Math.max(
      0,
      resetTimestamp - Math.floor(Date.now() / 1000),
    )
    mockHeaders['retry-after'] = String(secondsUntilReset)
  } else {
    delete mockHeaders['retry-after']
  }
}
// retry-after 的写入条件是三合一：status 必须是 rejected，且（没配 overage 或 overage 也是 rejected），且有 reset 值。
// 翻译成业务语言：只有「真的被挡住且没有超额额度兜底」时才告诉客户端该等多久。
// 超额可用时删掉 retry-after——客户端应该直接走超额，而不是等待。

// Update the representative claim based on exceeded limits
function updateRepresentativeClaim(): void {
  if (exceededLimits.length === 0) {
    delete mockHeaders['anthropic-ratelimit-unified-representative-claim']
    delete mockHeaders['anthropic-ratelimit-unified-reset']
    delete mockHeaders['retry-after']
    return
  }

  // Find the limit with the furthest reset time
  const furthest = exceededLimits.reduce((prev, curr) =>
    curr.resetsAt > prev.resetsAt ? curr : prev,
  )

  // Set the representative claim (appears for both warning and rejected)
  mockHeaders['anthropic-ratelimit-unified-representative-claim'] =
    furthest.type
  mockHeaders['anthropic-ratelimit-unified-reset'] = String(furthest.resetsAt)

  // Add retry-after if rejected and no overage available
  if (mockHeaders['anthropic-ratelimit-unified-status'] === 'rejected') {
    const overageStatus =
      mockHeaders['anthropic-ratelimit-unified-overage-status']
    if (!overageStatus || overageStatus === 'rejected') {
      // Calculate seconds until reset
      const secondsUntilReset = Math.max(
        0,
        furthest.resetsAt - Math.floor(Date.now() / 1000),
      )
      mockHeaders['retry-after'] = String(secondsUntilReset)
    } else {
      // Overage is available, no retry-after
      delete mockHeaders['retry-after']
    }
  } else {
    delete mockHeaders['retry-after']
  }
}
// representative claim = 超限列表里 resetsAt 最远的那条（reduce 比较）。
// 同时命中 5h（今晚重置）和周窗（下周重置）时，对外展示周窗——它才是「用户实际被挡到什么时候」的答案。
// retry-after 同样只在「rejected 且超额不可用」时出现；超额可用就删掉。

// Add function to add exceeded limit with custom reset time
export function addExceededLimit(
  type: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet',
  hoursFromNow: number,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  mockEnabled = true
  const resetsAt = Math.floor(Date.now() / 1000) + hoursFromNow * 3600

  // Remove existing limit of same type
  exceededLimits = exceededLimits.filter(l => l.type !== type)
  exceededLimits.push({ type, resetsAt })

  // Update status to rejected if we have exceeded limits
  if (exceededLimits.length > 0) {
    mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
  }

  updateRepresentativeClaim()
}
// addExceededLimit 是 setMockHeader claim 分支的「自定义 reset 时间」版：小时数任意指定。
// 副作用：只要超限列表非空就把 status 改 rejected——超限和 rejected 在这里是绑定的。

// Set mock early warning utilization for time-relative thresholds
// claimAbbrev: '5h' or '7d'
// utilization: 0-1 (e.g., 0.92 for 92% used)
// hoursFromNow: hours until reset (default: 4 for 5h, 120 for 7d)
export function setMockEarlyWarning(
  claimAbbrev: '5h' | '7d' | 'overage',
  utilization: number,
  hoursFromNow?: number,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  mockEnabled = true

  // Clear ALL early warning headers first (5h is checked before 7d, so we need
  // to clear 5h headers when testing 7d to avoid 5h taking priority)
  clearMockEarlyWarning()
// 先清干净所有 early warning 头再设新的，原因是优先级：5h 预警先于 7d 预警判定。
// 如果测 7d 时不显式清 5h，上一轮测试残留的 5h utilization 会抢先触发预警，测出来的就不是你想要的那条路径。

  // Default hours based on claim type (early in window to trigger warning)
  const defaultHours = claimAbbrev === '5h' ? 4 : 5 * 24
  const hours = hoursFromNow ?? defaultHours
  const resetsAt = Math.floor(Date.now() / 1000) + hours * 3600

  mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-utilization`] =
    String(utilization)
  mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-reset`] =
    String(resetsAt)
  // Set the surpassed-threshold header to trigger early warning
  mockHeaders[
    `anthropic-ratelimit-unified-${claimAbbrev}-surpassed-threshold`
  ] = String(utilization)

  // Set status to allowed so early warning logic can upgrade it
  if (!mockHeaders['anthropic-ratelimit-unified-status']) {
    mockHeaders['anthropic-ratelimit-unified-status'] = 'allowed'
  }
}
// surpassed-threshold 头也置成 utilization 值——这个头是「预警已越过阈值」的信号位，客户端靠它决定要不要弹提示。
// 最后：如果 status 还没设过就补一个 'allowed'。不补的话预警逻辑没有升级起点（allowed → allowed_warning 的跳变需要基态）。

// Clear mock early warning headers
export function clearMockEarlyWarning(): void {
  delete mockHeaders['anthropic-ratelimit-unified-5h-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-5h-reset']
  delete mockHeaders['anthropic-ratelimit-unified-5h-surpassed-threshold']
  delete mockHeaders['anthropic-ratelimit-unified-7d-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-7d-reset']
  delete mockHeaders['anthropic-ratelimit-unified-7d-surpassed-threshold']
}

export function setMockRateLimitScenario(scenario: MockScenario): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  if (scenario === 'clear') {
    mockHeaders = {}
    mockHeaderless429Message = null
    mockEnabled = false
    return
  }

  mockEnabled = true

  // Set reset times for demos
  const fiveHoursFromNow = Math.floor(Date.now() / 1000) + 5 * 3600
  const sevenDaysFromNow = Math.floor(Date.now() / 1000) + 7 * 24 * 3600

  // Clear existing headers
  mockHeaders = {}
  mockHeaderless429Message = null

  // Only clear exceeded limits for scenarios that explicitly set them
  // Overage scenarios should preserve existing exceeded limits
  const preserveExceededLimits = [
    'overage-active',
    'overage-warning',
    'overage-exhausted',
  ].includes(scenario)
  if (!preserveExceededLimits) {
    exceededLimits = []
  }
// overage 三兄弟（active/warning/exhausted）显式保留已有的 exceededLimits，其他场景一律清空。
// 因为超额用量的前提就是「订阅已经超限」——清掉超限列表会让 overage 场景变成无源之水。

  switch (scenario) {
    case 'normal':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-reset': String(fiveHoursFromNow),
      }
      break

    case 'session-limit-reached':
      exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break

    case 'approaching-weekly-limit':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day',
      }
      break

    case 'weekly-limit-reached':
      exceededLimits = [{ type: 'seven_day', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break

    case 'overage-active': {
      // If no limits have been exceeded yet, default to 5-hour
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'allowed'
      // Set overage reset time (monthly)
      const endOfMonthActive = new Date()
      endOfMonthActive.setMonth(endOfMonthActive.getMonth() + 1, 1)
      endOfMonthActive.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthActive.getTime() / 1000),
      )
      break
// overage-active：订阅 rejected + 超额 allowed，即「可以继续用，走超额计费」。
// 超额的重置周期是月度，所以 reset 取「下个月 1 号 0 点」（setMonth(getMonth()+1, 1) 再清零时分秒）——
// 注意先设日期再 setHours(0,0,0,0) 的顺序，反了会把日期也带回当天。
    }

    case 'overage-warning': {
      // If no limits have been exceeded yet, default to 5-hour
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'allowed_warning'
      // Overage typically resets monthly, but for demo let's say end of month
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000),
      )
      break
    }

    case 'overage-exhausted': {
      // If no limits have been exceeded yet, default to 5-hour
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      // Both subscription and overage are exhausted
      // Subscription resets based on the exceeded limit, overage resets monthly
      const endOfMonthExhausted = new Date()
      endOfMonthExhausted.setMonth(endOfMonthExhausted.getMonth() + 1, 1)
      endOfMonthExhausted.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthExhausted.getTime() / 1000),
      )
      break
    }

    case 'out-of-credits': {
      // Out of credits - subscription limit hit, overage rejected due to insufficient credits
      // (wallet is empty)
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'out_of_credits'
// out-of-credits：订阅超限 + 超额 rejected，disabled-reason = out_of_credits，语义是「钱包空了，不是政策不让用」。
// 这和下面几个 org/member 级的零额度场景区分开——那些是「配额被设成 0」，UI 文案不同。
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000),
      )
      break
    }

    case 'org-zero-credit-limit': {
      // Org service has zero credit limit - admin set org-level spend cap to $0
      // Non-admin Team/Enterprise users should not see "Request extra usage" option
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'org_service_zero_credit_limit'
      const endOfMonthZero = new Date()
      endOfMonthZero.setMonth(endOfMonthZero.getMonth() + 1, 1)
      endOfMonthZero.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthZero.getTime() / 1000),
      )
      break
    }
// org 级零额度两种（org-zero-credit-limit / org-spend-cap-hit）：管理员把整个组织的支出上限设为 0 或撞到月度 cap。
// 原文注释特意标注：这类场景下非管理员的 Team/Enterprise 用户「不应该」看到 Request extra usage 入口——
// 组织层面被禁，个人申请无意义。mock 它们就是为了验证这条 UI 分支。

    case 'org-spend-cap-hit': {
      // Org spend cap hit for the month - org overages temporarily disabled
      // Non-admin Team/Enterprise users should not see "Request extra usage" option
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'org_level_disabled_until'
      const endOfMonthHit = new Date()
      endOfMonthHit.setMonth(endOfMonthHit.getMonth() + 1, 1)
      endOfMonthHit.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthHit.getTime() / 1000),
      )
      break
    }

    case 'member-zero-credit-limit': {
      // Member has zero credit limit - admin set this user's individual limit to $0
      // Non-admin Team/Enterprise users SHOULD see "Request extra usage" (admin can allocate more)
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'member_zero_credit_limit'
      const endOfMonthMember = new Date()
      endOfMonthMember.setMonth(endOfMonthMember.getMonth() + 1, 1)
      endOfMonthMember.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthMember.getTime() / 1000),
      )
      break
    }
// member / seat-tier 级零额度两种：被禁的粒度细到个人或席位档位。
// 原文注释特意标注：这类场景下非管理员「应该」看到 Request extra usage——管理员可以给这个用户/档位加额度，
// 所以入口要保留。和 org 级两种正好相反，是 UI 上最容易搞混的一对。

    case 'seat-tier-zero-credit-limit': {
      // Seat tier has zero credit limit - admin set this seat tier's limit to $0
      // Non-admin Team/Enterprise users SHOULD see "Request extra usage" (admin can allocate more)
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'seat_tier_zero_credit_limit'
      const endOfMonthSeatTier = new Date()
      endOfMonthSeatTier.setMonth(endOfMonthSeatTier.getMonth() + 1, 1)
      endOfMonthSeatTier.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthSeatTier.getTime() / 1000),
      )
      break
    }

    case 'opus-limit': {
      exceededLimits = [{ type: 'seven_day_opus', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim()
      // Always send 429 rejected status - the error handler will decide whether
      // to show an error or return NO_RESPONSE_REQUESTED based on fallback eligibility
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
// opus-limit 故意总是发 rejected 状态，不自己做 fallback 判断。
// 原文注释说得很直白：该显示错误、还是静默返回 NO_RESPONSE_REQUESTED（让上层换模型重试），
// 由错误处理器按 fallback 资格决定——mock 层只负责如实呈现「被限流了」这个事实。
    }

    case 'opus-warning': {
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_opus',
      }
      break
    }

    case 'sonnet-limit': {
      exceededLimits = [
        { type: 'seven_day_sonnet', resetsAt: sevenDaysFromNow },
      ]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    }

    case 'sonnet-warning': {
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_sonnet',
      }
      break
    }

    case 'fast-mode-limit': {
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      // Duration in ms (> 20s threshold to trigger cooldown)
      mockFastModeRateLimitDurationMs = 10 * 60 * 1000
      break
// fast mode 限流的关键是 20 秒阈值：fast-mode-limit 的 duration 是 10 分钟（远超阈值，触发冷却），
// fast-mode-short-limit 是 10 秒（低于阈值，不触发冷却）。
// 两个场景只差这一个数字，专门用来验证「短时限流不该把 fast mode 打进冷却」这条边界。
    }

    case 'fast-mode-short-limit': {
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      // Duration in ms (< 20s threshold, won't trigger cooldown)
      mockFastModeRateLimitDurationMs = 10 * 1000
      break
    }

    case 'extra-usage-required': {
      // Headerless 429 — exercises the entitlement-rejection path in errors.ts
      mockHeaderless429Message =
        'Extra usage is required for long context requests.'
      break
    }
// extra-usage-required 是 headerless 429：不设任何限流头，只给一条消息。
// 它对应真实世界里「1M 长上下文需要额外用量额度」这类 entitlement 拒绝——响应是 4xx 但没有任何 ratelimit-* 头，
// 专门用来 exercise errors.ts 里那条不依赖响应头的 entitlement-rejection 路径。

    default:
      break
  }
}

export function getMockHeaderless429Message(): string | null {
  if (process.env.USER_TYPE !== 'ant') {
    return null
  }
  // Env var path for -p / SDK testing where slash commands aren't available
  if (process.env.CLAUDE_MOCK_HEADERLESS_429) {
    return process.env.CLAUDE_MOCK_HEADERLESS_429
  }
  if (!mockEnabled) {
    return null
  }
  return mockHeaderless429Message
}
// headerless 429 的取值有两条路：环境变量优先（给 -p / SDK 测试用，那些场景没有 slash command 可调），
// 否则走内存里的 mockHeaderless429Message；mock 没启用时返回 null。

export function getMockHeaders(): MockHeaders | null {
  if (
    !mockEnabled ||
    process.env.USER_TYPE !== 'ant' ||
    Object.keys(mockHeaders).length === 0
  ) {
    return null
  }
  return mockHeaders
}

export function getMockStatus(): string {
  if (
    !mockEnabled ||
    (Object.keys(mockHeaders).length === 0 && !mockSubscriptionType)
  ) {
    return 'No mock headers active (using real limits)'
  }

  const lines: string[] = []
  lines.push('Active mock headers:')

  // Show subscription type - either explicitly set or default
  const effectiveSubscription =
    mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
  if (mockSubscriptionType) {
    lines.push(`  Subscription Type: ${mockSubscriptionType} (explicitly set)`)
  } else {
    lines.push(`  Subscription Type: ${effectiveSubscription} (default)`)
  }

  Object.entries(mockHeaders).forEach(([key, value]) => {
    if (value !== undefined) {
      // Format the header name nicely
      const formattedKey = key
        .replace('anthropic-ratelimit-unified-', '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())

      // Format timestamps as human-readable
      if (key.includes('reset') && value) {
        const timestamp = Number(value)
        const date = new Date(timestamp * 1000)
        lines.push(`  ${formattedKey}: ${value} (${date.toLocaleString()})`)
      } else {
        lines.push(`  ${formattedKey}: ${value}`)
      }
    }
  })

  // Show exceeded limits if any
  if (exceededLimits.length > 0) {
    lines.push('\nExceeded limits (contributing to representative claim):')
    exceededLimits.forEach(limit => {
      const date = new Date(limit.resetsAt * 1000)
      lines.push(`  ${limit.type}: resets at ${date.toLocaleString()}`)
    })
  }

  return lines.join('\n')
}

export function clearMockHeaders(): void {
  mockHeaders = {}
  exceededLimits = []
  mockSubscriptionType = null
  mockFastModeRateLimitDurationMs = null
  mockFastModeRateLimitExpiresAt = null
  mockHeaderless429Message = null
  setMockBillingAccessOverride(null)
  mockEnabled = false
}
// clearMockHeaders 是「全量复位」：除了六七个模块级变量，还顺手调 setMockBillingAccessOverride(null)。
// 不连带清 billing override 的话，会出现「限流头清了但还冒充着 admin 身份」的半污染状态——
// 下一个场景从干净基线开始，是 mock 可复现的前提。

export function applyMockHeaders(
  headers: globalThis.Headers,
): globalThis.Headers {
  const mock = getMockHeaders()
  if (!mock) {
    return headers
  }

  // Create a new Headers object with original headers
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const newHeaders = new globalThis.Headers(headers)

  // Apply mock headers (overwriting originals)
  Object.entries(mock).forEach(([key, value]) => {
    if (value !== undefined) {
      newHeaders.set(key, value)
    }
  })

  return newHeaders
}
// applyMockHeaders 是整个文件对生产的唯一出口：发请求前把 mock 头盖到真实 Headers 上。
// 做法是 new Headers(headers) 拷一份再 set 覆盖，绝不原地改调用方传进来的对象（避免调用方复用同一份头时互相污染）。
// 那条 eslint-disable 是误报：eslint-plugin-n 的 node builtins 特性检测不认 globalThis.Headers。

// Check if we should process rate limits even without subscription
// This is for Ant employees testing with mocks
export function shouldProcessMockLimits(): boolean {
  if (process.env.USER_TYPE !== 'ant') {
    return false
  }
  return mockEnabled || Boolean(process.env.CLAUDE_MOCK_HEADERLESS_429)
}

export function getCurrentMockScenario(): MockScenario | null {
  if (!mockEnabled) {
    return null
  }

  // Reverse lookup the scenario from current headers
  if (!mockHeaders) return null

  const status = mockHeaders['anthropic-ratelimit-unified-status']
  const overage = mockHeaders['anthropic-ratelimit-unified-overage-status']
  const claim = mockHeaders['anthropic-ratelimit-unified-representative-claim']

  if (claim === 'seven_day_opus') {
    return status === 'rejected' ? 'opus-limit' : 'opus-warning'
  }

  if (claim === 'seven_day_sonnet') {
    return status === 'rejected' ? 'sonnet-limit' : 'sonnet-warning'
  }

  if (overage === 'rejected') return 'overage-exhausted'
  if (overage === 'allowed_warning') return 'overage-warning'
  if (overage === 'allowed') return 'overage-active'

  if (status === 'rejected') {
    if (claim === 'five_hour') return 'session-limit-reached'
    if (claim === 'seven_day') return 'weekly-limit-reached'
  }

  if (status === 'allowed_warning') {
    if (claim === 'seven_day') return 'approaching-weekly-limit'
  }

  if (status === 'allowed') return 'normal'

  return null
}
// getCurrentMockScenario 是反向工程：从当前 headers 反推「这看起来像哪个场景」，供 /status 之类的界面显示。
// 判定顺序有讲究：先看 representative claim 是不是 opus/sonnet（这两个最具体），
// 再按 overage 三态（rejected → warning → active）分流，最后才落到 status + claim 的组合。
// 顺序颠倒会把 overage-active 误判成 session-limit-reached——两者的 status 都是 rejected。

export function getScenarioDescription(scenario: MockScenario): string {
  switch (scenario) {
    case 'normal':
      return 'Normal usage, no limits'
    case 'session-limit-reached':
      return 'Session rate limit exceeded'
    case 'approaching-weekly-limit':
      return 'Approaching weekly aggregate limit'
    case 'weekly-limit-reached':
      return 'Weekly aggregate limit exceeded'
    case 'overage-active':
      return 'Using extra usage (overage active)'
    case 'overage-warning':
      return 'Approaching extra usage limit'
    case 'overage-exhausted':
      return 'Both subscription and extra usage limits exhausted'
    case 'out-of-credits':
      return 'Out of extra usage credits (wallet empty)'
    case 'org-zero-credit-limit':
      return 'Org spend cap is zero (no extra usage budget)'
    case 'org-spend-cap-hit':
      return 'Org spend cap hit for the month'
    case 'member-zero-credit-limit':
      return 'Member limit is zero (admin can allocate more)'
    case 'seat-tier-zero-credit-limit':
      return 'Seat tier limit is zero (admin can allocate more)'
    case 'opus-limit':
      return 'Opus limit reached'
    case 'opus-warning':
      return 'Approaching Opus limit'
    case 'sonnet-limit':
      return 'Sonnet limit reached'
    case 'sonnet-warning':
      return 'Approaching Sonnet limit'
    case 'fast-mode-limit':
      return 'Fast mode rate limit'
    case 'fast-mode-short-limit':
      return 'Fast mode rate limit (short)'
    case 'extra-usage-required':
      return 'Headerless 429: Extra usage required for 1M context'
    case 'clear':
      return 'Clear mock headers (use real limits)'
    default:
      return 'Unknown scenario'
  }
}

// Mock subscription type management
export function setMockSubscriptionType(
  subscriptionType: SubscriptionType | null,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }
  mockEnabled = true
  mockSubscriptionType = subscriptionType
}

export function getMockSubscriptionType(): SubscriptionType | null {
  if (!mockEnabled || process.env.USER_TYPE !== 'ant') {
    return null
  }
  // Return the explicitly set subscription type, or default to 'max'
  return mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
}
// 没显式设过订阅类型时回退 DEFAULT_MOCK_SUBSCRIPTION（'max'）而不是 null——
// 调用方拿到 null 会走「无订阅」分支，而 mock 场景下我们想演的是「有 max 订阅但被限流」。

// Export a function that checks if we should use mock subscription
export function shouldUseMockSubscription(): boolean {
  return (
    mockEnabled &&
    mockSubscriptionType !== null &&
    process.env.USER_TYPE === 'ant'
  )
}

// Mock billing access (admin vs non-admin)
export function setMockBillingAccess(hasAccess: boolean | null): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }
  mockEnabled = true
  setMockBillingAccessOverride(hasAccess)
}

// Mock fast mode rate limit handling
export function isMockFastModeRateLimitScenario(): boolean {
  return mockFastModeRateLimitDurationMs !== null
}

export function checkMockFastModeRateLimit(
  isFastModeActive?: boolean,
): MockHeaders | null {
  if (mockFastModeRateLimitDurationMs === null) {
    return null
  }

  // Only throw when fast mode is active
  if (!isFastModeActive) {
    return null
  }

  // Check if the rate limit has expired
  if (
    mockFastModeRateLimitExpiresAt !== null &&
    Date.now() >= mockFastModeRateLimitExpiresAt
  ) {
    clearMockHeaders()
    return null
  }

  // Set expiry on first error (not when scenario is configured)
  if (mockFastModeRateLimitExpiresAt === null) {
    mockFastModeRateLimitExpiresAt =
      Date.now() + mockFastModeRateLimitDurationMs
  }
// expiry 在「第一次真报错」时才设，不是配场景时设。
// 这样 duration 的计时从客户端第一次撞上限流开始算，而不是从测试人员敲下命令开始算——
// 否则中间隔几分钟才发请求，冷却早就白送了。过期时先 clearMockHeaders 再返回 null，顺带复位。

  // Compute dynamic retry-after based on remaining time
  const remainingMs = mockFastModeRateLimitExpiresAt - Date.now()
  const headersToSend = { ...mockHeaders }
  headersToSend['retry-after'] = String(
    Math.max(1, Math.ceil(remainingMs / 1000)),
  )

  return headersToSend
}
// retry-after 按剩余毫秒动态算，并用 Math.max(1, ...) 兜底至少 1 秒。
// 0 秒会被客户端理解成「立即重试」，既可能触发真实限流，也让冷却逻辑在测试里显得没生效。
