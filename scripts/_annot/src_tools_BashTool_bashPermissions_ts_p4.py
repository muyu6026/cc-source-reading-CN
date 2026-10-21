# -*- coding: utf-8 -*-
"""bashPermissions.ts 第 4 片：1663–2621 行（主函数编排 + 三个归一化器）"""

ANNOTATIONS = [

(1660, 'before', '''// ═══ ㉔ 主函数：895 行的权限裁决总编排 ═══
//
// 读之前先拿这张表当地图（行号都在本文件内）：
//
//   ┌──── 准备 ────────────────────────────────────────────────────
//   │ 1668  取 appState（快照）
//   │ 1678  读「禁用注入检查」环境变量
//   │ 1683  GrowthBook killswitch（影子模式）
//   │ 1688  tree-sitter 解析 → 三分：simple / too-complex / parse-unavailable
//   │ 1707  【影子模式】记录分歧，然后强制回落到 legacy
//   ├──── 三条互斥的早期出口 ──────────────────────────────────────
//   │ 1741  too-complex      → deny 优先，否则 ask（分类器可救）
//   │ 1771  simple + 语义不符 → deny 优先，否则 ask
//   │ 1811  parse-unavailable → legacy shell-quote 预检
//   ├──── 通用判定 ────────────────────────────────────────────────
//   │ 1831  沙箱自动放行（有前置条件）
//   │ 1846  精确匹配 —— 只接受 deny
//   │ 1859  Haiku 分类器 deny/ask（并行两个请求）
//   │ 1976  管道/操作符分段检查（递归回本函数）
//   │ 2085  legacy 「解析不可信」闸门
//   ├──── 拆子命令 + 逐条裁决 ────────────────────────────────────
//   │ 2147  拆子命令、过滤 cd <cwd>
//   │ 2162  子命令数量上限 50（CC-643）
//   │ 2182  多条 cd → ask
//   │ 2209  cd + git 组合 → ask（裸仓库 RCE 门禁）
//   │ 2239  逐条 bashToolCheckPermission
//   │ 2249  任一 deny → deny
//   │ 2276  **原始命令**的路径约束（重定向在这一层）
//   │ 2296  GH#28784：path-ask 不能盖过子命令的 ask
//   │ 2319  只有一个非 allow 子命令 → 直接 ask
//   │ 2334  精确 allow 兑现
//   │ 2343  全部 allow 且无注入 → allow
//   └──── 合并建议 + 提问 ────────────────────────────────────────
//     2406  单子命令走 checkCommandAndSuggestRules
//     2435  多子命令逐个走，收集建议
//     2521  建议规则上限 5 条（GH#11380）
//     2543  最终 ask / passthrough
//
// 一个贯穿全篇的问题，读的时候一直问它：
//     「在这个位置返回 ask，会不会把某个还没检查的 deny 盖掉？」
// 本函数里至少 6 处注释都在回答这个问题。'''),

(1663, 'before', '''// 注：三个参数里第三个 `getCommandSubcommandPrefixFn` 是**依赖注入**：
//     默认是真实的 getCommandSubcommandPrefix（会调 Haiku），
//     但全文件多处判断 `getCommandSubcommandPrefixFn !== getCommandSubcommandPrefix`
//     来决定「要不要真的去调模型」。线上永远相等，所以那段调用其实是死代码，
//     只有测试会传自定义函数进去。'''),

(1668, 'after', '''// 注：`let` 而不是 `const` —— 因为整个函数后面会**重新取 4 次**状态
//     （2012、2038、2061、2227、2405 行），每次注释都写着同一个原因：
//     `re-compute the latest in case the user hit shift+tab`。
//
//     shift+tab 是在权限弹窗里切换权限模式（default → acceptEdits → plan）的快捷键。
//     而这个函数中间会 await 好几次（分类器 API、tree-sitter 解析），
//     期间用户完全可能改了模式。所以任何「await 之后再用状态」的地方，
//     都必须重新取值 —— 否则会拿旧模式做判断。
//     这是一个很实际的并发细节：**权限模式是可以在判定过程中变化的。**'''),

(1670, 'after_block', '''// 注：这一段注释记录了一次**架构替换**：AST 解析同时取代了两样东西 ——
//     ① `tryParseShellCommand`（shell-quote 预检）
//     ② `bashCommandIsSafe` 里的 misparsing 闸门
//     因为它们回答的是同一个问题：「splitCommand 的输出能不能信？」
//
//     旧方案的答案是「用一堆正则去猜有没有可疑结构」；
//     新方案的答案是「用真正的解析器解析一次，解析不了就说明不可信」。
//     从启发式到结构化，这是这份源码里最值得学的一次重构。'''),

(1683, 'after', '''// 注：这是「影子模式（shadow mode）」的开关。
//     名字取得很准：新解析器在跑、结论也在记，但**不生效** ——
//     只是把「新旧两套会不会给出不同答案」上报，用来评估新方案的误判率。
//
//     `getFeatureValue_CACHED_MAY_BE_STALE` 这个名字是在提醒：
//     这里读的是缓存值，可能过期。对 killswitch 来说可以接受 ——
//     晚几秒生效，比每次判定都发一个网络请求划算。'''),

(1688, 'after', '''// 注：这个嵌套三元表达式把「三种情况」压成了两行，值得展开读：
//
//     注入检查被禁用           → null（不解析，走 legacy）
//     影子模式开启但 killswitch 关 → null（连解析都不做）
//     其他                     → await parseCommandRaw(command)
//
//     注意 `let astRoot` 也是可变的 —— 影子模式在下面第 1738 行会把它设回 null。
//     这种「先解析、再主动丢弃」的写法平时很少见，
//     但正是影子模式的定义：**跑一遍，只为拿结论，不为用它。**'''),

(1693, 'after', '''// 注：`parse-unavailable` 这个默认值选得好 —— 没有解析结果就等于「解析不可用」，
//     让下游自然回落到 legacy，而不是被当成「解析成功但没内容」。
//     一个类型的兜底值选对了，下游就不需要到处判空。'''),

(1701, 'after_block', '''// 译：影子测试 tree-sitter：记录它的结论，然后强制设成 parse-unavailable，
//     让 legacy 路径保持权威。parseCommand 仍然受 TREE_SITTER_BASH（而非 SHADOW）
//     控制，所以 legacy 内部仍然保持纯正则。
//
//     每次 bash 调用上报一个事件，同时捕获「分歧」和「不可用」两种原因；
//     模块加载失败另有会话级的 tengu_tree_sitter_load 事件覆盖。
//
// 注：这段是全文件最值得抄的一段「灰度上线脚手架」。它记录了 4 个维度的观测：
//        available      解析器能不能用
//        astTooComplex  解析成功但结构太复杂
//        astSemanticFail 解析成功但语义检查不过
//        subsDiffer     新旧切分结果不一致
//     再加 3 个上下文维度：注入检查是否被禁用、killswitch 是否关、命令是否超长。
//
//     这套设计的用意：上新解析器最大的风险不是它崩，而是它**静默地判得不一样**。
//     所以先把「不一样」变成可计数的指标，等分歧率足够低再切主路径。
//     而 `astSubcommands` 后面还会用到 `shadowLegacySubs` —— 影子模式下
//     连切分结果都留着给后面复用，避免重复调用 legacy splitCommand。'''),

(1736, 'after', '''// 注：`astResult = { kind: 'parse-unavailable' }` + `astRoot = null`
//     这两行就是「影子模式的落地方式」：**把已经拿到的解析结果主动扔掉**。
//     所以本函数后面所有 `astResult.kind === 'parse-unavailable'` 的分支
//     在影子模式下都会走到 —— 也就是说影子模式等价于「完全回到改造前的行为」。
//     这是灰度发布里最理想的性质：开关一关，行为和上线前逐字节相同。'''),

(1741, 'after', '''// 注：`too-complex` 是这套设计的核心概念，它的含义在注释里写得很准确：
//     解析**成功了**，但发现的结构无法静态分析（命令替换、展开、控制流、解析器差异）。
//
//     注意它和「解析失败」的区别：
//       解析失败   → 命令本身语法就不对 → legacy 预检会 ask
//       too-complex → 语法没问题，但我们分析不了 → 这里 ask
//     两者的共同点：都**不能**信任 splitCommand 的输出。
//     这就是为什么 too-complex 要在这里直接返回，而不是继续往下走流程。'''),

(1746, 'after', '''// 注：这是「deny 不能降级成 ask」原则的第 1 次落点。
//     走到这里说明结构分析不了，只能问用户 —— 但**问之前必须先把 deny 查完**。
//     否则用户配了 `Bash(curl:*)` deny，而命令是 `curl $(cat url.txt)`，
//     就会因为 too-complex 直接弹「是否允许」，用户一点就把 deny 绕过去了。'''),

(1752, 'after', '''// 注：埋点只上报 `nodeTypeId`（节点类型的数字 ID），不上报命令内容。
//     这就是那个品牌类型 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
//     存在的意义：此处传的是纯数字，天然安全；传命令原文的地方必须显式声明。
//
//     顺带一个实用价值：`nodeTypeId` 能告诉你**到底是哪种结构**让解析进了 too-complex。
//     线上如果有大量 too-complex，看这个 ID 的分布就知道该优先支持哪种语法。'''),

(1760, 'after', '''// 注：`...(feature('BASH_CLASSIFIER') ? {...} : {})` 这个展开写法在本文件出现 8 次，
//     全是同一个目的：**让这段对象字面量在构建期就能被完整删除**。
//
//     为什么不用 `pendingClassifierCheck: feature('BASH_CLASSIFIER') ? x : undefined`？
//     因为那样属性名还在，Bun 的 DCE 只能删掉值、删不掉键，
//     而「有没有这个键」在 UI 侧是被判断的（`result.pendingClassifierCheck &&`）。
//     用对象展开，整个属性连同键一起消失 —— 这才是真正的死代码消除。
//
//     这个小技巧和第 81 行那个 DCE 悬崖是同一套知识的两面：
//     一面是「别把函数写太复杂」，另一面是「别把死代码写得删不掉」。'''),

(1771, 'after', '''// 注：`simple` 分支做两件事：
//     ① 用 checkSemantics 检查「切分正确但名字危险」的命令（zsh 内建、eval 等）
//     ② 把解析结果**缓存成字符串形态**给下游用
//
//     第 ② 件是关键的历史妥协，注释说得很坦白：
//     下游（规则匹配、路径提取、cd 检测）全部基于字符串，
//     所以这里把每个 SimpleCommand 的**源码片段**交出去，
//     下游会再对这些片段重新分词 —— 而那个重新分词**有已知 bug**。
//     注释还给了安全论证：这类 bug 影响不到这里，因为 checkSemantics 已经
//     拒绝过含换行的 argv 元素了（而 stripCommentLines 的 bug 正是关于换行）。
//
//     `Migrating downstream to operate on argv directly is a later commit.`
//     ——「以后会改」，是全项目最诚实的一句 TODO。'''),

(1778, 'after', '''// 注：语义检查失败时用的是 `checkSemanticsDeny`（而不是 `checkEarlyExitDeny`）——
//     区别在它多了一层「按 AST 片段逐条查前缀 deny」。
//     原因见第 1431 行那个函数的注释：复合命令护栏会挡住
//     `Bash(eval:*)` 匹配 `echo foo | eval rm`，所以必须按片段绕过护栏再查一次。
//
//     一句话：**结构不可信时（too-complex）只能查整条命令；
//     结构可信时（simple）可以查每一条片段，所以能查得更凶。**'''),

(1803, 'after', '''// 注：三行赋值把 AST 的信息分流到三个变量，后面各管一摊：
//       astSubcommands  子命令字符串（给规则匹配用）
//       astRedirects    所有重定向（给路径校验用）
//       astCommands     SimpleCommand 对象（给逐条裁决用，按下标配对）
//
//     注意 astRedirects 用的是 `flatMap` —— 把所有子命令的 redirects 拼成一个平铺数组。
//     这意味着路径校验拿到的是「全命令的重定向集合」，不带「属于哪条子命令」的信息。
//     对「目标路径是否越界」这个判断来说够了，但如果以后要做更细的归属分析，
//     这里的信息已经丢了。'''),

(1808, 'after_block', '''// 注：`parse-unavailable` 分支只在「tree-sitter 没加载」或「feature 关掉」时进入。
//     它做的事只有一件：用 shell-quote 试着解析一次，失败就问用户。
//
//     这是**唯一的兜底**，也是最弱的一道：shell-quote 不能真正解析 bash 语法，
//     它只是把字符串切成 token。切不动的会被判 malformed → ask。
//
//     注意注释里那句「Only reached on parse-unavailable」——
//     这个分支在正常构建里几乎不会走到，因为 TREE_SITTER_BASH 是开着的。
//     读这段代码时可以把它当成「历史路径」，理解它的存在意义（降级）就够了，
//     不必记住细节。'''),

(1829, 'after_block', '''// 注：三个条件同时成立才考虑沙箱自动放行，缺一不可：
//       ① 沙箱功能启用
//       ② 配置里开了 autoAllowBashIfSandboxed
//       ③ 这条命令**确实会被沙箱**（shouldUseSandbox 判定）
//
//     第 ③ 条最容易忽略：不是「开了沙箱」就等于「所有命令都在沙箱里跑」——
//     有些命令（比如需要网络、需要写项目外）会被判定为不能沙箱化。
//     如果对这类命令也自动放行，就等于「以为有沙箱保护，其实没有」。
//     这类「前置条件看起来多余、其实每条都拦过真实问题」的判断，值得逐个想一遍。'''),

(1846, 'after', '''// 注：这是精确匹配的**第 2 次**调用（第 1 次在 bashToolCheckPermission 内部，
//     但那是在逐子命令阶段）。这里是「整条命令」级别的精确匹配，而且**只接受 deny**。
//
//     为什么这次只接受 deny？因为 ask/allow 的语义在整条命令级别没有意义：
//     `Bash(git push:*)` 这种前缀规则要等拆成子命令才有意义，
//     而精确规则 `Bash(git push origin main)` 在这里 allow 也不合适 ——
//     万一命令后面还有 `&& rm -rf /` 呢。所以这里只做「否决」，不做「批准」。'''),

(1856, 'after_block', '''// 注：这一段是**模型参与的权限判定**：把用户的自然语言规则（prompt 规则）
//     和当前命令一起丢给 Haiku，让它判断这条命令是否命中某条 deny/ask 描述。
//
//     两个请求并行（`Promise.all`），因为 deny 和 ask 的规则集是不同的两套描述，
//     互不依赖。而裁决顺序仍然是 deny 优先 —— 并行是为了快，不是为了改变优先级。
//
//     这是本项目「用 LLM 做权限判定」的入口，理解它的边界很重要：
//     分类器只回答「是否符合用户写过的某句话」，不做通用的危险评估。'''),

(1899, 'after', '''// 注：await 回来之后**立刻**检查 aborted。这是一个必须养成的习惯：
//     任何 await 之后的第一个动作，应该是「我还该继续吗」。
//     不检查的后果是：用户已经取消了这个工具调用，代码却还在往下走，
//     可能弹出一个已经无人等待的权限框，或者返回一个会被丢弃的结果。'''),

(1920, 'after', '''// 注：deny 优先于 ask —— 同一段代码里两条规则都命中时，走 deny。
//     注意优先级是「规则的行为」优先，而不是「哪个先返回」优先。
//     因为两个请求是并行的，返回顺序不确定；靠比较结果而不是靠时序，才可靠。'''),

(1932, 'after', '''// 注：这里有一段「跳过 Haiku 调用」的注释，反映了一次产品决策变化：
//     原来是让 Haiku 算「这条命令该建议什么前缀规则」，
//     现在改成本地计算 + 让用户在输入框里自己改。
//
//     但代码里还留着注入版本的分支（`getCommandSubcommandPrefixFn !== 默认实现`），
//     所以线上那段 `await getCommandSubcommandPrefixFn(...)` 是**死代码**。
//     这是「重构后没清理旧路径」的典型痕迹 —— 判断依据就是那个相等性比较：
//     只要它和默认实现相同，就走本地计算。'''),

(1973, 'after_block', '''// 注：这一步处理管道和操作符（`|`、`>`、`&&` 等），
//     而它的实现方式很激进：**对每一段重新调用本函数**（递归）。
//
//     见 bashCommandHelpers.ts:91 —— 对每个 segment 调
//     `bashToolHasPermissionFn({ ...input, command: trimmedSegment })`。
//     也就是说「拆段 → 逐段完整走一遍权限判定 → 汇总」。
//     递归的终止条件是：段里没有操作符了，于是 checkCommandOperatorPermissions 返回 passthrough。
//
//     这种「递归回自己」的写法让代码很短，但代价是：
//     ① 每一层都要重新做 AST 解析（虽然传了 astRoot 复用，但段是新字符串）
//     ② 调试栈会变深，日志要看清是第几层
//     ③ 前面那些早期出口（too-complex、语义检查）会在每一层各跑一遍'''),

(1984, 'after_block', '''// 译：SECURITY FIX：当管道分段处理返回 'allow' 时，我们**仍须**校验原始命令。
//     分段处理会在检查每段之前剥掉重定向，所以像
//         echo 'x' | xargs printf '%s' >> /tmp/file
//     这样的命令，两段都会通过（echo 和 xargs printf），
//     但 `>>` 重定向就绕过了校验。必须检查：
//       ① 输出重定向的路径约束
//       ② 重定向目标里的危险模式（反引号、$() 等）
//
// 注：这段注释揭示了一个**结构性漏洞类别**：
//     「先把命令拆开、逐块检查」这种模式，一定会丢掉「块与块之间」的信息。
//     这里的丢失物是重定向（被 splitCommand 剥掉了）。
//     同类问题在本函数出现 2 次（这里和第 2268 行），修法都是
//     「对**原始**命令再补一次检查」。'''),

(1996, 'after_block', '''// 注：`astSubcommands === null` 是「有没有可信解析」的判据，全函数出现 4 次
//     （这里、2086、2163、2345）。每次的含义都一样：
//         null  → 只能信 legacy，要多做检查
//         非 null → AST 已验证结构，可以跳过这些检查
//
//     这种「用一个变量当全局可信标记」的写法很省事，但也是维护风险：
//     如果有哪条路径忘了同步这个变量，检查就会被静默跳过。
//     读的时候值得逐个确认这 4 处的 null 都是从同一个地方来的。'''),

(2000, 'after_block', '''// 注：`bashCommandIsSafeAsync` 会跑完整的 legacy 正则批次（约 20 个模式），
//     所以注释特别强调「只在真要用结果时才调用」。
//     这就是把 `null` 和「调用了但没结果」区分开的原因：
//     `astSubcommands !== null` 时根本不发起调用，而不是发起了再丢弃。
//
//     一个性能细节：这段是热路径（每次 bash 调用都走），
//     省掉一次 20 条正则的扫描是可测量的收益。
//     同一处注释还提了一个误报案例：`find -exec {} \\; | grep x` 会被
//     反斜杠分号的检查误伤 —— 有了 AST 就不必再受这个误报。'''),

(2038, 'after', '''// 注：又取了一次 appState。因为上面 await 了 bashCommandIsSafeAsync，
//     期间用户可能切了模式。这类「await 之后重取状态」在本函数一共 5 次，
//     每次都是同一个理由，没有一次是多余的。'''),

(2039, 'before', '''// 注：这一段是**真实漏洞的修复现场**，值得完整读：
//
//     原来这里硬编码 `compoundCommandHasCd = false`。于是
//         cd .claude && echo x > settings.json | echo done
//     会走管道分段这条路（因为有 `|`），而分段路径把 compoundCommandHasCd 当 false，
//     结果 pathValidation.ts:821 那个「cd + 重定向」的拦截**不触发** ——
//     重定向就写进了 .claude/settings.json。
//
//     修法：用 `commandHasAnyCd(input.command)` 从**完整命令**里算。
//     `commandHasAnyCd` 就在本文件末尾（第 2617 行），它对每条子命令做归一化后判断。
//
//     这个 bug 的教训很普遍：**布尔标志在分支路径上被简化成常量**，
//     是最容易发生、最难发现的一类失效。'''),

(2060, 'after', '''// 注：管道分段返回 ask 时，也要挂上 pendingClassifierCheck ——
//     让分类器有机会在用户点之前自动放行。
//
//     注意这里用了 `...commandOperatorResult` 展开而不是重新构造：
//     保留子结果里的 message、decisionReason、suggestions，
//     只额外加一个分类器检查。这种「展开 + 追加」的写法在本函数后半段反复出现，
//     好处是不会丢掉上游已经算好的信息。'''),

(2078, 'after_block', '''// 注：这段是 legacy 的「解析不可信」闸门，历史地位很重要 ——
//     它曾经是**唯一**防止「检测器看到 A、bash 执行 B」的机制，
//     具体实现就是 bashSecurity.ts 里那 22 个 validator。
//
//     现在它的角色变成了兜底：只有当 AST 不可用（astSubcommands === null）时才跑。
//     注释里那句判断非常到位：
//         The AST''s ''too-complex'' result subsumes everything
//         isBashSecurityCheckForMisparsing covered — both answer the same question:
//         "can splitCommand be trusted on this input?"
//
//     也就是说：22 个 validator 用 2592 行代码在猜的问题，
//     tree-sitter 用一个 `too-complex` 就回答了。
//     这就是为什么这次重构值得学 —— 不是「写得更好」，而是**问题本身被消解了**。'''),

(2100, 'after', '''// 注：`stripSafeHeredocSubstitutions` 处理的是一个具体的误报：
//     `$(cat <<'EOF' ... EOF)` 会触发 `$()` 检查，但这里 `$()` 包的是**字面量 heredoc**，
//     不构成命令替换风险。
//
//     处理方式很稳：剥掉安全的 heredoc 之后**重查一遍剩余部分**。
//     如果剩下的还有 misparsing 模式（比如反斜杠转义操作符），照样拦。
//     这是「为了减少误报而放宽，但放宽后立刻再验一次」的标准做法 ——
//     不是「看到白名单就整条放行」。'''),

(2108, 'after_block', '''// 注：这是 deny/allow 优先级里一个刻意的例外：
//     结构不可信时，如果用户对**这条命令原文**显式配了 allow，就放行。
//
//     理由写在注释里：`the user made a conscious choice to permit this specific command`。
//     也就是「精确 allow」被视为最强的人工授权，优先级甚至高于
//     「结构不可解析」这个安全警报。
//
//     这个例外合不合理可以讨论，但它体现了权限系统的一个隐含分级：
//       精确 allow（用户逐字批准过）> 安全警报 > 前缀 allow
//     把这条记下来，遇到「为什么这条命令没弹窗」时先查有没有精确 allow 规则。'''),

(2144, 'after_block', '''// 注：从这里开始进入「按子命令裁决」阶段。数据来源的优先级是：
//       astSubcommands（AST 切分，可信）
//    ?? shadowLegacySubs（影子模式下已经算过的 legacy 结果，避免重复计算）
//    ?? splitCommand（现算 legacy）
//
//     `??` 链在这里用得很恰当：三个来源都是「数组或 null/undefined」，
//     语义就是「用第一个可用的」。'''),

(2147, 'after', '''// 注：Windows 上要额外算一个 mingw 形态的 cwd（`/c/Users/...`）。
//     因为模型可能把路径写成 POSIX 风格，而 `cd /c/Users/...` 也要被识别成
//     「cd 到当前目录」，才能被过滤掉。这是跨平台路径处理的常见坑：
//     同一个目录在 Windows 上有两种写法，字符串比较必须两种都比。'''),

(2159, 'after_block', '''// 注：CC-643 的收敛点 —— 只在 legacy 路径上检查数量上限。
//     注释给了理由：AST 路径返回的是**有界**列表，或者对表示不了的结构
//     直接短路成 too-complex。所以只有 splitCommand 可能爆炸。
//
//     这个「只在可能出问题的分支上加护栏」的写法，比在入口统一加护栏更精准：
//     入口加护栏可能误伤合法的复杂命令（AST 本来能处理），
//     分支加护栏则只拦住真正危险的路径。'''),

(2181, 'after', '''// 注：`cd a && cd b` 这种命令会 ask，理由是「清晰性」而不是安全 ——
//     注释写的是 `require approval for clarity`。
//     多个目录切换让人（和模型自己）难以预判最终在哪个目录执行，
//     所以干脆问一声。这是一个**可用性检查混在安全检查函数里**的例子，
//     读的时候要能分辨：不是每一条 ask 都是安全原因。'''),

(2198, 'after_block', '''// 注：`compoundCommandHasCd` 这个布尔值后面被传给 4 个下游
//     （逐条裁决、路径校验、两次子结果合并），是「这条命令改过目录」的唯一信号。
//
//     它存在的原因（注释第 2199 行）：没有它就能这样绕过路径检查：
//         cd .claude/ && mv test.txt settings.json
//     单看 `mv test.txt settings.json` 完全正常（都在「当前目录」内），
//     但当前目录已经被 cd 换过了。所以「改过目录」必须作为独立信号传下去，
//     让路径校验知道「相对路径的基准已经变了」。'''),

(2202, 'after_block', '''// 注：cd + git 的组合门禁，是一个具体攻击的封堵：
//         cd /malicious/dir && git status
//     恶意目录里放一个裸 git 仓库，仓库的 `core.fsmonitor` 配置会在 git 执行时
//     运行任意命令 —— 于是 `git status` 这种「只读命令」变成了 RCE。
//
//     关键在注释第 2205-2208 行：这个检查**必须在这里做**，
//     不能依赖逐子命令的 `BashTool.isReadOnly()`。因为 isReadOnly 对
//     `git status` 单独判定时会重新算出 compoundCommandHasCd=false，
//     从而绕过 readOnlyValidation.ts 里那道门禁。
//
//     一句话：**安全判断不能在拆开之后做，因为拆开会丢上下文。**'''),

(2227, 'after', '''// 注：第 5 次 re-getAppState。到这里已经 await 了好几次（分类器、管道递归），
//     用户切模式的可能性实实在在地存在。
//     注意注释只写了 `in case the user hit shift+tab`，很短 ——
//     因为同一句理由在文件里已经写了 4 遍。'''),

(2239, 'after', '''// 注：逐条子命令裁决。注意传了 `astCommandsByIdx[i]` ——
//     如果这条子命令有 AST 版本，路径校验就能直接用 AST 的 redirects 和 argv，
//     不必再用 shell-quote 重新解析（那个有单引号 bug）。
//
//     这是「有证据就交出证据」的第三处落点（前两处在 1112 和 2045）。
//     整个文件围绕这个模式组织：AST 数据一路往下传，能传到的层就不用重新解析。'''),

(2249, 'after', '''// 注：**任一子命令 deny → 整条命令 deny**。这是「deny 优先」在子命令级别的体现。
//
//     注意 decisionReason 的类型是 'subcommandResults'，里面是一个
//     Map<子命令, 结果>。这个 Map 会把**所有**子命令的结果都带上，
//     而不只是被拒的那一条 —— 因为 UI 需要展示整条命令每一段发生了什么。
//     这也是为什么这个 Map 在函数后半段被反复重建（2258、2377、2466、2518）。'''),

(2268, 'after_block', '''// 注：这一段的注释是全文件最重要的一条**结构性提醒**：
//
//     splitCommand（以及它的 AST 替代）会在拆分时**剥掉输出重定向**。
//     所以「逐子命令的路径校验」永远看不到 `> /etc/passwd` 这类重定向。
//     必须在**原始命令**上单独校验一次。
//
//     而且顺序被明确写死：**在检查完 deny 规则之后、返回结果之前**。
//     太早 → deny 规则会被路径 ask 抢答（回到那个降级问题）；
//     太晚 → allow 已经返回了，重定向就没校验过。
//
//     这种「顺序本身是安全约束」的地方，注释里都用了 must happen AFTER ... BEFORE ...
//     这种句式，值得当成路标来读。'''),

(2284, 'after', '''// 注：注意这里只处理 `deny`，`ask` 被留到后面（第 2310 行）再判断。
//     原因是 GH#28784（见下一条注）：path 的 ask 有时会把子命令的 ask 盖掉，
//     导致弹窗文案只提「读取某个目录」而不提真正危险的命令。
//
//     所以这里的写法是：deny 立刻返回（必须），ask 先攒着（稍后合并）。'''),

(2296, 'after_block', '''// 注：GH#28784 是这份代码里记录得最完整的一个 UX 安全 bug，值得完整理解：
//
//     场景：`cd <项目外目录> && python3 foo.py`
//     checkPathConstraints 会在**整条命令**上重跑一遍，产出一个 ask，
//     但它只带一条 `Read(<dir>/**)` 建议。
//     于是 UI 渲染成「是的，允许读取 <dir>/」—— 用户点这个选项，
//     实际批准的是 **python3 执行**，而弹窗上根本没提这件事。
//
//     修法：只有当**没有任何子命令自己产出 ask** 时，才让 path 的 ask 短路返回。
//     否则继续往下走合并流程，把每个非 allow 子命令的规则建议都收集起来，
//     让弹窗显示完整的 Bash 规则。
//
//     这条 bug 的本质是：**弹窗文案是权限决策的一部分**。
//     用户点的不是「allow」，是「allow 这句话所描述的事」。
//     文案与真实授权不一致，就等于骗用户授权。'''),

(2319, 'after', '''// 注：`nonAllowCount === 1` 才短路。多个非 allow 时不短路，
//     同样是为了 GH#28784 的合并流程（让弹窗列出所有需要批准的命令）。
//
//     注意这里判断的是「非 allow 的数量」，而不是「ask 的数量」——
//     passthrough 也算非 allow，因为它同样需要用户决策。
//     一个巧合但有用的边界：`printf > file` 这种全是 passthrough 的命令，
//     会走合并流程而不是短路，于是路径 ask 才有机会被看到。'''),

(2333, 'after', '''// 注：精确 allow 的兑现点 —— 第 1 步扣住的 allow 终于在这里返回。
//     位置在「所有 deny 检查都跑完」之后，符合那句原则：
//     allow 要等到所有 deny 都问过话。
//
//     但注意它的位置在 subcommand ask 之后（2319）：也就是说
//     「某条子命令要问」优先于「整条命令被精确 allow」。
//     这个顺序其实有待商榷（精确 allow 是用户逐字批准过的），
//     但从保守角度看：多问一句比少问一句安全。'''),

(2343, 'after', '''// 注：`hasPossibleCommandInjection` 的默认值是 false。这个默认值很关键：
//     AST 路径下（astSubcommands !== null）根本不会进下面那个 if，
//     于是「没有注入」这个结论是**默认成立**的，而不是**检查得出**的。
//
//     也就是说：AST 可信时，「结构已验证」这个事实替代了「逐段跑 20 条正则」。
//     这正是新架构的价值 —— 不是检查得更严，而是**用一次正确解析替代 N 次猜测**。
//     但反过来说：如果 AST 判定有 bug，这条捷径就是静默放行。'''),

(2348, 'after_block', '''// 注：CC-643 的第二个修复 —— 埋点批量化。
//     原来每个子命令一次 logEvent，而 logEvent 会触发 `process.memoryUsage()`，
//     后者读 `/proc/self/stat`。这就是上面第 95 行注释里那句
//     「strace 显示以约 127Hz 读 /proc/self/stat」的直接来源。
//
//     修法：用闭包里的计数器累计分歧次数，最后只发一个事件。
//     注释写得很准确：`Aggregate count preserves the signal` —— 保留了信号，
//     丢掉了「哪一段分歧」的细节。这是性能与可观测性之间的明确取舍。'''),

(2368, 'after', '''// 注：`every(allow) && !hasPossibleCommandInjection` —— 全 allow 才放行。
//
//     这个条件比它看起来严格：`every` 意味着**不允许 passthrough**。
//     一条 passthrough 的子命令（没规则匹配、也不是只读）就会让这里不成立，
//     于是走到后面的「问用户」流程。这是对的：passthrough 的定义就是
//     「我这关没意见」，不等于「同意」。'''),

(2387, 'after_block', '''// 注：这里又一次出现那个「跳过 Haiku」的分支。
//     默认实现时 `commandSubcommandPrefix` 保持 null，后面
//     `commandSubcommandPrefix?.subcommandPrefixes.get(subcommand)` 就是 undefined，
//     于是 checkCommandAndSuggestRules 退回精确建议。
//
//     所以线上行为是：建议规则全部由**本地计算**给出，不调模型。
//     注释里「Query Haiku for command prefixes」这句已经过时了 ——
//     代码留在那里，但默认路径不走它。'''),

(2404, 'after', '''// 注：单子命令是最常见的路径（用户 95% 的命令不复合），单独分支的好处是
//     不用建 Map、不用收集建议，直接返回结果。
//
//     注意它传了 `astSubcommands !== null` 作为 astParseSucceeded，
//     这个布尔值在 checkCommandAndSuggestRules 里决定「要不要跑 legacy 注入检查」。
//     一路传下来，来源始终是同一个判断 —— 这就是上面说的「全局可信标记」。'''),

(2434, 'after', '''// 注：多子命令路径 —— 逐个跑 checkCommandAndSuggestRules，
//     每个都要走一遍「精确匹配 → 前缀匹配 → 注入检查 → 路径校验 → sed → 模式」。
//
//     复杂度值得算一下：N 个子命令 × 每条的规则匹配（M 条规则 × K 个候选形态）。
//     这就是为什么前面要预计算 isCompoundCommand、为什么建议规则要限 5 条 ——
//     这个位置的乘法很容易失控。'''),

(2453, 'after_block', '''// 注：注释说「这和 6b 不同，因为我们检查了命令注入结果」——
//     那句 `6b` 是**已经消失的步骤编号**。本函数早期版本给每一步都编了号
//     （现在还能看到 2417 行那句 `step 13`），后来重构把编号删了大半，
//     但遗留了这些交叉引用。读到这里不用去找「6b 在哪」，它已经不在了。'''),

(2472, 'after', '''// 注：收集建议规则。三个细节值得注意：
//
//     ① 用 `permissionRuleValueToString(rule)` 当 Map 的键来做去重 ——
//        同一个规则由不同子命令建议时只留一条。
//     ② 只收集 'suggestions'，不收 mode 变更等其他 update 类型。
//        注释解释了原因：bash 子命令主要需要规则建议。
//     ③ 下面那个 GH#28784 的补丁（第 2492 行起）解决的是「弹窗只显示 cd 的
//        Read 规则、不提 rm」的问题 —— 逻辑是：安全类 ask 通常不带建议，
//        那就**合成**一条精确规则，让弹窗至少把这条命令显示出来。'''),

(2499, 'after', '''// 注：这个补丁的三个条件都必要：
//       behavior === 'ask'                ← passthrough 不需要（它本来就会显示命令）
//       rules.length === 0                ← 已经有建议的不动（避免重复）
//       decisionReason?.type !== 'rule'   ← 显式 ask 规则不加（用户就是想每次都看）
//
//     第三个条件最有意思：它区分了「系统因为不确定而问」和
//     「用户明确要求每次问」。前者需要帮忙把命令显示清楚，
//     后者本来就是用户自己配的规则，再加一条合成规则只会有噪音。'''),

(2521, 'after_block', '''// 注：GH#11380 的收敛点。`Array.from(collectedRules.values())` 保留了
//     Map 的插入顺序（也就是子命令顺序），所以 slice 留下的是**最左边 N 条**。
//
//     为什么是「最左边」而不是「最重要的 N 条」？因为这里没有重要性排序依据，
//     而「从左到右」至少和用户读命令的顺序一致。这类「无法排序时用自然顺序」
//     的决策，在 UI 相关代码里很常见。'''),

(2539, 'after_block', '''// 注：最终返回值里 `behavior` 是动态决定的：
//       askSubresult !== undefined ? 'ask' : 'passthrough'
//
//     注释解释了为什么需要这个三元：GH#28784 之前，ask 的子结果都会在上面短路返回，
//     所以能走到这里的一定全是 passthrough 子命令，于是这里曾经硬编码 'passthrough'。
//     修复之后 ask 也可能流到这里，所以必须动态判断。
//
//     这个细节说明一件事：**一个函数的返回值语义，会随着上游流程变化而腐化。**
//     注释把这段历史留下来，比只改代码更有价值。'''),

(2559, 'before', '''// ═══ ㉕ 三个归一化器：判断「这条子命令到底是什么」 ═══
//
// 这三个函数（isNormalizedGitCommand / isNormalizedCdCommand / commandHasAnyCd）
// 服务于两个安全门禁：
//     cd + git 组合 → ask（裸仓库 core.fsmonitor RCE）
//     cd + 重定向  → 由路径校验拦截
//
// 共同点：**必须在匹配前做归一化**，否则各种写法都能绕过。'''),

(2566, 'after', '''// 译：SECURITY：必须在匹配前归一化，以防这些绕过：
//       'git' status           —— shell 引号让朴素正则看不见命令
//       NO_COLOR=1 git status  —— 环境变量前缀把命令藏起来
//
// 注：`'git' status` 这个例子非常具体：引号里的 git 在字节层面和 git 不同，
//     但 bash 执行时引号被剥掉，跑的确实是 git。
//     朴素正则 `/^git\\s/` 看不到，stripSafeWrappers 也不剥引号 ——
//     真正剥引号的是 `tryParseShellCommand`。
//     这就是为什么这个函数要「剥包装器 → 再解析 token」两步走。'''),

(2568, 'after', '''// 注：`startsWith('git ')` 这个快路径在安全代码里出现，值得想一下是否安全：
//     它只会**多判**成 git（把 `git foo` 当 git），不会少判 ——
//     而多判的后果是「多问一次」，方向是安全的。
//
//     反之如果快路径写成 `!command.includes('git') return false`，
//     就会漏判（`'git' status` 不含裸的 git 子串？其实含……但换成别的写法就漏了）。
//     快路径的原则：**只能朝「更严格」的方向走捷径。**'''),

(2582, 'after', '''// 注：`xargs git ...` 也算 git 命令 —— 因为 xargs 在当前目录执行 git，
//     和 `cd /malicious && git status` 是同一个风险场景。
//     注意条件是 `parsed.tokens.includes('git')`，也就是**任意位置**出现 git 就算，
//     比前缀匹配更宽 —— 这里故意取宽，因为漏判的代价是 RCE。
//
//     这个宽容度在本文件里属于少数派（大多数地方都是宁严勿宽），
//     但方向选对了：安全门禁宁可多问。'''),

(2590, 'before', '''// 注：这两个函数的注释都强调「必须归一化才能防绕过」，各给了一个具体例子：
//       isNormalizedGitCommand: 'git' status 与 NO_COLOR=1 git status
//       isNormalizedCdCommand:  FORCE_COLOR=1 cd sub
//     两处都用了「mirror / symmetric」这个词 ——
//     因为只要有一个归一化器漏了某类前缀，对应的门禁就能被绕过。
//     这就是「一对函数必须对称」的典型场景。'''),

(2602, 'after', '''// 注：`pushd` / `popd` 也算改目录 —— 这是很容易漏的一点。
//     注释提到它对齐的是 PowerShell 侧的 DIRECTORY_CHANGE_ALIASES，
//     说明两个 shell 工具的安全门禁要保持同一套语义，否则用户换个工具就能绕过。
//
//     `cd /tmp/bare-repo && git status` 用 pushd 写一遍，风险完全相同。'''),

(2613, 'after', '''// 注：这个函数是管道分支那个 bug 的修复工具（第 2044 行）：
//     它从**完整命令**里判断有没有 cd，而不是依赖「当前拆到哪一段」的局部视角。
//
//     实现只有一行，但意义不小：它把「有没有改过目录」这个全局事实，
//     变成了一个可以在任何地方重新计算的纯函数 —— 于是不会再有
//     「某个分支忘了传 compoundCommandHasCd 就传了 false」的问题。
//
//     这是本文件给出的最好的一条工程建议：
//     **能被重新计算的全局事实，就不要靠参数传递。**'''),

]
