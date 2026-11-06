ANNOTATIONS = [
    (1, 'after', """`/web-setup` 命令：引导用户在网页端配置 Claude Code，需先连接 GitHub 账户。"""),
    (5, 'after', """命令定义：仅在特性开关 `tengu_cobalt_lantern` 命中且策略允许远程会话时启用。"""),
    (13, 'after', """`isEnabled` 同时校验特性开关与 `allow_remote_sessions` 策略；`isHidden` 仅看策略。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
