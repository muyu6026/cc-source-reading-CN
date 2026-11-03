# 批注数据：src/components/GlobalSearchDialog.tsx
# slug: src_components_GlobalSearchDialog_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (17, 'after', '''末尾导入 FuzzyPicker 与 LoadingState：模糊搜索框与加载占位组件。'''),
    (26, 'after', '''Match 类型：一次搜索命中的文件路径、行号与文本。'''),
    (29, 'after', '''三个常量控制搜索规模：可见结果数、防抖时长、预览上下文行数。'''),
    (30, 'after', '''rg -m 是「每个文件」上限，这里再用 MAX_MATCHES_PER_FILE 收口数组，防止内存膨胀。'''),
    (38, 'after', '''GlobalSearchDialog 组件：全局搜索弹窗（ctrl+shift+f / cmd+shift+f），对工作区做防抖 ripgrep 搜索。'''),
    (49, 'after', '''宽屏（≥140 列）把预览放到右侧，否则放底部。'''),
    (64, 'after', '''卸载时清理防抖定时器与中止控制器，避免组件销毁后还触发搜索。'''),
    (123, 'after', '''聚焦某条命中时异步读取该文件上下文行，渲染预览（可中止）。'''),
    (153, 'after', '''handleQueryChange：输入变化时防抖触发搜索，并即时按关键词过滤已有结果。'''),
    (154, 'after', '''listWidth/maxPathWidth/maxTextWidth：根据终端宽度算列表与路径、文字的各自最大宽度。'''),
    (174, 'after', '''handleOpen：回车打开命中文件并上报遥测后关闭弹窗。'''),
    (192, 'after', '''handleInsert：把命中以 @文件#行 或 文件:行 形式插入到对话，并上报遥测。'''),
    (263, 'after', '''组装 FuzzyPicker：传入结果、预览渲染、键盘动作（mention / insert path / open）等。'''),
    (312, 'after', '''_temp4 是真正的搜索执行体：流式读取 ripgrep 输出、解析、去重、限流并截断到上限。'''),
    (342, 'after', '''parseRipgrepLine 把 ripgrep 的「路径:行号:文本」解析成 Match，注意 Windows 盘符冒号要跳过。'''),
]
