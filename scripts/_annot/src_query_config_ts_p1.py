# 批注数据：source/src/query/config.ts
# slug: src_query_config_ts_p1

ANNOTATIONS = [
    (1, 'after', '引入会话 ID、带缓存可能过期的 Statsig 特性门、SessionId 类型与环境变量布尔判定。'),
    (6, 'after', '注释分段标记：配置段。'),
    (8, 'after', '注释：本段为在 query() 入口一次性快照的不可变值。'),
    (13, 'after', '注释：刻意排除 feature() 门——它们是摇树边界，必须内联在受保护代码块以维持死代码消除。'),
    (15, 'after', 'QueryConfig 类型：含会话 ID 与一组运行时门。'),
    (18, 'after', '注释：运行时门（env/statsig）而非 feature() 门。'),
    (29, 'after', '构造 QueryConfig：快照会话 ID 与各运行时门。'),
    (32, 'after', '注释：streamingToolExecution 门使用带缓存可能过期的 Statsig 判定，单次快照仍在契约内。'),
    (36, 'after', 'emitToolUseSummaries 门：由环境变量控制。'),
    (39, 'after', 'isAnt 门：由 USER_TYPE 是否为 ant 判定。'),
    (40, 'after', '注释：fastModeEnabled 从 fastMode.ts 内联而来，避免拖入其重型模块图影响测试分片初始化顺序。'),
    (43, 'after', '快速模式默认开启，仅当禁用环境变量为真时关闭。'),
]
