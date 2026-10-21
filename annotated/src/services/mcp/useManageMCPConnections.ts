// ═══════════════════════════════════════════════════════════════
//  client.ts（纯逻辑）与 React（UI）之间的唯一接缝
// ═══════════════════════════════════════════════════════════════
//
//   client.ts 不知道 React 存在：它只负责连、断、取工具，通过回调往外抛事件。
//   components/ 不知道 MCP 存在：它只读 AppState、渲染。
//
//   所有「异步事件 → 状态 → 渲染」的翻译都集中在这一个文件里。
//   所以它虽然叫 hook，实际承担的是**适配层**的职责。
//
// 【三件事】
//   ① 两个 useEffect：先把配置里的服务器标成 pending（UI 立刻有东西可显示），
//      再真正去连接（网络慢的部分不阻塞首帧）
//   ② onConnectionAttempt：连接结果 → AppState，并挂上各种通知处理器
//   ③ 返回值 reconnectMcpServer / toggleMcpServer：给 UI 的两个动作
//
// 【读这个文件前必须知道的一件事】
//
//   这里 useCallback / useRef 的密度不是为了性能，是为了**让 effect 的依赖数组稳定**。
//   onConnectionAttempt 依赖 updateServer → 依赖 flushPendingUpdates → 依赖 setAppState，
//   整条链任何一环不稳定，第二个 effect 就会每次渲染都重跑 ——
//   表现是「每次打字都重连一遍所有 MCP 服务器」。
//   看到 useCallback 时不要问「这里需要优化吗」，要问「谁把它放进了 deps」。
import { feature } from 'bun:bundle'
import { basename } from 'path'
import { useCallback, useEffect, useRef } from 'react'
import { getSessionId } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import type { Tool } from '../../Tool.js'
import {
  clearServerCache,
  fetchCommandsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  getMcpToolsCommandsAndResources,
  reconnectMcpServerImpl,
} from './client.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'

// 【为什么这里用 require 而不是 import】
//
//   feature() 是编译期常量，打包器会把 false 分支整段删掉（DCE）。
//   但**静态 import 消除不掉** —— 模块图是静态的，import 一旦写出来，
//   那个模块就会进 bundle，和它被包在什么条件里无关。
//
//   条件 require 才能被一起消除：MCP_SKILLS 关掉时，mcpSkills.ts 整个模块
//   不会出现在产物里。代价是类型要靠 24 行的 `as typeof import(...)` 手工补，
//   于是满文件都是 `fetchMcpSkillsForClient!` 这样的非空断言。
//
//   这是「包体积 vs 类型安全」的一次明确取舍，不是偷懒。
/* eslint-disable @typescript-eslint/no-require-imports */
const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? (
      require('../../skills/mcpSkills.js') as typeof import('../../skills/mcpSkills.js')
    ).fetchMcpSkillsForClient
  : null
const clearSkillIndexCache = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (
      require('../skillSearch/localSearch.js') as typeof import('../skillSearch/localSearch.js')
    ).clearSkillIndexCache
  : null

import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import omit from 'lodash-es/omit.js'
import reject from 'lodash-es/reject.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  dedupClaudeAiMcpServers,
  doesEnterpriseMcpConfigExist,
  filterMcpServersByPolicy,
  getClaudeCodeMcpConfigs,
  isMcpServerDisabled,
  setMcpServerEnabled,
} from 'src/services/mcp/config.js'
import type { AppState } from 'src/state/AppState.js'
import type { PluginError } from 'src/types/plugin.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getAllowedChannels } from '../../bootstrap/state.js'
import { useNotifications } from '../../context/notifications.js'
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from '../../state/AppState.js'
import { errorMessage } from '../../utils/errors.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { enqueue } from '../../utils/messageQueueManager.js'
import {
  CHANNEL_PERMISSION_METHOD,
  ChannelMessageNotificationSchema,
  ChannelPermissionNotificationSchema,
  findChannelEntry,
  gateChannelServer,
  wrapChannelMessage,
} from './channelNotification.js'
import {
  type ChannelPermissionCallbacks,
  createChannelPermissionCallbacks,
  isChannelPermissionRelayEnabled,
} from './channelPermissions.js'
import {
  clearClaudeAIMcpConfigsCache,
  fetchClaudeAIMcpConfigsIfEligible,
} from './claudeai.js'
import { registerElicitationHandler } from './elicitationHandler.js'
import { getMcpPrefix } from './mcpStringUtils.js'
import { commandBelongsToServer, excludeStalePluginClients } from './utils.js'

// 【5 次重试，1 秒起步，30 秒封顶】
//
//   间隔序列：1s + 2s + 4s + 8s + 16s ≈ 31 秒。
//   这个量级对应的是「服务器重启/网络瞬断」，不是「服务挂了等人来修」。
//
//   封顶 30 秒的意义：很多 MCP 服务器是本地起的（stdio 之外的 http 代理），
//   重启只要几秒。间隔涨到几分钟后再重试，等于放弃。
//
//   为什么是 5 次而不是无限：无限重连会让一个配置错误的服务器
//   在后台永久打日志、永久占资源，而用户完全看不见（日志要 --debug）。
// Constants for reconnection with exponential backoff
const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

// 【去重键选的是「用户看到的错误的身份」】
//
//   type + source + plugin 三要素：同一类错误、同一个来源、同一个插件，就算同一条。
//   不带 message —— 因为 message 里常含时间戳、路径、端口号，
//   带上它去重就永远去不掉，同一个问题会堆出几十条。
//
//   反过来说，如果要让两条错误「分别显示」，就得让它们在这三个维度上不同。
//   去重键的设计决定了信息架构，不只是实现细节。
/**
 * Create a unique key for a plugin error to enable deduplication
 */
function getErrorKey(error: PluginError): string {
  const plugin = 'plugin' in error ? error.plugin : 'no-plugin'
  return `${error.type}:${error.source}:${plugin}`
}

/**
 * Add errors to AppState, deduplicating to avoid showing the same error multiple times
 */
function addErrorsToAppState(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  newErrors: PluginError[],
): void {
  if (newErrors.length === 0) return

  setAppState(prevState => {
    // Build set of existing error keys
    const existingKeys = new Set(
      prevState.plugins.errors.map(e => getErrorKey(e)),
    )

    // Only add errors that don't already exist
    const uniqueNewErrors = newErrors.filter(
      error => !existingKeys.has(getErrorKey(error)),
    )

    if (uniqueNewErrors.length === 0) {
      return prevState
    }

    return {
      ...prevState,
      plugins: {
        ...prevState.plugins,
        errors: [...prevState.plugins.errors, ...uniqueNewErrors],
      },
    }
  })
}

// 这段注释列的四件事是准确的，但漏了第五件：**它不做协议**。
//
//   连不上怎么办、401 之后怎么刷新、工具列表怎么取 —— 全在 client.ts。
//   这里只处理「事件来了之后，状态该怎么变」。
//   看到这个文件里出现 fetch / OAuth / 重试逻辑，就说明分层被破坏了。
/**
 * Hook to manage MCP (Model Context Protocol) server connections and updates
 *
 * This hook:
 * 1. Initializes MCP client connections based on config
 * 2. Sets up handlers for connection lifecycle events and sync with app state
 * 3. Manages automatic reconnection for SSE connections
 * 4. Returns a reconnect function
 */
export function useManageMCPConnections(
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined,
  isStrictMcpConfig = false,
) {
// 【store 与 state 的区别决定 callback 能不能稳定】
//
//   useAppState(selector)  → 订阅某个字段，字段变了组件重渲染
//   useAppStateStore()     → 拿到 store 本体，getState() 随时读当前值，**不订阅**
//
//   下面 1046 行的 reconnectMcpServer 用 store.getState() 读 clients，
//   所以它的 deps 里不需要 mcp.clients —— callback 引用永久稳定。
//   如果改成 useAppState(s => s.mcp.clients)，那个 callback 每次连接状态变化
//   都会换一个新引用，返回给组件后下游的 memo/effect 全部失效。
//
//   规律：**要对外的 callback 里读状态，用 getState；要触发渲染的读，用 selector。**
  const store = useAppStateStore()
  const _authVersion = useAppState(s => s.authVersion)
// 【下划线前缀不是「私有」，是「不参与计算」】
//
//   _authVersion 和 _pluginReconnectKey 在函数体里从来没被读过，
//   它们存在的唯一目的是**进依赖数组**，让 effect 在某些事件后重跑。
//
//   React 没有「监听某个值变化」的原生写法，只能靠 deps 比较。
//   于是要写一个「读了但不用」的变量，`_` 前缀是告诉 TS 的
//   noUnusedLocals「我知道它没被用，别报错」。
//
//   语义上它们是被当作**版本号**用的：
//     authVersion 变 → 登录/登出，token 变了 → 必须重连
//     pluginReconnectKey 变 → /reload-plugins，配置变了 → 必须重连
//
//   用自增版本号表达「某些不可枚举的东西变了」，比在 effect 里深比较配置便宜得多，
//   也比事件订阅简单。代价是「为什么重连」这个信息只存在于注释里。
  // Incremented by /reload-plugins (refreshActivePlugins) to pick up newly
  // enabled plugin MCP servers. getClaudeCodeMcpConfigs() reads loadAllPlugins()
  // which has been cleared by refreshActivePlugins, so the effects below see
  // fresh plugin data on re-run.
  const _pluginReconnectKey = useAppState(s => s.mcp.pluginReconnectKey)
  const setAppState = useSetAppState()

// 【可取消的退避等待，代价是一个故意泄漏的 promise】
//
//   371 行那个 for 循环里用
//     await new Promise(resolve => { const timer = setTimeout(resolve, ms); map.set(name, timer) })
//   把 handle 存进这个 Map，于是「等待」也能被取消 —— 方式是 clearTimeout，
//   那个 promise 就永远不会 resolve，async 函数永远挂在那里。
//
//   这是**故意的**：挂起的闭包只值几 KB，换来的是「点禁用之后立刻停止重连」。
//   如果改用 await sleep(ms)，就没有 handle 可清，用户点了禁用还要等 30 秒才停。
//
//   这也是 456 行那条 eslint-disable 的真实理由（注释写的是「sleep 不暴露 handle」）。
//
//   代价要说清楚：这些挂起的闭包会在 unmount 之前一直存在。
//   1027 行的卸载清理只 clearTimeout 不 resolve，同样是有意为之。
  // Track active reconnection attempts to allow cancellation
  const reconnectTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Dedup the --channels blocked warning per skip kind so that a user who
  // sees "run /login" (auth skip), logs in, then hits the policy gate
  // gets a second toast.
// 【去重的键要选「用户看到的那条提示」，不是「事件」】
//
//   场景：用户看到「Channels require /login」→ 去登录 → 回来又撞上企业策略门。
//   这时应该出现**第二条不同的提示**。如果按服务器名去重，第二条就被吞了。
//
//   所以键是 kind（disabled / auth / policy / marketplace / allowlist），
//   一个 kind 只提醒一次。
  const channelWarnedKindsRef = useRef<
    Set<'disabled' | 'auth' | 'policy' | 'marketplace' | 'allowlist'>
  >(new Set())
  // Channel permission callbacks — constructed once, stable ref. Stored in
  // AppState so interactiveHandler can subscribe. The pending Map lives inside
  // the closure (not module-level, not AppState — functions-in-state is brittle).
  const channelPermCallbacksRef = useRef<ChannelPermissionCallbacks | null>(
    null,
  )
  if (
    (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
    channelPermCallbacksRef.current === null
  ) {
    channelPermCallbacksRef.current = createChannelPermissionCallbacks()
  }
  // Store callbacks in AppState so interactiveHandler.ts can reach them via
  // ctx.toolUseContext.getAppState(). One-time set — the ref is stable.
  useEffect(() => {
    if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
      const callbacks = channelPermCallbacksRef.current
      if (!callbacks) return
      // GrowthBook runtime gate — separate from channels so channels can
      // ship without this. Checked at mount; mid-session flips need restart.
      // If off, callbacks never go into AppState → interactiveHandler sees
      // undefined → never sends → intercept has nothing pending → "yes tbxkq"
      // flows to Claude as normal chat. One gate, full disable.
      if (!isChannelPermissionRelayEnabled()) return
      setAppState(prev => {
        if (prev.channelPermissionCallbacks === callbacks) return prev
        return { ...prev, channelPermissionCallbacks: callbacks }
      })
      return () => {
        setAppState(prev => {
          if (prev.channelPermissionCallbacks === undefined) return prev
          return { ...prev, channelPermissionCallbacks: undefined }
        })
      }
    }
  }, [setAppState])
  const { addNotification } = useNotifications()

// 【为什么是 16ms，而不是 queueMicrotask】
//
//   一次会话启动可能有 10 个服务器几乎同时连上，每个都要 setAppState。
//   React 18 的自动批处理只合并**同一个事件循环**内的更新；
//   而网络回调分散在不同 tick 到达（每个服务器的握手耗时不同），批不住。
//
//   queueMicrotask 在同一 tick 末尾就 flush，正好赶不上「网络 I/O 在不同时刻到达」
//   这个场景 —— 它解决的是「同 tick 内的多次更新」，这里的问题是「跨 tick」。
//
//   16ms ≈ 一帧。批处理窗口的粒度必须匹配事件的到达节奏：
//   窗口太短等于没批，太长会让界面明显滞后（用户点了工具列表，半秒后才刷新）。
  // Batched MCP state updates: queue individual server updates and flush them
  // in a single setAppState call via setTimeout. Using a time-based window
  // (instead of queueMicrotask) ensures updates are batched even when
  // connection callbacks arrive at different times due to network I/O.
  const MCP_BATCH_FLUSH_MS = 16
  type PendingUpdate = MCPServerConnection & {
    tools?: Tool[]
    commands?: Command[]
    resources?: ServerResource[]
  }
  const pendingUpdatesRef = useRef<PendingUpdate[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

// 【本文件最容易读错的一处：那个 `?? []` 到底改了什么】
//
//   232-243 行的三元看起来两支差不多，实际编码了两种完全不同的语义：
//
//     非 disabled/failed：rawTools 原样传下去 —— 如果是 undefined，
//                          下面 255 行 tools === undefined 成立 → **保留原有工具**
//     disabled/failed：   (rawTools ?? []) —— undefined 变成 []，
//                          下面就不等于 undefined → 走 reject + concat([]) → **清空**
//
//   也就是说，同一个 undefined，在一个分支里表示「不动它」，
//   在另一个分支里表示「清掉它」。用 `?? []` 把「保持」和「清空」的差别
//   折叠进了一个两字符的操作符。
//
//   L293-296 的注释说了这个契约（undefined 保持、disabled/failed 清空），
//   但代码里看不见 —— 这是那种「注释正确、代码正确、但两者关系不直观」的地方。
//   想验证的话：把 `?? []` 改成 `?? undefined`，禁用服务器后它的工具会残留在模型上下文里。
  const flushPendingUpdates = useCallback(() => {
    flushTimerRef.current = null
    const updates = pendingUpdatesRef.current
    if (updates.length === 0) return
    pendingUpdatesRef.current = []

    setAppState(prevState => {
      let mcp = prevState.mcp

      for (const update of updates) {
        const {
          tools: rawTools,
          commands: rawCmds,
          resources: rawRes,
          ...client
        } = update
        const tools =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawTools ?? [])
            : rawTools
        const commands =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawCmds ?? [])
            : rawCmds
        const resources =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawRes ?? [])
            : rawRes

// 【按名字前缀替换，因为 AppState 里的工具是扁平数组】
//
//   mcp.tools 不是 { serverName: Tool[] }，而是所有 MCP 工具摊平成一维。
//   为什么摊平：这个数组最终要序列化进 API 请求的 tools 字段，
//   扁平结构直接可用，没有嵌套解析成本。
//
//   代价：**归属信息只存在于名字里**（getMcpPrefix 拼出的 mcp__<server>__）。
//   于是「更新某个服务器的工具」必须变成「按前缀反查 + 剔除 + 追加」，
//   而不是简单的键赋值。
//
//   reject 之后再 concat 空数组 = 清空该服务器的工具。
//   顺序不能反：先 concat 再 reject 会把新工具也删掉。
        const prefix = getMcpPrefix(client.name)
        const existingClientIndex = mcp.clients.findIndex(
          c => c.name === client.name,
        )

        const updatedClients =
          existingClientIndex === -1
            ? [...mcp.clients, client]
            : mcp.clients.map(c => (c.name === client.name ? client : c))

        const updatedTools =
          tools === undefined
            ? mcp.tools
            : [...reject(mcp.tools, t => t.name?.startsWith(prefix)), ...tools]

        const updatedCommands =
          commands === undefined
            ? mcp.commands
            : [
                ...reject(mcp.commands, c =>
                  commandBelongsToServer(c, client.name),
                ),
                ...commands,
              ]

// resources 是唯一按服务器分组的（Record<serverName, Resource[]>），
// 因为它从来不会一次性全部塞进模型上下文 —— 是按需读取的。
//
// 272-277 行的写法值得注意：resources 为空时用 omit 删掉这个 key，
// 而不是存一个空数组。这样「没有资源」和「有 0 个资源」在状态里是同一种表示，
// 下游判空只需要一个 `if (!mcp.resources[name])`。
        const updatedResources =
          resources === undefined
            ? mcp.resources
            : {
                ...mcp.resources,
                ...(resources.length > 0
                  ? { [client.name]: resources }
                  : omit(mcp.resources, client.name)),
              }

        mcp = {
          ...mcp,
          clients: updatedClients,
          tools: updatedTools,
          commands: updatedCommands,
          resources: updatedResources,
        }
      }

      return { ...prevState, mcp }
    })
  }, [setAppState])

// 【这是 updateServer 的契约，也是这个文件最重要的一条隐式接口】
//
//   tools/commands/resources 三个字段都是「undefined = 保持原值」。
//   所以调用方无法用 undefined 表达「清空」—— 想清空必须同时把 type 设成
//   disabled 或 failed（走 232 行那个分支）。
//
//   这个契约的好处：连接状态更新（比如 pending → pending 带 reconnectAttempt）
//   不需要先把工具列表读出来再原样传回去，就不会出现「用旧快照覆盖新结果」的竞态。
//   坏处：想清空必须知道这个约定，否则会写出「明明设了空数组工具还在」的代码。
  // Update server state, tools, commands, and resources.
  // When tools, commands, or resources are undefined, the existing values are preserved.
  // When type is 'disabled' or 'failed', tools/commands/resources are automatically cleared.
  // Updates are batched via setTimeout to coalesce updates arriving within MCP_BATCH_FLUSH_MS.
  const updateServer = useCallback(
    (update: PendingUpdate) => {
      pendingUpdatesRef.current.push(update)
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(
          flushPendingUpdates,
          MCP_BATCH_FLUSH_MS,
        )
      }
    },
    [flushPendingUpdates],
  )

  const onConnectionAttempt = useCallback(
    ({
      client,
      tools,
      commands,
      resources,
    }: {
      client: MCPServerConnection
      tools: Tool[]
      commands: Command[]
      resources?: ServerResource[]
    }) => {
      updateServer({ ...client, tools, commands, resources })

      // Handle side effects based on client state
// 五种 client.type 里只有 connected 有副作用。
//
//   needs-auth 的处理不在这里 —— 它在 auth.ts（发起授权）和 UI 层（提示用户）。
//   pending 是「正在连」，本来就没有东西可挂。
//   这个 switch 写成「只处理 connected，其余 break」而不是每个分支都写点什么，
//   是因为**没有动作**本身就是一个明确的决定，值得让它一眼可见。
      switch (client.type) {
        case 'connected': {
          // Overwrite the default elicitation handler registered in connectToServer
          // with the real one (queues elicitation in AppState for UI). Registering
          // here (once per connect) instead of in a [mcpClients] effect avoids
          // re-running for every already-connected server on each state change.
          registerElicitationHandler(client.client, client.name, setAppState)

// 【状态机的转移动作放在 UI 层，不是 client.ts】
//
//   onclose 在这里被整个替换掉。client.ts 里那个默认实现只管「标记断开」，
//   而「要不要重连、重连期间显示什么、点禁用之后怎么停」
//   是产品决策，不是协议决策。
//
//   代价：client.ts 的人读不到这个回调的最终行为，只看得到它被赋了值。
//   读的时候必须意识到「这里的 onclose 已经被覆盖了」。
          client.client.onclose = () => {
            const configType = client.config.type ?? 'stdio'

            clearServerCache(client.name, client.config).catch(() => {
              logForDebugging(
                `Failed to invalidate the server cache: ${client.name}`,
              )
            })

// 【这段 TODO 值得完整读：它承认了一个不优雅的设计，也说明了为什么】
//
//   问题是：onclose 触发时，AppState 里这个服务器**还是 connected**
//   —— 因为「把它标成 failed」的更新还没提交。
//   如果读 AppState 判断「是不是用户主动禁用」，会得到「不是」，
//   于是一个被用户禁用的服务器会启动重连 —— 死循环。
//
//   解法是退一步读磁盘（isMcpServerDisabled 读配置文件），
//   因为「禁用」这个动作**先写盘再断连**（见 1093-1095 行的注释与顺序）。
//
//   于是这里有一条跨模块的顺序契约：
//     toggleMcpServer 里：写盘 → clearServerCache → updateServer(disabled)
//     这里的 onclose：读盘 → 决定要不要重连
//
//   两处注释互相指认，读的时候要连起来看。**顺序反了就是死循环。**
            // TODO: This really isn't great: ideally we'd check appstate as the source of truth
            // as to whether it was disconnected due to a disable, but appstate is stale at this
            // point. Getting a live reference to appstate feels a little hacky, so we'll just
            // check the disk state. We may want to refactor some of this.
            if (isMcpServerDisabled(client.name)) {
              logMCPDebug(
                client.name,
                `Server is disabled, skipping automatic reconnection`,
              )
              return
            }

            // Handle automatic reconnection for remote transports
            // Skip stdio (local process) and sdk (internal) - they don't support reconnection
// 只有远程传输（http / ws / sse）才重连。
// stdio 是本地进程：进程死了说明命令本身有问题，重连只会一直失败；
// sdk 是内部通道（IDE 集成），生命周期由宿主控制。
            if (configType !== 'stdio' && configType !== 'sdk') {
              const transportType = getTransportDisplayName(configType)
              logMCPDebug(
                client.name,
                `${transportType} transport closed/disconnected, attempting automatic reconnection`,
              )

              // Cancel any existing reconnection attempt for this server
              const existingTimer = reconnectTimersRef.current.get(client.name)
              if (existingTimer) {
                clearTimeout(existingTimer)
                reconnectTimersRef.current.delete(client.name)
              }

              // Attempt reconnection with exponential backoff
// 【这个循环有两个出口，而且都必须在正确的时机把 timer 从 Map 里删掉】
//
//   正常成功（409）→ 删 timer，把结果交给 onConnectionAttempt，return
//   最后一次仍失败（424 / 441）→ 删 timer，标记 failed，return
//
//   注意 418 和 435 是两处独立的「最后一次」判断：一处是 reconnect 返回了
//   非 connected 的结果（没抛错但也没连上），一处是抛了错。
//   这两条路都必须在最后一次收敛到终态，否则服务器会永远停在 pending，
//   界面上看是「一直在连接」的转圈。
//
//   中间的每次失败都 updateServer 成 pending 并带上 reconnectAttempt，
//   UI 就能显示「第 3/5 次」。
              const reconnectWithBackoff = async () => {
                for (
                  let attempt = 1;
                  attempt <= MAX_RECONNECT_ATTEMPTS;
                  attempt++
                ) {
                  // Check if server was disabled while we were waiting
                  if (isMcpServerDisabled(client.name)) {
                    logMCPDebug(
                      client.name,
                      `Server disabled during reconnection, stopping retry`,
                    )
                    reconnectTimersRef.current.delete(client.name)
                    return
                  }

                  updateServer({
                    ...client,
                    type: 'pending',
                    reconnectAttempt: attempt,
                    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
                  })

                  const reconnectStartTime = Date.now()
                  try {
                    const result = await reconnectMcpServerImpl(
                      client.name,
                      client.config,
                    )
                    const elapsed = Date.now() - reconnectStartTime

                    if (result.client.type === 'connected') {
                      logMCPDebug(
                        client.name,
                        `${transportType} reconnection successful after ${elapsed}ms (attempt ${attempt})`,
                      )
                      reconnectTimersRef.current.delete(client.name)
                      onConnectionAttempt(result)
                      return
                    }

                    logMCPDebug(
                      client.name,
                      `${transportType} reconnection attempt ${attempt} completed with status: ${result.client.type}`,
                    )

                    // On final attempt, update state with the result
                    if (attempt === MAX_RECONNECT_ATTEMPTS) {
                      logMCPDebug(
                        client.name,
                        `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`,
                      )
                      reconnectTimersRef.current.delete(client.name)
                      onConnectionAttempt(result)
                      return
                    }
                  } catch (error) {
                    const elapsed = Date.now() - reconnectStartTime
                    logMCPError(
                      client.name,
                      `${transportType} reconnection attempt ${attempt} failed after ${elapsed}ms: ${error}`,
                    )

                    // On final attempt, mark as failed
                    if (attempt === MAX_RECONNECT_ATTEMPTS) {
                      logMCPDebug(
                        client.name,
                        `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`,
                      )
                      reconnectTimersRef.current.delete(client.name)
                      updateServer({ ...client, type: 'failed' })
                      return
                    }
                  }

                  // Schedule next retry with exponential backoff
                  const backoffMs = Math.min(
                    INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
                    MAX_BACKOFF_MS,
                  )
                  logMCPDebug(
                    client.name,
                    `Scheduling reconnection attempt ${attempt + 1} in ${backoffMs}ms`,
                  )

// 【这是那个「故意泄漏的 promise」】
//
//   setTimeout 的 handle 存进 ref 是为了可取消，代价是 clearTimeout 之后
//   这个 promise 永远不 resolve，整个 async 函数（连同它捕获的 client 对象）
//   一直挂在内存里直到页面卸载。
//
//   为什么值得：用户点「禁用」的意图是「立刻停」。
//   用 await sleep() 的话没有 handle 可清，用户要等最多 30 秒才停。
//
//   这类「用一点资源泄漏换一个用户可感知的行为」的取舍，
//   判断标准是**泄漏的规模是否与用户操作次数成正比**：
//   每次禁用泄漏一个闭包，一天点十次也就十次 —— 可以接受。
//   如果是在每次请求上泄漏，那就必须修。
                  await new Promise<void>(resolve => {
                    // eslint-disable-next-line no-restricted-syntax -- timer stored in ref for cancellation; sleep() doesn't expose the handle
                    const timer = setTimeout(resolve, backoffMs)
                    reconnectTimersRef.current.set(client.name, timer)
                  })
                }
              }

              void reconnectWithBackoff()
// stdio / sdk 断开直接判 failed，不做任何重试。
// 注意这里没有 onConnectionAttempt(result)，因为根本没有 result ——
// 它是「不重试」这个决定本身。
            } else {
              updateServer({ ...client, type: 'failed' })
            }
          }

// 【channel 是「服务器主动往对话里推消息」，门禁和连接是两件事】
//
//   472 行注释说清了：gate 只决定「要不要注册通知处理器」，
//   连接本身是否建立由 allowedMcpServers 控制。
//
//   所以会出现「连上了但收不到消息」这个状态 —— 这不是 bug，
//   是「企业允许你用这个服务器，但不允许它往你的对话里插话」。
//   两个权限维度分开，才能表达这种组合。
          // Channel push: notifications/claude/channel → enqueue().
          // Gate decides whether to register the handler; connection stays
          // up either way (allowedMcpServers controls that).
          if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
            const gate = gateChannelServer(
              client.name,
              client.capabilities,
              client.config.pluginSource,
            )
            const entry = findChannelEntry(client.name, getAllowedChannels())
            // Plugin identifier for telemetry — log name@marketplace for any
            // plugin-kind entry (same tier as tengu_plugin_installed, which
            // logs arbitrary plugin_id+marketplace_name ungated). server-kind
            // names are MCP-server-name tier; those are opt-in-only elsewhere
            // (see isAnalyticsToolDetailsLoggingEnabled in metadata.ts) and
            // stay unlogged here. is_dev/entry_kind segment the rest.
            const pluginId =
              entry?.kind === 'plugin'
                ? (`${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
                : undefined
            // Skip capability-miss — every non-channel MCP server trips it.
// capability 类的 skip 不进埋点。理由在 490 行：每一个非 channel 的
// MCP 服务器都会触发它（它们本来就没有 channel 能力），
// 打进埋点只会把真正的信号淹掉。
//
// 判据是「这条记录的分布是否由用户行为决定」——
// 如果 99% 的样本来自「服务器没有这个能力」这种正常情况，就不该记。
            if (gate.action === 'register' || gate.kind !== 'capability') {
              logEvent('tengu_mcp_channel_gate', {
                registered: gate.action === 'register',
                skip_kind:
                  gate.action === 'skip'
                    ? (gate.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
                    : undefined,
                entry_kind:
                  entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                is_dev: entry?.dev ?? false,
                plugin: pluginId,
              })
            }
// register 时挂两个处理器，对应两个**独立的能力声明**：
//
//   ChannelMessageNotificationSchema     服务器 → 对话（推消息）
//   ChannelPermissionNotificationSchema  服务器 → 权限应答（解析用户回复）
//
//   539 行检查的是 claude/channel/permission 这个能力有没有声明，
//   和通道消息的能力是两个开关。分开的理由：允许推消息不等于
//   允许它介入权限流程 —— 后者危险得多（它能替你批准工具调用）。
//
//   权限应答由**服务器自己解析**用户的自然语言回复，我们只收
//   {request_id, behavior} 这个结构化结果。这样「频道里的闲聊文本」
//   不可能被误判成授权 —— 解析责任在声明了能力的服务器那边。
            switch (gate.action) {
              case 'register':
                logMCPDebug(client.name, 'Channel notifications registered')
                client.client.setNotificationHandler(
                  ChannelMessageNotificationSchema(),
                  async notification => {
                    const { content, meta } = notification.params
                    logMCPDebug(
                      client.name,
                      `notifications/claude/channel: ${content.slice(0, 80)}`,
                    )
                    logEvent('tengu_mcp_channel_message', {
                      content_length: content.length,
                      meta_key_count: Object.keys(meta ?? {}).length,
                      entry_kind:
                        entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      is_dev: entry?.dev ?? false,
                      plugin: pluginId,
                    })
                    enqueue({
                      mode: 'prompt',
                      value: wrapChannelMessage(client.name, content, meta),
                      priority: 'next',
                      isMeta: true,
                      origin: { kind: 'channel', server: client.name },
                      skipSlashCommands: true,
                    })
                  },
                )
                // Permission-reply handler — separate event, separate
                // capability. Only registers if the server declares
                // claude/channel/permission (same opt-in check as the send
                // path in interactiveHandler.ts). Server parses the user's
                // reply and emits {request_id, behavior}; no regex on our
                // side, text in the general channel can't accidentally match.
                if (
                  client.capabilities?.experimental?.[
                    'claude/channel/permission'
                  ] !== undefined
                ) {
                  client.client.setNotificationHandler(
                    ChannelPermissionNotificationSchema(),
                    async notification => {
                      const { request_id, behavior } = notification.params
                      const resolved =
                        channelPermCallbacksRef.current?.resolve(
                          request_id,
                          behavior,
                          client.name,
                        ) ?? false
                      logMCPDebug(
                        client.name,
                        `notifications/claude/channel/permission: ${request_id} → ${behavior} (${resolved ? 'matched pending' : 'no pending entry — stale or unknown ID'})`,
                      )
                    },
                  )
                }
                break
// 【skip 必须主动摘处理器，否则降级是单向的】
//
//   gate 的结果可能从 register 变成 skip：用户在会话中途 /logout，
//   effect 重跑，gate 这次判 auth 失败。
//   如果 skip 分支什么都不做，之前挂上的 handler 还活着，
//   继续往消息队列里塞内容 —— 门说「不行」，实际还在放行。
//
//   removeNotificationHandler 是幂等的（内部 Map.delete），
//   所以对从未注册过的服务器调用也安全，不需要判断「之前注册过没有」。
//
//   这类「反向操作必须和正向操作一样显式」的模式，在状态机代码里反复出现：
//   **只写打开不写关闭，等于假设状态只会单向变化。**
              case 'skip':
                // Idempotent teardown so a register→skip re-gate (e.g.
                // effect re-runs after /logout) actually removes the live
                // handler. Without this, mid-session demotion is one-way:
                // the gate says skip but the earlier handler keeps enqueuing.
                // Map.delete — safe when never registered.
                client.client.removeNotificationHandler(
                  'notifications/claude/channel',
                )
                client.client.removeNotificationHandler(
                  CHANNEL_PERMISSION_METHOD,
                )
                logMCPDebug(
                  client.name,
                  `Channel notifications skipped: ${gate.reason}`,
                )
                // Surface a once-per-kind toast when a channel server is
                // blocked. This is the only
                // user-visible signal (logMCPDebug above requires --debug).
                // Capability/session skips are expected noise and stay
                // debug-only. marketplace/allowlist run after session — if
                // we're here with those kinds, the user asked for it.
// 【弹 toast 的四个条件，每个都在排除一类噪音】
//
//   1. 排除 capability / session：这是「服务器本来就没这个能力」和
//      「当前会话没开这个功能」，用户无法采取任何行动，弹了只是打扰。
//   2. 按 kind 去重（见 162 行）：同一种阻塞只提醒一次。
//   3. marketplace / allowlist 两类即使 entry 为 undefined 也弹 ——
//      因为这两类是「用户明确要求开 channel」却没成，必须告诉他。
//   4. 其余 kind 必须有 entry（说明用户确实配了这个 channel）。
//
//   文案分两种策略（593 行注释）：disabled/auth/policy 用定制文案（更短、可操作），
//   marketplace/allowlist 直接复用 gate 的 reason（那里已经说明了不匹配的具体内容）。
//   后者如果也写定制文案，就会把「哪个字段不匹配」这个关键信息丢掉。
                if (
                  gate.kind !== 'capability' &&
                  gate.kind !== 'session' &&
                  !channelWarnedKindsRef.current.has(gate.kind) &&
                  (gate.kind === 'marketplace' ||
                    gate.kind === 'allowlist' ||
                    entry !== undefined)
                ) {
                  channelWarnedKindsRef.current.add(gate.kind)
                  // disabled/auth/policy get custom toast copy (shorter, actionable);
                  // marketplace/allowlist reuse the gate's reason verbatim
                  // since it already names the mismatch.
                  const text =
                    gate.kind === 'disabled'
                      ? 'Channels are not currently available'
                      : gate.kind === 'auth'
                        ? 'Channels require claude.ai authentication · run /login'
                        : gate.kind === 'policy'
                          ? 'Channels are not enabled for your org · have an administrator set channelsEnabled: true in managed settings'
                          : gate.reason
                  addNotification({
                    key: `channels-blocked-${gate.kind}`,
                    priority: 'high',
                    text,
                    color: 'warning',
                    timeoutMs: 12000,
                  })
                }
                break
            }
          }

// 【三个 list_changed 处理器共享同一套缓存失效纪律：先 delete 再 await】
//
//   fetchToolsForClient / fetchCommandsForClient / fetchResourcesForClient
//   都是 memoize 过的函数，带一个 .cache（Map）。
//   收到 list_changed 时**必须先让缓存失效**，否则 await 拿回来的是旧结果，
//   然后 updateServer 会把正确的旧值当成新值写进状态 —— 界面上什么都不变。
//
//   这看起来是显然的，但三个处理器里最容易漏的是 resources（716 行）：
//   它还会顺手清 prompts 缓存。理由见那一处。
          // Register notification handlers for list_changed notifications
          // These allow the server to notify us when tools, prompts, or resources change
          if (client.capabilities?.tools?.listChanged) {
            client.client.setNotificationHandler(
              ToolListChangedNotificationSchema,
              async () => {
                logMCPDebug(
                  client.name,
                  `Received tools/list_changed notification, refreshing tools`,
                )
                try {
// 【缓存里存的是 Promise，不是值】
//
//   memoize 的实现缓存的是**第一次调用的返回对象**，也就是一个 promise。
//   所以这里能在 delete 之前抓住 previousToolsPromise，
//   然后 .then 里拿到它的结果来对比「从 N 个变成 M 个」。
//
//   如果缓存的是值，这行代码根本写不出来 —— 你无法在失效之后
//   再问「失效前的值是什么」。
//
//   顺带：这个埋点只在「之前有过一次 fetch」时才带 previousCount。
//   首次连接（缓存空）也发一次，但不带对比字段 ——
//   两种样本的形状不同，下游分析时必须分开处理。
                  // Grab cached promise before invalidating to log previous count
                  const previousToolsPromise = fetchToolsForClient.cache.get(
                    client.name,
                  )
                  fetchToolsForClient.cache.delete(client.name)
                  const newTools = await fetchToolsForClient(client)
                  const newCount = newTools.length
                  if (previousToolsPromise) {
                    previousToolsPromise.then(
                      (previousTools: Tool[]) => {
                        logEvent('tengu_mcp_list_changed', {
                          type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          previousCount: previousTools.length,
                          newCount,
                        })
                      },
                      () => {
                        logEvent('tengu_mcp_list_changed', {
                          type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          newCount,
                        })
                      },
                    )
                  } else {
                    logEvent('tengu_mcp_list_changed', {
                      type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      newCount,
                    })
                  }
                  updateServer({ ...client, tools: newTools })
                } catch (error) {
                  logMCPError(
                    client.name,
                    `Failed to refresh tools after list_changed notification: ${errorMessage(error)}`,
                  )
                }
              },
            )
          }

          if (client.capabilities?.prompts?.listChanged) {
            client.client.setNotificationHandler(
              PromptListChangedNotificationSchema,
              async () => {
                logMCPDebug(
                  client.name,
                  `Received prompts/list_changed notification, refreshing prompts`,
                )
                logEvent('tengu_mcp_list_changed', {
                  type: 'prompts' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                try {
// prompts 变了要同时刷 skills，但**不能清 skills 的缓存**。
// 因为 skills 是从 resources 发现的，与 prompts 无关 ——
// 清了会触发一次不必要的网络请求，拿回同样的内容。
//
// fetchMcpSkillsForClient 会返回缓存结果，所以这里 await 它几乎无成本。
                  // Skills come from resources, not prompts — don't invalidate their
                  // cache here. fetchMcpSkillsForClient returns the cached result.
                  fetchCommandsForClient.cache.delete(client.name)
                  const [mcpPrompts, mcpSkills] = await Promise.all([
                    fetchCommandsForClient(client),
                    feature('MCP_SKILLS')
                      ? fetchMcpSkillsForClient!(client)
                      : Promise.resolve([]),
                  ])
                  updateServer({
                    ...client,
                    commands: [...mcpPrompts, ...mcpSkills],
                  })
                  // MCP skills changed — invalidate skill-search index so
                  // next discovery rebuilds with the new set.
                  clearSkillIndexCache?.()
                } catch (error) {
                  logMCPError(
                    client.name,
                    `Failed to refresh prompts after list_changed notification: ${errorMessage(error)}`,
                  )
                }
              },
            )
          }

          if (client.capabilities?.resources?.listChanged) {
            client.client.setNotificationHandler(
              ResourceListChangedNotificationSchema,
              async () => {
                logMCPDebug(
                  client.name,
                  `Received resources/list_changed notification, refreshing resources`,
                )
                logEvent('tengu_mcp_list_changed', {
                  type: 'resources' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
// 【本文件最隐蔽的一处：为什么 resources 处理器要清 prompts 缓存】
//
//   因为 MCP_SKILLS 打开时，这个处理器**同时写 resources 和 commands**（731-735 行）。
//   而 commands 也是 prompts 处理器的写入目标。
//
//   竞态：prompts/list_changed 先到 → 它清了 prompts 缓存、fetch 到新结果、
//   还没 updateServer；此时 resources/list_changed 到达 → 它用**自己持有的旧**
//   prompts 缓存值去 fetch，然后 731 行把这份旧结果写进 commands，
//   把前一个处理器的新结果覆盖掉了。
//
//   解法就是 724 行：在 resources 处理器里也把 prompts 缓存清掉，
//   让两边读到的都是新值。
//
//   规律：**两个异步处理器写同一个 state 字段时，它们的缓存失效范围必须重叠。**
//   只清理「自己要用到的缓存」是不够的，还要清理「自己会写出去的缓存」。
                try {
                  fetchResourcesForClient.cache.delete(client.name)
                  if (feature('MCP_SKILLS')) {
                    // Skills are discovered from resources, so refresh them too.
                    // Invalidate prompts cache as well: we write commands here,
                    // and a concurrent prompts/list_changed could otherwise have
                    // us stomp its fresh result with our cached stale one.
                    fetchMcpSkillsForClient!.cache.delete(client.name)
                    fetchCommandsForClient.cache.delete(client.name)
                    const [newResources, mcpPrompts, mcpSkills] =
                      await Promise.all([
                        fetchResourcesForClient(client),
                        fetchCommandsForClient(client),
                        fetchMcpSkillsForClient!(client),
                      ])
                    updateServer({
                      ...client,
                      resources: newResources,
                      commands: [...mcpPrompts, ...mcpSkills],
                    })
                    // MCP skills changed — invalidate skill-search index so
                    // next discovery rebuilds with the new set.
                    clearSkillIndexCache?.()
                  } else {
                    const newResources = await fetchResourcesForClient(client)
                    updateServer({ ...client, resources: newResources })
                  }
                } catch (error) {
                  logMCPError(
                    client.name,
                    `Failed to refresh resources after list_changed notification: ${errorMessage(error)}`,
                  )
                }
              },
            )
          }
          break
        }

// 剩下四种状态没有副作用，但每一种都在别处有主：
//   needs-auth → auth.ts 发起授权，UI 层提示用户
//   failed     → 用户点重连（1046 行），或下一次 effect 重跑时重新标 pending
//   pending    → 正在连，无事可做
//   disabled   → 用户的选择，读磁盘的 isMcpServerDisabled 是真相源
//
// 这里显式列出四个 case 而不是写 default，是为了让「以后新增一种 type」时
// 编译器（或 review）能强制你想一遍它在哪处理。
        case 'needs-auth':
        case 'failed':
        case 'pending':
        case 'disabled':
          break
      }
    },
    [updateServer],
  )

// 【第一个 effect 的职责被严格限制在「标状态」，它不连接】
//
//   为什么要有这一步：UI 的首帧不应该等网络。
//   先把配置里出现、但状态里还没有的服务器标成 pending/disabled，
//   侧边栏立刻就能显示「有 5 个 MCP 服务器，正在连接」。
//   真正连接在 858 行那个 effect 里，慢的话也只是状态标签多转几秒。
//
//   这个 effect 和下一个 effect 都会调 getClaudeCodeMcpConfigs（读两遍配置），
//   790 行的注释解释了为什么：在「标 pending」这条路径上等 claude.ai 的
//   网络请求，会让首帧卡住 —— 而 claude.ai 的 dedup 只在真正连接时才需要。
  // Initialize all servers to pending state if they don't exist in appState.
  // Re-runs on session change (/clear) and on /reload-plugins (pluginReconnectKey).
  // On plugin reload, also disconnects stale plugin MCP servers (scope 'dynamic')
  // that no longer appear in configs — prevents ghost tools from disabled plugins.
  // Skip claude.ai dedup here to avoid blocking on the network fetch; the connect
  // useEffect below runs immediately after and dedups before connecting.
  const sessionId = getSessionId()
  useEffect(() => {
    async function initializeServersAsPending() {
      const { servers: existingConfigs, errors: mcpErrors } = isStrictMcpConfig
        ? { servers: {}, errors: [] }
        : await getClaudeCodeMcpConfigs(dynamicMcpConfig)
      const configs = { ...existingConfigs, ...dynamicMcpConfig }

      // Add MCP errors to plugin errors for UI visibility (deduplicated)
      addErrorsToAppState(setAppState, mcpErrors)

// 【这段是全文最有价值的三条 hazard 注释：异步清理动作本身有副作用】
//
//   excludeStalePluginClients 找出「插件被删了」或「配置 hash 变了」的服务器。
//   清理它们之前必须先拆掉三根引线，否则清理动作会反过来制造问题：
//
//   ① 挂起的重连 timer 会用**旧 config** 触发 —— 先 clearTimeout。
//      不拆的话，几秒后旧 config 被重新连上，和下面新建的连接打架。
//
//   ② onclose 闭包里捕获的也是旧 config，且它检查的是 isMcpServerDisabled
//      （配置变更的服务器不是 disabled）→ 它会启动一轮重连，
//      和新建连接竞争，「最后写入者获胜」——而最后写入的往往是旧的那个。
//      所以 809 行先把 onclose 置 undefined 再清理。
//
//   ③ clearServerCache 内部会调 connectToServer（memoized）。
//      对从未连接过的服务器，缓存是空的 → 它真的去 spawn 进程 / 走 OAuth，
//      然后立刻被 kill。所以 808 行只对 connected 的服务器调。
//
//   三条揭示同一个规律：**「清理」不是一个无副作用的操作。**
//   凡是要停掉一个异步流程，都得先想清楚「停它」这件事会不会触发别的流程。
      setAppState(prevState => {
        // Disconnect MCP servers that are stale: plugin servers removed from
        // config, or any server whose config hash changed (edited .mcp.json).
        // Stale servers get re-added as 'pending' below since their name is
        // now absent from mcpWithoutStale.clients.
        const { stale, ...mcpWithoutStale } = excludeStalePluginClients(
          prevState.mcp,
          configs,
        )
        // Clean up stale connections. Fire-and-forget — state updaters must
        // be synchronous. Three hazards to defuse before calling cleanup:
        //   1. Pending reconnect timer would fire with the OLD config.
        //   2. onclose (set at L254) starts reconnectWithBackoff with the
        //      OLD config from its closure — it checks isMcpServerDisabled
        //      but config-changed servers aren't disabled, so it'd race the
        //      fresh connection and last updateServer wins.
        //   3. clearServerCache internally calls connectToServer (memoized).
        //      For never-connected servers (disabled/pending/failed) the
        //      cache is empty → real connect attempt → spawn/OAuth just to
        //      immediately kill it. Only connected servers need cleanup.
// 三步的顺序不能换：
//   删 timer（停止未来）→ 摘 onclose（停止现在可能触发的）→ 清缓存（真正断开）
//
//   反过来先清缓存：断开 → 触发 onclose → 它启动重连 → 你再去删 timer，
//   此时 timer 已经被新一轮重连的循环重新写进 Map 了。
        for (const s of stale) {
          const timer = reconnectTimersRef.current.get(s.name)
          if (timer) {
            clearTimeout(timer)
            reconnectTimersRef.current.delete(s.name)
          }
// 只对 connected 调 clearServerCache，理由见 798-801 行。
// 这里的 `.catch(() => {})` 不是偷懒：清理失败不该阻塞后面的状态更新，
// 而且失败的服务器在下一轮会被重新标成 pending 重试。
          if (s.type === 'connected') {
            s.client.onclose = undefined
            void clearServerCache(s.name, s.config).catch(() => {})
          }
        }

        const existingServerNames = new Set(
          mcpWithoutStale.clients.map(c => c.name),
        )
        const newClients = Object.entries(configs)
          .filter(([name]) => !existingServerNames.has(name))
          .map(([name, config]) => ({
            name,
            type: isMcpServerDisabled(name)
              ? ('disabled' as const)
              : ('pending' as const),
            config,
          }))

        if (newClients.length === 0 && stale.length === 0) {
          return prevState
        }

        return {
          ...prevState,
          mcp: {
            ...prevState.mcp,
            ...mcpWithoutStale,
            clients: [...mcpWithoutStale.clients, ...newClients],
          },
        }
      })
    }

    void initializeServersAsPending().catch(error => {
      logMCPError(
        'useManageMCPConnections',
        `Failed to initialize servers as pending: ${errorMessage(error)}`,
      )
    })
  }, [
    isStrictMcpConfig,
    dynamicMcpConfig,
    setAppState,
    sessionId,
    _pluginReconnectKey,
  ])

// 【第二个 effect：真正加载配置并连接，分两阶段】
//
//   Phase 1：Claude Code 自己的配置（本地文件 + 插件，快）
//   Phase 2：claude.ai 的连接器（网络请求，可能慢，可能要登录）
//
//   关键设计（867 行）：claude.ai 的请求在 Phase 1 **之前**就发出去，
//   但只在 Phase 2 才 await。于是它和 Phase 1 里的 loadAllPlugins()
//   并行执行，整个流程的时间是 max(本地, 网络) 而不是 本地 + 网络。
//
//   这是「提前发起、延后等待」（promise hoisting）的标准用法：
//   把一个 await 拆成「开始」和「等结果」两个时刻。
  // Load MCP configs and connect to servers
  // Two-phase loading: Claude Code configs first (fast), then claude.ai configs (may be slow)
  useEffect(() => {
    let cancelled = false

// 【cancelled 标志只能挡住「继续往下走」，挡不住已经发出的请求】
//
//   882、910 行各检查一次，都在 await 之后。
//   所以 effect 重跑时，上一轮的网络请求会继续跑完，只是结果被丢弃。
//
//   为什么不用 AbortController：这里要取消的不是请求，是「后续阶段的许可」。
//   而且 getMcpToolsCommandsAndResources 一旦启动就取消不了（它内部有自己的
//   多服务器并发），强行包信号会把这个函数变复杂，收益只有几次无用的网络往返。
//
//   代价要说清楚：**快速切换会话时，上一轮的 claude.ai 请求仍会消耗一次配额。**
    async function loadAndConnectMcpConfigs() {
      // Clear claude.ai MCP cache so we fetch fresh configs with current auth
      // state. This is important when authVersion changes (e.g., after login/
      // logout). Kick off the fetch now so it overlaps with loadAllPlugins()
      // inside getClaudeCodeMcpConfigs; it's awaited only at the dedup step.
      // Phase 2 below awaits the same promise — no second network call.
// 【企业策略或 strict 模式下，claude.ai 那条线整体关掉】
//
//   doesEnterpriseMcpConfigExist 为真 → 直接给一个已 resolve 的空对象，
//   连 clearClaudeAIMcpConfigsCache 都不调。
//   这不是省一次网络请求，是**企业部署里不应该向 claude.ai 发任何请求**（隐私边界）。
//
//   注意它是 fail-open 的（config.ts 里那段）：检测企业配置本身可能失败，
//   失败时按「不存在」处理 —— 宁可多走一次网络，也不要因为一个读配置文件
//   的错误把所有人的 MCP 全部禁掉。
      let claudeaiPromise: Promise<Record<string, ScopedMcpServerConfig>>
      if (isStrictMcpConfig || doesEnterpriseMcpConfigExist()) {
        claudeaiPromise = Promise.resolve({})
      } else {
        clearClaudeAIMcpConfigsCache()
        claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
      }

// Phase 1 里传入 claudeaiPromise 是为了让 getClaudeCodeMcpConfigs
// 能提前知道 claude.ai 那边有哪些服务器，从而**抑制重复的插件服务器**。
//
//   不抑制的后果：同一个 Slack 连接器既作为插件出现、又作为 claude.ai
//   连接器出现，两个都会去连 —— 用户看到两个同名工具，
//   模型也会看到两份 schema（多花 token，还可能选错）。
      // Phase 1: Load Claude Code configs. Plugin MCP servers that duplicate a
      // --mcp-config entry or a claude.ai connector are suppressed here so they
      // don't connect alongside the connector in Phase 2.
      const { servers: claudeCodeConfigs, errors: mcpErrors } =
        isStrictMcpConfig
          ? { servers: {}, errors: [] }
          : await getClaudeCodeMcpConfigs(dynamicMcpConfig, claudeaiPromise)
      if (cancelled) return

      // Add MCP errors to plugin errors for UI visibility (deduplicated)
      addErrorsToAppState(setAppState, mcpErrors)

      const configs = { ...claudeCodeConfigs, ...dynamicMcpConfig }

// 注意这里**没有 await**：连接是并发进行的，Phase 2 的 await 在它跑的同时执行。
// 如果这里 await，整个流程就是「等所有 Claude Code 服务器连完 → 再取 claude.ai 配置」，
// 慢的服务器会拖住快的。
//
// 连接结果通过 onConnectionAttempt 回调逐台回流，UI 就能一台一台亮起来。
      // Start connecting to Claude Code servers (don't wait - runs concurrently with Phase 2)
      // Filter out disabled servers to avoid unnecessary connection attempts
      const enabledConfigs = Object.fromEntries(
        Object.entries(configs).filter(([name]) => !isMcpServerDisabled(name)),
      )
      getMcpToolsCommandsAndResources(
        onConnectionAttempt,
        enabledConfigs,
      ).catch(error => {
        logMCPError(
          'useManageMcpConnections',
          `Failed to get MCP resources: ${errorMessage(error)}`,
        )
      })

      // Phase 2: Await claude.ai configs (started above; memoized — no second fetch)
      let claudeaiConfigs: Record<string, ScopedMcpServerConfig> = {}
      if (!isStrictMcpConfig) {
        claudeaiConfigs = filterMcpServersByPolicy(
          await claudeaiPromise,
        ).allowed
        if (cancelled) return

// 【按内容去重，因为 key 永远不会撞】
//
//   手动配置的 key 是用户起的名字（slack），claude.ai 连接器的 key 是
//   claude.ai Slack —— 两者不同，915 行的合并根本不会触发覆盖。
//   所以必须比 URL 签名（dedupClaudeAiMcpServers 内部做的事）。
//
//   这类问题的通用形态：**当两个来源的命名空间独立时，合并操作看起来安全，
//   实际上是「同一个东西进来两次」。** 去重键必须建立在语义上（URL），不能建立在名字上。
        // Suppress claude.ai connectors that duplicate an enabled manual server.
        // Keys never collide (`slack` vs `claude.ai Slack`) so the merge below
        // won't catch this — need content-based dedup by URL signature.
        if (Object.keys(claudeaiConfigs).length > 0) {
          const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
            claudeaiConfigs,
            configs,
          )
          claudeaiConfigs = dedupedClaudeAi
        }

// 先塞 pending 再连接，和 765 行那个 effect 的理由相同：
// 让 UI 立刻出现这一批服务器，而不是等握手完成才「突然冒出来」。
//
// 顺序很重要：先 setAppState（pending）→ 再 getMcpToolsCommandsAndResources。
// 反过来的话，连接极快时可能出现「connected 先写入、pending 后写入」，
// 最终状态停在 pending 上，界面一直转圈。
        if (Object.keys(claudeaiConfigs).length > 0) {
          // Add claude.ai servers as pending immediately so they show up in UI
          setAppState(prevState => {
            const existingServerNames = new Set(
              prevState.mcp.clients.map(c => c.name),
            )
            const newClients = Object.entries(claudeaiConfigs)
              .filter(([name]) => !existingServerNames.has(name))
              .map(([name, config]) => ({
                name,
                type: isMcpServerDisabled(name)
                  ? ('disabled' as const)
                  : ('pending' as const),
                config,
              }))
            if (newClients.length === 0) return prevState
            return {
              ...prevState,
              mcp: {
                ...prevState.mcp,
                clients: [...prevState.mcp.clients, ...newClients],
              },
            }
          })
// 两个阶段各过滤一次 disabled，看起来重复，但两次的 configs 不是同一份：
// Phase 1 是 claudeCodeConfigs + dynamicMcpConfig，Phase 2 是 claudeaiConfigs。
//
// 不合并成一次过滤的原因：两阶段的连接是独立发起的，
// 各自的入参必须是干净的 —— 否则 getMcpToolsCommandsAndResources
// 会为 disabled 的服务器创建连接对象（虽然不 spawn，但会占一个状态槽位）。

          // Now start connecting (only enabled servers)
          const enabledClaudeaiConfigs = Object.fromEntries(
            Object.entries(claudeaiConfigs).filter(
              ([name]) => !isMcpServerDisabled(name),
            ),
          )
          getMcpToolsCommandsAndResources(
            onConnectionAttempt,
            enabledClaudeaiConfigs,
          ).catch(error => {
            logMCPError(
              'useManageMcpConnections',
              `Failed to get claude.ai MCP resources: ${errorMessage(error)}`,
            )
          })
        }
      }

// 【埋点的桶比 scope 少一个，而且名字对不上】
//
//   scope 有六种：enterprise / user / project / local / dynamic / claudeai
//   桶只有五个：enterprise / global / project / user / plugin（+ claudeai）
//
//   映射关系：user → global，local → user，dynamic → plugin。
//   也就是「字段名 global 里装的是 scope=user 的数量」。
//
//   这不是 bug，是产品口径：「从用户视角看，user 和 local 都是我这个人的配置」。
//   但读埋点数据的人如果按字段名理解，会得出完全错误的结论 ——
//   这类「历史命名 vs 当前语义」的错位，是数据分析里最常见的坑。
      // Log server counts after both phases complete
      const allConfigs = { ...configs, ...claudeaiConfigs }
      const counts = {
        enterprise: 0,
        global: 0,
        project: 0,
        user: 0,
        plugin: 0,
        claudeai: 0,
      }
// 只在内部构建（USER_TYPE=ant）里收集 stdio 命令的 basename。
//
// 目的（977-978 行）：把「哪些本地服务器在跑」和「会话卡不卡」关联起来。
// rust-analyzer 这类服务器的 RSS 能到几个 G，出一份 CPU/内存 profile 时
// 必须知道当时有哪些重进程在跑。
//
// 只发 basename 不发完整路径：路径里可能带用户名、项目名（敏感信息），
// 而 basename（rust-analyzer / tsserver）已经足够定位问题。
      // Ant-only: collect stdio command basenames to correlate with RSS/FPS
      // metrics. Stdio servers like rust-analyzer can be heavy and we want to
      // know which ones correlate with poor session performance.
      const stdioCommands: string[] = []
      for (const [name, serverConfig] of Object.entries(allConfigs)) {
        if (serverConfig.scope === 'enterprise') counts.enterprise++
        else if (serverConfig.scope === 'user') counts.global++
        else if (serverConfig.scope === 'project') counts.project++
        else if (serverConfig.scope === 'local') counts.user++
        else if (serverConfig.scope === 'dynamic') counts.plugin++
        else if (serverConfig.scope === 'claudeai') counts.claudeai++

        if (
          process.env.USER_TYPE === 'ant' &&
          !isMcpServerDisabled(name) &&
          (serverConfig.type === undefined || serverConfig.type === 'stdio') &&
          'command' in serverConfig
        ) {
          stdioCommands.push(basename(serverConfig.command))
        }
      }
// 一条埋点带完所有口径：五个桶的服务器数量 + （内部构建时）stdio 命令清单。
// 注意 stdio_commands 拼成逗号分隔的字符串而不是数组 ——
// 埋点系统对嵌套结构的处理不一致，扁平字符串最稳。
      logEvent('tengu_mcp_servers', {
        ...counts,
        ...(process.env.USER_TYPE === 'ant' && stdioCommands.length > 0
          ? {
              stdio_commands: stdioCommands
                .sort()
                .join(
                  ',',
                ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
      })
    }

    void loadAndConnectMcpConfigs()

// cleanup 只置 cancelled。这里**不做**断开连接 ——
// 那是卸载时（1027 行）该做的事。effect 重跑（换会话、/reload-plugins）
// 时，已连上的服务器应该继续活着，下一条 effect 会把它们标成 pending 再处理。
    return () => {
      cancelled = true
    }
  }, [
    isStrictMcpConfig,
    dynamicMcpConfig,
    onConnectionAttempt,
    setAppState,
    _authVersion,
    sessionId,
    _pluginReconnectKey,
  ])

// 【卸载清理：先冲掉待写入的批，再清 timer】
//
//   顺序有讲究：1035-1039 行先 clearTimeout 再手动调用 flushPendingUpdates()。
//   不冲的话，最后 16ms 内到达的连接结果会永远丢失 ——
//   而「最后一个连上的服务器」恰恰是最可能落在窗口里的。
//
//   注意 clearTimeout 之后必须置 null：flushPendingUpdates 内部会检查
//   flushTimerRef.current 并置 null，直接调用它会自己管好这个状态。
//
//   1028 行把 ref 存进局部变量（const timers = ...current）：
//   cleanup 里用 timers.clear() 而不是 reconnectTimersRef.current.clear()，
//   避免「清理过程中 ref 被赋了新值」导致清错对象。
  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = reconnectTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      // Flush any pending batched MCP updates before unmount
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
        flushPendingUpdates()
      }
    }
  }, [flushPendingUpdates])

// 【为什么用 store.getState() 而不是闭包里的 clients】
//
//   这个函数是 hook 返回给组件的。如果它依赖 mcp.clients（订阅），
//   每次任何服务器状态变化它都会换一个新引用 ——
//   下游如果把它放进 useEffect 依赖，就会跟着重跑。
//
//   用 getState() 读当前值，deps 里只需要 store（永久稳定），
//   函数引用也永久稳定。
//
//   代价：调用时读到的是「最新」状态，不是「渲染时」的状态。
//   在这里是优点（重连要用最新的 config），在需要与渲染一致的地方则是 bug 来源。
//   **选择哪个，取决于这个函数在乎「此刻」还是「这一帧」。**
  // Expose reconnectMcpServer function for components to use.
  // Reads mcp.clients via store.getState() so this callback stays stable
  // across client state transitions (no need to re-create on every connect).
  const reconnectMcpServer = useCallback(
    async (serverName: string) => {
      const client = store
        .getState()
        .mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      // Cancel any pending automatic reconnection attempt
      const existingTimer = reconnectTimersRef.current.get(serverName)
      if (existingTimer) {
        clearTimeout(existingTimer)
        reconnectTimersRef.current.delete(serverName)
      }

      const result = await reconnectMcpServerImpl(serverName, client.config)

      onConnectionAttempt(result)

      // Don't throw, just let UI handle the client type in case the reconnect failed
      // (Detailed logs are within the reconnectMcpServerImpl via --debug)
      return result
    },
    [store, onConnectionAttempt],
  )

// 【toggleMcpServer 的两个分支，顺序都是契约的一部分】
//
//   禁用：写盘 → （若 connected）clearServerCache → updateServer(disabled)
//         写盘必须在最前，理由见 342 行那段 TODO：
//         clearServerCache 会触发 onclose，而 onclose 读磁盘判断要不要重连。
//         顺序反了 → onclose 看到「还是启用」→ 启动重连 → 用户以为禁用失败了。
//
//   启用：写盘 → updateServer(pending) → reconnectMcpServerImpl
//         写盘同样在最前，这样重连过程中再触发 onclose，读到的是「已启用」。
//
//   两个分支都要先删挂起的重连 timer：不删的话，启用后会有两轮重连同时进行。
  // Expose function to toggle server enabled/disabled state
  const toggleMcpServer = useCallback(
    async (serverName: string): Promise<void> => {
      const client = store
        .getState()
        .mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      const isCurrentlyDisabled = client.type === 'disabled'

      if (!isCurrentlyDisabled) {
        // Cancel any pending automatic reconnection attempt
        const existingTimer = reconnectTimersRef.current.get(serverName)
        if (existingTimer) {
          clearTimeout(existingTimer)
          reconnectTimersRef.current.delete(serverName)
        }

// 这条注释是 342 行那条契约的另一端。两处必须一起读：
//
//   「禁用」这个动作的真相源是**磁盘**，不是内存状态。
//   原因是 onclose 触发时内存状态必然滞后（更新还没提交），
//   唯一能读到「用户已经决定禁用」的地方就是配置文件。
//
//   于是顺序变成不可交换的：写盘 → 断连。
//   任何一次「先断连再写盘」的重构都会引入这个死循环。
        // Persist disabled state to disk FIRST before clearing cache
        // This is important because the onclose handler checks disk state
        setMcpServerEnabled(serverName, false)

        // Disabling: disconnect and clean up if currently connected
        if (client.type === 'connected') {
          await clearServerCache(serverName, client.config)
        }

        // Update to disabled state (tools/commands/resources auto-cleared)
        updateServer({
          name: serverName,
          type: 'disabled',
          config: client.config,
        })
      } else {
        // Enabling: persist enabled state to disk first
        setMcpServerEnabled(serverName, true)

        // Mark as pending and reconnect
        updateServer({
          name: serverName,
          type: 'pending',
          config: client.config,
        })

        // Reconnect the server
        const result = await reconnectMcpServerImpl(serverName, client.config)

        onConnectionAttempt(result)
      }
    },
    [store, updateServer, onConnectionAttempt],
  )

  return { reconnectMcpServer, toggleMcpServer }
}

// 只用于日志字符串。default 返回 SSE —— 这是历史默认值，
// 意味着将来新增的 transport 类型如果忘了加 case，日志里会显示成 SSE。
//
// 无害（只影响日志），但值得记一笔：**default 分支写「最常见的旧值」，
// 会让新类型的遗漏看起来像老类型的正常情况。** 写 default 时要想清楚
// 这里应该「容忍遗漏」还是「暴露遗漏」。
function getTransportDisplayName(type: string): string {
  switch (type) {
    case 'http':
      return 'HTTP'
    case 'ws':
    case 'ws-ide':
      return 'WebSocket'
    default:
      return 'SSE'
  }
}
