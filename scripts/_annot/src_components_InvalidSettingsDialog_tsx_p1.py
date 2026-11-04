# -*- coding: utf-8 -*-
# annotations for src/components/InvalidSettingsDialog.tsx (89 lines)
ANNOTATIONS = [
    (14, 'before', '设置文件校验失败弹窗：用户要么退出修复，要么跳过无效文件继续'),
    (18, 'before', 'Dialog 用 warning 色：设置错误是警告级别而非致命 error'),
    (26, 'before', 'handleSelect 的缓存依赖 onContinue/onExit 两个回调'),
    (27, 'after', 'handleSelect 按 value 分派：exit 走 onExit，其他（continue）走 onContinue——编译器把内部函数提升为命名函数便于缓存'),
    (43, 'after', '错误列表复用 ValidationErrorsList 组件：错误渲染逻辑集中一处'),
    (51, 'after', '关键提示文案：整个文件被跳过而不只是无效的设置项——让用户知道影响范围比想象大'),
    (58, 'after', '选项数组哨兵缓存：静态内容永久复用'),
    (79, 'after', 'onCancel 也指向 onExit：Esc 退出与选 exit 等价'),
]
