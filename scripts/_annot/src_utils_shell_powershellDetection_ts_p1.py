ANNOTATIONS = [
    (11, 'after', '''probePath 收尾：仅当路径是文件才返回，否则返回 null，供探针复用。'''),
    (13, 'after', '''findPowerShell 文档：块注释说明 PATH 探查偏好与 Linux snap 启动器规避。'''),
    (57, 'after', '''findPowerShell 收尾：优先 pwsh，snap 启动器在子进程里会卡顿故改探已知安装路径，其次 powershell。'''),
    (70, 'after', '''getCachedPowerShellPath 收尾：记忆化 promise，首次调用触发查找。'''),
    (72, 'after', '''PowerShellEdition 类型：core 或 desktop 两种版本。'''),
    (100, 'after', '''getPowerShellEdition 收尾：仅凭二进制名（pwsh 或 powershell）判断版本，无需派生子进程。'''),
    (107, 'after', '''resetPowerShellCache 收尾：仅供测试重置缓存。'''),
]
