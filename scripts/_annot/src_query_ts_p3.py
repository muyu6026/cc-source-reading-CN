# -*- coding: utf-8 -*-
"""query.ts 批注 3/4：API 调用、流式消费、withheld 四路、模型回退、错误处理。"""

ANNOTATIONS = [
(561, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 18. 两种工具执行模式：流式 vs 批式 ──
//
// 流式（streamingToolExecution）：模型还在吐 token 时，只要某个
//   tool_use 块完整了，就立刻开始执行。用户感知到的延迟大幅降低。
// 批式（默认）：等模型全部说完，再一次性执行所有工具。
//
// 这个 if 决定了后面所有 `if (streamingToolExecutor)` 分支的走法。
// 两种模式的行为必须严格等价（同样的工具、同样的结果、同样的顺序约束），
// 所以文件里到处是「两条分支各写一遍」的代码 —— 这是双模式并存的代价。
// ═══════════════════════════════════════════════════════════════'''),

(570, 'before', '''// ── 18.1 选模型：一个容易被忽略的运行时决策 ──'''),
(578, 'after', '''// 注：`getRuntimeMainLoopModel` 有三个参数，第三个很有意思：
//         exceeds200kTokens: permissionMode === 'plan' && doesMostRecentAssistantMessageExceed200k(...)
//     只有 **plan 模式** 且上一条 assistant 消息超过 200K 时才为 true。
//
//     为什么只对 plan 模式特殊？推测：plan 模式下模型在专注思考方案，
//     thinking 可能非常长，此时切到 1M 上下文模型能保住完整推理。
//     普通模式下超 200K 就该压缩了，换模型不解决问题。
//
//     注意 `??` 的短路：permissionMode !== 'plan' 时右边的函数根本不会被调用 ——
//     省掉一次遍历消息内容的开销，每轮都省。'''),

(582, 'before', '''// ── 18.2 一个用内存数字说话的优化 ──'''),
(590, 'after', '''// 译：每个 query 会话只创建一次 fetch 包装器，避免内存滞留。
//     每次调用 createDumpPromptsFetch 都会创建一个闭包来捕获请求体。
//     只创建一次意味着只保留最新的请求体（约 700KB），
//     而不是会话中所有请求体（长会话约 500MB）。
//     注意：agentId 在一次 query() 调用期间实际上是常量 ——
//     它只在 query 之间变化（比如 /clear 命令或会话恢复）。
//
// 注：这是本文件里唯一给出具体内存数字的注释，值得记住它的量级：
//     单次请求体 ~700KB，长会话累计 ~500MB。
//
//     700KB 是什么概念？一次请求包括：系统提示词（10K token）+ 完整对话历史
//     （可能 180K token）+ 工具定义。token 转字节大概 ×2~3，
//     所以 700KB 是合理的。
//
//     500MB 是什么概念？大约 700 次请求的累积。一个长会话跑 700 轮很正常
//     （每轮可能好几个工具调用）。如果每个请求体都被闭包持有，
//     进程内存会一路涨到 OOM。
//
//     这个 bug 的形态很典型：**闭包捕获 + 长生命周期对象 = 内存泄漏**。
//     修复方式是「让闭包只捕获一个可变的槽位，而不是每次新建闭包」。
//     注意这个优化只对内部版生效（config.gates.isAnt）——
//     因为 dumpPrompts 是内部排查工具，外部版没有这个 fetch 包装器。'''),

(592, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 19. 阻塞上限检查：一段 56 行的注释解释 6 个豁免条件 ──
// 这是全文注释/代码比最高的地方。代码只有 20 行，注释 56 行。
// 每一行注释都对应一个曾经踩过的坑。
// ═══════════════════════════════════════════════════════════════'''),

(615, 'before', '''// ── 19.1 collapseOwnsIt：把「谁负责处理溢出」显式化 ──'''),
(620, 'after', '''// 注：这个名字起得很准 —— "collapse owns it"（折叠拥有这件事）。
//     意思是：如果 contextCollapse 开着、且自动压缩也开着，
//     那么溢出处理的责任归折叠，主循环不要抢。
//
//     行 609-614 的注释解释了抢了会怎样：
//     「如果这里做一个合成 preempt，会在 API 调用之前就 return，
//       两条恢复路径（折叠的 recoverFromOverflow、反应式压缩）都吃不到
//       真实的 413 错误」。
//
//     关键词是「合成」。这里想做的检查是**预测**溢出（本地估算 token 数），
//     而恢复机制需要的是**真实**的 413。预测了并提前 return，
//     就等于把真实信号掐掉了。
//
//     最后一句「The isAutoCompactEnabled() conjunct preserves the user's
//     explicit 'no automatic anything' config」是在说：
//     如果用户设了 DISABLE_AUTO_COMPACT，那还是要做 preempt ——
//     因为他明确说了「不要任何自动行为」，此时提前报错才是尊重用户。'''),

(621, 'before', '''// ── 19.2 mediaRecoveryEnabled 为什么要"每轮提前算一次" ──'''),
(625, 'after', '''// 译：每轮把 media-recovery 的 gate 提前取一次。扣留（在流循环内）
//     和恢复（在流循环后）必须一致；CACHED_MAY_BE_STALE 可能在
//     5-30 秒的流式过程中翻转，而「扣留了却不恢复」会把消息吞掉。
//     PTL 不做这个提前取，因为它的扣留是无条件的 ——
//     它早于这个实验，已经是控制组的基线。
//
// 注：这段注释讲了一个非常隐蔽的 bug 形态：**同一个 gate 读两次，两次值不同**。
//
//     时间线：
//       T0  循环开始，读 gate → true（开启扣留）
//       T1  流式输出 5-30 秒，期间 GrowthBook 推送新配置
//       T2  流结束后，再读 gate → false（不执行恢复）
//       结果：错误消息被扣住没发，也没恢复 → 消息凭空消失
//
//     修复：T0 读一次，存进变量，T2 用同一个变量。
//     这就是「快照」的思路，和行 293 的 buildQueryConfig 是同一招。
//
//     后半句提到 PTL（prompt-too-long）不需要这么做，因为它「扣留是无条件的」——
//     也就是 PTL 的扣留不依赖任何 gate，所以不存在不一致问题。
//     这是一个很好的对比：**有条件的行为需要快照，无条件的不需要。**'''),

(628, 'after', '''// 注：五个条件全是「不要做阻塞检查」的豁免，逐一对应一个具体场景：
//
//   ① !compactionResult
//      刚压缩过。压缩结果已验证在阈值以下，而 tokenCountWithEstimation
//      会用残留消息里的**过期** input_tokens，反映的是压缩前的上下文大小。
//      → 不豁免就会「明明刚压完，却报太长」。
//
//   ② querySource !== 'compact'
//     自己就是压缩代理。它在满上下文的会话上运行，如果被拦住，
//      就永远跑不起来 —— 而它正是用来**降低** token 数的。死锁。
//
//   ③ querySource !== 'session_memory'
//      同上，会话记忆代理也是 fork 出来的，继承完整对话。
//
//   ④ !(reactiveCompact 开 && autoCompact 开)
//      反应式压缩开着时，它的**合成错误**会在 API 调用之前返回，
//      所以它永远看不到真实的 prompt-too-long，也就永远不触发。
//      → 必须让真实请求发出去，让 API 自己回 413。
//
//   ⑤ !collapseOwnsIt
//      同上，折叠也要真实 413 才能 drain。
//
//     这五条合起来说明一件事：**「提前拦截」和「事后恢复」是互斥的**。
//     你越早拦，恢复机制越拿不到真实信号。所以只在「没有任何恢复机制」
//     的情况下才提前拦 —— 那时候提前拦是在保护用户（至少给个明确错误，
//     而不是等 API 报一个更晦涩的错）。'''),

(638, 'after', '''// 注：`tokenCountWithEstimation(messagesForQuery) - snipTokensFreed`
//     —— 那个减法就是行 396 注释埋下的伏笔。
//
//     如果不减：snip 刚把上下文剪到阈值以下，但 tokenCountWithEstimation
//     读的是「受保护的尾部 assistant 消息的 usage」，那是 snip **之前**的数 ——
//     于是误判为超限，报 prompt too long。
//     注释里说得很精确：「在本次 PR 之前，这个窗口根本不存在，
//     因为 autocompact 总是基于过期计数触发」。
//
//     也就是：一个修好的 bug（snip 生效了）暴露了另一个潜在 bug（计数过期）。
//     这类「修复 A 暴露 B」的情况在多路径系统里非常常见。'''),

(650, 'after', '''// 注：`attemptWithFallback` 是**内层** while 的开关，和外层 while(true)
//     是两个不同的循环：
//
//         while (true) {                    ← 外层：一轮对话
//           ...
//           while (attemptWithFallback) {    ← 内层：同一次请求的重试
//             attemptWithFallback = false
//             try { ...流式... } catch (FallbackTriggeredError) {
//               attemptWithFallback = true  ← 回到内层开头，用 fallbackModel 重发
//               continue
//             }
//           }
//           ...
//         }
//
//     内层最多跑两次（第一次原模型，第二次 fallback 模型），
//     因为进入 catch 后会 `toolUseContext.options.mainLoopModel = fallbackModel`（行 922），
//     如果 fallback 模型也触发 FallbackTriggeredError……实际上会无限循环，
//     但那种情况不该发生（fallback 模型没有更下一级的 fallback）。
//     这是靠「不存在三级 fallback」这个前提保证的，没有显式计数器。'''),

(657, 'after', '''// 注：`streamingFallbackOccured` 是个**回调标志位**，不是异常。
//     它由 `deps.callModel` 的 `onStreamingFallback` 回调置位（行 678-680）。
//
//     为什么用回调而不是抛异常？因为流已经开始了 —— 可能已经 yield 了
//     好几条消息。抛异常会丢掉「已经产出过东西」这个事实，
//     而这些半成品必须被显式清理（发 tombstone）。
//     所以协议是：继续正常流式返回（用新模型的输出），
//     同时告诉调用方「前面那些作废」。
//
//     这就引出了行 712-741 那段清理逻辑 —— 那是本文件最精细的一段。'''),

(709, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 20. 流式回退的清理：tombstone（墓碑）机制 ──
// 这段代码解决的是「已经吐出去半截消息，现在要作废」的问题。
// ═══════════════════════════════════════════════════════════════'''),
(741, 'after', '''// 注：翻译一下这段注释的三个要点：
//
//   ① "We won't use the tool_calls from the first attempt"
//      不用第一次尝试的工具调用。因为它们的 id 已经发出去过了，
//      再发一次会出现「同一个 tool_use_id 两份 tool_result」。
//
//   ② "Yield tombstones for orphaned messages so they're removed from UI
//      and transcript"
//      给孤儿消息发墓碑。墓碑是一条特殊消息，告诉 UI「这条请删掉」。
//      为什么要删？因为它们在界面上已经显示出来了（用户看到半句话），
//      现在要撤回。
//
//   ③ 最关键的："These partial messages (especially thinking blocks) have
//      invalid signatures that would cause 'thinking blocks cannot be
//      modified' API errors."
//      这些半成品消息**尤其是 thinking 块**，签名是无效的。
//      如果留在历史里，下次发请求会 400。
//
//      这直接呼应了行 151 那个「巫师咒语」里的第三条铁律：
//      thinking 块必须在整条 trajectory 内保留 —— 但反过来，
//      一旦这条 trajectory 作废，thinking 块也必须一起作废。
//      签名是和「这次具体请求」绑定的，不能跨请求复用。
//
//   清理动作有四个，必须全都做：
//      assistantMessages.length = 0    ← 清空已收的 assistant 消息
//      toolResults.length = 0          ← 清空已收的工具结果
//      toolUseBlocks.length = 0        ← 清空待执行的工具
//      needsFollowUp = false           ← 重置出口信号
//      streamingToolExecutor.discard() ← 丢弃执行器（它的队列里可能有
//                                        基于旧 tool_use_id 的任务）
//   少做任何一个，都会留下「旧 id 的残留物」。'''),

(742, 'before', '''// ── 21. backfillObservableInput：一个关于"什么时候克隆"的精细判断 ──'''),
(787, 'after', '''// 注：这段是全文件最绕的一处，但它解决的是一个非常具体的问题。
//
//     【背景】
//     某些工具的 input 里有「派生字段」—— 模型只给了 file_path，
//     但工具需要 offset/limit（默认值）。工具通过
//     `backfillObservableInput(input)` 把这些补上。
//
//     【问题】
//     补了之后，要不要把这个补过的 input 发给外界（SDK 流 + transcript）？
//     如果不发，SDK 用户看到的是「只有 file_path」，跟实际执行不一致。
//
//     【关键洞察：只在「新增字段」时克隆，只在「覆盖已有字段」时不克隆】
//     行 765-770 的注释：
//       「只有 backfill **新增**字段时才 yield 克隆；如果只是**覆盖**
//         已有字段（比如文件工具展开 file_path），就跳过。
//         覆盖会改变序列化后的 transcript，破坏恢复时的 VCR fixture 哈希，
//         而 SDK 流并不需要它 —— hook 会通过 toolExecution.ts 单独拿到展开后的路径。」
//
//     三个约束在这里打架：
//       · SDK 用户需要看到真实 input（新增字段要给他们）
//       · VCR 测试需要 transcript 字节稳定（覆盖会让哈希变）
//       · hook 需要展开后的路径（但走另一条路给它）
//     解法就是「按字段增删类型分别处理」：新增 → 克隆并 yield，
//     覆盖 → 不克隆（保持原样，hook 另走通道）。
//
//     【为什么原 message 一定不能改】
//     行 744-746："The original `message` is left untouched ... it flows back
//     to the API and mutating it would break prompt caching (byte mismatch)."
//     这条最容易忽略：**发给 API 的历史必须字节不变**，否则 prompt cache
//     全部失效。所以这里的策略是「克隆一份给外面看，原件留给 API」。
//
//     这也解释了 `clonedContent ??= [...]` 那个延迟拷贝 ——
//     只有真的需要改才复制数组，否则连拷贝都省了。'''),

(788, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 22. withheld 的完整判断：四路独立扣留 ──
//
// 前面行 166 讲了「为什么要扣留」，这里看「什么时候扣留」。
// 四个来源，任意一个命中就扣住，互不依赖。
// ═══════════════════════════════════════════════════════════════'''),
(796, 'before', '''// ── 22.0 一条硬约束：feature() 只能出现在 if/三元里 ──'''),
(798, 'after_block', '''// 译：feature() 只能用在 if/三元条件里（bun:bundle 的 tree-shaking 约束），
//     所以折叠检查是嵌套写而不是组合写。
//
// 注：这是本次分析里发现的、关于 DCE 机制的第二条硬约束
//     （第一条在 prompts.ts：USER_TYPE 必须内联不能提成变量）。
//
//     【为什么只能用 if/三元】
//     bun 的打包器需要把 `feature('X')` 替换成字面量 true/false，
//     然后做常量折叠。这个替换只发生在**条件位置**：
//         if (feature('X')) {...}              ✓ 能折叠
//         feature('X') ? a : b                 ✓ 能折叠
//         const x = feature('X')               ✗ 不保证
//         if (a && feature('X'))               ← 这里就危险了
//     `a && feature('X')` 里 feature 不是「整个条件」，而是子表达式 ——
//     折叠后变成 `a && false`，整个条件变成 false，理论上可折叠，
//     但打包器不一定会做这个推导（保守策略）。
//
//     【所以这段代码长这样】
//         let withheld = false                    ← 先给默认值
//         if (feature('CONTEXT_COLLAPSE')) {      ← 独立 if，保证能折叠
//           if (contextCollapse?.isWithheldPromptTooLong(...)) withheld = true
//         }
//         if (reactiveCompact?.isWithheldPromptTooLong(message)) withheld = true
//         ...
//     而不是：
//         const withheld = feature('X') && collapseWithheld(...) || reactiveWithheld(...)
//     后者更短更清晰，但在外部版里 feature 折叠成 false 后，
//     整个表达式变成 `false && ... `，打包器能不能删掉右边是不确定的。
//
//     【代价】
//     代码变得又长又啰嗦（一个布尔量用 4 个 if 赋值）。
//     这是「构建期优化污染源码可读性」的第三个例证（前两个：
//     USER_TYPE 内联、require 条件导入）。'''),

(823, 'after', '''// 注：`if (!withheld) yield yieldMessage` —— 注意这里 yield 的是
//     `yieldMessage`（可能被克隆过的那份），而下面行 827 推进
//     assistantMessages 的是 `message`（原件）。
//     两条通道严格分开：
//       外部流 → 可能带 backfill 的克隆
//       内部历史 → 一定是原件（为 prompt cache 字节稳定）
//     这个分离是整段的核心设计，非常容易被改错。'''),

(826, 'before', '''// ── 23. 收集本轮产出：三个数组 + 一个标志位 ──'''),
(845, 'after', '''// 注：注意顺序 —— 先 push 到 assistantMessages（行 827），再抽出
//     toolUseBlocks（行 829-831），最后喂给 streamingToolExecutor（行 841-843）。
//
//     这个顺序保证了「即使后面中断，历史里也有完整的 assistant 消息」。
//     如果反过来（先执行工具再记录），中断时会出现
//     「工具跑了一半但历史里没有对应的 tool_use」→ 下次请求 400。
//
//     行 838-839 的守卫 `!toolUseContext.abortController.signal.aborted`
//     也是同一个思路：已经中断了就别再启动新工具，否则必然产生孤儿结果。'''),

(847, 'before', '''// ── 24. 流式执行器的结果收割：每条消息都要双写 ──'''),
(862, 'after', '''// 注：这段每收到一个执行结果就做两件事：
//       yield result.message             ← 给外部（UI 立刻显示工具输出）
//       toolResults.push(normalize...)   ← 给内部（下一轮要发给模型的上下文）
//
//     为什么 push 的是 `normalizeMessagesForAPI(...).filter(_ => _.type === 'user')`
//     而不是直接 push result.message？
//     因为 normalizeMessagesForAPI 会把各种内部消息形态（attachment、
//     tombstone、summary）统一成 API 能接受的形状，而 tool_result
//     在 API 里必须是 user 角色 —— 所以 filter 掉非 user 的。
//
//     这个「同一份数据，对外原样、对内规范化」的模式，和前面
//     yieldMessage/message 的分离是同一个思路。'''),

(866, 'before', '''// ── 25. 延迟的微压缩边界消息：用真实数字替换估算 ──'''),
(892, 'after', '''// 注：这段是行 420-425 那个伏笔的收尾。完整逻辑：
//
//     T0  微压缩跑完，得到 pendingCacheEdits（含 baselineCacheDeletedTokens）
//     T1  发请求（此时不发边界消息）
//     T2  收到响应，读 usage.cache_deleted_input_tokens
//     T3  delta = 累计值 - 基线 → 这就是**本次真正删掉的 token 数**
//     T4  delta > 0 才发边界消息
//
//     注释里两个细节：
//       「The API field is cumulative/sticky across requests」
//        —— 这个字段是**累计**的，不是本次增量。所以必须减基线，
//          否则第二次压缩会报「删了第一次+第二次」的总量。
//       「so we subtract the baseline captured before this request」
//        —— 基线是在发请求前捕获的（存在 pendingCacheEdits 里）。
//
//     最后 `Math.max(0, ...)` 兜底：万一基线比累计值还大（不该发生），
//     也不能报负数。
//
//     这个「估算 → 等真实值 → 回填」的模式，在分布式系统里很常见，
//     但在这里尤其重要：因为 prompt cache 的计费完全依赖这些数字，
//     估错了用户会看到不准确的「已节省」提示。'''),

(893, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 26. FallbackTriggeredError：模型回退 ──
//
// 和前面的 streamingFallback 是两种不同的回退：
//   streamingFallback  → 流**已经开始**了才发现要换模型（要发墓碑）
//   FallbackTriggered  → 流**还没开始**就失败了（干净重试，不用墓碑）
// 后者简单得多，因为它没有「已经吐出去的东西」要清理。
// ═══════════════════════════════════════════════════════════════'''),
(903, 'after', '''// 注：`yield* yieldMissingToolResultBlocks(...)` —— 即使是一次干净的重试，
//     也要先给已经产出的 tool_use 补上 tool_result。
//     因为异常可能发生在「收到几个 tool_use 之后、执行之前」。
//
//     然后清空三个数组、重置 needsFollowUp、重建 executor ——
//     和 streamingFallback 那段（行 716-740）是几乎一样的清理。
//     两处逻辑重复，但很难抽公共函数：因为一处要发墓碑（有已 yield 的消息），
//     一处不用（什么都没 yield 过）。这个差异让抽象变得不划算。'''),

(922, 'after', '''// 注：`toolUseContext.options.mainLoopModel = fallbackModel` —— 直接改对象属性，
//     而不是重建 toolUseContext。这是本文件里少见的原地修改。
//
//     为什么可以这么干？因为 toolUseContext 是「引用透传」的：
//     行 360 那个 `toolUseContext = { ...toolUseContext, queryTracking }` 只是
//     换了外层引用，options 仍是同一个对象。改 options 里的字段，
//     所有持有这个 options 的地方都会看到。
//
//     ⚠ 这是个危险操作 —— 如果后面某处缓存了 mainLoopModel 的旧值，
//     就会不一致。事实上行 572 的 currentModel 就是在循环开头算出来的，
//     这里改了 options 但没改 currentModel，所以行 896 单独写了
//     `currentModel = fallbackModel`。**两处都要改，漏一个就不生效。**'''),

(924, 'before', '''// ── 26.1 一个只有内部版踩得到的坑：thinking 签名跨模型无效 ──'''),
(929, 'after', '''// 注：`stripSignatureBlocks` 只在 USER_TYPE === 'ant' 时执行。
//     为什么？因为这个坑只在内部模型之间出现：
//     capybara 是内部专用模型，它的 thinking 签名格式和 opus 不同。
//     从 capybara 回退到 opus 时，把 capybara 的签名发过去 → 400。
//
//     注意这里是 `process.env.USER_TYPE === 'ant'` 内联写法，
//     不是提成变量 —— 和 prompts.ts 里那条 DCE 铁律一致。
//     外部版里这个 if 整段被删掉，因为外部用户根本用不到 capybara。
//
//     顺带一提：这也是「内部模型有额外约束」的一个例证。
//     整个文件里 USER_TYPE 判断只出现这一次，说明 query.ts
//     的主体逻辑对内外是一致的 —— 差异都集中在 model 层。'''),

(943, 'after', '''// 注：用 'warning' 级别而不是默认级别，注释说「用户不需要开 verbose 就能看到」。
//     这是个产品判断：换模型是对用户有实际影响的事（输出风格可能变、计费可能变），
//     必须主动告知，不能藏在日志里。
//
//     文案也值得看：`Switched to ${fallback} due to high demand for ${original}`
//     —— 把原因说成「原模型需求过高」，而不是「原模型出错了」。
//     这是对外话术：不给用户制造「服务不稳定」的印象。'''),

(955, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 27. 外层 catch：所有非回退类错误的统一出口 ──
// 注意这是**外层** try（对应行 653 的 try），内层 try 在行 656。
// 两层 catch 的职责完全不同：
//   内层 catch（行 893）→ 只处理 FallbackTriggeredError，其他 rethrow
//   外层 catch（行 955）→ 处理剩下的一切
// ═══════════════════════════════════════════════════════════════'''),

(977, 'after', '''// 注：图片错误单独识别，给用户友好文案。
//     为什么要特判？因为图片太大/尺寸不对这类错误，API 原始报错
//     极其晦涩（比如 "invalid_request_error: image exceeds 5MB maximum"），
//     而客户端其实能提前算出来。所以本地校验抛 ImageSizeError/ImageResizeError，
//     这里转成 content 直接展示。
//
//     注意 return 的 reason 是 'image_error'，和下面 media 恢复失败时的
//     reason 一致（行 1175）—— 说明「图片问题」是一个统一的终止分类。'''),

(980, 'after', '''// 注：注释承认了一个设计不彻底之处：
//     「queryModelWithStreaming 通常不该抛错，而应该把错误作为合成
//       assistant 消息 yield 出来。但万一它因为 bug 抛了，
//       我们可能已经发出了 tool_use 块，却会在发出 tool_result 之前停下。」
//
//     也就是：**正常路径不抛异常，异常路径是未定义行为**。
//     这段代码是在给「未定义行为」兜底。
//
//     这类「理论上不该发生，但我必须处理」的代码，通常是线上事故的产物。
//     注释里那句 "due to a bug" 说明作者见过它真的发生。'''),

(986, 'after', '''// 注：这段注释揭示了一个跨平台 bug：
//     「SDK 调用方在 Node 18 上看到假的 'interrupted by user'，
//       而真实原因是缺少 Array.prototype.with()」
//
//     Node 18 没有 Array.prototype.with（Node 20 才加），
//     所以某个用 `.with()` 的地方抛了 TypeError。
//     但上游把它归类成了「用户中断」，于是用户看到
//     "[Request interrupted by user]" —— 完全误导。
//
//     修复不是「加 polyfill」，而是「把真实错误暴露出来」：
//     这里 yield 的是 errorMessage（真实消息），不是中断文案。
//     这个决定的优先级很高：**错误可读性 > 界面整洁**。
//     一个假的中断提示会让用户以为是自己按错了键。'''),

(999, 'before', '''// ── 28. post-sampling hooks：模型说完之后的扩展点 ──'''),
(1009, 'after', '''// 注：`void executePostSamplingHooks(...)` —— 又是 fire-and-forget（故意不 await）。
//
//     为什么可以不 await？因为这是「通知型」钩子：它不该影响主流程。
//     如果 hook 慢，await 会让整个循环卡住。
//     代价是：hook 里抛的错不会被这里捕获（会变成未处理的 rejection），
//     所以 hook 实现内部必须自己 catch。
//
//     触发条件 `assistantMessages.length > 0` 是必要的：
//     如果模型一个字都没说（比如立刻出错），
//     post-sampling hook 没有任何东西可以评估。
//
//     注意传进去的是 `[...messagesForQuery, ...assistantMessages]` ——
//     完整上下文 + 本轮输出。hook 拿到的是一份能独立理解的材料，
//     不需要再去查别的东西。''')
]
