ANNOTATIONS = [
    (1, 'before', """本文件把某个 skill 的 frontmatter 钩子注册为会话作用域钩子；若钩子带 `once: true`，则在首次成功执行后自动移除。"""),
    (20, 'before', """`registerSkillHooks` 遍历所有事件与匹配项，为每个钩子调用 `addSessionHook`，并通过 `registeredCount` 累计注册数量。"""),
    (36, 'after', """对带 `once: true` 的钩子，构造 `onHookSuccess` 回调：首次成功后记录调试日志并调用 `removeSessionHook` 自动移除。"""),
    (45, 'before', """调用 `addSessionHook` 注册单个钩子，传入事件名、匹配器、钩子本体、可选的成功回调与 skill 根目录（用于 `CLAUDE_PLUGIN_ROOT`）。"""),
    (60, 'after', """注册完成后若数量大于 0，记录调试日志说明本次从该 skill 注册了多少个钩子。"""),
]
