# -*- coding: utf-8 -*-
"""QueryEngine.ts 批注 2/3：submitMessage 前半（准备阶段），含 transcript 时序与两处 context 重建。"""

ANNOTATIONS = [
(213, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 8. 18 个字段的解构：一次把配置全摊开 ──
//
// 为什么在这里全解构，而不是用 `this.config.xxx`？
// 因为下面 950 行里要反复用这些值，而且有大量 `this.` 会淹没视觉重点。
// 解构成裸名后，`this.` 只出现在「改状态」的地方（this.mutableMessages、
// this.permissionDenials）—— 一眼就能分辨「读配置」和「写状态」。
// ═══════════════════════════════════════════════════════════════'''),

(238, 'after', '''// 注：`this.discoveredSkillNames.clear()` 放在最前面 ——
//     这行是行 193-196 那条注释的落点：每轮清空，避免 SDK 模式
//     几百轮之后这个 Set 无限膨胀。
//
//     `setCwd(cwd)` 是个**全局副作用** —— 设置进程级的工作目录。
//     为什么需要它？因为工具实现（BashTool、Read 等）大量使用
//     getCwd() 而不是参数传入。所以每轮开始都要重新对齐，
//     否则并发多会话（SDK 里可能同时跑好几个）会互相踩。
//     ⚠ 注意这也意味着 QueryEngine **不是线程安全的** ——
//     两个引擎的 submitMessage 交错执行时，cwd 会被来回改。
//     在 Node 单线程模型下，「交错」只发生在 await 边界，
//     而工具执行前会重新读 cwd —— 所以实践中能工作，但很脆弱。'''),

(243, 'before', '''// ── 9. 包装 canUseTool：为了收集"被拒了哪些工具" ──'''),
(271, 'after', '''// 注：这个包装只做一件事：把每次「非 allow」的决策记下来，
//     最后塞进 result.permission_denials 报给 SDK 调用方。
//
//     为什么 SDK 需要这个？因为 headless 模式下没人能点「允许」——
//     canUseTool 的实现在 SDK 里通常是「一律 deny」或「按预设规则判断」。
//     如果不报告拒绝记录，调用方只会看到「模型说要读文件，然后什么都没发生」，
//     完全不知道是被权限拦了。这条数据是唯一的诊断线索。
//
//     注意 `result.behavior !== 'allow'` 用的是「不等于 allow」而不是
//     「等于 deny」—— 因为 PermissionResult 的行为是联合类型，
//     除了 allow/deny 可能还有 'ask' 等。用否定判断能覆盖未来新增的行为。
//     这是防御性写法：**枚举白名单用 ===，黑名单用 !==**。
//
//     `sdkCompatToolName(tool.name)` 做了一次名字映射 ——
//     内部工具名可能带前缀或别名，对外要统一。这是边界转换的一部分。'''),

(273, 'before', '''// ── 10. 模型与 thinking 的默认值 ──'''),
(282, 'after', '''// 注：`thinkingConfig` 的三层兜底：
//      ① 调用方显式传了 → 用它
//      ② 没传但 shouldEnableThinkingByDefault() 不返回 false → { type: 'adaptive' }
//      ③ 否则 → { type: 'disabled' }
//
//     注意 ② 的判断是 `!== false` 而不是 `=== true`。
//     区别在于 `undefined`：如果函数返回 undefined，
//     `!== false` 会走 adaptive 分支。也就是「默认开」。
//     这个细节说明作者想让 thinking 默认启用 —— 用 `!== false`
//     能让「返回 undefined 的旧实现」自动获得新行为。
//
//     'adaptive' 是第三种状态（不是 on/off）：让模型自己决定要不要思考。
//     这解释了为什么默认是 adaptive 而不是 enabled ——
//     强制思考会让简单问题变慢变贵。'''),

(284, 'before', '''// ── 11. 系统提示词的三段式拼装 ──'''),
(308, 'after', '''// 注：`fetchSystemPromptParts` 返回三样东西：
//       defaultSystemPrompt → 静态提示词（上一份文件 prompts.ts 的产出）
//       baseUserContext     → 用户上下文（拼在 user 消息前面）
//       systemContext       → 系统上下文（拼在系统提示词后面）
//
//     区分 userContext 和 systemContext 是缓存设计的一部分：
//     userContext 进 **user 消息**（每轮都可能变），
//     systemContext 进 **系统提示词尾部**（在 boundary marker 之后）。
//     两者都不进「可全局缓存的前缀」。
//
//     行 285 那句 `// Narrow once so TS tracks the type through the conditionals below`
//     解释了一个 TypeScript 使用技巧：把 `string | undefined` 收窄成
//     一个局部变量，这样下面多个 if 里都能保持收窄结果。
//     直接在 if 里写 `typeof customSystemPrompt === 'string'`，
//     出了 if 又变回宽类型了。
//
//     行 302-308 把 getCoordinatorUserContext 的结果合并进 userContext。
//     注意它排在 baseUserContext **之后**（展开顺序决定覆盖关系）——
//     协调器模式可以覆盖默认上下文。'''),

(310, 'before', '''// ── 12. 记忆机制提示词：一个"三重门"的注入 ──'''),
(319, 'after', '''// 译：当 SDK 调用方提供了自定义系统提示词**且**设了
//     CLAUDE_COWORK_MEMORY_PATH_OVERRIDE 时，注入记忆机制提示词。
//     这个环境变量是显式的选择加入信号 —— 调用方已经配好了一个
//     记忆目录，需要 Claude 知道怎么用它（调哪个 Write/Edit 工具、
//     MEMORY.md 这个文件名、加载语义）。调用方可以通过
//     appendSystemPrompt 叠加自己的策略文本。
//
// 注：三个条件缺一不可：
//       customPrompt !== undefined     调用方给了自己的提示词
//       hasAutoMemPathOverride()       环境变量设了记忆路径
//       （隐含）loadMemoryPrompt() 能返回内容
//
//     为什么必须「调用方给了自定义提示词」才注入？
//     因为如果用的是默认提示词，loadMemoryPrompt() 已经在
//     fetchSystemPromptParts 内部被调过了（见上一份文件行 495 的
//     systemPromptSection('memory', ...)）。这里注入会造成**重复**。
//
//     也就是说：这个 if 是在处理「默认路径不会走到」的补丁场景 ——
//     用户替换了整个提示词，连带把默认记忆段也替换掉了，
//     但他其实还需要记忆能力。所以要用环境变量显式提醒「我要记忆」。'''),

(321, 'after', '''// 注：三段拼接，顺序决定优先级（靠前的更"基础"）：
//       customPrompt 或 defaultSystemPrompt  → 二选一，不是叠加
//       memoryMechanicsPrompt               → 记忆机制说明
//       appendSystemPrompt                  → 调用方追加的策略
//
//     注意第一项是**替换**而不是追加 —— 这就是「自定义系统提示词」
//     的真实语义：它替换掉整个默认提示词，而不是在后面加一段。
//     很多人会误以为 customSystemPrompt 是「加在默认提示词后面」，
//     实际是「完全接管」。这个歧义在 API 设计上是有代价的，
//     但它让调用方能精确控制（比如只要一个极简的 10 行提示词）。
//
//     `asSystemPrompt([...])` 把数组 brand 成 SystemPrompt 类型。
//     数组形式（而不是单个字符串）是为了保持分段结构 ——
//     下游要按段打 cache_control（见上一份文件行 114 的边界标记）。'''),

(327, 'before', '''// ── 13. 结构化输出的强制钩子 ──'''),
(333, 'after', '''// 注：两个条件：
//       jsonSchema            调用方要求结构化输出
//       hasStructuredOutputTool 工具列表里真的有那个合成工具
//
//     第二个条件为什么必要？因为 jsonSchema 是调用方的要求，
//     而工具是调用方传进来的。如果传了 schema 但没传工具，
//     这个钩子注册了也没用（没有工具可以拦截）。
//     条件齐全才注册，避免注册一个空转的钩子。
//
//     `registerStructuredOutputEnforcement(setAppState, getSessionId())`
//     —— 注意它拿到的是 setAppState 和 sessionId，说明钩子实现
//     需要一个可写的状态和一个身份标识。这是个**全局注册**（不是实例级），
//     所以同一个进程里多次注册可能会叠加 —— 这是潜在风险，
//     但因为有 hasStructuredOutputTool 守门，实际很少触发。'''),

(335, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 14. 第一处 processUserInputContext（注意 setMessages 的注释） ──
//
// 这个对象要建**两次**（行 335 和行 492）。为什么？
// 因为 processUserInput 可能执行斜杠命令，而斜杠命令会改消息数组、
// 改模型。所以第一次建是为了「让命令能执行」，第二次建是为了
// 「反映命令执行后的状态」。
// ═══════════════════════════════════════════════════════════════'''),

(343, 'after', '''// 译：会修改消息数组的斜杠命令（比如 /force-snip）会调用
//     setMessages(fn)。交互模式下这会写回 AppState；
//     print 模式（headless）下我们写回 mutableMessages，
//     这样 query 循环的其余部分（行 389 的 push、行 392 的快照）
//     就能看到结果。下面第二个 processUserInputContext（斜杠命令
//     处理之后）保持空操作 —— 那之后没有别的地方调 setMessages。
//
// 注：这段注释精确到行号（「push at :389, snapshot at :392」），
//     而那两行号指的是**改动前**的版本 —— 现在代码已经移位了。
//     这是个很常见的注释腐坏：行号引用会随着代码改动失效。
//     读到这里不要去找 :389，它已经不在了。
//     （这类问题在本项目的其他注释里也有，比如 query.ts 里
//       "query.ts:1192" 的引用。属于可接受的成本 ——
//       留行号比不留强，因为至少能定位到大致区域。）
//
//     语义上，这个 setMessages 的差别很关键：
//       交互模式：状态在 AppState 里，写回去，UI 会重渲染
//       headless：状态就是 this.mutableMessages，直接改字段
//     同一个接口，两种实现，靠注入不同的闭包来区分 ——
//     这是「同一个类服务两条产品路径」的具体代价。'''),

(351, 'after', '''// 注：`debug: false, // we use stdout, so don't want to clobber it`
//     —— headless 模式下 stdout 是**协议通道**（SDKMessage 往那儿写），
//     如果 debug 日志也往 stdout 写，会把 JSON 流污染掉，调用方解析就崩了。
//
//     这是「CLI 既是程序又是库」的经典矛盾：
//       作为程序：日志打到 stdout 很正常
//       作为库：stdout 必须留给数据，日志只能走 stderr 或文件
//     这里选了后者，代价是 headless 模式的调试信息默认不可见
//     （要 --debug 或看日志文件）。'''),

(359, 'after', '''// 注：`isNonInteractiveSession: true` —— 硬编码 true，不是配置项。
//     因为 QueryEngine 只服务 headless/SDK 路径（行 178 的注释说了
//     REPL 还没接进来）。这个字段会一路传到 prompts.ts 的
//     getIsNonInteractiveSession()，影响提示词里的若干判断
//     （比如「建议用户输入 ! 命令」那条会被跳过）。
//
//     所以这行不只是个标志位 —— 它决定了**整个系统提示词的会话类型分支**。'''),

(397, 'before', '''// ── 15. 孤儿权限：一次会话只处理一次 ──'''),
(408, 'after', '''// 注：孤儿权限是什么？是指「上一次会话结束时有工具调用在等权限批准，
//     但会话被杀了」—— 恢复时这条权限请求还挂着，需要处理掉。
//
//     `!this.hasHandledOrphanedPermission` 保证整个引擎生命周期
//     （不是一个 turn）只处理一次。所以这个 if 之外还置了
//     `this.hasHandledOrphanedPermission = true`（行 399）——
//     注意顺序：**先置位再处理**。
//     如果先处理后置位，处理过程中抛异常就会导致下次重试 ——
//     那是好事还是坏事？这里是选了「不重试」（先置位），
//     说明作者认为这个操作不值得重试（重试可能产生重复消息）。
//
//     `for await (const message of handleOrphanedPermission(...))` ——
//     它也是个生成器，产出的消息直接转发出去。这是本文件里
//     第三个「生成器套生成器」的地方（前两个：yield* normalizeMessage
//     和 yield* engine.submitMessage）。'''),

(410, 'before', '''// ── 16. processUserInput：把用户输入变成消息 ──'''),
(428, 'after', '''// 注：返回五个东西，每个都有用途：
//       messages         → 要 push 进历史的（用户消息 + 附件）
//       shouldQuery      → **要不要调模型**（斜杠命令可能就是纯本地的）
//       allowedTools     → 命令执行后新增的 allow 规则
//       model            → 命令可能改了模型（比如 /model）
//       resultText       → 本地命令的输出文本
//
//     `shouldQuery` 是这里的关键分支点：行 556 的
//     `if (!shouldQuery)` 直接走「本地命令」路径，完全不调 API。
//     所以 /help、/clear 这类命令是**零 API 成本**的 —— 它们不进入
//     query()，只在本函数里处理完就返回 result。
//
//     注意传了 `querySource: 'sdk'` —— 硬编码。这个值会出现在所有
//     遥测事件里，也能从 query.ts 的 `querySource !== 'compact'` 之类
//     判断里区分路径。'''),

(430, 'after', '''// 注：`this.mutableMessages.push(...messagesFromUserInput)` —— 先落历史，
//     再做快照（行 434 的 `const messages = [...this.mutableMessages]`）。
//
//     为什么要快照？因为这个数组要传给多个地方：
//       · recordTranscript(messages)    —— 落盘
//       · query({ messages, ... })      —— 本轮输入
//       · messages.findLast(...)        —— 最后一条结果提取
//     如果都传 this.mutableMessages，中途被改（query 的 for await 里
//     会 push 新消息，见行 716）就会读到变化中的数组。
//     快照把「本轮开始时的历史」固化下来。
//
//     ⚠ 但注意：`messages` 这个局部数组在行 716 也被 push 了
//     （`messages.push(message)`）—— 所以它不是纯快照，而是
//     「本轮累积的消息序列」。真正的语义是：「这一轮要落盘的全部消息」。
//     命名有点误导，实际是 transcript 累积器。'''),

(436, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 17. 全文最值钱的一段注释：为什么要在进入 query 之前落盘 ──
//
// 这段注释记录了一个真实的、能被用户直接感知到的事故：
// 「发完消息立刻点 Stop，然后 --resume 报 No conversation found」。
// 值得完整读完，它是「时序决定可用性」的典型案例。
// ═══════════════════════════════════════════════════════════════'''),

(449, 'after_block', '''// 译：在进入 query 循环**之前**就把用户消息持久化到 transcript。
//     下面的 for-await 只在 ask() yield 出 assistant/user/compact_boundary
//     消息时才调 recordTranscript —— 而那要等 API 响应才开始。
//     如果进程在那之前被杀（比如用户在发送后几秒内在 cowork 里点了 Stop），
//     transcript 里就只剩 queue-operation 条目；getLastSessionLog 会把那些
//     过滤掉、返回 null，于是 --resume 报 "No conversation found"。
//     现在写，就能保证「从用户消息被接受的那一刻起」transcript 就是可恢复的，
//     即使 API 响应永远没回来。
//
//     --bare / SIMPLE：fire-and-forget。脚本化调用不会在请求中途被杀后
//     再 --resume。这个 await 在 SSD 上约 4ms，磁盘竞争下约 30ms ——
//     是模块求值之后最大的一笔可控关键路径开销。transcript 仍然会写
//     （用于事后调试），只是不阻塞。
//
// 注：这段注释值得逐层拆，因为它展示了「一个可用性 bug 如何决定架构时序」。
//
//     【事故链】
//     用户发消息 → 消息进内存 → 发 API 请求（要 5-30 秒）→
//     在这 30 秒内用户点 Stop → 进程被杀 →
//     此时 transcript 里只有 queue-operation（"消息进队列了"），
//     没有真正的 user 消息 → 下次 --resume 找不到任何对话 → 报错。
//
//     【根因】
//     落盘被绑在「yield 出消息」这个事件上，而 yield 要等 API 回来。
//     换句话说：**持久化依赖了一个可能永远不发生的未来事件。**
//
//     【修复】
//     把落盘提前到「消息被接受」这一刻。代价是多一次 IO，
//     收益是「无论之后发生什么，历史都在」。
//
//     【性能权衡：4ms vs 30ms 的取舍】
//     注释给了具体数字：SSD 4ms，磁盘竞争 30ms。
//     这 30ms 是「模块加载之后最大的一笔可控开销」——
//     也就是说，启动路径已经优化到只剩这一项还能动了。
//     所以 --bare 模式（脚本）跳过它：脚本不会中途被杀再恢复，
//     不值得付这 30ms。
//
//     【为什么 --bare 仍然写，只是不 await】
//     "Transcript is still written (for post-hoc debugging); just not blocking."
//     写还是要写（出问题时能查），只是不等它完成。
//     这是「fire-and-forget 但保留副作用」的标准写法。
//
//     一个额外观察：`isEnvTruthy(CLAUDE_CODE_EAGER_FLUSH) ||
//     isEnvTruthy(CLAUDE_CODE_IS_COWORK)` 这个条件在本文件出现了 5 次
//     （行 456、610、844、974、1017、1074）。每次都一样：
//     「如果是 cowork 或要求 eager flush，就额外 flush 一次」。
//     重复 6 次说明它应该被抽成一个函数 —— 没抽大概是因为
//     每次都在 await 上下文里，抽出来要传 async 回调。'''),

(465, 'before', '''// ── 18. 过滤"该回执给调用方"的消息 ──'''),
(474, 'after', '''// 注：三个排除条件，每个都有明确理由（注释写在代码行尾）：
//       !msg.isMeta          → 合成的说明性消息（比如「caveat」提示）
//       !msg.toolUseResult   → 工具结果（会被 query 的流程单独回执）
//       不是可选择的用户消息 → 非用户本人写的（任务通知等）
//     加上一个总是包含的：system + compact_boundary（压缩边界要回执）。
//
//     `replayUserMessages` 决定要不要真的回执（行 474）：
//       开关开着 → 把用户消息原样回放给 SDK（行 735-750 才 yield）
//       开关关着 → 空数组，不回执
//     为什么默认关？因为回执会让 SDK 收到自己刚发出去的消息，
//     有些调用方会因此重复处理。所以做成可选。
//
//     `messageSelector()` 每次调用都 require 一次（有缓存，成本极低）——
//     这就是行 87 那个延迟加载的实际使用点。'''),

(477, 'after', '''// 注：把 allowedTools 写进 AppState 的 alwaysAllowRules.command。
//     注意是**合并**（`...prev.toolPermissionContext.alwaysAllowRules`），
//     不是替换 —— 因为 allowedTools 是「本次输入新增的规则」，
//     之前会话累积的规则要保留。
//
//     为什么用 setAppState 而不是直接改？因为 AppState 是 React 的
//     状态管理（REPL 用来驱动 UI 重渲染），必须走 setter 才能触发更新。
//     在 headless 模式下这个 setter 是调用方传进来的，可能是个
//     真状态容器，也可能是个空实现。
//
//     `if (updated === prev) return prev` 这个模式在行 381、390 也出现 ——
//     这是 React setState 的标准优化：**引用没变就不触发重渲染**。
//     注意行 477 这里**没有**这个判断，因为它是无条件新建对象
//     （每次都要更新 alwaysAllowRules）。'''),

(488, 'after', '''// 注：`modelFromUserInput ?? initialMainLoopModel` —— 斜杠命令
//     （比如 /model opus）可以改模型，改完要反映到后续所有地方。
//
//     这就是为什么下面要重建 context：第一个 context 里
//     `mainLoopModel: initialMainLoopModel`（行 354），
//     已经过期了。第二个 context 用 `mainLoopModel`（行 502）。
//
//     这个「先建 → 跑命令 → 再建」的模式，本质上是**因为没有
//     可变引用**：context 是普通对象，命令改了模型只能通过重构对象传播。
//     如果 context 里有 `model` 的 getter，就不需要重建。
//     代价换来的是「context 是纯数据，好序列化、好测试」。'''),

(490, 'before', '''// ── 19. 第二处 context：为什么 setMessages 变成空操作 ──'''),
(527, 'after', '''// 注：对比第一个 context（行 335），三处不同：
//       ① `messages` 换成新快照（行 493）
//       ② `setMessages: () => {}` —— 变成空操作（行 494）
//       ③ `mainLoopModel` 换成命令执行后的值（行 502）
//
//     其余字段完全一样 —— 也就是说这是一次**几乎全量的重复**。
//     为什么不用 `{ ...processUserInputContext, messages, setMessages, options: {...} }`？
//     因为要改的是 options 内部的字段（mainLoopModel），
//     展开语法要写成三层嵌套（options: {...ctx.options, mainLoopModel}），
//     而 TypeScript 对深层展开的类型推导会失败（丢失精确类型）。
//     所以宁可全量重写一遍。
//
//     这是「类型系统逼出来的重复代码」。代价是改字段要改两处 ——
//     如果哪天给 ProcessUserInputContext 加了必填字段，
//     这里会编译报错（好事），但两边都要补（成本）。
//
//     为什么第二次的 setMessages 是空操作？行 341-343 的注释说了：
//     「那之后没有别的地方调 setMessages」。斜杠命令都处理完了，
//     后面 query() 循环不再需要写回消息数组（它有自己的 state.messages）。'''),

(529, 'before', '''// ── 20. 技能与插件：cache-only 加载 ──'''),
(538, 'after', '''// 译：仅用缓存：headless/SDK/CCR 启动不能因为 ref-tracked 插件
//     而阻塞在网络请求上。CCR 在这之前通过
//     CLAUDE_CODE_SYNC_PLUGIN_INSTALL（headlessPluginInstall）或
//     CLAUDE_CODE_PLUGIN_SEED_DIR 填充缓存；需要最新源码的 SDK
//     调用方可以调 /reload-plugins。
//
// 注：这是一个「启动延迟 vs 数据新鲜度」的取舍，落点是**永远选延迟**。
//     理由很硬：headless 调用方通常有超时（CI、编辑器插件、
//     自动化脚本），启动时卡在网络请求上会让整个调用超时。
//
//     填充缓存的责任被推给了部署方（CCR = Claude Code Remote）：
//     要么用 SYNC_PLUGIN_INSTALL 在启动前同步装，要么用 SEED_DIR
//     预置一个目录。这样运行时只读本地，快且确定。
//
//     `Promise.all` 并行拉两个 —— 它们互不依赖（技能扫描文件系统，
//     插件读缓存目录），所以并行。这也说明两者都不快
//     （如果有一个很快，并行的收益就小）。'''),

(540, 'before', '''// ── 21. system init 消息：SDK 收到的第一条 ──'''),
(554, 'after', '''// 注：`buildSystemInitMessage` 是**握手消息** —— SDK 调用方靠它
//     知道自己连上了什么（有哪些工具、哪些 MCP 服务器、什么模型、
//     什么权限模式、有哪些命令/代理/技能/插件）。
//
//     为什么要在调模型之前发？因为调用方需要在「第一句回复」之前
//     就能渲染 UI（工具列表、可用命令提示）。如果等模型回完再发，
//     用户会先看到空白的输入区。
//
//     注意 `permissionMode: ... as PermissionMode, // TODO: avoid the cast`
//     —— 一个遗留的类型断言。内部模式类型的取值比 SDK 协议多，
//     所以只能强转。这类 cast 是「内外类型不完全对等」的标志，
//     数量是衡量边界泄露程度的指标。
//
//     `headlessProfilerCheckpoint('system_message_yielded')` 记录时序 ——
//     和行 284 的 'before_getSystemPrompt'、行 301 的 'after_getSystemPrompt'、
//     行 529 的 'before_skills_plugins' 一起，构成启动阶段的分段计时。
//     这些 checkpoint 只在 headless 下有意义（要测启动延迟）。'''),

(556, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 22. !shouldQuery：纯本地命令的完整返回路径 ──
//
// 这条路径完全不调 API。但它的代码量不小（80 行），因为要
// 手工把「本地命令产出」转成 SDK 协议消息 —— 三种类型各转一次。
// 这是「绕过主流程」的代价：主流程有的能力（消息规范化、
// 结果包装、计时），这里都要手写一遍。
// ═══════════════════════════════════════════════════════════════'''),

(572, 'after', '''// 注：`stripAnsi(...)` —— 去掉终端颜色码。为什么需要？
//     因为本地命令（比如 /help）的输出可能带颜色（为了终端好看），
//     但 SDK 调用方拿到的是纯文本协议，颜色码会变成乱码。
//
//     这个细节说明「同一个命令服务两种界面」：
//       终端：需要 ANSI 颜色
//       SDK：需要纯文本
//     所以在边界处剥一次。剥的位置很讲究 ——
//     在 yield 给 SDK 之前剥，而不是在产出时就不带颜色，
//     因为终端渲染仍需要它。'''),

(583, 'after', '''// 注：本地命令的输出被包装成**assistant 消息**，而不是专门的
//     「本地命令输出」类型。注释给了两个理由：
//       ① RC（远程控制）会渲染成 assistant 风格的文本，而不是用户气泡
//       ② 移动端和 session-ingress 能解析它
//
//     这是一个「协议兼容性优先」的决定：理论上应该有个专门的
//     SDKLocalCommandOutputMessage 类型，但那样所有客户端都要支持新类型。
//     复用 assistant 类型能立刻兼容所有已有客户端 ——
//     代价是语义上略有偏差（这确实不是模型说的话）。
//
//     这类「借用已有类型以兼容存量消费者」的做法，在协议演进里很常见，
//     代价是未来的维护者会困惑「为什么 assistant 消息里会出现
//     /help 的输出」。'''),

(608, 'after', '''// 注：本地命令路径也要落盘 + flush。这行看起来冗余（前面行 450
//     已经写过一次），但内容不同：这次写的是**执行完命令之后**的状态
//     （包含命令输出）。所以两次写是有意义的。
//
//     这又是一个「同一件事要做多次」的例子 ——
//     本文件里 recordTranscript 出现 5 次（450、609、712、728、730、780、834），
//     每次的时机和参数都不同。这类重复很难消除，因为每次的
//     「写什么内容」都取决于当时的 messages 数组状态。'''),

(618, 'after', '''// 注：注意这个 result 的 `num_turns: messages.length - 1` —— 和正常
//     路径的 `num_turns: turnCount`（行 1141）**完全不同的算法**。
//
//       这里：消息数组长度 - 1（粗略估算）
//       正常路径：turnCount 变量（每收到 user 消息 +1，行 754）
//
//     为什么本地命令路径用消息数？因为它根本没进 query 循环，
//     turnCount 永远是初始值 1，没有意义。所以退化成「用消息数近似轮数」。
//
//     这是个**两个字段同名但语义不同**的情况，SDK 调用方如果
//     依赖 num_turns 做统计，在本地命令路径会得到不同的量级。
//     属于协议设计上的小瑕疵。'''),

(641, 'before', '''// ── 23. 文件历史快照：为 undo 做准备 ──'''),
(655, 'after', '''// 注：在进入 query 之前，给每条用户消息做一次文件历史快照。
//     目的是支持「撤销这一轮的所有文件改动」（Esc Esc 或 /undo）。
//
//     条件 `fileHistoryEnabled() && persistSession` —— 两个都必须：
//       功能开关开着 → 用户要这个能力
//       会话持久化开着 → 快照要落盘才能跨会话恢复
//
//     注意 `void fileHistoryMakeSnapshot(...)` —— fire-and-forget。
//     因为快照只是「备份」，失败不该阻止对话开始。
//     而且它是 IO 密集型（要复制文件），await 会明显拖慢启动。
//
//     参数里传了 `message.uuid` —— 每条用户消息一个快照点，
//     这样撤销可以精确定位到「第几条消息之前的状态」。
//     这也是为什么只给 `selectableUserMessagesFilter` 通过的
//     消息做快照（工具结果、系统通知不需要快照点）。''')
]
