# -*- coding: utf-8 -*-
# annotations for src/components/design-system/StatusIcon.tsx (95 lines)
ANNOTATIONS = [
    (5, 'before', '六种状态类型：success/error/warning/info/pending/loading'),
    (24, 'before', 'STATUS_CONFIG 集中映射：每种状态一对（icon，color），pending/loading 无色（undefined）走暗色'),
    (42, 'after', 'info 借用 suggestion 色：语义色系统里没有 info，用建议蓝代替'),
    (49, 'after', 'loading 直接用字符 … 而非 figures 图标——figures 库没有省略号图标'),
    (54, 'before', 'doc 注释带三个 @example：官方对设计系统组件的文档规范是给足用法示例'),
    (78, 'after', 'withSpace 默认值处理：编译器把解构默认值展开成 t1===undefined?false:t1，等价于参数默认 false'),
    (81, 'after', 'withSpace && 空格：假值时结果是 false，JSX 里 false 不渲染，省掉条件渲染分支'),
    (84, 'after', 'dimColor={t2}：无色状态自动变暗，有颜色与变暗互斥'),
]
