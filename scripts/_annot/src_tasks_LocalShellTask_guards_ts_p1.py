# 数据文件：source/src/tasks/LocalShellTask/guards.ts
ANNOTATIONS = [
    (1, 'after', """纯类型与类型守卫文件：把 LocalShellTask 的状态类型独立出来，让非 React 的消费者（如 stopTask、print）不必把 React/ink 拉进模块图。"""),
    (9, 'after', """任务种类：bash 普通命令或 monitor 监听型。"""),
    (11, 'after', """状态结构：在通用 TaskStateBase 上加本地 bash 专属字段；type 固定为「local_bash」以兼容已持久化的会话状态。"""),
    (18, 'after', """标记完成状态是否已通过附件发出，避免重复。"""),
    (23, 'after', """记录上次汇报的总行数，用于计算增量（相对 TaskOutput）。"""),
    (28, 'after', """记录是哪个 agent 派生的任务，agent 退出时据此清理孤儿 bash 任务。"""),
    (34, 'after', """类型守卫：判断未知任务是否为本地 bash 任务，依据 type === 'local_bash'。"""),
]
