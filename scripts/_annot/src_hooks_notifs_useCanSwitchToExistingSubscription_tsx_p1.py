# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useCanSwitchToExistingSubscription.tsx
# 已有订阅未登录提示：API key 反查 oauth profile，最多提示 3 次

ANNOTATIONS = [
    (8, 'before', '''// 全局最多提示 3 次（config.subscriptionNoticeCount 计数）——
// 反复骚扰用户去 /login 适得其反。'''),

    (10, 'after', '''// 检测「账号有 Claude 订阅但当前用 API key 登录」的错配，
// 提示切回订阅登录。整个 hook 只是 useStartupNotification
// 的一行包装，逻辑全在 _temp2 里。'''),

    (21, 'before', '''// 启动通知计算函数：异步反查 profile。'''),

    (22, 'before', '''// 计数达上限直接放弃（连网络都不查）。'''),

    (29, 'before', '''// 每条提示落盘前先把全局计数 +1（先行落盘，
// 即使通知展示失败也不再重试）。'''),

    (45, 'before', '''// 已在用订阅登录 → 无可切换，短路。'''),

    (52, 'before', '''// Max 优先于 Pro（账号可能两者都有）。'''),
]
