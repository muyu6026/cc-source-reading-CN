# -*- coding: utf-8 -*-
"""client.ts 批注 p4：批量连接调度、结果转换与落盘、工具调用、elicitation 重试。"""

ANNOTATIONS = [
(2130, 'before', '''// ═══ 重连入口，但 UI 不该直接调它 ═══
//
// 注释第一句就划清边界：UI 组件应该用 useManageMcpConnections 里的
// reconnectMcpServer，而不是这个 Impl。因为 UI 那边还要更新
// AppState、清 React 状态、重渲染 —— 这个函数只管连接层。
//
// 分层：Impl（纯连接逻辑，可测）→ 上层（状态同步 + 副作用）。
// ═══'''),

(2147, 'before', '''// ═══ 先清 keychain 缓存，再谈连接 ═══
//
// 这个细节来自一个真实的多进程场景：
//
//   用户在 VS Code 里点了「退出登录」/「重新授权」
//   → 扩展宿主进程改了磁盘上的凭据
//   → 扩展让 CLI 子进程重连
//   → CLI 子进程如果读的是**内存里的** keychain 缓存，
//     根本看不到凭据已经变了
//   → 重连用的还是旧 token，永远失败
//
// 所以重连的第一步必须是「忘掉我记住的凭据」。
//
// 这类 bug 的特征：单进程测试永远复现不了，只有跨进程才出现。
// 而跨进程是 IDE 集成的常态。
// ═══'''),

(2181, 'before', '''// ═══ 资源工具全局只加一份 ═══
//
// ListMcpResourcesTool 和 ReadMcpResourceTool 是**内建**工具，
// 但它们要操作的资源来自所有 MCP 服务器。所以不能按服务器重复添加。
//
// 两种场景的判断方式不同：
//   这里（重连单个）：检查这个服务器的工具里有没有 ——
//     有就说明别的服务器已经加过了（或者在它之前的重连加过）
//   2361 行（批量连接）：用一个 resourceToolsAdded 标志 ——
//     因为是并发跑的，没法「检查别人加过没」
//
// 同一个问题，串行和并发两种解法。这是并发编程里很实际的细节。
// ═══'''),

(2212, 'before', '''// ═══ 一次调度改造的完整记录，注释里直接写了日期 ═══
//
// 原文（2026-03 的改动说明）：
//   "previous implementation ran fixed-size sequential batches
//    (await batch 1 fully, then start batch 2). That meant one slow
//    server in batch N held up ALL servers in batch N+1, even if the
//    other 19 slots were idle. pMap frees each slot as soon as its
//    server completes, so a single slow server only occupies one slot
//    instead of blocking an entire batch boundary. Same concurrency
//    ceiling, same results, better scheduling."
//
// 拆开看这个分析：
//   旧：分批，批内并发、批间串行。20 个服务器、批大小 20、其中一个慢 10 秒
//       → 第 1 批等 10 秒 → 第 2 批才开始
//   新：滑动窗口。那个慢的占一个槽，其余 19 个槽继续消化后面的
//       → 总时间 ≈ max(最慢的那个, 其余的平均摊分)
//
// 关键点：**并发上限一样、结果一样**，只有调度变了。
// 这是「同样是 O(n) 但常数差很多」的典型优化，而且没有正确性风险。
//
// pMap 是这里唯一的外部依赖（不是自己写的池）。用一个成熟的库
// 而不是手写信号量，是对的取舍 —— 这段代码不需要创新。
// ═══'''),

(2226, 'before', '''// ═══════════════════════════════════════════════════════════════
// 【启动时最重要的一段】批量连接所有 MCP 服务器
//
// 它的调用方是启动流程（prefetchAllMcpResources → main.tsx），
// 在第一次调模型之前必须跑完 —— 因为模型需要知道有哪些工具。
// 所以这段的**总耗时**直接等于「用户按下回车到看见第一个字」的延迟。
//
// 结构：
//   ① 拿到所有配置，分 disabled / active
//   ② 数各类 transport 的个数（只为埋点）
//   ③ 分本地 / 远程两组
//   ④ 两组各自用不同并发跑，组间并行
//   ⑤ 每个服务器完成后立即回调 onConnectionAttempt（流式产出）
//
// 第 ⑤ 点是设计上的关键：不用等全部完成再返回一个数组，
// 而是**每完成一个就通知一次**。这样 UI 可以逐个显示连接状态
// （用户看到服务器一个个亮起来），而不是卡着等最慢的那个。
// 回调式 API 换来的代价是：调用方要自己数「完成了几个」，
// 见 prefetchAllMcpResources 里那个 completedCount。
// ═══════════════════════════════════════════════════════════════'''),

(2241, 'before', '''// ═══ disabled 的服务器不参与并发调度 ═══
//
// 看着啰嗦（先分区，再在 processServer 里又检查一次 2288 行），
// 但两个检查都有必要：
//
//   这里的分区：让 disabled 的服务器不占用并发槽位
//               （否则 20 个禁用服务器会把 20 个槽全占了，什么都不干）
//   里面的检查：因为 mcpConfigs 可能是调用方临时传的，
//               而 isMcpServerDisabled 读的是全局开关 ——
//               两者可能不一致
//
// disabled 的服务器仍然要产出 onConnectionAttempt（2246 行），
// 因为 UI 需要显示它（灰掉的服务器也是信息）。
// ═══'''),

(2264, 'before', '''// ═══ 本地 / 远程分两组，各有各的并发上限 ═══
//
// 见 p1 对 getMcpServerConnectionBatchSize 的说明：
// 本地 3（spawn 进程），远程 20（只是网络）。
//
// 重点在 2391 行：两组用 Promise.all **同时**跑。
// 意思是最终总时间 ≈ max(本地组总时间, 远程组总时间)，
// 而不是两者相加。因为它们是不同资源（进程 vs 网络）。
// ═══'''),

(2301, 'before', '''// ═══ 双重 needs-auth 检查，堵住 TTL 留下的缺口 ═══
//
// 第一重：isMcpAuthCached（15 分钟 TTL 的文件缓存）。
//   最近 401 过的服务器，15 分钟内不重试。
//
// 第二重：hasMcpDiscoveryButNoToken。
//   检查的是「这个服务器有 OAuth 发现信息，但我们手里没有 token」。
//
// 为什么需要第二重（注释写得很清楚）：
//   TTL 只覆盖 15 分钟。15 分钟一过，那些「压根不可能成功」的服务器
//   会被重新探测一次 —— 每次探测 = 一次 connect 请求（拿到 401）
//   + 一轮 OAuth discovery。
//
//   而用户不主动跑 /mcp 的话，它们永远不会有 token。
//   所以每 15 分钟浪费一轮完整探测。
//
// 放大效应：print 模式会 await 整个批次（注释引了 main.tsx:3503）。
// 于是「一次性的 -p 命令」会因为这轮无用的探测而卡住。
//
// 这是「缓存 TTL 解决了性能问题，但留下了一个语义缺口，
// 需要第二条判据补上」的教科书案例。
// ═══'''),

(2342, 'before', '''// ═══ 四个 fetch 并行，但只有两个是必需的 ═══
//
// tools 和 commands：无条件调（函数内部会自己检查 capabilities）
// skills 和 resources：先看 supportsResources 再调
//
// 为什么 skills 依赖 resources：技能的发现走 `skill://` 资源协议，
// 没有 resources 能力的服务器不可能有技能。
//
// 注意 `features('MCP_SKILLS') && supportsResources ? fetch : Promise.resolve([])`
// 这个写法的两层含义：
//   feature 为假 → 整个分支被 DCE 删掉，fetchMcpSkillsForClient 也是 null
//   所以那个非空断言 `fetchMcpSkillsForClient!` 在 DCE 之后才安全
// ═══'''),

(2405, 'before', '''// ═══ 明确写了「故意不 memoize」═══
//
//   "Not memoized: called only 2-3 times at startup/reconfig. The inner
//    work (connectToServer, fetch*ForClient) is already cached.
//    Memoizing here by mcpConfigs object ref leaked — main.tsx creates
//    fresh config objects each call."
//
// 三个理由层层递进：
//   1. 调用频率低（启动 + 重配置，2-3 次）→ memoize 的收益本来就小
//   2. 内层已经缓存了 → 每次重跑只是查缓存，成本接近零
//   3. 真的 memoize 过，然后**泄漏了** → 因为键是对象引用，
//      而 main.tsx 每次调用都造新对象 → 每次新键 → 缓存永不命中
//      且永不释放
//
// 第 3 点是最有教学价值的：memoize 用对象引用做键是一个**静默的**
// 内存泄漏源。它不报错，只是缓存表一直长。
//
// 对比 connectToServer（595 行）是 memoize 的，键是
// `name + jsonStringify(config)` 字符串 —— 内容相同就是同一个键，
// 所以不会因为「新对象」而失效。两个 memoize，一个用对了键，一个没用。
// ═══'''),

(2475, 'before', '''// ═══ MCP 内容块 → API 内容块，四种类型 ═══
//
// text          直接透传
// image         必须先 resize（API 有尺寸上限），再转 base64
// audio         落盘（API 不接受音频），返回一个小文本块指路
// resource      文本资源内联；blob 资源看 mime：图片走 image 路径，
//               其他落盘
// resource_link 变成一个带 URI 的文本块
//
// 【贯穿始终的一条原则】
// 二进制内容**不直接进上下文**，而是落盘 + 返回路径。
// 因为 base64 进上下文极其浪费：1MB 图片 = 约 340K token，
// 而且是永久占用（除非压缩）。
//
// persistBlobToTextBlock（2598 行）就是这条原则的实现，
// 注释说得很直接："Replaces the old behavior of dumping raw base64
// into the context."
//
// 例外是图片：图片必须保留为 image block，因为模型要**看**它。
// 所以图片走 resize 而不是落盘。
// ═══'''),

(2593, 'before', '''// ═══ 落盘 + 返回指路牌 ═══
//
// 三步：造一个唯一 id → 写盘（persistBinaryContent 决定扩展名和目录）
// → 返回一句话告诉模型文件在哪。
//
// 失败时（2607 行）返回的不是错误，而是一段说明文本：
// "Binary content (...) could not be saved to disk: <原因>"
//
// 为什么不抛错：二进制内容落盘失败不该让整个工具调用失败。
// 模型读到这段文字，会知道「这里本来有个文件但没存下来」，
// 通常它会继续往下做。抛错则会让工具调用整体失败，前面的工作白做。
//
// 这是「降级优于失败」的实例，但要注意它的适用条件：
// 只适用于**附带信息**。如果用户要的就是那个文件，静默降级
// 会让模型以为拿到了实际没拿到 —— 所以消息里必须说清楚失败原因，
// 让模型自己决定要不要重试。
// ═══'''),

(2640, 'before', '''// ═══ 给 JSON 生成一个「jq 友好」的类型签名 ═══
//
// 输入 { title: 'x', items: [{id: 1, name: 'a'}] }
// 输出 "{title: string, items: [{id: number, name: string}]}"
//
// 用途：大输出落盘之后，模型拿到的是一个文件路径 + 这段签名。
// 签名告诉它「文件长什么样」，于是它能写出正确的 jq 命令去取数据，
// 而不需要先 cat 一遍（那会又占满上下文）。
//
// 三个限制：
//   深度默认 2（超过就 {...}）—— 太深的签名和原文一样长，失去意义
//   对象最多列 10 个键（2662 行）—— 同理
//   数组只看第一个元素 —— 假设同构（JSON 数组通常确实同构）
//
// 20 行的函数，但解决的是「怎么用极少的 token 描述数据结构」
// 这个相当核心的问题。
// ═══'''),

(2662, 'before', '''// ═══ 三种返回形状，按优先级匹配 ═══
//
// toolResult         某些老实现/代理用这个字段直接塞字符串
// structuredContent  MCP 2025-06 之后的结构化输出（优先用它，
//                    因为它有 schema 保证）
// content            标准的 content 数组
//
// 顺序有意义：先看 toolResult（最古老的），再看 structuredContent，
// 最后 content。因为越靠前的越明确 —— 如果响应里有 toolResult 字段，
// 那它就是内容无疑；而 content 字段可能出现在很多地方。
//
// 三个都不匹配 → 抛错（2700 行）。注意错误消息里带了服务器名和工具名：
// "MCP server \"slack\" tool \"search\": unexpected response format"
// 因为这类错误几乎总是「某个特定服务器的实现不符合规范」，
// 不点名就没法排查。
// ═══'''),

(2708, 'before', '''// ═══ 四道处理，按代价从低到高 ═══
//
// ① ide 服务器直接返回（2729 行）
//    IDE 工具的结果不发给模型（本地消费），所以不需要处理大小。
//
// ② 不需要截断就返回（2734 行）
//    绝大多数调用走这条。mcpContentNeedsTruncation 是快速判据。
//
// ③ 环境变量禁用落盘 → 退回纯截断（2741 行）
//    ENABLE_MCP_LARGE_OUTPUT_FILES 显式关闭时，走老行为：
//    直接把内容砍到上限。会丢信息，但兼容用户的选择。
//
// ④ 含图片 → 也退回截断（2758 行）
//    原因：落盘会把图片序列化成 JSON（base64 字符串），
//    既废掉了图片压缩逻辑，也让模型再也看不到那张图。
//    所以宁可截断（可能丢部分图），也不落盘。
//
// ⑤ 落盘（实际是第四道成功路径）
//    生成 id、序列化、写盘、返回「文件路径 + 类型签名 + 怎么读」。
//
// 五种结局，每一处埋点都带 outcome 和 reason（如
// {outcome:'truncated', reason:'contains_images'}）。
// 这样能统计出「落盘这条路到底有多少比例被走通了」——
// 没有这些埋点，就无法判断这个功能值不值得留。
// ═══'''),

(2801, 'before', '''// ═══ -32042：工具说「我需要用户先打开一个链接」═══
//
// 这是 MCP 里比较新的一个模式：工具不能直接完成，
// 它需要一个 OAuth 授权 / 一个确认页 / 一个外部流程。
// 服务器返回 JSON-RPC -32042（UrlElicitationRequired），
// 在 error.data 里带上要打开的 URL。
//
// 处理流程：
//   ① 解析 error.data.elicitations，逐个验证字段（2886 行）
//   ② 对每个：先跑 elicitation hooks（hooks 可以程序化解决，
//      比如测试环境自动接受）
//   ③ hooks 没解决 → 问用户（两种方式：print 模式走回调，REPL 走 UI 队列）
//   ④ 跑 result hooks（可以修改或拦截用户的回答）
//   ⑤ 全部 accept → **重试工具调用**（3024 行回到循环顶部）
//
// 上限 MAX_URL_ELICITATION_RETRIES = 3。为什么要有上限：
// 一个写错的服务器可能永远返回 -32042，无限重试就是死循环。
//
// 【值得注意的两个细节】
//
// 2862 行：用 `error.code !== ErrorCode.UrlElicitationRequired` 判断，
// 而不是 instanceof UrlElicitationRequiredError。
// 原因写在注释里：SDK 的 Protocol 层对错误响应造的是**裸 McpError**，
// 不是那个专门的子类。所以只能看 code。
//
// 2886 行：对 elicititations 数组**逐字段验证**。因为 error.data 是
// 外部服务器提供的任意 JSON —— 直接当类型用就是信任外部输入。
// 这里检查了 mode/url/elicitationId/message 四个字段的类型。
// ═══'''),

(2943, 'before', '''// ═══ 两种 elicit 投递方式，因为有两种运行形态 ═══
//
// print/SDK 模式（2945 行）：有一个 handleElicitation 回调，
// 直接 await 它。因为这种模式下没有交互式 UI，宿主程序（SDK 使用者）
// 负责回答。
//
// REPL 模式（2948 行）：推一个事件到 AppState 的 elicitation 队列，
// 由 Ink 组件渲染成对话框。等用户操作。
//
// 【REPL 分支里那个两阶段设计，是全文件最绕的一段】
//
// 看 respond 回调（2975 行）：
//   action === 'accept' → **什么都不做**（不 resolve promise）
//   其他 → resolve
//
// 为什么 accept 不 resolve：因为 accept 只是**第一阶段同意**
// （"是的，我要去打开这个链接"），还没完成。真正完成是
// 服务器通知「授权好了」（onWaitingDismiss 的 'retry'）。
//
// 所以流程是：
//   用户点「同意」→ respond('accept') → 什么都不发生
//   → UI 切到「等待中」状态（waitingState.actionLabel = 'Retry now'）
//   → 用户在浏览器里完成授权
//   → 服务器发通知 / 或者用户点「Retry now」
//   → onWaitingDismiss('retry') → resolve({action:'accept'})
//
// 这个"accept 是空操作"的设计非常反直觉，但它是必要的：
// 一次用户点击只能对应一个 promise resolve，而这个流程需要两次
// 用户动作才能算完成。
//
// signal 的处理也很细：abort 时 resolve 成 cancel（2955 行），
// 而且每次 resolve 前都先 removeEventListener —— 否则同一个
// abort 会让后面的 promise 提前 resolve。
// ═══'''),

(3029, 'before', '''// ═══ 真正的调用，六段 ═══
//
//   ① 每 30 秒打一条 "still running" 调试日志（3054 行）
//   ② 自己的超时 Promise（3068 行）
//   ③ callTool + onprogress 桥接
//   ④ isError 处理 → 抛 McpToolCallError（带 _meta）
//   ⑤ 成功：埋点 + processMCPResult
//   ⑥ 失败分类：401 / session 过期 / AbortError / 其他
//
// 【为什么要有自己的超时】
// 注释（3068 行）解释：SDK 内部的超时在有些情况下不生效 ——
// 比如 SSE 流中途断了，SDK 根本没机会触发自己的定时器。
// 所以外面再套一层 Promise.race，保证调用方一定能拿到结果。
//
// 注意 finally（3118 行）清 timeoutId：不清的话，一个已经完成的
// 调用会在 timeoutMs（默认 27.8 小时）后触发一个无人处理的 reject。
// Node 里未处理的 rejection 会打警告，在长会话里会积累成噪音。
//
// 【30 秒日志的意义】
// MCP 工具可能跑几十分钟（构建、部署）。没有这条日志，
// 用户和开发者都不知道它在动还是卡死了。日志本身是无害的
// （只写调试日志），但它是「可观测性」的最小实现。
// ═══'''),

(3124, 'before', '''// ═══ isError: true —— 工具自己报告失败，但结果仍然有价值 ═══
//
// MCP 规范允许工具返回 isError: true 而不走协议错误。这里的处理是
// **抛异常**，但把 _meta 一起带出去（3144 行）。
//
// 注释说明了为什么 _meta 必须带（172-175 行的类注释）：
// "per the MCP spec, _meta is on the base Result type and is valid
//  on error results."
//
// 也就是说：即使工具失败，它也可能在 _meta 里放了诊断信息，
// SDK 消费者需要拿到。如果丢掉，上层就没法给出有用的错误提示。
//
// 错误详情提取的逻辑（3125-3142）也值得看：
//   优先 content[0].text     ← 标准做法
//   退而求其次 result.error  ← 老格式兼容
//   都没有 → 'Unknown error'
//
// 三种形状说明 MCP 生态的实现差异很大，不能只按 spec 写。
// ═══'''),

(3150, 'before', '''// ═══ 三段式时长格式化 ═══
//
//   < 1s      → "842ms"
//   < 1min    → "12s"
//   >= 1min   → "3m 27s"
//
// 小细节，但体现了「日志给人看」的态度。
// 一个 3m27s 的工具调用写成 "207000ms" 读者要在脑子里换算，
// 而换算成本会让人跳过这条日志。
// ═══'''),

(3194, 'before', '''// ═══ 失败分类的四个出口 ═══
//
// ① 401 / UnauthorizedError → McpAuthError（3204 行）
//    上层会把它翻译成「服务器状态改为 needs-auth」，然后
//    （在批量连接那边）暴露一个认证工具给模型。
//
// ② session 过期 → clearServerCache + McpSessionExpiredError（3223 行）
//    见下面那条批注。
//
// ③ AbortError → **返回 `{ content: undefined }`，不抛**（3238 行）
//    用户按了 Esc。抛错会在日志和 UI 上产生一堆噪音，
//    而这不是「错误」，是用户的正常操作。
//    注释原话："When the users hits esc, avoid logspew"。
//
// ④ 其他 → 原样抛（3236 行）
//
// 【② 的两种错误形状，注释列得很清楚】
//   1. 直接的 404 + JSON-RPC -32001（StreamableHTTPError）
//   2. -32000 "Connection closed"（McpError）——
//      因为 SDK 在 onerror 之后会关 transport，于是挂起的 callTool
//      拿到的是这个**派生**错误，而不是原始的 404
//
// 第二种是「上层看到的错误和底层发生的事不一样」的典型案例。
// 如果不处理它，用户会看到 "Connection closed"，而实际原因
// 是「会话过期了，重连就好」—— 完全没法从错误消息里推出来。
//
// 注意 3220 行的条件里还检查了 config.type：
// 只对 http / claudeai-proxy 生效。因为 -32000 在 stdio 上
// 意味着真的关闭了，不该当成会话过期处理。
// ═══'''),

(3247, 'before', '''// ═══ 只看 content[0]，是个刻意的简化 ═══
//
// tool_use_id 用于进度上报和 _meta 透传。这个函数假设
// 父消息的第一块就是 tool_use。
//
// 什么时候不成立：模型在一条消息里先输出文本再调工具
// （thinking → text → tool_use）。那时 content[0] 是 thinking 或 text，
// 这个函数返回 undefined。
//
// 后果是什么：进度上报被跳过（1846 行 `if (onProgress && toolUseId)`），
// _meta 里不带 toolUseId。**功能降级，但不报错**。
//
// 所以这是个「已知不完整但够用」的实现。生产代码里这类东西很多，
// 判断它合不合理要看：失败时是降级还是崩溃。这里是降级，还行。
// ═══'''),

(3254, 'before', '''// ═══ SDK 类型的 MCP 服务器：走控制通道，不走网络 ═══
//
// 这类服务器是 Agent SDK 的使用者在自己进程里注册的。
// 通信方式：SdkControlClientTransport 把 JSON-RPC 消息
// 通过 sendMcpMessage 回调交给宿主，宿主的响应再回来。
//
// 相当于把「MCP 协议」当成了一个**进程内的消息格式**，
// 底层可以是控制通道、stdin/stdout、甚至 WebSocket（由宿主决定）。
// transport 抽象在这里又一次证明了自己的价值。
//
// 【Promise.allSettled 而不是 all】
// 一个 SDK 服务器连不上不该让其他的也失败。
// 注意注释（3344 行）说 rejected 是「unexpected」的 ——
// 因为每个 promise 内部已经 try/catch 过了，正常情况下
// 只会 fulfilled（里面装一个 failed 的 client）。
// allSettled 是第二层保险。
//
// 和 connectToServer 对比：那条路是「失败返回对象」，
// 这条也是。全文件贯彻了同一个错误即数据的约定。
// ═══'''),

(3293, 'before', '''// ═══ SDK 服务器的 capabilities 声明为空 ═══
//
// 和 985 行那个 Client 不同（那里声明了 roots + elicitation）。
// 因为 SDK 服务器是宿主自己实现的，宿主不需要我们向它要根目录，
// 也不太可能用我们的 elicitation UI。
//
// 空 capabilities 意味着：不主动声明任何客户端能力。
// 服务器如果请求 elicitation，SDK 会拒绝 —— 而这是合理的，
// 因为宿主自己就是服务器，它怎么会需要问客户端？
// ═══'''),
]
