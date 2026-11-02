# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件把「设置校验错误」与「MCP 配置错误」聚合到一起，存在的目的就是打破 settings.ts → mcp/config.ts → settings.ts 的循环依赖。'''),
    (23, 'before', '''getSettingsWithAllErrors：先取不含 MCP 错误的设置结果，再把 user / project / local 三个作用域的 MCP 配置错误摊平合并进去返回（dynamic 作用域会在 CLI 启动时抛错，这里不收集其错误）。'''),
]
