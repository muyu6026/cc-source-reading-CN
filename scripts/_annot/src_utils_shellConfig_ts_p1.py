# 数据文件：src/utils/shellConfig.ts
SOURCE_PATH = 'src/utils/shellConfig.ts'
ANNOTATIONS = [
    (10, 'after', """文件入口：shell 配置文件（.bashrc / .zshrc 等）读写工具，核心是 claude 别名的安装与查找。"""),
    (12, 'after', """CLAUDE_ALIAS_REGEX：识别以 alias claude= 开头的配置行。"""),
    (19, 'after', """ShellConfigOptions：允许测试注入 env 与 homedir 覆盖。"""),
    (31, 'after', """getShellConfigPaths：按平台返回各 shell 的 rc 路径，zsh 尊重 ZDOTDIR 环境变量。"""),
    (74, 'after', """filterClaudeAliases：仅剔除安装器写入的 claude 别名，保留用户自定义别名。"""),
    (91, 'after', """readFileLines：读取并按行拆分，文件系统不可访问时安全返回 null。"""),
    (107, 'after', """writeFileLines：打开文件、写入、datasync 强制落盘后关闭。"""),
    (134, 'after', """findClaudeAlias：遍历各 shell 配置，返回首个 claude 别名目标。"""),
    (135, 'after', """findClaudeAlias 收尾：无匹配则返回 null。"""),
    (167, 'after', """findValidClaudeAlias：在 findClaudeAlias 基础上校验目标是否真实存在且可执行。"""),
]
