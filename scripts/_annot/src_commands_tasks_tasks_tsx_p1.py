# 批注数据：src/commands/tasks/tasks.tsx
ANNOTATIONS = [
    (1, 'after', '''`/tasks` 命令的本地 JSX 渲染入口；`call` 是命令系统约定的渲染钩子，返回要展示的 React 节点。'''),
    (3, 'after', '''真正的工作目录管理界面封装在 `BackgroundTasksDialog` 组件里，这里只负责把它装配出来。'''),
    (7, 'after', '''调用结束：把后台任务对话框渲染出来，并把 `onDone` 作为关闭回调传入，用户关闭对话框即结束命令。'''),
]
