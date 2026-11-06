# -*- coding: utf-8 -*-
# 第 167 批：src/commands/mcp/mcp.tsx 批注数据（编译器产物）
ANNOTATIONS = [
    (1, 'after', '''依赖：React Compiler 运行时、React、MCP 设置与重连组件、开关 hook、AppState、命令类型、插件设置。'''),
    (9, 'after', '''imports 收尾；下面 MCPToggle 是编译器产物组件。'''),
    (12, 'after', '''MCPToggle：根据 action（enable 或 disable）批量切换 MCP 服务器，didRun 防止重复执行。'''),
    (40, 'after', '''切换核心：遍历命中目标逐个 toggleMcpServer，最后回显成功数量或「未找到」。'''),
    (54, 'after', '''useEffect 触发一次性切换，返回 null（纯副作用组件）。'''),
    (56, 'after', '''MCPToggle 收尾：缓存槽用满，组件把各分支结果拼装好。'''),
    (59, 'after', '''临时函数 _temp2：过滤掉 ide 类型客户端，避免误切内置项。'''),
    (62, 'after', '''临时函数 _temp：从 AppState 取 mcp.clients 列表。'''),
    (63, 'after', '''call 命令入口：按参数分流到设置页、重连、或开关切换。'''),
    (84, 'after', '''call 收尾：默认把 slash mcp 重定向到插件管理页（ant 用户）或 MCP 设置页。'''),
]
