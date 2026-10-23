ANNOTATIONS = [
    (41, 'after', r'''文件级：@ 补全的三源合一器（文件 / MCP 资源 / subagent）。useTypeahead 的 fetchFileSuggestions 调这里的 generateUnifiedSuggestions，一次查询混排三类结果。'''),
    (68, 'after', r'''createSuggestionFromSource：id 前缀即类型命名空间（file- / mcp-resource-<server>__<uri> / agent-）。MCP 的 id 用双下划线分隔 server 与 uri——单下划线在 URI 里太常见会歧义。'''),
    (75, 'after', r'''两个上限：建议 15 条（与 fileSuggestions 的 MAX_SUGGESTIONS 对齐）、描述 60 字符（truncateToWidth 按显示宽度算，CJK 全角字符不会算漏）。'''),
    (109, 'after', r'''generateAgentSuggestions：空查询（showOnEmpty）返回全部 agent；有查询按 agentType 或 displayText 子串匹配。displayText 带 (agent) 后缀——和文件结果混排时用户能看出哪条是起 agent。description 用 whenToUse 截断（「什么时候用我」正是补全时最该看的）。整段 try/catch：agent 定义加载坏了不该炸掉补全。'''),
    (155, 'after', r'''空查询路径：三类直接拼接截断，不打分——用户刚打了 @ 还没输入，列表是「浏览模式」不是「搜索模式」。'''),
    (193, 'after', r'''Fuse.js 权重设计：name/agentType 权重 3（精确标识符）> displayText 2 > server/description 1。threshold 0.6 刻意放宽——粗筛交给 Fuse，精排交给后面统一排序。'''),
    (202, 'after', r'''混排的关键巧合：nucleo 与 Fuse 都是「0-1 分、越低越好」，所以两套引擎的分数能进同一个池子排序。文件分缺失时默认 0.5（中位）——没分数的不抢榜首也不沉底。这一步是整个「@ 一个字符同时搜文件和 agent」体验的核心。'''),
]
