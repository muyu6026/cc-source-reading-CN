ANNOTATIONS = [
    (1, 'after', '''NotebookEditPermissionRequest 是 Jupyter 笔记本编辑权限确认弹窗：展示要改的笔记本、单元格增删改差异，并把选择交给通用 FilePermissionDialog。'''),
    (11, 'after', '''NotebookEditInput 是从 NotebookEditTool.inputSchema 推断出的输入类型，供下面的解析兜底使用。'''),
    (96, 'after', '''上面这段把所有 props 依赖缓存下来，解析出 notebook 路径、语言、编辑文案，并准备好后续要用的组件引用（FilePermissionDialog、Text 等）。'''),
    (99, 'after', '''t11 把文件名加粗显示。'''),
    (119, 'after', '''t13 按 verbose 决定差异预览宽度（120 或 80）。'''),
    (133, 'after', '''t14 是差异预览组件 NotebookEditToolDiff，展示单元格增删改。'''),
    (151, 'after', '''t15 把整个权限对话框拼出来：标题、问句、差异内容、路径、完成类型 tool_use_single，以及解析函数都交给通用的 FilePermissionDialog。'''),
    (152, 'after', '''组件返回拼装好的权限对话框。'''),
    (165, 'after', '''_temp 是输入解析兜底：用 safeParse 失败就记一条错误日志并返回一个空壳输入，避免整段 UI 崩掉；成功则返回解析结果。'''),
]
