# 批注数据：source/src/migrations/migrateSonnet1mToSonnet45.ts
# slug: src_migrations_migrateSonnet1mToSonnet45_ts

ANNOTATIONS = [
    (1, 'after', '引入主循环模型覆盖的读写、全局配置、以及用户设置读写。'),
    (11, 'after', '迁移说明：将旧 sonnet[1m] 别名固定为显式 sonnet-4-5-20250929[1m]，因 sonnet 现指向 Sonnet 4.6。'),
    (27, 'after', '导出的一次性迁移函数。'),
    (28, 'after', '读取全局配置并检查完成标志。'),
    (29, 'after', '已完成则直接返回。'),
    (33, 'after', '仅读用户层设置（非合并设置），避免把项目级 sonnet[1m] 提升为全局默认。'),
    (34, 'after', '命中旧别名则改写为显式 Sonnet 4.5 1M 版本。'),
    (40, 'after', '注释：同步迁移内存中的模型覆盖（若已设置）。'),
    (41, 'after', '若主循环覆盖值也是旧别名，则一并改写。'),
    (46, 'after', '写入全局配置，置 sonnet1m45MigrationComplete 完成标志。'),
]
