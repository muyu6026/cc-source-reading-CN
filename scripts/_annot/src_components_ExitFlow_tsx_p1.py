# 批注数据：source/src/components/ExitFlow.tsx
ANNOTATIONS = [
    (6, 'after', '''退出时随机展示的告别语池。'''),
    (7, 'before', '''从告别语池随机取一条，空池时退回默认 Goodbye。'''),
    (10, 'before', '''组件入参：完成回调、可选取消回调，以及是否处于 worktree 模式。'''),
    (15, 'before', '''退出流程组件：构造退出回调（先道别再优雅关闭），worktree 模式下改用专用对话框。'''),
    (26, 'after', '''退出时先道别，再请求优雅关闭（退出码 0，来源标记为提示输入退出）。'''),
    (34, 'before', '''处于 worktree 时改用 WorktreeExitDialog 承接确认/取消。'''),
    (46, 'after', '''非 worktree 模式直接返回 null，不渲染任何内容。'''),
]
