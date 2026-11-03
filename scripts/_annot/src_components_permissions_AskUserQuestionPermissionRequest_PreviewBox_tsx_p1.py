# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'before', '''PreviewBoxProps：预览框的可选配置（内容、最大行、最小宽高、最大宽）。'''),
    (23, 'before', '''BOX_CHARS：边框用的制表符（角、横、竖、T 形交汇）。'''),
    (34, 'after', '''文档注释：带边框的等宽预览框，超出 maxLines 时截断并提示。'''),
    (39, 'before', '''PreviewBox：语法高亮关闭时直接渲染纯文本体，否则挂 Suspense 做高亮。'''),
    (63, 'before', '''PreviewBoxWithHighlight：在 Suspense 内解析 CLI 高亮器再交给 Body。'''),
    (84, 'before', '''PreviewBoxBody：核心渲染——拆行、截断、计算边框与每行内容宽度。'''),
    (119, 'before', '''把渲染结果按行拆分，按需截断到 maxLines。'''),
    (146, 'before', '''截断时生成一条「N 行被隐藏」的分隔条。'''),
    (164, 'before', '''逐行渲染：按内容宽度左右补空格，套上边框竖线。'''),
    (195, 'before', '''把顶/底边框与内容行、截断条组装成最终纵向布局。'''),
    (226, 'before', '''_temp：返回单行的显示宽度（用于计算边框宽度）。'''),
]
