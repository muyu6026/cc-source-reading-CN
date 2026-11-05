/**
 * REPL-specific wrapper around initBridgeCore. Owns the parts that read
 * bootstrap state — gates, cwd, session ID, git context, OAuth, title
 * derivation — then delegates to the bootstrap-free core.
 *
 * Split out of replBridge.ts because the sessionStorage import
 * (getCurrentSessionTitle) transitively pulls in src/commands.ts → the
 * entire slash command + React component tree (~1300 modules). Keeping
 * initBridgeCore in a file that doesn't touch sessionStorage lets
 * daemonBridge.ts import the core without bloating the Agent SDK bundle.
 *
 * Called via dynamic import by useReplBridge (auto-start) and print.ts
 * (SDK -p mode via query.enableRemoteControl).
 */

// feature 来自 bun:bundle，是构建期常量：未启用的分支在打包时被整段消除，运行时不留判断
import { feature } from 'bun:bundle'
import { hostname } from 'os'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../services/analytics/growthbook.js'
import { getOrganizationUUID } from '../services/oauth/client.js'
import {
  isPolicyAllowed,
  waitForPolicyLimitsToLoad,
} from '../services/policyLimits/index.js'
import type { Message } from '../types/message.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { stripDisplayTagsAllowEmpty } from '../utils/displayTags.js'
import { errorMessage } from '../utils/errors.js'
import { getBranch, getRemoteUrl } from '../utils/git.js'
import { toSDKMessages } from '../utils/messages/mappers.js'
import {
  getContentText,
  getMessagesAfterCompactBoundary,
  isSyntheticMessage,
} from '../utils/messages.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
// 整个文件只有这一行碰 sessionStorage，但它会连带 commands.ts 与整棵斜杠命令组件树（约 1300 个模块），所以核心被拆到了另一个文件
import { getCurrentSessionTitle } from '../utils/sessionStorage.js'
import {
  extractConversationText,
  generateSessionTitle,
} from '../utils/sessionTitle.js'
import { generateShortWordSlug } from '../utils/words.js'
import {
  getBridgeAccessToken,
  getBridgeBaseUrl,
  getBridgeTokenOverride,
} from './bridgeConfig.js'
import {
  checkBridgeMinVersion,
  isBridgeEnabledBlocking,
  isCseShimEnabled,
  isEnvLessBridgeEnabled,
} from './bridgeEnabled.js'
import {
  archiveBridgeSession,
  createBridgeSession,
  updateBridgeSessionTitle,
} from './createSession.js'
import { logBridgeSkip } from './debugUtils.js'
import { checkEnvLessBridgeMinVersion } from './envLessBridgeConfig.js'
import { getPollIntervalConfig } from './pollConfig.js'
import type { BridgeState, ReplBridgeHandle } from './replBridge.js'
// 真正干活的是 replBridge 里的核心；本文件只负责 REPL 专属的接线：门禁、工作目录、会话 ID、git 上下文、OAuth 与标题推导
import { initBridgeCore } from './replBridge.js'
import { setCseShimGate } from './sessionIdCompat.js'
import type { BridgeWorkerType } from './types.js'

// 选项几乎是纯回调，加两份可选状态：调用方是 React hook 与 print 模式，两者没有可共享的对象
export type InitBridgeOptions = {
  onInboundMessage?: (msg: SDKMessage) => void | Promise<void>
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  initialMessages?: Message[]
// 显式命名优先级最高：斜杠命令一旦给了名字，就不再被对话内容覆盖
  // Explicit session name from `/remote-control <name>`. When set, overrides
  // the title derived from the conversation or /rename.
  initialName?: string
// 这个取值函数只在第三个用户消息时用到：要拿全文重生成标题。print 模式没有消息数组，缺省时退化为单条文本
  // Fresh view of the full conversation at call time. Used by onUserMessage's
  // count-3 derivation to call generateSessionTitle over the full conversation.
  // Optional — print.ts's SDK enableRemoteControl path has no REPL message
  // array; count-3 falls back to the single message text when absent.
  getMessages?: () => Message[]
// 跨会话已发送的 UUID 集合。服务端遇到重复 UUID 会直接杀掉 WebSocket，所以首次补发必须把它们剔掉
  // UUIDs already flushed in a prior bridge session. Messages with these
  // UUIDs are excluded from the initial flush to avoid poisoning the
  // server (duplicate UUIDs across sessions cause the WS to be killed).
  // Mutated in place — newly flushed UUIDs are added after each flush.
  previouslyFlushedUUIDs?: Set<string>
  /** See BridgeCoreParams.perpetual. */
  perpetual?: boolean
// 出站模式只把事件镜像到网页端，不接收入站指令：本地会话在网页上可见，但遥控不了
  /**
   * When true, the bridge only forwards events outbound (no SSE inbound
   * stream). Used by CCR mirror mode — local sessions visible on claude.ai
   * without enabling inbound control.
   */
  outboundOnly?: boolean
  tags?: string[]
}

// 入口是异步的，返回句柄或 null。null 表示门禁没通过，调用方不需要再判错误
export async function initReplBridge(
  options?: InitBridgeOptions,
): Promise<ReplBridgeHandle | null> {
  const {
    onInboundMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    initialMessages,
    getMessages,
    previouslyFlushedUUIDs,
    initialName,
    perpetual,
    outboundOnly,
    tags,
  } = options ?? {}

// 把兼容层开关接到开关平台：daemon 与 SDK 路径跳过这步，那里默认视为开启
  // Wire the cse_ shim kill switch so toCompatSessionId respects the
  // GrowthBook gate. Daemon/SDK paths skip this — shim defaults to active.
  setCseShimGate(isCseShimEnabled)

  // 1. Runtime gate
// 第一道门禁是运行时开关。未启用就记一条跳过原因直接返回，不产生任何网络请求
  if (!(await isBridgeEnabledBlocking())) {
    logBridgeSkip('not_enabled', '[bridge:repl] Skipping: bridge not enabled')
    return null
  }

  // 1b. Minimum version check — deferred to after the v1/v2 branch below,
  // since each implementation has its own floor (tengu_bridge_min_version
  // for v1, tengu_bridge_repl_v2_config.min_version for v2).

  // 2. Check OAuth — must be signed in with claude.ai. Runs before the
  // policy check so console-auth users get the actionable "/login" hint
  // instead of a misleading policy error from a stale/wrong-org cache.
// OAuth 检查排在策略检查之前：否则用控制台登录的人会先撞上缓存里的旧组织策略，看到一句误导性的策略报错
  if (!getBridgeAccessToken()) {
    logBridgeSkip('no_oauth', '[bridge:repl] Skipping: no OAuth tokens')
    onStateChange?.('failed', '/login')
    return null
  }

  // 3. Check organization policy — remote control may be disabled
// 策略是异步加载的，先等它落地再判断，否则可能读到空集合
  await waitForPolicyLimitsToLoad()
  if (!isPolicyAllowed('allow_remote_control')) {
    logBridgeSkip(
      'policy_denied',
      '[bridge:repl] Skipping: allow_remote_control policy not allowed',
    )
    onStateChange?.('failed', "disabled by your organization's policy")
    return null
  }

  // When CLAUDE_BRIDGE_OAUTH_TOKEN is set (ant-only local dev), the bridge
  // uses that token directly via getBridgeAccessToken() — keychain state is
  // irrelevant. Skip 2b/2c to preserve that decoupling: an expired keychain
  // token shouldn't block a bridge connection that doesn't use it.
// 有令牌覆盖时整段跳过：钥匙串里的过期令牌与本次连接无关，不该拖住它
  if (!getBridgeTokenOverride()) {
    // 2a. Cross-process backoff. If N prior processes already saw this exact
    // dead token (matched by expiresAt), skip silently — no event, no refresh
    // attempt. The count threshold tolerates transient refresh failures (auth
    // server 5xx, lockfile errors per auth.ts:1437/1444/1485): each process
    // independently retries until 3 consecutive failures prove the token dead.
    // Mirrors useReplBridge's MAX_CONSECUTIVE_INIT_FAILURES for in-process.
    // The expiresAt key is content-addressed: /login → new token → new expiresAt
    // → this stops matching without any explicit clear.
// 跨进程退避：要连续三个进程都判定同一个令牌已死才跳过，从而容忍偶发的刷新失败
    const cfg = getGlobalConfig()
    if (
      cfg.bridgeOauthDeadExpiresAt != null &&
      (cfg.bridgeOauthDeadFailCount ?? 0) >= 3 &&
// 按过期时间做内容寻址：重新登录换出新令牌后键自然不再匹配，不需要谁去显式清理
      getClaudeAIOAuthTokens()?.expiresAt === cfg.bridgeOauthDeadExpiresAt
    ) {
      logForDebugging(
        `[bridge:repl] Skipping: cross-process backoff (dead token seen ${cfg.bridgeOauthDeadFailCount} times)`,
      )
      return null
    }

    // 2b. Proactively refresh if expired. Mirrors bridgeMain.ts:2096 — the REPL
    // bridge fires at useEffect mount BEFORE any v1/messages call, making this
    // usually the first OAuth request of the session. Without this, ~9% of
    // registrations hit the server with a >8h-expired token → 401 → withOAuthRetry
    // recovers, but the server logs a 401 we can avoid. VPN egress IPs observed
    // at 30:1 401:200 when many unrelated users cluster at the 8h TTL boundary.
    //
    // Fresh-token cost: one memoized read + one Date.now() comparison (~µs).
    // checkAndRefreshOAuthTokenIfNeeded clears its own cache in every path that
    // touches the keychain (refresh success, lockfile race, throw), so no
    // explicit clearOAuthTokenCache() here — that would force a blocking
    // keychain spawn on the 91%+ fresh-token path.
// 主动刷新。这段代码在挂载时就跑，通常比首个模型请求还早；不刷新会让约一成的注册带着过期令牌打到服务端
    await checkAndRefreshOAuthTokenIfNeeded()

    // 2c. Skip if token is still expired post-refresh-attempt. Env-var / FD
    // tokens (auth.ts:894-917) have expiresAt=null → never trip this. But a
    // keychain token whose refresh token is dead (password change, org left,
    // token GC'd) has expiresAt<now AND refresh just failed — the client would
    // otherwise loop 401 forever: withOAuthRetry → handleOAuth401Error →
    // refresh fails again → retry with same stale token → 401 again.
    // Datadog 2026-03-08: single IPs generating 2,879 such 401s/day. Skip the
    // guaranteed-fail API call; useReplBridge surfaces the failure.
    //
    // Intentionally NOT using isOAuthTokenExpired here — that has a 5-minute
    // proactive-refresh buffer, which is the right heuristic for "should
    // refresh soon" but wrong for "provably unusable". A token with 3min left
    // + transient refresh endpoint blip (5xx/timeout/wifi-reconnect) would
    // falsely trip a buffered check; the still-valid token would connect fine.
    // Check actual expiry instead: past-expiry AND refresh-failed → truly dead.
// 刷新完仍过期才算真死：此刻再请求必然 401，客户端会陷入刷新失败再重试同一令牌的死循环。这里刻意不用带五分钟提前量的判断，那只适合决定该不该刷新，不适合判定是否已报废
    const tokens = getClaudeAIOAuthTokens()
    if (tokens && tokens.expiresAt !== null && tokens.expiresAt <= Date.now()) {
      logBridgeSkip(
        'oauth_expired_unrefreshable',
        '[bridge:repl] Skipping: OAuth token expired and refresh failed (re-login required)',
      )
      onStateChange?.('failed', '/login')
      // Persist for the next process. Increments failCount when re-discovering
      // the same dead token (matched by expiresAt); resets to 1 for a different
      // token. Once count reaches 3, step 2a's early-return fires and this path
      // is never reached again — writes are capped at 3 per dead token.
      // Local const captures the narrowed type (closure loses !==null narrowing).
      const deadExpiresAt = tokens.expiresAt
// 把死令牌写进全局配置交给下一个进程。同一个令牌最多累加三次，之后由上面的退避直接拦下
      saveGlobalConfig(c => ({
        ...c,
        bridgeOauthDeadExpiresAt: deadExpiresAt,
        bridgeOauthDeadFailCount:
          c.bridgeOauthDeadExpiresAt === deadExpiresAt
            ? (c.bridgeOauthDeadFailCount ?? 0) + 1
            : 1,
      }))
      return null
    }
  }

  // 4. Compute baseUrl — needed by both v1 (env-based) and v2 (env-less)
  // paths. Hoisted above the v2 gate so both can use it.
// 基址提到分支之前算：环境模式要用它做注册，无环境模式要用它做直连
  const baseUrl = getBridgeBaseUrl()

  // 5. Derive session title. Precedence: explicit initialName → /rename
  // (session storage) → last meaningful user message → generated slug.
  // Cosmetic only (claude.ai session list); the model never sees it.
  // Two flags: `hasExplicitTitle` (initialName or /rename — never auto-
  // overwrite) vs. `hasTitle` (any title, including auto-derived — blocks
  // the count-1 re-derivation but not count-3). The onUserMessage callback
  // (wired to both v1 and v2 below) derives from the 1st prompt and again
  // from the 3rd so mobile/web show a title that reflects more context.
  // The slug fallback (e.g. "remote-control-graceful-unicorn") makes
  // auto-started sessions distinguishable in the claude.ai list before the
  // first prompt.
// 兜底标题是随机词组，让自动启动的会话在网页列表里先有个能区分的名字，等首条消息再替换
  let title = `remote-control-${generateShortWordSlug()}`
  let hasTitle = false
  let hasExplicitTitle = false
// 三级优先：显式命名、会话存储里的重命名、最后一条有意义的用户消息
  if (initialName) {
    title = initialName
    hasTitle = true
    hasExplicitTitle = true
  } else {
    const sessionId = getSessionId()
    const customTitle = sessionId
      ? getCurrentSessionTitle(sessionId)
      : undefined
    if (customTitle) {
      title = customTitle
      hasTitle = true
      hasExplicitTitle = true
    } else if (initialMessages && initialMessages.length > 0) {
      // Find the last user message that has meaningful content. Skip meta
      // (nudges), tool results, compact summaries ("This session is being
      // continued…"), non-human origins (task notifications, channel pushes),
      // and synthetic interrupts ([Request interrupted by user]) — none are
      // human-authored. Same filter as extractTitleText + isSyntheticMessage.
// 从后往前找。跳过元消息、工具结果、压缩摘要、非人类来源与合成中断，它们都不是用户亲手写的
      for (let i = initialMessages.length - 1; i >= 0; i--) {
        const msg = initialMessages[i]!
        if (
          msg.type !== 'user' ||
          msg.isMeta ||
          msg.toolUseResult ||
          msg.isCompactSummary ||
          (msg.origin && msg.origin.kind !== 'human') ||
          isSyntheticMessage(msg)
        )
          continue
// 取纯文本内容。只剩标签的消息（比如本地命令输出）在这里被滤掉
        const rawContent = getContentText(msg.message.content)
        if (!rawContent) continue
        const derived = deriveTitle(rawContent)
        if (!derived) continue
        title = derived
        hasTitle = true
        break
      }
    }
  }

  // Shared by both v1 and v2 — fires on every title-worthy user message until
  // it returns true. At count 1: deriveTitle placeholder immediately, then
  // generateSessionTitle (Haiku, sentence-case) fire-and-forget upgrade. At
  // count 3: re-generate over the full conversation. Skips entirely if the
  // title is explicit (/remote-control <name> or /rename) — re-checks
  // sessionStorage at call time so /rename between messages isn't clobbered.
  // Skips count 1 if initialMessages already derived (that title is fresh);
  // still refreshes at count 3. v2 passes cse_*; updateBridgeSessionTitle
  // retags internally.
// 三个闭包变量支撑标题状态机：用户消息计数、当前桥接会话 ID、生成序号
  let userMessageCount = 0
  let lastBridgeSessionId: string | undefined
  let genSeq = 0
// 同时更新本地变量与服务端标题，失败静默：标题是装饰性的，不该影响主流程
  const patch = (
    derived: string,
    bridgeSessionId: string,
    atCount: number,
  ): void => {
    hasTitle = true
    title = derived
    logForDebugging(
      `[bridge:repl] derived title from message ${atCount}: ${derived}`,
    )
    void updateBridgeSessionTitle(bridgeSessionId, derived, {
      baseUrl,
      getAccessToken: getBridgeAccessToken,
    }).catch(() => {})
  }
  // Fire-and-forget Haiku generation with post-await guards. Re-checks /rename
  // (sessionStorage), v1 env-lost (lastBridgeSessionId), and same-session
  // out-of-order resolution (genSeq — count-1's Haiku resolving after count-3
  // would clobber the richer title). generateSessionTitle never rejects.
// 生成走后台不阻塞，十五秒超时；回来时用三个条件复核：序号未变、会话没换、用户没在这期间手动改名
  const generateAndPatch = (input: string, bridgeSessionId: string): void => {
    const gen = ++genSeq
    const atCount = userMessageCount
    void generateSessionTitle(input, AbortSignal.timeout(15_000)).then(
      generated => {
        if (
          generated &&
// 序号防的是乱序：第一条消息的生成如果晚于第三条返回，会把更丰富的标题覆盖掉
          gen === genSeq &&
          lastBridgeSessionId === bridgeSessionId &&
          !getCurrentSessionTitle(getSessionId())
        ) {
          patch(generated, bridgeSessionId, atCount)
        }
      },
    )
  }
// 每来一条用户消息都问一次要不要更新标题，返回真表示可以停止再问
  const onUserMessage = (text: string, bridgeSessionId: string): boolean => {
// 有显式标题或存储里有名字就直接收工。要每次重查而不是缓存，因为重命名随时可能发生
    if (hasExplicitTitle || getCurrentSessionTitle(getSessionId())) {
      return true
    }
    // v1 env-lost re-creates the session with a new ID. Reset the count so
    // the new session gets its own count-3 derivation; hasTitle stays true
    // (new session was created via getCurrentTitle(), which reads the count-1
    // title from this closure), so count-1 of the fresh cycle correctly skips.
// 环境丢失会重建会话并换新 ID，计数归零让新会话重新走一遍三条消息的推导
    if (
      lastBridgeSessionId !== undefined &&
      lastBridgeSessionId !== bridgeSessionId
    ) {
      userMessageCount = 0
    }
    lastBridgeSessionId = bridgeSessionId
    userMessageCount++
// 第一条消息先用本地截取做占位，再让模型生成更好的；已有标题时跳过占位只做生成
    if (userMessageCount === 1 && !hasTitle) {
      const placeholder = deriveTitle(text)
      if (placeholder) patch(placeholder, bridgeSessionId, userMessageCount)
      generateAndPatch(text, bridgeSessionId)
// 第三条消息改看全文：前两条已经提供了语境，此时生成的标题更贴主题
    } else if (userMessageCount === 3) {
      const msgs = getMessages?.()
      const input = msgs
        ? extractConversationText(getMessagesAfterCompactBoundary(msgs))
        : text
      generateAndPatch(input, bridgeSessionId)
    }
    // Also re-latches if v1 env-lost resets the transport's done flag past 3.
// 到三就返回真，调用方据此停掉后续推导，避免每条消息都烧一次模型调用
    return userMessageCount >= 3
  }

// 首次补发的条数上限走开关配置，缓存五分钟：调参不必等下一次发版
  const initialHistoryCap = getFeatureValue_CACHED_WITH_REFRESH(
    'tengu_bridge_initial_history_cap',
    200,
    5 * 60 * 1000,
  )

  // Fetch orgUUID before the v1/v2 branch — both paths need it. v1 for
  // environment registration; v2 for archive (which lives at the compat
  // /v1/sessions/{id}/archive, not /v1/code/sessions). Without it, v2
  // archive 404s and sessions stay alive in CCR after /exit.
// 组织标识两条分支都要：环境模式用于注册，无环境模式用于归档，缺了会让会话退出后仍留在服务端
  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    logBridgeSkip('no_org_uuid', '[bridge:repl] Skipping: no org UUID')
    onStateChange?.('failed', '/login')
    return null
  }

// 无环境路径把注册、轮询、确认、心跳四层全部去掉，一次请求直接换 worker 令牌。它与传输层第二版是两件事，环境路径同样能用那套传输，这个开关只决定要不要轮询
  // ── GrowthBook gate: env-less bridge ──────────────────────────────────
  // When enabled, skips the Environments API layer entirely (no register/
  // poll/ack/heartbeat) and connects directly via POST /bridge → worker_jwt.
  // See server PR #292605 (renamed in #293280). REPL-only — daemon/print stay
  // on env-based.
  //
  // NAMING: "env-less" is distinct from "CCR v2" (the /worker/* transport).
  // The env-based path below can ALSO use CCR v2 via CLAUDE_CODE_USE_CCR_V2.
  // tengu_bridge_repl_v2 gates env-less (no poll loop), not transport version.
  //
  // perpetual (assistant-mode session continuity via bridge-pointer.json) is
  // env-coupled and not yet implemented here — fall back to env-based when set
  // so KAIROS users don't silently lose cross-restart continuity.
// 这种常驻语义依赖环境指针文件，尚未在无环境路径实现，所以置位时回落到环境模式，避免静默丢掉跨重启的连续性
  if (isEnvLessBridgeEnabled() && !perpetual) {
// 两条路径的最低版本门槛不同，版本检查因此放在分支之内而不是函数入口
    const versionError = await checkEnvLessBridgeMinVersion()
    if (versionError) {
      logBridgeSkip(
        'version_too_old',
        `[bridge:repl] Skipping: ${versionError}`,
        true,
      )
      onStateChange?.('failed', 'run `claude update` to upgrade')
      return null
    }
    logForDebugging(
      '[bridge:repl] Using env-less bridge path (tengu_bridge_repl_v2)',
    )
// 动态导入核心模块：这层间接让不需要桥接的构建产物不必把它打进包
    const { initEnvLessBridgeCore } = await import('./remoteBridgeCore.js')
    return initEnvLessBridgeCore({
      baseUrl,
      orgUUID,
      title,
      getAccessToken: getBridgeAccessToken,
      onAuth401: handleOAuth401Error,
      toSDKMessages,
      initialHistoryCap,
      initialMessages,
// 无环境模式不传已发送集合：它总是新建服务端会话，没有跨会话 UUID 冲突；传了反而会让重连后的新会话拿不到任何历史
      // v2 always creates a fresh server session (new cse_* id), so
      // previouslyFlushedUUIDs is not passed — there's no cross-session
      // UUID collision risk, and the ref persists across enable→disable→
      // re-enable cycles which would cause the new session to receive zero
      // history (all UUIDs already in the set from the prior enable).
      // v1 handles this by calling previouslyFlushedUUIDs.clear() on fresh
      // session creation (replBridge.ts:768); v2 skips the param entirely.
      onInboundMessage,
      onUserMessage,
      onPermissionResponse,
      onInterrupt,
      onSetModel,
      onSetMaxThinkingTokens,
      onSetPermissionMode,
      onStateChange,
      outboundOnly,
      tags,
    })
  }

  // ── v1 path: env-based (register/poll/ack/heartbeat) ──────────────────

// 环境模式的版本门槛，与上面那条各自独立
  const versionError = checkBridgeMinVersion()
  if (versionError) {
    logBridgeSkip('version_too_old', `[bridge:repl] Skipping: ${versionError}`)
    onStateChange?.('failed', 'run `claude update` to upgrade')
    return null
  }

  // Gather git context — this is the bootstrap-read boundary.
  // Everything from here down is passed explicitly to bridgeCore.
// 从这行往下就是引导状态的读取边界：之后的依赖全部显式传进核心，核心自身不碰全局
  const branch = await getBranch()
  const gitRepoUrl = await getRemoteUrl()
// 会话入口地址只在内部账号上用环境变量覆盖，外部构建没有这条分支
  const sessionIngressUrl =
    process.env.USER_TYPE === 'ant' &&
    process.env.CLAUDE_BRIDGE_SESSION_INGRESS_URL
      ? process.env.CLAUDE_BRIDGE_SESSION_INGRESS_URL
      : baseUrl

  // Assistant-mode sessions advertise a distinct worker_type so the web UI
  // can filter them into a dedicated picker. KAIROS guard keeps the
  // assistant module out of external builds entirely.
// 助手模式上报不同的工作进程类型供网页端筛选；用构建期常量包住条件加载，外部构建里整段消失
  let workerType: BridgeWorkerType = 'claude_code'
  if (feature('KAIROS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isAssistantMode } =
      require('../assistant/index.js') as typeof import('../assistant/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isAssistantMode()) {
      workerType = 'claude_code_assistant'
    }
  }

  // 6. Delegate. BridgeCoreHandle is a structural superset of
  // ReplBridgeHandle (adds writeSdkMessages which REPL callers don't use),
  // so no adapter needed — just the narrower type on the way out.
// 交给核心。核心句柄在结构上是返回值的超集，多出的是写入接口，REPL 用不到，所以在出口处收窄类型
  return initBridgeCore({
    dir: getOriginalCwd(),
    machineName: hostname(),
    branch,
    gitRepoUrl,
    title,
    baseUrl,
    sessionIngressUrl,
    workerType,
    getAccessToken: getBridgeAccessToken,
// 创建与归档都注入基址和取令牌函数：核心不自己读配置，便于测试与多实例并存
    createSession: opts =>
      createBridgeSession({
        ...opts,
        events: [],
        baseUrl,
        getAccessToken: getBridgeAccessToken,
      }),
// 归档超时压到一点五秒。关闭流程要在两秒内跑完，还要并行走停服务、串行注销，归档拿不到完整预算；它内部不接异常，所以失败必须在这里挂住并记账
    archiveSession: sessionId =>
      archiveBridgeSession(sessionId, {
        baseUrl,
        getAccessToken: getBridgeAccessToken,
        // gracefulShutdown.ts:407 races runCleanupFunctions against 2s.
        // Teardown also does stopWork (parallel) + deregister (sequential),
        // so archive can't have the full budget. 1.5s matches v2's
        // teardown_archive_timeout_ms default.
        timeoutMs: 1500,
      }).catch((err: unknown) => {
        // archiveBridgeSession has no try/catch — 5xx/timeout/network throw
        // straight through. Previously swallowed silently, making archive
        // failures BQ-invisible and undiagnosable from debug logs.
        logForDebugging(
          `[bridge:repl] archiveBridgeSession threw: ${errorMessage(err)}`,
          { level: 'error' },
        )
      }),
    // getCurrentTitle is read on reconnect-after-env-lost to re-title the new
    // session. /rename writes to session storage; onUserMessage mutates
    // `title` directly — both paths are picked up here.
// 重连重建会话时读当前标题：重命名写存储、消息回调改局部变量，两条来源在这里汇合
    getCurrentTitle: () => getCurrentSessionTitle(getSessionId()) ?? title,
    onUserMessage,
    toSDKMessages,
    onAuth401: handleOAuth401Error,
    getPollIntervalConfig,
    initialHistoryCap,
    initialMessages,
    previouslyFlushedUUIDs,
    onInboundMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    perpetual,
  })
}

// 标题上限五十字符：网页列表单行显示，再长就被截得没有信息量
const TITLE_MAX_LEN = 50

/**
 * Quick placeholder title: strip display tags, take the first sentence,
 * collapse whitespace, truncate to 50 chars. Returns undefined if the result
 * is empty (e.g. message was only <local-command-stdout>). Replaced by
 * generateSessionTitle once Haiku resolves (~1-15s).
 */
// 占位标题只做三件事：剥显示标签、取第一句、压平空白
function deriveTitle(raw: string): string | undefined {
  // Strip <ide_opened_file>, <session-start-hook>, etc. — these appear in
  // user messages when IDE/hooks inject context. stripDisplayTagsAllowEmpty
  // returns '' (not the original) so pure-tag messages are skipped.
// 剥标签后返回空串而不是原串，纯标签消息在这里就被判为没有可用内容
  const clean = stripDisplayTagsAllowEmpty(raw)
  // First sentence is usually the intent; rest is often context/detail.
  // Capture group instead of lookbehind — keeps YARR JIT happy.
// 用捕获组而不是后行断言：部分正则引擎对后行断言的编译开销更大，注释里点名是为了照顾它
  const firstSentence = /^(.*?[.!?])\s/.exec(clean)?.[1] ?? clean
  // Collapse newlines/tabs — titles are single-line in the claude.ai list.
  const flat = firstSentence.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
// 超长时留出省略号的位置，末尾补一个省略号字符
  return flat.length > TITLE_MAX_LEN
    ? flat.slice(0, TITLE_MAX_LEN - 1) + '\u2026'
    : flat
}
