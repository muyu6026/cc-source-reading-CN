# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  MessageRow：列表里的一行，以及「这一行还会不会变」的判定
// ═══════════════════════════════════════════════════════════════
//
//  它在管线里的位置很具体：
//
//    Messages 算出 renderableMessages（该显示哪些）
//      → MessageRow 决定这一行**要不要重新渲染**（memo 比较器）
//      → Message 按消息类型分发到具体组件
//
//  所以这个文件真正的产出不是 JSX，是一个布尔判断：**这一行以后还会变吗**。
//  答案会影响两件事 —— 要不要重渲染，以及（更重要的）能不能把它推上终端
//  scrollback 之后再也不管。
//
//  382 行里有 120 行是三个导出的辅助函数（hasContentAfterIndex /
//  isMessageStreaming / allToolsResolved），它们都是「判定」而不是「渲染」。
//  比例正好说明这个文件的重点在哪。'''),

    (40, 'before', '''// 【为什么要把扫描结果做成一个布尔 prop，而不是把数组传进去】
//
//  注释说的是 "React Compiler would pin in the fiber's memoCache,
//  accumulating every historical version of the array" —— 这句话是理解
//  React Compiler 产物的一把钥匙。
//
//  React Compiler 会把「用过的值」按位置存进 `$[i]`，用于下次比较。如果
//  某个 prop 是一个大数组，那么**这个数组的每一个历史版本**都被钉在对应
//  fiber 的缓存里，直到组件卸载。
//
//  7 轮对话约 1-2MB —— 单条不算多，但这是每行一份。2800 行就是 GB 级。
//
//  可推广的规律：**传给叶子组件的大对象，会被记忆化机制钉住**。所以
//  「按行展开成标量」不只是可读性问题，是内存问题。'''),

    (50, 'before', '''// 【四种「跳过」对应四种「它在路上但还没到」】
//
//  1. thinking / redacted_thinking —— 思考过程不算内容
//  2. 可折叠的 tool_use（read / search）—— 它们会并进当前折叠组
//  3. 流式中的 tool_use —— 它的 id 还没进 inProgressToolUseIDs，但马上会
//  4. system / attachment / tool_result / 可折叠的 grouped_tool_use
//
//  第 3 条最微妙：注释说 "syntheticStreamingToolUseMessages 会在 ID 被加进
//  inProgressToolUseIDs 之前就把它放进列表"。也就是说存在一个时间窗口，
//  这个 tool_use 已经出现在屏幕上，但「它在执行中」这件事还没登记。
//
//  如果不跳过，那个窗口里折叠组会被判成「后面没内容了」→ 时态从
//  "Reading…" 闪成 "Read 3 files" → 一秒后又闪回来。'''),

    (93, 'before', '''// 【这个函数是被 React Compiler 编译过的，不是手写形态】
//
//  `const $ = _c(64)` 建了 64 个缓存槽；后面每一段 `if ($[n] !== x)` 都是
//  「上次算的值和这次一样就复用」。
//
//  读这种代码的方法：**跳过所有 `$[n]` 的赋值和读取，只看 `if` 条件里出现
//  的真实变量，以及 else 分支里 `tX = $[M]` 对应的原始表达式**。
//
//  举个具体的：第 117-128 行那段，把 `$[...]` 全部删掉之后剩下的是
//
//      isActiveCollapsedGroup =
//        isCollapsed && (hasAnyToolInProgress(msg, inProgressToolUseIDs)
//                        || (isLoading && !hasContentAfter))
//
//  这才是作者写的东西。所有编译器产物都是在给这一行加缓存。'''),

    (117, 'before', '''// 【「活跃折叠组」的两个条件，第二个容易看漏】
//
//  · hasAnyToolInProgress —— 组里有工具在跑，正常
//  · isLoading && !hasContentAfter —— **没有工具在跑，但整体还在加载，
//    而且后面没有别的内容**
//
//  第二个条件覆盖的是「工具都跑完了，模型正在想下一步」这个空档。此时折叠
//  组如果切成过去时，用户会以为这一轮结束了；实际上屏幕下面马上还会有东西。
//
//  `!hasContentAfter` 是必要的限定：如果后面已经有内容（比如流式文本），
//  那就该切时态了，因为用户已经能看到「还在继续」。'''),

    (130, 'before', '''// 【displayMsg 的三种来源，第三种是「它就是自己」】
//
//  · grouped_tool_use → msg.displayMessage（分组时预先合成的展示消息）
//  · collapsed_read_search → getDisplayMessageFromCollapsed(msg)（现场合成）
//  · 其他 → msg
//
//  注意前两种是**虚拟消息**：它们不在 messages 数组里，只在渲染时需要。
//  这就是为什么下游要用 displayMsg 而不是 msg 来判断「有没有元数据」——
//  虚拟消息的 timestamp / model 是从成员消息里挑出来的。'''),

    (141, 'before', '''// 【聚合类型没有进度消息，所以给个空数组】
//
//  getProgressMessagesFromLookup 是按单条消息的 tool_use_id 去查的，而
//  grouped / collapsed 是一个组，没有单一 id。
//
//  给 `[]` 而不是 undefined，是因为下游按数组用（遍历）。一个常量空数组
//  （不是每次 new []）能让 React Compiler 的缓存命中。'''),

    (153, 'before', '''// 【EMPTY_STRING_SET 是常量，不是每次 new Set()】
//
//  同一个理由：聚合类型不需要兄弟集合，但下游要一个可遍历的 Set。给常量
//  空集，成本是零，而且引用稳定 —— 如果每次 new，`shouldRenderStatically`
//  的结果虽然一样，但 memo 缓存会因为入参换引用而失效。
//
//  这类「空值常量」看起来是小事，实际上是 memo 化代码里的必需品。'''),

    (168, 'before', '''// 【shouldAnimate 的三种情况，本质是「这一行有没有在动的东西」】
//
//  · grouped：组里任何一个 tool_use 还在 inProgress
//  · collapsed：组里任何一个工具在跑
//  · 单条：**没有 tool_use，或者它的 id 在 inProgress 里**
//
//  第三种的反向逻辑值得注意：`!toolUseID || inProgressToolUseIDs.has(toolUseID)`
//  —— 「没有 tool_use」也算在动。因为纯文本消息在流式追加时，它就是「在动」
//  的那一个。
//
//  而 canAnimate 是全局开关（有确认框、有面板、有选择器时为 false）。'''),

    (220, 'before', '''// 【hasMetadata 只在 transcript 模式出现，且四个条件全要满足】
//
//  transcript + assistant + 内容里有 text 块 + 有 timestamp 或 model
//
//  第三个条件（要有 text）排除的是「纯 tool_use 的 assistant 消息」—— 那种
//  消息在 transcript 里不需要单独标时间和模型，因为它下面紧跟的就是结果。
//
//  第四个条件是「至少有一个」：老消息可能没有 timestamp，但有 model；都有
//  才算。'''),

    (229, 'before', '''// 【addMargin 和 containerWidth 是**反向**的，这个设计容易读错】
//
//  hasMetadata = true  → addMargin = false，containerWidth = undefined
//  hasMetadata = false → addMargin = true， containerWidth = columns
//
//  带元数据的那条路径自己有一个外层 Box（width={columns} + 顶部 margin），
//  所以内层不许再加边距、宽度走 100%（由外层决定）。
//
//  不带元数据的路径省掉了外层 Box，所以内层要自己带上边距、自己拿绝对宽度。
//
//  Props 注释里 "When provided, eliminates a wrapper Box in the caller" 说的
//  就是这个：**用绝对宽度换掉一层 Box**。一层 Box 在 2800 行里的成本是
//  2800 次 yoga 节点创建 + 布局。'''),

    (256, 'before', '''// 【两个 return 路径，差别不只是有没有元数据行】
//
//  无元数据：`OffscreenFreeze > messageEl` —— 只有一层，宽度 100%。
//  有元数据：`OffscreenFreeze > Box(width) > [元数据行, messageEl]`。
//
//  注意 OffscreenFreeze 在两条路径上都有，而且都在**最外层**。它必须包住
//  整个可视内容，否则冻结时只冻一半，剩下的还在触发重渲染。
//
//  另外这两条路径的返回元素结构不同 —— 如果某条消息在运行过程中从「有
//  元数据」变成「没元数据」（比如 timestamp 补上了），React 会卸载整棵子树
//  重建。实际上这个转换只在 transcript 模式下发生，且立刻完成一次。'''),

    (269, 'before', '''// 【元数据行右对齐，gap={1}】
//
//  justifyContent="flex-end" 让它靠右。`<MessageTimestamp />` 和
//  `<MessageModel />` 各自决定显示什么（时间可能是相对时间，模型可能被
//  缩写），这里只负责排版。
//
//  marginTop={1} 让这一行和上面的消息之间有空白，视觉上把「元数据」和
//  「内容」分开。'''),

    (296, 'before', '''// 【三个判定函数都标了 "Exported for testing"】
//
//  和 Messages.tsx 里的 computeSliceStart 一样：这份源码是打包产物反推的，
//  **测试文件被剥掉了**。所以这些 export 在仓库里没有消费者。
//
//  读的时候不要误判成「死代码」—— 它们的活性体现在「被导出的目的是可测」，
//  而不是「被别的模块调用」。这和真正的死代码（shouldClearScreen 那种
//  判据已经内联到别处）是两回事。
//
//  分辨方法：看它有没有注释说明用途。写了 "for testing" 的，是测试入口；
//  什么都不说又没人调用的，才可能是死代码。'''),

    (315, 'before', '''// 【allToolsResolved 比 isMessageStreaming 多一个 server_tool_use 分支】
//
//  原因和 Messages.tsx 第 790 行那个特判一样：服务端工具没有独立的
//  tool_result 消息，它的「resolved」只能靠 id 在不在集合里判断。
//
//  而 getToolUseID 对 server_tool_use 大概率返回 null，于是
//  `!toolUseID` 为真 → 直接判 resolved。**这是错的**：结果还没回来就判完成。
//
//  所以这两个函数的差异不是风格问题，是必须的补丁。'''),

    (342, 'before', '''// 【注释第一句就点明了策略：只在**确定**不变时才跳过】
//
//  "Fails safe by re-rendering when uncertain." —— 这个方向的偏向是对的，
//  因为判错的两种代价不对称：
//
//  · 该跳过没跳过 → 多渲染一次，慢一点
//  · 不该跳过却跳过 → 屏幕上留着旧内容，且**没有任何机制会再修正它**
//    （因为这一行可能已经推上 scrollback）
//
//  所以这里所有的判据都是「一旦有疑问就 return false」。'''),

    (353, 'before', '''// 【collapsed_read_search 在 prompt 模式永远放行】
//
//  这和 shouldRenderStatically 里那个 `return false` 是同一个判据的两处表达：
//  那边管「能不能静态化」，这边管「能不能跳过重渲染」。两处必须一致。
//
//  如果只改一处：判成静态（推上 scrollback）但 memo 又允许跳过重渲染 ——
//  那么时态永远停在 "Reading…"，因为没有东西会重渲染它。
//
//  **同一个判据在两个地方表达时，改动必须成对。** 这是这份代码里最容易
//  出错的结构（第 373 行的 isStreaming 判定也是同理，只是它复用了函数）。'''),

    (361, 'before', '''// 【比的是「我是不是最新的那条」，不是「最新的是谁」】
//
//  这个区别很重要：
//
//    prevIsLatestBash = (prev.latestBashOutputUUID === prev.message.uuid)
//
//  左边是布尔，右边是字符串。如果直接比字符串，那么「最新 bash 从 A 换成 B」
//  时，**所有行**的 latestBashOutputUUID 都变了 → 所有行都要重渲染。
//
//  化简成布尔之后，只有 A 和 B 两行的判定结果发生变化，其余行不受影响。
//
//  这是「把 prop 化简成这个组件真正关心的形式」的范例。Message.tsx 的
//  比较器里有完全相同的重复实现（第 616 行），因为两个组件各自需要它。'''),

    (368, 'before', '''// 【lastThinkingBlockId 的变化只对「有 thinking 内容」的消息有意义】
//
//  注释里的 CC-941 说：不加这个门，每次 thinking 开始/结束时**所有**
//  scrollback 里的消息都要重渲染 —— 因为那个 id 是一个全局值，一处变化
//  全体都受影响。
//
//  加上 hasThinkingContent 之后，只有真正含 thinking 块的消息会放行。
//  在一条 2800 条消息的会话里，含 thinking 的可能只有几十条。
//
//  这个模式和上一条的 latestBashOutputUUID 是同一个手法：**用一个廉价
//  的本地判据，过滤掉全局状态变化带来的无关更新。**'''),

    (373, 'before', '''// 【最后两道闸：还在流式 → 必须重渲染；工具没全 resolve → 必须重渲染】
//
//  注意这里重新算了一遍 isStreaming / isResolved，而不是从 props 里拿 ——
//  因为 Props 里没有这两个字段（它们在 MessageRow 内部算过，用于别处），
//  而且这两个判定依赖 streamingToolUseIDs / lookups，都在 props 里。
//
//  重复计算一次的代价（两个 Set 查询）远小于多一次完整渲染。
//
//  这两道闸的位置也有讲究：它们放在所有「便宜的比较」之后。前面那些
//  字符串/布尔的比较几乎不花钱，先做；这两个要遍历数组和集合，放最后。'''),
]
