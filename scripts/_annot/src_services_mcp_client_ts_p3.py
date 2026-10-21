# -*- coding: utf-8 -*-
"""client.ts 批注 p3：错误分级、信号升级清理、工具封装（MCP Tool → 内部 Tool）。"""

ANNOTATIONS = [
(1266, 'before', '''// ═══ 一个 if-else 链，把六种错误翻译成人话 ═══
//
// ECONNRESET     → 服务器可能崩了或重启了
// ETIMEDOUT      → 网络问题或服务器没响应
// ECONNREFUSED   → 服务器可能没起来
// EPIPE          → 服务器异常关闭了连接
// EHOSTUNREACH   → 网络不通
// ESRCH          → stdio 的进程没了
// "spawn"        → 命令没找到或没权限
//
// 这不是给用户看的，是给调试日志看的。但这些翻译有实际价值：
// 用户报「MCP 服务器连不上」时，日志里那句
// "Failed to spawn process - check command and permissions"
// 直接把排查方向指出来了，省掉一整轮问答。
//
// 附带记录 uptime（连接存活了多久）。这个数字在排查时很有用：
// 3 秒就断 vs 3 小时才断，是完全不同的两类问题。
// ═══'''),

(1313, 'before', '''// ═══ 会话过期走捷径：不等三振，直接 close ═══
//
// 逻辑链条：
//   404 + -32001 → 这个 session ID 服务器已经不认了
//   → 这个连接**永远**不可用了（不是「可能暂时断了」）
//   → 没必要等三次，立刻 close
//   → close 触发 onclose → 清缓存 → 下次调用重新建连拿新 session ID
//
// 注意 1325 行还调了 originalOnerror：
// 我们接管了 onerror，但不能**吞掉**原 handler。原 handler 负责
// SDK 内部的其他清理。所以每个提前 return 的分支都必须
// 「做完自己的事 + 把事件传下去」。
//
// 这个纪律在 1316-1365 这段里出现三次（1325、1344、1368）。
// 漏一次就会让 SDK 内部状态不一致。
// ═══'''),

(1373, 'before', '''// ═══ onclose：**五个**缓存要清 ═══
//
// 这是最容易被后来者改坏的地方。看清单：
//
//   fetchToolsForClient.cache      工具列表
//   fetchResourcesForClient.cache  资源列表
//   fetchCommandsForClient.cache   提示词/命令列表
//   fetchMcpSkillsForClient.cache  技能（feature 门后面）
//   connectToServer.cache          连接本身
//
// 为什么四个 fetch 缓存也要清（注释 1386 行解释）：
// 重连会造一个**新的**连接对象。但四个 fetch 缓存是按**服务器名**
// 做键的（不是按连接对象），所以不清的话下次 fetch 会
// 返回旧连接的工具列表 —— 而旧连接已经死了。
//
// 表现是什么？重连成功了，但工具调用打到旧 client 上，又失败一次。
// 用户看到「重连了但还是不行」，而日志里完全正常。
//
// 这个 bug 类型叫「按错误维度做键」：缓存键应该跟着**内容的生命周期**走，
// 而内容的生命周期是连接，不是服务器名。用名字做键是为了让重连后
// 能命中同一个缓存槽 —— 那就必须在重连时手动清。
// ═══'''),

(1404, 'before', '''// ═══ 清理函数：三级信号升级，总预算 500ms ═══
//
// 这段代码 160 行，全是为了一个目的：**让子进程死透**。
//
// 为什么必须手写（1427 行注释）：
//   StdioClientTransport.close() 只发一个 abort signal。
//   但很多 MCP 服务器（尤其 Docker 容器里的）不响应 abort，
//   它们要真正的 SIGINT/SIGTERM 才能优雅退出。
//   不手写的后果：每次退出 CLI 都留一堆僵尸进程。
//
// 升级序列：
//   SIGINT   → 等 100ms → 检查进程还在不在
//   SIGTERM  → 等 400ms → 再检查
//   SIGKILL  → 不等待
//
// 每一级都用 `process.kill(pid, 0)` 探测存活 —— 信号 0 不发信号，
// 只做权限和存在性检查，是 POSIX 的标准做法。
//
// 总预算 500ms 的理由写在注释里："to keep CLI responsive"。
// 用户按 Ctrl+C 之后，500ms 内必须回到提示符，否则感觉像卡住了。
//
// 另外还有两个 600ms 的 failsafe（1467 行、1542 行）：
// 无论发生什么，500-600ms 内一定 resolve。
// 这类「绝对兜底」在清理路径上很常见 —— 清理代码本身卡住
// 是最糟糕的失败模式，因为它会让整个进程无法退出。
// ═══'''),

(1572, 'before', '''// ═══ 注册到全局 cleanup，覆盖所有 transport ═══
//
// 注意注释强调的 "even network transports might need cleanup"：
// 直觉上只有 stdio 有子进程要杀，网络连接关了就行。
// 但实际上 HTTP/SSE 也有要清理的东西（在途请求、心跳定时器、
// 原生 socket 的 keep-alive 池）。
//
// wrappedCleanup 做的事很简单：先从全局注册表摘掉自己，再执行清理。
// 摘掉自己是为了避免重复执行 —— 进程退出时会遍历全局注册表，
// 如果这个 server 已经被单独关闭过，它的 cleanup 不该再跑一遍。
// ═══'''),

(1605, 'before', '''// ═══ 兜底的 catch：返回 failed 对象，**不抛** ═══
//
// 这是整个「错误即数据」设计的落地点。三个处理：
//   1. 埋点（带 transport 类型和各类服务器计数）
//   2. 日志（调试日志 + MCP 错误日志各一条）
//   3. 关掉可能存在的 inProcessServer（因为 1147 行那个只覆盖连接失败，
//      不覆盖分支里的同步抛错，比如 876 行的「没 claude.ai token」）
//
// 不抛的收益：getMcpToolsCommandsAndResources 里那个 pMap
// 不需要任何 try/catch 就能跑完 20 个服务器。一个坏服务器
// 只是产出 `{type:'failed'}`，不影响其他 19 个。
//
// 代价：所有消费方都必须先判 type。这个代价是实实在在的 ——
// 全文件里 type 检查出现了几十次，每次都是「万一它是 failed 呢」。
// 换来的收益是「局部失败不扩散」，在连接外部系统的场景里值得。
// ═══'''),

(1675, 'before', '''// ═══ 每次工具调用前都过一遍这个函数 ═══
//
// 逻辑很简单：调 connectToServer，如果拿到 connected 就返回，否则抛错。
//
// 但因为 connectToServer 是 memoize 的，正常路径**不产生任何 IO** ——
// 只是查一次缓存返回同一个对象。
//
// 真正的用途在**缓存被清掉之后**：onclose 清了缓存，
// 下一次调用这个函数就会真的重连。所以它是「透明重连」的实现点。
//
// sdk 类型直接原样返回（1692 行）：它们不进 connectToServer 的缓存，
// 由 setupSdkMcpClients 管理生命周期。
// ═══'''),

(1706, 'before', '''// ═══ 比较配置时排除 scope ═══
//
// scope 表示「这个配置从哪来的」：user / project / local / dynamic。
// 它是**元数据**，不影响连接行为 —— 同名同配置的服务器，
// 无论从全局配置还是项目配置来，连出来的东西是一样的。
//
// 所以比较时排除它。否则会出现：配置内容没变，但因为加载顺序变了
// scope 从 project 变成 local，判定为「配置变了，要重连」——
// 一次无意义的重连。
//
// 比较方式是 jsonStringify 后字符串相等（1717 行注释：这样能覆盖
// 所有配置变体）。代价是键顺序敏感（见 p1 对 getServerCacheKey 的说明），
// 但实际配置来源单一，顺序稳定。
// ═══'''),

(1724, 'before', '''// ═══ LRU 上限 20，键是服务器名 ═══
//
// 20 这个数字是「典型用户的 MCP 服务器数量」量级。
// 有上限是必需的：每缓存一个服务器的工具列表，就持有一整组
// Tool 对象（含 JSON schema、闭包）。不设限的话，长时间运行的会话
// 里切换配置会无限增长。
//
// 用名字而不是连接对象做键（1996 行）的理由和 onclose 要清缓存
// 是同一个：重连会造新对象，用对象做键就永远不命中。
// 用名字 + 手动清 = 「槽位稳定，内容同步」。
// ═══'''),

(1743, 'before', '''// ═══════════════════════════════════════════════════════════════
// 【这个函数是整个 MCP 系统的转换核心】
//
// 它做的事：调一次 tools/list，把 MCP 协议的工具描述
// 逐个转成内部的 Tool 对象。247 行代码，但几乎每一行都有理由。
//
// 转换后的 Tool 要满足 Tool 接口的全部契约（见第 4 步读的 Tool.ts）：
//   name / description / prompt / inputJSONSchema   → 给模型看的
//   isConcurrencySafe / isReadOnly / isDestructive  → 给权限和调度用的
//   checkPermissions / call                          → 执行
//   userFacingName                                   → 给用户看的
//
// 【一个反直觉的事实】
// MCP 工具的安全性判断全部来自**服务器自己的声明**：
//   1795 行 isConcurrencySafe → annotations.readOnlyHint
//   1798 行 isReadOnly        → annotations.readOnlyHint
//   1804 行 isDestructive     → annotations.destructiveHint
//   1807 行 isOpenWorld       → annotations.openWorldHint
//
// 这些是外部服务器在 tools/list 响应里自己填的。一个恶意的（或
// 只是写错的）MCP 服务器只要声明 readOnlyHint: true，
// 它的工具就会被判定为「只读、可并发、非破坏性」——
// 于是可能被并发执行、可能不需要用户确认。
//
// 所以 MCP 工具（mcp__ 前缀）在权限系统里有单独的规则
// （1814 行的 checkPermissions 返回 passthrough，意思是
// 「交给上层规则系统判，这里不做判断」）。
// ═══════════════════════════════════════════════════════════════'''),

(1760, 'before', '''// ═══ skip-prefix 模式：让 SDK 的 MCP 工具能**覆盖**内建工具 ═══
//
// 正常情况工具名是 `mcp__<server>__<tool>`（buildMcpToolName）。
// 但 SDK 场景下可以设 CLAUDE_AGENT_SDK_MCP_NO_PREFIX，去掉前缀，
// 于是 MCP 工具可以用和内建工具一样的名字 —— 也就是**覆盖**它。
//
// 用途：Agent SDK 的使用者想替换掉某个内建工具的实现（比如
// 自己实现一套 Read，接内部的文件系统）。
//
// 注意 mcpInfo 仍然保留原名（1774 行）。所以：
//   name    = 模型看到的、用来调用的名字（可能不带前缀）
//   mcpInfo = 权限检查用的真实来源（serverName + toolName）
//
// 这两个字段分开，是因为「模型怎么称呼它」和「权限系统怎么识别它」
// 是两个不同的问题。
// ═══'''),

(1776, 'before', '''// ═══ 一个换行符能造成 prompt 注入 ═══
//
// searchHint 来自 tool._meta['anthropic/searchHint'] —— 这是
// **外部 MCP 服务器完全可控**的字段。
//
// 为什么要先把所有连续空白压成单个空格：
// 这个 hint 最终会进「延迟工具列表」，而那个列表是**按换行符拼接**的
// （注释点名 formatDeferredToolLine 里 join 的用法）。
//
// 所以一个 hint 里只要带一个换行，就能凭空多出几行工具描述 ——
// 模型会把它当成真的工具条目读。恶意服务器可以用这招往
// 系统提示词里塞任意内容。
//
// 这叫「结构性注入」：不是转义问题，是**用数据去伪造结构**。
// 同一类风险在 tool description、server instructions、
// 甚至工具返回值里都存在（后者靠的是返回值包装成 content block 来隔离）。
//
// 后面 `.trim() || undefined` 也是同一目的：全是空白就当没提供，
// 避免造出空行。
// ═══'''),

(1795, 'before', '''// ═══ 三个安全属性，全部来自服务器的自称 ═══
//
// isConcurrencySafe  → 并发调用安全吗（能不能和别的工具同时跑）
// isReadOnly         → 只读吗（影响权限弹窗的默认值）
// isDestructive      → 有破坏性吗（影响是否必须确认）
// isOpenWorld        → 会访问外部世界吗（影响是否要额外的网络提示）
//
// 四个都读 tool.annotations，也就是 MCP 服务器在 tools/list 里
// 自己声明的 hint。规范里这些都是 hint（提示），不是保证。
//
// 设计上的取舍：
//   信任 → 好用的服务器能获得流畅体验（只读工具自动放行、并发执行）
//   不信任 → 所有 MCP 工具都要确认，可用性崩塌
//
// 折中方案在权限层：MCP 工具走 passthrough（1816 行），
// 由用户配置的规则决定（`mcp__server__tool` 形式的 allow 规则）。
// 也就是说这些 hint 影响的是**调度**（能不能并发），
// 而**授权**另有独立机制。
// ═══'''),

(1814, 'before', '''// ═══ passthrough = 「不在这里做决定」═══
//
// 返回 behavior: 'passthrough' 的意思是：这个工具的权限不由自己判断，
// 交回上层的规则系统（allow/deny 规则、用户配置、交互式询问）。
//
// 为什么 MCP 工具要这样：因为服务器是外部提供的，我们无法推断
// 它的行为。一个叫 "read_file" 的 MCP 工具可能在删你的文件。
// 只有用户显式配置的规则才算数。
//
// 但这里同时给了一条**建议**（suggestions）：如果用户决定允许，
// 就把 `mcp__server__tool` 这条规则写进 localSettings。
// 也就是说「一次允许 = 永久允许这个具体工具」，
// 而不是允许整个服务器。
//
// 注意 ruleContent: undefined —— 意味着不限定参数内容，
// 这个工具的所有调用都放行。粒度只能到工具级，不能到参数级
// （因为 MCP 工具的 schema 是任意的，没法通用地描述「哪些参数值危险」）。
// ═══'''),

(1833, 'before', '''// ═══ call()：每次工具调用都从这里进 ═══
//
// 五段：
//   ① 从父消息里抠 toolUseId（用于进度上报和 _meta 透传）
//   ② 发一个 'started' 进度事件
//   ③ 重试循环（session 过期时重试一次）
//   ④ 成功后发 'completed'，失败发 'failed'
//   ⑤ 错误分类包装（见 1937 行）
//
// 注意 1843 行的 meta：`{ 'claudecode/toolUseId': toolUseId }`。
// 这是把自己的 tool_use_id 传给 MCP 服务器 —— 服务器如果支持
// 回传 _meta，就能把自己的内部追踪 id 和我们的 tool_use_id 关联起来。
// 用于跨系统的链路追踪。
//
// 进度事件的设计（1846、1884、1925 三处）：每个都带 toolUseID，
// 因为上层要按 id 把进度路由到对应的 UI 元素。没有 id 就无法渲染。
// ═══'''),

(1858, 'before', '''// ═══ 只重试一次，且只重试一种错误 ═══
//
// MAX_SESSION_RETRIES = 1，判断条件是 `error instanceof McpSessionExpiredError`。
//
// 为什么只有这种错误值得重试：它是**唯一**一种「换个 client 就能成功」
// 的失败。其他错误（工具超时、参数不对、服务器内部错误、用户中断）
// 换个连接再试一遍只会得到同样的结果，还白白多花一次时间。
//
// 会话过期重试能成立的前提：callMCPTool 在抛 McpSessionExpiredError
// 之前已经调了 clearServerCache（3229 行）。所以下一轮
// ensureConnectedClient 会真的重建连接，而不是拿到同一个死连接。
//
// 这两个函数之间的隐式契约 ——「抛这个错误意味着缓存已清」——
// 是这段代码正确性的关键。如果没有清缓存，重试是纯浪费。
// ═══'''),

(1937, 'before', '''// ═══ 为什么要重新包装错误，而不是原样抛 ═══
//
// 注释说的直接原因："so telemetry gets useful context instead of
// just 'Error' or 'McpError' (the constructor name)"。
//
// 埋点系统记录的通常是 error.constructor.name。而 MCP SDK 抛的
// 是裸 Error 或 McpError —— 埋点里全是 "Error"，完全没法分类。
//
// 处理方式：
//   裸 Error   → 包成 TelemetrySafeError(message, message.slice(0,200))
//   McpError   → 包成 TelemetrySafeError(message, `McpError ${code}`)
//   已经是安全的 → 不动
//
// 第二个参数是**埋点用的消息**，第一个是给人看的。分开的理由：
// 埋点要短、要能聚合（`McpError -32000` 可以按错误码统计），
// 而人看的消息要完整。
//
// 注释里那句 "MCP SDK errors are protocol-level messages and don't
// contain user file paths or code" 是**担保**：这条消息不可能是
// 用户代码或路径，所以可以不做路径擦除直接进埋点。
// 这就是那个长后缀 _I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 的含义。
//
// 顺带：3204 行抛的 McpAuthError、3230 行抛的 McpSessionExpiredError
// 没有被包装，因为它们本来就是有类型的、可分类的。
// ═══'''),

(1977, 'before', '''// ═══ 两种特殊服务器的工具覆盖 ═══
//
// 这里的 spread 语法 `...(条件 ? 覆盖对象 : {})` 是个干净的模式：
// 条件不满足时展开空对象，等于没覆盖。
//
// Claude-in-Chrome：只是包一层 UI 渲染（getClaudeInChromeMCPToolOverrides），
// 执行逻辑不变。
//
// Computer Use：这里就是前面 930 行注释说的「真正的执行入口」——
// wrapper.tsx 的 .call() 覆盖。所以这个 MCP 服务器的 tools/list 只起到
// 「让模型知道有哪些工具」的作用，实际调用被本地接管。
//
// 两个条件都检查 `config.type === 'stdio' || !config.type`：
// 因为这些服务器只以本地进程形式存在，远程的不该有这些覆盖。
// ═══'''),
]
