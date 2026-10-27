# -*- coding: utf-8 -*-
# src/utils/bash/ShellSnapshot.ts  L582
ANNOTATIONS = [

(21, 'after', r'''文件总览：bash 快照（shell-snapshot）模块。它生成一个临时 shell 脚本，source 用户的 .zshrc/.bashrc 后把函数、选项、别名、PATH 全部 dump 进一个快照文件；后续每条命令都 source 这个快照，从而「像在用户交互 shell 里跑」而无需每条命令都新建登录 shell。核心产物是 createAndSaveSnapshot。'''),

(24, 'after', r'''两个顶层常量：LITERAL_BACKSLASH 是为了在生成的 shell 脚本里安全拼反斜杠（避免 JS 模板里反斜杠被吃掉）；SNAPSHOT_CREATION_TIMEOUT 是建快照的硬超时 10 秒。'''),

(59, 'after', r'''createArgv0ShellFunction：为外部工具（rg/bfs/ugrep）造一个 shell 函数，靠 bun 的 ARGV0 分发 trick 让同一个 bun 二进制按 argv[0] 跑对应内嵌工具。分 zsh / Windows git-bash / 子 shell / 普通四种执行路径。'''),

(92, 'after', r'''createRipgrepShellIntegration：内嵌 rg 走「函数 + ARGV0」，普通 rg 走「alias + 引号路径」；返回 type 告诉调用方用哪种注入方式。'''),

(105, 'after', r'''VCS_DIRECTORIES_TO_EXCLUDE：grep/find 集成要排除的版本控制目录清单，与 GrepTool 保持一致（.git/.svn/.hg/.bzr/.jj/.sl）。'''),

(179, 'after', r'''createFindGrepShellIntegration：用内嵌的 bfs/ugrep 整体覆盖系统 find/grep（不像 rg 只在缺失时才装）。注释巨细靡遗地说明了与 GNU find/grep、GlobTool/GrepTool 语义对齐的每个注入标志，以及 bfs 正则引擎的坑。先 unalias 掉用户可能设的 gfind/ggrep 别名，否则会被别名绕过。'''),

(191, 'after', r'''getConfigFile：按 shell 路径猜配置文件名——含 zsh 取 .zshrc、含 bash 取 .bashrc、其余取 .profile。'''),

(263, 'after', r'''getUserSnapshotContent：dump 用户自定义的「函数 + 选项 + 别名」进快照。zsh 与 bash 各自用 typeset/declare 取函数并 base64 编码防特殊字符；别名里特意过滤 Windows 的 winpty 别名以免报 stdin 不是 tty。'''),

(340, 'after', r'''getClaudeCodeSnapshotContent：拼 CLI 自己要注入的快照内容——rg 可用性检查与集成、bfs/ugrep 覆盖、以及最终 export PATH。Windows 上先读 Cygwin 的 PATH 再回退 process.env.PATH。'''),

(386, 'after', r'''getSnapshotScript：把上面两部分 content 组装成完整脚本——先建或清空快照文件、unalias -a 清掉所有别名（函数定义会冻结别名，必须清空），再依次 source 用户配置、写用户内容、写 CLI 内容，最后校验快照文件存在。'''),

(424, 'after', r'''createAndSaveSnapshot 入口：按 shell 路径定 shellType（zsh/bash/sh），建带时间戳与随机 id 的唯一快照路径并递归建目录。整体包在一个 Promise 里，用 callback 风格调 execFile。'''),

(447, 'after', r'''确保快照目录存在后，拿 getSnapshotScript 生成的脚本交给 execFile 以登录 shell（-l）执行，超时 10 秒、buffer 1MB。'''),

(471, 'after', r'''execFile 的环境装配：默认继承 subprocessEnv，但 CLAUDE_CODE_DONT_INHERIT_ENV 为真时不继承；额外注入 SHELL、GIT_EDITOR=true、CLAUDECODE=1。'''),

(571, 'after', r'''execFile 的回调失败分支：把错误码、信号、是否被强杀、stdout/stderr 长度全记进 debug 日志，并发 tengu_shell_snapshot_failed 埋点后 resolve(undefined)——快照失败不致命，CLI 仍能跑，只是少了用户环境。'''),

(582, 'after', r'''成功分支：stat 快照算大小，成功则 registerCleanup 在优雅退出时删快照文件并 resolve 路径；若文件建完却找不到就发 tengu_shell_unknown_error 并 resolve(undefined)。外层 catch 兜底意外错误。'''),

]
