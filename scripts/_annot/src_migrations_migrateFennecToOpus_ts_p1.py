# 批注数据：source/src/migrations/migrateFennecToOpus.ts
# slug: src_migrations_migrateFennecToOpus_ts

ANNOTATIONS = [
    (1, 'after', '引入用户设置读写工具。'),
    (6, 'after', '迁移说明：将已移除的 fennec 模型别名映射到新的 Opus 4.6 别名，并列出四条映射规则。'),
    (18, 'after', '导出迁移函数。'),
    (19, 'after', '仅蚂蚁用户执行（fennec 为内部代号）；否则直接返回。'),
    (23, 'after', '读取用户层模型设置。'),
    (26, 'after', '仅当 model 为字符串时才处理。'),
    (27, 'after', 'fennec-latest[1m] → opus[1m]。'),
    (32, 'after', 'fennec-latest → opus。'),
    (38, 'after', 'fennec-fast-latest 或 opus-4-5-fast → opus[1m] 并开启 fast 模式。'),
    (45, 'after', '函数收尾，结束 fennec 别名迁移。'),
]
