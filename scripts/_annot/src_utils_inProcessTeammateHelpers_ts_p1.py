# 批注数据：src/utils/inProcessTeammateHelpers.ts
ANNOTATIONS = [
    (12, 'after', '''导入 AppState 类型，作为任务列表与状态更新的数据根。'''),
    (33, 'after', '''遍历当前所有任务，按 agentName 找出对应的进程内队友任务 ID；找不到返回 undefined。'''),
    (55, 'after', '''设置某队友任务是否正在等待计划审批，内部复用 updateTaskState 更新 awaitingPlanApproval 字段。'''),
    (77, 'after', '''处理计划审批响应：把 awaitingPlanApproval 复位为 false；权限模式由 agent 主循环另行处理。'''),
    (85, 'after', '''以下进入权限委派辅助函数分区。'''),
    (97, 'after', '''判断一条消息是否为权限相关响应，覆盖工具权限与沙箱（网络主机）权限两类。'''),
]
