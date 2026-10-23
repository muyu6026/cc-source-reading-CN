ANNOTATIONS = [
    (34, 'after', r'''AGENT_COLOR_TO_THEME_COLOR：satisfies Record<AgentColorName, keyof Theme> 是编译期约束——八色必须齐全且都真是主题色键，漏一个编译不过。主题色名带 _FOR_SUBAGENTS_ONLY 后缀：subagent 专用色板，不与主 agent 的配色语义混用。'''),
    (50, 'after', r'''getAgentColor：general-purpose 恒返回 undefined——默认 agent 不搞特殊色，UI 上用默认样式。颜色表是 bootstrap state 里的运行时注册表（frontmatter 声明 color 的 agent 在加载时 setAgentColor 注册）；表里的值还要过一遍白名单，脏数据直接当没有。'''),
    (66, 'after', r'''setAgentColor：传 undefined = 删除注册（frontmatter 里去掉 color 字段时清理旧值）；白名单外的值静默忽略——不抛错，坏颜色不该让 agent 加载失败。'''),
]
