# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useTeammateShutdownNotification.ts
# 队友生命周期批量通知：fold 合并同类事件（N agents spawned）

ANNOTATIONS = [
    (10, 'before', '''// 从通知文案头部解析数量（「3 agents spawned」→ 3），
// 用于 fold 累加；解析失败按 1 计。'''),

    (18, 'before', '''// fold 回调：新事件到来时把累计数 +1 重新生成通知，
// 由通知系统的 fold 机制调用（同 key 通知自动合并而非堆叠）。'''),

    (22, 'before', '''// 生成/刷新 spawn 通知：单复数切换 + 5s 自动消失 + fold 自引用。'''),

    (49, 'after', '''// 队友任务开始/完成时批量提示。用 fold() 把连续事件合并成
// 一条（「3 agents spawned」），避免每个队友弹一次刷屏。'''),

    (54, 'after', '''// 两个 seen Set 记录已报过 id：running 与 completed 各一个，
// 保证同一任务只触发一次 spawn 和一次 shutdown 通知。'''),

    (67, 'before', '''// 新出现的 running 任务 → spawn 通知（addNotification
// 撞上同 key 现有通知时走 fold 累加）。'''),

    (72, 'before', '''// 新出现的 completed 任务 → shutdown 通知，同样走 fold。'''),
]
