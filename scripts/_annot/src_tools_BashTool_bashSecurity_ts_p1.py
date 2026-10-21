# -*- coding: utf-8 -*-
# bashSecurity.ts 批注 · 第 1 片（1-740 行）
ANNOTATIONS = [

(1, 'before', '''════════════════════════════════════════════════════════════════════
【本文件在整条权限链里的位置】

BashTool 每收到一条命令，要过三道关：

  ① 结构闸门   bashPermissions.ts:1692  parseCommandRaw() → parseForSecurityFromAst()
                用 tree-sitter 建 AST，判「这条命令能不能被安全地切分」
  ② 危险检测   本文件（bashSecurity.ts）
                用正则 + 手写状态机，判「这条命令里有没有解析器差异」
  ③ 权限判定   bashPermissions.ts:1663  bashToolHasPermission()
                规则匹配 / 沙箱 / 分类器 / 用户确认

本文件是 ②。但注意文件末尾那两个函数都带 `_DEPRECATED` 后缀，注释里写
「The primary gate is parseForSecurity (ast.ts)」—— 意思是：只要 tree-sitter
的 WASM 加载成功，主流程根本不会走到这里。

那它为什么还在？三个真实理由，缺一不可：
  · tree-sitter WASM 可能加载失败（环境/平台/体积限制），必须留降级路径
  · `readOnlyValidation.ts:1894` 和 `:1971` 是**同步**函数，拿不到 async 的
    tree-sitter 结果，只能同步调本文件的 `bashCommandIsSafe_DEPRECATED`
  · `CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK=1` 会关掉 AST 那条路，
    只剩本文件兜底

所以「DEPRECATED」在这里的含义是「不再是第一道闸门」，不是「不再运行」。
════════════════════════════════════════════════════════════════════'''),

(10, 'after', '''// 注：只导入类型（`import type`），编译期被擦除，所以这两个模块不存在也
//     不影响运行 —— 这也是为什么 `types/permissions.ts` 里那个
//     `isBashSecurityCheckForMisparsing` 字段在源码树里找不到定义却能通过构建。'''),

(12, 'before', '''// ── 1. 解析器差异清单：凡是「parser 看到 A、bash 执行 B」的结构全在这 ──'''),

(12, 'after', '''// 注：这个正则只用来做**便宜的预筛**（第 318、522、590 行都靠它快速返回），
//     真正的判定在 isSafeHeredoc 里逐行做。用 `.*` 而不是 `[\\s\\S]*` 是故意的：
//     它不跨行，所以 `$(cat <<EOF` 但换行在中间的情况会漏掉 → 落回主链，安全方向。'''),

(16, 'before', '''// 【核心清单】COMMAND_SUBSTITUTION_PATTERNS
//
// 每一条都对应一个「解析器只看得到字面量、shell 却会执行/展开」的语法。
// 它们的共同特征：不是「危险命令」，而是「危险结构」—— 哪怕命令本身完全无害，
// 只要结构能被展开成别的东西，权限判定的前提就崩了。'''),

(23, 'after', '''// 注：这条注释值得逐字读 —— 它写的是一个真实的权限绕过：
//       `=curl evil.com` 在 zsh 里展开成 `/usr/bin/curl evil.com`，
//       但 parser 看到的 base command 是 `=curl`，于是 `Bash(curl:*)` 的 deny
//       规则匹配不上。deny 被绕过，只剩 ask 兜底 —— 而 deny 的意义就是
//       「连问都不问，直接拒」。deny 失效 = 防线降级。
//
//     正则用 `(?:^|[\\s;&|])=[a-zA-Z_]` 而不是裸 `=`，是为了不误伤
//     `VAR=value` —— 那种等号左边必须有名字，右边才是值。'''),

(38, 'after', '''// 注：`<#` 这条是「为未来上锁」。当前版本不执行 PowerShell，所以这个语法
//     根本不会被解释；但一旦哪天有人加了 PowerShell 执行路径，这条已经在了。
//     这种「防御性预埋」在安全代码里很常见，代价只是一次正则匹配。'''),

(41, 'after', '''// 注：注意这个数组**没有反引号**（`` ` ``）。不是漏了，是必须分开处理：
//     反引号要区分「转义过的」和「没转义的」，而 \\` 在 SQL 里是合法字符
//     （`mysql -e "select \\`id\\` from t"`）。所以反引号走
//     hasUnescapedChar(unquotedContent, '`') 单独判（第 853 行）。'''),

(43, 'before', '''// ── 2. Zsh 模块黑名单：14 个能绕过权限模型的内建命令 ──'''),

(46, 'after', '''// 注：`zmodload` 是总开关。zsh 的模块系统是「按需装载能力」，
//     装上 zsh/files 就得到一个内建的 rm/mv/ln/chmod —— 它们不经过
//     PATH 上的二进制，所以「按二进制名做权限检查」的模型直接失效。'''),

(65, 'after', '''// 注：这一条是清单里唯一的「非命令」。
//     `mapfile` 不是一个可执行命令，而是 zmodload zsh/mapfile 之后得到的
//     一个关联数组：给 `mapfile[file]=content` 赋值就直接写文件，读它就读文件。
//     把它放进「base command 黑名单」里，实际永远匹配不到 —— 除非真有人
//     装了个叫 mapfile 的命令。它的作用是文档性的：提示审阅者「这里还有个洞」。
//
//     这是安全清单常见的形态：一部分是有效拦截，一部分是写给下一位维护者的备注。'''),

(76, 'before', '''// ── 3. 埋点 ID：为什么用数字而不是字符串 ──'''),

(77, 'after', '''// 注：注释只说「to avoid logging strings」，真实理由比这更具体 ——
//     这是**埋点基数控制**。logEvent 的每个不同值都是一个独立的时间序列，
//     如果用字符串 `'incomplete_commands'`，任何一次手误（拼错、大小写、
//     改了文案）都会凭空多出一个序列，几个月后看板上全是长尾噪音。
//     固定 23 个数字 + subId，基数上界就是几十，永远不会膨胀。
//
//     实测：这 23 个 ID 全部有使用点，没有一个定义了不用。
//     用得最多的是 OBFUSCATED_FLAGS（11 处），说明「用引号藏 flag」
//     是这个文件里最活跃的攻击面。'''),

(103, 'before', '''// ── 4. 六个视图：所有 validator 都不重新解析命令 ──
//
// 设计要点：22 个 validate* 函数没有一个去重新解析命令字符串。它们只读
// ValidationContext 里预先算好的几个字符串视图。这带来两个好处：
//   · 每个 validator 变成纯函数，好读、好测、不容易写出状态 bug
//   · 「剥引号」这种容易出错的逻辑只写一遍（extractQuotedContent）
// 代价是：视图一旦算错，22 个 validator 会一起错。所以第 128 行那个
// 状态机的正确性，比任何一个 validator 都重要。'''),

(110, 'after', '''// 注：`fullyUnquotedPreStrip` 与 `fullyUnquotedContent` 只差一道
//     stripSafeRedirections。为什么要留两个？
//     因为「剥掉 `>/dev/null`」这个动作会**删除字符**，删完可能造出原本
//     不存在的邻接关系。例：`cmd \\>/dev/null` 剥掉后剩 `cmd \\`，
//     看起来像合法的续行符，实际藏了第二条命令。
//     所以「判断换行」必须用 strip 之前的版本（第 910 行），
//     「判断重定向」才用 strip 之后的版本（第 876 行）。'''),

(113, 'after', '''// 注：`unquotedKeepQuoteChars` = 保留引号字符本身、删掉引号里的内容。
//     专门给 validateMidWordHash 用（第 1920 行）。没有它的话，
//     `'x'#` 剥完只剩 `#`，看起来是词首的注释；保留引号后是 `''#`，
//     一眼就能看出 `#` 前面紧挨着东西 —— 中缀 `#` 才是解析器差异。'''),

(128, 'before', '''// ── 5. extractQuotedContent：三份视图，一次扫描 ──
//
// 这是整个文件的地基。它把一条命令变成三份「剥过引号的副本」：
//   withDoubleQuotes      去单引号内容，保留双引号内容   （调用方叫它 unquotedContent）
//   fullyUnquoted         两种引号内容都去掉
//   unquotedKeepQuoteChars 引号字符保留，引号内容去掉
//
// 命名有个坑：调用方把 withDoubleQuotes 赋给了 `unquotedContent`，
// 但它的语义是「双引号内容**还留着**」。判「会不会执行」时必须用它
// （双引号里的 $() 真会执行），判「命令结构」时才用 fullyUnquoted。'''),

(132, 'after', '''// 注：状态机只有三个布尔。这个极简结构在本文件里被复刻了 6 次
//     （第 693、980、1266、1550、1632、2011、2125 行），每次都必须
//     逐字写对 —— 一旦某个副本漏了 `!inSingleQuote` 这个 guard，
//     它的引号状态就会永久 desync，后续所有检测全部失效。
//     第 1280 行的长注释记录的就是这样一次 desync 的完整攻击链。'''),

(147, 'after', '''// 注：`!inSingleQuote` 这个 guard 是全文件最容易漏的一处。
//     bash 里单引号内的一切都是字面量，包括反斜杠 —— `'\\'` 是一个
//     反斜杠字符，不是「转义了收尾的引号」。
//     如果这里漏掉 guard：`\\` 置 escaped=true，收尾的 `'` 被 escaped
//     分支吃掉而不翻转 inSingleQuote → 状态机永远停在「单引号内」→
//     后面所有检测全部跳过。攻击样本：`jq '\\' "-f" evil`。'''),

(164, 'after', '''// 注：jq 特例。jq 的程序本身就是用双引号包字符串的（`jq ".a | .b"`），
//     如果把双引号内容剥掉，剩下的 jq 程序就是空的，validateJqCommand
//     就什么都看不见了。所以对 jq 保留双引号内容 —— 让检测器能看到
//     被双引号包住的 `system("...")`。'''),

(176, 'before', '''// ── 6. stripSafeRedirections：三条正则，每条都必须有尾边界 ──'''),

(177, 'after', '''// 注：这段大写 SECURITY 注释是一个**真实 bug 的复盘**，值得逐字读。
//
//     假设去掉 `(?=\\s|$)`：
//       `echo hi > /dev/nullo`
//     正则 `[012]?\\s*>\\s*/dev/null` 会把 `> /dev/null` 当成**前缀**匹配掉，
//     剩下 `echo hi o`。
//     然后 validateRedirections 去找 `>` —— 没了，放行。
//     而「写到 /dev/nullo」这个动作会走只读路径被**自动允许**
//     （checkReadOnlyConstraints 认为 /dev/null 系列是安全的）。
//     一次任意文件写入，零提示。
//
//     注释还点明了一处不对称：主流程有 checkPathConstraints 兜底
//     （它校验的是**原命令**，没被 strip 过），但 speculation.ts
//     只调 checkReadOnlyConstraints —— 那条路上没有兜底。
//     所以这个边界不是「保险」，是唯一防线。'''),

(190, 'before', '''// ── 7. hasUnescapedChar：只处理单字符，这是硬约束 ──'''),

(208, 'after', '''// 注：这段 IMPORTANT 不是客套。多字符版本会立刻踩上 ANSI-C 引用：
//     `$'\\n'` 是换行，`$'\\x41'` 是 A，`$'\\u0041'` 也是 A。
//     一个「查找未转义字符串」的函数如果声称支持多字符，
//     就必须先实现这套解码，否则 `$'\\x3b'` 能绕过所有「找 `;`」的检测。
//     结论：宁可只支持单字符，也不要写一个半对的通用版本。'''),

(209, 'after', '''// 注：两个细节。
//     1) `i += 2` 一次跳过反斜杠和被转义字符 —— 这正确处理了奇偶：
//        `\\\\` 是转义的反斜杠，后面紧跟的字符是独立的。
//     2) 最后一个例子 `hasUnescapedChar("test\\\\`date`", '`') → true`：
//        `\\\\` 消耗成一对，然后反引号是裸的 → 真。
//        这个例子存在的意义是提醒：数反斜杠个数比「看起来有没有转义」可靠。'''),

(233, 'before', '''// ═══ 8. 早期 validator ═══
// 这一组（validateEmpty / validateIncompleteCommands / validateSafeCommandSubstitution
// / validateGitCommit）在主链**之前**跑，它们可以 return allow。
// 但注意第 2317 行：allow 会被调用方**降级成 passthrough**。原因见那儿。'''),

(244, 'after', '''// 注：三条都是「这条命令像个片段，不像完整命令」：
//       以 Tab 开头        —— 从别人的缩进代码里复制出来的
//       以 `-` 开头        —— 只剩 flag，命令名丢了
//       以 && || ; > < 开头 —— 续行被单独提交了
//
//     为什么这算安全问题？因为 prompt injection 常这么干：
//     让模型只输出后半截，拼到用户已有的命令后面。用户看到的是一条，
//     实际执行的是两条。所以「片段」本身就要问一声。'''),

(288, 'before', '''// ═══ 9. isSafeHeredoc：全文件最危险的一个函数 ═══
//
// 危险在哪：它返回 true，validateSafeCommandSubstitution 就 return allow，
// 而 allow 在调用方会让 bashCommandIsSafe **直接 passthrough** ——
// 后面的 18 个 validator 一个都不跑。
//
// 所以注释写的是 "must be PROVABLY safe, not 'probably safe'"。
// 这句话是这个函数全部设计的理由：它不是「我判断它大概安全」，
// 而是「我能证明它只可能是这一种形态，其余一律 false」。'''),

(316, 'after', '''// 注：唯一被允许的形态就这一种。逐条拆开看它约束了什么：
//       前缀            必须有（不能在命令名位置）
//       $(cat <<'DELIM'  必须 cat，必须引号/转义分隔符
//       body            字面量文本（因为分隔符被引号了，不展开）
//       DELIM)          闭合分隔符必须独占一行
//       后缀            可选，但过完剥离后必须全部无害
//
//     为什么单拎出 heredoc？因为它是唯一「看起来像注入、实际是数据」的语法。
//     用户天天写 `git commit -m "$(cat <<'EOF' ... EOF)"`，
//     而 `$(` 在 COMMAND_SUBSTITUTION_PATTERNS 里是一律 ask 的。
//     不特判的话，每次多行提交信息都要弹窗。'''),

(320, 'after', '''// 注：`[ \\t]` 而不是 `\\s`。\\s 包含 `\\n`，但 bash 要求 heredoc 的分隔符
//     词必须和 `<<` 在**同一行**。允许跨行匹配，就等于接受一段 bash
//     会拒绝的语法 —— 而「我们接受、bash 拒绝」正是所有绕过的前提。'''),

(350, 'after', '''// 注：这里解释了为什么不用 `[\\s\\S]*?`。
//
//     正则的懒惰匹配会「跳过第一个 DELIM，去找后面某个 DELIM)」：
//       $(cat <<'EOF'
//       data
//       EOF
//       ; rm -rf /
//       EOF)
//     懒惰匹配能一路找到最后的 `EOF)`，把中间的 `; rm -rf /` 当成 body。
//     但 bash 在第 3 行的 EOF 就闭合了，`rm -rf /` 是真执行的命令。
//
//     所以必须逐行扫，找到**第一个**恰好等于分隔符的行就停 —— 精确复刻
//     bash 的行为。这也是这段代码不能换成一行正则的原因。'''),

(374, 'after', '''// 注：两种合法闭合形式，都来自 bash 解析器的真实行为：
//       1) DELIM 独占一行，`)` 在下一行行首
//       2) DELIM) 同一行（bash 的 PST_EOFTOKEN 会同时闭合 heredoc 和替换）
//     第 2 种是 `$(cat <<'EOF'\\n...\\nEOF)` 这种「右括号跟着分隔符」的写法，
//     没有它的话，最常见的写法都会被拒。'''),

(421, 'after', '''// 注：这一条是「分隔符后面跟着 shell 元字符」—— 说明这一行不是干净的
//     闭合行，而是 `EOF)` 之后接了别的东西。宁可 return false 落回主链，
//     也不要去猜 bash 会怎么处理。这类「遇到歧义就退出」的判断，
//     在本函数里出现了 8 次，是这个函数能被称为 "PROVABLY safe" 的原因。'''),

(439, 'after', '''// 注：嵌套检测，理由值得单独讲 —— 这是一个「修 bug 引入的 bug」的复盘。
//
//     前提：外层 heredoc 用引号分隔符（<<'A'）时，body 在 bash 里是**字面量**。
//     所以 body 里写 `$(cat <<'B'` 只是一串字符，不是真 heredoc。
//     但第 324 行那个正则是在**原始文本**上跑的，两个都会匹配 → 得到嵌套区间。
//
//     然后剥离时会出事：先剥内层，外层区间的 `end` 就过期了（指向缩短后的
//     字符串之外）→ `remaining.slice(end)` 返回空串 → **外层之后的后缀
//     静默消失**。后缀里就可能是 `; rm -rf /`。
//
//     处理方式不是「算对嵌套」，而是直接 return false 落回主链 ——
//     因为合法的 heredoc 里根本不会出现嵌套（body 是字面量，没人会这么写），
//     所以「遇到嵌套就当不安全」不会误伤真实用户。'''),

(467, 'after', '''// 注：这一段防的是「命令名位置」。
//
//       $(cat <<'EOF'
//       chmod
//       EOF
//       ) 777 /etc/shadow
//
//     heredoc 在**参数位置**时，body 只是数据；但在**命令名位置**时，
//     body 变成要执行的命令名，后面的后缀变成它的参数。
//     上面这条在 bash 里等价于 `chmod 777 /etc/shadow`。
//
//     判据：剥掉 heredoc 后，如果还有剩余文本，那么原命令在第一个 `$(`
//     之前也必须有非空白文本 —— 证明这个 `$(` 是参数，不是命令。'''),

(497, 'after', '''// 注：字符白名单只有 `a-zA-Z0-9 \\t"'.-/_@=,:+~`。
//     显式写 ` \\t` 而不用 `\\s`：\\s 会匹配 `\\u00A0`（不换行空格）这类
//     unicode 空白，而 bash 的 IFS 里没有它们 —— 那又是一个解析器差异。
//     这里的原则是：**只放行确定无害的字节**，其余全部落回主链。'''),

(502, 'after', '''// 注：最后一道 —— 剥掉 heredoc 之后的剩余文本，还要再跑一遍完整的
//     bashCommandIsSafe。理由注释写得很清楚：
//       `zmodload zsh/system $(cat <<'EOF'\\nx\\nEOF\\n)`
//     前半段是 zsh 危险命令，但因为整条命令命中了「安全 heredoc」的形态，
//     early-allow 会让 validateZshDangerousCommands **永远不跑**。
//
//     递归风险：remaining 里已经没有 `$(` + `<<` 的组合，所以递归进去
//     的 validateSafeCommandSubstitution 立刻返回 passthrough，一层就到底。'''),

(516, 'before', '''// ═══ 10. stripSafeHeredocSubstitutions：和上面几乎一样，但用途不同 ═══
//
// isSafeHeredoc 回答「这条命令能不能被证明安全」，它会 return allow。
// 这个函数只做一件事：把安全的 heredoc 片段**挖掉**，返回剩下的字符串，
// 交给调用方再检查一遍剩余部分。
//
// 调用点在 bashPermissions.ts:2100 —— 那里处理的是一个很尴尬的场景：
// 整条命令因为含 `$(` 被判为 misparsing，但原因可能只是那个合法的 heredoc。
// 挖掉 heredoc 再查剩余部分，就能区分「只有 heredoc 可疑」和「heredoc 之外还有问题」。'''),

(547, 'after', '''// 注：这里用 `line.startsWith(delimiter)`，而 isSafeHeredoc 第 389 行用的是
//     `line === delimiter`。两个函数对「分隔符后面还有内容」的处理不一致：
//       · isSafeHeredoc 严格（必须完全相等，或有 `)` 紧跟）
//       · 这里宽松（只要以分隔符开头就认）
//
//     这不是 bug，但确实是两份必须同步维护的相似逻辑。改动其中一个之前
//     先读另一个，否则会出现「一个说安全、另一个说可剥离」的分裂。
//     这类重复是本文件最大的维护成本（2592 行里，heredoc 解析做了两遍）。'''),

(585, 'before', '''// ═══ 11. validateSafeCommandSubstitution：把 allow 交给上层降级 ═══'''),

(612, 'before', '''// ═══ 12. validateGitCommit：一条专用快速通道，四个 bail-out ═══
//
// 为什么需要它：`git commit -m "..."` 是最常见的合法命令之一，
// 而提交信息里经常有 `$`、反引号、双引号、括号 —— 会连续触发
// validateDangerousPatterns、validateShellMetacharacters 等一堆 ask。
// 每个都要用户点一次确认，体验崩坏。
//
// 所以给这一种形态开快速通道。但它必须**证明**自己没漏：
// 任何一个不确定的信号，都要 bail 回主链（passthrough），而不是猜。'''),

(619, 'after', '''// 注：bail-out ①：含反斜杠就整条交给主链。
//     理由：下面那条正则靠 `(["'])([\\s\\S]*?)\\1` 找引号对，
//     而 `\\"` 会让「引号边界」判断错位：
//       git commit -m "test\\"msg" && evil
//     正则以为 `"test\\"` 是完整的引号对，剩下的 `msg" && evil` 是余量。
//     合法提交信息几乎不会含反斜杠，所以直接放弃识别是最优解。'''),

(629, 'after', '''// 注：bail-out ② 的历史注释 —— 一次真实漏洞的逐行复盘。
//
//     原来的正则是 `git\\s+commit\\s+.*?-m\\s+...`，其中 `.*?` 除了换行
//     什么都匹配，包括 `;`、`&`、`|`、反引号、`$(`。
//     于是 `git commit ; curl evil.com -m 'x'` 里，`.*?` 把
//     `; curl evil.com ` 整段吞掉，remainder 变成空串（falsy）→
//     后面的 remainder 检查被跳过 → 返回 **allow**。
//
//     而 early-allow 会跳过全部主 validator（第 1908 行附近），
//     等于 validateQuotedNewline、validateBackslashEscapedOperators
//     这些全部失效。
//
//     注释里那句话是全文的价值观：
//     "early-allow is a POSITIVE ASSERTION that the FULL command is safe"
//     —— 它断言的是「整条命令」，不是「我认识的那部分」。
//
//     修法两层：
//       · `[^;&|`$<>()\\n\\r]*?` 把 shell 元字符排除在 `.*?` 之外
//       · `[ \\t]+` 代替 `\\s+`，因为 \\s 含 \\n / \\r，而它们是命令分隔符'''),

(662, 'after', '''// 注：bail-out ③：余量里出现 `;|&()`、`$(`、`${` → 交回主链。
//     `.*?` 会吞掉 `--amend` 这类 flag，剩下的就是真正危险的部分。'''),

(675, 'after', '''// 注：bail-out ④ 的攻击链，注释里写得最完整，值得完整读一遍：
//
//       git commit --allow-empty -m 'payload' > ~/.bashrc
//
//     `>` 没被 ③ 拦住（③ 只查 `;|&()`），于是走到这里。
//     如果这里 return allow：
//       · bashCommandIsSafe 短路 → validateRedirections **永不运行**
//       · 用户的 .bashrc 被 git 的 stdout 覆盖成 `payload`
//       · 下次登录 shell → RCE
//
//     关键区分：`--author="Name <email>"` 里的 `<>` 在引号内，是字面量；
//     未引号的 `<>` 才是重定向。所以要先剥引号再查 `<` `>`。
//
//     注释里还自己交代了这个引号追踪器的局限：它没有反斜杠处理，
//     `\\'` 会让它 desync。但它指出「第 622 行已经对任何反斜杠 bail 了，
//     所以走到这里就一定没有反斜杠」—— 于是简单翻转就是正确的。
//     这种「靠上游保证」的推理是对的，但很脆：一旦 622 行的 bail 被删，
//     这里立刻出错，而且不会有任何测试报错。'''),

(716, 'after', '''// 注：`-m "---"` 这种「引号里以 dash 开头」的内容，是用来混淆
//     「flag 边界在哪」的。合法提交信息里不会有以 `-` 开头的消息。'''),

(729, 'after', '''// 注：终于到 allow。注意它返回的是**完整的 allow**（带 updatedInput），
//     但调用方会把它降级成 passthrough —— 所以这个 updatedInput 实际
//     没人用，是纯粹的死数据。见第 2317 行。'''),

]
