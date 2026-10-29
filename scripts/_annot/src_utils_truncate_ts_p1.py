# 批注数据：src/utils/truncate.ts

ANNOTATIONS = [
    (1, 'after', '''本文件提供宽度感知的截断与换行工具，依赖 ink 的 stringWidth 与 grapheme 分段，
确保 CJK 与 emoji 不被按字节切坏。'''),
    (6, 'after', '''truncatePathMiddle 在路径中部截断：保留目录前缀与文件名，中间用省略号连接，
既保留目录上下文又不丢文件名。'''),
    (56, 'after', '''truncatePathMiddle 收尾：文件名过长时从开头截，目录空间不足时只显示文件名。'''),
    (58, 'after', '''truncateToWidth 按终端列宽截断字符串，在 grapheme 边界切分，
超出时尾部追加省略号。'''),
    (75, 'after', '''truncateToWidth 收尾：宽度不足一或零时退化为单个省略号。'''),
    (77, 'after', '''truncateStartToWidth 从字符串开头截断、保留尾部，前缀追加省略号。'''),
    (101, 'after', '''truncateStartToWidth 收尾：从尾向前累加宽度直到逼近上限，最后一段保留。'''),
    (103, 'after', '''truncateToWidthNoEllipsis 与上面同类但不再追加省略号，
留给调用方自己拼接分隔符（如中部截断的省略号）。'''),
    (123, 'after', '''truncateToWidthNoEllipsis 收尾：纯宽度累计，超出即停。'''),
    (125, 'after', '''truncate 是面向调用方的统一入口：可选 singleLine 在首个换行处截断，
其余情况交由 truncateToWidth 处理。'''),
    (158, 'after', '''truncate 收尾：先按单行规则处理，再走通用宽度截断。'''),
    (179, 'after', '''wrapText 按宽度把文本折成多行数组，在 grapheme 边界处断行，用于终端排版。'''),
]
