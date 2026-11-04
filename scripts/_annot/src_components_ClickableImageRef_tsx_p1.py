# -*- coding: utf-8 -*-
# annotations for src/components/ClickableImageRef.tsx (73 lines)
ANNOTATIONS = [
    (23, 'before', '图片引用（Image 井号 N）：终端支持超链接时渲染成可点击链接，否则退回带样式的文本'),
    (31, 'after', '按 id 取已存图片路径：取不到就说明图片不在 store 里'),
    (33, 'after', '两个条件同时满足才做链接：有文件且终端支持 OSC 8 超链接'),
    (34, 'after', 'pathToFileURL：本地路径转成 file URL，交给终端打开'),
    (38, 'after', 'fallback 用的无下划线版与链接内版本分别缓存：选中态时链接内版本额外加粗'),
    (51, 'after', 'Link 的 fallback 指向纯文本版：不支持超链接的终端不会看到空内容'),
    (63, 'after', '降级路径只给普通 Text：保留背景色与选中反色，但不可点击'),
]
