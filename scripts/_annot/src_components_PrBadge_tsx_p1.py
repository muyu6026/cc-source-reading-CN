# -*- coding: utf-8 -*-
# annotations for src/components/PrBadge.tsx (97 lines)
ANNOTATIONS = [
    (11, 'before', 'PR 徽章组件：渲染可点击的「PR #123」链接，reviewState 决定颜色语义'),
    (20, 'before', 'getPrStatusColor 把审查状态映射成语义色，无状态返回 undefined'),
    (28, 'after', 'dimColor 条件：无状态色且非加粗时用暗色——普通未审 PR 不抢眼，有状态才着色'),
    (31, 'after', 'label 是无下划线版本，专门用作 Link 的 fallback——不支持超链接的终端里显示纯文本'),
    (41, 'before', '第二个 #number 段带 underline：Link 内容用下划线提示可点击，PR 前缀始终暗色'),
    (64, 'after', 'fallback={label}：ink 的 Link 在终端不支持 OSC 8 超链接时回退显示 label'),
    (74, 'after', '组装：PR 前缀 + 空格 + Link（内含下划线版 #number）'),
    (83, 'before', '状态→颜色映射：approved=success（绿）/changes_requested=error（红）/pending=warning（黄）/merged=merged（紫），无状态走暗色'),
    (93, 'after', 'default 分支返回 undefined 而非某个具体颜色：让无状态的 PR 保持中性外观'),
]
