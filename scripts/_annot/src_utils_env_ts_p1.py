ANNOTATIONS = [
    (10, 'after', '''运行环境探测：综合环境变量与文件系统判断终端类型、部署平台、包管理器与运行时，并暴露给上层使用。'''),
    (26, 'after', '''getGlobalClaudeFile：解析全局配置文件路径，兼顾旧版 .config.json 与按 OAuth 后缀/配置目录的新版路径。'''),
    (83, 'after', '''isWslEnvironment：通过 /proc/sys/fs/binfmt_misc/WSLInterop 文件是否存在可靠判断 WSL。'''),
    (105, 'after', '''isNpmFromWindowsPath：WSL 下判断 npm 是否来自 Windows 文件系统（路径以 /mnt/c/ 开头）。'''),
    (234, 'after', '''detectTerminal：按优先级从大量环境变量（IDE bundle id、TERM_PROGRAM、TERM、MSYSTEM 等）推断终端类型，最后回退到 TERM 与非交互判定。'''),
    (305, 'after', '''detectDeploymentEnvironment：推断部署平台，覆盖云端 IDE、云平台、CI、容器编排与无服务器环境，最后按操作系统给出未知变体。'''),
    (333, 'after', '''env 对象：汇总所有环境探测能力（网络/CI/平台/架构/终端/包管理器/运行时/WSL 等）供全应用统一读取。'''),
    (347, 'after', '''getHostPlatformForAnalytics：分析上报用的宿主平台，允许用 CLAUDE_CODE_HOST_PLATFORM 覆盖容器/远程场景下检测到的平台。'''),
]
