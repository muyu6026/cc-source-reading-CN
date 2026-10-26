# -*- coding: utf-8 -*-
# src/utils/permissions/permissions.ts  L1486
ANNOTATIONS = [

(56, 'after', r'''文件总览：权限判定的**唯一主流水线**。hasPermissionsToUseToolInner 里的步骤编号（1a→1g、2a、2b、3）是整个权限系统的骨架，后面所有模块的注释都在引用这些编号。三层结构：① 规则层（1a 工具级 deny / 1b 工具级 ask / 1c 交给工具自己细分）；② 免疫层（1d deny、1e 必需交互、1f 内容级 ask、1g 安全路径检查——这四步在 bypassPermissions 之前，绕不过去）；③ 模式层（2a 旁路、2b 整体放行、3 passthrough 转 ask）。外层 hasPermissionsToUseTool 再加两个后处理：dontAsk 转换与 auto 分类器。'''),

(107, 'after', r'''分类器 fail-closed 开关的刷新周期定 30 分钟：这个 GrowthBook 开关决定「分类器不可用时拒绝还是放行」，属于能改变安全姿态的开关，不能每请求去拉，也不能一次会话只读一次。'''),

(114, 'after', r'''PERMISSION_RULE_SOURCES 把规则来源拼成一个有序表：settings 的六个源 + cliArg + command + session。顺序有意义——同一个工具在多个源都有规则时，前面的先命中。satisfies 用来在编译期校验每个字面量确实是 PermissionRuleSource。'''),

(120, 'after', r'''permissionRuleSourceDisplayString 只做一件事：把来源名翻成小写显示名。抽成函数是因为「规则来自哪个文件」这句话在 UI、拒绝消息、日志里出现十几次，翻译逻辑必须单点。'''),

(132, 'after', r'''getAllowRules 把 context 里的 alwaysAllowRules（按源分组的字符串）展开成统一的 PermissionRule 数组。注意它每次都重新解析规则字符串（permissionRuleValueFromString）——调用方多、规则少，解析成本可接受，换来的是不必维护一份可能失效的缓存。'''),

(211, 'after', r'''createPermissionRequestMessage 是「为什么弹这个框」的唯一文案来源，按 decisionReason.type 分十来支。三处细节值得记：① subcommandResults 分支会把输出重定向剥掉再展示（`echo x > file` 显示成 `echo x`），否则用户会以为要授权的是一个叫 file 的命令；② 剥重定向只对 Bash 做，别的工具的命令串不一定是 shell 语法；③ 所有分支都带 toolName，因为同一个框可能来自不同工具。'''),

(221, 'after', r'''getDenyRules 与下面的 getAskRules 和 getAllowRules 同构，三个一起构成规则层的读取侧。deny 与 ask 分开存（context 里三张表），而不是一条规则带 behavior 字段——这样判定顺序完全由代码结构决定，不依赖数据里的字段。'''),

(231, 'after', r'''getAskRules：显式 ask 规则。它的作用是「即使这个工具平时是放行的，只要命中这条就必问」，典型用途是给某个前缀加保险。'''),

(269, 'after', r'''toolMatchesRule 是规则与工具的匹配器，只处理「整工具」级的规则（ruleContent 为 undefined 就代表整工具）。两个非显然的设计：① 名字一律过 getToolNameForPermissionCheck，因为 skip-prefix 模式下 MCP 工具会拿到与内置工具同名的显示名（也叫 Write），规则必须按**带前缀的真实名**匹配，否则给内置 Write 写的规则会意外管住某个 MCP 工具；② mcp__server 这一级规则靠 mcpInfoFromString 拆解，支持「整个服务器」与「服务器下全部工具（星号）」两种形态。'''),

(282, 'after', r'''toolAlwaysAllowedRule / getDenyRuleForTool / getAskRuleForTool 三个是一组查询器，各自返回**命中规则本身**而非布尔值——因为上层要把命中的规则写进 decisionReason，UI 才能告诉用户「是哪一条规则放行/拦截的」。'''),

(292, 'after', r'''getDenyRuleForTool：工具级 deny。它是流水线第一步（1a），优先级最高，连 bypassPermissions 都不看它后面。'''),

(302, 'after', r'''getAskRuleForTool：工具级 ask。注意它命中后还留了一个例外（见 1b 的 sandbox 分支）——Bash 在沙箱里且开启 autoAllowBashIfSandboxed 时，ask 规则会被放过，因为沙箱本身已经是更强的约束。'''),

(320, 'after', r'''getDenyRuleForAgent 处理 Agent(agentType) 这种带内容的 deny 规则：toolName 是 Agent 工具名、ruleContent 是子代理类型。这是「禁用某个子代理」的唯一机制，因为子代理不是独立工具。'''),

(343, 'after', r'''filterDeniedAgents 的注释是性能账：早先每个 agent 都调一次 getDenyRuleForAgent，于是每条 deny 规则被解析 N 次（O(agents×rules)）；现在先把所有 Agent(x) 的 x 收进 Set，再一次性 filter。返回 Set 而不是数组还有个细节——重复的 deny 规则自动去重。'''),

(359, 'after', r'''getRuleByContentsForTool 与 getRuleByContentsForToolName 是同一函数的两个入口，后者单独存在是为了**打破循环依赖**：某些 Tool 实现需要查自己内容的规则，若它 import 这个带 Tool 类型的入口就会成环，所以拆出一个只吃字符串名的版本。注释直说了这个动机。'''),

(390, 'after', r'''getRuleByContentsForToolName 把「某工具 + 某行为」的所有内容级规则做成 Map（键是规则内容，如 prefix: 后的字符串）。用 Map 而非数组是因为下游要按内容 O(1) 查「这条命令有没有精确规则」。'''),

(471, 'after', r'''runPermissionRequestHooksForHeadlessAgent 是 headless 代理的最后一道人为干预机会：它们无法弹框，所以先让 PermissionRequest 钩子表态，钩子不表态才自动拒绝。三个契约点：① 钩子返回 allow 时可带 updatedInput（改写工具入参）与 updatedPermissions（并持久化到设置）；② deny 且 interrupt 为真会直接中止整个会话；③ 钩子自身抛错**不向上传播**，只记日志然后回落自动拒绝——钩子坏了不能连带把代理搞崩。'''),

(501, 'after', r'''这一段的注释值得单独记：allowed 时若处于 auto 模式且此前有连续拒绝，就地清零。理由是「一次成功就能打断连续拒绝的连击」——包括被规则自动放行的成功，否则连续拒绝计数会一直挂在那里，直到误触发降级提示。'''),

(517, 'after', r'''dontAsk 模式的转换放在**最后**（result 已成型之后），注释写明理由：这样任何早退路径都绕不过它。dontAsk 的语义是「别问我」，所以把 ask 一律降级成 deny，并带专门的拒绝文案。'''),

(548, 'after', r'''这段是 auto 模式的第一道闸：**不可被分类器批准**的安全检查（safetyCheck 且 classifierApprovable 为假）完全免疫所有自动放行路径——acceptEdits 快路、安全工具白名单、分类器三条都过不去。而可被分类器批准的安全检查（敏感文件路径）则放行到分类器，因为工具自身的 checkPermissions 仍返回 ask，两条快路自然不会误命中。区分「能不能让 AI 判」是这套设计的核心。'''),

(591, 'after', r'''PowerShell 的 auto 模式例外：除非内部构建开了 POWERSHELL_AUTO_MODE，否则 PS 一律不进分类器，必须用户亲手批。注释还交代了为什么这里不检查「allow 规则」——能走到这一步说明前面的 1b 与 2b 都没命中，而 PowerShell 的宽泛 allow 规则在 permissionSetup 阶段就已经被剥掉了（PowerShell 星号与 iex/pwsh/Start-Process 前缀规则）。'''),

(656, 'after', r'''acceptEdits 快路：在调分类器**之前**，先假装模式是 acceptEdits 再问一次工具。文件编辑这类在工作区内本来就安全的操作因此完全不花分类器的钱。两个例外被排除在外——Agent 与 REPL：它们的 checkPermissions 在 acceptEdits 下直接返回 allow，会把分类器整个绕过；而 REPL 的代码可以在两次内部工具调用之间做 VM 逃逸，分类器必须看到那层粘合用的 JS 而不只是内部调用。'''),

(686, 'after', r'''安全工具白名单快路：只读类工具（Read/Grep 之类）不需要 YOLO 分类。与上一条的区别是判据来自静态白名单而非工具的权限实现，因此它连 schema 解析都省了。两条快路都会记 fastPath 字段（acceptEdits / allowlist），这样埋点能区分「省了多少钱」。'''),

(702, 'after', r'''分类器调用用 setClassifierChecking / clearClassifierChecking 包住，且清理放在 finally——UI 靠这个标记显示「正在判定」的转圈，任何异常路径都必须清掉，否则界面永远转。'''),

(812, 'after', r'''这条 logEvent 是全文件最长的调用，但它的结构说明了内部团队怎么算成本：把分类器自身的 token/时长/两阶段 requestId 与会话累计 token 一起上报，于是能算「分类器占会话开销的百分比」。两处注释很关键：① 会话累计 token 只含主转录，sideQuery 不调用 addToTotalSessionCost，所以分类器自己的 token 不会重复计入；② stage1/stage2 分别计费，因为两阶段模型可能不同。'''),

(842, 'after', r'''transcriptTooLong 分支：转录超了分类器上下文窗口是**确定性**错误，重试必然再超。headless 场景直接 AbortError（拒绝—重试—再拒绝只是白烧 token，永远碰不到拒绝上限的中止），交互场景则回落到普通询问。'''),

(876, 'after', r'''分类器不可用（API 错误）时的分岔由 tengu_iron_gate_closed 开关控制：默认 true 即 fail-closed（拒绝并给出重试指引），关掉才 fail-open 回落普通询问。默认值的取向很清楚——安全组件坏了应该拒绝，而不是悄悄放行。'''),

(912, 'after', r'''分类器判定拦截的完整链路：先记一次拒绝并持久化，再检查是否触发拒绝上限（加上分类器给的理由，用户才知道为什么被连拦），未触上限则返回带 buildYoloRejectionMessage 的拒绝。'''),

(927, 'after', r'''auto 模式分支到此结束。整段的形状值得记：所有快路（safetyCheck 免疫、必需交互、PS 例外、acceptEdits、白名单）都在分类器之前，分类器之后才处理转录超长、不可用、拦截、放行四种结果——把「贵操作」放在最后是这套流水线的基本排版原则。'''),

(956, 'after', r'''hasPermissionsToUseTool 收尾有两件事被刻意放在最外层：① allow 时清零连续拒绝计数；② ask 时做 dontAsk 与 auto 两种模式转换。放在外层而不是内层的原因写在注释里——内层有太多早退路径（1a–2b 每步都可以 return），任何一处漏掉就是策略被绕过。'''),

(978, 'after', r'''persistDenialState 的双路径：异步子代理的 setAppState 是空操作，所以有 localDenialTracking 时就地 Object.assign；否则写回 appState，并利用 recordSuccess 的「状态未变则返回同一引用」约定——返回 prev 让 store.setState 的 Object.is 检查直接跳过整个监听器循环。'''),

(1027, 'after', r'''headless 场景触到拒绝上限时直接中止整个代理：没有用户可问，继续跑只会反复被拦。这是「自动拒绝」与「中止」的分界——单次拒绝是正常反馈，连续或累计触限说明这条任务在当前权限下做不成。'''),

(1040, 'after', r'''命中**累计**上限时把两个计数都清零，命中**连续**上限时不清：累计上限是「这一整个会话被拦太多次了」，清掉让用户处理完继续；连续上限是「当前这条思路走不通」，清零反而会让它继续撞墙。'''),

(1058, 'after', r'''handleDenialLimitExceeded 返回的是**原 decision 的变形**（展开 result 后替换 decisionReason），并刻意保留原始 classifier 名（如 dangerous-agent-action）——下游交互式处理要按这个名字区分「用户覆盖了哪种分类器判定」来埋点。'''),

(1111, 'after', r'''checkRuleBasedPermissions 是 hasPermissionsToUseToolInner 的**规则子集**版本，只跑到 1a–1g（含 sandbox 例外），不跑模式转换、分类器、钩子、bypass。它存在的理由是 bypassPermissions 模式仍要尊重规则层，而调用方需要在不触发模式副作用的前提下先问一句「有没有规则反对」。注释还提醒调用方须自行预检 requiresUserInteraction（1e 未复制）。'''),

(1156, 'after', r'''规则子集函数的收尾：null 表示「没有规则反对」，注意它与 allow 不等价——null 只是说规则层没意见，模式层与分类器还没跑。'''),

(1193, 'after', r'''hasPermissionsToUseToolInner 里的 sandbox 例外（1b）：ask 规则命中后，若这是 Bash、沙箱开启、autoAllowBashIfSandboxed 开启、且这条命令确实会进沙箱，就不返回 ask，而是落到工具的 checkPermissions 去做命令级判定。反向也重要——被排除的命令与 dangerouslyDisableSandbox 的命令不进沙箱，仍须遵守 ask 规则。'''),

(1281, 'after', r'''2a 的旁路判定比字面复杂：除了直接的 bypassPermissions 模式，plan 模式下若用户**本来**就是以 bypass 启动的（isBypassPermissionsModeAvailable），也要放行——plan 只是暂时切到只读规划，不该顺手把用户的旁路授意作废。放行时统一用 getUpdatedInputOrFallback，因为工具可能在 checkPermissions 里改写了入参。'''),

(1297, 'after', r'''2b 工具级 allow 规则。与 2a 一样优先采用工具改写后的入参（比如 Bash 把命令规范化过），只在工具没给 updatedInput 时才回落到原始 input。'''),

(1319, 'after', r'''hasPermissionsToUseToolInner 收尾：把 passthrough 转成 ask，并在转换时用工具给的 decisionReason 重新生成提示文案（这样用户在框里能看到具体原因，而不是一句通用话术）。开 debug 时把 suggestions 全量打出——那些是「允许并记住」要写进设置的内容，排查规则污染时必看。'''),

(1370, 'after', r'''deletePermissionRule 的第一道判断是**来源可写性**：policySettings / flagSettings / command 三个源是只读的（企业策略、启动参数、命令行），试图删除直接抛错而不是静默忽略——静默会让用户以为删掉了，下次启动规则又回来。'''),

(1403, 'after', r'''convertRulesToUpdates 把「一堆规则」压成「按 来源:行为 分组的最小更新集」。这个压缩不是优化而是正确性要求：applyPermissionUpdates 是按 destination + behavior 整组替换的，逐条发会造成 N 次替换且互相覆盖。'''),

(1414, 'after', r'''applyPermissionRulesToPermissionContext 用 addRules 语义（增量，启动时灌初始规则）；下面的 syncPermissionRulesFromDisk 用 replaceRules（全量替换，设置文件改动时重灌）。两个函数长得像但语义相反，选错会导致「删掉的规则复活」或「启动时规则被清空」。'''),

(1471, 'after', r'''syncPermissionRulesFromDisk 里有一段必须记住的坑：替换前要**主动清空**每个 磁盘源×行为 的组合，因为 convertRulesToUpdates 只对有规则的分组生成更新——某组规则被删空后不产生任何更新，旧规则就会留在 context 里。注释把这个 bug 的形态写全了（删一条 deny，它还在）。另外 shouldAllowManagedPermissionRulesOnly 为真时要先清掉全部非策略源，这是企业托管的强制收口。'''),

(1487, 'after', r'''getUpdatedInputOrFallback：PermissionResult 的部分变体没有 updatedInput 字段，用 in 运算符收窄再 ?? 回落。看起来啰嗦，但直接读 .updatedInput 会让 TypeScript 报错，而 as any 会把「字段真的不存在」与「字段为 undefined」混为一谈。'''),

]
