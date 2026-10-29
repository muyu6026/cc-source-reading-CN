ANNOTATIONS = [
    (33, 'after', '''ToolCounts 汇总各分类的工具调用次数，供精简输出模式的累计统计使用。'''),
    (50, 'after', '''四类工具常量与 categorizeToolName 共同把工具名归入搜索、读取、写入、命令或其他类别。'''),
    (58, 'after', '''categorizeToolName 收尾：按前缀匹配工具名返回对应计数键，未命中归为 other。'''),
    (68, 'after', '''createEmptyToolCounts 返回全零的计数对象，作为每轮文本消息后的重置基线。'''),
    (73, 'before', '''getToolSummaryText 把累计计数拼成类似 `searched N patterns` 的摘要文案，零计数返回 undefined。'''),
    (104, 'after', '''getToolSummaryText 收尾：用首字母大写连接各分类描述。'''),
    (109, 'before', '''accumulateToolUses 遍历助手消息内容，把每个工具调用的类别计数加一。'''),
    (124, 'after', '''accumulateToolUses 收尾：仅处理 tool_use 块，其余内容忽略。'''),
    (130, 'before', '''createStreamlinedTransformer 返回一个有状态转换器，在文本消息之间累计工具计数并重置。'''),
    (193, 'after', '''createStreamlinedTransformer 收尾：文本消息发出纯文本并清零，纯工具消息发出累计摘要。'''),
    (199, 'before', '''shouldIncludeInStreamlined 判断消息是否应进入精简输出，仅保留助手与结果消息。'''),
    (201, 'after', '''shouldIncludeInStreamlined 收尾：返回是否为助手或结果类型。'''),
]
