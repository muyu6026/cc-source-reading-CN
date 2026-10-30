# 批注数据：src/utils/shell/powershellProvider.ts
# slug: src_utils_shell_powershellProvider_ts
ANNOTATIONS = [
    (6, 'after', '''PowerShell 外壳提供者：为 createPowerShellProvider 提供在 Windows 上以 pwsh 执行命令的能力，统一处理沙箱路径、退出码捕获与编码命令。'''),
    (13, 'after', '''buildPowerShellArgs：返回固定的 pwsh 调用参数（-NoProfile、-NonInteractive、-Command），供非沙箱路径拼接命令。'''),
    (25, 'after', '''encodePowerShellCommand：把命令以 UTF-16LE 编码为 base64，供 -EncodedCommand 使用；其字符集不受任何外壳引号层破坏。'''),
    (42, 'after', '''buildExecCommand 签名：构造命令字符串与 cwd 追踪文件路径，返回二者供外层 spawn。'''),
    (66, 'after', '''cwdTracking 与 psCommand：在命令尾部追加退出码捕获（优先 $LASTEXITCODE）并把当前目录写入追踪文件，再交给 pwsh 执行。'''),
    (97, 'after', '''getEnvironmentOverrides：把 /env 设置的会话环境变量注入子进程，并在沙箱内把 TMPDIR 指向沙箱临时目录，保证 PowerShell 可写。'''),
    (123, 'after', '''createPowerShellProvider 收尾：返回包含 buildExecCommand、getSpawnArgs、getEnvironmentOverrides 的外壳提供者对象。'''),
]
