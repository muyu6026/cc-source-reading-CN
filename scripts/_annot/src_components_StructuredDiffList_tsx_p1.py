# 多 hunk 的 diff 列表：hunk 之间插省略号
ANNOTATIONS = [
    (15, 'before', '多个 hunk 之间插省略号而不是首尾相连：告诉读者中间还有未改动的区域被跳过了'),
    (23, 'after', '每个 hunk 包一列 Box 并以新文件起始行号作 key（同一份 diff 里天然唯一）；hunk 之间用 NoSelect 包一层省略号，复制 diff 时不会把分隔符一起带走'),
]
