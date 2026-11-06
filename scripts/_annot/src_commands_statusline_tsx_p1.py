ANNOTATIONS = [
    (1, 'after', """`/statusline` 命令：引导用户用子代理按 shell 的 PS1 配置生成状态栏界面。"""),
    (4, 'after', """命令元数据：类型 `prompt`、禁用非交互、预授权 `Read`/`Edit` 与代理工具。"""),
    (15, 'after', """动态生成提示词：用用户参数（默认从 PS1 生成状态栏）拼出子代理调用指令。"""),
    (22, 'after', """整段以 `satisfies Command` 收尾，保证结构与命令契约一致。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
