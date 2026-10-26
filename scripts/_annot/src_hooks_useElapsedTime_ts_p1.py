# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (17, 'before', '''// 格式化「自 startTime 起的经过时长」，用 useSyncExternalStore + 定时 notify 实现高效刷新。'''),
    (26, 'after', '''// get 算差值：endTime 优先（终态任务冻结时长，避免看完超时任务显示膨胀），否则用当前时间，并减掉暂停时长。'''),
    (36, 'after', '''// subscribe 仅在 isRunning 时挂 setInterval 周期 notify；get 同时作 server/getSnapshot 同源，避免 hydration 不匹配。'''),
]
