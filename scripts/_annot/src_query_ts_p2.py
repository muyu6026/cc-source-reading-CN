# -*- coding: utf-8 -*-
"""query.ts 批注 2/4：初始化、using 声明、while 主体开头、五层压缩管线。"""

ANNOTATIONS = [
(252, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 10. 初始化：不可变参数 vs 可变状态的分界线 ──
// 行 252-263 解构出来的是**永不重新赋值**的；行 268 开始的 state 才是可变的。
// 这条分界线很重要：读代码时看到裸名 `messages` 就是本轮快照，
// 看到 `state.messages` 就是完整状态。混用会导致读到过期的值。
// ═══════════════════════════════════════════════════════════════'''),

(263, 'after', '''// 注：依赖注入。`params.deps ?? productionDeps()` ——
//     测试可以传一套假 deps（假的大模型、假压缩），完全不走网络。
//     这是一种比 mock 模块更干净的测试方式（不需要 jest.mock 拦截 import）。
//     本文件里所有外部能力都走 deps：callModel、microcompact、autocompact、uuid。
//     ⚠ 但也有漏网的 —— 行 570 的 `toolUseContext.getAppState()`、
//     行 588 的 createDumpPromptsFetch、行 1001 的 executePostSamplingHooks
//     都是直接调用。说明这套 DI 是**逐步引入**的，不是一次性重构完成。'''),

(267, 'after', '''// 译：跨轮可变状态。循环体每轮开头解构它，这样读取时能保持裸名
//     （`messages`、`toolUseContext`）。各个 continue 站点写
//     `state = { ... }`，而不是 9 次独立赋值。
//
// 注：「9 次独立赋值」的问题不只是啰嗦 —— 是**漏字段**。
//     如果某个 continue 站点忘了重置 maxOutputTokensRecoveryCount，
//     那条路径就会带着上一轮的计数继续跑，重试次数被悄悄消耗掉。
//     整体重建则强制你在每个站点显式写全 9 个字段（TypeScript 会检查），
//     漏一个就编译不过。这是用类型系统防错，而不是靠自觉。'''),

(280, 'after', '''// 注：只有开了 TOKEN_BUDGET 才创建 tracker。
//     `budgetTracker!` 在行 1310 用了非空断言 —— 因为那里已经
//     被 `feature('TOKEN_BUDGET')` 包住，编译器推不出来，只能人工保证。
//     这是 DCE 模式常见的代价：feature 常量折叠后 TypeScript
//     不再知道 null 检查关系，只能到处 `!`。'''),

(282, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 11. 一个刻意不放进 State 的变量，及其原因 ──
// 这段注释是本文件里最能体现「重构成本如何影响设计」的地方。
// ═══════════════════════════════════════════════════════════════'''),
(291, 'after_block', '''// 译：task_budget.remaining 跨压缩边界的跟踪。首次压缩前是 undefined ——
//     上下文未压缩时服务端能看到完整历史，它自己从 {total} 倒计时
//     （见 api/api/sampling/prompt/renderer.py:292）。压缩之后，服务端
//     只看到摘要，会少算已花额度；remaining 就是告诉它「压缩前那个
//     最终窗口有多少被摘要掉了」。跨多次压缩累积：每次减去该次压缩
//     触发点上的最终上下文。**循环局部变量（不放在 State 上），
//     以避免碰那 7 个 continue 站点。**
//
// 注：最后半句是全文最诚实的一句工程说明，值得单独讲。
//
//     【理想的写法】
//     这个值本质上就是跨轮状态，理应在 State 里（和 maxOutputTokens- 
//     RecoveryCount 一样）。放进 State 后，每个 continue 站点都要
//     多写一行 `taskBudgetRemaining,`。
//
//     【现实的选择】
//     作者选了「局部变量」。为什么？因为 State 是整体重建的，
//     加一个字段意味着**改 7 处**，每处都要想「这个站点该传什么值」。
//     而 taskBudgetRemaining 语义上在所有站点都一样（原样传下去），
//     所以放局部变量反而更省事、更不容易错。
//
//     【代价】
//     1. 语义不一致：其他跨轮状态在 State，这个不在。读代码的人会困惑。
//     2. 注释必须解释为什么 —— 于是有了这么长一段注释。
//     这是一笔「用注释换重构」的交易，而且是一笔划算的交易：
//     改 7 处 continue 站点的风险，远大于多写一段注释的成本。
//
//     【另一个细节】
//     注释里引用了 `api/api/sampling/prompt/renderer.py:292` ——
//     一个 Python 文件，双 `api/api` 路径，说明这是服务端仓库的路径。
//     客户端代码注释引用服务端实现，是跨仓库协作留下的痕迹。'''),

(293, 'after', '''// 注：`buildQueryConfig()` 是一次性快照。行 293-295 的注释说得很清楚：
//     「在入口处快照不可变的 env/statsig/session 状态」。
//
//     为什么必须快照？因为主循环一轮可能跑几十秒（模型流式输出 + 工具执行）。
//     如果每轮都去读环境变量/特性开关，会出现「同一轮里前后读到不同值」——
//     比如 stream 开始时 gate 是 true，工具执行时变成 false，
//     逻辑就分叉了。快照把这个不确定性锁在入口处。
//
//     行 294 还有一句关键的："why feature() gates are intentionally excluded"
//     —— feature() **不**进 config，因为它是编译期常量，运行时不会变，
//     放进去只会让 config 多一堆恒定字段。这又是 DCE 思路的延伸：
//     编译期能定的，不要留到运行期。'''),

(301, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 12. `using` 声明：全文件最冷门的一行语法 ──
// 这是 TC39 Explicit Resource Management（显式资源管理）提案的语法，
// TypeScript 5.2+ 支持。它等价于「自动 try/finally dispose」，但更精确。
// ═══════════════════════════════════════════════════════════════'''),
(304, 'after_block', '''// 译：每个用户轮次只触发一次 —— 提示词在各轮迭代间是不变的，
//     所以每轮都触发等于拿同一个问题问 sideQuery N 次。
//     消费点在轮询 settledAt（绝不阻塞）。`using` 会在所有生成器
//     退出路径上 dispose —— 见 MemoryPrefetch 的 dispose/遥测语义。
//
// 注：这行值得单独讲，因为它是本文件唯一一处 `using`。
//
//     【普通写法的问题】
//     后台预取（startRelevantMemoryPrefetch）会启动一个 Promise 去查记忆。
//     如果主循环提前 return（中断、出错、达到 maxTurns），这个 Promise
//     还挂着，需要清理（取消请求、记遥测）。用 try/finally 包住整个
//     1500 行的 while 循环显然不现实。
//
//     【using 的解法】
//     `using x = expr` 会在**离开作用域的任何路径**上调用 x[Symbol.dispose]()：
//     return、throw、break、generator 的 .return()。也就是「所有退出路径」。
//     对生成器尤其重要：生成器有 4 种关闭方式（自然结束、throw、
//     .return()、.throw()），手写 finally 很容易漏。
//
//     【为什么注释强调 "all generator exit paths"】
//     因为这是这个语法相对 try/finally 的唯一实质优势 ——
//     不是「少写几行」，而是「不可能漏」。
//
//     【一个副作用】
//     必须 target 到 ES2022+ 且 lib 里有 Symbol.dispose 才能编译。
//     所以在使用较老 TS 配置的项目里抄这行会报错。'''),

(306, 'after', '''// 注：`while (true)` 加 eslint-disable —— 加 disable 是因为
//     no-constant-condition 规则会警告「条件恒真」。这个警告在
//     一般代码里是对的，但这里就是刻意的（状态机主循环）。
//     这个循环唯一的出口是 return，全文共 11 个 return 站点，
//     每个都带一个 reason 标签：
//       blocking_limit / image_error / model_error / aborted_streaming /
//       prompt_too_long / stop_hook_prevented / completed / aborted_tools /
//       hook_stopped / max_turns / stop_hook_prevented
//     这些标签是 Terminal 联合类型的成员，测试直接断言它们。'''),

(308, 'after', '''// 注：解构分成两步，是个很细但重要的区别：
//       let { toolUseContext } = state        ← let，因为本轮内会被重新赋值
//       const { messages, ... } = state       ← const，本轮内只读
//     行 308-310 的注释解释了为什么 toolUseContext 特殊：
//     本轮内 queryTracking 要更新、messages 要更新，都是重建整个对象。
//     注意这里的 messages 是**上一轮结束时的** messages，
//     而本轮真正要发出去的是稍后算出的 messagesForQuery（行 365）——
//     两者不同！这是读这段代码最容易搞错的地方之一。'''),

(323, 'before', '''// ── 13. 技能发现预取：躲在模型流式输出时间里的第二次后台任务 ──'''),
(335, 'after', '''// 注：这段注释讲了一个「从阻塞改成预取」的优化，数字很具体：
//     「替换了 getAttachmentMessages 内部那条阻塞的 assistant_turn 路径
//       （生产环境里那些调用有 97% 什么都没找到）」
//
//     也就是说：原来每轮都**同步等**一次技能搜索，而 97% 的情况是白等。
//     改成预取后，搜索和模型流式输出并行跑，轮末再取结果。
//     这是典型的「把 IO 藏进已有的等待里」。
//
//     但注意最后一句的例外：「Turn-0 用户输入发现仍然在
//     userInputAttachments 里阻塞 —— 那是唯一没有先前工作可以遮蔽的信号」。
//     第一轮没有「正在进行的流式输出」可以藏，所以只能老实阻塞。
//     这个例外说明作者想过「能不能全异步」，答案是第一轮不行。'''),

(337, 'after', '''// 注：`stream_request_start` 是**每轮迭代开头**都会 yield 的第一条消息。
//     它没有内容，作用是给 UI 一个信号：「新的一轮开始了，清掉上一轮的
//     进度指示」。想想一个跑了 20 轮的任务，如果没有这个信号，
//     UI 无法区分「还在同一轮」和「已经进入下一轮」。
//
//     类型上它属于 RequestStartEvent，和 Message、StreamEvent 并列 ——
//     在 API 返回任何东西之前就先发出去。'''),

(346, 'before', '''// ── 14. queryTracking：一条"调用链"的身份 ──'''),
(363, 'after', '''// 注：chainId + depth 这两个字段在做一件事：**还原调用栈**。
//     depth 0 是主线程，子代理 depth 1，子代理的子代理 depth 2……
//     同一棵树的调用共享 chainId。
//
//     为什么主循环需要这个？因为所有遥测事件都带 (queryChainId, queryDepth)。
//     想象一次用户请求触发了 5 个子代理、每个又跑 10 轮，
//     产生几十条事件。没有 chainId 就无法把它们归到同一次用户请求下；
//     没有 depth 就无法知道谁是谁的孩子。
//
//     注意 chainId 的生成：有 queryTracking 就继承父的，没有就新建一个 uuid。
//     也就是「第一个进入 query() 的人定 chainId」。
//
//     行 357 那个 `as AnalyticsMetadata_I_VERIFIED_...` 类型断言值得单独说：
//     它是一个**故意起得很长的类型名**，作用是在写埋点时逼你确认
//     「我传的这个值不是代码内容、也不是文件路径」。
//     类型系统在这里被当成 code review 的强制执行手段 ——
//     你没法随手把 error.message 塞进去，必须显式写一个长断言，
//     而写的时候你会想一下。'''),

(365, 'after', '''// 注：`getMessagesAfterCompactBoundary` —— 从最近的压缩边界之后开始取。
//     压缩后历史里会留一条边界标记消息，之前的内容已被摘要取代。
//     如果不过滤，「摘要 + 原文」会重复发给模型，白花 token。
//
//     注意 `[...]` 浅拷贝：后面 snip/microcompact/collapse 都是
//     「返回新数组」而不是原地改，所以必须从一个可安全替换的数组开始。
//     整条压缩管线（下面 5 层）都是这个模式：
//         messagesForQuery = 某层(messagesForQuery)
//     纯函数式替换，不修改入参。'''),

(369, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 15. 五层上下文管理管线（这是本文件最需要整体理解的部分） ──
//
// 顺序：applyToolResultBudget → snip → microcompact → contextCollapse → autocompact
//
// 为什么要排这个顺序？**从便宜到昂贵、从局部到全局**：
//   ① applyToolResultBudget  只截断超长工具结果（改内容，不改结构）
//   ② snip                   删掉整段历史（最粗暴也最快）
//   ③ microcompact           按 tool_use_id 删除旧结果（不改内容）
//   ④ contextCollapse        把历史折叠成投影视图（保留可回滚）
//   ⑤ autocompact            整体摘要（最贵，会调一次模型）
//
// 前四层都不调模型，第五层要调。所以前面四层能解决问题就绝不进第五层 ——
// 行 428-431 的注释就是这个意思：「如果折叠已经让我们低于 autocompact
// 阈值，autocompact 就是空操作，这样能保住细粒度上下文，而不是一个摘要」。
// ═══════════════════════════════════════════════════════════════'''),

(376, 'before', '''// 注：`persistReplacements` 决定「替换记录要不要落盘」：
//        agent:*         → 落到 sidechain 文件（AgentTool resume 用）
//        repl_main_thread → 落到 session 文件（/resume 用）
//        其他（如 agent_summary 这种一次性的 fork）→ 不落盘
//
//     为什么要区分？因为落盘有成本（IO），而只有「之后可能被恢复」的
//     会话才需要记录。一次性的摘要代理跑完就丢，记了也没人读。
//
//     行 383-388 那个回调写法值得注意：
//         persistReplacements ? records => void recordContentReplacement(...).catch(logError) : undefined
//     两个细节：
//       · `void` 前缀表示「故意不 await」——这是 fire-and-forget
//       · `.catch(logError)` 必须有，否则未捕获的 Promise rejection
//         在某些 Node 版本会直接 crash 进程
//     把一个异步副作用塞进同步回调里，就是这种形状。'''),

(396, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 15.1 第②层：snip（剪历史）──
// snip 和 microcompact 都可能在同一次迭代里跑，注释明确说「不是互斥的」。
// ═══════════════════════════════════════════════════════════════'''),
(410, 'after', '''// 注：`snipTokensFreed` 这个变量存在的唯一理由是**给下游提供准确的计数**。
//     注释解释得很清楚：tokenCountWithEstimation 读的是受保护的尾部
//     assistant 消息里的 usage，而那条消息在 snip 后原样保留 ——
//     所以它看不到 snip 释放的 token。必须手动把这个数传下去。
//
//     这引出一个普遍问题：**多条压缩路径之间要互相告知「我释放了多少」**。
//     本文件里这个数字的传递链是：
//         snipTokensFreed → autocompact 的阈值判断（行 466）
//                        → 阻塞检查的减法（行 638）
//     两条链都漏了就会误判 —— 要么白白压缩，要么错误地报 prompt too long。
//
//     这也是「五层管线」的实际复杂度来源：不是每一层难，是层间的
//     记账要一致。'''),

(412, 'before', '''// ── 15.2 第③层：microcompact（按 id 删旧结果）──'''),
(426, 'after', '''// 注：`pendingCacheEdits` 是「延迟发边界消息」的机制，行 420-422 的注释：
//     「对带缓存的微压缩（cache editing），边界消息延迟到 API 响应之后，
//       这样能用到真实的 cache_deleted_input_tokens」。
//
//     为什么要用真实值？因为微压缩删了多少 token，客户端只能**估算**。
//     估多了会让用户以为省了很多，估少了会让压缩看起来没用。
//     而 API 会在响应里报 cache_deleted_input_tokens —— 真实数字。
//     所以策略是：先压缩，先发请求，等响应回来再发「删了多少」的通知。
//     具体实现见行 870-892。
//
//     最后一句「整段被 feature() 包住，好让字符串从外部构建里被消除」
//     又是 DCE 的痕迹：连 `'CACHED_MICROCOMPACT'` 这个字符串常量
//     都要保证不进外部 bundle。'''),

(428, 'before', '''// ── 15.3 第④层：contextCollapse（折叠成投影视图）──'''),
(447, 'after', '''// 注：这一段是本文件里最难理解、也最值得理解的设计。逐句拆：
//
//     【Nothing is yielded】
//     折叠**不产生任何消息**。它是「读时投影」—— 每次进入主循环，
//     projectView() 把提交日志重放到完整历史上，得到一个折叠后的视图。
//     所以 UI 看到的历史和模型看到的不一样，而这是故意的。
//
//     【Summary messages live in the collapse store, not the REPL array】
//     摘要存在折叠存储里，不在 REPL 的消息数组里。这意味着
//     「折叠」是可逆的：原始消息还在，只是不参与投影。
//
//     【This is what makes collapses persist across turns】
//     行 436-439 是最关键的一句：折叠能跨轮持久，靠的是
//     projectView() 每次进来都重放提交日志。轮内通过 state.messages
//     往前走（在 continue 站点），下一轮 projectView() 就变成空操作
//     （因为归档的消息已经从输入里消失了）。
//
//     【和 autocompact 的关系】
//     它排在 autocompact **之前**，理由在行 428-431：
//     折叠便宜且保细粒度，如果能压到阈值以下，就不必做整体摘要。
//     这是个明确的优先级：**能不全量摘要就不全量摘要**。
//
//     一句话总结这一层：它不是「删除历史」，而是「改变历史被读到的样子」。'''),

(449, 'after', '''// 注：`asSystemPrompt(appendSystemContext(systemPrompt, systemContext))`
//     两层包装：
//       · appendSystemContext 把动态的 systemContext 拼到静态提示词后面
//       · asSystemPrompt 加一个 brand（品牌类型），让类型系统能区分
//         「已经拼好的系统提示词」和「裸字符串」
//     为什么要 brand？因为系统提示词有严格的拼装顺序要求（见 prompts.ts
//     里那个 boundary marker），用 brand 可以防止有人随手传一个字符串进来。
//
//     注意这个 fullSystemPrompt 只用于**发给 API**（行 661），
//     而 handleStopHooks、autocompact 收到的还是原始的 systemPrompt
//     （未拼 systemContext 的）。这是刻意的：内部逻辑不需要那层动态内容。'''),

(453, 'before', '''// ── 15.4 第⑤层：autocompact（唯一会调模型的一层）──'''),
(468, 'after', '''// 注：注意传给 autocompact 的参数里有个 `forkContextMessages: messagesForQuery`
//     —— 压缩本身是**起一个子代理**去做摘要（fork），这个子代理需要看到
//     完整对话才能写好摘要。
//
//     所以压缩不是「本地算法」，是一次真实的模型调用。这就解释了
//     为什么它排在最后、为什么有连续失败计数（行 536-543）、
//     为什么会有「压缩死亡螺旋」的担心（行 1168-1172）：
//     压缩要花钱、可能失败、失败后重试可能又失败。'''),

(470, 'before', '''// ── 16. autocompact 成功了：10 个埋点字段 + 一处额度补偿 ──'''),
(502, 'after', '''// 注：`tengu_auto_compact_succeeded` 带了 11 个字段，其中 6 个是 token 账目：
//     preCompactTokenCount / postCompactTokenCount / truePostCompactTokenCount
//     / 输入 / 输出 / 缓存读 / 缓存写 / 总计
//
//     为什么要记这么细？因为压缩是这个系统里**最贵的单次操作** ——
//     它要把整个对话（可能 180K token）发一遍，再生成摘要。
//     如果不细记账，就无法回答「压缩到底花了多少钱、省了多少」。
//     `truePostCompactTokenCount` 和 `postCompactTokenCount` 并存，
//     说明一个是从 API 报的、一个是估算的，两个都要留着对比误差。'''),

(504, 'after', '''// 注：这是 taskBudgetRemaining 的第一个补偿点（第二个在行 1135 的反应式压缩）。
//     逻辑：压缩前先量一下「当前上下文窗口有多少 token」，从剩余额度里减掉。
//     这样服务端下次收到 remaining 时，就知道「有这么多已经被摘要掉了」。
//
//     `iterations[-1] is the authoritative final window` —— 注释里提到的
//     iterations 是 API 响应里的字段（服务器端工具循环的迭代记录），
//     取最后一条才是最终窗口。这个细节说明客户端对 API 的响应结构
//     依赖得很深。'''),

(517, 'after', '''// 注：`turnCounter: 0` 重置而不是递增 —— 注释说得很清楚：
//     「每次压缩都重置，好让 turnCounter/turnId 反映**最近一次**压缩」。
//     而 recompactionInfo 在调用前已经捕获了旧值，所以不会丢信息。
//
//     这个字段的用途是「压缩后已经过了几轮」，用于判断
//     「上次压缩后是不是很快就又满了」—— 如果 2 轮就又满了，
//     说明压缩效果不足或上下文增长过快。'''),

(528, 'after', '''// 注：`buildPostCompactMessages` 生成的是「摘要 + 保留的尾部消息」。
//     然后这些消息被**逐条 yield 出去**（行 530-532）——
//     用户会在界面上看到「对话已被压缩」的提示。
//
//     注意这里是 yield 而不是替换后继续：UI 需要知道压缩发生了，
//     否则用户会看到历史突然变短却没有任何解释。
//     紧接着行 535 `messagesForQuery = postCompactMessages` —— 
//     本地变量也换成压缩后的，所以本轮**剩下的部分**用的是新上下文。
//     一个动作同时更新了外部（UI）和内部（本轮输入）。'''),

(545, 'after', '''// 注：`//TODO: no need to set toolUseContext.messages during set-up since it is updated here`
//     —— 作者自己留的 TODO，说的是一个顺序问题：
//     toolUseContext.messages 在初始化时就被设过一次（在调用 query() 之前，
//     别的地方做的），而这里才是真正该同步的位置。
//     结果是「设置两次，前一次没用」，属于历史遗留的冗余。'''),

(551, 'before', '''// ── 17. 本轮产出容器：四个"待填"的数组 ──'''),
(558, 'after', '''// 注：这四个变量是本轮的输出缓冲，各有精确职责：
//
//     assistantMessages  → 模型本轮说的所有消息（含 thinking）
//                          **注意：即使被 withheld 也会 push 进来**（行 827）
//     toolResults        → 工具结果 + attachment（都是 user 角色）
//     toolUseBlocks      → 从 assistantMessages 里抽出来的 tool_use 块
//                          单独存一份，因为下面执行工具要用它
//     needsFollowUp      → **唯一的循环出口判断**
//
//     行 553-556 那段注释是重点：
//     「stop_reason === 'tool_use' 不可靠 —— 它不总是被正确设置。
//       改在流式过程中，每逢 tool_use 块到达就置位 —— 这是唯一的出口信号。」
//
//     这是一个从实践中得来的结论：不要相信 API 的 stop_reason 字段，
//     要自己数有没有 tool_use。如果信了 stop_reason，会出现
//     「模型发了工具但 stop_reason 没标 tool_use」→ 主循环以为结束 →
//     工具永远不执行 → 用户看到模型说「我来读一下文件」然后停住。
//     这类 bug 极难排查，所以作者宁可自己维护一个布尔量。''')
]
