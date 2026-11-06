# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''迁移脚本：把 Pro / Max / Team Premium 用户的显式 Sonnet 4.5 模型串迁移到 sonnet 别名（现解析为 4.6）；只读 userSettings、幂等'''),
    (15, 'after', '''引入订阅判断、设置读写、模型供应商与 analytics 上报'''),
    (29, 'after', '''迁移主函数：非订阅 / 非 first-party / 模型不匹配都直接跳过（幂等）'''),
    (30, 'after', '''非官方 API（first-party）用户不迁移'''),
    (34, 'after', '''仅 Pro / Max / Team Premium 订阅用户迁移'''),
    (38, 'after', '''只读 userSettings 里的模型串'''),
    (46, 'after', '''模型不在 4.5 串集合则跳过（保证幂等）'''),
    (48, 'after', '''判断是否带 1m 上下文后缀，决定迁到 sonnet 还是 sonnet[1m]'''),
    (49, 'after', '''写回 userSettings 的模型别名'''),
    (54, 'after', '''取全局配置'''),
    (55, 'after', '''启动次数大于 1 才记录迁移时间戳（避免新用户被通知）'''),
    (62, 'after', '''上报迁移事件（含原模型与是否 1m）'''),
    (67, 'after', '''迁移函数结束'''),
]
