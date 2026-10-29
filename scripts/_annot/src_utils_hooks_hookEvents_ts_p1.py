# -*- coding: utf-8 -*-
slug = 'src_utils_hooks_hookEvents_ts'
ANNOTATIONS = [
    (1, 'after', '''文件总述：hook 执行事件的广播系统，与主流消息流相互独立。处理器自行注册来接收事件，并决定如何处理（转成 SDK 消息、记日志等）。'''),
    (18, 'after', '''ALWAYS_EMITTED_HOOK_EVENTS：始终广播的低噪声生命周期事件（SessionStart、Setup），属于原始的允许列表且向后兼容。'''),
    (20, 'after', '''MAX_PENDING_EVENTS：尚未注册处理器时最多缓存 100 个事件，超出丢弃最旧的。'''),
    (55, 'after', '''HookExecutionEvent 联合类型：包含 started、progress、response 三种事件。'''),
    (70, 'after', '''registerHookEventHandler：注册处理器，若有积压事件则补发全部。'''),
    (81, 'after', '''emit：有处理器立即推送，否则入队（超量丢最旧）。'''),
    (91, 'after', '''shouldEmit：事件在白名单内，或全局开启且属于 HOOK_EVENTS 时才广播。'''),
    (106, 'after', '''emitHookStarted：广播 started 事件。'''),
    (122, 'after', '''emitHookProgress：广播 progress 事件。'''),
    (151, 'after', '''startHookProgressInterval：定时轮询输出并广播进度；interval.unref 使其不阻止进程退出。'''),
    (177, 'after', '''emitHookResponse：先把完整 hook 输出写入调试日志（详细模式排障用），再按开关广播 response。'''),
    (186, 'after', '''setAllHookEventsEnabled：开启全部 hook 事件类型（SDK 设 includeHookEvents 或运行在 CCR 远程模式时调用）。'''),
    (192, 'after', '''clearHookEventState：重置处理器、积压队列与开关，用于测试或重载。'''),
]
