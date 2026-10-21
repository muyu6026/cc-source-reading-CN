# -*- coding: utf-8 -*-
"""AgentTool/AgentTool.tsx 批注 p2：同步执行 + 随时转后台、行为声明、结果话术。"""

ANNOTATIONS = [

(765, 'before', '''// ============================================================
// 【同步路径：一个"随时可以变成异步"的 while 循环】
//
// 需求一句话说清：前台跑，但用户在等待期间随时可以按"转后台"，
// 那一刻要把控制权还给用户、让 agent 在后台继续，而且**进度不能丢**。
//
// 这个需求的三个技术难点，对应后面三段代码：
//
//   ① 怎么同时等"下一条消息"和"转后台信号"？
//      → Promise.race（第 886 行）。但 race 有个陷阱：
//        同一个 promise 反复 race 会累积回调（第 811 行注释）。
//
//   ② 转后台时怎么把前台那条生成器**优雅关闭**？
//      → agentIterator.return(undefined)（第 918 行）。
//        必须调，否则生成器的 finally 不跑 → MCP 连接泄漏、
//        session hooks 不清、prompt cache 跟踪表不释放。
//
//   ③ 后台怎么从"已经产生的消息"接着跑？
//      → 重放 agentMessages 到新的 tracker（第 922-924 行），
//        然后用同一个 taskId 重新调 runAgent（第 925 行）。
//        注意是**重新调**，不是"继续"——因为原生成器已经被关闭了。
//        所谓"继续"是靠把之前所有消息作为上下文再喂一遍实现的。
// ============================================================'''),

(766, 'before', '''// 同步路径也要一个 agentId。这里从 earlyAgentId 转成 branded type
// （asAgentId），类型系统据此防止把普通字符串当 id 传。
//
// 【branded type 在这个文件里出现多次】
// asAgentId / asSystemPrompt 都是这个模式：运行时是空函数，
// 编译期给字符串打上一个不可伪造的标记类型。作用是防止
// "把 description 传进 agentId 参数"这类低级错误 —— 
// 两个都是 string，普通类型系统区分不了。'''),

(785, 'before', '''// 三层包裹，从外到内：
//   runWithAgentContext   遥测归因（ALS）
//   wrapWithCwd           cwd 覆盖（worktree 或显式 cwd）
//   async 箭头函数         实际执行体
//
// 顺序不能换：cwd 覆盖必须在 agentContext 内部，否则
// 构建系统提示词时 getCwd() 拿到的还是旧路径。'''),

(791, 'before', '''// 先 yield 一条进度消息，把 prompt 带出去。
//
// 用途：界面在 agent 刚开始跑、还没有任何输出的那几秒里，
// 能显示"正在做什么"（prompt 的摘要）。否则用户看到的是一个
// 没有任何信息的转圈。
//
// 注意注释里那句 "prompt only needed on first progress message
// (UI.tsx:624 reads progressMessages[0])" —— 这是**跨文件契约**：
// UI 只读第一条 progress 的 prompt，后面的都传空串（第 1119 行）
// 以避免重复传输这份可能很长的文本。'''),

(808, 'before', '''// 立即注册为"前台任务"。
//
// 为什么前台也要注册成任务？
// 因为这样才能**随时转后台** —— 转后台的本质是"这个任务从
// 前台视图切到后台视图"，前提是它在任务表里已经存在。
// 如果等转的时候才注册，中间会有一段"既不在前台也不在后台"的空窗。
//
// 注释 "so it can be backgrounded at any time" 就是这个意思。'''),

(811, 'before', '''// ⚠️⚠️ 这个变量**必须在循环外**创建。注释说得很清楚，但值得展开：
//
//   "Create the background race promise once outside the loop — otherwise
//    each iteration adds a new .then() reaction to the same pending
//    promise, accumulating callbacks for the lifetime of the agent."
//
// 如果写在循环里（直觉写法）：
//   while (true) {
//     const bg = registration.backgroundSignal.then(...)   // ❌
//     await Promise.race([nextMessage, bg])
//   }
// 会发生什么：
//   · 每轮都新建一个 .then()，挂到**同一个**未完成的 promise 上
//   · 这些回调全都留着，等那个 promise 最终 resolve 时**全部执行**
//   · 一个跑 200 轮的工具调用 agent，就积累 200 个回调
//   · 更要紧的是：每个回调都闭包捕获了当轮的变量 → 内存泄漏
//
// 而且这个泄漏是"静默"的：功能完全正常（第一个回调生效，其余
// 重复执行同样的逻辑但幂等），只是内存慢慢涨。
//
// 【判别方法】
// 在 while 循环里看到 .then() / .catch() / new Promise，先问一句：
// "这个东西每轮都新建，还是应该在外层建一次？"
// 如果它监听的是**循环外产生的事件**，答案就是外层。'''),

(818, 'before', '''// 后台任务被禁用时跳过整个注册。
//
// 于是 foregroundTaskId 是 undefined，backgroundPromise 也是 undefined。
// 后面第 886 行的 race 会走 else 分支（直接 await 下一条消息），
// 而第 897 行的转后台判断永远不会成立 —— 整条"转后台"路径被自然禁用，
// 不需要额外的 if。
//
// 【这是"用 undefined 控制功能可用性"的写法】
// 比到处写 if (!isBackgroundTasksDisabled) 干净，但代价是
// 阅读时必须意识到"这两个变量可能不存在"。'''),

(835, 'before', '''// 三个状态标记，各自防一种重复执行：
//
//   backgroundHintShown  2 秒提示只设一次（setToolJSX 是渲染副作用，
//                        每轮调一次会不停重置界面）
//   wasBackgrounded      finally 里据此跳过清理（后台闭包自己会清）
//   stopForegroundSummarization
//                        前台摘要器的 stop 函数，与后台那份**互相独立**
//
// 【第 839-841 行注释点破了一个容易写错的地方】
//   "Per-scope stop function — NOT shared with the backgrounded closure.
//    idempotent: startAgentSummarization's stop() checks `stopped` flag."
//
// 也就是：前台有一个摘要器，转后台后后台再建一个**新的**摘要器，
// 两个各有自己的 stop。不能用同一个 —— 因为前台的 stop 已经被调用过
// （转后台那一刻），复用会让后台的摘要器立刻被判定为"已停止"。
//
// 这类"作用域绑定"的错误极难发现：功能看起来正常（进度照样更新），
// 只是后台 agent 的摘要**从来不刷新**，用户看到的是停留在转后台那一刻的旧摘要。'''),

(845, 'before', '''// 拿生成器的**手动迭代器**，而不是用 for await。
//
// 为什么？因为 for await 无法"在等待下一条消息的同时做别的事"。
// 手动迭代器可以拆成 next() 和 return() 两个动作：
//   next()    取下一项 —— 用 race 包起来，随时可以不等
//   return()  提前终止 —— 转后台时用来触发 finally
//
// 【这是读这个文件必须理解的一点】
// 后面 500 行全部建立在"我手里有一个可控的迭代器"之上。
// 如果用 for await，转后台的那一刻只能 abort 整个 agent，
// 无法"优雅关闭 + 从已有消息接着跑"。'''),

(852, 'before', '''// onCacheSafeParams 回调：runAgent 会把"这一轮实际发出去的参数"传回来，
// 我们用它启动**摘要器**（把 agent 的长对话压成一句"正在做什么"）。
//
// 为什么叫 CacheSafeParams？
// 因为摘要调用不能破坏 agent 自己的 prompt cache —— 它需要拿到
// 一组"可以安全用于旁路请求"的参数。这个约束在 compact.ts 里
// 也出现过（主路径严禁设 maxOutputTokens 那个例子）。
//
// 注意条件是 summaryTaskId && getSdkAgentProgressSummariesEnabled()：
// 只有 SDK 模式才开摘要。终端界面用另一套（转圈的 activity 描述）。'''),

(867, 'before', '''// 主循环。三个变量在循环外声明，因为它们要在 catch / finally 里被读到：
//   syncAgentError  迭代中是否有非中止类错误
//   wasAborted      是否因中止退出（区分"用户取消"和"程序出错"）
//   worktreeResult  finally 里清理的结果，要并进最终返回值
//
// 【这三个变量的存在本身就是一种信号】
// 如果一段逻辑"必须在异常路径里还能读到状态"，它就很难抽成函数 ——
// 这正是 claude.ts 那个 1,881 行 queryModel 不拆的同一类理由。'''),

(871, 'before', '''// 2 秒后显示后台提示。
//
// 注意条件是 elapsed >= PROGRESS_THRESHOLD_MS 且 !backgroundHintShown。
// 两个条件缺一不可：
//   没有 elapsed 判断 → 一进门就弹提示（短任务会闪）
//   没有 shown 判断   → 每轮都调 setToolJSX，界面不停重置
//
// 还有个隐含条件 toolUseContext.setToolJSX 存在 —— 只有终端 UI 才有
// 这个能力，SDK / 无头模式没有，所以静默跳过。'''),

(883, 'before', '''// ─────────────────────────────────────────────────────────────
// 【race：整个转后台机制的枢纽】
//
// 两个竞争者：
//   nextMessagePromise  下一条消息（可能几毫秒后到，也可能 30 秒后）
//   backgroundPromise  用户按"转后台"的信号（可能永远不来）
//
// 【race 的两个后果，都要处理】
//   ① 消息先到 → raceResult.type === 'message' → 正常处理
//   ② 信号先到 → type === 'background' → 进入转后台流程（897 行）
//
// 【但还有一个不明显的第三态】
// race 结束后，输掉的那个 promise **仍然在跑**。
// 对 nextMessagePromise 来说这没问题（它是迭代器的 next，输掉之后
// 下一轮会再调一次 next —— 需要注意 SDK 的迭代器是否支持重复 next，
// 这里依赖的正是"未完成的 next 会被后续 next 复用"的实现）。
//
// backgroundPromise 输掉之后也仍然 pending，这正是第 811 行
// 那个"只能在循环外建一次"的原因 —— 它注定要被 race 很多次。
//
// 【第 886 行那个 .then(r => ({type:'message', result:r})) 是形状对齐】
// 把迭代器的结果包装成和 backgroundPromise 相同的判别联合，
// 这样 race 的返回值可以直接用 .type 分流，不需要判断两个不同的形状。'''),

(894, 'before', '''// 收到后台信号，但还要**再确认一次**：任务表里这个任务真的被标记为
// backgrounded 了吗？
//
// 【为什么不能直接信信号】
// backgroundSignal 是"有人请求转后台"，而 isBackgrounded 是
// "确实转成功了"。两者之间可能有别的情况（比如转后台过程中
// 任务已经结束了），这时信号是陈旧的，不该按转后台处理。
//
// 第 895-896 行那句注释也在解释类型收窄：
// "foregroundTaskId is guaranteed to be defined if raceResult.type is
//  'background' because backgroundPromise is only defined when
//  foregroundTaskId is defined"
// —— 逻辑上成立，但 TypeScript 看不出来，所以还是加了 && foregroundTaskId。'''),

(913, 'before', '''// ⚠️ 这是整个文件最容易写错的一段。`agentIterator.return(undefined)` 的必要性：
//
// 生成器的 finally 块里有什么？
//   · MCP 连接的释放
//   · session hooks 的清理
//   · prompt cache 跟踪表的摘除
//   · dumpState 的清空
//
// 如果直接丢弃迭代器（不调 return），这是一个**已启动但永不完成**的
// 异步生成器 —— 它的 finally 永远不会跑，上面那些资源全部泄漏。
// 而且因为 agent 还在"跑"，看起来一切正常。
//
// 【为什么要 race 一个 1 秒的 sleep】
// 注释："Timeout prevents blocking if MCP server cleanup hangs."
// MCP 的那个 cleanup 会发 SIGINT 等 100ms、SIGTERM 等 400ms
// （见 mcp/client.ts 的三级信号升级），最坏要 500ms 以上。
// 如果一个服务器卡住不响应，整个转后台操作会被拖住 ——
// 而用户按"转后台"的期望是"立刻"。
// 所以：给它 1 秒，超过就走人（资源让 GC 慢慢收）。
//
// 【.catch(() => {}) 也是必须的】
// race 输了之后那个 return() 的 promise 仍然会 resolve/reject，
// 如果不接住它的 rejection，就是一个 unhandled rejection ——
// 在 Node 里会打警告，某些配置下会直接退出进程。'''),

(919, 'before', '''// 重放已有消息到新的 tracker。
//
// 【这一步为什么必要】
// 转后台后，进度显示（token 数、工具调用次数、当前活动描述）
// 需要接着之前的数字往上加，而不是从 0 开始。
// 新 tracker 是空的，所以要把 agentMessages 一条条喂进去重建。
//
// 【注意这里是"重放消息"而不是"迁移计数器"】
// 重放的好处是不需要知道 tracker 的内部结构 —— 只要
// updateProgressFromMessage 能处理消息，就能重建任意时刻的状态。
// 代价是 O(n)，但 n 是消息数（几十到几百），可接受。
//
// 这也是"用纯函数 + 事件流重建状态"的典型收益：
// 状态可以从头推导，就不需要序列化/反序列化。'''),

(925, 'before', '''// ⚠️ **重新调用** runAgent，而不是"继续"之前的生成器。
//
// 这是理解转后台机制的最后一环。原生成器已经被 return() 关闭了
// （第 918 行），无法恢复。所以后台是这样"接着跑"的：
//
//   ① 把 agentMessages（之前所有消息）作为上下文
//   ② 用同一个 taskId、同一个 abortController
//   ③ 重新调 runAgent —— 它看到的历史就是之前跑出来的全部历史
//   ④ agent 无从得知自己"被转过一次后台"，它只看到一段完整的历史
//
// 【代价：有一小段重复计算】
// runAgent 会重新组装系统提示词、重新序列化工具、可能重发最后一轮请求。
// 因为 prompt cache 还在（历史没变），这部分成本远低于重跑整个任务。
//
// 【收益：实现极简】
// 不需要"从生成器中间恢复"这种复杂机制。生成器是不可恢复的，
// 但**消息历史是可重放的** —— 用可重放的输入重建执行，
// 比给生成器加序列化能力简单得多。
//
// isAsync: true 这一行是必须的 —— 它告诉 runAgent 现在是后台模式
// （影响它是否把流式事件过滤掉、是否推送通知等）。'''),

(951, 'before', '''// finalizeAgentTool 把一堆消息压成一个结果对象：
//   content / totalTokens / totalToolUseCount / totalDurationMs / agentId
//
// 【它是"消息流 → 结果"的唯一转换点】
// 同步路径（第 1235 行）也调它。两条路径用同一个收尾函数，
// 保证"同一个 agent 无论前台跑完还是后台转正，结果形状一致"。'''),

(953, 'before', '''// ⚠️ 顺序要求：**先标完成，再做清理**。注释点了 issue 号（gh-20236）：
//
//   "Mark task completed FIRST so TaskOutput(block=true) unblocks
//    immediately. classifyHandoffIfNeeded and cleanupWorktreeIfNeeded
//    can hang — they must not gate the status transition."
//
// 场景：agent 跑完了，代码开始做两件可能很慢的事：
//   · classifyHandoffIfNeeded  一次额外的模型调用（判断"是不是该交接给别的 agent"）
//   · cleanupWorktreeIfNeeded  要跑 git status 检查有没有改动
// 如果先做这两件事再标完成，那么 `TaskOutput(block=true)` 的调用方
// 会一直阻塞 —— 它认为任务还没结束。
//
// 而 git 在一个巨大的仓库里跑 status 可能几十秒；classify 是一次
// 完整的 API 调用（5-10 秒，还可能被限流）。
//
// 【一条通用的时序原则】
// **状态转换要尽可能早，副作用要尽可能晚。**
// 因为状态转换的消费者（等待方）关心的是"能不能走了"，
// 而副作用（清理、遥测、分类）都不该成为别人的阻塞原因。
//
// 这个原则在本项目里出现过多次：QueryEngine 里"assistant 消息不能
// await"、mcp/client 里"先 reject pending 再清理缓存"。
// 都是同一个形状：**别让慢操作夹在状态和观察者之间。**'''),

(976, 'before', '''// 先清 worktree 再发通知，因为通知里要带上 worktree 路径。
//
// 这个顺序反过来不行：通知先发出去，模型和用户就收到了"完成了"，
// 但那时还不知道文件在哪个 worktree 里 —— 后面补一条消息说明
// 会让交互变啰嗦，而且模型可能已经基于"没有 worktree"的前提行动了。'''),

(992, 'before', '''// 后台执行的三路错误处理，形状很统一：
//
//   AbortError → killAsyncAgent + 上报 **部分结果**
//   其他错误    → failAsyncAgent + 上报错误
//   finally    → 停摘要器 + 清 skills + 清 dumpState
//
// 【AbortError 为什么要给部分结果】
// 用户按 Esc 取消一个跑了一半的 agent，他不是想"什么都没有"，
// 而是想"停下来，把你已经得到的告诉我"。
// extractPartialResult 就是在已有消息里找出最后一条实质内容。
//
// 【注意第 994-995 行又重复了那个顺序原则】
//   "Transition status BEFORE worktree cleanup so TaskOutput unblocks
//    even if git hangs (gh-20236)."
// 同一个 bug 的两条路径（这里的 catch、上面的 try）都要单独修 ——
// 因为它们是两段独立的代码。这也是"复制粘贴的清理逻辑"的典型代价。'''),

(1030, 'before', '''// finally 里只做三件**不会失败、也不需要等待**的事：
//   stopBackgroundedSummarization?.()   停摘要器（有 stopped 标记，幂等）
//   clearInvokedSkillsForAgent          清技能表（纯内存操作）
//   clearDumpState                      清 dump 表（纯内存操作）
//
// 【worktree 清理被刻意排除在外】
// 第 1034-1035 行注释："worktree cleanup is done before
// enqueueAgentNotification in both try and catch paths so we can
// include worktree info"
//
// 也就是：清理工作必须在通知之前做（要带路径），而 finally 在通知之后。
// 所以它不能放进 finally —— 这是被顺序要求逼出来的结构，
// 代价是 try 和 catch 里各写一遍（重复），收益是通知里的信息完整。'''),

(1039, 'before', '''// 立刻返回 async_launched，不等后台那坨异步逻辑。
//
// 【这里有一个容易忽略的语义】
// 返回的是"已启动"，不是"已完成"。tool_result 里的文本会告诉模型
// "agent 在后台工作，完成时你会收到通知"（第 1328 行）。
//
// 而此刻后台闭包可能一行都还没跑（`void` 是立即返回的）。
// 所以"启动成功"和"真的在跑"之间有时间差 —— 这个差在正常情况下
// 是微秒级，但如果事件循环被占住（比如同时有 5 个 agent 在起），
// 可能到几十毫秒。不需要处理，但理解这一点有助于看懂日志顺序。'''),

(1055, 'before', '''// 「这不应该发生」的分支。
//
// 正常情况下 race 只会产出 'message' 或 'background' 两种，
// 而 'background' 已经在上面处理并 return 了。走到这里说明
// raceResult.type 不是 'message' 且上面的 if 没进去（比如
// 任务表里查不到 foregroundTaskId 对应的任务）—— 直接 continue
// 而不是抛错，是为了"宁可多转一圈也不要因为状态不一致而崩掉"。'''),

(1067, 'before', '''// 每收到一条消息就更新两处进度：
//   syncTracker               本地累加（最终结果要用）
//   emitTaskProgress          推给 VS Code 子 agent 面板 / SDK 消费者
//
// 第 1073-1078 行有个条件更新：只有开了 SDK 摘要时才把进度写回
// AppState（第 1077 行）。因为 updateAgentSummary 读的是 AppState 里的
// 计数，不写回去它就会一直显示 0 token / 0 工具调用。
//
// 【注释写得很直白】
// "Keep AppState task.progress in sync when SDK summaries are enabled,
//  so updateAgentSummary reads correct token/tool counts instead of zeros."
// 这又是一个"两条实现路径漏同步副作用"的例子 —— 和 autoCompact 里
// 忘了调 notifyCompaction 导致 20% 缓存告警误报是同一类问题。'''),

(1082, 'before', '''// 把子 agent 的 bash_progress / powershell_progress 事件**转发**给父级。
//
// 【为什么需要手动转发】
// 子 agent 的流式事件在 runAgent 里被过滤掉了（第 1095-1096 行注释：
// "Subagent streaming events are filtered out in runAgent.ts"）。
// 被过滤的原因是：子 agent 的逐 token 流式对父级界面毫无意义
// （父级显示的是"agent 正在跑"，不是它的每个 token）。
//
// 但 bash 进度是例外 —— 它代表"这条命令跑了多久"，是**有信息量**的。
// 所以单独把它捞出来转发，让父级界面能显示 "running tests... 45s"。
//
// 【过滤的粒度是"事件类型"，不是"消息来源"】
// 这是一个挺细的设计：同样是子 agent 的事件，thinking delta 丢弃、
// bash_progress 转发。判据是"父级界面会不会用它"。'''),

(1094, 'before', '''// 在转圈里累加 token 数。
//
// 因为流式事件被过滤了（上一条批注），父级拿不到 usage 增量，
// 只能在这里用**内容长度**估算：getAssistantMessageContentLength。
//
// 注释："Subagent streaming events are filtered out in runAgent.ts,
//  so we need to count tokens from completed messages here"
//
// 【这是一个精度换简洁的取舍】
// 内容长度不等于 token 数（英文约 4 字符/token，中文约 1-2 字符/token），
// 所以转圈里显示的数字是**近似值**。
//
// 真正的精确值在 finalizeAgentTool 里（从 API usage 拿）。
// 所以：转圈用估算（要的是"在动"的感觉），最终结果用精确值（要的是准）。'''),

(1205, 'before', '''// ─────────────────────────────────────────────────────────────
// 【try 块之后的三个收尾判断，每个都在处理一种"非正常结束"】
//
//   1207  最后一条消息是 synthetic（合成的）→ 判定为中止 → throw AbortError
//   1223  迭代过程有错、但有 assistant 消息 → 带病返回部分结果
//   1235  正常路径 → finalizeAgentTool
//
// 【第 1207-1218 行的判断依据很巧妙】
// 不靠 wasAborted 标志，而是**看最后一条消息是不是合成的**。
//
// 为什么？因为用户按 Esc 时，框架会插入一条合成的 user 消息
// （内容类似 "[Request interrupted by user]"）。这是唯一可靠的信号：
// 它出现在消息流里，而 wasAborted 只在我们自己 throw AbortError 时
// 才会被设上 —— 但 Esc 走的是**另一条路径**（abortController），
// 未必要经过我们的 catch。
//
// 【findLast 的那个过滤条件也在说明问题】
//   _.type !== 'system' && _.type !== 'progress'
// 因为它要的是"最后一条实质消息"，而 system / progress 是噪音。
// 如果最后一条是 system，说明 agent 跑到了收尾阶段，不该判为中止。'''),

(1220, 'before', '''// 【带病返回：有部分结果就交，没有才抛】
//
// 注释："This allows the parent agent to see partial progress even after
// an error."
//
// 判据是 hasAssistantMessages —— 只要有**一条** assistant 消息，
// 就说明 agent 真的干了点什么，那些内容对父级有价值。
// 一条都没有 → 纯粹的错误，抛出去让工具框架统一处理。
//
// 【这个取舍的风险】
// 父级拿到的结果可能"看起来正常但其实是半截"。
// 所以 finalizeAgentTool 生成的内容里会带 agentId / usage，
// 父级可以据此判断"工具调用次数这么少，可能没干完"。
// 但这依赖模型自己警觉 —— 是个软约束。'''),

(1264, 'before', '''// ─────────────────────────────────────────────────────────────
// 【三行行为声明，决定了调度器怎么对待这个工具】
//
// isReadOnly() → true
//   注释只有半句："delegates permission checks to its underlying tools"
//   意思是：**派 agent 这个动作**不碰文件、不跑命令，所以它本身是只读的。
//   真正的读写发生在子 agent 内部，那里每一次工具调用各自过权限。
//
//   这个声明正确的三个前提：
//     ① 权限检查真的在子 agent 内部做了（是的，workerTools 带权限上下文）
//     ② 派活本身不产生副作用（是的，只创建任务）
//     ③ 只读声明不会被用来跳过什么关键检查（plan 模式下会——
//        但 plan 模式的子 agent 本来也拿不到写工具）
//
// isConcurrencySafe() → true（第 1273 行）
//   允许多个 Agent 调用**同时**执行。这依赖上一条：既然只读，就没有
//   写冲突。而且它是"并行派活"这个核心用法的前提 ——
//   coordinator 提示词里那句 "Parallelism is your superpower" 能成立，
//   靠的就是这一行返回 true。
//
//   ⚠️ 注意这里的并发安全只管**派活动作**，不管子 agent 之间会不会
//   冲突。两个 worker 同时改同一批文件时，谁也不会拦你 ——
//   那是协调者提示词的职责（"写重任务一次一个"），不是调度器的。'''),

(1267, 'before', '''// toAutoClassifierInput：把工具参数压成一段文本，喂给"自动审批分类器"。
//
// 【为什么需要这个函数】
// auto 模式下，权限请求不直接弹给用户，而是先问一个模型
// "这个操作安全吗"。那个模型需要一段**紧凑的输入**，
// 而不是完整的 JSON（prompt 可能几千字）。
//
// 这里的策略是：把 subagent_type 和 mode 两个"身份标签"放在前面，
// 然后是 prompt 全文。因为分类器要判断的正是"这个 agent 要干什么"。
//
// 注意 checkPermissions（第 1281 行）只在 auto 模式才 passthrough，
// 其他模式直接 allow —— 也就是说这个函数在绝大多数会话里用不到。
// 但 auto 模式正是"用户不想被弹窗打断"的场景，这时分类质量最重要。'''),

(1281, 'before', '''// 权限检查：**非 auto 模式直接放行**。
//
// 理由：子 agent 内部的每次工具调用都会各自过权限，
// 在这里再拦一次是重复的（而且会弹两次确认）。
//
// auto 模式例外 —— 返回 'passthrough'，交给分类器判断。
// 因为 auto 模式的语义是"你觉得安全就直接做"，而"派一个 agent
// 去做某件事"是个足够大的动作，值得让分类器看一眼 prompt。
//
// 【"external" === 'ant' 那一层是构建期开关】
// 外部构建里 auto 模式的分类器逻辑根本不存在，整个 if 被删掉，
// 于是函数体只剩 return allow。这也解释了为什么这个条件要写在这里
// 而不是在 mode 判断里 —— 它要能删掉**整块**代码。'''),

(1298, 'before', '''// ─────────────────────────────────────────────────────────────
// 【结果 → tool_result 文本：四种状态，四套话术】
//
// 这是全文件最被低估的一段。它决定了模型看到什么、进而决定
// 模型下一步做什么。四种状态：
//
//   teammate_spawned  "已生成，会通过 mailbox 收指令"
//   remote_launched   "已在远程启动，完成会通知你"
//   async_launched    "已启动，完成会通知你" +（能不能读输出文件）
//   completed         实际内容 + agentId + <usage>
//
// 【话术里藏着行为约束】
// 注意 async_launched 那段（1328-1329）：如果调用方**不能**读输出文件，
// 话术是"Do not generate any other text — agent results will arrive in
// a subsequent message."
//
// 这已经不是信息传递了，是**行为指令**。它出现在 tool_result 里而不是
// 系统提示词里，因为只有在"刚刚派了个 agent"这个时刻才需要它。
// 系统提示词里说一遍会让每次都读到，而这里说只在需要时说。
//
// 【这个模式值得记：把"时机相关的指令"放进 tool_result】
// 系统提示词 = 恒定的规则
// tool_result = 针对这一次结果的指令
// 后者更精准，而且不占系统提示词的缓存空间。'''),

(1327, 'before', '''// async_launched 的两种话术，分界在 canReadOutputFile。
//
// 【能读时】给出 output_file 路径 + 三种处置建议：
//   "Do not duplicate this agent's work — avoid working with the same
//    files or topics it is using."
//   （别重复它的工作 —— 避开它在用的文件和话题。）
//   这条针对的是一个真实浪费：模型派了个 agent 去重构 auth，
//   然后自己也开始改 auth，两边互相覆盖。
//
//   "Work on non-overlapping tasks, or briefly tell the user what you
//    launched and end your response."
//   给出两个合法选项：干别的，或者说一句就结束。
//
// 【不能读时】只剩一条：说一句就结束，不要生成别的文本。
// 因为如果它想说"我去看看进展"，又没有 Read / Bash，那句话是空头支票。
//
// 【第 1328 行那句插在括号里的话很有意思】
//   "agentId: xxx (internal ID - do not mention to user. Use SendMessage
//    with to: 'xxx' to continue this agent.)"
// —— 同一个值，明确区分"内部可用"和"不许对用户说"。
// 因为 agentId 对用户毫无意义（一串 UUID），说出来只会让界面变吵。'''),

(1340, 'before', '''// completed 状态：实际内容 + 一段 trailer（尾部元信息）。
//
// trailer 里有三样：agentId（可用于续用）、totalTokens、toolUses、
// durationMs。三者都是给模型判断"这次派活值不值"的线索。
//
// 第 1342 行还有 worktree 信息（如果有），因为那些文件需要人去处理。'''),

(1343, 'before', '''// ⚠️ 这个分支处理一个很容易被忽略的情况：**子 agent 什么都没说**。
//
// 注释（1343-1346 行）：
//   "If the subagent completes with no content, the tool_result is just the
//    agentId/usage trailer below — a metadata-only block at the prompt tail.
//    Some models read that as 'nothing to act on' and end their turn
//    immediately. Say so explicitly so the parent has something to react to."
//
// 场景：子 agent 跑完了，但最后一条消息是空的（干完了但没总结）。
// 于是 tool_result 里只剩下 agentId 和 usage —— 一堆元数据，没有内容。
// 模型看到这个会想："这没什么可回应的"，然后**直接结束轮次**，
// 用户就看到界面莫名其妙停住了。
//
// 解法：显式塞一句 "(Subagent completed but returned no output.)"
// 这不是给人看的，是给模型一个"可回应的对象"。
//
// 【这类修复的共同特征】
// 问题不在逻辑错误，而在**协议的语用层**：同样的数据，
// 有内容时模型知道该干什么，只有元数据时模型不知道该干什么。
// 加一句话就解决了 —— 但你得先意识到"空结果"是一种独立的失败模式。'''),

(1351, 'before', '''// ⚠️ 全文件最"商业化"的一处优化，注释里的数字非常具体：
//
//   "One-shot built-ins (Explore, Plan) are never continued via SendMessage
//    — the agentId hint and <usage> block are dead weight
//    (~135 chars × 34M Explore runs/week ≈ 1-2 Gtok/week).
//    Telemetry doesn't parse this block (it uses logEvent in
//    finalizeAgentTool), so dropping is safe."
//
// 拆解：
//   · Explore / Plan 是**一次性**内置 agent，永远不会被续用
//   · 所以"用 SendMessage 可以继续这个 agent"的提示对它们是纯废话
//   · 这段废话约 135 字符
//   · Explore 每周跑 3,400 万次
//   · 135 × 34M ≈ 每周 1-2 G（十亿）token
//
// 于是加一个判断把它们省掉。这不是微优化 ——
// 每周十亿 token 的量级，按输入 token 计价是实打实的成本。
//
// 【三个必要条件，缺一不可】
//   ① 这些 agent 确实不会被续用（产品保证）
//   ② 遥测不依赖这段文本（遥测走 logEvent，不解析 tool_result）
//   ③ agentType 可能缺失（resume 老会话时没有这个字段）→ 有条件判断
//
// 【其中第 ② 条最容易被忽略】
// 如果遥测是靠正则解析 tool_result 里的 <usage> 块，这个优化就会
// 悄悄搞坏数据管道 —— 而且报错会在完全无关的地方出现。
// 所以注释专门写了 "Telemetry doesn't parse this block" ——
// 这是在为这个优化做**可删除性论证**。'''),

(1375, 'before', '''// data satisfies never —— 穷尽性检查。
//
// 如果将来给 Output 联合加了第五种 status 而忘了在这里处理，
// 这一行会编译失败。TypeScript 的 satisfies never 意思是
// "到这里 data 的类型应该是 never（所有分支都处理完了）"。
//
// 这比 default: throw 好，因为 default 会吞掉新状态（运行时才炸），
// 而 satisfies never 在编译期就拦住。'''),

(1388, 'before', '''// ─────────────────────────────────────────────────────────────
// 【团队名的来源：参数优先，其次上下文】
//
// team_name 参数显式给了就用它；没给就从 appState.teamContext 取
// （也就是"当前会话已经在某个团队里"）。
//
// 【第一行的短路很关键】
//   if (!isAgentSwarmsEnabled()) return undefined
// 团队功能没开时，永远返回 undefined —— 于是第 284 行那个
// "teamName && name" 的判断恒假，整个 spawnTeammate 分支不会进入。
//
// 注意这和上面第 262 行的检查是两道：
//   262  用户显式传了 team_name 但功能没开 → **报错**（明确告知）
//   1395 只是从上下文继承 → **静默返回 undefined**（不打扰）
//
// 【为什么区别对待】
// 显式传参表示"我知道我要什么"，那是能力缺失，必须告知；
// 隐式继承表示"环境里碰巧有"，此时降级成普通子 agent 是最合理的。
// 同一个"功能不可用"，两种处理 —— 判据是**用户的意图是否明确**。'''),

]
