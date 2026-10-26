# -*- coding: utf-8 -*-
# src/utils/analyzeContext.ts  L1382
ANNOTATIONS = [

(63, 'after', r'''文件总览：上下文用量分析器，也就是 `/context` 面板的全部数据来源。它把「窗口里到底装了什么」拆成七个可并行的计数器（系统提示、记忆文件、内置工具、MCP 工具、子代理、斜杠命令、消息体），各自调 token 计数 API，最后拼成分区列表 + 10×10 字符网格。三个贯穿全文件的主题：① token 计数既贵又不稳，所有计数器都走「API 优先、Haiku 兜底、失败返 null」三层；② 延迟工具（tool search）不算进真实占用，但要在界面里可见；③ 显示用的百分比有两套口径（估算 vs 上次 API 返回的真实用量），最终以真实为准。'''),

(75, 'after', r'''TOOL_TOKEN_COUNT_OVERHEAD 定 500 并附了一整段解释：只要请求里带工具，API 就会加一段工具前言（约 500 token）。逐个工具计数时每次调用都带这段开销，N 个工具就多算 N 份；所以每个「单工具」计数都要减 500。这是本文件最容易被误读的常量——它不是工具本身的成本，而是**计数的系统性偏差**。'''),

(109, 'after', r'''countTokensWithFallback 是全局的计数闸门，三层结构：① 官方 count_tokens API；② 返回 null 或抛错时改用 Haiku 兜底；③ 兜底也失败就返回 null（让调用方各自决定降级策略）。每一层都记 debug 日志并带上工具数量——排查「面板数字为什么是 0」时，这几行日志是唯一线索。'''),

(117, 'after', r'''ContextCategory 是分区模型。isDeferred 字段的含义写在注释里：**延迟的 token 不计入上下文占用**（它们没真发给模型），但仍要显示，否则用户会以为那些工具免费。'''),

(232, 'after', r'''ContextData 是对外契约，几个字段值得单独看：maxTokens 与 rawMaxTokens 现在同值（都等于上下文窗口），保留两个字段是历史分层的结果；gridRows 是**预计算好的字符网格**而非让渲染层自己算；以 [ANT-ONLY] 前缀标注的三个可选字段（systemTools / deferredBuiltinTools / systemPromptSections）只对内部用户返回；apiUsage 是上一次 API 响应里的真实计数，用于校准估算。'''),

(258, 'after', r'''countToolDefinitionTokens 把整组工具转成 API schema 后**一次**计数——这是关键：逐个计再相减会累积 N 份 500 开销，一次计只偏差一份。结果为 0 或 null 时打一条带工具名的日志（截断 100 字符），因为「工具全都算成 0」通常意味着 schema 生成失败而不是真的没 token。'''),

(270, 'after', r'''extractSectionName 给系统提示的每个片段起名字：优先取第一个 markdown 标题，没有就取第一行非空文本截断 40 字符。它服务的是内部用户的逐段明细，普通用户看不到，所以用启发式而非显式命名完全够用。'''),

(318, 'after', r'''countSystemTokens 的口径值得注意：它把系统提示的各片段**与 systemContext 的每个值分别计数**，而不是整段计一次。这样能给出逐段明细，代价是 N 次 API 调用——只在 `/context` 这种低频交互路径上可接受。filter 里剔除空串与 SYSTEM_PROMPT_DYNAMIC_BOUNDARY：后者是缓存边界标记，本身没有内容。'''),

(361, 'after', r'''countMemoryFileTokens 有两个前提判断：① CLAUDE_CODE_SIMPLE 模式压根不加载 CLAUDE.md，所以直接返 0（否则面板会显示一个不存在的开销）；② 用 filterInjectedMemoryFiles 过滤——tengu_moth_copse 开启后 MEMORY.md 索引不再注入系统提示，不能算进占用。'''),

(515, 'after', r'''countBuiltInToolTokens 是文件里最绕的一段，核心是「延迟工具」的记账规则。三条路径：① tool search 开启时，常驻工具整批计数，延迟工具逐个计数并判断「是否被用过」（扫消息里的 tool_use），用过的算实际占用、没用过的进 deferredBuiltinTokens 只做展示；② tool search 未开启时，延迟工具当普通工具整批加进总量；③ 内部用户的逐工具明细用**比例分摊**（按各工具 schema 的粗估字数占比）把整批数字拆开，并先减掉那 500 开销。排除 SkillTool 是因为它已单列为 Skills 分区，重复列入会双计。'''),

(519, 'after', r'''findSkillTool 单独抽出来的原因很实际：斜杠命令与技能都挂在同一个 SkillTool 上，需要多处查询同一个工具，包装一层比在每处写 findToolByName 更清楚。'''),

(552, 'after', r'''countSlashCommandTokens 计的是 SkillTool 的 schema 成本，并顺带返回「总命令数 / 实际包含数」——后者说明命令列表受 token 预算限制，并非全部展开。注意它与 countSkillTokens 计的是**同一个工具**，两处都返回值但只有一处进分区（见后面 skillFrontmatterTokens 的注释）。'''),

(614, 'after', r'''countSkillTokens 用 try/catch 把整个技能统计包住，注释说明了理由：技能目录的扫描可能因环境问题失败（权限、坏 frontmatter），而这是**关键路径之外的附加信息**，不能让它把整个上下文分析带崩。失败时返回全零而不是抛错，面板显示「无技能」总好过整个 /context 打不开。另外这里逐技能算的是**仅 frontmatter**（名字、描述、whenToUse）的估算，因为完整内容只在调用时才加载。'''),

(730, 'after', r'''countMcpToolTokens 与内置工具版本结构相似但有两处不同：① MCP 工具**一次批量计数**再按比例分摊——因为 MCP 工具共享同一个基础 Zod 输入 schema，只按 schema 估会全部相同，所以比例估算里特意拼上 name、description、input_schema 三项以匹配真实发送内容；② serverName 从工具名的双下划线分段里取（mcp__server__tool），取不到就记 unknown。isLoaded 的判定是「用过 或 本来就不是延迟工具」。'''),

(768, 'after', r'''countCustomAgentTokens 只算子代理的 agentType 与 whenToUse 两个字符串——因为注入系统提示的正是这两段（不是整个 agent 定义）。排除 built-in 是刻意的：内置代理的类型名与描述来自代码而不是用户配置，不算用户的上下文成本。'''),

(780, 'after', r'''MessageBreakdown 是消息体的分项统计，用三个 Map 按类型聚合（工具调用、工具结果、附件）。用 Map 而不是对象是因为类型名是用户数据（MCP 工具名可能含任意字符），当键不安全。'''),

(803, 'after', r'''processAssistantMessage 对每个 content block 单独 jsonStringify 后粗估 token。按块而不是整条消息，是因为一条 assistant 消息可能同时含文本与多个工具调用，混在一起就分不出「说话」与「调工具」各花多少。工具调用额外按工具名累加，供后面的「最贵工具」排序。'''),

(837, 'after', r'''processUserMessage 要处理两种形态：字符串内容（普通提示）与数组内容（含 tool_result 块）。tool_result 的成本归到**工具名下**而不是用户消息，靠 toolUseIdToName 反查——这个映射必须先在 assistant 消息上建好，映射不到就记 unknown。这是「按工具算总账」的关键一步：结果 tokens 往往是大头。'''),

(851, 'after', r'''processAttachment 把整个 attachment 对象序列化后粗估。attachmentsByType 的键取 attachment.type，缺省为 unknown——附件类型很多（几十种），面板只展示前几名。'''),

(916, 'after', r'''approximateMessageTokens 有三个关键决定：① 先跑 microcompactMessages 再统计，因为微压缩会把老的工具结果替换成占位符，统计必须反映**实际会发送的形态**，否则面板数字比实际偏大；② 总量交给 API 精确计，但发给计数 API 前要剥掉 assistant 消息的 id 等字段——注释写明计数 API 遇到这些字段会报错；③ 分项之和不必等于总量（分项是粗估），面板上两者并存不矛盾。'''),

(983, 'after', r'''这七个计数器全部并行（Promise.all），因为每个都可能要发一次或多次网络请求，串行会让 /context 打开慢上好几秒。需要注意它们的失败语义不同：前六个内部各自兜底返 0，approximateMessageTokens 里的计数失败会返 null 再被 ?? 0 收掉。'''),

(997, 'after', r'''这里有一段容易看漏的取舍：Skills 分区用的是**逐技能 frontmatter 估算之和**，而不是 countSkillTokens 返回的 skillTokens（后者含整个工具的 schema 开销）。注释写明了原因——要让分区数字与明细列表能对上。而 schema 开销已经在 System tools 里算过了，不重复计。同理下面算 System tools 时用的是 builtInToolTokens 减 skillFrontmatterTokens。'''),

(1005, 'after', r'''自动压缩阈值 = 有效窗口 − 保留缓冲。注意它用的是 getEffectiveContextWindowSize(model)（原始入参 model）而不是 runtimeModel——这一处不一致是老代码留下的，实际影响是子代理模型下的阈值可能按主模型窗口算。'''),

(1017, 'after', r'''分区顺序是按「用户能理解的心理模型」排的：系统提示（固定开销）→ 系统工具 → MCP 工具 → 延迟项 → 自定义代理 → 记忆文件 → 技能 → 消息。每个分区都只在 tokens > 0 时才 push，避免面板上出现一堆 0 值行。颜色字段用的是主题键名而不是色值，渲染层负责映射。'''),

(1031, 'after', r'''System tools 分值对内部用户显示为 [ANT-ONLY] System tools——名字里带前缀是刻意的：它提示这个数字来自比例分摊的估算而非精确值。'''),

(1040, 'after', r'''MCP tools 分区。颜色键名里带 FOR_SUBAGENTS_ONLY 后缀，是主题系统的一个历史遗留命名，与语义无关。'''),

(1051, 'after', r'''延迟 MCP 工具单独成一个分区并带 isDeferred: true：**显示但不计入占用**。这是整个面板最重要的一条语义——tool search 开启后 MCP 工具默认不加载，如果把它们算进占用，用户会看到窗口莫名满了。'''),

(1061, 'after', r'''延迟内置工具同理。两个延迟分区都排在一起，让用户一眼看到「这些还没花我的窗口」。'''),

(1070, 'after', r'''Custom agents 只统计非内置代理的类型与触发描述。'''),

(1079, 'after', r'''Memory files：所有 CLAUDE.md 类文件的 token 之和。明细在 memoryFiles 字段里，面板可以展开看每个文件花了多少——这个数字通常是用户唯一能主动优化的部分。'''),

(1088, 'after', r'''Skills 分区放的是逐技能 frontmatter 估算之和（见上面 997 处的取舍说明）。'''),

(1096, 'after', r'''Messages 是消息体总量，来自 API 精确计数（微压缩后）。'''),

(1103, 'after', r'''actualUsage 求和时**跳过 isDeferred 分区**，这是延迟语义的落点。注意它把保留缓冲也算在内（缓冲已在 cats 里），所以这个值不是「纯内容占用」而是「内容 + 预留」。'''),

(1127, 'after', r'''这段注释解释了一个反直觉的处理：在某些模式下**故意不显示保留缓冲**。原因是这些模式下前摄性自动压缩根本不会触发（reactive-only 的 cobalt_raccoon 只在需要时被动压缩；context-collapse 自己接管阈值阶梯并在 shouldAutoCompact 里抑制自动压缩），此时界面上画一个 33k 的缓冲条就是在撒谎。用 feature() 守卫是为了把内部开关名从外部构建里剔掉。'''),

(1147, 'after', r'''缓冲的三分支：跳过（上一条讲的模式）→ 自动压缩开启时取「窗口 − 阈值」→ 未开启时用固定的手压缩缓冲（3k）。三个分支都会把缓冲作为一个分区 push 进去，因此它会参与 actualUsage 求和但不计入 totalIncludingReserved（那个值在缓冲之前就算好了）。'''),

(1150, 'after', r'''剩余空间 = max(0, 窗口 − 实际占用 − 保留缓冲)，并作为最后一个分区（Free space）push——网格渲染时它负责填空。用 max(0, ...) 是因为估算可能超窗口，负数画不出格子。'''),

(1171, 'after', r'''totalFromAPI 把三项相加：input_tokens + cache_creation_input_tokens + cache_read_input_tokens。这与状态栏用的是同一个口径，注释专门强调「与状态栏一致」——两个界面显示不同数字是用户最常报的 bug 之一。'''),

(1174, 'after', r'''最终总量优先用 API 真实值，没有才回落到估算。这个优先级很重要：估算在微压缩与缓存场景下会系统性偏离，而 API 返回的是真实账单。'''),

(1189, 'after', r'''网格尺寸规则：1M 窗口用 20×10（每格 5k），200k 窗口用 10×10（每格 2k）；窄屏（< 80 列）宽度减半但高度保持 5 或 10。这样「一格代表多少 token」在不同屏幕上大致稳定，用户对颜色的直觉不会错乱。'''),

(1203, 'after', r'''每个分区的格子数按比例算，但非 Free space 的分区至少 1 格（Math.max(1, ...)）——否则一个 200 token 的小分区会完全不可见，用户会以为它不存在。Free space 不设下限，因为它本来就该按真实剩余取整。'''),

(1233, 'after', r'''createCategorySquares 处理「不完整的最后一格」：整格 fullness 为 1.0，第一个不完整的格子取小数部分，让渲染层可以画半格。这是字符网格能表现小数占比的唯一办法。'''),

(1259, 'after', r'''填充顺序是刻意的：先所有非保留、非空闲的分区（截断到总格数），再用 Free space 填到「总数 − 保留格数」，最后才追加保留缓冲。于是缓冲永远在**最后**，视觉上表现为窗口尾部的一段预留——与真实的压缩时机（快满时才压缩）对应。'''),

(1289, 'after', r'''保留缓冲的格子最后追加，且仍受总格数上限约束（不足一格的余量直接舍弃）。'''),

(1295, 'after', r'''gridRows 只是把一维格子数组按宽度切片成行，纯粹为渲染方便——把排版计算留在数据层，渲染层就不必知道任何比例逻辑。'''),

(1341, 'after', r'''messageBreakdown 的格式化做了两件展示优化：① 工具调用与结果原本是两个 Map，这里按键合并成一个数组并按**总和**排序，于是「最贵的工具」一次就能看出来（工具结果常是真正的大头）；② 附件按 token 降序排。两者都只保留排序后的数组，Map 结构不对外暴露。'''),

(1382, 'after', r'''返回值收尾有几处按用户类型裁剪：三个 [ANT-ONLY] 明细字段对普通用户返回 undefined（不传数据比传空数组更省）；slashCommands 与 skills 仅在 token 数大于 0 时才给对象，否则 undefined——面板据此决定是否渲染那一行。totalTokens 用 API 真实值，percentage 仍按窗口算，因此百分比可能超过估算的网格占比，属于预期。'''),

]
