# 数据文件：src/utils/claudeDesktop.ts
SOURCE_PATH = 'src/utils/claudeDesktop.ts'

ANNOTATIONS = [
    (13, 'before', '''本模块桥接 Claude Code 与 Claude Desktop 的 MCP 配置：仅在 macOS 与 WSL 上可用，负责定位并读取 claude_desktop_config.json。'''),
    (40, 'after', '''将 Windows 用户目录改写为 WSL 风格路径（去掉盘符、反斜杠转斜杠），拼出 /mnt/c 下的配置路径并校验存在性。'''),
    (68, 'after', '''枚举 /mnt/c/Users 时跳过系统目录（Public、Default 等），避免误读其他用户的配置。'''),
    (96, 'after', '''getClaudeDesktopConfigPath：按平台（macOS 库目录或 WSL 路径）定位配置，全部尝试失败则抛错提示先安装 Claude Desktop。'''),
    (105, 'after', '''readClaudeDesktopMcpServers：非支持平台直接抛错；否则读取配置并进入解析流程。'''),
    (120, 'after', '''用 safeParseJSON 解析配置；若内容为 null、非对象或缺少 mcpServers 字段，则按空配置返回。'''),
    (150, 'after', '''对每个 mcpServers 条目用 McpStdioServerConfigSchema 校验，仅收集通过校验的 stdio 服务；任何读取或解析异常都记日志并返回空对象，保证不抛错。'''),
    (152, 'after', '''模块收尾：导出两个函数，整体以「定位路径 + 安全解析 + 容错返回空」三段式处理 Claude Desktop 集成。'''),
]
