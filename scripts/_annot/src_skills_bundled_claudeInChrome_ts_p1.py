# 数据文件：source/src/skills/bundled/claudeInChrome.ts
ANNOTATIONS = [
    (1, 'after', """登记内置技能「claude-in-chrome」：把浏览器自动化 MCP 工具名映射成 mcp__claude-in-chrome__* 作为 allowedTools，并拼装激活提示词。"""),
    (6, 'after', """把浏览器工具名映射成带前缀的 MCP 工具标识列表。"""),
    (14, 'after', """激活提示词：指引先获取浏览器标签页，再使用相关 MCP 工具。"""),
    (16, 'after', """注册技能：描述、何时使用、允许工具与启用条件（按 shouldAutoEnableClaudeInChrome）。"""),
    (26, 'after', """启用与否由 shouldAutoEnableClaudeInChrome 决定。"""),
    (27, 'after', """拼装提示词：基础 prompt + 激活提示，携带参数时追加任务段。"""),
]
