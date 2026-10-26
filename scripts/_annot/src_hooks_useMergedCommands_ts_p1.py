# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (8, 'after', '''// 合并内置命令与动态 MCP 命令，按 name 去重（initialCommands 优先）。'''),
    (10, 'after', '''// MCP 命令非空时合并去重；否则直接返回内置命令。'''),
    (11, 'after', '''// uniqBy 以 name 为键，initialCommands 在前所以同名 MCP 命令被覆盖。'''),
]
