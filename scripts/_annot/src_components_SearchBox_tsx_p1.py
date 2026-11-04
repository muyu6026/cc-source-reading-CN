# -*- coding: utf-8 -*-
# annotations for src/components/SearchBox.tsx (72 lines)
ANNOTATIONS = [
    (14, 'before', 'SearchBox：搜索框的纯展示层，焦点、光标位置、占位符都由外部传入'),
    (26, 'after', 'placeholder 默认 Search 加省略号（转义写法在源码里）'),
    (27, 'after', 'prefix 默认是放大镜符号（Unicode 码位 2315）'),
    (29, 'after', 'offset 取传入值，否则落在文本末尾'),
    (30, 'after', 'borderless 时不画边框：borderStyle 给 undefined'),
    (37, 'after', '光标渲染是四层嵌套三元：聚焦且有内容且终端聚焦时把 offset 处字符反色；终端失焦时不画反色光标，占位符则只反色首字符'),
    (49, 'after', '前缀与内容包在同一个 Text 里，非聚焦时整体 dim'),
    (59, 'after', '外框三件套：borderStyle 与 borderColor（聚焦时用 suggestion 色）与 borderDimColor（非聚焦时变暗）'),
]
