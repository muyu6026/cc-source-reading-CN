# -*- coding: utf-8 -*-
"""bashPermissions.ts 第 1 片：1–522 行（导入 · DCE 悬崖 · 前缀建议 · 环境变量白名单）"""

ANNOTATIONS = [

(1, 'before', '''// ═══ 文件导读：这个文件回答的问题 ═══
//
// 上一个文件 bashSecurity.ts 回答的是「这条命令能不能被**可信地解析**」；
// 这个文件回答的是「解析完之后，**要不要放行**」。
//
// 一句话概括整个文件：
//     把一条 bash 命令拆成子命令 → 每个子命令查 deny/ask/allow 规则
//     → 看路径约束 / sed 约束 / 当前权限模式 → 都没结论就问用户
//
// 结构上有个非常特别的地方，读之前必须先知道，否则会觉得作者在乱抽函数：
//
//   2621 行里，主函数 `bashToolHasPermission`（第 1663 行起）独占 895 行，
//   而中间有 5 个小函数（skipTimeoutFlags / filterCdCwdSubcommands /
//   checkEarlyExitDeny / checkSemanticsDeny / buildPendingClassifierCheck）
//   都是**纯粹为了给主函数减行数**才拆出来的 —— 不是为了复用，不是为了可读性。
//
//   原因写在下面第 81 行那段注释里：Bun 打包器的 `feature()` 求值器对
//   单个函数有复杂度预算，超了就静默把 `feature('BASH_CLASSIFIER')` 判成
//   false，整段代码被当死码删掉。这是本项目最反直觉的一条约束。'''),

(1, 'after', '''// 注：`feature` 来自 'bun:bundle' —— 这不是 npm 包，是 Bun 打包器内置的虚拟模块。
//     它只在构建期存在，作用是「死代码消除开关」：feature('X') 在构建时被替换成
//     字面量 true/false，为 false 的分支整段从产物里消失。
//     所以本文件里所有 feature(...) 都是**构建期**判断，不是运行期。'''),

(2, 'after', '''// 注：`APIUserAbortError` 是 SDK 层的「主动取消」异常。它和本地 AbortError 的区分
//     在下面 executeAsyncClassifierCheck 里很关键：两者都算「正常取消」，
//     不该冒出 unhandled rejection；其他错误必须重新抛。'''),

(4, 'after', '''// 注：GrowthBook 缓存读取。注意函数名里那句 CACHED_MAY_BE_STALE ——
//     它读的是内存里的缓存值，不发起网络请求，可能已经过期。
//     用在「解析前的快速开关」上是合适的：这里要的是快，不是准确。'''),

(5, 'before', '''// 注：`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 不是一个真实类型，
//     而是一个「品牌类型」，专门用来逼调用者做自我声明：
//     你往埋点里塞字符串，就得手写这个超长类型名，等于签字确认
//     「我核对过了，这不是用户代码、不是文件路径」。
//     埋点泄露源码内容是这个项目最忌讳的事情之一，所以用类型系统当门禁。'''),

(9, 'after', '''// 注：`ToolPermissionContext` 是整个权限系统的中枢状态，包含三种 rule 列表
//     （allow / ask / deny）、当前 mode、以及工作目录范围等。
//     `ToolUseContext` 是更外层的「这一次工具调用」的上下文，多一个 abortController
//     和 getAppState()。区别值得记：权限判定要读前者，取消信号在后者。'''),

(12, 'before', '''// 注：下面这组来自 `utils/bash/ast.ts` —— tree-sitter 解析的产物。
//     `parseForSecurityFromAst` 把语法树归约成「安全视角」的结论：
//     要么是一串可信的 SimpleCommand（引号已解析、无隐藏替换），
//     要么是 'too-complex'（结构太复杂，静态分析不可信）。
//     这个三分法是整个新权限体系的基石。'''),

(20, 'before', '''// 注：这里同时导入了 `splitCommand_DEPRECATED` 和下面的
//     `bashCommandIsSafeAsync_DEPRECATED`。两个 DEPRECATED 是历史包袱：
//     它们都基于正则/手写扫描，和 bash 自己的解析器有偏差（差异攻击链见
//     bashSecurity.ts 的批注）。新代码优先走 AST，走不了才回落到它们。'''),

(70, 'before', '''// 注：`BashTool` 被本文件 import 进来只为了两件事：
//     ① `BashTool.name` 拼接话术和规则名；② `BashTool.isReadOnly(input)`
//     在第 1154 行做「只读命令直接放行」的判定。
//     注意这是**循环依赖**（BashTool.tsx 又 import 了本文件的 bashToolHasPermission），
//     靠 ESM 的惰性求值能成立，但任何在模块顶层就用 BashTool 的代码都会炸。'''),

(81, 'before', '''// ═══ ① 这段注释是整个文件最该先读的：为什么要有那么多「莫名其妙的小函数」 ═══'''),

(81, 'after_block', '''// 译：DCE 悬崖：Bun 的 feature() 求值器对**每个函数**有复杂度预算。
//     bashToolHasPermission 正好卡在边界上。import 块里的
//     `import { X as Y }` 别名也计入这个预算；一旦推过阈值，Bun 就无法证明
//     feature('BASH_CLASSIFIER') 是常量，会**静默**把那些三元表达式求值成 false，
//     从而丢掉每一处 pendingClassifierCheck 的展开。
//     所以把别名改写成顶层的 const 重绑定。（另见下面 checkSemanticsDeny 的注释。）
//
// 注：这条约束的可怕之处在于「静默」。
//     不是编译报错，不是运行时报错，而是：分类器自动放行这个功能**悄悄消失**。
//     线上表现是「以前会自动放行的命令现在都要问」，用户只会觉得烦，
//     不会想到是打包器把一个 feature 判成了 false。
//     作者的应对方式也不是重构，而是「把行数挪出去」—— 见第 630/1363/1389/1427 行
//     四处一模一样的注释，全是同一个原因。'''),

(88, 'before', '''// 注：这两行就是上面注释说的「顶层 const 重绑定」。
//     为什么不直接 `import { bashCommandIsSafeAsync_DEPRECATED as bashCommandIsSafeAsync }`？
//     因为别名会计入上面那个复杂度预算。改成 const 之后，import 语句里没有别名，
//     函数体里看到的只是一个普通标识符。
//
//     代价：读代码的人会疑惑「为什么要多这一层」。答案在打包器里，不在代码里。'''),

(91, 'before', '''// 注：`ENV_VAR_ASSIGN_RE` 只匹配「像环境变量赋值」的形状（NAME=...），
//     **不检查名字是否在安全白名单里**。白名单判断在三个 while 循环里各做一次。
//     这种「正则管形状、Set 管名单」的分工在本文件反复出现。'''),

(95, 'before', '''// ═══ ② CC-643：子命令数量上限，一个真实的性能事故 ═══'''),

(95, 'after_block', '''// 译：CC-643：在复杂复合命令上，splitCommand_DEPRECATED 可能产出极长的
//     subcommands 数组（可能是指数级增长；#21405 的 ReDoS 修复也许并不完整）。
//     之后每个子命令都要跑 tree-sitter 解析 + 约 20 个 validator + logEvent，
//     配合 memoized 元数据，产生的 microtask 链会**饿死事件循环** ——
//     REPL 卡在 100% CPU，strace 显示以约 127Hz 读 /proc/self/stat 且没有 epoll_wait。
//     五十很宽松：正常用户命令不会切这么宽。超过上限就退化成 'ask'
//     （安全默认 —— 我们无法证明安全，那就问）。
//
// 注：这是本项目里少见的一份「完整事故报告」写法，值得学它记录了什么：
//     ① 触发条件（复杂复合命令）② 怀疑的根因（指数增长 + 未修完的 ReDoS）
//     ③ 放大链路（每子命令 ~20 个 validator）④ 可观测现象（100% CPU）
//     ⑤ 诊断证据（strace 的 127Hz、缺 epoll_wait）⑥ 阈值为什么取 50（宽松）
//     ⑦ 超限后的降级策略，以及为什么降级到 ask 而不是 allow。
//     一条注释把「怎么发现的」也留下了，下次同类问题能顺着 strace 线索查。'''),

(103, 'after', '''// 注：**超限降级到 ask 而不是 deny**，这个选择有讲究：
//     deny 会让一条合法但写法复杂的命令直接失败；
//     ask 只是多问一句，用户看得懂命令，自己判断就行。
//     安全默认 = 「让人类接一下手」，不是「一律拒绝」。'''),

(105, 'before', '''// ═══ ③ GH#11380：复合命令的「建议规则」为什么最多 5 条 ═══'''),

(106, 'after_block', '''// 译：给复合命令的每条子命令建议一条规则，但设上限。
//     超过这个数量，「是的，以后 X、Y、Z… 都不用问」这个标签本身就会退化成
//     「类似的命令」，而且从一个弹窗里保存 10+ 条规则更像噪音而非意图。
//     一条 && 链里串这么多写命令的用户很少；他们随时可以先批准一次、再手动加规则。
//
// 注：这里藏着一个 UI 与权限系统的耦合点 —— 建议规则的数量会改变
//     **弹窗文案的语义**（从明确列举退化成模糊概括）。所以上限不是性能考虑，
//     是「别让用户在没看清的情况下批量授权」的可用性考虑。'''),

(112, 'before', '''// 注：[ANT-ONLY] 前缀说明这是内部员工才走的分支。
//     判断方式在函数体第一行：`process.env.USER_TYPE !== 'ant'` 直接 return。
//     这类代码在外部构建里**存在但不执行** —— 和 feature() 的构建期删除不同，
//     这里代码还在包里，只是对非员工恒假。'''),

(117, 'after', '''// 注：注意签名里的四个参数都是「原始材料」：命令原文、behavior、描述列表、分类器结果。
//     它不做任何判断，只负责打包成埋点事件。
//
//     第 140 行那句注释 `command contains code/filepaths - this is ANT-ONLY so it's OK`
//     是整个埋点体系里唯一出现的例外：把用户命令原文上报。
//     理由只有一个 —— 限内部。这也解释了为什么这个函数叫 ForAnts 而不是 ForAnalytics。'''),

(146, 'before', '''// ═══ ④ 前缀提取：什么样的命令值得「记住这一条」 ═══'''),

(160, 'after', '''// 译：从原始命令串里提取一个稳定的前缀（命令 + 子命令）。
//     只有当开头的环境变量赋值都在 SAFE_ENV_VARS（或员工的 ANT_ONLY_SAFE_ENV_VARS）
//     里时才跳过它们。遇到非安全的环境变量就返回 null（回落到精确匹配），
//     或者第二个 token 不像子命令（小写字母数字，如 "commit"、"run"）时也返回 null。
//
// 注：这段注释的四个例子是全文最有价值的自测题，逐条对一下：
//       'git commit -m "fix typo"'  → 'git commit'    ← 标准两词前缀
//       'NODE_ENV=prod npm run build' → 'npm run'     ← NODE_ENV 在白名单里，可以跳过
//       'MY_VAR=val npm run build'  → null            ← MY_VAR 不在，不能跳
//       'ls -la'                    → null            ← 第二词是 flag
//       'cat file.txt'              → null            ← 第二词是文件名
//       'chmod 755 file'            → null            ← 第二词是数字'''),

(170, 'before', '''// 注：这个 while 循环的**返回值语义很容易看漏** —— 遇到非安全变量不是「跳过它继续」，
//     而是 `return null` 直接放弃提取。
//     原因在第 168-169 行：如果在这里生成了 `Bash(npm run:*)` 这样的前缀规则，
//     但规则匹配时 stripSafeWrappers 又不会剥掉 MY_VAR，那么这条规则
//     **永远不可能匹配上** —— 用户点了「以后不用问」，下次照样被问，还以为功能坏了。
//     宁可返回 null、只建议精确匹配，也不要生成一条永远失效的规则。'''),

(184, 'before', '''// 注：`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` 这个形状检查排除了四类东西：
//     以大写开头（环境变量残留）、含点或斜杠（文件路径 ./script.sh、/usr/bin/x）、
//     以横杠开头（flag）、纯数字（chmod 755 里的 755）。
//     允许中间带横杠，是为了 `docker-compose`、`git-lfs` 这种名字。'''),

(190, 'before', '''// ═══ ⑤ BARE_SHELL_PREFIXES：哪些「前缀」永远不能建议给用户 ═══'''),

(190, 'after_block', '''// 译：裸前缀建议像 `bash:*` 或 `sh:*` 会通过 `-c` 放行任意代码。
//     包装器建议像 `env:*` 或 `sudo:*` 也一样：`env` 不在 SAFE_WRAPPER_PATTERNS 里，
//     所以 `env bash -c "evil"` 会原样穿过 stripSafeWrappers，
//     撞上前缀匹配器里的 startsWith("env ") 检查。
//     这份 shell 列表对应 src/utils/shell/prefix.ts 的 DANGEROUS_SHELL_PREFIXES，
//     那个常量守护的是旧的 Haiku 提取器。'''),

(208, 'after', '''// 注：`env` 和 `xargs` 被归进「会把自己的参数当命令执行的包装器」这一类。
//     它们的危险不在于名字本身，而在于 `env <任意命令>` 里的 `<任意命令>` 完全自由 ——
//     一条 `Bash(env:*)` 等于 `Bash(*)`。'''),

(211, 'after_block', '''// 注：`nice` / `stdbuf` / `nohup` / `timeout` / `time` 这一组的注释更狠：
//     checkSemantics（ast.ts）会把它们**剥掉**再检查里面的命令，
//     所以建议 `Bash(nice:*)` 约等于建议 `Bash(*)`：用户批准之后，
//     `nice rm -rf /` 在语义检查层看到的是 `rm -rf /`（放行），
//     而 deny 规则和 cd+git 门禁看到的却是 `nice`（不匹配）。
//     两套视角不一致 = 绕过。
//     注释里还记了一句：在修这个问题之前，SAFE_WRAPPER_PATTERNS 并没剥裸的 `nice`。'''),

(221, 'after_block', '''// 注：`sudo` / `doas` / `pkexec` 是提权三件套。注释说得很直接：
//     `sudo -u foo ...` 建议出来的 `sudo:*` 会**自动批准未来任何** sudo 调用。
//     一句话：提权命令不存在「安全的常用前缀」。'''),

(228, 'before', '''// ═══ ⑥ 只给 UI 用的降级方案：拿第一个词当天真前缀 ═══'''),

(242, 'after', '''// 译：仅 UI 用的兜底：getSimpleCommandPrefix 拒绝时（比如带管道或复合结构），
//     退化成只取第一个词。外部构建里 TREE_SITTER_BASH 是关的，
//     所以 BashPermissionRequest 里那个异步的 tree-sitter 精修永远不会触发 ——
//     没有这个兜底，管道和复合命令（`python3 file.py 2>&1 | tail -20`）
//     会被原封不动倒进可编辑输入框。
//
//     刻意不被 suggestionForExactCommand 使用：后端建议的 `Bash(rm:*)` 太宽，
//     不能自动生成，但作为「可编辑的起点」正是用户想要的。
//
//     复用与 getSimpleCommandPrefix 相同的 SAFE_ENV_VARS 门禁 —— 因为
//     `Bash(python3:*)` 这样的规则在检查时永远匹配不上 `RUN=/path python3 ...`。'''),

(259, 'before', '''// 注：同一个形状正则、同一个 `BARE_SHELL_PREFIXES` 检查 ——
//     也就是说这个「天真兜底」也守住了 `bash` / `sudo` 这类绝对不能进输入框的名字。
//     天真是有底线的。'''),

(266, 'before', '''// ═══ ⑦ 建议规则的三级降级链：heredoc → 多行 → 两词前缀 → 精确 ═══'''),

(267, 'after_block', '''// 注：这个函数的每一步都在回答同一个问题：
//     「把这条命令原样存成规则，下次还用得上吗？」
//     规则系统的语义是**字符串匹配**，所以任何每次都变的部分（heredoc 内容、
//     多行正文）都必须剥掉，否则存下来的规则是一次性用品。'''),

(275, 'before', '''// 注：多行命令走「第一行当前缀」。注释里点出一个很实在的后果：
//     把整段多行文本存进规则，会产生**中间带 `:*`** 的 pattern，
//     这种 pattern 过不了权限校验，会**写坏 settings 文件**。
//     这是「建议规则」这条链上唯一的破坏性失败模式，值得单独记一笔。'''),

(289, 'before', '''// 注：单行命令先试两词前缀（`git commit` 这种），失败才退回精确匹配。
//     最后一行 `sharedSuggestionForExactCommand` 是真正的兜底 —— 只有
//     `ls -la` 这类既没 heredoc、也没换行、又提不出前缀的命令才走到这里。'''),

(297, 'before', '''// ═══ ⑧ 三个「转手」导出：本文件只是壳 ═══'''),

(306, 'after', '''// 译：如果命令含 heredoc（<<），提取它之前的前缀，返回 heredoc 操作符前面的
//     第一个（或前两个）词作为稳定前缀；没有 heredoc 就返回 null。
//
// 注：`command.indexOf('<<')` 是纯字符串查找，不看引号、不看上下文。
//     所以 `grep '<<' file` 也会被当成 heredoc，然后去提取 `grep` 前缀 ——
//     结果是「提出一个还算合理的前缀」，而不是崩溃。失败模式是良性的。'''),

(343, 'before', '''// 注：从这一行往下连续三个导出，全是**纯转发**：
//       permissionRuleExtractPrefix → shared
//       matchWildcardPattern       → shared
//       bashPermissionRule         → shared
//     真正实现在 utils/permissions/shellRuleMatching.ts。
//     之所以要留这一层，是因为 PowerShell 工具共用同一套规则匹配逻辑，
//     而 bash 侧需要自己的「大小写敏感」等差异；抽到 shared 之后，
//     这里的转发同时充当「兼容旧 import 路径」的垫片。'''),

(368, 'before', '''// ═══ ⑨ SAFE_ENV_VARS：整份文件最需要「按禁忌读」的常量 ═══'''),

(377, 'after', '''// 译：可以安全地从命令里剥掉的环境变量白名单。这些变量**不能**执行代码或加载库。
//
//     SECURITY：以下这些**永远**不能加进白名单：
//     - PATH、LD_PRELOAD、LD_LIBRARY_PATH、DYLD_*（执行 / 库加载）
//     - PYTHONPATH、NODE_PATH、CLASSPATH、RUBYLIB（模块加载）
//     - GOFLAGS、RUSTFLAGS、NODE_OPTIONS（可以藏代码执行开关）
//     - HOME、TMPDIR、SHELL、BASH_ENV（影响系统行为）
//
// 注：读这份白名单的正确方式是看「为什么这一类能进」：
//       GO*     只影响编译目标，不改变跑什么
//       RUST_*  只影响日志
//       NODE_ENV 只是一个字符串约定（**不是** NODE_OPTIONS）
//       PYTHONUNBUFFERED / PYTHONDONTWRITEBYTECODE 只影响输出与缓存
//       LC_* / LANG / TZ / TERM / COLOR 只影响显示
//       ANTHROPIC_API_KEY 是认证 —— 剥掉它不改变执行的程序
//     而「禁忌清单」里那些的共同点只有一个：**能改变实际执行的代码**。
//     这条线划得非常干净，可以作为自己项目里同类白名单的判据。'''),

(401, 'after', '''// 注：`ANTHROPIC_API_KEY` 出现在「安全可剥」名单里，第一眼会让人紧张。
//     想清楚就明白了：剥掉它意味着命令**少了**认证能力，不会多出执行能力。
//     白名单判据是「能不能执行代码」，不是「是不是敏感信息」。'''),

(432, 'before', '''// ═══ ⑩ ANT_ONLY_SAFE_ENV_VARS：一份明确的「不能给外部用户」清单 ═══'''),

(446, 'after', '''// 译：仅限员工使用的、可安全剥除的环境变量。只在 USER_TYPE === 'ant' 时生效。
//
//     SECURITY：这些变量会在权限规则匹配**之前**被剥掉，意味着
//     `DOCKER_HOST=tcp://evil.com docker ps` 会匹配上 `Bash(docker ps:*)` 规则。
//     这**刻意**只给内部用（第 590 行附近有门禁）且**绝不能**发给外部用户。
//     DOCKER_HOST 会重定向 Docker daemon 端点 —— 剥掉它等于把网络端点藏起来，
//     从而破坏基于前缀的权限限制。KUBECONFIG 同理，控制 kubectl 连哪个集群。
//     这些是给接受风险的内部高级用户的便利性剥离。
//
//     结论来自对 30 天 tengu_internal_bash_tool_use_permission_request 事件的分析。'''),

(447, 'after', '''// 注：这份名单里有几个值得单独看一眼的：
//       KUBECONFIG / DOCKER_HOST  ← 直接换目标，最危险的两个
//       GH_TOKEN / PGPASSWORD     ← 注释写「已批准的凭据子集，不改变外泄风险」
//                                    逻辑是：本来就在命令行里，剥掉不增加风险
//       CI / SKIP_NODE_VERSION_CHECK ← 纯布尔开关
//     注意 `CLUSTER` 这种泛型名字也在里面 —— 泛型名意味着「任何叫 CLUSTER 的
//     环境变量都会被剥」，包括用户自己定义的。这在员工场景可接受，外部不可接受。'''),

(499, 'before', '''// ═══ ⑪ stripCommentLines：一个「看不见引号」的行过滤器 ═══'''),

(507, 'after', '''// 译：剥掉整行注释。处理模型爱在 bash 命令里写注释的情况，例如：
//       "# Check the logs directory\\nls /home/user/logs"
//     应该被剥成 "ls /home/user/logs"。
//
//     只剥**整行**注释（整行都是注释的行），不剥行内注释（命令后面跟的 #）。'''),

(508, 'after', '''// 注：**这个函数完全不认识引号。** 它逐行 trim，然后 `startsWith('#')` 就删掉整行。
//
//     这不是疏忽，而是整个 bashSecurity「引号内换行」漏洞的另一半：
//     在 `mv ./decoy '<换行>#' ~/.ssh/id_rsa` 里，第二行以 `#` 开头，
//     于是被这里整行删掉，路径校验只看到 `./decoy`（在项目内）→ acceptEdits 自动放行。
//     而 bash 那边，引号里的换行是**内容的一部分**，两条路径都真的被 mv。
//
//     这个漏洞在上游由两层防御兜住：bashSecurity 的 validateQuotedNewline 会
//     对带引号内换行的命令直接 ask；tree-sitter AST 路径下 checkSemantics 也会
//     拒绝含换行的 argv 元素（bashPermissions.ts:1800 的注释明确提到这一点）。
//     换句话说：**这个函数不安全，但调用它的地方都先确认过安全**。
//     读到这里应该建立一个习惯 —— 看到可疑的字符串处理，先去找它的护栏在哪。'''),

(516, 'before', '''// 注：全部行都是注释/空行时返回原始命令，而不是空字符串。
//     这个细节很重要：返回空串会让后续所有校验面对一条「空命令」，
//     空命令通常意味着「无事可做」，可能被当成 trivially safe 放行。
//     返回原文则至少让后续检查看到真实内容（哪怕它全是注释）。'''),

]
