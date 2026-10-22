# -*- coding: utf-8 -*-
# PowerShellTool/commandSemantics.ts 批注数据
ANNOTATIONS = [
    (18, 'after', '''核心洞察：PowerShell 原生 cmdlet 用终止性错误（$?）报错、退出码恒为 0；但外部 exe 会设 $LASTEXITCODE，且很多用非零码传递信息而非失败——grep 退出 1 是无匹配，robocopy 退出 1 是复制成功。没有这个模块，robocopy 报告成功也会被当成 ShellError 抛出。'''),
    (36, 'after', '''默认语义只有 0 算成功——白名单之外的命令一律从严。'''),
    (44, 'after', '''grep/rg/findstr 共用一套语义：退出码 1 是「无匹配」不是错误，2 及以上才是错——与 BashTool 对 grep 的处理对齐。'''),
    (61, 'after', '''刻意省略 diff/fc/find 三个名字：Windows PowerShell 5.1 的别名会把它们解析到 cmdlet（如 diff 指向 Compare-Object、fc 指向 Format-Custom），而 PS Core 或 Git 环境可能解析到同名 exe——退出码语义完全不同，无法可靠判定就不判定，退化到默认语义。'''),
    (94, 'after', '''robocopy 的退出码是位掩码：0-7 都是成功（1=复制了文件、2=发现多余文件、4=有不匹配），8 及以上才至少有一个失败。注释直言这是「CI 失败但其实没事」的头号 Windows 坑。'''),
    (111, 'after', '''四步归一化：剥调用操作符（& 与 .）、剥引号、剥路径取 basename、剥 .exe 后缀并小写——& "C:\\bin\\grep.exe" 最终归一成 grep。'''),
    (120, 'after', '''取最后一个管道段——退出码由最后一段决定。注释明说这是启发式：引号里的分号可能切错段，但它只用于退出码解释，切错只会退化到默认语义（更严），绝不能拿去做安全判断。'''),
    (142, 'after', '''查表命中用专用语义，未命中用默认——查不到不会出错、只会更严。'''),
]
