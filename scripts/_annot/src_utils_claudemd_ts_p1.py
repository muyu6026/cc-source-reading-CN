# -*- coding: utf-8 -*-
# src/utils/claudemd.ts  L1479
ANNOTATIONS = [

(27, 'after', r'''文件总览：CLAUDE.md 记忆体系的**装载与语义层**。文件头注释就是完整规格，值得逐行读——四类记忆按优先级从低到高：Managed（企业策略）→ User（个人全局）→ Project（入库的项目说明）→ Local（不入库的私人项目说明），**后加载的优先级更高**，因为模型对靠近末尾的内容注意力更强。发现规则：User 只在 home，Project 与 Local 从 cwd 逐级向上走到根；另有 @include 语法（只在叶子文本节点生效，代码块里不算），被包含文件排在包含者之前，靠 processedPaths 防环。'''),

(227, 'after', r'''TEXT_FILE_EXTENSIONS 是 @include 的**白名单**：只允许文本类扩展名。这不是洁癖而是硬需求——@include 的内容会直接进上下文，允许二进制就等于允许把图片/PDF 的乱码塞进 prompt，既浪费 token 也可能触发解析异常。名单长得离谱（覆盖上百种语言与配置格式），因为漏掉一种就会让用户觉得 @include 坏了；而黑名单方式永远漏。'''),

(243, 'after', r'''MemoryFileInfo 里最容易被忽略的是 contentDiffersFromDisk 与 rawContent 这对字段，注释解释了它们的存在理由：自动注入会改写内容（剥 HTML 注释、剥 frontmatter、截断 MEMORY.md），改写后 content 已不等于磁盘字节。此时保留原始字节，是为了让调用方能往 readFileState 里写一条**部分视图**缓存——命中缓存仍能去重与检测变更，但 Edit/Write 仍要求先显式 Read，避免基于截断内容做编辑。'''),

(247, 'after', r'''pathInOriginalCwd 一行包装，注意用的是 getOriginalCwd 而非当前 cwd：会话中执行 cd 之后，判断「是否在项目内」仍要以启动目录为基准，否则 @include 的外部文件审批会随 cd 漂移。'''),

(279, 'after', r'''parseFrontmatterPaths 处理条件规则的 paths 前置元数据：① 把 path/ 后缀的星号后缀去掉——ignore 库认为写目录名本身就同时匹配目录与其内部；② 全部是 ** 时视为无条件（返回 undefined 而不是空数组），否则「匹配一切」会被下游当成「匹配不到」。'''),

(298, 'after', r'''stripHtmlComments 的第一个判断是纯性能优化：不含 <!-- 就直接返回，跳过整个 lexer。这在启动路径上很关键——绝大多数 CLAUDE.md 里没有注释，不能为了可能存在的注释给每个文件都跑一次 markdown 解析。'''),

(301, 'after', r'''为什么用 marked 的 lexer 而不是正则剥注释？注释写得很明确：只用块级 token 判断，于是**行内代码与围栏代码块里的注释被保留**（用户可能就在文档里教怎么写 HTML 注释）。行内 HTML 注释（夹在段落文字中间的）也不动，因为目标是「独占一行的作者备注」。另外未闭合的注释原样保留——一个笔误不该把文件剩下的内容全吞掉。'''),

(334, 'after', r'''stripHtmlCommentsFromTokens 处理一个 CommonMark 细节：type-2 HTML 块结束于**包含结束符的那一整行**，所以注释后面同一行还可能有正文（如注释后接一句指令）。因此不能整块丢弃，而要只替换注释片段、保留残余内容。非贪婪匹配让同一行多个注释各自独立处理。'''),

(379, 'after', r'''这一段的注释是一条重要的工程经验：只有在**确实需要剥注释**时才走 token 往返重建。因为 marked 在 lex 时会把 CRLF 归一成 LF，一个 CRLF 文件哪怕没有任何注释，往返一次也会让 content 与磁盘字节不同，从而把 contentDiffersFromDisk 误标成真——垃圾标记会让下游缓存逻辑全部降级。'''),

(385, 'after', r'''AutoMem 与 TeamMem 两类入口文件要额外截断（truncateEntrypointContent，有行数与字节双上限）。这两类是「索引文件」，会随会话不断变长，不截断就会挤爆上下文。'''),

(388, 'after', r'''contentDiffersFromDisk 用「最终内容 !== 原始字节」来判，一行覆盖三种改写来源：frontmatter 剥离、HTML 注释剥离、入口文件截断。把它放在解析的最后统一计算，而不是在每处改写时置位——后者容易漏。'''),

(400, 'after', r'''parseMemoryFileContent 是纯函数（无 IO），把「读」与「解析」拆开的好处是：同一份内容只需 lex 一次，剥注释与抽取 @include 共用同一组 token。includeBasePath 作为可选参数决定是否顺带抽 include —— 顶层文件与被子文件都需要，但纯展示路径（如直接读某个文件）不需要，省一次 lex。'''),

(416, 'after', r'''handleMemoryFileReadError 把错误分三档：ENOENT 与 EISDIR **完全静默**（这是常态——每个目录都要试 CLAUDE.md、.claude/CLAUDE.md、.claude/rules，绝大多数不存在）；EACCES 才上报埋点，因为权限错误是用户可修的；其余错误也不打日志。埋点里刻意**不上报完整路径**，只上报「是否在配置主目录内」——路径含用户名与项目名，属 PII。'''),

(437, 'after', r'''safelyReadMemoryFileAsync 存在的理由写在注释里：目录遍历会产生大量 readFile 尝试（大多数 ENOENT），用异步读让事件循环保持响应。这一层把「读失败」折叠成 info 为 null，让上层的控制流不必到处 try。'''),

(446, 'after', r'''MarkdownToken 是 marked token 的最小结构子集（只声明用到的字段），刻意不用它的完整类型：token 结构随 marked 版本变化，只依赖自己实际读的五个字段能把升级影响面压到最小。'''),

(535, 'after', r'''extractIncludePathsFromTokens 是 @include 的解析器，几个细节都对应真实输入：① 正则要求 @ 前是行首或空白，避免把邮箱里的 @ 当引用；② 支持反斜杠转义的空格（路径带空格）；③ 剥掉 fragment 标识（#heading），让 @file.md#小节 指向文件本身；④ 合法形态四种（相对、./、~/、绝对），另有一条宽松分支接受「字母数字开头的裸路径」，但排除以 @ 或 markdown 强调符号开头的；⑤ 遇到 code / codespan token 直接跳过——代码里的 @ 不算引用；⑥ html token 里若剥掉注释后还有残余，也要抽（注释后同一行的 @include 有效）。递归会进 tokens 与 items 两个子结构，因为列表项挂在 items 而非 tokens 上。'''),

(537, 'after', r'''MAX_INCLUDE_DEPTH 定 5：@include 可以嵌套，深度限制与 processedPaths 一起构成双重防环（后者防重复、前者防长链）。5 层足够覆盖「总纲 → 模块 → 子模块 → 细则 → 附录」，再深基本是误用。'''),

(573, 'after', r'''isClaudeMdExcluded 只对 User / Project / Local 三类生效，Managed、AutoMem、TeamMem **永不可排除**——企业策略与自动记忆不受用户排除项影响。这里的核心难点是符号链接：用户在 exclude 里写 /tmp/project/CLAUDE.md，而系统解析出的 cwd 是 /private/tmp/project（macOS 上 /tmp 是指向 /private/tmp 的链接），两边字面不同。解法是**两边都做 realpath 展开**再比，而不是只展开文件路径。'''),

(612, 'after', r'''resolveExcludePatterns 把绝对路径模式里的**静态前缀**（第一个通配符之前的部分）取目录做 realpath，再拼回剩余部分，从而得到「同一个位置的真实路径版本」。glob 型模式（如 **/*.md）没有文件系统前缀，直接跳过。realpathSync 同步调用是被迫的——整条链路（排除判断 → 单文件处理 → getMemoryFiles）都是同步语义，这里没有 await 的位置。'''),

(685, 'after', r'''processMemoryFile 是递归装载单元，五个关键点：① 路径先 normalizePathForComparison 再进 processedPaths，否则 Windows 上 C:/Users 与 c:/Users 会被当成两个文件重复加载；② 深度或重复直接返回空数组（不是 null，让调用方可以无脑展开）；③ 符号链接要把**解析后的真实路径**也登记一遍，否则通过不同链接指向同一文件时会重复；④ 内容为空白的文件被丢弃（空 CLAUDE.md 不该占一个条目）；⑤ 主文件先入结果、被包含文件后入——虽然文件头注释说「被包含的排在包含者之前」，但代码实际是主文件在前，因为 prompt 里先给上下文再给引用它的说明更自然。'''),

(714, 'after', r'''processMdRules 的防环靠 visitedDirs（按目录而非文件），因为规则目录可以符号链接成环。'''),

(775, 'after', r'''遍历规则目录时只处理子目录与 .md 文件；conditionalRule 参数决定「只要带 paths 的」还是「只要不带的」——两类规则在不同时机装载：无条件的在启动时全量注入，有条件的要等具体操作目标文件出现时按 glob 匹配再注入（见文件末尾几个函数）。注释还点了一个性能细节：非符号链接用 Dirent 的 isDirectory/isFile 判断，省掉一次 stat。'''),

(788, 'after', r'''processMdRules 的错误处理分两层：readdir 的 ENOENT / EACCES / ENOTDIR 静默返回空（目录不存在是常态），其余错误上抛；外层 catch 只对 EACCES 记埋点（同样不上报路径）。'''),

(796, 'after', r'''getMemoryFiles 是整个记忆系统的入口，用 memoize 包住——它在每次构造上下文时都会被调用，但文件系统在会话内基本不变。注意 memoize 的键是 forceIncludeExternal（布尔），所以实际上只有两份缓存。'''),

(801, 'after', r'''includeExternal 的默认值来自项目配置的 hasClaudeMdExternalIncludesApproved：@include 指向项目外的文件属于敏感操作（等于让仓库里的文本读取任意本地文件），必须用户显式批准过才默认允许。'''),

(875, 'after', r'''这一段解决的是 worktree 重复加载（issue 29599）：从 worktree 里的 cwd 向上走会同时穿过 worktree 根与主仓库根，两边都有 CLAUDE.md 与 .claude/rules，于是同样的内容被装两遍。判定方式是比较 findGitRoot 与 findCanonicalGitRoot——不同且前者在后者的子树内，就说明当前在嵌套 worktree 里；此时跳过主仓库侧目录的 **Project 类**文件。注意 CLAUDE.local.md 不跳过，它是 gitignore 的、只存在于主仓库。'''),

(934, 'after', r'''向上走的主循环按**从根到 cwd**的顺序处理（dirs.reverse()），这样越靠近 cwd 的文件越晚进列表，符合「后加载优先级更高」。每层依次试 CLAUDE.md、.claude/CLAUDE.md、.claude/rules 三个位置，各自受对应设置源开关控制。'''),

(977, 'after', r'''--add-dir 附加目录的 CLAUDE.md 装载受环境变量控制且默认关闭。注释解释了为什么这里**不检查** projectSettings 开关：--add-dir 是用户的显式动作，而 SDK 在不指定时会把 settingSources 默认成空数组，若沿用那个开关，SDK 场景下附加目录的记忆会永远不生效。'''),

(992, 'after', r'''AutoMem 入口（自动记忆的 MEMORY.md）与下面的 TeamMem 入口走的是「直接读一个文件」而非目录遍历，且入列前要再查一次 processedPaths——它可能已经被 @include 提前装过，重复注入等于同一份内容在上下文里出现两遍。'''),

(1007, 'after', r'''TeamMem 分支整体被 feature('TEAMMEM') 包住，模块也是按需 require，未开启该特性的构建里这段代码与模块都不存在。'''),

(1040, 'after', r'''初始装载埋点只上报一次（hasLoggedInitialLoad 门闩），因为 getMemoryFiles 会在每次重建上下文时被调用，每次上报会把事件量放大几十倍。埋点带各类型文件计数，用来判断「用户到底在用哪种记忆」。'''),

(1071, 'after', r'''InstructionsLoaded 钩子这段的注释是全文件最长的一段工程账，讲清了三件事：① AutoMem/TeamMem 刻意排除——它们是另一套记忆系统，不属于 CLAUDE.md 意义上的「指令」；② 只在非 forceIncludeExternal 时触发，因为那个变体专供外部包含审批检查，在启动时会再跑一次，钩子会双触发；③ 一次性标志在**每次缓存未命中**时消耗（不管有没有配钩子），否则「会话中途注册钩子 + 手动清缓存」的组合会让标志一直挂着，之后以过期的 session_start 理由误触发。'''),

(1075, 'after', r'''getMemoryFiles 到此结束。需要注意它是一个 memoize 包裹的异步函数：并发调用会共享同一个 Promise，所以它天然是单飞的——这也是全仓很多地方敢直接调用它的前提。'''),

(1086, 'after', r'''isInstructionsMemoryType 是类型守卫，把 MemoryType 收窄成四类（不含 AutoMem/TeamMem）。用谓词函数而非内联判断，是为了让编译器在循环里自动收窄类型。'''),

(1108, 'after', r'''nextEagerLoadReason 与 shouldFireHook 这一对变量实现的是「**一次性事件标记**」：重置缓存时写入「这次为什么重载」（compaction / session_start / ...），下次装载读完即重置。这样钩子能拿到准确理由，而不会把所有重载都报成 session_start。'''),

(1122, 'after', r'''clearMemoryFileCaches 与下面的 resetGetMemoryFilesCache 是两个不同用途的入口，注释把边界划得很清楚：纯粹为了**正确性**的失效（进出 worktree、设置同步、/memory 对话框）用前者，不触发钩子；代表「指令真的被重新载入上下文」的事件（压缩）用后者，会触发钩子。混用会导致钩子误报或漏报。?? 可选链是因为测试会 spyOn 替换掉 memoize 包装。'''),

(1130, 'after', r'''resetGetMemoryFilesCache 写理由、置钩子标志、清缓存三步，顺序不能反：先设理由再清缓存，否则并发的那次装载可能读到旧理由。'''),

(1134, 'after', r'''getLargeMemoryFiles 用 40,000 字符这个常量筛「过大」文件。它不是硬限制而是提示阈值——超了会提示用户精简，但不阻止加载。'''),

(1151, 'after', r'''filterInjectedMemoryFiles 处理一个特性开关引起的语义分叉：tengu_moth_copse 开启后，记忆检索改为「按相关性预取并以附件形式注入」，MEMORY.md 索引不再进系统提示。于是「什么真的在上下文里」这个问题有了两个答案，关心它的地方（上下文构建、/context 可视化）必须过这个过滤器，否则会把没注入的文件算进去。'''),

(1195, 'after', r'''getClaudeMds 把文件列表渲染成最终注入的文本。三处设计：① 每个文件前加一句「Contents of 路径 + 括号说明」，括号文案按类型区分（入库项目说明 / 未入库私人说明 / 团队共享 / 自动记忆 / 用户全局），让模型知道这份指令的**权威级别**；② TeamMem 额外包一层带 source 属性的自定义标签，便于下游识别团队记忆的边界；③ 全部为空时返回空字符串而不是只返回那段总纲，避免「有指令但没内容」的空壳。'''),

(1276, 'after', r'''getManagedAndUserConditionalRules 是「条件规则」的两阶段装载的第一阶段：Managed 与 User 层级的带 paths 规则会在**每次读取目标文件之前**按 glob 匹配注入。Project 层的条件规则由后面的按目录函数处理，因为它的 glob 是相对于 .claude 的父目录，基准不同。'''),

(1284, 'after', r'''User 条件规则的 includeExternal 传 true（用户全局目录天然允许引用外部文件），Managed 传 false（企业策略应自包含）。'''),

(1315, 'after', r'''getMemoryFilesForNestedDirectory 里有一处精妙的 Set 复制：处理无条件规则时用 unconditionalProcessedPaths（processedPaths 的副本），处理完条件规则后再把副本并回主集。原因写在注释里——如果无条件规则直接用主集，那些文件会被标记成「已处理」，而后面的条件规则遍历就会跳过它们，导致同一目录的带 paths 规则永远匹配不到。'''),

(1318, 'after', r'''该函数只处理 cwd 到目标之间的**单层目录**，由调用方按目录逐个调用，这样嵌套目录的装载顺序完全可控。'''),

(1342, 'after', r'''getConditionalRulesForCwdLevelDirectory 只处理条件规则：cwd 及以上目录的无条件规则在启动时已经被 eager 装载过，重复处理只会造成重复注入。'''),

(1397, 'after', r'''processConditionedMdRules 是条件规则的匹配器，基准目录的取法对两类规则不同：Project 规则的 glob 相对 .claude 的父目录（即 rulesDir 往上两级），Managed/User 规则相对原始 cwd。三处防错：① 相对化后为空、以 .. 开头、或仍是绝对路径的，一律判不匹配（Windows 跨盘符时 relative 会直接返回绝对路径，ignore 库遇到这种输入会抛）；② 越出基准目录的文件本来也匹配不了相对 glob；③ 匹配用 ignore 库而非 picomatch——这里要的是 gitignore 语义（取反、目录匹配），与排除项用的 picomatch 球状语义不同。'''),

(1414, 'after', r'''getExternalClaudeMdIncludes 找「非 User 类型、有父文件、且路径在项目外」的条目——即通过 @include 从项目外拉进来的文件。这个集合是审批 UI 的数据源：用户必须看到「哪个仓库文件引用了哪个外部路径」才能决定是否授权。'''),

(1418, 'after', r'''hasExternalClaudeMdIncludes 只是长度判断，单独抽成函数是为了调用方语义清晰（不必写 .length > 0）。'''),

(1430, 'after', r'''shouldShowClaudeMdExternalIncludesWarning 的两个提前返回条件：已批准过、或已展示过警告。注意它调用 getMemoryFiles(true) 强制包含外部文件——若用默认参数，外部文件根本不会被装载，这个检查就永远为假。'''),

(1452, 'after', r'''isMemoryFilePath 是路径归类：名字是 CLAUDE.md 或 CLAUDE.local.md（任意目录），或位于 .claude/rules 下的 .md。用 sep 拼路径片段而不是写死斜杠，Windows 才不会漏判。'''),

(1479, 'after', r'''getAllMemoryFilePaths 把两个来源合并：① getMemoryFiles 走「cwd 向上到根」的标准发现；② readFileState 缓存里的记忆类文件——后者能覆盖**子目录**（标准发现只向上走，不向下），于是用户编辑过的子目录规则也能被统计到。用 Set 去重，且第一条来源要求内容非空白（空文件不算「有记忆」）。'''),

]
