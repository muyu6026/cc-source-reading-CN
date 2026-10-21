# -*- coding: utf-8 -*-
"""QueryEngine.ts 批注 3/3：主循环、九种消息转换、五种 result、ask() 门面。"""

ANNOTATIONS = [
(657, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 24. 本轮记账：五个计数器 + 一个水位线 ──
//
// 这六个变量全部是 submitMessage 的局部变量（不是 this.xxx），
// 也就是说**每轮重置**。对比行 186 那些 this 字段（跨轮持久）。
// 这条分界线是本文件最需要记清的：this = 会话级，局部 = 轮级。
// ═══════════════════════════════════════════════════════════════'''),

(665, 'after', '''// 译：基于引用的水位线，让 error_during_execution 的 errors[] 只包含
//     本轮的错误。基于长度的索引在 100 条环形缓冲 shift() 时会失效 ——
//     索引会滑动。如果这个条目被轮换出去了，lastIndexOf 返回 -1，
//     我们就包含全部（安全的兜底）。
//
// 注：这段注释讲了一个很典型的「环形缓冲 + 索引」陷阱，值得展开：
//
//     【错误日志的结构】
//     getInMemoryErrors() 返回一个最多 100 条的环形缓冲。
//     满了之后每加一条就 shift() 掉最老的。
//
//     【错误做法：存长度】
//         const n = getInMemoryErrors().length
//         ... 之后用 errors.slice(n) 取"本轮新增的"
//     问题：如果本轮新增了 20 条，缓冲区把最老的 20 条移出去了，
//     那么 length 还是 100 —— slice(100) 得到空数组。
//     反过来如果本轮没有新增但缓冲区被别的代码清了，也会算错。
//
//     【正确做法：存引用】
//         const watermark = getInMemoryErrors().at(-1)   // 记住最后一条对象
//         ... 之后用 all.lastIndexOf(watermark) + 1 开始切
//     环形缓冲的 shift 只删头部，不会改变已有对象的引用 ——
//     所以只要那条对象还在，lastIndexOf 就能定位到它。
//
//     【兜底】
//     如果那条对象被轮换出去了（本轮产生了 100+ 条错误），
//     lastIndexOf 返回 -1 → `-1 + 1 = 0` → 从 0 开始切，
//     也就是包含全部。注释说这是 "safe fallback" ——
//     宁可多带一些错误，也不要漏掉本轮的。
//
//     这个模式（用引用当水位线，而不是索引/长度）在日志、队列、
//     快照增量里都适用。核心原则：**水位线要绑定到内容，不要绑定到位置。**'''),

(675, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 25. 进入主循环：for await 消费 query() ──
//
// 注意传了 `toolUseContext: processUserInputContext` —— 把整个
// 输入处理上下文当成工具上下文传进去。这两个类型能对上，
// 说明 ProcessUserInputContext 是 ToolUseContext 的超集。
// 这种「结构兼容」是 TypeScript 结构化类型的便利，
// 但也意味着两边的字段语义强耦合（改一边要检查另一边）。
// ═══════════════════════════════════════════════════════════════'''),

(686, 'after', '''// 注：`querySource: 'sdk'` 是硬编码的 —— 这条路径永远标记为 sdk。
//     它会影响 query.ts 里若干判断（比如 `querySource !== 'compact'`
//     的阻塞检查豁免）。
//
//     注意**没有**传 `maxOutputTokensOverride`、`skipCacheWrite`、
//     以及 `deps` —— 也就是说 SDK 路径不支持这些调优项。
//     这是「两条产品路径能力不对等」的又一处证据：
//     REPL 能做的某些精细控制，SDK 路径没暴露。'''),

(687, 'before', '''// ── 26. 落盘 + 回执：双重条件的前置动作 ──'''),
(715, 'after', '''// 注：这段是「压缩边界之前先 flush 未落盘的消息」。
//     注释描述的失败场景非常具体：
//
//     「如果 SDK 子进程在这之前重启（claude-desktop 在 turn 之间被杀），
//       tailUuid 指向一条从未被写入的消息 → applyPreservedSegmentRelinks
//       的 tail→head 遍历失败 → 不裁剪就返回 → 恢复时加载完整的压缩前历史。」
//
//     拆开看：
//       · 压缩边界消息里带 preservedSegment（哪些消息被保留了）
//       · 它有一个 tailUuid，指向保留段的最后一条
//       · 恢复时要从这个 tail 往回走到 head，把中间段裁掉
//       · 如果 tail 那条消息根本没落盘，遍历就断了 → 不裁剪 → 加载全部
//     结果就是「压缩白做了」—— 恢复后还是满上下文。
//
//     修复：在写边界消息之前，先把 up to tailUuid 的所有消息写下去。
//     代码只在 `tailIdx !== -1` 时写（找不到就跳过），
//     也就是说「内存里都没有这条消息」时不会误写。
//
//     这是一个**跨进程、跨时间**的一致性要求：一段逻辑的正确性
//     依赖于「另一个进程在某个时刻读到的磁盘状态」。
//     这类 bug 在单进程测试里几乎不可能复现。'''),

(717, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 27. 一段 10 行的注释，解释一个 await 与不 await 的死锁 ──
//
// 这是全文技术密度最高的注释，值得逐句翻译+解释。
// ═══════════════════════════════════════════════════════════════'''),
(732, 'after_block', '''// 译：对 assistant 消息使用 fire-and-forget。claude.ts 会为**每个
//     content block** yield 一条 assistant 消息，然后在 message_delta 时
//     修改最后一条的 message.usage/stop_reason —— 它依赖写队列的
//     100ms 延迟 jsonStringify。在这里 await 会阻塞 ask() 的生成器，
//     于是 message_delta 要等每个 block 都被消费完才能跑；
//     而排空定时器（在第一个 block 时启动）会先到期。
//     交互式 CC 不会踩到这个，因为 useLogMessages.ts 用的是 fire-and-forget。
//     enqueueWrite 是保序的，所以这里 fire-and-forget 是安全的。
//
// 注：这段注释揭开了一个非常深的时序耦合，逐层拆：
//
//     【事实 1：一条 assistant 消息不是一次 yield】
//     claude.ts 流式解析 SSE 时，每遇到一个 content block（一段文字、
//     一次工具调用）就 yield 一条 assistant 消息。所以一段包含
//     「先说一句话 + 调两个工具」的回复，会 yield 3 条 assistant 消息。
//
//     【事实 2：usage 和 stop_reason 是**后来才补上**的】
//     这 3 条消息 yield 的时候，usage 还是空的、stop_reason 是 null。
//     真正的值在流末尾的 message_delta 事件里。所以 claude.ts 会在
//     message_delta 时**回头修改最后一条**已 yield 的消息对象。
//     （注意：修改对象，不是再 yield 一条新消息。）
//
//     【事实 3：写盘的延迟序列化】
//     recordTranscript 不是立刻 JSON.stringify，而是入队，
//     100ms 后批量序列化。所以「对象在序列化之前被改」是安全的 ——
//     最终写下去的是改后的值。这是个刻意的设计：让「消息先发出去、
//     用量后补充」这件事成立。
//
//     【死锁是怎么形成的】
//     假设这里 await recordTranscript(messages)：
//       1. ask() 的生成器在 yield 第 1 条 assistant 消息后，
//          被调用方的 for await 消费，然后回到 ask() 里继续执行
//       2. 但 ask() 现在卡在 await recordTranscript 上
//       3. 于是它无法继续 yield 第 2、3 条消息
//       4. 而 message_delta 事件在流里排在这 3 条之后
//       5. claude.ts 的生成器也因为「没人消费」而卡住
//       6. 100ms 的排空定时器到期，把**还没补上 usage 的**消息序列化落盘
//       结果：transcript 里 usage 全是 0，stop_reason 全是 null。
//
//     【为什么 fire-and-forget 能解决】
//     await 改成 void 后，ask() 立刻能继续 yield 下一条，
//     流继续推进 → message_delta 到达 → claude.ts 修改最后一条消息 →
//     100ms 后序列化时拿到的是完整数据。
//
//     【为什么这是安全的】
//     "enqueueWrite is order-preserving" —— 写队列是保序的。
//     所以即使不 await，第 1 条消息也一定比第 2 条先入队。
//     这个保证是前提；如果队列会乱序，就不能这么写。
//
//     【为什么交互式不会踩到】
//     useLogMessages.ts 本来就是 fire-and-forget —— 它不 await，
//     所以同样的死锁不存在。也就是说这个 bug 只在 headless 路径上出现，
//     这解释了为什么它没被更早发现。
//
//     这段注释的价值在于：它记录的**不是**「这里为什么用 void」，
//     而是「这里为什么不能 await」。这类注释比前者有用得多 ——
//     因为后人最可能做的就是「加个 await 让它更可靠」。'''),

(753, 'after', '''// 注：`turnCount++` 只在收到 **user** 类型消息时发生。
//     回顾上一份文件：query.ts 里每轮产出的顺序是
//     assistant（模型说话）→ user（工具结果）→ assistant → user …
//     所以 turnCount 实际计的是「工具结果轮次 + 1」。
//
//     注意这里统计的是**所有** user 消息，包括 attachment 转成的消息。
//     所以 turnCount 会比用户在界面上看到的「轮数」大一些。
//     result.num_turns 用这个值，SDK 调用方不应该拿它当
//     「对话了几轮」的准确指标。'''),

(757, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 28. switch：九种内部消息 → SDKMessage 的完整映射表 ──
//
// 这是本文件的核心，也是理解「内外协议差异」最好的地方。
// 九种内部类型，处理方式分三类：
//   ① 转发（但要换形状）  assistant / user / tool_use_summary / system(部分)
//   ② 丢弃（内部信号）    tombstone / stream_request_start
//   ③ 内部消化（不转发）  progress / attachment（除少数分支）
// 注意「内部消化」的三种：它们都 push 进 mutableMessages（历史需要），
// 但不 yield（对外不可见）。这个区分很重要：
// **历史完整性 ≠ 对外可见性**。
// ═══════════════════════════════════════════════════════════════'''),

(760, 'after', '''// 注：tombstone 是「请删掉这条消息」的控制信号（见上一份文件行 712）。
//     SDK 调用方不需要知道 —— 它收到 tombstone 也不知道该删哪条
//     （因为那条可能压根没发给它）。
//
//     所以这里**完全丢弃**：break，不 push 进 mutableMessages，不 yield。
//     这也是为什么 QueryEngine 的 mutableMessages 里可能有未清理的孤儿消息 ——
//     它没有处理 tombstone。不过这通常无影响，因为
//     `getMessages()` 的消费者（下一次 submitMessage）传进 query() 后，
//     query() 会用 getMessagesAfterCompactBoundary 过滤。
//
//     ⚠ 但严格说这是个潜在不一致：query.ts 认为 tombstone 该删消息，
//     QueryEngine 直接忽略了它。两边的消息数组在极端情况下会分叉。'''),

(765, 'after', '''// 注：为什么要在这里捕获 stop_reason？注释解释了：
//     「流式响应在 content_block_stop 时这个值还是 null；
//       真正的值通过 message_delta 到达（下面处理）」。
//
//     所以这个 if 只对**合成消息**（synthetic）有效 ——
//     合成消息是本地造的，stop_reason 一开始就有值。
//     流式消息在这里白跑一次判断，实际值是行 806 捕获的。
//
//     这又是一个「两条路径共用一个分支」的例子：
//     代码为了同时兼容合成消息和流式消息，加了判断，
//     但对流式消息来说这个判断永远是 false（有点浪费，但无害）。'''),

(769, 'after', '''// 注：`yield* normalizeMessage(message)` —— 注意是 `yield*` 而不是 `yield`。
//     normalizeMessage 是个生成器（可能产出 0 条或多条消息），
//     所以用委托。
//
//     为什么需要 normalize？因为内部 Message 和 SDKMessage 的形状不同：
//       内部 assistant 消息有 message.usage、uuid、timestamp 等字段，
//         还可能有 isApiErrorMessage、isMeta 等内部标记
//       SDK 协议只认 { type, message, session_id, parent_tool_use_id, uuid }
//     normalizeMessage 做这次映射，顺带补上 session_id、parent_tool_use_id。
//
//     注意它**不改变** ContentBlock 的结构 —— 文本、工具调用原样透传。
//     所以「模型说的内容」是完全一致的，变的是信封（envelope）。
//     这个区分很重要：**改信封不改内容**，是协议适配的基本原则。
//
//     也是在这一行 push 进 mutableMessages（行 768）——
//     注意顺序：先 push 再 yield。如果反过来（先 yield 再 push），
//     调用方可能在 push 之前就发起下一次 submitMessage，
//     导致这条消息丢失。'''),

(771, 'before', '''// ── 28.1 progress / attachment：为什么要"内联记录" ──'''),
(782, 'after', '''// 注：这段注释记录了一个**只在 resume 时暴露**的 bug，非常值得读：
//
//     「内联记录，这样下一次 ask() 调用里的去重循环就会看到它
//       已经被记录过了。不这样做，延迟的 progress 会和已经记录过的
//       tool_results 在 mutableMessages 里交错，去重遍历就会
//       在错误的消息上冻结 startingParentUuid ——
//       导致链条分叉、resume 时会话变成孤儿。」
//
//     拆解这个机制：
//
//     【transcript 是一条链】
//     sessionStorage 里每条消息有 parentUuid，指向它的上一条。
//     resume 时从最后一条往回走，重建整条链。
//
//     【去重遍历依赖顺序】
//     下一次 ask() 要写新消息时，需要找到「已经写到哪里了」。
//     它遍历 mutableMessages，跳过已经记录过的，找到最后一条已记录的
//     作为 startingParentUuid。
//
//     【交错导致的问题】
//     如果 progress 消息延迟记录（先 yield 后记），那么在这一轮里，
//     mutableMessages 的顺序是：
//         tool_result(已记录) → progress(未记录) → tool_result(已记录)
//     去重遍历走到 progress 时发现「未记录」，就把 startingParentUuid
//     冻结在这里 —— 但后面还有已记录的消息！
//     结果新消息挂在 progress 后面，而 progress 后面本来接着别的 tool_result，
//     链条就分叉了。
//
//     【后果是"会话变成孤儿"】
//     resume 时沿着 parentUuid 走，走到分叉点就断了，
//     分叉出去的那一支永远走不到 → 那部分历史丢失。
//
//     修复：progress 也**内联立刻记录**（行 778-781），
//     这样「未记录的消息」不会出现在中间。
//
//     这是本文件里最隐蔽的一个坑：单轮测试完全正常，
//     只有「resume 一个长会话」才会暴露。注释写这么细是因为
//     任何简化（比如「反正 progress 不重要，晚点记吧」）都会重新引入它。'''),

(784, 'before', '''// ── 28.2 user 消息：最简单的一个 case ──'''),
(787, 'after', '''// 注：只有三行 —— 因为 user 消息的落盘已经在行 688-732 那个
//     统一块里做过了（`message.type === 'user'` 在那个 if 里）。
//     这里只负责 push 进 mutableMessages 和 yield。
//
//     注意这里**没有**把 user 消息放进 `messages`（本轮 transcript 累积器）——
//     也是因为统一块里已经放了（行 716）。
//     这种「同一件事在两个地方做，各做一半」的分工是本文件
//     最容易读错的地方。判断依据是：**看那个 if 条件覆盖了哪些 type**。
//     行 688-692 覆盖 assistant / user / compact_boundary，
//     所以 switch 里这三个 case 都不用重复落盘。'''),

(788, 'before', '''// ── 28.3 stream_event：用量累加 + stop_reason 捕获 + 可选转发 ──'''),
(828, 'after', '''// 注：这是本文件唯一处理流式细粒度事件的地方，三个子事件各有职责：
//
//     message_start  → 重置 currentMessageUsage（新消息开始）
//     message_delta  → 累加 usage + 捕获 stop_reason（注释解释了原因：
//                      真正的 stop_reason 只在这里到达，见 claude.ts）
//     message_stop   → 把当前消息的 usage 累加进 totalUsage
//
//     注意累加是**两段式**：
//       currentMessageUsage  单条消息的用量（message_start 重置，delta 累加）
//       totalUsage           整个会话的累计（message_stop 时合并）
//     为什么要分两段？因为一条消息的 usage 是**分多次到达**的
//     （message_start 给 input_tokens，message_delta 给增量 output_tokens）。
//     如果直接累到 totalUsage，会重复计算 input_tokens。
//
//     `includePartialMessages` 控制要不要把每个流事件转发给 SDK。
//     默认 false —— 因为转发会让 SDK 收到几百条细粒度事件，
//     大多数调用方只想要「完整消息」，不想要 token 级流。
//     需要「打字机效果」的调用方才打开它。
//
//     注意 yield 里 `uuid: randomUUID()` —— **每次生成新 uuid**，
//     而不是复用 message.uuid。因为流事件不是消息，没有稳定的身份。
//     SDK 调用方不能用这个 uuid 去关联别的消息。'''),

(829, 'before', '''// ── 28.4 attachment：内部消化，但两个分支要转发 ──'''),
(893, 'after', '''// 注：attachment 有几十种类型（max_turns_reached、structured_output、
//     queued_command、edited_text_file、hook_stopped_continuation…），
//     这里只处理三种：
//
//     structured_output  → 提取到 structuredOutputFromTool，最后放进 result
//                          注意**不 yield** —— 它是元数据，不是消息
//     max_turns_reached  → **立即 yield result 并 return**
//                          这是本轮的唯一终止方式（因为 query() 只发这个
//                          attachment，不返回错误）
//     queued_command     → 如果 replayUserMessages 开着，转成 user 回执
//
//     其余所有 attachment 都只是 push 进历史（行 830），对外不可见。
//
//     注意 max_turns_reached 的处理里有个细节：
//     `num_turns: message.attachment.turnCount` —— 用的是 attachment
//     自己带的轮数，而不是本文件的 turnCount 变量。
//     因为本文件的 turnCount 统计口径不同（行 753 的批注）。
//     在终止路径上用准确的那个。
//
//     还有：所有终止路径都先 `flushSessionStorage()`（如果开了 eager flush）——
//     因为进程可能马上退出，未落盘的数据会丢。这个模式在 5 个终止点
//     各重复一次（行 843、973、1016、1073，以及这里）。'''),

(894, 'before', '''// ── 28.5 stream_request_start：内部信号，丢弃 ──'''),
(896, 'after', '''// 注：上一份文件里说它是「每轮迭代开头 yield 的第一条消息，给 UI 一个
//     新轮次开始的信号」（query.ts 行 337）。但 SDK 调用方不需要它 ——
//     因为它不参与任何协议语义，只是个渲染提示。
//
//     所以这里 break 丢弃。注意它**也没有** push 进 mutableMessages ——
//     因为它不是对话内容。
//
//     这是一个「内部信号 vs 对外协议」的清晰分界：
//     内部有很多这种「纯控制信号」（tombstone、stream_request_start），
//     它们存在的目的是驱动 UI 或控制流，不属于对话数据。'''),

(897, 'before', '''// ── 28.6 system：四个分支，只有两个会转发 ──'''),
(916, 'after', '''// 注：system 消息有十几个 subtype（compact_boundary、api_error、
//     local_command、snip_boundary、init…），这里处理三个：
//
//     ① snip 边界（行 905-915）→ 调注入的回调，重建整个消息数组
//        ⚠ 关键：`if (snipResult !== undefined) { ... break }` ——
//        **命中就 break**，不往下走。也就是说 snip 边界消息本身
//        **不会被 push 进 mutableMessages**（注释行 899-900 说得很清楚：
//        「yielded boundary 是信号，不是要 push 的数据 —— 重放会产出
//        它自己的等价边界」）。
//        如果不 break，就会重复：既 push 了原边界，又 push 了重放产生的边界。
//
//     ② compact_boundary（行 918-942）→ 转发给 SDK
//     ③ api_error（行 943-955）→ 转成 api_retry 转发
//
//     其余 subtype 全部丢弃（行 956：「Don't yield other system messages
//     in headless mode」）。这句注释暴露了一个事实：
//     交互模式下这些 system 消息**是显示的**（比如 local_command 的输出），
//     只是 headless 不显示。所以这个 switch 是「一条路径的裁剪版」，
//     不是「system 消息的完整映射」。'''),

(917, 'before', '''// ── 28.7 压缩后释放内存：splice 两处数组 ──'''),
(934, 'after', '''// 注：这是本文件唯一**主动释放内存**的地方。注释说：
//     「释放压缩前的消息供 GC 回收。边界刚被 push 所以它是最后一个元素。
//       query.ts 内部已经用 getMessagesAfterCompactBoundary() 过滤，
//       所以往后只需要边界之后的消息。」
//
//     两个数组都裁：
//       this.mutableMessages  会话历史（会一直活着）
//       messages              本轮 transcript 累积器
//     两边都裁到「只剩边界」。
//
//     为什么必须在这里裁？因为 mutableMessages 是**跨轮持久**的 ——
//     一个长会话如果不裁，压缩前的所有消息会一直占内存。
//     而压缩的意义本来就是「这些内容已经被摘要替代了」，
//     留着它们既没用又占空间。
//
//     ⚠ 但注意这里只裁 mutableMessages，**没有**裁 sessionStorage
//     （磁盘上的 transcript）。所以 --resume 时还是能回到压缩前 ——
//     这是好的（用户可能想往前翻），但内存和磁盘不一致。
//     这是「内存优化」和「可恢复性」的取舍：内存能省，磁盘不能省。
//
//     `splice(0, idx)` 而不是 `splice(0, idx + 1)` —— 保留边界本身。
//     用 `> 0` 守卫避免 idx 为 0 时空操作（虽然 splice(0,0) 也无害）。'''),

(959, 'before', '''// ── 28.8 tool_use_summary：直接转发 ──'''),
(968, 'after', '''// 注：最简单的一个 case —— 形状几乎一样，只是加上 session_id。
//     这是上一份文件里「藏在模型流式输出时间里的 Haiku 摘要」
//     （query.ts 行 1469）的最终出口。
//
//     注意 `preceding_tool_use_ids` —— 摘要关联了它总结的是哪几个
//     工具调用。这样 SDK 调用方可以把摘要显示在对应工具调用的旁边，
//     而不是当成一条独立的对话消息。'''),

(971, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 29. 三个"每收到一条消息就检查"的终止条件 ──
//
// 这三个检查都在 switch **外面**（每条消息之后都跑一遍）：
//   ① USD 预算超了
//   ② 结构化输出重试次数超了
//   （加上 switch 内部 max_turns_reached 那个，一共三个提前终止点）
// ═══════════════════════════════════════════════════════════════'''),

(972, 'after', '''// 注：`getTotalCost() >= maxBudgetUsd` —— 用**全局**成本计数器，
//     不是本引擎的成本。所以如果有多个引擎并发（SDK 里可能），
//     它们共享同一个成本池 —— 这个检查会互相影响。
//
//     这可能是刻意的（「整个进程的花费上限」），也可能是历史遗留
//     （cost-tracker 是全局单例）。从字段名 maxBudgetUsd 是
//     引擎配置来看，语义上应该是「这个会话的预算」，
//     但实现是「进程总花费」。属于语义和实现不一致的地方。
//
//     注意检查的位置：**每条消息之后**。所以如果一条消息花了很多钱，
//     可能超了还继续跑几条才停下。不是精确的硬限额，
//     而是「尽快停下」的软限额。'''),

(1004, 'before', '''// ── 30. 结构化输出的重试限制：一个"增量计数"的技巧 ──'''),
(1048, 'after', '''// 注：这段的关键是「增量」而不是「总量」：
//       initialStructuredOutputCalls  本轮开始前已经调用过几次（行 671）
//       currentCalls                  现在总共调用过几次
//       callsThisQuery = 差值        → **本轮**调用了几次
//
//     为什么不能直接用 currentCalls？因为 mutableMessages 是跨轮持久的。
//     如果上一轮已经调了 5 次，这一轮一进来 currentCalls 就是 5，
//     立刻触发上限。用差值才能实现「每轮独立的重试预算」。
//
//     这个技巧在本文件里只出现一次，但模式很常见：
//     **在跨轮持久的结构上做轮级限流，必须用快照差值。**
//
//     `MAX_STRUCTURED_OUTPUT_RETRIES || '5'` 默认 5 次 ——
//     因为结构化输出是「试错」性质的：模型第一次给的 JSON 可能
//     不符合 schema，要让它再试。5 次是个平衡点：
//     够覆盖常见的格式错误，又不至于无限循环烧钱。
//
//     注意这个检查只在 `message.type === 'user'` 时做 ——
//     因为 user 消息代表「一轮工具调用结束」，是检查点的自然位置。'''),

(1051, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 31. 结果提取：一段注释解释"为什么不能用 last(messages)" ──
//
// 这是本文件里最能体现「注释防回归」价值的一段。
// ═══════════════════════════════════════════════════════════════'''),

(1057, 'after_block', '''// 译：stop hooks 在 assistant 响应**之后**产出 progress/attachment 消息
//     （通过 query.ts 里的 yield* handleStopHooks）。自从 #23537 那些消息
//     被内联 push 进 `messages` 之后，last(messages) 可能是 progress/attachment
//     而不是 assistant —— 这会让下面的 textResult 提取返回 ''，
//     于是 -p 模式输出一个空行。改成只允许 assistant|user：
//     isResultSuccessful 两者都能处理（全是 tool_result 块的 user 消息
//     也是合法的成功终态）。
//
// 注：这个 bug 的形态值得记住：
//
//     【起因】一个优化（#23537：把 stop hook 的产出内联 push 进 messages）
//     【后果】数组最后一条不再是「模型的回答」，而是「hook 的副产品」
//     【症状】`claude -p "问题"` 输出了一个空行 —— 但退出码是 0，
//             没有任何错误信息
//     【为什么难查】因为逻辑上一切正常：message 都被正确处理了、
//             历史也是完整的，只是「取最后一条」这个假设失效了。
//
//     【修复】把「最后一条」改成「最后一条 assistant 或 user」——
//     用 findLast + 谓词，而不是 last。
//
//     这是一个典型的「顺序假设被打破」的 bug。原代码隐含假设
//     「messages 最后一条一定是模型刚说的话」，而一旦有别的组件
//     往数组末尾追加东西，假设就不成立了。
//
//     注释里提到 isResultSuccessful 「两者都能处理」，这也是必要的：
//     如果最后一条是 user（全是 tool_result 块），那也是一个**合法的
//     成功终态**（模型调完工具、工具跑完、没有后续输出）。所以
//     不能简单地「找最后一条 assistant」，要把 user 也算进来。'''),

(1061, 'after', '''// 注：`edeResultType` / `edeLastContentType` 是给错误诊断用的。
//     注释解释了为什么必须先算出来：
//     「isResultSuccessful 是类型谓词（message is Message），所以
//       在 false 分支里 `result` 会被收窄成 never，那些访问无法通过类型检查。」
//
//     这是 TypeScript 类型谓词的一个反直觉行为：
//         if (!isResultSuccessful(result)) {
//           result.type      // ← 编译错误：result 是 never
//         }
//     因为谓词断言「如果返回 true，result 就是 Message」，
//     那么在一处返回 false 的分支里，TypeScript 推导出
//     「result 不是 Message」—— 而 result 本来就是 Message，
//     所以变成 never（不可能的值）。
//
//     解法：在 if 之前先把需要的字段算成字符串（行 1064-1068），
//     这样 false 分支里只用字符串变量，不碰 result。
//
//     这是个「类型系统太聪明反而碍事」的例子。实际项目里遇到谓词，
//     经常需要在判断前先提取数据 —— 这个模式值得记住。'''),

(1070, 'before', '''// ── 32. 五种 result：本文件对外的全部输出契约 ──'''),
(1080, 'after', '''// 注：`if (persistSession)` + eager flush —— 原因在下一行的注释里：
//     「桌面应用收到 result 消息后会立刻杀掉 CLI 进程，所以任何
//       未 flush 的写入都会丢失。」
//
//     这是「进程生命周期由外部控制」的典型场景：
//     CLI 作为子进程运行，它的生死由父进程（桌面应用）决定。
//     父进程的判据是「收到 result 消息」—— 所以 result 是**最后一条**
//     消息，发出去之后必须保证所有副作用已经落盘。
//
//     这个约束解释了整段代码里为什么有 6 处 flushSessionStorage：
//     每一个可能「发 result 然后退出」的地方都要 flush。
//     少一处就会出现「偶尔丢历史」的间歇性 bug。'''),

(1082, 'after', '''// 注：第一种失败结果。`isResultSuccessful(result, lastStopReason)` 检查两件事：
//       · result 是「assistant 带 text/thinking」或「user 带 tool_result」
//       · stop_reason 是 end_turn
//     任一不满足就认为「这一轮没正常结束」。
//
//     为什么要检查 stop_reason？因为模型可能在 tool_use 处停下
//     （stop_reason: 'tool_use'），而那意味着「还有工具没执行」——
//     不该出现在这里（如果出现了，说明 query.ts 有 bug）。
//
//     注意 errors 数组的构造（行 1106-1115）用了 IIFE（立即执行函数）——
//     因为要在里面做多行逻辑（取水位线、切片、map）。写成内联表达式
//     会很难读。这是「在对象字面量里做复杂计算」的常见技巧。'''),

(1101, 'after', '''// 注：注释解释了这个诊断字符串的价值：
//     「这些是 isResultSuccessful() 检查的东西 —— 如果 result 类型
//       不是 assistant-with-text/thinking 或 user-with-tool_result，
//       且 stop_reason 不是 end_turn，那就是它触发的原因。」
//
//     也就是说：这个字符串把「判断依据」和「实际值」并列输出：
//         result_type=assistant last_content_type=tool_use stop_reason=tool_use
//     只看这一行就知道为什么判定失败 —— 不需要再去猜。
//
//     后半句还记录了一个改进：
//     「errors[] 通过水位线限定在本轮；之前它会把整个进程的 logError
//       缓冲全倒出来（ripgrep 超时、ENOENT 等）。」
//
//     这是「错误报告的信噪比」问题：一个 result 里塞了几百条
//     无关的历史错误，等于没有错误信息。用水位线（行 669）切出
//     本轮的部分，才让这个字段真正可用。'''),

(1120, 'before', '''// ── 33. 成功结果：最后一条消息的文本提取 ──'''),
(1156, 'after', '''// 注：成功路径的四个判断，每个都有理由：
//
//     `result.type === 'assistant'`      只有 assistant 才有 text
//     `lastContent?.type === 'text'`     最后一个 block 必须是文本
//                                        （如果是 tool_use，说明还有工具没跑）
//     `!SYNTHETIC_MESSAGES.has(...)`     排除合成的占位文本
//                                        （比如「[Request interrupted]」这类）
//     textResult = lastContent.text      只取最后一段文本
//
//     只取最后一段，不拼接全部 —— 因为前面的文本通常是「过程说明」
//     （「我先看一下文件」），用户真正要的答案是最后那段。
//     这个选择符合 -p 模式的用法（拿一个最终答案）。
//
//     `isApiError = Boolean(result.isApiErrorMessage)` —— 注意
//     subtype 仍然是 'success'，但 is_error 可能是 true。
//     这是个刻意的设计：消息**成功送达**（success），
//     但内容是 API 错误（is_error）。两个维度独立。
//     SDK 调用方要分别判断这两个字段，不能只看一个。
//
//     `structured_output: structuredOutputFromTool` —— 从 attachment 里
//     提取的（行 839）。如果调用方传了 jsonSchema，这就是它的产出。
//     没传时是 undefined，字段仍然出现（值为 undefined）——
//     JSON 序列化时会被省略。'''),

(1158, 'before', '''// ── 34. 四个方法：全部是透传 ──'''),
(1177, 'after', '''// 注：四个方法都不做任何逻辑：
//       interrupt()         → abortController.abort()
//       getMessages()       → 返回 mutableMessages 的只读视图
//       getReadFileState()  → 返回文件缓存引用
//       getSessionId()      → 全局 sessionId
//       setModel()          → 改配置里的模型
//
//     注意 `getMessages()` 返回 `readonly Message[]` —— 只是类型层面的
//     只读，运行时仍是同一个数组引用。调用方如果用 `as Message[]` 强转，
//     还是能改。TypeScript 的 readonly 是约定，不是保护。
//
//     `setModel` 改的是 `this.config.userSpecifiedModel` ——
//     下一轮 submitMessage 会读到新值（行 274 解构）。
//     但**当前正在跑的轮次不受影响**（因为配置已经在行 213 解构成局部变量了）。
//     所以「改模型」的效果从下一轮开始 —— 这个时序没写在文档里，
//     只能从代码推出来。'''),

(1179, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 35. ask()：一次性调用的门面 ──
//
// 本文件有两个出口：QueryEngine 类（多轮）和 ask()（单轮）。
// ask() 的价值只有一个：**让调用方不用管状态**。
// 它内部 new 一个引擎、跑一轮、回写文件缓存，然后整个丢掉。
// ═══════════════════════════════════════════════════════════════'''),

(1186, 'before', '''// 译：向 Claude API 发送一条提示词并返回响应。
//     假定 claude 是以非交互方式使用的 —— 不会向用户请求权限
//     或进一步输入。是 QueryEngine 的便捷包装，用于一次性使用。
//
// 注：注意 "Assumes that claude is being used non-interactively" ——
//     这不是限制，而是**前提**：如果 canUseTool 的实现会弹交互式
//     权限对话框，那这个假设就不成立，行为会是未定义的
//     （可能在 stdin 上卡死）。
//
//     所以 ask() 的正确用法是：调用方自己提供 canUseTool，
//     且它的实现必须是确定性的（看规则、不弹窗）。'''),

(1276, 'after', '''// 注：这就是行 158-172 那个 snipReplay 字段的**唯一注入点**。
//     三个细节：
//
//     ① 只在 `feature('HISTORY_SNIP')` 为真时才展开这个属性
//        （`...(cond ? { snipReplay } : {})`）。
//        所以外部版里 QueryEngineConfig 根本没有这个字段 ——
//        这就是「特性门控的字符串留在门控模块里」的实现方式。
//
//     ② 回调内部先 `isSnipBoundaryMessage(yielded)` 判断，
//        不是边界就返回 undefined —— 让 QueryEngine 知道「这条我不能处理」。
//
//     ③ `snipCompactIfNeeded(store, { force: true })` 传了 force ——
//        因为「遇到边界」就是明确的执行信号，不需要再判断阈值。
//
//     注意用了 `snipProjection!` 和 `snipModule!` 两个非空断言 ——
//     因为它们在外部版是 null，但这整段代码只在 feature 为真时才会执行，
//     所以运行时一定非空。这是 DCE 模式下无法避免的断言。'''),

(1287, 'after', '''// 注：`try { yield* ... } finally { setReadFileCache(...) }` ——
//     这个 finally 是本文件最重要的一个正确性保证。
//
//     【为什么需要它】
//     readFileState 是「模型读过哪些文件、内容是什么」的缓存，
//     用来避免重复读盘、以及做「文件是否被外部修改」的检测。
//     它必须**回写**给调用方，否则下一轮 ask() 会从零开始
//     （每个文件都要重新读一遍）。
//
//     【为什么用 finally 而不是正常路径】
//     因为 submitMessage 可能在任意时刻被中断、抛错、
//     或者被调用方提前 .return()。所有这些路径都必须回写 ——
//     否则「读了一半就被中断」的那一轮，读盘成果全丢。
//     用 finally 能覆盖所有退出方式。
//
//     【为什么是 setReadFileCache 而不是直接改】
//     因为传进来的是 `cloneFileStateCache(getReadFileCache())`（行 1259）——
//     引擎内部改的是**克隆**，原件没变。所以必须显式回写。
//     如果不克隆（直接共享引用），就不需要这一步，但那样
//     中断时会把「未完成的读取」污染到调用方的缓存里。
//     克隆 + 回写 = 「要么全成功，要么全不变」的原子性。
//
//     这是一个「用克隆换原子性」的设计，代价是多一次拷贝。'''),

(1295, 'after', '''// ═══════════════════════════════════════════════════════════════
// 【本文件小结 · 四个可以带走的结论】
//
// 1. 它是「会话状态的宿主 + 内外协议的边界」
//    query.ts 无状态（Params 进，消息出），所以状态必须有地方存 ——
//    就是这里。而内外两种消息类型（9 种内部 / 5 种 SDK）的转换
//    也在这里。读这个文件只需盯两件事：this 字段（状态）
//    和 switch（转换）。
//
// 2. 大量代码在做「时序正确性」，而不是业务逻辑
//    最重要的三段注释都是时序问题：
//      · 行 436 为什么要在进 query 之前落盘（否则 --resume 失败）
//      · 行 717 为什么 assistant 消息不能 await（否则 usage 丢失）
//      · 行 771 为什么 progress 要内联记录（否则 resume 链条分叉）
//    这三处的共同点：单轮测试正常，长会话/resume 才暴露。
//
// 3. 「内部消化」和「对外可见」是两件事
//    tombstone、progress、attachment、stream_request_start 都要进
//    mutableMessages（历史需要完整），但都不 yield（协议不需要）。
//    混淆这两者会导致两种 bug：历史缺消息（上下文断裂）、
//    或协议收到垃圾（客户端崩溃）。
//
// 4. 每条终止路径都要手动 flush + 包装 result
//    五个终止点（max_turns / max_budget / structured_output_retries /
//    error_during_execution / success）各自写一遍 result 对象，
//    每个都要 flush。这是「进程可能被父进程立刻杀掉」这个约束
//    渗透出来的重复。
//
// 下一步：src/services/api/claude.ts —— 最底层的 API 客户端。
// 如果这个文件是「会话」，query.ts 是「一轮」，那 claude.ts 就是
// 「一次 HTTP 请求」：SSE 解析、重试、缓存控制、图片处理、错误分类。
// ═══════════════════════════════════════════════════════════════''')
]
