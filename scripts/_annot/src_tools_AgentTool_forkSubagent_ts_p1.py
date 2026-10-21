# -*- coding: utf-8 -*-
"""AgentTool/forkSubagent.ts 批注：fork 的缓存共享机制、身份冲突、字节目录。"""

ANNOTATIONS = [

(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 7 步 · 4/4 —— fork：一个便宜的自我复制（src/tools/AgentTool/forkSubagent.ts）
//
// 前面三个文件都在讲"派活机制"，这个文件讲一种**特殊的派活方式**。
//
// 【fork 和普通子 agent 的区别，一句话】
//   普通子 agent：全新上下文，只拿到你写的那段 prompt
//   fork        ：继承你的**完整对话历史**，只多一段指令
//
// 【为什么 fork 便宜】
// 因为 API 请求的形态是这样的：
//
//   普通子 agent：  [系统提示词] [你写的 prompt]              ← 全新前缀，0 缓存
//   fork：          [系统提示词] [你的完整历史] [一句指令]     ← 前缀全命中
//
// 前者的输入 token 全部按全价计费；后者除了最后那一句，
// 前面全部命中 prompt cache（便宜一个数量级）。
//
// 所以 fork 的定价逻辑和普通 agent 完全不同：
//   普通 agent 的成本 ≈ 上下文大小
//   fork 的成本      ≈ 新增指令 + 一点缓存读取费
//
// 【代价】
// fork 子 agent 会继承你的**所有错误前提**。如果主线程理解错了问题，
// fork 出来的每一个子 agent 都会沿着错误方向跑。
// 所以提示词里明确写了：要独立意见时不能 fork
// （prompt.ts 第 143 行那个 <thinking> 就是在示范这个判断）。
//
// 【这个文件只有 210 行，但每一段都在解决一个"字节级"的问题】
// 不是逻辑，是**字节**：占位符必须完全一致、系统提示词必须用
// 已经渲染好的字符串、tools 数组必须原样传。
// 因为缓存匹配的判据是字节前缀，不是语义。
// ═══════════════════════════════════════════════════════════════'''),

(18, 'before', '''// 这段 docstring 是 fork 功能的完整规格，四条后果值得逐条看：
//
//   ① subagent_type 变成可选项
//      原本必须指定类型，现在省略 = 走 fork。这个语义变化会连带改变
//      AgentTool 的路由逻辑（AgentTool.tsx 第 318-323 行）。
//
//   ② 隐式 fork 继承父的完整上下文与系统提示词
//      "隐式"这个词很重要 —— 模型不需要说"我要 fork"，
//      它只是**不指定类型**，就自动走了 fork 路径。
//
//   ③ 所有 spawn 变成后台（为了统一 <task-notification> 交互模型）
//      注意是**所有**，不只是 fork。这条副作用比前两条影响大得多：
//      连"派个 agent 查个文件"这种 3 秒任务也变异步了。
//
//   ④ /fork 命令可用（用户手动触发 fork）
//      给人用的入口，和模型走的路径不同但语义一致。'''),

(32, 'before', '''// ─────────────────────────────────────────────────────────────
// 【三个禁用的理由，各自不同】
//
//   feature('FORK_SUBAGENT') 为假
//     → 编译期开关。外部构建里整个函数体被删，只剩 return false。
//
//   isCoordinatorMode() 为真
//     → **互斥**。docstring 第 29-30 行写了原因：
//       "coordinator already owns the orchestration role and has its own
//        delegation model."
//       （协调者已经承担了编排角色，有自己的委派模型。）
//       翻译成实际后果：如果两个都开，模型会同时收到两套矛盾的派活指南 ——
//       一套说"写一份包含行号的施工单给 worker"，一套说"直接 fork 自己"。
//       而这两套的**成本模型也相反**：coordinator 假设"派活要重新建立上下文"，
//       fork 假设"派活几乎免费"。混在一起模型会算错账。
//
//   getIsNonInteractiveSession() 为真
//     → 非交互会话（-p / SDK / CI）里禁用。
//       为什么？因为 fork 的交互模型依赖"通知晚点到、用户可能中途追问"，
//       而 -p 模式是一次性的：没有"下一轮"，也没有人追问。
//       在那种场景里，所有 agent 强制异步只会让输出变成一堆
//       无人消费的通知。
//
// 【这三个判断的顺序也有讲究】
// feature() 在最外层 —— 它是编译期常量，为假时后面两个判断
// 连带被删掉，连 isCoordinatorMode() 的调用都不会留下。'''),

(41, 'before', '''// 这个常量只用于**遥测**（区分"模型主动 fork"和"派了普通 agent"）。
//
// 注意它不是 schema 里的值 —— 模型无法通过 subagent_type: 'fork'
// 来走 fork 路径（那样反而会因为找不到这个 agent 定义而报错）。
// 唯一的触发方式是**省略** subagent_type。
//
// 【为什么不做成一个可选的 agent 类型】
// 因为如果 'fork' 是可选值，模型会在清单里看到它，然后开始纠结
// "该选 fork 还是选 code-reviewer"。而设计意图是：
// fork 是**默认行为**（不指定就 fork），不是需要主动选择的选项。
// 默认值比选项更省模型的注意力。'''),

(44, 'before', '''// ─────────────────────────────────────────────────────────────
// 【FORK_AGENT 是一个"假"的 agent 定义，但每个字段都有实在作用】
//
//   agentType: 'fork'       遥测和 UI 显示的标识
//   whenToUse: ...          这段文字**不会**被模型看到（fork 不出现在
//                           agent 清单里），所以它只服务人类读者
//   tools: ['*']            配合 useExactTools 使用，表示"用父的全套工具"
//   maxTurns: 200           上限比普通 agent 高 —— 因为 fork 干的是实活
//   model: 'inherit'        继承父的模型（第 51-52 行注释：为了 context
//                           length parity，也就是别让子 agent 因为换了模型
//                           而处理不了同样的上下文长度）
//   permissionMode: 'bubble'
//                           ⚠️ 这个词要解释：'bubble' 意思是权限弹窗
//                           冒泡到**父终端**去问。因为 fork 子 agent 通常
//                           没有自己的界面（它是后台任务），弹窗弹在自己
//                           那里没人看得见。
//   getSystemPrompt: () => ''
//                           ⚠️ 这个空函数永远不会被调用。第 54-58 行注释
//                           解释了原因（下面单独说）
//
// 【第 54-58 行：为什么不能用 getSystemPrompt】
//   "Reconstructing by re-calling getSystemPrompt() can diverge
//    (GrowthBook cold→warm) and bust the prompt cache;
//    threading the rendered bytes is byte-exact."
//
// 也就是说：父进程的系统提示词里可能有几个由远端配置（GrowthBook）
// 决定的分支。父进程启动时远端配置还没拉到（cold），所以渲染出的
// 是 A 版本；fork 子进程启动时配置已经到了（warm），重新渲染得到
// B 版本 —— 一字之差，整个缓存前缀作废。
//
// 所以 fork 路径不走"重新生成"，而是直接拿父进程**已经渲染好的那个
// 字符串**（toolUseContext.renderedSystemPrompt）。
// 这就是 AgentTool.tsx 第 496-511 行那段逻辑的由来。
//
// 【一句话记住这个原则】
// 需要字节一致的东西，传递**渲染结果**，不要传递**渲染配方**。'''),

(73, 'before', '''// ─────────────────────────────────────────────────────────────
// 【递归 fork 守卫，以及它为什么"只能事后判断"】
//
// 问题：fork 子 agent 的工具池里仍然有 Agent 工具，所以它理论上
// 可以再 fork 一次。
//
// 为什么不从工具池里删掉 Agent 工具？
// 因为工具数组要**字节一致**才能共享缓存。删掉一个工具会让
// tools 序列化结果不同 → 缓存从第一个差异处断掉 → fork 的成本
// 优势消失。两害相权，选择"留着工具，调用时拒绝"。
//
// 【怎么判断"我是 fork 子进程"】
// 扫自己的对话历史，找 fork 样板标签（FORK_BOILERPLATE_TAG）。
// 因为那段样板是 buildChildMessage 生成的，里面有大写的
// "You are a forked worker process. You are NOT the main agent."
//
// 【这个判定方式的脆弱处】
// 它依赖"历史里有那条消息"。而历史可能被**压缩**（autocompact）
// 重写 —— 如果压缩恰好把那条样板消息摘要掉了，这个判定就失效。
// 所以 AgentTool.tsx 第 332 行用 querySource 做主判定，
// 这个函数只是兜底（querySource 在 context.options 里，扛得住压缩）。
//
// 【两个判定，一强一弱，都在】
// 强的可能因为某条路径没传下来而缺失；弱的可能因为压缩而失效。
// 单靠任何一个都有洞，所以要两个。'''),

(91, 'before', '''// ─────────────────────────────────────────────────────────────
// 【一行字符串常量，决定了 fork 能不能共享缓存】
//
// 注释："Must be identical across all fork children for prompt cache sharing."
//
// 展开这句话。假设主线程同时 fork 了三个子 agent（研究 auth、
// 研究测试、研究日志）。三个子进程的请求前缀是：
//
//   [系统提示词] [完整历史] [assistant 消息] [user 消息: tool_results + 指令]
//                                                          ↑
//                                            这里三个子进程各不相同（指令不同）
//
// 而 tool_results 里填的是这段占位符。如果三个子进程填的东西不同
// （比如填"研究 auth 那个正在处理"），那么**它们从 tool_result 处就分叉了**，
// 后面的指令差异反而不重要 —— 关键在于分叉点越靠后越好。
//
// 用了相同占位符，分叉点就被推到最后一个 text 块（指令本身），
// 前面全部共享。
//
// 【为什么占位符内容是 "Fork started — processing in background"】
// 它在语义上是**真的**：fork 确实启动并在后台处理了。
// 所以父进程的历史里看到的这条结果是诚实的，
// 不是"为了凑字节编的假话"。
//
// 这一点挺重要 —— 如果占位符是".", 那么父进程后续读自己的历史时
// 会看到一堆无意义的点，可能影响它对上下文的理解。
// 用一句真话当占位符，既省字节又是准确的。'''),

(95, 'before', '''// ─────────────────────────────────────────────────────────────
// 【buildForkedMessages：这个文件的核心，35 行代码决定一切】
//
// 文档注释（第 98-105 行）已经把算法说完了：
//
//   1. 保留父的**完整** assistant 消息（所有 tool_use、thinking、text）
//   2. 造一条 user 消息，为每个 tool_use 配一个**相同占位符**的 tool_result，
//      末尾追加这个子进程自己的指令
//
//   结果结构：[...历史, assistant(全部 tool_use), user(占位结果..., 指令)]
//   只有最后一个 text 块在子进程之间不同。
//
// 【为什么必须保留完整的 assistant 消息（包括所有 tool_use）】
// 因为 API 要求 tool_use 和 tool_result **必须配对**。
// 如果只挑一个 tool_use 留下，其余丢掉，那它们对应的 tool_result
// （历史里已经有的）就变成孤儿 → 400。
//
// 而如果全部 tool_use 都保留，就必须为每一个都补 tool_result ——
// 即使那些工具的结果已经被父进程拿到了。
// 这就是占位符的来源：**补齐协议要求的配对**。
// 父进程刚才那次响应里可能有 5 个 tool_use（并行派了 5 个活），
// 你要 fork 第 6 个，就得给前 5 个都补上结果。
//
// 【注意一个反直觉的后果】
// fork 子进程看到的历史里，那 5 个工具的结果是
// "Fork started — processing in background" —— 假的。
// 但这对它没影响：它要干的是自己的活，不需要知道兄弟的进展。'''),

(111, 'before', '''// 克隆 assistant 消息，**不改内容，只改 uuid**。
//
// 为什么要克隆：原消息对象还在父进程的对话历史里，如果直接改它的
// uuid，父进程的历史就坏了（消息 id 是会话存储的键）。
//
// 为什么只改 uuid：因为改别的东西都会破坏缓存。content 数组浅拷贝
// 是为了让子进程的后续修改不影响父进程，但**数组里的块对象是共享引用** ——
// 这是安全的，因为没有人会去改这些块。
//
// 【这个函数的克制值得注意】
// 它本可以"顺手清理一下"（比如去掉 thinking 块以省 token），
// 但那样会让字节不同 → 缓存失效。在 fork 这条路径上，
// **任何"优化"都是风险**，除非它发生在最后那个 text 块里。'''),

(122, 'before', '''// 把所有 tool_use 块捞出来。每个都要配一个 tool_result。'''),

(127, 'before', '''// ─────────────────────────────────────────────────────────────
// 【没有 tool_use 的降级路径 —— 以及它暴露的一个设计假设】
//
// 如果父的 assistant 消息里一个 tool_use 都没有，就退化成
// "只发一条用户消息"（不继承历史）。
//
// 【什么时候会走到这里】
// fork 的触发点是"模型调用 Agent 工具"这个动作本身 —— 所以父进程的
// 最后一条 assistant 消息里**至少**有一个 tool_use（就是 Agent 那个）。
// 所以这个分支理论上不可达。
//
// 但作者还是写了，而且打了 error 级日志（第 128-131 行）。
//
// 【为什么值得保留一个不可达分支】
// 因为"不可达"的判断建立在"fork 只能由 Agent 工具触发"这个假设上。
// 如果将来加了 /fork 命令（docstring 第 27 行提到它存在），
// 那条路径上父消息可能没有 tool_use —— 那时这个分支就变得可达了。
//
// error 级日志的价值是：真走到这里时，你能在日志里看到
// "fork 发生了但历史没继承"，从而立刻意识到"缓存共享失效了"。
// 否则表现只是"变慢了、变贵了"，没有任何错误。'''),

(141, 'before', '''// 为每个 tool_use 造一个占位 tool_result。
//
// tool_use_id 必须**精确对应**（block.id），否则 API 报"找不到匹配的
// tool_use"。注意这里没有对 id 排序或去重 —— 原样沿用，顺序和
// 父消息里 tool_use 的顺序一致。顺序也必须一致，因为
// tool_result 的匹配虽然靠 id，但缓存匹配靠字节顺序。'''),

(153, 'before', '''// ⚠️ 这段 TODO 很有意思，它记录了一个"知道有问题但选择不修"的决定。
//
// 问题：这条 user 消息的内容是 [tool_result, tool_result, ..., text]。
// 在 API 的 wire 格式里，一个包含 tool_result 的 user 消息会被
// 渲染成 `</function_results>\n\nHuman:<text>` —— 也就是**多了一个
// Human 段落**。
//
// 理想形态是把指令折叠进最后一个 tool_result 的 content 里
// （作者提到了现成的工具 smooshIntoToolResult）。
//
// 【为什么不修】
//   "One-off per-child construction, not a repeated teacher,
//    so low-priority."
// （每个子进程只构造一次，不是反复出现的模式，所以低优先级。）
//
// 这是一个成本判断：这个形状会让模型看到稍微奇怪的格式，
// 但因为只出现一次（在消息末尾），对行为影响很小。
// 而修改它要动消息构造逻辑，风险大于收益。
//
// 【这段 TODO 的教学价值】
// 它示范了"记录已知缺陷"应该怎么写：
//   ① 说清问题是什么（wire 格式会长什么样）
//   ② 说清怎么修（用哪个现成函数）
//   ③ 说清为什么不现在修（量化影响范围）
// 少任何一条，下一个人要么重复踩坑，要么盲改。'''),

(171, 'before', '''// ─────────────────────────────────────────────────────────────
// 【给 fork 子进程的身份纠正 —— 全文件最"人类"的一段】
//
// 第 172 行开始是一个 24 行的模板字符串（到第 195 行），
// 内容是给子进程的开场白。因为它是字符串内部，中间插不了注释，
// 导读全放这里。
//
// 【第一句：STOP. READ THIS FIRST.】
// 大写 + 命令语气。这不是风格问题，是**注意力竞争**：
// 子进程的系统提示词里写着"你应该 fork 子 agent"，而这条用户消息
// 说"你不能 fork"。两条指令冲突时，模型倾向于服从**更晚、更醒目**的那条。
// 所以这里用了大写、短句、祈使句。
//
// 【规则 1 解决的是身份冲突，不是行为】
//   'Your system prompt says "default to forking." IGNORE IT — that's
//    for the parent. You ARE the fork. Do NOT spawn sub-agents;'
// 这是整段里最重要的一条。因为 fork **不能换系统提示词**（换了就
// 不共享缓存），所以子进程继承了一份"教它如何 fork"的系统提示词，
// 而它自己就是 fork。这个矛盾无法从源头消除，只能在这里显式覆盖。
//
// 【规则 4-6：不要说话，直接干】
//   "USE your tools directly"
//   "Do NOT emit text between tool calls. Use tools silently, then report once."
// 这两条针对的是"子 agent 把自己的过程叙述当成输出"的问题。
// 那些叙述对父进程毫无价值（父进程只看最终报告），
// 但会占用子进程的上下文、并且污染返回给父的那段 result。
//
// 【规则 7：范围纪律】
//   "Stay strictly within your directive's scope. If you discover related
//    systems outside your scope, mention them in one sentence at most —
//    other workers cover those areas."
// "一句话"是个精确的约束 —— 不给范围会漏掉重要发现，
// 给个范围（一句话）能保证它一定回来说，但不展开。
//
// 【规则 9：输出必须以 "Scope:" 开头】
// 这是个很聪明的技巧。强制一个固定前缀有两个作用：
//   ① 迫使子进程**重述自己的任务范围**（自我确认，防跑偏）
//   ② 父进程（或人）看报告时能立刻判断"它做的是不是我要的"
// 第 189-194 行的输出格式把这一点扩展成五个固定标签：
//   Scope / Result / Key files / Files changed / Issues
//
// 【整个输出格式设计的原则：字段可选但有条件】
//   "include for research tasks"（Key files）
//   "include only if you modified files"（Files changed）
//   "include only if there are issues to flag"（Issues）
// 每条都说明了"什么时候该有"。这比"尽量详细"有用得多 ——
// 模型知道该填什么、该省什么。
//
// 【最后一行：指令本身在标签外】
//   ${FORK_DIRECTIVE_PREFIX}${directive}
// 指令被放在样板标签**之后**，也就是整条消息的最末尾。
// 和上面"最需要注意的放最后"是同一个原理。'''),

(200, 'before', '''// ─────────────────────────────────────────────────────────────
// 【worktree + fork 组合时才有的问题：路径全错】
//
// fork 子进程继承的上下文里，每一个文件路径都是**父进程工作目录**下的。
// 如果它跑在独立的 git worktree 里（另一个目录，同一份仓库），
// 那些路径全部指向错误的位置。
//
// 而且更隐蔽的是：**读文件不会报错**。
// 因为父目录依然存在、文件依然可读 —— 它会读到父进程的版本，
// 于是基于过时的内容做判断，改出来的东西和实际不符。
//
// 【这段 notice 用三句话解决三个问题】
//   ① "translate them to your worktree root"
//      → 路径要翻译（同一仓库，结构相同，只是根不同）
//   ② "Re-read files before editing if the parent may have modified them"
//      → 上下文里的文件内容可能过时，改之前重读
//   ③ "Your changes stay in this worktree and will not affect the parent's files"
//      → 让子进程知道它的改动是隔离的（这会影响它要不要提交、
//        要不要在报告里强调"这些改动还没合进去"）
//
// 【第 ② 条是最容易漏的】
// 因为"路径错"很显眼（文件找不到），而"内容过时"完全不显眼 ——
// 读到的是合法内容，只是旧版本。这类问题只有在合并冲突时才暴露。
//
// 【注入位置在 AgentTool.tsx 第 598-602 行】
// 它被 push 到 promptMessages 的最后，注释说
// "so it appears as the most recent guidance the child sees"。
// 也就是：和 buildChildMessage 里的指令一样，放在最后抢注意力。'''),

]
