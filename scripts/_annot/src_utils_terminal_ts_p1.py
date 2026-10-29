# 数据文件：src/utils/terminal.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/terminal.ts'

ANNOTATIONS = [
    (4, 'after', '导入 chalk 着色、展开提示、字符串宽度计算与 ANSI 安全切片工具。'),
    (10, 'after', '终端文本渲染常量：最多显示 3 行，并预留 10 字符内边距避免与消息前缀、父级缩进冲突。'),
    (61, 'after', 'wrapText：按可见宽度把文本换行（ANSI 感知，不切断转义序列），返回折叠区内容与剩余行数。'),
    (113, 'after', 'renderTruncatedContent：对超长输出做按行截断，超出部分用暗色「…+N 行（ctrl+o 展开）」提示，并限制只处理可见区附近的字符以免 O(n) 卡顿。'),
    (131, 'after', 'isOutputLineTruncated：快速判断内容是否会被截断——只数原始换行数，忽略宽度换行，对多行输出这类常见情形足够准。'),
]
