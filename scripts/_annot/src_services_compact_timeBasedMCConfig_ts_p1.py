# -*- coding: utf-8 -*-
"""timeBasedMCConfig.ts 批注：时间触发的微压缩配置（43 行，一条很硬的推理）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 补小件 6/6 —— 时间触发的微压缩配置
//                              （src/services/compact/timeBasedMCConfig.ts，43 行）
//
// 【这个文件在解决一个"反正都要亏，不如少亏点"的问题】
//
// 场景：用户上午用了一会儿，然后离开，下午回来继续。
// 中间隔了几小时 —— 服务端的 prompt cache 早就过期了（TTL 1 小时）。
//
// 这意味着：下午第一个请求，**整个前缀必须重写**，全量计费。
// 这是不可改变的事实（缓存已经没了）。
//
// 但既然要重写，写什么就有得选了：
//   · 重写 200K token（含一堆早就没用的 tool result）
//   · 还是先清掉旧 tool result，重写 80K
//
// 两者对模型的效果几乎一样（那些 tool result 本来也不会被用到），
// 但成本差一倍以上。所以答案是后者。
//
// 【一句话：缓存已经注定要 miss 的时候，就是免费整理上下文的最佳时机。】
//
// 这是整个 compact 目录里最"经济"的一个决策 —— 不是省在压缩上，
// 是省在"反正要付的那笔钱"里少付一点。
// ═══════════════════════════════════════════════════════════════'''),

(3, 'before', '''// 注意用的是 `getFeatureValue_CACHED_MAY_BE_STALE` 而不是"读取最新配置"。
//
// 【这个函数名的每一个词都是信息】
//
//   CACHED        → 读本地缓存，不发网络请求
//   MAY_BE_STALE  → **可能过时**，名字直接承认这一点
//
// 为什么可以接受过时？因为这里的值只决定"要不要清 tool result"。
// 决定错了最坏是：早清一次或晚清一次。不是正确性问题。
//
// 【对比一下什么场景不能用 STALE 版】
//
//   要命的场景（比如"是否允许执行 rm -rf"这类权限开关）必须读最新值，
//   宁可等网络。而"是否顺手清点缓存"这种优化开关，读缓存就够。
//
//   函数名里带 MAY_BE_STALE 是个很好的设计：它让调用方在
//   **写代码的当下**就被迫思考"我能接受过时吗"。
//   如果它叫 getFeatureValueCached，很多人会忘了问这个问题。'''),

(17, 'after', '''// 【上面那段块注释的前两句是核心推理，值得逐字读】
//
//   "Triggers content-clearing microcompact when the gap since the last
//    main-loop assistant message exceeds a threshold — the server-side
//    prompt cache has almost certainly expired, so the full prefix will be
//    rewritten anyway. Clearing old tool results before the request shrinks
//    what gets rewritten."
//
//   拆成三段逻辑：
//     ① 距上一条主循环 assistant 消息超过阈值
//     ② → 服务端缓存几乎肯定过期了
//     ③ → 整个前缀反正要重写；那就先清掉旧 tool result，缩小重写量
//
//   这是一个**因果链完整的优化**：触发条件 → 判断依据 → 动作 → 收益。
//   每一步都能被质疑（阈值对不对？缓存真的过期了吗？），
//   但链条本身是通的，所以可以调参、可以验证。
//
//   【对比一下坏注释长什么样】
//     "基于时间的微压缩配置。" —— 复述了函数名，什么信息都没有。
//
// 【第三句是时序约束，非常关键】
//
//   "Runs BEFORE the API call (in microcompactMessages, upstream of
//    callModel) so the shrunk prompt is what actually gets sent. Running
//    after the first miss would only help subsequent turns."
//
//   → 必须跑在**发请求之前**，这样缩小后的 prompt 才是真正发出去的那份。
//   → 如果等第一次 miss 回来再清，那就只对**后续**轮次有帮助 ——
//     而恰恰是第一次 miss 最贵（重写全量）。
//
//   这是一个"优化位置错了就等于没做"的例子。功能都实现了、
//   代码都跑了、日志都正常，但一分钱没省。
//
// 【最后一句是作用域限定】
//   "Main thread only — subagents have short lifetimes where gap-based
//    eviction doesn't apply."
//   → 子 agent 生命周期短，不会有"隔几小时回来"的情况，所以不用管。
//   【这类"为什么不需要"的注释同样重要 —— 否则下一个人会以为漏了，
//     然后给子 agent 也加上，引入无意义的开销和潜在的状态冲突。】
//
// ─────────────────────────────────────────────────────────────
// 下面拆这三个字段。注意每个字段的注释都写了"为什么是这个值"，
// 而不只是"这个值是什么"。'''),

(18, 'before', '''// 三个字段：enabled / gapThresholdMinutes / keepRecent。
//
// 【enabled：总开关，默认 false】
//   默认关闭意味着这是个实验性/灰度特性。结合下面那个 GrowthBook key
//   `'tengu_slate_heron'`（一个代号，看不出功能），是典型的
//   "先在内部/小流量验证，再逐步放开"的上线方式。
//
// 【gapThresholdMinutes：60，注释给了完整理由】
//
//   "60 is the safe choice: the server's 1h cache TTL is guaranteed
//    expired for all users, so we never force a miss that wouldn't have
//    happened."
//
//   ← 这句是全文件最硬的推理。
//
//   60 分钟不是拍的，是从"服务端 cache TTL 正好是 1 小时"推出来的：
//   超过 60 分钟，对所有用户都**保证**缓存已过期。
//   于是这次清理**永远不会造成本来不会发生的 miss**。
//
//   如果设成 30 分钟呢？会有大量"缓存其实还热着"的情况被误清 ——
//   不但没省，反而**主动制造了一次 miss**，成本翻倍。
//
//   【这是一个"阈值必须落在已知约束的安全侧"的范例】
//   60 这个数字背后的依据不是经验值，是一个已知的系统参数（TTL）。
//   找这种"有硬依据的阈值"比调参靠谱得多。
//
// 【keepRecent：5，注释说明优先级】
//
//   "When set, takes priority over any default; older results are cleared."
//
//   → 保留最近 5 条可压缩的 tool result，更早的清掉。
//   → 为什么是 5 不是 0？因为 microCompact.ts 里那个 `slice(-0)` 退化：
//     keepRecent=0 会退化成"全留"或者"全清"，两个都不对。
//     （那里用 Math.max(1, ...) 兜住了，但这里的默认值直接避开这个坑。）
//
//   → 为什么不能全清？因为模型需要一点"刚刚做过什么"的上下文，
//     零工作上下文会让它重新摸索。'''),

(30, 'before', '''// 默认值对象单独提出来，命名 `TIME_BASED_MC_CONFIG_DEFAULTS`。
//
// 【这个写法在 GrowthBook 这类配置系统里是必需的】
//
//   `getFeatureValue(key, defaults)` 的第二个参数是**兜底值**：
//   如果远程配置没下发、或者下发的字段不全，就用这里的值补齐。
//
//   所以这个对象实际上是**两层保险**：
//     ① 特性没上线（远程没有这个 key）→ 全用默认 → enabled: false
//     ② 远程下发了但只给了 gapThresholdMinutes → 其余字段用默认
//
//   【第 ② 种情况最容易被忽略】：远程配置少一个字段，
//   如果代码里没有兜底，那个字段就是 `undefined`，
//   然后 `undefined > 60` 是 `false` —— 静默地永不触发。
//
//   兜底值在这里不是"方便"，是**防止远程配置不完整导致静默失效**。'''),

(36, 'before', '''// 函数只有一行，但那行前面的注释解释了"为什么不写成更自然的样子"。
//
// 【更自然的写法会是什么样】
//
//       function shouldDoTimeBasedMC(querySource, messages) {
//         if (!isMainThread(querySource)) return false
//         if (messages.length < X) return false
//         return getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_heron', ...)
//       }
//
//   也就是把判断也放进来。这样调用方更省事，但有个副作用：
//   **远程配置的 exposure 事件只在通过前置条件时才上报**。
//
// 【这个函数选了另一种：只读配置，判断留给调用方】
//
//   注释原话：
//     "Hoist the GB read so exposure fires on every eval path, not just
//      when the caller's other conditions (querySource, messages.length)
//      pass."
//
//   → 把配置读取"提前到最外层"，让 exposure 在**每条求值路径**上都上报。
//
//   【为什么 exposure 要全量上报？】
//     因为 A/B 实验需要知道"多少人**被暴露**在这个实验下"，
//     而不是"多少人**实际触发了**这个行为"。
//     如果只在触发时上报，实验数据会严重偏向"用户主动做了某事"的人群，
//     导致效果评估失真（选择偏差）。
//
//   【可迁移结论】实验埋点的位置要在**分流决策点**，
//   不在**行为发生点**。这两者经常被混为一谈，然后实验结论不可信。'''),

(42, 'after', '''// 43 行，一个字段、一个默认值、一个单行函数。
//
// 【把这个文件和你已经读过的 autoCompact.ts 对比】
//
//   autoCompact.ts（351 行）→ 四道抑制闸门、三振熔断、session memory 优先
//   timeBasedMCConfig.ts（43 行）→ 一个开关、一个阈值、一个 keepRecent
//
//   为什么复杂度差 8 倍？
//   因为 autoCompact 是**兜底机制**（上下文真的快爆了，必须处理，
//   所以需要考虑所有失败路径）；
//   而 timeBasedMC 是**优化**（不做也不会错，只是多花点钱，
//   所以可以做得极简）。
//
//   【判断一个模块该做多复杂，先问"不做会怎样"：
//     不做会错 → 需要完整错误处理；
//     不做只是慢/贵 → 越简单越好，简单才不容易出错。】
//   这个文件 43 行，就是"优化型模块"应有的样子。'''),

]
