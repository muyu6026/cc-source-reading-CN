# -*- coding: utf-8 -*-
"""src/constants/tools.ts 批注数据（第 165 批）。"""

ANNOTATIONS = [
    (1, 'before', '''顶部禁用 organizeImports：ANT-ONLY 的导入标记不能被重排，否则会打乱工具名顺序'''),
    (36, 'before', '''异步代理默认禁止的工具集：排除 Agent / 计划 / 任务输出等，避免递归与主线抽象泄漏'''),
    (41, 'before', '''仅当运行身份是 ant 时才对子代理放开 Agent 工具，支持嵌套代理'''),
    (48, 'before', '''自定义代理的禁用集：目前直接复用全代理禁用集'''),
    (55, 'before', '''异步代理明确允许的工具：只读 / 搜索 / 编辑类，外加 worktree 进出'''),
    (72, 'before', '''只给进程内队友的工具：任务管理与消息发送，cron 类按特性开关'''),
    (85, 'before', '''队友创建的 cron 打上 agentId 标记并路由到它自己的待处理队列'''),
    (90, 'before', '''被禁用的工具清单及理由：Agent / TaskOutput 防递归、ExitPlanMode 是主线抽象'''),
    (104, 'before', '''协调者模式只放：代理、停任务、发消息、合成输出四类'''),
]
