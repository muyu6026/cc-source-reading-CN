# -*- coding: utf-8 -*-
# annotations for src/components/design-system/LoadingState.tsx (94 lines)
ANNOTATIONS = [
    (5, 'before', 'LoadingState 的 props：message 必填，bold/dimColor 可选，subtitle 可选副标题'),
    (29, 'before', 'doc 注释带三个 @example——设计系统组件文档规范：基础用法/加粗/带副标题'),
    (48, 'before', 'Spinner + 消息 + 可选副标题的异步加载组件'),
    (56, 'after', 'bold/dimColor 默认值展开：t1===undefined?false:t1，等价于解构默认参数 false'),
    (59, 'after', 'Spinner 无 props，哨兵缓存一次永久复用'),
    (67, 'after', '主行是 row 方向：Spinner 后接空格+消息，消息样式由 bold/dimColor 决定'),
    (77, 'after', 'subtitle && Text：无副标题时结果为假不渲染，副标题固定 dim 色'),
    (85, 'after', '外层 column：主行与副标题纵向排布'),
]
