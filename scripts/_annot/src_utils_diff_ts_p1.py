# 批注数据：src/utils/diff.ts

ANNOTATIONS = [
    (7, 'after', '''引入生成结构化 diff 的库、分析事件上报、行数统计与文件工具等依赖。'''),
    (10, 'after', '''CONTEXT_LINES 与 DIFF_TIMEOUT_MS 是两个全局常量：默认上下文行数与 diff 超时上限。'''),
    (27, 'after', '''adjustHunkLineNumbers 把 hunk 的行号整体偏移，用于把文件切片（如读编辑上下文）的行列号换算回全文件列号。'''),
    (31, 'after', '''AMPERSAND_TOKEN 是占位符：diff 库会把 & 搞混，先替换成中性 token 再还原。'''),
    (33, 'after', '''DOLLAR_TOKEN 同理，处理美元符号在 diff 中的歧义。'''),
    (37, 'after', '''escapeForDiff 与 unescapeFromDiff 是一对替换与还原函数，保证特殊字符不参与 diff 计算。'''),
    (79, 'after', '''countLinesChanged 统计新增与删除行数，更新总变更并上报事件，新文件按整段内容计为新增。'''),
    (114, 'after', '''getPatchFromContents 直接对两份字符串生成 hunk，先转义再还原行内容，超时或失败返回空。'''),
    (116, 'after', '''getPatchForDisplay 的文档说明：返回用于展示的 diff，且所有前导制表符会被渲染为空格。'''),
    (177, 'after', '''getPatchForDisplay 收尾：对文件内容套用编辑后生成可展示 diff，前导制表符转空格。'''),
]
