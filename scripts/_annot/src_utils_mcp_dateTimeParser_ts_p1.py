# 批注数据：src/utils/mcp/dateTimeParser.ts
# slug: src_utils_mcp_dateTimeParser_ts
ANNOTATIONS = [
    (9, 'after', '''自然语言日期时间解析：调用 Haiku 把用户输入的自然语言时间转换为 ISO 8601 格式，并提供快速判断字符串是否形似 ISO 的辅助函数。'''),
    (27, 'after', '''parseNaturalLanguageDateTime 签名：接收自然语言输入、目标格式（仅日期或日期时间）与取消信号，返回成功值或错误信息。'''),
    (35, 'after', '''根据当前时间与时区偏移拼出带符号的时区字符串（如 +08:00），供模型理解上下文。'''),
    (48, 'after', '''构建系统提示：约束模型只输出 ISO 8601 字符串，歧义时偏向未来，无法解析时输出「INVALID」。'''),
    (65, 'after', '''构建用户提示：把当前日期时间、时区、星期与用户输入一并交给模型，要求只返回格式化结果或 INVALID。'''),
    (80, 'after', '''调用 queryHaiku 发起解析请求，并附带查询来源等选项。'''),
    (99, 'after', '''基本合理性校验：解析结果必须以 4 位年份开头，否则视为失败。'''),
    (111, 'after', '''parseNaturalLanguageDateTime 收尾：成功返回解析值，异常时记录日志并返回友好错误。'''),
    (117, 'after', '''looksLikeISO8601 签名：判断字符串是否可能为 ISO 8601 日期或日期时间。'''),
    (121, 'after', '''looksLikeISO8601 收尾：用正则匹配 YYYY-MM-DD 开头（可选 T 后接时间）来判定。'''),
]
