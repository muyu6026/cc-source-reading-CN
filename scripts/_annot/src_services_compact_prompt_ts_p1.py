# -*- coding: utf-8 -*-
"""prompt.ts 批注：压缩提示词模板（压缩管线的"大脑"）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 补小件 1/6 —— 压缩提示词模板
//                                      （src/services/compact/prompt.ts，374 行）
//
// 【这个文件是什么：一次"元对话"的剧本】
//
// 前面读过的 compact.ts 负责**执行**压缩（发请求、接摘要、换消息数组）。
// 这个文件负责**说什么** —— 它是一整套发给模型的指令，要求模型
// "把刚才那段对话写成一份摘要"。
//
// 换句话说：压缩是让模型给自己写读书笔记，而这个文件是笔记格式要求。
//
// 【为什么这件事值得单独写 374 行】
//
// 因为压缩是**不可逆的信息损失**。摘要写漏了一条用户指令，后面几百轮
// 都会照着错的理解走，而且没有任何机制能发现。所以这里的每一段文字
// 都经过反复调参，不是随手写的。
//
// 【三套 prompt，对应三种压缩场景】
//
//   ┌──────────────────────────┬────────────────────────────────────────┐
//   │ BASE_COMPACT_PROMPT      │ 整段对话都摘要掉（常规 /compact）        │
//   │ PARTIAL_COMPACT_PROMPT   │ 只摘要最近一段，早期消息原样保留          │
//   │ PARTIAL_UP_TO_PROMPT     │ 只摘要前缀，后面的新消息模型看不到        │
//   └──────────────────────────┴────────────────────────────────────────┘
//
// 后两种的差别很容易混，但它决定了摘要末尾要写什么：
//   · direction='from'  → 摘要放在**最前面**，后面接保留的近期消息
//                          → 所以第 9 节叫 "Optional Next Step"（往后看）
//   · direction='up_to' → 摘要排在**保留消息之前**，模型看不到后续
//                          → 所以第 9 节叫 "Context for Continuing Work"
//                            （要给后面的人交代清楚当前状态，而不是说下一步）
//
// 这个差别是实打实的：同一份摘要模板，最后一节的名字变了，因为
// 读者拿到它之后要干的事不一样。
//
// 【一个可以自查的巧合】
//
// 如果你这一轮对话开头看到了一份结构化摘要（Primary Request / Key
// Technical Concepts / All user messages / Optional Next Step ...），
// 那就是这个文件生成的 —— 连小标题都是这里硬编码的。
// 读这个文件相当于在读自己刚才经历过的那件事的说明书。
// ═══════════════════════════════════════════════════════════════'''),

(4, 'before', '''// 又一次见到 `feature()` 条件导入（prompts.ts 和 claude.ts 里都出现过）。
// 用意完全一样：如果不启用 PROACTIVE/KAIROS，打包时整条 require 连
// proactive 模块一起被删掉，最终产物里没有这段代码。
//
// 注意这里 `feature('PROACTIVE') || feature('KAIROS')` —— 两个特性
// 任一开启就要这个模块。所以判断条件本身也必须是内联表达式，
// 不能提成 const（提成变量后压缩器不知道这个常量只用于这里，
// 就不会做跨变量的死代码删除）。'''),

(12, 'before', '''// 【紧接下面那段英文注释，是全文件最有价值的一条工程记录】
//
// 它只有 7 行，但压缩了五个信息点，每个都能单独讲。按原文顺序拆开说
// （不重复抄英文，对照着看下面那段即可）：
//
// ── ① 为什么工具必须全套留着 ──
//
//   "cache-sharing fork path inherits the parent's full tool set"
//
//   → 压缩是用 fork 出来的子 agent 跑的（还记得 forkSubagent.ts 吗）。
//     fork 要共享父进程的 prompt cache，而 cache 是按**字节前缀**匹配的，
//     工具 schema 在请求里位于前部 —— 所以工具集必须一模一样，
//     一个都不能删。
//   → 这就埋下了一个矛盾：**我们明知道不该让模型用工具，却必须把
//     全套工具摆在它面前**。指令和现实不一致，模型就可能不听话。
//
// ── ② 为什么末尾那句"别用工具"不够 ──
//
//   "on Sonnet 4.6+ adaptive-thinking models the model sometimes attempts
//    a tool call despite the weaker trailer instruction"
//
//   → 光在**末尾**（trailer）说"别用工具"压不住。4.6 的 adaptive thinking
//     有时会自己决定调个工具。
//
// ── ③ 为什么"调了工具"等于"整次压缩白跑" ──
//
//   "With maxTurns: 1, a denied tool call means no text output"
//
//   → 压缩只给模型**一轮**机会（maxTurns: 1）。它要是把这一轮用来调工具，
//     工具被拒 → 这一轮什么文本都没产出 → 整次压缩白跑。
//
// ── ④ 白跑的代价，以及它是怎么被发现的 ──
//
//   "falls through to the streaming fallback (2.79% on 4.6 vs 0.01% on 4.5)"
//
//   → 白跑后触发降级路径重来一次。发生率在 4.5 上是 0.01%，
//     到 4.6 变成 2.79% —— 涨了 279 倍。
//   → 所以这条是"新模型上线后才出现的回归"，靠**线上数据**定位，
//     不是靠读代码发现的。这类问题只有埋点才能抓到。
//
// ── ⑤ 最后采取的修复 ──
//
//   "Putting this FIRST and making it explicit about rejection consequences
//    prevents the wasted turn."
//
//   → 两个措施：① 把禁令放到**最前面**（位置权重）；
//     ② 明说"调了会被拒、你会失败"（把后果讲清楚，比单纯禁止有效）。
//
// 【这条注释的可迁移结论】
//
// 当"约束"和"上下文"冲突时（这里：要求不用工具，但必须提供全套工具），
// 光说一句"请不要"是不够的。要**把违反的直接后果写在最显眼的位置**。
// 这是提示词工程里少数有数据支撑的结论之一 —— 4.5 和 4.6 的对比数字
// 就是它的证据。'''),

(19, 'before', '''// 这条 preamble 就是上面注释的产物。注意它的措辞层次：
//   · 第一行全大写 CRITICAL + "TEXT ONLY"（最硬的约束）
//   · 四条具体说明，其中第 3 条是**后果**而不是**要求**
//     （"will be REJECTED and will waste your only turn"）
//   · 最后一句给出**正确的输出形状**（一个 analysis 块 + 一个 summary 块）
//
// 这个结构值得记：禁止 + 后果 + 正确做法。只给禁止，模型会找别的路；
// 给出正确形状，它才知道该往哪走。'''),

(28, 'before', '''// 两个 analysis 指令版本的差别**只有一处**：
//   BASE     → "Chronologically analyze each message and section of the conversation"
//   PARTIAL  → "Analyze the recent messages chronologically"
//
// 就这么一句话的差别，为什么要复制整段而不是参数化？
//
// 因为提示词是一个**整体**：改一个词可能影响后面所有段落的行为，
// 拆成拼接反而更难预测。这里的取舍是"复制 14 行换行为可预测"，
// 和写代码时"抽公共函数"的直觉正好相反。
//
// 这也是读提示词文件时要习惯的一点：**重复不是坏味道**。'''),

(31, 'before', '''// 下面这两个模板字符串（BASE 和 PARTIAL 版）内部插不进注释，
// 但内容值得逐条说明 —— 这几条要求决定了摘要"写什么"：
//
//   ① 按时间顺序逐条分析每一段
//   ② 每段都要找出：用户的明确请求 / 你的应对方式 / 关键决策 /
//      技术概念 / 代码模式 / **具体细节**（文件名、完整代码片段、
//      函数签名、文件改动）
//   ③ 你遇到的错误**以及怎么修的**
//   ④ 特别注意用户给你的具体反馈，尤其是"告诉你换个做法的"那类
//
// 第 ③④ 条是最容易被忽略、又最值钱的两条：
//   · 错误 + 修法  → 防止压缩后模型把已经踩过的坑再踩一遍
//   · 用户纠正     → 这是**偏好信息**，不在代码里，一旦丢了就永久丢失
//
// 最后一句 "Double-check for technical accuracy and completeness"
// 是要求模型自查 —— 摘要不像代码，没有编译器帮你发现遗漏。'''),

(46, 'before', '''// PARTIAL 版：结构完全一致，只把"整段对话"换成"最近的消息"。
// 注意它的第 1 条少了一个词：没有 "and section"，直接 "recent messages"。
// 这种级别的改动都保留成两个独立副本，可见作者对"改一个字可能
// 改变全局行为"的警惕程度。'''),

(61, 'before', '''// 【BASE_COMPACT_PROMPT：常规压缩的主模板，200 行里最重要的 9 节】
//
// 中间那一大段是给模型的**输出格式示例**（一个完整的 <example> 块，
// 含 analysis 和 summary 两层）。为什么要给 60 行的示例？
//
// 因为"结构化输出"这件事，光描述字段名不够。示例同时规定了：
//   · 层级（外层 summary，内层 1..9 编号）
//   · 每个字段的详略程度（看示例里 [Detailed description] 那种占位）
//   · 末尾要有什么（9. Optional Next Step，还要带原文引用）
//
// 最后那句 "Please provide your summary based on the conversation so far,
// following this structure and ensuring precision and thoroughness" 是
// 收尾指令 —— 等价于"照上面那个样子写"。
//
// 特别注意第 9 节末尾那段话，它其实是**写给人看的工程纪律**：
//
//   "IMPORTANT: ensure that this step is DIRECTLY in line with the user's
//    most recent explicit requests... Do not start on tangential requests
//    or really old requests that were already completed without confirming
//    with the user first."
//
// 这段在约束什么？约束**摘要不要把模型带偏**。压缩之后模型只能看到
// 摘要，如果摘要末尾写着"下一步可以顺便重构一下 X"，而用户本来只想要 Y，
// 那压缩就凭空给模型塞了一个新任务。所以第 9 节必须严格锚定用户原话。
//
// 还有一句 "include direct quotes from the most recent conversation
// showing exactly what task you were working on and where you left off.
// This should be verbatim to ensure there's no drift in task interpretation."
//
//   "verbatim"（逐字引用）是关键 —— 转述会漂移，原文不会。
//   这也是为什么好的压缩摘要末尾总能看到一两句带引号的用户原话。'''),

(145, 'before', '''// PARTIAL 版主模板。开头那句把边界讲得很清楚：
//   "the messages that follow earlier retained context. The earlier
//    messages are being kept intact and do NOT need to be summarized."
//
// 必须明说"前面的消息原样保留"，否则模型会花力气去摘要那些
// 本来就不会被替换的内容 —— 白烧 token，还可能在摘要里
// 重复形成第二份不一致的版本。'''),

(206, 'before', '''// 【这个注释解释了 up_to 方向和 from 方向的根本区别】
//
// "model sees only the summarized prefix (cache hit)"
//   → 模型这次只能看到"被摘要的那部分前缀"。注意括号里那句 cache hit：
//     这次调用能命中缓存，因为发给它的内容就是对话的前缀本身，
//     一个字节没改。
//
// "Summary will precede kept recent messages, hence 'Context for
//  Continuing Work' section."
//   → 摘要最终会排在**保留的近期消息之前**。所以摘要的角色是
//     "给后面那些消息提供背景"，而不是"总结到最后一句"。
//     因此第 9 节不能叫"下一步"，得叫"继续工作所需的上下文"。
//
// 【一句话记住两个方向的差别】
//
//   from  : 摘要【后面】还有原文  → 摘要要交代"我干到哪了，接着干什么"
//   up_to : 摘要【前面】才是原文  → 摘要要交代"事情是怎么走到这一步的"
//
// 同一个压缩动作，因为摘要落点不同，最后一节的语义完全反过来。
// 这类"位置决定语义"的设计，在协议设计里很常见，但很容易被忽略。'''),

(208, 'before', '''// UP_TO 版主模板。八节变九节，第 8、9 节换了名字：
//   8. Work Completed              ← 原 "Current Work"
//   9. Context for Continuing Work ← 原 "Optional Next Step"
//
// 注意第 9 节的描述：
//   "Summarize any context, decisions, or state that would be needed to
//    understand and continue the work in subsequent messages."
//
// 是 "state"（状态）而不是 "next step"（下一步）。因为读者（模型）
// 接下来会看到新消息，它需要的是**理解新消息所需的背景**，
// 而不是一个可能已经过时的行动建议。'''),

(269, 'before', '''// TRAILER：和开头的 NO_TOOLS_PREAMBLE 内容几乎重复。
//
// 为什么同一个约束要说两遍？因为这是"首尾夹击"：
//   · 开头的 preamble 在**注意力最高**的位置，负责立规矩
//   · 末尾的 trailer 在**刚刚读完 200 行模板之后**，负责把跑偏的注意力拉回来
//
// 长上下文里模型的注意力会衰减，末尾重复一句硬约束是廉价的保险。
// 这也是为什么很多提示词文件里同样的规则会出现两三次 ——
// 不是作者忘了删，是**不同位置管不同的事**。'''),

(274, 'before', '''// 【prompt 拼装：三段式，顺序固定为 preamble → 模板 → trailer】
//
// 中间插 customInstructions（用户在 /compact 后面跟的自定义要求）。
// 注意判断条件是 `customInstructions && customInstructions.trim() !== ''`
// —— 光判 truthy 不够，一个只含空格的字符串会让输出里多出
// "\n\nAdditional Instructions:\n   " 这种没内容的段落。
//
// 另外：customInstructions 插在**模板之后、trailer 之前**。
// 位置有讲究 —— 用户的自定义要求优先于默认模板（放在后面权重更高），
// 但不能压过"别用工具"这条硬约束（所以 trailer 仍在最后）。'''),

(293, 'before', '''// 和上面完全同构，只是没有 direction 参数（整段压缩只有一种方向）。
//
// 两个函数几乎一模一样，为什么不合并？
// 因为参数签名不同：强行合并要么加一个可选的 direction，
// 要么加一个 "mode" 开关 —— 两种都让调用点变得需要思考。
// 提示词函数多写 10 行，调用点少想一件事，这笔交易划算。'''),

(305, 'before', '''// formatCompactSummary —— 摘要的"后处理"
//
// 模型吐出的是带 XML 标签的文本：
//   <analysis>思考过程...</analysis>
//   <summary>正文...</summary>
//
// 这个函数干三件事，每一件都有明确目的：
//   ① 把 <analysis> 整段删掉（草稿纸，写完就没用）
//   ② 把 <summary> 换成 "Summary:" 标题（人类可读）
//   ③ 把连续空行压成两个（删 analysis 后留下的空洞）
//
// 【为什么必须删 analysis】
//
// analysis 是给模型"想清楚"用的草稿纸。它对摘要质量有帮助，
// 但**一旦摘要写完，它就只有坏处**：
//   · 占 token（可能几百上千字）
//   · 里面常含反复推翻的推理过程，读起来像模棱两可的结论
//   · 后面模型看到两份表述（草稿 + 定稿）容易抓错重点
//
// 这也是那段提示词里为什么强调 "a drafting scratchpad" ——
// 明确告诉模型这只是草稿，可以放心乱写，反正会被撕掉。'''),

(311, 'before', '''// 注意这三个正则的细节：
//
//   ① `/<analysis>[\\s\\S]*?<\\/analysis>/` 用 [\\s\\S] 而不是 `.`
//      因为 `.` 默认不匹配换行 —— 摘要肯定跨行，用 `.` 什么都匹配不到。
//      这是个非常常见的坑。
//
//   ② 全部用 `*?`（惰性）而不是 `*`（贪婪）
//      如果模型输出了两个 analysis 块，贪婪匹配会把中间所有内容
//      （包括第一个 summary）一起吞掉。惰性匹配只吃第一个。
//
//   ③ 没写 `g` 标志 —— 只替换第一处。
//      这是刻意的：正常情况下只有一个。多出来的留着比乱删安全。
//
// 【② 为什么要特别小心】
//
// 这不是理论风险：如果提示词里让模型"先分析再总结"，而模型在分析里
// 引用了一段包含 </analysis> 的示例文本，贪婪匹配就会把整个回答吃掉，
// 最终摘要变成空字符串 —— 而这个过程**完全静默**，没有任何报错。'''),

(337, 'before', '''// 【getCompactUserSummaryMessage：把摘要包装成一条"用户消息"】
//
// 这是整个压缩流程的最后一步，也是最容易被忽略的一步：
// 摘要不是以 system 身份注入的，是**以 user 消息的形式**塞回对话。
//
// 为什么必须是 user 角色？
// 因为对话协议只有 user / assistant 两种轮次。system 是请求参数，
// 不能出现在消息数组中间（会破坏缓存前缀）。所以"告知模型历史被压缩了"
// 这件事，只能伪装成用户说的话。
//
// 开头那句固定文案很讲究：
//   "This session is being continued from a previous conversation that
//    ran out of context. The summary below covers the earlier portion."
//
// 它同时交代了四件事：① 这是续接 ② 上一段因为上下文超限结束
// ③ 下面是摘要 ④ 摘要只覆盖早期部分（不是全部）。
// 少说任何一条，模型都可能误解自己的处境 —— 比如以为这段摘要
// 就是完整历史，从而不再去读 transcript。'''),

(349, 'before', '''// transcriptPath：告诉模型"完整原文在哪"。
//
// 这一句的存在，是因为摘要**一定会有损**。与其让模型在信息缺失时
// 猜，不如告诉它"你可以自己去翻原文"。这是把不可靠的东西
// （摘要）和一个可靠的东西（原始 transcript 文件）搭在一起。
//
// 注意措辞 "If you need specific details from before compaction
// (like exact code snippets, error messages, or content you generated)"
// —— 括号里点名的三类，正是摘要最容易丢的东西：
// 精确代码、错误原文、模型自己生成过的长内容。'''),

(353, 'before', '''// recentMessagesPreserved：只在局部压缩（PARTIAL）时为真。
//
// 为什么要专门说一句 "Recent messages are preserved verbatim"？
//
// 因为模型不知道压缩的范围。如果摘要里提到"用户要求改 X"，
// 而模型又看到后面有几条原始消息，它无法判断这几条是
// "压缩后保留的原文"还是"摘要里没覆盖到的新对话"。
//
// 明说一句"近期消息逐字保留"，模型就知道：后面看到的原文是可信的，
// 而摘要里关于近期部分的描述可能不如原文精确 —— 应该以原文为准。'''),

(357, 'before', '''// suppressFollowUpQuestions 分支：压缩后**直接继续干活**，不要问用户。
//
// 这段文案的精细程度值得单独看：
//
//   "Continue the conversation from where it left off without asking the
//    user any further questions."
//   "Resume directly — do not acknowledge the summary, do not recap what
//    was happening, do not preface with 'I'll continue' or similar."
//   "Pick up the last task as if the break never happened."
//
// 三句禁令针对三种具体的坏行为：
//   ① 不 acknowledge the summary  → 别写"我看到你之前在做 X"
//   ② 不 recap                    → 别复述一遍进度（用户知道，白费 token）
//   ③ 不 preface with "I'll continue" → 别打招呼直接干
//
// 为什么这些必须明说？因为模型的默认行为就是"确认理解再行动" ——
// 这在正常对话里是对的，在自动压缩后是纯噪音。
// 每次压缩都来一句"好的，我继续"，几十次压缩后对话就没法看了。'''),

(361, 'before', '''// proactive 模式下再追加一段。注意这里又用了一次 `feature()` ——
// 同一个特性在两个地方判断（文件顶部导入、这里用），
// 都是为了让打包器能把整块删掉。
//
// 追加内容的核心信息："This is NOT a first wake-up — you were already
// working autonomously before compaction."
//
// 这句话在解决什么问题？proactive 模式的模型有一个"刚被唤醒该做什么"
// 的行为模式（打招呼、问用户想干吗）。压缩之后它重新"醒来"，
// 很容易误以为自己刚被唤醒，于是开始跟用户寒暄 ——
// 而实际上它刚才一直在自主干活，用户可能根本不在屏幕前。
//
// "NOT a first wake-up" 是在纠正它对自身状态的判断。'''),

]
