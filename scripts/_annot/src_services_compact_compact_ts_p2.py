# -*- coding: utf-8 -*-
"""compact.ts 批注 p2：摘要生成路径 + 压缩后附件重建。"""

ANNOTATIONS = [
(1108, 'before', '''// 弹错误通知，但有两种错误不弹。
//
// `hasExactErrorMessage` 是**精确字符串比对**（不是 includes），
// 因为这里要区分的是"我们主动抛的两种非故障错误"：
//   · `ERROR_MESSAGE_USER_ABORT`        —— 用户按了 Esc
//   · `ERROR_MESSAGE_NOT_ENOUGH_MESSAGES` —— 消息太少不用压
//
// 两种都是"用户的意图"，不是故障。弹红色错误框会让人以为系统坏了。
//
// 【这也解释了 225 行那三个常量为什么必须是常量】
// 如果这里是 `error.message.includes('abort')` 之类，
// 用户按 Esc 时就会弹错误。用精确比对 + 共享常量，
// 才能保证"文案改了但行为不变"——除非有人只改了一处。
//
// 通知的 key 是 `error-compacting-conversation`，固定字符串意味着
// 重复出错只会覆盖同一条通知，不会刷屏。`priority: 'immediate'`
// 让它插队显示（不等当前渲染周期）。'''),

(1125, 'before', '''// ═══ 压缩 agent 的工具权限：全 deny ═══
//
// 返回的每一句都是固定拒绝，`decisionReason.type: 'other'`。
//
// 为什么必须全禁？因为压缩 agent 的任务是"写一段文字摘要"。
// 如果它被允许调工具，会出现这些灾难：
//   · 它可能去 Read 一堆文件，把上下文又撑大了（压缩的意义全没了）
//   · 它可能写文件、跑命令——一个"整理历史"的操作不该有副作用
//   · 它可能递归触发压缩
//
// 注释里那句 "compaction agent should only produce text summary"
// 就是这个意思：**能力最小化**。
//
// 【顺带一提：这个函数返回的是 `CanUseToolFn`】
// 它的签名是 `(toolName, input) => Promise<PermissionResult>`。
// 这里连参数都没接，直接返回 deny——连"是什么工具"都不看。
// 这是最彻底的禁法。'''),

(1136, 'before', '''// ═══════════════════════════════════════════════════════════════
// 摘要生成（261 行，1136-1396）—— 真正发那次 API 调用
//
// 【两条路径，一主一备】
//
//   主路径（1179-1248）：runForkedAgent
//     ——复用主线程的 prompt cache。命中率极高（system + tools + 历史前缀全同），
//        成本约为普通路径的 1/10。失败时静默回退。
//
//   备路径（1250-1389）：queryModelWithStreaming
//     ——普通流式请求，system prompt 只有一句话，工具只有 FileReadTool。
//        贵，但简单可靠。
//
// 【为什么要"分叉一个 agent"而不是直接调 API】
// 因为只有走 `query()` 那条路，才能保证发出去的参数（system / tools /
// model / thinking config / 消息前缀）**与主线程逐字节相同**。
// 任何一个参数不同，prompt cache 就不命中。
//
// 这也是为什么 1181 行那段注释死活不让设 `maxOutputTokens`——
// 后面细讲，那是全文件最精妙的一处。
// ═══════════════════════════════════════════════════════════════'''),

(1151, 'before', '''// 注释说 "Falls back to regular streaming path on failure"。
//
// 注意"失败"包含两类：
//   · 抛异常（1240 行的 catch）
//   · 没拿到有效文本（1231 行）
//
// 两类都**静默**回退，只打一个 `tengu_compact_cache_sharing_fallback` 埋点。
// 不弹任何用户可见的错误——因为回退本身是正常的，
// 用户只关心"压缩有没有成功"，不关心走的是哪条路。
//
// 【这个开关在同一个文件里被读了两次】
//   435 行：决定要不要打 `promptCacheSharingEnabled` 进埋点
//   1155 行：决定走哪条路径
//
// 两处读同一个 GrowthBook key，值一样（都是 CACHED_MAY_BE_STALE）。
// 但 435 行那次读是在 `compactConversation` 里，1155 行在
// `streamCompactSummary` 里——后者是被前者调用的。
// 所以同一次压缩里读了两遍同一个配置。
//
// 【这不是 bug，但是一个隐患】
// `getFeatureValue_CACHED_MAY_BE_STALE` 的语义是"可能过期"。
// 如果两次读之间 GrowthBook 刷新了，埋点里记的值和实际走的路径会不一致。
// 概率很低（同一个函数调用内），但埋点数据就不可靠了。'''),

(1167, 'before', '''// ═══ 每 30 秒的保活信号，这个设计值得讲 ═══
//
// 注释：
//   "Compaction API calls can take 5-10+ seconds, during which no other
//    messages flow through the transport — without keep-alives, the server
//    may close the WebSocket for inactivity."
//
// 场景：远程会话（CCR / 云端）通过 WebSocket 连着服务端。压缩期间
// 5-10 秒没有任何消息流动 → 服务端认为连接空闲 → 关掉 WebSocket
// → 压缩结果回不来，用户看到"中断"。
//
// 两种保活信号：
//   1. `sendSessionActivitySignal()` —— PUT /worker 心跳
//   2. `statusSetter?.('compacting')` —— 重新发一次状态事件，
//      让 SDK 事件流保持活跃
//
// 【`setInterval` 的第三个参数是个巧思】
//   `setInterval(fn, 30_000, context.setSDKStatus)`
//
// `setInterval` 支持在延迟之后传**额外的参数**，它们会被原样传给回调。
// 所以这里的回调签名写成 `(statusSetter?) => {...}`，
// 靠这个参数拿到 `setSDKStatus`。
//
// 为什么不在闭包里直接用 `context.setSDKStatus`？因为那样
// 每 30 秒都要解引用一次 `context` 对象，而这个闭包会活很久。
// 传参是把值**捕获在定时器注册时**——虽然实际上 `context` 也一样被捕获了……
//
// 【老实说这个写法没多少性能收益】
// 它更大的价值是**显式表达依赖**：读代码的人一眼看到
// "这个定时器需要 setSDKStatus"，而不用翻回调体去找。
//
// 注意 `activityInterval` 可能是 `undefined`（不在远程会话时），
// 1394 行的 `clearInterval(undefined)` 是合法的空操作。'''),

(1181, 'before', '''// ═══ 这是全文件最精妙的一段注释，逐句拆 ═══
//
//   "DO NOT set maxOutputTokens here. The fork piggybacks on the main thread's
//    prompt cache by sending identical cache-key params (system, tools, model,
//    messages prefix, thinking config)."
//
// 第一句：不要在这里设 maxOutputTokens。为什么？因为分叉出来的 agent
// 要复用主线程的缓存，前提是**缓存键参数完全相同**。缓存键包含
// system / tools / model / 消息前缀 / **thinking config**。
//
//   "Setting maxOutputTokens would clamp budget_tokens via
//    Math.min(budget, maxOutputTokens-1) in claude.ts, creating a thinking
//    config mismatch that invalidates the cache."
//
// 第二句才是关键：在 claude.ts 里，`maxOutputTokens` 会**间接改动
// thinking config**——具体是 `budget_tokens = Math.min(budget, maxOutputTokens - 1)`。
//
// 也就是说：
//   · 主线程：maxOutputTokens = 32000 → budget_tokens = min(10000, 31999) = 10000
//   · 压缩设了 8000：→ budget_tokens = min(10000, 7999) = **7999**
//
// 7999 ≠ 10000，thinking config 变了 → **整个缓存作废**。
//
// 而如果你觉得"那我干脆把 thinking 关掉？"——也不行，因为
// `thinkingConfig` 本身就在缓存键里，关掉同样不命中。
//
// 【最狠的一点：这个耦合是隐式的】
// 设 `maxOutputTokens` 的人根本想不到它会改 `budget_tokens`；
// 改 `budget_tokens` 的人想不到它会毁掉缓存。两个模块
// （compact.ts 和 claude.ts）之间靠一个 `Math.min` 隐式耦合。
// 唯一的防御就是这段注释。
//
//   "The streaming fallback path (below) can safely set maxOutputTokensOverride
//    since it doesn't share cache with the main thread."
//
// 最后一句给了出路：备路径（1317 行）可以随便设，因为它本来就不共享缓存。
// 所以你会看到同一个文件里，一条路径严禁设、另一条路径必须设——
// **看起来矛盾，实际完全合理**。读到这里如果不看注释，一定会以为写错了。'''),

(1188, 'before', '''// 五个参数，每个都有讲究：
//
//   promptMessages: [summaryRequest]
//     ——只传摘要指令这一条。历史从 `cacheSafeParams` 里取（那是主线程的），
//        不从这里传。这就是为什么 PTL 重试时要改 `forkContextMessages`
//        而不只是改 `messages`（487 行那段）。
//
//   canUseTool: createCompactCanUseTool()
//     ——全 deny，见 1125 行。
//
//   querySource: 'compact'
//     ——埋点归因用。`withRetry` 的 529 白名单也看这个值
//        （`querySource` 是后台路径的话不重试）。
//
//   forkLabel: 'compact'
//     ——给 UI / 日志区分不同用途的分叉（还有 'title'、'suggestion' 等）。
//
//   maxTurns: 1
//     ——只准跑一轮。多轮意味着可能有 tool_use → tool_result 循环，
//        那会浪费大量 token 且完全没有必要。
//
//   skipCacheWrite: true
//     ——**这个很重要**：不让这次请求写缓存。
//        因为压缩请求的前缀虽然和主线程相同，但它后面接的
//        （摘要指令）是临时的。如果它写缓存，会污染主线程的缓存条目，
//        让后续真实请求命中一段"末尾是摘要指令"的错误缓存。
//
//        代价：不写缓存 = 下次压缩还得重新读一遍（但读比写便宜得多，
//        而且主线程本来就会持续写，所以不影响）。
//
//   overrides: { abortController: context.abortController }
//     ——注释专门解释了：让用户按 Esc 能中断分叉，
//        和备路径的 `signal: context.abortController.signal`（1307 行）
//        用同一个信号。'''),

(1201, 'before', '''// 从分叉 agent 返回的完整消息数组里，取最后一条 assistant 消息。
//
// 因为 `maxTurns: 1`，理论上只有一条 assistant。但取"最后一条"
// 而不是"第一条"，是为了防御性容错——万一有额外的边界消息。
//
// `getAssistantMessageText` 会把 content 数组里的所有 text 块拼起来。
// 如果只有 thinking 块没有 text 块，返回空字符串/null。'''),

(1205, 'before', '''// ═══ 这个守卫是修一个真 bug 留下的 ═══
//
// 注释：
//   "Guard isApiErrorMessage: query() catches API errors (including
//    APIUserAbortError on ESC) and yields them as synthetic assistant
//    messages. Without this check, an aborted compact 'succeeds' with
//    'Request was aborted.' as the summary — the text doesn't start with
//    'API Error' so the caller's startsWithApiErrorPrefix guard misses it."
//
// 完整还原这个 bug：
//
//   1. 用户按 Esc 中断压缩
//   2. `query()` 内部 catch 住 `APIUserAbortError`，包装成一条
//      **合成的 assistant 消息**（`isApiErrorMessage: true`），
//      文本是 `"API Error: Request was aborted."`
//   3. 这个守卫**当时不存在**，所以把这条消息当成了摘要
//   4. 调用方（459 行）拿到 `summary = "API Error: Request was aborted."`
//   5. 检查 `startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)` → 不匹配，break
//   6. 检查 `startsWithApiErrorPrefix(summary)` → 这里本该抓到，
//      但注释说 "the text doesn't start with 'API Error'" ——
//      说明**某个版本的文案里没有这个前缀**（可能是
//      `'Request was aborted.'` 单独出现）
//   7. 于是压缩"成功"了，摘要内容是"请求被中断"
//   8. 用户的历史被替换成这句话 → **数据丢失**
//
// 这是一个"中断被当成成功"的经典事故。修复的关键不是改文案，
// 而是用**结构化的标志**（`isApiErrorMessage`）判断，
// 而不是靠文本前缀。这正好呼应 507 行那里用字符串判断的脆弱性。
//
// 【一条通用经验】
// 用文本匹配判断"这是不是错误"永远会漏。有结构化字段就用结构化字段。
// 这个文件里两种写法都有，正是"历史演进"的痕迹：
// 新的地方（这里）用标志位，老的地方（507 行）还在用字符串前缀。'''),

(1213, 'before', '''// PTL 错误文本**不记 success**。
//
// 因为 PTL 是"这次没成功，调用方会砍历史重试"。如果记成 success，
// 埋点里 `tengu_compact_cache_sharing_success` 的数量会虚高，
// 而且 cacheHitRate 也会被这些本该失败的请求污染。
//
// 注意它**照样 return 了** 这条消息（1229 行）——
// 所以调用方会拿到它，走进重试循环。这里只是不打 success 埋点，不是不返回。
//
// 【这个区分很细致】
// "调用方需要知道失败" 和 "埋点需要知道失败" 是两件事：
//   · 调用方：靠返回值里的文本前缀判断（460 行）
//   · 埋点：靠这里跳过 logEvent
//
// 两处判断同一个事实，但因为信息流向不同，必须各判一次。'''),

(1231, 'before', '''// 走到这里说明分叉路径"跑完了但没拿到有效文本"。
//
// `jsonStringify(assistantMsg)` 可能是 `undefined`（一条消息都没有），
// 也可能是纯 thinking 消息。日志级别是 `warn` 不是 `error`——
// 因为回退是预期内的，不是故障。'''),

(1250, 'before', '''// ═══ 备路径：普通流式请求 ═══
//
// 和主路径的差别，列一下：
//
//              主路径（forked）            备路径（直接流式）
//   system    主线程的完整 system prompt    只有一句话
//   tools     主线程的全部工具              最多 FileReadTool + ToolSearchTool + MCP
//   历史      主线程的完整前缀              从最后一个 compact boundary 开始
//   缓存      命中                         **不命中**（前缀完全不同）
//   成本      低                            高（全价）
//   可靠性    依赖分叉机制                  简单直接
//
// 注释里那句 "Regular streaming path (fallback when cache sharing fails
// or is disabled)" 说得很平淡，但**这条路径才是保底**：
// 主路径可能因为各种原因失败（GrowthBook 关了、fork 出错、模型返回异常），
// 每次都得有一条能跑通的路。
//
// 【一个设计原则】
// 任何"为了优化而存在的复杂路径"，都必须有一条"简单但昂贵"的备胎。
// 而且备胎必须**默认能跑**——不能也需要某个开关才生效。'''),

(1263, 'before', '''// 判断要不要启用工具搜索（ToolSearchTool）。
//
// 第三个参数 `async () => appState.toolPermissionContext` 是个**回调**
// 而不是值——因为 `isToolSearchEnabled` 内部要按权限过滤工具，
// 而 appState 可能在这期间变化。传回调能拿到最新值。
//
// 第五个参数 `'compact'` 是 querySource，用于埋点归因和权限判断。
//
// 【注意 1264 行的注释】
// "context.options.tools includes MCP tools merged via useMergedTools"
//
// 这是一个容易踩的坑：`appState.mcp.tools` 是**原始** MCP 工具列表
// （没经过权限过滤），而 `context.options.tools` 是合并 + 过滤后的。
// 用错了会把用户已经禁用的工具又发出去。'''),

(1273, 'before', '''// ═══ 这段注释透露了一个 API 内部机制 ═══
//
//   "They get defer_loading: true and don't count against context - the API
//    filters them out of system_prompt_tools before token counting (see
//    api/token_count_api/counting.py:188 and api/public_api/messages/handler.py:324)."
//
// 翻译：带 `defer_loading: true` 的工具，API 在**计数 token 之前**
// 就把它们从工具列表里过滤掉了。也就是说：
// **发过去的工具定义不占上下文预算。**
//
// 这是"延迟加载工具"能成立的根本原因。否则把几百个 MCP 工具
// 的 schema 全塞进请求，光工具定义就几十万 token。
//
// 注释里还给了**服务端代码的路径和行号**（`counting.py:188`、
// `handler.py:324`）。这在客户端代码里非常罕见，说明有人在
// 追这个问题时真的去翻了服务端仓库，然后把证据留在了注释里。
//
// 【这类注释的价值】
// 半年后有人怀疑"defer_loading 到底占不占 token"，能直接顺着
// 行号去验证，不用重新做实验。'''),

(1281, 'before', '''// 三元表达式：要么"三个工具"，要么"一个工具"。
//
// 启用了工具搜索：FileReadTool + ToolSearchTool + 所有 MCP 工具
//   ——为什么压缩要 FileRead？因为摘要可能要求"引用相关文件内容"，
//      而且附件恢复机制也要读文件
//   ——为什么需要 ToolSearchTool？因为 MCP 工具是 deferred 的，
//      模型得有个东西去搜索/加载它们
//
// 没启用：只有 FileReadTool
//   ——最小集。压缩 99% 的情况只需要写摘要，不需要任何工具
//
// 【`uniqBy(..., 'name')` 是在防一个真实的 API 错误】
// 注释："Deduplicate by name to avoid API errors when MCP tools
// share names with built-in tools."
//
// MCP 服务器可以随便起名，完全可能有个叫 `Read` 的工具。
// 两个同名工具发过去，API 直接报错。
//
// 【`uniqBy` 保留第一个】
// 数组顺序是 `[FileReadTool, ToolSearchTool, ...mcpTools]`，
// 所以同名时保留内置的，丢掉 MCP 的。这个优先级是对的：
// 内置工具的语义和行为是确定的。'''),

(1292, 'before', '''// 构造流式请求。参数分两组看：
//
// 【内容组】
//   messages：
//     `getMessagesAfterCompactBoundary(messages)` —— **只取最后一个边界之后的消息**。
//       为什么要这样？因为如果之前已经压缩过一次，边界之前的消息
//       已经被摘要替代了，再发一遍纯属浪费 token（而且可能是重复的旧历史）。
//       `...summaryRequest` 追加在末尾 —— 就是"请写摘要"那条指令。
//
//     然后串了三层处理：
//       `stripReinjectedAttachments(...)`  剥掉会被重新注入的附件
//       `stripImagesFromMessages(...)`     剥掉图片
//       `normalizeMessagesForAPI(...)`     转成 API 格式（合并连续同类消息、
//                                          处理 tool_result 配对等）
//
//     **注意处理顺序**：先剥附件、再剥图、最后 normalize。
//     如果先 normalize，图片 block 可能被合并进别的结构里，就剥不掉了。
//
//   systemPrompt：只有一句话，见 1302 行
//   thinkingConfig：`disabled`
//   tools：上面 1281 行算出来的
//
// 【控制组】
//   1317 行 maxOutputTokensOverride：见那里的注释
//   1321 行 querySource: 'compact'
//   1311 行 getToolPermissionContext：又是一个回调，拿最新权限'''),

(1302, 'before', '''// 备路径的 system prompt 只有这一句话：
//   "You are a helpful AI assistant tasked with summarizing conversations."
//
// 对比主路径（复用主线程的完整 system prompt，约 10K token）。
//
// 这个差别不只是省 token——它彻底改变了摘要的**风格**：
//   · 主路径：摘要器带着完整的 Claude Code 人设和工具使用规范，
//     写出来的摘要会偏向"工程实现细节"
//   · 备路径：一个普通的摘要助手，写出来更通用
//
// 备路径的摘要质量通常**不如**主路径，这也是为什么主路径默认开启。
// 但备路径有个好处：**行为可预测**。它不会被主 system prompt 里的
// 各种特殊指令影响（比如"不要用 emoji"、"回答要简短"），
// 那些指令对摘要任务未必合适。
//
// `asSystemPrompt([...])` 这个包装函数是类型层面的标记，
// 把 `string[]` 转成一个带 brand 的类型——防止把用户输入误当成
// system prompt 传进去（安全问题）。'''),

(1305, 'before', '''// 压缩时禁用 thinking。
//
// 两个理由：
//   1. **省钱**：thinking 的 token 也要计费，而且往往比正文还多
//   2. **速度**：压缩是阻塞操作，用户会等。thinking 会显著变慢
//
// 更重要的是：摘要任务**不需要推理**。它只是"把发生的事按顺序写下来"，
// 没有任何需要多步思考的推理链。
//
// 【注意这里和主路径的差异】
// 主路径（forked agent）**不能**改 thinkingConfig——因为那在缓存键里。
// 所以主路径的摘要器实际上是**带着主线程的 thinking 配置跑的**。
// 如果主线程开着 thinking，压缩请求也会 thinking，多花一笔钱。
//
// 这是一个已知的取舍：为了缓存命中，接受了 thinking 的开销。
// 从 435 行那个 98% cache miss / 380 亿 token 的数据看，
// 这笔账算得过来。'''),

(1317, 'before', '''// ═══ 备路径可以放心设 maxOutputTokens（主路径不行，见 1181 行） ═══
//
// 取 `COMPACT_MAX_OUTPUT_TOKENS` 和模型上限的较小值。
//
// 为什么要取 min？
//   —— `COMPACT_MAX_OUTPUT_TOKENS` 是"摘要需要多少输出"的经验上限
//      （几千 token，摘要不该写成长篇大论）
//   —— `getMaxOutputTokensForModel` 是模型硬上限（比如 Haiku 可能只有 8K）
//
// 如果只写前者，在输出上限较小的模型上会报错。
// 如果只写后者，在输出上限很大的模型上会允许摘要写到几万 token——
// 既慢又贵，而且超出部分通常是无意义的重复。
//
// 【`Math.min` 在这里是安全的，因为本路径不共享缓存】
// 1181 行说得很清楚：备路径可以随便设，因为它的前缀本来就
// 和主线程不同，不存在"改动导致缓存失效"的问题。
//
// 同一个文件里两条路径对同一个参数采取相反的策略，
// 是这一节最值得记住的地方。'''),

(1327, 'before', '''// ═══ 不用 `for await`，而是手动拿迭代器 ═══
//
// 写法对比：
//
//   for await (const event of streamingGen) { ... }        ← 常见写法
//   const it = streamingGen[Symbol.asyncIterator]()        ← 这里
//   let next = await it.next()
//   while (!next.done) { ...; next = await it.next() }
//
// 为什么手动？因为**需要在循环外检查"有没有拿到 response"**（1359 行）。
// `for await` 里拿到的 `event` 出了循环就没了，而这里要留一个
// `response` 变量在循环外判断。
//
// 其实用 `for await` + 外部 `let response` 也能做到……
//
// 【真正的原因是更微妙的一件事】
// 手动迭代允许**在循环中点提前退出**而不触发生成器的 `return()`。
// `for await` 里 `break` 会自动调用 `iterator.return()`，那会让
// 生成器执行 finally 块（比如 claude.ts 里的资源清理）。
//
// 这里虽然实际上没 break（一直读到 done），但保持手动模式
// 让"以后想加提前退出"变得简单。
//
// 老实说这个理由有点弱。更可能的解释是：这段代码是从别处
// 复制过来的，原处确实需要手动控制。这类"看起来没必要的手动迭代"
// 在长命代码里很常见。'''),

(1333, 'before', '''// 第一个 text 内容块到达 → 把 UI 从"请求中"切到"响应中"。
//
// `!hasStartedStreaming` 保证只切一次。
//
// 为什么等 text 块而不是更早（比如 message_start）？
// 因为 `message_start` 到达时可能只有 thinking 块，
// 用户还看不到任何文字。等第一个 text 块到了再切状态，
// 进度条上的"正在思考"→"正在输出"才是准的。
//
// 注意这个变量的另一个用途：1367 行把它记进重试埋点。
// `hasStartedStreaming: false` 意味着"连一个字都没出就失败了"，
// 这种失败更像是网络/服务端问题；`true` 则说明"说到一半断了"。
// 两种失败的排查方向完全不同。'''),

(1343, 'before', '''// 累加已流出的字符数，给 UI 显示进度用。
//
// `setResponseLength?.(length => length + charactersStreamed)`
// 传的是**函数**而不是值——因为 setState 是异步批处理的，
// 直接传 `currentLength + n` 会拿到过期的闭包值。
//
// 【为什么按字符数而不是 token 数】
// 字符数在流式过程中可以精确累加（每个 delta 都有 `.text.length`），
// 而 token 数只有在 message_delta 到达时才知道。
// UI 需要的是"感觉上的进度"，字符数够了。
//
// 注意这里用的是 `text_delta` 的 `.text.length`，
// 一个 delta 可能包含多个字符（不是逐字符到达的）。'''),

(1352, 'before', '''// 只保留**最后一条** assistant 消息。
//
// `queryModelWithStreaming` 会 yield 多种事件：`stream_event`（每个 SSE 块）、
// `assistant`（一条完整的消息）、`result` 等。这里只关心 `assistant`。
//
// 直接赋值（不是 push 到数组），因为压缩场景**只可能有一条** assistant
// ——`maxTurns: 1` 保证了这一点。多条的话留最后一条也是合理的
// （最后一条是最完整的）。
//
// 注意 `stream_event` 只是用来驱动 UI 进度，真正的结果从 `assistant` 拿。
// 这是 `queryModelWithStreaming` 的双通道设计：yield 是流，assistant 是结果。
// 第 5 步读 `query.ts` 时讲过的"双通道 async generator"在这里的具体应用。'''),

(1359, 'before', '''// 拿到了就立刻返回，不管 `hasStartedStreaming` 是什么状态。
//
// 【这里有一个隐含的正确性假设】
// 只要有一条 `assistant` 消息，就认为成功——**不检查它的内容是否为空**。
//
// 如果模型返回了一条空内容的 assistant 消息呢？`response` 非空，
// 这里返回它，然后调用方 `getAssistantMessageText` 返回空 →
// 走 `no_summary` 失败分支。
//
// 所以"空内容"最终也会被正确识别，只是绕了一圈。
// 这个分工挺清晰：这里判"有没有消息"，上层判"消息里有没有文本"。'''),

(1363, 'before', '''// 没拿到 response 且还有重试机会 → 退避后重试。
//
// `getRetryDelay(attempt)` 是从 `withRetry.ts` 导进来的同一个函数
// （第 6 步第一个文件里读过）：500ms × 2^(n-1) + 正抖动，32s 封顶。
//
// 注意第三个参数：
//   `{ abortError: () => new APIUserAbortError() }`
// ——`sleep` 在信号被 abort 时要抛什么错误？这里指定抛
// `APIUserAbortError`，而不是默认的 `AbortError`。
//
// 为什么？因为上层（1205 行附近）用 `isApiErrorMessage` 判断，
// 而 `query()` 对 `APIUserAbortError` 有特殊处理（包装成合成消息）。
// 用别的错误类型会让中止变成"未知错误"，用户看到莫名其妙的失败。
//
// 【`abortError` 是函数不是实例】
// 因为每次都要 new 一个新的错误对象（错误对象带 stack trace，
// 复用会指向第一次创建的位置，排查时误导人）。'''),

(1393, 'before', '''// finally 只做一件事：清定时器。
//
// 但注意 1394 行的 `clearInterval(activityInterval)` —— 如果
// `activityInterval` 是 `undefined`（不在远程会话），这是空操作，安全。
//
// 【这个 finally 的位置很关键】
// 它在 `try` 块的最外层（1178 行开始），意味着**无论是成功返回、
// 抛异常、还是被中止，定时器都会被清掉**。
//
// 如果漏了这个 finally，每次压缩都会泄漏一个 30 秒间隔的定时器。
// 一个长时间运行的会话压缩 50 次，就有 50 个定时器在后台空转，
// 每秒发 50 次心跳请求——这是很典型的资源泄漏。
//
// 1391-1392 行那句 "This should never be reached" 是给 TS 的
// 控制流分析看的（for 循环理论上可能正常结束），实际到不了。'''),

(1398, 'before', '''// ═══════════════════════════════════════════════════════════════
// 压缩后的"信息重建"区（1398-1705）
//
// 从这里到文件结尾，全是 `createXxxAttachment` 系列函数。
// 它们不参与"压缩"本身，只负责回答一个问题：
//
//   **压缩丢掉了什么？补回来。**
//
// 一共七个：
//   1415  createPostCompactFileAttachments   最近读过的文件
//   1470  createPlanAttachmentIfNeeded       当前 plan 文件
//   1494  createSkillAttachmentIfNeeded      调用过的技能
//   1542  createPlanModeAttachmentIfNeeded   plan mode 状态
//   1568  createAsyncAgentAttachmentsIfNeeded 后台 agent
//   1610  collectReadToolFilePaths           （辅助）扫已读文件路径
//   1674  shouldExcludeFromPostCompactRestore（辅助）排除不该恢复的
//
// 【读这一区的正确心态】
// 不要把它们当成"附赠功能"。每一个都对应一种**真实的能力退化**，
// 而且都是在生产上踩过坑才加的。
//
// 判断一个"压缩后要补什么"的方法是问：
//   "这条信息只存在于消息历史里吗？压缩后会彻底消失吗？
//    消失之后模型会做出什么错误行为？"
// 三个问题都有答案，就该加一个 attachment。
// ═══════════════════════════════════════════════════════════════'''),

(1421, 'before', '''// ═══ 先算出"保留段里已经有的文件"，然后排除它们 ═══
//
// doc 注释里的关键句：
//   "Files already present as Read tool results in preservedMessages are
//    skipped — re-injecting identical content the model can already see in
//    the preserved tail is pure waste (up to 25K tok/compact)."
//
// 翻译：局部压缩保留了尾巴，而尾巴里可能就有某些文件的完整 Read 结果。
// 如果再注入一遍，最多白花 25,000 token（= 5 个文件 × 5,000）。
//
// 注意"up to 25K"这个数字——它正好是前面三个常量的乘积上限。
// 说明这个优化在最坏情况下省掉整个附件预算。
//
// `expandPath` 归一化两边路径，否则 `./a.ts` 和 `/abs/a.ts`
// 会被当成两个不同文件。
//
// 【1429 行 `!preservedReadPaths.has(...) && !shouldExclude(...)`】
// 两个条件必须都在 filter 里，不能只判一个：
//   · preservedReadPaths：已经能看见的，别重复
//   · shouldExclude：plan 文件和 CLAUDE.md，**永远**不该当"文件内容"恢复
//     （它们有自己的专用附件）'''),

(1434, 'before', '''// 并发读所有候选文件。
//
// `recentFiles` 已经 `.slice(0, maxFiles)` 限制到 5 个了，
// 所以这里并发数最多 5，不会打爆文件描述符。
//
// 【注意 1440 行这个覆盖】
//   `{ ...toolUseContext, fileReadingLimits: { maxTokens: POST_COMPACT_MAX_TOKENS_PER_FILE } }`
//
// 用展开运算符**浅拷贝上下文**，然后覆盖一个字段。
// 这样 `generateFileAttachment` 拿到的上下文是正常的（权限、agentId 等都在），
// 只有读文件的 token 上限被改了。
//
// 为什么不直接改 `toolUseContext.fileReadingLimits`？
// 因为那是共享对象，改了会影响后续所有 Read 操作——用户手动 Read
// 一个文件也会被限制在 5,000 token，行为就变了。
//
// 【最后两个参数是埋点名】
// `'tengu_post_compact_file_restore_success'` / `'..._error'`
// 分开记成功和失败，可以看出"恢复文件"这个操作的健康度。
// 如果 error 率很高（比如文件被删了），说明这个机制在空转。'''),

(1452, 'before', '''// ═══ 预算检查放在最后，而不是并发时 ═══
//
// 为什么不边读边算？因为**并发读的时候还不知道每个结果多大**。
// `Promise.all` 返回后才知道全部大小，所以只能在这之后累加。
//
// `filter` + 闭包变量 `usedTokens` 是一种"带状态的 filter"，
// 虽然有点 hack，但比 `reduce` 更易读：
//   累加后没超预算 → 留下
//   超了 → 丢弃（**并且不累加**，所以后面的小文件还有机会）
//
// 【注意这个行为：超过预算的文件被丢弃，不是截断】
// 和技能那边（1512 行 `truncateToTokens`）不同，这里直接丢。
//
// 为什么？因为文件内容**不能截断**——截断的代码文件比没有更危险
// （模型会基于残缺代码做判断，还会以为自己看全了）。
// 而技能文件截断是安全的（前面说了价值头重脚轻）。
//
// 这个对照很能说明问题：**同样的"超预算"问题，两种内容要用两种策略**。
//
// `result is AttachmentMessage` 这个类型谓词是为了让 TS 知道
// 过滤后的数组里没有 null（`generateFileAttachment` 可能返回 null，
// 比如文件不存在或太大）。'''),

(1470, 'before', '''// plan 文件附件。如果这个会话/agent 有 plan，就把完整内容带上。
//
// 为什么 plan 要完整带，而普通文件要截断？
// 因为 plan 是**模型自己写的执行计划**，它接下来要照着做。
// 截断一份计划比没有计划更糟——模型会以为计划只到被截断的地方。
//
// 而 plan 文件通常不大（几 KB），不构成预算压力。
//
// 【`getPlan(agentId)` 和 `getPlanFilePath(agentId)` 是两个独立查询】
// 前者查内容，后者查路径。理论上可以先查路径再读文件，
// 但那样会多一次磁盘 I/O。这里用两个内存查询，路径只是给模型
// 一个"完整文件在哪"的指针。
//
// 【plan 内容在附件里，路径也在附件里——为什么两者都要】
// 内容让模型**立刻**能继续执行（不用调工具）。
// 路径让模型**需要修改 plan 时**知道该改哪个文件。
// 缺一个都会多一轮工具调用。'''),

(1488, 'before', '''// ═══ 技能附件，这段的设计值得细看 ═══
//
// doc 注释里的两个关键约束：
//   1. "Only includes skills scoped to the given agent (or main session
//       when agentId is null/undefined)"
//      ——**按 agent 隔离**。子 agent 调用过的技能不该泄漏给主会话，
//        反之亦然。因为不同 agent 的职责完全不同，
//        把另一个 agent 的技能 guidelines 塞进来只会造成干扰。
//
//   2. "This ensures skill guidelines remain available after the conversation
//       has been summarized"
//      ——关键词是 **guidelines**。技能文件的核心价值是"规范"
//        （输出格式要求、必须检查的项、禁止的做法），
//        而不是"知识"（那些模型本来就知道）。
//
// 【为什么是"调用过的"技能，而不是"全部可用"技能】
// 全部可用 = skill_listing，约 4K token，而且会被重新推送（见 524 行）。
// 调用过的 = 真正加载过全文的那些，它们的内容已经被压缩吃掉了，
// 必须补回来。
//
// 这个区分很重要：**补的是"曾经在上下文里、现在没了"的东西**，
// 不是"未来可能需要"的东西。'''),

(1503, 'before', '''// 排序 + 截断 + 预算，三步。
//
// 【排序：`b.invokedAt - a.invokedAt` = 最近的在前面】
// 注释："Sorted most-recent-first so budget pressure drops the least-relevant
// skills."
//
// 这是让**预算检查**（1517 行）自动实现优先级：filter 是从前往后走的，
// 预算用完就 return false，所以后面的（更早的）先被丢。
// 一个 `sort` 就把"丢哪个"的策略表达完了，不需要额外的权重计算。
//
// 【截断：`truncateToTokens(content, 5000)`】
// 注释："Per-skill truncation keeps the head of each file (where
// setup/usage instructions typically live) rather than dropping whole skills."
//
// 又是"砍尾巴胜过丢整体"。和 125 行那段注释说的是同一件事。
//
// 【为什么单个上限 5,000，总预算 25,000】
// 5 × 5,000 = 25,000，刚好能装 5 个技能。
// 但这不意味着"最多 5 个"——如果每个技能只有 1,000 token，
// 可以装 25 个。两个限制是独立的。'''),

(1517, 'before', '''// 预算 filter，和文件那边（1453 行）结构一样，但有三个差别：
//
//   1. 这里用 `skill.content`（已经截断过的）算 token，
//      所以单个技能不会超过 5,000
//   2. 超预算的技能**跳过但继续检查后面的**（filter 的语义），
//      而不是提前 break —— 所以可能出现"第 3 个太大被跳，
//      第 4 个小被收"的情况
//   3. 返回 `false` 时不累加 `usedTokens`，所以后面的小技能还有机会
//
// 【第 2 点会导致一个奇怪的结果】
// 最终选中的技能可能**不是**"最最近的 N 个"，而是"最近的里面装得下的"。
// 这在预算紧张时会造成"跳过了一个高优先级的大技能，选了低优先级的小技能"。
//
// 是不是 bug？取决于产品意图。从 1503 行的排序注释看，
// 作者想要的是"预算压力时丢最不相关的"。而现在的实现是
// "装不下就跳，继续找装得下的"——这其实更合理：
// 一个 4,900 token 的最近技能 vs 三个 1,000 token 的次近技能，
// 后者信息量更大。'''),

(1536, 'before', '''// plan mode 附件。
//
// doc 注释揭示了一个容易忽略的机制：
//   "otherwise it would lose the plan mode instructions since those are
//    normally only injected on tool-use turns via getAttachmentMessages"
//
// 翻译：plan mode 的指令**不是每轮都发**，而是只在"有工具调用的轮次"
// 通过 `getAttachmentMessages` 注入。
//
// 为什么这样设计？因为 plan mode 的指令很长（"你现在只能做只读操作，
// 输出一份方案，不要改代码…"），每轮都发纯属浪费。
// 而只在要调工具时提醒，是最有效的时机。
//
// 但压缩之后，历史里那些"tool-use 轮次注入的 plan mode 指令"
// 全被摘要吃掉了。摘要里可能写着"用户要求先出方案"，
// 但那不是**可执行的指令**——模型会开始直接改代码。
//
// 所以必须补一个 `reminderType: 'full'` 的完整版（不是简版）。
//
// 【`isSubAgent: !!context.agentId`】
// 主会话和子 agent 的 plan mode 行为不同（子 agent 可能不允许进 plan 模式），
// 所以附件里要标明身份。`!!` 把 `AgentId | undefined` 转成 boolean。'''),

(1562, 'before', '''// 后台 agent 附件。两种状态都要带：
//   · `running`   —— 还在跑（不告诉模型，它会重复 spawn 同一个任务）
//   · 已完成但没取结果 —— 不告诉模型，它不会去取，结果白算
//
// 注释："Covers both agents still running in the background (so the model
// doesn't spawn a duplicate) and agents that have finished but whose results
// haven't been retrieved yet."
//
// 【这两个场景的后果不对称】
//   · 重复 spawn：浪费一次完整执行（可能几分钟 + 大量 token）
//   · 忘记取结果：浪费一次完整执行，**而且用户拿不到结果**
//
// 后者更糟。所以即使 agent 已经完成，只要 `retrieved === false` 就要带上。'''),

(1577, 'before', '''// 三个跳过条件，各有理由：
//
//   `agent.retrieved`        —— 结果已经被取走了，模型知道了，不用再提
//   `agent.status === 'pending'` —— 还没真正启动，没有可报告的状态
//   `agent.agentId === context.agentId` —— **自己**。压缩 agent 自己
//                               在 `appState.tasks` 里也是一条记录，
//                               报告"我自己在跑"毫无意义
//
// 【第三个条件最容易漏】
// 如果不排除自己，压缩后的上下文里会出现"有个叫 compact 的 agent
// 正在运行"——模型会以为有个后台任务，可能会去等它或者查它。
// 而那个 agent 其实就是刚刚做完压缩的这个。
//
// 【`deltaSummary` 的取值逻辑也值得看】
//   running → `agent.progress?.summary`（进度摘要）
//   否则    → `agent.error`（错误信息）
//
// 也就是说"失败的 agent 会带上错误原因"。这样模型看到后
// 能判断"该重试还是该换方案"，而不是只知道"失败了"。
//
// `outputFilePath` 是结果文件路径（`getTaskOutputPath`）。
// 即使 `retrieved: false`，模型也能自己去读那个文件——
// 这个设计比"直接把结果塞进附件"省 token。'''),

(1601, 'before', '''// ═══ 扫已读文件路径，用来去重 ═══
//
// 这个函数要扫两遍消息，但不是为了性能——是因为**必须先知道
// 哪些 tool_use_id 是"桩"，才能正确地收集路径**。
//
// 第一遍（1611-1625）：收集所有"返回了 FILE_UNCHANGED_STUB 的 tool_use_id"
// 第二遍（1627-1653）：收集文件路径，但跳过那些桩对应的 tool_use
//
// 【为什么要跳过桩？doc 注释说得很清楚】
//   "the stub points at an earlier full Read that may have been compacted away,
//    so we want createPostCompactFileAttachments to re-inject the real content."
//
// 场景还原：
//   1. 模型 Read a.ts（完整内容，5,000 token）
//   2. 模型又 Read a.ts（内容没变，返回 "file unchanged" 桩）
//   3. 压缩发生，两步的历史都被摘要吃掉
//   4. 如果只看"最后一条 Read 记录"，会看到桩 → 认为"这个文件已经在上下文里了"
//      → **不恢复**
//   5. 模型以为 a.ts 内容还在，实际上早没了
//
// 所以桩不能算"已读"。必须回溯到最早那次真正的 Read——
// 而最简单的方法就是**不认桩**，让这个文件重新进候选。
//
// 【`FILE_UNCHANGED_STUB` 这个常量是同目录 prompt.ts 导出的】
// 用共享常量而不是硬编码字符串，保证"生桩"和"认桩"两边永远一致。'''),

(1657, 'before', '''// 截断标记，追加在技能内容末尾。
//
// 文本是：
//   "\\n\\n[... skill content truncated for compaction; use Read on the skill
//    path if you need the full text]"
//
// 【这句话是写给模型看的，不是给人看的】
// 它同时完成了三件事：
//   1. 明确说"这里截断了"——避免模型以为技能就到这儿
//   2. 说明**原因**（"for compaction"）——让模型理解这不是技能本身残缺
//   3. 给出**补救方法**（"use Read on the skill path"）——模型知道怎么办
//
// 这是"截断标记"的范本写法。对比一下常见的坏例子：
//   `"..."`                    ← 模型不知道发生了什么
//   `"[truncated]"`            ← 知道被截了，但不知道怎么办
//   `"[content omitted]"`      ← 更糟，模型会以为内容被故意保密
//
// 【前面的 `\\n\\n`】
// 两个换行，保证标记独占一个段落。如果紧贴正文，
// markdown 渲染时可能并进上一行，看起来像是技能内容的一部分。'''),

(1660, 'before', '''// 按 token 数截断，保守估计。
//
// doc 注释把算法说得很清楚：
//   "roughTokenCountEstimation uses ~4 chars/token (its default bytesPerToken),
//    so char budget = maxTokens * 4 minus the marker so the result stays
//    within budget."
//
// 也就是：`charBudget = maxTokens * 4 - marker.length`
//
// 【为什么要减去 marker 的长度】
// 如果不减，`slice(0, maxTokens*4) + marker` 的总长度就超过了
// `maxTokens*4` → 实际 token 数超过 `maxTokens` → 后面的预算检查
// 会把它算得更大，可能导致"明明设了 5,000 上限，实际占了 5,050"。
//
// 这是个很小的细节，但正是这类"差之毫厘"导致了
// "为什么实际 token 数总是超预算一点点"的经典困惑。
//
// 【1670 行没有判 `charBudget < 0`】
// 如果 `maxTokens` 很小（比如 10），`10*4 - 100 = -60`，
// `slice(0, -60)` 会从末尾倒数——返回一个很奇怪的结果。
//
// 但实际调用点（1512 行）传的是 `POST_COMPACT_MAX_TOKENS_PER_SKILL = 5000`，
// 不可能这么小。这是"调用点保证了参数范围，所以函数内不防御"的写法。
// 在内部函数里这种省略很常见，但对外暴露的 API 不该这么写。'''),

(1674, 'before', '''// 排除两类文件，不让它们当"普通文件"恢复：
//
//   1. **plan 文件** —— 它有专用附件（1470 行 `createPlanAttachmentIfNeeded`），
//      那里带的是完整内容 + 路径，比"当普通文件恢复"信息更全。
//      两个都恢复就是重复占预算。
//
//   2. **所有 claude.md 类型的内存文件** —— 它们有专用的加载机制
//      （`loadedNestedMemoryPaths`，520 行刚清空过）。
//      如果当成普通文件恢复，会出现两份 CLAUDE.md 内容，
//      而且可能是不同层级的（项目级 + 用户级 + 子目录级），模型会混乱。
//
// 【两个 try/catch 都是空的（只有注释）】
// 为什么？因为这些函数（`getPlanFilePath`、`getMemoryPath`）
// 在某些环境下会抛（比如拿不到 home 目录）。
// 抛了不能让整个附件生成失败——"排除逻辑"失败的最坏后果是
// "多恢复了一个文件"，远好过"压缩后什么都没恢复"。
//
// 这是一个**降级方向明确**的设计：宁可多恢复，不可不恢复。
//
// 【1690 行那个 TODO 值得注意】
//   "TODO: Refactor to use isMemoryFilePath() from claudemd.ts for consistency
//    and to also match child directory memory files (.claude/rules/*.md, etc.)"
//
// 翻译：现在的实现只匹配"顶层几个固定的内存文件路径"，
// **漏掉了子目录的规则文件**（`.claude/rules/*.md`、子目录里的 CLAUDE.md）。
//
// 这是一个已知的不完整实现。后果：如果用户的项目里有
// 子目录 CLAUDE.md，压缩后可能被当成普通文件重复恢复一份。
// 影响不大（浪费点 token），所以一直没修。'''),
]
