# 批注数据：source/src/types/ids.ts
# slug: src_types_ids_ts

ANNOTATIONS = [
    (1, 'after', '文件头注释：会话 ID 与智能体 ID 的品牌类型（branded types），在编译期防止两者混用。'),
    (6, 'after', '注释：SessionId 的语义——唯一标识一次 Claude Code 会话，由 getSessionId() 返回。'),
    (10, 'after', 'SessionId 品牌类型：字符串叠加只读 __brand 标记，实现编译期区分。'),
    (12, 'after', '注释：AgentId 的语义——标识会话内的子智能体，存在即说明当前上下文是子智能体。'),
    (17, 'after', 'AgentId 品牌类型。'),
    (19, 'after', '注释：asSessionId 将原始字符串转换为 SessionId。'),
    (23, 'after', 'asSessionId 实现：直接类型断言；注释提醒谨慎使用、优先用 getSessionId()。'),
    (27, 'after', '注释：asAgentId 将原始字符串转换为 AgentId。'),
    (31, 'after', 'asAgentId 实现：直接类型断言。'),
    (35, 'after', '智能体 ID 正则：a + 可选 <label>- + 16 位十六进制。'),
    (37, 'after', '注释：toAgentId 校验字符串并品牌化为 AgentId，格式不匹配时返回 null。'),
    (42, 'after', 'toAgentId 实现：正则匹配则品牌化，否则返回 null。'),
]
