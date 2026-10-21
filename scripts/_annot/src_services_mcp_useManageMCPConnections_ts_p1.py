# -*- coding: utf-8 -*-
"""mcp/useManageMCPConnections.ts 批注 p1：批处理、连接事件、channel、list_changed（1-580）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
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
//   看到 useCallback 时不要问「这里需要优化吗」，要问「谁把它放进了 deps」。'''),

(21, 'before', '''// 【为什么这里用 require 而不是 import】
//
//   feature() 是编译期常量，打包器会把 false 分支整段删掉（DCE）。
//   但**静态 import 消除不掉** —— 模块图是静态的，import 一旦写出来，
//   那个模块就会进 bundle，和它被包在什么条件里无关。
//
//   条件 require 才能被一起消除：MCP_SKILLS 关掉时，mcpSkills.ts 整个模块
//   不会出现在产物里。代价是类型要靠 24 行的 `as typeof import(...)` 手工补，
//   于是满文件都是 `fetchMcpSkillsForClient!` 这样的非空断言。
//
//   这是「包体积 vs 类型安全」的一次明确取舍，不是偷懒。'''),

(87, 'before', '''// 【5 次重试，1 秒起步，30 秒封顶】
//
//   间隔序列：1s + 2s + 4s + 8s + 16s ≈ 31 秒。
//   这个量级对应的是「服务器重启/网络瞬断」，不是「服务挂了等人来修」。
//
//   封顶 30 秒的意义：很多 MCP 服务器是本地起的（stdio 之外的 http 代理），
//   重启只要几秒。间隔涨到几分钟后再重试，等于放弃。
//
//   为什么是 5 次而不是无限：无限重连会让一个配置错误的服务器
//   在后台永久打日志、永久占资源，而用户完全看不见（日志要 --debug）。'''),

(92, 'before', '''// 【去重键选的是「用户看到的错误的身份」】
//
//   type + source + plugin 三要素：同一类错误、同一个来源、同一个插件，就算同一条。
//   不带 message —— 因为 message 里常含时间戳、路径、端口号，
//   带上它去重就永远去不掉，同一个问题会堆出几十条。
//
//   反过来说，如果要让两条错误「分别显示」，就得让它们在这三个维度上不同。
//   去重键的设计决定了信息架构，不只是实现细节。'''),

(134, 'before', '''// 这段注释列的四件事是准确的，但漏了第五件：**它不做协议**。
//
//   连不上怎么办、401 之后怎么刷新、工具列表怎么取 —— 全在 client.ts。
//   这里只处理「事件来了之后，状态该怎么变」。
//   看到这个文件里出现 fetch / OAuth / 重试逻辑，就说明分层被破坏了。'''),

(147, 'before', '''// 【store 与 state 的区别决定 callback 能不能稳定】
//
//   useAppState(selector)  → 订阅某个字段，字段变了组件重渲染
//   useAppStateStore()     → 拿到 store 本体，getState() 随时读当前值，**不订阅**
//
//   下面 1046 行的 reconnectMcpServer 用 store.getState() 读 clients，
//   所以它的 deps 里不需要 mcp.clients —— callback 引用永久稳定。
//   如果改成 useAppState(s => s.mcp.clients)，那个 callback 每次连接状态变化
//   都会换一个新引用，返回给组件后下游的 memo/effect 全部失效。
//
//   规律：**要对外的 callback 里读状态，用 getState；要触发渲染的读，用 selector。**'''),

(148, 'after', '''// 【下划线前缀不是「私有」，是「不参与计算」】
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
//   也比事件订阅简单。代价是「为什么重连」这个信息只存在于注释里。'''),

(156, 'before', '''// 【可取消的退避等待，代价是一个故意泄漏的 promise】
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
//   1027 行的卸载清理只 clearTimeout 不 resolve，同样是有意为之。'''),

(162, 'before', '''// 【去重的键要选「用户看到的那条提示」，不是「事件」】
//
//   场景：用户看到「Channels require /login」→ 去登录 → 回来又撞上企业策略门。
//   这时应该出现**第二条不同的提示**。如果按服务器名去重，第二条就被吞了。
//
//   所以键是 kind（disabled / auth / policy / marketplace / allowlist），
//   一个 kind 只提醒一次。'''),

(203, 'before', '''// 【为什么是 16ms，而不是 queueMicrotask】
//
//   一次会话启动可能有 10 个服务器几乎同时连上，每个都要 setAppState。
//   React 18 的自动批处理只合并**同一个事件循环**内的更新；
//   而网络回调分散在不同 tick 到达（每个服务器的握手耗时不同），批不住。
//
//   queueMicrotask 在同一 tick 末尾就 flush，正好赶不上「网络 I/O 在不同时刻到达」
//   这个场景 —— 它解决的是「同 tick 内的多次更新」，这里的问题是「跨 tick」。
//
//   16ms ≈ 一帧。批处理窗口的粒度必须匹配事件的到达节奏：
//   窗口太短等于没批，太长会让界面明显滞后（用户点了工具列表，半秒后才刷新）。'''),

(216, 'before', '''// 【本文件最容易读错的一处：那个 `?? []` 到底改了什么】
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
//   想验证的话：把 `?? []` 改成 `?? undefined`，禁用服务器后它的工具会残留在模型上下文里。'''),

(245, 'before', '''// 【按名字前缀替换，因为 AppState 里的工具是扁平数组】
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
//   顺序不能反：先 concat 再 reject 会把新工具也删掉。'''),

(270, 'before', '''// resources 是唯一按服务器分组的（Record<serverName, Resource[]>），
// 因为它从来不会一次性全部塞进模型上下文 —— 是按需读取的。
//
// 272-277 行的写法值得注意：resources 为空时用 omit 删掉这个 key，
// 而不是存一个空数组。这样「没有资源」和「有 0 个资源」在状态里是同一种表示，
// 下游判空只需要一个 `if (!mcp.resources[name])`。'''),

(293, 'before', '''// 【这是 updateServer 的契约，也是这个文件最重要的一条隐式接口】
//
//   tools/commands/resources 三个字段都是「undefined = 保持原值」。
//   所以调用方无法用 undefined 表达「清空」—— 想清空必须同时把 type 设成
//   disabled 或 failed（走 232 行那个分支）。
//
//   这个契约的好处：连接状态更新（比如 pending → pending 带 reconnectAttempt）
//   不需要先把工具列表读出来再原样传回去，就不会出现「用旧快照覆盖新结果」的竞态。
//   坏处：想清空必须知道这个约定，否则会写出「明明设了空数组工具还在」的代码。'''),

(325, 'before', '''// 五种 client.type 里只有 connected 有副作用。
//
//   needs-auth 的处理不在这里 —— 它在 auth.ts（发起授权）和 UI 层（提示用户）。
//   pending 是「正在连」，本来就没有东西可挂。
//   这个 switch 写成「只处理 connected，其余 break」而不是每个分支都写点什么，
//   是因为**没有动作**本身就是一个明确的决定，值得让它一眼可见。'''),

(333, 'before', '''// 【状态机的转移动作放在 UI 层，不是 client.ts】
//
//   onclose 在这里被整个替换掉。client.ts 里那个默认实现只管「标记断开」，
//   而「要不要重连、重连期间显示什么、点禁用之后怎么停」
//   是产品决策，不是协议决策。
//
//   代价：client.ts 的人读不到这个回调的最终行为，只看得到它被赋了值。
//   读的时候必须意识到「这里的 onclose 已经被覆盖了」。'''),

(342, 'before', '''// 【这段 TODO 值得完整读：它承认了一个不优雅的设计，也说明了为什么】
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
//   两处注释互相指认，读的时候要连起来看。**顺序反了就是死循环。**'''),

(356, 'before', '''// 只有远程传输（http / ws / sse）才重连。
// stdio 是本地进程：进程死了说明命令本身有问题，重连只会一直失败；
// sdk 是内部通道（IDE 集成），生命周期由宿主控制。'''),

(371, 'before', '''// 【这个循环有两个出口，而且都必须在正确的时机把 timer 从 Map 里删掉】
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
//   UI 就能显示「第 3/5 次」。'''),

(456, 'before', '''// 【这是那个「故意泄漏的 promise」】
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
//   如果是在每次请求上泄漏，那就必须修。'''),

(465, 'before', '''// stdio / sdk 断开直接判 failed，不做任何重试。
// 注意这里没有 onConnectionAttempt(result)，因为根本没有 result ——
// 它是「不重试」这个决定本身。'''),

(470, 'before', '''// 【channel 是「服务器主动往对话里推消息」，门禁和连接是两件事】
//
//   472 行注释说清了：gate 只决定「要不要注册通知处理器」，
//   连接本身是否建立由 allowedMcpServers 控制。
//
//   所以会出现「连上了但收不到消息」这个状态 —— 这不是 bug，
//   是「企业允许你用这个服务器，但不允许它往你的对话里插话」。
//   两个权限维度分开，才能表达这种组合。'''),

(491, 'before', '''// capability 类的 skip 不进埋点。理由在 490 行：每一个非 channel 的
// MCP 服务器都会触发它（它们本来就没有 channel 能力），
// 打进埋点只会把真正的信号淹掉。
//
// 判据是「这条记录的分布是否由用户行为决定」——
// 如果 99% 的样本来自「服务器没有这个能力」这种正常情况，就不该记。'''),

(504, 'before', '''// register 时挂两个处理器，对应两个**独立的能力声明**：
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
//   不可能被误判成授权 —— 解析责任在声明了能力的服务器那边。'''),

(562, 'before', '''// 【skip 必须主动摘处理器，否则降级是单向的】
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
//   **只写打开不写关闭，等于假设状态只会单向变化。**'''),

(584, 'before', '''// 【弹 toast 的四个条件，每个都在排除一类噪音】
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
//   后者如果也写定制文案，就会把「哪个字段不匹配」这个关键信息丢掉。'''),

(616, 'before', '''// 【三个 list_changed 处理器共享同一套缓存失效纪律：先 delete 再 await】
//
//   fetchToolsForClient / fetchCommandsForClient / fetchResourcesForClient
//   都是 memoize 过的函数，带一个 .cache（Map）。
//   收到 list_changed 时**必须先让缓存失效**，否则 await 拿回来的是旧结果，
//   然后 updateServer 会把正确的旧值当成新值写进状态 —— 界面上什么都不变。
//
//   这看起来是显然的，但三个处理器里最容易漏的是 resources（716 行）：
//   它还会顺手清 prompts 缓存。理由见那一处。'''),

(627, 'before', '''// 【缓存里存的是 Promise，不是值】
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
//   两种样本的形状不同，下游分析时必须分开处理。'''),

(679, 'before', '''// prompts 变了要同时刷 skills，但**不能清 skills 的缓存**。
// 因为 skills 是从 resources 发现的，与 prompts 无关 ——
// 清了会触发一次不必要的网络请求，拿回同样的内容。
//
// fetchMcpSkillsForClient 会返回缓存结果，所以这里 await 它几乎无成本。'''),

(716, 'before', '''// 【本文件最隐蔽的一处：为什么 resources 处理器要清 prompts 缓存】
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
//   只清理「自己要用到的缓存」是不够的，还要清理「自己会写出去的缓存」。'''),
]
