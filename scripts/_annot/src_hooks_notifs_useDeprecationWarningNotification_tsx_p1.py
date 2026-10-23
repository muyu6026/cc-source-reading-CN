# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useDeprecationWarningNotification.tsx
# 模型弃用警告：同文案去重 + 切回非弃用模型时清除跟踪

ANNOTATIONS = [
    (6, 'after', '''// 模型弃用警告通知。与 useRateLimitWarningNotification 的
// 警告分支同一模式：ref 记上一条文案，变化才弹。'''),

    (11, 'after', '''// lastWarningRef：null 表示当前没有警告在展示。'''),

    (20, 'before', '''// 有警告且与上次不同才弹（model prop 抖动不重复刷屏）。'''),

    (29, 'before', '''// 模型切回非弃用版本时清空跟踪——
// 下次再弃用可重新提示。'''),
]
