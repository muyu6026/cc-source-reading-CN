# 数据文件：src/utils/horizontalScroll.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/horizontalScroll.ts'

ANNOTATIONS = [
    (6, 'after', '水平滚动窗口的类型：给出可见起止索引与是否显示左右箭头。'),
    (27, 'after', 'calculateHorizontalScrollWindow：按可用宽度计算可见项窗口，保证选中项始终可见，采用「贴边滚动」而非居中。'),
    (37, 'after', '无项或所有项都能放下时，直接返回全量窗口且不显示箭头。'),
    (51, 'after', '先计算每项累计宽度，便于后续快速求任意区间的可见宽度。'),
    (68, 'after', 'rangeWidth：求区间 [start,end) 的可见宽度；首项之后的区间要扣掉被合并掉的起始分隔符宽度。'),
    (76, 'after', 'getEffectiveWidth：根据是否显示左右箭头，动态扣除箭头占用的宽度。'),
    (100, 'after', '若选中项已在当前可见范围内，直接返回，无需滚动。'),
    (137, 'after', '选中项在右侧则贴右边缘、在左侧则贴左边缘展开，最后返回带箭头标志的窗口边界。'),
]
