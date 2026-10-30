ANNOTATIONS = [
    (8, 'after', '''颜色分配状态：按会话记忆队友颜色，轮转索引。'''),
    (16, 'after', '''getBackend 收尾：后端内部已缓存，无需二次缓存。'''),
    (33, 'after', '''assignTeammateColor 收尾：从调色板轮转分配唯一颜色，已分配则复用。'''),
    (42, 'after', '''getTeammateColor 收尾：返回既有分配或 undefined。'''),
    (51, 'after', '''clearTeammateColors 收尾：团队清理时重置以便新团队复用。'''),
    (60, 'after', '''isInsideTmux 收尾：动态导入检测模块判断是否在 tmux 内。'''),
    (82, 'after', '''createTeammatePaneInSwarmView 收尾：自动选后端（tmux 或 iTerm2）在蜂群视图开新窗格。'''),
    (94, 'after', '''enablePaneBorderStatus 收尾：委托后端开启窗格边框状态显示。'''),
    (107, 'after', '''sendCommandToPane 收尾：委托后端向指定窗格发送命令。'''),
]
