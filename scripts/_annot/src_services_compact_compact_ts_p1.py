# -*- coding: utf-8 -*-
"""compact.ts 批注 p1：压缩本体（stripImages / PTL 重试 / compactConversation / partialCompact）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 4/N —— 压缩本体（src/services/compact/compact.ts）
//
// `autoCompact.ts` 决定"什么时候压"，这个文件决定"怎么压"。
// 1,705 行，是全代码库最长的非 API 文件之一。
//
// 【先建立一个反直觉的认知：压缩本身就是一次完整的 API 调用】
//
// 很多人以为压缩是"本地把旧消息删掉"。不是。压缩 = 把旧消息发给模型，
// 让它写一份摘要，然后**用摘要替换掉旧消息**。这意味着压缩会：
//   · 花钱（一次输入 = 整个上下文）
//   · 花时间（实测 5-10 秒，长会话更久）
//   · 失败（网络、限流、模型抽风）
//   · **自己也会 prompt-too-long**（因为它的输入就是那个已经太长了的上下文）
//
// 最后一条是这个文件一半复杂度的来源。行 243 的 truncateHeadForPTLRetry
// 就是给"压缩请求自己撞上上下文上限"准备的逃生舱（内部编号 CC-1180）。
//
// 【这个文件的结构，读之前先建立框架】
//
//   ① 预处理        145 stripImagesFromMessages
//                   211 stripReinjectedAttachments
//                   ——压缩前先减肥，把对摘要没用的东西剔掉
//   ② PTL 逃生舱    243 truncateHeadForPTLRetry
//                   ——压缩请求自己超长时，砍掉最老的几轮重试
//   ③ 全量压缩      387 compactConversation（376 行）
//                   ——压掉全部历史，只留摘要
//   ④ 局部压缩      772 partialCompactConversation（335 行）
//                   ——只压一半，另一半原样保留（用户手选分界点）
//   ⑤ 摘要生成      1136 streamCompactSummary（261 行）
//                   ——真正发那次 API 调用，两条路径（复用缓存 / 普通流式）
//   ⑥ 压缩后重建    1415 起一串 createXxxAttachment
//                   ——把压缩丢掉的东西补回来（文件、技能、plan、agent…）
//
// 【这个文件真正在解决的问题，不是"怎么变短"】
//
// 而是"变短之后怎么不丢东西"。压缩会连带丢掉：
//   · 读过的文件内容（模型得重新 Read）
//   · 调用过的技能说明（guidelines 没了）
//   · 当前 plan 文件
//   · 后台还在跑的 agent 列表（不补回去会重复 spawn）
//   · plan mode 的状态（不补回去模型会开始直接改代码）
//   · 延迟加载的 MCP 工具清单和指令
//   · 已加载的 deferred tool schema（tool_reference 块不在摘要里）
//
// 所以第 ⑥ 段有七个 createXxxAttachment。**压缩的真实成本不是 token，
// 是这些信息损失**——每补一项都是几十到几千 token 的 cache_creation。
// ═══════════════════════════════════════════════════════════════'''),

(6, 'before', '''// 又是 `feature('KAIROS') ? require(...) : null` 的条件导入。
//
// 和第 5 步 prompts.ts 里讲过的 DCE 机制完全一样：`feature()` 是构建期常量，
// 打包器看到 `false ? require(A) : null` 会把整个 require 连同 A 的模块图删掉。
// 所以 `sessionTranscriptModule` 在外部构建里恒为 null，下面所有
// `sessionTranscriptModule?.xxx` 都变成 `null?.xxx` → undefined → 无操作。
//
// 注意它上面那行 `/* eslint-disable @typescript-eslint/no-require-imports */`
// 和下面 82 行的 eslint-enable 把整个 import 区夹住了。原因是这个文件里
// 有一堆 `import` 被这个 require 打断了顺序——eslint 的 import 规则会报错，
// 只能整段关掉。
//
// 【顺带一个读源码的经验】
// 看到 `const X = feature('Y') ? require(...) : null` 就知道：
// 这个模块在开源版里**不存在**。不要试图去 src/ 下面找它，
// 找到了也是残缺的。后面凡是 `X?.` 的调用，外部构建里全是空转。'''),

(122, 'before', '''// ═══ 压缩后的预算常量 ═══
//
// 三个数字配在一起看：
//   最多恢复 5 个文件 × 每文件最多 5,000 token = 25,000
//   总预算 50,000
//
// 为什么总额是 25,000 的两倍？因为这两个限制是**两道独立的闸**，
// 不是乘除法关系：
//   · MAX_FILES 控制"恢复几个"——防止一口气恢复 50 个文件
//   · TOKEN_BUDGET 控制"总共占多少"——防止 5 个超大文件把预算吃光
//
// 单个文件 5,000 token 已经不小了（约 20KB 文本）。5 个就是 25K，
// 而压缩后的上下文整体可能只有 20-30K——也就是说**附件可能比摘要本身还大**。
// 这不是 bug：摘要说的是"我们聊了什么"，附件说的是"需要哪些原材料"，
// 后者对继续工作更关键。'''),

(125, 'before', '''// 这段注释记的是一次真实的回归事故，值得逐句读：
//
//   "Skills can be large (verify=18.7KB, claude-api=20.1KB)"  ← 技能文件很大
//   "Previously re-injected unbounded on every compact"        ← 以前每次压缩都全量重注
//   "→ 5-10K tok/compact"                                       ← 每次白花 5-10K token
//
// 也就是说：一个会话压缩十次，就多花 5-10 万 token 在新会话根本用不上的
// 技能全文上。这些 token 还是 cache_creation（新内容，全价）。
//
// 解法是**先截断再筛选**，而不是直接丢掉整个技能：
//   "Per-skill truncation beats dropping — instructions at the top of a skill
//    file are usually the critical part."
//
// 这句话是整个文件的方法论缩影：**技能文件的价值分布是极度头重脚轻的**。
// 开头是"什么时候用我、怎么用我"，后面是长篇参考手册。
// 砍掉后半段损失很小，丢掉整个技能损失很大。
//
// 预算 25,000 = 5 个技能 × 单个上限 5,000。两个常量又一个乘除关系，
// 同样是"数量闸 + 总量闸"的双保险。'''),

(131, 'before', '''// 流式重试 2 次（也就是最多 3 次尝试）。
//
// 这个数字比 HTTP 层的重试小得多，原因很直接：
// **压缩本身就要 5-10 秒**，重试两次意味着用户可能干等 30 秒。
// 而 HTTP 层（withRetry）的重试是在几百毫秒内失败的请求上做的，成本低。
//
// 所以这里的 2 不是"容忍度"，是"用户的耐心上限"。
// 而且它默认是关的——下面 1251 行读 `tengu_compact_streaming_retry`，
// 默认值 `false`。'''),

(133, 'before', '''// 【为什么压缩前要剥掉图片】
//
// doc 注释给了两个理由，第二个才是真原因：
//
//   1. "Images are not needed for generating a conversation summary"
//      ——摘要不需要看到图。模型要写的是"用户发了一张 UI 截图抱怨按钮错位"，
//      不需要真的渲染那张图。
//
//   2. "can cause the compaction API call itself to hit the prompt-too-long limit,
//       especially in CCD sessions where users frequently attach images"
//      ——**这条才是关键**。压缩的输入就是那个已经超长的上下文。
//      一张 1,500 token 的图（1000×1000 大概这个量级）看起来不多，
//      但用户连发 20 张就是 3 万 token，而压缩本来是来救命的，
//      结果自己先被图撑爆 → 走 PTL 逃生舱 → 又得砍历史。
//
// 换句话说：**剥图是给逃生舱减负**，让压缩有更大几率一次成功。
//
// 【一个协议事实，注释里顺手写了】
// "Only user messages contain images"
// assistant 消息里只有 text / tool_use / thinking，永远不会有 image 块。
// 所以下面只需要处理 `message.type === 'user'`，不用两头都扫。
// 这个不对称性来自 API 的消息格式定义，不是这个文件的简化。'''),

(157, 'before', '''// 用 `flatMap` 而不是 `map` + 过滤，是因为一个 block 可能变成
// **零个或多个** block 之外，还要原样透传大多数 block。
//
// `flatMap` 的约定：返回数组就展开，返回 `[block]` 就是"原样保留一个"。
// 这样三种情况（替换成 1 个文本 / 替换后仍是 1 个 / 不动）统一成一个返回类型，
// 不用在外面再写一遍 filter。
//
// 【注意 160 行这个细节】
//   `return [{ type: 'text' as const, text: '[image]' }]`
//
// 不是直接删掉图块，而是换成一行文字标记。为什么？
// 因为摘要需要知道"这里曾经有过一张图"。如果静默删掉，
// 模型写出来的摘要会变成"用户描述了一个问题"，而实际上用户是发图说明的——
// 后续如果用户问"我刚发的那张图"，摘要里毫无线索，会话就断了。
//
// 保留一个 `[image]` 占位符只花 2 个 token，换回的是语义连续性。'''),

(167, 'before', '''// 图也可能藏在 tool_result 里面——比如用户让模型读一个 PDF 或截图，
// 工具返回的 content 数组里就有 image / document 块。
//
// 这层嵌套很容易漏：外层 block 是 `tool_result`（不是 image），
// 上面的 `if (block.type === 'image')` 抓不到，必须再往里钻一层。
//
// 【注意 182 行 `return [{ ...block, content: newToolContent }]`】
// 只有**真的剥掉了东西**（toolHasMedia）才构造新对象。
// 没剥的话走到 185 行的 `return [block]`，返回的是**原引用**。
//
// 这个"没改动就返回原对象"的模式在整份代码库里反复出现（188 行同理），
// 目的是保住引用相等性——下游可能有 Map 缓存、React memo、
// 或者像 claude.ts 里那种"引用被延迟队列持有"的地方。
// 一旦无条件浅拷贝，这些优化全部失效，而且极难排查。'''),

(202, 'before', '''// 第二道减肥：剥掉"压缩后会被重新注入"的附件。
//
// 这个思路和上面剥图不同。剥图是"摘要不需要"，这里是"喂给摘要器是浪费"。
//
// 具体两类：
//   · skill_discovery —— 技能发现信号
//   · skill_listing   —— 技能清单（约 4K token）
//
// 注释说得很清楚：这两类在压缩后会被 `resetSentSkillNames()` +
// 下一轮的 discovery 信号重新推出来。也就是说**它们本来就是每轮重建的**，
// 摘要器读一遍不但没用，还会把过期的技能建议写进摘要里
// （"polute the summary with stale skill suggestions"）。
//
// 这是压缩设计里的一个通用原则：**凡是"可重建的派生信息"，都不要进摘要**。
// 摘要应该只装"无法从别处恢复的原始事实"。'''),

(212, 'before', '''// 又是 DCE：`feature('EXPERIMENTAL_SKILL_SEARCH')` 在外部构建里是 false，
// 整个 filter 分支被删掉，函数退化为 `return messages`（零成本直通）。
//
// 注释专门写了这一点："No-op when EXPERIMENTAL_SKILL_SEARCH is off
// (the attachment types don't exist on external builds)"。
//
// 【这是读这类代码时容易困惑的地方】
// 你可能会想："那两种 attachment 类型明明在 types 里定义了，怎么会不存在？"
// 答案是：类型定义在内部构建里也带 `feature()` 分支，或者干脆就是内部专有的
// 类型文件。外部构建的类型系统在编译期就把它们排除了——
// 所以这个 filter 里的 `m.attachment.type === 'skill_discovery'`
// 在外部构建的 TypeScript 检查里本身就会报"类型不可能相等"，
// 只能靠 feature 分支把它整段藏起来。'''),

(225, 'before', '''// 三个固定的错误文本常量。
//
// 它们的用途不只是"给人看"——`addErrorNotificationIfNeeded`（行 1108）
// 会用 `hasExactErrorMessage` 做**字符串精确比对**来决定要不要弹错误通知。
// 也就是说这些字符串是**控制流的一部分**，改一个字就会让"不该弹的通知弹出来"。
//
// 这是全代码库反复出现的一种模式：错误消息当错误码用。
// 它的代价是——任何一次文案润色都可能悄悄改掉行为。'''),

(230, 'before', '''// ═══ PTL 逃生舱（CC-1180）═══
//
// PTL = Prompt Too Long。场景是：上下文已经撑到上限了，
// 自动压缩赶来救场，结果**压缩请求本身也超了上限**。
// 这时用户彻底卡死——不能继续对话，也不能压缩，死循环。
//
// doc 注释里那句 "This is the last-resort escape hatch" 说得很准确。
// 它不优雅，但能让人从坑里爬出来。
//
// 【注意注释里承认的一件事】
// "The reactive-compact path (compactMessages.ts) has the proper retry loop
//  that peels from the tail; this helper is the dumb-but-safe fallback for
//  the proactive/manual path that wasn't migrated in bfdb472f's unification."
//
// 翻译：响应式压缩（413 之后那条路）有正经的尾巴剥离循环，
// 而这个函数是给"主动压缩 / 手动 /compact"用的笨办法——
// 因为当年 bfdb472f 那次统一重构**没把它迁过去**。
//
// 这是很有价值的线索：说明代码库里有两条压缩路径，一条先进一条落后，
// 而落后的那条还在生产上跑。读的时候不要把这里的实现当成"最佳实践"，
// 它自己都承认是遗留物。'''),

(247, 'before', '''// 【这是全文件最刁的一行，值得单独讲】
//
// 上一次重试如果加了 marker（284 行那段补的合成用户消息），
// 那么**这次**进来时，messages[0] 就是那个 marker 本身。
//
// 如果不先剥掉它，会发生什么：
//   · marker 自己成为 group 0（groupMessagesByApiRound 会把它当成独立一轮）
//   · 20% 回退分支算 `floor(groups.length * 0.2)`，组数少的时候 = 1
//   · 于是"删 1 组"删的就是 marker
//   · 264-289 行又把 marker 加回去
//   · **净效果为零，第二次重试和第一次完全一样**
//
// 注释原话："the 20% fallback stalls (drops only the marker, re-adds it,
// zero progress on retry 2+)"。
//
// 这是一个典型的"重试循环里混进了自己的副作用"bug。
// 修复方式不是改删的逻辑，而是**每次进来先把上次的副作用清掉**——
// 保证每一轮都在同一个干净基线上做决策。
//
// 【读这类代码的方法论】
// 看到 `for(;;)` 或 `for (let attempt...)` 里有"往输入里塞东西"的操作，
// 第一件事就是找"有没有在下一轮开头把它摘掉"。没有就是无限循环。'''),

(257, 'before', '''// 按"API 轮次"分组，而不是按消息条数。
//
// 一轮 = 一条 assistant（含 tool_use）+ 对应的 user（含 tool_result）。
// 必须按轮切，因为**切开工具调用和它的结果会让 API 直接报错**。
// 这个约束在 claude.ts 的 `normalizeMessagesForAPI` 里也处理过。
//
// `if (groups.length < 2) return null` —— 只剩一轮就没法再砍了，
// 砍完没东西可摘要。返回 null 让调用方走"放弃并报错"分支。'''),

(260, 'before', '''// 【两条完全不同的删法，取决于能不能从错误消息里抠出数字】
//
// `getPromptTooLongTokenGap(ptlResponse)` 会去解析 API 返回的错误文本，
// 比如 `"...exceed context limit: 188059 + 20000 > 200000"`，
// 算出"还差多少 token"（这里是 18059）。
//
// 拿到数字 → 262-269 行精确累加：从头开始一组一组加 token 数，
// 加到刚好覆盖这个缺口就停。**只删必要的量**，因为每删一条都是信息损失。
//
// 拿不到数字 → 270-272 行粗暴砍 20%。
// 为什么拿不到？注释说了：Vertex / Bedrock 的错误格式不一样。
// 这个解析依赖自然语言的精确格式，是全代码库最脆弱的地方之一
// （第 6 步 withRetry.ts 的 `parseMaxTokensContextOverflowError` 同一个毛病）。'''),

(274, 'before', '''// 至少留一组，否则摘要器收到空输入。
//
// 这里的 `groups.length - 1` 和上面的 `dropCount` 取 min，
// 意味着最坏情况只删掉第一组——信息损失最小，但也可能根本不够。
// 不够的话下一轮循环还会再进来砍一次（`MAX_PTL_RETRIES = 3`）。'''),

(279, 'before', '''// 【这一段解释了整份代码库里最隐蔽的一个约束】
//
// `groupMessagesByApiRound` 的分组规则是：
//   · 第 0 组 = 对话开头的 user 消息（preamble）
//   · 之后每一组开头都是 assistant
//
// 所以砍掉第 0 组之后，剩下的第一条消息是 **assistant**。
// 而 Anthropic API 硬性要求：**第一条消息必须是 role=user**。
// 直接发过去就是一个 400。
//
// 注释里那句 "ensureToolResultPairing already handles any orphaned
// tool_results this creates" 是在说：另一层已经有兜底，
// 但"首条必须是 user"这条没法靠它修，必须在这里补。'''),

(284, 'before', '''// 补一条合成的 user 消息当门面，内容是 PTL_RETRY_MARKER。
//
// 注意它设了 `isMeta: true`——这个标记让 UI 不显示这条消息
// （用户不该看见"系统为了重试塞了一句占位"）。
//
// 【三行代码串起来看，就是一个完整的坑】
//   247 行：进来先把自己上次加的 marker 剥掉
//   284 行：需要时再加一个
//   228 行：marker 的文本是固定的常量
//
// 三者缺一不可。少了 247，重试会原地打转；少了 284，API 报 400；
// 少了 228 的常量复用，247 的字符串比对就匹配不上。'''),

(293, 'before', '''// 又是三个当错误码用的消息常量，这次是给 UI 看的。
//
// 注意 `ERROR_MESSAGE_PROMPT_TOO_LONG` 的措辞：
//   "Conversation too long. Press esc twice to go up a few messages and try again."
//
// 它建议的操作是「按两次 Esc 回退几条消息」——这说明在 PTL 逃生舱失败之后，
// 用户唯一能自救的办法就是**手动删掉最近几条消息**。
// 也就是说：这个常量代表的是"所有自动手段都用尽了"的终点。
//
// `ERROR_MESSAGE_INCOMPLETE_RESPONSE` 的措辞更委婉：
//   "Compaction interrupted · This may be due to network issues — please try again."
// 注意中点分隔符和破折号——这是 UI 排版考虑，不是随手打的。'''),

(299, 'before', '''// ═══ 压缩的返回值 ═══
//
// 这个接口里有个**历史遗留的命名陷阱**，必须提前说清楚：
//
//   `postCompactTokenCount`      ← 名字像"压缩后的大小"，其实不是
//   `truePostCompactTokenCount`  ← 名字很怪，但**这个才是**压缩后的大小
//
// 真相在 626 行那段注释里：`postCompactTokenCount` 本来是照这个意思命名的，
// 后来发现它实际装的是**压缩那次 API 调用自己的 usage**
// （`input_tokens` ≈ 压缩前的输入量），跟"压缩后剩下多少"毫无关系。
// 但因为这个字段已经进了埋点系统（tengu_compact 事件），改名会断掉历史数据，
// 所以只能**加一个 trueXxx 字段，原来的名字留着**。
//
// 这是一个非常典型的"埋点字段不可改"成本。读的时候记住：
// 凡是看到 `postCompactTokenCount`，都当它是"压缩调用花了多少"，
// 不是"压缩后剩多少"。'''),

(312, 'before', '''// 这四个字段的存在理由，注释写得很直白：
// "Lets the tengu_compact event disambiguate same-chain loops (H2) from
//  cross-agent (H1/H5) and manual-vs-auto (H3) compactions without joins."
//
// 翻译：数据分析（BQ）那边要靠这些字段区分三种"压缩太频繁"的原因，
// 而又不想做多表 join。所以把诊断信息**直接塞进事件里**。
//
// 三种假设的编号（H1/H2/H3/H5）说明这是从一次真实的数据分析任务
// 倒推回来的设计——先有"为什么压缩老是触发"的疑问，
// 再问"需要哪些字段才能回答"，最后才加这些参数。
//
// 【这条注释的教学价值】
// 它展示了一种很实用的做法：**埋点字段的设计是从分析问题倒推的**，
// 不是为了"多记点东西说不定有用"。凡是看到这种带 H1/H2 编号的注释，
// 说明背后有一份数据分析文档，值得顺着找。'''),

(325, 'before', '''// 这个函数的唯一价值是**顺序**。
//
// 注释里那行 "Order: boundaryMarker, summaryMessages, messagesToKeep,
// attachments, hookResults" 是契约，不是描述。
//
// 顺序为什么重要：
//   · boundaryMarker 必须是第一条——`getMessagesAfterCompactBoundary`
//     靠它做向后扫描，找"压缩后的起点"
//   · summaryMessages 紧跟其后——摘要必须紧贴边界，否则会被
//     "找最后一个 boundary" 的逻辑跳过
//   · messagesToKeep 在摘要**之后**——保留的消息代表"更近的历史"，
//     位置在摘要后面才符合时间序
//   · attachments 和 hookResults 最后——它们不是"对话内容"，
//     是"附加信息"，放后面不干扰边界扫描
//
// 全量压缩和局部压缩两个入口都调这个函数，就是为了保证两条路径
// 拼出来的数组**长得一模一样**。否则 `--resume` 还原时会出各种怪问题。'''),

(340, 'before', '''// 给边界标记挂上"保留段"的元数据。
//
// 场景：局部压缩之后，被保留的那段消息在磁盘上**没有移动**，
// 它们的 `parentUuid` 还指着压缩前的旧父节点。如果不管，
// `--resume` 加载时会走一条断掉的链——保留段变成孤儿。
//
// 解法是在 boundary 上记三个 uuid：
//   headUuid   = 保留段第一条
//   tailUuid   = 保留段最后一条
//   anchorUuid = **保留段前面应该接谁**（这个字段是重点）
//
// 加载器读到这个元数据后做两处修补：
//   head 的父指针 → anchorUuid
//   anchor 的其他子节点 → tailUuid
//
// 【`anchorUuid` 的语义随方向变化，这是最容易搞混的地方】
// 注释里列了：
//   · suffix-preserving（reactive / session-memory）：anchor = 最后一条摘要消息
//     ——因为摘要在前、保留段在后，所以保留段接在摘要后面
//   · prefix-preserving（partial compact 的 'from'）：anchor = boundary 自己
//     ——因为保留段在前、摘要在后，保留段接在边界后面
//
// 这个区别在 1078 行有个显式的三元表达式，是同一个概念的第二处体现。'''),

(354, 'before', '''// 没有保留段就原样返回 `boundary`（同一个对象，不是拷贝）。
// 又是"没改动就不造新对象"的模式。'''),

(369, 'before', '''// 把两处来的指令拼起来：用户自己写的（`/compact 关注 XXX`）+ hook 给的。
//
// 顺序有讲究：**用户在前，hook 在后**。因为 hook 通常是组织级策略
// （"摘要里必须包含 ticket 编号"），用户的是本次临时要求，
// 用户的话放前面权重更高——模型对靠前的内容更敏感。
//
// `|| undefined` 这个写法是为了把空字符串归一成 undefined。
// 因为 380 行要判 `if (!userInstructions)`，空字符串和 undefined
// 在 `!` 下等价，但返回值类型上要统一，否则调用方拿到的可能是 `''`，
// 再往下传会变成"有个空的 customInstructions"，让 prompt 里多出一段空段落。'''),

(383, 'before', '''// ═══════════════════════════════════════════════════════════════
// 全量压缩的主函数（376 行，387-763）
//
// 输入：整个 messages 数组
// 输出：一个 CompactionResult（摘要 + 新边界 + 一堆附件）
//
// 【整体时序，先看骨架再看细节】
//
//    401  数一下压缩前多少 token（只为了埋点）
//    413  跑 PreCompact hook（用户可以在压缩前插手）
//    435  查"能不能复用主线程的 prompt cache"这个开关
//    450  ┌─ for(;;) PTL 重试循环
//    451  │    发请求拿摘要
//    460  │    摘要是 PTL 错误？→ 砍历史 → 回到循环头
//    493  └─ 循环出来后分类失败（无摘要 / API 错误）
//    518  快照文件读取状态，然后**清空**（关键顺序）
//    532  并行生成各种附件
//    592  跑 SessionStart hook（压缩等于一次"会话重启"）
//    598  造边界标记 + 摘要消息
//    650  打埋点
//    697  通知缓存检测器"这是压缩导致的缓存断层，别报警"
//    711  重新追加会话元数据（--resume 显示标题要用）
//    723  跑 PostCompact hook
//    738  返回
//
// 【两个 finally 里做的事很关键，别看漏】
// 757-762：不管成功失败，都要把 UI 状态复位（streamMode / responseLength /
// compactProgress / sdkStatus）。少复位一个，UI 就卡在"正在压缩"上不动了。
// ═══════════════════════════════════════════════════════════════'''),

(397, 'before', '''// 空数组直接抛。注意这个错误在 `addErrorNotificationIfNeeded` 里
// 是被**排除**的（1114 行）——因为它不是故障，是用户点了个空会话的 /compact。'''),

(401, 'before', '''// `tokenCountWithEstimation` 而不是 `getTokenUsage`。
//
// 因为没有"上一次 API 响应"可查——这是压缩的**开始**，还没有任何响应。
// 所以只能本地估算（约 4 字符/token）。这个数字只用于埋点和显示，
// 不参与任何决策，所以估算足够。'''),

(406, 'before', '''// 压缩进度有五个阶段事件，UI 靠它显示进度条：
//
//   hooks_start(pre_compact)    → 开始跑压缩前 hook
//   compact_start               → 开始调模型
//   hooks_start(session_start)  → 开始跑会话启动 hook
//   hooks_start(post_compact)   → 开始跑压缩后 hook
//   compact_end                 → 全部结束（在 finally 里）
//
// 注意 `hooks_start` 出现了三次，靠 `hookType` 区分。
// 这个设计的好处是 UI 只需要处理两种事件类型。'''),

(411, 'before', '''// PreCompact hook。用户可以在这里：
//   · 检查即将被压缩的内容（做审计）
//   · 通过 `newCustomInstructions` **追加**摘要指令
//     （比如"务必把数据库 schema 变更写进摘要"）
//   · 通过 `userDisplayMessage` 在界面上显示一段提示
//
// 注意 415 行传的 `trigger: isAutoCompact ? 'auto' : 'manual'`——
// hook 脚本可以据此决定要不要插手。自动压缩是高频操作，
// hook 里做重活会拖慢整个循环。
//
// 传 `abortController.signal` 意味着用户按 Esc 能中断 hook 本身。'''),

(420, 'before', '''// hook 给的指令和用户给的指令合并，然后**覆盖** `customInstructions`。
//
// 注意这里是重新赋值（`customInstructions = ...`），
// 而不是新开一个变量。所以后面 440 行的 `getCompactPrompt(customInstructions)`
// 拿到的已经是合并后的版本。
//
// 这种"就地覆盖参数"的写法在长函数里不太好读，但这里只有一个消费点，还能接受。'''),

(431, 'before', '''// ═══ 这五行注释是整份代码库里最有说服力的一段数据 ═══
//
// 读三遍：
//   "Experiment (Jan 2026) confirmed: false path is 98% cache miss,
//    costs ~0.76% of fleet cache_creation (~38B tok/day)"
//
// 翻译：2026 年 1 月做过实验，如果**不**复用主线程的 prompt cache
// （也就是 `false` 那条路），压缩请求的缓存命中率是 **2%**，
// 白白烧掉整个机队 0.76% 的 cache_creation，约 **380 亿 token/天**。
//
// 为什么会这么惨？因为压缩请求和主对话共享：
//   · 同一个 system prompt（约 10K token）
//   · 同一整套工具定义（约 15-20K token）
//   · 同一个消息前缀（整个历史）
//
// 如果不复用，这三块全部要按 cache_creation 全价计费。
// 而缓存命中的前提是**前缀字节完全一致**——这就是为什么
// 1181 行那段注释死活不让设 `maxOutputTokens`（后面细讲）。
//
// 注释最后一句也重要："GB gate kept as kill-switch"
// 虽然默认 true，但留了一个 GrowthBook 开关，出问题能一键关掉。
// 这是所有高风险优化的标准配置：**默认开、留开关、埋对比数据**。'''),

(440, 'before', '''// 摘要请求的 prompt。注意它是作为一条 **user 消息** 发出去的
// （441-443 行 `createUserMessage`），不是 system prompt。
//
// 为什么？因为如果塞进 system prompt，整个 system 就变了，
// 上面那个"复用主线程缓存"就废了。作为 user 消息追加在历史末尾，
// 前面的前缀完全不变，缓存才能命中。
//
// 【这是一个贯穿整个压缩设计的原则】
// **要发新指令，就追加在末尾，不要改动前面。**
// claude.ts 里那些 delta attachment（`deferred_tools_delta` 等）
// 是同一个原则的另一处应用。'''),

(450, 'before', '''// ═══ PTL 重试循环（CC-1180 的具体落地）═══
//
// `for(;;)` 没有条件——退出全靠里面的 `break`（460 行，正常拿到摘要）
// 和 `throw`（477 行，放弃）。
//
// 这个循环最多转 4 次：原始 1 次 + `MAX_PTL_RETRIES`(3) 次截断重试。
// 超过就是 `truncated = null` → 抛 `ERROR_MESSAGE_PROMPT_TOO_LONG`
// → 用户看到"按两次 Esc 回退几条消息"。
//
// 【注意 446 行 `retryCacheSafeParams`】
// 它和 `messagesToSummarize` 是**两个必须同步更新的变量**。
// 原因在 485 行那段注释：forked-agent 路径读的是
// `cacheSafeParams.forkContextMessages`，**不是** 函数参数 `messages`。
// 只更新一个，另一条路径就会拿着旧的（没截断的）消息去请求，
// 于是再次 PTL，循环白转。'''),

(460, 'before', '''// 【为什么这里用 `startsWith(...)` 判断错误，而不是 try/catch】
//
// 因为 PTL 错误根本没被抛出来。`query()` 会把 API 错误**包装成
// 一条合成的 assistant 消息**（带 `isApiErrorMessage: true`）yield 出来，
// 而 `streamCompactSummary` 只取最后那条 assistant 消息的文本。
//
// 所以"摘要"这个变量里可能装的其实是错误消息——
// 这也解释了 1205 行那个 `isApiErrorMessage` 守卫为什么必须存在。
//
// 用一个字符串前缀来判断"这次调用失败了"，是很脆的做法，
// 但在这个架构下没有更干净的办法：错误已经变成"正常返回值"了。
// 注释里的 `PROMPT_TOO_LONG_ERROR_MESSAGE` 和上面 293 行的
// `ERROR_MESSAGE_PROMPT_TOO_LONG` 是**两个不同的常量**，
// 一个是 API 原始错误前缀，一个是给用户看的文案，别搞混。'''),

(465, 'before', '''// 三元表达式把"还能不能重试"和"怎么砍"压在一起：
//   `ptlAttempts <= MAX_PTL_RETRIES` → 调 truncateHeadForPTLRetry
//   否则 → null（后面 469 行直接判 null 并放弃）
//
// 注意 `ptlAttempts++` 在这之前——所以第 1 次截断时 `ptlAttempts` 已经是 1，
// 第 3 次是 3，第 4 次是 4 > 3 → null。总共 3 次截断机会，符合常量命名。'''),

(487, 'before', '''// 【整个循环里最容易漏的一行】
//
// `retryCacheSafeParams = { ...retryCacheSafeParams, forkContextMessages: truncated }`
//
// 为什么要同时改两个东西：
//   · `messagesToSummarize` → 给"普通流式"路径用（1136 行函数的 messages 参数）
//   · `forkContextMessages` → 给"复用缓存"路径用（runForkedAgent 从 cacheSafeParams 读）
//
// 只改前者 → 缓存路径还在发完整历史 → 还是 PTL → 循环空转。
// 只改后者 → 反过来。
//
// 【这条注释的教学价值】
// 它记录了一次真实的修复："thread the truncated set through both paths"。
// 当你看到一个函数有两个数据来源（参数 + 配置对象）时，
// 任何"改写输入"的操作都要**同时改所有来源**。这是长函数最容易出的 bug 类型。'''),

(493, 'before', '''// ═══ 三种失败分类，对应三个埋点 reason ═══
//
//   `!summary`                 → 'no_summary'    模型返回了但没文本
//   `startsWithApiErrorPrefix` → 'api_error'     API 层错误被包装成消息
//   （上面 477 行）             → 'prompt_too_long'  截断也用尽了
//
// `no_summary` 的情况比想象中常见：模型可能只返回了 thinking 块
// （但这里 thinking 是 disabled 的），或者被 stop sequence 截断，
// 或者返回了纯 tool_use（但 `createCompactCanUseTool` 全 deny）。
//
// `api_error` 用的是 `startsWithApiErrorPrefix` 而不是精确比对，
// 因为 API 错误文本有无数种。而 `ERROR_MESSAGE_USER_ABORT` 那种
// 需要精确比对的，是因为那个字符串是我们自己生成的。
//
// 注意 495 行把整个响应 JSON 化后打进调试日志——这可能是几 KB 的内容，
// 只在 `level: 'error'` 时落盘，所以生产环境平时看不见。'''),

(507, 'before', '''// ⚠️ 注意这里有个细节：`api_error` 分支直接把 `summary`（错误文本）
// 当成 `throw new Error(summary)` 抛出去。
//
// 也就是说用户看到的错误消息就是 API 的原始文本。
// 这是有意的——API 错误往往包含可操作信息（比如配额、模型名、区域），
// 包一层"压缩失败"反而丢失信息。'''),

(517, 'before', '''// 【顺序：先快照，再清空。这两行不能换】
//
// `preCompactReadFileState` 是给 `createPostCompactFileAttachments` 用的，
// 它要按"最近读过"的顺序挑文件重新注入。
//
// 如果先 clear 再快照，拿到的是空对象 → 压缩后一个文件都不恢复
// → 模型得把之前读过的文件全部重新 Read 一遍。
// 在长会话里这可能是几十次工具调用，用户会明显感觉到"变笨了"。'''),

(520, 'before', '''// 清空文件读取状态缓存。
//
// 为什么必须清？因为这个缓存的作用是"文件没变就别重复读"——
// 它会记住每个文件的 mtime 和内容摘要，下次 Read 时如果没变，
// 就返回一个 `FILE_UNCHANGED_STUB` 而不是全文。
//
// 但压缩之后，**模型已经看不到那些文件内容了**（被摘要替换掉了）。
// 如果缓存还在，模型 Read 同一个文件时会拿到 "file unchanged" 的桩，
// 而它其实根本不知道内容是什么——彻底卡死。
//
// 所以这里清空是**为了配合压缩造成的信息丢失**，不是常规清理。
// 同理 522 行的 `loadedNestedMemoryPaths`（已加载的嵌套 CLAUDE.md 路径）。
//
// 【对照 1610 行的 collectReadToolFilePaths】
// 那个函数专门跳过 `FILE_UNCHANGED_STUB` 的 Read 记录，
// 正是因为"桩指向的完整内容可能已经被压缩掉了"。这是同一个坑的两处防御。'''),

(524, 'before', '''// ═══ 一整段"我故意没做某件事"的注释 ═══
//
// 这段比它上面写的代码更重要，因为它解释了一个**看起来像遗漏的决定**：
//
// 压缩之后没有调用 `resetSentSkillNames()`，也就意味着**不会重新注入
// 完整的 skill_listing**（约 4K token）。
//
// 三个理由：
//   1. 纯粹是 cache_creation，收益边缘
//      ——重新注入 = 全新内容 = 全价计费
//   2. 模型还有 SkillTool 在 schema 里，需要时能自己去发现
//   3. `invoked_skills` 附件（1494 行）会保住**已经用过的**技能内容
//
// 最后一句 "Ants with EXPERIMENTAL_SKILL_SEARCH already skip re-injection
// via the early-return in getSkillListingAttachments" 是在说：
// 内部用户（ant）本来就不重注，所以这个决定让内外部行为一致了。
//
// 【为什么这种注释值得单独批注】
// 代码里"没写的那行"是最难 review 的。半年后有人看到这里，
// 第一反应一定是"是不是漏了 resetSentSkillNames？"然后顺手加上，
// 于是每次压缩多烧 4K token。这种注释就是防这个的。
//
// 你自己写代码时也可以学：**凡是"刻意不做"的地方，留一句 why。**'''),

(531, 'before', '''// 并行生成两批附件。用 `Promise.all` 而不是顺序 await，
// 因为文件重读（要查磁盘 + 校验 + 截断）和 agent 状态扫描互不依赖。
//
// 注意 `createPostCompactFileAttachments` 内部还会再并发读 5 个文件，
// 所以这里实际是"嵌套并发"。所有 I/O 加起来通常几十毫秒，
// 但放到长会话（20 个文件候选）上就能感觉到差别。'''),

(541, 'before', '''// 从这里开始往下一路 push，一共七类附件。列一下全景，
// 读的时候可以对照：
//
//   542  fileAttachments        最近读过的文件（最多 5 个）
//   543  asyncAgentAttachments  后台跑着的 / 未取结果的 agent
//   545  planAttachment         当前 plan 文件内容
//   552  planModeAttachment     plan mode 的状态与指令
//   558  skillAttachment        会话中调用过的技能
//   567  deferredToolsDelta     延迟加载的工具清单
//   575  agentListingDelta      可用 agent 列表
//   578  mcpInstructionsDelta   MCP 服务器指令
//
// 再加上 592 行的 `hookMessages`（SessionStart hook 的输出）。
//
// 【这七项各自的"不补会怎样"】
//   文件      → 模型重新 Read，浪费几十次工具调用
//   agent     → 重复 spawn 同一个任务，或者忘记去取已完成的结果
//   plan      → 不知道自己在执行什么计划
//   plan mode → 直接开始改代码（本该只出方案）
//   技能      → 违反技能里的规范，输出格式全错
//   工具清单  → 以为某个 MCP 工具不存在，改用手写脚本
//   agent 列表→ 不知道可以委派，全部自己干
//   MCP 指令  → 不知道某个服务器要求用特定格式调用
//
// 这些不是"锦上添花"，每一条都对应一种真实的能力退化。'''),

(552, 'before', '''// plan mode 的附件要 `await`，因为 `createPlanModeAttachmentIfNeeded`
// 内部要读 appState（判断当前是不是 plan 模式）和 plan 文件是否存在。
//
// 注意这个函数声明成 async 但其实没有任何真正的异步操作——
// 纯粹是为了和 `createAsyncAgentAttachmentsIfNeeded` 保持签名一致。
// 这种"为了对称而 async"的写法在这里无伤大雅，但会让人误以为它很慢。'''),

(563, 'before', '''// ═══ 重新宣告 delta 附件 ═══
//
// 这段的注释很短但信息量很大："Compaction ate prior delta attachments."
//
// 背景：为了不破坏 prompt cache，工具清单、agent 列表、MCP 指令这些
// **不是每轮全量塞进去，而是只在变化时推一个 diff**
// （`deferred_tools_delta` 等，见 claude.ts 的 delta attachment 机制）。
//
// 但压缩把历史全吃了，那些 delta 也一起没了。模型现在完全不知道
// 有哪些延迟加载的工具、有哪些 MCP 服务器。
//
// 解法是：**假装历史是空的，重新宣告一遍**。所以三个调用
// 传的都是空数组 `[]`——"跟空历史做 diff"，结果就是全量。
//
// 注释里那句 "Empty message history → diff against nothing →
// announces the full set" 就是在解释这个技巧。
//
// 【这是一个很聪明但也很难懂的设计】
// 它把"全量推送"表达成"跟空集合的差集"，从而**复用同一个函数**，
// 不用写两套代码。代价是读代码的人必须理解 diff 语义才能看懂
// 为什么传空数组。局部压缩那边（957 行）传的是 `messagesToKeep`，
// 因为保留段里已经宣告过的部分要跳过——这正好说明了这套语义的价值。'''),

(587, 'before', '''// 压缩完成后跑 SessionStart hook。
//
// 为什么压缩要触发"会话启动"？因为从模型的角度看，**这就是一次新会话**：
// 上下文被重置成"摘要 + 附件"，跟 `--resume` 加载一堆历史的效果类似。
//
// 所以任何"会话开始时要做的事"（加载环境信息、检查 git 状态、
// 注入项目约定）在这里也要做一遍。漏了的话，压缩后模型会突然
// "忘记"项目约定，行为明显退化。'''),

(596, 'before', '''// 【先造边界标记和摘要消息，再打埋点——顺序有原因】
//
// 注释："Create the compact boundary marker and summary messages before the
// event so we can compute the true resulting-context size."
//
// 因为埋点里要记 `truePostCompactTokenCount`（压缩后上下文真实大小），
// 而这个数必须把 boundary + summary + attachments + hookMessages
// 全算进去（637 行那段）。所以这几样必须先造出来。
//
// 如果先打埋点再造这些，就只能记"摘要本身多大"，漏掉附件——
// 而附件往往比摘要还大（前面算过，最多 25K 文件 + 25K 技能）。
// 那个数就会严重偏低，导致 `willRetriggerNextTurn` 判断错误。'''),

(603, 'before', '''// ═══ 这一小段是压缩正确性的关键，但极易被忽略 ═══
//
// 问题：延迟加载的 MCP 工具，模型必须"用过一次"才会把 schema 真正加载进来。
// 这个"已加载"的状态是记在消息历史里的 `tool_reference` 块上的。
//
// 而摘要**不会保留 tool_reference 块**——摘要是自然语言，写不出结构化引用。
//
// 后果：压缩之后，这些工具的 schema 从请求里消失了。模型会看到
// 一个自己"曾经用过"的工具突然变成"未加载"状态，于是重新加载一次
// （或者干脆认为它不存在）。
//
// 解法：把已加载的工具名记在 boundary 的 `compactMetadata` 里。
// 之后 claude.ts 的 schema 过滤器会读这个字段，继续把那些 schema 发给 API。
//
// 【这行代码为什么值得单独批注】
// 它体现了一个通用模式：**任何"藏在消息内容里的状态"，压缩前都要
// 显式搬到 boundary 上**。因为 boundary 是唯一保证活过压缩的东西。
// 后面 1023 行的 `extractDiscoveredToolNames(allMessages)` 是同一件事
// 在局部压缩里的版本（用 allMessages 而不是 messagesToSummarize，
// 因为并集是幂等的，比判断"这条工具落在哪半边"简单）。'''),

(613, 'before', '''// 拿 transcript 路径，写进摘要消息里（616 行的 `getCompactUserSummaryMessage`
// 会把它塞进文案）。
//
// 目的是告诉模型："完整历史在这个文件里，需要细节可以自己去读"。
// 这样即使摘要漏了某个细节，模型还有补救的途径——而不是彻底失忆。
//
// 这是"摘要 + 指针"的经典设计：摘要负责省 token，
// 指针负责在需要时能找回原物。'''),

(626, 'before', '''// ═══ 这段注释记录了一次命名事故，值得完整读 ═══
//
//   "Previously 'postCompactTokenCount' — renamed because this is the
//    compact API call's total usage (input_tokens ≈ preCompactTokenCount),
//    NOT the size of the resulting context. Kept for event-field continuity."
//
// 翻译：这个值以前叫 `postCompactTokenCount`，但它的实际含义是
// **"压缩那次 API 调用花了多少 token"**（`input_tokens` 约等于压缩前的输入量），
// 跟"压缩后上下文剩多少"完全不是一回事。
//
// 想想有多离谱：一个叫"压缩后 token 数"的字段，实际存的是
// "压缩前有多少 token"。任何人看埋点都会得出相反的结论——
// 压缩后 180K？那压缩根本没起作用啊。
//
// 修复方式是改局部变量名（`compactionCallTotalTokens`），
// 但 **event 字段名保持 `postCompactTokenCount` 不变**，
// 注释原话 "Kept for event-field continuity"——为了历史数据能连上。
//
// 【这是一个无法两全的权衡】
// 改名 → 埋点数据断层，之前的图表全部失效
// 不改 → 每个新人都要踩一次这个坑
// 他们的选择是"改代码里的名字 + 注释说明"，代价是读埋点定义的人
// 仍然会误解，除非他点进代码看。
//
// 读源码时遇到这种"名字和含义不符"的地方，通常都能在附近找到
// 类似的历史说明。**这是最有价值的注释类型之一**，因为它记录的
// 是"为什么不能改成正确的东西"。'''),

(633, 'before', '''// ═══ 这才是"压缩后剩多少" ═══
//
// 注意注释里那个 20-40K 的提醒：
//   "The next iteration's shouldAutoCompact will see this PLUS ~20-40K for
//    system prompt + tools + userContext (via API usage.input_tokens)."
//
// 意思是：这里算出来的只是**消息部分的估算**。下一轮真正的
// 上下文大小 = 这个数 + system prompt（约 10K）+ 工具定义（约 15-20K）
// + userContext（环境信息等）。
//
// 所以 `willRetriggerNextTurn` 的判断（656 行）是：
//   这个估算值 >= 自动压缩阈值？
//
// 注释说得很谨慎："`true` 是个强信号；`false` 仍可能触发"。
// 因为如果估算值离阈值只差一点点，加上那 20-40K 就超了。
//
// 【这是一个诚实的注释】
// 它没有假装这个判断很准，而是明确说了两个方向的可靠性不对称。
// 这种诚实比一个"看起来精确"的公式有用得多。'''),

(650, 'before', '''// `tengu_compact` 是这个文件最重要的埋点。字段大约 30 个，分四组：
//
//   ① 规模       preCompactTokenCount / truePostCompactTokenCount
//   ② 触发原因   isAutoCompact / autoCompactThreshold / willRetriggerNextTurn
//   ③ 调用链     querySource / queryChainId / queryDepth /
//                isRecompactionInChain / turnsSincePreviousCompact
//   ④ 成本       compactionInputTokens / OutputTokens /
//                CacheReadTokens / CacheCreationTokens / TotalTokens
//
// 【第 ③ 组最值得注意】
// `isRecompactionInChain` + `turnsSincePreviousCompact` + `previousCompactTurnId`
// 三个字段合起来能回答一个很关键的问题：
// **"这个用户是不是在压缩→几轮→又压缩的循环里打转？"**
//
// 如果是，说明压缩没起作用——可能是摘要太长、或者附件太重、
// 或者用户的工作模式本身就需要超长上下文。这是产品决策的输入，
// 不是工程 bug。
//
// 【第 ④ 组的一个细节】
// `compactionTotalTokens` 是四个数相加：普通输入 + 缓存创建 + 缓存读 + 输出。
// 注意这里的"输入"和"缓存读"是分开算的，因为单价不同（缓存读便宜一个数量级）。
// 把三者加成"总额"只用于粗看，真实成本要用分项算。'''),

(682, 'before', '''// ═══ 一个 11 毫秒的同步遍历，为什么要用 IIFE 包起来 ═══
//
// 注释说得很清楚：
//   "analyzeContext walks every content block (~11ms on a 4.5K-message session)
//    purely for this telemetry breakdown. Computed here, past the compaction-API
//    await, so the sync walk doesn't starve the render loop before compaction
//    even starts."
//
// 翻译：`analyzeContext` 要遍历每一条消息的每一个 content block，
// 4,500 条消息的会话上要 **11 毫秒**。这纯粹是为了埋点里的分类统计
// （多少 token 是用户文本、多少是工具结果、多少是图片…）。
//
// 关键在"computed here, past the compaction-API await"：
// 如果放在函数开头算，那是在**压缩开始前**，UI 正在显示"正在压缩"，
// 主线程被占 11ms 会明显卡一下（Ink 的渲染是同步的）。
// 放在这里算，压缩的 API 调用已经结束了，接下来本来就是等待，
// 这 11ms 就不影响观感。
//
// 【IIFE + try/catch 的写法意图】
// IIFE（立即执行函数）是为了在对象字面量里塞一段语句块——
// `...(() => {...})()` 展开成一个对象。这是唯一能在对象里
// 做"局部变量 + 条件返回"的写法。
//
// try/catch 是因为埋点**绝对不能影响主流程**。
// 如果 `analyzeContext` 在某个畸形消息上崩了，不能让压缩失败。
// 这种"埋点用 try 包住"的做法在全代码库随处可见——
// 只要看到 `catch (error) { logError(error); return {} }` 就知道是这个意图。
//
// 【顺带说一个性能细节】
// `analyzeContext(messages)` 用的是**压缩前**的 messages，
// 不是压缩后的。因为这个埋点要回答"这次压缩吃掉了什么"，
// 所以要看被吃掉的那部分构成。'''),

(697, 'before', '''// ═══ 通知缓存检测器 ═══
//
// `notifyCompaction` 做的事：告诉"prompt cache 断裂检测"系统
// "接下来会看到一次巨大的缓存断层，那是压缩导致的，不是我干的"。
//
// 为什么要专门通知？因为那个检测系统（promptCacheBreakDetection.ts）
// 的逻辑是：如果连续两次请求的前缀差异很大，就报一次
// `tengu_prompt_cache_break` 事件，用来发现"某处代码不小心改动了前缀"。
//
// 但压缩**故意**要换掉整个前缀（历史全变成摘要了）。不通知的话，
// 每次压缩都会误报一次缓存断裂——真实故障就被淹没了。
//
// 【上一轮读 autoCompact 时发现的相关 bug】
// session memory 那条压缩路径忘了调 `notifyCompaction`，
// 导致约 20% 的缓存断裂告警是误报（BQ 2026-03-01 定位）。
// 两条实现路径漏同步副作用，是这类"跨模块通知"的典型故障。
//
// `markPostCompaction()` 是另一件事：在 bootstrap state 上打个时间戳，
// 让其他地方能查"刚刚压缩过"。两个调用解决两个问题，别混。'''),

(706, 'before', '''// ═══ 重新追加会话元数据 ═══
//
// 场景：用户给会话起了个名字（`/rename 修登录 bug`）。这个名字存在
// transcript 文件的**末尾**，`--resume` 列表靠读最后 16KB 来显示它。
//
// 压缩之后会往 transcript 里写一大堆新消息（摘要、附件…），
// 把那条元数据挤出 16KB 窗口 → `--resume` 列表显示的是自动生成的标题，
// 用户起的名字没了。
//
// 解法就是在压缩后重新追加一遍（重复了也没关系，读的时候取最后一条）。
//
// 【这是一个"窗口型存储"的经典坑】
// 任何"只读文件尾部 N KB"的设计，都要考虑"如果后面又写了东西怎么办"。
// 这里的答案是"重要元数据每次写完都重追加一次"。
// 简单粗暴，但比改成扫全文件（大 transcript 会慢）划算。'''),

(713, 'before', '''// KAIROS 专有：把压缩前的消息写成一个"精简 transcript 段"。
//
// `void` 前缀 = 不 await，fire-and-forget。注释说
// "errors are logged internally"——内部自己 try/catch 了，
// 失败不会影响压缩流程。
//
// 【为什么可以不等】
// 这个写盘操作对**当前这次压缩**没有任何影响——它只是归档。
// 等它反而会让用户多等几十毫秒。这类"日志/归档"操作
// 基本都是 fire-and-forget，`void` 前缀就是标记。'''),

(731, 'before', '''// 把两个来源的显示消息拼起来：PreCompact hook 的 + PostCompact hook 的。
//
// `.filter(Boolean)` 去掉空值，`.join('\n')` 用换行连接。
// 最后 `|| undefined` 把空字符串转成 undefined——保持 CompactionResult
// 的类型契约（要么有内容要么没有，不要空串）。
//
// 这个显示消息会在 UI 上显示给用户（比如 hook 说"已把 schema 变更写入摘要"）。
// 它**不发给模型**，纯 UI 用途。'''),

(749, 'before', '''// ═══ catch 里的判断很重要 ═══
//
// 注释：
//   "Only show the error notification for manual /compact.
//    Auto-compact failures are retried on the next turn and the
//    notification is confusing when compaction eventually succeeds."
//
// 翻译：只有用户手动 `/compact` 失败才弹错误通知。
// 自动压缩失败**不弹**，因为：
//   · 下一轮会再试（`autoCompactionFailureCount` 那个熔断计数还没到 3）
//   · 如果真的下一轮成功了，用户会看到"出错了"然后又"好了"——莫名其妙
//
// 这是一个很实用的 UI 原则：**对"会自动重试的操作"，不要报瞬时失败**。
// 只在"彻底放弃"时才打扰用户。'''),

(757, 'before', '''// finally 里四件事，每一件漏了都有具体后果：
//
//   setStreamMode('requesting')   → 不设的话 UI 卡在"正在响应"
//   setResponseLength(() => 0)    → 不重置的话字符计数器保留旧值，
//                                   下一轮显示的字数从上次的位置继续涨
//   onCompactProgress(compact_end)→ 不发的的话进度条永远不消失
//   setSDKStatus(null)            → SDK 客户端一直以为在 compacting
//
// 【注意 758 行和 836 行、758 和 1101 行是三处重复】
// `compactConversation`、`partialCompactConversation` 两个函数的 finally
// 完全一样。这是可以抽出去的重复，但没抽——大概是怕抽成函数后
// 有人只改一处。这类"刻意保留的重复"在长函数里很常见。
//
// `setResponseLength(() => 0)` 传的是**函数**不是值，因为它内部
// 是 `setState(prev => ...)` 的形式，传函数才能拿到最新值。'''),

(765, 'before', '''// ═══════════════════════════════════════════════════════════════
// 局部压缩（335 行，772-1106）
//
// 和全量压缩的区别：只压一半，另一半**原样保留**。
// 分界点由用户在消息选择器（按两次 Esc 打开）里手动指定。
//
// 【两个方向，名字很容易记反，注释专门解释了】
//
//   direction = 'from'   → 摘要 pivotIndex **之后**的消息，保留之前的
//                          （"从这条往后压掉"）
//                          保留段在前 → **prompt cache 保留**
//
//   direction = 'up_to'  → 摘要 pivotIndex **之前**的消息，保留之后的
//                          （"压到这条为止"）
//                          摘要在前 → **prompt cache 失效**
//
// 注意最后两行：拖住缓存的是"保留段是否在最前面"。
// 因为 prompt cache 是**前缀缓存**——只有从头开始连续相同的部分才能命中。
// 'from' 方向保留的是开头，所以缓存还在；'up_to' 方向开头就换成了摘要，
// 缓存必然全废。
//
// 这个结论直接影响 852 行那个优化：'from' 方向要发 **全部消息**
// （包括要被摘要掉的尾巴），因为尾巴单独发不会命中缓存，
// 不如带着完整历史发，让前缀至少能命中。
// ═══════════════════════════════════════════════════════════════'''),

(785, 'before', '''// ═══ 这段注释解释了一个非对称的过滤规则，非常值得细读 ═══
//
// `messagesToKeep` 在 'up_to' 方向要**额外**剥掉三种东西：
//   · progress 消息（两个方向都剥）
//   · 旧的 compact boundary
//   · 旧的压缩摘要（`isCompactSummary` 的 user 消息）
//
// 为什么 'from' 方向**不**剥？注释给了两个理由，都很微妙：
//
//   理由 1："for 'up_to', summary_B sits BEFORE kept, so a stale boundary_A
//            in kept wins findLastCompactBoundaryIndex's backward scan
//            and drops summary_B."
//   ——'up_to' 时，保留下来的段里可能藏着一个**旧的** boundary_A。
//     而 `findLastCompactBoundaryIndex` 是**从后往前扫**找最后一个 boundary。
//     如果保留段里有旧的 A，它会**盖住**新写入的 summary_B，
//     导致加载器以为最后一条边界是 A，把 B 之后的内容全当成"压缩前"丢掉。
//
//   理由 2："'from' keeps them: summary_B sits AFTER kept (backward scan
//            still works), and removing an old summary would lose its
//            covered history."
//   ——'from' 时新摘要在**后面**，向后扫描先看到 B 再看 A，顺序正确。
//     而且删掉旧摘要会丢掉它覆盖的那段历史（那是唯一记录）。
//
// 【这段注释的教学价值极高】
// 它展示了一种思考方式：**不是"该不该删"，而是"删了之后扫描顺序会不会错"**。
// 同一个操作在两个分支里效果相反，原因不在操作本身，在于
// **下游有一个依赖方向的扫描**。
//
// 读这种代码时，先去找那个"下游扫描"（`findLastCompactBoundaryIndex`），
// 才能理解为什么两边规则不一样。否则只会觉得"这里写得不一致，是不是 bug"。'''),

(802, 'before', '''// 空输入检查，两个方向各有各的文案。
//
// 注意这里**没有**像全量压缩那样检查 `allMessages.length === 0`——
// 因为局部压缩的前提就是"有消息让你选分界点"，不可能空。
// 只可能"选了第一条"（'up_to' 时前面没东西）或"选了最后一条"（'from' 时后面没东西）。'''),

(826, 'before', '''// 三个分支拼 `customInstructions`，优先级：
//   hook 指令 + 用户反馈  → 都拼上，hook 在前
//   只有 hook 指令         → 用它
//   只有用户反馈           → 包一层 `User context: `
//
// 注意这里和全量压缩的 `mergeHookInstructions`（374 行）**不一致**：
// 那边是"用户在前、hook 在后"，这边是"hook 在前、用户在后"。
//
// 为什么？因为语义不同：
//   · 全量压缩：`customInstructions` 是用户主动写的压缩指令
//     （`/compact 关注登录逻辑`），和 hook 是同级的"指令"
//   · 局部压缩：`userFeedback` 是用户对**这段对话**的补充说明
//     （"这里在排查 XXX bug"），是**上下文信息**不是指令，
//     所以放在 hook 的正式指令后面
//
// `User context: ` 这个前缀就是为了明确区分这两种性质。
//
// 【这是一处真实的不一致，但是合理的不一致】
// 读代码时看到两处"合并指令"逻辑不同，不要急着判定哪个是 bug。
// 先看两边输入的语义是不是同一类东西。'''),

(852, 'before', '''// ═══ 全文件最反直觉的一行 ═══
//
//   `let apiMessages = direction === 'up_to' ? messagesToSummarize : allMessages`
//
// 'from' 方向明明只需要摘要**后半段**，为什么要发**全部消息**？
//
// 注释答案："'from' prefix hits cache directly; 'from' sends all
// (tail wouldn't cache)."
//
// 展开说：
//   · 'up_to'：发前半段。这半段就是对话的开头，前缀完整 →
//     **能命中主线程的 prompt cache**，省钱
//   · 'from'：要摘要的是后半段。如果只发后半段，它的开头是
//     对话中间某处——和主线程缓存的前缀对不上 → **完全不命中**，
//     全部按全价 cache_creation 计费
//   · 既然都不命中，不如把完整历史都发过去。至少：
//       1. 摘要质量更好（有完整上下文）
//       2. 前缀部分（system + tools + 前半段）仍然能命中缓存
//
// 【这是一个"省钱的直觉反而费钱"的例子】
// 直觉：少发点 = 少花点。
// 实际：缓存是按前缀命中的，砍掉开头 = 前缀全废 = 每一段都全价。
//
// 下一行 853 的注释还补了一句："PTL retry breaks the cache prefix
// but unblocks the user (CC-1180)"——截断重试会破坏前缀，
// 但那是为了让人能用，值得。'''),

(874, 'before', '''// PTL 重试，和全量压缩那段（450-491）逻辑一样。
// 唯一的差别是这里操作的是 `apiMessages`（可能是 allMessages），
// 而不是 `messagesToSummarize`。
//
// 注意 877 行截断的还是 `apiMessages` —— 对的，因为要截的是
// **发给 API 的那份**。`messagesToSummarize` 保持不变，
// 它决定的是"最终摘要覆盖哪一段"，不是"这次请求发什么"。'''),

(918, 'before', '''// 又一次"先快照后清空"，和 517-522 完全一样。
// 三行代码重复了，但没抽函数——因为中间隔着 400 行，抽出去反而不好读。'''),

(955, 'before', '''// ═══ 和全量压缩的关键差异：传 `messagesToKeep` 而不是 `[]` ═══
//
// 全量压缩时历史被吃光了，所以要"跟空集合做 diff"= 全量宣告。
//
// 局部压缩时保留段还在，所以传 `messagesToKeep`：
// **已经在保留段里宣告过的东西会跳过**，只补被摘要掉的那部分。
//
// 注释原话："Re-announce only what was in the summarized portion —
// messagesToKeep is scanned, so anything already announced there is skipped."
//
// 【这一处对比把"delta attachment"的语义彻底讲清了】
// 同一个函数，参数不同：
//   传 []              → 全量
//   传 messagesToKeep  → 只补差集
//
// 这才是"diff"的正确用法。前面 567 行传 `[]` 是个特例（假装空历史）。'''),

(1007, 'before', '''// ═══ 一个非常隐蔽的崩溃点 ═══
//
//   "Progress messages aren't loggable, so forkSessionImpl would null out
//    a logicalParentUuid pointing at one. Both directions skip them."
//
// 场景：局部压缩要记录"压缩前最后一条消息的 uuid"，作为新边界的父节点。
// 如果那条恰好是 `progress` 类型（子 agent 的进度更新），就会出问题——
// 因为 progress 消息**不写进 transcript**（不是可记录的消息类型）。
//
// 于是 `forkSessionImpl` 在重建父子链时发现"父节点不存在"，
// 只能把 `logicalParentUuid` 设成 null → 链路断开 → `--resume` 出孤儿。
//
// 解法：两个方向都跳过 progress，往前找第一条"真实"消息。
//
// 【注意 1011 行用了 `findLast`】
// 它是从后往前找，不是 `filter().at(-1)`。后者会创建一个新数组，
// 在长会话上白白分配内存。`findLast` 是 ES2023 的方法，
// 找到第一个就停——这个选择是有意的性能考虑。'''),

(1021, 'before', '''// 用 `allMessages` 而不是 `messagesToSummarize` 来提取已加载工具。
//
// 理由注释写得很清楚："set union is idempotent, simpler than tracking
// which half each tool lived in."
//
// 翻译：反正两边都要扫，扫全部再取并集，结果一定是对的
// （一个工具无论出现在哪半边，都该被算作"已加载"）。
// 而如果只扫 `messagesToSummarize`，就会漏掉保留段里的那些——
// 那些其实也还在上下文里，不该重新加载。
//
// 【"取并集比判断归属简单"是一种很好的偷懒】
// 当两个集合的并集就是你要的答案时，不要去算"哪个元素属于哪个集合"。
// 这里省掉的分支判断，比多扫一遍数组的代价小得多。'''),

(1030, 'before', '''// ═══ 这里有个条件分支，决定了摘要消息"好不好看" ═══
//
//   `messagesToKeep.length > 0` → 挂 `summarizeMetadata`
//   否则（没保留任何消息）      → 挂 `isVisibleInTranscriptOnly: true`
//
// 区别：
//   · `summarizeMetadata`：让 UI 能显示"已摘要 42 条消息（方向 from，
//     用户备注 XXX）"。有这个元数据，UI 就能画一个可展开的摘要卡片
//   · `isVisibleInTranscriptOnly`：只在 transcript 里可见，UI 不显示。
//     用于"这次压缩把一切都吃掉了"的情况——此时摘要就是全部上下文，
//     显示成一张卡片反而奇怪（用户会以为下面是空的）
//
// 【注意 `as const`】
// `isVisibleInTranscriptOnly: true as const` 里的 `as const` 是必需的，
// 因为在一个三元里 TS 会把 `true` 推成 `boolean`，而 UserMessage 类型
// 要求的是字面量 `true`。这类细节在条件 spread 里很常见。
//
// 对比全量压缩（621-622 行）：那边**无条件**设
// `isCompactSummary: true` + `isVisibleInTranscriptOnly: true`，
// 因为全量压缩永远没有保留段。'''),

(1077, 'before', '''// ═══ anchorUuid 随方向变化（对应 340 行那段注释的实现） ═══
//
//   'up_to' → `summaryMessages.at(-1)?.uuid`
//             摘要在前、保留段在后 → 保留段接在**最后一条摘要消息**后面
//
//   'from'  → `boundaryMarker.uuid`
//             保留段在前、摘要在后 → 保留段接在**边界**后面
//             （此时边界是第一条，保留段紧跟它）
//
// `?? boundaryMarker.uuid` 是兜底：万一 summaryMessages 为空
// （理论上不可能，上面已经检查过），退回用边界。
//
// 【这个三元表达式是整个"保留段重连"机制的最后一块拼图】
//   349 行 annotateBoundaryWithPreservedSegment：写元数据
//   1078 行 这里：算出 anchor
//   两者配合，--resume 才能把断掉的链接回去
//
// 如果搞反了会怎样？保留段会接到错误的位置，出现
// "历史消息顺序乱了"或者"部分消息丢失"——而且只在 --resume 时能看出来，
// 当场调试根本发现不了。'''),

(1097, 'before', '''// 局部压缩**无条件**弹错误通知，和全量压缩不同（那边判 `if (!isAutoCompact)`）。
//
// 因为局部压缩只有手动触发（用户在消息选择器里点出来的），
// 不存在"自动重试所以别打扰"的情况。失败就是失败，必须告诉用户。'''),
]
