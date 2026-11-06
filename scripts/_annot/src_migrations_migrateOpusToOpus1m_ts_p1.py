# 数据文件：source/src/migrations/migrateOpusToOpus1m.ts
ANNOTATIONS = [
    (1, 'after', """将设置中固定为「opus」的用户，在符合合并条件时迁移到「opus[1m]」；CLI 的 --model opus 是运行时覆盖、不改设置，故不受影响。"""),
    (24, 'after', """入口函数：先判合并开关，再读用户设置，仅当恰好是「opus」才写回「opus[1m]」或清空（与默认主循环模型一致时写 undefined 以回落默认）。"""),
    (25, 'after', """合并未启用则直接返回，不在非 1M 体验下改动任何设置。"""),
    (29, 'after', """读取用户设置里的 model 字段，非「opus」直接跳过，保证幂等（只动恰好等于「opus」的情况）。"""),
    (34, 'after', """目标字符串是「opus[1m]」；若解析后与默认主循环模型相同，则 modelToSet 为 undefined，让设置回落默认、避免冗余覆盖。"""),
    (40, 'after', """写入新的 model 设置；若等于默认则 modelToSet 为 undefined，等价于清空该字段。"""),
    (42, 'after', """打点记录迁移发生，供后续统计覆盖率。"""),
]
