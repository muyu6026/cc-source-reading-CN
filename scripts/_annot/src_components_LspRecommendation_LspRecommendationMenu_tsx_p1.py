# -*- coding: utf-8 -*-
# annotations for src/components/LspRecommendation/LspRecommendationMenu.tsx (88 lines)
ANNOTATIONS = [
    (11, 'before', 'LSP 插件推荐弹窗：检测到文件扩展名匹配的插件时询问是否安装'),
    (12, 'before', 'AUTO_DISMISS_MS 等于 30_000：数字分隔符写法，等于 30000 毫秒'),
    (19, 'after', 'onResponseRef 模式：ref 转发最新回调，避免 onResponse 变化重置定时器——注释明确写出动机'),
    (24, 'after', '30 秒超时自动选 no：忽略也算拒绝（不打扰）；setTimeout 第三参把 ref 传给回调（可变参数形式）'),
    (27, 'before', 'onSelect 的 switch 四路分派——其实可以直接透传，显式枚举是为了类型收窄'),
    (44, 'after', 'yes/never 选项的 label 是内嵌加粗插件名的 JSX，no/disable 用纯字符串——混合 label 类型 Select 均支持'),
    (64, 'after', '先解释 LSP 是什么（代码智能：跳转定义、错误检查）再问装不装——推荐弹窗的教育性文案'),
    (83, 'after', 'onCancel 同样视为 no：Esc 关闭与拒绝等价，永不强推'),
]
