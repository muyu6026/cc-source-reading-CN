# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'before', '''// 节流显示：保证每个值至少停留 minMs 才被替换，防止快速轮转的进度文本一闪而过读不清。'''),
    (16, 'after', '''// 已停留够久：立即更新 lastShownAt 并切换显示值。'''),
    (31, 'after', '''// 不够久：setTimeout 补足剩余时间，并把 ref/setter/value 作为参数传进去（避免闭包捕获过期值）。'''),
]
