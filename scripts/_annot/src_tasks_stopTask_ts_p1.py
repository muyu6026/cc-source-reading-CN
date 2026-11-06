# -*- coding: utf-8 -*-
# 第 166 批：src/tasks/stopTask.ts 批注数据
ANNOTATIONS = [
    (1, 'before', '''停止运行中任务的共享逻辑，供 TaskStopTool 与 SDK stop_task 复用。'''),
    (7, 'after', '''导入应用状态、任务类型、事件队列与本地 shell 判定等依赖。'''),
    (10, 'before', '''停止任务专用错误，携带 not_found / not_running / unsupported_type 码。'''),
    (20, 'before', '''停止任务的上下文：读取与写入应用状态。'''),
    (25, 'before', '''停止结果：任务 ID、类型与展示命令。'''),
    (38, 'before', '''核心异步停止函数：查表、校验、杀进程、标记已通知。'''),
    (42, 'after', '''取出当前应用状态与目标任务。'''),
    (46, 'after', '''未找到任务则抛出 not_found。'''),
    (50, 'after', '''非 running 状态则抛出 not_running。'''),
    (58, 'after', '''未能拿到任务实现则抛出 unsupported_type。'''),
    (65, 'after', '''调用具体实现的 kill 终止任务。'''),
    (70, 'after', '''本地 shell 任务抑制 exit 137 噪声，agent 任务保留通知。'''),
    (89, 'after', '''抑制时直接补发 task_notified SDK 事件，保证消费者看到关闭。'''),
    (97, 'after', '''展示命令取 command（shell）或 description（agent）。'''),
    (99, 'after', '''返回任务 ID、类型与命令。'''),
]
