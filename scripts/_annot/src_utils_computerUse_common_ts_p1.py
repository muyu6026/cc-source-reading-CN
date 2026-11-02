ANNOTATIONS = [
    (1, 'before', """本文件集中存放 macOS 计算机使用（computer-use）能力的公共常量与辅助函数，供执行器与工具构建复用。"""),
    (4, 'after', """`COMPUTER_USE_MCP_SERVER_NAME` 是计算机使用 MCP 服务器的固定名称 `computer-use`，用于归一化后比较。"""),
    (13, 'after', """`CLI_HOST_BUNDLE_ID` 是给「最前窗口门控」用的哨兵 bundle ID：Claude Code 是终端进程没有窗口，永远不会匹配真实应用，因此包里的「宿主最前」豁免分支对我们是死代码。"""),
    (21, 'after', """`TERMINAL_BUNDLE_ID_FALLBACK` 是 `env.terminal` 到 bundle ID 的回退映射表，覆盖能识别的 macOS 终端；Linux 项故意不列，因为创建执行器受 darwin 平台限制。"""),
    (43, 'after', """`getTerminalBundleId` 返回当前所处终端模拟器的 bundle ID，用于豁免隐藏与截图排除；优先用 `__CFBundleIdentifier`，缺失时查回退表，都失败返回 `null`（调用方须处理 `null`）。"""),
    (54, 'after', """`CLI_CU_CAPABILITIES` 是 macOS CLI 的静态能力声明：原生截图过滤与 darwin 平台（`hostBundleId` 由执行器按实例补充）。"""),
    (59, 'before', """`isComputerUseMCPServer` 判断某个 MCP 服务器名是否就是计算机使用服务器（归一化后比较名称）。"""),
]
