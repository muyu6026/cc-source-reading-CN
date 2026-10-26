# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (13, 'before', '''// 订阅统一命令队列的 hook：返回冻结数组，仅队列变更时才改引用，组件只在队列变化时重渲染。'''),
    (14, 'after', '''// 用 useSyncExternalStore 接 subscribeToCommandQueue / getCommandQueueSnapshot，二者配合保证引用稳定。'''),
]
