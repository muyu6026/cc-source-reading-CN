# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  tools/StreamingToolExecutor：一边流式收工具调用，一边就开始执行
// ═══════════════════════════════════════════════════════════════
//
//  它和 toolOrchestration 的区别是**时机**：
//
//      toolOrchestration        等模型把整条消息吐完，再开始跑工具
//      StreamingToolExecutor    模型还在吐，第一个工具就已经开始跑了
//
//  收益是「省掉一次完整的模型输出时间」—— 模型输出 2000 token 可能要十几秒，
//  而第一个工具调用在第 200 个 token 就出现了。
//
//  代价是复杂度全压在「状态机」上：四个状态、四个取消原因、按序输出。'''),

    (34, 'before', '''// 【三条规则写在类注释里，第三条最难】
//
//      并发安全的工具可以互相并行
//      非并发工具必须独占（不能有任何别的工具在跑）
//      结果按「工具被接收的顺序」输出，不是按完成顺序
//
//  第三条是核心。模型吐出的顺序是 [A, B]，但 B 可能先跑完。
//  如果按完成顺序输出，模型看到的是 [B, A] —— 而 tool_result 的顺序
//  必须和 tool_use 的顺序一致，否则 API 直接 400。
//
//  所以内部一定有个「缓冲 + 按序放行」的机制，见第 453 行。'''),

    (45, 'before', '''// 【siblingAbortController：一个只管兄弟、不管自己的中断器】
//
//  原注释把边界划得很清楚：
//
//      Fires when a Bash tool errors so sibling subprocesses die immediately
//      instead of running to completion.
//      Aborting this does NOT abort the parent — query.ts won't end the turn.
//
//  意思是：一个工具报错时，同时跑的其他工具要立刻停（否则白跑、
//  还可能产生副作用），但**整个回合不能结束** —— 模型还要看到错误、
//  还要继续对话。
//
//  这是一个「局部取消」的典型实现：从父 controller 派生一个子 controller，
//  子可以独立 abort，父不受影响。反过来父 abort 会级联到子。
//
//  判据：需要「只取消其中一部分」时，从父派生而不是新建一个无关的。'''),

    (69, 'before', '''// 【discard：流式降级时把这一批全部作废】
//
//  注释说清了两种处理：
//
//      Queued tools won't start        排队的直接不跑了
//      in-progress tools will receive synthetic errors   跑着的收到合成错误
//
//  为什么要合成错误而不是「静默丢弃」？因为每个 tool_use 都**必须**有一个
//  对应的 tool_result，否则下一次请求就是 400（tool_use 没有配对的 result）。
//
//  所以「取消」在协议层面不是一个动作，而是「补一条失败的结果」。
//  这也是 getAbortReason + createSyntheticErrorMessage 存在的理由。'''),

    (129, 'before', '''// 【canExecuteTool：四行，但完整表达了并发规则】
//
//      executingTools.length === 0                                    → 可以跑
//      isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe) → 可以跑
//
//  拆开看是两种情况：
//
//      1. 现在没有任何工具在跑        → 谁都可以开始
//      2. 我要跑的是并发安全的，而且**所有**在跑的都是并发安全的 → 可以
//
//  第 2 条里那个 every 是关键：只要有一个非并发工具在跑，新的并发工具
//  也得等。因为「非并发」的意思是「我要独占」，它不允许任何东西和它并行。
//
//  注意这里没有「队列」这个概念 —— 它是个纯判断函数，由 processQueue
//  在每次状态变化后重新评估。**声明式判断 + 循环重试，比手写状态迁移可靠。**'''),

    (140, 'before', '''// 【processQueue 是串行的，那并发从哪来？答案在 addTool 的 void】
//
//  先看这个循环：它 `await this.executeTool(tool)` —— 也就是**一个 pass 里
//  工具是一个接一个跑的**。单看这段会以为根本没有并发。
//
//  并发出现在第 123 行：
//
//      addTool(...) { ...; void this.processQueue() }
//
//  每个新工具到达都会**踢一次独立的 pass**，而且不等它。于是：
//
//      工具1 到达 → pass A 开始跑工具1（在这里 await 住）
//      工具2 到达 → pass B 开始；此时工具1 status='executing'，
//                   如果两个都是并发安全的，canExecuteTool 返回 true
//                   → pass B 开跑工具2
//
//  所以并发不是「一个循环里同时跑」，而是**多个交错的 pass 各跑一个**。
//
//  这种写法要正确，必须有一条硬保证：**同一个工具不能被两个 pass 启动。**
//  保证来自 executeTool 的第二行（第 266 行）：
//
//      tool.status = 'executing'      ← 同步执行，在任何 await 之前
//
//  以及循环开头的 `if (tool.status !== 'queued') continue`。
//  因为 JS 是单线程，`status` 的读—改之间不会被打断，这个「状态翻转」
//  就充当了锁。**用同步的状态变更当互斥量，是 JS 里最常见的并发原语。**
//
//  再说那个 break：
//
//      遇到不能跑的工具时，如果是**非并发**的 → break
//      如果是并发的 → 不 break，继续看下一个
//
//  因为非并发工具要求「独占 + 保序」，后面的任何工具都不能越过它；
//  而并发工具之间没有顺序要求（结果顺序由缓冲层负责），跳过它没关系。'''),
    (210, 'before', '''// 【getAbortReason：四个取消原因，检查顺序就是优先级】
//
//      discarded       →  streaming_fallback（整批作废，最高优先级）
//      hasErrored      →  sibling_error（兄弟报错了）
//      aborted         →  user_interrupted（用户按了 ESC）
//      都没有          →  null（继续跑）
//
//  为什么 discarded 要排第一？因为它代表「这一批根本不该存在」
//  （流式降级重试了），此时就算同时有兄弟错误，也应该报 streaming_fallback
//  —— 否则用户会看到一个莫名其妙的「兄弟报错」。
//
//  第 223 行那个分支很细：interrupt 的原因分两种工具行为
//
//      interruptBehavior === 'cancel'  →  取消（如正在跑的 Bash）
//      interruptBehavior === 'block'   →  不取消（等它跑完）
//
//  因为有些工具中途停下会留下半成品（写文件写一半），而有些可以安全中断。
//  **「能不能被中断」是工具自己的知识**，和 isConcurrencySafe 是同一个思路。'''),
]
