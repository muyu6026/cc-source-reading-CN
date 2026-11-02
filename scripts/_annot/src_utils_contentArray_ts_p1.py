ANNOTATIONS = [
    (1, 'after', '''文件级工具：在 content 数组里、相对 tool_result 块的位置插入补充块（例如 API 层用来把缓存编辑指令放到用户消息里的正确位置）。'''),
    (21, 'before', '''把补充块插到最后一个 tool_result 块之后，原地改写数组（不返回新数组）。'''),
    (41, 'after', '''核心插入：用 splice 在 lastToolResultIndex + 1 处插入 block；若插入后它成了数组末尾，再补一个 text 续接块（部分 API 不允许 prompt 以非文本结尾）。'''),
    (51, 'after', '''无 tool_result 时的兜底：插到倒数第二的位置（Math.max(0, length-1)），保证不会插到最末尾。'''),
]
