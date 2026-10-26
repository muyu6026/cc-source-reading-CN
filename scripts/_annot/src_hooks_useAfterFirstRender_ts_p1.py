# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (4, 'after', '''// 首次渲染后（仅 ant 环境 + 指定 env）打印启动耗时并直接退出进程，用于自动化基准测量。'''),
    (14, 'after', '''// 打印 uptime 毫秒后 process.exit(0) 干净退出；该分支被 custom-rules 允许越过 no-process-exit。'''),
    (16, 'after', '''// effect 依赖空数组，只在挂载后执行一次；非 ant 或未按指定 env 时整段静默跳过。'''),
]
