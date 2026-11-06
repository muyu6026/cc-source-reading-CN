# 批注数据：source/src/constants/betas.ts
# slug: src_constants_betas_ts
# 本文件为 beta 头常量清单，按「能力名 + 日期」命名；多数根据编译期/运行期开关决定是否启用。

ANNOTATIONS = [
    (1, 'after', '引入 bun 的编译期 feature 开关宏 feature()；后续多个 beta 头常量据此决定取具体字符串还是空串。'),
    (3, 'after', '最早的 beta 头常量（2025-02-19 版），作为历史基线保留；命名规则为「能力名 + 日期」。'),
    (5, 'after', '交错思考（interleaved-thinking）beta 头，日期 2025-05-14；开启后模型可在同一轮内交替生成思考与工具调用。'),
    (6, 'after', '1M 上下文窗口 beta 头（2025-08-07）；允许单次请求携带百万级 token 上下文。'),
    (7, 'after', '上下文管理 beta 头（2025-06-27）；由客户端自主裁剪或压缩上下文。'),
    (8, 'after', '结构化输出 beta 头（2025-12-15）；要求模型以受约束的结构化格式返回。'),
    (9, 'after', '联网搜索 beta 头（2025-03-05）。'),
    (10, 'after', '工具搜索 beta 头因供应商而异：第一方与第三方使用不同的头名称，故拆分为两个常量（见下两行）。'),
    (13, 'after', '第一方（Claude API / Foundry）使用的工具搜索 beta 头。'),
    (14, 'after', '第三方（Vertex AI / Bedrock）使用的工具搜索 beta 头。'),
    (15, 'after', '推理努力程度（effort）beta 头（2025-11-24）。'),
    (16, 'after', '任务预算（task-budgets）beta 头（2026-03-13），用于限定单任务资源消耗。'),
    (18, 'after', '提示缓存作用域（prompt-caching-scope）beta 头（2026-01-05）。'),
    (19, 'after', '快速模式（fast-mode）beta 头（2026-02-01），降低首字延迟。'),
    (20, 'after', '思考内容脱敏（redact-thinking）beta 头（2026-02-12）。'),
    (22, 'after', '令牌高效工具（token-efficient-tools）beta 头（2026-03-28）。'),
    (23, 'after', '连接器文本摘要 beta 头：仅当 CONNECTOR_TEXT 开关开启时赋值为具体字符串，否则为空串。'),
    (26, 'after', '离开键盘（AFK）模式 beta 头：依赖 TRANSCRIPT_CLASSIFIER 开关，关闭时为空串。'),
    (30, 'after', '仅内部蚂蚁（ant）用户生效的 CLI 内部 beta 头：通过环境变量 USER_TYPE 判定。'),
    (31, 'after', '顾问工具（advisor-tool）beta 头（2026-03-01）。'),
    (33, 'after', '说明 Bedrock 只支持数量有限的 beta 头，且只能通过 extraBodyParams 下发，而不能放进请求头。'),
    (38, 'after', 'Bedrock 额外参数头集合：仅收录那些需要走 extraBodyParams（而非请求头）的 beta 字符串。'),
    (44, 'after', '说明 Vertex 的 countTokens API 仅允许特定 beta 头，其他头会触发 400 错误。'),
    (48, 'after', 'Vertex countTokens 允许的 beta 头集合；此处只放三个安全项。'),
]
