# -*- coding: utf-8 -*-
# bashSecurity.ts 批注 · 第 3 片（2253-2592 行，两个主入口）
ANNOTATIONS = [

(2253, 'before', '''// ═══════════════════════════════════════════════════════════════
// ═══ 33. bashCommandIsSafe_DEPRECATED：22 个 validator 的编排 ═══
// ═══════════════════════════════════════════════════════════════
//
// 前面 32 段都是零件，从这行开始是总装。这个函数只有 160 行，
// 但它是整个文件里最容易改错的地方 —— 因为它管的是**顺序**和**短路策略**，
// 而这两样都没有类型系统保护。
//
// 读它的时候盯住三个问题：
//   ① 为什么 earlyValidators 的 allow 被降级成 passthrough？
//   ② 为什么 nonMisparsingValidators 的 ask 不能立即返回？
//   ③ 22 个 validator 的排列顺序，哪几对是有强制的先后依赖的？'''),

(2260, 'after', '''// 注：第一道 —— 控制字符。为什么放在**最前面**，而不是和其他 validator 一起？
//     因为它会让后面所有正则匹配的前提失效：
//     `echo safe\\x00; rm -rf /` 里，如果检测器把 `\\x00` 当普通字符，
//     `;` 就不在「空白之后」的位置，validateShellMetacharacters 之类的
//     「(?:^|\\s)」前缀断言全都匹配不上。
//     bash 会把 `\\x00` 扔掉然后照常执行 —— 于是检测和执行看到两条不同的命令。
//
//     这类「先清场再检查」的排序，在安全代码里叫 fail-fast precheck：
//     一旦输入本身不可信，后面的分析全部无意义。'''),

(2276, 'after', '''// 注：第二道 —— shell-quote 自己的 bug。
//     `hasShellQuoteSingleQuoteBug` 检的是 `'\\'` 这类模式：
//     在 bash 里 `'\\'` 是一个反斜杠字符，但在 shell-quote 里
//     反斜杠会「转义」掉收尾的单引号 → 引号状态永久 desync。
//
//     注意这**不是**我们要防的目标程序有 bug，而是我们**自己用的解析器**有 bug。
//     所以必须在解析之前拦，而不是解析之后校验 —— 解析结果已经不可信了。'''),

(2286, 'after', '''// 注：剥 heredoc body，但只剥「引号/转义分隔符」的（quotedOnly: true）。
//
//     理由很精确：
//       <<'EOF'  /  <<\\EOF   → body 是**字面量**，里面的 $() 不展开
//                                 → 可以安全地剥掉，免得误报
//       <<EOF                 → body 会做完整展开，里面的 $() **真执行**
//                                 → 不能剥，必须让 validator 看见
//
//     而 extractHeredocs 解析失败时会「bail out」，原样返回命令 ——
//     注释说这是 "the safe direction"：多检查一点，不是少检查一点。
//     这种「失败时朝安全方向倒」的设计，在这个文件里出现了很多次。'''),

(2295, 'after', '''// 注：`command.split(' ')[0]` —— 只按**空格**切（不是 `\\s`），
//     只取第一个。
//
//     后果一：`git\\tcommit` → baseCommand 是 `git\\tcommit`（整个），
//             validateGitCommit 的 `baseCommand !== 'git'` 直接 passthrough。
//             安全方向（少了快速通道，落回主链），只是没那么快。
//     后果二：`  git commit`（前导空格）→ baseCommand 是 `''` → 同样 passthrough。
//     后果三：`FOO=bar zmodload x` → baseCommand 是 `FOO=bar` → 不匹配。
//             但这个不影响安全，因为 validateZshDangerousCommands
//             自己重新分词（第 2200 行），不依赖 baseCommand。
//
//     所以这个粗糙的写法是「安全但不精确」：它让快速通道变窄，
//     但从不给出错误的「安全」结论。这是可接受的失败方向。'''),

(2299, 'after', '''// 注：建 context —— 三个视图都在这里定下来，后面 22 个 validator 只读不写。
//
//     注意三个字段的对应关系：
//       unquotedContent        ← withDoubleQuotes        （双引号内容保留）
//       fullyUnquotedContent   ← fullyUnquoted 再 strip   （全剥 + 去安全重定向）
//       fullyUnquotedPreStrip  ← fullyUnquoted            （全剥，不 strip）
//     没有 treeSitter 字段 —— 同步路径拿不到，所以这个字段缺席本身
//     就是「走的是降级路径」的标志。第 2487 行才填它。'''),

(2308, 'after', '''// 注：earlyValidators —— 四个「有可能直接判定安全」的检查。
//     它们按顺序跑，第一个不是 passthrough 的就决定结果。
//
//     顺序有讲究：
//       validateEmpty                最便宜，先排除空命令
//       validateIncompleteCommands   三条正则，也很便宜
//       validateSafeCommandSubstitution  要跑 isSafeHeredoc（几百行逻辑），贵
//       validateGitCommit            要跑正则 + 手写状态机，也贵
//     便宜的在前，贵的在后 —— 短路掉便宜的就不用跑贵的。'''),

(2317, 'after', '''// 注：**全文件最重要的一个设计决定** —— allow 被降级成 passthrough。
//
//     这三个 early validator 里，validateEmpty、validateSafeCommandSubstitution、
//     validateGitCommit 都会 return `behavior: 'allow'`。
//     如果这里把 allow 原样返回，会发生什么？
//
//     bashPermissions 拿到 allow，就会认为「安全检查已批准，可以执行」，
//     于是跳过规则匹配、跳过分类器、跳过用户确认。
//     也就是说：**一个误判就等于一次自动执行**。
//
//     降级成 passthrough 的语义完全不同：「我这关没意见，请继续走正常权限流程」。
//     于是安全检查的能力被限制为「只能否决，不能批准」——
//     这叫 fail-closed 的单向阀设计。
//
//     副作用的代价：`result.updatedInput` 被丢弃了。
//     validateSafeCommandSubstitution 和 validateGitCommit 都精心填了
//     `updatedInput: { command: originalCommand }`，实际没人读。
//     这是这次降级留下的死数据。
//
//     还有一处细节：message 取的是 decisionReason.reason，且要求 type 是
//     'other' 或 'safetyCheck'。为什么？因为这两个 type 的 reason 是
//     「给人看的说明文字」，可以安全地塞进 message；其他 type
//     （比如 'rule'）携带的是规则对象，塞进字符串会变成 [object Object]。'''),

(2334, 'after', '''// 注：这一段的注释是全文最重要的**设计说明**，必须逐字读懂，
//     否则会以为 2343 行那个 Set 是个无害的分类标签。
//
//     核心：ask 有两种，语义完全不同。
//       · 带 isBashSecurityCheckForMisparsing 的 ask
//         = 「这个命令我**解析不了**」→ 在 bashPermissions 的闸门**直接拦**，
//           连规则匹配都不做。因为「解析不了」意味着后续所有基于解析的
//           检查（splitCommand 切分、路径校验、规则匹配）全都不可信。
//       · 不带的 ask
//         = 「这个命令**能解析**，但我觉得该问一声」→ 走正常权限流程，
//           用户可以允许、可以加规则、分类器也可能自动放行。
//
//     那为什么 validateNewlines 和 validateRedirections 属于后者？
//     因为它们检的是**正常语法**：多条命令用换行分隔、重定向到文件，
//     这些都是 bash 的标准用法，splitCommand 处理得完全正确。
//     用户写 `ls > out.txt` 不该被当成「解析失败」。'''),

(2343, 'after', '''// 注：只有两个成员。这个集合小得可疑，但每一处「缺席」都是刻意的：
//
//       validateCarriageReturn   **不在** —— CR 是解析器差异（见 943 行的长注释）
//       validateQuotedNewline    **不在** —— 它的 ask 必须早于 stripCommentLines
//       validateCommentQuoteDesync **不在** —— 同理，必须早于基于行的处理
//       validateBackslashEscapedOperators **不在** —— 它抓的正是双解析 bug
//
//     换句话说：这个集合的**补集**才是安全关键。加成员要极其谨慎 ——
//     往里加一个 validator，就等于把它从「硬拦」降级成「问一声」。'''),

(2348, 'after', '''// 注：主链 19 个 validator 的顺序，其中三对是**强制**的，不能重排：
//
//       ① validateCommentQuoteDesync  必须在 validateNewlines 之前
//          原因：它检的是「注释里的引号把状态机带跑」，
//                状态跑偏之后 validateNewlines 就看不到未引号换行了。
//                先修状态，再判换行。
//
//       ② validateQuotedNewline       必须在 validateNewlines 之前
//          原因：它检的是**引号内**的换行（validateNewlines 按设计忽略的那种）。
//                两者是互补的，但顺序上必须先查「被藏起来的」。
//
//       ③ validateCarriageReturn      必须在 validateNewlines 之前
//          原因：CR 是 misparsing（要硬拦），LF 不是。
//                如果 LF 的先返回非 misparsing 的 ask，就会被 defer，
//                而 CR 的结果本来应该优先。
//
//     剩下的顺序基本是「从具体到泛化」：
//       具体的模式（jq、混淆 flag、元字符、变量）在前，
//       因为它们能给出更精确的话术；
//       泛化的检测（malformed token）在最后 —— 注释里明确说了这个理由。'''),

(2380, 'after', '''// 注：defer 机制 —— 全文件最反直觉的一段，也是最容易改错的一段。
//
//     问题：如果 validateRedirections（非 misparsing）先返回 ask，
//     我们**不能**立即返回。因为它不带 misparsing 标记，
//     在闸门处只值一个「问一声」，可以被用户允许。
//     而后面还没跑的 validateBackslashEscapedOperators（misparsing）
//     本来会带标记、直接硬拦。
//
//     具体 payload（注释里给的）：
//       cat safe.txt \\; echo /etc/passwd > ./out
//     - 如果 validateRedirections 先看到 `>` 就返回 → 只问一声 → 用户可能允许
//     - 但 `\\;` 才是真问题：它让 splitCommand 把命令切成两条，
//       第二条里的 /etc/passwd 逃过路径校验
//     所以必须**继续跑**，让 misparsing 的检测有机会说话。
//
//     策略：非 misparsing 的 ask 先**暂存**（只留第一个），继续跑；
//           遇到 misparsing 的 ask 就立即返回它（带标记）；
//           全跑完都没有，才返回暂存的那个。
//
//     这个模式的脆弱点：它靠「记得 return」和「记得最后兜底」两件事。
//     漏掉最后那个 if，所有非 misparsing 的 ask 都会静默消失（变成放行）；
//     漏掉 continue，就退化成原来的 bug。
//     这类「顺序敏感 + 无类型保护」的代码，是最该写测试的地方。'''),

(2392, 'after', '''// 注：`deferredNonMisparsingResult` 用 `=== null` 而不是 falsy 判断。
//     因为 PermissionResult 是对象，任何非 null 都算「已有暂存」。
//     用 falsy 会在某些实现返回 `false` 之类时出错 —— 这里是类型安全的，
//     但写成 `=== null` 更明确。'''),

(2415, 'before', '''// ═══════════════════════════════════════════════════════════════
// ═══ 34. bashCommandIsSafeAsync_DEPRECATED：同一套逻辑，第二遍 ═══
// ═══════════════════════════════════════════════════════════════
//
// 这个函数和上面那个有 80% 的代码是**逐字重复**的。
// 差异只有三处：
//   ① 先尝试 ParsedCommand.parse，拿 tree-sitter 的分析结果
//   ② 引号视图优先用 tree-sitter 的 quoteContext，同时用 regex 版本做分歧比对
//   ③ context 里多填一个 treeSitter 字段（让两个 validator 能走快速路径）
//
// 剩下 80% —— 两个前置检查、earlyValidators 循环、nonMisparsingValidators、
// 19 个 validator 的数组、defer 循环 —— 全是复制粘贴。
//
// 这是本文件最大的技术债，而且是有后果的：改一处必须改两处，
// 漏改一处不会报错，只会让两条路径行为不一致。
// 判断「该改哪条」的方法：看调用者是不是 async。
//   bashPermissions.ts:2089   async → 走这个
//   readOnlyValidation.ts:1894 同步 → 走上面那个
// 所以同一个命令，在「权限判定」和「只读判定」两条路上，
// 可能被不同的代码判定 —— 这是真实存在的不一致风险。'''),

(2430, 'after', '''// 注：`ParsedCommand.parse` 内部会先探测 tree-sitter WASM 是否可用
//     （memoize 过的 `getTreeSitterAvailable`），不可用就返回一个
//     「getTreeSitterAnalysis() 恒为 null」的降级实现。
//     所以这里不用自己判断环境。'''),

(2434, 'after', '''// 注：拿不到 tree-sitter 就直接调同步版，整条逻辑走另一份实现。
//     注意此时**不是**简单降级 —— 而是完全交给另一个函数，
//     那个函数会重新做一遍剥 heredoc、建视图的工作。
//     所以这条路上有重复计算，但正确性由同步版保证。'''),

(2439, 'after', '''// 注：两个前置检查**又写了一遍**（第 2442、2454 行），没有复用同步版。
//     为什么不能复用？因为同步版会把 19 个 validator 全跑完才返回，
//     而这里只需要那两个前置检查的结论。
//
//     这就是复制粘贴的代价：为了一点点复用，要么重构出「只跑前置检查」的
//     子函数，要么复制。作者选了复制。'''),

(2467, 'after', '''// 注：这里的关键差异 —— 三份视图来自 tree-sitter，而不是正则。
//
//     tree-sitter 的 quoteContext 是**语法级**的：它知道哪些 span 是
//     raw_string（单引号）、string（双引号）、ansi_c_string（$'...'）、
//     heredoc_redirect。所以剥引号的结果比正则状态机可靠。
//
//     但正则版本也没删 —— 保留它做「分歧比对」，见下面。'''),

(2490, 'after', '''// 注：分歧日志（divergence）—— 这三个注释里藏着一个性能事故的复盘。
//
//     为什么要记分歧？因为如果 tree-sitter 和 regex 给出的剥引号结果不同，
//     说明有一方错了。而错误方向未知：可能是 tree-sitter 漏了某种语法，
//     也可能是 regex 状态机跑偏。长期收集分歧样本，能发现真实的解析器 bug。
//
//     坑一：heredoc 命令必须跳过。tree-sitter 把 heredoc body 剥成空，
//           regex 路径用占位符替换（extractHeredocs 干的）——
//           两者永远不相等。不跳过的话，每条 heredoc 命令都记一条假分歧。
//
//     坑二（CC-643，注释里点了工单号）：为什么要有 `onDivergence` 回调？
//          在 bashPermissions 的 fanout 循环里，一条命令会被拆成 N 个子命令
//           并发检查。如果每个子命令各记一条 logEvent，就是 N 次 logEvent。
//           而每次 logEvent 都会触发 getEventMetadata() → buildProcessMetrics()
//           → process.memoryUsage() → 读 /proc/self/stat。
//           这些操作被 memoize 后变成微任务，N 个微任务连续执行会**饿死事件循环**
//           —— 表现为整个 CLI 卡住。
//           解法：调用方传入 onDivergence，只累加计数，最后合并成一条 logEvent。
//
//     坑三：单命令调用者不传回调，保持逐条记录（量小，无所谓）。
//
//     这是一个很典型的「埋点反噬性能」的案例：埋点本身很便宜，
//     但它的**依赖链**很贵（读 /proc），在循环里就变成灾难。'''),

(2518, 'after', '''// 注：从这里开始到函数结束，和同步版的第 2308-2407 行**逐字相同**。
//     唯一的差别是 context 里多了 treeSitter 字段。
//
//     逐字相同到什么程度？连注释都一样（同步版那里有更详细的注释）。
//     所以读这段时可以对照着看，理解一份就够。'''),

(2549, 'after', '''// 注：19 个 validator，顺序和同步版完全一致。
//     唯一的隐患：如果哪天有人只改了同步版的顺序（或者加了一个 validator
//     只加在一边），两条路径就会给出不同结论。
//     没有任何机制能发现这种不一致 —— 没有共享常量，没有测试比对。
//
//     改进方向（如果这是自己的项目）：把数组抽成模块级常量
//     `const VALIDATORS = [...]`，两个函数共用。这一处重构能消掉
//     本文件最危险的同源分歧。'''),

(2588, 'after', '''// 注：函数结束。回到文件开头那个问题 —— 为什么它叫 DEPRECATED。
//
//     结合整份源码看，这个命名其实记录了**架构迁移的过程**：
//       v1  纯正则 + shell-quote（本文件）
//       v2  加 tree-sitter 做语法级解析（ast.ts 的 parseForSecurity）
//       v2  把 v1 降级为 fallback，改名加 _DEPRECATED
//
//     但迁移没完成：readOnlyValidation.ts 还是同步的，只能调 v1；
//     本文件里 80% 的重复也没消除。
//
//     所以「DEPRECATED」在这里是**进行中的状态**，不是终点。
//     读这份源码时最有价值的收获，可能就是这个：真实的安全代码
//     不是设计出来的漂亮分层，而是「新的加上去了、旧的还不能删」
//     的堆叠状态。理解这种状态，比记住任何一个正则都有用。'''),

]
