ANNOTATIONS = [
    (6, 'before',
     "「既有文件必须先 Read」这条在 Write 的 prompt 里带了条件前缀 `If this is an existing file`——这是它和 Edit 的关键区别：Edit 无条件要求先读，Write 允许直接创建新文件。条件不写清楚，模型会以为「新建文件也要先 Read 一个不存在的文件」，凭空多一轮失败调用。"),
    (11, 'before',
     "描述里最重要的一句是 `Prefer the Edit tool for modifying existing files — it only sends the diff`。这是**成本导向的工具选择引导**：用 Write 改一行也要把整个文件发一遍，而 Edit 只发变化部分。同样重要的还有最后两条硬约束：不要主动创建 `*.md`/README、不要加 emoji——两条都是「用户没要求就别做」的默认保守策略。"),
]
