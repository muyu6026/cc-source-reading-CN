ANNOTATIONS = [
    (1, 'before', """本文件把 agent 或 skill 的 frontmatter 中声明的钩子注册为会话作用域钩子：钩子在整个会话/agent 期间有效，会话结束时清理。"""),
    (18, 'before', """`registerFrontmatterHooks` 按事件类型遍历 frontmatter 钩子设置，逐项调用 `addSessionHook` 注册；空设置直接返回。"""),
    (41, 'after', """当 `isAgent` 为真时，把 `Stop` 事件改写成 `SubagentStop`，因为子 agent 完成时触发的是 `SubagentStop` 而非 `Stop`。"""),
    (56, 'after', """对每个匹配项里的每个钩子调用 `addSessionHook` 注册，并用 `hookCount` 累计实际注册数量。"""),
    (62, 'before', """注册完成后若数量大于 0，记录一条调试日志说明本次从哪个来源注册了多少个钩子。"""),
]
