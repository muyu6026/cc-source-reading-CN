# 数据文件：src/utils/completionCache.ts
SOURCE_PATH = 'src/utils/completionCache.ts'
ANNOTATIONS = [
    (12, 'after', """文件入口：生成并缓存 shell 补全脚本，写入各 shell 的 rc 文件。"""),
    (22, 'after', """ShellInfo：每类 shell 的 rc 文件、缓存文件、source 行与标识。"""),
    (61, 'after', """detectShell：按 process.env.SHELL 后缀识别 zsh / bash / fish。"""),
    (69, 'after', """formatPathLink：支持超链接时生成可点击的文件路径链接。"""),
    (98, 'after', """用 --output 直接写缓存文件，避免 stdout 管道在 process.exit 前被截断。"""),
    (118, 'after', """若 rc 已 source 过补全脚本则跳过写入。"""),
    (133, 'after', """否则追加补全 source 行到 rc 文件。"""),
    (134, 'after', """setupShellCompletion 收尾：整体流程为检测 shell 到确保目录到生成脚本到按需追加。"""),
    (144, 'after', """无匹配 shell 则直接返回。"""),
    (166, 'after', """regenerateCompletionCache：claude update 后重新生成缓存脚本。"""),
]
