# -*- coding: utf-8 -*-
# annotations for src/components/LogoV2/GuestPassesUpsell.tsx (70 lines)
ANNOTATIONS = [
    (8, 'before', 'resetIfPassesRefreshed：剩余通行证变多（刷新或换活动）就把提示计数清零'),
    (10, 'after', '剩余为空或 0 直接返回：没有通行证不涉及提示'),
    (13, 'after', '只有严格变多才重置：数量减少不同步计数器，避免用户消耗后又被反复提示'),
    (14, 'after', '三个字段一起复位：次数、是否访问过通行证页、上次看到的剩余数'),
    (22, 'before', 'shouldShowGuestPassesUpsell：四道闸门'),
    (28, 'after', '必须既 eligible 又有缓存：注释写明不在展示路径上等网络请求'),
    (32, 'after', '看过 3 次就不再提示：软上限'),
    (33, 'after', '访问过通行证页面就不再提示：用户已知晓'),
    (37, 'after', '用 useState 的惰性初始值只求一次：这个判据带写盘副作用，不能每次渲染都跑'),
    (46, 'after', '计数器自增放在配置写入回调里：拿到的 prev 是最新值，避免并发覆盖'),
    (52, 'after', '打点带 seen_count：能看出提示第几次展示时的转化'),
    (61, 'before', '整行内容哨兵缓存：奖励金额在本次会话内不会变'),
    (63, 'after', '精简版只有一行：三个图标加中间点加文案，文案按有无奖励分叉（有奖励则显示金额与 /passes）'),
]
