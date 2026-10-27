# -*- coding: utf-8 -*-
# src/utils/swarm/backends/PaneBackendExecutor.ts（355 行）批注数据
ANNOTATIONS = [
    (39, 'after', '''`PaneBackendExecutor` 把 `PaneBackend` 适配为 `TeammateExecutor` 接口，使分屏后端与进程内后端走同一抽象。'''),

    (49, 'after', '''用 `agentId` 到分屏信息的映射追踪已生成的队友。'''),

    (56, 'after', '''构造函数保存后端引用并初始化追踪表。'''),

    (62, 'after', '''`setContext` 注入工具调用上下文，spawn 前必须调用。'''),

    (71, 'after', '''`isAvailable` 委托底层后端判断是否可用。'''),

    (79, 'after', '''`spawn` 创建分屏并发送带队友身份标识的 Claude CLI 命令。'''),

    (96, 'after', '''为队友分配唯一颜色（或取配置里的颜色）。'''),

    (106, 'after', '''判断是否处于 tmux 内，以决定命令发送与分屏管理的方式。'''),

    (114, 'after', '''取得队友命令的二进制路径。'''),

    (127, 'after', '''组装队友身份相关的命令行参数（agent-id、name、team、color、parent-session）。'''),

    (148, 'after', '''拼接要向下传递的 CLI 标志，继承父会话的计划模式与权限模式。'''),

    (154, 'after', '''拼出最终派生命令：切换工作目录、注入环境变量、启动队友进程。'''),

    (158, 'after', '''向新分屏发送启动命令；外部 swarm 用 socket，tmux 内直接发送。'''),

    (161, 'after', '''记录已生成的队友，便于后续 kill / terminate 定位分屏。'''),

    (175, 'after', '''注册退出清理：领导进程退出时杀掉所有已生成分屏。'''),

    (178, 'after', '''通过基于文件的邮箱向队友发送初始指令。'''),

    (209, 'after', '''`spawn` 结束，返回成功或失败结果。'''),

    (216, 'after', '''`sendMessage` 通过文件邮箱给指定队友发送消息。'''),

    (221, 'after', '''先解析并校验 `agentId` 格式（期望 `agentName@teamName`）。'''),

    (244, 'after', '''发消息结束。'''),

    (252, 'after', '''`terminate` 通过邮箱发送关闭请求，让队友进程自行优雅退出。'''),

    (290, 'after', '''优雅终止函数结束。'''),

    (295, 'after', '''`kill` 直接杀掉队友所在分屏。'''),

    (310, 'after', '''调用后端 `killPane` 杀分屏；外部 session 用 socket。'''),

    (320, 'after', '''`kill` 结束，成功后从追踪表移除该队友。'''),

    (329, 'after', '''`isActive` 检查队友是否仍被记录为活跃（尽力而为）。'''),

    (344, 'after', '''活跃检查结束，仅依据是否仍有记录判断。'''),

    (345, 'after', '''类定义结束。'''),

    (354, 'after', '''`createPaneBackendExecutor` 工厂函数，包装给定后端返回执行器。'''),
]
