# 数据文件：src/components/shell/ShellProgressMessage.tsx
# slug = src_components_shell_ShellProgressMessage_tsx
ANNOTATIONS = [
    (19, 'before', '''长命令运行时的进度面板：把标准输出按行截断展示，并附上耗时、行数、字节数等状态信息'''),
    (32, 'after', '''整份完整输出先去 ANSI 转义再 trim：用于计算「还有多少行未显示」等非展示用途'''),
    (43, 'after', '''可见行计算：非详细模式下只取最后 5 行；`_temp` 是恒等过滤函数（占位，便于以后加规则）'''),
    (58, 'after', '''还没有任何输出时显示「Running…」并接入计时器，用 OffscreenFreeze 把未挂载子树挡在渲染外'''),
    (74, 'after', '''超出 5 行的部分记为 extraLines，用于提示「还有 N 行」'''),
    (83, 'after', '''非详细模式把高度限制为 5 行（`Math.min`），详细模式不设高度以完整展示'''),
    (94, 'after', '''输出区用固定高度 + overflow:hidden 截断，超出行数直接裁掉而不出现滚动条'''),
    (120, 'after', '''有总字节数时显示人类可读的大小（如 1.2 MB），否则该段为空'''),
    (138, 'after', '''整体结构：输出区 + 状态行（行数/字节）包进 MessageResponse 与 OffscreenFreeze，保证未挂载时不重渲染'''),
]
