# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'after', '''// 订阅设置变更：磁盘上的 settings 一变就回调 onChange（带 source + 新设置）。'''),
    (13, 'after', '''// 注意：缓存已由通知方（changeDetector.fanOut）重置，这里不要再清，否则 N 个订阅者会互相踩（N 路抖动）。'''),
    (20, 'after', '''// 用 settingsChangeDetector.subscribe 订阅；handleChange 入 memo 保依赖稳定。'''),
]
