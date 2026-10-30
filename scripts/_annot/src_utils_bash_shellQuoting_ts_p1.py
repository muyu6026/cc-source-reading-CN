# 批注数据：src/utils/bash/shellQuoting.ts
# slug: src_utils_bash_shellQuoting_ts
ANNOTATIONS = [
    (1, 'after', '''模块摘要：对 shell 命令做「安全引用」——在保留 heredoc 与多行字符串的前提下正确加引号，并检测/改写 stdin 重定向与 Windows 的 >nul 误写。'''),
    (3, 'after', '''检测命令是否含 heredoc（<<EOF 等），同时排除位运算左移（如 1 << 2）造成的误判。'''),
    (24, 'after', '''检测引号字符串里是否真的跨了多行（处理转义引号），用于决定是否能安全地整体加引号。'''),
    (40, 'after', '''对外主函数：按命令类型选择合适的引用方式，保留 heredoc 与多行字符串；参数 addStdinRedirect 决定是否追加 < /dev/null。'''),
    (49, 'after', '''若含 heredoc 或多行字符串，走特殊路径（shell-quote 库会错误地把感叹号转义）。'''),
    (52, 'after', '''若含 heredoc 或多行字符串，用单引号包裹，仅把命令里的单引号转义为 '\'' 形式。'''),
    (68, 'after', '''普通命令直接用 shell-quote 库加引号（库能正确处理多数转义）。'''),
    (76, 'after', '''检测命令是否已有 stdin 重定向（< file 等），但排除 <<（heredoc）、<（位移）、<(进程替换）。'''),
    (88, 'after', '''判断能否安全加 stdin 重定向：heredoc 不加（会干扰结束符），命令已有重定向也不加，其余一般安全。'''),
    (108, 'after', '''把 Windows CMD 风格的 >nul 重定向改写成 POSIX 的 /dev/null——模型偶尔会幻觉出 >nul，在 Git Bash 下会变成名为 nul 的难删文件（见 issue #4928）；正则不匹配 >null、>nul.txt 等。'''),
    (126, 'after', '''真正执行替换的函数：把匹配到的 >nul 段替换为 /dev/null。'''),
]
