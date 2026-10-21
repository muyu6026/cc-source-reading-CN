# -*- coding: utf-8 -*-
"""claude.ts 批注 2/4：内部消息 → API 参数、Options、非流式执行器、请求链追踪、媒体裁剪。"""

ANNOTATIONS = [
(588, 'before', '''// ═══ 内部消息 → API 参数 ═══
//
// 从这一行开始，代码在做一件看起来琐碎但极其重要的事：
// **把内部消息格式翻译成 API 的 line 协议格式**。
//
// 内部格式（UserMessage / AssistantMessage）带着一堆 API 不认识的东西：
// uuid、timestamp、type 标签、isMeta、research……
// 其中 type 这个字段最微妙：内部用 'assistant' 区分消息来源，
// 而 API 的 role 只能是 'user' 或 'assistant'，两者语义**不完全对应**
// （比如内部的 isMeta 用户消息，发出去就是一条普通 user 消息）。
//
// addCache 参数决定「这条消息的最后一个内容块要不要打 cache_control 打点」。'''),

(622, 'after', '''// 这段注释说的是一个真实踩过的坑，值得展开：
//
// addCacheBreakpoints 会对同一条消息调用本函数，而它在 useCachedMC 模式下
// 还要做 insertBlockAfterToolResults —— 那个函数用的是 splice（原地改数组）。
// 如果这里直接把 message.message.content 原样返回，那么每调一次
// addCacheBreakpoints 就多插一份 cache_edits，同一条消息里堆叠重复块，
// API 直接 400。
//
// 注意「只在非缓存路径克隆」这个细节：addCache 为真时上面已经 map 出了新数组，
// 天然是副本，不必再克隆一次（那是每次请求都要走的热路径）。'''),

(633, 'before', '''// assistant 消息的转换和 user 几乎对称，但多三个例外判断（行 658-661）。
// 理由各不相同：
//   thinking / redacted_thinking：签名和模型绑定，把它们当成缓存末端会让
//     下一轮的 thinking 上下文对不上，服务端直接报错
//   connector_text：第三方连接器产出的文本，不参与 Anthropic 的缓存协议
// 也就是说，「最后一个块」不一定是「最后一个可以打点的块」——
// 要往前找第一个能打的。'''),

(676, 'before', '''// ═══ Options：外部调用方能配的一切 ═══
//
// 33 个字段，几乎每一个都对应一次「线上出过事，所以加个开关」。
// 按用途分四组看会清楚很多：
//
//   必填（模型/环境）     model / querySource / isNonInteractiveSession / agents
//   权限与工具            getToolPermissionContext / mcpTools / extraToolSchemas
//   缓存与预算            enablePromptCaching / skipCacheWrite / taskBudget
//   逃生舱                fetchOverride / temperatureOverride / maxOutputTokensOverride
//                        onStreamingFallback
//
// 值得注意的是 getToolPermissionContext 是个**异步函数**而不是值：
// 权限上下文会随用户操作实时变化，而请求构造可能发生在任意时刻，
// 所以要「用的时候现取」。这也解释了行 1731 那段日志优化为什么要特别处理它。'''),

(702, 'after', '''// 这条注释明确划清了两个预算的边界，值得记住：
// taskBudget 发给 API（模型自己看），tokenBudget.ts 自己记账（客户端看）。
// remaining 由**调用方**递减（query.ts 的 agentic 循环里），
// 而不是在这里扣 —— 这个文件只负责「如实转发当前余额」。'''),

(709, 'before', '''// ═══ queryModelWithoutStreaming：包了一层「假装不流式」 ═══
//
// 名字有点误导：它内部**仍然走流式**（queryModel 只实现了流式路径），
// 只是把流全部消费掉，只把最后一条 assistant 消息返回给调用方。
//
// 为什么这么设计而不是另写一条非流式实现：
// 流式路径已经有完整的重试、超时、降级、缓存打点逻辑，
// 再写一份非流式版本意味着两套逻辑要各自维护 bug。
// 唯一真正非流式的地方是「流式降级后的兜底」（executeNonStreamingRequest）。'''),

(724, 'after', '''// 这里的写法有个必须理解的怪处：**循环不是为了拿数据，是为了让生成器跑完**。
//
// logAPISuccessAndDuration 在 queryModel 里位于所有 yield **之后**（行 2858）。
// 如果调用方拿到第一条 assistant 消息就 break，生成器停在 yield 处，
// 后面那段永远不会执行——成功日志、成本累计、资源释放全丢。
// 所以这里的 for await 必须跑到 done，assistantMessage 只是「顺便记一下最后一条」。'''),

(741, 'before', '''// 一条 assistant 消息都没有。两种可能，处理方式不同：
//   signal 已中止 → 抛 APIUserAbortError（上层按「用户主动取消」处理，不报错）
//   否则          → 抛通用 Error（真异常，要暴露出来）
// 区分开的原因：中止是**预期行为**，如果混成普通错误，
// 用户每次按 ESC 都会看到一条红色报错。'''),

(752, 'before', '''// 和上面完全对称，只是把生成器原样透传出去（yield* 委托）。
// 两个函数的差别只有一行 return：一个有返回值的透传，一个丢弃流只留结果。
//
// withStreamingVCR 是录制/回放层：测试时把真实 API 响应录成文件，
// 重放时不再打网络。这也是为什么这两个薄壳存在——
// 录制钩子必须包在 queryModel 外面，而不能塞进 queryModel 里面。'''),

(786, 'before', '''// ── 延迟 LSP 工具 ──
// LSP（语言服务器）启动要几秒。启动期间如果把 LSP 工具放进工具列表，
// 模型可能去调它，然后拿到「还没准备好」的错误，白烧一轮。
// 所以这个窗口期内给工具打 defer_loading 标记 ——
// 工具仍然「存在」于提示词里（模型知道有这么个东西），
// 但不需要立刻把完整 schema 发过去。'''),

(795, 'before', '''// ── 非流式兜底的超时 ──
//
// 默认 300 秒，但远程会话（CLAUDE_CODE_REMOTE）降到 120 秒。
// 原因很具体：远程会话跑在 CCR 容器里，容器有约 5 分钟的 idle-kill。
// 如果超时设 300 秒，请求可能刚好卡在容器被杀的那一刻，
// 用户看到的是「连接莫名断开」而不是一个干净的超时错误。
//
// 120 秒 < 5 分钟，留出余量让 APIConnectionTimeoutError 先抛出来。'''),

(818, 'before', '''// ═══ executeNonStreamingRequest：真正的一次性请求 ═══
//
// 这是全文件唯一「不流式」的发送路径，只在流式彻底失败后启用。
// 它是一个生成器，但返回值（BetaMessage）才是重点——
// yield 出去的只有 SystemAPIErrorMessage（重试提示），
// 这种「yield 是过程、return 是结果」的双通道模式在 query.ts 里也反复出现。
//
// 六个参数值得逐个看一遍，因为它们划清了职责：
//   clientOptions   → 怎么建 HTTP 客户端
//   retryOptions    → 重试策略（含 fallbackModel、thinking 配置）
//   paramsFromContext → 参数工厂（同一个工厂给流式和非流式共用！）
//   onAttempt       → 回调，把 attempt / 起始时间 / max_tokens 抛回给调用方
//   captureRequest  → 回调，把最终参数留给 bug report
//   originatingRequestId → 失败的那次流式请求 id，用于漏斗关联'''),

(857, 'before', '''// 关键：非流式请求要额外套一层 adjustParamsForNonStreaming。
// 因为非流式有 10 分钟上限，SDK 内部按「10min × 128k tokens/hour」算出
// 21333 token 的隐形上限。这里显式设 client timeout 绕开它，
// 但绕开之后必须自己保证 max_tokens 不越界 —— 见行 3354 的说明。'''),

(874, 'after', '''// 用户主动中止不记日志、直接重抛。
// 这不是省事：如果把 abort 当错误记进 tengu_nonstreaming_fallback_error，
// 每次用户按 ESC 都会污染错误率指标，掩盖真正的故障。'''),

(908, 'before', '''// 这个 do/while 是全文件最有代表性的「生成器套生成器」写法，必须看懂：
//
// withRetry 返回的是一个生成器，它会在重试之间 yield 出 system 消息
// （「正在重试第 2 次…」这类提示）。这里边拉边把 system 消息转出去，
// 一直拉到 done，然后 e.value 才是最终的 BetaMessage。
//
// 注意 e.value 的类型在 done 前后不一样：
//   !done 时是 yield 出来的 SystemAPIErrorMessage
//   done 时是 return 的 BetaMessage
// TypeScript 靠 AsyncGenerator 的泛型参数区分这两者，所以最后要 as 一下。'''),

(919, 'before', '''// ── 请求链追踪 ──
//
// 每次请求带一个 requestId，下一次请求把它作为 previousRequestId 发回去，
// 服务端就能把整条对话串成一条链，用于分析缓存命中率与增量 token。
//
// 这里有个设计选择很值得学：**从消息数组里推导，而不是存全局变量**。
// 好处有三：
//   1. 主线程 / 子 agent / teammate 各自有独立的消息数组，天然互不干扰
//   2. 撤销/回滚会真的删掉消息，链也跟着自动回退（全局变量做不到）
//   3. 无状态，可测——喂一个数组就能验，不用 mock 全局状态'''),

(952, 'before', '''// ── 媒体数量裁剪 ──
//
// API 限制单次请求最多 100 个媒体块（图片 + PDF），超了会返回一个
// 非常难懂的报错。与其让用户对着那个报错误导半天，不如**静默丢掉最旧的**。
//
// 为什么丢最旧的而不是最新的：截图类工具通常是「越新越相关」，
// 早期的截图基本已经变成对话历史里的结论了，丢掉损失最小。
//
// 实现上有个容易漏的点：媒体块可以嵌在 tool_result 的 content 里（行 965），
// 所以要往下钻一层数。'''),

(972, 'after', '''// toRemove -= limit 之后如果 <= 0，说明没超限，**原数组直接返回**。
// 这个 early return 很重要：绝大多数请求不会超限，
// 走完整 map/filter 会给热路径平白加一次全量遍历。'''),
]
