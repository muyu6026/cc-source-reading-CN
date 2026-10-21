# -*- coding: utf-8 -*-
"""claude.ts 批注 4/4：delta 累加、块收口、usage 回写、降级链、资源释放、缓存打点、非流式工具函数。"""

ANNOTATIONS = [
(2053, 'before', '''// ═══ content_block_delta：把碎片累加进空壳 ═══
//
// 这里每个 case 的骨架都一样，三件事：
//   1. 校验块类型对不对（不对就 logEvent + throw）
//   2. 校验要累加的字段类型对不对
//   3. += 累加
//
// 为什么每个 case 都要重复这套校验（看起来啰嗦）：
// SSE 是文本协议，服务端如果因为版本不一致发出意外的 delta，
// 这里不拦就会变成「静默拼出错误内容」——比直接报错难查得多。
// 每次校验都带 logEvent，是为了从线上数据里反推协议不匹配的情况。'''),

(2056, 'before', '''// index 找不到对应的块，直接 RangeError。
// 这个判断在正常网络下永远不成立，成立就说明事件顺序错乱——
// 那已经不是「恢复」能解决的，必须让整条请求失败重来。'''),

(2066, 'before', '''// connector_text 是第三方连接器产出的文本，走独立的 delta 类型。
// feature() 判断放在最外层而不是 case 里，是为了让整段在外部构建中被删掉。'''),

(2084, 'before', '''// citations（引用）收到但没处理——TODO。
// 这是「协议支持了但产品还没做」的地方，留着不报错是为了向前兼容：
// 服务端开始发 citations_delta 时，旧客户端不会崩。'''),

(2087, 'before', '''// ⚠ 全文件最关键的几行之一：tool_use 的参数是**分段拼出来的 JSON 字符串**。
//
// 服务端发的是 input_json_delta { partial_json: '{"path":' }、
// { partial_json: '"a.txt"}' }…… 我们一路 += 成完整字符串，
// 到 content_block_stop 才 JSON.parse（在 normalizeContentFromAPI 里做）。
//
// 这就是行 1818 不用 BetaMessageStream 的原因：官方封装会在每个片段上
// 做 partialParse()，是 O(n²)；我们只需要最后一次解析。
//
// 两个校验也说明了预期：块类型必须是 tool_use / server_tool_use，
// input 必须是 string。只要有一处不符，就说明有人（或某个网关）
// 改写了协议，宁可报错也别拼出错误参数去执行工具。'''),

(2113, 'before', '''// 纯文本增量，最常见的一种。'''),

(2127, 'before', '''// signature 是 thinking 块的密码学签名，模型切分点绑定。
// 它和 thinking 内容是**分开的两次 delta**，所以下面要单独处理。
//
// CONNECTOR_TEXT 分支说明 connector_text 块也用 signature 字段，
// 但语义不同（不是模型签名，是连接器标识）——所以先判断再赋值。'''),

(2148, 'before', '''// thinking 正文增量。和 text_delta 几乎一样，
// 但必须校验类型：把 thinking 混进 text 会让 UI 显示出模型内心独白。'''),

(2164, 'before', '''// research 是内部字段（USER_TYPE === 'ant'），从每个 delta 里「顺手抓」，
// 而且注释强调 always overwrite —— 只留最新值，不留历史。
// `'research' in part` 用 in 而不是判 undefined，
// 是为了区分「没有这个字段」和「有这个字段但值是 undefined」。'''),

(2171, 'before', '''// ═══ content_block_stop：一个块长完了，收口成一条消息 ═══
//
// 这是全流程的「兑现点」：前面所有累加都在这个块里变成
// 一条完整的 AssistantMessage，push 进 newMessages 并 yield 出去。
//
// 三个细节：
//   1. message 用 { ...partialMessage } —— 骨架里的 model / usage 等元信息沿用
//   2. content 只放**当前这一块**，不是整个 contentBlocks 数组。
//      也就是说一个响应里如果有 text + tool_use 两个块，
//      会产生**两条** assistant 消息，各自带一个 content。
//      上层（query.ts）负责按顺序把它们摊平成一条逻辑消息。
//   3. normalizeContentFromAPI 在这一步做 JSON.parse（把 input 字符串变对象）'''),

(2183, 'before', '''// partialMessage 为空意味着收到了 block 事件却没有 message_start。
// 这是代理/网关篡改 SSE 的典型症状（比如把事件重排、或只转发部分）。
// 直接抛错，让外层走非流式兜底。'''),

(2213, 'before', '''// ═══ message_delta：整条流的「结算事件」 ═══
//
// 两个作用：
//   1. usage 的**最终值**在这里（message_start 给的 output_tokens 是 0）
//   2. stop_reason 在这里（之前一直是 null）
//
// 但问题在于：content_block_stop 已经把消息 yield 出去了，
// 那时 usage/stop_reason 还是旧值。所以这里必须**回头改已 yield 的对象**。'''),

(2229, 'before', '''// ⚠ 这段注释（2229-2241）是全文件最实用的一个坑，值得逐字读：
//
//     "IMPORTANT: Use direct property mutation, not object replacement.
//      The transcript write queue holds a reference to message.message
//      and serializes it lazily (100ms flush interval)."
//
// 翻译：会话落盘有一个 100ms 的延迟队列，它持有的是**对象的引用**，
// 在真正序列化时才读值。
//
// 所以如果你写：
//     lastMsg.message = { ...lastMsg.message, usage }     ← 错
// 队列里那个引用还指着旧对象，落盘时序列化出的是 output_tokens: 0、
// stop_reason: null 的版本。会话恢复后成本统计全是 0，排查极其困难。
//
// 正确写法是**原地改属性**：
//     lastMsg.message.usage = usage                        ← 对
// 引用不变，队列在 flush 时读到的是新值。'''),

(2251, 'before', '''// 成本要在这里算，而不是等流结束。
// 因为 message_delta 是 usage 唯一可靠的出现位置，
// 而后面可能还有异常/降级，流结束时 usage 未必还在作用域里。'''),

(2258, 'before', '''// 拒答检测：某些 stop_reason 意味着模型拒绝回答（安全策略）。
// 这时要 yield 一条**错误消息**，让上层把它当成失败处理，
// 而不是当成一段正常（但很短的）回复。'''),

(2266, 'before', '''// ═══ max_tokens 截断 ═══
//
// 两个动作：
//   1. logEvent 记一条（监控「有多少请求撞到上限」）
//   2. yield 一条错误消息，apiError 设为 'max_output_tokens'
//
// 为什么要 yield 错误而不是静默接受：
// 这个特定的 apiError 值会被 query.ts 识别，触发**自动升级重试**
// （max_output_tokens_escalate：把上限提到 64k 再来一次）。
// 静默接受的话，模型会拿到半截回答，然后在下一轮基于半截内容继续，
// 结果越跑越偏。'''),

(2279, 'before', '''// model_context_window_exceeded：上下文窗口撞墙了。
// 注释说明了处理策略——**复用 max_tokens 的恢复路径**。
//
// 从模型的角度看，这两种情况的含义是一样的：「我说到一半被截断了，接着来」。
// 所以故意发同样的 apiError 值，让 query.ts 走同一套恢复流程。
// 这类「用同一个错误类型表达语义相近的两种状态」在协议设计里很常见，
// 代价是日志里要靠 stopReason 区分。'''),

(2295, 'after', '''// message_stop 什么都不做。
// 它是「流正常结束」的标记，但真实的收尾判断在循环外面（行 2350），
// 因为流也可能**没有** message_stop 就断了 —— 那才是要检测的情况。'''),

(2299, 'before', '''// 每个原始事件都原样转出去，给 UI 做打字机效果。
//
// ttftMs 只在 message_start 那条带上（条件展开）。
// 这样 UI 收到的第一条事件就附带「首字延迟」，
// 不用自己算时间差（客户端时钟和服务端不可比）。'''),

(2305, 'before', '''// 循环退出，先拆看门狗 —— 不管是正常结束还是异常退出，
// 都不能留着定时器（否则 90 秒后会莫名其妙 abort 一个已经结束的流）。'''),

(2310, 'before', '''// ═══ 三种「流结束了但结果不对」的检测，从这里开始 ═══
//
// 第一种：看门狗杀的流。
// 这里不是 return，而是 **throw** —— 故意的，为了让下面的 catch 块接住，
// 走「流式失败 → 非流式兜底」那条路。
//
// 那段 instrumentation 注释很值得看：exit_delay_ms 测的是
// 「abort 信号发出到 for await 真正退出」的延迟。
//   0-10ms    → abort 生效了，一切正常
//   >>1000ms  → 有别的东西唤醒了循环（说明 abort 根本没起作用）
// 这种「证明清理逻辑真的生效」的埋点，在排查挂死类问题时是救命稻草。'''),

(2337, 'before', '''// 第二种：流正常结束，但一条 assistant 消息都没产出。
//
// 注释列了两个代理故障模式，都是真实遇到过的：
//   1. 完全没事件（!partialMessage）→ 代理返回 200 但 body 不是 SSE
//   2. 有 message_start 但没有 content_block_stop 也没有 stop_reason
//      → 代理转到一半断了
//
// 为什么会写这段：BetaMessageStream 在 _endRequest() 里有这个检查，
// 但我们用的是 raw Stream（行 1818 换的），它没有 —— 于是自己补。
// 不补的后果很隐蔽：生成器静默返回空，上层拿到 undefined，
// -p 模式下报一个看不出原因的 "Execution error"。'''),

(2346, 'before', '''// ⚠ 这个 stopReason 判断是防止**误报**的关键，注释给的例子特别值得记：
//
// 结构化输出（--json-schema）模式下，模型第一轮调 StructuredOutput 工具，
// 第二轮只回一个 end_turn、**零个内容块**。
// 这是完全合法的空回复，不是流坏了。
//
// 所以判据不能是「newMessages 为空」，必须是「为空**且**没有 stop_reason」。
// stop_reason 有值 = 服务端明确表示「这一轮结束了」，那就信它。'''),

(2366, 'before', '''// stall 统计只是诊断，不影响结果。
// 但如果日志里频繁出现 stall_count，说明网络或服务端有抖动，
// 这比等用户投诉「有时候很慢」要早得多。'''),

(2382, 'before', '''// ⚠ 缓存断裂检测的**消费端**（记录端在行 1460）。
//
// 判据完全来自响应头/usage：如果 cache_read_input_tokens 远低于预期，
// 而这一轮「我们这边什么都没改」，那就是服务端的问题；
// 反之就是我们的改动导致缓存失效。
//
// 注意 void 前缀：这是 fire-and-forget，不 await。
// 检测是纯观测行为，绝不能拖慢主流程——哪怕检测函数自己抛异常也不该影响请求。'''),

(2394, 'before', '''// 配额状态从**响应头**里读（不是 body）。
// 这是「订阅制限流」的实现方式：服务端在每 5 小时窗口的响应头里
// 带上剩余额度，客户端读出来显示在 UI 上。
//
// streamResponse 在这里要 as 一下，因为 TypeScript 的控制流分析
// 追不到「它在 withRetry 的回调里被赋值」这件事（注释也说明了）。'''),

(2404, 'before', '''// ═══ 流式失败的统一入口 ═══
//
// 这个 catch 块有 130 行，分四段：
//   2406-2432  看门狗相关的埋点（区分「干净退出」和「异常退出」）
//   2434-2462  用户中止 vs SDK 超时（同一异常类型，两种含义）
//   2464-2502  降级开关判断（disableFallback）
//   2504-2594  真正降级：走非流式
//
// 注意最外层还有一个 finally（行 2595）专门 clearStreamIdleTimers ——
// 因为 catch 里的代码自己也可能抛，finally 才是保证清理的地方。'''),

(2434, 'before', '''// ⚠ 同一个异常类型 APIUserAbortError 有两种完全不同的含义，必须分开：
//
//     signal.aborted 为真  → 用户按了 ESC，这是**预期行为**
//                            直接重抛，上层按「中断」处理，不报错
//     signal.aborted 为假  → SDK 内部超时，这是**真错误**
//                            转成 APIConnectionTimeoutError 再抛
//
// 分不清的后果：要么用户每次按 ESC 都看到报错，要么真超时被当成用户取消、
// 静默吞掉。这个 if/else 就是在做这个分辨。'''),

(2464, 'before', '''// ⚠ 这段注释记录了一个很隐蔽的双重执行 bug（inc-4258），值得细读：
//
// 开了「流式工具执行」之后，中途降级到非流式会造成工具跑两遍：
//   1. 流式那半截已经收到 tool_use，工具开始执行
//   2. 流断了 → 降级 → 非流式重试重放整个请求 → 又生成同一个 tool_use
//   3. 工具被执行第二次（可能有副作用！写文件、发请求、删数据）
//
// 所以有开关能在这种情况下**直接放弃降级、让错误抛给 withRetry**。
// 这是一种取舍：宁可这次请求失败重试，也不能把有副作用的操作跑两遍。'''),

(2534, 'before', '''// ═══════════════════════════════════════════════════════════════
// 降级到非流式 —— 但这里藏着一个「预算对齐」的细节
//
//     initialConsecutive529Errors: is529Error(streamingError) ? 1 : 0
//
// 注释解释得很清楚：如果**流式**阶段撞的是 529（服务端过载），
// 这个 1 要带进非流式的重试计数里。
// 否则「连续 529 多少次就切换模型」这个阈值，会因为走了哪条路径而不同 ——
// 流式撞 3 次 + 非流式撞 3 次 = 6 次，但计数器只记到 3。
//
// 这是典型的「同一份状态被两条代码路径维护」的问题，
// 修法是把已发生的事实（撞过一次 529）显式传下去。'''),

(2571, 'before', '''// 降级成功后，也要走和流式一样的收口流程：
// normalizeContentFromAPI → 构造 AssistantMessage → push → yield。
//
// 并且额外记到 fallbackMessage（行 2593）——
// 因为这段代码可能在 yield 处被 .return() 打断，
// 那样下面的成本统计就执行不到了，所以 finally 里要能靠 fallbackMessage 补救（行 2820）。'''),

(2595, 'before', '''// 这个 finally 只做一件事：清看门狗。
// 但它是必需的——catch 块自己也可能抛异常，那时只有 finally 能保证执行。'''),

(2598, 'before', '''// ═══ withRetry 整体失败（重试次数用尽 / 不可重试） ═══
//
// 到这个 catch，说明「连重试都救不回来了」。剩下能做的：
//   1. 把模型降级信号透传给 query.ts（2603）
//   2. 404 特殊处理：再试一次非流式（2612）
//   3. 否则记日志 + yield 一条错误消息 + return（2750 起）
//
// 注意这里用 return 而不是 throw：生成器正常结束，
// 错误已经通过 yield 一条 SystemAPIErrorMessage 传给上层了。
// 这是「错误即消息」的设计——比抛异常更容易在上层统一处理。'''),

(2603, 'before', '''// ⚠ FallbackTriggeredError 必须原样往上传，绝不能在这里处理。
//
// 注释说明了原因：这个文件的职责是「发一次请求」，
// 而「换到 fallbackModel 再试」是 query.ts 的职责（它要重建整个循环状态）。
// 如果在这里吞掉，用户会看到一条 "Model fallback triggered: X -> Y" 的
// **错误消息**，但实际上什么都没重试。'''),

(2607, 'before', '''// 404 的特殊性：这一版改成 raw stream 之后，404 的抛出位置变了。
//
//   老版本（BetaMessageStream）：404 在**遍历流的时候**抛 → 被内层 catch 接住 → 降级
//   新版本（raw Stream）：404 在 **.withResponse() 时**抛 → 抛到这一层
//
// 所以这个 catch 里必须补一条 404 判断，否则「网关不支持流式」这个场景
// 会从「自动降级」退化成「直接报错」。
// 这也是升级 SDK 用法时最容易漏的一类回归。'''),

(2612, 'before', '''// 三个条件缺一不可，第二个和第三个说明这不是「所有 CannotRetryError」，
// 而是精确匹配「404 且是 stream 创建阶段」。
// didFallBackToNonStreaming 的判断防止重复降级（已经降过一次就别再试）。'''),

(2618, 'before', '''// 这里有个细节：requestId 拿不到了，因为 404 在 streamRequestId 被赋值**之前**就抛了。
// 所以从错误对象上抠（error.requestID，SDK 会从响应头里带出来）。
// 注释还说明了 CannotRetryError 的含义：所有重试都失败了，
// 所以这个 id 是最后一次失败请求的。'''),

(2750, 'before', '''// ═══ 非 404 的普通失败路径 ═══
//
// 和上面 404 分支的处理高度相似（这也是这段代码可以抽象但没抽象的原因：
// 两处的 return 语义不同，硬抽会让控制流更难读）。
//
// 顺序是固定的三步：
//   1. 剥掉 CannotRetryError 外壳，拿到真实 error 和当时用的模型
//   2. 尽量捞到一个 requestId（流 id → 错误头 → 错误体，三级兜底）
//   3. logAPIError → 用户中止则静默 return → 否则 yield 错误消息 → return'''),

(2794, 'before', '''// 用户主动中止不 yield 错误消息。
// 注释指明「中断提示由 query.ts 处理」——因为那边知道上下文
// （是用户按了 ESC，还是某个工具执行到一半被取消），能给出更准确的文案。
// 这里只负责安静地 return。'''),

(2808, 'before', '''// ═══ 最外层的 finally ═══
//
// 三件事，每一件都有明确的「不做会怎样」：
//
//   1. stopSessionActivity  —— 不配对的话，系统会一直以为有网络活动
//   2. releaseStreamResources —— 不调就泄漏原生 socket（GH #32920）
//   3. 补算 fallback 的成本   —— 见下面注释
//
// 关于第 2 条，注释里那句 "if the generator is terminated early via .return()"
// 是关键：消费方 break 出 for-await 时会调用生成器的 .return()，
// 那时 try 块里的代码**不会**继续执行，只有 finally 会。'''),

(2817, 'before', '''// fallback 的成本为什么要在 finally 里补算：
//
// 流式路径的 message_delta 处理是在任何 yield **之前**记账的（行 2251），
// 所以即使被打断也已经记上了。
// 但 fallback 路径是「push → yield → 之后才记」，一旦在 yield 处被 .return()，
// 后面就没了。所以搬到这里，用 fallbackMessage 兜底。'''),

(2833, 'before', '''// ── 收尾：三件与「下一次请求」有关的记账 ──
//
// 第一件：把所有工具标记为「已发给 API」，这样它们才**有资格被删除**。
// 为什么需要这个状态：工具定义一旦发出去就进了缓存，
// 如果某个工具再也不发，缓存里那段就可以被回收。
// 标记之后缓存管理才知道「这个工具已经出场过了」。'''),

(2838, 'before', '''// 第二件：记住主对话链的最后一个 requestId。
// 用途在进程退出时——给推理服务发一个「这条链可以清缓存了」的提示。
//
// ⚠ 那个 getAgentContext() 判断很微妙：后台会话（Ctrl+B）虽然也共享
// repl_main_thread 这个 querySource，但它们在 agent context 里运行，
// 是**独立的对话链**。前台清空时不应该把它们的缓存也踢掉。'''),

(2852, 'before', '''// 第三件：成功日志。和行 1731 是同一个优化模式——
// 先把 messagesForAPI 的两个标量（长度、token 数）算出来，
// 免得 fire-and-forget 的 .then() 闭包把整个对话数组 pin 在内存里
// 直到 getToolPermissionContext() resolve。'''),

(2890, 'before', '''// 防御性再释放一次。
// 正常路径 finally 已经调过了，cleanupStream 幂等（内部判 aborted），
// 所以这里是安全的空操作。'''),

(2894, 'before', '''// ═══ 以下是被导出的工具函数 ═══
//
// 从 2898 到 3419，都是纯函数或近乎纯函数，
// 没有 queryModel 里那些跨事件状态，读起来轻松得多。
// 但它们承担的是「协议微小约束」的实现，每条都对应一个会导致 400 的规则。'''),

(2914, 'before', '''// ── updateUsage：合并一次 usage 更新 ──
//
// ⚠ 注释第一句是全文件最容易被忽略的一句话：
//
//     "Anthropic's streaming API provides cumulative usage totals,
//      not incremental deltas."
//
// 也就是说每个事件里的 usage 都是「到目前为止的总数」，**不是增量**。
// 所以这里是覆盖而不是累加。（累加的事由 accumulateUsage 负责，那是跨消息的。）
//
// 第二段注释说的是一个具体的坑：message_delta 可能给
// input_tokens: 0（因为它只想更新 output_tokens），
// 如果直接覆盖，就把 message_start 给的真实输入 token 数抹成 0 了。
// 所以三个 input 类字段都用 **> 0** 才覆盖。'''),

(2946, 'after', '''// output_tokens 是唯一真正该「取最新值」的字段（它确实是累计递增的），
// 所以这里用 ?? 而不是 > 0。
// 一个 > 0 判断的差别，就是「成本统计准确」和「成本统计为 0」的差别。'''),

(2956, 'before', '''// cache_creation 的两个字段 SDK 类型里没有，但 API 真的会发。
// 所以用 (partUsage as BetaUsage) 强转去读——注释那句
// "SDK type BetaMessageDeltaUsage is missing cache_creation, but it's real!"
// 是一个典型的「类型定义落后于协议」的现场记录。'''),

(2965, 'before', '''// cache_deleted_input_tokens 更极端：不仅 SDK 类型没有，
// 连 NonNullableUsage 也**故意不带**这个字段。
//
// 注释说明了原因：把它排除在类型之外，外部构建里这个字符串
// 就会被 DCE 一起删掉（连字段名都不出现在产物里）。
// 这是「用类型系统控制代码裁剪」的一个巧妙用法——
// 不是靠 feature()，而是靠「类型里没有 → 所有引用都是 any → 打包器能删」。'''),

(2993, 'before', '''// ── accumulateUsage：跨消息累加 ──
//
// 和 updateUsage 是**相反的操作**，两者容易混：
//   updateUsage(total, part)    合并流内事件 → 得到这一条消息的总量
//   accumulateUsage(a, b)       把多条消息的量加起来 → 得到整轮的总量
//
// 注意最后三个字段用 messageUsage 的「最新值」而不是相加：
//   service_tier / inference_geo / iterations / speed
// 这些是**标签性质**的字段（这一轮用什么档位跑的），相加没有意义。'''),

(3040, 'before', '''// 一个手写的类型守卫。
// 为什么不用 instanceof 或 in 运算符：这里是处理**跨进程/反序列化**
// 之后的数据（历史消息可能来自磁盘），对象原型已经不可信了，
// 只能靠结构判断（duck typing）。'''),

(3062, 'before', '''// ═══════════════════════════════════════════════════════════════
// addCacheBreakpoints —— 缓存打点的实现，也是全文件最「省 token」的地方
//
// 先理解 cache_control 的作用：标在哪一块，服务端就把「从头到这一块」
// 整段前缀存起来。下一次请求如果前缀一字不差，从缓存读，价格约 1/10。
//
// 所以这个故事的核心不是「打点」，而是**打在哪最划算**：
//
//   打得太靠前 → 缓存段短，省得少
//   打得太靠后 → 覆盖全部历史，命中率最高，但一旦末尾变了就全废
//
// 这段代码的策略是：**每请求只打一个消息级打点，位置在最后一条消息**
// （或者 skipCacheWrite 模式下倒数第二条）。下面那段关于 Mycro 的注释
// 解释了为什么「只能有一个」，那是一个内部的 KV 页管理细节：
// 两个打点会保护倒数第二个位置，让它的 local-attention 页多活一轮，
// 而那个位置永远不会被复用 —— 纯浪费显存。'''),

(3089, 'before', '''// skipCacheWrite 模式下打点前移一位。
// 什么场景会用到：fire-and-forget 的分叉调用（比如让另一个模型
// 顺便看一眼当前对话）。这种调用不需要留下自己的尾巴，
// 所以让打点落在「共享前缀的最后一点」上，写入变成 no-op 合并。
//
// 注意 skipCacheWrite ? length - 2 : length - 1。
// 当消息只有 1 条时前者是 -1，意味着**一个打点都不打** —— 这是有意的：
// 单条消息的场景没什么可缓存的。'''),

(3112, 'before', '''// ── cache_edits：主动删除缓存内容 ──
//
// 这是 cache editing 能力的配套：服务端允许你「告诉它删掉某段缓存」，
// 用来做精细的上下文管理（比如此前压缩掉的工具结果）。
//
// 但删除指令有两条严格约束，下面的代码就是为它们服务的：
//   1. 同一个 cache_reference 不能删两次（跨块去重 → seenDeleteRefs）
//   2. 删除块必须**固定在同一位置**重发（pinCacheEdits），
//      否则下一轮位置变了，服务端对不上号'''),

(3141, 'before', '''// 新一轮的删除指令人插在**最后一条 user 消息**里，
// 位置是「所有 tool_result 之后」（insertBlockAfterToolResults）——
// 这是 API 对 cache_edits 块的位置约束。
//
// 插入后立刻 pin（行 3153），保证下次请求它还在同一位置。'''),

(3164, 'before', '''// ── cache_reference 的补写，顺序很关键 ──
//
// 规则：tool_result 块上要带 cache_reference，才能被后续的 cache_edits 引用。
// 而它只对「缓存前缀内」的块有意义。
//
// 注释里那个「必须严格 before 而不是 before-or-on」值得注意：
// API 的规则是「cache_reference 必须在最后一个 cache_control 之前或同一个」，
// 这里刻意取更严的「之前」——因为 cache_edits 的插入会**移动块下标**，
// 取边界值会在下标偏移上出错。
//
// 还有一句 "Create new objects instead of mutating in-place"：
// 这些块可能被<b>同一进程内的第二次查询</b>复用（比如用不支持 cache_editing
// 的模型再发一次），原地改会污染那次请求。所以先克隆数组再替换元素。'''),

(3213, 'before', '''// ═══ buildSystemPromptBlocks ═══
//
// 它是 prompts.ts 里 splitSysPromptPrefix 的**消费方**，两个文件在这里对接。
//
// 回顾一下 splitSysPromptPrefix 的输出：把系统提示词切成若干块，
// 每块带一个 cacheScope（'global' / 'session' / null）。
// 这个函数做的事就是「把 cacheScope 翻译成 cache_control」：
//
//     cacheScope !== null → 打点（用 getCacheControl 生成 ttl/scope）
//     cacheScope === null → 不打点（这块是会话专属的，不该进缓存）
//
// 这就是 prompts.ts 里那个 SYSTEM_PROMPT_DYNAMIC_BOUNDARY 哨兵的落地处。'''),

(3221, 'before', '''// ⚠⚠ 这一行注释是全文件最短、也最该记住的一句：
//
//     "IMPORTANT: Do not add any more blocks for caching or you will get a 400"
//
// 系统提示词这边只允许有限个缓存块。想「多打几个点提高命中率」是错的，
// 会直接 400。缓存打点的数量约束是双向的：
//   消息侧只能有一个（行 3078 的 Mycro 注释）
//   系统提示词侧也有限（这里）
// 这是协议层的硬约束，不是性能调优空间。'''),

(3241, 'before', '''// ═══ queryHaiku / queryWithModel：两个薄封装 ═══
//
// 这两个函数几乎一模一样，唯一区别是 queryHaiku 强制用 getSmallFastModel()。
// 它们存在的原因是：Claude Code 内部有大量「顺手问一下小模型」的场景
// （生成标题、分类、提取记忆、判断意图），这些调用需要
// **走完整的 queryModel 管线**（认证、beta 头、重试、代理配置）
// 但不想要流式、不需要工具。
//
// 所以做法是：调 queryModelWithoutStreaming，把 thinking 关掉、tools 传空数组。
// 用具名函数而不是让调用方自己传参，是为了让这些场景的参数保持一致 ——
// 一旦某个调用忘了关 thinking，就会白白多花思考 token。'''),

(3254, 'before', '''// withVCR 是录制/回放层。注意第一个参数是要「喂给录制器」的消息形状，
// 而真正发出去的是下面那个只有 userPrompt 的 messages 数组。
//
// 为什么要拆成两份：录制文件需要包含 system prompt（否则回放时
// 上下文对不上），但实际请求里 system 是走单独的 system 字段，
// 不放进 messages。这是个容易看懵的地方。'''),

(3300, 'before', '''// 和 queryHaiku 的差别只有一处：不覆盖 model，用调用方传的。
// 用途是「指定模型问一句」，比如让 Opus 做一次关键判断。
//
// 再提醒一遍两个函数都做的事：enablePromptCaching 默认 **false**
// （`options.enablePromptCaching ?? false`）。
// 小模型的一次性调用开缓存几乎必然亏本——写入成本远大于可能的命中收益。'''),

(3350, 'before', '''// ═══ 非流式的 token 上限 ═══
//
// 这个 64_000 是**故意突破 SDK 默认值**的结果，注释把推导过程写清楚了：
//
//   API 文档：非流式请求上限 10 分钟
//   SDK 内部换算：10 min × 128k tokens/hour ≈ 21333 tokens
//   → SDK 用这个数当隐形上限
//
// 但 SDK 的换算假设是「按 token 生成速度推算超时」，而实际上
// 我们可以自己设 client timeout 绕开它（行 870）。绕开之后
// 这个常量就成了我们自己要守的上限。
//
// 换句话说：21333 是 SDK 的保护，64000 是我们接管保护后的新值。'''),

(3364, 'before', '''// 把 max_tokens 压到上限内，并且**同步调整 thinking 预算**。
//
// 为什么必须联动：API 有硬约束 max_tokens > thinking.budget_tokens。
// 只压 max_tokens 不压 budget_tokens，请求会直接 400。
//
// `cappedMaxTokens - 1` 里那个 -1 就是这个约束的体现：
// budget 必须**严格小于** max_tokens，等号也不行。'''),

(3394, 'before', '''// 这个开关（tengu_otk_slot_v1）控制「是否把默认 max_tokens 降到 8k」。
//
// 注释给了数据支撑：BQ p99 的实际输出是 4,911 tokens，
// 而默认的 32k/64k 会**超额预留 8-16 倍的并发槽位**。
// 也就是说大多数请求根本用不到那么多，但每个请求都按上限占坑，
// 服务端能同时服务的请求数就被这个虚高的默认值拖累了。
//
// 默认 false 是因为三方（Bedrock/Vertex）没验证过这个策略。'''),

(3399, 'before', '''// 最终生效值的计算，四级优先（从低到高）：
//
//   1. 模型原生默认值
//   2. 若 slot-reservation 开关打开 → min(原生默认, 8k)
//      这里用 min 是为了不抬高本来就更低的模型（如 claude-3-opus 的 4k）
//   3. 环境变量 CLAUDE_CODE_MAX_OUTPUT_TOKENS
//   4. 模型原生上限（validateBoundedIntEnvVar 的 upperLimit，兜底防越界）
//
// 注意开关的施加位置：在环境变量**之前**。
// 所以用户显式设了 CLAUDE_CODE_MAX_OUTPUT_TOKENS 依然能覆盖掉 8k 的压缩——
// 这个顺序是刻意的，用户的显式配置永远优先于我们的成本优化。'''),
]
