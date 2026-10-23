# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useSettingsErrors.tsx
# settings 校验错误通知：全量错误扫描 + 变更订阅 + /doctor 引导

ANNOTATIONS = [
    (8, 'after', '''// 通知 key 固定，add/remove 成对操作同一 key。'''),

    (9, 'after', '''// 设置错误通知。初始渲染即同步扫一遍全部错误
// （getSettingsWithAllErrors），之后监听设置变更重扫；
// 有错弹警告（60s 不自动消失），没错撤通知。
// 同时把错误列表 return 出去给 /doctor 页复用。'''),

    (15, 'after', '''// useState 初始化即读全部错误（同步），首帧就有数据。'''),

    (29, 'after', '''// 设置文件变更 → 重新全量扫描（含 user/project/local 各层错误）。'''),

    (38, 'after', '''// 文案单复数切换（1 issue / N issues），
// 统一引导 /doctor 查看详情。'''),

    (44, 'before', '''// 60s 超时：比其他通知长得多——设置错误需要用户
// 停下来去修，不轻易自动消失。'''),

    (63, 'before', '''// 同步读取全部错误的初始化函数。'''),
]
