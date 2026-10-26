# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (19, 'before', '''// 综合「用户开关 + 鉴权 + GB kill-switch」三者决定语音是否可用。'''),
    (23, 'after', '''// 只把贵的鉴权半（冷启动 sync security spawn ~60ms）memo 在 authVersion 上；GB 是廉价缓存查，留在 memo 外以便中途翻转即时生效。'''),
    (24, 'after', '''// 三者取与：用户想开 + 已鉴权 + GB 未关。authVersion 仅 /login 时 bump，后台刷新不动它，memo 才保持正确。'''),
]
