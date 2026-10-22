# -*- coding: utf-8 -*-
# MCPTool/MCPTool.ts 批注数据
ANNOTATIONS = [
    (14, 'after', '''z.object({}).passthrough()：MCP 工具自带 schema，这里不校验形状、任何键都放行——校验责任在服务器端与 mcpClient 的拼接处。'''),
    (25, 'after', '''从集中类型文件 re-export 是为了打断 import 环：UI.tsx 与 mcpClient 都从这里拿 MCPProgress，避免模块间直接互引。'''),
    (29, 'after', '''这 77 行是个「模板工具」：name、description、prompt、call、userFacingName 全部标注 Overridden in mcpClient.ts——真正的工具对象是运行时按每个 MCP 服务器克隆此模板、再覆盖对应字段生成的。'''),
    (35, 'after', '''10 万字符是所有 MCP 工具的统一结果上限，防止某个服务器一次吐爆上下文。'''),
    (56, 'before', '''checkPermissions 直接 passthrough：MCP 工具的权限判定走独立的 MCP 服务器级 allowlist 流程（在服务器连接配置里），不在这个模板里做。'''),
]
