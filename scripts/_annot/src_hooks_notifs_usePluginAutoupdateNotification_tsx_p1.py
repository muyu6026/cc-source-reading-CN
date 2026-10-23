# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/usePluginAutoupdateNotification.tsx
# 插件自动更新通知：订阅 autoupdate 事件 → 展示需 /reload-plugins

ANNOTATIONS = [
    (10, 'after', '''// 插件被自动更新后提示用户运行 /reload-plugins 才会生效。
// 订阅与展示拆成两个 effect：先攒 updatedPlugins 状态，
// 再在有值时才弹通知。'''),

    (26, 'after', '''// 攒下来的已更新插件 id 列表（空 = 无事发生）。'''),

    (34, 'before', '''// 订阅 autoupdate 事件：事件到达只更新 state，
// 不直接弹通知（弹通知由第二个 effect 负责，见下）。'''),

    (59, 'after', '''// 文案折叠：≤2 个插件列名字（A and B），
// 更多则只报数量（N plugins），避免长列表刷屏。'''),

    (79, 'before', '''// 展示名去掉 @version 后缀（id 形如 name@1.2.3）。'''),
]
