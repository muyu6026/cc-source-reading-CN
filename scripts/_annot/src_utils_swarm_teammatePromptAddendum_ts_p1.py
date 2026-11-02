# source: src/utils/swarm/teammatePromptAddendum.ts
ANNOTATIONS = [
    (1, 'before', '''这份文件提供「队友专属系统提示补遗」，会被追加到主智能体完整系统提示的尾部，用来向队友说明在团队中的可见性限制与通信要求。'''),
    (18, 'after', '''模板字符串本身是一段写给队友的通信规范：必须用 SendMessage 工具发消息，`to` 字段填具体队友名，或用 `*` 做全队广播；纯文本回复队友看不到，工作由任务系统与会话内消息协调。'''),
]
