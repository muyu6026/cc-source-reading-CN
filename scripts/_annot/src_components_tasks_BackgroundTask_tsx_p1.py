# 批注数据：src/components/tasks/BackgroundTask.tsx
# slug: src_components_tasks_BackgroundTask_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (12, 'after', '''末尾导入 describeTeammateActivity：把队友任务的实时活动描述成文字。'''),
    (16, 'after', '''Props 类型：一个不可变的后台任务状态，以及活动文字的最大宽度。'''),
    (17, 'after', '''BackgroundTask 组件：按任务类型渲染一行后台任务摘要（图标 + 文字 + 状态）。'''),
    (23, 'after', '''activityLimit 是活动文字的截断宽度，默认 40。'''),
    (24, 'after', '''按 task.type 分派到不同的渲染分支，覆盖本地/远程/队友/工作流等多种任务。'''),
    (55, 'after', '''local_bash 分支：监控型显示描述，否则显示命令，再叠加 Shell 进度。'''),
    (68, 'after', '''remote_agent 且处于审阅态时，直接渲染远程会话进度。'''),
    (114, 'after', '''remote_agent 普通分支：用菱形图标区分运行（空心）与停止（实心），显示标题与远程进度。'''),
    (148, 'after', '''local_agent 分支：显示描述 + 任务状态文字，完成时标注「unread」未读。'''),
    (218, 'after', '''in_process_teammate 分支：展示队友名（带主题色）与其当前活动描述。'''),
    (261, 'after', '''local_workflow 分支：显示工作流名/摘要/描述，以及运行中的 agent 数与状态。'''),
    (295, 'after', '''monitor_mcp 分支：显示描述 + 任务状态文字，完成时标注未读。'''),
    (342, 'after', '''dream 分支：显示文件数或会话数、所处阶段与任务状态。'''),
]
