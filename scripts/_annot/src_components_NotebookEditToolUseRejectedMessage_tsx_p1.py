# -*- coding: utf-8 -*-
# annotations for src/components/NotebookEditToolUseRejectedMessage.tsx (92 lines)
ANNOTATIONS = [
    (16, 'before', 'notebook 编辑被拒绝的展示：三种编辑模式 replace/insert/delete'),
    (26, 'after', 'edit_mode 默认 replace：编译器把解构默认值展开成三元表达式'),
    (27, 'after', 'operation 文案：delete 模式只说 delete，其他模式说 replace/insert cell in——删除的语序不同'),
    (38, 'after', '路径显示：verbose 模式给完整路径，否则 relative 到 cwd 缩短'),
    (55, 'after', 'cell_id 可选：insert 新单元格时可能还没有 id，此时不显示 at cell 段'),
    (72, 'before', '代码预览段依赖 cell_type/edit_mode/new_source 三个比较项'),
    (73, 'after', 'delete 模式不渲染代码预览：edit_mode!==delete 与 HighlightedCode 短路——被拒绝的删除没有新代码可看；filePath 按单元格类型给 file.md 或 file.py 以命中对应语法高亮'),
    (83, 'after', 'MessageResponse 包裹：与用户消息对齐的消息响应区结构'),
]
