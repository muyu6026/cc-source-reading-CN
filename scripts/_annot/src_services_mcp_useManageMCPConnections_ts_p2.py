# -*- coding: utf-8 -*-
"""mcp/useManageMCPConnections.ts 批注 p2：两个加载 effect、stale 清理、手动重连（580-1141）。"""

ANNOTATIONS = [
(755, 'before', '''// 剩下四种状态没有副作用，但每一种都在别处有主：
//   needs-auth → auth.ts 发起授权，UI 层提示用户
//   failed     → 用户点重连（1046 行），或下一次 effect 重跑时重新标 pending
//   pending    → 正在连，无事可做
//   disabled   → 用户的选择，读磁盘的 isMcpServerDisabled 是真相源
//
// 这里显式列出四个 case 而不是写 default，是为了让「以后新增一种 type」时
// 编译器（或 review）能强制你想一遍它在哪处理。'''),

(765, 'before', '''// 【第一个 effect 的职责被严格限制在「标状态」，它不连接】
//
//   为什么要有这一步：UI 的首帧不应该等网络。
//   先把配置里出现、但状态里还没有的服务器标成 pending/disabled，
//   侧边栏立刻就能显示「有 5 个 MCP 服务器，正在连接」。
//   真正连接在 858 行那个 effect 里，慢的话也只是状态标签多转几秒。
//
//   这个 effect 和下一个 effect 都会调 getClaudeCodeMcpConfigs（读两遍配置），
//   790 行的注释解释了为什么：在「标 pending」这条路径上等 claude.ai 的
//   网络请求，会让首帧卡住 —— 而 claude.ai 的 dedup 只在真正连接时才需要。'''),

(782, 'before', '''// 【这段是全文最有价值的三条 hazard 注释：异步清理动作本身有副作用】
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
//   凡是要停掉一个异步流程，都得先想清楚「停它」这件事会不会触发别的流程。'''),

(802, 'before', '''// 三步的顺序不能换：
//   删 timer（停止未来）→ 摘 onclose（停止现在可能触发的）→ 清缓存（真正断开）
//
//   反过来先清缓存：断开 → 触发 onclose → 它启动重连 → 你再去删 timer，
//   此时 timer 已经被新一轮重连的循环重新写进 Map 了。'''),

(808, 'before', '''// 只对 connected 调 clearServerCache，理由见 798-801 行。
// 这里的 `.catch(() => {})` 不是偷懒：清理失败不该阻塞后面的状态更新，
// 而且失败的服务器在下一轮会被重新标成 pending 重试。'''),

(856, 'before', '''// 【第二个 effect：真正加载配置并连接，分两阶段】
//
//   Phase 1：Claude Code 自己的配置（本地文件 + 插件，快）
//   Phase 2：claude.ai 的连接器（网络请求，可能慢，可能要登录）
//
//   关键设计（867 行）：claude.ai 的请求在 Phase 1 **之前**就发出去，
//   但只在 Phase 2 才 await。于是它和 Phase 1 里的 loadAllPlugins()
//   并行执行，整个流程的时间是 max(本地, 网络) 而不是 本地 + 网络。
//
//   这是「提前发起、延后等待」（promise hoisting）的标准用法：
//   把一个 await 拆成「开始」和「等结果」两个时刻。'''),

(861, 'before', '''// 【cancelled 标志只能挡住「继续往下走」，挡不住已经发出的请求】
//
//   882、910 行各检查一次，都在 await 之后。
//   所以 effect 重跑时，上一轮的网络请求会继续跑完，只是结果被丢弃。
//
//   为什么不用 AbortController：这里要取消的不是请求，是「后续阶段的许可」。
//   而且 getMcpToolsCommandsAndResources 一旦启动就取消不了（它内部有自己的
//   多服务器并发），强行包信号会把这个函数变复杂，收益只有几次无用的网络往返。
//
//   代价要说清楚：**快速切换会话时，上一轮的 claude.ai 请求仍会消耗一次配额。**'''),

(867, 'before', '''// 【企业策略或 strict 模式下，claude.ai 那条线整体关掉】
//
//   doesEnterpriseMcpConfigExist 为真 → 直接给一个已 resolve 的空对象，
//   连 clearClaudeAIMcpConfigsCache 都不调。
//   这不是省一次网络请求，是**企业部署里不应该向 claude.ai 发任何请求**（隐私边界）。
//
//   注意它是 fail-open 的（config.ts 里那段）：检测企业配置本身可能失败，
//   失败时按「不存在」处理 —— 宁可多走一次网络，也不要因为一个读配置文件
//   的错误把所有人的 MCP 全部禁掉。'''),

(875, 'before', '''// Phase 1 里传入 claudeaiPromise 是为了让 getClaudeCodeMcpConfigs
// 能提前知道 claude.ai 那边有哪些服务器，从而**抑制重复的插件服务器**。
//
//   不抑制的后果：同一个 Slack 连接器既作为插件出现、又作为 claude.ai
//   连接器出现，两个都会去连 —— 用户看到两个同名工具，
//   模型也会看到两份 schema（多花 token，还可能选错）。'''),

(889, 'before', '''// 注意这里**没有 await**：连接是并发进行的，Phase 2 的 await 在它跑的同时执行。
// 如果这里 await，整个流程就是「等所有 Claude Code 服务器连完 → 再取 claude.ai 配置」，
// 慢的服务器会拖住快的。
//
// 连接结果通过 onConnectionAttempt 回调逐台回流，UI 就能一台一台亮起来。'''),

(912, 'before', '''// 【按内容去重，因为 key 永远不会撞】
//
//   手动配置的 key 是用户起的名字（slack），claude.ai 连接器的 key 是
//   claude.ai Slack —— 两者不同，915 行的合并根本不会触发覆盖。
//   所以必须比 URL 签名（dedupClaudeAiMcpServers 内部做的事）。
//
//   这类问题的通用形态：**当两个来源的命名空间独立时，合并操作看起来安全，
//   实际上是「同一个东西进来两次」。** 去重键必须建立在语义上（URL），不能建立在名字上。'''),

(923, 'before', '''// 先塞 pending 再连接，和 765 行那个 effect 的理由相同：
// 让 UI 立刻出现这一批服务器，而不是等握手完成才「突然冒出来」。
//
// 顺序很重要：先 setAppState（pending）→ 再 getMcpToolsCommandsAndResources。
// 反过来的话，连接极快时可能出现「connected 先写入、pending 后写入」，
// 最终状态停在 pending 上，界面一直转圈。'''),

(947, 'before', '''// 两个阶段各过滤一次 disabled，看起来重复，但两次的 configs 不是同一份：
// Phase 1 是 claudeCodeConfigs + dynamicMcpConfig，Phase 2 是 claudeaiConfigs。
//
// 不合并成一次过滤的原因：两阶段的连接是独立发起的，
// 各自的入参必须是干净的 —— 否则 getMcpToolsCommandsAndResources
// 会为 disabled 的服务器创建连接对象（虽然不 spawn，但会占一个状态槽位）。'''),

(966, 'before', '''// 【埋点的桶比 scope 少一个，而且名字对不上】
//
//   scope 有六种：enterprise / user / project / local / dynamic / claudeai
//   桶只有五个：enterprise / global / project / user / plugin（+ claudeai）
//
//   映射关系：user → global，local → user，dynamic → plugin。
//   也就是「字段名 global 里装的是 scope=user 的数量」。
//
//   这不是 bug，是产品口径：「从用户视角看，user 和 local 都是我这个人的配置」。
//   但读埋点数据的人如果按字段名理解，会得出完全错误的结论 ——
//   这类「历史命名 vs 当前语义」的错位，是数据分析里最常见的坑。'''),

(976, 'before', '''// 只在内部构建（USER_TYPE=ant）里收集 stdio 命令的 basename。
//
// 目的（977-978 行）：把「哪些本地服务器在跑」和「会话卡不卡」关联起来。
// rust-analyzer 这类服务器的 RSS 能到几个 G，出一份 CPU/内存 profile 时
// 必须知道当时有哪些重进程在跑。
//
// 只发 basename 不发完整路径：路径里可能带用户名、项目名（敏感信息），
// 而 basename（rust-analyzer / tsserver）已经足够定位问题。'''),

(997, 'before', '''// 一条埋点带完所有口径：五个桶的服务器数量 + （内部构建时）stdio 命令清单。
// 注意 stdio_commands 拼成逗号分隔的字符串而不是数组 ——
// 埋点系统对嵌套结构的处理不一致，扁平字符串最稳。'''),

(1013, 'before', '''// cleanup 只置 cancelled。这里**不做**断开连接 ——
// 那是卸载时（1027 行）该做的事。effect 重跑（换会话、/reload-plugins）
// 时，已连上的服务器应该继续活着，下一条 effect 会把它们标成 pending 再处理。'''),

(1026, 'before', '''// 【卸载清理：先冲掉待写入的批，再清 timer】
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
//   避免「清理过程中 ref 被赋了新值」导致清错对象。'''),

(1043, 'before', '''// 【为什么用 store.getState() 而不是闭包里的 clients】
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
//   **选择哪个，取决于这个函数在乎「此刻」还是「这一帧」。**'''),

(1073, 'before', '''// 【toggleMcpServer 的两个分支，顺序都是契约的一部分】
//
//   禁用：写盘 → （若 connected）clearServerCache → updateServer(disabled)
//         写盘必须在最前，理由见 342 行那段 TODO：
//         clearServerCache 会触发 onclose，而 onclose 读磁盘判断要不要重连。
//         顺序反了 → onclose 看到「还是启用」→ 启动重连 → 用户以为禁用失败了。
//
//   启用：写盘 → updateServer(pending) → reconnectMcpServerImpl
//         写盘同样在最前，这样重连过程中再触发 onclose，读到的是「已启用」。
//
//   两个分支都要先删挂起的重连 timer：不删的话，启用后会有两轮重连同时进行。'''),

(1093, 'before', '''// 这条注释是 342 行那条契约的另一端。两处必须一起读：
//
//   「禁用」这个动作的真相源是**磁盘**，不是内存状态。
//   原因是 onclose 触发时内存状态必然滞后（更新还没提交），
//   唯一能读到「用户已经决定禁用」的地方就是配置文件。
//
//   于是顺序变成不可交换的：写盘 → 断连。
//   任何一次「先断连再写盘」的重构都会引入这个死循环。'''),

(1131, 'before', '''// 只用于日志字符串。default 返回 SSE —— 这是历史默认值，
// 意味着将来新增的 transport 类型如果忘了加 case，日志里会显示成 SSE。
//
// 无害（只影响日志），但值得记一笔：**default 分支写「最常见的旧值」，
// 会让新类型的遗漏看起来像老类型的正常情况。** 写 default 时要想清楚
// 这里应该「容忍遗漏」还是「暴露遗漏」。'''),
]
