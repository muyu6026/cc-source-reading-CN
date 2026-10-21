# -*- coding: utf-8 -*-
"""bashPermissions.ts 第 2 片：524–990 行（包装器剥离 · 环境变量剥离 · 规则匹配）"""

ANNOTATIONS = [

(524, 'before', '''// ═══ ⑫ stripSafeWrappers：把「包装器」剥掉，露出真正执行的命令 ═══
//
// 为什么需要它：用户写了 `timeout 10 npm install foo`，规则里存的是
// `Bash(npm install:*)`。如果不剥掉 `timeout 10`，规则永远匹配不上 ——
// 用户会觉得「我明明允许过这个命令」。
//
// 但「剥」这件事本身就是攻击面：剥错了，检查看到的是 A，bash 执行的是 B。
// 这个函数的每一段注释几乎都是一次漏洞修复记录。'''),

(525, 'after_block', '''// 译：SECURITY：用 `[ \\t]+` 而不是 `\\s+` —— `\\s` 会匹配 \\n 和 \\r，
//     而它们在 bash 里是命令分隔符。跨换行匹配会把某一行的包装器剥掉，
//     却把另一个命令留在下一行给 bash 执行。
//
// 注：这条规矩在本文件里出现了三次（第 525、570、748 行），
//     是全项目最高频的一条「安全正则纪律」：
//     **凡是匹配「命令之间的空白」，只能用 [ \\t]，绝不能用 \\s。**
//     原因在 bashSecurity 里已经用完整攻击链印证过：
//     `TZ=UTC\\recho curl evil.com` 在 JS 的 \\s 下是「两个词」，在 bash 的 IFS 下是「一个词」。'''),

(529, 'after_block', '''// 译：SECURITY：`(?:--[ \\t]+)?` 消费掉包装器自己的 `--`，这样
//     `nohup -- rm -- -/../foo` 会剥成 `rm -- -/../foo`，
//     而不是 `-- rm ...`（后者会让路径校验以 `--` 为 baseCmd 而跳过检查）。
//
// 注：「剥完剩下的第一个词就是 baseCmd」是所有路径校验的前提。
//     如果剥离后残留一个 `--`，那么 baseCmd 就成了 `--` —— 一个不存在的命令，
//     路径校验查不到任何东西，静默通过。这类「残留 token 变成假命令」的问题
//     在剥离型代码里是最典型的失手方式。'''),

(533, 'after_block', '''// 注：timeout 那条正则是全文件最长的单个正则，值得逐段拆：
//
//     ^timeout[ \\t]+
//       (?:(?:--(?:foreground|preserve-status|verbose)          ← 无值长选项
//          |--(?:kill-after|signal)=[A-Za-z0-9_.+-]+            ← 有值长选项（= 连接）
//          |--(?:kill-after|signal)[ \\t]+[A-Za-z0-9_.+-]+       ← 有值长选项（空格分隔）
//          |-v                                                  ← 无值短选项
//          |-[ks][ \\t]+[A-Za-z0-9_.+-]+                         ← 有值短选项（空格分隔）
//          |-[ks][A-Za-z0-9_.+-]+)                              ← 有值短选项（融合）
//          [ \\t]+)*                                            ← 可重复任意个
//       (?:--[ \\t]+)?                                          ← 可选的 -- 分隔
//       \\d+(?:\\.\\d+)?[smhd]?[ \\t]+                            ← 时长，然后才是真正的命令
//
//     注意它枚举了 timeout 的**全部** GNU 选项，而不是「跳过所有以 - 开头的东西」。
//     这是刻意的保守：遇到没枚举到的选项就不剥（剥不动就交给下游的 deny 匹配，
//     反正 `timeout --weird rm -rf /` 至少不会被误解成 `rm -rf /` 而放行）。'''),

(537, 'after_block', '''// 注：这条是**漏洞修复现场**，值得完整理解：
//
//     原来的值模式是 `[^ \\t]+`（任何非空白），于是：
//         timeout -k$(id) 10 ls
//     会剥成 `ls` → 匹配上 `Bash(ls:*)` → 自动放行。
//     但 bash 的处理顺序是：**先做词分割与命令替换**，也就是 `$(id)` 在
//     timeout 还没运行之前就已经执行了。所以「检查看到 ls、实际执行了 id」。
//
//     修法：值必须是 `[A-Za-z0-9_.+-]` —— 信号是 TERM/KILL/9，时长是 5/5s/10.5，
//     这些东西里不会出现 `$`、`(`、`)`、反引号、`|`、`;`、`&`。
//     一句话：**凡是要塞进正则的值，先问它的合法字符集是什么，别用「非空白」偷懒。**'''),

(544, 'after_block', '''// 译：SECURITY：与 checkSemantics 的包装器剥离（ast.ts 约 1990-2080 行）
//     以及 stripWrappersFromArgv（pathValidation.ts 约 1260 行）保持同步。
//
//     以前这个正则**要求** `-n N`；而 checkSemantics 早已处理裸 `nice` 和旧式 `-N`。
//     这种不对称导致 checkSemantics 把被包裹的命令暴露给语义检查，
//     但 deny 规则匹配和 cd+git 门禁看到的却是包装器名。于是
//     `nice rm -rf /` 配 `Bash(rm:*)` deny 规则时，结果从 deny 降级成 ask；
//     `cd evil && nice git status` 也跳过了裸仓库 RCE 门禁。
//     PR #21503 修了 stripWrappersFromArgv，但这里被漏掉了。
//     现在匹配：`nice cmd`、`nice -n N cmd`、`nice -N cmd`（checkSemantics 会剥的全部形式）。
//
// 注：这段注释的价值不在于「nice 怎么写」，而在于它演示了一类系统性风险：
//     **同一个语义（哪些是包装器）被抄在 3 个地方实现**，
//     改一处不改另两处，就产生「一个视角剥了、另一个视角没剥」的绕过。
//     而且绕过不是崩溃，是「deny 静默降级成 ask」—— 日志里看不出来。
//     作者用「KEEP IN SYNC」注释来维护，这本质上是一种靠人记性的同步。
//     （bashSecurity.ts 里那对 DEPRECATED 函数是同一个问题的另一个案例。）'''),

(617, 'before', '''// ═══ ⑬ 为什么 timeout 的选项解析要单独抽一个函数 ═══'''),

(632, 'after', '''// 译：从 stripWrappersFromArgv 里抽出来，以让 bashToolHasPermission 保持在
//     Bun 的 feature() DCE 复杂度阈值之下 —— 内联这个函数会破坏
//     classifier 测试里 feature('BASH_CLASSIFIER') 的求值。
//
// 注：这是本文件第 2 处「为打包器而重构」的痕迹（第 1 处是第 81 行那段 DCE 悬崖注释）。
//     判断依据很简单：这个函数只有 stripWrappersFromArgv 一个调用者，
//     逻辑也完全内聚，按正常工程直觉根本不需要拆出来。
//     看到「单调用者 + 注释解释为什么要拆」，基本就是撞上打包器限制了。'''),

(633, 'after', '''// 注：这个函数的返回值语义要看清 —— 它返回的是**时长 token 的下标**，不是命令下标。
//     最后一行 `return i` 之后，调用方还要自己校验 `a[i]` 是不是时长形状，
//     再 `slice(i + 1)` 才拿到命令。
//
//     `return -1` 的三种情形（未知长选项、未知短选项、其余 - 开头）都表示
//     「选项看不懂，别剥」。调用方拿到 -1 直接返回原 argv —— **fail-closed**。
//     这点很重要：看不懂就不剥，比猜着剥要安全得多。'''),

(651, 'after', '''// 注：`--` 是「选项结束」标记。这里 `i++` 后立刻 break，
//     意思是把 `--` 消费掉，后面的第一个 token 就是时长。
//
//     对照 stripSafeWrappers 里那条 `(?:--[ \\t]+)?` —— 两处实现的是同一个语义，
//     一处用正则、一处用下标。这也是「同一语义两份实现」的又一例。'''),

(670, 'before', '''// ═══ ⑭ stripWrappersFromArgv：正则版的「argv 版」 ═══'''),

(677, 'after', '''// 译：stripSafeWrappers 的 argv 级对应物。从 AST 派生的 argv 里剥掉同样的包装器命令
//     （timeout、time、nice、nohup）。环境变量已经被分到 SimpleCommand.envVars 里了，
//     所以这里不需要剥环境变量。
//
//     KEEP IN SYNC：如果在上面的 SAFE_WRAPPER_PATTERNS 里加了包装器，这里也要加。
//
// 注：注释说「保持同步」，但**读代码会发现它并没有完全同步**：
//     上面 stripSafeWrappers 已经能剥裸 `nice cmd` 和旧式 `nice -N cmd`（PR #21503 之后），
//     而这里的条件只有 `a[0] === 'nice' && a[1] === '-n' && /^-?\\d+$/.test(a[2])`，
//     也就是只处理 `nice -n N` 一种形式；裸 nice 会落到最后的 else 直接 return。
//     影响有限（AST 路径下 checkSemantics 自己会剥裸 nice），但这正好印证了
//     上面第 544 行那条注释的担忧：靠注释维持同步，总有一天会不同步。'''),

(683, 'after', '''// 注：`for (;;)` 无限循环 + 每轮只剥一层，是为了处理嵌套包装器：
//     `nohup timeout 10 nice -n 5 npm test` 要连剥三层。
//     退出条件是最后那个 else —— 第一个不是包装器的 token 出现就返回。'''),

(703, 'before', '''// ═══ ⑮ 两种剥离强度的分工：allow 严、deny 松 ═══'''),

(707, 'after', '''// 译：会让「另一个二进制」跑起来的变量（注入或解析劫持）。
//     只是启发式 —— `export && 形式` 能绕过它，而且 excludedCommands 本来就不是安全边界。
//
// 注：注释里那句「excludedCommands 不是安全边界」是这个项目反复强调的立场：
//     只有「权限提示」是安全边界，其他都是便利性优化。
//     写这种注释是为了防止后来者把它当护栏用。'''),

(710, 'after', '''// 译：剥掉命令开头的**所有**环境变量前缀，不管变量名是否在安全白名单里。
//
//     用于 deny/ask 规则匹配：用户 deny 了 `claude` 或 `rm`，
//     那么即使写成 `FOO=bar claude`，命令也应该保持被封。
//     stripSafeWrappers 里的白名单限制对 allow 规则是正确的
//     （防止 `DOCKER_HOST=evil docker ps` 自动匹配 `Bash(docker ps:*)`），
//     但 deny 规则必须更难被绕过。
//
//     也用于 sandbox.excludedCommands 匹配（不是安全边界 —— 权限提示才是），
//     用 BINARY_HIJACK_VARS 当黑名单。
//
// 注：**这是整个文件最重要的一个设计思想**，值得单独记：
//
//     allow 规则和 deny 规则用**不同的剥离强度**。
//       · allow 要「严格」—— 只剥确定的、无害的东西。多剥一点就可能把
//         `DOCKER_HOST=evil docker ps` 错认成 `docker ps` 而自动放行。
//       · deny 要「宽松」—— 尽量多剥，剥到能认出被禁命令为止。
//         因为 deny 漏判的代价（执行了被禁命令）远大于误判的代价（多问一句）。
//
//     这不是不一致，是**有方向的不对称**：两种错误代价不同，所以要朝不同方向偏。
//     很多权限系统的失败就在于对两者用了同一套归一化逻辑。'''),

(732, 'after', '''// 译：SECURITY：值模式比 stripSafeWrappers 更宽。这里只排除真正的 shell 注入字符
//     （$、反引号、;、|、&、括号、重定向、引号、反斜杠）和空白。
//     像 =、+、@、~、, 这种在未加引号的赋值位置是无害的，必须能匹配上，
//     否则 `FOO=a=b denied_command` 就能轻松绕过。
//
// 注：`FOO=a=b` 这个例子的意思是：如果值字符集不允许 `=`，
//     那么匹配会在第一个 `=` 处结束，剩下 `b denied_command` 里既没有可剥的赋值、
//     也不以 `denied_command` 开头 —— deny 规则就匹配不上，命令被放行。
//     一个字符集少写一个字符，就是一条绕过路径。'''),

(737, 'after_block', '''// 注：这段注释列了 5 种赋值形式，全都要支持：
//       标准赋值 FOO=bar   ·  追加 FOO+=bar   ·  数组 FOO[0]=bar
//       单引号值 ''（bash 抑制一切展开）
//       双引号值 ""（bash 里只有 \\$ \\` \\" \\\\ 和 \\换行 是特殊的）
//       未加引号的值（排除 shell 元字符，允许反斜杠转义）
//       以及拼接形式 FOO='x'y"z"
//     「bash 会把相邻片段拼接起来」这一点最容易漏 —— `FOO='a'b"c"` 是一个完整的赋值。'''),

(755, 'after_block', '''// 注：`$` 被排除在未加引号/双引号值字符集之外，直接后果是
//     `FOO=$VAR denied_command` **不会被剥**。
//     作者明确记录了取舍：加上 $VAR 匹配会引入 ReDoS 风险（CodeQL #671），
//     而经 $VAR 绕过的优先级较低。
//
//     这是「安全 vs 可用」的典型权衡记录：知道有这个缺口，
//     评估过代价，选择了不修，并把理由写在代码里。
//     比起悄悄不修，这种写法让后来者能重新评估，而不是重新踩一遍。'''),

(765, 'before', '''// 注：又是 `while (stripped !== previousStripped)` 的固定点循环 ——
//     和 stripSafeWrappers 同一个套路：只要还能剥就继续剥，剥不动为止。
//     `FOO=a BAR=b BAZ=c cmd` 靠这个循环一轮剥一个。'''),

(771, 'before', '''// 注：`break` 而不是 `continue` —— 命中黑名单变量时**立刻停止**整个剥离，
//     不是跳过这一个继续剥下一个。
//     语义是：「一旦看到会让另一个二进制跑起来的变量，这条命令的整体形态就不可信了，
//     后面的剥离也不再有意义。」这也是一种 fail-closed。'''),

(778, 'before', '''// ═══ ⑯ 规则匹配的核心：一条命令怎么对上一条规则 ═══'''),

(778, 'after', '''// 注：函数名直译是「按内容匹配输入来过滤规则」，但更好记的说法是：
//     **把命令加工成多个候选形态，然后拿每一条规则去试每一个形态。**
//
//     三个参数决定它的行为：
//       matchMode   'exact'（整条命令原样比）| 'prefix'（子命令级比）
//       stripAllEnvVars  只有 deny/ask 传 true（见上面 ⑮ 的不对称设计）
//       skipCompoundCheck  复合命令护栏的开关（AST 路径下可跳过）
//
//     返回值是所有命中的规则对象（可能多条）。'''),

(789, 'after_block', '''// 注：先剥掉「输出重定向」再匹配，这样 `Bash(python:*)` 能匹配
//     `python script.py > output.txt`。
//     重定向目标的安全性**不在这里管** —— 那由 checkPathConstraints 单独负责。
//     这种「按维度分工」在本文件很常见：规则匹配只看命令，路径约束只看路径，
//     两边互不越界，各自把一件事做好。'''),

(798, 'after', '''// 注：精确模式下同时试两个形态（原样 + 去重定向），前缀模式只试去重定向的。
//     为什么精确模式要保留原样？因为**引号是命令的一部分** ——
//     `Bash(git commit -m "fix")` 这条精确规则里带引号，只有原样形态能匹配上。
//     如果只拿去重定向后的形态，引号可能已被改写，规则就失效了。'''),

(806, 'after', '''// 注：如果剥包装器之后变了，就把「原样」和「剥后」**两个都留下**当候选。
//     保留原样的原因同上：用户可能显式存了带 `timeout` 的规则。
//     多留候选的代价只是多几轮比较，收益是「两种写法都能匹配」。'''),

(826, 'after', '''// 注：固定点迭代，注释给的例子是全文件最好的同步/异步混合案例：
//         nohup FOO=bar timeout 5 claude
//       1. stripSafeWrappers 剥 `nohup`      → FOO=bar timeout 5 claude
//       2. stripAllLeadingEnvVars 剥 `FOO=`  → timeout 5 claude
//       3. stripSafeWrappers 剥 `timeout 5`  → claude（deny 命中）
//
//     如果只做单次组合（先全剥包装器、再全剥环境变量），第 2 步之后
//     就没机会再剥包装器了。所以必须**反复应用到不再产生新候选为止**。
//     这就是「交错剥离需要固定点」的意思。
//
//     实现细节：用 `seen` 集合去重 + `startIdx` 游标只处理新增项，
//     复杂度是 O(候选数)，不会指数爆炸（因为字符串只会越剥越短）。'''),

(855, 'after_block', '''// 注：这里预计算「这条候选是不是复合命令」，是为了避免在下面的
//     `rules.length × commandsToTry.length` 双层循环里反复调用 splitCommand。
//     注释写得很清楚：那样会让 splitCommand 的调用次数变成乘积级。
//
//     一个值得注意的取舍：只在 'prefix' 模式且**未跳过**时才算。
//     AST 路径（skipCompoundCheck=true）下不算，因为 tree-sitter 已经切好了。'''),

(859, 'after_block', '''// 译：SECURITY：deny/ask 规则**必须**能匹配复合命令，否则把被禁命令包进
//     一个复合表达式就能绕过。
//
// 注：这就是上面「不对称设计」在代码里的落点 ——
//     `skipCompoundCheck: true` 只对 deny/ask 传（见第 954、966 行），
//     allow 永远不传（第 978 行只传 skipCompoundCheck）。
//     也就是说：复合命令护栏是**专门拦 allow 的**，deny/ask 不受它限制。
//     方向永远是「让 deny 更容易命中、让 allow 更难命中」。'''),

(884, 'after_block', '''// 译：SECURITY：不允许前缀规则匹配复合命令。
//     例如 `Bash(cd:*)` 绝不能匹配 `cd /path && python3 evil.py`。
//
//     正常流程里命令到这一步之前已经切开了，但**shell 转义可以让第一轮切分失效**：
//         cd src\\&\\& python3 hello.py   →   splitCommand   →   ["cd src&& python3 hello.py"]
//     它看起来就是一条以 "cd " 开头的单命令。所以这里对候选再切一次来兜住。'''),

(894, 'after_block', '''// 注：`startsWith(prefix + ' ')` 而不是 `startsWith(prefix)` ——
//     这个空格是**词边界**，防止 `ls:*` 匹配到 `lsof` 或 `lsattr`。
//     少写这个空格，`Bash(ls:*)` 就等于把 lsof、lsattr、lsusb 全放行了。
//     这类「前缀匹配必须带词边界」的规矩，任何做规则匹配的系统都躲不掉。'''),

(902, 'after_block', '''// 注：`xargs` 的特殊处理。`Bash(grep:*)` 要能匹配 `xargs grep pattern`，
//     反过来 deny 规则 `Bash(rm:*)` 也要能拦住 `xargs rm file`。
//
//     但只匹配**裸 xargs**（没有 flag 的）：`xargs -n1 grep` 不以 "xargs grep " 开头，
//     自然不会命中。作者用「自然词边界」来避免再写一个 flag 解析器 ——
//     这个技巧很省事，前提是「带 flag 的 xargs 本来就不该被前缀规则概括」。'''),

(915, 'after', '''// 注：通配符规则的两个硬约束：
//     ① **精确模式下永不匹配**。因为精确模式面对的是未拆分的整条命令，
//        `foo *` 会匹配 `foo arg && curl evil.com`（`.*` 把操作符也吃了）。
//     ② 前缀模式下也不匹配复合命令，理由同上（`Bash(cd *)` vs `cd /path && ...`）。
//
//     结论：通配符只在「已经切分成单个子命令」之后才有安全感。
//     这条约束是「匹配的上下文决定模式能不能用」的典型例子。'''),

(937, 'before', '''// ═══ ⑰ matchingRulesForInput：三种行为各查一遍 ═══'''),

(943, 'after', '''// 注：注意这三组查询的**参数差异**，是全文不对称设计的第二处落点：
//       deny  → { stripAllEnvVars: true, skipCompoundCheck: true }
//       ask   → { stripAllEnvVars: true, skipCompoundCheck: true }
//       allow → { skipCompoundCheck }          ← 不给 stripAllEnvVars
//
//     也就是：deny/ask 会「剥光所有环境变量 + 跳过复合护栏」，
//     allow 只「跳过复合护栏」。allow 的严格性在这里体现为「不乱剥」，
//     deny 的宽松性体现为「剥到能认出来为止」。'''),

(981, 'before', '''// 注：返回三个数组而不是单个结论 —— 优先级（deny > ask > allow）由调用方决定。
//     这是有意的：stripSafeWrappers 这类函数只负责「查出事实」，
//     「按什么顺序裁决」留给上层。所以第 1000 行、第 1083 行、
//     第 1220 行能看到同一套 deny→ask→allow 的顺序被写了三遍。
//     重复是有代价的，但换来的是每个调用点都能明确表达自己的优先级。'''),

]
