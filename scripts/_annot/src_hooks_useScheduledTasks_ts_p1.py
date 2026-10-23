# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (40, 'after', '''// cron 调度器的 REPL 封装：挂载一次，卸载时拆除。'''),
    (48, 'after', '''// isLoadingRef 持有最新值，避免调度器内部的 isLoading() getter
// 捕获到过期的闭包（effect 只挂一次，但 isLoading 每回合都变）。'''),
    (61, 'after', '''// 运行时开关在 effect 内检查（而非调用点），保证 hook 无条件挂载——
// rules-of-hooks 禁止把 hook 调用包在动态条件里；5 分钟 TTL 的背景刷新不重跑 effect，
// 所以此守卫仅是发布粒度，会话中段的 kill-switch 靠下面的 isKilled 轮询。'''),
    (82, 'after', '''// enqueueForLead：系统生成的定时提示，isMeta 隐藏于队列预览与转录 UI，
// workload 标 WORKLOAD_CRON 让 API 在容量紧张时以更低 QoS 服务（无人实时等待）。'''),
    (101, 'after', '''// 队友已消失：清理孤儿 cron（一次性任务本来 fire 即删，
// 但循环 cron 会一直触发直到自动过期，必须主动移除）。'''),
    (115, 'after', '''// onFireTask 按 agentId 路由：队友 cron 注入用户消息到对应队友任务；
// 队友还在跑才注入，否则清理孤儿 cron 防止空转。'''),
    (119, 'after', '''// isKilled 每 tick 轮询开关，提供会话中段实时关闭能力。'''),
]
