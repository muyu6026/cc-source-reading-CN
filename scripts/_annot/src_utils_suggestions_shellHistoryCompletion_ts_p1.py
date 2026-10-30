ANNOTATIONS = [
    (4, 'after', '''文件级说明：依据历史命令做 shell 行内补全，返回幽灵文本所需的后缀（suffix）。'''),
    (12, 'after', '''ShellHistoryMatch 类型：一条匹配包含完整命令与待显示后缀两段。'''),
    (18, 'after', '''缓存与 TTL：历史仅在用户提交命令时变化，故用 60 秒长 TTL 避免重复异步读取。'''),
    (57, 'after', '''getShellHistoryCommands 收尾：遍历历史、过滤以 ! 开头的 bash 命令、最多取 50 条去重。'''),
    (65, 'after', '''clearShellHistoryCache 收尾：暴露给上层在用户提交命令后清空缓存。'''),
    (83, 'after', '''prependToShellHistoryCache 收尾：新命令插到缓存头部并去重，未填充时为空操作。'''),
    (85, 'after', '''getShellHistoryCompletion 文档：块注释说明入参与返回。'''),
    (119, 'after', '''getShellHistoryCompletion 收尾：按精确前缀（含空格）匹配历史命令，返回完整命令与补全后缀。'''),
]
