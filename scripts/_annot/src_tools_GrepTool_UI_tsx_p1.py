"""批注数据：src/tools/GrepTool/UI.tsx（200 行）"""

ANNOTATIONS = [
    (118, 'after', "SearchResultSummary 是三个输出模式共用的汇总组件。这份代码是 React Compiler 编译产物：$[i] 数组是手写 memo cache 槽位（依赖变了才重算），Symbol.for 的 sentinel 标记「槽位还没初始化」。verbose 时展开内容，非 verbose 只给一行摘要加 Ctrl+O 展开提示。"),
    (146, 'after', "renderToolUseMessage 拼「pattern: ..., path: ...」——非 verbose 时 path 过 getDisplayPath 显示相对形式。Glob 的同名函数几乎是这段的复制（两个 UI 的演化痕迹）。"),
    (164, 'after', "错误降级同 Glob UI：非 verbose 且错误带 FILE_NOT_FOUND_CWD_NOTE 标记时只显示「File not found」，其余降为「Error searching files」，详细信息走 Fallback 组件的可展开渲染。"),
    (187, 'after', "三种模式各配一行 SearchResultSummary：content 显示行数、count 显示次数+文件数（两级计数）、files_with_matches 显示文件数。185 行那个 .map(filename => filename) 是编译残留的原样映射，无实际作用。Glob 直接把本组件借走当自己的结果渲染。"),
]
