# -*- coding: utf-8 -*-
"""AgentTool/AgentTool.tsx 批注 p1：schema 设计、参数校验、路由决策、系统提示词分支。"""

ANNOTATIONS = [

(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 7 步 · 3/4 —— Agent 工具本体（src/tools/AgentTool/AgentTool.tsx，1,397 行）
//
// 前面两个文件都是"文字"（提示词），这个文件是"机制"。
// 它要回答一个具体问题：**当模型说"派一个 agent 去做这件事"，
// 到底会发生什么？**
//
// 【这个文件的四条并行主线，读的时候别混在一起】
//
//   ① Schema 设计（82-190）
//      参数怎么声明、哪些参数在什么条件下对模型**不可见**。
//      这一段的难点全在 Zod 类型推断和 DCE（死代码消除）的夹缝里。
//
//   ② 派活前的十道检查（239-410）
//      teammate 限制、fork 路由、agent 类型解析、MCP 服务器就绪……
//      全是"能不能派"的判定，任何一条不过就 throw。
//
//   ③ 两套执行路径（686-1262）
//      async：注册任务 → 立刻返回 agentId → 后台跑 → 完成时发通知
//      sync：前台跑 → 用 Promise.race 让它在任意时刻可被"转后台"
//      这是全文最复杂的一段，核心是那个 race 循环。
//
//   ④ 结果如何变成 tool_result 文本（1298-1379）
//      四种状态（teammate / remote / async / completed）各一套话术。
//      别跳过这段 —— 这里藏着"为什么模型派完活会立刻结束轮次"的答案。
//
// 【一句话概括这个工具的特殊性】
// 它是一个"会产生另一个 AI"的工具。所以它的所有设计约束都不是
// 关于计算，而是关于**资源和生命周期**：谁的生命周期绑在谁身上、
// 谁能看见谁、谁死了谁会受影响。
// ═══════════════════════════════════════════════════════════════'''),

(58, 'before', '''// feature() 条件 require 的又一次出现（和 claude.ts、prompts.ts 同款）。
//
// 为什么这里用 require 而不是 import：
//   · import 是静态的，打包器会无条件把 proactive/index.js 打进来
//   · require 被 feature() 三元包住时，bun 能在 feature 为 false 时
//     把整个三元删掉，连带这个 require —— 模块根本不进产物
//
// 注意 as typeof import(...) 这个写法：require 的返回是 any，
// 加类型断言之后才能有完整的类型检查。这是"运行时动态加载 + 编译期静态类型"
// 的桥接写法，在需要 DCE 的地方反复出现。'''),

(63, 'before', '''// 2 秒后显示"可以转后台"的提示。这个数字不是随便定的：
// 短任务（查个文件、跑个 grep）通常 1 秒内结束，2 秒的门槛能把它们
// 全部过滤掉，避免界面闪一下提示又消失。'''),

(65, 'before', '''// ⚠️ 这个变量在**模块加载时**求值，不是在 call() 里。
//
// 作者留了 eslint-disable 并写明理由："Intentional: schema must be defined
// at module load"。
//
// 为什么 schema 必须模块加载期定义？
// 因为第 110 行的 inputSchema 是 lazySchema 包着的 —— 它的**取值**
// 可以推迟，但它依赖的这个布尔值必须在模块初始化时定下来，
// 否则同一次会话里 schema 形状可能变（先有 run_in_background，
// 后来又没了），那模型看到的工具定义就会在会话中途改变 →
// 工具 schema 变化 → 缓存前缀作废。
//
// 【这里体现了一条通用规则】
// 凡是参与"发给 API 的字节"的东西（工具 schema、系统提示词、
// beta header），取值时机必须早且稳定。晚求值 = 可能变 = 可能 bust 缓存。'''),

(70, 'before', '''// 自动转后台：前台 agent 跑满 120 秒还没结束，就自动转到后台，
// 把主线程的控制权还给用户。
//
// 【为什么这件事需要"自动"】
// 想象模型派了一个 agent 去跑全量测试，预计 5 分钟。前台模式下，
// 这 5 分钟里用户**什么都做不了**（输入被锁住），只能按 Esc 取消。
// 而 Esc 会连 agent 一起杀掉 —— 用户为了能用界面，必须放弃正在进行的工作。
//
// 自动转后台解决了这个僵局：跑得久就放手，用户继续用，agent 在后台跑完
// 再通过 task-notification 回报。第 120_000 这个阈值大致对应用户耐心的量级。
//
// 【注意它是 OR 两个来源】
//   环境变量 CLAUDE_AUTO_BACKGROUND_TASKS（手动开）
//   GrowthBook 门 tengu_auto_background_agents（灰度）
// 而且这里**每次调用都重新查**（不像上面的 isBackgroundTasksDisabled 是
// 模块加载期定死）—— 因为"要不要自动转后台"不影响 API 请求的字节，
// 改了也不会 bust 缓存，所以可以宽松求值。'''),

(79, 'before', '''// 这行注释解释了一个很容易被忽略的工程约束：
// "Multi-agent type constants are defined inline inside gated blocks
//  to enable dead code elimination"
//
// 意思是：多智能体相关的**常量**（比如 'teammate_spawned' 这个状态字符串）
// 不能提到顶层，必须写在 feature() 分支内部。
//
// 为什么？因为如果提到顶层：
//   const TEAMMATE_SPAWNED = 'teammate_spawned'
// 那么这个字符串会出现在产物里，即使外面所有用到它的分支都被删了。
// 打包器不敢删一个顶层 const —— 它可能被别的模块引用。
//
// 而写在分支内部，整个分支被删时字符串跟着消失。省下的不是几个字节，
// 而是一整条**代码路径的所有字符串常量**。外部构建里"团队/远程/
// 进程内 teammate"这些功能完全不存在，它们的错误消息、状态名、
// 提示文案全都不该出现在用户下载的包里。'''),

(82, 'before', '''// ─────────────────────────────────────────────────────────────
// 【为什么基础 schema 和完整 schema 要拆开】
//
// baseInputSchema   五个"永远存在"的参数：description / prompt /
//                   subagent_type / model / run_in_background
// fullInputSchema   base + 三个多智能体参数（name / team_name / mode）
//                   + isolation / cwd
//
// 拆开的目的不是复用，而是**后置裁剪**：第 110-125 行会根据开关
// 用 .omit() 把某些参数删掉，让模型**根本看不到**它们。
//
// 【"看不见"比"看见了被拒绝"好得多】
// 假设 run_in_background 一直存在但被禁用，会发生什么：
//   模型看到参数 → 试着用 → 被忽略或报错 → 浪费一轮 → 再试别的办法
// 而如果 .omit() 掉：
//   模型看不到这个参数 → 压根不会想用它 → 零成本
//
// 这是"用 schema 表达能力边界"而不是"用校验表达"。schema 是
// 模型读到的能力清单，改 schema 等于改它的认知。'''),

(104, 'before', '''// ─────────────────────────────────────────────────────────────
// 【全文件最"技术"的一段：为什么用 .omit() 而不是条件展开】
//
// 直觉写法应该是这样：
//   z.object({
//     ...(gate ? { cwd: z.string() } : {}),
//     ...
//   })
// 但作者在第 106-109 行明确否掉了：
//   "Done via .omit() rather than conditional spread inside .extend()
//    because the spread-ternary breaks Zod's type inference
//    (field type collapses to `unknown`)."
//
// 展开三元会让字段类型塌成 unknown。原因在 TypeScript 的类型推断机制：
//   { ...cond ? {a: T} : {}, ... } 的类型是 { a?: T } | {}
// 联合类型里的可选字段，在 z.infer 之后无法被可靠地收窄，
// Zod 只好退化成 unknown。于是后面所有 i.cwd 都失去类型保护。
//
// 而 .omit({ cwd: true }) 返回的是**已知的具体类型**（Omit<..., 'cwd'>），
// 类型系统能精确追踪。代价是要写两遍字段名，收益是全程类型安全。
//
// 【这里有一个通用的取舍可以记下来】
// 类型系统跟不上动态构造时，宁可**写两份静态定义**，
// 也不要让类型退化成 any/unknown。因为 any 会往后传播，
// 而"写两份"的代价只发生在写的时候。'''),

(115, 'before', '''// 【第 115-121 行这段注释，是全文件最细致的推理】
//
// 它在讨论一个问题：GrowthBook 门在 lazySchema 里读，安全吗？
//
// 结论是"可以"，论证方式是**逐个数清楚最坏情况**：
//   分歧窗口 = 一次门翻转 × 每个会话一次（因为读的是
//   _CACHED_MAY_BE_STALE 的磁盘缓存，不是实时值）
//   最坏情况只有两种：
//     · 门中途打开 → schema 显示了个 no-op 参数（forceAsync 会忽略它）
//     · 门中途关闭 → schema 藏了个本来能用的参数（但所有 spawn 仍然
//       走异步，因为 forceAsync 是 memoize 过的）
//   两种都不会 Zod rejection、不会 crash。
//
// 然后对比了被移除的 subagent_type（commit 906da6c723）：
// 那个参数改的是 **required → optional**，这类改变会让已经按旧 schema
// 发出的请求直接 Zod 校验失败。
//
// 【这段注释的价值不在结论，在方法】
// 它示范了怎么评估"配置可能在会话中途变化"的风险：
//   ① 变更窗口有多大（一次门翻转 vs 每个请求）
//   ② 每个窗口内的后果是什么（降级 / 报错 / 崩溃）
//   ③ 哪些变更形态是"可容忍"的（可选参数增删），
//      哪些是"不可容忍"的（必填变可选、类型改变）
//
// 一句话总结：**可选参数的增删可以容忍，必填性的变化不行。**'''),

(126, 'before', '''// ─────────────────────────────────────────────────────────────
// 【为什么要手写一个"比 schema 更宽"的类型】
//
// inputSchema 经过 .omit() 之后，cwd 和 run_in_background 在类型上
// 可能不存在。但 call() 的解构里（第 239-250 行）明明在接这两个字段。
//
// 于是这里手工声明 AgentToolInput = base 类型 + 所有可选字段。
// 注释说得很清楚："Explicit type widens the schema inference to always
// include all optional fields even when .omit() strips them for gating"。
//
// 【这是一种"对外收窄、对内放宽"的双类型策略】
//   对模型（schema）：参数集合随开关变化，最小化认知负担
//   对自己（类型）：永远假定有这些字段，代码不用写 if 分支
//
// 风险是：如果模型真的传了被 omit 掉的参数（不可能，因为它看不见），
// 这里会静默收到 undefined。所以代码里每个可选字段都要能处理 undefined ——
// 实际上它们全都是 `?? 默认值` 或布尔判断，没有一个假设"一定存在"。'''),

(140, 'before', '''// 输出 schema 是四态的联合：
//   completed       同步跑完（有 content）
//   async_launched  已丢到后台（有 agentId + outputFile）
//   teammate_spawned / remote_launched  内部态，**不在这个 schema 里**
//
// 第 159-190 行专门解释了后两个为什么不进来：
//   "Private type for teammate spawn results - excluded from exported
//    schema for dead code elimination"
//
// 【用类型做什么：控制代码裁剪】
// 这两类状态的字符串（'teammate_spawned' / 'remote_launched'）
// 只在开了对应 feature 时才可能存在。如果它们进了导出 schema，
// 那么 z.literal('teammate_spawned') 这个字符串会永久留在产物里，
// 连带它所在的整个判别分支。
//
// 做法是：内部用一个更宽的类型 InternalOutput（第 191 行），
// 出口处用 as unknown as 强转。这样外部构建里这些字面量
// 只出现在被 feature() 删掉的分支里，打包器能一并清除。
//
// 【这和 claude.ts 里 cache_deleted_input_tokens 不进 NonNullableUsage
//  是同一个手法的另一面】
// 那边是"不进类型 → 字符串被 DCE 删掉"，这边也是。
// 说明这个团队把类型系统当成一个**裁剪工具**在用，不只是检查工具。'''),

(196, 'before', '''// buildTool({...}) 是一个 1,190 行的对象字面量（196-1387）。
// 里面每个方法都是可选的，这个工具实现了其中十几个。分组看：
//
//   元信息    name / aliases / searchHint / description /
//             maxResultSizeChars（100K，比一般工具大得多）
//   输入输出  prompt() / inputSchema / outputSchema
//   执行      call()  ← 主体，1,024 行
//   行为声明  isReadOnly() / isConcurrencySafe() / checkPermissions() /
//             toAutoClassifierInput()
//   UI        userFacingName / render* 系列（来自 UI.tsx）
//
// 【先看三个"行为声明"，它们决定了调度器怎么对待这个工具】
//   1264  isReadOnly()        → true
//   1273  isConcurrencySafe() → true
//   1281  checkPermissions()  → 非 auto 模式直接 allow
//
// 这三行合起来意味着：**一个 Agent 工具可以和别的工具并发执行，
// 而且不需要权限确认**。这看起来极其危险，但成立的理由在 1265 行
// 那半句注释："delegates permission checks to its underlying tools"。
// 也就是：真正的风险由子 agent 内部每一次工具调用各自把关。
// 派 agent 这个动作本身不碰文件、不跑命令，所以它是只读的。'''),

(205, 'before', '''// 从工具名反推 MCP 服务器名。命名约定是 mcp__<server>__<tool>，
// 所以 split('__')[1] 就是服务器名。
//
// 这个函数看着不起眼，但它是第 217 行那个过滤的前提：
// 有的 agent 定义里写了 requiredMcpServers（比如"我需要 github 服务器"），
// 如果 github 没连上，这个 agent 就不该出现在清单里 ——
// 否则模型会派一个必然失败的任务。'''),

(217, 'before', '''// 两级过滤，顺序重要：
//   ① filterAgentsByMcpRequirements  按"依赖的 MCP 服务器是否就绪"过滤
//   ② filterDeniedAgents             按权限规则过滤（Agent(name) 语法）
//
// 为什么先 MCP 后权限？
// 因为第 347-353 行要靠这个顺序区分两种失败：
//   · agent 存在但被权限拒绝 → 报"被规则拒绝"，附带规则来源
//   · agent 根本不存在       → 报"没这个 agent"，附可用列表
// 如果先滤权限，被拒的 agent 会从列表里消失，"被拒绝"和"不存在"
// 就分不出来了，用户会收到一条误导性的错误。
//
// 【这是一个通用的错误报告原则】
// 先过滤"客观不可用"（依赖缺失），再过滤"主观不允许"（权限），
// 才能对用户说清楚到底为什么不行。'''),

(221, 'before', '''// 【循环依赖的第二次规避，注释写明了原因】
// "Use inline env check instead of coordinatorModule to avoid circular
//  dependency issues during test module loading."
//
// 注意它说的是**测试期**的模块加载问题。生产环境里 import 可能是通的，
// 但测试框架加载模块的顺序不同，环会以另一种方式爆出来。
//
// 这和 coordinatorMode.ts 第 19-24 行那个"被迫重复"是同一类问题：
//   那边重复了一个两行的布尔判断
//   这边重复了一个三行的布尔表达式
// 共同点：**重复的成本是"两处要保持一致"，而 import 的成本是运行时崩溃**。
// 在这种不对称面前，重复是理性的选择。'''),

(239, 'before', '''// ─────────────────────────────────────────────────────────────
// 【call() 的十道关卡 —— 先给你一张清单】
//
// 后面 170 行几乎全是"能不能派"的判定。顺序不能乱，因为
// 后面的判定依赖前面的结果。按出现顺序：
//
//   252  model 参数在协调者模式下被**强制抹掉**
//   257  rootSetAppState 选择（进程内 teammate 的 setAppState 是 no-op）
//   262  team_name 但团队功能未开放 → 报错
//   269  teammate 试图再建团队 → 报错（roster 是扁平的）
//   278  进程内 teammate 试图开后台 → 报错（生命周期绑在 leader 上）
//   284  同时有 teamName 和 name → 走 spawnTeammate 分支（另一套机制）
//   318  fork 路由决策（三级）
//   332  递归 fork 守卫
//   345  agent 类型解析（找不到 / 被拒绝，两种错误分别报）
//   361  agent 定义里 background:true 且是进程内 teammate → 报错
//   371  requiredMcpServers 就绪检查（含最多 30 秒的等待）
//
// 【为什么 262/272/278 这些检查要放在 call() 里而不是 schema 里】
// 因为它们依赖**运行时的身份**（我是 teammate 吗？我在团队里吗？），
// 而 schema 是模块加载期定的。身份不能在 schema 里表达。
// 所以这类限制只能"看到才知道"，也就只能 throw。
//
// 代价是：模型可能踩到这些错误（因为提示词只能尽量告知）。
// 所以 prompt.ts 第 277-283 行才会按身份改口供 —— 两边配合。'''),

(252, 'before', '''// 【一行代码实现的"强制"，比提示词硬得多】
//
// coordinator 模式下 model 直接置 undefined，模型传什么都被丢掉。
//
// 对应 coordinatorMode.ts 提示词里那句 "Do not set the model parameter.
// Workers need the default model for the substantive tasks you delegate."
//
// 【为什么需要两道】
// 提示词是"建议"，模型可以不遵守（尤其在被大量上下文包围时）。
// 而这一行的效果是：即使模型传了 opus，被派活的 worker 还是用默认模型。
//
// 【为什么"用默认模型"这么重要】
// 协调者派的是"实质任务"（写代码、查 bug、验证）。给 worker 降级到
// haiku 会让质量崩塌；升级到 opus 则是浪费钱。而协调者自己判断
// "这个任务值得用强模型"的可靠性很低 —— 它看不到 worker 要面对的
// 实际代码复杂度。所以这里的选择是：**不让它做这个决定**。
//
// 顺带注意：这个抹除**只对 coordinator 生效**。普通模式下模型可以
// 自由指定 model，因为那时没有 agent 定义里的 model 字段做兜底。'''),

(257, 'before', '''// 【一个不起眼但关键的差异：用哪个 setAppState】
//
// toolUseContext.setAppState      通常就是根 store 的 setter
// toolUseContext.setAppStateForTasks  专门用于"任务注册/进度/kill"
//
// 对**进程内 teammate** 来说，它的 setAppState 是个 no-op（被刻意换掉的），
// 但 setAppStateForTasks 仍然指向根 store。
//
// 如果这里用错：teammate 派出的子 agent 无法注册到根任务表 →
// 在任务面板里看不见 → 也无法通过 TaskStop 杀掉 → 变成孤儿进程，
// 只能等它自己跑完。而且**不报任何错**。
//
// 所以后面所有涉及任务生命周期的调用（registerAsyncAgent /
// updateAsyncAgentProgress / completeAsyncAgent / killAsyncAgent）
// 传的都是 rootSetAppState，而不是 toolUseContext.setAppState。'''),

(266, 'before', '''// 【teammate 不能建团队 —— 因为团队名册是扁平的】
//
// 第 266-268 行的注释把机制讲清楚了：
//   "TeamFile.members is a flat array with one leadAgentId — nested
//    teammates land in the roster with no provenance and confuse the lead."
//
// 数据结构长这样（概念上）：
//   { leadAgentId: 'xxx', members: [a, b, c, ...] }
// 它是**一层**的。如果一个 teammate 再开一个 teammate，
// 新的成员会被塞进同一个 members 数组 —— 于是：
//   · 它不知道自己是"谁派来的"（没有 parent 字段）
//   · leader 看到名册里多了一个没见过的成员
//   · SendMessage 的拓扑关系彻底乱掉
//
// 【这是"数据结构决定能力边界"的典型案例】
// 不是"不想支持嵌套团队"，而是当前的数据模型表达不了。
// 加一个 parentAgentId 字段就能支持，但那会连带改变：
// 名册渲染、消息路由、kill 的级联规则、任务树的展示……
// 所以选择先限制住，把复杂度留到真正需要时再付。'''),

(275, 'before', '''// 【进程内 teammate 不能开后台 agent —— 生命周期绑定问题】
//
// 进程内 teammate（InProcessTeammateTask）是**跑在同一个 Node 进程里**的
// 一个异步任务，它没有自己的进程。所以：
//   · 它的"存活"取决于 leader 的进程还活着
//   · 它开的"后台 agent"如果比它活得久，就失去了宿主
//
// 对比 tmux teammate：那是独立进程，能自己管后台 agent（第 276-277 行注释）。
//
// 【这类"能力差异"的根源是部署形态，不是设计喜好】
// 同一个概念（teammate）有两种实现：
//   进程内 —— 便宜、启动快、共享内存，但生命周期绑定、崩溃互相影响
//   tmux   —— 隔离好、能独立存活，但启动慢、需要终端环境
// 于是所有"能不能开后台/能不能再派活"的规则都得按形态分叉。
//
// 第 361 行还有一个更隐蔽的同型检查：agent 定义里有 background: true
// 也算"要开后台"。那一处必须等 selectedAgent 解析出来才能查，
// 所以它不能和这里合并 —— 两处检查看似重复，实际是不同时机。'''),

(282, 'before', '''// ─────────────────────────────────────────────────────────────
// 【分岔点：spawnTeammate 还是 runAgent】
//
// 条件是 teamName && name 同时存在。
// 这是 CC 里两套多智能体机制的分界线：
//
//   spawnTeammate（282-316）  → 建一个**长期存在、可反复对话**的团队成员
//                               有 name、有 tmux 面板、走 mailbox 通信
//   runAgent（318 之后）      → 派一个**一次性**的子 agent
//                               干完就退出，结果以 tool_result / 通知返回
//
// 用生活化的类比：
//   前者是"招个员工进团队"，后者是"外包一个活"
//
// 【注意返回值的差别】
// teammate 返回 { status: 'teammate_spawned', teammate_id, tmux_pane_id, ... }
// —— 带终端面板信息，因为它要在界面上占一格
// 子 agent 返回 { status: 'async_launched', agentId, outputFile }
// —— 带输出文件，因为它要通过文件查进度
//
// 两套返回值对应两种"怎么观测它"的方式，这也是它们最本质的区别。'''),

(286, 'before', '''// 派 teammate 之前先把这个 agent 定义的颜色登记下来。
//
// 目的很具体：界面上多个 teammate 同时在跑时，靠颜色区分谁是谁。
// 颜色来自 agent 定义的 color 字段（用户可以在 .claude/agents/*.md
// 的 frontmatter 里写）。
//
// 注意它是在 **spawn 之前** 设的，而不是等 spawn 返回。因为
// spawnTeammate 会立刻开始跑并产生输出，颜色晚设就会有一小段
// 输出用默认颜色渲染，视觉上会闪一下。'''),

(318, 'before', '''// ─────────────────────────────────────────────────────────────
// 【fork 路由：三行代码，三种语义】
//
//   subagent_type 有值        → 用指定的类型（显式优先）
//   subagent_type 没值 + 门开 → fork（effectiveType = undefined）
//   subagent_type 没值 + 门关 → general-purpose（兜底）
//
// 【注意 "显式优先" 这条】
// 门开着，模型依然可以通过指定 subagent_type 来要一个**全新的** agent
// 而不是 fork。这个设计很重要 —— fork 不是强制的，它只是默认。
// 想拿到"独立意见"时（比如代码评审），必须能要求一个不继承上下文的新 agent。
//
// 这也是 prompt.ts 里第三个例子（141-153）要专门示范的场景：
// "I'll ask the code-reviewer agent — it won't see my analysis,
//  so it can give an independent read."
//
// 【undefined 被用作一个有意义的值】
// 通常 undefined 表示"没有传"。但这里它被赋予了确定语义：
// "走 fork 路径"。代价是代码里到处要写 isForkPath 判断，
// 收益是不用额外造一个 subagent_type: 'fork' 的魔法字符串
// （虽然 FORK_SUBAGENT_TYPE 常量确实存在，但只用于遥测）。'''),

(324, 'before', '''// ─────────────────────────────────────────────────────────────
// 【递归 fork 守卫 —— 全文件最巧妙的一处判定】
//
// 问题：fork 出来的子 agent，工具池里**仍然有 Agent 工具**。
//
// 为什么不删掉它？
// 因为工具池要字节级一致才能共享 prompt cache（见第 611-616 行注释）。
// 删掉一个工具会让 tools 数组变化 → 缓存前缀作废 → fork 的整个
// 成本优势消失。所以选择"留着工具，但调用时拒绝"。
//
// 【两道判定，主次分明】
//   主：querySource === 'agent:builtin:fork'
//       这个值在 spawn 时写进 context.options，**能扛住自动压缩**
//       （autocompact 会重写 messages，但改不了 options）
//   兜底：isInForkChild(messages) —— 扫历史里有没有 fork 的样板标签
//       只在 querySource 因某条路径没传下来时生效
//
// 【"能扛住压缩"这个性质为什么值钱】
// 这正是前面几个文件反复出现的主题：会话状态在长对话里会被压缩重写。
// 任何"放在 messages 里"的标记都可能在压缩后消失，
// 而任何"放在 options 里"的标记不会。所以关键的身份判定优先用后者。
//
// 【报错信息本身也在教模型】
// "Fork is not available inside a forked worker. Complete your task
//  directly using your tools."
// 不只是说"不行"，还说了"该怎么办"。子 agent 读到这句会转为自己动手，
// 而不是反复重试。'''),

(336, 'before', '''// 非 fork 路径：解析 agent 类型。三次查找：
//   ① 在过滤后的列表里找（可能的子集：allowedAgentTypes + 权限过滤）
//   ② 找不到 → 在**全集**里找一遍，判断是不是"存在但被拒"
//   ③ 都不在 → 报"没有这个类型"，附可用列表
//
// 【第 ② 步这个"回去再找一遍"是必要的】
// 因为过滤后的列表已经丢失了"为什么不在"的信息。
// 不回去查的话，用户配了一条 Agent(code-reviewer) 的 deny 规则，
// 得到的是"Agent type 'code-reviewer' not found. Available agents: ..."
// —— 他会去检查目录、检查拼写，而真正的原因在权限配置里。
//
// 加上第 ② 步，错误变成：
//   "Agent type 'code-reviewer' has been denied by permission rule
//    'Agent(code-reviewer)' from <来源>."
// 直接指到规则和它的出处（哪个 settings 文件）。
//
// 【这是一个"错误消息质量"的投入点】
// 这类代码不影响正确性，只影响排障时间。CC 里这类投入相当多
// （比如 mcp/client.ts 里那条 15 分钟 needs-auth 缓存的提示）。'''),

(365, 'before', '''// let selectedAgent 的副作用：TypeScript 无法跨 if-else 收窄属性类型。
// 所以先把必需字段摘出来存成 const，后面用起来才有类型。
//
// 这是个纯粹的编译器妥协 —— 逻辑上 selectedAgent 到这里必然已赋值，
// 但控制流分析做不到。'''),

(371, 'before', '''// ─────────────────────────────────────────────────────────────
// 【MCP 依赖检查：一个"等 30 秒"的轮询，以及它的早退条件】
//
// agent 定义可以写 requiredMcpServers。检查时有个竞态：
// MCP 服务器是**异步连接**的，模型可能在一个服务器还在 connecting
// 的时候就想派活。直接判失败会误伤（明明 2 秒后就绪了）。
//
// 所以先等：最多 30 秒，每 500ms 查一次。但等待里有个早退条件
// （第 385-388 行）：
//   "if any required server has already failed, no point waiting for
//    other pending servers — the check will fail regardless."
//
// 【这个早退逻辑的价值】
// 假设 agent 依赖三个服务器：两个已经就绪、一个已失败、一个还在连。
// 不早退的话要白等 30 秒，然后报失败。早退后立刻报失败。
// 在"用户已经等了一会儿、界面在转圈"的场景里，30 秒是很长的。
//
// 【第 394 行的注释点破了一个容易搞混的判断】
// "Get servers that actually have tools (meaning they're connected AND
//  authenticated)"
// 也就是：**连上 ≠ 可用**。一个未认证的服务器连接是通的，
// 但 tools 列表是空的。所以判据不能是 "type === 'connected'"，
// 只能是"它的工具出现在 mcp.tools 里了吗"。
//
// 这和 mcp/client.ts 里那条规则呼应：401 不抛异常，而是变成
// needs-auth 状态并塞一个 createMcpAuthTool —— 那种服务器就是
// "连上了但没工具"的典型。'''),

(412, 'before', '''// 登记 agent 颜色。和上面 teammate 分支的 setAgentColor 是同一件事，
// 区别是这里用的是 agent 定义里的 color，而 teammate 那边多了一步
// "从 subagent_type 反查定义"。'''),

(417, 'before', '''// 解析出最终模型，然后打点。注意 resolvedAgentModel 用的是**和 runAgent
// 内部同一套**解析逻辑（getAgentModel），而不是简单取 model 参数。
//
// 为什么遥测要和运行逻辑用同一个函数？
// 因为如果遥测自己算一遍，两处一旦不一致，你会看到"日志说用的 opus，
// 实际跑的是 sonnet"—— 这种数据比没有数据更糟，它会让你得出错误结论。
//
// 【is_resume: false 是硬编码的】
// 这个字段是为 resumeAgent.ts 准备的：那边同样是这个工具的入口，
// 但走的是恢复已有 agent 的路径。同一份遥测 schema 两处填，
// 靠这个字段区分。'''),

(430, 'before', '''// 隔离模式：参数优先，其次 agent 定义。
//
// worktree  = 建一个临时 git worktree，agent 在独立副本里改文件
// remote    = 丢到远程 CCR 环境跑（仅内部构建）
//
// 【worktree 隔离解决的是一个真实冲突】
// 主线程和子 agent 同时改同一个文件 → 谁后写谁赢，且不会报错。
// 有了 worktree，子 agent 在独立目录里改、独立分支上提交，
// 主线程完全不受影响，最后由人决定要不要合并。
//
// 第 643-685 行的清理逻辑对应一句话：
//   **没改动就自动删，有改动就保留并告知路径**。
// 因为"没改动"说明这次隔离白做了（没人需要那些文件），
// 而"有改动"说明它是工作成果，不能删。'''),

(433, 'before', '''// 远程隔离整块包在 "external" === 'ant' 的条件里。
//
// 这是一个**编译期恒假**的条件（外部构建里 'external' 不等于 'ant'），
// 所以整个块会被彻底删掉 —— 连 teleportToRemote 的 import 一起。
//
// 【为什么写成 "external" === 'ant' 而不是 feature('X')】
// 因为这是"构建目标"而不是"功能开关"。构建目标在打包时就是个字面量，
// 不需要 feature() 那套运行时的东西。写成恒假比较的好处是：
//   · 类型检查仍然会跑这段代码（能在内部构建里发现类型错误）
//   · 打包器能确定地删掉（因为是字面量比较，不是函数调用）
//
// 代价是可读性差 —— 第一次看到 "external" === 'ant' 会愣一下。
// CC 里到处用这个写法（claude.ts、prompts.ts、AgentTool 都有），
// 认出来之后就是一回事：**"这段只在内部构建里存在"**。'''),

(483, 'before', '''// ─────────────────────────────────────────────────────────────
// 【系统提示词的两条路：fork 继承，普通自建】
//
//   普通路径（513-541）
//     用 selectedAgent.getSystemPrompt() 生成这个 agent **自己的**提示词，
//     再加环境细节（enhanceSystemPromptWithEnvDetails）。
//     最后发出去的消息是 [user(prompt)] —— 一条干净的用户消息。
//
//   fork 路径（495-512）
//     systemPrompt 用**父进程的**（不是 FORK_AGENT 的）。
//     messages 用 buildForkedMessages() 造：克隆父的完整 assistant 消息
//     + 一堆占位 tool_result + 一句自己的指令。
//
// 【fork 路径最反直觉的地方：子 agent 不换系统提示词】
// 常识上"换个角色就该换提示词"，但 fork 刻意不换。理由只有一个：
// **系统提示词在请求的最前面，换一个字，后面全部缓存作废**。
// fork 的全部价值就是"共享父的缓存"，换提示词等于把这个价值清零。
//
// 代价是子 agent 的系统提示词里写着"你应该 fork 子 agent"，
// 而它自己就是子 agent。这个矛盾没法靠改提示词解决（改了就 bust），
// 只能在**用户消息里**用一段大写的话强行覆盖 ——
// 见 forkSubagent.ts 第 173 行的 "STOP. READ THIS FIRST."。
//
// 【第 496-511 行的两条路说明了一件事】
// 优先用 toolUseContext.renderedSystemPrompt（父进程**已经渲染好**的字符串），
// 只有在它不存在时才重算。注释解释了为什么：
//   "Recomputing may diverge from parent's cached bytes if GrowthBook state
//    changed between parent turn-start and fork spawn."
// 也就是：重算可能得到不一样的字节（GrowthBook 从冷变热），
// 那就不是"同一份提示词"了，缓存照样 bust。所以宁可传字节，不要传"配方"。
//
// 【这条经验很通用】
// 任何"必须字节一致"的东西，都应该传递**渲染结果**而不是**渲染参数**。
// 因为参数的求值时机一旦不同，结果就可能不同。'''),

(513, 'before', '''// 普通路径的系统提示词构建。
//
// 注意 try-catch 只打了 debug 日志、**没有中断执行**（第 535-537 行）。
// 于是 enhancedSystemPrompt 可能是 undefined，后面的 override 会传
// undefined，runAgent 会自己再构建一次。
//
// 【为什么吞掉这个错误】
// 生成系统提示词失败（比如某个 agent 定义的 getSystemPrompt 抛了）
// 不该让整个派活操作失败 —— 子 agent 用一个降级的默认提示词
// 仍然能干活。这类"降级优于失败"的判断在 AgentTool 里反复出现
// （第 1223-1234 行的部分结果返回也是同一思路）。'''),

(542, 'before', '''// metadata 是个"跨函数传递的上下文包"，会被带进：
//   runAgent（决定行为）
//   finalizeAgentTool（组装最终结果）
//   各处 logEvent（遥测）
//   后台转正时的通知（第 978 行）
//
// 【isAsync 的表达式值得记下来】
//   (run_in_background === true || selectedAgent.background === true)
//   && !isBackgroundTasksDisabled
// 两个来源 OR，一个总开关 AND。这个形状在第 548、567 行各出现一次
// （567 还多了三个来源）。三处必须一致，否则会出现
// "metadata 说是异步，但实际同步跑了"这类数据污染。'''),

(551, 'before', '''// 第三次出现同样的内联环境检查（第 223 行、这里，还有后面）。
//
// 【重复三次不抽函数，是有意的】
// 抽成一个 isCoordinator() 会引入 coordinatorModule 的 import，
// 而那个 import 会带进循环依赖。三次重复的代价是"改的时候要改三处"，
// 抽函数的代价是"模块加载可能崩"。
//
// 实际上这三处写的表达式完全一致（连 feature() 的判断都一样），
// 复制粘贴带来的风险被压到很低。'''),

(555, 'before', '''// ─────────────────────────────────────────────────────────────
// 【forceAsync：fork 模式下**所有** spawn 都异步，不只是 fork】
//
// 为什么？为了交互模型统一。
// 如果一部分 spawn 同步（阻塞主线程等结果）、一部分异步（发通知），
// 模型需要掌握两套节奏：
//   同步 → 结果直接在 tool_result 里，可以立刻接着做
//   异步 → 结果晚点到，必须"说完就走"
// 两套混在一起时，模型会在该走的时候等、该等的时候瞎编。
//
// 统一成异步之后，提示词可以把"派完活就结束这一轮"教成唯一节奏。
// 这就是 prompt.ts 里那三个示例（尤其是"用户中途追问"那个）
// 存在的意义 —— 教一套节奏，比教两套省很多事。
//
// 【代价也很明确】
// 明明 3 秒就能返回的查询，现在也要等一个通知轮次。所以这个门
// 只对 fork 实验开，且与 coordinator 模式互斥（coordinator 有自己的节奏）。'''),

(559, 'before', '''// 【assistant 模式（KAIROS）的强制异步，理由完全不同】
//
// 原注释（第 559-565 行）：
//   "Synchronous subagents hold the main loop's turn open until they
//    complete — the daemon's inputQueue backs up, and the first overdue
//    cron catch-up on spawn becomes N serial subagent turns blocking
//    all user input."
//
// 拆开这个因果链：
//   ① assistant 模式是个常驻 daemon，用户随时可能发消息（进 inputQueue）
//   ② 同步子 agent 会占住主循环的一整个 turn
//   ③ 如果一个 cron 任务错过了几次，启动时要"补跑"
//   ④ 补跑时派出的子 agent 是**串行**的（因为每个都同步）
//   ⑤ 结果：用户发消息后要等 N 个子 agent 全部跑完才被处理
//
// 这不是"慢一点"，是**界面完全无响应**。所以这里必须强制异步。
//
// 【和第 555 行的区别】
// 555 是为了**统一交互模型**（教一套节奏）
// 559 是为了**避免输入饥饿**（不改就卡死）
// 同一个开关（forceAsync），两个完全不同的动机。'''),

(568, 'before', '''// ─────────────────────────────────────────────────────────────
// 【worker 的工具池是**独立组装**的，不受父进程限制】
//
// 关键点：worker 用自己的权限模式（selectedAgent.permissionMode，
// 默认 'acceptEdits'）重新跑一遍 assembleToolPool，而不是继承父进程的
// 工具数组。
//
// 【为什么这样是对的】
// 父进程可能处在一个很窄的权限模式里（比如 plan 模式，只能读）。
// 如果 worker 继承这个工具池，那它什么也干不了 —— 派活就失去意义了。
// 每个 agent 定义里写了自己的 permissionMode，应该按它自己的来。
//
// 【第 571-572 行还解释了一个架构妥协】
// "This is computed here so that runAgent doesn't need to import from
//  tools.ts (which would create a circular dependency)."
// 又是循环依赖 —— 这个文件里已经第三次见到了。
// runAgent → tools.ts → tools/AgentTool → runAgent 就成环了。
// 所以把组装动作放在 AgentTool 里，runAgent 只接收现成的数组。
//
// 【注意 fork 路径是例外】
// 第 627 行：fork 用 toolUseContext.options.tools（父的原始数组），
// 不用这个 workerTools。原因见 611-616 行 —— workerTools 是按
// 'bubble' 模式组的，序列化结果和父不同，缓存会在第一个不同的工具处断掉。'''),

(579, 'before', '''// earlyAgentId 在一个很靠前的位置就生成，用途是给 worktree 起 slug
// （agent-<前8位>）。这也是为什么它叫 "early" —— 后面还有正式的
// syncAgentId / asyncAgentId，但那两个要等分支确定。
//
// 【worktree slug 用 agentId 前缀的理由】
// 多个 agent 同时开 worktree 时，slug 必须唯一。用 UUID 前 8 位既短
// 又几乎不冲突，而且**可追溯** —— 看到目录名就知道是哪个 agent 的。'''),

(595, 'before', '''// fork + worktree 的组合有个独特问题：子 agent 继承的上下文里
// 全是**父进程的路径**，但它实际工作在另一个目录。
//
// 所以追加一条 notice（buildWorktreeNotice）：告诉它路径要翻译、
// 文件可能已经过时（父可能改过）、改动只留在 worktree 里。
//
// 【注意 push 的位置很讲究】
// 它被 append 到 promptMessages **最后**，注释说
// "so it appears as the most recent guidance the child sees"。
// 模型对越靠后的指令服从度越高（尤其是和前面内容冲突时）。
// 所以"最需要注意的纠正"要放最后。
//
// 这和 forkSubagent.ts 里那段 "STOP. READ THIS FIRST." 的处理是
// 同一个原理的两种用法：一个放在消息最开头（抢注意力），
// 一个放在消息最末尾（做最后纠正）。'''),

(603, 'before', '''// ─────────────────────────────────────────────────────────────
// 【runAgentParams：传什么、为什么这么传】
//
// 这是 call() 里最需要精读的一段，因为每个字段都有明确的取舍。
//
//   agentDefinition   选定的定义（fork 时是 FORK_AGENT 这个合成定义）
//   promptMessages    fork = 父的完整历史 + 指令；普通 = 一条用户消息
//   isAsync           shouldRunAsync（上面那个五来源 OR）
//   querySource       传给子 agent 的身份标记，**递归 fork 守卫靠它**
//   model             fork 时不传（继承）；普通时传模型解析结果
//   override          fork = 父的系统提示词；普通 = 刚构建的那个
//   availableTools    fork = 父的原始工具数组；普通 = workerTools
//   forkContextMessages  fork 时传父的完整消息（第 630 行）
//   useExactTools     fork 专用（第 632 行）
//   worktreePath      有些情况要绕开 override 让 runAgent 自己建提示词
//
// 【第 618-626 行那个三选一需要单独解释】
//   isForkPath                          → 用父的提示词
//   enhancedSystemPrompt && !worktree && !cwd  → 用刚构建的
//   其他                                → 传 undefined，让 runAgent 自己建
//
// 第三种情况的理由是：有 cwd 覆盖时，系统提示词里的**工作目录信息
// 会变**（要写 worktree 的路径而不是原来的）。而这里构建的
// enhancedSystemPrompt 是在**切 cwd 之前**算的，里面的路径是错的。
// 所以宁可不给，让 runAgent 在 runWithCwdOverride 内部重新构建 ——
// 那时 getCwd() 返回的已经是新路径了。'''),

(638, 'before', '''// 两个辅助闭包，把"要不要切 cwd"和"要不要清 worktree"包起来，
// 让后面 async / sync 两条路径都能复用。
//
// cwdOverridePath 的优先级：显式 cwd 参数 > worktree 路径。
// 因为显式传 cwd 意味着调用方有更具体的意图（KAIROS 模式下会传）。'''),

(643, 'before', '''// ─────────────────────────────────────────────────────────────
// 【worktree 清理的三个分支，每个都防一种"删错"】
//
//   ① hookBased    → 永远保留
//      因为这种 worktree 不是标准 git worktree，无法检测 VCS 变化。
//      "不知道有没有改动"时选择保留 —— 宁可留垃圾，不可删成果。
//
//   ② 无改动       → 删掉，并且清掉 metadata 里的 worktreePath
//      不清 metadata 的话，下次 resume 会指向一个已删除的目录，
//      agent 一启动就报 ENOENT，而且原因很难查。
//
//   ③ 有改动       → 保留，把路径和分支名返回上去
//      返回值会被塞进最终结果的 worktreePath / worktreeBranch 字段，
//      模型和用户都能看到"东西在哪儿"。
//
// 【第 656-658 行那个 worktreeInfo = null 是幂等保护】
// 注释写得很直白："Null out to make idempotent — guards against
// double-call if code between cleanup and end of try throws into catch"
//
// 场景：try 块里先调了一次 cleanup（返回"已删除"），然后后面某行
// 抛异常进 catch，catch 里又调一次 cleanup。第二次会拿到 null，
// 直接返回 {} —— 不会去删一个已经删过的目录（那会报错，
// 而且错误会掩盖真正的异常）。'''),

(686, 'before', '''// ============================================================
// 【从这里开始分两条执行路径，一直到 1262 行】
//
// 建议的读法：**先读完 async 分支（686-764，只有 78 行），再读 sync。**
// async 是"简单情况"，sync 是这个文件全部复杂度的来源。
//
//   async（686-764）
//     注册任务 → void 启动 → 立刻返回 async_launched。78 行搞定。
//
//   sync（765-1262）
//     前台跑，但**随时可以转后台**。所以它必须：
//       · 维护一个 race（下一条消息 vs 转后台信号）
//       · 转后台时把前台迭代器优雅关闭（释放 MCP 连接等）
//       · 用同一个 taskId 在后台继续，且进度不丢
//       · 处理"既没转后台也没跑完"的各种中止情况
//     500 行的复杂度，全部来自"随时可转后台"这一个需求。
//
// 【一个设计判断值得注意】
// 为什么不干脆"所有 agent 都异步"，省掉这 500 行？
// 因为同步有真实的交互价值：模型派一个查文件的 agent，3 秒后
// 拿到结果就能接着干。改成异步的话要多等一个通知轮次（模型说完
// "我去查"→ 结束轮次 → 通知到达 → 新轮次继续），用户看到的是
// 界面停一下。对短任务，这个停顿比等待更烦。
// ═══════════════════════════════════════════════════════════'''),

(688, 'before', '''// 注册异步任务。注意三个细节：
//
// ① setAppState 用的是 rootSetAppState（第 693 行），不是
//    toolUseContext.setAppState —— 理由见第 257 行的批注。
//
// ② 第 694-696 行的注释解释了一个关键决策：
//    "Don't link to parent's abort controller -- background agents
//     should survive when the user presses ESC to cancel the main thread.
//     They are killed explicitly via chat:killAgents."
//    （不链接父的 abort controller —— 后台 agent 应该在用户按 Esc
//      取消主线程时**存活**。它们只能被显式的 kill 命令杀掉。）
//
//    这决定了 Esc 的语义：前台任务被取消，后台任务继续。
//    如果反过来（Esc 杀掉一切），用户想清屏时就会丢掉正在跑的长任务。
//
// ③ registerAsyncAgent 返回的 abortController 是**这个任务自己的**，
//    后面 runAgent 的 override 里传的就是它（第 741 行）。'''),

(700, 'before', '''// name → agentId 的注册表，供 SendMessage({to: name}) 路由。
//
// 【位置很讲究：在 registerAsyncAgent 之后】
// 注释写了 "Post-registerAsyncAgent so we don't leave a stale entry
// if spawn fails"。
// 如果先登记名字、再注册任务，而注册失败（比如资源不足）——
// 名字就永久指向一个不存在的 agent。之后模型用名字发消息，
// 会得到一个"找不到"的错误，但注册表里明明有 —— 极难排查。
//
// 【为什么 sync 路径不登记】
// 注释："Sync agents skipped — coordinator is blocked, so SendMessage
// routing doesn't apply."
// 同步 agent 执行期间，主线程**被完全占住**，不可能同时调 SendMessage。
// 所以登记了也用不上，反而留了个需要清理的表项。'''),

(714, 'before', '''// agentContext 是遥测归因用的上下文包，被 runWithAgentContext 包住整段执行。
//
// 【第 717-719 行那两句注释解释了 parentSessionId 的两种取值】
//   "For subagents from teammates: use team lead's session"
//   "For subagents from main REPL: undefined (no parent session)"
// 也就是说：从 teammate 派出的 agent 挂在**团队领导**的会话下
// （因为 teammate 自己没有独立会话），从主 REPL 派出的则为 undefined。
//
// 这让遥测能画出正确的调用树，而不是把所有子 agent 都挂到一个空洞的
// "主会话"下面。'''),

(728, 'before', '''// ⚠️ 这段注释讲的是 AsyncLocalStorage 的一个微妙性质，值得细读：
//
//   "Workload propagation: handlePromptSubmit wraps the entire turn in
//    runWithWorkload (AsyncLocalStorage). ALS context is captured at
//    invocation time — when this `void` fires — and survives every await
//    inside. No capture/restore needed; the detached closure sees the
//    parent turn's workload automatically, isolated from its finally."
//
// 拆开：
//   ① 父 turn 被 runWithWorkload 包着，ALS 里存着"这次请求的 workload 标记"
//   ② 这里 `void runWithAgentContext(...)` **在这一刻**捕获 ALS 上下文
//   ③ 之后这个游离的闭包（不 await、不等待）里所有 await 都看得见那个标记
//   ④ 而父 turn 的 finally 执行时，会不会影响这个闭包？不会 ——
//      ALS 是**捕获时快照**，不是引用
//
// 【为什么这件事需要专门写注释】
// 因为直觉上"父函数 return 了，它设置的状态应该消失"。ALS 恰恰不是这样。
// 如果不理解这个，你会担心"父 turn 结束后子 agent 的遥测标记会不会丢"，
// 然后写一堆手动的 capture/restore —— 那是多余的。
//
// 【`void` 这个关键字的含义】
// 明确表示"不等这个 promise、也不处理它的 rejection"。
// 这在这里是正确的：异步 agent 的错误由 runAsyncAgentLifecycle 内部
// 自己处理并转成通知，不该冒泡到 tool_result 里。'''),

(753, 'before', '''// canReadOutputFile：调用方有没有能力读那个 output file。
//
// 这个布尔值直接决定返回给模型的 **tool_result 话术**（第 1329 行）：
//   能读  → "如果想看进度可以用 Read 或 bash tail 那个文件"
//   不能读 → "简要告诉用户你派了什么，然后结束这一轮，不要生成其他文本"
//
// 【为什么要分这两种话术】
// 如果调用方是主线程（有 Read / Bash），告诉它可以查进度是合理的 ——
// 它偶尔真需要（用户问"进展如何"）。
// 如果调用方本身是个没有文件读取能力的 agent，那句话就是空头支票，
// 它照着做只会得到权限错误。这时更该说的是"别多话，等通知"。'''),

]
