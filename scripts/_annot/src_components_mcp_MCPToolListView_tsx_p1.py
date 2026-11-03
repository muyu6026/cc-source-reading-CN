# 数据文件：src/components/mcp/MCPToolListView.tsx
# slug = src_components_mcp_MCPToolListView_tsx
ANNOTATIONS = [
    (20, 'before', '''MCP 服务器工具列表视图：展示某个已连接服务器暴露的工具，用户选中后回调上层'''),
    (27, 'after', '''从应用状态取出全部 MCP 工具（s.mcp.tools），后续按服务器名过滤'''),
    (29, 'after', '''用带标签块 bb0 包裹「未连接直接返回空列表」的提前退出，等价于一个带 break 的作用域'''),
    (43, 'after', '''已连接时按服务器名过滤出本服务器的工具列表'''),
    (57, 'after', '''为每个工具构造选项：展示名经 MCP 显示名解析，并附 read-only / destructive / open-world 注解'''),
    (94, 'after', '''标题为「Tools for 服务器名」，副标题是工具数量（自动单复数）'''),
    (107, 'after', '''无工具时显示占位文本，否则渲染工具选择框；选中按索引取出工具并回调'''),
    (137, 'after', '''退出提示：等待退出时显示「再次按下退出键」，否则显示上下键导航 / Enter 选择 / Esc 返回'''),
]
