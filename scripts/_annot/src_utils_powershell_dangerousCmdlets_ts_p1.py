# 数据文件：src/utils/powershell/dangerousCmdlets.ts

ANNOTATIONS = [
    (1, 'after', '''文件级：集中定义「会执行任意代码的 PowerShell cmdlet」清单，供权限校验器与 UI 建议门控共用，避免重复与漂移。'''),
    (22, 'after', '''FILEPATH_EXECUTION_CMDLETS：接受 -FilePath（或位置路径）并把该文件内容当作脚本执行的 cmdlet。'''),
    (39, 'after', '''DANGEROUS_SCRIPT_BLOCK_CMDLETS：带 scriptblock 参数会执行任意代码的 cmdlet（区别于仅过滤 / 转换管道的 Where-Object）。'''),
    (53, 'after', '''MODULE_LOADING_CMDLETS：加载并执行模块 / 脚本代码的 cmdlet，psm1 导入时即运行顶层主体，风险等同于 iex。'''),
    (70, 'after', '''SHELLS_AND_SPAWNERS：各类 shell 与进程启动器，数量少且稳定，只补上面校验清单未覆盖的 cmdlet。'''),
    (76, 'after', '''aliasesOf：从 COMMON_ALIASES 中筛出指向目标 cmdlet 的别名，供 NEVER_SUGGEST 一并纳入。'''),
    (85, 'after', '''NETWORK_CMDLETS：网络类 cmdlet，对它们的通配规则会免提示地放行外传 / 下载，没有合理的窄前缀。'''),
    (101, 'after', '''ALIAS_HIJACK_CMDLETS：别名 / 变量篡改类 cmdlet，Set-Alias 可重绑定命令解析、Set-Variable 可污染 $PSDefaultParameterValues。'''),
    (114, 'after', '''WMI_CIM_CMDLETS：WMI / CIM 进程启动类，等价于 Start-Process 且绕过对应校验，任何调用都可能衍生任意进程。'''),
    (149, 'after', '''ARG_GATED_CMDLETS：白名单里带回调校验的参数，仅在回调拒绝（出现 scriptblock / 变量 / 子表达式）时才弹权限框；接受 Cmdlet:* 通配会绕过回调。'''),
    (185, 'after', '''NEVER_SUGGEST：把上述所有校验清单与静态 shell 列表合并去重，并补上别名，作为权限对话框中「绝不建议为通配前缀」的 cmdlet 集合。'''),
]
