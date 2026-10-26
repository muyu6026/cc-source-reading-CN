# -*- coding: utf-8 -*-
# src/utils/ide.ts  L1494
ANNOTATIONS = [

(47, 'after', r'''文件总览：IDE 集成的发现层。核心是一条「非信任通道」——IDE 侧的扩展会在本机写锁文件（端口 + 工作区路径 + pid + 可选 authToken），CLI 靠扫描这些锁文件反向找到「哪个编辑器窗口在跑着我」。整条链有四道筛：① 锁文件按 mtime 排序（新窗口优先）；② 端口探活（TCP connect 500ms）；③ 工作区路径前缀匹配（NFC 归一，防 macOS 的 NFD 与 IDE 的 NFC 拼不上）；④ 进程祖先链匹配（多个窗口工作区重叠时靠 parent pid 区分）。四道都过才认。'''),

(56, 'after', r'''进程探活用 signal 0：不真发信号，只让内核校验「该 pid 存在且我有权限」。ESRCH 抛错即进程已死。比 ps 快三个数量级，是后面所有 pid 校验的原子操作。'''),

(71, 'after', r'''祖先链查询做成惰性单发闭包，注释写清了理由：pid 会回收、进程树会变，所以只能在**一次检测过程**内缓存。返回的是 Set 而不是数组，因为后面只做 has 查询。getAncestorPidsAsync 从 ppid 起向上走最多 10 层。'''),

(90, 'after', r'''IdeLockfileInfo 与上面的 LockfileJsonContent 是两个视角：前者是「解析后保证有 port 与 workspaceFolders」的内部形态，后者是「磁盘上可能缺字段」的原始 JSON。分离两型的价值是让 port 的类型从 string 收窄成 number，不必在每次使用时再转。'''),

(100, 'after', r'''DetectedIDEInfo 是对外契约：url 已按传输层拼好（ws 或 sse），isValid 表示「工作区是否匹配当前 cwd」——注意它是**结果字段**而非过滤条件，includeInvalid 为真时非法项也会返回给调用方去做 UI 展示。'''),

(128, 'after', r'''IdeConfig 把「按平台的关键词表」收进一个结构：macOS 用 ps aux 的完整命令行，Windows 用 tasklist 的映像名，Linux 用 ps 的进程名。三平台关键词差异巨大（同一个 Cursor 在 mac 是 Cursor Helper、Windows 是 cursor.exe），所以不能共用一张表。'''),

(257, 'after', r'''十八种 IDE 的静态注册表。三处细节值得记：① aqua / gateway / fleet 的 macOS 关键词是空数组，注释写「太常见不自动检测」——一个叫 aqua 的进程在 mac 上满地都是，纳入检测会天天误报；② Cursor 与 Windsurf 是 vscode 分支（复用同一套扩展协议），因此 ideKind 决定用哪条安装/探测路径；③ Android Studio 的 Linux 关键词是 android-studio（带连字符），而 Windows 是 studio64.exe，命名毫无规律可言。'''),

(263, 'after', r'''isVSCodeIde 与下面的 isJetBrainsIde 是仅有的两个「类型 → 家族」判定，全部下游分支（装扩展、查版本、探测终端）都靠它们分叉。写成查表而非 switch，新增 IDE 只改一处表。'''),

(269, 'after', r'''JetBrains 家族判定。它与 vscode 家族的关键差别：JetBrains 插件**无自动安装**（原生构建里不支持），只能提示用户去市场手动装，所以这条判定后面跟着的全是「只读探测」路径。'''),

(285, 'after', r'''isSupportedTerminal 是三个条件的并：VSCode 系终端、JetBrains 系终端、或环境变量 FORCE_CODE_TERMINAL。第三个是逃生门——终端识别失败（比如 tmux 里 TERM_PROGRAM 被吃掉）时手工强制进入「受支持终端」分支。memoize 是因为它在渲染热路径上被反复调用。'''),

(292, 'after', r'''getTerminalIdeType 与上面的 isSupportedTerminal 有一个隐蔽的不一致：判定与取名走**不同的环境源**——判定用 env.terminal，取名也返回 env.terminal，而 JetBrains 的判定用的是 envDynamic.terminal（动态重读）。动态版存在的理由是某些终端会中途改写 TERM_PROGRAM。'''),

(344, 'after', r'''getSortedIdeLockfiles：跨多个候选目录并发 readdir + stat，展平后按 mtime 降序。两个设计点：① 目录不存在属于预期（候选路径不做存在性预检，见后面 getIdeLockfilesPaths 的注释），用 isFsInaccessible 静默跳过，否则每次启动都刷一堆 logError；② 单个锁文件的 stat 失败返回 null 再 filter，避免一个坏文件毁掉整批。'''),

(393, 'after', r'''readIdeLockfile 兼容两代格式：新格式是 JSON（workspaceFolders / pid / ideName / transport / authToken），老格式是**纯文本路径列表**（一行一个）。解析失败就按行切分当路径——这不是兜底而是明确的向后兼容，因为老版本扩展还在用户机器上跑。端口不在文件里，从文件名 12345.lock 反推。'''),

(433, 'after', r'''checkIdeConnection 用裸 TCP 连接代替 HTTP 请求：扩展可能只监听 ws、或者 HTTP 路由会 404，但端口开没开是统一的判据。三个回调都显式 destroy socket，否则 timeout 之后句柄会漏。默认 500ms 是探测预算——启动阶段要扫十几个锁文件，不能每个都等几秒。'''),

(453, 'after', r'''getWindowsUserProfile 专治 WSL：WSL 进程通常拿不到 Windows 的 USERPROFILE，只能 shell 出 powershell.exe 去问。注释标了代价（冷启动 0.5–2 秒）并因此 memoize——每会话只付一次。这是「WSL 里找 Windows 侧配置」的通用成本模型：跨边界查询都慢，必须缓存。'''),

(515, 'after', r'''getIdeLockfilesPaths 的注释是本文件最有价值的一段工程账：候选路径**故意不做存在性预检**，交给消费方 readdir 吃 ENOENT。理由是 WSL 下 /mnt/c 访问慢 2–10 倍，而逐个用户目录 stat 的循环会把启动延迟叠起来——预检省下的是「错误日志噪音」，付出的是「每会话几十次跨文件系统 syscall」。这个取舍方向在跨边界场景里普遍成立。'''),

(581, 'after', r'''cleanupStaleIdeLockfiles：清理顺序是先判 pid 再判端口。WSL 特例值得记——Windows 侧 pid 在 WSL 里没有意义（pid 命名空间不同），所以「进程不在了」不能作为删除依据，必须再补一次 TCP 探活，两者都失败才删。这是 WSL 双命名空间带来的判据叠加。'''),

(588, 'after', r'''IDEExtensionInstallationStatus 把「失败」也建模成正常返回值（installed=false + error），而不是抛异常。调用方（启动流程）需要在失败时仍然走完 UI 分支（提示手动安装），异常会打断这条链。'''),

(622, 'after', r'''maybeInstallIDEExtension 成功路径里顺手把 diffTool 设成 auto（仅当用户没设过）——扩展装上了才配自动 diff，顺序反了会让没装扩展的用户看到报错。埋点也是分开的：tengu_ext_installed / tengu_ext_install_error 两条独立事件，便于算安装成功率。'''),

(657, 'after', r'''findAvailableIDE：30 秒轮询窗口，每秒扫一次，**只有恰好一个匹配才返回**。多于一个就返回 null 让用户走 /ide 手动选——自动连错窗口比连不上更糟（会把 diff 打到别人的工作区）。两处细节：① 新一轮搜索先 abort 上一轮的 AbortController，避免旧循环继续跑；② getIsScrollDraining 为真时跳过本轮——detectIDEs 会 shell 出 ps，与滚动帧抢事件循环。'''),

(827, 'after', r'''detectIDEs 是整条发现链的汇合点。四层判据的**顺序**是性能设计：工作区路径匹配（纯内存）放在最前，进程祖先链（要 shell 出 ps，最多 10 次）放在最后且惰性触发——注释明确写了，早先这个 shell 调用在每个锁文件上都跑一次，是 CPU profile 里的头号热点。另有三个正确性细节：① cwd 与 IDE 路径都 normalize 成 NFC，否则带重音/CJK 的路径永远匹配不上；② Windows 下把盘符统一大写再比，因为 C: 与 c: 是同一盘；③ 端口与 CLAUDE_CODE_SSE_PORT 一致时跳过工作区校验（显式指定优先）。'''),

(836, 'after', r'''maybeNotifyIDEConnected：连上之后反向通知扩展自己的 pid，让扩展侧知道「是谁连进来的」。扩展据此展示状态栏、挂接 diff 视图。'''),

(845, 'after', r'''hasAccessToIDEExtensionDiffFeature 只看「有没有一个 name 为 ide 的已连接 MCP 客户端」。这个字符串常量是跨进程契约：扩展注册时用的名字必须与此处一致，改名会让 diff 能力静默失效。'''),

(877, 'after', r'''isIDEExtensionInstalled 分两族实现：VSCode 系 shell 出 code --list-extensions 看输出里有没有扩展 ID；JetBrains 系查缓存（isJetBrainsPluginInstalledCached）——因为 JetBrains 没有等价 CLI，只能读插件目录。内部构建用不同的扩展 ID（anthropic.claude-code-internal），这是 USER_TYPE 分支的唯一用途。'''),

(911, 'after', r'''installIDEExtension 的版本比较是「本地扩展版本 < 当前 CLI 版本就重装」，用 lt 而非不等——降级 CLI 时不该把新扩展替换成旧的。sleep(500) 前注释写着 code 命令连续调用会崩，这是真实踩过的坑。JetBrains 分支直接返回 null：原生构建不支持自动安装。'''),

(925, 'after', r'''getInstallationEnv 在 Linux 上把 DISPLAY 清空。原因是 Cursor 的 Linux 版可能把 code 命令实现成「打开 GUI」，脚本化调用会意外弹窗；清掉 DISPLAY 让这类误实现直接失败而不是挂在那里。这是个很实用的防御：把「不该启动 GUI」变成环境层面的硬约束。'''),

(929, 'after', r'''getClaudeCodeVersion 读构建期注入的 MACRO.VERSION，不是 package.json——打包后 package.json 可能不在，而宏会被内联成字面量。'''),

(949, 'after', r'''getInstalledVSCodeExtensionVersion 解析 --show-versions 的输出（格式 publisher.name@1.2.3），按 @ 切分。返回 null 与「版本解析失败」共用同一个信号，调用方一律当「需要重装」处理——这个方向的误判成本低（多重装一次），反向误判会留下不兼容的旧扩展。'''),

(1016, 'after', r'''getVSCodeIDECommandByParentProcess 是 macOS 专属的「从进程树反推可执行文件路径」：从 ppid 起向上走 10 层，每层 ps -o command= 拿完整命令行，在里面找 Visual Studio Code.app / Cursor.app 等已知包名，命中就拼出 /Contents/Resources/app/bin/<cli>。存在理由是 mac 上这些分支不一定会把 code 命令装进 PATH（Cursor 可以注册成 code）。'''),

(1049, 'after', r'''getVSCodeIDECommand 有两条来源，顺序是「父进程反推」优先、PATH 兜底：前者能精确指到当前窗口所属的那个编辑器，后者只能猜。Windows 上额外拼 .cmd 后缀，这段注释值得完整读——VS Code 1.110.0 起在开始菜单启动时会把安装根目录（含 Code.exe，GUI 二进制）插到 PATH 里 bin 目录之前，于是裸 code 经 PATHEXT 解析成 Code.exe，脚本调用变成新开一个编辑器窗口。请求 code.cmd 强制跳过 Code.exe。'''),

(1054, 'after', r'''isCursorInstalled 用 --version 判存在：退出码 0 即装。'''),

(1059, 'after', r'''isWindsurfInstalled 同上，windsurf --version。'''),

(1067, 'after', r'''isVSCodeInstalled 多一道校验：不只看退出码，还要求 stdout 里出现 Visual Studio Code 字样。因为很多编辑器（Cursor、Windsurf、各种分支）都注册了 code 命令，只看退出码会把它们全当成 VS Code。'''),

(1147, 'after', r'''detectRunningIDEsImpl 按平台走三条完全不同的命令：mac 与 linux 用 ps aux 管道 grep，Windows 用 tasklist 管道 findstr。三处细节：① reject: false + shell: true，grep 无匹配时退出码非 0，不能让 execa 抛；② Windows 与 Linux 都先 toLowerCase 再比，因为 tasklist 输出大小写不统一；③ Linux 上 vscode 的关键词 code 与 cursor / appcode 冲突，所以特别处理——已经检测到 cursor 或 appcode 时不再把 code 算成 vscode。'''),

(1158, 'after', r'''detectRunningIDEs 做新鲜检测（约 150ms）并**回写缓存**。这个写回是刻意的：调用方主动要新鲜结果时，顺手让后续的缓存读也变新。'''),

(1169, 'after', r'''detectRunningIDEsCached 是给性能敏感路径（提示气泡之类）用的：缓存空才真检测。注意它不区分「检测过但为空」与「没检测过」——空数组是有效缓存值，null 才是未初始化。'''),

(1177, 'after', r'''resetDetectRunningIDEs 导出仅为测试用，注释直说了。生产代码调用它会让进程级缓存失效，代价是一次 150ms 的 ps。'''),

(1186, 'after', r'''getConnectedIdeName 与下面的 getIdeClientName 把「客户端对象 → 显示名」拆两层：前者负责在 MCP 客户端列表里挑出 ide，后者负责从配置或终端环境推出名字。'''),

(1197, 'after', r'''getIdeClientName 的三级回落：sse-ide / ws-ide 配置里的 ideName → 受支持终端的显示名 → null。第三级返回 null 而不是字符串 IDE，让调用方能区分「不知道」与「知道但名字就叫 IDE」。'''),

(1212, 'after', r'''EDITOR_DISPLAY_NAMES 是「编辑器命令名 → 展示名」的映射，注意里面混进了 vi / vim / nano / notepad / emacs / subl / atom 这些**非 IDE 编辑器**——它们不是集成对象，但用户把 $EDITOR 设成它们时，UI 里仍要显示个体面的名字而不是裸命令。'''),

(1242, 'after', r'''toIDEDisplayName 的三级解析：IDE 注册表 → 编辑器命令名精确匹配 → 取命令第一个词 basename 再查表 → 首字母大写兜底。第三级专治带参数的终端值（/usr/bin/code --wait），第四级保证永远有可读输出。'''),

(1264, 'after', r'''getConnectedIdeClient 是类型收窄版：返回 ConnectedMCPServer 而非宽泛的 MCPServerConnection，因为下游 callIdeRpc 需要已连接形态。那句类型守卫不是冗余——find 的结果类型仍是宽泛联合。'''),

(1279, 'after', r'''closeOpenDiffs 在提交新提示时关掉所有 diff 标签页（RPC 名 closeAllDiffTabs）。错误被完全吞掉：旧版扩展不支持这个方法，关不掉 diff 只是小瑕疵，不该让提交流程失败。'''),

(1348, 'after', r'''initializeIdeIntegration 的编排顺序有讲究：先**不 await** 启动 findAvailableIDE（不阻塞启动），再并行考虑装扩展。装成功且此前没装过、且引导弹窗没弹过，才弹引导。JetBrains 分支只探测不安装，但探测本身也必须跑——它填充的是状态通知要用的同步缓存。'''),

(1390, 'after', r'''detectHostIP 解决 WSL2 的反向连接问题：CLI 在 WSL 虚拟机里、扩展在 Windows 宿主上，127.0.0.1 指向的是虚拟机自己。解法是读默认网关（ip route show 的 default via），并用一次 TCP 探活确认网关确实能连到那个端口，连不上再回落 127.0.0.1。memoize 的键刻意用 runningInWindows:port 组合——同一端口在不同宿主环境下解析结果不同。CLAUDE_CODE_IDE_HOST_OVERRIDE 是手工逃生门。'''),

(1494, 'after', r'''installFromArtifactory 是内部构建（USER_TYPE=ant）的专线：从 ~/.npmrc 抠 artifactory 的 _authToken，先用它取 stable 版本号，再下载对应 .vsix 到临时目录，最后以 --force 装本地文件。三处工程细节：① 临时文件名带时间戳，多进程并发不会互相覆盖；② 装完在 finally 里删临时文件，失败也删；③ 每步错误都包成带上下文的 message（读凭据失败 / 取版本失败 / 安装非零退出），否则内部用户报障时只能看到 axios 的裸错误。'''),

]
