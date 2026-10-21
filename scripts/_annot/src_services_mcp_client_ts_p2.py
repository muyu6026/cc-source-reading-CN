# -*- coding: utf-8 -*-
"""client.ts 批注 p2：connectToServer 的七种 transport、连接超时、onerror 桥接。"""

ANNOTATIONS = [
(612, 'before', '''// ═══ 1,046 行的一条 try，七个 transport 分支，一个统一的收尾 ═══
//
// 结构是：
//
//   try {
//     ① 七个 if-else 分支 → 每种 transport 造出 transport 对象
//        （sse / sse-ide / ws-ide / ws / http / claudeai-proxy /
//          Chrome 进程内 / ComputerUse 进程内 / stdio）
//     ② 通用：包 stderr 日志、造 Client、注册 ListRoots / Elicitation handler
//     ③ 通用：Promise.race 连接 + 连接超时
//     ④ 通用：分 transport 记录失败（401 → needs-auth）
//     ⑤ 通用：桥接 SDK 的 onerror/onclose，接管重连
//     ⑥ 通用：清理函数（子进程信号升级 + 注册到全局 cleanup）
//     ⑦ 返回 connected 对象
//   } catch {
//     埋点 + 清理 + 返回 failed 对象（不抛）
//   }
//
// 注意 inProcessServer 这个变量在 try 外面声明（609 行）：
// 因为 catch 块也要能关掉它（1629 行）。这是「跨 try/catch 存活」的典型
// 写法 —— 和 claude.ts 里那些必须在 finally 里被读到的变量同一个道理。
// ═══'''),

(619, 'before', '''// ═══ SSE 分支：两个 fetch，两个完全不同的目的 ═══
//
// transportOptions.fetch（632 行）—— 用于**发消息**（POST）。
//   包了两层：
//     wrapFetchWithStepUpDetection(...)  内层，先看 403
//     wrapFetchWithTimeout(...)          外层，每次请求新超时
//   顺序不能反。注释说明了原因：step-up 检测要在**最内层**，
//   这样 403 能在 SDK 的 auth() → tokens() 处理器之前被看到。
//   （step-up = 服务器要求提升权限范围，需要先识别出来再走 OAuth 升级。）
//
// transportOptions.eventSourceInit.fetch（648 行）—— 用于**收事件**（长连 GET）。
//   **绝对不能**包超时。注释用了 IMPORTANT 开头：
//   EventSource 连接设计上就是无限期开着的，加 60 秒超时就是每 60 秒杀一次。
//
// 同一个 transport 里，一个 fetch 要超时、一个不要。这是 MCP 的 SSE
// 协议形状决定的，不是我们能选的。
//
// 另外 667 行的 header 顺序也是刻意的：...init?.headers 在 ...combinedHeaders
// 之前，意思是**用户配置的 header 能覆盖**调用方传的；而 Accept 放最后，
// 意思是没人能覆盖它（EventSource 必须是 text/event-stream）。
// ═══'''),

(678, 'before', '''// ═══ sse-ide：IDE 插件，不需要认证 ═══
//
// 和上面的 sse 比，这个分支少了 authProvider、少了 combinedHeaders、
// 少了 User-Agent 之外的一切。因为 IDE 服务器是本机插件起的，
// 通信走 loopback，认证靠进程边界就够了。
//
// 有个 TODO 留在注释里："Use the auth token provided in the lockfile"
// —— 说明未来可能加一层，防止别的进程冒充。
//
// 注意 704 行那个 `Object.keys(transportOptions).length > 0 ? ... : undefined`：
// 没配代理时传 undefined 而不是 {}。因为 SDK 对 undefined 和 {} 的处理不同
// （{} 可能会覆盖掉它自己的默认值）。
// ═══'''),

(708, 'before', '''// ═══ ws-ide / ws：同一套 WebSocket 两种运行时 ═══
//
// 718 行 `typeof Bun !== 'undefined'` 是个真实的运行时分支：
//
//   Bun  → 用 globalThis.WebSocket，支持 headers/proxy/tls 选项，
//          但 DOM 类型定义不认识这些选项，所以要 cast 成 string[]
//   Node → 用 ws 包的 3 参构造函数（见 createNodeWsClient）
//
// 两条路的选项名还不一样：
//   Bun:  proxy: url, tls: options
//   Node: agent: proxyAgent, ...tlsOptions（展开合并）
//
// 753 行那个「打日志前擦掉 Authorization」也值得注意。
// 这是埋点卫生的一部分：同一个对象在内存里带凭据，进日志时必须是
// [REDACTED]。写法是 mapValues + key.toLowerCase() 判断 —— 小写化是必须的，
// HTTP header 名大小写不敏感，但 JS 对象键是敏感的。
// ═══'''),

(784, 'before', '''// ═══ HTTP 分支：调试日志密度最高的一段 ═══
//
// 786-799 行先把 Node 版本、平台、NODE_OPTIONS、线程池大小、
// 三个代理环境变量全打进日志。为什么这么啰嗦？
// 因为 HTTP transport 的失败往往和这些环境因素有关，
// 而用户报 bug 时不会想到提供它们。先记下来，省一轮来回。
//
// 807 行那个检查是全分支最关键的一行，注释解释了原因：
//
//   SDK 合并 requestInit 的时机在 authProvider **之后**。
//   意思是：如果服务器存了 OAuth token，authProvider 会设好 Authorization，
//   然后我们的 requestInit.headers 会**覆盖**它。
//
//   所以如果有 OAuth token，就绝不能再塞 sessionIngressToken ——
//   否则会把正确的 OAuth 凭据踩掉，让一个本来能连的服务器变成 401。
//
//   CCR 代理 URL（ccr_shttp_mcp）没有存 OAuth，所以它们仍然该拿到
//   ingress token。
//
// 注释还引了 PR 编号（#24454讨论）。这类「合并顺序决定正确性」的坑
// 在包装第三方 SDK 时非常常见 —— 判断依据不是文档，是**它内部的合并顺序**。
// ═══'''),

(866, 'before', '''// ═══ SDK 类型的服务器在这里直接抛错，因为不归这个文件管 ═══
//
// 'sdk' 指的是「跑在同一个进程里、由 Agent SDK 自己管理的 MCP 服务器」。
// 它们不走 connectToServer，而是走文件末尾的 setupSdkMcpClients（3262 行）。
//
// 抛错的措辞直接点名了负责的模块："SDK servers should be handled in print.ts"。
// 这种「明确指路」的错误消息，比"Unsupported type"有用得多。
// ═══'''),

(868, 'before', '''// ═══ claudeai-proxy：连的是 Anthropic 的代理，不是用户的服务器 ═══
//
// 这类服务器是 claude.ai 网页上配置的「连接器」，本地 CLI 通过
// Anthropic 的代理去访问。所以：
//   · URL 是拼出来的：MCP_PROXY_URL + 模板路径（替换 server_id）
//   · 认证是 claude.ai 的 OAuth token，不是服务器自己的
//   · 走 createClaudeAiProxyFetch（带 401 重试）
//   · 多一个 X-Mcp-Client-Session-Id header（让代理能关联到会话）
//
// 874 行 `if (!tokens) throw` —— 这里是唯一一个「没 token 就直接抛」的地方。
// 因为代理连接必须有 claude.ai 登录，这不是「需要授权」而是
// 「你压根没登录」，属于配置错误。
// ═══'''),

(905, 'before', '''// ═══ 进程内运行，省掉一个 325MB 的子进程 ═══
//
// Chrome MCP 服务器正常做法是 spawn 一个子进程。这里改成在同进程里跑：
//
//   createChromeContext(env)            造服务器端的上下文
//   createClaudeForChromeMcpServer(ctx) 造 MCP 服务器实例
//   createLinkedTransportPair()         造一对**互相连着**的 transport
//   inProcessServer.connect(serverT)    服务器端接上
//   transport = clientTransport         客户端用另一头
//
// 这就是 MCP 传输层抽象的价值：从客户端的角度看，进程内和跨进程
// 完全一样，因为它只看到 transport 接口（send/close/onmessage）。
// InProcessTransport.ts 只有 63 行，实现的就是一对内存里的双工管道。
//
// 代价：inProcessServer 需要单独 close（1406 行），
// 而且它在 try 外声明（609 行）以便 catch 块也能关。
// ═══'''),

(925, 'before', '''// ═══ 同样的进程内方案，但外面套了 feature 门 ═══
//
// 注释里有个关键信息："The package's CallTool handler is a stub;
// real dispatch goes through wrapper.tsx's .call() override."
//
// 也就是说这个 MCP 服务器里的 CallTool 实现是**空的**。
// 真正的工具执行走 wrapper.tsx 里覆盖的 .call()（1986 行的
// getComputerUseMCPToolOverrides 就是它的一部分）。
//
// 为什么要这么绕：Computer Use 需要原生模块访问屏幕和输入设备，
// 而原生模块不能跨进程传。所以「MCP 协议」在这里只起到**工具发现**
// 的作用（让模型知道有哪些工具、schema 是什么），执行完全在本地接管。
// ═══'''),

(944, 'before', '''// ═══ stdio：最常见的一种，也是坑最多的一种 ═══
//
// 947 行 CLAUDE_CODE_SHELL_PREFIX 的处理很有意思：
//
//   没有前缀 → command 和 args 分开传（正常 execve）
//   有前缀   → 把 [command, ...args].join(' ') 变成**一个字符串**，
//              整条交给前缀去执行
//
// 用途：让用户可以用 `npx`、`docker run`、`sandbox-exec` 这类
// 包装器统一拦截所有 MCP 服务器（做沙箱、做审计）。
// 但这样一来参数就不能分开了 —— 因为包装器拿到的是字符串。
//
// 957 行 `stderr: 'pipe'` 的注释说明目的：防止 MCP 服务器往 stderr
// 写的东西直接打到 UI 上（那会把 Ink 渲染出来的终端界面撕烂）。
// 接到管道里之后，由 971 行的 handler 累积、失败时一次性打进调试日志。
// ═══'''),

(963, 'before', '''// ═══ 在 connect 之前就挂 stderr 监听，因为连接期最容易出错 ═══
//
// 注释说得很清楚：连接启动期间就可能已经有 stderr 输出，
// 而那正是最需要看的时候（连不上时服务器通常会往 stderr 喷错误）。
//
// 两个纪律：
//   1. 64MB 上限（973 行）。不加会无界增长 —— 一个死循环往 stderr
//      写日志的服务器能把内存吃光。
//   2. handler 引用要留着（966 行），cleanup 时 off 掉（1423 行）。
//      不 unref 的话，transport 被回收了、监听器还挂在 stream 上，内存泄漏。
//
// 注意 try/catch 包的是 `stderrOutput += data.toString()`：
// 字符串超过 V8 上限（约 512MB）会抛错。上限 64MB 让这个 catch
// 实际上几乎不会触发，但留着是对的 —— 成本是一对括号。
// ═══'''),

(985, 'before', '''// ═══ 声明能力时用空对象，是一个兼容性妥协 ═══
//
// 994-1000 行声明两个能力：roots 和 elicitation。
// 注意它们都是 `{}`，注释解释了为什么不能写得更"详细"：
//
//   写 { form: {}, url: {} } 会让 Java 的 MCP SDK 服务器崩掉。
//   原因：Spring AI 的 Elicitation 类零字段，反序列化遇到未知属性就失败。
//
// 于是「按 spec 应该能写」的形状，在具体实现上会炸。
// 所以只能声明能力存在（空对象 = 我支持这个能力），不声明细节。
//
// 这是接生态时的常态：spec 是下限，实现是现实。
// 同类问题在 MCP 生态里还有不少（不同语言 SDK 的 schema 严格程度不同）。
// ═══'''),

(1009, 'before', '''// ═══ roots：告诉服务器「你能访问哪里」═══
//
// MCP 的 roots 概念 = 客户端声明的工作区边界。服务器可以问客户端
// 「你的根目录在哪」，然后在自己的实现里据此限制文件访问。
//
// 这里直接返回原始工作目录（getOriginalCwd，注意不是当前 cwd ——
// 用户可能 cd 到别处，但根是启动时的那个）。
//
// 它是个 handler 而不是配置项，因为协议允许服务器**随时**问
// （工作区可能变）。这里每次返回同一个值，是最简实现。
// ═══'''),

(1020, 'before', '''// ═══ 连接超时用 Promise.race + 手动清理，三个细节 ═══
//
// ① 超时后必须**主动关 transport**（1059 行）。
//    race 只是丢弃了 connectPromise，它并没有被取消，底层连接还在建。
//    不关的话就是泄漏：连接最后可能成功，但没人持有它。
//
// ② connectPromise.then(clearTimeout, clearTimeout)（1069 行）。
//    两个回调写成一样，看着冗余，其实是必要的：
//    Promise 的 .then 只处理成功，.catch 只处理失败，
//    要同时处理两者就得传两个参数。写在 then 里比
//    `.finally()` 更早（finally 要等 promise 链下一拍）。
//
// ③ 超时错误用 TelemetrySafeError 包装，消息里带服务器名和配置值。
//    因为连接超时是用户最常报的问题之一，日志得能直接看出
//    「是哪个服务器、等了多久」。
//
// DEFAULT 是 30 秒（456 行 getConnectionTimeoutMs），可用 MCP_TIMEOUT 覆盖。
// 注意它和工具调用超时（约 27.8 小时）差了三个数量级 —— 这不是笔误：
// **连接**该快，**执行**不该限时。
// ═══'''),

(1157, 'before', '''// ═══ instructions 也截断到 2048 字符 ═══
//
// MCP 服务器可以在握手时返回一段 instructions，客户端通常会把它
// 拼进系统提示词。问题：有些服务器（尤其 OpenAPI 自动生成的那些）
// 会塞十几到几十 KB 的端点文档进去。
//
// 2048 这个上限同时用在两处：
//   · 这里的 instructions
//   · fetchToolsForClient 里每个工具的 description（1791 行）
//
// 注释说这个值「caps the p95 tail without losing the intent」——
// 按分位数定的，不是按最大值。
// ═══'''),

(1188, 'before', '''// ═══ 默认 elicitation handler 返回 cancel，覆盖一个时间窗口 ═══
//
// 时序问题：连接建立之后、真正注册 elicitation handler 之前，
// 有一段窗口期（在 useManageMCPConnections 的 onConnectionAttempt 里
// 才会调 registerElicitationHandler 把它覆盖掉）。
// 这段窗口里如果服务器发来 elicitation 请求，没有 handler 会怎样？
// SDK 的行为是报错或者挂住 —— 两种都不好。
//
// 所以先注册一个「一律 cancel」的默认实现。cancel 是安全的：
// 服务器收到 cancel 会当作「用户拒绝」，走它自己的降级路径，
// 不会卡住。
//
// 这是「初始化期的安全默认值」模式：宁可给出一个保守的确定答案，
// 也不要留一个未定义行为。
// ═══'''),

(1216, 'before', '''// ═══════════════════════════════════════════════════════════════
// 【全文件最重要的 140 行】错误桥接：补上 SDK 缺的那一半
//
// 先说清楚 SDK 给了什么、缺了什么：
//
//   transport 连接失败 → 调 client.onerror（✅ 有）
//   transport 连接失败 → 调 client.onclose（❌ 没有）
//
// 而 CC 的重连机制**完全依赖 onclose**（1374 行那个 handler 会
// 清掉连接缓存，让下一次调用重新连）。
//
// 于是出现问题：一条 SSE 流被中间设备掐断后，
//   · onerror 被调用 → 我们只记了日志
//   · onclose 永远不来 → 缓存不清
//   · 下一次工具调用拿到的是那个已经死掉的 client
//   · callTool() 的 promise **永远挂着**（既不 resolve 也不 reject）
//   · 用户在界面上看到工具一直在转，按 Esc 才有反应
//
// 这就是「不是我们的 bug，但必须我们修」的典型。
//
// 解法三件套：
//   ① 自己数连续 terminal 错误（1227 行，阈值 3）
//   ② 数到 3 就主动 close（1359 行）—— 借关闭动作触发 onclose 链
//   ③ 用 hasTriggeredClose 防重入（1232 行）
//
// 还有两条**绕过计数**的快速路径：
//   · 会话过期（404 + -32001）→ 立即 close（1324 行）
//   · SDK 自己重连耗尽（"Maximum reconnection attempts"）→ 立即 close（1343 行）
//
// 第二条的注释特别值得读：SDK 的 StreamableHTTP transport 在耗尽
// 自己的重连次数（默认 maxRetries: 2）后会 fire 这个 onerror，
// 但**从不调 onclose**。所以它是「transport 已放弃」的确定信号，
// 不能等三振，必须立刻 close。
// ═══════════════════════════════════════════════════════════════'''),

(1240, 'before', '''// ═══ 为什么不能直接调 client.onclose?.() ═══
//
// 这行注释值得逐句读，因为它解释了一次真实的踩坑：
//
//   我们想做的事：清缓存，让下次调用重连。
//   朴素做法：直接调 client.onclose?.()  ← 只清了缓存，**挂起的调用还挂着**
//
//   正确做法：client.close()
//             → transport.close()
//             → transport.onclose（SDK 内部的）
//             → SDK 的 _onclose()
//             → reject 所有 pending request handler
//                （挂着的 callTool() 得到 McpError -32000 "Connection closed"）
//             → 最后才调我们的 client.onclose（清缓存）
//
// 差别在于**挂起的 promise 有没有被 reject**。
// 直接调我们的 handler 只是「假装关闭」，那些正在等响应的调用
// 会无限期挂着 —— 而它们的调用方（工具执行层）没有超时保护。
//
// hasTriggeredClose 那个 flag（1232 行）是为了防重入：
// client.close() 会中止在途的流，可能再次触发 onerror，
// 而 onerror 里又会调这个函数。没有 flag 就是无限递归。
// ═══'''),

(1249, 'before', '''// ═══ 用字符串匹配判断「这是不是致命错误」═══
//
// 没有别的办法。Node 的 socket 错误和 SDK 的包装错误都不带
// 可分类的 code 字段，只能在 message 里找子串。
//
// 列表分两类：
//   网络层   ECONNRESET / ETIMEDOUT / EPIPE / EHOSTUNREACH / ECONNREFUSED
//            Body Timeout Error / terminated
//   SDK 层   SSE stream disconnected / Failed to reconnect SSE stream
//
// 后者是注释特别说明的：SDK 会把真实网络错误**包在**这些消息里，
// 所以上面那批子串匹配不到 —— 必须单独列出。
//
// 和 withRetry.ts 的 parseMaxTokensContextOverflowError 一样，
// 这类代码是全系统最脆弱的地方：换个 SDK 版本、改个标点，
// 匹配就静默失效。失效后的表现是「重连机制不工作」，
// 而不会有任何报错告诉你原因。
// ═══'''),
]
