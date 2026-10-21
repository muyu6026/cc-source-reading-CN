# -*- coding: utf-8 -*-
"""microCompact.ts 批注：三条微压缩路径、缓存编辑、时间触发。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 5/N —— 微压缩（src/services/compact/microCompact.ts）
//
// 这是五层压缩管线的第三层。前两层是 `snip`（剪枝）和工具结果预算，
// 后两层是 context-collapse 和 autocompact。
//
// 【微压缩和另外四层的根本区别】
//
// 它**不调模型**。它做的事是：把旧的工具结果内容换成一句占位文本。
//
//   之前：  tool_result 内容 = 12,000 字符的 ls 输出
//   之后：  tool_result 内容 = "[Old tool result content cleared]"
//
// 一条都不删，一个 block 都不动，只是把"内容"换成"墓碑"。
// 这样模型仍然知道"我跑过 ls"，但不用为那 12,000 字符付 token。
//
// 【为什么只清理工具结果，不清理对话文本】
//
// 因为工具结果**信息密度最低、体积最大**。一次 `grep -r` 可能返回
// 三万字，而模型真正用到的可能只有三行。而用户的提问、模型的回答
// 每一句都是"为什么要做这件事"的推理链——删掉就断片了。
//
// 这个取舍在 41 行的 `COMPACTABLE_TOOLS` 里体现得很直接：只有
// Read / Shell / Grep / Glob / WebSearch / WebFetch / Edit / Write
// 这八类（其实是七个工具名 + 一组 shell）会被清理。
//
// 【三条路径，读之前先分清】
//
//   ① cachedMicrocompactPath（305 行）—— **不动本地消息**
//      通过 API 的 cache_edits 让服务端"逻辑删除"。
//      前提：缓存是热的。这样既清了内容，又保住了缓存前缀。
//
//   ② maybeTimeBasedMicrocompact（446 行）—— **直接改本地消息**
//      场景：距上次对话超过阈值（默认几十分钟），缓存早凉了。
//      既然缓存无论如何都要重建，不如先把内容清掉，让重建的东西更小。
//
//   ③ 什么都不做（292 行 `return { messages }`）
//      外部构建 / 不支持的模型 / 子 agent 的情况。交给 autocompact 处理。
//
// **核心的判据只有一条：缓存热不热。**
//   热 → 用 cache_edits（①），保住前缀
//   冷 → 直接改内容（②），反正要重建
// ═══════════════════════════════════════════════════════════════'''),

(32, 'before', '''// ═══ 一行注释交代了一次循环依赖的排查 ═══
//
//   "Inline from utils/toolResultStorage.ts — importing that file pulls in
//    sessionStorage → utils/messages → services/api/errors, completing a
//    circular-deps loop back through this file via promptCacheBreakDetection."
//
// 完整还原那条环：
//
//   microCompact.ts
//     → utils/toolResultStorage.ts
//       → sessionStorage
//         → utils/messages
//           → services/api/errors
//             → ... → promptCacheBreakDetection
//               → **回到 microCompact.ts**
//
// 环的后果在 ESM 里不是崩溃，而是**某些导入会是 undefined**——
// 因为模块图是按需求值的，环上某一个位置拿到的是"还没初始化完"的绑定。
// 这种 bug 表现为"运行到某一行突然 undefined is not a function"，
// 而且取决于执行顺序，极难复现。
//
// 解法：把需要的**一个字符串常量**复制过来，不导入那个文件。
//
// 【但复制常量会漂移】
// 注释第二句："Drift is caught by a test asserting equality with the
// source-of-truth."
//
// 也就是说有一行测试：`expect(TIME_BASED_MC_CLEARED_MESSAGE).toBe(
// 原来源里的那个常量)`。复制可以，但必须有测试盯着两边一致。
//
// 【这是处理循环依赖的一种成熟做法】
//   · 不为了"优雅"硬拆模块（那会牵动几十个文件）
//   · 复制最小必要的东西（一个字符串）
//   · 用测试锁住复制品和原件的一致性
//
// 比起"加一个 shared/constants 层把常量提上去"（那也是一条路，
// 但会引入新的依赖方向），这个做法改动的面积最小。'''),

(36, 'before', '''// 清空工具结果时写入的占位文本。
//
// 注意措辞：`[Old tool result content cleared]`
//
// 为什么不是空字符串？因为空的 tool_result 可能让 API 报错
// （某些版本要求 content 非空）。也不只是 `[cleared]`——
// 要明确告诉模型"这里**曾经有**内容，被压缩清掉了"。
//
// 【这个区别很关键】
//   `""`                          → 模型以为工具什么都没返回
//   "[Old tool result content cleared]" → 模型知道"内容有过，但没了"
//
// 后者模型会做出正确反应：需要的话重新跑一次工具。
// 前者模型会得出错误结论："这个文件是空的"。
//
// 这批注在 compact.ts 里讲过同一个道理（`[image]` 占位符），
// 是全代码库通用的原则：**清空要留墓碑，不能留空白**。'''),

(38, 'before', '''// 图片按 2,000 token 粗估，不管实际尺寸。
//
// 为什么可以这么粗暴？因为图片的 token 计算依赖分辨率，
// 而客户端**拿不到**精确的分辨率信息（要解码图片才知道）。
// 2,000 是一张 1000×1000 左右的典型值。
//
// 【误差的影响】
// 低估 → 实际比估算的大，压缩后仍然可能超限
// 高估 → 提前清掉一些本可以留的工具结果，损失一点信息
//
// 这里选的是"偏高"（2,000 大概是常见截图的上限），因为
// **低估的后果更严重**：估算说还有 30K 余量，实际发过去直接 PTL。
//
// 注释里 `calculateToolResultTokens`（151 行）和
// `estimateMessageTokens`（181 行）两处都用了这个常量，
// 保证"算某条结果的大小"和"算整段消息的大小"用同一个尺度。'''),

(40, 'before', '''// ═══ 只有这八类工具的结果会被清理 ═══
//
//   Read     —— 文件全文，通常几千到几十 K
//   Shell    —— 命令输出，最不可控（一次 `find /` 可能几万行）
//   Grep     —— 搜索结果，同上
//   Glob     —— 文件列表
//   WebSearch / WebFetch —— 网页内容，几乎总是很占地方
//   Edit / Write —— 编辑结果（通常是 diff 或确认信息，一般不大）
//
// 【注意这里是"白名单"不是"黑名单"】
// 用 `Set` + `has()` 判断，不在集合里的一律不动。
//
// 为什么必须白名单？因为 MCP 工具是**用户/第三方提供的**，
// 行为完全不可预测。某个 MCP 工具返回的内容可能是"必须在下一轮
// 完整看到"的结构化数据（比如数据库 schema、API 签名）。
// 一旦被清成墓碑，模型就再也拿不到它，除非重新调用——
// 而有些 MCP 调用是有副作用或很慢的。
//
// 同理，`Task`（子 agent）的结果、`TodoWrite` 的待办列表
// 都不在名单里。后者的内容本身就是"当前状态"，清掉等于失忆。
//
// 【Edit / Write 为什么也在名单里】
// 它们的返回通常很短（"已更新 xxx 文件"），清掉省不了多少。
// 但放在名单里的意义是"允许清"——在某些模型/配置下
// 编辑结果可能带完整 diff，那就值得清了。'''),

(52, 'before', '''// ═══ 缓存编辑用的模块级状态（内部构建专有）═══
//
// 三个变量，全是 `let`，全是模块级：
//
//   `cachedMCModule`  惰性加载的模块对象（null 表示还没加载）
//   `cachedMCState`   跨轮次存活的状态（记录了哪些工具结果"已登记"）
//   `pendingCacheEdits`  待塞进**下一次**请求的编辑指令
//
// 【为什么用 `let` + 惰性 import 而不是顶部 import】
// 因为 `cachedMicrocompact.ts` 在外部构建里不存在。
// 顶部 import 会让整个模块在外部构建时就崩——打包器找不到文件。
//
// 用 `await import()` 动态导入，配合 `feature()` 分支，
// 打包器能把这条路径整段删掉。
//
// 【注意 56-60 行的类型写法】
//   `typeof import('./cachedMicrocompact.js')`
//   `import('./cachedMicrocompact.js').CachedMCState`
//
// 这是**类型层面的 import**，不产生运行时代码，所以安全。
// 它让这三个变量在类型检查上有正确的类型，同时在运行时
// 外部构建里就是 `null`。
//
// 这是 TypeScript 里调用"可能不存在"的模块的标准姿势：
// **运行时用动态 import，类型上用 `import()` 类型表达式**。'''),

(62, 'before', '''// 惰性加载，只加载一次。
//
// `if (!cachedMCModule)` 之后再赋值，是标准的单次初始化。
//
// 【为什么不在模块顶层 `await import()`】
// 因为顶层 await 会让整个模块变成异步的，所有导入它的地方
// 都得处理 Promise。代价太大。
//
// 【这里有一个理论上的竞态】
// 如果两个并发调用同时进 `getCachedMCModule()`，会 import 两次。
// 但 ESM 的模块系统会缓存——第二次 import 拿到的是同一个模块对象，
// 只是多了一次 await。而且 `cachedMCModule = await ...`
// 两次赋值结果是同一个对象。
//
// 所以不需要加锁。这是 ESM 模块缓存带来的免费便利。'''),

(83, 'before', '''// ═══ "取出并清空"（consume）的语义 ═══
//
// 注释："Clears the pending state (caller must pin them after insertion)."
//
// 也就是说调用方拿走后有责任"把它们钉住"（调 111 行的 `pinCacheEdits`）。
//
// 【为什么必须钉住？这是理解整个机制的关键】
//
// cache_edits 的作用是"告诉服务端：请把缓存里第 N 条消息的某个
// 工具结果删掉"。这是一条**指令**，不是对本地数据的修改。
//
// 问题：服务端的缓存是**按前缀累积**的。这一次请求带了
// "删除 tool_A" 的指令，缓存因此变成了"没有 tool_A 的版本"。
// 但如果下一次请求**不带**这条指令，服务端会按"原始内容"重建——
// 于是 tool_A 又回来了，缓存也跟之前对不上了。
//
// 所以每条编辑指令必须**在之后的每一次请求里重复发送**，
// 位置固定在当初那一条消息上。这就是 "pinned"（钉住）。
//
// 【两个概念的区分】
//   `pendingCacheEdits`  只发一次（新增的编辑）
//   `pinnedEdits`        每次都发（历史上所有编辑）
//
// 如果忘了 pin，效果是"这一轮省了 token，下一轮全回来，
// 而且缓存还多断了一次"——比不做还糟。'''),

(96, 'before', '''// 取所有"钉住"的编辑，每次请求都要重发。
//
// `if (!cachedMCState) return []` —— 状态没初始化就返回空数组，
// 不抛错。因为这是"读取已有状态"，没有状态就是没有编辑，语义正确。
//
// 对比 71 行的 `ensureCachedMCState()`：那个是"要用状态"，
// 没有就抛。两个函数对"状态不存在"的处理不同，是因为场景不同：
//   · 读（这里）→ 空数组是合理答案
//   · 写（ensure）→ 抛错，因为继续写会 NPE'''),

(107, 'before', '''// 把新的编辑钉在**某条用户消息的索引位置**上。
//
// 关键参数是 `userMessageIndex` —— 位置而不是内容。
// 因为服务端要靠"第几条消息"来定位缓存里的对应片段。
//
// 【这里有一个脆弱点值得注意】
// 如果本地消息数组的索引发生变化（比如前面插了一条消息），
// 钉住的索引就错位了，编辑会作用到错误的消息上。
//
// 所以这个机制只在"缓存路径"（cachedMicrocompactPath）里用，
// 而那条路径**不修改本地消息**（369 行有注释强调）。
// 不修改 → 索引稳定 → 钉住有效。
//
// 两条路径的"改不改本地消息"这个差别，不只是省不省事的问题，
// 而是**能不能用索引定位**的前提。'''),

(137, 'before', '''// 算一条 tool_result 占多少 token。
//
// 三种情况：
//   · content 不存在 → 0
//   · content 是字符串 → 直接估算
//   · content 是数组 → 逐块累加（文本按长度，图片/文档按 2,000）
//
// 【`!block.content` 这个判断有个坑】
// `!''` 也是 true，所以空字符串会返回 0。这是对的。
// 但 `!0`、`!false` 也都是 true——虽然 content 不可能是这些类型，
// 但这个写法在 TS 里能通过（因为 content 类型是 `string | Block[] | undefined`）。
//
// 【为什么这个函数不是导出的】
// 它只在 `estimateMessageTokens`（180 行）里用一次。
// 不导出 = 外部不能依赖 = 以后想改实现不用管兼容。'''),

(159, 'before', '''// ═══ 估算整段消息的 token，末尾乘 4/3 ═══
//
// 这个函数是微压缩里所有"够不够"判断的基础。
//
// 【逐块处理的规则，每一条都有理由】
//
//   text            → 按文本长度估算
//   tool_result     → 走上面的 `calculateToolResultTokens`
//   image/document  → 固定 2,000
//   thinking        → **只算 thinking 文本，不算 signature**
//   redacted_thinking → 算 data
//   tool_use        → **只算 name + input，不算 JSON 包装和 id**
//   其他            → 整个 JSON 序列化后估算
//
// 【打星号的两条最值得看，注释里写着 "Match roughTokenCountEstimationForBlock"】
//
// 也就是说这两条是**刻意和另一个函数保持一致**的。
// 为什么要一致？因为同一个会话里，token 数会从多个来源算出：
//   · `estimateMessageTokens`（这里，微压缩用）
//   · `roughTokenCountEstimationForBlock`（另一个模块）
//   · `tokenCountFromLastAPIResponse`（API 返回的精确值）
//
// 如果两套算法不一致，会出现"微压缩认为还有余量，autocompact
// 认为已经超了"的诡异现象——同一条消息两个大小。
//
// 所以注释里那句 "Match ..." 是**契约声明**，不是描述。
//
// 【为什么 thinking 的 signature 不算】
// signature 是加密的验证数据，几千字符，但**不参与模型推理**。
// 把它算进上下文大小会严重高估（一条 thinking 可能 500 token 正文
// + 8,000 字符 signature）。'''),

(203, 'before', '''// ═══ 末尾乘 4/3，这个 33% 的余量是干什么的 ═══
//
// 注释："Pad estimate by 4/3 to be conservative since we're approximating."
//
// `roughTokenCountEstimation` 用的是"约 4 字符/token"。
// 这个比例对英文散文大致成立，但对代码、中文、JSON 会偏低估：
//   · 代码：符号多，实际 token 更多（一个 `=>` 可能是 2-3 token）
//   · 中文：一个汉字≈1 token，但只占 1 个"字符"（如果按 UTF-16 算是 1）
//   · JSON：大量引号冒号括号，每个都可能单独成 token
//
// 所以 4/3 是给这些情况留的安全垫。
//
// 【方向选择：宁可高估】
// 高估 → 提前触发微压缩 → 多清一点工具结果（信息损失可控）
// 低估 → 以为还有余量 → 发过去 PTL → 走逃生舱（体验很差）
//
// 所有"估算 + 决策"的场景都该这样选方向：**朝着"更保守"的一侧偏**。
//
// 【`Math.ceil` 而不是 `Math.floor`】
// 同样是保守方向。`ceil(0.1) = 1` 而不是 0——
// 避免"有一点点内容却算成 0 token"导致无限循环。'''),

(207, 'before', '''// 待处理的缓存编辑，以及一个容易搞错的字段。
//
// `baselineCacheDeletedTokens` 的注释：
//   "Baseline cumulative cache_deleted_input_tokens from the previous API
//    response, used to compute the per-operation delta (the API value is
//    sticky/cumulative)"
//
// 翻译：API 返回的 `cache_deleted_input_tokens` 是**累计值**（sticky），
// 不是"这次删了多少"。所以要先记下上一次的累计值当基线，
// 这次拿到的减去基线，才是"本次操作省了多少"。
//
// 【这是一个非常容易出错的地方】
// 直觉上会以为"这次响应里的 cache_deleted_input_tokens 就是这次删的"。
// 实际是"从会话开始到现在一共删了多少"。
//
// 如果不减基线，埋点里的"每次微压缩省了多少 token"会随会话推进
// 越来越大——因为它一直是累计值。而真实情况是每次差不多。
//
// 【和 claude.ts 的 updateUsage 是同一个坑】
// 第 5 步读 claude.ts 时看到过："`updateUsage` 是覆盖不是累加"
// ——因为 API 给的是累计值。这里是同一个事实的另一处应用：
// 累计值 → 要么覆盖（记当前状态），要么减基线（算增量）。
//
// 用错方向是这类 bug 的典型形态，而且埋点错了不会有人发现，
// 只有做数据分析时才会觉得"这个数字不对劲"。'''),

(222, 'before', '''// 扫一遍消息，收集"可清理的工具调用 id"，按出现顺序。
//
// 只扫 **assistant** 消息里的 `tool_use` 块（工具的调用），
// 不扫 user 消息里的 `tool_result`（工具的返回）。
//
// 因为要删的是 result，但要靠 use 的 id 来定位。
// 两遍扫描（这里收 use 的 id，305 行那边收 result 并登记）是刻意的分工。
//
// 【"按出现顺序"这个细节很重要】
// `ids.push(block.id)` 保证数组顺序 = 时间顺序。
// 后面 462 行 `slice(-keepRecent)` 依赖这个顺序取"最近的 N 个"。
// 如果顺序乱了，"保留最近"就变成"保留随机的 N 个"。'''),

(243, 'before', '''// ═══ 六行注释，记录了一个静默失效的 bug ═══
//
//   "Prefix-match because promptCategory.ts sets the querySource to
//    'repl_main_thread:outputStyle:<style>' when a non-default output style
//    is active. The bare 'repl_main_thread' is only used for the default style."
//
// 事实：`querySource` 不是固定字符串，而是**带后缀的**。
//   · 默认 output style → `'repl_main_thread'`
//   · 自定义 output style → `'repl_main_thread:outputStyle:custom'`
//
//   "query.ts:350/1451 use the same startsWith pattern; the pre-existing
//    cached-MC `=== 'repl_main_thread'` check was a latent bug — users with
//    a non-default output style were silently excluded from cached MC."
//
// 翻译：原来这里写的是 `=== 'repl_main_thread'`。
// 结果是——**所有用了非默认 output style 的用户，缓存微压缩从来没生效过**。
//
// 【为什么这个 bug 特别难发现】
//   1. 没有任何报错
//   2. 功能"降级"而非"失效"——还有 autocompact 兜底，用户只觉得
//      "上下文怎么这么快就满了"
//   3. 只有一部分用户受影响（改了 output style 的那些）
//   4. 埋点里 `tengu_cached_microcompact` 事件数量下降，
//      但没人知道"应该"是多少
//
// 【教训很明确】
// 用字符串当枚举时，**永远不要假设它是精确值**。
// 这类"带后缀的枚举"在代码库里到处都是（`'repl_main_thread:outputStyle:x'`、
// `'subagent:xxx'`），判断时必须用 `startsWith`。
//
// 但反过来也有风险：`startsWith('repl_main_thread')` 也会匹配
// `'repl_main_thread_but_actually_a_subagent'`（如果以后有这种值）。
// 所以注释里明确指了 `query.ts:350/1451` 也这么写——
// **三处一致**才说明这是团队约定的模式，不是随手写的。'''),

(253, 'before', '''// ═══════════════════════════════════════════════════════════════
// 微压缩主入口（40 行，253-293）
//
// 它只做三件事，顺序不能换：
//
//   259  清掉上次的"警告抑制"标志
//   267  试时间触发（成功就**直接返回**，不再往下走）
//   276  试缓存路径（条件满足就走）
//   292  都不满足 → 原样返回，交给 autocompact
//
// 【"时间触发优先并短路"这个设计值得展开】
//
// 为什么时间触发要排在最前面，而且一触发就 `return`？
// 因为两者的**前提互斥**：
//   · 时间触发的前提是"缓存已经凉了"
//   · 缓存编辑的前提是"缓存是热的"
//
// 既然时间触发已经确认缓存凉了，缓存编辑就没有意义了
// （267-270 行注释："Cached MC (cache-editing) is skipped when this fires:
// editing assumes a warm cache, and we just established it's cold."）。
//
// 用一个 `return` 表达这个互斥，比在里面写一堆 `if (!cacheWarm)`
// 清晰得多。**"先判互斥条件，命中就早退"** 是一种很好的组织方式。
// ═══════════════════════════════════════════════════════════════'''),

(267, 'before', '''// 时间触发的完整理由（267-270 行注释）：
//
//   "If the gap since the last assistant message exceeds the threshold,
//    the server cache has expired and the full prefix will be rewritten
//    regardless — so content-clear old tool results now, before the request,
//    to shrink what gets rewritten."
//
// 逻辑链：
//   1. 距上次对话太久（默认几十分钟）
//   2. → 服务端缓存已过期（Anthropic 的缓存 TTL 是分钟级）
//   3. → 这次请求必然要把整个前缀重新写一遍（cache_creation，全价）
//   4. → 既然横竖要重写，**不如先把内容清掉**
//   5. → 这样"重写的东西"更小，cache_creation 更少
//
// 【这是一个"利用坏消息"的优化】
// 缓存凉了本来是坏事。但"必输"的局面下，反而可以做一些
// 在热缓存时不能做的事（改动内容）。
//
// 类比：如果反正要重印整本书，那就顺手把过时的章节删掉再印。
// 而如果只是加一页，那就不能动前面任何一页（否则整个重印）。'''),

(272, 'before', '''// ═══ 只让主线程走缓存路径，理由很具体 ═══
//
//   "Only run cached MC for the main thread to prevent forked agents
//    (session_memory, prompt_suggestion, etc.) from registering their
//    tool_results in the global cachedMCState, which would cause the main
//    thread to try deleting tools that don't exist in its own conversation."
//
// 翻译：`cachedMCState` 是**模块级全局变量**。分叉 agent（记忆提取、
// 提示建议等）和主线程跑在同一个进程里，共用这份状态。
//
// 如果分叉 agent 也登记自己的工具结果：
//   1. 分叉 agent 登记了 tool_X（它自己对话里的工具）
//   2. 主线程下一轮跑缓存路径，看到 state 里有 tool_X
//   3. 主线程生成 "删除 tool_X" 的 cache_edit
//   4. 但主线程的对话里**根本没有** tool_X
//   5. → 服务端收到一条指向不存在内容的删除指令
//
// 后果可能是 API 报错，也可能被静默忽略——后者更糟，
// 因为主线程以为删了，实际没删，token 统计全乱。
//
// 【这是一个"全局可变状态 + 并发执行"的经典坑】
// 根本原因是 `cachedMCState` 用模块级变量而不是按会话/按 agent 隔离。
//
// 彻底的修法是把 state 挂到 agent 上下文上。但那样要穿透
// 十几层函数签名，所以选择了"只让主线程用"这个最小改动。
//
// 【读代码时看到"只允许主线程"这类限制，要想到背后通常有共享状态】
// 限制本身是症状，共享状态才是病。'''),

(288, 'before', '''// ═══ 两行注释，交代了一条路径的死亡 ═══
//
//   "Legacy microcompact path removed — tengu_cache_plum_violet is always true."
//
// 翻译：老版本的微压缩（直接改本地消息内容）已经被删了，
// 因为它的 GrowthBook 开关 `tengu_cache_plum_violet` 现在恒为 true。
//
// 这是个很好的卫生习惯：**开关全量放开之后，把旧代码删掉，
// 但留一行注释说明"这里曾经有什么、为什么没了"**。
//
// 好处：
//   · 读代码的人不会疑惑"为什么这里直接 return"
//   · 从旧版本升上来的人知道去哪找历史（git 记录）
//   · 万一要回滚，知道该恢复什么
//
// 【注意 289-291 行的第二段注释】
//   "For contexts where cached microcompact is not available (external builds,
//    non-ant users, unsupported models, sub-agents), no compaction happens
//    here; autocompact handles context pressure instead."
//
// 也就是说：**开源版根本没有微压缩**。
// 外部构建里 `feature('CACHED_MICROCOMPACT')` 是 false，
// 这个函数永远走 292 行原样返回。
//
// 所以这个 530 行的文件，在开源版里的实际行为是"什么都不做"。
// 读的时候要清楚这一点——否则会以为微压缩是外部也有的功能。'''),

(295, 'before', '''// 缓存微压缩路径。doc 注释列了四个和"传统微压缩"的差异：
//
//   1. "Does NOT modify local message content (cache_reference and
//       cache_edits are added at API layer)"
//      ——**不动本地消息**。这是最大差别。
//
//   2. "Uses count-based trigger/keep thresholds from GrowthBook config"
//      ——按**条数**触发（比如超过 20 条结果就清），不是按 token 数。
//
//   3. "Takes precedence over regular microcompact (no disk persistence)"
//      ——优先级更高，而且不落盘。
//
//   4. "Tracks tool results and queues cache edits for the API layer"
//      ——跟踪 + 排队，实际动作在 API 层执行。
//
// 【为什么按条数而不按 token 数】
// 因为 cache_edits 是"删除指定 id"的指令，天然是**离散**的
// （要么删这条，要么不删）。而 token 数是连续的。
// 用条数做阈值，和操作的单位一致，逻辑更直接。
// 而且按 token 算还得先估算每条的大小，多做一次遍历。'''),

(313, 'before', '''// 第一遍：收集所有可清理的工具 id（`collectCompactableToolIds`）。
//
// 第二遍（315 行开始）：扫 user 消息里的 tool_result，把**还没登记过的**
// 交给 `mod.registerToolResult` 登记，同时记下这条 user 消息里
// 登记了哪些 id（`groupIds`）。
//
// 【为什么要按消息分组？】
// `mod.registerToolMessage(state, groupIds)` 记录的是
// "第几条消息里有哪些可清理的 result"。
//
// 因为 cache_edits 的定位单位是**消息索引**，不是单个 result。
// 一条 user 消息里可能有 3 个 tool_result（模型一次调了 3 个工具），
// 它们属于同一个"删除单元"吗？不一定——可能只删其中 2 个。
//
// 所以状态里要记两层：消息 → 有哪些 id；id → 各自的状态。
//
// 【`!state.registeredTools.has(...)` 这个判断很重要】
// 因为 `microcompactMessages` 是**每轮都调**的。第二轮进来时，
// 上一轮已经登记过的 id 不该重复登记——否则计数会翻倍，
// 提前触发删除。
//
// 【注意 322 行只 push 新登记的 id】
// `groupIds` 里只有"这次新登记的"，所以 `registerToolMessage`
// 拿到的是增量。如果传全量，同一个工具会被算多次。'''),

(332, 'before', '''// 问模块"现在该删哪些"。
//
// 这个决策在 `cachedMicrocompact.ts` 里（外部构建不存在），
// 大致逻辑是：可清理的 result 总数 > triggerThreshold 时，
// 删掉"最旧的 keepRecent 之外"的那些。
//
// 【阈值和保留数都来自 GrowthBook】
// 埋点里 354-355 行记了 `threshold` 和 `keepRecent`，
// 说明这两个值是**可以远程调的**，而且埋点要能反映当时的值。
//
// 这很重要：如果只记"删了 5 个"，不记"当时的阈值是 20"，
// 数据分析时没法判断"是阈值设得不对"还是"确实该删这么多"。'''),

(334, 'before', '''// 只有真的要删时才做后续动作。
//
// 335-339 行：造一个 cache_edits 块，放进 `pendingCacheEdits`
// （等着下一次请求被 `consumePendingCacheEdits` 取走）。
//
// 【注意 `if (cacheEdits)` 这个二次判断】
// `createCacheEditsBlock` 可能返回 null（比如所有工具都已经删过了）。
// 返回 null 时就不设 `pendingCacheEdits`——但**下面的埋点和日志照打**。
//
// 这意味着埋点里的 `toolsDeleted` 可能是"打算删的"而不是"实际删的"。
// 这是一个小瑕疵，但注释里没提，可能作者认为这种边缘情况
// 不值得单独处理。'''),

(369, 'before', '''// ═══ 全文件最重要的一行注释 ═══
//
//   "Return messages unchanged - cache_reference and cache_edits are added
//    at API layer"
//
// `return { messages, ... }` —— `messages` 是**原样返回**，一个字节没改。
//
// 【这是整个缓存微压缩成立的基石】
//
// prompt cache 的规则：**请求里第 N 个字节变了，从那里往后全部缓存失效**。
//
// 如果本地把 tool_result 的内容改成墓碑，那么发出去的请求内容就变了
// → 前缀变了 → 缓存全废。
//
// 那"删除"怎么实现？靠 API 的两个特殊字段：
//   · `cache_reference` —— 指向缓存里的某段内容（"我要引用那段"）
//   · `cache_edits`     —— "把那段的某个工具结果删掉"
//
// 这两个字段是在**发请求前一刻**由 API 层拼进去的（claude.ts 那边），
// 本地消息始终保持原始状态。
//
// 于是：请求的**消息部分**字节完全没变（缓存命中），
// 只是多了几条"编辑指令"（模型看不到原文，因为服务端删了）。
//
// 【这就是"协议改写 vs 内容改写"的区别】
//   改内容 → 缓存失效，但简单
//   改协议 → 缓存保住，但复杂（要维护 pinned 状态、处理索引对齐）
//
// 微压缩两条路径正好各选了一种。这条选了复杂的那个，
// 因为它要服务的场景（热缓存）恰恰是"缓存值钱"的时候。'''),

(374, 'before', '''// 记下"删除前的累计值"，作为算增量的基线。
//
// 三层括号读起来很晕：
//   `((lastAsst.message.usage as unknown as Record<string, number|undefined>)
//      ?.cache_deleted_input_tokens ?? 0)`
//
// 为什么要 `as unknown as Record<...>`？
// 因为 `usage` 的标准类型（来自 SDK）**不包含**
// `cache_deleted_input_tokens` 这个字段——它是内部实验特性。
// 直接 `usage.cache_deleted_input_tokens` 会报"属性不存在"。
//
// 双重断言 `as unknown as` 是绕开类型检查的标准做法：
// 先转成 unknown（切断原类型），再转成目标类型。
//
// 【注意 376 行那个多余的类型判断】
//   `lastAsst?.type === 'assistant' ? ... : 0`
//
// `findLast(m => m.type === 'assistant')` 已经保证了类型，
// 但 TS 不知道 `findLast` 的类型谓词（没写 `as` 收窄）。
// 所以这里再加一次判断让编译器满意。
//
// 这类"为了类型检查而写的冗余代码"在 TS 项目里很常见，
// 不影响运行，但会让读者多花几秒确认"这不是逻辑错误"。'''),

(401, 'before', '''// ═══ 时间触发的微压缩 ═══
//
// doc 注释："when the gap since the last main-loop assistant message exceeds
// the configured threshold, content-clear all but the most recent N
// compactable tool results."
//
// 和缓存路径的根本差别（注释里明说了）：
//   "Unlike cached MC, this mutates message content directly.
//    The cache is cold, so there's no cached prefix to preserve via cache_edits."
//
// 翻译：**直接改内容**。因为缓存是冷的，没有前缀需要保。
//
// 【注意这里有两段连续的 doc 注释（401-411 和 412-421）】
// 这是重构留下的痕迹：原来是一个大函数，后来把"判断该不该触发"
// 抽成了 `evaluateTimeBasedTrigger`，但两段注释都留着了。
//
// 第二段（412-421）解释抽出的理由：
//   "Extracted so other pre-request paths (e.g. snip force-apply) can consult
//    the same predicate without coupling to the tool-result clearing action."
//
// 翻译：snip 那条路径也要用"该不该按时间触发"这个判断，但不想
// 连带把"清工具结果"这个动作也拉进来。
//
// 这是**判断和动作分离**的标准做法。'''),

(422, 'before', '''// 判断该不该触发，返回差距（分钟）+ 配置。
//
// 【注意它的返回值设计】
// 返回 `{ gapMinutes, config }` 而不是 boolean。
// 因为调用方要用 `gapMinutes` 打埋点（498 行 `gapMinutes: Math.round(...)`）。
//
// 如果只返回 boolean，调用方还得重新算一遍 gap——那是重复计算，
// 而且可能因为时间流逝得到不同的值。
//
// 【一个通用的函数设计经验】
// 判断函数如果需要"顺便告诉调用方一些计算过程中的信息"，
// 就返回一个对象而不是 boolean。但**不要返回一堆无关的东西**——
// 这里的两个字段都是调用方实际用到的（埋点里还用了 config 的多个字段）。'''),

(427, 'before', '''// ═══ 这一行和 249 行的默认值方向相反，非常值得对比 ═══
//
// 注释：
//   "Require an explicit main-thread querySource. isMainThreadSource treats
//    undefined as main-thread (for cached-MC backward-compat), but several
//    callers (/context, /compact, analyzeContext) invoke microcompactMessages
//    without a source for analysis-only purposes — they should not trigger."
//
// 两个地方对 `querySource === undefined` 的处理：
//
//   249 行 `isMainThreadSource(undefined)`  → **true**（当主线程）
//   431 行 `!querySource`                   → **直接返回 null**（不触发）
//
// 为什么相反？因为动作的**副作用性质**不同：
//
//   · 缓存路径（249 行）：只是"读状态、排队指令"。
//     如果误判成主线程，后果是"多做了一次无害的检查"。
//     所以宽松点没关系（而且这是历史行为，改严会破坏兼容）。
//
//   · 时间触发（431 行）：会**真的清掉工具结果内容**。
//     如果误判，后果是"用户只是看了下 /context，工具结果全被清了"。
//     这是不可接受的，所以必须严格。
//
// 【原则：副作用越大，判断越严】
// 同样是"判断是不是主线程"，读操作可以宽松，写操作必须严格。
//
// 注释里点的三个调用方（`/context`、`/compact`、`analyzeContext`）
// 都是"只想分析一下当前上下文多大"——它们不需要、也不应该
// 触发任何真正的压缩。'''),

(434, 'before', '''// 找最后一条 assistant 消息。
//
// 用 `findLast` 而不是 `filter().at(-1)`——省一次数组分配。
//
// 【为什么以 assistant 消息的时间为准，而不是最后一条任意消息】
// 因为 assistant 消息代表"模型刚刚说完话"，那才是"用户离开了"的信号。
//
// 如果以 user 消息为准：用户发了消息但模型还没回，gap 是 0，
// 永远不触发。而这个场景恰恰是"用户回到电脑前继续"的时候。
//
// 【这里有一个隐含假设】
// `timestamp` 字段是可靠的。如果某条消息的 timestamp 缺失或格式错误，
// `new Date(...).getTime()` 返回 NaN，`gapMinutes` 就是 NaN，
// 被 440 行的 `Number.isFinite` 挡住。'''),

(438, 'before', '''// `Date.now() - 时间戳`，除以 60,000 得到分钟。
//
// 45 行的配置里 `gapThresholdMinutes` 就是分钟单位。
//
// 【如果系统时钟被调慢（NTP 回拨），gapMinutes 会是负数】
// 440 行的判断是 `gapMinutes < config.gapThresholdMinutes`，
// 负数肯定小于阈值 → 返回 null → 不触发。
// 所以时钟异常时是**安全失败**（不压缩），不是误触发。'''),

(458, 'before', '''// ═══ 这个 `Math.max(1, ...)` 防的是两个退化情况 ═══
//
// 注释：
//   "Floor at 1: slice(-0) returns the full array (paradoxically keeps
//    everything), and clearing ALL results leaves the model with zero working
//    context. Neither degenerate is sensible — always keep at least the last."
//
// 【退化一：`slice(-0)` 等于 `slice(0)`】
// JavaScript 里 `-0 === 0`，而 `slice(0)` 返回**整个数组**。
// 所以如果 `keepRecent = 0`：
//   `compactableIds.slice(-0)` = 全部 id
//   `keepSet` = 全部
//   `clearSet` = 空
//   → **一条都不清**，功能完全失效
//
// 这个坑非常经典：`-0` 在 JS 里是合法的 0，但很多 API 把它当作
// "从末尾数 0 个"来设计（`slice(-0)` 应该是空数组才符合直觉）。
// 实际行为历史遗留成了 `slice(0)`。
//
// 【退化二：全清】
// 如果 `keepSet` 为空，所有工具结果都变墓碑。
// 模型看到的上下文是"我调了 30 个工具，全都返回 [cleared]"——
// 它连"最近在干什么"都不知道了，只能重新跑一遍。
//
// 所以无论如何保留最后一个。这一个可能就够模型接上话。'''),

(465, 'before', '''// 没有可清理的 → 返回 null，让调用方继续往下走（试缓存路径）。
//
// `return null` 而不是 `return { messages }` 是语义上的区别：
//   null          → "我没干活，你继续试别的"
//   { messages }  → "我处理过了，结果就是原样"
//
// 调用方（267-270 行）拿到 null 才会继续走缓存路径。
// 如果这里返回 `{ messages }`，缓存路径就被跳过了。'''),

(469, 'before', '''// 重建整个数组，只改需要改的 tool_result。
//
// 474 行 `let touched = false` + 487 行 `if (!touched) return message`
// ——又是"没改动就返回原引用"的模式（compact.ts 里讲过两次）。
//
// 【为什么这里必须保住引用】
// 因为 `microcompactMessages` 返回的 messages 会一路传到
// `query()` 的消息数组。如果无条件浅拷贝，每轮都会产生
// 全新的消息对象：
//   · 任何基于引用相等的 memo / 缓存全部失效
//   · 磁盘落盘的 diff 逻辑（按 uuid 比对）可能受影响
//   · 内存里会短暂存在两份完整的消息树
//
// 一个包含上百条消息的会话，每轮全量重建是实打实的开销。'''),

(483, 'before', '''// 把内容换成墓碑，但**保留 block 的其余字段**（`...block`）。
//
// `tool_use_id`、`is_error` 等字段都要留着——删掉的只是 `content`。
//
// 【`is_error` 特别重要】
// 如果原来是一个错误结果（`is_error: true`），清成墓碑后还要保持
// `is_error: true`。否则模型会以为"这个工具调用成功了，只是输出被清了"——
// 而实际上它是失败的。
//
// `...block` 展开保住了这个信息。这也是为什么不能直接
// `return { type: 'tool_result', tool_use_id, content: '...' }` ——
// 那样会丢掉所有其他字段。'''),

(494, 'before', '''// ═══ 一个防空转的检查 ═══
//
// `tokensSaved === 0` 说明：虽然 `clearSet` 非空，但实际一条都没清到。
//
// 什么情况会这样？
//   1. `clearSet` 里的 id 对应的 tool_result 不在任何消息里
//      （比如在 compact boundary 之前，已经不在 messages 里了）
//   2. 那些结果**已经**是墓碑了（479 行 `block.content !== TIME_BASED_MC_CLEARED_MESSAGE`
//      这个判断挡住了重复清理）
//
// 【第 2 点是最常见的】
// 说明这个函数在"已经清过"的会话上被重复调用了。
// 返回 null 让上层的"是否做了压缩"判断正确——
// 如果返回 `{ messages: result }`，上层会以为"这轮压缩了"，
// 可能触发不必要的重来。
//
// 【这个检查的价值在于"结果导向"】
// 不看"我打算清几个"（`clearSet.size`），而看"实际省了多少"（`tokensSaved`）。
// 前者是意图，后者是事实。'''),

(511, 'before', '''// 抑制"上下文警告"的提示。
//
// 背景：`compactWarningState.ts` 有一套机制——当上下文接近上限时，
// 系统会提示用户"考虑 /compact"。但如果系统刚刚自己压缩过，
// 还提示用户手动压缩就很蠢。
//
// 所以压缩成功后调 `suppressCompactWarning()`，
// 下一轮的警告检查会被跳过（或者在 `clearCompactWarningSuppression`
// 之后恢复）。
//
// 【注意 259 行在入口处调了 `clearCompactWarningSuppression()`】
// 一进函数就清掉抑制标志，然后如果真的压缩了才重新抑制。
//
// 这是一个"假设没干活"的写法：
//   · 清标志 = 默认"这轮没压缩，该警告就警告"
//   · 干活了再抑制
//
// 反过来（默认抑制、没干活才清）会有一个问题：
// 如果有其他路径也调这个函数但没走到抑制，标志会残留。'''),

(517, 'before', '''// ═══ 紧邻上面那五行注释，解释了一个必须做的清理 ═══
//
// 完整链条：
//   1. 前几轮主线程用缓存路径，登记了 tool_A ~ tool_J（state 里记着）
//   2. 用户离开了一阵 → 这一轮时间触发命中 → **直接改了本地内容**
//   3. 改了内容 = 前缀变了 = 服务端缓存作废
//   4. 但 `cachedMCState` 还是旧的，记着 tool_A ~ tool_J
//   5. 下一轮缓存路径看到 state，生成 "删除 tool_A~J" 的指令
//   6. 服务端：这些内容在新缓存里根本不存在（缓存已重建）
//      → 指令石沉大海 或 报错
//
// 所以必须重置。
//
// 【这条注释的深层含义】
// 两条路径**共享同一个模块级状态**（`cachedMCState`），
// 但它们的假设完全不同：
//   · 缓存路径假设"服务端缓存是连续的，编辑指令能对上"
//   · 时间触发**破坏**了这个假设（改了内容）
//
// 所以时间触发的收尾工作之一，就是把另一个路径的状态清掉。
//
// 【这是"共享可变状态"的又一个代价】
// 前面 272 行那个"只给主线程跑"是防分叉 agent 污染，
// 这里是防两条路径互相污染。同一个根源，两处防御。'''),

(525, 'before', '''// ═══ 一段四行的注释，解释了一个"没做的事" ═══
//
//   "notifyCacheDeletion (not notifyCompaction) because it's already imported
//    here and achieves the same false-positive suppression — adding the second
//    symbol to the import was flagged by the circular-deps check."
//
// 翻译：语义上该用 `notifyCompaction`（"我压缩了，缓存断层是我干的"），
// 但实际用了 `notifyCacheDeletion`（"我删了缓存内容"），
// 因为——**后者已经导入了，再导入一个会被循环依赖检查拦下**。
//
// 两者都能达到"抑制误报"的效果，所以用哪个都行。
//
// 【这是一个被工程约束塑造的设计决定】
// 不是"哪个更正确"，而是"哪个不用改 import 图"。
//
// 这种注释非常有价值，因为它记录了一个**看起来像随手写的选择**
// 背后的真实原因。没有它，后来者会觉得"这里应该用 notifyCompaction
// 更语义化啊"，然后改掉，结果撞上循环依赖报错，浪费时间。
//
// 【注意注释的后半段】
//   "Pass the actual querySource: getTrackingKey returns the full source string
//    (e.g. 'repl_main_thread:outputStyle:custom'), not just the prefix."
//
// 这又回到 243 行那个 prefix 问题：**判断时用 startsWith，
// 传给下游时传完整字符串**。因为下游要按完整字符串做 key。
//
// 两个行为的区别很小但很重要：
//   判断"是不是主线程" → 前缀匹配（宽松）
//   记录"是哪个来源"   → 完整字符串（精确）'''),
]
