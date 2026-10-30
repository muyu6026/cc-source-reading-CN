# 批注数据：src/utils/QueryGuard.ts
# slug: src_utils_QueryGuard_ts
ANNOTATIONS = [
    (1, 'after', '''查询生命周期同步状态机：与 React 的 useSyncExternalStore 兼容，用 idle / dispatching / running 三态防止队列处理与直提交期间重入，且全程同步无 React 批处理延迟。'''),
    (27, 'after', '''引入 createSignal 作为状态变更通知机制，供外部 store 订阅。'''),
    (32, 'after', '''类字段：_status 当前状态、_generation 代际号、_changed 状态变更信号。'''),
    (43, 'after', '''reserve：把状态从 idle 转为 dispatching 以预留执行权，非 idle 时返回 false。'''),
    (53, 'after', '''cancelReservation：当队列无任务可处理时把 dispatching 退回 idle。'''),
    (67, 'after', '''tryStart：启动查询，返回本次代际号；若已在 running 则返回 null 实现并发保护。'''),
    (80, 'after', '''end：校验代际号与状态，匹配才置回 idle 并返回 true（调用方据此决定清理），过期代际返回 false。'''),
    (93, 'after', '''forceEnd：无视代际号强制结束当前查询，并自增代际使过期 finally 块跳过清理，供取消场景使用。'''),
    (101, 'after', '''isActive 只读属性：dispatching 或 running 均视为活跃。'''),
    (105, 'after', '''generation 只读属性：暴露当前代际号。'''),
    (116, 'after', '''getSnapshot：供 useSyncExternalStore 使用的快照，返回 isActive。'''),
    (121, 'after', '''_notify 与类收尾：状态变更时触发信号通知所有订阅者。'''),
]
