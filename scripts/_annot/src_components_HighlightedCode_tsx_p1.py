# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (17, 'after', '''DEFAULT_WIDTH 默认 80 列，未显式给定宽度且无法测量时使用。'''),
    (61, 'after', '''尝试用 Rust 侧 ColorFile 高亮器渲染代码；禁用高亮或加载失败时为 null，走回退路径。'''),
    (135, 'after', '''主组件渲染高亮行：全屏模式下计算行号槽宽度并逐行拆成 CodeLine，
否则直接 Ansi 输出；无高亮结果时交给 HighlightedCodeFallback。'''),
    (189, 'after', '''CodeLine 把一行拆成『槽位列』（行号前缀）与『内容列』两片，分别用 NoSelect + Ansi 渲染。'''),
]
