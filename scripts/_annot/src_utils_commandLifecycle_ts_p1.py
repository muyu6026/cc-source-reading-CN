# -*- coding: utf-8 -*-
# slug: src_utils_commandLifecycle_ts  | source: src/utils/commandLifecycle.ts
ANNOTATIONS = [
    (1, 'before', '''本文件实现「命令生命周期」的极简观察者：命令开始与结束时回调一次，供上层统计或埋点使用。'''),
    (8, 'after', '''listener 是模块级的单一回调句柄，初始为 null，表示暂时无人关心命令生命周期事件。'''),
    (14, 'after', '''setCommandLifecycleListener 注册或清除（传 null）全局唯一的命令生命周期监听器。'''),
    (21, 'after', '''notifyCommandLifecycle 在命令启动或结束时被调用，若存在监听器就把 uuid 与状态转发过去；状态只有 started 与 completed 两种。'''),
]
