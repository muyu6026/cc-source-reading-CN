# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (20, 'before', '''// 组装 REPL 完整工具池：复用 assembleToolPool（REPL 与 runAgent 共用的纯函数），再叠加 initialTools。'''),
    (25, 'after', '''// replBridgeEnabled / replBridgeOutboundOnly 声明但未使用（疑似早期开关残留），仍列进 deps 保引用稳定。'''),
    (30, 'after', '''// assembleToolPool 负责内置工具 + MCP 工具 + deny 过滤 + 去重；mergeAndFilterTools 再把 initialTools 合并进来并优先去重。'''),
]
