# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (3, 'after', '''复用设计系统的 `ListItem` 渲染单个下拉选项，调用方只需传入焦点、选中、上下箭头等状态。'''),
    (41, 'before', '''`SelectOption` 把解构出的各状态直接交给 `ListItem`，统一呈现聚焦、选中、滚动箭头等视觉。'''),
    (67, 'after', '''组件利用 React 编译器的记忆缓存 `_c` 做依赖比对，仅当相关 prop 变化时才重建 JSX。'''),
]
