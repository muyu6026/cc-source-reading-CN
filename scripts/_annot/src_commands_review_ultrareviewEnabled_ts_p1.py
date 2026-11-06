ANNOTATIONS = [
    (1, 'after', """引入带缓存、可能过期的 GrowthBook 特性读取函数，用于运行期开关判定。"""),
    (8, 'before', """导出开关函数，决定 `/ultrareview` 命令对当前用户是否可见。"""),
    (12, 'after', """读取名为 `tengu_review_bughunter_config` 的 GrowthBook 配置，缺省值为 null。"""),
    (13, 'after', """仅当配置对象存在且 `enabled` 为真才放行，未配置用户不会看到该命令。"""),
]
