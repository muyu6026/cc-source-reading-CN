# source: src/utils/codeIndexing.ts
ANNOTATIONS = [
    (42, 'after', '''CodeIndexingTool：归一化的代码索引工具标识集合（代码搜索引擎、AI 编码助手、MCP 索引服务、上下文提供者四类）。'''),
    (47, 'after', '''CLI_COMMAND_MAPPING：把 shell 首词（命令名）映射到代码索引工具；npx/bunx 前缀看第二个词。'''),
    (113, 'after', '''MCP_SERVER_PATTERNS：用一组正则（大小写不敏感）把 MCP 服务器名匹配到代码索引工具。'''),
    (128, 'after', '''detectCodeIndexingFromCommand：取命令首词查表；npx/bunx 前缀则查第二个词，命中返回工具标识。'''),
    (131, 'after', '''取命令的首个单词（按空白切分并转小写）作为命令名去映射。'''),
    (161, 'after', '''detectCodeIndexingFromMcpTool：MCP 工具名形如 mcp__server__tool，取中间 server 段匹配模式。'''),
    (163, 'after', '''非 mcp__ 前缀的工具名直接返回 undefined（不是 MCP 索引工具）。'''),
    (198, 'after', '''detectCodeIndexingFromMcpServerName：直接对 MCP 服务器名匹配模式（供按服务器维度检测）。'''),
]
