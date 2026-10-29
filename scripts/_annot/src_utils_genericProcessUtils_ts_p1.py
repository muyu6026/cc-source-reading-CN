# 数据文件：src/utils/genericProcessUtils.ts

ANNOTATIONS = [
    (9, 'after', '''文件级：平台无关地查询进程树信息（是否运行、祖先 PID / 命令、子进程），Windows 走 PowerShell、Unix 走 sh，统一用 execFileNoThrow。'''),
    (28, 'after', '''isProcessRunning：用 signal 0 探测 PID 是否存活；PID 小于等于 1 直接返回 false，越权（EPERM）也保守视为未运行，避免抢活锁。'''),
    (68, 'after', '''Windows 分支用 PowerShell 的 Get-CimInstance 沿 Win32_Process 父链向上，结果以逗号分隔返回。'''),
    (86, 'after', '''getAncestorPidsAsync：沿进程树向上收集祖先 PID；Windows 用 PowerShell 脚本、Unix 用 ps 单次调用，均设 3 秒超时与深度上限。'''),
    (107, 'after', '''getProcessCommand：取单进程命令行，已废弃，建议改用 getAncestorCommandsAsync。'''),
    (143, 'after', '''Windows 分支沿 Win32_Process 父链收集 CommandLine，用空字节连接。'''),
    (156, 'after', '''getAncestorCommandsAsync：一次性收集进程及其祖先的命令行，用空字节分隔以兼容含换行的命令；Windows 用 PowerShell、Unix 用 sh。'''),
    (184, 'after', '''getChildPids：取直接子进程 PID 列表；Windows 用 PowerShell 查 ParentProcessId、Unix 用 pgrep -P。'''),
]
