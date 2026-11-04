# -*- coding: utf-8 -*-
# annotations for src/components/ui/OrderedList.tsx (71 lines)
ANNOTATIONS = [
    (5, 'before', 'OrderedListContext 默认 marker 为空串：根列表的父标记是空'),
    (11, 'before', 'OrderedList 组件：给每个子项算编号标记，支持嵌套（父标记拼在子标记前）'),
    (20, 'after', '先数一遍真正的 OrderedListItem 子元素：文本或其它组件不计入编号'),
    (26, 'after', 'maxMarkerWidth 取总数的位数：编号用 padStart 对齐，十项时 1 要变 01 才能对齐'),
    (35, 'after', 'paddedMarker 是补零后的编号加点'),
    (36, 'after', 'marker 把父标记拼在前面：嵌套列表就成了层级编号'),
    (37, 'after', '同时提供两个 Context：列表层给下一级用，Item 层给自身用——一个值两处消费'),
    (49, 'after', '用 Children.map 而非普通 map：只遍历直接子元素，非列表项原样返回'),
    (68, 'before', 'eslint 注释豁免顶层副作用：给组件挂静态属性算副作用，但这是 React 生态的惯用写法'),
    (69, 'after', 'Item 挂到组件上，导出的是改名后的 OrderedListComponent：这样 OrderedList.Item 可用，组件本身仍叫 OrderedList'),
]
