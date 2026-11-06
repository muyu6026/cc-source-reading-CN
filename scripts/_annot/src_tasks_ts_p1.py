# 数据文件：source/src/tasks.ts
ANNOTATIONS = [
    (1, 'after', """任务总注册表：汇总各类任务实现（本地 shell/agent、远端 agent、dream），并按构建期 feature 开关条件加载 workflow/monitor 任务，避免非相关构建拉入代码。"""),
    (9, 'after', """构建期启用 WORKFLOW_SCRIPTS 才加载本地工作流任务。"""),
    (12, 'after', """启用 MONITOR_TOOL 才加载监控型 MCP 任务。"""),
    (22, 'after', """返回所有已启用的任务实例数组；内联返回以避免顶层 const 造成的循环依赖。"""),
    (23, 'after', """基础四个任务固定纳入。"""),
    (29, 'after', """启用了才 push 工作流任务。"""),
    (37, 'after', """按类型查任务：复用 getAllTasks 再 find。"""),
]
