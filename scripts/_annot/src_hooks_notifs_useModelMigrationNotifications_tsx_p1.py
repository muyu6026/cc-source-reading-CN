# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useModelMigrationNotifications.tsx
# 模型迁移通知：config 时间戳 3s 内写入即本次启动迁移

ANNOTATIONS = [
    (5, 'after_block', '''// 模型迁移（如 Sonnet 4.5→4.6、Opus Pro→4.6）在写 config
// 时间戳的同一次启动里弹一次性通知。判据：时间戳在最近 3s 内
// 被写入 = 本次启动刚迁移。新迁移加一条 MIGRATIONS 即可。'''),

    (9, 'before', '''// 迁移表：每项读自己的时间戳字段，命中返回通知。
// 类型签名显式声明返回 Notification | undefined。'''),

    (12, 'after', '''// Sonnet 4.5→4.6（pro/max/team 高级账号）。'''),

    (24, 'before', '''// 两条迁移路径共用一条通知文案：legacy remap
// （老 pinned 4.0/4.1 → 当前默认）与 Opus Pro → 默认，
// 但 remap 文案更长（含 opt-out 环境变量）且停留 8s。'''),

    (36, 'after', '''// 把整个迁移表塞进 useStartupNotification 一次跑完。'''),

    (49, 'before', '''// 3s 窗口：比启动到通知渲染的间隔略宽，
// 又不至于把昨天迁移的用户也算上。'''),
]
