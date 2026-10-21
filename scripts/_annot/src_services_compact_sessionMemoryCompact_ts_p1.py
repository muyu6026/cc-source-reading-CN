# -*- coding: utf-8 -*-
"""sessionMemoryCompact.ts 批注：session memory 压缩、索引对齐、两种场景。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 6/N —— session memory 压缩（src/services/compact/sessionMemoryCompact.ts）
//
// 文件第一行就写着 `EXPERIMENT`。这是一个**实验性**的压缩路径，
// 默认关闭（两个 GrowthBook 开关都要 true 才生效）。
//
// 【它解决的核心问题：省一次昂贵的 API 调用】
//
// 传统压缩（compact.ts）要发一次完整的 API 请求：把整个历史发过去，
// 让模型写摘要。成本 = 一个完整上下文的输入 + 几千 token 的输出。
//
// 而 session memory 这条路**不需要那次调用**——因为它要用的是
// **已经在后台写好的摘要**。
//
// 【背景：session memory 是什么】
//
// 主会话之外有一个后台 agent，在每轮对话后悄悄维护一份"会话记忆"
// 文件（类似于笔记）。它记录的是：用户的目标、做过的决定、
// 当前进度、待办事项。
//
// 也就是说：**摘要在压缩发生之前就已经准备好了**。
//
// 压缩时只要：
//   1. 读那个文件
//   2. 把它当成摘要消息
//   3. 保留最近几条消息
//
// 完事。零 API 调用。
//
// 【所以这个文件本质上是"拼接"而不是"压缩"】
//
// 它做的事：把「已有的会话记忆」+「最近 N 条原始消息」拼成一个
// 新的上下文。真正的难点不在"怎么总结"，而在**怎么切那一刀**。
//
// 【全文分三块，读之前先建立框架】
//
//   ① 配置      47-130  三个阈值，从 GrowthBook 拉一次
//   ② 切点计算  132-397 这是本文档 80% 的技术含量所在
//   ③ 执行      437-630 读记忆、拼结果、检查阈值
//
// 【②为什么这么复杂】
// 因为切点必须同时满足五个约束：
//   · 保留的 token 够（否则模型没有工作上下文）
//   · 保留的消息条数够（否则只有一堆工具调用，没有对话）
//   · 不能劈开 tool_use / tool_result 配对（否则 API 报 400）
//   · 不能劈开共享 message.id 的 thinking 块（否则 thinking 丢失）
//   · 不能跨过上一个 compact boundary（否则磁盘链断裂）
//
// 前两个是"信息量"约束，后三个是"正确性"约束。
// 232 行那个函数就是专门处理后三个的。
// ═══════════════════════════════════════════════════════════════'''),

(44, 'before', '''// 三个阈值，各有各的方向：
//
//   `minTokens`            —— 保留**至少**多少 token（信息量下限）
//   `minTextBlockMessages` —— 保留**至少**几条"有文字的"消息
//   `maxTokens`            —— 保留**至多**多少 token（硬上限）
//
// 【为什么"条数"和"token 数"两个下限都要有】
//
// 只按 token 算会出问题。假设保留 10,000 token：
//   · 可能是 3 条超长的消息（比如三条 3,000 token 的工具结果）
//   · 也可能是 50 条短对话
//
// 第一种情况下，模型看到的全是工具输出，**没有一句人话**。
// 它不知道用户在干什么、目标是什么。
//
// 所以还要一个"至少 N 条有文本块的消息"——保证保留段里
// 有真正的对话内容，不是纯工具数据。
//
// 【`minTextBlockMessages` 这个名字里的 "text block" 是关键】
// 不是"至少 5 条消息"，而是"至少 5 条**含有 text 块**的消息"。
// 一条只有 tool_use 的 assistant 消息、一条只有 tool_result 的
// user 消息，都不算。
//
// 这个定义在 135 行的 `hasTextBlocks` 里。'''),

(57, 'before', '''// 默认值：10K token / 5 条文本消息 / 40K 上限。
//
// 【三个数字的相对关系值得算一下】
//   下限 10,000，上限 40,000 —— 4 倍空间
//
// 这个区间意味着：从"上次摘要的位置"开始，保留段通常落在
// 10K~40K 之间。如果一开始就超过 40K（比如上次摘要后聊了很久），
// 什么都不保留（351-354 行直接返回 startIndex）。
//
// 【40K 这个上限的参照】
// 自动压缩阈值大概是上下文窗口的 92%（context-collapse 是 90%/95%）。
// 200K 窗口 → 阈值约 184K。压缩后保留 40K + 摘要 + 附件（约 30K）
// ≈ 70-80K，离阈值还有很大空间。所以这个上限是安全的。
//
// 【注意 `DEFAULT_SM_COMPACT_CONFIG` 是导出的，但 `smCompactConfig` 不是】
// 注释写着 "exported for use in tests"——测试要能拿到基准值
// 来验证 "远程配置覆盖后是否还是合理的"。'''),

(63, 'before', '''// 模块级可变配置 + 一个"是否已初始化"标志。
//
// 【为什么配置是模块级的而不是按会话传参】
// 因为这个文件的所有入口（`trySessionMemoryCompaction`、
// `calculateMessagesToKeepIndex`）都可能有多个调用方，
// 而配置是**全局一致的**（GrowthBook 的配置不分会话）。
//
// 用模块级变量的好处是：`calculateMessagesToKeepIndex` 这种
// 纯计算函数不需要多一个 config 参数，签名保持干净。
//
// 坏处是：**测试之间会互相污染**。所以有 `resetSessionMemoryCompactConfig()`
// （93 行）专门给测试用。
//
// 【这是一个典型的"便利 vs 可测性"权衡】
// 如果配置按参数传，每个调用点都要多传一个对象，而且
// 从 `trySessionMemoryCompaction` 一路传到 `calculateMessagesToKeepIndex`
// 要穿透三层。用模块级变量省掉了这个穿透。'''),

(98, 'before', '''// 每会话只从 GrowthBook 拉一次。
//
// `configInitialized` 在**拉之前**就设成 true（106 行），这是有意的：
// 即使这次拉取失败抛异常，也不会无限重试。
//
// 【为什么用 `getDynamicConfig_BLOCKS_ON_INIT` 而不是
// `getFeatureValue_CACHED_MAY_BE_STALE`】
//
// 看名字就知道：
//   · `CACHED_MAY_BE_STALE`  —— 读缓存，可能过期，但**绝不阻塞**
//   · `BLOCKS_ON_INIT`       —— 初始化没完成就**等**，拿到的是准值
//
// 压缩是个低频、非紧急的操作，多等 10 毫秒没关系，
// 但**配置一定要准**——如果读到默认值、压缩完才发现配错了，
// 那一次压缩就白做了（而且用户已经等着了）。
//
// 对比 `shouldUseSessionMemoryCompaction`（403 行）用的是
// `CACHED_MAY_BE_STALE`，因为那个函数在**每轮**都被调，
// 绝不能阻塞。
//
// 【"同一个文件的两种读配置方式"是一个很好的观察点】
// 读法不同 = 调用频率和精确性要求不同。看到这种差异，
// 先问"这个函数多久调一次"。'''),

(113, 'before', '''// ═══ 只有"显式设置了正数"才覆盖默认值 ═══
//
// 三重判断：`remoteConfig.minTokens && remoteConfig.minTokens > 0`
//
// 【为什么不直接 `?? 默认值`】
// 因为 `??` 只挡 `null` / `undefined`，挡不住 `0`。
//
// 而 GrowthBook 的配置**很容易出现 0**：
//   · 运营在后台建了个实验，字段没填 → 默认 0
//   · JSON 里写了 `"minTokens": 0` 想表示"不限制"
//   · 某次配置下发把字段清空了
//
// 如果 0 生效会发生什么：
//   · `minTokens: 0` → 保留 0 token 也满足下限 → 一条都不保留
//   · `maxTokens: 0` → 352 行 `totalTokens >= 0` 恒真 → 什么都不保留
//
// 结果就是"压缩后上下文是空的"，比不压缩还糟。
//
// 【所以这里的规则是：0 视为"没配置"】
// 这是一个防御性的默认值策略：**远程配置的空值不能改变本地行为**。
//
// 【这类防御的通用形式】
//   `x > 0 ? x : 默认值`  —— 数值配置
//   `x !== '' ? x : 默认值` —— 字符串配置
//   `Array.isArray(x) && x.length ? x : 默认值` —— 数组配置
//
// 核心思想：**不要相信远程配置的"有效性"，只相信它的"存在性"**。'''),

(132, 'before', '''// 判断一条消息里有没有"真正的文字内容"。
//
//   assistant → content 数组里有 `type === 'text'` 的块
//   user      → content 是字符串且非空，或者数组里有 text 块
//
// 【为什么 user 要区分字符串和数组】
// 因为 user 消息的 content 有两种形态：
//   · 用户直接输入 → 字符串
//   · 工具结果返回 → 数组（`[{type:'tool_result',...}]`）
//
// 只判断数组会漏掉所有"用户真的说话了"的消息——那恰恰是最该保留的。
//
// 【`content.length > 0` 而不是 `content !== ''`】
// 两者对字符串等价，但 `length` 的意图更明确（"有没有字符"）。
//
// 【注意 assistant 分支不判字符串】
// 因为 assistant 消息的 content 在 API 类型里**永远是数组**
// （即使只有一句纯文本，也是 `[{type:'text', text:'...'}]`）。
// 只有 user 消息才有字符串形态。'''),

(152, 'before', '''// 取一条消息里所有 tool_result 的 tool_use_id。
//
// 只看 user 消息（tool_result 永远在 user 消息里）。
//
// 【返回数组而不是 Set】
// 因为调用方（245 行）是 `allToolResultIds.push(...getToolResultIds(...))`，
// 需要 push 展开。如果返回 Set 得再转一次。
//
// 【这个函数的"轻"是刻意的】
// 它不做去重、不判空、不抛错。因为这些工作在调用方做更合适——
// 调用方要把多条的 id 合在一起，只有它知道去重的边界在哪。'''),

(172, 'before', '''// 判断一条 assistant 消息里有没有指定的 tool_use id。
//
// 参数是 `Set<string>` 而不是数组——因为这个函数在循环里被调
// （269 行向前扫），每次都查一遍。用 Set 是 O(1)，用数组是 O(n)。'''),

(188, 'before', '''// ═══════════════════════════════════════════════════════════════
// 索引对齐（82 行，232-314）—— 全文最核心的函数
//
// 输入：一个"想从这里开始保留"的索引
// 输出：一个"实际上可以从这里开始"的索引（只会变小，不会变大）
//
// 【下面的 doc 注释是一份完整的 bug 复盘，值得逐行读】
//
// 它列了两个场景，每个都给了具体的数据和错误结果。
// 这类注释在整个代码库里都不多见——通常注释只写"做什么"，
// 这份写的是"不这么做会发生什么"，而且是带着索引和 id 的具体例子。
//
// 【先说清楚这两个场景的物理来源】
//
// 关键事实：**流式响应会为每个内容块产生一条独立的消息**。
//
// 一次 assistant 回复里如果有 [thinking, tool_use_A, tool_use_B]，
// 在内部消息数组里是**三条消息**：
//   Index N    assistant, message.id: X, content: [thinking]
//   Index N+1  assistant, message.id: X, content: [tool_use: A]
//   Index N+2  assistant, message.id: X, content: [tool_use: B]
//
// 它们的 `message.id` 相同（同一个 API 响应），但 `uuid` 不同。
//
// 然后在发 API 之前，`normalizeMessagesForAPI` 会把同 id 的**合并**回一条。
//
// 【这就是所有麻烦的来源】
// 切点如果落在这三条中间：
//   · 合并之后，某些 tool_use 消失了，但对应的 tool_result 还在 → 孤儿
//   · 合并之后，thinking 块可能没有"容器"了 → 丢失
//
// 而且这些错误**在本地看不出来**——本地消息数组是完整的，
// 只有发到 API 才会 400。'''),

(232, 'before', '''// 早期返回：索引在边界上就不用调整。
//
// `startIndex <= 0` 意味着"从头保留"，没有"前面"可以扩展。
// `startIndex >= messages.length` 意味着"一条都不保留"，
// 也不会有配对问题。
//
// 【注意第二个条件用的是 `>=`】
// 如果 `startIndex === messages.length`，是合法的"保留空"。
// 341-349 行的循环一次都不执行，`totalTokens` 保持 0。
// 然后 351 行 `0 >= maxTokens` 为假，357 行下限也不满足，
// 走 364 行的"向前扩展"——所以实际上不会真的空。'''),

(244, 'before', '''// ═══ Step 1：处理 tool_use / tool_result 配对 ═══
//
// 第一步：把**保留范围内所有** tool_result 的 id 收集起来。
//
// 【注意这里从 `startIndex` 扫到末尾，不是只看第一条】
// doc 注释专门强调了这一点：
//   "This handles the case where streaming yields separate messages per
//    content block (thinking, tool_use, etc.) with the same message.id but
//    different uuids. If the startIndex lands on one of these streaming
//    messages, we need to look at ALL kept messages for tool_results,
//    not just the first one."
//
// 翻译：因为切点可能落在一组同 id 消息的中间，保留范围的第一条
// 可能只是一条 thinking 消息，里面根本没有 tool_result。
// 如果只看第一条，会误判"没有配对问题"。
//
// 【这就是 bug 场景一里的 "Old code: checked only message N+2"】
// 老代码只看 `messages[startIndex]`，看到没有 tool_result 就放行，
// 结果合并之后产生孤儿 tool_result。'''),

(264, 'before', '''// 从"需要的 id"里剔除"保留范围内已经有的"。
//
// 【为什么要剔除？】
// 如果某个 tool_use 已经在保留范围里了，它的配对是完整的，
// 不需要再往前找。
//
// 【`toolUseIdsInKeptRange` 用的是 `adjustedIndex` 而不是 `startIndex`】
// 因为 252 行之前 `adjustedIndex` 还等于 `startIndex`
// （Step 1 还没改过它），两者此刻相同。
//
// 用 `adjustedIndex` 是为了让代码"在 Step 1 内部就自洽"——
// 万一以后在 252 行之前插了别的调整逻辑，这里也会跟着用新的值。'''),

(269, 'before', '''// 从 `adjustedIndex` 向前扫，找到包含"还需要"的 tool_use 的消息。
//
// `adjustedIndex = i` —— 一旦找到就**把切点往前挪到那条消息**。
//
// 【为什么是"挪到"而不是"把那条消息单独拉进来"】
// 因为保留段必须是**连续的一段**。不能"保留第 5 条、跳过 4、保留 3"。
// 所以一旦需要第 3 条，切点就变成 3，4 也被一起保留。
//
// 这就是为什么返回值只可能是"变小"——宁可多保留，不可断链。
//
// 【循环条件 `neededToolUseIds.size > 0` 是个性能优化】
// 需求满足了就停，不用扫到数组开头。
//
// 【找到后从 set 里删除】
// 因为一条 assistant 消息可能包含**多个** tool_use（见 doc 注释里
// `Index N+2` 那条同时有 ORPHAN_ID 和 VALID_ID... 虽然例子里是分开的，
// 但实际可能合并在一起）。删掉已找到的，避免重复工作。'''),

(290, 'before', '''// ═══ Step 2：处理 thinking 块 ═══
//
// 收集保留范围内所有 assistant 消息的 `message.id`。
//
// 【这一步和 Step 1 的区别】
//   Step 1 找的是"配对关系"（tool_use ↔ tool_result）
//   Step 2 找的是"同源关系"（同一个 API 响应被拆成的多条消息）
//
// 第二种关系在 API 层面不存在（因为发出去的是合并后的），
// 但在**内部消息数组**里存在。
//
// 【为什么需要这一步？看 doc 注释的场景二】
//
//   Index N    assistant, message.id: X, content: [thinking]
//   Index N+1  assistant, message.id: X, content: [tool_use: ID]
//   Index N+2  user, content: [tool_result: ID]
//
// 如果 startIndex = N+1：
//   · N 被排除在外
//   · normalizeMessagesForAPI 把 N+1 和 N+2 正常处理
//   · 但 N 的那条 **thinking 块彻底消失**
//
// 后果不只是"少了点内容"。thinking 块带 **signature**，
// 而 signature 是模型验证"这段思考确实是我生成的"的凭据。
// 在 extended thinking 的会话里，如果 thinking 块被丢弃但
// 后续还有 thinking，API 会报"signature 不匹配"或者
// "thinking blocks must be preserved"。
//
// 所以必须把 N 也拉进来——让 normalizeMessagesForAPI 有东西可合并。'''),

(300, 'before', '''// 向前扫，凡是 `message.id` 在保留范围内的 assistant 消息，都拉进来。
//
// 【这里没有 `break`，也没有"需求满足就停"】
// 因为不知道"一共需要几条"——必须扫到开头。
//
// 会不会扫太多？理论上如果一个 id 出现在很靠前的位置，会把中间
// 一大段都拉进来。但实际上同 id 的消息是**连续的**（流式响应
// 产生的），所以扫几条就结束了。
//
// 【`adjustedIndex = i` 在循环里不断被赋更小的值】
// 因为是从后往前扫，每找到一条就往前挪。最后 `adjustedIndex`
// 就是"最早那条同 id 消息"的位置。
//
// 【一个隐患，但不会触发】
// 这个循环用的是 `adjustedIndex` 的下界（`i >= 0`），
// 而不是 Step 1 之后的某个边界。所以理论上会把 Step 1 已经
// 处理过的区间再扫一遍——但只是读，不会改错。'''),

(316, 'before', '''// ═══ 算切点（74 行，324-397）═══
//
// 算法分三段：
//
//   ① 从 `lastSummarizedIndex + 1` 开始（上次摘要的边界）
//   ② 看这一段够不够（token 数 + 文本消息条数）
//   ③ 不够就**向前扩展**，直到满足或撞到上限
//
// 【注意"向前扩展"这个方向】
// 不是"从后往前挑"，而是"先定一个起点，然后往前挪"。
//
// 因为要求保留段是**连续的、贴到末尾的**——最后一条消息必须保留。
// 所以只能"往前加"，不能"从中间挑"。
//
// 【为什么要贴着末尾】
// 因为最后一条消息是"当前正在进行的事"。丢了它，模型不知道
// 用户刚刚说了什么、工具刚刚返回了什么。'''),

(334, 'before', '''// 起点：上次摘要位置的下一条。
//
// 【两种"没有上次摘要"的情况，都映射到 `messages.length`】
//   `lastSummarizedIndex === -1`  → 找不到那条消息（被修改过）
//   `lastSummarizedIndex >= 0` 但调用方传的是 `messages.length - 1`
//                                  （resumed session，见 564 行）
//
// 两者都让 `startIndex = messages.length` = 一条都不保留，
// 然后靠 364 行的"向前扩展"把该留的补回来。
//
// 【这个初值设计很聪明】
// 它把"没有摘要边界"这个特例，归约成了"保留段一开始是空的，
// 然后按需扩展"。不用写两套逻辑。
//
// 【对比 341-349 行的循环】
// 从 `messages.length` 开始时，这个循环一次都不跑，
// `totalTokens = 0`、`textBlockMessageCount = 0`。
// 然后 352 行判上限（0 >= 40000 假）、357 行判下限（0 >= 10000 假）
// → 落到 364 行的扩展循环。逻辑连贯。'''),

(351, 'before', '''// 已经超过上限 → 不扩展，直接用当前起点。
//
// 【这个分支什么时候会进？】
// 只有 `lastSummarizedIndex` 很靠前（上次摘要之后聊了很多），
// 导致剩下的部分本身就有 40K+。
//
// 这种情况下的选择是：**一条都不额外保留，全部靠摘要**。
//
// 听起来很激进，但合理：既然剩下的部分已经超过上限，
// 那"再保留"只会让压缩后立刻又超阈值，白压一次。
//
// 注意这里**没有**做"截断到 40K"——因为截断意味着从中间砍，
// 那又会劈开配对。所以选择"整段都不保留"，让 session memory
// 的摘要承担全部信息。'''),

(356, 'before', '''// 两个下限都满足了 → 不用扩展。
//
// `&&` 不是 `||` ——**两个都要满足**。
//
// 【为什么不能是 `||`】
// 如果用 `||`：
//   · 10,000 token 但只有 2 条文本消息 → 满足（token 够了）
//   · 但模型看到的可能是"一堆工具输出 + 两句话"，不知道在干什么
//
// 反过来：
//   · 5 条文本消息但只有 3,000 token → 满足（条数够了）
//   · 但信息量太少，可能刚说完"我要改这个文件"就被截断了
//
// 所以两个都要。这是"下限"的标准语义——**每个维度都得达标**。'''),

(364, 'before', '''// ═══ 向前扩展，但有一个地板（floor）═══
//
// 364-369 行的注释：
//
//   "Floor at the last boundary: the preserved-segment chain has a disk
//    discontinuity there (att[0]→summary shortcut from dedup-skip), which
//    would let the loader's tail→head walk bypass inner preserved messages
//    and then prune them. Reactive compact already slices at the boundary
//    via getMessagesAfterCompactBoundary; this is the same invariant."
//
// 【这段是全文件最难看懂的一段，逐句拆】
//
// "the preserved-segment chain has a disk discontinuity there"
//   ——磁盘上的父子链在那个位置是**断的**。
//
// "att[0]→summary shortcut from dedup-skip"
//   ——因为压缩时被保留的消息（"preserved segment"）在磁盘上
//     是**去重跳过**的（不重复写入），所以它们的 parentUuid
//     还指向压缩前的旧节点。加载器为了让链接上，会做一个捷径：
//     从"附件第一条"直接跳到"摘要"。
//
// "which would let the loader's tail→head walk bypass inner preserved
//  messages and then prune them"
//   ——这个捷径的后果：加载器从尾往头走时，会**跳过**中间那些
//     被保留的消息（因为链被短路了），然后认为它们是孤儿，
//     在 prune（修剪）阶段删掉。
//
// "Reactive compact already slices at the boundary via
//  getMessagesAfterCompactBoundary; this is the same invariant."
//   ——响应式压缩那边已经用"从边界之后开始切"避免了这个问题。
//     这里是同一个不变量在另一个地方的实现。
//
// 【用人话说】
// 绝对不能跨过上一个 compact boundary 往前扩展。
// 否则被保留的消息在 `--resume` 时会丢掉。
//
// 【370-371 行的实现】
//   `const idx = messages.findLastIndex(m => isCompactBoundaryMessage(m))`
//   `const floor = idx === -1 ? 0 : idx + 1`
//
// 找最后一个边界，从它**之后**开始。找不到边界就是 0（可以扫到开头）。
//
// 【注意这里用的是 `findLastIndex`】
// 如果只有一个边界，`findLast` 和 `find` 一样。
// 但如果有多个（多次压缩过的会话），必须用**最后一个**——
// 因为前面的边界已经被后面的覆盖了，只有最后一个还有效。'''),

(372, 'before', '''// 循环：从 `startIndex - 1` 往前，一条一条加。
//
// 375-378 行：累加 token、累加文本消息数、把 `startIndex` 挪到 i。
//
// 【注意 `startIndex = i` 是在判断之前做的】
// 所以即使下面立刻 `break`，i 这条也已经算进保留段了。
// 这是对的——"加进来之后满足了"就该保留它。
//
// 381-384 行：撞到上限 → break
// 386-392 行：满足两个下限 → break
//
// 【两个 break 的优先级】
// 上限检查在前。如果加一条之后既满足了下限又超过了上限，
// 会按"超上限"处理（break），但那条已经加进来了。
//
// 所以实际保留量可能是 `maxTokens + 一条消息的大小`。
// 这是一个已知的"越界"，但比"因为要精确控制而少留一条"更好——
// 少留一条可能导致保留段不完整。'''),

(395, 'before', '''// 扩展完了，**还要再过一次对齐**。
//
// 【这一步为什么不能省】
// 因为扩展是"一条一条往前加"的，它可能停在**一组同 id 消息的中间**。
//
// 举例：
//   Index N    assistant, id: X, [thinking]
//   Index N+1  assistant, id: X, [tool_use]
//   Index N+2  user, [tool_result]
//   → 循环停在 N+1（token 够了）
//   → 但 N 的 thinking 不在保留段里 → 场景二重演
//
// 所以必须再调一次 `adjustIndexToPreserveAPIInvariants`，
// 它会把 N 也拉进来。
//
// 【这也说明 353、361 行那两个早期返回为什么要调这个函数】
// 三个出口（上限命中 / 下限命中 / 扩展结束）全部要过对齐。
// 少一个就是一个 bug。'''),

(399, 'before', '''// 该不该用 session memory 压缩。
//
// 三层判断，顺序有讲究：
//   404-410  env 变量（最高优先级）
//   412-420  GrowthBook 两个开关（都要 true）
//   423-429  内部用户额外打一个埋点
//
// 【env 变量为什么优先于 GrowthBook】
// 因为 env 用于"评测 / 调试 / 紧急开关"：
//   · `ENABLE_CLAUDE_CODE_SM_COMPACT=1`  → 强制开（跑 eval 时要确定性）
//   · `DISABLE_CLAUDE_CODE_SM_COMPACT=1` → 强制关（线上出问题时一键回滚）
//
// 这两种场景都不该受远程配置影响——远程配置可能就是出问题的那个。
//
// 【两个 env 都设了怎么办】
// 先判 ENABLE，`return true`。所以 **ENABLE 赢**。
// 这是一个隐含的优先级，注释里没说，但代码顺序决定了它。'''),

(412, 'before', '''// ═══ 两个开关必须同时为 true ═══
//
//   `tengu_session_memory`  —— session memory 功能本身（后台写记忆文件）
//   `tengu_sm_compact`      —— 用 session memory 做压缩（这个文件）
//
// 为什么分成两个？
// 因为"后台维护记忆"和"用记忆替代压缩"是两件独立的事：
//   · 前者可以单独开（用户可能只是想有份笔记）
//   · 后者依赖前者（没有记忆就没得可用）
//
// 分成两个开关意味着可以灰度：先全量开 `tengu_session_memory`，
// 观察记忆文件的质量，再小流量开 `tengu_sm_compact`。
//
// 【注意这里用的是 `CACHED_MAY_BE_STALE`】
// 前面 109 行 `initSessionMemoryCompactConfig` 用的是 `BLOCKS_ON_INIT`。
// 同一个文件两种读法。
//
// 理由：这个函数在**每轮压缩检查**时都被调，绝不能阻塞。
// 而且"用不用这条路"这个判断晚半秒知道没关系——
// 最坏情况是这一轮走了传统压缩，多花一次 API 调用。
//
// 【对比 423 行那句 `process.env.USER_TYPE === 'ant'`】
// 只给内部用户打埋点。原因注释写了："to avoid noise in external logs"。
// 外部用户的日志里每天几百万条同样的 flag check 毫无价值。'''),

(437, 'before', '''// 拼出一个 CompactionResult。**零 API 调用**。
//
// 六个输入，都是现成的：
//   messages            —— 用来算压缩前 token、提已加载工具
//   sessionMemory       —— 后台写好的记忆文本
//   messagesToKeep      —— 刚算出来的保留段
//   hookResults         —— SessionStart hook 的输出
//   transcriptPath      —— 指针（写进摘要文案）
//   agentId             —— 用于 plan 附件
//
// 【注意这里没有 images / 附件恢复的一整套】
// 对比 compact.ts 的 `compactConversation`（那里有七个 createXxxAttachment）。
//
// 这里只有 `createPlanAttachmentIfNeeded`（484 行）一个。
//
// 为什么？
//   · **文件内容不用恢复** —— 因为保留段里的 Read 结果还在
//     （保留段是最近的消息，通常包含最近读的文件）
//   · **技能不用恢复** —— session memory 里会提到用过的技能
//   · **agent 列表不用恢复** —— 同上
//
// 也就是说：**这个路径的"信息损失"本来就比全量压缩小**，
// 因为保留了真实的最近消息，而不是把它们也摘要掉。
//
// 这是它除了"省一次 API 调用"之外的第二个优势。'''),

(445, 'before', '''// ═══ 这一次终于可以用真实值了 ═══
//
// `tokenCountFromLastAPIResponse(messages)` —— 从**上一次 API 响应**
// 的 usage 里拿真实 token 数。
//
// 对比 compact.ts 的 401 行用 `tokenCountWithEstimation`（本地估算）。
// 为什么那边只能估算？因为压缩开始时还没有响应可查（它是主动发起的）。
//
// 而这里是在"收到用户消息、准备压缩"的时刻调用的，
// 上一次 API 调用的响应就在手边。
//
// 【真实值 vs 估算值的差距】
// 估算用 4 字符/token，真实值由 API 给出。在代码密集的会话里
// 可能差 30-50%。
//
// 这个数字只用于埋点和显示（`preCompactTokenCount`），
// 不参与决策——所以差别不影响行为，只影响数据质量。'''),

(452, 'before', '''// 又是 `preCompactDiscoveredTools`。和 compact.ts 的 603 行是同一件事。
//
// 把"已经加载过 schema 的延迟工具"记到 boundary 上，
// 因为 session memory 也不会保留 `tool_reference` 块。
//
// 【注意这里的 messages 是全部消息，不是 messagesToKeep】
// 因为被摘要掉的那部分里的工具也需要记住——它们"曾经被加载过"
// 这个事实不该因为摘要而丢失。
//
// 这个取舍在 compact.ts 的 1021 行也讨论过："set union is idempotent"。
// 扫全部然后取并集，永远是对的。'''),

(459, 'before', '''// 截断过大的 section。
//
// session memory 文件是后台 agent 自由写的，**长度不受控**。
// 如果某次它写了 50KB（比如把整个文件列表抄进去了），
// 直接当摘要会让压缩后的上下文反而变大。
//
// `truncateSessionMemoryForCompact` 在 SessionMemory/prompts.ts 里，
// 按 section 截断（不是粗暴砍字符）——保证每个 section 都保留开头。
//
// 【又是一个"截断胜过丢弃"】
// compact.ts 的技能附件（1512 行）、这里、还有 1666 行的 `truncateToTokens`，
// 三处都是同一个思路：**保头弃尾**。
//
// 因为这类文本的价值分布都是头重脚轻：开头是"这是什么、怎么用"，
// 后面是细节和例子。'''),

(471, 'before', '''// ═══ 被截断了要告诉模型去哪找全文 ═══
//
// 追加的那句话：
//   "Some session memory sections were truncated for length.
//    The full session memory can be viewed at: <路径>"
//
// 两个信息：
//   1. **被截断了**（别以为这就是全部）
//   2. **完整版在哪**（要细节自己去读）
//
// 【和 compact.ts 1670 行那个截断标记对比】
// 那边的标记是：
//   "... skill content truncated for compaction; use Read on the skill path"
//
// 结构完全一样：**[说明被截断] + [给出补救路径]**。
//
// 这是截断标记的通用模板。缺任何一半都会造成问题：
//   · 只说截断 → 模型知道不全，但不知道去哪补，只能重新搜
//   · 只给路径 → 模型不知道已经不全了，以为读到的是全部
//
// 【注意这里是 `+=` 追加在 summaryContent 末尾】
// 不是在记忆文本里插标记。因为 `getCompactUserSummaryMessage`
// 会包一层"这是摘要"的外壳（见 prompt.ts），标记要在外壳里面。
//
// `getSessionMemoryPath()` 是**文件系统路径**，模型可以用 Read 工具读。
// 这是"摘要 + 指针"模式的又一次应用。'''),

(487, 'before', '''// ═══ anchor 用的是"最后一条 summary 消息" ═══
//
//   `annotateBoundaryWithPreservedSegment(boundaryMarker,
//     summaryMessages[summaryMessages.length - 1]!.uuid,
//     messagesToKeep)`
//
// 回忆 compact.ts 340 行那段注释：`anchorUuid` 是
// "保留段前面应该接谁"。这里的情况是：
//
//   边界 → 摘要 → 保留段
//
// 所以保留段接在**摘要**后面。这是 "suffix-preserving" 类型
// （doc 注释里列的两种之一）。
//
// 对比 partialCompact 的 'from' 方向：那边是
//   边界 → 保留段 → 摘要
// 所以 anchor 是 boundary 自己。
//
// 【`summaryMessages.length - 1` 而不是 `[0]`】
// 因为理论上可能有多个 summary 消息（虽然这里只造了一个）。
// 取最后一个，保证接在"紧邻保留段"的那个后面。'''),

(498, 'before', '''// ═══ 两个 tokenCount 在这里收敛了 ═══
//
//   "SM-compact has no compact-API-call, so postCompactTokenCount (kept for
//    event continuity) and truePostCompactTokenCount converge to the same value."
//
// 这句话把 compact.ts 299 行那个命名陷阱彻底解开了。
//
// 在传统压缩里：
//   `postCompactTokenCount`     = 压缩那次 API 调用的 usage（大，等于压缩前）
//   `truePostCompactTokenCount` = 压缩后上下文的大小（小）
//   两者差一个数量级
//
// 在 session memory 压缩里：
//   **没有那次 API 调用** → 没有"调用 usage"这个东西
//   → 只能都填"压缩后上下文的大小" → 两者相等
//
// 【这解释了为什么这个字段叫 `postCompactTokenCount` 却装别的东西】
// 它是为了"两条路径往同一个埋点事件里写同样的字段"。
// 传统路径填 usage，SM 路径填实际大小。
//
// 结果就是：**同一个埋点字段，在不同的 `isAutoCompact` + 路径组合下
// 语义不同**。做数据分析时必须先按路径分组，否则数字完全没有意义。
//
// 【这是"埋点字段复用"的典型代价】
// 好处：查询语句不用改（不用 if 分支选字段）
// 坏处：字段含义取决于上下文，必须读代码才知道
//
// 502 行那个 `estimateMessageTokens(summaryMessages)` 只算了摘要消息，
// 没算 boundary 和 attachments。所以这个"真实值"其实也偏小。
// 但 602 行会用 `buildPostCompactMessages` 算一次完整的覆盖掉——
// 所以这里的值只是"初始占位"。'''),

(505, 'before', '''// ═══ 两种场景，doc 注释列得很清楚 ═══
//
//   "1. Normal case: lastSummarizedMessageId is set, keep only messages
//       after that ID"
//     正常情况：知道上次摘要到哪了，保留之后的消息。
//
//   "2. Resumed session: lastSummarizedMessageId is not set but session
//       memory has content, keep all messages but use session memory as
//       the summary"
//     恢复的会话：`--resume` 之后，内存里的"上次摘要位置"丢了
//     （那是运行时状态，不落盘），但磁盘上的 session memory 文件还在。
//
// 【场景二的处理很聪明，也很粗暴】
// 不知道摘要到哪了 → 假设"全都摘要过了"（`lastSummarizedIndex = messages.length - 1`）
// → 然后靠 `calculateMessagesToKeepIndex` 的"向前扩展"
//   把最近该留的消息一条条加回来。
//
// 也就是说：**不靠记录，靠阈值重新算一遍**。
//
// 好处：不需要把 `lastSummarizedMessageId` 持久化。
// 坏处：如果上次摘要其实只覆盖了一半，这次会把"已经摘要过的"
//       再当成"没摘要过的"保留下来——重复，但不丢信息。
//
// 【重复 vs 丢失，这里选重复】
// 重复只是多花 token，丢失是信息没了。方向对。'''),

(526, 'before', '''// 等后台的记忆提取完成。
//
// 后台 agent 是异步的：用户说完话，它才开始写记忆。
// 如果压缩来得太快，记忆可能还停在上一轮的状态。
//
// 【"with timeout" 在 doc 注释里（527 行）】
// 说明 `waitForSessionMemoryExtraction` 内部有超时。
// 这是必须的——不能为了等一个后台任务把用户卡死。
//
// 【超时之后会发生什么】
// 拿到的是"上一次写好的记忆"（可能缺最近几轮）。
// 这会导致摘要不完整，但压缩本身能完成。
//
// 这是一个**降级可接受**的设计：宁可摘要旧一点，不可卡住。'''),

(532, 'before', '''// 没有记忆文件 → 回退到传统压缩（返回 null）。
//
// 打 `tengu_sm_compact_no_session_memory` 埋点。
//
// 【这个埋点能回答一个重要问题】
// "有多少比例的用户开了这个功能，但实际上从来没产生过记忆？"
//
// 如果这个数很高，说明后台写入那条路有问题（或者开关开了但
// 写入的条件没满足）。这是"功能看起来开了但实际没用"的典型症状。'''),

(538, 'before', '''// ═══ "文件存在但是空的" ═══
//
// 注释：
//   "Session memory exists but matches the template (no actual content extracted)"
//   "Fall back to legacy compact behavior"
//
// 后台 agent 写文件时会**先写模板**（各个 section 的标题），
// 然后逐步填充。如果它还没来得及填（或者这一轮没东西可写），
// 文件里就只有模板骨架。
//
// `isSessionMemoryEmpty` 判断的就是"内容是否等于模板"。
//
// 【为什么单独处理这个情况】
// 如果拿模板当摘要，模型看到的会是：
//   "## 用户目标\n\n（待填）\n\n## 当前进度\n\n（待填）..."
//
// 这比没有摘要更糟——它会以为"之前什么都没发生过"，
// 而实际上有完整的历史（只是没进摘要）。
//
// 【这个检查是"内容质量"检查，不是"存在性"检查】
// 前面的 `!sessionMemory` 判存在，这里判有效性。
// 两层都要有：文件不存在和文件是空壳，处理方式相同（回退），
// 但要分开打埋点才能知道是哪种情况。'''),

(548, 'before', '''// 正常场景：按 id 找上次摘要的位置。
//
// `messages.findIndex(msg => msg.uuid === lastSummarizedMessageId)`
//
// 【这里有一个隐含约束：id 必须还在 messages 里】
// 如果那条消息已经被别的机制删掉了（比如 snip 剪枝、或者
// 上一次压缩把它吃掉了），`findIndex` 返回 -1。
//
// 【554-560 行的处理是"直接放弃"】
//   "This can happen if messages were modified - fall back to legacy compact
//    since we can't determine the boundary between summarized and unsummarized
//    messages"
//
// 为什么放弃而不是"猜一个位置"？
// 因为猜错的方向可能是**丢掉没摘要过的消息**——那是信息净损失。
// 而放弃只是多花一次 API 调用。方向明确。'''),

(561, 'before', '''// 恢复会话的场景：不知道边界，假设"全都摘要过"。
//
// `lastSummarizedIndex = messages.length - 1`
// → 传给 `calculateMessagesToKeepIndex` 时 `startIndex = messages.length`
// → 保留段初始为空 → 靠向前扩展补回来。
//
// 【这个"假设全摘要过"是有风险的，但被两个机制兜住了】
//
//   1. `calculateMessagesToKeepIndex` 的两个下限（10K token / 5 条文本）
//      会强制往前扩展，保证保留段有足够内容
//   2. 40K 上限防止扩展太多
//
// 所以最终保留的是"最近 10K~40K token"，不管实际摘要覆盖了哪里。
//
// 【最坏情况是什么】
// 假设 session memory 只覆盖了前 10% 的历史，剩下 90% 没摘要过。
// 但这次压缩只保留最近 40K token，中间的 50% 就**彻底丢了**。
//
// 也就是说：**恢复会话时用这条路，可能会丢一段历史**。
//
// 这是它被标成 EXPERIMENT 的原因之一。生产环境默认关着。'''),

(575, 'before', '''// ═══ 过滤掉旧的 compact boundary，理由很绕但很真实 ═══
//
//   "After REPL pruning, old boundaries re-yielded from messagesToKeep would
//    trigger an unwanted second prune (isCompactBoundaryMessage returns true),
//    discarding the new boundary and summary."
//
// 还原这条链：
//
//   1. 压缩产生新结果：新 boundary + 新摘要 + messagesToKeep
//   2. `messagesToKeep` 里可能藏着一个**旧的** boundary（如果切点跨过了它）
//   3. 这个数组交给 REPL 的修剪逻辑（pruning）
//   4. 修剪逻辑扫到旧 boundary，认为"从这里开始要修剪"
//   5. → **把新 boundary 和新摘要一起剪掉**
//
// 结果：压缩"成功了"，但结果被自己的修剪逻辑吃掉。
//
// 【为什么 `calculateMessagesToKeepIndex` 的 floor 没挡住】
// 因为 floor 只限制"向前扩展不跨过最后一个 boundary"。
// 但如果**起点本来就在 boundary 之后**，而 boundary 又在
// `lastSummarizedIndex` 之前……不对，那不会跨过。
//
// 实际上这段注释说的是另一种情况：`messagesToKeep` 是
// `messages.slice(startIndex)`，如果 startIndex 恰好落在
// 一个 boundary 之后，但后面还有**另一个** boundary（多次压缩过），
// 那个就会被带进来。
//
// 【这是一个"下游有扫描逻辑"导致的约束】
// 和 compact.ts 785 行那段（up_to 方向必须剥旧 boundary）是同一个
// 根源：`isCompactBoundaryMessage` 是一个会被下游到处查的谓词，
// 任何往消息数组里混入旧 boundary 的操作都会引发连锁反应。'''),

(583, 'before', '''// 跑 SessionStart hook。
//
// 注释："Run session start hooks to restore CLAUDE.md and other context"
//
// 【这一句点出了 hook 的实际作用】
// SessionStart hook 做的事情之一是**重新注入 CLAUDE.md**
// （项目约定文件）。因为压缩后 `loadedNestedMemoryPaths` 会被清空
// （compact.ts 522 行），模型"忘记"了项目约定。
//
// 所以压缩必须触发一次"会话启动"，让 CLAUDE.md 回来。
//
// 【注意这里没有调 `notifyCompaction`】
// 这就是第 6 步读 autoCompact.ts 时发现的那个 bug：
// session memory 压缩漏了通知缓存检测器，
// 导致约 20% 的 `tengu_prompt_cache_break` 是误报
// （BQ 2026-03-01 定位）。
//
// 【一个值得对照的清单】
// compact.ts 的压缩流程有：
//   · `notifyCompaction()`（697 行）
//   · `markPostCompaction()`（704 行）
//   · `reAppendSessionMetadata()`（711 行）
//   · `clearCompactWarningSuppression` / `suppressCompactWarning`
//
// 这个文件里**一个都没有**。
//
// 两套实现做同一件事，但副作用清单不同步——这是最典型的
// "复制-粘贴-修改"造成的漂移。修复方式应该是抽一个
// `afterCompaction()` 统一做这些事。'''),

(604, 'before', '''// ═══ 压缩后还是超阈值 → 放弃，返回 null ═══
//
//   "Only check threshold if one was provided (for autocompact)"
//
// 参数可选，因为只有"自动压缩"这条调用路径会传阈值。
// 用户手动 `/compact` 不传（手动触发时不管结果多大都要压）。
//
// 【为什么超阈值要放弃】
// 因为压缩的目的是"把上下文降到阈值以下"。如果压缩完了还超，
// 那就**白压了一场**——白等了几百毫秒，结果下一轮还得再压一次。
//
// 与其这样，不如返回 null 让调用方走传统压缩（那个压缩更彻底）。
//
// 【这是一个"质量门禁"】
// 它防的是：session memory 太长（或者保留段太大）导致压缩无效。
//
// 【注意它用的是 `postCompactTokenCount`（602 行算出的完整值）】
// 不是 500 行那个只算摘要的估算。602 行 `buildPostCompactMessages`
// 把 boundary + summary + keep + attachments + hookResults 全拼起来
// 再算一次，那个数才是"下一轮真正要发的大小"。
//
// 顺序很清楚：先拼完整结果 → 算真实大小 → 判阈值 → 通过才返回。'''),

(621, 'before', '''// ═══ catch 里用 `logEvent` 而不是 `logError`，理由写得很明确 ═══
//
//   "Use logEvent instead of logError since errors here are expected
//    (e.g., file not found, path issues) and shouldn't go to error logs"
//
// 翻译：这里的错误是**预期内**的（文件不存在、路径问题），
// 不该污染错误日志。
//
// 【这是一个重要的可观测性实践】
// 错误日志的价值在于"打开它就能看到真问题"。如果里面混了
// 一堆"预期内的失败"，就没人看了。
//
// 判断标准：**这个错误是否意味着"系统坏了"？**
//   · 是 → logError（要人来看）
//   · 否，是正常的分支 → logEvent（给数据分析用）
//
// 【注意 625 行的 `process.env.USER_TYPE === 'ant'`】
// 只有内部用户才打详细的调试日志（`errorMessage(error)` 带具体原因）。
// 外部用户只记一个 `tengu_sm_compact_error` 事件，不带错误文本。
//
// 为什么？因为错误文本可能包含**文件路径**（用户目录名、项目名），
// 而埋点数据会上报到服务端。这是一个隐私考虑。
//
// 【628 行 `return null` 而不是 rethrow】
// 因为这个函数的契约是"能用就用，不能用返回 null 让调用方回退"。
// 抛异常会打断整个压缩流程，而回退到传统压缩是完全可接受的。
//
// **"实验性路径失败不该影响主流程"**——这是它能让用户开着的原因。'''),
]
