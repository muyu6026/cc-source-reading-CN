# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'after', '''// 两者都有且 MCP 非空时合并去重；否则退回 initialClients 或空数组。'''),
    (12, 'after', '''// 按 name 去重，initialClients 优先于 mcpClients（同名的后者被忽略）。'''),
    (18, 'after', '''// 用 useMemo 缓存合并结果，deps 为两个客户端数组；mergeClients 是纯函数便于单测。'''),
]
