# 批注数据：source/src/tasks/types.ts
# slug: src_tasks_types_ts

ANNOTATIONS = [
    (1, 'after', '注释：所有具体任务状态的联合类型，供需要兼容任意任务类型的组件使用。'),
    (4, 'after', '引入七种具体任务状态类型（Dream / InProcessTeammate / LocalAgent / LocalShell 等）。'),
    (19, 'after', 'TaskState 联合类型：涵盖全部七种任务状态。'),
    (21, 'after', '注释：可在后台任务指示器出现的任务类型集合。'),
    (29, 'after', 'BackgroundTaskState 联合类型：当前内容与 TaskState 一致。'),
    (31, 'after', '注释：判定任务是否应显示在后台指示器——需处于运行/挂起且已后台化。'),
    (37, 'after', '类型守卫 isBackgroundTask：通过状态与 isBackgrounded 标志收窄类型。'),
    (38, 'after', '非运行且非挂起的任务不算后台任务。'),
    (41, 'after', '注释：前台任务（isBackgrounded===false）尚未成为后台任务。'),
    (45, 'after', '其余情况均视为后台任务并返回 true。'),
]
