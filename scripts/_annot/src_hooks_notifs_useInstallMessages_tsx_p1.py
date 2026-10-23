# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useInstallMessages.tsx
# 安装检查消息：checkInstall 结果按类型映射优先级

ANNOTATIONS = [
    (3, 'after', '''// 启动时跑一次安装自检（checkInstall），把结果映射成通知。'''),

    (10, 'before', '''// 优先级映射：error 或需要用户操作 → high；
// path/alias 类提示 → medium；其余 → low。'''),

    (12, 'after', '''// error / userActionRequired 抬到 high。'''),

    (15, 'after', '''// PATH 未配 / alias 缺失属中等优先。'''),
]
