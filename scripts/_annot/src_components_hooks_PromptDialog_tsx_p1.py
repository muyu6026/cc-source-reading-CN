# -*- coding: utf-8 -*-
# annotations for src/components/hooks/PromptDialog.tsx (90 lines)
ANNOTATIONS = [
    (15, 'before', 'hook 权限询问对话框：复用 PermissionDialog 外壳加 Select 选项列表'),
    (25, 'after', 'isActive:true 哨兵缓存：app:interrupt 键绑定始终激活，可随时中止询问'),
    (36, 'after', '选项映射 _temp 提取为顶层函数：把 PromptRequest 的 key/label/description 转成 Select 需要的 value/label/description——注意 key 与 value 的字段名转换'),
    (45, 'after', 'toolInputSummary 可选：有则显示在标题右侧（dim 色），没有则 undefined'),
    (53, 'after', 'onRespond 包一层箭头：编译器为依赖变化重建回调的常规缓存模式'),
    (63, 'after', 'Select 外包 paddingY=1 的 column Box：与 PermissionDialog 内容区留白对齐'),
    (72, 'after', '组装：title + subtitle（request.message）+ titleRight（工具输入摘要）+ Select 主体'),
    (83, 'before', '_temp 即选项映射函数：label/value/description 三字段的搬运'),
]
