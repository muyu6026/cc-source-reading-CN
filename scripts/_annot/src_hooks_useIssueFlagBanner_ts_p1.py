# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (45, 'after', '''// 容器兼容检查：遍历 assistant 消息的工具调用，判断本会话
// 能否塞进 issue 反馈容器（不含 mcp__ 工具、不含危险外部命令）。'''),
    (61, 'after', '''// 任何 mcp__ 前缀工具一律判为不兼容——外部 MCP 工具行为不可控。'''),
    (68, 'after', '''// bash 命令若匹配外部命令黑名单（curl/ssh/docker/aws/git push 等）
// 即判不兼容，避免把高危操作会话送进 issue 容器。'''),
    (74, 'after', '''// 摩擦信号：从末尾向前找最近的 user 消息，用正则判断用户是否在纠正 Claude。'''),
    (89, 'after', '''// 阈值常量：至少提交 3 次才允许弹 banner，且两次触发间隔不少于 30 分钟。'''),
    (92, 'after', '''// banner 主 hook：返回是否应显示「反馈问题」提示条。'''),
    (96, 'after', '''// 仅 ant 内部环境显示该 banner（编译期常量门控，非 ant 直接 false）。'''),
    (110, 'after', '''// useMemo 缓存 O(messages) 扫描——本 hook 每次 REPL 渲染（含每次按键）都跑，
// 但打字时 messages 稳定，缓存避免对每条 bash 命令重复正则扫描。'''),
    (130, 'after', '''// 触发后记录时间戳并锁定到「当前提交数」，使 banner 在下一次提交前持续显示。'''),
]
