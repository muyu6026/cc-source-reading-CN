# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useRateLimitWarningNotification.tsx
# 限额双通知：超额使用一次性提示 + 限流警告去重提示

ANNOTATIONS = [
    (11, 'after', '''// 两个独立通知：超额使用（isUsingOverage）一次性提示；
// 限流警告（rateLimitWarning）按文案去重提示。都走
// claudeAiLimits hook 拉取的限额数据。'''),

    (36, 'before', '''// 已示警告 ref：同一条限流文案不重复弹
// （与 useDeprecationWarningNotification 同一模式）。'''),

    (44, 'after', '''// 订阅类型只读一次（memo 缓存，不随渲染更新）——
// 判断是否需要展示超额提示用，一次会话内不会变。'''),

    (53, 'after', '''// team/enterprise 账号默认不弹超额提示，
// 除非有独立的计费访问权（hasBillingAccess）。'''),

    (62, 'before', '''// 三条件才提示：正在超额 + 本次会话没提示过 +
// （非 team/enterprise 或有计费权）。state 标记保证只弹一次。'''),

    (68, 'before', '''// 一次性标记置位；回到非超额状态时复位，
// 下次超额可再次提示。'''),

    (94, 'before', '''// 警告文案变化才提示（ref 记录上一条文案）——
// 渲染抖动导致同文案重复计算不会刷屏。'''),
]
