# -*- coding: utf-8 -*-
"""client.ts 批注 p1：文件总览、错误类型、auth 缓存、fetch 包装、连接缓存键。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 7/N —— MCP 接入的全部实现（src/services/mcp/client.ts）
//
// 3,348 行。这是整份源码里第二长的单文件（最长是 claude.ts 3,419）。
//
// 【行号口径】下面所有批注里写的「第 N 行」「N 行」，一律指
// **source/src/services/mcp/client.ts 的原始行号**，不是本批注版的行号
// （批注版插入了 1,400 多行注释，行号整体后移）。
// 想核对某个行号时，请打开 source/ 下的原文。
//
// 【MCP 是什么，为什么要这么长】
//
// Model Context Protocol：让**外部进程或服务**把自己实现的工具、资源、
// 提示词模板暴露给模型。一个 MCP 服务器可以是你本机的一条命令（stdio）、
// 一个 HTTP 服务、一个 WebSocket、IDE 插件，或者 claude.ai 那边的托管连接器。
//
// 它长，是因为要把「七种传输方式 × 四种连接状态 × 三类能力」全部收进
// 一套接口。而且每种传输的失败模式都不一样：
//   · stdio  → 子进程可能不退出、可能需要真信号（SIGINT/SIGTERM/SIGKILL）
//   · SSE    → 长连接可能断、SDK 会自己重连但重连耗尽后不通知你
//   · HTTP   → session 会过期（404 + JSON-RPC -32001）
//   · OAuth  → token 会过期、并发 401 会互相踩
//
// 【五个层次，按调用顺序】
//
//   ① 连接      connectToServer（595-1641，1,046 行）—— 七种 transport 分支
//   ② 发现      fetchToolsForClient / fetchResourcesForClient / fetchCommandsForClient
//   ③ 封装      把 MCP 的工具描述转成内部的 Tool 对象（1766-1989）
//   ④ 调用      callMCPTool / callMCPToolWithUrlElicitationRetry
//   ⑤ 结果处理  transformMCPResult → processMCPResult（截断 / 落盘 / 图片处理）
//
// 【全文件最反直觉的一点，先记住再看代码】
//
// **连接失败不抛异常。** connectToServer 的 catch 块返回的是
// `{ name, type: 'failed', config, error }` 这个**普通对象**。
// 于是「一个服务器」变成了一个四选一的代数类型：
//
//   connected   连上了，带 client 和 capabilities
//   failed      连不上，带 error 字符串
//   needs-auth  连上了但 401，等用户授权
//   disabled    用户明确关闭了，压根没试
//
// 好处：调用方不需要 try/catch 就能遍历所有服务器，一个坏服务器不会
// 中断整批连接。代价：类型检查必须无处不在（每个消费方都要先判 type）。
//
// 【和 claude.ts 的关系】
//
// 这里产出的 Tool 对象，最终会进 claude.ts 的 allTools 数组，
// 被序列化成 API 请求里的 tools 字段。所以这个文件实际上决定了
// **模型能看见哪些工具、描述长什么样、schema 是什么**。
// claude.ts 里那些 hasPendingMcpServers / mcp_instructions_delta
// 都指向这里的产物。
// ═══════════════════════════════════════════════════════════════'''),

(116, 'before', '''// ═══ feature 门 + 条件 require，两种不同的懒法 ═══
//
// 这里用的是「编译期删 + 运行期懒」的合体：
//   feature('MCP_SKILLS') 为假 → DCE 把整个三元删成 `= null`
//   为真 → 保留 require，但求值推迟到这一行执行时
//
// 后面 235 行的 claudeInChromeToolRendering 则是「只懒不删」：
// 它外面包的不是 feature 门，而是一个返回 require 的**函数**。
// 原因写在注释里：toolRendering.tsx 会拉 React/ink，
// 而这两个东西只在真的连上 Chrome MCP 时才需要。
//
// 241 行的 computerUseWrapper 更极端，两个目的一起做：
// feature 门负责外部构建里删干净，函数包装负责内部构建里不提前拉
// @ant/computer-use-input + @ant/computer-use-swift 两个原生模块。
// ═══'''),

(146, 'before', '''// ═══ 三类错误，各自对应一种「谁该处理」═══
//
// McpAuthError              401/鉴权失败 → 工具执行层捕获，把服务器状态改成 needs-auth
// McpSessionExpiredError    会话过期   → 调用方重新拿 client 再试一次（MAX_SESSION_RETRIES）
// McpToolCallError          isError:true → 直接当工具失败上报，但要带 _meta
//
// 注意第三个的类名：
//   McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
// 那个长后缀不是玩笑，是类型系统层面的**声明**：这个错误消息
// 是 MCP 协议级文本，不含用户文件路径或代码，所以可以安全进埋点。
// 继承自 TelemetrySafeError_I_VERIFIED_...，上报时不做路径擦除。
//
// 全代码库这个后缀出现几十次。它是「人来担保 + 类型来强制」的组合：
// 编译器不会验证你的担保是否正确，但它会强制你在**创建**这个错误时
// 显式选择「我担保这条消息安全」还是「走默认擦除路径」。
// ═══'''),

(188, 'before', '''// ═══ 为什么 session 过期要同时看两个信号 ═══
//
// MCP 规范说：会话 ID 失效时服务器返回 404。
// 但 404 太常见了 —— URL 打错是 404，服务器下线是 404，反代配置错也是 404。
// 光看 404 会把「这个服务根本不存在」误判成「会话过期，重连就好」。
//
// 所以第二个条件：响应体里必须是 JSON-RPC 的 -32001（Session not found）。
// 两个信号同时满足才算会话过期。
//
// 注意实现方式：从 error.message 里**字符串搜索** `"code":-32001`。
// 写了两个变体（带空格/不带空格），因为不同序列化器输出的 JSON 格式不同。
// 这是和 withRetry.ts 的 parseMaxTokensContextOverflowError 同一类做法：
// 从自然语言/文本消息里抠结构化信息。脆弱，但没有更好的办法 ——
// SDK 没有把 response body 暴露成结构化字段。
// ═══'''),

(208, 'before', '''// ═══ 默认超时 100,000,000 毫秒 = 约 27.8 小时 ═══
//
// 这个数字看着像写错了，但它是有意的：**默认等于没有超时**。
//
// 理由：MCP 工具可能是「跑一次完整构建」「部署到生产」「等 CI 通过」
// 这类操作。给一个 30 秒或 5 分钟的超时，会在正常工作流上造成假失败，
// 而且这种失败往往不可恢复（操作已经开始了，中断它比让它跑完更糟）。
//
// 真正的停止手段是用户的 Esc（AbortSignal），不是超时。
// 需要真超时的用户可以通过 MCP_TOOL_TIMEOUT 环境变量自己设。
// ═══'''),

(231, 'before', '''// ═══ 两种 lazy require 的动机不同，别搞混 ═══
//
// 235 行这里：**只懒不删**。函数包着 require，调用时才求值。
// 目的纯粹是启动时间 —— toolRendering.tsx → React/ink 一整条链，
// 只在真的连上 Claude-in-Chrome 之后才需要。
//
// 241 行那里：**又删又懒**。feature('CHICAGO_MCP') 门负责外部构建里删干净
// （连同 245 行那个 isComputerUseMCPServer 一起），函数包装负责内部构建里
// 不提前拉两个原生模块（@ant/computer-use-input 和 @ant/computer-use-swift，
// 都是 .node 二进制）。
//
// 于是 928 行会出现 `isComputerUseMCPServer!(name)` 这样的非空断言。
// 看着危险，其实安全：那个断言所在的 `feature('CHICAGO_MCP') && ...`
// 分支，在 feature 为假时整个被 DCE 删掉了，永远走不到。
// 断言的真正作用是**让 TypeScript 闭嘴**，因为类型上它可能是 undefined。
// ═══'''),

(265, 'before', '''// ═══ 手写 memoize，因为 lodash 的 memoize 做不到 ═══
//
// 这里缓存的是一个 Promise（文件读取）。三个要点：
//
// 1. 为什么缓存 Promise 而不是结果
//    批量连接时 N 个服务器同时问「我是不是 needs-auth」，
//    缓存 Promise 能让 N 个调用共享**一次** readFile。缓存结果则不行 ——
//    后 N-1 个调用会各自发起一次读，因为第一次还没返回。
//
// 2. 为什么不用 lodash memoize
//    注释写得很直接：需要把整个缓存**置 null**，而不是按 key 删除。
//    因为没有 key —— 只有一个文件、一份缓存。
//
// 3. 失效时机
//    写的时候（setMcpAuthCacheEntry）和清的时候（clearMcpAuthCache）
//    都置 null。前者在写完之后，后者立即。
// ═══'''),

(289, 'before', '''// ═══ 用 Promise 链串行化写入，防 read-modify-write 竞争 ═══
//
// 场景：一批 20 个服务器同时返回 401，20 个 handler 同时调
// setMcpAuthCacheEntry。每个都是「读文件 → 改内存对象 → 写文件」。
// 并发跑的话，后 19 个的写会覆盖掉前面的新增条目 —— 只有最后一个留下。
//
// 解法是把写操作挂到一条 promise 链上，任何时刻只有一个在跑。
// 简单，而且不需要锁文件。
//
// 注意行 304 `authCachePromise = null` 的位置：在 writeFile **之后**。
// 注释解释了为什么这是安全的 —— 因为写是串行的，下一个写的
// getMcpAuthCache() 一定会重新读到含这条新记录的文件。
// 如果放在 writeFile 之前，就会出现「缓存已失效但文件还没写」的窗口。
// ═══'''),

(318, 'before', '''// ═══ 一个「性能微优化」被降到注释级别 ═══
//
// 这个函数存在的唯一理由：原来内联的三元表达式调了两次
// getLoggingSafeMcpBaseUrl()（一次判空、一次取值）。抽成函数后只调一次。
//
// 从类型上也能看出目的：返回值可以直接 spread 进埋点对象
// （`...mcpBaseUrlAnalytics(serverRef)`），无 URL 时返回 {} 而不是 {key: undefined}，
// 避免埋点里出现一堆 undefined 字段。
//
// 这类小函数在源码里很多。读的时候不用花时间，但要注意它揭示的一件事：
// 埋点字段的**形状**是被认真设计过的，不是随手拼的。
// ═══'''),

(335, 'before', '''// ═══ 401 不抛异常，而是变成一种「连接状态」═══
//
// 这是全文件最重要的设计决策之一，值得单独说清楚链条：
//
//   ① transport 抛 UnauthorizedError
//   ② connectToServer 的 catch 里判断 `instanceof UnauthorizedError`
//   ③ 调这个函数 → 埋点 + 写 15 分钟 needs-auth 缓存 + 返回 needs-auth 对象
//   ④ getMcpToolsCommandsAndResources 收到 needs-auth
//   ⑤ 它塞一个 createMcpAuthTool(name, config) 进 tools 数组
//   ⑥ **模型看到一个「认证这个服务器」的工具**
//   ⑦ 模型可以自己调用它，走 OAuth 流程
//
// 于是「一个错误」变成「一个可执行的修复动作」。这是 agent 系统里
// 很值得学的一招：不要只报告问题，把问题包装成模型能操作的工具。
//
// 三个 transport 共用这个函数（sse / http / claudeai-proxy），
// 差别只在埋点里的 label。
// ═══'''),

(363, 'before', '''// ═══ 一个非常微妙的并发 401 陷阱 ═══
//
// 看返回值：不是 response，而是 `{ response, sentToken }`。
// 这个「多返回一个 token」是整个函数存在的核心理由。
//
// 错误写法（注释里明确点出来了）：
//
//   const res = await doRequest()
//   if (res.status === 401) {
//     await handleOAuth401Error()        // ← 这里内部会重读 keychain
//   }
//
// 并发场景下会坏：
//   连接器 A 和 B 同时 401。A 先跑 handleOAuth401Error，刷新出新 token
//   并清掉 memoize 缓存。B 再跑时读 getClaudeAIOAuthTokens()，
//   拿到的是**新** token，传给 handleOAuth401Error，
//   它一比对「和 keychain 里的一样」→ 返回 false → 不重试 → B 永久失败。
//
// 正确做法是把「我发出去时用的是哪个 token」显式传参下去。
// 注释最后一句点了同款实现的另一个文件：bridgeApi.ts 的 withOAuthRetry。
//
// 【还有一层放大效应】
// 注释开头说的：Anthropic API 路径在 withRetry.ts / grove.ts 里有同样的
// 401 重试（处理 memoize 缓存陈旧和时钟漂移）。这里如果没有，
// 一个 stale token 会让**所有** claude.ai 连接器同时 401，
// 然后全被钉进 15 分钟的 needs-auth 缓存 —— 用户看到的就是
// 「所有连接器突然全挂了，等 15 分钟才恢复」。
// ═══'''),

(407, 'before', '''// ═══ 双保险：ELOCKED 竞争下的二次确认 ═══
//
// handleOAuth401Error 返回 false 有两种含义：
//   a) 真的没救（keychain 里就是同一个过期 token）
//   b) 我们抢锁失败了，别的进程正在刷新（ELOCKED）
//
// 这两种情况必须分开处理。所以返回 false 后再看一眼：
// 「现在 keychain 里的 token 和我发出去时用的还一样吗？」
// 不一样 → 说明别人刷好了 → 继续重试。
// 一样 → 真没救 → 返回原始 401 让上层分类。
//
// 这个模式在「多进程共享凭据」的系统里很常见：锁竞争失败 ≠ 操作失败，
// 可能只是别人做了你要做的事。
// ═══'''),

(424, 'before', '''// ═══ Bun 的 ws 类型缺 3 参构造函数 ═══
//
// 真实的 ws 包支持 `new WebSocket(url, protocols, options)`，
// 但 Bun 内置的 ws shim 类型定义只声明了两个参数。
// 所以这里把构造函数 cast 成正确的签名再用。
//
// 注意 dynamic import('ws')：和 235 行同样的手法，
// WebSocket 只在配置里有 ws/ws-ide 服务器时才需要。
// ═══'''),

(465, 'before', '''// ═══ 这个常量不是我们想要的，是规范强制的 ═══
//
// MCP Streamable HTTP 规范要求：客户端在**每个 POST** 上都要声明
// 同时接受 JSON 和 SSE。严格执行规范的服务器会拒绝不带它的请求（HTTP 406）。
//
// 注意下面 wrapFetchWithTimeout 里为什么要「保证」它存在而不是「设置」它：
// SDK 的 StreamableHTTPClientTransport.send() 内部确实设了，
// 但它是设在一个 Headers 实例上，然后经过一次对象 spread。
// 某些运行时/agent 会在到达网络前把它弄丢（注释给了 issue 编号 202）。
// 所以在**最后一个** fetch 包装层再归一化一次 —— 这是唯一能保证的位置。
// ═══'''),

(473, 'before', '''// ═══ 这个包装器解决了四个独立问题，注释写得很好，逐条拆 ═══
//
// 【问题一】AbortSignal.timeout() 不能复用
//   在连接时创建一个 AbortSignal.timeout(60s)，60 秒后它永久处于 aborted。
//   之后所有请求都会立刻失败，报 "The operation timed out."
//   听起来很傻，但这个 bug 真的会发生 —— 因为 signal 看起来像无害的配置。
//   解法：每次请求新建一个。
//
// 【问题二】GET 不能加超时
//   MCP 里 GET 请求是**长连 SSE 流**，设计上就该一直开着。
//   给它 60 秒超时等于每 60 秒杀掉一次事件流。
//   所以 498 行直接透传给 baseFetch，一秒钟都不包。
//   （OAuth discovery 的 GET 在 auth.ts 里另有一套带超时的 fetch，不走这里。）
//
// 【问题三】Bun 里 signal 的定时器是懒 GC 的
//   AbortSignal.timeout 的内部定时器只在 signal 被 GC 时才释放，
//   而 Bun 的 GC 很懒。实测每个请求残留约 2.4KB 原生内存，整整 60 秒 ——
//   即使请求在几毫秒内就完成了。
//   解法：用 setTimeout + 手动 clearTimeout（532 行的 cleanup）。
//
// 【问题四】Accept header 会在 spread 中丢失
//   见上面的 MCP_STREAMABLE_HTTP_ACCEPT。
//
// 顺序也讲究：先建 Headers（归一化形状）→ 再设 Accept → 再建 controller。
// 因为 Headers 构造是唯一能同时接受 HeadersInit 三种形态
// （对象 / 元组数组 / Headers 实例）的地方。
// ═══'''),

(552, 'before', '''// ═══ 本地 3 / 远程 20，差距这么大是因为成本模型不同 ═══
//
// 本地服务器（stdio/sdk）= 每次连接 spawn 一个**子进程**。
// 并发 20 个就是同时 spawn 20 个进程：内存、文件描述符、CPU 争抢。
// 3 是经验值，也是「批量连接时不会把机器打爆」的上限。
//
// 远程服务器 = 只是网络连接，等着就行。
// 20 个并发对客户端几乎无成本，还能把总连接时间压到
// 「最慢那一个」而不是「累加」。
//
// 两个都能用环境变量覆盖，方便用户按机器性能调。
// ═══'''),

(567, 'before', '''// ═══ 只放行两个 IDE 工具，其余一律过滤 ═══
//
// IDE 的 MCP 服务器（VS Code / JetBrains 插件那类）会暴露一大堆工具，
// 但其中绝大多数是我们已经用内建工具覆盖的能力（读文件、搜索、编辑）。
// 全量放进去会让模型的工具列表膨胀，还会和内建工具打架。
//
// 只留两个内建做不到的：
//   mcp__ide__executeCode     在 IDE 的运行时里跑代码（能访问编辑器的状态）
//   mcp__ide__getDiagnostics  拿 IDE 的语义诊断（比跑 tsc 快，因为已经算好了）
//
// 过滤发生在 fetchToolsForClient 的最后一步（1990 行的 .filter）。
// ═══'''),

(575, 'before', '''// ═══ 缓存键 = 名字 + 序列化后的整个配置 ═══
//
// 这个函数是 connectToServer 的 memoize resolver（1640 行传入）。
// 语义：配置的任何字段变了，键就变了，memoize 自然失效并重连。
//
// 副作用：jsonStringify 的**键顺序**会影响结果。同样内容的配置对象，
// 如果构造时键的顺序不同，会算出两个不同的键 → 缓存不命中 → 重连。
// 实际不会出问题（配置都从同一处 JSON 解析出来，顺序稳定），
// 但它解释了为什么 1710 行的 areMcpConfigsEqual 也用了同样的比较方式。
// ═══'''),

(588, 'before', '''// ═══ 作者自己留下的复杂度债，原文照抄 ═══
//
//   "TODO (ollie): The memoization here increases complexity by a lot,
//    and im not sure it really improves performance"
//
// 这句话值得停下来想一想，因为它是**有名字的人**在源码里承认
// 「我加的这层优化可能不值」。而下面这 1,046 行的函数，
// 复杂度确实有相当一部分来自 memoize：
//
//   · 缓存键要包含整个配置（getServerCacheKey）
//   · onclose 里必须手动删缓存，否则重连拿不到新连接（1396 行）
//   · 同样的删除要在 clearServerCache（1666）和
//     clearServerCache 的调用点（2154）各写一遍
//   · 还有四个**独立的** fetch 缓存也要跟着清（1389-1394）
//
// 一个缓存变成了「必须记住在 5 个地方同步维护」的隐式契约。
//
// 对比 2405 行的 prefetchAllMcpResources：那里明确写了**不 memoize**
// 的理由（按对象引用 memoize 会泄漏，因为调用方每次造新对象）。
// 两个函数，两个相反决定，各自的理由都写在注释里 ——
// 这是这套源码里最值得学的习惯之一：**把「为什么不这么做」写下来**。
//
// 读这个函数时的心态建议：不要试图一次搞懂 1,046 行。
// 它是一条 try 里的七个 if-else 分支（每个 transport 一段），
// 加上连接后的通用收尾（错误桥接、缓存清理、清理函数注册）。
// 按分支读，每次只读一种 transport。
// ═══'''),
]
