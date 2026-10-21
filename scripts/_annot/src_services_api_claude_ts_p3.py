# -*- coding: utf-8 -*-
"""claude.ts 批注 3/4：queryModel 前半 —— 开关、betas、工具过滤、消息归一化、system 拼装、latch、参数工厂、发流。"""

ANNOTATIONS = [
(1017, 'before', '''// ═══════════════════════════════════════════════════════════════
// queryModel —— 1,881 行，全代码库最长的单个函数
//
// 它是 async generator，但**绝大多数 yield 出去的东西调用方并不关心**：
//
//     yield StreamEvent          流式增量（给 UI 做打字机效果）
//     yield AssistantMessage     一个内容块完成（给上层累积对话）
//     yield SystemAPIErrorMessage 错误/重试提示
//     return void                返回值是空的，结果全靠 yield
//
// 也就是说：调它的人必须边消费边自己拼装状态。
// 这也是为什么 queryModelWithoutStreaming 要写一个「只为跑完」的循环。
//
// 【读这 1,881 行的正确顺序】
//
//   第一步 看 1060-1100   —— betas 怎么来（决定了下面所有 header 逻辑）
//   第二步 看 1538-1729   —— paramsFromContext，这是「一次请求」的完整定义
//   第三步 看 1932-2403   —— for await + switch，这是「一条流」的完整解析
//   其余（过滤、归一化、日志、降级）都是围绕这三段的配套工作。
//
// 【一个容易误解的点】
// 这个函数里所有 `options.xxx` 都是**外部传入的一次性配置**，
// 而所有 `let` 声明的局部变量才是**跨流事件累积的状态**。
// 分辨这两类，1881 行会突然变得有序。
// ═══════════════════════════════════════════════════════════════'''),

(1027, 'before', '''// off-switch：紧急关停开关。
// 注释里那句「先查便宜条件」是性能要求而不是风格偏好：
// getDynamicConfig_BLOCKS_ON_INIT 会 await GrowthBook 初始化（约 10ms），
// 如果放在条件链最前面，每个 Haiku 调用都白等 10ms。
//
// 所以条件顺序是：订阅者判断（同步）→ 模型判断（同步）→ 才会 await。
// 对 haiku/sonnet 这类非自定义 Opus 模型，第一个条件就短路了，await 根本不执行。'''),

(1049, 'after', '''// 这里体现了一个反复出现的原则：**能从数据推导的状态就不要存**。
// previousRequestId 完全由 messages 决定，所以不放进实例字段，
// 也就不会出现「忘了更新」这类 bug。'''),

(1055, 'before', '''// Bedrock 的一个特例：application-inference-profile 是个别名，
// 真实模型藏在 profile 后面。而 max_tokens / thinking 支持度都取决于真模型，
// 所以要先反查一次。这是三家云厂商里唯一需要额外往返的一家。'''),

(1065, 'before', '''// isAgenticQuery 是后面十几个分支的总闸门。
// 语义是「这次调用是不是主对话循环的一部分」：
// 主线程、子 agent、SDK、hook agent、verification agent 算；
// 压缩、摘要、分类、提取记忆这些**辅助调用**不算。
//
// 为什么必须区分：辅助调用如果也带上一堆 beta 头，
// 会让它们的请求体跟主线程不同，缓存键跟着变；而且有些能力
// （advisor、AFK、cache editing）在辅助调用里根本没意义。'''),

(1075, 'before', '''// advisor beta 头**无条件**发送（只要 advisor 开着），
// 哪怕这次是压缩调用、根本没用到 advisor。
// 原因是历史消息里可能残留 advisor 的 server_tool_use 块，
// 不带这个头，API 会把那些块当成未知类型直接拒绝。
// 「为了读得懂历史而声明能力」——这类兼容性考虑在协议层很常见。'''),

(1113, 'after', '''// 注意这里连续三处 `!modelSupportsAdvisor` / `!isValidAdvisorModel` 的降级：
// 不满足条件就只是**跳过**并记一条日志，不报错。
// advisor 是增强能力，配置错了不应该让整个会话跑不起来。'''),

(1120, 'before', '''// ── 工具搜索（动态工具加载）──
//
// 背景：工具太多了。MCP 服务器一连，工具数量可能上百，
// 全量把 schema 塞进请求会让 prompt 膨胀到几十 K token。
//
// 解法：把一部分工具标成「延迟加载」（defer_loading），
// 提示词里只留一行名字，模型需要时调 ToolSearchTool 去搜，
// 搜到之后那部分 schema 才真正出现在下一轮请求里。
//
// 下面这一整段（1120-1257）都在处理这个机制的副作用。'''),

(1128, 'before', '''// 这个「预计算」注释暴露了一个真实的成本问题：
// isDeferredTool 内部要做 2 次 GrowthBook 查询，而工具可能有上百个，
// 放在循环里判断就是几百次配置查询。
// 所以先扫一遍收集名字放进 Set，后面全是 O(1) 判断。'''),

(1139, 'before', '''// 三种情况会关掉工具搜索，这个第三种最容易被漏掉：
//   · 功能没开
//   · 一个延迟工具都没有（没什么可搜的）
//   · **还有 MCP 服务器在连接中** ← 这个必须保留 ToolSearch
// 第三种的道理：服务器连完之后会冒出新工具，模型得有办法发现它们。
// 如果这时把 ToolSearch 关了，新工具永远不会出现在对话里。'''),

(1154, 'before', '''// ⚠ 这是整个工具搜索机制的核心，也是最反直觉的一段：
//
//     只有「已经被发现过」的延迟工具才发给 API。
//
// 而「发现」的证据不在任何变量里，而在**消息历史**里——
// extractDiscoveredToolNames 会扫历史消息，看有没有 tool_reference 块。
//
// 为什么用历史当状态：这样服务器重启、进程恢复、会话续接都不用额外同步，
// 历史里有的就算已发现，历史里没有的就当没发现。无状态推导，永不失配。'''),

(1174, 'before', '''// 工具搜索的 beta 头分三家：
//   第一方 / Foundry → advanced-tool-use
//   Vertex / Bedrock   → tool-search-tool
// 而且 Bedrock 不能走 betas 数组，必须塞进请求体（下面是行 1178 的 if 判断，
// 行 1549 才是真正的 Bedrock 分支）。'''),

(1184, 'before', '''// cached microcompact 的能力检测。
//
// 注意这里用 `await import(...)` 动态导入而不是顶部静态 import：
// 这是 DCE 的另一种写法——动态 import 在 feature() 为假的分支里，
// 打包器可以整块删掉，连模块都不进产物。
// 代价是这里要 await，所以它被放在「只执行一次」的位置（函数体靠前处），
// 而不是 paramsFromContext 里（那里每次重试都会跑）。'''),

(1207, 'before', '''// ── 全局缓存作用域（global cache scope）──
//
// 默认的 prompt cache 是**按组织**隔离的。全局缓存是跨组织共享，
// 命中率更高，但前提是「这段前缀对所有用户都一样」。
//
// 显然，MCP 工具是每个用户各自的（用户名下的服务器和配置），
// 一旦它出现在要缓存的那一段里，全局缓存就不成立了。
// 所以下面要判断「这一轮有没有 MCP 工具会真的渲染出来」。'''),

(1224, 'after', '''// 三种策略值的含义：
//   'system_prompt' → 系统提示词整体走全局缓存（最理想）
//   'none'          → 有 per-user 内容，放弃全局缓存
// 这个值只用于日志/诊断，不参与请求构造——但它决定了
// 后面 buildSystemPromptBlocks 的 skipGlobalCacheForSystemPrompt 参数。'''),

(1231, 'before', '''// 注意两条注释里的对比：**传给 toolToAPISchema 的是完整 tools（不是 filteredTools）**。
// 因为 ToolSearchTool 的提示词里需要列出「所有可搜索的工具名字」，
// 哪怕那些工具这次不发给 API。过滤只影响「实际发送」，不影响「模型看到什么」。'''),

(1259, 'before', '''// ── 消息归一化 ──
//
// normalizeMessagesForAPI 做的是「把内部消息格式压平成 API 能吃的形状」：
// 合并相邻同角色消息、把 isMeta 转成普通文本、去掉内部标记、
// 修正 tool_use / tool_result 的配对。
//
// 为什么必须在拼 system prompt **之前**：fingerprint（行 1325）要对
// 归一化后的消息做哈希，而 fingerprint 会进 system prompt（attribution 头）。
// 顺序错了，哈希算的是另一种形状，缓存键就对不上了。'''),

(1269, 'before', '''// 这段长注释解释了一个「为什么需要两处做同一件事」的问题，非常典型：
//
// normalizeMessagesForAPI 里其实也能剥掉 tool-search 相关字段，但它用的是
// isToolSearchEnabledNoModelCheck()（不带模型判断）。为什么？因为它被约 20 处
// 调用（分析、反馈、分享……），大部分调用方手上没有模型信息，
// 给它加模型参数会是一次大重构。
//
// 于是这里补一刀带模型判断的后处理。触发场景是**中途换模型**
// （比如 Sonnet → Haiku）：上一个模型留下的 tool_reference 字段
// 新模型不认识，直接 400。'''),

(1298, 'before', '''// 修复 tool_use / tool_result 配对。什么时候会不配对？
// 恢复远程/teleport 会话、跨进程续接、历史被裁剪过。
// 修法是「补一个合成的错误 tool_result」而不是删掉孤立的 tool_use——
// 因为删掉会让模型看到一段「有调用没结果」的历史，它下一轮还会重复调用。'''),

(1303, 'before', '''// 反向：advisor 块必须在没有对应 beta 头时剥掉。
// 这和行 1075 是同一枚硬币的两面：
// 有头 → 不剥（历史里的 advisor 块要保留）；没头 → 必须剥（否则 400）。'''),

(1317, 'after', '''// 这两个 logEvent 是配套的：before / after 各记一次消息数量，
// 一减就知道归一化到底合并/删除了多少条。
// 排查「消息数异常增长」时这是第一手数据。'''),

(1322, 'before', '''// fingerprint 用来做归因：同一条用户输入产生同一个指纹，
// 服务端可以据此统计「同一类请求的缓存表现」。
//
// 计算时机卡得很死：必须在注入任何合成消息**之前**。
// 下面 1330 会往开头插 deferred tool 列表、1366 会往 system 里插 advisor 指令，
// 如果那些跑完了再算，指纹反映的就不是「用户原话」了。'''),

(1327, 'before', '''// ⚠ 这里是 prompt cache 与功能的正面冲突，也是全文件最值得学的一段权衡：
//
//   老做法：每次请求都往消息**开头**插一段 <available-deferred-tools>，
//          告诉模型「还有这些工具可以搜」。
//   问题：  这段内容随工具池变化，一插进开头，**整条前缀缓存作废**。
//
//   新做法：不提「每次插开头」，而是把变化做成「增量附件」
//          （deferred_tools_delta），追加在对话末尾。
//          末端变化不影响前面已缓存的前缀。
//
// 于是这里出现了两个分支：开关开着走 delta，关着走老路。
// 全文件里这种「新旧两套并存、用 feature flag 切」的地方还有很多。'''),

(1347, 'before', '''// 同一个道理再演一遍，这次是 Chrome 的工具搜索提示词。
// 老做法往 system prompt 末尾追加 → 只要 Chrome 晚连上，
// 前面整段系统提示词（十几 K token）就全部失效。
// 新做法走 mcp_instructions_delta，作为增量块追加。'''),

(1358, 'before', '''// ── system prompt 的最终拼装 ──
//
// 这里的顺序是**协议的硬性要求**，不能随意调整：
//
//   1. attribution 头   （可执行文件名 + 指纹，第一方用来识别客户端）
//   2. CLI sysprompt 前缀（第一方白名单校验的那段）
//   3. 真正的系统提示词  （prompts.ts 里那一大套）
//   4. advisor 工具说明  （只在开启时）
//   5. Chrome 工具搜索说明（只在需要时）
//
// 为什么 1、2 必须最前：服务端要能只读开头若干字节就判断
// 「这是哪个客户端、什么模式」，早于任何业务内容。
//
// filter(Boolean) 顺手把空串去掉——这也是「三个前缀函数有一个可能返空」的兜底。'''),

(1374, 'before', '''// 缓存开关：先用调用方显式传的，没传就按模型默认。
// 这里的 `??` 而不是 `||` 有讲究：显式传 false 应该生效（关掉），
// 用 || 会把 false 当成「没传」。'''),

(1376, 'after', '''// 注意 skipGlobalCacheForSystemPrompt 的值来自 needsToolBasedCacheMarker（行 1212）：
// 有 MCP 工具时要给**工具区**打缓存点，那就不能同时让系统提示词吃掉全局缓存，
// 否则会出现两个全局缓存锚点，服务端拒绝。
// 这就是 buildSystemPromptBlocks 里那句「不要再加缓存块了，会 400」的由来。'''),

(1385, 'before', '''// 一个很小的顺序决策，背后是缓存成本：
// advisor 工具 append 在 toolSchemas **之后**，而不是插在前面。
// 这样开关 /advisor 时，只有末尾这一小块变了，
// 前面所有工具 schema（可能几 K token）的缓存仍然有效。'''),

(1405, 'before', '''// ═══════════════════════════════════════════════════════════════
// sticky-on latch（粘性锁存）—— 这个小机制值得用整段注释讲清楚
//
// 问题：AFK 模式、fast mode、cache editing、thinking clear 这四个能力
// 都是「用户可以中途开关」的。如果每一次开关都反映到 beta 头上，
// 那服务端的请求签名就变了 → 缓存键变了 → 前缀约 50-70K token 全价重算。
//
// 解法：**一旦发出去过，就整个会话一直发。**
// 即使关掉了也继续发头（只是不发对应的 body 参数）。
// 这样缓存永远稳定，代价是「关掉之后服务端仍然以为你开着」——
// 而这个代价由 body 参数承担（比如 fastMode 关了就不再传 speed: 'fast'）。
//
// 注意 latch 状态存在 bootstrap state 里（跨请求），而不是这个函数的局部变量。
// 清理时机：/clear 和 /compact —— 那是两个「上下文重置」的时刻，
// 缓存本来就要重建，正好顺手清 latch。
//
// 四个 latch 的门槛各不相同，下面逐个看：
//   afk       → 只在 agentic query 且自动模式真的激活过
//   fastMode  → 只要求 isFastMode（五个条件的合取，行 1398）
//   cacheEdit → 第一方 + 主线程 + 模型支持，三重门禁
//   thinkingClear → agentic + 距上次请求超过 1h
// ═══════════════════════════════════════════════════════════════'''),

(1444, 'before', '''// thinkingClear 的 latch 门槛和其他三个不同：它不看「功能是否开启」，
// 而看**时间间隔**——上次请求距今超过 1 小时缓存肯定过期了，
// 这时才需要 clearAllThinking 让服务端丢弃旧的 thinking 上下文。
//
// 「只有 agentic query 才能 latch」这个限制也值得注意，
// 否则一次后台分类调用就可能把主线程的 context_management 翻掉，中途改变请求形状。'''),

(1458, 'before', '''// effort 在这里就被**解析成最终值**（resolveAppliedEffort），
// 因为后面两处要用：paramsFromContext 里写进 output_config，
// 以及 recordPromptState 里参与缓存键计算。两处必须用同一个值。'''),

(1460, 'before', '''// ── 缓存断裂检测 ──
//
// 这段代码不改变请求，只是**记录**「这一轮可能影响缓存键的所有因素」。
// 下一轮请求返回后，checkResponseForCacheBreak（行 2384）拿实际的
// cache_read_input_tokens 跟记录值对比，就能判断「是不是我们这边改了东西
// 导致缓存失效」，而不是服务端自己的问题。
//
// 注释里两个细节是关键：
//   1. 排除 defer_loading 工具 —— API 会把它们从提示词里剥掉，
//      它们从来不影响真实缓存键。不排除的话，每次发现新工具都会误报
//   2. **传 latch 后的值，不传实时状态** —— 检测的是「我们实际发了什么」，
//      而不是「用户现在开着什么」。差了这一步，每次用户切开关都会误报'''),

(1488, 'before', '''// beta tracing 模式下才构造的上下文快照。
// 这里 jsonStringify(allTools) 把全部工具 schema 序列化了——
// 是个明显的性能开销，所以包在 isBetaTracingEnabled() 三元里，
// 正常路径下这个表达式根本不会求值。'''),

(1515, 'before', '''// ── 释放流资源 ──
//
// 这个函数存在的理由比看上去严重：Response 对象持有**原生 TLS / socket 缓冲**，
// 住在 V8 堆外面（Node.js 路径下观察到过，见 GH #32920）。
// JS 的 GC 管不到它，不显式 cancel，连接就一直挂着直到进程退出。
//
// 所以它的调用点有三处：finally（行 2815）、错误分支（行 2739/2747 等）、
// 以及正常结束后的兜底（行 2891）。宁可多调（幂等），不能漏调。'''),

(1528, 'before', '''// ⚠ 这四行是一个很容易踩的坑，注释已经点出来了，我再说明白点：
//
// consumePendingCacheEdits() 是**读取并清空**（消费型 API）。
// 它必须在这里——paramsFromContext 定义**之前**、只调一次。
//
// 如果放进 paramsFromContext 里，会发生什么：
//   第一次调用（日志用途，行 1736）把待发送的删除指令吃掉了，
//   第二次调用（真正发请求，行 1797）拿到空数组。
//   于是「该删的缓存没删」，而且日志里显示的参数和实际发出去的参数不一致。
//
// 这类「消费型 API 被放进会被多次调用的函数」的 bug 极难发现，
// 因为日志看起来完全正常。'''),

(1538, 'before', '''// ═══════════════════════════════════════════════════════════════
// paramsFromContext —— 一整个 API 请求的定义
//
// 这是全文件第二个必须精读的地方。它是**工厂**不是常量：
// withRetry 每个 attempt 调一次，非流式兜底也调它。
//
// 为什么要工厂：重试不是「原样再发一次」。重试时可能：
//   · 换成 fallbackModel（retryContext.model 变了）
//   · 缩小 max_tokens（上下文超限了，retryContext.maxTokensOverride 有值）
//   · 换 thinking 配置（不同模型支持度不同）
// 所以模型相关的所有判断都读 retryContext 而不是 options。
//
// 结构上它分四段，读的时候按段看：
//   1539-1588  betas 与 body 附加项（effort / task_budget / output_format）
//   1590-1630  max_tokens 与 thinking 的互斥关系
//   1632-1695  context_management / 缓存 / fastMode / AFK / cacheEditing
//   1699-1728  最终对象拼装
// ═══════════════════════════════════════════════════════════════'''),

(1541, 'before', '''// 1M 上下文是实验特性，只能按模型动态加头。
// 注意它加在 betasParams（副本）而不是 betas（外层变量）：
// betas 是跨 attempt 共享的，往里 push 会让后续 attempt 累积重复项。'''),

(1549, 'before', '''// Bedrock 的特殊规矩：beta 头不能走 HTTP header，必须放进请求体
// 的 anthropic_beta 字段。所以这里先收集，交给 getExtraBodyParams 处理。
// 这也解释了行 1178 那个 `getAPIProvider() !== 'bedrock'` 的跳过判断。'''),

(1559, 'before', '''// output_config 的合并策略：**先从用户的 EXTRA_BODY 里取出已有的**，
// 再往上叠加我们自己的字段（effort / task_budget / format）。
// 顺序反过来的话，用户在环境变量里手配的值会被静默覆盖 ——
// 那是最难排查的一类问题：配置明明写了却不生效。'''),

(1590, 'before', '''// max_tokens 的三级优先，顺序就是重要性：
//   1. retryContext.maxTokensOverride —— 重试时为了「挤进上下文窗口」而动态收紧的
//   2. options.maxOutputTokensOverride —— 调用方显式指定的
//   3. 模型默认值
// 第 1 级为什么最高：它是**为了救这次请求**才出现的，
// 如果被调用方的显式值盖掉，重试就白做了，会陷入「每次都超限」的死循环。'''),

(1596, 'before', '''// 注意这里除了看配置，还看环境变量 CLAUDE_CODE_DISABLE_THINKING。
// 后面所有 thinking 相关逻辑（包括 temperature 要不要发）都以这个 hasThinking 为准，
// 所以它是一个「单一事实来源」，不要在下游再各算一遍。'''),

(1601, 'before', '''// ⚠⚠ 这条注释是全文件语气的最高级别，值得原样读一遍：
//
//     "IMPORTANT: Do not change the adaptive-vs-budget thinking selection
//      below without notifying the model launch DRI and research."
//
// 为什么这么严：adaptive（模型自己决定想多久）和 budget（给死一个 token 预算）
// 对模型质量的影响非常大，而且不是单调的——某些任务给预算反而更差。
// 这类「参数敏感区」在大模型产品里普遍存在，注释是它们唯一的护栏。
//
// 代码逻辑本身很简单：
//   支持 adaptive → { type: 'adaptive' }（不带预算）
//   不支持       → { type: 'enabled', budget_tokens: min(max_tokens - 1, 默认) }
// 注意那个 max_tokens - 1：API 要求 budget_tokens 严格小于 max_tokens，
// 见行 3383 同样的约束。'''),

(1632, 'before', '''// context_management 是服务端侧的上下文策略（主要是 thinking 的清理）。
// 三个输入里 clearAllThinking 来自 latch（行 1446），
// 这意味着一旦触发过，整个会话都会持续要求服务端清理旧 thinking。'''),

(1642, 'before', '''// fast mode 这里体现了 latch 机制的「分工」：
//   **header**  走 latch（会话内恒定，保缓存）
//   **body speed** 走实时判断（cooldown 期间只是不发 speed，头照发）
//
// 所以 isFastModeForRetry 为假时 speed 是 undefined，但下面
// fastModeHeaderLatched 为真时照样 push FAST_MODE_BETA_HEADER。
// 这种「声明能力」和「实际使用」分离的做法，在 beta 协议里是常态。'''),

(1691, 'before', '''// temperature 只在 thinking 关闭时发送。
// 原因不是风格问题：API 硬性要求「thinking 开启时 temperature 必须是 1」，
// 而 1 又是默认值，所以干脆不发。
// 换句话说，这个三元表达式是在避免一个必然的 400。'''),

(1697, 'after', '''// lastRequestBetas 是给日志用的：把「这次实际发了哪些 beta 头」记下来，
// 后面 logAPISuccessAndDuration 会带上它（行 2886）。
// 排查「某个能力为什么没生效」时，第一个要看的就是这个字段。'''),

(1699, 'before', '''// ── 最终对象拼装 ──
//
// 留意三件事：
//   1. messages 走 addCacheBreakpoints —— 缓存打点发生在这里，不在上游
//   2. 所有「可选但语义重要」的字段都用条件展开（...(x && { k: v })），
//      而不是给 undefined。原因：SDK 用键存在性判断，undefined 和不存在不等价
//   3. extraBodyParams 在 output_config 之前展开 ——
//      这样用户显式配的字段会先落地，我们的 output_config 再覆盖它
//      （与行 1559 的策略一致：我们的值优先，但只在没冲突时）'''),

(1731, 'before', '''// ═══ 一个纯性能优化，但值得单独讲 ═══
//
// 场景：logAPIQuery 需要 getToolPermissionContext()（异步），
// 而日志是 fire-and-forget（不能 await，不能拖慢请求）。
//
// 直觉写法是：
//     void options.getToolPermissionContext().then(ctx => {
//       logAPIQuery({ ..., messages: queryParams.messages, betas: queryParams.betas })
//     })
// 问题：闭包捕获了 queryParams，而 queryParams 引用了 messagesForAPI ——
// **整个对话历史（可能几十 K token 的对象树）**。这个闭包会被 pin 在
// promise 上直到 resolve，期间一直不能被 GC。
//
// 所以这里先把要用的标量取出来（length / betas 数组 / thinking type / effort），
// 让闭包只捕获几个原始值。注释里「pinned until the promise resolves」就是这个意思。
//
// 同一个模式在行 2852 的 logAPISuccessAndDuration 里又出现一次。'''),

(1761, 'before', '''// ═══ 流解析的「半成品状态」 ═══
//
// 这十几个变量就是「流式事件是碎片」的直接体现：
//
//   partialMessage    message_start 给的骨架（content 是空的、usage 是 0）
//   contentBlocks     按 index 存放，每个块逐步长大
//   usage             累积用量（注意 API 给的是累计值，见行 2916）
//   stopReason        message_delta 才有，之前一直是 null
//   newMessages       已经 yield 出去的 assistant 消息（可能要回写）
//   fallbackMessage   非流式兜底产出的消息
//
// 为什么这些不能是函数参数或返回值：它们要跨几十个事件存活，
// 而且要在 catch 块和 finally 块里被读到。只能放在 try 外面。'''),

(1778, 'before', '''// ═══ 发请求：withRetry 包一层 ═══
//
// 注意 maxRetries: 0 —— 显式关掉 SDK 自带的重试。
// 注释说得清楚：manual implementation。为什么不用 SDK 的？
// 因为重试要做的事远超「再发一次」：换模型、缩 max_tokens、
// 识别 529 并统计连续次数、在特定错误上放弃、把重试进度 yield 给 UI。
//
// withRetry 的形态值得记住：它是一个生成器工厂，
// 第一参数建客户端（可能失败，比如认证错误要重建），
// 第二参数是真正的 attempt 函数，第三参数是重试策略。'''),

(1797, 'before', '''// paramsFromContext(context) —— 每次 attempt 重新构造。
// 紧接着的 captureAPIRequest 把参数存下来给 bug report 用：
// 用户反馈问题时，能附上「当时到底发了什么」。'''),

(1802, 'before', '''// queryCheckpoint 的位置很讲究（注释也强调了）：
// 必须在 .withResponse() **之前**打点。
// 因为 withResponse 会一直 await 到响应头到达，
// 放后面的话「网络 TTFB」这个阶段的耗时就会被算错。'''),

(1810, 'before', '''// clientRequestId：客户端自己生成的一个 UUID，通过 header 发出去。
//
// 为什么需要它：超时的时候服务端**根本没有 request id**（请求可能没到），
// 这时想在自己的日志和服务端日志之间对上号，只能靠客户端预先埋的 id。
// 注释里的 inc-4029 就是这个需求的事故编号。
//
// 只对第一方生效：第三方（Bedrock/Vertex）不会记录这个头。'''),

(1818, 'before', '''// ⚠ 这里是一个有明确性能理由的「不用官方封装」决策：
//
//     BetaMessageStream 会对每个 input_json_delta 调 partialParse()
//
// 也就是说，如果一个工具参数是 500 个片段拼成的 JSON，
// 官方封装会把它从 1 个片段解析到 500 个片段，每次从头解析一遍 ——
// O(n²)。而实际上我们**不需要一部分的 JSON**：工具要等参数收完才能执行，
// 中间态完全没用。
//
// 所以这里用 raw stream + 自己拼字符串（行 2111 contentBlock.input += ...），
// 到 content_block_stop 时才解析一次。'''),

(1848, 'before', '''// 又是「生成器套生成器」的拉取模式，和行 908 一样：
// withRetry 在重试之间 yield 出 system 消息，这里边拉边转发。
//
// 那句 `!'controller' in e.value` 是个类型判断的土办法：
// Stream 对象有 controller 属性，SystemAPIErrorMessage 没有。
// done 之后 e.value 就是 Stream。'''),

(1859, 'before', '''// 为什么要 reset 一遍？因为上面那段拉取可能经历了多次重试，
// 每次重试理论上都重置过这些状态，但**最后一次 attempt 的残留**必须清掉，
// 否则会把上一次 attempt 的部分内容和新流混在一起。
// 这类「拿到资源后立刻重置」的写法，在流式代码里是防脏数据的标配。'''),

(1868, 'before', '''// ═══ 流式 idle 看门狗 ═══
//
// 为什么需要：SDK 的 request timeout 只覆盖**初始 fetch()**，
// 不覆盖流式 body。所以连接被静默丢弃后，for await 会永远挂着，
// 会话就卡死了。
//
// 默认 90 秒没收到任何 chunk 就主动 abort；一半时间（45s）先打 warning。
// 这个看门狗和下面的 stall detection（行 1944）是**互补**的：
//
//   看门狗         → setTimeout 主动杀，即使后面再也收不到任何东西
//   stall 检测     → 只在**下一块到达时**才算，纯被动记录
//
// 只用 stall 检测的话，连接彻底断了就永远等不到「下一块」，检测永远不会触发。'''),

(1895, 'before', '''// 每收到一个 chunk 就重置计时器 —— 这是「idle」语义的实现方式：
// 计时的对象是「距离上一块的间隔」，不是「整个流的时长」。'''),

(1931, 'after', '''// startSessionActivity('api_call') 和 finally 里的 stopSessionActivity('api_call')
// 是一对：作用是告诉系统「现在有网络活动，别因为空闲而挂起/休眠」。
// 注意它放在 try 外面，因为要让 finally 一定能配对到。'''),

(1932, 'before', '''// ═══════════════════════════════════════════════════════════════
// 流解析主循环 —— 从 1932 到 2403，约 470 行
//
// 结构极其简单，就一层 for await + 一个 switch：
//
//     for await (const part of stream) {
//        重置看门狗
//        检测 stall
//        第一次到达 → 打点
//        switch (part.type) {
//          case 'message_start'        → 存骨架、算 TTFT
//          case 'content_block_start'  → 建空壳
//          case 'content_block_delta'  → 往空壳里累加
//          case 'content_block_stop'   → 收口，yield 一条 assistant 消息
//          case 'message_delta'        → 回写 usage / stop_reason
//          case 'message_stop'         → 什么都不做
//        }
//        yield { type: 'stream_event', event: part }   ← 给 UI 的原始增量
//     }
//
// 注意最后那个 yield：**每个**原始事件都会原样转给 UI（做打字机效果），
// 而 assistant 消息只在 content_block_stop 时 yield 一次。
// 这就是「内部累积」和「对外流式」两条通道。'''),

(1944, 'before', '''// stall 检测：只记录不干预。两个刻意设计：
//   1. 只在**第一块之后**开始计时（lastEventTime 初始为 null），
//      否则 TTFT（首字延迟）会被误算成一次 stall
//   2. 阈值 30s 比看门狗的 90s 小 —— 所以正常情况下会先看到
//      「stall 警告」再看到「idle 超时」，日志顺序本身就说明了问题的严重程度'''),

(1979, 'before', '''// switch 的六个分支，按「信息量从少到多」排列。
// 读的时候重点看 content_block_start 和 content_block_delta 这两段，
// 它们是「碎片如何拼成完整块」的全部秘密。'''),

(1980, 'before', '''// message_start：整条流的第一个事件，给的是**骨架**。
// partialMessage = part.message 里 content 是空数组、usage 只有 input_tokens、
// stop_reason 是 null —— 后面的所有内容都往这个骨架上补。
//
// ttftMs 只在这里算一次：Date.now() - start 就是「首字延迟」，
// 这是衡量服务端响应速度最直接的指标。'''),

(1995, 'before', '''// ═══ content_block_start：给每个块造一个「空壳」 ═══
//
// 四种类型各自要初始化不同的字段，原因都一样：
// **后面要用 += 往里累加，字段必须先存在且类型正确。**
//
//   tool_use          → input: ''（字符串！不是对象）
//   server_tool_use   → input: ''（要 as unknown as 骗过类型系统）
//   text              → text: ''
//   thinking          → thinking: '' + signature: ''
//
// 注意 tool_use 的 input 初始化成**空字符串**而不是 {}，
// 这不是笔误：delta 阶段拿到的是 JSON 文本片段（partial_json），
// 先拼成字符串，到 stop 时才 JSON.parse。见行 2111。'''),

(2019, 'before', '''// 这段注释（2022-2026）指出了 SDK 的一个真实 bug：
// content_block_start 里有时**已经带了部分文本**，然后 content_block_delta
// 又把同样的文本再发一遍。我们无法区分「是重复」还是「是续写」，
// 所以干脆在 start 时把 text 清空，只信 delta。
//
// 代价：如果某些情况下文本**只**在 start 里出现、delta 里没有，
// 那部分会丢。作者判断这种情况不存在（所以注释里说
// "there doesn't seem to be a way to detect"——承认这是权宜之计）。'''),

(2030, 'before', '''// thinking 块需要 **两个** 初始字段，且理由不同：
//   thinking: ''   → 下面要 thinking += delta.thinking
//   signature: ''  → signature_delta 可能永远不来，但后续请求要求这个字段存在，
//                    否则 API 会认为「这个 thinking 块没有签名」而拒绝整条历史。
//
// 注释里三个 "awkward" / "also awkward" / "even more awkwardly"
// 连成一条吐槽线：这四种块没有统一协议，每种都有各自的历史包袱。'''),
]
